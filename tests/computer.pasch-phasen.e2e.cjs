// Playwright-Test: Pasch & Straße und Phasenwürfeln gegen den Computer (Alleinspiel).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8801 &
//        NODE_PATH=$(npm root -g) node tests/computer.pasch-phasen.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8801;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'computer-pasch-phasen-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];

async function humanStep(game, page) {
  if (game === 'pasch') {
    if (await page.locator('[data-act=roll]').count()) { await page.click('[data-act=roll]'); return true; }
    if (await page.locator('[data-act=pick-yes]').count()) { await page.click('[data-act=pick-yes]'); return true; }
    const rer = page.locator('[data-act=reroll]:not([disabled])');
    if (Math.random() < 0.4 && await rer.count()) { await rer.click(); return true; }
    const picks = page.locator('button[data-act=pick]');
    const n = await picks.count();
    if (n) { await picks.nth(Math.floor(Math.random() * n)).click(); return true; }
    return false;
  }
  // Phasenwürfeln: alles neu würfeln, Phase eintragen sobald "Geschafft"
  if (await page.locator('[data-act=roll]').count()) { await page.click('[data-act=roll]'); return true; }
  if (await page.locator('[data-act=finish-yes]').count()) { await page.click('[data-act=finish-yes]'); return true; }
  const rer = page.locator('[data-act=reroll]:not([disabled])');
  if (await rer.count()) { await rer.click(); return true; }
  return false;
}

async function run(game, n, label, maxMs, needEnd) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  await page.goto(`http://localhost:${PORT}/${game}/index.html`);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="1"]`);
  await page.waitForSelector('.banner');

  const t0 = Date.now();
  let acts = 0, botSeen = false, reloaded = false, shot = false, sawBotRoll = false;
  while (Date.now() - t0 < maxMs && acts < 600) {
    if (await page.locator('.trophy').count()) break;
    const banner = ((await page.locator('.banner').last().textContent().catch(() => '')) || '').trim();
    if (/Computer/.test(banner) && /ist dran/.test(banner)) {
      botSeen = true;
      if (!shot) { shot = true; await page.screenshot({ path: path.join(SHOTS, `${label}-bot-turn.png`), fullPage: true }); }
      if (!reloaded && acts >= 6) {
        reloaded = true;
        const before = await page.evaluate(() => document.body.innerText);
        await page.reload();
        await page.waitForSelector('.banner', { timeout: 8000 });
        await page.screenshot({ path: path.join(SHOTS, `${label}-reloaded.png`), fullPage: true });
        // Computer muss von selbst weiterspielen: Seite verändert sich, bis der Mensch dran ist
        await page.waitForSelector('.banner.mine', { timeout: 20000 });
        console.log(label, 'Neuladen ok, Computer macht weiter');
        continue;
      }
      sawBotRoll = true;
      await page.waitForTimeout(40);
      continue;
    }
    if (await page.locator('.banner.mine').count()) {
      if (await humanStep(game, page)) { acts++; await page.waitForTimeout(25); continue; }
    }
    await page.waitForTimeout(40);
  }
  const over = (await page.locator('.trophy').count()) > 0;
  console.log(label, `Aktionen ${acts}, Computer gesehen: ${botSeen}, Neuladen: ${reloaded}, Ende: ${over}`);
  if (!botSeen || !sawBotRoll) throw new Error(label + ': Computer war nie dran');
  if (!reloaded) throw new Error(label + ': Neuladen nicht getestet');
  if (needEnd && !over) throw new Error(label + ': Spiel nicht beendet');
  if (over) {
    console.log(label, 'Ende:', (await page.textContent('.over h1')).trim());
    await page.screenshot({ path: path.join(SHOTS, `${label}-over.png`), fullPage: true });
    await page.click('[data-act=again]');
    await page.waitForSelector('.banner:not(.done)');
    if (await page.locator('.trophy').count()) throw new Error(label + ': Noch eine Runde: Siegerbildschirm noch da');
    console.log(label, 'Noch eine Runde ok');
    await page.screenshot({ path: path.join(SHOTS, `${label}-again.png`), fullPage: true });
  } else {
    await page.screenshot({ path: path.join(SHOTS, `${label}-end.png`), fullPage: true });
  }
  await browser.close();
}

(async () => {
  await run('pasch', 1, 'pasch-eins', 240000, true);
  await run('pasch', 3, 'pasch-drei', 90000, false);
  await run('phasen', 1, 'phasen-eins', 240000, false);
  await run('phasen', 3, 'phasen-drei', 90000, false);
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('COMPUTER PASCH/PHASEN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
