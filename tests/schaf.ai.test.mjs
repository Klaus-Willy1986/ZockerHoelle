import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schaf/engine.js';
import { chooseAction, MISS_CHANCE } from '../schaf/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// levels: Stufe je Sitz (0 Leicht, 1 Mittel). Gibt Statistik zurück.
function play(levels, seed) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(levels.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, deal);
  const st = { steps: 0, ends: 0, penalties: 0, penaltiesByLevel: [0, 0], places: 0, steals: 0, flips: 0 };
  while (g.phase === 'play' && st.steps < 20000) {
    st.steps++;
    const ap = M.activePlayer(g);
    const lvl = levels[g.active];
    const msg = chooseAction(g, ap.id, lvl, brain);
    assert.ok(msg, 'Aktion erwartet');
    const before = g.penalty.length + Object.values(g.penaltyExtra).reduce((a, b) => a + b, 0);
    const r = M.handle(g, ap.id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
    if (msg.t === 'end') st.ends++;
    if (msg.t === 'flip') st.flips++;
    if (msg.t === 'place') { st.places++; if (msg.from !== ap.id) st.steals++; }
    const after = g.penalty.length + Object.values(g.penaltyExtra).reduce((a, b) => a + b, 0);
    if (g.last && g.last.penalty && g.last.seq === g.moves && after !== before) { st.penalties++; st.penaltiesByLevel[lvl]++; }
  }
  assert.equal(g.phase, 'over', 'Spiel endet');
  st.g = g;
  return st;
}

test('Beide Stufen spielen nur gültige Züge und jede Partie endet (2 bis 6 Personen)', () => {
  for (let i = 0; i < 200; i++) {
    const n = 2 + (i % 5);
    const levels = Array.from({ length: n }, (_, k) => (i + k) % 2);
    const st = play(levels, i + 1);
    assert.ok(st.steps < 20000);
    assert.equal(st.g.players.reduce((s, p) => s + p.deck.length + p.pile.length, 0) + st.g.penalty.length + st.g.rows.reduce((s, r) => s + (r ? r.hi - r.lo + 1 : 0), 0), 84);
  }
});

test('Mittel übersieht nie etwas: keine Strafen, nie freiwilliges Beenden; Leicht verpasst manchmal', () => {
  let midPen = 0, lightPen = 0, midEnds = 0, lightEnds = 0, lightSeats = 0, midSeats = 0, steals = 0;
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 3);
    const mid = play(Array(n).fill(1), 1000 + i);
    midPen += mid.penalties; midEnds += mid.ends; midSeats += n; steals += mid.steals;
    const light = play(Array(n).fill(0), 2000 + i);
    lightPen += light.penalties; lightEnds += light.ends; lightSeats += n;
  }
  console.log('Mittel: Strafen', midPen, 'Beenden', midEnds, '| Leicht: Strafen', lightPen, 'Beenden', lightEnds, '| fremde Karten gelegt (Mittel)', steals);
  assert.equal(midPen, 0);
  assert.equal(midEnds, 0);
  assert.ok(steals > 0, 'Mittel legt auch fremde Karten an');
  assert.ok(lightPen > 0, 'Leicht übersieht manchmal');
  assert.ok(lightEnds > 0);
});

test('Entscheidung im Einzelfall: Mittel legt an, Leicht übersieht bei kleinem rng, sonst gleich', () => {
  const C = (s, r) => ({ s, r });
  const g = M.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, () => 0.3);
  g.rows[0] = { lo: 11, hi: 11 };
  g.players[0].pile = [C(0, 12)];
  g.players[1].pile = [C(0, 10)];
  g.players[0].deck = [C(1, 3)]; g.players[1].deck = [C(1, 4)];
  g.active = 0;
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'place', from: 'a' });
  assert.deepEqual(chooseAction(g, 'a', 0, () => 0.9), { t: 'place', from: 'a' });
  assert.deepEqual(chooseAction(g, 'a', 0, () => MISS_CHANCE / 2), { t: 'end' });
  // fremde Karte: Mittel legt sie, Leicht verpasst und deckt stattdessen auf
  g.players[0].pile = [];
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'place', from: 'b' });
  assert.deepEqual(chooseAction(g, 'a', 0, () => 0), { t: 'flip' });
  // nichts passt: aufdecken
  g.players[1].pile = [C(2, 2)];
  assert.deepEqual(chooseAction(g, 'a', 0, () => 0), { t: 'flip' });
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'flip' });
});

test('Falsche Eingaben: null, wenn man nicht dran ist, Spiel vorbei oder Zustand kaputt', () => {
  const g = M.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, seedRng(3));
  const other = g.players[(g.active + 1) % 2].id;
  assert.equal(chooseAction(g, other, 1, seedRng(1)), null);
  assert.equal(chooseAction(null, 'a'), null);
  assert.equal(chooseAction({ game: 'mm' }, 'a'), null);
  g.phase = 'over';
  assert.equal(chooseAction(g, g.players[g.active].id, 1, seedRng(1)), null);
});

test('Normales Ende kommt vor (Spielende durch leere Karten) oder Blockade: beides gültig', () => {
  let normal = 0, blocked = 0;
  for (let i = 0; i < 100; i++) { const st = play([1, 1], 5000 + i); if (st.g.result.blocked) blocked++; else normal++; }
  console.log('2 Mittel: reguläres Ende', normal, 'Blockade', blocked);
  assert.equal(normal + blocked, 100);
});
