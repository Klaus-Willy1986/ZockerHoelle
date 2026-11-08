// Browser-Test Bunco: NODE_PATH=$(npm root -g) node tests/bunco.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8969.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 8969;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/bunco/index.html`;
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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'bunco-' + name + '.png'), fullPage: true });
const pos = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height) }; }, sel);
const readGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) {
    try { const h = JSON.parse(st.getItem('zh.bc.hostState')); if (h && h.game) return h.game; } catch { /* egal */ }
  }
  return null;
});
const getCid = (page) => page.evaluate(() => { for (const st of [sessionStorage, localStorage]) { try { const c = JSON.parse(st.getItem('zh.cid')); if (c) return c; } catch { /* egal */ } } return null; });
const stats = { rolls: 0, nexts: 0, hitChecks: 0, buncos: 0, minis: 0 };

async function humanStep(page, src, opt = {}) {
  const g = await readGame(src || page);
  if (!g || g.phase === 'over') return null;
  const cid = await getCid(page);
  const click = async (sel) => { try { await page.click(sel, { timeout: 2500 }); return true; } catch { return false; } };
  if (g.players.findIndex((p) => p.id === cid) < 0) return null;
  if (g.phase === 'between') {
    if (opt.noNext) return null;
    if (await page.locator('.bc-spin').count()) return null;
    if (opt.checkBetween) await opt.checkBetween(page, g);
    return (await click('[data-act=next]')) ? (stats.nexts++, 'next') : null;
  }
  if (g.players[g.active].id !== cid) return null;
  if (await page.locator('.bc-spin').count()) return null;
  const ok = await click('[data-act=roll]');
  if (ok) stats.rolls++;
  return ok ? 'roll' : null;
}

// Leuchtende Würfel müssen genau die Zielzahl-Würfel sein
async function hitCheck(page, src) {
  const g = await readGame(src || page);
  if (!g || g.phase === 'over' || !g.dice) return;
  if (await page.locator('.bc-spin').count()) return;
  const v = await page.evaluate(() => [...document.querySelectorAll('.bc-dicearea .bc-die')].map((d) => ({ l: d.getAttribute('aria-label'), hit: d.classList.contains('hit'), mini: d.classList.contains('mini') })));
  const g2 = await readGame(src || page);
  if (g2.moves !== g.moves || v.length !== 3) return;
  stats.hitChecks++;
  g.dice.forEach((d, i) => {
    if (!v[i].l.includes('Würfel ' + (i + 1) + ': ' + d)) errors.push('Würfelbild falsch ' + v[i].l + ' statt ' + d);
    if (v[i].hit !== (d === g.target)) errors.push(`Leuchten falsch: Würfel ${d}, Ziel ${g.target}`);
  });
  const l = g.last;
  if (l && l.bunco) stats.buncos++;
  if (l && l.mini) { stats.minis++; if (!v.every((x) => x.mini)) errors.push('Mini-Bunco nicht markiert'); }
}

async function playGame(page, label, { maxMs = 150000, src, extra = {} } = {}) {
  const t0 = Date.now(); let acts = 0;
  let boardRef = null; let diceRef = null;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.bc-over').count()) break;
    const bp = await pos(page, '#board'); const dp = await pos(page, '#dice');
    if (bp) { if (boardRef && Math.abs(bp.top - boardRef.top) > 1) errors.push(`${label}: Spielfeld springt ${boardRef.top} -> ${bp.top}`); if (boardRef && Math.abs(bp.h - boardRef.h) > 1) errors.push(`${label}: Spielfeld-Höhe ${boardRef.h} -> ${bp.h}`); boardRef = bp; }
    if (dp) { if (diceRef && Math.abs(dp.top - diceRef.top) > 1) errors.push(`${label}: Würfelbereich springt ${diceRef.top} -> ${dp.top}`); diceRef = dp; }
    const rb = await page.evaluate(() => { const b = document.querySelector('[data-act=roll]'); if (!b) return null; const r = b.getBoundingClientRect(); return { y: r.top + scrollY }; });
    if (rb) { if (extra.rollPos && Math.abs(rb.y - extra.rollPos.y) > 1) errors.push(`${label}: Würfeln-Knopf springt ${extra.rollPos.y} -> ${rb.y}`); extra.rollPos = rb; }
    await hitCheck(page, src);
    const r = await humanStep(page, src, extra);
    if (r) { acts++; await page.waitForTimeout(8); } else await page.waitForTimeout(20);
  }
  return { acts, over: (await page.locator('.bc-over').count()) > 0 };
}

async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const out = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [] };
    document.querySelectorAll('[data-act=roll],[data-act=next],[data-act=again]').forEach((b) => {
      const q = b.getBoundingClientRect();
      if (q.width < 48 || q.height < 48) out.small.push((b.dataset.act || b.className) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
    });
    return out;
  });
  if (r.sw > r.cw) errors.push(`${label}: horizontaler Scroll ${r.sw} > ${r.cw}`);
  if (r.small.length) errors.push(`${label}: Knöpfe unter 48px: ${r.small.join(', ')}`);
}

async function start(browser, mode, label, vp, { big } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.evaluate((b) => { try { localStorage.clear(); sessionStorage.clear(); if (b) localStorage.setItem('zh.big', 'true'); } catch { /* egal */ } }, !!big);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  if (label === 'a') await shot(page, 'start');
  await page.click(mode === 'solo' ? '[data-act=solo]' : `[data-act=bot][data-n="${mode}"][data-level="${label === 'a' ? 1 : 0}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'bunco/engine.js')).href);
  let server = null;
  try { execSync(`curl -sf http://localhost:${PORT}/bunco/index.html -o /dev/null`); } catch {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const browser = await chromium.launch();
  try {
    // ---------- (a) ganze Partie gegen 2 Computer, danach neue Partie mit Neuladen ----------
    {
      const { ctx, page } = await start(browser, 2, 'a');
      await shot(page, 'a-spiel');
      let bShot = false;
      const checkBetween = async (p, g) => {
        const t = await p.textContent('.bc-res');
        if (!/Runde \d geht an|ist zu Ende/.test(t)) errors.push('Rundentext unklar: ' + t);
        if (!bShot) { bShot = true; console.log('(a) Rundentext:', t.replace(/\s+/g, ' ')); await shot(p, 'a-rundenende'); }
      };
      const r = await playGame(page, 'a', { extra: { checkBetween } });
      console.log('(a) Aktionen', r.acts, 'Ende', r.over, JSON.stringify(stats));
      if (!r.over) errors.push('a: Spiel nicht beendet');
      else {
        await shot(page, 'a-ende');
        console.log('(a) Ergebnis:', (await page.textContent('.bc-over h1')).trim(), '|', (await page.$$eval('.bc-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))).slice(0, 3).join(' | '));
        await layoutCheck(page, 'a-ende');
        const g = await readGame(page);
        if (g.history.length !== 6) errors.push('a: nicht 6 Runden');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await readGame(page);
        if (g2.phase !== 'roll' || g2.round !== 1 || g2.players.some((p) => p.total !== 0 || p.wins !== 0)) errors.push('a: neue Partie nicht sauber gestartet');
        for (let i = 0; i < 4; i++) { await humanStep(page); await page.waitForTimeout(80); }
        await page.reload();
        await page.waitForSelector('.banner', { timeout: 8000 });
        const r2 = await playGame(page, 'a2', { maxMs: 120000 });
        if (!r2.over) errors.push('a: zweite Partie nicht beendet');
        console.log('(a) zweite Partie Ende', r2.over);
      }
      await ctx.close();
    }

    // ---------- Alleinspiel mit Bestleistung ----------
    {
      const { ctx, page } = await start(browser, 'solo', 'solo');
      await shot(page, 'solo-spiel');
      const info = await page.textContent('.bc-info');
      if (!/Reihe 1 von 10/.test(info)) errors.push('solo: Reihenanzeige fehlt: ' + info);
      const r = await playGame(page, 'solo', { maxMs: 150000 });
      console.log('(solo) Aktionen', r.acts, 'Ende', r.over);
      if (!r.over) errors.push('solo: nicht beendet');
      else {
        const g = await readGame(page);
        const best = await page.evaluate(() => { for (const st of [sessionStorage, localStorage]) { const v = st.getItem('zh.bc_best'); if (v) return JSON.parse(v); } return null; });
        const total = g.players[0].total;
        console.log('(solo) Punkte', total, 'gespeichert', best, '|', (await page.textContent('.bc-over h1')).trim());
        if (best !== total) errors.push(`solo: Bestleistung ${best} != ${total}`);
        if (!(await page.textContent('.bc-over')).includes(String(total))) errors.push('solo: Punkte nicht angezeigt');
        await shot(page, 'solo-ende');
        await layoutCheck(page, 'solo-ende');
      }
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
        const target = page.locator('[data-act=roll].coach-target, [data-act=next].coach-target, [data-act=again].coach-target').first();
        if ((await target.count()) === 0) {
          if (await page.locator('.bc-over').count()) { errors.push('lern: Spiel zu Ende ohne Ziel'); break; }
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
      for (const w of ['Zielzahl', 'Würfeln', 'Punkt', 'Bunco', '21 Punkte']) if (!all.includes(w)) errors.push('Lernrunde erklärt nicht: ' + w);
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
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board'); await C.waitForSelector('#board');
      let acts = 0; let diffs = 0; let checks = 0; let shotDone = false; let guestNext = 0;
      const norm = (s) => s.replace(/\(du\)/g, '').replace(/\s+/g, ' ').trim();
      const view = (P) => P.evaluate(() => ({ players: document.querySelector('.bc-players')?.innerText || '', target: document.querySelector('.bc-target')?.innerText || '', dice: [...document.querySelectorAll('.bc-dicearea .bc-die')].map((d) => d.getAttribute('aria-label')).join('|'), recap: document.querySelector('.recap')?.innerText || '' }));
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        if ((await A.locator('.bc-over').count()) && (await B.locator('.bc-over').count()) && (await C.locator('.bc-over').count())) break;
        const g = await readGame(A);
        if (g && g.phase !== 'over') {
          if (g.phase === 'between') guestNext += (await B.locator('[data-act=next]').count()) + (await C.locator('[data-act=next]').count());
          const [va, vb, vc] = [await view(A), await view(B), await view(C)];
          const g2 = await readGame(A);
          if (g2 && g2.moves === g.moves && !(await A.locator('.bc-spin').count()) && !(await B.locator('.bc-spin').count()) && !(await C.locator('.bc-spin').count())) {
            checks++;
            const same = (x, y) => norm(x.players) === norm(y.players) && norm(x.recap) === norm(y.recap) && x.target === y.target && x.dice === y.dice;
            if (!(same(va, vb) && same(va, vc))) {
              await B.waitForTimeout(150);
              const [wa, wb, wc] = [await view(A), await view(B), await view(C)];
              if (!(same(wa, wb) && same(wa, wc))) diffs++;
            }
          }
        }
        const ra = await humanStep(A, A, { noNext: false }); const rb = await humanStep(B, A, { noNext: true }); const rc = await humanStep(C, A, { noNext: true });
        for (const r of [ra, rb, rc]) if (r) acts++;
        if (!shotDone && acts > 10) { shotDone = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        await A.waitForTimeout(25);
      }
      console.log('(c) Netz: Aktionen', acts, 'Vergleiche', checks, 'Abweichungen', diffs, 'Gast-Weiter-Knöpfe', guestNext);
      if (diffs) errors.push('Netz: Zustände weichen ab ' + diffs);
      if (guestNext) errors.push('Gast sieht Weiter-Knopf');
      if (checks < 10) errors.push('Netz: zu wenige Vergleiche');
      await A.waitForSelector('.bc-over', { timeout: 10000 }); await B.waitForSelector('.bc-over', { timeout: 10000 });
      const ha = norm(await A.textContent('.bc-over h1')); const hb = norm(await B.textContent('.bc-over h1'));
      console.log('(c) Ergebnis:', ha, '|', hb);
      await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
      if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neue-Partie-Knopf');
      if (!(await A.locator('[data-act=again]').count())) errors.push('Host sieht keinen Neue-Partie-Knopf');
      await A.click('[data-act=again]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      const helpTxt = await A.textContent('.modal');
      for (const w of ['Zielzahl', 'Bunco', 'Mini-Bunco', '21 Punkte', 'Allein spielen']) if (!helpTxt.includes(w)) errors.push('Hilfetext ohne ' + w);
      await shot(A, 'hilfe');
      await ctx.close();
    }

    // ---------- (d) Layout 390x844 (2, 4, 8 Personen, große Schrift), Desktop ----------
    for (const [n, lab, big] of [['solo', 'd1', false], [1, 'd2', false], [3, 'd4', false], [7, 'd8', false], [7, 'd8gross', true]]) {
      const { ctx, page } = await start(browser, n, lab, undefined, { big });
      const bt = []; const dt = [];
      const t0 = Date.now(); let k = 0;
      while (Date.now() - t0 < 60000 && !(await page.locator('.bc-over').count())) {
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
      console.log(`(d) ${lab}: Messpunkte`, bt.length, 'Brett-Streuung', spread, 'px, Würfel-Streuung', spreadD, 'px');
      if (spread > 1) errors.push(`${lab}: Brett-Position schwankt (${spread}px)`);
      if (spreadD > 1) errors.push(`${lab}: Würfelbereich schwankt (${spreadD}px)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await start(browser, 3, 'pc', { w: 1280, h: 900 });
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
  console.log('BUNCO E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
