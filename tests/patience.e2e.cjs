// Patience im Browser. Aufruf: NODE_PATH=$(npm root -g) node tests/patience.e2e.cjs [Screenshot-Ordner] [Port]
// Server: cd /home/user/zockerhoelle && python3 -m http.server 8992
const { chromium } = require('playwright');
const SPDIR = process.argv[2] || '.';
const PORT = process.argv[3] || process.env.PORT || '8992';
const check = (c, m) => { if (!c) throw new Error(m); };
let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const URL0 = `http://localhost:${PORT}/patience/index.html`;

(async () => {
  const E = await import(`file://${process.cwd()}/patience/engine.js`);
  const b = await chromium.launch();
  const errors = [];
  async function newPage(url, viewport = { width: 390, height: 844 }, noPagehide = false) {
    const ctx = await b.newContext({ viewport });
    if (noPagehide) await ctx.addInitScript(() => { for (const o of [window, document]) { const a = o.addEventListener.bind(o); o.addEventListener = (t, ...r) => (t === 'pagehide' || t === 'visibilitychange' ? undefined : a(t, ...r)); } });
    await ctx.addInitScript(() => {
      const si = window.setInterval.bind(window);
      window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
    p.on('dialog', (d) => d.accept());
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(url);
    return p;
  }
  const state = (p) => p.evaluate(() => { const h = JSON.parse(localStorage.getItem('zh.pt.hostState')); return h && h.game; });
  const balance = (g) => {
    const all = [...g.tab.flat(), ...g.stock, ...g.waste, ...g.cells.filter((x) => x !== null)];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= g.found[s]; r++) all.push(s * 13 + r - 1);
    check(all.length === 52 && new Set(all).size === 52, 'Kartenbilanz 52: ' + all.length);
  };
  const srcSel = (f) => (f.k === 't' ? `#board [data-k=t][data-i="${f.i}"][data-j="${f.j}"]` : f.k === 'w' ? '#board [data-k=w]' : `#board [data-k=c][data-i="${f.i}"]`);
  const dstSel = (d) => (d.k === 'f' ? `#board [data-k=f][data-i="${d.suit}"]` : d.k === 'c' ? `#board [data-k=c][data-i="${d.i}"]` : `#board .pt-col[data-col="${d.i}"] button >> nth=-1`);
  const tap = (p, sel) => p.locator(sel).first().click({ position: { x: 6, y: 5 }, timeout: 4000 });
  const topOf = (p) => p.evaluate(() => document.getElementById('board').getBoundingClientRect().top + window.scrollY);

  function legalList(g) {
    const out = [];
    const srcs = [{ k: 'w' }];
    g.tab.forEach((col, i) => col.forEach((_, j) => srcs.push({ k: 't', i, j })));
    for (let i = 0; i < 4; i++) srcs.push({ k: 'c', i });
    for (const f of srcs) for (const d of E.legalMovesFrom(g, f)) {
      const cards = E.cardsAt(g, f);
      out.push({ f, d: d.k === 'f' ? { k: 'f', suit: E.cardSuit(cards[0]) } : d });
    }
    return out;
  }

  // ===== Spielt viele zufällige legale Züge; prüft Invarianten =====
  async function randomPlay(p, steps, label) {
    let n = 0;
    const g0 = await state(p);
    const free = g0.free;
    const top0 = await topOf(p);
    for (let s = 0; s < steps; s++) {
      let g = await state(p);
      if (g.mode === 'over') break;
      const list = legalList(g);
      const fl = list.filter((m) => m.d.k === 'f');
      const canDraw = !free && (g.stock.length || g.waste.length);
      let action;
      if (fl.length && rnd() < 0.7) action = fl[Math.floor(rnd() * fl.length)];
      else if (canDraw && (rnd() < 0.35 || !list.length)) action = 'draw';
      else if (list.length) action = list[Math.floor(rnd() * list.length)];
      else if (g.undo.length) action = 'undo';
      else break;
      const before = g.moves;
      if (action === 'undo') { await p.click('[data-act=undo]'); await p.waitForTimeout(8); g = await state(p); balance(g); check(g.moves === before - 1, 'Zurück im Zufallsspiel'); continue; }
      if (action === 'draw') await p.locator('#board [data-k=s]').click();
      else { await tap(p, srcSel(action.f)); await p.waitForSelector('.pt-card.sel'); await tap(p, dstSel(action.d)); }
      n++;
      await p.waitForTimeout(8);
      g = await state(p);
      balance(g);
      check(g.moves === before + 1, `${label}: Zugzähler ${before} -> ${g.moves}`);
      check(g.tab.every((col, i) => col.length === 0 || g.down[i] < col.length), 'oberste Karte offen');
      // DOM passt zum Zustand
      const dom = await p.evaluate(() => document.querySelectorAll('.pt-tab .pt-card, .pt-tab .pt-slot').length);
      const want = g.tab.reduce((a, col) => a + Math.max(1, col.length), 0);
      check(dom === want, `${label}: DOM-Karten ${dom} != ${want}`);
      check(Math.abs((await topOf(p)) - top0) < 1.5, `${label}: Spielfeld verschoben`);
      if (s === 25) await p.screenshot({ path: `${SPDIR}/pt-${label}-mitte.png`, fullPage: true });
      if (s === 40) { await p.reload(); await p.waitForSelector('#board'); check(JSON.stringify((await state(p)).tab) === JSON.stringify(g.tab), 'Neuladen: gleicher Stand'); }
    }
    return n;
  }

  // ================= Klondike =================
  let p = await newPage(URL0);
  await p.waitForSelector('[data-act=solo]');
  check((await p.locator('#name, #code, [data-act=host]').count()) === 0, 'Start ohne Name/Code');
  await p.screenshot({ path: `${SPDIR}/pt-start.png`, fullPage: true });
  await p.click('[data-act=solo]');
  await p.waitForSelector('#board');
  let g = await state(p);
  check(!g.free && g.tab.length === 7 && g.stock.length === 24, 'Klondike ausgeteilt');
  check((await p.innerText('.pt-var')).trim() === 'Klondike', 'Spielart Klondike');
  const widths = await p.$$eval('.pt-card, .pt-slot', (els) => els.map((e) => e.getBoundingClientRect().width));
  check(Math.min(...widths) >= 44, 'Karten >= 44 px: ' + Math.min(...widths));
  check(Math.min(...widths) >= 50, 'Klondike-Karten ~52 px');
  const fs = await p.$eval('.pt-tab .pt-card:not(.back) .r', (e) => parseFloat(getComputedStyle(e).fontSize));
  check(fs >= 16, 'Rangzahl >= 16 px: ' + fs);
  const lay = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    btns: [...document.querySelectorAll('.pt-btnrow .btn, .pt-undo')].map((e) => e.getBoundingClientRect().height) }));
  check(lay.sw <= lay.iw, 'kein horizontaler Scroll');
  check(lay.btns.every((h) => h >= 48), 'Knöpfe >= 48 px: ' + lay.btns);
  check((await p.locator('[data-act=auto]').count()) === 0, 'Auto-Knopf zu Beginn unsichtbar');
  check((await p.locator('.pt-time, #pt-clock').count()) === 0, 'Zeit standardmäßig aus');
  check((await p.$$eval('.pt-top > *', (e) => e.length)) === 7, 'obere Reihe 7 Plätze');
  const T0 = await topOf(p);
  // Karte markieren/abwählen; falsches Ziel -> Hinweis
  await tap(p, '#board [data-k=t][data-i="6"][data-j="6"]');
  check((await p.locator('.pt-card.sel').count()) === 1, 'markiert');
  await p.screenshot({ path: `${SPDIR}/pt-k-markiert.png`, fullPage: true });
  await tap(p, '#board [data-k=w]'); // Ablage leer = kein Ziel
  check(/Dort kannst du die Karte nicht ablegen/.test(await p.innerText('.pt-msg')), 'freundlicher Hinweis');
  check(Math.abs((await topOf(p)) - T0) < 1.5, 'nichts springt (Hinweis)');
  check((await p.locator('.pt-card.sel').count()) === 1, 'Markierung bleibt nach falschem Ziel');
  await p.waitForTimeout(450);
  await tap(p, '#board [data-k=t][data-i="6"][data-j="6"]');
  check((await p.locator('.pt-card.sel').count()) === 0, 'Abwahl');
  // verdeckte Karte
  await tap(p, '#board [data-k=t][data-i="6"][data-j="0"]');
  check(/verdeckt/.test(await p.innerText('.pt-msg')), 'Hinweis verdeckt');
  // ziehen, Zurück
  await p.click('#board [data-k=s]');
  g = await state(p);
  check(g.waste.length === 1 && g.stock.length === 23 && g.moves === 1, 'Ziehen: 1 Karte');
  check((await p.innerText('.pt-stat b')) === '1', 'Zugzähler 1');
  await p.click('[data-act=undo]');
  g = await state(p);
  check(g.waste.length === 0 && g.stock.length === 24 && g.moves === 0, 'Zurück');
  check((await p.locator('[data-act=undo][disabled]').count()) === 1, 'Zurück nun aus');
  // Stapel leer ziehen und zurückführen
  for (let i = 0; i < 24; i++) await p.click('#board [data-k=s]');
  g = await state(p);
  check(g.stock.length === 0 && g.waste.length === 24, '24 gezogen');
  await p.screenshot({ path: `${SPDIR}/pt-k-stapel-leer.png`, fullPage: true });
  await p.click('#board [data-k=s]');
  g = await state(p);
  check(g.stock.length === 24 && g.waste.length === 0, 'Ablage zurück in den Stock');
  // Neues Spiel mit Rückfrage
  await p.click('[data-act=new]');
  check((await p.locator('.pt-confirm').count()) === 1, 'Rückfrage');
  await p.screenshot({ path: `${SPDIR}/pt-rueckfrage.png` });
  await p.click('[data-act=confirm-no]');
  check((await state(p)).moves === 25, 'Nein behält');
  const seedBefore = (await state(p)).seed;
  await p.click('[data-act=same]'); await p.click('[data-act=confirm-yes]');
  g = await state(p);
  check(g.seed === seedBefore && g.moves === 0 && g.stock.length === 24, 'Nochmal dasselbe Spiel: gleicher Seed');
  await p.click('#board [data-k=s]');
  await p.click('[data-act=new]'); await p.click('[data-act=confirm-yes]');
  g = await state(p);
  check(g.moves === 0 && g.seed !== seedBefore, 'Neues Spiel: neuer Seed');

  const nK = await randomPlay(p, 120, 'klondike');
  console.log('Klondike zufällige Züge:', nK);
  check(nK > 60, 'viele Züge gespielt');
  // Doppeltippen
  p = await newPage(`${URL0}?preset=klondike`);
  await p.click('[data-act=solo]'); await p.waitForSelector('#board');
  g = await state(p);
  check(g.found.join() === '13,12,12,13' && g.tab[0].length === 1, 'Fast-gelöst-Zustand');
  await p.screenshot({ path: `${SPDIR}/pt-preset.png`, fullPage: true });
  await p.locator('#board [data-k=t][data-i="0"]').click(); // markieren
  await p.locator('#board [data-k=t][data-i="0"]').click(); // Doppeltippen
  g = await state(p);
  check(g.found[1] === 13 && g.moves === 1, 'Doppeltippen legt oben ab');
  await tap(p, '#board [data-k=t][data-i="1"][data-j="0"]');
  await tap(p, '#board [data-k=f][data-i="2"]');
  await p.waitForSelector('.pt-over');
  check((await p.innerText('.pt-over h1')).trim() === 'Geschafft!', 'Geschafft!');
  check(/2 Züge/.test(await p.innerText('.pt-result')), 'Züge im Ergebnis');
  check(/\d+:\d\d/.test(await p.innerText('.pt-result')), 'Zeit im Ergebnis');
  check((await p.locator('canvas.confetti').count()) === 1, 'Konfetti');
  check(/Neue Bestleistung/.test(await p.innerText('.pt-over')), 'Bestleistung neu');
  let best = await p.evaluate(() => JSON.parse(localStorage.getItem('zh.pt_best_klondike')));
  check(best && best.moves === 2, 'Bestleistung gespeichert: ' + JSON.stringify(best));
  check((await p.evaluate(() => localStorage.getItem('zh.pt_best_freecell'))) === null, 'FreeCell-Bestwert getrennt');
  await p.screenshot({ path: `${SPDIR}/pt-ende.png`, fullPage: true });
  check((await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), 'Ergebnis: kein horizontaler Scroll');
  await p.reload(); await p.waitForSelector('.pt-over');
  check(/Bestleistung/.test(await p.innerText('.pt-over')) || /Geschafft/.test(await p.innerText('.pt-over')), 'Ende nach Neuladen');
  // Zurück am Ende? (Zurück-Knopf oben)
  await p.click('[data-act=undo]');
  check((await p.locator('.pt-over').count()) === 0 && (await state(p)).moves === 1, 'Zurück nach Gewinn');
  // Neues Spiel ohne Rückfrage nach neuem Spiel
  await p.click('[data-act=new]');
  check((await p.locator('.pt-confirm').count()) === 1, 'Rückfrage bei Zügen');
  await p.click('[data-act=confirm-yes]');
  check((await state(p)).stock.length === 24, 'Neues Spiel zufällig (nicht Preset)');

  // Spielart-Kästchen
  await p.click('#board [data-k=s]');
  await p.check('[data-opt=free]');
  check((await p.locator('.pt-confirm').count()) === 1, 'Spielartwechsel fragt nach');
  await p.click('[data-act=confirm-no]');
  check((await p.isChecked('[data-opt=free]')) === false, 'Nein stellt Kästchen zurück');
  check((await state(p)).moves === 1, 'Spiel bleibt');
  await p.check('[data-opt=draw3]');
  await p.click('[data-act=confirm-yes]');
  g = await state(p);
  check(g.draw3 && !g.free && g.moves === 0, 'Drei Karten ziehen aktiv');
  await p.click('#board [data-k=s]');
  g = await state(p);
  check(g.waste.length === 3 && g.stock.length === 21, 'drei Karten gezogen');
  await p.uncheck('[data-opt=draw3]'); await p.click('[data-act=confirm-yes]');
  check(!(await state(p)).draw3, 'zurück auf eine Karte');
  // Zeit anzeigen
  await p.check('[data-opt=time]');
  check((await p.locator('#pt-clock').count()) === 1, 'Zeit wird angezeigt');
  check((await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), 'mit Zeit: kein horizontaler Scroll');
  await p.uncheck('[data-opt=time]');
  // Hilfe
  await p.click('[data-act=help]'); await p.waitForSelector('.modal');
  check(/FreeCell/.test(await p.innerText('.modal')) && /Klondike/.test(await p.innerText('.modal')) && !/olit(a|ä)r/i.test(await p.innerText('.modal')), 'Hilfetext');
  await p.screenshot({ path: `${SPDIR}/pt-hilfe.png` });
  await p.click('.modal [data-act=help-close]');

  // ================= FreeCell =================
  p = await newPage(URL0);
  await p.click('[data-act=solo]'); await p.waitForSelector('#board');
  await p.check('[data-opt=free]');
  g = await state(p);
  check(g.free && g.tab.length === 8 && g.cells.length === 4, 'FreeCell läuft');
  check((await p.locator('[data-opt=draw3]').count()) === 0, 'Drei Karten ziehen bei FreeCell ausgeblendet');
  const w8 = await p.$$eval('.pt-card, .pt-slot', (els) => els.map((e) => e.getBoundingClientRect().width));
  check(Math.min(...w8) >= 44, 'FreeCell-Karten >= 44 px: ' + Math.min(...w8));
  check((await p.$$eval('.pt-top > *', (e) => e.length)) === 8, 'Zellen + Ziel in einer Reihe (8)');
  const lay8 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(lay8.sw <= lay8.iw, 'FreeCell: kein horizontaler Scroll');
  await p.screenshot({ path: `${SPDIR}/pt-f-start.png`, fullPage: true });
  // Karte in Zelle
  await tap(p, '#board [data-k=t][data-i="0"][data-j="6"]');
  await tap(p, '#board [data-k=c][data-i="1"]');
  g = await state(p);
  check(g.cells[1] !== null && g.tab[0].length === 6 && g.moves === 1, 'Karte in Zelle');
  await p.screenshot({ path: `${SPDIR}/pt-f-zelle.png`, fullPage: true });
  // Mehrfachzug zu lang -> freundlicher Hinweis (wenn möglich), sonst nur falsches Ziel
  await p.click('[data-act=undo]');
  g = await state(p);
  check(g.cells.every((x) => x === null) && g.tab[0].length === 7, 'Zurück aus Zelle');
  const nF = await randomPlay(p, 120, 'freecell');
  console.log('FreeCell zufällige Züge:', nF);
  check(nF > 50, 'viele Züge gespielt (FreeCell)');
  // Fast gelöst FreeCell
  p = await newPage(`${URL0}?preset=freecell`);
  await p.click('[data-act=solo]'); await p.waitForSelector('#board');
  g = await state(p);
  check(g.free && g.found.join() === '13,12,12,13', 'FreeCell fast gelöst');
  await tap(p, '#board [data-k=t][data-i="0"][data-j="0"]'); await tap(p, '#board [data-k=f][data-i="1"]');
  await tap(p, '#board [data-k=t][data-i="1"][data-j="0"]'); await tap(p, '#board [data-k=f][data-i="2"]');
  await p.waitForSelector('.pt-over');
  best = await p.evaluate(() => JSON.parse(localStorage.getItem('zh.pt_best_freecell')));
  check(best && best.moves === 2, 'FreeCell-Bestleistung');
  check((await p.evaluate(() => localStorage.getItem('zh.pt_best_klondike'))) === null, 'Klondike-Bestwert getrennt');
  await p.screenshot({ path: `${SPDIR}/pt-f-ende.png`, fullPage: true });
  check((await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), 'FreeCell-Ergebnis: kein horizontaler Scroll');

  // ================= Automatisch ablegen (FreeCell: geordnete Reihen via Test-Zustand) =================
  p = await newPage(URL0, { width: 390, height: 844 }, true);
  await p.click('[data-act=solo]'); await p.waitForSelector('#board');
  await p.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('zh.pt.hostState'));
    const gm = h.game;
    gm.tab = [[12, 10 + 13 * 3 - 13 * 0]]; // wird gleich überschrieben
    const seq = (s0, s1) => { const o = []; for (let r = 13; r >= 1; r--) o.push(((13 - r) % 2 === 0 ? s0 : s1) * 13 + r - 1); return o; };
    gm.free = true; gm.draw3 = false; gm.tab = [seq(0, 2), seq(1, 3), seq(2, 0), seq(3, 1), [], [], [], []]; gm.down = new Array(8).fill(0);
    gm.stock = []; gm.waste = []; gm.found = [0, 0, 0, 0]; gm.cells = [null, null, null, null]; gm.undo = []; gm.moves = 0;
    localStorage.setItem('zh.pt.hostState', JSON.stringify(h));
  });
  await p.reload(); await p.waitForSelector('#board');
  await p.waitForSelector('[data-act=auto]');
  check((await p.innerText('[data-act=auto]')).trim() === 'Automatisch ablegen', 'Auto-Knopf da');
  await p.screenshot({ path: `${SPDIR}/pt-auto.png`, fullPage: true });
  await p.click('[data-act=auto]');
  await p.waitForSelector('.pt-over');
  check(/52 Züge/.test(await p.innerText('.pt-result')), 'Auto: 52 Züge');
  await p.click('[data-act=undo]');
  g = await state(p);
  check(g.moves === 0 && g.tab[0].length === 13, 'Ein Zurück macht Auto rückgängig');

  // ================= Lernrunde =================
  p = await newPage(URL0);
  await p.waitForSelector('[data-act=learn]');
  await p.click('[data-act=learn]');
  await p.waitForSelector('.coach');
  g = await state(p);
  check(!g.free && g.learn && g.tab.length === 7, 'Lernrunde Klondike');
  check((await p.locator('.pt-opts, [data-act=new]').count()) === 0, 'Lernrunde ohne Einstellungen/Neu');
  const texts = [];
  let reloaded = false, shots = 0, undoLesson = false;
  for (let k = 0; k < 40; k++) {
    const snap = await p.evaluate(() => ({ txt: document.querySelector('.coach .coach-t').innerText.trim(), n: document.querySelectorAll('.coach-target').length }));
    if (!texts.includes(snap.txt)) { texts.push(snap.txt); if (shots < 6) await p.screenshot({ path: `${SPDIR}/pt-lern-${++shots}.png` }); }
    if (/Prima/.test(snap.txt)) break;
    check(snap.n > 0, 'Kein Ziel in Lernrunde: ' + snap.txt);
    if (/Mit Zurück nimmst/.test(snap.txt)) undoLesson = true;
    if (/Pik 9/.test(snap.txt) && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach'); }
    await p.locator('.coach-target').first().click({ position: { x: 6, y: 5 } });
    await p.waitForTimeout(450); // kein Doppeltippen
  }
  check(undoLesson, 'Zurück-Lektion kam vor');
  check(texts.some((t) => /sieben Spalten/.test(t)) && texts.some((t) => /aufgedeckt/.test(t)) && texts.some((t) => /Zielstapel/.test(t)), 'Lektionen: Spalten, Aufdecken, Zielstapel');
  check(texts.some((t) => /rot auf schwarz/.test(t)), 'Lektion absteigend/abwechselnd');
  check(texts.some((t) => /Stapel/.test(t)), 'Lektion Stapel');
  check(texts.some((t) => /Prima/.test(t)), 'Lernrunde erreicht das freie Spiel');
  console.log(texts.join('\n'));
  await p.click('[data-act=learn-stop]');
  check((await p.locator('.coach').count()) === 0, 'Coach weg');
  await p.reload(); await p.waitForSelector('#board');
  check((await p.locator('.coach').count()) === 0, 'nach Neuladen kein Coach');
  check((await p.locator('[data-act=new]').count()) === 1, 'Nach der Lernrunde: Neues Spiel da');

  console.log('errors', JSON.stringify(errors));
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.stack || e.message); process.exit(1); });
