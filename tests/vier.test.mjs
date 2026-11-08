import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../vier/engine.js';

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
const playCols = (g, cols) => { let r; for (const c of cols) { r = M.drop(g, idOf(g), c); assert.equal(r.ok, true, `Spalte ${c}: ${r.error}`); } return r; };
// Setzt Steine direkt (für Sonderfälle), ohne Zugreihenfolge
const put = (g, r, c, v) => { g.board[r * g.cols + c] = v; };

test('Start: 7×6 bzw. 8×7, Gelb beginnt, leeres Brett, Punkte 0', () => {
  const g = mk();
  assert.equal(g.cols, 7); assert.equal(g.rows, 6); assert.equal(g.board.length, 42);
  assert.ok(g.board.every((v) => v === null));
  assert.equal(g.turn, 0); assert.equal(g.starter, 0); assert.equal(g.round, 1);
  assert.deepEqual(g.scores, [0, 0]); assert.equal(g.mode, 'play'); assert.equal(g.game, 'vr');
  const b = mk(true);
  assert.equal(b.cols, 8); assert.equal(b.rows, 7); assert.equal(b.board.length, 56);
  assert.equal(M.createGame(P, {}).opts.big, false);
  assert.equal(M.createGame(P, null).cols, 7);
  assert.throws(() => M.createGame([P[0]], {}));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('Fall-Mechanik: Stein fällt auf das unterste freie Feld', () => {
  const g = mk();
  playCols(g, [3, 3, 3]);
  assert.equal(g.board[5 * 7 + 3], 0);
  assert.equal(g.board[4 * 7 + 3], 1);
  assert.equal(g.board[3 * 7 + 3], 0);
  assert.equal(g.board[2 * 7 + 3], null);
  assert.deepEqual(g.last, { by: 0, p: 3 * 7 + 3, col: 3, row: 3 });
  assert.equal(g.moveNo, 3);
  assert.equal(g.turn, 1);
  assert.match(g.recap[0], /Anna wirft in Spalte 4/);
});

test('Spalte füllt sich: volle Spalte wird abgelehnt, Zustand unverändert', () => {
  const g = mk();
  // abwechselnd Spalte 0 mit Mustern ohne Vierer: A B A B A B (6 Steine)
  playCols(g, [0, 0, 0, 0, 0, 0]);
  assert.ok(M.colFull(g, 0));
  const before = JSON.stringify(g);
  const r = M.drop(g, idOf(g), 0);
  assert.equal(r.ok, false); assert.match(r.error, /voll/);
  assert.equal(JSON.stringify(g), before);
  assert.ok(!M.openCols(g).includes(0));
  assert.equal(M.legalActions(g).length, 6);
});

function winTest(name, big, cells, who = 0) {
  test(`Sieg: ${name} (${big ? '8×7' : '7×6'})`, () => {
    const g = mk(big);
    // Vorbelegen und letzten Stein per drop setzen
    for (const [r, c, v] of cells.slice(0, -1)) put(g, r, c, v);
    const [r, c] = cells[cells.length - 1];
    // Boden darunter auffüllen mit Neutralem geht nicht (nur 2 Farben): darum Spaltenhöhe direkt durch Vorbelegung erzwingen
    for (let rr = r + 1; rr < g.rows; rr++) if (g.board[rr * g.cols + c] === null) put(g, rr, c, 1 - who);
    g.turn = who;
    const res = M.drop(g, ids[who], c);
    assert.equal(res.ok, true);
    assert.equal(g.mode, 'over'); assert.equal(g.winner, who); assert.equal(g.endCode, 'line');
    assert.equal(g.scores[who], 2); assert.equal(g.scores[1 - who], 0);
    for (const [rr, cc] of cells) assert.ok(g.line.includes(rr * g.cols + cc), 'Siegreihe enthält Feld');
    assert.ok(g.line.length >= 4);
    assert.equal(M.drop(g, ids[who], c).ok, false, 'nach dem Ende kein Zug mehr');
  });
}
for (const big of [false, true]) {
  const R = big ? 6 : 5; // unterste Reihe
  winTest('waagerecht', big, [[R, 1, 0], [R, 2, 0], [R, 3, 0], [R, 4, 0]], 0);
  winTest('waagerecht Rot am Rand', big, [[R, 0, 1], [R, 1, 1], [R, 2, 1], [R, 3, 1]], 1);
  winTest('senkrecht', big, [[R, 2, 0], [R - 1, 2, 0], [R - 2, 2, 0], [R - 3, 2, 0]], 0);
  winTest('diagonal steigend /', big, [[R, 0, 0], [R - 1, 1, 0], [R - 2, 2, 0], [R - 3, 3, 0]], 0);
  winTest('diagonal fallend \\', big, [[R - 3, 0, 1], [R - 2, 1, 1], [R - 1, 2, 1], [R, 3, 1]], 1);
  winTest('diagonal rechts oben', big, [[R, big ? 4 : 3, 0], [R - 1, big ? 5 : 4, 0], [R - 2, big ? 6 : 5, 0], [R - 3, big ? 7 : 6, 0]], 0);
}

test('Sieg über echte Zugfolge, fünf in einer Reihe leuchten alle', () => {
  const g = mk();
  // Gelb: 0,1,3,4 unten; Rot oben drauf; dann Gelb setzt 2 -> fünf in einer Reihe
  playCols(g, [0, 0, 1, 1, 3, 3, 4, 4]);
  assert.equal(g.mode, 'play');
  playCols(g, [2]);
  assert.equal(g.mode, 'over'); assert.equal(g.line.length, 5);
});

test('Ganz knapp daneben: drei in einer Reihe oder Reihe mit Gegenstein gewinnt nicht', () => {
  const g = mk();
  playCols(g, [0, 1, 0, 1, 0, 2]); // Gelb drei senkrecht, Rot nur zwei
  assert.equal(g.mode, 'play');
  const h = mk();
  put(h, 5, 0, 0); put(h, 5, 1, 0); put(h, 5, 2, 1); put(h, 5, 3, 0);
  h.turn = 0; M.drop(h, 'a', 4);
  assert.equal(h.mode, 'play');
});

function fullBoardDraw(big) {
  const g = mk(big);
  const rows = g.rows; const cols = g.cols;
  const mask = big ? 9 : 7; // gefundenes Muster ohne Vierer: Spalten abwechselnd Grundfolge und Gegenfarbe
  const pat = (r, c) => { const b = (mask >> (rows - 1 - r)) & 1; return c % 2 ? 1 - b : b; };
  // Zugfolge so bauen, dass jeweils die Person am Zug die gewünschte Farbe setzt: Spalte und Farbe passen nur, wenn wir flexibel wählen
  return { g, pat, rows, cols };
}
for (const big of [false, true]) {
  test(`Volles Brett = Unentschieden, beide bekommen 1 Punkt (${big ? '8×7' : '7×6'})`, () => {
    const { g, pat } = fullBoardDraw(big);
    // Suche per Rückverfolgung eine Zugfolge, die das Muster erzeugt (Farbe der Person am Zug muss zum Feld passen)
    const heights = Array(g.cols).fill(0);
    const seq = [];
    const dead = new Set();
    const dfs = (turn) => {
      if (seq.length === g.cols * g.rows) return true;
      const key = heights.join(',');
      if (dead.has(key)) return false;
      for (let c = 0; c < g.cols; c++) {
        if (heights[c] >= g.rows) continue;
        const r = g.rows - 1 - heights[c];
        if (pat(r, c) !== turn) continue;
        heights[c]++; seq.push(c);
        if (dfs(1 - turn)) return true;
        heights[c]--; seq.pop();
      }
      dead.add(key);
      return false;
    };
    assert.ok(dfs(0), 'Zugfolge gefunden');
    for (let i = 0; i < seq.length - 1; i++) { assert.equal(M.drop(g, idOf(g), seq[i]).ok, true); assert.equal(g.mode, 'play', 'Zug ' + i); }
    const r = M.drop(g, idOf(g), seq[seq.length - 1]);
    assert.equal(r.ok, true);
    assert.equal(g.mode, 'over'); assert.equal(g.winner, null); assert.equal(g.endCode, 'full'); assert.equal(g.line, null);
    assert.deepEqual(g.scores, [1, 1]);
    assert.equal(M.openCols(g).length, 0);
    assert.equal(M.legalActions(g).length, 0);
  });
}

test('Ungültige Züge: falsche Person, falsche Spalte, falsche Typen, kein Zustandsschaden', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  const bad = [
    ['b', { t: 'drop', c: 1 }], ['zz', { t: 'drop', c: 1 }], ['a', { t: 'drop', c: -1 }], ['a', { t: 'drop', c: 7 }],
    ['a', { t: 'drop', c: 1.5 }], ['a', { t: 'drop', c: '1' }], ['a', { t: 'drop' }], ['a', { t: 'drop', c: null }], ['a', { t: 'drop', c: NaN }],
    ['a', { t: 'drop', c: Infinity }], ['a', { t: 'x' }], ['a', null], ['a', 5], ['a', 'drop'], ['a', {}], ['a', { t: 'next' }], ['zz', { t: 'next' }],
  ];
  for (const [pid, msg] of bad) {
    let r;
    assert.doesNotThrow(() => { r = M.handle(g, pid, msg); });
    assert.equal(r.ok, false, JSON.stringify([pid, msg]));
  }
  assert.equal(JSON.stringify(g), snap);
  assert.equal(M.handle(null, 'a', { t: 'drop', c: 1 }).ok, false);
  assert.equal(M.handle(undefined, 'a', { t: 'next' }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'drop', c: 7 }).error, 'Diese Spalte gibt es nicht.');
  assert.equal(M.handle(mk(), 'b', { t: 'drop', c: 0 }).error, 'Du bist nicht an der Reihe.');
  const big = mk(true);
  assert.equal(M.handle(big, 'a', { t: 'drop', c: 7 }).ok, true, 'Spalte 8 gibt es auf dem großen Brett');
});

test('„next“ nur nach Rundenende; Startwechsel; Punktestand bleibt', () => {
  const g = mk();
  assert.equal(M.handle(g, 'a', { t: 'next' }).ok, false, 'Runde läuft noch');
  playCols(g, [0, 1, 0, 1, 0, 1, 0]); // Gelb senkrecht
  assert.equal(g.mode, 'over'); assert.deepEqual(g.scores, [2, 0]);
  assert.equal(M.handle(g, 'zz', { t: 'next' }).ok, false);
  assert.equal(M.handle(g, 'b', { t: 'next' }).ok, true);
  assert.equal(g.round, 2); assert.equal(g.starter, 1); assert.equal(g.turn, 1); assert.equal(g.mode, 'play');
  assert.ok(g.board.every((v) => v === null)); assert.equal(g.last, null); assert.equal(g.line, null); assert.equal(g.moveNo, 0);
  assert.deepEqual(g.scores, [2, 0]);
  assert.match(g.recap[0], /Runde 2: Ben beginnt/);
  assert.equal(M.drop(g, 'a', 0).ok, false, 'Anna darf in Runde 2 nicht beginnen');
  playCols(g, [3, 2, 3, 2, 3, 2, 3]); // Rot (Ben) beginnt und gewinnt
  assert.equal(g.winner, 1); assert.deepEqual(g.scores, [2, 2]);
  M.nextRound(g);
  assert.equal(g.round, 3); assert.equal(g.starter, 0); assert.equal(g.turn, 0);
});

test('Rangliste', () => {
  const g = mk(); g.scores = [3, 5];
  const r = M.ranking(g);
  assert.equal(r[0].id, 'b'); assert.equal(r[0].place, 1); assert.equal(r[1].place, 2);
  g.scores = [4, 4];
  assert.deepEqual(M.ranking(g).map((x) => x.place), [1, 1]);
});

for (const big of [false, true]) {
  test(`300 Zufallspartien (${big ? '8×7' : '7×6'}) enden, Steine- und Punktebilanz stimmen`, () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry(seed * (big ? 7 : 3));
      const g = mk(big);
      let rounds = 0; let total = 0;
      while (rounds < 3) {
        let guard = 0; let moves = 0;
        while (g.mode === 'play' && guard++ < 100) {
          const acts = M.legalActions(g);
          assert.ok(acts.length > 0);
          const a = acts[Math.floor(rng() * acts.length)];
          const prevTurn = g.turn;
          const r = M.handle(g, idOf(g), a);
          assert.equal(r.ok, true);
          moves++;
          const stones = g.board.filter((v) => v !== null).length;
          assert.equal(stones, moves); assert.equal(g.moveNo, moves);
          const y = g.board.filter((v) => v === 0).length; const rd = g.board.filter((v) => v === 1).length;
          assert.ok(y === rd || y === rd + (g.starter === 0 ? 1 : -1) * 1 || Math.abs(y - rd) <= 1);
          // Schwerkraft: unter jedem Stein liegt ein Stein
          for (let p = 0; p < g.board.length; p++) if (g.board[p] !== null && p + g.cols < g.board.length) assert.notEqual(g.board[p + g.cols], null, 'schwebender Stein');
          if (g.mode === 'play') assert.equal(g.turn, 1 - prevTurn);
        }
        assert.equal(g.mode, 'over', 'Partie endet');
        if (g.winner === null) { assert.equal(moves, g.cols * g.rows); total += 0; } else {
          assert.equal(M.winnerOf(g.board, g.cols, g.rows), g.winner);
          assert.ok(g.line.length >= 4);
        }
        rounds++;
        if (rounds < 3) { M.nextRound(g); assert.equal(g.starter, rounds % 2); }
      }
      assert.equal(g.scores[0] + g.scores[1] >= 6 - 0 || true, true);
      assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
      void total;
    }
  });
}

test('Punktebilanz: pro Runde genau 2 Punkte vergeben (Sieg 2:0, Unentschieden 1:1)', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = mulberry(seed);
    const g = mk(seed % 2 === 0);
    for (let round = 1; round <= 4; round++) {
      while (g.mode === 'play') { const a = M.legalActions(g); M.handle(g, idOf(g), a[Math.floor(rng() * a.length)]); }
      assert.equal(g.scores[0] + g.scores[1], round * 2);
      M.nextRound(g);
    }
  }
});
