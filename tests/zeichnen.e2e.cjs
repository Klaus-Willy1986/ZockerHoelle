// Durchspieltest für Zeichenraten (Playwright, Chromium): online (Gastgeber zeichnet, Gast sieht und rät, danach Wechsel),
// Zeit und Hinweise, Optionen, selber Raum (ein Gerät), Lernrunde, Layout 390x844.
// Start:  NODE_PATH=$(npm root -g) node tests/zeichnen.e2e.cjs
// Der Test startet selbst einen Static-Server (python3 -m http.server) auf Port 8995.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8995;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/zeichnen/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `zr_${name}.png`), fullPage: full });

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((fast) => {
    const Orig = window.BroadcastChannel;
    window.BroadcastChannel = function (name) {
      const ch = new Orig(name);
      ch.addEventListener('message', (ev) => { const m = ev.data; if (m && m.kind === 'data' && m.d && m.d.t === 'state') window.__lastState = JSON.stringify(m.d.game); });
      return ch;
    };
    window.BroadcastChannel.prototype = Orig.prototype;
    if (fast) { // Lernrunde: der Computer wartet 5 s -> 20 ms und 6 s -> 1,5 s
      const st = window.setTimeout;
      window.setTimeout = (fn, ms, ...a) => st(fn, ms === 5000 ? 20 : ms === 6000 ? 1500 : ms, ...a);
    }
  }, !!opts.fast);
  return ctx;
}
async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fail(`${name} console ${m.type()} ${m.text()}`); });
  return page;
}
const hostState = async (page) => JSON.parse(await page.evaluate(() => sessionStorage.getItem('zh.zr.hostState') || localStorage.getItem('zh.zr.hostState'))).game;
const text = async (page) => ((await page.textContent('body')) || '').replace(/\s+/g, ' ');
const has = (t, w) => t.toLowerCase().includes(String(w).toLowerCase());
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
const boardBox = (page) => page.evaluate(() => { const b = document.getElementById('board'); const r = b.getBoundingClientRect(); return { t: Math.round(r.top + scrollY), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; });
async function same(host, guest, label) {
  for (let t = 0; t < 60; t++) {
    const h = JSON.stringify(await hostState(host));
    const g = await guest.evaluate(() => window.__lastState);
    if (h === g) return JSON.parse(h);
    await host.waitForTimeout(50);
  }
  fail(`${label}: Zustand bei Gastgeber und Gast verschieden`);
  return hostState(host);
}
const strokesShown = (page) => page.evaluate(() => Number(document.getElementById('zr-canvas')?.dataset.strokes || -1));
const inked = (page) => page.evaluate(() => {
  const c = document.getElementById('zr-canvas'); if (!c) return -1;
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) n++;
  return n;
});
// Mit der Maus einen Strich malen (Punkte als Anteile 0..1 der Fläche)
async function stroke(page, pts) {
  await page.evaluate(() => document.getElementById('board').scrollIntoView({ block: 'center' }));
  const box = await page.locator('#zr-canvas').boundingBox();
  const at = ([x, y]) => [box.x + x * box.width, box.y + y * box.height];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps: 6 });
  await page.mouse.up();
}
const ZIG = [[0.1, 0.2], [0.3, 0.8], [0.5, 0.2], [0.7, 0.8], [0.9, 0.2]];
const startServer = async () => {
  const up = () => new Promise((res) => { http.get(`http://localhost:${PORT}/zeichnen/index.html`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); });
  if (await up()) return null;
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  return p;
};
async function hostGuest(browser, { opts = [], hostQuery = '', guestQuery = '', viewport } = {}) {
  const ctx = await newCtx(browser, { viewport });
  const A = await newPage(ctx, 'A');
  await A.goto(base + `?mock=1&seed=5${hostQuery}`);
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = ((await A.textContent('.code')) || '').trim();
  const B = await newPage(ctx, 'B');
  await B.goto(base + `?mock=1&raum=${room}&seed=9${guestQuery}`);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  for (const o of opts) await A.check(`[data-opt=${o}]`);
  return { ctx, A, B };
}

// ================================================================ (a) online: zeichnen, sehen, raten, wechseln
async function duoRun(browser) {
  const { ctx, A, B } = await hostGuest(browser, { opts: ['long'] });
  await shot(A, 'lobby_A');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  let st = await same(A, B, 'Start');
  if (st.mode !== 'online' || st.len !== 2 || st.limit !== 150000) fail(`Start: ${st.mode}/${st.len}/${st.limit}`);
  const [pa, pb] = st.players.map((p) => p.id);
  const w1 = st.word.w;
  let gain1 = 0;
  if (Q_drawer(st) !== pa) fail('Anna sollte zuerst zeichnen');
  // Wer sieht was
  if (!has(await text(A), w1)) fail('Zeichner sieht seinen Begriff nicht');
  if (has(await text(B), w1)) fail('Begriff steht im Gast-DOM');
  if (!(await A.$('.zr-tools')) || (await B.$('.zr-tools'))) fail('Werkzeugleiste nur beim Zeichner erwartet');
  if (await A.$('#zr-in') || !(await B.$('#zr-in'))) fail('Eingabefeld nur bei den Ratenden erwartet');
  const mask = ((await B.textContent('.zr-mask')) || '').trim();
  if (mask.replace(/ /g, '') !== '_'.repeat(w1.replace(/ /g, '').length)) fail(`Maske "${mask}" passt nicht zu ${w1}`);
  if (!(await A.$('.banner.mine'))) fail('Banner Zeichner nicht grün');
  if ((await A.evaluate(() => getComputedStyle(document.getElementById('zr-canvas')).touchAction)) !== 'none') fail('touch-action nicht none');
  if ((await A.$$('.zr-sw[data-act=color]')).length !== 6) fail('6 Farben erwartet');
  if ((await A.$$('.zr-br')).length !== 3) fail('3 Pinselgrößen erwartet');
  for (const a of ['tool-e', 'undo', 'clear']) if (!(await A.$(`[data-act=${a}]`))) fail('Knopf fehlt: ' + a);
  await shot(A, 'duo_A_start'); await shot(B, 'duo_B_start');

  // Strich 1 (schwarz, mittel), Strich 2 (rot, groß), Strich 3 (Radierer klein) mit der Maus
  await stroke(A, ZIG);
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 1);
  await A.click('[data-act=color][data-i="1"]'); await A.click('[data-act=brush][data-i="2"]');
  await stroke(A, [[0.2, 0.5], [0.8, 0.5]]);
  await A.click('[data-act=tool-e]'); await A.click('[data-act=brush][data-i="0"]');
  await stroke(A, [[0.5, 0.1], [0.5, 0.9]]);
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 3);
  st = await same(A, B, 'drei Striche');
  if (st.strokes.length !== 3) fail(`Zustand: ${st.strokes.length} Striche statt 3`);
  if (JSON.stringify(st.strokes.map((s) => [s.c, s.w])) !== '[[0,1],[1,2],[6,0]]') fail('Farben/Größen im Zustand: ' + JSON.stringify(st.strokes.map((s) => [s.c, s.w])));
  if (st.strokes.some((s) => s.p.some(([x, y]) => !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 1000 || y < 0 || y > 1000))) fail('Punkte nicht ganzzahlig in 0..1000');
  const sa = await strokesShown(A); const sb = await strokesShown(B);
  if (sa !== 3 || sb !== 3) fail(`Strichanzahl A ${sa} / B ${sb}`);
  const ia = await inked(A); const ib = await inked(B);
  if (ia < 500 || ib < 500) fail(`Fläche leer? Tintenpunkte A ${ia} / B ${ib}`);
  if (Math.abs(ia - ib) > Math.max(400, ia * 0.12)) fail(`Zeichnung bei A und B verschieden (${ia} / ${ib})`);
  await shot(A, 'duo_A_gemalt'); await shot(B, 'duo_B_gemalt');
  // Berührung (Touch-Pointer-Ereignisse) auf der Fläche
  await A.evaluate(() => {
    const c = document.getElementById('zr-canvas'); const r = c.getBoundingClientRect();
    const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', 0.1, 0.1); ev('pointermove', 0.15, 0.2); ev('pointermove', 0.25, 0.3); ev('pointerup', 0.3, 0.35);
  });
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 4);
  // Rückgängig und Alles löschen
  await A.click('[data-act=undo]');
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 3);
  await A.click('[data-act=clear]');
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 0);
  if ((await strokesShown(A)) !== 0 || (await inked(B)) !== 0) fail('Löschen: Fläche nicht leer');
  await stroke(A, [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7], [0.3, 0.3]]);
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 1);
  if (has(await text(B), w1)) fail('Begriff im Gast-DOM nach dem Zeichnen');

  // Raten: falsch -> Chat-Zeile bei beiden; Enter-Taste
  await B.fill('#zr-in', 'Quatschwort');
  await B.press('#zr-in', 'Enter');
  await A.waitForFunction(() => /Bernd rät: Quatschwort/.test(document.querySelector('.zr-chat')?.textContent || ''));
  await B.waitForFunction(() => /Bernd rät: Quatschwort/.test(document.querySelector('.zr-chat')?.textContent || ''));
  if ((await B.inputValue('#zr-in')) !== '') fail('Eingabefeld nach Raten nicht leer');
  if (!(await B.evaluate(() => document.activeElement && document.activeElement.id === 'zr-in'))) fail('Fokus nach Raten verloren');
  if (has(await text(B), w1)) fail('Begriff im Gast-DOM nach falschem Raten');
  // Richtig raten (Kleinschreibung, Knopf "Raten"): Wortlaut darf nicht im Chat stehen
  await B.fill('#zr-in', w1.toLowerCase());
  await B.click('[data-act=guess]');
  await A.waitForSelector('.zr-res'); await B.waitForSelector('.zr-res');
  st = await same(A, B, 'erraten');
  const chatA = (await A.textContent('.zr-chat').catch(() => '')) || '';
  if (st.phase !== 'result' || st.reason !== 'all') fail(`Phase ${st.phase}/${st.reason}`);
  if (st.gains[pb] < 10 || st.gains[pb] > 27) fail(`Punkte Bernd ${st.gains[pb]}`);
  if (st.scores[pb] !== st.gains[pb] || st.scores[pa] !== 5) fail(`Punkte: ${JSON.stringify(st.scores)}`);
  if (st.chat[st.chat.length - 1].text !== undefined) fail('Richtige Antwort steht im Chat-Zustand');
  gain1 = st.gains[pb];
  const resB = await text(B);
  if (!has(resB, `Das Wort war: ${w1}`)) fail('Auflösung "Das Wort war" fehlt bei B');
  if (!has(await text(A), `Das Wort war: ${w1}`)) fail('Auflösung "Das Wort war" fehlt bei A');
  if (!/Bernd[^+]*\+\d+/.test(await A.textContent('.zr-list'))) fail('Auflösung ohne Punkte für Bernd');
  if (await B.$('[data-act=next]') || !(await A.$('[data-act=next]'))) fail('Weiter nur für den Gastgeber');
  if (!/Du hast es erraten|Auflösung/.test((await B.textContent('.banner')) || '')) fail('Banner nach Auflösung');
  await shot(A, 'duo_A_aufloesung'); await shot(B, 'duo_B_aufloesung');
  const bc = await boardBox(B);

  // Runde 2: Bernd zeichnet, Anna rät mit Umlaut-/Tippfehler-Schreibweise
  await A.click('[data-act=next]');
  await B.waitForSelector('.zr-tools'); await A.waitForSelector('#zr-in');
  st = await same(A, B, 'Runde 2');
  const w2 = st.word.w;
  if (st.ri !== 1 || Q_drawer(st) !== pb) fail('Zeichner-Wechsel fehlt');
  if (has(await text(A), w2)) fail('Runde 2: Begriff im DOM des Ratenden');
  if (!has(await text(B), w2)) fail('Runde 2: Zeichner sieht Begriff nicht');
  if (st.strokes.length !== 0 || (await strokesShown(A)) !== 0 || (await inked(A)) !== 0) fail('Runde 2: Fläche nicht leer');
  const bd = await boardBox(A);
  if (bd.t !== bc.t || bd.h !== bc.h) fail(`Fläche springt: ${JSON.stringify(bc)} -> ${JSON.stringify(bd)}`);
  await stroke(B, ZIG);
  await A.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 1);
  // Auflösung durch Zeit: Gastgeber beendet die Runde
  await A.fill('#zr-in', 'Falsch1'); await A.press('#zr-in', 'Enter');
  await B.waitForFunction(() => /Anna rät: Falsch1/.test(document.querySelector('.zr-chat')?.textContent || ''));
  await A.click('[data-act=skip]');
  await A.waitForSelector('.zr-res'); await B.waitForSelector('.zr-res');
  st = await same(A, B, 'Runde 2 beendet');
  if (st.reason !== 'skip' || st.scores[pa] !== 5 || st.scores[pb] !== gain1) fail('Punkte nach beendeter Runde 2: ' + JSON.stringify(st.scores));
  await A.click('[data-act=next]');
  await A.waitForSelector('.zr-over'); await B.waitForSelector('.zr-over');
  st = await same(A, B, 'Ende');
  const ra = (await A.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  const rb = (await B.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  if (ra !== rb) fail(`Rangliste verschieden ${ra} / ${rb}`);
  if (!(await B.$('.trophy')) || !/gewonnen/.test(await B.textContent('.zr-over h1'))) fail('Siegertext fehlt');
  if (!(await A.$('[data-act=again]')) || (await B.$('[data-act=again]'))) fail('again nur für den Gastgeber');
  await shot(A, 'duo_A_ende'); await shot(B, 'duo_B_ende');
  console.log(`Online: Zustände identisch, Strichanzahl A/B gleich (${sa}), Begriff nie im Gast-DOM, Bernd +${gain1}, Anna ${st.scores[pa]} (Zeichner), Wechsel ok`);
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  st = await same(A, B, 'neues Spiel');
  if (st.ri !== 0 || st.scores[pa] !== 0 || Q_drawer(st) !== pb) fail('neues Spiel: Punkte/Zeichner');
  await ctx.close();
}
const Q_drawer = (g) => g.players[g.ri % g.players.length].id;

// ================================================================ (b) Zeit, Hinweise, Rundenende
async function timeRun(browser) {
  const { ctx, A, B } = await hostGuest(browser, { hostQuery: '&zeit=8' });
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  let st = await same(A, B, 'Start');
  if (st.limit !== 8000) fail('Zeit nicht 8000: ' + st.limit);
  const w = st.word.w.replace(/ /g, '').toUpperCase();
  if (!(await B.$('.zr-timer i'))) fail('Zeitbalken fehlt');
  const m0 = ((await B.textContent('.zr-mask')) || '').replace(/ /g, '');
  if (m0 !== '_'.repeat(w.length)) fail('Anfangs schon Buchstaben: ' + m0);
  await B.waitForFunction(() => /^[^_ ]/.test((document.querySelector('.zr-mask')?.textContent || '').trim()), null, { timeout: 8000 });
  const m1 = ((await B.textContent('.zr-mask')) || '').replace(/ /g, '');
  if (m1[0] !== w[0] || m1.slice(1).replace(/_/g, '') !== '') fail(`Nach der Hälfte: "${m1}" (Wort ${w})`);
  const t1 = Date.now();
  await B.waitForFunction(() => /^[^_ ] [^_ ]/.test((document.querySelector('.zr-mask')?.textContent || '').trim()), null, { timeout: 8000 });
  const m2 = ((await B.textContent('.zr-mask')) || '').replace(/ /g, '');
  if (m2.slice(0, 2) !== w.slice(0, 2) || m2.slice(2).replace(/_/g, '') !== '') fail(`Nach 75 %: "${m2}"`);
  if (has(await text(B), st.word.w)) fail('Hinweise verraten das ganze Wort');
  await shot(B, 'zeit_hinweis');
  await A.waitForSelector('.zr-res', { timeout: 10000 }); await B.waitForSelector('.zr-res');
  st = await same(A, B, 'Zeit um');
  if (st.reason !== 'time' || st.hint !== 2) fail(`Zeit um: ${st.reason}/${st.hint}`);
  if (Object.values(st.scores).some((s) => s !== 0)) fail('Punkte trotz Zeitablauf ohne Treffer');
  if (!/Die Zeit ist um/.test(await B.textContent('.zr-res'))) fail('Text "Die Zeit ist um" fehlt');
  console.log(`Zeit: Buchstaben nach 50 % und 75 % (${m1} / ${m2}), Rundenende durch Zeit ohne Punkte, Hinweise nach ${(Date.now() - t1)} ms`);
  await ctx.close();
}

// ================================================================ (c) Optionen: ohne Zeitdruck, zweimal zeichnen
async function optRun(browser) {
  const { ctx, A, B } = await hostGuest(browser, { opts: ['nolimit', 'twice'] });
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  let st = await same(A, B, 'Start');
  if (st.limit !== 0 || st.len !== 4) fail(`Optionen: limit ${st.limit}, len ${st.len}`);
  if (!(await A.$('.zr-nolimit')) || (await A.$('.zr-timer'))) fail('Ohne Zeitdruck: Anzeige');
  const order = [];
  for (let i = 0; i < 4; i++) {
    st = await same(A, B, 'Runde ' + i);
    order.push(Q_drawer(st));
    await A.click('[data-act=skip]');
    await A.waitForSelector('.zr-res');
    await A.click('[data-act=next]');
    if (i < 3) await A.waitForSelector('[data-act=skip]');
  }
  await A.waitForSelector('.zr-over');
  if (new Set(order).size !== 2 || order[0] === order[1] || order[0] !== order[2]) fail('Zeichner-Reihenfolge ' + order);
  console.log('Optionen: Ohne Zeitdruck (limit 0), zweimal zeichnen (4 Runden, Reihenfolge ok)');
  await ctx.close();
}

// ================================================================ (d) selber Raum
async function localRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'raum');
  await page.goto(base + '?seed=6');
  await page.fill('#name', 'Hanna');
  await page.check('[data-opt=local]');
  await page.click('[data-act=solo]');
  await page.waitForSelector('[data-act=addlocal]');
  if (!(await page.$eval('[data-act=startlocal]', (b) => b.disabled))) fail('Start ohne Mitspieler möglich');
  await page.fill('#zr-name', 'Ida'); await page.press('#zr-name', 'Enter');
  await page.fill('#zr-name', 'Jonas'); await page.click('[data-act=addlocal]');
  await page.waitForFunction(() => document.querySelectorAll('.zr-names li').length === 3);
  await shot(page, 'raum_setup');
  await page.click('[data-act=startlocal]');
  await page.waitForSelector('[data-act=go]');
  let st = await hostState(page);
  if (st.mode !== 'local' || st.players.length !== 3 || st.phase !== 'ready') fail('Lokal: Start');
  const w1 = st.word.w;
  if (has(await text(page), w1)) fail('Lokal: Begriff schon vor "Bereit" im DOM');
  await shot(page, 'raum_bereit');
  await page.click('[data-act=go]');
  await page.waitForSelector('#board');
  if (has(await text(page), w1)) fail('Lokal: Begriff im DOM ohne "Begriff zeigen"');
  await page.click('[data-act=peek]');
  if (!has(await text(page), w1)) fail('Lokal: Begriff nach "Begriff zeigen" nicht sichtbar');
  await shot(page, 'raum_zeigen');
  await stroke(page, ZIG);
  await page.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 1);
  st = await hostState(page);
  if (st.strokes.length !== 1) fail('Lokal: Strich nicht im Zustand');
  await page.click('[data-act=peek]');
  if (has(await text(page), w1)) fail('Lokal: Begriff nach Verdecken noch im DOM');
  if (await page.$('#zr-in')) fail('Lokal: Eingabefeld sichtbar (es wird laut geraten)');
  await page.click('[data-act=pick]');
  await page.waitForSelector('[data-act=got]');
  if ((await page.$$('[data-act=got]')).length !== 2) fail('Lokal: Namenswahl soll 2 Personen zeigen');
  await shot(page, 'raum_namen');
  await page.click('[data-act=got][data-id=l1]');
  await page.waitForFunction(() => /Ida hat es erraten/.test(document.querySelector('.zr-chat')?.textContent || ''));
  st = await hostState(page);
  const hid = st.players[0].id;
  if (st.scores.l1 < 10 || st.scores[hid] !== 5) fail(`Lokal: Punkte Ida ${st.scores.l1} / Hanna ${st.scores[hid]}`);
  await page.click('[data-act=pick]');
  await page.click('[data-act=got][data-id=l2]');
  await page.waitForSelector('.zr-res');
  if (!has(await text(page), `Das Wort war: ${w1}`)) fail('Lokal: Auflösung fehlt');
  st = await hostState(page);
  if (st.scores[hid] !== 10) fail('Lokal: Zeichner-Punkte ' + st.scores[hid]);
  await page.click('[data-act=next]');
  await page.waitForSelector('[data-act=go]');
  if (!/Ida/.test((await page.textContent('.banner')) || '')) fail('Lokal: nächster Zeichner nicht Ida');
  // zweite und dritte Runde durchklicken
  for (let i = 0; i < 2; i++) {
    await page.click('[data-act=go]'); await page.waitForSelector('[data-act=skip]');
    await page.click('[data-act=skip]'); await page.waitForSelector('.zr-res');
    await page.click('[data-act=next]');
    if (i === 0) await page.waitForSelector('[data-act=go]');
  }
  await page.waitForSelector('.zr-over');
  console.log('Selber Raum: Namen, Bereit, Begriff zeigen/verdecken (DOM), Zeichnen, Namenswahl, Punkte, Wechsel, Ende');
  // "Allein spielen" ohne Häkchen führt ebenfalls in den Gruppenmodus
  await page.click('[data-act=again]');
  await page.waitForSelector('[data-act=addlocal]');
  await ctx.close();
}

// ================================================================ (e) Lernrunde
async function learnRun(browser) {
  const ctx = await newCtx(browser, { fast: true });
  const page = await newPage(ctx, 'lernen');
  await page.goto(base + '?seed=4');
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  await page.waitForSelector('#board');
  const seen = [];
  const note = async () => { const t = (((await page.textContent('.coach-t')) || '').trim()); if (seen[seen.length - 1] !== t) seen.push(t); };
  await note();
  let st = await hostState(page);
  if (st.mode !== 'learn' || st.word.w !== 'Haus') fail('Lernrunde: Modus/Begriff');
  if (!has(await text(page), 'Dein Begriff: HAUS')) fail('Lernrunde: Begriff fehlt');
  if (!(await page.$('.coach-target'))) fail('Coach markiert nichts');
  await page.evaluate(() => window.scrollTo(0, 99999));
  const shotCoach = async (n) => shot(page, 'lern_' + n);
  await shotCoach('0');
  // Zeichnen wie im Coach: Striche mit Farbwechsel; der Computer rät erst nach dem ersten Strich
  const box = async () => { await page.evaluate(() => { const b = document.getElementById('board'); window.scrollTo(0, b.getBoundingClientRect().top + scrollY - 230); }); return page.locator('#zr-canvas').boundingBox(); };
  const draw = async (pts) => {
    const b = await box();
    const at = ([x, y]) => [b.x + x * b.width, b.y + y * b.height];
    await page.mouse.move(...at(pts[0])); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps: 4 });
    await page.mouse.up();
  };
  // Dach/Haus/Tür, mit Farbwechseln; nach jedem Strich den Coach-Text merken (Computer rät schnell: 20 ms)
  await page.click('[data-act=tool-e]'); await page.click('[data-act=color][data-i="2"]');
  await draw([[0.2, 0.5], [0.2, 0.85], [0.8, 0.85], [0.8, 0.5], [0.2, 0.5]]);
  await note();
  await page.waitForFunction(() => /Computer rät: Zelt/.test(document.querySelector('.zr-chat')?.textContent || ''));
  await note();
  await page.waitForSelector('.zr-res');
  await note();
  st = await hostState(page);
  if (st.chat[0].text !== 'Zelt' || st.chat[1].k !== 'ok') fail('Lernrunde: Computer rät nicht Zelt, dann Haus: ' + JSON.stringify(st.chat));
  const me = st.players[0].id;
  if (st.scores.bot1 < 10 || st.scores[me] !== 5) fail('Lernrunde: Punkte ' + JSON.stringify(st.scores));
  await shotCoach('ergebnis');
  await page.click('[data-act=next]');
  await page.waitForSelector('.zr-over');
  await note();
  console.log(`Lernrunde: ${seen.length} verschiedene Erklärungen, Computer rät Zelt dann Haus, Ende erreicht`);
  if (seen.length < 4) fail('Zu wenige Erklärungen: ' + seen.length);
  if (new Set(seen).size !== seen.length) fail('Erklärung doppelt');
  await ctx.close();
}

// ================================================================ (f) Layout 390x844
async function layoutRun(browser) {
  const { ctx, A, B } = await hostGuest(browser);
  await overflow(A, 'Lobby'); await smallButtons(A, 'Lobby A'); await overflow(B, 'Lobby B');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const ta = await boardBox(A); const tb = await boardBox(B);
  if (ta.w < 355 || ta.w > 366 || ta.h !== ta.w + 0 && Math.abs(ta.h - ta.w) > 1) fail(`Fläche A: ${JSON.stringify(ta)} (erwartet ca. 362 quadratisch)`);
  if (tb.w !== ta.w || tb.t !== ta.t) fail(`Fläche bei A und B verschieden: ${JSON.stringify(ta)} / ${JSON.stringify(tb)}`);
  // Ohne Scrollen: Zeichnung beim Raten ganz sichtbar (über der Eingabezeile), beim Zeichner Fläche und Farbreihe im Bild
  for (const [p, nm] of [[A, 'Zeichner'], [B, 'Rater']]) {
    const v = await p.evaluate(() => {
      const b = document.getElementById('board').getBoundingClientRect();
      const i = document.querySelector('.zr-input'); const c = document.querySelector('.zr-colors');
      return { bb: Math.round(b.bottom), it: i ? Math.round(i.getBoundingClientRect().top) : null, ct: c ? Math.round(c.getBoundingClientRect().top) : null, cb: c ? Math.round(c.getBoundingClientRect().bottom) : null, ih: innerHeight, sy: scrollY };
    });
    if (v.sy !== 0) fail(nm + ': Seite nicht oben');
    if (nm === 'Rater' && v.bb > v.it) fail(`Rater: Fläche (unten ${v.bb}) wird von der Eingabezeile (oben ${v.it}) verdeckt`);
    if (nm === 'Zeichner' && v.cb > v.ih) fail(`Zeichner: Farbreihe nicht im Bild (${v.cb} > ${v.ih})`);
    console.log(`  Sichtbarkeit ${nm}: Fläche unten ${v.bb}, Eingabe oben ${v.it}, Farbreihe unten ${v.cb}, Fenster ${v.ih}`);
  }
  const chatH = (p) => p.$eval('.zr-chat', (e) => e.getBoundingClientRect().height);
  const ha = await chatH(A); const hb = await chatH(B);
  await overflow(A, 'Zeichner'); await overflow(B, 'Rater'); await smallButtons(A, 'Zeichner'); await smallButtons(B, 'Rater');
  await stroke(A, ZIG);
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 1);
  // viele Rateversuche: nichts springt, Chat scrollt in sich, Eingabezeile bleibt unten
  for (let i = 0; i < 30; i++) {
    await B.fill('#zr-in', `Versuch ${i} mit einem ziemlich langen Wort das umbricht`);
    await B.click('[data-act=guess]');
    await A.waitForFunction((n) => (document.querySelector('.zr-chat')?.textContent || '').includes(`Versuch ${n} `), i);
    if (i === 0 || i === 14 || i === 29) {
      for (const [p, nm, t0, h0] of [[A, 'A', ta, ha], [B, 'B', tb, hb]]) {
        const t = await boardBox(p);
        if (t.t !== t0.t || t.h !== t0.h || t.w !== t0.w) fail(`${nm}: Fläche verschoben bei Versuch ${i}: ${JSON.stringify(t)} vs ${JSON.stringify(t0)}`);
        const hh = await chatH(p);
        if (Math.abs(hh - h0) > 1) fail(`${nm}: Chat-Höhe ${hh} statt ${h0}`);
        await overflow(p, `Layout ${nm} Versuch ${i}`);
      }
    }
  }
  const sc = await B.$eval('.zr-chat', (e) => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight, ch: e.clientHeight, sh: e.scrollHeight }));
  if (sc.sh <= sc.ch) fail('Chat wächst statt zu scrollen');
  if (sc.max - sc.top > 40) fail(`Chat scrollt nicht nach unten (${sc.top}/${sc.max})`);
  await B.evaluate(() => window.scrollTo(0, 0));
  const inp = await B.$eval('.zr-input', (e) => { const r = e.getBoundingClientRect(); return { b: Math.round(r.bottom), ih: innerHeight }; });
  if (inp.b > inp.ih + 1 || inp.b < inp.ih - 40) fail(`Eingabezeile nicht unten fest: ${JSON.stringify(inp)}`);
  // Eingabe bleibt beim Neuzeichnen erhalten
  await B.fill('#zr-in', 'halb getippt'); await B.focus('#zr-in');
  await stroke(A, [[0.1, 0.9], [0.9, 0.9]]);
  await B.waitForFunction(() => Number(document.getElementById('zr-canvas')?.dataset.strokes) === 2);
  if ((await B.inputValue('#zr-in')) !== 'halb getippt' || !(await B.evaluate(() => document.activeElement && document.activeElement.id === 'zr-in'))) fail('Eingabe/Fokus gingen bei neuen Strichen verloren');
  await shot(A, 'layout_A_voll'); await shot(B, 'layout_B_voll');
  // Auflösung: gleiche Position der Fläche, keine Seitenbreite
  await A.click('[data-act=skip]');
  await A.waitForSelector('.zr-res'); await B.waitForSelector('.zr-res');
  for (const [p, nm, t0] of [[A, 'A', ta], [B, 'B', tb]]) {
    const t = await boardBox(p);
    if (t.t !== t0.t || t.h !== t0.h) fail(`${nm}: Fläche springt bei Auflösung ${JSON.stringify(t)} vs ${JSON.stringify(t0)}`);
    await overflow(p, `Auflösung ${nm}`); await smallButtons(p, `Auflösung ${nm}`);
  }
  await shot(A, 'layout_A_res', true);
  await A.click('[data-act=next]');
  await A.waitForSelector('[data-act=skip]');
  await A.click('[data-act=skip]'); await A.waitForSelector('.zr-res');
  await A.click('[data-act=next]');
  await A.waitForSelector('.zr-over');
  await overflow(A, 'Ende'); await smallButtons(A, 'Ende');
  await shot(A, 'layout_A_ende', true);
  // Hilfe und Desktop
  const ctx2 = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
  const D = await newPage(ctx2, 'desktop');
  await D.goto(base + '?seed=2');
  await D.fill('#name', 'Dora');
  await D.click('[data-act=solo]');
  await D.waitForSelector('[data-act=addlocal]');
  await D.fill('#zr-name', 'Ida'); await D.click('[data-act=addlocal]');
  await D.click('[data-act=startlocal]'); await D.click('[data-act=go]');
  await D.waitForSelector('#board');
  await overflow(D, 'Desktop');
  await shot(D, 'desktop');
  await D.click('[data-act=help]');
  await D.waitForSelector('.modal');
  const t = await D.textContent('.modal');
  for (const w of ['Radierer', 'Rückgängig', '90 Sekunden', 'Buchstaben', '10 Punkte', 'selben Gerät', 'Lernrunde']) if (!t.includes(w)) fail('Hilfe ohne ' + w);
  await D.click('[data-act=help-close].btn');
  await D.waitForSelector('#zr-canvas');
  if (!(await D.evaluate(() => document.getElementById('zr-canvas').isConnected && document.querySelector('#board #zr-canvas')))) fail('Fläche nach Schließen der Hilfe nicht wieder eingesetzt');
  await ctx2.close();
  // Handy: Gerät im selben Raum, Werkzeuge und Knöpfe
  const ctx3 = await newCtx(browser);
  const L = await newPage(ctx3, 'LL');
  await L.goto(base + '?seed=2');
  await L.fill('#name', 'Lena');
  await L.click('[data-act=solo]');
  await overflow(L, 'Setup'); await smallButtons(L, 'Setup');
  await L.fill('#zr-name', 'Ida'); await L.click('[data-act=addlocal]');
  await L.click('[data-act=startlocal]');
  await overflow(L, 'Bereit'); await smallButtons(L, 'Bereit');
  await L.click('[data-act=go]');
  await L.waitForSelector('#board');
  await overflow(L, 'Lokal'); await smallButtons(L, 'Lokal');
  await L.click('[data-act=pick]');
  await smallButtons(L, 'Lokal Namenswahl');
  await shot(L, 'layout_lokal', true);
  await ctx3.close();
  console.log(`Layout 390x844: Fläche ${ta.w}x${ta.h} an Position ${ta.t}, bei A/B/Auflösung unverändert, Chat ${ha}px hoch und scrollt in sich, Eingabezeile unten fest, Knöpfe >= 48 px`);
  await ctx.close();
}

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    await duoRun(browser);
    await timeRun(browser);
    await optRun(browser);
    await localRun(browser);
    await learnRun(browser);
    await layoutRun(browser);
  } catch (e) { fail('Ausnahme: ' + (e && e.stack || e)); }
  await browser.close();
  if (srv) srv.kill();
  else { try { execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`); } catch { /* egal */ } }
  console.log(errors.length ? `\n${errors.length} FEHLER` : '\nALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
