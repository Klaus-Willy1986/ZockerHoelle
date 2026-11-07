import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../reihen/engine.js';

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
// Farbe 0 rot, 1 blau, 2 gelb, 3 gruen; Zahl 1..13; Kopie 0|1
const T = (c, n, k = 0) => k * 52 + c * 13 + n - 1;
const J1 = 104, J2 = 105;
const R = (c, from, to, k = 0) => Array.from({ length: to - from + 1 }, (_, i) => T(c, from + i, k));

// Zustand mit festen Händen/Tisch; pile enthält den Rest (damit Bilanz 106 stimmt)
function mk(hands, table = [], melded = [], active = 0) {
  const s = E.createGame(names(hands.length), {}, mulberry(1));
  const used = new Set([].concat(...hands, ...table));
  assert.equal(used.size, [].concat(...hands, ...table).length, 'Testaufbau: doppelte Steine');
  s.players.forEach((p, i) => { p.hand = hands[i].slice(); p.melded = !!melded[i]; });
  s.table = table.map((x) => x.slice());
  s.pile = Array.from({ length: 106 }, (_, i) => i).filter((i) => !used.has(i));
  s.active = active; s.starter = active; s.passes = 0;
  return s;
}
const bal = (s) => assert.equal(E.tileBalance(s).summe, 106);
const play = (s, pid, table) => E.handle(s, pid, { t: 'play', table });

// ---------- Steinsatz & Austeilen ----------
test('Steine: 106, richtige Verteilung', () => {
  assert.equal(E.TILES.length, 106);
  assert.ok(E.TILES.every((t, i) => t.id === i));
  const cnt = {};
  for (const t of E.TILES.slice(0, 104)) { const k = t.color + ':' + t.num; cnt[k] = (cnt[k] || 0) + 1; assert.ok(t.color >= 0 && t.color < 4 && t.num >= 1 && t.num <= 13); }
  assert.equal(Object.keys(cnt).length, 52);
  assert.ok(Object.values(cnt).every((c) => c === 2));
  assert.deepEqual(E.TILES[104], { id: 104, color: -1, num: 0 });
  assert.deepEqual(E.TILES[105], { id: 105, color: -1, num: 0 });
  assert.deepEqual(E.TILES[T(2, 7, 1)], { id: 52 + 26 + 6, color: 2, num: 7 });
  assert.equal(E.tileLabel(T(0, 5)), 'Rot 5');
  assert.equal(E.tileLabel(T(3, 13)), 'Grün 13');
  assert.equal(E.tileLabel(J1), 'Joker');
});

test('Austeilen: 14 je Person, Rest Stapel, Startperson zufällig, Fehler bei falscher Personenzahl', () => {
  for (let n = 2; n <= 4; n++) {
    const s = E.createGame(names(n), {}, mulberry(n));
    assert.equal(s.players.length, n);
    assert.ok(s.players.every((p) => p.hand.length === 14 && !p.melded && p.score === 0));
    assert.equal(s.pile.length, 106 - 14 * n);
    assert.deepEqual(s.table, []);
    assert.equal(s.phase, 'play');
    assert.equal(new Set([].concat(s.pile, ...s.players.map((p) => p.hand))).size, 106);
    bal(s);
  }
  assert.throws(() => E.createGame(names(1), {}, Math.random), RangeError);
  assert.throws(() => E.createGame(names(5), {}, Math.random), RangeError);
  const starters = new Set();
  for (let i = 1; i <= 60; i++) starters.add(E.createGame(names(4), {}, mulberry(i * 31)).active);
  assert.equal(starters.size, 4);
});

// ---------- analyzeSet ----------
const A = (ids) => E.analyzeSet(ids);
test('analyzeSet: gültige Reihen und Gruppen (Tabelle)', () => {
  const ok = [
    [[T(0, 1), T(0, 2), T(0, 3)], 'reihe', 6],
    [[T(0, 3), T(0, 1), T(0, 2)], 'reihe', 6], // beliebige Reihenfolge
    [R(1, 4, 8), 'reihe', 30],
    [R(2, 1, 13), 'reihe', 91],
    [[T(0, 11), T(0, 12), T(0, 13)], 'reihe', 36],
    [[T(0, 5), T(1, 5), T(2, 5)], 'gruppe', 15],
    [[T(0, 5), T(1, 5), T(2, 5), T(3, 5)], 'gruppe', 20],
    [[T(0, 13, 1), T(3, 13, 0), T(1, 13, 1)], 'gruppe', 39],
    [[T(0, 5), T(0, 6), J1], 'reihe', 18], // Joker am Ende: höchster Wert (7)
    [[J1, T(0, 12), T(0, 13)], 'reihe', 36], // Joker kann nur unten sein (11)
    [[T(0, 5), J1, T(0, 7)], 'reihe', 18], // Joker in der Mitte
    [[T(0, 5), J1, J2, T(0, 8)], 'reihe', 26], // zwei Joker in der Mitte
    [[T(0, 5), J1, J2], 'reihe', 18], // zwei Joker am Ende: 5,6,7
    [[T(0, 5), T(0, 6), J1, J2], 'reihe', 26], // 5,6,7,8
    [[T(0, 12), T(0, 13), J1, J2], 'reihe', 12 + 13 + 11 + 10],
    [[T(0, 5), T(1, 5), J1], 'gruppe', 15],
    [[T(0, 5), T(1, 5), J1, J2], 'gruppe', 20],
    [[T(0, 5), T(1, 5), T(2, 5), J1], 'gruppe', 20],
    [[T(0, 13), J1, J2], 'gruppe', 39], // Reihe 11,12,13 = 36 < Gruppe 39
    [[T(0, 5), J1, J2], 'reihe', 18], // Reihe (18) wertvoller als Gruppe (15)
  ];
  ok.forEach(([ids, kind, value], i) => {
    const a = A(ids);
    assert.equal(a.valid, true, `Fall ${i}: ${a.reason}`);
    assert.equal(a.kind, kind, `Fall ${i}`);
    assert.equal(a.value, value, `Fall ${i}`);
    assert.equal(a.reason, '');
    assert.deepEqual(a.order.slice().sort((x, y) => x - y), ids.slice().sort((x, y) => x - y));
    assert.equal(a.jokerAs.length, ids.filter((x) => x >= 104).length);
  });
});

test('analyzeSet: Reihenfolge und Jokerzuordnung', () => {
  const a = A([T(0, 7), J1, T(0, 5)]);
  assert.deepEqual(a.order, [T(0, 5), J1, T(0, 7)]);
  assert.deepEqual(a.jokerAs, [{ id: J1, color: 0, num: 6 }]);
  const b = A([J1, T(0, 5), T(0, 6)]);
  assert.deepEqual(b.order, [T(0, 5), T(0, 6), J1]);
  assert.deepEqual(b.jokerAs, [{ id: J1, color: 0, num: 7 }]);
  const c = A([T(1, 9), T(3, 9), J2]);
  assert.equal(c.kind, 'gruppe');
  assert.deepEqual(c.jokerAs, [{ id: J2, color: 0, num: 9 }]);
});

test('analyzeSet: ungültige Sätze mit deutscher Begründung', () => {
  const bad = [
    [[T(0, 1), T(0, 2)], /Mindestens 3 Steine/],
    [[], /Mindestens 3 Steine/],
    [[T(0, 1), T(0, 2), T(1, 3)], /dieselbe Farbe/],
    [[T(0, 1), T(0, 2), T(0, 4)], /fehlen Zahlen/],
    [[T(0, 12), T(0, 13), T(0, 1)], /fehlen Zahlen/], // Umlauf 12,13,1 ungültig
    [[T(0, 13), T(0, 1), J1], /fehlen Zahlen/], // 13,J,1 ungültig
    [[T(0, 3), T(0, 3, 1), T(0, 4)], /doppelt/], // zwei gleiche Steine in einer Reihe
    [[T(0, 5), T(1, 5), T(1, 5, 1)], /jede Farbe nur einmal/],
    [[T(0, 5), T(1, 5), T(2, 5), T(3, 5), J1], /höchstens 4/], // Gruppe mit 5
    [[T(0, 5), T(1, 5), T(2, 5), T(3, 5), T(0, 5, 1)], /jede Farbe nur einmal/],
    [[J1, J2], /Mindestens 3/],
    [[J1, J2, T(0, 1)].slice(0, 2), /Mindestens 3/],
    [[T(0, 5), T(1, 6), T(2, 7)], /dieselbe Farbe/],
    [[T(0, 5), T(1, 5), T(2, 6)], /dieselbe Farbe/],
    [[T(0, 1), T(0, 2), T(0, 3), T(0, 3, 1)], /doppelt/],
    [[T(0, 1), T(0, 2), J1, T(0, 6)], /fehlen Zahlen/],
    [[T(0, 5), T(0, 5, 1), J1], /doppelt|jede Farbe/],
    [[T(0, 1), T(0, 1), T(0, 2)], /Ungültige Steine/], // dieselbe id doppelt
    [[999, 1, 2], /Ungültige Steine/],
  ];
  bad.forEach(([ids, re], i) => {
    const a = A(ids);
    assert.equal(a.valid, false, `Fall ${i}`);
    assert.equal(a.kind, null);
    assert.equal(a.value, 0);
    assert.match(a.reason, re, `Fall ${i}: ${a.reason}`);
  });
  // nur Joker: nie gültig (hier 2 Joker, mehr gibt es nicht)
  assert.equal(A([J1, J2, J1]).valid, false);
  // 14 Steine einer Reihe unmöglich
  assert.equal(A(Array.from({ length: 14 }, (_, i) => i)).valid, false);
  assert.equal(A(null).valid, false);
});

test('Hilfsfunktionen: sortHand, sumValue', () => {
  const h = [J1, T(2, 3), T(0, 9), T(0, 2), T(1, 1), T(0, 2, 1)];
  assert.deepEqual(E.sortHand(h), [T(0, 2), T(0, 2, 1), T(0, 9), T(1, 1), T(2, 3), J1]);
  assert.equal(E.sumValue([T(0, 2), T(0, 13), J1]), 45);
  assert.equal(E.sumValue([]), 0);
  assert.deepEqual(h.length, 6); // Eingabe unverändert
});

// ---------- Eröffnung ----------
test('Eröffnen: genau 29 nicht, genau 30 ja', () => {
  // 30 mit einer Reihe 9,10,11; 27 mit 8,9,10
  let s = mk([[...R(0, 9, 11), T(1, 1), T(2, 13)], [T(3, 1)]]);
  assert.equal(E.checkTurn(s, 'p0', [R(0, 9, 11)]).newValue, 30);
  assert.equal(play(s, 'p0', [R(0, 9, 11)]).ok, true);
  s = mk([[...R(0, 8, 10), T(0, 11), T(1, 1)], [T(3, 1)]]);
  const r = play(s, 'p0', [R(0, 8, 10)]);
  assert.equal(r.ok, false);
  assert.match(r.error, /mindestens 30.*27/);
  // genau 29: Reihe 2,3,4 (9) + 4er-Gruppe aus 5ern (20)
  const g5 = [T(0, 5), T(1, 5), T(2, 5), T(3, 5)];
  s = mk([[...R(0, 2, 4), ...g5, T(1, 13)], [T(3, 6)]]);
  const c29 = E.checkTurn(s, 'p0', [R(0, 2, 4), g5]);
  assert.equal(c29.ok, false);
  assert.equal(c29.newValue, 29);
  assert.match(c29.error, /29/);
  assert.equal(play(s, 'p0', [R(0, 2, 4), g5]).ok, false);
  assert.equal(s.players[0].hand.length, 8); // unverändert
  assert.equal(s.players[0].melded, false);
  // genau 30: Reihe 2,3,4 (9) + Gruppe 7,7,7 (21)
  s = mk([[...R(0, 2, 4), T(0, 7), T(1, 7), T(2, 7), T(1, 13)], [T(3, 6)]]);
  assert.equal(E.checkTurn(s, 'p0', [R(0, 2, 4), [T(0, 7), T(1, 7), T(2, 7)]]).newValue, 30);
  assert.equal(play(s, 'p0', [R(0, 2, 4), [T(0, 7), T(1, 7), T(2, 7)]]).ok, true);
  assert.equal(s.players[0].melded, true);
});

test('Eröffnen: genau 30 mit mehreren Sätzen, Joker mit vertretenem Wert', () => {
  // Gruppe 10,10,J = 30
  let s = mk([[T(0, 10), T(1, 10), J1, T(2, 1)], [T(3, 2)]]);
  const c = E.checkTurn(s, 'p0', [[T(0, 10), T(1, 10), J1]]);
  assert.equal(c.ok, true);
  assert.equal(c.newValue, 30);
  // Reihe 9,10,J: Joker = 11 -> 30
  s = mk([[T(0, 9), T(0, 10), J1], [T(3, 2)]]);
  assert.equal(E.checkTurn(s, 'p0', [[T(0, 9), T(0, 10), J1]]).newValue, 30);
  // Reihe 8,9,J = 8+9+10 = 27 (ohne Joker-30!)
  s = mk([[T(0, 8), T(0, 9), J1], [T(3, 2)]]);
  const r = E.checkTurn(s, 'p0', [[T(0, 8), T(0, 9), J1]]);
  assert.equal(r.ok, false); assert.equal(r.newValue, 27);
  // zwei Sätze zusammen 30: 4,5,6 (15) + 7,7,... Gruppe 5,5,5 (15) = 30
  s = mk([[...R(0, 4, 6), T(0, 5, 1), T(1, 5), T(2, 5)], [T(3, 2)]]);
  assert.equal(E.checkTurn(s, 'p0', [R(0, 4, 6), [T(0, 5, 1), T(1, 5), T(2, 5)]]).newValue, 30);
});

test('Eröffnen: Tischsteine vorher verboten, alte Sätze müssen unverändert bleiben', () => {
  const old = [R(0, 1, 4)];
  const s = mk([[...R(1, 10, 12), T(0, 5), T(2, 9)], [T(3, 1)]], old, [false, true]);
  // 33 Punkte neu, alter Satz unverändert -> ok
  assert.equal(E.checkTurn(s, 'p0', [R(0, 1, 4), R(1, 10, 12)]).ok, true);
  // Tischstein anbauen (5 an die Reihe) verboten
  let r = E.checkTurn(s, 'p0', [[...R(0, 1, 4), T(0, 5)], R(1, 10, 12)]);
  assert.equal(r.ok, false); assert.match(r.error, /Eröffnen.*nicht verändert/);
  // Reihe teilen verboten
  r = E.checkTurn(s, 'p0', [R(0, 1, 2), R(1, 10, 12)].concat([[T(0, 3), T(0, 4)]]));
  assert.equal(r.ok, false);
  // Steine vom Tisch in neuen Satz verwenden verboten
  r = E.checkTurn(s, 'p0', [[T(0, 1), T(0, 2), T(0, 3)], [T(0, 4), T(1, 11), T(1, 12)]]);
  assert.equal(r.ok, false);
  // Auch wenn nur Handsteine gelegt werden, der alte Satz muss fehlen dürfen nicht
  r = E.checkTurn(s, 'p0', [R(1, 10, 12)]);
  assert.equal(r.ok, false); assert.match(r.error, /zurück in die Hand/);
});

test('Nach der Eröffnung: melded gesetzt, danach beliebig kleine Sätze und Anlegen erlaubt', () => {
  const s = mk([[...R(0, 9, 11), T(1, 1), T(1, 2), T(1, 3), T(0, 12)], [T(3, 1)]]);
  assert.equal(play(s, 'p0', [R(0, 9, 11)]).ok, true);
  assert.equal(s.players[0].melded, true);
  assert.equal(s.active, 1);
  // zurück zu p0: neue Runde der Reihenfolge
  s.active = 0;
  // 6 Punkte, kein Mindestwert mehr; plus Anlegen
  const r = play(s, 'p0', [[...R(0, 9, 11), T(0, 12)], R(1, 1, 3)]);
  assert.equal(r.ok, true);
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.phase, 'over');
});

// ---------- Umordnen ----------
test('Umordnen: Reihe teilen, Gruppe bilden, Joker austauschen', () => {
  // Tisch: rot 3..8. Hand: rot 9? Wir teilen 3..8 in 3,4,5 und 6,7,8.. plus Hand 5? einfach: Reihe teilen und Hand-Stein anfügen.
  let s = mk([[T(0, 9), T(0, 2)], [T(3, 1)]], [R(0, 3, 8)], [true, true]);
  let r = play(s, 'p0', [R(0, 3, 5), R(0, 6, 9)]); // 6,7,8,9 + 3,4,5
  assert.equal(r.ok, true);
  assert.equal(s.table.length, 2);
  assert.deepEqual(s.players[0].hand, [T(0, 2)]);
  // Gruppe bilden aus Reihenstein: Tisch blau 4..8 (Länge 5), Hand rot 6 + gelb 6: Gruppe 6 aus blau 6
  s = mk([[T(0, 6), T(2, 6), T(3, 1)], [T(3, 2)]], [R(1, 4, 8), [T(0, 1), T(1, 1), T(2, 1)]], [true, true]);
  r = play(s, 'p0', [R(1, 4, 5), R(1, 7, 8).concat([]), [T(0, 6), T(1, 6), T(2, 6)], [T(0, 1), T(1, 1), T(2, 1)]]);
  assert.equal(r.ok, false); // 4,5 und 7,8 zu kurz
  r = play(s, 'p0', [[T(0, 6), T(1, 6), T(2, 6)], [T(1, 4), T(1, 5)], R(1, 7, 8), [T(0, 1), T(1, 1), T(2, 1)]]);
  assert.equal(r.ok, false);
  // gültig: blau 4..8 behält 4..7, blau 8 geht in Gruppe 8 (Hand rot 8, gelb 8)
  s = mk([[T(0, 8), T(2, 8), T(3, 1)], [T(3, 2)]], [R(1, 4, 8)], [true, true]);
  r = play(s, 'p0', [R(1, 4, 7), [T(0, 8), T(1, 8), T(2, 8)]]);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(s.players[0].hand, [T(3, 1)]);
  // Joker austauschen: Tisch rot 5,J,7. Hand rot 6 + Joker kommt in neue Gruppe mit blau 9, gelb 9
  s = mk([[T(0, 6), T(1, 9), T(2, 9), T(3, 1)], [T(3, 2)]], [[T(0, 5), J1, T(0, 7)]], [true, true]);
  r = play(s, 'p0', [R(0, 5, 7), [T(1, 9), T(2, 9), J1]]);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(s.players[0].hand, [T(3, 1)]);
  assert.ok(s.table.flat().includes(J1));
  bal(s);
  // Joker austauschen, aber Joker nicht wieder verbaut: verboten (kommt in die Hand)
  s = mk([[T(0, 6), T(3, 1)], [T(3, 2)]], [[T(0, 5), J1, T(0, 7)]], [true, true]);
  r = play(s, 'p0', [R(0, 5, 7)]);
  assert.equal(r.ok, false);
  assert.match(r.error, /zurück in die Hand/);
});

test('Tischsteine zurück in die Hand und fremde Steine verboten, mindestens 1 Handstein Pflicht', () => {
  const s = mk([[T(0, 9), T(1, 1)], [T(3, 1), T(3, 2), T(3, 3)]], [R(0, 1, 5)], [true, true]);
  // Tischstein weglassen
  let r = E.checkTurn(s, 'p0', [R(0, 1, 4)]);
  assert.equal(r.ok, false); assert.match(r.error, /zurück in die Hand/);
  // kein Handstein
  r = E.checkTurn(s, 'p0', [R(0, 1, 5)]);
  assert.equal(r.ok, false); assert.match(r.error, /mindestens einen Stein aus deiner Hand/);
  r = E.checkTurn(s, 'p0', []);
  assert.equal(r.ok, false);
  // Stein der anderen Person
  r = E.checkTurn(s, 'p0', [R(0, 1, 5), R(3, 1, 3)]);
  assert.equal(r.ok, false); assert.match(r.error, /gehört dir nicht/);
  // doppelt
  r = E.checkTurn(s, 'p0', [R(0, 1, 5), [T(0, 1), T(0, 2), T(0, 3)]]);
  assert.equal(r.ok, false); assert.match(r.error, /mehrfach/);
  // ungültiger Satz nennt Satz und Begründung; bad enthält Index
  r = E.checkTurn(s, 'p0', [R(0, 1, 5), [T(0, 9), T(1, 1)]]);
  assert.equal(r.ok, false); assert.match(r.error, /Satz 2.*Mindestens 3/); assert.deepEqual(r.bad, [1]);
  // Spielzustand unverändert nach Fehlern
  assert.deepEqual(s.players[0].hand, [T(0, 9), T(1, 1)]);
});

test('checkTurn liefert normalisierte Sätze, Wert und gelegte Steine; Zustand wird nicht verändert', () => {
  const s = mk([[T(0, 9), T(0, 10), J1, T(2, 2)], [T(3, 1)]]);
  const before = JSON.stringify(s);
  const c = E.checkTurn(s, 'p0', [[J1, T(0, 10), T(0, 9)]]);
  assert.equal(c.ok, true);
  assert.deepEqual(c.table, [[T(0, 9), T(0, 10), J1]]);
  assert.deepEqual(c.played.slice().sort((a, b) => a - b), [T(0, 9), T(0, 10), J1].sort((a, b) => a - b));
  assert.equal(c.sets[0].kind, 'reihe');
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(E.normalizeTable([[J1, T(0, 10), T(0, 9)], [1, 2]]), [[T(0, 9), T(0, 10), J1], [1, 2]]);
});

// ---------- Ziehen, Passen, Runden ----------
test('Ziehen: Stein kommt auf die Hand, Zug endet, lastDrawn gesetzt', () => {
  const s = E.createGame(names(3), {}, mulberry(5));
  const a = s.active; const pid = s.players[a].id;
  const top = s.pile[s.pile.length - 1]; const n = s.pile.length;
  assert.deepEqual(E.handle(s, pid, { t: 'draw' }), { ok: true });
  assert.equal(s.pile.length, n - 1);
  assert.equal(s.players[a].hand.length, 15);
  assert.ok(s.players[a].hand.includes(top));
  assert.equal(s.lastDrawn, top); assert.equal(s.lastDrawnBy, pid);
  assert.equal(s.active, (a + 1) % 3);
  bal(s);
});

test('Leerer Stapel: Passen, Blockade nach vollem Umlauf, niedrigste Reststeinsumme gewinnt', () => {
  const s = mk([[T(0, 1), T(0, 5)], [T(1, 2), T(1, 3), T(1, 4)], [T(2, 13)]]);
  s.pile = [];
  s.players.forEach((p) => { p.melded = true; });
  // 106 Bilanz mit leerem Stapel nicht erreichbar -> hier nur Logik prüfen
  assert.deepEqual(E.handle(s, 'p0', { t: 'draw' }), { ok: true });
  assert.equal(s.passes, 1); assert.equal(s.phase, 'play');
  assert.match(s.recap[0], /passt/);
  E.handle(s, 'p1', { t: 'draw' });
  assert.equal(s.passes, 2); assert.equal(s.phase, 'play');
  E.handle(s, 'p2', { t: 'draw' });
  assert.equal(s.phase, 'over');
  assert.equal(s.result.reason, 'blockade');
  assert.deepEqual(s.result.winners, ['p0']); // 6 < 9 < 13
  assert.deepEqual(s.result.deltas, { p0: 22, p1: -9, p2: -13 });
  assert.deepEqual(s.players.map((p) => p.score), [22, -9, -13]);
});

test('Blockade: Gleichstand teilt die Pluspunkte abgerundet; Legen setzt Passzähler zurück', () => {
  const s = mk([[T(0, 5), T(0, 6)], [T(1, 5), T(1, 6)], [T(2, 13)]]);
  s.pile = [];
  E.handle(s, 'p0', { t: 'draw' });
  E.handle(s, 'p1', { t: 'draw' });
  assert.equal(s.passes, 2);
  E.handle(s, 'p2', { t: 'draw' });
  assert.deepEqual(s.result.winners, ['p0', 'p1']);
  assert.deepEqual(s.result.deltas, { p0: 6, p1: 6, p2: -13 }); // 13 / 2 = 6 (abgerundet)
  // Passzähler wird durch Legen zurückgesetzt
  const t = mk([[T(0, 5), T(0, 6), T(0, 7), T(1, 1)], [T(1, 5)]], [R(2, 1, 3)], [true, true]);
  t.pile = [];
  E.handle(t, 'p0', { t: 'draw' });
  assert.equal(t.passes, 1);
  assert.equal(E.handle(t, 'p1', { t: 'draw' }).ok, true);
  assert.equal(t.phase, 'over');
  const u = mk([[T(0, 5), T(0, 6), T(0, 7), T(1, 1)], [T(1, 5)], [T(3, 4)]], [R(2, 1, 3)], [true, true, true]);
  u.pile = [];
  E.handle(u, 'p0', { t: 'draw' });
  assert.equal(u.passes, 1);
  E.handle(u, 'p1', { t: 'draw' });
  assert.equal(u.passes, 2);
  u.active = 0;
  assert.equal(play(u, 'p0', [R(2, 1, 3), R(0, 5, 7)]).ok, true);
  assert.equal(u.passes, 0);
});

test('Rundenende: Hand leer, Wertung (Joker 30), Plus für Siegerin, Minus für andere', () => {
  const s = mk([[T(0, 9)], [J1, T(1, 3)], [T(2, 7), T(2, 8)]], [R(0, 10, 12)], [true, true, true]);
  const r = play(s, 'p0', [R(0, 9, 12)]);
  assert.equal(r.ok, true);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winners: ['p0'], deltas: { p0: 33 + 15, p1: -33, p2: -15 }, reason: 'leer' });
  assert.deepEqual(s.players.map((p) => p.score), [48, -33, -15]);
  assert.equal(E.ranking(s)[0].id, 'p0');
  // nach dem Ende keine Züge mehr
  assert.equal(E.handle(s, 'p1', { t: 'draw' }).ok, false);
  assert.equal(play(s, 'p1', []).ok, false);
});

test('Mehrere Runden: Punkte bleiben, Startperson rotiert, nur in phase over', () => {
  const rng = mulberry(11);
  const s = E.createGame(names(3), {}, rng);
  const first = s.starter;
  assert.equal(E.handle(s, 'p0', { t: 'next' }, rng).ok, false);
  assert.match(E.handle(s, 'p0', { t: 'next' }, rng).error, /läuft noch/);
  // Runde künstlich beenden
  s.players[0].hand = [T(0, 1)]; s.players[1].hand = [T(1, 1), T(1, 2)];
  s.phase = 'over'; s.players[0].score = 10; s.players[1].score = -4; s.players[2].score = -6;
  assert.equal(E.handle(s, 'zz', { t: 'next' }, rng).ok, false);
  assert.deepEqual(E.handle(s, 'p2', { t: 'next' }, rng), { ok: true });
  assert.equal(s.round, 2);
  assert.equal(s.starter, (first + 1) % 3);
  assert.equal(s.active, s.starter);
  assert.equal(s.phase, 'play');
  assert.ok(s.players.every((p) => p.hand.length === 14 && !p.melded));
  assert.deepEqual(s.players.map((p) => p.score), [10, -4, -6]);
  assert.deepEqual(s.table, []);
  assert.equal(s.result, null);
  bal(s);
  const rk = E.ranking(s);
  assert.deepEqual(rk.map((r) => [r.id, r.place]), [['p0', 1], ['p1', 2], ['p2', 3]]);
  s.players[2].score = -4;
  assert.deepEqual(E.ranking(s).map((r) => r.place), [1, 2, 2]);
});

// ---------- Fehlerbehandlung ----------
test('Ungültige Nachrichten, falsche Person, falsche Phase: nie Ausnahme, Zustand unverändert', () => {
  const s = E.createGame(names(2), {}, mulberry(2));
  const other = s.players[(s.active + 1) % 2].id;
  const me = s.players[s.active].id;
  const snap = JSON.stringify(s);
  const bad = [null, undefined, 5, 'x', {}, { t: 'zzz' }, { t: 'play' }, { t: 'play', table: 'x' }, { t: 'play', table: [1] }, { t: 'play', table: [[1, 'a', 2]] },
    { t: 'play', table: [[-1, 500, 7]] }, { t: 'play', table: [[0, 1, 2]] }, { t: 'play', table: [[{}]] }, { t: 'play', table: [null] }];
  for (const m of bad) {
    const r = E.handle(s, me, m);
    assert.equal(r.ok, false); assert.equal(typeof r.error, 'string'); assert.ok(r.error.length > 0);
  }
  assert.equal(E.handle(s, other, { t: 'draw' }).error, 'Du bist nicht an der Reihe.');
  assert.equal(E.handle(s, 'fremd', { t: 'draw' }).error, 'Du spielst hier nicht mit.');
  assert.match(E.handle(s, other, { t: 'play', table: [] }).error, /nicht an der Reihe/);
  assert.equal(E.handle(null, me, { t: 'draw' }).ok, false);
  assert.equal(E.handle(s, me, { t: 'next' }).ok, false);
  assert.equal(JSON.stringify(s), snap);
  s.phase = 'over';
  assert.match(E.handle(s, me, { t: 'draw' }).error, /zu Ende/);
  assert.match(E.handle(s, me, { t: 'play', table: [] }).error, /zu Ende/);
});

test('Zustand ist JSON-sicher (Roundtrip ändert nichts, Spiel läuft weiter)', () => {
  const rng = mulberry(3);
  let s = E.createGame(names(3), {}, rng);
  for (let i = 0; i < 12; i++) {
    E.handle(s, E.activePlayer(s).id, { t: 'draw' }, rng);
    const copy = JSON.parse(JSON.stringify(s));
    assert.deepEqual(copy, s);
    s = copy;
  }
  bal(s);
  s.phase = 'over';
  E.handle(s, 'p0', { t: 'next' }, rng);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

// ---------- Zufallspartien ----------
// Zufallsspieler: legt einen zufälligen gültigen Zug (einfache Sätze aus der Hand, Anlegen an Reihenenden) oder zieht
function randomMove(s, rng) {
  const me = E.activePlayer(s);
  if (rng() < 0.35) return { t: 'draw' };
  const hand = me.hand;
  const cands = [];
  for (let c = 0; c < 4; c++) for (let a = 1; a <= 11; a++) for (let b = a + 2; b <= Math.min(13, a + 4); b++) {
    const ids = [];
    for (let n = a; n <= b; n++) { const h = hand.find((x) => x === T(c, n) || x === T(c, n, 1)); if (h === undefined) break; ids.push(h); }
    if (ids.length === b - a + 1) cands.push(ids);
  }
  for (let n = 1; n <= 13; n++) {
    const ids = [];
    for (let c = 0; c < 4; c++) { const h = hand.find((x) => x === T(c, n) || x === T(c, n, 1)); if (h !== undefined) ids.push(h); }
    if (ids.length >= 3) cands.push(ids.slice(0, 3 + (rng() < 0.5 ? 1 : 0)).slice(0, ids.length));
  }
  if (hand.includes(J1) && cands.length && rng() < 0.3) { const c = pick(cands, rng).slice(); c.push(J1); cands.push(c); }
  // Anlegen an Reihen
  const out = [];
  if (cands.length) { const c = pick(cands, rng); out.push(c); }
  const table = s.table.map((x) => x.slice());
  for (const set of table) {
    const a = E.analyzeSet(set);
    if (a.kind === 'reihe' && rng() < 0.5) {
      const last = a.order[a.order.length - 1];
      const t = E.TILES[last];
      if (t.color >= 0 && t.num < 13) { const h = hand.find((x) => (x === T(t.color, t.num + 1) || x === T(t.color, t.num + 1, 1)) && !out.flat().includes(x)); if (h !== undefined) set.push(h); }
    }
  }
  return { t: 'play', table: table.concat(out) };
}

test('300 Zufallspartien (2–4 Personen) enden immer, Steinbilanz 106, Zustand konsistent', () => {
  let ended = 0, plays = 0, blockades = 0, empties = 0;
  for (let g = 0; g < 300; g++) {
    const n = 2 + (g % 3);
    const rng = mulberry(1000 + g);
    const s = E.createGame(names(n), {}, rng);
    let steps = 0;
    while (s.phase === 'play') {
      assert.ok(steps++ < 3000, 'Endlosspiel');
      const me = E.activePlayer(s);
      let m = randomMove(s, rng);
      let r = E.handle(s, me.id, m, rng);
      if (!r.ok) { if (m.t === 'play') { r = E.handle(s, me.id, { t: 'draw' }, rng); } }
      else if (m.t === 'play') plays++;
      assert.ok(r.ok, r.error);
      const b = E.tileBalance(s);
      assert.equal(b.summe, 106);
      for (const set of s.table) assert.ok(E.analyzeSet(set).valid);
    }
    ended++;
    if (s.result.reason === 'blockade') blockades++; else empties++;
    const sum = Object.values(s.result.deltas).reduce((a, b) => a + b, 0);
    assert.ok(sum <= 0 && sum > -E.TILE_COUNT * 30);
    assert.ok(s.result.winners.length >= 1);
  }
  assert.equal(ended, 300);
  assert.ok(plays > 100, 'Zufallsspieler legt zumindest manchmal: ' + plays);
  console.log(`Zufallspartien: ${ended} beendet, ${plays} Legezüge, ${empties}x leer gelegt, ${blockades}x Blockade`);
});
