// Durchspieltest für das Kneipenquiz (Playwright, Chromium): Alleinspiel, gegen 2 Computer, Lernrunde,
// Gastgeber + Gast (Mock-Netz), Bedenkzeit, Layout bei 390x844.
// Start:  NODE_PATH=$(npm root -g) node tests/quiz.e2e.cjs            (eigene Fixture-Fragen, per Route eingeschleust)
//         REAL=1 NODE_PATH=$(npm root -g) node tests/quiz.e2e.cjs      (echte Sammlung quiz/fragen.js)
// Der Test startet selbst einen Static-Server (python3 -m http.server) auf Port 8941, wenn dort keiner läuft.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8941;
const REAL = !!process.env.REAL;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/quiz/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `qz_${REAL ? 'real_' : ''}${name}.png`), fullPage: full });

let Q; let FR; let byText;
const fmtVal = (q, v) => `${Q.fmtNum(v)}${q.unit ? ' ' + q.unit : ''}`;

// Unabhängige Referenz der Punkte (nicht aus engine.js), Alleinspiel
function refPts(q, v) {
  if (q.t === 'mc' || q.t === 'tf') return v === q.c ? 10 : 0;
  if (q.t === 'order') { const h = v.filter((x, i) => x === i).length; return h * 3 + (h === 4 ? 3 : 0); }
  const dev = Math.abs(v - q.c); const f = dev / (q.max - q.min);
  let p = f <= 0.05 ? 15 : f <= 0.1 ? 10 : f <= 0.2 ? 5 : 0;
  if (dev === 0) p += 5;
  return p;
}
const nearestGrid = (q, target) => {
  const st = Q.estStep(q);
  const v = q.min + Math.round((target - q.min) / st) * st;
  return Number(Math.min(q.max, Math.max(q.min, v)).toPrecision(12));
};

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__botMs = 40; window.__timerMs = 30000;
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 2000 && ms <= 6000 ? window.__botMs : ms === 30000 ? window.__timerMs : ms, ...a);
    // Mitschnitt der Zustände, die der Gastgeber im Mock-Netz verschickt
    const Orig = window.BroadcastChannel;
    window.BroadcastChannel = function (name) {
      const ch = new Orig(name);
      ch.addEventListener('message', (ev) => { const m = ev.data; if (m && m.kind === 'data' && m.d && m.d.t === 'state') window.__lastState = JSON.stringify(m.d.game); });
      return ch;
    };
    window.BroadcastChannel.prototype = Orig.prototype;
  });
  if (!REAL) {
    await ctx.route('**/quiz/fragen.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, 'quiz.fixture.mjs'), 'utf8') }));
  }
  return ctx;
}
async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fail(`${name} console ${m.type()} ${m.text()}`); });
  return page;
}

// ---------------------------------------------------------------- Hilfsfunktionen
const qText = async (page) => ((await page.textContent('.qz-qtext')) || '').trim();
async function curQ(page) {
  const t = await qText(page);
  const q = byText.get(t) || (REAL ? null : null);
  if (!q) throw new Error('Frage nicht in der Sammlung: ' + t);
  return q;
}
async function overflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
}
async function smallButtons(page, label) {
  const small = await page.$$eval('button, a.btn, input[type=range]', (els) => els
    .filter((b) => b.offsetParent && !b.closest('.topbtns') && !b.closest('.coach'))
    .map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act || b.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.h < 48 || x.w < 48));
  if (small.length) fail(`${label}: zu kleine Knöpfe ${JSON.stringify(small)}`);
}
// Nichts im Fragebereich verrät die richtige Antwort (Klassen, Attribute, Beschriftungen)
async function noMarking(page, label) {
  const r = await page.evaluate(() => {
    const ans = document.querySelector('.qz-ans');
    const card = document.querySelector('.qz-q');
    if (!ans) return { err: 'kein .qz-ans' };
    const white = new Set(['qz-ans', 't-mc', 't-tf', 't-est', 't-order', 'qz-opts', 'qz-opt', 'sel', 'gone', 'qz-tf', 'qz-est', 'qz-val', 'qz-range', 'qz-mm', 'qz-pm', 'two', 'qz-btn', 'small', 'btn', 'secondary', 'primary', 'huge', 'qz-joker', 'qz-ord', 'qz-hint', 'qz-cards', 'qz-card', 'on', 'qz-n', 'card', 'action', 'qz-q', 'qz-meta', 'qz-cat', 'qz-no', 'qz-timer', 'off', 'qz-qtext', 'big', 'qz-read']);
    const odd = [];
    for (const el of [...ans.querySelectorAll('*'), ...card.querySelectorAll('*'), ans, card]) for (const c of el.classList) if (!white.has(c)) odd.push(c);
    const attrs = [];
    for (const el of [...ans.querySelectorAll('*'), ...card.querySelectorAll('*')]) for (const a of el.attributes) {
      if (/richtig|korrekt|correct|right|lösung/i.test(a.name + '=' + a.value)) attrs.push(a.name + '=' + a.value);
    }
    // alle Antwortknöpfe einer mc-Frage sind bis auf Buchstabe, Text und Nummer gleich gebaut
    const opts = [...ans.querySelectorAll('button.qz-opt')].map((b) => b.outerHTML.replace(/data-[a-z]+="[^"]*"/g, '').replace(/<b>.*?<\/b>/, '').replace(/<span>.*?<\/span>/, '').replace(/\s+/g, ' ').replace(/ sel/, ''));
    const same = new Set(opts).size <= 1;
    return { odd, attrs, same, text: ans.textContent };
  });
  if (r.err) { fail(`${label}: ${r.err}`); return; }
  if (r.odd.length) fail(`${label}: unbekannte Klassen im Fragebereich ${r.odd}`);
  if (r.attrs.length) fail(`${label}: Hinweis auf die Lösung im DOM ${r.attrs}`);
  if (!r.same) fail(`${label}: Antwortknöpfe unterscheiden sich im Aufbau`);
}
async function layoutInfo(page) {
  return page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const a = document.querySelector('.qz-ans, .qz-res').getBoundingClientRect();
    return { bt: Math.round(b.top + scrollY), bh: Math.round(b.height), at: Math.round(a.top + scrollY) };
  });
}

// Setzt die Schätzung über den Schieberegler (wie ein Mensch: Regler bewegen, Zahl wird angezeigt)
async function setSlider(page, q, v) {
  await page.$eval('.qz-range', (el, val) => { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const shown = ((await page.textContent('#qz-val')) || '').replace(/\s+/g, ' ').trim();
  if (shown !== fmtVal(q, v)) fail(`Schätzwert angezeigt "${shown}" statt "${fmtVal(q, v)}"`);
}
async function orderClick(page, q, wantOrder) {
  const texts = await page.$$eval('.qz-card span', (s) => s.map((x) => x.textContent.trim()));
  if (texts.length !== 4 || new Set(texts).size !== 4) fail('Reihenfolge-Karten: ' + texts);
  if (texts.every((t, i) => t === q.items[i])) fail('Karten stehen schon in der richtigen Reihenfolge');
  const doneBtn = () => page.$eval('[data-act=ord-done]', (b) => b.disabled);
  for (let k = 0; k < 4; k++) {
    if (!(await doneBtn())) fail('Fertig vor der 4. Karte aktiv');
    const j = texts.indexOf(q.items[wantOrder[k]]);
    await page.click(`[data-act=ord-pick][data-j="${j}"]`);
    const n = await page.$eval(`[data-act=ord-pick][data-j="${j}"] .qz-n`, (e) => e.textContent.trim());
    if (n !== String(k + 1)) fail(`Kartennummer ${n} statt ${k + 1}`);
  }
  if (await doneBtn()) fail('Fertig nach 4 Karten nicht aktiv');
  await page.click('[data-act=ord-done]');
}

// Antwortet für den Menschen. mode: 'right' | 'wrong'. Gibt den Antwortwert zurück.
async function answer(page, q, mode, opts = {}) {
  let v;
  await page.mouse.move(2, 2); // Zeiger weg von Knöpfen (Hover-Anheben flackert sonst am Rand)
  if (q.t === 'mc') {
    const vis = await page.$$eval('[data-act=pick]', (b) => b.map((x) => Number(x.dataset.i)));
    v = mode === 'right' ? q.c : vis.find((i) => i !== q.c);
    await page.click(`[data-act=pick][data-i="${v}"]`);
  } else if (q.t === 'tf') {
    v = mode === 'right' ? q.c : !q.c;
    await page.click(`[data-act=pick][data-v="${v ? 1 : 0}"]`);
  } else if (q.t === 'est') {
    v = mode === 'right' ? nearestGrid(q, q.c) : (q.c - q.min > q.max - q.c ? q.min : q.max);
    if (opts.plusMinus) {
      const mid = Q.estMid(q); const st = Q.estStep(q);
      await page.click('[data-act=est-plus]');
      let shown = await page.textContent('#qz-val');
      if (shown.replace(/\s+/g, ' ').trim() !== fmtVal(q, Math.min(q.max, mid + st))) fail(`Plus: ${shown}`);
      await page.click('[data-act=est-minus]'); await page.click('[data-act=est-minus]');
      shown = await page.textContent('#qz-val');
      if (shown.replace(/\s+/g, ' ').trim() !== fmtVal(q, Math.max(q.min, mid - st))) fail(`Minus: ${shown}`);
      await page.click('[data-act=est-plus10]');
    }
    await setSlider(page, q, v);
    await page.click('[data-act=est-ok]');
  } else {
    v = mode === 'right' ? [0, 1, 2, 3] : [3, 2, 1, 0];
    await orderClick(page, q, v);
  }
  return v;
}

// Prüft die Auflösung im DOM gegen die Sammlung
async function checkReveal(page, q, label) {
  await page.waitForSelector('.qz-res');
  const right = ((await page.textContent('.qz-res')) || '').replace(/\s+/g, ' ');
  const want = q.t === 'order' ? q.items : [Q.correctText(q)];
  for (const w of want) if (!right.includes(w)) fail(`${label}: Auflösung ohne "${w}"`);
  const wirt = ((await page.textContent('.qz-wirt p')) || '').trim();
  if (!wirt) fail(`${label}: kein Kommentar des Kneipenwirts`);
  if (q.fun && wirt !== q.fun) fail(`${label}: fun "${wirt}" statt "${q.fun}"`);
  if (!q.fun && !Object.values(Q.SPRUECHE).some((l) => l.includes(wirt))) fail(`${label}: Standardspruch fehlt "${wirt}"`);
  if (!(await page.$('.qz-theke'))) fail(`${label}: keine Theke in der Auflösung`);
  const bn = ((await page.textContent('.banner')) || '').trim();
  if (!/Auflösung/.test(bn)) fail(`${label}: Banner "${bn}"`);
}

const startSolo = async (page, name) => { await page.goto(page.__url || base); await page.fill('#name', name); };

// ================================================================ (a) + (e) Allein, kurzes Quiz
async function soloRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'solo');
  await page.goto(base + '?seed=11');
  await page.fill('#name', 'Anna');
  await page.waitForSelector('[data-act=solo]');
  await shot(page, 'start');
  await overflow(page, 'Startseite');
  // Optionen: kurz und lang schließen sich aus
  await page.check('[data-opt=lang]');
  await page.check('[data-opt=kurz]');
  if (await page.isChecked('[data-opt=lang]')) fail('Lang bleibt angekreuzt, obwohl Kurz gewählt wurde');
  if (!(await page.isChecked('[data-opt=joker]'))) fail('Joker nicht standardmäßig an');
  if (await page.isChecked('[data-opt=timer]')) fail('Bedenkzeit standardmäßig an');
  const lbls = await page.$$eval('.optcard .opt', (o) => o.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  for (const w of ['Kurzes Quiz (8 Fragen)', 'Langes Quiz (20 Fragen)', '50:50-Joker', 'Mit Bedenkzeit 30 s']) if (!lbls.some((l) => l.startsWith(w))) fail('Option fehlt: ' + w);
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  let exp = 0; let rights = 0;
  const lay = {}; const types = new Set(); const texts1 = [];
  let jokerDone = false; let shotsDone = {};
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('.qz-ans');
    const q = await curQ(page);
    texts1.push(q.q);
    types.add(q.t);
    const bn = ((await page.textContent('.banner')) || '').trim();
    if (!new RegExp(`Frage ${i + 1} von 8`).test(bn)) fail(`Banner "${bn}" bei Frage ${i + 1}`);
    if (!(await page.$('.banner.mine'))) fail('Banner nicht grün, obwohl ich antworten soll');
    const cat = ((await page.textContent('.qz-cat')) || '').trim();
    const katExpected = (await import(REAL ? '../quiz/fragen.js' : './quiz.fixture.mjs')).KATEGORIEN[q.k];
    if (cat !== katExpected) fail(`Kategorie "${cat}" statt "${katExpected}"`);
    await overflow(page, `solo Frage ${i + 1}`);
    await smallButtons(page, `solo ${q.t}`);
    await noMarking(page, `solo ${q.t} ${i + 1}`);
    const li = await layoutInfo(page);
    (lay[q.t] = lay[q.t] || []).push(li);
    if (!shotsDone[q.t]) { shotsDone[q.t] = 1; await shot(page, `ask_${q.t}`); }
    if (q.t === 'mc' && !jokerDone) {
      jokerDone = true;
      const jb = await page.$('[data-act=joker]');
      if (!jb) fail('Joker-Knopf fehlt bei mc');
      await page.click('[data-act=joker]');
      const left = await page.$$eval('[data-act=pick]', (b) => b.map((x) => Number(x.dataset.i)));
      if (left.length !== 2 || !left.includes(q.c)) fail(`Joker: sichtbar ${left}, richtig ${q.c}`);
      const gone = await page.$$eval('.qz-opt.gone', (g) => g.length);
      if (gone !== 2) fail('Joker: ausgeblendete Plätze ' + gone);
      if (!(await page.$eval('[data-act=joker]', (b) => b.disabled))) fail('Joker nach Benutzung noch aktiv');
      await noMarking(page, 'nach Joker');
      await shot(page, 'ask_mc_joker');
      const li2 = await layoutInfo(page);
      if (li2.at !== li.at || li2.bt !== li.bt) fail('Joker verschiebt das Layout');
    } else if (q.t === 'mc' && !(await page.$eval('[data-act=joker]', (b) => b.disabled))) fail('zweiter Joker möglich');
    if (q.t === 'order') {
      // Teilweise gewählt: Nummern, Zurück und Neu anordnen
      const texts = await page.$$eval('.qz-card span', (s) => s.map((x) => x.textContent.trim()));
      await page.click('[data-act=ord-pick][data-j="2"]'); await page.click('[data-act=ord-pick][data-j="0"]');
      await shot(page, 'ask_order_partial');
      await page.click('[data-act=ord-undo]');
      const on = await page.$$eval('.qz-card.on', (c) => c.length);
      if (on !== 1) fail('Zurück: gewählte Karten ' + on);
      await page.click('[data-act=ord-clear]');
      if ((await page.$$eval('.qz-card.on', (c) => c.length)) !== 0) fail('Neu anordnen räumt nicht auf');
      if (!(await page.$eval('[data-act=ord-done]', (b) => b.disabled))) fail('Fertig aktiv ohne Auswahl');
      void texts;
    }
    const v = await answer(page, q, 'right', { plusMinus: q.t === 'est' && !shotsDone.pm });
    if (q.t === 'est') shotsDone.pm = 1;
    exp += refPts(q, v);
    rights += q.t === 'est' ? (Math.abs(v - q.c) <= Math.max(Q.estStep(q), 0.1 * (q.max - q.min)) ? 1 : 0) : (refPts(q, v) > 0 ? 1 : 0);
    await checkReveal(page, q, `solo ${i + 1}`);
    const my = Number((await page.textContent('.qz-theke li.me .qz-pt')).trim());
    if (my !== exp) fail(`Theke zeigt ${my} statt ${exp} nach Frage ${i + 1} (${q.t})`);
    const li3 = await layoutInfo(page);
    if (li3.bt !== li.bt || li3.bh !== li.bh) fail(`Frage-Karte springt zwischen Frage und Auflösung (${JSON.stringify(li)} / ${JSON.stringify(li3)})`);
    await overflow(page, `solo Auflösung ${i + 1}`);
    await smallButtons(page, `solo Auflösung ${i + 1}`);
    if (!shotsDone['r' + q.t]) { shotsDone['r' + q.t] = 1; await shot(page, `reveal_${q.t}`); }
    if (i === 3) { // Neuladen mitten im Spiel (in der Auflösung)
      const before = await page.textContent('.qz-res');
      await page.reload();
      await page.waitForSelector('.qz-res');
      if ((await page.textContent('.qz-res')) !== before) fail('Neuladen: Auflösung anders');
    }
    if (i === 4) { await page.click('[data-act=bigger]'); await overflow(page, 'große Schrift Auflösung'); await shot(page, 'reveal_big', false); await page.click('[data-act=bigger]'); }
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.qz-over');
  for (const t of ['mc', 'tf', 'est', 'order']) if (!types.has(t)) fail('Fragetyp kam nicht vor: ' + t);
  // Position von Frage und Antwortbereich je Typ konstant
  for (const [t, arr] of Object.entries(lay)) {
    const tops = new Set(arr.map((x) => x.bt)); const heights = new Set(arr.map((x) => x.bh)); const ats = new Set(arr.map((x) => x.at));
    if (tops.size > 1 || heights.size > 1 || ats.size > 1) fail(`Layout ${t} springt: ${JSON.stringify(arr)}`);
  }
  const all = Object.values(lay).flat();
  if (new Set(all.map((x) => x.bt)).size > 1 || new Set(all.map((x) => x.at)).size > 1) fail('Layout springt zwischen den Fragetypen: ' + JSON.stringify(lay));
  console.log('Layout (Oberkante Frage / Höhe / Oberkante Antworten):', JSON.stringify(Object.fromEntries(Object.entries(lay).map(([k, v]) => [k, v[0]]))));
  // Ende
  await overflow(page, 'Ende');
  await smallButtons(page, 'Ende');
  const h1 = ((await page.textContent('.over h1')) || '').trim();
  if (h1 !== `Prost! Du hast ${exp} Punkte!`) fail(`Ende-Titel "${h1}" statt ${exp} Punkte`);
  const stat = ((await page.textContent('.ranking li')) || '').replace(/\s+/g, ' ');
  if (!/Richtig: \d+ von 8/.test(stat)) fail('Statistik: ' + stat);
  const m = /Richtig: (\d+) von 8/.exec(stat);
  if (m && Number(m[1]) !== rights) fail(`Statistik richtig ${m[1]} statt ${rights}`);
  if (!(await page.$('canvas.confetti'))) fail('Kein Konfetti bei neuer Bestleistung');
  await shot(page, 'over');
  const best = await page.evaluate(() => localStorage.getItem('zh.qz_best_8'));
  if (Number(best) !== exp) fail(`Bestleistung gespeichert ${best} statt ${exp}`);
  if (!/Neue Bestleistung/.test(await page.textContent('.over'))) fail('Text "Neue Bestleistung" fehlt');
  console.log(`Alleinspiel kurz: ${exp} Punkte (Theke stimmt nach jeder Frage), Typen ${[...types]}, Bestleistung ${best}`);
  const used1 = JSON.parse(await page.evaluate(() => localStorage.getItem('zh.qz_used')));
  if (used1.length !== 8) fail('qz_used hat ' + used1.length);
  // Noch eine Runde: alles falsch, andere Fragen, Bestleistung bleibt
  await page.click('[data-act=again]');
  await page.waitForSelector('.qz-ans');
  const texts2 = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('.qz-ans');
    const q = await curQ(page);
    texts2.push(q.q);
    await answer(page, q, 'wrong');
    await page.waitForSelector('.qz-res');
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.qz-over');
  const dup = texts2.filter((t) => texts1.includes(t));
  if (dup.length) fail('Noch eine Runde wiederholt Fragen: ' + dup);
  const h2 = ((await page.textContent('.over h1')) || '').trim();
  const best2 = await page.evaluate(() => localStorage.getItem('zh.qz_best_8'));
  if (Number(best2) !== exp) fail(`Bestleistung nach schlechterer Runde ${best2} statt ${exp}`);
  if (!new RegExp(`Bestleistung bei 8 Fragen: ${exp} Punkte`).test(await page.textContent('.over'))) fail('Bestleistung wird nicht angezeigt: ' + best2 + ' ' + JSON.stringify(await page.evaluate(() => [localStorage.getItem('zh.qz_best_8'), Object.keys(localStorage)])) + ' ' + (await page.textContent('.over')).slice(0, 200));
  console.log(`Zweite Runde (alles falsch): "${h2}", Bestleistung bleibt ${best2}, keine Wiederholung (${texts2.length} neue Fragen)`);
  const used2 = JSON.parse(await page.evaluate(() => localStorage.getItem('zh.qz_used')));
  if (used2.length !== 16 || new Set(used2).size !== 16) fail('qz_used nach 2 Runden: ' + used2.length);
  await page.click('[data-act=leave-now]');
  await page.waitForSelector('[data-act=solo]');
  await ctx.close();
}

// ================================================================ Langes Quiz: Länge 20, Typen
async function longRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lang');
  await page.goto(base + '?seed=3');
  await page.fill('#name', 'Lotte');
  await page.check('[data-opt=lang]');
  await page.uncheck('[data-opt=joker]');
  await page.click('[data-act=solo]');
  const cnt = { mc: 0, tf: 0, est: 0, order: 0 }; const cats = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForSelector('.qz-ans');
    const q = await curQ(page);
    cnt[q.t]++; cats.push(q.k);
    if (i === 0 && (await page.$('[data-act=joker]'))) fail('Joker-Knopf trotz ausgeschaltetem Joker');
    if (!new RegExp(`Frage ${i + 1} von 20`).test(await page.textContent('.banner'))) fail('Banner Länge 20');
    try { await answer(page, q, i % 3 ? 'right' : 'wrong'); } catch (e) { await shot(page, 'lang_haengt'); throw new Error(JSON.stringify(q) + ' ' + e.message.split('\n')[0]); }
    await page.waitForSelector('.qz-res');
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.qz-over');
  const ok = cnt.mc === 11 && cnt.tf === 4 && cnt.est === 3 && cnt.order === 2;
  if (!ok) fail('Mischung bei 20 Fragen: ' + JSON.stringify(cnt));
  for (let i = 2; i < cats.length; i++) if (cats[i] === cats[i - 1] && cats[i] === cats[i - 2]) fail('3 gleiche Kategorien hintereinander');
  console.log('Langes Quiz:', JSON.stringify(cnt), 'Kategorien', new Set(cats).size);
  await ctx.close();
}

// ================================================================ (b) gegen 2 Computer
async function botRun(browser, level) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'bot' + level);
  await page.goto(base + `?seed=${20 + level}`);
  await page.fill('#name', 'Berta');
  await page.check('[data-opt=kurz]');
  await page.evaluate(() => { window.__botMs = 700; });
  await page.click(`[data-act=bot][data-n="2"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  let rights = 0; let sawWait = false;
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('.qz-ans');
    const q = await curQ(page);
    await answer(page, q, 'right');
    rights++;
    if (i === 0) {
      const bn = ((await page.textContent('.banner')) || '').trim();
      sawWait = /^Warte auf: Computer 1, Computer 2$/.test(bn);
      if (!sawWait) fail(`Warte-Banner "${bn}"`);
      if (await page.$('.qz-res')) fail('Auflösung, obwohl Computer noch nicht geantwortet haben');
      if (!(await page.$eval('[data-act=pick], [data-act=est-ok], [data-act=ord-done]', (b) => b.disabled))) fail('Antwortknöpfe nach Antwort nicht gesperrt');
      await shot(page, `bot_warten`);
      await page.evaluate(() => { window.__botMs = 40; });
    }
    await checkReveal(page, q, `bot ${i + 1}`);
    const rows = await page.$$eval('.qz-list li', (l) => l.length);
    if (rows !== 3) fail('Auflösung zeigt ' + rows + ' Personen');
    const th = await page.$$eval('.qz-theke li', (l) => l.map((x) => ({ n: x.querySelector('.qz-nm').textContent, p: Number(x.querySelector('.qz-pt').textContent) })));
    if (th.length !== 3) fail('Theke: ' + th.length);
    for (let k = 1; k < th.length; k++) if (th[k].p > th[k - 1].p) fail('Theke nicht nach Punkten sortiert ' + JSON.stringify(th));
    if (i === 0) await shot(page, 'bot_reveal');
    if (i === 2) { // Neuladen mitten im Spiel: Zustand bleibt, Computer machen weiter
      await page.reload();
      await page.waitForSelector('.qz-res');
    }
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.qz-over');
  const st = JSON.parse(await page.evaluate(() => localStorage.getItem('zh.qz.hostState'))).game;
  const rk = await page.$$eval('.ranking li', (l) => l.map((x) => ({ n: x.querySelector('.rn').childNodes[0].textContent.trim(), p: Number(x.querySelector('.rt').textContent) })));
  if (rk.length !== 3) fail('Rangliste hat ' + rk.length);
  for (const p of st.players) {
    const row = rk.find((r) => r.n.startsWith(p.name));
    if (!row || row.p !== st.scores[p.id]) fail(`Rangliste ${p.name}: ${row && row.p} statt ${st.scores[p.id]}`);
  }
  const mx = Math.max(...Object.values(st.scores));
  const winners = st.players.filter((p) => st.scores[p.id] === mx);
  const h1 = ((await page.textContent('.over h1')) || '').trim();
  const iWon = st.scores[st.players[0].id] === mx;
  if (iWon && !/^Du (bist|und)/.test(h1) && !/^Du bist|^Du, /.test(h1) && !/^Du/.test(h1)) fail('Titel (gewonnen) "' + h1 + '"');
  if (!/Stammtisch-König\/Königin 👑/.test(h1)) fail('Titel ohne Stammtisch-König: ' + h1);
  if (!iWon && /^Du/.test(h1)) fail('Titel nennt mich, obwohl ich nicht gewonnen habe: ' + h1);
  if (iWon && !(await page.$('canvas.confetti'))) fail('Kein Konfetti trotz Sieg');
  if (iWon && !/🏆/.test(await page.textContent('.trophy'))) fail('Pokal fehlt');
  const stat = (await page.textContent('.ranking li:first-child')).replace(/\s+/g, ' ');
  console.log(`Gegen 2 Computer (${level ? 'Mittel' : 'Leicht'}): Theke ${JSON.stringify(rk)}; Titel "${h1}"; Gewinner ${winners.map((w) => w.name)}; ${stat.trim()}`);
  const mine = rk.find((r) => r.n.startsWith('Berta'));
  const mineRow = (await page.textContent('.ranking li:has(.rn:has-text("Berta"))')).replace(/\s+/g, ' ');
  if (!/Richtig: 8 von 8/.test(mineRow)) fail('Statistik meiner Person: ' + mineRow);
  void mine;
  if (level === 1) await shot(page, 'bot_over');
  await ctx.close();
}

// ================================================================ (c) Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.waitForSelector('[data-act=learn]');
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  await shot(page, 'lern_1');
  const texts = []; let steps = 0; let idle = 0; let finished = false; let k = 0;
  while (steps < 80) {
    const text = ((await page.textContent('.coach .coach-t')) || '').trim();
    if (!text || text.length > 220) fail(`Lernrunde Textlänge ${text.length}: ${text}`);
    if (!texts.includes(text)) { texts.push(text); if (texts.length === 3 || texts.length === 5 || texts.length === 7) await shot(page, `lern_${texts.length}`); }
    const target = page.locator('.coach-target').first();
    if (await target.count() === 0) {
      if (++idle > 300) { fail('Lernrunde: kein Ziel: ' + text); break; }
      await page.waitForTimeout(15); continue;
    }
    idle = 0;
    const act = await target.getAttribute('data-act');
    if (act === 'again') { finished = true; await shot(page, 'lern_ende'); break; }
    if (act === 'est-ok') await page.$eval('.qz-range', (el) => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (act === 'pick' && k++ === 0) { // Joker zuerst anbieten (steht als erstes Ziel mit)
      if (await page.locator('[data-act=joker].coach-target').count() === 0) fail('Joker ist in der Lernrunde nicht markiert');
      await page.click('[data-act=joker]');
      continue;
    }
    try { await target.click({ timeout: 4000 }); } catch (e) { fail('Lernrunde Klick: ' + e.message.split('\n')[0]); break; }
    steps++;
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde Endtext');
  if (new Set(texts).size !== texts.length) fail('Lernrunde: Text doppelt');
  const fixedQs = ['Aus welchen Zutaten', 'Wie viele Beine hat eine Spinne', 'Die Sonne geht im Osten auf'];
  console.log(`Lernrunde: ${steps} Klicks, ${texts.length} verschiedene Texte (nur einmal je Text)`);
  for (const t of texts) console.log('   -', t);
  void fixedQs;
  // Neuladen in der Lernrunde, Beenden
  await page.click('[data-act=again]');
  await page.waitForSelector('.coach');
  if (!/Aus welchen Zutaten/.test(await page.textContent('.qz-qtext'))) fail('Lernrunde startet nicht mit der festen ersten Frage');
  await page.reload();
  await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => fail('nach Neuladen keine Lernrunde'));
  await page.click('[data-act=learn-stop]');
  await page.waitForTimeout(150);
  if (await page.locator('.coach').count()) fail('Anleitung bleibt nach Beenden');
  if (await page.locator('.coach-target').count()) fail('Pulsieren bleibt nach Beenden');
  await ctx.close();
}

// ================================================================ (d) Gastgeber + Gast (Mock)
async function stateOf(host, guest) {
  const h = JSON.parse(await host.evaluate(() => sessionStorage.getItem('zh.qz.hostState'))).game;
  const gs = await guest.evaluate(() => window.__lastState);
  return { h: JSON.stringify(h), g: gs, hobj: h };
}
async function same(host, guest, label) {
  for (let t = 0; t < 40; t++) {
    const s = await stateOf(host, guest);
    if (s.h === s.g) return s.hobj;
    await host.waitForTimeout(50);
  }
  const s = await stateOf(host, guest);
  fail(`${label}: Zustand bei Gastgeber und Gast verschieden`);
  return s.hobj;
}
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
  await A.waitForSelector('.qz-ans'); await B.waitForSelector('.qz-ans');
  let st = await same(A, B, 'Start');
  if (st.len !== 8 || st.players.length !== 2) fail('Spielstart: Länge/Spieler ' + st.len + '/' + st.players.length);
  let guestBest = 0;
  for (let i = 0; i < 8; i++) {
    const q = await curQ(A);
    if ((await qText(B)) !== q.q) fail('Gast sieht andere Frage');
    for (const [p, nm] of [[A, 'Gastgeber'], [B, 'Gast']]) {
      await noMarking(p, `duo ${nm} Frage ${i + 1}`);
      if (!(await p.$('.banner.mine'))) fail(`${nm}: Banner nicht grün`);
    }
    // richtige Antwort steht nur im Zustand
    st = await same(A, B, `Frage ${i + 1} offen`);
    const sq = st.qs[st.qi];
    if (q.t === 'order' ? JSON.stringify(sq.items) !== JSON.stringify(q.items) : sq.c !== q.c) fail('Zustand enthält die Lösung nicht');
    if (i === 1) { await shot(A, 'duo_A_ask', false); await shot(B, 'duo_B_ask', false); }
    // Anna antwortet zuerst: Anna wartet auf Bernd, Bernd wartet nicht
    const va = await answer(A, q, 'right');
    await B.waitForFunction(() => document.querySelector('.qz-theke') !== null);
    const bnA = ((await A.textContent('.banner')) || '').trim();
    if (bnA !== 'Warte auf: Bernd') fail(`A Banner "${bnA}"`);
    if (!(await B.$('.banner.mine'))) fail('B Banner sollte noch grün sein');
    if (await A.$('.qz-res') || await B.$('.qz-res')) fail('Auflösung zu früh');
    st = await same(A, B, `Frage ${i + 1} A geantwortet`);
    if (!('p0' in st.answers) && Object.keys(st.answers).length !== 1) fail('Antwort fehlt im Zustand');
    // Bernd: abwechselnd richtig / falsch
    const mode = i % 2 ? 'wrong' : 'right';
    const vb = await answer(B, q, mode);
    await A.waitForSelector('.qz-res'); await B.waitForSelector('.qz-res');
    st = await same(A, B, `Frage ${i + 1} Auflösung`);
    const ids = st.players.map((p) => p.id);
    if (st.phase !== 'reveal') fail('Phase ' + st.phase);
    const expA = q.t === 'mc' || q.t === 'tf' ? refPts(q, va) : null;
    if (expA !== null && st.reveal.res[ids[0]].pts !== expA) fail('Punkte Anna ' + st.reveal.res[ids[0]].pts);
    if (q.t === 'mc' || q.t === 'tf') {
      const eb = refPts(q, vb);
      if (st.reveal.res[ids[1]].pts !== eb) fail('Punkte Bernd ' + st.reveal.res[ids[1]].pts + ' statt ' + eb);
    }
    guestBest += 0;
    // Auflösung: gleiche Inhalte, nur Gastgeber hat Weiter
    const norm = (t) => t.replace(/\(du\)/g, '').replace(/\s+/g, '');
    const ra = norm(await A.textContent('.qz-right')); const rb = norm(await B.textContent('.qz-right'));
    if (ra !== rb) fail('Auflösung verschieden: ' + ra + ' / ' + rb);
    const ca = norm(await A.textContent('.qz-wirt')); const cb = norm(await B.textContent('.qz-wirt'));
    if (ca !== cb) fail('Kommentar verschieden');
    const ta = norm(await A.textContent('.qz-theke')); const tb = norm(await B.textContent('.qz-theke'));
    if (ta !== tb) fail(`Theke verschieden: ${ta} / ${tb}`);
    if (!(await A.$('[data-act=next]'))) fail('Gastgeber ohne Weiter');
    if (await B.$('[data-act=next]')) fail('Gast sieht Weiter');
    if (!/Gastgeber/.test(await B.textContent('.qz-res'))) fail('Gast ohne Hinweis auf den Gastgeber');
    if (i === 1) { await shot(A, 'duo_A_reveal'); await shot(B, 'duo_B_reveal'); }
    await overflow(A, 'duo A'); await overflow(B, 'duo B');
    // Gast darf Gastgeber-Nachrichten nicht auslösen: next vom Gast bleibt wirkungslos (kein Knopf -> direkt über Seite nicht möglich)
    await A.click('[data-act=next]');
    if (i < 7) { await A.waitForSelector('.qz-ans'); await B.waitForSelector('.qz-ans'); } else { await A.waitForSelector('.qz-over'); await B.waitForSelector('.qz-over'); }
    st = await same(A, B, `Frage ${i + 1} weiter`);
  }
  if (st.phase !== 'over') fail('Phase am Ende ' + st.phase);
  const ra = (await A.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  const rb = (await B.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  if (ra !== rb) fail('Rangliste verschieden: ' + ra + ' / ' + rb);
  const h1A = ((await A.textContent('.over h1')) || '').trim(); const h1B = ((await B.textContent('.over h1')) || '').trim();
  console.log(`Host+Gast: Zustände nach jedem Schritt identisch; Titel A "${h1A}", B "${h1B}"; Rangliste ${ra}`);
  const mx = Math.max(...Object.values(st.scores));
  const win = st.players.filter((p) => st.scores[p.id] === mx).map((p) => p.name);
  if (!win.every((n) => (h1A + h1B).includes(n) || /Du/.test(h1A + h1B))) fail('Titel nennt Sieger nicht: ' + win);
  if (!(await A.$('[data-act=again]')) || (await B.$('[data-act=again]'))) fail('again-Knopf nur für den Gastgeber erwartet');
  await shot(A, 'duo_A_over'); await shot(B, 'duo_B_over');
  // Gast lädt neu im Endzustand
  await B.reload(); await B.waitForSelector('.qz-over', { timeout: 10000 });
  // Neue Runde
  await A.click('[data-act=again]');
  await A.waitForSelector('.qz-ans'); await B.waitForSelector('.qz-ans');
  st = await same(A, B, 'neue Runde');
  if (st.qi !== 0 || st.phase !== 'ask') fail('Neue Runde nicht frisch');
  await ctx.close();
}

// ================================================================ Bedenkzeit
async function timerRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'timer');
  await page.goto(base + '?seed=7');
  await page.addInitScript(() => { window.__timerMs = 600; });
  await page.fill('#name', 'Tina');
  await page.check('[data-opt=kurz]');
  await page.check('[data-opt=timer]');
  await page.evaluate(() => { window.__timerMs = 700; });
  await page.click('[data-act=bot][data-n="1"][data-level="1"]');
  await page.waitForSelector('#board');
  let sawBar = false; let draftUsed = 0; let none = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('.qz-ans');
    const q = await curQ(page);
    if (await page.$('.qz-timer i')) sawBar = true;
    let v = null;
    if (q.t === 'est') { v = nearestGrid(q, q.c); await setSlider(page, q, v); draftUsed++; }
    if (q.t === 'order') { // vollständig angetippt, aber nicht auf Fertig: zählt bei Zeitablauf
      const texts = await page.$$eval('.qz-card span', (s) => s.map((x) => x.textContent.trim()));
      for (let k = 0; k < 4; k++) await page.click(`[data-act=ord-pick][data-j="${texts.indexOf(q.items[k])}"]`);
      v = [0, 1, 2, 3]; draftUsed++;
    }
    await page.waitForSelector('.qz-res', { timeout: 8000 });
    const row = ((await page.textContent('.qz-list li.me')) || '').replace(/\s+/g, ' ');
    if (v === null) { none++; if (!/keine Antwort/.test(row) || !/\+0/.test(row)) fail(`Zeit um ohne Antwort: "${row}"`); } else {
      const exp = refPts(q, v) + (q.t === 'est' ? 0 : 0);
      const got = Number((/\+(\d+)\s*$/.exec(row) || [0, -1])[1]);
      if (q.t === 'order' ? got !== 15 : got < 10) fail(`Entwurf zählt nicht: "${row}" (erwartet ${exp})`);
    }
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.qz-over');
  console.log(`Bedenkzeit: Balken gesehen ${sawBar}, ${draftUsed} Entwürfe gezählt, ${none} Fragen ohne Antwort mit 0 Punkten`);
  if (!sawBar) fail('Kein Zeitbalken');
  await shot(page, 'timer_over', false);
  await ctx.close();
}

// ================================================================ Hilfe, Desktop, Vorlesen
async function misc(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'hilfe');
  await page.goto(base + '?seed=2');
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  const t = await page.textContent('.modal');
  for (const w of ['50:50-Joker', 'Die Theke', 'Schätzfrage', 'Reihenfolge', '15 Punkte', 'Stammtisch']) if (!t.includes(w)) fail('Hilfe ohne: ' + w);
  if (/quizduell|wer wird|millionär|jauch|trivial/i.test(t)) fail('Marke in der Hilfe');
  await shot(page, 'help', false);
  await page.click('.modal [data-act=help-close]');
  await page.fill('#name', 'Anna');
  await page.click('[data-act=solo]');
  await page.waitForSelector('.qz-ans');
  if (await page.$('[data-act=read]')) { await page.click('[data-act=read]'); console.log('Vorlesen-Knopf vorhanden und anklickbar'); } else console.log('Kein Vorlesen-Knopf (keine Sprachausgabe)');
  await ctx.close();
  const ctx2 = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
  const d = await newPage(ctx2, 'desktop');
  await d.goto(base + '?seed=2');
  await d.fill('#name', 'Anna');
  await d.click('[data-act=solo]');
  await d.waitForSelector('.qz-ans');
  await shot(d, 'desktop_ask', false);
  await overflow(d, 'Desktop');
  await ctx2.close();
}

// ================================================================ Server + Start
function portUp() { return new Promise((res) => { http.get(`http://localhost:${PORT}/`, (r) => { r.resume(); res(true); }).on('error', () => res(false)); }); }
(async () => {
  let srv = null;
  if (!(await portUp())) {
    srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await portUp()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  Q = await import('../quiz/engine.js');
  const mod = await import(REAL ? '../quiz/fragen.js' : './quiz.fixture.mjs');
  FR = mod.FRAGEN; byText = new Map(FR.map((q) => [q.q, q]));
  console.log(`Sammlung: ${REAL ? 'echt (quiz/fragen.js)' : 'Fixture'}, ${FR.length} Fragen`);
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const run = async (name, fn) => { if (only && !only.includes(name)) return; const t0 = Date.now(); try { await fn(); } catch (e) { fail(`${name}: ${e.stack || e.message}`); } console.log(`-- ${name} fertig (${((Date.now() - t0) / 1000).toFixed(1)} s)`); };
  await run('solo', () => soloRun(browser));
  await run('lang', () => longRun(browser));
  await run('bot0', () => botRun(browser, 0));
  await run('bot1', () => botRun(browser, 1));
  await run('lern', () => lernrunde(browser));
  await run('duo', () => duoRun(browser));
  await run('timer', () => timerRun(browser));
  await run('misc', () => misc(browser));
  await browser.close();
  if (srv) { try { srv.kill(); } catch { /* egal */ } }
  else { try { execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`); } catch { /* egal */ } }
  if (errors.length) { console.log(`\n${errors.length} FEHLER`); process.exit(1); }
  console.log('\nALLE E2E-TESTS BESTANDEN (Konsole fehlerfrei)');
})().catch((e) => { console.error(e); process.exit(2); });
