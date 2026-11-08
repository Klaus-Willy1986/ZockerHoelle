import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../minenfeld/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = [{ id: 'p0', name: 'Du' }];
const mk = (opts = {}, seed = 1) => E.createGame(P, opts, seeded(seed));
const LV = { leicht: {}, mittel: { mid: true }, schwer: { hard: true } };
const T = 1000;
const rev = (g, i, now = T) => E.handle(g, 'p0', { t: 'reveal', i, now });
const flag = (g, i) => E.handle(g, 'p0', { t: 'flag', i });

// Referenzimplementierung der Zahlen (unabhängig von neighbors())
function refNumber(g, i) {
  const r = Math.floor(i / g.w), c = i % g.w;
  let n = 0;
  for (let rr = 0; rr < g.h; rr++) for (let cc = 0; cc < g.w; cc++) {
    if ((rr !== r || cc !== c) && Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1 && g.mine[rr * g.w + cc]) n++;
  }
  return n;
}
// Spielzustand aus Minenliste bauen (Spiel läuft schon)
function fixed(w, h, mines, opts = {}) {
  const g = mk(opts);
  g.w = w; g.h = h; g.mines = mines.length; g.mode = 'play'; g.startAt = 1;
  g.open = new Array(w * h).fill(0); g.flag = new Array(w * h).fill(0);
  g.mine = new Array(w * h).fill(0); for (const m of mines) g.mine[m] = 1;
  g.first = 0;
  return g;
}

test('Stufen: Größe, Minenzahl, Vorrang hard > mid', () => {
  assert.deepEqual([mk().w, mk().h, mk().mines], [8, 8, 8]);
  assert.deepEqual([mk({ mid: true }).w, mk({ mid: true }).mines], [10, 15]);
  assert.deepEqual([mk({ hard: true }).w, mk({ hard: true }).mines], [12, 28]);
  assert.equal(mk({ hard: true, mid: true }).level, 'schwer');
  assert.equal(mk({ mid: true }).level, 'mittel');
  assert.equal(mk({}).chord, true);
  assert.equal(mk({ chord: false }).chord, false);
  assert.equal(mk({}).mode, 'ready');
  assert.equal(mk({}).mine, null);
});

test('Minenverteilung: 500 Seeds je Stufe, erstes Feld + Nachbarn frei, richtige Anzahl', () => {
  for (const [name, opts] of Object.entries(LV)) {
    for (let seed = 1; seed <= 500; seed++) {
      const g = mk(opts, seed);
      const first = (seed * 37) % (g.w * g.h); // auch Ecken und Ränder kommen vor
      assert.ok(rev(g, first).ok);
      assert.equal(g.mine.reduce((a, b) => a + b, 0), E.LEVELS[name].mines, `${name} ${seed}`);
      assert.equal(g.mine[first], 0);
      for (const j of E.neighbors(g, first)) assert.equal(g.mine[j], 0, `${name} Seed ${seed}: Nachbar ${j}`);
      assert.equal(g.open[first], 1);
      assert.notEqual(g.mode, 'lost');
    }
  }
  for (const first of [0, 7, 56, 63]) { const g = mk({}, first + 3); rev(g, first); assert.equal(g.mine.reduce((a, b) => a + b), 8); }
});

test('gleicher Seed + gleiches Feld = gleiche Minen; anderer Seed anders', () => {
  const a = mk({}, 5), b = mk({}, 5), c = mk({}, 6);
  rev(a, 20); rev(b, 20); rev(c, 20);
  assert.deepEqual(a.mine, b.mine);
  assert.notDeepEqual(a.mine, c.mine);
});

test('Zahlen stimmen mit der Referenzimplementierung überein', () => {
  for (const opts of Object.values(LV)) {
    for (let seed = 1; seed <= 40; seed++) {
      const g = mk(opts, seed);
      rev(g, 27);
      for (let i = 0; i < g.w * g.h; i++) assert.equal(E.numberAt(g, i), refNumber(g, i));
    }
  }
});

test('Flutfüllung: Beispiel 5x5', () => {
  const g = fixed(5, 5, [14, 20, 24]);
  assert.ok(rev(g, 0).ok);
  const shown = (r) => [...Array(5).keys()].map((c) => (g.open[r * 5 + c] ? E.numberAt(g, r * 5 + c) : '#')).join('');
  assert.equal(shown(0), '00000');
  assert.equal(shown(1), '00011');
  assert.equal(shown(2), '0001#');
  assert.equal(shown(3), '1102#');
  assert.equal(shown(4), '#101#');
  assert.equal(g.mode, 'play');
});

test('Flutfüllung: Zahlenfeld öffnet nur sich selbst, Flagge wird beim Fluten entfernt, keine Mine geöffnet', () => {
  const g = fixed(5, 5, [24]);
  assert.ok(rev(g, 23).ok);
  assert.equal(g.open.filter(Boolean).length, 1);
  const h = fixed(5, 5, [24]);
  flag(h, 1);
  rev(h, 0);
  assert.equal(h.flag[1], 0);
  assert.equal(h.open[1], 1);
  for (let i = 0; i < 25; i++) if (g.mine[i]) assert.equal(h.open[i], 0);
});

test('Flutfüllung großes leeres Feld ist iterativ (kein Stapelüberlauf)', () => {
  const g = fixed(300, 300, [89999]);
  assert.ok(rev(g, 0).ok);
  assert.ok(g.open.filter(Boolean).length > 80000);
});

test('Mine aufdecken verliert, Flagge schützt, offene Felder bleiben', () => {
  const g = fixed(5, 5, [12, 24]);
  flag(g, 12);
  const r = rev(g, 12);
  assert.equal(r.ok, false);
  assert.equal(g.mode, 'play');
  flag(g, 12);
  assert.ok(rev(g, 12).ok);
  assert.equal(g.mode, 'lost');
  assert.equal(g.trigger, 12);
  assert.ok(g.elapsed >= 1);
  assert.equal(rev(g, 0).ok, false);
  assert.equal(flag(g, 0).ok, false);
});

test('Chord: korrekt geflaggt öffnet Rest, falsch geflaggt verliert, falsche Anzahl tut nichts', () => {
  const g = fixed(5, 5, [6, 24]); // Mine bei (1,1)
  rev(g, 12); // Zahl 1 in der Mitte
  assert.equal(E.numberAt(g, 12), 1);
  assert.equal(rev(g, 12).ok, false, 'ohne Flagge nichts');
  assert.equal(g.open[0], 0);
  flag(g, 6);
  assert.ok(rev(g, 12).ok);
  for (const j of E.neighbors(g, 12)) if (j !== 6) assert.equal(g.open[j] ? 1 : 0, 1);
  assert.equal(g.flag[6], 1);
  assert.notEqual(g.mode, 'lost');

  const h = fixed(5, 5, [6, 24]);
  rev(h, 12);
  flag(h, 7); // falsch geflaggt
  assert.ok(rev(h, 12).ok);
  assert.equal(h.mode, 'lost');
  assert.equal(h.trigger, 6);

  const k = fixed(5, 5, [6, 24]);
  rev(k, 12);
  flag(k, 7); flag(k, 8);
  assert.equal(rev(k, 12).ok, false, 'zu viele Flaggen');
  assert.equal(k.mode, 'play');
});

test('Chord kann ausgeschaltet werden (opts + Nachricht)', () => {
  const g = fixed(5, 5, [6, 24], { chord: false });
  rev(g, 12); flag(g, 6);
  assert.equal(rev(g, 12).ok, false);
  assert.ok(E.handle(g, 'p0', { t: 'opts', chord: true }).ok);
  assert.ok(rev(g, 12).ok);
  assert.equal(E.handle(g, 'p0', { t: 'opts', chord: 'ja' }).ok, false);
});

test('Gewinnbedingung und Bestzeit', () => {
  const g = fixed(3, 3, [4]); // Mitte ist Mine, alle anderen zeigen eine 1
  for (const i of [0, 1, 2, 3, 5, 6, 7]) { assert.equal(g.mode, 'play'); rev(g, i, 5000); }
  assert.equal(g.mode, 'play');
  rev(g, 8, 5000 + 7000);
  assert.equal(g.mode, 'won');
  assert.equal(g.elapsed, 11999);
  assert.equal(g.flag[4], 1, 'Minen werden bei Sieg geflaggt');
  assert.equal(E.flagsLeft(g), 0);
  assert.deepEqual(E.settleResult(g, 0).record, true);
  assert.equal(g.result.record, true);
  const g2 = fixed(3, 3, [8]);
  g2.mode = 'won'; g2.elapsed = 9000;
  assert.equal(E.settleResult(g2, 8000).record, false);
  assert.equal(E.settleResult(g2, 9500).record, true);
  assert.equal(E.settleResult(g2, 9000).record, false);
  assert.equal(E.fmtTime(83000), '1:23');
  assert.equal(E.settleResult(fixed(3, 3, [8]), 0), null);
});

test('Flaggenzähler: Minen minus Flaggen', () => {
  const g = mk({}, 3);
  assert.equal(E.flagsLeft(g), 8);
  flag(g, 0); flag(g, 1);
  assert.equal(E.flagsLeft(g), 6);
  flag(g, 0);
  assert.equal(E.flagsLeft(g), 7);
  for (let i = 0; i < 10; i++) flag(g, i);
  assert.ok(E.flagsLeft(g) < 8);
  const h = mk({}, 3);
  for (let i = 0; i < 12; i++) flag(h, i);
  assert.equal(E.flagsLeft(h), -4); // darf negativ werden (zu viele Flaggen)
  rev(h, 40);
  assert.equal(h.first, 40);
});

test('Erster Tipp sicher, auch wenn vorher Flaggen standen; geflaggtes Feld lässt sich nicht aufdecken', () => {
  const g = mk({}, 9);
  flag(g, 10);
  assert.equal(rev(g, 10).ok, false);
  assert.equal(g.mode, 'ready');
  assert.ok(rev(g, 11).ok);
  assert.equal(g.mode === 'lost', false);
});

test('Nochmal: gleiche Minen, erste Stelle wieder offen, Uhr neu', () => {
  const g = mk({}, 12);
  rev(g, 27, 1000);
  const mines = g.mine.slice();
  const m = mines.findIndex((v) => v === 1);
  rev(g, m, 3000);
  assert.equal(g.mode, 'lost');
  assert.equal(E.handle(mk({}), 'p0', { t: 'retry' }).ok, false);
  flag(g, 3);
  assert.ok(E.handle(g, 'p0', { t: 'retry', now: 9000 }).ok);
  assert.equal(g.mode, 'play');
  assert.deepEqual(g.mine, mines);
  assert.equal(g.open[27], 1);
  assert.equal(g.flag.reduce((a, b) => a + b), 0);
  assert.equal(g.trigger, -1);
  assert.equal(g.startAt, 9000);
  assert.equal(E.handle(g, 'p0', { t: 'retry' }).ok, false, 'nur nach Verlust');
});

test('Ungültige Nachrichten, falsche Person, Phase: Zustand bleibt gleich', () => {
  const g = mk({}, 4);
  rev(g, 20);
  const before = JSON.stringify(g);
  const bad = [null, undefined, 5, 'x', [], {}, { t: 'x' }, { t: 'reveal' }, { t: 'reveal', i: -1 }, { t: 'reveal', i: 64 }, { t: 'reveal', i: 1.5 },
    { t: 'reveal', i: '3' }, { t: 'flag', i: 99 }, { t: 'flag', i: NaN }, { t: 'flag', i: g.open.indexOf(1) }, { t: 'retry' }, { t: 'opts', chord: 1 }];
  for (const m of bad) { assert.equal(E.handle(g, 'p0', m).ok, false, JSON.stringify(m)); assert.equal(JSON.stringify(g), before); }
  assert.equal(E.handle(g, 'p1', { t: 'reveal', i: 1 }).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'flag', i: 1 }).ok, false);
  assert.equal(JSON.stringify(g), before);
  assert.equal(E.handle(null, 'p0', { t: 'reveal', i: 1 }).ok, false);
  assert.equal(E.handle({}, 'p0', { t: 'reveal', i: 1 }).ok, false);
  const won = fixed(3, 3, [8]); for (let i = 0; i < 8; i++) rev(won, i);
  assert.equal(won.mode, 'won');
  assert.equal(rev(won, 8).ok, false);
});

test('300 zufällige Spiele enden; Zustand bleibt JSON-sicher und konsistent', () => {
  let won = 0, lost = 0;
  for (let n = 0; n < 300; n++) {
    const rng = seeded(1000 + n);
    const opts = [{}, { mid: true }, { hard: true }][n % 3];
    const g = E.createGame(P, { ...opts, chord: n % 5 !== 0 }, rng);
    let guard = 0;
    while ((g.mode === 'ready' || g.mode === 'play') && guard++ < 2000) {
      const r = rng();
      const i = Math.floor(rng() * g.w * g.h);
      if (r < 0.15) flag(g, i); else rev(g, i, 1000 + guard);
      if (g.mode !== 'ready') {
        assert.equal(g.mine.reduce((a, b) => a + b, 0), g.mines);
        for (let k = 0; k < g.open.length; k++) if (g.open[k]) assert.equal(g.mine[k], 0, 'geöffnetes Feld ist Mine');
      }
    }
    assert.ok(g.mode === 'won' || g.mode === 'lost', `Spiel ${n} endet nicht`);
    if (g.mode === 'won') { won++; assert.equal(E.openedCount(g), E.safeTotal(g)); } else { lost++; assert.equal(g.mine[g.trigger], 1); }
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
  assert.ok(won + lost === 300);
});

test('Spiel mit perfekter Lösung (Minen bekannt) gewinnt immer', () => {
  for (const opts of Object.values(LV)) {
    const g = E.createGame(P, opts, seeded(77));
    rev(g, 0, 10);
    for (let i = 0; i < g.w * g.h; i++) if (!g.mine[i] && !g.open[i]) rev(g, i, 5000);
    assert.equal(g.mode, 'won');
  }
});

test('Lernfeld: festes 5x5, 3 Minen, Lösungsweg gewinnt ohne Raten', () => {
  const g = E.createGame(P, { learn: true }, seeded(1));
  assert.deepEqual([g.w, g.h, g.mines, g.mode, g.chord], [5, 5, 3, 'play', true]);
  assert.deepEqual(g.mine.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), E.LEARN_MINES);
  rev(g, 0);
  flag(g, 14);
  assert.equal(g.mode, 'play');
  assert.ok(rev(g, 13).ok);
  assert.equal(g.mode, 'won');
  assert.equal(E.settleResult(g, 0).record, false, 'Lernrunde zählt nicht für Bestzeit');
});

test('ranking', () => {
  const g = mk();
  assert.equal(E.ranking(g)[0].score, 0);
  assert.deepEqual(E.ranking(null), []);
});
