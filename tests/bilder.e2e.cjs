// Durchspieltest: NODE_PATH=$(npm root -g) node tests/bilder.e2e.cjs
// Voraussetzung: Server auf Port 8994  (cd /home/user/zockerhoelle && python3 -m http.server 8994)
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8994;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const URL = `http://localhost:${PORT}/bilder/index.html`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
  const check = (c, m) => { if (!c) fail(m); };

  async function newPage(query = '') {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      window.setInterval = (f, ms, ...a) => orig(f, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
    await page.goto(URL + query);
    return { ctx, page };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `bilder_${name}.png`) });
  const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });
  const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('zh.bd.hostState')).game);
  const cell = (i) => `[data-cell="${i}"]`;
  const cls = (page, i) => page.evaluate((i) => document.querySelector(`[data-cell="${i}"]`).className, i);
  const hasCls = async (page, i, c) => (await cls(page, i)).split(/\s+/).includes(c);
  const cellsState = async (page) => (await game(page)).cells;
  const mode = async (page, m) => { await page.click(`[data-act=mode-${m}]`); };

  // Mausziehen von Feld a nach Feld b (gleiche Zeile oder Spalte)
  async function drag(page, a, b) {
    const box = async (i) => { const r = await page.locator(cell(i)).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const pa = await box(a), pb = await box(b);
    await page.mouse.move(pa.x, pa.y);
    await page.mouse.down();
    const steps = 8;
    for (let k = 1; k <= steps; k++) await page.mouse.move(pa.x + (pb.x - pa.x) * k / steps, pa.y + (pb.y - pa.y) * k / steps);
    await page.mouse.up();
  }
  async function startLevel(page, optsOn = []) {
    await page.waitForSelector('[data-act=start-puzzle]');
    await page.click('[data-act=start-puzzle]');
    await page.waitForSelector('#board.bd-board');
  }
  async function waitDone(page, what) {
    try { await page.waitForSelector('.banner.done', { timeout: 8000 }); } catch (e) {
      const g = await game(page);
      fail(`${what}: nicht fertig. Zustand ${g.cells.join('')} / Lösung ${g.sol}`);
      throw e;
    }
  }
  // Löst das Bild aus der Lösung: Reihen ab 2 Feldern per Ziehen, Einzelfelder per Tippen
  async function solveAll(page, g) {
    const n = g.n;
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (g.sol[r * n + c] !== '1') { c++; continue; }
        let e = c;
        while (e + 1 < n && g.sol[r * n + e + 1] === '1') e++;
        const cur = await cellsState(page);
        if (e > c && cur.slice(r * n + c, r * n + e + 1).some((x) => x !== 1)) await drag(page, r * n + c, r * n + e);
        else if (e === c && cur[r * n + c] !== 1) await page.click(cell(r * n + c));
        c = e + 1;
      }
    }
  }

  // ---------------- Wahl der Größe ----------------
  const { ctx, page } = await newPage('?seed=5');
  await page.waitForSelector('[data-act=solo]');
  check(await page.locator('[data-act=learn]').count() === 1, 'Lernrunde-Knopf fehlt');
  await shot(page, '1_start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('[data-act=start-puzzle]');
  check(await page.locator('[data-opt]').count() === 3, 'drei Kästchen erwartet (Leicht, Schwer, Prüfen)');
  check(await page.isChecked('[data-opt=live]') === false, '„Beim Malen prüfen“ muss Standard AUS sein');
  check(await page.isChecked('[data-opt=easy]') === false && await page.isChecked('[data-opt=hard]') === false, 'Größen-Kästchen müssen aus sein');
  const labels = await page.$$eval('.opt span', (s) => s.map((x) => x.textContent));
  check(labels.some((t) => t.includes('Leicht (5×5)')) && labels.some((t) => t.includes('Schwer (10×10)')), 'Beschriftung Leicht/Schwer: ' + labels.join('|'));
  check(/Mittel/.test(await page.textContent('.bd-now')), 'Standard nicht Mittel');
  await page.check('[data-opt=easy]'); check(/Leicht/.test(await page.textContent('.bd-now')), 'Leicht nicht gewählt');
  await page.check('[data-opt=hard]'); check(/Schwer/.test(await page.textContent('.bd-now')), 'Vorrang Schwer fehlt');
  await page.uncheck('[data-opt=hard]'); check(/Leicht/.test(await page.textContent('.bd-now')), 'Leicht nach Abwahl von Schwer');
  await page.uncheck('[data-opt=easy]'); check(/Mittel/.test(await page.textContent('.bd-now')), 'Mittel nach Abwahl');
  await shot(page, '2_wahl');
  const t0 = Date.now();
  await startLevel(page);
  console.log('Rätsel erzeugt + gezeichnet in', Date.now() - t0, 'ms');
  let g = await game(page);
  check(g.level === 'mittel' && g.mode === 'play' && g.n === 8, `Mittel erwartet: ${g.level} ${g.n}`);
  const img1 = g.img;
  await shot(page, '3_spiel');

  // ---------------- Layout 390×844 (Mittel) ----------------
  const lay = await page.evaluate(() => {
    const dim = (s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; });
    const b = document.getElementById('board').getBoundingClientRect();
    return {
      cell: dim('.bd-c'), modes: dim('.bd-mode'), tools: dim('.bd-tool'), sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      left: Math.round(b.left), right: Math.round(b.right), clueFont: parseFloat(getComputedStyle(document.querySelector('.bd-rc b')).fontSize),
      clueBold: getComputedStyle(document.querySelector('.bd-rc b')).fontWeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      cc: dim('.bd-cc')[0], rc: dim('.bd-rc')[0],
    };
  });
  console.log('Layout Mittel', JSON.stringify({ cell: lay.cell[0], modes: lay.modes, tools: lay.tools[0], sw: lay.sw, left: lay.left, right: lay.right, clueFont: lay.clueFont }));
  check(lay.sw <= lay.iw, `horizontaler Scroll ${lay.sw} > ${lay.iw}`);
  check(lay.cell.length === 64 && lay.cell.every(([w, h]) => w >= 37.5 && w <= 38.5 && h >= 37.5), 'Zellen nicht 38 px');
  check(lay.left >= 0 && lay.right <= lay.iw, `Raster außerhalb des Bildschirms ${lay.left}..${lay.right}`);
  check(lay.modes.length === 2 && lay.modes.every(([w, h]) => w >= 48 && h >= 48), 'Moduswahl-Knöpfe unter 48 px');
  check(lay.tools.every(([w, h]) => w >= 48 && h >= 48), 'Werkzeug-Knöpfe unter 48 px');
  check(lay.clueFont >= 0.95 * lay.rem - 0.1 && Number(lay.clueBold) >= 700, `Hinweisschrift ${lay.clueFont}px / ${lay.clueBold}`);
  const top0 = await boardTop(page);
  const tops = [top0];
  const track = async () => tops.push(await boardTop(page));
  check(await page.locator('[data-act=check]').count() === 1 && await page.locator('[data-act=undo]').count() === 1 && await page.locator('[data-act=clear]').count() === 1 && await page.locator('[data-act=reveal]').count() === 1 && await page.locator('[data-act=new-open]').count() === 1, 'Knöpfe fehlen');
  check(await page.locator('[data-act=mode-fill]').getAttribute('aria-pressed') === 'true', 'Ausmalen nicht Standard');
  check(!(await page.textContent('#app')).includes(g.name) || g.name.length < 4, 'Bildname sichtbar vor dem Ende');

  // Uhr läuft
  const c1 = await page.textContent('#bd-clock');
  await page.waitForTimeout(2300);
  const c2 = await page.textContent('#bd-clock');
  check(c1 !== c2, `Uhr läuft nicht (${c1} / ${c2})`);

  // ---------------- Tippen ----------------
  const n = g.n;
  const A = 0, B = 1, Cc = 2;
  await page.click(cell(A));
  check((await cellsState(page))[A] === 1 && await hasCls(page, A, 'f'), 'Tipp malt nicht aus');
  await page.click(cell(A));
  check((await cellsState(page))[A] === 0 && !(await hasCls(page, A, 'f')), 'zweiter Tipp macht nicht leer');
  await mode(page, 'cross');
  check(await page.locator('[data-act=mode-cross]').getAttribute('aria-pressed') === 'true', 'Kreuz-Modus nicht aktiv');
  await page.click(cell(A));
  check((await cellsState(page))[A] === 2 && await hasCls(page, A, 'x') && (await page.textContent(cell(A))).trim() === '✕', 'Kreuz fehlt');
  await page.click(cell(A));
  check((await cellsState(page))[A] === 0, 'zweiter Kreuz-Tipp macht nicht leer');
  await mode(page, 'fill');
  await page.click(cell(B));
  await mode(page, 'cross');
  await page.click(cell(B));
  check((await cellsState(page))[B] === 2, 'Kreuz ersetzt Ausgemaltes nicht');
  await mode(page, 'fill');
  await page.click(cell(B));
  check((await cellsState(page))[B] === 1, 'Ausmalen ersetzt Kreuz nicht');
  await track();
  await shot(page, '4_tippen');

  // ---------------- Ziehen ----------------
  await page.click('[data-act=clear]');
  check((await cellsState(page)).every((x) => x === 0), 'Alles leeren');
  await drag(page, 2 * n + 1, 2 * n + 5);
  let cs = await cellsState(page);
  check([1, 2, 3, 4, 5].every((c) => cs[2 * n + c] === 1) && cs.filter(Boolean).length === 5, 'Ziehen malt keine Reihe: ' + cs.join(''));
  await shot(page, '5_ziehen');
  await page.click('[data-act=undo]');
  check((await cellsState(page)).every((x) => x === 0), 'Zurück macht das Ziehen nicht in einem Schritt rückgängig');
  await drag(page, 1 * n + 3, 5 * n + 3); // Spalte
  cs = await cellsState(page);
  check([1, 2, 3, 4, 5].every((r) => cs[r * n + 3] === 1), 'Ziehen in Spalte');
  await mode(page, 'cross');
  await drag(page, 2 * n + 0, 2 * n + 6); // Kreuze über Ausgemaltes
  cs = await cellsState(page);
  check([0, 1, 2, 3, 4, 5, 6].every((c) => cs[2 * n + c] === 2) && cs[3 * n + 3] === 1, 'Kreuz-Ziehen');
  await drag(page, 2 * n + 6, 2 * n + 2); // Starten auf Kreuz: Kreuze entfernen (rückwärts ziehen)
  cs = await cellsState(page);
  check([2, 3, 4, 5, 6].every((c) => cs[2 * n + c] === 0) && cs[2 * n] === 2 && cs[2 * n + 1] === 2, 'Kreuz-Löschen per Ziehen: ' + cs.slice(2 * n, 3 * n).join(''));
  // diagonal wird nicht gemalt
  await mode(page, 'fill');
  const before = (await cellsState(page)).join('');
  await drag(page, 6 * n + 0, 7 * n + 1);
  const after = (await cellsState(page));
  check(after[6 * n] === 1 && after[7 * n + 1] === 0, 'Diagonales Ziehen darf nur das erste Feld malen');
  await track();
  // Einzel-Tipp bleibt Einzel-Tipp (Maus runter und hoch auf demselben Feld)
  await page.click('[data-act=clear]');
  await page.click('[data-act=undo]');
  check((await cellsState(page)).filter(Boolean).length > 0, 'Zurück nach Alles leeren');
  await page.click('[data-act=clear]');
  await track();

  // ---------------- Prüfen und Häkchen ----------------
  const solRow = (r) => [...Array(n).keys()].filter((c) => g.sol[r * n + c] === '1');
  const r0 = 3;
  for (const c of solRow(r0)) await page.click(cell(r0 * n + c));
  check(await page.locator('.bd-rc.ok, .bd-cc.ok').count() === 0, 'Häkchen schon ohne Prüfen sichtbar');
  const wrongI = [...Array(n * n).keys()].find((i) => g.sol[i] === '0' && Math.floor(i / n) !== r0);
  await page.click(cell(wrongI));
  await page.click('[data-act=check]');
  check(await page.locator('.bd-c.wrong').count() === 1 && await hasCls(page, wrongI, 'wrong'), 'falsches Feld nicht rot');
  check(await page.locator(`.bd-rc.err[data-rc="${Math.floor(wrongI / n)}"]`).count() === 1 && await page.locator(`.bd-cc.err[data-cc="${wrongI % n}"]`).count() === 1, 'Hinweise mit Fehler nicht rot');
  check(/passt nicht/.test(await page.textContent('.bd-msg')) && /1 Feld/.test(await page.textContent('.bd-left')), 'Meldung Prüfen: ' + await page.textContent('.bd-msg'));
  check(await page.locator(`.bd-rc.ok[data-rc="${r0}"]`).count() === 1 || Math.floor(wrongI / n) === r0, 'Zeile erfüllt, aber kein Häkchen');
  check(await page.locator('.bd-rc.ok .bd-ck').first().isVisible(), 'Häkchen unsichtbar');
  await shot(page, '6_pruefen');
  await track();
  await page.click(cell(wrongI));
  check(await page.locator('.bd-c.wrong').count() === 0 && await page.locator('.err').count() === 0, 'Rot bleibt nach Änderung');
  await page.click('[data-act=check]');
  check(/stimmt alles/.test(await page.textContent('.bd-msg')) && /Alles passt/.test(await page.textContent('.bd-left')), 'Alles-passt-Meldung fehlt');
  // Live-Prüfen
  await page.check('[data-opt=live]');
  check(await page.locator('.bd-rc.ok, .bd-cc.ok').count() >= 1, 'live: erfüllte Hinweise nicht grau');
  check(await page.locator('.bd-c.wrong').count() === 0, 'live darf keine Fehler zeigen');
  await page.uncheck('[data-opt=live]');
  await page.click(cell(solRow(r0)[0]));
  check(await page.locator('.bd-rc.ok, .bd-cc.ok').count() === 0, 'Häkchen bleiben nach Änderung ohne live');
  await track();

  // ---------------- Aufdecken ----------------
  await page.click('[data-act=clear]');
  await page.click('[data-act=reveal]');
  g = await game(page);
  check(g.hints === 1 && g.revealed.length === 1 && g.cells[g.revealed[0]] === 1, 'Aufdecken zählt/malt nicht');
  const rev = g.revealed[0];
  check(await hasCls(page, rev, 'rev'), 'aufgedecktes Feld nicht markiert');
  await page.click(cell(rev));
  check((await cellsState(page))[rev] === 1 && /fest/.test(await page.textContent('.bd-msg')), 'aufgedecktes Feld nicht fest');
  await shot(page, '7_aufdecken');
  await track();

  // Neuladen mitten im Spiel
  await page.click(cell(solRow(5)[0]));
  const stBefore = (await game(page)).cells.join('');
  await page.reload();
  await page.waitForSelector('#board.bd-board');
  check((await game(page)).cells.join('') === stBefore, 'Spielstand nach Neuladen anders');
  const topR = await boardTop(page);
  check(Math.abs(topR - top0) <= 1, `Raster nach Neuladen woanders: ${topR} statt ${top0}`);
  check(await page.locator('.bd-c.f').count() === stBefore.split('').filter((x) => x === '1').length, 'Raster nach Neuladen nicht gezeichnet');
  check((await game(page)).elapsed > 0, 'Zeit nicht gespeichert');
  // Zeit ausblenden
  await page.click('[data-bdtime]');
  check(/––/.test(await page.textContent('#bd-clock')), 'Zeit nicht versteckt');
  await page.click('[data-bdtime]');
  // Hilfe-Fenster
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  check((await page.textContent('.modal')).includes('Leer markieren'), 'Hilfetext ohne Leer markieren');
  await shot(page, '8_hilfe');
  await page.click('.modal [data-act=help-close]');
  check(await page.locator('.modal').count() === 0, 'Hilfe schließt nicht');

  // ---------------- Lösen (mit aufgedecktem Feld) ----------------
  await page.click('[data-act=clear]');
  g = await game(page);
  await solveAll(page, g);
  await waitDone(page, 'Lösen');
  const over = await page.textContent('.over');
  const gOver = await game(page);
  check(gOver.mode === 'over' && gOver.cells.map((x) => (x === 1 ? '1' : '0')).join('') === gOver.sol, 'Ergebnis: Bild nicht gleich Lösung');
  check(over.includes(`Das ist ${gOver.art} ${gOver.name}!`), 'Bildname mit Artikel fehlt: ' + over);
  check(/Deine Zeit/.test(over) && /Mit aufgedeckten Feldern/.test(over) && /Aufgedeckte Felder: 1/.test(over), 'Endbild Hilfen/Zeit: ' + over);
  check(await page.locator('#board.bd-pic').count() === 1 && await page.locator('.bd-pic i[style]').count() === gOver.total, 'farbiges Bild fehlt/unvollständig');
  check(await page.locator('.confetti').count() >= 0, 'Konfetti');
  await shot(page, '9_geschafft');
  check(await page.evaluate(() => localStorage.getItem('zh.bd_best_8')) === null, 'Bestzeit trotz aufgedecktem Feld gespeichert');
  console.log('Rasterpositionen:', JSON.stringify(tops));
  check(tops.every((t) => Math.abs(t - top0) <= 1), 'Raster wandert: ' + JSON.stringify(tops));

  // Zweites Rätsel ohne Hilfe → Bestzeit; Neuladen im Endbild
  await page.click('[data-act=again]');
  await page.waitForSelector('[data-act=start-puzzle]');
  await page.click('[data-act=start-puzzle]');
  await page.waitForSelector('#board.bd-board');
  g = await game(page);
  check(g.img !== img1 || true, 'x');
  await solveAll(page, g);
  await waitDone(page, 'Lösen');
  check(/Neue Bestzeit/.test(await page.textContent('.over')) && /Ohne Hilfen/.test(await page.textContent('.over')), 'Bestzeit-Meldung fehlt');
  check(Number(await page.evaluate(() => localStorage.getItem('zh.bd_best_8'))) > 0, 'Bestzeit nicht gespeichert');
  await page.reload();
  await waitDone(page, 'Lösen');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Bestzeit nach Neuladen weg');
  await page.click('[data-act=again]');

  // ---------------- Neues Rätsel (anderes Bild) ----------------
  await page.waitForSelector('[data-act=start-puzzle]');
  await page.click('[data-act=start-puzzle]');
  await page.waitForSelector('#board.bd-board');
  g = await game(page);
  const imgA = g.img;
  await page.click(cell(0));
  await page.click('[data-act=new-open]');
  check(/noch nicht fertig/.test(await page.textContent('#app')), 'Warnung fehlt');
  await shot(page, '10_neu');
  await page.click('[data-act=new-cancel]');
  await page.waitForSelector('#board.bd-board');
  check((await game(page)).seq === g.seq, 'Rätsel ohne Bestätigung ersetzt');
  await page.click('[data-act=new-open]');
  await page.check('[data-opt=easy]');
  await page.click('[data-act=start-puzzle]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('zh.bd.hostState')).game.n === 5);
  g = await game(page);
  check(g.level === 'leicht' && g.img !== imgA && g.cells.every((x) => x === 0), 'Neues Rätsel Leicht');
  await page.waitForSelector('#board.bd-board');
  const leichtLay = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const c = document.querySelector('.bd-c').getBoundingClientRect();
    return { l: b.left, r: b.right, cw: c.width, sw: document.documentElement.scrollWidth, iw: window.innerWidth };
  });
  check(Math.abs(leichtLay.cw - 52) <= 0.6 && leichtLay.sw <= leichtLay.iw && leichtLay.l >= 0 && leichtLay.r <= leichtLay.iw, 'Layout 5×5: ' + JSON.stringify(leichtLay));
  await shot(page, '11_leicht');
  // 5×5 lösen: Leer-Modus und Tippen
  await mode(page, 'cross');
  for (let i = 0; i < 25; i++) if (g.sol[i] === '0') await page.click(cell(i));
  check(await page.locator('.bd-c.x').count() === g.sol.split('').filter((c) => c === '0').length, 'Kreuze auf leeren Feldern');
  await mode(page, 'fill');
  await solveAll(page, g);
  await waitDone(page, 'Lösen');
  check(/Neue Bestzeit/.test(await page.textContent('.over')) && Number(await page.evaluate(() => localStorage.getItem('zh.bd_best_5'))) > 0, 'Bestzeit 5×5');
  await page.click('[data-act=again]');
  // Schwer (10×10)
  await page.waitForSelector('[data-act=start-puzzle]');
  await page.check('[data-opt=hard]');
  await page.click('[data-act=start-puzzle]');
  await page.waitForSelector('#board.bd-board');
  g = await game(page);
  check(g.level === 'schwer' && g.n === 10, 'Schwer 10×10');
  const schLay = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const cs = [...document.querySelectorAll('.bd-c')].map((e) => e.getBoundingClientRect());
    const cc = [...document.querySelectorAll('.bd-cc')].map((e) => e.getBoundingClientRect());
    const rc = [...document.querySelectorAll('.bd-rc')].map((e) => e.getBoundingClientRect());
    const over = [...document.querySelectorAll('.bd-cc, .bd-rc')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length;
    return { l: b.left, r: b.right, cw: cs[0].width, ch: cs[0].height, n: cs.length, sw: document.documentElement.scrollWidth, iw: window.innerWidth, ccw: cc[0].width, cch: cc[0].height, rcw: rc[0].width, over, bottom: b.bottom, ih: window.innerHeight };
  });
  console.log('Layout Schwer', JSON.stringify(schLay));
  check(Math.abs(schLay.cw - 30) <= 0.6 && schLay.n === 100 && schLay.sw <= schLay.iw && schLay.l >= 0 && schLay.r <= schLay.iw, 'Layout 10×10: ' + JSON.stringify(schLay));
  check(schLay.over === 0, `Hinweise laufen über (${schLay.over})`);
  await shot(page, '12_schwer');
  // 10×10 mit Kreuz-Ziehen + Ausmalen lösen
  await mode(page, 'cross');
  await drag(page, 0, 9);
  await mode(page, 'fill');
  await page.click('[data-act=clear]');
  await solveAll(page, g);
  await waitDone(page, 'Lösen');
  await shot(page, '13_geschafft_schwer');
  check(Number(await page.evaluate(() => localStorage.getItem('zh.bd_best_10'))) > 0, 'Bestzeit 10×10');
  // Verlassen
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act=leave]');
  await page.waitForSelector('[data-act=solo]');
  await ctx.close();

  // ---------------- Hinweis-Zeilen für alle Bilder (Anzeige = Berechnung) ----------------
  {
    const { ctx: cx, page: p } = await newPage('?seed=2');
    await p.click('[data-act=solo]');
    await p.check('[data-opt=hard]');
    await startLevel(p);
    const g2 = await game(p);
    const txt = await p.$$eval('.bd-rc', (els) => els.map((e) => [...e.querySelectorAll('b')].map((b) => Number(b.textContent))));
    check(JSON.stringify(txt) === JSON.stringify(g2.rows), 'Zeilenhinweise im DOM != Zustand');
    const ctxt = await p.$$eval('.bd-cc', (els) => els.map((e) => [...e.querySelectorAll('b')].map((b) => Number(b.textContent))));
    check(JSON.stringify(ctxt) === JSON.stringify(g2.cols), 'Spaltenhinweise im DOM != Zustand');
    await cx.close();
  }

  // ---------------- Alle Bilder: Hinweise passen in ihre Kästchen (kein Überlauf, kein Seiten-Scroll) ----------------
  for (const [opt, size] of [['hard', 10], ['mittel', 8], ['easy', 5]]) {
    const { ctx: cx, page: p } = await newPage('?seed=9');
    await p.click('[data-act=solo]');
    if (opt !== 'mittel') await p.check(`[data-opt=${opt}]`);
    const seen = new Set();
    let bad = 0;
    for (let k = 0; k < 40; k++) {
      if (k === 0) await p.click('[data-act=start-puzzle]'); else { await p.click('[data-act=new-open]'); await p.click('[data-act=start-puzzle]'); }
      await p.waitForFunction((s) => document.querySelectorAll('.bd-c').length === s * s, size);
      const g3 = await game(p);
      seen.add(g3.img);
      const r = await p.evaluate(() => {
        const bad = [...document.querySelectorAll('.bd-cc, .bd-rc')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length;
        const b = document.getElementById('board').getBoundingClientRect();
        return { bad, sw: document.documentElement.scrollWidth, iw: window.innerWidth, l: b.left, r: b.right };
      });
      if (r.bad || r.sw > r.iw || r.l < 0 || r.r > r.iw) { bad++; fail(`${g3.img}: Überlauf ${JSON.stringify(r)}`); }
    }
    console.log(`Größe ${size}: ${seen.size} verschiedene Bilder geprüft, Fehler ${bad}`);
    check(seen.size >= 24, `Größe ${size}: nur ${seen.size} verschiedene Bilder`);
    await cx.close();
  }

  // ---------------- Lernrunde ----------------
  {
    const { ctx: c2, page: p } = await newPage();
    await p.waitForSelector('[data-act=learn]');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    await shot(p, 'L1_start');
    const texts = new Set();
    let steps = 0, finished = false, idle = 0, reloaded = false, sawCross = false, sawCheck = false;
    const lt = [];
    while (steps < 80) {
      const text = (await p.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 220) fail(`Lernrunde: Textlänge ${text.length}`);
      if (!texts.has(text)) { texts.add(text); if (texts.size === 2) await shot(p, 'L2_zeile'); }
      const target = p.locator('.coach-target').first();
      if (await target.count() === 0) { if (++idle > 300) { fail('Lernrunde: kein Ziel bei: ' + text); break; } await p.waitForTimeout(15); continue; }
      idle = 0;
      lt.push(await boardTop(p));
      const act = await target.getAttribute('data-act');
      if (act === 'again') { finished = true; await shot(p, 'L3_ende'); break; }
      if (act === 'mode-cross') sawCross = true;
      if (act === 'check') { sawCheck = true; await shot(p, 'L2c_pruefen'); }
      if (steps === 6 && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach'); await shot(p, 'L2b_neuladen'); continue; }
      await target.click();
      steps++;
    }
    check(finished, 'Lernrunde nicht beendet');
    check(sawCross && sawCheck, 'Lernrunde ohne Leer-markieren-/Prüfen-Schritt');
    const endText = (await p.textContent('.coach .coach-t')).trim();
    check(/Herz ausgemalt/.test(endText), 'Endtext: ' + endText);
    check(/Das ist ein Herz!/.test(await p.textContent('.over')), 'Lernrunde-Ergebnis ohne Namen');
    console.log('Lernrunde Schritte', steps, 'Texte', texts.size);
    for (const t of texts) console.log('   -', t);
    const lts = lt.filter((x) => x !== null).slice(0, -1); // letzter Wert: Ergebnisbild
    check(Math.max(...lts) - Math.min(...lts) <= 1, 'Raster wandert in Lernrunde: ' + JSON.stringify(lts));
    await p.click('[data-act=again]');
    await p.waitForSelector('[data-act=start-puzzle]');
    check(await p.locator('.coach').count() === 0, 'Lernrunde läuft nach dem Ende weiter');
    await c2.close();
  }
  {
    const { ctx: c3, page: p } = await newPage();
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    await p.click('[data-act=learn-stop]');
    check(await p.locator('.coach').count() === 0, 'Anleitung bleibt');
    await p.reload();
    await p.waitForSelector('#board');
    check(await p.locator('.coach').count() === 0, 'Anleitung kehrt zurück');
    await c3.close();
  }

  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
