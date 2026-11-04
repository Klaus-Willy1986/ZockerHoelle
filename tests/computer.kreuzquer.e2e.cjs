// Playwright-Test: Kreuz & Quer – (a) Regression der gemeinsamen Oberfläche mit zwei Tabs (mock), (b) Computergegner.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8803 &
//        NODE_PATH=$(npm root -g) node tests/computer.kreuzquer.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8803;
const BASE = `http://localhost:${PORT}/kreuzquer/index.html`;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'kq-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });

async function fast(ctx) {
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
  });
}
function watch(p, n) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: console ${m.text()}`); });
}

// Ein Schritt eines einfachen Spieler-Skripts. Gibt true zurück, wenn etwas getan wurde.
async function act(p) {
  if (await p.locator('[data-act=roll]').count()) { await p.click('[data-act=roll]'); return true; }
  if (await p.locator('[data-act=confirm]').count()) { await p.click('[data-act=confirm]'); return true; }
  if (await p.locator('[data-act=pass-yes]').count()) { await p.click('[data-act=pass-yes]'); return true; }
  const moves = p.locator('[data-act=move]');
  const n = await moves.count();
  if (n) {
    if (Math.random() < 0.3) { await p.click('[data-act=pass]'); return true; }
    await moves.nth(Math.floor(Math.random() * n)).click();
    return true;
  }
  if (await p.locator('[data-act=pass]').count()) { await p.click('[data-act=pass]'); return true; }
  return false;
}

async function regression() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await fast(ctx);
  const A = await ctx.newPage(); watch(A, 'A');
  const B = await ctx.newPage(); watch(B, 'B');
  await A.goto(BASE + '?mock=1');
  await shot(A, 'a-start');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  await B.goto(`${BASE}?mock=1&raum=${code}`);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]');
  await shot(A, 'a-lobby');
  await A.click('[data-act=start]');
  await A.waitForSelector('#dice', { state: 'attached' }); await B.waitForSelector('#dice', { state: 'attached' });
  if (await A.locator('[data-act=speak-toggle]').count() === 0) console.log('Hinweis: kein Vorlesen-Schalter (Browser ohne Sprachausgabe)');
  // Hilfe und Schrift
  await A.click('[data-act=help]'); await A.waitForSelector('.modal');
  await shot(A, 'a-help');
  await A.click('.modal [data-act=help-close]'); await A.waitForSelector('.modal', { state: 'detached' });
  await A.click('[data-act=bigger]');
  if (!(await A.evaluate(() => document.documentElement.classList.contains('big')))) errors.push('Schrift nicht größer');
  await A.click('[data-act=bigger]');
  let fin = false, shots = 0;
  for (let i = 0; i < 4000 && !fin; i++) {
    if (await A.locator('.trophy').count() && await B.locator('.trophy').count()) { fin = true; break; }
    const did = (await act(A)) || (await act(B));
    if (did && shots < 1 && await A.locator('.sheet .cell.mark').count() > 3) { shots++; await shot(A, 'a-game'); }
    if (!did) await A.waitForTimeout(30); else await A.waitForTimeout(10);
  }
  if (!fin) throw new Error('Regression: Spiel nicht beendet');
  await shot(A, 'a-over');
  console.log('Regression: Sieger', (await A.textContent('.over h1')).trim());
  if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht again');
  await A.click('[data-act=again]');
  await A.waitForSelector('#dice', { state: 'attached' }); await B.waitForSelector('#dice', { state: 'attached' });
  if (await A.locator('.trophy').count()) errors.push('Neustart: Siegerbildschirm noch da');
  console.log('Regression: Neustart ok');
  await browser.close();
}

async function computer(n, label, maxMs, untilEnd) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await fast(ctx);
  const page = await ctx.newPage(); watch(page, label);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await shot(page, label + '-start');
  await page.click(`[data-act=bot][data-n="${n}"][data-level="1"]`);
  await page.waitForSelector('#dice', { state: 'attached' });
  const t0 = Date.now();
  let moves = 0, botSeen = false, reloaded = false, shots = 0;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.trophy').count()) break;
    const banner = (await page.locator('.banner').first().textContent().catch(() => '')) || '';
    if (/Computer/.test(banner)) { botSeen = true; if (shots < 1) { shots++; await shot(page, label + '-bot-turn'); } }
    if (!reloaded && moves >= 8 && /Computer/.test(banner)) {
      reloaded = true;
      const before = await page.evaluate(() => document.querySelector('#dice').innerText + document.querySelector('.recap')?.innerText);
      await page.reload();
      await page.waitForSelector('#dice', { timeout: 8000 });
      await shot(page, label + '-reloaded');
      await page.waitForFunction((b) => (document.querySelector('#dice')?.innerText + document.querySelector('.recap')?.innerText) !== b || document.querySelector('.banner.mine') || document.querySelector('.trophy'), before, { timeout: 15000 });
      console.log(label, 'Neuladen ok, Computer macht weiter');
      continue;
    }
    if (await act(page)) { moves++; await page.waitForTimeout(10); } else await page.waitForTimeout(30);
  }
  console.log(label, `Aktionen ${moves}, Computer gesehen: ${botSeen}, Neuladen: ${reloaded}`);
  if (!botSeen) throw new Error(label + ': Computer war nie dran');
  if (!reloaded) throw new Error(label + ': Neuladen nicht getestet');
  if (untilEnd) {
    if (!(await page.locator('.trophy').count())) throw new Error(label + ': Spiel nicht beendet');
    console.log(label, 'Ende:', (await page.textContent('.over h1')).trim());
    await shot(page, label + '-over');
    await page.click('[data-act=again]');
    await page.waitForSelector('#dice', { state: 'attached' });
    if (await page.locator('.trophy').count()) throw new Error('Noch eine Runde: Siegerbildschirm noch da');
    console.log(label, 'Noch eine Runde ok');
    await shot(page, label + '-again');
  } else await shot(page, label + '-end');
  await browser.close();
}

(async () => {
  await regression();
  await computer(1, 'eins', 240000, true);
  await computer(3, 'drei', 60000, false);
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('KQ E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
