import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../mahjong/engine.js';
import { LAYOUTS, LAYOUT_KEYS } from '../mahjong/layouts.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = [{ id: 'p0', name: 'Du' }];
const H = (pos, kinds) => ({ geo: E.geometryFrom(pos), kinds });
const free = (b, i) => E.isFreeIn(b.geo, b.kinds, i);
const clone = (x) => JSON.parse(JSON.stringify(x));
const LIMIT = 5000000;

// ---------- Steinsatz ----------
test('Satz: 144 Steine, 36 Arten, je 4 Stück', () => {
  const set = E.fullSet();
  assert.equal(set.length, 144);
  const cnt = new Map();
  for (const k of set) cnt.set(k, (cnt.get(k) || 0) + 1);
  assert.equal(cnt.size, 36);
  assert.equal(E.KIND_COUNT, 36);
  for (const [k, c] of cnt) assert.equal(c, 4, `Art ${k}`);
  assert.equal(E.allPairs().length, 72);
});

test('Satz: Zusammensetzung (3 Farben x 9, 4 Winde, 3 Drachen, Blumen, Jahreszeiten)', () => {
  const types = {};
  for (let k = 0; k < 36; k++) { const i = E.kindInfo(k); types[i.type] = (types[i.type] || 0) + 1; }
  assert.deepEqual(types, { suit: 27, wind: 4, dragon: 3, flower: 1, season: 1 });
  // 108 Farbsteine, 16 Winde, 12 Drachen, 4 Blumen, 4 Jahreszeiten
  const by = {};
  for (const k of E.fullSet()) { const t = E.kindInfo(k).type; by[t] = (by[t] || 0) + 1; }
  assert.deepEqual(by, { suit: 108, wind: 16, dragon: 12, flower: 4, season: 4 });
  for (let s = 0; s < 3; s++) for (let n = 1; n <= 9; n++) { const i = E.kindInfo(s * 9 + n - 1); assert.equal(i.suit, s); assert.equal(i.n, n); }
  assert.deepEqual([27, 28, 29, 30].map((k) => E.kindInfo(k).name), ['Wind Ost', 'Wind Süd', 'Wind West', 'Wind Nord']);
  assert.equal(E.kindInfo(36), null); assert.equal(E.kindInfo(-1), null); assert.equal(E.kindInfo(1.5), null);
});

test('Gleichheit: nur gleiche Art, alle Blumen und alle Jahreszeiten gleich', () => {
  assert.equal(E.sameKind(0, 0), true);
  assert.equal(E.sameKind(0, 1), false);
  assert.equal(E.sameKind(0, 9), false); // Kreise 1 und Stäbe 1
  assert.equal(E.sameKind(E.FLOWER, E.FLOWER), true);
  assert.equal(E.sameKind(E.SEASON, E.SEASON), true);
  assert.equal(E.sameKind(E.FLOWER, E.SEASON), false);
  assert.equal(E.sameKind(-1, -1), false);
  assert.equal(E.sameKind(undefined, undefined), false);
  assert.equal(E.sameKind(27, 28), false);
  assert.equal(E.sameKind(31, 32), false);
});

// ---------- Brettformen ----------
test('Brettformen: Anzahl, gültige Koordinaten, keine Überschneidung auf einer Ebene', () => {
  const want = { schildkroete: 144, pyramide: 72, mauer: 48, lern: 12 };
  for (const key of Object.keys(want)) {
    const t = LAYOUTS[key].tiles;
    assert.equal(t.length, want[key], key);
    assert.equal(t.length % 2, 0);
    const seen = new Set();
    for (const [z, x, y] of t) {
      assert.ok(Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y), key);
      assert.ok(z >= 0 && z <= 4 && x >= 0 && y >= 0, key);
      assert.ok(!seen.has(`${z},${x},${y}`), `doppelt ${key}`);
      seen.add(`${z},${x},${y}`);
    }
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      if (t[i][0] !== t[j][0]) continue;
      const overlap = Math.abs(t[i][1] - t[j][1]) < 2 && Math.abs(t[i][2] - t[j][2]) < 2;
      assert.ok(!overlap, `${key}: Überschneidung ${t[i]} / ${t[j]}`);
    }
  }
  assert.deepEqual(LAYOUT_KEYS, ['schildkroete', 'pyramide', 'mauer']);
});

test('Brettformen: jeder Stein auf höherer Ebene liegt auf mindestens einem Stein darunter; spiegelsymmetrisch (oben/unten)', () => {
  for (const key of Object.keys(LAYOUTS)) {
    const t = LAYOUTS[key].tiles;
    for (const [z, x, y] of t) {
      if (z === 0) continue;
      assert.ok(t.some(([z2, x2, y2]) => z2 === z - 1 && Math.abs(x2 - x) <= 1 && Math.abs(y2 - y) <= 1), `${key}: ${z},${x},${y} schwebt`);
    }
    if (key === 'lern') continue;
    const maxY = Math.max(...t.map((a) => a[2]));
    const set = new Set(t.map((a) => a.join()));
    for (const [z, x, y] of t) assert.ok(set.has([z, x, maxY - y].join()), `${key}: Spiegelung ${z},${x},${y}`);
  }
});

test('Schildkröte: Ebenen 87 / 36 / 16 / 4 / 1', () => {
  const t = LAYOUTS.schildkroete.tiles;
  assert.deepEqual([0, 1, 2, 3, 4].map((z) => t.filter((a) => a[0] === z).length), [87, 36, 16, 4, 1]);
});

test('Geometrie: Bounds und Nachbarschaft', () => {
  const b = E.layoutBounds('schildkroete');
  assert.deepEqual(b, { cols: 30, rows: 16, levels: 4 });
  assert.equal(E.layoutBounds('pyramide').levels, 3);
  const geo = E.geometry('schildkroete');
  assert.equal(geo.n, 144);
  assert.equal(E.geometry('gibtsnicht'), null);
});

// ---------- Frei-Regel (handgebaute Fälle) ----------
test('frei: einzelner Stein, leerer Platz, ungültige Eingaben', () => {
  const b = H([[0, 0, 0]], [3]);
  assert.equal(free(b, 0), true);
  assert.equal(free(b, 1), false);
  assert.equal(free(b, -1), false);
  assert.equal(free(b, 0.5), false);
  assert.equal(free(b, '0'), false);
  assert.equal(E.isFreeIn(null, [3], 0), false);
  assert.equal(E.isFreeIn(b.geo, null, 0), false);
  assert.equal(free({ geo: b.geo, kinds: [-1] }, 0), false); // schon weg
});

test('frei: zwei nebeneinander sind beide frei, drei in einer Reihe: die Mitte nicht', () => {
  const two = H([[0, 0, 0], [0, 2, 0]], [1, 1]);
  assert.equal(free(two, 0), true); assert.equal(free(two, 1), true);
  const three = H([[0, 0, 0], [0, 2, 0], [0, 4, 0]], [1, 1, 1]);
  assert.deepEqual([0, 1, 2].map((i) => free(three, i)), [true, false, true]);
  // Mitte wird frei, wenn ein Nachbar weg ist
  assert.equal(free({ geo: three.geo, kinds: [-1, 1, 1] }, 1), true);
  assert.equal(free({ geo: three.geo, kinds: [1, 1, -1] }, 1), true);
});

test('frei: Lücke (4 Einheiten) zählt nicht als Nachbar', () => {
  const b = H([[0, 0, 0], [0, 4, 0], [0, 8, 0]], [1, 1, 1]);
  assert.deepEqual([0, 1, 2].map((i) => free(b, i)), [true, true, true]);
});

test('frei: Nachbar um eine halbe Zeile versetzt klemmt, um eine ganze Zeile versetzt nicht', () => {
  // Mitte (2,0); links (0,1) und rechts (4,-1... ) -> Zeilen dürfen nicht negativ sein, daher Mitte bei y=2
  const half = H([[0, 0, 3], [0, 2, 2], [0, 4, 1]], [1, 1, 1]);
  assert.equal(free(half, 1), false, 'beide Nachbarn um 1 versetzt klemmen');
  const full = H([[0, 0, 4], [0, 2, 2], [0, 4, 0]], [1, 1, 1]);
  assert.equal(free(full, 1), true, 'Nachbarn um 2 versetzt stehen daneben');
  const oneSide = H([[0, 0, 3], [0, 2, 2], [0, 4, 0]], [1, 1, 1]);
  assert.equal(free(oneSide, 1), true, 'nur links geklemmt');
});

test('frei: Stein auf einem Stein verdeckt ihn (auch halb versetzt), erst Abstand 2 nicht mehr', () => {
  const exact = H([[0, 2, 2], [1, 2, 2]], [1, 1]);
  assert.deepEqual([free(exact, 0), free(exact, 1)], [false, true]);
  const dx1 = H([[0, 2, 2], [1, 3, 2]], [1, 1]);
  assert.equal(free(dx1, 0), false);
  const dxy1 = H([[0, 2, 2], [1, 3, 3]], [1, 1]);
  assert.equal(free(dxy1, 0), false);
  const dx2 = H([[0, 2, 2], [1, 4, 2]], [1, 1]);
  assert.equal(free(dx2, 0), true);
  const dy2 = H([[0, 2, 2], [1, 2, 4]], [1, 1]);
  assert.equal(free(dy2, 0), true);
  const dyneg = H([[0, 2, 2], [1, 1, 1]], [1, 1]);
  assert.equal(free(dyneg, 0), false);
});

test('frei: Entfernen des oberen Steins gibt den unteren frei; zwei Ebenen darüber zählen auch', () => {
  const b = H([[0, 2, 2], [1, 2, 2], [2, 2, 2]], [1, 1, 1]);
  assert.deepEqual([0, 1, 2].map((i) => free(b, i)), [false, false, true]);
  assert.equal(free({ geo: b.geo, kinds: [1, 1, -1] }, 1), true);
  assert.equal(free({ geo: b.geo, kinds: [1, -1, 1] }, 0), false, 'Ebene 2 liegt weiter auf Ebene 0');
  assert.equal(free({ geo: b.geo, kinds: [1, -1, -1] }, 0), true);
});

test('frei: Stein auf Ebene 1 braucht auch links/rechts Platz', () => {
  const b = H([[0, 0, 0], [0, 2, 0], [0, 4, 0], [1, 2, 0]], [1, 1, 1, 1]);
  // Ebene-1-Stein hat auf seiner Ebene keine Nachbarn -> frei; die Steine darunter: 0 und 2 frei (außen), 1 verdeckt
  assert.deepEqual([0, 1, 2, 3].map((i) => free(b, i)), [true, false, true, true]);
  const c = H([[1, 0, 0], [1, 2, 0], [1, 4, 0]], [1, 1, 1]);
  assert.deepEqual([0, 1, 2].map((i) => free(c, i)), [true, false, true]);
});

test('frei: Sonderstein der Schildkröte (Spalte 0, Zeile 7) ist am Anfang frei, Steine daneben nicht', () => {
  const g = E.createGame(P, {}, seeded(3));
  const pos = LAYOUTS.schildkroete.tiles;
  const at = (z, x, y) => pos.findIndex((p) => p[0] === z && p[1] === x && p[2] === y);
  assert.equal(E.isFree(g, at(0, 0, 7)), true);
  assert.equal(E.isFree(g, at(0, 28, 7)), true);
  assert.equal(E.isFree(g, at(0, 26, 7)), false);
  assert.equal(E.isFree(g, at(0, 2, 6)), false, 'links Sonderstein, rechts Nachbar');
  assert.equal(E.isFree(g, at(4, 13, 7)), true);
  assert.equal(E.isFree(g, at(3, 12, 6)), false);
  assert.equal(E.isFree(g, at(0, 2, 0)), true);
});

test('freeTiles/freePairs: nur gleiche freie Steine; alle 4 Blumen sind Paare', () => {
  const b = H([[0, 0, 0], [0, 2, 0], [0, 6, 0], [0, 8, 0], [0, 12, 0], [0, 14, 0]], [E.FLOWER, E.FLOWER, E.FLOWER, 5, 5, E.SEASON]);
  const pairs = E.freePairsIn(b.geo, b.kinds);
  assert.deepEqual(pairs, [[0, 1], [0, 2], [1, 2], [3, 4]]);
});

// ---------- Spiel anlegen ----------
test('createGame: Optionen und Vorrang tiny > small', () => {
  assert.equal(E.createGame(P, {}, seeded(1)).layout, 'schildkroete');
  assert.equal(E.createGame(P, { small: true }, seeded(1)).layout, 'pyramide');
  assert.equal(E.createGame(P, { tiny: true }, seeded(1)).layout, 'mauer');
  assert.equal(E.createGame(P, { small: true, tiny: true }, seeded(1)).layout, 'mauer');
  assert.equal(E.createGame(P, { learn: true }, seeded(1)).layout, 'lern');
  assert.equal(E.createGame(P, undefined, seeded(1)).opts.hints, true);
  assert.equal(E.createGame(P, { hints: false }, seeded(1)).opts.hints, false);
  assert.equal(E.layoutOf(null), 'schildkroete');
  assert.equal(E.layoutName('schildkroete'), 'Schildkröte');
});

test('createGame: Steine passen zum Satz (Schildkröte = genau der ganze Satz)', () => {
  const g = E.createGame(P, {}, seeded(9));
  assert.equal(g.kinds.length, 144);
  assert.deepEqual([...g.kinds].sort((a, b) => a - b), E.fullSet());
  assert.equal(E.stonesLeft(g), 144);
  assert.equal(g.mode, 'play');
  for (const o of [{ small: true }, { tiny: true }, { learn: true }]) {
    const h = E.createGame(P, o, seeded(5));
    const cnt = new Map();
    for (const k of h.kinds) cnt.set(k, (cnt.get(k) || 0) + 1);
    for (const [k, c] of cnt) { assert.ok(k >= 0 && k < 36); assert.ok(c <= 4 && c % 2 === 0, `Art ${k} x${c}`); }
  }
});

// ---------- Erzeuger / Löser ----------
test('Generator: 200 Verteilungen je Brettform sind per Löser vollständig lösbar (Lösung wird nachgespielt)', () => {
  for (const [key, opts] of [['mauer', { tiny: true }], ['pyramide', { small: true }], ['schildkroete', {}]]) {
    const rng = seeded(key.length * 101);
    for (let n = 0; n < 200; n++) {
      const g = E.createGame(P, opts, rng);
      assert.equal(g.layout, key);
      const info = {};
      const sol = E.solve(g, LIMIT, info);
      assert.ok(sol, `${key} #${n} nicht gelöst (aborted=${info.aborted})`);
      assert.equal(sol.length, g.kinds.length / 2);
      const h = clone(g);
      for (const [a, b] of sol) assert.equal(E.handle(h, 'p0', { t: 'pair', a, b }, rng).ok, true, `${key} #${n}: Lösungszug ungültig`);
      assert.equal(h.mode, 'over');
      assert.equal(E.stonesLeft(h), 0);
    }
  }
});

test('Generator: verschiedene Seeds geben verschiedene Verteilungen', () => {
  const a = E.createGame(P, { tiny: true }, seeded(1)), b = E.createGame(P, { tiny: true }, seeded(2));
  assert.notDeepEqual(a.kinds, b.kinds);
  const c = E.createGame(P, { tiny: true }, seeded(1));
  assert.deepEqual(a.kinds, c.kinds, 'gleicher Seed, gleiches Brett');
});

test('Löser: erkennt unlösbare Zustände', () => {
  // Zwei gleiche Steine übereinander: nie zusammen frei
  const geo = E.geometryFrom([[0, 2, 2], [1, 2, 2]]);
  assert.equal(E.solveKinds(geo, [4, 4]), null);
  // Zwei Paare, ein Paar blockiert das andere
  const geo2 = E.geometryFrom([[0, 0, 0], [0, 2, 0], [0, 4, 0], [0, 6, 0]]);
  assert.ok(E.solveKinds(geo2, [1, 2, 2, 1]), 'ABBA ist lösbar (innen zuerst? nein: außen A A frei)');
  assert.equal(E.solveKinds(geo2, [1, 2, 1, 2]), null, 'ABAB: nur Enden sind frei, aber 1 und 2 passen nicht');
  assert.deepEqual(E.solveKinds(geo2, [-1, -1, -1, -1]), []);
});

test('Löser: Abbruch bei kleinem Limit wird gemeldet', () => {
  const g = E.createGame(P, {}, seeded(11));
  const info = {};
  const r = E.solve(g, 1, info);
  assert.equal(r, null);
  assert.equal(info.aborted, true);
});

// ---------- Entfernen ----------
function tiny(seed = 4) { return E.createGame(P, { tiny: true }, seeded(seed)); }

test('Paar entfernen: gültig, beide verschwinden, Verlauf wächst, Bilanz stimmt', () => {
  const g = tiny();
  const [a, b] = E.freePairs(g)[0];
  const k = g.kinds[a];
  const r = E.handle(g, 'p0', { t: 'pair', a, b, ms: 1500 });
  assert.deepEqual(r, { ok: true });
  assert.equal(g.kinds[a], -1); assert.equal(g.kinds[b], -1);
  assert.equal(E.stonesLeft(g), 46);
  assert.deepEqual(g.hist, [['p', a, b, k]]);
  assert.equal(g.elapsed, 1500);
  assert.equal(g.seq, 1);
});

test('Paar entfernen: Fehlerfälle ändern den Zustand nie', () => {
  const g = tiny();
  const before = clone(g);
  const pairs = E.freePairs(g);
  const [a, b] = pairs[0];
  const free1 = E.freeTiles(g);
  const other = free1.find((i) => !E.sameKind(g.kinds[i], g.kinds[a]));
  const blocked = [...g.kinds.keys()].find((i) => !E.isFree(g, i));
  assert.ok(other !== undefined && blocked !== undefined);
  const cases = [
    [{ t: 'pair', a, b: other }, /keine gleichen/],
    [{ t: 'pair', a, b: a }, /Ungültige/],
    [{ t: 'pair', a: -1, b }, /Ungültige/],
    [{ t: 'pair', a, b: 999 }, /Ungültige/],
    [{ t: 'pair', a: '1', b }, /Ungültige/],
    [{ t: 'pair', a, b: 1.5 }, /Ungültige/],
    [{ t: 'pair', a }, /Ungültige/],
    [{ t: 'pair', a, b, ms: -5 }, /Zeitangabe/],
    [{ t: 'pair', a, b, ms: 'x' }, /Zeitangabe/],
    [{ t: 'pair', a, b, ms: NaN }, /Zeitangabe/],
    [{ t: 'undo' }, /nichts zum Zurücknehmen/],
    [{ t: 'zaubern' }, /Unbekannte/],
    [{}, /Unbekannte/],
    [null, /Unbekannte/],
    [[1, 2], /Unbekannte/],
    ['pair', /Unbekannte/],
  ];
  for (const [m, re] of cases) {
    const r = E.handle(g, 'p0', m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.match(r.error, re, JSON.stringify(m));
    assert.deepEqual(g, before, 'Zustand verändert bei ' + JSON.stringify(m));
  }
  assert.equal(E.handle(g, 'fremd', { t: 'pair', a, b }).ok, false);
  assert.equal(E.handle(g, undefined, { t: 'pair', a, b }).ok, false);
  assert.equal(E.handle(null, 'p0', { t: 'pair', a, b }).ok, false);
  assert.equal(E.handle({}, 'p0', { t: 'pair', a, b }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'pair', a, b }, 'kein rng').ok, false);
  assert.deepEqual(g, before);
});

test('Paar entfernen: eingeklemmte Steine und schon entfernte werden abgelehnt', () => {
  const g = tiny();
  // Zwei gleiche Steine suchen, von denen mindestens einer eingeklemmt ist
  let found = null;
  for (let a = 0; a < g.kinds.length && !found; a++) for (let b = a + 1; b < g.kinds.length; b++) {
    if (E.sameKind(g.kinds[a], g.kinds[b]) && (!E.isFree(g, a) || !E.isFree(g, b))) { found = [a, b]; break; }
  }
  assert.ok(found);
  const before = clone(g);
  const r = E.handle(g, 'p0', { t: 'pair', a: found[0], b: found[1] });
  assert.equal(r.ok, false);
  assert.match(r.error, /eingeklemmt/);
  assert.deepEqual(g, before);
  const [a, b] = E.freePairs(g)[0];
  E.handle(g, 'p0', { t: 'pair', a, b });
  const r2 = E.handle(g, 'p0', { t: 'pair', a, b });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /schon weg/);
});

test('Blumen untereinander und Jahreszeiten untereinander dürfen weg (handgebaut)', () => {
  const g = E.createGame(P, { tiny: true }, seeded(1));
  // Brett von Hand ersetzen: vier Steine in einer Reihe
  g.layout = 'lern';
  const n = E.geometry('lern').n;
  g.kinds = new Array(n).fill(-1);
  const pos = LAYOUTS.lern.tiles;
  const idx = (z, x, y) => pos.findIndex((p) => p[0] === z && p[1] === x && p[2] === y);
  g.kinds[idx(0, 0, 0)] = E.FLOWER; g.kinds[idx(0, 10, 0)] = E.FLOWER;
  g.kinds[idx(0, 2, 2)] = E.SEASON; g.kinds[idx(0, 8, 2)] = E.SEASON;
  assert.equal(E.handle(g, 'p0', { t: 'pair', a: idx(0, 0, 0), b: idx(0, 2, 2) }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'pair', a: idx(0, 0, 0), b: idx(0, 10, 0) }).ok, true);
  assert.equal(E.handle(g, 'p0', { t: 'pair', a: idx(0, 2, 2), b: idx(0, 8, 2) }).ok, true);
  assert.equal(g.mode, 'over');
});

// ---------- Zurück ----------
test('Zurück: unbegrenzt, stellt Steine, Modus und Verlauf wieder her', () => {
  const g = tiny(8);
  const start = clone(g.kinds);
  const rng = seeded(2);
  let n = 0;
  while (n < 12) {
    const ps = E.freePairs(g);
    if (!ps.length) break;
    const [a, b] = ps[Math.floor(rng() * ps.length)];
    assert.equal(E.handle(g, 'p0', { t: 'pair', a, b }).ok, true);
    n++;
  }
  assert.ok(n > 5);
  for (let i = 0; i < n; i++) assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, true);
  assert.deepEqual(g.kinds, start);
  assert.equal(g.hist.length, 0);
  const r = E.handle(g, 'p0', { t: 'undo' });
  assert.equal(r.ok, false);
});

test('Zurück nach dem letzten Paar ist nicht mehr möglich (Spiel ist zu Ende)', () => {
  const g = tiny(6);
  for (const [a, b] of E.solve(g, LIMIT)) E.handle(g, 'p0', { t: 'pair', a, b, ms: 1000 });
  assert.equal(g.mode, 'over');
  const r = E.handle(g, 'p0', { t: 'undo' });
  assert.equal(r.ok, false);
  assert.match(r.error, /geschafft/);
});

test('Zurück nimmt auch Neu mischen zurück', () => {
  const g = tiny(10);
  const [a, b] = E.freePairs(g)[0];
  E.handle(g, 'p0', { t: 'pair', a, b });
  const afterPair = clone(g.kinds);
  assert.equal(E.handle(g, 'p0', { t: 'shuffle' }, seeded(3)).ok, true);
  assert.equal(g.mixes, 1);
  assert.equal(g.hist.length, 2);
  assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, true);
  assert.deepEqual(g.kinds, afterPair);
  assert.equal(g.mixes, 1, 'Mischen bleibt als Hilfe gezählt');
});

// ---------- Mischen ----------
test('Mischen: gleiche Steine, gleiche Plätze, danach lösbar (viele Stände je Brettform)', () => {
  for (const [opts, rounds] of [[{ tiny: true }, 40], [{ small: true }, 40], [{}, 25]]) {
    const rng = seeded(77);
    for (let r = 0; r < rounds; r++) {
      const g = E.createGame(P, opts, rng);
      const steps = Math.floor(rng() * (g.kinds.length / 2 - 2));
      for (let s = 0; s < steps; s++) {
        const ps = E.freePairs(g);
        if (!ps.length) break;
        const [a, b] = ps[Math.floor(rng() * ps.length)];
        E.handle(g, 'p0', { t: 'pair', a, b });
      }
      if (g.mode !== 'play') continue;
      const occupied = g.kinds.map((k) => k >= 0);
      const multi = g.kinds.filter((k) => k >= 0).sort((x, y) => x - y);
      const res = E.handle(g, 'p0', { t: 'shuffle' }, rng);
      if (!res.ok) { assert.match(res.error, /Mischen geht/); continue; }
      assert.deepEqual(g.kinds.map((k) => k >= 0), occupied, 'Plätze ändern sich nicht');
      assert.deepEqual(g.kinds.filter((k) => k >= 0).sort((x, y) => x - y), multi, 'Steine bleiben dieselben');
      const info = {};
      assert.ok(E.solve(g, LIMIT, info), `nach dem Mischen nicht lösbar (aborted=${info.aborted})`);
    }
  }
});

test('Mischen: wenn es nicht geht, bleibt alles unverändert', () => {
  const g = tiny();
  // zwei Steine übereinander (nicht lösbar, nicht mischbar)
  g.layout = 'lern';
  const n = E.geometry('lern').n;
  g.kinds = new Array(n).fill(-1);
  const pos = LAYOUTS.lern.tiles;
  g.kinds[pos.findIndex((p) => p[0] === 0 && p[1] === 4 && p[2] === 0)] = 7;
  g.kinds[pos.findIndex((p) => p[0] === 1 && p[1] === 4 && p[2] === 1)] = 7;
  const before = clone(g);
  const r = E.handle(g, 'p0', { t: 'shuffle' }, seeded(1));
  assert.equal(r.ok, false);
  assert.deepEqual(g, before);
  assert.equal(E.isStuck(g), true);
});

test('Sackgasse: isStuck nur wenn Steine übrig und kein Paar möglich', () => {
  const g = tiny(12);
  assert.equal(E.isStuck(g), false);
  const over = clone(g); over.mode = 'over';
  assert.equal(E.isStuck(over), false);
  assert.equal(E.isStuck(null), false);
});

// ---------- Hinweis ----------
test('Hinweis: liefert ein gültiges freies Paar, zählt als Hilfe, wird beim nächsten Zug gelöscht', () => {
  const g = tiny(14);
  const rng = seeded(5);
  for (let i = 0; i < 10; i++) {
    const r = E.handle(g, 'p0', { t: 'hint', ms: 10 * i }, rng);
    assert.equal(r.ok, true);
    assert.equal(g.hints, i + 1);
    assert.equal(g.hintN, i + 1);
    const [a, b] = g.hint;
    assert.ok(E.isFree(g, a) && E.isFree(g, b) && E.sameKind(g.kinds[a], g.kinds[b]) && a !== b);
  }
  const [a, b] = g.hint;
  assert.equal(E.handle(g, 'p0', { t: 'pair', a, b }).ok, true);
  assert.equal(g.hint, null);
  assert.equal(g.hints, 10);
});

test('Hinweis: ausgeschaltet oder kein Paar mehr gibt Fehler ohne Änderung', () => {
  const g = E.createGame(P, { tiny: true, hints: false }, seeded(2));
  const before = clone(g);
  const r = E.handle(g, 'p0', { t: 'hint' });
  assert.equal(r.ok, false); assert.match(r.error, /ausgeschaltet/);
  assert.deepEqual(g, before);
  const h = tiny();
  h.layout = 'lern';
  h.kinds = new Array(12).fill(-1);
  const pos = LAYOUTS.lern.tiles;
  h.kinds[pos.findIndex((p) => p[0] === 0 && p[1] === 4 && p[2] === 0)] = 7;
  h.kinds[pos.findIndex((p) => p[0] === 1 && p[1] === 4 && p[2] === 1)] = 7;
  const r2 = E.handle(h, 'p0', { t: 'hint' });
  assert.equal(r2.ok, false); assert.match(r2.error, /kein Paar/);
  assert.equal(h.hints, 0);
});

// ---------- Spielende, Zeit, Bestzeit ----------
test('Spielende: Ergebnis mit Zeit und Hilfen; Bestzeit-Logik', () => {
  const g = tiny(21);
  E.handle(g, 'p0', { t: 'hint', ms: 100 }, seeded(1));
  const sol = E.solve(g, LIMIT);
  let ms = 1000;
  for (const [a, b] of sol) { assert.equal(g.mode, 'play'); E.handle(g, 'p0', { t: 'pair', a, b, ms: (ms += 1000) }); }
  assert.equal(g.mode, 'over');
  assert.equal(g.result.ms, ms);
  assert.equal(g.result.hints, 1);
  assert.equal(g.result.mixes, 0);
  assert.equal(g.result.record, null);
  assert.equal(E.handle(g, 'p0', { t: 'pair', a: 0, b: 1 }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'hint' }).ok, false);
  const b1 = E.settleResult(g, 0, 0);
  assert.deepEqual(b1, { recordAll: true, recordClean: false, best: ms, bestClean: 0 }, 'mit Hinweis zählt nicht als "ohne Hilfe"');
  assert.equal(g.result.record, true);
  assert.equal(E.settleResult(g, 0, 0), null, 'nur einmal');
  // ohne Hilfe
  const h = tiny(22);
  for (const [a, b] of E.solve(h, LIMIT)) E.handle(h, 'p0', { t: 'pair', a, b, ms: 50000 });
  const b2 = E.settleResult(h, 60000, 70000);
  assert.deepEqual(b2, { recordAll: true, recordClean: true, best: 50000, bestClean: 50000 });
  const k = tiny(23);
  for (const [a, b] of E.solve(k, LIMIT)) E.handle(k, 'p0', { t: 'pair', a, b, ms: 90000 });
  const b3 = E.settleResult(k, 60000, 70000);
  assert.deepEqual(b3, { recordAll: false, recordClean: false, best: 60000, bestClean: 70000 });
  assert.equal(E.settleResult({ mode: 'play' }, 0, 0), null);
  assert.equal(E.settleResult(null, 0, 0), null);
});

test('Mischen zählt als Hilfe im Ergebnis', () => {
  const g = tiny(31);
  E.handle(g, 'p0', { t: 'shuffle' }, seeded(2));
  for (const [a, b] of E.solve(g, LIMIT)) E.handle(g, 'p0', { t: 'pair', a, b, ms: 1000 });
  assert.equal(g.mode, 'over');
  assert.equal(g.result.mixes, 1);
  const b = E.settleResult(g, 0, 0);
  assert.equal(b.recordClean, false);
});

test('Zeit: sync und Nachrichten setzen die Zeit nur vorwärts', () => {
  const g = tiny();
  assert.equal(E.handle(g, 'p0', { t: 'sync', ms: 5000 }).ok, true);
  assert.equal(g.elapsed, 5000);
  E.handle(g, 'p0', { t: 'sync', ms: 3000 });
  assert.equal(g.elapsed, 5000);
  assert.equal(E.handle(g, 'p0', { t: 'sync', ms: -1 }).ok, false);
  assert.equal(E.fmtTime(0), '00:00'); assert.equal(E.fmtTime(65000), '01:05'); assert.equal(E.fmtTime(3661000), '1:01:01');
  assert.equal(E.fmtTime(-5), '00:00'); assert.equal(E.fmtTime('x'), '00:00');
});

// ---------- Neues Spiel ----------
test('Neues Spiel: setzt alles zurück, wählt Brettform aus den Optionen', () => {
  const g = tiny(40);
  const [a, b] = E.freePairs(g)[0];
  E.handle(g, 'p0', { t: 'pair', a, b, ms: 4000 });
  E.handle(g, 'p0', { t: 'hint' }, seeded(1));
  const gid = g.gid, seq = g.seq;
  assert.equal(E.handle(g, 'p0', { t: 'new', opts: { small: true, tiny: false, hints: false, free: true } }, seeded(8)).ok, true);
  assert.equal(g.layout, 'pyramide');
  assert.equal(g.kinds.length, 72);
  assert.equal(E.stonesLeft(g), 72);
  assert.deepEqual([g.hist.length, g.hints, g.mixes, g.hintN, g.elapsed, g.result, g.hint, g.mode], [0, 0, 0, 0, 0, null, null, 'play']);
  assert.deepEqual(g.opts, { small: true, tiny: false, hints: false, free: true, learn: false });
  assert.ok(g.seq > seq); assert.notEqual(g.gid, gid);
  // ohne opts: bisherige Optionen bleiben
  assert.equal(E.handle(g, 'p0', { t: 'new' }, seeded(9)).ok, true);
  assert.equal(g.layout, 'pyramide');
  // aus dem Spielende heraus
  const o = tiny(41);
  for (const [x, y] of E.solve(o, LIMIT)) E.handle(o, 'p0', { t: 'pair', a: x, b: y });
  assert.equal(o.mode, 'over');
  assert.equal(E.handle(o, 'p0', { t: 'new', opts: {} }, seeded(1)).ok, true);
  assert.equal(o.mode, 'play');
  assert.equal(o.layout, 'schildkroete');
  assert.equal(E.handle(o, 'fremd', { t: 'new' }).ok, false);
});

// ---------- JSON ----------
test('JSON: Zustand übersteht Serialisierung in jedem Spielabschnitt', () => {
  const g = tiny(50);
  const rng = seeded(4);
  for (let step = 0; step < 30 && g.mode === 'play'; step++) {
    const j = JSON.parse(JSON.stringify(g));
    assert.deepEqual(j, g);
    const msg = step % 7 === 3 ? { t: 'hint' } : step % 11 === 5 ? { t: 'undo' } : step % 13 === 9 ? { t: 'shuffle' } : null;
    if (msg) { const r1 = E.handle(j, 'p0', msg, seeded(step)); const r2 = E.handle(g, 'p0', msg, seeded(step)); assert.equal(r1.ok, r2.ok); assert.deepEqual(j, g); continue; }
    const ps = E.freePairs(g);
    if (!ps.length) break;
    const [a, b] = ps[Math.floor(rng() * ps.length)];
    assert.equal(E.handle(j, 'p0', { t: 'pair', a, b }).ok, true);
    assert.equal(E.handle(g, 'p0', { t: 'pair', a, b }).ok, true);
    assert.deepEqual(j, g);
  }
  const text = JSON.stringify(g);
  assert.ok(!/undefined|NaN|Infinity/.test(text));
});

// ---------- Zufallspartien ----------
test('250 Zufallspartien enden immer (bei Sackgasse mischen oder zurück)', () => {
  const sets = [[{ tiny: true }, 120], [{ small: true }, 90], [{}, 40]];
  let finished = 0, mixes = 0, undos = 0;
  for (const [opts, count] of sets) {
    const rng = seeded(1234 + count);
    for (let n = 0; n < count; n++) {
      const g = E.createGame(P, opts, rng);
      const total = g.kinds.length;
      let guard = 0;
      while (g.mode === 'play' && guard++ < 4000) {
        const ps = E.freePairs(g);
        if (ps.length) {
          const [a, b] = ps[Math.floor(rng() * ps.length)];
          assert.equal(E.handle(g, 'p0', { t: 'pair', a, b, ms: guard }, rng).ok, true);
        } else if (E.handle(g, 'p0', { t: 'shuffle', ms: guard }, rng).ok) mixes++;
        else {
          // Mischen geht nicht mehr (z. B. zwei Steine übereinander): ein paar Schritte zurückgehen
          const k = 1 + Math.floor(rng() * (6 + Math.floor(guard / 40)));
          for (let u = 0; u < k && g.hist.length; u++) { assert.equal(E.handle(g, 'p0', { t: 'undo' }, rng).ok, true); undos++; }
        }
        // Bilanz: Steine übrig + entfernte Paare * 2 = Gesamtzahl
        const removed = g.hist.filter((h) => h[0] === 'p').length * 2;
        assert.equal(E.stonesLeft(g) + removed, total);
      }
      assert.equal(g.mode, 'over', `${g.layout} #${n} endet nicht`);
      assert.equal(E.stonesLeft(g), 0);
      finished++;
    }
  }
  assert.equal(finished, 250);
  console.log(`  Zufallspartien: ${finished}, Mischen: ${mixes}, Zurück bei Sackgasse: ${undos}`);
});
