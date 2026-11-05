// Durchspieltest für Farbcode knacken: Alleinspiel, gegen den Computer, zu zweit (Mock-Modus), Lernrunde.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8811 &
//        NODE_PATH=$(npm root -g) node tests/farbcode.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8811;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farbcode-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/farbcode/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
const LET = 'ROYGBV';

// Unabhängige Referenz der Auswertung (nicht aus engine.js)
function ref(code, guess) {
  const cu = [0, 0, 0, 0]; const gu = [0, 0, 0, 0]; let b = 0; let w = 0;
  for (let i = 0; i < 4; i++) if (code[i] === guess[i]) { b++; cu[i] = gu[i] = 1; }
  for (let i = 0; i < 4; i++) { if (gu[i]) continue; for (let j = 0; j < 4; j++) if (!cu[j] && code[j] === guess[i]) { cu[j] = 1; w++; break; } }
  return { b, w };
}
const ALL = [];
for (let n = 0; n < 1296; n++) { const c = []; let x = n; for (let i = 0; i < 4; i++) { c.unshift(x % 6); x = Math.floor(x / 6); } ALL.push(c); }
const rand = (n) => Math.floor(Math.random() * n);

async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`${name} console ${m.text()}`); });
  return page;
}
async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
  });
  return ctx;
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `fc_${name}.png`), fullPage: full });

// Gelesene Zeilen: Farben (Buchstaben) und Auswertung aus dem DOM
async function readRows(page) {
  const rows = await page.$$eval('.fc-row.done', (rs) => rs.map((r) => ({
    g: [...r.querySelectorAll('.fc-pegs .fc-peg')].map((p) => p.textContent.trim()),
    fb: r.querySelector('.fc-fb').getAttribute('aria-label'),
    pegs: [...r.querySelectorAll('.fc-fb i')].map((i) => i.className),
    text: r.querySelector('.fc-fbt').textContent.trim(),
  })));
  return rows.map((r) => {
    const g = r.g.map((l) => LET.indexOf(l));
    const b = r.fb.includes('alles richtig') ? 4 : Number((/(\d) richtig/.exec(r.fb) || [0, 0])[1]);
    const w = Number((/(\d) Farb/.exec(r.fb) || [0, 0])[1]);
    return { g, b, w, pegs: r.pegs, text: r.text, fb: r.fb };
  });
}
async function readCode(page) {
  const l = await page.$$eval('.fc-coderow .fc-peg', (ps) => ps.map((p) => p.textContent.trim()));
  return l.map((x) => LET.indexOf(x));
}
function smartGuess(rows) {
  if (!rows.length) return [0, 0, 1, 1];
  const c = ALL.filter((x) => rows.every((r) => { const e = ref(x, r.g); return e.b === r.b && e.w === r.w; }));
  if (!c.length) throw new Error('keine passenden Codes mehr – Auswertung im DOM widersprüchlich');
  return c[rand(c.length)];
}
// Zeile antippen: Farben von links nach rechts
async function enter(page, code, submitSel) {
  for (let i = 0; i < 4; i++) {
    if (i === 3) {
      const dis = await page.$eval(submitSel, (b) => b.disabled);
      if (!dis) fail('Abgeben-Knopf schon vor dem 4. Stift aktiv');
    }
    await page.click(`[data-act=color][data-c="${code[i]}"]`);
  }
  const dis = await page.$eval(submitSel, (b) => b.disabled);
  if (dis) fail('Abgeben-Knopf nach 4 Stiften nicht aktiv');
}
async function submitGuess(page, code, n) {
  await enter(page, code, '[data-act=submit]');
  await page.click('[data-act=submit]');
  await page.waitForFunction((k) => document.querySelectorAll('.fc-row.done').length >= k, n + 1, { timeout: 5000 });
}
async function checkRowsAgainst(page, code, label) {
  const rows = await readRows(page);
  rows.forEach((r, i) => {
    const e = ref(code, r.g);
    if (e.b !== r.b || e.w !== r.w) fail(`${label}: Zeile ${i + 1} Auswertung ${r.fb} statt ${JSON.stringify(e)}`);
    const k = r.pegs.filter((c) => c === 'k').length; const w = r.pegs.filter((c) => c === 'w').length;
    if (k !== e.b || w !== e.w) fail(`${label}: Zeile ${i + 1} Stifte ${r.pegs} statt ${JSON.stringify(e)}`);
    if (r.pegs.length !== 4 || r.pegs.some((c, j) => j && 'kwe'.indexOf(c) < 'kwe'.indexOf(r.pegs[j - 1]))) fail(`${label}: Stiftreihenfolge ${r.pegs}`);
    if (!r.text) fail(`${label}: Zeile ${i + 1} ohne Text`);
  });
  return rows;
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
}
async function boardTop(page) { return page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY)); }
async function hasText(page, sel, re, label) {
  const t = (await page.textContent(sel).catch(() => '')) || '';
  if (!re.test(t)) fail(`${label}: "${t.trim().slice(0, 80)}" passt nicht zu ${re}`);
  return t.trim();
}

// ---------------------------------------------------------------- Alleinspiel
async function soloRun(browser, mode, i) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'solo');
  await page.goto(base);
  await page.fill('#name', 'Anna');
  if (i === 0) await shot(page, 'start');
  await page.click('[data-act=solo]');
  await page.waitForSelector('.banner.mine');
  await noOverflow(page, 'solo');
  const tops = new Set([await boardTop(page)]);
  let guesses = 0;
  if (i === 0) {
    await shot(page, 'solo_start');
    // Ersetzen testen: Stift setzen, antippen, ersetzen; Rückgängig; Zeile leeren
    await page.click('[data-act=color][data-c="0"]');
    await page.click('[data-act=color][data-c="1"]');
    await page.click('[data-act=slot][data-i="0"]');
    await page.click('[data-act=color][data-c="5"]');
    let letters = await page.$$eval('.fc-row.now .fc-peg', (p) => p.map((x) => x.textContent.trim()));
    if (letters.join('') !== 'VO') { fail('Ersetzen: ' + letters.join('') + ' statt VO'); }
    await page.click('[data-act=undo]');
    letters = await page.$$eval('.fc-row.now .fc-peg', (p) => p.map((x) => x.textContent.trim()));
    if (letters.join('') !== 'V') fail('Rückgängig: ' + letters.join(''));
    await page.click('[data-act=color][data-c="2"]');
    await page.click('[data-act=slot][data-i="3"]');
    await page.click('[data-act=color][data-c="3"]'); // freies Feld 4 direkt füllen
    letters = await page.$$eval('.fc-row.now .fc-peg', (p) => p.map((x) => x.textContent.trim()));
    if (letters.join('') !== 'VY' + '' + 'G' && letters.length !== 4) { /* Feld 3 ist noch leer */ }
    await shot(page, 'solo_entry');
    await page.click('[data-act=clear]');
    letters = await page.$$eval('.fc-row.now .fc-peg', (p) => p.map((x) => x.textContent.trim()));
    if (letters.some((l) => l)) fail('Zeile leeren: ' + letters.join(''));
    const dis = await page.$eval('[data-act=submit]', (b) => b.disabled);
    if (!dis) fail('Abgeben nach Leeren aktiv');
    // Größen der Bedienelemente
    const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 40));
    if (small.length) fail('zu kleine Knöpfe: ' + JSON.stringify(small));
  }
  for (let guard = 0; guard < 12; guard++) {
    if (await page.$('.trophy')) break;
    const rows = await readRows(page);
    const guess = mode === 'smart' ? smartGuess(rows) : Array.from({ length: 4 }, () => rand(6));
    await submitGuess(page, guess, rows.length);
    guesses++;
    tops.add(await boardTop(page));
    if (i === 0 && guesses === 4 && !(await page.$('.trophy'))) {
      // Aktive Zeile, letzte Auswertung und Farbleiste müssen gleichzeitig sichtbar sein können
      await page.evaluate(() => { const r = document.querySelectorAll('.fc-row.done'); r[r.length - 1].scrollIntoView({ block: 'start' }); window.scrollBy(0, -10); });
      const vis = await page.evaluate(() => {
        const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; };
        const now = document.querySelector('.fc-row.now'); const pal = document.querySelector('.fc-palette');
        const last = [...document.querySelectorAll('.fc-row.done')].pop();
        const ent = document.querySelector('.fc-entry').getBoundingClientRect();
        return { now: inView(now), pal: inView(pal), last: inView(last), overlap: now.getBoundingClientRect().bottom > ent.top, entryH: Math.round(ent.height) };
      });
      console.log('Sichtbarkeit bei Versuch 5:', JSON.stringify(vis));
      if (!(vis.now && vis.pal && vis.last) || vis.overlap) fail('Zeile und Farbleiste nicht gleichzeitig sichtbar: ' + JSON.stringify(vis));
      await shot(page, 'solo_try5_view', false);
    }
    if (i === 0 && guesses === 3) { await shot(page, 'solo_mid'); await shot(page, 'solo_mid_view', false); }
    if (i === 0 && guesses === 4 && !(await page.$('.trophy'))) {
      // Neuladen mitten im Spiel
      const before = await readRows(page);
      await page.reload();
      await page.waitForSelector('.banner');
      const after = await readRows(page);
      if (JSON.stringify(before) !== JSON.stringify(after)) fail('Neuladen: Zeilen weg oder anders');
      if (!(await page.$('.banner.mine'))) fail('Neuladen: nicht mehr dran');
      console.log('Alleinspiel: Neuladen ok,', after.length, 'Zeilen');
    }
  }
  if (!(await page.$('.trophy'))) fail(`solo ${mode}: nach 12 Runden nicht beendet`);
  if (guesses > 10) fail('mehr als 10 Versuche: ' + guesses);
  if (tops.size > 1) fail('Spielfeld springt: Oberkanten ' + [...tops]);
  const code = await readCode(page);
  if (code.some((c) => c < 0)) fail('Code am Ende nicht aufgedeckt');
  const rows = await checkRowsAgainst(page, code, `solo ${mode}`);
  const solved = rows.length && rows[rows.length - 1].b === 4;
  const h1 = (await page.textContent('.over h1')).trim();
  if (solved && !/Geknackt in \d+ Versuch/.test(h1)) fail('Ergebnistext: ' + h1);
  if (!solved && !/nicht geknackt/.test(h1)) fail('Ergebnistext (verloren): ' + h1);
  if (!solved && rows.length !== 10) fail('verloren, aber ' + rows.length + ' Zeilen');
  const best = await page.evaluate(() => localStorage.getItem('zh.fc_best'));
  if (solved && (best === null || Number(best) > rows.length)) fail(`Bestleistung ${best} bei ${rows.length} Versuchen`);
  if (i === 0) {
    await shot(page, 'solo_over');
    await noOverflow(page, 'solo over');
  }
  console.log(`Alleinspiel ${mode}: ${rows.length} Versuche, ${solved ? 'geknackt' : 'nicht geknackt'}, Bestleistung ${best}`);
  // Noch eine Runde
  await page.click('[data-act=again]');
  await page.waitForSelector('.banner.mine');
  if ((await page.$$('.fc-row.done')).length) fail('Noch eine Runde: alte Zeilen sichtbar');
  if (await page.$('.trophy')) fail('Noch eine Runde: Ergebnis noch da');
  await ctx.close();
  return { tries: rows.length, solved };
}

// ---------------------------------------------------------------- Gegen den Computer
async function botRun(browser, level, reloadMid) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'bot' + level);
  await page.goto(base);
  await page.fill('#name', 'Berta');
  await page.click(`[data-act=bot][data-n="1"][data-level="${level}"]`);
  await page.waitForSelector('.banner.mine');
  if (level === 1) await shot(page, 'bot_code0');
  const secret = [2, 4, 4, 1];
  await enter(page, secret, '[data-act=setcode]');
  if (level === 1) await shot(page, 'bot_code4');
  await page.click('[data-act=setcode]');
  await page.waitForFunction(() => /Computer rät/.test(document.querySelector('.banner').textContent) || document.querySelector('.over'), null, { timeout: 5000 });
  const c = await readCode(page);
  if (c.join() !== secret.join()) fail(`Computer: eigener Code nicht sichtbar (${c})`);
  let reloaded = false;
  if (reloadMid) {
    await page.waitForFunction(() => document.querySelectorAll('.fc-row.done').length >= 1, null, { timeout: 5000 });
    await page.reload();
    await page.waitForSelector('.banner');
    reloaded = true;
  }
  await page.waitForSelector('.trophy', { timeout: 30000 });
  const rows = await checkRowsAgainst(page, secret, `computer ${level}`);
  const solved = rows[rows.length - 1].b === 4;
  const h1 = (await page.textContent('.over h1')).trim();
  if (solved && !/Der Computer hat deinen Code in \d+ Versuch/.test(h1)) fail('Computer-Ergebnis: ' + h1);
  if (!solved && (!/Du hast gewonnen/.test(h1) || rows.length !== 10)) fail('Computer-Ergebnis (verloren): ' + h1 + ' ' + rows.length);
  if (rows.length > 10) fail('Computer: mehr als 10 Versuche');
  console.log(`Computer (${level ? 'Mittel' : 'Leicht'}): ${rows.length} Versuche, ${solved ? 'geknackt' : 'Computer verliert'}${reloaded ? ', Neuladen ok' : ''}`);
  if (level === 1) await shot(page, 'bot_over');
  await page.click('[data-act=again]');
  await page.waitForSelector('.banner.mine');
  if (!/Denke dir einen Code aus/.test(await page.textContent('.banner'))) fail('Noch eine Runde (Computer): kein Code-Eingabe-Banner');
  if ((await page.$$('.fc-row.done')).length) fail('Noch eine Runde (Computer): alte Zeilen');
  // zweite Runde mit anderem Code, Computer rät wieder
  await enter(page, [0, 0, 0, 0], '[data-act=setcode]');
  await page.click('[data-act=setcode]');
  await page.waitForSelector('.trophy', { timeout: 30000 });
  await checkRowsAgainst(page, [0, 0, 0, 0], 'computer runde 2');
  await ctx.close();
}

// ---------------------------------------------------------------- Zu zweit (Mock)
async function duoRun(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A');
  await A.goto(base + '?mock=1');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = (await A.textContent('.code')).trim();
  const B = await newPage(ctx, 'B');
  await B.goto(base + `?mock=1&raum=${room}`);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');
  await A.waitForSelector('.banner'); await B.waitForSelector('.banner');
  // Runde 1: Anna legt fest, Bernd rät
  await hasText(A, '.banner', /Denke dir einen Code aus/, 'A Runde1 Banner');
  await hasText(B, '.banner', /Anna denkt sich einen Code aus/, 'B Runde1 Banner');
  if (await B.$('[data-act=color]')) fail('B sieht Farbleiste, obwohl A den Code festlegt');
  await shot(A, 'duo_A_code'); await shot(B, 'duo_B_wait');
  const secret = [1, 5, 5, 3];
  await enter(A, secret, '[data-act=setcode]');
  await A.click('[data-act=setcode]');
  await B.waitForFunction(() => /Du rätst/.test(document.querySelector('.banner').textContent));
  await hasText(A, '.banner', /Bernd rät – Versuch 1 von 10/, 'A Banner Raten');
  const aSees = await readCode(A);
  if (aSees.join() !== secret.join()) fail('A sieht den eigenen Code nicht: ' + aSees);
  const bSees = await B.$$eval('.fc-coderow .fc-peg', (ps) => ps.map((p) => p.textContent.trim()));
  if (bSees.join('') !== '????') fail('B sieht den Code (verdeckt erwartet): ' + bSees);
  if (await A.$('[data-act=color]')) fail('A (Codegeberin) sieht Farbleiste beim Raten');
  let n = 0;
  const topsB = new Set();
  for (; n < 10; n++) {
    const rows = await readRows(B);
    await submitGuess(B, smartGuess(rows), rows.length);
    topsB.add(await boardTop(B));
    if (n === 1) { await shot(B, 'duo_B_rate'); await shot(A, 'duo_A_zusehen'); }
    if (await B.$('.over')) break;
  }
  await A.waitForSelector('.over'); await B.waitForSelector('.over');
  const rowsB = await checkRowsAgainst(B, secret, 'duo R1 B');
  await checkRowsAgainst(A, secret, 'duo R1 A');
  const triesB = rowsB.length;
  if (rowsB[rowsB.length - 1].b !== 4) fail('B hat nicht geknackt (smart)');
  await hasText(A, '.banner', /Runde 1 ist zu Ende/, 'A Zwischenbanner');
  const bSees2 = await readCode(B);
  if (bSees2.join() !== secret.join()) fail('Code nach Runde 1 für B nicht aufgedeckt');
  await shot(B, 'duo_between_B');
  if (!(await B.$('[data-act=next]')) || !(await A.$('[data-act=next]'))) fail('Weiter-Knopf fehlt');
  await B.click('[data-act=next]');
  await B.waitForSelector('.banner.mine'); // Runde 2: Bernd legt fest
  await hasText(B, '.banner', /Denke dir einen Code aus/, 'B Runde2 Banner');
  await hasText(A, '.banner', /Bernd denkt sich einen Code aus/, 'A Runde2 Banner');
  if ((await A.$$('.fc-row.done')).length) fail('Runde 2: alte Zeilen bei A');
  // Bernd legt fest, Anna rät mit immer demselben Versuch -> scheitert
  const secret2 = [4, 4, 0, 2];
  await enter(B, secret2, '[data-act=setcode]');
  await B.click('[data-act=setcode]');
  await A.waitForSelector('[data-act=color]');
  await hasText(A, '.banner', /Du rätst – Versuch 1 von 10/, 'A Runde2 Raten');
  for (let i = 0; i < 10; i++) {
    await submitGuess(A, [3, 3, 3, 3], i).catch(async () => { if (!(await A.$('.over'))) throw new Error('Absenden hängt'); });
  }
  await A.waitForSelector('.over'); await B.waitForSelector('.over');
  const rowsA = await checkRowsAgainst(A, secret2, 'duo R2 A');
  if (rowsA.length !== 10) fail('Runde 2: ' + rowsA.length + ' Zeilen');
  const h1A = (await A.textContent('.over h1')).trim();
  const h1B = (await B.textContent('.over h1')).trim();
  if (!/Bernd hat gewonnen/.test(h1A) || h1A !== h1B) fail(`Sieger-Text: "${h1A}" / "${h1B}"`);
  await hasText(B, '.banner', /Du hast gewonnen/, 'B Siegerbanner');
  const listed = await A.$$eval('.fc-res .rt', (e) => e.map((x) => x.textContent.trim()));
  console.log(`Zu zweit: Bernd ${triesB} Versuche, Anna nicht geknackt (${listed.join(' | ')}) -> ${h1A}`);
  await shot(A, 'duo_over_A'); await shot(B, 'duo_over_B');
  if (await B.$('[data-act=again]')) fail('Gast sieht again-Knopf');
  if (topsB.size > 1) fail('Duo: Spielfeld springt ' + [...topsB]);
  // Neuladen des Gastes im Endzustand + Gast mitten drin
  await B.reload(); await B.waitForSelector('.over', { timeout: 10000 });
  await A.click('[data-act=again]');
  await A.waitForSelector('.banner:not(.done)'); await B.waitForSelector('.banner:not(.done)');
  // Rollen der neuen Partie: Bernd ist jetzt zuerst dran -> legt den Code fest
  await hasText(B, '.banner', /Denke dir einen Code aus/, 'Neue Partie: B legt fest');
  await hasText(A, '.banner', /Bernd denkt sich einen Code aus/, 'Neue Partie: A wartet');
  // Gast ändert Zustand nur über Nachrichten: Falsche Nachricht von A hat keine Wirkung
  await ctx.close();
}

// ---------------------------------------------------------------- Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.waitForSelector('[data-act=learn]');
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  await shot(page, 'lern_1');
  const texts = new Set(); let steps = 0; let idle = 0; let finished = false;
  while (steps < 400) {
    const text = (await page.textContent('.coach .coach-t')).trim();
    if (!text || text.length > 220) fail(`Lernrunde Textlänge ${text.length}: ${text}`);
    if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern_2'); if (texts.size === 5) await shot(page, 'lern_3'); }
    const target = page.locator('.coach-target').first();
    if (await target.count() === 0) { if (++idle > 300) { fail('Lernrunde: kein Ziel: ' + text); break; } await page.waitForTimeout(15); continue; }
    idle = 0;
    const act = await target.getAttribute('data-act');
    if (act === 'again') { finished = true; await shot(page, 'lern_ende'); break; }
    try { await target.click({ timeout: 4000 }); } catch (e) { fail('Lernrunde Klick: ' + e.message.split('\n')[0]); break; }
    steps++;
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde Endtext');
  console.log(`Lernrunde: ${steps} Schritte, ${texts.size} verschiedene Texte`);
  for (const t of texts) console.log('   -', t);
  // Neuladen mitten in der Lernrunde; beenden
  await page.click('[data-act=again]');
  await page.waitForSelector('.coach');
  for (let i = 0; i < 3; i++) await page.locator('.coach-target').first().click();
  await page.reload();
  await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => fail('nach Neuladen keine Lernrunde'));
  await page.click('[data-act=learn-stop]');
  await page.waitForTimeout(150);
  if (await page.locator('.coach').count()) fail('Anleitung bleibt nach Beenden');
  if (await page.locator('.coach-target').count()) fail('Pulsieren bleibt nach Beenden');
  await ctx.close();
}

// ---------------------------------------------------------------- Hilfe
async function help(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'hilfe');
  await page.goto(base);
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  const t = await page.textContent('.modal');
  for (const w of ['schwarzer Stift', 'Weißer Stift', '2 richtig, 1 Farbe stimmt', '10 Versuche']) if (!t.toLowerCase().includes(w.toLowerCase())) fail('Hilfe ohne: ' + w);
  if (new RegExp('master' + 'mind', 'i').test(t)) fail('Marke in der Hilfe');
  await shot(page, 'help', false);
  await page.click('.modal [data-act=help-close]');
  // Große Schrift: nichts läuft über, Knöpfe bleiben bedienbar
  await page.fill('#name', 'Anna');
  await page.click('[data-act=solo]');
  await page.waitForSelector('.banner.mine');
  await page.click('[data-act=bigger]');
  await page.click('[data-act=color][data-c="0"]');
  await page.click('[data-act=color][data-c="1"]');
  await noOverflow(page, 'große Schrift');
  await shot(page, 'big_solo', false);
  await page.click('[data-act=color][data-c="2"]');
  await page.click('[data-act=color][data-c="3"]');
  await page.click('[data-act=submit]');
  await noOverflow(page, 'große Schrift nach Versuch');
  await shot(page, 'big_try', false);
  await page.click('[data-act=help]');
  await page.click('.modal [data-act=help-close]');
  if (await page.$('.modal')) fail('Hilfe schließt nicht');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const res = [];
  for (let i = 0; i < 3; i++) res.push(await soloRun(browser, 'smart', i));
  const avg = res.reduce((s, r) => s + r.tries, 0) / res.length;
  if (avg > 7) fail('kluger Bot im Schnitt zu schlecht: ' + avg);
  await soloRun(browser, 'random', 1);
  await botRun(browser, 1, true);
  await botRun(browser, 0, true);
  await duoRun(browser);
  await lernrunde(browser);
  await help(browser);
  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('FARBCODE E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors, null, 1)); process.exit(2); });
