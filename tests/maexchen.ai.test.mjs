import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../maexchen/engine.js';
import { chooseAction } from '../maexchen/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// levels: Stufe je Sitz (0 Leicht, 1 Mittel); gibt Sieger-Sitz zurück
function play(levels, seed, stats) {
  const rng = seedRng(seed * 7 + 1);
  const g = M.createGame(levels.map((_, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, rng);
  let n = 0;
  while (g.phase !== 'over' && n++ < 100000) {
    const ap = M.activePlayer(g);
    const lvl = levels[g.active];
    const t0 = performance.now();
    const msg = chooseAction(g, ap.id, lvl, rng);
    const dt = performance.now() - t0;
    if (stats) stats.maxMs = Math.max(stats.maxMs || 0, dt);
    assert.ok(msg, 'Aktion erwartet in Phase ' + g.phase);
    if (stats && lvl === 0) {
      if (g.phase === 'announce') { stats.say = (stats.say || 0) + 1; if (msg.v === g.cup) stats.truth = (stats.truth || 0) + 1; if (M.allowedSays(g).includes(g.cup)) stats.canTruth = (stats.canTruth || 0) + 1; if (msg.v === g.cup) stats.truthWhenCan = (stats.truthWhenCan || 0) + 1; }
      if (g.phase === 'decide' && g.announced !== 21) { stats.dec = (stats.dec || 0) + 1; if (msg.t === 'doubt') stats.doubt = (stats.doubt || 0) + 1; }
    }
    const r = M.handle(g, ap.id, msg, rng);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.phase, 'over');
  return g.players.findIndex((p) => p.id === g.result.winners[0]);
}

test('Beide Stufen spielen nur gültige Züge, jede Partie endet (2 bis 8 Personen), Rechenzeit < 150 ms', () => {
  const stats = {};
  for (let i = 0; i < 200; i++) {
    const n = 2 + (i % 7);
    play(Array.from({ length: n }, (_, k) => (i + k) % 2), i + 1, stats);
  }
  assert.ok(stats.maxMs < 150, 'Rechenzeit ' + stats.maxMs);
  console.log('max. Rechenzeit', stats.maxMs.toFixed(3), 'ms');
});

test('Leicht: sagt zu etwa 50 % die Wahrheit (wenn möglich) und zweifelt zu etwa 30 %', () => {
  const stats = {};
  for (let i = 0; i < 300; i++) play([0, 0, 0], i + 1, stats);
  // Wahrheit tritt auch bei der Zufallsansage manchmal zufällig auf: Rate liegt etwas über 50 %
  const truthRate = stats.truthWhenCan / stats.canTruth;
  const doubtRate = stats.doubt / stats.dec;
  console.log('Leicht Wahrheit', truthRate.toFixed(3), 'Zweifel', doubtRate.toFixed(3));
  assert.ok(truthRate > 0.48 && truthRate < 0.68, 'Wahrheitsrate ' + truthRate);
  assert.ok(doubtRate > 0.26 && doubtRate < 0.34, 'Zweifelrate ' + doubtRate);
});

function winRate(levels, midSeat, games) {
  let w = 0;
  for (let i = 0; i < games; i++) if (play(levels, 1000 + i) === midSeat) w++;
  return w / games;
}
test('Zielwerte (200 Partien): 2 Personen Mittel gegen Leicht >= 65 %, auf beiden Sitzen', () => {
  const a = winRate([1, 0], 0, 200);
  const b = winRate([0, 1], 1, 200);
  console.log('Mittel vs Leicht (Sitz 1)', a, ' (Sitz 2)', b);
  assert.ok(a >= 0.65, 'Sitz 1: ' + a);
  assert.ok(b >= 0.65, 'Sitz 2: ' + b);
});
test('Zielwerte (200 Partien): 3 Personen, 1 Mittel + 2 Leicht: Mittel gewinnt > 40 % (auf jedem Sitz)', () => {
  for (const [lv, seat] of [[[1, 0, 0], 0], [[0, 1, 0], 1], [[0, 0, 1], 2]]) {
    const r = winRate(lv, seat, 200);
    console.log('1 Mittel + 2 Leicht, Sitz', seat + 1, r);
    assert.ok(r > 0.4, `Sitz ${seat + 1}: ${r}`);
  }
});

// Der Computer darf keine verdeckten Infos nutzen: Becher anderer Personen ändern die Entscheidung nicht
test('KI schummelt nicht: verändertes verdecktes Zustandsfeld liefert dieselbe Entscheidung', () => {
  let checks = 0;
  for (let i = 0; i < 120; i++) {
    for (const level of [0, 1]) {
      const rng = seedRng(i * 5 + level + 1);
      const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }, { id: 'bot2', name: 'C' }], {}, rng);
      let n = 0;
      while (g.phase !== 'over' && n++ < 400) {
        const ap = M.activePlayer(g);
        if (g.phase === 'decide' || g.phase === 'roll') {
          // in diesen Phasen gehört der Becher einer anderen Person (bzw. es gibt keinen): beliebig verändern
          const a = JSON.parse(JSON.stringify(g));
          const b = JSON.parse(JSON.stringify(g));
          b.cup = M.ORDER[(Math.floor(rng() * 21))]; b.cupDice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
          const r1 = seedRng(i + 99); const r2 = seedRng(i + 99);
          assert.deepEqual(chooseAction(a, ap.id, level, r1), chooseAction(b, ap.id, level, r2), 'Phase ' + g.phase);
          checks++;
        }
        const msg = chooseAction(g, ap.id, level, rng);
        M.handle(g, ap.id, msg, rng);
      }
    }
  }
  assert.ok(checks > 500);
});

test('Mittel: Mäxchen-Ansage wird immer angezweifelt; Mäxchen echt gewürfelt wird angesagt; Lüge minimal höher', () => {
  const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(3));
  g.phase = 'decide'; g.active = 1; g.announcer = 0; g.announced = 21;
  for (let i = 0; i < 50; i++) assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(i + 1)), { t: 'doubt' });
  assert.deepEqual(chooseAction(g, 'bot1', 0, seedRng(1)), { t: 'doubt' });
  const h = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(3));
  h.phase = 'announce'; h.active = 0; h.cup = 21; h.cupDice = [2, 1]; h.announced = 54; h.announcer = 1;
  for (let i = 0; i < 20; i++) assert.deepEqual(chooseAction(h, 'bot0', 1, seedRng(i + 1)), { t: 'say', v: 21 });
  h.cup = 31; h.cupDice = [3, 1];
  const said = []; for (let i = 0; i < 400; i++) said.push(chooseAction(h, 'bot0', 1, seedRng(i + 1)).v);
  const minimal = said.filter((v) => v === 61).length / said.length; // 61 folgt direkt auf 54
  assert.ok(minimal > 0.85 && minimal < 0.99, 'minimal höher: ' + minimal);
  // Mittel zweifelt sehr hohe Ansagen, glaubt niedrige
  const d = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(3));
  d.phase = 'decide'; d.active = 1; d.announcer = 0;
  d.announced = 66; let doubts = 0; for (let i = 0; i < 300; i++) if (chooseAction(d, 'bot1', 1, seedRng(i + 1)).t === 'doubt') doubts++;
  assert.ok(doubts / 300 > 0.8);
  d.announced = 31; doubts = 0; for (let i = 0; i < 300; i++) if (chooseAction(d, 'bot1', 1, seedRng(i + 1)).t === 'doubt') doubts++;
  assert.ok(doubts / 300 < 0.2);
});

test('Kein Zug, wenn nicht dran oder Spiel vorbei; kaputte Eingaben werfen nicht', () => {
  const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(1));
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)), null);
  for (const j of [undefined, null, {}, { game: 'mx' }, 5]) assert.doesNotThrow(() => chooseAction(j, 'bot0', 1, seedRng(1)));
  g.phase = 'over';
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(1)), null);
});
