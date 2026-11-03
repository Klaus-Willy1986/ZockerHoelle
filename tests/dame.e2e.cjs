// Durchspieltest im Browser (zwei Tabs, Test-Modus ?mock=1).
// Aufruf: NODE_PATH=$(npm root -g) node tests/dame.e2e.cjs [Screenshot-Ordner] [Port]
const { chromium } = require('playwright');
const SP = process.argv[2] || '.';
const PORT = process.argv[3] || '8773';
const fail = (m) => { throw new Error(m); };
const check = (c, m) => { if (!c) fail(m); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const A = await ctx.newPage(); const B = await ctx.newPage();
  for (const [n, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', (e) => errors.push(n + ': ' + e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(n + ' console: ' + m.text()));
  }
  const U = `http://localhost:${PORT}/dame/index.html?mock=1`;
  await A.goto(U); await A.fill('#name', 'Gerda');
  await A.click('[data-act=host]'); await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  await B.goto(U + '&raum=' + code); await B.fill('#name', 'Heinz'); await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]'); await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  await A.screenshot({ path: SP + '/dame-A-start.png', fullPage: true });
  await B.screenshot({ path: SP + '/dame-B-start.png', fullPage: true });

  // Größe der Felder prüfen (>= 44 px) und Ausrichtung
  const box = await A.locator('#board').boundingBox();
  console.log('board px', Math.round(box.width), 'x', Math.round(box.height), 'cell', Math.round(box.width / 8));
  check(box.width / 8 >= 44, 'Felder zu klein');
  // Eigene Steine unten: A (Weiß) sieht unten hellen Stein, B (Schwarz) unten dunklen
  const bottomA = await A.locator('#board > *').nth(63 - 0).innerHTML(); // unten rechts ist hell (Reihe 8, Spalte 8: gerade Summe)
  void bottomA;
  const lowerClass = async (p) => p.evaluate(() => { const c = [...document.querySelectorAll('#board > *')]; const pcs = c.slice(40).map((x) => x.querySelector('.dm-pc')).filter(Boolean); return pcs[0].className; });
  check(/ w/.test(await lowerClass(A)), 'A: unten sollten weiße Steine stehen');
  check(/ b/.test(await lowerClass(B)), 'B: unten sollten schwarze Steine stehen');

  const seen = { forced: false, midjump: false, king: false, resign: false };
  let plies = 0, steps = 0, shots = { forced: false, mid: false, sel: false, king: false };
  const act = async (p, name) => {
    // gibt true zurück, wenn ein Zug gemacht wurde
    if (!(await p.locator('.banner.mine').count())) return false;
    const can = p.locator('button.dm-sq.can');
    const n = await can.count();
    if (!n) return false;
    const forced = await p.locator('.dm-hint.force').count();
    if (forced && !seen.forced) seen.forced = true;
    if (forced && !shots.forced) { shots.forced = true; await p.screenshot({ path: SP + `/dame-forced-${name}.png`, fullPage: true }); }
    const k = Math.floor(Math.random() * n);
    await can.nth(k).click();
    if (!shots.sel) { shots.sel = true; await p.screenshot({ path: SP + `/dame-select-${name}.png`, fullPage: true }); }
    for (let guard = 0; guard < 12; guard++) {
      const tg = p.locator('button.dm-sq.tgt');
      const tn = await tg.count();
      check(tn > 0, 'nach Auswahl müssen Zielfelder markiert sein');
      const pick = Math.floor(Math.random() * tn);
      await tg.nth(pick).click();
      await p.waitForTimeout(30);
      if (!(await p.locator('.banner.mine').count())) return true; // Zug abgeschickt
      if (await p.locator('.dm-board').count() && (await p.locator('button.dm-sq.tgt').count()) === 0) return true;
      const hint = (await p.locator('.dm-hint').first().innerText()).trim();
      if (/weiterschlagen/.test(hint)) {
        seen.midjump = true;
        if (!shots.mid) { shots.mid = true; await p.screenshot({ path: SP + `/dame-midjump-${name}.png`, fullPage: true }); }
      }
    }
    return true;
  };

  let drawTested = false;
  while (steps++ < 600) {
    if (await A.locator('.trophy').count()) break;
    let moved = false;
    for (const [p, nm] of [[A, 'A'], [B, 'B']]) {
      if (await p.locator('.trophy').count()) continue;
      if (await act(p, nm)) { moved = true; plies++; await p.waitForTimeout(40); }
      if (!shots.king && await p.locator('.dm-pc.k').count()) { shots.king = true; seen.king = true; await p.screenshot({ path: SP + `/dame-king-${nm}.png`, fullPage: true }); }
    }
    if (plies === 6 && !drawTested) {
      drawTested = true;
      // A bietet Remis an, B lehnt ab
      await A.click('[data-act=draw-offer]');
      await B.waitForSelector('[data-act=draw-decline]');
      await B.screenshot({ path: SP + '/dame-draw-offer-B.png', fullPage: true });
      check(await A.locator('[data-act=draw-cancel]').count() === 1, 'A sieht Zurückziehen');
      await B.click('[data-act=draw-decline]');
      await A.waitForFunction(() => !document.querySelector('[data-act=draw-cancel]'));
      check((await A.locator('[data-act=draw-offer]').isDisabled()), 'Remis-Anbieten nach Ablehnung gesperrt');
      console.log('draw decline ok');
    }
    if (plies >= 60) {
      // Ende erzwingen: Aufgeben mit Bestätigung
      const p = await B.locator('[data-act=resign]').count() ? B : A;
      await p.click('[data-act=resign]');
      await p.waitForSelector('[data-act=resign-yes]');
      await p.screenshot({ path: SP + '/dame-resign-confirm.png', fullPage: true });
      await p.click('[data-act=resign-no]');
      check(await p.locator('[data-act=resign]').count() === 1, 'Zurück aus Bestätigung');
      await p.click('[data-act=resign]'); await p.click('[data-act=resign-yes]');
      seen.resign = true;
      break;
    }
    if (!moved) await A.waitForTimeout(40);
  }
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  console.log('plies', plies, 'seen', JSON.stringify(seen));
  console.log('headline A:', (await A.textContent('h1')).trim(), '| B:', (await B.textContent('h1')).trim());
  console.log('reason:', (await A.textContent('.over .big')).trim());
  await A.screenshot({ path: SP + '/dame-over-A.png', fullPage: true });
  await B.screenshot({ path: SP + '/dame-over-B.png', fullPage: true });

  // Neustart, Farben getauscht
  await A.click('[data-act=again]');
  await B.waitForSelector('#board'); await A.waitForSelector('#board');
  check(/ b/.test(await lowerClass(A)), 'A hat nach Neustart Schwarz');
  check(/ w/.test(await lowerClass(B)), 'B hat nach Neustart Weiß');
  console.log('restart ok:', (await B.innerText('.banner')).trim(), '|', (await A.innerText('.banner')).trim());

  // Remis annehmen
  await A.click('[data-act=draw-offer]');
  await B.waitForSelector('[data-act=draw-accept]');
  await B.click('[data-act=draw-accept]');
  await A.waitForSelector('.trophy');
  console.log('draw accepted:', (await A.textContent('h1')).trim(), '|', (await A.textContent('.over .big')).trim());
  await A.screenshot({ path: SP + '/dame-draw-A.png', fullPage: true });

  // Hilfe öffnen
  await A.click('[data-act=again]'); await A.waitForSelector('#board');
  await A.click('[data-act=help]');
  await A.screenshot({ path: SP + '/dame-help.png' });
  await A.click('.modal [data-act=help-close]');

  // Aufgeben mit Bestätigung (A ist in dieser Partie Schwarz, muss nicht am Zug sein)
  await A.click('[data-act=resign]'); await A.waitForSelector('[data-act=resign-yes]');
  await A.click('[data-act=resign-yes]');
  await B.waitForSelector('.trophy');
  const rt = (await B.textContent('.over .big')).trim();
  console.log('resign:', (await B.textContent('h1')).trim(), '|', rt);
  check(/aufgegeben/.test(rt), 'Aufgeben-Grund fehlt');

  console.log('errors', JSON.stringify(errors));
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
