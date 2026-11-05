// Browser-Test Mau-Mau: NODE_PATH=$(npm root -g) node tests/maumau.e2e.cjs
// Voraussetzung: Server auf Port 8821  (cd /home/user/zockerhoelle && python3 -m http.server 8821)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8821;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/mm';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/maumau/index.html`;
const errors = [];

async function newPage(browser, label, { w = 390, h = 844, fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (fast) {
    await ctx.addInitScript(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      const st = window.setTimeout;
      window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console ${m.text()}`); });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
const boardPos = (page) => page.evaluate(() => { const b = document.getElementById('board'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });

const shotDone = new Set();
async function snapOnce(page, name) { if (shotDone.has(name)) return; shotDone.add(name); await shot(page, 'zustand-' + name); }

// Ein Schritt des Menschen. Gibt Beschreibung oder null.
async function humanStep(page, stats) {
  const has = async (sel) => (await page.locator(sel).count()) > 0;
  if (await has('[data-act=mau]')) { await snapOnce(page, 'mau'); await page.click('[data-act=mau]'); stats.mau++; return 'mau'; }
  if (!(await has('.banner.mine'))) return null;
  if (await has('[data-act=wish]')) { await snapOnce(page, 'wunsch'); await page.locator('[data-act=wish]').nth(Math.floor(Math.random() * 4)).click(); stats.wish++; return 'wish'; }
  if (await has('[data-act=play-last]')) { await snapOnce(page, 'letzte'); await page.click('[data-act=play-last]'); stats.last++; return 'last'; }
  if (await has('[data-act=skip]')) { await snapOnce(page, 'acht'); await page.click('[data-act=skip]'); stats.skip++; return 'skip'; }
  if (await has('.mm-action [data-act=draw]')) { await snapOnce(page, 'ziehen'); await page.click('.mm-action [data-act=draw]'); stats.draw++; return 'draw'; }
  if (await has('[data-act=pass]')) await snapOnce(page, 'behalten');
  if (await has('[data-act=pass]') && Math.random() < 0.3) { await page.click('[data-act=pass]'); stats.pass++; return 'pass'; }
  const cards = page.locator('.mm-hand button.can');
  const n = await cards.count();
  if (n) { await cards.nth(Math.floor(Math.random() * n)).click(); stats.card++; return 'card'; }
  return null;
}

async function playRound(page, label, { maxMs = 120000, reloadAt = -1, pos } = {}) {
  const stats = { card: 0, draw: 0, skip: 0, pass: 0, mau: 0, wish: 0, last: 0 };
  const t0 = Date.now();
  let acts = 0; let reloaded = false;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.mm-over').count()) break;
    const bp = await boardPos(page);
    if (bp && pos) {
      if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) { errors.push(`${label}: Spielfeld springt ${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
    } else if (bp) pos = bp;
    if (reloadAt >= 0 && !reloaded && acts >= reloadAt) {
      reloaded = true;
      await page.reload();
      await page.waitForSelector('.banner', { timeout: 8000 });
      console.log(label, 'Neuladen ok');
      continue;
    }
    const r = await humanStep(page, stats);
    if (r) { acts++; await page.waitForTimeout(15); } else await page.waitForTimeout(25);
  }
  return { stats, acts, pos, over: (await page.locator('.mm-over').count()) > 0 };
}

async function startBot(browser, n, level, label, vp) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Gegen den Computer (Mittel), Rundenende, Nächste Runde, Neuladen ----------
  {
    const { ctx, page } = await startBot(browser, 1, 1, 'eins');
    await shot(page, 'eins-spiel');
    const r1 = await playRound(page, 'eins-r1', { reloadAt: 6 });
    console.log('Runde 1:', JSON.stringify(r1.stats), 'Aktionen', r1.acts, 'Ende', r1.over);
    if (!r1.over) errors.push('eins: Runde nicht beendet');
    else {
      console.log('Sieger:', (await page.textContent('.mm-over h1')).trim());
      await shot(page, 'eins-ende');
      const rowsBefore = await page.$$eval('.mm-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
      console.log('Tabelle:', rowsBefore.join(' | '));
      if (!(await page.locator('[data-act=again]').count())) errors.push('Neues Spiel fehlt');
      await page.click('[data-act=next]');
      await page.waitForSelector('#board');
      const sum = await page.evaluate(() => JSON.parse(sessionStorage.getItem('zh.mm.hostState') || localStorage.getItem('zh.mm.hostState')).game);
      if (sum.round !== 2) errors.push('Runde 2 erwartet, ist ' + sum.round);
      if (sum.players.reduce((s, p) => s + p.wins, 0) !== 1) errors.push('Spielstand nicht erhalten');
      const first = await page.evaluate(() => document.querySelector('.banner').innerText.trim());
      console.log('Runde 2 Start:', first);
      const r2 = await playRound(page, 'eins-r2', {});
      console.log('Runde 2:', JSON.stringify(r2.stats), r2.over);
      if (r2.over) {
        const tab = await page.$$eval('.mm-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
        console.log('Tabelle nach Runde 2:', tab.join(' | '));
        await shot(page, 'eins-ende2');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await page.evaluate(() => JSON.parse(localStorage.getItem('zh.mm.hostState')).game);
        if (g2.round !== 1 || g2.players.some((p) => p.wins)) errors.push('Neues Spiel setzt den Stand nicht zurück');
        console.log('Neues Spiel ok');
      }
    }
    await ctx.close();
  }

  // ---------- 2. Gegen 3 Computer, Optionen ----------
  {
    const { ctx, page } = await startBot(browser, 3, 1, 'drei');
    await shot(page, 'drei-spiel');
    const r = await playRound(page, 'drei', { maxMs: 90000 });
    console.log('3 Computer:', JSON.stringify(r.stats), 'Ende', r.over);
    if (!r.over) errors.push('drei: Runde nicht beendet');
    else await shot(page, 'drei-ende');
    await ctx.close();
  }

  // ---------- 3. Ass-Option und automatische Rufe (Startseite) ----------
  {
    const { ctx, page } = await newPage(browser, 'opt');
    await page.goto(BASE);
    await page.fill('#name', 'Anna');
    await page.check('[data-opt=ace]');
    await page.check('[data-opt=auto]');
    await shot(page, 'optionen');
    await page.click('[data-act=bot][data-n="2"][data-level="0"]');
    await page.waitForSelector('#board');
    const o = await page.evaluate(() => JSON.parse(localStorage.getItem('zh.mm.hostState')).game.opts);
    if (!o.ace || !o.auto) errors.push('Optionen nicht übernommen ' + JSON.stringify(o));
    const r = await playRound(page, 'opt', { maxMs: 90000 });
    console.log('Optionen:', JSON.stringify(r.stats), 'Ende', r.over, 'Mau-Klicks (sollte 0)', r.stats.mau);
    if (r.stats.mau) errors.push('Mau-Knopf trotz Automatik');
    if (!r.over) errors.push('opt: Runde nicht beendet');
    await ctx.close();
  }

  // ---------- 4. Lernrunde ----------
  {
    const { ctx, page } = await newPage(browser, 'lern');
    await page.goto(BASE);
    await page.waitForSelector('[data-act=learn]');
    await page.fill('#name', 'Erna');
    await page.click('[data-act=learn]');
    await page.waitForSelector('.coach');
    const texts = new Set();
    let steps = 0; let idle = 0; let finished = false;
    while (steps < 600) {
      const text = (await page.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 220) errors.push(`lern: Textlänge ${text.length}`);
      if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern-mitte'); }
      const target = page.locator('.coach-target').first();
      if ((await target.count()) === 0) {
        if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
        await page.waitForTimeout(15);
        continue;
      }
      idle = 0;
      const act = await target.getAttribute('data-act');
      if (act === 'next') { finished = true; await shot(page, 'lern-ende'); break; }
      try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
      steps++;
    }
    console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
    for (const t of texts) console.log('   -', t);
    if (!finished) errors.push('Lernrunde nicht bis zum Ende');
    // Neuladen und Beenden
    await page.click('[data-act=next]');
    await page.waitForSelector('#board');
    await page.reload();
    await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern: nach Neuladen keine Lernrunde'));
    await page.click('[data-act=learn-stop]');
    await page.waitForTimeout(200);
    if (await page.locator('.coach').count()) errors.push('lern: Anleitung bleibt');
    await ctx.close();
  }

  // ---------- 5. Zwei im Netz (Test-Modus) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    });
    const watch = (p, n) => {
      p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
      p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); });
    };
    const A = await ctx.newPage(); watch(A, 'A');
    await A.goto(BASE + '?mock=1');
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.textContent('.code')).trim();
    if (!(await A.locator('[data-opt=ace]').count())) errors.push('Optionen fehlen in der Lobby');
    await A.check('[data-opt=ace]');
    const B = await ctx.newPage(); watch(B, 'B');
    await B.goto(BASE + '?mock=1&raum=' + code);
    await B.fill('#name', 'Bernd');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    await shot(A, 'netz-lobby');
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    const stA = { card: 0, draw: 0, skip: 0, pass: 0, mau: 0, wish: 0, last: 0 };
    const stB = { ...stA };
    let posA = null, posB = null, acts = 0, shotDone = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      if ((await A.locator('.mm-over').count()) && (await B.locator('.mm-over').count())) break;
      for (const [P, st, nm] of [[A, stA, 'A'], [B, stB, 'B']]) {
        const bp = await boardPos(P);
        if (bp) {
          const ref = nm === 'A' ? posA : posB;
          if (ref && (Math.abs(bp.top - ref.top) > 1 || Math.abs(bp.h - ref.h) > 1)) errors.push(`netz ${nm}: Spielfeld springt`);
          if (!ref) { if (nm === 'A') posA = bp; else posB = bp; }
        }
        if (await humanStep(P, st)) acts++;
      }
      if (!shotDone && stA.mau + stB.mau > 0) { shotDone = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
      await A.waitForTimeout(30);
    }
    console.log('Netz: Aktionen', acts, 'A', JSON.stringify(stA), 'B', JSON.stringify(stB));
    await A.waitForSelector('.mm-over'); await B.waitForSelector('.mm-over');
    console.log('Netz Sieger:', (await A.textContent('.mm-over h1')).trim(), '|', (await B.textContent('.mm-over h1')).trim());
    await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
    if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf');
    if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
    await A.click('[data-act=next]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    const gA = await A.evaluate(() => JSON.parse(sessionStorage.getItem('zh.mm.hostState')).game);
    if (gA.round !== 2 || !gA.opts.ace) errors.push('Netz: Runde 2/Option falsch');
    console.log('Netz Runde 2 ok, Ass-Option:', gA.opts.ace, 'Startperson', gA.players[gA.active].name);
    await A.click('[data-act=help]');
    await A.waitForSelector('.modal');
    await shot(A, 'hilfe');
    await ctx.close();
  }

  // ---------- 6. Desktop-Ansicht ----------
  {
    const { ctx, page } = await startBot(browser, 3, 0, 'pc', { w: 1280, h: 900 });
    await page.waitForTimeout(500);
    await shot(page, 'pc-spiel');
    await ctx.close();
  }

  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('MAUMAU E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
