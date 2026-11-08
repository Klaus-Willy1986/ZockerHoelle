import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wortsuche/engine.js';
import { THEMEN } from '../wortsuche/woerter.js';

const seeded = (s) => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }];
const P1 = [{ id: 'a', name: 'Anna' }];
const rev = (s) => [...s].reverse().join('');

test('Stufen aus den Kästchen: Schwer vor Leicht, sonst Mittel', () => {
  assert.equal(E.stufeOf({}), 'mittel');
  assert.equal(E.stufeOf(null), 'mittel');
  assert.equal(E.stufeOf({ easy: true }), 'leicht');
  assert.equal(E.stufeOf({ hard: true }), 'schwer');
  assert.equal(E.stufeOf({ easy: true, hard: true }), 'schwer');
  assert.equal(E.stufeOf({ easy: false, hard: false }), 'mittel');
});

test('Gitter-Generator: 500 Gitter je Stufe, alle Wörter genau einmal, Richtungen je Stufe', () => {
  const want = { leicht: [8, 8, [0, 1]], mittel: [10, 10, [0, 1, 2]], schwer: [12, 12, [0, 1, 2, 3, 4, 5, 6, 7]] };
  for (const stufe of E.STUFE_IDS) {
    const [n, count, dirs] = want[stufe];
    const usedDirs = new Set();
    const themes = new Set();
    for (let seed = 1; seed <= 500; seed++) {
      const g = E.createGame(P2, { stufe }, seeded(seed));
      assert.equal(g.n, n); assert.equal(g.stufe, stufe);
      assert.equal(g.letters.length, n * n);
      assert.match(g.letters, /^[A-Z]+$/);
      assert.equal(g.words.length, count);
      themes.add(g.theme.id);
      assert.ok(THEMEN[g.theme.id], 'Thema existiert');
      for (const wd of g.words) {
        assert.ok(THEMEN[g.theme.id].woerter.includes(wd.w), 'Wort aus dem Thema');
        assert.ok(dirs.includes(wd.d), `Richtung ${wd.d} nicht erlaubt bei ${stufe}`);
        usedDirs.add(wd.d);
        assert.equal(wd.by, -1);
        // Wort liegt tatsächlich an der angegebenen Stelle
        const cells = E.wordCells(n, wd);
        assert.equal(cells.map((i) => g.letters[i]).join(''), wd.w);
        assert.ok(cells.every((i) => i >= 0 && i < n * n));
        // genau einmal im ganzen Gitter, in allen 8 Richtungen
        const occ = E.occurrences(g.letters, n, wd.w);
        assert.equal(occ.length, 1, `${wd.w} kommt ${occ.length}x vor`);
        assert.deepEqual(occ[0], { r: wd.r, c: wd.c, d: wd.d });
      }
      // kein Wort in einem anderen enthalten (auch rückwärts), keine Palindrome, alphabetisch
      for (const x of g.words) {
        assert.notEqual(x.w, rev(x.w));
        for (const y of g.words) if (x !== y) assert.ok(!y.w.includes(x.w) && !y.w.includes(rev(x.w)), `${x.w} in ${y.w}`);
      }
      assert.deepEqual(g.words.map((x) => x.w), g.words.map((x) => x.w).sort());
      assert.equal(new Set(g.words.map((x) => x.w)).size, count);
    }
    assert.deepEqual([...usedDirs].sort(), dirs, `alle erlaubten Richtungen kommen bei ${stufe} vor`);
    assert.ok(themes.size >= 10, 'viele Themen kommen vor: ' + themes.size);
  }
});

test('Gitter: gleicher Seed gibt dasselbe Gitter, anderer Seed ein anderes; Thema wählbar', () => {
  const a = E.createGame(P2, { stufe: 'schwer' }, seeded(7));
  const b = E.createGame(P2, { stufe: 'schwer' }, seeded(7));
  const c = E.createGame(P2, { stufe: 'schwer' }, seeded(8));
  assert.deepEqual(a, b);
  assert.notEqual(a.letters, c.letters);
  const t = E.createGame(P2, { theme: 'natur' }, seeded(3));
  assert.equal(t.theme.id, 'natur');
  const bad = E.createGame(P2, { theme: 'gibtsnicht' }, seeded(3));
  assert.ok(THEMEN[bad.theme.id]);
});

test('Füllbuchstaben folgen grob der deutschen Häufigkeit (E und N häufig, X und Q selten)', () => {
  const cnt = {};
  let total = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const g = E.createGame(P1, { stufe: 'schwer' }, seeded(seed));
    const mine = new Set(g.words.flatMap((w) => E.wordCells(g.n, w)));
    for (let i = 0; i < g.letters.length; i++) if (!mine.has(i)) { cnt[g.letters[i]] = (cnt[g.letters[i]] || 0) + 1; total++; }
  }
  assert.ok(cnt.E / total > 0.1, 'E ' + cnt.E / total);
  assert.ok(cnt.E > cnt.A && cnt.N > cnt.T);
  assert.ok((cnt.X || 0) / total < 0.01 && (cnt.Q || 0) / total < 0.01);
});

// ----- Linienprüfung: von Hand gebautes 5x5-Gitter -----
function hand() {
  const g = E.createGame(P2, { stufe: 'leicht' }, seeded(1));
  g.n = 5;
  //   0 1 2 3 4
  g.letters = ['KATZE', 'XEXXX', 'XXSXX', 'XXXEXX'.slice(0, 5), 'XXXXL'].join('');
  g.words = [{ w: 'KATZE', r: 0, c: 0, d: 0, by: -1 }, { w: 'ABCD', r: 4, c: 0, d: 0, by: -1 }]; // → in Zeile 0 und Zeile 4
  return g;
}
test('Linienprüfung: alle 8 Richtungen, vorwärts und rückwärts', () => {
  const dirs = E.DIRS8;
  for (let d = 0; d < 8; d++) {
    const g = E.createGame(P2, { stufe: 'schwer' }, seeded(5));
    g.n = 9;
    g.letters = 'X'.repeat(81);
    const [dr, dc] = dirs[d];
    const L = 4;
    const r0 = dr < 0 ? 5 : dr > 0 ? 2 : 4; const c0 = dc < 0 ? 5 : dc > 0 ? 2 : 4;
    g.words = [{ w: 'ABCD', r: r0, c: c0, d, by: -1 }, { w: 'LMNO', r: 8, c: 0, d: 0, by: -1 }].map((x) => ({ ...x }));
    g.words[1] = { w: 'LMNO', r: 8, c: 0, d: 0, by: -1 };
    const cells = E.wordCells(9, g.words[0]);
    assert.equal(cells.length, L);
    const a = cells[0]; const b = cells[L - 1];
    // Teillinie, zu lange Linie und falsche Linie sind keine Treffer
    assert.equal(E.probe(g, a, cells[2]).kind, 'falsch');
    assert.equal(E.probe(g, cells[1], b).kind, 'falsch');
    assert.equal(E.probe(g, a, b).kind, 'treffer');
    assert.equal(E.probe(g, b, a).kind, 'treffer', 'rückwärts markiert, Richtung ' + d);
    const r = E.handle(g, d % 2 ? 'b' : 'a', { t: 'line', a: b, b: a });
    assert.equal(r.ok, true);
    assert.equal(g.words[0].by, d % 2 ? 1 : 0);
    assert.equal(E.probe(g, a, b).kind, 'schon');
  }
});
test('Linienprüfung: keine gerade Linie, gleiches Feld, ungültige Felder, schon gefunden', () => {
  const g = hand();
  assert.equal(E.probe(g, 0, 7).kind, 'nolinie'); // Springerzug
  assert.equal(E.probe(g, 3, 3).kind, 'nolinie');
  assert.equal(E.probe(g, -1, 3).kind, 'nolinie');
  assert.equal(E.probe(g, 0, 25).kind, 'nolinie');
  assert.equal(E.probe(g, 1.5, 3).kind, 'nolinie');
  assert.equal(E.probe(g, '0', 4).kind, 'nolinie');
  assert.equal(E.probe(g, 0, 20).kind, 'falsch'); // gerade Linie, aber kein Wort
  assert.equal(E.probe(g, 0, 4).kind, 'treffer');
  const r = E.handle(g, 'a', { t: 'line', a: 0, b: 7 });
  assert.deepEqual([r.ok, r.kind, r.error], [false, 'nolinie', 'Das ist keine gerade Linie.']);
  assert.equal(E.handle(g, 'a', { t: 'line', a: 0, b: 20 }).kind, 'falsch');
  assert.equal(g.scores[0], 0, 'falsche Linie kostet nichts');
  assert.equal(g.seq, 0);
  assert.equal(E.handle(g, 'a', { t: 'line', a: 4, b: 0 }).ok, true);
  assert.equal(E.handle(g, 'b', { t: 'line', a: 0, b: 4 }).kind, 'schon');
});

test('Wettkampf-Wertung: 10 Punkte, wer zuerst bestätigt; Ende bei allen Wörtern; Gewinner', () => {
  const g = E.createGame(P2, { stufe: 'leicht' }, seeded(11));
  const cellsOf = (k) => { const c = E.wordCells(g.n, g.words[k]); return [c[0], c[c.length - 1]]; };
  for (let k = 0; k < g.words.length; k++) {
    const [a, b] = cellsOf(k);
    const first = k < 5 ? 'a' : 'b';
    const second = first === 'a' ? 'b' : 'a';
    assert.equal(g.mode, 'play');
    assert.equal(E.handle(g, first, { t: 'line', a, b }).ok, true);
    assert.equal(g.evt.kind, 'find'); assert.equal(g.evt.k, k);
    const late = E.handle(g, second, { t: 'line', a, b });
    assert.equal(late.ok, false); assert.equal(late.kind, k === g.words.length - 1 ? 'fehler' : 'schon');
  }
  assert.equal(g.mode, 'over');
  assert.deepEqual(g.scores, [50, 30]);
  assert.equal(g.scores[0] + g.scores[1], 10 * g.words.length);
  const o = E.outcome(g);
  assert.deepEqual(o.winners, ['a']);
  assert.equal(o.ranking[0].rank, 1); assert.equal(o.ranking[1].rank, 2);
  assert.equal(o.ranking[0].words, 5); assert.equal(o.ranking[1].words, 3);
  assert.equal(E.handle(g, 'a', { t: 'line', a: 0, b: 1 }).ok, false, 'nach dem Ende nichts mehr');
  assert.equal(E.outcome(E.createGame(P2, {}, seeded(1))), null);
});

test('Gleichstand: beide gewinnen', () => {
  const g = E.createGame(P2, { stufe: 'leicht' }, seeded(12));
  g.words.forEach((wd, k) => { const c = E.wordCells(g.n, wd); E.handle(g, k % 2 ? 'b' : 'a', { t: 'line', a: c[0], b: c[c.length - 1] }); });
  assert.deepEqual(E.outcome(g).winners.sort(), ['a', 'b']);
});

test('Hilfe: Option nötig, einmal je Wort bezahlt, -1 allein, -2 gegen andere', () => {
  const off = E.createGame(P1, { stufe: 'leicht' }, seeded(2));
  assert.equal(E.handle(off, 'a', { t: 'help', k: 0 }).ok, false);
  const solo = E.createGame(P1, { stufe: 'leicht', help: true }, seeded(2));
  assert.deepEqual(E.handle(solo, 'a', { t: 'help', k: 0 }), { ok: true, free: false });
  assert.deepEqual([solo.scores[0], solo.helps[0]], [-1, 1]);
  assert.equal(E.handle(solo, 'a', { t: 'help', k: 0 }).free, true);
  assert.deepEqual([solo.scores[0], solo.helps[0]], [-1, 1], 'zweites Mal kostenlos');
  E.handle(solo, 'a', { t: 'help', k: 1 });
  assert.equal(solo.scores[0], -2);
  const multi = E.createGame(P2, { stufe: 'leicht', help: true }, seeded(2));
  E.handle(multi, 'b', { t: 'help', k: 3 });
  assert.deepEqual(multi.scores, [0, -2]);
  for (const bad of [-1, 99, 1.5, 'x', null, undefined]) assert.equal(E.handle(multi, 'a', { t: 'help', k: bad }).ok, false);
  const c = E.wordCells(multi.n, multi.words[3]);
  E.handle(multi, 'a', { t: 'line', a: c[0], b: c[c.length - 1] });
  assert.equal(E.handle(multi, 'a', { t: 'help', k: 3 }).ok, false, 'gefundenes Wort braucht keine Hilfe');
  assert.deepEqual(multi.scores, [10, -2]);
});

test('Solo: Uhr ab erstem Tipp, Zeit bis alle Wörter, Bestzeit', () => {
  const g = E.createGame(P1, { stufe: 'leicht' }, seeded(21));
  assert.equal(g.began, false);
  assert.equal(E.handle(g, 'a', { t: 'begin', ms: 0 }).ok, true);
  assert.equal(g.began, true);
  g.words.forEach((wd, k) => {
    const c = E.wordCells(g.n, wd);
    E.handle(g, 'a', { t: 'line', a: c[0], b: c[c.length - 1], ms: 1000 * (k + 1) + 500 });
  });
  assert.equal(g.mode, 'over');
  assert.equal(g.result.timeMs, 8500);
  assert.equal(g.elapsed, 8500);
  assert.equal(E.outcome(g).kind, 'solo');
  assert.deepEqual(E.settleResult(g, null), { record: true, best: 8500 });
  assert.equal(g.result.record, true);
  g.result.record = null;
  assert.deepEqual(E.settleResult(g, 9000), { record: true, best: 8500 });
  g.result.record = null;
  assert.deepEqual(E.settleResult(g, 8000), { record: false, best: 8000 });
  g.result.record = null;
  assert.deepEqual(E.settleResult(g, 8500), { record: false, best: 8500 }, 'gleich schnell ist kein Rekord');
  g.result.helps = 1; g.result.record = null;
  assert.deepEqual(E.settleResult(g, null), { record: false, best: null }, 'mit Hilfe keine Bestzeit');
  assert.equal(E.fmtTime(8500), '00:08'); assert.equal(E.fmtTime(754000), '12:34'); assert.equal(E.fmtTime(-5), '00:00'); assert.equal(E.fmtTime(NaN), '00:00');
});
test('Solo: Zeit läuft nur vorwärts und ist begrenzt, sync nur im Alleinspiel', () => {
  const g = E.createGame(P1, { stufe: 'leicht' }, seeded(22));
  E.handle(g, 'a', { t: 'begin', ms: 0 });
  E.handle(g, 'a', { t: 'sync', ms: 5000 });
  assert.equal(g.elapsed, 5000);
  E.handle(g, 'a', { t: 'sync', ms: 3000 });
  assert.equal(g.elapsed, 5000);
  E.handle(g, 'a', { t: 'sync', ms: 1e15 });
  assert.equal(g.elapsed, E.MAX_MS);
  E.handle(g, 'a', { t: 'sync', ms: 'abc' });
  assert.equal(g.elapsed, E.MAX_MS);
  const m = E.createGame(P2, {}, seeded(22));
  assert.equal(E.handle(m, 'a', { t: 'begin' }).ok, false);
  assert.equal(E.handle(m, 'a', { t: 'sync', ms: 5 }).ok, false);
  assert.equal(m.elapsed, 0);
});

test('Computer-Meldungen: nur Computer-Kennungen, nur gesuchte Wörter', () => {
  const g = E.createGame([{ id: 'a', name: 'Anna' }, { id: 'bot1', name: 'Computer' }], { stufe: 'mittel' }, seeded(31));
  const w = g.words[2].w;
  assert.equal(E.handle(g, 'a', { t: 'find', word: w }).ok, false, 'Mensch darf nicht per find melden');
  assert.equal(g.scores[0], 0);
  assert.equal(E.handle(g, 'bot1', { t: 'find', word: 'GIBTSNICHT' }).ok, false);
  assert.equal(E.handle(g, 'bot1', { t: 'find', word: w }).ok, true);
  assert.deepEqual(g.scores, [0, 10]);
  assert.equal(E.handle(g, 'bot1', { t: 'find', word: w }).kind, 'schon');
  assert.equal(E.handle(g, 'bot2', { t: 'find', word: g.words[0].w }).ok, false, 'Computer ohne Platz');
});

test('ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = E.createGame(P2, {}, seeded(41));
  const before = JSON.stringify(g);
  for (const m of [null, undefined, 5, 'x', [], {}, { t: 'nix' }, { t: 'line' }, { t: 'line', a: 'x', b: [] }, { t: 'line', a: NaN, b: Infinity }, { t: 'help' }, { t: 'find' }]) {
    assert.doesNotThrow(() => E.handle(g, 'a', m));
    assert.equal(E.handle(g, 'a', m).ok, false);
  }
  for (const pid of ['zz', null, undefined, 5, {}]) assert.equal(E.handle(g, pid, { t: 'line', a: 0, b: 1 }).ok, false);
  assert.equal(JSON.stringify(g), before, 'nichts verändert');
  assert.equal(E.handle(null, 'a', { t: 'line' }).ok, false);
  assert.equal(E.handle(undefined, 'a', {}).ok, false);
});

test('Zustand ist reines JSON und funktioniert nach dem Kopieren', () => {
  const g = E.createGame(P2, { stufe: 'schwer', help: true, time: true }, seeded(51));
  const c0 = E.wordCells(g.n, g.words[0]);
  E.handle(g, 'a', { t: 'line', a: c0[0], b: c0[c0.length - 1] });
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  const c1 = E.wordCells(copy.n, copy.words[1]);
  assert.equal(E.handle(copy, 'b', { t: 'line', a: c1[c1.length - 1], b: c1[0] }).ok, true);
  assert.equal(copy.scores[1], 10);
  assert.equal(g.scores[1], 0);
});

test('Lernrunde-Gitter: leicht mit 5 Wörtern', () => {
  const g = E.createGame(P2, { learn: true, hard: true }, seeded(61));
  assert.equal(g.stufe, 'leicht'); assert.equal(g.words.length, 5); assert.equal(g.learn, true);
  for (const wd of g.words) assert.ok([0, 1].includes(wd.d));
});

test('250 Zufallspartien enden immer, Punkte-Bilanz stimmt', () => {
  for (let seed = 1; seed <= 250; seed++) {
    const rng = seeded(seed);
    const stufe = E.STUFE_IDS[seed % 3];
    const np = 1 + (seed % 4);
    const players = Array.from({ length: np }, (_, i) => ({ id: `p${i}`, name: 'P' + i }));
    const g = E.createGame(players, { stufe, help: seed % 2 === 0 }, rng);
    let steps = 0; let helps = 0;
    while (g.mode === 'play' && steps++ < 2000) {
      const pid = players[Math.floor(rng() * np)].id;
      const open = E.unfound(g);
      const r = rng();
      if (r < 0.25) { // falsche Linie
        const a = Math.floor(rng() * g.n * g.n); const b = Math.floor(rng() * g.n * g.n);
        const before = JSON.stringify(g);
        const p = E.probe(g, a, b);
        const res = E.handle(g, pid, { t: 'line', a, b });
        if (p.kind !== 'treffer') { assert.equal(res.ok, false); assert.equal(JSON.stringify(g), before); }
      } else if (r < 0.3 && g.help) {
        const k = open[Math.floor(rng() * open.length)];
        if (!g.helped[Number(pid.slice(1))].includes(k)) helps += np === 1 ? 1 : 2;
        E.handle(g, pid, { t: 'help', k });
      } else {
        const k = open[Math.floor(rng() * open.length)];
        const c = E.wordCells(g.n, g.words[k]);
        const fwd = rng() < 0.5;
        assert.equal(E.handle(g, pid, { t: 'line', a: fwd ? c[0] : c[c.length - 1], b: fwd ? c[c.length - 1] : c[0] }).ok, true);
      }
    }
    assert.equal(g.mode, 'over', 'Partie endet');
    assert.ok(g.words.every((x) => x.by >= 0 && x.by < np));
    assert.equal(g.scores.reduce((a, b) => a + b, 0), 10 * g.words.length - helps);
    assert.equal(g.words.length, E.STUFEN[stufe].count);
    const rk = E.ranking(g);
    assert.ok(rk.length === np && rk.some((r) => r.win));
  }
});
