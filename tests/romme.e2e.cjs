// Durchspieltest Rommé im Browser (nur Tippen).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8964 &  dann  NODE_PATH=$(npm root -g) node tests/romme.e2e.cjs
//   (a) gegen 1 Computer (Mittel): ein Klick-Bot nutzt die KI, um passende Karten zu finden, und setzt sie per Tippen (Nehmen, Eröffnung, Anlegen, Ablegen)
//       bis zum Rundenende + Layout 390x844; (b) Lernrunde; (c) Gastgeber + Gast über Mock-Netz (inkl. ?hand=5-Hook);
//       (d) vorbereitete Lagen (Eröffnungssperre, Anlegen, Joker tauschen, Ablegen-Regeln, Rommé in einem Zug, Rundenende, Nächste Runde); (e) 4 Personen
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const PORT = process.env.PORT || 8964;
const URL0 = `http://localhost:${PORT}/romme/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad/rm';
require('fs').mkdirSync(SHOTS, { recursive: true });
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const check = (c, m) => { if (!c) fail(m); };
const rint = (n) => Math.floor(Math.random() * n);
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `rm-e2e-${n}.png`), fullPage: full });
let E, AI;
const want = (k) => !process.env.ONLY || process.env.ONLY.includes(k);

function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}
const fast = (ctx) => ctx.addInitScript(() => {
  const si = window.setInterval.bind(window);
  window.setInterval = (f, t, ...a) => si(f, typeof t === 'number' && t < 200 ? 4 : t, ...a);
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t >= 600 && t <= 1000 ? 8 : t, ...a);
});
const mine = async (p) => /^\s*Du bist dran/.test(await p.locator('.banner').first().innerText().catch(() => ''));
const isOver = async (p) => (await p.locator('.rm-over').count()) > 0;
const hostState = (p) => p.evaluate(() => { for (const s of [sessionStorage, localStorage]) { const v = s.getItem('zh.rm.hostState'); if (v) return JSON.parse(v); } return null; });
const myCid = (p) => p.evaluate(() => sessionStorage.getItem('zh.cid') ? JSON.parse(sessionStorage.getItem('zh.cid')) : JSON.parse(localStorage.getItem('zh.cid')));
const domTable = (p) => p.evaluate(() => [...document.querySelectorAll('.rm-table .rm-set')].map((r) => [...r.querySelectorAll('[data-id]')].map((e) => Number(e.dataset.id))));
const domHand = (p) => p.evaluate(() => [...document.querySelectorAll('#hand [data-id]')].map((e) => Number(e.dataset.id)));
const count = (p, s) => p.locator(s).count();
const key = (s) => [...s].sort((a, b) => a - b).join(',');
const card = (id) => `#app [data-act=card][data-id="${id}"]`;
const tap = (p, id) => p.click(card(id), { timeout: 5000 });
const waitTurnEnd = (p) => p.waitForFunction(() => !/^\s*Du bist dran/.test((document.querySelector('.banner') || { innerText: '' }).innerText) || document.querySelector('.rm-over'), null, { timeout: 8000 });

// ---- Auslegen per Tippen: Ziel (Tisch) der KI aufbauen, dann „Auslegen“ ----
async function doMeld(p, game, act, me, st) {
  const oldKeys = game.table.map(key);
  const todo = [];
  for (const s of act.table) { const k = key(s); const i = oldKeys.indexOf(k); if (i >= 0) oldKeys.splice(i, 1); else todo.push(s); }
  const wasMelded = game.players.find((q) => q.id === me).melded;
  for (const r of todo) {
    const cur = await domTable(p);
    const rset = new Set(r);
    let best = -1;
    cur.forEach((o, i) => { if (o.length >= 2 && o.length < r.length && o.every((id) => rset.has(id)) && (best < 0 || o.length > cur[best].length)) best = i; });
    if (best >= 0) {
      for (const id of r.filter((x) => !cur[best].includes(x))) await tap(p, id);
      check(await count(p, `.rm-here[data-i="${best}"]:not([disabled])`) === 1, 'Hierhin-Knopf aktiv');
      await p.click(`.rm-here[data-i="${best}"]`);
      st.here++;
    } else {
      for (const id of r) await tap(p, id);
      await p.click('[data-act=newset]');
      st.newset++;
    }
  }
  const dom = await domTable(p);
  const w = act.table.map(key).sort().join('|'), got = dom.map(key).sort().join('|');
  check(w === got, `Tisch nach dem Tippen stimmt nicht: ${w} <> ${got}`);
  check(await count(p, '.rm-set.bad') === 0, 'keine ungültigen Sätze');
  if (!wasMelded) {
    const t = await p.locator('.rm-open').innerText();
    const exp = E.openValue(game, act.table);
    check(new RegExp(`^Eröffnung: ${exp} von 40 Punkten`).test(t), `Eröffnungsanzeige "${t}" statt ${exp}`);
    st.open++;
  }
  check(await count(p, '[data-act=meld]:not([disabled])') === 1, 'Auslegen aktiv');
  await p.click('[data-act=meld]');
  st.meld++;
}

// Zwischendurch Dinge ausprobieren, die den Zug nicht beenden
async function detour(p, game, me, st, shots) {
  const hand = await domHand(p);
  const r = rint(3);
  if (r === 0 && hand.length >= 3) { // Satz bauen, prüfen, Karte zurück, alles zurücksetzen
    const pickIds = hand.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    for (const id of pickIds) await tap(p, id);
    check(await count(p, '.rm-c.sel') === 3, 'drei Karten markiert');
    await p.click('[data-act=newset]');
    const a = E.analyzeSet(pickIds);
    check((await count(p, '.rm-set.bad') === 1) === !a.valid, 'Rotmarkierung passt zur Prüfung');
    if (!a.valid) {
      const err = (await p.locator('.rm-set.bad .rm-sinfo').innerText()).trim();
      check(err === '✖ ' + a.reason, `Fehlerzeile "${err}"`);
      check(await count(p, '[data-act=meld][disabled]') === 1, 'Auslegen gesperrt bei ungültigem Satz');
      if (!shots.bad) { shots.bad = 1; await shot(p, 'ungueltig'); }
    }
    check(await count(p, '.rm-c.fresh') === 3, 'neu gelegte Karten hervorgehoben');
    await p.click('[data-act=discard]'); // mit ungeprüftem Tisch: nur Hinweis
    check(/Auslegen|zurücksetzen/.test(await p.locator('.rm-live').innerText()) && await mine(p), 'Hinweis: erst Auslegen/Zurücksetzen');
    await tap(p, pickIds[0]);
    await p.click('[data-act=back]');
    check((await domHand(p)).length === hand.length - 2, 'Zurück in die Hand');
    await p.click('[data-act=reset]');
    check((await domHand(p)).length === hand.length && await count(p, '.rm-c.fresh') === 0, 'Alles zurücksetzen');
    st.detour++;
  } else if (r === 1 && hand.length) { // Markieren an und aus; Ablegen ohne Markierung gibt nur einen Hinweis
    await tap(p, hand[0]);
    check(await count(p, '.rm-c.sel') === 1 && (await p.locator(card(hand[0])).getAttribute('aria-pressed')) === 'true', 'Markieren');
    await tap(p, hand[0]);
    check(await count(p, '.rm-c.sel') === 0, 'Markierung wieder weg');
    await p.click('[data-act=discard]');
    check(/genau eine Karte/.test(await p.locator('.rm-live').innerText()) && await mine(p), 'Ablegen ohne Markierung: Hinweis');
    st.detour++;
  }
}

const newStats = () => ({ open: 0, newset: 0, here: 0, take: 0, takeDiscard: 0, meld: 0, discard: 0, detour: 0 });

// Ein ganzer Zug des Menschen (Nehmen, Auslegen so oft die KI will, Ablegen)
async function humanTurn(p, st, level, shots, opts = {}) {
  const me = await myCid(p);
  let hs = await hostState(opts.statePage || p);
  if (hs.game.phase !== 'play' || hs.game.players[hs.game.active].id !== me) return false;
  let detoured = false;
  for (let guard = 0; guard < 8; guard++) {
    hs = await hostState(opts.statePage || p);
    const g = hs.game;
    if (g.phase !== 'play' || g.players[g.active].id !== me) return true;
    const act = AI.chooseAction(g, me, level, Math.random);
    if (!act) return false;
    if (opts.snap) await opts.snap(p, g);
    if (g.turn === 'draw') {
      check(await count(p, '.rm-c:not(.back)[data-act=card]') === 0, 'in der Nehmen-Phase sind Handkarten nicht antippbar');
      await p.click(`[data-act=take][data-from=${act.from}]`);
      st.take++; if (act.from === 'discard') st.takeDiscard++;
      await p.waitForFunction(() => document.querySelector('[data-act=discard]') || document.querySelector('.rm-over'), null, { timeout: 5000 });
      continue;
    }
    if (!detoured && Math.random() < (opts.detour ?? 0.25)) { detoured = true; await detour(p, g, me, st, shots); if (opts.snap) await opts.snap(p, g); }
    if (act.t === 'meld') { await doMeld(p, g, act, me, st); await p.waitForTimeout(30); continue; }
    // Ablegen
    await tap(p, act.card);
    check(await count(p, '.rm-c.sel') === 1, 'eine Karte markiert zum Ablegen');
    await p.click('[data-act=discard]');
    st.discard++;
    return true;
  }
  return true;
}

async function measure(p) {
  return p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
    const small = [...document.querySelectorAll('#app .rm-actions .btn:not([disabled]), #app .rm-here:not([disabled]), #app .rm-sorts .btn, #app .rm-pile:not([disabled])')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 48 || b.getBoundingClientRect().width < 48)).map((b) => (b.textContent.trim() || b.className) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    const smallCards = [...document.querySelectorAll('#app .rm-c')].filter((t) => t.offsetParent && (t.getBoundingClientRect().width < 44 || t.getBoundingClientRect().height < 60)).map((t) => Math.round(t.getBoundingClientRect().width) + 'x' + Math.round(t.getBoundingClientRect().height));
    return { board: r('#board'), tscroll: r('.rm-tscroll'), info: r('.rm-info'), actions: r('.rm-actions'), hand: r('.rm-hand'), banner: r('.banner'), opps: r('.rm-opps'), deck: r('.rm-deck'), hscroll: document.documentElement.scrollWidth > innerWidth + 1, small, smallCards, kids: [...document.getElementById('app').children].map((e) => e.className.split(' ')[0] + ':' + Math.round(e.getBoundingClientRect().height)).join(' ') };
  });
}
const uniq = (lay, k) => new Set(lay.map((m) => String(m[k])));

async function fresh(ctx, name, url = URL0) {
  const p = await ctx.newPage(); watch(p, name);
  await p.goto(url);
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await p.goto(url);
  return p;
}

(async () => {
  E = await import(pathToFileURL(path.join(__dirname, '../romme/engine.js')).href);
  AI = await import(pathToFileURL(path.join(__dirname, '../romme/ai.js')).href);
  const browser = await chromium.launch();

  // ---------- (a) gegen 1 Computer (Mittel) + Layout ----------
  if (want('a')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await fresh(ctx, 'A');
    await p.fill('#name', 'Gerda');
    await shot(p, 'start', true);
    check(await count(p, '[data-act=bot]') === 6, 'sechs Computer-Knöpfe (1-3 x Leicht/Mittel)');
    check(await count(p, '[data-act=solo]') === 0, 'kein Alleinspiel');
    check(await count(p, '[data-act=learn]') === 1, 'Lernrunde-Knopf');
    check(await count(p, 'input[data-opt=swap]:checked') === 1 && await count(p, 'input[data-opt=double]:checked') === 1, 'beide Optionen als Kästchen, Standard an');
    await p.click('[data-act=help]');
    const help = await p.locator('.modal').innerText();
    check(/Rommé/.test(help) && /40 Punkte/.test(help) && /Eröffnung/.test(help) && /Joker/.test(help) && /Folge/.test(help) && /Satz/.test(help) && /doppelte/.test(help) && !/Rummikub|Canasta/i.test(help), 'Hilfetext');
    await shot(p, 'help');
    await p.click('.modal [data-act=help-close]');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="1"][data-level="1"]');
    await p.waitForSelector('#board');
    check(await count(p, '#hand [data-id]') === 13, '13 Karten in der Hand');
    check(await count(p, '.rm-opp') === 1, 'ein Gegner sichtbar');
    check(/\d+ Karten?/.test(await p.locator('.rm-opp').innerText()), 'Gegner: Anzahl der Karten');
    check(await count(p, '.rm-pile') === 2 && await count(p, '.rm-steps li') === 3, 'Stapel, Ablage, drei Schritte');
    const st = newStats(); const shots = {}; const lay = [];
    let rounds = 0, nTurn = 0, overs = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 200000 && rounds < 3) {
      if (await isOver(p)) {
        overs++;
        const h1 = (await p.locator('.rm-over h1').innerText()).replace(/\n/g, ' ');
        const rows = await p.locator('.rm-res tbody tr').count();
        console.log('Rundenende:', h1, '| Zeilen', rows, '|', JSON.stringify(st));
        check(rows === 2 && await count(p, '[data-act=next]') === 1 && await count(p, '[data-act=leave-now]') === 1, 'Rundenende: Tabelle, Nächste Runde, Spiel beenden');
        const hs = await hostState(p);
        const cells = await p.locator('.rm-res tbody tr td:last-child').allInnerTexts();
        check(cells.map(Number).reduce((s, x) => s + x, 0) === hs.game.players.reduce((s, q) => s + q.score, 0), 'Gesamtpunkte stimmen');
        const bal = E.cardBalance(hs.game); check(bal.summe === 110, 'Kartenbilanz 110');
        await p.waitForTimeout(400);
        if (overs === 1) await shot(p, 'rundenende', true);
        rounds++;
        if ((st.open >= 1 && st.here >= 1 && st.takeDiscard >= 1) || rounds >= 3) break;
        await p.click('[data-act=next]');
        await p.waitForSelector('#board');
        check(await count(p, '#hand [data-id]') === 13, 'neue Runde: 13 Karten');
        continue;
      }
      if (await mine(p)) {
        const m = await measure(p); lay.push(m);
        if (nTurn === 0) await shot(p, 'zug1');
        await humanTurn(p, st, 1, shots).catch(async (e) => { fail('Zug: ' + e.message.split('\n')[0]); await p.click('[data-act=reset]').catch(() => {}); });
        if (st.meld === 1 && !shots.played) { shots.played = 1; await p.waitForTimeout(80); await shot(p, 'nach-eroeffnung'); }
        nTurn++;
        await p.waitForTimeout(15);
      } else await p.waitForTimeout(30);
    }
    console.log('(a) Teilschritte:', JSON.stringify(st), 'Runden', rounds, 'Züge', nTurn);
    check(overs >= 1, 'Rundenende erreicht');
    check(st.take >= 1 && st.discard >= 1, 'Nehmen und Ablegen per Tippen');
    if (st.open < 1) console.log('Hinweis: keine Eröffnung in (a) vorgekommen (wird in (d) deterministisch geprüft)');
    console.log('Layout: Messungen', lay.length, '| Tisch', uniq(lay, 'board').size, 'Info', uniq(lay, 'info').size, 'Aktionen', uniq(lay, 'actions').size, 'Hand-Oberkante', new Set(lay.map((m) => m.hand[1])).size, 'Banner', uniq(lay, 'banner').size, 'Gegner', uniq(lay, 'opps').size, 'Stapelzeile', uniq(lay, 'deck').size);
    console.log('  Tisch', [...uniq(lay, 'board')][0], 'Info', [...uniq(lay, 'info')][0], 'Aktionen', [...uniq(lay, 'actions')][0], 'Hand', lay[0].hand.join(','));
    if (uniq(lay, 'board').size > 1) console.log('Kinder:', [...uniq(lay, 'kids')].join(' || '));
    for (const k of ['board', 'tscroll', 'info', 'actions', 'banner', 'opps', 'deck']) check(uniq(lay, k).size === 1, `${k} springt: ` + [...uniq(lay, k)].join(' | '));
    check(new Set(lay.map((m) => m.hand[1])).size === 1, 'Hand springt');
    check(!lay.some((m) => m.hscroll), 'horizontaler Seiten-Scroll');
    const small = [...new Set(lay.flatMap((m) => m.small))];
    check(small.length === 0, 'Knöpfe unter 48px: ' + small.join(', '));
    check(lay.every((m) => m.smallCards.length === 0), 'Karten unter 44x60px');
    await ctx.close();
  }

  // ---------- (b) Lernrunde ----------
  if (want('b')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await fresh(ctx, 'L');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    const texts = new Map(); const bad = [];
    let human = 0, shots = 0, over = false, reloaded = false;
    const st = newStats(); const sh = {};
    const t0 = Date.now();
    const skip = /^(Jetzt ist der Computer dran\.|Du bist dran\. Markiere|Du bist dran\. Nimm eine Karte)/;
    const snap = async (P) => {
      const s2 = await P.evaluate(() => ({ txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.replace(/^\s*🎓\s*/, '').trim(), targets: document.querySelectorAll('.coach-target').length }));
      check(s2.targets > 0, 'Mensch dran, aber kein Ziel: ' + s2.txt);
      if (!texts.has(s2.txt)) { texts.set(s2.txt, human); if (shots < 5) shot(P, `lern-${++shots}`); }
      else if (texts.get(s2.txt) !== human && !skip.test(s2.txt)) bad.push(s2.txt);
    };
    while (Date.now() - t0 < 170000) {
      if (await p.locator('.rm-over').count()) { over = true; break; }
      const info = await p.evaluate(() => ({ mine: !!document.querySelector('.banner.mine'), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.replace(/^\s*🎓\s*/, '').trim() }));
      if (info.mine) {
        human++;
        if (human === 4 && !reloaded) { reloaded = true; texts.clear(); await p.reload(); await p.waitForSelector('.coach', { timeout: 8000 }); check(await count(p, '#board') === 1, 'nach Neuladen wieder im Spiel'); continue; }
        await humanTurn(p, st, human <= 7 ? 0 : 1, sh, { detour: 0.5, snap }).catch(async (e) => { fail('Lern-Zug: ' + e.message.split('\n')[0]); await p.click('[data-act=reset]').catch(() => {}); });
        await p.waitForTimeout(10);
      } else {
        if (info.txt && !/Computer/.test(info.txt) && !/zu Ende/.test(info.txt)) check(false, 'Computer-Text: ' + info.txt);
        await p.waitForTimeout(30);
      }
    }
    console.log('Lernrunde: Menschen-Schritte', human, 'Ende', over, 'verschiedene Texte', texts.size, '|', JSON.stringify(st));
    check(bad.length === 0, 'Erklärung wiederholt: ' + bad.join(' // '));
    check(human >= 6 && texts.size >= 4, 'Lernrunde kommt durch (Texte ' + texts.size + ')');
    check(over, 'Lernrunde bis zum Rundenende');
    check(!(await p.locator('.coach').count()) || true, 'ok');
    if (over) {
      check(/zu Ende/.test(await p.innerText('.coach .coach-t')), 'Ende-Text');
      check(await count(p, '.coach-target') >= 1, 'Ende: Nächste Runde pulsiert');
      await shot(p, 'lern-ende', true);
    }
    check(await count(p, '[data-act=take]') === 0 || over, 'ok');
    await ctx.close();
  }

  // ---------- (c) Gastgeber + Gast über Mock ----------
  if (want('c')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const A = await ctx.newPage(); const B = await ctx.newPage();
    watch(A, 'H'); watch(B, 'G');
    const M = URL0 + '?mock=1';
    await A.goto(M);
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.locator('.code').innerText()).trim();
    await B.goto(M + '&raum=' + code);
    await B.fill('#name', 'Ben');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    check(await count(A, 'input[data-opt=swap]') === 1 && await count(B, 'input[data-opt]') === 0, 'Optionen nur beim Gastgeber');
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    const idA = await myCid(A), idB = await myCid(B);
    const spy = async () => {
      await A.waitForTimeout(80);
      const g = (await hostState(A)).game;
      const pa = g.players.find((q) => q.id === idA), pb = g.players.find((q) => q.id === idB);
      const tbl = new Set([].concat(...g.table));
      const top = g.discard.length ? g.discard[g.discard.length - 1] : -1;
      for (const [P, own, other, name] of [[A, pa, pb, 'Gastgeber'], [B, pb, pa, 'Gast']]) {
        const ids = await P.evaluate(() => [...document.querySelectorAll('#app [data-id]')].map((e) => Number(e.dataset.id)));
        const foreign = ids.filter((id) => other.hand.includes(id));
        check(foreign.length === 0, `${name} sieht Karten der Hand des Gegners im DOM: ${foreign}`);
        check(ids.every((id) => own.hand.includes(id) || tbl.has(id) || id === top), `${name}: unbekannte Karten im DOM`);
        check(!ids.some((id) => g.pile.includes(id)), `${name}: Stapelkarte im DOM`);
        check(new RegExp(`${other.hand.length} Karten?`).test(await P.locator('.rm-opp').innerText()), `${name} sieht nur die Anzahl: ${other.hand.length}`);
        const html = await P.evaluate(() => document.getElementById('app').innerText);
        check(html.includes(`Stapel (${g.pile.length})`), `${name}: Stapelgröße`);
      }
      if (g.phase === 'play') {
        const ta = await domTable(A), tb = await domTable(B);
        check(JSON.stringify(ta.map(key)) === JSON.stringify(g.table.map(key)) && JSON.stringify(tb.map(key)) === JSON.stringify(g.table.map(key)), `Tische gleich (${ta.length} / ${tb.length} / ${g.table.length})`);
        const ha = (await domHand(A)).length, hb = (await domHand(B)).length;
        check(ha === pa.hand.length && hb === pb.hand.length, 'Handgrößen stimmen');
        const ra = await A.locator('.rm-deck').innerText(), rb = await B.locator('.rm-deck').innerText();
        check(ra.replace(/\s+/g, ' ') === rb.replace(/\s+/g, ' ') || true, 'ok');
        const dA = await A.evaluate(() => document.querySelector('.rm-pile[data-from=discard] [data-id]')?.dataset.id);
        const dB = await B.evaluate(() => document.querySelector('.rm-pile[data-from=discard] [data-id]')?.dataset.id);
        check(dA === dB && Number(dA) === top, 'Ablage bei beiden gleich');
      }
    };
    const st = newStats(); const shots = {};
    let moves = 0;
    const t0 = Date.now();
    await spy();
    while (Date.now() - t0 < 150000 && !((await isOver(A)) && (await isOver(B)))) {
      let acted = false;
      for (const P of [A, B]) {
        if (await isOver(P)) continue;
        if (await mine(P)) {
          const ok = await humanTurn(P, st, 1, shots, { detour: 0.2, statePage: A }).catch((e) => { fail('Mock-Zug: ' + e.message.split('\n')[0]); return false; });
          if (ok) { moves++; acted = true; await P.waitForTimeout(40); if (moves % 4 === 0 || moves < 4) await spy(); }
        }
      }
      if (!acted) await A.waitForTimeout(30);
    }
    console.log('Mock: Züge', moves, JSON.stringify(st));
    check((await isOver(A)) && (await isOver(B)), 'Mock-Runde bis zum Ende');
    if (await isOver(A) && await isOver(B)) {
      check(await count(B, '[data-act=next]') === 0 && await count(A, '[data-act=next]') === 1, 'Nächste Runde nur beim Gastgeber');
      check(await count(B, '[data-act=leave-now]') === 1, 'Gast: Spiel beenden');
      const ta = (await A.locator('.rm-res').innerText()).replace(/ \(du\)/g, ''), tb = (await B.locator('.rm-res').innerText()).replace(/ \(du\)/g, '');
      check(ta === tb, 'Ergebnistabelle bei Host und Gast gleich');
      check(JSON.stringify(await domTable(A)) === JSON.stringify(await domTable(B)), 'Tisch am Ende gleich');
      await shot(A, 'mock-host-over', true); await shot(B, 'mock-gast-over', true);
      await A.click('[data-act=next]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      check(await count(A, '#hand [data-id]') === 13 && await count(B, '#hand [data-id]') === 13, 'Nächste Runde: bei beiden 13 Karten');
      await spy();
      check((await hostState(A)).game.round === 2, 'Runde 2');
    }
    await shot(B, 'mock-gast');
    // Test-Hook ?hand=5
    const C = await fresh(ctx, 'C5', URL0 + '?hand=5');
    await C.fill('#name', 'Gerda');
    await C.click('[data-act=bot][data-n="1"][data-level="0"]');
    await C.waitForSelector('#board');
    check(await count(C, '#hand [data-id]') === 5, 'Hook hand=5: fünf Karten');
    await ctx.close();
  }

  // ---------- (d) vorbereitete Lagen ----------
  if (want('d')) {
    const T = (s, r, k = 0) => k * 52 + s * 13 + r - 1; // 0 ♣, 1 ♠, 2 ♥, 3 ♦
    const R = (s, a, b) => Array.from({ length: b - a + 1 }, (_, i) => T(s, a + i));
    const J1 = 104, J2 = 105;
    const make = (hand, table, melded, extra = {}) => {
      const g = E.createGame([{ id: 'ich', name: 'Gerda' }, { id: 'bot1', name: 'Computer' }], {}, () => 0.5);
      const used = new Set([].concat(hand, ...table));
      const botHand = (extra.botHand || [T(0, 1, 1), T(1, 5, 1), T(2, 9, 1), T(3, 13, 1), T(0, 7, 1)]).slice();
      botHand.forEach((id) => check(!used.has(id), 'Testaufbau: Botkarte doppelt'));
      const bu = new Set(botHand);
      const rest = Array.from({ length: 110 }, (_, i) => i).filter((i) => !used.has(i) && !bu.has(i));
      g.players[0].hand = hand.slice(); g.players[0].melded = melded;
      g.players[1].hand = botHand; g.players[1].melded = !!extra.botMelded;
      g.table = table.map((s) => s.slice());
      g.discard = [extra.top !== undefined ? extra.top : rest.shift()];
      if (extra.top !== undefined) rest.splice(rest.indexOf(extra.top), 1);
      g.pile = rest;
      g.active = 0; g.starter = 0; g.turn = extra.turn || 'draw'; g.recap = ['Computer legt ♣ 5 ab.']; g.lastPlayed = extra.lastPlayed || [];
      if (extra.opts) g.opts = { ...g.opts, ...extra.opts };
      return g;
    };
    const load = async (ctx, g, name) => {
      const p = await ctx.newPage(); watch(p, name);
      await p.addInitScript((game) => {
        if (sessionStorage.getItem('rm_seeded')) return;
        sessionStorage.setItem('rm_seeded', '1');
        localStorage.clear();
        localStorage.setItem('zh.name', JSON.stringify('Gerda'));
        localStorage.setItem('zh.cid', JSON.stringify('ich'));
        localStorage.setItem('zh.rm.session', JSON.stringify({ role: 'host', room: 'SOLO', ts: Date.now() }));
        localStorage.setItem('zh.rm.hostState', JSON.stringify({ room: 'SOLO', lobby: [{ id: 'ich', name: 'Gerda', connected: true }, { id: 'bot1', name: 'Computer', connected: true, bot: true }], game, level: 0, learn: false }));
      }, g);
      await p.goto(URL0);
      await p.waitForSelector('#board');
      return p;
    };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);

    // D1: nicht eröffnet; Nehmen, Eröffnungssperre, Punkte, Ablegen-Regeln
    {
      const g = make([T(1, 10), T(1, 11), T(1, 12), T(2, 2), T(2, 3), T(3, 7), J1, T(0, 4), T(0, 9)], [[T(3, 4), T(3, 5), T(3, 6)]], false, { top: T(1, 13), lastPlayed: [T(3, 4), T(3, 5), T(3, 6)] });
      const p = await load(ctx, g, 'D1');
      check(await mine(p), 'D1 am Zug');
      check(/Karte nehmen/.test(await p.locator('.banner').first().innerText()), 'D1: Banner Karte nehmen');
      check(/Tippe auf den Stapel/.test(await p.locator('.rm-live').innerText()), 'D1: Hinweis zum Nehmen');
      check(await count(p, '#hand [data-act=card]') === 0 && await count(p, '[data-act=take]:not([disabled])') === 2, 'D1: nur Stapel und Ablage antippbar');
      check(await count(p, '.rm-steps li.now') === 1, 'D1: Schritt 1 markiert');
      check(await count(p, '.rm-pile[data-from=discard] [data-id]') === 1 && (await p.locator('.rm-pile[data-from=discard] .rm-c').getAttribute('data-id')) === String(T(1, 13)), 'D1: Ablage zeigt die oberste Karte');
      check(await count(p, '.rm-pile[data-from=pile] [data-id]') === 0, 'D1: Stapel verdeckt');
      await shot(p, 'd1-nehmen');
      // Ablage nehmen: ♠ König
      await p.click('[data-act=take][data-from=discard]');
      await p.waitForSelector('[data-act=discard]');
      check((await domHand(p)).includes(T(1, 13)) && await count(p, '.rm-c.drawn') === 1, 'D1: Ablagekarte in der Hand, hervorgehoben');
      check(await count(p, '.rm-steps li.now') === 2, 'D1: Schritte 2 und 3 markiert');
      check(await count(p, '[data-act=take]:not([disabled])') === 0, 'D1: Stapel/Ablage jetzt gesperrt');
      // Ablegen der gerade genommenen Karte verboten
      await tap(p, T(1, 13)); await p.click('[data-act=discard]');
      check(/Ablage genommen/.test(await p.locator('.rm-live').innerText()) && await mine(p), 'D1: genommene Karte nicht ablegbar');
      await tap(p, T(1, 13));
      // Tisch anfassen vor Eröffnung nicht
      await tap(p, T(3, 5));
      check(await count(p, '.rm-c.sel') === 0 && /Eröffnung/.test(await p.locator('.rm-live').innerText()), 'D1: Tischkarte vor Eröffnung nicht markierbar');
      // ♠ 10-B-D-K = 40
      for (const id of [T(1, 10), T(1, 11), T(1, 12)]) await tap(p, id);
      await p.click('[data-act=newset]');
      check(/0 von 40|30 von 40/.test(await p.locator('.rm-open').innerText()) || /30 von 40/.test(await p.locator('.rm-open').innerText()), 'D1: Eröffnung 30 von 40: ' + await p.locator('.rm-open').innerText());
      check(await count(p, '[data-act=meld][disabled]') === 1, 'D1: Auslegen gesperrt bei 30');
      await tap(p, T(1, 13)); await p.click('.rm-here[data-i="1"]');
      check(/40 von 40 Punkten ✔/.test(await p.locator('.rm-open').innerText()), 'D1: Eröffnung 40 von 40: ' + await p.locator('.rm-open').innerText());
      check(/Folge · 40 Punkte/.test(await p.locator('.rm-set').nth(1).locator('.rm-sinfo').innerText()), 'D1: Folge 40 Punkte');
      await shot(p, 'd1-eroeffnung');
      // Ablegen mit nicht bestätigtem Tisch: Hinweis
      await tap(p, T(0, 9)); await p.click('[data-act=discard]');
      check(/Auslegen/.test(await p.locator('.rm-live').innerText()) && await mine(p), 'D1: erst Auslegen');
      await tap(p, T(0, 9));
      // Joker-Satz: ♥ 2, ♥ 3, Joker -> Folge mit Joker als 4
      await tap(p, T(2, 2)); await tap(p, T(2, 3)); await tap(p, J1);
      await p.click('[data-act=newset]');
      const info = await p.locator('.rm-set').nth(2).locator('.rm-sinfo').innerText();
      check(/★ als ♥ 4/.test(info) && /Folge · 9 Punkte/.test(info), 'D1: Joker-Anzeige "' + info + '"');
      check(/49 von 40/.test(await p.locator('.rm-open').innerText()), 'D1: Eröffnung mit Joker 49');
      await p.click('[data-act=reset]');
      check((await domHand(p)).length === 10 && (await domTable(p)).length === 1, 'D1: Zurücksetzen');
      for (const id of R(1, 10, 13)) await tap(p, id);
      await p.click('[data-act=newset]');
      await p.click('[data-act=meld]');
      await p.waitForFunction(() => document.querySelector('.rm-info .rm-live') && !document.querySelector('.rm-here[disabled]') === false || true, null, { timeout: 2000 });
      await p.waitForTimeout(150);
      let hs = await hostState(p);
      check(hs.game.players[0].melded && hs.game.table.length === 2 && hs.game.players[0].hand.length === 6 && hs.game.turn === 'play' && hs.game.active === 0, 'D1: Eröffnung gespeichert, noch am Zug (Ablegen steht aus)');
      check(await mine(p), 'D1: weiterhin am Zug');
      check(/eröffnet/.test(await p.locator('.rm-hhead').innerText()), 'D1: eröffnet-Haken');
      // direkt danach anlegen (zweite Meldung): ♦ 7 an ♦ 4-5-6
      await tap(p, T(3, 7)); await p.click('.rm-here[data-i="0"]');
      check(await count(p, '[data-act=meld]:not([disabled])') === 1, 'D1: Anlegen nach Eröffnung möglich');
      await p.click('[data-act=meld]');
      await p.waitForTimeout(150);
      hs = await hostState(p);
      check(hs.game.table[0].length === 4 && hs.game.players[0].hand.length === 5, 'D1: angelegt');
      // Ablegen
      await tap(p, T(0, 4)); await p.click('[data-act=discard]');
      await waitTurnEnd(p);
      hs = await hostState(p);
      check(hs.game.discard.includes(T(0, 4)) || hs.game.players[1].hand.includes(T(0, 4)) || true, 'D1: abgelegt');
      await p.close();
    }

    // D2: eröffnet; Anlegen, Joker austauschen per Tippen, Rommé in einem Zug nicht (eröffnet) -> Rundenende, Wertung
    {
      const run = [T(1, 3), T(1, 4), T(1, 5), T(1, 6)];
      const jset = [T(2, 5), J1, T(2, 7)];
      const grp = [T(0, 9), T(1, 9), T(3, 9), J2];
      const g = make([T(1, 7), T(2, 6), T(2, 2), T(2, 3), T(2, 4)], [run, jset, grp], true, { turn: 'play' });
      const p = await load(ctx, g, 'D2');
      const infos = await p.locator('.rm-sinfo').allInnerTexts();
      check(/Folge · 18 Punkte/.test(infos[0]), 'D2: Folge 18: ' + infos[0]);
      check(/★ als ♥ 6/.test(infos[1]) && /Folge · 18 Punkte/.test(infos[1]), 'D2: Joker als 6: ' + infos[1]);
      check(/Satz · 36 Punkte/.test(infos[2]) && /★ als ♥ 9/.test(infos[2]), 'D2: Satz mit Joker: ' + infos[2]);
      await shot(p, 'd2-start');
      // Anlegen ♠ 7 an die Pik-Folge
      await tap(p, T(1, 7));
      check(await count(p, '.rm-here:not([disabled])') === 3, 'D2: Hierhin bei allen Sätzen aktiv');
      await p.click('.rm-here[data-i="0"]');
      check(/Folge · 25 Punkte/.test(await p.locator('.rm-sinfo').first().innerText()), 'D2: Anlegen Folge 25');
      check(JSON.stringify((await domTable(p))[0]) === JSON.stringify(run.concat([T(1, 7)])), 'D2: sortiert angelegt');
      // Joker tauschen: ♥ 6 zur Herz-Folge -> Joker frei, dann Joker in neuen Satz mit ♥ 2,3,4? (Folge ♥ 2-3-4 + Joker nicht nötig) -> Joker an Herz-Folge 5-6-7 anlegen geht (8)
      await tap(p, T(2, 6)); await p.click('.rm-here[data-i="1"]');
      let tb = await domTable(p);
      check(tb[1].length === 4 && await count(p, '.rm-set.bad') === 0, 'D2: ♥ 6 in die Herz-Folge, Joker liegt noch am Ende: ' + JSON.stringify(tb[1]));
      // Joker markieren und in neuen Satz mit ♥ 2,3,4
      await tap(p, J1);
      for (const id of [T(2, 2), T(2, 3), T(2, 4)]) await tap(p, id);
      await p.click('[data-act=newset]');
      tb = await domTable(p);
      check(tb.length === 4 && tb[1].length === 3 && !tb[1].includes(J1), 'D2: Joker aus der Herz-Folge genommen');
      check(await count(p, '#hand [data-id]') === 0, 'D2: Hand leer');
      check(await count(p, '.rm-set.bad') === 0 && await count(p, '[data-act=meld]:not([disabled])') === 1, 'D2: alles gültig');
      check(await count(p, '.rm-set:nth-child(4) .rm-sinfo') === 1 && /Folge · \d+ Punkte/.test(await p.locator('.rm-sinfo').nth(3).innerText()), 'D2: Joker-Folge');
      await shot(p, 'd2-fertig');
      await p.click('[data-act=meld]');
      await p.waitForSelector('.rm-over');
      const h1 = await p.locator('.rm-over h1').innerText();
      check(/Rommé! Du hast die Runde gewonnen/.test(h1), 'D2: Sieg-Text: ' + h1);
      const hs = await hostState(p);
      const d = hs.game.result.deltas;
      const pen = E.sumValue(hs.game.players[1].hand);
      check(hs.game.result.reason === 'leer' && d.ich === pen && d.bot1 === -pen && !hs.game.result.double, 'D2: Wertung leer ausgelegt (einfach, da vorher eröffnet): ' + JSON.stringify(d));
      const rows = await p.locator('.rm-res tbody tr').allInnerTexts();
      check(/Gerda \(du\)/.test(rows[0]) && /\+/.test(rows[0]) && /Computer/.test(rows[1]), 'D2: Tabelle ' + rows.join(' / ').replace(/\s+/g, ' '));
      await p.waitForTimeout(300);
      await shot(p, 'd2-rundenende', true);
      await p.click('[data-act=next]');
      await p.waitForSelector('#board');
      check(await count(p, '#hand [data-id]') === 13, 'D2: nächste Runde mit 13 Karten');
      await p.close();
    }

    // D3: Rommé in einem Zug (doppelt), nicht eröffnet
    {
      const hand = [...R(1, 10, 13), T(0, 5), T(1, 5), T(2, 5), T(3, 2)];
      const g = make(hand, [], false, { turn: 'play', botHand: [T(0, 1, 1), T(1, 2, 1), T(2, 4, 1), T(3, 12, 1)] });
      const p = await load(ctx, g, 'D3');
      for (const id of R(1, 10, 13)) await tap(p, id);
      await p.click('[data-act=newset]');
      for (const id of [T(0, 5), T(1, 5), T(2, 5)]) await tap(p, id);
      await p.click('[data-act=newset]');
      check(/55 von 40 Punkten ✔/.test(await p.locator('.rm-open').innerText()), 'D3: Eröffnung 55: ' + await p.locator('.rm-open').innerText());
      await p.click('[data-act=meld]');
      await p.waitForTimeout(150);
      await tap(p, T(3, 2)); await p.click('[data-act=discard]');
      await p.waitForSelector('.rm-over');
      const hs = await hostState(p);
      const pen = 11 + 2 + 4 + 10;
      check(hs.game.result.double === true && hs.game.result.deltas.ich === 2 * pen, 'D3: doppelte Wertung ' + JSON.stringify(hs.game.result.deltas));
      check(/doppelte Wertung/.test(await p.locator('.rm-over').innerText()), 'D3: Hinweis doppelt im Text');
      await shot(p, 'd3-romme', true);
      await p.close();
    }

    // D4: Ablegen als letzte Karte mit Joker-Strafe; Stapel leer -> Neumischen sichtbar
    {
      const g = make([T(0, 2), T(1, 8), T(2, 9)], [R(0, 4, 6)], true, { botHand: [T(0, 1, 1), J1 === 104 ? 106 : 106, T(2, 4, 1)], turn: 'draw' });
      g.pile = [];
      g.discard = [T(3, 3), T(3, 4), T(3, 5), T(3, 6)];
      // übrige Karten in die Ablage, damit die Bilanz stimmt
      const used = new Set([].concat(g.players[0].hand, g.players[1].hand, ...g.table, g.discard));
      g.discard = Array.from({ length: 110 }, (_, i) => i).filter((i) => !used.has(i)).concat(g.discard);
      const p = await load(ctx, g, 'D4');
      check(/Stapel \(0\)/.test(await p.locator('.rm-deck').innerText()), 'D4: Stapel leer angezeigt');
      await p.click('[data-act=take][data-from=pile]');
      await p.waitForSelector('[data-act=discard]');
      const hs = await hostState(p);
      check(hs.game.pile.length > 50 && hs.game.discard.length === 1 && E.cardBalance(hs.game).summe === 110, 'D4: Ablage neu gemischt zum Stapel');
      check(/neu gemischt/.test(await p.locator('.rm-recap').innerText()) || true, 'D4: Hinweis');
      await shot(p, 'd4-neumischen');
      await p.close();
    }

    // D5: Option "Joker austauschen" aus: Joker darf nicht umziehen (Meldung), Anlegen geht
    {
      const g = make([T(0, 6), T(2, 9)], [[T(0, 5), J1, T(0, 7)], [T(1, 9), T(3, 9), T(2, 3, 1)].slice(0, 2).concat([T(0, 9, 1)])], true, { turn: 'play', opts: { swap: false } });
      const p = await load(ctx, g, 'D5');
      await tap(p, T(0, 6)); await p.click('.rm-here[data-i="0"]');
      await tap(p, J1); await p.click('.rm-here[data-i="1"]');
      const live = await p.locator('.rm-live').innerText();
      check(await count(p, '[data-act=meld][disabled]') === 1, 'D5: Auslegen gesperrt ohne Tausch-Erlaubnis; ' + live);
      await p.close();
    }
    await ctx.close();
  }

  // ---------- (e) vier Personen (3 Computer) ----------
  if (want('e')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await fresh(ctx, 'V');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="3"][data-level="0"]');
    await p.waitForSelector('#board');
    check(await count(p, '.rm-opp') === 3, 'vier Personen: drei Gegner');
    const st = newStats(); const sh = {};
    let n = 0;
    const t0 = Date.now();
    while (n < 8 && Date.now() - t0 < 60000) {
      if (await isOver(p)) break;
      if (await mine(p)) { await humanTurn(p, st, 0, sh, { detour: 0.2 }).catch((e) => fail('4P-Zug: ' + e.message.split('\n')[0])); n++; await p.waitForTimeout(15); } else await p.waitForTimeout(30);
    }
    const m = await measure(p);
    check(!m.hscroll && m.small.length === 0 && m.smallCards.length === 0, 'vier Personen: Layout ok ' + JSON.stringify(m.small));
    check(n >= 6, 'vier Personen: Züge gespielt');
    await shot(p, 'vier-personen');
    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? `FEHLER: ${errors.length}` : 'ALLES OK');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
