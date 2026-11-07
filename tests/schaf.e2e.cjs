// Browser-Test Schafskopp: NODE_PATH=$(npm root -g) node tests/schaf.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8921.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 8921;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/schaf/index.html`;
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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'schaf-' + name + '.png'), fullPage: true });
const boardPos = (page) => page.evaluate(() => { const b = document.getElementById('board'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });
const readGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) {
    try { const h = JSON.parse(st.getItem('zh.sk.hostState')); if (h && h.game) return h.game; } catch { /* egal */ }
  }
  return null;
});
const getCid = (page) => page.evaluate(() => { for (const st of [sessionStorage, localStorage]) { try { const c = JSON.parse(st.getItem('zh.cid')); if (c) return c; } catch { /* egal */ } } return null; });

const stats = { notes: 0, penalties: 0 };
// Ein Schritt eines Menschen, der die Regeln kennt: erst eigene passende Karte, dann fremde, sonst aufdecken.
// `src` = Seite, die den Spielstand hält (Gastgeber); `page` = Seite, auf der geklickt wird.
async function humanStep(page, src, opt = {}) {
  const g = await readGame(src || page);
  if (!g || g.phase !== 'play') return null;
  const cid = await getCid(page);
  if (M.activePlayer(g).id !== cid) return null;
  if (!(await page.locator('.banner.mine, .banner.sk-penbanner').count())) return null;
  const me = g.players.find((p) => p.id === cid);
  const click = async (sel) => { try { await page.click(sel, { timeout: 2000 }); return true; } catch { return false; } };
  const others = M.fittingSources(g).filter((id) => id !== cid);
  // einmalig: freundliche Hinweise und Strafe ausprobieren
  if (opt.probe && !opt.probe.note) {
    const bad = g.players.find((p) => p.id !== cid && M.topOf(p) && !M.fits(g, M.topOf(p)));
    if (bad && !M.ownFits(g) && !others.length) {
      opt.probe.note = true;
      await click(`[data-act=steal][data-pid="${bad.id}"]`);
      await page.waitForSelector('.sk-note', { timeout: 3000 });
      const t = await page.textContent('.sk-note');
      if (!/passt nicht/.test(t)) errors.push('Hinweis fehlt: ' + t);
      stats.notes++;
      await shot(page, 'hinweis');
      return 'note';
    }
  }
  if (opt.probe && !opt.probe.pen && (M.ownFits(g) || others.length)) {
    opt.probe.pen = true;
    await click('[data-act=end]');
    // Banner steht nur bis zur nächsten Aktion (Computer ist im Test sehr schnell): auch im Protokoll prüfen
    await page.waitForFunction(() => /Schafskopp/.test((document.querySelector('.recap') || {}).innerText || '') || !!document.querySelector('.sk-penbanner'), null, { timeout: 3000 }).catch(() => errors.push('Strafe: kein Schafskopp-Hinweis'));
    const banner = await page.evaluate(() => (document.querySelector('.sk-penbanner') || {}).innerText || '');
    if (banner && (!/Schafskopp/.test(banner) || !/Strafkarten/.test(banner))) errors.push('Strafbanner falsch: ' + banner);
    const rc = await page.evaluate(() => (document.querySelector('.recap') || {}).innerText || '');
    if (!/Schafskopp/.test(rc) || !/Strafkarten/.test(rc)) errors.push('Strafe nicht im Protokoll: ' + rc);
    stats.penalties++;
    await shot(page, 'strafe');
    return 'pen';
  }
  if (M.ownFits(g)) return (await click('[data-act=place]')) ? 'place' : null;
  if (others.length) return (await click(`[data-act=steal][data-pid="${others[0]}"]`)) ? 'steal' : null;
  if (me.deck.length) return (await click('[data-act=flip]')) ? 'flip' : null;
  return null;
}

async function playGame(page, label, { maxMs = 150000, src, probe, pos, extraCheck } = {}) {
  const t0 = Date.now(); let acts = 0;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.sk-over').count()) break;
    const bp = await boardPos(page);
    if (bp && pos) {
      if (Math.abs(bp.top - pos.top) > 1) { errors.push(`${label}: Spielfeld springt ${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
      if (Math.abs(bp.h - pos.h) > 1) { errors.push(`${label}: Spielfeld-Höhe ändert sich ${pos.h} -> ${bp.h}`); pos = bp; }
    } else if (bp) pos = bp;
    if (extraCheck) await extraCheck();
    const r = await humanStep(page, src, { probe });
    if (r) { acts++; await page.waitForTimeout(8); } else await page.waitForTimeout(20);
  }
  return { acts, pos, over: (await page.locator('.sk-over').count()) > 0 };
}

async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const out = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [] };
    document.querySelectorAll('[data-act=flip],[data-act=place],[data-act=steal],[data-act=end],[data-act=again],[data-act=next]').forEach((b) => {
      const q = b.getBoundingClientRect();
      if (q.width < 48 || q.height < 48) out.small.push(b.dataset.act + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
    });
    return out;
  });
  if (r.sw > r.cw) errors.push(`${label}: horizontaler Scroll ${r.sw} > ${r.cw}`);
  if (r.small.length) errors.push(`${label}: Knöpfe unter 48px: ${r.small.join(', ')}`);
}

async function startBot(browser, n, level, label, vp) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `schaf-${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'schaf/engine.js')).href);
  let server = null;
  try { execSync(`curl -sf http://localhost:${PORT}/schaf/index.html -o /dev/null`); } catch {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const browser = await chromium.launch();
  try {
    // ---------- (a) gegen 2 Computer: ganze Partie bis zum Ende, Hinweis, Strafe, Neuladen, noch eine Runde ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'a');
      await shot(page, 'a-spiel');
      const probe = {};
      let pos = null;
      const r = await playGame(page, 'a', { probe, pos });
      console.log('(a) Aktionen', r.acts, 'Ende', r.over, 'Hinweis', stats.notes, 'Strafe', stats.penalties);
      if (!r.over) errors.push('a: Spiel nicht beendet');
      else {
        await shot(page, 'a-ende');
        console.log('(a) Ergebnis:', (await page.textContent('.sk-over h1')).trim(), '|', (await page.$$eval('.sk-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));
        if (!(await page.locator('[data-act=again]').count())) errors.push('a: Noch eine Runde fehlt');
        if (await page.locator('[data-act=next]').count()) errors.push('a: next-Knopf sollte es nicht geben');
        await layoutCheck(page, 'a-ende');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await readGame(page);
        if (g2.phase !== 'play' || g2.penalty.length !== 12) errors.push('a: neue Runde nicht gestartet');
        // Neuladen mitten im Spiel
        for (let i = 0; i < 6; i++) { await humanStep(page); await page.waitForTimeout(60); }
        await page.reload();
        await page.waitForSelector('.banner', { timeout: 8000 });
        const r2 = await playGame(page, 'a2', { maxMs: 120000 });
        if (!r2.over) errors.push('a: zweite Partie nicht beendet');
        console.log('(a) zweite Partie Ende', r2.over);
      }
      await ctx.close();
    }

    // ---------- 3 Computer + Layout ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'drei');
      await shot(page, 'drei-spiel');
      await layoutCheck(page, 'drei-start');
      const r = await playGame(page, 'drei', { maxMs: 120000, extraCheck: async () => {} });
      console.log('3 Computer: Aktionen', r.acts, 'Ende', r.over);
      if (!r.over) errors.push('drei: Spiel nicht beendet');
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
      while (steps < 800) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 240) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern-mitte'); }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (await page.locator('.sk-over').count()) { errors.push('lern: Spiel zu Ende ohne Ziel'); break; }
          if (++idle > 600) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        if (steps === 10) { await page.reload(); await page.waitForSelector('.coach', { timeout: 8000 }); steps++; continue; }
        try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        steps++;
      }
      console.log('(b) Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
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
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      let acts = 0; let diffs = 0; let checks = 0; let leaks = 0; let shotDone = false;
      const norm = (s) => s.replace(/\(du\)/g, '').replace(/\s+/g, ' ').trim();
      const view = (P) => P.evaluate(() => ({
        rows: document.querySelector('.sk-rows')?.innerText || '', recap: document.querySelector('.recap')?.innerText || '',
        pen: document.querySelector('.sk-pstack')?.innerText || '', html: document.body.innerHTML, labels: [...document.querySelectorAll('[aria-label],[title]')].map((e) => e.getAttribute('aria-label') || e.getAttribute('title')),
      }));
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        if ((await A.locator('.sk-over').count()) && (await B.locator('.sk-over').count())) break;
        const g = await readGame(A);
        if (g) {
          // Zustände vergleichen (nur wenn beide Seiten dieselbe Anzahl Aktionen zeigen)
          const [va, vb] = [await view(A), await view(B)];
          const g2 = await readGame(A);
          if (g2 && g2.moves === g.moves && g2.phase === 'play') {
            checks++;
            if (norm(va.rows) === norm(vb.rows) && norm(va.recap) === norm(vb.recap) && va.pen === vb.pen) { /* gleich */ } else {
              // eine Seite kann kurz hinterherhinken: nach kurzer Wartezeit erneut prüfen
              await B.waitForTimeout(150);
              const [wa, wb] = [await view(A), await view(B)];
              if (norm(wa.rows) !== norm(wb.rows) || norm(wa.recap) !== norm(wb.recap) || wa.pen !== wb.pen) diffs++;
            }
            // verdeckte Karten: nur in Stapeln, nie im DOM
            const hidden = new Set();
            const visible = new Set([...g.players.flatMap((p) => p.pile.map((c) => M.cardName(c)))]);
            for (const p of g.players) for (const c of p.deck) if (!visible.has(M.cardName(c))) hidden.add(M.cardName(c));
            for (const v of [va, vb]) {
              for (const lab of v.labels) for (const h of hidden) if (lab && new RegExp(`${h}(?!\\d)`).test(lab)) leaks++;
              if (/"deck"|data-deck|data-card/.test(v.html)) leaks++;
            }
          }
        }
        const ra = await humanStep(A, A, {}); const rb = await humanStep(B, A, {});
        if (ra) acts++; if (rb) acts++;
        if (!shotDone && acts > 12) { shotDone = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        await A.waitForTimeout(25);
      }
      console.log('(c) Netz: Aktionen', acts, 'Vergleiche', checks, 'Abweichungen', diffs, 'Lecks', leaks);
      if (diffs) errors.push('Netz: Zustände weichen ab ' + diffs);
      if (leaks) errors.push('Netz: verdeckte Karten im DOM ' + leaks);
      if (checks < 10) errors.push('Netz: zu wenige Vergleiche');
      await A.waitForSelector('.sk-over', { timeout: 10000 }); await B.waitForSelector('.sk-over', { timeout: 10000 });
      const ha = norm(await A.textContent('.sk-over h1')); const hb = norm(await B.textContent('.sk-over h1'));
      console.log('(c) Ergebnis:', ha, '|', hb);
      await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
      if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
      if (!(await A.locator('[data-act=again]').count())) errors.push('Host sieht keinen Neues-Spiel-Knopf');
      await A.click('[data-act=again]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      const helpTxt = await A.textContent('.modal');
      if (!/Schafkopf/.test(helpTxt)) errors.push('Hilfetext ohne Hinweis auf Schafkopf');
      await shot(A, 'hilfe');
      await ctx.close();
    }

    // ---------- (d) Layout 390x844 (2 und 4 Personen), Desktop ----------
    for (const [n, lab] of [[1, 'd2'], [3, 'd4']]) {
      const { ctx, page } = await startBot(browser, n, 1, lab);
      const positions = [];
      const t0 = Date.now(); let k = 0;
      while (Date.now() - t0 < 60000 && !(await page.locator('.sk-over').count())) {
        const bp = await boardPos(page);
        if (bp) positions.push(bp.top);
        if (k++ % 15 === 0) await layoutCheck(page, lab);
        if (k === 12) await shot(page, lab + '-spiel');
        await humanStep(page);
        await page.waitForTimeout(15);
      }
      const spread = Math.max(...positions) - Math.min(...positions);
      console.log(`(d) ${lab}: Messpunkte`, positions.length, 'Brett-Top-Streuung', spread, 'px');
      if (spread > 1) errors.push(`${lab}: Brett-Position schwankt (${spread}px)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'pc', { w: 1280, h: 900 });
      await page.waitForTimeout(600);
      for (let i = 0; i < 12; i++) { await humanStep(page); await page.waitForTimeout(40); }
      await shot(page, 'pc-spiel');
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('SCHAFSKOPP E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
