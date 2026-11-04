// Computergegner im Browser (Alleinspiel, ohne ?mock).
// Aufruf: NODE_PATH=$(npm root -g) node tests/dame.bot.e2e.cjs [Screenshot-Ordner] [Port]
const { chromium } = require('playwright');
const SP = process.argv[2] || '.';
const PORT = process.argv[3] || '8782';
const fail = (m) => { throw new Error(m); };
const check = (c, m) => { if (!c) fail(m); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  let p = await ctx.newPage();
  const hook = (pg) => {
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  };
  hook(p);
  const U = `http://localhost:${PORT}/dame/index.html`;

  // wartet, bis der Mensch dran ist oder das Spiel zu Ende ist; false = Ende
  const myTurn = async () => {
    await p.waitForSelector('.banner.mine, .trophy', { timeout: 8000 });
    return (await p.locator('.trophy').count()) === 0;
  };
  const humanMove = async () => {
    const can = p.locator('button.dm-sq.can');
    const n = await can.count();
    check(n > 0, 'keine ziehbaren Steine');
    await can.nth(Math.floor(Math.random() * n)).click();
    for (let g = 0; g < 14; g++) {
      const tg = p.locator('button.dm-sq.tgt');
      const tn = await tg.count();
      check(tn > 0, 'keine Zielfelder');
      await tg.nth(Math.floor(Math.random() * tn)).click();
      await p.waitForTimeout(20);
      if (!(await p.locator('.banner.mine').count())) return;
      if (!(await p.locator('button.dm-sq.tgt').count())) return;
    }
  };
  const boardSig = () => p.evaluate(() => [...document.querySelectorAll('#board > *')].map((x) => (x.querySelector('.dm-pc') ? x.querySelector('.dm-pc').className : '-')).join(','));

  async function playLevel(level, maxPlies, doExtras) {
    await p.goto(U);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(U);
    await p.fill('#name', 'Gerda');
    check((await p.locator('[data-act=bot]').count()) === 2, 'zwei Bot-Knöpfe');
    await p.screenshot({ path: `${SP}/bot-start.png`, fullPage: true });
    await p.click(`[data-act=bot][data-level="${level}"]`);
    await p.waitForSelector('#board');
    check(/Gegen den Computer/.test(await p.textContent('.room')), 'Kopfzeile Computer');
    let plies = 0;
    let t0 = Date.now();
    let extras = { draw: false, reload: false, reloadBotTurn: false, shot: false };
    while (plies < maxPlies) {
      if (!(await myTurn())) break;
      const before = await boardSig();
      if (doExtras && plies === 3 && !extras.draw) {
        extras.draw = true;
        await p.click('[data-act=draw-offer]');
        await p.waitForSelector('.card.confirm');
        await p.waitForFunction(() => /abgelehnt/.test(document.body.innerText), null, { timeout: 5000 });
        const txt = await p.innerText('.recap');
        check(/Computer hat das Remis-Angebot abgelehnt/.test(txt), 'Ablehnung durch Computer: ' + txt);
        console.log('Remis abgelehnt:', txt.replace(/\n/g, ' | '));
        await p.screenshot({ path: `${SP}/bot-draw-declined.png`, fullPage: true });
        check(await p.locator('.banner.mine').count() === 1, 'danach wieder am Zug');
      }
      await humanMove();
      plies++;
      if (!extras.shot && plies === 2) { extras.shot = true; await p.screenshot({ path: `${SP}/bot-thinking.png`, fullPage: true }); }
      if (doExtras && plies === 6 && !extras.reload) {
        // Neuladen direkt nach meinem Zug: der Computer ist am Zug
        extras.reload = true;
        await p.reload();
        await p.waitForSelector('#board', { timeout: 8000 });
        check(/Gegen den Computer/.test(await p.textContent('.room')), 'nach Neuladen im Spiel');
        await p.screenshot({ path: `${SP}/bot-reloaded.png`, fullPage: true });
        const sigR = await boardSig();
        await p.waitForSelector('.banner.mine', { timeout: 8000 });
        check((await boardSig()) !== sigR, 'Computer hat nach Neuladen weitergespielt');
        console.log('Neuladen mitten im Spiel ok, Computer zog weiter');
        extras.reloadBotTurn = true;
      }
      // Der Computer muss von selbst ziehen
      if (!(await myTurn())) break;
      check((await boardSig()) !== before, 'Brett unverändert');
    }
    const over = (await p.locator('.trophy').count()) > 0;
    if (!over) {
      await p.click('[data-act=resign]'); await p.click('[data-act=resign-yes]');
      await p.waitForSelector('.trophy');
    }
    console.log(`Stufe ${level}: ${plies} eigene Züge, ${((Date.now() - t0) / 1000).toFixed(0)} s, Ende: ${(await p.textContent('h1')).trim()} | ${(await p.textContent('.over .big')).trim()}`);
    await p.screenshot({ path: `${SP}/bot-over-${level}.png`, fullPage: true });
  }

  await playLevel(1, 120, true);
  // Noch eine Runde: Farben getauscht, der Computer beginnt von selbst
  await p.click('[data-act=again]');
  await p.waitForSelector('#board');
  await p.waitForSelector('.banner.mine', { timeout: 8000 });
  const nPieces = await p.locator('.dm-pc').count();
  check(nPieces === 24, 'frisches Brett mit 24 Steinen: ' + nPieces);
  await humanMove();
  await p.waitForSelector('.banner.mine', { timeout: 8000 });
  check(/Computer hat/.test(await p.innerText('.recap')), 'Computer hat in Runde 2 geantwortet');
  console.log('Noch eine Runde ok');
  await p.screenshot({ path: `${SP}/bot-round2.png`, fullPage: true });

  await playLevel(0, 25, false);

  console.log('errors', JSON.stringify(errors));
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
