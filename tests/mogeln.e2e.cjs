// Browser-Test Mogeln: NODE_PATH=$(npm root -g) node tests/mogeln.e2e.cjs
// Startet selbst einen Static-Server (python3 -m http.server) auf Port 8967.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 8967;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/mogeln/index.html`;
const errors = [];
let M;

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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'mogeln-' + name + '.png'), fullPage: true });
const pos = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height) }; }, sel);
const readGame = (page) => page.evaluate(() => {
  for (const st of [sessionStorage, localStorage]) {
    try { const h = JSON.parse(st.getItem('zh.mg.hostState')); if (h && h.game) return h.game; } catch { /* egal */ }
  }
  return null;
});
const getCid = (page) => page.evaluate(() => { for (const st of [sessionStorage, localStorage]) { try { const c = JSON.parse(st.getItem('zh.cid')); if (c) return c; } catch { /* egal */ } } return null; });

const stats = { plays: 0, lies: 0, calls: 0, believes: 0, leakChecks: 0, maxSel: 0, fullMsg: 0 };

// Verdeckte Karten dürfen nie im DOM stehen: offene Karten = nur meine Hand (+ im Aufdeck-Moment die aufgedeckten Karten).
async function leakCheck(page, label, g, cid) {
  if (!g || g.phase === 'over') return;
  const v = await page.evaluate(() => ({
    faces: [...document.querySelectorAll('.mg-card:not(.back)')].map((e) => ({ name: (e.getAttribute('aria-label') || '').split(',')[0], id: e.dataset.id === undefined ? null : Number(e.dataset.id), inHand: !!e.closest('.mg-hand'), inStrip: !!e.closest('.mg-strip') })),
    backsInStrip: document.querySelectorAll('.mg-strip .mg-card.back').length,
    text: document.body.innerText,
    html: document.body.innerHTML,
    opps: [...document.querySelectorAll('.mg-opp')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
    handTitle: (document.querySelector('.mg-handcard h2') || {}).innerText || '',
  }));
  stats.leakChecks++;
  const me = g.players.find((p) => p.id === cid);
  const mineNames = new Set(me.hand.map((c) => `${M.SUITS[M.suitOf(c)].name} ${M.RANKS[M.rankOf(c)].name}`));
  const revealIds = g.phase === 'reveal' && g.last && g.last.kind === 'reveal' ? g.last.ids : [];
  const revNames = new Set(revealIds.map((c) => `${M.SUITS[M.suitOf(c)].name} ${M.RANKS[M.rankOf(c)].name}`));
  const handFaces = v.faces.filter((f) => f.inHand);
  if (handFaces.length !== me.hand.length) errors.push(`${label}: Handkarten im DOM ${handFaces.length} statt ${me.hand.length}`);
  for (const f of handFaces) if (!mineNames.has(f.name)) errors.push(`${label}: fremde Karte in der Hand-Anzeige: ${f.name}`);
  const others = v.faces.filter((f) => !f.inHand);
  if (g.phase === 'reveal') {
    if (others.length !== revealIds.length) errors.push(`${label}: aufgedeckte Karten ${others.length} statt ${revealIds.length}`);
    for (const f of others) if (!revNames.has(f.name) || !f.inStrip) errors.push(`${label}: unerwartete offene Karte ${f.name}`);
  } else {
    if (others.length) errors.push(`${label}: offene Karten außerhalb der Hand (Phase ${g.phase}): ${others.map((f) => f.name)}`);
    const expectBacks = g.lastPlay && g.pile.length > 0 ? g.lastPlay.count : 0;
    if (v.backsInStrip !== expectBacks) errors.push(`${label}: verdeckte Karten im Streifen ${v.backsInStrip} statt ${expectBacks}`);
  }
  // kein Kartenname fremder Karten im Text (außer aufgedeckte)
  const allowedNames = new Set([...mineNames, ...revNames]);
  for (let c = 0; c < 52; c++) {
    const nm = M.cardName(c);
    const plain = `${M.SUITS[M.suitOf(c)].name} ${M.RANKS[M.rankOf(c)].name}`;
    if (v.text.includes(nm) && !revNames.has(plain)) errors.push(`${label}: Kartenname im Text: ${nm}`);
    if (!allowedNames.has(plain) && (v.html.includes(`aria-label="${plain}`) || v.html.includes(`title="${plain}"`))) errors.push(`${label}: Karte im HTML: ${plain}`);
  }
  if (/"pile"|"hand"|data-pile|lastPlay/.test(v.html)) errors.push(`${label}: Zustandsfeld im DOM`);
  if (!v.handTitle.includes(`(${me.hand.length})`)) errors.push(`${label}: Handzahl-Titel falsch: ${v.handTitle}`);
  // Kartenzahlen der anderen stimmen mit dem Zustand überein
  const wantOpps = g.players.filter((p) => p.id !== cid).map((p) => `${p.name} ${p.hand.length === 1 ? '1 Karte' : p.hand.length + ' Karten'}`);
  if (JSON.stringify(v.opps) !== JSON.stringify(wantOpps)) errors.push(`${label}: Kartenzahlen ${JSON.stringify(v.opps)} statt ${JSON.stringify(wantOpps)}`);
}

// Ein Schritt eines Menschen. `src` = Seite des Gastgebers (hält den Spielstand), `page` = Seite, auf der geklickt wird.
async function humanStep(page, src, opt = {}) {
  const g = await readGame(src || page);
  if (!g || g.phase === 'over') return null;
  const cid = await getCid(page);
  const click = async (sel) => { try { await page.click(sel, { timeout: 2500 }); return true; } catch { return false; } };
  const myIdx = g.players.findIndex((p) => p.id === cid);
  if (myIdx < 0) return null;
  if (g.phase === 'reveal') {
    if (opt.noNext) return null;
    if (opt.leak) await leakCheck(page, opt.leak, g, cid);
    if (opt.checkReveal) await opt.checkReveal(page, g);
    return (await click('[data-act=next]')) ? 'next' : null;
  }
  if (g.players[g.active].id !== cid) return null;
  const me = g.players[myIdx];
  if (g.phase === 'play') {
    if (opt.leak) await leakCheck(page, opt.leak, g, cid);
    if (!(await page.locator('button.mg-card').count())) return null;
    const k = 1 + Math.floor(Math.random() * Math.min(4, me.hand.length));
    // wahr, wenn möglich (Hälfte der Fälle), sonst zufällig
    const trueCards = me.hand.filter((c) => M.rankOf(c) === g.rank);
    let pick;
    if (trueCards.length && Math.random() < 0.5) pick = trueCards.slice(0, 4);
    else pick = me.hand.slice().sort(() => Math.random() - 0.5).slice(0, k);
    for (const c of pick) if (!(await click(`button.mg-card[data-id="${c}"]`))) return null;
    stats.maxSel = Math.max(stats.maxSel, pick.length);
    const sub = await page.textContent('.mg-sub');
    if (!sub.includes(pick.length === 1 ? '1 Karte markiert' : `${pick.length} Karten markiert`)) errors.push('Markierungstext falsch: ' + sub);
    const selN = await page.$$eval('.mg-card.sel', (e) => e.length);
    if (selN !== pick.length) errors.push(`markierte Karten ${selN} statt ${pick.length}`);
    // fünfte Karte wird abgelehnt
    if (pick.length === 4 && me.hand.length > 4) {
      const extra = me.hand.find((c) => !pick.includes(c));
      await click(`button.mg-card[data-id="${extra}"]`);
      const s2 = await page.textContent('.mg-sub');
      if (!s2.includes('Mehr als 4')) errors.push('Meldung "Mehr als 4 Karten" fehlt: ' + s2);
      else stats.fullMsg++;
      if ((await page.$$eval('.mg-card.sel', (e) => e.length)) !== 4) errors.push('fünfte Karte wurde markiert');
    }
    if (opt.shotSel && !opt.shotSel.done) { opt.shotSel.done = true; await shot(page, 'markiert'); }
    stats.plays++;
    if (pick.some((c) => M.rankOf(c) !== g.rank)) stats.lies++;
    return (await click('[data-act=play]')) ? 'play' : null;
  }
  if (g.phase === 'decide') {
    if (opt.leak) await leakCheck(page, opt.leak, g, cid);
    if (opt.shotDecide && !opt.shotDecide.done) { opt.shotDecide.done = true; await shot(page, 'entscheiden'); }
    const call = Math.random() < 0.4;
    if (call) stats.calls++; else stats.believes++;
    return (await click(call ? '[data-act=call]' : '[data-act=believe]')) ? (call ? 'call' : 'believe') : null;
  }
  return null;
}

async function playGame(page, label, { maxMs = 200000, src, extra = {} } = {}) {
  const t0 = Date.now(); let acts = 0;
  let boardRef = null;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.mg-over').count()) break;
    const bp = await pos(page, '#board');
    if (bp) { if (boardRef && Math.abs(bp.top - boardRef.top) > 1) errors.push(`${label}: Spielfeld springt ${boardRef.top} -> ${bp.top}`); if (boardRef && Math.abs(bp.h - boardRef.h) > 1) errors.push(`${label}: Spielfeld-Höhe ${boardRef.h} -> ${bp.h}`); boardRef = bp; }
    const r = await humanStep(page, src, { leak: label, ...extra });
    if (r) { acts++; await page.waitForTimeout(8); } else await page.waitForTimeout(20);
  }
  return { acts, over: (await page.locator('.mg-over').count()) > 0 };
}

async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const out = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [] };
    document.querySelectorAll('[data-act=play]:not([disabled]),[data-act=believe],[data-act=call],[data-act=next],[data-act=again],button.mg-card').forEach((b) => {
      const q = b.getBoundingClientRect();
      if (q.width < 48 || q.height < 48) out.small.push((b.dataset.act || b.className) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
    });
    return out;
  });
  if (r.sw > r.cw) errors.push(`${label}: horizontaler Scroll ${r.sw} > ${r.cw}`);
  if (r.small.length) errors.push(`${label}: Knöpfe unter 48px: ${r.small.join(', ')}`);
}

async function startBot(browser, n, level, label, vp, { big } = {}) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE);
  await page.evaluate((b) => { try { localStorage.clear(); sessionStorage.clear(); if (b) localStorage.setItem('zh.big', 'true'); } catch { /* egal */ } }, !!big);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, `mogeln-${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'mogeln/engine.js')).href);
  let server = null;
  try { execSync(`curl -sf http://localhost:${PORT}/mogeln/index.html -o /dev/null`); } catch {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const browser = await chromium.launch();
  try {
    // ---------- (a) ganze Partie gegen 2 Computer (Mittel), danach noch eine Runde mit Neuladen ----------
    {
      const { ctx, page } = await startBot(browser, 2, 1, 'a');
      await shot(page, 'a-start-spiel');
      const ss = { done: false }; const sd = { done: false };
      let revShot = false;
      const checkReveal = async (p, g) => {
        const t = await p.textContent('.mg-result');
        const l = g.last;
        if (!/(hast|hat) (gemogelt|die Wahrheit gesagt)/.test(t) || !/Stapel/.test(t)) errors.push('Ergebnistext unklar: ' + t);
        const lie = l.ids.some((c) => M.rankOf(c) !== l.rank);
        if (lie !== /gemogelt/.test(t)) errors.push('Ergebnistext passt nicht zu den Karten: ' + t);
        const ok = await p.$$eval('.mg-rv.ok', (e) => e.length); const bad = await p.$$eval('.mg-rv.bad', (e) => e.length);
        const wantOk = l.ids.filter((c) => M.rankOf(c) === l.rank).length;
        if (ok !== wantOk || bad !== l.ids.length - wantOk) errors.push(`Aufgedeckt-Markierungen ${ok}/${bad} statt ${wantOk}/${l.ids.length - wantOk}`);
        if (!revShot) { revShot = true; console.log('(a) Ergebnistext:', t.replace(/\s+/g, ' ')); await shot(p, 'a-aufgedeckt'); }
      };
      const g0 = await readGame(page);
      if (g0.players.length !== 3 || g0.players.map((p) => p.hand.length).join() !== '18,17,17') errors.push('a: Austeilen 18/17/17 erwartet: ' + g0.players.map((p) => p.hand.length));
      const r = await playGame(page, 'a', { extra: { shotSel: ss, shotDecide: sd, checkReveal } });
      console.log('(a) Aktionen', r.acts, 'Ende', r.over, 'Statistik', JSON.stringify(stats));
      if (!r.over) errors.push('a: Runde nicht beendet');
      else {
        await shot(page, 'a-ende');
        console.log('(a) Ergebnis:', (await page.textContent('.mg-over h1')).trim(), '|', (await page.$$eval('.mg-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));
        await layoutCheck(page, 'a-ende');
        if (!(await page.locator('[data-act=next]').count())) errors.push('a: Nächste Runde fehlt');
        await page.click('[data-act=next]');
        await page.waitForSelector('#board');
        const g2 = await readGame(page);
        if (g2.round !== 2 || g2.phase !== 'play' || g2.players.reduce((s, p) => s + p.wins, 0) !== 1) errors.push('a: Runde 2 mit Spielstand nicht gestartet');
        for (let i = 0; i < 4; i++) { await humanStep(page); await page.waitForTimeout(80); }
        await page.reload();
        await page.waitForSelector('.banner', { timeout: 8000 });
        const r2 = await playGame(page, 'a2', { maxMs: 160000 });
        if (!r2.over) errors.push('a: zweite Runde nicht beendet');
        console.log('(a) zweite Runde Ende', r2.over);
        if (r2.over) {
          const gOver = await readGame(page);
          console.log('(a) Siege nach 2 Runden:', gOver.players.map((p) => p.name + ' ' + p.wins).join(', '));
          if (gOver.players.reduce((s, p) => s + p.wins, 0) < 2) errors.push('a: Siegpunkte nicht erhalten');
        }
      }
      await ctx.close();
    }

    // ---------- 6 Personen (5 Computer, Leicht) ----------
    {
      const { ctx, page } = await startBot(browser, 5, 0, 'sechs');
      const g0 = await readGame(page);
      if (g0.players.length !== 6) errors.push('sechs: 6 Personen erwartet');
      await shot(page, 'sechs-spiel');
      await layoutCheck(page, 'sechs-start');
      const r = await playGame(page, 'sechs', { maxMs: 200000 });
      console.log('6 Personen: Aktionen', r.acts, 'Ende', r.over);
      if (!r.over) errors.push('sechs: Runde nicht beendet');
      await ctx.close();
    }

    // ---------- (b) Lernrunde ----------
    {
      const { ctx, page } = await newPage(browser, 'lern');
      await page.goto(BASE);
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
      await page.goto(BASE);
      await page.fill('#name', 'Erna');
      await page.click('[data-act=learn]');
      await page.waitForSelector('.coach');
      const texts = new Set();
      let steps = 0; let idle = 0; let finished = false;
      while (steps < 3000) {
        const text = (await page.textContent('.coach .coach-t')).trim();
        if (text.length === 0 || text.length > 260) errors.push(`lern: Textlänge ${text.length}`);
        if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern-mitte'); }
        const target = page.locator('.coach-target').first();
        if ((await target.count()) === 0) {
          if (await page.locator('.mg-over').count()) { errors.push('lern: Runde zu Ende ohne Ziel'); break; }
          if (++idle > 800) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
          await page.waitForTimeout(15);
          continue;
        }
        idle = 0;
        const act = await target.getAttribute('data-act');
        if (act === 'next' && (await page.locator('.mg-over').count())) { finished = true; await shot(page, 'lern-ende'); break; }
        if (steps === 10) { await page.reload(); await page.waitForSelector('.coach', { timeout: 8000 }); steps++; continue; }
        try {
          await target.click({ timeout: 4000 });
          if (act === 'card') { // zusätzlich bis zu 3 weitere Karten markieren (ohne Empfehlung: einfach die nächsten)
            const extraN = Math.floor(Math.random() * 3);
            for (let i = 0; i < extraN; i++) await page.locator('button.mg-card:not(.sel)').first().click({ timeout: 2000 });
          }
        } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '" (' + act + '): ' + e.message.split('\n')[0]); break; }
        steps++;
      }
      console.log('(b) Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
      for (const t of texts) console.log('   -', t);
      if (!finished) errors.push('Lernrunde nicht bis zum Ende');
      const all = [...texts].join(' ');
      for (const w of ['Alle', 'verdeckt', 'mogeln', 'Mogler', 'Glauben', 'Stapel', 'Karten legen']) if (!all.includes(w)) errors.push('Lernrunde erklärt nicht: ' + w);
      if (/Empfehl|am besten|solltest/i.test(all)) errors.push('Lernrunde enthält Empfehlung');
      await page.click('[data-act=learn-stop]').catch(() => {});
      await ctx.close();
    }

    // ---------- (c) Host + Gast über Mock-Netz ----------
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
      await A.goto(BASE + '?mock=1');
      await A.fill('#name', 'Anna');
      await A.click('[data-act=host]');
      await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      const B = await ctx.newPage(); watch(B, 'B');
      await B.goto(BASE + '?mock=1&raum=' + code);
      await B.fill('#name', 'Bernd');
      await B.click('[data-act=join-invited]');
      const C = await ctx.newPage(); watch(C, 'C');
      await C.goto(BASE + '?mock=1&raum=' + code);
      await C.fill('#name', 'Clara');
      await C.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]');
      await shot(A, 'netz-lobby');
      if (await A.locator('input[data-opt]').count()) errors.push('Netz: unerwartete Optionen in der Lobby');
      await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board'); await C.waitForSelector('#board');
      const g0 = await readGame(A);
      if (g0.players.length !== 3) errors.push('Netz: 3 Personen erwartet');
      let acts = 0; let diffs = 0; let checks = 0; let shotDone = false;
      const norm = (s) => s.replace(/\(du\)/g, '').replace(/\s+/g, ' ').trim();
      const view = (P) => P.evaluate(() => ({ center: (document.querySelector('.mg-rankbox') || {}).innerText + '|' + (document.querySelector('.mg-count') || {}).innerText + '|' + document.querySelectorAll('.mg-strip .mg-card').length, recap: (document.querySelector('.recap') || {}).innerText || '', banner: (document.querySelector('.banner') || {}).innerText || '' }));
      const t0 = Date.now();
      const [cidA, cidB, cidC] = [await getCid(A), await getCid(B), await getCid(C)];
      while (Date.now() - t0 < 220000) {
        if ((await A.locator('.mg-over').count()) && (await B.locator('.mg-over').count()) && (await C.locator('.mg-over').count())) break;
        const g = await readGame(A);
        if (g && g.phase !== 'over') {
          const [va, vb, vc] = [await view(A), await view(B), await view(C)];
          const g2 = await readGame(A);
          if (g2 && g2.moves === g.moves) {
            checks++;
            const same = (x, y) => norm(x.center) === norm(y.center) && norm(x.recap) === norm(y.recap);
            if (!(same(va, vb) && same(va, vc))) {
              await B.waitForTimeout(150);
              const [wa, wb, wc] = [await view(A), await view(B), await view(C)];
              if (!(same(wa, wb) && same(wa, wc))) diffs++;
            }
            await leakCheck(A, 'A', g, cidA); await leakCheck(B, 'B', g, cidB); await leakCheck(C, 'C', g, cidC);
          }
        }
        const ra = await humanStep(A, A, { noNext: false }); const rb = await humanStep(B, A, { noNext: true }); const rc = await humanStep(C, A, { noNext: true });
        for (const r of [ra, rb, rc]) if (r) acts++;
        if (!shotDone && acts > 10) { shotDone = true; await shot(A, 'netz-A'); await shot(B, 'netz-B'); }
        await A.waitForTimeout(25);
      }
      console.log('(c) Netz: Aktionen', acts, 'Vergleiche', checks, 'Abweichungen', diffs, 'Leck-Prüfungen', stats.leakChecks);
      if (diffs) errors.push('Netz: Zustände weichen ab ' + diffs);
      if (checks < 10) errors.push('Netz: zu wenige Vergleiche');
      await A.waitForSelector('.mg-over', { timeout: 10000 }); await B.waitForSelector('.mg-over', { timeout: 10000 });
      const ha = norm(await A.textContent('.mg-over h1')); const hb = norm(await B.textContent('.mg-over h1'));
      console.log('(c) Ergebnis:', ha, '|', hb);
      await shot(A, 'netz-ende-host'); await shot(B, 'netz-ende-gast');
      if (await B.locator('[data-act=next],[data-act=again]').count()) errors.push('Gast sieht Neue-Runde-Knopf');
      if (!(await A.locator('[data-act=next]').count())) errors.push('Host sieht keinen Nächste-Runde-Knopf');
      await A.click('[data-act=next]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      const gr = await readGame(A);
      if (gr.round !== 2 || gr.players.reduce((s, p) => s + p.wins, 0) !== 1) errors.push('Netz: Runde 2 / Spielstand falsch');
      await A.click('[data-act=help]');
      await A.waitForSelector('.modal');
      const helpTxt = await A.textContent('.modal');
      for (const w of ['52 Karten', 'Glauben', 'Mogler', 'Stapel', 'verdeckt']) if (!helpTxt.includes(w)) errors.push('Hilfetext ohne ' + w);
      await shot(A, 'hilfe');
      await ctx.close();
    }

    // ---------- (d) Layout 390x844 (2, 4, 6 Personen, große Schrift), Desktop ----------
    for (const [n, lab, big] of [[1, 'd2', false], [3, 'd4', false], [5, 'd6', false], [2, 'd3gross', true]]) {
      const { ctx, page } = await startBot(browser, n, 1, lab, undefined, { big });
      const bt = []; const bh = [];
      const t0 = Date.now(); let k = 0;
      while (Date.now() - t0 < 50000 && !(await page.locator('.mg-over').count())) {
        const bp = await pos(page, '#board');
        if (bp) { bt.push(bp.top); bh.push(bp.h); }
        if (k++ % 4 === 0) await layoutCheck(page, lab);
        if (k === 14) await shot(page, lab + '-spiel');
        await humanStep(page);
        await page.waitForTimeout(15);
      }
      const spread = Math.max(...bt) - Math.min(...bt);
      const spreadH = Math.max(...bh) - Math.min(...bh);
      console.log(`(d) ${lab}: Messpunkte`, bt.length, 'Brett-Top-Streuung', spread, 'px, Höhen-Streuung', spreadH, 'px');
      if (spread > 1) errors.push(`${lab}: Brett-Position schwankt (${spread}px)`);
      if (spreadH > 1) errors.push(`${lab}: Brett-Höhe schwankt (${spreadH}px)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await startBot(browser, 3, 0, 'pc', { w: 1280, h: 900 });
      await page.waitForTimeout(400);
      for (let i = 0; i < 10; i++) { await humanStep(page); await page.waitForTimeout(40); }
      await shot(page, 'pc-spiel');
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log('Statistik', JSON.stringify(stats));
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('MOGELN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
