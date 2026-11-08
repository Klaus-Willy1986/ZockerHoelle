// Durchspieltest für Dunkle Rätsel (Playwright, Chromium): Rätselbuch (allein), Lernrunde, Gruppe online
// (Gastgeber + Gast über das Mock-Netz), Gruppe an einem Gerät, Layout bei 390x844.
// Start:  NODE_PATH=$(npm root -g) node tests/dunkel.e2e.cjs
// Der Test startet selbst einen Static-Server (python3 -m http.server) auf Port 8986.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8986;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/dunkel/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `dr_${name}.png`), fullPage: full });

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    const Orig = window.BroadcastChannel;
    window.BroadcastChannel = function (name) {
      const ch = new Orig(name);
      ch.addEventListener('message', (ev) => { const m = ev.data; if (m && m.kind === 'data' && m.d && m.d.t === 'state') window.__lastState = JSON.stringify(m.d.game); });
      return ch;
    };
    window.BroadcastChannel.prototype = Orig.prototype;
  });
  return ctx;
}
async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fail(`${name} console ${m.type()} ${m.text()}`); });
  return page;
}
const hostState = async (page) => JSON.parse(await page.evaluate(() => sessionStorage.getItem('zh.dr.hostState') || localStorage.getItem('zh.dr.hostState'))).game;
const text = async (page) => ((await page.textContent('body')) || '').replace(/\s+/g, ' ');
async function overflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
}
async function smallButtons(page, label) {
  const small = await page.$$eval('button, a.btn', (els) => els
    .filter((b) => b.offsetParent && !b.closest('.topbtns') && !b.closest('.coach'))
    .map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act || b.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.h < 48 || x.w < 48));
  if (small.length) fail(`${label}: zu kleine Knöpfe ${JSON.stringify(small)}`);
}
const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); const r = b.getBoundingClientRect(); return { t: Math.round(r.top + scrollY), h: Math.round(r.height) }; });
async function same(host, guest, label) {
  for (let t = 0; t < 40; t++) {
    const h = JSON.stringify(await hostState(host));
    const g = await guest.evaluate(() => window.__lastState);
    if (h === g) return JSON.parse(h);
    await host.waitForTimeout(50);
  }
  fail(`${label}: Zustand bei Gastgeber und Gast verschieden`);
  return hostState(host);
}
const startServer = async () => {
  const up = () => new Promise((res) => { http.get(`http://localhost:${PORT}/dunkel/index.html`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); });
  if (await up()) return null;
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  return p;
};

// ================================================================ (a) Rätselbuch (allein)
async function bookRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'buch');
  await page.goto(base + '?seed=3');
  await page.fill('#name', 'Tina');
  await page.check('[data-opt=kurz]');
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  let st = await hostState(page);
  if (st.mode !== 'book' || st.len !== 3) fail(`Buch: Modus/Länge ${st.mode}/${st.len}`);
  const expect = [3, 2, 1];
  let total = 0;
  for (let i = 0; i < 3; i++) {
    st = await hostState(page);
    const r = st.rs[st.ri];
    const story = ((await page.textContent('#board .dr-text')) || '').trim();
    if (story !== r.geschichte) fail('Geschichte falsch angezeigt');
    if ((await text(page)).includes(r.loesung)) fail('Lösung steht vor dem Zeigen im DOM');
    if (!(await page.$('.dr-hints'))) fail('Hinweisbereich fehlt');
    // Hinweise stufenweise (0, 1, 2 Hinweise; beim dritten Rätsel danach ein dritter, dann ist der Knopf aus)
    for (let h = 1; h <= i; h++) {
      const lab = ((await page.textContent('[data-act=hint]')) || '').trim();
      if (!lab.includes(`Hinweis ${h}`)) fail(`Hinweisknopf "${lab}" statt Hinweis ${h}`);
      await page.click('[data-act=hint]');
      const body = await text(page);
      if (!body.includes(r.hinweise[h - 1])) fail('Hinweis nicht sichtbar');
      if (h < 3 && body.includes(r.hinweise[h])) fail('Folgehinweis schon sichtbar');
    }
    if (i === 2) {
      await page.click('[data-act=hint]');
      if (!(await page.$eval('[data-act=hint]', (b) => b.disabled))) fail('Hinweisknopf nach 3 Hinweisen noch aktiv');
    }
    if (i === 1) await shot(page, 'buch_hint', false);
    await page.click('[data-act=reveal]');
    await page.waitForSelector('[data-act=rate]');
    if (!(await text(page)).includes(r.loesung)) fail('Lösung nach Zeigen nicht sichtbar');
    if (await page.$('[data-act=next]')) fail('Weiter vor der Selbsteinschätzung');
    if (i === 0) await shot(page, 'buch_loesung', false);
    await page.click('[data-act=rate][data-v=ja]');
    await page.waitForSelector('[data-act=next]');
    total += expect[i];
    st = await hostState(page);
    if (st.scores[st.players[0].id] !== total) fail(`Buch: Punkte ${st.scores[st.players[0].id]} statt ${total}`);
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.dr-over');
  const h1 = ((await page.textContent('.dr-over h1')) || '').trim();
  if (!h1.includes(`${total} Punkte`)) fail(`Ende: Titel "${h1}"`);
  const solved = await page.evaluate(() => localStorage.getItem('zh.dr_solved'));
  if (solved !== '3') fail(`Statistik Gelöst: ${solved}`);
  await shot(page, 'buch_ende', false);
  console.log(`Rätselbuch: 3 Rätsel mit 0/1/2 Hinweisen, Punkte ${total}, Statistik "Gelöst" ${solved}`);
  // Neue Runde: Statistik sichtbar
  await page.click('[data-act=again]');
  await page.waitForSelector('#dr-stat');
  if ((await page.textContent('#dr-stat')).trim() !== '3') fail('Statistik im Spiel nicht angezeigt');
  // Vorlesen-Knopf
  if (await page.$('[data-act=read]')) await page.click('[data-act=read]');
  await ctx.close();
}

// ================================================================ (b) Lernrunde
async function learnRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lernen');
  await page.goto(base + '?seed=4');
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const seen = new Set();
  const note = async () => seen.add(((await page.textContent('.coach-t')) || '').trim());
  await note();
  for (let k = 0; k < 4; k++) {
    const want = ['lask', 'lask', 'hint', 'lguess-open'][k];
    if (!(await page.$(`.coach-target[data-act=${want}]`))) fail(`Coach markiert vor Frage ${k + 1} nicht ${want}`);
    await page.click(`[data-act=lask][data-k="${k}"]`);
    await note();
  }
  const logTxt = await page.textContent('.dr-log');
  for (const w of ['Ist der Mann krank?', 'Nein', 'Egal', 'Ja', 'Fast!']) if (!logTxt.includes(w)) fail('Protokoll ohne ' + w);
  await page.click('[data-act=hint]'); await note();
  await page.click('[data-act=lguess-open]'); await note();
  await page.click('[data-act=lguess][data-k="0"]'); await note();
  await page.click('[data-act=lguess-open]');
  await page.click('[data-act=lguess][data-k="2"]');
  await page.waitForSelector('[data-act=next]'); await note();
  await shot(page, 'lern_gelöst', false);
  const st = await hostState(page);
  if (st.scores[st.players[0].id] !== 2) fail('Lernrunde Punkte ' + st.scores[st.players[0].id]);
  await page.click('[data-act=next]');
  await page.waitForSelector('.dr-over'); await note();
  console.log(`Lernrunde: ${seen.size} verschiedene Erklärungen, Ende erreicht`);
  if (seen.size < 8) fail('Zu wenige Erklärungen: ' + seen.size);
  await ctx.close();
}

// ================================================================ (c) Gruppe online (Mock)
async function duoRun(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A');
  await A.goto(base + '?mock=1&seed=5');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = ((await A.textContent('.code')) || '').trim();
  const B = await newPage(ctx, 'B');
  await B.goto(base + `?mock=1&raum=${room}&seed=9`);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await shot(A, 'lobby_A', false);
  await A.check('[data-opt=kurz]');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  let st = await same(A, B, 'Start');
  if (st.mode !== 'group' || st.len !== 3 || st.players.length !== 2) fail(`Gruppe: ${st.mode}/${st.len}/${st.players.length}`);
  const [pa, pb] = st.players.map((p) => p.id);

  // Runde 1: Anna ist Spielleiterin
  let r = st.rs[0];
  if ((await text(B)).includes(r.loesung) || (await text(A)).includes(r.loesung)) fail('Lösung vor "Lösung ansehen" im DOM');
  if (!(await A.$('[data-act=peek]')) || (await B.$('[data-act=peek]'))) fail('Lösung-ansehen-Knopf nur beim Spielleiter erwartet');
  if (await B.$('[data-act=answer]') || await B.$('[data-act=judge]') || await B.$('[data-act=hint]')) fail('Gast sieht Spielleiter-Knöpfe');
  if (await A.$('#dr-in')) fail('Spielleiter sieht Eingabefeld');
  if (!(await A.$('.banner.mine'))) fail('Banner Spielleiter nicht grün');
  await A.click('[data-act=peek]');
  if (!(await text(A)).includes(r.loesung)) fail('Spielleiter sieht Lösung nach Klick nicht');
  if ((await text(B)).includes(r.loesung)) fail('Gast sieht Lösung nach Klick des Spielleiters');
  await shot(A, 'duo_A_peek', false);
  await A.click('[data-act=peek]');
  if ((await text(A)).includes(r.loesung)) fail('Lösung nach Verstecken noch im DOM');

  // Frage stellen: Anna kann sie noch nicht beantworten, Bernd kann sie tippen (Enter)
  await B.fill('#dr-in', 'Ist der Mann krank?');
  await B.press('#dr-in', 'Enter');
  await A.waitForFunction(() => /Ist der Mann krank\?/.test(document.querySelector('.dr-who')?.textContent || ''));
  await B.waitForFunction(() => /Ist der Mann krank\?/.test(document.querySelector('.dr-log')?.textContent || ''));
  if ((await B.inputValue('#dr-in')) !== '') fail('Eingabefeld nach Senden nicht leer');
  const banA = ((await A.textContent('.banner')) || '').trim();
  if (!/1 Frage wartet/.test(banA)) fail(`Banner Spielleiter "${banA}"`);
  await shot(A, 'duo_A_frage', false); await shot(B, 'duo_B_frage', false);
  await A.click('[data-act=answer][data-v=fast]');
  await B.waitForFunction(() => /Fast!/.test(document.querySelector('.dr-log')?.textContent || ''));
  st = await same(A, B, 'beantwortet');
  if (st.log[0].a !== 'fast') fail('Antwort nicht im Zustand');
  // Zweite Frage, alle fünf Antworten durchprobieren
  for (const [v, lab] of [['ja', 'Ja'], ['nein', 'Nein'], ['egal', 'Egal'], ['anders', 'Anders fragen']]) {
    await B.fill('#dr-in', `Frage zu ${lab}?`);
    await B.click('[data-act=send]');
    await A.waitForFunction((t) => (document.querySelector('.dr-who')?.textContent || '').includes(t), `Frage zu ${lab}?`);
    await A.click(`[data-act=answer][data-v=${v}]`);
    await B.waitForFunction((l) => [...document.querySelectorAll('.dr-log .dr-ans')].some((e) => e.textContent.trim() === l), lab);
  }
  // Hinweis freigeben (1)
  await A.click('[data-act=hint]');
  await B.waitForFunction((t) => (document.querySelector('.dr-log')?.textContent || '').includes(t), r.hinweise[0]);
  if ((await text(B)).includes(r.hinweise[1])) fail('Hinweis 2 schon beim Gast sichtbar');
  // Falscher Versuch (Fast), dann richtiger
  await B.click('[data-act=tab][data-m=guess]');
  await B.fill('#dr-in', 'Er ist kahl');
  await B.click('[data-act=send]');
  await A.waitForSelector('[data-act=judge]');
  if (!/Er ist kahl/.test(await A.textContent('.dr-ctl'))) fail('Lösungsversuch nicht beim Spielleiter');
  await B.waitForFunction(() => /wird geprüft/.test(document.querySelector('.dr-log')?.textContent || ''));
  const banB = ((await B.textContent('.banner')) || '').trim();
  if (!/Du rätst/.test(banB)) fail(`Banner Gast "${banB}"`);
  await shot(A, 'duo_A_raten', false);
  await A.click('[data-act=judge][data-v=fast]');
  await B.waitForFunction(() => /Fast/.test([...document.querySelectorAll('.dr-log .v-fast')].map((e) => e.textContent).join('')));
  await B.fill('#dr-in', 'Er hat keine Haare');
  await B.click('[data-act=send]');
  await A.waitForSelector('[data-act=judge]');
  if ((await A.$$('[data-act=judge]')).length !== 3) fail('Bewertungsknöpfe');
  await A.click('[data-act=judge][data-v=richtig]');
  await A.waitForSelector('.dr-res'); await B.waitForSelector('.dr-res');
  st = await same(A, B, 'gelöst');
  if (st.scores[pb] !== 2 || st.scores[pa] !== 0) fail(`Punkte nach Runde 1: ${JSON.stringify(st.scores)} (erwartet Bernd 2)`);
  for (const [p, nm] of [[A, 'Spielleiter'], [B, 'Gast']]) {
    if (!(await text(p)).includes(r.loesung)) fail(`${nm} sieht nach der Lösung den Text nicht`);
  }
  const bnB = ((await B.textContent('.banner')) || '').trim();
  if (!/Du hast es gelöst/.test(bnB)) fail(`Banner Gewinner "${bnB}"`);
  if (await B.$('[data-act=next]')) fail('Gast sieht Weiter');
  if (!(await A.$('[data-act=next]'))) fail('Spielleiter ohne Weiter');
  await shot(A, 'duo_A_geloest'); await shot(B, 'duo_B_geloest');
  await A.click('[data-act=next]');

  // Runde 2: Bernd ist Spielleiter, Anna fragt und rät
  await B.waitForSelector('[data-act=peek]'); await A.waitForSelector('#dr-in');
  st = await same(A, B, 'Runde 2');
  r = st.rs[1];
  if (st.ri !== 1) fail('Runde 2 nicht erreicht');
  if ((await text(A)).includes(r.loesung) || (await text(B)).includes(r.loesung)) fail('Runde 2: Lösung im DOM');
  await B.click('[data-act=peek]');
  if (!(await text(B)).includes(r.loesung)) fail('Neuer Spielleiter sieht Lösung nicht');
  if ((await text(A)).includes(r.loesung)) fail('Runde 2: Anna sieht die Lösung');
  // Anna rät sofort (ohne Hinweis): 3 Punkte
  await A.click('[data-act=tab][data-m=guess]');
  await A.fill('#dr-in', 'irgendwas');
  await A.click('[data-act=send]');
  await B.waitForSelector('[data-act=judge]');
  await B.click('[data-act=judge][data-v=richtig]');
  await A.waitForSelector('.dr-res');
  st = await same(A, B, 'Runde 2 gelöst');
  if (st.scores[pa] !== 3 || st.scores[pb] !== 2) fail(`Punkte Runde 2: ${JSON.stringify(st.scores)}`);
  // Runde 3: Anna Leiterin, Bernd gibt auf (Gast kann nicht), Leiterin löst auf
  await B.waitForSelector('[data-act=next]', { state: 'detached' }).catch(() => {});
  await A.click('[data-act=next]');
  await A.waitForSelector('[data-act=peek]');
  await A.click('[data-act=giveup]');
  await A.waitForSelector('.dr-res');
  st = await same(A, B, 'Runde 3 aufgelöst');
  if (st.solvedBy !== null || st.scores[pa] !== 3 || st.scores[pb] !== 2) fail('Auflösen vergibt Punkte');
  await A.click('[data-act=next]');
  await A.waitForSelector('.dr-over'); await B.waitForSelector('.dr-over');
  st = await same(A, B, 'Ende');
  const ra = (await A.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  const rb = (await B.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  if (ra !== rb) fail(`Rangliste verschieden ${ra} / ${rb}`);
  if (!/Anna/.test(await A.textContent('.dr-over h1')) && !/Du/.test(await A.textContent('.dr-over h1'))) fail('Titel nennt Siegerin nicht');
  if (!(await A.$('[data-act=again]')) || (await B.$('[data-act=again]'))) fail('again nur für den Gastgeber');
  await shot(A, 'duo_A_ende'); await shot(B, 'duo_B_ende');
  console.log(`Gruppe online: Zustände identisch, Lösung nie im Gast-DOM, Punkte Anna ${st.scores[pa]} / Bernd ${st.scores[pb]}, Spielleiterwechsel ok`);
  // Gast lädt neu im Endzustand
  await B.reload(); await B.waitForSelector('.dr-over', { timeout: 10000 });
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  st = await same(A, B, 'neue Runde');
  if (st.ri !== 0 || st.phase !== 'play' || st.scores[pa] !== 0) fail('Neue Runde nicht frisch');
  if (Q_leader(st) !== pb) fail('In der zweiten Partie sollte der Spielleiter wechseln (Reihenfolge der Lobby)');
  await ctx.close();
}
const Q_leader = (g) => g.players[g.ri % g.players.length].id;

// ================================================================ (d) Gruppe an einem Gerät
async function localRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'raum');
  await page.goto(base + '?seed=6');
  await page.fill('#name', 'Hanna');
  await page.check('[data-opt=raum]');
  await page.check('[data-opt=kurz]');
  await page.click('[data-act=solo]');
  await page.waitForSelector('[data-act=addlocal]');
  if (!(await page.$eval('[data-act=startlocal]', (b) => b.disabled))) fail('Start ohne Mitspieler möglich');
  await page.fill('#dr-name', 'Ida'); await page.press('#dr-name', 'Enter');
  await page.fill('#dr-name', 'Jonas'); await page.click('[data-act=addlocal]');
  await page.waitForFunction(() => document.querySelectorAll('.dr-names li').length === 3);
  await shot(page, 'raum_setup', false);
  await page.click('[data-act=startlocal]');
  await page.waitForSelector('[data-act=say]');
  let st = await hostState(page);
  if (st.mode !== 'local' || st.players.length !== 3) fail('Lokal: Spieler');
  await page.click('[data-act=say][data-v=ja]');
  if (!/Frage aus der Runde/.test(await page.textContent('.dr-log'))) fail('laute Frage nicht im Protokoll');
  await page.click('[data-act=lguess-by][data-id=l2]');
  await page.waitForSelector('[data-act=judge]');
  await shot(page, 'raum_raten', false);
  await page.click('[data-act=judge][data-v=richtig]');
  await page.waitForSelector('.dr-res');
  st = await hostState(page);
  if (st.scores.l2 !== 3) fail(`Lokal: Punkte Jonas ${st.scores.l2}`);
  await page.click('[data-act=next]');
  await page.waitForSelector('[data-act=peek]');
  const bn = ((await page.textContent('.banner')) || '').trim();
  if (!/Ida/.test(bn)) fail(`Lokal: neue Spielleitung "${bn}"`);
  for (let i = 0; i < 2; i++) { await page.click('[data-act=giveup]'); await page.waitForSelector('.dr-res'); await page.click('[data-act=next]'); }
  await page.waitForSelector('.dr-over');
  console.log('Gruppe an einem Gerät: Namen, laute Frage, Raten, Bewertung, Wechsel, Ende');
  await ctx.close();
}

// ================================================================ (e) Layout 390x844
async function layoutRun(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'LA');
  await A.goto(base + '?mock=1&seed=11');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = ((await A.textContent('.code')) || '').trim();
  const B = await newPage(ctx, 'LB');
  await B.goto(base + `?mock=1&raum=${room}&seed=12`);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await overflow(A, 'Lobby'); await smallButtons(A, 'Lobby A');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const ta = await boardTop(A); const tb = await boardTop(B);
  const logH = (p) => p.$eval('.dr-log', (e) => e.getBoundingClientRect().height);
  const la = await logH(A); const lb = await logH(B);
  // viele Nachrichten: nichts springt, Protokoll scrollt in sich
  for (let i = 0; i < 30; i++) {
    await B.fill('#dr-in', `Nummer ${i} ist eine ziemlich lange Frage zum Rätsel, die umbricht?`);
    await B.click('[data-act=send]');
    await A.waitForFunction((n) => (document.querySelector('.dr-who')?.textContent || '').includes(`Nummer ${n} `), i);
    if (i % 3 === 0) await A.click('[data-act=answer][data-v=ja]');
    else await A.click('[data-act=answer][data-v=nein]');
    await B.waitForFunction((n) => (document.querySelector('.dr-log')?.textContent || '').includes(`Nummer ${n} `) && !/wartet/.test(document.querySelector('.dr-log li:last-child')?.textContent || ''), i);
    if (i === 0 || i === 14 || i === 29) {
      for (const [p, nm, t0, l0] of [[A, 'A', ta, la], [B, 'B', tb, lb]]) {
        const t = await boardTop(p);
        if (t.t !== t0.t || t.h !== t0.h) fail(`${nm}: Geschichte verschoben/verändert bei Nachricht ${i}: ${JSON.stringify(t)} vs ${JSON.stringify(t0)}`);
        const lh = await logH(p);
        if (Math.abs(lh - l0) > 1) fail(`${nm}: Protokollhöhe ${lh} statt ${l0}`);
        await overflow(p, `Layout ${nm} Nachricht ${i}`);
      }
    }
  }
  const sc = await B.$eval('.dr-log', (e) => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight, ch: e.clientHeight, sh: e.scrollHeight }));
  if (sc.sh <= sc.ch) fail('Protokoll wächst statt zu scrollen');
  if (sc.max - sc.top > 40) fail(`Protokoll scrollt nicht nach unten (${sc.top}/${sc.max})`);
  // Eingabezeile bleibt unten sichtbar (angeheftet), auch wenn die Seite gescrollt ist
  await B.evaluate(() => window.scrollTo(0, 0));
  const inpPos = await B.$eval('.dr-input', (e) => { const r = e.getBoundingClientRect(); return { b: Math.round(r.bottom), ih: innerHeight }; });
  if (inpPos.b > inpPos.ih + 1 || inpPos.b < inpPos.ih - 40) fail(`Eingabezeile nicht unten fest: ${JSON.stringify(inpPos)}`);
  // Hinweis, Raten: Geschichte bleibt
  await A.click('[data-act=hint]');
  await B.click('[data-act=tab][data-m=guess]');
  await B.fill('#dr-in', 'test'); await B.click('[data-act=send]');
  await A.waitForSelector('[data-act=judge]');
  for (const [p, nm, t0] of [[A, 'A', ta], [B, 'B', tb]]) {
    const t = await boardTop(p);
    if (t.t !== t0.t || t.h !== t0.h) fail(`${nm}: Geschichte verschoben nach Hinweis/Raten`);
    await overflow(p, `Layout ${nm}`); await smallButtons(p, `Layout ${nm}`);
  }
  await shot(A, 'layout_A_voll', false); await shot(B, 'layout_B_voll', false);
  // Eingabe bleibt beim Neuzeichnen erhalten (Spielleiter antwortet währenddessen auf nichts: wir tippen und lassen einen Hinweis kommen)
  await A.click('[data-act=judge][data-v=falsch]');
  await B.click('[data-act=tab][data-m=ask]');
  await B.fill('#dr-in', 'halb getippt');
  await B.focus('#dr-in');
  await A.click('[data-act=hint]');
  await B.waitForFunction(() => /Hinweis 2/.test(document.querySelector('.dr-log')?.textContent || ''));
  if ((await B.inputValue('#dr-in')) !== 'halb getippt') fail('Eingabe ging beim Neuzeichnen verloren');
  if (!(await B.evaluate(() => document.activeElement && document.activeElement.id === 'dr-in'))) fail('Fokus ging beim Neuzeichnen verloren');
  // Desktop-Ansicht
  const ctx2 = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
  const D = await newPage(ctx2, 'desktop');
  await D.goto(base + '?seed=2');
  await D.fill('#name', 'Dora');
  await D.click('[data-act=solo]');
  await D.waitForSelector('#board');
  await overflow(D, 'Desktop');
  await shot(D, 'desktop', false);
  // Hilfe
  await D.click('[data-act=help]');
  await D.waitForSelector('.modal');
  const t = await D.textContent('.modal');
  for (const w of ['Rätselbuch', 'Spielleitung', 'Ja', 'Egal', 'Fast!', 'Anders fragen', 'Lernrunde']) if (!t.includes(w)) fail('Hilfe ohne ' + w);
  await ctx2.close();
  console.log(`Layout 390x844: Geschichte fest bei ${JSON.stringify(ta)}, Protokoll ${la}px hoch und scrollt in sich, Eingabezeile unten fest`);
  await ctx.close();
}

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    await bookRun(browser);
    await learnRun(browser);
    await duoRun(browser);
    await localRun(browser);
    await layoutRun(browser);
  } catch (e) { fail('Ausnahme: ' + (e && e.stack || e)); }
  await browser.close();
  if (srv) srv.kill();
  else { try { execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`); } catch { /* egal */ } }
  console.log(errors.length ? `\n${errors.length} FEHLER` : '\nALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
