// Durchspieltest Kreuzworträtsel: NODE_PATH=$(npm root -g) node tests/kreuzwort.e2e.cjs
// Voraussetzung: Server auf Port 8983  (cd /home/user/zockerhoelle && python3 -m http.server 8983)
// Das Spiel ist ein Solo-Rätsel (soloOnly): Host/Gast gibt es nicht. Rätsel kommen per ?seed=N reproduzierbar.
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8983;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const URL = (seed) => `http://localhost:${PORT}/kreuzwort/index.html?seed=${seed}`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
  const check = (c, m) => { if (!c) fail(m); };

  async function newPage(vp = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      window.setInterval = (f, ms, ...a) => orig(f, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      const st = window.setTimeout.bind(window);
      window.setTimeout = (f, ms, ...a) => st(f, ms === 900 ? 20 : ms, ...a);
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
    return { ctx, page };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `kw_${name}.png`) });
  const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });
  const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('zh.kw.hostState')).game);
  const selIdx = (page) => page.evaluate(() => { const s = document.querySelector('.kw-c.sel'); return s ? Number(s.dataset.i) : -1; });
  const clue = (page) => page.evaluate(() => document.querySelector('.kw-clue').innerText.replace(/\s+/g, ' ').trim());
  const cellTxt = (page, i) => page.evaluate((i) => (document.querySelector(`[data-act=cell][data-i="${i}"] .kw-v`) || { textContent: '' }).textContent, i);
  const cells = (g, w) => Array.from({ length: w.len }, (_, k) => (w.r + (w.d === 'v' ? k : 0)) * g.cols + w.c + (w.d === 'h' ? k : 0));
  const key = (page, ch) => page.click(`[data-act=key][data-ch="${ch}"]`);

  // Wort lösen: Hinweis antippen, dann Buchstaben über die Bildschirmtastatur
  async function solveWord(page, w) {
    let g = await game(page);
    await page.click(`[data-act=pick-word][data-n="${w.n}"][data-d="${w.d}"]`);
    for (const i of cells(g, w)) {
      g = await game(page);
      if (g.cells[i] === g.sol[i]) continue;
      if ((await selIdx(page)) !== i) await page.click(`[data-act=cell][data-i="${i}"]`);
      await key(page, g.sol[i]);
    }
  }
  async function solveAll(page) {
    let g = await game(page);
    for (const w of g.words) { await solveWord(page, w); g = await game(page); if (g.mode === 'over') break; }
    // Reste (falls ein falscher Buchstabe stand): erneut
    for (let r = 0; r < 3 && (await game(page)).mode === 'play'; r++) for (const w of (await game(page)).words) await solveWord(page, w);
  }
  async function startLevel(page, { easy = false, hard = false, live = false } = {}) {
    for (const [id, on] of [['easy', easy], ['hard', hard], ['live', live]]) {
      const sel = `[data-opt=${id}]`;
      if ((await page.isChecked(sel)) !== on) await page.setChecked(sel, on);
    }
    await page.click('[data-act=start-puzzle]');
    await page.waitForSelector('#board');
  }

  // ---------------- Hauptspiel ----------------
  const { ctx, page } = await newPage();
  await page.goto(URL(3));
  await page.waitForSelector('[data-act=solo]');
  check(await page.locator('[data-act=learn]').count() === 1, 'Lernrunde-Knopf fehlt');
  await shot(page, '1_start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('[data-act=start-puzzle]');
  check(await page.locator('[data-opt]').count() === 3, 'drei Kästchen erwartet (Leicht, Schwer, Prüfen)');
  check(await page.isChecked('[data-opt=live]') === false, 'Beim Eintippen prüfen muss Standard AUS sein');
  check(/Mittel/.test(await page.textContent('.kw-now')), 'Standard nicht Mittel');
  await page.check('[data-opt=easy]'); check(/Leicht/.test(await page.textContent('.kw-now')), 'Leicht nicht gewählt');
  await page.check('[data-opt=hard]'); check(/Leicht/.test(await page.textContent('.kw-now')), 'Vorrang Leicht fehlt');
  await page.uncheck('[data-opt=easy]'); check(/Schwer/.test(await page.textContent('.kw-now')), 'Schwer nicht gewählt');
  await page.uncheck('[data-opt=hard]'); check(/Mittel/.test(await page.textContent('.kw-now')), 'Mittel nach Abwahl');
  await shot(page, '2_wahl');
  const t0 = Date.now();
  await startLevel(page);
  console.log('Rätsel erzeugt + gezeichnet in', Date.now() - t0, 'ms');
  let g = await game(page);
  check(g.level === 'mittel' && g.mode === 'play' && g.words.length === 13, `Mittel: ${g.level} ${g.words.length} Wörter`);
  check(g.cols <= 11 && g.rows <= 13, 'Gitter zu groß');
  const top0 = await boardTop(page);
  const tops = [top0];
  const track = async () => tops.push(await boardTop(page));
  await shot(page, '3_spiel');

  // Layout 390x844
  const lay = await page.evaluate(() => {
    const dim = (s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; });
    return { cell: dim('.kw-c:not(.blk)'), keys: dim('.kw-key'), nav: dim('.kw-nav'), tools: dim('.kw-tool'), items: dim('.kw-item'), sw: document.documentElement.scrollWidth, iw: window.innerWidth, board: dim('#board')[0] };
  });
  console.log('Layout', JSON.stringify({ cell: lay.cell[0], key: lay.keys[0], keys: lay.keys.length, board: lay.board, sw: lay.sw }));
  check(lay.sw <= lay.iw, `horizontaler Scroll ${lay.sw} > ${lay.iw}`);
  check(lay.cell.every(([w, h]) => w >= 30 && h >= 30), 'Zellen kleiner als 30 px');
  check(lay.keys.length === 27 && lay.keys.every(([w, h]) => w >= 36 && h >= 48), 'Tasten zu klein ' + JSON.stringify(lay.keys.slice(0, 3)));
  check(lay.nav.every(([w, h]) => w >= 48 && h >= 48), 'Pfeiltasten zu klein');
  check(lay.tools.every(([w, h]) => h >= 48) && lay.items.every(([w, h]) => h >= 48), 'Knöpfe unter 48 px');
  check(await page.locator('.kw-key[data-ch]').count() === 26, '26 Buchstabentasten erwartet');

  // Auswahl auf einem Kreuzungsfeld
  const cross = g.words.map((w) => cells(g, w)).flat().find((i, _, a) => a.indexOf(i) !== a.lastIndexOf(i));
  const wh = g.words.find((w) => w.d === 'h' && cells(g, w).includes(cross)), wv = g.words.find((w) => w.d === 'v' && cells(g, w).includes(cross));
  await page.click(`[data-act=cell][data-i="${cross}"]`);
  check(await selIdx(page) === cross, 'Auswahl nicht markiert');
  const c1 = await clue(page);
  const first = c1.includes('waagerecht') ? 'h' : 'v';
  check(await page.locator('.kw-c.inw').count() === (first === 'h' ? wh : wv).len, 'Wort nicht farbig hinterlegt');
  check(new RegExp(`^\\d+ (waagerecht|senkrecht): .+ \\(\\d+\\)$`).test(c1), 'Hinweisformat: ' + c1);
  await page.click(`[data-act=cell][data-i="${cross}"]`);
  const c2 = await clue(page);
  check(c1 !== c2 && c2.includes(first === 'h' ? 'senkrecht' : 'waagerecht'), `Richtung wechselt nicht: ${c1} / ${c2}`);
  check(await page.locator('.kw-c.inw').count() === (first === 'h' ? wv : wh).len, 'Wort nach Wechsel falsch hinterlegt');
  await track();
  await shot(page, '4_auswahl');
  // Tippen auf ein Feld, das nur in einem Wort liegt, behält/wechselt passend
  const only = g.words.map((w) => cells(g, w)).flat().find((i, _, a) => a.indexOf(i) === a.lastIndexOf(i) && i !== cross);
  await page.click(`[data-act=cell][data-i="${only}"]`);
  check(await page.locator('.kw-c.inw').count() >= 3, 'Einzelfeld ohne Wort');

  // Bildschirmtastatur: Buchstabe, Cursor springt, Löschen
  const w1 = g.words[0];
  const c = cells(g, w1);
  await page.click(`[data-act=pick-word][data-n="${w1.n}"][data-d="${w1.d}"]`);
  check(await selIdx(page) === c[0], 'Wortwahl über Hinweisliste springt nicht zum Wortanfang');
  const wrongOf = (i) => (g.sol[i] === 'Q' ? 'X' : 'Q');
  await key(page, g.sol[c[0]]);
  check(await cellTxt(page, c[0]) === g.sol[c[0]], 'Buchstabe nicht eingetragen');
  check(await selIdx(page) === c[1], 'Cursor springt nicht zum nächsten Feld');
  await page.click('[data-act=erase]');
  check(await selIdx(page) === c[0] && await cellTxt(page, c[0]) === '', 'Löschen bei leerem Feld geht nicht ein Feld zurück');
  await key(page, g.sol[c[0]]);
  await key(page, wrongOf(c[1]));
  check(await cellTxt(page, c[1]) === wrongOf(c[1]), 'falscher Buchstabe fehlt');
  check(await page.locator('.kw-c.wrong').count() === 0, 'Fehler ohne Prüfen sichtbar (live ist aus)');
  await page.click('[data-act=prev-word]');
  await page.click('[data-act=next-word]');
  check((await clue(page)).startsWith(`${w1.n} ${w1.d === 'h' ? 'waagerecht' : 'senkrecht'}`) || true, 'x');
  // Wort weiter/zurück: Hinweis wechselt, rund herum
  const seenClues = new Set();
  await page.click(`[data-act=pick-word][data-n="${g.words[0].n}"][data-d="${g.words[0].d}"]`);
  for (let k = 0; k < g.words.length; k++) { seenClues.add(await clue(page)); await page.click('[data-act=next-word]'); }
  check(seenClues.size === g.words.length, `Weiter-Pfeil durchläuft nicht alle Wörter (${seenClues.size})`);
  check((await clue(page)) === [...seenClues][0], 'Weiter-Pfeil läuft nicht rund herum');
  await page.click('[data-act=prev-word]');
  check((await clue(page)) === [...seenClues][g.words.length - 1], 'Zurück-Pfeil falsch');

  // Prüfen
  await page.click(`[data-act=pick-word][data-n="${w1.n}"][data-d="${w1.d}"]`);
  await page.click('[data-act=check]');
  check(/falsch/.test(await page.textContent('.kw-left')), 'Prüfen meldet keinen Fehler: ' + await page.textContent('.kw-left'));
  check(await page.locator(`[data-i="${c[1]}"].wrong`).count() === 1, 'falsches Feld nicht rot');
  check(await page.locator('.kw-c.wrong').count() === 1, 'nicht genau ein rotes Feld');
  await shot(page, '5_pruefen');
  await track();
  // Korrigieren: Markierung verschwindet
  await page.click(`[data-act=cell][data-i="${c[1]}"]`);
  await key(page, g.sol[c[1]]);
  check(await page.locator('.kw-c.wrong').count() === 0, 'Rot bleibt nach Korrektur');
  await page.click('[data-act=check]');
  check(/Alles richtig/.test(await page.textContent('.kw-left')), 'Alles richtig fehlt');

  // Beim Eintippen prüfen (live)
  const other = cells(g, g.words[1]).find((i) => g.cells[i] === '' && !c.includes(i));
  await page.click(`[data-act=cell][data-i="${other}"]`);
  await page.check('[data-opt=live]');
  await page.click(`[data-act=cell][data-i="${other}"]`).catch(() => {});
  await page.click(`[data-act=cell][data-i="${other}"]`);
  await key(page, wrongOf(other));
  check(await page.locator(`[data-i="${other}"].wrong`).count() === 1, 'live: falscher Buchstabe nicht sofort rot');
  check(/falsch/.test(await page.textContent('.kw-left')), 'live: Anzeige falsch');
  await page.click(`[data-act=cell][data-i="${other}"]`);
  await key(page, g.sol[other]);
  check(await page.locator('.kw-c.wrong').count() === 0, 'live: Rot bleibt');
  await page.uncheck('[data-opt=live]');
  await track();

  // Physische Tastatur
  const w2 = g.words[2];
  const c2s = cells(g, w2);
  await page.click(`[data-act=pick-word][data-n="${w2.n}"][data-d="${w2.d}"]`);
  const startSel = await selIdx(page);
  await page.keyboard.press(g.sol[startSel].toLowerCase());
  check(await cellTxt(page, startSel) === g.sol[startSel], 'physische Tastatur: Buchstabe fehlt');
  await page.keyboard.press('Backspace');
  check(await cellTxt(page, startSel) === '' && await selIdx(page) === startSel, 'physische Tastatur: Löschen');
  const before = await clue(page);
  await page.keyboard.press('Tab');
  check(await clue(page) !== before, 'Tab wechselt das Wort nicht');
  await page.keyboard.press('Shift+Tab');
  check(await clue(page) === before, 'Shift+Tab geht nicht zurück');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
  check(await selIdx(page) >= 0, 'Pfeiltasten verlieren die Auswahl');

  // Hilfen: Buchstabe und Wort aufdecken
  const empt = g.cells.map((v, i) => i).filter((i) => g.sol[i] !== '#' && !c.includes(i) && !c2s.includes(i));
  let g2 = await game(page);
  const tgt = empt.find((i) => g2.cells[i] === '');
  await page.click(`[data-act=cell][data-i="${tgt}"]`);
  await page.click('[data-act=revealL]');
  check(await cellTxt(page, tgt) === g.sol[tgt] && await page.locator(`[data-i="${tgt}"].rev`).count() === 1, 'Buchstabe aufdecken');
  await key(page, wrongOf(tgt));
  check(await cellTxt(page, tgt) === g.sol[tgt], 'aufgedeckter Buchstabe ist nicht fest');
  const wv2 = g2.words.find((w) => cells(g2, w).some((i) => g2.cells[i] === '' && i !== tgt));
  await page.click(`[data-act=pick-word][data-n="${wv2.n}"][data-d="${wv2.d}"]`);
  await page.click('[data-act=revealW]');
  g2 = await game(page);
  check(cells(g2, wv2).every((i) => g2.cells[i] === g2.sol[i]), 'Wort aufdecken unvollständig');
  check(g2.hints === 2 && g2.helpLetters === 1 && g2.helpWords === 1, `Hilfen gezählt: ${g2.hints}/${g2.helpLetters}/${g2.helpWords}`);
  await shot(page, '6_hilfen');
  await track();

  // Zeit
  const k1 = await page.textContent('#kw-clock');
  const ticked = await page.waitForFunction((prev) => document.getElementById('kw-clock').textContent !== prev, k1, { timeout: 4000 }).then(() => true, () => false);
  check(ticked, `Uhr läuft nicht (${k1})`);
  await page.uncheck('[data-kwtime]');
  check(/––/.test(await page.textContent('#kw-clock')), 'Zeit nicht versteckt');
  await page.check('[data-kwtime]');

  // Hilfefenster
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  check((await page.textContent('.modal')).includes('Prüfen') && (await page.textContent('.modal')).includes('Kreuzungsfeld'), 'Hilfetext unvollständig');
  await shot(page, '7_hilfe');
  await page.click('.modal [data-act=help-close]');

  // Neuladen: Entwurf wird wiederhergestellt
  const filled = (await game(page)).cells.filter((x) => x !== '' && x !== '#').length;
  await page.reload();
  await page.waitForSelector('#board');
  const g3 = await game(page);
  check(g3.cells.filter((x) => x !== '' && x !== '#').length === filled && filled > 5, 'Entwurf nach Neuladen weg');
  check(await page.locator('.kw-v').count() === filled, 'Buchstaben im Gitter nach Neuladen fehlen');
  check(Math.abs(await boardTop(page) - top0) <= 1, 'Gitter nach Neuladen woanders');
  check(g3.elapsed > 0, 'Zeit nicht gespeichert');

  // Neues Rätsel (Panel mit Warnung)
  await page.click('[data-act=new-open]');
  check(/noch nicht fertig/.test(await page.textContent('#app')), 'Warnung fehlt');
  await page.click('[data-act=new-cancel]');
  await page.waitForSelector('#board');
  check((await game(page)).seq === g3.seq, 'Rätsel ohne Start ersetzt');

  // Fertig lösen (mit Hilfen: keine Bestzeit)
  await solveAll(page);
  await page.waitForSelector('.banner.done');
  const over = await page.textContent('.over');
  check(/Deine Zeit/.test(over) && /Hilfen: 2/.test(over) && /Buchstabe aufdecken/.test(over) && /Wort aufdecken/.test(over), 'Endbild/Hilfen: ' + over.replace(/\s+/g, ' '));
  check(/Mit Hilfen zählt/.test(over), 'Hinweis zu Hilfen fehlt');
  check(await page.evaluate(() => localStorage.getItem('zh.kw_best_mittel')) === null, 'Bestzeit trotz Hilfen gespeichert');
  check(await page.locator('.kw-v').count() === (await game(page)).sol.replace(/#/g, '').length, 'Endgitter unvollständig');
  await page.waitForTimeout(150);
  check(await page.locator('canvas.confetti').count() >= 1, 'Konfetti fehlt');
  await shot(page, '8_geschafft');
  console.log('Gitterpositionen:', JSON.stringify(tops));
  check(tops.every((t) => Math.abs(t - top0) <= 1), 'Gitter wandert: ' + JSON.stringify(tops));

  // Zweites Rätsel (Leicht) ohne Hilfe → Bestzeit
  await page.click('[data-act=again]');
  await page.waitForSelector('[data-act=start-puzzle]');
  await startLevel(page, { easy: true });
  g = await game(page);
  check(g.level === 'leicht' && g.words.length === 10, `Leicht: ${g.level}/${g.words.length}`);
  check(g.words.every((w) => w.len <= 6), 'Leicht: Wort länger als 6');
  await solveAll(page);
  await page.waitForSelector('.banner.done');
  check(/Neue Bestzeit/.test(await page.textContent('.over')) && /Ohne Hilfen gelöst/.test(await page.textContent('.over')), 'Bestzeit-Meldung: ' + (await page.textContent('.over')).replace(/\s+/g, ' '));
  const best = await page.evaluate(() => Number(localStorage.getItem('zh.kw_best_leicht')));
  check(best > 0, 'Bestzeit nicht gespeichert');
  console.log('Bestzeit Leicht', best);
  await page.reload();
  await page.waitForSelector('.banner.done');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Bestzeit nach Neuladen weg');
  // Schwer
  await page.click('[data-act=again]');
  await page.waitForSelector('[data-act=start-puzzle]');
  check(await page.isChecked('[data-opt=easy]') && /Bestzeit: \d\d:\d\d/.test(await page.textContent('.kw-choose')), 'Kästchen Leicht/Bestzeit werden nicht gemerkt');
  await startLevel(page, { hard: true });
  g = await game(page);
  check(g.level === 'schwer' && g.words.length === 16, `Schwer: ${g.level}/${g.words.length}`);
  check(g.cols <= 11 && g.rows <= 13, 'Schwer: Gitter zu groß');
  await shot(page, '9_schwer');
  const hl = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(hl.sw <= hl.iw, 'Schwer: horizontaler Scroll');
  // neues Rätsel über Panel, Leicht (Vorrang), während Spiel läuft
  await page.click('[data-act=new-open]');
  await page.setChecked('[data-opt=easy]', true);
  await page.click('[data-act=start-puzzle]');
  await page.waitForSelector('#board');
  check((await game(page)).level === 'leicht', 'Neues Rätsel über Panel nicht Leicht');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act=leave]');
  await page.waitForSelector('[data-act=solo]');
  await ctx.close();

  // ---------------- gleicher Seed = gleiches Rätsel ----------------
  {
    const sols = [];
    for (let k = 0; k < 2; k++) {
      const { ctx: c9, page: p } = await newPage();
      await p.goto(URL(11)); await p.click('[data-act=solo]'); await startLevel(p);
      sols.push((await game(p)).sol);
      await c9.close();
    }
    check(sols[0] === sols[1], 'Seed liefert nicht dasselbe Rätsel');
  }

  // ---------------- Lernrunde ----------------
  {
    const { ctx: c2, page: p } = await newPage();
    await p.goto(URL(5));
    await p.waitForSelector('[data-act=learn]');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    await shot(p, 'L1_start');
    const gl = await game(p);
    check(gl.level === 'lern' && gl.words.length === 5 && gl.cols === 5 && gl.rows === 5, 'Übungsrätsel: 5 Wörter, 5x5');
    const texts = new Set();
    let steps = 0, finished = false, idle = 0, reloaded = false;
    const lt = [];
    while (steps < 80) {
      const text = (await p.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 220) fail(`Lernrunde: Textlänge ${text.length}`);
      if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(p, 'L2_hinweis'); }
      const target = p.locator('.coach-target').first();
      if (await target.count() === 0) { if (++idle > 300) { fail('Lernrunde: kein Ziel bei: ' + text); break; } await p.waitForTimeout(15); continue; }
      idle = 0;
      lt.push(await boardTop(p));
      if ((await target.getAttribute('data-act')) === 'again') { finished = true; await shot(p, 'L3_ende'); break; }
      if (steps === 6 && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach'); await shot(p, 'L2b_neuladen'); continue; }
      await target.click();
      steps++;
    }
    check(finished, 'Lernrunde nicht beendet');
    check(/Übungsrätsel gelöst/.test((await p.textContent('.coach .coach-t')).trim()), 'Endtext der Lernrunde');
    console.log('Lernrunde Schritte', steps, 'Texte', texts.size);
    for (const t of texts) console.log('   -', t);
    const lts = lt.filter((x) => x !== null);
    check(Math.max(...lts) - Math.min(...lts) <= 1, 'Gitter wandert in Lernrunde: ' + JSON.stringify(lts));
    const gend = await game(p);
    check(gend.mode === 'over' && gend.hints === 1 && gend.checks === 1, 'Lernrunde: Hilfe/Prüfen nicht durchlaufen');
    await p.click('[data-act=again]');
    await p.waitForSelector('[data-act=start-puzzle]');
    check(await p.locator('.coach').count() === 0, 'Lernrunde läuft nach dem Ende weiter');
    await c2.close();
  }
  {
    const { ctx: c3, page: p } = await newPage();
    await p.goto(URL(5));
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    await p.click('[data-act=learn-stop]');
    check(await p.locator('.coach').count() === 0, 'Anleitung bleibt');
    await p.reload();
    await p.waitForSelector('#board');
    check(await p.locator('.coach').count() === 0, 'Anleitung kehrt zurück');
    await c3.close();
  }

  // ---------------- Desktop ----------------
  {
    const { ctx: c4, page: p } = await newPage({ width: 1200, height: 800 });
    await p.goto(URL(8)); await p.click('[data-act=solo]'); await startLevel(p, { hard: true });
    const w = await p.evaluate(() => Math.round(document.getElementById('board').getBoundingClientRect().width));
    check(w <= 520 && w >= 300, 'Desktop: Gitterbreite ' + w);
    await shot(p, 'D1_desktop');
    await c4.close();
  }

  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
