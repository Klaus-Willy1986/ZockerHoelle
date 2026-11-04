// Playwright-Test: Farbenwürfeln gegen den Computer (Alleinspiel mit Computergegnern).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8802 &
//        NODE_PATH=$(npm root -g) node tests/computer.farben.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8802;
const URL_ = `http://localhost:${PORT}/farben/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];

const readState = (page) => page.evaluate(() => {
  try { const h = JSON.parse(localStorage.getItem('zh.fw.hostState')); return h && h.game ? { g: h.game, lobby: h.lobby } : null; } catch (e) { return null; }
});
const botPending = (st) => {
  if (!st || st.g.mode !== 'play') return false;
  const g = st.g;
  if (g.phase === 'roll') return g.players[g.active].id.startsWith('bot');
  const ids = g.players.map((p) => p.id);
  const w = g.phase === 'all' ? ids : g.phase === 'active' ? [g.players[g.active].id] : ids.filter((i) => i !== g.players[g.active].id);
  return w.some((id) => id.startsWith('bot') && !(id in g.picks));
};

// Menschlicher Einfach-Spieler: erste mögliche Wahl, passt, wenn nichts geht.
async function humanStep(page) {
  if (await page.$('.trophy')) return false;
  if (await page.$('[data-act=roll]')) { await page.click('[data-act=roll]'); return true; }
  if (!(await page.$('[data-act=die]'))) return false;
  const cs = await page.$$eval('[data-act=die][data-kind=c]:not([disabled])', (e) => e.map((x) => x.dataset.i));
  const ns = await page.$$eval('[data-act=die][data-kind=n]:not([disabled])', (e) => e.map((x) => x.dataset.i));
  for (const c of cs) {
    for (const n of ns) {
      await page.click(`[data-act=die][data-kind=c][data-i="${c}"]`);
      if (await page.$('.fw-ask')) {
        const o = await page.$$eval('[data-act=joker-pick]:not([disabled])', (e) => e.map((x) => x.dataset.v));
        if (!o.length) { await page.click('[data-act=joker-cancel]'); continue; }
        await page.click(`[data-act=joker-pick][data-v="${o[0]}"]`);
      }
      const nb = await page.$(`[data-act=die][data-kind=n][data-i="${n}"]:not([disabled])`);
      if (!nb) { await page.click('[data-act=reset-dice]').catch(() => {}); continue; }
      await nb.click();
      if (await page.$('.fw-ask')) {
        const o = await page.$$eval('[data-act=joker-pick]:not([disabled])', (e) => e.map((x) => x.dataset.v));
        if (!o.length) { await page.click('[data-act=joker-cancel]'); await page.click('[data-act=reset-dice]').catch(() => {}); continue; }
        await page.click(`[data-act=joker-pick][data-v="${o[o.length - 1]}"]`);
      }
      if (await page.$('.confirm.bad')) { await page.click('[data-act=reset-dice]'); continue; }
      for (let k = 0; k < 8 && !(await page.$('[data-act=confirm]')); k++) {
        const opts = await page.$$('.fw-cell.opt');
        if (!opts.length) break;
        await opts[0].click();
      }
      if (await page.$('[data-act=confirm]')) { await page.click('[data-act=confirm]'); return true; }
      await page.click('[data-act=reset-dice]').catch(() => {});
    }
  }
  if (await page.$('[data-act=pass]')) {
    await page.click('[data-act=pass]');
    await page.click('[data-act=pass-yes]');
    return true;
  }
  return false;
}

async function run(browser, n, label, maxMs, untilEnd) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.__botDelay = 20;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? window.__botDelay : ms, ...a);
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_start.png`) });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="1"]`);
  await page.waitForSelector('[data-act=die], [data-act=roll], .banner');

  const t0 = Date.now();
  let humanActs = 0; let botPicked = false; let reloaded = false; let botRolled = false;
  let lastSig = ''; let lastChange = Date.now(); let shotBot = false;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.trophy').count()) break;
    const st = await readState(page);
    if (st) {
      const g = st.g;
      const sig = `${g.throwNo}|${g.phase}|${g.mode}|${Object.keys(g.picks).sort().join(',')}|${g.rollId}`;
      if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
      if (Object.keys(g.picks).some((i) => i.startsWith('bot') && g.picks[i])) botPicked = true;
      if (!shotBot && botPicked) { shotBot = true; await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_bot-picked.png`) }); }
      // Computer ist beim Würfeln dran: er muss von selbst würfeln
      if (g.phase === 'roll' && g.mode === 'play' && g.players[g.active].id.startsWith('bot')) {
        const before = g.rollId;
        const ok = await page.waitForFunction((b) => { const h = JSON.parse(localStorage.getItem('zh.fw.hostState')); return h.game.rollId > b || h.game.mode !== 'play'; }, before, { timeout: 8000 })
          .then(() => true).catch(() => false);
        if (ok) botRolled = true; else errors.push(`${label}: Computer würfelt nicht von selbst`);
        continue;
      }
      // Neuladen mitten im Spiel, während der Computer noch handeln muss
      if (!reloaded && g.throwNo >= 4 && botPending(st)) {
        const snap = JSON.stringify([g.rollId, Object.keys(g.picks).sort()]);
        reloaded = true;
        await page.reload();
        await page.waitForSelector('.banner', { timeout: 8000 });
        await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_reloaded.png`) });
        const moved = await page.waitForFunction((s) => {
          const h = JSON.parse(localStorage.getItem('zh.fw.hostState')); const gg = h.game;
          return JSON.stringify([gg.rollId, Object.keys(gg.picks).sort()]) !== s || gg.mode !== 'play';
        }, snap, { timeout: 8000 }).then(() => true).catch(() => false);
        if (!moved) errors.push(`${label}: nach dem Neuladen macht der Computer nicht weiter`);
        else console.log(label, 'Neuladen ok, Computer macht weiter');
        continue;
      }
    }
    if (Date.now() - lastChange > 15000) {
      await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_haengt.png`) });
      errors.push(`${label}: Spiel hängt (${lastSig})`);
      break;
    }
    if (await humanStep(page)) { humanActs++; await page.waitForTimeout(20); continue; }
    await page.waitForTimeout(30);
  }
  const over = (await page.locator('.trophy').count()) > 0;
  console.log(label, `Eigene Aktionen ${humanActs}, Computer wählte: ${botPicked}, Computer würfelte: ${botRolled}, Neuladen: ${reloaded}, Ende: ${over}`);
  if (!reloaded) errors.push(`${label}: Neuladen nicht getestet`);
  if (!botPicked) errors.push(`${label}: Computer hat nie gewählt`);
  if (untilEnd) {
    if (!botRolled) errors.push(`${label}: Computer hat nie selbst gewürfelt`);
    if (!over) errors.push(`${label}: Spiel nicht beendet`);
    else {
      console.log(label, 'Ende:', (await page.textContent('.over h1')).trim());
      await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_over.png`) });
      await page.click('[data-act=again]');
      await page.waitForSelector('.trophy', { state: 'detached' });
      await page.waitForSelector('.banner');
      console.log(label, 'Noch eine Runde ok');
      await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_again.png`) });
    }
  } else {
    await page.screenshot({ path: path.join(SHOTS, `cfw_${label}_end.png`) });
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await run(browser, 1, 'eins', 240000, true);
  await run(browser, 3, 'drei', 90000, false);
  await browser.close();
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('COMPUTER E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
