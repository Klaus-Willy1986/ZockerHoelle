import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../reversi/engine.js';

const P = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }];
const mk = (opts) => M.createGame(P, opts);
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const idx = (name) => ('abcdefgh'.indexOf(name[0])) + (Number(name[1]) - 1) * 8;
const empty = () => Array(64).fill(null);
const ID = ['a', 'b'];

test('Startstellung: d4/e5 weiß, d5/e4 schwarz, Schwarz beginnt, 4 legale Züge', () => {
  const g = mk();
  assert.equal(g.game, 'rv');
  assert.equal(g.mode, 'play');
  assert.equal(g.turn, g.black);
  assert.equal(g.black, 0);
  assert.equal(g.board[idx('d4')], 1); assert.equal(g.board[idx('e5')], 1);
  assert.equal(g.board[idx('d5')], 0); assert.equal(g.board[idx('e4')], 0);
  assert.deepEqual(M.countsOf(g.board), [2, 2]);
  assert.equal(g.board.filter((v) => v !== null).length, 4);
  assert.deepEqual(M.legalCells(g.board, 0).sort((x, y) => x - y), ['d3', 'c4', 'f5', 'e6'].map(idx).sort((x, y) => x - y));
  assert.equal(M.legalActions(g).length, 4);
  assert.equal(M.colorOf(g, 0), 'Schwarz'); assert.equal(M.colorOf(g, 1), 'Weiß');
  assert.deepEqual(g.opts, { hints: false });
  assert.equal(mk({ hints: true }).opts.hints, true);
  assert.throws(() => M.createGame([P[0]]));
});

test('Perft: Zugzahlen der Standardstellung (4, 12, 56, 244)', () => {
  const perft = (board, side, depth) => {
    if (depth === 0) return 1;
    let n = 0;
    for (const p of M.legalCells(board, side)) {
      const b = board.slice();
      M.applyMove(b, p, side);
      n += perft(b, 1 - side, depth - 1);
    }
    return n;
  };
  const b = M.startBoard(0);
  assert.equal(perft(b, 0, 1), 4);
  assert.equal(perft(b, 0, 2), 12);
  assert.equal(perft(b, 0, 3), 56);
  assert.equal(perft(b, 0, 4), 244);
  // nach jedem Eröffnungszug hat die Gegenseite genau 3 Züge
  for (const p of M.legalCells(b, 0)) {
    const c = b.slice(); M.applyMove(c, p, 0);
    assert.equal(M.legalCells(c, 1).length, 3);
  }
  // dasselbe über das Spiel-Objekt
  const g = mk();
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('d3') }).ok, true);
  assert.equal(M.legalActions(g).length, 3);
});

test('alle 8 Richtungen werden erkannt', () => {
  const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  for (const [dr, dc] of dirs) {
    for (const len of [1, 2, 3]) {
      const b = empty();
      const r0 = 3 + (dr === 1 ? -1 : 0); const c0 = 3 + (dc === 1 ? -1 : 0); // Mitte, genug Platz in jede Richtung
      const sr = dr === 0 ? 3 : dr === 1 ? 1 : 6; const sc = dc === 0 ? 3 : dc === 1 ? 1 : 6;
      void r0; void c0;
      const start = sr * 8 + sc;
      const expected = [];
      for (let k = 1; k <= len; k++) { const q = (sr + dr * k) * 8 + (sc + dc * k); b[q] = 1; expected.push(q); }
      b[(sr + dr * (len + 1)) * 8 + (sc + dc * (len + 1))] = 0;
      assert.deepEqual(M.flipsFor(b, start, 0).sort((x, y) => x - y), expected.sort((x, y) => x - y), `Richtung ${dr},${dc} Länge ${len}`);
      const c = b.slice();
      const f = M.applyMove(c, start, 0);
      assert.equal(f.length, len);
      for (const q of expected) assert.equal(c[q], 0);
      assert.equal(c[start], 0);
    }
  }
});

test('mehrfaches Umdrehen in mehreren Richtungen gleichzeitig', () => {
  const b = empty();
  // Zug auf d4 (27): rechts e4,f4 weiß, g4 schwarz; unten d5 weiß, d6 schwarz; schräg e5 weiß, f6 schwarz
  b[idx('e4')] = 1; b[idx('f4')] = 1; b[idx('g4')] = 0;
  b[idx('d5')] = 1; b[idx('d6')] = 0;
  b[idx('e5')] = 1; b[idx('f6')] = 0;
  const f = M.flipsFor(b, idx('d4'), 0).sort((x, y) => x - y);
  assert.deepEqual(f, ['e4', 'f4', 'd5', 'e5'].map(idx).sort((x, y) => x - y));
  M.applyMove(b, idx('d4'), 0);
  for (const n of ['d4', 'e4', 'f4', 'g4', 'd5', 'd6', 'e5', 'f6']) assert.equal(b[idx(n)], 0, n);
});

test('keine Umdrehung ohne Abschluss, Lücke, Rand oder eigenen Stein direkt daneben', () => {
  const b = empty();
  b[idx('d4')] = 1; b[idx('e4')] = 1; // weiße Reihe, rechts offen
  assert.deepEqual(M.flipsFor(b, idx('c4'), 0), []);
  b[idx('g4')] = 0; // Lücke bei f4
  assert.deepEqual(M.flipsFor(b, idx('c4'), 0), []);
  b[idx('f4')] = 1; // jetzt geschlossen
  assert.equal(M.flipsFor(b, idx('c4'), 0).length, 3);
  // Rand: Reihe bis zur Kante ohne Abschluss
  const c = empty();
  c[idx('b1')] = 1; c[idx('c1')] = 1;
  assert.deepEqual(M.flipsFor(c, idx('a1'), 0), []);
  // eigener Stein direkt daneben schließt nichts ein
  const d = empty(); d[idx('b1')] = 0;
  assert.deepEqual(M.flipsFor(d, idx('a1'), 0), []);
  // belegtes Feld, ungültige Felder
  assert.deepEqual(M.flipsFor(b, idx('d4'), 0), []);
  assert.deepEqual(M.flipsFor(b, -1, 0), []);
  assert.deepEqual(M.flipsFor(b, 64, 0), []);
  assert.deepEqual(M.flipsFor(b, 1.5, 0), []);
  assert.deepEqual(M.flipsFor(null, 3, 0), []);
});

test('Spielzug: Umdrehen, Zugwechsel, Protokoll; illegale Züge ändern nichts', () => {
  const g = mk();
  const before = JSON.stringify(g);
  for (const bad of [{ t: 'place', p: 0 }, { t: 'place', p: idx('d4') }, { t: 'place', p: -1 }, { t: 'place', p: 64 }, { t: 'place', p: 'x' }, { t: 'place', p: 2.5 }, { t: 'place', p: null }, { t: 'place' }]) {
    assert.equal(M.handle(g, 'a', bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(M.handle(g, 'b', { t: 'place', p: idx('d3') }).ok, false, 'falsche Person');
  assert.equal(M.handle(g, 'zz', { t: 'place', p: idx('d3') }).ok, false, 'Fremde');
  assert.equal(JSON.stringify(g), before);
  assert.match(M.handle(g, 'a', { t: 'place', p: 0 }).error, /nicht setzen/);
  const r = M.handle(g, 'a', { t: 'place', p: idx('d3') });
  assert.equal(r.ok, true);
  assert.equal(g.board[idx('d3')], 0); assert.equal(g.board[idx('d4')], 0);
  assert.deepEqual(g.last, { by: 0, p: idx('d3'), flips: [idx('d4')] });
  assert.equal(g.turn, 1); assert.equal(g.moveNo, 1);
  assert.deepEqual(M.countsOf(g.board), [4, 1]);
  assert.match(g.recap[0], /Anna hat auf d3 gesetzt und einen Stein umgedreht/);
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('c3') }).ok, false, 'Anna ist nicht mehr dran');
});

test('ungültige Nachrichten und Phasen', () => {
  const g = mk();
  const before = JSON.stringify(g);
  for (const m of [null, undefined, 5, 'x', [], {}, { t: 'foo' }, { t: 'place', p: {} }, { t: 'ack' }]) assert.equal(M.handle(g, 'a', m).ok, false);
  assert.equal(M.handle(null, 'a', { t: 'place', p: 1 }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'next' }).ok, false, 'Runde läuft noch');
  assert.equal(M.handle(g, 'fremd', { t: 'next' }).ok, false);
  assert.equal(JSON.stringify(g), before);
});

test('Passen: Hinweis-Modus, OK bestätigt, dieselbe Person zieht weiter', () => {
  const g = mk();
  g.board = empty();
  g.board[idx('a1')] = 0; g.board[idx('b1')] = 1; // Schwarz setzt c1 und dreht b1 um
  g.board[idx('h8')] = 0; g.board[idx('h7')] = 1; // Reserve: noch ein möglicher Zug g6? h6 für Schwarz
  g.turn = 0;
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('c1') }).ok, true);
  // Weiß hat nur noch h7 und hat keinen Zug (kein Schwarz einschließbar?) -> Passen
  assert.equal(M.legalCells(g.board, 1).length, 0);
  assert.ok(M.legalCells(g.board, 0).length > 0);
  assert.equal(g.mode, 'pass');
  assert.equal(g.passer, 1);
  assert.equal(g.turn, 0);
  assert.equal(g.passes, 1);
  assert.match(g.recap.join(' '), /Ben kann nicht ziehen\. Anna ist wieder dran/);
  // bis OK keine Züge
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('h6') }).ok, false);
  assert.match(M.handle(g, 'a', { t: 'place', p: idx('h6') }).error, /OK/);
  assert.equal(M.handle(g, 'fremd', { t: 'ack' }).ok, false);
  assert.equal(M.handle(g, 'b', { t: 'ack' }).ok, true);
  assert.equal(g.mode, 'play'); assert.equal(g.passer, null); assert.equal(g.turn, 0);
  assert.equal(M.handle(g, 'b', { t: 'ack' }).ok, false, 'nicht doppelt');
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('h6') }).ok, true);
});

test('doppeltes Passen = Ende der Runde; Sieger nach Steinzahl; Punkte 2 / 0', () => {
  const g = mk();
  g.board = empty();
  g.board[idx('a1')] = 0; g.board[idx('b1')] = 1; // c1 dreht b1; danach kann niemand mehr
  g.board[idx('h1')] = 0;
  g.turn = 0;
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('c1') }).ok, true);
  assert.equal(g.mode, 'over');
  assert.equal(g.endCode, 'stuck');
  assert.equal(g.winner, 0);
  assert.deepEqual(g.final, [4, 0]);
  assert.deepEqual(g.scores, [2, 0]);
  assert.equal(M.handle(g, 'b', { t: 'place', p: 5 }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'ack' }).ok, false);
  assert.match(g.endReason, /Anna hat mehr Steine: 4 zu 0/);
});

test('volles Brett endet die Runde; Weiß (zweite Person) gewinnt und bekommt 2 Punkte', () => {
  const g = mk();
  g.board = Array(64).fill(1);
  g.board[idx('h8')] = null;
  for (let r = 0; r < 4; r++) g.board[r * 8 + 7] = 0; // h1..h4 schwarz, h5..h7 weiß
  g.turn = 0;
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('h8') }).ok, true);
  assert.equal(g.mode, 'over');
  assert.equal(g.endCode, 'full');
  assert.equal(g.board.every((v) => v !== null), true);
  assert.deepEqual(g.final, [8, 56]);
  assert.equal(g.winner, 1);
  assert.deepEqual(g.scores, [0, 2]);
  assert.match(g.endReason, /Ben hat mehr Steine: 56 zu 8/);
  assert.equal(M.ranking(g)[0].name, 'Ben');
});

test('Gleichstand beendet mit je 1 Punkt', () => {
  const g = mk();
  g.board = Array(64).fill(null);
  g.board[idx('a1')] = 0; g.board[idx('b1')] = 1; // Zug c1 -> Schwarz 3
  g.board[idx('h8')] = 1; g.board[idx('f8')] = 1; g.board[idx('d6')] = 1; // Weiß 3 (einzeln, nicht einschließbar)
  g.turn = 0;
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('c1') }).ok, true);
  assert.equal(g.mode, 'over');
  assert.deepEqual(g.final, [3, 3]);
  assert.equal(g.winner, null);
  assert.deepEqual(g.scores, [1, 1]);
  assert.match(g.endReason, /Unentschieden: 3 zu 3/);
  assert.equal(M.handle(g, 'a', { t: 'next' }).ok, true);
  assert.equal(g.black, 1);
});

test('Runden: Farbwechsel, Punktestand bleibt, Startstellung', () => {
  const g = mk();
  g.mode = 'over'; g.scores = [2, 1]; g.winner = 0; g.final = [40, 24]; g.moveNo = 50; g.last = { by: 0, p: 5, flips: [6] };
  assert.equal(M.handle(g, 'b', { t: 'next' }).ok, true);
  assert.equal(g.round, 2);
  assert.equal(g.black, 1); assert.equal(g.turn, 1);
  assert.equal(M.colorOf(g, 1), 'Schwarz'); assert.equal(M.colorOf(g, 0), 'Weiß');
  assert.deepEqual(g.scores, [2, 1]);
  assert.equal(g.mode, 'play'); assert.equal(g.moveNo, 0); assert.equal(g.last, null);
  // Startstellung: Schwarz = Person 1 auf d5/e4
  assert.equal(g.board[idx('d5')], 1); assert.equal(g.board[idx('e4')], 1);
  assert.equal(g.board[idx('d4')], 0); assert.equal(g.board[idx('e5')], 0);
  assert.equal(M.handle(g, 'a', { t: 'place', p: idx('d3') }).ok, false, 'Ben ist dran');
  assert.equal(M.handle(g, 'b', { t: 'place', p: idx('d3') }).ok, true);
  assert.match(M.handle(g, 'b', { t: 'next' }).error, /läuft noch/);
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => [x.name, x.points, x.place]), [['Anna', 2, 1], ['Ben', 1, 2]]);
});

test('300 Zufallspartien: enden immer, Bilanz stimmt, Zustand ist JSON-sicher', () => {
  let passGames = 0; let fullGames = 0; let stuckGames = 0; let draws = 0; let totalPass = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry(seed);
    const g = mk();
    if (seed % 2 === 0) { g.black = 1; g.board = M.startBoard(1); g.turn = 1; }
    let guard = 0; let discs = 4;
    while (g.mode !== 'over') {
      assert.ok(guard++ < 200, 'Partie endet nicht');
      if (g.mode === 'pass') {
        const r = M.handle(g, ID[Math.floor(rnd() * 2)], { t: 'ack' });
        assert.equal(r.ok, true);
        continue;
      }
      const acts = M.legalActions(g);
      assert.ok(acts.length > 0, 'am Zug ohne Zug im Modus play');
      const a = acts[Math.floor(rnd() * acts.length)];
      const before = M.countsOf(g.board);
      const r = M.handle(g, ID[g.turn], a);
      assert.equal(r.ok, true);
      discs += 1;
      const after = M.countsOf(g.board);
      assert.equal(after[0] + after[1], discs, 'Steinbilanz');
      assert.ok(after[0] + after[1] <= 64);
      const mover = g.last.by;
      assert.equal(after[mover], before[mover] + 1 + g.last.flips.length);
      assert.equal(after[1 - mover], before[1 - mover] - g.last.flips.length);
      assert.ok(g.last.flips.length >= 1);
      const copy = JSON.parse(JSON.stringify(g));
      assert.deepEqual(copy, g);
    }
    const c = M.countsOf(g.board);
    assert.deepEqual(g.final, c);
    assert.ok(c[0] + c[1] <= 64);
    assert.equal(g.scores[0] + g.scores[1], g.winner === null ? 2 : 2);
    if (g.winner === null) { assert.equal(c[0], c[1]); assert.deepEqual(g.scores, [1, 1]); draws++; }
    else { assert.ok(c[g.winner] > c[1 - g.winner]); assert.equal(g.scores[g.winner], 2); }
    if (g.endCode === 'full') { fullGames++; assert.equal(c[0] + c[1], 64); } else { stuckGames++; assert.equal(g.endCode, 'stuck'); assert.ok(M.legalCells(g.board, 0).length === 0 && M.legalCells(g.board, 1).length === 0); }
    totalPass += g.passes; if (g.passes) passGames++;
  }
  console.log(`# 300 Partien: voll ${fullGames}, festgefahren ${stuckGames}, mit Passen ${passGames} (gesamt ${totalPass}), Unentschieden ${draws}`);
  assert.ok(fullGames > 0 && passGames > 0);
});

test('mehrere Runden hintereinander (Punktestand summiert)', () => {
  const rnd = mulberry(77);
  const g = mk();
  let rounds = 0;
  for (; rounds < 5; rounds++) {
    let guard = 0;
    while (g.mode !== 'over') {
      assert.ok(guard++ < 200);
      if (g.mode === 'pass') { M.handle(g, 'a', { t: 'ack' }); continue; }
      const acts = M.legalActions(g);
      M.handle(g, ID[g.turn], acts[Math.floor(rnd() * acts.length)]);
    }
    assert.equal(g.scores[0] + g.scores[1], 2 * (rounds + 1));
    assert.equal(M.handle(g, 'a', { t: 'next' }).ok, true);
    assert.equal(g.black, (rounds + 1) % 2);
  }
  assert.equal(g.round, 6);
});
