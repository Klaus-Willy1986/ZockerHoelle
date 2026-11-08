import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../mogeln/engine.js';
import { chooseAction, lieEstimate, probAtLeast } from '../mogeln/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bots = (n) => Array.from({ length: n }, (_, i) => ({ id: 'bot' + i, name: 'C' + i }));
// levels: Stufe je Sitz (0 Leicht, 1 Mittel); gibt { winner, capped, moves } zurück
function play(levels, seed, stats) {
  const rng = seedRng(seed * 7 + 1);
  const g = M.createGame(bots(levels.length), {}, rng);
  let n = 0;
  while (g.phase !== 'over' && n++ < 100000) {
    assert.equal(M.totalCards(g), 52);
    const ap = M.activePlayer(g);
    const lvl = levels[g.active];
    const t0 = performance.now();
    const msg = chooseAction(g, ap.id, lvl, rng);
    const dt = performance.now() - t0;
    if (stats) stats.maxMs = Math.max(stats.maxMs || 0, dt);
    assert.ok(msg, 'Aktion erwartet in Phase ' + g.phase);
    if (stats && lvl === 0) {
      if (g.phase === 'play') {
        const canTruth = ap.hand.some((x) => M.rankOf(x) === g.rank);
        const lie = msg.cards.some((x) => M.rankOf(x) !== g.rank);
        if (canTruth) { stats.canTruth = (stats.canTruth || 0) + 1; if (lie) stats.lieDespite = (stats.lieDespite || 0) + 1; } else { stats.mustLie = (stats.mustLie || 0) + 1; if (msg.cards.length === 1) stats.lieOne = (stats.lieOne || 0) + 1; }
      }
      if (g.phase === 'decide') { stats.dec = (stats.dec || 0) + 1; if (msg.t === 'call') stats.call = (stats.call || 0) + 1; }
    }
    const pid = g.phase === 'reveal' ? g.players[0].id : ap.id;
    const r = M.handle(g, pid, msg, rng);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.phase, 'over');
  return { winner: g.players.findIndex((p) => p.id === g.result.winner), capped: !!g.result.capped, moves: g.moves };
}

test('Beide Stufen spielen nur gültige Züge, jede Partie endet (2 bis 6 Personen), Rechenzeit < 150 ms', () => {
  const stats = {};
  let capped = 0;
  for (let i = 0; i < 200; i++) {
    const n = 2 + (i % 5);
    const r = play(Array.from({ length: n }, (_, k) => (i + k) % 2), i + 1, stats);
    if (r.capped) capped++;
  }
  assert.ok(stats.maxMs < 150, 'Rechenzeit ' + stats.maxMs);
  console.log('max. Rechenzeit', stats.maxMs.toFixed(3), 'ms; gedeckelte Runden', capped, 'von 200');
});

test('Leicht: legt wahrheitsgemäß wenn möglich, sonst eine Karte gelogen; glaubt zu etwa 70 %', () => {
  const stats = {};
  for (let i = 0; i < 200; i++) play([0, 0, 0], i + 1, stats);
  const callRate = stats.call / stats.dec;
  console.log('Leicht: Lüge trotz Wahrheit', stats.lieDespite || 0, 'von', stats.canTruth, '; Lügen mit 1 Karte', stats.lieOne, 'von', stats.mustLie, '; Mogler-Rate', callRate.toFixed(3));
  assert.equal(stats.lieDespite || 0, 0);
  assert.equal(stats.lieOne, stats.mustLie);
  assert.ok(callRate > 0.27 && callRate < 0.33, 'Mogler-Rate ' + callRate);
});

function winRate(levels, seat, games) {
  let w = 0;
  for (let i = 0; i < games; i++) if (play(levels, 1000 + i).winner === seat) w++;
  return w / games;
}
test('Zielwerte (200 Partien): 2 Personen, Mittel gegen Leicht >= 60 %, auf beiden Sitzen', () => {
  const a = winRate([1, 0], 0, 200);
  const b = winRate([0, 1], 1, 200);
  console.log('Mittel vs Leicht (Sitz 1)', a, ' (Sitz 2)', b);
  assert.ok(a >= 0.6, 'Sitz 1: ' + a);
  assert.ok(b >= 0.6, 'Sitz 2: ' + b);
});
test('Zielwerte (200 Partien): 3 Personen, 1 Mittel + 2 Leicht: Mittel gewinnt >= 50 % (auf jedem Sitz)', () => {
  for (const [lv, seat] of [[[1, 0, 0], 0], [[0, 1, 0], 1], [[0, 0, 1], 2]]) {
    const r = winRate(lv, seat, 200);
    console.log('1 Mittel + 2 Leicht, Sitz', seat + 1, r);
    assert.ok(r >= 0.5, `Sitz ${seat + 1}: ${r}`);
  }
});

// Der Computer darf keine verdeckten Infos nutzen: andere Hände, Stapelinhalt und zuletzt gelegte Karten ändern nichts
test('KI schummelt nicht: verändertes verdecktes Zustandsfeld liefert dieselbe Entscheidung', () => {
  let checks = 0;
  for (let i = 0; i < 60; i++) {
    for (const level of [0, 1]) {
      const rng = seedRng(i * 5 + level + 1);
      const g = M.createGame(bots(3), {}, rng);
      let n = 0;
      while (g.phase !== 'over' && n++ < 300) {
        const ap = M.activePlayer(g);
        if (g.phase === 'play' || g.phase === 'decide') {
          const a = JSON.parse(JSON.stringify(g));
          const b = JSON.parse(JSON.stringify(g));
          const mix = (arr) => { const x = arr.slice(); for (let k = x.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [x[k], x[j]] = [x[j], x[k]]; } return x; };
          // Stapelinhalt: gleiche Anzahl, andere Karten; zuletzt gelegte Karten: andere Karten, gleiche Anzahl
          b.pile = b.pile.map(() => Math.floor(rng() * 52));
          if (b.lastPlay) b.lastPlay.ids = b.lastPlay.ids.map(() => Math.floor(rng() * 52));
          // Hände der anderen: gleiche Anzahl, andere Karten
          b.players.forEach((p) => { if (p.id !== ap.id) p.hand = mix(p.hand).map(() => Math.floor(rng() * 52)); });
          const r1 = seedRng(i + 99); const r2 = seedRng(i + 99);
          assert.deepEqual(chooseAction(a, ap.id, level, r1), chooseAction(b, ap.id, level, r2), 'Phase ' + g.phase);
          checks++;
        }
        const pid = g.phase === 'reveal' ? g.players[0].id : ap.id;
        M.handle(g, pid, chooseAction(g, ap.id, level, rng), rng);
      }
    }
  }
  assert.ok(checks > 500, 'Prüfungen ' + checks);
});

test('Mittel: sichere Lüge und letzte Karte werden angezweifelt; gelegt wird wahr wenn möglich; Lügen sparsam', () => {
  const mkState = () => {
    const g = M.createGame(bots(3), {}, seedRng(3));
    g.players[0].hand = [M.makeCard(0, 5), M.makeCard(1, 5), M.makeCard(2, 5), M.makeCard(3, 5), M.makeCard(0, 9), M.makeCard(0, 12)];
    g.players[1].hand = Array.from({ length: 20 }, (_, i) => i);
    g.players[2].hand = Array.from({ length: 20 }, (_, i) => 20 + i);
    return g;
  };
  // bot0 hält alle vier Sechser; die Person davor behauptet, 1 Sechser gelegt zu haben -> sicher gelogen
  let g = mkState();
  g.phase = 'decide'; g.active = 0; g.announcer = 2; g.lastPlay = { pid: 'bot2', name: 'C2', count: 1, rank: 5, ids: [0] };
  assert.equal(lieEstimate(g, 'bot0'), 1);
  for (let i = 0; i < 60; i++) {
    const m = chooseAction(g, 'bot0', 1, seedRng(i + 1));
    // 10 % Zufall darf kippen
    assert.ok(m.t === 'call' || m.t === 'believe');
  }
  let calls = 0; for (let i = 0; i < 400; i++) if (chooseAction(g, 'bot0', 1, seedRng(i + 1)).t === 'call') calls++;
  assert.ok(calls / 400 > 0.85, 'sichere Lüge angezweifelt: ' + calls / 400);
  // Person hat nach dem Legen keine Karten: sicher anzweifeln
  g = mkState(); g.phase = 'decide'; g.active = 0; g.announcer = 1; g.players[1].hand = []; g.lastPlay = { pid: 'bot1', name: 'C1', count: 1, rank: 1, ids: [1] };
  assert.equal(lieEstimate(g, 'bot0'), 1);
  // Mittel legt wahrheitsgemäß, wenn möglich: alle Karten des Rangs
  g = mkState(); g.phase = 'play'; g.active = 0; g.rank = 5;
  for (let i = 0; i < 20; i++) assert.deepEqual([...chooseAction(g, 'bot0', 1, seedRng(i)).cards].sort(), [5, 18, 31, 44].sort());
  // Ohne den Rang: genau eine Karte gelogen (Hand größer als 4)
  g.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => M.makeCard(0, r)); g.rank = 12;
  const m = chooseAction(g, 'bot0', 1, seedRng(1));
  assert.equal(m.cards.length, 1); assert.ok(g.players[0].hand.includes(m.cards[0]));
  // Wahrscheinlichkeitsrechnung
  assert.ok(Math.abs(probAtLeast(10, 4, 10, 4) - 1) < 1e-12);
  assert.equal(probAtLeast(52, 4, 3, 4), 0);
  assert.ok(Math.abs(probAtLeast(52, 4, 52, 1) - 1) < 1e-12);
});

test('Kein Zug, wenn nicht dran oder Runde vorbei; kaputte Eingaben werfen nicht', () => {
  const g = M.createGame(bots(2), {}, seedRng(1));
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)), null);
  for (const j of [undefined, null, {}, { game: 'mg' }, 5, { game: 'mg', players: [{ id: 'bot0' }], phase: 'play', active: 0 }]) assert.doesNotThrow(() => chooseAction(j, 'bot0', 1, seedRng(1)));
  g.phase = 'over';
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(1)), null);
  g.phase = 'reveal';
  assert.deepEqual(chooseAction(g, 'bot0', 1, seedRng(1)), { t: 'next' });
});
