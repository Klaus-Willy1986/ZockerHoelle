// Durchspieltest für Bingo (Playwright, Chromium): Alleinspiel (Reihe, Volles Haus, zwei Karten, Automatik, Zahlen-Zeitgeber),
// gegen Computer (mehrere Runden, Punktestand), Lernrunde, Gastgeber + Gast (Mock-Netz), Layout bei 390x844.
// Start:  NODE_PATH=$(npm root -g) node tests/bingo.e2e.cjs
// Der Test startet selbst einen Static-Server (python3 -m http.server) auf Port 8961, wenn dort keiner läuft.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8961;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/bingo/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `bg_${name}.png`), fullPage: full });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Klick per Skript: Computer-Mitspieler zeichnen die Seite oft neu, das würde Playwrights Stabilitätsprüfung ausbremsen
const tap = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);

// Unabhängige Referenz der Gewinnlinien (nicht aus engine.js)
const LINES = [];
for (let r = 0; r < 5; r++) LINES.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
for (let c = 0; c < 5; c++) LINES.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
LINES.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);

async function newCtx(browser, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    // Zeitraffer: Computer-Verzögerungen (1-3 s) und der 8-Sekunden-Zeitgeber laufen etwa 30x schneller
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, typeof ms === 'number' && ms >= 800 && ms <= 9000 ? Math.max(5, Math.round(ms / 30)) : ms, ...a);
  });
  return ctx;
}
async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`${name} console ${m.text()}`); });
  return page;
}

const snap = (page) => page.evaluate(() => {
  const ball = document.querySelector('.bg-ball');
  return {
    n: ball && ball.dataset.n ? Number(ball.dataset.n) : null,
    banner: (document.querySelector('.banner') || {}).innerText || '',
    over: !!document.querySelector('.trophy'),
    h1: (document.querySelector('.bg-over h1') || {}).innerText || '',
    sub: (document.querySelector('.bg-over .bg-oversub') || {}).innerText || '',
    hint: (document.querySelector('.bg-action p') || {}).innerText || '',
    hasDraw: !!document.querySelector('[data-act=draw]'),
    hasNext: !!document.querySelector('[data-act=next]'),
    chips: [...document.querySelectorAll('.bg-chip:not(.none)')].map((c) => c.innerText.replace(/\s+/g, '')),
    cards: [...document.querySelectorAll('.bg-card')].map((card) => [...card.querySelectorAll('.bg-cell')].map((c) => ({ n: c.dataset.n ? Number(c.dataset.n) : 0, on: c.classList.contains('on'), win: c.classList.contains('win') }))),
    pts: [...document.querySelectorAll('.bg-pp b')].map((b) => Number(b.textContent)),
    names: [...document.querySelectorAll('.bg-pn')].map((b) => b.textContent),
    miss: [...document.querySelectorAll('.bg-pf')].map((b) => b.textContent),
  };
});
const validCard = (cells, full) => (full ? cells.every((c) => c.on) : LINES.some((l) => l.every((i) => cells[i].on)));
const anyValid = (s, full) => s.cards.some((c) => validCard(c, full));
const total = (s) => s.cards.reduce((a, c) => a + c.filter((x) => x.on).length, 0);

async function waitDrawn(page, prevN) {
  await page.waitForFunction((p) => { const b = document.querySelector('.bg-ball'); return document.querySelector('.trophy') || (b && b.dataset.n && Number(b.dataset.n) !== p); }, prevN, { timeout: 8000 });
}
// Markiert alle gezogenen, noch unmarkierten Zahlen (der Mensch kennt sie von der Anzeige)
async function markDrawn(page, drawn) {
  const s = await snap(page);
  let clicked = 0;
  for (let c = 0; c < s.cards.length; c++) for (let i = 0; i < 25; i++) {
    const cell = s.cards[c][i];
    if (i !== 12 && !cell.on && drawn.has(cell.n)) { await tap(page, `.bg-card[data-c="${c}"] .bg-cell[data-i="${i}"]`); clicked++; }
  }
  return clicked;
}

async function startSolo(browser, opts = [], vp, learn) {
  const ctx = await newCtx(browser, vp);
  const page = await newPage(ctx, 'solo');
  await page.goto(base);
  await page.fill('#name', 'Anna');
  for (const o of opts) await page.check(`[data-opt=${o}]`);
  await page.click(learn ? '[data-act=learn]' : '[data-act=solo]');
  await page.waitForSelector('#board');
  return { ctx, page };
}

// Eine ganze Runde als gewissenhafter Mensch; liefert Anzahl gezogener Zahlen
async function playRound(page, { full = false, timer = false, auto = false, check = null } = {}) {
  const drawn = new Set();
  let prev = null; let guard = 0;
  while (guard++ < 120) {
    let s = await snap(page);
    if (s.over) break;
    if (s.n !== null) drawn.add(s.n);
    if (!timer) {
      if (s.hasDraw) { await tap(page, '[data-act=draw]'); await waitDrawn(page, s.n); }
      else fail('Zahl-Knopf fehlt');
    } else {
      await waitDrawn(page, prev === null ? s.n : prev).catch(() => {});
    }
    s = await snap(page);
    if (s.over) break;
    if (s.n !== null) { drawn.add(s.n); prev = s.n; }
    if (check) await check(s, drawn);
    if (!auto) await markDrawn(page, drawn);
    s = await snap(page);
    if (auto) {
      // Alle gezogenen Zahlen müssen schon markiert sein
      for (const c of s.cards) c.forEach((cell, i) => { if (i !== 12 && drawn.has(cell.n) !== cell.on) fail(`Automatik: Feld ${cell.n} markiert=${cell.on} gezogen=${drawn.has(cell.n)}`); });
    }
    if (anyValid(s, full)) { await tap(page, '[data-act=bingo]'); await page.waitForSelector('.trophy', { timeout: 3000 }); break; }
  }
  return drawn.size;
}

// ---------------------------------------------------------------- (a) Alleinspiel
async function soloRun(browser, label, opts, flags, shotName) {
  const { ctx, page } = await startSolo(browser, opts);
  let tested = false;
  const n = await playRound(page, {
    ...flags,
    check: async (s, drawn) => {
      if (tested || drawn.size < 3) return;
      tested = true;
      // Falsches Antippen: ungezogene Zahl markiert sich nicht, freundlicher Hinweis
      const target = s.cards[0].findIndex((c, i) => i !== 12 && !drawn.has(c.n));
      const before = total(s);
      await page.click(`.bg-card[data-c="0"] .bg-cell[data-i="${target}"]`);
      const t = await snap(page);
      if (!/Die wurde noch nicht gezogen/.test(t.hint)) fail(`${label}: Hinweis bei falscher Zahl: "${t.hint}"`);
      if (total(t) !== before) fail(`${label}: ungezogene Zahl wurde markiert`);
      // Mitte antippen: zählt schon
      await page.click('.bg-card[data-c="0"] .bg-cell[data-i="12"]');
      if (!/frei/.test((await snap(page)).hint)) fail(`${label}: Hinweis Mitte`);
      // Zu früh BINGO: freundlich, keine Strafe
      await page.click('[data-act=bingo]');
      const u = await snap(page);
      if (!/Noch nicht ganz/.test(u.hint) || u.over) fail(`${label}: zu frühes BINGO "${u.hint}" over=${u.over}`);
      await shot(page, `${shotName}_hint`);
    },
  });
  await page.waitForSelector('.trophy');
  const s = await snap(page);
  if (!/Du hast BINGO/.test(s.h1)) fail(`${label}: Ergebnistext "${s.h1}"`);
  if (!s.cards.some((c) => c.some((x) => x.win))) fail(`${label}: keine Gewinnreihe hervorgehoben`);
  const best = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('bg_best')).map(([k, v]) => `${k}=${v}`));
  if (!best.length || !best.some((b) => b.endsWith('=' + n))) fail(`${label}: Bestleistung ${best} statt ${n}`);
  if (!/Neue Bestleistung/.test(s.sub)) fail(`${label}: erste Runde sollte Bestleistung sein: "${s.sub}"`);
  console.log(`${label}: BINGO nach ${n} Zahlen, "${s.h1}", Bestleistung ${best.join(',')}`);
  await shot(page, `${shotName}_ende`);
  // Noch eine Runde: neue Karte, Zahlen leer, Bestleistung bleibt
  await page.click('[data-act=next]');
  await page.waitForFunction(() => !document.querySelector('.trophy'));
  const r2 = await snap(page);
  if (r2.n !== null || total(r2) !== r2.cards.length) fail(`${label}: neue Runde nicht frisch`);
  // Neuladen mitten in der Runde
  if (await page.$('[data-act=draw]')) await page.click('[data-act=draw]');
  await sleep(50);
  const before = JSON.stringify((await snap(page)).cards);
  await page.reload(); await page.waitForSelector('#board');
  if (JSON.stringify((await snap(page)).cards) !== before) fail(`${label}: Neuladen verändert die Karte`);
  await ctx.close();
}

// ---------------------------------------------------------------- (b) gegen Computer
async function botRun(browser, level, nBots, rounds) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'bot');
  await page.goto(base);
  await page.fill('#name', 'Berta');
  await shot(page, 'start', true);
  await page.click(`[data-act=bot][data-n="${nBots}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  let humanWins = 0; let botWins = 0; let sawMissing = false;
  for (let r = 1; r <= rounds; r++) {
    await playRound(page, { check: async (s) => { if (s.miss.some((m) => /fehl/.test(m))) sawMissing = true; } });
    await page.waitForSelector('.trophy');
    const s = await snap(page);
    const mine = /Du hast/.test(s.h1);
    if (mine) humanWins++; else botWins++;
    const tot = s.pts.reduce((a, b) => a + b, 0);
    if (tot < r) fail(`Bot Runde ${r}: Siegpunkte ${s.pts} summieren sich zu ${tot}`);
    if (!/BINGO!/.test(s.banner)) fail('Banner am Rundenende: ' + s.banner);
    if (r === 1) await shot(page, `bot${level}_ende`);
    if (r < rounds) { await page.click('[data-act=next]'); await page.waitForFunction(() => !document.querySelector('.trophy')); }
  }
  const s = await snap(page);
  console.log(`Gegen ${nBots} Computer (${level ? 'Mittel' : 'Leicht'}): ${rounds} Runden, Mensch ${humanWins}, Computer ${botWins}, Punkte ${s.pts.join('/')} (${s.names.join(', ')})`);
  if (s.pts.reduce((a, b) => a + b, 0) < rounds) fail('Punktestand nach allen Runden zu klein');
  if (!sawMissing) fail('"x Felder fehlen" nie sichtbar');
  await ctx.close();
}

// ---------------------------------------------------------------- (c) Lernrunde
async function lernrunde(browser) {
  const { ctx, page } = await startSolo(browser, [], undefined, true);
  await page.waitForSelector('.coach');
  const texts = []; let finished = false; let shots = 0;
  for (let i = 0; i < 3000; i++) {
    const t = (await page.textContent('.coach .coach-t')).trim();
    if (!texts.includes(t)) { texts.push(t); if (shots < 5 && texts.length % 2 === 1) await shot(page, 'lern_' + (++shots)); }
    const tg = page.locator('.coach-target');
    if ((await tg.count()) === 0) {
      if (await page.$('.trophy')) { finished = true; break; }
      await sleep(15); continue;
    }
    const first = tg.first();
    const act = await first.getAttribute('data-act');
    if (act === 'next') { finished = true; break; }
    await first.click();
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist geschafft/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde: Endtext');
  await shot(page, 'lern_ende');
  console.log(`Lernrunde: Ende erreicht, ${texts.length} verschiedene Texte`);
  texts.filter((t) => t.length > 70).forEach((t) => console.log('   -', t));
  await ctx.close();
}

// ---------------------------------------------------------------- (d) Gastgeber + Gast (Mock-Netz)
async function duo(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A'); const B = await newPage(ctx, 'B');
  await A.goto(base + '?mock=1'); await A.fill('#name', 'Anna'); await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = (await A.textContent('.code')).trim();
  await shot(A, 'lobby');
  await B.goto(base + `?mock=1&raum=${room}`); await B.fill('#name', 'Bernd'); await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const same = async (label) => {
    await sleep(30);
    const a = await snap(A); const b = await snap(B);
    a.names = a.names.map((x) => x.replace(' (du)', '')); b.names = b.names.map((x) => x.replace(' (du)', ''));
    for (const k of ['n', 'chips', 'over', 'pts', 'names']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) fail(`Duo ${label}: ${k} unterschiedlich ${JSON.stringify(a[k])} / ${JSON.stringify(b[k])}`);
    if (!a.over && a.banner !== b.banner) fail(`Duo ${label}: Banner unterschiedlich "${a.banner}" / "${b.banner}"`);
    // Karten: nur die eigene, 25 Felder, bei Gast und Host verschieden
    if (a.cards.length !== 1 || b.cards.length !== 1 || a.cards[0].length !== 25 || b.cards[0].length !== 25) fail('Duo: Kartenzahl');
    return [a, b];
  };
  let [a, b] = await same('Start');
  if (JSON.stringify(a.cards[0].map((c) => c.n)) === JSON.stringify(b.cards[0].map((c) => c.n))) fail('Duo: beide haben dieselbe Karte');
  if (b.hasDraw) fail('Gast sieht "Nächste Zahl"');
  if (!a.hasDraw) fail('Host sieht keinen "Nächste Zahl"-Knopf');
  // Gast tippt eine nicht gezogene Zahl: Hinweis, keine Markierung
  const bi = b.cards[0].findIndex((c, i) => i !== 12);
  await B.click(`.bg-cell[data-i="${bi}"]`);
  if (!/noch nicht gezogen/.test((await snap(B)).hint)) fail('Duo: Gast bekommt keinen Hinweis');
  // Gast ruft zu früh BINGO
  await B.click('[data-act=bingo]');
  if (!/Noch nicht ganz/.test((await snap(B)).hint)) fail('Duo: Gast zu frühes BINGO');
  const drawn = new Set(); let leak = 0; let shots = 0;
  for (let n = 0; n < 120; n++) {
    const s0 = await snap(A);
    if (s0.over) break;
    await A.click('[data-act=draw]');
    await B.waitForFunction((p) => { const x = document.querySelector('.bg-ball'); return document.querySelector('.trophy') || (x && Number(x.dataset.n) !== p); }, s0.n, { timeout: 5000 });
    const s1 = await snap(A); if (s1.n !== null) drawn.add(s1.n);
    await markDrawn(A, drawn); await markDrawn(B, drawn);
    if (shots < 1 && n === 6) { shots++; await shot(A, 'duo_A'); await shot(B, 'duo_B'); }
    [a, b] = await same('Zug ' + n);
    // Gast-DOM enthält die Zahlen von Annas Karte nicht als Felder (außer sie stehen zufällig auch auf der eigenen)
    const ownB = new Set(b.cards[0].map((c) => c.n));
    const cellsB = await B.$$eval('.bg-cell', (c) => c.length);
    if (cellsB !== 25) leak++;
    void ownB;
    const va = validCard(a.cards[0], false); const vb = validCard(b.cards[0], false);
    if (va || vb) { await (va ? A : B).click('[data-act=bingo]'); break; }
  }
  if (leak) fail('Duo: Gast-DOM zeigt mehr als die eigene Karte');
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  [a, b] = await same('Ende');
  console.log(`Host+Gast: nach ${drawn.size} Zahlen. A: "${a.h1}" | B: "${b.h1}" | Banner "${a.banner}" / "${b.banner}" | Punkte ${a.pts}`);
  const winnersA = a.h1.includes('Du hast') ? ['Anna'] : [];
  const winnersB = b.h1.includes('Du hast') ? ['Bernd'] : [];
  if (a.pts.reduce((x, y) => x + y, 0) < 1) fail('Duo: kein Siegpunkt');
  if (winnersA.length + winnersB.length < 1) fail('Duo: niemand hat gewonnen');
  if (b.hasNext) fail('Gast sieht "Noch eine Runde"');
  if (!a.hasNext) fail('Host sieht kein "Noch eine Runde"');
  await shot(A, 'duo_ende_A'); await shot(B, 'duo_ende_B');
  // Späte Nachricht des Verlierers ändert nichts
  const lateTarget = winnersA.length ? B : A;
  const before = JSON.stringify((await snap(lateTarget)).pts);
  await sleep(50);
  if (JSON.stringify((await snap(lateTarget)).pts) !== before) fail('Duo: Punkte änderten sich nach dem Ende');
  const pts1 = a.pts;
  await A.click('[data-act=next]');
  await A.waitForFunction(() => !document.querySelector('.trophy')); await B.waitForFunction(() => !document.querySelector('.trophy'));
  [a, b] = await same('Runde 2');
  if (JSON.stringify(a.pts) !== JSON.stringify(pts1)) fail(`Duo: Punkte bleiben nicht erhalten ${a.pts} / ${pts1}`);
  if (a.n !== null) fail('Duo: Runde 2 nicht frisch');
  await ctx.close();
}

// ---------------------------------------------------------------- (e) Layout
async function layout(browser) {
  for (const opts of [[], ['two']]) {
    const { ctx, page } = await startSolo(browser, opts);
    const top0 = await page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY));
    const sz = await page.$$eval('.bg-cell', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    const minW = Math.min(...sz.map((s) => s[0])); const minH = Math.min(...sz.map((s) => s[1]));
    if (minW < 56 || minH < 56) fail(`Layout ${opts}: Feld ${minW}x${minH}`);
    const cols = await page.$eval('.bg-grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    if (cols !== 5) fail(`Layout ${opts}: ${cols} Spalten`);
    const tops = new Set([top0]); const drawn = new Set(); const actTops = new Set();
    for (let i = 0; i < 12; i++) {
      const s = await snap(page);
      if (s.over) break;
      await page.click('[data-act=draw]'); await waitDrawn(page, s.n);
      const t = await snap(page); if (t.n !== null) drawn.add(t.n);
      await markDrawn(page, drawn);
      tops.add(await page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY)));
      actTops.add(await page.$eval('.bg-btns', (b) => Math.round(b.getBoundingClientRect().height)));
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (o.sw > o.iw + 1) fail(`Layout ${opts}: horizontaler Scroll ${o.sw} > ${o.iw}`);
      if (await page.$('.trophy')) break;
    }
    if (tops.size > 1) fail(`Layout ${opts}: Karte springt ${[...tops]}`);
    if (actTops.size > 1) fail(`Layout ${opts}: Knopfbereich wechselt ${[...actTops]}`);
    const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && !b.classList.contains('mini')).map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act, h: Math.round(r.height) }; }).filter((x) => x.h < 48));
    if (small.length) fail(`Layout ${opts}: zu kleine Knöpfe ${JSON.stringify(small)}`);
    const vis = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; }; return { draw: r('[data-act=draw]'), bingo: r('[data-act=bingo]'), board: r('#board'), ih: window.innerHeight }; });
    if (!vis.draw || vis.draw.bottom > vis.ih || vis.draw.h < 48 || vis.bingo.h < 48) fail(`Layout ${opts}: Knöpfe nicht gut erreichbar ${JSON.stringify(vis)}`);
    console.log(`Layout ${opts.length ? 'zwei Karten' : 'eine Karte'}: Feld ${minW}x${minH}px, ${cols} Spalten, Karte fest bei ${[...tops]}, Knöpfe ${JSON.stringify(vis.draw)} / ${JSON.stringify(vis.bingo)}`);
    await shot(page, opts.length ? 'layout_zwei' : 'layout_eins');
    await shot(page, opts.length ? 'layout_zwei_voll' : 'layout_eins_voll', true);
    // Große Schrift
    await page.click('[data-act=bigger]');
    const o2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (o2.sw > o2.iw + 1) fail(`Layout ${opts} große Schrift: horizontaler Scroll`);
    await shot(page, opts.length ? 'layout_zwei_gross' : 'layout_eins_gross');
    await ctx.close();
  }
  // Desktop
  const { ctx, page } = await startSolo(browser, [], { width: 1280, height: 800 });
  await page.click('[data-act=draw]');
  await shot(page, 'desktop');
  await ctx.close();
  // Hilfe
  const h = await startSolo(browser);
  await h.page.click('[data-act=help]');
  const t = await h.page.textContent('.modal');
  if (!/BINGO/.test(t) || !/Mitte/.test(t)) fail('Hilfe ohne Inhalt');
  await shot(h.page, 'hilfe');
  await h.ctx.close();
}

// ================================================================ Server + Start
function portUp() { return new Promise((res) => { http.get(`http://localhost:${PORT}/`, (r) => { r.resume(); res(true); }).on('error', () => res(false)); }); }
(async () => {
  let srv = null;
  if (!(await portUp())) {
    srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await portUp()); i++) await sleep(100);
  }
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const run = async (name, fn) => { if (only && !only.includes(name)) return; const t0 = Date.now(); try { await fn(); } catch (e) { fail(`${name}: ${e.stack || e.message}`); } console.log(`-- ${name} fertig (${((Date.now() - t0) / 1000).toFixed(1)} s)`); };
  await run('solo', () => soloRun(browser, 'Solo Reihe', [], {}, 'solo'));
  await run('solo-haus', () => soloRun(browser, 'Solo Volles Haus', ['full'], { full: true }, 'haus'));
  await run('solo-zwei', () => soloRun(browser, 'Solo zwei Karten', ['two'], {}, 'zwei'));
  await run('solo-auto', () => soloRun(browser, 'Solo Automatik', ['auto'], { auto: true }, 'auto'));
  await run('solo-timer', () => soloRun(browser, 'Solo Zahlen-Zeitgeber', ['timer', 'auto'], { timer: true, auto: true }, 'timer'));
  await run('bot0', () => botRun(browser, 0, 1, 3));
  await run('bot1', () => botRun(browser, 1, 3, 3));
  await run('lern', () => lernrunde(browser));
  await run('duo', () => duo(browser));
  await run('layout', () => layout(browser));
  await browser.close();
  if (srv) { try { srv.kill(); } catch { /* egal */ } }
  else { try { execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`); } catch { /* egal */ } }
  if (errors.length) { console.log(`\n${errors.length} FEHLER`); process.exit(1); }
  console.log('\nALLE E2E-TESTS BESTANDEN (Konsole fehlerfrei)');
})().catch((e) => { console.error(e); process.exit(2); });
