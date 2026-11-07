import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../bauernskat/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P2 = [{ id: 'p0', name: 'Anna' }, { id: 'p1', name: 'Bernd' }];
// Karten: Farbe 0 Kreuz 1 Pik 2 Herz 3 Karo; Wert 0=7 1=8 2=9 3=10 4=B 5=D 6=K 7=A
const C = (s, r) => s * 8 + r;
const [R7, R8, R9, R10, RB, RD, RK, RA] = [0, 1, 2, 3, 4, 5, 6, 7];
const KR = 0, PI = 1, HE = 2, KA = 3;

function game(seed = 1, opts = {}) { return M.createGame(P2, opts, seeded(seed), 'p0'); }
const idsOf = (g) => {
  const all = [];
  for (const p of g.players) { for (const c of p.cols) { if (c.up !== null) all.push(c.up); if (c.down !== null) all.push(c.down); } all.push(...p.won); }
  for (const t of g.trick.cards) all.push(t.card);
  return all;
};

// Zustand in der Spielphase mit festen offenen Karten bauen (verdeckte Karten: Rest beliebig)
function setup({ ups0, ups1, trump = KR, turn = 0, downs0, downs1, trick = [] } = {}) {
  const g = game(7);
  g.trump = trump; g.phase = 'play'; g.turn = turn; g.leader = turn; g.trick = { cards: [] }; g.last = null;
  const fill = (p, ups, downs) => {
    p.cols = Array.from({ length: 8 }, (_, k) => ({ up: ups[k] === undefined ? null : ups[k], down: downs && downs[k] !== undefined ? downs[k] : null }));
    p.won = []; p.tricks = 0; p.points = 0;
  };
  fill(g.players[0], ups0, downs0); fill(g.players[1], ups1, downs1);
  g.trick = { cards: trick.map((t) => ({ ...t })) };
  return g;
}

test('Blatt: 32 verschiedene Karten, Augensumme 120, je Farbe 30', () => {
  const sum = Array.from({ length: 32 }, (_, i) => M.cardValue(i)).reduce((a, b) => a + b, 0);
  assert.equal(sum, 120);
  for (let s = 0; s < 4; s++) assert.equal([0, 1, 2, 3, 4, 5, 6, 7].reduce((a, r) => a + M.cardValue(C(s, r)), 0), 30);
  assert.equal(M.cardValue(C(0, RA)), 11);
  assert.equal(M.cardValue(C(0, R10)), 10);
  assert.equal(M.cardValue(C(0, RK)), 4);
  assert.equal(M.cardValue(C(0, RD)), 3);
  assert.equal(M.cardValue(C(0, RB)), 2);
  for (const r of [R7, R8, R9]) assert.equal(M.cardValue(C(2, r)), 0);
  assert.equal(M.cardLabel(C(2, RD)), '♥ Dame');
  assert.equal(M.cardName(C(0, RB)), 'Kreuz Bube');
});

test('Austeilen: 8 Spalten je Person mit verdeckter und offener Karte, alle 32 Karten genau einmal', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = game(seed);
    assert.equal(g.game, 'bsk');
    assert.equal(g.players.length, 2);
    for (const p of g.players) {
      assert.equal(p.cols.length, 8);
      for (const c of p.cols) { assert.ok(M.isCardId(c.down)); assert.ok(M.isCardId(c.up)); }
      assert.deepEqual([p.won.length, p.tricks, p.points, p.score], [0, 0, 0, 0]);
    }
    const all = idsOf(g);
    assert.equal(all.length, 32);
    assert.equal(new Set(all).size, 32);
    assert.equal(g.phase, 'trump');
    assert.equal(g.leader, 1 - g.dealer, 'Vorhand ist, wer nicht gegeben hat');
    assert.equal(g.turn, g.leader);
    assert.equal(g.trump, null);
    assert.equal(g.round, 1);
    assert.deepEqual(g.trick, { cards: [] });
  }
});

test('Erster Geber kommt aus rng, Optionen werden normalisiert, Fehler bei falscher Personenzahl', () => {
  const dealers = new Set();
  for (let s = 1; s < 40; s++) dealers.add(game(s).dealer);
  assert.deepEqual([...dealers].sort(), [0, 1]);
  assert.equal(M.createGame(P2, { dealer: 1 }, seeded(2)).dealer, 1);
  assert.equal(M.createGame(P2, { dealer: 0 }, seeded(2)).dealer, 0);
  const g = M.createGame(P2, { hints: 1, showPoints: 'x', foo: 3, target: 3 }, seeded(2), 'p1');
  assert.deepEqual(g.opts, { hints: true, showPoints: true, grandDouble: true, target: 3 });
  assert.equal(g.hostId, 'p1');
  assert.deepEqual(M.createGame(P2, undefined, seeded(2)).opts, { hints: false, showPoints: false, grandDouble: true, target: 5 });
  assert.equal(M.createGame(P2, { target: 'x' }, seeded(2)).opts.target, 5);
  assert.equal(M.createGame(P2, { grandDouble: false }, seeded(2)).opts.grandDouble, false);
  assert.equal(M.createGame(P2, {}, seeded(2)).hostId, 'p0');
  assert.throws(() => M.createGame([P2[0]]));
  assert.throws(() => M.createGame([...P2, { id: 'p2', name: 'C' }]));
  assert.throws(() => M.createGame('x'));
  assert.equal(JSON.stringify(game(5)), JSON.stringify(game(5)), 'deterministisch');
});

test('Zustand ist reines JSON (auch mitten im Spiel)', () => {
  const g = game(3);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  M.handle(g, g.players[g.turn].id, { t: 'trump', suit: 'grand' });
  M.handle(g, g.players[g.turn].id, { t: 'play', col: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('Trumpfreihenfolge: Buben Kreuz > Pik > Herz > Karo, dann Trumpffarbe A,10,K,D,9,8,7', () => {
  const g = setup({ ups0: [], ups1: [], trump: HE });
  const order = [C(KR, RB), C(PI, RB), C(HE, RB), C(KA, RB), C(HE, RA), C(HE, R10), C(HE, RK), C(HE, RD), C(HE, R9), C(HE, R8), C(HE, R7)];
  for (const id of order) assert.ok(M.isTrump(g, id), M.cardName(id));
  for (let i = 0; i + 1 < order.length; i++) assert.ok(M.power(g, order[i]) > M.power(g, order[i + 1]), `${M.cardName(order[i])} > ${M.cardName(order[i + 1])}`);
  assert.deepEqual(M.sortCards(g, [...order].reverse()), order);
  // Nichttrumpf-Farbe: Ass, 10, König, Dame, 9, 8, 7 – Bube gehört nicht dazu
  const non = [RA, R10, RK, RD, R9, R8, R7].map((r) => C(KR, r));
  for (const id of non) { assert.ok(!M.isTrump(g, id)); assert.equal(M.groupOf(g, id), KR); }
  for (let i = 0; i + 1 < non.length; i++) assert.ok(M.power(g, non[i]) > M.power(g, non[i + 1]));
  assert.equal(M.groupOf(g, C(HE, RA)), 4);
  assert.equal(M.groupOf(g, C(KR, RB)), 4, 'Kreuz-Bube ist Trumpf, nicht Kreuz');
});

test('Grand: nur die vier Buben sind Trumpf, alle Farben normal', () => {
  const g = setup({ ups0: [], ups1: [], trump: 'grand' });
  for (let s = 0; s < 4; s++) for (let r = 0; r < 8; r++) assert.equal(M.isTrump(g, C(s, r)), r === RB, `${s}/${r}`);
  assert.ok(M.power(g, C(KR, RB)) > M.power(g, C(PI, RB)));
  assert.ok(M.power(g, C(HE, RB)) > M.power(g, C(KA, RB)));
  assert.ok(M.power(g, C(KA, RB)) > M.power(g, C(KR, RA)) || M.groupOf(g, C(KA, RB)) !== M.groupOf(g, C(KR, RA)));
  assert.equal(M.groupOf(g, C(HE, RA)), HE);
  // vor der Trumpfwahl (trump null) zählen nur Buben als Trumpf
  const h = game(1);
  assert.equal(h.trump, null);
  assert.ok(M.isTrump(h, C(2, RB)) && !M.isTrump(h, C(2, RA)));
});

const tr = (a, b) => ({ cards: [{ pid: 'p0', card: a, col: 0 }, { pid: 'p1', card: b, col: 0 }] });

test('Stichwertung: gleiche Farbe, höhere Karte gewinnt', () => {
  const g = setup({ ups0: [], ups1: [], trump: KA });
  assert.equal(M.trickWinner(g, tr(C(KR, RK), C(KR, RA))), 'p1');
  assert.equal(M.trickWinner(g, tr(C(KR, RA), C(KR, RK))), 'p0');
  assert.equal(M.trickWinner(g, tr(C(KR, R10), C(KR, RK))), 'p0', '10 schlägt König');
  assert.equal(M.trickWinner(g, tr(C(KR, RD), C(KR, R9))), 'p0');
  assert.equal(M.trickWinner(g, tr(C(KR, R8), C(KR, R7))), 'p0');
});
test('Stichwertung: andere Nichttrumpf-Farbe sticht nicht, Trumpf sticht, Bube sticht', () => {
  const g = setup({ ups0: [], ups1: [], trump: KA });
  assert.equal(M.trickWinner(g, tr(C(KR, R7), C(PI, RA))), 'p0', 'Abwurf einer anderen Farbe verliert');
  assert.equal(M.trickWinner(g, tr(C(KR, RA), C(KA, R7))), 'p1', 'kleinster Trumpf sticht Ass');
  assert.equal(M.trickWinner(g, tr(C(KR, RA), C(HE, RB))), 'p1', 'Bube sticht Ass');
  assert.equal(M.trickWinner(g, tr(C(KA, RA), C(KR, RB))), 'p1', 'Bube sticht Trumpf-Ass');
  assert.equal(M.trickWinner(g, tr(C(KA, R7), C(PI, RA))), 'p0', 'Trumpf gespielt, Fremdfarbe verliert');
});
test('Stichwertung: höchster Trumpf gewinnt (Buben-Reihenfolge, Trumpffarbe)', () => {
  const g = setup({ ups0: [], ups1: [], trump: HE });
  assert.equal(M.trickWinner(g, tr(C(KR, RB), C(PI, RB))), 'p0');
  assert.equal(M.trickWinner(g, tr(C(KA, RB), C(HE, RB))), 'p1');
  assert.equal(M.trickWinner(g, tr(C(HE, RB), C(KR, RB))), 'p1');
  assert.equal(M.trickWinner(g, tr(C(PI, RB), C(HE, RA))), 'p0', 'jeder Bube schlägt jeden Trumpf der Farbe');
  assert.equal(M.trickWinner(g, tr(C(HE, RA), C(HE, R10))), 'p0');
  assert.equal(M.trickWinner(g, tr(C(HE, R7), C(HE, R8))), 'p1');
  // Grand: Karo-Bube sticht Ass, Kreuz-Bube sticht Karo-Bube
  const gr = setup({ ups0: [], ups1: [], trump: 'grand' });
  assert.equal(M.trickWinner(gr, tr(C(HE, RA), C(KA, RB))), 'p1');
  assert.equal(M.trickWinner(gr, tr(C(KA, RB), C(KR, RB))), 'p1');
  assert.equal(M.trickWinner(gr, tr(C(KR, R7), C(KR, RA))), 'p1');
  assert.equal(M.trickWinner(gr, tr(C(KR, R7), C(HE, RA))), 'p0');
});

test('Bedienpflicht: Farbe zugeben, wenn offene Karte dieser Farbe da; sonst frei', () => {
  const g = setup({
    ups0: [C(KR, RA)], ups1: [C(KR, R7), C(KR, R8), C(PI, RA), C(HE, R9), C(KA, RB), undefined, C(PI, R7)], trump: KA, turn: 1,
    trick: [{ pid: 'p0', card: C(KR, RK), col: 0 }],
  });
  assert.deepEqual(M.legalCols(g, 'p1'), [0, 1], 'nur Kreuz (Kreuz-Bube ist Trumpf, kein Kreuz)');
  assert.deepEqual(M.legalCols(g, 'p0'), [], 'nicht dran');
  // keine Karte der Farbe offen -> alles frei (leere Spalte 5 nicht)
  const h = setup({
    ups0: [C(KR, RA)], ups1: [C(PI, RA), C(HE, R9), C(KA, RB), undefined, C(PI, R7)], trump: KA, turn: 1,
    trick: [{ pid: 'p0', card: C(KR, RK), col: 0 }],
  });
  assert.deepEqual(M.legalCols(h, 'p1'), [0, 1, 2, 4]);
});
test('Bedienpflicht: Trumpf muss bedient werden (Buben + Trumpffarbe), Bube ausgespielt = Trumpf', () => {
  const ups1 = [C(HE, R7), C(KR, RB), C(PI, RA), C(KA, RA)];
  const a = setup({ ups0: [C(HE, RA)], ups1, trump: HE, turn: 1, trick: [{ pid: 'p0', card: C(HE, RA), col: 0 }] });
  assert.deepEqual(M.legalCols(a, 'p1'), [0, 1], 'Herz-7 und Kreuz-Bube sind Trumpf');
  const b = setup({ ups0: [C(PI, RB)], ups1, trump: HE, turn: 1, trick: [{ pid: 'p0', card: C(PI, RB), col: 0 }] });
  assert.deepEqual(M.legalCols(b, 'p1'), [0, 1], 'Bube ausgespielt: Trumpf bedienen');
  const c = setup({ ups0: [C(PI, RB)], ups1: [C(PI, RA), C(KA, R9)], trump: 'grand', turn: 1, trick: [{ pid: 'p0', card: C(PI, RB), col: 0 }] });
  assert.deepEqual(M.legalCols(c, 'p1'), [0, 1], 'Grand, kein Bube offen: frei');
  // Fremdfarbe ausgespielt, Trumpf darf (muss nicht) zugegeben werden, wenn Farbe fehlt
  const d = setup({ ups0: [C(PI, RK)], ups1: [C(KA, R7), C(HE, R8), C(KR, RB)], trump: KA, turn: 1, trick: [{ pid: 'p0', card: C(PI, RK), col: 0 }] });
  assert.deepEqual(M.legalCols(d, 'p1'), [0, 1, 2]);
  // Buben gehören nicht zur Farbe: Pik-Bube zählt nicht als Pik
  const e = setup({ ups0: [C(PI, RK)], ups1: [C(PI, RB), C(HE, R8)], trump: KA, turn: 1, trick: [{ pid: 'p0', card: C(PI, RK), col: 0 }] });
  assert.deepEqual(M.legalCols(e, 'p1'), [0, 1], 'kein Pik offen -> frei, Pik-Bube ist keine Pik-Karte');
});
test('Ausspielen: alle offenen Spalten erlaubt, leere nicht', () => {
  const g = setup({ ups0: [C(KR, RA), undefined, C(PI, R7)], ups1: [C(HE, R7)], turn: 0 });
  assert.deepEqual(M.legalCols(g, 'p0'), [0, 2]);
  assert.deepEqual(M.legalCols(g, 'p1'), []);
  assert.deepEqual(M.legalCols(g, 'nobody'), []);
  g.phase = 'trump';
  assert.deepEqual(M.legalCols(g, 'p0'), []);
});

test('Verdeckte Karte wird sofort aufgedeckt, Spalten behalten ihren Platz', () => {
  const g = setup({ ups0: [C(KR, RA), C(PI, R7)], downs0: [C(HE, R9), C(KA, R7)], ups1: [C(KR, R7), C(PI, R8)], downs1: [C(HE, RA), C(KA, R8)], trump: KA, turn: 0 });
  let r = M.handle(g, 'p0', { t: 'play', col: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(g.players[0].cols[0], { down: null, up: C(HE, R9) }, 'darunterliegende Karte offen');
  assert.deepEqual(g.players[0].cols[1], { down: C(KA, R7), up: C(PI, R7) });
  assert.equal(g.trick.cards.length, 1);
  assert.equal(g.turn, 1);
  // Die frisch aufgedeckte Karte darf im selben Stich nicht mehr gespielt werden (jede Person spielt nur 1 Karte)
  r = M.handle(g, 'p0', { t: 'play', col: 0 });
  assert.equal(r.ok, false);
  r = M.handle(g, 'p1', { t: 'play', col: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(g.players[1].cols[0], { down: null, up: C(HE, RA) });
  // Stich: Kreuz-Ass vs Kreuz-7 -> p0 gewinnt, spielt wieder aus, neue Karte steht jetzt bereit
  assert.equal(g.trick.cards.length, 0);
  assert.equal(g.turn, 0);
  assert.equal(g.players[0].tricks, 1);
  assert.equal(g.players[0].points, 11);
  assert.deepEqual(g.players[0].won, [C(KR, RA), C(KR, R7)]);
  assert.deepEqual(M.legalCols(g, 'p0'), [0, 1]);
  assert.equal(g.last.winner, 'p0');
  // eine leere Spalte (kein down mehr) bleibt als Platzhalter
  M.handle(g, 'p0', { t: 'play', col: 0 });
  assert.deepEqual(g.players[0].cols[0], { down: null, up: null });
  assert.equal(g.players[0].cols.length, 8);
});

test('Spielen: Bedienpflicht wird erzwungen, Sieger spielt aus, Stichwechsel', () => {
  const g = setup({ ups0: [C(KR, RK)], ups1: [C(PI, RA), C(KR, R7)], trump: KA, turn: 0 });
  assert.equal(M.handle(g, 'p0', { t: 'play', col: 0 }).ok, true);
  const bad = M.handle(g, 'p1', { t: 'play', col: 0 });
  assert.equal(bad.ok, false);
  assert.ok(/Farbe bekennen/.test(bad.error));
  assert.equal(g.trick.cards.length, 1, 'Zustand unverändert');
  assert.equal(M.handle(g, 'p1', { t: 'play', col: 1 }).ok, true);
  assert.equal(g.players[0].tricks, 1);
  assert.equal(g.turn, 0);
  // Gegner sticht mit Trumpf -> Gegner spielt aus
  const h = setup({ ups0: [C(KR, RA)], ups1: [C(KA, R7)], trump: KA, turn: 0 });
  M.handle(h, 'p0', { t: 'play', col: 0 }); M.handle(h, 'p1', { t: 'play', col: 0 });
  assert.equal(h.players[1].tricks, 1);
  assert.equal(h.turn, 1);
  assert.equal(h.leader, 1);
});

// Endspiel bauen: je Person bleibt noch eine Karte (letzter, 16. Stich)
function finalTrick({ a, b, ta, tb, c0 = C(KR, R7), c1 = C(KR, R8), trump = KR, target, dealer = 0 }) {
  const g = M.createGame(P2, { target }, seeded(4), 'p0');
  g.dealer = dealer; g.trump = trump; g.phase = 'play'; g.turn = 0; g.leader = 0; g.trick = { cards: [] };
  g.players[0].cols = Array.from({ length: 8 }, (_, k) => ({ up: k === 0 ? c0 : null, down: null }));
  g.players[1].cols = Array.from({ length: 8 }, (_, k) => ({ up: k === 0 ? c1 : null, down: null }));
  g.players[0].points = a; g.players[1].points = b; g.players[0].tricks = ta; g.players[1].tricks = tb;
  return g;
}
function endIt(g) {
  assert.equal(M.handle(g, 'p0', { t: 'play', col: 0 }).ok, true);
  assert.equal(M.handle(g, 'p1', { t: 'play', col: 0 }).ok, true);
  return g;
}

test('16 Stiche, dann Rundenende; Augen aus gewonnenen Stichen', () => {
  const g = game(11);
  M.handle(g, g.players[g.turn].id, { t: 'trump', suit: HE });
  let n = 0;
  while (g.phase === 'play') {
    const id = g.players[g.turn].id;
    const legal = M.legalCols(g, id);
    assert.ok(legal.length > 0);
    assert.equal(M.handle(g, id, { t: 'play', col: legal[0] }).ok, true);
    if (g.trick.cards.length === 0) n++;
    assert.ok(n <= 16);
  }
  assert.equal(n, 16);
  assert.equal(g.players[0].tricks + g.players[1].tricks, 16);
  assert.equal(g.players[0].points + g.players[1].points, 120);
  assert.equal(g.players[0].won.length + g.players[1].won.length, 32);
  assert.ok(['round_over', 'over'].includes(g.phase));
  for (const p of g.players) for (const c of p.cols) assert.deepEqual(c, { down: null, up: null });
});

test('Wertung: mehr als 60 gewinnt (61:59 = 1 Punkt)', () => {
  const g = endIt(finalTrick({ a: 30, b: 29, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) })); // a +11 = 41... Sicherheitswerte unten
  // a: 30 + 11 = 41, b: 29 -> kein Sieger: nur zur Probe des Aufbaus
  assert.equal(g.result.winner, null);
  const w = endIt(finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) })); // a = 61, b = 59
  assert.equal(w.result.winner, 'p0');
  assert.equal(w.result.augen.p0, 61);
  assert.equal(w.result.augen.p1, 59);
  assert.equal(w.result.value, 1);
  assert.equal(w.players[0].score, 1);
  assert.equal(w.players[1].score, 0);
  assert.equal(w.phase, 'round_over');
  assert.deepEqual(w.result.gained, { p0: 1, p1: 0 });
});
test('Wertung: 60:60 ist unentschieden, beide 0 Punkte, nächste Runde geht', () => {
  const g = endIt(finalTrick({ a: 49, b: 60, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) })); // a 60, b 60
  assert.equal(g.result.augen.p0, 60);
  assert.equal(g.result.winner, null);
  assert.deepEqual([g.players[0].score, g.players[1].score], [0, 0]);
  assert.equal(g.phase, 'round_over');
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, true);
  assert.equal(g.round, 2);
});
test('Wertung: Schneider (Verlierer höchstens 30) = 2, Schwarz (kein Stich) = 3', () => {
  // Verlierer genau 30 -> Schneider
  let g = endIt(finalTrick({ a: 79, b: 30, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) })); // a 90
  assert.equal(g.result.winner, 'p0'); assert.equal(g.result.schneider, true); assert.equal(g.result.schwarz, false); assert.equal(g.result.value, 2);
  assert.equal(g.players[0].score, 2);
  // Verlierer 31 -> normal
  g = endIt(finalTrick({ a: 79, b: 31, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) }));
  assert.equal(g.result.schneider, false); assert.equal(g.result.value, 1);
  // Gegner gewinnt Schneider
  g = endIt(finalTrick({ a: 10, b: 100, ta: 7, tb: 8, c0: C(KR, R7), c1: C(KR, R8) }));
  assert.equal(g.result.winner, 'p1'); assert.equal(g.result.schneider, true); assert.equal(g.players[1].score, 2);
  // Schwarz: Verlierer ohne Stich (auch bei 0 Augen)
  g = endIt(finalTrick({ a: 0, b: 118, ta: 0, tb: 15, c0: C(KR, R7), c1: C(KR, R8) }));
  assert.equal(g.result.winner, 'p1'); assert.equal(g.result.schwarz, true); assert.equal(g.result.schneider, false); assert.equal(g.result.value, 3);
  // Wer nur Stiche mit 0 Augen hat, ist nicht schwarz, aber Schneider
  g = endIt(finalTrick({ a: 0, b: 118, ta: 1, tb: 14, c0: C(KR, R7), c1: C(KR, R8) }));
  assert.equal(g.result.schwarz, false); assert.equal(g.result.schneider, true); assert.equal(g.result.value, 2);
});
test('Wertung: Grand zählt doppelt (1->2, Schneider 4, Schwarz 6), abschaltbar', () => {
  let g = endIt(finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7), trump: 'grand' }));
  assert.equal(g.result.value, 2); assert.equal(g.result.grand, true); assert.equal(g.players[0].score, 2);
  g = endIt(finalTrick({ a: 79, b: 20, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7), trump: 'grand', target: 20 }));
  assert.equal(g.result.value, 4);
  g = endIt(finalTrick({ a: 100, b: 0, ta: 15, tb: 0, c0: C(KR, RA), c1: C(KR, R7), trump: 'grand', target: 20 }));
  assert.equal(g.result.value, 6);
  const off = finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7), trump: 'grand' });
  off.opts.grandDouble = false;
  endIt(off);
  assert.equal(off.result.value, 1);
});
test('Spielende bei Ziel: 5 Spielpunkte (Standard) bzw. 3 (Kurzspiel); nächste Runde danach nicht mehr', () => {
  let g = finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) });
  g.players[0].score = 4;
  endIt(g);
  assert.equal(g.players[0].score, 5);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.gameWinner, 'p0');
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'play', col: 0 }).ok, false);
  g = finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) });
  g.players[0].score = 3;
  endIt(g);
  assert.equal(g.phase, 'round_over', 'bei 4 noch nicht zu Ende');
  g = finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7), target: 3 });
  g.players[0].score = 2;
  endIt(g);
  assert.equal(g.phase, 'over');
  // Ziel mit target=1: schon die erste gewonnene Runde beendet das Spiel
  g = finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7), target: 1 });
  endIt(g);
  assert.equal(g.phase, 'over');
});
test("'next': Punktestand bleibt, Geber wechselt jede Runde, neu gegeben", () => {
  const g = finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7), dealer: 0 });
  g.round = 1;
  endIt(g);
  assert.equal(g.phase, 'round_over');
  const d0 = g.dealer; const gid0 = g.gid;
  assert.equal(M.handle(g, 'p1', { t: 'next' }).ok, false, 'nur Gastgeber');
  assert.equal(M.handle(g, 'p0', { t: 'next' }, seeded(5)).ok, true);
  assert.equal(g.round, 2);
  assert.equal(g.dealer, 1 - d0);
  assert.equal(g.leader, d0);
  assert.equal(g.players[0].score, 1, 'Punktestand erhalten');
  assert.equal(g.phase, 'trump');
  assert.equal(g.trump, null);
  assert.notEqual(g.gid, gid0);
  assert.equal(new Set(idsOf(g)).size, 32);
  for (const p of g.players) { assert.deepEqual([p.tricks, p.points, p.won.length], [0, 0, 0]); assert.equal(p.cols.length, 8); }
  assert.equal(g.result, null);
  assert.equal(g.last, null);
  // dritte Runde: Geber wieder zurück
  g.phase = 'round_over';
  M.handle(g, 'p0', { t: 'next' }, seeded(6));
  assert.equal(g.dealer, d0);
});

test('Trumpfwahl: nur die Vorhand, einmal, gültige Werte', () => {
  const g = game(2);
  const lead = g.players[g.turn].id;
  const other = g.players[1 - g.turn].id;
  const before = JSON.stringify(g);
  for (const bad of [{ t: 'trump' }, { t: 'trump', suit: 4 }, { t: 'trump', suit: -1 }, { t: 'trump', suit: 'Herz' }, { t: 'trump', suit: 1.5 }, { t: 'trump', suit: null }, { t: 'trump', suit: '2' }]) {
    assert.equal(M.handle(g, lead, bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(M.handle(g, other, { t: 'trump', suit: 0 }).ok, false, 'falsche Person');
  assert.equal(JSON.stringify(g), before, 'ungültige Eingaben ändern nichts');
  assert.equal(M.handle(g, lead, { t: 'play', col: 0 }).ok, false, 'erst Trumpf');
  assert.equal(M.handle(g, lead, { t: 'trump', suit: 'grand' }).ok, true);
  assert.equal(g.trump, 'grand');
  assert.equal(g.phase, 'play');
  assert.equal(g.turn, g.leader);
  assert.equal(M.handle(g, lead, { t: 'trump', suit: 1 }).ok, false, 'schon gewählt');
  for (const s of [0, 1, 2, 3]) { const h = game(3); assert.equal(M.handle(h, h.players[h.turn].id, { t: 'trump', suit: s }).ok, true); assert.equal(h.trump, s); }
});

test('Ungültige Nachrichten / falsche Person / falsche Phase ändern den Zustand nicht', () => {
  const g = game(8);
  const lead = g.players[g.turn].id;
  M.handle(g, lead, { t: 'trump', suit: 2 });
  const before = JSON.stringify(g);
  const fol = g.players[1 - g.turn].id;
  const cases = [
    [lead, null], [lead, undefined], [lead, 'play'], [lead, 5], [lead, {}], [lead, { t: 5 }], [lead, { t: 'foo' }],
    ['unbekannt', { t: 'play', col: 0 }], [null, { t: 'play', col: 0 }],
    [fol, { t: 'play', col: 0 }], // nicht dran
    [lead, { t: 'play' }], [lead, { t: 'play', col: -1 }], [lead, { t: 'play', col: 8 }], [lead, { t: 'play', col: 1.5 }],
    [lead, { t: 'play', col: '0' }], [lead, { t: 'play', col: null }], [lead, { t: 'play', col: NaN }],
    [lead, { t: 'next' }], [fol, { t: 'next' }], [lead, { t: 'trump', suit: 0 }],
  ];
  for (const [pid, msg] of cases) {
    const r = M.handle(g, pid, msg);
    assert.equal(r.ok, false, JSON.stringify([pid, msg]));
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  }
  assert.equal(JSON.stringify(g), before);
  assert.equal(M.handle(null, 'p0', { t: 'next' }).ok, false);
  assert.equal(M.handle({ game: 'mm' }, 'p0', { t: 'next' }).ok, false);
  // leere Spalte spielen
  const e = setup({ ups0: [C(KR, RA)], ups1: [C(KR, R7)], turn: 0 });
  assert.equal(M.handle(e, 'p0', { t: 'play', col: 3 }).ok, false);
  // in der Runde-vorbei-Phase nichts mehr spielen
  const f = endIt(finalTrick({ a: 50, b: 59, ta: 8, tb: 7, c0: C(KR, RA), c1: C(KR, R7) }));
  assert.equal(M.handle(f, 'p0', { t: 'play', col: 0 }).ok, false);
  assert.equal(M.handle(f, 'p0', { t: 'trump', suit: 1 }).ok, false);
});

test('ranking: nach Spielpunkten, Gleichstand gleicher Platz', () => {
  const g = game(1);
  g.players[0].score = 2; g.players[1].score = 4;
  assert.deepEqual(M.ranking(g).map((r) => [r.id, r.score, r.rank]), [['p1', 4, 1], ['p0', 2, 2]]);
  g.players[0].score = 4;
  assert.deepEqual(M.ranking(g).map((r) => r.rank), [1, 1]);
});

test('300 Zufallsrunden: enden immer, Augenbilanz 120, Kartenbilanz 32, alle Züge gültig', () => {
  const rng = seeded(99);
  const summary = { win: 0, draw: 0, grand: 0, schneider: 0, schwarz: 0 };
  for (let n = 0; n < 300; n++) {
    const g = M.createGame(P2, { target: 20 }, rng, 'p0');
    const lead = g.players[g.turn].id;
    assert.equal(M.handle(g, lead, { t: 'trump', suit: [0, 1, 2, 3, 'grand'][Math.floor(rng() * 5)] }).ok, true);
    let steps = 0;
    while (g.phase === 'play') {
      assert.ok(steps++ < 40, 'Endlosschleife');
      const id = g.players[g.turn].id;
      const legal = M.legalCols(g, id);
      assert.ok(legal.length > 0);
      // illegale Spalten werden abgelehnt
      for (let k = 0; k < 8; k++) if (!legal.includes(k)) assert.equal(M.handle(g, id, { t: 'play', col: k }).ok, false);
      assert.equal(idsOf(g).length, 32, 'Kartenbilanz während des Spiels');
      assert.equal(new Set(idsOf(g)).size, 32);
      const r = M.handle(g, id, { t: 'play', col: legal[Math.floor(rng() * legal.length)] });
      assert.equal(r.ok, true);
    }
    assert.equal(steps, 32);
    assert.ok(g.phase === 'round_over' || g.phase === 'over');
    assert.equal(g.players[0].points + g.players[1].points, 120);
    assert.equal(g.players[0].tricks + g.players[1].tricks, 16);
    assert.equal(g.players[0].won.length + g.players[1].won.length, 32);
    assert.equal(new Set(idsOf(g)).size, 32);
    const sumWon = g.players.map((p) => p.won.reduce((s, c) => s + M.cardValue(c), 0));
    assert.deepEqual(sumWon, [g.players[0].points, g.players[1].points]);
    const r = g.result;
    assert.equal(r.augen.p0 + r.augen.p1, 120);
    if (r.winner) summary.win++; else summary.draw++;
    if (r.grand) summary.grand++;
    if (r.schneider) summary.schneider++;
    if (r.schwarz) summary.schwarz++;
    assert.equal(g.players[0].score + g.players[1].score, r.value);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
  console.log('Zufallsrunden:', JSON.stringify(summary));
  assert.ok(summary.win > 250);
});

test('Mehrere Runden bis zum Spielende (Zufall), Geber wechselt, Gewinner hat das Ziel erreicht', () => {
  const rng = seeded(5);
  for (let n = 0; n < 40; n++) {
    const g = M.createGame(P2, { target: 3 }, rng, 'p0');
    let rounds = 0; const dealers = [];
    for (;;) {
      dealers.push(g.dealer);
      M.handle(g, g.players[g.turn].id, { t: 'trump', suit: Math.floor(rng() * 4) });
      while (g.phase === 'play') { const id = g.players[g.turn].id; const l = M.legalCols(g, id); M.handle(g, id, { t: 'play', col: l[Math.floor(rng() * l.length)] }); }
      rounds++;
      if (g.phase === 'over') break;
      assert.equal(M.handle(g, 'p0', { t: 'next' }, rng).ok, true);
      assert.ok(rounds < 200);
    }
    for (let i = 1; i < dealers.length; i++) assert.notEqual(dealers[i], dealers[i - 1]);
    const w = g.players.find((p) => p.id === g.result.gameWinner);
    assert.ok(w.score >= 3);
    assert.ok(g.players.every((p) => p.score < 3 + 6));
  }
});
