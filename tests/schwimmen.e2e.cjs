// Browser-Test Schwimmen: NODE_PATH=$(npm root -g) node tests/schwimmen.e2e.cjs
// Voraussetzung: Server auf Port 8966  (cd /home/user/zockerhoelle && python3 -m http.server 8966)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8966;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/sw';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/schwimmen/index.html`;
const errors = [];

async function newPage(browser, label, { w = 390, h = 844, fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
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
const readHost = (page) => page.evaluate(() => { try { const h = JSON.parse(sessionStorage.getItem('zh.sw.hostState') || localStorage.getItem('zh.sw.hostState')); return h && h.game ? h.game : null; } catch { return null; } });
const shotDone = new Set();
async function snapOnce(page, name) { if (shotDone.has(name)) return; shotDone.add(name); await shot(page, 'zustand-' + name); }

const newStats = () => ({ swap1: 0, swap3: 0, pass: 0, knock: 0, call31: 0, note: 0 });

// Ein Schritt des Menschen. Gibt Beschreibung oder null.
async function humanStep(page, stats, { knockP = 0.25 } = {}) {
  const has = async (sel) => (await page.locator(sel).count()) > 0;
  if (!(await has('.banner.mine'))) return null;
  const rnd = Math.random();
  try {
    if (rnd < 0.04) {
      // „31 ansagen“ ohne 31: freundlicher Hinweis
      await page.click('[data-act=call31]', { timeout: 2000 });
      const g = await readHost(page);
      stats.call31++;
      if (await has('.sw-msg .warn')) { stats.note++; await snapOnce(page, 'keine31'); }
      return 'call31';
    }
    if (rnd < 0.04 + knockP && (await has('[data-act=knock]:not([disabled])'))) { await snapOnce(page, 'klopfen'); await page.click('[data-act=knock]', { timeout: 2000 }); stats.knock++; return 'knock'; }
    if (rnd < 0.04 + knockP + 0.1) { await page.click('[data-act=swap3]', { timeout: 2000 }); stats.swap3++; return 'swap3'; }
    if (rnd < 0.04 + knockP + 0.2) { await page.click('[data-act=pass]', { timeout: 2000 }); stats.pass++; return 'pass'; }
    const hand = page.locator('.sw-hand [data-act=hand]');
    const table = page.locator('.sw-table [data-act=table]');
    if (Math.random() < 0.5) {
      await hand.nth(Math.floor(Math.random() * 3)).click({ timeout: 2000 });
      await snapOnce(page, 'handkarte-gewaehlt');
      await table.nth(Math.floor(Math.random() * 3)).click({ timeout: 2000 });
    } else {
      await table.nth(Math.floor(Math.random() * 3)).click({ timeout: 2000 });
      await hand.nth(Math.floor(Math.random() * 3)).click({ timeout: 2000 });
    }
    stats.swap1++;
    return 'swap1';
  } catch { return null; }
}

// Spielt ganze Partie bis zum Ende (oder maxMs). Gibt Zahl der Runden zurück.
async function playGame(page, label, { maxMs = 240000, pos, onOver, knockP } = {}) {
  const stats = newStats();
  const t0 = Date.now();
  let rounds = 0; let acts = 0;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.sw-over').count()) {
      rounds++;
      if (onOver) await onOver(rounds);
      if (await page.locator('[data-act=next]').count()) { await page.click('[data-act=next]'); await page.waitForSelector('#board'); continue; }
      return { stats, rounds, acts, final: true, pos };
    }
    const bp = await boardPos(page);
    if (bp && pos) {
      if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) { errors.push(`${label}: Spielfeld springt ${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
    } else if (bp) pos = bp;
    const r = await humanStep(page, stats, { knockP });
    if (r) { acts++; await page.waitForTimeout(12); } else await page.waitForTimeout(20);
  }
  return { stats, rounds, acts, final: false, pos };
}

async function startBot(browser, n, level, label, vp, { show = false } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  if (show) await page.check('[data-opt=show]');
  await page.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

const checkLayout = async (page, label) => {
  const r = await page.evaluate(() => {
    const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, small: [] };
    document.querySelectorAll('.btn:not(.mini)').forEach((b) => { const r = b.getBoundingClientRect(); if (r.width && r.height < 47.5) out.small.push((b.textContent || '').trim().slice(0, 20) + ' ' + Math.round(r.height)); });
    return out;
  });
  if (r.overflow > 0) errors.push(`${label}: horizontaler Scroll ${r.overflow}px`);
  if (r.small.length) errors.push(`${label}: Knöpfe unter 48px: ${r.small.join(', ')}`);
};

(async () => {
  const browser = await chromium.launch();

  // ---------- (a) Ganze Partie gegen den Computer (2 Personen, Mittel) bis zum Ausscheiden ----------
  {
    const { ctx, page } = await startBot(browser, 1, 1, 'eins', undefined, { show: true });
    await shot(page, 'eins-spiel');
    await checkLayout(page, 'eins-layout');
    const r = await playGame(page, 'eins', { onOver: async (n) => { if (n === 1) { await shot(page, 'eins-ende'); await checkLayout(page, 'eins-ende-layout'); } } });
    console.log('Partie 1 (Mittel):', 'Runden', r.rounds, JSON.stringify(r.stats), 'Ende', r.final);
    if (!r.final) errors.push('eins: Partie nicht beendet');
    else {
      const h1 = (await page.textContent('.sw-over h1')).trim();
      console.log('Ergebnis:', h1);
      await shot(page, 'eins-spielende');
      const g = await readHost(page);
      if (!g || !g.result.final) errors.push('eins: Zustand nicht final');
      if (!(await page.locator('[data-act=again]').count())) errors.push('Neues Spiel fehlt am Spielende');
      if (await page.locator('[data-act=next]').count()) errors.push('Nächste Runde trotz Spielende');
      await page.click('[data-act=again]');
      await page.waitForSelector('#board');
      const g2 = await readHost(page);
      if (g2.round !== 1 || g2.players.some((p) => p.lives !== 3 || p.out)) errors.push('Neues Spiel setzt Leben nicht zurück');
      console.log('Neues Spiel ok');
    }
    await ctx.close();
  }

  // ---------- Gegen 3 und 5 Computer (Leicht), Layout ----------
  for (const [n, lv] of [[3, 0], [5, 1]]) {
    const { ctx, page } = await startBot(browser, n, lv, 'n' + n);
    await shot(page, `n${n}-spiel`);
    await checkLayout(page, `n${n}-layout`);
    const r = await playGame(page, 'n' + n, { maxMs: 200000, knockP: 0.35, onOver: async (k) => { if (k === 1) await shot(page, `n${n}-ende`); } });
    console.log(`${n} Computer:`, 'Runden', r.rounds, JSON.stringify(r.stats), 'Ende', r.final);
    if (!r.final) errors.push(`n${n}: Partie nicht beendet`);
    else await shot(page, `n${n}-spielende`);
    await ctx.close();
  }

  // ---------- Optionen, Neuladen ----------
  {
    const { ctx, page } = await newPage(browser, 'opt');
    await page.goto(BASE);
    await page.fill('#name', 'Anna');
    const optVisible = await page.locator('[data-opt=show]').count();
    if (!optVisible) errors.push('Option Handwert fehlt');
    if (await page.isChecked('[data-opt=show]')) errors.push('Option Handwert sollte standardmäßig aus sein');
    await shot(page, 'optionen');
    await page.click('[data-act=bot][data-n="2"][data-level="0"]');
    await page.waitForSelector('#board');
    if (await page.locator('.sw-val').count()) errors.push('Handwert sichtbar trotz ausgeschalteter Option');
    // Neuladen mitten im Spiel
    const stats = newStats();
    for (let i = 0; i < 4; i++) { await humanStep(page, stats, { knockP: 0 }); await page.waitForTimeout(80); }
    await page.reload();
    await page.waitForSelector('#board, .sw-over', { timeout: 8000 });
    console.log('Neuladen ok');
    await ctx.close();
  }

  // ---------- (b) Lernrunde ----------
  {
    const { ctx, page } = await newPage(browser, 'lern');
    await page.goto(BASE);
    await page.waitForSelector('[data-act=learn]');
    await page.fill('#name', 'Erna');
    await page.click('[data-act=learn]');
    await page.waitForSelector('.coach');
    if (!(await page.locator('.sw-val').count())) errors.push('lern: Handwert wird in der Lernrunde nicht gezeigt');
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
    await page.click('[data-act=next]');
    await page.waitForSelector('#board');
    await page.reload();
    await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern: nach Neuladen keine Lernrunde'));
    await page.click('[data-act=learn-stop]');
    await page.waitForTimeout(200);
    if (await page.locator('.coach').count()) errors.push('lern: Anleitung bleibt');
    await ctx.close();
  }

  // ---------- (c) Zwei im Netz (Mock): verdeckte Karten nie im DOM des Gastes, Zustände identisch ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
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
    if (!(await A.locator('[data-opt=show]').count())) errors.push('Optionen fehlen in der Lobby');
    const B = await ctx.newPage(); watch(B, 'B');
    await B.goto(BASE + '?mock=1&raum=' + code);
    await B.fill('#name', 'Bernd');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    await shot(A, 'netz-lobby');
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');

    const fp = (page) => page.evaluate(() => ({
      table: [...document.querySelectorAll('.sw-table .sw-card')].map((c) => c.getAttribute('aria-label').replace(/, tauschen$/, '')),
      opp: [...document.querySelectorAll('.sw-opp')].map((li) => li.querySelector('.sw-nm').textContent.trim() + '|' + li.querySelector('.sw-lives').getAttribute('aria-label')),
      mine: [...document.querySelectorAll('.sw-hand .sw-card')].map((c) => c.getAttribute('aria-label').replace(/, abgeben$/, '')),
      faces: document.querySelectorAll('#app .sw-card:not(.back)').length,
      banner: (document.querySelector('.banner') || { innerText: '' }).innerText.trim(),
    }));
    const leaks = []; const ident = []; let identChecks = 0; let leakChecks = 0;
    const compare = async () => {
      for (let k = 0; k < 8; k++) {
        if (!(await A.locator('#board').count()) || !(await B.locator('#board').count())) return;
        const [fa, fb, g] = [await fp(A), await fp(B), await readHost(A)];
        if (!g || g.phase !== 'play') return;
        const same = JSON.stringify(fa.table) === JSON.stringify(fb.table) && JSON.stringify(fa.table) === JSON.stringify(g.table.map((c) => `${['Kreuz', 'Pik', 'Herz', 'Karo'][c.s]} ${['Sieben', 'Acht', 'Neun', 'Zehn', 'Bube', 'Dame', 'König', 'Ass'][c.r]}`));
        const livesOk = fa.opp[0].endsWith(`${g.players[1].lives === 0 ? 'schwimmt, keine Leben mehr' : g.players[1].lives === 1 ? 'noch 1 Leben' : 'noch ' + g.players[1].lives + ' Leben'}`);
        if (same && livesOk) {
          identChecks++;
          // Verdeckte Karten: Gast sieht nur 3 Tischkarten + 3 eigene Karten, nichts von Annas Hand (und umgekehrt)
          leakChecks++;
          if (fa.faces !== 6 || fb.faces !== 6) leaks.push(`Kartenflächen im DOM: A ${fa.faces} B ${fb.faces}`);
          const nm = (c) => `${['Kreuz', 'Pik', 'Herz', 'Karo'][c.s]} ${['Sieben', 'Acht', 'Neun', 'Zehn', 'Bube', 'Dame', 'König', 'Ass'][c.r]}`;
          const handA = g.players[0].hand.map(nm); const handB = g.players[1].hand.map(nm);
          if (JSON.stringify(fa.mine.slice().sort()) !== JSON.stringify(handA.slice().sort())) { await A.waitForTimeout(40); continue; }
          if (handA.some((n) => fb.mine.includes(n) || fb.table.includes(n))) leaks.push('Gast sieht Annas Karte');
          if (handB.some((n) => fa.mine.includes(n) || fa.table.includes(n))) leaks.push('Gastgeber sieht Bernds Karte');
          const html = await B.evaluate(() => document.getElementById('app').innerHTML);
          for (const n of handA) if (html.includes(n)) leaks.push('Annas Karte im Gast-HTML: ' + n);
          return;
        }
        await A.waitForTimeout(40);
      }
      ident.push('Zustände verschieden');
    };
    const stA = newStats(); const stB = newStats();
    let acts = 0; let posA = null, posB = null; let shotNet = false;
    const t0 = Date.now(); let rounds = 0;
    while (Date.now() - t0 < 200000) {
      if ((await A.locator('.sw-over').count()) && (await B.locator('.sw-over').count())) {
        rounds++;
        if (rounds === 1) { await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast'); if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf'); }
        if (await A.locator('[data-act=next]').count()) { await A.click('[data-act=next]'); await A.waitForSelector('#board'); await B.waitForSelector('#board'); continue; }
        break;
      }
      for (const [P, st, nm] of [[A, stA, 'A'], [B, stB, 'B']]) {
        const bp = await boardPos(P);
        if (bp) {
          const ref = nm === 'A' ? posA : posB;
          if (ref && (Math.abs(bp.top - ref.top) > 1 || Math.abs(bp.h - ref.h) > 1)) errors.push(`netz ${nm}: Spielfeld springt`);
          if (!ref) { if (nm === 'A') posA = bp; else posB = bp; }
        }
        if (await humanStep(P, st, { knockP: 0.07 })) acts++;
      }
      await compare();
      if (!shotNet && acts > 4) { shotNet = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
      await A.waitForTimeout(25);
    }
    console.log('Netz: Aktionen', acts, 'Runden', rounds, 'A', JSON.stringify(stA), 'B', JSON.stringify(stB), 'Vergleiche', identChecks, 'Leck-Prüfungen', leakChecks);
    if (identChecks < 8) errors.push('Netz: zu wenige Vergleiche ' + identChecks);
    for (const l of new Set(leaks)) errors.push('Netz Leck: ' + l);
    for (const l of new Set(ident)) errors.push('Netz: ' + l);
    await A.waitForSelector('.sw-over'); await B.waitForSelector('.sw-over');
    console.log('Netz Ergebnis:', (await A.textContent('.sw-over h1')).trim(), '|', (await B.textContent('.sw-over h1')).trim());
    await A.click('[data-act=help]');
    await A.waitForSelector('.modal');
    await shot(A, 'hilfe');
    await ctx.close();
  }

  // ---------- (d) Desktop-Ansicht ----------
  {
    const { ctx, page } = await startBot(browser, 3, 0, 'pc', { w: 1280, h: 900 });
    await page.waitForTimeout(500);
    await shot(page, 'pc-spiel');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (ov > 0) errors.push('pc: horizontaler Scroll');
    await ctx.close();
  }

  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('SCHWIMMEN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
