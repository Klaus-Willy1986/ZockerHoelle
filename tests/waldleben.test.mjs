import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../waldleben/engine.js';
import * as C from '../waldleben/cards.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const byName = (n) => C.CARDS.find((c) => c.name === n).id;
const tree = (sp) => C.CARDS.find((c) => c.kind === 'tree' && c.sp === sp).id;
const trees = (sp, k) => C.CARDS.filter((c) => c.kind === 'tree' && c.sp === sp).slice(0, k).map((c) => c.id);
const T = (sp, sides = [null, null, null, null]) => ({ sp, id: tree(sp), sides });

// Zustand mit festen Handkarten/Wäldern bauen; der Stapel bleibt echt (oben = Ende)
function setup({ n = 2, hands, forest, deckTop, clearing, active = 0, seed = 1, opts = {} } = {}) {
  const g = M.createGame(players(n), opts, seeded(seed));
  if (hands) hands.forEach((h, i) => { g.players[i].hand = h.slice(); });
  if (forest) forest.forEach((f, i) => { g.players[i].trees = f.map((t) => ({ sp: t.sp, id: t.id, sides: t.sides.slice() })); });
  if (clearing) g.clearing = clearing.slice();
  if (deckTop) { g.deck = g.deck.filter((x) => !deckTop.includes(x)); g.deck.push(...deckTop.slice().reverse()); }
  g.active = active;
  return g;
}
// Bilanz nach dem Eingreifen in Hände ist nicht mehr ganz sauber: nur in echten Partien prüfen
const H = (g, i = 0) => g.players[i].hand;

test('Kartensatz: 48 Bäume (6 Arten x 8), 65 Tiere/Pflanzen/Pilze, 3 Winterkarten = 116', () => {
  assert.equal(C.CARDS.length, 116);
  assert.equal(C.TOTAL, 116);
  assert.ok(C.CARDS.every((c, i) => c.id === i));
  for (let s = 0; s < 6; s++) assert.equal(C.CARDS.filter((c) => c.kind === 'tree' && c.sp === s).length, 8);
  assert.equal(C.CARDS.filter((c) => c.kind === 'life').length, 65);
  assert.equal(C.CARDS.filter((c) => c.kind === 'winter').length, 3);
  const life = C.CARDS.filter((c) => c.kind === 'life');
  assert.equal(new Set(life.map((c) => c.name)).size, 65, 'Namen eindeutig');
  assert.ok(life.every((c) => c.cost >= 0 && c.cost <= 4 && Number.isInteger(c.cost)));
  assert.deepEqual([...new Set(life.map((c) => c.cost))].sort(), [0, 1, 2, 3, 4]);
  assert.equal(life.filter((c) => c.fx && c.fx.k === 'dauer').length, 3, 'drei Dauer-Pilze');
  assert.ok(life.filter((c) => c.fx && c.fx.k === 'dauer').every((c) => c.type === 'pilz'));
  for (const t of Object.keys(C.TYPES)) assert.ok(life.filter((c) => c.type === t).length >= 8, t);
  for (let s = 0; s < 6; s++) assert.ok(life.filter((c) => c.sp === s).length >= 9, 'Baumfarbe ' + s);
  for (const c of life) {
    assert.ok(C.ptsText(c).length > 0 && C.ptsText(c).length < 80, c.name);
    assert.ok(!c.fx || C.fxText(c).length > 0, c.name);
  }
});

test('Start: Hände 5, Lichtung 3, Winterkarten im unteren Drittel, Bilanz, JSON', () => {
  for (let n = 2; n <= 5; n++) for (let seed = 1; seed <= 30; seed++) {
    const g = M.createGame(players(n), {}, seeded(seed * 13 + n));
    assert.ok(g.players.every((p) => p.hand.length === 5));
    assert.equal(g.clearing.length, 3);
    assert.equal(M.totalCards(g), M.deckTotal(g));
    const k = Math.ceil((g.deck.length - 3) / 3);
    const pos = C.WINTER_IDS.map((w) => g.deck.indexOf(w));
    assert.ok(pos.every((p) => p >= 0 && p < k + 3), `Winter unten: ${pos} k=${k}`);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
    assert.equal(g.phase, 'play');
    assert.equal(g.winters, 0);
  }
  assert.throws(() => M.createGame(players(1), {}), /2 bis 5/);
  assert.throws(() => M.createGame(players(6), {}), /2 bis 5/);
  assert.throws(() => M.createGame('x', {}), /2 bis 5/);
});

test('Stapelgröße: je nach Personenzahl, Kurzspiel kleiner, ?deck wird begrenzt', () => {
  for (let n = 2; n <= 5; n++) {
    const a = M.createGame(players(n), {}, seeded(3));
    const b = M.createGame(players(n), { short: true }, seeded(3));
    assert.equal(M.deckTotal(a), M.defaultDeck(n) + 3);
    assert.ok(M.deckTotal(b) < M.deckTotal(a));
    assert.equal(M.totalCards(b), M.deckTotal(b));
  }
  const tiny = M.createGame(players(5), { deck: 5 }, seeded(3));
  assert.ok(tiny.opts.deck >= 5 * 5 + 3 + 12);
  const huge = M.createGame(players(2), { deck: 9999 }, seeded(3));
  assert.equal(huge.opts.deck, 113);
});

test('Ziehen: 2 Karten, auch aus der Lichtung, danach ist der nächste dran', () => {
  const g = setup({ clearing: [byName('Reh'), byName('Igel'), byName('Farn')] });
  const n0 = H(g).length;
  assert.deepEqual(M.handle(g, 'p0', { t: 'draw', src: 'deck' }, seeded(1)), { ok: true });
  assert.equal(g.active, 0); assert.equal(g.drawLeft, 1);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'clearing', card: byName('Igel') }).ok, true);
  assert.equal(H(g).length, n0 + 2);
  assert.ok(H(g).includes(byName('Igel')));
  assert.ok(!g.clearing.includes(byName('Igel')));
  assert.equal(g.active, 1); assert.equal(g.drawLeft, 0);
  assert.equal(g.turns, 1);
});

test('Ziehen: Handgrenze 10 (mit 9 nur eine, mit 10 keine); Hallimasch 3; Steinpilz 12', () => {
  let g = setup({ hands: [Array.from({ length: 9 }, (_, i) => i), []] });
  assert.equal(M.drawNeed(g, g.players[0]), 1);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'deck' }).ok, true);
  assert.equal(g.active, 1);
  g = setup({ hands: [Array.from({ length: 10 }, (_, i) => i), []] });
  assert.equal(M.canDrawNow(g, g.players[0]), false);
  const r = M.handle(g, 'p0', { t: 'draw', src: 'deck' });
  assert.equal(r.ok, false); assert.match(r.error, /voll/);
  assert.equal(g.drawLeft, 0);
  const hal = byName('Hallimasch');
  g = setup({ forest: [[T(0, [hal, null, null, null])], []], hands: [[1, 2], []] });
  assert.equal(M.drawBase(g.players[0]), 3);
  for (let i = 0; i < 3; i++) assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'deck' }).ok, true);
  assert.equal(H(g).length, 5); assert.equal(g.active, 1);
  const st = byName('Steinpilz');
  g = setup({ forest: [[T(0, [st, null, null, null])], []], hands: [Array.from({ length: 10 }, (_, i) => i), []] });
  assert.equal(M.handLimit(g.players[0]), 12);
  assert.equal(M.drawNeed(g, g.players[0]), 2);
});

test('Ziehen: ungültige Quelle/Karte ändert nichts', () => {
  const g = setup({ clearing: [byName('Reh')] });
  const before = JSON.stringify(g);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'ablage' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'clearing', card: 999 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'clearing', card: byName('Farn') }).ok, false);
  assert.equal(JSON.stringify(g), before);
});

test('Mitten im Ziehen sind andere Aktionen gesperrt', () => {
  const g = setup({ hands: [[tree(0), 60, 61], []] });
  M.handle(g, 'p0', { t: 'draw', src: 'deck' });
  assert.equal(M.handle(g, 'p0', { t: 'tree', card: tree(0) }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'sprout', card: 60 }).ok, false);
});

test('Baum pflanzen: kostenlos, eine Karte kommt offen in die Lichtung', () => {
  const g = setup({ hands: [[tree(2), 60], []] });
  const deckN = g.deck.length; const cl = g.clearing.length;
  const r = M.handle(g, 'p0', { t: 'tree', card: tree(2) });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].trees.length, 1);
  assert.equal(g.players[0].trees[0].sp, 2);
  assert.equal(g.clearing.length, cl + 1);
  assert.equal(g.deck.length, deckN - 1);
  assert.equal(g.active, 1);
  // Tier ist kein Baum
  const g2 = setup({ hands: [[60], []] });
  assert.equal(M.handle(g2, 'p0', { t: 'tree', card: 60 }).ok, false);
});

test('Sprössling: jede Handkarte, verdeckt (id -1, keine Art), zählt als Baum', () => {
  const g = setup({ hands: [[60, tree(1)], []] });
  assert.equal(M.handle(g, 'p0', { t: 'sprout', card: 60 }).ok, true);
  const t = g.players[0].trees[0];
  assert.equal(t.sp, -1); assert.equal(t.id, -1);
  assert.ok(!JSON.stringify(g.players[0].trees).includes('60'));
  assert.equal(C.count(g.players[0], 'trees'), 1);
  assert.equal(C.count(g.players[0], 'species'), 0);
  assert.equal(g.clearing.length, 4);
  assert.equal(M.handle(g, 'p1', { t: 'sprout', card: 70 }).ok, false); // nicht auf der Hand
});

test('Lichtung wird ab 10 Karten geleert (nach dem Ausspielen)', () => {
  const cl = [60, 61, 62, 63, 64, 65, 66, 67, 68];
  const g = setup({ hands: [[tree(0)], []], clearing: cl });
  const disc = g.discard.length;
  assert.equal(M.handle(g, 'p0', { t: 'tree', card: tree(0) }).ok, true);
  assert.equal(g.clearing.length, 0);
  assert.equal(g.discard.length, disc + 10);
  assert.equal(g.last.kind, 'cleared');
  // 8 Karten + 1 = 9: bleibt
  const g2 = setup({ hands: [[tree(0)], []], clearing: cl.slice(0, 8) });
  M.handle(g2, 'p0', { t: 'tree', card: tree(0) });
  assert.equal(g2.clearing.length, 9);
});

test('Tier anlegen: Kosten, Lichtung, Platz, ungültige Eingaben', () => {
  const reh = byName('Reh'); // Kosten 2, 3 Punkte, Baumfarbe Linde
  const base = () => setup({ hands: [[reh, 1, 2, 3], []], forest: [[T(0)], []] });
  let g = base();
  assert.equal(M.handle(g, 'p0', { t: 'life', card: reh, pay: [1, 2], tree: 0, side: 1 }).ok, true);
  assert.equal(g.players[0].trees[0].sides[1], reh);
  assert.deepEqual(H(g), [3]);
  assert.deepEqual(g.clearing.slice(-2), [1, 2]);
  assert.equal(g.active, 1);
  const bad = [
    { card: reh, pay: [1], tree: 0, side: 0 }, // zu wenig
    { card: reh, pay: [1, 2, 3], tree: 0, side: 0 }, // zu viel
    { card: reh, pay: [1, 1], tree: 0, side: 0 }, // doppelt
    { card: reh, pay: [1, reh], tree: 0, side: 0 }, // sich selbst
    { card: reh, pay: [1, 99], tree: 0, side: 0 }, // nicht auf der Hand
    { card: reh, pay: [1, 2], tree: 1, side: 0 }, // Baum fehlt
    { card: reh, pay: [1, 2], tree: -1, side: 0 },
    { card: reh, pay: [1, 2], tree: 0, side: 4 },
    { card: reh, pay: [1, 2], tree: 0, side: 1.5 },
    { card: reh, pay: [1, 2], tree: '0', side: 0 },
    { card: reh, pay: 'x', tree: 0, side: 0 },
    { card: reh, tree: 0, side: 0 },
    { card: tree(0), pay: [], tree: 0, side: 0 },
    { card: 9999, pay: [], tree: 0, side: 0 },
    { card: 50, pay: [], tree: 0, side: 0 },
  ];
  for (const m of bad) {
    g = base(); const s = JSON.stringify(g);
    assert.equal(M.handle(g, 'p0', { t: 'life', ...m }).ok, false, JSON.stringify(m));
    assert.equal(JSON.stringify(g), s, 'Zustand geändert bei ' + JSON.stringify(m));
  }
  // Platz besetzt
  g = setup({ hands: [[reh, 1, 2], []], forest: [[T(0, [byName('Farn'), null, null, null])], []] });
  assert.equal(M.handle(g, 'p0', { t: 'life', card: reh, pay: [1, 2], tree: 0, side: 0 }).ok, false);
  assert.equal(M.freeSlots(g.players[0]), 3);
});

test('Kostenlose Karte: pay leer, kein Passend-Bonus', () => {
  const farn = byName('Farn');
  const g = setup({ hands: [[farn, 1], []], forest: [[T(0)], []] });
  const n = g.deck.length;
  const r = M.handle(g, 'p0', { t: 'life', card: farn, pay: [], tree: 0, side: 2 });
  assert.equal(r.ok, true); assert.equal(r.passend, false);
  assert.equal(g.deck.length, n);
});

test('Passend bezahlt: alle Zahlkarten in der Baumfarbe der Karte = 1 Karte ziehen; mit Pfifferling 2', () => {
  const reh = byName('Reh'); // Linde (2)
  const [t1, t2] = trees(2, 2);
  let g = setup({ hands: [[reh, t1, t2], []], forest: [[T(0)], []] });
  let r = M.handle(g, 'p0', { t: 'life', card: reh, pay: [t1, t2], tree: 0, side: 0 });
  assert.equal(r.passend, true); assert.equal(H(g).length, 1);
  // nicht passend: eine Karte anderer Farbe
  g = setup({ hands: [[reh, t1, tree(0)], []], forest: [[T(0)], []] });
  r = M.handle(g, 'p0', { t: 'life', card: reh, pay: [t1, tree(0)], tree: 0, side: 0 });
  assert.equal(r.passend, false); assert.equal(H(g).length, 0);
  // Pfifferling
  const pf = byName('Pfifferling');
  g = setup({ hands: [[reh, t1, t2], []], forest: [[T(0, [pf, null, null, null])], []] });
  r = M.handle(g, 'p0', { t: 'life', card: reh, pay: [t1, t2], tree: 0, side: 1 });
  assert.equal(H(g).length, 2);
  // Zahlkarten können auch Tierkarten gleicher Baumfarbe sein
  const kme = byName('Kohlmeise'); // Linde
  g = setup({ hands: [[reh, kme, t1], []], forest: [[T(0)], []] });
  r = M.handle(g, 'p0', { t: 'life', card: reh, pay: [kme, t1], tree: 0, side: 0 });
  assert.equal(r.passend, true);
});

test('Passend-Bonus beachtet die Handgrenze', () => {
  const reh = byName('Reh'); const [t1, t2] = trees(2, 2);
  const full = Array.from({ length: 7 }, (_, i) => 70 + i);
  const g = setup({ hands: [[reh, t1, t2, ...full], []], forest: [[T(0)], []] }); // 10 Karten
  M.handle(g, 'p0', { t: 'life', card: reh, pay: [t1, t2], tree: 0, side: 0 });
  assert.equal(H(g).length, 8); // 10 - 3 + 1
});

test('Wirkungen: Karten ziehen, Höhle, Extrazug', () => {
  const rot = byName('Rotkehlchen'); // Kosten 1, ziehe 1
  let g = setup({ hands: [[rot, 1], []], forest: [[T(0)], []] });
  M.handle(g, 'p0', { t: 'life', card: rot, pay: [1], tree: 0, side: 0 });
  assert.equal(H(g).length, 1);
  const dachs = byName('Dachs'); // Kosten 2, Höhle 2
  g = setup({ hands: [[dachs, 1, 2], []], forest: [[T(0)], []] });
  const top = g.deck.slice(-2).reverse();
  M.handle(g, 'p0', { t: 'life', card: dachs, pay: [1, 2], tree: 0, side: 0 });
  assert.deepEqual(g.players[0].cave, top);
  const kuk = byName('Kuckuck'); // Kosten 2, Extrazug
  g = setup({ hands: [[kuk, 1, 2], [3]], forest: [[T(0)], []] });
  M.handle(g, 'p0', { t: 'life', card: kuk, pay: [1, 2], tree: 0, side: 0 });
  assert.equal(g.active, 0); assert.equal(g.extra, false);
  assert.equal(g.turns, 1);
  M.handle(g, 'p0', { t: 'draw', src: 'deck' });
  M.handle(g, 'p0', { t: 'draw', src: 'deck' });
  assert.equal(g.active, 1, 'nur ein Extrazug');
});

test('Wirkung "Ziehen" stoppt an der Handgrenze', () => {
  const rot = byName('Rotkehlchen');
  const hand = [rot, 1, ...Array.from({ length: 8 }, (_, i) => 70 + i)]; // 10
  const g = setup({ hands: [hand, []], forest: [[T(0)], []] });
  M.handle(g, 'p0', { t: 'life', card: rot, pay: [1], tree: 0, side: 0 });
  assert.equal(H(g).length, 9); // 10-2 +1 (Wirkung)
});

test('Winterkarten: 1. und 2. werden gezählt und entfernt, 3. beendet sofort', () => {
  const [w1, w2, w3] = C.WINTER_IDS;
  const g = setup({ hands: [[tree(0), 60], [tree(1)]] });
  g.deck = g.deck.filter((x) => !C.WINTER_IDS.includes(x));
  g.deck.push(w1, 90, 91); // oben: 91, 90, w1
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'deck' }).ok, true);
  assert.equal(g.winters, 0);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'deck' }).ok, true);
  assert.equal(g.winters, 0);
  // jetzt liegt w1 oben: Person 1 zieht -> Winter 1 wird gezählt, sie bekommt die nächste Karte
  assert.equal(g.deck[g.deck.length - 1], w1);
  const n1 = H(g, 1).length;
  M.handle(g, 'p1', { t: 'draw', src: 'deck' });
  assert.equal(g.winters, 1); assert.equal(g.winterOut, 1);
  assert.equal(H(g, 1).length, n1 + 1);
  assert.ok(!H(g, 1).some((c) => C.CARDS[c].kind === 'winter'));
  assert.equal(g.phase, 'play');
  // zweite per Baum -> Lichtung
  g.active = 0; g.drawLeft = 0;
  g.deck.push(w2);
  assert.equal(M.handle(g, 'p0', { t: 'tree', card: tree(0) }).ok, true);
  assert.equal(g.winters, 2); assert.equal(g.phase, 'play');
  assert.ok(!g.clearing.some((c) => C.CARDS[c].kind === 'winter'));
  assert.equal(g.active, 1);
  // dritte beendet sofort, mitten im Zug
  g.deck.push(w3);
  const r = M.handle(g, 'p1', { t: 'tree', card: tree(1) });
  assert.equal(r.ok, true);
  assert.equal(g.phase, 'over'); assert.equal(g.winters, 3);
  assert.ok(g.result && g.result.why === 'winter' && g.result.winners.length >= 1);
  assert.equal(M.handle(g, 'p0', { t: 'draw', src: 'deck' }).ok, false);
});

test('Dritte Winterkarte durch eine Höhlen-Wirkung beendet ebenfalls', () => {
  const dachs = byName('Dachs');
  const g = setup({ hands: [[dachs, 1, 2], []], forest: [[T(0)], []] });
  g.winters = 2; g.winterOut = 2;
  g.deck = g.deck.filter((x) => x !== C.WINTER_IDS[2]); g.deck.push(C.WINTER_IDS[2]);
  M.handle(g, 'p0', { t: 'life', card: dachs, pay: [1, 2], tree: 0, side: 0 });
  assert.equal(g.phase, 'over');
});

test('Falsche Person, falsche Phase, kaputte Nachrichten', () => {
  const g = setup({ hands: [[tree(0)], [tree(1)]] });
  const s = JSON.stringify(g);
  for (const [pid, m] of [['p1', { t: 'draw', src: 'deck' }], ['x', { t: 'draw', src: 'deck' }], ['p0', null], ['p0', 'draw'], ['p0', {}], ['p0', { t: 5 }], ['p0', { t: 'foo' }], ['p0', { t: 'tree' }], ['p0', { t: 'tree', card: 'a' }], ['p0', { t: 'tree', card: null }], ['p0', { t: 'life' }], ['p0', { t: 'sprout', card: 1e9 }], ['p0', { t: 'next' }], ['p0', { t: 'again' }]]) {
    assert.equal(M.handle(g, pid, m, seeded(1)).ok, false, JSON.stringify([pid, m]));
  }
  assert.equal(JSON.stringify(g), s);
  assert.equal(M.handle(null, 'p0', { t: 'draw' }).ok, false);
  assert.equal(M.handle({ game: 'x' }, 'p0', { t: 'draw' }).ok, false);
});

test('Wertung: feste Punkte, pro X, wenn mindestens, Höhle, Bäume zählen nichts', () => {
  const g = setup({ n: 2 });
  const q = g.players[0];
  const n = byName;
  q.trees = [
    { sp: 0, id: tree(0), sides: [n('Eichelhäher'), n('Reh'), n('Rotfuchs'), n('Buntspecht')] }, // Eichelhäher 1/Eiche; Reh 3; Fuchs 2/Vogel; Specht 2
    { sp: 0, id: tree(0), sides: [n('Kohlmeise'), n('Honigbiene'), null, null] }, // Meise 1; Biene 1/Pflanze
    { sp: -1, id: -1, sides: [n('Efeu'), null, null, null] }, // Efeu 2/voll besetzter Baum (1 voller Baum)
  ];
  q.cave = [1, 2, 3];
  // Vögel: Eichelhäher, Buntspecht, Kohlmeise = 3 -> Fuchs 6; Eichen 2 -> Eichelhäher 2; Pflanzen: Efeu 1 -> Biene 1; voll: 1 -> Efeu 2
  const s = M.score(g, q);
  const pts = (name) => s.trees.flatMap((t) => t.cards).find((c) => C.CARDS[c.id].name === name).pts;
  assert.equal(pts('Eichelhäher'), 2);
  assert.equal(pts('Reh'), 3);
  assert.equal(pts('Rotfuchs'), 6);
  assert.equal(pts('Buntspecht'), 2);
  assert.equal(pts('Kohlmeise'), 1);
  assert.equal(pts('Honigbiene'), 1);
  assert.equal(pts('Efeu'), 2);
  assert.equal(s.cave, 3);
  assert.equal(s.total, 2 + 3 + 6 + 2 + 1 + 1 + 2 + 3);
  assert.equal(s.trees[2].cards[0].how, '1 × 2 = 2');
});

test('Wertung: Bedingungen (mindestens N), 1 pro 2, Kartenarten und Baumarten', () => {
  const g = setup({ n: 2 });
  const q = g.players[0];
  const n = byName;
  q.trees = [
    { sp: 0, id: tree(0), sides: [n('Waldohreule'), n('Fledermaus'), n('Honigbiene'), n('Steinpilz')] }, // Arten: vogel,saeuger,insekt,pilz = 4
    { sp: 1, id: tree(1), sides: [n('Heckenrose'), n('Kleiber'), null, null] }, // pflanze -> 5 Arten
    { sp: 2, id: tree(2), sides: [null, null, null, null] },
  ];
  const s = M.score(g, q);
  const pts = (name) => s.trees.flatMap((t) => t.cards).find((c) => C.CARDS[c.id].name === name).pts;
  assert.equal(C.count(q, 'types'), 5);
  assert.equal(pts('Waldohreule'), 6); // mind. 4 Kartenarten
  assert.equal(pts('Fledermaus'), 5); // mind. 3
  assert.equal(C.count(q, 'species'), 3);
  assert.equal(pts('Heckenrose'), 5); // mind. 3 Baumarten
  assert.equal(pts('Kleiber'), 1); // 3 Bäume: 1 pro 2
  // zu wenig
  q.trees = [{ sp: 0, id: tree(0), sides: [n('Waldohreule'), null, null, null] }];
  assert.equal(M.score(g, q).total, 0);
});

test('Wertung: Handkarten zählen nicht; Rangliste mit Gleichstand', () => {
  const g = setup({ n: 3 });
  g.players[0].trees = [{ sp: 0, id: tree(0), sides: [byName('Farn'), null, null, null] }];
  g.players[1].trees = [{ sp: 0, id: tree(0), sides: [byName('Moos'), null, null, null] }];
  g.players[2].cave = [1, 2, 3];
  const r = M.ranking(g);
  assert.equal(r[0].points, 3); assert.equal(r[0].id, 'p2'); assert.equal(r[0].rank, 1);
  assert.equal(r[1].rank, 2); assert.equal(r[2].rank, 2);
});

test('Spielende: Gleichstand gibt mehrere Gewinner', () => {
  const g = setup({ n: 2 });
  g.winters = 2; g.deck.push(C.WINTER_IDS[2]);
  g.players[0].hand = [tree(0)];
  M.handle(g, 'p0', { t: 'tree', card: tree(0) });
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result.winners.sort(), ['p0', 'p1']);
});

test('Texte: Punkte- und Wirkungstexte sind einfach und vollständig', () => {
  assert.equal(C.ptsText(C.CARDS[byName('Rotfuchs')]), '2 Punkte pro Vogel in deinem Wald');
  assert.equal(C.ptsText(C.CARDS[byName('Kleiber')]), '1 Punkt pro 2 Bäume in deinem Wald');
  assert.equal(C.ptsText(C.CARDS[byName('Efeu')]), '2 Punkte pro voll besetztem Baum in deinem Wald');
  assert.equal(C.ptsText(C.CARDS[byName('Heckenrose')]), '5 Punkte, wenn du mindestens 3 verschiedene Baumarten hast');
  assert.match(C.fxText(C.CARDS[byName('Kuckuck')]), /Extrazug/);
  assert.match(C.fxText(C.CARDS[byName('Hallimasch')]), /3 statt 2/);
  assert.equal(C.costText(0), 'kostenlos');
});

// ---- ganze Partien ----
function randomMsg(g, rng) {
  const p = M.activePlayer(g);
  const opts = [];
  if (M.canDrawNow(g, p)) { opts.push({ t: 'draw', src: 'deck' }); for (const c of g.clearing) opts.push({ t: 'draw', src: 'clearing', card: c }); }
  if (g.drawLeft > 0) return opts[Math.floor(rng() * opts.length)];
  for (const id of p.hand) {
    const c = C.CARDS[id];
    if (c.kind === 'tree') opts.push({ t: 'tree', card: id });
    opts.push({ t: 'sprout', card: id });
    if (M.canPlayAsSelf(g, p, id) && c.kind === 'life') {
      const o2 = p.hand.filter((x) => x !== id); const pay = [];
      while (pay.length < c.cost) pay.push(o2.splice(Math.floor(rng() * o2.length), 1)[0]);
      const slots = []; p.trees.forEach((t, i) => M.treeFree(t).forEach((s) => slots.push([i, s])));
      const [ti, si] = slots[Math.floor(rng() * slots.length)];
      for (let k = 0; k < 3; k++) opts.push({ t: 'life', card: id, pay, tree: ti, side: si });
    }
  }
  return opts[Math.floor(rng() * opts.length)];
}

test('300 Zufallspartien enden immer; Kartenbilanz, Handgrenze, JSON stimmen in jedem Zug', () => {
  let longest = 0;
  for (let s = 1; s <= 300; s++) {
    const n = 2 + (s % 4); const rng = seeded(s * 7 + 3);
    const g = M.createGame(players(n), s % 5 === 0 ? { short: true } : {}, rng);
    let st = 0;
    while (g.phase === 'play') {
      assert.ok(st++ < 3000, 'Endlosspiel seed ' + s);
      const m = randomMsg(g, rng);
      const r = M.handle(g, M.activePlayer(g).id, m, rng);
      assert.equal(r.ok, true, JSON.stringify(m) + ' ' + r.error);
      assert.equal(M.totalCards(g), M.deckTotal(g), 'Bilanz seed ' + s);
      for (const p of g.players) assert.ok(p.hand.length <= M.handLimit(p));
      assert.ok(g.phase === 'over' || g.clearing.length < M.LICHTUNG_MAX);
      if (st % 40 === 0) assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
    }
    longest = Math.max(longest, g.turns);
    assert.equal(g.winters, 3);
    assert.ok(g.result.winners.length >= 1);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
  assert.ok(longest > 20);
});
