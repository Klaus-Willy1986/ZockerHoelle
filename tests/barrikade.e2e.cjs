// Durchspieltest für Barrikade (Test-Modus ?mock=1, mehrere Tabs im selben Browser).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8775 &   dann   NODE_PATH=$(npm root -g) node tests/barrikade.e2e.cjs
// Optional: PLAYERS=2,4 (Standard), PORT=8775, SHOTS=<Ordner für Bilder>
const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.PORT || 8775;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const COUNTS = (process.env.PLAYERS || '2,4').split(',').map(Number);
const NAMES = ['Anna', 'Bernd', 'Clara', 'Dieter'];
const base = `http://localhost:${PORT}/barrikade/index.html?mock=1`;
const REAL_CLICKS = 10; // so viele Aktionen je Tab werden mit der echten Maus ausgeführt (prüft die Tippflächen)
const TIME_LIMIT_MS = 5 * 60 * 1000;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const classify = () => (document.querySelector('[data-act=roll]') ? 'roll'
  : document.querySelector('[data-act=place]') ? 'place'
    : document.querySelector('[data-act=pick]') ? 'pick'
      : document.querySelector('.trophy') ? 'over' : null);

// Zielstrebiger Zug im Browser: probiert alle ziehbaren Figuren durch (Tippen auf die echten Elemente) und nimmt das Zielfeld, das am nächsten am Ziel liegt.
async function botMove(page) {
  return page.evaluate(async (r) => {
    const E = await import('/barrikade/engine.js');
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const ids = [...document.querySelectorAll('[data-act=pick]')].map((e) => e.dataset.piece);
    const seenHouse = new Set();
    const cands = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-act=pick][data-piece="${id}"]`);
      if (!el) continue;
      if (el.dataset.node === 'H') { if (seenHouse.size) continue; seenHouse.add(id); }
      click(el);
      const dests = [...document.querySelectorAll('[data-act=dest]')];
      if (!dests.length) throw new Error('keine Zielfelder für ' + id);
      for (const d of dests) cands.push({ id, node: d.dataset.node, kind: d.dataset.kind, dist: E.DIST_TO_GOAL[d.dataset.node] });
    }
    let pick = cands.find((c) => c.kind === 'goal');
    if (!pick) {
      if (r < 0.8) { const m = Math.min(...cands.map((c) => c.dist)); const best = cands.filter((c) => c.dist === m); pick = best[Math.floor(r * 1000) % best.length]; }
      else pick = cands[Math.floor(r * 1000) % cands.length];
    }
    // Auswahl neu setzen: erst Figur (nochmal antippen hebt die Auswahl auf, deshalb nur, wenn sie nicht schon gewählt ist)
    let el = document.querySelector(`[data-act=pick][data-piece="${pick.id}"]`);
    if (!document.querySelector(`[data-act=dest][data-node="${pick.node}"]`)) { click(el); el = null; }
    const dest = document.querySelector(`[data-act=dest][data-node="${pick.node}"]`);
    if (!dest) throw new Error('Zielfeld fehlt');
    click(dest);
    return pick.kind;
  }, rnd());
}

async function playGame(browser, n, vp) {
  const tag = `${n}p_${vp.width}`;
  const ctx = await browser.newContext({ viewport: vp });
  const pages = [];
  const watch = (p, name) => {
    p.on('pageerror', (e) => errors.push(name + ' pageerror ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console ' + m.text()); });
    p.on('dialog', (d) => d.accept());
  };
  const A = await ctx.newPage(); watch(A, NAMES[0]); pages.push(A);
  await A.goto(base);
  await A.fill('input', NAMES[0]);
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  for (let i = 1; i < n; i++) {
    const P = await ctx.newPage(); watch(P, NAMES[i]); pages.push(P);
    await P.goto(base + '&raum=' + code);
    await P.fill('input', NAMES[i]);
    await P.click('[data-act=join-invited]');
    await P.waitForSelector('text=Du bist dabei');
  }
  await A.waitForFunction((k) => document.querySelectorAll('.players li').length === k, n);
  await A.click('[data-act=start]');
  for (const p of pages) await p.waitForSelector('.bk-board');
  const snap = (p, name) => p.screenshot({ path: path.join(SHOTS, `bk_e2e_${tag}_${name}.png`), fullPage: true });

  // Aufbau prüfen: Figuren, Sperren, Häuser
  const setup = await A.evaluate(() => ({
    pieces: document.querySelectorAll('.bk-piece').length,
    barriers: document.querySelectorAll('.bk-barrier').length,
  }));
  if (setup.pieces !== n * 5 || setup.barriers !== 11) throw new Error('Aufbau falsch ' + JSON.stringify(setup));

  const stats = { turns: 0, places: 0, passes: 0, captures: 0, real: 0, scrollChecks: 0 };
  const realLeft = new Map(pages.map((p) => [p, REAL_CLICKS]));
  const t0 = Date.now();
  let shotsDone = new Set();
  let over = false;

  for (let guard = 0; guard < 20000 && !over; guard++) {
    if (Date.now() - t0 > TIME_LIMIT_MS) throw new Error('Zeitlimit: Spiel nicht beendet');
    let acted = false;
    for (const p of pages) {
      const st = await p.evaluate(classify);
      if (!st) continue;
      if (st === 'over') { over = true; break; }
      const real = realLeft.get(p) > 0;
      const mine = await p.evaluate(() => document.querySelector('.banner').textContent);
      if (!/Du bist dran|Sperre genommen/.test(mine)) throw new Error('Banner falsch: ' + mine);
      // alle anderen sehen "… ist dran"
      for (const q of pages) {
        if (q === p) continue;
        const b = await q.evaluate(() => document.querySelector('.banner').textContent);
        if (!/ist dran/.test(b) || /Du bist dran/.test(b)) throw new Error('Banner der anderen falsch: ' + b);
      }
      if (st === 'roll') {
        stats.turns++;
        if (!shotsDone.has('roll')) { shotsDone.add('roll'); await snap(p, 'roll'); }
        if (real) { await p.click('[data-act=roll]'); stats.real++; } else await p.evaluate(() => document.querySelector('[data-act=roll]').click());
        await p.waitForFunction(() => !document.querySelector('[data-act=roll]'), null, { timeout: 8000 });
      } else if (st === 'pick') {
        if (real) {
          const picks = await p.$$('[data-act=pick]');
          const el = picks[Math.floor(rnd() * picks.length)];
          await el.click(); stats.real++;
          // ausgewählte Figur und mindestens ein Zielfeld müssen im sichtbaren Ausschnitt liegen
          const vis = await p.evaluate(() => {
            const sc = document.getElementById('bk-scroll').getBoundingClientRect();
            const inside = (e) => { const r = e.getBoundingClientRect(); return r.left >= sc.left - 1 && r.right <= sc.right + 1 && r.top >= sc.top - 1 && r.bottom <= sc.bottom + 1; };
            const dests = [...document.querySelectorAll('[data-act=dest]')];
            const sel = document.querySelector('.bk-piece[data-act=pick] circle[stroke="#111"]');
            return { dests: dests.length, anyDest: dests.some(inside), sel: sel ? inside(sel.closest('g')) : null };
          });
          if (!vis.dests) throw new Error('Keine Zielfelder nach Auswahl');
          if (!vis.anyDest || vis.sel === false) throw new Error('Auswahl nicht im Ausschnitt ' + JSON.stringify(vis));
          stats.scrollChecks++;
          if (!shotsDone.has('sel')) { shotsDone.add('sel'); await snap(p, 'select'); }
          // abwählen und wieder wählen (nochmaliges Antippen hebt die Auswahl auf)
          await p.click('[data-act=pick][data-piece="' + (await el.getAttribute('data-piece')) + '"]');
          if (await p.$('[data-act=dest]')) throw new Error('Abwählen hat nicht funktioniert');
          await p.click('[data-act=pick][data-piece="' + (await el.getAttribute('data-piece')) + '"]');
          const dests = await p.$$('[data-act=dest]');
          const d = dests[Math.floor(rnd() * dests.length)];
          await d.click(); stats.real++;
        } else {
          const kind = await botMove(p);
          if (kind === 'cap') stats.captures++;
        }
        await p.waitForFunction(() => !document.querySelector('[data-act=pick]'), null, { timeout: 8000 });
      } else if (st === 'place') {
        stats.places++;
        if (!shotsDone.has('place')) { shotsDone.add('place'); await snap(p, 'place'); }
        const nodes = await p.$$eval('[data-act=place]', (els) => els.map((e) => e.dataset.node));
        if (nodes.some((x) => x.startsWith('12_') || x === 'Z')) throw new Error('Sperre dürfte nicht in die unterste Reihe/aufs Ziel');
        const node = nodes[Math.floor(rnd() * nodes.length)];
        if (real) { await p.click(`[data-act=place][data-node="${node}"]`); stats.real++; }
        else await p.evaluate((nd) => document.querySelector(`[data-act=place][data-node="${nd}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), node);
        await p.waitForFunction(() => !document.querySelector('[data-act=place]'), null, { timeout: 8000 });
      }
      if (real) realLeft.set(p, realLeft.get(p) - 1);
      acted = true;
      break;
    }
    if (!acted) await sleep(15);
    // Pass-Hinweise zählen
    if (guard % 25 === 0) {
      const t = await A.evaluate(() => document.querySelector('.recap')?.textContent || '');
      if (/kann aber nicht ziehen/.test(t)) stats.passes++;
    }
    // Zoom-Knöpfe einmal prüfen
    if (stats.turns === 6 && !shotsDone.has('zoom')) {
      shotsDone.add('zoom');
      const w0 = await A.evaluate(() => document.querySelector('.bk-board').getBoundingClientRect().width);
      await A.click('[data-act=zoom-in]');
      const w1 = await A.evaluate(() => document.querySelector('.bk-board').getBoundingClientRect().width);
      await A.click('[data-act=zoom-out]'); await A.click('[data-act=zoom-out]');
      const w2 = await A.evaluate(() => document.querySelector('.bk-board').getBoundingClientRect().width);
      await A.click('[data-act=zoom-fit]');
      const fit = await A.evaluate(() => ({ b: document.querySelector('.bk-board').getBoundingClientRect().width, c: document.getElementById('bk-scroll').clientWidth, sw: document.getElementById('bk-scroll').scrollWidth }));
      if (!(w1 > w0 && w2 < w0 && Math.abs(fit.b - fit.c) < 6 && fit.sw <= fit.c + 2)) throw new Error('Zoom-Knöpfe falsch ' + JSON.stringify({ w0, w1, w2, fit }));
      await snap(A, 'fit');
      await A.click('[data-act=zoom-in]'); // zurück auf einen festen Zoom
      await A.click('[data-act=zoom-in]');
      await A.click('[data-act=zoom-in]');
    }
  }
  if (!over) throw new Error('Spiel nicht beendet');

  // Siegerbildschirm auf allen Seiten
  for (const p of pages) await p.waitForSelector('.trophy');
  const winners = await Promise.all(pages.map((p) => p.textContent('.over h1')));
  if (new Set(winners).size !== 1) throw new Error('Gewinner uneinig: ' + winners.join(' | '));
  await snap(A, 'over');
  if (n > 2) await snap(pages[1], 'over_guest');
  const hostAgain = await A.$('[data-act=again]');
  const guestAgain = await pages[1].$('[data-act=again]');
  if (!hostAgain || guestAgain) throw new Error('Neustart-Knopf nur für den Gastgeber erwartet');
  console.log(`${tag}: Ende nach ${stats.turns} Würfen in ${Math.round((Date.now() - t0) / 1000)} s – ${winners[0].trim()} | Sperren versetzt: ${stats.places}, echte Klicks: ${stats.real}, Ausschnitt-Prüfungen: ${stats.scrollChecks}`);

  // Neustart
  await A.click('[data-act=again]');
  for (const p of pages) await p.waitForSelector('.bk-board');
  await sleep(200);
  const states = await Promise.all(pages.map((p) => p.evaluate(classify)));
  if (states.filter((s) => s === 'roll').length !== 1 || states.some((s) => s === 'over')) throw new Error('Neustart fehlgeschlagen: ' + states.join(','));
  const setup2 = await A.evaluate(() => ({ pieces: document.querySelectorAll('.bk-piece').length, barriers: document.querySelectorAll('.bk-barrier').length }));
  if (setup2.barriers !== 11) throw new Error('Neustart: Sperren ' + setup2.barriers);
  console.log(`${tag}: Neustart ok`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const n of COUNTS) await playGame(browser, n, n === 4 ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    console.log('errors', errors);
    console.log(errors.length ? 'FEHLER' : 'ALLES OK – Spiele bis zum Siegerbildschirm durchgespielt');
    process.exitCode = errors.length ? 1 : 0;
  } catch (e) {
    console.log('errors', errors);
    console.error('TEST FEHLGESCHLAGEN:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
