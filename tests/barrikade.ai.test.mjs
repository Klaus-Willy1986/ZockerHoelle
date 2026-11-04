import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../barrikade/engine.js';
import { chooseAction } from '../barrikade/ai.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const LIMIT = 10000; // Absicherung gegen Endlosspiele (Nachrichten)

// Zufallsspieler: würfelt, zieht und setzt völlig zufällig
function randomAction(s, rng) {
  if (s.phase === 'roll') return { t: 'roll' };
  if (s.phase === 'move') { const m = E.legalMoves(s); const x = m[Math.floor(rng() * m.length)]; return { t: 'move', piece: x.piece, to: x.to }; }
  const t = E.placeTargets(s);
  return { t: 'place', node: t[Math.floor(rng() * t.length)] };
}
function apply(s, pid, msg, rng) {
  if (msg.t === 'roll') return E.roll(s, pid, rng);
  if (msg.t === 'move') return E.move(s, pid, msg.piece, msg.to);
  return E.place(s, pid, msg.node);
}

// kinds: Array je Platz: 0/1 = Computerstufe, 'r' = Zufall. Rückgabe: { winner: Platz | -1 (Limit), steps, maxMs }
function play(kinds, seed) {
  const rng = mulberry(seed);
  const s = E.createGame(kinds.map((_, i) => ({ id: 'bot' + (i + 1), name: 'P' + i })));
  let steps = 0;
  let maxMs = 0;
  while (s.phase !== 'over' && steps < LIMIT) {
    const ap = E.activePlayer(s);
    const k = kinds[s.active];
    let msg;
    if (k === 'r') msg = randomAction(s, rng);
    else {
      const t0 = performance.now();
      msg = chooseAction(s, ap.id, k, rng);
      maxMs = Math.max(maxMs, performance.now() - t0);
    }
    assert.ok(msg, 'Computer lieferte keine Aktion in Phase ' + s.phase);
    const r = apply(s, ap.id, msg, rng);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
    steps++;
  }
  return { winner: s.phase === 'over' ? s.players.findIndex((p) => p.id === s.winner) : -1, steps, maxMs };
}

test('Partien: alle Nachrichten gültig, fast alle Partien enden (2/3/4 Personen)', () => {
  let games = 0, limit = 0, maxMs = 0;
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < 110; i++) {
      const kinds = Array.from({ length: n }, (_, j) => ((i + j) % 3 === 0 ? 'r' : (i + j) % 3 === 1 ? 0 : 1));
      const r = play(kinds, 1000 * n + i);
      games++; if (r.winner < 0) limit++; maxMs = Math.max(maxMs, r.maxMs);
    }
  }
  console.log(`  ${games} Partien, Limit erreicht: ${limit}, max. Rechenzeit ${maxMs.toFixed(1)} ms`);
  assert.ok(games >= 300);
  assert.ok(limit / games < 0.02, `zu viele Partien am Limit: ${limit}`);
  assert.ok(maxMs < 100, `Rechenzeit ${maxMs}`);
});

test('Mittel schlägt Leicht in mindestens 60 % der 2er-Partien (Startplatz wechselt)', () => {
  let wins = 0, played = 0, limit = 0;
  for (let i = 0; i < 300; i++) {
    const mid = i % 2;
    const kinds = mid === 0 ? [1, 0] : [0, 1];
    const r = play(kinds, 50000 + i);
    if (r.winner < 0) { limit++; continue; }
    played++; if (r.winner === mid) wins++;
  }
  const q = wins / played;
  console.log(`  Mittel gegen Leicht: ${(q * 100).toFixed(1)} % (${wins}/${played}), Limit ${limit}`);
  assert.ok(q >= 0.6, `Quote ${q}`);
});

test('Mittel schlägt Zufallsspieler in mehr als 70 % der Partien', () => {
  let wins = 0, played = 0;
  for (let i = 0; i < 300; i++) {
    const mid = i % 2;
    const r = play(mid === 0 ? [1, 'r'] : ['r', 1], 90000 + i);
    if (r.winner < 0) continue;
    played++; if (r.winner === mid) wins++;
  }
  const q = wins / played;
  console.log(`  Mittel gegen Zufall: ${(q * 100).toFixed(1)} % (${wins}/${played})`);
  assert.ok(q > 0.7, `Quote ${q}`);
});

test('Leicht gegen Zufall (Information)', () => {
  let wins = 0, played = 0;
  for (let i = 0; i < 100; i++) {
    const r = play(i % 2 ? ['r', 0] : [0, 'r'], 7000 + i);
    if (r.winner < 0) continue;
    played++; if (r.winner === (i % 2 ? 1 : 0)) wins++;
  }
  console.log(`  Leicht gegen Zufall: ${(wins / played * 100).toFixed(1)} %`);
});

test('null, wenn nicht am Zug oder Spiel vorbei; Rechenzeit', () => {
  const rng = mulberry(5);
  const s = E.createGame([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  assert.equal(chooseAction(s, 'bot1', 1, rng), null);
  assert.equal(chooseAction(s, 'bot1', 0, rng), null);
  assert.deepEqual(chooseAction(s, 'me', 1, rng), { t: 'roll' });
  s.phase = 'over'; s.winner = 'me';
  assert.equal(chooseAction(s, 'me', 1, rng), null);
  const g = E.createGame([{ id: 'bot1', name: 'C' }, { id: 'p', name: 'A' }]);
  g.phase = 'move'; g.die = 6;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) chooseAction(g, 'bot1', 1, rng);
  assert.ok((performance.now() - t0) / 20 < 100);
});

test('Sperre aufgenommen -> nächster Schritt ist place auf erlaubtes Feld', () => {
  for (const level of [0, 1]) {
    const s = E.createGame([{ id: 'bot1', name: 'C' }, { id: 'p', name: 'A' }]);
    s.pieces.find((p) => p.id === 'R0').pos = '11_0'; // eine Stufe unter Sperre 10_0
    s.phase = 'move'; s.die = 1;
    const rng = mulberry(3);
    const m = E.legalMoves(s).filter((x) => x.to === '10_0');
    assert.ok(m.length);
    assert.ok(E.move(s, 'bot1', 'R0', '10_0').place);
    const a = chooseAction(s, 'bot1', level, rng);
    assert.equal(a.t, 'place');
    assert.ok(E.placeTargets(s).includes(a.node));
    assert.equal(E.place(s, 'bot1', a.node).ok, true);
  }
});
