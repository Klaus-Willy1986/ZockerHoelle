import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../schach/engine.js';

const sq = C.sq;
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mk = (opts) => C.createGame([{ id: 'w', name: 'Anna' }, { id: 's', name: 'Bernd' }], opts);
const fromFen = (fen) => { const g = mk(); assert.ok(C.setFen(g, fen), 'FEN ' + fen); return g; };
const idOf = (g) => (g.turn === 0 ? 'w' : 's'); // Runde 1: Person 0 = Weiß
const play = (g, ...moves) => {
  for (const mv of moves) {
    const from = sq(mv.slice(0, 2)); const to = sq(mv.slice(2, 4)); const promo = mv[4];
    const r = C.handle(g, idOf(g), { t: 'move', from, to, promo });
    assert.ok(r.ok, `${mv}: ${r.error}`);
  }
  return g;
};
const has = (g, mv) => C.legalMoves(g).some((m) => m.from === sq(mv.slice(0, 2)) && m.to === sq(mv.slice(2, 4)) && (mv[4] ? m.promo === mv[4] : true));
const count = (g) => C.legalMoves(g).length;

// ---------- Perft: bekannte Referenzwerte ----------
test('Perft Startstellung 1-4', () => {
  assert.deepEqual([1, 2, 3, 4].map((d) => C.perft(C.START_FEN, d)), [20, 400, 8902, 197281]);
});
test('Perft Kiwipete 1-3', () => {
  const f = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  assert.deepEqual([1, 2, 3].map((d) => C.perft(f, d)), [48, 2039, 97862]);
});
test('Perft Stellung 3 (en passant, Endspiel) 1-3', () => {
  assert.deepEqual([1, 2, 3].map((d) => C.perft('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', d)), [14, 191, 2812]);
});
test('Perft Stellung 4 (Umwandlung, Rochade) 1-3', () => {
  assert.deepEqual([1, 2, 3].map((d) => C.perft('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', d)), [6, 264, 9467]);
});
test('Perft Stellung 5 und gespiegelte Stellung 4', () => {
  assert.deepEqual([1, 2].map((d) => C.perft('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', d)), [44, 1486]);
  assert.deepEqual([1, 2, 3].map((d) => C.perft('r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', d)), [6, 264, 9467]);
});
test('legalMoves stimmt mit Perft(1) überein', () => {
  for (const f of [C.START_FEN, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1']) {
    const g = fromFen(f);
    assert.equal(count(g), C.perft(f, 1));
  }
});

// ---------- Grundzüge ----------
test('Startstellung: 20 Züge, Weiß beginnt, alles im Zustand', () => {
  const g = mk();
  assert.equal(count(g), 20);
  assert.equal(g.turn, 0); assert.equal(g.castling, 'KQkq'); assert.equal(g.ep, -1);
  assert.equal(g.halfmove, 0); assert.equal(g.fullmove, 1);
  assert.equal(C.fenOf(g), C.START_FEN);
  assert.equal(g.board.length, 64);
  assert.equal(g.mode, 'play'); assert.equal(g.result, null);
  assert.deepEqual(g.opts, { hints: true });
});
test('Optionen: hints Standard an, abschaltbar', () => {
  assert.equal(mk().opts.hints, true);
  assert.equal(mk({ hints: false }).opts.hints, false);
  assert.equal(mk({ hints: 1, foo: 2 }).opts.hints, true);
});
test('Grundzüge aller Figuren auf leerem Brett', () => {
  const n = (fen) => count(fromFen(fen));
  assert.equal(n('1k6/8/8/8/3N4/8/8/7K w - - 0 1'), 8 + 3); // Springer 8 + König a1 3
  assert.equal(n('1k6/8/8/8/3B4/8/8/7K w - - 0 1'), 13 + 3);
  assert.equal(n('1k6/8/8/8/3R4/8/8/7K w - - 0 1'), 14 + 3);
  assert.equal(n('1k6/8/8/8/3Q4/8/8/7K w - - 0 1'), 27 + 3);
  assert.equal(n('1k6/8/8/8/8/8/8/4K3 w - - 0 1'), 5);
  assert.equal(n('1k6/8/8/8/8/8/4P3/K7 w - - 0 1'), 2 + 3); // Bauer Einzel- und Doppelschritt
});
test('Bauer: Doppelschritt nur vom Start, nur wenn beide Felder frei, Schlagen nur schräg', () => {
  const g = fromFen('1k6/8/8/8/8/4n3/4P3/K7 w - - 0 1');
  assert.ok(!has(g, 'e2e3') && !has(g, 'e2e4'));
  const h = fromFen('1k6/8/8/8/4n3/8/4P3/K7 w - - 0 1');
  assert.ok(has(h, 'e2e3') && !has(h, 'e2e4'));
  const k = fromFen('1k6/8/8/8/8/3n1n2/4P3/K7 w - - 0 1');
  assert.ok(has(k, 'e2d3') && has(k, 'e2e3') && has(k, 'e2e4') && has(k, 'e2f3'), 'feindliche Figuren schräg: schlagen erlaubt');
  const s = fromFen('1k6/8/8/8/8/3p1p2/4P3/K7 w - - 0 1');
  assert.ok(has(s, 'e2d3') && has(s, 'e2f3'));
});
test('Schlagen entfernt die Figur und füllt die Liste der geschlagenen', () => {
  const g = fromFen('1k6/8/8/3p4/4P3/8/8/K7 w - - 0 1');
  play(g, 'e4d5');
  assert.equal(g.board[sq('d5')], 1);
  assert.deepEqual(g.captured[0], [7]); assert.deepEqual(g.captured[1], []);
  assert.equal(g.halfmove, 0);
});
test('Gefesselte Figur und König ins Schach: nicht erlaubt, mit Begründung', () => {
  const g = fromFen('4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1'); // Springer e2 gefesselt
  assert.ok(!has(g, 'e2c3') && !has(g, 'e2g3'));
  const r = C.handle(g, 'w', { t: 'move', from: sq('e2'), to: sq('c3') });
  assert.equal(r.ok, false);
  assert.match(r.error, /Dieser Zug ist nicht erlaubt/); assert.match(r.error, /König stünde im Schach/);
  const k = C.handle(g, 'w', { t: 'move', from: sq('e1'), to: sq('d2') });
  assert.equal(k.ok, true); // d2 ist frei und nicht angegriffen
  const g2 = fromFen('3rk3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.ok(!has(g2, 'e1d1') && !has(g2, 'e1d2') && has(g2, 'e1f1'));
  assert.match(C.whyIllegal(g2, sq('e1'), sq('d2')), /König stünde im Schach/);
  assert.equal(C.whyIllegal(g2, sq('a1'), sq('a5')), 'Dieser Zug ist nicht erlaubt.');
});
test('Im Schach: nur Züge, die das Schach beenden (wegziehen, schlagen, dazwischen)', () => {
  const g = fromFen('4k3/8/8/8/8/8/4r3/R3K3 w - - 0 1'); // Turm e2 gibt Schach
  assert.equal(C.inCheck(g), true);
  const ms = C.legalMoves(g).map((m) => `${C.sqName(m.from)}${C.sqName(m.to)}`).sort();
  assert.deepEqual(ms, ['e1d1', 'e1e2', 'e1f1'].sort());
  const h = fromFen('4k3/8/8/8/8/8/8/R3K2r w Q - 0 1');
  assert.equal(C.inCheck(h), true);
  assert.ok(has(h, 'e1d2') && has(h, 'e1e2') && has(h, 'e1f2') && !has(h, 'e1f1') && !has(h, 'e1d1'), 'Feld hinter dem König bleibt angegriffen');
  assert.ok(!has(h, 'e1c1'), 'keine Rochade aus dem Schach');
  const d = fromFen('4k3/8/8/8/1b6/8/8/R3K3 w - - 0 1');
  assert.equal(C.inCheck(d), true);
  const mv = C.legalMoves(d).map((m) => `${C.sqName(m.from)}${C.sqName(m.to)}`).sort();
  assert.deepEqual(mv, ['e1d1', 'e1e2', 'e1f1', 'e1f2'], 'Läufer-Schach: Turm kann nicht helfen');
  // dazwischenstellen und schlagen
  const bl = fromFen('4k3/8/8/8/1b6/8/8/2R1K3 w - - 0 1');
  assert.ok(has(bl, 'c1c3'), 'dazwischenstellen');
  const cp = fromFen('4k3/8/8/8/1b6/8/8/1R2K3 w - - 0 1');
  assert.ok(has(cp, 'b1b4'), 'Angreifer schlagen');
});

// ---------- Rochade ----------
test('Rochade erlaubt: kurz und lang für beide Seiten, Ausführung bewegt auch den Turm', () => {
  const g = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(has(g, 'e1g1') && has(g, 'e1c1'));
  const r = C.legalMoves(g).find((m) => m.from === sq('e1') && m.to === sq('g1'));
  assert.equal(r.castle, 'K');
  play(g, 'e1g1');
  assert.equal(g.board[sq('g1')], 6); assert.equal(g.board[sq('f1')], 4); assert.equal(g.board[sq('h1')], 0); assert.equal(g.board[sq('e1')], 0);
  assert.equal(g.castling, 'kq');
  assert.ok(has(g, 'e8c8') && !has(g, 'e8g8'), 'Turm f1 greift f8 an');
  play(g, 'e8c8');
  assert.equal(g.board[sq('c8')], 12); assert.equal(g.board[sq('d8')], 10); assert.equal(g.board[sq('a8')], 0);
  assert.equal(g.castling, '-');
  assert.equal(g.last.castle, 'Q');
  assert.equal(g.last.san, 'O-O-O'); assert.match(g.last.text, /rochiert lang/);
  const w = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); play(w, 'e1c1');
  assert.equal(w.board[sq('c1')], 6); assert.equal(w.board[sq('d1')], 4);
  assert.equal(w.last.san, 'O-O-O');
});
test('Rochade verboten: König oder Turm schon bewegt', () => {
  const g = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  play(g, 'e1f1', 'e8f8', 'f1e1', 'f8e8');
  assert.equal(g.castling, '-');
  assert.ok(!has(g, 'e1g1') && !has(g, 'e1c1'));
  const h = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  play(h, 'h1g1', 'h8g8', 'g1h1', 'g8h8');
  assert.equal(h.castling, 'Qq');
  assert.ok(!has(h, 'e1g1') && has(h, 'e1c1'));
  const a = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  play(a, 'a1b1', 'a8b8', 'b1a1', 'b8a8');
  assert.ok(has(a, 'e1g1') && !has(a, 'e1c1'));
});
test('Rochade verboten: Turm wird geschlagen', () => {
  const g = fromFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
  play(g, 'h8h1');
  assert.equal(g.castling, 'Qq');
});
test('Rochade verboten: König im Schach, Feld dazwischen angegriffen, Zielfeld angegriffen', () => {
  const chk = fromFen('1k2r3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.ok(!has(chk, 'e1g1') && !has(chk, 'e1c1'), 'im Schach');
  const f = fromFen('1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // f1 angegriffen
  assert.ok(!has(f, 'e1g1') && has(f, 'e1c1'));
  const gz = fromFen('1k4r1/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // g1 (Ziel) angegriffen
  assert.ok(!has(gz, 'e1g1') && has(gz, 'e1c1'));
  const d = fromFen('1k1r4/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // d1 angegriffen
  assert.ok(has(d, 'e1g1') && !has(d, 'e1c1'));
  const cz = fromFen('1kr5/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // c1 (Ziel lang) angegriffen
  assert.ok(has(cz, 'e1g1') && !has(cz, 'e1c1'));
  const only = fromFen('1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // b1 angegriffen: lange Rochade bleibt erlaubt (nur der Turm kreuzt)
  assert.ok(has(only, 'e1c1') && has(only, 'e1g1'));
});
test('Rochade verboten: Feld dazwischen besetzt (auch b1 bei langer Rochade)', () => {
  assert.ok(!has(fromFen('1k6/8/8/8/8/8/8/RN2K2R w KQ - 0 1'), 'e1c1'));
  assert.ok(has(fromFen('1k6/8/8/8/8/8/8/RN2K2R w KQ - 0 1'), 'e1g1'));
  assert.ok(!has(fromFen('1k6/8/8/8/8/8/8/R3KB1R w KQ - 0 1'), 'e1g1'));
  assert.ok(!has(fromFen('1k6/8/8/8/8/8/8/R2QK2R w KQ - 0 1'), 'e1c1'));
  assert.ok(!has(fromFen('1k6/8/8/8/8/8/8/R3K1NR w KQ - 0 1'), 'e1g1'));
});
test('Rochade schwarz: kurz und lang mit allen Bedingungen', () => {
  const g = fromFen('r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1');
  assert.ok(has(g, 'e8g8') && has(g, 'e8c8'));
  const f = fromFen('r3k2r/8/8/8/8/8/8/4KR2 b kq - 0 1'); // Turm f1 greift f8 an
  assert.ok(!has(f, 'e8g8') && has(f, 'e8c8'));
  const d = fromFen('r3k2r/8/8/8/8/8/8/3RK3 b kq - 0 1'); // Turm d1 greift d8 an
  assert.ok(has(d, 'e8g8') && !has(d, 'e8c8'));
  assert.ok(!has(fromFen('r3k2r/8/8/8/8/8/8/4K1R1 b kq - 0 1'), 'e8g8'), 'Ziel g8 angegriffen');
  assert.ok(!has(fromFen('r3k2r/8/8/8/8/8/8/2R1K3 b kq - 0 1'), 'e8c8'), 'Ziel c8 angegriffen');
  const chk = fromFen('r3k2r/8/8/8/8/8/8/4R1K1 b kq - 0 1');
  assert.ok(!has(chk, 'e8g8') && !has(chk, 'e8c8'), 'im Schach');
  assert.ok(!has(fromFen('rn2k2r/8/8/8/8/8/8/4K3 b kq - 0 1'), 'e8c8'), 'b8 besetzt');
  assert.ok(!has(fromFen('r3k1nr/8/8/8/8/8/8/4K3 b kq - 0 1'), 'e8g8'), 'g8 besetzt');
  const m = fromFen('r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1'); play(m, 'e8g8');
  assert.equal(m.board[sq('g8')], 12); assert.equal(m.board[sq('f8')], 10);
});

// ---------- en passant ----------
test('en passant: nur direkt im nächsten Zug', () => {
  const g = fromFen(C.START_FEN);
  play(g, 'e2e4', 'a7a6', 'e4e5', 'd7d5');
  assert.equal(g.ep, sq('d6'));
  assert.ok(has(g, 'e5d6'));
  const m = C.legalMoves(g).find((x) => x.from === sq('e5') && x.to === sq('d6'));
  assert.equal(m.ep, true); assert.equal(m.capture, true);
  // Chance verfällt nach einem anderen Zug
  const h = fromFen(C.START_FEN);
  play(h, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6');
  assert.ok(!has(h, 'e5d6'));
  // Ausführung
  play(g, 'e5d6');
  assert.equal(g.board[sq('d6')], 1); assert.equal(g.board[sq('d5')], 0);
  assert.deepEqual(g.captured[0], [7]);
  assert.equal(g.last.ep, true); assert.match(g.last.text, /im Vorbeigehen/); assert.equal(g.last.san, 'exd6');
});
test('en passant: kein Schlagen eines Bauern, der nur einen Schritt gemacht hat', () => {
  const g = fromFen(C.START_FEN);
  play(g, 'e2e4', 'd7d6', 'e4e5', 'd6d5');
  assert.equal(g.ep, -1);
  assert.ok(!has(g, 'e5d6'));
});
test('en passant: Schwarz schlägt auch, und nicht mit offenem Königsschach (Fesselung waagerecht)', () => {
  const g = fromFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
  assert.ok(has(g, 'd4e3'));
  const p = fromFen('8/8/8/8/k2pP2R/8/8/4K3 b - e3 0 1'); // König a4, Turm h4: nach d4xe3 wären beide Bauern weg
  assert.ok(!has(p, 'd4e3'));
  const q = fromFen('1k6/8/8/K2pP2r/8/8/8/8 w - d6 0 1');
  assert.ok(!has(q, 'e5d6'));
  const w = fromFen('1k6/8/8/3pP3/8/8/8/K7 w - d6 0 1'); // ohne Fesselung geht es
  assert.ok(has(w, 'e5d6'));
  // en passant, wenn dadurch ein Schach abgewehrt wird (Bauer gibt Schach)
  const e = fromFen('8/8/8/2k5/3Pp3/8/8/4K3 b - d3 0 1');
  assert.ok(has(e, 'e4d3'));
  // FEN-Angabe ohne Bauer dahinter wird ignoriert
  const x = fromFen('4k3/8/8/8/8/8/8/4K3 w - e6 0 1');
  assert.equal(x.ep, -1);
});

// ---------- Umwandlung ----------
test('Umwandlung: vier Möglichkeiten, ohne Auswahl keine Ausführung', () => {
  const g = fromFen('1k6/4P3/8/8/8/8/8/K7 w - - 0 1');
  const ms = C.legalMoves(g).filter((m) => m.from === sq('e7'));
  assert.deepEqual(ms.map((m) => m.promo).sort(), ['b', 'n', 'q', 'r']);
  const r = C.handle(g, 'w', { t: 'move', from: sq('e7'), to: sq('e8') });
  assert.equal(r.ok, false); assert.equal(r.needPromo, true);
  assert.equal(g.board[sq('e7')], 1, 'Zustand unverändert');
  assert.equal(C.handle(g, 'w', { t: 'move', from: sq('e7'), to: sq('e8'), promo: 'k' }).ok, false);
  assert.equal(C.handle(g, 'w', { t: 'move', from: sq('e7'), to: sq('e8'), promo: 'x' }).ok, false);
  for (const [k, code] of [['q', 5], ['r', 4], ['b', 3], ['n', 2]]) {
    const h = fromFen('1k6/4P3/8/8/8/8/8/K7 w - - 0 1');
    play(h, 'e7e8' + k);
    assert.equal(h.board[sq('e8')], code);
    assert.equal(h.last.promo, k);
  }
  const big = fromFen('1k6/4P3/8/8/8/8/8/K7 w - - 0 1'); play(big, 'e7e8Q');
  assert.equal(big.board[sq('e8')], 5);
});
test('Umwandlung: mit Schlagen, bei Schwarz, Springer-Schach', () => {
  const g = fromFen('3r3k/4P3/8/8/8/8/8/K7 w - - 0 1');
  assert.ok(has(g, 'e7d8q') && has(g, 'e7e8q') && has(g, 'e7d8n'));
  play(g, 'e7d8q');
  assert.equal(g.board[sq('d8')], 5); assert.deepEqual(g.captured[0], [10]);
  assert.equal(g.last.san, 'exd8=Q+'); assert.match(g.last.text, /zur Dame/);
  const s = fromFen('7k/8/8/8/8/8/p7/6RK b - - 0 1');
  assert.ok(has(s, 'a2a1q') && has(s, 'a2a1n'));
  const n = fromFen('7k/8/8/8/8/8/p7/7K b - - 0 1'); play(n, 'a2a1n');
  assert.equal(n.board[sq('a1')], 8);
  // nur Umwandlung auf der letzten Reihe, nicht davor
  const e = fromFen('1k6/8/4P3/8/8/8/8/K7 w - - 0 1');
  assert.ok(has(e, 'e6e7') && !has(e, 'e6e7q'));
});

// ---------- Matt, Patt ----------
test('Schäfermatt-ähnlich: Narrenmatt endet mit Schachmatt für Schwarz', () => {
  const g = mk();
  play(g, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.equal(g.mode, 'over');
  assert.equal(g.result.reason, 'checkmate'); assert.equal(g.result.winner, 1);
  assert.equal(g.winner, 1); assert.deepEqual(g.scores, [0, 2]);
  assert.match(g.result.text, /Schachmatt/); assert.match(g.result.text, /Bernd/);
  assert.equal(g.last.mate, true); assert.equal(g.last.san, 'Qh4#');
  assert.equal(C.legalMoves(g).length, 0);
  assert.equal(C.handle(g, 'w', { t: 'move', from: 0, to: 1 }).ok, false);
});
test('bekannte Mattstellungen: Grundreihe, Schäfermatt, Erstickungsmatt', () => {
  const a = fromFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'); play(a, 'a1a8');
  assert.equal(a.result.reason, 'checkmate');
  const b = mk(); play(b, 'e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7');
  assert.equal(b.result.reason, 'checkmate'); assert.equal(b.winner, 0); assert.deepEqual(b.scores, [2, 0]);
  const c = fromFen('6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1'); // Springer g5 -> f7 matt
  play(c, 'g5f7');
  assert.equal(c.result.reason, 'checkmate');
  const d = fromFen('7k/8/6K1/8/8/8/8/R7 w - - 0 1'); play(d, 'a1a8');
  assert.equal(d.result.reason, 'checkmate');
});
test('Patt = Remis, jede Seite 1 Punkt', () => {
  const g = fromFen('k7/8/1K6/8/8/8/8/2Q5 w - - 0 1');
  play(g, 'c1c7');
  assert.equal(g.mode, 'over'); assert.equal(g.result.winner, 'draw'); assert.equal(g.result.reason, 'stalemate');
  assert.equal(g.winner, null); assert.deepEqual(g.scores, [1, 1]);
  assert.match(g.result.text, /Patt/);
  const h = fromFen('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1'); // Qf7 greift h7/g8... Königsfeld h8: g8,g7,h7 gedeckt
  play(h, 'g6f6');
  assert.notEqual(h.result && h.result.reason, 'checkmate');
});
test('Schach: Banner-Flag check und log', () => {
  const g = mk();
  play(g, 'e2e4', 'f7f6', 'd1h5');
  assert.equal(g.check, true); assert.equal(g.last.check, true);
  assert.match(g.log[g.log.length - 1], /Schach/);
  assert.equal(C.inCheck(g), true);
  play(g, 'g7g6');
  assert.equal(g.check, false);
});

// ---------- Remis-Regeln ----------
test('Dreifachstellung (automatisch)', () => {
  const g = mk();
  play(g, 'g1f3', 'g8f6', 'f3g1', 'f6g8');
  assert.equal(g.mode, 'play');
  assert.equal(Object.values(g.positions).filter((n) => n === 2).length, 1);
  play(g, 'g1f3', 'g8f6', 'f3g1');
  assert.equal(g.mode, 'play');
  play(g, 'f6g8');
  assert.equal(g.mode, 'over'); assert.equal(g.result.reason, 'threefold'); assert.equal(g.result.winner, 'draw');
  assert.deepEqual(g.scores, [1, 1]);
});
test('Dreifachstellung: andere Rochaderechte = andere Stellung', () => {
  const g = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  play(g, 'a1b1', 'a8b8', 'b1a1', 'b8a8', 'a1b1', 'a8b8', 'b1a1', 'b8a8');
  assert.equal(g.mode, 'play', 'Rechte haben sich geändert (Q/q weg)');
});
test('50-Züge-Regel: Remis bei 100 Halbzügen, Bauernzug und Schlagen setzen zurück', () => {
  const g = fromFen('1k6/8/8/8/8/8/R7/K7 w - - 98 80');
  play(g, 'a2a3');
  assert.equal(g.halfmove, 99); assert.equal(g.mode, 'play');
  play(g, 'b8c8');
  assert.equal(g.mode, 'over'); assert.equal(g.result.reason, 'fifty');
  const h = fromFen('1k6/8/8/8/8/p7/R7/K7 w - - 99 80');
  play(h, 'a2a3');
  assert.equal(h.halfmove, 0); assert.equal(h.mode, 'play');
  const p = fromFen('1k6/8/8/8/8/8/P7/K7 w - - 99 80'); play(p, 'a2a4');
  assert.equal(p.mode, 'play'); assert.equal(p.halfmove, 0);
  // Matt geht vor Remis
  const m = fromFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 99 80'); play(m, 'a1a8');
  assert.equal(m.result.reason, 'checkmate');
});
test('Tote Stellung: K gegen K, K+L/S gegen K, L gegen L gleiche Farbe', () => {
  const g = fromFen('1k6/8/8/8/8/8/n7/K7 w - - 0 1'); play(g, 'a1a2');
  assert.equal(g.result.reason, 'dead'); assert.deepEqual(g.scores, [1, 1]);
  const dead = (fen) => C.isDead(C.parseFen(fen).board);
  assert.equal(dead('1k6/8/8/8/8/8/8/KB6 w - - 0 1'), true);
  assert.equal(dead('1k6/8/8/8/8/8/8/KN6 w - - 0 1'), true);
  assert.equal(dead('kn6/8/8/8/8/8/8/K7 w - - 0 1'), true);
  assert.equal(dead('1k6/8/8/8/8/8/8/K7 w - - 0 1'), true);
  assert.equal(dead('k1b5/8/8/8/8/8/8/K1B5 w - - 0 1'), false); // c8 hell, c1 dunkel
  assert.equal(dead('k1b5/8/8/8/8/8/8/K4B2 w - - 0 1'), true); // c8 und f1 beide hell
  assert.equal(dead('1k6/8/8/8/8/8/8/KBb5 w - - 0 1'), false); // b1 hell, c1 dunkel: ungleich
  assert.equal(dead('1k6/8/8/8/8/8/8/KB1b4 w - - 0 1'), true); // b1 hell, d1 hell
  assert.equal(dead('1k6/8/8/8/8/8/8/KNN5 w - - 0 1'), false);
  assert.equal(dead('7k/8/8/8/8/8/8/KR6 w - - 0 1'), false);
  assert.equal(dead('1k6/8/8/8/8/8/P7/K7 w - - 0 1'), false);
  assert.equal(dead('1k6/8/8/8/8/8/8/KBN5 w - - 0 1'), false);
});

// ---------- Notation, Texte ----------
test('toSAN und vorlesbarer Text', () => {
  const g = mk();
  assert.equal(C.toSAN(g, { from: sq('g1'), to: sq('f3') }), 'Nf3');
  assert.equal(C.moveText(g, { from: sq('g1'), to: sq('f3') }), 'Weiß zieht Springer nach f3.');
  assert.equal(C.moveText(g, { from: sq('e2'), to: sq('e4') }), 'Weiß zieht Bauer nach e4.');
  assert.equal(C.toSAN(g, { from: sq('e2'), to: sq('e5') }), '', 'unerlaubt -> leer');
  play(g, 'e2e4', 'd7d5');
  assert.equal(C.toSAN(g, { from: sq('e4'), to: sq('d5') }), 'exd5');
  assert.equal(C.moveText(g, { from: sq('e4'), to: sq('d5') }), 'Weiß schlägt mit dem Bauern den Bauern auf d5.');
  const r = fromFen('1k6/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.equal(C.toSAN(r, { from: sq('e1'), to: sq('g1') }), 'O-O');
  assert.equal(C.moveText(r, { from: sq('e1'), to: sq('g1') }), 'Weiß rochiert kurz.');
  const d = fromFen('1k6/8/8/8/8/8/8/N3K1N1 w - - 0 1');
  assert.equal(C.toSAN(d, { from: sq('a1'), to: sq('c2') }), 'Nc2');
  const two = fromFen('1k6/8/8/8/8/8/8/1N1NK3 w - - 0 1');
  assert.equal(C.toSAN(two, { from: sq('b1'), to: sq('c3') }), 'Nbc3');
  const rk = fromFen('1k6/8/8/R7/8/8/8/R3K3 w - - 0 1');
  assert.equal(C.toSAN(rk, { from: sq('a1'), to: sq('a3') }), 'R1a3');
  const pr = fromFen('3r3k/4P3/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(C.toSAN(pr, { from: sq('e7'), to: sq('d8'), promo: 'q' }), 'exd8=Q+');
  assert.match(C.moveText(pr, { from: sq('e7'), to: sq('e8'), promo: 'n' }), /wird zum Springer/);
});
test('FEN: Lesen, Schreiben, Ablehnen', () => {
  const g = mk();
  play(g, 'e2e4', 'c7c5', 'g1f3');
  assert.equal(C.fenOf(g), 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
  const p = C.parseFen(C.fenOf(g));
  assert.deepEqual(p.board, g.board); assert.equal(p.turn, 1);
  for (const bad of ['', 'xyz', '8/8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1', '1k6/8/8/8/8/8/8/K7 x - - 0 1', '1k6/8/8/8/8/8/8/KK6 w - - 0 1', 'k6P/8/8/8/8/8/8/K7 w - - 0 1', null, 5]) {
    assert.equal(C.parseFen(bad), null, String(bad));
  }
  assert.equal(C.setFen(mk(), 'kaputt'), false);
});

// ---------- Nachrichten, Runden, JSON ----------
test('ungültige Nachrichten, falsche Person, falsche Phase: nie Ausnahme, nie Zustandsänderung', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  const bad = [null, undefined, 5, 'x', [], {}, { t: 'move' }, { t: 'move', from: 'a', to: 'b' }, { t: 'move', from: 1.5, to: 2 }, { t: 'move', from: -1, to: 8 }, { t: 'move', from: 0, to: 64 },
    { t: 'move', from: sq('e2'), to: sq('e5') }, { t: 'move', from: sq('e7'), to: sq('e5') }, { t: 'move', from: sq('e2'), to: sq('e4'), promo: 'z' }, { t: 'zzz' }, { t: 'next' }];
  for (const m of bad) {
    const r = C.handle(g, 'w', m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(C.handle(g, 's', { t: 'move', from: sq('e7'), to: sq('e5') }).ok, false); // nicht an der Reihe
  assert.equal(C.handle(g, 'fremd', { t: 'move', from: sq('e2'), to: sq('e4') }).ok, false);
  assert.equal(C.handle(g, 'fremd', { t: 'next' }).ok, false);
  assert.equal(C.handle(null, 'w', { t: 'move' }).ok, false);
  assert.equal(C.handle({}, 'w', { t: 'move', from: 1, to: 2 }).ok, false);
  assert.equal(JSON.stringify(g), snap);
});
test('Zustand ist reines JSON und nach dem Laden spielbar', () => {
  const g = mk();
  play(g, 'e2e4', 'e7e5', 'g1f3');
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.ok(C.handle(copy, 's', { t: 'move', from: sq('b8'), to: sq('c6') }).ok);
  assert.equal(copy.moveNo, 4);
  assert.equal(g.moveNo, 3);
});
test('Noch eine Runde: Farben wechseln, Punkte bleiben, Brett neu, nur nach Rundenende', () => {
  const g = mk();
  assert.equal(C.handle(g, 'w', { t: 'next' }).ok, false);
  play(g, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.deepEqual(g.scores, [0, 2]);
  assert.equal(C.handle(g, 'w', { t: 'next' }).ok, true);
  assert.equal(g.round, 2); assert.equal(g.white, 1); assert.equal(g.mode, 'play');
  assert.deepEqual(g.scores, [0, 2]);
  assert.equal(C.fenOf(g), C.START_FEN);
  assert.equal(g.result, null); assert.deepEqual(g.captured, [[], []]); assert.deepEqual(g.log, []);
  assert.equal(C.colorOfPlayer(g, 's'), 0); assert.equal(C.colorOfPlayer(g, 'w'), 1);
  assert.equal(C.handle(g, 'w', { t: 'move', from: sq('e2'), to: sq('e4') }).ok, false, 'Weiß ist jetzt Bernd');
  assert.ok(C.handle(g, 's', { t: 'move', from: sq('e2'), to: sq('e4') }).ok);
  const rk = C.ranking(g);
  assert.equal(rk[0].name, 'Bernd'); assert.equal(rk[0].place, 1); assert.equal(rk[1].place, 2);
});
test('Zugdeckel-Hook für Tests (maxply)', () => {
  const g = mk(); g.maxply = 4;
  play(g, 'g1f3', 'g8f6', 'b1c3', 'b8c6');
  assert.equal(g.mode, 'over'); assert.equal(g.result.reason, 'maxply'); assert.equal(g.result.winner, 'draw');
});
test('createGame: genau zwei Personen', () => {
  assert.throws(() => C.createGame([{ id: 'a', name: 'A' }]));
  assert.throws(() => C.createGame(null));
});

// ---------- Zufallspartien ----------
test('250 Zufallspartien enden immer; Zustand bleibt in sich stimmig', () => {
  const reasons = {}; let totalPlies = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const rnd = seeded(seed * 7919);
    const g = mk();
    let plies = 0;
    while (g.mode === 'play') {
      assert.ok(plies < 1500, 'Partie muss enden (Seed ' + seed + ')');
      const ms = C.legalMoves(g);
      assert.ok(ms.length > 0, 'im Spiel muss es einen Zug geben');
      const m = ms[Math.floor(rnd() * ms.length)];
      // Computerspiel wählt immer; Menschen wählen bei Umwandlung -> zufällig
      const r = C.handle(g, idOf(g), { t: 'move', from: m.from, to: m.to, promo: m.promo });
      assert.ok(r.ok, r.error);
      plies++;
      assert.equal(g.board.length, 64);
      assert.equal(g.board.filter((p) => p === 6).length, 1); assert.equal(g.board.filter((p) => p === 12).length, 1);
      assert.equal(g.board.filter((p) => p).length + g.captured[0].length + g.captured[1].length, 32, 'Figurenbilanz');
      assert.ok(g.board.every((p) => Number.isInteger(p) && p >= 0 && p <= 12));
      if (plies % 25 === 0) { const f = C.parseFen(C.fenOf(g)); assert.ok(f, 'FEN lesbar'); assert.deepEqual(f.board, g.board); }
      if (g.mode === 'play') assert.equal(C.inCheck(g, 1 - g.turn), false, 'Gegner darf nie im Schach stehen');
    }
    reasons[g.result.reason] = (reasons[g.result.reason] || 0) + 1;
    totalPlies += plies;
    assert.equal(g.scores[0] + g.scores[1], g.result.winner === 'draw' ? 2 : 2);
    JSON.parse(JSON.stringify(g));
  }
  console.log('Zufallspartien Ende:', JSON.stringify(reasons), 'mittlere Länge', Math.round(totalPlies / 250));
});
