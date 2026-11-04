// Lernrunde Dame: nur den Anweisungen folgen.
// Aufruf: NODE_PATH=$(npm root -g) node tests/lernrunde.dame.e2e.cjs [Screenshot-Ordner] [Port]
const { chromium } = require('playwright');
const SP = process.argv[2] || '.';
const PORT = process.argv[3] || '8793';
const check = (c, m) => { if (!c) throw new Error(m); };

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
  const U = `http://localhost:${PORT}/dame/index.html`;
  await p.goto(U);
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await p.goto(U);
  await p.fill('#name', 'Gerda');
  await p.screenshot({ path: `${SP}/lern-start.png`, fullPage: true });
  await p.click('[data-act=learn]');
  await p.waitForSelector('.coach');

  const texts = new Set();
  let steps = 0, humanSteps = 0, shots = 0, over = false, reloaded = false;
  const maxSteps = 100000, t0 = Date.now();
  while (steps++ < maxSteps && humanSteps < 150 && Date.now() - t0 < 200000) {
    if (await p.locator('.trophy').count()) { over = true; break; }
    const snap = await p.evaluate(() => ({
      mine: !!document.querySelector('.banner.mine'),
      txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(),
      targets: document.querySelectorAll('.coach-target').length,
    }));
    const { mine, txt } = snap;
    if (mine) {
      check(snap.targets > 0, 'Mensch dran, aber kein Ziel: ' + txt);
      humanSteps++;
      if (!texts.has(txt)) {
        texts.add(txt);
        if (shots < 7) await p.screenshot({ path: `${SP}/lern-${++shots}.png` });
      }
      if (humanSteps === 8 && !reloaded) {
        reloaded = true;
        await p.reload();
        await p.waitForSelector('.coach', { timeout: 8000 });
        check(await p.locator('#board').count(), 'nach Neuladen wieder im Spiel');
        continue;
      }
      await p.locator('.coach-target').first().click({ timeout: 3000 }).catch(() => {});
    } else {
      check(/Computer/.test(txt), 'Computer-Text erwartet: ' + txt);
      check(snap.targets === 0, 'Computer dran: kein Ziel');
      await p.waitForTimeout(30);
    }
  }
  console.log('Schritte', steps, 'Menschen-Schritte', humanSteps, 'Ende', over);
  console.log([...texts].join('\n'));
  if (over) {
    const t = (await p.innerText('.coach .coach-t')).trim();
    check(/zu Ende/.test(t), 'Ende-Text: ' + t);
    check((await p.locator('.coach-target[data-act=again]').count()) === 1, 'Ziel Noch eine Runde');
    await p.screenshot({ path: `${SP}/lern-ende.png`, fullPage: true });
  } else {
    await p.click('[data-act=resign]'); await p.click('[data-act=resign-yes]');
    await p.waitForSelector('.trophy');
    console.log('Obergrenze erreicht, aufgegeben');
  }
  // Noch eine Runde, dann Lernrunde beenden
  await p.click('[data-act=again]');
  await p.waitForSelector('#board');
  await p.waitForSelector('.coach');
  await p.click('[data-act=learn-stop]');
  check((await p.locator('.coach').count()) === 0, '.coach verschwindet');
  await p.screenshot({ path: `${SP}/lern-beendet.png` });
  await p.waitForSelector('.banner.mine', { timeout: 8000 });
  await p.reload();
  await p.waitForSelector('#board', { timeout: 8000 });
  check((await p.locator('.coach').count()) === 0, 'nach Neuladen kein Coach mehr');

  console.log('errors', JSON.stringify(errors));
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
