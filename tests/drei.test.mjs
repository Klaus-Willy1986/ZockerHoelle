import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../drei/engine.js';

const P = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }];
const mk = (big = false) => M.createGame(P, { big });
const ids = ['a', 'b'];
const idOf = (g) => ids[g.turn];

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
// Setzt der Reihe nach Felder; die Person am Zug wechselt wie im Spiel
const playMoves = (g, cells) => { let r; for (const p of cells) { r = M.place(g, idOf(g), p); assert.equal(r.ok, true, `Zug ${p}: ${r.error}`); } return r; };

test('Start: 3×3, Kreuz beginnt, leeres Feld, Punkte 0', () => {
  const g = mk();
  assert.equal(g.size, 3); assert.equal(g.k, 3);
  assert.equal(g.board.length, 9);
  assert.ok(g.board.every((v) => v === null));
  assert.equal(g.turn, 0); assert.equal(g.starter, 0); assert.equal(g.round, 1);
  assert.deepEqual(g.scores, [0, 0]);
  assert.equal(g.mode, 'play');
});

test('Große Option: 5×5 mit vier in einer Reihe; Standard ist aus', () => {
  const g = mk(true);
  assert.equal(g.size, 5); assert.equal(g.k, 4); assert.equal(g.board.length, 25);
  const d = M.createGame(P);
  assert.equal(d.size, 3);
  const d2 = M.createGame(P, null);
  assert.equal(d2.size, 3);
  assert.equal(M.createGame(P, { big: 'ja' }).size, 5);
  assert.throws(() => M.createGame([P[0]]));
});

test('Anzahl der Gewinnreihen: 8 bei 3×3, 28 bei 5×5, alle gerade und verschieden', () => {
  const l3 = M.winLines(3, 3);
  const l5 = M.winLines(5, 4);
  assert.equal(l3.length, 8);
  assert.equal(l5.length, 28);
  for (const [n, lines, k] of [[3, l3, 3], [5, l5, 4]]) {
    assert.equal(new Set(lines.map((l) => l.join())).size, lines.length);
    for (const l of lines) {
      assert.equal(l.length, k);
      const d = l[1] - l[0];
      assert.ok([1, n, n + 1, n - 1].includes(d));
      l.forEach((c, i) => assert.equal(c, l[0] + d * i));
      const rows = l.map((c) => Math.floor(c / n));
      const cols = l.map((c) => c % n);
      assert.ok(Math.max(...rows) - Math.min(...rows) <= k - 1 && Math.max(...cols) - Math.min(...cols) <= k - 1);
    }
  }
});

test('3×3: jede der 8 Reihen gewinnt (für Kreuz und für Kreis)', () => {
  for (const line of M.winLines(3, 3)) {
    for (const who of [0, 1]) {
      const g = mk();
      if (who === 1) g.turn = 1; // Kreis ist am Zug
      const rest = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !line.includes(c));
      const mine = [...line]; const theirs = rest.slice(0, 2);
      // Der Gegner setzt nur zwei Zeichen, kann also selbst nicht vorher gewinnen
      const r = playMoves(g, [mine[0], theirs[0], mine[1], theirs[1], mine[2]]);
      assert.equal(r.ok, true);
      assert.equal(g.mode, 'over', `Reihe ${line}`);
      assert.equal(g.winner, who);
      assert.deepEqual([...g.line].sort((a, b) => a - b), [...line].sort((a, b) => a - b));
      assert.equal(g.scores[who], 1); assert.equal(g.scores[1 - who], 0);
      assert.equal(g.endCode, 'line');
    }
  }
});

test('5×5: jede der 28 Reihen gewinnt, drei in einer Reihe reichen nicht', () => {
  for (const line of M.winLines(5, 4)) {
    const g = mk(true);
    const rest = Array.from({ length: 25 }, (_, i) => i).filter((c) => !line.includes(c));
    // Gegner setzt Felder, die keine eigene Vierer-Reihe bilden (Abstand: nie vier zusammen nötig, es sind nur drei Zeichen)
    const theirs = rest.slice(0, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(M.place(g, 'a', line[i]).ok, true);
      assert.equal(g.mode, 'play', 'drei reichen bei 5×5 nicht');
      assert.equal(M.place(g, 'b', theirs[i]).ok, true);
      assert.equal(g.mode, 'play');
    }
    assert.equal(M.place(g, 'a', line[3]).ok, true);
    assert.equal(g.mode, 'over', `Reihe ${line}`);
    assert.equal(g.winner, 0);
    assert.deepEqual([...g.line].sort((a, b) => a - b), [...line].sort((a, b) => a - b));
  }
});

test('5×5: fünf in einer Reihe wird ganz hervorgehoben; Lücke zählt nicht', () => {
  const g = mk(true);
  playMoves(g, [0, 5, 1, 6, 3, 10, 4, 11]); // Kreuz: 0,1,3,4 – Lücke bei 2
  assert.equal(g.mode, 'play');
  M.place(g, 'a', 2);
  assert.equal(g.mode, 'over');
  assert.deepEqual(g.line, [0, 1, 2, 3, 4]);
});

test('Unentschieden bei vollem Feld: niemand bekommt einen Punkt', () => {
  const g = mk();
  // X O X / X O O / O X X  (Zugfolge so, dass niemand vorher gewinnt)
  playMoves(g, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, null);
  assert.equal(g.endCode, 'full');
  assert.deepEqual(g.scores, [0, 0]);
  assert.equal(g.line, null);
  assert.equal(M.winnerOf(g.board, 3, 3), null);
});

test('Sieg im letzten Zug zählt als Sieg, nicht als Unentschieden', () => {
  const g = mk();
  // letztes Feld schließt Reihe: X O X / O X O / O X X? Diagonale 0-4-8 mit X im 9. Zug
  playMoves(g, [0, 1, 2, 3, 5, 4, 7, 6]);
  assert.equal(g.mode, 'play');
  M.place(g, 'a', 8);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.equal(g.board.every((v) => v !== null), true);
});

test('Ungültige Züge werden abgelehnt und verändern nichts', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  for (const [pid, p] of [['b', 0], ['x', 0], ['a', -1], ['a', 9], ['a', 1.5], ['a', '3'], ['a', null], ['a', NaN], ['a', undefined], ['a', {}], [undefined, 0]]) {
    const r = M.place(g, pid, p);
    assert.equal(r.ok, false, `${pid} ${String(p)}`);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(JSON.stringify(g), snap);
  assert.equal(M.place(g, 'a', 4).ok, true);
  assert.equal(M.place(g, 'b', 4).ok, false, 'belegt');
  assert.equal(M.place(g, 'a', 0).ok, false, 'nicht dran');
  assert.equal(M.place(null, 'a', 0).ok, false);
  assert.equal(M.place(undefined, 'a', 0).ok, false);
  const big = mk(true);
  assert.equal(M.place(big, 'a', 25).ok, false);
  assert.equal(M.place(big, 'a', 24).ok, true);
});

test('Nach Rundenende sind keine Züge mehr erlaubt', () => {
  const g = mk();
  playMoves(g, [0, 3, 1, 4, 2]);
  assert.equal(g.mode, 'over');
  const snap = JSON.stringify(g);
  assert.equal(M.place(g, 'b', 8).ok, false);
  assert.equal(JSON.stringify(g), snap);
  assert.deepEqual(M.legalActions(g), []);
});

test('handle: unbekannte und kaputte Nachrichten werfen nie', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  for (const m of [null, undefined, 5, 'x', [], {}, { t: 'foo' }, { t: 'place' }, { t: 'place', p: 'a' }, { t: 'next' }, { t: 'place', p: 99 }, { t: '__proto__' }]) {
    for (const pid of ['a', 'b', 'z', null, undefined]) {
      const r = M.handle(g, pid, m);
      assert.equal(typeof r.ok, 'boolean');
      assert.equal(r.ok, false);
    }
  }
  assert.equal(JSON.stringify(g), snap);
  assert.equal(M.handle(g, 'a', { t: 'place', p: 0 }).ok, true);
  for (const bad of [null, undefined, {}, { players: null }, 3]) assert.equal(M.handle(bad, 'a', { t: 'place', p: 0 }).ok, false);
  for (const bad of [null, {}, { players: null }]) assert.equal(M.handle(bad, 'a', { t: 'next' }).ok, false);
});

test('Runden: Punktestand bleibt, beginnende Person wechselt, Feld ist wieder leer', () => {
  const g = mk();
  assert.equal(M.handle(g, 'a', { t: 'next' }).ok, false, 'Runde läuft noch');
  playMoves(g, [0, 3, 1, 4, 2]); // Kreuz gewinnt
  assert.deepEqual(g.scores, [1, 0]);
  assert.equal(M.handle(g, 'zz', { t: 'next' }).ok, false, 'Fremde dürfen nicht');
  assert.equal(M.handle(g, 'b', { t: 'next' }).ok, true);
  assert.equal(g.round, 2); assert.equal(g.mode, 'play');
  assert.ok(g.board.every((v) => v === null));
  assert.equal(g.starter, 1); assert.equal(g.turn, 1);
  assert.equal(g.line, null); assert.equal(g.winner, null); assert.equal(g.last, null); assert.equal(g.moveNo, 0);
  assert.deepEqual(g.scores, [1, 0]);
  // Kreis beginnt und gewinnt
  assert.equal(M.place(g, 'a', 0).ok, false);
  playMoves(g, [0, 3, 1, 4, 2]);
  assert.equal(g.winner, 1);
  assert.deepEqual(g.scores, [1, 1]);
  M.nextRound(g);
  assert.equal(g.round, 3); assert.equal(g.starter, 0); assert.equal(g.turn, 0);
  // Unentschieden ändert den Punktestand nicht
  playMoves(g, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(g.winner, null);
  assert.deepEqual(g.scores, [1, 1]);
  M.nextRound(g);
  assert.equal(g.round, 4); assert.equal(g.starter, 1);
  assert.equal(g.size, 3, 'Feldgröße bleibt');
  const big = mk(true);
  playMoves(big, [0, 5, 1, 6, 2, 7, 3]);
  M.nextRound(big);
  assert.equal(big.board.length, 25); assert.equal(big.k, 4);
});

test('Rangliste nach Punkten, gleiche Punkte = gleicher Platz', () => {
  const g = mk();
  assert.deepEqual(M.ranking(g).map((r) => r.place), [1, 1]);
  g.scores = [1, 3];
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['b', 'a']);
  assert.deepEqual(r.map((x) => x.place), [1, 2]);
  assert.deepEqual(r.map((x) => x.points), [3, 1]);
});

test('Zustand ist reines JSON: Kopie über JSON spielt identisch weiter', () => {
  const rnd = mulberry(5);
  const g = mk(true);
  for (let i = 0; i < 6; i++) { const l = M.legalActions(g); M.handle(g, idOf(g), l[Math.floor(rnd() * l.length)]); }
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.equal(JSON.stringify(copy), JSON.stringify(g));
  const l = M.legalActions(g)[0];
  M.handle(g, idOf(g), l); M.handle(copy, idOf(copy), l);
  assert.deepEqual(copy, g);
  assert.equal(M.createGame(P, {}, () => 0.5).game, 'drei');
});

test('300 Zufallspartien enden immer (3×3 und 5×5), Stand und Zugzahl stimmen', () => {
  const stats = { line: 0, full: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry(seed);
    const big = seed % 2 === 0;
    const g = mk(big);
    let rounds = 0;
    let wins = 0;
    let guard = 0;
    while (rounds < 3 && guard++ < 500) {
      if (g.mode === 'over') {
        assert.ok(g.endCode === 'line' || g.endCode === 'full');
        wins += g.winner === null ? 0 : 1;
        assert.equal(g.scores[0] + g.scores[1], wins, 'Punkte = Zahl der Siege');
        stats[g.endCode]++;
        rounds++;
        if (g.winner === null) assert.equal(g.board.every((v) => v !== null), true);
        else {
          assert.ok(g.line.length >= g.k);
          assert.ok(g.line.every((c) => g.board[c] === g.winner));
        }
        M.nextRound(g);
        continue;
      }
      const l = M.legalActions(g);
      assert.ok(l.length > 0, 'laufende Runde hat immer einen Zug');
      const a = l[Math.floor(rnd() * l.length)];
      const before = g.moveNo;
      assert.equal(M.handle(g, idOf(g), a).ok, true);
      assert.equal(g.moveNo, before + 1);
      assert.ok(g.board.filter((v) => v !== null).length === g.moveNo);
    }
    assert.equal(rounds, 3, `Partie ${seed} endet`);
  }
  console.log('Rundenenden', stats);
  assert.ok(stats.line > 0 && stats.full > 0);
});
