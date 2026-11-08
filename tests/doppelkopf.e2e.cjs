// Browser-Test Doppelkopf: NODE_PATH=$(npm root -g) node tests/doppelkopf.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8975 (PORT=... ändert das).
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8975);
const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/doppelkopf/index.html`;
const errors = [];
let M;

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'dk-' + name + '.png'), fullPage: true });
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
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}

// Spielstand des Gastgebers (Alleinspiel: localStorage, Test-Modus: sessionStorage)
const hostGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) { try { const h = JSON.parse(st.getItem('zh.dk.hostState')); if (h && h.game) return h.game; } catch (e) { /* weiter */ } }
  return null;
});
const myIdxOf = (g, humanId) => g.players.findIndex((p) => p.id === humanId);
const humanIdOf = (g) => g.players.find((p) => !p.id.startsWith('bot')).id;

// ---------- ein Schritt des Menschen (Zustand aus dem Gastgeber, Klick im DOM) ----------
async function humanStep(page, info) {
  const g = await hostGame(page);
  if (!g || g.phase !== 'play') return null;
  const mi = info.myIdx(g);
  if (mi < 0) return null;
  const me = g.players[mi];
  // Ansage (vor der ersten eigenen Karte), einmal pro Runde mit Wahrscheinlichkeit
  if (info.announce && me.hand.length === 12 && !info.stats.annRound[g.round + '|' + g.gid] && (await page.locator('[data-act=announce]').count())) {
    info.stats.annRound[g.round + '|' + g.gid] = true;
    if (Math.random() < info.announce) {
      const what = await page.getAttribute('[data-act=announce]', 'data-what');
      await page.click('[data-act=announce]');
      await page.waitForFunction(() => !document.querySelector('[data-act=announce]'), null, { timeout: 3000 }).catch(() => errors.push('Ansage-Knopf bleibt nach der Ansage'));
      const g2 = await hostGame(page);
      if (g2.announced[what] !== mi) errors.push(`Ansage ${what} nicht im Zustand (${JSON.stringify(g2.announced)})`);
      if (!(await page.textContent('.s-bottom .lb i')).includes(what === 're' ? 'Re' : 'Kontra')) errors.push('Nach der Ansage steht kein Team an deinem Namen');
      info.stats.ann++;
      return 'announce';
    }
  }
  if (g.turn !== mi) return null;
  const legal = M.legalCards(g, me.id);
  if (!legal.length) return null;
  if (info.tryIllegal && !info.stats.illegal) {
    const bad = me.hand.find((c) => !legal.includes(c));
    if (bad !== undefined) {
      if ((await page.locator('.dk-hand .can, .dk-hand .dim').count()) > 0) errors.push('Spielbare Karten sind markiert, obwohl die Option aus ist');
      await page.click(`.dk-hand button[data-c="${bad}"]`);
      await page.waitForSelector('.dk-line.warn', { timeout: 3000 });
      const txt = await page.textContent('.dk-line.warn');
      if (!/bedienen/.test(txt)) errors.push('Hinweis unfreundlich/falsch: ' + txt);
      const after = await hostGame(page);
      if (JSON.stringify(after) !== JSON.stringify(g)) errors.push('Antippen einer unerlaubten Karte hat den Spielstand verändert');
      info.stats.illegal++;
      await shot(page, 'hinweis-bedienen');
      return 'illegal';
    }
  }
  const card = legal[Math.floor(Math.random() * legal.length)];
  await page.click(`.dk-hand button[data-c="${card}"]`);
  info.stats.card++;
  return 'card';
}
const mkInfo = (humanId, { tryIllegal = false, announce = 0 } = {}) => ({ myIdx: (g) => myIdxOf(g, humanId), stats: { card: 0, illegal: 0, ann: 0, annRound: {} }, tryIllegal, announce });

// ---------- Layout-Prüfung (Handy) ----------
async function layoutCheck(page, label, { minCard = 48 } = {}) {
  const r = await page.evaluate(() => {
    const out = { hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [], card: 999 };
    document.querySelectorAll('button, .dk-hand .face').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      if (el.closest('.coach') || el.closest('.topbtns')) return; // kleine Hilfsknöpfe der Kopfzeile/Lernrunde
      if (el.classList.contains('face')) out.card = Math.min(out.card, b.width);
      if (b.width < 48 || b.height < 48) out.small.push(`${el.getAttribute('data-act') || el.className} ${Math.round(b.width)}x${Math.round(b.height)}`);
    });
    return out;
  });
  if (r.hscroll > 0) errors.push(`${label}: horizontaler Seitenscroll ${r.hscroll}px`);
  if (r.small.length) errors.push(`${label}: zu kleine Knöpfe/Karten: ${r.small.join(', ')}`);
  if (minCard && r.card < minCard && r.card !== 999) errors.push(`${label}: Handkarten nur ${r.card}px breit (Ziel ${minCard})`);
  return r;
}

// Zustand des Gastgebers und DOM im selben Augenblick lesen (der Gastgeber speichert und zeichnet im selben Schritt)
const snap = (page) => page.evaluate(() => {
  let g = null;
  for (const st of [sessionStorage, localStorage]) { try { const h = JSON.parse(st.getItem('zh.dk.hostState')); if (h && h.game) { g = h.game; break; } } catch (e) { /* weiter */ } }
  const ids = [...document.querySelectorAll('[data-c]')].map((e) => Number(e.getAttribute('data-c')));
  const tb = {};
  for (const pos of ['bottom', 'left', 'top', 'right']) { const el = document.querySelector(`.s-${pos} .lb i`); tb[pos] = el ? el.textContent : null; }
  return { g, ids, tb };
});

// Öffentliche Teamanzeige: Du/Namen zeigen Re/Kontra nur, wenn es bekannt ist (oder in der Lernrunde für dich selbst)
async function teamBadgeCheck(page, label, learn = false) {
  const { g, tb } = await snap(page);
  if (!g || g.phase !== 'play') return false;
  const mi = myIdxOf(g, humanIdOf(g));
  const seats = { bottom: mi, left: (mi + 1) % 4, top: (mi + 2) % 4, right: (mi + 3) % 4 };
  for (const [pos, i] of Object.entries(seats)) {
    const txt = tb[pos] || '';
    const shown = /Kontra/.test(txt) ? 'kontra' : /Re/.test(txt) ? 're' : null;
    let want = g.known[i];
    if (learn && i === mi) want = want || g.team[i];
    if (shown !== want) errors.push(`${label}: Teamanzeige ${pos} "${txt}" statt ${want}`);
  }
  return true;
}

// Verdeckte Karten dürfen im DOM nie auftauchen: nur eigene Hand + Karten im Stich/letzten Stich.
const allowedOf = (g, myId) => {
  const mi = myIdxOf(g, myId);
  const al = new Set(g.players[mi].hand);
  for (const t of g.trick.cards) al.add(t.card);
  if (g.last) for (const t of g.last.cards) al.add(t.card);
  return al;
};
const hiddenOf = (g, myId) => new Set(g.players.flatMap((p, i) => (i === myIdxOf(g, myId) ? [] : p.hand)));
function judgeHidden(ids, states, myId, label) {
  const bad = ids.filter((c) => states.every((g) => !allowedOf(g, myId).has(c)));
  if (bad.length) errors.push(`${label}: Karten im DOM, die niemand sehen darf: ${bad.slice(0, 3).map((c) => M.cardName(c)).join(', ')}`);
  const hid = ids.filter((c) => states.every((g) => hiddenOf(g, myId).has(c)));
  if (hid.length) errors.push(`${label}: fremde Handkarte im DOM ${M.cardName(hid[0])}`);
}
// Gastgeber-Seite: atomar. Gast-Seite: Zustand des Gastgebers vor und nach dem Lesen (nur Karten, die in beiden unerlaubt sind, zählen)
async function assertNoHiddenHost(page, label) {
  const { g, ids } = await snap(page);
  if (g && g.phase === 'play') judgeHidden(ids, [g], humanIdOf(g), label);
}
async function assertNoHiddenGuest(guestPage, hostPage, myId, label) {
  const g1 = await hostGame(hostPage);
  const ids = await guestPage.evaluate(() => [...document.querySelectorAll('[data-c]')].map((e) => Number(e.getAttribute('data-c'))));
  const g2 = await hostGame(hostPage);
  if (g1 && g2) judgeHidden(ids, [g1, g2], myId, label);
}

async function playUntil(page, info, { stop, maxMs = 120000, pos = null, label = '', checkLayout = false, after, learnBadges = false } = {}) {
  const t0 = Date.now();
  let acts = 0; let layoutDone = false; let badgeChecks = 0;
  const jumps = [];
  let lastSig = '';
  while (Date.now() - t0 < maxMs) {
    if (await stop(page)) break;
    const bp = await boardPos(page);
    if (bp && pos) {
      if (Math.abs(bp.top - pos.top) > 1 || Math.abs(bp.h - pos.h) > 1) { jumps.push(`${JSON.stringify(pos)} -> ${JSON.stringify(bp)}`); pos = bp; }
    } else if (bp) pos = bp;
    if (checkLayout && bp && !layoutDone) { layoutDone = true; await layoutCheck(page, label + ' Layout'); }
    const g = await hostGame(page);
    if (g && g.phase === 'play') {
      const sig = [g.round, g.tricksDone, g.trick.cards.length, JSON.stringify(g.known)].join('|');
      if (sig !== lastSig && badgeChecks < 15) { lastSig = sig; if (await teamBadgeCheck(page, label + ' Teamanzeige', learnBadges)) badgeChecks++; }
      await assertNoHiddenHost(page, label + ' DOM');
    }
    const r = await humanStep(page, info);
    if (r) { acts++; if (after) await after(r, page); await page.waitForTimeout(15); } else await page.waitForTimeout(25);
  }
  if (jumps.length) errors.push(`${label}: Spielfeld springt (${jumps.length}x) z. B. ${jumps[0]}`);
  return { acts, pos };
}

async function startBot(browser, n, level, label, { query = '', vp = {}, hints = false, wedding = null } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE + query);
  await page.fill('#name', 'Anna');
  if (hints) await page.check('[data-opt=hints]');
  if (wedding === false) await page.uncheck('[data-opt=wedding]');
  await page.screenshot({ path: path.join(SHOTS, `dk-${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  M = await import(path.join(ROOT, 'doppelkopf/engine.js'));
  try { const pids = execSync(`lsof -t -i:${PORT} || true`).toString().trim().split(/\s+/).filter(Boolean); pids.forEach((p) => { try { process.kill(Number(p)); } catch (e) { /* weg */ } }); } catch (e) { /* kein lsof */ }
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch();
  try {
    // ---------- Startseite: drei Computer-Knöpfe je Stufe, Optionen ----------
    {
      const { ctx, page } = await newPage(browser, 'start');
      await page.goto(BASE);
      await page.waitForSelector('#name');
      for (const n of [1, 2, 3]) for (const lv of [0, 1]) if (!(await page.locator(`[data-act=bot][data-n="${n}"][data-level="${lv}"]`).count())) errors.push(`Start: Computer-Knopf n=${n} Stufe ${lv} fehlt`);
      for (const o of ['hints', 'wedding', 'short']) if (!(await page.locator(`[data-opt=${o}]`).count())) errors.push('Start: Option fehlt ' + o);
      if (await page.isChecked('[data-opt=hints]')) errors.push('Start: „Spielbare Karten anzeigen“ ist nicht standardmäßig aus');
      if (!(await page.isChecked('[data-opt=wedding]'))) errors.push('Start: Hochzeit nicht standardmäßig an');
      await shot(page, 'startseite');
      await ctx.close();
    }
    // ---------- (a) gegen 3 Computer (Mittel): 2 Runden, Ansage, Nächste Runde, Neuladen, Spielende ----------
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'a1', { query: '?rounds=2' });
      const g0 = await hostGame(page);
      if (g0.players.length !== 4 || g0.players.filter((p) => p.id.startsWith('bot')).length !== 3) errors.push('a1: erwartet Mensch + 3 Computer');
      if (g0.opts.rounds !== 2) errors.push('a1: ?rounds nicht übernommen');
      await shot(page, 'a1-start');
      const info = mkInfo(humanIdOf(g0), { tryIllegal: true, announce: 1 });
      let reloaded = false; let shotMid = false;
      const r1 = await playUntil(page, info, {
        label: 'a1', checkLayout: true,
        stop: async (p) => (await p.locator('.dk-over').count()) > 0,
        after: async (act, p) => {
          const g = await hostGame(p);
          if (!shotMid && g && g.tricksDone >= 3) { shotMid = true; await shot(p, 'a1-mitte'); }
          if (!reloaded && g && g.tricksDone >= 4) { reloaded = true; await p.reload(); await p.waitForSelector('#board', { timeout: 8000 }); console.log('a1: Neuladen ok'); }
        },
        maxMs: 90000,
      });
      const over = (await page.locator('.dk-over').count()) > 0;
      console.log('a1: Runde 1:', JSON.stringify({ ...info.stats, annRound: undefined }), 'Aktionen', r1.acts, 'Ende', over);
      if (!over) errors.push('a1: Runde nicht beendet');
      else {
        const gr = await hostGame(page);
        const res = gr.result;
        console.log('a1: Ergebnis:', (await page.textContent('.dk-over h1')).trim(), '| Augen Re', res.reAugen, 'Kontra', res.kontraAugen, '| Spielwert', res.base, 'x', res.mult, '| Punkte', JSON.stringify(res.delta));
        if (res.reAugen + res.kontraAugen !== 240) errors.push('a1: Augen ergeben nicht 240');
        if (Object.values(res.delta).reduce((a, b) => a + b, 0) !== 0) errors.push('a1: Rundenpunkte nicht Nullsumme');
        const txt = await page.textContent('.dk-over');
        if (!/Augen/.test(txt) || !/Gesamt/.test(txt) || !/gesammelt/.test(txt)) errors.push('a1: Rundenende ohne Augen/Stichstapel/Gesamt');
        const sum = await page.textContent('.dk-sum p.big');
        if (!/Augen/.test(sum) || !/Spielwert/.test(sum)) errors.push('a1: Vorlese-Text am Rundenende unvollständig: ' + sum);
        if (info.stats.ann && res.mult < 2) errors.push('a1: Ansage ohne Verdopplung im Ergebnis');
        await shot(page, 'a1-rundenende');
        if (!(await page.locator('[data-act=next]').count())) errors.push('a1: Nächste Runde fehlt');
        else {
          const before = gr.players.map((p) => p.total); const dealer = gr.dealer;
          await page.click('[data-act=next]');
          await page.waitForSelector('#board');
          const g2 = await hostGame(page);
          if (g2.round !== 2) errors.push('a1: Runde 2 erwartet');
          if (JSON.stringify(g2.players.map((p) => p.total)) !== JSON.stringify(before)) errors.push('a1: Gesamtstand nicht erhalten');
          if (g2.dealer !== (dealer + 1) % 4) errors.push('a1: Geber rotiert nicht');
          console.log('a1: Nächste Runde ok (Geber rotiert, Stand erhalten)');
          // Runde 2 bis zum Spielende
          await playUntil(page, mkInfo(humanIdOf(g2), { announce: 0.5 }), { label: 'a1b', stop: async (p) => (await p.locator('.trophy').count()) > 0, maxMs: 90000 });
          if (!(await page.locator('.trophy').count())) errors.push('a1: Spielende nicht erreicht');
          else {
            await page.waitForTimeout(500);
            const head = (await page.textContent('.dk-over h1')).trim();
            const conf = await page.locator('canvas.confetti').count();
            console.log('a1: Spielende:', head, '| Konfetti:', conf);
            if (/^Du /.test(head) && !conf) errors.push('a1: Gewonnen, aber kein Konfetti');
            await shot(page, 'a1-spielende');
            const gf = await hostGame(page);
            if (gf.players.reduce((s, p) => s + p.total, 0) !== 0) errors.push('a1: Gesamtstand nicht Nullsumme');
            if (!(await page.locator('[data-act=again]').count())) errors.push('a1: Neues Spiel fehlt');
            else {
              await page.click('[data-act=again]');
              await page.waitForSelector('#board');
              const g3 = await hostGame(page);
              if (g3.round !== 1 || g3.players.some((p) => p.total)) errors.push('a1: Neues Spiel setzt den Stand nicht zurück');
              console.log('a1: Neues Spiel ok');
            }
          }
        }
      }
      await ctx.close();
    }
    {
      // a2: ein Computer (Leicht): die zwei fehlenden Plätze werden mit Computern gefüllt; mit „Spielbare Karten anzeigen“
      const { ctx, page } = await startBot(browser, 1, 0, 'a2', { query: '?rounds=1', hints: true });
      const g0 = await hostGame(page);
      const names = g0.players.map((p) => p.name);
      console.log('a2: Plätze:', names.join(', '));
      if (g0.players.length !== 4 || new Set(names).size !== 4) errors.push('a2: Plätze nicht aufgefüllt/eindeutig ' + names.join(','));
      const info = mkInfo(humanIdOf(g0), { announce: 0.5 });
      let hintChecks = 0;
      await playUntil(page, info, { label: 'a2', maxMs: 90000,
        stop: async (p) => {
          if (hintChecks < 3) { // Markierung nur, wenn ich dran bin: genau die erlaubten Karten (Zustand und DOM im selben Augenblick)
            const { g } = await snap(p);
            if (g && g.phase === 'play' && g.turn === myIdxOf(g, humanIdOf(g))) {
              const r = await p.evaluate(() => ({ can: document.querySelectorAll('.dk-hand .can').length, dim: document.querySelectorAll('.dk-hand .dim').length, all: document.querySelectorAll('.dk-hand .face').length }));
              const g2 = (await snap(p)).g;
              if (JSON.stringify(g2) === JSON.stringify(g)) {
                const legal = M.legalCards(g, humanIdOf(g));
                if (r.can !== legal.length || r.can + r.dim !== r.all) errors.push(`a2: markierte Karten ${r.can} (abgeblendet ${r.dim}) ≠ erlaubte ${legal.length} von ${r.all}`);
                hintChecks++;
              }
            }
          }
          return (await p.locator('.dk-over').count()) > 0;
        } });
      if (!(await page.locator('.trophy').count())) errors.push('a2: Spielende (1 Runde) nicht erreicht');
      console.log('a2: Spiel mit 1 Runde fertig; Hinweis-Prüfungen', hintChecks);
      await ctx.close();
    }
    {
      // a3: Hochzeit aus + Leicht, Runde bis zum Ende; prüfen, dass die Option greift
      const { ctx, page } = await startBot(browser, 2, 0, 'a3', { query: '?rounds=1', wedding: false });
      const g0 = await hostGame(page);
      if (g0.opts.wedding !== false) errors.push('a3: Option Hochzeit aus nicht übernommen');
      const info = mkInfo(humanIdOf(g0), {});
      await playUntil(page, info, { label: 'a3', stop: async (p) => (await p.locator('.dk-over').count()) > 0, maxMs: 90000 });
      if (!(await page.locator('.dk-over').count())) errors.push('a3: nicht beendet');
      const gf = await hostGame(page);
      if (gf.wedding && gf.wedding.state !== 'alone') errors.push('a3: Hochzeit trotz ausgeschalteter Option');
      await ctx.close();
    }
    {
      // a4: Konfetti – so lange Spiele (?rounds=1) gegen Leicht, bis der Mensch gewonnen hat
      const { ctx, page } = await startBot(browser, 3, 0, 'a4', { query: '?rounds=1', hints: true });
      let won = false; let conf = 0;
      for (let game = 0; game < 10 && !won; game++) {
        const g0 = await hostGame(page);
        await playUntil(page, mkInfo(humanIdOf(g0), { announce: 0.3 }), { label: 'a4', stop: async (p) => (await p.locator('.trophy').count()) > 0, maxMs: 90000 });
        const head = (await page.textContent('.dk-over h1')).trim();
        if (/^Du /.test(head)) { won = true; await page.waitForTimeout(400); conf = await page.locator('canvas.confetti').count(); await shot(page, 'a4-sieg-konfetti'); }
        else { await page.click('[data-act=again]'); await page.waitForSelector('#board'); }
      }
      console.log('a4: Mensch hat gewonnen:', won, '| Konfetti-Canvas:', conf);
      if (!won) errors.push('a4: kein Sieg des Menschen in 10 Spielen (unwahrscheinlich)');
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
      let steps = 0; let idle = 0; let finished = false; let shotHint = false; let badge = false; let first = true;
      while (steps < 400) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 170) errors.push(`lern: Textlänge ${text.length}`);
        texts.add(text);
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (first) {
          first = false;
          const gl = await hostGame(page);
          if (gl.players.length !== 4) errors.push('lern: nicht vier Personen');
          const t = await page.textContent('.s-bottom .lb i');
          badge = /Re|Kontra/.test(t);
          if (!badge) errors.push('lern: eigenes Team wird in der Lernrunde nicht angezeigt: ' + t);
          await shot(page, 'lern-start');
        }
        if (act === 'card' && !shotHint) { shotHint = true; await shot(page, 'lern-karten'); }
        if (act === 'next' || act === 'again') { finished = true; await shot(page, 'lern-ende'); break; }
        try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
        steps++;
      }
      console.log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      const gl = await hostGame(page);
      if (!gl.opts.hints) errors.push('lern: hints nicht aktiv');
      if ([...texts].some((t) => /beste|empfehl|am besten/i.test(t))) errors.push('lern: Empfehlung im Text');
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage(browser, 'lern2');
      await page.goto(BASE);
      await page.fill('#name', 'Erna');
      await page.click('[data-act=learn]');
      await page.waitForSelector('.coach-target');
      await page.click('.coach-target');
      await page.reload();
      await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern2: nach Neuladen keine Lernrunde'));
      await page.click('[data-act=learn-stop]');
      await page.waitForTimeout(200);
      if (await page.locator('.coach').count()) errors.push('lern2: Anleitung bleibt');
      await ctx.close();
    }

    // ---------- (c) Host + Gast (Test-Netz): 2 Menschen + 2 Computer ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        const si = window.setInterval;
        window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
        const st = window.setTimeout;
        window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
      });
      const watch = (p, n) => {
        p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
        p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); });
        p.on('dialog', (d) => d.accept());
      };
      const A = await ctx.newPage(); watch(A, 'A');
      await A.goto(BASE + '?mock=1&rounds=2');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      await A.check('[data-opt=hints]');
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      const g0 = await hostGame(A);
      const humans = g0.players.filter((p) => !p.id.startsWith('bot'));
      console.log('Netz: Plätze', g0.players.map((p) => p.name).join(', '));
      if (g0.players.length !== 4 || humans.length !== 2 || g0.players.filter((p) => p.id.startsWith('bot')).length !== 2) errors.push('netz: erwartet 2 Menschen + 2 Computer');
      const idA = g0.hostId; const idB = humans.find((p) => p.id !== idA).id;
      const infoA = mkInfo(idA, { announce: 0.5 }); const infoB = mkInfo(idB, {});
      const faceSet = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map((e) => Number(e.getAttribute('data-c'))).sort((a, b) => a - b), sel);
      let acts = 0; let checks = 0; let posA = null; let posB = null; let sh = false; let rounds = 1; let annB = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        if ((await A.locator('.trophy').count()) && (await B.locator('.trophy').count())) break;
        if ((await A.locator('.dk-over').count()) && !(await A.locator('.trophy').count())) {
          await A.click('[data-act=next]'); await A.waitForSelector('#board'); await B.waitForSelector('#board'); rounds++; continue;
        }
        const g = await hostGame(A);
        if (!g || g.phase !== 'play') { await A.waitForTimeout(30); continue; }
        const humanTurn = g.turn === myIdxOf(g, idA) || g.turn === myIdxOf(g, idB);
        if (!humanTurn) { await A.waitForTimeout(25); continue; } // die Computer ziehen: der Zustand ist gleich nicht stabil
        // gleiche Tischmitte in beiden Ansichten und wie im Zustand (nur bei stabilem Zustand: Mensch ist dran)
        const expTable = (gg) => (gg.trick.cards.length ? gg.trick.cards : gg.last ? gg.last.cards : []).map((t) => t.card).sort((x, y) => x - y);
        let same = false;
        for (let k = 0; k < 25 && !same; k++) {
          const g1 = await hostGame(A);
          const [ta, tb] = [await faceSet(A, '.dk-table .face'), await faceSet(B, '.dk-table .face')];
          const g2 = await hostGame(A);
          if (JSON.stringify(g1) !== JSON.stringify(g2)) { await A.waitForTimeout(30); continue; }
          same = JSON.stringify(ta) === JSON.stringify(expTable(g1)) && JSON.stringify(tb) === JSON.stringify(expTable(g1));
          if (!same) await A.waitForTimeout(30);
        }
        if (same) checks++; else { errors.push('netz: Tischmitte von Host/Gast stimmt nicht mit dem Zustand überein'); break; }
        const handA = await faceSet(A, '.dk-hand .face'); const handB = await faceSet(B, '.dk-hand .face');
        const gh = await hostGame(A);
        if (JSON.stringify(gh) === JSON.stringify(g)) {
          if (JSON.stringify(handA) !== JSON.stringify(g.players[myIdxOf(g, idA)].hand.slice().sort((x, y) => x - y))) errors.push('netz: Hand des Gastgebers stimmt nicht mit dem Zustand überein');
          if (JSON.stringify(handB) !== JSON.stringify(g.players[myIdxOf(g, idB)].hand.slice().sort((x, y) => x - y))) errors.push('netz: Hand des Gastes stimmt nicht mit dem Zustand überein');
        }
        await assertNoHiddenHost(A, 'netz A'); await assertNoHiddenGuest(B, A, idB, 'netz B');
        await teamBadgeCheck(A, 'netz A Team');
        if (g.turn === myIdxOf(g, idA) && (await A.locator('.dk-hand .can').count()) === 0) errors.push('netz: Option „Spielbare Karten anzeigen“ markiert nichts');
        if (g.tricksDone >= 1) {
          const bpA = await boardPos(A); const bpB = await boardPos(B);
          if (bpA && posA && (Math.abs(bpA.top - posA.top) > 1 || Math.abs(bpA.h - posA.h) > 1)) { errors.push('netz A: Spielfeld springt'); posA = bpA; } else if (bpA && !posA) posA = bpA;
          if (bpB && posB && (Math.abs(bpB.top - posB.top) > 1 || Math.abs(bpB.h - posB.h) > 1)) { errors.push('netz B: Spielfeld springt'); posB = bpB; } else if (bpB && !posB) posB = bpB;
        }
        if (!sh && g.tricksDone >= 2) { sh = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        // Gast: Ansage und Karte über das DOM
        const mb = myIdxOf(g, idB);
        if (g.players[mb].hand.length === 12 && (await B.locator('[data-act=announce]').count()) && !annB) {
          annB = 1; await B.click('[data-act=announce]'); acts++;
          const g3 = await hostGame(A);
          await B.waitForTimeout(100);
          void g3;
          continue;
        }
        if (g.turn === mb) {
          const legal = M.legalCards(g, idB);
          const c = legal[Math.floor(Math.random() * legal.length)];
          await B.click(`.dk-hand button[data-c="${c}"]`); acts++;
        } else if (await humanStep(A, infoA)) acts++;
        await A.waitForTimeout(25);
      }
      const finalA = await hostGame(A);
      console.log('Netz: Aktionen', acts, 'Runden', rounds, 'identische Tischmitten geprüft', checks, 'Gast-Ansage', annB, 'Ende', finalA && finalA.phase);
      if (!(await A.locator('.trophy').count()) || !(await B.locator('.trophy').count())) errors.push('netz: Spielende nicht erreicht');
      else {
        console.log('Netz Sieger:', (await A.textContent('.dk-over h1')).trim(), '|', (await B.textContent('.dk-over h1')).trim());
        await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
        if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf');
        if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
        if (!(await A.locator('[data-act=again]').count())) errors.push('Host sieht Neues-Spiel-Knopf nicht');
        await A.click('[data-act=again]');
        await A.waitForSelector('#board'); await B.waitForSelector('#board');
        const gN = await hostGame(A);
        if (gN.round !== 1 || gN.players.some((p) => p.total)) errors.push('netz: Neues Spiel ohne Reset');
        await assertNoHiddenGuest(B, A, idB, 'netz B (neues Spiel)');
        await A.click('[data-act=help]');
        await A.waitForSelector('.modal');
        const helpTxt = await A.textContent('.modal');
        if (!/Dulle/.test(helpTxt) || !/Bedienpflicht/.test(helpTxt) || !/Hochzeit/.test(helpTxt)) errors.push('Hilfe unvollständig');
        await shot(A, 'hilfe');
      }
      await ctx.close();
    }
    {
      // fünfte Person wird abgewiesen (maximal 4 Menschen)
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pages = [];
      const A = await ctx.newPage(); pages.push(A);
      await A.goto(BASE + '?mock=1'); await A.fill('#name', 'Anna'); await A.click('[data-act=host]'); await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      for (const nm of ['Bernd', 'Carla', 'Dirk']) {
        const P = await ctx.newPage(); pages.push(P);
        await P.goto(BASE + '?mock=1&raum=' + code); await P.fill('#name', nm); await P.click('[data-act=join-invited]');
        await A.waitForFunction((n) => document.querySelectorAll('.players li').length >= n, pages.length, { timeout: 5000 }).catch(() => errors.push('netz4: ' + nm + ' kam nicht in die Lobby'));
      }
      await A.click('[data-act=start]');
      await A.waitForSelector('#board');
      const g4 = await hostGame(A);
      if (g4.players.length !== 4 || g4.players.some((p) => p.id.startsWith('bot'))) errors.push('netz4: vier Menschen erwartet');
      await ctx.close();
    }

    // ---------- (d) Layout: Handy, kleinere Handys, Desktop, große Schrift ----------
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'd1', { vp: { w: 390, h: 844 }, hints: true });
      const g0 = await hostGame(page);
      const info = mkInfo(humanIdOf(g0), { announce: 0 });
      const heights = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const bp = await boardPos(page);
        if (bp) heights.add(bp.top + ':' + bp.h);
        const g = await hostGame(page);
        if (g && g.phase === 'play' && g.tricksDone >= 6) break;
        if (!(await humanStep(page, info))) await page.waitForTimeout(25);
      }
      if (heights.size > 1) errors.push('d1: Brett wandert/ändert die Höhe: ' + [...heights].join(', '));
      await page.waitForTimeout(300);
      const lay = await layoutCheck(page, 'd1 Spiel', { minCard: 55 });
      console.log('d1: kleinste Handkarte', Math.round(lay.card), 'px, Brett', [...heights].join(', '));
      await shot(page, 'd1-spiel');
      await page.click('[data-act=bigger]');
      await page.waitForTimeout(200);
      await layoutCheck(page, 'd1 große Schrift', { minCard: 48 });
      await shot(page, 'd1-gross');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'd2', { vp: { w: 360, h: 740 } });
      await page.waitForTimeout(500);
      await layoutCheck(page, 'd2 360px', { minCard: 48 });
      await shot(page, 'd2-360');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'd3', { vp: { w: 320, h: 640 } });
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (r > 0) errors.push('d3 320px: horizontaler Seitenscroll ' + r);
      await shot(page, 'd3-320');
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 1, 'pc', { vp: { w: 1280, h: 900 } });
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
  console.log('DOPPELKOPF E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
