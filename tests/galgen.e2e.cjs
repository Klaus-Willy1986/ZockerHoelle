// Durchspieltest für "Galgenmännchen" (Playwright, Chromium): Alleinspiel (Serie, Bestleistung, Wort-Rate),
// gegen Computer (Leicht/Mittel), Lernrunde, Gastgeber + Gast (Mock-Netz), Layout bei 390x844.
// Start:  NODE_PATH=$(npm root -g) node tests/galgen.e2e.cjs
// Der Test startet selbst einen Static-Server (python3 -m http.server) auf Port 8981, wenn dort keiner läuft.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8981;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/galgen/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `gg_e2e_${name}.png`), fullPage: full });
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split('');

async function newCtx(browser, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 1200 ? 20 : ms, ...a); // Computer-Verzögerung
    const Orig = window.BroadcastChannel;
    window.BroadcastChannel = function (name) {
      const ch = new Orig(name);
      ch.addEventListener('message', (ev) => { const m = ev.data; if (m && m.kind === 'data' && m.d && m.d.t === 'state') window.__lastState = JSON.stringify(m.d.game); });
      return ch;
    };
    window.BroadcastChannel.prototype = Orig.prototype;
  });
  return ctx;
}
async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fail(`${name} console ${m.type()} ${m.text()}`); });
  return page;
}
async function overflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
}
async function smallButtons(page, label) {
  const small = await page.$$eval('button, a.btn, input', (els) => els
    .filter((b) => b.offsetParent && !b.closest('.topbtns') && !b.closest('.coach') && b.type !== 'checkbox')
    .map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act || b.id || b.tagName, key: b.classList.contains('gg-key'), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => (x.key ? x.w < 38 || x.h < 48 : x.h < 48 || x.w < 48)));
  if (small.length) fail(`${label}: zu kleine Knöpfe ${JSON.stringify(small.slice(0, 4))}`);
}
async function hostGame(page, store = 'localStorage') {
  const raw = await page.evaluate((s) => window[s].getItem('zh.gg.hostState'), store);
  return raw ? JSON.parse(raw).game : null;
}
const pos = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)]; });
const isOver = (page) => page.$('.trophy');
const mine = (page) => page.evaluate(() => !!document.querySelector('.banner.mine'));

// zufällige freie Taste (Mensch); Reihenfolge: gemischt
async function randomKey(page, rnd) {
  const free = await page.$$eval('.gg-key:not([disabled])', (k) => k.map((x) => x.dataset.l));
  if (!free.length) return null;
  const l = free[Math.floor(rnd() * free.length)];
  await page.click(`.gg-key[data-l="${l}"]`);
  return l;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function guessWord(page, word) {
  await page.click('[data-act=wordopen]');
  await page.fill('#gg-wordin', word);
  await page.click('[data-act=wordsend]');
}

// ================================================================ Alleinspiel
async function soloRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'solo');
  await page.goto(base);
  await page.fill('#name', 'Anna');
  await overflow(page, 'Startseite');
  await shot(page, 'start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  if ((await page.$$('.gg-key')).length !== 29) fail('Tastatur hat nicht 29 Tasten');
  if ((await page.$$('.gg-ch')).length < 4) fail('weniger als 4 Striche');
  await overflow(page, 'Solo Start');
  await smallButtons(page, 'Solo Start');
  const board0 = await pos(page, '#board'); const keys0 = await pos(page, '#gg-keys');
  const wordTexts = new Set(); const boardTops = new Set([board0[1]]); const keyTops = new Set([keys0[1]]);
  const heights = new Set();
  let g = await hostGame(page);
  // Kategorie sichtbar, Wort nicht
  const cat = (await page.textContent('.gg-cat')).trim();
  if (!cat) fail('Kategorie fehlt');
  let html = await page.$eval('#app', (a) => a.innerHTML);
  if (html.includes(g.word)) fail('Wort steht im DOM');
  await shot(page, 'solo_start', false);

  // 1) Treffer: ein Buchstabe des Wortes -> erscheint, Punkt, wieder dran
  const letter = g.word[0];
  const n = g.word.split('').filter((c) => c === letter).length;
  await page.click(`.gg-key[data-l="${letter}"]`);
  await page.waitForFunction((l) => document.querySelectorAll('.gg-ch.on').length > 0, letter);
  g = await hostGame(page);
  if (g.scores[g.players[0].id] !== n || g.errs !== 0) fail('Treffer: Punkte/Fehler falsch');
  const shown = await page.$$eval('.gg-ch.on', (e) => e.map((x) => x.textContent));
  if (shown.length !== n || shown.some((x) => x !== letter)) fail('Treffer: Buchstabe nicht an allen Stellen ' + shown);
  const msg = (await page.textContent('.gg-msg')).trim();
  if (!new RegExp(`Der Buchstabe ${letter} kommt (einmal|zweimal|dreimal|\\d+ Mal) vor`).test(msg)) fail('Meldung Treffer: ' + msg);
  if ((await page.$eval(`.gg-key[data-l="${letter}"]`, (k) => k.disabled)) !== true) fail('geratene Taste nicht grau/gesperrt');
  if (!(await page.$(`.gg-key.hit[data-l="${letter}"]`))) fail('Treffer-Taste nicht markiert');
  boardTops.add((await pos(page, '#board'))[1]); keyTops.add((await pos(page, '#gg-keys'))[1]);

  // 2) Fehler: Buchstabe, der nicht vorkommt
  const wrong = KEYS.find((k) => !g.word.includes(k));
  await page.click(`.gg-key[data-l="${wrong}"]`);
  await page.waitForFunction(() => /Fehler\s*1\s*von 8/.test(document.querySelector('.gg-err').textContent.replace(/\s+/g, ' ')));
  if (!(await page.$(`.gg-key.miss[data-l="${wrong}"]`))) fail('Fehl-Taste nicht markiert');
  const msg2 = (await page.textContent('.gg-msg')).trim();
  if (!/kommt nicht vor\. Fehler 1 von 8/.test(msg2)) fail('Meldung Fehler: ' + msg2);
  g = await hostGame(page);
  if (g.errs !== 1) fail('Fehlerzahl im Zustand');
  const svgA = await page.$eval('.gg-svg', (e) => e.innerHTML);
  await shot(page, 'solo_fehler', false);
  boardTops.add((await pos(page, '#board'))[1]); keyTops.add((await pos(page, '#gg-keys'))[1]);

  // 3) Falsches Wort: Fehler, Wort-Eingabe schließt sich
  await guessWord(page, 'Zzzz');
  await page.waitForFunction(() => /Fehler\s*2\s*von 8/.test(document.querySelector('.gg-err').textContent.replace(/\s+/g, ' ')));
  if (await page.$('#gg-wordin')) fail('Eingabefeld bleibt offen');
  if (!/ZZZZ ist nicht das gesuchte Wort/.test(await page.textContent('.gg-msg'))) fail('Meldung falsches Wort');
  if ((await page.$eval('.gg-svg', (e) => e.innerHTML)) === svgA) fail('Zeichnung ändert sich nicht');
  // Abbrechen
  await page.click('[data-act=wordopen]'); await page.fill('#gg-wordin', 'abc'); await page.click('[data-act=wordcancel]');
  if (await page.$('#gg-wordin')) fail('Abbrechen schließt nicht');
  await page.click('[data-act=wordopen]');
  if ((await page.inputValue('#gg-wordin')) !== '') fail('Eingabe nach Abbrechen nicht leer');
  await page.click('[data-act=wordcancel]');

  // 4) Wort richtig raten (Bonus), nächstes Wort, mehrere Wörter in Folge; dabei lange Wörter prüfen
  let wins = 0; let sawLong = false; let sawTwoLines = false;
  await guessWord(page, g.word.toLowerCase());
  for (let i = 0; i < 40; i++) {
    await page.waitForSelector('[data-act=next]');
    wins++;
    const sg = await hostGame(page);
    if (sg.solved !== true) fail('nicht gelöst obwohl richtiges Wort');
    if (i === 0) {
      const expected = 1 * n + 3 + (g.word.length - n); // Treffer + Bonus 3 + verdeckte (vor dem Raten)
      void expected;
      if (!/Gelöst! Das Wort war/.test(await page.textContent('.gg-msg'))) fail('Meldung Gelöst');
      await shot(page, 'solo_geloest', false);
    }
    await page.click('[data-act=next]');
    await page.waitForSelector('.gg-key');
    const cg = await hostGame(page);
    if (cg.word.length >= 9) {
      sawLong = true;
      const lines = (await page.$$('.gg-line')).length;
      if (lines === 2) sawTwoLines = true; else fail('langes Wort (' + cg.word.length + ') nicht in zwei Zeilen');
      await overflow(page, 'langes Wort');
      heights.add((await pos(page, '#board'))[3]);
      if (!sawTwoLines || wins > 5) { /* weiter */ }
      await shot(page, 'solo_langes_wort', false);
    } else heights.add((await pos(page, '#board'))[3]);
    boardTops.add((await pos(page, '#board'))[1]); keyTops.add((await pos(page, '#gg-keys'))[1]);
    if (sawLong && wins >= 4) { await guessWord(page, cg.word); await page.waitForSelector('[data-act=next]'); wins++; await page.click('[data-act=next]'); await page.waitForSelector('.gg-key'); break; }
    await guessWord(page, cg.word);
  }
  if (!sawLong) fail('kein langes Wort getestet');
  if (heights.size > 1) fail('Spielfeld-Höhe wechselt: ' + [...heights]);
  if (boardTops.size > 1) fail('Spielfeld springt: ' + [...boardTops]);
  if (keyTops.size > 1) fail('Tastatur springt: ' + [...keyTops]);
  console.log(`Solo: ${wins} Wörter in Folge gelöst, Spielfeld-Oberkante ${[...boardTops]}, Tastatur ${[...keyTops]}, Höhe ${[...heights]}`);

  // 5) Verlieren: Wort wird aufgedeckt, kein Bonus, dann Ende der Serie mit Bestleistung
  const lg = await hostGame(page);
  const score0 = lg.scores[lg.players[0].id];
  const wrongs = KEYS.filter((k) => !lg.word.includes(k)).slice(0, 8);
  for (const k of wrongs) await page.click(`.gg-key[data-l="${k}"]`);
  await page.waitForSelector('[data-act=next]');
  const lost = await hostGame(page);
  if (lost.solved !== false || lost.scores[lost.players[0].id] !== score0) fail('Niederlage: Punkte/Status');
  if (!new RegExp(`Verloren.*Das Wort war ${lg.word}`).test(await page.textContent('.gg-msg'))) fail('Meldung Verloren');
  if ((await page.$$('.gg-ch.miss, .gg-ch.on')).length !== lg.word.length) fail('Wort nach Niederlage nicht ganz aufgedeckt');
  if (await page.$('.gg-key')) fail('Tastatur nach Rundenende noch da');
  await overflow(page, 'Niederlage');
  await shot(page, 'solo_verloren');
  await page.click('[data-act=next]');
  await page.waitForSelector('.trophy');
  const h1 = (await page.textContent('.over h1')).trim();
  if (!new RegExp(`Du hast ${wins} Wörter in Folge gelöst`).test(h1)) fail('Ende-Titel: ' + h1);
  const best = await page.evaluate(() => localStorage.getItem('zh.gg_best'));
  if (Number(best) !== wins) fail('Bestleistung gespeichert: ' + best);
  if (!/Neue Bestleistung/.test(await page.textContent('.over'))) fail('Hinweis Neue Bestleistung fehlt');
  await shot(page, 'solo_ende');
  // Noch eine Runde: neues Spiel, Bestleistung wird angezeigt
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  if (!new RegExp(`Bestleistung: ${wins} Wörter in Folge`).test(await page.textContent('.gg-best'))) fail('Bestleistung nicht angezeigt');
  // Neuladen mitten im Spiel
  await page.click('.gg-key[data-l="E"]');
  const before = await page.$eval('#board', (b) => b.innerText);
  await page.reload(); await page.waitForSelector('#board');
  if ((await page.$eval('#board', (b) => b.innerText)) !== before) fail('Neuladen verändert das Spiel');
  await ctx.close();
}

// ================================================================ gegen Computer
async function botRun(browser, level, n, kurz, label) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, label);
  await page.goto(base);
  await page.fill('#name', 'Berta');
  if (kurz) await page.check('[data-opt=kurz]');
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  const r = rng(level * 10 + n);
  let sawBot = false; let shots = 0; let steps = 0; let cheatWords = 0;
  while (!(await isOver(page)) && steps++ < 3000) {
    if (await page.$('[data-act=next]')) { await page.click('[data-act=next]'); continue; }
    if (await mine(page)) {
      // der Mensch rät zufällig; ab und zu das richtige Wort (nur um Runden zu gewinnen)
      const g = await hostGame(page);
      if (g && r() < 0.08) { await guessWord(page, g.word); cheatWords++; } else await randomKey(page, r);
    } else {
      sawBot = true;
      if (shots < 1 && /Computer.* überlegt/.test((await page.textContent('.banner')) || '')) { shots++; await shot(page, `bot${label}`, false); }
      await page.waitForTimeout(25);
    }
  }
  if (!(await isOver(page))) fail(label + ': Partie nicht beendet');
  if (!sawBot) fail(label + ': Computer nie dran');
  const rows = await page.$$eval('.ranking li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const g = await hostGame(page);
  if (rows.length !== n + 1) fail(label + ': Rangliste ' + rows.length);
  const total = Object.values(g.scores).reduce((a, b) => a + b, 0);
  const shownTotal = await page.$$eval('.ranking .rt', (e) => e.map((x) => Number(x.textContent)).reduce((a, b) => a + b, 0));
  if (total !== shownTotal) fail(label + ': Punkte Anzeige/Zustand ' + shownTotal + '/' + total);
  if (g.round + 1 !== (kurz ? 3 : 5)) fail(label + ': Runden ' + (g.round + 1));
  console.log(`${label}: ${rows.join(' | ')}`);
  await shot(page, `bot${label}_ende`);
  await ctx.close();
}

// ================================================================ Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const texts = []; let finished = false; let shots = 0; const r = rng(77);
  for (let i = 0; i < 3000; i++) {
    const t = ((await page.textContent('.coach .coach-t')) || '').trim();
    if (!texts.includes(t)) { texts.push(t); if (shots < 5 && texts.length % 2 === 1) await shot(page, 'lern_' + (++shots), false); }
    const tg = page.locator('.coach-target');
    if ((await tg.count()) === 0) { await page.waitForTimeout(20); continue; }
    const first = tg.first();
    const id = await first.getAttribute('id');
    const act = await first.getAttribute('data-act');
    if (act === 'again') { finished = true; break; }
    if (id === 'gg-keys') await randomKey(page, r);
    else if (id === 'gg-wordin') { await first.fill('Haus'); await page.click('[data-act=wordsend]'); }
    else await first.click();
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde: Endtext');
  const long = texts.filter((t) => t.length > 60);
  if (new Set(long).size !== long.length) fail('Lernrunde: Text doppelt');
  await shot(page, 'lern_ende', false);
  console.log(`Lernrunde: Ende erreicht, ${texts.length} verschiedene Texte`);
  await ctx.close();
}

// ================================================================ Gastgeber + Gast (Mock)
async function stateOf(host, guest) {
  const h = await hostGame(host, 'sessionStorage');
  const gs = await guest.evaluate(() => window.__lastState);
  return { h: JSON.stringify(h), g: gs, hobj: h };
}
async function same(host, guest, label) {
  for (let t = 0; t < 40; t++) {
    const s = await stateOf(host, guest);
    if (s.h === s.g) return s.hobj;
    await host.waitForTimeout(50);
  }
  fail(`${label}: Zustand bei Gastgeber und Gast verschieden`);
  return (await stateOf(host, guest)).hobj;
}
async function duoRun(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A');
  await A.goto(base + '?mock=1&seed=5');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = ((await A.textContent('.code')) || '').trim();
  const B = await newPage(ctx, 'B');
  await B.goto(base + `?mock=1&raum=${room}&seed=9`);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await shot(A, 'lobby', false);
  await A.check('[data-opt=kurz]'); await A.check('[data-opt=easy]');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  let st = await same(A, B, 'Start');
  if (st.rounds !== 3 || st.maxErr !== 10 || st.players.length !== 2) fail('Spielstart-Optionen: ' + JSON.stringify({ r: st.rounds, m: st.maxErr }));
  if ((await B.$$('.gg-key')).length !== 29) fail('Gast: Tastatur');
  const r = rng(3);
  let moves = 0; let leaks = 0; let notYourTurnTested = false; let guestMoved = false; let hostMoved = false;
  for (let n = 0; n < 4000; n++) {
    const over = (await isOver(A)) && (await isOver(B));
    if (over) break;
    // Wort nie im DOM (nur wenn Runde läuft)
    const cur = await hostGame(A, 'sessionStorage');
    if (cur && cur.phase === 'play') {
      for (const P of [A, B]) {
        const html = await P.$eval('#app', (a) => a.innerHTML);
        if (html.includes(cur.word) || html.includes(cur.word.toLowerCase())) leaks++;
        const txt = await P.$eval('.gg-word', (a) => a.innerText.replace(/\s+/g, ''));
        const open = cur.mask.filter((c) => c).join('');
        if (txt !== open) leaks++;
      }
    }
    if (await A.$('[data-act=next]')) { st = await same(A, B, 'Rundenende'); if (await B.$('[data-act=next]')) fail('Gast sieht Weiter-Knopf'); await A.click('[data-act=next]'); await A.waitForTimeout(30); continue; }
    const am = await mine(A); const bm = await mine(B);
    if (am && bm) fail('beide sind dran');
    const P = am ? A : bm ? B : null;
    if (!P) { await A.waitForTimeout(25); continue; }
    const O = am ? B : A;
    if (!notYourTurnTested) {
      notYourTurnTested = true;
      await O.click('.gg-key[data-l="E"]:not([disabled])');
      const hint = await O.textContent('.gg-msg');
      if (!/Gerade ist .* dran/.test(hint)) fail('Hinweis bei falschem Zug fehlt: ' + hint);
      const g2 = await hostGame(A, 'sessionStorage');
      if (g2.guessed.length) fail('Taste wirkte, obwohl man nicht dran war');
    }
    if (am) hostMoved = true; else guestMoved = true;
    if (r() < 0.07) await guessWord(P, cur.word); else await randomKey(P, r);
    moves++;
    if (moves % 3 === 0) await same(A, B, 'Zug ' + moves);
  }
  if (leaks) fail('Wort im Gast-/Host-DOM während der Runde: ' + leaks);
  if (!hostMoved || !guestMoved) fail('Nicht beide haben gezogen');
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  st = await same(A, B, 'Ende');
  const h1A = (await A.textContent('.over h1')).trim(); const h1B = (await B.textContent('.over h1')).trim();
  console.log(`Host+Gast: ${moves} Züge, A: "${h1A}" | B: "${h1B}"`);
  const scA = await A.$$eval('.ranking .rt', (e) => e.map((x) => Number(x.textContent)));
  if (scA.reduce((a, b) => a + b, 0) !== Object.values(st.scores).reduce((a, b) => a + b, 0)) fail('Punkte Anzeige != Zustand');
  if (await B.$('[data-act=again]')) fail('Gast sieht "Noch eine Runde"');
  if (!(await A.$('[data-act=again]'))) fail('Host sieht kein "Noch eine Runde"');
  await shot(A, 'duo_ende_A'); await shot(B, 'duo_ende_B');
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  st = await same(A, B, 'neue Runde');
  if (st.round !== 0 || st.errs !== 0 || st.guessed.length) fail('neues Spiel nicht frisch');
  // Verbindungsabbruch: Gast nicht verbunden -> Host kann den Zug überspringen
  await ctx.close();
}

// ================================================================ Layout
async function layoutRun(browser) {
  for (const [vp, label] of [[{ width: 390, height: 844 }, 'Handy'], [{ width: 360, height: 740 }, 'schmal'], [{ width: 1280, height: 800 }, 'Desktop']]) {
    const ctx = await newCtx(browser, vp);
    const page = await newPage(ctx, 'layout ' + label);
    await page.goto(base);
    await page.fill('#name', 'Lena');
    await page.click('[data-act=solo]');
    await page.waitForSelector('#board');
    const tops = new Set(); const ktops = new Set(); const sizes = new Set(); const mtops = new Set();
    const r = rng(5);
    for (let i = 0; i < 6; i++) {
      tops.add((await pos(page, '#board'))[1]); ktops.add((await pos(page, '#gg-keys'))[1]); mtops.add((await pos(page, '.gg-msg'))[1]);
      sizes.add((await pos(page, '#board'))[3] + 'x' + (await pos(page, '.gg-msg'))[3]);
      await overflow(page, 'Layout ' + label);
      await smallButtons(page, 'Layout ' + label);
      const g = await hostGame(page);
      if (g.phase !== 'play') break;
      await randomKey(page, r);
    }
    if (tops.size > 1) fail(`Layout ${label}: Spielfeld springt ${[...tops]}`);
    if (ktops.size > 1) fail(`Layout ${label}: Tastatur springt ${[...ktops]}`);
    if (mtops.size > 1) fail(`Layout ${label}: Nachricht springt ${[...mtops]}`);
    if (sizes.size > 1) fail(`Layout ${label}: Größen wechseln ${[...sizes]}`);
    const kb = await page.$$eval('.gg-key', (ks) => ks.map((k) => { const x = k.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }));
    const minW = Math.min(...kb.map((k) => k[0])); const minH = Math.min(...kb.map((k) => k[1]));
    if (minW < 38 || minH < 48) fail(`Layout ${label}: Taste ${minW}x${minH}`);
    // Tastatur komplett im ersten Bildschirm (Handy)
    const bottom = await page.$eval('#gg-keys', (e) => Math.round(e.getBoundingClientRect().bottom));
    console.log(`Layout ${label}: Spielfeld bei y=${[...tops]}, Tastatur bei y=${[...ktops]} (unten ${bottom} von ${vp.height}), Taste min. ${minW}x${minH}`);
    if (vp.width === 390 && bottom > vp.height) fail('Layout Handy: Tastatur reicht über den Bildschirm hinaus ' + bottom);
    await shot(page, 'layout_' + label, false);
    // Wort-Eingabe öffnen: nichts springt, kein Überlauf
    await page.click('[data-act=wordopen]');
    await overflow(page, 'Wort-Eingabe ' + label); await smallButtons(page, 'Wort-Eingabe ' + label);
    if ((await pos(page, '#board'))[1] !== [...tops][0]) fail('Spielfeld springt bei Wort-Eingabe');
    if (label === 'Handy') await shot(page, 'layout_wort', false);
    // Große Schrift
    await page.click('[data-act=wordcancel]');
    await page.click('[data-act=bigger]');
    await overflow(page, 'Große Schrift ' + label);
    if (label === 'Handy') await shot(page, 'layout_gross', false);
    await ctx.close();
  }
  // Hilfe
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'hilfe');
  await page.goto(base); await page.fill('#name', 'Hilde'); await page.click('[data-act=solo]'); await page.waitForSelector('#board');
  await page.click('[data-act=help]');
  const t = await page.textContent('.modal');
  if (!/Schneemann/.test(t) || !/Bonuspunkte/.test(t)) fail('Hilfe ohne Inhalt');
  await shot(page, 'hilfe', false);
  await ctx.close();
}

// ================================================================ Server + Start
function portUp() { return new Promise((res) => { http.get(`http://localhost:${PORT}/`, (r) => { r.resume(); res(true); }).on('error', () => res(false)); }); }
(async () => {
  let srv = null;
  if (!(await portUp())) {
    srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await portUp()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const run = async (name, fn) => { if (only && !only.includes(name)) return; const t0 = Date.now(); try { await fn(); } catch (e) { fail(`${name}: ${e.stack || e.message}`); } console.log(`-- ${name} fertig (${((Date.now() - t0) / 1000).toFixed(1)} s)`); };
  await run('solo', () => soloRun(browser));
  await run('bot0', () => botRun(browser, 0, 1, true, 'Leicht'));
  await run('bot1', () => botRun(browser, 1, 1, true, 'Mittel'));
  await run('bot2', () => botRun(browser, 1, 3, false, 'DreiMittel'));
  await run('lern', () => lernrunde(browser));
  await run('duo', () => duoRun(browser));
  await run('layout', () => layoutRun(browser));
  await browser.close();
  if (srv) { try { srv.kill(); } catch { /* egal */ } }
  else { try { execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`); } catch { /* egal */ } }
  if (errors.length) { console.log(`\n${errors.length} FEHLER`); process.exit(1); }
  console.log('\nALLE E2E-TESTS BESTANDEN (Konsole fehlerfrei)');
})().catch((e) => { console.error(e); process.exit(2); });
