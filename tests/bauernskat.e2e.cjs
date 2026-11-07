// Browser-Test Bauernskat: NODE_PATH=$(npm root -g) node tests/bauernskat.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8951 (PORT=... ändert das).
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8951);
const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/bauernskat/index.html`;
const errors = [];
let M;

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'bsk-' + name + '.png'), fullPage: true });
const boardPos = (page) => page.evaluate(() => { const b = document.getElementById('board'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });

async function newPage(browser, label, { w = 390, h = 844, fast = true, mock = false } = {}) {
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
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}

// Spielstand des Gastgebers (Alleinspiel: localStorage, Test-Modus: sessionStorage)
const hostGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) { try { const h = JSON.parse(st.getItem('zh.bsk.hostState')); if (h && h.game) return h.game; } catch (e) { /* weiter */ } }
  return null;
});
const myIdxOf = (g, humanId) => g.players.findIndex((p) => p.id === humanId);

// ---------- ein Schritt des Menschen (Zustand aus dem Gastgeber, Klick im DOM) ----------
async function humanStep(page, ctxInfo) {
  const g = await hostGame(page);
  if (!g) return null;
  const mi = ctxInfo.myIdx(g);
  if (mi < 0 || g.turn !== mi) return null;
  if (g.phase === 'trump') {
    const opts = ['0', '1', '2', '3', 'grand'];
    const s = opts[ctxInfo.stats.trumpClicks++ % 5];
    if (!(await page.locator('[data-act=trump]').count())) return null;
    await page.click(`[data-act=trump][data-suit="${s}"]`);
    ctxInfo.stats.trump++;
    return 'trump';
  }
  if (g.phase !== 'play') return null;
  const legal = M.legalCols(g, g.players[mi].id);
  if (!legal.length) return null;
  if (ctxInfo.tryIllegal && !ctxInfo.stats.illegal) {
    const open = g.players[mi].cols.map((c, k) => (c.up !== null ? k : -1)).filter((k) => k >= 0);
    const bad = open.find((k) => !legal.includes(k));
    if (bad !== undefined) {
      if ((await page.locator('.bsk-mine .can, .bsk-mine .dim').count()) > 0) errors.push('Spielbare Karten sind markiert, obwohl die Option aus ist');
      await page.click(`.bsk-mine .bsk-col[data-col="${bad}"] button`);
      await page.waitForSelector('.bsk-line.warn', { timeout: 3000 });
      const txt = await page.textContent('.bsk-line.warn');
      if (!/Farbe bekennen/.test(txt)) errors.push('Hinweis unfreundlich/falsch: ' + txt);
      const after = await hostGame(page);
      if (JSON.stringify(after) !== JSON.stringify(g)) errors.push('Antippen einer unerlaubten Karte hat den Spielstand verändert');
      ctxInfo.stats.illegal++;
      await shot(page, 'hinweis-farbe-bekennen');
      return 'illegal';
    }
  }
  const pickCol = legal[Math.floor(Math.random() * legal.length)];
  await page.click(`.bsk-mine .bsk-col[data-col="${pickCol}"] button`);
  ctxInfo.stats.card++;
  return 'card';
}
const mkInfo = (humanId, tryIllegal = false) => ({ myIdx: (g) => myIdxOf(g, humanId), stats: { trump: 0, card: 0, illegal: 0, trumpClicks: Math.floor(Math.random() * 5) }, tryIllegal });

const humanIdOf = (g) => g.players.find((p) => !p.id.startsWith('bot')).id;

// ---------- Layout-Prüfung (Handy) ----------
async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const out = { hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [] };
    document.querySelectorAll('button, .bsk-mine .bsk-card.face').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      if (el.closest('.coach')) return; // kleine Hilfsknöpfe der Kopfzeile/Lernrunde
      if (el.closest('.topbtns')) return;
      if (b.width < 48 || b.height < 48) out.small.push(`${el.getAttribute('data-act') || el.className} ${Math.round(b.width)}x${Math.round(b.height)}`);
    });
    return out;
  });
  if (r.hscroll > 0) errors.push(`${label}: horizontaler Seitenscroll ${r.hscroll}px`);
  if (r.small.length) errors.push(`${label}: zu kleine Knöpfe/Karten: ${r.small.join(', ')}`);
  return r;
}

// Spielt, bis `stop(page)` wahr ist oder die Zeit abläuft. Prüft ständig die Position des Bretts.
async function playUntil(page, info, { stop, maxMs = 120000, pos = null, label = '', checkLayout = false, after } = {}) {
  const t0 = Date.now();
  let acts = 0; let layoutDone = false;
  const jumps = [];
  while (Date.now() - t0 < maxMs) {
    if (await stop(page)) break;
    const bp = await boardPos(page);
    if (bp && pos) {
      if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) { jumps.push(`${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
    } else if (bp) pos = bp;
    if (checkLayout && bp && !layoutDone) { layoutDone = true; await layoutCheck(page, label + ' Layout'); }
    const r = await humanStep(page, info);
    if (r) { acts++; if (after) await after(r, page); await page.waitForTimeout(15); } else await page.waitForTimeout(25);
  }
  if (jumps.length) errors.push(`${label}: Spielfeld springt (${jumps.length}x) z. B. ${jumps[0]}`);
  return { acts, pos };
}

async function startBot(browser, level, label, { query = '', vp = {}, hints = false, showPoints = false } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE + query);
  await page.fill('#name', 'Anna');
  if (hints) await page.check('[data-opt=hints]');
  if (showPoints) await page.check('[data-opt=showPoints]');
  await page.screenshot({ path: path.join(SHOTS, `bsk-${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="1"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

// Verdeckte Karten dürfen im DOM nie auftauchen (weder als data-c noch als Name im Text)
async function assertNoHidden(page, g, label) {
  const downs = [];
  for (const p of g.players) for (const c of p.cols) if (c.down !== null) downs.push(c.down);
  const found = await page.evaluate(({ downs, names }) => {
    const html = document.documentElement.outerHTML;
    const ids = new Set([...document.querySelectorAll('[data-c]')].map((e) => Number(e.getAttribute('data-c'))));
    const bad = [];
    downs.forEach((d, i) => { if (ids.has(d)) bad.push('data-c ' + d); if (html.includes(names[i].name) || html.includes(names[i].label)) bad.push('Name ' + names[i].name); });
    return bad;
  }, { downs, names: downs.map((d) => ({ name: M.cardName(d), label: M.cardLabel(d) })) });
  if (found.length) errors.push(`${label}: verdeckte Karte im DOM sichtbar: ${found.slice(0, 3).join(', ')}`);
}

(async () => {
  M = await import(path.join(ROOT, 'bauernskat/engine.js'));
  // Server: alte Prozesse auf dem Port beenden (nur per Port, nie per Namen)
  try { const pids = execSync(`lsof -t -i:${PORT} || true`).toString().trim().split(/\s+/).filter(Boolean); pids.forEach((p) => { try { process.kill(Number(p)); } catch (e) { /* weg */ } }); } catch (e) { /* kein lsof */ }
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch();
  try {
    // ---------- (a) Gegen Computer (Mittel): ganze Runde, Nächste Runde, Neuladen ----------
    {
      const { ctx, page } = await startBot(browser, 1, 'a1', { query: '?target=5', showPoints: false });
      await shot(page, 'a1-spiel');
      const g0 = await hostGame(page);
      const hid = humanIdOf(g0);
      const info = mkInfo(hid, true);
      let reloaded = false; let sawTrumpPick = false; let shotPlay = false;
      const r1 = await playUntil(page, info, {
        label: 'a1', checkLayout: true,
        stop: async (p) => (await p.locator('.bsk-over').count()) > 0,
        after: async (act, p) => {
          if (act === 'trump') return;
          const g = await hostGame(p);
          if (!shotPlay && g && g.players[0].tricks + g.players[1].tricks >= 3) { shotPlay = true; await shot(p, 'a1-mitte'); }
          if (!reloaded && g && g.players[0].tricks + g.players[1].tricks >= 4) { reloaded = true; await p.reload(); await p.waitForSelector('#board', { timeout: 8000 }); console.log('a1: Neuladen ok'); }
        },
        maxMs: 90000,
      });
      void sawTrumpPick;
      const over = (await page.locator('.bsk-over').count()) > 0;
      console.log('a1: Runde 1:', JSON.stringify(info.stats), 'Aktionen', r1.acts, 'Ende', over);
      if (!over) errors.push('a1: Runde nicht beendet');
      else {
        const gr = await hostGame(page);
        console.log('a1: Ergebnis:', (await page.textContent('.bsk-over h1')).trim(), '| Augen', JSON.stringify(gr.result.augen), 'Punkte', JSON.stringify(gr.result.gained));
        if (gr.result.augen[gr.players[0].id] + gr.result.augen[gr.players[1].id] !== 120) errors.push('a1: Augen ergeben nicht 120');
        const txt = await page.textContent('.bsk-over');
        if (!/Augen: Du/.test(txt) || !/Spielstand/.test(txt)) errors.push('a1: Rundenende ohne Augen/Spielstand');
        await shot(page, 'a1-rundenende');
        if (gr.phase === 'round_over') {
          const before = gr.players.map((p) => p.score);
          const dealer = gr.dealer;
          await page.click('[data-act=next]');
          await page.waitForSelector('#board');
          const g2 = await hostGame(page);
          if (g2.round !== 2) errors.push('a1: Runde 2 erwartet');
          if (JSON.stringify(g2.players.map((p) => p.score)) !== JSON.stringify(before)) errors.push('a1: Punktestand nicht erhalten');
          if (g2.dealer === dealer) errors.push('a1: Geber wechselt nicht');
          console.log('a1: Nächste Runde ok (Geber gewechselt, Stand erhalten)');
        } else console.log('a1: Spiel war schon zu Ende (Grand-Schwarz), Nächste-Runde-Pfad in a2/b');
      }
      await ctx.close();
    }
    {
      // a2: ?target=1, bis Spielende, mit „Augen anzeigen“, danach Neues Spiel
      const { ctx, page } = await startBot(browser, 1, 'a2', { query: '?target=1', showPoints: true });
      const g0 = await hostGame(page);
      if (g0.opts.target !== 1 || !g0.opts.showPoints) errors.push('a2: Optionen/Ziel nicht übernommen ' + JSON.stringify(g0.opts));
      const info = mkInfo(humanIdOf(g0), false);
      let rounds = 0; let sawPoints = false;
      for (let i = 0; i < 12; i++) {
        await playUntil(page, info, { label: 'a2', stop: async (p) => (await p.locator('.bsk-over').count()) > 0, maxMs: 90000,
          after: async (act, p) => { if (!sawPoints && (await p.locator('.bsk-stats').count())) { const t = await p.textContent('.bsk-stats'); if (/Augen: Du/.test(t)) sawPoints = true; } } });
        rounds++;
        if ((await page.locator('.trophy').count()) > 0) break;
        if (!(await page.locator('[data-act=next]').count())) { errors.push('a2: weder Spielende noch Nächste Runde'); break; }
        await page.click('[data-act=next]');
        await page.waitForSelector('#board');
      }
      if (!sawPoints) errors.push('a2: „Augen anzeigen“ zeigt keine Augen');
      const fin = await page.locator('.trophy').count();
      console.log('a2: Runden bis Spielende', rounds, 'Siegerehrung', fin > 0, info.stats);
      if (!fin) errors.push('a2: Spielende nicht erreicht');
      else {
        await page.waitForTimeout(500);
        const conf = await page.locator('canvas.confetti').count();
        const head = (await page.textContent('.bsk-over h1')).trim();
        console.log('a2: Ende:', head, '| Konfetti:', conf);
        if (/^Du /.test(head) && !conf) errors.push('a2: Gewonnen, aber kein Konfetti');
        await shot(page, 'a2-spielende');
        if (!(await page.locator('[data-act=again]').count())) errors.push('a2: Neues Spiel fehlt');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await hostGame(page);
        if (g2.round !== 1 || g2.players.some((p) => p.score)) errors.push('a2: Neues Spiel setzt den Stand nicht zurück');
        console.log('a2: Neues Spiel ok');
      }
      await ctx.close();
    }
    {
      // Leicht, schnell durch + Layout im Trumpf-Zustand (Brett-Höhe gleich wie im Spiel)
      const { ctx, page } = await startBot(browser, 0, 'a3', { query: '?target=1', hints: true });
      const g0 = await hostGame(page);
      const info = mkInfo(humanIdOf(g0), false);
      const r = await playUntil(page, info, { label: 'a3', stop: async (p) => (await p.locator('.bsk-over').count()) > 0, maxMs: 90000 });
      console.log('a3: Leicht-Runde fertig, Aktionen', r.acts);
      if (!(await page.locator('.bsk-over').count())) errors.push('a3: nicht beendet');
      await ctx.close();
    }

    {
      // a4: Siegerehrung mit Konfetti – so lange Spiele (?target=1) gegen Leicht, bis der Mensch gewonnen hat
      const { ctx, page } = await startBot(browser, 0, 'a4', { query: '?target=1', hints: true });
      let won = false; let conf = 0;
      for (let game = 0; game < 8 && !won; game++) {
        const g0 = await hostGame(page);
        const info = mkInfo(humanIdOf(g0), false);
        for (let i = 0; i < 12; i++) {
          await playUntil(page, info, { label: 'a4', stop: async (p) => (await p.locator('.bsk-over').count()) > 0, maxMs: 90000 });
          if ((await page.locator('.trophy').count()) > 0) break;
          await page.click('[data-act=next]'); await page.waitForSelector('#board');
        }
        const head = (await page.textContent('.bsk-over h1')).trim();
        if (/^Du /.test(head)) { won = true; await page.waitForTimeout(400); conf = await page.locator('canvas.confetti').count(); await shot(page, 'a4-sieg-konfetti'); }
        else { await page.click('[data-act=again]'); await page.waitForSelector('#board'); }
      }
      console.log('a4: Mensch hat gewonnen:', won, '| Konfetti-Canvas:', conf);
      if (!won) errors.push('a4: kein Sieg des Menschen in 8 Spielen (unwahrscheinlich)');
      else if (!conf) errors.push('a4: Sieg ohne Konfetti');
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
      const texts = new Set();
      let steps = 0; let idle = 0; let finished = false; let shotPick = false; let shotHint = false;
      while (steps < 400) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 220) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'trump' && !shotPick) { shotPick = true; await shot(page, 'lern-trumpfwahl'); }
        if (act === 'card' && !shotHint) { shotHint = true; await shot(page, 'lern-karten'); }
        if (act === 'next' || act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        steps++;
      }
      console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      // Hilfe ist automatisch an: spielbare Karten sind markiert
      const gl = await hostGame(page);
      if (!gl.opts.hints) errors.push('lern: hints nicht aktiv');
      if ([...texts].some((t) => /beste|empfehl|am besten/i.test(t))) errors.push('lern: Empfehlung im Text');
      await ctx.close();
    }
    {
      // Lernrunde: nach Neuladen weiter, Beenden
      const { ctx, page } = await newPage(browser, 'lern2');
      await page.goto(BASE);
      await page.fill('#name', 'Erna');
      await page.click('[data-act=learn]');
      await page.waitForSelector('.coach-target');
      await page.click('[data-act=trump]');
      await page.reload();
      await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern2: nach Neuladen keine Lernrunde'));
      await page.click('[data-act=learn-stop]');
      await page.waitForTimeout(200);
      if (await page.locator('.coach').count()) errors.push('lern2: Anleitung bleibt');
      await ctx.close();
    }

    // ---------- (c) Host + Gast (Test-Netz) ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        const si = window.setInterval;
        window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      });
      const watch = (p, n) => {
        p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
        p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); });
        p.on('dialog', (d) => d.accept());
      };
      const A = await ctx.newPage(); watch(A, 'A');
      await A.goto(BASE + '?mock=1&target=1');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      for (const o of ['hints', 'showPoints', 'short']) if (!(await A.locator(`[data-opt=${o}]`).count())) errors.push('Option fehlt in der Lobby: ' + o);
      await A.check('[data-opt=hints]');
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      // ein dritter Gast wird abgewiesen (genau 2 Personen)
      const Cp = await ctx.newPage(); Cp.on('dialog', (d) => d.accept()); // Fehler der abgewiesenen Person zählen nicht
      await Cp.goto(BASE + '?mock=1&raum=' + code);
      await Cp.fill('#name', 'Carla');
      await Cp.click('[data-act=join-invited]');
      await Cp.waitForSelector('.notice', { timeout: 6000 }).catch(() => errors.push('netz: dritter Gast wurde nicht abgewiesen'));
      await Cp.close();

      const idA = (await hostGame(A)).players[0].id;
      const idOf = { A: null, B: null };
      const g0 = await hostGame(A);
      idOf.A = g0.hostId; idOf.B = g0.players.find((p) => p.id !== g0.hostId).id;
      const infoA = { myIdx: (g) => myIdxOf(g, idOf.A), stats: { trump: 0, card: 0, illegal: 0, trumpClicks: 0 }, tryIllegal: false };
      const infoB = { myIdx: (g) => myIdxOf(g, idOf.B), stats: { trump: 0, card: 0, illegal: 0, trumpClicks: 2 }, tryIllegal: false };
      void idA;
      // Guest-Schritt: Zustand kommt vom Gastgeber (A); Klick in B
      const faceSet = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map((e) => Number(e.getAttribute('data-c'))).sort((a, b) => a - b), sel);
      let rounds = 0; let acts = 0; let checks = 0; let posA = null; let posB = null; let sh = false;
      const t0 = Date.now();
      outer: while (Date.now() - t0 < 150000) {
        if ((await A.locator('.trophy').count()) && (await B.locator('.trophy').count())) break;
        if ((await A.locator('.bsk-over').count()) && !(await A.locator('.trophy').count())) {
          await A.click('[data-act=next]'); await A.waitForSelector('#board'); await B.waitForSelector('#board'); rounds++; continue;
        }
        const g = await hostGame(A);
        if (!g || (g.phase !== 'trump' && g.phase !== 'play')) { await A.waitForTimeout(30); continue; }
        // Zustände identisch: Spiegelung der Karten in beiden Ansichten
        const [aMine, aOpp, bMine, bOpp] = [await faceSet(A, '.bsk-mine .face'), await faceSet(A, '.bsk-opp .face'), await faceSet(B, '.bsk-mine .face'), await faceSet(B, '.bsk-opp .face')];
        if (JSON.stringify(aMine) === JSON.stringify(bOpp) && JSON.stringify(aOpp) === JSON.stringify(bMine)) checks++;
        else if (await A.evaluate(() => true)) {
          // kurze Verzögerung zwischen den Seiten zulassen, dann erneut prüfen
          await A.waitForTimeout(60);
          const [a2, o2, b2, p2] = [await faceSet(A, '.bsk-mine .face'), await faceSet(A, '.bsk-opp .face'), await faceSet(B, '.bsk-mine .face'), await faceSet(B, '.bsk-opp .face')];
          if (JSON.stringify(a2) !== JSON.stringify(p2) || JSON.stringify(o2) !== JSON.stringify(b2)) { errors.push('netz: Ansichten von Host und Gast stimmen nicht überein'); break outer; }
          checks++;
        }
        const tA = await A.textContent('.bsk-trump').catch(() => ''); const tB = await B.textContent('.bsk-trump').catch(() => '');
        if (g.phase === 'play' && tA.trim() !== tB.trim()) errors.push(`netz: Trumpf-Anzeige verschieden "${tA.trim()}" / "${tB.trim()}"`);
        await assertNoHidden(A, g, 'netz A'); await assertNoHidden(B, g, 'netz B');
        if (g.phase === 'play' && g.turn === 0 && (await (g.players[0].id === idOf.A ? A : B).locator('.bsk-mine .can').count()) === 0) errors.push('netz: Option „Spielbare Karten anzeigen“ markiert nichts');
        if (g.phase === 'play') {
          const bpA = await boardPos(A); const bpB = await boardPos(B);
          if (bpA && posA && (Math.abs(bpA.top - posA.top) > 1 || Math.abs(bpA.h - posA.h) > 1)) { errors.push('netz A: Spielfeld springt'); posA = bpA; } else if (bpA && !posA) posA = bpA;
          if (bpB && posB && (Math.abs(bpB.top - posB.top) > 1 || Math.abs(bpB.h - posB.h) > 1)) { errors.push('netz B: Spielfeld springt'); posB = bpB; } else if (bpB && !posB) posB = bpB;
        }
        const P = g.turn === 0 ? (g.players[0].id === idOf.A ? A : B) : (g.players[1].id === idOf.A ? A : B);
        const info = P === A ? infoA : infoB;
        if (!sh && g.phase === 'play' && g.players[0].tricks + g.players[1].tricks >= 2) { sh = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        // Der Gast bekommt Zustandsnachrichten vom Gastgeber; Klick in der passenden Seite
        if (P === B) {
          // hostGame(B) gibt es nicht (Gast speichert nichts): Karte über das DOM wählen
          if (g.phase === 'trump') { await B.click(`[data-act=trump][data-suit="${info.stats.trumpClicks++ % 5 === 4 ? 'grand' : info.stats.trumpClicks % 4}"]`); acts++; }
          else {
            const legal = M.legalCols(g, idOf.B);
            const c = legal[Math.floor(Math.random() * legal.length)];
            await B.click(`.bsk-mine .bsk-col[data-col="${c}"] button`); acts++;
          }
        } else if (await humanStep(A, infoA)) acts++;
        await A.waitForTimeout(25);
      }
      const finalA = await hostGame(A);
      console.log('Netz: Aktionen', acts, 'Runden', rounds + 1, 'identische Ansichten geprüft', checks, 'Ende', finalA && finalA.phase);
      if (!(await A.locator('.trophy').count()) || !(await B.locator('.trophy').count())) errors.push('netz: Spielende nicht erreicht');
      else {
        console.log('Netz Sieger:', (await A.textContent('.bsk-over h1')).trim(), '|', (await B.textContent('.bsk-over h1')).trim());
        await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
        if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf');
        if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
        if (!(await A.locator('[data-act=again]').count())) errors.push('Host sieht Neues-Spiel-Knopf nicht');
        // Nach dem Spielende dürfen auch am Ende keine verdeckten Karten stehen (alle weg)
        await A.click('[data-act=again]');
        await A.waitForSelector('#board'); await B.waitForSelector('#board');
        const gN = await hostGame(A);
        if (gN.round !== 1 || gN.players.some((p) => p.score)) errors.push('netz: Neues Spiel ohne Reset');
        await assertNoHidden(B, gN, 'netz B (neues Spiel)');
        await A.click('[data-act=help]');
        await A.waitForSelector('.modal');
        const helpTxt = await A.textContent('.modal');
        if (!/Offiziersskat/.test(helpTxt) || !/Bedienpflicht/.test(helpTxt)) errors.push('Hilfe unvollständig');
        await shot(A, 'hilfe');
      }
      await ctx.close();
    }

    // ---------- (d) Layout: Handy klein, Desktop, große Schrift ----------
    {
      const { ctx, page } = await startBot(browser, 1, 'd1', { vp: { w: 390, h: 844 }, hints: true });
      const g0 = await hostGame(page);
      const info = mkInfo(humanIdOf(g0), false);
      // Trumpfwahl-Ansicht und Spielansicht müssen dieselbe Brett-Höhe haben
      const heights = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const bp = await boardPos(page);
        if (bp) heights.add(bp.h);
        const g = await hostGame(page);
        if (g && g.phase === 'play' && g.players[0].tricks + g.players[1].tricks >= 1) break;
        if (!(await humanStep(page, info))) await page.waitForTimeout(25);
        if (g && g.phase === 'trump' && g.turn === myIdxOf(g, humanIdOf(g)) && (await page.locator('.bsk-pick').count())) { await layoutCheck(page, 'd1 Trumpfwahl'); await shot(page, 'd1-trumpfwahl'); }
      }
      if (heights.size > 1) errors.push('d1: Brett-Höhe ändert sich zwischen Trumpfwahl und Spiel: ' + [...heights].join(','));
      await page.waitForTimeout(300);
      await shot(page, 'd1-spiel');
      await page.click('[data-act=bigger]');
      await page.waitForTimeout(200);
      await layoutCheck(page, 'd1 große Schrift');
      await shot(page, 'd1-gross');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 1, 'd2', { vp: { w: 320, h: 640 } });
      await page.waitForTimeout(500);
      await layoutCheck(page, 'd2 320px');
      await shot(page, 'd2-320');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 1, 'pc', { vp: { w: 1280, h: 900 } });
      await page.waitForTimeout(600);
      await shot(page, 'pc-spiel');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('BAUERNSKAT E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
