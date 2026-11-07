import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schaf/engine.js';
import { chooseAction, MISTAKE_CHANCE } from '../schaf/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const C = (s, r) => ({ s, r });

// Ob an dieser Stelle überhaupt ein Fehler möglich wäre (a, b oder c)
function mistakePossible(g) {
  const ap = M.activePlayer(g);
  if (g.source === null) return false;
  const tg = M.targetsFor(g, M.curCard(g), ap.id);
  return (g.source === 'open' && ap.deck.length > 0) || (g.source === 'flipped' && (tg.center || tg.others.length > 0)) || (tg.center && tg.others.length > 0);
}

// levels: Stufe je Sitz (0 Leicht, 1 Mittel)
function play(levels, seed) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(levels.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, deal);
  const st = { steps: 0, decisions: 0, possible: 0, mistakes: 0, mistakesByLevel: [0, 0], kinds: { a: 0, b: 0, c: 0 }, aufdruecken: 0 };
  while (g.phase === 'play' && st.steps < 30000) {
    st.steps++;
    const ap = M.activePlayer(g);
    const lvl = levels[g.active];
    const poss = mistakePossible(g);
    const msg = chooseAction(g, ap.id, lvl, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = M.handle(g, ap.id, msg);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
    if (lvl === 0) { st.decisions++; if (poss) st.possible++; }
    if (msg.to === 'other') st.aufdruecken++;
    if (r.schafskopp) { st.mistakes++; st.mistakesByLevel[lvl]++; st.kinds[r.schafskopp]++; }
  }
  assert.equal(g.phase, 'over', 'Spiel endet');
  st.g = g;
  return st;
}
const bal = (g) => g.players.reduce((s, p) => s + p.deck.length + p.pile.length, 0) + g.rows.reduce((s, r) => s + (r ? r.hi - r.lo + 1 : 0), 0);

test('Beide Stufen spielen nur gültige Züge und jede Partie endet (2 bis 6 Personen)', () => {
  for (let i = 0; i < 200; i++) {
    const n = 2 + (i % 5);
    const levels = Array.from({ length: n }, (_, k) => (i + k) % 2);
    const st = play(levels, i + 1);
    assert.equal(bal(st.g), 84);
  }
});

test('Mittel macht nie einen Fehler; Leicht macht ungefähr 15 % Fehler (a, b und c kommen vor)', () => {
  let midM = 0, lm = 0, lp = 0, aufd = 0; const kinds = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 3);
    const mid = play(Array(n).fill(1), 1000 + i);
    midM += mid.mistakes; aufd += mid.aufdruecken;
    const light = play(Array(n).fill(0), 2000 + i);
    lm += light.mistakes; lp += light.possible;
    for (const k of 'abc') kinds[k] += light.kinds[k];
  }
  const q = lm / lp;
  console.log('Mittel: Fehler', midM, '| Leicht: Fehler', lm, 'bei', lp, 'möglichen Gelegenheiten =', (100 * q).toFixed(1) + ' %', JSON.stringify(kinds), '| Aufdrücken (Mittel)', aufd);
  assert.equal(midM, 0);
  assert.ok(aufd > 0, 'Mittel drückt auch auf');
  assert.ok(q > 0.10 && q < 0.20, 'Quote ' + q);
  for (const k of 'abc') assert.ok(kinds[k] > 0, 'Fehlerart ' + k);
  assert.ok(MISTAKE_CHANCE === 0.15);
});

test('Entscheidung im Einzelfall: Mitte vor Mitspieler vor bei sich; Mittel drückt bei der Person mit den meisten Karten auf', () => {
  const g = M.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], {}, () => 0.3);
  g.active = 0;
  g.rows = [{ lo: 11, hi: 11 }, null, null, null];
  g.players[0].pile = []; g.players[0].deck = [C(1, 3)];
  g.players[1].pile = [C(2, 14)]; g.players[1].deck = [C(1, 1)];
  g.players[2].pile = [C(2, 16)]; g.players[2].deck = [C(1, 1), C(1, 2), C(1, 4), C(1, 5)];
  g.flipped = C(2, 15); g.source = 'flipped';
  // passt bei b (14) und c (16): Mittel wählt c (mehr Karten)
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'place', to: 'other', pid: 'c' });
  g.flipped = C(0, 12); // Mitte vor aufdrücken
  g.players[1].pile = [C(0, 13)];
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'place', to: 'center' });
  // nirgends: bei sich
  g.flipped = C(3, 9);
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'place', to: 'own' });
  assert.deepEqual(chooseAction(g, 'a', 0, () => 0.9), { t: 'place', to: 'own' });
  // Leicht mit kleinem rng: Fehler, wenn möglich; hier nichts möglich -> richtig
  assert.deepEqual(chooseAction(g, 'a', 0, () => 0), { t: 'place', to: 'own' });
  // Fehler b bei flipped mit Ziel
  g.flipped = C(0, 12);
  assert.ok(['own', 'other'].includes(chooseAction(g, 'a', 0, () => 0).to));
  // offene Oberkarte passt: Fehler a (aufdecken)
  g.flipped = null; g.source = 'open'; g.players[0].pile = [C(0, 10)];
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'place', to: 'center' });
  const bad = chooseAction(g, 'a', 0, () => 0);
  assert.ok(bad.t === 'flip' || (bad.t === 'place' && bad.to === 'other'));
  // nichts zu prüfen: aufdecken
  g.source = null; g.players[0].pile = [];
  assert.deepEqual(chooseAction(g, 'a', 1, () => 0), { t: 'flip' });
  assert.deepEqual(chooseAction(g, 'a', 0, () => 0), { t: 'flip' });
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

test('Wie oft endet eine Partie durch leere Karten statt Blockade? (100 Partien zweier Mittel-Computer, 2 bis 4 Personen)', () => {
  let normal = 0, blocked = 0;
  for (let i = 0; i < 100; i++) { const st = play(Array(2 + (i % 3)).fill(1), 5000 + i); if (st.g.result.blocked) blocked++; else normal++; }
  console.log('Mittel-Computer: reguläres Ende (leere Karten)', normal, 'Blockade', blocked);
  assert.equal(normal + blocked, 100);
});
