import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../memo/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mk = (n = 2, o = {}, seed = 1) => E.createGame(P(n), o, seedRng(seed));
// Finde zwei Indizes mit gleichem / verschiedenem Bild unter den verdeckten
const pairIdx = (g) => { for (let i = 0; i < g.cards.length; i++) if (g.st[i] === 0) for (let j = i + 1; j < g.cards.length; j++) if (g.st[j] === 0 && g.cards[i] === g.cards[j]) return [i, j]; return null; };
const missIdx = (g) => { const d = E.downIndices(g); for (const i of d) for (const j of d) if (i !== j && g.cards[i] !== g.cards[j]) return [i, j]; return null; };

test('alle Größen: Raster, Paare korrekt verteilt', () => {
  const want = { klein: [4, 3, 6], mittel: [4, 4, 8], gross: [5, 4, 10], riesig: [6, 5, 15] };
  for (const [size, [c, r, p]] of Object.entries(want)) for (const theme of E.THEME_IDS) {
    const g = mk(2, { size, theme }, 7);
    assert.equal(g.cols, c); assert.equal(g.rows, r); assert.equal(g.pairs, p);
    assert.equal(g.cards.length, c * r);
    const cnt = {}; g.cards.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
    assert.equal(Object.keys(cnt).length, p);
    assert.ok(Object.values(cnt).every((v) => v === 2), 'jedes Bild genau zweimal');
    const ids = E.THEMES[theme].items.map((x) => x.id);
    assert.ok(Object.keys(cnt).every((k) => ids.includes(k)));
  }
});
test('Standard: mittel, tiere, Karten bleiben offen; Themen haben mind. 15 eindeutige Bilder', () => {
  const g = mk();
  assert.equal(g.size, 'mittel'); assert.equal(g.theme, 'tiere'); assert.equal(g.hold, true);
  assert.equal(mk(2, { hold: false }).hold, false);
  assert.equal(mk(2, { size: 'quatsch', theme: 'x' }).size, 'mittel');
  for (const t of E.THEME_IDS) {
    const it = E.THEMES[t].items;
    assert.ok(it.length >= 15, t);
    assert.equal(new Set(it.map((x) => x.e)).size, it.length, 'Emoji eindeutig ' + t);
    assert.equal(new Set(it.map((x) => x.id)).size, it.length);
    assert.equal(new Set(it.map((x) => x.n)).size, it.length);
  }
});
test('Zufallsauswahl pro Spiel verschieden, aber mit gleichem Startwert gleich', () => {
  const a = mk(2, { size: 'klein' }, 1).cards.join(); const b = mk(2, { size: 'klein' }, 1).cards.join(); const c = mk(2, { size: 'klein' }, 2).cards.join();
  assert.equal(a, b); assert.notEqual(a, c);
});
test('Aufdecken, Nichttreffer, Weiter wechselt die Person', () => {
  const g = mk(2, { size: 'klein' });
  const [a, b] = missIdx(g);
  assert.ok(E.flip(g, 'p0', a).ok);
  assert.deepEqual(g.open, [a]); assert.equal(g.st[a], 1); assert.equal(g.pending, false);
  assert.deepEqual(E.faceOf(g, b), null);
  const r = E.flip(g, 'p0', b);
  assert.deepEqual([r.ok, r.match], [true, false]);
  assert.equal(g.pending, true); assert.equal(g.tries, 1); assert.equal(g.triesBy[0], 1); assert.equal(g.scores[0], 0);
  assert.equal(E.flip(g, 'p0', E.downIndices(g)[0]).ok, false, 'während Weiter gewartet wird, keine dritte Karte');
  assert.equal(E.weiter(g, 'p1').ok, false, 'bei Option AN nur wer dran ist');
  assert.ok(E.weiter(g, 'p0').ok);
  assert.deepEqual(g.st.filter((s) => s !== 0), []);
  assert.equal(g.turn, 1); assert.equal(g.open.length, 0); assert.equal(g.turnNo, 1);
});
test('Treffer: Punkt, Karten weg, nochmal dran', () => {
  const g = mk(2, { size: 'klein' });
  const [a, b] = pairIdx(g);
  E.flip(g, 'p0', a);
  const r = E.flip(g, 'p0', b);
  assert.equal(r.match, true);
  assert.equal(g.st[a], 2); assert.equal(g.st[b], 2);
  assert.equal(g.scores[0], 1); assert.equal(g.turn, 0); assert.equal(g.pending, false); assert.equal(g.open.length, 0);
  assert.equal(g.evt.kind, 'match'); assert.equal(g.found.length, 1);
  assert.ok(E.faceOf(g, a) !== null);
  assert.equal(E.flip(g, 'p0', a).ok, false, 'gefundene Karte nicht mehr wählbar');
});
test('Weiter-Option AUS: auch die Zeitschaltung (jede mitspielende Person) darf weiter', () => {
  const g = mk(2, { size: 'klein', hold: false });
  const [a, b] = missIdx(g);
  E.flip(g, 'p0', a); E.flip(g, 'p0', b);
  assert.equal(E.weiter(g, 'fremd').ok, false);
  assert.ok(E.weiter(g, 'p1').ok);
  assert.equal(g.turn, 1);
});
test('ungültige Züge und falsche Person', () => {
  const g = mk(2, { size: 'klein' });
  for (const [pid, m] of [['p1', { t: 'flip', i: 0 }], ['x', { t: 'flip', i: 0 }], ['p0', { t: 'flip', i: -1 }], ['p0', { t: 'flip', i: 12 }], ['p0', { t: 'flip', i: 1.5 }], ['p0', { t: 'flip', i: '1' }], ['p0', { t: 'flip' }], ['p0', { t: 'weiter' }], ['p0', { t: 'nix' }], ['p0', null], ['p0', 'flip']]) {
    const before = JSON.stringify(g);
    assert.equal(E.handle(g, pid, m).ok, false, JSON.stringify([pid, m]));
    assert.equal(JSON.stringify(g), before, 'Zustand unverändert');
  }
  E.flip(g, 'p0', 0);
  assert.equal(E.flip(g, 'p0', 0).ok, false, 'gleiche Karte zweimal');
});
test('Spielende, Rangliste, Gleichstand', () => {
  const g = mk(2, { size: 'klein' });
  while (g.mode === 'play') { const [a, b] = pairIdx(g); const who = g.players[g.turn].id; E.flip(g, who, a); E.flip(g, who, b); }
  assert.equal(g.mode, 'over'); assert.equal(g.scores[0], 6); assert.equal(g.scores[1], 0);
  const o = E.outcome(g);
  assert.deepEqual(o.winners, ['p0']); assert.equal(o.ranking[0].rank, 1); assert.equal(o.ranking[1].rank, 2);
  assert.equal(E.flip(g, 'p0', 0).ok, false);
  // Gleichstand: c = Paar nehmen, p = absichtlich daneben und weiter
  const t = mk(2, { size: 'klein' });
  for (const step of ['c', 'c', 'p', 'c', 'p', 'c', 'p', 'c', 'c']) {
    const who = t.players[t.turn].id;
    if (step === 'c') { const [x, y] = pairIdx(t); E.flip(t, who, x); E.flip(t, who, y); } else { const [x, y] = missIdx(t); E.flip(t, who, x); E.flip(t, who, y); E.weiter(t, who); }
  }
  assert.equal(t.mode, 'over');
  assert.equal(t.scores[0], 3); assert.equal(t.scores[1], 3);
  const ot = E.outcome(t);
  assert.deepEqual(ot.winners.sort(), ['p0', 'p1']); assert.ok(ot.ranking.every((r) => r.rank === 1 && r.win));
});
test('Solo: Versuche zählen, Zug bleibt bei der Person', () => {
  const g = mk(1, { size: 'klein' });
  const [a, b] = missIdx(g);
  E.flip(g, 'p0', a); E.flip(g, 'p0', b);
  assert.equal(g.tries, 1); E.weiter(g, 'p0'); assert.equal(g.turn, 0);
  const [c, d] = pairIdx(g); E.flip(g, 'p0', c); E.flip(g, 'p0', d);
  assert.equal(g.tries, 2);
  while (g.mode === 'play') { const [x, y] = pairIdx(g); E.flip(g, 'p0', x); E.flip(g, 'p0', y); }
  const o = E.outcome(g); assert.equal(o.kind, 'solo'); assert.equal(o.tries, 2 + (g.pairs - 1));
});
test('JSON-sicher, Aufdeckungen öffentlich, verdeckte Bilder nur über cards', () => {
  const g = mk(3, { size: 'gross', theme: 'natur' });
  const [a, b] = missIdx(g);
  E.flip(g, 'p0', a); E.flip(g, 'p0', b);
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.equal(g.reveals.length, 2);
  assert.equal(E.faceOf(g, E.downIndices(g)[0]), null);
  assert.equal(E.createGame(P(6), {}, seedRng(1)).players.length, 4);
});
test('300 Zufallspartien enden (1 bis 4 Personen, alle Größen)', () => {
  const sizes = E.SIZE_IDS;
  for (let n = 0; n < 300; n++) {
    const rng = seedRng(100 + n);
    const players = 1 + (n % 4);
    const g = E.createGame(P(players), { size: sizes[n % 4], theme: E.THEME_IDS[n % 4], hold: n % 3 !== 0 }, rng);
    let steps = 0;
    while (g.mode === 'play' && steps++ < 5000) {
      const who = g.players[g.turn].id;
      if (g.pending) { assert.ok(E.handle(g, who, { t: 'weiter' }).ok); continue; }
      const d = E.downIndices(g);
      assert.ok(E.handle(g, who, { t: 'flip', i: d[Math.floor(rng() * d.length)] }).ok);
      assert.ok(g.open.length <= 2);
    }
    assert.equal(g.mode, 'over', 'Partie ' + n);
    assert.equal(g.scores.reduce((a, b) => a + b, 0), g.pairs);
    assert.equal(g.st.filter((s) => s === 2).length, g.cards.length);
    assert.ok(g.tries >= g.pairs);
  }
});
