import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../bunco/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mk = (n = 3) => M.createGame(players(n), {}, seeded(1));
// Rng, der genau die gewünschten drei Würfel liefert
const dice = (a, b, c) => { const q = [a, b, c].map((v) => (v - 0.5) / 6); let i = 0; return () => q[i++ % 3]; };
const rollAs = (g, a, b, c) => { const r = M.handle(g, M.activePlayer(g).id, { t: 'roll' }, dice(a, b, c)); assert.equal(r.ok, true, r.error); return r; };
const nextR = (g) => { const r = M.handle(g, 'p0', { t: 'next' }); assert.equal(r.ok, true, r.error); };

// Unabhängige Referenz: Punkte eines Wurfs
function ref(d, t) {
  const same = d[0] === d[1] && d[1] === d[2];
  if (same && d[0] === t) return 21;
  if (same) return 5;
  return d.filter((x) => x === t).length;
}

test('Punktezählung: alle 216 Würfe x 6 Zielzahlen gegen die Referenz', () => {
  let n = 0;
  for (let t = 1; t <= 6; t++) for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    const s = M.scoreRoll([a, b, c], t);
    assert.equal(s.points, ref([a, b, c], t), `${a}${b}${c} Ziel ${t}`);
    assert.equal(s.bunco, a === b && b === c && a === t);
    assert.equal(s.mini, a === b && b === c && a !== t);
    assert.equal(s.hits, [a, b, c].filter((x) => x === t).length);
    n++;
  }
  assert.equal(n, 1296);
});

test('Grundzustand, Anfangsregeln, Optionen', () => {
  const g = mk(3);
  assert.equal(g.phase, 'roll'); assert.equal(g.round, 1); assert.equal(g.target, 1); assert.equal(g.solo, false);
  assert.ok(g.players.every((p) => p.pts === 0 && p.total === 0 && p.wins === 0));
  assert.throws(() => M.createGame([], {}, seeded(1)));
  assert.throws(() => M.createGame(players(9), {}, seeded(1)));
  assert.equal(M.createGame(players(1), {}, seeded(1)).solo, true);
  assert.equal(M.createGame(players(8), {}, seeded(1)).players.length, 8);
});

test('Wurf: Treffer geben Punkte und die Reihe bleibt, ohne Treffer kommt die nächste Person', () => {
  const g = mk(3);
  rollAs(g, 1, 4, 5); // Ziel 1: ein Treffer
  assert.equal(g.players[0].pts, 1); assert.equal(g.active, 0);
  rollAs(g, 1, 1, 6);
  assert.equal(g.players[0].pts, 3); assert.equal(g.active, 0);
  rollAs(g, 2, 3, 4); // kein Treffer
  assert.equal(g.players[0].pts, 3); assert.equal(g.active, 1);
  assert.match(g.last.text, /Kein Treffer, weiter zur nächsten Person/);
  rollAs(g, 6, 6, 6); // Mini-Bunco
  assert.equal(g.players[1].pts, 5); assert.equal(g.active, 1); assert.equal(g.last.mini, true);
  assert.match(g.last.text, /Mini-Bunco, drei Sechser, 5 Punkte/);
});

test('Bunco beendet die Runde sofort, Rundensieg und Zielzahl der nächsten Runde', () => {
  const g = mk(3);
  rollAs(g, 1, 2, 3); // P0 1 Punkt
  rollAs(g, 4, 4, 4); // P0 Mini-Bunco 5 -> 6
  rollAs(g, 5, 5, 6); // kein Treffer
  assert.equal(g.active, 1);
  rollAs(g, 1, 1, 1); // P1 Bunco
  assert.equal(g.last.bunco, true); assert.match(g.last.text, /Bunco! 21 Punkte!/);
  assert.equal(g.phase, 'between');
  assert.equal(g.players[1].pts, 21); assert.equal(g.players[1].wins, 1); assert.equal(g.players[0].wins, 0);
  assert.deepEqual(g.history[0].winners, ['p1']);
  assert.equal(M.handle(g, 'p1', { t: 'roll' }, Math.random).ok, false);
  nextR(g);
  assert.equal(g.phase, 'roll'); assert.equal(g.round, 2); assert.equal(g.target, 2);
  assert.ok(g.players.every((p) => p.pts === 0)); assert.equal(g.players[1].total, 21);
  assert.equal(g.active, 1); // Runde 2 beginnt P1
  assert.equal(g.dice, null);
});

test('Rundenende bei 21 Punkten durch Sammeln (auch Überschreiten), Reihe bricht ab', () => {
  const g = mk(2);
  // P0 sammelt: 5 + 5 + 5 + 5 = 20, dann ein Treffer = 21
  for (let i = 0; i < 4; i++) rollAs(g, 3, 3, 3);
  assert.equal(g.players[0].pts, 20); assert.equal(g.phase, 'roll');
  rollAs(g, 1, 2, 3);
  assert.equal(g.phase, 'between'); assert.equal(g.history[0].why, 'goal');
  // Überschreiten
  const h = mk(2);
  for (let i = 0; i < 4; i++) rollAs(h, 3, 3, 3);
  rollAs(h, 4, 4, 4); // 25
  assert.equal(h.players[0].pts, 25); assert.equal(h.phase, 'between');
  assert.deepEqual(h.history[0].winners, ['p0']);
});

test('Gleichstand: alle Gleichen bekommen den Rundensieg; niemand punktet -> kein Sieg (Notbremse)', () => {
  const g = mk(2);
  // P0 21 (Bunco) wäre allein; Gleichstand nur über andere Wege: P0 und P1 je 21 geht nicht -> direkt testen über endRound-Effekt
  g.players[0].pts = 7; g.players[1].pts = 7; g.players[0].total = 7; g.players[1].total = 7;
  g.active = 0;
  // P0 würfelt 14 Punkte dazu nicht möglich; erzwinge: P1 hat 16, P0 hat 16 und macht 5 -> 21 (P0 beendet, P1 16 < 21)
  g.players[0].pts = 16; g.players[1].pts = 21;
  rollAs(g, 6, 6, 6); // P0 -> 21, P1 steht schon bei 21 (Testaufbau): beide gleich
  assert.equal(g.phase, 'between');
  assert.deepEqual(g.history[0].winners.sort(), ['p0', 'p1']);
  assert.equal(g.players[0].wins, 1); assert.equal(g.players[1].wins, 1);
  assert.match(M.roundText(g.history[0], g, 'p0'), /dir und P1 mit 21 Punkten/);
});

test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = mk(3);
  const s = JSON.stringify(g);
  const bad = [
    M.handle(g, 'p1', { t: 'roll' }),
    M.handle(g, 'fremd', { t: 'roll' }),
    M.handle(g, 'p0', { t: 'next' }),
    M.handle(g, 'p0', { t: 'unsinn' }),
    M.handle(g, 'p0', null),
    M.handle(g, 'p0', {}),
    M.handle(g, 'p0', { t: 5 }),
    M.handle(null, 'p0', { t: 'roll' }),
    M.handle({ game: 'x' }, 'p0', { t: 'roll' }),
  ];
  for (const r of bad) assert.equal(r.ok, false);
  assert.equal(JSON.stringify(g), s);
});

test('Spielende nach 6 Runden: Sieger nach Rundensiegen, dann Gesamtpunkten', () => {
  const g = mk(2);
  for (let r = 1; r <= 6; r++) {
    // P0 beginnt in ungeraden Runden, P1 in geraden; wer beginnt, würfelt Bunco
    const t = g.target;
    rollAs(g, t, t, t);
    if (r < 6) nextR(g);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].wins, 3); assert.equal(g.players[1].wins, 3);
  assert.equal(g.players[0].total, 63); assert.equal(g.players[1].total, 63);
  assert.deepEqual(g.result.winners.sort(), ['p0', 'p1']); // komplett gleich: geteilt
  const rk = M.ranking(g);
  assert.ok(rk.every((x) => x.place === 1));
  assert.equal(M.handle(g, 'p0', { t: 'roll' }).ok, false);

  // P0 4 Siege, P1 2 Siege, aber P1 mehr Punkte -> P0 gewinnt
  const h = mk(2);
  h.players[0].wins = 3; h.players[1].wins = 2; h.players[0].total = 50; h.players[1].total = 90;
  h.round = 6; h.target = 6; h.active = 1; // P1 beginnt Runde 6? ((6-1)%2 = 1)
  rollAs(h, 6, 6, 6); // P1 gewinnt Runde 6
  assert.equal(h.phase, 'over');
  assert.equal(h.players[1].wins, 3); assert.equal(h.players[0].wins, 3);
  assert.deepEqual(h.result.winners, ['p1']); // Gleichstand bei Siegen, mehr Punkte
  const h2 = mk(2);
  h2.players[0].wins = 3; h2.players[1].wins = 1; h2.players[0].total = 30; h2.players[1].total = 200;
  h2.round = 6; h2.target = 6; h2.active = 1;
  rollAs(h2, 6, 6, 6);
  assert.deepEqual(h2.result.winners, ['p0']);
  assert.deepEqual(M.ranking(h2).map((x) => x.id), ['p0', 'p1']);
});

test('Alleinspiel: 10 Würfelreihen je Runde, Runde endet auch bei 21, Gesamtpunkte', () => {
  const g = mk(1);
  assert.equal(g.solo, true);
  // Reihe 1: 2 Treffer, dann kein Treffer
  rollAs(g, 1, 1, 2); assert.equal(g.turn, 0); assert.equal(g.active, 0);
  rollAs(g, 2, 3, 4); assert.equal(g.turn, 1); assert.equal(g.active, 0);
  assert.match(g.last.text, /die Reihe ist zu Ende/);
  for (let i = 0; i < 8; i++) { assert.equal(g.phase, 'roll'); rollAs(g, 2, 3, 4); }
  assert.equal(g.turn, 9);
  rollAs(g, 1, 5, 6); assert.equal(g.phase, 'roll'); assert.equal(g.players[0].pts, 3); // Treffer: Reihe 10 läuft weiter
  rollAs(g, 2, 3, 4);
  assert.equal(g.phase, 'between'); // 10. Reihe beendet
  assert.equal(g.history[0].scores[0], 3);
  assert.equal(g.players[0].wins, 0); assert.deepEqual(g.history[0].winners, []);
  assert.match(M.roundText(g.history[0], g, 'p0'), /3 Punkte/);
  nextR(g);
  assert.equal(g.round, 2); assert.equal(g.turn, 0); assert.equal(g.players[0].pts, 0); assert.equal(g.players[0].total, 3);
  rollAs(g, 2, 2, 2); // Bunco in Runde 2
  assert.equal(g.phase, 'between'); assert.equal(g.players[0].total, 24);
  for (let r = 3; r <= 6; r++) { nextR(g); rollAs(g, r, r, r); }
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].total, 3 + 21 * 5);
  assert.equal(g.result.total, 108); assert.deepEqual(g.result.winners, ['p0']);
});

test('JSON-Sicherheit', () => {
  const g = mk(4);
  rollAs(g, 1, 1, 3); rollAs(g, 2, 5, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('300 Zufallspartien enden immer, Bilanz stimmt (Punkte, Siege, Würfe)', () => {
  let solo = 0; let multi = 0; let ties = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed * 13 + 7);
    const n = 1 + (seed % 8);
    const g = M.createGame(players(n), {}, rng);
    let sumPts = 0; let steps = 0; const refTotals = Array(n).fill(0); let rounds = 0;
    while (g.phase !== 'over' && steps++ < 200000) {
      if (g.phase === 'between') {
        // Bilanz je Runde
        const h = g.history[g.history.length - 1];
        assert.equal(h.round, g.round);
        const best = Math.max(...h.scores);
        if (!g.solo) assert.deepEqual(h.winners, g.players.filter((p) => p.pts === best).map((p) => p.id));
        if (!g.solo) assert.ok(best >= 21 || h.why === 'end');
        rounds++;
        assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, true);
        continue;
      }
      const ap = M.activePlayer(g);
      const ai = g.active; const before = g.players[ai].pts; const round = g.round; const target = g.target;
      const r = M.handle(g, ap.id, { t: 'roll' }, rng);
      assert.equal(r.ok, true);
      const gain = ref(g.last.dice, target);
      assert.equal(g.last.points, gain);
      sumPts += gain; refTotals[ai] += gain;
      if (g.phase === 'roll' && !g.solo) assert.ok(g.players[ai].pts < 21 && g.players[ai].pts === before + gain);
      assert.equal(g.round, round);
      assert.ok(g.target === g.round);
    }
    assert.equal(g.phase, 'over', 'Seed ' + seed);
    rounds++;
    assert.equal(g.history.length, 6); assert.equal(rounds, 6);
    assert.equal(g.players.reduce((a, p) => a + p.total, 0), sumPts);
    g.players.forEach((p, i) => assert.equal(p.total, refTotals[i]));
    assert.equal(g.players.reduce((a, p) => a + p.wins, 0), g.history.reduce((a, h) => a + h.winners.length, 0));
    // Sieger laut Regel
    const mw = Math.max(...g.players.map((p) => p.wins));
    const cand = g.players.filter((p) => p.wins === mw);
    const mt = Math.max(...cand.map((p) => p.total));
    const exp = cand.filter((p) => p.total === mt).map((p) => p.id).sort();
    assert.deepEqual([...g.result.winners].sort(), exp);
    if (exp.length > 1) ties++;
    if (g.solo) solo++; else multi++;
    JSON.parse(JSON.stringify(g));
  }
  assert.ok(solo > 20 && multi > 200);
  console.log('Partien: Solo', solo, 'Mehrpersonen', multi, 'geteilter Sieg', ties);
});
