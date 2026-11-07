// Durchspieltest für Paare finden: Alleinspiel (alle Größen), gegen den Computer, Lernrunde, Host + Gast (Mock), Layout.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8881 &
//        NODE_PATH=$(npm root -g) node tests/memo.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8881;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'memo-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/memo/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };

async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`${name} console ${m.text()}`); });
  return page;
}
async function newCtx(browser, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms === 1500 ? 40 : ms, ...a);
  });
  return ctx;
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `pf_${name}.png`), fullPage: full });

const read = (page) => page.evaluate(() => ({
  cards: [...document.querySelectorAll('.pf-card')].map((c) => ({
    cls: c.classList.contains('down') ? 'down' : c.classList.contains('up') ? 'up' : 'gone',
    back: c.classList.contains('a-back'),
    e: (c.querySelector('.pf-front .pf-emoji') || {}).textContent || null,
  })),
  weiter: !!document.querySelector('[data-act=weiter]'),
  over: !!document.querySelector('.trophy'),
  mine: !!document.querySelector('.banner.mine'),
}));

// Ein Zug des "Menschen": merkt sich Gesehenes (nur aus dem DOM) und spielt vernünftig
async function step(page, mem) {
  const s = await read(page);
  if (s.over) return 'over';
  s.cards.forEach((c, i) => { if (c.cls === 'gone') delete mem[i]; else if (c.e) mem[i] = c.e; });
  if (!s.mine) return 'wait';
  if (s.weiter) { await page.click('[data-act=weiter]'); return 'weiter'; }
  const up = s.cards.map((c, i) => (c.cls === 'up' ? i : -1)).filter((i) => i >= 0);
  const down = s.cards.map((c, i) => (c.cls === 'down' ? i : -1)).filter((i) => i >= 0);
  let t = null;
  if (up.length === 1) {
    t = down.find((i) => mem[i] && mem[i] === mem[up[0]]);
    if (t === undefined) t = down.find((i) => !mem[i]);
  } else {
    for (const i of down) if (mem[i] && down.some((j) => j !== i && mem[j] === mem[i])) { t = i; break; }
    if (t === null) t = down.find((i) => !mem[i]);
  }
  if (t === undefined || t === null) t = down[0];
  await page.click(`.pf-card[data-i="${t}"]`);
  return 'flip';
}
async function playOut(page, mem, limit = 2000) {
  for (let n = 0; n < limit; n++) {
    const r = await step(page, mem);
    if (r === 'over') return n;
    if (r === 'wait') await page.waitForTimeout(25);
  }
  throw new Error('Partie nicht beendet');
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
};
const boardTop = (page) => page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY));
async function cardSizes(page) {
  return page.$$eval('.pf-card', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
}
async function startSolo(browser, opts = [], vp) {
  const ctx = await newCtx(browser, vp);
  const page = await newPage(ctx, 'solo');
  await page.goto(base);
  await page.fill('#name', 'Anna');
  for (const o of opts) { if (o.startsWith('-')) await page.uncheck(`[data-opt=${o.slice(1)}]`); else await page.check(`[data-opt=${o}]`); }
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  return { ctx, page };
}

// ---------------------------------------------------------------- (a) Alleinspiel
async function soloSize(browser, size, opt, cols, rows, full) {
  const { ctx, page } = await startSolo(browser, opt ? [opt] : []);
  const n = cols * rows;
  const cards = await page.$$('.pf-card');
  if (cards.length !== n) fail(`${size}: ${cards.length} Karten statt ${n}`);
  const gridCols = await page.$eval('#board', (b) => getComputedStyle(b).gridTemplateColumns.split(' ').length);
  if (gridCols !== cols) fail(`${size}: ${gridCols} Spalten statt ${cols}`);
  // Verdeckte Karten verraten kein Bild
  const leak = await page.$$eval('.pf-card.down .pf-front', (e) => e.length);
  if (leak) fail(`${size}: verdeckte Karten mit Bild im DOM`);
  const sizes = await cardSizes(page);
  if (sizes.some(([w, h]) => w < 56 || h < 56)) fail(`${size}: Karten kleiner als 56px ${JSON.stringify(sizes[0])}`);
  console.log(`${size}: ${n} Karten, ${gridCols} Spalten, Karte ${sizes[0].join('x')}px`);
  await noOverflow(page, size);
  const top0 = await boardTop(page);
  const mem = {};
  let steps = 0;
  const tops = new Set([top0]);
  const limit = full ? 2000 : 14;
  for (; steps < limit; steps++) {
    const r = await step(page, mem);
    if (r !== 'over' && !(await page.$('.trophy'))) tops.add(await boardTop(page));
    if (steps === 3 && size === 'mittel') await shot(page, 'solo_mittel_mitte');
    if (r === 'over') break;
    if (r === 'wait') await page.waitForTimeout(20);
  }
  if (tops.size > 1) fail(`${size}: Raster springt ${[...tops]}`);
  await noOverflow(page, size + ' im Spiel');
  if (!full) { await shot(page, `solo_${size}`); await ctx.close(); return; }
  await page.waitForSelector('.trophy');
  const h1 = (await page.textContent('.over h1')).trim();
  if (!/Geschafft/.test(h1)) fail(`${size}: Ergebnistext ${h1}`);
  const tries = await page.evaluate(() => Number((document.querySelector('.pf-result .big b') || {}).textContent.split(' ')[0]));
  const best = await page.evaluate((k) => localStorage.getItem('zh.pf_best_' + k), size);
  if (best === null || Number(best) !== tries) fail(`${size}: Bestleistung ${best} statt ${tries}`);
  const allGone = (await read(page)).cards.every((c) => c.cls === 'gone');
  if (!allGone) fail(`${size}: am Ende nicht alle Karten gefunden`);
  if (!/Neue Bestleistung/.test(await page.textContent('.pf-result'))) fail(`${size}: erste Runde sollte Bestleistung sein`);
  console.log(`${size}: komplett gespielt, ${tries} Versuche, Bestleistung gespeichert (${best})`);
  await shot(page, `solo_${size}_ende`, true);
  if (await page.$('.confetti') === null) { /* Konfetti ist nur kurz da; Bewegung kann reduziert sein */ }
  // Noch eine Runde: neues Brett, Bestleistung zeigt sich im Spiel
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  if ((await read(page)).cards.some((c) => c.cls !== 'down')) fail(`${size}: neue Runde nicht frisch`);
  const bt = await page.textContent('.pf-best');
  if (!new RegExp(`Bestleistung: ${best} Versuch`).test(bt)) fail(`${size}: Bestleistung-Anzeige "${bt}"`);
  // Neuladen mitten im Spiel
  const m2 = {};
  for (let i = 0; i < 4; i++) await step(page, m2);
  const before = JSON.stringify((await read(page)).cards.map((c) => c.cls));
  await page.reload(); await page.waitForSelector('#board');
  const after = JSON.stringify((await read(page)).cards.map((c) => c.cls));
  if (before !== after) fail(`${size}: Neuladen verändert das Spiel`);
  await ctx.close();
}

async function soloAuto(browser) {
  // Option "Karten bleiben aufgedeckt" aus: dreht sich von selbst um
  const { ctx, page } = await startSolo(browser, ['-hold', 'klein']);
  const mem = {};
  let sawWeiter = false;
  for (let n = 0; n < 400; n++) {
    const s = await read(page);
    if (s.weiter) sawWeiter = true;
    const r = s.cards.filter((c) => c.cls === 'up').length === 2 ? null : await step(page, mem);
    if (r === 'over') break;
    await page.waitForTimeout(15);
    if ((await read(page)).over) break;
  }
  await page.waitForSelector('.trophy', { timeout: 10000 });
  console.log('Karten drehen sich ohne "Weiter" von selbst um: ok');
  await ctx.close();
}

// ---------------------------------------------------------------- (b) gegen den Computer
async function botGame(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'bot');
  await page.goto(base);
  await page.fill('#name', 'Berta');
  await shot(page, 'start', true);
  await page.click('[data-act=bot][data-n="1"][data-level="1"]');
  await page.waitForSelector('#board');
  const mem = {}; let shots = 0; let sawBotTurn = false;
  for (let n = 0; n < 3000; n++) {
    const r = await step(page, mem);
    if (r === 'over') break;
    if (r === 'wait') { sawBotTurn = true; if (shots === 0 && /Computer/.test(await page.textContent('.banner'))) { shots++; await shot(page, 'bot_computer'); } await page.waitForTimeout(25); }
  }
  await page.waitForSelector('.trophy');
  const rows = await page.$$eval('.ranking li', (l) => l.map((x) => x.textContent));
  const sum = rows.map((t) => Number((/(\d+) Paar/.exec(t) || [0, 0])[1])).reduce((a, b) => a + b, 0);
  if (sum !== 8) fail('Computerspiel: Paare ergeben ' + sum);
  if (!sawBotTurn) fail('Computer war nie dran');
  console.log('Gegen Computer (Mittel):', rows.join(' | '));
  await shot(page, 'bot_ende', true);
  await ctx.close();
}

// ---------------------------------------------------------------- (c) Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const n = (await page.$$('.pf-card')).length;
  if (n !== 12) fail('Lernrunde: ' + n + ' Karten statt 12');
  const texts = []; let finished = false; let shots = 0;
  for (let i = 0; i < 4000; i++) {
    const t = (await page.textContent('.coach .coach-t')).trim();
    if (!texts.includes(t)) { texts.push(t); if (shots < 4 && texts.length % 2 === 1) await shot(page, 'lern_' + (++shots)); }
    const tg = page.locator('.coach-target');
    if ((await tg.count()) === 0) { await page.waitForTimeout(15); continue; }
    const first = tg.first();
    const id = await first.getAttribute('id');
    const act = await first.getAttribute('data-act');
    if (act === 'again') { finished = true; break; }
    if (id === 'board') { const c = page.locator('.pf-card.down').first(); await c.click(); } else await first.click();
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde: Endtext');
  await shot(page, 'lern_ende');
  console.log(`Lernrunde: Ende erreicht, ${texts.length} verschiedene Texte`);
  texts.filter((t) => t.length > 70).forEach((t) => console.log('   -', t));
  await ctx.close();
}

// ---------------------------------------------------------------- (d) Host + Gast
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
  const memA = {}; const memB = {};
  let leak = 0; let moves = 0;
  for (let n = 0; n < 4000; n++) {
    // Gast sieht verdeckte Karten nie im DOM (außer kurz beim Zurückdrehen einer schon gesehenen Karte)
    for (const P of [A, B]) {
      const bad = await P.$$eval('.pf-card.down:not(.a-back)', (cs) => cs.filter((c) => c.querySelector('.pf-front') || /[^\x00-\x7F]/.test(c.textContent) || /<span class="pf-emoji/.test(c.innerHTML)).length);
      leak += bad;
    }
    const ra = await step(A, memA); const rb = await step(B, memB);
    if (ra === 'flip' || rb === 'flip') moves++;
    if (n === 5) { await shot(A, 'duo_A'); await shot(B, 'duo_B'); }
    if (ra === 'over' && rb === 'over') break;
    if (ra !== 'flip' && ra !== 'weiter' && rb !== 'flip' && rb !== 'weiter') await A.waitForTimeout(20);
  }
  if (leak) fail('Gast/Host sehen verdeckte Bilder im DOM: ' + leak);
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  const h1A = (await A.textContent('.over h1')).trim(); const h1B = (await B.textContent('.over h1')).trim();
  console.log(`Host+Gast: ${moves} Aufdeckungen, A: "${h1A}" | B: "${h1B}"`);
  const ranA = await A.$$eval('.ranking .rt', (e) => e.map((x) => x.textContent)).catch(() => []);
  const sumA = ranA.map((t) => parseInt(t, 10)).reduce((a, b) => a + b, 0);
  if (sumA !== 8) fail('Duo: Paare ergeben ' + sumA);
  if (await B.$('[data-act=again]')) fail('Gast sieht "Noch eine Runde"');
  if (!(await A.$('[data-act=again]'))) fail('Host sieht kein "Noch eine Runde"');
  await shot(A, 'duo_ende_A', true); await shot(B, 'duo_ende_B', true);
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  if ((await read(B)).cards.some((c) => c.cls !== 'down')) fail('Neue Runde (Gast) nicht frisch');
  // Gast tippt, wenn er nicht dran ist: nichts passiert, Hinweis erscheint
  const who = await A.evaluate(() => !!document.querySelector('.banner.mine'));
  const X = who ? B : A;
  await X.click('.pf-card[data-i="0"]');
  const hint = await X.textContent('.pf-action');
  if (!/Gerade ist .* dran/.test(hint)) fail('Hinweis bei falschem Zug fehlt: ' + hint);
  if ((await read(X)).cards.some((c) => c.cls !== 'down')) fail('Karte ging auf, obwohl man nicht dran war');
  await ctx.close();
}

// ---------------------------------------------------------------- (e) Layout
async function layout(browser) {
  for (const [size, opt] of [['mittel', null], ['riesig', 'riesig'], ['gross', 'gross']]) {
    const { ctx, page } = await startSolo(browser, opt ? [opt] : []);
    const sizes = await cardSizes(page);
    const minW = Math.min(...sizes.map((s) => s[0]));
    if (minW < 56) fail(`Layout ${size}: Karte ${minW}px`);
    const mem = {}; const tops = new Set(); const rects = new Set();
    for (let i = 0; i < 12; i++) {
      await step(page, mem);
      tops.add(await boardTop(page));
      rects.add(JSON.stringify(await page.$eval('#board', (b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)]; })));
      await noOverflow(page, `Layout ${size}`);
    }
    if (tops.size > 1) fail(`Layout ${size}: Raster-Oberkante springt ${[...tops]}`);
    if (rects.size > 1) fail(`Layout ${size}: Raster-Größe wechselt ${[...rects]}`);
    // Weiter-Knopf sichtbar (im Bildschirm), wenn nötig
    for (let i = 0; i < 40 && !(await page.$('[data-act=weiter]')); i++) await step(page, mem);
    const vis = await page.evaluate(() => { const b = document.querySelector('[data-act=weiter]'); if (!b) return null; const r = b.getBoundingClientRect(); const bd = document.querySelector('#board').getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= window.innerHeight, h: Math.round(r.height), overlap: Math.max(0, Math.round(bd.bottom - document.querySelector('.pf-action').getBoundingClientRect().top)) }; });
    if (vis && (!vis.inView || vis.h < 48)) fail(`Layout ${size}: Weiter nicht gut erreichbar ${JSON.stringify(vis)}`);
    console.log(`Layout ${size}: min. Kartenbreite ${minW}px, Raster fest bei ${[...tops]}, Weiter ${JSON.stringify(vis)}`);
    const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && !b.classList.contains('mini') && !b.classList.contains('pf-card')).map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act, h: Math.round(r.height) }; }).filter((x) => x.h < 48));
    if (small.length) fail('zu kleine Knöpfe ' + JSON.stringify(small));
    await shot(page, `layout_${size}`);
    await ctx.close();
  }
  // Große Schrift
  const { ctx, page } = await startSolo(browser, ['riesig']);
  await page.click('[data-act=bigger]');
  await noOverflow(page, 'große Schrift riesig');
  const mem = {}; for (let i = 0; i < 6; i++) await step(page, mem);
  await shot(page, 'layout_riesig_gross_schrift');
  await ctx.close();
  // Desktop und Natur/Fahrzeuge/Obst
  for (const th of ['natur', 'fahrzeuge', 'fruechte']) {
    const c2 = await startSolo(browser, [th, 'gross'], { width: 1280, height: 800 });
    const m = {}; for (let i = 0; i < 5; i++) await step(c2.page, m);
    const sz = await cardSizes(c2.page);
    await shot(c2.page, `desktop_${th}`);
    if (th === 'natur') console.log('Desktop Kartengröße', sz[0].join('x'));
    await c2.ctx.close();
  }
  // Hilfe, Regeln: keine Marke
  const h = await startSolo(browser);
  await h.page.click('[data-act=help]');
  const t = await h.page.textContent('.modal');
  if (!/Paar/.test(t)) fail('Hilfe ohne Inhalt');
  if (/zeige mir|\bTipps?\b/i.test(t.replace(/Hilfen oder Tipps gibt es bewusst nicht/, '').replace(/Tipp: Wenn du nicht lesen magst[^.]*\./, ''))) fail('Hilfe enthält Tipp-Hinweis');
  await shot(h.page, 'hilfe');
  await h.ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await soloSize(browser, 'klein', 'klein', 4, 3, true);
    await soloSize(browser, 'mittel', null, 4, 4, true);
    await soloSize(browser, 'gross', 'gross', 5, 4, false);
    await soloSize(browser, 'riesig', 'riesig', 6, 5, false);
    await soloAuto(browser);
    await botGame(browser);
    await lernrunde(browser);
    await duo(browser);
    await layout(browser);
  } catch (e) { fail('Abbruch: ' + e.stack); }
  await browser.close();
  console.log(errors.length ? `\n${errors.length} FEHLER` : '\nALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
