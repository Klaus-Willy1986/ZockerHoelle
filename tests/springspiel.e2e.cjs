// Springspiel im Browser. Aufruf: NODE_PATH=$(npm root -g) node tests/springspiel.e2e.cjs [Screenshot-Ordner] [Port]
// Server: cd /home/user/zockerhoelle && python3 -m http.server 8812
const { chromium } = require('playwright');
const SP = process.argv[2] || '.';
const PORT = process.argv[3] || process.env.PORT || '8812';
const check = (c, m) => { if (!c) throw new Error(m); };
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const si = window.setInterval.bind(window);
    window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
  });
  const errors = [];
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  p.on('dialog', (d) => d.accept());
  const U = `http://localhost:${PORT}/springspiel/index.html`;
  await p.goto(U);
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await p.goto(U);
  await p.waitForSelector('[data-act=solo]');
  check((await p.locator('#name, #code, [data-act=host]').count()) === 0, 'Startseite ohne Name/Code/Einladung');
  await p.screenshot({ path: `${SP}/sp-start.png`, fullPage: true });

  const stones = async () => Number(await p.innerText('.sp-stat b'));
  const rect = () => p.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height }; });
  const near = (a, c) => Math.abs(a.x - c.x) < 1.5 && Math.abs(a.y - c.y) < 1.5 && Math.abs(a.w - c.w) < 1.5;
  const attr = (sel) => p.$$eval(sel, (els) => els.map((e) => Number(e.dataset.i)));
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  await p.click('[data-act=solo]');
  await p.waitForSelector('#board');
  check((await stones()) === 32, '32 Steine am Anfang');
  check((await p.locator('.sp-hit').count()) === 33, '33 Löcher');
  const R0 = await rect();
  check(R0.w > 330, 'Brett fast volle Breite: ' + R0.w);
  const tap = await p.$$eval('.sp-hit.act', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  check(tap.length === 4 && tap.every((w) => w >= 44), 'Tippflächen >= 44 px: ' + tap);
  check(JSON.stringify((await attr('.sp-hit[data-hint=can]')).sort((a, c) => a - c)) === '[10,22,26,38]', '4 Anfangssteine');
  await p.screenshot({ path: `${SP}/sp-1-start.png`, fullPage: true });

  // Auswahl und Abwahl
  await p.click('.sp-hit[data-i="38"]');
  check((await attr('.sp-hit[data-hint=target]')).join() === '24', 'Ziel Mitte');
  await p.screenshot({ path: `${SP}/sp-2-gewaehlt.png`, fullPage: true });
  await p.click('.sp-hit[data-i="38"]');
  check((await p.locator('.sp-hit[data-hint=target]').count()) === 0, 'Abwahl');
  // Nicht springbarer Stein
  await p.click('.sp-hit[data-i="17"]');
  check(/nicht springen/.test(await p.innerText('.sp-hint')), 'Hinweis unspringbar');
  check(near(R0, await rect()), 'Brett springt nicht (Hinweis)');
  await p.click('.sp-hit[data-i="38"]'); await p.click('.sp-hit[data-i="24"]');
  check((await stones()) === 31, 'nach Zug 31 Steine');
  await p.screenshot({ path: `${SP}/sp-3-nach-zug.png`, fullPage: true });
  // Rückgängig
  await p.click('[data-act=undo]');
  check((await stones()) === 32 && (await p.locator('[data-act=undo][disabled]').count()) === 1, 'Rückgängig stellt her');
  // Neu anfangen mit Bestätigung
  await p.click('.sp-hit[data-i="38"]'); await p.click('.sp-hit[data-i="24"]');
  await p.click('[data-act=restart]');
  check((await p.locator('.sp-confirm').count()) === 1, 'Bestätigung sichtbar');
  check(near(R0, await rect()), 'Brett springt nicht (Bestätigung)');
  await p.screenshot({ path: `${SP}/sp-4-bestaetigung.png`, fullPage: true });
  await p.click('[data-act=confirm-no]');
  check((await stones()) === 31, 'Nein behält Spiel');
  await p.click('[data-act=restart]'); await p.click('[data-act=confirm-yes]');
  check((await stones()) === 32, 'Ja startet neu');

  // Bis zum Ende spielen (zufällig aus den markierten Zügen); Brettposition prüfen, einmal neu laden
  async function playOut(reloadAt, shots) {
    let moves = 0, reloaded = false;
    const R = await rect();
    while (!(await p.locator('.sp-over').count()) && moves < 60) {
      const can = await attr('.sp-hit[data-hint=can]');
      check(can.length > 0, 'im Spiel muss ein Stein springen können');
      const from = pick(can);
      await p.click(`.sp-hit[data-i="${from}"]`);
      const tg = await attr('.sp-hit[data-hint=target]');
      check(tg.length > 0, 'Ziele vorhanden');
      const before = await stones();
      await p.click(`.sp-hit[data-i="${pick(tg)}"]`);
      moves++;
      check((await stones()) === before - 1, 'ein Stein weniger');
      check(near(R, await rect()), `Brett verschoben nach Zug ${moves}`);
      if (shots && moves === 12) await p.screenshot({ path: `${SP}/sp-5-mitte.png`, fullPage: true });
      if (reloadAt && moves === reloadAt && !reloaded) {
        reloaded = true;
        const s = await stones();
        await p.reload();
        await p.waitForSelector('#board');
        check((await stones()) === s, 'Neuladen führt zurück ins Spiel (Steine gleich)');
        check(Number(await p.innerText('.sp-stat:nth-child(2) b')) === moves, 'Zugzähler nach Neuladen');
        check(near(R, await rect()), 'Brett nach Neuladen an gleicher Stelle');
      }
    }
    return moves;
  }
  const m1 = await playOut(7, true);
  await p.waitForSelector('.sp-over');
  const left1 = await stones();
  console.log('Partie 1:', m1, 'Züge,', left1, 'Steine übrig,', (await p.innerText('.sp-over h1')).trim());
  check(/Kein Zug mehr möglich/.test(await p.innerText('.sp-over')), 'Ende-Text');
  check(/Bestleistung/.test(await p.innerText('.sp-over')), 'Bestleistung');
  check(near(await rect(), await rect()), 'stabil');
  await p.screenshot({ path: `${SP}/sp-6-ende.png`, fullPage: true });
  // Neuladen am Ende
  await p.reload(); await p.waitForSelector('.sp-over');
  check(/Bestleistung/.test(await p.innerText('.sp-over')), 'Ende nach Neuladen');
  // Rückgängig am Ende
  await p.click('.sp-over [data-act=undo]');
  await p.waitForSelector('.sp-actions');
  check((await p.locator('.sp-over').count()) === 0, 'Rückgängig führt zurück ins Spiel');
  await playOut(0, false);
  await p.waitForSelector('.sp-over');
  // Noch eine Runde
  await p.click('[data-act=again]');
  await p.waitForSelector('.sp-actions');
  check((await stones()) === 32, 'Noch eine Runde: 32 Steine');
  const best = await p.evaluate(() => JSON.parse(localStorage.getItem('zh.sp_best')));
  console.log('sp_best', JSON.stringify(best));
  check(best && best.eng && best.eng.stones >= 1, 'Bestleistung gespeichert');

  // Französische Form
  await p.click('.sp-hit[data-i="38"]'); await p.click('.sp-hit[data-i="24"]');
  await p.click('[data-act=shape][data-shape=fra]');
  check((await p.locator('.sp-confirm').count()) === 1, 'Formwechsel fragt nach');
  await p.click('[data-act=confirm-yes]');
  check((await p.locator('.sp-hit').count()) === 37 && (await stones()) === 36, '37 Löcher, 36 Steine');
  check((await p.getAttribute('[data-act=shape][data-shape=fra]', 'aria-pressed')) === 'true', 'Schalter zeigt Französisch');
  await p.screenshot({ path: `${SP}/sp-7-franzoesisch.png`, fullPage: true });
  await playOut(0, false);
  await p.waitForSelector('.sp-over');
  console.log('Französisch beendet,', await stones(), 'Steine');
  await p.reload(); await p.waitForSelector('.sp-over');
  await p.click('[data-act=again]'); await p.waitForSelector('.sp-actions');
  check((await p.locator('.sp-hit').count()) === 37, 'Noch eine Runde behält französische Form');
  await p.click('[data-act=shape][data-shape=eng]');
  check((await p.locator('.sp-hit').count()) === 33, 'Zurück zu Englisch ohne Frage (keine Züge)');

  // Hilfe
  await p.click('[data-act=help]');
  await p.waitForSelector('.modal');
  await p.screenshot({ path: `${SP}/sp-8-hilfe.png` });
  await p.click('.modal [data-act=help-close]');
  check((await p.locator('.modal').count()) === 0, 'Hilfe schließt');

  // Lernrunde
  await p.click('[data-act=leave]'); // confirm wird akzeptiert
  await p.waitForSelector('[data-act=learn]');
  await p.click('[data-act=learn]');
  await p.waitForSelector('.coach');
  check((await p.locator('.sp-hit').count()) === 33, 'Lernrunde: englisches Brett');
  check((await p.locator('.sp-shape').count()) === 0, 'Lernrunde ohne Brettform');
  const texts = new Set();
  let steps = 0, over = false, reloaded = false, shots = 0, undoSeen = false;
  const RL = await rect();
  while (steps++ < 200) {
    if (await p.locator('.sp-over').count()) { over = true; break; }
    const snap = await p.evaluate(() => ({ txt: document.querySelector('.coach .coach-t').innerText.trim(), n: document.querySelectorAll('.coach-target').length }));
    check(snap.n > 0, 'Kein Ziel in Lernrunde: ' + snap.txt);
    if (!texts.has(snap.txt)) { texts.add(snap.txt); if (shots < 5) await p.screenshot({ path: `${SP}/sp-lern-${++shots}.png` }); }
    if (/Rückgängig/.test(snap.txt) && (await p.locator('[data-act=undo].coach-target').count())) undoSeen = true;
    if (steps === 10 && !reloaded) {
      reloaded = true;
      await p.reload(); await p.waitForSelector('.coach', { timeout: 8000 });
      check(await p.locator('#board').count(), 'Lernrunde nach Neuladen');
      continue;
    }
    check(near(RL, await rect()), 'Brett springt in Lernrunde');
    await p.locator('.coach-target').first().click({ timeout: 3000 });
  }
  console.log('Lernrunde Schritte', steps, 'Ende', over, 'Rückgängig-Lektion', undoSeen);
  console.log([...texts].join('\n'));
  check(undoSeen, 'Rückgängig-Lektion kam vor');
  check(over, 'Lernrunde erreicht das Ende');
  check(/Lernrunde ist zu Ende/.test(await p.innerText('.coach .coach-t')), 'Ende-Text');
  check((await p.locator('.coach-target[data-act=again]').count()) === 1, 'Ziel Noch eine Runde');
  await p.screenshot({ path: `${SP}/sp-lern-ende.png`, fullPage: true });
  await p.click('[data-act=again]');
  await p.waitForSelector('.coach');
  await p.click('[data-act=learn-stop]');
  check((await p.locator('.coach').count()) === 0, 'Coach weg');
  await p.reload(); await p.waitForSelector('#board');
  check((await p.locator('.coach').count()) === 0, 'nach Neuladen kein Coach');

  console.log('errors', JSON.stringify(errors));
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
