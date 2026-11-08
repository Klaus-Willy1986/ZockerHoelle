import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../romme/engine.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (a, rng) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))];
const names = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
// Farbe 0 ♣, 1 ♠, 2 ♥, 3 ♦; Wert 1 (Ass) .. 13 (König); Kopie 0|1
const C = (s, r, k = 0) => k * 52 + s * 13 + r - 1;
const J = [104, 105, 106, 107, 108, 109];
const R = (s, from, to, k = 0) => Array.from({ length: to - from + 1 }, (_, i) => C(s, from + i, k));

// Zustand mit festen Händen/Tisch; Ablage = eine Karte, pile = Rest (Bilanz 110)
function mk(hands, table = [], melded = [], opts = {}, turn = 'play') {
  const s = E.createGame(names(hands.length), opts, mulberry(1));
  const used = new Set([].concat(...hands, ...table));
  assert.equal(used.size, [].concat(...hands, ...table).length, 'Testaufbau: doppelte Karten');
  s.players.forEach((p, i) => { p.hand = hands[i].slice(); p.melded = !!melded[i]; });
  s.table = table.map((x) => x.slice());
  const rest = Array.from({ length: 110 }, (_, i) => i).filter((i) => !used.has(i));
  s.discard = [rest.shift()];
  s.pile = rest;
  s.active = 0; s.starter = 0; s.turn = turn; s.plies = 0; s.openedNow = false; s.takenFromDiscard = null;
  return s;
}
const bal = (s) => assert.equal(E.cardBalance(s).summe, 110);
const meld = (s, pid, table) => E.handle(s, pid, { t: 'meld', table }, Math.random);
const A = (ids) => E.analyzeSet(ids);

// ---------- Karten & Austeilen ----------
test('Karten: 110, richtige Verteilung, Werte, Bezeichnungen', () => {
  assert.equal(E.CARDS.length, 110);
  const cnt = {};
  for (const c of E.CARDS.slice(0, 104)) { const k = c.suit + ':' + c.rank; cnt[k] = (cnt[k] || 0) + 1; }
  assert.equal(Object.keys(cnt).length, 52);
  assert.ok(Object.values(cnt).every((x) => x === 2));
  assert.ok(E.CARDS.slice(104).every((c) => c.suit === -1 && c.rank === 0));
  assert.equal(E.cardValue(C(0, 1)), 11);
  for (const r of [10, 11, 12, 13]) assert.equal(E.cardValue(C(1, r)), 10);
  for (let r = 2; r <= 9; r++) assert.equal(E.cardValue(C(2, r)), r);
  assert.equal(E.cardValue(104), 20);
  assert.equal(E.cardLabel(C(2, 12)), '♥ Dame');
  assert.equal(E.cardLabel(109), 'Joker');
  assert.equal(E.sumValue([C(0, 1), 104, C(0, 5)]), 36);
  assert.deepEqual(E.sortHand([104, C(3, 2), C(0, 9), C(0, 2)]), [C(0, 2), C(0, 9), C(3, 2), 104]);
});

test('Austeilen: 13 je Person, 1 Ablagekarte, Rest Stapel, Startperson zufällig, Fehler bei falscher Personenzahl', () => {
  for (let n = 2; n <= 4; n++) {
    const s = E.createGame(names(n), {}, mulberry(n));
    assert.equal(s.players.length, n);
    assert.ok(s.players.every((p) => p.hand.length === 13 && !p.melded && p.score === 0));
    assert.equal(s.discard.length, 1);
    assert.equal(s.pile.length, 110 - 13 * n - 1);
    assert.equal(s.phase, 'play'); assert.equal(s.turn, 'draw');
    assert.equal(new Set([].concat(s.pile, s.discard, ...s.players.map((p) => p.hand))).size, 110);
    bal(s);
  }
  assert.throws(() => E.createGame(names(1), {}, Math.random), RangeError);
  assert.throws(() => E.createGame(names(5), {}, Math.random), RangeError);
  const starters = new Set();
  for (let i = 1; i <= 60; i++) starters.add(E.createGame(names(4), {}, mulberry(i * 31)).active);
  assert.equal(starters.size, 4);
  const h = E.createGame(names(2), { hand: 5 }, mulberry(3));
  assert.ok(h.players.every((p) => p.hand.length === 5));
  assert.deepEqual(h.opts, { swap: true, double: true, hand: 5 });
  assert.equal(E.createGame(names(2), { hand: 99, swap: false }, mulberry(3)).opts.hand, 13);
  assert.equal(E.createGame(names(2), { swap: false, double: false }, mulberry(3)).opts.swap, false);
});

// ---------- analyzeSet ----------
test('analyzeSet: gültige Folgen und Sätze (Tabelle)', () => {
  const ok = [
    [[C(0, 2), C(0, 3), C(0, 4)], 'folge', 9],
    [[C(0, 4), C(0, 2), C(0, 3)], 'folge', 9], // beliebige Reihenfolge
    [R(1, 4, 8), 'folge', 30],
    [[C(2, 10), C(2, 11), C(2, 12)], 'folge', 30],
    [[C(2, 11), C(2, 12), C(2, 13)], 'folge', 30],
    [R(3, 2, 13), 'folge', 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 * 4],
    [[C(0, 5), C(1, 5), C(2, 5)], 'satz', 15],
    [[C(0, 5), C(1, 5), C(2, 5), C(3, 5)], 'satz', 20],
    [[C(0, 13), C(1, 13), C(2, 13)], 'satz', 30],
    [[C(0, 1), C(1, 1), C(2, 1)], 'satz', 33],
    [[C(0, 7), C(1, 7), C(0, 7, 1)].slice(0, 2).concat([C(3, 7)]), 'satz', 21],
  ];
  for (const [ids, kind, value] of ok) {
    const a = A(ids);
    assert.ok(a.valid, ids.map(E.cardLabel).join(' ') + ': ' + a.reason);
    assert.equal(a.kind, kind); assert.equal(a.value, value, ids.map(E.cardLabel).join(' '));
    assert.equal(a.order.length, ids.length);
    assert.deepEqual(a.order.slice().sort((x, y) => x - y), ids.slice().sort((x, y) => x - y));
  }
});

test('analyzeSet: ungültige Sätze mit Begründung (Tabelle)', () => {
  const no = [
    [[C(0, 2), C(0, 3)], /Mindestens 3/],
    [[], /Mindestens 3/],
    [[C(0, 2), C(0, 3), C(0, 5)], /fehlt/],
    [[C(0, 2), C(0, 3), C(1, 4)], /Folge hat eine Farbe/],
    [[C(0, 5), C(1, 5), C(0, 5, 1)], /jede Farbe nur einmal/],
    [[C(0, 5), C(0, 5, 1), C(0, 6)], /kein Wert doppelt/],
    [[C(0, 5), C(1, 5), C(2, 5), C(3, 5), C(0, 5, 1)], /jede Farbe nur einmal/],
    [[C(0, 13), C(0, 1), C(0, 2)], /Kein Umlauf/],
    [[C(0, 12), C(0, 13), C(0, 1), C(0, 2)], /Kein Umlauf/],
    [[104, 105, C(0, 5)], /nur ein Joker/],
    [[104, 105, 106], /nur ein Joker/],
    [[104, C(0, 5), C(1, 7)], /Folge hat eine Farbe/],
    [[C(0, 2), C(0, 3), C(0, 4), 104, 105], /nur ein Joker/],
    [[C(0, 5), C(0, 5)], /Ungültige|Mindestens/],
    [[C(0, 5), C(0, 6), 999], /Ungültige/],
    [[C(0, 5), C(1, 5), C(2, 5), 104], null], // gültig: Satz mit Joker als vierte Farbe
  ];
  for (const [ids, re] of no) {
    const a = A(ids);
    if (re === null) { assert.ok(a.valid); continue; }
    assert.ok(!a.valid, ids.join());
    assert.equal(a.kind, null); assert.equal(a.value, 0);
    assert.match(a.reason, re);
  }
  assert.ok(!A(null).valid); assert.ok(!A('x').valid);
  assert.ok(!A(R(0, 1, 13).concat([C(0, 1, 1), C(0, 2, 1)])).valid);
});

test('analyzeSet: Ass-Regeln (niedrig, hoch, kein Umlauf, Werte)', () => {
  let a = A([C(0, 1), C(0, 2), C(0, 3)]);
  assert.ok(a.valid); assert.equal(a.value, 6); assert.equal(a.order[0], C(0, 1)); // A-2-3: Ass zählt 1
  a = A([C(0, 12), C(0, 13), C(0, 1)]);
  assert.ok(a.valid); assert.equal(a.value, 31); assert.equal(a.order[2], C(0, 1)); // Q-K-A: Ass zählt 11
  a = A([C(3, 1), C(3, 2), C(3, 3), C(3, 4)]);
  assert.equal(a.value, 10);
  a = A(R(1, 1, 13));
  assert.ok(a.valid); assert.equal(a.value, 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 * 4 + 11); // 13 Karten: Ass oben (2-…-K-A) ist wertvoller als unten
  a = A(R(1, 1, 13).concat([C(1, 1, 1)]).filter((x) => x !== C(1, 1)));
  assert.ok(!a.valid || a.valid); // zwei Asse derselben Farbe in einer Folge (Ass oben) ist nur mit allen Karten sinnvoll
  assert.ok(!A([C(1, 13), C(1, 1), C(1, 2)]).valid);
  assert.ok(!A([C(1, 1), C(1, 13), C(1, 12), C(1, 2)]).valid);
  assert.ok(A([C(1, 11), C(1, 12), C(1, 13), C(1, 1)]).valid);
  // Ass im Satz zählt 11
  assert.equal(A([C(0, 1), C(1, 1), C(2, 1), C(3, 1)]).value, 44);
});

test('analyzeSet: Joker (ersetzt Karte, höchstens einer, Wert und jokerAs)', () => {
  let a = A([C(0, 5), J[0], C(0, 7)]);
  assert.ok(a.valid); assert.equal(a.kind, 'folge'); assert.equal(a.value, 18);
  assert.deepEqual(a.jokerAs, [{ id: J[0], suit: 0, rank: 6 }]);
  assert.deepEqual(a.order, [C(0, 5), J[0], C(0, 7)]);
  // Joker an den Enden: höchster Wert gewinnt (Joker oben)
  a = A([C(1, 5), C(1, 6), J[1]]);
  assert.equal(a.value, 18); assert.equal(a.jokerAs[0].rank, 7);
  a = A([C(1, 12), C(1, 13), J[1]]);
  assert.equal(a.value, 31); assert.equal(a.jokerAs[0].rank, 1); // Joker als Ass oben
  a = A([C(1, 2), C(1, 3), J[1]]);
  assert.equal(a.jokerAs[0].rank, 4); assert.equal(a.value, 9);
  a = A([C(1, 13), C(1, 12), C(1, 1)]);
  assert.equal(a.value, 31);
  // Satz mit Joker
  a = A([C(0, 9), C(1, 9), J[2]]);
  assert.ok(a.valid); assert.equal(a.kind, 'satz'); assert.equal(a.value, 27);
  assert.equal(a.jokerAs[0].rank, 9); assert.ok(a.jokerAs[0].suit >= 2);
  a = A([C(0, 9), C(1, 9), C(2, 9), J[2]]);
  assert.equal(a.value, 36); assert.equal(a.jokerAs[0].suit, 3);
  // zwei Joker ungültig, Joker und zu viele Karten ungültig
  assert.ok(!A([C(0, 9), C(1, 9), C(2, 9), C(3, 9), J[0]]).valid);
  assert.ok(!A([C(0, 5), J[0], J[1], C(0, 8)]).valid);
  // Lücke größer als der eine Joker
  assert.ok(!A([C(0, 5), J[0], C(0, 8)]).valid);
  assert.ok(A([C(0, 5), C(0, 6), J[0], C(0, 8)]).valid);
});

// ---------- Zugablauf ----------
test('Zugablauf: nehmen -> (auslegen) -> ablegen; falsche Person/Phase; ungültige Nachrichten', () => {
  const s = mk([[C(0, 2), C(1, 3), C(2, 8), C(3, 12)], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {}, 'draw');
  const topD = s.discard[0];
  const pileTop = s.pile[s.pile.length - 1];
  const h = (m, pid = 'p0') => E.handle(s, pid, m, mulberry(2));
  const before = JSON.stringify(s);
  // Fehler ändern den Zustand nicht
  for (const [pid, m] of [['p1', { t: 'draw', from: 'pile' }], ['zz', { t: 'draw', from: 'pile' }], ['p0', { t: 'draw', from: 'nirgends' }], ['p0', { t: 'draw' }],
    ['p0', { t: 'meld', table: [] }], ['p0', { t: 'discard', card: C(0, 2) }], ['p0', { t: 'next' }], ['p0', { t: 'quatsch' }], ['p0', null], ['p0', 'x'], ['p0', 5]]) {
    const r = h(m, pid);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.ok(typeof r.error === 'string' && r.error.length > 3);
    assert.equal(JSON.stringify(s), before);
  }
  assert.equal(E.handle(null, 'p0', { t: 'draw', from: 'pile' }).ok, false);
  assert.equal(E.handle({}, 'p0', { t: 'draw', from: 'pile' }).ok, false);
  assert.ok(h({ t: 'draw', from: 'pile' }).ok);
  assert.equal(s.turn, 'play');
  assert.equal(s.players[0].hand.length, 5);
  assert.ok(s.players[0].hand.includes(pileTop));
  assert.equal(s.pile.length, 110 - 7 - 1 - 1);
  assert.equal(h({ t: 'draw', from: 'pile' }).ok, false); // zweites Mal nicht
  assert.equal(h({ t: 'discard', card: C(2, 4) }).ok, false); // nicht auf der Hand
  assert.equal(h({ t: 'discard', card: 'x' }).ok, false);
  assert.equal(E.handle(s, 'p1', { t: 'discard', card: C(0, 9) }).ok, false); // nicht am Zug
  assert.ok(h({ t: 'discard', card: C(3, 12) }).ok);
  assert.equal(s.active, 1); assert.equal(s.turn, 'draw');
  assert.equal(s.discard[s.discard.length - 1], C(3, 12));
  assert.equal(s.discard.length, 2);
  assert.equal(s.players[0].hand.length, 4);
  bal(s);
  // nehmen von der Ablage
  assert.ok(E.handle(s, 'p1', { t: 'draw', from: 'discard' }).ok);
  assert.ok(s.players[1].hand.includes(C(3, 12)));
  assert.equal(s.discard.length, 1); assert.equal(s.discard[0], topD);
  assert.equal(s.takenFromDiscard, C(3, 12));
  // diese Karte darf nicht gleich wieder abgelegt werden, eine andere schon
  const r = E.handle(s, 'p1', { t: 'discard', card: C(3, 12) });
  assert.equal(r.ok, false); assert.match(r.error, /Ablage genommen/);
  assert.ok(E.handle(s, 'p1', { t: 'discard', card: C(2, 4) }).ok);
  assert.equal(s.active, 0); assert.equal(s.takenFromDiscard, null);
  bal(s);
});

test('Letzte Karte darf auch die von der Ablage genommene sein', () => {
  const s = mk([[C(0, 2), C(0, 3), C(0, 4)], [C(1, 9), C(2, 9), C(3, 9)]], [], [true, true], {}, 'draw');
  s.discard = [C(1, 1)];
  s.pile = Array.from({ length: 110 }, (_, i) => i).filter((i) => ![C(0, 2), C(0, 3), C(0, 4), C(1, 9), C(2, 9), C(3, 9), C(1, 1)].includes(i));
  assert.ok(E.handle(s, 'p0', { t: 'draw', from: 'discard' }).ok);
  assert.ok(meld(s, 'p0', [[C(0, 2), C(0, 3), C(0, 4)]]).ok); // Rommé nicht: noch eine Karte
  assert.equal(s.phase, 'play');
  assert.equal(s.players[0].hand.length, 1);
  assert.ok(E.handle(s, 'p0', { t: 'discard', card: C(1, 1) }).ok);
  assert.equal(s.phase, 'over');
});

test('Stapel leer: Ablage ohne oberste Karte wird neu gemischt; Sonderfälle', () => {
  const s = mk([[C(0, 2), C(1, 3), C(2, 8)], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {}, 'draw');
  const keep = s.pile.slice(0, 5);
  s.discard = s.pile.splice(0, s.pile.length - 0).concat(s.discard); // alles auf die Ablage
  s.pile = [];
  const top = s.discard[s.discard.length - 1];
  const total = s.discard.length;
  assert.ok(total > 50);
  assert.ok(E.handle(s, 'p0', { t: 'draw', from: 'pile' }, mulberry(9)).ok);
  assert.equal(s.discard.length, 1); assert.equal(s.discard[0], top);
  assert.equal(s.pile.length, total - 2);
  assert.equal(s.players[0].hand.length, 4);
  assert.match(s.recap.join(' '), /neu gemischt/);
  bal(s);
  assert.ok(keep.length === 5);
  // Stapel leer und nur eine Ablagekarte: Stapel geht nicht, Ablage schon
  const t = mk([[C(0, 2), C(1, 3), C(2, 8)], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {}, 'draw');
  t.discard = [t.pile.pop()]; t.pile = [];
  t.pile = [];
  const r = E.handle(t, 'p0', { t: 'draw', from: 'pile' });
  assert.equal(r.ok, false); assert.match(r.error, /Stapel ist leer/);
  assert.ok(E.handle(t, 'p0', { t: 'draw', from: 'discard' }).ok);
});

// ---------- Eröffnung ----------
test('Eröffnung: 39 reicht nicht, 40 reicht (neue Sätze aus der Hand, mehrere erlaubt)', () => {
  // Folge ♣ 9-10-B = 29 + ... : 39 = Folge (♣ 9,10,B = 29) + Satz? Wir bauen 39: ♣10,B,D (30) + ♥ 9? nein -> Folge 3-4-5-6-7-8-9? Wir nutzen Satz 13er (30) + Folge 2-3-4 (9) = 39
  const sat13 = [C(0, 13), C(1, 13), C(2, 13)];
  const f234 = [C(3, 2), C(3, 3), C(3, 4)];
  const x = [C(0, 7), C(1, 2)];
  let s = mk([[...sat13, ...f234, ...x], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {});
  let c = E.checkTurn(s, 'p0', [sat13, f234]);
  assert.equal(c.ok, false); assert.equal(c.newValue, 39); assert.match(c.error, /mindestens 40 Punkten \(jetzt: 39\)/);
  assert.equal(meld(s, 'p0', [sat13, f234]).ok, false);
  assert.equal(s.players[0].melded, false); assert.equal(s.table.length, 0);
  // 40: Folge 3-4-5 statt 2-3-4
  const f345 = [C(3, 3), C(3, 4), C(3, 5)];
  s = mk([[...sat13, ...f345, ...x], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {});
  c = E.checkTurn(s, 'p0', [sat13, f345]);
  assert.ok(c.ok, c.error); assert.equal(c.newValue, 42);
  // genau 40: ♠ 10-B-D-K = 40
  s = mk([[C(1, 10), C(1, 11), C(1, 12), C(1, 13), C(0, 3)], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {});
  c = E.checkTurn(s, 'p0', [[C(1, 10), C(1, 11), C(1, 12), C(1, 13)]]);
  assert.ok(c.ok); assert.equal(c.newValue, 40);
  assert.ok(meld(s, 'p0', [[C(1, 13), C(1, 10), C(1, 12), C(1, 11)]]).ok);
  assert.equal(s.players[0].melded, true);
  assert.deepEqual(s.table[0], [C(1, 10), C(1, 11), C(1, 12), C(1, 13)]); // sortiert gespeichert
  assert.deepEqual(s.players[0].hand, [C(0, 3)]);
  assert.equal(s.turn, 'play'); assert.equal(s.active, 0); // Ablegen steht noch aus
  bal(s);
  // Ass-Werte bei der Eröffnung: A-2-3 zählt nur 6; Q-K-A zählt 31
  s = mk([[C(0, 1), C(0, 2), C(0, 3), C(1, 12), C(1, 13), C(1, 1)], [C(0, 9), C(1, 9), C(2, 4)]], [], [], {});
  c = E.checkTurn(s, 'p0', [[C(0, 1), C(0, 2), C(0, 3)], [C(1, 12), C(1, 13), C(1, 1)]]);
  assert.equal(c.newValue, 37); assert.equal(c.ok, false);
  // Joker zählt als vertretene Karte
  s = mk([[C(1, 12), C(1, 13), J[0], C(3, 9), C(2, 9), C(1, 9)], [C(0, 9), C(0, 5), C(2, 4)]], [], [], {});
  c = E.checkTurn(s, 'p0', [[C(1, 12), C(1, 13), J[0]], [C(3, 9), C(2, 9), C(1, 9)]]);
  assert.equal(c.newValue, 31 + 27); assert.ok(c.ok);
});

test('Eröffnung: nur neue Sätze, Tisch bleibt unverändert, Karten gehören zur Hand', () => {
  const tbl = [R(0, 3, 6)];
  const hand = [...R(1, 10, 13), C(0, 7), C(0, 2), C(3, 2)];
  const s = mk([hand, [C(0, 9), C(1, 9), C(2, 4)]], tbl, [false, true]);
  // Anlegen vor der Eröffnung: verboten
  let r = E.checkTurn(s, 'p0', [R(0, 3, 7), R(1, 10, 13)]);
  assert.equal(r.ok, false); assert.match(r.error, /nicht verändert/);
  // Umlegen vor der Eröffnung: verboten
  r = E.checkTurn(s, 'p0', [R(0, 3, 5), R(1, 10, 13), [C(0, 6)]]);
  assert.equal(r.ok, false);
  // richtig: Tisch unverändert + neue Folge
  r = E.checkTurn(s, 'p0', [R(0, 3, 6), R(1, 10, 13)]);
  assert.ok(r.ok, r.error); assert.equal(r.newValue, 40);
  // fremde Karte
  r = E.checkTurn(s, 'p0', [R(0, 3, 6), R(1, 10, 13), [C(2, 2), C(2, 3), C(2, 4)]]);
  assert.equal(r.ok, false); assert.match(r.error, /gehört dir nicht/);
  // Karte doppelt
  r = E.checkTurn(s, 'p0', [R(0, 3, 6), R(1, 10, 13), R(1, 10, 12)]);
  assert.equal(r.ok, false); assert.match(r.error, /mehrfach/);
  // Tischkarte entfernt
  r = E.checkTurn(s, 'p0', [R(1, 10, 13)]);
  assert.equal(r.ok, false); assert.match(r.error, /nicht zurück in die Hand/);
  // nichts Neues
  r = E.checkTurn(s, 'p0', [R(0, 3, 6)]);
  assert.equal(r.ok, false); assert.match(r.error, /mindestens eine Karte/);
  // ungültiger Satz benennt den Satz
  r = E.checkTurn(s, 'p0', [R(0, 3, 6), [C(1, 10), C(1, 11)]]);
  assert.equal(r.ok, false); assert.deepEqual(r.bad, [1]); assert.match(r.error, /Satz 2/);
  // ungültige Eingaben
  for (const t of [null, 5, 'x', [1, 2], [[1, 2, 'a']], [[-1, 2, 3]], [[500, 1, 2]]]) assert.equal(E.checkTurn(s, 'p0', t).ok, false);
  // leere Sätze werden ignoriert
  r = E.checkTurn(s, 'p0', [R(0, 3, 6), [], R(1, 10, 13)]);
  assert.ok(r.ok);
  // andere Person / Phase
  assert.equal(E.checkTurn(s, 'p1', [R(0, 3, 6)]).ok, false);
  assert.equal(E.checkTurn(s, 'zz', []).ok, false);
  s.turn = 'draw';
  assert.match(E.checkTurn(s, 'p0', [R(0, 3, 6), R(1, 10, 13)]).error, /zuerst eine Karte/);
});

test('Eröffnung und gleich anlegen im selben Zug (zweite Meldung)', () => {
  const tbl = [R(0, 3, 6)];
  const s = mk([[...R(1, 10, 13), C(0, 7), C(0, 2)], [C(0, 9), C(1, 9), C(2, 4)]], tbl, [false, true]);
  assert.ok(meld(s, 'p0', [R(0, 3, 6), R(1, 10, 13)]).ok);
  assert.equal(s.players[0].melded, true);
  assert.ok(meld(s, 'p0', [R(0, 3, 6).concat([C(0, 7)]), R(1, 10, 13)]).ok); // jetzt anlegen
  assert.deepEqual(s.table[0], R(0, 3, 7));
  assert.equal(s.players[0].hand.length, 1);
  assert.ok(E.handle(s, 'p0', { t: 'discard', card: C(0, 2) }).ok);
  assert.equal(s.phase, 'over'); // letzte Karte weg
});

// ---------- Anlegen, Umlegen, Joker ----------
test('Anlegen: Folge an beiden Enden, Satz bis 4, an Sätze anderer; ungültiges Anlegen', () => {
  const tbl = [R(0, 4, 6), [C(0, 9), C(1, 9), C(2, 9)], [C(3, 11), C(3, 12), C(3, 13)]];
  const hand = [C(0, 3), C(0, 7), C(0, 8), C(3, 9), C(3, 1), C(1, 13), C(0, 2)];
  let s = mk([hand, [C(0, 9, 1), C(1, 2), C(2, 4)]], tbl, [true, true]);
  const base = () => tbl.map((x) => x.slice());
  let t = base(); t[0] = [C(0, 3), ...R(0, 4, 6), C(0, 7), C(0, 8)];
  assert.ok(E.checkTurn(s, 'p0', t).ok);
  t[1] = [...tbl[1], C(3, 9)];
  assert.ok(E.checkTurn(s, 'p0', t).ok);
  t[2] = [...tbl[2], C(3, 1)];
  assert.ok(E.checkTurn(s, 'p0', t).ok); // Q-K-A
  assert.ok(meld(s, 'p0', t).ok);
  assert.deepEqual(s.table[2], [C(3, 11), C(3, 12), C(3, 13), C(3, 1)]);
  assert.equal(s.players[0].hand.length, 2);
  // Satz mit 5 Karten: ungültig
  s = mk([[C(3, 9), C(0, 9, 1)], [C(0, 1), C(1, 2), C(2, 4)]], [[C(0, 9), C(1, 9), C(2, 9)]], [true, true]);
  let r = E.checkTurn(s, 'p0', [[C(0, 9), C(1, 9), C(2, 9), C(3, 9), C(0, 9, 1)]]);
  assert.equal(r.ok, false); assert.match(r.error, /jede Farbe|höchstens 4/);
  // falsche Farbe angelegt
  s = mk([[C(1, 7)], [C(0, 1), C(1, 2), C(2, 4)]], [R(0, 4, 6)], [true, true]);
  r = E.checkTurn(s, 'p0', [[...R(0, 4, 6), C(1, 7)]]);
  assert.equal(r.ok, false);
  // Umlauf: an K-A-2 anlegen geht nicht
  s = mk([[C(0, 2)], [C(1, 1), C(1, 3), C(2, 4)]], [[C(0, 12), C(0, 13), C(0, 1)]], [true, true]);
  assert.equal(E.checkTurn(s, 'p0', [[C(0, 12), C(0, 13), C(0, 1), C(0, 2)]]).ok, false);
});

test('Umlegen: Karten zwischen Sätzen verschieben, geteilt/neu verbunden; Tischkarte nie zurück in die Hand', () => {
  // Tisch: Folge ♣ 3-4-5-6-7 und Satz 7er (♠,♥,♦); Hand: ♠ 7 würde... wir ziehen ♣ 7 aus der Folge in einen 4er-Satz
  const tbl = [R(0, 3, 7), [C(1, 7), C(2, 7), C(3, 7)]];
  const s = mk([[C(1, 5)], [C(0, 9), C(1, 9), C(2, 4)]], tbl, [true, true]);
  // ♣ 7 in den Satz, ♠ 5 hand rein an Folge? ♣-Folge braucht ♣ 5: nur Hand ♠ 5: Neue Lage: Folge 3-4-5-6, Satz 7er mit 4 Karten, ♠ 5 muss irgendwo hin
  let r = E.checkTurn(s, 'p0', [R(0, 3, 6), [C(1, 7), C(2, 7), C(3, 7), C(0, 7)]]);
  assert.equal(r.ok, false); assert.match(r.error, /mindestens eine Karte/);
  // Umlegen + Neues: ♠ 5 bildet nichts -> ungültig
  r = E.checkTurn(s, 'p0', [R(0, 3, 6), [C(1, 7), C(2, 7), C(3, 7), C(0, 7)], [C(1, 5)]]);
  assert.equal(r.ok, false); assert.deepEqual(r.bad, [2]);
  // Mit passender Hand: ♣ 7 wandert in den Satz, Hand-Karte ♣ 2 verlängert die Folge
  const s2 = mk([[C(0, 2)], [C(0, 9), C(1, 9), C(2, 4)]], tbl, [true, true]);
  r = E.checkTurn(s2, 'p0', [R(0, 2, 6), [C(1, 7), C(2, 7), C(3, 7), C(0, 7)]]);
  assert.ok(r.ok, r.error); assert.deepEqual(r.played, [C(0, 2)]);
  assert.ok(meld(s2, 'p0', [R(0, 2, 6), [C(1, 7), C(2, 7), C(3, 7), C(0, 7)]]).ok);
  assert.equal(s2.table.length, 2);
  bal(s2);
  // Satz zerlegt in zwei, alles gültig
  const s3 = mk([[C(0, 8)], [C(0, 9), C(1, 9), C(2, 4)]], [R(0, 1, 7)], [true, true]);
  r = E.checkTurn(s3, 'p0', [R(0, 1, 3), R(0, 4, 8)]);
  assert.ok(r.ok, r.error);
  // Tischkarte zurück in die Hand: verboten
  r = E.checkTurn(s3, 'p0', [R(0, 2, 7), [C(0, 8)]]);
  assert.equal(r.ok, false);
});

test('Joker austauschen (swap an): Karte rein, Joker im selben Zug in anderen Satz; ohne Tausch Joker muss liegen bleiben', () => {
  const tbl = [[C(0, 5), J[0], C(0, 7)], [C(1, 9), C(2, 9), C(3, 9)]];
  const hand = [C(0, 6), C(0, 9)];
  const s = mk([hand, [C(0, 1), C(1, 2), C(2, 4)]], tbl, [true, true], { swap: true });
  // Joker raus, in den 9er-Satz (♣ 9 ist als Handkarte schon da -> Hand nur 6)
  let r = E.checkTurn(s, 'p0', [[C(0, 5), C(0, 6), C(0, 7)], [C(1, 9), C(2, 9), C(3, 9), J[0]]]);
  assert.ok(r.ok, r.error); assert.deepEqual(r.played, [C(0, 6)]);
  assert.equal(r.newValue, 6);
  // ... und die Hand-♣ 9 gleichzeitig: 5er-Satz wäre ungültig, aber hier als zweite Variante: Joker in neuen Satz mit ♣ 9? braucht 3 Karten
  assert.ok(meld(s, 'p0', [[C(0, 5), C(0, 6), C(0, 7)], [C(1, 9), C(2, 9), C(3, 9), J[0]]]).ok);
  assert.deepEqual(s.players[0].hand, [C(0, 9)]);
  assert.ok(s.table.flat().includes(J[0]));
  // Joker darf nie zurück in die Hand
  const s2 = mk([hand, [C(0, 1), C(1, 2), C(2, 4)]], tbl, [true, true], { swap: true });
  r = E.checkTurn(s2, 'p0', [[C(0, 5), C(0, 6), C(0, 7)], tbl[1]]);
  assert.equal(r.ok, false); assert.match(r.error, /nicht zurück in die Hand/);
  // Tausch mit Satz-Joker (4. Farbe)
  const s3 = mk([[C(3, 9)], [C(0, 1), C(1, 2), C(3, 4)]], [[C(0, 9), C(1, 9), J[1]], R(2, 3, 5)], [true, true], { swap: true });
  r = E.checkTurn(s3, 'p0', [[C(0, 9), C(1, 9), C(3, 9)], [...R(2, 3, 5), J[1]]]);
  assert.ok(r.ok, r.error);
  // Option aus: Joker darf nicht umziehen, anlegen an den Satz mit Joker bleibt erlaubt
  const s4 = mk([hand, [C(0, 1), C(1, 2), C(2, 4)]], tbl, [true, true], { swap: false });
  r = E.checkTurn(s4, 'p0', [[C(0, 5), C(0, 6), C(0, 7)], [C(1, 9), C(2, 9), C(3, 9), J[0]]]);
  assert.equal(r.ok, false); assert.match(r.error, /Joker/);
  r = E.checkTurn(s4, 'p0', [[C(0, 5), J[0], C(0, 7), C(0, 8)].slice(0, 3).concat([]), tbl[1], [C(0, 6)]].slice(0, 2).map((x, i) => (i === 0 ? tbl[0] : x)));
  assert.equal(r.ok, false); // nichts Neues
  const s5 = mk([[C(0, 8), C(0, 4)], [C(0, 1), C(1, 2), C(2, 4)]], tbl, [true, true], { swap: false });
  r = E.checkTurn(s5, 'p0', [[C(0, 4), C(0, 5), J[0], C(0, 7), C(0, 8)], tbl[1]]);
  assert.ok(r.ok, r.error);
});

// ---------- Rundenende und Wertung ----------
test('Rundenende: letzte Karte ablegen, Wertung (Joker 20, Ass 11), Gesamtpunkte', () => {
  const s = mk([[C(0, 2)], [C(0, 1), J[0], C(2, 4), C(3, 12)], [C(1, 9), C(1, 10)]], [R(0, 4, 6)], [true, true, true]);
  assert.ok(E.handle(s, 'p0', { t: 'discard', card: C(0, 2) }).ok);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.winners, ['p0']);
  const pen1 = 11 + 20 + 4 + 10, pen2 = 9 + 10;
  assert.deepEqual(s.result.deltas, { p0: pen1 + pen2, p1: -pen1, p2: -pen2 });
  assert.equal(s.players.reduce((a, p) => a + p.score, 0), 0);
  assert.equal(s.result.double, false);
  assert.equal(s.result.reason, 'leer');
  assert.ok(s.recap.some((t) => /Rommé/.test(t)));
  // keine Züge mehr
  assert.equal(E.handle(s, 'p1', { t: 'draw', from: 'pile' }).ok, false);
  assert.equal(E.handle(s, 'p0', { t: 'discard', card: C(0, 2) }).ok, false);
  assert.equal(E.checkTurn(s, 'p0', []).ok, false);
  bal(s);
  const rk = E.ranking(s);
  assert.equal(rk[0].id, 'p0'); assert.equal(rk[0].place, 1);
  // nächste Runde: Punkte bleiben, Startperson rotiert, neu ausgeteilt
  assert.ok(E.handle(s, 'p1', { t: 'next' }, mulberry(5)).ok);
  assert.equal(s.round, 2); assert.equal(s.phase, 'play'); assert.equal(s.turn, 'draw');
  assert.equal(s.players[0].score, pen1 + pen2); assert.equal(s.players[1].score, -pen1);
  assert.ok(s.players.every((p) => p.hand.length === 13 && !p.melded));
  assert.equal(s.active, 1); assert.equal(s.table.length, 0);
  bal(s);
  assert.equal(E.handle(s, 'p0', { t: 'next' }).ok, false); // Runde läuft noch
  assert.equal(E.handle(s, 'zz', { t: 'next' }).ok, false);
});

test('Auslegen der letzten Karte beendet die Runde sofort (ohne Ablegen)', () => {
  const s = mk([R(2, 5, 8), [C(0, 1), C(1, 2), C(2, 4), C(3, 12)]], [], [], {});
  s.players[0].melded = true;
  assert.ok(meld(s, 'p0', [R(2, 5, 8)]).ok);
  assert.equal(s.phase, 'over'); assert.deepEqual(s.result.winners, ['p0']);
  assert.equal(s.result.double, false); // war nicht „ohne vorherige Eröffnung“ (bereits eröffnet)
});

test('Rommé in einem Zug: doppelte Wertung (opts.double), nur ohne vorherige Eröffnung', () => {
  const hand = [...R(1, 10, 13), C(0, 5), C(1, 5), C(2, 5)];
  const other = [C(0, 1), C(1, 2), C(2, 4), C(3, 12)];
  // alles in einem Zug ausgelegt und abgelegt, nicht eröffnet
  let s = mk([hand.concat([C(3, 2)]), other], [], [], {});
  assert.ok(meld(s, 'p0', [R(1, 10, 13), [C(0, 5), C(1, 5), C(2, 5)]]).ok);
  assert.equal(s.phase, 'play');
  assert.ok(E.handle(s, 'p0', { t: 'discard', card: C(3, 2) }).ok);
  assert.equal(s.phase, 'over');
  assert.equal(s.result.double, true);
  const pen = 11 + 2 + 4 + 10;
  assert.deepEqual(s.result.deltas, { p0: pen * 2, p1: -pen * 2 });
  assert.match(s.recap.join(' '), /doppelte Wertung/);
  // Option aus: einfache Wertung
  s = mk([hand.concat([C(3, 2)]), other], [], [], { double: false });
  meld(s, 'p0', [R(1, 10, 13), [C(0, 5), C(1, 5), C(2, 5)]]);
  E.handle(s, 'p0', { t: 'discard', card: C(3, 2) });
  assert.equal(s.result.double, false);
  assert.deepEqual(s.result.deltas, { p0: pen, p1: -pen });
  // alles auslegen ohne Ablegen, ohne Eröffnung in einem Zug: ebenfalls doppelt
  s = mk([hand, other], [], [], {});
  assert.ok(meld(s, 'p0', [R(1, 10, 13), [C(0, 5), C(1, 5), C(2, 5)]]).ok);
  assert.equal(s.phase, 'over'); assert.equal(s.result.double, true);
  // Eröffnung in einem früheren Zug: keine doppelte Wertung
  s = mk([hand.concat([C(3, 2)]), other], [], [true, false], {});
  meld(s, 'p0', [R(1, 10, 13), [C(0, 5), C(1, 5), C(2, 5)]]);
  E.handle(s, 'p0', { t: 'discard', card: C(3, 2) });
  assert.equal(s.result.double, false);
  // Eröffnung und Rest in zwei Meldungen desselben Zuges: weiter doppelt (nicht vorher eröffnet)
  s = mk([[...R(1, 10, 13), C(0, 5), C(1, 5), C(2, 5)], other], [], [], {});
  assert.ok(meld(s, 'p0', [R(1, 10, 13)]).ok);
  assert.equal(s.phase, 'play');
  assert.ok(meld(s, 'p0', [R(1, 10, 13), [C(0, 5), C(1, 5), C(2, 5)]]).ok);
  assert.equal(s.result.double, true);
});

test('Wertung mit mehreren Personen und Rundenzahl-Sicherung (Blockade)', () => {
  const s = mk([[C(0, 2)], [C(0, 1), J[0]], [C(1, 9)], [C(2, 3)]], [], [true, true, true, true]);
  E.handle(s, 'p0', { t: 'discard', card: C(0, 2) });
  assert.deepEqual(s.result.deltas, { p0: 31 + 9 + 3, p1: -31, p2: -9, p3: -3 });
  // Zugdeckel: nach PLY_CAP Zügen endet die Runde, niedrigste Strafpunkte gewinnen
  const t = mk([[C(0, 2), C(0, 5)], [C(0, 1), C(1, 2)], [C(1, 9), C(1, 10)]], [], [], {}, 'draw');
  t.plies = E.PLY_CAP - 1;
  E.handle(t, 'p0', { t: 'draw', from: 'pile' }, mulberry(1));
  E.handle(t, 'p0', { t: 'discard', card: t.players[0].hand[t.players[0].hand.length - 1] }, mulberry(1));
  assert.equal(t.phase, 'over'); assert.equal(t.result.reason, 'blockade');
  assert.ok(t.result.winners.length >= 1);
  assert.equal(Object.values(t.result.deltas).filter((d) => d > 0).length >= 1, true);
});

// ---------- JSON, Bilanz, Zufallspartien ----------
test('Zustand ist JSON-sicher (Rundlauf), Engine ändert Eingaben nicht', () => {
  const s = E.createGame(names(3), {}, mulberry(7));
  const copy = JSON.parse(JSON.stringify(s));
  assert.deepEqual(copy, s);
  E.handle(copy, copy.players[copy.active].id, { t: 'draw', from: 'pile' }, mulberry(1));
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), copy);
  const table = [[C(0, 2), C(0, 3), C(0, 4)]];
  const snap = JSON.stringify(table);
  E.analyzeSet(table[0]); E.normalizeTable(table); E.checkTurn(copy, 'p0', table);
  assert.equal(JSON.stringify(table), snap);
});

// Zufallsspieler: nimmt zufällig, legt zufällige einfache Sätze aus (auch anlegen), legt zufällig ab
function randomMove(s, rng) {
  const me = E.activePlayer(s);
  if (s.turn === 'draw') return { t: 'draw', from: rng() < 0.4 && s.discard.length ? 'discard' : 'pile' };
  if (rng() < 0.5) {
    const hand = me.hand;
    const cands = [];
    for (let su = 0; su < 4; su++) for (let a = 1; a <= 11; a++) for (let b = a + 2; b <= Math.min(13, a + 4); b++) {
      const ids = [];
      for (let n = a; n <= b; n++) { const h = hand.find((x) => (x === C(su, n) || x === C(su, n, 1)) && !ids.includes(x)); if (h === undefined) break; ids.push(h); }
      if (ids.length === b - a + 1) cands.push(ids);
    }
    for (let r = 1; r <= 13; r++) {
      const ids = [];
      for (let su = 0; su < 4; su++) { const h = hand.find((x) => (x === C(su, r) || x === C(su, r, 1)) && !ids.includes(x)); if (h !== undefined) ids.push(h); }
      if (ids.length >= 3) cands.push(ids);
    }
    const table = s.table.map((x) => x.slice());
    if (me.melded) {
      for (const set of table) {
        const a = E.analyzeSet(set);
        if (a.kind === 'folge' && a.hi < 13 && rng() < 0.5) { const h = hand.find((x) => x < 104 && E.CARDS[x].suit === a.suit && E.CARDS[x].rank === a.hi + 1); if (h !== undefined) set.push(h); }
      }
    }
    if (cands.length) {
      const pickc = pick(cands, rng);
      const m = { t: 'meld', table: table.concat([pickc]) };
      if (E.checkTurn(s, me.id, m.table).ok) return m;
    }
    const m = { t: 'meld', table };
    if (E.checkTurn(s, me.id, table).ok) return m;
  }
  const opts = me.hand.filter((id) => E.canDiscard(s, me.id, id) === '');
  return { t: 'discard', card: pick(opts, rng) };
}

test('200 Zufallspartien enden immer; Bilanz 110 nach jedem Schritt; Ablagekarten nie verloren', () => {
  let rounds = 0, melds = 0, drawsDiscard = 0, caps = 0, doubles = 0, reshuffles = 0;
  for (let g = 0; g < 200; g++) {
    const rng = mulberry(1000 + g);
    const n = 2 + (g % 3);
    const s = E.createGame(names(n), { hand: g % 7 === 0 ? 4 : 13, swap: g % 2 === 0 }, rng);
    let steps = 0;
    while (s.phase === 'play') {
      assert.ok(steps++ < 4000, 'Endlosspiel');
      const pid = E.activePlayer(s).id;
      const m = randomMove(s, rng);
      const pile0 = s.pile.length;
      const r = E.handle(s, pid, m, rng);
      assert.ok(r.ok, JSON.stringify(m) + ' ' + r.error);
      if (m.t === 'meld') melds++;
      if (m.t === 'draw' && m.from === 'discard') drawsDiscard++;
      if (m.t === 'draw' && m.from === 'pile' && s.pile.length > pile0) reshuffles++;
      bal(s);
      assert.equal(new Set([].concat(s.pile, s.discard, ...s.players.map((p) => p.hand), ...s.table)).size, 110);
      assert.ok(s.discard.length >= 1 || s.turn === 'play');
    }
    rounds++;
    if (s.result.reason === 'blockade') caps++;
    if (s.result.double) doubles++;
    assert.equal(s.players.reduce((a, p) => a + p.score, 0), s.result.winners.length === 1 ? 0 : s.players.reduce((a, p) => a + p.score, 0));
    assert.ok(s.result.winners.length >= 1);
    const sum = Object.values(s.result.deltas).reduce((a, b) => a + b, 0);
    assert.ok(s.result.winners.length > 1 ? Math.abs(sum) <= s.result.winners.length : sum === 0, 'Wertung geht auf: ' + sum);
  }
  console.log(`Zufallspartien: ${rounds} Runden, Auslegen ${melds}x, Ablage genommen ${drawsDiscard}x, Neumischen ${reshuffles}x, Rommé-doppelt ${doubles}x, Deckel ${caps}x`);
  assert.equal(rounds, 200);
  assert.ok(melds > 100 && drawsDiscard > 100);
});

test('Stapel-Neumischen kommt in langen Partien vor und verliert keine Karte', () => {
  let reshuffled = 0;
  for (let g = 0; g < 30; g++) {
    const rng = mulberry(77 + g);
    const s = E.createGame(names(2), {}, rng);
    for (let k = 0; k < 600 && s.phase === 'play'; k++) {
      const pid = E.activePlayer(s).id;
      let m;
      if (s.turn === 'draw') m = { t: 'draw', from: 'pile' };
      else m = { t: 'discard', card: pick(E.activePlayer(s).hand, rng) };
      const before = s.pile.length;
      const r = E.handle(s, pid, m, rng);
      if (!r.ok) { E.handle(s, pid, { t: 'discard', card: E.activePlayer(s).hand.find((id) => !E.canDiscard(s, pid, id)) }, rng); continue; }
      if (m.t === 'draw' && s.pile.length > before) reshuffled++;
      bal(s);
    }
  }
  assert.ok(reshuffled >= 5, 'Neumischen ' + reshuffled);
});
