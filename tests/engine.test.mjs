import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';

const seq = (...vals) => { let i = 0; return () => (vals[i++ % vals.length] - 1) / 6 + 0.01; };
const mk = (n = 2) => E.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));

test('Punkte-Tabelle & Wertung', () => {
  const g = mk();
  const p = g.players[0];
  for (let i = 0; i < 4; i++) p.rows.red.marks[i] = true;
  for (let i = 0; i < 8; i++) p.rows.blue.marks[i] = true;
  p.penalties = 2;
  const s = E.scoreOf(p);
  assert.equal(s.perColor.red.points, 10);
  assert.equal(s.perColor.blue.points, 36);
  assert.equal(s.total, 46 - 10);
  p.rows.green.marks.fill(true); p.rows.green.lock = true;
  assert.equal(E.scoreOf(p).perColor.green.points, 78);
});

test('Richtung: rot aufsteigend, grün absteigend', () => {
  assert.equal(E.numberAt('red', 0), 2);
  assert.equal(E.numberAt('red', 10), 12);
  assert.equal(E.numberAt('green', 0), 12);
  assert.equal(E.numberAt('blue', 10), 2);
});

test('nur von links nach rechts, kein Zurück', () => {
  const g = mk();
  g.players[0].rows.red.marks[5] = true; // Zahl 7
  g.dice = { w1: 2, w2: 3, red: 1, yellow: 1, green: 1, blue: 1 }; // Summe 5
  g.phase = 'white';
  const m = E.legalMoves(g, 'p0', 'white');
  assert.ok(!m.some((x) => x.color === 'red')); // 5 liegt links von 7
  assert.ok(m.some((x) => x.color === 'yellow'));
  assert.ok(m.some((x) => x.color === 'green')); // 5 grün = idx 7
});

test('Sperren erst ab 5 Kreuzen; Schloss zählt als Kreuz', () => {
  const g = mk();
  g.dice = { w1: 6, w2: 6, red: 1, yellow: 1, green: 1, blue: 1 };
  assert.ok(!E.legalMoves(g, 'p0', 'white').some((m) => m.color === 'red'));
  for (let i = 0; i < 5; i++) g.players[0].rows.red.marks[i] = true;
  const mv = E.legalMoves(g, 'p0', 'white').find((m) => m.color === 'red');
  assert.ok(mv && mv.idx === 10);
  g.phase = 'white';
  g.picks = {};
  E.submit(g, 'p0', mv);
  E.submit(g, 'p1', null);
  assert.equal(E.crossCount(g.players[0].rows.red), 7);
  assert.equal(g.players[0].rows.red.lock, true);
});

test('Ablauf: Fehlwurf, wenn der aktive Spieler nichts ankreuzt', () => {
  const g = mk();
  E.roll(g, 'p0', seq(1, 1, 1, 1, 1, 1)); // Summe 2 -> rot 2 möglich, grün/blau 2 nicht (Ende, <5)
  assert.equal(g.phase, 'white');
  E.submit(g, 'p0', null);
  E.submit(g, 'p1', null);
  // Schritt 2: weiß 1 + farbig 1 = 2 -> rot/gelb 2 möglich, aktiver passt
  assert.equal(g.phase, 'color');
  E.submit(g, 'p0', null);
  assert.equal(g.players[0].penalties, 1);
  assert.equal(g.phase, 'roll');
  assert.equal(g.active, 1);
});

test('Passive Spieler dürfen nur Schritt 1; falscher Spieler kann nicht würfeln', () => {
  const g = mk();
  assert.equal(E.roll(g, 'p1').ok, false);
  E.roll(g, 'p0', seq(3, 4, 1, 1, 1, 1));
  E.submit(g, 'p0', { color: 'red', idx: 5 });
  E.submit(g, 'p1', { color: 'yellow', idx: 5 });
  assert.equal(g.phase, 'color');
  assert.equal(E.submit(g, 'p1', null).ok, false);
});

test('Illegale Züge werden abgelehnt', () => {
  const g = mk();
  E.roll(g, 'p0', seq(3, 4, 1, 1, 1, 1));
  assert.equal(E.submit(g, 'p0', { color: 'red', idx: 0 }).ok, false);
});

test('Gleichzeitiges Sperren im selben Schritt: beide bekommen das Schloss', () => {
  const g = mk();
  for (const p of g.players) for (let i = 0; i < 5; i++) p.rows.red.marks[i] = true;
  E.roll(g, 'p0', seq(6, 6, 1, 1, 1, 1)); // 12
  E.submit(g, 'p0', { color: 'red', idx: 10 });
  E.submit(g, 'p1', { color: 'red', idx: 10 });
  assert.ok(g.players[0].rows.red.lock && g.players[1].rows.red.lock);
  assert.equal(g.closed.red, true);
});

test('Zwei gesperrte Reihen beenden das Spiel sofort', () => {
  const g = mk();
  for (const c of ['red', 'yellow']) for (let i = 0; i < 5; i++) g.players[0].rows[c].marks[i] = true;
  g.closed.red = true;
  E.roll(g, 'p0', seq(6, 6, 1, 1, 1, 1));
  assert.equal(E.legalMoves(g, 'p0').some((m) => m.color === 'red'), false);
  E.submit(g, 'p0', { color: 'yellow', idx: 10 });
  E.submit(g, 'p1', null);
  assert.equal(g.phase, 'over');
  assert.ok(g.endReason);
});

test('Vierter Fehlwurf beendet das Spiel; gesperrte Würfel entfallen', () => {
  const g = mk();
  g.players[0].penalties = 3;
  g.closed.green = true;
  E.roll(g, 'p0', seq(1, 1, 1, 1, 1, 1));
  assert.equal(g.dice.green, null);
  E.submit(g, 'p0', null); E.submit(g, 'p1', null); E.submit(g, 'p0', null);
  assert.equal(g.phase, 'over');
});

test('Zufallspartien laufen immer sauber zu Ende', () => {
  for (let n = 0; n < 300; n++) {
    const g = mk(2 + (n % 4));
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 2000) {
      if (g.phase === 'roll') { assert.ok(E.roll(g, g.players[g.active].id).ok); continue; }
      for (const id of E.waitingFor(g)) {
        const moves = E.legalMoves(g, id);
        const pick = moves.length && Math.random() < 0.7 ? moves[Math.floor(Math.random() * moves.length)] : null;
        assert.ok(E.submit(g, id, pick).ok);
      }
    }
    assert.equal(g.phase, 'over');
    for (const p of g.players) for (const c of E.COLORS) {
      const m = p.rows[c].marks; const idxs = m.map((v, i) => v && i).filter((v) => v !== false);
      assert.deepEqual(idxs, [...idxs].sort((a, b) => a - b));
      if (p.rows[c].lock) assert.ok(E.markCount(p.rows[c]) >= 6);
    }
    assert.ok(E.ranking(g).length === g.players.length);
  }
});
