import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../elf/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const C = (s, r) => ({ s, r });
const key = (c) => c.s * 22 + c.r;
const snap = (g) => JSON.stringify(g);
const onTable = (g) => g.rows.reduce((n, w) => n + (w ? w.hi - w.lo + 1 : 0), 0);
const total = (g) => g.players.reduce((n, p) => n + p.hand.length, 0) + onTable(g);

// Zustand mit festen Karten bauen (Hände frei wählbar, Reihen frei wählbar)
function setup({ n = 3, hands, rows, active = 0, opts = {}, seed = 1 } = {}) {
  const g = M.createGame(players(n), opts, seeded(seed));
  if (hands) hands.forEach((h, i) => { g.players[i].hand = h.map((c) => ({ ...c })); });
  if (rows) g.rows = rows.map((w) => (w ? { ...w } : null));
  g.active = active;
  g.moves = rows && rows.some(Boolean) ? 1 : 0;
  return g;
}

test('Blatt: 84 Karten, jede genau einmal, 4 Farben mit 1 bis 21', () => {
  const d = M.fullDeck();
  assert.equal(d.length, 84);
  assert.equal(new Set(d.map(key)).size, 84);
  assert.equal(M.TOTAL_CARDS, 84);
  assert.equal(M.SUITS.length, 4);
  assert.deepEqual(M.SUITS.map((s) => s.name), ['Rot', 'Blau', 'Gelb', 'Grün']);
  assert.deepEqual(M.SUITS.map((s) => s.sym), ['●', '■', '▲', '◆']);
});

test('Austeilen: alle 84 Karten reihum, Rest an die ersten Personen', () => {
  const want = { 2: [42, 42], 3: [28, 28, 28], 4: [21, 21, 21, 21], 5: [17, 17, 17, 17, 16], 6: [14, 14, 14, 14, 14, 14] };
  for (let n = 2; n <= 6; n++) {
    const g = M.createGame(players(n), {}, seeded(n));
    assert.deepEqual(g.players.map((p) => p.hand.length), want[n], 'n=' + n);
    const all = g.players.flatMap((p) => p.hand);
    assert.equal(all.length, 84);
    assert.equal(new Set(all.map(key)).size, 84);
    assert.equal(g.phase, 'play');
    assert.equal(g.round, 1);
    assert.deepEqual(g.rows, [null, null, null, null]);
    // Hand sortiert nach Farbe, dann Zahl
    for (const p of g.players) for (let i = 1; i < p.hand.length; i++) assert.ok(p.hand[i - 1].s < p.hand[i].s || (p.hand[i - 1].s === p.hand[i].s && p.hand[i - 1].r < p.hand[i].r));
  }
});

test('Start: die erste Person (in Reihenfolge) mit einer Elf beginnt und muss eine Elf legen', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const n = 2 + (seed % 5);
    const g = M.createGame(players(n), {}, seeded(seed));
    const first = g.players.findIndex((p) => p.hand.some((c) => c.r === 11));
    assert.equal(g.active, first);
    assert.equal(g.starter, first);
    const ap = M.activePlayer(g);
    const legal = M.legalCards(g, ap.id);
    assert.ok(legal.length >= 1);
    assert.ok(legal.every((c) => c.r === 11));
    assert.equal(legal.length, ap.hand.filter((c) => c.r === 11).length);
    // niemand vor der Startperson hat eine Elf
    for (let i = 0; i < first; i++) assert.ok(!g.players[i].hand.some((c) => c.r === 11));
    // Nicht-Elfen sind am Anfang nie spielbar
    assert.equal(M.handle(g, ap.id, { t: 'play', card: ap.hand.find((c) => c.r !== 11) }, seeded(1)).ok, false);
  }
});

test('createGame: ungültige Spielerzahl wirft, Optionen werden normalisiert, hostId', () => {
  assert.throws(() => M.createGame(players(1)));
  assert.throws(() => M.createGame(players(7)));
  assert.throws(() => M.createGame('x'));
  assert.deepEqual(M.createGame(players(2), {}, seeded(2)).opts, { hints: false, limit: 30 });
  assert.deepEqual(M.createGame(players(2), { hints: 1, foo: 3 }, seeded(2)).opts, { hints: true, limit: 30 });
  assert.equal(M.createGame(players(2), { short: true }, seeded(2)).opts.limit, 15);
  assert.equal(M.createGame(players(2), { limit: 15 }, seeded(2)).opts.limit, 15);
  assert.equal(M.createGame(players(2), { limit: 10 }, seeded(2)).opts.limit, 10);
  assert.equal(M.createGame(players(2), { limit: -4 }, seeded(2)).opts.limit, 30);
  assert.equal(M.createGame(players(2), { limit: 'x' }, seeded(2)).opts.limit, 30);
  assert.equal(M.createGame(players(2), null, seeded(2)).opts.limit, 30);
  assert.equal(M.createGame(players(2), {}, seeded(2), 'p1').hostId, 'p1');
  assert.equal(M.createGame(players(2), undefined, seeded(2)).hostId, 'p0');
});

test('Zustand ist reines JSON, deterministisch bei gleichem rng', () => {
  const g = M.createGame(players(4), { hints: true }, seeded(3));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.equal(snap(M.createGame(players(3), {}, seeded(9))), snap(M.createGame(players(3), {}, seeded(9))));
});

test('Legeregeln: Elf neuer Farbe oder Anschluss nach oben/unten', () => {
  const g = setup({ rows: [{ lo: 9, hi: 13 }, null, { lo: 11, hi: 11 }, null] });
  assert.equal(M.playable(g, C(0, 14)), true);
  assert.equal(M.playable(g, C(0, 8)), true);
  assert.equal(M.playable(g, C(0, 15)), false);
  assert.equal(M.playable(g, C(0, 7)), false);
  assert.equal(M.playable(g, C(0, 12)), false, 'liegt schon');
  assert.equal(M.playable(g, C(0, 11)), false, 'Elf der offenen Farbe');
  assert.equal(M.playable(g, C(1, 11)), true, 'Elf einer neuen Farbe');
  assert.equal(M.playable(g, C(1, 10)), false);
  assert.equal(M.playable(g, C(1, 12)), false);
  assert.equal(M.playable(g, C(1, 5)), false);
  assert.equal(M.playable(g, C(2, 12)), true);
  assert.equal(M.playable(g, C(2, 10)), true);
  assert.equal(M.playable(g, C(2, 13)), false);
  assert.equal(M.playable(g, C(3, 11)), true);
  // Unsinn
  for (const bad of [null, undefined, {}, { s: 4, r: 11 }, { s: -1, r: 11 }, { s: 0, r: 0 }, { s: 0, r: 22 }, { s: 0.5, r: 14 }, { s: 0, r: '14' }, 'x', 7]) {
    assert.equal(M.playable(g, bad), false);
  }
  assert.equal(M.playable(null, C(0, 11)), false);
});

test('Grenzen: nach oben nur bis 21, nach unten nur bis 1', () => {
  const g = setup({ rows: [{ lo: 15, hi: 21 }, { lo: 1, hi: 7 }, { lo: 1, hi: 21 }, null] });
  assert.equal(M.playable(g, C(0, 14)), true);
  assert.equal(M.playable(g, C(0, 22)), false);
  assert.equal(M.playable(g, C(1, 8)), true);
  assert.equal(M.playable(g, C(1, 0)), false);
  for (let r = 1; r <= 21; r++) assert.equal(M.playable(g, C(2, r)), false, 'volle Reihe ' + r);
  // letzte Lücke schließen
  const h = setup({ rows: [{ lo: 2, hi: 21 }, null, null, null], hands: [[C(0, 1), C(1, 5)], [C(2, 4)], [C(3, 3)]] });
  assert.deepEqual(M.legalCards(h, 'p0'), [C(0, 1)]);
});

test('Zug: Karte anlegen verschiebt die Reihe, nächste Person im Uhrzeigersinn', () => {
  const g = setup({ n: 3, rows: [{ lo: 11, hi: 11 }, null, null, null], active: 1, hands: [[C(0, 1)], [C(0, 12), C(0, 10), C(1, 11), C(2, 4)], [C(3, 3)]] });
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(0, 12) }).ok, true);
  assert.deepEqual(g.rows[0], { lo: 11, hi: 12 });
  assert.equal(g.active, 2);
  assert.equal(g.players[1].hand.length, 3);
  assert.deepEqual(g.last.card, C(0, 12));
  assert.equal(g.last.kind, 'play');
  g.active = 1;
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(0, 10) }).ok, true);
  assert.deepEqual(g.rows[0], { lo: 10, hi: 12 });
  g.active = 1;
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(1, 11) }).ok, true);
  assert.deepEqual(g.rows[1], { lo: 11, hi: 11 });
  assert.equal(g.active, 2);
  // Reihum: letzte Person -> erste
  g.active = 2;
  g.players[2].hand = [C(3, 11), C(3, 4)];
  assert.equal(M.handle(g, 'p2', { t: 'play', card: C(3, 11) }).ok, true);
  assert.equal(g.active, 0);
});

test('Erster Zug: nur Elfen, Zug einer Elf eröffnet die Reihe', () => {
  const g = M.createGame(players(3), {}, seeded(11));
  const ap = M.activePlayer(g);
  const el = ap.hand.find((c) => c.r === 11);
  assert.equal(M.handle(g, ap.id, { t: 'play', card: el }).ok, true);
  assert.deepEqual(g.rows[el.s], { lo: 11, hi: 11 });
  assert.equal(total(g), 84);
});

test('Passen: nur ohne legalen Zug, genau 1 Strafpunkt, kein Ziehen', () => {
  const g = setup({ n: 3, rows: [{ lo: 11, hi: 11 }, null, null, null], active: 1, hands: [[C(0, 1)], [C(0, 5), C(2, 7), C(3, 9)], [C(0, 12), C(0, 20)]] });
  const before = g.players[1].hand.length;
  assert.equal(M.handle(g, 'p1', { t: 'pass' }).ok, true);
  assert.equal(g.players[1].points, 1);
  assert.equal(g.players[1].hand.length, before);
  assert.equal(g.active, 2);
  assert.equal(g.last.kind, 'pass');
  assert.ok(/Strafpunkt/.test(g.recap[0]));
  // p2 kann spielen: Passen verboten, nichts ändert sich
  const s0 = snap(g);
  const r = M.handle(g, 'p2', { t: 'pass' });
  assert.equal(r.ok, false);
  assert.ok(r.error && r.error.length > 5);
  assert.equal(snap(g), s0);
  // Elf-Besitzer darf nicht passen
  const h = setup({ rows: [null, null, null, null], hands: [[C(0, 11), C(0, 3)], [C(1, 4)], [C(2, 4)]], active: 0 });
  assert.equal(M.handle(h, 'p0', { t: 'pass' }).ok, false);
});

test('Passen merkt öffentlich, welche Karten die Person nicht hatte', () => {
  const g = setup({ rows: [{ lo: 10, hi: 12 }, null, { lo: 11, hi: 11 }, null], active: 1, hands: [[C(0, 1)], [C(0, 5), C(2, 7)], [C(0, 20)]] });
  assert.equal(M.handle(g, 'p1', { t: 'pass' }).ok, true);
  const L = new Set(g.players[1].lacks);
  for (const c of [C(0, 9), C(0, 13), C(1, 11), C(2, 10), C(2, 12), C(3, 11)]) assert.ok(L.has(key(c)), 'fehlt ' + key(c));
  assert.equal(L.size, 6);
  assert.deepEqual(g.players[0].lacks, []);
});

test('Falsche Person, unbekannte Nachrichten, fehlende/unpassende Karten ändern nichts', () => {
  const g = setup({ n: 3, rows: [{ lo: 11, hi: 11 }, null, null, null], active: 1, hands: [[C(0, 12)], [C(0, 12), C(1, 11), C(2, 3)], [C(0, 10)]] });
  const s0 = snap(g);
  const bad = [
    ['p0', { t: 'play', card: C(0, 12) }], // nicht dran
    ['p2', { t: 'pass' }],
    ['zz', { t: 'play', card: C(0, 12) }], // spielt nicht mit
    ['p1', { t: 'play', card: C(0, 10) }], // hat die Karte nicht
    ['p1', { t: 'play', card: C(2, 3) }], // passt nicht
    ['p1', { t: 'play' }],
    ['p1', { t: 'play', card: null }],
    ['p1', { t: 'play', card: 'x' }],
    ['p1', { t: 'play', card: { s: 'a', r: 'b' } }],
    ['p1', { t: 'play', card: { s: 9, r: 12 } }],
    ['p1', { t: 'draw' }], ['p1', { t: 'skip' }], ['p1', { t: 'mau' }], ['p1', { t: 5 }], ['p1', null], ['p1', 'play'], ['p1', {}],
    ['p1', { t: 'next' }], // nur der Gastgeber, und die Runde läuft
    ['p0', { t: 'next' }],
  ];
  for (const [pid, msg] of bad) {
    const r = M.handle(g, pid, msg, seeded(1));
    assert.equal(r.ok, false, JSON.stringify([pid, msg]));
    assert.equal(typeof r.error, 'string');
    assert.equal(snap(g), s0, 'Zustand verändert bei ' + JSON.stringify([pid, msg]));
  }
  assert.equal(M.handle(null, 'p1', { t: 'pass' }).ok, false);
  assert.equal(M.handle({ game: 'mm' }, 'p1', { t: 'pass' }).ok, false);
});

test('Rundenende: Gewinner 0, alle anderen so viele Strafpunkte wie Karten, Passpunkte zählen mit', () => {
  const g = setup({ n: 3, rows: [{ lo: 11, hi: 12 }, null, null, null], active: 0, hands: [[C(0, 13)], [C(1, 3), C(1, 4), C(2, 5)], [C(3, 1), C(3, 2), C(3, 20), C(2, 6), C(2, 8)]] });
  g.players[1].points = 2; // frühere Strafpunkte (z. B. vom Passen)
  const r = M.handle(g, 'p0', { t: 'play', card: C(0, 13) });
  assert.equal(r.ok, true);
  assert.equal(r.won, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.winner, 'p0');
  assert.deepEqual(g.result.add, { p0: 0, p1: 3, p2: 5 });
  assert.deepEqual(g.players.map((p) => p.points), [0, 5, 5]);
  assert.equal(g.result.gameOver, false);
  assert.deepEqual(g.result.champions, []);
  assert.equal(g.last.kind, 'over');
  // Nach Rundenende kein Legen/Passen mehr
  const s0 = snap(g);
  assert.equal(M.handle(g, 'p1', { t: 'pass' }).ok, false);
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(1, 3) }).ok, false);
  assert.equal(snap(g), s0);
});

test('Spielende: ab Limit (30, Kurzspiel 15) am Rundenende, wenigste Strafpunkte gewinnen, Gleichstand geteilt', () => {
  for (const [opts, lim] of [[{}, 30], [{ short: true }, 15], [{ limit: 10 }, 10]]) {
    // knapp unter dem Limit: Spiel läuft weiter
    let g = setup({ n: 3, opts, rows: [{ lo: 11, hi: 12 }, null, null, null], hands: [[C(0, 13)], [C(1, 3), C(1, 4)], [C(3, 1), C(3, 2)]] });
    g.players[1].points = lim - 3;
    g.players[2].points = lim - 3;
    M.handle(g, 'p0', { t: 'play', card: C(0, 13) });
    assert.equal(g.result.gameOver, false, 'Limit ' + lim);
    assert.equal(M.handle(g, 'p0', { t: 'next' }, seeded(5)).ok, true);
    // genau am Limit: Ende
    g = setup({ n: 3, opts, rows: [{ lo: 11, hi: 12 }, null, null, null], hands: [[C(0, 13)], [C(1, 3), C(1, 4)], [C(3, 1), C(3, 2), C(3, 3)]] });
    g.players[0].points = 1; g.players[1].points = lim - 3; g.players[2].points = lim - 3;
    M.handle(g, 'p0', { t: 'play', card: C(0, 13) });
    assert.equal(g.result.gameOver, true, 'Limit ' + lim);
    assert.deepEqual(g.result.champions, ['p0']);
    assert.equal(M.handle(g, 'p0', { t: 'next' }, seeded(5)).ok, false, 'nach Spielende keine Runde mehr');
    assert.equal(g.phase, 'over');
  }
  // Gleichstand: beide mit den wenigsten gewinnen
  const g = setup({ n: 3, rows: [{ lo: 11, hi: 12 }, null, null, null], hands: [[C(0, 13)], [C(1, 3)], [C(3, 1), C(3, 2), C(3, 3), C(3, 4)]] });
  g.players[0].points = 7; g.players[1].points = 6; g.players[2].points = 27;
  M.handle(g, 'p0', { t: 'play', card: C(0, 13) });
  assert.equal(g.result.gameOver, true);
  assert.deepEqual(g.players.map((p) => p.points), [7, 7, 31]);
  assert.deepEqual(g.result.champions, ['p0', 'p1']);
});

test('Strafpunkte aus Passen allein beenden das Spiel nicht mitten in der Runde', () => {
  const g = setup({ n: 2, opts: { limit: 2 }, rows: [{ lo: 11, hi: 11 }, null, null, null], active: 1, hands: [[C(0, 12), C(0, 13)], [C(2, 4)]] });
  g.players[1].points = 5;
  assert.equal(M.handle(g, 'p1', { t: 'pass' }).ok, true);
  assert.equal(g.phase, 'play');
  assert.equal(g.players[1].points, 6);
});

test('Nächste Runde: nur Gastgeber, neu geben, Startperson mit Elf, Punkte bleiben', () => {
  const g = setup({ n: 3, rows: [{ lo: 11, hi: 12 }, null, null, null], hands: [[C(0, 13)], [C(1, 3), C(1, 4)], [C(3, 1)]] });
  g.hostId = 'p1';
  M.handle(g, 'p0', { t: 'play', card: C(0, 13) });
  assert.equal(g.phase, 'over');
  const gid = g.gid;
  const r0 = M.handle(g, 'p0', { t: 'next' }, seeded(8));
  assert.equal(r0.ok, false);
  assert.equal(g.phase, 'over');
  assert.equal(M.handle(g, 'p1', { t: 'next' }, seeded(8)).ok, true);
  assert.equal(g.phase, 'play');
  assert.equal(g.round, 2);
  assert.notEqual(g.gid, gid);
  assert.deepEqual(g.players.map((p) => p.points), [0, 2, 1]);
  assert.deepEqual(g.rows, [null, null, null, null]);
  assert.equal(g.players.reduce((n, p) => n + p.hand.length, 0), 84);
  assert.deepEqual(g.players.map((p) => p.hand.length), [28, 28, 28]);
  assert.equal(g.active, g.players.findIndex((p) => p.hand.some((c) => c.r === 11)));
  assert.deepEqual(g.players.map((p) => p.lacks), [[], [], []]);
  // mitten in der Runde nicht erlaubt
  assert.equal(M.handle(g, 'p1', { t: 'next' }, seeded(8)).ok, false);
});

test('Rangliste: wenigste Punkte zuerst, Gleichstand teilt den Rang', () => {
  const g = M.createGame(players(4), {}, seeded(2));
  [5, 2, 5, 9].forEach((v, i) => { g.players[i].points = v; });
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['p1', 'p0', 'p2', 'p3']);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4]);
  assert.deepEqual(r.map((x) => x.points), [2, 5, 5, 9]);
  [3, 3, 3, 3].forEach((v, i) => { g.players[i].points = v; });
  assert.deepEqual(M.ranking(g).map((x) => x.rank), [1, 1, 1, 1]);
});

function randomAction(g, id, rng) {
  const l = M.legalCards(g, id);
  return l.length ? { t: 'play', card: l[Math.floor(rng() * l.length)] } : { t: 'pass' };
}

test('300 Zufallspartien mit 2-6 Personen: enden immer, Kartenbilanz stets 84, nur gültige Züge', () => {
  let games = 0; let rounds = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const n = 2 + (seed % 5);
    const rng = seeded(seed * 31);
    const opts = seed % 3 === 0 ? { short: true } : {};
    const g = M.createGame(players(n), opts, rng);
    let guard = 0;
    for (;;) {
      assert.ok(guard++ < 20000, 'Endlosspiel bei Seed ' + seed);
      if (g.phase === 'over') {
        // Bilanz am Rundenende: Punkte der Runde = übrige Karten
        const sumAdd = Object.values(g.result.add).reduce((a, b) => a + b, 0);
        assert.equal(sumAdd, g.players.reduce((s, p) => s + p.hand.length, 0));
        assert.equal(g.players[g.players.findIndex((p) => p.id === g.result.winner)].hand.length, 0);
        rounds++;
        if (g.result.gameOver) break;
        assert.equal(M.handle(g, g.hostId, { t: 'next' }, rng).ok, true);
        continue;
      }
      assert.equal(total(g), 84, 'Bilanz');
      const ap = M.activePlayer(g);
      const prevPts = g.players.reduce((s, p) => s + p.points, 0);
      const msg = randomAction(g, ap.id, rng);
      const r = M.handle(g, ap.id, msg, rng);
      assert.equal(r.ok, true, JSON.stringify(msg));
      if (msg.t === 'pass') assert.equal(g.players.reduce((s, p) => s + p.points, 0), prevPts + 1);
      JSON.stringify(g);
    }
    const lim = g.opts.limit;
    assert.ok(g.players.some((p) => p.points >= lim));
    assert.ok(g.result.champions.length >= 1);
    const best = Math.min(...g.players.map((p) => p.points));
    for (const id of g.result.champions) assert.equal(g.players.find((p) => p.id === id).points, best);
    games++;
  }
  assert.equal(games, 300);
  console.log('Partien', games, 'Runden', rounds);
});
