import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../koffer/engine.js';
import { DINGE } from '../koffer/dinge.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mk = (n = 2, o = {}, seed = 1) => E.createGame(P(n), o, seedRng(seed));
// richtigen Zug machen: komplette Liste + erstes Angebot
const right = (g, rng) => E.handle(g, g.players[g.turn].id, { t: 'submit', seq: g.list.slice(), add: g.offer[0] }, rng);
const next = (g, rng) => E.handle(g, g.players[g.last.by].id, { t: 'weiter' }, rng);
const wrongSeq = (g) => { const s = g.list.slice(); if (s.length >= 2) [s[0], s[1]] = [s[1], s[0]]; else if (s.length === 1) s[0] = g.grid.find((x) => x !== s[0]); return s; };

test('Katalog: mindestens 90 Dinge, eindeutige ids, Emoji und Namen', () => {
  assert.ok(DINGE.length >= 90, 'Anzahl ' + DINGE.length);
  for (const key of ['id', 'e', 'n']) assert.equal(new Set(DINGE.map((x) => x[key])).size, DINGE.length, 'doppelt: ' + key);
  for (const d of DINGE) {
    assert.match(d.id, /^[a-z]+$/, d.id);
    assert.ok(d.e.length >= 1 && d.n.length >= 2 && d.n.length <= 12, `${d.id}: Name "${d.n}"`);
    assert.ok(!/[A-Za-z]/.test(d.e), 'Emoji enthält Buchstaben: ' + d.id);
  }
  assert.equal(E.ALL_IDS.length, DINGE.length);
  assert.deepEqual(E.itemOf('socken'), { id: 'socken', e: '🧦', n: 'Socken' });
  assert.equal(E.itemOf('gibtsnicht').e, '❓');
});

test('Start: leerer Koffer, nur Angebot (8 neue Karten), kein Raster', () => {
  const g = mk(3);
  assert.equal(g.game, 'kf'); assert.equal(g.mode, 'play'); assert.equal(g.phase, 'play');
  assert.deepEqual(g.list, []); assert.deepEqual(g.grid, []);
  assert.equal(g.offer.length, 8); assert.equal(new Set(g.offer).size, 8);
  assert.ok(g.offer.every((id) => E.ALL_IDS.includes(id)));
  assert.equal(g.turn, 0); assert.equal(g.solo, false);
  assert.ok(g.players.every((p) => p.lives === 1 && !p.out));
  assert.equal(E.createGame(P(10), {}, seedRng(1)).players.length, E.MAX_PLAYERS);
});

test('richtige Folge: neues Ding wird angehängt, Reihenfolge bleibt, nächste Person', () => {
  const rng = seedRng(3); const g = mk(3, {}, 3);
  const first = g.offer[2];
  assert.ok(E.handle(g, 'p0', { t: 'submit', seq: [], add: first }, rng).ok);
  assert.deepEqual(g.list, [first]); assert.equal(g.phase, 'result'); assert.equal(g.last.ok, true); assert.equal(g.last.added, first);
  assert.equal(g.players[0].ok, 1);
  assert.ok(next(g, rng).ok);
  assert.equal(g.turn, 1); assert.equal(g.phase, 'play'); assert.equal(g.turnNo, 1);
  assert.ok(!g.offer.includes(first), 'neue Karten schon im Koffer?');
  const second = g.offer[0];
  assert.ok(E.handle(g, 'p1', { t: 'submit', seq: [first], add: second }, rng).ok);
  next(g, rng);
  assert.deepEqual(g.list, [first, second]); assert.equal(g.turn, 2);
  // falsche Reihenfolge
  const r = E.handle(g, 'p2', { t: 'submit', seq: [second, first], add: g.offer[0] }, rng);
  assert.ok(r.ok && r.correct === false && r.out === true);
  assert.deepEqual(g.list, [first, second], 'Liste bleibt bei Fehler gleich');
  assert.equal(g.last.firstBad, 0); assert.deepEqual(g.last.expected, [first, second]); assert.deepEqual(g.last.seq, [second, first]);
});

test('jede Art von Abweichung ist ein Fehler: falsches Ding, zu kurz, zu lang, vertauscht, leer', () => {
  const variants = (list, other) => [
    ['zu kurz', list.slice(0, -1)], ['zu lang', list.concat(other)], ['leer', []],
    ['falsches Ding vorn', [other, ...list.slice(1)]], ['falsches Ding hinten', [...list.slice(0, -1), other]],
    ['vertauscht', (() => { const s = list.slice(); [s[1], s[2]] = [s[2], s[1]]; return s; })()],
    ['umgekehrt', list.slice().reverse()],
  ];
  const rng = seedRng(5);
  const base = mk(2, {}, 5);
  while (base.list.length < 4) { right(base, rng); next(base, rng); }
  const list = base.list.slice();
  const other = E.ALL_IDS.find((x) => !list.includes(x));
  for (const [name, seq] of variants(list, other)) {
    const g = JSON.parse(JSON.stringify(base));
    const who = g.players[g.turn].id;
    const r = E.handle(g, who, { t: 'submit', seq, add: g.offer[0] }, rng);
    assert.ok(r.ok && r.correct === false, name);
    assert.deepEqual(g.list, list, name);
    assert.equal(g.players[g.turn].out, true, name);
    assert.equal(g.last.lost, true, name);
  }
  // identische Folge ist richtig
  const g = JSON.parse(JSON.stringify(base));
  assert.equal(E.handle(g, g.players[g.turn].id, { t: 'submit', seq: list.slice(), add: g.offer[0] }, rng).correct, true);
});

test('Ausscheiden: raus, übersprungen, Rest spielt weiter, letzte Person gewinnt', () => {
  const rng = seedRng(7); const g = mk(3, {}, 7);
  right(g, rng); next(g, rng); // p0 ok, p1 dran
  const r1 = E.handle(g, 'p1', { t: 'submit', seq: ['x1'], add: g.offer[0] }, rng);
  assert.equal(r1.out, true); assert.equal(g.mode, 'play'); assert.equal(g.phase, 'result');
  assert.equal(g.players[1].out, true); assert.equal(g.players[1].outNo, 1);
  next(g, rng);
  assert.equal(g.turn, 2);
  right(g, rng); next(g, rng);
  assert.equal(g.turn, 0, 'p1 wird übersprungen');
  const r2 = E.handle(g, 'p0', { t: 'submit', seq: [], add: g.offer[0] }, rng);
  assert.equal(r2.over, true); assert.equal(g.mode, 'over');
  assert.equal(g.players[0].out, true);
  const rk = E.ranking(g);
  assert.deepEqual(rk.map((x) => x.id), ['p2', 'p0', 'p1']);
  assert.deepEqual(rk.map((x) => x.rank), [1, 2, 3]);
  assert.deepEqual(rk.map((x) => x.win), [true, false, false]);
  const o = E.outcome(g);
  assert.deepEqual(o.winners, ['p2']); assert.equal(o.length, g.list.length);
  assert.equal(E.outcome(mk(2)), null);
});

test('Option Fehlerpunkte (lives2): erst der zweite Fehler wirft raus, Liste bleibt', () => {
  const rng = seedRng(9); const g = mk(2, { lives2: true }, 9);
  assert.ok(g.players.every((p) => p.lives === 2));
  right(g, rng); next(g, rng);
  const list = g.list.slice();
  const r = E.handle(g, 'p1', { t: 'submit', seq: ['nix'], add: g.offer[0] }, rng);
  assert.equal(r.out, false); assert.equal(g.players[1].lives, 1); assert.equal(g.players[1].out, false); assert.equal(g.mode, 'play');
  assert.equal(g.last.out, false); assert.equal(g.last.livesLeft, 1);
  next(g, rng); // p0
  right(g, rng); next(g, rng); // p1 wieder dran
  assert.equal(g.turn, 1);
  const r2 = E.handle(g, 'p1', { t: 'submit', seq: [], add: g.offer[0] }, rng);
  assert.equal(r2.out, true); assert.equal(g.mode, 'over'); assert.equal(g.players[1].lives, 0);
  assert.equal(g.list.length, list.length + 1);
  assert.deepEqual(E.outcome(g).winners, ['p0']);
  // ohne Option: sofort raus
  const g2 = mk(2, {}, 9); right(g2, rng); next(g2, rng);
  assert.equal(E.handle(g2, 'p1', { t: 'submit', seq: [], add: g2.offer[0] }, rng).out, true);
});

test('Solo: ein Fehler beendet, Länge = Bestleistung, lives2 wird ignoriert', () => {
  const rng = seedRng(11); const g = mk(1, { lives2: true }, 11);
  assert.equal(g.solo, true); assert.equal(g.opts.lives2, false); assert.equal(g.players[0].lives, 1);
  for (let i = 0; i < 6; i++) { assert.equal(right(g, rng).correct, true); assert.equal(g.phase, 'result'); next(g, rng); assert.equal(g.turn, 0); }
  assert.equal(g.list.length, 6);
  const r = E.handle(g, 'p0', { t: 'submit', seq: wrongSeq(g), add: g.offer[0] }, rng);
  assert.equal(r.over, true); assert.equal(g.mode, 'over');
  assert.equal(g.result.length, 6); assert.equal(g.list.length, 6);
  const o = E.outcome(g);
  assert.equal(o.solo, true); assert.equal(o.length, 6); assert.deepEqual(o.winners, []);
  assert.equal(E.handle(g, 'p0', { t: 'weiter' }, rng).ok, false);
});

test('Raster-Generator: enthält alle benutzten Dinge, keine Doppelten, Größe 24 bis 30', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seedRng(seed);
    for (const n of [0, 1, 2, 5, 11, 12, 13, 19, 20, 25, 28]) {
      const list = [...E.ALL_IDS].sort(() => rng() - 0.5).slice(0, n);
      const grid = E.makeGrid(list, rng);
      assert.equal(new Set(grid).size, grid.length, 'Duplikate');
      for (const id of list) assert.ok(grid.includes(id), `benutztes Ding fehlt n=${n}`);
      assert.ok(grid.length >= 24 && grid.length <= 30, `Größe ${grid.length} bei n=${n}`);
      assert.equal(grid.length, E.gridSizeFor(n));
      const offer = E.makeOffer(list, grid, rng);
      assert.equal(offer.length, 8); assert.equal(new Set(offer).size, 8);
      assert.ok(offer.every((id) => !list.includes(id)), 'Angebot enthält schon benutztes Ding');
      assert.ok(offer.every((id) => !grid.includes(id)), 'Angebot überschneidet sich mit Raster');
    }
  }
  assert.equal(E.gridSizeFor(3), 24); assert.equal(E.gridSizeFor(11), 24); assert.equal(E.gridSizeFor(12), 28); assert.equal(E.gridSizeFor(20), 30);
  assert.equal(E.gridSizeFor(40), 42, 'sehr lange Listen: passen immer hinein');
});

test('Raster wird jeden Zug neu gemischt (Position verrät nichts) und wächst', () => {
  const rng = seedRng(21); const g = mk(2, {}, 21);
  const orders = new Set(); let prevUsed = 0;
  for (let i = 0; i < 14; i++) {
    right(g, rng); next(g, rng);
    assert.ok(g.grid.length >= 24 && g.grid.length <= 30);
    for (const id of g.list) assert.ok(g.grid.includes(id));
    assert.ok(g.list.length > prevUsed); prevUsed = g.list.length;
    if (g.list.length >= 6) orders.add(g.grid.slice().join());
  }
  assert.equal(orders.size, 9, 'Raster jedes Mal anders');
  // Platz eines benutzten Dings schwankt
  const pos = new Set();
  for (let s = 1; s < 30; s++) { const r = seedRng(s); pos.add(E.makeGrid(['socken', 'hose', 'hemd'], r).indexOf('socken')); }
  assert.ok(pos.size > 8);
});

test('ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const rng = seedRng(13); const g = mk(2, {}, 13);
  const ok = () => JSON.stringify(g);
  const s0 = ok();
  const bads = [
    [null, 'p0'], [undefined, 'p0'], ['x', 'p0'], [{}, 'p0'], [{ t: 'quatsch' }, 'p0'],
    [{ t: 'submit', seq: [], add: g.offer[0] }, 'p1'], // nicht dran
    [{ t: 'submit', seq: [], add: g.offer[0] }, 'fremd'],
    [{ t: 'submit', seq: 'x', add: g.offer[0] }, 'p0'],
    [{ t: 'submit', seq: [1, 2], add: g.offer[0] }, 'p0'],
    [{ t: 'submit', seq: [], add: 'nichtimangebot' }, 'p0'],
    [{ t: 'submit', seq: [], add: E.ALL_IDS.find((x) => !g.offer.includes(x)) }, 'p0'],
    [{ t: 'submit', seq: [], add: 5 }, 'p0'],
    [{ t: 'submit', seq: [] }, 'p0'], // richtig, aber ohne neues Ding
    [{ t: 'submit', seq: new Array(500).fill('a'), add: g.offer[0] }, 'p0'],
    [{ t: 'weiter' }, 'p0'], // keine Ergebnisphase
  ];
  for (const [m, who] of bads) {
    const r = E.handle(g, who, m, rng);
    assert.equal(r.ok, false, JSON.stringify(m) + who);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  }
  assert.equal(ok(), s0, 'ungültige Nachrichten ändern nichts');
  // Phase result: erneutes submit nicht möglich; weiter nur der Akteur (oder skip)
  right(g, rng);
  assert.equal(E.handle(g, 'p1', { t: 'submit', seq: g.list.slice(), add: g.offer[0] }, rng).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'submit', seq: g.list.slice(), add: g.offer[0] }, rng).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'weiter' }, rng).ok, false, 'nur wer dran war');
  assert.equal(E.handle(g, 'fremd', { t: 'weiter', skip: true }, rng).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'weiter', skip: true }, rng).ok, true, 'Weitermachen ohne die andere Person');
  assert.equal(g.turn, 1);
  // Spiel vorbei
  const g2 = mk(1, {}, 3); E.handle(g2, 'p0', { t: 'submit', seq: [], add: g2.offer[0] }, rng); next(g2, rng);
  E.handle(g2, 'p0', { t: 'submit', seq: ['x'], add: g2.offer[0] }, rng);
  assert.equal(g2.mode, 'over');
  assert.equal(E.handle(g2, 'p0', { t: 'submit', seq: [], add: g2.offer[0] }, rng).ok, false);
});

test('Computer-Aktion nur für Computer: botList', () => {
  const rng = seedRng(15);
  const g = E.createGame([{ id: 'p0', name: 'A' }, { id: 'bot1', name: 'Computer' }], {}, rng);
  right(g, rng); next(g, rng);
  assert.deepEqual(E.botList(g, 'bot1'), g.list);
  assert.deepEqual(E.botList(g, 'p0'), [], 'Menschen bekommen nichts');
  assert.deepEqual(E.botList(g, 'bot2'), []);
  const l = E.botList(g, 'bot1'); l.push('x'); assert.equal(g.list.length, 1, 'Kopie');
});

test('Koffer voll beendet das Spiel (Lernrunde-Grenze cap und MAX_LIST)', () => {
  const rng = seedRng(17);
  const g = mk(2, { cap: 3 }, 17);
  for (let i = 0; i < 2; i++) { right(g, rng); next(g, rng); }
  const r = right(g, rng);
  assert.equal(r.over, true); assert.equal(g.mode, 'over'); assert.equal(g.result.full, true); assert.equal(g.list.length, 3);
  assert.equal(E.outcome(g).winners.length, 2, 'alle, die noch drin sind');
  assert.equal(mk(2, { cap: 1 }).cap, E.MAX_LIST); assert.equal(mk(2, { cap: 'x' }).cap, E.MAX_LIST);
});

test('JSON-Sicherheit: Zustand übersteht Serialisierung in jeder Phase', () => {
  const rng = seedRng(19); const g = mk(3, { lives2: true, show: true }, 19);
  for (let i = 0; i < 12; i++) {
    const copy = JSON.parse(JSON.stringify(g));
    assert.deepEqual(copy, g);
    const who = g.players[g.turn].id;
    if (g.phase === 'play') E.handle(copy, who, { t: 'submit', seq: copy.list.slice(), add: copy.offer[0] }, seedRng(i));
    assert.ok(g.opts.show === true);
    right(g, rng);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
    next(g, rng);
  }
  assert.equal(JSON.stringify(g).includes('undefined'), false);
});

test('300 Zufallspartien enden immer, Bilanz stimmt', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seedRng(seed * 7919);
    const n = 1 + Math.floor(rng() * 8);
    const g = mk(n, { lives2: rng() < 0.4, show: rng() < 0.5, cap: rng() < 0.3 ? 4 : undefined }, seed);
    const pFail = 0.05 + rng() * 0.25;
    let steps = 0;
    while (g.mode === 'play' && steps++ < 2000) {
      const p = g.players[g.turn];
      if (g.phase === 'play') assert.ok(!p.out, 'ausgeschiedene Person ist dran');
      if (g.phase === 'play') assert.ok(g.grid.length === 0 || (g.grid.length >= 24 && g.list.every((id) => g.grid.includes(id))));
      if (g.phase === 'result') { assert.ok(next(g, rng).ok); continue; }
      const seq = rng() < pFail ? wrongSeq(g).concat(rng() < 0.5 ? ['zz'] : []) : g.list.slice();
      const r = E.handle(g, p.id, { t: 'submit', seq, add: g.offer[Math.floor(rng() * 8)] }, rng);
      assert.ok(r.ok);
      assert.equal(new Set(g.list).size, g.list.length, 'Doppeltes im Koffer');
    }
    assert.equal(g.mode, 'over', 'Partie ' + seed);
    const act = g.players.filter((p) => !p.out);
    if (!g.result.full && !g.solo) assert.equal(act.length, 1);
    if (g.solo && !g.result.full) assert.equal(act.length, 0);
    const ok = g.players.reduce((s, p) => s + p.ok, 0);
    assert.equal(ok, g.list.length, 'richtige Züge = Dinge im Koffer');
    assert.equal(g.players.filter((p) => p.out).length, g.outCount);
    const rk = E.ranking(g);
    assert.equal(rk.length, n);
    assert.equal(new Set(rk.map((x) => x.id)).size, n);
    assert.equal(rk[0].rank, 1);
    JSON.parse(JSON.stringify(g));
  }
});
