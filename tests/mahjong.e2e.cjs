// Mahjong-Solitär im Browser (Solo komplett, Zoom, Zurück, Hinweis, Mischen, Lernrunde, Neuladen, Layout 390x844).
// Aufruf:  NODE_PATH=$(npm root -g) node tests/mahjong.e2e.cjs   (Server: cd /home/user/zockerhoelle && python3 -m http.server 8991)
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const PORT = process.env.PORT || 8991;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const URL = `http://localhost:${PORT}/mahjong/index.html`;
const ENGINE = pathToFileURL(path.join(__dirname, '..', 'mahjong', 'engine.js')).href;

(async () => {
  const E = await import(ENGINE);
  const browser = await chromium.launch();
  const errors = [];
  const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
  const check = (c, m) => { if (!c) fail(m); };

  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
    await ctx.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      window.setInterval = (f, ms, ...a) => orig(f, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    });
    // Zustand von Hand einspielen (vor dem Start der Seite, damit das Speichern beim Verlassen nichts überschreibt)
    await ctx.addInitScript(() => {
      try {
        const j = sessionStorage.getItem('mj_inject');
        if (j) { const hs = JSON.parse(localStorage.getItem('zh.mj.hostState')); hs.game = JSON.parse(j); localStorage.setItem('zh.mj.hostState', JSON.stringify(hs)); sessionStorage.removeItem('mj_inject'); }
      } catch { /* egal */ }
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
    page.on('dialog', (d) => d.accept());
    return { ctx, page };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `mahjong_${name}.png`) });
  const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('zh.mj.hostState')).game);
  const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });
  const tiles = (page) => page.locator('.mj-tile:not(.mj-gone)').count();
  const left = async (page) => Number(await page.textContent('#mj-left'));
  const msg = async (page) => (await page.textContent('.mj-msg')).trim();
  const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const tapTile = (page, i) => page.click(`.mj-tile[data-i="${i}"]`);
  async function choose(page, { small = false, tiny = false, hints = true, free = false } = {}) {
    const set = async (id, on) => { const c = page.locator(`[data-opt=${id}]`); if ((await c.isChecked()) !== on) await c.click(); };
    await set('small', small); await set('tiny', tiny); await set('hints', hints); await set('free', free);
    await page.click('[data-act=go]');
    await page.waitForSelector('#board');
  }
  async function start(page, o = {}) {
    await page.goto(URL);
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await page.goto(URL);
    await page.waitForSelector('[data-act=solo]');
    await page.click('[data-act=solo]');
    await page.waitForSelector('.mj-setup');
    await choose(page, o);
  }
  // Löst das aktuelle Spiel mit dem Löser (liest den Zustand, tippt die Paare)
  async function solveByTapping(page, maxPairs = 999) {
    const g = await game(page);
    const sol = E.solve(g, 5000000);
    check(!!sol, 'Löser findet keine Lösung');
    let n = 0;
    for (const [a, b] of sol) {
      if (n++ >= maxPairs) break;
      await tapTile(page, a);
      await tapTile(page, b);
    }
    return sol ? sol.length : 0;
  }

  // ---------------- Start, Einstellungen ----------------
  const { ctx, page } = await newPage();
  await page.goto(URL);
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await page.goto(URL);
  await page.waitForSelector('[data-act=solo]');
  check((await page.locator('#name, #code, [data-act=host]').count()) === 0, 'Startseite ohne Name/Code/Einladung');
  check((await page.locator('[data-act=learn]').count()) === 1, 'Lernrunde-Knopf fehlt');
  await shot(page, '1_start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('.mj-setup');
  check((await page.locator('.mj-setup input[type=checkbox]').count()) === 5, 'fünf Kästchen im Setup');
  check(/Schildkröte \(144 Steine\)/.test(await page.textContent('.mj-pick')), 'Standard Schildkröte');
  await page.click('[data-opt=small]');
  check(/Pyramide \(72 Steine\)/.test(await page.textContent('.mj-pick')), 'Kästchen klein -> Pyramide');
  await page.click('[data-opt=tiny]');
  check(/Mauer \(48 Steine\)/.test(await page.textContent('.mj-pick')), 'tiny hat Vorrang');
  await shot(page, '2_setup');
  await page.click('[data-opt=tiny]'); await page.click('[data-opt=small]');
  check(/Schildkröte/.test(await page.textContent('.mj-pick')), 'zurück auf Schildkröte');
  check((await page.locator('[data-opt=hints]').isChecked()) === true, 'Hinweise standardmäßig an');
  check((await page.locator('[data-opt=free]').isChecked()) === false, 'Freie Steine standardmäßig aus');
  check(await noHScroll(page), 'Setup: horizontaler Seiten-Scroll');
  await page.click('[data-act=go]');
  await page.waitForSelector('#board');

  // ---------------- Schildkröte ----------------
  check((await tiles(page)) === 144, '144 Steine');
  check((await left(page)) === 144, 'Steine übrig: 144');
  check(!/Mögliche Paare/i.test(await page.textContent('#app')), 'Mögliche Paare werden nicht angezeigt');
  check((await page.locator('.mj-tile.free').count()) === 0, 'freie Steine ohne Option nicht markiert');
  check(await noHScroll(page), 'Schildkröte: horizontaler Seiten-Scroll');
  const z0 = Number(await page.getAttribute('#board', 'data-zoom'));
  console.log('Standardzoom Schildkröte', z0);
  check(z0 >= 24 && z0 <= 52, 'Zoom im Bereich');
  const top0 = await boardTop(page);
  await shot(page, '3_schildkroete');
  const btnH = await page.$$eval('.mj-btn, .mj-time', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check(btnH.every((h) => h >= 48), 'Knöpfe >= 48 px: ' + btnH);

  // Zoom
  await page.click('[data-act=zoom-in]');
  check(Number(await page.getAttribute('#board', 'data-zoom')) === z0 + 4, 'Größer +4');
  check(await noHScroll(page), 'gezoomt: Seiten-Scroll');
  const sc = await page.evaluate(() => { const b = document.getElementById('board'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
  check(sc.sw > sc.cw, 'gezoomtes Brett scrollbar');
  await page.click('[data-act=zoom-in]'); await page.click('[data-act=zoom-in]');
  await page.evaluate(() => { const b = document.getElementById('board'); b.scrollLeft = 70; b.scrollTop = 20; });
  await page.waitForTimeout(450);
  const z1 = Number(await page.getAttribute('#board', 'data-zoom'));
  const savedZ = await page.evaluate(() => JSON.parse(localStorage.getItem('zh.mj_zoom')));
  check(savedZ && savedZ.schildkroete === z1, 'Zoom gespeichert (zh.mj_zoom): ' + JSON.stringify(savedZ));
  const scr1 = await page.evaluate(() => { const b = document.getElementById('board'); return { l: b.scrollLeft, t: b.scrollTop }; });
  check(await page.evaluate(() => !!localStorage.getItem('zh.mj_scroll')), 'Scrollmitte gespeichert');
  await shot(page, '4_zoom');
  const bigTile = await page.$eval('.mj-tile:not(.mj-gone) .mj-face', (e) => Math.round(e.getBoundingClientRect().width));
  check(bigTile >= 28, 'Steinbreite gezoomt ' + bigTile);
  await page.reload();
  await page.waitForSelector('#board');
  check(Number(await page.getAttribute('#board', 'data-zoom')) === z1, 'Zoom nach Neuladen');
  const scr2 = await page.evaluate(() => { const b = document.getElementById('board'); return { l: b.scrollLeft, t: b.scrollTop }; });
  check(Math.abs(scr2.l - scr1.l) <= 6 && Math.abs(scr2.t - scr1.t) <= 6, `Scrollstelle nach Neuladen: ${JSON.stringify(scr1)} -> ${JSON.stringify(scr2)}`);
  check((await tiles(page)) === 144 && (await page.locator('.mj-setup').count()) === 0, 'Neuladen behält das Spiel');
  // Grenzen
  for (let i = 0; i < 10; i++) { if (await page.locator('[data-act=zoom-out][disabled]').count()) break; await page.click('[data-act=zoom-out]'); }
  check(Number(await page.getAttribute('#board', 'data-zoom')) === 24, 'Mindestzoom 24');
  check((await page.locator('[data-act=zoom-out][disabled]').count()) === 1, 'Kleiner gesperrt am Minimum');
  for (let i = 0; i < 10; i++) { if (await page.locator('[data-act=zoom-in][disabled]').count()) break; await page.click('[data-act=zoom-in]'); }
  check(Number(await page.getAttribute('#board', 'data-zoom')) === 52, 'Höchstzoom 52');
  const t52 = await page.$eval('.mj-tile:not(.mj-gone) .mj-face', (e) => Math.round(e.getBoundingClientRect().width));
  check(t52 >= 40, 'Tippfläche bei 52 px >= 40: ' + t52);
  await page.click('[data-act=zoom-out]'); await page.click('[data-act=zoom-out]'); await page.click('[data-act=zoom-out]');
  await page.click('[data-act=zoom-out]'); await page.click('[data-act=zoom-out]'); await page.click('[data-act=zoom-out]'); await page.click('[data-act=zoom-out]');
  check(Number(await page.getAttribute('#board', 'data-zoom')) === 24, 'zurück auf 24');
  check(Math.abs((await boardTop(page)) - top0) <= 1, 'Brett wandert beim Zoomen');

  // Tippen: eingeklemmt, Markierung, keine gleichen, Paar
  let g = await game(page);
  const geo = E.geometry(g.layout);
  const blocked = [...g.kinds.keys()].find((i) => !E.isFree(g, i));
  await page.locator(`.mj-tile[data-i="${blocked}"]`).dispatchEvent('click');
  check(/eingeklemmt/.test(await msg(page)), 'Meldung eingeklemmt: ' + (await msg(page)));
  check((await page.locator('.mj-tile.sel').count()) === 0, 'eingeklemmter Stein wird nicht markiert');
  const frees = E.freeTiles(g);
  const a0 = frees[0];
  const diff = frees.find((i) => !E.sameKind(g.kinds[i], g.kinds[a0]));
  await tapTile(page, a0);
  check((await page.locator('.mj-tile.sel').count()) === 1, 'Stein markiert');
  check(/Markiert/.test(await msg(page)), 'Markierungs-Text');
  check(Math.abs((await boardTop(page)) - top0) <= 1, 'Brett wandert bei Markierung');
  await shot(page, '5_markiert');
  await tapTile(page, diff);
  check(/keine gleichen Steine/.test(await msg(page)), 'Meldung ungleich: ' + (await msg(page)));
  check((await page.locator(`.mj-tile.sel[data-i="${diff}"]`).count()) === 1, 'Markierung wechselt');
  await tapTile(page, diff);
  check((await page.locator('.mj-tile.sel').count()) === 0, 'nochmal tippen hebt Markierung auf');
  // Paar entfernen mit kleiner Animation
  const [pa, pb] = E.freePairs(g)[0];
  await tapTile(page, pa); await tapTile(page, pb);
  check((await page.locator('.mj-gone').count()) === 2, 'Verschwinde-Animation (zwei Geister)');
  check((await tiles(page)) === 142 && (await left(page)) === 142, 'zwei Steine weg');
  check((await page.locator('[data-act=undo][disabled]').count()) === 0, 'Zurück aktiv');
  // Zurück
  await page.click('[data-act=undo]');
  check((await tiles(page)) === 144 && (await left(page)) === 144, 'Zurück stellt wieder her');
  check((await page.locator('[data-act=undo][disabled]').count()) === 1, 'Zurück gesperrt ohne Verlauf');
  // Hinweis
  await page.click('[data-act=hint]');
  check((await page.locator('.mj-tile.hint').count()) === 2, 'Hinweis zeigt genau zwei Steine');
  const hintIds = await page.$$eval('.mj-tile.hint', (els) => els.map((e) => Number(e.dataset.i)));
  g = await game(page);
  check(g.hints === 1 && E.isFree(g, hintIds[0]) && E.isFree(g, hintIds[1]) && E.sameKind(g.kinds[hintIds[0]], g.kinds[hintIds[1]]), 'Hinweis ist ein gültiges freies Paar und zählt als Hilfe');
  check(/Hinweis/.test(await msg(page)), 'Hinweis-Text');
  await shot(page, '6_hinweis');
  await page.waitForFunction(() => document.querySelectorAll('.mj-tile.hint').length === 0, null, { timeout: 8000 });
  check(true, 'Hinweis verschwindet');
  // Mischen mit Rückfrage
  const before = (await game(page)).kinds.slice();
  await page.click('[data-act=shuffle]');
  check((await page.locator('.mj-modal').count()) === 1, 'Rückfrage beim Mischen');
  await shot(page, '7_misch_frage');
  await page.click('[data-act=confirm-no]');
  check(JSON.stringify((await game(page)).kinds) === JSON.stringify(before), 'Nein mischt nicht');
  await page.click('[data-act=shuffle]'); await page.click('[data-act=confirm-yes]');
  g = await game(page);
  check(g.mixes === 1, 'Mischen gezählt');
  check(JSON.stringify(g.kinds) !== JSON.stringify(before), 'Brett wurde neu verteilt');
  check(JSON.stringify([...g.kinds].sort()) === JSON.stringify([...before].sort()), 'gleiche Steine nach dem Mischen');
  check(!!E.solve(g, 5000000), 'nach dem Mischen lösbar');
  check((await page.locator('[data-act=undo][disabled]').count()) === 0, 'Mischen ist rückgängig machbar');
  await page.click('[data-act=undo]');
  check(JSON.stringify((await game(page)).kinds) === JSON.stringify(before), 'Zurück nimmt das Mischen zurück');
  await page.click('[data-act=shuffle]'); await page.click('[data-act=confirm-yes]');

  // Zeit ein/aus
  await page.click('[data-act=time-toggle]');
  check(/––/.test(await page.textContent('#mj-clock')), 'Zeit versteckt');
  await page.click('[data-act=time-toggle]');
  check(!/––/.test(await page.textContent('#mj-clock')), 'Zeit sichtbar');
  // Hilfe-Fenster
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  check((await page.textContent('.modal')).includes('eingeklemmt') && (await page.textContent('.modal')).includes('Blumen'), 'Hilfetext');
  await shot(page, '8_hilfe');
  await page.click('.modal [data-act=help-close]');

  // Teilweise lösen, neu laden, weiterlösen: komplett per Löser
  g = await game(page);
  const total = E.solve(g, 5000000).length;
  await solveByTapping(page, 40);
  check((await left(page)) === g.kinds.filter((k) => k >= 0).length - 80, 'nach 40 Paaren');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('#board');
  check((await left(page)) === g.kinds.filter((k) => k >= 0).length - 80, 'Neuladen mitten im Spiel');
  const elapsed = (await game(page)).elapsed;
  check(elapsed > 0, 'Zeit gespeichert: ' + elapsed);
  await shot(page, '9_halb');
  await solveByTapping(page);
  await page.waitForSelector('.over');
  const over = await page.textContent('.over');
  check(/Geschafft/.test(over) && /Deine Zeit/.test(over), 'Endbild: ' + over);
  check(/1 Hinweis/.test(over) && /neu gemischt/.test(over), 'Hilfen genannt: ' + over);
  check(/Neue Bestzeit/.test(over) && !/ohne Hilfe!/.test(over), 'Bestzeit (nicht ohne Hilfe)');
  const bestA = await page.evaluate(() => Number(localStorage.getItem('zh.mj_best_schildkroete')));
  check(bestA > 0, 'Bestzeit gespeichert');
  check((await page.evaluate(() => localStorage.getItem('zh.mj_best_clean_schildkroete'))) === null, 'Ohne-Hilfe-Bestzeit nicht gesetzt');
  check(await noHScroll(page), 'Ende: Seiten-Scroll');
  await shot(page, '10_geschafft');
  console.log('Schildkröte gelöst, Paare:', total, 'Bestzeit ms', bestA);
  await page.reload();
  await page.waitForSelector('.over');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Endbild nach Neuladen');

  // ---------------- Mauer ohne Hilfe: Bestzeit ohne Hilfe ----------------
  await page.click('[data-act=again]');
  await page.waitForSelector('.mj-setup');
  check(/Schildkröte/.test(await page.textContent('.mj-pick')), 'Einstellungen bleiben gespeichert');
  await choose(page, { tiny: true });
  check((await tiles(page)) === 48 && (await game(page)).layout === 'mauer', 'Mauer 48 Steine');
  await shot(page, '11_mauer');
  const n48 = await solveByTapping(page);
  await page.waitForSelector('.over');
  check(n48 === 24, '24 Paare');
  const over2 = await page.textContent('.over');
  check(/Neue Bestzeit ohne Hilfe/.test(over2) && /Ganz ohne Hilfe/.test(over2), 'ohne Hilfe: ' + over2);
  check((await page.evaluate(() => Number(localStorage.getItem('zh.mj_best_clean_mauer')))) > 0 && (await page.evaluate(() => Number(localStorage.getItem('zh.mj_best_mauer')))) > 0, 'Bestzeiten Mauer gespeichert');
  // Neues Spiel mit Rückfrage mitten im Spiel
  await page.click('[data-act=again]');
  await page.waitForSelector('.mj-setup');
  check(/Bestzeit/.test(await page.textContent('.mj-bests')) && /ohne Hilfe/.test(await page.textContent('.mj-bests')), 'Bestzeiten im Setup');
  await shot(page, '12_setup_bestzeit');
  await choose(page, { small: true });
  check((await tiles(page)) === 72, 'Pyramide 72 Steine');
  const topP = await boardTop(page);
  const wP = Number(await page.getAttribute('#board', 'data-zoom'));
  check(wP >= 40, 'Pyramide: Standardzoom >= 40: ' + wP);
  const scP = await page.evaluate(() => { const b = document.getElementById('board'); return b.scrollWidth <= b.clientWidth + 1; });
  check(scP, 'Pyramide passt ohne Scrollen in 390 px');
  await shot(page, '13_pyramide');
  await page.click('[data-act=new-ask]');
  check((await page.locator('.mj-setup').count()) === 1, 'ohne Fortschritt: direkt zum Setup');
  await page.click('[data-act=go]');
  await page.waitForSelector('#board');
  const [qa, qb] = E.freePairs(await game(page))[0];
  await tapTile(page, qa); await tapTile(page, qb);
  await page.click('[data-act=new-ask]');
  check((await page.locator('.mj-modal').count()) === 1, 'Rückfrage bei Neues Spiel mit Fortschritt');
  await page.click('[data-act=confirm-no]');
  check((await left(page)) === 70, 'Nein behält das Spiel');
  await page.click('[data-act=new-ask]'); await page.click('[data-act=confirm-yes]');
  await page.waitForSelector('.mj-setup');
  check((await page.locator('[data-act=setup-cancel]').count()) === 1, 'Zurück zum Spiel möglich');
  await page.click('[data-act=setup-cancel]');
  check((await left(page)) === 70, 'Abbrechen behält das Spiel');
  check(Math.abs((await boardTop(page)) - topP) <= 1, 'Brett wandert (Pyramide)');
  // Sackgasse: Zustand von Hand setzen (zwei gleiche Steine übereinander)
  const stuckState = await game(page);
  {
    stuckState.layout = 'lern';
    const pos = E.geometry('lern').pos;
    const below = pos.findIndex((p) => p[0] === 0 && p[1] === 4 && p[2] === 0);
    const above = pos.findIndex((p) => p[0] === 1 && p[1] === 4 && p[2] === 1);
    stuckState.kinds = new Array(12).fill(-1); stuckState.kinds[below] = 5; stuckState.kinds[above] = 5;
    stuckState.hist = [['p', 0, 1, 3]];
    await page.evaluate((st) => sessionStorage.setItem('mj_inject', JSON.stringify(st)), stuckState);
  }
  await page.reload();
  await page.waitForSelector('#board');
  check(/Keine Paare mehr möglich/.test(await msg(page)), 'Sackgassen-Meldung: ' + (await msg(page)));
  check((await page.locator('[data-act=shuffle].alert').count()) === 1, 'Neu mischen hervorgehoben');
  await shot(page, '14_sackgasse');
  await page.click('[data-act=shuffle]');
  check(/Mischen geht hier leider nicht/.test(await msg(page)), 'Mischen unmöglich erklärt: ' + (await msg(page)));
  await page.click('[data-act=undo]');
  check((await game(page)).hist.length === 0, 'Zurück aus der Sackgasse');

  // Leaving
  await page.click('[data-act=leave]');
  await page.waitForSelector('[data-act=solo]');
  await ctx.close();

  // ---------------- Option: keine Hinweise, freie Steine hervorheben ----------------
  {
    const { ctx: c2, page: p } = await newPage();
    await start(p, { tiny: true, hints: false, free: true });
    check((await p.locator('[data-act=hint]').count()) === 0, 'ohne Hinweis-Option kein Hinweis-Knopf');
    const g2 = await game(p);
    check(g2.opts.hints === false && g2.opts.free === true, 'Optionen im Zustand');
    const fr = await p.locator('.mj-tile.free').count();
    check(fr === E.freeTiles(g2).length && fr > 0, `freie Steine hervorgehoben: ${fr} von ${E.freeTiles(g2).length}`);
    await shot(p, '15_frei');
    await c2.close();
  }

  // ---------------- Weniger Bewegung ----------------
  {
    const { ctx: c3, page: p } = await newPage({ reducedMotion: 'reduce' });
    await start(p, { tiny: true });
    const g3 = await game(p);
    const [x, y] = E.freePairs(g3)[0];
    await tapTile(p, x); await tapTile(p, y);
    check((await p.locator('.mj-gone').count()) === 0, 'prefers-reduced-motion: keine Animation');
    check((await left(p)) === 46, 'trotzdem entfernt');
    await c3.close();
  }

  // ---------------- Lernrunde ----------------
  {
    const { ctx: c4, page: p } = await newPage();
    await p.goto(URL);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL);
    await p.waitForSelector('[data-act=learn]');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    check((await p.locator('.mj-setup').count()) === 0, 'Lernrunde ohne Setup');
    check((await tiles(p)) === 12, 'Übungsbrett 12 Steine');
    check((await p.locator('.mj-tile.free').count()) > 0, 'Lernrunde markiert freie Steine');
    check((await p.locator('[data-act=new-ask]').count()) === 0, 'Lernrunde ohne "Neues Spiel"');
    await shot(p, 'L1_start');
    const texts = new Set();
    const tops = [];
    let steps = 0, finished = false, idle = 0, reloaded = false;
    while (steps < 60) {
      const text = (await p.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 200) fail(`Lernrunde: Textlänge ${text.length}`);
      if (!texts.has(text)) { texts.add(text); if (texts.size === 2) await shot(p, 'L2_zweiter'); if (/eingeklemmt/.test(text)) await shot(p, 'L3_eingeklemmt'); }
      const target = p.locator('.coach-target').first();
      if ((await target.count()) === 0) { if (++idle > 300) { fail('Lernrunde: kein Ziel bei: ' + text); break; } await p.waitForTimeout(15); continue; }
      idle = 0;
      tops.push(await boardTop(p));
      if ((await target.getAttribute('data-act')) === 'again') { finished = true; await shot(p, 'L4_ende'); break; }
      if (steps === 6 && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach'); continue; }
      if ((await target.getAttribute('data-act')) === 'tile') await target.dispatchEvent('click');
      else await target.click();
      if (await p.locator('.mj-modal').count()) await p.click('[data-act=confirm-yes]');
      steps++;
    }
    check(finished, 'Lernrunde nicht beendet');
    console.log('Lernrunde Schritte', steps, 'Texte', texts.size);
    for (const t of texts) console.log('   -', t);
    check(texts.size >= 6, 'Lernrunde: genug Texte ' + texts.size);
    const tops2 = tops.filter((x) => x !== null);
    check(Math.max(...tops2) - Math.min(...tops2) <= 1, 'Brett wandert in Lernrunde: ' + JSON.stringify([...new Set(tops2)]));
    await p.click('[data-act=again]');
    await p.waitForSelector('.mj-setup');
    check((await p.locator('.coach').count()) === 0, 'Lernrunde läuft nach dem Ende weiter');
    check((await p.evaluate(() => localStorage.getItem('zh.mj_best_lern'))) === null, 'Lernrunde speichert keine Bestzeit');
    await c4.close();
  }
  {
    const { ctx: c5, page: p } = await newPage();
    await p.goto(URL);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL);
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    await p.click('[data-act=learn-stop]');
    check((await p.locator('.coach').count()) === 0, 'Anleitung bleibt');
    await p.reload();
    await p.waitForSelector('#board');
    check((await p.locator('.coach').count()) === 0, 'Anleitung kehrt zurück');
    await c5.close();
  }

  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('E2E ok');
})().catch((e) => { console.error(e); process.exit(1); });
