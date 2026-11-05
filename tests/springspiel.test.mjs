import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../springspiel/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = [{ id: 'p0', name: 'Du' }];
const mk = (shape) => E.createGame(P, shape);
const snap = (g) => JSON.stringify(g);
const at = (r, c) => E.idx(r, c);

test('Brettgeometrie: 33 bzw. 37 Löcher, Ecken fehlen', () => {
  assert.equal(E.holeCount('eng'), 33);
  assert.equal(E.holeCount('fra'), 37);
  for (const [r, c] of [[0, 0], [0, 1], [1, 0], [6, 6], [5, 6], [0, 5], [6, 0]]) assert.equal(E.isHole('eng', r, c), false, `eng ${r},${c}`);
  for (const [r, c] of [[0, 2], [0, 4], [2, 0], [3, 3], [6, 4], [4, 6]]) assert.equal(E.isHole('eng', r, c), true);
  for (const [r, c] of [[1, 1], [1, 5], [5, 1], [5, 5]]) { assert.equal(E.isHole('eng', r, c), false); assert.equal(E.isHole('fra', r, c), true); }
  for (const [r, c] of [[0, 0], [0, 1], [1, 0], [6, 6], [0, 6]]) assert.equal(E.isHole('fra', r, c), false);
  assert.equal(E.isHole('eng', -1, 3), false);
  assert.equal(E.isHole('eng', 3, 7), false);
});

test('Brett ist symmetrisch (Spiegelung und Drehung)', () => {
  for (const sh of E.SHAPES) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const h = E.isHole(sh, r, c);
      assert.equal(E.isHole(sh, c, r), h);
      assert.equal(E.isHole(sh, 6 - r, c), h);
      assert.equal(E.isHole(sh, r, 6 - c), h);
    }
  }
});

test('Anfangsstellung: alle Löcher belegt außer der Mitte', () => {
  for (const [sh, n] of [['eng', 33], ['fra', 37]]) {
    const g = mk(sh);
    assert.equal(g.mode, 'play');
    assert.equal(g.shape, sh);
    assert.equal(E.stonesLeft(g), n - 1);
    assert.equal(g.board[E.CENTER], 0);
    assert.equal(g.board.length, 49);
    assert.equal(g.board.filter((v) => v === -1).length, 49 - n);
    assert.deepEqual(g.moves, []);
    assert.equal(E.CENTER, at(3, 3));
  }
});

test('Unbekannte Form wird zu englisch; leere Spielerliste hat Ersatz', () => {
  assert.equal(E.createGame(P, 'quatsch').shape, 'eng');
  assert.equal(E.createGame([], 'fra').players.length, 1);
  assert.equal(E.createGame(undefined).players.length, 1);
});

test('Genau 4 Anfangszüge (englisch und französisch)', () => {
  for (const sh of E.SHAPES) {
    const g = mk(sh);
    const ms = E.allMoves(g);
    assert.equal(ms.length, 4, sh);
    assert.deepEqual(ms.map((m) => m.to), [24, 24, 24, 24]);
    assert.deepEqual(ms.map((m) => m.from).sort((a, b) => a - b), [10, 22, 26, 38]);
    assert.deepEqual(E.movableStones(g), [10, 22, 26, 38]);
    assert.deepEqual(E.targetsFrom(g, 38), [24]);
    assert.deepEqual(E.targetsFrom(g, 24), []);
  }
});

test('Zugausführung: Stein springt, übersprungener wird entfernt', () => {
  const g = mk();
  const r = E.move(g, 'p0', 38, 24);
  assert.deepEqual(r, { ok: true });
  assert.equal(g.board[38], 0);
  assert.equal(g.board[31], 0);
  assert.equal(g.board[24], 1);
  assert.equal(E.stonesLeft(g), 31);
  assert.deepEqual(E.lastMove(g), [38, 31, 24]);
  assert.equal(E.moveCount(g), 1);
});

test('Keine diagonalen Sprünge, keine Sprünge über Lücken, nicht zu weit', () => {
  const g = mk();
  const before = snap(g);
  for (const [f, t] of [[at(2, 2), at(3, 3)], [at(5, 3), at(3, 5)], [at(1, 3), at(4, 3)], [at(5, 3), at(2, 3)], [at(5, 3), at(5, 3)], [at(4, 3), at(2, 3)]]) {
    const r = E.move(g, 'p0', f, t);
    assert.equal(r.ok, false, `${f}->${t}`);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(snap(g), before);
  // Diagonale Konstellation: Stein bei (4,4) über (3,4)? nein, über (4,3)? Ziel (4,2) ist belegt
  assert.equal(E.movesFrom(g, at(4, 4)).length, 0);
});

test('Sprünge am Rand und über Nicht-Löcher sind unmöglich', () => {
  const g = mk();
  // Sprung aus dem Brett heraus
  assert.deepEqual(E.movesFrom(g, at(0, 2)), []);
  // Leere Felder und Nicht-Löcher haben keine Sprünge
  assert.deepEqual(E.movesFrom(g, E.CENTER), []);
  assert.deepEqual(E.movesFrom(g, 0), []);
  assert.deepEqual(E.movesFrom(g, -1), []);
  assert.deepEqual(E.movesFrom(g, 49), []);
  assert.deepEqual(E.movesFrom(g, 1.5), []);
  assert.deepEqual(E.movesFrom(g, 'x'), []);
  // Auf dem englischen Brett gibt es von (2,1) nach (2,-1) usw. nie einen Zug
  const h = mk();
  h.board.fill(-1);
  for (const [r, c] of [[2, 0], [2, 1], [2, 2]]) h.board[at(r, c)] = 1;
  h.board[at(2, 2)] = 0;
  assert.equal(E.movesFrom(h, at(2, 0)).length, 1);
  // Ziel außerhalb des Bretts (kein Loch = -1) zählt nicht als frei
  h.board[at(2, 2)] = -1;
  assert.equal(E.movesFrom(h, at(2, 0)).length, 0);
});

test('Ungültige Züge und Nachrichten ändern nie den Zustand', () => {
  const g = mk();
  const before = snap(g);
  const bad = [
    () => E.move(g, 'p0', 38, 23), () => E.move(g, 'p0', 'a', 24), () => E.move(g, 'p0', 38, null), () => E.move(g, 'p0', -1, 24),
    () => E.move(g, 'p0', 38, 99), () => E.move(g, 'p0', 38.5, 24), () => E.move(g, 'p0', NaN, 24), () => E.move(g, 'fremd', 38, 24),
    () => E.move(g, 'p0'), () => E.move(g, 'p0', 24, 38), () => E.move(g, 'p0', 0, 1), () => E.move(g, 'p0', {}, []),
    () => E.undo(g, 'p0'), () => E.undo(g, 'fremd'), () => E.restart(g, 'fremd'), () => E.restart(g, 'p0', 'rund'),
    () => E.handle(g, 'p0', null), () => E.handle(g, 'p0', undefined), () => E.handle(g, 'p0', 'move'), () => E.handle(g, 'p0', 5),
    () => E.handle(g, 'p0', []), () => E.handle(g, 'p0', {}), () => E.handle(g, 'p0', { t: 'quatsch' }), () => E.handle(g, 'p0', { t: 'move' }),
    () => E.handle(g, 'p0', { t: 'move', from: '38', to: '24' }), () => E.handle(g, 'p0', { t: 'shape', shape: 'x' }), () => E.handle(g, 'p0', { t: 'shape' }),
    () => E.handle(g, 'fremd', { t: 'move', from: 38, to: 24 }), () => E.handle(g, 'p0', { t: '__proto__' }), () => E.handle(g, 'p0', { t: 'constructor' }),
  ];
  for (const f of bad) {
    const r = f();
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 3);
    assert.equal(snap(g), before);
  }
  // kaputter Spielstand
  for (const broken of [null, undefined, {}, { board: [] }, { mode: 'play' }]) {
    assert.equal(E.move(broken, 'p0', 1, 2).ok, false);
    assert.equal(E.undo(broken, 'p0').ok, false);
    assert.equal(E.restart(broken, 'p0').ok, false);
    assert.equal(E.handle(broken, 'p0', { t: 'move', from: 1, to: 2 }).ok, false);
  }
});

test('Handle verteilt Nachrichten', () => {
  const g = mk();
  assert.equal(E.handle(g, 'p0', { t: 'move', from: 38, to: 24 }).ok, true);
  assert.equal(E.stonesLeft(g), 31);
  assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, true);
  assert.equal(E.stonesLeft(g), 32);
  assert.equal(E.handle(g, 'p0', { t: 'move', from: 38, to: 24 }).ok, true);
  assert.equal(E.handle(g, 'p0', { t: 'restart' }).ok, true);
  assert.equal(E.stonesLeft(g), 32);
  assert.equal(g.moves.length, 0);
  assert.equal(E.handle(g, 'p0', { t: 'shape', shape: 'fra' }).ok, true);
  assert.equal(g.shape, 'fra');
  assert.equal(E.stonesLeft(g), 36);
  assert.equal(E.handle(g, 'p0', { t: 'shape', shape: 'eng' }).ok, true);
  assert.equal(g.shape, 'eng');
  assert.equal(g.players[0].id, 'p0');
});

test('Rückgängig: beliebig oft, stellt den Zustand exakt wieder her', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seeded(seed);
    const g = mk(seed % 2 ? 'eng' : 'fra');
    const states = [snap(g)];
    let guard = 0;
    while (g.mode === 'play' && guard++ < 100) {
      const ms = E.allMoves(g);
      const m = ms[Math.floor(rng() * ms.length)];
      assert.equal(E.move(g, 'p0', m.from, m.to).ok, true);
      states.push(snap(g));
    }
    assert.equal(g.mode, 'over');
    // alles zurücknehmen
    for (let k = states.length - 2; k >= 0; k--) {
      assert.equal(E.undo(g, 'p0').ok, true);
      assert.equal(snap(g), states[k], `seed ${seed} Schritt ${k}`);
    }
    assert.equal(E.undo(g, 'p0').ok, false);
    assert.equal(snap(g), states[0]);
  }
});

test('Rückgängig nach Spielende setzt das Spiel fort', () => {
  const g = mk();
  const rng = seeded(5);
  while (g.mode === 'play') { const ms = E.allMoves(g); const m = ms[Math.floor(rng() * ms.length)]; E.move(g, 'p0', m.from, m.to); }
  assert.equal(E.allMoves(g).length, 0);
  assert.equal(E.move(g, 'p0', 0, 1).ok, false);
  assert.equal(E.undo(g, 'p0').ok, true);
  assert.equal(g.mode, 'play');
  assert.ok(E.allMoves(g).length >= 1);
});

test('Spielende erst, wenn kein Zug mehr möglich ist; danach keine Züge', () => {
  const g = mk();
  g.board.fill(-1);
  for (const [r, c] of [[3, 1], [3, 2], [3, 3]]) g.board[at(r, c)] = 1;
  g.board[at(3, 3)] = 0;
  g.board[at(6, 4)] = 1; // weit entfernter Stein, der nicht springen kann
  g.moves = [];
  assert.equal(g.mode, 'play');
  assert.equal(E.move(g, 'p0', at(3, 1), at(3, 3)).ok, true);
  // jetzt: Steine bei (3,3) und (6,4): kein Sprung mehr möglich
  assert.equal(g.mode, 'over');
  assert.equal(E.stonesLeft(g), 2);
  assert.equal(E.move(g, 'p0', at(3, 3), at(3, 5)).ok, false);
});

test('Zufallspartien enden immer (hunderte), Steinezahl stimmt mit Zügen überein', () => {
  const dist = {};
  for (let seed = 1; seed <= 600; seed++) {
    const rng = seeded(seed * 7919);
    const sh = seed % 3 === 0 ? 'fra' : 'eng';
    const g = mk(sh);
    const start = E.stonesLeft(g);
    let n = 0;
    while (g.mode === 'play') {
      const ms = E.allMoves(g);
      assert.ok(ms.length > 0, 'im Spiel muss ein Zug möglich sein');
      const m = ms[Math.floor(rng() * ms.length)];
      assert.equal(E.move(g, 'p0', m.from, m.to).ok, true);
      n++;
      assert.ok(n < 40, 'Partie zu lang');
      assert.equal(E.stonesLeft(g), start - n);
    }
    assert.equal(E.allMoves(g).length, 0);
    assert.ok(E.stonesLeft(g) >= 1);
    assert.equal(g.moves.length, n);
    // Steine bleiben nur auf Löchern
    g.board.forEach((v, i) => assert.equal(v === -1, !E.isHole(sh, E.rowOf(i), E.colOf(i))));
    dist[E.stonesLeft(g)] = (dist[E.stonesLeft(g)] || 0) + 1;
  }
  assert.ok(Object.keys(dist).length > 2);
});

test('JSON-Sicherheit: Spielstand übersteht Speichern und Laden', () => {
  const rng = seeded(11);
  const g = mk('fra');
  for (let k = 0; k < 10; k++) { const ms = E.allMoves(g); const m = ms[Math.floor(rng() * ms.length)]; E.move(g, 'p0', m.from, m.to); }
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.deepEqual(E.allMoves(copy), E.allMoves(g));
  assert.equal(E.undo(copy, 'p0').ok, true);
  assert.equal(E.undo(g, 'p0').ok, true);
  assert.deepEqual(copy, g);
  assert.ok(!JSON.stringify(g).includes('undefined'));
});

test('Neu anfangen und Formwechsel setzen alles zurück', () => {
  const g = mk('eng');
  E.move(g, 'p0', 38, 24);
  E.move(g, 'p0', ...(() => { const m = E.allMoves(g)[0]; return [m.from, m.to]; })());
  assert.equal(E.restart(g, 'p0').ok, true);
  assert.deepEqual(g, mk('eng'));
  E.move(g, 'p0', 38, 24);
  assert.equal(E.restart(g, 'p0', 'fra').ok, true);
  assert.deepEqual(g, mk('fra'));
  assert.equal(E.restart(g, 'p0', 'fra').ok, true);
  assert.deepEqual(g, mk('fra'));
});

test('Bewertung nach übrigen Steinen', () => {
  const mkG = (n, center) => {
    const g = mk();
    g.board.fill(0);
    for (let i = 0, k = 0; i < 49 && k < n; i++) { if (E.isHole('eng', E.rowOf(i), E.colOf(i)) && i !== E.CENTER) { g.board[i] = 1; k++; } }
    for (let i = 0; i < 49; i++) if (!E.isHole('eng', E.rowOf(i), E.colOf(i))) g.board[i] = -1;
    if (center) { g.board.forEach((v, i) => { if (v === 1) g.board[i] = 0; }); g.board[E.CENTER] = 1; }
    return g;
  };
  const exp = { 2: 'Sehr gut', 3: 'Gut', 4: 'Ordentlich', 5: 'Weiter üben', 6: 'Weiter üben', 7: 'Weiter üben', 8: 'Das geht noch besser', 20: 'Das geht noch besser' };
  for (const [n, t] of Object.entries(exp)) { const r = E.rating(mkG(Number(n))); assert.equal(r.title, t, n); assert.equal(r.stones, Number(n)); assert.ok(r.text.length > 5); }
  assert.equal(E.rating(mkG(1, true)).title, 'Großmeister');
  assert.equal(E.rating(mkG(1, true)).center, true);
  assert.equal(E.rating(mkG(1, false)).title, 'Meister');
  assert.equal(E.rating(mkG(1, false)).center, false);
});

test('Bestleistung: weniger Steine, bei Gleichstand die Mitte', () => {
  const b = E.better;
  assert.equal(b({ stones: 3, center: false }, null), true);
  assert.equal(b({ stones: 3, center: false }, { stones: 4, center: true }), true);
  assert.equal(b({ stones: 4, center: true }, { stones: 3, center: false }), false);
  assert.equal(b({ stones: 1, center: true }, { stones: 1, center: false }), true);
  assert.equal(b({ stones: 1, center: false }, { stones: 1, center: true }), false);
  assert.equal(b({ stones: 1, center: true }, { stones: 1, center: true }), false);
  assert.equal(b({ stones: 2, center: false }, { stones: 2, center: false }), false);
  assert.equal(b(null, { stones: 2, center: false }), false);
  assert.equal(b({ stones: 'x' }, null), false);
  assert.equal(b({ stones: 2 }, { stones: 'kaputt' }), true);
});

test('Löser: bekannte Lösung des englischen Brettes (31 Züge, ein Stein in der Mitte)', () => {
  const g = mk('eng');
  const dead = new Set();
  const t0 = Date.now();
  const dfs = () => {
    if (Date.now() - t0 > 30000) throw new Error('Zeitüberschreitung');
    if (E.stonesLeft(g) === 1) return g.board[E.CENTER] === 1;
    const k = g.board.join('');
    if (dead.has(k)) return false;
    for (const m of E.allMoves(g)) {
      assert.equal(E.move(g, 'p0', m.from, m.to).ok, true);
      if (dfs()) return true;
      assert.equal(E.undo(g, 'p0').ok, true);
    }
    dead.add(k);
    return false;
  };
  assert.equal(dfs(), true);
  assert.equal(g.moves.length, 31);
  assert.equal(g.mode, 'over');
  assert.equal(E.rating(g).title, 'Großmeister');
  // Lösung unabhängig nachspielen
  const sol = JSON.parse(JSON.stringify(g.moves));
  const h = mk('eng');
  for (const [f, o, t] of sol) {
    const m = E.movesFrom(h, f).find((x) => x.to === t);
    assert.ok(m && m.over === o);
    assert.equal(E.move(h, 'p0', f, t).ok, true);
  }
  assert.deepEqual(h.board, g.board);
});

test('Französisches Brett: Zufallsspiele und Zugzahl-Parität (36 Steine start)', () => {
  const g = mk('fra');
  assert.equal(E.stonesLeft(g), 36);
  assert.equal(E.holeCount('fra') - 1, 36);
});
