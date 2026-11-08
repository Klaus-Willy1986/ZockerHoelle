// Durchspieltest für "Ich packe meinen Koffer": Alleinspiel (Bestleistung), gegen den Computer, Lernrunde,
// Host + Gast (Mock), Layout 390x844.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8984 &
//        NODE_PATH=$(npm root -g) node tests/koffer.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8984;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'koffer-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const base = `http://localhost:${PORT}/koffer/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };

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
    window.setTimeout = (fn, ms, ...a) => st(fn, typeof ms === 'number' && ms >= 800 && ms <= 4000 ? 15 : ms, ...a);
  });
  return ctx;
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `kf_${name}.png`), fullPage: full });

// ---------- Lesen der Seite ----------
const read = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const ids = (s) => [...document.querySelectorAll(s)].map((e) => e.dataset.id);
  const modal = q('.kf-modal');
  const cnt = q('.kf-count b');
  return {
    over: !!q('.trophy'),
    mine: !!q('.kf-mine'),
    n: cnt ? parseInt(cnt.textContent, 10) : null,
    grid: ids('.kf-grid .kf-card'),
    offer: ids('.kf-offer .kf-card'),
    peek: ids('.kf-peeklist .kf-tile'),
    chosen: ids('.kf-chips .kf-chip:not(.new)'),
    modal: modal ? (q('.kf-ok') ? 'ok' : 'bad') : null,
    added: modal && q('.kf-newthing .kf-tile') ? q('.kf-newthing .kf-tile').dataset.id : null,
    modalN: modal && q('.kf-modal .big b') ? parseInt(q('.kf-modal .big b').textContent, 10) : null,
    weiter: !!q('[data-act=weiter]'),
    skip: !!q('[data-act=skip]'),
    ack: !!q('[data-act=ack]'),
    banner: (q('.banner') || {}).innerText || '',
    leakSpectator: !q('.kf-mine') && !!q('.kf-peek, .kf-grid, .kf-chip, .kf-seqbar'),
  };
});

// Ein "Mensch" im Test: merkt sich die Liste aus den Ergebnisfenstern (neue Dinge) und spielt sie nach.
// opts.errAt: ab dieser Listenlänge wird absichtlich falsch gewählt (nur beim ersten Mal je errs).
function player(opts = {}) {
  const mem = { list: [], errs: 0, played: 0 };
  mem.step = async (page) => {
    const s = await read(page);
    if (s.over) return 'over';
    if (s.modal === 'ok' && s.added && s.modalN === mem.list.length + 1 && mem.list[mem.list.length] !== s.added) mem.list.push(s.added);
    if (s.modal) {
      if (s.weiter) { try { await page.click('[data-act=weiter]', { timeout: 1000 }); return 'weiter'; } catch { return 'wait'; } }
      if (s.ack) { try { await page.click('[data-act=ack]', { timeout: 1000 }); return 'ack'; } catch { return 'wait'; } }
      return 'wait';
    }
    if (!s.mine) return 'wait';
    const n = s.n;
    let seq = s.peek.length ? s.peek.slice() : mem.list.slice();
    if (seq.length !== n) { fail(`Gedächtnis des Testspielers (${seq.length}) passt nicht zur Anzeige (${n})`); seq = s.grid.slice(0, n); }
    if (opts.errAt !== undefined && n >= opts.errAt && mem.errs < (opts.errs || 1)) {
      mem.errs += 1;
      if (n >= 2) [seq[0], seq[1]] = [seq[1], seq[0]];
      else if (n === 1) seq[0] = s.grid.find((g) => g !== seq[0]);
    }
    for (const id of seq) await page.click(`.kf-grid .kf-card[data-id="${id}"]`);
    const add = s.offer[mem.played % s.offer.length];
    mem.played += 1;
    await page.click(`.kf-offer .kf-card[data-id="${add}"]`);
    await page.click('[data-act=fertig]');
    return 'play';
  };
  return mem;
}
async function playOut(page, mem, limit = 4000, cb) {
  for (let i = 0; i < limit; i++) {
    const r = await mem.step(page);
    if (cb) await cb(r, i);
    if (r === 'over') return i;
    if (r === 'wait') await page.waitForTimeout(15);
  }
  throw new Error('Partie nicht beendet');
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: Seite breiter als Bildschirm (${o.sw} > ${o.iw})`);
};
const boardTop = (page) => page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().top + window.scrollY));
async function startSolo(browser, opts = [], vp) {
  const ctx = await newCtx(browser, vp);
  const page = await newPage(ctx, 'solo');
  await page.goto(base);
  await page.fill('#name', 'Anna');
  for (const o of opts) { if (o.startsWith('-')) await page.uncheck(`[data-opt=${o.slice(1)}]`); else await page.check(`[data-opt=${o}]`); }
  await page.click('[data-act=solo]');
  await page.waitForSelector('#board');
  return { ctx, page };
}

// ---------------------------------------------------------------- (a) Alleinspiel
async function solo(browser) {
  const { ctx, page } = await startSolo(browser);
  const mem = player({ errAt: 7 });
  // Start: Koffer leer, nur das erste Ding wird gewählt
  let s = await read(page);
  if (s.n !== 0 || s.grid.length !== 0 || s.offer.length !== 8) fail(`Solo Start: n=${s.n} Raster=${s.grid.length} Auswahl=${s.offer.length}`);
  if (!/Du packst das erste Ding ein/.test(s.banner)) fail('Solo Start: Banner ' + s.banner);
  if (await page.isEnabled('[data-act=fertig]')) fail('Fertig vorher aktiv');
  await shot(page, 'solo_start');
  await page.click('.kf-offer .kf-card >> nth=2');
  if (!(await page.isEnabled('[data-act=fertig]'))) fail('Fertig nicht aktiv nach Wahl des neuen Dings');
  await page.click('.kf-offer .kf-card >> nth=2'); // Wahl wieder zurücknehmen
  if (await page.isEnabled('[data-act=fertig]')) fail('Fertig trotz zurückgenommener Wahl aktiv');
  let hid = 0; let tops = new Set(); let shots = 0;
  await playOut(page, mem, 2000, async (r) => {
    const t = await read(page);
    if (t.mine) {
      if (t.peek.length) hid++;
      tops.add(await boardTop(page));
      const sizes = await page.$$eval('.kf-grid .kf-card', (cs) => cs.map((c) => { const b = c.getBoundingClientRect(); return Math.min(b.width, b.height); }));
      if (sizes.some((x) => x < 56)) fail('Karten kleiner als 56px: ' + Math.min(...sizes));
      if (t.n === 4 && shots === 0) { shots++; await page.click(`.kf-grid .kf-card[data-id="${mem.list[0]}"]`); await page.click(`.kf-grid .kf-card[data-id="${mem.list[1]}"]`); await shot(page, 'solo_mitte', true); await page.click('[data-act=undo]'); await page.click('[data-act=undo]'); }
    }
    if (t.modal === 'ok' && shots === 1) { shots++; await shot(page, 'solo_richtig'); }
  });
  if (hid) fail('Liste sichtbar, obwohl Option aus');
  if (tops.size > 1) fail(`Solo: Spielfeld springt ${[...tops]}`);
  await noOverflow(page, 'Solo Ende');
  const h1 = (await page.textContent('.over h1')).trim();
  const best = await page.evaluate(() => localStorage.getItem('zh.kf_best'));
  if (best !== '7') fail(`Solo: Bestleistung ${best} statt 7`);
  if (!/Neue Bestleistung: 7 Dinge/.test(h1)) fail('Solo: Ergebnistext ' + h1);
  if (!(await page.$('.kf-resolvecard .kf-tile.bad'))) fail('Solo: Auflösung ohne markierte Fehler');
  const tilesExp = await page.$$eval('.kf-resolvecard .kf-resolve .kf-tiles:first-of-type .kf-tile', (t) => t.map((x) => x.dataset.id));
  if (JSON.stringify(tilesExp) !== JSON.stringify(mem.list)) fail('Solo: Auflösung zeigt andere Liste');
  console.log(`Solo: Fehler bei 7 Dingen, Bestleistung ${best}, "${h1}"`);
  await shot(page, 'solo_ende', true);
  // Neue Runde, früher scheitern: Bestleistung bleibt
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  const mem2 = player({ errAt: 3 });
  await playOut(page, mem2);
  const best2 = await page.evaluate(() => localStorage.getItem('zh.kf_best'));
  const t2 = (await page.textContent('.over')).replace(/\s+/g, ' ');
  if (best2 !== '7') fail('Solo 2: Bestleistung verändert ' + best2);
  if (!/Deine Bestleistung: 7 Dinge/.test(t2)) fail('Solo 2: Anzeige Bestleistung: ' + t2.slice(0, 150));
  // Neuladen mitten im Spiel
  await page.click('[data-act=again]');
  await page.waitForSelector('#board');
  const m3 = player();
  for (let i = 0; i < 12; i++) await m3.step(page);
  const before = await read(page);
  await page.reload(); await page.waitForSelector('#board');
  const after = await read(page);
  if (before.n !== after.n) fail(`Solo: Neuladen verändert das Spiel ${before.n}/${after.n}`);
  await ctx.close();
}

// ---------------------------------------------------------------- (b) gegen den Computer
async function botGame(browser, n, level, errAt, label) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'bot' + n);
  await page.goto(base);
  await page.fill('#name', 'Berta');
  if (n === 1 && level === 1) await shot(page, 'start', true);
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  const mem = player({ errAt });
  let sawBot = false; let shots = 0;
  await playOut(page, mem, 6000, async (r) => {
    if (r === 'wait') {
      const s = await read(page);
      if (!s.modal && /Computer.*überlegt/.test(s.banner)) { sawBot = true; if (!shots++ && n === 1) await shot(page, 'bot_computer'); }
    }
  });
  const rows = await page.$$eval('.ranking li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  if (rows.length !== n + 1) fail(`${label}: ${rows.length} Zeilen statt ${n + 1}`);
  if (rows.filter((r) => /dabei/.test(r)).length !== 1) fail(`${label}: nicht genau ein Gewinner: ${rows}`);
  if (!sawBot) fail(`${label}: Computer war nie dran`);
  console.log(`${label}: ${rows.join(' | ')}`);
  if (n === 1) await shot(page, 'bot_ende', true);
  await ctx.close();
  return rows;
}

// ---------------------------------------------------------------- (c) Lernrunde
async function lernrunde(browser) {
  const ctx = await newCtx(browser);
  const page = await newPage(ctx, 'lern');
  await page.goto(base);
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const texts = []; let finished = false; let shots = 0; let peeked = false; let mem = player();
  for (let i = 0; i < 3000; i++) {
    const t = (await page.textContent('.coach .coach-t')).trim();
    if (!texts.includes(t)) { texts.push(t); if (shots < 5) await shot(page, 'lern_' + (++shots)); }
    const s = await read(page);
    if (/Tippe (dann )?auf (Weiter|Verstanden|Fertig)/.test(t) && (await page.locator('.coach-target').count()) === 0) fail('Lernrunde: Zielmarkierung fehlt bei "' + t + '"');
    if (s.peek.length) peeked = true;
    if (s.over) { finished = true; break; }
    const r = await mem.step(page);
    if (r === 'wait') await page.waitForTimeout(15);
  }
  if (!finished) fail('Lernrunde: Ende nicht erreicht');
  else if (!/Lernrunde ist zu Ende/.test(await page.textContent('.coach .coach-t'))) fail('Lernrunde: Endtext');
  if (!peeked) fail('Lernrunde: Liste war nie sichtbar');
  console.log(`Lernrunde: Ende erreicht, ${texts.length} verschiedene Texte`);
  texts.forEach((t) => console.log('   -', t));
  const dup = texts.filter((t, i) => texts.indexOf(t) !== i);
  if (dup.length) fail('Lernrunde: Text mehrfach ' + dup[0]);
  await shot(page, 'lern_ende');
  await ctx.close();
}

// ---------------------------------------------------------------- (d) Host + Gast
async function duo(browser, lives2) {
  const ctx = await newCtx(browser);
  const A = await newPage(ctx, 'A'); const B = await newPage(ctx, 'B');
  await A.goto(base + '?mock=1'); await A.fill('#name', 'Anna');
  if (lives2) await A.check('[data-opt=lives2]');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const room = (await A.textContent('.code')).trim();
  if (lives2) { await A.check('[data-opt=lives2]'); }
  await B.goto(base + `?mock=1&raum=${room}`); await B.fill('#name', 'Bernd'); await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const mA = player(lives2 ? {} : {}); const mB = player({ errAt: lives2 ? 2 : 4, errs: lives2 ? 2 : 1 });
  let leak = 0; let skipped = false; let heartsSeen = false; let shots = 0; let diff = 0;
  for (let n = 0; n < 4000; n++) {
    const sa = await read(A); const sb = await read(B);
    if (sa.leakSpectator) leak++;
    if (sb.leakSpectator) leak++;
    if (sa.mine && sb.mine) fail('Beide Personen gleichzeitig dran');
    if (sa.n !== sb.n && !sa.modal && !sb.modal && sa.n !== null && sb.n !== null && !sa.over) diff++;
    if (lives2 && (await A.$('.kf-hearts'))) heartsSeen = true;
    // Zuschauer sieht das Ergebnis mit "Ohne … weiter" (nur einmal ausprobieren)
    if (!skipped && !sb.modal && sb.skip) { skipped = true; await shot(B, 'duo_B_skip'); await B.click('[data-act=skip]'); }
    if (sb.modal && shots < 2 && sb.ack) { shots++; await shot(B, 'duo_B_modal_' + shots); }
    const ra = await mA.step(A); const rb = await mB.step(B);
    if (n === 6) { await shot(A, 'duo_A'); await shot(B, 'duo_B'); }
    if (ra === 'over' && rb === 'over') break;
    if (ra === 'wait' && rb === 'wait') await A.waitForTimeout(15);
  }
  if (leak) fail('Zuschauer sehen Liste/Raster im DOM: ' + leak);
  if (diff > 3) fail('Zähler bei Host und Gast verschieden: ' + diff);
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  const h1A = (await A.textContent('.over h1')).trim(); const h1B = (await B.textContent('.over h1')).trim();
  console.log(`Host+Gast${lives2 ? ' (2 Fehlerpunkte)' : ''}: A: "${h1A}" | B: "${h1B}"`);
  if (!/gewonnen/.test(h1A) || !/gewonnen/.test(h1B)) fail('Duo: Siegtext fehlt');
  if (!/Du hast gewonnen/.test(h1A)) fail('Duo: A (nie ein Fehler) sollte gewinnen');
  if (lives2 && !heartsSeen) fail('Duo: Fehlerpunkte nie angezeigt');
  const rA = await A.$$eval('.ranking li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ')));
  if (!/Bernd.*raus/.test(rA.join('|'))) fail('Duo: Bernd nicht als raus markiert ' + rA);
  if (await B.$('[data-act=again]')) fail('Gast sieht "Noch eine Runde"');
  if (!(await A.$('[data-act=again]'))) fail('Host sieht kein "Noch eine Runde"');
  if (!(await B.$('.kf-resolvecard'))) fail('Gast sieht keine Auflösung');
  const same = async (sel) => JSON.stringify(await A.$$eval(sel, (t) => t.map((x) => x.dataset.id))) === JSON.stringify(await B.$$eval(sel, (t) => t.map((x) => x.dataset.id)));
  if (!(await same('.kf-resolvecard .kf-tile'))) fail('Duo: Auflösung bei A und B verschieden');
  await shot(A, 'duo_ende_A', true); await shot(B, 'duo_ende_B', true);
  await A.click('[data-act=again]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const sB = await read(B);
  if (sB.n !== 0) fail('Neue Runde (Gast) nicht frisch');
  await ctx.close();
}

// ---------------------------------------------------------------- (e) Layout
async function layout(browser) {
  const { ctx, page } = await startSolo(browser);
  const mem = player();
  const tops = new Set(); const rects = new Set(); const sizes = {}; const banners = new Set(); const actions = new Set();
  const seen = new Set();
  await playOut(page, mem, 5000, async () => {
    const s = await read(page);
    if (s.mine && !seen.has(s.n)) {
      seen.add(s.n);
      sizes[s.n] = s.grid.length;
      tops.add(await boardTop(page));
      rects.add(await page.$eval('#board', (b) => Math.round(b.getBoundingClientRect().width)));
      banners.add(await page.$eval('.banner', (b) => Math.round(b.getBoundingClientRect().height)));
      actions.add(await page.$eval('.kf-action', (b) => Math.round(b.getBoundingClientRect().height)));
      await noOverflow(page, `Layout n=${s.n}`);
      const cols = await page.$eval('.kf-grid', (g) => g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0).catch(() => 4);
      if (cols !== 4) fail(`Layout: ${cols} Spalten`);
      if (s.n === 8) await shot(page, 'layout_n8');
      if (s.n === 20) await shot(page, 'layout_n20', true);
    }
    if (s.n >= 21 && s.mine) throw Object.assign(new Error('fertig'), { stop: true });
  }).catch((e) => { if (!e.stop) throw e; });
  const grid = (n) => sizes[n];
  console.log(`Layout: Rastergröße bei n=1: ${grid(1)}, n=11: ${grid(11)}, n=12: ${grid(12)}, n=19: ${grid(19)}, n=20: ${grid(20)}`);
  if (grid(1) !== 24 || grid(11) !== 24) fail('Raster anfangs nicht 24');
  if (grid(12) !== 28 || grid(19) !== 28) fail('Raster nicht 28 bei mittlerer Liste');
  if (grid(20) !== 30) fail('Raster nicht 30 bei langer Liste');
  if (tops.size > 1) fail(`Layout: #board springt ${[...tops]}`);
  if (rects.size > 1) fail(`Layout: #board Breite wechselt ${[...rects]}`);
  if (banners.size > 1) fail(`Layout: Banner-Höhe wechselt ${[...banners]}`);
  if (actions.size > 1) fail(`Layout: Aktionsleiste wechselt ${[...actions]}`);
  const cw = await page.$$eval('.kf-card', (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().width)));
  console.log(`Layout: Kartenbreite ${Math.min(...cw)}-${Math.max(...cw)}px, #board fest bei ${[...tops]}, Banner ${[...banners]}px, Aktionsleiste ${[...actions]}px`);
  const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && !b.classList.contains('mini') && !b.classList.contains('kf-card')).map((b) => ({ a: b.dataset.act, h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.h < 48));
  if (small.length) fail('zu kleine Knöpfe ' + JSON.stringify(small));
  const undoH = await page.$eval('[data-act=undo]', (b) => Math.round(b.getBoundingClientRect().height));
  if (undoH < 48) fail('Zurück-Knopf zu klein ' + undoH);
  // große Schrift
  await page.click('[data-act=bigger]');
  await noOverflow(page, 'große Schrift');
  await shot(page, 'layout_gross_schrift');
  // Hilfe
  await page.click('[data-act=help]');
  const t = await page.textContent('.modal');
  if (!/Koffer/.test(t)) fail('Hilfe ohne Inhalt');
  await shot(page, 'hilfe');
  await ctx.close();
  // Desktop
  const d = await startSolo(browser, ['show'], { width: 1280, height: 800 });
  const m = player();
  for (let i = 0; i < 10; i++) await m.step(d.page);
  await shot(d.page, 'desktop');
  await noOverflow(d.page, 'Desktop');
  await d.ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await solo(browser);
    const r1 = await botGame(browser, 1, 0, 14, 'Gegen Computer (Leicht)');
    await botGame(browser, 1, 1, 60, 'Gegen Computer (Mittel)');
    await botGame(browser, 3, 0, 2, '3 Computer, Mensch scheidet früh aus');
    await lernrunde(browser);
    await duo(browser, false);
    await duo(browser, true);
    await layout(browser);
  } catch (e) { fail('Abbruch: ' + e.stack); }
  await browser.close();
  console.log(errors.length ? `\n${errors.length} FEHLER` : '\nALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
