import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../kreuzwort/engine.js';
import { WOERTER } from '../kreuzwort/woerter.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = [{ id: 'p0', name: 'Du' }];
const sameState = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

function started(level = 'leicht', seed = 5) {
  const g = E.createGame(P);
  const r = E.apply(g, 'p0', { t: 'new', level }, seeded(seed));
  assert.equal(r.ok, true);
  return g;
}
const letterIdx = (g) => g.sol.split('').map((c, i) => (c === '#' ? -1 : i)).filter((i) => i >= 0);

// ---------------- Wörterliste ----------------
test('Wörterliste: Menge, Zeichensatz, Duplikate, Hinweise', () => {
  assert.ok(WOERTER.length >= 500, `nur ${WOERTER.length} Einträge`);
  const seen = new Set();
  for (const e of WOERTER) {
    assert.match(e.w, /^[A-Z]{3,10}$/, `Wort ${e.w}`);
    assert.ok(!seen.has(e.w), `doppelt: ${e.w}`);
    seen.add(e.w);
    assert.ok(typeof e.h === 'string' && e.h.trim().length >= 5, `Hinweis leer: ${e.w}`);
    assert.ok(e.h.length <= 70, `Hinweis zu lang: ${e.w}`);
    assert.ok(!e.h.toUpperCase().includes(e.w), `Hinweis enthält das Wort: ${e.w} / ${e.h}`);
    assert.ok(e.k && typeof e.k === 'string', `Thema fehlt: ${e.w}`);
    assert.ok(e.d === 1 || e.d === 2, `Stufe: ${e.w}`);
  }
  const topics = new Set(WOERTER.map((e) => e.k));
  for (const t of ['Allgemeinwissen', 'Tiere', 'Essen', 'Orte', 'Natur', 'Haushalt', 'Beruf', 'Musik', 'Sprichwörter']) assert.ok(topics.has(t), `Thema ${t} fehlt`);
  for (const t of topics) assert.ok(WOERTER.filter((e) => e.k === t).length >= 15, `Thema ${t} zu klein`);
  assert.ok(WOERTER.filter((e) => e.d === 1 && e.w.length <= 6).length >= 150, 'zu wenige leichte kurze Wörter');
  assert.ok(WOERTER.filter((e) => e.d === 2).length >= 100, 'zu wenige schwerere Wörter');
  for (let n = 3; n <= 10; n++) assert.ok(WOERTER.some((e) => e.w.length === n), `keine Länge ${n}`);
});

// ---------------- Generator ----------------
test('Generator: 300 Rätsel sind gültig (zusammenhängend, Grenzen, nur Wörter der Liste, Nummern)', () => {
  const words = new Set(WOERTER.map((e) => e.w));
  const byW = new Map(WOERTER.map((e) => [e.w, e]));
  let n = 0;
  for (const lv of E.LEVELS) {
    for (let s = 1; s <= 100; s++) {
      const pz = E.generate(lv.id, seeded(s * 7 + 1));
      const bad = E.validate(pz, words);
      assert.deepEqual(bad, [], `${lv.id} Seed ${s}: ${bad.join('; ')}`);
      assert.ok(pz.cols <= 11 && pz.rows <= 13, `Größe ${pz.cols}x${pz.rows}`);
      assert.equal(pz.words.length, lv.count, `Wortzahl ${lv.id}`);
      const hn = pz.words.filter((w) => w.d === 'h').length, vn = pz.words.length - hn;
      assert.ok(hn >= 3 && vn >= 3, `Richtungen ${hn}/${vn}`);
      for (const w of pz.words) {
        const text = Array.from({ length: w.len }, (_, k) => pz.sol[(w.r + (w.d === 'v' ? k : 0)) * pz.cols + w.c + (w.d === 'h' ? k : 0)]).join('');
        const e = byW.get(text);
        assert.ok(e, `Wort ${text} nicht in Liste`);
        assert.equal(w.q, e.h, 'Hinweis passt nicht zum Wort');
        assert.ok(e.w.length <= lv.maxLen && e.d <= lv.maxD, `Stufe verletzt: ${text}`);
      }
      n++;
    }
  }
  assert.equal(n, 300);
});

test('Generator: gleicher Seed gleiches Rätsel, verschiedene Seeds verschiedene', () => {
  const a = E.generate('mittel', seeded(42)), b = E.generate('mittel', seeded(42));
  assert.deepEqual(a, b);
  const sols = new Set();
  for (let s = 1; s <= 20; s++) sols.add(E.generate('mittel', seeded(s)).sol);
  assert.ok(sols.size >= 18, 'zu wenig Abwechslung');
});

test('Generator: Rechenzeit unter 150 ms je Rätsel', () => {
  let max = 0;
  for (const lv of E.LEVELS) for (let s = 1; s <= 40; s++) { const t = Date.now(); E.generate(lv.id, seeded(s)); max = Math.max(max, Date.now() - t); }
  assert.ok(max < 150, `${max} ms`);
});

test('Prüfer erkennt kaputte Rätsel', () => {
  const words = new Set(['PARIS', 'PFEIL', 'REGEN', 'SONNE', 'LINIE']);
  const ok = E.buildPuzzle([
    { w: 'PARIS', q: 'a', r: 0, c: 0, d: 'h' }, { w: 'PFEIL', q: 'b', r: 0, c: 0, d: 'v' },
    { w: 'REGEN', q: 'c', r: 0, c: 2, d: 'v' }, { w: 'SONNE', q: 'd', r: 0, c: 4, d: 'v' }, { w: 'LINIE', q: 'e', r: 4, c: 0, d: 'h' },
  ]);
  assert.deepEqual(E.validate(ok, words), []);
  assert.ok(E.validate(ok, new Set(['PARIS'])).length > 0, 'unbekannte Wörter');
  assert.ok(E.validate({ ...ok, sol: ok.sol.replace('#', 'X') }).length > 0, 'Fremdbuchstabe');
  // Zwei parallele Wörter berühren sich: ungewollte Zweierfolgen
  const touch = E.buildPuzzle([{ w: 'PARIS', q: 'a', r: 0, c: 0, d: 'h' }, { w: 'PFEIL', q: 'b', r: 0, c: 0, d: 'v' }, { w: 'FELSEN', q: 'c', r: 1, c: 0, d: 'h' }]);
  assert.ok(E.validate(touch, new Set(['PARIS', 'PFEIL', 'FELSEN'])).length > 0, 'Berührung wird nicht erkannt');
  // nicht zusammenhängend
  const split = { ...ok, cols: 11, rows: 13 };
  const sol = Array(11 * 13).fill('#'); sol[0] = 'A'; sol[1] = 'B'; sol[50] = 'C'; sol[51] = 'D';
  assert.ok(E.validate({ cols: 11, rows: 13, sol: sol.join(''), words: [{ n: 1, d: 'h', r: 0, c: 0, len: 2, q: 'x' }, { n: 2, d: 'h', r: 4, c: 6, len: 2, q: 'y' }] }, new Set(['AB', 'CD'])).some((m) => /zusammen/.test(m)));
  assert.ok(split.cols === 11);
  // zu groß
  assert.ok(E.validate({ cols: 12, rows: 3, sol: '#'.repeat(36), words: [] }, words).some((m) => /groß/.test(m)));
  // falsche Nummer
  const wrongNum = { ...ok, words: ok.words.map((w) => ({ ...w, n: w.n + 1 })) };
  assert.ok(E.validate(wrongNum, words).some((m) => /Nummer/.test(m)));
  assert.ok(E.validate(null).length > 0);
});

test('Nummerierung: Anfangsfelder in Lesereihenfolge, Kreuzungsanfang teilt die Nummer', () => {
  const pz = E.buildPuzzle([
    { w: 'PARIS', q: 'a', r: 0, c: 0, d: 'h' }, { w: 'PFEIL', q: 'b', r: 0, c: 0, d: 'v' },
    { w: 'REGEN', q: 'c', r: 0, c: 2, d: 'v' }, { w: 'SONNE', q: 'd', r: 0, c: 4, d: 'v' }, { w: 'LINIE', q: 'e', r: 4, c: 0, d: 'h' },
  ]);
  assert.deepEqual(pz.words.map((w) => `${w.n}${w.d}`), ['1h', '1v', '2v', '3v', '4h']);
  assert.equal(pz.cols, 5); assert.equal(pz.rows, 5);
});

// ---------------- Engine ----------------
test('Neues Spiel: Wahl-Bildschirm, dann Rätsel; Stufen aus Optionen', () => {
  const g = E.createGame(P);
  assert.equal(g.mode, 'choose');
  assert.equal(E.apply(g, 'p0', { t: 'put', i: 0, ch: 'A' }).ok, false);
  assert.equal(E.levelFromOpts({}), 'mittel');
  assert.equal(E.levelFromOpts({ easy: true }), 'leicht');
  assert.equal(E.levelFromOpts({ hard: true }), 'schwer');
  assert.equal(E.levelFromOpts({ easy: true, hard: true }), 'leicht');
  for (const lv of ['leicht', 'mittel', 'schwer']) {
    const h = started(lv, 3);
    assert.equal(h.mode, 'play'); assert.equal(h.level, lv);
    assert.equal(h.cells.length, h.cols * h.rows);
    assert.equal(E.emptyCount(h), E.letterTotal(h));
    assert.ok(h.cells.every((c, i) => (h.sol[i] === '#' ? c === '#' : c === '')));
  }
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'riesig' }).ok, false);
});

test('Eingabe: Buchstaben setzen, überschreiben, löschen', () => {
  const g = started();
  const [a, b] = letterIdx(g);
  assert.equal(E.apply(g, 'p0', { t: 'put', i: a, ch: 'q' }).ok, true);
  assert.equal(g.cells[a], 'Q');
  assert.equal(E.apply(g, 'p0', { t: 'put', i: a, ch: 'X' }).ok, true);
  assert.equal(g.cells[a], 'X');
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: a }).ok, true);
  assert.equal(g.cells[a], '');
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: a }).ok, false, 'leeres Feld löschen');
  const blk = g.sol.indexOf('#');
  for (const m of [
    { t: 'put', i: blk, ch: 'A' }, { t: 'put', i: -1, ch: 'A' }, { t: 'put', i: 9999, ch: 'A' }, { t: 'put', i: 1.5, ch: 'A' }, { t: 'put', i: b, ch: 'AB' },
    { t: 'put', i: b, ch: '1' }, { t: 'put', i: b, ch: 'Ä' }, { t: 'put', i: b }, { t: 'put', i: b, ch: 5 }, { t: 'erase', i: blk }, { t: 'foo' }, { t: 'put', i: b, ch: 'A', ms: -5 },
    { t: 'put', i: b, ch: 'A', ms: NaN }, { t: 'put', i: b, ch: 'A', ms: 'x' },
  ]) {
    const before = JSON.stringify(g);
    assert.equal(E.apply(g, 'p0', m).ok, false, JSON.stringify(m));
    assert.equal(JSON.stringify(g), before, 'Zustand verändert bei Fehler: ' + JSON.stringify(m));
  }
  assert.equal(E.apply(g, 'fremd', { t: 'put', i: b, ch: 'A' }).ok, false, 'falsche Person');
  for (const bad of [null, undefined, 5, 'x', [], {}, { t: 5 }]) assert.equal(E.apply(g, 'p0', bad).ok, false);
  assert.equal(E.apply(null, 'p0', { t: 'check' }).ok, false);
});

test('Prüfen: markiert falsche Buchstaben, zählt, wird bei Änderung gelöscht', () => {
  const g = started();
  const [a, b, c] = letterIdx(g);
  E.apply(g, 'p0', { t: 'put', i: a, ch: g.sol[a] });
  const wrongCh = (i) => (g.sol[i] === 'Q' ? 'X' : 'Q');
  E.apply(g, 'p0', { t: 'put', i: b, ch: wrongCh(b) });
  assert.deepEqual(E.wrongCells(g), [b]);
  assert.equal(E.apply(g, 'p0', { t: 'check' }).ok, true);
  assert.deepEqual(g.check.wrong, [b]);
  assert.equal(g.checks, 1); assert.deepEqual(g.flagged, [b]);
  E.apply(g, 'p0', { t: 'put', i: c, ch: g.sol[c] });
  assert.equal(g.check, null);
  E.apply(g, 'p0', { t: 'check' });
  assert.equal(g.checks, 2); assert.deepEqual(g.flagged, [b], 'Fehlerfeld nicht doppelt');
  E.apply(g, 'p0', { t: 'put', i: b, ch: g.sol[b] });
  E.apply(g, 'p0', { t: 'check' });
  assert.deepEqual(g.check.wrong, []);
});

test('Hilfen: Buchstabe und Wort aufdecken, gezählt, fest, nicht für Bestzeit', () => {
  const g = started();
  const w = g.words[0];
  const cells = E.wordCells(g, w);
  assert.equal(E.apply(g, 'p0', { t: 'revealLetter', i: cells[0] }).ok, true);
  assert.equal(g.cells[cells[0]], g.sol[cells[0]]);
  assert.equal(g.hints, 1); assert.equal(g.helpLetters, 1);
  assert.equal(E.apply(g, 'p0', { t: 'revealLetter', i: cells[0] }).ok, false, 'schon richtig');
  assert.equal(E.apply(g, 'p0', { t: 'put', i: cells[0], ch: 'Q' }).ok, false, 'aufgedeckt ist fest');
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: cells[0] }).ok, false);
  E.apply(g, 'p0', { t: 'put', i: cells[1], ch: g.sol[cells[1]] === 'Q' ? 'X' : 'Q' });
  assert.equal(E.apply(g, 'p0', { t: 'revealWord', n: w.n, d: w.d }).ok, true);
  assert.equal(E.answerOf(g, w), cells.map((i) => g.cells[i]).join(''));
  assert.equal(g.hints, 2); assert.equal(g.helpWords, 1);
  assert.equal(E.apply(g, 'p0', { t: 'revealWord', n: w.n, d: w.d }).ok, false, 'Wort schon richtig');
  assert.equal(E.apply(g, 'p0', { t: 'revealWord', n: 99, d: 'h' }).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'revealLetter', i: g.sol.indexOf('#') }).ok, false);
  assert.equal(E.bestUpdate(0, 60000, g.hints).record, false);
  assert.equal(E.bestUpdate(0, 60000, 0).record, true);
  assert.equal(E.bestUpdate(50000, 60000, 0).record, false);
  assert.equal(E.bestUpdate(70000, 60000, 0).best, 60000);
});

test('Fertig-Erkennung: alle Felder richtig → Ergebnis; falsche Füllung beendet nicht', () => {
  const g = started('leicht', 9);
  const idx = letterIdx(g);
  for (const i of idx.slice(0, -1)) E.apply(g, 'p0', { t: 'put', i, ch: g.sol[i] }, undefined);
  assert.equal(g.mode, 'play');
  const last = idx[idx.length - 1];
  E.apply(g, 'p0', { t: 'put', i: last, ch: g.sol[last] === 'Q' ? 'X' : 'Q', ms: 1000 });
  assert.equal(E.isFull(g), true); assert.equal(E.isSolved(g), false); assert.equal(g.mode, 'play');
  E.apply(g, 'p0', { t: 'put', i: last, ch: g.sol[last], ms: 61000 });
  assert.equal(g.mode, 'over'); assert.equal(g.result.ms, 61000); assert.equal(g.result.hints, 0); assert.equal(g.result.record, null);
  assert.equal(E.apply(g, 'p0', { t: 'put', i: last, ch: 'A' }).ok, false, 'nach dem Ende keine Eingabe');
  const b = E.settleResult(g, 0);
  assert.equal(b.record, true); assert.equal(g.result.record, true);
  assert.equal(E.settleResult(g, 0), null, 'nur einmal');
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'leicht' }, seeded(2)).ok, true);
  assert.equal(g.mode, 'play'); assert.equal(g.result, null); assert.equal(g.hints, 0);
});

test('Zeit: sync nur vorwärts, begrenzt', () => {
  const g = started();
  E.apply(g, 'p0', { t: 'sync', ms: 5000 });
  assert.equal(g.elapsed, 5000);
  E.apply(g, 'p0', { t: 'sync', ms: 100 });
  assert.equal(g.elapsed, 5000);
  E.apply(g, 'p0', { t: 'sync', ms: 1e15 });
  assert.ok(g.elapsed <= 100 * 3600 * 1000);
  assert.equal(E.fmtTime(65000), '01:05'); assert.equal(E.fmtTime(3725000), '1:02:05'); assert.equal(E.fmtTime(-3), '00:00'); assert.equal(E.fmtTime('x'), '00:00');
});

test('JSON: Zustand übersteht Speichern und Laden, Spielen geht weiter', () => {
  const g = started('mittel', 11);
  const idx = letterIdx(g);
  for (const i of idx.slice(0, 10)) E.apply(g, 'p0', { t: 'put', i, ch: g.sol[i] });
  E.apply(g, 'p0', { t: 'revealLetter', i: idx[12] });
  E.apply(g, 'p0', { t: 'check' });
  const copy = JSON.parse(JSON.stringify(g));
  sameState(g, copy);
  assert.equal(E.apply(copy, 'p0', { t: 'put', i: idx[20], ch: copy.sol[idx[20]] }).ok, true);
  assert.equal(copy.cells[idx[20]], copy.sol[idx[20]]);
  assert.equal(JSON.stringify(g).includes('undefined'), false);
});

test('Wörter-Hilfen: wordAt, wordCells, stepWord, clueText', () => {
  const g = started('mittel', 4);
  for (const w of g.words) {
    const cells = E.wordCells(g, w);
    assert.equal(cells.length, w.len);
    for (const i of cells) assert.equal(E.wordAt(g, i, w.d).n, w.n);
    assert.match(E.clueText(w), new RegExp(`^${w.n} (waagerecht|senkrecht): .+ \\(${w.len}\\)$`));
  }
  let w = null;
  const seen = [];
  for (let k = 0; k < g.words.length; k++) { w = E.stepWord(g, w, 1); seen.push(`${w.n}${w.d}`); }
  assert.equal(new Set(seen).size, g.words.length);
  assert.equal(E.stepWord(g, w, 1).n, g.words[0].n, 'rund herum');
  assert.equal(E.stepWord(g, g.words[0], -1), g.words[g.words.length - 1]);
});

test('250 Zufallspartien enden immer (Tippen, Fehler, Prüfen, Hilfen)', () => {
  let finished = 0;
  for (let s = 1; s <= 250; s++) {
    const rng = seeded(s);
    const g = started(['leicht', 'mittel', 'schwer'][s % 3], s);
    const idx = letterIdx(g);
    let steps = 0;
    while (g.mode === 'play' && steps++ < 4000) {
      const x = rng();
      const i = idx[Math.floor(rng() * idx.length)];
      if (x < 0.45) E.apply(g, 'p0', { t: 'put', i, ch: g.sol[i], ms: steps * 100 });
      else if (x < 0.65) E.apply(g, 'p0', { t: 'put', i, ch: String.fromCharCode(65 + Math.floor(rng() * 26)), ms: steps * 100 });
      else if (x < 0.75) E.apply(g, 'p0', { t: 'erase', i });
      else if (x < 0.8) E.apply(g, 'p0', { t: 'check' });
      else if (x < 0.86) E.apply(g, 'p0', { t: 'revealLetter', i });
      else if (x < 0.88) { const w = g.words[Math.floor(rng() * g.words.length)]; E.apply(g, 'p0', { t: 'revealWord', n: w.n, d: w.d }); }
      else if (x < 0.9) E.apply(g, 'p0', { t: 'put', i: g.sol.indexOf('#') < 0 ? 0 : g.sol.indexOf('#'), ch: 'A' });
      else E.apply(g, 'p0', { t: 'put', i, ch: g.sol[i] });
      assert.ok(g.cells.every((c, k) => (g.sol[k] === '#' ? c === '#' : c === '' || /^[A-Z]$/.test(c))));
      assert.equal(g.hints, g.helpLetters + g.helpWords);
    }
    assert.equal(g.mode, 'over', `Partie ${s} endet nicht`);
    assert.ok(E.isSolved(g));
    assert.ok(g.result && g.result.hints === g.hints);
    for (const i of g.revealed) assert.equal(g.cells[i], g.sol[i]);
    finished++;
  }
  assert.equal(finished, 250);
});
