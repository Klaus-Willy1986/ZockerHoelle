import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../haus/engine.js';

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
const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
// Würfel-rng: liefert nacheinander die gewünschten Augenzahlen (danach 0.5)
const dice = (...vals) => { const q = vals.slice(); return () => (q.length ? (q.shift() - 1) / 6 + 0.01 : 0.5); };
const G = (n = 2, opts = {}) => E.createGame(ids(n), opts, mulberry(7));
const P = (s, id) => s.players.find((p) => p.id === id);
const give = (s, id, sqs) => { for (const q of sqs) { s.owners[q] = id; } };
const ok = (r) => assert.equal(r.ok, true, r.error);
const bad = (r, re) => { assert.equal(r.ok, false); assert.equal(typeof r.error, 'string'); if (re) assert.match(r.error, re); };
// p setzen und mit den Augen a,b würfeln
const roll = (s, id, a, b) => E.handle(s, id, { t: 'roll' }, dice(a, b));
const at = (s, id, pos) => { P(s, id).pos = pos; };
const sum = (s) => s.players.reduce((x, p) => x + p.cash, 0);
// Zug ohne Besonderheiten beenden
const endTurn = (s, id) => { assert.equal(s.phase, 'manage'); ok(E.handle(s, id, { t: 'end' })); };
// Ereigniskarte erzwingen: Person steht 5 Felder vor dem Ereignisfeld ev und würfelt 2+3
function drawCard(s, id, card, ev = 7) {
  s.deck = [card];
  at(s, id, ev - 5);
  return roll(s, id, 2, 3);
}
const money = (s) => assert.equal(sum(s) + s.bank, s.opts.startMoney * s.players.length, 'Geldbilanz');

// ---------- Brett ----------
test('Brett: 40 Felder, Typen und Verteilung', () => {
  assert.equal(E.SQUARES.length, 40);
  assert.ok(E.SQUARES.every((s, i) => s.i === i && typeof s.name === 'string' && s.name.length > 0));
  const cnt = (t) => E.SQUARES.filter((s) => s.type === t).map((s) => s.i);
  assert.deepEqual(cnt('start'), [0]);
  assert.deepEqual(cnt('jail'), [10]);
  assert.deepEqual(cnt('free'), [20]);
  assert.deepEqual(cnt('gojail'), [30]);
  assert.deepEqual(cnt('station'), [5, 15, 25, 35]);
  assert.deepEqual(cnt('utility'), [12, 28]);
  assert.deepEqual(cnt('tax'), [4, 38]);
  assert.deepEqual(cnt('event'), [2, 7, 17, 22, 33, 36]);
  assert.equal(cnt('street').length, 22);
  assert.equal(E.SQUARES[0].name, 'Rathaus (Start)');
  assert.equal(E.SQUARES[20].name, 'Lahnwiesen');
  assert.deepEqual([E.SQUARES[4].amount, E.SQUARES[38].amount], [200, 100]);
  assert.deepEqual([E.SQUARES[12].name, E.SQUARES[28].name], ['Stadtwerke Strom', 'Stadtwerke Wasser']);
});
test('Brett: 8 Farbgruppen vollständig (2 oder 3 Grundstücke), zusammen 22', () => {
  assert.equal(E.colorGroups.length, 8);
  assert.equal(E.COLOR_IDS.length, 8);
  const all = E.colorGroups.flat();
  assert.equal(all.length, 22);
  assert.equal(new Set(all).size, 22);
  assert.deepEqual(E.colorGroups.map((g) => g.length), [2, 3, 3, 3, 3, 3, 3, 2]);
  E.colorGroups.forEach((g, gi) => g.forEach((q) => { assert.equal(E.SQUARES[q].group, gi); assert.equal(E.SQUARES[q].color, E.COLOR_IDS[gi]); assert.equal(E.groupOf(q), gi); }));
  assert.equal(E.groupOf(0), -1);
  assert.equal(E.squareInfo(5), E.SQUARES[5]);
});
test('Brett: Preise, Mieten und Hauspreise plausibel', () => {
  const st = E.SQUARES.filter((s) => s.type === 'street');
  assert.equal(Math.min(...st.map((s) => s.price)), 60);
  assert.equal(Math.max(...st.map((s) => s.price)), 400);
  for (let i = 1; i < st.length; i++) assert.ok(st[i].price >= st[i - 1].price, 'Preise steigen entlang des Rings');
  for (const s of st) {
    assert.equal(s.rent.length, 6);
    for (let k = 1; k < 6; k++) assert.ok(s.rent[k] > s.rent[k - 1], s.name + ' Miete steigt');
    assert.ok(s.rent[0] < s.price / 5 && s.rent[5] > s.price);
    assert.equal(s.mortgage, s.price / 2);
    assert.ok([50, 100, 150, 200].includes(s.houseCost));
  }
  E.colorGroups.forEach((g, gi) => assert.ok(g.every((q) => E.SQUARES[q].houseCost === [50, 50, 100, 100, 150, 150, 200, 200][gi])));
  for (const q of E.STATION_SQS) assert.equal(E.SQUARES[q].price, 200);
  for (const q of E.UTILITY_SQS) assert.equal(E.SQUARES[q].price, 150);
  assert.deepEqual(E.STATION_RENT, [25, 50, 100, 200]);
  assert.equal(E.unmortgageCost(1), 33);
  assert.equal(E.unmortgageCost(37), 193);
});
test('Brett: einzigartige erfundene Namen, keine geschützten Begriffe', () => {
  const names = E.SQUARES.map((s) => s.name);
  const named = names.filter((n) => !['Ereignis'].includes(n));
  assert.equal(new Set(named).size, named.length);
  const forbidden = /monopoly|schlossallee|parkstra|badstra|hauptstra|opernplatz|turmstra|seestra|poststra|berliner|münchner|wiener|elisenstra|theaterstra|museumstra|goethestra|rathausplatz|neue stra|los\b/i;
  for (const t of [...names, ...E.CARDS.map((c) => c.text)]) assert.doesNotMatch(t, forbidden, t);
});
test('Ereigniskarten: 16 eigene Karten, genau eine Freikarte', () => {
  assert.equal(E.CARDS.length, 16);
  assert.ok(E.CARDS.every((c, i) => c.id === i && c.text.length > 10));
  assert.equal(E.CARDS.filter((c) => c.kind === 'free').length, 1);
  assert.equal(E.CARDS[E.FREE_CARD].kind, 'free');
  assert.equal(new Set(E.CARDS.map((c) => c.text)).size, 16);
});

// ---------- Start ----------
test('Spielstart: Startkapital 1500, Grundzustand, 2 bis 6 Personen', () => {
  for (let n = 2; n <= 6; n++) {
    const s = G(n);
    assert.equal(s.players.length, n);
    assert.ok(s.players.every((p, i) => p.cash === 1500 && p.pos === 0 && p.jail === 0 && p.freeCards === 0 && !p.out && p.token === i));
    assert.equal(s.phase, 'roll');
    assert.equal(s.active, 0);
    assert.equal(s.round, 1);
    assert.equal(s.deck.length, 16);
    assert.deepEqual([...s.deck].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
    assert.deepEqual(s.supply, { houses: 32, hotels: 12 });
    assert.deepEqual(s.opts, { startMoney: 1500, auction: true, maxRounds: 30 });
    assert.equal(Object.keys(s.houses).length, 22);
    money(s);
  }
  assert.throws(() => E.createGame(ids(1), {}, mulberry(1)), RangeError);
  assert.throws(() => E.createGame(ids(7), {}, mulberry(1)), RangeError);
  assert.equal(G(2, { startMoney: 800 }).players[1].cash, 800);
});
test('Stapel hängt vom rng ab, Zustand ist JSON-sicher', () => {
  const a = E.createGame(ids(2), {}, mulberry(1)), b = E.createGame(ids(2), {}, mulberry(2));
  assert.notDeepEqual(a.deck, b.deck);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

// ---------- Würfeln und Ziehen ----------
test('Würfeln: zieht Augensumme, danach Kaufphase auf freiem Grundstück', () => {
  const s = G();
  ok(roll(s, 'p0', 1, 2));
  assert.deepEqual(s.dice, [1, 2]);
  assert.equal(P(s, 'p0').pos, 3);
  assert.equal(s.phase, 'buy');
  assert.deepEqual(s.last, { pid: 'p0', from: 0, to: 3, kind: 'dice' });
});
test('Würfeln: Zug endet nach manage und end, nächste Person ist dran', () => {
  const s = G(3);
  give(s, 'p0', [3]);
  ok(roll(s, 'p0', 1, 2)); // eigenes Grundstück
  assert.equal(s.phase, 'manage');
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.phase, 'roll');
  assert.equal(s.active, 1);
  assert.equal(s.doubles, 0);
});
test('Pasch: nochmal würfeln für dieselbe Person', () => {
  const s = G();
  give(s, 'p0', [18]);
  at(s, 'p0', 14);
  ok(roll(s, 'p0', 2, 2));
  assert.equal(s.doubles, 1);
  assert.equal(s.phase, 'manage');
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.phase, 'roll');
  assert.equal(s.active, 0);
  give(s, 'p0', [21]);
  ok(roll(s, 'p0', 1, 2)); // 18 + 3 = 21, kein Pasch
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.active, 1);
});
test('Dritter Pasch in Folge: direkt ins Gefängnis ohne zu ziehen', () => {
  const s = G();
  s.doubles = 2;
  at(s, 'p0', 14);
  ok(roll(s, 'p0', 3, 3));
  const p = P(s, 'p0');
  assert.equal(p.pos, 10);
  assert.equal(p.jail, 1);
  assert.equal(s.phase, 'manage');
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.active, 1);
  assert.equal(s.doubles, 0);
});
test('Startfeld: Durchgang bringt 200, auch beim Ziehen genau auf Feld 0', () => {
  let s = G();
  give(s, 'p0', [1]);
  at(s, 'p0', 36);
  ok(roll(s, 'p0', 2, 3)); // 41 -> Feld 1
  assert.equal(P(s, 'p0').pos, 1);
  assert.equal(P(s, 'p0').cash, 1700);
  money(s);
  s = G();
  at(s, 'p0', 36);
  ok(roll(s, 'p0', 2, 2)); // genau Feld 0
  assert.equal(P(s, 'p0').pos, 0);
  assert.equal(P(s, 'p0').cash, 1700);
  s = G();
  at(s, 'p0', 10);
  give(s, 'p0', [16]);
  ok(roll(s, 'p0', 2, 4));
  assert.equal(P(s, 'p0').cash, 1500); // kein Durchgang
});
test('Felder ohne Wirkung: Ferienwiese, Besuch; Gehe ins Gefängnis wirkt', () => {
  let s = G();
  at(s, 'p0', 17);
  ok(roll(s, 'p0', 1, 2)); // 20
  assert.equal(P(s, 'p0').pos, 20);
  assert.equal(P(s, 'p0').cash, 1500);
  assert.equal(s.phase, 'manage');
  s = G();
  at(s, 'p0', 7);
  ok(roll(s, 'p0', 1, 2)); // 10 Besuch
  assert.equal(P(s, 'p0').jail, 0);
  assert.equal(s.phase, 'manage');
  s = G();
  at(s, 'p0', 27);
  ok(roll(s, 'p0', 1, 2)); // 30
  assert.equal(P(s, 'p0').pos, 10);
  assert.equal(P(s, 'p0').jail, 1);
  assert.equal(s.phase, 'manage');
  s = G();
  at(s, 'p0', 28);
  ok(roll(s, 'p0', 1, 1)); // Pasch auf Feld 30: kein Zusatzwurf
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.active, 1);
});
test('Steuerfelder: 200 und 100 an die Bank', () => {
  let s = G();
  at(s, 'p0', 1);
  ok(roll(s, 'p0', 1, 2)); // 4
  assert.equal(P(s, 'p0').cash, 1300);
  assert.equal(s.bank, 200);
  money(s);
  s = G();
  at(s, 'p0', 35);
  ok(roll(s, 'p0', 1, 2)); // 38
  assert.equal(P(s, 'p0').cash, 1400);
  money(s);
});

// ---------- Kaufen, Ablehnen, Auktion ----------
test('Kaufen: Preis an die Bank, Besitz eingetragen', () => {
  const s = G();
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'buy' }));
  assert.equal(s.owners[3], 'p0');
  assert.equal(P(s, 'p0').cash, 1440);
  assert.equal(s.bank, 60);
  assert.equal(s.phase, 'manage');
  assert.deepEqual(E.ownedBy(s, 'p0'), [3]);
});
test('Kaufphase: ohne genug Bargeld gibt es gleich die Auktion', () => {
  const s = G(3);
  P(s, 'p0').cash = 50;
  s.bank += 1450;
  ok(roll(s, 'p0', 1, 2));
  assert.equal(s.phase, 'auction');
  assert.equal(s.auction.sq, 3);
  assert.equal(s.auction.turn, 'p1');
});
test('Auktion: Ablehnen startet Auktion, Reihenfolge ab der nächsten Person, Gebote und Passen', () => {
  const s = G(3);
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'decline' }));
  assert.equal(s.phase, 'auction');
  assert.deepEqual(s.auction.order, ['p1', 'p2', 'p0']);
  assert.equal(E.activePlayer(s).id, 'p1');
  bad(E.handle(s, 'p2', { t: 'bid', amount: 10 }), /nicht an der Reihe/);
  bad(E.handle(s, 'p1', { t: 'bid', amount: 5 }));
  bad(E.handle(s, 'p1', { t: 'bid', amount: 15 }));
  bad(E.handle(s, 'p1', { t: 'bid', amount: 5000 }), /Bargeld/);
  bad(E.handle(s, 'p1', { t: 'buy' }));
  ok(E.handle(s, 'p1', { t: 'bid', amount: 10 }));
  assert.equal(E.activePlayer(s).id, 'p2');
  bad(E.handle(s, 'p2', { t: 'bid', amount: 10 }), /mindestens 20/); // Gleichstand ist kein Gebot
  ok(E.handle(s, 'p2', { t: 'bid', amount: 40 }));
  ok(E.handle(s, 'p0', { t: 'pass_bid' }));
  assert.equal(E.activePlayer(s).id, 'p1');
  ok(E.handle(s, 'p1', { t: 'bid', amount: 50 }));
  ok(E.handle(s, 'p2', { t: 'pass_bid' }));
  assert.equal(s.phase, 'manage');
  assert.equal(s.owners[3], 'p1');
  assert.equal(P(s, 'p1').cash, 1450);
  assert.equal(s.auction, null);
  assert.equal(E.turnPlayer(s).id, 'p0');
  money(s);
});
test('Auktion: alle passen -> Grundstück bleibt frei', () => {
  const s = G(3);
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'decline' }));
  ok(E.handle(s, 'p1', { t: 'pass_bid' }));
  ok(E.handle(s, 'p2', { t: 'pass_bid' }));
  assert.equal(s.phase, 'auction'); // die Letzte wird noch gefragt (kein Gebot vorhanden)
  assert.equal(E.activePlayer(s).id, 'p0');
  ok(E.handle(s, 'p0', { t: 'pass_bid' }));
  assert.equal(s.phase, 'manage');
  assert.equal(s.owners[3], undefined);
  assert.ok(s.recap.some((t) => /Niemand bietet/.test(t)));
});
test('Auktion: letzte verbleibende Person ohne Gebot darf noch zum Mindestgebot zuschlagen', () => {
  const s = G(2);
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'decline' }));
  ok(E.handle(s, 'p1', { t: 'pass_bid' }));
  assert.equal(E.activePlayer(s).id, 'p0');
  ok(E.handle(s, 'p0', { t: 'bid', amount: 10 }));
  assert.equal(s.phase, 'manage');
  assert.equal(s.owners[3], 'p0');
  assert.equal(P(s, 'p0').cash, 1490);
});
test('Auktion: wer das Mindestgebot nicht bezahlen kann, passt automatisch', () => {
  const s = G(3);
  P(s, 'p1').cash = 100; P(s, 'p2').cash = 15; s.bank += 1385 + 1485 - 1500 - 1500 + 1500 + 1500 - 1385 - 1485 + 1385 + 1485;
  s.bank = s.opts.startMoney * 3 - sum(s);
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'decline' }));
  assert.equal(E.activePlayer(s).id, 'p1');
  ok(E.handle(s, 'p1', { t: 'bid', amount: 100 }));
  // p2 hat nur 15 (<110) -> automatisch raus; p0 kann bieten
  assert.equal(E.activePlayer(s).id, 'p0');
  ok(E.handle(s, 'p0', { t: 'bid', amount: 110 }));
  assert.equal(s.phase, 'manage'); // p1 hat nur 100 (<120) -> passt automatisch
  assert.equal(s.owners[3], 'p0');
  money(s);
});
test('Auktion aus (opts.auction=false): Grundstück bleibt frei', () => {
  const s = G(2, { auction: false });
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'decline' }));
  assert.equal(s.phase, 'manage');
  assert.equal(s.owners[3], undefined);
});
test('Auktion: auch Bahnhof und Versorger, Haus-Zähler bleibt 0', () => {
  const s = G(2);
  at(s, 'p0', 2);
  ok(roll(s, 'p0', 1, 2)); // 5 Bahnhof
  assert.equal(s.phase, 'buy');
  ok(E.handle(s, 'p0', { t: 'decline' }));
  ok(E.handle(s, 'p1', { t: 'bid', amount: 20 }));
  ok(E.handle(s, 'p0', { t: 'pass_bid' }));
  assert.equal(s.owners[5], 'p1');
});

// ---------- Miete ----------
test('Miete: Grundstück ohne Haus, mit Farbbesitz doppelt, mit Häusern', () => {
  const s = G();
  give(s, 'p1', [6]);
  assert.equal(E.rentOf(s, 6), 6);
  give(s, 'p1', [8]);
  assert.equal(E.rentOf(s, 6), 6);
  give(s, 'p1', [9]);
  assert.equal(E.rentOf(s, 6), 12); // doppelt
  s.houses[6] = 1;
  assert.equal(E.rentOf(s, 6), 30);
  s.houses[6] = 4;
  assert.equal(E.rentOf(s, 6), 400);
  s.houses[6] = 5;
  assert.equal(E.rentOf(s, 6), 550);
  assert.equal(E.rentOf(s, 0), 0);
  assert.equal(E.rentOf(s, 11), 0); // frei
  s.mortgaged[6] = true;
  assert.equal(E.rentOf(s, 6), 0);
});
test('Miete: Landung zahlt an die Besitzerin; Gruppenbesitz verdoppelt', () => {
  const s = G();
  give(s, 'p1', [1, 3]);
  ok(roll(s, 'p0', 1, 2)); // 3
  assert.equal(P(s, 'p0').cash, 1500 - 8);
  assert.equal(P(s, 'p1').cash, 1508);
  assert.equal(s.phase, 'manage');
  money(s);
});
test('Miete: Landung auf eigenem Grundstück kostet nichts', () => {
  const s = G();
  give(s, 'p0', [3]);
  ok(roll(s, 'p0', 1, 2));
  assert.equal(P(s, 'p0').cash, 1500);
});
test('Miete: beliehenes Grundstück kostet keine Miete', () => {
  const s = G();
  give(s, 'p1', [3]);
  s.mortgaged[3] = true;
  ok(roll(s, 'p0', 1, 2));
  assert.equal(P(s, 'p0').cash, 1500);
  assert.equal(s.phase, 'manage');
});
test('Miete: Bahnhöfe 25/50/100/200 nach Zahl der Bahnhöfe', () => {
  const s = G();
  const expect = [25, 50, 100, 200];
  E.STATION_SQS.forEach((q, i) => {
    give(s, 'p1', [q]);
    assert.equal(E.rentOf(s, E.STATION_SQS[0]), expect[i]);
    assert.equal(E.rentOf(s, q), expect[i]);
  });
  assert.equal(E.rentOf(s, 5, 0, { double: true }), 400);
  const t = G();
  give(t, 'p1', [5, 15]);
  at(t, 'p0', 2);
  ok(roll(t, 'p0', 1, 2));
  assert.equal(P(t, 'p0').cash, 1450);
});
test('Miete: Versorger 4x bzw. 10x Augensumme', () => {
  const s = G();
  give(s, 'p1', [12]);
  assert.equal(E.rentOf(s, 12, 7), 28);
  give(s, 'p1', [28]);
  assert.equal(E.rentOf(s, 12, 7), 70);
  assert.equal(E.rentOf(s, 28, 3), 30);
  const t = G();
  give(t, 'p1', [12]);
  at(t, 'p0', 8);
  ok(roll(t, 'p0', 1, 3)); // 12, Summe 4 -> 16
  assert.equal(P(t, 'p0').cash, 1484);
  const u = G();
  give(u, 'p1', [12, 28]);
  at(u, 'p0', 8);
  ok(roll(u, 'p0', 1, 3));
  assert.equal(P(u, 'p0').cash, 1460);
});
test('Miete: Besitzerin im Gefängnis kassiert trotzdem', () => {
  const s = G();
  give(s, 'p1', [3]);
  P(s, 'p1').jail = 2;
  P(s, 'p1').pos = 10;
  ok(roll(s, 'p0', 1, 2));
  assert.equal(P(s, 'p1').cash, 1504);
});

// ---------- Ereigniskarten ----------
test('Karte 0: Vorrücken auf Startfeld (+200)', () => {
  const s = G();
  ok(drawCard(s, 'p0', 0));
  assert.equal(P(s, 'p0').pos, 0);
  assert.equal(P(s, 'p0').cash, 1700);
  assert.equal(s.card.id, 0);
  assert.equal(s.phase, 'manage');
});
test('Karte 1: Vorrücken auf Schmiedegasse (mit/ohne Startdurchgang), Kauf möglich', () => {
  let s = G();
  ok(drawCard(s, 'p0', 1, 7));
  assert.equal(P(s, 'p0').pos, 11);
  assert.equal(P(s, 'p0').cash, 1500);
  assert.equal(s.phase, 'buy');
  s = G();
  ok(drawCard(s, 'p0', 1, 17));
  assert.equal(P(s, 'p0').pos, 11);
  assert.equal(P(s, 'p0').cash, 1700);
});
test('Karte 2: Vorrücken auf Goldenen Anger, Miete an die Besitzerin', () => {
  const s = G();
  give(s, 'p1', [39]);
  ok(drawCard(s, 'p0', 2, 36));
  assert.equal(P(s, 'p0').pos, 39);
  assert.equal(P(s, 'p0').cash, 1450);
  assert.equal(P(s, 'p1').cash, 1550);
});
test('Karten 3 und 4: nächster Bahnhof, Doppelmiete', () => {
  for (const card of [3, 4]) {
    const s = G();
    give(s, 'p1', [15]);
    ok(drawCard(s, 'p0', card, 7));
    assert.equal(P(s, 'p0').pos, 15);
    assert.equal(P(s, 'p0').cash, 1450);
    assert.equal(P(s, 'p1').cash, 1550);
  }
  const s = G();
  ok(drawCard(s, 'p0', 3, 36)); // 36 -> Bahnhof 5 mit Durchgang
  assert.equal(P(s, 'p0').pos, 5);
  assert.equal(P(s, 'p0').cash, 1700);
  assert.equal(s.phase, 'buy');
});
test('Karte 5: nächster Versorger, neuer Wurf und 10x bei Besitz', () => {
  let s = G();
  give(s, 'p1', [28]);
  s.deck = [5];
  at(s, 'p0', 12);
  ok(E.handle(s, 'p0', { t: 'roll' }, dice(2, 3, 4, 2))); // Ereignis auf 17, dann Versorger 28, neuer Wurf 4+2
  assert.equal(P(s, 'p0').pos, 28);
  assert.equal(P(s, 'p0').cash, 1500 - 60);
  s = G();
  ok(drawCard(s, 'p0', 5, 7));
  assert.equal(P(s, 'p0').pos, 12);
  assert.equal(s.phase, 'buy');
});
test('Karten 6 und 7: Geld von der Bank', () => {
  let s = G();
  ok(drawCard(s, 'p0', 6));
  assert.equal(P(s, 'p0').cash, 1550);
  s = G();
  ok(drawCard(s, 'p0', 7));
  assert.equal(P(s, 'p0').cash, 1650);
  money(s);
});
test('Karten 8 und 9: Zahlung an die Bank', () => {
  let s = G();
  ok(drawCard(s, 'p0', 8));
  assert.equal(P(s, 'p0').cash, 1460);
  s = G();
  ok(drawCard(s, 'p0', 9));
  assert.equal(P(s, 'p0').cash, 1350);
  money(s);
});
test('Karte 10: drei Felder zurück (auch auf Steuerfeld und ins Gefängnis)', () => {
  let s = G();
  ok(drawCard(s, 'p0', 10, 7)); // 7 -> 4 Einkommensabgabe
  assert.equal(P(s, 'p0').pos, 4);
  assert.equal(P(s, 'p0').cash, 1300);
  s = G();
  give(s, 'p0', [14]);
  ok(drawCard(s, 'p0', 10, 17));
  assert.equal(P(s, 'p0').pos, 14);
  assert.equal(P(s, 'p0').cash, 1500);
  s = G();
  ok(drawCard(s, 'p0', 10, 33)); // 33 -> 30 Gehe ins Gefängnis
  assert.equal(P(s, 'p0').jail, 1);
  assert.equal(P(s, 'p0').pos, 10);
  s = G();
  s.deck = [10, 8]; // zieht zuletzt 8
  at(s, 'p0', 31);
  ok(roll(s, 'p0', 2, 3)); // 36 Ereignis (Karte 8, -40)
  assert.equal(P(s, 'p0').cash, 1460);
});
test('Karte 11: Gehe ins Gefängnis (ohne Startgeld)', () => {
  const s = G();
  ok(drawCard(s, 'p0', 11, 36));
  assert.equal(P(s, 'p0').pos, 10);
  assert.equal(P(s, 'p0').jail, 1);
  assert.equal(P(s, 'p0').cash, 1500);
  assert.equal(s.phase, 'manage');
});
test('Karte 12: Freikarte bleibt bei der Person, nicht im Ablagestapel', () => {
  const s = G();
  s.deck = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 12];
  at(s, 'p0', 2);
  ok(roll(s, 'p0', 2, 3));
  assert.equal(P(s, 'p0').freeCards, 1);
  assert.ok(!s.discardPile.includes(12));
  assert.ok(!s.deck.includes(12));
  assert.equal(s.deck.length + s.discardPile.length + 1, 16);
});
test('Karte 13: Hausreparatur 25 je Haus, 100 je Hotel', () => {
  let s = G();
  give(s, 'p0', [1, 3, 6]);
  s.houses[1] = 2; s.houses[3] = 5; s.houses[6] = 3;
  ok(drawCard(s, 'p0', 13));
  assert.equal(P(s, 'p0').cash, 1500 - 5 * 25 - 100);
  s = G();
  ok(drawCard(s, 'p0', 13)); // ohne Häuser: nichts
  assert.equal(P(s, 'p0').cash, 1500);
  money(s);
});
test('Karte 14: alle anderen zahlen 50 an dich', () => {
  const s = G(4);
  ok(drawCard(s, 'p0', 14));
  assert.equal(P(s, 'p0').cash, 1650);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(P(s, id).cash, 1450);
  money(s);
});
test('Karte 15: du zahlst jeder anderen Person 50', () => {
  const s = G(4);
  ok(drawCard(s, 'p0', 15));
  assert.equal(P(s, 'p0').cash, 1350);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(P(s, id).cash, 1550);
  money(s);
});
test('Ereigniskarten: Zahlung an alle mit Zahlungsnot (raise) und Fortsetzung der Reihe', () => {
  const s = G(4);
  P(s, 'p0').cash = 120;
  give(s, 'p0', [6]); // beleihbar, 50
  s.bank += 1380;
  ok(drawCard(s, 'p0', 15));
  assert.equal(s.phase, 'raise'); // p1 und p2 bezahlt (100), p3 fehlen 30
  assert.equal(s.debt.from, 'p0');
  assert.equal(s.debt.to, 'p3');
  assert.equal(E.activePlayer(s).id, 'p0');
  ok(E.handle(s, 'p0', { t: 'mortgage', sq: 6 }));
  assert.equal(s.phase, 'manage');
  assert.equal(P(s, 'p3').cash, 1550);
  money(s);
});
test('Ereigniskarten: "alle zahlen" lässt zahlungsunfähige Personen in raise gehen', () => {
  const s = G(3);
  P(s, 'p1').cash = 20;
  give(s, 'p1', [6]); // +50 beleihbar
  s.bank += 1480;
  ok(drawCard(s, 'p0', 14));
  assert.equal(s.phase, 'raise');
  assert.equal(E.activePlayer(s).id, 'p1');
  bad(E.handle(s, 'p0', { t: 'mortgage', sq: 6 }), /nicht an der Reihe/);
  ok(E.handle(s, 'p1', { t: 'mortgage', sq: 6 }));
  assert.equal(P(s, 'p0').cash, 1600);
  assert.equal(P(s, 'p1').cash, 20);
  assert.equal(s.phase, 'manage');
  money(s);
});
test('Kartenstapel: leerer Stapel wird aus dem Ablagestapel neu gemischt', () => {
  const s = G();
  s.deck = [];
  s.discardPile = [6, 7];
  at(s, 'p0', 2);
  ok(roll(s, 'p0', 2, 3));
  assert.equal(s.deck.length + s.discardPile.length, 2);
  assert.ok(s.card && [6, 7].includes(s.card.id));
});
test('Jede Karte ist über den Stapel erreichbar: 16 Ziehungen lang kein Verlust', () => {
  const s = G(2, { auction: false });
  const rng = mulberry(3);
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    s.phase = 'roll'; s.active = 0; at(s, 'p0', 2);
    P(s, 'p0').cash = 5000; P(s, 'p0').jail = 0; s.bank = s.opts.startMoney * 2 - sum(s);
    s.owners = {}; s.houses = Object.fromEntries(Object.keys(s.houses).map((k) => [k, 0]));
    ok(E.handle(s, 'p0', { t: 'roll' }, dice(2, 3)));
    seen.add(s.card.id);
    if (s.phase === 'buy') ok(E.handle(s, 'p0', { t: 'decline' }));
    assert.equal(s.deck.length + s.discardPile.length + P(s, 'p0').freeCards + P(s, 'p1').freeCards, 16);
  }
  assert.equal(seen.size, 16);
  void rng;
});

// ---------- Gefängnis ----------
test('Gefängnis: Zahlen vor dem Würfeln, danach normal würfeln', () => {
  const s = G();
  P(s, 'p0').jail = 2; at(s, 'p0', 10);
  bad(E.handle(s, 'p1', { t: 'pay_jail' }));
  ok(E.handle(s, 'p0', { t: 'pay_jail' }));
  assert.equal(P(s, 'p0').jail, 0);
  assert.equal(P(s, 'p0').cash, 1450);
  assert.equal(s.phase, 'roll');
  give(s, 'p0', [14]);
  ok(roll(s, 'p0', 1, 3));
  assert.equal(P(s, 'p0').pos, 14);
  money(s);
});
test('Gefängnis: Zahlen nur im Gefängnis und mit genug Geld', () => {
  const s = G();
  bad(E.handle(s, 'p0', { t: 'pay_jail' }), /nicht im Gefängnis/);
  bad(E.handle(s, 'p0', { t: 'use_card' }), /nicht im Gefängnis/);
  P(s, 'p0').jail = 1; P(s, 'p0').cash = 30; s.bank += 1470;
  bad(E.handle(s, 'p0', { t: 'pay_jail' }), /Bargeld/);
  bad(E.handle(s, 'p0', { t: 'use_card' }), /keine Freikarte/);
});
test('Gefängnis: Freikarte', () => {
  const s = G();
  P(s, 'p0').jail = 1; P(s, 'p0').freeCards = 1; at(s, 'p0', 10);
  ok(E.handle(s, 'p0', { t: 'use_card' }));
  assert.equal(P(s, 'p0').jail, 0);
  assert.equal(P(s, 'p0').freeCards, 0);
  assert.ok(s.discardPile.includes(12));
  assert.equal(P(s, 'p0').cash, 1500);
  assert.equal(s.phase, 'roll');
});
test('Gefängnis: Pasch befreit, es wird gezogen, aber kein Zusatzwurf', () => {
  const s = G();
  P(s, 'p0').jail = 1; at(s, 'p0', 10);
  give(s, 'p0', [14]);
  ok(roll(s, 'p0', 2, 2));
  assert.equal(P(s, 'p0').jail, 0);
  assert.equal(P(s, 'p0').pos, 14);
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.active, 1);
});
test('Gefängnis: drei Fehlversuche, danach zahlt man 50 und zieht', () => {
  const s = G(2);
  give(s, 'p0', [13]);
  give(s, 'p1', [3]);
  P(s, 'p0').jail = 1; at(s, 'p0', 10);
  for (const expectJail of [2, 3]) {
    ok(roll(s, 'p0', 1, 2));
    assert.equal(P(s, 'p0').jail, expectJail);
    assert.equal(P(s, 'p0').pos, 10);
    assert.equal(s.phase, 'manage');
    ok(E.handle(s, 'p0', { t: 'end' }));
    at(s, 'p1', 0);
    ok(roll(s, 'p1', 1, 2)); // eigenes Grundstück
    ok(E.handle(s, 'p1', { t: 'end' }));
  }
  assert.equal(s.phase, 'roll');
  ok(roll(s, 'p0', 1, 2)); // dritter Fehlversuch -> zahlt 50 und zieht auf 13
  assert.equal(P(s, 'p0').jail, 0);
  assert.equal(P(s, 'p0').pos, 13);
  assert.equal(P(s, 'p0').cash, 1450);
  money(s);
});
test('Gefängnis: dritter Fehlversuch ohne Bargeld geht über raise und zieht danach', () => {
  const s = G(2);
  P(s, 'p0').jail = 3; at(s, 'p0', 10); P(s, 'p0').cash = 20; s.bank += 1480;
  give(s, 'p0', [6]); // beleihen +50
  give(s, 'p0', [13]);
  ok(roll(s, 'p0', 1, 2));
  assert.equal(s.phase, 'raise');
  ok(E.handle(s, 'p0', { t: 'mortgage', sq: 6 }));
  assert.equal(P(s, 'p0').jail, 0);
  assert.equal(P(s, 'p0').pos, 13);
  assert.equal(P(s, 'p0').cash, 20);
  assert.equal(s.phase, 'manage');
  money(s);
});
test('Gefängnis: im Gefängnis darf man bauen und beleihen', () => {
  const s = G();
  give(s, 'p0', [1, 3]);
  P(s, 'p0').jail = 2; at(s, 'p0', 10);
  ok(roll(s, 'p0', 1, 2));
  ok(E.handle(s, 'p0', { t: 'build', sq: 1 }));
  assert.equal(s.houses[1], 1);
});

// ---------- Bauen ----------
const mono = (s, id, gi) => give(s, id, E.colorGroups[gi]);
const manage = (s, id = 'p0') => { s.phase = 'manage'; s.active = s.players.findIndex((p) => p.id === id); };
test('Bauen: nur bei Gruppenbesitz, nur auf Straßen, nur in manage', () => {
  const s = G();
  manage(s);
  give(s, 'p0', [6, 8]);
  bad(E.handle(s, 'p0', { t: 'build', sq: 6 }), /alle Grundstücke/);
  give(s, 'p0', [9]);
  bad(E.handle(s, 'p0', { t: 'build', sq: 5 }), /Straßen/);
  bad(E.handle(s, 'p0', { t: 'build', sq: 1 }), /gehört dir nicht/);
  bad(E.handle(s, 'p0', { t: 'build', sq: 'x' }));
  bad(E.handle(s, 'p0', { t: 'build' }));
  ok(E.handle(s, 'p0', { t: 'build', sq: 6 }));
  assert.equal(P(s, 'p0').cash, 1450);
  assert.equal(s.supply.houses, 31);
  s.phase = 'roll';
  bad(E.handle(s, 'p0', { t: 'build', sq: 8 }), /nicht möglich/);
});
test('Bauen: gleichmäßig (Unterschied höchstens 1), Hotel erst nach 4 Häusern', () => {
  const s = G();
  manage(s);
  P(s, 'p0').cash = 5000; s.bank = 3000 - 3500 + 1500 + 0; s.bank = s.opts.startMoney * 2 - sum(s);
  mono(s, 'p0', 1);
  ok(E.handle(s, 'p0', { t: 'build', sq: 6 }));
  bad(E.handle(s, 'p0', { t: 'build', sq: 6 }), /gleichmäßig/);
  ok(E.handle(s, 'p0', { t: 'build', sq: 8 }));
  ok(E.handle(s, 'p0', { t: 'build', sq: 9 }));
  for (let r = 2; r <= 4; r++) for (const q of [6, 8, 9]) ok(E.handle(s, 'p0', { t: 'build', sq: q }));
  assert.deepEqual([6, 8, 9].map((q) => s.houses[q]), [4, 4, 4]);
  assert.equal(s.supply.houses, 32 - 12);
  ok(E.handle(s, 'p0', { t: 'build', sq: 6 })); // Hotel
  assert.equal(s.houses[6], 5);
  assert.equal(s.supply.hotels, 11);
  assert.equal(s.supply.houses, 32 - 12 + 4);
  bad(E.handle(s, 'p0', { t: 'build', sq: 6 }), /Hotel/);
  bad(E.handle(s, 'p0', { t: 'build', sq: 6 }));
  money(s);
});
test('Bauen: kein Bauen mit beliehenem Grundstück der Farbe oder zu wenig Geld', () => {
  const s = G();
  manage(s);
  mono(s, 'p0', 0);
  s.mortgaged[3] = true;
  bad(E.handle(s, 'p0', { t: 'build', sq: 1 }), /beliehen/);
  delete s.mortgaged[3];
  P(s, 'p0').cash = 40; s.bank = s.opts.startMoney * 2 - sum(s);
  bad(E.handle(s, 'p0', { t: 'build', sq: 1 }), /Bargeld/);
});
test('Bauen: Vorratsgrenzen (32 Häuser, 12 Hotels)', () => {
  const s = G();
  manage(s);
  P(s, 'p0').cash = 5000; s.bank = s.opts.startMoney * 2 - sum(s);
  mono(s, 'p0', 0);
  s.supply.houses = 0;
  bad(E.handle(s, 'p0', { t: 'build', sq: 1 }), /keine Häuser/);
  s.supply.houses = 1;
  ok(E.handle(s, 'p0', { t: 'build', sq: 1 }));
  bad(E.handle(s, 'p0', { t: 'build', sq: 3 }), /keine Häuser/);
  s.houses[1] = 4; s.houses[3] = 4; s.supply.hotels = 0; s.supply.houses = 0;
  bad(E.handle(s, 'p0', { t: 'build', sq: 1 }), /kein Hotel/);
  s.supply.hotels = 1;
  ok(E.handle(s, 'p0', { t: 'build', sq: 1 }));
  assert.equal(s.supply.houses, 4);
  assert.equal(s.supply.hotels, 0);
  bad(E.handle(s, 'p0', { t: 'build', sq: 3 }), /kein Hotel/);
});
test('Bauen: canBuild spiegelt handle', () => {
  const s = G();
  manage(s);
  mono(s, 'p0', 7);
  assert.equal(E.canBuild(s, 'p0', 37), true);
  assert.equal(E.canBuild(s, 'p1', 37), false);
  assert.equal(E.canBuild(s, 'p0', 5), false);
  s.houses[37] = 1;
  assert.equal(E.canBuild(s, 'p0', 37), false);
  assert.equal(E.canBuild(s, 'p0', 39), true);
});

// ---------- Verkaufen ----------
test('Verkaufen: gleichmäßig, zum halben Preis, Vorrat wächst', () => {
  const s = G();
  manage(s);
  mono(s, 'p0', 1);
  s.houses[6] = 2; s.houses[8] = 1; s.houses[9] = 2; s.supply.houses = 27;
  bad(E.handle(s, 'p0', { t: 'sell', sq: 8 }), /gleichmäßig/);
  ok(E.handle(s, 'p0', { t: 'sell', sq: 6 }));
  assert.equal(P(s, 'p0').cash, 1525);
  assert.equal(s.houses[6], 1);
  assert.equal(s.supply.houses, 28);
  bad(E.handle(s, 'p0', { t: 'sell', sq: 5 }), /Straßen/);
  bad(E.handle(s, 'p0', { t: 'sell', sq: 1 }), /gehört dir nicht/);
  bad(E.handle(s, 'p0', { t: 'sell', sq: 3 }));
  s.bank = s.opts.startMoney * 2 - sum(s);
  money(s);
});
test('Verkaufen: Hotel wird zu 4 Häusern (Vorrat reicht) bzw. weiter abgebaut (Hausmangel)', () => {
  let s = G();
  manage(s);
  mono(s, 'p0', 0);
  s.houses[1] = 5; s.houses[3] = 5; s.supply.hotels = 10; s.supply.houses = 24;
  ok(E.handle(s, 'p0', { t: 'sell', sq: 1 }));
  assert.equal(s.houses[1], 4);
  assert.equal(s.supply.hotels, 11);
  assert.equal(s.supply.houses, 20);
  assert.equal(P(s, 'p0').cash, 1525);
  s = G();
  manage(s);
  mono(s, 'p0', 0);
  s.houses[1] = 5; s.houses[3] = 5; s.supply.hotels = 10; s.supply.houses = 2;
  ok(E.handle(s, 'p0', { t: 'sell', sq: 1 }));
  assert.equal(s.houses[1], 2);
  assert.equal(s.supply.houses, 0);
  assert.equal(P(s, 'p0').cash, 1500 + 3 * 25);
});

// ---------- Hypothek ----------
test('Hypothek: halber Kaufpreis, Rückzahlung +10 %, nicht mit Häusern in der Gruppe', () => {
  const s = G();
  manage(s);
  mono(s, 'p0', 0);
  s.houses[1] = 1; s.supply.houses = 31;
  bad(E.handle(s, 'p0', { t: 'mortgage', sq: 3 }), /Häuser/);
  s.houses[1] = 0; s.supply.houses = 32;
  ok(E.handle(s, 'p0', { t: 'mortgage', sq: 3 }));
  assert.equal(P(s, 'p0').cash, 1530);
  assert.equal(s.mortgaged[3], true);
  bad(E.handle(s, 'p0', { t: 'mortgage', sq: 3 }), /schon beliehen/);
  bad(E.handle(s, 'p0', { t: 'mortgage', sq: 7 }));
  bad(E.handle(s, 'p0', { t: 'unmortgage', sq: 1 }), /nicht beliehen/);
  bad(E.handle(s, 'p1', { t: 'unmortgage', sq: 3 }), /nicht an der Reihe/);
  ok(E.handle(s, 'p0', { t: 'unmortgage', sq: 3 }));
  assert.equal(P(s, 'p0').cash, 1530 - 33);
  assert.equal(s.mortgaged[3], undefined);
  assert.equal(s.bank, 3);
});
test('Hypothek: Auflösen braucht Bargeld; Bahnhof und Versorger beleihbar', () => {
  const s = G();
  manage(s);
  give(s, 'p0', [5, 12]);
  ok(E.handle(s, 'p0', { t: 'mortgage', sq: 5 }));
  ok(E.handle(s, 'p0', { t: 'mortgage', sq: 12 }));
  assert.equal(P(s, 'p0').cash, 1500 + 100 + 75);
  P(s, 'p0').cash = 50;
  bad(E.handle(s, 'p0', { t: 'unmortgage', sq: 5 }), /Bargeld/);
  assert.equal(E.canUnmortgage(s, 'p0', 5), false);
  assert.equal(E.canMortgage(s, 'p0', 5), false);
});

// ---------- Zahlungsnot und Bankrott ----------
test('Zahlungsnot: raise, dann Zahlung sobald das Bargeld reicht', () => {
  const s = G();
  give(s, 'p1', [39]);
  give(s, 'p0', [6, 8]);
  P(s, 'p0').cash = 10; s.bank = s.opts.startMoney * 2 - sum(s);
  at(s, 'p0', 36);
  ok(roll(s, 'p0', 1, 2)); // 39 Miete 50
  assert.equal(s.phase, 'raise');
  assert.deepEqual({ f: s.debt.from, t: s.debt.to, a: s.debt.amount }, { f: 'p0', t: 'p1', a: 50 });
  bad(E.handle(s, 'p0', { t: 'build', sq: 6 }), /nicht möglich/);
  bad(E.handle(s, 'p0', { t: 'end' }));
  bad(E.handle(s, 'p0', { t: 'roll' }));
  bad(E.handle(s, 'p1', { t: 'mortgage', sq: 6 }), /nicht an der Reihe/);
  ok(E.handle(s, 'p0', { t: 'mortgage', sq: 6 })); // +50 -> 60 reicht
  assert.equal(s.phase, 'manage');
  assert.equal(P(s, 'p0').cash, 10);
  assert.equal(P(s, 'p1').cash, 1550);
  assert.equal(s.debt, null);
  money(s);
});
test('Zahlungsnot: Häuser verkaufen in raise', () => {
  const s = G();
  mono(s, 'p0', 0);
  s.houses[1] = 1; s.houses[3] = 1; s.supply.houses = 30;
  give(s, 'p1', [39]);
  s.houses[39] = 5; s.supply.hotels = 11;
  P(s, 'p0').cash = 0; s.bank = s.opts.startMoney * 2 - sum(s);
  at(s, 'p0', 35);
  // 39 hat nur 1 Besitzerin-Feld (37 gehört niemand): Miete = rent[5] = 2000 -> p0 kann nicht zahlen -> sofort bankrott
  ok(roll(s, 'p0', 2, 2));
  assert.equal(P(s, 'p0').out, true);
});
test('Zahlungsnot: Verkauf muss gleichmäßig sein, auch in raise', () => {
  const s = G();
  mono(s, 'p0', 0);
  s.houses[1] = 2; s.houses[3] = 1; s.supply.houses = 29;
  give(s, 'p1', [16]);
  P(s, 'p0').cash = 0; s.bank = s.opts.startMoney * 2 - sum(s);
  at(s, 'p0', 14);
  ok(roll(s, 'p0', 1, 1)); // 16: Miete 14
  assert.equal(s.phase, 'raise');
  bad(E.handle(s, 'p0', { t: 'sell', sq: 3 }), /gleichmäßig/);
  ok(E.handle(s, 'p0', { t: 'sell', sq: 1 })); // +25
  assert.equal(s.phase, 'manage'); // 25 >= 14: bezahlt
  assert.equal(P(s, 'p0').cash, 11);
  assert.equal(P(s, 'p1').cash, 1514);
});
test('Bankrott an eine Person: Grundstücke, Restgeld, Hypothek mit 10 % Zinsen', () => {
  const s = G(3);
  give(s, 'p1', [39]);
  give(s, 'p0', [1, 3, 6]);
  s.mortgaged[6] = true;
  s.houses[1] = 1; s.houses[3] = 1; s.supply.houses = 30;
  P(s, 'p0').cash = 0; P(s, 'p0').freeCards = 1;
  s.houses[39] = 5; s.supply.hotels = 11;
  s.bank = s.opts.startMoney * 3 - sum(s);
  at(s, 'p0', 36);
  const before = P(s, 'p1').cash;
  ok(roll(s, 'p0', 1, 2)); // Miete 2000: liquidation = 25+25+30+30+(6 beliehen) = 110 -> bankrott
  assert.equal(P(s, 'p0').out, true);
  assert.equal(P(s, 'p0').cash, 0);
  assert.equal(P(s, 'p1').freeCards, 1);
  assert.deepEqual(E.ownedBy(s, 'p1'), [1, 3, 6, 39]);
  assert.equal(s.houses[1], 0);
  assert.equal(s.mortgaged[6], true);
  assert.equal(P(s, 'p1').cash, before + 50 - 5); // Häuser 2x25, Zinsen 10 % von 50 = 5
  assert.equal(s.supply.houses, 32);
  assert.equal(s.phase, 'roll');
  assert.equal(s.active, 1);
  assert.deepEqual(s.outOrder, ['p0']);
  money(s);
});
test('Bankrott an die Bank: Grundstücke werden frei, Hypotheken und Häuser verschwinden', () => {
  const s = G(3);
  give(s, 'p0', [1, 3, 6]);
  s.mortgaged[6] = true;
  s.houses[1] = 1; s.supply.houses = 31;
  P(s, 'p0').cash = 60; s.bank = s.opts.startMoney * 3 - sum(s);
  at(s, 'p0', 1);
  ok(roll(s, 'p0', 1, 2)); // Einkommensabgabe 200: 60 + 25 + 30 + 30 = 145 < 200 -> bankrott
  assert.equal(P(s, 'p0').out, true);
  assert.deepEqual(E.ownedBy(s, 'p0'), []);
  assert.equal(Object.keys(s.owners).length, 0);
  assert.equal(s.mortgaged[6], undefined);
  assert.equal(s.houses[1], 0);
  assert.equal(s.supply.houses, 32);
  assert.equal(s.active, 1);
  money(s);
});
test('Bankrott: freiwillig in raise (declare_bankrupt), danach geht es weiter', () => {
  const s = G(3);
  give(s, 'p1', [39]);
  give(s, 'p0', [6, 8]);
  P(s, 'p0').cash = 10; s.bank = s.opts.startMoney * 3 - sum(s);
  at(s, 'p0', 36);
  ok(roll(s, 'p0', 1, 2));
  assert.equal(s.phase, 'raise');
  ok(E.handle(s, 'p0', { t: 'declare_bankrupt' }));
  assert.equal(P(s, 'p0').out, true);
  assert.deepEqual(E.ownedBy(s, 'p1'), [6, 8, 39]);
  assert.equal(P(s, 'p1').cash, 1510);
  assert.equal(s.phase, 'roll');
  assert.equal(s.active, 1);
  bad(E.handle(s, 'p0', { t: 'roll' }), /ausgeschieden/);
  money(s);
});
test('declare_bankrupt nur in raise', () => {
  const s = G();
  bad(E.handle(s, 'p0', { t: 'declare_bankrupt' }), /nicht möglich/);
  manage(s);
  bad(E.handle(s, 'p0', { t: 'declare_bankrupt' }), /nicht möglich/);
});
test('Bankrott: Zahlung an alle, Gläubiger-Warteschlange wird abgebrochen', () => {
  const s = G(3);
  P(s, 'p0').cash = 70; s.bank = s.opts.startMoney * 3 - sum(s);
  ok(drawCard(s, 'p0', 15)); // je 50 an p1 und p2: erste Zahlung ok, zweite unmöglich (20 übrig, nichts beleihbar)
  assert.equal(P(s, 'p0').out, true);
  assert.equal(P(s, 'p2').cash, 1500 + 20);
  assert.equal(P(s, 'p1').cash, 1550);
  assert.equal(s.phase, 'roll');
  assert.equal(s.active, 1);
  money(s);
});

// ---------- Spielende ----------
function autoPlay(s, rng, limit = 5000) {
  let n = 0;
  while (s.phase !== 'over' && n++ < limit) {
    const a = E.activePlayer(s).id;
    const m = { roll: { t: 'roll' }, buy: { t: 'decline' }, auction: { t: 'pass_bid' }, raise: { t: 'declare_bankrupt' }, manage: { t: 'end' } }[s.phase];
    ok(E.handle(s, a, m, rng));
  }
  return n;
}
test('Spielende: nach maxRounds gewinnt das höchste Vermögen', () => {
  const s = G(3, { maxRounds: 2 });
  give(s, 'p1', [39]);
  P(s, 'p0').cash = 1000; P(s, 'p2').cash = 1000; P(s, 'p1').cash = 1000; s.bank = s.opts.startMoney * 3 - 3000;
  autoPlay(s, mulberry(11));
  assert.equal(s.phase, 'over');
  assert.equal(s.result.reason, 'rounds');
  const w = E.ranking(s);
  assert.equal(s.result.winners.length >= 1, true);
  const best = Math.max(...s.players.map((p) => E.netWorth(s, p.id)));
  assert.ok(s.result.winners.every((id) => E.netWorth(s, id) === best));
  assert.equal(w[0].place, 1);
  assert.ok(s.round >= 3);
  bad(E.handle(s, 'p0', { t: 'roll' }), /beendet/);
});
test('Spielende: Runden werden pro Zug-Umlauf gezählt (maxRounds=3, 2 Personen)', () => {
  const s = G(2, { maxRounds: 3 });
  let turns = 0;
  while (s.phase !== 'over' && turns < 100) {
    const a = E.activePlayer(s).id;
    if (s.phase === 'roll') { s.doubles = 0; ok(E.handle(s, a, { t: 'roll' }, dice(1, 2))); if (s.phase === 'buy') ok(E.handle(s, a, { t: 'buy' })); if (s.phase === 'auction') break; }
    else if (s.phase === 'manage') { ok(E.handle(s, a, { t: 'end' })); turns++; }
    else break;
  }
  assert.equal(s.phase, 'over');
  assert.equal(turns, 6); // 3 Runden x 2 Personen
});
test('Spielende: maxRounds=0 ist unbegrenzt', () => {
  const s = G(2, { maxRounds: 0 });
  s.round = 500;
  give(s, 'p0', [3]); give(s, 'p1', [3]);
  manage(s);
  ok(E.handle(s, 'p0', { t: 'end' }));
  assert.equal(s.phase, 'roll');
});
test('Spielende: letzte verbleibende Person gewinnt sofort', () => {
  const s = G(2);
  P(s, 'p0').cash = 100; s.bank = s.opts.startMoney * 2 - sum(s);
  at(s, 'p0', 1);
  ok(roll(s, 'p0', 1, 2)); // Steuer 200
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.winners, ['p1']);
  assert.equal(s.result.reason, 'last');
  assert.equal(s.result.ranking[0].id, 'p1');
  assert.equal(s.result.ranking[1].out, true);
  assert.equal(s.result.ranking[1].place, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(s.result)), s.result);
});
test('Vermögen: Bargeld + Kaufpreise (Hypothek abzüglich) + Häuser zum Einkaufspreis', () => {
  const s = G();
  assert.equal(E.netWorth(s, 'p0'), 1500);
  give(s, 'p0', [1, 3, 5]);
  s.houses[1] = 2; s.houses[3] = 5;
  s.mortgaged[5] = true;
  // 1500 + 60 + 60 + 200 - 100 + 2*50 + 5*50
  assert.equal(E.netWorth(s, 'p0'), 1500 + 320 - 100 + 100 + 250);
  assert.equal(E.liquidation(s, "p0"), 1500 + 175 + 30 + 30);
  P(s, 'p0').out = true;
  assert.equal(E.netWorth(s, 'p0'), 0);
});
test('Rangliste: Plätze, Gleichstand, Ausgeschiedene am Ende (später ausgeschieden = besser)', () => {
  const s = G(4);
  P(s, 'p1').cash = 2000; P(s, 'p2').cash = 2000;
  P(s, 'p3').out = true; s.outOrder.push('p3');
  const r = E.ranking(s);
  assert.deepEqual(r.map((x) => x.place), [1, 1, 3, 4]);
  assert.equal(r[3].id, 'p3');
});

// ---------- Ungültige Nachrichten ----------
test('Ungültige Nachrichten: falsche Person, falsche Phase, Unsinn', () => {
  const s = G();
  bad(E.handle(s, 'p1', { t: 'roll' }), /nicht an der Reihe/);
  bad(E.handle(s, 'nobody', { t: 'roll' }), /Unbekannte Person/);
  bad(E.handle(s, 'p0', { t: 'buy' }), /nicht möglich/);
  bad(E.handle(s, 'p0', { t: 'end' }), /nicht möglich/);
  bad(E.handle(s, 'p0', { t: 'bid', amount: 10 }), /nicht möglich/);
  bad(E.handle(s, 'p0', { t: 'build', sq: 1 }), /nicht möglich/);
  bad(E.handle(s, 'p0', { t: 'fliegen' }), /Unbekannte Aktion/);
  bad(E.handle(s, 'p0', { t: 'constructor' }), /Unbekannte Aktion/);
  bad(E.handle(s, 'p0', null), /Ungültige/);
  bad(E.handle(s, 'p0', {}), /Ungültige/);
  bad(E.handle(s, 'p0', { t: 5 }), /Ungültige/);
  const seq = s.seq;
  ok(roll(s, 'p0', 1, 2));
  assert.equal(s.seq, seq + 1);
  bad(E.handle(s, 'p0', { t: 'roll' }), /nicht möglich/);
  bad(E.handle(s, 'p0', { t: 'pay_jail' }), /nicht möglich/);
  assert.equal(s.seq, seq + 1); // Fehler zählen nicht
  ok(E.handle(s, 'p0', { t: 'buy' }));
  bad(E.handle(s, 'p0', { t: 'buy' }), /nicht möglich/);
});
test('Zustand bleibt JSON-sicher und lässt sich nach Kopie weiterspielen', () => {
  const s = G(3);
  give(s, 'p0', [1, 3]);
  ok(roll(s, 'p0', 1, 2));
  const c = JSON.parse(JSON.stringify(s));
  assert.deepEqual(c, s);
  ok(E.handle(c, 'p0', { t: 'end' }));
  assert.equal(c.active, 1);
  assert.equal(s.active, 0);
});
test('Spielende: Gleichstand bei gleichem Vermögen gibt mehrere Siegerinnen', () => {
  const s = G(2, { maxRounds: 1 });
  s.phase = 'manage'; s.active = 1;
  ok(E.handle(s, 'p1', { t: 'end' }));
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.winners.sort(), ['p0', 'p1']);
  assert.equal(E.ranking(s)[0].place, 1);
  assert.equal(E.ranking(s)[1].place, 1);
});

// ---------- Zufallspartien ----------
function randomAction(s, rng) {
  const me = E.activePlayer(s);
  const all = E.SQUARES.map((q) => q.i);
  const legal = (fn) => all.filter((q) => fn(s, me.id, q));
  switch (s.phase) {
    case 'roll':
      if (me.jail > 0) { const r = rng(); if (r < 0.15 && me.cash >= 50) return { t: 'pay_jail' }; if (r < 0.3 && me.freeCards > 0) return { t: 'use_card' }; }
      return { t: 'roll' };
    case 'buy': return rng() < 0.5 ? { t: 'buy' } : { t: 'decline' };
    case 'auction': {
      const bid = s.auction.high + 10 * (1 + Math.floor(rng() * 3));
      return rng() < 0.5 && bid <= me.cash ? { t: 'bid', amount: bid } : { t: 'pass_bid' };
    }
    case 'raise': {
      const opts = [...legal(E.canSell).map((q) => ({ t: 'sell', sq: q })), ...legal(E.canMortgage).map((q) => ({ t: 'mortgage', sq: q }))];
      return opts.length && rng() < 0.97 ? pick(opts, rng) : { t: 'declare_bankrupt' };
    }
    case 'manage': {
      if (rng() < 0.5) return { t: 'end' };
      const opts = [
        ...legal(E.canBuild).map((q) => ({ t: 'build', sq: q })), ...legal(E.canSell).map((q) => ({ t: 'sell', sq: q })),
        ...legal(E.canMortgage).map((q) => ({ t: 'mortgage', sq: q })), ...legal(E.canUnmortgage).map((q) => ({ t: 'unmortgage', sq: q })),
      ];
      return opts.length ? pick(opts, rng) : { t: 'end' };
    }
  }
  throw new Error('Phase ' + s.phase);
}
function checkInvariants(s) {
  money(s);
  for (const p of s.players) {
    assert.ok(p.cash >= 0, 'Bargeld nie negativ: ' + p.cash);
    assert.ok(p.pos >= 0 && p.pos < 40);
    assert.ok([0, 1, 2, 3].includes(p.jail));
    if (p.out) assert.ok(p.cash === 0 && !E.ownedBy(s, p.id).length);
  }
  const alive = new Set(s.players.filter((p) => !p.out).map((p) => p.id));
  let h = 0, t = 0;
  for (const [k, v] of Object.entries(s.owners)) {
    assert.ok(E.SQUARES[k] && ['street', 'station', 'utility'].includes(E.SQUARES[k].type));
    assert.ok(alive.has(v), 'Besitzer lebt');
  }
  for (const [k, l] of Object.entries(s.houses)) {
    assert.ok(l >= 0 && l <= 5);
    if (l > 0) assert.ok(s.owners[k] !== undefined, 'Haus nur auf besessenem Grundstück');
    if (l === 5) t++; else h += l;
  }
  for (const k of Object.keys(s.mortgaged)) assert.ok(s.owners[k] !== undefined);
  assert.equal(s.supply.houses + h, 32, 'Häuservorrat');
  assert.equal(s.supply.hotels + t, 12, 'Hotelvorrat');
  const held = s.players.reduce((n, p) => n + p.freeCards, 0);
  assert.equal(new Set(s.deck).size + s.discardPile.length + held, 16, 'Kartenbilanz');
}
test('200 Zufallspartien enden immer; Geldbilanz, Besitz, Vorräte und Karten bleiben konsistent', () => {
  let rounds = 0, bankrupts = 0, raises = 0, auctions = 0, builds = 0;
  for (let g = 0; g < 200; g++) {
    const rng = mulberry(1000 + g);
    const n = 2 + (g % 5);
    const s = E.createGame(ids(n), { maxRounds: g % 3 === 0 ? 0 : 25 + (g % 20), auction: g % 7 !== 0 }, rng);
    let steps = 0;
    while (s.phase !== 'over') {
      if (steps++ > 60000) assert.fail('Endlosspiel in Partie ' + g);
      if (s.opts.maxRounds === 0 && s.round > 200) break; // unbegrenzte Partien dürfen aufhören
      const a = E.activePlayer(s).id;
      const m = randomAction(s, rng);
      if (m.t === 'build') builds++;
      if (s.phase === 'raise') raises++;
      if (s.phase === 'auction') auctions++;
      const r = E.handle(s, a, m, rng);
      assert.equal(r.ok, true, `${JSON.stringify(m)} -> ${r.error} (Phase ${s.phase})`);
      checkInvariants(s);
    }
    bankrupts += s.players.filter((p) => p.out).length;
    rounds += s.round;
    if (s.phase === 'over') {
      assert.ok(s.result.winners.length >= 1);
      if (s.result.reason === 'last') assert.equal(s.players.filter((p) => !p.out).length, 1);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  }
  console.log(`  200 Partien: Ø Runden ${(rounds / 200).toFixed(1)}, Bankrotte ${bankrupts}, raise-Schritte ${raises}, Auktionsschritte ${auctions}, Bauaktionen ${builds}`);
  assert.ok(bankrupts > 10 && raises > 20 && auctions > 100 && builds > 20, 'Partien decken die Sonderfälle ab');
});
