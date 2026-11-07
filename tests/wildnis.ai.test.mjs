import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wildnis/engine.js';
import { chooseAction } from '../wildnis/ai.js';

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

// Zufallsspieler: zufällige legale Aktion (auch Naturmarker, Marker verwerfen)
function randomAction(s, rng) {
  const me = E.activePlayer(s);
  if (s.phase === 'choose') {
    const roll = rng();
    if (roll < 0.1 && !s.usedWipe3 && ['baer', 'hirsch', 'lachs', 'falke', 'fuchs'].some((a) => s.market.tokens.filter((t) => t === a).length === 3)) return { t: 'wipe3' };
    if (roll < 0.2 && me.nature >= 1) { const ti = Math.floor(rng() * 4); return { t: 'free', ti, mi: (ti + 1 + Math.floor(rng() * 3)) % 4 }; }
    return { t: 'pick', i: Math.floor(rng() * 4) };
  }
  if (s.phase === 'tile') { const c = pick(E.legalTilePlacements(s), rng); return { t: 'tile', q: c.q, r: c.r, rot: Math.floor(rng() * 6) }; }
  const o = E.tokenOptions(s);
  return o.length && rng() < 0.5 ? { t: 'token', ...pick(o, rng) } : { t: 'token', discard: true };
}

// kinds: je Platz 0/1 = Computerstufe, 'r' = Zufall
function play(kinds, seed) {
  const rng = mulberry(seed);
  const s = E.createGame(kinds.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), {}, rng);
  let steps = 0, maxMs = 0, totalMs = 0, calls = 0, free = 0;
  while (s.phase !== 'over') {
    assert.ok(steps++ < 1500, 'Endlosspiel');
    const k = kinds[s.active];
    const id = E.activePlayer(s).id;
    let msg;
    if (k === 'r') msg = randomAction(s, rng);
    else {
      const t0 = performance.now();
      msg = chooseAction(s, id, k, rng);
      const dt = performance.now() - t0;
      maxMs = Math.max(maxMs, dt); totalMs += dt; calls++;
      if (msg && msg.t === 'free') free++;
    }
    assert.ok(msg, 'Computer lieferte keine Aktion');
    const r = E.handle(s, id, msg, rng);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
  }
  assert.equal(E.tokenBalance(s).summe, 100);
  return { scores: s.players.map((p) => E.score(s, p.id).summe), maxMs, totalMs, calls, free };
}
const res = (scores, i) => (scores[i] === Math.max(...scores) ? (scores.filter((x) => x === scores[i]).length > 1 ? 0.5 : 1) : 0);

function duel(a, b, n, seed0) {
  let pts = 0, ms = 0, calls = 0, max = 0, sa = 0, sb = 0, free = 0;
  for (let i = 0; i < n; i++) {
    const first = i % 2 === 0;
    const r = play(first ? [a, b] : [b, a], seed0 + i);
    const ia = first ? 0 : 1;
    pts += res(r.scores, ia);
    sa += r.scores[ia]; sb += r.scores[1 - ia];
    ms += r.totalMs; calls += r.calls; max = Math.max(max, r.maxMs); free += r.free;
  }
  return { q: pts / n, avgMs: ms / Math.max(1, calls), max, sa: sa / n, sb: sb / n, free: free / n };
}

test('Mittel schlägt Leicht in mindestens 85 % der 200 Zweierpartien', () => {
  const r = duel(1, 0, 200, 1000);
  console.log(`  Mittel gegen Leicht: ${(r.q * 100).toFixed(1)} % (Ø Punkte ${r.sa.toFixed(1)} : ${r.sb.toFixed(1)}), Rechenzeit Ø ${r.avgMs.toFixed(1)} ms, max ${r.max.toFixed(1)} ms, freie Wahl Ø ${r.free.toFixed(2)}/Partie`);
  assert.ok(r.q >= 0.85, `Quote ${r.q}`);
  assert.ok(r.avgMs < 150, `Rechenzeit ${r.avgMs}`);
  assert.ok(r.max < 150, `Spitzenzeit ${r.max}`);
});

test('Mittel schlägt Zufallsspieler in mindestens 95 % der 200 Zweierpartien', () => {
  const r = duel(1, 'r', 200, 5000);
  console.log(`  Mittel gegen Zufall: ${(r.q * 100).toFixed(1)} % (Ø Punkte ${r.sa.toFixed(1)} : ${r.sb.toFixed(1)}), Rechenzeit Ø ${r.avgMs.toFixed(1)} ms, max ${r.max.toFixed(1)} ms`);
  assert.ok(r.q >= 0.95, `Quote ${r.q}`);
});

test('Leicht gegen Zufall (Information)', () => {
  const r = duel(0, 'r', 60, 9000);
  console.log(`  Leicht gegen Zufall: ${(r.q * 100).toFixed(1)} % (Ø Punkte ${r.sa.toFixed(1)} : ${r.sb.toFixed(1)})`);
});

test('Partien mit 1-4 Computern/Zufall: alle Nachrichten gültig, alle Partien enden', () => {
  let games = 0;
  for (const n of [1, 2, 3, 4]) {
    for (let i = 0; i < 20; i++) {
      const kinds = Array.from({ length: n }, (_, j) => [1, 0, 'r', 1][(i + j) % 4]);
      const r = play(kinds, 20000 + n * 100 + i);
      assert.ok(r.scores.every((x) => x >= 0));
      games++;
    }
  }
  assert.equal(games, 80);
});

test('Mittel erreicht Solo deutlich mehr Punkte als Zufall (Bericht)', () => {
  let m = 0, z = 0;
  for (let i = 0; i < 30; i++) { m += play([1], 40000 + i).scores[0]; z += play(['r'], 41000 + i).scores[0]; }
  console.log(`  Solo: Mittel Ø ${(m / 30).toFixed(1)}, Zufall Ø ${(z / 30).toFixed(1)}`);
  assert.ok(m > z);
});

test('null, wenn nicht am Zug oder Spiel vorbei; Nachricht passt zur Phase', () => {
  const rng = mulberry(5);
  const s = E.createGame([{ id: 'me', name: 'A' }, { id: 'bot', name: 'C' }], {}, rng);
  assert.equal(chooseAction(s, 'bot', 1, rng), null);
  assert.equal(chooseAction(s, 'bot', 0, rng), null);
  assert.equal(chooseAction(s, 'unbekannt', 1, rng), null);
  for (const level of [0, 1]) {
    const c = JSON.parse(JSON.stringify(s));
    const m1 = chooseAction(c, 'me', level, rng);
    assert.ok(['pick', 'free', 'wipe3'].includes(m1.t));
    assert.equal(E.handle(c, 'me', m1, rng).ok, true);
    let guard = 0;
    while (c.phase === 'choose' && guard++ < 3) assert.equal(E.handle(c, 'me', chooseAction(c, 'me', level, rng), rng).ok, true);
    assert.equal(c.phase, 'tile');
    const m2 = chooseAction(c, 'me', level, rng);
    assert.equal(m2.t, 'tile');
    assert.equal(E.handle(c, 'me', m2, rng).ok, true);
    if (c.phase === 'token') {
      const m3 = chooseAction(c, 'me', level, rng);
      assert.equal(m3.t, 'token');
      assert.equal(E.handle(c, 'me', m3, rng).ok, true);
    }
    assert.equal(c.active, 1);
  }
  s.phase = 'over';
  assert.equal(chooseAction(s, 'me', 1, rng), null);
  assert.equal(chooseAction(s, 'me', 0, rng), null);
});

test('Leicht nutzt nie Naturmarker; Mittel nutzt sie nur mit Vorrat', () => {
  for (let i = 0; i < 20; i++) {
    const rng = mulberry(700 + i);
    const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
    while (s.phase !== 'over') {
      const id = E.activePlayer(s).id;
      const nat = E.activePlayer(s).nature;
      const easy = i % 2 === 0;
      const m = chooseAction(s, id, easy ? 0 : 1, rng);
      if (easy) assert.ok(!['free', 'wipe'].includes(m.t));
      if (m.t === 'free') assert.ok(nat >= 1);
      assert.equal(E.handle(s, id, m, rng).ok, true);
    }
  }
});
