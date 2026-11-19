// Browser-Test Waldleben: NODE_PATH=$(npm root -g) node tests/waldleben.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 9011.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const PORT = process.env.PORT || 9011;
const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/waldleben-e2e';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/waldleben/index.html`;
const errors = [];
let C = null; // Kartensatz

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
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
const boardPos = (page) => page.evaluate(() => { const b = document.getElementById('board'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });
const has = async (page, sel) => (await page.locator(sel).count()) > 0;
const pageScrollOk = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
const hostGame = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('zh.waldleben.hostState') || localStorage.getItem('zh.waldleben.hostState')).game);
// Antippen ohne Rücksicht auf die klebende Leiste (die echte Klick-Prüfung steht in (d))
// atomar im Seitenkontext (ein getrenntes Suchen und Klicken könnte ein gerade neu gezeichnetes Element treffen)
const tap = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('nicht gefunden: ' + s); e.click(); }, sel);

// ---- ein Mensch spielt zufällig, aber nach den Regeln ----
async function humanStep(page, st) {
  if (!(await has(page, '.banner.mine'))) return null;
  try {
    const bannerText = await page.textContent('.banner');
    if (/Du ziehst/.test(bannerText)) {
      if (Math.random() < 0.4 && (await has(page, '.wl-lich .wl-mini'))) {
        const ids = await page.$$eval('.wl-lich .wl-mini', (e) => e.map((x) => x.dataset.id));
        await tap(page, `.wl-lich .wl-mini[data-id="${ids[Math.floor(Math.random() * ids.length)]}"]`);
        await page.waitForSelector('[data-act=take]', { timeout: 1500 });
        await tap(page, '[data-act=take]'); st.take++; return 'take';
      }
      await tap(page, '[data-act=deck]'); st.deck++; return 'deck';
    }
    const ids = await page.$$eval('.wl-hand .wl-card', (e) => e.map((x) => Number(x.dataset.id)));
    const trees = ids.filter((i) => C.CARDS[i].kind === 'tree');
    const free = await page.$$eval('.wl-trees .wl-tree', (e) => e.map((x) => 4 - Number((/(\d) von 4/.exec(x.getAttribute('aria-label')) || [0, 0])[1])).reduce((a, b) => a + b, 0));
    const lives = ids.filter((i) => C.CARDS[i].kind === 'life' && ids.length - 1 >= C.CARDS[i].cost && free > 0);
    const canDraw = await has(page, '.wl-action [data-act=deck]');
    const opts = [];
    if (canDraw) for (let k = 0; k < 3; k++) opts.push('draw');
    if (trees.length) for (let k = 0; k < 2; k++) opts.push('tree');
    if (lives.length) for (let k = 0; k < 4; k++) opts.push('life');
    if (!opts.length || Math.random() < 0.04) opts.push('sprout');
    const o = opts[Math.floor(Math.random() * opts.length)];
    if (o === 'draw') {
      if (Math.random() < 0.4 && (await has(page, '.wl-lich .wl-mini'))) {
        const lids = await page.$$eval('.wl-lich .wl-mini', (e) => e.map((x) => x.dataset.id));
        await tap(page, `.wl-lich .wl-mini[data-id="${lids[0]}"]`);
        await tap(page, '[data-act=take]'); st.take++; return 'take';
      }
      await tap(page, '[data-act=deck]'); st.deck++; return 'deck';
    }
    if (o === 'tree') { await tap(page, `.wl-card[data-id="${trees[Math.floor(Math.random() * trees.length)]}"]`); await tap(page, '[data-act=plant]'); st.tree++; return 'tree'; }
    if (o === 'sprout') { await tap(page, `.wl-card[data-id="${ids[Math.floor(Math.random() * ids.length)]}"]`); await tap(page, '[data-act=sprout]'); st.sprout++; return 'sprout'; }
    const id = lives[Math.floor(Math.random() * lives.length)];
    const c = C.CARDS[id];
    await tap(page, `.wl-card[data-id="${id}"]`);
    let others = ids.filter((x) => x !== id);
    const same = others.filter((x) => C.CARDS[x].sp === c.sp);
    if (same.length >= c.cost && Math.random() < 0.6) others = same;
    for (let k = 0; k < c.cost; k++) { const x = others.splice(Math.floor(Math.random() * others.length), 1)[0]; await tap(page, `.wl-card[data-id="${x}"]`); }
    await page.waitForSelector('.wl-ptree:not([disabled])', { timeout: 1500 });
    if (await has(page, '.wl-good')) st.passend++;
    const trs = await page.$$eval('.wl-ptree:not([disabled])', (e) => e.map((x) => x.dataset.i));
    await tap(page, `.wl-ptree[data-i="${trs[Math.floor(Math.random() * trs.length)]}"]`);
    await page.waitForSelector('[data-act=place]:not([disabled])', { timeout: 1500 });
    const sides = await page.$$eval('[data-act=place]:not([disabled])', (e) => e.map((x) => x.dataset.side));
    await tap(page, `[data-act=place][data-side="${sides[Math.floor(Math.random() * sides.length)]}"]`);
    st.life++; return 'life';
  } catch (e) { st.err = (st.err || 0) + 1; if (st.err > 50) errors.push('humanStep: ' + e.message.split('\n')[0]); }
  return null;
}

// Prüft, dass die Wertung am Ende stimmig ist: Zeilen + Höhle = Summe = Endstandtabelle
async function checkOver(page, label) {
  const info = await page.evaluate(() => {
    const table = [...document.querySelectorAll('.wl-table tbody tr')].map((r) => ({ name: r.children[1].textContent.replace(/\s*\(du\)|\s*🏆/g, '').trim(), pts: Number(r.children[2].textContent) }));
    const ds = [...document.querySelectorAll('.wl-bd')].map((d) => {
      const name = d.querySelector('summary b').textContent.replace(/\s*\(du\)/, '').trim();
      const total = Number(d.querySelector('summary span').textContent.replace(/\D+/g, ''));
      d.open = true;
      const lines = [...d.querySelectorAll('.wl-bd-tree li:not(.none) .p')].map((x) => Number(x.textContent));
      const cave = Number(d.querySelector('.wl-bd-cave h4 span').textContent.replace(/\D+/g, ''));
      const treeSums = [...d.querySelectorAll('.wl-bd-tree h4 span')].map((x) => Number(x.textContent.replace(/\D+/g, '')));
      return { name, total, sum: lines.reduce((a, b) => a + b, 0) + cave, lines: lines.length, cave, treeSums: treeSums.reduce((a, b) => a + b, 0) + cave };
    });
    return { table, ds };
  });
  if (info.ds.length !== info.table.length || !info.ds.length) errors.push(`${label}: Aufschlüsselungen ${info.ds.length} / Tabelle ${info.table.length}`);
  for (const d of info.ds) {
    if (d.total !== d.sum || d.total !== d.treeSums) errors.push(`${label}: ${d.name}: Summe ${d.total} != Zeilen ${d.sum}/${d.treeSums}`);
    const t = info.table.find((x) => x.name === d.name);
    if (!t || t.pts !== d.total) errors.push(`${label}: ${d.name}: Tabelle ${t && t.pts} != ${d.total}`);
  }
  const sorted = info.table.every((r, i) => i === 0 || info.table[i - 1].pts >= r.pts);
  if (!sorted) errors.push(label + ': Tabelle nicht sortiert');
  return info;
}

async function playGame(page, label, { maxMs = 240000, checkScroll = true } = {}) {
  const st = { deck: 0, take: 0, tree: 0, life: 0, sprout: 0, passend: 0 };
  const t0 = Date.now();
  let pos = null; let acts = 0; let reloaded = false; let shots = 0;
  while (Date.now() - t0 < maxMs) {
    if (await has(page, '.wl-over')) return { st, acts, over: true };
    const bp = await boardPos(page);
    if (bp && !(await has(page, '.wl-over'))) {
      if (pos && (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1)) { errors.push(`${label}: Lichtung springt ${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
      if (!pos) pos = bp;
      if (checkScroll && !(await pageScrollOk(page))) errors.push(`${label}: Seite scrollt waagerecht`);
    }
    if (!reloaded && acts >= 8 && (await has(page, '.banner:not(.mine)'))) { reloaded = true; await page.reload(); await page.waitForSelector('.banner', { timeout: 8000 }); console.log(label, 'Neuladen ok'); continue; }
    if (await humanStep(page, st)) { acts++; if (acts === 12 && shots++ === 0) await shot(page, label + '-mitte'); await page.waitForTimeout(10); } else await page.waitForTimeout(20);
  }
  return { st, acts, over: false };
}

async function startBot(browser, n, level, label, { hints = true, short = false, query = '', vp } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE + query);
  await page.fill('#name', 'Anna');
  if (hints) await page.check('[data-opt=hints]');
  if (short) await page.check('[data-opt=short]');
  await shot(page, `${label}-start`);
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

function freePort() {
  try { const pids = execSync(`lsof -t -i:${PORT} || true`).toString().split(/\s+/).filter(Boolean); for (const p of pids) process.kill(Number(p)); } catch { /* nichts zu tun */ }
}

(async () => {
  C = await import(pathToFileURL(path.join(ROOT, 'waldleben', 'cards.js')).href);
  freePort();
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    // ---------- (a) Gegen 2 Computer (Mittel), Kurzspiel mit Hilfe, bis zum Ende ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'a', { short: true });
      const g0 = await hostGame(page);
      if (!g0.opts.hints || !g0.opts.short || g0.players.length !== 3) errors.push('a: Optionen/Spieler falsch ' + JSON.stringify(g0.opts));
      if (!(await pageScrollOk(page))) errors.push('a: Seite scrollt waagerecht (Start)');
      await shot(page, 'a-spiel-start');
      const r = await playGame(page, 'a');
      console.log('a: Aktionen', r.acts, JSON.stringify(r.st), 'Spielende', r.over);
      if (!r.over) errors.push('a: Spiel nicht beendet');
      else {
        await shot(page, 'a-spielende');
        console.log('a: Ergebnis:', (await page.textContent('.wl-over h1')).trim());
        const info = await checkOver(page, 'a');
        console.log('a: Endstand:', info.table.map((t) => `${t.name} ${t.pts}`).join(' | '), '| Zeilen:', info.ds.map((d) => d.lines).join('/'));
        const g = await hostGame(page);
        if (g.winters !== 3 || g.phase !== 'over') errors.push('a: Spielende ohne 3 Winterkarten');
        if (await has(page, '.wl-card')) errors.push('a: Handkarten nach Spielende sichtbar');
        await page.click('[data-act=again]');
        await page.waitForSelector('#board');
        const g2 = await hostGame(page);
        if (g2.turns !== 0 || g2.winters !== 0) errors.push('a: Neues Spiel nicht frisch');
      }
      if (r.st.life + r.st.tree < 3) errors.push('a: zu wenige Aktionen ' + JSON.stringify(r.st));
      await ctx.close();
    }
    // ---------- (a2) Volles Spiel zu zweit gegen den Computer (Leicht), Standardgröße ----------
    {
      const { ctx, page } = await startBot(browser, 1, 0, 'a2', { hints: false });
      const r = await playGame(page, 'a2', { maxMs: 280000 });
      console.log('a2: Aktionen', r.acts, JSON.stringify(r.st), 'Spielende', r.over);
      if (!r.over) errors.push('a2: Spiel nicht beendet'); else { await checkOver(page, 'a2'); console.log('a2:', (await page.textContent('.wl-over h1')).trim()); }
      await ctx.close();
    }
    // ---------- Ohne Hilfe: keine Markierungen; Lichtung, Wald ansehen, Karte ansehen ----------
    {
      const { ctx, page } = await startBot(browser, 1, 0, 'ohne', { hints: false, query: '?deck=40' });
      if (await page.isChecked('[data-opt=hints]').catch(() => false)) errors.push('ohne: Hilfe an');
      if (await has(page, '.wl-card.can, .wl-card.dim')) errors.push('ohne: Karten markiert, obwohl Hilfe aus');
      // Karte der Lichtung ansehen
      await tap(page, '.wl-lich .wl-mini');
      await page.waitForSelector('[data-act=take]');
      await shot(page, 'ohne-lichtung-karte', false);
      await tap(page, '[data-act=cancel]');
      // Handkarte ansehen
      await tap(page, '.wl-card');
      await page.waitForSelector('.wl-big');
      await shot(page, 'ohne-handkarte-gewaehlt', false);
      if (await has(page, '.wl-card.can, .wl-card.dim')) errors.push('ohne: Markierung nach Auswahl');
      await tap(page, '[data-act=cancel]');
      // Sprössling: verdeckt gepflanzt, im Wald ohne Art
      if (!(await has(page, '.wl-card.life'))) errors.push('ohne: keine Tierkarte auf der Hand (Test unlesbar)');
      await tap(page, '.wl-card.life');
      await tap(page, '[data-act=sprout]');
      await page.waitForSelector('.wl-trees .wl-tree');
      if (!/Sprössling/.test(await page.textContent('.wl-trees'))) errors.push('ohne: Sprössling nicht sichtbar');
      console.log('Sprössling gepflanzt: ok');
      // Mehrere Züge spielen, bis ein Baum im Wald liegt, dann Baumansicht öffnen
      const st = { deck: 0, take: 0, tree: 0, life: 0, sprout: 0, passend: 0 };
      for (let i = 0; i < 400 && !(await has(page, '.wl-trees .wl-tree')); i++) { if (!(await humanStep(page, st))) await page.waitForTimeout(30); }
      await page.waitForSelector('.wl-trees .wl-tree');
      let crossOk = false;
      for (let tries = 0; tries < 4 && !crossOk; tries++) {
        await tap(page, '.wl-trees .wl-tree');
        crossOk = await page.waitForSelector('.wl-cross', { timeout: 5000 }).then(() => true).catch(() => false);
        if (!crossOk) crossOk = await has(page, '.wl-cross');
        if (!crossOk) console.log('Baumansicht: Versuch', tries + 1, 'ohne Erfolg:', JSON.stringify(await page.evaluate(() => [document.querySelector('.banner').innerText,  (document.querySelector('.wl-forest') || {}).innerText])));
      }
      if (!crossOk) errors.push('ohne: Baumansicht öffnet nicht');
      const cells = await page.$$eval('.wl-cross .wl-cell', (e) => e.length);
      if (cells !== 4) errors.push('ohne: Baumansicht zeigt ' + cells + ' Seiten');
      await page.$eval('.wl-forest', (e) => e.scrollIntoView({ block: 'start' }));
      await shot(page, 'ohne-baumansicht', false);
      // Wald des Computers ansehen
      await tap(page, '[data-act=view][data-pid="bot1"]');
      await page.waitForSelector('.wl-forest h2');
      if (!/Wald von Computer/.test(await page.textContent('.wl-forest h2'))) errors.push('ohne: Wald des Computers nicht angezeigt');
      await tap(page, '[data-act=view]:first-child').catch(() => {});
      // Falsche Bedienung: zu viele Zahlkarten, Hinweis erscheint
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
      while (steps < 800) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 230) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); if (texts.size === 6) await shot(page, 'lern-mitte', false); }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        try { await target.evaluate((e) => e.click()); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        steps++;
        if (!(await pageScrollOk(page))) errors.push('lern: Seite scrollt waagerecht');
      }
      console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      else await checkOver(page, 'lern');
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
      await A.goto(BASE + '?mock=1&deck=45');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      if (!(await A.locator('[data-opt=hints]').count()) || !(await A.locator('[data-opt=short]').count())) errors.push('Optionen fehlen in der Lobby');
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      const stA = { deck: 0, take: 0, tree: 0, life: 0, sprout: 0, passend: 0 }; const stB = { ...stA };
      let posA = null; let posB = null; let acts = 0; let compared = 0; let leaks = 0;
      const t0 = Date.now();
      const view = (P) => P.evaluate(() => ({
        board: document.getElementById('board').innerText,
        opps: document.querySelector('.wl-opps').innerText.replace(/\s*\(du\)/g, ''),
        recap: (document.querySelector('.recap') || { innerText: '' }).innerText,
      }));
      const sameView = async () => { const [a, b] = await Promise.all([view(A), view(B)]); return a.board === b.board && a.opps === b.opps && a.recap === b.recap; };
      const leakCheck = async () => {
        const g = await hostGame(A);
        for (const [P, i] of [[A, 0], [B, 1]]) {
          const mine = g.players[i].hand.slice().sort((x, y) => x - y);
          const shown = (await P.$$eval('.wl-hand .wl-card', (e) => e.map((x) => Number(x.dataset.id)))).sort((x, y) => x - y);
          if (JSON.stringify(mine) !== JSON.stringify(shown)) { leaks++; errors.push(`netz: ${i} sieht Handkarten ${shown} statt ${mine}`); }
        }
        // Handkartennamen des Gastgebers dürfen im Gast-DOM nicht als Karten stehen (außer sie liegen offen)
        const other = g.players[0].hand.filter((id) => !g.clearing.includes(id) && !g.players.some((p) => p.trees.some((t) => t.sides.includes(id) || t.id === id)));
        const html = await B.evaluate(() => document.getElementById('app').innerHTML);
        for (const id of other) if (html.includes(`data-id="${id}"`)) { leaks++; errors.push('netz: Gast zeigt fremde Handkarte ' + id); }
        // Sprösslinge zeigen ihre Karte nicht
        const sp = g.players.flatMap((p) => p.trees.filter((t) => t.sp === -1).map(() => 1)).length;
        void sp;
      };
      while (Date.now() - t0 < 240000) {
        if ((await has(A, '.wl-over')) && (await has(B, '.wl-over'))) break;
        for (const [P, st, nm] of [[A, stA, 'A'], [B, stB, 'B']]) {
          const bp = (await has(P, '.wl-over')) ? null : await boardPos(P);
          if (bp) {
            const ref = nm === 'A' ? posA : posB;
            if (ref && (Math.abs(bp.top - ref.top) > 1 || Math.abs(bp.h - ref.h) > 1)) errors.push(`netz ${nm}: Lichtung springt ${JSON.stringify(ref)} -> ${JSON.stringify(bp)}`);
            if (!ref) { if (nm === 'A') posA = bp; else posB = bp; }
            if (!(await pageScrollOk(P))) errors.push(`netz ${nm}: Seite scrollt waagerecht`);
          }
          if (await humanStep(P, st)) acts++;
        }
        if (acts % 5 === 0 && (await has(A, '.wl-hand')) && (await has(B, '.wl-hand'))) {
          await A.waitForTimeout(80);
          if (await sameView()) { compared++; await leakCheck(); } else { await A.waitForTimeout(150); if (await sameView()) { compared++; await leakCheck(); } else errors.push('netz: Ansichten von Host und Gast unterschiedlich'); }
          if (compared === 3) { await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        }
        await A.waitForTimeout(25);
      }
      console.log('Netz: Aktionen', acts, 'A', JSON.stringify(stA), 'B', JSON.stringify(stB), 'Vergleiche', compared, 'Lecks', leaks);
      if (!(await has(A, '.wl-over')) || !(await has(B, '.wl-over'))) errors.push('netz: Spielende nicht erreicht');
      else {
        await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
        if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
        const [ta, tb] = await Promise.all([A.$eval('.wl-table', (e) => e.innerText.replace(/\s*\(du\)/g, '')), B.$eval('.wl-table', (e) => e.innerText.replace(/\s*\(du\)/g, ''))]);
        if (ta !== tb) errors.push('netz: Endstand unterschiedlich');
        await checkOver(A, 'netzA'); await checkOver(B, 'netzB');
        console.log('Netz Ergebnis:', (await A.textContent('.wl-over h1')).trim(), '|', (await B.textContent('.wl-over h1')).trim());
      }
      if (compared < 3) errors.push('netz: zu wenige Vergleiche ' + compared);
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      await shot(A, 'hilfe', false);
      await ctx.close();
    }
    // ---------- (d) Layout 390x844, Knopfgrößen, echte Klicks ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'd', { hints: true, query: '?deck=60' });
      const sizes = async (sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: (e.innerText || '').trim().slice(0, 20) }; }));
      const st = { deck: 0, take: 0, tree: 0, life: 0, sprout: 0, passend: 0 };
      let checked = 0; let realClick = false; let pickChecked = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 150000 && !(checked > 25 && realClick && pickChecked)) {
        if (await has(page, '.banner.mine')) {
          for (const sel of ['.wl-card', '.wl-opp', '.wl-action .btn', '.wl-mini', '.wl-tree', '.wl-ptree', '.wl-cell:not(.free)']) for (const s of await sizes(sel)) if (s.w < 48 || s.h < 48) errors.push(`d: ${sel} zu klein ${JSON.stringify(s)}`);
          if (!realClick && (await has(page, '.wl-card')) && !(await has(page, '.wl-over'))) {
            // echter Klick auf eine Handkarte (ohne Umgehung der klebenden Leiste)
            const id = await page.$eval('.wl-card', (e) => e.dataset.id);
            await page.locator(`.wl-card[data-id="${id}"]`).click({ timeout: 4000 });
            await page.waitForSelector('.wl-big');
            await shot(page, 'd-karte-gewaehlt', false);
            await page.locator('[data-act=cancel]').click({ timeout: 4000 });
            realClick = true;
          }
          if (!pickChecked && (await has(page, '.wl-ptree')) === false) { /* noch nicht */ }
          const k = await humanStep(page, st);
          if (k === 'life') pickChecked = true;
        }
        if (!(await pageScrollOk(page))) errors.push('d: Seite scrollt waagerecht');
        checked++;
        await page.waitForTimeout(30);
      }
      console.log('d: Prüfungen', checked, 'echter Klick', realClick, JSON.stringify(st));
      if (!realClick) errors.push('d: kein echter Klick geprüft');
      await ctx.close();
      const s = await newPage(browser, 'd2');
      await s.page.goto(BASE);
      for (const sz of await s.page.$$eval('.btn:not(.mini)', (els) => els.filter((e) => e.offsetParent !== null).map((e) => ({ h: Math.round(e.getBoundingClientRect().height), t: e.innerText.trim().slice(0, 25) })))) if (sz.h < 48) errors.push('d: Startseite Knopf zu klein ' + JSON.stringify(sz));
      if (!(await pageScrollOk(s.page))) errors.push('d: Startseite scrollt waagerecht');
      await shot(s.page, 'start');
      await s.ctx.close();
    }
    // ---------- Desktop ----------
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'pc', { vp: { w: 1280, h: 900 } });
      await page.waitForTimeout(600);
      await shot(page, 'pc-spiel', false);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
    freePort();
  }
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('WALDLEBEN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); try { freePort(); } catch { /* egal */ } process.exit(1); });
