import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../farbkarten/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mk = (n = 3, opts = {}, seed = 1) => E.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), opts, seedRng(seed));
const ids = (n) => Array.from({ length: n }, (_, i) => 'p' + i);
// Lage von Hand einrichten: top = oberste Karte, color = gültige Farbe, hands = Karten je Person
function setup(g, { top = 'R5', color, hands, active = 0, deck, dir = 1 } = {}) {
  g.discard = ['B1', top];
  g.color = color || (top[0] === 'W' ? 'R' : top[0]);
  g.dir = dir; g.active = active; g.mode = 'play'; g.stage = 'play'; g.pending = null; g.drawn = null; g.call = null;
  if (hands) hands.forEach((h, i) => { g.players[i].hand = E.sortHand(h.slice()); });
  if (deck) g.deck = deck.slice();
  return g;
}
const play = (g, pid, card, extra = {}, rng = seedRng(5)) => E.handle(g, pid, { t: 'play', card, ...extra }, rng);
const snapshot = (g) => JSON.stringify(g);
const total = (g) => g.deck.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
const FILL = ['G1', 'G2', 'G3', 'Y4', 'Y5', 'Y6', 'B7', 'B8', 'B9', 'G4']; // Auffüllkarten, passen zu nichts Wichtigem

test('Kartensatz: 108 Karten in der richtigen Verteilung', () => {
  const d = E.fullDeck();
  assert.equal(d.length, 108);
  const cnt = (f) => d.filter(f).length;
  assert.equal(cnt((c) => c === 'W'), 4);
  assert.equal(cnt((c) => c === 'W4'), 4);
  for (const col of E.COLORS) {
    assert.equal(cnt((c) => c === col + '0'), 1);
    for (let v = 1; v <= 9; v++) assert.equal(cnt((c) => c === col + v), 2);
    for (const s of 'SUZ') assert.equal(cnt((c) => c === col + s), 2);
    assert.equal(cnt((c) => c[0] === col), 25);
  }
  assert.ok(d.every((c) => E.isCard(c)));
  assert.equal(E.isCard('X1'), false); assert.equal(E.isCard('R10'), false); assert.equal(E.isCard(5), false); assert.equal(E.isCard('W5'), false);
});

test('Punkte der Karten', () => {
  assert.equal(E.cardPoints('R0'), 0);
  assert.equal(E.cardPoints('G7'), 7);
  assert.equal(E.cardPoints('YS'), 20); assert.equal(E.cardPoints('BU'), 20); assert.equal(E.cardPoints('RZ'), 20);
  assert.equal(E.cardPoints('W'), 50); assert.equal(E.cardPoints('W4'), 50);
  assert.equal(E.handPoints(['R0', 'G7', 'YS', 'W']), 77);
  assert.equal(E.cardName('R5'), 'Rot 5'); assert.equal(E.cardName('BZ'), 'Blau Zwei ziehen'); assert.equal(E.cardName('W4'), 'Joker Vier ziehen');
});

test('Austeilen: 2 bis 6 Personen, je 7 Karten, eine aufgedeckt, nie Vier ziehen als Startkarte', () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 60; seed++) {
      const g = mk(n, {}, seed);
      assert.equal(g.players.length, n);
      const extra = g.discard[0][1] === 'Z' ? 2 : 0; // Zwei ziehen als Startkarte: die erste Person hat schon zwei mehr
      g.players.forEach((p, i) => assert.equal(p.hand.length, 7 + (i === 0 ? extra : 0)));
      assert.equal(g.discard.length, 1);
      assert.equal(g.deck.length, 108 - 7 * n - 1 - extra);
      assert.notEqual(g.discard[0], 'W4');
      assert.equal(total(g), 108);
      assert.equal(new Set([...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)].map(String)).size > 0, true);
    }
  }
  assert.throws(() => mk(1));
  assert.throws(() => mk(7));
  assert.throws(() => E.createGame(null));
});

test('Zufall nur über rng: gleiche Eingabe, gleiches Spiel', () => {
  assert.equal(snapshot(mk(4, {}, 9)), snapshot(mk(4, {}, 9)));
  assert.notEqual(snapshot(mk(4, {}, 9)), snapshot(mk(4, {}, 10)));
});

test('Startkarte: Zahl, Aussetzen, Richtungswechsel, Zwei ziehen, Joker', () => {
  const find = (n, pred) => { for (let s = 1; s < 20000; s++) { const g = mk(n, {}, s); if (pred(g.discard[0])) return g; } throw new Error('nicht gefunden'); };
  let g = find(3, (c) => /^[RYGB][0-9]$/.test(c));
  assert.equal(g.active, 0); assert.equal(g.color, g.discard[0][0]); assert.equal(g.stage, 'play');
  g = find(3, (c) => c[1] === 'S');
  assert.equal(g.active, 1, 'Erste Person wird übersprungen');
  g = find(3, (c) => c[1] === 'U');
  assert.equal(g.dir, -1); assert.equal(g.active, 0, 'Richtung dreht sich, erste Person beginnt');
  g = find(2, (c) => c[1] === 'U');
  assert.equal(g.active, 1, 'zu zweit wirkt Richtungswechsel wie Aussetzen');
  g = find(3, (c) => c[1] === 'Z');
  assert.equal(g.players[0].hand.length, 9); assert.equal(g.active, 1);
  assert.equal(total(g), 108);
  g = find(4, (c) => c === 'W');
  assert.equal(g.stage, 'color'); assert.equal(g.active, 0); assert.equal(g.color, null);
  assert.deepEqual(E.legalCards(g, 0), []);
  assert.equal(E.handle(g, 'p0', { t: 'play', card: g.players[0].hand[0], color: 'R' }).ok, false, 'erst Farbe wählen');
  assert.equal(E.handle(g, 'p1', { t: 'color', color: 'R' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'color', color: 'X' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'color', color: 'G' }).ok, true);
  assert.equal(g.color, 'G'); assert.equal(g.stage, 'play'); assert.equal(g.active, 0);
});

test('Legeregeln: Farbe, Zahl, Symbol, Joker', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R9', 'G5', 'G1', 'YS', 'W'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  const legal = (c) => E.canPlay(g, g.players[0].hand, c);
  assert.ok(legal('R9'), 'gleiche Farbe');
  assert.ok(legal('G5'), 'gleiche Zahl');
  assert.ok(!legal('G1'), 'weder Farbe noch Zahl');
  assert.ok(legal('W'));
  assert.ok(!legal('YS'));
  assert.deepEqual(E.legalCards(g, 0).sort(), ['G5', 'R9', 'W']);
  assert.deepEqual(E.legalCards(g, 1), [], 'nur die aktive Person');
  // Symbol
  setup(g, { top: 'GS', hands: [['YS', 'Y1', 'BS', 'R2'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  assert.deepEqual(E.legalCards(g, 0).sort(), ['BS', 'YS']);
  setup(g, { top: 'RU', hands: [['GU', 'G1', 'BZ'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  assert.deepEqual(E.legalCards(g, 0), ['GU']);
});

test('Joker oben: nur die gewählte Farbe zählt', () => {
  const g = setup(mk(3), { top: 'W', color: 'B', hands: [['B1', 'R1', 'G5', 'W'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  assert.deepEqual(E.legalCards(g, 0).sort(), ['B1', 'W']);
  setup(g, { top: 'W4', color: 'G', hands: [['G9', 'R4', 'W4'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  assert.deepEqual(E.legalCards(g, 0), ['G9'], 'Vier ziehen darf nicht, wenn die Farbe da ist');
});

test('Joker „Vier ziehen“ nur ohne Karte der aktuellen Farbe', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['W4', 'R1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  let r = play(g, 'p0', 'W4', { color: 'B' });
  assert.equal(r.ok, false);
  assert.equal(g.players[0].hand.length, 3);
  setup(g, { top: 'R5', hands: [['W4', 'G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  r = play(g, 'p0', 'W4', { color: 'B' });
  assert.equal(r.ok, true);
  assert.equal(g.color, 'B');
  // Eine Karte gleicher Zahl in anderer Farbe zählt nicht als „Farbe auf der Hand“
  setup(g, { top: 'R5', hands: [['W4', 'G5', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  assert.equal(play(g, 'p0', 'W4', { color: 'B' }).ok, true);
});

test('Farbwahl-Joker: Farbe ist Pflicht und wird gesetzt', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['W', 'G1', 'G2'], ['Y4', 'Y5', 'Y6'], FILL.slice(3, 6)] });
  assert.equal(play(g, 'p0', 'W').ok, false);
  assert.equal(play(g, 'p0', 'W', { color: 'Q' }).ok, false);
  assert.equal(play(g, 'p0', 'W', { color: 'Y' }).ok, true);
  assert.equal(g.color, 'Y'); assert.equal(E.topCard(g), 'W'); assert.equal(g.active, 1);
  assert.deepEqual(E.legalCards(g, 1).sort(), ['Y4', 'Y5', 'Y6']);
});

test('Normale Karte: nächste Person; Richtung rückwärts', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  assert.equal(play(g, 'p0', 'R1').ok, true);
  assert.equal(g.active, 1); assert.equal(g.color, 'R'); assert.equal(E.topCard(g), 'R1');
  setup(g, { top: 'R5', dir: -1, active: 0, hands: [['R1', 'G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  play(g, 'p0', 'R1');
  assert.equal(g.active, 2);
});

test('Aussetzen: nächste Person setzt aus', () => {
  const g = setup(mk(4), { top: 'R5', hands: [['RS', 'G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6), FILL.slice(6, 9)] });
  play(g, 'p0', 'RS');
  assert.equal(g.active, 2);
  // am Ende der Reihe
  setup(g, { top: 'R5', active: 3, hands: [FILL.slice(0, 3), FILL.slice(3, 6), FILL.slice(6, 9), ['RS', 'G1', 'G2']] });
  play(g, 'p3', 'RS');
  assert.equal(g.active, 1);
});

test('Richtungswechsel: ab 3 Personen dreht die Richtung, zu zweit wie Aussetzen', () => {
  const g = setup(mk(4), { top: 'R5', active: 1, hands: [FILL.slice(0, 3), ['RU', 'G1', 'G2'], FILL.slice(3, 6), FILL.slice(6, 9)] });
  play(g, 'p1', 'RU');
  assert.equal(g.dir, -1); assert.equal(g.active, 0);
  setup(g, { top: 'RU', dir: -1, active: 0, hands: [['GU', 'G1', 'G2'], FILL.slice(3, 6), FILL.slice(6, 9), FILL.slice(0, 3)] });
  play(g, 'p0', 'GU');
  assert.equal(g.dir, 1); assert.equal(g.active, 1);
  const h = setup(mk(2), { top: 'R5', hands: [['RU', 'G1', 'G2'], FILL.slice(0, 3)] });
  play(h, 'p0', 'RU');
  assert.equal(h.active, 0, 'zu zweit ist dieselbe Person nochmal dran');
});

test('Zwei ziehen ohne Weitergabe: nächste Person zieht 2 und setzt aus', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['RZ', 'G1', 'G2'], ['Y1', 'RZ'], FILL.slice(3, 6)], deck: ['B1', 'B2', 'B3', 'B4', 'B5'] });
  const before = total(g);
  assert.equal(play(g, 'p0', 'RZ').ok, true);
  assert.equal(g.players[1].hand.length, 4);
  assert.equal(g.active, 2);
  assert.equal(g.pending, null);
  assert.equal(total(g), before);
});

test('Vier ziehen ohne Weitergabe: nächste Person zieht 4 und setzt aus, Farbe gewählt', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['W4', 'G1', 'G2'], ['Y1'], FILL.slice(3, 6)], deck: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] });
  assert.equal(play(g, 'p0', 'W4', { color: 'Y' }).ok, true);
  assert.equal(g.players[1].hand.length, 5);
  assert.equal(g.active, 2); assert.equal(g.color, 'Y');
});

test('Zu zweit: Zwei ziehen = Gegner zieht und die Person ist gleich wieder dran', () => {
  const g = setup(mk(2), { top: 'R5', hands: [['RZ', 'G1', 'G2'], FILL.slice(0, 3)], deck: ['B1', 'B2', 'B3'] });
  play(g, 'p0', 'RZ');
  assert.equal(g.active, 0);
  assert.equal(g.players[1].hand.length, 5);
});

test('Weitergabe: Zwei ziehen auf Zwei ziehen, Strafe wächst', () => {
  const g = setup(mk(3, { stack: true }), { top: 'R5', hands: [['RZ', 'G1', 'G2'], ['BZ', 'Y1', 'Y2'], ['GZ', 'Y3', 'Y4']], deck: Array(20).fill('B1') });
  play(g, 'p0', 'RZ');
  assert.deepEqual(g.pending, { kind: 'Z', n: 2 });
  assert.equal(g.active, 1);
  assert.deepEqual(E.legalCards(g, 1), ['BZ'], 'nur Zwei ziehen ist erlaubt');
  assert.equal(play(g, 'p1', 'Y1').ok, false);
  assert.equal(play(g, 'p1', 'BZ').ok, true, 'Farbe egal bei der Weitergabe');
  assert.deepEqual(g.pending, { kind: 'Z', n: 4 });
  assert.equal(g.color, 'B'); assert.equal(g.active, 2);
  assert.equal(E.handle(g, 'p2', { t: 'draw' }).ok, true);
  assert.equal(g.players[2].hand.length, 3 + 4);
  assert.equal(g.pending, null);
  assert.equal(g.active, 0, 'Strafe gezogen = ausgesetzt');
});

test('Weitergabe: ziehen statt weitergeben ist immer erlaubt; Vier ziehen nur auf Vier ziehen', () => {
  const g = setup(mk(3, { stack: true }), { top: 'R5', hands: [['W4', 'G1', 'G2'], ['W4', 'RZ', 'Y2'], ['Y3', 'Y4']], deck: Array(20).fill('B1') });
  play(g, 'p0', 'W4', { color: 'G' });
  assert.deepEqual(g.pending, { kind: 'W4', n: 4 });
  assert.deepEqual(E.legalCards(g, 1), ['W4'], 'Zwei ziehen darf nicht auf Vier ziehen');
  assert.equal(play(g, 'p1', 'RZ').ok, false);
  assert.equal(play(g, 'p1', 'W4').ok, false, 'Farbe fehlt');
  assert.equal(play(g, 'p1', 'W4', { color: 'B' }).ok, true);
  assert.deepEqual(g.pending, { kind: 'W4', n: 8 });
  assert.equal(E.handle(g, 'p2', { t: 'draw' }).ok, true);
  assert.equal(g.players[2].hand.length, 2 + 8);
  // ohne passende Karte: nur ziehen
  setup(g, { top: 'R5', hands: [['RZ', 'G1', 'G2'], ['Y1', 'Y2', 'Y3'], FILL.slice(0, 3)], deck: Array(10).fill('B1') });
  play(g, 'p0', 'RZ');
  assert.deepEqual(E.legalCards(g, 1), []);
  assert.equal(E.handle(g, 'p1', { t: 'draw' }).ok, true);
  assert.equal(g.players[1].hand.length, 5);
  assert.equal(g.active, 2);
});

test('Weitergabe aus: Zwei ziehen auf Zwei ziehen ist ein normaler Zug (Farbe/Symbol) ', () => {
  const g = setup(mk(3), { top: 'RZ', hands: [['BZ', 'G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: Array(10).fill('B1') });
  assert.equal(play(g, 'p0', 'BZ').ok, true); // gleiches Symbol
  assert.equal(g.pending, null);
});

test('Ziehen: Pflicht zu spielen, wenn eine Karte passt', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1'], FILL.slice(0, 3), FILL.slice(3, 6)] });
  const s = snapshot(g);
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, false);
  assert.equal(snapshot(g), s);
});

test('Ziehen: unpassende Karte -> nächste Person', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: ['B7'] });
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true);
  assert.equal(g.players[0].hand.length, 3);
  assert.equal(g.active, 1); assert.equal(g.drawn, null);
});

test('Ziehen: passende Karte darf sofort gelegt oder behalten werden', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: ['B2', 'R7'] });
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true);
  assert.equal(g.drawn, 'R7'); assert.equal(g.active, 0);
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, false, 'nicht zweimal ziehen');
  assert.equal(play(g, 'p0', 'G1').ok, false, 'nur die gezogene Karte');
  assert.equal(play(g, 'p0', 'R7').ok, true);
  assert.equal(g.drawn, null); assert.equal(g.active, 1);
  // behalten
  setup(g, { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: ['B2', 'R7'] });
  E.handle(g, 'p0', { t: 'draw' });
  assert.equal(E.handle(g, 'p0', { t: 'keep' }).ok, true);
  assert.equal(g.players[0].hand.length, 3); assert.equal(g.active, 1); assert.equal(g.drawn, null);
  assert.equal(E.handle(g, 'p1', { t: 'keep' }).ok, false);
});

test('Ziehen: gezogener Joker „Vier ziehen“ ist nur ohne Farbe auf der Hand spielbar', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: ['W4'] });
  E.handle(g, 'p0', { t: 'draw' });
  assert.equal(g.drawn, 'W4'); assert.equal(g.active, 0);
  setup(g, { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: ['W4'] });
  g.color = 'G'; g.discard = ['B1', 'GS'];
  setup(g, { top: 'GS', hands: [['G1'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: ['W4'] });
  // hier ist G1 legal -> Ziehen verboten
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, false);
});

test('Stapel leer: Ablagestapel wird neu gemischt, oberste Karte bleibt', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: [] });
  g.discard = ['B3', 'B4', 'Y9', 'Y8', 'R5'];
  const before = total(g);
  assert.equal(E.handle(g, 'p0', { t: 'draw' }, seedRng(3)).ok, true);
  assert.equal(E.topCard(g), 'R5'); assert.equal(g.discard.length, 1);
  assert.equal(g.deck.length, 3);
  assert.equal(g.players[0].hand.length, 3);
  assert.equal(total(g), before);
  assert.equal(g.reshuffled, 1);
});

test('Stapel und Ablage leer: Ziehen bringt nichts, Zug geht weiter', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['G1', 'G2'], FILL.slice(0, 3), FILL.slice(3, 6)], deck: [] });
  g.discard = ['R5'];
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true);
  assert.equal(g.players[0].hand.length, 2); assert.equal(g.active, 1);
});

test('Ruf „Letzte Karte“: nicht gerufen -> zwei Karten, sobald die nächste Person handelt', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)], deck: ['B1', 'B2', 'B3', 'B4'] });
  play(g, 'p0', 'R1');
  assert.deepEqual(g.call, { pid: 'p0' });
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(play(g, 'p1', 'R2').ok, true);
  assert.equal(g.players[0].hand.length, 3, 'zwei Strafkarten');
  assert.equal(g.call, null);
  assert.ok(g.penalty && g.penalty.pid === 'p0' && g.penalty.n === 2);
});

test('Ruf „Letzte Karte“: rechtzeitig gerufen -> keine Strafe', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)], deck: ['B1', 'B2', 'B3', 'B4'] });
  play(g, 'p0', 'R1');
  assert.equal(E.handle(g, 'p1', { t: 'call' }).ok, false, 'nur die Person selbst');
  assert.equal(E.handle(g, 'p0', { t: 'call' }).ok, true);
  assert.equal(g.call, null);
  assert.equal(E.handle(g, 'p0', { t: 'call' }).ok, false, 'nur einmal');
  play(g, 'p1', 'R2');
  assert.equal(g.players[0].hand.length, 1);
});

test('Ruf: mit der Spielnachricht (call: true) oder Option „Ruf automatisch“', () => {
  let g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)] });
  play(g, 'p0', 'R1', { call: true });
  assert.equal(g.call, null);
  g = setup(mk(3, { auto: true }), { top: 'R5', hands: [['R1', 'G1'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)] });
  play(g, 'p0', 'R1');
  assert.equal(g.call, null);
  assert.equal(play(g, 'p0', 'R1', { call: 'ja' }).ok, false);
  g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)] });
  assert.equal(play(g, 'p0', 'R1', { call: 'ja' }).ok, false);
});

test('Ruf: Strafe auch, wenn die nächste Person zieht; bei mehr als einer Karte kein Ruf nötig', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R1', 'G1'], ['Y2', 'Y3', 'Y4'], FILL.slice(3, 6)], deck: ['B2', 'B3', 'B4', 'B6', 'B7'] });
  play(g, 'p0', 'R1');
  assert.equal(E.handle(g, 'p1', { t: 'draw' }).ok, true);
  assert.equal(g.players[0].hand.length, 3);
  const h = setup(mk(3), { top: 'R5', hands: [['R1', 'G1', 'G2'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)] });
  play(h, 'p0', 'R1');
  assert.equal(h.call, null);
});

test('Ruf zu zweit: Aussetzen lässt die Person noch einmal dran, Ruf geht noch', () => {
  const g = setup(mk(2), { top: 'R5', hands: [['RS', 'G1'], ['Y1', 'Y2', 'Y3']], deck: ['B1', 'B2', 'B3'] });
  play(g, 'p0', 'RS');
  assert.equal(g.active, 0);
  assert.deepEqual(g.call, { pid: 'p0' });
  assert.equal(E.handle(g, 'p0', { t: 'call' }).ok, true);
});

test('Rundenende: Punkte, Serie, nächste Runde', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['R1'], ['Y7', 'YS', 'W'], ['G9', 'B0']] });
  assert.equal(play(g, 'p0', 'R1').ok, true);
  assert.equal(g.mode, 'round');
  assert.equal(g.roundWinner, 0);
  assert.equal(g.roundPoints, 7 + 20 + 50 + 9);
  assert.equal(g.players[0].total, 86);
  assert.deepEqual(g.history, [{ round: 1, winner: 0, points: 86 }]);
  assert.equal(E.handle(g, 'p1', { t: 'draw' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'next' }, seedRng(2)).ok, true);
  assert.equal(g.mode, 'play'); assert.equal(g.round, 2);
  assert.equal(g.starter, 1); assert.equal(g.players.every((p) => p.hand.length >= 7), true);
  assert.equal(g.players[0].total, 86, 'Punkte bleiben');
  assert.equal(g.history.length, 1);
  assert.equal(total(g), 108);
  assert.equal(E.handle(g, 'p0', { t: 'next' }).ok, false, 'nicht mitten in der Runde');
});

test('Startperson wechselt jede Runde', () => {
  const g = mk(3, {}, 4);
  for (let r = 1; r <= 7; r++) {
    assert.equal(g.starter, (r - 1) % 3);
    g.mode = 'round';
    E.handle(g, 'p0', { t: 'next' }, seedRng(r));
  }
});

test('Letzte Karte „Zwei ziehen“: Gegner zieht noch, Punkte zählen mit', () => {
  const g = setup(mk(3), { top: 'R5', hands: [['RZ'], ['Y7'], ['G9']], deck: ['B1', 'B2', 'B3', 'B4'] });
  play(g, 'p0', 'RZ');
  assert.equal(g.players[1].hand.length, 3);
  assert.equal(g.roundPoints, 7 + 9 + 4 + 3, 'die gezogenen Karten (B4, B3) zählen mit');
  assert.equal(g.mode, 'round');
  const h = setup(mk(3, { stack: true }), { top: 'R5', hands: [['W4'], ['Y7'], ['G9']], deck: ['B1', 'B2', 'B3', 'B4', 'B5'] });
  play(h, 'p0', 'W4', { color: 'R' });
  assert.equal(h.players[1].hand.length, 5, 'auch mit Weitergabe zieht die Person noch');
  assert.equal(h.pending, null);
});

test('Serie endet bei 500 Punkten', () => {
  const g = setup(mk(2), { top: 'R5', hands: [['R1'], ['W', 'W4', 'YS']] });
  g.players[0].total = 400;
  play(g, 'p0', 'R1');
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0); assert.equal(g.players[0].total, 520);
  assert.equal(E.handle(g, 'p0', { t: 'next' }).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'draw' }).ok, false);
  // knapp darunter: weiter
  const h = setup(mk(2), { top: 'R5', hands: [['R1'], ['YS']] });
  h.players[0].total = 479;
  play(h, 'p0', 'R1');
  assert.equal(h.players[0].total, 499); assert.equal(h.mode, 'round');
  const k = setup(mk(2), { top: 'R5', hands: [['R1'], ['Y1']] });
  k.players[0].total = 499;
  play(k, 'p0', 'R1');
  assert.equal(k.mode, 'over');
});

test('Ungültige Nachrichten ändern den Zustand nie', () => {
  const rng = seedRng(1);
  const bad = [undefined, null, 0, 'x', [], {}, { t: 5 }, { t: 'play' }, { t: 'play', card: 5 }, { t: 'play', card: 'X9' }, { t: 'play', card: 'R5' },
    { t: 'play', card: 'G1', color: 'R' }, { t: 'play', card: ['R9'] }, { t: 'play', card: { toString: () => 'R9' } }, { t: 'draw', extra: 1 }, { t: 'color', color: 'R' },
    { t: 'keep' }, { t: 'next' }, { t: 'call' }, { t: 'zzz' }, { t: '__proto__' }, { t: 'play', card: 'W', color: 'ROT' }];
  const g = setup(mk(3), { top: 'R5', hands: [['R9', 'G1', 'W4', 'W'], ['R2', 'Y1', 'Y2'], FILL.slice(3, 6)] });
  for (const who of ['p0', 'p1', 'nobody', undefined, null, 7]) {
    for (const m of bad) {
      if (who === 'p0' && m && m.t === 'draw') continue; // p0 hat passende Karten: Ziehen wird abgelehnt
      const s = snapshot(g);
      const r = E.handle(g, who, m, rng);
      assert.equal(r.ok, false, JSON.stringify(m) + ' von ' + who);
      assert.equal(snapshot(g), s, JSON.stringify(m) + ' von ' + who);
    }
  }
  const s = snapshot(g);
  // nicht dran
  assert.equal(E.handle(g, 'p1', { t: 'play', card: 'R2' }).ok, false);
  assert.equal(snapshot(g), s);
  // Karte nicht auf der Hand, Karte passt nicht, Joker ohne Farbe
  for (const m of [{ t: 'play', card: 'R3' }, { t: 'play', card: 'G1' }, { t: 'play', card: 'W' }, { t: 'play', card: 'W4', color: 'R' }]) {
    assert.equal(E.handle(g, 'p0', m).ok, false, JSON.stringify(m));
    assert.equal(snapshot(g), s);
  }
  assert.equal(E.handle(null, 'p0', { t: 'draw' }).ok, false);
  assert.equal(E.handle({}, 'p0', { t: 'draw' }).ok, false);
});

test('Spielzustand ist JSON-sicher (Hin-und-zurück ändert nichts)', () => {
  const g = mk(4, { stack: true }, 5);
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  // auch mitten im Spiel
  const rng = seedRng(8);
  for (let i = 0; i < 40; i++) {
    const ap = E.activePlayer(g);
    const l = E.legalCards(g, g.active);
    const m = g.stage === 'color' ? { t: 'color', color: 'R' } : g.drawn ? { t: 'keep' } : g.pending ? { t: 'draw' } : l.length ? { t: 'play', card: l[0], color: 'B' } : { t: 'draw' };
    E.handle(g, ap.id, m, rng);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
});

function randomPlay(n, opts, seed) {
  const rng = seedRng(seed), brain = seedRng(seed * 3 + 1);
  const g = E.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), opts, rng);
  let steps = 0, rounds = 0;
  while (g.mode !== 'over') {
    if (++steps > 60000) throw new Error('Spiel endet nicht');
    if (g.mode === 'round') { assert.equal(E.handle(g, 'p0', { t: 'next' }, rng).ok, true); rounds++; continue; }
    const ap = E.activePlayer(g);
    const l = E.legalCards(g, g.active);
    let m;
    if (g.stage === 'color') m = { t: 'color', color: E.COLORS[Math.floor(brain() * 4)] };
    else if (g.drawn) m = brain() < 0.7 ? { t: 'play', card: g.drawn, color: E.COLORS[Math.floor(brain() * 4)], call: brain() < 0.7 } : { t: 'keep' };
    else if (g.pending) m = l.length && brain() < 0.6 ? { t: 'play', card: l[0], color: 'G' } : { t: 'draw' };
    else if (l.length) m = { t: 'play', card: l[Math.floor(brain() * l.length)], color: E.COLORS[Math.floor(brain() * 4)], call: brain() < 0.6 };
    else m = { t: 'draw' };
    const s = JSON.stringify(g);
    const r = E.handle(g, ap.id, m, rng);
    assert.equal(r.ok, true, JSON.stringify(m) + ' ' + r.error + ' ' + s);
    if (g.call && g.players.find((p) => p.id === g.call.pid).hand.length === 1 && brain() < 0.5) assert.equal(E.handle(g, g.call.pid, { t: 'call' }, rng).ok, true);
    assert.equal(total(g), 108, 'Kartenanzahl');
    assert.ok(g.players.every((p) => p.hand.every(E.isCard)));
  }
  assert.ok(g.players[g.winner].total >= 500);
  return { rounds: rounds + 1 };
}

test('Zufallspartien 2 bis 6 Personen, mit und ohne Optionen: enden immer, Karten bleiben vollständig', () => {
  let games = 0, rounds = 0;
  for (let n = 2; n <= 6; n++) {
    for (let k = 0; k < 24; k++) {
      const opts = { stack: !!(k & 1), auto: !!(k & 2) };
      rounds += randomPlay(n, opts, n * 1000 + k).rounds;
      games++;
    }
  }
  assert.ok(games >= 120 && rounds > games);
});
