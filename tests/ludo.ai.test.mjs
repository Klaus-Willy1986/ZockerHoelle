import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../ludo/engine.js';
import { chooseAction } from '../ludo/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// kinds: Array aus 0 (Leicht), 1 (Mittel), 'rand' (reiner Zufall)
function play(kinds, seed) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = L.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), seedRng(seed));
  let steps = 0;
  while (g.mode === 'play' && steps < 20000) {
    steps++;
    const ap = L.activePlayer(g);
    const k = kinds[g.active];
    let msg;
    if (k === 'rand') {
      msg = g.turn.stage === 'roll' ? { t: 'roll' } : { t: 'move', piece: g.turn.movable[Math.floor(brain() * g.turn.movable.length)] };
    } else msg = chooseAction(g, ap.id, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = L.handle(g, ap.id, msg, dice);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.mode, 'over', 'Partie endet');
  return g.winner;
}

function series(kindsFor, n, label) {
  const wins = {};
  for (let i = 0; i < n; i++) {
    const kinds = kindsFor(i);
    const w = play(kinds, i + 1);
    const key = String(kinds[w]) + '@' + w;
    wins[key] = (wins[key] || 0) + 1;
  }
  return wins;
}

test('Mittel gegen Leicht, 2 Personen, ausgeglichene Plätze: >= 60 %', () => {
  const N = 400; let mid = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [0, 1] : [1, 0];
    if (kinds[play(kinds, i + 1)] === 1) mid++;
  }
  console.log('Mittel vs Leicht:', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N >= 0.6, 'Quote ' + mid / N);
});

test('Mittel gegen Zufall (2er): > 70 %', () => {
  const N = 400; let mid = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? ['rand', 1] : [1, 'rand'];
    if (kinds[play(kinds, 1000 + i)] === 1) mid++;
  }
  console.log('Mittel vs Zufall:', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N > 0.7, 'Quote ' + mid / N);
});

test('Leicht gegen Zufall: keine Fehler, Partien enden', () => {
  let leicht = 0;
  const N = 200;
  for (let i = 0; i < N; i++) { const k = i % 2 ? ['rand', 0] : [0, 'rand']; if (k[play(k, 3000 + i)] === 0) leicht++; }
  console.log('Leicht vs Zufall:', (100 * leicht / N).toFixed(1) + ' %');
});

test('3er und 4er Partien (gemischt), 300 Stück: alles gültig, alle enden', () => {
  for (let i = 0; i < 150; i++) play([1, 0, 'rand'].sort(() => 0), 5000 + i);
  for (let i = 0; i < 150; i++) play([1, 0, 1, 'rand'], 6000 + i);
  for (let i = 0; i < 40; i++) play([1, 1, 1, 1], 7000 + i);
  for (let i = 0; i < 40; i++) play([0, 0, 0], 8000 + i);
});

test('null, wenn nicht am Zug oder Spiel vorbei; Rechenzeit trivial', () => {
  const g = L.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], () => 0.3);
  assert.equal(chooseAction(g, 'me', 1), null);
  assert.deepEqual(chooseAction(g, 'bot1', 1), { t: 'roll' });
  assert.equal(chooseAction(g, 'unbekannt', 0), null);
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) chooseAction(g, 'bot1', 1);
  assert.ok(performance.now() - t0 < 200);
  g.mode = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
});
