import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../stapelrennen/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const snap = (g) => JSON.stringify(g);
const ap = (g) => P.activePlayer(g);

test('Kartensatz: 144 Zahlenkarten + 18 Joker', () => {
  const d = P.makeDeck();
  assert.equal(d.length, 162);
  assert.equal(d.filter((c) => c === P.JOKER).length, 18);
  for (let v = 1; v <= 12; v++) assert.equal(d.filter((c) => c === v).length, 12);
});

test('Mischen: gleiche Karten, anderes Mischergebnis, rng-gesteuert', () => {
  const a = P.shuffle(P.makeDeck(), seedRng(1)), b = P.shuffle(P.makeDeck(), seedRng(1)), c = P.shuffle(P.makeDeck(), seedRng(2));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort((x, y) => x - y), P.makeDeck().sort((x, y) => x - y));
  // Grenzwerte des Zufalls (0 und fast 1) werfen nichts
  P.shuffle(P.makeDeck(), () => 0);
  P.shuffle(P.makeDeck(), () => 0.9999999);
});

test('Verteilung: 30 Karten bei 2-4, 20 bei 5-6, Hand 5, alles vorhanden', () => {
  for (let n = 2; n <= 6; n++) {
    const g = P.createGame(players(n), {}, seedRng(n));
    const size = n <= 4 ? 30 : 20;
    g.players.forEach((p) => assert.equal(p.pile.length, size));
    assert.equal(ap(g).hand.length, 5);
    g.players.forEach((p, i) => { if (i !== g.active) assert.equal(p.hand.length, 0); assert.equal(p.aux.length, 4); });
    assert.equal(g.build.length, 4);
    assert.equal(P.totalCards(g), 162);
    assert.equal(g.draw.length, 162 - n * size - 5);
    assert.equal(g.mode, 'play');
  }
  assert.throws(() => P.createGame(players(1)));
  assert.throws(() => P.createGame(players(7)));
});

test('JSON-sicher und unveränderter Rundlauf', () => {
  const g = P.createGame(players(3), { points: true }, seedRng(5));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.equal(g.opts.points, true);
});

// Hilfe: Zustand für gezielte Tests aufbauen
function setup(hand, o = {}) {
  const g = P.createGame(players(o.n || 2), o.opts || {}, seedRng(9));
  const p = ap(g);
  p.hand = hand.slice();
  if (o.pile) p.pile = o.pile.slice();
  if (o.build) o.build.forEach((b, i) => { g.build[i] = b.slice(); });
  if (o.aux) o.aux.forEach((s, i) => { p.aux[i] = s.slice(); });
  return { g, p };
}

test('Aufbau: Start mit 1, aufsteigend, Joker ersetzt jede Zahl', () => {
  const { g, p } = setup([1, 2, 5, 0, 7]);
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 2, to: 0 }).ok, false, '5 auf leeren Stapel');
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 1, to: 0 }).ok, false, '2 auf leeren Stapel');
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }).ok, true);
  assert.deepEqual(g.build[0], [1]);
  // jetzt Hand [2,5,0,7]
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 1, to: 0 }).ok, false, '5 auf Stapel mit 1');
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }).ok, true);
  // Joker wird zur 3
  const r = P.play(g, 'p0', { t: 'play', from: 'hand', i: p.hand.indexOf(0), to: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.value, 3);
  assert.equal(g.last.value, 3);
  assert.deepEqual(g.build[0], [1, 2, 0]);
  assert.equal(P.buildNeeds(g.build[0]), 4);
  // Joker darf auch einen neuen Stapel beginnen (zählt als 1)
  const { g: g2, p: p2 } = setup([0, 4, 4, 4, 4]);
  assert.equal(P.play(g2, 'p0', { t: 'play', from: 'hand', i: p2.hand.indexOf(0), to: 1 }).value, 1);
  assert.equal(P.canPlayOn(3, g2.build[1]), false);
  assert.equal(P.canPlayOn(2, g2.build[1]), true);
});

test('Quellen: Spielerstapel, Hilfsstapel (nur oberste Karte), Hand', () => {
  const { g, p } = setup([9, 9, 9, 9, 9], { pile: [8, 1], aux: [[5, 2], [], [3, 1], []] });
  const src = P.sourcesOf(g, 0).map((s) => `${s.from}${s.i}:${s.card}`).sort();
  assert.deepEqual(src, ['aux0:2'.replace('0:2', '2:1'), 'pile0:1'].sort());
  // oberste Karte von aux0 ist 2: kann nicht auf leeren Stapel
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'aux', i: 0, to: 0 }).ok, false);
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'aux', i: 1, to: 0 }).ok, false, 'leerer Hilfsstapel');
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'aux', i: 2, to: 0 }).ok, true);
  assert.deepEqual(p.aux[2], [3]);
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'pile', to: 1 }).ok, true);
  assert.deepEqual(p.pile, [8]);
  // jetzt liegen 1 auf Stapel 0 und 1 auf Stapel 1: aux0 oben 2 ist spielbar
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'aux', i: 0, to: 1 }).ok, true);
  assert.deepEqual(p.aux[0], [5]);
  assert.equal(g.build[1].length, 2);
});

test('Fertiger Stapel (12) wird entfernt, gemischt und unter den Kartenstock gelegt', () => {
  const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const { g, p } = setup([12, 3, 3, 3, 3], { build: [seq] });
  const before = g.draw.slice();
  const total = P.totalCards(g);
  const r = P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }, seedRng(3));
  assert.equal(r.ok, true);
  assert.equal(r.completed, true);
  assert.deepEqual(g.build[0], []);
  assert.equal(g.draw.length, before.length + 12);
  assert.deepEqual(g.draw.slice(12), before, 'alter Kartenstock bleibt oben');
  assert.deepEqual([...g.draw.slice(0, 12)].sort((a, b) => a - b), [...seq, 12]);
  assert.equal(P.totalCards(g), total);
  assert.notDeepEqual(g.draw.slice(0, 12), [...seq, 12], 'gemischt');
  assert.equal(g.last.removed, true);
  // Joker im fertigen Stapel kommt als Joker zurück
  const { g: g2 } = setup([12, 3, 3, 3, 3], { build: [[1, 2, 0, 4, 5, 6, 7, 8, 9, 10, 11]] });
  P.play(g2, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }, seedRng(1));
  assert.equal(g2.draw.slice(0, 12).filter((c) => c === 0).length, 1);
  // Joker kann einen Stapel bei 11 vollenden
  const { g: g3 } = setup([0, 3, 3, 3, 3], { build: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]] });
  const r3 = P.play(g3, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }, seedRng(1));
  assert.equal(r3.value, 12);
  assert.equal(r3.completed, true);
});

test('Ziehen bis 5 zu Beginn des Zugs, 5 neue nach leerer Hand, Zug endet nur durch Abwerfen', () => {
  const g = P.createGame(players(2), {}, seedRng(11));
  const p0 = g.players[0], p1 = g.players[1];
  assert.equal(p0.hand.length, 5);
  assert.equal(p1.hand.length, 0);
  // Nur Abwerfen beendet den Zug
  p0.hand = [1, 2, 3, 4, 6];
  g.build = [[], [], [], []];
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }).ok, true);
  assert.equal(g.active, 0, 'Zug geht weiter');
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }).ok, true);
  assert.equal(g.active, 0);
  assert.equal(g.played, 2);
  // Hand [3,4,6]: 3 und 4 legen, dann nur noch die 6
  P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 });
  P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 });
  assert.deepEqual(p0.hand, [6]);
  assert.equal(g.active, 0);
  const drawBefore = g.draw.length;
  // Abwerfen: letzte Handkarte
  const r = P.discard(g, 'p0', { i: 0, to: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(p0.aux[2], [6]);
  assert.equal(g.active, 1);
  assert.equal(p1.hand.length, 5, 'nächste Person zieht auf 5');
  assert.equal(g.draw.length, drawBefore - 5);
  assert.equal(p0.hand.length, 0);
  assert.equal(g.played, 0);
  // Person 0 zieht erst im nächsten Zug auf 5
  P.discard(g, 'p1', { i: 0, to: 0 });
  assert.equal(g.active, 0);
  assert.equal(p0.hand.length, 5);
  assert.equal(p1.hand.length, 4);
});

test('Leere Hand durch Legen: sofort 5 neue Karten, Zug geht weiter', () => {
  const { g, p } = setup([1, 1, 1, 1, 1], { build: [[], [], [], []] });
  // vier Stapel mit 1 beginnen ist möglich, fünfte 1 kann nicht (alle belegt, brauchen 2)
  for (let k = 0; k < 4; k++) assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: k }).ok, true);
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }).ok, false);
  p.hand = [2];
  const drawN = g.draw.length;
  const r = P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.refilled, 5);
  assert.equal(p.hand.length, 5);
  assert.equal(g.draw.length, drawN - 5);
  assert.equal(g.active, 0, 'Zug endet nicht');
  assert.equal(g.last.refill, true);
});

test('Weniger ziehen, wenn der Kartenstock zu klein ist; ohne Karten endet der Zug von selbst', () => {
  const { g, p } = setup([1], { build: [[], [], [], []] });
  g.draw = [4, 5];
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 }).refilled, 2);
  assert.equal(p.hand.length, 2);
  g.draw = [];
  p.hand = [2];
  g.players[1].aux[0] = [9];
  g.players[1].hand = [4];
  const r = P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 0 });
  assert.equal(r.auto, true);
  assert.equal(g.active, 1);
});

test('Spielende: letzte Karte des Spielerstapels beendet sofort, Gewinner steht fest', () => {
  const { g, p } = setup([5, 5, 5, 5, 5], { pile: [1], build: [[], [], [], []] });
  const r = P.play(g, 'p0', { t: 'play', from: 'pile', to: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.won, true);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.equal(p.pile.length, 0);
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 1 }).ok, false);
  assert.equal(P.discard(g, 'p0', { i: 0, to: 0 }).ok, false);
  assert.equal(P.ranking(g)[0].name, 'P0');
  assert.equal(g.gain, 0, 'ohne Punkte keine Punktwertung');
});

test('Ende mit Joker als letzte Karte des Spielerstapels', () => {
  const { g } = setup([5, 5, 5, 5, 5], { pile: [0] });
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'pile', to: 3 }).won, true);
});

test('Nur wer dran ist darf etwas tun', () => {
  const g = P.createGame(players(3), {}, seedRng(2));
  assert.equal(P.play(g, 'p1', { t: 'play', from: 'hand', i: 0, to: 0 }).ok, false);
  assert.equal(P.discard(g, 'p2', { i: 0, to: 0 }).ok, false);
  assert.equal(P.handle(g, 'fremd', { t: 'discard', i: 0, to: 0 }).ok, false);
  assert.equal(P.handle(g, 'p0', { t: 'next' }).ok, false);
});

test('Ungültige Nachrichten ändern nie den Zustand', () => {
  const g = P.createGame(players(2), { points: true }, seedRng(21));
  g.players[0].hand = [1, 3, 5, 0, 12];
  const before = snap(g);
  const bad = [
    null, undefined, 5, 'x', [], {}, { t: 'foo' }, { t: 'play' }, { t: 'discard' },
    { t: 'play', from: 'hand', i: 0, to: 4 }, { t: 'play', from: 'hand', i: 0, to: -1 }, { t: 'play', from: 'hand', i: 0, to: 1.5 },
    { t: 'play', from: 'hand', i: 0, to: '0' }, { t: 'play', from: 'hand', i: 9, to: 0 }, { t: 'play', from: 'hand', i: -1, to: 0 },
    { t: 'play', from: 'hand', i: '0', to: 0 }, { t: 'play', from: 'hand', i: 1, to: 0 }, { t: 'play', from: 'hand', i: 4, to: 0 },
    { t: 'play', from: 'pile', to: 0 }, { t: 'play', from: 'aux', i: 0, to: 0 }, { t: 'play', from: 'aux', i: 7, to: 0 },
    { t: 'play', from: 'stock', to: 0 }, { t: 'play', from: 'hand', i: null, to: 0 }, { t: 'play', from: 'hand', i: NaN, to: 0 },
    { t: 'play', from: '__proto__', i: 0, to: 0 },
    { t: 'discard', i: 5, to: 0 }, { t: 'discard', i: 0, to: 4 }, { t: 'discard', i: -1, to: 0 }, { t: 'discard', i: 0, to: 'a' },
    { t: 'discard', i: 0.5, to: 0 }, { t: 'discard', i: 0 }, { t: 'next' },
  ];
  for (const m of bad) {
    for (const who of ['p0', 'p1', 'nobody', undefined, null]) {
      const r = P.handle(g, who, m);
      assert.equal(r.ok, false, JSON.stringify(m) + ' von ' + who);
      assert.equal(typeof r.error, 'string');
      assert.equal(snap(g), before, 'Zustand verändert bei ' + JSON.stringify(m));
    }
  }
  assert.equal(P.handle(null, 'p0', { t: 'next' }).ok, false);
});

test('Serie mit Punkten: 25 + 5 je Restkarte der anderen, bis 500', () => {
  const g = P.createGame(players(3), { points: true }, seedRng(4));
  g.players[0].pile = [1];
  g.players[1].pile = new Array(10).fill(3);
  g.players[2].pile = new Array(4).fill(2);
  g.players[0].hand = [4, 4, 4, 4, 4];
  const r = P.play(g, 'p0', { t: 'play', from: 'pile', to: 0 });
  assert.equal(r.won, true);
  assert.equal(g.gain, 25 + 5 * 14);
  assert.equal(g.players[0].score, 95);
  assert.equal(g.mode, 'roundover');
  assert.equal(g.winner, null);
  assert.equal(g.roundWinner, 0);
  // Weiterspielen nur über 'next'
  assert.equal(P.play(g, 'p0', { t: 'play', from: 'hand', i: 0, to: 1 }).ok, false);
  assert.equal(P.handle(g, 'fremd', { t: 'next' }).ok, false);
  assert.equal(P.handle(g, 'p1', { t: 'next' }, seedRng(7)).ok, true);
  assert.equal(g.mode, 'play');
  assert.equal(g.round, 2);
  assert.equal(g.active, 1, 'Anfänger wechselt');
  assert.equal(g.players[0].score, 95, 'Punkte bleiben');
  g.players.forEach((p) => assert.equal(p.pile.length, 30));
  assert.equal(P.totalCards(g), 162);
  assert.equal(g.build.every((b) => b.length === 0), true);
  assert.equal(P.handle(g, 'p1', { t: 'next' }).ok, false, 'nur einmal');
});

test('Serie endet bei 500; höchste Punktzahl gewinnt', () => {
  const g = P.createGame(players(2), { points: true }, seedRng(6));
  g.players[0].score = 480;
  g.players[1].score = 490;
  g.players[0].pile = [1];
  g.players[1].pile = new Array(3).fill(3);
  P.play(g, 'p0', { t: 'play', from: 'pile', to: 0 });
  assert.equal(g.players[0].score, 480 + 25 + 15);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  const rk = P.ranking(g);
  assert.equal(rk[0].name, 'P0');
  assert.equal(rk[0].place, 1);
  assert.equal(rk[1].place, 2);
  // Rundensieger hat 500 nicht, aber ein anderer schon: höchste Punktzahl siegt
  const h = P.createGame(players(2), { points: true }, seedRng(8));
  h.players[1].score = 510;
  h.players[0].pile = [1];
  h.players[1].pile = [3, 3];
  P.play(h, 'p0', { t: 'play', from: 'pile', to: 0 });
  assert.equal(h.mode, 'over');
  assert.equal(h.winner, 1);
});

test('Patt: ohne Karten zum Ziehen gewinnt, wer weniger im Spielerstapel hat', () => {
  const g = P.createGame(players(2), {}, seedRng(30));
  g.draw = [];
  g.players[0].hand = [7];
  g.players[1].hand = [];
  g.players[0].pile = new Array(5).fill(9);
  g.players[1].pile = new Array(3).fill(9);
  assert.equal(P.discard(g, 'p0', { i: 0, to: 0 }).ok, true);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 1);
});

test('Optionen: pile (Lernrunde) begrenzt die Stapelgröße, falsche Werte werden ignoriert', () => {
  assert.equal(P.createGame(players(2), { pile: 8 }, seedRng(1)).players[0].pile.length, 8);
  assert.equal(P.createGame(players(2), { pile: 999 }, seedRng(1)).players[0].pile.length, 30);
  assert.equal(P.createGame(players(2), { pile: 'x' }, seedRng(1)).players[0].pile.length, 30);
  assert.equal(P.createGame(players(2), null, seedRng(1)).players[0].pile.length, 30);
  assert.equal(P.createGame(players(5), {}, seedRng(1)).players[0].pile.length, 20);
});

// ---------- Zufallspartien ----------
function randomPlayer(g, rng) {
  const pi = g.active;
  const plays = P.legalPlays(g, pi);
  if (plays.length && rng() < 0.6) {
    const m = plays[Math.floor(rng() * plays.length)];
    return { t: 'play', from: m.from, i: m.i, to: m.to };
  }
  const p = g.players[pi];
  return { t: 'discard', i: Math.floor(rng() * p.hand.length), to: Math.floor(rng() * 4) };
}

function playRandom(n, seed, points) {
  const rng = seedRng(seed);
  const g = P.createGame(players(n), { points }, rng);
  let steps = 0, rounds = 0;
  while (g.mode !== 'over' && steps < 60000) {
    steps++;
    if (g.mode === 'roundover') { rounds++; assert.equal(P.handle(g, 'p0', { t: 'next' }, rng).ok, true); continue; }
    const p = P.activePlayer(g);
    assert.ok(p.hand.length > 0, 'wer dran ist, hat Handkarten');
    assert.ok(p.hand.length <= 5);
    const m = randomPlayer(g, rng);
    const r = P.handle(g, p.id, m, rng);
    assert.equal(r.ok, true, JSON.stringify(m) + ' ' + r.error);
    if (steps % 25 === 0) {
      assert.equal(P.totalCards(g), 162, 'Karten gehen nie verloren');
      for (const b of g.build) assert.ok(b.length < 12);
    }
  }
  assert.equal(g.mode, 'over', `Partie (${n} Personen, Seed ${seed}) endet`);
  assert.equal(P.totalCards(g), 162);
  assert.ok(g.winner !== null);
  JSON.parse(JSON.stringify(g));
  return { g, steps, rounds };
}

test('Zufallspartien mit 2-6 Personen enden immer (eine Runde)', () => {
  let total = 0;
  for (let n = 2; n <= 6; n++) for (let s = 1; s <= 70; s++) { playRandom(n, n * 1000 + s, false); total++; }
  assert.equal(total, 350);
});

test('Zufallsserien bis 500 enden immer', () => {
  for (let n = 2; n <= 4; n++) for (let s = 1; s <= 8; s++) {
    const { g } = playRandom(n, 50000 + n * 100 + s, true);
    assert.ok(Math.max(...g.players.map((p) => p.score)) >= 500);
    assert.equal(g.players[g.winner].score, Math.max(...g.players.map((p) => p.score)));
  }
});

test('Aufbaustapel-Werte bleiben stimmig: Kartenzahl = Wert, Karten passen der Reihe nach', () => {
  const rng = seedRng(77);
  const g = P.createGame(players(3), {}, rng);
  let steps = 0;
  while (g.mode === 'play' && steps++ < 2000) {
    for (const b of g.build) {
      b.forEach((c, k) => assert.ok(c === 0 || c === k + 1, 'Karte an Position ' + (k + 1)));
    }
    P.handle(g, P.activePlayer(g).id, randomPlayer(g, rng), rng);
  }
});
