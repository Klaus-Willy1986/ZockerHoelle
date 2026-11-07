import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../bauern/engine.js';

const sq = B.sq;
const mk = (opts) => B.createGame([{ id: 'w', name: 'Anna' }, { id: 'b', name: 'Bernd' }], opts);
// Stellung aus {'e2':'w', 'd7':'b'}; turn = Farbe am Zug
function setup(pieces, turn = 0, opts = {}) {
  const g = mk(opts);
  g.board = Array(64).fill(0);
  for (const [k, v] of Object.entries(pieces)) g.board[sq(k)] = v === 'w' ? 1 : 2;
  g.turn = turn;
  return g;
}
const pid = (g) => g.players[B.playerOfColor(g, g.turn)].id;
const mv = (g, a, b) => B.handle(g, pid(g), { t: 'move', from: sq(a), to: sq(b) });
const dests = (g, a) => B.legalMoves(g).filter((m) => m.from === sq(a)).map((m) => B.sqName(m.to)).sort();
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('Namen und Felder', () => {
  assert.equal(sq('a1'), 0);
  assert.equal(sq('h8'), 63);
  assert.equal(B.sqName(sq('e4')), 'e4');
  assert.equal(B.sqName(sq('a8')), 'a8');
});

test('createGame: genau 2 Personen, Standardoptionen, Startaufstellung', () => {
  assert.throws(() => B.createGame([{ id: 'a', name: 'A' }]));
  assert.throws(() => B.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]));
  const g = mk();
  assert.deepEqual(g.opts, { enpassant: true, mustCapture: false });
  assert.deepEqual(mk({ mustCapture: true, enpassant: false }).opts, { enpassant: false, mustCapture: true });
  assert.equal(B.countPawns(g.board, 0), 8);
  assert.equal(B.countPawns(g.board, 1), 8);
  for (let f = 0; f < 8; f++) {
    assert.equal(g.board[8 + f], 1);
    assert.equal(g.board[48 + f], 2);
  }
  assert.equal(g.board.filter(Boolean).length, 16);
  assert.equal(g.turn, 0);
  assert.equal(g.mode, 'play');
  assert.equal(B.legalMoves(g).length, 16); // 8 einfache + 8 Doppelschritte
});

test('Zugarten: ein Feld, Doppelschritt nur vom Start und nur über freie Felder', () => {
  const g = mk();
  assert.deepEqual(dests(g, 'e2'), ['e3', 'e4']);
  // vom Startfeld aus bei besetztem Zwischenfeld: kein Doppelschritt, kein Einzelschritt
  const h = setup({ e2: 'w', e3: 'b', a8: 'b' });
  assert.deepEqual(dests(h, 'e2'), []);
  // Zielfeld besetzt, Zwischenfeld frei: nur Einzelschritt
  const j = setup({ e2: 'w', e4: 'b', a8: 'b' });
  assert.deepEqual(dests(j, 'e2'), ['e3']);
  // nicht vom Startfeld: nur ein Feld
  const k = setup({ e3: 'w', a8: 'b' });
  assert.deepEqual(dests(k, 'e3'), ['e4']);
  // Schwarz zieht abwärts, Doppelschritt von Reihe 7
  const s = setup({ d7: 'b', h1: 'w' }, 1);
  assert.deepEqual(dests(s, 'd7'), ['d5', 'd6']);
  const t = setup({ d6: 'b', h1: 'w' }, 1);
  assert.deepEqual(dests(t, 'd6'), ['d5']);
  // Weißer Bauer auf Reihe 7 ist kein Startfeld für Weiß
  const u = setup({ d7: 'w', h1: 'b' });
  assert.deepEqual(dests(u, 'd7'), ['d8']);
});

test('Doppelschritt und Einzelschritt werden ausgeführt', () => {
  const g = mk();
  assert.ok(mv(g, 'e2', 'e4').ok);
  assert.equal(g.board[sq('e2')], 0);
  assert.equal(g.board[sq('e4')], 1);
  assert.equal(g.turn, 1);
  assert.deepEqual(g.last, { by: 0, from: sq('e2'), to: sq('e4'), kind: 'double' });
  assert.ok(mv(g, 'd7', 'd6').ok);
  assert.equal(g.last.kind, 'step');
  assert.equal(g.moveNo, 2);
  assert.equal(B.moveText(g.last), 'Schwarz zieht d7 nach d6.');
});

test('Schlagen: nur schräg vorwärts, nicht geradeaus, nicht rückwärts', () => {
  const g = setup({ e4: 'w', d5: 'b', e5: 'b', f3: 'b', a8: 'b' });
  assert.deepEqual(dests(g, 'e4'), ['d5']); // e5 geradeaus blockiert, f3 liegt rückwärts
});
test('Schlagen: Zug, Rand, eigene Bauern', () => {
  const g = setup({ d4: 'w', e5: 'b', d5: 'b', a8: 'b' });
  assert.deepEqual(dests(g, 'd4'), ['e5']);
  assert.ok(mv(g, 'd4', 'e5').ok);
  assert.equal(g.board[sq('e5')], 1);
  assert.equal(g.board[sq('d4')], 0);
  assert.equal(B.countPawns(g.board, 1), 2);
  assert.equal(g.last.kind, 'capture');
  assert.equal(B.moveText(g.last), 'Weiß schlägt: d4 nach e5.');
  // eigener Bauer schräg: kein Zug dorthin
  const h = setup({ d4: 'w', e5: 'w', a8: 'b' });
  assert.deepEqual(dests(h, 'd4'), ['d5']);
  // Rand: a-Linie hat nur eine Schlagrichtung
  const r = setup({ a4: 'w', b5: 'b', h8: 'b' });
  assert.deepEqual(dests(r, 'a4'), ['a5', 'b5']);
  const r2 = setup({ h4: 'w', g5: 'b', a8: 'b' });
  assert.deepEqual(dests(r2, 'h4'), ['g5', 'h5']);
});

test('en passant: nur direkt im nächsten Zug', () => {
  const g = setup({ e5: 'w', d7: 'b', h7: 'b', a2: 'w' }, 1);
  assert.ok(mv(g, 'd7', 'd5').ok);
  assert.deepEqual(g.ep, { to: sq('d6'), pawn: sq('d5') });
  assert.deepEqual(dests(g, 'e5'), ['d6', 'e6']);
  assert.ok(mv(g, 'e5', 'd6').ok);
  assert.equal(g.board[sq('d5')], 0, 'geschlagener Bauer ist weg');
  assert.equal(g.board[sq('d6')], 1);
  assert.equal(g.last.kind, 'ep');
  assert.equal(B.countPawns(g.board, 1), 1);
  assert.equal(g.ep, null);
  assert.match(B.moveText(g.last), /im Vorbeigehen/);

  // verpasst: ein anderer Zug dazwischen -> nicht mehr möglich
  const h = setup({ e5: 'w', d7: 'b', h7: 'b', a2: 'w' }, 1);
  assert.ok(mv(h, 'd7', 'd5').ok);
  assert.ok(mv(h, 'a2', 'a3').ok);
  assert.ok(mv(h, 'h7', 'h6').ok);
  assert.deepEqual(dests(h, 'e5'), ['e6']);
  assert.equal(h.ep, null);
  assert.equal(B.handle(h, 'w', { t: 'move', from: sq('e5'), to: sq('d6') }).ok, false);

  // einfacher Schritt erzeugt kein en passant
  const k = setup({ e5: 'w', d6: 'b', h7: 'b' }, 1);
  assert.ok(mv(k, 'd6', 'd5').ok);
  assert.equal(k.ep, null);
  assert.deepEqual(dests(k, 'e5'), ['e6']);
});

test('en passant: Option aus; kein en passant gegen weit entfernte Bauern', () => {
  const g = setup({ e5: 'w', d7: 'b', h7: 'b', a2: 'w' }, 1, { enpassant: false });
  assert.ok(mv(g, 'd7', 'd5').ok);
  assert.equal(g.ep, null);
  assert.deepEqual(dests(g, 'e5'), ['e6']);
  // Weiß-Doppelschritt, schwarzer Bauer daneben schlägt im Vorbeigehen
  const h = setup({ e2: 'w', d4: 'b', h8: 'b' }, 0);
  assert.ok(mv(h, 'e2', 'e4').ok);
  assert.deepEqual(dests(h, 'd4'), ['d3', 'e3']);
  assert.ok(mv(h, 'd4', 'e3').ok);
  assert.equal(h.board[sq('e4')], 0);
  assert.equal(h.board[sq('e3')], 2);
  // Ein Bauer in anderer Linie bekommt kein en passant
  const k = setup({ b4: 'b', e2: 'w', h8: 'b' }, 0);
  assert.ok(mv(k, 'e2', 'e4').ok);
  assert.deepEqual(dests(k, 'b4'), ['b3']);
});

test('Schlagzwang-Option: nur Schlagzüge, wenn es welche gibt (auch en passant)', () => {
  const g = setup({ e4: 'w', d5: 'b', a2: 'w', h8: 'b' }, 0, { mustCapture: true });
  assert.deepEqual(B.legalMoves(g).map((m) => `${B.sqName(m.from)}${B.sqName(m.to)}`), ['e4d5']);
  const r = mv0(g, 'a2', 'a3');
  assert.equal(r.ok, false);
  assert.match(r.error, /Schlagzwang/);
  assert.ok(mv(g, 'e4', 'd5').ok);
  // ohne Option frei
  const h = setup({ e4: 'w', d5: 'b', a2: 'w', h8: 'b' }, 0);
  assert.ok(B.legalMoves(h).length > 1);
  // en passant unter Schlagzwang
  const k = setup({ e5: 'w', d7: 'b', a2: 'w', h7: 'b' }, 1, { mustCapture: true });
  assert.ok(mv(k, 'd7', 'd5').ok);
  assert.deepEqual(B.legalMoves(k).map((m) => B.sqName(m.to)), ['d6']);
  assert.equal(B.mustCaptureNow(k), true);
  assert.equal(B.mustCaptureNow(h), false);
});
function mv0(g, a, b) { return B.handle(g, pid(g), { t: 'move', from: sq(a), to: sq(b) }); }

test('Durchbruch: Grundreihe erreichen gewinnt sofort (beide Farben)', () => {
  const g = setup({ e7: 'w', a2: 'b', h2: 'b' });
  assert.ok(mv(g, 'e7', 'e8').ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.equal(g.endCode, 'goal');
  assert.deepEqual(g.scores, [1, 0]);
  const s = setup({ d2: 'b', a7: 'w', h7: 'w' }, 1);
  assert.ok(mv(s, 'd2', 'd1').ok);
  assert.equal(g.mode, 'over');
  assert.equal(s.winner, 1);
  assert.equal(s.endCode, 'goal');
  assert.deepEqual(s.scores, [0, 1]);
  // Durchbruch durch Schlagen auf die Grundreihe
  const k = setup({ e7: 'w', d8: 'b', a2: 'b' });
  assert.deepEqual(dests(k, 'e7'), ['d8', 'e8']);
  assert.ok(mv(k, 'e7', 'd8').ok);
  assert.equal(k.endCode, 'goal');
});

test('Alles geschlagen gewinnt', () => {
  const g = setup({ e4: 'w', d5: 'b', a2: 'w' });
  assert.ok(mv(g, 'e4', 'd5').ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.endCode, 'all');
  assert.equal(g.winner, 0);
  // en passant als letzter Bauer
  const h = setup({ e5: 'w', d7: 'b' }, 1);
  assert.ok(mv(h, 'd7', 'd5').ok);
  assert.ok(mv(h, 'e5', 'd6').ok);
  assert.equal(h.endCode, 'all');
});

test('Blockade: wer am Zug ist und nicht ziehen kann, verliert', () => {
  // Weiß zieht e3-e4 und blockiert den einzigen schwarzen Bauern e5; Schwarz kann nicht ziehen
  const g = setup({ e3: 'w', e5: 'b' });
  assert.ok(mv(g, 'e3', 'e4').ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.endCode, 'blocked');
  assert.equal(g.winner, 0);
  assert.match(g.endReason, /kann nicht mehr ziehen/);
  // Beide blockiert: der Gegner des Ziehenden ist am Zug und hat keinen Zug -> verliert
  const h = setup({ e3: 'w', e5: 'b', a2: 'w' }, 0);
  h.board[sq('a2')] = 0;
  h.board[sq('a3')] = 1; h.board[sq('a4')] = 2; // a-Linie schon blockiert
  assert.ok(mv(h, 'e3', 'e4').ok);
  assert.equal(h.endCode, 'blocked');
  assert.equal(h.winner, 0);
  // Blockierte Seite gewinnt NICHT, wenn der Ziehende nur selbst blockiert wird: Schwarz zieht und sperrt Weiß
  const k = setup({ e3: 'w', e5: 'b' }, 1);
  assert.ok(mv(k, 'e5', 'e4').ok);
  assert.equal(k.endCode, 'blocked');
  assert.equal(k.winner, 1);
  // Schlagen verhindert Blockade: Bauer kann schräg schlagen
  const j = setup({ e3: 'w', e5: 'b', d5: 'b' });
  assert.ok(mv(j, 'e3', 'e4').ok);
  assert.equal(j.mode, 'play');
  assert.deepEqual(dests(j, 'd5'), ['d4', 'e4']);
  // en passant verhindert Blockade
  const q = setup({ e5: 'w', d7: 'b', h7: 'b' }, 1);
  assert.ok(mv(q, 'h7', 'h6').ok);
});

test('Blockade-Test mit Zug, nach dem beide Seiten feststecken, aber Gegner am Zug verliert', () => {
  // Schwarz: d5 blockiert von d4(w). Weiß: d4 blockiert. Weiß hat noch h2->h3 als letzten freien Zug, danach steht alles
  const g = setup({ d4: 'w', d5: 'b', h2: 'w', h4: 'b' }, 0);
  assert.ok(mv(g, 'h2', 'h3').ok); // jetzt h3/h4 gegenseitig blockiert, Schwarz hat keinen Zug
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.equal(g.endCode, 'blocked');
});

test('ungültige Züge und falsche Person ändern nichts', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  const bad = [
    ['w', { t: 'move', from: sq('e2'), to: sq('e5') }], // zu weit
    ['w', { t: 'move', from: sq('e2'), to: sq('d3') }], // schräg ohne Gegner
    ['w', { t: 'move', from: sq('e3'), to: sq('e4') }], // leeres Startfeld
    ['w', { t: 'move', from: sq('e7'), to: sq('e6') }], // gegnerischer Bauer
    ['w', { t: 'move', from: sq('e2'), to: sq('e2') }],
    ['w', { t: 'move', from: sq('e2'), to: sq('e1') }], // rückwärts
    ['b', { t: 'move', from: sq('e7'), to: sq('e6') }], // Schwarz nicht am Zug
    ['x', { t: 'move', from: sq('e2'), to: sq('e3') }], // Fremde
    ['w', { t: 'move', from: -1, to: 5 }],
    ['w', { t: 'move', from: 'e2', to: 'e3' }],
    ['w', { t: 'move', from: 1.5, to: 20 }],
    ['w', { t: 'move', from: 8, to: 99 }],
    ['w', { t: 'move' }],
    ['w', { t: 'quatsch' }],
    ['w', null],
    ['w', 'text'],
    ['w', {}],
    ['w', { t: 'next' }], // Runde läuft noch
  ];
  for (const [p, msg] of bad) {
    const r = B.handle(g, p, msg);
    assert.equal(r.ok, false, JSON.stringify(msg));
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(JSON.stringify(g), snap);
  assert.equal(B.handle(null, 'w', { t: 'move' }).ok, false);
  assert.equal(B.handle(undefined, 'w', undefined).ok, false);
  // nach Spielende keine Züge
  const h = setup({ e7: 'w', a2: 'b' });
  mv(h, 'e7', 'e8');
  assert.equal(B.handle(h, 'b', { t: 'move', from: sq('a2'), to: sq('a1') }).ok, false);
});

test('Rundenwechsel: Seitenwechsel, Punktestand, Weiß beginnt wieder', () => {
  const g = mk();
  g.board = Array(64).fill(0);
  g.board[sq('e7')] = 1; g.board[sq('a2')] = 2;
  assert.ok(mv(g, 'e7', 'e8').ok);
  assert.deepEqual(g.scores, [1, 0]);
  assert.equal(g.winner, 0); // Person 0 (Anna) hatte Weiß
  assert.equal(B.handle(g, 'w', { t: 'next' }).ok, true);
  assert.equal(g.round, 2);
  assert.equal(g.white, 1); // Bernd hat jetzt Weiß
  assert.equal(g.turn, 0);
  assert.equal(g.mode, 'play');
  assert.equal(g.moveNo, 0);
  assert.equal(g.last, null);
  assert.equal(g.winner, null);
  assert.deepEqual(g.scores, [1, 0]);
  assert.equal(B.countPawns(g.board, 0), 8);
  assert.equal(B.colorOf(g, 'b'), 0);
  assert.equal(B.colorOf(g, 'w'), 1);
  assert.equal(B.colorOf(g, 'x'), -1);
  // Bernd (Weiß) muss beginnen, Anna darf nicht
  assert.equal(B.handle(g, 'w', { t: 'move', from: sq('e7'), to: sq('e6') }).ok, false);
  assert.equal(B.handle(g, 'b', { t: 'move', from: sq('e2'), to: sq('e4') }).ok, true);
  // Runde 2: Schwarz (Anna) gewinnt durch Durchbruch -> Punkt für Anna
  g.board = Array(64).fill(0);
  g.board[sq('d2')] = 2; g.board[sq('h7')] = 1; g.turn = 1;
  assert.ok(B.handle(g, 'w', { t: 'move', from: sq('d2'), to: sq('d1') }).ok);
  assert.equal(g.winner, 0);
  assert.deepEqual(g.scores, [2, 0]);
  assert.equal(B.handle(g, 'x', { t: 'next' }).ok, false);
  assert.equal(B.handle(g, 'b', { t: 'next' }).ok, true);
  assert.equal(g.white, 0);
  assert.equal(g.round, 3);
  // Rangliste
  g.scores = [2, 2];
  assert.deepEqual(B.ranking(g).map((r) => [r.name, r.points, r.place]), [['Anna', 2, 1], ['Bernd', 2, 1]]);
  g.scores = [1, 3];
  assert.deepEqual(B.ranking(g).map((r) => [r.name, r.place]), [['Bernd', 1], ['Anna', 2]]);
  // Optionen bleiben über Runden erhalten
  const o = mk({ mustCapture: true, enpassant: false });
  o.mode = 'over';
  B.nextRound(o);
  assert.deepEqual(o.opts, { enpassant: false, mustCapture: true });
});

test('JSON-Sicherheit: Zustand übersteht Serialisierung mitten im Spiel', () => {
  const g = mk();
  const rnd = seeded(7);
  for (let i = 0; i < 12 && g.mode === 'play'; i++) {
    const ms = B.legalMoves(g);
    const m = ms[Math.floor(rnd() * ms.length)];
    assert.ok(B.move(g, pid(g), m.from, m.to).ok);
  }
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.deepEqual(B.legalMoves(copy), B.legalMoves(g));
  if (g.mode === 'play') assert.ok(B.move(copy, pid(copy), B.legalMoves(copy)[0].from, B.legalMoves(copy)[0].to).ok);
  assert.equal(JSON.stringify(g).includes('undefined'), false);
});

test('300 Zufallspartien enden immer (mit allen Optionen) und genau ein Punkt wird vergeben', () => {
  const kinds = {};
  for (let s = 1; s <= 300; s++) {
    const rnd = seeded(s);
    const g = mk({ enpassant: s % 3 !== 0, mustCapture: s % 2 === 0 });
    let plies = 0;
    while (g.mode === 'play') {
      assert.ok(plies < 120, 'Zuglänge begrenzt');
      const ms = B.legalMoves(g);
      assert.ok(ms.length > 0, 'wer am Zug ist und nicht ziehen kann, hätte schon verloren');
      const m = ms[Math.floor(rnd() * ms.length)];
      const r = B.handle(g, pid(g), { t: 'move', from: m.from, to: m.to }, rnd);
      assert.ok(r.ok, r.error);
      assert.ok(B.countPawns(g.board, 0) <= 8 && B.countPawns(g.board, 1) <= 8);
      plies++;
    }
    kinds[g.endCode] = (kinds[g.endCode] || 0) + 1;
    assert.equal(g.scores[0] + g.scores[1], 1);
    assert.ok(g.winner === 0 || g.winner === 1);
    assert.equal(g.scores[g.winner], 1);
    assert.equal(B.legalMoves(g).length, 0);
    // Folgerunde läuft an
    assert.ok(B.nextRound(g).ok);
    assert.equal(g.mode, 'play');
  }
  console.log('Endarten:', JSON.stringify(kinds));
  assert.ok(kinds.goal > 0);
});
