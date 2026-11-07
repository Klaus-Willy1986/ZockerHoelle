import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wildnis/engine.js';

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
const KEYTILE = (h, a) => E.HABITATS.indexOf(h) * 5 + E.ANIMALS.indexOf(a);

// Brett aus [[q,r,tileId,rot,tok]]
function mkBoard(cells) {
  const b = {};
  for (const [q, r, t = 0, rot = 0, tok = null] of cells) b[q + ',' + r] = { t, rot, tok };
  return b;
}
const toks = (a, coords) => coords.map(([q, r]) => [q, r, 0, 0, a]);
const sc = (cells) => E.scoreBoard(mkBoard(cells));

// ---------- Plättchensatz ----------
test('Satz: 85 Plättchen, 25 Schlüssel, 60 Doppel, je Paar 6', () => {
  assert.equal(E.TILES.length, 85);
  assert.ok(E.TILES.every((t, i) => t.id === i && t.edges.length === 6));
  const keys = E.TILES.filter((t) => t.key);
  assert.equal(keys.length, 25);
  for (const h of E.HABITATS) {
    const of = keys.filter((t) => t.edges.every((e) => e === h));
    assert.equal(of.length, 5, h);
    assert.deepEqual(of.map((t) => t.animals[0]).sort(), [...E.ANIMALS].sort());
    assert.ok(of.every((t) => t.animals.length === 1));
  }
  const dbl = E.TILES.filter((t) => !t.key);
  assert.equal(dbl.length, 60);
  const pairs = {};
  for (const t of dbl) {
    const set = [...new Set(t.edges)];
    assert.equal(set.length, 2);
    // zusammenhängende Bögen: Lebensraumwechsel rund um das Plättchen genau zweimal
    let changes = 0;
    for (let i = 0; i < 6; i++) if (t.edges[i] !== t.edges[(i + 1) % 6]) changes++;
    assert.equal(changes, 2);
    assert.ok(t.animals.length === 2 || t.animals.length === 3);
    assert.equal(new Set(t.animals).size, t.animals.length);
    const k = set.slice().sort().join('/');
    pairs[k] = (pairs[k] || 0) + 1;
  }
  assert.equal(Object.keys(pairs).length, 10);
  assert.ok(Object.values(pairs).every((c) => c === 6));
});

test('Satz: Lebensräume und Tiere ausgewogen', () => {
  const an = {};
  const hb = {};
  for (const t of E.TILES) {
    for (const a of t.animals) an[a] = (an[a] || 0) + 1;
    for (const h of new Set(t.edges)) hb[h] = (hb[h] || 0) + 1;
  }
  for (const a of E.ANIMALS) assert.ok(an[a] >= 40 && an[a] <= 45, `${a} ${an[a]}`);
  for (const h of E.HABITATS) assert.equal(hb[h], 29);
  const edges = {};
  for (const t of E.TILES) for (const e of t.edges) edges[e] = (edges[e] || 0) + 1;
  for (const h of E.HABITATS) assert.equal(edges[h], 6 * 5 + 6 * 4 * 3, h); // 30 Schlüsselkanten + 4 Paare x 18 Kanten
});

test('Startgruppen: 5 Dreiergruppen, Startfelder paarweise benachbart', () => {
  assert.equal(E.START_TRIPLETS.length, 5);
  const ids = E.START_TRIPLETS.flat();
  assert.equal(new Set(ids).size, 15);
  for (const id of ids) assert.ok(E.tileDef(id) && E.tileDef(id).id === id);
  for (const tr of E.START_TRIPLETS) {
    const defs = tr.map(E.tileDef);
    assert.equal(defs.filter((d) => d.key).length, 1);
    assert.equal(defs.filter((d) => !d.key).length, 2);
  }
  const c = E.START_COORDS;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    assert.ok(E.neighbors(c[i].q, c[i].r).some((n) => n.q === c[j].q && n.r === c[j].r));
  }
});

test('Hexgeometrie: Nachbarn, Gegenkanten, Drehung', () => {
  const nb = E.neighbors(2, -1);
  assert.deepEqual(nb[0], { q: 3, r: -2 });
  assert.deepEqual(nb[1], { q: 3, r: -1 });
  assert.deepEqual(nb[2], { q: 2, r: 0 });
  assert.deepEqual(nb[3], { q: 1, r: 0 });
  assert.deepEqual(nb[4], { q: 1, r: -1 });
  assert.deepEqual(nb[5], { q: 2, r: -2 });
  for (let e = 0; e < 6; e++) {
    const n = E.edgeNeighbor(0, 0, e);
    const back = E.edgeNeighbor(n.q, n.r, E.oppositeEdge(e));
    assert.deepEqual(back, { q: 0, r: 0 });
  }
  const d = E.TILES.find((t) => !t.key && t.edges[0] !== t.edges[3]);
  assert.deepEqual(E.tileEdges(d.id, 0), d.edges);
  const r2 = E.tileEdges(d.id, 2);
  for (let e = 0; e < 6; e++) assert.equal(r2[e], d.edges[(e - 2 + 6) % 6]);
  assert.deepEqual(E.tileEdges(d.id, 6), d.edges);
  assert.equal(E.uniqueRotations(0).length, 1);
});

// ---------- Aufbau ----------
test('createGame: 1 bis 4 Personen, Stapel 20n+3, Markt, Marker', () => {
  assert.throws(() => E.createGame(names(0), {}, mulberry(1)), RangeError);
  assert.throws(() => E.createGame(names(5), {}, mulberry(1)), RangeError);
  for (let n = 1; n <= 4; n++) {
    const s = E.createGame(names(n), {}, mulberry(n));
    assert.equal(s.players.length, n);
    assert.equal(s.market.tiles.length, 4);
    assert.equal(s.market.tokens.length, 4);
    assert.equal(s.bagTiles.length, 20 * n + 3 - 4);
    assert.equal(E.tileBalance(s).summe, 20 * n + 3);
    assert.equal(E.tokenBalance(s).summe, 100);
    assert.equal(new Set(s.market.tiles).size, 4);
    assert.ok(!s.market.tokens.every((t) => t === s.market.tokens[0]));
    assert.equal(s.phase, 'choose');
    const starts = s.players.map((p) => p.start);
    assert.equal(new Set(starts).size, n);
    for (const p of s.players) {
      assert.equal(Object.keys(p.board).length, 3);
      assert.equal(p.nature, 0);
      assert.equal(p.turns, 0);
    }
  }
});

// ---------- Zugablauf ----------
test('Zugablauf: choose -> tile -> token -> nächste Person', () => {
  const rng = mulberry(7);
  const s = E.createGame(names(2), {}, rng);
  const t0 = s.market.tiles[2], k0 = s.market.tokens[2];
  assert.equal(E.handle(s, 'p0', { t: 'pick', i: 2 }, rng).ok, true);
  assert.equal(s.phase, 'tile');
  const cells = E.legalTilePlacements(s);
  assert.ok(cells.length >= 5);
  const c = cells[0];
  assert.equal(E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 3 }, rng).ok, true);
  const cell = s.players[0].board[c.q + ',' + c.r];
  assert.deepEqual([cell.t, cell.rot, cell.tok], [t0, 3, null]);
  if (s.phase === 'token') {
    const o = E.tokenOptions(s);
    assert.ok(o.length > 0);
    const spot = o[0];
    assert.equal(E.handle(s, 'p0', { t: 'token', q: spot.q, r: spot.r }, rng).ok, true);
    assert.equal(s.players[0].board[spot.q + ',' + spot.r].tok, k0);
  }
  assert.equal(s.phase, 'choose');
  assert.equal(s.active, 1);
  assert.equal(s.players[0].turns, 1);
  assert.ok(s.market.tiles.every((t) => t !== null) && s.market.tokens.every((t) => t));
  assert.equal(E.tileBalance(s).summe, 43);
  assert.equal(E.tokenBalance(s).summe, 100);
});

test('Verwerfen: Marker geht in den Sack zurück', () => {
  const rng = mulberry(8);
  const s = E.createGame(names(2), {}, rng);
  E.handle(s, 'p0', { t: 'pick', i: 0 }, rng);
  const c = E.legalTilePlacements(s)[0];
  E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng);
  if (s.phase === 'token') assert.equal(E.handle(s, 'p0', { t: 'token', discard: true }, rng).ok, true);
  assert.equal(s.active, 1);
  assert.equal(E.tokenBalance(s).brett, 0);
  assert.equal(E.tokenBalance(s).summe, 100);
  assert.equal(E.tokenBalance(s).sack, 96);
});

test('ungültige Züge', () => {
  const rng = mulberry(9);
  const s = E.createGame(names(2), {}, rng);
  const no = (pid, m) => { const r = E.handle(s, pid, m, rng); assert.equal(r.ok, false, JSON.stringify(m)); assert.equal(typeof r.error, 'string'); };
  no('p1', { t: 'pick', i: 0 });
  no('p0', { t: 'pick', i: 4 });
  no('p0', { t: 'pick', i: -1 });
  no('p0', { t: 'pick', i: 1.5 });
  no('p0', { t: 'tile', q: 0, r: 0, rot: 0 }); // falsche Phase
  no('p0', { t: 'token', discard: true });
  no('p0', { t: 'free', ti: 0, mi: 1 }); // kein Naturmarker
  no('p0', { t: 'wipe', idx: [0] });
  no('p0', { t: 'wipe3' });
  no('p0', null);
  no('p0', { t: 'quatsch' });
  assert.equal(E.handle(s, 'p0', { t: 'pick', i: 0 }, rng).ok, true);
  no('p0', { t: 'pick', i: 1 });
  no('p0', { t: 'tile', q: 0, r: 0, rot: 0 }); // belegt
  no('p0', { t: 'tile', q: 9, r: 9, rot: 0 }); // nicht angrenzend
  const c = E.legalTilePlacements(s)[0];
  no('p0', { t: 'tile', q: c.q, r: c.r, rot: 6 });
  no('p0', { t: 'tile', q: c.q, r: c.r, rot: -1 });
  no('p0', { t: 'tile', q: c.q, r: c.r, rot: 0.5 });
  no('p0', { t: 'tile', q: 'a', r: c.r, rot: 0 });
  no('p1', { t: 'tile', q: c.q, r: c.r, rot: 0 });
  assert.equal(E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng).ok, true);
  if (s.phase === 'token') {
    const bad = Object.keys(s.players[0].board).map((k) => k.split(',').map(Number))
      .find(([q, r]) => !E.tokenOptions(s).some((o) => o.q === q && o.r === r));
    if (bad) no('p0', { t: 'token', q: bad[0], r: bad[1] });
    no('p0', { t: 'token', q: 50, r: 50 });
    no('p0', { t: 'tile', q: 3, r: 3, rot: 0 });
  }
});

test('Marker nur auf erlaubte, unbelegte Plättchen', () => {
  const rng = mulberry(10);
  const s = E.createGame(names(1), {}, rng);
  const me = s.players[0];
  s.market.tokens[0] = 'baer';
  s.market.tiles[0] = KEYTILE('wald', 'hirsch'); // erlaubt nur Hirsch
  E.handle(s, 'p0', { t: 'pick', i: 0 }, rng);
  const c = E.legalTilePlacements(s)[0];
  E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng);
  const opts = E.tokenOptions(s);
  assert.ok(!opts.some((o) => o.q === c.q && o.r === c.r));
  for (const o of opts) assert.ok(E.tileDef(me.board[o.q + ',' + o.r].t).animals.includes('baer'));
  // Auf dem eben gelegten Plättchen (falls erlaubt) darf gesetzt werden
  const s2 = E.createGame(names(1), {}, rng);
  s2.market.tokens[1] = 'lachs';
  s2.market.tiles[1] = KEYTILE('fluss', 'lachs');
  E.handle(s2, 'p0', { t: 'pick', i: 1 }, rng);
  const c2 = E.legalTilePlacements(s2)[0];
  E.handle(s2, 'p0', { t: 'tile', q: c2.q, r: c2.r, rot: 0 }, rng);
  assert.ok(E.tokenOptions(s2).some((o) => o.q === c2.q && o.r === c2.r));
  // Ein belegtes Plättchen ist keine Option mehr
  s2.players[0].board[c2.q + ',' + c2.r].tok = 'lachs';
  assert.ok(!E.tokenOptions(s2).some((o) => o.q === c2.q && o.r === c2.r));
});

test('Schlüsselplättchen gibt einen Naturmarker, Doppelplättchen nicht', () => {
  const rng = mulberry(11);
  const s = E.createGame(names(2), {}, rng);
  s.market.tiles[0] = KEYTILE('berg', 'fuchs'); s.market.tokens[0] = 'fuchs';
  s.market.tiles[1] = E.TILES.find((t) => !t.key && t.animals.includes('falke')).id; s.market.tokens[1] = 'falke';
  s.bag.fuchs--; s.bag.falke--; // Bilanz bleibt: Marker wurden nur umgesetzt (Test setzt Markt direkt)
  E.handle(s, 'p0', { t: 'pick', i: 0 }, rng);
  const c = E.legalTilePlacements(s)[0];
  E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng);
  E.handle(s, 'p0', { t: 'token', q: c.q, r: c.r }, rng);
  assert.equal(s.players[0].nature, 1);
  assert.equal(s.players[0].board[c.q + ',' + c.r].tok, 'fuchs');
  // zweite Person: Doppelplättchen
  s.market.tiles[1] = E.TILES.find((t) => !t.key && t.animals.includes('falke')).id; s.market.tokens[1] = 'falke';
  E.handle(s, 'p1', { t: 'pick', i: 1 }, rng);
  const c1 = E.legalTilePlacements(s)[0];
  E.handle(s, 'p1', { t: 'tile', q: c1.q, r: c1.r, rot: 0 }, rng);
  E.handle(s, 'p1', { t: 'token', q: c1.q, r: c1.r }, rng);
  assert.equal(s.players[1].nature, 0);
});

// ---------- Überbevölkerung ----------
test('Überbevölkerung 4: vier gleiche Marker werden sofort automatisch ersetzt', () => {
  const s = E.createGame(names(1), {}, mulberry(13));
  s.market.tokens = ['baer', 'baer', 'baer', 'lachs'];
  for (const a of E.ANIMALS) s.bag[a] = 20 - s.market.tokens.filter((t) => t === a).length;
  assert.equal(E.tokenBalance(s).summe, 100);
  // Der erste Zug aus dem Sack liefert einen Bären (rng 0), danach gemischte Werte
  const seq = [0, 0.05, 0.35, 0.55, 0.95];
  let n = 0;
  const rng = () => seq[n++ % seq.length];
  E.handle(s, 'p0', { t: 'pick', i: 3 }, rng);
  const c = E.legalTilePlacements(s)[0];
  E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng);
  if (s.phase === 'token') E.handle(s, 'p0', { t: 'token', discard: true }, rng);
  assert.ok(s.recap.some((x) => x.includes('Vier gleiche')), s.recap.join('|'));
  assert.ok(!s.market.tokens.every((t) => t === 'baer'));
  assert.equal(E.tokenBalance(s).summe, 100);
});

test('Überbevölkerung 3: wipe3 ersetzt genau die drei gleichen, nur einmal, nur bei genau drei', () => {
  const rng = mulberry(14);
  const s = E.createGame(names(2), {}, rng);
  s.market.tokens = ['hirsch', 'lachs', 'hirsch', 'hirsch'];
  s.bag.hirsch += 0;
  // Bilanz herstellen: Marker im Markt sind umgesetzt, Sack passt nicht – daher nur Verhalten prüfen
  const before = s.market.tokens.slice();
  assert.equal(E.handle(s, 'p0', { t: 'wipe3' }, rng).ok, true);
  assert.equal(s.market.tokens[1], before[1]);
  assert.equal(s.usedWipe3, true);
  assert.equal(E.handle(s, 'p0', { t: 'wipe3' }, rng).ok, false);
  assert.equal(s.phase, 'choose');
  assert.equal(s.players[0].nature, 0);
  // vier verschiedene/zwei Paare -> nicht erlaubt
  const t = E.createGame(names(2), {}, rng);
  t.market.tokens = ['hirsch', 'hirsch', 'lachs', 'lachs'];
  assert.equal(E.handle(t, 'p0', { t: 'wipe3' }, rng).ok, false);
  // nächste Runde wieder erlaubt (Flag zurückgesetzt)
  s.market.tokens = ['baer', 'baer', 'baer', 'fuchs'];
  E.handle(s, 'p0', { t: 'pick', i: 3 }, rng);
  const c = E.legalTilePlacements(s)[0];
  E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng);
  if (s.phase === 'token') E.handle(s, 'p0', { t: 'token', discard: true }, rng);
  assert.equal(s.usedWipe3, false);
});

test('Marker bleiben im Zug nach wipe3 erhalten: Bilanz 100', () => {
  const rng = mulberry(15);
  const s = E.createGame(names(2), {}, rng);
  for (let i = 0; i < 30; i++) {
    const p = s.players[s.active].id;
    if (!s.usedWipe3 && s.phase === 'choose') E.handle(s, p, { t: 'wipe3' }, rng);
    E.handle(s, p, { t: 'pick', i: 0 }, rng);
    const c = E.legalTilePlacements(s)[0];
    E.handle(s, p, { t: 'tile', q: c.q, r: c.r, rot: 0 }, rng);
    if (s.phase === 'token') E.handle(s, p, { t: 'token', discard: true }, rng);
    assert.equal(E.tokenBalance(s).summe, 100);
  }
});

// ---------- Naturmarker ----------
test('Naturmarker Variante A: beliebiges Plättchen und beliebiger Marker', () => {
  const rng = mulberry(16);
  const s = E.createGame(names(2), {}, rng);
  s.players[0].nature = 2;
  const t3 = s.market.tiles[3], k1 = s.market.tokens[1];
  assert.equal(E.handle(s, 'p0', { t: 'free', ti: 1, mi: 1 }, rng).ok, false);
  assert.equal(s.players[0].nature, 2);
  assert.equal(E.handle(s, 'p0', { t: 'free', ti: 3, mi: 1 }, rng).ok, true);
  assert.equal(s.players[0].nature, 1);
  assert.equal(s.phase, 'tile');
  const c = E.legalTilePlacements(s)[0];
  E.handle(s, 'p0', { t: 'tile', q: c.q, r: c.r, rot: 1 }, rng);
  assert.equal(s.players[0].board[c.q + ',' + c.r].t, t3);
  const spot = E.tokenOptions(s)[0];
  if (spot) {
    E.handle(s, 'p0', { t: 'token', q: spot.q, r: spot.r }, rng);
    assert.equal(s.players[0].board[spot.q + ',' + spot.r].tok, k1);
  }
  assert.ok(s.market.tiles[3] !== null && s.market.tokens[1] !== null);
  assert.equal(E.tokenBalance(s).summe, 100);
  assert.equal(E.tileBalance(s).summe, 43);
});

test('Naturmarker Variante B: Marker tauschen, einmal pro Zug', () => {
  const rng = mulberry(17);
  const s = E.createGame(names(2), {}, rng);
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [0, 1] }, rng).ok, false);
  s.players[0].nature = 2;
  const old = s.market.tokens.slice();
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [] }, rng).ok, false);
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [0, 0] }, rng).ok, false);
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [4] }, rng).ok, false);
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [0, 2] }, rng).ok, true);
  assert.equal(s.players[0].nature, 1);
  assert.equal(s.market.tokens[1], old[1]);
  assert.equal(s.market.tokens[3], old[3]);
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [1] }, rng).ok, false); // zweites Mal
  assert.equal(s.players[0].nature, 1);
  assert.equal(s.phase, 'choose');
  assert.equal(E.tokenBalance(s).summe, 100);
  assert.equal(E.handle(s, 'p0', { t: 'pick', i: 0 }, rng).ok, true); // danach normaler Zug
  // während Tile-Phase nicht mehr
  assert.equal(E.handle(s, 'p0', { t: 'wipe', idx: [1] }, rng).ok, false);
});

// ---------- Wertung ----------
test('Wertung Bär: Paare 4/11/19/27', () => {
  const pairsAt = (n) => {
    const c = [];
    for (let i = 0; i < n; i++) c.push([i * 4, 0], [i * 4 + 1, 0]);
    return c;
  };
  const want = [0, 4, 11, 19, 27, 27];
  for (let n = 0; n <= 5; n++) assert.equal(sc(toks('baer', pairsAt(n))).tiere.baer, want[n], `${n} Paare`);
  // Dreiergruppe zählt nicht, Einzelbär auch nicht
  const cells = toks('baer', [[0, 0], [1, 0], [0, 1], [10, 10], [20, 0], [21, 0]]);
  assert.equal(sc(cells).tiere.baer, 4);
});

test('Wertung Hirsch: Linien 2/5/9/13, deterministische Zerlegung', () => {
  assert.equal(sc(toks('hirsch', [[0, 0]])).tiere.hirsch, 2);
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0]])).tiere.hirsch, 5);
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0], [2, 0]])).tiere.hirsch, 9);
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0], [2, 0], [3, 0]])).tiere.hirsch, 13);
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])).tiere.hirsch, 13);
  // schräge Achsen: SO-Richtung (0,+1) und SW-Richtung (-1,+1)
  assert.equal(sc(toks('hirsch', [[0, 0], [0, 1], [0, 2]])).tiere.hirsch, 9);
  assert.equal(sc(toks('hirsch', [[2, 0], [1, 1], [0, 2]])).tiere.hirsch, 9);
  // Nicht gerade (Knick): 2 + 2 = 5 + 2? (0,0),(1,0) E-Linie 5, dann (1,1) einzeln 2
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0], [1, 1]])).tiere.hirsch, 7);
  // T-Form: längste Linie zuerst (3 in E-Richtung = 9), Rest einzeln (2)
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0], [2, 0], [1, 1]])).tiere.hirsch, 11);
  // mehrere getrennte Linien: 9 + 5 + 2
  assert.equal(sc(toks('hirsch', [[0, 0], [1, 0], [2, 0], [10, 0], [10, 1], [20, 20]])).tiere.hirsch, 16);
});

test('Wertung Lachs: Läufe 2/4/7/11/15/20/26, Verzweigung zählt nicht', () => {
  const want = [0, 2, 4, 7, 11, 15, 20, 26, 26, 26];
  for (let n = 1; n <= 9; n++) {
    const c = [];
    for (let i = 0; i < n; i++) c.push([i, 0]);
    assert.equal(sc(toks('lachs', c)).tiere.lachs, want[n], `Länge ${n}`);
  }
  // Zentrum (10,0) mit 3 Lachs-Nachbarn: ganze Gruppe zählt nicht
  const fork = toks('lachs', [[10, 0], [11, 0], [9, 0], [10, 1]]);
  assert.equal(sc(fork).tiere.lachs, 0);
  // Kombination: Dreierlauf 7 + Einzel 2 + Zweierlauf 4 + Verzweigung 0 = 13
  const all = toks('lachs', [[0, 0], [1, 0], [2, 0], [20, 20], [0, 5], [1, 5], [10, 10], [11, 10], [9, 10], [10, 11]]);
  assert.equal(sc(all).tiere.lachs, 13);
  // Dreieck (jeder 2 Nachbarn) ist ein gültiger Lauf der Länge 3
  assert.equal(sc(toks('lachs', [[0, 0], [1, 0], [0, 1]])).tiere.lachs, 7);
});

test('Wertung Falke: nur Einzelgänger 2/5/8/11/14/18/22/26', () => {
  const want = [0, 2, 5, 8, 11, 14, 18, 22, 26, 26];
  for (let n = 1; n <= 9; n++) {
    const c = [];
    for (let i = 0; i < n; i++) c.push([i * 3, 0]);
    assert.equal(sc(toks('falke', c)).tiere.falke, want[n], `${n} Falken`);
  }
  const mixed = toks('falke', [[0, 0], [5, 5], [9, 9], [20, 0], [21, 0]]);
  assert.equal(sc(mixed).tiere.falke, 8);
});

test('Wertung Fuchs: verschiedene Tierarten ohne Fuchs auf den Nachbarn', () => {
  // Fuchs mit Bär, Hirsch, Lachs -> 3; zweiter Fuchs mit 2 Bären und einem Fuchs -> 1
  const cells = [
    [0, 0, 0, 0, 'fuchs'], [1, 0, 0, 0, 'baer'], [0, 1, 0, 0, 'hirsch'], [-1, 1, 0, 0, 'lachs'],
    [10, 0, 0, 0, 'fuchs'], [11, 0, 0, 0, 'baer'], [9, 0, 0, 0, 'baer'], [10, 1, 0, 0, 'fuchs'],
  ];
  const t = sc(cells).tiere;
  // Fuchs (10,1) hat Nachbarn (10,0)=Fuchs und (9,1)? leer, (11,0)=Bär ((10,1)+(1,-1)) -> 1 Art
  assert.equal(t.fuchs, 3 + 1 + 1 + 0);
  // alle vier anderen Arten -> 4
  const f4 = [[0, 0, 0, 0, 'fuchs'], [1, 0, 0, 0, 'baer'], [0, 1, 0, 0, 'hirsch'], [-1, 1, 0, 0, 'lachs'], [-1, 0, 0, 0, 'falke']];
  assert.equal(sc(f4).tiere.fuchs, 4);
  assert.equal(sc([[0, 0, 0, 0, 'fuchs']]).tiere.fuchs, 0);
  // zwei Füchse teilen sich einen Nachbarn, jeder zählt einzeln: Bär zwischen zwei Füchsen
  assert.equal(sc([[0, 0, 0, 0, 'fuchs'], [1, 0, 0, 0, 'baer'], [2, 0, 0, 0, 'fuchs']]).tiere.fuchs, 2);
});

test('Wertung Lebensraum: größte Gruppen, Doppelplättchen zählen in beiden', () => {
  const D = E.TILES.find((t) => t.edges[0] === 'berg' && t.edges[2] === 'berg' && t.edges[3] === 'wald' && t.edges[5] === 'wald');
  assert.ok(D);
  const berg = (a) => KEYTILE('berg', a);
  const wald = (a) => KEYTILE('wald', a);
  // D mit Drehung 3: Berg auf Kanten 3,4,5 (SW,W,NW), Wald auf Kanten 0,1,2 (NO,O,SO)
  const cells = [
    [0, 0, berg('baer')], [1, 0, berg('hirsch')], [2, 0, D.id, 3],
    [3, 0, wald('lachs')], [3, -1, wald('falke')],
    [-1, 0, wald('baer')], [5, 5, KEYTILE('fluss', 'baer')],
  ];
  const r = sc(cells).lebensraum;
  assert.deepEqual(r, { berg: 3, wald: 3, wiese: 0, sumpf: 0, fluss: 1 });
  // Drehung 0: D zeigt Berg nach rechts: (2,0) berührt (1,0) mit Wald-Kante -> keine Verbindung zu Berg
  const cells0 = [[0, 0, berg('baer')], [1, 0, berg('hirsch')], [2, 0, D.id, 0]];
  assert.equal(sc(cells0).lebensraum.berg, 2);
  assert.equal(sc(cells0).lebensraum.wald, 1);
  // gleiche Kante muss auf beiden Seiten gleich sein, nicht nur ein Plättchen
  const diag = [[0, 0, berg('baer')], [1, -1, berg('baer')]];
  assert.equal(sc(diag).lebensraum.berg, 2);
  // Gruppe über Doppelplättchen hinweg: Berg - D(rot3) - Berg auf der anderen Seite? D hat nur einen Berg-Bogen (W-Seite), rechts Wald
  const sr = sc([[0, 0, wald('baer')], [1, 0, D.id, 0], [2, 0, berg('hirsch')]]).lebensraum;
  assert.equal(sr.wald, 2);
  assert.equal(sr.berg, 2);
});

test('Wertung score(): Summe, Bonus (Alleinig 3, Gleichstand je 1, Solo 0), Naturmarker', () => {
  const s = E.createGame(names(2), {}, mulberry(20));
  const mk = (n, h) => { const c = []; for (let i = 0; i < n; i++) c.push([i, 0, KEYTILE(h, 'baer')]); return mkBoard(c); };
  s.players[0].board = Object.assign(mk(3, 'berg'), mkBoard([[0, 5, KEYTILE('wald', 'baer')], [1, 5, KEYTILE('wald', 'hirsch')]]));
  s.players[1].board = Object.assign(mk(2, 'berg'), mkBoard([[0, 5, KEYTILE('wald', 'baer')], [1, 5, KEYTILE('wald', 'hirsch')], [0, 9, KEYTILE('fluss', 'baer')]]));
  s.players[0].nature = 2;
  const a = E.score(s, 'p0'), b = E.score(s, 'p1');
  assert.deepEqual(a.lebensraum, { berg: 3, wald: 2, wiese: 0, sumpf: 0, fluss: 0 });
  assert.equal(a.bonus, 3 + 1); // Berg alleinig, Wald Gleichstand
  assert.equal(b.bonus, 1 + 3); // Wald Gleichstand, Fluss alleinig
  assert.equal(a.natur, 2);
  assert.equal(a.summe, 3 + 2 + 4 + 2);
  assert.equal(b.summe, 2 + 2 + 1 + 4 + 0);
  const solo = E.createGame(names(1), {}, mulberry(21));
  solo.players[0].board = mk(4, 'berg');
  assert.equal(E.score(solo, 'p0').bonus, 0);
  assert.equal(E.score(solo, 'p0').summe, 4);
  assert.equal(E.score(s, 'nobody'), null);
});

test('Wertung: Gesamtlandschaft mit bekannter Summe', () => {
  const s = E.createGame(names(1), {}, mulberry(22));
  const D = E.TILES.find((t) => !t.key).id;
  s.players[0].board = mkBoard([
    [0, 0, KEYTILE('berg', 'baer'), 0, 'baer'], [1, 0, KEYTILE('berg', 'baer'), 0, 'baer'], // Bärenpaar 4
    [0, 3, D, 0, 'falke'], [5, 3, D, 0, 'falke'], // 2 Falken 5
    [0, 6, D, 0, 'hirsch'], // Hirsch 2
    [0, 8, D, 0, 'fuchs'], // Fuchs ohne Nachbarn 0
  ]);
  s.players[0].nature = 1;
  const r = E.score(s, 'p0');
  assert.deepEqual(r.tiere, { baer: 4, hirsch: 2, lachs: 0, falke: 5, fuchs: 0 });
  assert.equal(r.natur, 1);
  const hab = Object.values(r.lebensraum).reduce((a, b) => a + b, 0);
  assert.equal(r.summe, 11 + hab + 1);
});

// ---------- Spielende / Rangliste ----------
function playRandom(n, seed, opts = {}) {
  const rng = mulberry(seed);
  const s = E.createGame(names(n), opts, rng);
  let steps = 0;
  while (s.phase !== 'over') {
    assert.ok(steps++ < 2000, 'Endlosspiel');
    const id = E.activePlayer(s).id;
    let m;
    if (s.phase === 'choose') {
      const me = E.activePlayer(s);
      const roll = rng();
      if (roll < 0.1 && !s.usedWipe3 && s.market.tokens.filter((t) => t === s.market.tokens[0]).length === 3) m = { t: 'wipe3' };
      else if (roll < 0.2 && me.nature >= 1 && !s.usedWipe) m = { t: 'wipe', idx: [Math.floor(rng() * 4)] };
      else if (roll < 0.3 && me.nature >= 1) { const ti = Math.floor(rng() * 4); m = { t: 'free', ti, mi: (ti + 1 + Math.floor(rng() * 3)) % 4 }; }
      else m = { t: 'pick', i: Math.floor(rng() * 4) };
    } else if (s.phase === 'tile') {
      const c = pick(E.legalTilePlacements(s), rng);
      m = { t: 'tile', q: c.q, r: c.r, rot: Math.floor(rng() * 6) };
    } else {
      const o = E.tokenOptions(s);
      m = o.length && rng() < 0.7 ? { t: 'token', ...pick(o, rng) } : { t: 'token', discard: true };
    }
    const r = E.handle(s, id, m, rng);
    assert.equal(r.ok, true, JSON.stringify(m) + ' ' + r.error);
    assert.equal(E.tokenBalance(s).summe, 100);
  }
  return s;
}

test('Spielende nach 20 Zügen je Person, 1 bis 4 Personen', () => {
  for (let n = 1; n <= 4; n++) {
    const s = playRandom(n, 100 + n);
    assert.equal(s.phase, 'over');
    assert.ok(s.players.every((p) => p.turns === 20), `n=${n}`);
    assert.ok(s.players.every((p) => Object.keys(p.board).length === 23));
    assert.equal(E.tileBalance(s).stapel, 0 + 0 * n);
    assert.equal(E.tileBalance(s).summe, 20 * n + 3);
    assert.equal(s.market.tiles.filter((t) => t !== null).length, 3);
    assert.ok(s.result && s.result.winners.length >= 1);
    assert.equal(E.handle(s, s.players[0].id, { t: 'pick', i: 0 }, mulberry(1)).ok, false);
  }
});

test('opts.turns verkürzt das Spiel', () => {
  const s = playRandom(2, 5, { turns: 3 });
  assert.ok(s.players.every((p) => p.turns === 3));
  assert.equal(s.bagTiles.length, 0);
});

test('ranking: Punkte, dann Naturmarker, dann geteilter Sieg', () => {
  const s = E.createGame(names(3), {}, mulberry(30));
  const mkB = (n) => { const c = []; for (let i = 0; i < n; i++) c.push([i, 0, KEYTILE('berg', 'baer')]); return mkBoard(c); };
  s.players[0].board = mkB(3); s.players[1].board = mkB(2); s.players[2].board = mkB(2);
  // Bonus Berg: P0 alleinig +3 -> P0 3+3=6; P1,P2 je 2
  let r = E.ranking(s);
  assert.deepEqual(r.map((x) => [x.id, x.place]), [['p0', 1], ['p1', 2], ['p2', 2]]);
  s.players[2].nature = 1; // P2 hat 2+1 = 3
  r = E.ranking(s);
  assert.deepEqual(r.map((x) => x.id), ['p0', 'p2', 'p1']);
  assert.deepEqual(r.map((x) => x.place), [1, 2, 3]);
  // Gleichstand Punkte und Naturmarker: geteilter Sieg
  const t = E.createGame(names(2), {}, mulberry(31));
  t.players[0].board = mkB(2); t.players[1].board = mkB(2);
  assert.deepEqual(E.ranking(t).map((x) => x.place), [1, 1]);
  // Gleiche Punkte, anderer Naturmarkerstand: Naturmarker zählen als Punkt -> Tie-Break greift bei Punktgleichheit mit unterschiedlichem Rest
  t.players[0].board = mkB(3); t.players[1].board = mkB(2); t.players[1].nature = 3; // P0: 3+3 = 6, P1: 2+3 = 5 -> keine Gleichheit
  assert.equal(E.ranking(t)[0].id, 'p0');
  t.players[1].nature = 4; t.players[0].board = mkB(3);
  // P1: 2+4 = 6, P0: 3+3 = 6 -> mehr Naturmarker gewinnt
  assert.equal(E.ranking(t)[0].id, 'p1');
});

test('JSON-Sicherheit: Zustand überlebt Serialisierung mitten im Spiel', () => {
  const rng = mulberry(40);
  const s = E.createGame(names(3), {}, rng);
  for (let i = 0; i < 25; i++) {
    const id = E.activePlayer(s).id;
    if (s.phase === 'choose') E.handle(s, id, { t: 'pick', i: i % 4 }, rng);
    if (s.phase === 'tile') { const c = E.legalTilePlacements(s)[i % 5]; E.handle(s, id, { t: 'tile', q: c.q, r: c.r, rot: i % 6 }, rng); }
    if (s.phase === 'token') { const o = E.tokenOptions(s); if (o.length) E.handle(s, id, { t: 'token', ...o[0] }, rng); else E.handle(s, id, { t: 'token', discard: true }, rng); }
    const copy = JSON.parse(JSON.stringify(s));
    assert.deepEqual(copy, s);
    assert.ok(!JSON.stringify(s).includes('undefined'));
  }
  const copy = JSON.parse(JSON.stringify(s));
  const r1 = mulberry(99), r2 = mulberry(99);
  E.handle(s, E.activePlayer(s).id, { t: 'pick', i: 0 }, r1);
  E.handle(copy, E.activePlayer(copy).id, { t: 'pick', i: 0 }, r2);
  assert.deepEqual(copy, s);
  assert.deepEqual(E.score(copy, 'p0'), E.score(s, 'p0'));
});

test('300 Zufallspartien enden ohne Absturz, Marker- und Plättchenbilanz stimmt', () => {
  for (let i = 0; i < 300; i++) {
    const n = 1 + (i % 4);
    const s = playRandom(n, 1000 + i);
    assert.equal(s.phase, 'over');
    assert.equal(E.tokenBalance(s).summe, 100);
    assert.equal(E.tileBalance(s).summe, 20 * n + 3);
    for (const p of s.players) assert.ok(E.score(s, p.id).summe >= 0);
  }
});
