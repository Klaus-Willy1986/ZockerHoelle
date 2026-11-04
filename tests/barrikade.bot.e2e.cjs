// Computergegner-Test für Barrikade (Alleinspiel, ohne ?mock).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8784 &   dann   NODE_PATH=$(npm root -g) node tests/barrikade.bot.e2e.cjs
// Optional: PORT=8784, SHOTS=<Ordner für Bilder>
// Zur Beschleunigung werden setInterval-Intervalle < 200 ms auf 4 ms gesetzt; die Computer-Wartezeit (900 ms) wird erst nach den ersten Zügen verkürzt.
const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.PORT || 8784;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const url = `http://localhost:${PORT}/barrikade/index.html`;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const classify = () => (document.querySelector('.trophy') ? 'over'
  : document.querySelector('[data-act=roll]') ? 'roll'
    : document.querySelector('[data-act=place]') ? 'place'
      : document.querySelector('[data-act=pick]') ? 'pick' : null);

async function humanMove(page) {
  return page.evaluate(async (r) => {
    const E = await import('/barrikade/engine.js');
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const ids = [...document.querySelectorAll('[data-act=pick]')].map((e) => e.dataset.piece);
    const cands = [];
    let seenHouse = false;
    for (const id of ids) {
      const el = document.querySelector(`[data-act=pick][data-piece="${id}"]`);
      if (!el) continue;
      if (el.dataset.node === 'H') { if (seenHouse) continue; seenHouse = true; }
      click(el);
      for (const d of document.querySelectorAll('[data-act=dest]')) cands.push({ id, node: d.dataset.node, kind: d.dataset.kind, dist: E.DIST_TO_GOAL[d.dataset.node] });
    }
    if (!cands.length) throw new Error('keine Zielfelder');
    let pick = cands.find((c) => c.kind === 'goal');
    if (!pick) { const m = Math.min(...cands.map((c) => c.dist)); const best = cands.filter((c) => c.dist === m); pick = best[Math.floor(r * 1000) % best.length]; }
    if (!document.querySelector(`[data-act=dest][data-node="${pick.node}"]`)) click(document.querySelector(`[data-act=pick][data-piece="${pick.id}"]`));
    const dest = document.querySelector(`[data-act=dest][data-node="${pick.node}"]`);
    if (!dest) throw new Error('Zielfeld fehlt');
    click(dest);
  }, rnd());
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const si = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => st(fn, window.__fast && ms === 900 ? 25 : ms, ...a);
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}

async function startBots(page, n) {
  await page.goto(url);
  await page.fill('input', 'Anna');
  await page.click(`[data-act=bot][data-n="${n}"][data-level="1"]`);
  await page.waitForSelector('.bk-board');
}

// Der Mensch spielt, bis `stop(stats)` wahr wird oder das Spiel zu Ende ist.
async function play(page, stats, stop, cap) {
  const t0 = Date.now();
  for (let i = 0; i < cap; i++) {
    if (Date.now() - t0 > 4 * 60 * 1000) throw new Error('Zeitlimit');
    const st = await page.evaluate(classify);
    if (st === 'over') return 'over';
    if (stop(stats)) return 'stop';
    if (!st) {
      const b = await page.evaluate(() => document.querySelector('.banner')?.textContent || '');
      if (/ist dran/.test(b) && !/Du bist dran/.test(b)) {
        if (!stats.bannerOther) stats.bannerOther = b;
        if (!/Computer/.test(b)) throw new Error('Banner nennt den Computer nicht: ' + b);
      }
      const rc = await page.evaluate(() => document.querySelector('.recap')?.textContent || '');
      if (/Computer[^.]*hat die Sperre neu aufgestellt/.test(rc)) stats.botPlaced = true;
      await sleep(20); continue;
    }
    if (st === 'roll') { stats.rolls++; await page.evaluate(() => document.querySelector('[data-act=roll]').click()); await page.waitForFunction(() => !document.querySelector('[data-act=roll]'), null, { timeout: 8000 }); }
    else if (st === 'pick') { await humanMove(page); await page.waitForFunction(() => !document.querySelector('[data-act=pick]'), null, { timeout: 8000 }); }
    else if (st === 'place') {
      stats.places++;
      const nodes = await page.$$eval('[data-act=place]', (els) => els.map((e) => e.dataset.node));
      const node = nodes[Math.floor(rnd() * nodes.length)];
      await page.evaluate((nd) => document.querySelector(`[data-act=place][data-node="${nd}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), node);
      await page.waitForFunction(() => !document.querySelector('[data-act=place]'), null, { timeout: 8000 });
    }
  }
  return 'cap';
}

const turnNo = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /hostState/.test(k)))).game.turnNo; } catch { return null; } });

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- Lauf 1: ein Computer (Mittel) bis zum Siegerbildschirm ----------
    const page = await newPage(browser);
    await startBots(page, 1);
    const stats = { rolls: 0, places: 0 };
    const snap = (name) => page.screenshot({ path: path.join(SHOTS, `bk_bot_${name}.png`), fullPage: true });
    await snap('start');
    // Computer spielt von selbst (mit der echten Wartezeit): nach meinem Zug wechselt das Banner auf den Computer
    await play(page, stats, (s) => !!s.bannerOther, 50);
    console.log('Banner nach meinem Zug:', stats.bannerOther.trim());
    await snap('computer_turn');
    await page.waitForFunction(() => /Du bist dran|Sperre genommen/.test(document.querySelector('.banner')?.textContent || '') || document.querySelector('.trophy'), null, { timeout: 15000 });
    const recap = await page.evaluate(() => document.querySelector('.recap')?.textContent || '');
    if (!/Computer/.test(recap)) throw new Error('Der Computer hat nicht gespielt (Recap): ' + recap);
    console.log('Recap:', recap.replace(/\s+/g, ' ').slice(0, 160));

    await page.evaluate(() => { window.__fast = true; });
    // Neuladen mitten im Spiel
    await play(page, stats, (s) => s.rolls >= 8, 400);
    const before = await turnNo(page);
    await page.reload();
    await page.waitForSelector('.bk-board', { timeout: 10000 });
    await page.evaluate(() => { window.__fast = true; });
    console.log('Neuladen: zurück im Spiel, Zugnummer vorher', before);
    await snap('reload');
    // Computer macht nach dem Neuladen weiter, falls er dran war – sonst nach meinem nächsten Zug
    await play(page, stats, (s) => s.rolls >= 12, 400);
    const after = await turnNo(page);
    if (!(after > before)) throw new Error('Spiel läuft nach Neuladen nicht weiter ' + before + ' -> ' + after);

    const res = await play(page, stats, () => false, 4000);
    if (!stats.botPlaced) throw new Error('Computer hat nie selbst eine Sperre versetzt');
    if (res !== 'over') throw new Error('Spiel nicht beendet (Obergrenze) ' + res);
    const h1 = await page.textContent('.over h1');
    console.log(`Lauf 1 Ende: ${h1.trim()} | meine Würfe ${stats.rolls}, Sperren versetzt ${stats.places}`);
    await snap('over');
    await page.click('[data-act=again]');
    await page.waitForSelector('.bk-board');
    await sleep(300);
    const st2 = await page.evaluate(classify);
    if (st2 === 'over') throw new Error('Noch eine Runde: Spiel sofort zu Ende');
    console.log('Noch eine Runde: ok, Zustand', st2);
    await page.context().close();

    // ---------- Lauf 2: drei Computer ----------
    const p3 = await newPage(browser);
    await startBots(p3, 3);
    await p3.evaluate(() => { window.__fast = true; });
    const s3 = { rolls: 0, places: 0 };
    const res3 = await play(p3, s3, (s) => s.rolls >= 60, 3000);
    const names = await p3.evaluate(() => [...document.querySelectorAll('.bk-chip b, .banner, .recap')].map((e) => e.textContent).join(' '));
    for (const nm of ['Computer 1', 'Computer 2', 'Computer 3']) if (!names.includes(nm) && !/Computer/.test(names)) throw new Error('Name fehlt: ' + nm);
    console.log(`Lauf 2 (3 Computer): ${res3} nach ${s3.rolls} meinen Würfen, Sperren versetzt ${s3.places}`);
    await p3.screenshot({ path: path.join(SHOTS, 'bk_bot_3.png'), fullPage: true });
    await p3.context().close();

    console.log('errors', errors);
    console.log(errors.length ? 'FEHLER' : 'ALLES OK');
    process.exitCode = errors.length ? 1 : 0;
  } catch (e) {
    console.log('errors', errors);
    console.error('TEST FEHLGESCHLAGEN:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
