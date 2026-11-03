import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../ludo/engine.js';

const mk = (n = 4) => L.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), () => 0.5);
const fixed = (v) => () => (v - 1) / 6 + 0.01; // würfelt immer v
const seq = (...vs) => { let i = 0; return () => (vs[i++ % vs.length] - 1) / 6 + 0.01; };
const act = (g) => L.activePlayer(g);
const setPieces = (g, i, arr) => { g.players[i].pieces = arr.slice(); };
const rollAs = (g, die) => L.roll(g, act(g).id, fixed(die));

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('Brett: 40 verschiedene Rundweg-Felder, Nachbarn grenzen aneinander, Ziel und Haus ohne Überschneidung', () => {
  const key = (c) => c.join(',');
  assert.equal(L.RING_CELLS.length, 40);
  assert.equal(new Set(L.RING_CELLS.map(key)).size, 40);
  for (let i = 0; i < 40; i++) {
    const a = L.RING_CELLS[i], b = L.RING_CELLS[(i + 1) % 40];
    assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, 'Feld ' + i);
  }
  const all = [...L.RING_CELLS, ...L.GOAL_CELLS.flat(), ...L.HOME_CELLS.flat()];
  assert.equal(new Set(all.map(key)).size, 40 + 16 + 16);
  for (const c of all) assert.ok(c[0] >= 0 && c[0] <= 10 && c[1] >= 0 && c[1] <= 10);
  // Zielgerade schließt an das Feld vor dem Startfeld an
  for (let c = 0; c < 4; c++) {
    const before = L.RING_CELLS[(c * 10 + 39) % 40], g0 = L.GOAL_CELLS[c][0];
    assert.equal(Math.abs(before[0] - g0[0]) + Math.abs(before[1] - g0[1]), 1);
    for (let k = 0; k < 3; k++) {
      const a = L.GOAL_CELLS[c][k], b = L.GOAL_CELLS[c][k + 1];
      assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1);
    }
  }
});

test('Sitzplätze: 2 gegenüber, 3 und 4 der Reihe nach', () => {
  assert.deepEqual(mk(2).players.map((p) => p.color), [0, 2]);
  assert.deepEqual(mk(3).players.map((p) => p.color), [0, 1, 2]);
  assert.deepEqual(mk(4).players.map((p) => p.color), [0, 1, 2, 3]);
  assert.throws(() => mk(1));
  assert.throws(() => mk(5));
});

test('Start: alle im Haus, erste Person würfelt bis zu dreimal', () => {
  const g = mk(3);
  for (const p of g.players) assert.deepEqual(p.pieces, [-1, -1, -1, -1]);
  assert.equal(g.turn.stage, 'roll');
  assert.equal(g.turn.maxRolls, 3);
});

test('Nur die Person am Zug darf würfeln und ziehen', () => {
  const g = mk(3);
  const before = JSON.stringify(g);
  assert.equal(L.roll(g, 'p1', fixed(6)).ok, false);
  assert.equal(L.move(g, 'p1', 0).ok, false);
  assert.equal(L.roll(g, 'niemand', fixed(6)).ok, false);
  assert.equal(JSON.stringify(g), before);
});

test('Drei Versuche im Haus: ohne 6 verfällt der Wurf erst nach dem dritten Versuch', () => {
  const g = mk(2);
  let r = rollAs(g, 3);
  assert.equal(r.again, true);
  assert.equal(g.active, 0);
  assert.equal(g.turn.stage, 'roll');
  r = rollAs(g, 4);
  assert.equal(g.active, 0);
  r = rollAs(g, 5);
  assert.equal(r.again, false);
  assert.equal(g.active, 1);
  assert.equal(g.turn.rolls, 0);
  assert.ok(g.recap[0].includes('kann nicht ziehen'));
});

test('Drei Versuche im Haus: eine 6 beim zweiten Versuch stellt eine Figur heraus', () => {
  const g = mk(2);
  rollAs(g, 2);
  const r = rollAs(g, 6);
  assert.equal(r.moves.length, 4);
  assert.equal(g.turn.stage, 'move');
  assert.equal(L.move(g, 'p0', 2).ok, true);
  assert.equal(g.players[0].pieces[2], 0);
  assert.equal(g.active, 0); // 6 -> nochmal dran
  assert.equal(g.turn.stage, 'roll');
  assert.equal(g.turn.maxRolls, 1); // jetzt steht eine Figur auf dem Brett
});

test('Mit Figur auf dem Brett gibt es nur einen Versuch', () => {
  const g = mk(2);
  setPieces(g, 0, [10, -1, -1, -1]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 2);
  assert.equal(g.turn.stage, 'move');
  assert.deepEqual(g.turn.movable, [0]);
  L.move(g, 'p0', 0);
  assert.equal(g.players[0].pieces[0], 12);
  assert.equal(g.active, 1);
});

test('Sechs: Herausstellen ist Pflicht, wenn noch Figuren im Haus sind', () => {
  const g = mk(2);
  setPieces(g, 0, [10, -1, -1, 20]);
  rollAs(g, 6);
  assert.deepEqual(g.turn.movable.sort(), [1, 2]);
  assert.equal(L.move(g, 'p0', 0).ok, false);
  assert.equal(L.move(g, 'p0', 3).ok, false);
  assert.equal(g.players[0].pieces[0], 10);
  assert.equal(L.move(g, 'p0', 1).ok, true);
});

test('Sechs: ohne Figur im Haus freie Wahl und danach nochmal würfeln, auch mehrfach', () => {
  const g = mk(2);
  setPieces(g, 0, [10, 20, 30, 5]);
  let r = rollAs(g, 6);
  assert.equal(g.turn.movable.length, 4);
  L.move(g, 'p0', 0);
  assert.equal(g.active, 0);
  assert.equal(g.turn.bonus, true);
  rollAs(g, 6);
  L.move(g, 'p0', 1);
  assert.equal(g.active, 0);
  rollAs(g, 3);
  L.move(g, 'p0', 2);
  assert.equal(g.active, 1);
  assert.deepEqual(g.players[0].pieces, [16, 26, 33, 5]);
  void r;
});

test('Sechs ohne möglichen Zug gibt keinen Extrawurf', () => {
  const g = mk(2);
  setPieces(g, 0, [37, -1, -1, -1]);
  setPieces(g, 0, [0, 6, 12, 18]); // Start besetzt, alle Ziele +6 blockiert? 0->6 own, 6->12 own, 12->18 own, 18->24 frei
  rollAs(g, 6);
  assert.deepEqual(g.turn.movable, [3]);
  const h = mk(2);
  setPieces(h, 0, [38, 41, 42, 43]);
  h.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  const r = rollAs(h, 6);
  assert.deepEqual(r.moves, []);
  assert.equal(h.active, 1);
});

test('Startfeld besetzt und Figuren im Haus: Figur auf dem Startfeld muss weg', () => {
  const g = mk(2);
  setPieces(g, 0, [0, 15, -1, -1]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 3);
  assert.deepEqual(g.turn.movable, [0]);
  assert.equal(L.move(g, 'p0', 1).ok, false);
  L.move(g, 'p0', 0);
  assert.equal(g.players[0].pieces[0], 3);
});

test('Startfeld besetzt, Figur darf aber nicht (eigene Figur davor): andere Figuren dürfen ziehen', () => {
  const g = mk(2);
  setPieces(g, 0, [0, 3, 20, -1]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 3);
  assert.deepEqual(g.turn.movable.sort(), [1, 2]);
});

test('Sechs bei besetztem Startfeld: Figur vom Start wegziehen, nicht herausstellen', () => {
  const g = mk(2);
  setPieces(g, 0, [0, -1, -1, 20]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 6);
  assert.deepEqual(g.turn.movable, [0]);
});

test('Sechs bei besetztem Startfeld und Ziel +6 durch eigene Figur blockiert: andere dürfen', () => {
  const g = mk(2);
  setPieces(g, 0, [0, 6, -1, 20]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 6);
  assert.deepEqual(g.turn.movable.sort(), [1, 3]);
});

test('Auf eine eigene Figur darf man nicht ziehen, überspringen schon', () => {
  const g = mk(2);
  setPieces(g, 0, [10, 12, 15, 30]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 2);
  assert.deepEqual(g.turn.movable.sort(), [1, 2, 3]); // 10->12 blockiert
  assert.equal(L.legalMoves(g, 0, 5).find((m) => m.piece === 0), undefined); // 10->15 eigene Figur
  assert.equal(L.legalMoves(g, 0, 3).find((m) => m.piece === 0).to, 13); // 12 wird übersprungen
});

test('Schlagen: fremde Figur geht ins Haus, auch auf deren Startfeld', () => {
  const g = mk(2); // Rot 0, Grün 2 (Start Feld 20)
  setPieces(g, 0, [19, -1, -1, 5]); // Rot Fortschritt 19 = Ring 19
  setPieces(g, 1, [0, 3, -1, -1]); // Grün auf Ring 20 und Ring 23
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 1);
  const r = L.move(g, 'p0', 0);
  assert.equal(g.players[0].pieces[0], 20);
  assert.equal(r.captured.length, 1);
  assert.equal(g.players[1].pieces[0], -1);
  assert.equal(g.players[1].pieces[1], 3);
  assert.ok(g.recap[0].includes('geschlagen'));
  assert.equal(g.last.captured[0].name, 'P1');
});

test('Herausstellen auf besetztes Startfeld schlägt die fremde Figur', () => {
  const g = mk(2);
  setPieces(g, 1, [20, -1, -1, -1]); // Ring 40%40 = 0 = Rots Startfeld
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 3, die: null, movable: [], bonus: false };
  rollAs(g, 6);
  const r = L.move(g, 'p0', 0);
  assert.equal(r.captured.length, 1);
  assert.equal(g.players[1].pieces[0], -1);
  assert.equal(g.players[0].pieces[0], 0);
});

test('Mehrere Figuren desselben Gegners werden nicht gleichzeitig geschlagen (nur ein Feld)', () => {
  const g = mk(3);
  setPieces(g, 0, [9, -1, -1, -1]);
  setPieces(g, 1, [0, 0, -1, -1]); // unmöglich im Spiel, aber Engine bleibt stabil
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 1);
  L.move(g, 'p0', 0);
  assert.equal(g.players[0].pieces[0], 10);
});

test('Zielgerade: Abbiegen nach einer Runde, genaue Augenzahl, nicht über das Ende', () => {
  const g = mk(2);
  setPieces(g, 0, [38, -1, -1, -1]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  rollAs(g, 3);
  L.move(g, 'p0', 0);
  assert.equal(g.players[0].pieces[0], 41);
  // 43 ist das Ende
  setPieces(g, 0, [42, -1, -1, -1]);
  g.active = 0; g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  const r = rollAs(g, 2);
  assert.deepEqual(r.moves, []);
  assert.equal(g.players[0].pieces[0], 42);
});

test('Zielgerade: keine Figur überspringen', () => {
  const g = mk(2);
  setPieces(g, 0, [39, 41, -1, -1]);
  assert.deepEqual(L.legalMoves(g, 0, 3).map((m) => m.piece), []); // 39->42 liegt hinter 41
  assert.deepEqual(L.legalMoves(g, 0, 1).map((m) => m.piece), [0, 1]); // 39->40 ok, 41->42 ok
  assert.deepEqual(L.legalMoves(g, 0, 2).map((m) => m.piece), [1]); // 39->41 besetzt, 41->43 frei
});

test('Zielgerade: ein Zug von der Runde direkt hinter eine eigene Zielfigur ist verboten', () => {
  const g = mk(2);
  setPieces(g, 0, [38, 40, -1, -1]);
  assert.deepEqual(L.legalMoves(g, 0, 3).map((m) => m.piece), [1]); // 38->41 würde 40 überspringen; 40->43 frei
  assert.deepEqual(L.legalMoves(g, 0, 1).map((m) => m.piece), [0, 1]); // 38->39, 40->41
});

test('Hinten durchfüllen: die ersten Figuren müssen bis nach hinten, damit alle Platz haben', () => {
  const g = mk(2);
  setPieces(g, 0, [43, 42, 38, -1]);
  // 38 darf nur auf 40 oder 41 (nicht 42/43 besetzt)
  assert.deepEqual(L.legalMoves(g, 0, 2).map((m) => m.to), [40]);
  assert.deepEqual(L.legalMoves(g, 0, 3).map((m) => m.to), [41]);
  assert.deepEqual(L.legalMoves(g, 0, 4), []);
});

test('Drei Versuche gelten auch, wenn nur noch festgeparkte Zielfiguren da sind', () => {
  const g = mk(2);
  setPieces(g, 0, [43, 42, -1, -1]);
  assert.equal(L.hasBoardPiece(g.players[0]), false);
  setPieces(g, 0, [43, 41, -1, -1]);
  assert.equal(L.hasBoardPiece(g.players[0]), true); // 41 kann noch auf 42
  setPieces(g, 0, [5, -1, -1, -1]);
  assert.equal(L.hasBoardPiece(g.players[0]), true);
});

test('Gewinn: vierte Figur ins Ziel beendet das Spiel sofort, auch bei einer 6', () => {
  const g = mk(3);
  setPieces(g, 0, [43, 42, 41, 36]);
  g.turn = { stage: 'roll', rolls: 0, maxRolls: 1, die: null, movable: [], bonus: false };
  const r = rollAs(g, 4);
  assert.deepEqual(g.turn.movable, [3]); // 36->40
  const m = L.move(g, 'p0', 3);
  assert.equal(m.won, true);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.equal(L.roll(g, 'p0', fixed(3)).ok, false);
  assert.equal(L.move(g, 'p0', 3).ok, false);
  void r;
});

test('Rangliste: Gewinner zuerst, dann nach Figuren im Ziel', () => {
  const g = mk(3);
  setPieces(g, 0, [40, 41, 42, 43]);
  setPieces(g, 1, [40, 5, -1, -1]);
  setPieces(g, 2, [41, 42, 12, -1]);
  g.mode = 'over'; g.winner = 0;
  const r = L.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['p0', 'p2', 'p1']);
  assert.deepEqual(r.map((x) => x.goal), [4, 2, 1]);
});

test('Ungültige Nachrichten ändern nichts', () => {
  const g = mk(2);
  rollAs(g, 6);
  const snap = JSON.stringify(g);
  for (const msg of [null, undefined, 5, 'x', {}, { t: 'foo' }, { t: 'move' }, { t: 'move', piece: -1 }, { t: 'move', piece: 4 }, { t: 'move', piece: 1.5 }, { t: 'move', piece: '0' }, { t: 'move', piece: null }, { t: 'roll' }]) {
    const r = L.handle(g, 'p0', msg, fixed(3));
    assert.equal(r.ok, false, JSON.stringify(msg));
    assert.equal(JSON.stringify(g), snap);
  }
  assert.equal(L.handle(g, 'p1', { t: 'move', piece: 0 }).ok, false);
  assert.equal(L.move(g, 'p0', 99).ok, false);
});

test('Würfeln ist erst nach dem Ziehen wieder erlaubt, Ziehen nur nach dem Würfeln', () => {
  const g = mk(2);
  assert.equal(L.move(g, 'p0', 0).ok, false);
  rollAs(g, 6);
  assert.equal(L.roll(g, 'p0', fixed(2)).ok, false);
});

test('Würfel: alle Zahlen 1 bis 6 möglich, nie 0 oder 7', () => {
  const seen = new Set();
  for (const v of [0, 0.0001, 0.166, 0.167, 0.34, 0.5, 0.83, 0.84, 0.9999, 0.99999999]) {
    const g = mk(2);
    L.roll(g, 'p0', () => v);
    seen.add(g.last.die);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

test('Zustand ist JSON-tauglich (Netz)', () => {
  const g = mk(4);
  rollAs(g, 6); L.move(g, 'p0', 0);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

function invariants(g) {
  const seenRing = new Map();
  for (const p of g.players) {
    assert.equal(p.pieces.length, 4);
    const own = new Set();
    for (const x of p.pieces) {
      assert.ok(Number.isInteger(x) && x >= -1 && x <= 43, 'Fortschritt ' + x);
      if (x >= 0) { assert.ok(!own.has(x), 'zwei eigene Figuren auf Feld ' + x); own.add(x); }
      if (x >= 0 && x <= 39) {
        const k = L.ringIndex(p.color, x);
        assert.ok(!seenRing.has(k), 'zwei Figuren auf Rundweg-Feld ' + k);
        seenRing.set(k, p.id);
      }
    }
  }
}

function playRandom(n, seed, strategy) {
  const rng = seedRng(seed);
  const g = L.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), rng);
  let steps = 0, captures = 0, noMoves = 0;
  while (g.mode !== 'over') {
    assert.ok(++steps < 20000, 'Partie endet nicht (Seed ' + seed + ')');
    const a = L.activePlayer(g);
    if (g.turn.stage === 'roll') {
      const r = L.roll(g, a.id, rng);
      assert.equal(r.ok, true);
      if (!r.moves.length) noMoves++;
    } else {
      assert.equal(g.turn.stage, 'move');
      const mv = g.turn.movable;
      assert.ok(mv.length > 0);
      // eine nicht ziehbare Figur wird abgelehnt
      for (let i = 0; i < 4; i++) if (!mv.includes(i)) assert.equal(L.move(g, a.id, i).ok, false);
      const pick = strategy === 'first' ? mv[0] : strategy === 'last' ? mv[mv.length - 1] : mv[Math.floor(rng() * mv.length)];
      const r = L.move(g, a.id, pick);
      assert.equal(r.ok, true);
      captures += r.captured.length;
      // andere Personen dürfen nie handeln
      const other = g.players.find((p) => p.id !== a.id);
      if (g.mode !== 'over' && other.id !== L.activePlayer(g).id) assert.equal(L.roll(g, other.id, rng).ok, false);
    }
    invariants(g);
  }
  assert.equal(g.players[g.winner].pieces.every((x) => x >= 40), true);
  assert.equal(L.ranking(g)[0].idx, g.winner);
  return { steps, captures, noMoves };
}

for (const n of [2, 3, 4]) {
  test(`Zufallspartien mit ${n} Personen enden sauber (Invarianten)`, () => {
    let caps = 0, nm = 0;
    for (let s = 1; s <= 150; s++) {
      const r = playRandom(n, s * 7919 + n, ['rand', 'first', 'last'][s % 3]);
      caps += r.captures; nm += r.noMoves;
    }
    assert.ok(caps > 100, 'es wird tatsächlich geschlagen');
    assert.ok(nm > 100);
  });
}

test('Sicherheit: zufälliger Nachrichten-Müll mitten im Spiel zerstört nichts', () => {
  const rng = seedRng(42);
  const g = mk(3);
  const junk = () => [null, {}, { t: 'roll' }, { t: 'move', piece: Math.floor(rng() * 8) - 2 }, { t: 'x' }, { t: 'move', piece: 'a' }][Math.floor(rng() * 6)];
  for (let i = 0; i < 3000 && g.mode !== 'over'; i++) {
    const who = 'p' + Math.floor(rng() * 4);
    L.handle(g, who, junk(), rng);
    invariants(g);
  }
});
