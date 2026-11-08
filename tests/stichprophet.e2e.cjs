// Browser-Test Stichprophet: NODE_PATH=$(npm root -g) node tests/stichprophet.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8970 (PORT=... ändert das).
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8970);
const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/stichprophet/index.html`;
const errors = [];
let M;

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'st-' + name + '.png'), fullPage: true });
const boardPos = (page) => page.evaluate(() => { const b = document.getElementById('board'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });

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
  watch(page, label);
  return { ctx, page };
}
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
}

// Spielstand des Gastgebers (Alleinspiel: localStorage, Test-Modus: sessionStorage)
const hostGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) { try { const h = JSON.parse(st.getItem('zh.st.hostState')); if (h && h.game) return h.game; } catch (e) { /* weiter */ } }
  return null;
});
const humanIdOf = (g) => g.players.find((p) => !p.id.startsWith('bot')).id;

// ---------- ein Schritt einer Person (Zustand aus dem Gastgeber, Klick im DOM der Person) ----------
async function stepFor(page, g, pid, stats, tryIllegal = false) {
  const mi = g.players.findIndex((p) => p.id === pid);
  if (mi < 0 || g.turn !== mi) return null;
  if (g.phase === 'trump') {
    const k = Math.floor(Math.random() * 4);
    if (!(await page.locator('[data-act=trump]').count())) return null;
    await page.click(`[data-act=trump][data-suit="${k}"]`);
    stats.trump++;
    return 'trump';
  }
  if (g.phase === 'bid') {
    if (!(await page.locator('[data-act=bid]').count())) return null;
    const f = M.forbiddenBid(g, pid);
    let n = Math.floor(Math.random() * (g.round + 1));
    if (n === f) n = (n + 1) % (g.round + 1);
    await page.click(`[data-act=bid][data-n="${n}"]`);
    stats.bid++;
    return 'bid';
  }
  if (g.phase !== 'play') return null;
  const legal = M.legalCards(g, pid);
  if (!legal.length) return null;
  if (!(await page.locator('.st-hand button').count())) return null;
  if (tryIllegal && !stats.illegal) {
    const bad = g.players[mi].hand.find((c) => !legal.includes(c));
    if (bad !== undefined) {
      if ((await page.locator('.st-hand .can, .st-hand .dim').count()) > 0) errors.push('Spielbare Karten sind markiert, obwohl die Option aus ist');
      await page.click(`.st-hand button[data-card="${bad}"]`);
      await page.waitForSelector('.st-line.warn', { timeout: 3000 });
      const txt = await page.textContent('.st-line.warn');
      if (!/Farbe bekennen/.test(txt)) errors.push('Hinweis unfreundlich/falsch: ' + txt);
      const after = await hostGame(page);
      if (after && JSON.stringify(after) !== JSON.stringify(g)) errors.push('Antippen einer unerlaubten Karte hat den Spielstand verändert');
      stats.illegal++;
      await shot(page, 'hinweis-farbe-bekennen');
      return 'illegal';
    }
  }
  const c = legal[Math.floor(Math.random() * legal.length)];
  await page.click(`.st-hand button[data-card="${c}"]`);
  stats.card++;
  return 'card';
}
const mkStats = () => ({ trump: 0, bid: 0, card: 0, illegal: 0 });

async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const out = { hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [] };
    document.querySelectorAll('button').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      if (el.closest('.coach') || el.closest('.topbtns')) return; // kleine Hilfsknöpfe
      if (b.width < 47.5 || b.height < 47.5) out.small.push(`${el.getAttribute('data-act') || el.className} ${b.width.toFixed(1)}x${b.height.toFixed(1)}`);
    });
    return out;
  });
  if (r.hscroll > 0) errors.push(`${label}: horizontaler Seitenscroll ${r.hscroll}px`);
  if (r.small.length) errors.push(`${label}: zu kleine Knöpfe/Karten: ${[...new Set(r.small)].slice(0, 5).join(', ')}`);
  return r;
}

// Spielt als Mensch (Alleinspiel), bis stop() wahr ist. Prüft laufend die Position des Bretts.
async function playUntil(page, humanId, stats, { stop, maxMs = 120000, label = '', checkLayout = false, tryIllegal = false, after } = {}) {
  const t0 = Date.now();
  let pos = null; let layoutDone = false; let acts = 0;
  const jumps = [];
  while (Date.now() - t0 < maxMs) {
    if (await stop(page)) break;
    const bp = await boardPos(page);
    if (bp && pos) { if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) { jumps.push(`${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; } } else if (bp) pos = bp;
    if (checkLayout && bp && !layoutDone) { layoutDone = true; await layoutCheck(page, label + ' Layout'); }
    const g = await hostGame(page);
    const r = g ? await stepFor(page, g, humanId, stats, tryIllegal) : null;
    if (r) { acts++; if (after) await after(r, page, g); await page.waitForTimeout(12); } else await page.waitForTimeout(25);
  }
  if (jumps.length) errors.push(`${label}: Spielfeld springt (${jumps.length}x) z. B. ${jumps[0]}`);
  return acts;
}

async function startBot(browser, n, level, label, { query = '', vp = {}, checks = [] } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE + query);
  await page.fill('#name', 'Anna');
  for (const c of checks) await page.check(`[data-opt=${c}]`);
  await page.screenshot({ path: path.join(SHOTS, `st-${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

// Fremde Hände dürfen im DOM nie auftauchen (data-c nur für eigene Hand, Tisch, Aufdeckkarte; Namen nicht im Text)
async function assertNoHidden(page, g, pid, label) {
  const others = [];
  g.players.forEach((p) => { if (p.id !== pid) others.push(...p.hand); });
  const res = await page.evaluate(({ others, names }) => {
    const html = document.documentElement.outerHTML;
    const ids = new Set([...document.querySelectorAll('[data-c]')].map((e) => Number(e.getAttribute('data-c'))));
    const bad = [];
    others.forEach((d, i) => { if (ids.has(d)) bad.push('data-c ' + d); const n = names[i]; if (n && new RegExp(n.replace(/ /g, ' ') + '(?!\\d)').test(html)) bad.push('Name ' + n); });
    return bad;
  }, { others, names: others.map((c) => (M.isWizard(c) || M.isFool(c) ? null : M.cardName(c))) });
  if (res.length) errors.push(`${label}: fremde Karte im DOM sichtbar: ${res.slice(0, 3).join(', ')}`);
}

(async () => {
  M = await import(path.join(ROOT, 'stichprophet/engine.js'));
  try { const pids = execSync(`lsof -t -i:${PORT} || true`).toString().trim().split(/\s+/).filter(Boolean); pids.forEach((p) => { try { process.kill(Number(p)); } catch (e) { /* weg */ } }); } catch (e) { /* kein lsof */ }
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch();
  try {
    // ---------- (a1) Gegen 2 Computer (Mittel): ganzes Spiel (3 Runden), Neuladen, unerlaubte Karte, Nächste Runde ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'a1', { query: '?rounds=3' });
      await shot(page, 'a1-spiel');
      const g0 = await hostGame(page);
      if (g0.players.length !== 3 || g0.totalRounds !== 3) errors.push('a1: 3 Personen / 3 Runden erwartet ' + g0.players.length + '/' + g0.totalRounds);
      const hid = humanIdOf(g0);
      const stats = mkStats();
      let reloaded = false; let shotBid = false; let shotPlay = false; let rounds = 0;
      for (let i = 0; i < 4; i++) {
        await playUntil(page, hid, stats, {
          label: 'a1', checkLayout: i === 0, tryIllegal: true,
          stop: async (p) => (await p.locator('.st-over').count()) > 0,
          after: async (act, p, g) => {
            if (act === 'bid' && !shotBid && g.round === 2) { shotBid = true; }
            if (act === 'card' && !shotPlay && g.round === 3 && g.players.reduce((s, q) => s + q.tricks, 0) >= 1) { shotPlay = true; await shot(p, 'a1-mitte'); }
            if (!reloaded && g.round === 2 && act === 'card') { reloaded = true; await p.reload(); await p.waitForSelector('#board', { timeout: 8000 }); console.log('a1: Neuladen ok'); }
          },
          maxMs: 90000,
        });
        rounds++;
        const gr = await hostGame(page);
        const txt = await page.textContent('.st-over');
        if (!/Ansage/.test(txt) || !/Gesamt/.test(txt)) errors.push('a1: Rundenende ohne Ansage/Gesamt');
        const sumT = gr.result.rows.reduce((s, r) => s + r.tricks, 0);
        if (sumT !== gr.round) errors.push(`a1: Stiche ${sumT} != Runde ${gr.round}`);
        for (const r of gr.result.rows) if (r.delta !== M.roundPoints(r.bid, r.tricks)) errors.push('a1: Wertung falsch');
        if (i === 0) await shot(page, 'a1-rundenende');
        if (gr.phase === 'over') break;
        const before = gr.players.map((p) => p.score);
        await page.click('[data-act=next]');
        await page.waitForSelector('#board');
        const g2 = await hostGame(page);
        if (g2.round !== gr.round + 1) errors.push('a1: nächste Runde erwartet');
        if (JSON.stringify(g2.players.map((p) => p.score)) !== JSON.stringify(before)) errors.push('a1: Punktestand nicht erhalten');
        if (g2.players.some((p) => p.hand.length !== g2.round)) errors.push('a1: Kartenzahl falsch');
      }
      const fin = await page.locator('.trophy').count();
      console.log('a1: Runden', rounds, 'Aktionen', JSON.stringify(stats), 'Spielende', fin > 0);
      if (!fin) errors.push('a1: Spielende nicht erreicht');
      else {
        await page.waitForTimeout(400);
        const head = (await page.textContent('.st-over h1')).trim();
        const conf = await page.locator('canvas.confetti').count();
        console.log('a1: Ende:', head, '| Konfetti:', conf);
        const gf = await hostGame(page);
        const iWon = gf.result.winners.includes(hid);
        if (iWon && !conf) errors.push('a1: Gewonnen, aber kein Konfetti');
        await shot(page, 'a1-spielende');
        if (!(await page.locator('[data-act=again]').count())) errors.push('a1: Neues Spiel fehlt');
        // Tabelle auf-/zuklappen
        await page.click('[data-act=table-toggle]');
        const rowsN = await page.locator('.st-table tbody tr').count();
        if (rowsN < 4) errors.push('a1: Tabelle zeigt zu wenige Zeilen ' + rowsN);
        await shot(page, 'a1-tabelle');
        await page.click('[data-act=table-toggle]');
        if (await page.locator('.st-table table').count()) errors.push('a1: Tabelle bleibt offen');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await hostGame(page);
        if (g2.round !== 1 || g2.players.some((p) => p.score)) errors.push('a1: Neues Spiel setzt den Stand nicht zurück');
      }
      if (stats.illegal === 0) errors.push('a1: nie eine unerlaubte Karte getestet');
      await ctx.close();
    }
    // ---------- (a2) Leicht, 4 Personen, Optionen: spielbare Karten anzeigen + Letzter darf nicht ausgleichen + kurz ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'a2', { query: '?rounds=2', checks: ['hints', 'lastNotEqual'] });
      const g0 = await hostGame(page);
      if (!g0.opts.hints || !g0.opts.lastNotEqual) errors.push('a2: Optionen nicht übernommen ' + JSON.stringify(g0.opts));
      const stats = mkStats();
      let sawCan = false;
      await playUntil(page, humanIdOf(g0), stats, { label: 'a2', stop: async (p) => (await p.locator('.trophy').count()) > 0,
        after: async (act, p) => { if (act === 'card' && !sawCan && (await p.locator('.st-hand .can').count())) sawCan = true; }, maxMs: 90000 }).catch((e) => errors.push('a2 ' + e.message));
      // Fehler beim Klick wegen Rundenende abfangen: nach Rundenende weitermachen
      for (let i = 0; i < 3 && !(await page.locator('.trophy').count()); i++) {
        if (await page.locator('[data-act=next]').count()) { await page.click('[data-act=next]'); await page.waitForSelector('#board'); }
        await playUntil(page, humanIdOf(g0), stats, { label: 'a2', stop: async (p) => (await p.locator('.st-over').count()) > 0, maxMs: 90000 });
      }
      console.log('a2: Leicht/4 Personen:', JSON.stringify(stats), 'Spielende', (await page.locator('.trophy').count()) > 0);
      if (!(await page.locator('.trophy').count())) errors.push('a2: Spielende nicht erreicht');
      await ctx.close();
    }
    {
      // Kurzes Spiel: Rundenzahl 10 bei 3 Personen (nur Start prüfen)
      const { ctx, page } = await startBot(browser, 2, 0, 'a3', { checks: ['short'] });
      const g = await hostGame(page);
      if (g.totalRounds !== 10) errors.push('a3: kurzes Spiel mit 3 Personen soll 10 Runden haben, ist ' + g.totalRounds);
      const txt = await page.textContent('.st-round');
      if (!/Runde 1 von 10/.test(txt)) errors.push('a3: Rundenanzeige ' + txt);
      await ctx.close();
      const full = await startBot(browser, 5, 0, 'a3b');
      const g6 = await hostGame(full.page);
      if (g6.players.length !== 6 || g6.totalRounds !== 10) errors.push('a3: 6 Personen: 10 Runden erwartet');
      await full.ctx.close();
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
      let steps = 0; let idle = 0; let finished = false; const shotted = new Set();
      while (steps < 600) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 230) errors.push(`lern: Textlänge ${text.length}`);
        texts.add(text);
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (!shotted.has(act)) { shotted.add(act); await shot(page, 'lern-' + act); }
        if (act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        steps++;
      }
      console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      const gl = await hostGame(page);
      if (!gl.opts.hints) errors.push('lern: hints nicht aktiv');
      if (gl.players.length !== 3 || gl.totalRounds !== 4) errors.push('lern: 3 Personen und 4 Runden erwartet');
      if ([...texts].some((t) => /beste|empfehl|am besten/i.test(t))) errors.push('lern: Empfehlung im Text');
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage(browser, 'lern2');
      await page.goto(BASE);
      await page.fill('#name', 'Erna');
      await page.click('[data-act=learn]');
      await page.waitForSelector('.coach-target');
      await page.click('[data-act=bid]');
      await page.reload();
      await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern2: nach Neuladen keine Lernrunde'));
      await page.click('[data-act=learn-stop]');
      await page.waitForTimeout(200);
      if (await page.locator('.coach').count()) errors.push('lern2: Anleitung bleibt');
      await ctx.close();
    }

    // ---------- (c) Host + 2 Gäste (Test-Netz): 3 Personen, 2 Runden ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        const si = window.setInterval;
        window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      });
      const A = await ctx.newPage(); watch(A, 'A');
      await A.goto(BASE + '?mock=1&rounds=2');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      for (const o of ['hints', 'lastNotEqual', 'short']) if (!(await A.locator(`[data-opt=${o}]`).count())) errors.push('Option fehlt in der Lobby: ' + o);
      await A.check('[data-opt=hints]');
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      await B.waitForSelector('.players');
      await A.waitForTimeout(300);
      if (await A.locator('[data-act=start]').count()) errors.push('netz: Start mit nur 2 Personen möglich');
      const Cc = await ctx.newPage(); watch(Cc, 'C');
      await Cc.goto(BASE + '?mock=1&raum=' + code);
      await Cc.fill('#name', 'Carla');
      await Cc.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      for (const P of [A, B, Cc]) await P.waitForSelector('#board');
      // vierte Person wird abgewiesen? (bis 6 erlaubt, aber das Spiel läuft schon)
      const Dp = await ctx.newPage(); Dp.on('dialog', (d) => d.accept());
      await Dp.goto(BASE + '?mock=1&raum=' + code);
      await Dp.fill('#name', 'Dora');
      await Dp.click('[data-act=join-invited]');
      await Dp.waitForSelector('.notice', { timeout: 6000 }).catch(() => errors.push('netz: Gast nach Spielstart nicht abgewiesen'));
      await Dp.close();

      const g0 = await hostGame(A);
      const idOf = { A: g0.hostId };
      const rest = g0.players.filter((p) => p.id !== g0.hostId).map((p) => p.id);
      idOf.B = rest[0]; idOf.C = rest[1];
      const pageOf = (pid) => (pid === idOf.A ? A : pid === idOf.B ? B : Cc);
      const stats = mkStats();
      let acts = 0; let checks = 0; let sh = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        if ((await A.locator('.trophy').count()) && (await B.locator('.trophy').count()) && (await Cc.locator('.trophy').count())) break;
        if ((await A.locator('[data-act=next]').count())) {
          await A.click('[data-act=next]');
          for (const P of [A, B, Cc]) await P.waitForSelector('#board');
          continue;
        }
        const g = await hostGame(A);
        if (!g || (g.phase !== 'trump' && g.phase !== 'bid' && g.phase !== 'play')) { await A.waitForTimeout(30); continue; }
        // Ansichten: gleiche Daten bei allen (kurze Verzögerung zulassen)
        const view = (P) => P.evaluate(() => ({
          bids: [...document.querySelectorAll('.st-chip .val')].map((e) => e.textContent.trim()),
          trump: (document.querySelector('.st-trump') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
          table: [...document.querySelectorAll('.st-center [data-c]')].map((e) => Number(e.getAttribute('data-c'))).sort((a, b) => a - b),
          round: (document.querySelector('.st-round b') || { textContent: '' }).textContent.trim(),
        }));
        let [va, vb, vc] = [await view(A), await view(B), await view(Cc)];
        if (JSON.stringify(va) !== JSON.stringify(vb) || JSON.stringify(va) !== JSON.stringify(vc)) {
          await A.waitForTimeout(80);
          [va, vb, vc] = [await view(A), await view(B), await view(Cc)];
          if (JSON.stringify(va) !== JSON.stringify(vb) || JSON.stringify(va) !== JSON.stringify(vc)) { errors.push('netz: Ansichten verschieden ' + JSON.stringify([va, vb, vc])); break; }
        }
        checks++;
        const gg = await hostGame(A);
        for (const [P, pid] of [[A, idOf.A], [B, idOf.B], [Cc, idOf.C]]) {
          await assertNoHidden(P, gg, pid, 'netz ' + pid);
          // eigene Hand vollständig und nur eigene
          const mine = await P.evaluate(() => [...document.querySelectorAll('.st-hand [data-c]')].map((e) => Number(e.getAttribute('data-c'))).sort((a, b) => a - b));
          const exp = gg.players.find((p) => p.id === pid).hand.slice().sort((a, b) => a - b);
          if (JSON.stringify(mine) !== JSON.stringify(exp)) { await P.waitForTimeout(80); }
        }
        if (g.phase === 'play' && !sh && g.round === 2) { sh = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); await shot(Cc, 'netz-C'); }
        const pid = g.players[g.turn].id;
        const P = pageOf(pid);
        if (g.phase === 'play' && (await P.locator('.st-hand .can').count()) === 0 && M.legalCards(g, pid).length) {
          await P.waitForTimeout(60);
          if ((await P.locator('.st-hand .can').count()) === 0) errors.push('netz: Option „Spielbare Karten anzeigen“ markiert nichts');
        }
        const r = await stepFor(P, g, pid, stats, false);
        if (r) acts++;
        await A.waitForTimeout(25);
      }
      const fin = await hostGame(A);
      console.log('Netz: Aktionen', acts, JSON.stringify(stats), 'identische Ansichten geprüft', checks, 'Phase', fin && fin.phase);
      if (!(await A.locator('.trophy').count()) || !(await B.locator('.trophy').count()) || !(await Cc.locator('.trophy').count())) errors.push('netz: Spielende nicht erreicht');
      else {
        console.log('Netz Sieger:', (await A.textContent('.st-over h1')).trim(), '|', (await B.textContent('.st-over h1')).trim(), '|', (await Cc.textContent('.st-over h1')).trim());
        await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
        if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf');
        if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
        if (!(await A.locator('[data-act=again]').count())) errors.push('Host sieht Neues-Spiel-Knopf nicht');
        await A.click('[data-act=again]');
        for (const P of [A, B, Cc]) await P.waitForSelector('#board');
        const gN = await hostGame(A);
        if (gN.round !== 1 || gN.players.some((p) => p.score)) errors.push('netz: Neues Spiel ohne Reset');
        await A.click('[data-act=help]');
        await A.waitForSelector('.modal');
        const helpTxt = await A.textContent('.modal');
        if (!/Farbzwang/.test(helpTxt) || !/Zauberer/.test(helpTxt) || !/Narren/.test(helpTxt)) errors.push('Hilfe unvollständig');
        await shot(A, 'hilfe');
      }
      await ctx.close();
    }

    // ---------- (d) Layout: Handy 390 px bei 3 und 6 Personen, viele Karten, Desktop, große Schrift ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'd1', { query: '?startRound=20&rounds=20', vp: { w: 390, h: 844 } });
      await page.waitForTimeout(300);
      const g = await hostGame(page);
      if (g.round !== 20 || g.players[0].hand.length !== 20) errors.push('d1: Runde 20 mit 20 Karten erwartet');
      if (g.upcard !== null || g.trump !== 'none') errors.push('d1: letzte Runde ohne Trumpf/Aufdeckkarte erwartet');
      const sub = await page.textContent('.st-trump');
      if (!/Kein Trumpf/.test(sub)) errors.push('d1: Anzeige „Kein Trumpf“ fehlt: ' + sub);
      // warten, bis ich zum Ansagen dran bin
      await page.waitForSelector('[data-act=bid]', { timeout: 20000 }).catch(() => errors.push('d1: Ansage-Knöpfe nicht erschienen'));
      await layoutCheck(page, 'd1 Ansage Runde 20');
      await shot(page, 'd1-ansage-20');
      const nb = await page.locator('[data-act=bid]').count();
      if (nb !== 21) errors.push('d1: 21 Ansage-Knöpfe erwartet, sind ' + nb);
      await page.click('[data-act=bid][data-n="5"]');
      const stats = mkStats();
      // ein paar Züge spielen und Layout/Position prüfen
      let n = 0;
      await playUntil(page, humanIdOf(g), stats, { label: 'd1', checkLayout: true, stop: async () => (n++ > 60) || stats.card >= 3, maxMs: 40000 });
      await layoutCheck(page, 'd1 Spiel Runde 20');
      await shot(page, 'd1-spiel-20');
      await page.click('[data-act=bigger]');
      await page.waitForTimeout(200);
      await layoutCheck(page, 'd1 große Schrift');
      await shot(page, 'd1-gross');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 5, 1, 'd2', { query: '?startRound=10&rounds=10', vp: { w: 390, h: 844 } });
      const g0 = await hostGame(page);
      const stats = mkStats();
      let shotDone = false;
      await playUntil(page, humanIdOf(g0), stats, { label: 'd2', checkLayout: true, tryIllegal: true,
        stop: async () => stats.card >= 4,
        after: async (act, p) => { if (act === 'card' && !shotDone) { shotDone = true; await p.waitForTimeout(250); await shot(p, 'd2-sechs-personen'); } }, maxMs: 60000 });
      await layoutCheck(page, 'd2 6 Personen');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'd3', { vp: { w: 320, h: 640 }, query: '?startRound=5&rounds=6' });
      await page.waitForTimeout(600);
      await layoutCheck(page, 'd3 320px');
      await shot(page, 'd3-320');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'pc', { vp: { w: 1280, h: 900 }, query: '?startRound=8&rounds=8' });
      await page.waitForTimeout(800);
      await shot(page, 'pc-spiel');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
    try { const pids = execSync(`lsof -t -i:${PORT} || true`).toString().trim().split(/\s+/).filter(Boolean); pids.forEach((p) => { try { process.kill(Number(p)); } catch (e) { /* weg */ } }); } catch (e) { /* kein lsof */ }
  }
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('STICHPROPHET E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
