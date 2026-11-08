// Browser-Test Kartenrennen: NODE_PATH=$(npm root -g) node tests/kartenrennen.e2e.cjs
// Startet selbst einen Static-Server auf Port 8974 (python3 -m http.server) und beendet ihn am Ende.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8974;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/kr';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/kartenrennen/index.html`;
const errors = [];
let server = null;

async function startServer() {
  server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
}

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

let fallbackClicks = 0;
async function click(page, sel, i = 0) {
  const loc = page.locator(sel).nth(i);
  try { await loc.click({ timeout: 1500 }); } catch {
    fallbackClicks++;
    await loc.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
}
const pickIdx = (n) => Math.floor(Math.random() * n);

// Ein Schritt des Menschen. Gibt Beschreibung oder null.
async function humanStep(page, st) {
  const cnt = (sel) => page.locator(sel).count();
  if (!(await cnt('.banner.mine'))) return null;
  if (await cnt('[data-act=swapok]')) { await snapOnce(page, 'tausch-ok'); await click(page, '[data-act=swapok]'); st.swap++; return 'swapok'; }
  if (await cnt('[data-act=swapcard]')) { await snapOnce(page, 'tausch'); await click(page, '[data-act=swapcard]', pickIdx(await cnt('[data-act=swapcard]'))); return 'swappick'; }
  if (await cnt('[data-act=discard]')) { await snapOnce(page, 'abwerfen'); await click(page, '[data-act=discard]'); st.discard++; return 'discard'; }
  if (await cnt('[data-act=jokeras]')) { await snapOnce(page, 'joker'); await click(page, '[data-act=jokeras]', pickIdx(await cnt('[data-act=jokeras]'))); st.joker++; return 'joker'; }
  if (await cnt('[data-act=opt]')) { await snapOnce(page, 'option'); await click(page, '[data-act=opt]', pickIdx(await cnt('[data-act=opt]'))); st.opt++; return 'opt'; }
  if (await cnt('.kr-tapstone.kr-can')) { await snapOnce(page, 'stein'); await click(page, '.kr-tapstone.kr-can', pickIdx(await cnt('.kr-tapstone.kr-can'))); st.stone++; return 'stone'; }
  if (await cnt('.kr-tgt')) { await snapOnce(page, 'ziel'); await click(page, '.kr-tgt', pickIdx(await cnt('.kr-tgt'))); st.target++; return 'target'; }
  const cards = page.locator('.kr-hand button.can');
  const n = await cards.count();
  if (n) { await click(page, '.kr-hand button.can', pickIdx(n)); st.card++; return 'card'; }
  return null;
}
const newStats = () => ({ card: 0, discard: 0, joker: 0, opt: 0, stone: 0, target: 0, swap: 0 });

async function playGame(page, label, { maxMs = 240000, reloadAt = -1, pos, checkLayout = true } = {}) {
  const stats = newStats();
  const t0 = Date.now();
  let acts = 0; let reloaded = false;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.over').count()) break;
    if (checkLayout) {
      const bp = await boardPos(page);
      if (bp && pos) {
        if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) { errors.push(`${label}: Brett springt ${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
      } else if (bp) pos = bp;
    }
    if (reloadAt >= 0 && !reloaded && acts >= reloadAt) {
      reloaded = true;
      await page.reload();
      await page.waitForSelector('.banner', { timeout: 8000 });
      console.log(label, 'Neuladen ok');
      continue;
    }
    const r = await humanStep(page, stats);
    if (r) { acts++; await page.waitForTimeout(8); } else await page.waitForTimeout(20);
  }
  return { stats, acts, pos, over: (await page.locator('.over').count()) > 0 };
}

async function startBot(browser, n, level, label, vp, hints = true) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  if (hints) await page.check('[data-opt=hints]');
  await shot(page, `${label}-start`);
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

const stoneSig = (page) => page.evaluate(() => [...document.querySelectorAll('.kr-board .kr-stone')].map((g) => {
  const lab = (g.getAttribute('aria-label') || '').replace(/ (wählen|tauschen)$/, '');
  const f = g.querySelector('g[class^="kr-f"]');
  return lab + '|' + (f ? f.innerHTML : '');
}).sort().join('\n'));
const handLabels = (page) => page.evaluate(() => [...document.querySelectorAll('.kr-card')].map((c) => (c.getAttribute('aria-label') || '').replace(/, (spielen|weitergeben)$/, '')).sort());

(async () => {
  await startServer();
  const browser = await chromium.launch();
  try {
    // ---------- 1. Gegen 3 Computer (Mittel), ganzes Spiel, Neuladen, Brett bleibt stehen ----------
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'drei');
      await shot(page, 'drei-spiel');
      const r = await playGame(page, 'drei', { reloadAt: 12 });
      console.log('Spiel gegen 3 Computer:', JSON.stringify(r.stats), 'Aktionen', r.acts, 'Ende', r.over);
      if (!r.over) errors.push('drei: Spiel nicht beendet');
      else {
        console.log('Ergebnis:', (await page.textContent('.over h1')).trim());
        await shot(page, 'drei-ende');
        if (!(await page.locator('[data-act=next]').count()) || !(await page.locator('[data-act=again]').count())) errors.push('Ende: Knöpfe fehlen');
        await page.click('[data-act=next]');
        await page.waitForSelector('#board');
        const gs = await page.evaluate(() => JSON.parse(sessionStorage.getItem('zh.kr.hostState') || localStorage.getItem('zh.kr.hostState')).game);
        if (gs.wins.A + gs.wins.B !== 1) errors.push('Spielstand nicht erhalten ' + JSON.stringify(gs.wins));
        if (gs.round !== 0) errors.push('Neues Spiel beginnt nicht bei Runde 1');
        console.log('Nächstes Spiel ok, Stand', JSON.stringify(gs.wins));
      }
      await ctx.close();
    }

    // ---------- 2. Gegen 1 Computer (Leicht), ohne Hilfe-Optionen, ohne Tausch ----------
    {
      const { ctx, page } = await newPage(browser, 'eins');
      await page.goto(BASE);
      await page.fill('#name', 'Anna');
      await page.uncheck('[data-opt=swap]');
      await page.check('[data-opt=hints]');
      await page.click('[data-act=bot][data-n="1"][data-level="0"]');
      await page.waitForSelector('#board');
      const o = await page.evaluate(() => JSON.parse(localStorage.getItem('zh.kr.hostState')).game);
      if (o.opts.swap !== false) errors.push('Option swap aus nicht übernommen');
      if (o.phase !== 'play') errors.push('ohne Tausch muss das Spiel gleich beginnen');
      if (o.players[2].bot !== true || o.players[0].bot !== false) errors.push('Partnerin soll Computer sein');
      const r = await playGame(page, 'eins', {});
      console.log('Spiel gegen 1 Computer (ohne Tausch):', JSON.stringify(r.stats), 'Ende', r.over);
      if (!r.over) errors.push('eins: Spiel nicht beendet');
      if (r.stats.swap) errors.push('Tausch trotz ausgeschalteter Option');
      await ctx.close();
    }

    // ---------- 3. Lernrunde ----------
    {
      const { ctx, page } = await newPage(browser, 'lern');
      await page.goto(BASE);
      await page.waitForSelector('[data-act=learn]');
      await page.fill('#name', 'Erna');
      await page.click('[data-act=learn]');
      await page.waitForSelector('.coach');
      const texts = new Set();
      let steps = 0; let idle = 0; let finished = false;
      while (steps < 2500) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 260) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern-mitte'); if (/Joker/.test(text) && !shotDone.has('lern-joker')) { shotDone.add('lern-joker'); await shot(page, 'lern-joker'); } }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (++idle > 600) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(12);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'next') { finished = true; await shot(page, 'lern-ende'); break; }
        try { await target.click({ timeout: 2500 }); } catch {
          try { await target.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        }
        steps++;
      }
      console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'verschiedene Texte', texts.size);
      for (const t of [...texts].slice(0, 40)) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      for (const must of [/verdeckt an ihre Partnerin/, /Stall/, /Zielfeld|grüne Feld/, /Schau einfach zu/]) {
        if (![...texts].some((t) => must.test(t))) errors.push('Lernrunde: Text fehlt ' + must);
      }
      if ([...texts].some((t) => /beste|empfehl|am besten/i.test(t))) errors.push('Lernrunde: Zugempfehlung');
      await page.reload();
      await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern: nach Neuladen keine Lernrunde'));
      await page.click('[data-act=learn-stop]');
      await page.waitForTimeout(200);
      if (await page.locator('.coach').count()) errors.push('lern: Anleitung bleibt');
      await ctx.close();
    }

    // ---------- 4. Zwei im Netz (Test-Modus): Gastgeber + Gast, zwei Computer füllen auf ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(() => {
        const si = window.setInterval;
        window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
        const st = window.setTimeout;
        window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
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
      if (!(await A.locator('[data-opt=swap]').count()) || !(await A.locator('[data-opt=hints]').count())) errors.push('Optionen fehlen in der Lobby');
      await A.check('[data-opt=hints]');
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.check('[data-opt=hints]').catch(() => {});
      await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      const hostGame = () => A.evaluate(() => JSON.parse(sessionStorage.getItem('zh.kr.hostState')).game);
      const g0 = await hostGame();
      if (g0.players.filter((p) => p.bot).length !== 2) errors.push('Netz: zwei Computer erwartet');
      if (g0.players[0].name !== 'Anna' || g0.players[2].name !== 'Bernd') errors.push('Netz: Partner sollen gegenüber sitzen ' + g0.players.map((p) => p.name));
      const guestId = g0.players[2].id;
      const stA = newStats(); const stB = newStats();
      let posA = null; let posB = null; let acts = 0; let compared = 0; let shotNet = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 240000) {
        if ((await A.locator('.over').count()) && (await B.locator('.over').count())) break;
        for (const [P, st, nm] of [[A, stA, 'A'], [B, stB, 'B']]) {
          const bp = await boardPos(P);
          if (bp) {
            const ref = nm === 'A' ? posA : posB;
            if (ref && (Math.abs(bp.top - ref.top) > 1 || Math.abs(bp.h - ref.h) > 1)) { errors.push(`netz ${nm}: Brett springt`); if (nm === 'A') posA = bp; else posB = bp; }
            if (!ref) { if (nm === 'A') posA = bp; else posB = bp; }
          }
          if (await humanStep(P, st)) acts++;
        }
        // Zustände vergleichen: gleiche Steine auf gleichen Feldern bei Gastgeber und Gast; im Gast-DOM nur die eigene Hand
        if (acts % 3 === 0 && ((await A.locator('.banner.mine').count()) || (await B.locator('.banner.mine').count())) && !(await A.locator('[data-act=undo]').count()) && !(await B.locator('[data-act=undo]').count())) { // (beim Siebener zeigt die Vorschau absichtlich einen anderen Stand)
          await A.waitForTimeout(80);
          const [sa, sb] = [await stoneSig(A), await stoneSig(B)];
          const gg = await hostGame();
          if (sa === sb) compared++;
          else {
            // ein Stand kann einen Herzschlag hinterherhinken: noch einmal prüfen
            let okSig = false;
            for (let k = 0; k < 10 && !okSig; k++) { await A.waitForTimeout(60); okSig = (await stoneSig(A)) === (await stoneSig(B)); }
            if (!okSig) { const x = (await stoneSig(A)).split('\n'), y = (await stoneSig(B)).split('\n'); const d = x.filter((l) => !y.includes(l)).concat(y.filter((l) => !x.includes(l))); const hg = await hostGame(); errors.push('netz: Brett verschieden: ' + d.map((l) => l.match(/^[^|]*\|<circle cx="(\d+)" cy="(\d+)"/)).filter(Boolean).map((m) => m[0].slice(0, 12) + m[1] + ',' + m[2]).join(' // ') + ' host=' + JSON.stringify(hg.players.map((p) => p.pieces)) + ' turn=' + hg.turn + ' phase=' + hg.phase); }
            else compared++;
          }
          const guestHand = gg.players.find((p) => p.id === guestId).hand;
          const labels = await handLabels(B);
          if (labels.length !== guestHand.length && gg.phase !== 'over') {
            await B.waitForTimeout(60);
            const l2 = await handLabels(B);
            const gh2 = (await hostGame()).players.find((p) => p.id === guestId).hand;
            if (l2.length !== gh2.length) errors.push(`netz: Gast zeigt ${l2.length} Karten, hat ${gh2.length}`);
          }
          const allCards = (await B.evaluate(() => document.querySelectorAll('.kr-card').length));
          if (allCards > 6) errors.push('netz: Gast-DOM zeigt mehr als die eigenen Karten: ' + allCards);
        }
        if (!shotNet && stA.target + stB.target > 3) { shotNet = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        await A.waitForTimeout(15);
      }
      console.log('Netz: Aktionen', acts, 'A', JSON.stringify(stA), 'B', JSON.stringify(stB), 'Vergleiche', compared);
      await A.waitForSelector('.over', { timeout: 20000 }); await B.waitForSelector('.over', { timeout: 20000 });
      console.log('Netz Ergebnis:', (await A.textContent('.over h1')).trim(), '|', (await B.textContent('.over h1')).trim());
      await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
      if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Noch-ein-Spiel-Knopf');
      if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
      const gEnd = await hostGame();
      if (!(gEnd.wins.A + gEnd.wins.B === 1)) errors.push('Netz: Spielstand fehlt');
      await A.click('[data-act=next]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      await shot(A, 'hilfe');
      await ctx.close();
    }

    // ---------- 5. Layout 390x844: kein Seiten-Scroll, Knöpfe >= 48 px, Karten tippbar ----------
    {
      const { ctx, page } = await newPage(browser, 'layout');
      await page.goto(BASE);
      const small = async (where) => {
        const bad = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('.btn:not(.mini), button.kr-card, [data-act=jokeras], [data-act=opt]').forEach((b) => {
            const r = b.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (b.classList.contains('kr-card')) { if (r.width < 48 || r.height < 48) out.push(`Karte ${Math.round(r.width)}x${Math.round(r.height)}`); }
            else if (r.height < 48) out.push(`${b.textContent.trim().slice(0, 25)} ${Math.round(r.height)}px`);
          });
          return out;
        });
        if (bad.length) errors.push(`layout ${where}: zu klein: ${bad.join(', ')}`);
        const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        if (sw[0] > sw[1]) errors.push(`layout ${where}: horizontaler Seiten-Scroll ${sw}`);
      };
      await small('start');
      await page.fill('#name', 'Anna');
      await page.check('[data-opt=hints]');
      await page.click('[data-act=bot][data-n="3"][data-level="1"]');
      await page.waitForSelector('#board');
      const pos = await boardPos(page);
      const st = newStats();
      let n = 0; let checkedJoker = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000 && n < 80 && !(await page.locator('.over').count())) {
        await small('spiel');
        const bp = await boardPos(page);
        if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) errors.push('layout: Brett springt ' + JSON.stringify([pos, bp]));
        if (!checkedJoker && (await page.locator('[data-act=jokeras]').count())) { checkedJoker = true; await shot(page, 'layout-joker'); }
        if (await humanStep(page, st)) n++; else await page.waitForTimeout(20);
      }
      await shot(page, 'layout-spiel');
      console.log('Layout geprüft über', n, 'Aktionen; Brett-Position', JSON.stringify(pos), 'Joker-Bild', checkedJoker);
      await ctx.close();
    }

    // ---------- 6. Desktop-Ansicht ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'pc', { w: 1280, h: 900 });
      await page.waitForTimeout(600);
      await shot(page, 'pc-spiel');
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log('Ersatzklicks (ohne echte Geometrie):', fallbackClicks);
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('KARTENRENNEN E2E OK');
})().catch((e) => { console.error(e); if (server) server.kill(); console.log('errors', JSON.stringify(errors)); process.exit(1); });
