import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../mogeln/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mk = (n = 3, seed = 1) => M.createGame(players(n), {}, seeded(seed));
const snap = (g) => JSON.stringify(g);
const c = (s, r) => M.makeCard(s, r);
// Zustand mit festen Händen: hands = Arrays von Karten-Nummern je Person; der Rest liegt auf dem Stapel (nur Zählung)
function setup(hands, { rank = 0, active = 0 } = {}) {
  const g = mk(hands.length);
  hands.forEach((h, i) => { g.players[i].hand = M.sortHand(h.slice()); });
  g.pile = []; g.lastPlay = null; g.rank = rank; g.active = active; g.phase = 'play'; g.moves = 0;
  return g;
}
const play = (g, pid, cards) => M.handle(g, pid, { t: 'play', cards });
const cnt = (g) => M.totalCards(g);

test('Karten: 52 verschiedene, Rang/Farbe/Namen', () => {
  const ids = new Set();
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) { const id = M.makeCard(s, r); ids.add(id); assert.equal(M.suitOf(id), s); assert.equal(M.rankOf(id), r); assert.ok(M.isCardId(id)); }
  assert.equal(ids.size, 52);
  assert.ok(!M.isCardId(52) && !M.isCardId(-1) && !M.isCardId(1.5) && !M.isCardId('3'));
  assert.equal(M.rankPlural(0), 'Asse'); assert.equal(M.rankPlural(1), 'Zweier'); assert.equal(M.rankPlural(12), 'Könige'); assert.equal(M.rankPlural(13), 'Asse');
  assert.equal(M.cardName(M.makeCard(2, 10)), '♥ Bube');
});

test('Austeilen: alle 52 Karten, gleichmäßig, Rest an die ersten Personen, Hand sortiert', () => {
  for (let n = 2; n <= 6; n++) {
    const g = mk(n, n);
    const all = g.players.flatMap((p) => p.hand);
    assert.equal(all.length, 52); assert.equal(new Set(all).size, 52);
    const base = Math.floor(52 / n); const extra = 52 % n;
    g.players.forEach((p, i) => {
      assert.equal(p.hand.length, base + (i < extra ? 1 : 0), `n=${n} Platz ${i}`);
      for (let k = 1; k < p.hand.length; k++) assert.ok(M.rankOf(p.hand[k - 1]) <= M.rankOf(p.hand[k]), 'nach Wert sortiert');
    });
    assert.equal(g.rank, 0); assert.equal(g.phase, 'play'); assert.equal(g.active, 0); assert.equal(g.pile.length, 0);
  }
  assert.throws(() => M.createGame(players(1), {}, seeded(1)));
  assert.throws(() => M.createGame(players(7), {}, seeded(1)));
  assert.doesNotThrow(() => M.createGame(players(6), {}, seeded(1)));
});

test('Legen: 1 bis 4 Karten, nur eigene, nur aktive Person, keine Doppelten; Rang läuft reihum', () => {
  const g = mk(3);
  const mine = g.players[0].hand;
  const before = snap(g);
  const bad = [[], [mine[0], mine[1], mine[2], mine[3], mine[4]], [mine[0], mine[0]], [999], [-1], ['x'], [1.5], null, 'abc', [null], [mine[0], undefined]];
  for (const cards of bad) { assert.equal(play(g, 'p0', cards).ok, false, JSON.stringify(cards)); assert.equal(snap(g), before); }
  assert.equal(M.handle(g, 'p0', { t: 'play' }).ok, false);
  assert.equal(play(g, 'p1', [g.players[1].hand[0]]).ok, false); // nicht dran
  assert.equal(play(g, 'xx', [mine[0]]).ok, false);
  const foreign = g.players[1].hand.find((x) => !mine.includes(x));
  assert.equal(play(g, 'p0', [foreign]).ok, false); // fremde Karte
  assert.equal(snap(g), before);
  const n0 = mine.length;
  const r = play(g, 'p0', [mine[0], mine[1]]);
  assert.equal(r.ok, true);
  assert.equal(g.players[0].hand.length, n0 - 2); assert.equal(g.pile.length, 2);
  assert.equal(g.phase, 'decide'); assert.equal(g.active, 1);
  assert.equal(g.lastPlay.count, 2); assert.equal(g.lastPlay.rank, 0); assert.equal(g.rank, 1);
  assert.equal(M.shownRank(g), 0);
  assert.equal(cnt(g), 52);
  assert.equal(play(g, 'p1', [g.players[1].hand[0]]).ok, false); // in 'decide' wird nicht gelegt
});

test('Rang läuft von Ass bis König und wieder von vorn', () => {
  const g = setup([[c(0, 0), c(0, 1), c(0, 2), c(0, 3), c(0, 4), c(0, 5), c(0, 6), c(0, 7), c(0, 8), c(0, 9), c(0, 10), c(0, 11), c(0, 12), c(1, 0), c(1, 1)], [c(2, 0)]], { rank: 12 });
  // 2 Personen, Rang König
  assert.equal(M.shownRank(g), 12);
  play(g, 'p0', [c(0, 12)]);
  assert.equal(g.rank, 0); // nach dem König wieder Asse
  M.handle(g, 'p1', { t: 'believe' });
  assert.equal(M.shownRank(g), 0);
});

test('Glauben: nur die nächste Person; sie ist dann selbst dran mit dem nächsten Rang, Stapel bleibt', () => {
  const g = setup([[c(0, 0), c(0, 5), c(1, 7)], [c(1, 1), c(2, 3)], [c(3, 4), c(3, 9)]]);
  play(g, 'p0', [c(0, 0)]);
  const before = snap(g);
  assert.equal(M.handle(g, 'p0', { t: 'believe' }).ok, false);
  assert.equal(M.handle(g, 'p2', { t: 'believe' }).ok, false);
  assert.equal(M.handle(g, 'p2', { t: 'call' }).ok, false);
  assert.equal(snap(g), before);
  assert.equal(M.handle(g, 'p1', { t: 'believe' }).ok, true);
  assert.equal(g.phase, 'play'); assert.equal(g.active, 1); assert.equal(g.rank, 1); assert.equal(g.pile.length, 1);
  assert.equal(M.handle(g, 'p1', { t: 'believe' }).ok, false); // nicht noch einmal
  play(g, 'p1', [c(1, 1)]);
  assert.equal(g.lastPlay.rank, 1); assert.equal(g.active, 2); assert.equal(g.pile.length, 2);
});

test('Mogler bei Lüge: legende Person nimmt den ganzen Stapel, danach beginnt die Person nach der zweifelnden', () => {
  const g = setup([[c(0, 0), c(0, 5), c(1, 7)], [c(1, 1), c(2, 3)], [c(3, 4), c(3, 9)]]);
  play(g, 'p0', [c(0, 0)]); M.handle(g, 'p1', { t: 'believe' }); // Stapel: A
  play(g, 'p1', [c(1, 1), c(2, 3)]); // gelogen: 2 + 3 als Zweier
  assert.equal(g.pile.length, 3);
  const r = M.handle(g, 'p2', { t: 'call' });
  assert.equal(r.ok, true); assert.equal(r.liar, true); assert.equal(r.taker, 'p1');
  assert.equal(g.phase, 'reveal');
  assert.equal(g.pile.length, 0);
  assert.equal(g.players[1].hand.length, 3); // 0 + A + 2 + 3
  assert.ok(g.players[1].hand.includes(c(0, 0)) && g.players[1].hand.includes(c(2, 3)));
  assert.equal(g.last.kind, 'reveal'); assert.equal(g.last.liar, true); assert.deepEqual(g.last.ids, [c(1, 1), c(2, 3)]); assert.equal(g.last.taken, 3);
  assert.equal(g.active, 0); // nach p2 (zweifelnd) kommt p0
  assert.equal(M.shownRank(g), 1);
  assert.equal(M.handle(g, 'p0', { t: 'call' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, true);
  assert.equal(g.phase, 'play'); assert.equal(g.active, 0); assert.equal(g.rank, 2); // Rang geht weiter
  assert.equal(cnt(g), 7);
});

test('Mogler bei Wahrheit: die zweifelnde Person nimmt den Stapel; ein einziger falscher Rang genügt für Lüge', () => {
  const g = setup([[c(0, 0), c(1, 0), c(0, 5)], [c(1, 1), c(2, 3)], [c(3, 4), c(3, 9)]]);
  play(g, 'p0', [c(0, 0), c(1, 0)]); // wahr: zwei Asse
  const r = M.handle(g, 'p1', { t: 'call' });
  assert.equal(r.liar, false); assert.equal(r.taker, 'p1');
  assert.equal(g.players[1].hand.length, 4); assert.equal(g.players[0].hand.length, 1);
  assert.equal(g.active, 2); // Person nach der zweifelnden (p1) ist p2
  assert.equal(g.phase, 'reveal');
  const h = setup([[c(0, 0), c(1, 0), c(0, 5), c(2, 7)], [c(1, 1)], [c(3, 4)]]);
  play(h, 'p0', [c(0, 0), c(1, 0), c(2, 7)]); // zwei Asse und eine Acht -> gelogen
  assert.equal(M.handle(h, 'p1', { t: 'call' }).liar, true);
  assert.equal(h.players[0].hand.length, 1 + 3);
});

test('Letzte Ablage: Glauben = Sieg; Zweifel an Lüge = Stapel aufnehmen und weiter; Zweifel an Wahrheit = Sieg', () => {
  // Glauben -> Sieg
  let g = setup([[c(0, 0)], [c(1, 1), c(2, 3)], [c(3, 4)]]);
  play(g, 'p0', [c(0, 0)]);
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(M.handle(g, 'p1', { t: 'believe' }).ok, true);
  assert.equal(g.phase, 'over'); assert.equal(g.result.winner, 'p0'); assert.equal(g.players[0].wins, 1);
  assert.equal(M.handle(g, 'p1', { t: 'believe' }).ok, false);
  // Zweifel an wahrer letzter Ablage -> Sieg der legenden Person, Zweifler nimmt Stapel
  g = setup([[c(0, 0)], [c(1, 1), c(2, 3)], [c(3, 4)]]);
  play(g, 'p0', [c(0, 0)]);
  let r = M.handle(g, 'p1', { t: 'call' });
  assert.equal(r.liar, false); assert.equal(g.phase, 'over'); assert.equal(g.result.winner, 'p0');
  assert.equal(g.players[1].hand.length, 3); assert.equal(g.last.kind, 'reveal');
  // Zweifel an gelogener letzter Ablage -> kein Sieg, Person nimmt den Stapel
  g = setup([[c(0, 5)], [c(1, 1), c(2, 3)], [c(3, 4)]]);
  play(g, 'p0', [c(0, 5)]); // gelogen (Asse angesagt)
  r = M.handle(g, 'p1', { t: 'call' });
  assert.equal(r.liar, true); assert.equal(g.phase, 'reveal');
  assert.equal(g.players[0].hand.length, 1); assert.equal(g.players[0].wins, 0);
  assert.equal(g.active, 2);
  // Letzte Ablage in der Mitte einer Partie: Stapel mit früheren Karten
  g = setup([[c(0, 0), c(0, 1)], [c(1, 1), c(2, 3)], [c(3, 4), c(3, 5)]]);
  play(g, 'p0', [c(0, 0)]); M.handle(g, 'p1', { t: 'believe' });
  play(g, 'p1', [c(1, 1)]); M.handle(g, 'p2', { t: 'believe' });
  play(g, 'p2', [c(3, 4)]); // gelogen (Dreier)
  M.handle(g, 'p0', { t: 'believe' });
  play(g, 'p0', [c(0, 1)]); // letzte Karte von p0, Rang 4: gelogen
  assert.equal(g.players[0].hand.length, 0);
  r = M.handle(g, 'p1', { t: 'call' });
  assert.equal(r.liar, true); assert.equal(g.phase, 'reveal'); assert.equal(g.players[0].hand.length, 4);
});

test('Spielende: Gewinner zählt Siegpunkt; nur Gastgeber startet nächste Runde, Spielstand bleibt, Startperson rotiert', () => {
  const g = M.createGame(players(3), {}, seeded(5), 'p1');
  assert.equal(g.hostId, 'p1');
  g.players.forEach((p) => { p.hand = []; });
  g.players[0].hand = [c(0, 0)]; g.players[1].hand = [c(1, 1), c(2, 3)]; g.players[2].hand = [c(3, 4)];
  g.pile = []; g.rank = 0; g.active = 0;
  play(g, 'p0', [c(0, 0)]); M.handle(g, 'p1', { t: 'believe' });
  assert.equal(g.phase, 'over');
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false); // nicht der Gastgeber
  assert.equal(M.handle(g, 'p2', { t: 'next' }).ok, false);
  assert.equal(M.nextRound(mk(3)).ok, false); // Runde läuft noch
  assert.equal(M.handle(g, 'p1', { t: 'next' }).ok, true);
  assert.equal(g.round, 2); assert.equal(g.phase, 'play'); assert.equal(g.players[0].wins, 1);
  assert.equal(g.active, 1); // Startperson rotiert
  assert.equal(cnt(g), 52); assert.equal(g.rank, 0); assert.equal(g.pile.length, 0);
  const st = M.standings(g);
  assert.equal(st[0].id, 'p0'); assert.equal(st[0].wins, 1);
});

test('Ungültige Nachrichten/Phasen ändern den Zustand nie; Zustand ist JSON-sicher', () => {
  const g = mk(3);
  const before = snap(g);
  const junk = [undefined, null, 5, 'x', [], {}, { t: 5 }, { t: 'foo' }, { t: 'believe' }, { t: 'call' }, { t: 'next' }, { t: 'play', cards: 'x' }];
  for (const m of junk) for (const pid of ['p0', 'p1', 'zz', undefined, null]) {
    const r = M.handle(g, pid, m);
    if (r.ok) assert.fail('sollte scheitern: ' + JSON.stringify(m) + pid);
    assert.equal(snap(g), before);
  }
  for (const bad of [undefined, null, {}, { game: 'xx' }, { game: 'mg' }]) assert.equal(M.handle(bad, 'p0', { t: 'next' }).ok, false);
  assert.deepEqual(JSON.parse(snap(g)), g);
  const h = JSON.parse(snap(g));
  const m = h.players[0].hand.slice(0, 2);
  assert.equal(M.handle(h, 'p0', { t: 'play', cards: m }).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h)), h);
});

test('Zugdeckel: nach 600 Zügen endet die Runde, wenigste Karten gewinnen', () => {
  const g = setup([[c(0, 0), c(0, 1), c(0, 2)], [c(1, 1), c(2, 3)], [c(3, 4), c(3, 9), c(3, 5), c(3, 6)]]);
  g.moves = M.MOVE_CAP - 1;
  play(g, 'p0', [c(0, 0)]);
  assert.equal(g.phase, 'over'); assert.equal(g.result.capped, true);
  assert.equal(g.result.winner, 'p1'); // 2 Karten
  assert.equal(M.ranking(g)[0].id, 'p1'); assert.equal(M.ranking(g)[0].place, 1);
});

test('Ranking: Sieger zuerst, dann nach Kartenzahl', () => {
  const g = setup([[c(0, 0)], [c(1, 1), c(2, 3)], [c(3, 4), c(3, 5), c(3, 6)]]);
  play(g, 'p0', [c(0, 0)]); M.handle(g, 'p1', { t: 'believe' });
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['p0', 'p1', 'p2']);
  assert.deepEqual(r.map((x) => x.place), [1, 2, 3]);
});

// Zufallspartien mit gültigen Zügen jeder Art (auch Lügen mit vielen Karten): Karten bleiben 52, Spiel endet immer
test('300 Zufallspartien (2-6 Personen): Kartenbilanz stets 52, jede Runde endet, Siegbedingung stimmt', () => {
  let capped = 0; let wins = 0; let maxMoves = 0;
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 5);
    const rng = seeded(i + 11);
    const g = M.createGame(players(n), {}, rng);
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 5000) {
      assert.equal(cnt(g), 52, 'Bilanz');
      const ap = M.activePlayer(g);
      let r;
      if (g.phase === 'play') {
        const k = 1 + Math.floor(rng() * Math.min(4, ap.hand.length));
        const pool = ap.hand.slice(); const cards = [];
        for (let j = 0; j < k; j++) cards.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        r = M.handle(g, ap.id, { t: 'play', cards }, rng);
      } else if (g.phase === 'decide') r = M.handle(g, ap.id, { t: rng() < 0.5 ? 'believe' : 'call' }, rng);
      else r = M.handle(g, ap.id, { t: 'next' }, rng);
      assert.equal(r.ok, true, r.error);
      for (const p of g.players) assert.ok(p.hand.length >= 0);
      if (g.phase !== 'over') assert.ok(g.players.every((p) => p.hand.length > 0 || p.id === g.lastPlay.pid), 'nur die legende Person kann leer sein');
    }
    assert.equal(g.phase, 'over'); assert.equal(cnt(g), 52);
    const w = g.players.find((p) => p.id === g.result.winner);
    if (g.result.capped) { capped++; assert.ok(g.players.every((p) => p.hand.length >= w.hand.length)); } else assert.equal(w.hand.length, 0);
    wins += g.players.reduce((s, p) => s + p.wins, 0);
    maxMoves = Math.max(maxMoves, g.moves);
  }
  assert.equal(wins, 300);
  console.log('gedeckelte Runden', capped, 'von 300, längste Runde', maxMoves, 'Züge');
});
