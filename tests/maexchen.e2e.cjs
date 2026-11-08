// Browser-Test Mäxchen: NODE_PATH=$(npm root -g) node tests/maexchen.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8962.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 8962;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/maexchen/index.html`;
const errors = [];
let M;

async function newPage(browser, label, { w = 390, h = 844, fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (fast) {
    await ctx.addInitScript(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      const st = window.setTimeout;
      window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'maexchen-' + name + '.png'), fullPage: true });
const pos = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height) }; }, sel);
const readGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) {
    try { const h = JSON.parse(st.getItem('zh.mx.hostState')); if (h && h.game) return h.game; } catch { /* egal */ }
  }
  return null;
});
const getCid = (page) => page.evaluate(() => { for (const st of [sessionStorage, localStorage]) { try { const c = JSON.parse(st.getItem('zh.cid')); if (c) return c; } catch { /* egal */ } } return null; });

const stats = { lies: 0, truths: 0, doubts: 0, believes: 0, lifts: 0, maex: 0, leakChecks: 0 };

// Verdeckte Würfel dürfen nur dann im DOM stehen, wenn ich sie sehen darf: eigener Wurf nach "Becher anheben", oder aufgedeckt.
async function leakCheck(page, label, g, cid) {
  if (!g || g.phase === 'over') return;
  const v = await page.evaluate(() => ({
    dice: document.querySelectorAll('.mx-die[role=img]').length,
    html: document.body.innerHTML,
    lifted: /Dein Wurf:/.test((document.querySelector('.mx-cap') || {}).innerText || ''),
    rolling: !!document.querySelector('.mx-spin'),
  }));
  const ap = g.players[g.active];
  const allowed = g.phase === 'reveal' || (g.phase === 'announce' && ap.id === cid && v.lifted);
  stats.leakChecks++;
  if (!allowed && v.dice > 0) errors.push(`${label}: Würfel im DOM obwohl verdeckt (Phase ${g.phase})`);
  if (!allowed && /"cupDice"|data-cup|Dein Wurf:/.test(v.html)) errors.push(`${label}: Wurf-Hinweis im DOM obwohl verdeckt`);
  if (v.dice === 2 && !allowed && !v.rolling) errors.push(`${label}: zwei Würfel sichtbar`);
}

// Ein Schritt eines Menschen. `src` = Seite des Gastgebers (hält den Spielstand), `page` = Seite, auf der geklickt wird.
async function humanStep(page, src, opt = {}) {
  const g = await readGame(src || page);
  if (!g || g.phase === 'over') return null;
  const cid = await getCid(page);
  const click = async (sel) => { try { await page.click(sel, { timeout: 2500 }); return true; } catch { return false; } };
  const myIdx = g.players.findIndex((p) => p.id === cid);
  if (myIdx < 0) return null;
  if (g.phase === 'reveal') {
    if (opt.noNext || g.players[myIdx].lives <= 0) return null;
    if (opt.checkReveal) await opt.checkReveal(page, g);
    return (await click('[data-act=next]')) ? 'next' : null;
  }
  if (g.players[g.active].id !== cid) return null;
  if (g.phase === 'roll') return (await click('[data-act=roll]')) ? 'roll' : null;
  if (g.phase === 'announce') {
    if (!(await page.locator('[data-act=lift]').count())) return null; // Würfel rollen noch
    if (opt.leak) await leakCheck(page, opt.leak, g, cid);
    if (!(await click('[data-act=lift]'))) return null;
    stats.lifts++;
    await page.waitForSelector('.mx-die[role=img]', { timeout: 2000 });
    const dd = await page.$$eval('.mx-die[role=img]', (e) => e.map((x) => x.getAttribute('aria-label')));
    const want = g.cupDice.map((d, i) => `Würfel ${i + 1}: ${d}`);
    if (JSON.stringify(dd) !== JSON.stringify(want)) errors.push(`Würfelbild falsch ${dd} statt ${want}`);
    const cap = await page.textContent('.mx-cap');
    if (!cap.includes(String(g.cup))) errors.push('Wurftext falsch: ' + cap);
    if (opt.shotLift && !opt.shotLift.done) { opt.shotLift.done = true; await shot(page, 'angehoben'); }
    if (g.cup === 21) stats.maex++;
    const al = M.allowedSays(g);
    let v;
    if (Math.random() < 0.5 && al.includes(g.cup)) { v = g.cup; stats.truths++; } else { v = al[Math.floor(Math.random() * al.length)]; if (v !== g.cup) stats.lies++; else stats.truths++; }
    if (!(await click(`.mx-val[data-v="${v}"]`))) return null;
    if (g.announced !== null) {
      // zu niedrige Werte sind gesperrt
      const lowEnabled = await page.$$eval('.mx-val.low:not([disabled])', (e) => e.length);
      if (lowEnabled) errors.push('niedrige Werte sind nicht gesperrt');
    }
    return (await click('[data-act=say]')) ? 'say' : null;
  }
  if (g.phase === 'decide') {
    if (opt.leak) await leakCheck(page, opt.leak, g, cid);
    if (opt.shotDecide && !opt.shotDecide.done) { opt.shotDecide.done = true; await shot(page, 'entscheiden'); }
    const doubt = g.announced === 21 || Math.random() < 0.45;
    if (doubt) stats.doubts++; else stats.believes++;
    return (await click(doubt ? '[data-act=doubt]' : '[data-act=believe]')) ? (doubt ? 'doubt' : 'believe') : null;
  }
  return null;
}

async function playGame(page, label, { maxMs = 150000, src, extra = {} } = {}) {
  const t0 = Date.now(); let acts = 0;
  let boardRef = null; let diceRef = null;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.mx-over').count()) break;
    const bp = await pos(page, '#board'); const dp = await pos(page, '#dice');
    if (bp) { if (boardRef && Math.abs(bp.top - boardRef.top) > 1) errors.push(`${label}: Spielfeld springt ${boardRef.top} -> ${bp.top}`); if (boardRef && Math.abs(bp.h - boardRef.h) > 1) errors.push(`${label}: Spielfeld-Höhe ${boardRef.h} -> ${bp.h}`); boardRef = bp; }
    if (dp) { if (diceRef && Math.abs(dp.top - diceRef.top) > 1) errors.push(`${label}: Würfelbereich springt ${diceRef.top} -> ${dp.top}`); if (diceRef && Math.abs(dp.h - diceRef.h) > 1) errors.push(`${label}: Würfelbereich-Höhe ${diceRef.h} -> ${dp.h}`); diceRef = dp; }
    const r = await humanStep(page, src, { leak: label, ...extra });
    if (r) { acts++; await page.waitForTimeout(8); } else await page.waitForTimeout(20);
  }
  return { acts, over: (await page.locator('.mx-over').count()) > 0 };
}

async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const out = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [] };
    document.querySelectorAll('[data-act=roll],[data-act=lift],[data-act=say],[data-act=believe],[data-act=doubt],[data-act=next],[data-act=again],.mx-val:not(.low)').forEach((b) => {
      const q = b.getBoundingClientRect();
      if (q.width < 48 || q.height < 48) out.small.push((b.dataset.act || b.className) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
    });
    return out;
  });
  if (r.sw > r.cw) errors.push(`${label}: horizontaler Scroll ${r.sw} > ${r.cw}`);
  if (r.small.length) errors.push(`${label}: Knöpfe unter 48px: ${r.small.join(', ')}`);
}

async function startBot(browser, n, level, label, vp, { big, short } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.evaluate((b) => { try { localStorage.clear(); sessionStorage.clear(); if (b) localStorage.setItem('zh.big', 'true'); } catch { /* egal */ } }, !!big);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  if (short) await page.check('input[data-opt=short]');
  await page.screenshot({ path: path.join(SHOTS, `maexchen-${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'maexchen/engine.js')).href);
  let server = null;
  try { execSync(`curl -sf http://localhost:${PORT}/maexchen/index.html -o /dev/null`); } catch {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const browser = await chromium.launch();
  try {
    // ---------- (a) ganze Partie gegen den Computer (Mittel), danach noch eine Runde mit Neuladen ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'a');
      await shot(page, 'a-start-spiel');
      const sl = { done: false }; const sd = { done: false };
      let revShot = false;
      const checkReveal = async (p, g) => {
        // Ergebnistext prüfen (aus Sicht dieser Person)
        const t = await p.textContent('.mx-result');
        if (!/(hast|hat) (gelogen|ein Mäxchen angesagt|die Wahrheit gesagt)/.test(t) || !/Leben/.test(t) || !/🍺/.test(t)) errors.push('Ergebnistext unklar: ' + t);
        const l = g.last;
        const shouldLie = M.rankOf(l.real) < M.rankOf(l.announced);
        if (shouldLie !== /gelogen/.test(t)) errors.push('Ergebnistext passt nicht zum Wurf: ' + t);
        const caps = await p.textContent('.mx-cap');
        if (!caps.includes(String(l.real))) errors.push('Aufgedeckter Wurf fehlt: ' + caps);
        if (!revShot) { revShot = true; console.log('(a) Ergebnistext:', t.replace(/\s+/g, ' ')); await shot(p, 'a-aufgedeckt'); }
      };
      const r = await playGame(page, 'a', { extra: { shotLift: sl, shotDecide: sd, checkReveal } });
      console.log('(a) Aktionen', r.acts, 'Ende', r.over, 'Statistik', JSON.stringify(stats));
      if (!r.over) errors.push('a: Spiel nicht beendet');
      else {
        await shot(page, 'a-ende');
        console.log('(a) Ergebnis:', (await page.textContent('.mx-over h1')).trim(), '|', (await page.$$eval('.mx-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));
        await layoutCheck(page, 'a-ende');
        if (!(await page.locator('[data-act=again]').count())) errors.push('a: Noch eine Runde fehlt');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await readGame(page);
        if (g2.phase !== 'roll' || g2.players.some((p) => p.lives !== 6)) errors.push('a: neue Partie nicht gestartet');
        for (let i = 0; i < 4; i++) { await humanStep(page); await page.waitForTimeout(80); }
        await page.reload();
        await page.waitForSelector('.banner', { timeout: 8000 });
        const r2 = await playGame(page, 'a2', { maxMs: 120000 });
        if (!r2.over) errors.push('a: zweite Partie nicht beendet');
        console.log('(a) zweite Partie Ende', r2.over);
      }
      await ctx.close();
    }

    // ---------- kurze Partie gegen 7 Computer (Leicht): 3 Leben, 8 Personen ----------
    {
      const { ctx, page } = await startBot(browser, 7, 0, 'acht', undefined, { short: true });
      const g0 = await readGame(page);
      if (g0.players.length !== 8 || g0.players.some((p) => p.lives !== 3)) errors.push('acht: 8 Personen mit 3 Leben erwartet');
      await shot(page, 'acht-spiel');
      await layoutCheck(page, 'acht-start');
      const r = await playGame(page, 'acht', { maxMs: 150000 });
      console.log('8 Personen (kurz): Aktionen', r.acts, 'Ende', r.over);
      if (!r.over) errors.push('acht: Spiel nicht beendet');
      await ctx.close();
    }

    // ---------- (b) Lernrunde ----------
    {
      const { ctx, page } = await newPage(browser, 'lern');
      await page.goto(BASE);
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
      await page.goto(BASE);
      await page.fill('#name', 'Erna');
      await page.click('[data-act=learn]');
      await page.waitForSelector('.coach');
      const texts = new Set();
      let steps = 0; let idle = 0; let finished = false;
      while (steps < 1500) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 240) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern-mitte'); }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (await page.locator('.mx-over').count()) { errors.push('lern: Spiel zu Ende ohne Ziel'); break; }
          if (++idle > 600) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        if (steps === 10) { await page.reload(); await page.waitForSelector('.coach', { timeout: 8000 }); steps++; continue; }
        try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '" (' + act + '): ' + e.message.split('\n')[0]); break; }
        steps++;
      }
      console.log('(b) Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      const all = [...texts].join(' ');
      for (const w of ['Becher anheben', 'Glauben', 'Mäxchen', 'Leben']) if (!all.includes(w)) errors.push('Lernrunde erklärt nicht: ' + w);
      await page.click('[data-act=learn-stop]').catch(() => {});
      await ctx.close();
    }

    // ---------- (c) Host + Gast über Mock-Netz ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        const si = window.setInterval;
        window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      });
      const watch = (p, n) => {
        p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
        p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); });
        p.on('dialog', (d) => d.accept());
      };
      const A = await ctx.newPage(); watch(A, 'A');
      await A.goto(BASE + '?mock=1');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      const C = await ctx.newPage(); watch(C, 'C');
      await C.goto(BASE + '?mock=1&raum=' + code);
      await C.fill('#name', 'Clara');
      await C.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.check('input[data-opt=short]');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board'); await C.waitForSelector('#board');
      const g0 = await readGame(A);
      if (g0.players.length !== 3 || g0.players.some((p) => p.lives !== 3)) errors.push('Netz: 3 Personen mit 3 Leben erwartet');
      let acts = 0; let diffs = 0; let checks = 0; let shotDone = false;
      const norm = (s) => s.replace(/\(du\)/g, '').replace(/\s+/g, ' ').trim();
      const view = (P) => P.evaluate(() => ({ players: document.querySelector('.mx-players')?.innerText || '', recap: document.querySelector('.recap')?.innerText || '', html: document.body.innerHTML }));
      const t0 = Date.now();
      const [cidA, cidB, cidC] = [await getCid(A), await getCid(B), await getCid(C)];
      while (Date.now() - t0 < 150000) {
        if ((await A.locator('.mx-over').count()) && (await B.locator('.mx-over').count()) && (await C.locator('.mx-over').count())) break;
        const g = await readGame(A);
        if (g && g.phase !== 'over') {
          const [va, vb, vc] = [await view(A), await view(B), await view(C)];
          const g2 = await readGame(A);
          if (g2 && g2.moves === g.moves) {
            checks++;
            const same = (x, y) => norm(x.players) === norm(y.players) && norm(x.recap) === norm(y.recap);
            if (!(same(va, vb) && same(va, vc))) {
              await B.waitForTimeout(150);
              const [wa, wb, wc] = [await view(A), await view(B), await view(C)];
              if (!(same(wa, wb) && same(wa, wc))) diffs++;
            }
            await leakCheck(A, 'A', g, cidA); await leakCheck(B, 'B', g, cidB); await leakCheck(C, 'C', g, cidC);
          }
        }
        const noNext = { noNext: false };
        const ra = await humanStep(A, A, { noNext: false }); const rb = await humanStep(B, A, { noNext: true }); const rc = await humanStep(C, A, { noNext: true });
        for (const r of [ra, rb, rc]) if (r) acts++;
        if (!shotDone && acts > 10) { shotDone = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        await A.waitForTimeout(25);
      }
      console.log('(c) Netz: Aktionen', acts, 'Vergleiche', checks, 'Abweichungen', diffs, 'Leck-Prüfungen', stats.leakChecks);
      if (diffs) errors.push('Netz: Zustände weichen ab ' + diffs);
      if (checks < 10) errors.push('Netz: zu wenige Vergleiche');
      await A.waitForSelector('.mx-over', { timeout: 10000 }); await B.waitForSelector('.mx-over', { timeout: 10000 });
      const ha = norm(await A.textContent('.mx-over h1')); const hb = norm(await B.textContent('.mx-over h1'));
      console.log('(c) Ergebnis:', ha, '|', hb);
      await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
      if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
      if (!(await A.locator('[data-act=again]').count())) errors.push('Host sieht keinen Neues-Spiel-Knopf');
      await A.click('[data-act=again]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      const helpTxt = await A.textContent('.modal');
      for (const w of ['Mäxchen', '6 Leben', 'Glauben', 'zwei Leben']) if (!helpTxt.includes(w)) errors.push('Hilfetext ohne ' + w);
      await shot(A, 'hilfe');
      await ctx.close();
    }

    // ---------- (d) Layout 390x844 (2, 4, 8 Personen, große Schrift), Desktop ----------
    for (const [n, lab, big] of [[1, 'd2', false], [3, 'd4', false], [7, 'd8', false], [3, 'd4gross', true]]) {
      const { ctx, page } = await startBot(browser, n, 1, lab, undefined, { big, short: true });
      const bt = []; const dt = [];
      const t0 = Date.now(); let k = 0;
      while (Date.now() - t0 < 60000 && !(await page.locator('.mx-over').count())) {
        const bp = await pos(page, '#board'); const dp = await pos(page, '#dice');
        if (bp) bt.push(bp.top);
        if (dp) dt.push(dp.top);
        if (k++ % 4 === 0) await layoutCheck(page, lab);
        if (k === 14) await shot(page, lab + '-spiel');
        await humanStep(page);
        await page.waitForTimeout(15);
      }
      const spread = Math.max(...bt) - Math.min(...bt);
      const spreadD = Math.max(...dt) - Math.min(...dt);
      console.log(`(d) ${lab}: Messpunkte`, bt.length, 'Brett-Top-Streuung', spread, 'px, Würfelbereich-Streuung', spreadD, 'px');
      if (spread > 1) errors.push(`${lab}: Brett-Position schwankt (${spread}px)`);
      if (spreadD > 1) errors.push(`${lab}: Würfelbereich schwankt (${spreadD}px)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'pc', { w: 1280, h: 900 });
      await page.waitForTimeout(400);
      for (let i = 0; i < 10; i++) { await humanStep(page); await page.waitForTimeout(40); }
      await shot(page, 'pc-spiel');
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log('Statistik', JSON.stringify(stats));
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('MAEXCHEN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
