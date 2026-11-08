// Durchspieltest für die Wortsuche (Playwright, Chromium): Alleinspiel in allen Stufen, Zeit und Hilfe, gegen Computer,
// Lernrunde, Gastgeber + Gast (Mock-Netz), Layout bei 390x844.
// Start: NODE_PATH=$(npm root -g) node tests/wortsuche.e2e.cjs     (startet selbst einen Static-Server auf Port 8982)
// Das Skript "löst" das Gitter nur aus dem, was im DOM steht (Buchstaben und Wortliste).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8982);
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/wortsuche/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `ws_${name}.png`), fullPage: full });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen() {
  return new Promise((res) => { const s = net.connect(PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
}

async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`${name} console ${m.text()}`); });
  return page;
}
async function newCtx(browser, vp = { width: 390, height: 844 }, botMs = 250) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.addInitScript((bm) => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    // Computer-Wartezeiten (6 bis 48 s) und die 1,5 s der falschen Linie verkürzen
    window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 5000 && ms <= 60000 ? bm : ms === 1500 ? 60 : ms, ...a);
  }, botMs);
  return ctx;
}

// ---------- Lesen und "Lösen" nur aus dem DOM ----------
const DIRS = [[0, 1], [1, 0], [1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1], [-1, 1]];
const read = (page) => page.evaluate(() => ({
  letters: [...document.querySelectorAll('.ws-cell')].map((c) => c.textContent.trim()),
  words: [...document.querySelectorAll('.ws-w')].map((e) => ({ w: e.textContent.trim(), done: e.classList.contains('done') })),
  lines: document.querySelectorAll('.ws-lines line.fnd').length,
  over: !!document.querySelector('.trophy'),
  hint: (document.querySelector('.ws-action p') || {}).textContent || '',
  banner: (document.querySelector('.banner') || {}).textContent || '',
}));
function solve(s) {
  const n = Math.round(Math.sqrt(s.letters.length));
  const out = [];
  for (const { w, done } of s.words) {
    const hits = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) for (const [dr, dc] of DIRS) {
      const er = r + dr * (w.length - 1); const ec = c + dc * (w.length - 1);
      if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
      let ok = true;
      for (let k = 0; k < w.length && ok; k++) if (s.letters[(r + dr * k) * n + c + dc * k] !== w[k]) ok = false;
      if (ok) hits.push([r * n + c, er * n + ec]);
    }
    out.push({ w, done, hits });
  }
  return { n, words: out };
}
async function findWord(page, w, reverse = false) {
  const s = solve(await read(page));
  const x = s.words.find((y) => y.w === w);
  if (!x || x.hits.length !== 1) { fail(`Wort ${w} steht ${x ? x.hits.length : '?'}x im Gitter`); return false; }
  const [a, b] = reverse ? [x.hits[0][1], x.hits[0][0]] : x.hits[0];
  await page.click(`.ws-cell[data-i="${a}"]`);
  await page.click(`.ws-cell[data-i="${b}"]`);
  return true;
}
async function findNext(page, rng = Math.random) {
  const s = solve(await read(page));
  const open = s.words.filter((x) => !x.done);
  if (!open.length) return false;
  const x = open[Math.floor(rng() * open.length)];
  return findWord(page, x.w, rng() < 0.5);
}
async function playOut(page, limit = 40) {
  for (let i = 0; i < limit; i++) {
    const s = await read(page);
    if (s.over) return true;
    if (s.words.every((x) => x.done)) { await wait(50); continue; }
    await findNext(page);
  }
  return !!(await read(page)).over;
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
};
const boardTop = (page) => page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY));
async function startSolo(browser, opts = [], vp, botMs) {
  const ctx = await newCtx(browser, vp, botMs);
  const page = await newPage(ctx, 'solo');
  await page.goto(base);
  await page.fill('#name', 'Anna');
  for (const o of opts) await page.check(`[data-opt=${o}]`);
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  return { ctx, page };
}

// ---------------------------------------------------------------- (a) Alleinspiel
const STUFEN = [['mittel', [], 10, 10, 36], ['leicht', ['easy'], 8, 8, 44], ['schwer', ['hard'], 12, 12, 30]];
async function soloStufe(browser, [stufe, opts, n, words, cs]) {
  const { ctx, page } = await startSolo(browser, opts);
  const s0 = await read(page);
  if (s0.letters.length !== n * n) fail(`${stufe}: ${s0.letters.length} Felder statt ${n * n}`);
  if (s0.words.length !== words) fail(`${stufe}: ${s0.words.length} Wörter statt ${words}`);
  const w = await page.$eval('.ws-cell', (c) => Math.round(c.getBoundingClientRect().width));
  if (w !== cs) fail(`${stufe}: Zelle ${w}px statt ${cs}px`);
  const solved = solve(s0);
  if (solved.words.some((x) => x.hits.length !== 1)) fail(`${stufe}: Wort nicht genau einmal im DOM-Gitter`);
  const dirsUsed = new Set(solved.words.map((x) => { const [a, b] = x.hits[0]; const dr = Math.sign(Math.floor(b / n) - Math.floor(a / n)); const dc = Math.sign((b % n) - (a % n)); return `${dr},${dc}`; }));
  if (stufe === 'leicht' && [...dirsUsed].some((d) => !['0,1', '1,0'].includes(d))) fail('leicht: unerlaubte Richtung ' + [...dirsUsed]);
  if (stufe === 'mittel' && [...dirsUsed].some((d) => !['0,1', '1,0', '1,1'].includes(d))) fail('mittel: unerlaubte Richtung ' + [...dirsUsed]);
  const tops = new Set([await boardTop(page)]);
  await noOverflow(page, stufe);
  // falsche Linien: keine gerade Linie / gerade, aber kein Wort
  await page.click('.ws-cell[data-i="0"]');
  if (!/letzten Buchstaben/.test((await read(page)).hint)) fail(stufe + ': Hinweis nach erstem Tipp: ' + (await read(page)).hint);
  if (await page.$$eval('.ws-lines circle.sel', (e) => e.length) !== 1) fail(stufe + ': Anfangsfeld nicht markiert');
  await page.click(`.ws-cell[data-i="${n + 2}"]`); // Springerzug (1 Zeile, 2 Spalten): nicht gerade
  let h = (await read(page)).hint;
  if (!/keine gerade Linie/.test(h)) fail(stufe + ': Hinweis "keine gerade Linie" fehlt: ' + h);
  tops.add(await boardTop(page));
  await shot(page, `solo_${stufe}_nolinie`);
  await page.click('.ws-cell[data-i="1"]'); await page.click(`.ws-cell[data-i="${2 * n + 1}"]`); // gerade (senkrecht), aber kein Wort
  h = (await read(page)).hint;
  if (!/kein gesuchtes Wort/.test(h) || !/kein/.test(h)) fail(stufe + ': Hinweis falsches Wort: ' + h);
  if ((await page.$$eval('.ws-lines line.try', (e) => e.length)) < 1) fail(stufe + ': falsche Linie wird nicht als Kapsel gezeigt');
  tops.add(await boardTop(page));
  if ((await read(page)).words.some((x) => x.done)) fail(stufe + ': falsche Linie hat ein Wort gefunden');
  await page.waitForFunction(() => document.querySelectorAll('.ws-lines line.try').length === 0, null, { timeout: 4000 }).catch(() => fail(stufe + ': falsche Linie bleibt stehen'));
  // Auswahl aufheben
  await page.click('.ws-cell[data-i="3"]');
  await page.click('[data-act=cancel]');
  if (await page.$$eval('.ws-lines circle.sel', (e) => e.length) !== 0) fail(stufe + ': Auswahl aufheben ohne Wirkung');
  // zweimal dasselbe Feld hebt auf
  await page.click('.ws-cell[data-i="3"]'); await page.click('.ws-cell[data-i="3"]');
  if (await page.$$eval('.ws-lines circle.sel', (e) => e.length) !== 0) fail(stufe + ': Doppeltipp hebt Auswahl nicht auf');
  // erstes Wort finden (rückwärts), Kapsel + durchgestrichen
  await findWord(page, s0.words[0].w, true);
  await page.waitForSelector('.ws-w.done');
  const s1 = await read(page);
  if (s1.lines !== 1) fail(stufe + ': Kapsel für gefundenes Wort fehlt');
  if (!/gefunden/.test(s1.banner)) fail(stufe + ': Banner nach Fund: ' + s1.banner);
  const deco = await page.$eval('.ws-w.done', (e) => getComputedStyle(e).textDecorationLine);
  if (!/line-through/.test(deco)) fail(stufe + ': Wort nicht durchgestrichen');
  tops.add(await boardTop(page));
  await shot(page, `solo_${stufe}_mitte`);
  // Neuladen mitten im Spiel
  const before = JSON.stringify((await read(page)));
  await page.reload(); await page.waitForSelector('#board');
  if (JSON.stringify(await read(page)) !== before) fail(stufe + ': Neuladen verändert das Spiel');
  // ganz zu Ende
  if (!(await playOut(page))) fail(stufe + ': Partie nicht beendet');
  await page.waitForSelector('.trophy');
  const h1 = (await page.textContent('.over h1')).trim();
  if (!/Geschafft/.test(h1)) fail(`${stufe}: Ergebnistext ${h1}`);
  const best = await page.evaluate((k) => localStorage.getItem('zh.ws_best_' + k), stufe);
  if (best === null || !(Number(best) >= 0)) fail(`${stufe}: Bestzeit ${best}`);
  if (!/Neue Bestzeit/.test(await page.textContent('.ws-result'))) fail(`${stufe}: erste Runde sollte Bestzeit sein`);
  if (!/Neue Bestzeit/.test(await page.textContent('.banner'))) fail(`${stufe}: Banner ohne Bestzeit-Hinweis`);
  const allDone = (await read(page)).words.every((x) => x.done);
  if (!allDone) fail(`${stufe}: nicht alle Wörter durchgestrichen`);
  if ((await read(page)).lines !== words) fail(`${stufe}: ${(await read(page)).lines} Kapseln statt ${words}`);
  console.log(`${stufe}: ${n}x${n}, ${words} Wörter, Zelle ${w}px, Richtungen ${[...dirsUsed].join(' ')}, Bestzeit ${best} ms gespeichert`);
  await shot(page, `solo_${stufe}_ende`, true);
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  if ((await read(page)).words.some((x) => x.done)) fail(`${stufe}: neue Runde nicht frisch`);
  if (!new RegExp('Bestzeit bei „' + { mittel: 'Mittel', leicht: 'Leicht', schwer: 'Schwer' }[stufe]).test(await page.textContent('.ws-best'))) fail(`${stufe}: Bestzeit-Anzeige`);
  if (tops.size > 1) fail(`${stufe}: Gitter springt ${[...tops]}`);
  await ctx.close();
}

async function soloZeitHilfe(browser) {
  const { ctx, page } = await startSolo(browser, ['easy', 'time', 'help']);
  if ((await page.textContent('#ws-clock')).trim() !== '00:00') fail('Uhr startet nicht bei 00:00');
  await wait(1300);
  if ((await page.textContent('#ws-clock')).trim() !== '00:00') fail('Uhr läuft vor dem ersten Tipp');
  const s0 = await read(page);
  const k0 = solve(s0).words[0];
  // Hilfe: Anfangsbuchstabe leuchtet, kostet einen Punkt (Hilfen: 1)
  const btns = await page.$$('button.ws-w');
  if (btns.length !== 8) fail('Hilfe: Wörter sind keine Knöpfe: ' + btns.length);
  await page.click(`button.ws-w[data-k="0"]`);
  const g = await page.$$eval('.ws-cell.glow', (e) => e.map((c) => Number(c.dataset.i)));
  const first = k0.hits[0][0];
  if (g.length !== 1 || (g[0] !== first && g[0] !== k0.hits[0][1])) fail('Hilfe: falscher Buchstabe leuchtet ' + g + ' erwartet ' + first);
  if (g.length === 1 && g[0] !== first) { /* Wort wurde rückwärts gefunden; der Anfang in Wortrichtung ist der Start */ }
  if (!/leuchtet/.test((await read(page)).hint)) fail('Hilfe: Hinweis fehlt');
  const hilfen = await page.$$eval('.ws-stats div', (d) => d.map((x) => x.textContent));
  if (!hilfen.some((t) => /^1\s*Hilfen/.test(t))) fail('Hilfe: Zähler ' + JSON.stringify(hilfen));
  await shot(page, 'solo_hilfe');
  await page.click(`button.ws-w[data-k="0"]`);
  if (!(await page.$$eval('.ws-stats div', (d) => d.map((x) => x.textContent))).some((t) => /^1\s*Hilfen/.test(t))) fail('Hilfe: zweites Tippen auf dasselbe Wort kostet wieder');
  // Uhr läuft ab dem ersten Tipp
  await wait(1700);
  const c1 = (await page.textContent('#ws-clock')).trim();
  if (!/^00:0[1-9]$/.test(c1)) fail('Uhr läuft nicht: ' + c1);
  await findWord(page, k0.w);
  await playOut(page);
  await page.waitForSelector('.trophy');
  const t = (await page.textContent('.ws-result')).replace(/\s+/g, ' ');
  if (!/Mit Hilfe geschafft/.test(t)) fail('Ergebnis ohne Hilfe-Hinweis: ' + t);
  const best = await page.evaluate(() => localStorage.getItem('zh.ws_best_leicht'));
  if (best !== null) fail('Mit Hilfe darf keine Bestzeit gespeichert werden: ' + best);
  console.log(`Zeit und Hilfe: Uhr ${c1} nach erstem Tipp, Hilfe zählt, keine Bestzeit mit Hilfe`);
  await ctx.close();
}

// ---------------------------------------------------------------- (b) gegen den Computer
async function botGame(browser, n, level, opts, label) {
  const ctx = await newCtx(browser, undefined, 150);
  const page = await newPage(ctx, 'bot');
  await page.goto(base);
  await page.fill('#name', 'Berta');
  for (const o of opts) await page.check(`[data-opt=${o}]`);
  if (n === 1) await shot(page, 'start', true);
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  let shots = 0; let sawBot = false;
  for (let i = 0; i < 60; i++) {
    const s = await read(page);
    if (s.over) break;
    if (/war schneller/.test(s.banner)) { sawBot = true; if (!shots++) await shot(page, `bot_${label}_schneller`); }
    if (s.words.every((x) => x.done)) { await wait(40); continue; }
    await findNext(page);
  }
  await page.waitForSelector('.trophy', { timeout: 8000 });
  const rows = await page.$$eval('.ranking li', (l) => l.map((x) => x.textContent));
  const pts = await page.$$eval('.ranking .rt', (l) => l.map((x) => parseInt(x.textContent, 10)));
  const sum = pts.reduce((a, b) => a + b, 0);
  const words = (await read(page)).words.length;
  if (rows.length !== n + 1) fail(`${label}: ${rows.length} Zeilen statt ${n + 1}`);
  if (sum !== words * 10) fail(`${label}: Punkte ergeben ${sum} statt ${words * 10}`);
  const bn = (await page.textContent('.banner')).trim();
  if (!/gewonnen|Gleichstand/.test(bn)) fail(label + ': Banner am Ende: ' + bn);
  console.log(`Gegen Computer (${label}): ${rows.join(' | ')}${sawBot ? '' : ' (Computer war nie schneller)'}`);
  await shot(page, `bot_${label}_ende`, true);
  await ctx.close();
}

// ---------------------------------------------------------------- (c) Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser, undefined, 1500);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const s0 = await read(page);
  if (s0.words.length !== 5 || s0.letters.length !== 64) fail(`Lernrunde: ${s0.words.length} Wörter, ${s0.letters.length} Felder`);
  const texts = []; let finished = false; let shots = 0;
  for (let i = 0; i < 400; i++) {
    const t = (await page.textContent('.coach .coach-t')).trim();
    if (!texts.includes(t)) { texts.push(t); if (shots < 5) await shot(page, 'lern_' + (++shots)); }
    const tg = page.locator('.ws-cell.coach-target');
    if ((await tg.count()) === 0) {
      if (await page.locator('[data-act=again].coach-target').count()) { finished = true; break; }
      await page.waitForTimeout(20); continue;
    }
    await tg.first().click();
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde: Endtext');
  if (!texts.some((x) => /Willkommen/.test(x)) || !texts.some((x) => /letzten Buchstaben/.test(x)) || !texts.some((x) => /durchgestrichen/.test(x))) fail('Lernrunde: Erklärungen fehlen ' + texts.length);
  await shot(page, 'lern_ende', true);
  console.log(`Lernrunde: Ende erreicht, ${texts.length} verschiedene Texte`);
  texts.filter((t) => t.length > 70).forEach((t) => console.log('   -', t));
  await ctx.close();
}

// ---------------------------------------------------------------- (d) Host + Gast
async function duo(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A'); const B = await newPage(ctx, 'B');
  await A.goto(base + '?mock=1'); await A.fill('#name', 'Anna'); await A.check('[data-opt=easy]'); await A.check('[data-opt=help]'); await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = (await A.textContent('.code')).trim();
  await shot(A, 'lobby', true);
  await B.goto(base + `?mock=1&raum=${room}`); await B.fill('#name', 'Bernd'); await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const sA = await read(A); const sB = await read(B);
  if (JSON.stringify(sA.letters) !== JSON.stringify(sB.letters)) fail('Duo: Gitter unterschiedlich');
  if (sA.letters.length !== 64) fail('Duo: Leicht erwartet (Host-Option)');
  const rng = Math.random;
  let leak = 0;
  const dom = (P) => P.evaluate(() => ({ attrs: [...document.querySelectorAll('[data-r],[data-c],[data-d],[data-pos],[data-dir]')].length, lines: document.querySelectorAll('.ws-lines line.fnd').length, glow: document.querySelectorAll('.ws-cell.glow').length, done: document.querySelectorAll('.ws-w.done').length, sel: document.querySelectorAll('.ws-lines .sel').length }));
  for (let n = 0; n < 60; n++) {
    for (const P of [A, B]) { const d = await dom(P); if (d.attrs || d.lines !== d.done || d.glow) leak++; }
    if (n === 3) { await shot(A, 'duo_A'); await shot(B, 'duo_B'); }
    const a = await read(A);
    if (a.over) break;
    // beide suchen gleichzeitig; dasselbe Wort mit Absicht manchmal gleichzeitig
    const next = solve(a).words.filter((x) => !x.done);
    if (!next.length) { await wait(30); continue; }
    const pick = next[Math.floor(rng() * next.length)].w;
    await Promise.all([findWord(A, pick, rng() < 0.5), findWord(B, rng() < 0.5 ? pick : next[Math.floor(rng() * next.length)].w, rng() < 0.5)]).catch(() => {});
  }
  await A.waitForSelector('.trophy', { timeout: 8000 }); await B.waitForSelector('.trophy', { timeout: 8000 });
  if (leak) fail('Duo: Lage der Wörter oder Hilfen im DOM sichtbar: ' + leak);
  const rA = await A.$$eval('.ranking .rt', (e) => e.map((x) => x.textContent)); const rB = await B.$$eval('.ranking .rt', (e) => e.map((x) => x.textContent));
  const sum = rA.map((t) => parseInt(t, 10)).reduce((a, b) => a + b, 0);
  if (sum !== 80) fail('Duo: Punkte ergeben ' + sum);
  if (JSON.stringify(rA) !== JSON.stringify(rB)) fail(`Duo: Ranglisten unterschiedlich ${rA} / ${rB}`);
  const fnd = (P) => P.evaluate(() => [...document.querySelectorAll('.ws-lines line.fnd')].map((l) => l.outerHTML).join('') + [...document.querySelectorAll('.ws-cell')].map((c) => c.textContent).join(''));
  const bA = await fnd(A); const bB = await fnd(B);
  if (bA !== bB) fail('Duo: Gitter mit Linien bei Host und Gast nicht identisch');
  const h1A = (await A.textContent('.over h1')).trim(); const h1B = (await B.textContent('.over h1')).trim();
  console.log(`Host+Gast: A "${h1A}" | B "${h1B}" | Punkte ${rA.join(', ')}`);
  if (await B.$('[data-act=again]')) fail('Gast sieht "Noch eine Runde"');
  if (!(await A.$('[data-act=again]'))) fail('Host sieht kein "Noch eine Runde"');
  await shot(A, 'duo_ende_A', true); await shot(B, 'duo_ende_B', true);
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  await wait(100);
  if ((await read(B)).words.some((x) => x.done) || (await read(A)).words.some((x) => x.done)) fail('Neue Runde nicht frisch');
  if (JSON.stringify((await read(A)).letters) !== JSON.stringify((await read(B)).letters)) fail('Neue Runde: Gitter unterschiedlich');
  await ctx.close();
}

// ---------------------------------------------------------------- (e) Layout
async function layout(browser) {
  for (const [stufe, opts, n, , cs] of STUFEN) {
    const { ctx, page } = await startSolo(browser, opts);
    const s = await read(page);
    const solved = solve(s);
    const tops = new Set(); const rects = new Set();
    const rec = async () => {
      tops.add(await boardTop(page));
      rects.add(JSON.stringify(await page.$eval('#board', (b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)]; })));
      await noOverflow(page, 'Layout ' + stufe);
    };
    await rec();
    await page.click('.ws-cell[data-i="0"]'); await rec();
    await page.click(`.ws-cell[data-i="${n + 2}"]`); await rec(); // Hinweis erscheint
    for (const x of solved.words.slice(0, 3)) { await page.click(`.ws-cell[data-i="${x.hits[0][0]}"]`); await page.click(`.ws-cell[data-i="${x.hits[0][1]}"]`); await rec(); }
    if (tops.size > 1) fail(`Layout ${stufe}: Gitter-Oberkante springt ${[...tops]}`);
    if (rects.size > 1) fail(`Layout ${stufe}: Gitter-Größe wechselt ${[...rects]}`);
    const [left, width] = JSON.parse([...rects][0]);
    if (left < 0 || left + width > 390) fail(`Layout ${stufe}: Gitter ragt aus dem Bildschirm ${left}+${width}`);
    const cw = await page.$eval('.ws-cell', (c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    if (cw[0] !== cs || cw[1] !== cs || cw[0] < 30) fail(`Layout ${stufe}: Zelle ${cw}`);
    const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && !b.classList.contains('mini') && !b.classList.contains('ws-cell')).map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act, h: Math.round(r.height) }; }).filter((x) => x.h < 48));
    if (small.length) fail('zu kleine Knöpfe ' + JSON.stringify(small));
    // Wortliste: große Schrift
    const fs1 = await page.$eval('.ws-w', (e) => parseFloat(getComputedStyle(e).fontSize));
    if (fs1 < 24) fail(`Layout ${stufe}: Wortliste Schrift ${fs1}px`);
    console.log(`Layout ${stufe}: Zelle ${cw.join('x')}px, Gitter ${width}px breit bei Rand ${left}, Oberkante fest bei ${[...tops]}, Wortschrift ${fs1}px`);
    await shot(page, `layout_${stufe}`, true);
    // große Schrift
    await page.click('[data-act=bigger]');
    await noOverflow(page, `Layout ${stufe} große Schrift`);
    if (stufe === 'schwer') await shot(page, 'layout_schwer_gross_schrift', true);
    await ctx.close();
  }
  // Desktop
  const d = await startSolo(browser, ['hard'], { width: 1280, height: 800 });
  await shot(d.page, 'desktop_schwer', true);
  await d.ctx.close();
  // Hilfetext
  const h = await startSolo(browser);
  await h.page.click('[data-act=help]');
  const t = await h.page.textContent('.modal');
  if (!/Wörter/.test(t) || !/letzten Buchstaben/.test(t)) fail('Hilfe ohne Inhalt');
  await shot(h.page, 'hilfe');
  await h.ctx.close();
}

(async () => {
  let server = null;
  if (!(await portOpen())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await portOpen()); i++) await wait(100);
  }
  const browser = await chromium.launch();
  try {
    for (const st of STUFEN) await soloStufe(browser, st);
    await soloZeitHilfe(browser);
    await botGame(browser, 1, 1, [], 'mittel_1');
    await botGame(browser, 3, 0, ['easy'], 'leicht_3');
    await lernrunde(browser);
    await duo(browser);
    await layout(browser);
  } catch (e) { fail('Abbruch: ' + e.stack); }
  await browser.close();
  if (server) server.kill();
  console.log(errors.length ? `\n${errors.length} FEHLER` : '\nALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
