// Playwright-Test: Lernrunde (Ludo, Barrikade) – man folgt NUR den Anweisungen im .coach (erstes .coach-target anklicken).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8792 &
//        NODE_PATH=$(npm root -g) node tests/lernrunde.ludo-barrikade.e2e.cjs
// Umgebung: PORT, SHOTS (Screenshot-Ordner), BK_MAX_MS (Obergrenze Barrikade, Standard 90000), LU_MAX_MS (Standard 240000)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 8792;
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'lernrunde-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];

async function open(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout; // Computer-Takt (900 ms) für den Test beschleunigen
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  return page;
}

async function startLearn(page, game, label) {
  await page.goto(`http://localhost:${PORT}/${game}/index.html`);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach', { timeout: 8000 });
}

// Ein Schritt: tut genau das, was der Coach zeigt. Gibt zurück: 'click' | 'wait' | 'over'
async function follow(page, st, boardSel) {
  const text = ((await page.locator('.coach .coach-t').first().textContent().catch(() => '')) || '').trim();
  if (text) st.texts.add(text);
  if (await page.locator('.trophy').count()) return 'over';
  const tgt = page.locator('.coach-target').first();
  if (await tgt.count()) {
    st.stuck = 0;
    try { await tgt.click({ timeout: 4000 }); st.clicks++; } catch (e) { st.clickFails++; }
    return 'click';
  }
  const mine = await page.locator('.banner.mine').count();
  if (mine && !(await page.locator('#dice .spin, .bk-spin, [aria-label="Noch nicht gewürfelt"]').count())) {
    st.stuck++;
    if (st.stuck > 60) { st.noTarget++; st.stuck = 0; if (st.noTarget < 3) await page.screenshot({ path: path.join(SHOTS, `fehler-kein-ziel-${Date.now()}.png`), fullPage: true }); }
  }
  return 'wait';
}

async function runGame(browser, game, label, maxMs, boardSel) {
  const page = await open(browser, label);
  await startLearn(page, game, label);
  await page.waitForSelector(boardSel);
  const st = { texts: new Set(), clicks: 0, clickFails: 0, noTarget: 0, stuck: 0 };
  const t0 = Date.now();
  let reloaded = false, shotCoach = false, shotBot = false, over = false;
  while (Date.now() - t0 < maxMs) {
    const r = await follow(page, st, boardSel);
    if (r === 'over') { over = true; break; }
    const ctext = ((await page.locator('.coach .coach-t').first().textContent().catch(() => '')) || '');
    if (!shotCoach && /Tippe auf Würfeln/.test(ctext) && st.clicks > 2) { shotCoach = true; await page.screenshot({ path: path.join(SHOTS, `${label}-coach-wuerfeln.png`) }); }
    if (!shotBot && /Computer ist dran/.test(ctext)) { shotBot = true; await page.screenshot({ path: path.join(SHOTS, `${label}-coach-computer.png`) }); }
    if (!reloaded && st.clicks >= 8) {
      reloaded = true;
      await page.reload();
      await page.waitForSelector(boardSel, { timeout: 8000 });
      await page.waitForSelector('.coach', { timeout: 5000 }); // zurück in der Lernrunde
      await page.screenshot({ path: path.join(SHOTS, `${label}-nach-neuladen.png`) });
      console.log(label, 'Neuladen mitten in der Lernrunde: Coach ist wieder da');
    }
    if (r === 'wait') await page.waitForTimeout(25);
  }
  console.log(label, `Klicks ${st.clicks}, Klickfehler ${st.clickFails}, Zustände ohne Ziel ${st.noTarget}, verschiedene Coach-Texte ${st.texts.size}, Spielende: ${over}`);
  for (const t of st.texts) if (t.length > 230) errors.push(`${label}: Coach-Text zu lang: ${t}`);
  if (st.noTarget) errors.push(`${label}: Mensch war dran, aber der Coach hatte kein Ziel (${st.noTarget}x)`);
  if (st.clickFails > 5) errors.push(`${label}: zu viele nicht klickbare Ziele (${st.clickFails})`);
  if (!reloaded) errors.push(`${label}: Neuladen nicht getestet`);
  if (over) {
    const ct = await page.locator('.coach .coach-t').first().textContent();
    console.log(label, 'Ende, Coach:', ct.trim());
    if (!/Spiel ist zu Ende|gewonnen/.test(ct)) errors.push(`${label}: Coach am Ende: ${ct}`);
    await page.screenshot({ path: path.join(SHOTS, `${label}-ende.png`), fullPage: true });
    if (await page.locator('.coach-target[data-act=again]').count() !== 1) errors.push(`${label}: Knopf 'Noch eine Runde' pulsiert nicht`);
    await page.click('.coach-target[data-act=again]');
    await page.waitForSelector(boardSel);
    if (!(await page.locator('.coach').count())) errors.push(`${label}: Coach nach neuer Runde weg`);
  }
  await page.screenshot({ path: path.join(SHOTS, `${label}-schluss.png`) });
  await page.context().close();
  return { over, st };
}

async function stopTest(browser, game, label, boardSel) {
  const page = await open(browser, label);
  await startLearn(page, game, label + '-stop');
  await page.waitForSelector(boardSel);
  await page.click('[data-act=learn-stop]');
  await page.waitForFunction(() => !document.querySelector('.coach'), null, { timeout: 3000 });
  if (await page.locator('.coach-target').count()) errors.push(`${label}: Markierung bleibt nach Beenden`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-beendet.png`) });
  // Spiel läuft normal gegen den Computer weiter
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < 8000 && n < 6) {
    let did = false;
    for (const sel of ['[data-act=place]', '[data-act=dest]', '[data-act=pick]', '[data-act=move]', '[data-act=roll]']) {
      const el = page.locator(sel);
      if (await el.count()) { await el.first().click({ timeout: 2000 }).catch(() => {}); n++; did = true; break; }
    }
    await page.waitForTimeout(did ? 80 : 40);
  }
  if (n < 4) errors.push(`${label}: nach Beenden ging das Spiel nicht weiter (Würfe ${n})`);
  // Neuladen: bleibt ohne Lernrunde
  await page.reload();
  await page.waitForSelector(boardSel, { timeout: 8000 });
  await page.waitForTimeout(300);
  if (await page.locator('.coach').count()) errors.push(`${label}: Coach nach Neuladen wieder da`);
  console.log(label, `Lernrunde beenden ok (Würfe danach ${n})`);
  await page.context().close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await runGame(browser, 'ludo', 'ludo', Number(process.env.LU_MAX_MS) || 240000, '.lu-board');
    await stopTest(browser, 'ludo', 'ludo-stop', '.lu-board');
    await runGame(browser, 'barrikade', 'barrikade', Number(process.env.BK_MAX_MS) || 90000, '.bk-board');
    await stopTest(browser, 'barrikade', 'barrikade-stop', '.bk-board');
  } catch (e) {
    errors.push('Abbruch: ' + e.message);
  }
  await browser.close();
  console.log('errors', JSON.stringify(errors));
  console.log('Screenshots:', SHOTS);
  process.exit(errors.length ? 1 : 0);
})();
