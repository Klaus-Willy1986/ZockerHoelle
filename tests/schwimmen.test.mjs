import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schwimmen/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const C = (s, r) => ({ s, r }); // s: 0 Kreuz 1 Pik 2 Herz 3 Karo, r: 0=7 1=8 2=9 3=10 4=B 5=D 6=K 7=A
const key = (c) => c.s * 8 + c.r;
const snap = (g) => JSON.stringify(g);

// Zustand mit festen Karten bauen
function setup({ n = 3, hands, table, opts = {}, seed = 1, active = 0 } = {}) {
  const g = M.createGame(players(n), opts, seeded(seed));
  const used = new Set();
  const give = (list) => list.map((c) => { used.add(key(c)); return { ...c }; });
  if (hands) hands.forEach((h, i) => { g.players[i].hand = give(h); });
  if (table) g.table = give(table);
  // Stapel = Rest
  const all = M.fullDeck().filter((c) => !g.players.some((p) => p.hand.some((x) => key(x) === key(c))) && !g.table.some((x) => key(x) === key(c)));
  g.deck = all;
  g.active = active;
  return g;
}
const total = (g) => g.deck.length + g.table.length + g.players.reduce((s, p) => s + p.hand.length, 0);
const multiset = (g) => [...g.deck, ...g.table, ...g.players.flatMap((p) => p.hand)].map(key).sort((a, b) => a - b).join(',');
const FULL = M.fullDeck().map(key).sort((a, b) => a - b).join(',');

test('Handwert-Tabelle: Farbsummen, 30,5, 31, Gleichstände', () => {
  const rows = [
    [[C(2, 7), C(2, 3), C(0, 0)], 21], // Herz Ass + Herz 10 + Kreuz 7
    [[C(0, 0), C(1, 1), C(2, 2)], 9], // drei Farben: höchste Einzelkarte
    [[C(0, 7), C(1, 7), C(2, 7)], 30.5], // drei Asse
    [[C(0, 0), C(1, 0), C(2, 0)], 30.5], // drei Siebener
    [[C(0, 5), C(1, 5), C(3, 5)], 30.5], // drei Damen
    [[C(2, 7), C(2, 3), C(2, 6)], 31], // Ass + 10 + König
    [[C(3, 7), C(3, 4), C(3, 5)], 31], // Ass + Bube + Dame
    [[C(1, 3), C(1, 4), C(1, 6)], 30], // 10 + Bube + König
    [[C(1, 0), C(1, 1), C(1, 2)], 24], // 7 + 8 + 9
    [[C(1, 7), C(1, 3), C(0, 7)], 21], // Pik Ass + Pik 10
    [[C(0, 7), C(1, 7), C(2, 0)], 11], // zwei Asse verschiedener Farben + 7
    [[C(0, 3), C(1, 4), C(2, 5)], 10], // lauter 10er-Karten, alle verschiedene Farben
    [[C(0, 7), C(0, 0), C(0, 1)], 26],
    [[C(2, 6), C(2, 5), C(3, 7)], 20],
    [[C(3, 2), C(3, 1), C(1, 7)], 17],
  ];
  for (const [h, v] of rows) assert.equal(M.handValue(h), v, JSON.stringify(h));
  assert.equal(M.handValue([]), 0);
  assert.equal(M.handValue(null), 0);
  assert.equal(M.fmtVal(30.5), '30,5');
  assert.equal(M.fmtVal(31), '31');
  // Kartenwerte
  assert.deepEqual(M.RANKS.map((r) => r.value), [7, 8, 9, 10, 10, 10, 10, 11]);
});

test('Handwert: 30,5 schlägt 30, 31 schlägt 30,5; Wert ist nie größer als 31', () => {
  const rng = seeded(7);
  for (let i = 0; i < 3000; i++) {
    const d = M.fullDeck().sort(() => rng() - 0.5);
    const v = M.handValue(d.slice(0, 3));
    assert.ok(v <= 31 && v >= 7);
  }
  assert.ok(M.handValue([C(0, 7), C(1, 7), C(2, 7)]) > M.handValue([C(1, 3), C(1, 4), C(1, 6)]));
  assert.ok(M.handValue([C(2, 7), C(2, 3), C(2, 6)]) > M.handValue([C(0, 7), C(1, 7), C(2, 7)]));
});

test('Blatt: 32 Karten, 3 pro Person, 3 auf dem Tisch, alle verschieden', () => {
  for (let n = 2; n <= 6; n++) {
    const g = M.createGame(players(n), {}, seeded(n));
    assert.equal(total(g), 32, 'n=' + n);
    for (const p of g.players) { assert.equal(p.hand.length, 3); assert.equal(p.lives, 3); assert.equal(p.out, false); }
    assert.equal(g.table.length, 3);
    assert.equal(g.deck.length, 32 - 3 * n - 3);
    assert.equal(multiset(g), FULL);
    assert.equal(g.active, 0);
    assert.equal(g.phase, 'play');
    assert.equal(g.round, 1);
    assert.equal(g.knocker, null);
  }
});

test('createGame: ungültige Spielerzahl wirft, Optionen werden normalisiert, hostId', () => {
  assert.throws(() => M.createGame(players(1)));
  assert.throws(() => M.createGame(players(7)));
  assert.throws(() => M.createGame('x'));
  const g = M.createGame(players(2), { show: 1, foo: 3 }, seeded(2), 'p1');
  assert.deepEqual(g.opts, { show: true });
  assert.equal(g.hostId, 'p1');
  assert.equal(M.createGame(players(2), undefined, seeded(2)).hostId, 'p0');
  assert.deepEqual(M.createGame(players(2), null, seeded(2)).opts, { show: false });
});

test('Zustand ist reines JSON und deterministisch', () => {
  const g = M.createGame(players(4), { show: true }, seeded(3));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.equal(snap(M.createGame(players(3), {}, seeded(9))), snap(M.createGame(players(3), {}, seeded(9))));
});

test('Tausch einer Karte: Hand und Tisch wechseln, Zug geht weiter', () => {
  const g = setup({ hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(1, 4), C(2, 5)], [C(3, 0), C(3, 1), C(0, 2)]], table: [C(3, 7), C(2, 7), C(1, 7)] });
  const r = M.handle(g, 'p0', { t: 'swap1', hand: 1, table: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(g.players[0].hand, [C(0, 0), C(1, 7), C(2, 2)]);
  assert.deepEqual(g.table, [C(3, 7), C(2, 7), C(1, 1)]);
  assert.equal(g.active, 1);
  assert.equal(g.moves, 1);
  assert.equal(g.passes, 0);
  assert.equal(g.swapped.p0, true);
  assert.equal(total(g), 32);
});

test('Tausch aller drei Karten', () => {
  const g = setup({ hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(1, 4), C(2, 5)]], n: 2, table: [C(3, 7), C(2, 7), C(1, 7)] });
  assert.equal(M.handle(g, 'p0', { t: 'swap3' }).ok, true);
  assert.deepEqual(g.players[0].hand, [C(3, 7), C(2, 7), C(1, 7)]);
  assert.deepEqual(g.table, [C(0, 0), C(1, 1), C(2, 2)]);
  assert.equal(g.active, 1);
  assert.equal(total(g), 32);
  assert.equal(multiset(g), FULL);
});

test('Schieben: reihum alle geschoben -> drei neue Tischkarten, Kartenbilanz bleibt 32', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(1, 4), C(2, 5)], [C(3, 0), C(3, 1), C(0, 2)]], table: [C(3, 7), C(2, 7), C(1, 7)] });
  const old = g.table.map(key);
  const deckBefore = g.deck.length;
  assert.equal(M.handle(g, 'p0', { t: 'pass' }).ok, true);
  assert.equal(M.handle(g, 'p1', { t: 'pass' }).ok, true);
  assert.deepEqual(g.table.map(key), old, 'noch nicht ersetzt');
  assert.equal(g.passes, 2);
  assert.equal(M.handle(g, 'p2', { t: 'pass' }).ok, true);
  assert.notDeepEqual(g.table.map(key), old);
  assert.equal(g.table.length, 3);
  assert.equal(g.passes, 0);
  assert.equal(g.deck.length, deckBefore);
  assert.equal(multiset(g), FULL);
  assert.equal(g.active, 0);
});

test('Schieben: ein Tausch dazwischen setzt den Schiebe-Zähler zurück', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(1, 4), C(2, 5)], [C(3, 0), C(3, 1), C(0, 2)]], table: [C(3, 7), C(2, 7), C(1, 7)] });
  const old = g.table.map(key);
  M.handle(g, 'p0', { t: 'pass' });
  M.handle(g, 'p1', { t: 'swap1', hand: 0, table: 0 });
  assert.equal(g.passes, 0);
  M.handle(g, 'p2', { t: 'pass' });
  M.handle(g, 'p0', { t: 'pass' });
  M.handle(g, 'p1', { t: 'pass' });
  assert.equal(g.passes, 3 - 3, 'jetzt ersetzt');
  assert.notDeepEqual(g.table.map(key).sort(), old.sort());
});

test('Klopfen-Ablauf: jede andere Person hat genau einen Zug, dann Aufdecken; kein zweites Klopfen', () => {
  const g = setup({ n: 3, hands: [[C(2, 7), C(2, 3), C(0, 0)], [C(0, 3), C(1, 4), C(2, 5)], [C(3, 0), C(3, 1), C(0, 2)]], table: [C(3, 7), C(1, 7), C(1, 0)] });
  assert.equal(M.handle(g, 'p0', { t: 'knock' }).ok, true);
  assert.equal(g.knocker, 'p0');
  assert.equal(g.left, 2);
  assert.equal(g.active, 1);
  assert.equal(g.phase, 'play');
  assert.equal(M.handle(g, 'p1', { t: 'knock' }).ok, false, 'zweites Klopfen');
  assert.equal(g.active, 1);
  assert.equal(M.handle(g, 'p1', { t: 'pass' }).ok, true);
  assert.equal(g.phase, 'play');
  assert.equal(g.active, 2);
  assert.equal(M.handle(g, 'p2', { t: 'swap1', hand: 2, table: 2 }).ok, true);
  assert.equal(g.phase, 'over', 'nach dem letzten Zug wird aufgedeckt');
  assert.equal(g.result.kind, 'show');
  // P0: 21, P1: 10, P2: nach Tausch ♦7 ♦8 ♠7 -> Karo 15
  assert.equal(g.result.values.p0, 21);
  assert.deepEqual(g.result.low, ['p1']);
  assert.equal(g.players[1].lives, 2);
  assert.equal(g.players[0].lives, 3);
  assert.equal(g.players[2].lives, 3);
});

test('Klopfen: wer geklopft hat und niedrigsten Wert hat, verliert 2 Leben', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(0, 4), C(2, 5)], [C(3, 3), C(3, 1), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 0)] });
  M.handle(g, 'p0', { t: 'knock' });
  M.handle(g, 'p1', { t: 'pass' });
  M.handle(g, 'p2', { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result.low, ['p0']);
  assert.equal(g.players[0].lives, 1);
  assert.equal(g.players[1].lives, 3);
  assert.deepEqual(g.result.loss, { p0: 2 });
});

test('Klopfen und geteilter niedrigster Wert: Klopfer verliert 2, der andere Gleiche 1', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 3)], [C(0, 3), C(3, 4), C(1, 0)], [C(3, 3), C(3, 7), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  // P0: 10, P1: 10, P2: 21
  M.handle(g, 'p0', { t: 'knock' });
  M.handle(g, 'p1', { t: 'pass' });
  M.handle(g, 'p2', { t: 'pass' });
  assert.deepEqual(g.result.low.sort(), ['p0', 'p1']);
  assert.equal(g.players[0].lives, 1);
  assert.equal(g.players[1].lives, 2);
  assert.equal(g.players[2].lives, 3);
});

test('Aufdecken ohne Klopfer-Verlust: Gleichstand beim Niedrigsten, alle Gleichen verlieren 1 Leben', () => {
  const g = setup({ n: 3, hands: [[C(0, 3), C(1, 1), C(2, 3)], [C(0, 4), C(3, 4), C(1, 0)], [C(3, 3), C(3, 7), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  // P0 10, P1 10, P2 21; P2 klopft nicht, P1 klopft -> P1 2 Leben, P0 1
  M.handle(g, 'p0', { t: 'pass' });
  M.handle(g, 'p1', { t: 'knock' });
  M.handle(g, 'p2', { t: 'pass' });
  M.handle(g, 'p0', { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].lives, 2);
  assert.equal(g.players[1].lives, 1);
  assert.equal(g.players[2].lives, 3);
  // Gleichstand ohne dass ein Gleicher geklopft hat
  const h = setup({ n: 3, hands: [[C(0, 3), C(1, 1), C(2, 3)], [C(0, 4), C(3, 4), C(1, 0)], [C(3, 3), C(3, 7), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  M.handle(h, 'p0', { t: 'pass' }); M.handle(h, 'p1', { t: 'pass' });
  M.handle(h, 'p2', { t: 'knock' });
  M.handle(h, 'p0', { t: 'pass' }); M.handle(h, 'p1', { t: 'pass' });
  assert.equal(h.phase, 'over');
  assert.equal(h.players[0].lives, 2);
  assert.equal(h.players[1].lives, 2);
  assert.equal(h.players[2].lives, 3);
});

test('31 durch Tausch beendet die Runde sofort: alle anderen verlieren je 1 Leben (auch der Klopfer)', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(2, 7), C(2, 3), C(1, 0)], [C(3, 3), C(3, 1), C(0, 2)]], table: [C(1, 7), C(2, 6), C(1, 5)] });
  M.handle(g, 'p0', { t: 'knock' });
  const r = M.handle(g, 'p1', { t: 'swap1', hand: 2, table: 1 }); // Herz Ass, 10, König = 31
  assert.equal(r.ok, true);
  assert.equal(r.thirtyOne, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.kind, '31');
  assert.equal(g.result.caller, 'p1');
  assert.equal(g.players[0].lives, 2, 'Klopfer verliert nur 1');
  assert.equal(g.players[1].lives, 3);
  assert.equal(g.players[2].lives, 2);
  assert.equal(g.result.final, false);
});

test('31 ansagen (call31): nur mit 31, jederzeit auch außerhalb des eigenen Zugs; sonst freundlicher Fehler', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(2, 7), C(2, 3), C(2, 6)], [C(3, 3), C(3, 1), C(0, 2)]], table: [C(1, 7), C(3, 6), C(1, 5)] });
  const before = snap(g);
  const bad = M.handle(g, 'p0', { t: 'call31' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /noch keine 31/);
  assert.equal(snap(g), before);
  const ok = M.handle(g, 'p1', { t: 'call31' }); // nicht am Zug, hat aber 31
  assert.equal(ok.ok, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.caller, 'p1');
  assert.deepEqual(g.result.loss, { p0: 1, p2: 1 });
  assert.equal(g.players[0].lives, 2);
  assert.equal(g.players[1].lives, 3);
});

test('Zwei Personen mit 31: wer ansagt gewinnt, die andere verliert 1 Leben', () => {
  const g = setup({ n: 2, hands: [[C(2, 7), C(2, 3), C(2, 6)], [C(1, 7), C(1, 3), C(1, 6)]], table: [C(0, 0), C(0, 1), C(0, 2)] });
  M.handle(g, 'p1', { t: 'call31' });
  assert.equal(g.players[0].lives, 2);
  assert.equal(g.players[1].lives, 3);
});

test('Ungültige Nachrichten, falsche Person, falsche Phase ändern nichts', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(1, 4), C(2, 5)], [C(3, 0), C(3, 1), C(0, 2)]], table: [C(3, 7), C(2, 7), C(1, 7)] });
  const s0 = snap(g);
  const bad = [
    [null, 'p0'], [undefined, 'p0'], ['x', 'p0'], [{}, 'p0'], [{ t: 5 }, 'p0'], [{ t: 'swap1' }, 'p0'],
    [{ t: 'swap1', hand: 3, table: 0 }, 'p0'], [{ t: 'swap1', hand: -1, table: 0 }, 'p0'], [{ t: 'swap1', hand: 0, table: 3 }, 'p0'],
    [{ t: 'swap1', hand: 0.5, table: 0 }, 'p0'], [{ t: 'swap1', hand: '0', table: 0 }, 'p0'], [{ t: 'swap1', hand: null, table: 1 }, 'p0'],
    [{ t: 'pass' }, 'p1'], [{ t: 'swap3' }, 'p2'], [{ t: 'knock' }, 'p1'], [{ t: 'swap1', hand: 0, table: 0 }, 'p1'],
    [{ t: 'pass' }, 'fremd'], [{ t: 'call31' }, 'fremd'], [{ t: 'next' }, 'p0'], [{ t: 'next' }, 'p1'], [{ t: 'zaubern' }, 'p0'], [{ t: 'draw' }, 'p0'],
  ];
  for (const [m, pid] of bad) {
    const r = M.handle(g, pid, m);
    assert.equal(r.ok, false, JSON.stringify(m) + ' ' + pid);
    assert.equal(snap(g), s0, 'Zustand verändert bei ' + JSON.stringify(m));
  }
  assert.equal(M.handle(null, 'p0', { t: 'pass' }).ok, false);
  assert.equal(M.handle({ game: 'xx' }, 'p0', { t: 'pass' }).ok, false);
  // nach Rundenende: Spielzüge abgelehnt
  M.handle(g, 'p0', { t: 'knock' }); M.handle(g, 'p1', { t: 'pass' }); M.handle(g, 'p2', { t: 'pass' });
  assert.equal(g.phase, 'over');
  const s1 = snap(g);
  for (const m of [{ t: 'pass' }, { t: 'knock' }, { t: 'swap3' }, { t: 'swap1', hand: 0, table: 0 }, { t: 'call31' }]) {
    for (const pid of ['p0', 'p1', 'p2']) assert.equal(M.handle(g, pid, m).ok, false);
  }
  assert.equal(snap(g), s1);
  assert.equal(M.handle(g, 'p1', { t: 'next' }).ok, false, 'nur Gastgeber');
  assert.equal(snap(g), s1);
});

test('Nächste Runde: nur Gastgeber, nur nach Rundenende, Leben bleiben, Startperson rotiert, 32 Karten', () => {
  const g = M.createGame(players(3), {}, seeded(4), 'p0');
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false, 'Runde läuft noch');
  M.handle(g, 'p0', { t: 'knock' }); M.handle(g, 'p1', { t: 'pass' }); M.handle(g, 'p2', { t: 'pass' });
  assert.equal(g.phase, 'over');
  const lives = g.players.map((p) => p.lives);
  assert.equal(M.handle(g, 'p0', { t: 'next' }, seeded(5)).ok, true);
  assert.equal(g.round, 2);
  assert.equal(g.phase, 'play');
  assert.equal(g.active, 1);
  assert.deepEqual(g.players.map((p) => p.lives), lives);
  assert.equal(multiset(g), FULL);
  assert.equal(g.knocker, null);
  assert.deepEqual(g.swapped, {});
  assert.equal(g.result, null);
});

test('Leben, Schwimmen und Ausscheiden', () => {
  const g = setup({ n: 3, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(0, 3), C(0, 4), C(2, 5)], [C(3, 3), C(3, 7), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  g.players[0].lives = 1;
  M.handle(g, 'p0', { t: 'pass' }); M.handle(g, 'p1', { t: 'pass' }); M.handle(g, 'p2', { t: 'knock' }); M.handle(g, 'p0', { t: 'pass' }); M.handle(g, 'p1', { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].lives, 0, 'schwimmt');
  assert.equal(M.isSwimming(g.players[0]), true);
  assert.equal(g.players[0].out, false);
  assert.deepEqual(g.result.swimming, ['p0']);
  assert.equal(g.result.final, false);
  // nächste Runde, wieder verlieren -> ausgeschieden
  M.handle(g, g.hostId, { t: 'next' }, seeded(8));
  g.players[0].hand = [C(0, 0), C(1, 1), C(2, 2)];
  g.players[1].hand = [C(0, 3), C(0, 4), C(0, 5)];
  g.players[2].hand = [C(3, 3), C(3, 7), C(3, 2)];
  g.table = [C(1, 7), C(2, 7), C(1, 5)];
  g.deck = M.fullDeck().filter((c) => ![...g.players.flatMap((p) => p.hand), ...g.table].some((x) => key(x) === key(c)));
  g.active = 0;
  M.handle(g, 'p0', { t: 'knock' }); M.handle(g, 'p1', { t: 'pass' }); M.handle(g, 'p2', { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].out, true);
  assert.deepEqual(g.result.eliminated, ['p0']);
  assert.equal(g.result.final, false, 'zwei sind noch dabei');
  // Ausgeschiedene spielen nicht mehr: nächste Runde ohne p0
  M.handle(g, g.hostId, { t: 'next' }, seeded(9));
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.players[1].hand.length, 3);
  assert.notEqual(g.active, 0);
  assert.equal(multiset(g), FULL);
  assert.equal(g.deck.length, 32 - 6 - 3);
  assert.equal(M.handle(g, 'p0', { t: 'pass' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'call31' }).ok, false);
});

test('Klopfen kostet 2 Leben: aus 1 Leben wird 0 (schwimmen), nicht Ausscheiden', () => {
  const g = setup({ n: 2, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(3, 3), C(3, 7), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  g.players[0].lives = 1;
  M.handle(g, 'p0', { t: 'knock' }); M.handle(g, 'p1', { t: 'pass' });
  assert.equal(g.players[0].lives, 0);
  assert.equal(g.players[0].out, false);
});

test('Letzte verbliebene Person gewinnt: Spiel endet, nächste Runde nicht mehr möglich', () => {
  const g = setup({ n: 2, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(3, 3), C(3, 7), C(0, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  g.players[0].lives = 0;
  M.handle(g, 'p0', { t: 'pass' }); M.handle(g, 'p1', { t: 'knock' }); M.handle(g, 'p0', { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].out, true);
  assert.equal(g.result.final, true);
  assert.deepEqual(g.result.champions, ['p1']);
  assert.equal(g.result.draw, false);
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false);
  const rk = M.ranking(g);
  assert.equal(rk[0].id, 'p1');
  assert.equal(rk[0].winner, true);
  assert.equal(rk[1].out, true);
  assert.equal(rk[1].winner, false);
});

test('Alle würden gleichzeitig ausscheiden: Unentschieden, niemand scheidet aus', () => {
  const g = setup({ n: 2, hands: [[C(0, 0), C(1, 1), C(2, 2)], [C(1, 0), C(2, 1), C(3, 2)]], table: [C(1, 7), C(2, 7), C(1, 5)] });
  // beide 9 -> wait: P0 ♣7,♠8,♥9 = 9; P1 ♠7,♥8,♦9 = 9
  g.players[0].lives = 0; g.players[1].lives = 0;
  M.handle(g, 'p0', { t: 'pass' }); M.handle(g, 'p1', { t: 'knock' }); M.handle(g, 'p0', { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.equal(g.result.final, true);
  assert.equal(g.result.draw, true);
  assert.deepEqual(g.result.champions.sort(), ['p0', 'p1']);
  assert.deepEqual(g.result.eliminated, []);
  assert.equal(g.players.every((p) => !p.out), true);
});

test('Ranking: Lebende nach Leben, Ausgeschiedene danach (später ausgeschieden vorn), Plätze mit Gleichstand', () => {
  const g = M.createGame(players(4), {}, seeded(2));
  g.players[0].lives = 1; g.players[1].lives = 3; g.players[2].out = true; g.players[2].outRound = 4; g.players[2].lives = 0;
  g.players[3].out = true; g.players[3].outRound = 2; g.players[3].lives = 0;
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['p1', 'p0', 'p2', 'p3']);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4]);
  g.players[0].lives = 3;
  assert.deepEqual(M.ranking(g).map((x) => x.rank), [1, 1, 3, 4]);
});

test('Rundenende: Text, Werte und Verluste im Ergebnis; Hände bleiben für die Anzeige', () => {
  const g = setup({ n: 3, hands: [[C(2, 7), C(2, 3), C(0, 0)], [C(0, 3), C(1, 4), C(2, 5)], [C(3, 0), C(3, 1), C(0, 2)]], table: [C(1, 7), C(1, 1), C(1, 0)] });
  M.handle(g, 'p0', { t: 'knock' }); M.handle(g, 'p1', { t: 'pass' }); M.handle(g, 'p2', { t: 'pass' });
  const r = g.result;
  assert.deepEqual(r.values, { p0: 21, p1: 10, p2: 15 });
  assert.match(r.text, /P1 hat das niedrigste Blatt \(10\) und verliert ein Leben/);
  assert.equal(g.players.every((p) => p.hand.length === 3), true);
  assert.equal(r.knocker, 'p0');
  assert.deepEqual(r.eliminated, []);
});

test('Wer ausgeschieden ist, wird beim Zugwechsel übersprungen (5 Personen)', () => {
  const g = M.createGame(players(5), {}, seeded(12));
  g.players[1].out = true; g.players[3].out = true;
  // neu geben
  g.phase = 'over'; g.result = { final: false };
  M.handle(g, g.hostId, { t: 'next' }, seeded(3));
  const seq = [];
  for (let i = 0; i < 6; i++) { seq.push(g.active); M.handle(g, M.activePlayer(g).id, { t: 'pass' }); if (g.phase !== 'play') break; }
  for (const a of seq) assert.ok(a === 0 || a === 2 || a === 4);
  assert.equal(g.deck.length + g.table.length + g.players.reduce((s, p) => s + p.hand.length, 0), 32);
});

test('200+ Zufallspartien enden immer; Kartenbilanz stets 32; Zustand immer JSON-sicher', () => {
  let games = 0; let rounds = 0; let moves = 0;
  for (let seed = 1; seed <= 240; seed++) {
    const rng = seeded(seed);
    const n = 2 + (seed % 5);
    const g = M.createGame(players(n), {}, rng);
    let guard = 0;
    while (guard++ < 200000) {
      if (g.phase === 'over') {
        rounds++;
        assert.equal(g.deck.length + g.table.length + g.players.reduce((s, p) => s + p.hand.length, 0), 32);
        if (g.result.final) break;
        assert.equal(M.handle(g, g.hostId, { t: 'next' }, rng).ok, true);
        continue;
      }
      const p = M.activePlayer(g);
      assert.equal(p.out, false);
      const x = rng();
      let msg;
      if (x < 0.5) msg = { t: 'swap1', hand: Math.floor(rng() * 3), table: Math.floor(rng() * 3) };
      else if (x < 0.6) msg = { t: 'swap3' };
      else if (x < 0.85) msg = { t: 'pass' };
      else if (x < 0.93) msg = { t: 'knock' };
      else msg = { t: 'call31' };
      const r = M.handle(g, p.id, msg, rng);
      moves++;
      if (msg.t === 'swap1' || msg.t === 'swap3' || msg.t === 'pass') assert.equal(r.ok, true, JSON.stringify(msg));
      if (moves % 50 === 0) {
        assert.equal(total(g), 32);
        assert.equal(multiset(g), FULL);
        assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
      }
    }
    assert.equal(g.phase, 'over');
    assert.equal(g.result.final, true, 'Spiel ' + seed + ' endet');
    assert.ok(g.result.champions.length >= 1);
    for (const q of g.players) assert.ok(q.lives >= 0 && q.lives <= 3);
    games++;
  }
  console.log(`Zufallspartien: ${games}, Runden: ${rounds}, Züge: ${moves}`);
  assert.equal(games, 240);
});

test('Kartenbilanz: jede Karte genau einmal nach jedem Zug (alle 32 verschieden)', () => {
  const rng = seeded(77);
  const g = M.createGame(players(4), {}, rng);
  for (let i = 0; i < 400 && g.phase === 'play'; i++) {
    const p = M.activePlayer(g);
    const x = rng();
    const msg = x < 0.4 ? { t: 'swap1', hand: Math.floor(rng() * 3), table: Math.floor(rng() * 3) } : x < 0.5 ? { t: 'swap3' } : { t: 'pass' };
    M.handle(g, p.id, msg, rng);
    assert.equal(multiset(g), FULL);
  }
});

test('Sicherung: nach 300 Zügen ohne Entscheidung wird aufgedeckt', () => {
  const g = M.createGame(players(2), {}, seeded(5));
  let i = 0;
  while (g.phase === 'play' && i++ < 1000) M.handle(g, M.activePlayer(g).id, { t: 'pass' });
  assert.equal(g.phase, 'over');
  assert.ok(i <= 301);
  assert.equal(g.result.kind, 'show');
});
