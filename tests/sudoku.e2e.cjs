// Durchspieltest: NODE_PATH=$(npm root -g) node tests/sudoku.e2e.cjs
// Voraussetzung: Server auf Port 8813  (cd /home/user/zockerhoelle && python3 -m http.server 8813)
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8813;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const URL = `http://localhost:${PORT}/sudoku/index.html`;

(async () => {
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
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `sudoku_${name}.png`) });
  const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });
  const boardBox = (page) => page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) }; });
  const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('zh.sd.hostState')).game);
  const cellTxt = (page, i) => page.evaluate((i) => document.querySelector(`[data-act=cell][data-i="${i}"]`).innerText.replace(/\s+/g, ''), i);
  const tap = async (page, i, d) => { await page.click(`[data-act=cell][data-i="${i}"]`); await page.click(`[data-act=key][data-d="${d}"]`); };
  const empties = async (page) => { const g = await game(page); return g.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); };

  // ---------------- Hauptspiel ----------------
  const { ctx, page } = await newPage();
  await page.goto(URL);
  await page.waitForSelector('[data-act=solo]');
  check(await page.locator('[data-act=learn]').count() === 1, 'Lernrunde-Knopf fehlt');
  await shot(page, '1_start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('[data-act=level]');
  check(await page.locator('[data-act=level]').count() === 3, 'drei Stufen erwartet');
  await shot(page, '2_stufen');
  const t0 = Date.now();
  await page.click('[data-act=level][data-level=leicht]');
  await page.waitForSelector('#board');
  console.log('Rätsel erzeugt + gezeichnet in', Date.now() - t0, 'ms');
  await shot(page, '3_spiel');
  let g = await game(page);
  check(g.level === 'leicht' && g.mode === 'play', 'Spielzustand falsch');
  const top0 = await boardTop(page);
  const box = await boardBox(page);
  console.log('Gitter', JSON.stringify(box), 'oben', top0);
  check(box.w >= 340 && Math.abs(box.w - box.h) <= 1, 'Gitter nicht quadratisch/breit genug');
  const tops = [top0];
  const track = async () => tops.push(await boardTop(page));

  // Tippflächen der Zahlentasten
  const keyBoxes = await page.$$eval('[data-act=key]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check(keyBoxes.every(([w, h]) => w >= 48 && h >= 48), 'Zahlentasten zu klein ' + JSON.stringify(keyBoxes));
  check(await page.locator('[data-act=check]').count() === 0, 'Prüfen ohne Hilfen sichtbar');

  // Uhr läuft
  const c1 = await page.textContent('#sd-clock');
  await page.waitForTimeout(2300);
  const c2 = await page.textContent('#sd-clock');
  check(c1 !== c2, `Uhr läuft nicht (${c1} / ${c2})`);

  // Auswahl: Hervorhebung
  let em = await empties(page);
  await page.click(`[data-act=cell][data-i="${em[0]}"]`);
  check(await page.locator('.sd-c.sel').count() === 1, 'Auswahl nicht markiert');
  check(await page.locator('.sd-c.peer').count() >= 15, 'Nachbarn nicht markiert');
  await track();
  await shot(page, '4_auswahl');
  // vorgegebene Zahl antippen: Tastendruck ändert nichts
  const givenIdx = g.cells.findIndex((v) => v > 0);
  await page.click(`[data-act=cell][data-i="${givenIdx}"]`);
  check(await page.locator('.sd-c.same').count() >= 1, 'gleiche Zahlen nicht markiert');
  await page.click('[data-act=key][data-d="1"]');
  check((await game(page)).cells[givenIdx] === g.cells[givenIdx], 'Vorgabe wurde geändert');
  check(/fest/.test(await page.textContent('.sd-msg')), 'Hinweis „fest“ fehlt');
  await track();

  // Notizmodus + Rückgängig
  await page.click(`[data-act=cell][data-i="${em[0]}"]`);
  await page.click('[data-act=notes]');
  check(/an/.test(await page.textContent('[data-act=notes]')), 'Notizen nicht an');
  await page.click('[data-act=key][data-d="3"]');
  await page.click('[data-act=key][data-d="5"]');
  check(await page.locator(`[data-i="${em[0]}"] .sd-n`).count() === 1, 'Notizen nicht sichtbar');
  check((await page.textContent(`[data-i="${em[0]}"] .sd-n`)).replace(/\s/g, '') === '35', 'Notizen falsch');
  await shot(page, '5_notizen');
  await track();
  await page.click('[data-act=notes]');
  await page.click('[data-act=undo]');
  await page.click('[data-act=undo]');
  check(await page.locator(`[data-i="${em[0]}"] .sd-n`).count() === 0, 'Rückgängig stellt Notizen nicht her');
  check(await page.locator('[data-act=undo][disabled]').count() === 1, 'Rückgängig nicht gesperrt bei leerem Verlauf');
  // Zahl setzen und rückgängig
  await tap(page, em[0], 4);
  check(await cellTxt(page, em[0]) === '4', 'Zahl nicht gesetzt');
  check(await page.locator(`[data-i="${em[0]}"].mine`).count() === 1, 'eigene Zahl nicht farbig');
  await page.click('[data-act=undo]');
  check(await cellTxt(page, em[0]) === '', 'Rückgängig der Zahl');
  // Zahlentaste: „noch n“
  const keyTxt = await page.textContent('[data-act=key][data-d="4"] small');
  const cnt4 = g.cells.filter((v) => v === 4).length;
  check(keyTxt.trim() === `noch ${9 - cnt4}`, `Anzahl noch: ${keyTxt} statt ${9 - cnt4}`);
  // Löschen
  await tap(page, em[0], 2);
  await page.click('[data-act=erase]');
  check(await cellTxt(page, em[0]) === '', 'Löschen');

  // Hilfen aus: falsche Zahl bleibt unmarkiert
  const wrongD = (i) => (Number(g.solution[i]) % 9) + 1;
  await tap(page, em[1], wrongD(em[1]));
  check(await page.locator('.sd-c.bad, .sd-c.wrong').count() === 0, 'Fehleranzeige ohne Hilfen');
  // Hilfen an
  await page.click('[data-act=hilfen]');
  check(await page.locator('[data-act=check]').count() === 1 && await page.locator('[data-act=reveal]').count() === 1, 'Hilfen-Knöpfe fehlen');
  await track();
  await page.click('[data-act=check]');
  check(/passt nicht/.test(await page.textContent('.sd-msg')), 'Prüfen meldet keinen Fehler: ' + await page.textContent('.sd-msg'));
  check(await page.locator(`[data-i="${em[1]}"].wrong`).count() === 1, 'falsches Feld nicht rot');
  await shot(page, '6_pruefen');
  await track();
  // Doppelte Zahl im selben Block/Zeile → rot (Regelverstoß)
  // Neuladen mitten im Spiel (Hilfen bleiben an)
  await page.reload();
  await page.waitForSelector('#board');
  check(await page.locator('[data-act=check]').count() === 1, 'Hilfen nach Neuladen nicht gespeichert');
  check(await cellTxt(page, em[1]) === String(wrongD(em[1])), 'Spielstand nach Neuladen weg');
  const topR = await boardTop(page);
  check(Math.abs(topR - top0) <= 1, `Gitter nach Neuladen woanders: ${topR} statt ${top0}`);
  g = await game(page);
  const el1 = g.elapsed;
  check(el1 > 0, 'Zeit nicht gespeichert');
  // Verraten
  await page.click(`[data-act=cell][data-i="${em[2]}"]`);
  await page.click('[data-act=reveal]');
  check(await cellTxt(page, em[2]) === g.solution[em[2]], 'Verraten falsch');
  check(/\(2\)/.test(await page.textContent('[data-act=reveal]')), 'Zähler Verraten');
  // ohne Auswahl eines leeren Feldes
  await page.click('[data-act=reveal]');
  check(/leere Feld/.test(await page.textContent('.sd-msg')), 'Hinweis bei Verraten ohne leeres Feld');
  for (const i of [em[3], em[4]]) { await page.click(`[data-act=cell][data-i="${i}"]`); await page.click('[data-act=reveal]'); }
  check(await page.locator('[data-act=reveal][disabled]').count() === 1, 'Verraten nach 3x nicht gesperrt');
  await shot(page, '7_verraten');
  await track();
  // Hilfen wieder aus
  await page.click('[data-act=hilfen]');
  check(await page.locator('[data-act=check]').count() === 0, 'Hilfen aus: Prüfen bleibt');
  check(await page.locator('.sd-c.wrong, .sd-c.bad').count() === 0, 'Hilfen aus: Rot bleibt');
  // Zeit ausblenden
  await page.click('[data-act=time-toggle]');
  check(/––/.test(await page.textContent('#sd-clock')), 'Zeit nicht versteckt');
  await page.click('[data-act=time-toggle]');
  // Hilfe-Fenster
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  await shot(page, '8_hilfe');
  check((await page.textContent('.modal')).includes('Notizen'), 'Hilfetext ohne Notizen');
  await page.click('.modal [data-act=help-close]');
  check(await page.locator('.modal').count() === 0, 'Hilfe schließt nicht');

  // Falsch beenden, dann richtig
  await tap(page, em[1], Number(g.solution[em[1]]));
  g = await game(page);
  em = await empties(page);
  const last = em[em.length - 1];
  for (const i of em.slice(0, -1)) await tap(page, i, Number(g.solution[i]));
  await track();
  await tap(page, last, wrongD(last));
  check(/Irgendwo ist noch ein Fehler/.test(await page.textContent('.sd-msg')), 'Fehlerhinweis fehlt: ' + await page.textContent('.sd-msg'));
  check((await game(page)).mode === 'play', 'zu früh beendet');
  await shot(page, '9_fehler');
  await track();
  await tap(page, last, Number(g.solution[last]));
  await page.waitForSelector('.banner.done');
  const over = await page.textContent('.over');
  check(/Deine Zeit/.test(over) && /Geschafft|🎉/.test(await page.textContent('.banner.done') + over), 'Endbild');
  check(/Mit aufgedeckten Feldern/.test(over), 'Hinweis zu aufgedeckten Feldern fehlt');
  await shot(page, '10_geschafft');
  const best1 = await page.evaluate(() => localStorage.getItem('zh.sd_best_leicht'));
  check(best1 === null, 'Bestzeit trotz aufgedeckter Felder gespeichert');
  console.log('Gitterpositionen:', JSON.stringify(tops));
  check(tops.every((t) => Math.abs(t - top0) <= 1), 'Gitter wandert: ' + JSON.stringify(tops));

  // Zweites Rätsel ohne Hilfe lösen → Bestzeit
  await page.click('[data-act=again]');
  await page.waitForSelector('[data-act=level]');
  await page.click('[data-act=level][data-level=leicht]');
  await page.waitForSelector('#board');
  g = await game(page);
  em = await empties(page);
  for (const i of em) await tap(page, i, Number(g.solution[i]));
  await page.waitForSelector('.banner.done');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Bestzeit-Meldung fehlt');
  const best2 = await page.evaluate(() => Number(localStorage.getItem('zh.sd_best_leicht')));
  check(best2 > 0, 'Bestzeit nicht gespeichert');
  console.log('Bestzeit', best2);
  // Neuladen im Endbild bleibt
  await page.reload();
  await page.waitForSelector('.banner.done');
  check(/Neue Bestzeit/.test(await page.textContent('.over')), 'Bestzeit nach Neuladen weg');

  // Neues Rätsel mit Bestätigung
  await page.click('[data-act=again]');
  await page.click('[data-act=level][data-level=mittel]');
  await page.waitForSelector('#board');
  g = await game(page);
  check(g.level === 'mittel', 'Mittel nicht gestartet');
  const nClues = g.cells.filter((v) => v).length;
  check(nClues >= 26 && nClues <= 33, 'Vorgaben Mittel ' + nClues);
  em = await empties(page);
  await tap(page, em[0], Number(g.solution[em[0]]));
  await page.click('[data-act=new-open]');
  check(/noch nicht fertig/.test(await page.textContent('#app')), 'Warnung fehlt');
  await shot(page, '11_neu');
  await page.click('[data-act=new-pick][data-level=schwer]');
  check(await page.locator('[data-act=new-yes]').count() === 1, 'Bestätigung fehlt');
  await page.click('[data-act=new-no]');
  await page.click('[data-act=new-cancel]');
  await page.waitForSelector('#board');
  check((await game(page)).seq === g.seq, 'Rätsel ohne Bestätigung ersetzt');
  await page.click('[data-act=new-open]');
  await page.click('[data-act=new-pick][data-level=schwer]');
  await page.click('[data-act=new-yes]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('zh.sd.hostState')).game.level === 'schwer');
  g = await game(page);
  const sClues = g.cells.filter((v) => v).length;
  check(sClues >= 22 && sClues <= 28, 'Vorgaben Schwer ' + sClues);
  await shot(page, '12_schwer');
  // Verlassen
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
    await shot(p, 'L1_start');
    const texts = new Set();
    let steps = 0, finished = false, idle = 0, reloaded = false;
    const lt = [];
    while (steps < 60) {
      const text = (await p.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 200) fail(`Lernrunde: Textlänge ${text.length}`);
      if (!texts.has(text)) { texts.add(text); if (texts.size === 2) await shot(p, 'L2_zahl'); }
      const target = p.locator('.coach-target').first();
      if (await target.count() === 0) { if (++idle > 300) { fail('Lernrunde: kein Ziel bei: ' + text); break; } await p.waitForTimeout(15); continue; }
      idle = 0;
      lt.push(await boardTop(p));
      if ((await target.getAttribute('data-act')) === 'again') { finished = true; await shot(p, 'L3_ende'); break; }
      if (steps === 5 && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach'); await shot(p, 'L2b_neuladen'); continue; }
      await target.click();
      steps++;
    }
    check(finished, 'Lernrunde nicht beendet');
    const endText = (await p.textContent('.coach .coach-t')).trim();
    check(/Übungsrätsel gelöst/.test(endText), 'Endtext: ' + endText);
    console.log('Lernrunde Schritte', steps, 'Texte', texts.size);
    for (const t of texts) console.log('   -', t);
    const lts = lt.filter((x) => x !== null);
    check(Math.max(...lts) - Math.min(...lts) <= 1, 'Gitter wandert in Lernrunde: ' + JSON.stringify(lts));
    // Danach: richtiges Rätsel
    await p.click('[data-act=again]');
    await p.waitForSelector('[data-act=level]');
    check(await p.locator('.coach').count() === 0, 'Lernrunde läuft nach dem Ende weiter');
    await c2.close();
  }
  {
    // Lernrunde beenden und nicht zurückkehren
    const { ctx: c3, page: p } = await newPage();
    await p.goto(URL);
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
