import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../dame/engine.js';

const mk = () => D.createGame([{ id: 'w', name: 'Anna' }, { id: 'b', name: 'Bernd' }]);
const sq = D.sq;
// Brett aus {'c3':'w', 'd4':'B' …}: w/W weiß Stein/Dame, b/B schwarz Stein/Dame
const CODE = { w: 1, W: 2, b: 3, B: 4 };
function setup(pieces, turn = 0) {
  const g = mk();
  g.board = Array(64).fill(0);
  for (const [k, v] of Object.entries(pieces)) g.board[sq(k)] = CODE[v];
  g.turn = turn;
  g.history = {};
  return g;
}
const paths = (g) => D.legalMoves(g).map((m) => m.path.map(D.sqName).join('-')).sort();
const play = (g, ...names) => {
  const pid = g.turn === 0 ? 'w' : 'b';
  return D.move(g, pid, names.map(sq));
};

test('Namensfunktionen und dunkle Felder', () => {
  assert.equal(D.sqName(sq('a1')), 'a1');
  assert.equal(D.sqName(sq('h8')), 'h8');
  assert.ok(D.isDark(sq('a1')));
  assert.ok(D.isDark(sq('h8')));
  assert.ok(!D.isDark(sq('a2')));
});

test('Ausgangsstellung: 12 Steine je Seite, nur dunkle Felder, Weiß unten', () => {
  const g = mk();
  assert.equal(D.countPieces(g.board, 0), 12);
  assert.equal(D.countPieces(g.board, 1), 12);
  g.board.forEach((p, i) => { if (p) assert.ok(D.isDark(i)); });
  assert.equal(g.board[sq('a1')], 1);
  assert.equal(g.board[sq('b8')], 3);
  assert.equal(g.turn, 0);
  assert.equal(D.legalMoves(g).length, 7);
});

test('createGame verlangt genau 2 Personen', () => {
  assert.throws(() => D.createGame([{ id: 'a', name: 'A' }]));
  assert.throws(() => D.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]));
});

test('Normaler Stein zieht nur vorwärts, ein Feld diagonal', () => {
  const g = setup({ d4: 'w', h8: 'b' });
  assert.deepEqual(paths(g), ['d4-c5', 'd4-e5']);
  const h = setup({ d5: 'b', a1: 'w' }, 1);
  assert.deepEqual(paths(h), ['d5-c4', 'd5-e4']);
});

test('Stein am Rand und blockierte Felder', () => {
  const g = setup({ a1: 'w', b2: 'w', h8: 'b' });
  assert.deepEqual(paths(g), ['b2-a3', 'b2-c3']);
  const e = setup({ a3: 'w', b4: 'w', h8: 'b' });
  assert.deepEqual(paths(e).filter((p) => p.startsWith('a3')), []);
});

test('Stein schlägt vorwärts und rückwärts', () => {
  const f = setup({ d4: 'w', e5: 'b', h8: 'b' });
  assert.deepEqual(paths(f), ['d4-f6']);
  const r = setup({ d4: 'w', e3: 'b', h8: 'b' });
  assert.deepEqual(paths(r), ['d4-f2']);
});

test('Schlagzwang: nur Schlagzüge sind erlaubt, Wahl zwischen mehreren', () => {
  const g = setup({ d4: 'w', e5: 'b', a1: 'w', c3: 'w', c5: 'b', h8: 'b' });
  assert.deepEqual(paths(g), ['d4-b6', 'd4-f6']);
  const r = play(g, 'a1', 'b2');
  assert.equal(r.ok, false);
  assert.ok(D.mustCapture(g));
});

test('Keine Pflicht zur größten Beute', () => {
  // d4 kann einen Stein schlagen (f6); a3 kann zweimal schlagen (a3-c5-e7)
  const g = setup({ d4: 'w', e5: 'b', a3: 'w', b4: 'b', d6: 'b', h8: 'b', g1: 'w' });
  const ps = paths(g);
  assert.ok(ps.includes('d4-f6'));
  assert.ok(ps.includes('a3-c5-e7'));
  assert.ok(D.move(g, 'w', [sq('d4'), sq('f6')]).ok);
  assert.equal(g.captured[0], 1);
});

test('Mehrfachsprung mit Richtungswechsel, muss zu Ende geführt werden', () => {
  const g = setup({ b2: 'w', c3: 'b', e5: 'b', e3: 'b', h8: 'b' });
  // b2 x c3 -> d4, dann x e5 -> f6 (vorwärts), oder x e3 -> f2 (rückwärts)
  assert.deepEqual(paths(g), ['b2-d4-f2', 'b2-d4-f6']);
  assert.equal(D.move(g, 'w', [sq('b2'), sq('d4')]).ok, false, 'Teilzug ist ungültig');
  assert.deepEqual(g.board, setup({ b2: 'w', c3: 'b', e5: 'b', e3: 'b', h8: 'b' }).board, 'Zustand unverändert');
  assert.ok(D.move(g, 'w', [sq('b2'), sq('d4'), sq('f6')]).ok);
  assert.equal(g.board[sq('c3')], 0);
  assert.equal(g.board[sq('e5')], 0);
  assert.equal(g.board[sq('e3')], 3, 'nicht geschlagener Stein bleibt');
  assert.equal(g.captured[0], 2);
  assert.equal(g.board[sq('f6')], 1);
});

test('Derselbe Stein darf im Zug nicht zweimal übersprungen werden (Kreis)', () => {
  // Quadrat von vier schwarzen Steinen: Stein dreht eine Runde, ohne zu enden in Endlosschleife
  const g = setup({ c3: 'w', d4: 'b', f4: 'b', f6: 'b', d6: 'b', a8: 'b' });
  // c3 x d4 -> e5 ; e5 x f4 -> g3 | e5 x f6 -> g7 | e5 x d6 -> c7
  const ms = D.legalMoves(g);
  for (const m of ms) assert.equal(new Set(m.caps).size, m.caps.length, 'keine doppelten Sprünge');
  assert.ok(ms.length > 0);
  // Maximal 4 Steine
  assert.ok(ms.every((m) => m.caps.length <= 4));
});

test('Geschlagene Steine bleiben bis Zugende liegen und blockieren', () => {
  // w b2 schlägt c3 -> d4; zurück über c3 nicht möglich (c3 liegt noch dort, wäre doppeltes Überspringen)
  const g = setup({ b2: 'w', c3: 'b', h8: 'b' });
  assert.deepEqual(paths(g), ['b2-d4']);
  // Blockade: Landefeld hinter dem geschlagenen Stein ist von einem noch liegenden geschlagenen Stein besetzt
  const h = setup({ a1: 'w', b2: 'b', d4: 'b', c3: 'b', h8: 'b' });
  assert.deepEqual(paths(h), []);
});

test('Liegender geschlagener Stein blockiert den Weg einer Dame', () => {
  // Dame d1 schlägt d3? nein – diagonal: Dame a1 x c3? Aufbau: W a1, b b2, dann Landefeld c3 ; von c3 zurück entlang derselben Diagonale ist b2 blockiert
  const g = setup({ a1: 'W', b2: 'b', c3: 'b' });
  assert.deepEqual(paths(g), []); // b2 hat dahinter c3 besetzt -> kein Schlag
  const h = setup({ a1: 'W', b2: 'b', e5: 'b', f4: 'b', h8: 'b' });
  // a1 x b2 -> c3 oder d4 ; von d4: x e5 -> f6/g7 ; von c3/d4: …
  for (const m of D.legalMoves(h)) assert.equal(new Set(m.caps).size, m.caps.length);
});

test('Dame springt nicht zurück über den eben geschlagenen Stein (Stein liegt noch)', () => {
  const g = setup({ d1: 'W', e2: 'b', b8: 'b' });
  assert.deepEqual(paths(g).filter((p) => p.startsWith('d1')), ['d1-f3', 'd1-g4', 'd1-h5']);
  // mit einem zweiten Stein: Weiterschlagen nur dorthin, wo es wirklich geht, und jeder Stein höchstens einmal
  const h = setup({ d1: 'W', e2: 'b', g2: 'b', b8: 'b' });
  const ms = D.legalMoves(h).filter((m) => m.from === sq('d1'));
  assert.ok(ms.length > 0);
  for (const m of ms) assert.equal(new Set(m.caps).size, m.caps.length);
  assert.ok(ms.every((m) => m.caps.length === 2), 'nur Landefelder mit Fortsetzung (f3 x g2 -> h1)');
  assert.deepEqual(ms.map((m) => m.path.map(D.sqName).join('-')), ['d1-f3-h1']);
});

test('Dame fliegt beliebig weit in alle Richtungen', () => {
  const g = setup({ d4: 'W', h8: 'b' });
  const ps = paths(g);
  assert.ok(ps.includes('d4-a1') && ps.includes('d4-g7') && ps.includes('d4-a7') && ps.includes('d4-g1'));
  // d4: nach a1 (3), nach g7 (3; h8 ist besetzt), nach a7 (3), nach g1 (3)
  assert.equal(ps.filter((p) => p.startsWith('d4')).length, 12);
});

test('Dame wird von eigenem Stein blockiert', () => {
  const g = setup({ d4: 'W', f6: 'w', h8: 'b' });
  const ps = paths(g).filter((p) => p.startsWith('d4-'));
  assert.ok(ps.includes('d4-e5'));
  assert.ok(!ps.includes('d4-f6') && !ps.includes('d4-g7'));
});

test('Fliegende Dame schlägt aus der Entfernung und landet auf jedem freien Feld dahinter', () => {
  const g = setup({ a1: 'W', e5: 'b', h8: 'b', a7: 'b' });
  const ps = paths(g).filter((p) => p.startsWith('a1-'));
  assert.deepEqual(ps, ['a1-f6', 'a1-g7']);
});

test('Dame darf nicht über zwei Steine hintereinander schlagen', () => {
  const g = setup({ a1: 'W', c3: 'b', d4: 'b', h8: 'b' });
  assert.ok(!D.mustCapture(g));
  assert.deepEqual(paths(g).filter((p) => p.startsWith('a1')), ['a1-b2']);
  const h = setup({ a1: 'W', b2: 'w', d4: 'b', h8: 'b' });
  assert.ok(!D.mustCapture(h));
});

test('Dame darf eigene Steine nicht überspringen', () => {
  const g = setup({ a1: 'W', c3: 'w', e5: 'b', h8: 'b' });
  assert.ok(!D.legalMoves(g).some((m) => m.from === sq('a1') && m.caps.length));
});

test('Dame: Mehrfachsprung mit Richtungswechsel und Zwang zur Fortsetzung', () => {
  // W a1 schlägt c3 (Landung d4 oder e5 ...), von dort weiter e... Aufbau: schwarzer b c3, schwarzer d6 -> Landung e5? Landungen d4,e5,f6,g7; von e5 geht Schlag auf d6 -> c7
  const g = setup({ a1: 'W', b2: 'b', e3: 'b', h8: 'b' });
  // a1 x b2 -> c3 | d4 ; von d4: x e3 -> f2 (g1) ; von c3: x e... c3-d2? nein.
  const ms = D.legalMoves(g);
  assert.ok(ms.every((m) => m.caps.length === 2), 'nur Landefelder mit Fortsetzung sind erlaubt');
  assert.ok(ms.some((m) => m.path.map(D.sqName).join('-') === 'a1-d4-f2'));
  assert.ok(ms.some((m) => m.path.map(D.sqName).join('-') === 'a1-d4-g1'));
  assert.ok(!ms.some((m) => m.path.map(D.sqName).join('-') === 'a1-c3'));
});

test('Dame: ohne Fortsetzungsmöglichkeit darf auf jedem Feld dahinter gelandet werden', () => {
  const g = setup({ a1: 'W', b2: 'b', h2: 'b' });
  assert.deepEqual(paths(g), ['a1-c3', 'a1-d4', 'a1-e5', 'a1-f6', 'a1-g7', 'a1-h8']);
});

test('Umwandlung: Stein erreicht letzte Reihe und wird Dame', () => {
  const g = setup({ b7: 'w', h8: 'b', a1: 'b' });
  assert.ok(play(g, 'b7', 'a8').ok);
  assert.equal(g.board[sq('a8')], 2);
  assert.ok(g.last.promoted);
  const h = setup({ c2: 'b', h1: 'w', a8: 'w' }, 1);
  assert.ok(D.move(h, 'b', [sq('c2'), sq('b1')]).ok);
  assert.equal(h.board[sq('b1')], 4);
});

test('Umwandlung mitten im Mehrfachsprung: Stein springt als Stein weiter (rückwärts) und wird am Ende ggf. nicht Dame', () => {
  // w c5 x d6 -> e7 ; x f8? nein. Aufbau: w c5, b d6, b f6?? e7 x f6 -> g5 (rückwärts) : Zug endet auf g5, keine Umwandlung.
  const g = setup({ c5: 'w', d6: 'b', f6: 'b', a1: 'b', h2: 'w' });
  const ms = paths(g);
  assert.deepEqual(ms, ['c5-e7-g5']);
  assert.ok(D.move(g, 'w', [sq('c5'), sq('e7'), sq('g5')]).ok);
  assert.equal(g.board[sq('g5')], 1, 'bleibt Stein');
});

test('Umwandlung: Zug endet auf letzter Reihe, wenn als Stein nicht weitergeschlagen werden kann', () => {
  // w c5 x d6 -> e7 ; auf e7 als Stein: nichts mehr zu schlagen. Als Dame ginge x auf g5-Diagonale: g5 b ... h4 frei
  const g = setup({ c6: 'w', d7: 'b', f6: 'b', g5: 'b', a1: 'b' });
  // c6 x d7 -> e8 (letzte Reihe). Als Dame könnte e8 x f7? nicht; wir testen: Stein endet dort, wird Dame, Zug endet
  const ms = D.legalMoves(g);
  assert.deepEqual(ms.map((m) => m.path.map(D.sqName).join('-')), ['c6-e8']);
  D.move(g, 'w', [sq('c6'), sq('e8')]);
  assert.equal(g.board[sq('e8')], 2);
  assert.equal(g.turn, 1, 'Zug beendet');
});

test('Umwandlung: kein Weiterschlagen als Dame im selben Zug', () => {
  // w c6 x d7 -> e8 ; als Dame stünde auf e8 ein Schlag von f7?? Aufbau: schwarzer Stein auf g6 mit h5 frei: Diagonale e8-f7-g6-h5.
  const g = setup({ c6: 'w', d7: 'b', g6: 'b', a1: 'b' });
  const ms = D.legalMoves(g);
  assert.deepEqual(ms.map((m) => m.path.map(D.sqName).join('-')), ['c6-e8']);
});

test('Schwarz wandelt in Reihe 1 um', () => {
  const g = setup({ c2: 'b', a8: 'w', h8: 'w' }, 1);
  assert.ok(D.move(g, 'b', [sq('c2'), sq('d1')]).ok);
  assert.equal(g.board[sq('d1')], 4);
});

test('Nur wer am Zug ist darf ziehen; Fremde dürfen nicht', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  assert.equal(D.move(g, 'b', [sq('b6'), sq('a5')]).ok, false);
  assert.equal(D.move(g, 'x', [sq('a3'), sq('b4')]).ok, false);
  assert.equal(JSON.stringify(g), snap);
  assert.ok(D.move(g, 'w', [sq('a3'), sq('b4')]).ok);
  assert.equal(g.turn, 1);
});

test('Ungültige Nachrichten beschädigen den Zustand nie', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  const bad = [
    null, undefined, 5, 'x', {}, { t: 'zzz' }, { t: 'move' }, { t: 'move', path: 'ab' }, { t: 'move', path: [1] },
    { t: 'move', path: [1, 2] }, { t: 'move', path: [40, 33.5] }, { t: 'move', path: [-1, 5] }, { t: 'move', path: [40, 999] },
    { t: 'move', path: [sq('a3'), sq('a3')] }, { t: 'move', path: [sq('a3'), sq('c5')] }, { t: 'move', path: [sq('b6'), sq('a5')] },
    { t: 'move', path: [sq('a3'), sq('b4'), sq('c5')] }, { t: 'move', path: [null, undefined] }, { t: 'move', path: Array(100).fill(1) },
    { t: 'draw-accept' }, { t: 'draw-decline' }, { t: 'draw-cancel' },
  ];
  for (const m of bad) {
    const r = D.handle(g, 'w', m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.ok(typeof r.error === 'string');
  }
  assert.equal(JSON.stringify(g), snap);
});

test('Rückwärtszug eines normalen Steins ist verboten', () => {
  const g = setup({ d4: 'w', h8: 'b' });
  assert.equal(D.move(g, 'w', [sq('d4'), sq('c3')]).ok, false);
});

test('Sieg durch Schlagen aller Steine', () => {
  const g = setup({ d4: 'w', e5: 'b', a1: 'w' });
  assert.ok(D.move(g, 'w', [sq('d4'), sq('f6')]).ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.match(g.endReason, /geschlagen/);
  assert.equal(D.move(g, 'b', [sq('a1'), sq('b2')]).ok, false);
});

test('Sieg durch Blockade', () => {
  // Schwarzer Stein a8-Ecke? Schwarz b8 mit c7 besetzt (nicht schlagbar, da d6 besetzt)
  const g = setup({ a1: 'w', c7: 'w', d6: 'w', b8: 'b', a7: 'w' }, 0);
  // Schwarz b8: a7 (weiß) hinter a7 ist außerhalb; c7 hinter d6 besetzt -> blockiert. Weiß zieht irgendwas
  assert.ok(D.move(g, 'w', [sq('a1'), sq('b2')]).ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.match(g.endReason, /blockiert/);
});

test('Aufgeben: Gegenüber gewinnt, auch außerhalb des eigenen Zugs', () => {
  const g = mk();
  assert.ok(D.handle(g, 'b', { t: 'resign' }).ok);
  assert.equal(g.winner, 0);
  assert.match(g.endReason, /aufgegeben/);
  assert.equal(D.handle(g, 'w', { t: 'resign' }).ok, false);
});

test('Remis anbieten: annehmen', () => {
  const g = mk();
  assert.ok(D.handle(g, 'w', { t: 'draw-offer' }).ok);
  assert.equal(g.drawOffer, 0);
  assert.equal(D.handle(g, 'b', { t: 'draw-offer' }).ok, false);
  assert.equal(D.handle(g, 'w', { t: 'draw-accept' }).ok, false, 'eigenes Angebot nicht annehmbar');
  assert.ok(D.handle(g, 'b', { t: 'draw-accept' }).ok);
  assert.equal(g.winner, 'draw');
  assert.equal(g.mode, 'over');
});

test('Remis anbieten: ablehnen, danach erst nach einer Runde wieder', () => {
  const g = mk();
  D.handle(g, 'w', { t: 'draw-offer' });
  assert.ok(D.handle(g, 'b', { t: 'draw-decline' }).ok);
  assert.equal(g.drawOffer, null);
  assert.equal(D.handle(g, 'w', { t: 'draw-offer' }).ok, false);
  play(g, 'a3', 'b4');
  play(g, 'b6', 'a5');
  assert.ok(D.handle(g, 'w', { t: 'draw-offer' }).ok);
});

test('Remis-Angebot: Zug der angefragten Person lehnt es ab; Angebot zurückziehen', () => {
  const g = mk();
  D.handle(g, 'b', { t: 'draw-offer' });
  play(g, 'a3', 'b4'); // Weiß (angefragt) zieht -> Angebot gilt als abgelehnt
  assert.equal(g.drawOffer, null);
  assert.match(g.recap.join(' '), /nicht angenommen/);
  D.handle(g, 'w', { t: 'draw-offer' });
  assert.equal(g.drawOffer, 0);
  play(g, 'b6', 'a5'); // Schwarz zieht: Angebot von Weiß gilt als abgelehnt
  assert.equal(g.drawOffer, null);
  D.handle(g, 'b', { t: 'draw-offer' });
  assert.equal(D.handle(g, 'w', { t: 'draw-cancel' }).ok, false);
  assert.ok(D.handle(g, 'b', { t: 'draw-cancel' }).ok);
  assert.equal(g.drawOffer, null);
});

test('40-Züge-Regel gezielt (ohne Wiederholung)', () => {
  const g = setup({ a1: 'W', h8: 'B' });
  g.noProgress = 39;
  assert.ok(D.move(g, 'w', [sq('a1'), sq('b2')]).ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 'draw');
  assert.match(g.endReason, /40/);
});

test('Zug eines normalen Steins oder Schlagen setzt den 40er-Zähler zurück', () => {
  const g = setup({ a1: 'W', h8: 'B', c3: 'w' });
  g.noProgress = 30;
  D.move(g, 'w', [sq('c3'), sq('d4')]);
  assert.equal(g.noProgress, 0);
  const h = setup({ a1: 'W', h8: 'B', b4: 'b', c3: 'w' });
  h.noProgress = 30;
  D.move(h, 'w', [sq('c3'), sq('a5')]);
  assert.equal(h.noProgress, 0);
  const k = setup({ a1: 'W', h8: 'B', e5: 'b' });
  k.noProgress = 30;
  D.move(k, 'w', [sq('a1'), sq('f6')]);
  assert.equal(k.noProgress, 0);
});

test('Remis bei dreimal derselben Stellung mit demselben Spieler am Zug', () => {
  const g = setup({ a3: 'W', h6: 'B', b8: 'b', g1: 'w' });
  g.history = { [g.board.join('') + g.turn]: 1 };
  const seq = [['a3', 'b4'], ['h6', 'g5'], ['b4', 'a3'], ['g5', 'h6']];
  let rounds = 0;
  while (g.mode === 'normal' && rounds < 4) {
    for (const [a, b] of seq) {
      if (g.mode !== 'normal') break;
      assert.ok(play(g, a, b).ok);
    }
    rounds++;
  }
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 'draw');
  assert.match(g.endReason, /dritten Mal/);
  assert.equal(rounds, 2);
  assert.equal(g.moveNo, 8, 'Ausgangsstellung kommt nach 8 Zügen zum dritten Mal');
});

test('Rundgang: erste Züge und Schlagzwang in der Grundstellung', () => {
  const g = mk();
  for (const [a, b] of [['b6', 'a5']]) void [a, b];
  assert.ok(play(g, 'c3', 'd4').ok);
  assert.ok(play(g, 'b6', 'c5').ok);
  assert.deepEqual(paths(g), ['d4-b6']);
  assert.ok(D.mustCapture(g));
  assert.ok(play(g, 'd4', 'b6').ok);
  // Schwarz muss zurückschlagen: a7 x b6 -> c5  oder c7 x b6 -> a5
  assert.deepEqual(paths(g), ['a7-c5', 'c7-a5']);
  assert.equal(g.captured[0], 1);
});

// ---------- Zufallspartien ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function checkInvariants(g) {
  assert.equal(g.board.length, 64);
  g.board.forEach((p, i) => {
    assert.ok(p >= 0 && p <= 4);
    if (p) assert.ok(D.isDark(i), 'Stein auf hellem Feld');
    if (p === 1) assert.ok(D.rowOf(i) !== 0, 'weißer Stein in letzter Reihe müsste Dame sein');
    if (p === 3) assert.ok(D.rowOf(i) !== 7, 'schwarzer Stein in letzter Reihe müsste Dame sein');
  });
  const w = D.countPieces(g.board, 0);
  const b = D.countPieces(g.board, 1);
  assert.ok(w <= 12 && b <= 12);
  assert.equal(w + g.captured[1], 12, 'Weiß: Rest + von Schwarz geschlagen = 12');
  assert.equal(b + g.captured[0], 12, 'Schwarz: Rest + von Weiß geschlagen = 12');
}

test('Zufallspartien (600): enden sauber, Invarianten gelten, Regeln konsistent', () => {
  const stats = { wins: 0, draws: 0, limit: 0, promos: 0, multi: 0 };
  for (let n = 0; n < 600; n++) {
    const r = rng(n + 1);
    const g = mk();
    let plies = 0;
    while (g.mode === 'normal' && plies < 400) {
      const ms = D.legalMoves(g);
      assert.ok(ms.length > 0, 'Partie läuft, also gibt es Züge');
      // Schlagzwang-Konsistenz
      const anyCap = ms.some((m) => m.caps.length);
      if (anyCap) assert.ok(ms.every((m) => m.caps.length > 0));
      const m = ms[Math.floor(r() * ms.length)];
      // Einzelne ungültige Nachrichten dazwischen dürfen nichts ändern
      if (plies % 17 === 0) {
        const snap = JSON.stringify(g);
        D.handle(g, g.turn === 0 ? 'b' : 'w', { t: 'move', path: m.path });
        D.handle(g, 'z', { t: 'move', path: m.path });
        D.handle(g, g.turn === 0 ? 'w' : 'b', { t: 'move', path: [m.path[0], m.path[0]] });
        assert.equal(JSON.stringify(g), snap);
      }
      const res = D.move(g, g.turn === 0 ? 'w' : 'b', m.path);
      assert.ok(res.ok, res.error);
      if (m.caps.length > 1) stats.multi++;
      if (g.last.promoted) stats.promos++;
      checkInvariants(g);
      plies++;
    }
    if (g.mode === 'over') {
      if (g.winner === 'draw') stats.draws++; else stats.wins++;
      assert.ok(g.endReason);
      // Nach Spielende nimmt die Engine keine Züge mehr an
      assert.equal(D.move(g, 'w', [0, 1]).ok, false);
      assert.equal(D.legalMoves(g).length, 0);
      if (g.winner !== 'draw') {
        const loser = 1 - g.winner;
        if (!/aufgegeben/.test(g.endReason)) {
          // Verlierer hat keine Steine oder keine Züge
          assert.equal(D.legalMovesFor(g.board, loser).length, 0);
        }
      }
    } else stats.limit++;
  }
  assert.ok(stats.wins + stats.draws + stats.limit === 600);
  assert.ok(stats.multi > 0 && stats.promos > 0, JSON.stringify(stats));
});

test('Zufallspartien mit Aufgeben und Remis-Nachrichten beschädigen nichts', () => {
  for (let n = 0; n < 200; n++) {
    const r = rng(9000 + n);
    const g = mk();
    let plies = 0;
    while (g.mode === 'normal' && plies < 300) {
      const roll = r();
      const pid = r() < 0.5 ? 'w' : 'b';
      if (roll < 0.04) D.handle(g, pid, { t: 'draw-offer' });
      else if (roll < 0.07) D.handle(g, pid, { t: 'draw-decline' });
      else if (roll < 0.08) D.handle(g, pid, { t: 'draw-cancel' });
      else if (roll < 0.085) D.handle(g, pid, { t: 'draw-accept' });
      else if (roll < 0.0865) D.handle(g, pid, { t: 'resign' });
      else {
        const ms = D.legalMoves(g);
        if (!ms.length) break;
        D.handle(g, g.turn === 0 ? 'w' : 'b', { t: 'move', path: ms[Math.floor(r() * ms.length)].path });
      }
      checkInvariants(g);
      plies++;
    }
    JSON.parse(JSON.stringify(g)); // serialisierbar
  }
});

test('Zustand ist JSON-serialisierbar und nach Rundreise spielbar', () => {
  const g = mk();
  play(g, 'c3', 'd4');
  const h = JSON.parse(JSON.stringify(g));
  assert.ok(D.move(h, 'b', [sq('b6'), sq('a5')]).ok);
});
