import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../bunco/engine.js';
import { chooseAction } from '../bunco/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function play(levels, seed, st) {
  const rng = seedRng(seed * 7 + 1);
  const g = M.createGame(levels.map((_, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, rng);
  let n = 0;
  while (g.phase !== 'over' && n++ < 200000) {
    if (g.phase === 'between') { assert.equal(M.handle(g, 'bot0', chooseAction(g, 'bot0', 0, rng), rng).ok, true); continue; }
    const ap = M.activePlayer(g);
    const t0 = performance.now();
    const msg = chooseAction(g, ap.id, levels[g.active], rng);
    if (st) st.maxMs = Math.max(st.maxMs || 0, performance.now() - t0);
    assert.deepEqual(msg, { t: 'roll' });
    // Nicht-aktive Personen bekommen nichts
    for (const p of g.players) if (p.id !== ap.id) assert.equal(chooseAction(g, p.id, 0, rng), null);
    assert.equal(M.handle(g, ap.id, msg, rng).ok, true);
  }
  assert.equal(g.phase, 'over');
  return g;
}

test('Computer: Ablauf endet immer (alle Stufen, 2 bis 8 Personen)', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const n = 2 + (seed % 7);
    play(Array.from({ length: n }, (_, i) => (seed + i) % 2), seed);
  }
});

test('Computer: Leicht und Mittel haben gleiche Gewinnchancen (Abweichung unter 8 Prozent)', () => {
  const N = 2000; let wins = 0; let shares = 0; const st = {};
  for (let seed = 1; seed <= N; seed++) {
    const g = play([0, 1], seed, st);
    if (g.result.winners.includes('bot0')) { wins++; shares += 1 / g.result.winners.length; }
  }
  const p = shares / N; // Anteil Leicht
  console.log('Leicht gewinnt (Anteil, Ties geteilt):', p.toFixed(3), 'max Rechenzeit ms', st.maxMs.toFixed(3));
  assert.ok(Math.abs(p - 0.5) < 0.08, 'Anteil ' + p);
  assert.ok(st.maxMs < 150);
});

test('Computer: kaputte Eingaben', () => {
  assert.equal(chooseAction(null, 'b', 0, Math.random), null);
  assert.equal(chooseAction({}, 'b', 0, Math.random), null);
  assert.equal(chooseAction({ game: 'bc', players: 5 }, 'b', 0, Math.random), null);
  const g = M.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, Math.random);
  assert.equal(chooseAction(g, 'b', 0, Math.random), null);
  assert.deepEqual(chooseAction(g, 'a', 5, Math.random), { t: 'roll' });
});
