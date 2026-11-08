import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../stichprophet/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const mkPlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
// Karten: Farbe 0 Rot 1 Gelb 2 Grün 3 Blau; Wert 1..13
const C = (s, v) => s * 13 + (v - 1);
const [RO, GE, GR, BL] = [0, 1, 2, 3];
const Z = (i = 0) => 52 + i;
const NA = (i = 0) => 56 + i;

function game(n = 4, seed = 1, opts = {}) { return M.createGame(mkPlayers(n), opts, seeded(seed), 'p0'); }
const allCards = (g) => {
  const all = [];
  for (const p of g.players) all.push(...p.hand);
  all.push(...g.played);
  for (const t of g.trick.cards) all.push(t.card);
  if (g.upcard !== null) all.push(g.upcard);
  return all;
};
// Spielphase mit festen Händen herstellen
function setup({ hands, trump = 'none', turn = 0, bids, trick = [], round } = {}) {
  const n = hands.length;
  const g = game(n, 3);
  g.round = round || hands[0].length + 0;
  g.totalRounds = Math.max(g.totalRounds, g.round);
  g.trump = trump; g.upcard = null; g.phase = 'play'; g.dealer = (turn + n - 1) % n; g.leader = turn; g.turn = turn;
  g.players.forEach((p, i) => { p.hand = hands[i].slice(); p.bid = bids ? bids[i] : 0; p.tricks = 0; p.delta = 0; p.score = 0; });
  g.trick = { cards: trick.map(([pid, card]) => ({ pid, card })) };
  g.played = []; g.last = null; g.sheet = [];
  return g;
}
const play = (g, pid, card) => M.handle(g, pid, { t: 'play', card });

test('Blatt: 60 verschiedene Karten, 52 Farbkarten, 4 Zauberer, 4 Narren', () => {
  const names = new Set();
  let wiz = 0, fool = 0, suits = [0, 0, 0, 0];
  for (let i = 0; i < 60; i++) {
    assert.ok(M.isCardId(i));
    if (M.isWizard(i)) wiz++; else if (M.isFool(i)) fool++; else { suits[M.suitOf(i)]++; assert.ok(M.rankOf(i) >= 1 && M.rankOf(i) <= 13); names.add(M.cardName(i)); }
  }
  assert.equal(wiz, 4); assert.equal(fool, 4); assert.deepEqual(suits, [13, 13, 13, 13]);
  assert.equal(names.size, 52);
  assert.equal(M.cardName(Z()), 'Zauberer'); assert.equal(M.cardName(NA()), 'Narr');
  assert.equal(M.cardName(C(GR, 7)), 'Grün 7');
  assert.ok(!M.isCardId(60) && !M.isCardId(-1) && !M.isCardId(1.5) && !M.isCardId('3'));
});

test('Rundenanzahl je Personenzahl und Kurzspiel', () => {
  assert.deepEqual([3, 4, 5, 6].map((n) => game(n).totalRounds), [20, 15, 12, 10]);
  assert.deepEqual([3, 4, 5, 6].map((n) => game(n, 1, { short: true }).totalRounds), [10, 8, 6, 5]);
  assert.equal(game(4, 1, { totalRounds: 4 }).totalRounds, 4);
  assert.equal(game(4, 1, { totalRounds: 99 }).totalRounds, 15, 'zu große Rundenzahl wird ignoriert');
  assert.throws(() => M.createGame(mkPlayers(2), {}, seeded(1)));
  assert.throws(() => M.createGame(mkPlayers(7), {}, seeded(1)));
  assert.throws(() => M.createGame('x', {}, seeded(1)));
});

test('Austeilen: je Runde r Karten, alle verschieden, Rest = 60 - n*r', () => {
  for (const n of [3, 4, 5, 6]) {
    const g = game(n, 5 + n);
    for (let r = 1; r <= M.maxRounds(n); r++) {
      assert.equal(g.round, r);
      for (const p of g.players) assert.equal(p.hand.length, r, `n=${n} r=${r}`);
      const all = allCards(g);
      assert.equal(new Set(all).size, all.length, 'keine doppelten Karten');
      assert.equal(all.length, n * r + (g.upcard === null ? 0 : 1));
      if (n * r === 60) assert.equal(g.upcard, null, 'letzte Runde: keine Aufdeckkarte');
      else assert.notEqual(g.upcard, null);
      if (r < M.maxRounds(n)) {
        // Runde schnell durchspielen
        g.phase === 'trump' && M.handle(g, g.players[g.turn].id, { t: 'trump', suit: 0 });
        while (g.phase === 'bid') M.handle(g, g.players[g.turn].id, { t: 'bid', n: 0 });
        while (g.phase === 'play') { const id = g.players[g.turn].id; play(g, id, M.legalCards(g, id)[0]); }
        assert.equal(g.phase, 'round_over');
        assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, true);
      }
    }
  }
});

test('Geber wechselt jede Runde, links vom Geber beginnt', () => {
  const g = game(4, 2, { dealer: 1 });
  assert.equal(g.dealer, 1); assert.equal(g.leader, 2);
  if (g.phase === 'bid') assert.equal(g.turn, 2);
  g.phase === 'trump' && M.handle(g, g.players[g.turn].id, { t: 'trump', suit: 0 });
  assert.equal(g.turn, 2);
  while (g.phase === 'bid') M.handle(g, g.players[g.turn].id, { t: 'bid', n: 0 });
  assert.equal(g.turn, 2);
  while (g.phase === 'play') { const id = g.players[g.turn].id; play(g, id, M.legalCards(g, id)[0]); }
  M.handle(g, 'p0', { t: 'next' });
  assert.equal(g.dealer, 2);
});

test('Trumpfbestimmung: Farbkarte, Narr, Zauberer, letzte Runde', () => {
  const seen = { suit: 0, fool: 0, wiz: 0 };
  for (let seed = 1; seed < 200; seed++) {
    const g = game(4, seed);
    if (M.isFool(g.upcard)) { assert.equal(g.trump, 'none'); assert.equal(g.phase, 'bid'); seen.fool++; }
    else if (M.isWizard(g.upcard)) {
      assert.equal(g.trump, null); assert.equal(g.phase, 'trump'); assert.equal(g.turn, g.dealer); seen.wiz++;
      // nur der Geber wählt
      const other = g.players[(g.dealer + 1) % 4].id;
      assert.equal(M.handle(g, other, { t: 'trump', suit: 1 }).ok, false);
      assert.equal(M.handle(g, g.players[g.dealer].id, { t: 'bid', n: 0 }).ok, false, 'noch nicht ansagen');
      assert.equal(M.handle(g, g.players[g.dealer].id, { t: 'trump', suit: 9 }).ok, false);
      assert.equal(M.handle(g, g.players[g.dealer].id, { t: 'trump', suit: 'none' }).ok, false);
      assert.equal(M.handle(g, g.players[g.dealer].id, { t: 'trump', suit: 2 }).ok, true);
      assert.equal(g.trump, 2); assert.equal(g.phase, 'bid'); assert.equal(g.turn, g.leader);
      assert.equal(M.handle(g, g.players[g.dealer].id, { t: 'trump', suit: 1 }).ok, false, 'nur einmal');
    } else { assert.equal(g.trump, M.suitOf(g.upcard)); assert.equal(g.phase, 'bid'); seen.suit++; }
  }
  assert.ok(seen.suit && seen.fool && seen.wiz, JSON.stringify(seen));
  // letzte Runde: kein Trumpf
  const g = game(6, 4);
  g.round = 10; g.phase = 'round_over';
  g.totalRounds = 10;
  g.round = 9; g.phase = 'round_over';
  M.nextRound(g, seeded(9));
  assert.equal(g.round, 10);
  assert.equal(g.upcard, null); assert.equal(g.trump, 'none'); assert.equal(g.phase, 'bid');
  for (const p of g.players) assert.equal(p.hand.length, 10);
});

test('Ansagen: Reihenfolge, Grenzen, falsche Person, Phase', () => {
  const g = game(4, 11, { dealer: 3 });
  if (g.phase === 'trump') M.handle(g, 'p3', { t: 'trump', suit: 0 });
  assert.equal(g.phase, 'bid');
  assert.equal(M.handle(g, 'p1', { t: 'bid', n: 0 }).ok, false, 'nicht dran');
  assert.equal(M.handle(g, 'p0', { t: 'play', card: g.players[0].hand[0] }).ok, false, 'noch nicht spielen');
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: -1 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: 2 }).ok, false, 'mehr als Karten');
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: 0.5 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: '1' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: 1 }).ok, true);
  assert.equal(g.turn, 1);
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: 0 }).ok, false, 'doppelt');
  for (const id of ['p1', 'p2', 'p3']) assert.equal(M.handle(g, id, { t: 'bid', n: 0 }).ok, true);
  assert.equal(g.phase, 'play'); assert.equal(g.turn, 0);
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: 0 }).ok, false, 'Ansage vorbei');
});

test('Option „Der Letzte darf nicht ausgleichen“', () => {
  const g = game(4, 6, { dealer: 3, lastNotEqual: true });
  // Runde mit 3 Karten herstellen
  g.round = 3; g.totalRounds = 15;
  for (const p of g.players) { p.hand = [C(RO, 1), C(RO, 2), C(RO, 3)]; p.bid = null; }
  g.phase = 'bid'; g.turn = 0; g.trump = 'none';
  M.handle(g, 'p0', { t: 'bid', n: 1 }); M.handle(g, 'p1', { t: 'bid', n: 1 }); M.handle(g, 'p2', { t: 'bid', n: 0 });
  assert.equal(M.forbiddenBid(g, 'p3'), 1);
  assert.equal(M.forbiddenBid(g, 'p2'), null);
  const r = M.handle(g, 'p3', { t: 'bid', n: 1 });
  assert.equal(r.ok, false); assert.match(r.error, /Letzte/);
  assert.equal(g.phase, 'bid');
  assert.equal(M.handle(g, 'p3', { t: 'bid', n: 2 }).ok, true);
  // Summe darf auch über der Kartenzahl liegen; verbotene Zahl außerhalb 0..r ist kein Verbot
  const h = game(3, 6, { dealer: 2, lastNotEqual: true });
  h.round = 2; for (const p of h.players) { p.hand = [C(RO, 1), C(RO, 2)]; p.bid = null; }
  h.phase = 'bid'; h.turn = 0; h.trump = 'none';
  M.handle(h, 'p0', { t: 'bid', n: 2 }); M.handle(h, 'p1', { t: 'bid', n: 1 });
  assert.equal(M.forbiddenBid(h, 'p2'), null, 'Summe 3 > 2: nichts verboten');
  assert.equal(M.handle(h, 'p2', { t: 'bid', n: 0 }).ok, true);
  // ohne Option ist alles erlaubt
  const k = game(3, 6, { dealer: 2 });
  assert.equal(k.opts.lastNotEqual, false);
  k.round = 1; for (const p of k.players) { p.hand = [C(RO, 1)]; p.bid = null; }
  k.phase = 'bid'; k.turn = 0; k.trump = 'none';
  M.handle(k, 'p0', { t: 'bid', n: 1 }); M.handle(k, 'p1', { t: 'bid', n: 0 });
  assert.equal(M.forbiddenBid(k, 'p2'), null);
  assert.equal(M.handle(k, 'p2', { t: 'bid', n: 0 }).ok, true);
});

test('Bedienpflicht: Farbe zugeben; Zauberer und Narren immer erlaubt', () => {
  // Rot ausgespielt; p1 hat Rot, Gelb, Zauberer, Narr
  const g = setup({ hands: [[C(RO, 5), C(GE, 1)], [C(RO, 3), C(GE, 2), Z(), NA()], [C(BL, 1), C(BL, 2), C(BL, 3), C(BL, 4)]], turn: 0, round: 4 });
  // Karten pro Hand wie gesetzt (Längen egal für diese Prüfung)
  assert.equal(play(g, 'p0', C(RO, 5)).ok, true);
  const legal = M.legalCards(g, 'p1').sort((a, b) => a - b);
  assert.deepEqual(legal, [C(RO, 3), Z(), NA()].sort((a, b) => a - b));
  const bad = play(g, 'p1', C(GE, 2));
  assert.equal(bad.ok, false); assert.match(bad.error, /Farbe bekennen/);
  assert.equal(g.players[1].hand.length, 4, 'Zustand unverändert');
  assert.equal(play(g, 'p1', NA()).ok, true, 'Narr bei Farbzwang erlaubt');
  // p2 hat kein Rot: alles erlaubt
  assert.equal(M.legalCards(g, 'p2').length, 4);
  // Zauberer bei Farbzwang
  const h = setup({ hands: [[C(RO, 5), C(GE, 1)], [C(RO, 3), Z()], [C(BL, 1), C(BL, 2)]], turn: 0, round: 2 });
  play(h, 'p0', C(RO, 5));
  assert.equal(play(h, 'p1', Z()).ok, true);
});

test('Anspiel Narr: nächste Nicht-Narren-Karte bestimmt die Farbe; Zauberer als Anspiel: kein Farbzwang', () => {
  const g = setup({ hands: [[NA(), C(GE, 1)], [C(RO, 3), C(GE, 9)], [C(RO, 8), C(BL, 2)], [C(BL, 5), C(BL, 6)]], turn: 0, round: 2 });
  play(g, 'p0', NA());
  assert.equal(M.legalCards(g, 'p1').length, 2, 'nur Narr gelegt: alles erlaubt');
  play(g, 'p1', C(RO, 3));
  assert.equal(M.ledSuitOf(g.trick.cards.map((t) => t.card)), RO);
  assert.deepEqual(M.legalCards(g, 'p2'), [C(RO, 8)], 'Rot ist maßgebend, p2 hat Rot');
  play(g, 'p2', C(RO, 8));
  assert.equal(M.legalCards(g, 'p3').length, 2, 'p3 hat kein Rot: alles erlaubt');
  // Zauberer als Anspiel
  const h = setup({ hands: [[Z(), C(GE, 1)], [C(RO, 3), C(GE, 9)], [C(RO, 8), C(BL, 2)]], turn: 0, round: 2 });
  play(h, 'p0', Z());
  assert.equal(M.legalCards(h, 'p1').length, 2);
  play(h, 'p1', C(RO, 3));
  assert.equal(M.legalCards(h, 'p2').length, 2, 'Rot gelegt, aber Zauberer war Anspiel: kein Farbzwang');
  // Narr, dann Zauberer, dann Farbkarte: kein Farbzwang (erste Nicht-Narren-Karte ist Zauberer)
  const k = setup({ hands: [[NA(), C(GE, 1)], [Z(), C(GE, 9)], [C(RO, 8), C(BL, 2)]], turn: 0, round: 2 });
  play(k, 'p0', NA()); play(k, 'p1', Z());
  assert.equal(M.legalCards(k, 'p2').length, 2);
});

test('Stichgewinner: Zauberer, mehrere Zauberer, Trumpf, Farbe, nur Narren', () => {
  const w = (ids, trump = -1) => M.winnerIndex(ids, trump);
  // erster Zauberer gewinnt (auch wenn nicht an erster Stelle, auch bei mehreren)
  assert.equal(w([C(RO, 13), Z(1), C(BL, 2), Z(2)], BL), 1);
  assert.equal(w([Z(0), Z(1)]), 0);
  assert.equal(w([NA(), NA(1), Z(3), C(RO, 1)]), 2);
  // höchster Trumpf, wenn kein Zauberer
  assert.equal(w([C(RO, 13), C(BL, 2), C(BL, 9), C(GE, 12)], BL), 2);
  assert.equal(w([C(BL, 13), C(BL, 2), C(RO, 13)], BL), 0, 'höherer Trumpf vorn');
  // Trumpf schlägt ausgespielte Farbe
  assert.equal(w([C(RO, 13), C(GE, 1), C(GR, 1)], GE), 1);
  // ohne Trumpf: höchste der ausgespielten Farbe; andere Farben gewinnen nie
  assert.equal(w([C(RO, 4), C(GE, 13), C(RO, 9), C(BL, 13)], -1), 2);
  assert.equal(w([C(RO, 4), C(GE, 13), C(RO, 3)], GR), 0, 'Trumpffarbe nicht im Stich');
  // Narr zuerst: nächste Farbkarte bestimmt die Farbe
  assert.equal(w([NA(), C(GE, 3), C(RO, 13), C(GE, 7)], -1), 3);
  assert.equal(w([NA(), C(GE, 3)], -1), 1);
  // alle Narren: erster gewinnt
  assert.equal(w([NA(2), NA(0), NA(1)]), 0);
  // Narr schlägt nichts
  assert.equal(w([C(RO, 1), NA()], RO), 0);
  // Trumpf-Narr-Zauberer-Mischung
  assert.equal(w([C(BL, 13), NA(), Z(0)], BL), 2);
  // Trumpf nach Narr als Anspiel
  assert.equal(w([NA(), C(RO, 2), C(BL, 1)], BL), 2);
});

test('Spielverlauf: Stich wird gewertet, Gewinner spielt aus, Wertung richtig/falsch', () => {
  // 3 Personen, 2 Karten: p0 sagt 1, p1 sagt 2, p2 sagt 0 an
  const g = setup({
    hands: [[C(RO, 10), C(GE, 5)], [C(RO, 12), C(GE, 9)], [C(RO, 2), C(GE, 1)]],
    bids: [1, 2, 0], trump: 'none', turn: 0, round: 2,
  });
  g.totalRounds = 2;
  play(g, 'p0', C(RO, 10)); play(g, 'p1', C(RO, 12)); play(g, 'p2', C(RO, 2));
  assert.equal(g.players[1].tricks, 1); assert.equal(g.turn, 1); assert.equal(g.leader, 1);
  assert.equal(g.last.winner, 'p1'); assert.equal(g.played.length, 3); assert.equal(g.trick.cards.length, 0);
  play(g, 'p1', C(GE, 9)); play(g, 'p2', C(GE, 1)); play(g, 'p0', C(GE, 5));
  assert.equal(g.players[1].tricks, 2);
  assert.equal(g.phase, 'over');
  const d = Object.fromEntries(g.result.rows.map((r) => [r.id, r.delta]));
  assert.equal(d.p0, -10, 'p0: 1 angesagt, 0 gemacht');
  assert.equal(d.p1, 20 + 20, 'p1: 2 angesagt, 2 gemacht');
  assert.equal(d.p2, 20, 'p2: 0 angesagt, 0 gemacht');
  assert.deepEqual(g.players.map((p) => p.score), [-10, 40, 20]);
  assert.deepEqual(g.result.winners, ['p1']);
  assert.equal(g.sheet.length, 1);
});

test('Wertung: Formel', () => {
  assert.equal(M.roundPoints(0, 0), 20);
  assert.equal(M.roundPoints(3, 3), 50);
  assert.equal(M.roundPoints(2, 0), -20);
  assert.equal(M.roundPoints(0, 4), -40);
  assert.equal(M.roundPoints(5, 4), -10);
  assert.equal(M.roundPoints(20, 20), 220);
});

test('Gleichstand am Ende: alle mit der höchsten Punktzahl gewinnen', () => {
  const g = setup({ hands: [[C(RO, 10)], [C(RO, 12)], [C(RO, 2)]], bids: [0, 0, 0], round: 1, turn: 0 });
  g.totalRounds = 1;
  play(g, 'p0', C(RO, 10)); play(g, 'p1', C(RO, 12)); play(g, 'p2', C(RO, 2));
  // p0 und p2 richtig (0/0) = 20, p1 gewinnt den Stich = -10
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result.winners.sort(), ['p0', 'p2']);
  const rk = M.ranking(g);
  assert.equal(rk[0].rank, 1); assert.equal(rk[1].rank, 1); assert.equal(rk[2].rank, 3);
});

test('„Nächste Runde“: nur Gastgeber, nur nach Rundenende; Punkte bleiben', () => {
  const g = setup({ hands: [[C(RO, 10)], [C(RO, 12)], [C(RO, 2)]], bids: [0, 1, 0], round: 1, turn: 0 });
  g.totalRounds = 3;
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false, 'Runde läuft');
  play(g, 'p0', C(RO, 10)); play(g, 'p1', C(RO, 12)); play(g, 'p2', C(RO, 2));
  assert.equal(g.phase, 'round_over');
  const before = g.players.map((p) => p.score);
  assert.equal(M.handle(g, 'p1', { t: 'next' }).ok, false, 'nur Gastgeber');
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, true);
  assert.equal(g.round, 2);
  assert.deepEqual(g.players.map((p) => p.score), before);
  for (const p of g.players) { assert.equal(p.hand.length, 2); assert.equal(p.tricks, 0); assert.equal(p.bid, null); }
});

test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = game(4, 8, { dealer: 3 });
  if (g.phase === 'trump') M.handle(g, 'p3', { t: 'trump', suit: 0 });
  for (const m of [null, undefined, 5, 'x', {}, { t: 7 }, { t: 'foo' }, { t: 'bid' }, { t: 'bid', n: null }, { t: 'play' }, { t: 'trump' }]) {
    const r = M.handle(g, 'p0', m);
    assert.equal(r.ok, false);
  }
  assert.equal(M.handle(g, 'fremd', { t: 'bid', n: 0 }).ok, false);
  assert.equal(M.handle(null, 'p0', { t: 'bid', n: 0 }).ok, false);
  assert.equal(M.handle({ game: 'x' }, 'p0', { t: 'bid', n: 0 }).ok, false);
  // Spielphase
  while (g.phase === 'bid') M.handle(g, g.players[g.turn].id, { t: 'bid', n: 0 });
  assert.equal(M.handle(g, 'p0', { t: 'bid', n: 0 }).ok, false);
  const snap = JSON.stringify(g);
  assert.equal(play(g, 'p1', g.players[1].hand[0]).ok, false, 'nicht dran');
  assert.equal(play(g, 'p0', 99).ok, false);
  assert.equal(play(g, 'p0', 'a').ok, false);
  assert.equal(play(g, 'p0', g.players[1].hand[0]).ok, false, 'fremde Karte');
  assert.equal(JSON.stringify(g), snap, 'Fehlversuche ändern nichts');
});

test('Zustand ist reines JSON (verlustfrei)', () => {
  const g = game(5, 4);
  g.phase === 'trump' && M.handle(g, g.players[g.turn].id, { t: 'trump', suit: 1 });
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  while (g.phase === 'bid') M.handle(g, g.players[g.turn].id, { t: 'bid', n: 0 });
  const id = g.players[g.turn].id;
  play(g, id, M.legalCards(g, id)[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  // weiterspielen mit der Kopie ergibt dasselbe wie mit dem Original
  const c2 = JSON.parse(JSON.stringify(g));
  const id2 = g.players[g.turn].id;
  const card = M.legalCards(g, id2)[0];
  play(g, id2, card); play(c2, id2, card);
  assert.deepEqual(c2, g);
});

test('300 Zufallsspiele enden immer, Kartenbilanz stimmt immer (60)', () => {
  for (let k = 0; k < 300; k++) {
    const n = 3 + (k % 4);
    const rng = seeded(1000 + k);
    const g = M.createGame(mkPlayers(n), { short: k % 3 === 0, lastNotEqual: k % 2 === 0 }, rng, 'p0');
    let steps = 0;
    while (g.phase !== 'over') {
      assert.ok(steps++ < 20000, 'Endlosschleife?');
      if (g.phase === 'round_over') {
        const rows = g.result.rows;
        for (const r of rows) assert.equal(r.delta, M.roundPoints(r.bid, r.tricks));
        assert.equal(rows.reduce((s, r) => s + r.tricks, 0), g.round, 'Stiche ergeben Kartenzahl');
        assert.equal(M.handle(g, 'p0', { t: 'next' }, rng).ok, true);
        continue;
      }
      // Kartenbilanz: Hände + gespielt + Stich + Aufdeckkarte + Rest = 60
      const inGame = allCards(g).length;
      const rest = 60 - g.round * n - (g.upcard === null ? 0 : 1);
      assert.equal(inGame + rest, 60);
      assert.ok(rest >= 0);
      const p = g.players[g.turn];
      let msg;
      if (g.phase === 'trump') msg = { t: 'trump', suit: Math.floor(rng() * 4) };
      else if (g.phase === 'bid') {
        const f = M.forbiddenBid(g, p.id);
        let b = Math.floor(rng() * (g.round + 1));
        if (b === f) b = (b + 1) % (g.round + 1);
        msg = { t: 'bid', n: b };
      } else { const l = M.legalCards(g, p.id); assert.ok(l.length > 0); msg = { t: 'play', card: l[Math.floor(rng() * l.length)] }; }
      const r = M.handle(g, p.id, msg, rng);
      assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
    }
    assert.equal(g.round, g.totalRounds);
    assert.equal(g.sheet.length, g.totalRounds);
    assert.ok(g.result.winners.length >= 1);
    const best = Math.max(...g.players.map((p) => p.score));
    for (const id of g.result.winners) assert.equal(g.players.find((p) => p.id === id).score, best);
    // Punktesumme = Summe der Blätter
    for (const p of g.players) assert.equal(p.score, g.sheet.reduce((s, sh) => s + sh.rows.find((x) => x.id === p.id).delta, 0));
  }
});
