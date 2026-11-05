import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../farbcode/engine.js';
import { chooseGuess, chooseAction, consistent } from '../farbcode/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Der Computer rät einen Code des Menschen; Rückgabe: Versuche (11 = nicht geknackt) und längste Rechenzeit.
function solve(code, level, rng) {
  const g = F.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  assert.ok(F.setCode(g, 'a', code).ok);
  let worst = 0;
  while (g.mode === 'guess') {
    const t0 = performance.now();
    const act = chooseAction(g, 'bot1', level, rng);
    worst = Math.max(worst, performance.now() - t0);
    assert.ok(act && act.t === 'guess', 'Aktion erwartet');
    const r = F.handle(g, 'bot1', act);
    assert.equal(r.ok, true, JSON.stringify(act) + ' ' + r.error);
  }
  return { tries: g.solved ? g.guesses.length : F.NO_SOLVE, worst, g };
}

function stats(level, seed) {
  const rng = seedRng(seed);
  const codeRng = seedRng(seed + 1000);
  let sum = 0; let max = 0; let fails = 0; let worst = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const r = solve(F.randomCode(codeRng), level, rng);
    sum += r.tries; max = Math.max(max, r.tries); worst = Math.max(worst, r.worst);
    if (r.tries === F.NO_SOLVE) fails++;
  }
  return { avg: sum / N, max, fails, worst };
}

test('Mittel löst 1000 zufällige Codes: Schnitt <= 5,5 und nie mehr als 8 Versuche', () => {
  const s = stats(1, 1);
  console.log('Mittel:', JSON.stringify(s));
  assert.ok(s.avg <= 5.5, 'Schnitt ' + s.avg);
  assert.ok(s.max <= 8, 'Maximum ' + s.max);
  assert.equal(s.fails, 0);
  assert.ok(s.worst < 50, 'Rechenzeit ' + s.worst);
});
test('Leicht: Schnitt zwischen 6 und 9 Versuchen, Rechenzeit < 50 ms', () => {
  const s = stats(0, 2);
  console.log('Leicht:', JSON.stringify(s));
  assert.ok(s.avg >= 6 && s.avg <= 9, 'Schnitt ' + s.avg);
  assert.ok(s.worst < 50, 'Rechenzeit ' + s.worst);
});
test('Mittel ist deutlich besser als Leicht (gleiche Codes)', () => {
  const a = stats(1, 5).avg; const b = stats(0, 5).avg;
  assert.ok(a + 0.8 < b, `${a} gegen ${b}`);
});
test('Mittel rät immer einen Code, der zu allen bisherigen Auswertungen passt', () => {
  const rng = seedRng(9);
  const codeRng = seedRng(19);
  for (let i = 0; i < 150; i++) {
    const code = F.randomCode(codeRng);
    const g = F.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }]);
    F.setCode(g, 'a', code);
    while (g.mode === 'guess') {
      const x = chooseGuess(g, 1, rng);
      assert.ok(F.isValidCode(x));
      for (const h of g.guesses) assert.deepEqual(F.evaluate(x, h.g), { b: h.b, w: h.w }, 'Versuch passt zu früheren Auswertungen');
      // der echte Code passt immer zu den Auswertungen
      assert.ok(consistent(g.guesses).some((c) => c.join() === code.join()));
      F.guess(g, 'bot1', x);
    }
  }
});
test('Leicht rät gelegentlich einen Code, der nicht passt (beliebiger Code)', () => {
  const rng = seedRng(4);
  const g = F.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }]);
  F.setCode(g, 'a', [1, 2, 3, 4]);
  F.guess(g, 'bot1', [0, 0, 1, 1]); F.guess(g, 'bot1', [2, 2, 3, 3]); F.guess(g, 'bot1', [4, 4, 5, 5]);
  let off = 0;
  for (let i = 0; i < 400; i++) {
    const x = chooseGuess(g, 0, rng);
    assert.ok(F.isValidCode(x));
    if (g.guesses.some((h) => { const r = F.evaluate(x, h.g); return r.b !== h.b || r.w !== h.w; })) off++;
  }
  assert.ok(off > 20, 'unpassende Versuche: ' + off);
});
test('Computer ist nur als Rateperson dran und ändert den Spielstand nicht selbst', () => {
  const g = F.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }]);
  assert.equal(chooseAction(g, 'bot1', 1), null, 'vor dem Code');
  F.setCode(g, 'a', [1, 1, 1, 1]);
  const before = JSON.stringify(g);
  assert.equal(chooseAction(g, 'a', 1), null, 'Mensch ist kein Computer');
  const act = chooseAction(g, 'bot1', 1, seedRng(1));
  assert.equal(act.t, 'guess'); assert.equal(act.n, 0);
  assert.equal(JSON.stringify(g), before);
  assert.equal(chooseAction(null, 'bot1', 1), null);
  const s = F.createGame([{ id: 'a', name: 'A' }]);
  assert.equal(chooseAction(s, 'bot1', 1), null, 'im Alleinspiel rät der Computer nie');
});
test('Mittel: erster Versuch fest, Folge-Versuche liefern nie Fehler (alle 1296 Codes, ein Lauf)', () => {
  const rng = seedRng(77);
  let worst = 0; let maxT = 0;
  for (const code of F.allCodes()) {
    const r = solve(code, 1, rng);
    worst = Math.max(worst, r.worst); maxT = Math.max(maxT, r.tries);
    assert.ok(r.tries <= 10, code.join('') + ' ' + r.tries);
  }
  console.log('Alle 1296 (Mittel): längster Zug', worst.toFixed(1), 'ms, Maximum', maxT);
  assert.ok(worst < 50);
});
