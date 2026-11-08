// Durchspieltest für Wer bin ich?: Alleinspiel, gegen den Computer, Lernrunde, Host + Gast (Mock), Layout.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8985 &
//        NODE_PATH=$(npm root -g) node tests/werbinich.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 8985;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'werbinich-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/werbinich/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };
let CAT = null;

async function newPage(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`${name} console ${m.text()}`); });
  return page;
}
async function newCtx(browser, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
  });
  return ctx;
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `wb_${name}.png`), fullPage: full });

const read = (page) => page.evaluate(() => ({
  banner: ((document.querySelector('.banner') || {}).textContent || '').trim(),
  mine: !!document.querySelector('.banner.mine'),
  over: !!document.querySelector('.trophy'),
  reveal: !!document.querySelector('.wb-reveal'),
  pick: !!document.querySelector('.wb-pickbox'),
  cat: ((document.querySelector('.wb-cat-in') || { firstChild: {} }).firstChild.textContent || '').trim(),
  chips: [...document.querySelectorAll('.wb-chip')].map((c) => ({ t: c.querySelector('span:not(.sr)').textContent, wrong: c.classList.contains('wrong'), a: ['ja', 'nein', 'teils'].find((x) => c.classList.contains('a-' + x)) || null })),
  free: [...document.querySelectorAll('button[data-act=ask]')].map((b) => b.dataset.q),
  body: document.body.innerText,
}));

// Der "Mensch" entscheidet nur mit dem, was im Dokument steht (Antwortverlauf), und nutzt den Katalog wie ein kluger Spieler.
function decide(s) {
  const { BEGRIFFE, FRAGEN, KATEGORIEN } = CAT;
  const kat = Object.values(KATEGORIEN).find((k) => k.text === s.cat);
  if (!kat) throw new Error('Kategorie unbekannt: ' + s.cat);
  const ans = s.chips.filter((c) => !c.wrong).map((c) => ({ q: FRAGEN.find((f) => f.t === c.t), a: c.a }));
  const wrongNames = s.chips.filter((c) => c.wrong).map((c) => c.t.replace(/ geraten$/, ''));
  let cands = BEGRIFFE.filter((b) => b.k === kat.id && !wrongNames.includes(b.n) && ans.every((x) => x.q && b.a[x.q.id] === x.a));
  if (cands.length <= 1 || !s.free.length) return { kind: 'guess', id: (cands[0] || BEGRIFFE.find((b) => b.k === kat.id && !wrongNames.includes(b.n))).id };
  let best = null; let bestV = -1;
  for (const q of s.free) {
    const cnt = {}; for (const b of cands) cnt[b.a[q]] = (cnt[b.a[q]] || 0) + 1;
    const v = Object.values(cnt).reduce((a, n) => a - (n / cands.length) * Math.log2(n / cands.length), 0);
    if (v > bestV + 1e-9) { bestV = v; best = q; }
  }
  return { kind: 'ask', q: best };
}
async function step(page, hooks = {}) {
  const s = await read(page);
  if (s.over) return 'over';
  if (s.reveal) { if (await page.$('[data-act=next]')) { await page.click('[data-act=next]'); return 'next'; } return 'wait'; }
  if (!s.mine) return 'wait';
  const d = decide(s);
  if (d.kind === 'ask') { await page.click(`button[data-act=ask][data-q="${d.q}"]`); return 'ask'; }
  await page.click('[data-act=know]');
  await page.waitForSelector('.wb-pickbox');
  if (hooks.wrongFirst && !hooks.done) { // einmal absichtlich falsch raten
    hooks.done = true;
    const wrongBtn = await page.$(`button[data-act=pick]:not([disabled]):not([data-id="${d.id}"])`);
    await wrongBtn.click();
    return 'wrong';
  }
  await page.click(`button[data-act=pick][data-id="${d.id}"]`);
  return 'guess';
}
async function playOut(page, limit = 3000, onTick) {
  for (let n = 0; n < limit; n++) {
    if (onTick) await onTick(n);
    const r = await step(page);
    if (r === 'over') return n;
    if (r === 'wait') await page.waitForTimeout(25);
  }
  throw new Error('Partie nicht beendet');
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
};
const boardTop = (page) => page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY));
async function startSolo(browser, opts = [], vp, mode = 'solo') {
  const ctx = await newCtx(browser, vp);
  const page = await newPage(ctx, mode);
  await page.goto(base);
  await page.fill('#name', 'Anna');
  for (const o of opts) await page.check(`[data-opt=${o}]`);
  if (mode === 'solo') await page.click('[data-act=solo]'); else await page.click(`[data-act=bot][data-n="${mode}"][data-level="1"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}
// Der geheime Begriff darf nur in der Auflösung im Dokument stehen
async function secretName(page, mock) {
  return page.evaluate(([m]) => {
    const raw = (m ? sessionStorage : localStorage).getItem('zh.wb.hostState');
    if (!raw) return null;
    const g = JSON.parse(raw).game;
    return g ? { id: g.terms[g.round], phase: g.phase } : null;
  }, [mock]);
}
const nameOf = (id) => CAT.BEGRIFFE.find((b) => b.id === id).n;

// ---------------------------------------------------------------- (a) Alleinspiel
async function solo(browser) {
  const { ctx, page } = await startSolo(browser);
  let leaks = 0; let hintSeen = 0;
  const cats = [];
  const n = await playOut(page, 3000, async (i) => {
    const s = await read(page);
    if (s.over) return;
    if (!s.reveal && !s.pick) {
      const sec = await secretName(page, false);
      if (sec && s.body.includes(nameOf(sec.id)) && new RegExp(`(^|[^\\wäöüÄÖÜß])${nameOf(sec.id).replace(/^(Der|Die|Das) /, '')}([^\\wäöüÄÖÜß]|$)`).test(s.body.replace(/Bin ich[^?]*\?/g, ''))) { leaks++; console.log('Leck:', nameOf(sec.id)); }
    }
    if (s.cat && !cats.includes(s.cat)) cats.push(s.cat);
    if (i === 3) await shot(page, 'solo_mitte');
  });
  await page.waitForSelector('.trophy');
  const h1 = (await page.textContent('.over h1')).trim();
  if (!/^Geschafft! Du hast -?\d+ Punkte?!$/.test(h1)) fail('Solo: Ergebnistext ' + h1);
  const score = Number((/(-?\d+)/.exec(h1) || [0, NaN])[1]);
  const best = await page.evaluate(() => localStorage.getItem('zh.wb_best'));
  if (best === null || Number(best) !== score) fail(`Solo: Bestleistung ${best} statt ${score}`);
  if (!/Neue Bestleistung/.test(await page.textContent('.wb-over'))) fail('Solo: erste Runde sollte Bestleistung sein');
  const done = await page.$$eval('.wb-done li', (l) => l.length);
  if (done !== 5) fail('Solo: ' + done + ' Begriffe in der Liste statt 5');
  if (leaks) fail('Solo: geheimer Begriff im Dokument ' + leaks + 'x');
  if (cats.length < 4) fail('Solo: nur ' + cats.length + ' Kategorien ' + cats);
  console.log(`Solo: 5 Begriffe in ${n} Schritten, Punkte ${score}, Bestleistung ${best}, Kategorien: ${cats.join(' | ')}`);
  await shot(page, 'solo_ende', true);
  // noch eine Runde: neues Spiel, danach Neuladen mitten im Spiel
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  if ((await read(page)).chips.length) fail('Neue Runde nicht frisch');
  for (let i = 0; i < 3; i++) await step(page);
  const before = JSON.stringify((await read(page)).chips);
  await page.reload(); await page.waitForSelector('#board');
  const after = JSON.stringify((await read(page)).chips);
  if (before !== after || before === '[]') fail('Neuladen verändert das Spiel');
  // kurzes Spiel: 3 Begriffe
  await ctx.close();
  const k = await startSolo(browser, ['kurz']);
  const meta = await k.page.textContent('.wb-meta');
  if (!/Begriff 1 von 3/.test(meta)) fail('Kurz: ' + meta);
  await k.ctx.close();
}

// ---------------------------------------------------------------- (b) gegen den Computer
async function botGame(browser, n = 2) {
  const { ctx, page } = await startSolo(browser, [], undefined, String(n));
  let sawBot = 0; let shots = 0;
  const m = await playOut(page, 4000, async () => {
    const t = await page.textContent('.banner').catch(() => '');
    if (/Computer.*überlegt/.test(t)) { sawBot++; if (!shots) { shots++; await shot(page, 'bot_computer'); } }
  });
  await page.waitForSelector('.trophy');
  const rows = await page.$$eval('.ranking li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ')));
  if (rows.length !== n + 1) fail('Computerspiel: ' + rows.length + ' Zeilen');
  if (!sawBot) fail('Computer war nie dran');
  const sum = await page.$$eval('.ranking .rt', (l) => l.map((x) => parseInt(x.textContent, 10)));
  const rights = await page.$$eval('.ranking .rn small', (l) => l.map((x) => Number((/geraten: (\d+)/.exec(x.textContent) || [0, 0])[1])));
  if (rights.reduce((a, b) => a + b, 0) !== 5) fail('Computerspiel: richtig geratene Begriffe ' + rights);
  console.log(`Gegen ${n} Computer (Mittel): ${m} Schritte, Computer ${sawBot}x dran. ${rows.join(' | ')}`);
  await shot(page, 'bot_ende', true);
  await ctx.close();
}

// ---------------------------------------------------------------- (c) Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const texts = []; let finished = false; let shots = 0; let guessed = 0;
  for (let i = 0; i < 4000; i++) {
    const t = (await page.textContent('.coach .coach-t')).trim();
    if (!texts.includes(t)) { texts.push(t); if (shots < 5 && texts.length % 2 === 1) await shot(page, 'lern_' + (++shots)); }
    const tg = page.locator('.coach-target');
    if ((await tg.count()) === 0) { await page.waitForTimeout(15); continue; }
    const first = tg.first();
    const act = await first.getAttribute('data-act');
    const cls = (await first.getAttribute('class')) || '';
    if (act === 'again') { finished = true; break; }
    if (act === 'pick') { guessed++; await page.locator('[data-act=pick]:not([disabled])').first().click(); }
    else if (act === 'next' || act === 'know' || act === 'ask') await first.click();
    else if (cls.includes('wb-chips')) await page.locator('button[data-act=ask]').first().click();
    else fail('Lernrunde: unbekanntes Ziel ' + cls + ' ' + act);
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde: Endtext');
  await shot(page, 'lern_ende');
  const long = texts.filter((t) => t.length > 70);
  if (new Set(long).size !== long.length) fail('Lernrunde: Erklärung doppelt');
  console.log(`Lernrunde: Ende erreicht, ${texts.length} verschiedene Texte (${long.length} ausführlich), ${guessed}x geraten`);
  long.forEach((t) => console.log('   -', t));
  await ctx.close();
}

// ---------------------------------------------------------------- (d) Host + Gast
async function duo(browser) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A'); const B = await newPage(ctx, 'B');
  await A.goto(base + '?mock=1'); await A.fill('#name', 'Anna'); await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = (await A.textContent('.code')).trim();
  await shot(A, 'lobby');
  await B.goto(base + `?mock=1&raum=${room}`); await B.fill('#name', 'Bernd'); await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  let leak = 0; let moves = 0; let hintOk = false; const hooksA = { wrongFirst: true }; const hooksB = {}; let diffs = 0; let wrongSeen = false;
  for (let n = 0; n < 5000; n++) {
    const ra = await read(A); const rb = await read(B);
    // Gleiche Chips und Begriffsnummer bei beiden
    if (JSON.stringify(ra.chips) !== JSON.stringify(rb.chips)) { await A.waitForTimeout(20); const a2 = await read(A); const b2 = await read(B); if (JSON.stringify(a2.chips) !== JSON.stringify(b2.chips)) diffs++; }
    if (ra.chips.some((c) => c.wrong)) wrongSeen = true;
    // Geheimer Begriff nirgends im Dokument von A und B (Auswahl geschlossen, nicht aufgelöst)
    const sec = await secretName(A, true);
    if (sec && sec.phase === 'ask') {
      for (const r of [ra, rb]) {
        if (r.pick || r.reveal) continue;
        const nm = nameOf(sec.id).replace(/^(Der|Die|Das) /, '');
        const txt = r.body.replace(/Bin ich[^?]*\?/g, '');
        if (new RegExp(`(^|[^\\wäöüÄÖÜß])${nm}([^\\wäöüÄÖÜß]|$)`).test(txt)) leak++;
      }
    }
    // Wer nicht dran ist, bekommt beim Tippen einen Hinweis, nichts passiert
    if (!hintOk && ra.chips.length === 2 && !ra.over && !ra.reveal) {
      const X = ra.mine ? B : A;
      const before = JSON.stringify((await read(X)).chips);
      await X.click('button[data-act=ask]');
      const txt = await X.textContent('.wb-action');
      if (!/Gerade ist .* dran/.test(txt)) fail('Hinweis bei falscher Person fehlt: ' + txt);
      if (JSON.stringify((await read(X)).chips) !== before) fail('Frage ging durch, obwohl man nicht dran war');
      if (!(await X.$('[data-act=know][disabled]'))) fail('Ich weiß es sollte aus sein, wenn man nicht dran ist');
      hintOk = true;
    }
    const sa = await step(A, hooksA); const sb = await step(B, hooksB);
    if (['ask', 'guess', 'wrong'].includes(sa) || ['ask', 'guess', 'wrong'].includes(sb)) moves++;
    if (n === 6) { await shot(A, 'duo_A'); await shot(B, 'duo_B'); }
    if (sa === 'over' && sb === 'over') break;
    if (!['ask', 'guess', 'wrong', 'next'].includes(sa) && !['ask', 'guess', 'wrong', 'next'].includes(sb)) await A.waitForTimeout(20);
  }
  if (leak) fail('Gast/Host sehen den geheimen Begriff im DOM: ' + leak);
  if (diffs) fail('Host und Gast zeigen verschiedene Antworten: ' + diffs);
  if (!wrongSeen) fail('Falsch-Raten wurde nicht beobachtet');
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  const h1A = (await A.textContent('.over h1')).trim(); const h1B = (await B.textContent('.over h1')).trim();
  const rkA = await A.$$eval('.ranking li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').replace(' (du)', '')));
  const rkB = await B.$$eval('.ranking li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').replace(' (du)', '')));
  if (JSON.stringify(rkA) !== JSON.stringify(rkB)) fail('Ranglisten verschieden: ' + JSON.stringify([rkA, rkB]));
  console.log(`Host+Gast: ${moves} Züge, A: "${h1A}" | B: "${h1B}" | ${rkA.join(' | ')}`);
  if (await B.$('[data-act=again]')) fail('Gast sieht "Noch eine Runde"');
  if (!(await A.$('[data-act=again]'))) fail('Host sieht kein "Noch eine Runde"');
  const strafe = rkA.some((t) => /falsch: [1-9]/.test(t));
  if (!strafe) fail('Strafpunkt (falsch: n) fehlt in der Rangliste');
  await shot(A, 'duo_ende_A', true); await shot(B, 'duo_ende_B', true);
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  if ((await read(B)).chips.length) fail('Neue Runde (Gast) nicht frisch');
  await ctx.close();
}

// ---------------------------------------------------------------- (e) Layout
async function layout(browser) {
  const { ctx, page } = await startSolo(browser);
  await noOverflow(page, 'Start im Spiel');
  const tops = new Set(); const heights = new Set(); const knowBottoms = new Set();
  const measure = async () => {
    if (await page.$('.wb-reveal')) return; // in der Auflösung sieht das Feld anders aus
    tops.add(await boardTop(page));
    heights.add(JSON.stringify(await page.$$eval('#board, .wb-qlist, .wb-pickbox, .banner, .wb-chips', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))));
    const kb = await page.$eval('.wb-know', (b) => { const r = b.getBoundingClientRect(); return { b: Math.round(r.bottom), h: Math.round(r.height), vis: r.top >= 0 && r.bottom <= window.innerHeight }; });
    if (!kb.vis) fail('Layout: Knopf unten nicht sichtbar ' + JSON.stringify(kb));
    if (kb.h < 56) fail('Layout: Knopf zu niedrig ' + kb.h);
    knowBottoms.add(kb.b);
  };
  await measure();
  // Fragenliste: Kartengröße, scrollbar, Scrollstand bleibt nach einer Frage
  const cards = await page.$$eval('button[data-act=ask]', (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().height)));
  if (Math.min(...cards) < 56) fail('Layout: Fragenkarte nur ' + Math.min(...cards) + ' px hoch');
  const sc = await page.$eval('.wb-qlist', (l) => ({ ch: l.clientHeight, sh: l.scrollHeight }));
  if (sc.sh <= sc.ch + 50) fail('Layout: Liste nicht scrollbar ' + JSON.stringify(sc));
  await page.$eval('.wb-qlist', (l) => { l.scrollTop = 600; });
  await page.waitForTimeout(100);
  const askBtn = page.locator('.wb-qlist button[data-act=ask]');
  const cnt = await askBtn.count();
  const mid = askBtn.nth(Math.floor(cnt / 2));
  await mid.scrollIntoViewIfNeeded();
  const st0 = await page.$eval('.wb-qlist', (l) => l.scrollTop);
  await mid.click();
  await page.waitForTimeout(150);
  const st1 = await page.$eval('.wb-qlist', (l) => l.scrollTop);
  if (Math.abs(st1 - st0) > 4) fail(`Layout: Scrollstand der Liste springt ${st0} -> ${st1}`);
  console.log(`Layout: Karten min ${Math.min(...cards)} px, Liste scrollt (${sc.sh} von ${sc.ch} px), Scrollstand bleibt (${st0} -> ${st1})`);
  await measure();
  for (let i = 0; i < 6; i++) { await step(page); await measure(); await noOverflow(page, 'Layout Spiel'); }
  await shot(page, 'layout_spiel');
  // Auswahl beim Raten
  await page.evaluate(() => scrollTo(0, 0));
  await page.click('[data-act=know]');
  await page.waitForSelector('.wb-pickbox');
  await measure(); await noOverflow(page, 'Layout Auswahl');
  const letters = await page.$$eval('.wb-l', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  if (letters.some(([w, h]) => w < 48 || h < 48)) fail('Layout: Buchstaben zu klein ' + JSON.stringify(letters[0]));
  const tcards = await page.$$eval('.wb-t', (b) => b.map((x) => Math.round(x.getBoundingClientRect().height)));
  if (Math.min(...tcards) < 56) fail('Layout: Begriffskarte nur ' + Math.min(...tcards));
  // Alphabetisch sortiert, Buchstaben-Filter
  const names = await page.$$eval('.wb-t .t', (l) => l.map((x) => x.textContent));
  const sorted = names.slice().sort((a, b) => a.replace(/^(Der|Die|Das) /, '').localeCompare(b.replace(/^(Der|Die|Das) /, ''), 'de'));
  if (JSON.stringify(names) !== JSON.stringify(sorted)) fail('Auswahl nicht alphabetisch: ' + names.slice(0, 6));
  const L = await page.$$eval('.wb-l[data-l]:not([data-l=""])', (b) => b.map((x) => x.dataset.l));
  await page.click(`.wb-l[data-l="${L[1]}"]`);
  const filtered = await page.$$eval('.wb-t .t', (l) => l.map((x) => x.textContent.replace(/^(Der|Die|Das) /, '')[0].toUpperCase()));
  if (!filtered.length || filtered.some((c) => c !== L[1] && !(L[1] === 'A' && c === 'Ä') && !(L[1] === 'O' && c === 'Ö') && !(L[1] === 'U' && c === 'Ü'))) fail('Buchstabenfilter ' + L[1] + ': ' + filtered);
  await shot(page, 'layout_auswahl');
  console.log(`Layout Auswahl: ${names.length} Begriffe alphabetisch, Filter ${L[1]} zeigt ${filtered.length}, Begriffskarten min ${Math.min(...tcards)} px`);
  await page.click('[data-act=pick-close]');
  await page.waitForSelector('.wb-qlist');
  await measure();
  if (tops.size > 1) fail('Layout: Spielfeld springt ' + [...tops]);
  if (heights.size > 1) fail('Layout: Bereiche wechseln die Höhe ' + [...heights]);
  console.log(`Layout: Spielfeld fest bei ${[...tops]}, Höhen ${[...heights]}, Knopf unten bei ${[...knowBottoms]}`);
  // Knöpfe >= 48 px (ohne kleine Kopfzeilen-Knöpfe)
  const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && !b.classList.contains('mini')).map((b) => { const r = b.getBoundingClientRect(); return { a: b.dataset.act, h: Math.round(r.height) }; }).filter((x) => x.h < 48));
  if (small.length) fail('zu kleine Knöpfe ' + JSON.stringify(small));
  // Große Schrift
  await page.click('[data-act=bigger]');
  await noOverflow(page, 'große Schrift');
  await shot(page, 'layout_gross_schrift');
  // Auflösung und Ende ohne Überlauf
  await page.click('[data-act=bigger]');
  for (let i = 0; i < 400 && !(await page.$('.wb-reveal')); i++) await step(page);
  await noOverflow(page, 'Auflösung');
  await shot(page, 'layout_aufloesung');
  const rv = await page.textContent('.wb-reveal');
  if (!/Ich war:/.test(rv)) fail('Auflösung ohne Begriff: ' + rv);
  await ctx.close();
  // Hilfe und Startseite
  const h = await startSolo(browser);
  await h.page.click('[data-act=help]');
  const t = await h.page.textContent('.modal');
  if (!/Ich weiß es/.test(t) || !/zehn Punkte minus/.test(t)) fail('Hilfe ohne Inhalt');
  if (/zeige mir|beste Frage|\bTipps?\b/i.test(t.replace(/Im Spiel gibt es bewusst keine Tipps[^.]*\./, '').replace(/Tipp: Wenn du nicht lesen magst[^.]*\./, ''))) fail('Hilfe enthält Tipp-Hinweis');
  await shot(h.page, 'hilfe');
  await h.ctx.close();
  // Desktop
  const d = await startSolo(browser, [], { width: 1280, height: 800 });
  for (let i = 0; i < 4; i++) await step(d.page);
  await shot(d.page, 'desktop');
  await d.ctx.close();
  const s0 = await newCtx(browser); const p0 = await newPage(s0, 'start'); await p0.goto(base); await p0.fill('#name', 'Anna');
  await noOverflow(p0, 'Startseite'); await shot(p0, 'start', true); await s0.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    CAT = await import(pathToFileURL(path.join(__dirname, '..', 'werbinich', 'begriffe.js')).href);
    await solo(browser);
    await botGame(browser, 1);
    await botGame(browser, 3);
    await lernrunde(browser);
    await duo(browser);
    await layout(browser);
  } catch (e) { fail('Abbruch: ' + e.stack); }
  await browser.close();
  console.log(errors.length ? `\n${errors.length} FEHLER` : '\nALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
