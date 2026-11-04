import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../phasen/engine.js';
import { chooseAction } from '../phasen/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Zufallsspieler: würfelt zufällige Auswahl neu, trägt ein, sobald die Phase da ist.
function randomAction(g, brain) {
  const t = g.turn;
  if (t.stage === 'roll') return { t: 'roll' };
  if (t.eval.ok || t.attempt >= P.MAX_ATTEMPTS) return { t: 'finish', note: true };
  const keep = Array.from({ length: P.NUM_DICE }, () => brain() < 0.4);
  keep[0] = false;
  return { t: 'roll', keep };
}

// kinds: 0 (Leicht), 1 (Mittel), 'rand'. Gibt { g, winner (Index laut Engine-Rangliste) } zurück.
function play(kinds, seed) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = P.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })));
  let steps = 0;
  while (g.mode !== 'over' && steps < 30000) {
    steps++;
    const ap = P.activePlayer(g);
    const k = kinds[g.active];
    const msg = k === 'rand' ? randomAction(g, brain) : chooseAction(g, ap.id, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = msg.t === 'roll' ? P.roll(g, ap.id, msg.keep, dice) : P.finish(g, ap.id, msg.note);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
    if (msg.t === 'finish') assert.equal(msg.note, true, 'Computer trägt immer ein');
  }
  assert.equal(g.mode, 'over', 'Partie endet');
  const win = P.ranking(g)[0].id;
  return { g, winner: g.players.findIndex((p) => p.id === win) };
}

function winRate(a, b, N, base) {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    if (kinds[play(kinds, base + i).winner] === a) w++;
  }
  return w / N;
}

test('Mittel gegen Leicht, 2 Personen: >= 65 %', () => {
  const q = winRate(1, 0, 400, 1);
  console.log('Mittel vs Leicht:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.65, 'Quote ' + q);
});

test('Mittel gegen Zufall (2er): > 80 %', () => {
  const q = winRate(1, 'rand', 300, 1000);
  console.log('Mittel vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.8, 'Quote ' + q);
});

test('Leicht gegen Zufall: keine Fehler, Partien enden', () => {
  const q = winRate(0, 'rand', 100, 3000);
  console.log('Leicht vs Zufall:', (100 * q).toFixed(1) + ' %');
});

test('3er und 4er Partien (gemischt), Alleinspiel: alles gültig, alle enden', () => {
  for (let i = 0; i < 40; i++) play([1, 0, 'rand'], 7000 + i);
  for (let i = 0; i < 30; i++) play([1, 0, 1, 'rand'], 8000 + i);
  for (let i = 0; i < 20; i++) play([0, 0, 0], 9000 + i);
  for (let i = 0; i < 20; i++) play([1], 9500 + i);
  for (let i = 0; i < 20; i++) play([0], 9600 + i);
});

test('Mittel: würfelt nach geschaffter Phase nur nicht benötigte Würfel neu', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }]);
  const dice = seedRng(11);
  let tested = 0;
  for (let i = 0; i < 400 && tested < 20; i++) {
    const g2 = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }]);
    P.roll(g2, 'bot1', null, seedRng(100 + i));
    const t = g2.turn;
    if (!t.eval.ok) continue;
    for (let k = 0; k < 30; k++) {
      const m = chooseAction(g2, 'bot1', 1, seedRng(k));
      if (m.t === 'roll') {
        tested++;
        const used = new Set(t.eval.used.map((u) => u.i));
        used.forEach((u) => assert.equal(m.keep[u], true, 'benötigter Würfel bleibt'));
        const before = t.eval.score;
        P.roll(g2, 'bot1', m.keep, dice);
        assert.ok(g2.turn.eval.ok && g2.turn.eval.score >= before, 'Phase bleibt geschafft, Punkte sinken nicht');
        break;
      }
    }
  }
  assert.ok(tested > 0);
  void g;
});

test('Letzte Runde: erkannte Phase wird eingetragen, nie "nicht eintragen"', () => {
  let seen = 0;
  for (let s = 1; s <= 30; s++) {
    const kinds = [1, 0, 1];
    const dice = seedRng(s), brain = seedRng(s + 99);
    const g = P.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })));
    let n = 0;
    while (g.mode !== 'over' && n++ < 30000) {
      const ap = P.activePlayer(g);
      const m = chooseAction(g, ap.id, kinds[g.active], brain);
      if (g.mode === 'final' && g.turn.stage === 'choose' && g.turn.eval.ok) { assert.deepEqual(m, { t: 'finish', note: true }); seen++; }
      const r = m.t === 'roll' ? P.roll(g, ap.id, m.keep, dice) : P.finish(g, ap.id, m.note);
      assert.equal(r.ok, true);
    }
  }
  assert.ok(seen > 0, 'letzte Runde kam vor');
});

test('null, wenn nicht am Zug oder Spiel vorbei; Rechenzeit trivial', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }]);
  assert.equal(chooseAction(g, 'me', 1), null);
  assert.equal(chooseAction(g, 'me', 0), null);
  assert.deepEqual(chooseAction(g, 'bot1', 1), { t: 'roll' });
  assert.equal(chooseAction(null, 'bot1', 1), null);
  P.roll(g, 'bot1', null, seedRng(3));
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) assert.ok(chooseAction(g, 'bot1', 1, seedRng(i)));
  assert.ok((Date.now() - t0) / 50 < 20, 'Mittel braucht je Zug < 20 ms');
  assert.equal(chooseAction(g, 'me', 1), null);
  g.mode = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
});
