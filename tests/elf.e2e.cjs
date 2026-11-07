// Browser-Test Elf voran: NODE_PATH=$(npm root -g) node tests/elf.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8911.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8911;
const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/elf';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/elf/index.html`;
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
  watch(page, label);
  return { ctx, page };
}
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console ${m.text()}`); });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
const boardPos = (page) => page.evaluate(() => { const b = document.getElementById('board'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });
const has = async (page, sel) => (await page.locator(sel).count()) > 0;
const pageScrollOk = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
const hostGame = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('zh.ev.hostState') || localStorage.getItem('zh.ev.hostState')).game);

const shotDone = new Set();
async function snapOnce(page, name) { if (shotDone.has(name)) return; shotDone.add(name); await shot(page, 'zustand-' + name); }

// Ein Schritt des Menschen: passen oder eine hervorgehobene Karte legen
async function humanStep(page, st) {
  if (!(await has(page, '.banner.mine'))) return null;
  try {
    if (await has(page, '[data-act=pass]')) { await snapOnce(page, 'passen'); await page.click('[data-act=pass]', { timeout: 1500 }); st.pass++; return 'pass'; }
    const cards = page.locator('.ev-hand button.can');
    const n = await cards.count();
    if (n) { await cards.nth(Math.floor(Math.random() * n)).click({ timeout: 1500 }); st.card++; return 'card'; }
  } catch { /* Seite wurde gerade neu gezeichnet */ }
  return null;
}

// Spielt, bis das Spiel zu Ende ist (Runde für Runde). Prüft Seite ohne Quer-Scroll und konstante Tischposition.
async function playGame(page, label, { maxMs = 180000, pos0 = null, checkScroll = true } = {}) {
  const st = { card: 0, pass: 0 };
  const t0 = Date.now();
  let rounds = 0; let pos = pos0; let acts = 0; let reloaded = false;
  while (Date.now() - t0 < maxMs) {
    if (await has(page, '.ev-over')) {
      if (await has(page, '[data-act=next]')) {
        rounds++;
        if (rounds === 1) await shot(page, label + '-rundenende');
        await page.click('[data-act=next]');
        await page.waitForSelector('#board');
        continue;
      }
      if (await has(page, '[data-act=again]')) { rounds++; return { st, rounds, acts, over: true, pos }; }
    }
    const bp = await boardPos(page);
    if (bp) {
      if (pos && (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1)) { errors.push(`${label}: Tisch springt ${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
      if (!pos) pos = bp;
      if (checkScroll && !(await pageScrollOk(page))) errors.push(`${label}: Seite scrollt waagerecht`);
    }
    if (!reloaded && acts >= 10 && (await has(page, '.banner:not(.mine)'))) { // Neuladen mitten im Spiel
      reloaded = true;
      await page.reload();
      await page.waitForSelector('.banner', { timeout: 8000 });
      console.log(label, 'Neuladen ok');
      continue;
    }
    if (await humanStep(page, st)) { acts++; await page.waitForTimeout(10); } else await page.waitForTimeout(20);
  }
  return { st, rounds, acts, over: false, pos };
}

async function startBot(browser, n, level, label, { hints = true, query = '', vp } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE + query);
  await page.fill('#name', 'Anna');
  if (hints) await page.check('[data-opt=hints]');
  await shot(page, `${label}-start`);
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

function freePort() {
  try { const pids = execSync(`lsof -t -i:${PORT} || true`).toString().split(/\s+/).filter(Boolean); for (const p of pids) process.kill(Number(p)); } catch { /* nichts zu tun */ }
}

(async () => {
  freePort();
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    // ---------- (a) Gegen 2 Computer (Mittel): ganze Runde, weiter bis Spielende ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'a', { query: '?limit=25' });
      const g0 = await hostGame(page);
      if (g0.opts.limit !== 25 || !g0.opts.hints || g0.players.length !== 3) errors.push('a: Optionen/Spieler falsch ' + JSON.stringify(g0.opts));
      // Aufbau des Tisches: 4 Reihen mit je 21 Feldern, Band wischt in sich
      const rows = await page.$$eval('.ev-row', (r) => r.map((x) => x.querySelectorAll('.ev-t').length));
      if (rows.length !== 4 || rows.some((n) => n !== 21)) errors.push('a: Reihen ' + JSON.stringify(rows));
      const sc = await page.$eval('.ev-scroll', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
      if (!(sc.sw > sc.cw)) errors.push('a: Band scrollt nicht in sich ' + JSON.stringify(sc));
      if (!(await pageScrollOk(page))) errors.push('a: Seite scrollt waagerecht (Start)');
      await shot(page, 'a-spiel-start');
      // Wischposition bleibt erhalten
      await page.$eval('.ev-scroll', (e) => { e.scrollLeft = 120; });
      await page.waitForTimeout(100);
      const r = await playGame(page, 'a', { maxMs: 240000 });
      console.log('a: Runden', r.rounds, 'Aktionen', r.acts, JSON.stringify(r.st), 'Spielende', r.over);
      if (!r.over) errors.push('a: Spiel nicht beendet');
      if (r.rounds < 2) errors.push('a: nur eine Runde gespielt');
      else {
        await shot(page, 'a-spielende');
        const h = await page.textContent('.ev-over h1');
        console.log('a: Ergebnis:', h.trim());
        const g = await hostGame(page);
        if (!g.result.gameOver || !g.players.some((p) => p.points >= 25)) errors.push('a: Spielende ohne Limit');
        if (await has(page, '[data-act=next]')) errors.push('a: Nächste Runde nach Spielende');
        const tab = await page.$$eval('.ev-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
        console.log('a: Tabelle:', tab.join(' | '));
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await hostGame(page);
        if (g2.round !== 1 || g2.players.some((p) => p.points)) errors.push('a: Neues Spiel setzt Stand nicht zurück');
      }
      await ctx.close();
    }
    // Wischposition nach Neuzeichnen
    {
      const { ctx, page } = await startBot(browser, 1, 1, 'scroll', {});
      await page.$eval('.ev-scroll', (e) => { e.scrollLeft = 150; });
      await page.waitForTimeout(100);
      const st = { card: 0, pass: 0 };
      for (let i = 0; i < 100 && st.card + st.pass < 3; i++) { if (!(await humanStep(page, st))) await page.waitForTimeout(40); }
      await page.waitForTimeout(300);
      const sl = await page.$eval('.ev-scroll', (e) => Math.round(e.scrollLeft));
      if (Math.abs(sl - 150) > 2) errors.push('scroll: Wischposition ging verloren ' + sl);
      else console.log('Wischposition bleibt:', sl);
      await ctx.close();
    }
    // ---------- Ohne Hilfe, Kurzspiel, falsche Karte ----------
    {
      const { ctx, page } = await newPage(browser, 'ohne');
      await page.goto(BASE);
      await page.fill('#name', 'Anna');
      if (await page.isChecked('[data-opt=hints]')) errors.push('ohne: Hilfe ist standardmäßig an');
      await page.check('[data-opt=short]');
      await page.click('[data-act=bot][data-n="1"][data-level="0"]');
      await page.waitForSelector('#board');
      const g = await hostGame(page);
      if (g.opts.hints || g.opts.limit !== 15) errors.push('ohne: Optionen ' + JSON.stringify(g.opts));
      let wrong = false;
      for (let i = 0; i < 400 && !wrong; i++) {
        if (await has(page, '.ev-card.can, .ev-card.dim')) { errors.push('ohne: Karten markiert, obwohl Hilfe aus'); break; }
        if (await has(page, '.banner.mine')) {
          const gg = await hostGame(page);
          const me = gg.players.find((p) => p.id === gg.players[gg.active].id);
          const bad = me.hand.find((c) => { const w = gg.rows[c.s]; return w ? !(c.r === w.hi + 1 || c.r === w.lo - 1) : c.r !== 11; });
          const anyLegal = me.hand.some((c) => { const w = gg.rows[c.s]; return w ? (c.r === w.hi + 1 || c.r === w.lo - 1) : c.r === 11; });
          if (bad && anyLegal) {
            await page.click(`.ev-card[data-s="${bad.s}"][data-r="${bad.r}"]`);
            await page.waitForSelector('.ev-note');
            await shot(page, 'ohne-falsche-karte');
            wrong = true;
            break;
          }
          await humanStep(page, { card: 0, pass: 0 }).catch(() => {});
          const first = me.hand.find((c) => { const w = gg.rows[c.s]; return w ? (c.r === w.hi + 1 || c.r === w.lo - 1) : c.r === 11; });
          if (first && await has(page, `.ev-card[data-s="${first.s}"][data-r="${first.r}"]`)) await page.click(`.ev-card[data-s="${first.s}"][data-r="${first.r}"]`).catch(() => {});
        }
        await page.waitForTimeout(30);
      }
      if (!wrong) errors.push('ohne: keine falsche Karte getestet');
      else console.log('Falsche Karte: Hinweis erscheint');
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
      let steps = 0; let idle = 0; let finished = false;
      while (steps < 1500) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 230) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern-mitte'); }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        if (act === 'next' && !texts.has('__n')) { texts.add('__n'); await shot(page, 'lern-rundenende'); }
        try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        steps++;
        if (!(await pageScrollOk(page))) errors.push('lern: Seite scrollt waagerecht');
      }
      console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) if (t !== '__n') console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      const gl = await hostGame(page);
      if (gl.opts.hints) console.log('(Lernrunde: Hilfe über Lernmodus, nicht über Option)');
      // Hilfe automatisch an: leuchtende Karten waren zu sehen (coach-target ist .can)
      await ctx.close();
    }
    // ---------- (c) Host + Gast über Mock-Netz ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        const si = window.setInterval;
        window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      });
      const A = await ctx.newPage(); watch(A, 'A');
      await A.goto(BASE + '?mock=1&limit=10');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      if (!(await A.locator('[data-opt=hints]').count()) || !(await A.locator('[data-opt=short]').count())) errors.push('Optionen fehlen in der Lobby');
      await A.check('[data-opt=hints]');
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      const stA = { card: 0, pass: 0 }; const stB = { card: 0, pass: 0 };
      let posA = null; let posB = null; let acts = 0; let compared = 0; let rounds = 0; let leaks = 0;
      const t0 = Date.now();
      const sameView = async () => {
        const [ta, tb] = await Promise.all([A.$eval('#board', (e) => e.innerText), B.$eval('#board', (e) => e.innerText)]);
        const [pa, pb] = await Promise.all([A.$eval('.ev-players', (e) => e.innerText.replace(/\s*\(du\)/g, '')), B.$eval('.ev-players', (e) => e.innerText.replace(/\s*\(du\)/g, ''))]);
        if (ta !== tb || pa !== pb) return false;
        return true;
      };
      const leakCheck = async () => {
        // Gast darf nur eigene Karten als Karten im DOM haben (und Gastgeber nur seine)
        const g = await hostGame(A);
        for (const [P, id] of [[A, g.players[0].id], [B, g.players[1].id]]) {
          const mine = g.players.find((p) => p.id === id).hand.map((c) => `${c.s}-${c.r}`).sort();
          const shown = await P.$$eval('.ev-card', (e) => e.map((x) => { const b = x.getAttribute('data-s'); return b; }));
          const cnt = await P.$$eval('.ev-card', (e) => e.length);
          if (cnt !== mine.length) { leaks++; errors.push(`netz: ${id} sieht ${cnt} Karten statt ${mine.length}`); }
          void shown;
        }
        // Namen der Karten des anderen dürfen nicht als aria-label einer Karte beim Gast stehen
        const other = g.players[0].hand.map((c) => c);
        const mineB = new Set(g.players[1].hand.map((c) => `${c.s}-${c.r}`));
        const labelsB = await B.$$eval('.ev-card', (e) => e.map((x) => x.getAttribute('aria-label')));
        const NAMES = ['Rot', 'Blau', 'Gelb', 'Grün'];
        const mineLabels = new Set(g.players[1].hand.map((c) => `${NAMES[c.s]} ${c.r}`));
        for (const l of labelsB) if (!mineLabels.has(l.split(',')[0])) { leaks++; errors.push('netz: Gast zeigt fremde Karte ' + l); }
        void other; void mineB;
      };
      while (Date.now() - t0 < 240000) {
        if ((await has(A, '.ev-over')) && (await has(B, '.ev-over'))) {
          rounds++;
          if (rounds === 1) { await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast'); }
          if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf');
          if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
          if (await has(A, '[data-act=next]')) { await A.click('[data-act=next]'); await A.waitForSelector('#board'); await B.waitForSelector('#board'); continue; }
          break;
        }
        for (const [P, st, nm] of [[A, stA, 'A'], [B, stB, 'B']]) {
          const bp = await boardPos(P);
          if (bp) {
            const ref = nm === 'A' ? posA : posB;
            if (ref && (Math.abs(bp.top - ref.top) > 1 || Math.abs(bp.h - ref.h) > 1)) errors.push(`netz ${nm}: Tisch springt`);
            if (!ref) { if (nm === 'A') posA = bp; else posB = bp; }
            if (!(await pageScrollOk(P))) errors.push(`netz ${nm}: Seite scrollt waagerecht`);
          }
          if (await humanStep(P, st)) acts++;
        }
        if (acts % 7 === 0 && (await has(A, '#board')) && (await has(B, '#board'))) {
          await A.waitForTimeout(80);
          if (await sameView()) { compared++; await leakCheck(); } else { await A.waitForTimeout(150); if (await sameView()) { compared++; await leakCheck(); } else errors.push('netz: Ansichten von Host und Gast unterschiedlich'); }
          if (compared === 3) { await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        }
        await A.waitForTimeout(25);
      }
      console.log('Netz: Aktionen', acts, 'A', JSON.stringify(stA), 'B', JSON.stringify(stB), 'Vergleiche', compared, 'Runden', rounds, 'Lecks', leaks);
      if (!(await has(A, '.ev-over')) || !(await has(A, '[data-act=again]'))) errors.push('netz: Spielende nicht erreicht');
      const gA = await hostGame(A);
      if (!gA.result || !gA.result.gameOver) errors.push('netz: kein Spielende');
      if (compared < 3) errors.push('netz: zu wenige Vergleiche ' + compared);
      console.log('Netz Ergebnis:', (await A.textContent('.ev-over h1')).trim(), '|', (await B.textContent('.ev-over h1')).trim());
      // Hilfe öffnen
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      await shot(A, 'hilfe');
      await ctx.close();
    }
    // ---------- (d) Layout 390x844 und Knopfgrößen ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'd', {});
      const sizes = async (sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: (e.innerText || '').trim().slice(0, 20) }; }));
      let checked = 0; let passChecked = false; let cardChecked = false;
      const st = { card: 0, pass: 0 };
      const t0 = Date.now();
      while (Date.now() - t0 < 120000 && !(passChecked && cardChecked && checked > 6)) {
        if (await has(page, '.banner.mine')) {
          if (!cardChecked && (await has(page, '.ev-card.can'))) { cardChecked = true; for (const s of await sizes('.ev-card')) if (s.w < 48 || s.h < 48) errors.push('d: Karte zu klein ' + JSON.stringify(s)); await shot(page, 'd-meine-karten'); }
          if (!passChecked && (await has(page, '[data-act=pass]'))) { passChecked = true; for (const s of await sizes('.ev-action .btn')) if (s.h < 48) errors.push('d: Passen-Knopf zu klein ' + JSON.stringify(s)); await shot(page, 'd-passen'); }
          await humanStep(page, st);
        }
        if (!(await pageScrollOk(page))) errors.push('d: Seite scrollt waagerecht');
        checked++;
        await page.waitForTimeout(30);
      }
      console.log('d: Prüfungen', checked, 'Karten geprüft', cardChecked, 'Passen geprüft', passChecked);
      if (!cardChecked) errors.push('d: Karten nicht geprüft');
      await ctx.close();
      // Startseite und Lobby: Knöpfe
      const s = await newPage(browser, 'd2');
      await s.page.goto(BASE);
      for (const sz of await s.page.$$eval('.btn:not(.mini)', (els) => els.filter((e) => e.offsetParent !== null).map((e) => ({ h: Math.round(e.getBoundingClientRect().height), t: e.innerText.trim().slice(0, 25) })))) if (sz.h < 48) errors.push('d: Startseite Knopf zu klein ' + JSON.stringify(sz));
      if (!(await pageScrollOk(s.page))) errors.push('d: Startseite scrollt waagerecht');
      await s.ctx.close();
    }
    // ---------- Desktop ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'pc', { vp: { w: 1280, h: 900 } });
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
  console.log('ELF E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); try { freePort(); } catch { /* egal */ } process.exit(1); });
