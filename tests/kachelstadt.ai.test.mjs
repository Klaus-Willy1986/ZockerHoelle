import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../kachelstadt/engine.js';
import { chooseAction } from '../kachelstadt/ai.js';

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
const pick = (a, rng) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))];

function randomAction(s, rng) {
  if (s.phase === 'place') { const m = pick(E.legalPlacements(s), rng); return { t: 'place', x: m.x, y: m.y, r: m.r }; }
  const o = E.meepleOptions(s);
  return { t: 'meeple', seg: o.length && rng() < 0.5 ? pick(o, rng).seg : null };
}

// kinds: je Platz 0/1 = Computerstufe, 'r' = Zufall. Rückgabe: { scores, maxMs, totalMs, calls }
function play(kinds, seed) {
  const rng = mulberry(seed);
  const s = E.createGame(kinds.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), {}, rng);
  let steps = 0, maxMs = 0, totalMs = 0, calls = 0;
  while (s.phase !== 'over') {
    assert.ok(steps++ < 400, 'Endlosspiel');
    const k = kinds[s.active];
    const id = E.activePlayer(s).id;
    let msg;
    if (k === 'r') msg = randomAction(s, rng);
    else {
      const t0 = performance.now();
      msg = chooseAction(s, id, k, rng);
      const dt = performance.now() - t0;
      maxMs = Math.max(maxMs, dt); totalMs += dt; calls++;
    }
    assert.ok(msg, 'Computer lieferte keine Aktion');
    const r = E.handle(s, id, msg, rng);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
  }
  return { scores: s.players.map((p) => p.score), maxMs, totalMs, calls };
}
// Ergebnis für Platz i: 1 Sieg, 0.5 Gleichstand, 0 Niederlage
const res = (scores, i) => (scores[i] === Math.max(...scores) ? (scores.filter((x) => x === scores[i]).length > 1 ? 0.5 : 1) : 0);

function duel(a, b, n, seed0) {
  let pts = 0, ms = 0, calls = 0, max = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const first = i % 2 === 0;
    const r = play(first ? [a, b] : [b, a], seed0 + i);
    const ia = first ? 0 : 1;
    pts += res(r.scores, ia);
    sa += r.scores[ia]; sb += r.scores[1 - ia];
    ms += r.totalMs; calls += r.calls; max = Math.max(max, r.maxMs);
  }
  return { q: pts / n, avgMs: ms / Math.max(1, calls), max, sa: sa / n, sb: sb / n };
}

test('Mittel schlägt Leicht in mindestens 75 % der 2er-Partien', () => {
  const r = duel(1, 0, 200, 1000);
  console.log(`  Mittel gegen Leicht: ${(r.q * 100).toFixed(1)} % (Ø Punkte ${r.sa.toFixed(1)} : ${r.sb.toFixed(1)}), Rechenzeit Ø ${r.avgMs.toFixed(1)} ms, max ${r.max.toFixed(1)} ms`);
  assert.ok(r.q >= 0.75, `Quote ${r.q}`);
  assert.ok(r.avgMs < 150, `Rechenzeit ${r.avgMs}`);
});

test('Mittel schlägt Zufallsspieler in mindestens 80 % der 2er-Partien', () => {
  const r = duel(1, 'r', 200, 5000);
  console.log(`  Mittel gegen Zufall: ${(r.q * 100).toFixed(1)} % (Ø Punkte ${r.sa.toFixed(1)} : ${r.sb.toFixed(1)})`);
  assert.ok(r.q >= 0.8, `Quote ${r.q}`);
});

test('Leicht gegen Zufall (Information)', () => {
  const r = duel(0, 'r', 60, 9000);
  console.log(`  Leicht gegen Zufall: ${(r.q * 100).toFixed(1)} %`);
});

test('Partien mit 2-4 Computern und Zufall: alle Nachrichten gültig, alle Partien enden', () => {
  let games = 0;
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < 25; i++) {
      const kinds = Array.from({ length: n }, (_, j) => [1, 0, 'r', 1][(i + j) % 4]);
      const r = play(kinds, 20000 + n * 100 + i);
      assert.ok(r.scores.every((x) => x >= 0));
      games++;
    }
  }
  assert.ok(games >= 75);
});

test('Plausibilität: Punkte zweier Zufallsspieler (nur Bericht)', () => {
  let sum = 0, n = 0, inRange = 0;
  for (let i = 0; i < 50; i++) for (const x of play(['r', 'r'], 31000 + i).scores) { sum += x; n++; if (x >= 20 && x <= 70) inRange++; }
  console.log(`  Zufall gegen Zufall: Ø ${(sum / n).toFixed(1)} Punkte, ${(inRange / n * 100).toFixed(0)} % zwischen 20 und 70`);
});

test('null, wenn nicht am Zug oder Spiel vorbei; nie ungültige Nachricht', () => {
  const rng = mulberry(5);
  const s = E.createGame([{ id: 'me', name: 'A' }, { id: 'bot', name: 'C' }], {}, rng);
  assert.equal(chooseAction(s, 'bot', 1, rng), null);
  assert.equal(chooseAction(s, 'bot', 0, rng), null);
  assert.equal(chooseAction(s, 'unbekannt', 1, rng), null);
  const m = chooseAction(s, 'me', 1, rng);
  assert.equal(m.t, 'place');
  assert.equal(E.handle(s, 'me', m, rng).ok, true);
  const m2 = chooseAction(s, 'me', 1, rng);
  if (s.phase === 'meeple') assert.equal(m2.t, 'meeple');
  s.phase = 'over';
  assert.equal(chooseAction(s, 'me', 1, rng), null);
  assert.equal(chooseAction(s, 'me', 0, rng), null);
});
