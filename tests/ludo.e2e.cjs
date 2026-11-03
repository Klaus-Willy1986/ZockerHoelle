// Playwright-Durchspieltest für Ludo (Test-Modus ?mock=1, mehrere Tabs im selben Browser).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8774 &  dann  NODE_PATH=$(npm root -g) node tests/ludo.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8774;
const BASE = `http://localhost:${PORT}/ludo/index.html?mock=1`;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'ludo-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];

async function newPage(ctx, name) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: console ${m.text()}`); });
  return page;
}

async function playGame(n, label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // Würfel-Animation im Test beschleunigen
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, ms <= 100 ? 4 : ms, ...a);
  });
  const names = ['Anna', 'Bernd', 'Clara', 'Dieter'].slice(0, n);
  const pages = [];
  const a = await newPage(ctx, names[0]);
  pages.push(a);
  await a.goto(BASE);
  await a.fill('#name', names[0]);
  await a.click('[data-act=host]');
  await a.waitForSelector('.code');
  const code = (await a.textContent('.code')).trim();
  for (let i = 1; i < n; i++) {
    const p = await newPage(ctx, names[i]);
    pages.push(p);
    await p.goto(`${BASE}&raum=${code}`);
    await p.fill('#name', names[i]);
    await p.click('[data-act=join-invited]');
    await p.waitForSelector('text=Du bist dabei');
  }
  await a.waitForFunction((k) => document.querySelectorAll('.players li').length === k, n);
  await a.screenshot({ path: path.join(SHOTS, `${label}-lobby.png`) });
  await a.click('[data-act=start]');
  for (const p of pages) await p.waitForSelector('.lu-board');
  await a.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });

  const t0 = Date.now();
  let moves = 0, rolls = 0, shot = 0, nomove = 0;
  const colors = [];
  for (const p of pages) colors.push(await p.textContent('.lu-me'));
  console.log(label, 'Farben:', colors.map((c) => c.trim()).join(' | '));
  while (Date.now() - t0 < 280000) {
    if (await a.locator('.trophy').count()) break;
    let acted = false;
    for (const p of pages) {
      const mine = await p.locator('.banner.mine').count();
      if (!mine) continue;
      const can = p.locator('.lu-can');
      const cnt = await can.count();
      if (cnt > 0) {
        if (shot < 2 && moves > 5) { await p.screenshot({ path: path.join(SHOTS, `${label}-move${shot++}.png`), fullPage: true }); }
        await can.nth(Math.floor(Math.random() * cnt)).click();
        moves++; acted = true;
        break;
      }
      const roll = p.locator('[data-act=roll]');
      if (await roll.count()) {
        await roll.click();
        rolls++; acted = true;
        break;
      }
    }
    if (!acted) await a.waitForTimeout(25);
    else await a.waitForTimeout(40);
    if (await a.locator('.banner.lu-no').count()) nomove++;
    if (nomove === 1 && !fs.existsSync(path.join(SHOTS, `${label}-nomove.png`))) await a.screenshot({ path: path.join(SHOTS, `${label}-nomove.png`) });
  }
  const over = await a.locator('.trophy').count();
  if (!over) throw new Error(label + ': Spiel nicht beendet');
  for (const p of pages) await p.waitForSelector('.trophy');
  console.log(label, 'Ende erreicht nach', moves, 'Zügen,', rolls, 'Würfen;', (await a.textContent('.over h1')).trim());
  await a.screenshot({ path: path.join(SHOTS, `${label}-over.png`), fullPage: true });
  // Neustart
  await a.click('[data-act=again]');
  for (const p of pages) await p.waitForSelector('.lu-board');
  for (const p of pages) if (await p.locator('.trophy').count()) throw new Error('Neustart: Siegerbildschirm noch da');
  const wait = await a.locator('[data-act=roll], .banner').first().textContent();
  console.log(label, 'Neustart ok:', wait.trim());
  // Hilfe öffnen
  await a.click('.topbtns [data-act=help]');
  await a.waitForSelector('.modal');
  await a.screenshot({ path: path.join(SHOTS, `${label}-help.png`) });
  await a.click('.modal [data-act=help-close]');
  await browser.close();
}

(async () => {
  await playGame(2, 'zwei');
  await playGame(4, 'vier');
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
