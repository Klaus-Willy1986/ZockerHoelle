import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../waldleben/engine.js';
import { CARDS } from '../waldleben/cards.js';
import { chooseAction } from '../waldleben/ai.js';
import { coach } from '../waldleben/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const NO_STRATEGY = /\bTipp\b|besser|beste|solltest|empfehl|klug|Strategie|Vorteil|am liebsten|lieber|lohnt/i;
const mkCtx = (id = 'me') => ({ id, ui: { sel: null, pay: [], tree: null, lsel: null, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  assert.ok(!NO_STRATEGY.test(r.text), `${where}: Strategie-Hinweis in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

// Führt aus, was ein Mensch bei Antippen des Ziels täte (spiegelt die Oberfläche in app.js)
function act(g, ctx, r, rng) {
  const u = ctx.ui; const me = g.players.find((p) => p.id === ctx.id);
  const t = r.target;
  const send = (m) => { u.sel = null; u.pay = []; u.tree = null; u.lsel = null; const x = M.handle(g, ctx.id, m, rng); assert.equal(x.ok, true, JSON.stringify(m) + x.error); };
  switch (t) {
    case '[data-act=deck]': return send({ t: 'draw', src: 'deck' });
    case '.wl-lich .wl-mini': assert.ok(g.clearing.length); u.sel = null; u.lsel = g.clearing[0]; return undefined;
    case '[data-act=take]': return send({ t: 'draw', src: 'clearing', card: u.lsel });
    case '.wl-hand .wl-card.tree': u.sel = me.hand.find((id) => CARDS[id].kind === 'tree'); assert.ok(u.sel !== undefined); return undefined;
    case '.wl-hand .wl-card.life.can': u.sel = me.hand.find((id) => CARDS[id].kind === 'life' && M.canPlayAsSelf(g, me, id)); assert.ok(u.sel !== undefined); return undefined;
    case '.wl-hand .wl-card': u.sel = me.hand[0]; return undefined;
    case '.wl-hand .wl-card:not(.sel):not(.pay)': { const id = me.hand.find((x) => x !== u.sel && !u.pay.includes(x)); assert.ok(id !== undefined); u.pay.push(id); return undefined; }
    case '[data-act=plant]': return send({ t: 'tree', card: u.sel });
    case '[data-act=sprout]': return send({ t: 'sprout', card: u.sel });
    case '.wl-ptree:not([disabled])': u.tree = me.trees.findIndex((x) => M.treeFree(x).length); assert.ok(u.tree >= 0); return undefined;
    case '[data-act=place]:not([disabled])': return send({ t: 'life', card: u.sel, pay: u.pay.slice(), tree: u.tree, side: M.treeFree(me.trees[u.tree])[0] });
    case '[data-act=cancel]': u.sel = null; u.pay = []; u.tree = null; u.lsel = null; return undefined;
    default: throw new Error('unbekanntes Ziel ' + t);
  }
}

function playLearn(seed, seq) {
  const rng = seeded(seed);
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { deck: 30, hints: true }, rng, 'me');
  const ctx = mkCtx();
  let guard = 0; let myActs = 0;
  for (;;) {
    assert.ok(guard++ < 3000, 'Endlosspiel seed ' + seed);
    const snap = JSON.stringify(g);
    const r = coach(g, ctx);
    assert.equal(JSON.stringify(g), snap, 'Coach verändert den Zustand');
    assert.ok(r, `seed ${seed}: kein Coach`);
    check(r, `seed ${seed}`);
    seq.push(r.text);
    if (g.phase === 'over') { assert.equal(r.target, '[data-act=again]'); return { turns: g.turns, myActs }; }
    const ap = M.activePlayer(g);
    if (ap.id !== 'me') {
      assert.equal(r.target, undefined, 'Beim Computer kein Ziel');
      assert.equal(M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng).ok, true);
      continue;
    }
    assert.ok(r.target, `seed ${seed}: kein Ziel in meinem Zug: ${r.text}`);
    act(g, ctx, r, rng);
    myActs++;
  }
}

test('Lernrunde: 150 Partien nur mit Coach-Zielen kommen bis zum Ende, jeder Text brav', () => {
  const all = new Map(); let turns = 0; let acts = 0;
  for (let s = 1; s <= 150; s++) {
    const seq = [];
    const r = playLearn(s, seq);
    turns += r.turns; acts += r.myActs;
    // jede Erklärung nur einmal: ein langer Text darf nur in einem zusammenhängenden Abschnitt stehen
    const seen = new Set(); let prev = null;
    for (const t of seq) {
      if (t !== prev && t.length > 70) {
        assert.ok(!seen.has(t), `seed ${s}: Erklärung wiederholt: "${t}"`);
        seen.add(t);
      }
      prev = t;
      all.set(t, (all.get(t) || 0) + 1);
    }
  }
  console.log(`# Lernrunde: Ø ${(turns / 150).toFixed(0)} Züge, Ø ${(acts / 150).toFixed(0)} Antipper, ${all.size} verschiedene Texte`);
  assert.ok(all.size >= 14, 'zu wenige Texte: ' + all.size);
  const joined = [...all.keys()].join('\n');
  for (const kw of ['Vom Stapel ziehen', 'Lichtung', 'Baum', 'Sprössling', 'bezahl', 'Passend', 'Winterkarte', 'Platz', 'Neues Spiel']) assert.ok(joined.includes(kw), 'Stichwort fehlt: ' + kw);
});

test('Lernrunde: wichtige Erklärungen kommen genau einmal pro Partie vor', () => {
  for (const s of [1, 2, 3, 4, 5, 6]) {
    const seq = []; playLearn(s, seq);
    for (const key of ['Pro Zug machst du genau eins', 'Du darfst auch eine offene Karte aus der Lichtung nehmen', 'Jeder Baum hat vier Seiten']) {
      const runs = seq.filter((t, i) => t.includes(key) && seq[i - 1] !== t).length;
      assert.ok(runs <= 1, `${key}: ${runs}x`);
    }
    assert.ok(seq.some((t) => t.includes('Pro Zug machst du genau eins')));
  }
});

test('Coach: kaputte Eingaben geben null oder gültige Antworten, werfen nie', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'C' }], { deck: 30 }, seeded(5), 'me');
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'wl' }, { game: 'wl', players: [] }, { game: 'wl', players: [{ id: 'me' }], clearing: [] }, { ...g, players: 5 }, { ...g, clearing: null }];
  for (const b of bad) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { sel: 'a', pay: 'b', tree: -5, lsel: {}, coachSeen: 7 } }, { id: 'zz', ui: {} }]) {
    let r;
    assert.doesNotThrow(() => { r = coach(b, ctx); });
    check(r, 'kaputt');
  }
  const weird = [{ sel: 999 }, { sel: -1 }, { pay: [1, 2, 3, 99] }, { tree: 7 }, { lsel: 5000 }, { sel: 0, pay: [0] }, { coachSeen: null }];
  for (const ui of weird) { const r = coach(g, { id: 'me', ui }); check(r, JSON.stringify(ui)); }
  // Zustand in der Mitte: Baum gewählt ohne Karte usw.
  const ctx = mkCtx(); ctx.ui.tree = 0; ctx.ui.pay = [1];
  check(coach(g, ctx), 'Rest-Auswahl');
});

test('Coach: Zielauswahl in jeder Lage (Zufallsstellungen) liefert ein vorhandenes Ziel', () => {
  for (let s = 1; s <= 200; s++) {
    const rng = seeded(s);
    const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'C' }], { deck: 40 }, rng, 'me');
    // zufällig weit spielen
    const steps = Math.floor(rng() * 40);
    for (let i = 0; i < steps && g.phase === 'play'; i++) {
      const ap = M.activePlayer(g);
      M.handle(g, ap.id, chooseAction(g, ap.id, i % 2, rng), rng);
    }
    if (g.phase !== 'play' || M.activePlayer(g).id !== 'me') continue;
    const ctx = mkCtx();
    // Hand-Auswahl zufällig
    const me = g.players[0];
    if (rng() < 0.5 && me.hand.length) ctx.ui.sel = me.hand[Math.floor(rng() * me.hand.length)];
    const r = coach(g, ctx);
    check(r, 'seed ' + s);
    assert.ok(r && r.target, 'kein Ziel: ' + (r && r.text));
  }
});
