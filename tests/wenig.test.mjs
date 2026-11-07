import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../wenig/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const cell = (v, up = false) => ({ v, up });
const hidden = (vals) => vals.map((v) => cell(v, false));
const snap = (g) => JSON.stringify(g);
const H12 = () => hidden([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// Spielzustand direkt in der Spielphase mit festen Rastern bauen
function play(grids, { top = 5, deck = [1, 2, 3, 4, 6, 7], opts = {}, active = 0, seed = 1, limit } = {}) {
  const n = grids.length;
  const g = M.createGame(players(n), { ...opts, limit }, seeded(seed));
  grids.forEach((gr, i) => { g.players[i].grid = gr.map((c) => (c === null ? null : { ...c })); g.players[i].gone = []; });
  g.discard = [top];
  g.deck = deck.slice();
  g.phase = 'play';
  g.starter = active; g.active = active;
  g.turn = { stage: 'start', drawn: null };
  g.endBy = null;
  return g;
}
// Kartenbilanz: Stapel + Ablage + alle Raster + gezogene Karte als Mehrmenge
function multiset(g) {
  const cnt = new Array(15).fill(0);
  const add = (v) => { cnt[v + 2] += 1; };
  g.deck.forEach(add); g.discard.forEach(add);
  for (const p of g.players) p.grid.forEach((c) => { if (c) add(c.v); });
  if (g.turn.drawn !== null && g.turn.drawn !== undefined) add(g.turn.drawn);
  return cnt;
}
const FULL = (() => { const c = new Array(15).fill(0); M.fullDeck().forEach((v) => { c[v + 2] += 1; }); return c; })();

test('Kartensatz: 150 Karten mit richtigen Anzahlen', () => {
  const d = M.fullDeck();
  assert.equal(d.length, 150);
  const cnt = {};
  for (const v of d) cnt[v] = (cnt[v] || 0) + 1;
  assert.equal(cnt[-2], 5);
  assert.equal(cnt[-1], 10);
  assert.equal(cnt[0], 15);
  for (let v = 1; v <= 12; v++) assert.equal(cnt[v], 10, 'Wert ' + v);
  assert.equal(Object.keys(cnt).length, 15);
});

test('Austeilen: 12 verdeckte Karten pro Person, eine offene Ablage, Rest Stapel, Kartenbilanz', () => {
  for (let n = 2; n <= 8; n++) {
    const g = M.createGame(players(n), {}, seeded(n));
    for (const p of g.players) {
      assert.equal(p.grid.length, 12);
      assert.ok(p.grid.every((c) => c && c.up === false && M.isValue(c.v)));
    }
    assert.equal(g.discard.length, 1);
    assert.equal(g.deck.length, 150 - 12 * n - 1);
    assert.deepEqual(multiset(g), FULL);
    assert.equal(g.phase, 'reveal');
    assert.equal(g.round, 1);
    assert.deepEqual(g.opts, { double: true });
  }
});

test('createGame: ungültige Spielerzahl, Optionen, hostId, Determinismus, JSON-Sicherheit', () => {
  assert.throws(() => M.createGame(players(1)));
  assert.throws(() => M.createGame(players(9)));
  assert.throws(() => M.createGame('x'));
  const g = M.createGame(players(2), { double: 0, foo: 1 }, seeded(2), 'p1');
  assert.deepEqual(g.opts, { double: false });
  assert.equal(g.hostId, 'p1');
  assert.equal(g.limit, 100);
  assert.equal(M.createGame(players(2), { limit: 30 }, seeded(2)).limit, 30);
  assert.equal(M.createGame(players(2), { limit: 'x' }, seeded(2)).limit, 100);
  assert.equal(M.createGame(players(3), undefined, seeded(2)).hostId, 'p0');
  assert.equal(snap(M.createGame(players(3), {}, seeded(9))), snap(M.createGame(players(3), {}, seeded(9))));
  const g2 = M.createGame(players(4), {}, seeded(3));
  assert.deepEqual(JSON.parse(JSON.stringify(g2)), g2);
  // auch mitten im Spiel und am Rundenende reines JSON
  const g3 = play([H12(), H12()]);
  M.handle(g3, 'p0', { t: 'draw' });
  assert.deepEqual(JSON.parse(JSON.stringify(g3)), g3);
});

test('Startaufdecken: genau zwei Karten pro Person, alle gleichzeitig, andere Züge gesperrt', () => {
  const g = M.createGame(players(3), {}, seeded(5));
  assert.equal(M.handle(g, 'p1', { t: 'draw' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 0 }).ok, false);
  assert.equal(M.handle(g, 'p2', { t: 'reveal', i: 3 }).ok, true);
  assert.equal(M.handle(g, 'p2', { t: 'reveal', i: 3 }).ok, false, 'schon offen');
  assert.equal(M.handle(g, 'p0', { t: 'reveal', i: 12 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'reveal', i: -1 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'reveal', i: 1.5 }).ok, false);
  assert.equal(M.handle(g, 'p2', { t: 'reveal', i: 4 }).ok, true);
  assert.equal(M.handle(g, 'p2', { t: 'reveal', i: 5 }).ok, false, 'nur zwei');
  assert.equal(g.phase, 'reveal');
  assert.equal(M.handle(g, 'p0', { t: 'reveal', i: 0 }).ok, true);
  assert.equal(M.handle(g, 'p1', { t: 'reveal', i: 0 }).ok, true);
  assert.equal(M.handle(g, 'p1', { t: 'reveal', i: 1 }).ok, true);
  assert.equal(g.phase, 'reveal');
  assert.equal(M.handle(g, 'p0', { t: 'reveal', i: 1 }).ok, true);
  assert.equal(g.phase, 'play');
  for (const p of g.players) assert.equal(M.upCount(p), 2);
});

function revealWith(vals) { // vals[i] = [a, b] aufgedeckte Werte auf den Plätzen 0 und 1
  const g = M.createGame(players(vals.length), {}, seeded(7));
  vals.forEach((v, i) => { g.players[i].grid[0] = cell(v[0]); g.players[i].grid[1] = cell(v[1]); });
  g.players.forEach((p) => { M.handle(g, p.id, { t: 'reveal', i: 0 }); M.handle(g, p.id, { t: 'reveal', i: 1 }); });
  return g;
}
test('Startperson: höchste Summe, bei Gleichstand höchste Einzelkarte, dann die erste in der Reihenfolge', () => {
  assert.equal(revealWith([[3, 4], [12, 1], [5, 5]]).active, 1, 'Summe 13');
  assert.equal(revealWith([[3, 4], [1, 1], [5, 5]]).active, 2);
  assert.equal(revealWith([[6, 4], [9, 1], [5, 5]]).active, 1, 'Summe 10: höchste Einzelkarte 9');
  assert.equal(revealWith([[6, 4], [5, 5], [7, 3]]).active, 2, 'Summe 10: Einzelkarte 7');
  assert.equal(revealWith([[5, 5], [5, 5], [5, 5]]).active, 0, 'alles gleich: die erste');
  assert.equal(revealWith([[-2, -2], [-1, -2]]).active, 1);
  const g = revealWith([[1, 2], [3, 4]]);
  assert.equal(g.starter, 1);
  assert.equal(g.phase, 'play');
  assert.equal(g.turn.stage, 'start');
});

test('Zug A: Ablage nehmen und gegen eine verdeckte oder offene Karte tauschen', () => {
  const g = play([[cell(9, true), ...hidden([4, 5, 6, 7, 8, 1, 2, 3, 10, 11, 12])], [cell(1, true), ...hidden([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]], { top: 2 });
  const bal = multiset(g);
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 2 }).ok, true); // verdeckte 5
  assert.deepEqual(g.players[0].grid[2], { v: 2, up: true });
  assert.equal(g.discard.at(-1), 6 - 1, 'die ausgetauschte verdeckte Karte liegt offen oben');
  assert.equal(g.discard.length, 1);
  assert.equal(g.active, 1);
  assert.equal(g.turn.stage, 'start');
  assert.deepEqual(multiset(g), bal);
  assert.equal(M.handle(g, 'p1', { t: 'swap', from: 'discard', i: 0 }).ok, true); // offene 1
  assert.deepEqual(g.players[1].grid[0], { v: 5, up: true });
  assert.equal(g.discard.at(-1), 1);
  assert.equal(g.active, 0);
  assert.deepEqual(multiset(g), bal);
});

test('Zug B: ziehen, dann tauschen (offen und verdeckt)', () => {
  const g = play([[cell(9, true), ...hidden([4, 5, 6, 7, 8, 1, 2, 3, 10, 11, 12])], [cell(1, true), ...hidden([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]], { top: 2, deck: [7, 3] });
  const bal = multiset(g);
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, true);
  assert.equal(g.turn.stage, 'drawn');
  assert.equal(g.turn.drawn, 3);
  assert.equal(g.deck.length, 1);
  assert.equal(g.active, 0);
  assert.deepEqual(multiset(g), bal);
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, false, 'nicht zweimal ziehen');
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 0 }).ok, false, 'nach dem Ziehen keine Ablage mehr');
  assert.equal(M.handle(g, 'p0', { t: 'flip', i: 1 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'drawn', i: 0 }).ok, true);
  assert.deepEqual(g.players[0].grid[0], { v: 3, up: true });
  assert.equal(g.discard.at(-1), 9);
  assert.equal(g.turn.drawn, null);
  assert.equal(g.active, 1);
  assert.equal(M.handle(g, 'p1', { t: 'draw' }).ok, true);
  assert.equal(M.handle(g, 'p1', { t: 'swap', from: 'drawn', i: 5 }).ok, true); // verdeckte 5
  assert.deepEqual(g.players[1].grid[5], { v: 7, up: true });
  assert.equal(g.discard.at(-1), 5);
  assert.deepEqual(multiset(g), bal);
});

test('Zug B: gezogene Karte ablegen, danach verdeckte Karte aufdecken (Pflicht)', () => {
  const g = play([[cell(9, true), ...hidden([4, 5, 6, 7, 8, 1, 2, 3, 10, 11, 12])], [cell(1, true), ...hidden([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]], { top: 2, deck: [7, 3] });
  const bal = multiset(g);
  M.handle(g, 'p0', { t: 'draw' });
  assert.equal(M.handle(g, 'p0', { t: 'discard' }).ok, true);
  assert.equal(g.discard.at(-1), 3);
  assert.equal(g.turn.stage, 'flip');
  assert.equal(g.active, 0);
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'discard' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'drawn', i: 2 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 2 }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'flip', i: 0 }).ok, false, 'schon offen');
  assert.equal(M.handle(g, 'p1', { t: 'flip', i: 1 }).ok, false, 'falsche Person');
  assert.equal(M.handle(g, 'p0', { t: 'flip', i: 4 }).ok, true);
  assert.deepEqual(g.players[0].grid[4], { v: 7, up: true });
  assert.equal(g.active, 1);
  assert.equal(g.turn.stage, 'start');
  assert.deepEqual(multiset(g), bal);
});

test('Ablegen ohne verdeckte Karte (letzter Zug): kein Aufdecken nötig, Zug endet', () => {
  const open = Array.from({ length: 12 }, (_, i) => cell(i % 5 + 1, true));
  const g = play([open, H12(), H12()], { deck: [4, 4, 4], opts: { double: false } });
  g.endBy = 1; // jemand anderes hat beendet, P0 hat einen letzten Zug
  g.active = 0;
  M.handle(g, 'p0', { t: 'draw' });
  assert.equal(M.handle(g, 'p0', { t: 'discard' }).ok, true);
  assert.equal(g.turn.stage, 'start');
  assert.equal(g.phase, 'round', 'P0 war der letzte Zug vor der Person, die beendet hat: Runde ist vorbei');
});

test('Spaltenentfernung nach Tausch (auch mit der gerade getauschten Karte); Spalte zählt danach 0', () => {
  const gr = hidden([0, 1, 2, 3, 0, 4, 4, 4, 3, 4, 4, 4]);
  gr[0] = cell(6, true); gr[4] = cell(6, true);
  const g = play([gr, H12()], { top: 6 });
  const bal = multiset(g);
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 8 }).ok, true);
  assert.deepEqual([g.players[0].grid[0], g.players[0].grid[4], g.players[0].grid[8]], [null, null, null]);
  assert.deepEqual(g.players[0].gone, [6]);
  assert.deepEqual(g.discard.slice(-3), [6, 6, 6], 'die drei Karten liegen auf der Ablage');
  assert.equal(g.discard.length, 1 - 1 + 1 + 3);
  assert.deepEqual(multiset(g), bal);
  assert.equal(M.fullSum(g.players[0]), 1 + 2 + 3 + 4 * 6, 'nur die neun übrigen Karten zählen');
});

test('Spaltenentfernung nach Aufdecken (Karte ablegen + aufdecken)', () => {
  const gr = hidden([9, 1, 2, 3, 9, 4, 4, 4, 9, 4, 4, 4]);
  gr[0] = cell(9, true); gr[4] = cell(9, true);
  const g = play([gr, H12()], { top: 2, deck: [12, 11] });
  const bal = multiset(g);
  M.handle(g, 'p0', { t: 'draw' });
  M.handle(g, 'p0', { t: 'discard' });
  assert.equal(M.handle(g, 'p0', { t: 'flip', i: 8 }).ok, true);
  assert.deepEqual([g.players[0].grid[0], g.players[0].grid[4], g.players[0].grid[8]], [null, null, null]);
  assert.deepEqual(g.players[0].gone, [9]);
  assert.equal(g.active, 1);
  assert.deepEqual(multiset(g), bal);
});

test('Drei gleiche Minuskarten werden ebenfalls entfernt; zwei gleiche, oder drei mit einer verdeckten, nicht', () => {
  const gr = hidden([0, 1, 2, 3, 0, 4, 4, 4, 0, 4, 4, 4]);
  gr[0] = cell(-2, true); gr[4] = cell(-2, true); gr[8] = cell(5, true);
  const g = play([gr, H12()], { top: -2 });
  M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 8 });
  assert.equal(g.players[0].grid[0], null);
  assert.deepEqual(g.players[0].gone, [-2]);
  const g2 = play([H12().map((c, i) => (i === 0 || i === 4 ? cell(7, true) : c)), H12()], { top: 3 });
  M.handle(g2, 'p0', { t: 'swap', from: 'discard', i: 1 });
  assert.ok(g2.players[0].grid[0] && g2.players[0].grid[4]);
  const g3 = play([H12().map((c, i) => (i === 0 || i === 4 ? cell(7, true) : i === 8 ? cell(7, false) : c)), H12()], { top: 3 });
  M.handle(g3, 'p0', { t: 'swap', from: 'discard', i: 1 });
  assert.ok(g3.players[0].grid[8] && g3.players[0].grid[0]);
});

test('Mehrere Spalten gleichzeitig: alle vollständigen Dreier werden auf einmal entfernt', () => {
  const g = play([[5, 5, 2, 3, 5, 5, 4, 4, 5, 5, 4, 4].map((v, i) => cell(v, i % 4 < 2)), H12()]);
  const bal = multiset(g);
  assert.equal(M.removeTriples(g, g.players[0]), 2);
  assert.deepEqual(g.players[0].gone, [5, 5]);
  assert.equal(g.players[0].grid.filter((c) => c === null).length, 6);
  assert.deepEqual(multiset(g), bal);
  assert.equal(g.discard.length, 1 + 6);
});

test('Mehrere Spalten in verschiedenen Zügen; entfernte Karten bleiben aus dem Raster', () => {
  const gr = hidden([0, 1, 2, 3, 0, 4, 4, 4, 0, 4, 4, 4]);
  gr[0] = cell(3, true); gr[4] = cell(3, true); gr[1] = cell(8, true); gr[5] = cell(8, true);
  const g = play([gr, H12()], { top: 3, deck: [8, 1, 1, 1] });
  M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 8 });
  assert.deepEqual(g.players[0].gone, [3]);
  M.handle(g, 'p1', { t: 'draw' }); M.handle(g, 'p1', { t: 'discard' }); M.handle(g, 'p1', { t: 'flip', i: 0 });
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, true);
  assert.equal(g.turn.drawn, 1);
  M.handle(g, 'p0', { t: 'swap', from: 'drawn', i: 9 });
  M.handle(g, 'p1', { t: 'draw' }); M.handle(g, 'p1', { t: 'discard' }); M.handle(g, 'p1', { t: 'flip', i: 1 });
  assert.equal(M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 4 }).ok, false, 'entferntes Feld');
  assert.deepEqual(g.players[0].gone, [3]);
});

function twoColumnsEnd() { return null; }
void twoColumnsEnd;

test('Rundenende: alle offen -> alle anderen noch genau ein letzter Zug, dann Wertung', () => {
  const g0 = Array.from({ length: 12 }, (_, i) => cell(i % 4 + 1, true)); g0[11] = cell(1, false);
  const g1 = H12(); g1[0] = cell(1, true);
  const g2 = H12(); g2[0] = cell(2, true);
  const g = play([g0, g1, g2], { top: 3, deck: [5, 5, 5, 5, 5, 5], opts: { double: true } });
  M.handle(g, 'p0', { t: 'draw' });
  M.handle(g, 'p0', { t: 'discard' });
  assert.equal(M.handle(g, 'p0', { t: 'flip', i: 11 }).ok, true);
  assert.equal(g.endBy, 0);
  assert.equal(g.phase, 'play');
  assert.equal(g.active, 1);
  M.handle(g, 'p1', { t: 'draw' }); M.handle(g, 'p1', { t: 'discard' }); M.handle(g, 'p1', { t: 'flip', i: 1 });
  assert.equal(g.phase, 'play');
  assert.equal(g.active, 2);
  M.handle(g, 'p2', { t: 'draw' }); M.handle(g, 'p2', { t: 'discard' });
  assert.equal(g.phase, 'play', 'noch nicht vorbei, P2 muss noch aufdecken');
  M.handle(g, 'p2', { t: 'flip', i: 1 });
  assert.equal(g.phase, 'round');
  for (const p of g.players) assert.ok(p.grid.every((c) => c === null || c.up), 'alles aufgedeckt');
  assert.equal(g.result.finisher, 'p0');
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, false, 'nach dem Ende keine Züge mehr');
  const after = snap(g);
  assert.equal(M.handle(g, 'p1', { t: 'next' }).ok, false, 'nur der Gastgeber');
  assert.equal(snap(g), after);
});

test('Rundenende: zählt Summe der Kartenwerte, entfernte Spalten zählen 0', () => {
  const gr = Array.from({ length: 12 }, () => cell(2, true));
  gr[0] = cell(5, true); gr[4] = cell(5, true); gr[8] = cell(9, false);
  const g = play([gr, H12().map((c) => ({ ...c, up: true })), H12()], { top: 5, deck: [9, 9, 9, 9] });
  // P0 beendet mit Aufdecken der 9 -> Spalte 0 (5,5,9) bleibt, kein Dreier. Spalte 1..3 sind 2,2,2 -> werden entfernt.
  M.handle(g, 'p0', { t: 'draw' }); M.handle(g, 'p0', { t: 'discard' });
  M.handle(g, 'p0', { t: 'flip', i: 8 });
  assert.deepEqual(g.players[0].gone, [2, 2, 2]);
  assert.equal(g.endBy, 0);
  M.handle(g, 'p1', { t: 'draw' }); M.handle(g, 'p1', { t: 'discard' });
  M.handle(g, 'p2', { t: 'draw' }); M.handle(g, 'p2', { t: 'discard' }); M.handle(g, 'p2', { t: 'flip', i: 0 });
  assert.equal(g.phase, 'round');
  assert.equal(g.result.raw.p0, 5 + 5 + 9);
  assert.equal(g.result.raw.p1, 78);
});

// P0 beendet mit `rawEnder` Punkten, die anderen haben `rawOthers`; alle Raster: elf offene Nullen plus eine Karte.
function endRoundScenario(rawEnder, rawOthers, opts = { double: true }, totals = null, limit) {
  const mk = (sum, up) => { const gr = Array.from({ length: 12 }, () => cell(0, true)); gr[0] = cell(sum, up); return gr; };
  const g = play([mk(rawEnder, false), ...rawOthers.map((s) => mk(s, true))], { opts, deck: Array(20).fill(1), limit });
  if (totals) totals.forEach((t, i) => { g.players[i].total = t; });
  M.handle(g, 'p0', { t: 'draw' }); M.handle(g, 'p0', { t: 'discard' }); M.handle(g, 'p0', { t: 'flip', i: 0 });
  for (let k = 1; k <= rawOthers.length; k++) { M.handle(g, 'p' + k, { t: 'draw' }); M.handle(g, 'p' + k, { t: 'discard' }); }
  return g;
}
test('Verdoppelung: strikt niedrigste Punktzahl -> normal', () => {
  const g = endRoundScenario(5, [10, 12]);
  assert.equal(g.phase, 'round');
  assert.equal(g.result.doubled, false);
  assert.equal(g.result.pts.p0, 5);
  assert.equal(g.players[0].total, 5);
  assert.equal(g.players[1].total, 10);
});
test('Verdoppelung: Gleichstand mit einer anderen Person -> doppelt', () => {
  const g = endRoundScenario(10, [10, 12]);
  assert.equal(g.result.doubled, true);
  assert.equal(g.result.pts.p0, 20);
  assert.equal(g.players[0].total, 20);
  assert.equal(g.players[1].total, 10);
  assert.equal(g.players[0].round, 20);
});
test('Verdoppelung: eine andere Person hat weniger -> doppelt; Option aus -> nie', () => {
  const g = endRoundScenario(10, [3, 12]);
  assert.equal(g.result.doubled, true);
  assert.equal(g.result.pts.p0, 20);
  const g2 = endRoundScenario(10, [3, 12], { double: false });
  assert.equal(g2.result.doubled, false);
  assert.equal(g2.result.pts.p0, 10);
});
test('Verdoppelung: negative Punkte und null werden nicht verdoppelt (auch bei Gleichstand / schlechterer Lage)', () => {
  const g = endRoundScenario(-3, [-9, 12]);
  assert.equal(g.result.raw.p0, -3);
  assert.equal(g.result.doubled, false);
  assert.equal(g.result.pts.p0, -3);
  assert.equal(g.players[0].total, -3);
  const g0 = endRoundScenario(0, [-5, 12]);
  assert.equal(g0.result.doubled, false);
  assert.equal(g0.result.pts.p0, 0);
  const geq = endRoundScenario(-4, [-4, 1]);
  assert.equal(geq.result.pts.p0, -4);
});

test('Spielende ab 100 Punkten: erst ab 100, Sieger ist, wer die wenigsten hat', () => {
  const a = endRoundScenario(3, [9], { double: false }, [96, 90]); // 99 / 99
  assert.equal(a.phase, 'round', '99 ist noch nicht 100');
  const g = endRoundScenario(4, [9], { double: false }, [96, 90]); // 100 / 99
  assert.equal(g.phase, 'over');
  assert.equal(g.players[0].total, 100);
  const r = M.ranking(g);
  assert.equal(r[0].id, 'p1');
  assert.equal(r[0].winner, true);
  assert.equal(r[1].winner, false);
  assert.equal(r[0].rank, 1);
  assert.equal(r[1].rank, 2);
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false, 'nach dem Spielende keine nächste Runde');
  assert.equal(M.handle(g, 'p0', { t: 'draw' }).ok, false);
});
test('Spielende: Gleichstand = geteilter Sieg; Verdoppelung zählt mit', () => {
  const g = endRoundScenario(3, [3], { double: false }, [97, 97]);
  assert.equal(g.phase, 'over');
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => x.winner), [true, true]);
  assert.deepEqual(r.map((x) => x.rank), [1, 1]);
  const d = endRoundScenario(6, [4], { double: true }, [60, 60]); // P0 verdoppelt: 12 -> 72
  assert.equal(d.players[0].total, 72);
  assert.equal(d.phase, 'round');
  const d2 = endRoundScenario(25, [4], { double: true }, [60, 60]); // 50 -> 110
  assert.equal(d2.phase, 'over');
  assert.equal(M.ranking(d2)[0].id, 'p1');
  assert.equal(M.ranking(endRoundScenario(3, [3], { double: false }, [10, 10]))[0].winner, false, 'ohne Spielende kein Sieger');
});
test('Spielende: Limit-Option (Test) gilt', () => {
  const g = endRoundScenario(4, [9], { double: false }, [0, 0], 5);
  assert.equal(g.phase, 'over');
});

test('Nächste Runde: nur Gastgeber, Startperson rotiert, Spielstand bleibt, Kartenbilanz', () => {
  const g = endRoundScenario(5, [10, 12]);
  assert.equal(g.phase, 'round');
  const starter = g.starter;
  const totals = g.players.map((p) => p.total);
  assert.equal(M.handle(g, 'p1', { t: 'next' }).ok, false);
  assert.equal(M.handle(g, 'nobody', { t: 'next' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'next' }, seeded(3)).ok, true);
  assert.equal(g.round, 2);
  assert.equal(g.phase, 'reveal');
  assert.equal(g.starter, (starter + 1) % 3);
  assert.deepEqual(g.players.map((p) => p.total), totals);
  assert.deepEqual(multiset(g), FULL);
  assert.ok(g.players.every((p) => p.gone.length === 0 && p.grid.every((c) => c && !c.up)));
  assert.equal(g.endBy, null);
  for (const p of g.players) { M.handle(g, p.id, { t: 'reveal', i: 0 }); M.handle(g, p.id, { t: 'reveal', i: 1 }); }
  assert.equal(g.phase, 'play');
  assert.equal(g.active, g.starter, 'ab Runde 2 beginnt die rotierte Person, nicht die mit der höchsten Summe');
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false, 'Runde läuft');
});

test('Stapel leer: Ablage (ohne oberste Karte) wird neu gemischt', () => {
  const g = play([H12(), H12()], { top: 6, deck: [] });
  g.discard = [1, 2, 3, 4, 5, 6];
  const bal = multiset(g);
  assert.equal(M.handle(g, 'p0', { t: 'draw' }, seeded(11)).ok, true);
  assert.deepEqual(g.discard, [6]);
  assert.equal(g.deck.length, 4);
  assert.ok([1, 2, 3, 4, 5].includes(g.turn.drawn));
  assert.deepEqual([...g.deck, g.turn.drawn].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(multiset(g), bal);
  assert.ok(g.recap.some((x) => x.includes('neu gemischt')));
  // nur die oberste Karte auf der Ablage: Ziehen nicht möglich, Zustand unverändert
  const e = play([H12(), H12()], { top: 6, deck: [] });
  const s0 = snap(e);
  assert.equal(M.handle(e, 'p0', { t: 'draw' }).ok, false);
  assert.equal(snap(e), s0);
});
test('Stapel leer: entfernte Spalten (auf der Ablage) werden mitgemischt, Bilanz stimmt', () => {
  const gr = hidden([0, 1, 2, 3, 0, 4, 4, 4, 3, 4, 4, 4]);
  gr[0] = cell(6, true); gr[4] = cell(6, true);
  const g = play([gr, H12()], { top: 6, deck: [] });
  M.handle(g, 'p0', { t: 'swap', from: 'discard', i: 8 });
  assert.equal(g.discard.length, 4);
  const bal = multiset(g);
  M.handle(g, 'p1', { t: 'draw' }, seeded(4));
  assert.equal(g.discard.length, 1);
  assert.equal(g.deck.length, 2);
  assert.deepEqual(multiset(g), bal);
});

test('Ungültige Züge und falsche Person ändern den Zustand nicht', () => {
  const g = play([[cell(9, true), ...hidden([4, 5, 6, 7, 8, 1, 2, 3, 10, 11, 12])], H12(), H12()], { top: 2 });
  const s0 = snap(g);
  const bad = [
    ['p1', { t: 'draw' }], ['p2', { t: 'swap', from: 'discard', i: 0 }], ['zzz', { t: 'draw' }],
    ['p0', { t: 'swap', from: 'discard', i: 12 }], ['p0', { t: 'swap', from: 'discard', i: -1 }], ['p0', { t: 'swap', from: 'discard', i: '3' }],
    ['p0', { t: 'swap', from: 'discard', i: 1.5 }], ['p0', { t: 'swap', from: 'discard' }], ['p0', { t: 'swap', from: 'drawn', i: 0 }],
    ['p0', { t: 'swap', from: 'deck', i: 0 }], ['p0', { t: 'discard' }], ['p0', { t: 'flip', i: 1 }], ['p0', { t: 'reveal', i: 1 }],
    ['p0', { t: 'next' }], ['p0', { t: 'zug' }], ['p0', {}], ['p0', null], ['p0', 'draw'], ['p0', { t: 5 }],
  ];
  for (const [pid, msg] of bad) {
    const r = M.handle(g, pid, msg);
    assert.equal(r.ok, false, JSON.stringify([pid, msg]));
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
    assert.equal(snap(g), s0, 'Zustand verändert bei ' + JSON.stringify(msg));
  }
  assert.equal(M.handle(null, 'p0', { t: 'draw' }).ok, false);
  assert.equal(M.handle({ game: 'xx' }, 'p0', { t: 'draw' }).ok, false);
  // entferntes Feld
  const gr = H12(); gr[0] = null; gr[4] = null; gr[8] = null;
  const g2 = play([gr, H12()]);
  const s1 = snap(g2);
  assert.equal(M.handle(g2, 'p0', { t: 'swap', from: 'discard', i: 0 }).ok, false);
  assert.equal(snap(g2), s1);
});

// ---------- Zufallspartien ----------
function randomMove(g, rng) {
  const pick = (a) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))];
  const p = g.players[g.active];
  const live = p.grid.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const hid = p.grid.map((c, i) => (c && !c.up ? i : -1)).filter((i) => i >= 0);
  if (g.turn.stage === 'start') return rng() < 0.5 ? { t: 'draw' } : { t: 'swap', from: 'discard', i: pick(live) };
  if (g.turn.stage === 'drawn') return rng() < 0.5 ? { t: 'discard' } : { t: 'swap', from: 'drawn', i: pick(live) };
  return { t: 'flip', i: pick(hid) };
}
test('300 Zufallspartien mit 2 bis 8 Personen enden immer; Kartenbilanz stimmt nach jedem Zug', () => {
  let rounds = 0; let doubled = 0; let triples = 0; let reshuffles = 0; let moves = 0;
  for (let k = 0; k < 300; k++) {
    const n = 2 + (k % 7);
    const rng = seeded(1000 + k);
    const g = M.createGame(players(n), { double: k % 5 !== 0, limit: k % 3 === 0 ? 100 : 40 }, rng);
    let steps = 0;
    while (g.phase !== 'over') {
      assert.ok(steps++ < 60000, 'Partie endet nicht');
      let r;
      if (g.phase === 'reveal') {
        const p = g.players.find((q) => M.upCount(q) < 2);
        const hid = p.grid.map((c, i) => (c && !c.up ? i : -1)).filter((i) => i >= 0);
        r = M.handle(g, p.id, { t: 'reveal', i: hid[Math.floor(rng() * hid.length)] }, rng);
      } else if (g.phase === 'round') {
        r = M.handle(g, g.hostId, { t: 'next' }, rng);
        rounds++;
      } else {
        const before = g.recap.filter((x) => x.includes('neu gemischt')).length;
        r = M.handle(g, g.players[g.active].id, randomMove(g, rng), rng);
        reshuffles += g.recap.filter((x) => x.includes('neu gemischt')).length > before ? 1 : 0;
        moves++;
        if (g.phase !== 'play' && g.result.doubled) doubled++;
      }
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(multiset(g), FULL, 'Kartenbilanz in Partie ' + k);
    }
    if (g.players.some((p) => p.gone.length)) triples++;
    assert.ok(g.players.some((p) => p.total >= g.limit));
    const w = M.ranking(g).filter((x) => x.winner);
    assert.ok(w.length >= 1);
    const min = Math.min(...g.players.map((p) => p.total));
    assert.ok(w.every((x) => x.total === min));
    for (const p of g.players) assert.ok(p.grid.every((c) => c === null || c.up), 'am Ende alles offen');
  }
  console.log(`  Zufallspartien: ${moves} Züge, ${rounds} Rundenwechsel, ${doubled} Verdoppelungen, ${triples} Partien mit Dreier-Spalte`);
  assert.ok(rounds >= 30 && doubled > 0 && triples > 0);
});

test('ranking: Reihenfolge nach Punkten, Gleichstand teilt den Rang', () => {
  const g = M.createGame(players(4), {}, seeded(1));
  [10, -3, 10, 50].forEach((t, i) => { g.players[i].total = t; });
  const r = M.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['p1', 'p0', 'p2', 'p3']);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4]);
  assert.ok(r.every((x) => x.winner === false));
});
