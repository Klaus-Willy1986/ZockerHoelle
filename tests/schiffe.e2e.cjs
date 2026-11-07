// Schiffe versenken im Browser. Start:
//   cd /home/user/zockerhoelle && python3 -m http.server 8851 &
//   NODE_PATH=$(npm root -g) PORT=8851 node tests/schiffe.e2e.cjs
// (a) Aufstellen + Runde gegen Computer (Mittel) bis Ende + "Noch eine Runde" + Vorlesen
// (b) Lernrunde  (c) zwei Personen über Test-Netz (?mock=1), Gast sieht die gegnerische Flotte nie
// (d) Layout 390x844
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8851;
const URL0 = `http://localhost:${PORT}/schiffe/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const check = (c, m) => { if (!c) fail(m); };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const shot = (p, n, o = {}) => p.screenshot({ path: path.join(SHOTS, `schiffe-${n}.png`), ...o });

const speedUp = () => {
  const si = window.setInterval.bind(window);
  window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
  const st = window.setTimeout.bind(window);
  window.__botDelay = 20;
  window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? window.__botDelay : ms, ...a);
  window.__spoken = [];
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { window.__spoken.push(u.text); }, cancel() {}, getVoices() { return []; } } });
};

async function newPage(ctx, label, fast) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fail(`${label} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${label} console ${m.text()}`); });
  p.on('dialog', (d) => d.accept());
  return p;
}
const banner = async (p) => (await p.locator('.banner').first().innerText().catch(() => '')).trim();
const isMine = (p) => p.locator('.banner.mine').count().then((n) => n > 0);
const isOver = (p) => p.locator('.trophy').count().then((n) => n > 0);
const msgText = async (p) => (await p.locator('.sv-msg .big').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
async function unshot(p) {
  return p.evaluate(() => [...document.querySelectorAll('#board button.sv-c')].filter((b) => !/\b(w|h|s)\b/.test(b.className)).map((b) => [Number(b.dataset.x), Number(b.dataset.y)]));
}
async function waitFor(p, fn, ms = 8000, what = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(25); }
  fail('Zeitüberschreitung: ' + what);
  return false;
}
// Ein Schuss: Feld antippen (markiert), Hier schießen
async function fireAt(p, x, y) {
  await p.click(`#board [data-x="${x}"][data-y="${y}"]`, { timeout: 4000 });
  const sel = await p.locator('#board .sv-c.sel').count();
  check(sel === 1, 'Feld wird nicht markiert');
  check(await p.locator('[data-act=fire]:not([disabled])').count() === 1, 'Hier schießen nicht aktiv');
  await p.click('[data-act=fire]');
}
async function fireRandom(p) {
  const list = await unshot(p);
  const [x, y] = rnd(list);
  await fireAt(p, x, y);
  return [x, y];
}
async function ownShipCount(p, scope = '#board') { return p.locator(`${scope} .sv-c.ship`).count(); }

// ===================== (a) + (d) gegen den Computer =====================
async function partBot(browser) {
  console.log('--- (a) Computer (Mittel) ---');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(speedUp);
  const p = await newPage(ctx, 'bot');
  await p.goto(URL0);
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await p.goto(URL0);
  await shot(p, 'start', { fullPage: true });
  check((await p.innerText('body')).includes('Schiffe dürfen sich berühren'), 'Option berühren fehlt');
  check((await p.innerText('body')).includes('Treffer = nochmal schießen'), 'Option nochmal fehlt');
  check(await p.locator('[data-act=solo]').count() === 0, 'Solo-Knopf darf es nicht geben');
  await p.fill('#name', 'Gerda');
  await p.click('[data-act=bot][data-level="1"]');
  await p.waitForSelector('#board');
  check(/Stelle deine Flotte auf/.test(await banner(p)), 'Banner Aufstellen: ' + await banner(p));
  check(await p.locator('[data-act=ready][disabled]').count() === 1, 'Fertig muss gesperrt sein');
  await shot(p, 'setup-leer');

  // Layout im Aufstellen merken
  const boardRect = () => p.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; });
  const setupRects = [await boardRect()];

  // Manuell: Schlachtschiff (vorgewählt) auf A1 waagerecht
  check(await p.locator('.sv-shipbtn.on').count() === 1, 'ein Schiff vorgewählt');
  await p.click('#board [data-x="0"][data-y="0"]');
  check(await ownShipCount(p) === 5, 'Schlachtschiff hat 5 Felder, ist ' + await ownShipCount(p));
  check(await p.locator('#board [data-x="4"][data-y="0"].ship').count() === 1, 'E1 gehört zum Schiff');
  // Kreuzer (automatisch vorgewählt): direkt daneben ist ungültig (Berührung) -> rot + Hinweis
  await p.click('#board [data-x="0"][data-y="1"]');
  check(await p.locator('#board .sv-c.bad').count() === 4, 'rote Vorschau mit 4 Feldern');
  check(/nicht berühren/.test(await msgText(p)), 'Hinweis Berührung: ' + await msgText(p));
  await shot(p, 'setup-rot');
  // diagonal ungültig
  await p.click('#board [data-x="5"][data-y="1"]');
  check(await p.locator('#board .sv-c.bad').count() === 4, 'diagonal ist ungültig');
  // über den Rand
  await p.click('#board [data-x="8"][data-y="5"]');
  check(/Rand/.test(await msgText(p)), 'Hinweis Rand: ' + await msgText(p));
  // Drehen: senkrecht, dann gültig setzen
  await p.click('[data-act=rotate]');
  check(/senkrecht/.test(await p.locator('[data-act=rotate]').innerText()), 'Drehen-Knopf zeigt senkrecht');
  await p.click('#board [data-x="9"][data-y="3"]');
  check(await ownShipCount(p) === 9, 'Kreuzer gesetzt (9 Felder)');
  check(await p.locator('#board [data-x="9"][data-y="6"].ship').count() === 1, 'Kreuzer läuft senkrecht bis Zeile 7');
  // gesetztes Schiff drehen: Kreuzer ist gerade nicht gewählt (nächstes ist vorgewählt) -> antippen wählt es
  await p.click('#board [data-x="9"][data-y="3"]');
  check(await p.locator('.sv-shipbtn.on').first().innerText().then((t) => /Kreuzer/.test(t)), 'Antippen wählt das Schiff');
  await p.click('[data-act=rotate]'); // wäre waagerecht ab J4 -> über den Rand => bleibt, Hinweis
  check(/passt das Schiff hier nicht/.test(await msgText(p)), 'Drehen am Rand: ' + await msgText(p));
  check(await ownShipCount(p) === 9, 'Kreuzer bleibt');
  setupRects.push(await boardRect());

  // Zufällig aufstellen: beliebig oft neu würfeln, alles gesetzt
  const layouts = new Set();
  for (let k = 0; k < 4; k++) {
    await p.click('[data-act=random]');
    check(await ownShipCount(p) === 17, 'zufällig: 17 Felder');
    layouts.add(await p.evaluate(() => [...document.querySelectorAll('#board .sv-c.ship')].map((e) => e.dataset.x + e.dataset.y).join()));
    setupRects.push(await boardRect());
  }
  check(layouts.size >= 3, 'Zufällig würfelt neu: ' + layouts.size);
  check(await p.locator('[data-act=ready]:not([disabled])').count() === 1, 'Fertig aktiv');
  await shot(p, 'setup-fertig');
  // manuelles Verschieben nach Zufall: Schiff 5 (U-Boot) antippen, Drehen
  await p.click('.sv-shipbtn[data-i="4"]');
  await p.click('[data-act=rotate]');
  check(await ownShipCount(p) === 17, 'nach Drehen noch 17 Felder');
  for (const r of setupRects) check(JSON.stringify(r) === JSON.stringify(setupRects[0]), 'Brett springt im Aufstellen: ' + JSON.stringify(r) + ' vs ' + JSON.stringify(setupRects[0]));

  // Vorlesen einschalten
  await p.click('[data-act=speak-toggle]');
  await p.click('[data-act=ready]');
  await waitFor(p, async () => /schießt|Du bist dran/.test(await banner(p)), 8000, 'Spielbeginn');
  console.log('Banner nach Start:', await banner(p));
  const firstShooter1 = /Du bist dran/.test(await banner(p)) ? 'ich' : 'computer';
  await shot(p, 'play-start');
  await p.evaluate(() => { window.__botDelay = 250; }); // Computer antwortet etwas langsamer, damit die eigene Meldung lesbar bleibt

  // Layout-Messung (d) während des Spiels
  const rects = [];
  const widths = [];
  let shots = 0; let hitSeen = false; let waterSeen = false; let sunkSeen = false;
  const minBtn = { v: 999 };
  const measureButtons = async () => {
    const v = await p.evaluate(() => Math.min(...[...document.querySelectorAll('button.btn, .btn')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect().height)));
    minBtn.v = Math.min(minBtn.v, v);
  };
  await measureButtons();
  const t0 = Date.now();
  let over = false;
  while (Date.now() - t0 < 150000) {
    if (await isOver(p)) { over = true; break; }
    if (await isMine(p)) {
      rects.push(await boardRect());
      widths.push(await p.evaluate(() => document.documentElement.scrollWidth));
      // Zielfeld markieren: Zustand "markiert" darf das Brett nicht verschieben
      const list = await unshot(p);
      const [x, y] = rnd(list);
      await p.click(`#board [data-x="${x}"][data-y="${y}"]`);
      rects.push(await boardRect());
      if (shots === 3) await shot(p, 'play-markiert');
      // anderes Feld wählen und wieder abwählen
      if (shots === 1) { await p.click(`#board [data-x="${x}"][data-y="${y}"]`); check(await p.locator('#board .sv-c.sel').count() === 0, 'Abwählen'); await p.click(`#board [data-x="${x}"][data-y="${y}"]`); }
      if (shots === 0) {
        check(await p.locator('[data-act=fire]:not([disabled])').count() === 1, 'Hier schießen aktiv nach Markieren');
        const fireBottom = await p.evaluate(() => { const b = document.querySelector('[data-act=fire]').getBoundingClientRect(); return Math.round(b.bottom + scrollY); });
        console.log('Unterkante Knopf Hier schießen (px von oben, Seite 844 hoch):', fireBottom);
        check(fireBottom <= 844, 'Hier schießen nicht ohne Scrollen sichtbar: ' + fireBottom);
      }
      await p.click('[data-act=fire]');
      shots++;
      await p.waitForTimeout(30);
      await measureButtons();
      const m = await msgText(p);
      check(/Dein Schuss: Spalte [A-J], Zeile \d+: (Wasser|Treffer)/.test(m), 'Meldung nach Schuss: ' + m);
      if (/Wasser/.test(m)) waterSeen = true;
      if (/Treffer, versenkt: (Schlachtschiff|Kreuzer|Zerstörer|U-Boot)/.test(m)) sunkSeen = true; else if (/Treffer/.test(m)) hitSeen = true;
      if (shots === 6) await shot(p, 'play-mitte');
    } else await p.waitForTimeout(25);
  }
  check(over, 'Runde 1 endet nicht');
  console.log('Schüsse (Mensch):', shots, 'Wasser', waterSeen, 'Treffer', hitSeen, 'Versenkt', sunkSeen);
  check(waterSeen && hitSeen, 'Wasser und Treffer gesehen');
  for (const r of rects) check(JSON.stringify(r) === JSON.stringify(rects[0]), 'Brett springt im Spiel: ' + JSON.stringify(r) + ' vs ' + JSON.stringify(rects[0]));
  check(Math.max(...widths) <= 390, 'horizontaler Scroll: ' + Math.max(...widths));
  console.log('Brett-Position/Größe im Spiel (x,y,b,h):', JSON.stringify(rects[0]), '| Zellen ca.', ((rects[0][2] - 26) / 10).toFixed(1), 'px | Seitenbreite max', Math.max(...widths));
  console.log('Kleinste Knopfhöhe (px):', minBtn.v.toFixed(1));
  check(minBtn.v >= 48, 'Knopf zu klein ' + minBtn.v);

  // Vorlesen: jede Ergebnismeldung
  const spoken = (await p.evaluate(() => window.__spoken)).join(' ');
  check(/Spalte [A-J], Zeile \d+: ?(Wasser|Treffer)/.test(spoken), 'Vorlesen nennt Schuss: ' + spoken.slice(0, 300));
  console.log('Vorgelesen (Auszug):', spoken.slice(0, 160).replace(/\s+/g, ' '));

  await waitFor(p, () => isOver(p), 5000, 'Ende');
  console.log('Ende:', (await p.locator('.sv-over h1').innerText()).replace(/\n/g, ' '));
  await shot(p, 'over', { fullPage: true });
  check(/Runde 1/.test(await p.locator('.sv-table caption').innerText()), 'Tabelle Runde 1');
  check(await p.locator('.sv-over [data-act=leave-now]').innerText().then((t) => /Spiel beenden/.test(t)), 'Spiel beenden');

  // Hilfe
  await p.click('[data-act=again]');
  await waitFor(p, async () => /Stelle deine Flotte auf/.test(await banner(p)), 4000, 'neue Runde: Aufstellen');
  await p.click('[data-act=help]');
  const help = await p.locator('.modal').innerText();
  check(/Schlachtschiff/.test(help) && /Hier schießen/.test(help) && /Drehen/.test(help), 'Hilfetext');
  await shot(p, 'help');
  await p.evaluate(() => document.querySelector('.overlay').scrollTo(0, 99999));
  { const bb = await p.locator('.modal [data-act=help-close]').boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
  check(await p.locator('.modal').count() === 0, 'Hilfe schließt');
  await p.evaluate(() => { window.__botDelay = 20; });

  // Runde 2: Punktestand, Start wechselt
  check(/Runde 2/.test(await p.locator('.sv-score').innerText()), 'Runde 2 sichtbar');
  await p.click('[data-act=random]');
  await p.click('[data-act=ready]');
  await waitFor(p, async () => /schießt|Du bist dran/.test(await banner(p)), 8000, 'Runde 2 Start');
  const firstShooter2 = /Du bist dran/.test(await banner(p)) ? 'ich' : 'computer';
  console.log('Wer beginnt: Runde 1', firstShooter1, '– Runde 2', firstShooter2);
  check(firstShooter1 !== firstShooter2, 'Startwechsel');
  // Punktestand nach Runde 1 (Zahlen im Score-Text)
  const score = await p.locator('.sv-score').innerText();
  console.log('Punktestand-Zeile:', score.replace(/\n/g, ' '));
  check(/1/.test(score), 'Punktestand zählt Runde 1');
  // Runde 2 zu Ende spielen (Mensch schießt der Reihe nach)
  let n = 0;
  while (!(await isOver(p)) && n++ < 400) {
    if (await isMine(p)) { await fireRandom(p); await p.waitForTimeout(20); } else await p.waitForTimeout(25);
  }
  check(await isOver(p), 'Runde 2 endet');
  await shot(p, 'over2');
  check(/Runde 2/.test(await p.locator('.sv-table caption').innerText()), 'Tabelle Runde 2');
  await p.click('[data-act=leave-now]');
  await p.waitForSelector('#name');
  await ctx.close();
}

// ===================== (b) Lernrunde =====================
async function partLearn(browser) {
  console.log('--- (b) Lernrunde ---');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(speedUp);
  const p = await newPage(ctx, 'lern');
  await p.goto(URL0);
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await p.goto(URL0);
  await p.fill('#name', 'Gerda');
  await p.click('[data-act=learn]');
  await p.waitForSelector('.coach');
  let seq = [];
  const segs = [];
  let shots = 0; let reloaded = false; let over = false; let n = 0; let humanSteps = 0;
  const t0 = Date.now();
  while (n++ < 100000 && Date.now() - t0 < 150000) {
    if (await isOver(p)) { over = true; break; }
    const snap = await p.evaluate(() => ({
      txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(),
      random: !!document.querySelector('.coach-target[data-act=random]'),
      ready: !!document.querySelector('.coach-target[data-act=ready]'),
      fire: !!document.querySelector('.coach-target[data-act=fire]'),
      board: !!document.querySelector('.coach-target#board'),
      mine: !!document.querySelector('.banner.mine'),
    }));
    if (seq[seq.length - 1] !== snap.txt && snap.txt) {
      seq.push(snap.txt);
      if (shots < 6) await shot(p, `lern-${++shots}`);
    }
    if (snap.mine) {
      humanSteps++;
      check(snap.random || snap.ready || snap.fire || snap.board, 'Mensch dran, aber kein Ziel: ' + snap.txt);
      if (humanSteps === 12 && !reloaded) {
        reloaded = true;
        segs.push(seq); seq = []; // nach Neuladen beginnt die Lernrunde-Erinnerung neu
        await p.reload();
        await p.waitForSelector('.coach', { timeout: 8000 });
        continue;
      }
      if (snap.fire) await p.click('.coach-target[data-act=fire]');
      else if (snap.board) { const [x, y] = rnd(await unshot(p)); await p.click(`#board [data-x="${x}"][data-y="${y}"]`); }
      else if (snap.ready) await p.click('.coach-target[data-act=ready]');
      else if (snap.random) await p.click('.coach-target[data-act=random]');
    } else {
      check(/Computer/.test(snap.txt), 'Computer-Text erwartet: ' + snap.txt);
      check(!(snap.random || snap.ready || snap.fire || snap.board), 'Computer dran: kein Ziel');
      await p.waitForTimeout(25);
    }
  }
  check(over, 'Lernrunde kommt bis zum Ende');
  segs.push(seq);
  console.log('Verschiedene Erklärungen:', segs.map((q) => q.length).join(' + '));
  const once = [/Zuerst stellst du/, /Alle fünf Schiffe stehen\. Wenn du/, /Jetzt wird abwechselnd geschossen/, /Wasser heißt/, /Treffer! Hier liegt/, /Versenkt! Du hast/, /Der Computer hat auf dein Meer geschossen/];
  for (const sg of segs) for (const re of once) check(sg.filter((t) => re.test(t)).length <= 1, 'Erklärung mehrfach: ' + re);
  const joined = segs.flat().join(' | ');
  check(/Zufällig aufstellen/.test(joined), 'Zufällig wird vorgeschlagen');
  check(!/Spalte [A-J]|am besten|Strategie|empfehl/i.test(joined), 'keine Strategie');
  console.log(segs[0].filter((t, i) => segs[0].indexOf(t) === i).map((t) => '  - ' + t).join('\n'));
  const t = (await p.innerText('.coach .coach-t')).trim();
  check(/zu Ende/.test(t) && await p.locator('.coach-target[data-act=again]').count() === 1, 'Ende-Text');
  await shot(p, 'lern-ende', { fullPage: true });
  await p.click('[data-act=again]');
  await p.waitForSelector('#board');
  await p.click('[data-act=learn-stop]');
  check(await p.locator('.coach').count() === 0, 'Lernrunde beenden');
  await ctx.close();
}

// ===================== (c) zwei Personen =====================
async function partTwo(browser) {
  console.log('--- (c) zwei Personen (Test-Netz) ---');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const A = await newPage(ctx, 'A'); const B = await newPage(ctx, 'B');
  await A.goto(URL0 + '?mock=1');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.locator('.code').innerText()).trim();
  // Option: Treffer = nochmal schießen
  await A.check('[data-opt=again]');
  await B.goto(URL0 + '?mock=1&raum=' + code);
  await B.fill('#name', 'Ben');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]');
  await shot(A, 'lobby', { fullPage: true });
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  // A: zufällig. B: manuell fünf Schiffe in Reihen 1,3,5,7,9 (je ein Feld Abstand)
  await A.click('[data-act=random]');
  for (let k = 0; k < 5; k++) {
    await B.click(`.sv-shipbtn[data-i="${k}"]`);
    await B.click(`#board [data-x="0"][data-y="${k * 2}"]`);
  }
  check(await ownShipCount(B) === 17, 'Gast: 17 Schiffsfelder gesetzt, ist ' + await ownShipCount(B));
  await shot(B, 'gast-setup');
  check(await B.locator('[data-act=ready]:not([disabled])').count() === 1, 'Gast Fertig aktiv');
  await A.click('[data-act=ready]');
  check(/Warte auf Ben/.test(await banner(A)), 'A wartet: ' + await banner(A));
  check(await A.locator('[data-act=random]').count() === 0, 'nach Fertig keine Knöpfe mehr');
  await B.click('[data-act=ready]');
  await waitFor(A, async () => /Du bist dran/.test(await banner(A)), 4000, 'A beginnt');
  await waitFor(B, async () => /Anna schießt/.test(await banner(B)), 4000, 'B sieht A am Zug');

  // Wahrheit des Gastgebers (nur zur Prüfung): Flotten und Schüsse
  const truth = () => A.evaluate(() => JSON.parse(sessionStorage.getItem('zh.sv.hostState')).game);
  const sk = (cells) => cells.sort((a, b) => a - b).join();
  const fleetCells = (g, i) => g.fleets[i].flatMap((s) => { const out = []; for (let k = 0; k < s.len; k++) out.push((s.y + (s.dir === 'v' ? k : 0)) * 10 + s.x + (s.dir === 'h' ? k : 0)); return out; });
  async function guestChecks(label) {
    const g = await truth();
    const ia = g.players.findIndex((p) => p.name === 'Anna'); const ib = 1 - ia;
    const aCells = fleetCells(g, ia); const bCells = fleetCells(g, ib);
    // Gast: Schiffsfelder nur auf dem eigenen Feld und genau die eigenen
    const own = await B.evaluate(() => [...document.querySelectorAll('#ownboard .sv-c')].map((e, i) => (e.classList.contains('ship') ? i : -1)).filter((i) => i >= 0));
    check(sk(own) === sk(bCells), `${label}: Gast sieht eigene Flotte falsch`);
    check(await B.locator('#board .sv-c.ship, #board [class*="ship"]').count() === 0, `${label}: Schiff im Zielfeld des Gastes`);
    // Zielfeld des Gastes zeigt nur Schüsse: Treffer/Versenkt genau dort, wo Ben getroffen hat
    const marks = await B.evaluate(() => [...document.querySelectorAll('#board .sv-c')].map((e, i) => (/\b(h|s)\b/.test(e.className) ? i : -1)).filter((i) => i >= 0));
    const truthHits = g.grid[ib].map((v, i) => (v === 'h' || v === 's' ? i : -1)).filter((i) => i >= 0);
    check(sk(marks) === sk(truthHits), `${label}: Treffermarken des Gastes stimmen nicht`);
    // keine unbeschossenen gegnerischen Schiffsfelder irgendwo im DOM-Text des Gastes (Beschriftungen)
    const labels = await B.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')));
    const ownBoardLabels = await B.evaluate(() => [...document.querySelectorAll('#ownboard [aria-label]')].length);
    const outside = labels.length - ownBoardLabels;
    void outside;
    const targetLabels = await B.evaluate(() => [...document.querySelectorAll('#board [aria-label]')].map((e) => e.getAttribute('aria-label')));
    check(!targetLabels.some((t) => /Schlachtschiff|Kreuzer|Zerstörer|U-Boot|dein Schiff/.test(t) && !/versenkt/.test(t)), `${label}: Schiffsname im Zielfeld`);
    const html = await B.evaluate(() => document.body.innerHTML);
    // Anna-Felder, die noch nicht beschossen wurden: Zelle im Zielfeld ohne Marke
    const cls = await B.evaluate(() => [...document.querySelectorAll('#board .sv-c')].map((e) => e.className));
    for (const c of aCells) if (g.grid[ib][c] === null) check(!/\b(h|s|w|ship)\b/.test(cls[c]), `${label}: unbeschossenes Feld verrät etwas`);
    // Die Zustandsdaten (versteckt) dürfen nicht in data-Attributen stehen
    check(!/data-fleet|data-ships|"fleets"/.test(html), `${label}: Flottendaten im DOM`);
    // Gleiches gilt für Anna (Gastgeber): Bens Flotte nicht sichtbar
    check(await A.locator('#board .sv-c.ship').count() === 0, `${label}: Schiff im Zielfeld des Gastgebers`);
    const ownA = await A.evaluate(() => [...document.querySelectorAll('#ownboard .sv-c')].map((e, i) => (e.classList.contains('ship') ? i : -1)).filter((i) => i >= 0));
    check(sk(ownA) === sk(aCells), `${label}: Gastgeber sieht eigene Flotte falsch`);
  }
  await guestChecks('Start');

  // Einige Runden schießen (mit Option "nochmal schießen")
  let againChecked = false; let sunkSeen = false;
  const t0 = Date.now();
  let moves = 0;
  while (!(await isOver(A)) && Date.now() - t0 < 90000) {
    const mineA = await isMine(A); const mineB = await isMine(B);
    const P = mineA ? A : mineB ? B : null;
    if (!P) { await A.waitForTimeout(30); continue; }
    const O = P === A ? B : A;
    check(!(mineA && mineB), 'beide gleichzeitig dran');
    // der andere kann nicht schießen
    check(await O.locator('[data-act=fire]:not([disabled])').count() === 0, 'Gegner darf nicht schießen');
    await fireRandom(P);
    moves++;
    await P.waitForTimeout(40);
    const m = await msgText(P);
    const m2 = await msgText(O);
    check(m.replace(/^Dein Schuss/, '').replace(/^Schuss von \w+/, '') === m2.replace(/^Dein Schuss/, '').replace(/^Schuss von \w+/, ''), `Meldung bei beiden gleich: "${m}" / "${m2}"`);
    if (/Treffer/.test(m)) {
      const stillMine = await isMine(P);
      check(stillMine, 'Treffer: nochmal schießen (Option an): ' + m);
      againChecked = true;
    } else if (/Wasser/.test(m)) {
      check(!(await isMine(P)), 'Wasser: Wechsel');
    }
    if (/versenkt: /.test(m)) sunkSeen = true;
    if (moves <= 14 || moves % 10 === 0) await guestChecks('Zug ' + moves);
    if (moves === 8) { await shot(A, 'zwei-A'); await shot(B, 'zwei-B'); }
  }
  check(await isOver(A) && await isOver(B), 'Runde endet bei beiden');
  console.log('Zwei Personen: Schüsse', moves, 'nochmal-Regel geprüft', againChecked, 'Versenkt gesehen', sunkSeen);
  check(againChecked, 'nochmal-Regel wurde geprüft');
  console.log('Sieger A:', (await A.locator('.sv-over h1').innerText()), '| B:', (await B.locator('.sv-over h1').innerText()));
  await shot(A, 'zwei-over-A', { fullPage: true }); await shot(B, 'zwei-over-B', { fullPage: true });
  check(await B.locator('[data-act=again]').count() === 0, 'Gast hat keinen Noch-eine-Runde-Knopf');
  const winnerIsA = /Du hast gewonnen/.test(await A.locator('.sv-over h1').innerText());
  check(winnerIsA !== /Du hast gewonnen/.test(await B.locator('.sv-over h1').innerText()), 'genau eine Person gewinnt');
  // neue Runde: Aufstellen bei beiden, Punktestand
  await A.click('[data-act=again]');
  await waitFor(B, async () => /Stelle deine Flotte auf/.test(await banner(B)), 4000, 'B neue Runde');
  check(/Runde 2/.test(await B.locator('.sv-score').innerText()), 'Runde 2 beim Gast');
  check(await ownShipCount(B) === 0, 'neue Runde: leeres Feld');
  const sc = (await A.locator('.sv-score').innerText()).replace(/\n/g, ' ');
  console.log('Punktestand Runde 2:', sc);
  check(/Anna \(du\) [01] : Ben [01]|Ben [01] : Anna \(du\) [01]/.test(sc.replace(/\s+/g, ' ')), 'Punktestandformat: ' + sc);
  await ctx.close();
}

// ===================== Desktop =====================
async function partDesktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(speedUp);
  const p = await newPage(ctx, 'desktop');
  await p.goto(URL0);
  await p.fill('#name', 'Gerda');
  await p.click('[data-act=bot][data-level="0"]');
  await p.waitForSelector('#board');
  await p.click('[data-act=random]');
  await p.click('[data-act=ready]');
  await waitFor(p, async () => /schießt|Du bist dran/.test(await banner(p)), 8000, 'Desktop Start');
  for (let k = 0; k < 5; k++) { await waitFor(p, () => isMine(p), 5000, 'dran'); await fireRandom(p); await p.waitForTimeout(40); }
  await waitFor(p, () => isMine(p), 5000, 'dran');
  await shot(p, 'desktop');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  try {
    if (!only || only === 'a') await partBot(browser);
    if (!only || only === 'b') await partLearn(browser);
    if (!only || only === 'c') await partTwo(browser);
    if (!only || only === 'd') await partDesktop(browser);
  } catch (e) { fail('Abbruch: ' + (e.stack || e.message)); }
  console.log('Fehler:', JSON.stringify(errors));
  console.log(errors.length ? 'FEHLGESCHLAGEN' : 'ALLES OK');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
