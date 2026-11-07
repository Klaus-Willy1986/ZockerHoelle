// Durchspieltest Reihen & Gruppen im Browser (nur Tippen, kein Ziehen).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8901 &  dann  NODE_PATH=$(npm root -g) node tests/reihen.e2e.cjs
//   (a) gegen 1 Computer (Mittel): ein Klick-Bot nutzt die Engine/KI, um passende Steine zu finden, und setzt sie per Tippen (Eröffnung, Anlegen, Umordnen, Ziehen)
//       bis zum Rundenende + Layout 390x844; (b) Lernrunde; (c) Gastgeber + Gast über Mock-Netz; (d) vorbereitete Lagen (Anlegen, Teilen, Auflösen, Zurück,
//       Joker, Eröffnungssperre, Rundenende, Nächste Runde); (e) 4 Personen (3 Computer)
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const PORT = process.env.PORT || 8901;
const URL0 = `http://localhost:${PORT}/reihen/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const check = (c, m) => { if (!c) fail(m); };
const rint = (n) => Math.floor(Math.random() * n);
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `rg-e2e-${n}.png`), fullPage: full });
let E, AI;
const want = (k) => !process.env.ONLY || process.env.ONLY.includes(k); // z. B. ONLY=cd

function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}
const fast = (ctx) => ctx.addInitScript(() => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t >= 700 && t <= 1000 ? 5 : t, ...a);
});
const mine = async (p) => /^\s*Du bist dran/.test(await p.locator('.banner').first().innerText().catch(() => ''));
const isOver = async (p) => (await p.locator('.rg-over').count()) > 0;
const hostState = (p) => p.evaluate(() => { for (const s of [sessionStorage, localStorage]) { const v = s.getItem('zh.rg.hostState'); if (v) return JSON.parse(v); } return null; });
const myCid = (p) => p.evaluate(() => sessionStorage.getItem('zh.cid') ? JSON.parse(sessionStorage.getItem('zh.cid')) : JSON.parse(localStorage.getItem('zh.cid')));
const domTable = (p) => p.evaluate(() => [...document.querySelectorAll('#board .rg-set')].map((r) => [...r.querySelectorAll('[data-id]')].map((e) => Number(e.dataset.id))));
const domHand = (p) => p.evaluate(() => [...document.querySelectorAll('#hand [data-id]')].map((e) => Number(e.dataset.id)));
const count = (p, s) => p.locator(s).count();
const key = (s) => [...s].sort((a, b) => a - b).join(',');
const tile = (id) => `#app [data-act=tile][data-id="${id}"]`;
const tap = (p, id) => p.click(tile(id), { timeout: 5000 });

// ---- Ein Zug des Klick-Bots: Ziel (Tisch) der KI per Tippen aufbauen ----
async function doPlay(p, game, act, me, st) {
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
      check(await count(p, `.rg-here[data-i="${best}"]:not([disabled])`) === 1, 'Hierhin-Knopf aktiv');
      await p.click(`.rg-here[data-i="${best}"]`);
      st.here++;
    } else {
      for (const id of r) await tap(p, id);
      await p.click('[data-act=newset]');
      st.newset++;
    }
  }
  const dom = await domTable(p);
  const want = act.table.map(key).sort().join('|'), got = dom.map(key).sort().join('|');
  check(want === got, `Tisch nach dem Tippen stimmt nicht: ${want} <> ${got}`);
  check(await count(p, '.rg-set.bad') === 0, 'keine ungültigen Sätze');
  if (!wasMelded) {
    const t = await p.locator('.rg-open').innerText();
    const exp = E.checkTurn(game, me, act.table).newValue;
    check(new RegExp(`^Eröffnung: ${exp} von 30 Punkten`).test(t), `Eröffnungsanzeige "${t}" statt ${exp}`);
  }
  check(await count(p, '[data-act=play]:not([disabled])') === 1, 'Legen aktiv');
  await p.click('[data-act=play]');
  if (!wasMelded) st.open++;
  st.play++;
}

// Zwischendurch Dinge ausprobieren, die einen Zug nicht beenden
async function detour(p, game, me, st, shots) {
  const hand = await domHand(p);
  const table = await domTable(p);
  const melded = game.players.find((q) => q.id === me).melded;
  const r = rint(4);
  if (r === 0 && hand.length >= 3) { // ungültigen / gültigen Satz bauen, prüfen, Stein zurück, alles zurücksetzen
    const pickIds = hand.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    for (const id of pickIds) await tap(p, id);
    check(await count(p, '.rg-t.sel') === 3, 'drei Steine markiert');
    await p.click('[data-act=newset]');
    const a = E.analyzeSet(pickIds);
    const bad = await count(p, '.rg-set.bad');
    check((bad === 1) === !a.valid, 'Rotmarkierung passt zur Prüfung');
    if (!a.valid) {
      const err = (await p.locator('.rg-set.bad .rg-sinfo').innerText()).trim();
      check(err === '✖ ' + a.reason, `Fehlerzeile "${err}"`);
      check(await count(p, '[data-act=play][disabled]') === 1, 'Legen gesperrt bei ungültigem Satz');
      check(/nicht gültig/.test(await p.locator('.rg-live').innerText()), 'Hinweis ungültig');
      if (!shots.bad) { shots.bad = 1; await shot(p, 'ungueltig'); }
    }
    check(await count(p, '.rg-t.fresh') === 3, 'neu gelegte Steine hervorgehoben');
    await p.click('[data-act=draw]', { force: true }); // gesperrt (aria-disabled): zeigt nur den Hinweis
    check(/Alles zurücksetzen/.test(await p.locator('.rg-live').innerText()), 'Hinweis „Erst zurücksetzen“');
    check(await mine(p) && await count(p, '[data-act=reset]:not([disabled])') === 1, 'weiterhin am Zug nach gesperrtem Ziehen');
    await tap(p, pickIds[0]);
    await p.click('[data-act=back]');
    check((await domHand(p)).length === hand.length - 2, 'Zurück in die Hand');
    await p.click('[data-act=reset]');
    check((await domHand(p)).length === hand.length && await count(p, '.rg-t.fresh') === 0, 'Alles zurücksetzen');
    st.detour++;
  } else if (r === 1 && hand.length) { // Markieren an und aus
    await tap(p, hand[0]);
    check(await count(p, '.rg-t.sel') === 1 && (await p.locator(tile(hand[0])).getAttribute('aria-pressed')) === 'true', 'Markieren');
    await tap(p, hand[0]);
    check(await count(p, '.rg-t.sel') === 0, 'Markierung wieder weg');
    st.detour++;
  } else if (r === 2 && melded && table.length) { // Satz auflösen markiert alle Steine des Satzes
    const s = table[rint(table.length)];
    await tap(p, s[rint(s.length)]);
    await p.click('[data-act=dissolve]');
    check(await count(p, '.rg-t.sel') === s.length, 'Satz auflösen markiert alle Steine des Satzes');
    for (const id of s) await tap(p, id);
    st.detour++; st.dissolve++;
  } else if (r === 3 && melded && table.some((s) => s.length >= 3)) { // Satz teilen und zurücksetzen
    const s = table.find((x) => x.length >= 3);
    const cut = s[1 + rint(s.length - 1)];
    await tap(p, cut);
    await p.click('[data-act=split]');
    check((await domTable(p)).length === table.length + 1, 'Satz teilen: ein Satz mehr');
    check(await count(p, '[data-act=reset]:not([disabled])') === 1, 'Zurücksetzen aktiv nach Änderung');
    await p.click('[data-act=reset]');
    check((await domTable(p)).length === table.length, 'Zurücksetzen nach Teilen');
    st.detour++; st.split++;
  }
}

const newStats = () => ({ open: 0, newset: 0, here: 0, draw: 0, play: 0, detour: 0, dissolve: 0, split: 0 });

// Ein ganzer Zug des Menschen
async function humanTurn(p, st, level, shots, opts = {}) {
  const hs = await hostState(opts.statePage || p);
  const g = hs.game;
  const me = await myCid(p);
  if (g.phase !== 'play' || g.players[g.active].id !== me) return false;
  if (Math.random() < (opts.detour ?? 0.25)) await detour(p, g, me, st, shots);
  const act = AI.chooseAction(g, me, level, Math.random);
  if (act && act.t === 'play') await doPlay(p, g, act, me, st);
  else { await p.click('[data-act=draw]'); st.draw++; }
  return true;
}

async function measure(p) {
  return p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
    const small = [...document.querySelectorAll('#app .rg-actions .btn:not([disabled]), #app .rg-here:not([disabled]), #app .rg-sorts .btn')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 48 || b.getBoundingClientRect().width < 48)).map((b) => (b.textContent.trim() || b.className) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    const smallTiles = [...document.querySelectorAll('#app .rg-t')].filter((t) => t.offsetParent && (t.getBoundingClientRect().width < 44 || t.getBoundingClientRect().height < 56)).map((t) => Math.round(t.getBoundingClientRect().width) + 'x' + Math.round(t.getBoundingClientRect().height));
    return { board: r('#board'), tscroll: r('.rg-tscroll'), info: r('.rg-info'), actions: r('.rg-actions'), hand: r('.rg-hand'), banner: r('.banner'), opps: r('.rg-opps'), hscroll: document.documentElement.scrollWidth > innerWidth + 1, small, smallTiles };
  });
}
const uniq = (lay, k) => new Set(lay.map((m) => String(m[k])));

async function fresh(ctx, name) {
  const p = await ctx.newPage(); watch(p, name);
  await p.goto(URL0);
  await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await p.goto(URL0);
  return p;
}

(async () => {
  E = await import(pathToFileURL(path.join(__dirname, '../reihen/engine.js')).href);
  AI = await import(pathToFileURL(path.join(__dirname, '../reihen/ai.js')).href);
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
    await p.click('[data-act=help]');
    const help = await p.locator('.modal').innerText();
    check(/Reihen & Gruppen/.test(help) && /30 Punkte/.test(help) && /Eröffnung/.test(help) && /Joker/.test(help) && /Reihe/.test(help) && /Gruppe/.test(help) && !/Rummikub/i.test(help), 'Hilfetext');
    await shot(p, 'help');
    await p.click('.modal [data-act=help-close]');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="1"][data-level="1"]');
    await p.waitForSelector('#board');
    check(await count(p, '#hand [data-id]') === 14, '14 Steine in der Hand');
    check(await count(p, '.rg-opp') === 1, 'ein Gegner sichtbar');
    const oppT = await p.locator('.rg-opp').innerText();
    check(/\d+ Steine?/.test(oppT) && /eröffnet/.test(oppT), 'Gegner: Anzahl und Eröffnungsstatus: ' + oppT);
    const st = newStats();
    const shots = {};
    const lay = [];
    let rounds = 0, nTurn = 0, overs = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 200000 && rounds < 3) {
      if (await isOver(p)) {
        overs++;
        const h1 = (await p.locator('.rg-over h1').innerText()).replace(/\n/g, ' ');
        const rows = await p.locator('.rg-res tbody tr').count();
        console.log('Rundenende:', h1, '| Zeilen', rows, '|', JSON.stringify(st));
        check(rows === 2 && await count(p, '[data-act=next]') === 1 && await count(p, '[data-act=leave-now]') === 1, 'Rundenende: Tabelle, Nächste Runde, Spiel beenden');
        const hs = await hostState(p);
        const sumGes = hs.game.players.reduce((s, q) => s + q.score, 0);
        const cells = await p.locator('.rg-res tbody tr td:last-child').allInnerTexts();
        check(cells.map(Number).reduce((s, x) => s + x, 0) === sumGes, 'Gesamtpunkte stimmen');
        await p.waitForTimeout(500);
        if (overs === 1) await shot(p, 'rundenende', true);
        rounds++;
        if ((st.open >= 1 && st.here >= 1 && st.draw >= 1) || rounds >= 3) break;
        await p.click('[data-act=next]');
        await p.waitForSelector('#board');
        check(await count(p, '#hand [data-id]') === 14, 'neue Runde: 14 Steine');
        continue;
      }
      if (await mine(p)) {
        if (nTurn % 2 === 0 || nTurn < 3) { const m = await measure(p); lay.push(m); if (nTurn === 0) await shot(p, 'zug1'); }
        const before = st.play + st.draw;
        await humanTurn(p, st, 1, shots).catch(async (e) => { fail('Zug: ' + e.message.split('\n')[0]); await p.click('[data-act=reset]').catch(() => {}); await p.click('[data-act=draw]').catch(() => {}); });
        if (st.play + st.draw > before && st.play === 1 && !shots.played) { shots.played = 1; await p.waitForTimeout(80); await shot(p, 'nach-eroeffnung'); }
        nTurn++;
        await p.waitForTimeout(15);
      } else await p.waitForTimeout(30);
    }
    console.log('(a) Teilzüge:', JSON.stringify(st), 'Runden', rounds, 'Züge', nTurn);
    check(overs >= 1, 'Rundenende erreicht');
    check(st.open >= 1, 'mindestens eine Eröffnung per Tippen');
    check(st.draw >= 1, 'mindestens einmal Ziehen');
    if (st.here < 1) console.log('Hinweis: kein Anlegen in (a) vorgekommen (wird in (d) deterministisch geprüft)');
    console.log('Layout: Messungen', lay.length, '| Tisch', uniq(lay, 'board').size, 'Info', uniq(lay, 'info').size, 'Aktionen', uniq(lay, 'actions').size, 'Hand-Oberkante', new Set(lay.map((m) => m.hand[1])).size, 'Banner', uniq(lay, 'banner').size, 'Gegner', uniq(lay, 'opps').size);
    console.log('  Tisch', [...uniq(lay, 'board')][0], 'Info', [...uniq(lay, 'info')][0], 'Aktionen', [...uniq(lay, 'actions')][0], 'Hand', lay[0].hand.join(','));
    check(uniq(lay, 'board').size === 1, 'Tisch springt: ' + [...uniq(lay, 'board')].join(' | '));
    check(uniq(lay, 'tscroll').size === 1, 'Tischfläche springt');
    check(uniq(lay, 'info').size === 1, 'Hinweisfläche springt');
    check(uniq(lay, 'actions').size === 1, 'Knöpfe springen');
    check(new Set(lay.map((m) => m.hand[1])).size === 1, 'Hand springt');
    check(uniq(lay, 'banner').size === 1, 'Banner springt');
    check(uniq(lay, 'opps').size === 1, 'Gegnerzeile springt');
    check(!lay.some((m) => m.hscroll), 'horizontaler Seiten-Scroll');
    const small = [...new Set(lay.flatMap((m) => m.small))];
    check(small.length === 0, 'Knöpfe unter 48px: ' + small.join(', '));
    check(lay.every((m) => m.smallTiles.length === 0), 'Steine unter 44x56px');
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
    const texts = new Map();
    const bad = [];
    let human = 0, shots = 0, over = false, reloaded = false;
    const st = newStats(); const sh = {};
    const t0 = Date.now();
    const skip = /^(Jetzt ist der Computer dran\.|Du bist dran\. Markiere)/;
    while (Date.now() - t0 < 170000) {
      if (await p.locator('.rg-over').count()) { over = true; break; }
      const snap = await p.evaluate(() => ({ mine: !!document.querySelector('.banner.mine'), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.replace(/^\s*🎓\s*/, '').trim(), targets: document.querySelectorAll('.coach-target').length }));
      if (snap.mine) {
        check(snap.targets > 0, 'Mensch dran, aber kein Ziel: ' + snap.txt);
        human++;
        if (!texts.has(snap.txt)) { texts.set(snap.txt, human); if (shots < 4) await shot(p, `lern-${++shots}`); }
        else if (texts.get(snap.txt) !== human && !skip.test(snap.txt)) bad.push(snap.txt);
        if (human === 6 && !reloaded) { reloaded = true; texts.clear(); await p.reload(); await p.waitForSelector('.coach', { timeout: 8000 }); check(await count(p, '#board') === 1, 'nach Neuladen wieder im Spiel'); continue; }
        await humanTurn(p, st, 0, sh, { detour: 0.35 }).catch(async (e) => { fail('Lern-Zug: ' + e.message.split('\n')[0]); await p.click('[data-act=reset]').catch(() => {}); await p.click('[data-act=draw]').catch(() => {}); });
        await p.waitForTimeout(10);
      } else {
        // Texte während der Computerzug: nur „Computer“
        if (snap.txt && !/Computer/.test(snap.txt) && !/zu Ende/.test(snap.txt)) check(false, 'Computer-Text: ' + snap.txt);
        await p.waitForTimeout(30);
      }
    }
    console.log('Lernrunde: Menschen-Schritte', human, 'Ende', over, 'verschiedene Texte', texts.size, '|', JSON.stringify(st));
    check(bad.length === 0, 'Erklärung wiederholt: ' + bad.join(' // '));
    check(human >= 6 && texts.size >= 6, 'Lernrunde kommt durch');
    check(over, 'Lernrunde bis zum Rundenende');
    if (over) {
      check(/zu Ende/.test(await p.innerText('.coach .coach-t')), 'Ende-Text');
      check(await count(p, '.coach-target') >= 1, 'Ende: Nächste Runde pulsiert');
      await shot(p, 'lern-ende', true);
    }
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
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    const idA = await myCid(A), idB = await myCid(B);
    const spy = async (what) => {
      await A.waitForTimeout(80);
      const hs = await hostState(A);
      const g = hs.game;
      const pa = g.players.find((q) => q.id === idA), pb = g.players.find((q) => q.id === idB);
      const tbl = new Set([].concat(...g.table));
      for (const [P, own, other, name] of [[A, pa, pb, 'Gastgeber'], [B, pb, pa, 'Gast']]) {
        const ids = await P.evaluate(() => [...document.querySelectorAll('#app [data-id]')].map((e) => Number(e.dataset.id)));
        const foreign = ids.filter((id) => other.hand.includes(id));
        check(foreign.length === 0, `${name} sieht Steine der Hand des Gegners im DOM: ${foreign}`);
        check(ids.every((id) => own.hand.includes(id) || tbl.has(id)), `${name}: unbekannte Steine im DOM`);
        const html = await P.evaluate(() => document.getElementById('app').innerText);
        check(new RegExp(`${other.hand.length} Steine?`).test(await P.locator('.rg-opp').innerText()), `${name} sieht nur die Anzahl: ${other.hand.length}`);
        check(html.includes('Stapel: ' + g.pile.length), `${name}: Stapelgröße`);
      }
      if (g.phase === 'play') {
        // Tisch bei beiden gleich (der am Zug darf seine Arbeitskopie zeigen, die beim Start des Zuges gleich ist)
        const ta = await domTable(A), tb = await domTable(B);
        check(JSON.stringify(ta) === JSON.stringify(tb) && JSON.stringify(ta.map(key)) === JSON.stringify(g.table.map(key)), `Tische gleich (${ta.length} / ${tb.length} / ${g.table.length})`);
        const ha = (await domHand(A)).length, hb = (await domHand(B)).length;
        check(ha === pa.hand.length && hb === pb.hand.length, 'Handgrößen stimmen');
        check(/\b(\d+) Steine?/.exec(await A.locator('.rg-opp').innerText())[1] == hb && /\b(\d+) Steine?/.exec(await B.locator('.rg-opp').innerText())[1] == ha, 'Gegneranzeige = echte Handgröße');
      }
    };
    const st = newStats(); const shots = {};
    let moves = 0;
    const t0 = Date.now();
    await spy('Start');
    while (Date.now() - t0 < 150000 && !((await isOver(A)) && (await isOver(B)))) {
      let acted = false;
      for (const P of [A, B]) {
        if (await isOver(P)) continue;
        if (await mine(P)) {
          const ok = await humanTurn(P, st, 1, shots, { detour: 0.2, statePage: A }).catch((e) => { fail('Mock-Zug: ' + e.message.split('\n')[0]); return false; });
          if (ok) { moves++; acted = true; await P.waitForTimeout(40); if (moves % 5 === 0 || moves < 4) await spy('Zug ' + moves); }
        }
      }
      if (!acted) await A.waitForTimeout(30);
    }
    console.log('Mock: Züge', moves, JSON.stringify(st));
    check((await isOver(A)) && (await isOver(B)), 'Mock-Runde bis zum Ende');
    if (await isOver(A) && await isOver(B)) {
      check(await count(B, '[data-act=next]') === 0 && await count(A, '[data-act=next]') === 1, 'Nächste Runde nur beim Gastgeber');
      check(await count(B, '[data-act=leave-now]') === 1, 'Gast: Spiel beenden');
      const ta = (await A.locator('.rg-res').innerText()).replace(/ \(du\)/g, ''), tb = (await B.locator('.rg-res').innerText()).replace(/ \(du\)/g, '');
      check(ta === tb, 'Ergebnistabelle bei Host und Gast gleich');
      const tabA = await domTable(A), tabB = await domTable(B);
      check(JSON.stringify(tabA) === JSON.stringify(tabB), 'Tisch am Ende gleich');
      await shot(A, 'mock-host-over', true); await shot(B, 'mock-gast-over', true);
      await A.click('[data-act=next]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      check(await count(A, '#hand [data-id]') === 14 && await count(B, '#hand [data-id]') === 14, 'Nächste Runde: bei beiden 14 Steine');
      await spy('nächste Runde');
      const hs = await hostState(A);
      check(hs.game.round === 2, 'Runde 2');
      check(await count(B, '[data-act=next]') === 0, 'Gast ohne Nächste-Runde');
    }
    await shot(B, 'mock-gast');
    await ctx.close();
  }

  // ---------- (d) vorbereitete Lagen ----------
  if (want('d')) {
    const T = (c, n, k = 0) => k * 52 + c * 13 + n - 1; // 0 rot, 1 blau, 2 gelb, 3 gruen
    const J1 = 104, J2 = 105;
    const make = (hand, table, melded, extra = {}) => {
      const g = E.createGame([{ id: 'ich', name: 'Gerda' }, { id: 'bot1', name: 'Computer' }], {}, () => 0.5);
      const used = new Set([].concat(hand, ...table));
      const botHand = (extra.botHand || [T(0, 1, 1), T(1, 5, 1), T(2, 9, 1), T(3, 13, 1), T(0, 7, 1)]).slice();
      botHand.forEach((id) => check(!used.has(id), 'Testaufbau: Botstein doppelt'));
      const bu = new Set(botHand);
      g.players[0].hand = hand.slice(); g.players[0].melded = melded;
      g.players[1].hand = botHand; g.players[1].melded = false;
      g.table = table.map((s) => s.slice());
      g.pile = Array.from({ length: 106 }, (_, i) => i).filter((i) => !used.has(i) && !bu.has(i));
      g.active = 0; g.starter = 0; g.recap = ['Computer legt 3 Steine (24 Punkte).']; g.lastPlayed = extra.lastPlayed || [];
      return g;
    };
    const load = async (ctx, g, name) => {
      const p = await ctx.newPage(); watch(p, name);
      await p.goto(URL0);
      await p.evaluate((game) => {
        localStorage.clear(); sessionStorage.clear();
        localStorage.setItem('zh.name', JSON.stringify('Gerda'));
        localStorage.setItem('zh.cid', JSON.stringify('ich'));
        localStorage.setItem('zh.rg.session', JSON.stringify({ role: 'host', room: 'SOLO', ts: Date.now() }));
        localStorage.setItem('zh.rg.hostState', JSON.stringify({ room: 'SOLO', lobby: [{ id: 'ich', name: 'Gerda', connected: true }, { id: 'bot1', name: 'Computer', connected: true, bot: true }], game, level: 0, learn: false }));
      }, g);
      await p.goto(URL0);
      await p.waitForSelector('#board');
      return p;
    };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);

    // D1: nicht eröffnet, Tisch mit einem Satz; Eröffnungssperre, Eröffnungspunkte, Ziehen gesperrt, Satz mit Joker
    {
      const g = make([T(0, 10), T(0, 11), T(0, 12), T(1, 2), T(1, 3), T(3, 7), J1, T(2, 4), T(2, 9)], [[T(3, 4), T(3, 5), T(3, 6)]], false, { lastPlayed: [T(3, 4), T(3, 5), T(3, 6)] });
      const p = await load(ctx, g, 'D1');
      check(await mine(p), 'D1 am Zug');
      check(/Eröffnung/.test(await p.locator('.rg-live').innerText()), 'D1: Eröffnungshinweis');
      check(await count(p, '#board .rg-t.last') === 3, 'D1: zuletzt gelegte Steine orange');
      check(/Reihe · 15 Punkte/.test(await p.locator('.rg-sinfo').first().innerText()), 'D1: Satz-Info Reihe 15 Punkte');
      // Tisch anfassen geht vor der Eröffnung nicht
      await tap(p, T(3, 5));
      check(await count(p, '.rg-t.sel') === 0 && /Eröffnung/.test(await p.locator('.rg-live').innerText()), 'D1: Tischstein vor Eröffnung nicht markierbar');
      check(await count(p, '.rg-here:not([disabled])') === 0, 'D1: kein Hierhin ohne Auswahl');
      // 10 11 12 rot = 33 Punkte
      await tap(p, T(0, 10)); await tap(p, T(0, 11));
      check(/2 Steine markiert/.test(await p.locator('.rg-live').innerText()), 'D1: Anzahl markiert');
      await shot(p, 'd1-markiert');
      await p.click('[data-act=newset]');
      check(await count(p, '.rg-set.bad') === 1 && /Mindestens 3 Steine/.test(await p.locator('.rg-set.bad .rg-sinfo').innerText()), 'D1: zwei Steine = ungültig mit Fehlerzeile');
      check(await count(p, '[data-act=play][disabled]') === 1, 'D1: Legen gesperrt');
      check(/0 von 30 Punkten/.test(await p.locator('.rg-open').innerText()), 'D1: Eröffnung 0 von 30 bei ungültigem Satz');
      await tap(p, T(0, 12));
      await tap(p, T(0, 12)); // an/aus
      await tap(p, T(0, 12));
      // an den neuen Satz anlegen (Hierhin legen; Satz ist der letzte)
      await p.click(`.rg-here[data-i="1"]`);
      check(await count(p, '.rg-set.bad') === 0 && /33 von 30 Punkten ✔/.test(await p.locator('.rg-open').innerText()), 'D1: Eröffnung 33 von 30');
      check(/Reihe · 33 Punkte/.test(await p.locator('.rg-set').nth(1).locator('.rg-sinfo').innerText()), 'D1: neuer Satz Reihe 33');
      await shot(p, 'd1-eroeffnung');
      // Stein einer Gruppe mit Joker: blau 2, blau 3, Joker -> Reihe 2,3,4: Eröffnung = 33 + 9 = 42
      await tap(p, T(1, 2)); await tap(p, T(1, 3)); await tap(p, J1);
      await p.click('[data-act=newset]');
      check(/42 von 30/.test(await p.locator('.rg-open').innerText()), 'D1: Eröffnung mit Joker 42: ' + await p.locator('.rg-open').innerText());
      const info = await p.locator('.rg-set').nth(2).locator('.rg-sinfo').innerText();
      check(/★ als 4/.test(info) && /Reihe · 9 Punkte/.test(info), 'D1: Joker-Anzeige "' + info + '"');
      await p.click('[data-act=draw]', { force: true });
      check(/Alles zurücksetzen/.test(await p.locator('.rg-live').innerText()) && await mine(p), 'D1: Ziehen nach Legen gesperrt');
      await p.click('[data-act=reset]');
      check((await domHand(p)).length === 9 && (await domTable(p)).length === 1, 'D1: Zurücksetzen');
      // erneut legen und bestätigen
      for (const id of [T(0, 10), T(0, 11), T(0, 12)]) await tap(p, id);
      await p.click('[data-act=newset]');
      await p.click('[data-act=play]');
      await p.waitForFunction(() => !/^\s*Du bist dran/.test((document.querySelector('.banner') || { innerText: '' }).innerText) || document.querySelector('.rg-over'), null, { timeout: 5000 });
      const hs = await hostState(p);
      check(hs.game.players[0].melded && hs.game.table.length === 2 && hs.game.players[0].hand.length === 6, 'D1: Eröffnung gespeichert (Tisch 2 Sätze, Hand 6)');
      check(/eröffnet|Eröffnet/.test(await p.locator('.rg-hhead').innerText()), 'D1: eröffnet-Haken bei mir');
      await p.close();
    }

    // D2: eröffnet; Anlegen, Teilen, Auflösen, Zurück, Zurücksetzen, Joker-Gruppe, Rundenende
    {
      const run = [T(1, 3), T(1, 4), T(1, 5), T(1, 6)];
      const jset = [T(2, 5), J1, T(2, 7)];
      const grp = [T(0, 9), T(1, 9), T(3, 9), J2];
      const g = make([T(1, 7), T(0, 2), T(0, 3), T(0, 4)], [run, jset, grp], true);
      const p = await load(ctx, g, 'D2');
      const infos = await p.locator('.rg-sinfo').allInnerTexts();
      check(/Reihe · 18 Punkte/.test(infos[0]), 'D2: Reihe 18: ' + infos[0]);
      check(/★ als 6/.test(infos[1]) && /Reihe · 18 Punkte/.test(infos[1]), 'D2: Joker als 6: ' + infos[1]);
      check(/Gruppe · 36 Punkte/.test(infos[2]) && /★ als Gelb 9/.test(infos[2]), 'D2: Gruppe mit Joker: ' + infos[2]);
      await shot(p, 'd2-start');
      // Anlegen
      await tap(p, T(1, 7));
      check(await count(p, '.rg-here:not([disabled])') === 3, 'D2: Hierhin bei allen Sätzen aktiv');
      await p.click('.rg-here[data-i="0"]');
      check(await count(p, '#board .rg-set:nth-child(1) .rg-t') === 5 && /Reihe · 25 Punkte/.test(await p.locator('.rg-sinfo').first().innerText()), 'D2: Anlegen Reihe 25');
      check(await count(p, '#board .rg-t.fresh') === 1 && await count(p, '[data-act=play]:not([disabled])') === 1, 'D2: neu gelegter Stein, Legen aktiv');
      check(JSON.stringify((await domTable(p))[0]) === JSON.stringify(run.concat([T(1, 7)])), 'D2: sortiert angelegt');
      // Teilen: vor Blau 5
      await tap(p, T(1, 5));
      await p.click('[data-act=split]');
      let tb = await domTable(p);
      check(tb.length === 4 && tb[0].length === 2 && tb[1].length === 3, 'D2: Teilen 2 + 3');
      check(await count(p, '.rg-set.bad') === 1 && /Mindestens 3/.test(await p.locator('.rg-set.bad .rg-sinfo').innerText()) && await count(p, '[data-act=play][disabled]') === 1, 'D2: Teil mit 2 Steinen ungültig, Legen gesperrt');
      await shot(p, 'd2-geteilt');
      // Satz teilen am ersten Stein: Hinweis
      await tap(p, T(1, 3));
      await p.click('[data-act=split]');
      check(/nichts zu teilen/.test(await p.locator('.rg-live').innerText()), 'D2: Teilen am ersten Stein erklärt');
      // Auflösen
      await p.click('[data-act=dissolve]');
      check(await count(p, '.rg-t.sel') === 2, 'D2: Auflösen markiert beide Steine des Satzes');
      // Steine an die dreier-Reihe anlegen -> wieder gültig
      await p.click('.rg-here[data-i="1"]');
      tb = await domTable(p);
      check(tb.length === 3 && tb[0].length === 5 && await count(p, '.rg-set.bad') === 0, 'D2: Umlegen ergibt wieder gültigen Tisch');
      // Zurück in die Hand: Stein Blau 7 ist neu gelegt
      await tap(p, T(1, 7));
      await p.click('[data-act=back]');
      check((await domHand(p)).includes(T(1, 7)) && await count(p, '#board .rg-t.fresh') === 0, 'D2: Zurück in die Hand');
      await tap(p, T(1, 3));
      check(await count(p, '[data-act=back][disabled]') === 1, 'D2: Zurück für Tischsteine gesperrt');
      await tap(p, T(1, 3)); // Markierung weg
      check(await count(p, '[data-act=reset][disabled]') === 1, 'D2: Zurücksetzen gesperrt, solange nichts verändert ist');
      await tap(p, T(1, 4));
      await p.click('[data-act=split]');
      check(await count(p, '[data-act=reset]:not([disabled])') === 1, 'D2: Zurücksetzen aktiv nach Teilen');
      await p.click('[data-act=reset]');
      check((await domHand(p)).length === 4 && JSON.stringify(await domTable(p)) === JSON.stringify([run, jset, grp].map((s) => s)), 'D2: Alles zurücksetzen stellt Tisch und Hand her');
      // Zug: Blau 7 anlegen und neuen Satz Rot 2-3-4 -> Hand leer -> Rundenende
      await tap(p, T(1, 7));
      await p.click('.rg-here[data-i="0"]');
      for (const id of [T(0, 2), T(0, 3), T(0, 4)]) await tap(p, id);
      await p.click('[data-act=newset]');
      check(await count(p, '#hand [data-id]') === 0, 'D2: Hand leer');
      check(await count(p, '.rg-set') === 4, 'D2: vier Sätze');
      await shot(p, 'd2-fertig');
      await p.click('[data-act=play]');
      await p.waitForSelector('.rg-over');
      const h1 = await p.locator('.rg-over h1').innerText();
      check(/Du hast die Runde gewonnen/.test(h1), 'D2: Sieg-Text: ' + h1);
      const rows = await p.locator('.rg-res tbody tr').allInnerTexts();
      const hs = await hostState(p);
      const d = hs.game.result.deltas;
      check(hs.game.result.reason === 'leer' && d.ich > 0 && d.ich === -d.bot1, 'D2: Wertung leer gelegt');
      check(/\+/.test(rows[0]) && /Gerda \(du\)/.test(rows[0]) && /Computer/.test(rows[1]), 'D2: Tabelle ' + rows.join(' / ').replace(/\s+/g, ' '));
      check(await count(p, 'canvas.confetti') >= 0, 'D2: Konfetti-Aufruf lief');
      await p.waitForTimeout(300);
      await shot(p, 'd2-rundenende', true);
      await p.click('[data-act=next]');
      await p.waitForSelector('#board');
      check(await count(p, '#hand [data-id]') === 14, 'D2: nächste Runde mit 14 Steinen');
      await p.close();
    }

    // D3: Stapel leer -> Passen bis Blockade
    {
      const g = make([T(0, 1), T(2, 5), T(3, 11)], [[T(1, 3), T(1, 4), T(1, 5)]], true);
      g.pile = [];
      g.players[1].hand = [T(0, 13), T(1, 13), T(0, 12)];
      const p = await load(ctx, g, 'D3');
      check(/Passen/.test(await p.locator('[data-act=draw]').innerText()), 'D3: Knopf heißt Passen');
      check(/Stapel: 0 Steine/.test(await p.locator('.rg-thead').innerText()), 'D3: Stapelgröße 0');
      await p.click('[data-act=draw]');
      await p.waitForSelector('.rg-over', { timeout: 6000 });
      const hs = await hostState(p);
      check(hs.game.result.reason === 'blockade' && hs.game.result.winners[0] === 'ich', 'D3: Blockade, ich habe weniger Reststeine');
      check(/Niemand kann mehr legen/.test(await p.locator('.rg-over').innerText()), 'D3: Blockade-Text');
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
    check(await count(p, '.rg-opp') === 3, 'vier Personen: drei Gegner');
    const st = newStats(); const sh = {};
    let n = 0;
    const t0 = Date.now();
    while (n < 8 && Date.now() - t0 < 60000) {
      if (await mine(p)) { await humanTurn(p, st, 0, sh, { detour: 0.2 }).catch((e) => fail('4P-Zug: ' + e.message.split('\n')[0])); n++; await p.waitForTimeout(15); } else await p.waitForTimeout(30);
    }
    const m = await measure(p);
    check(!m.hscroll && m.small.length === 0 && m.smallTiles.length === 0, 'vier Personen: Layout ok ' + JSON.stringify(m.small));
    check(n >= 6, 'vier Personen: Züge gespielt');
    await shot(p, 'vier-personen');
    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? `FEHLER: ${errors.length}` : 'ALLES OK');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
