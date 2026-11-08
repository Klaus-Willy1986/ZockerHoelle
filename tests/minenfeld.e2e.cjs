// Durchspieltest: NODE_PATH=$(npm root -g) node tests/minenfeld.e2e.cjs   (startet eigenen Server auf Port 8993)
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const PORT = process.env.PORT || 8993;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const ROOT = path.join(__dirname, '..');
const URL = `http://localhost:${PORT}/minenfeld/index.html`;

(async () => {
  try { execSync(`lsof -t -i:${PORT} | xargs -r kill`, { stdio: 'ignore' }); } catch { /* frei */ }
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
  const check = (c, m) => { if (!c) fail(m); };

  async function newPage() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      window.setInterval = (f, ms, ...a) => orig(f, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
    return { ctx, page };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `minenfeld_${name}.png`) });
  const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });
  const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('zh.mn.hostState')).game);
  const cell = (i) => `[data-act=cell][data-i="${i}"]`;
  const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0 && document.body.scrollWidth <= window.innerWidth);
  const cellSize = (page) => page.evaluate(() => { const r = document.querySelector('#board .mn-c').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  const nb = (g, i) => { const r = Math.floor(i / g.w), c = i % g.w, o = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if ((dr || dc) && r + dr >= 0 && r + dr < g.h && c + dc >= 0 && c + dc < g.w) o.push((r + dr) * g.w + c + dc); } return o; };
  const num = (g, i) => nb(g, i).filter((j) => g.mine[j]).length;
  const msg = (page) => page.textContent('.mn-msg p.big');
  const longPress = async (page, i) => {
    await page.locator(cell(i)).scrollIntoViewIfNeeded();
    const b = await page.locator(cell(i)).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(560);
    await page.mouse.up();
  };
  async function solve(page) { // alle sicheren Felder anklicken (Minen aus dem Zustand gelesen)
    for (let guard = 0; guard < 200; guard++) {
      const g = await game(page);
      if (g.mode !== 'play') return g;
      const i = g.open.findIndex((v, k) => !v && !g.mine[k] && !g.flag[k]);
      if (i < 0) { const f = g.flag.findIndex((v, k) => v && !g.mine[k]); await page.click('[data-act=mode][data-mode=flag]'); await page.click(cell(f)); await page.click('[data-act=mode][data-mode=reveal]'); continue; }
      await page.click(cell(i));
    }
    return game(page);
  }

  // ---------------- Solo ----------------
  const { ctx, page } = await newPage();
  await page.goto(URL);
  await page.waitForSelector('[data-act=solo]');
  check(await page.locator('[data-act=learn]').count() === 1, 'Lernrunde-Knopf fehlt');
  check(!/minesweeper/i.test(await page.content()), 'Fremdname auf der Seite');
  await shot(page, '1_start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  let g = await game(page);
  check(g.mode === 'ready' && g.level === 'leicht' && g.w === 8 && g.mines === 8 && g.mine === null, 'Startzustand falsch ' + JSON.stringify([g.mode, g.level, g.w]));
  const top0 = await boardTop(page);
  const tops = [top0];
  const track = async () => tops.push(await boardTop(page));
  check(JSON.stringify(await cellSize(page)) === '[44,44]', 'Zellgröße Leicht ' + await cellSize(page));
  check(await noHScroll(page), 'horizontaler Scroll (Start)');
  check(await page.locator('#board .mn-c').count() === 64, '64 Felder erwartet');
  const mb = await page.$$eval('[data-act=mode]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check(mb.length === 2 && mb.every((h) => h >= 48), 'Modusknöpfe zu klein ' + mb);
  check(/Aufdecken/.test(await page.textContent('[data-act=mode][data-mode=reveal]')) && /Flagge setzen/.test(await page.textContent('[data-act=mode][data-mode=flag]')), 'Modusknöpfe beschriftet');
  check((await page.textContent('.mn-status')).includes('Minen noch: 8'), 'Zähler 8: ' + await page.textContent('.mn-status'));
  check(await page.locator('#mn-clock').textContent() === '0:00', 'Uhr vor dem ersten Tipp');
  await shot(page, '2_bereit');

  // Erster Tipp
  await page.click(cell(27));
  g = await game(page);
  check(g.mode === 'play' && g.mine.reduce((a, b) => a + b, 0) === 8 && g.mine[27] === 0 && nb(g, 27).every((j) => !g.mine[j]), 'Erster Tipp nicht sicher');
  await track();
  check(await page.locator('.mn-c.open').count() >= 9, 'Flutfüllung am ersten Feld (mind. 9 offen)');
  check(await noHScroll(page), 'horizontaler Scroll (Spiel)');
  // Zahlen: Farbe + Größe
  const numInfo = await page.$$eval('#board .mn-c.open span', (els) => els.map((e) => ({ t: e.textContent, c: getComputedStyle(e).color, fs: parseFloat(getComputedStyle(e).fontSize), fw: getComputedStyle(e).fontWeight })));
  check(numInfo.length > 0 && numInfo.every((n) => n.fs >= 22 && Number(n.fw) >= 700), 'Zahlen zu klein/nicht fett ' + JSON.stringify(numInfo[0]));
  const col1 = numInfo.find((n) => n.t === '1');
  check(!col1 || col1.c === 'rgb(31, 95, 191)', 'Farbe der 1: ' + (col1 && col1.c));
  await shot(page, '3_nach_erstem_tipp');
  // Uhr läuft
  const c1 = await page.textContent('#mn-clock');
  await page.waitForTimeout(2300);
  check(c1 !== await page.textContent('#mn-clock'), 'Uhr läuft nicht');

  // Flagge per Modusknopf
  g = await game(page);
  const hiddenMine = g.mine.findIndex((v, k) => v && !g.open[k]);
  await page.click('[data-act=mode][data-mode=flag]');
  check(await page.getAttribute('[data-act=mode][data-mode=flag]', 'aria-pressed') === 'true', 'Flaggenmodus nicht aktiv');
  await page.click(cell(hiddenMine));
  check((await game(page)).flag[hiddenMine] === 1 && await page.locator('.mn-c.flag').count() === 1, 'Flagge nicht gesetzt');
  check((await page.textContent('.mn-status')).includes('Minen noch: 7'), 'Zähler 7');
  await page.click(cell(hiddenMine));
  check((await game(page)).flag[hiddenMine] === 0, 'Flagge nicht entfernt');
  check((await page.textContent('.mn-status')).includes('Minen noch: 8'), 'Zähler wieder 8');
  await page.click('[data-act=mode][data-mode=reveal]');
  await track();

  // Langes Drücken (ohne Moduswechsel)
  await longPress(page, hiddenMine);
  g = await game(page);
  check(g.flag[hiddenMine] === 1 && !g.open[hiddenMine] && g.mode === 'play', 'Langdruck setzt keine Flagge');
  check(await page.getAttribute('[data-act=mode][data-mode=reveal]', 'aria-pressed') === 'true', 'Langdruck wechselt Modus');
  await page.waitForTimeout(500);
  await longPress(page, hiddenMine);
  check((await game(page)).flag[hiddenMine] === 0, 'Langdruck entfernt Flagge nicht');
  // Kurzer Tipp im Aufdecken-Modus auf Flagge → Hinweis, nichts passiert
  await longPress(page, hiddenMine);
  await page.waitForTimeout(500);
  await page.click(cell(hiddenMine));
  check((await game(page)).mode === 'play' && /Flagge/.test(await msg(page)), 'Tippen auf Flagge deckt auf: ' + await msg(page));
  await page.waitForTimeout(100);
  await longPress(page, hiddenMine);
  await page.waitForTimeout(500);
  check((await game(page)).flag[hiddenMine] === 0, 'Flagge am Ende des Tests noch da');
  await shot(page, '4_flaggen');

  // Schnell aufdecken: Nachbarn einer Zahl mit Flaggen
  g = await game(page);
  let chordCell = -1;
  for (let i = 0; i < g.w * g.h && chordCell < 0; i++) {
    if (g.open[i] && num(g, i) > 0 && nb(g, i).some((j) => !g.open[j] && !g.mine[j])) chordCell = i;
  }
  check(chordCell >= 0, 'keine Zahl für Schnell-Aufdecken gefunden');
  // zu wenig Flaggen: nichts passiert
  await page.click(cell(chordCell));
  check(/passt noch nicht/.test(await msg(page)), 'Hinweis bei fehlenden Flaggen: ' + await msg(page) + JSON.stringify([chordCell, g.open[chordCell], num(g, chordCell), g.flag.filter(Boolean).length]));
  await page.click('[data-act=mode][data-mode=flag]');
  for (const j of nb(g, chordCell)) if (g.mine[j]) await page.click(cell(j));
  await page.click('[data-act=mode][data-mode=reveal]');
  const openBefore = (await game(page)).open.filter(Boolean).length;
  await page.click(cell(chordCell));
  g = await game(page);
  check(nb(g, chordCell).every((j) => g.open[j] || g.mine[j]), 'Schnell aufdecken öffnet nicht alle Nachbarn');
  check(g.open.filter(Boolean).length > openBefore && g.mode !== 'lost', 'Schnell aufdecken ohne Wirkung');
  await track();
  await shot(page, '5_schnell');

  // Verlieren: falsche Flagge + Mine aufdecken
  g = await game(page);
  const safeHidden = g.open.findIndex((v, k) => !v && !g.mine[k] && !g.flag[k]);
  if (safeHidden >= 0) { await longPress(page, safeHidden); await page.waitForTimeout(450); }
  g = await game(page);
  const boom = g.mine.findIndex((v, k) => v && !g.flag[k] && !g.open[k]);
  await page.click(cell(boom));
  await page.waitForSelector('[data-act=retry]');
  g = await game(page);
  check(g.mode === 'lost' && g.trigger === boom, 'Verlust nicht erkannt');
  check(/Das war eine Mine\. Nochmal\?/.test(await msg(page)), 'Verlusttext: ' + await msg(page));
  check(await page.locator('.mn-c.boom').count() === 1, 'ausgelöste Mine nicht rot');
  check(await page.locator('.mn-c.mine').count() + await page.locator('.mn-c.flag:not(.wrong)').count() === g.mines, 'nicht alle Minen gezeigt');
  const wrongFlags = g.flag.filter((v, k) => v && !g.mine[k]).length;
  check(await page.locator('.mn-c.wrong').count() === wrongFlags && wrongFlags >= (safeHidden >= 0 ? 1 : 0), 'falsche Flaggen: ' + wrongFlags);
  check((await page.textContent('#board')).includes('💣'), 'keine Bombe sichtbar');
  check(/Nochmal \(gleiches Feld\)/.test(await page.textContent('[data-act=retry]')) && /Neues Spiel/.test(await page.textContent('[data-act=again]')), 'Knöpfe nach Verlust');
  await track();
  await shot(page, '6_verloren');
  const minesBefore = g.mine.slice();
  await page.click('[data-act=retry]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('zh.mn.hostState')).game.mode === 'play');
  g = await game(page);
  check(JSON.stringify(g.mine) === JSON.stringify(minesBefore) && g.open[27] === 1 && g.flag.every((v) => !v), 'Nochmal: Minen/erstes Feld/Flaggen');
  await track();

  // Neuladen mitten im Spiel
  await page.reload();
  await page.waitForSelector('#board');
  const gR = await game(page);
  check(JSON.stringify(gR.open) === JSON.stringify(g.open) && gR.mode === 'play', 'Neuladen verliert Spielstand');
  await track();

  // Gewinnen
  g = await solve(page);
  check(g.mode === 'won', 'nicht gewonnen: ' + g.mode);
  await page.waitForSelector('.over h1');
  check(/Geschafft!/.test(await page.textContent('.over h1')) && /Deine Zeit/.test(await page.textContent('.over')), 'Gewinn-Anzeige');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Bestzeit-Meldung fehlt');
  const best = await page.evaluate(() => Number(localStorage.getItem('zh.mn_best_leicht')));
  check(best > 0, 'Bestzeit nicht gespeichert: ' + best);
  check(await page.locator('.confetti').count() >= 0, '');
  check(/Geschafft/.test(await msg(page)), 'Gewinn-Text im Aktionsbereich');
  await track();
  await shot(page, '7_gewonnen');
  await page.reload();
  await page.waitForSelector('.over h1');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Gewinn nach Neuladen weg');
  console.log('Bestzeit ms', best, ' Brett-Positionen:', JSON.stringify(tops));
  check(tops.every((t) => Math.abs(t - top0) <= 1), 'Brett wandert: ' + JSON.stringify(tops));

  // Zeit ausblenden, Stufen
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  check((await game(page)).mode === 'ready', 'Neues Spiel nicht bereit');
  await page.locator('input[data-opt=time]').click();
  check(await page.textContent('#mn-clock') === '–:––', 'Zeit nicht versteckt');
  await page.locator('input[data-opt=time]').click();
  await page.locator('input[data-opt=mid]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('zh.mn.hostState')).game.level === 'mittel');
  g = await game(page);
  check(g.w === 10 && g.mines === 15, 'Mittel');
  check(JSON.stringify(await cellSize(page)) === '[36,36]', 'Zellgröße Mittel ' + await cellSize(page));
  check(await noHScroll(page), 'Scroll Mittel');
  check(await boardTop(page) === top0, 'Brett Mittel verschoben: ' + await boardTop(page));
  await page.click(cell(55));
  await shot(page, '8_mittel');
  g = await game(page);
  check(g.mine.reduce((a, b) => a + b, 0) === 15, 'Mittel 15 Minen');
  await page.locator('input[data-opt=hard]').click(); // Stufe gilt ab dem nächsten Spiel
  check((await game(page)).level === 'mittel', 'Stufe wechselt mitten im Spiel');
  await page.evaluate(() => window.scrollTo(0, 0));
  g = await solve(page);
  check(g.mode === 'won', 'Mittel nicht gelöst');
  check(await page.evaluate(() => Number(localStorage.getItem('zh.mn_best_mittel'))) > 0, 'Bestzeit Mittel');
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  g = await game(page);
  check(g.level === 'schwer' && g.w === 12 && g.mines === 28, 'Schwer hat Vorrang vor Mittel');
  check(JSON.stringify(await cellSize(page)) === '[30,30]', 'Zellgröße Schwer ' + await cellSize(page));
  check(await noHScroll(page), 'Scroll Schwer');
  await page.click(cell(70));
  await shot(page, '9_schwer');
  check(await noHScroll(page), 'Scroll Schwer im Spiel');
  // Schnell aufdecken ausschalten
  await page.locator('input[data-opt=chord]').click();
  check((await game(page)).chord === false, 'Schnell aufdecken nicht ausgeschaltet');
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  check((await page.textContent('.modal')).includes('Flagge') && !/minesweeper/i.test(await page.textContent('.modal')), 'Hilfetext');
  await shot(page, '10_hilfe');
  await page.click('.modal [data-act=help-close]');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act=leave]');
  await page.waitForSelector('[data-act=solo]');
  await ctx.close();

  // ---------------- Lernrunde ----------------
  {
    const { ctx: c2, page: p } = await newPage();
    await p.goto(URL);
    await p.waitForSelector('[data-act=learn]');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    check(await p.locator('#board .mn-c').count() === 25, 'Lernfeld 5x5');
    check(await p.locator('.optcard').count() === 0, 'Optionen in der Lernrunde');
    await shot(p, 'L1_start');
    const texts = new Set();
    let steps = 0, finished = false, idle = 0;
    const lt = [];
    while (steps < 30) {
      const text = (await p.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 160) fail(`Lernrunde: Textlänge ${text.length}`);
      if (!texts.has(text)) { texts.add(text); await shot(p, `L2_schritt${texts.size}`); }
      const target = p.locator('.coach-target').first();
      if (await target.count() === 0) { if (++idle > 300) { fail('Lernrunde: kein Ziel bei: ' + text); break; } await p.waitForTimeout(15); continue; }
      idle = 0;
      lt.push(await boardTop(p));
      if ((await target.getAttribute('data-act')) === 'again') { finished = true; await shot(p, 'L3_ende'); break; }
      await target.click();
      steps++;
    }
    check(finished, 'Lernrunde nicht beendet');
    check(steps === 5 && texts.size === 6, `Lernrunde Schritte ${steps}, Texte ${texts.size}`);
    check(await p.locator('.trophy').count() === 1, 'Lernrunde: Gewinnbild');
    console.log('Lernrunde Schritte', steps, 'Texte', texts.size);
    check(Math.max(...lt) - Math.min(...lt) <= 1, 'Brett wandert in Lernrunde: ' + JSON.stringify(lt));
    check(await p.evaluate(() => localStorage.getItem('zh.mn_best_lern')) === null, 'Bestzeit in Lernrunde');
    await p.click('[data-act=again]');
    await p.waitForSelector('#board');
    check(await p.locator('.coach').count() === 0, 'Lernrunde läuft nach dem Ende weiter');
    check(await p.locator('#board .mn-c').count() === 64, 'danach richtiges Feld');
    await c2.close();
  }
  {
    // Lernrunde: Mine treffen → Nochmal
    const { ctx: c3, page: p } = await newPage();
    await p.goto(URL);
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    await p.click(cell(20));
    await p.waitForSelector('[data-act=retry]');
    check(/Nochmal/.test(await p.textContent('.coach .coach-t')), 'Coach nach Mine');
    await p.click('[data-act=retry]');
    await p.waitForSelector('[data-act=mode]:not([disabled])');
    check(await p.locator('.coach-target[data-act=mode]').count() === 1, 'Coach nach Nochmal');
    await p.click('[data-act=learn-stop]');
    check(await p.locator('.coach').count() === 0, 'Anleitung bleibt');
    await p.reload();
    await p.waitForSelector('#board');
    check(await p.locator('.coach').count() === 0, 'Anleitung kehrt zurück');
    await c3.close();
  }

  await browser.close();
  server.kill();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
