// Durchspieltest für "Stadt, Land, Fluss" (Playwright, Chromium): Alleinspiel, gegen Computer (Leicht/Mittel),
// Lernrunde, Gastgeber + Gast (Mock-Netz) mit Stopp, Abstimmen, Neuladen; Layout bei 390x844.
// Start:  NODE_PATH=$(npm root -g) node tests/stadt.e2e.cjs
// Der Test startet selbst einen Static-Server (python3 -m http.server) auf Port 8963, wenn dort keiner läuft.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8963;
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/stadt/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `sl_${name}.png`), fullPage: full });

let Q; let WOERTER;
const CAT_ID = {};

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__botMs = 40; window.__timerMs = 30000;
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 3000 && ms <= 8000 ? window.__botMs : ms === 30000 ? window.__timerMs : ms, ...a);
    // Mitschnitt der Zustände, die der Gastgeber im Mock-Netz verschickt
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
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fail(`${name} console ${m.type()} ${m.text()}`); });
  return page;
}

// ---------------------------------------------------------------- Hilfsfunktionen
async function overflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
}
async function smallButtons(page, label) {
  const small = await page.$$eval('button, a.btn, input.sl-in', (els) => els
    .filter((b) => b.offsetParent && !b.closest('.topbtns') && !b.closest('.coach'))
    .map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act || b.tagName + '.' + b.className, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.h < 48 || x.w < 48 || (/sl-in/.test(x.a) && x.h < 56)));
  if (small.length) fail(`${label}: zu kleine Knöpfe/Felder ${JSON.stringify(small)}`);
}
const letterOf = async (page) => ((await page.textContent('.sl-letter')) || '').trim();
async function catIds(page) {
  const labels = await page.$$eval('.sl-cn', (e) => e.map((x) => x.textContent.trim()));
  return labels.map((l) => CAT_ID[l]);
}
const knownWord = (cat, L, k = 0) => WOERTER[cat].filter((w) => Q.startsWithLetter(w, L))[k];
async function layoutInfo(page) {
  return page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const f = document.querySelector('.sl-in');
    return { bt: Math.round(b.top + scrollY), bh: Math.round(b.height), ft: f ? Math.round(f.getBoundingClientRect().top + scrollY) : null };
  });
}
async function hostState(page, store = 'localStorage') {
  const raw = await page.evaluate((s) => window[s].getItem('zh.sl.hostState'), store);
  return raw ? JSON.parse(raw).game : null;
}

// Füllt eine Runde als Mensch: Wörter aus dem Wörterbuch; opts.skip = Indizes, die leer bleiben; opts.words = {i: 'Text'}
async function fillRound(page, opts = {}) {
  await page.waitForSelector('.sl-in');
  const L = await letterOf(page);
  const ids = await catIds(page);
  const used = [];
  for (let i = 0; i < ids.length; i++) {
    if (opts.skip && opts.skip.includes(i)) { used.push(''); continue; }
    const w = (opts.words && opts.words[i]) || knownWord(ids[i], L, opts.k || 0);
    used.push(w);
    await page.fill(`.sl-in[data-i="${i}"]`, w);
  }
  return { L, ids, used };
}
const startBtn = async (page) => page.click('[data-act=done]');

// Prüft Auflösung im DOM gegen den Spielstand des Gastgebers
async function checkReveal(page, st, label) {
  await page.waitForSelector('.sl-cat');
  const cards = await page.$$eval('.sl-cat', (cs) => cs.map((c) => ({ h: c.querySelector('h3').textContent.trim(), rows: [...c.querySelectorAll('li')].map((li) => ({ who: li.querySelector('.sl-who').textContent.replace(/\s*\(du\)/, '').trim(), ans: li.querySelector('.sl-w').textContent.trim(), pts: li.querySelector('.sl-pts').textContent.trim(), tag: (li.querySelector('.sl-tag') || {}).textContent || '' })) })));
  if (cards.length !== st.cats.length) fail(`${label}: ${cards.length} Kategorien statt ${st.cats.length}`);
  cards.forEach((c, ci) => {
    if (c.h !== Q.CATS[st.cats[ci]]) fail(`${label}: Überschrift ${c.h}`);
    if (c.rows.length !== st.players.length) fail(`${label}: ${c.rows.length} Zeilen`);
    st.players.forEach((p, pi) => {
      const r = st.reveal.cats[ci].rows[p.id]; const d = c.rows[pi];
      if (!d) return;
      if (d.who !== p.name) fail(`${label}: Name ${d.who} statt ${p.name}`);
      const want = r.st === 'empty' ? '–' : r.a;
      if (d.ans !== want) fail(`${label}: Antwort "${d.ans}" statt "${want}"`);
      if (d.pts !== (r.pts ? '+' + r.pts : '0')) fail(`${label}: Punkte ${d.pts} statt ${r.pts} (${p.name}, ${c.h})`);
      if (r.st === 'unknown' && !/ungeprüft/.test(d.tag)) fail(`${label}: ungeprüft nicht markiert (${d.ans})`);
      if (r.st !== 'unknown' && /ungeprüft/.test(d.tag)) fail(`${label}: fälschlich ungeprüft (${d.ans})`);
      if (r.st === 'known' && r.a && !Q.inDict(st.cats[ci], r.a)) fail(`${label}: ${r.a} nicht im Wörterbuch`);
    });
  });
  const rank = await page.$$eval('.sl-rank li', (l) => l.map((x) => ({ n: x.querySelector('.sl-nm').textContent.replace(/\s*\(du\)/, '').trim(), p: Number(x.querySelector('.sl-pt').textContent) })));
  for (const p of st.players) { const r = rank.find((x) => x.n === p.name); if (!r || r.p !== st.scores[p.id]) fail(`${label}: Rangliste ${p.name} ${r && r.p} statt ${st.scores[p.id]}`); }
  for (let k = 1; k < rank.length; k++) if (rank[k].p > rank[k - 1].p) fail(`${label}: Rangliste nicht sortiert`);
  return cards;
}

// ================================================================ (a) Allein, kurzes Spiel
async function soloRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'solo');
  await page.goto(base + '?seed=11');
  await page.fill('#name', 'Anna');
  await page.waitForSelector('[data-act=solo]');
  await shot(page, 'start');
  await overflow(page, 'Startseite');
  await page.check('[data-opt=lang]');
  await page.check('[data-opt=kurz]');
  if (await page.isChecked('[data-opt=lang]')) fail('Lang bleibt angekreuzt, obwohl Kurz gewählt wurde');
  if (await page.isChecked('[data-opt=more]')) fail('Mehr Kategorien standardmäßig an');
  if (await page.isChecked('[data-opt=stop]')) fail('Stopp standardmäßig an');
  const lbls = await page.$$eval('.optcard .opt', (o) => o.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  for (const w of ['Kurzes Spiel (4 Runden)', 'Langes Spiel (10 Runden)', 'Mehr Kategorien (8): zusätzlich Pflanze/Obst und Essen/Trinken', 'Mit Stopp (30 Sekunden)']) if (!lbls.some((l) => l.startsWith(w))) fail('Option fehlt: ' + w);
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  const letters = []; const lay = [];
  let total = 0;
  for (let r = 0; r < 4; r++) {
    await page.waitForSelector('.sl-in');
    const L = await letterOf(page);
    if (!/^[A-Z]$/.test(L) || 'QXYC'.includes(L)) fail('Buchstabe ' + L);
    if (letters.includes(L)) fail('Buchstabe wiederholt ' + L);
    letters.push(L);
    const bn = ((await page.textContent('.banner')) || '').trim();
    if (!new RegExp(`Runde ${r + 1} von 4`).test(bn)) fail(`Banner "${bn}" in Runde ${r + 1}`);
    if (!(await page.$('.banner.mine'))) fail('Banner nicht grün');
    const n = await page.$$eval('.sl-in', (i) => i.length);
    if (n !== 6) fail('Felder: ' + n);
    const labels = await page.$$eval('.sl-cn', (e) => e.map((x) => x.textContent.trim()));
    if (labels.join(',') !== 'Stadt,Land,Fluss,Name,Tier,Beruf') fail('Kategorien ' + labels);
    if (r === 0) {
      // Tab/Enter springt weiter; Fertig fest unten; keine Wörter im Feld vorgegeben
      await page.focus('.sl-in[data-i="0"]');
      await page.keyboard.press('Enter');
      const act = await page.evaluate(() => document.activeElement.dataset.i);
      if (act !== '1') fail('Enter springt nicht zum nächsten Feld: ' + act);
      await page.keyboard.press('Tab');
      if ((await page.evaluate(() => document.activeElement.dataset.i)) !== '2') fail('Tab springt nicht weiter');
      const ph = await page.$eval('.sl-in', (i) => i.placeholder);
      if (!ph.includes(L)) fail('Platzhalter ' + ph);
      const attrs = await page.$eval('.sl-in', (i) => ({ ac: i.autocomplete, au: i.autocapitalize, sp: i.spellcheck, type: i.type }));
      if (attrs.type !== 'text' || attrs.ac !== 'off') fail('Feld-Attribute ' + JSON.stringify(attrs));
      const bar = await page.$eval('.sl-bar', (b) => { const x = b.getBoundingClientRect(); return { b: Math.round(x.bottom), h: innerHeight }; });
      if (bar.b > bar.h + 1 || bar.b < bar.h - 20) fail('Fertig-Leiste nicht fest unten ' + JSON.stringify(bar));
      await shot(page, 'solo_fill_leer');
      await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      const lastAct = await page.evaluate(() => document.activeElement.getAttribute('data-act'));
      if (lastAct !== 'done') fail('Enter im letzten Feld führt nicht zu Fertig: ' + lastAct);
    }
    await overflow(page, `solo fill ${r + 1}`);
    await smallButtons(page, `solo fill ${r + 1}`);
    lay.push(await layoutInfo(page));
    // Runde 1: ein ungeprüftes Wort in Stadt, ein leeres Feld; Runde 2: Großschreibung egal; Runde 3: falscher Buchstabe
    const opts = {};
    if (r === 0) { opts.words = { 0: L + 'lumenhausen' }; opts.skip = [5]; }
    if (r === 1) { opts.words = { 0: knownWord('stadt', L).toUpperCase(), 1: ' ' + knownWord('land', L).toLowerCase() + '  ' }; }
    if (r === 2) { opts.words = { 2: letters[0] === 'A' ? 'Zzz' : 'Aaa' }; }
    const f = await fillRound(page, opts);
    if (r === 0) await shot(page, 'solo_fill_voll');
    // Entwurf wird gespeichert (auch ohne Fertig)
    await page.waitForTimeout(700);
    let st = await hostState(page);
    if (JSON.stringify(st.drafts[st.players[0].id]) !== JSON.stringify(f.used.map((x) => Q.clean(x)))) fail(`Entwurf nicht im Zustand: ${JSON.stringify(st.drafts)}`);
    if (r === 1) { // Neuladen: Entwurf bleibt
      await page.reload();
      await page.waitForSelector('.sl-in');
      const vals = await page.$$eval('.sl-in', (i) => i.map((x) => x.value));
      if (JSON.stringify(vals) !== JSON.stringify(f.used.map((x) => Q.clean(x)))) fail('Entwurf nach Neuladen weg: ' + JSON.stringify(vals));
      if ((await letterOf(page)) !== L) fail('Buchstabe nach Neuladen anders');
    }
    await startBtn(page);
    await page.waitForSelector('.sl-cat');
    st = await hostState(page);
    const cards = await checkReveal(page, st, `solo Runde ${r + 1}`);
    const me = st.players[0].id;
    if (r === 0) {
      const row = cards[0].rows[0];
      if (row.pts !== '+10' || !/ungeprüft – halbe Punkte/.test(row.tag)) fail('Ungeprüftes Wort allein: ' + JSON.stringify(row));
      if (cards[1].rows[0].pts !== '+20') fail('Allein bekanntes Wort sollte 20 geben: ' + cards[1].rows[0].pts);
      if (cards[5].rows[0].ans !== '–' || cards[5].rows[0].pts !== '0') fail('Leeres Feld: ' + JSON.stringify(cards[5].rows[0]));
      if (await page.$('[data-act=vote]')) fail('Gilt-nicht-Knopf trotz fehlender anderer Menschen');
      await shot(page, 'solo_reveal');
    }
    if (r === 1) { const rows = cards.slice(0, 2).map((c) => c.rows[0].pts); if (rows.join() !== '+20,+20') fail('Groß/Klein/Leerzeichen: ' + rows); }
    if (r === 2) { const row = cards[2].rows[0]; if (row.pts !== '0' || !/passt nicht/.test(row.tag)) fail('Falscher Buchstabe: ' + JSON.stringify(row)); }
    total = st.scores[me];
    const li = await layoutInfo(page);
    if (li.bt !== lay[r].bt || li.bh !== lay[r].bh) fail(`Brett springt zwischen Eingabe und Auflösung: ${JSON.stringify(lay[r])} ${JSON.stringify(li)}`);
    await overflow(page, `solo reveal ${r + 1}`);
    await smallButtons(page, `solo reveal ${r + 1}`);
    const sub = ((await page.textContent('#board .sl-sub')) || '').trim();
    if (!/Du hast in dieser Runde \d+ Punkte? geholt/.test(sub)) fail('Summe der Runde: ' + sub);
    const label = ((await page.textContent('[data-act=next]')) || '').trim();
    if (label !== (r === 3 ? 'Zum Endergebnis' : 'Nächste Runde')) fail('Knopf: ' + label);
    await page.click('[data-act=next]');
  }
  const pos = lay.map((l) => l.bt + '/' + l.ft);
  if (new Set(lay.map((l) => l.bt)).size !== 1 || new Set(lay.map((l) => l.ft)).size !== 1) fail('Lage der Felder wechselt zwischen Runden: ' + pos);
  await page.waitForSelector('.sl-over');
  const h1 = ((await page.textContent('.over h1')) || '').trim();
  if (!new RegExp(`^Du hast ${total} Punkte!$`).test(h1)) fail(`Titel "${h1}" (Punkte ${total})`);
  const best = await page.evaluate(() => localStorage.getItem('zh.sl_best_4_6'));
  if (Number(best) !== total) fail('Bestleistung nicht gemerkt ' + best);
  if (!(await page.$('canvas.confetti'))) fail('Kein Konfetti bei Bestleistung');
  console.log(`Allein: Buchstaben ${letters.join('')}, Endstand ${total}, Titel "${h1}", Bestleistung gemerkt, Konfetti`);
  await shot(page, 'solo_over');
  await overflow(page, 'solo over');
  await ctx.close();
}

// ================================================================ gegen Computer
async function botRun(browser, level, n, more) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'bot' + level);
  await page.goto(base + `?seed=${20 + level}`);
  await page.fill('#name', 'Berta');
  await page.check('[data-opt=kurz]');
  if (more) await page.check('[data-opt=more]');
  await page.evaluate(() => { window.__botMs = 700; });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  const cats = more ? 8 : 6;
  let sawWait = false;
  for (let r = 0; r < 4; r++) {
    await page.waitForSelector('.sl-in');
    if ((await page.$$eval('.sl-in', (i) => i.length)) !== cats) fail('Felder ' + cats);
    await fillRound(page);
    await startBtn(page);
    if (r === 0) {
      const bn = ((await page.textContent('.banner')) || '').trim();
      sawWait = n === 1 ? /^Warte auf: Computer$/.test(bn) : /^Warte auf: Computer 1, Computer 2/.test(bn);
      if (!sawWait) fail(`Warte-Banner "${bn}"`);
      if (await page.$('.sl-cat')) fail('Auflösung, obwohl Computer noch nicht fertig');
      const dis = await page.$$eval('.sl-in', (i) => i.every((x) => x.disabled));
      if (!dis) fail('Felder nach Fertig nicht gesperrt');
      const ro = await page.$('[data-act=reopen]');
      if (!ro) fail('Doch noch ändern fehlt');
      await shot(page, `bot${level}_warten`, false);
      await page.evaluate(() => { window.__botMs = 40; });
    }
    await page.waitForSelector('.sl-cat');
    const st = await hostState(page);
    await checkReveal(page, st, `bot${level} Runde ${r + 1}`);
    if (st.players.length !== n + 1) fail('Spieler ' + st.players.length);
    for (const p of st.players) if (Q.isBotId(p.id)) for (const c of st.reveal.cats) if (c.rows[p.id].st === 'unknown') fail('Computer mit ungeprüftem Wort');
    if (r === 0) { await shot(page, `bot${level}_reveal`); if (await page.$('[data-act=vote]')) fail('Abstimmen gegen Computer möglich'); }
    if (r === 2) { await page.reload(); await page.waitForSelector('.sl-cat'); }
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.sl-over');
  const st = await hostState(page);
  const rk = await page.$$eval('.ranking li', (l) => l.map((x) => ({ n: x.querySelector('.rn').textContent.replace(/\s*\(du\)/, '').trim(), p: Number(x.querySelector('.rt').textContent) })));
  if (rk.length !== n + 1) fail('Rangliste ' + rk.length);
  for (const p of st.players) { const row = rk.find((r) => r.n === p.name); if (!row || row.p !== st.scores[p.id]) fail(`Rangliste ${p.name}`); }
  const mx = Math.max(...Object.values(st.scores));
  const iWon = st.scores[st.players[0].id] === mx;
  const h1 = ((await page.textContent('.over h1')) || '').trim();
  if (iWon && !/^Du (hast|und)/.test(h1)) fail('Titel (gewonnen) ' + h1);
  if (!iWon && /^Du/.test(h1)) fail('Titel nennt mich, obwohl ich nicht gewonnen habe: ' + h1);
  if (!/gewonnen/.test(h1)) fail('Titel ohne gewonnen: ' + h1);
  if (iWon && !(await page.$('canvas.confetti'))) fail('Kein Konfetti trotz Sieg');
  console.log(`Gegen ${n} Computer (${level ? 'Mittel' : 'Leicht'}, ${cats} Kategorien): Rangliste ${JSON.stringify(rk)}; Titel "${h1}"`);
  if (level === 1) await shot(page, `bot_over`);
  await ctx.close();
}

// ================================================================ Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.waitForSelector('[data-act=learn]');
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  await shot(page, 'lern_1');
  const texts = []; let steps = 0; let idle = 0; let finished = false;
  const WORDS = { B: ['Berlin', 'Belgien', 'Biber'], S: ['Stuttgart', 'Spanien', 'Schaf'] };
  while (steps < 80) {
    const text = ((await page.textContent('.coach .coach-t')) || '').trim();
    if (!text || text.length > 220) fail(`Lernrunde Textlänge ${text.length}: ${text}`);
    if (!texts.includes(text)) { texts.push(text); if (texts.length === 2 || texts.length === 5 || texts.length === 8) await shot(page, `lern_${texts.length}`); }
    const target = page.locator('.coach-target').first();
    if (await target.count() === 0) {
      if (++idle > 300) { fail('Lernrunde: kein Ziel: ' + text); break; }
      await page.waitForTimeout(15); continue;
    }
    idle = 0;
    const act = await target.getAttribute('data-act');
    if (act === 'again') { finished = true; await shot(page, 'lern_ende'); break; }
    const di = await target.getAttribute('data-i');
    if (di !== null) {
      const L = await letterOf(page);
      await target.fill(WORDS[L][Number(di)]);
      await page.keyboard.press('Enter'); // wie ein Mensch: zum nächsten Feld
      steps++;
      continue;
    }
    try { await target.click({ timeout: 4000 }); } catch (e) { fail('Lernrunde Klick: ' + e.message.split('\n')[0]); break; }
    steps++;
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde Endtext');
  if (new Set(texts).size !== texts.length) fail('Lernrunde: Text doppelt');
  console.log(`Lernrunde: ${steps} Schritte, ${texts.length} verschiedene Texte (jeder nur einmal)`);
  for (const t of texts) console.log('   -', t);
  const need = ['Buchstabe', 'Fertig', '10 Punkte', '5 Punkte', '20', 'ungeprüft', 'Nächste Runde', 'Zum Endergebnis', 'Auflösung'];
  for (const w of need) if (!texts.some((t) => t.includes(w))) fail('Lernrunde erklärt nicht: ' + w);
  await page.click('[data-act=again]');
  await page.waitForSelector('.coach');
  if ((await letterOf(page)) !== 'B') fail('Lernrunde startet nicht mit B');
  if ((await page.$$eval('.sl-in', (i) => i.length)) !== 3) fail('Lernrunde: 3 Felder erwartet');
  await page.reload();
  await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => fail('nach Neuladen keine Lernrunde'));
  await page.click('[data-act=learn-stop]');
  await page.waitForTimeout(150);
  if (await page.locator('.coach').count()) fail('Anleitung bleibt nach Beenden');
  if (await page.locator('.coach-target').count()) fail('Pulsieren bleibt nach Beenden');
  await ctx.close();
}

// ================================================================ Gastgeber + Gast (Mock)
async function stateOf(host, guest) {
  const h = (await hostState(host, 'sessionStorage'));
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
  await A.check('[data-opt=stop]');
  await A.check('[data-opt=more]');
  await A.click('[data-act=start]');
  await A.waitForSelector('.sl-in'); await B.waitForSelector('.sl-in');
  let st = await same(A, B, 'Start');
  if (st.rounds !== 4 || st.players.length !== 2 || st.cats.length !== 8 || !st.stopOpt) fail('Spielstart: ' + JSON.stringify({ r: st.rounds, c: st.cats.length, s: st.stopOpt }));
  // ---- Runde 1: Tippen wird durch Zustandsmeldungen nicht gestört; Entwürfe des anderen nie im DOM
  const L = await letterOf(A);
  if ((await letterOf(B)) !== L) fail('Gast sieht anderen Buchstaben');
  const ids = await catIds(A);
  const wA = ids.map((c) => knownWord(c, L, 0));
  const wB = ids.map((c, i) => (i === 0 ? L + 'lumenhausen' : knownWord(c, L, 0)));
  await A.focus('.sl-in[data-i="0"]');
  const typing = A.keyboard.type(wA[0], { delay: 120 });
  for (let i = 1; i < 8; i++) { await B.fill(`.sl-in[data-i="${i}"]`, wB[i]); await B.waitForTimeout(40); }
  await B.fill('.sl-in[data-i="0"]', wB[0]);
  await typing;
  const act = await A.evaluate(() => ({ i: document.activeElement.dataset && document.activeElement.dataset.i, v: document.activeElement.value }));
  if (act.i !== '0' || act.v !== wA[0]) fail('Tippen gestört: ' + JSON.stringify(act));
  for (let i = 1; i < 8; i++) await A.fill(`.sl-in[data-i="${i}"]`, wA[i]);
  await A.waitForTimeout(600);
  const htmlA = await A.content(); const htmlB = await B.content();
  // Wörter, die nur der Andere hat (Gast-Wort 0) bzw. nur A hat
  if (htmlA.includes(wB[0])) fail('Gastgeber sieht Entwurf des Gastes im DOM');
  if (htmlB.includes(wA[0]) && wA[0] !== wB[0]) fail('Gast sieht Entwurf des Gastgebers im DOM');
  // gleiche Wörter in Feld 1..7 sind bei beiden gleich (Wörterbuch), also Prüfung nur auf Feld 0
  st = await same(A, B, 'Runde 1 offen');
  if (st.drafts[st.players[0].id][0] !== wA[0] || st.drafts[st.players[1].id][0] !== wB[0]) fail('Entwürfe im Zustand falsch');
  if (!(await B.$eval('[data-act=stop]', (b) => !b.disabled))) fail('STOPP nicht aktiv, obwohl alle Felder voll');
  // Feld leeren -> STOPP gesperrt
  await B.fill('.sl-in[data-i="7"]', '');
  if (!(await B.$eval('[data-act=stop]', (b) => b.disabled))) fail('STOPP trotz leerem Feld aktiv');
  await B.fill('.sl-in[data-i="7"]', wB[7]);
  // Neuladen mitten in der Runde: Entwurf bleibt (Gast und Gastgeber)
  await A.reload(); await A.waitForSelector('.sl-in');
  await B.reload(); await B.waitForSelector('.sl-in');
  const valsB = await B.$$eval('.sl-in', (i) => i.map((x) => x.value));
  if (JSON.stringify(valsB) !== JSON.stringify(wB)) fail('Gast: Entwurf nach Neuladen weg ' + JSON.stringify(valsB));
  const valsA = await A.$$eval('.sl-in', (i) => i.map((x) => x.value));
  if (JSON.stringify(valsA) !== JSON.stringify(wA)) fail('Gastgeber: Entwurf nach Neuladen weg ' + JSON.stringify(valsA));
  await same(A, B, 'nach Neuladen');
  await shot(A, 'duo_A_fill', false); await shot(B, 'duo_B_fill', false);
  // ---- STOPP von Anna, Bernd hat noch Zeit; Bernd ändert noch ein Feld (zählt)
  await B.fill('.sl-in[data-i="1"]', ''); // Bernd lässt ein Feld leer
  await B.waitForTimeout(600);
  await A.evaluate(() => { window.__timerMs = 1500; }); // Frist verkürzen (Gastgeber)
  if (await A.$eval('[data-act=stop]', (b) => b.disabled)) fail('STOPP bei Anna gesperrt, obwohl alle Felder voll: ' + JSON.stringify(await A.$$eval('.sl-in', (i) => i.map((x) => x.value))));
  await A.click('[data-act=stop]');
  await B.waitForFunction(() => /STOPP von Anna/.test(document.querySelector('.banner').textContent)).catch(async () => { fail('B Banner: ' + (await B.textContent('.banner')) + ' | A: ' + (await A.textContent('.banner'))); throw new Error('abbruch'); });
  if (!(await B.$('.sl-timer i'))) fail('Gast ohne Balken');
  if (!(await B.$eval('[data-act=stop]', (b) => b.disabled))) fail('Gast kann nach Stopp erneut STOPP tippen');
  const bnA = ((await A.textContent('.banner')) || '').trim();
  if (!/Du hast STOPP gerufen\. Warte auf: Bernd/.test(bnA)) fail('A Banner "' + bnA + '"');
  if ((await A.$$eval('.sl-in', (i) => i.every((x) => x.disabled))) !== true) fail('A Felder nicht gesperrt');
  if (await A.$eval('[data-act=reopen]', (b) => !b.disabled)) fail('Doch-noch-ändern nach Stopp möglich');
  await shot(B, 'duo_B_stop', false);
  // Bernd füllt das Feld wieder, Frist läuft ab (ohne Fertig)
  await B.fill('.sl-in[data-i="1"]', knownWord(ids[1], L, 1));
  await A.waitForSelector('.sl-cat', { timeout: 10000 }); await B.waitForSelector('.sl-cat', { timeout: 10000 });
  st = await same(A, B, 'Runde 1 Auflösung');
  if (st.reveal.cats[0].rows[st.players[1].id].st !== 'unknown') fail('Blumenhausen nicht ungeprüft');
  const bEntry = st.reveal.cats[1].rows[st.players[1].id];
  if (bEntry.a !== knownWord(ids[1], L, 1)) fail('Nach Fristablauf zählt der Eintrag nicht: ' + bEntry.a);
  await checkReveal(A, st, 'duo A R1'); await checkReveal(B, st, 'duo B R1');
  // ---- Abstimmen: Anna zweifelt Bernds ungeprüftes Wort an; Bernd sieht keinen Knopf bei seinem
  if (await B.$('[data-act=vote]')) fail('Bernd kann über sein eigenes Wort abstimmen');
  const votes = await A.$$('[data-act=vote]');
  if (votes.length !== 1) fail('Gilt nicht: ' + votes.length + ' Knöpfe bei A');
  const scoreBefore = st.scores[st.players[1].id];
  const hint = ((await A.textContent('.sl-hint')) || '');
  if (!/Gilt nicht/.test(hint)) fail('Hinweis zum Anzweifeln fehlt');
  await shot(A, 'duo_A_reveal');
  await A.click('[data-act=vote]');
  await B.waitForFunction(() => document.querySelector('.sl-tag.bad') !== null);
  st = await same(A, B, 'nach Abstimmung');
  if (st.reveal.cats[0].rows[st.players[1].id].pts !== 0 || !st.reveal.cats[0].rows[st.players[1].id].rejected) fail('Wort gilt trotz Mehrheit');
  if (st.scores[st.players[1].id] >= scoreBefore) fail('Punkte sinken nicht nach Abstimmung');
  await checkReveal(A, st, 'duo A nach Abstimmung'); await checkReveal(B, st, 'duo B nach Abstimmung');
  if ((await A.textContent('[data-act=vote]')).indexOf('zurücknehmen') < 0) fail('Zurücknehmen-Text fehlt');
  await shot(B, 'duo_B_reveal');
  await A.click('[data-act=vote]'); // zurücknehmen
  await B.waitForFunction(() => !document.querySelector('.sl-tag.bad'));
  st = await same(A, B, 'Abstimmung zurück');
  if (st.scores[st.players[1].id] !== scoreBefore) fail('Punkte nach Zurücknehmen nicht wie vorher');
  // Gast hat kein Weiter
  if (await B.$('[data-act=next]')) fail('Gast sieht Weiter');
  if (!/Gastgeber/.test(await B.textContent('.sl-wait'))) fail('Gast ohne Hinweis auf den Gastgeber');
  await overflow(A, 'duo A reveal'); await overflow(B, 'duo B reveal');
  await A.click('[data-act=next]');
  await A.waitForSelector('.sl-in'); await B.waitForSelector('.sl-in');
  st = await same(A, B, 'Runde 2');
  if (st.round !== 1 || st.phase !== 'fill') fail('Runde 2 nicht frisch');
  if ((await B.$$eval('.sl-in', (i) => i.some((x) => x.value))) !== false) fail('Runde 2: Felder nicht leer');
  // ---- Runden 2-4 ohne Stopp: beide Fertig; Anna "Doch noch ändern"
  for (let r = 1; r < 4; r++) {
    await A.waitForSelector('.sl-in'); await B.waitForSelector('.sl-in');
    const f = await fillRound(A); await fillRound(B, { k: 1 });
    await A.waitForTimeout(500);
    await A.click('[data-act=done]');
    await B.waitForFunction(() => /Warte auf: Bernd|Runde/.test(document.querySelector('.banner').textContent));
    const bnB = ((await B.textContent('.banner')) || '').trim();
    if (!/Runde \d von 4 – schreibe los!/.test(bnB)) fail('B Banner "' + bnB + '"');
    if (!(await B.$('.banner.mine'))) fail('B Banner sollte grün sein');
    const bnA2 = ((await A.textContent('.banner')) || '').trim();
    if (bnA2 !== 'Warte auf: Bernd') fail('A Banner "' + bnA2 + '"');
    if (r === 1) { // Doch noch ändern
      await A.click('[data-act=reopen]');
      await A.waitForSelector('.sl-in:not([disabled])');
      await A.fill('.sl-in[data-i="0"]', knownWord(f.ids[0], f.L, 2));
      await A.click('[data-act=done]');
      await B.waitForFunction(() => document.querySelector('.banner') && !document.querySelector('.banner.done'));
    }
    await B.click('[data-act=done]');
    await A.waitForSelector('.sl-cat'); await B.waitForSelector('.sl-cat');
    st = await same(A, B, `Runde ${r + 1} Auflösung`);
    await checkReveal(A, st, `duo A R${r + 1}`); await checkReveal(B, st, `duo B R${r + 1}`);
    const ca = (await A.textContent('.sl-rank')).replace(/\(du\)/g, '').replace(/\s+/g, '');
    const cb = (await B.textContent('.sl-rank')).replace(/\(du\)/g, '').replace(/\s+/g, '');
    if (ca !== cb) fail('Rangliste verschieden');
    if (r === 1 && st.reveal.cats[0].rows[st.players[0].id].a !== knownWord(f.ids[0], f.L, 2)) fail('Doch noch ändern: neuer Text zählt nicht');
    if (r < 3) await A.click('[data-act=next]');
    else { await A.click('[data-act=next]'); await A.waitForSelector('.sl-over'); await B.waitForSelector('.sl-over'); }
  }
  st = await same(A, B, 'Ende');
  if (st.phase !== 'over') fail('Phase am Ende ' + st.phase);
  const ra = (await A.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  const rb = (await B.textContent('.ranking')).replace(/\(du\)/g, '').replace(/\s+/g, '');
  if (ra !== rb) fail('Endrangliste verschieden: ' + ra + ' / ' + rb);
  const h1A = ((await A.textContent('.over h1')) || '').trim(); const h1B = ((await B.textContent('.over h1')) || '').trim();
  console.log(`Host+Gast: Zustände nach jedem Schritt identisch; Stopp, Abstimmen, Neuladen ok; Titel A "${h1A}", B "${h1B}"; Rangliste ${ra}`);
  if (!(await A.$('[data-act=again]')) || (await B.$('[data-act=again]'))) fail('again-Knopf nur für den Gastgeber erwartet');
  await shot(A, 'duo_A_over'); await shot(B, 'duo_B_over');
  await B.reload(); await B.waitForSelector('.sl-over', { timeout: 10000 });
  await A.click('[data-act=again]');
  await A.waitForSelector('.sl-in'); await B.waitForSelector('.sl-in');
  st = await same(A, B, 'neues Spiel');
  if (st.round !== 0 || st.phase !== 'fill' || st.scores[st.players[0].id] !== 0) fail('Neues Spiel nicht frisch');
  await ctx.close();
}

// ================================================================ Layout 390x844 und Desktop, Hilfe
async function layoutRun(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'layout');
  await page.goto(base + '?seed=3');
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  const t = await page.textContent('.modal');
  for (const w of ['Fertig', 'Gilt nicht', 'STOPP', '20 Punkte', '10 Punkte', '5 Punkte', 'Wörterbuch', 'ungeprüft']) if (!t.includes(w)) fail('Hilfe ohne: ' + w);
  if (/stadt land fluss online|scattergories|tutti frutti/i.test(t)) fail('Marke in der Hilfe');
  await shot(page, 'help', false);
  await page.click('.modal [data-act=help-close]');
  await page.fill('#name', 'Anna');
  await page.check('[data-opt=more]');
  await page.check('[data-opt=stop]');
  await page.click('[data-act=solo]');
  await page.waitForSelector('.sl-in');
  if ((await page.$$eval('.sl-in', (i) => i.length)) !== 8) fail('8 Felder erwartet');
  if (await page.$('[data-act=stop]')) fail('STOPP im Alleinspiel sichtbar');
  await overflow(page, 'Layout 8 Felder'); await smallButtons(page, 'Layout 8 Felder');
  const l1 = await layoutInfo(page);
  await fillRound(page);
  const l2 = await layoutInfo(page);
  if (l1.bt !== l2.bt || l1.ft !== l2.ft) fail('Layout springt beim Ausfüllen');
  await shot(page, 'solo8_fill');
  // große Schrift
  await page.click('[data-act=bigger]');
  await overflow(page, 'große Schrift'); await smallButtons(page, 'große Schrift');
  await shot(page, 'big_fill', false);
  await page.click('[data-act=bigger]');
  await ctx.close();
  const ctx2 = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
  const d = await newPage(ctx2, 'desktop');
  await d.goto(base + '?seed=2');
  await d.fill('#name', 'Anna');
  await d.click('[data-act=solo]');
  await d.waitForSelector('.sl-in');
  await shot(d, 'desktop_fill', false);
  await overflow(d, 'Desktop');
  await fillRound(d);
  await d.click('[data-act=done]');
  await d.waitForSelector('.sl-cat');
  await shot(d, 'desktop_reveal', false);
  await overflow(d, 'Desktop Auflösung');
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
  Q = await import('../stadt/engine.js');
  WOERTER = (await import('../stadt/woerter.js')).WOERTER;
  for (const [id, label] of Object.entries(Q.CATS)) CAT_ID[label] = id;
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const run = async (name, fn) => { if (only && !only.includes(name)) return; const t0 = Date.now(); try { await fn(); } catch (e) { fail(`${name}: ${e.stack || e.message}`); } console.log(`-- ${name} fertig (${((Date.now() - t0) / 1000).toFixed(1)} s)`); };
  await run('solo', () => soloRun(browser));
  await run('bot0', () => botRun(browser, 0, 2, false));
  await run('bot1', () => botRun(browser, 1, 3, true));
  await run('bot2', () => botRun(browser, 1, 1, false));
  await run('lern', () => lernrunde(browser));
  await run('duo', () => duoRun(browser));
  await run('layout', () => layoutRun(browser));
  await browser.close();
  if (srv) { try { srv.kill(); } catch { /* egal */ } }
  else { try { execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`); } catch { /* egal */ } }
  if (errors.length) { console.log(`\n${errors.length} FEHLER`); process.exit(1); }
  console.log('\nALLE E2E-TESTS BESTANDEN (Konsole fehlerfrei)');
})().catch((e) => { console.error(e); process.exit(2); });
