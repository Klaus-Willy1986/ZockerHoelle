// Lernrunde-Test: NODE_PATH=$(npm root -g) node tests/lernrunde.pasch-phasen-farben.e2e.cjs
// Voraussetzung: Server auf Port 8791  (cd /home/user/zockerhoelle && python3 -m http.server 8791)
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8791;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const CAPS = { pasch: 800, phasen: 160, farben: 330 };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const results = {};

  async function newPage(game) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      window.setInterval = (f, ms, ...a) => orig(f, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(game + ' pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(game + ' console ' + m.text()); });
    return { ctx, page };
  }
  const shot = (page, game, name) => page.screenshot({ path: path.join(SHOTS, `lern_${game}_${name}.png`) });

  async function start(page, game) {
    await page.goto(`http://localhost:${PORT}/${game}/index.html`);
    await page.waitForSelector('[data-act=learn]');
    await page.fill('#name', 'Erna');
    await page.click('[data-act=learn]');
    await page.waitForSelector('.coach');
  }

  async function playGame(game) {
    const { ctx, page } = await newPage(game);
    await start(page, game);
    await shot(page, game, '1_start');
    const texts = new Set();
    let steps = 0; let idle = 0; let finished = false; let withoutTarget = 0;
    const cap = CAPS[game];
    while (steps < cap) {
      const text = (await page.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 200) errors.push(`${game}: Textlänge ${text.length}: ${text}`);
      if (!texts.has(text)) {
        texts.add(text);
        if (texts.size === 3) await shot(page, game, '2_mitte');
      }
      const target = page.locator('.coach-target').first();
      if (await target.count() === 0) {
        if (++idle > 400) { errors.push(`${game}: kein Ziel seit langem: "${text}"`); break; }
        withoutTarget++;
        await page.waitForTimeout(15);
        continue;
      }
      idle = 0;
      const act = await target.getAttribute('data-act');
      if (act === 'again') { finished = true; await shot(page, game, '3_ende'); break; }
      try { await target.click({ timeout: 4000 }); } catch (e) { errors.push(`${game}: Klick fehlgeschlagen bei "${text}": ${e.message.split('\n')[0]}`); break; }
      steps++;
      if (steps === 12) await shot(page, game, '2b_schritt12');
    }
    results[game] = { steps, finished, texts: texts.size };
    if (game === 'pasch' && !finished) errors.push('pasch: Spielende nicht erreicht');
    if (finished) {
      const t = (await page.textContent('.coach .coach-t')).trim();
      if (!/Lernrunde ist zu Ende/.test(t)) errors.push(game + ': Endtext falsch: ' + t);
    }
    console.log(game, JSON.stringify(results[game]), 'Texte:');
    for (const t of texts) console.log('   -', t);
    await ctx.close();
  }

  async function reloadAndStop(game) {
    const { ctx, page } = await newPage(game);
    await start(page, game);
    for (let i = 0; i < 3; i++) {
      const target = page.locator('.coach-target').first();
      if (await target.count() === 0) { await page.waitForTimeout(100); continue; }
      await target.click();
    }
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push(game + ': nach Neuladen keine Lernrunde'));
    if (await page.locator('[data-act=learn-stop]').count() === 0) errors.push(game + ': nach Neuladen kein Beenden-Knopf');
    await shot(page, game, '4_nach_neuladen');
    await page.click('[data-act=learn-stop]');
    await page.waitForTimeout(200);
    if (await page.locator('.coach').count() !== 0) errors.push(game + ': Anleitung bleibt nach Beenden');
    if (await page.locator('.coach-target').count() !== 0) errors.push(game + ': Pulsieren bleibt nach Beenden');
    await shot(page, game, '5_beendet');
    await page.reload();
    await page.waitForTimeout(300);
    if (await page.locator('.coach').count() !== 0) errors.push(game + ': Anleitung kommt nach Neuladen zurück');
    await ctx.close();
  }

  for (const game of ['pasch', 'phasen', 'farben']) {
    await playGame(game);
    await reloadAndStop(game);
  }
  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
