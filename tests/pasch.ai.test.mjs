import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../pasch/engine.js';
import { chooseAction } from '../pasch/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Zufallsspieler: würfelt zufällig, hört zufällig auf, trägt ein zufälliges freies Feld ein.
function randomAction(g, brain) {
  const t = g.turn;
  const ap = P.activePlayer(g);
  if (t.rolls === 0) return { t: 'roll' };
  if (t.rolls >= P.MAX_ROLLS || brain() < 0.4) {
    const free = P.freeCats(ap.sheet);
    return { t: 'score', cat: free[Math.floor(brain() * free.length)] };
  }
  const keep = Array.from({ length: 5 }, () => brain() < 0.4);
  keep[0] = false;
  return { t: 'roll', keep };
}

// kinds: Array aus 0 (Leicht), 1 (Mittel), 'rand'. Gibt die Gesamtpunkte je Person zurück.
function play(kinds, seed) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = P.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })));
  let steps = 0;
  while (g.mode === 'play' && steps < 5000) {
    steps++;
    const ap = P.activePlayer(g);
    const k = kinds[g.active];
    const msg = k === 'rand' ? randomAction(g, brain) : chooseAction(g, ap.id, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = msg.t === 'roll' ? P.roll(g, ap.id, msg.keep, dice) : P.score(g, ap.id, msg.cat);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.mode, 'over', 'Partie endet');
  return g.players.map((p) => P.totalOf(p));
}

// Gewinnquote von `a` gegen `b` (Startplätze wechseln; Gleichstand zählt halb).
function winRate(a, b, N, base) {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    const pts = play(kinds, base + i);
    const mine = pts[i % 2 ? 1 : 0], theirs = pts[i % 2 ? 0 : 1];
    w += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
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

test('Durchschnittspunkte: Mittel ca. 220, Leicht ca. 125-150', () => {
  const avg = (k, base) => { let s = 0; const N = 150; for (let i = 0; i < N; i++) s += play([k], base + i)[0]; return s / N; };
  const mid = avg(1, 5000), low = avg(0, 6000);
  console.log('Durchschnitt Mittel:', mid.toFixed(1), 'Leicht:', low.toFixed(1));
  assert.ok(mid > 195 && mid < 245, 'Mittel ' + mid);
  assert.ok(low > 100 && low < 160, 'Leicht ' + low);
  assert.ok(mid - low > 60);
});

test('3er, 4er und 5er Partien (gemischt): alles gültig, alle enden', () => {
  for (let i = 0; i < 40; i++) play([1, 0, 'rand'], 7000 + i);
  for (let i = 0; i < 30; i++) play([1, 0, 1, 'rand'], 8000 + i);
  for (let i = 0; i < 10; i++) play([1, 1, 0, 0, 'rand'], 9000 + i);
  for (let i = 0; i < 20; i++) play([0, 0, 0], 9500 + i);
});

test('null, wenn nicht am Zug oder Spiel vorbei; Rechenzeit trivial', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }]);
  assert.equal(chooseAction(g, 'me', 1), null);
  assert.equal(chooseAction(g, 'me', 0), null);
  assert.deepEqual(chooseAction(g, 'bot1', 1), { t: 'roll' });
  assert.equal(chooseAction(null, 'bot1', 1), null);
  P.roll(g, 'bot1', null, seedRng(3));
  let t0 = Date.now();
  for (let i = 0; i < 20; i++) assert.ok(chooseAction(g, 'bot1', 1, seedRng(i)));
  assert.ok((Date.now() - t0) / 20 < 50, 'Mittel braucht je Zug < 50 ms');
  assert.equal(chooseAction(g, 'me', 1), null);
  g.mode = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
});

test('Mittel: nimmt gute Würfe mit (Kniffel, Große Straße) und streicht nicht leichtfertig', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }]);
  P.roll(g, 'bot1', null, seedRng(1));
  g.turn.dice = [4, 4, 4, 4, 4];
  const m = chooseAction(g, 'bot1', 1, seedRng(2));
  assert.deepEqual(m, { t: 'score', cat: 'five' });
  g.turn.dice = [2, 3, 4, 5, 6];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(2)), { t: 'score', cat: 'large' });
});
