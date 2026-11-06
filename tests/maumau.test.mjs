import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../maumau/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const C = (s, r) => ({ s, r }); // s: 0 Kreuz 1 Pik 2 Herz 3 Karo, r: 0=7 1=8 2=9 3=10 4=B 5=D 6=K 7=A
const key = (c) => c.s * 8 + c.r;

// Zustand mit festen Karten bauen
function setup({ n = 3, hands, top = C(2, 2), opts = {}, deck, wish = null, seed = 1 } = {}) {
  const g = M.createGame(players(n), opts, seeded(seed));
  if (hands) hands.forEach((h, i) => { g.players[i].hand = h.map((c) => ({ ...c })); });
  g.discard = [{ ...top }];
  if (deck) g.deck = deck.map((c) => ({ ...c }));
  g.wish = wish;
  return g;
}
const snap = (g) => JSON.stringify(g);

test('Blatt: 32 Karten bei 2-4 Personen, 64 bei 5-6, 5 Karten pro Hand, Startkarte', () => {
  for (let n = 2; n <= 6; n++) {
    const g = M.createGame(players(n), {}, seeded(n));
    const total = g.players.reduce((s, p) => s + p.hand.length, 0) + g.deck.length + g.discard.length;
    assert.equal(total, n >= 5 ? 64 : 32, 'n=' + n);
    assert.equal(g.decks, n >= 5 ? 2 : 1);
    for (const p of g.players) assert.equal(p.hand.length, 5);
    assert.equal(g.discard.length, 1);
    assert.equal(g.deck.length, (n >= 5 ? 64 : 32) - 5 * n - 1);
    // jede Karte kommt genau 1x (bzw. 2x) vor
    const cnt = new Map();
    for (const c of [...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)]) cnt.set(key(c), (cnt.get(key(c)) || 0) + 1);
    assert.equal(cnt.size, 32);
    for (const v of cnt.values()) assert.equal(v, n >= 5 ? 2 : 1);
    assert.equal(g.active, 0);
    assert.equal(g.phase, 'play');
    assert.equal(g.round, 1);
  }
});

test('createGame: ungültige Spielerzahl wirft, Optionen werden normalisiert, hostId', () => {
  assert.throws(() => M.createGame(players(1)));
  assert.throws(() => M.createGame(players(7)));
  assert.throws(() => M.createGame('x'));
  const g = M.createGame(players(2), { ace: 1, auto: 0, foo: 3 }, seeded(2), 'p1');
  assert.deepEqual(g.opts, { ace: true, auto: false, hints: false });
  assert.equal(g.hostId, 'p1');
  assert.equal(M.createGame(players(2), undefined, seeded(2)).hostId, 'p0');
});

test('Zustand ist reines JSON', () => {
  const g = M.createGame(players(4), { ace: true }, seeded(3));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('Deterministisch bei gleichem rng', () => {
  assert.equal(snap(M.createGame(players(3), {}, seeded(9))), snap(M.createGame(players(3), {}, seeded(9))));
});

test('Legeregeln: Farbe oder Wert, Bube immer', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5), C(0, 2), C(1, 6), C(0, 4), C(3, 3)], [C(0, 0)], [C(0, 0)]] });
  assert.ok(M.playable(g, C(2, 5))); // gleiche Farbe
  assert.ok(M.playable(g, C(0, 2))); // gleicher Wert
  assert.ok(!M.playable(g, C(1, 6)));
  assert.ok(M.playable(g, C(0, 4))); // Bube
  assert.ok(!M.playable(g, C(3, 3)));
  assert.equal(M.legalCards(g, 'p0').length, 3);
  const bad = M.handle(g, 'p0', { t: 'play', card: C(1, 6) });
  assert.equal(bad.ok, false);
  const ok = M.handle(g, 'p0', { t: 'play', card: C(2, 5) });
  assert.equal(ok.ok, true);
  assert.deepEqual(g.discard.at(-1), C(2, 5));
  assert.equal(g.players[0].hand.length, 4);
  assert.equal(g.active, 1);
});

test('Spielen ist Pflicht: Ziehen mit passender Karte verboten', () => {
  const g = setup({ hands: [[C(2, 5), C(1, 6)], [C(0, 0)], [C(0, 0)]] });
  const before = snap(g);
  const r = M.handle(g, 'p0', { t: 'draw' });
  assert.equal(r.ok, false);
  assert.equal(snap(g), before);
});

test('Ziehen: passt die Karte, darf man sie spielen oder behalten', () => {
  const g = setup({ hands: [[C(1, 6), C(1, 5)], [C(0, 0), C(0, 1)], [C(0, 0), C(0, 1)]], deck: [C(3, 3), C(2, 7)] });
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).fits, true); // Herz-Ass vom Stapelende
  assert.equal(g.active, 0);
  assert.equal(g.turn.drew, true);
  assert.deepEqual(g.turn.drawn, C(2, 7));
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, false); // nicht noch einmal
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(1, 6) }).ok, false); // nur passende
  const g2 = JSON.parse(JSON.stringify(g));
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(2, 7) }).ok, true);
  assert.equal(g.active, 1);
  assert.equal(M.handle(g2, 'p0', { t: 'pass' }).ok, true);
  assert.equal(g2.active, 1);
  assert.equal(g2.players[0].hand.length, 3);
});

test('Ziehen: passt die Karte nicht, ist die nächste Person dran', () => {
  const g = setup({ hands: [[C(1, 6), C(1, 5)], [C(0, 0), C(0, 1)], [C(0, 0), C(0, 1)]], deck: [C(2, 7), C(3, 3)] });
  const r = M.handle(g, 'p0', { t: 'draw' });
  assert.equal(r.ok, true);
  assert.equal(r.fits, false);
  assert.equal(g.active, 1);
  assert.equal(g.players[0].hand.length, 3);
  assert.equal(M.handle(g, 'p0', { t: 'pass' }).ok, false);
});

test('pass ohne Ziehen ist ungültig', () => {
  const g = setup({ hands: [[C(1, 6)], [C(0, 0)], [C(0, 0)]] });
  assert.equal(M.handle(g, 'p0', { t: 'pass' }).ok, false);
});

test('leerer Stapel: Ablagestapel (ohne oberste Karte) wird neu gemischt', () => {
  const g = setup({ hands: [[C(1, 6), C(1, 5)], [C(0, 0)], [C(0, 0)]], deck: [] });
  g.discard = [C(0, 1), C(0, 2), C(3, 5), C(2, 2)];
  const r = M.handle(g, 'p0', { t: 'draw' }, seeded(5));
  assert.equal(r.ok, true);
  assert.deepEqual(g.discard, [C(2, 2)]);
  assert.equal(g.players[0].hand.length, 3);
  assert.equal(g.deck.length, 2);
  assert.ok(g.recap.some((l) => /neu gemischt/.test(l)));
});

test('nichts mehr zu ziehen: man setzt aus', () => {
  const g = setup({ hands: [[C(1, 6), C(1, 5)], [C(0, 0)], [C(0, 0)]], deck: [] });
  const r = M.handle(g, 'p0', { t: 'draw' });
  assert.equal(r.ok, true);
  assert.equal(r.drew, 0);
  assert.equal(g.active, 1);
  assert.equal(g.players[0].hand.length, 2);
});

test('Stillstand: alle müssen aussetzen -> Runde endet mit geringster Punktzahl', () => {
  const g = setup({ hands: [[C(1, 6), C(1, 5)], [C(0, 3), C(0, 1)], [C(1, 1)]], deck: [] });
  M.handle(g, 'p0', { t: 'draw' });
  M.handle(g, 'p1', { t: 'draw' });
  assert.equal(g.phase, 'play');
  M.handle(g, 'p2', { t: 'draw' });
  assert.equal(g.phase, 'over');
  assert.equal(g.result.blocked, true);
  assert.equal(g.result.winner, 'p2');
  assert.equal(g.players[2].wins, 1);
  assert.equal(g.result.points.p2, 0);
  assert.equal(g.players[0].points, 20);
});

test('Sieben: nächste Person muss zwei Karten ziehen und setzt aus', () => {
  const g = setup({ top: C(0, 5), hands: [[C(0, 0), C(1, 6), C(3, 3)], [C(2, 2), C(1, 2), C(1, 3)], [C(3, 6), C(3, 7), C(1, 1)]], deck: [C(2, 6), C(3, 1), C(1, 7), C(0, 7)] });
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(0, 0) }).ok, true);
  assert.equal(g.active, 1);
  assert.equal(g.turn.forced, 'seven');
  // keine Karte spielen, nicht aussetzen, nicht behalten
  const before = snap(g);
  for (const m of [{ t: 'play', card: C(2, 2) }, { t: 'skip' }, { t: 'pass' }]) {
    assert.equal(M.handle(g, 'p1', m).ok, false);
    assert.equal(snap(g), before);
  }
  assert.equal(M.handle(g, 'p1', { t: 'draw' }).ok, true);
  assert.equal(g.players[1].hand.length, 5);
  assert.equal(g.active, 2); // p1 hat ausgesetzt
  assert.equal(g.turn.forced, null);
});

test('Sieben darf nicht gekontert werden (kein Stapeln)', () => {
  const g = setup({ top: C(0, 5), hands: [[C(0, 0), C(1, 6)], [C(2, 0), C(1, 2)], [C(3, 6)]], deck: [C(2, 6), C(3, 1), C(1, 7)] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 0) });
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(2, 0) }).ok, false);
});

test('Acht: nächste Person setzt aus (skip)', () => {
  const g = setup({ top: C(0, 5), hands: [[C(0, 1), C(1, 6)], [C(2, 2), C(1, 2)], [C(3, 6), C(0, 3)]] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 1) });
  assert.equal(g.turn.forced, 'eight');
  assert.equal(g.active, 1);
  assert.equal(M.handle(g, 'p1', { t: 'draw' }).ok, false);
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(2, 2) }).ok, false);
  assert.equal(M.handle(g, 'p1', { t: 'skip' }).ok, true);
  assert.equal(g.active, 2);
  assert.equal(g.players[1].hand.length, 2);
  assert.equal(M.handle(g, 'p2', { t: 'skip' }).ok, false);
});

test('Bube: auf jede Karte, Farbwunsch Pflicht, nächste Person muss bedienen oder Bube', () => {
  const g = setup({ top: C(2, 2), hands: [[C(0, 4), C(1, 6), C(3, 0)], [C(0, 2), C(3, 3), C(1, 4)], [C(2, 7), C(0, 6)]] });
  const before = snap(g);
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(0, 4) }).ok, false); // ohne Wunsch
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(0, 4), wish: 7 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(0, 4), wish: 1.5 }).ok, false);
  assert.equal(snap(g), before);
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(0, 4), wish: 3 }).ok, true);
  assert.equal(g.wish, 3);
  assert.ok(M.playable(g, C(3, 3)));
  assert.ok(!M.playable(g, C(0, 2))); // gleicher Wert wie Kreuz-Bube zählt nicht: Wunsch gilt
  assert.ok(M.playable(g, C(1, 4))); // Bube geht immer
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(0, 2) }).ok, false);
  assert.equal(M.handle(g, 'p1', { t: 'play', card: C(3, 3) }).ok, true);
  assert.equal(g.wish, null);
  // Wunsch bleibt nach Ziehen erhalten
  const h = setup({ top: C(2, 2), hands: [[C(0, 4), C(1, 6), C(3, 0)], [C(0, 2), C(1, 3)], [C(2, 7)]], deck: [C(0, 7), C(0, 6)] });
  M.handle(h, 'p0', { t: 'play', card: C(0, 4), wish: 3 });
  assert.equal(M.handle(h, 'p1', { t: 'draw' }).ok, true);
  assert.equal(h.wish, 3);
});

test('Bube zählt auf einen Buben als Startkarte normal (Startkarte ohne Wirkung)', () => {
  const g = setup({ top: C(1, 4), hands: [[C(1, 0), C(2, 6)], [C(0, 0)], [C(0, 0)]] });
  assert.equal(g.wish, null);
  assert.ok(M.playable(g, C(1, 0)));
  assert.ok(!M.playable(g, C(2, 6)));
});

test('Ass ohne Option: normale Karte, Richtung bleibt', () => {
  const g = setup({ top: C(0, 5), hands: [[C(0, 7), C(1, 6)], [C(0, 0)], [C(0, 0)]] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 7) });
  assert.equal(g.dir, 1);
  assert.equal(g.active, 1);
});

test('Ass mit Option dreht die Richtung (ab 3 Personen)', () => {
  const g = setup({ n: 4, opts: { ace: true }, top: C(0, 5), hands: [[C(0, 7), C(1, 6)], [C(0, 0)], [C(0, 0)], [C(0, 0)]] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 7) });
  assert.equal(g.dir, -1);
  assert.equal(g.active, 3);
  const r = M.handle(g, 'p3', { t: 'play', card: C(0, 0) });
  assert.equal(r.ok, true);
  assert.equal(g.active, 2); // weiter gegen den Uhrzeigersinn
});

test('Ass mit Option bei 2 Personen: ohne Wirkung', () => {
  const g = setup({ n: 2, opts: { ace: true }, top: C(0, 5), hands: [[C(0, 7), C(1, 6)], [C(0, 0)]] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 7) });
  assert.equal(g.dir, 1);
  assert.equal(g.active, 1);
});

test('Sieben/Acht mit gedrehter Richtung gehen an die richtige Person', () => {
  const g = setup({ n: 4, opts: { ace: true }, top: C(0, 5), hands: [[C(0, 7), C(1, 6)], [C(0, 0)], [C(0, 0)], [C(0, 0), C(0, 1)]] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 7) });
  M.handle(g, 'p3', { t: 'play', card: C(0, 1) });
  assert.equal(g.active, 2);
  assert.equal(g.turn.forced, 'eight');
});

test('Mau: wer auf eine Karte kommt und nicht ruft, bekommt 2 Karten, sobald die nächste Person handelt', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5), C(1, 6)], [C(2, 3), C(2, 6), C(1, 1)], [C(0, 0)]], deck: [C(3, 1), C(3, 2), C(3, 3), C(3, 4)] });
  M.handle(g, 'p0', { t: 'play', card: C(2, 5) });
  assert.deepEqual(g.mau, { pid: 'p0', called: false });
  M.handle(g, 'p1', { t: 'play', card: C(2, 3) });
  assert.equal(g.mau, null);
  assert.equal(g.players[0].hand.length, 3);
  assert.ok(g.recap.some((l) => /„Mau!“ vergessen/.test(l)));
});

test('Mau gerufen (separat): keine Strafe; zu spät oder doppelt ist ungültig', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5), C(1, 6)], [C(2, 3), C(2, 6)], [C(0, 0)]], deck: [C(3, 1), C(3, 2), C(3, 3)] });
  assert.equal(M.handle(g, 'p0', { t: 'mau' }).ok, false); // noch nicht fällig
  M.handle(g, 'p0', { t: 'play', card: C(2, 5) });
  assert.equal(M.handle(g, 'p1', { t: 'mau' }).ok, false); // falsche Person
  assert.equal(M.handle(g, 'p0', { t: 'mau' }).ok, true);
  assert.equal(M.handle(g, 'p0', { t: 'mau' }).ok, false);
  M.handle(g, 'p1', { t: 'play', card: C(2, 3) });
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(M.handle(g, 'p0', { t: 'mau' }).ok, false); // schon vorbei
});

test('Mau mit call:true beim Legen oder Option „automatisch“', () => {
  const mk = (opts) => setup({ opts, top: C(2, 2), hands: [[C(2, 5), C(1, 6)], [C(2, 3), C(2, 6)], [C(0, 0)]], deck: [C(3, 1), C(3, 2), C(3, 3)] });
  const a = mk({});
  M.handle(a, 'p0', { t: 'play', card: C(2, 5), call: true });
  assert.equal(a.mau.called, true);
  const b = mk({ auto: true });
  M.handle(b, 'p0', { t: 'play', card: C(2, 5) });
  assert.equal(b.mau.called, true);
  M.handle(b, 'p1', { t: 'play', card: C(2, 3) });
  assert.equal(b.players[0].hand.length, 1);
});

test('Mau-Strafe wird auch beim Ziehen und Aussetzen der nächsten Person fällig', () => {
  const g = setup({ top: C(0, 5), hands: [[C(0, 1), C(1, 6)], [C(2, 2), C(1, 2)], [C(3, 6), C(0, 3)]], deck: [C(3, 1), C(3, 2), C(3, 3)] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 1) }); // Acht -> p1 muss aussetzen, p0 hat 1 Karte
  assert.equal(g.mau.called, false);
  M.handle(g, 'p1', { t: 'skip' });
  assert.equal(g.players[0].hand.length, 3);
  const h = setup({ top: C(0, 5), hands: [[C(0, 0), C(1, 6)], [C(2, 2), C(1, 2)], [C(3, 6), C(0, 3)]], deck: [C(3, 1), C(3, 2), C(3, 3), C(3, 4)] });
  M.handle(h, 'p0', { t: 'play', card: C(0, 0) }); // Sieben
  M.handle(h, 'p1', { t: 'draw' });
  assert.equal(h.players[0].hand.length, 3);
});

test('Mau Mau: letzte Karte ohne Ruf -> 2 Karten Strafe, Spiel geht weiter', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5)], [C(2, 3), C(2, 6)], [C(0, 0), C(0, 1)]], deck: [C(3, 1), C(3, 2), C(3, 3)] });
  const r = M.handle(g, 'p0', { t: 'play', card: C(2, 5) });
  assert.equal(r.ok, true);
  assert.equal(g.phase, 'play');
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(g.active, 1);
  assert.ok(g.recap.some((l) => /„Mau Mau!“ vergessen/.test(l)));
  assert.equal(g.mau, null);
});

test('Mau Mau gerufen: Runde gewonnen, Punkte der anderen', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5)], [C(2, 3), C(0, 4)], [C(0, 0), C(1, 7)]] });
  const r = M.handle(g, 'p0', { t: 'play', card: C(2, 5), call: true });
  assert.equal(r.ok, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.winner, 'p0');
  assert.deepEqual(g.result.points, { p0: 0, p1: 30, p2: 18 });
  assert.equal(g.players[0].wins, 1);
  assert.equal(g.players[1].points, 30);
  assert.equal(M.handle(g, 'p1', { t: 'draw' }).ok, false);
});

test('Mau Mau mit Option „automatisch“ ohne call', () => {
  const g = setup({ opts: { auto: true }, top: C(2, 2), hands: [[C(2, 5)], [C(2, 3)], [C(0, 0)]] });
  M.handle(g, 'p0', { t: 'play', card: C(2, 5) });
  assert.equal(g.phase, 'over');
});

test('Letzter Bube gewinnt ohne Wunsch; mit Strafe braucht er einen Wunsch', () => {
  const g = setup({ top: C(2, 2), hands: [[C(0, 4)], [C(2, 3)], [C(0, 0)]] });
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(0, 4), call: true }).ok, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.wish, null);
  const h = setup({ top: C(2, 2), hands: [[C(0, 4)], [C(2, 3)], [C(0, 0)]], deck: [C(3, 1), C(3, 2), C(3, 3)] });
  assert.equal(M.handle(h, 'p0', { t: 'play', card: C(0, 4) }).ok, false);
  assert.equal(M.handle(h, 'p0', { t: 'play', card: C(0, 4), wish: 1 }).ok, true);
  assert.equal(h.phase, 'play');
  assert.equal(h.wish, 1);
});

test('Gewinner mit letzter Sieben/Acht: Runde endet, keine Wirkung', () => {
  const g = setup({ top: C(0, 5), hands: [[C(0, 0)], [C(2, 3), C(0, 1)], [C(0, 0)]] });
  M.handle(g, 'p0', { t: 'play', card: C(0, 0), call: true });
  assert.equal(g.phase, 'over');
  assert.equal(g.turn.forced, null);
});

test('Punkte: 7-10 nach Augen, Bube 20, Dame/König 10, Ass 11', () => {
  assert.equal(M.handPoints([C(0, 0), C(0, 1), C(0, 2), C(0, 3)]), 34);
  assert.equal(M.handPoints([C(0, 4), C(0, 5), C(0, 6), C(0, 7)]), 51);
});

test('Serie: nextRound behält Stand, rotiert Startperson, nur der Gastgeber', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5)], [C(2, 3), C(0, 4)], [C(0, 0), C(1, 7)]] });
  g.hostId = 'p2';
  assert.equal(M.handle(g, 'p2', { t: 'next' }, seeded(4)).ok, false); // Runde läuft noch
  M.handle(g, 'p0', { t: 'play', card: C(2, 5), call: true });
  assert.equal(M.handle(g, 'p1', { t: 'next' }, seeded(4)).ok, false);
  assert.equal(g.phase, 'over');
  const wins = g.players.map((p) => p.wins);
  const pts = g.players.map((p) => p.points);
  assert.equal(M.handle(g, 'p2', { t: 'next' }, seeded(4)).ok, true);
  assert.equal(g.phase, 'play');
  assert.equal(g.round, 2);
  assert.equal(g.active, 1);
  assert.equal(g.starter, 1);
  assert.deepEqual(g.players.map((p) => p.wins), wins);
  assert.deepEqual(g.players.map((p) => p.points), pts);
  for (const p of g.players) assert.equal(p.hand.length, 5);
  assert.equal(g.deck.length + g.discard.length + 15, 32);
  assert.equal(g.result, null);
  assert.equal(M.standings(g)[0].id, 'p0');
});

test('Startperson rotiert über alle Runden', () => {
  const g = M.createGame(players(3), {}, seeded(1));
  const starts = [g.active];
  for (let i = 0; i < 3; i++) { g.phase = 'over'; M.nextRound(g, seeded(i + 5)); starts.push(g.active); }
  assert.deepEqual(starts, [0, 1, 2, 0]);
});

test('Ungültige Nachrichten ändern nie den Zustand', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5), C(1, 6)], [C(2, 3), C(2, 6)], [C(0, 0)]] });
  const before = snap(g);
  const bad = [
    null, undefined, 5, 'play', [], {}, { t: 5 }, { t: 'foo' }, { t: 'play' }, { t: 'play', card: null }, { t: 'play', card: { s: 9, r: 1 } },
    { t: 'play', card: { s: 'a', r: 1 } }, { t: 'play', card: { s: 0.5, r: 1 } }, { t: 'play', card: C(3, 7) }, { t: 'play', card: C(1, 6) },
    { t: 'play', card: C(2, 5), call: 'ja' }, { t: 'play', card: C(2, 5), wish: 'x' }, { t: 'draw' }, { t: 'pass' }, { t: 'skip' }, { t: 'mau' }, { t: 'next' },
  ];
  for (const m of bad) { const r = M.handle(g, 'p0', m); assert.equal(r.ok, false, JSON.stringify(m)); assert.equal(typeof r.error, 'string'); assert.equal(snap(g), before, JSON.stringify(m)); }
  // falsche Person / Unbekannte
  for (const pid of ['p1', 'p2', 'nobody', undefined, null]) {
    for (const m of [{ t: 'play', card: C(2, 3) }, { t: 'draw' }, { t: 'skip' }]) {
      assert.equal(M.handle(g, pid, m).ok, false);
      assert.equal(snap(g), before);
    }
  }
  assert.equal(M.handle(null, 'p0', { t: 'draw' }).ok, false);
  assert.equal(M.handle({}, 'p0', { t: 'draw' }).ok, false);
});

test('Spieler spielt Karte, die er nicht hat -> Fehler', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5)], [C(2, 3)], [C(0, 0)]] });
  const before = snap(g);
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(2, 6) }).ok, false);
  assert.equal(snap(g), before);
});

test('Doppelte Karten (zwei Blätter): eine davon spielen', () => {
  const g = setup({ n: 5, top: C(2, 2), hands: [[C(2, 5), C(2, 5), C(1, 6)], [C(0, 0)], [C(0, 0)], [C(0, 0)], [C(0, 0)]] });
  assert.equal(M.legalCards(g, 'p0').length, 1);
  assert.equal(M.handle(g, 'p0', { t: 'play', card: C(2, 5) }).ok, true);
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(g.players[0].hand.filter((c) => c.s === 2 && c.r === 5).length, 1);
});

test('Strafziehen bei leerem Stapel mischt oder zieht weniger', () => {
  const g = setup({ top: C(2, 2), hands: [[C(2, 5), C(1, 6)], [C(2, 3), C(2, 6)], [C(0, 0)]], deck: [] });
  g.discard = [C(0, 1), C(0, 2), C(2, 2)];
  M.handle(g, 'p0', { t: 'play', card: C(2, 5) });
  M.handle(g, 'p1', { t: 'play', card: C(2, 3) });
  assert.equal(g.players[0].hand.length, 3);
});

// ---------- Zufallspartien ----------
function randomGame(n, opts, seed) {
  const rng = seeded(seed);
  const g = M.createGame(players(n), opts, rng);
  const total = n >= 5 ? 64 : 32;
  let steps = 0;
  while (g.phase === 'play' && steps++ < 5000) {
    const ap = M.activePlayer(g);
    let msg;
    if (g.turn.forced === 'seven') msg = { t: 'draw' };
    else if (g.turn.forced === 'eight') msg = { t: 'skip' };
    else {
      const legal = M.legalCards(g, ap.id);
      if (legal.length) {
        const c = legal[Math.floor(rng() * legal.length)];
        msg = { t: 'play', card: c, wish: Math.floor(rng() * 4), call: rng() < 0.7 };
      } else if (g.turn.drew) msg = { t: 'pass' };
      else msg = { t: 'draw' };
    }
    const r = M.handle(g, ap.id, msg, rng);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
    const count = g.deck.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
    assert.equal(count, total, 'Kartensumme');
    assert.ok(g.discard.length >= 1);
  }
  assert.equal(g.phase, 'over', `Partie endet (n=${n}, seed=${seed})`);
  assert.ok(g.result.winner);
  return g;
}

test('Zufallspartien: 2-6 Personen, mit und ohne Option, enden immer', () => {
  let seed = 1;
  for (let n = 2; n <= 6; n++) {
    for (const opts of [{}, { ace: true }, { auto: true }, { ace: true, auto: true }]) {
      for (let i = 0; i < 40; i++) {
        const g = randomGame(n, opts, seed++);
        assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
      }
    }
  }
});

test('Mehrere Runden hintereinander: Stand summiert sich', () => {
  const rng = seeded(77);
  const g = M.createGame(players(3), {}, rng);
  for (let round = 1; round <= 5; round++) {
    let steps = 0;
    while (g.phase === 'play' && steps++ < 3000) {
      const ap = M.activePlayer(g);
      let msg;
      if (g.turn.forced === 'seven') msg = { t: 'draw' };
      else if (g.turn.forced === 'eight') msg = { t: 'skip' };
      else {
        const legal = M.legalCards(g, ap.id);
        msg = legal.length ? { t: 'play', card: legal[0], wish: 0, call: true } : g.turn.drew ? { t: 'pass' } : { t: 'draw' };
      }
      assert.equal(M.handle(g, ap.id, msg, rng).ok, true);
    }
    assert.equal(g.phase, 'over');
    assert.equal(g.players.reduce((s, p) => s + p.wins, 0), round);
    assert.equal(M.handle(g, 'p0', { t: 'next' }, rng).ok, true);
  }
  assert.equal(g.round, 6);
});
