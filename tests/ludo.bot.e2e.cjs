// Playwright-Test: Ludo gegen Computer (Alleinspiel).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8783 &  dann  NODE_PATH=$(npm root -g) node tests/ludo.bot.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8783;
const URL_ = `http://localhost:${PORT}/ludo/index.html`;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'ludo-bot-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];

async function run(n, label, maxMs, untilEnd) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  await page.goto(URL_);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="1"]`);
  await page.waitForSelector('.lu-board');

  const t0 = Date.now();
  let moves = 0, rolls = 0, botSeen = false, bannerOther = false, reloaded = false, shot = 0;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.trophy').count()) break;
    const banner = (await page.locator('.banner').first().textContent().catch(() => '')) || '';
    if (/Computer/.test(banner)) { botSeen = true; bannerOther = true; if (shot < 1) await page.screenshot({ path: path.join(SHOTS, `${label}-bot-turn.png`), fullPage: true }); shot = 1; }
    if (!reloaded && moves >= 6 && /Computer/.test(banner)) {
      const before = await page.locator('.lu-players li .muted').allTextContents();
      reloaded = true;
      await page.reload();
      await page.waitForSelector('.lu-board', { timeout: 8000 });
      await page.screenshot({ path: path.join(SHOTS, `${label}-reloaded.png`), fullPage: true });
      // Computer muss von selbst weiterspielen
      await page.waitForFunction((b) => JSON.stringify([...document.querySelectorAll('.lu-players li .muted')].map((e) => e.textContent)) !== JSON.stringify(b) || document.querySelector('.banner.mine'), before, { timeout: 15000 });
      console.log(label, 'Neuladen ok, Computer macht weiter');
      continue;
    }
    if (await page.locator('.banner.mine').count()) {
      const can = page.locator('.lu-can');
      const cnt = await can.count();
      if (cnt > 0) { await can.nth(Math.floor(Math.random() * cnt)).click(); moves++; await page.waitForTimeout(30); continue; }
      const roll = page.locator('[data-act=roll]');
      if (await roll.count()) { await roll.click(); rolls++; await page.waitForTimeout(30); continue; }
    }
    await page.waitForTimeout(40);
  }
  console.log(label, `Züge ${moves}, Würfe ${rolls}, Computer gesehen: ${botSeen}, Neuladen: ${reloaded}`);
  if (!botSeen) throw new Error(label + ': Computer war nie dran');
  if (!reloaded) throw new Error(label + ': Neuladen nicht getestet');
  if (untilEnd) {
    if (!(await page.locator('.trophy').count())) throw new Error(label + ': Spiel nicht beendet');
    console.log(label, 'Ende:', (await page.textContent('.over h1')).trim());
    await page.screenshot({ path: path.join(SHOTS, `${label}-over.png`), fullPage: true });
    await page.click('[data-act=again]');
    await page.waitForSelector('.lu-board');
    if (await page.locator('.trophy').count()) throw new Error('Noch eine Runde: Siegerbildschirm noch da');
    console.log(label, 'Noch eine Runde ok');
    await page.screenshot({ path: path.join(SHOTS, `${label}-again.png`), fullPage: true });
  } else {
    await page.screenshot({ path: path.join(SHOTS, `${label}-end.png`), fullPage: true });
  }
  await browser.close();
}

(async () => {
  await run(1, 'eins', 240000, true);
  await run(3, 'drei', 90000, false);
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('BOT E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
