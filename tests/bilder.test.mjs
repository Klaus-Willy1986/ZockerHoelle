import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../bilder/engine.js';
import { BILDER } from '../bilder/bilder.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P1 = [{ id: 'p0', name: 'Du' }];
const sameState = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

// ---------- Referenz: Hinweise ganz anders berechnet (über Text) ----------
function refClue(line) {
  const runs = line.map((x) => (x ? '#' : '.')).join('').split('.').filter((s) => s.length).map((s) => s.length);
  return runs.length ? runs : [0];
}
// ---------- Referenz: Lösungen zählen (Rückverfolgung Zeile für Zeile mit Spaltenprüfung), bricht bei `max` ab ----------
function countSolutions(rowC, colC, max = 2) {
  const n = rowC.length, m = colC.length;
  const cands = rowC.map((cl) => {
    const out = [];
    for (let mask = 0; mask < (1 << m); mask++) {
      const line = Array.from({ length: m }, (_, c) => (mask >> c) & 1);
      const rc = refClue(line);
      if (rc.length === cl.length && rc.every((x, i) => x === cl[i])) out.push(line);
    }
    return out;
  });
  const colOk = (c, prefix, final) => {
    const cl = colC[c][0] === 0 ? [] : colC[c];
    const runs = refClue(prefix)[0] === 0 ? [] : refClue(prefix);
    const open = prefix.length && prefix[prefix.length - 1] === 1;
    const done = open ? runs.slice(0, -1) : runs;
    if (done.length > cl.length) return false;
    if (!done.every((x, i) => x === cl[i])) return false;
    if (open) { if (done.length >= cl.length || runs[runs.length - 1] > cl[done.length]) return false; }
    if (final) return runs.length === cl.length && runs.every((x, i) => x === cl[i]);
    return true;
  };
  let count = 0;
  const cols = Array.from({ length: m }, () => []);
  (function rec(r) {
    if (count >= max) return;
    if (r === n) { count++; return; }
    for (const line of cands[r]) {
      let ok = true;
      for (let c = 0; c < m; c++) { cols[c].push(line[c]); }
      for (let c = 0; c < m && ok; c++) ok = colOk(c, cols[c], r === n - 1);
      if (ok) rec(r + 1);
      for (let c = 0; c < m; c++) cols[c].pop();
      if (count >= max) return;
    }
  })(0);
  return count;
}

// =================================================== Katalog ===================================================
test('Katalog: Mindestmengen je Größe, nur 5, 8, 10', () => {
  for (const n of [5, 8, 10]) assert.ok(E.imagesOf(n).length >= 24, `Größe ${n}: ${E.imagesOf(n).length} Bilder`);
  for (const b of BILDER) assert.ok([5, 8, 10].includes(b.g), b.id);
  assert.equal(BILDER.length, E.imagesOf(5).length + E.imagesOf(8).length + E.imagesOf(10).length);
});

test('Katalog: Felder, Zeichensatz, Namen, Artikel, Dichte, keine leeren Reihen, keine Duplikate', () => {
  const ids = new Set(), pics = new Set(), names = new Map();
  for (const b of BILDER) {
    assert.ok(typeof b.id === 'string' && b.id && !ids.has(b.id), `id ${b.id}`);
    ids.add(b.id);
    assert.ok(typeof b.n === 'string' && b.n.trim().length >= 3, `Name ${b.id}`);
    assert.ok(['ein', 'eine'].includes(b.a), `Artikel ${b.id}`);
    assert.equal(b.p.length, b.g, `${b.id}: Zeilenzahl`);
    for (const row of b.p) { assert.equal(row.length, b.g, `${b.id}: Zeilenlänge`); assert.match(row, /^[#.]+$/, `${b.id}: Zeichen`); }
    const key = b.p.join('/');
    assert.ok(!pics.has(key), `Duplikat ${b.id}`);
    pics.add(key);
    const k2 = `${b.g}|${b.n}`;
    assert.ok(!names.has(k2), `Name doppelt in einer Größe: ${b.n}`);
    names.set(k2, 1);
    const dens = b.p.join('').split('#').length - 1;
    const d = dens / (b.g * b.g);
    assert.ok(d >= 0.35 && d <= 0.70, `${b.id}: Dichte ${(d * 100).toFixed(0)} %`);
    const { rows, cols } = E.cluesOfPicture(b.p);
    for (const c of [...rows, ...cols]) {
      assert.ok(c[0] !== 0, `${b.id}: leere Reihe`);
      assert.ok(c.length <= (b.g === 5 ? 3 : 4), `${b.id}: zu viele Zahlen in einer Reihe`);
    }
  }
});

test('Katalog: jedes Bild ist mit dem Linien-Löser ohne Raten vollständig lösbar', () => {
  for (const b of BILDER) {
    const { rows, cols } = E.cluesOfPicture(b.p);
    const r = E.solveLines(rows, cols);
    assert.equal(r.contradiction, false, `${b.id}: Widerspruch`);
    assert.equal(r.solved, true, `${b.id}: Linien-Löser kommt nicht ans Ziel`);
    r.grid.forEach((row, y) => row.forEach((x, c) => assert.equal(x, b.p[y][c] === '#' ? 1 : 0, `${b.id}: ${y},${c}`)));
    assert.equal(E.solvesWithoutGuessing(b.p), true);
  }
});

test('Katalog: unabhängige Gegenprobe – genau eine Lösung (Rückverfolgung)', () => {
  for (const b of BILDER) {
    const { rows, cols } = E.cluesOfPicture(b.p);
    assert.equal(countSolutions(rows, cols, 2), 1, `${b.id}: nicht eindeutig`);
  }
});

test('Lernbild ist ein lösbares 5×5-Herz', () => {
  assert.equal(E.LEARN_BILD.g, 5);
  assert.equal(E.solvesWithoutGuessing(E.LEARN_BILD.p), true);
  assert.equal(countSolutions(...Object.values(E.cluesOfPicture(E.LEARN_BILD.p)), 2), 1);
});

// =================================================== Hinweise ===================================================
test('Hinweise: clueOf gegen Referenz (alle 10-Bit-Linien) und Beispiele', () => {
  for (let mask = 0; mask < 1024; mask++) {
    const line = Array.from({ length: 10 }, (_, c) => (mask >> c) & 1);
    assert.deepEqual(E.clueOf(line), refClue(line), `Maske ${mask}`);
  }
  assert.deepEqual(E.clueOf([0, 0, 0]), [0]);
  assert.deepEqual(E.clueOf([1, 1, 1]), [3]);
  assert.deepEqual(E.clueOf([1, 0, 1, 1, 0, 1]), [1, 2, 1]);
  assert.deepEqual(E.clueOf([0, 1, 2, 1, 0]), [1, 1], 'Kreuze zählen nicht, trennen aber');
  assert.deepEqual(E.clueOf([]), [0]);
});

test('Hinweise: cluesOfPicture (Zeilen und Spalten)', () => {
  const c = E.cluesOfPicture(['.#.#.', '#####', '#####', '.###.', '..#..']);
  assert.deepEqual(c.rows, [[1, 1], [5], [5], [3], [1]]);
  assert.deepEqual(c.cols, [[2], [4], [4], [4], [2]]);
});

// =================================================== Löser ===================================================
test('Linien-Löser: Beispiele', () => {
  assert.deepEqual(E.solveLine([5], [-1, -1, -1, -1, -1]), [1, 1, 1, 1, 1]);
  assert.deepEqual(E.solveLine([0], [-1, -1, -1]), [0, 0, 0]);
  assert.deepEqual(E.solveLine([3], [-1, -1, -1, -1, -1]), [-1, -1, 1, -1, -1]);
  assert.deepEqual(E.solveLine([2, 1], [-1, -1, -1, -1]), [1, 1, 0, 1]);
  assert.deepEqual(E.solveLine([1, 1], [-1, 1, -1, -1, -1]), [0, 1, 0, -1, -1]);
  assert.deepEqual(E.solveLine([2], [1, -1, -1, -1]), [1, 1, 0, 0]);
  assert.equal(E.solveLine([3], [1, 0, 1, -1]), null, 'Widerspruch');
  assert.equal(E.solveLine([4], [-1, -1, -1]), null, 'passt nicht hinein');
  assert.equal(E.solveLine([1], [1, -1, 1]), null);
});

test('Linien-Löser: stimmt mit Aufzählung überein (Zufallslinien)', () => {
  const rng = seeded(11);
  for (let t = 0; t < 400; t++) {
    const n = 4 + Math.floor(rng() * 7);
    const sol = Array.from({ length: n }, () => (rng() < 0.5 ? 1 : 0));
    const clue = refClue(sol);
    const known = sol.map((x) => (rng() < 0.4 ? x : -1));
    const res = E.solveLine(clue, known);
    assert.ok(res, 'Widerspruch trotz gültiger Lösung');
    // Referenz: alle passenden Linien
    const fits = [];
    for (let mask = 0; mask < (1 << n); mask++) {
      const line = Array.from({ length: n }, (_, c) => (mask >> c) & 1);
      if (JSON.stringify(refClue(line)) === JSON.stringify(clue) && line.every((x, i) => known[i] === -1 || known[i] === x)) fits.push(line);
    }
    const expect = Array.from({ length: n }, (_, i) => (fits.every((f) => f[i] === fits[0][i]) ? fits[0][i] : -1));
    assert.deepEqual(res, expect);
  }
});

test('Löser meldet nicht eindeutige Rätsel als ungelöst', () => {
  // Diagonalen-Paar: zwei Lösungen
  const r = E.solveLines([[1], [1]], [[1], [1]]);
  assert.equal(r.solved, false);
  assert.equal(r.contradiction, false);
  assert.equal(countSolutions([[1], [1]], [[1], [1]], 5), 2);
  assert.equal(E.solveLines([[2], [1]], [[1], [1]]).contradiction, true);
});

// =================================================== Spiel ===================================================
function started(level = 'mittel', seed = 5) {
  const g = E.createGame(P1);
  assert.equal(g.mode, 'choose');
  const r = E.apply(g, 'p0', { t: 'new', level }, seeded(seed));
  assert.equal(r.ok, true);
  return g;
}
const solIdx = (g) => g.sol.split('').map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0);
const emptyIdx = (g) => g.sol.split('').map((c, i) => (c === '0' ? i : -1)).filter((i) => i >= 0);
const play = (g, msg) => E.apply(g, 'p0', msg, seeded(3));

test('Stufen und Kästchen: Schwer vor Leicht, sonst Mittel', () => {
  assert.equal(E.levelFromOpts({}), 'mittel');
  assert.equal(E.levelFromOpts({ easy: true }), 'leicht');
  assert.equal(E.levelFromOpts({ hard: true }), 'schwer');
  assert.equal(E.levelFromOpts({ easy: true, hard: true }), 'schwer');
  assert.equal(E.levelFromOpts(null), 'mittel');
  assert.equal(E.sizeKey('leicht'), 5); assert.equal(E.sizeKey('mittel'), 8); assert.equal(E.sizeKey('schwer'), 10); assert.equal(E.sizeKey('lern'), 5);
});

test('Neues Rätsel: Größe, Hinweise, Lösung passt, Bild wechselt', () => {
  for (const [level, n] of [['leicht', 5], ['mittel', 8], ['schwer', 10]]) {
    const g = started(level, 9);
    assert.equal(g.mode, 'play'); assert.equal(g.n, n); assert.equal(g.cells.length, n * n);
    assert.ok(g.cells.every((x) => x === 0));
    assert.equal(g.rows.length, n); assert.equal(g.cols.length, n);
    const b = E.bildOf(g.img);
    assert.ok(b && b.g === n && b.n === g.name);
    assert.deepEqual({ rows: g.rows, cols: g.cols }, E.cluesOfPicture(b.p));
    assert.equal(g.total, b.p.join('').split('#').length - 1);
    assert.equal(E.isSolved(g), false);
    const prev = g.img;
    assert.equal(play(g, { t: 'new', level }).ok, true);
    assert.notEqual(g.img, prev, 'anderes Bild');
  }
  // viele neue Rätsel: erst alle Bilder, dann wieder von vorn
  const g = started('leicht', 1);
  const seen = new Set([g.img]);
  const rng = seeded(2);
  for (let i = 0; i < E.imagesOf(5).length - 1; i++) { E.apply(g, 'p0', { t: 'new', level: 'leicht' }, rng); seen.add(g.img); }
  assert.equal(seen.size, E.imagesOf(5).length, 'jedes Bild einmal, bevor eines wiederkehrt');
});

test('Lernrunde: festes Herz, Stufe lern', () => {
  const g = E.createGame(P1, { learn: true });
  assert.equal(g.mode, 'play'); assert.equal(g.level, 'lern'); assert.equal(g.name, 'Herz'); assert.equal(g.n, 5);
  assert.equal(E.levelName('lern'), 'Übung');
});

test('Antippen: set mit allen Zuständen, Zurück, Fertig-Erkennung', () => {
  const g = started('leicht', 4);
  const [a, ...rest] = solIdx(g);
  assert.equal(E.tapValue(0, 'fill'), 1); assert.equal(E.tapValue(1, 'fill'), 0); assert.equal(E.tapValue(2, 'fill'), 1);
  assert.equal(E.tapValue(0, 'cross'), 2); assert.equal(E.tapValue(2, 'cross'), 0); assert.equal(E.tapValue(1, 'cross'), 2);
  assert.equal(play(g, { t: 'set', i: a, v: 1 }).ok, true);
  assert.equal(g.cells[a], 1);
  assert.equal(play(g, { t: 'set', i: a, v: 1 }).ok, false, 'gleicher Zustand');
  assert.equal(play(g, { t: 'set', i: a, v: 2 }).ok, true);
  assert.equal(g.cells[a], 2);
  assert.equal(play(g, { t: 'undo' }).ok, true); assert.equal(g.cells[a], 1);
  assert.equal(play(g, { t: 'undo' }).ok, true); assert.equal(g.cells[a], 0);
  assert.equal(play(g, { t: 'undo' }).ok, false, 'nichts mehr zurück');
  for (const i of [a, ...rest]) { assert.equal(g.mode, 'play'); assert.equal(play(g, { t: 'set', i, v: 1 }).ok, true); }
  assert.equal(g.mode, 'over');
  assert.equal(g.result.name, g.name);
  assert.equal(g.result.hints, 0);
  assert.equal(play(g, { t: 'set', i: a, v: 0 }).ok, false, 'nach dem Ende gesperrt');
});

test('Fertig auch mit Kreuzen und Resten: nur ausgemalte Felder zählen', () => {
  const g = started('leicht', 7);
  for (const i of emptyIdx(g)) play(g, { t: 'set', i, v: 2 });
  assert.equal(g.mode, 'play');
  for (const i of solIdx(g)) play(g, { t: 'set', i, v: 1 });
  assert.equal(g.mode, 'over');
});

test('Ziehen (paint): Reihe, nur Änderungen, ein Zurück-Schritt', () => {
  const g = started('mittel', 8);
  const n = g.n;
  const row = [0, 1, 2, 3].map((c) => 2 * n + c);
  assert.equal(play(g, { t: 'paint', cells: row, v: 1 }).ok, true);
  assert.ok(row.every((i) => g.cells[i] === 1));
  assert.equal(play(g, { t: 'paint', cells: row, v: 1 }).ok, false, 'nichts zu ändern');
  assert.equal(play(g, { t: 'set', i: row[1], v: 2 }).ok, true);
  // Kreuz-Ziehen überschreibt Ausgemaltes
  assert.equal(play(g, { t: 'paint', cells: row, v: 2 }).ok, true);
  assert.ok(row.every((i) => g.cells[i] === 2));
  // Leeren: nur Felder im Zustand `from`
  assert.equal(play(g, { t: 'set', i: row[0], v: 1 }).ok, true);
  assert.equal(play(g, { t: 'paint', cells: row, v: 0, from: 2 }).ok, true);
  assert.deepEqual(row.map((i) => g.cells[i]), [1, 0, 0, 0]);
  assert.equal(play(g, { t: 'undo' }).ok, true);
  assert.deepEqual(row.map((i) => g.cells[i]), [1, 2, 2, 2], 'ein Schritt macht die ganze Reihe rückgängig');
  // ungültig
  for (const bad of [{ cells: [] }, { cells: 'x' }, { cells: [0, 1], v: 3 }, { cells: [0, -1], v: 1 }, { cells: [0, 1.5], v: 1 }, { cells: [999], v: 1 }, { cells: [0, 1], v: 0 }, { cells: [0, 1], v: 0, from: 0 }, { cells: [0, 1], v: 0, from: 3 }, { cells: [0, 1] }]) {
    const before = JSON.stringify(g);
    assert.equal(play(g, { t: 'paint', ...bad }).ok, false, JSON.stringify(bad));
    assert.equal(JSON.stringify(g), before, 'Zustand unverändert');
  }
});

test('Alles leeren ist rückgängig machbar, aufgedeckte Felder bleiben', () => {
  const g = started('leicht', 3);
  assert.equal(play(g, { t: 'clear' }).ok, false, 'schon leer');
  const idx = solIdx(g).slice(0, 4);
  for (const i of idx) play(g, { t: 'set', i, v: 1 });
  play(g, { t: 'set', i: emptyIdx(g)[0], v: 2 });
  play(g, { t: 'reveal' });
  const rev = g.revealed[0];
  const filledBefore = g.cells.filter(Boolean).length;
  assert.equal(play(g, { t: 'clear' }).ok, true);
  assert.equal(g.cells.filter(Boolean).length, 1, 'nur das aufgedeckte Feld bleibt');
  assert.ok(g.cells[rev] !== 0);
  assert.equal(play(g, { t: 'undo' }).ok, true);
  assert.equal(g.cells.filter(Boolean).length, filledBefore);
});

test('Prüfen: falsche Felder, Zeilen und Spalten, Zählung, Löschen bei Änderung', () => {
  const g = started('mittel', 6);
  const n = g.n;
  const good = solIdx(g)[0], wrongFill = emptyIdx(g)[0], wrongCross = solIdx(g)[1], okCross = emptyIdx(g)[1];
  play(g, { t: 'set', i: good, v: 1 });
  play(g, { t: 'set', i: wrongFill, v: 1 });
  play(g, { t: 'set', i: wrongCross, v: 2 });
  play(g, { t: 'set', i: okCross, v: 2 });
  assert.equal(play(g, { t: 'check' }).ok, true);
  assert.deepEqual(g.check.wrong, [wrongFill, wrongCross].sort((a, b) => a - b));
  assert.deepEqual(g.check.rows, [...new Set([wrongFill, wrongCross].map((i) => Math.floor(i / n)))].sort((a, b) => a - b));
  assert.deepEqual(g.check.cols, [...new Set([wrongFill, wrongCross].map((i) => i % n))].sort((a, b) => a - b));
  assert.equal(g.checks, 1);
  assert.deepEqual(E.wrongCells(g), g.check.wrong);
  assert.equal(play(g, { t: 'check' }).ok, true);
  assert.equal(g.checks, 2); assert.equal(g.flagged.length, 2, 'jeder Fehler nur einmal gezählt');
  play(g, { t: 'set', i: wrongFill, v: 0 });
  assert.equal(g.check, null, 'Änderung löscht die Prüfanzeige');
  // leeres Raster: alles passt
  const h = started('leicht', 2);
  play(h, { t: 'check' });
  assert.deepEqual(h.check.wrong, []);
});

test('Erfüllung je Zeile und Spalte (lineOk) und Fertig nach Hinweisen', () => {
  const g = started('leicht', 12);
  const n = g.n;
  assert.equal(E.rowOk(g, 0), g.rows[0][0] === 0, 'leere Zeile erfüllt nur die Null');
  const r = 1;
  for (let c = 0; c < n; c++) if (g.sol[r * n + c] === '1') play(g, { t: 'set', i: r * n + c, v: 1 });
  assert.equal(E.rowOk(g, r), true);
  assert.equal(E.lineOk(g, 'r', r), true);
  // ein Kreuz ändert nichts an der Erfüllung
  const x = emptyIdx(g).find((i) => Math.floor(i / n) === r);
  if (x !== undefined) { play(g, { t: 'set', i: x, v: 2 }); assert.equal(E.rowOk(g, r), true); }
  // ein Feld zu viel macht die Zeile unerfüllt
  const extra = emptyIdx(g).find((i) => Math.floor(i / n) === r);
  if (extra !== undefined) { play(g, { t: 'set', i: extra, v: 1 }); assert.equal(E.rowOk(g, r), false); }
});

test('Aufdecken: zählt, ist fest, bevorzugt fehlende Felder, beendet das Spiel', () => {
  const g = started('leicht', 5);
  assert.equal(play(g, { t: 'reveal' }).ok, true);
  assert.equal(g.hints, 1); assert.equal(g.revealed.length, 1);
  const i = g.revealed[0];
  assert.equal(g.sol[i], '1'); assert.equal(g.cells[i], 1);
  assert.equal(play(g, { t: 'set', i, v: 0 }).ok, false, 'fest');
  assert.equal(play(g, { t: 'paint', cells: [i], v: 0, from: 1 }).ok, false, 'Ziehen ändert fest Aufgedecktes nicht');
  assert.equal(play(g, { t: 'undo' }).ok, false, 'Aufdecken ist nicht rückgängig zu machen');
  // falsch gesetztes Feld wird erst aufgedeckt, wenn nichts mehr fehlt
  for (const j of solIdx(g)) if (!g.cells[j]) play(g, { t: 'set', i: j, v: 1 });
  assert.equal(g.mode, 'over');
  assert.equal(g.result.hints, 1);
  assert.equal(play(g, { t: 'reveal' }).ok, false);
  // Rest: nur falsch gesetzte Felder
  const h = started('leicht', 5);
  for (const j of solIdx(h)) play(h, { t: 'set', i: j, v: 2 });
  const w = emptyIdx(h)[0];
  play(h, { t: 'set', i: w, v: 1 });
  for (let k = 0; k < 50 && h.mode === 'play'; k++) play(h, { t: 'reveal' });
  assert.equal(h.mode, 'over');
  assert.equal(h.cells[w], 2, 'falsches Feld wurde zum Kreuz');
});

test('Zeit, Bestzeit: ohne Hilfen, mit Hilfen, verbessert, schlechter', () => {
  assert.equal(E.fmtTime(0), '00:00'); assert.equal(E.fmtTime(65_000), '01:05'); assert.equal(E.fmtTime(3_725_000), '1:02:05');
  assert.equal(E.fmtTime(-5), '00:00'); assert.equal(E.fmtTime(NaN), '00:00');
  assert.deepEqual(E.bestUpdate(0, 50_000, 0), { record: true, best: 50_000, eligible: true });
  assert.deepEqual(E.bestUpdate(40_000, 50_000, 0), { record: false, best: 40_000, eligible: true });
  assert.deepEqual(E.bestUpdate(60_000, 50_000, 0), { record: true, best: 50_000, eligible: true });
  assert.equal(E.bestUpdate(60_000, 50_000, 1).record, false);
  const g = started('leicht', 1);
  play(g, { t: 'sync', ms: 12_000 });
  play(g, { t: 'sync', ms: 5_000 });
  assert.equal(g.elapsed, 12_000, 'Zeit läuft nur vorwärts');
  for (const i of solIdx(g)) play(g, { t: 'set', i, v: 1, ms: 30_000 });
  assert.equal(g.mode, 'over'); assert.equal(g.result.ms, 30_000);
  const b = E.settleResult(g, 0);
  assert.equal(b.record, true); assert.equal(g.result.record, true);
  assert.equal(E.settleResult(g, 0), null, 'nur einmal');
});

test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = E.createGame(P1);
  assert.equal(play(g, { t: 'set', i: 0, v: 1 }).ok, false, 'vor dem Start');
  assert.equal(play(g, { t: 'check' }).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'riesig' }, Math.random).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'new' }, Math.random).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'leicht' }, null).ok, false, 'Zufall fehlt');
  assert.equal(g.mode, 'choose');
  assert.equal(E.apply(g, 'zz', { t: 'new', level: 'leicht' }, Math.random).ok, false, 'falsche Person');
  for (const bad of [null, undefined, 5, 'x', [], {}, { t: 5 }]) assert.equal(E.apply(g, 'p0', bad, Math.random).ok, false);
  assert.equal(E.apply(null, 'p0', { t: 'new', level: 'leicht' }).ok, false);
  assert.equal(E.apply({}, 'p0', { t: 'new', level: 'leicht' }).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'leicht', ms: -1 }, Math.random).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'leicht', ms: 'x' }, Math.random).ok, false);
  play(g, { t: 'new', level: 'leicht' });
  for (const bad of [{ t: 'set' }, { t: 'set', i: -1, v: 1 }, { t: 'set', i: 25, v: 1 }, { t: 'set', i: 1.5, v: 1 }, { t: 'set', i: '3', v: 1 }, { t: 'set', i: 0, v: 3 }, { t: 'set', i: 0, v: -1 }, { t: 'set', i: 0, v: 0 }, { t: 'boom' }, { t: 'undo' }]) {
    const before = JSON.stringify(g);
    assert.equal(play(g, bad).ok, false, JSON.stringify(bad));
    assert.equal(JSON.stringify(g), before, 'Zustand bleibt');
  }
});

test('JSON-sicher: Zustand überlebt Speichern und Laden mitten im Spiel', () => {
  const g = started('schwer', 3);
  const rng = seeded(8);
  for (let k = 0; k < 40; k++) play(g, { t: 'set', i: Math.floor(rng() * 100), v: 1 + Math.floor(rng() * 2) });
  play(g, { t: 'check' }); play(g, { t: 'reveal' });
  const copy = JSON.parse(JSON.stringify(g));
  sameState(g, copy);
  assert.equal(E.isSolved(copy) === E.isSolved(JSON.parse(JSON.stringify(copy))), true);
});

test('200 Zufallszüge ohne Fehler: Zustand bleibt gültig, Rätsel endet mit Lösung', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed * 7);
    const level = E.LEVELS[seed % 3].id;
    const g = started(level, seed);
    const N = g.n * g.n;
    for (let step = 0; step < 200 && g.mode === 'play'; step++) {
      const t = ['set', 'set', 'set', 'paint', 'undo', 'check', 'reveal', 'clear', 'sync'][Math.floor(rng() * 9)];
      let msg;
      if (t === 'set') msg = { t, i: Math.floor(rng() * N), v: Math.floor(rng() * 3) };
      else if (t === 'paint') {
        const r = Math.floor(rng() * g.n), c0 = Math.floor(rng() * g.n), len = 1 + Math.floor(rng() * (g.n - c0));
        const v = Math.floor(rng() * 3);
        msg = { t, cells: Array.from({ length: len }, (_, k) => r * g.n + c0 + k), v, from: 1 + Math.floor(rng() * 2) };
      } else msg = { t, ms: step * 100 };
      const before = JSON.stringify(g);
      const r = play(g, msg);
      if (!r.ok) assert.equal(JSON.stringify(g), before, 'Fehler ändert nichts: ' + JSON.stringify(msg));
      assert.ok(g.cells.length === N && g.cells.every((x) => x === 0 || x === 1 || x === 2));
      assert.ok(g.revealed.every((i) => g.cells[i] !== 0));
      assert.ok(g.hist.every((h) => h.length && h.every(([i, v]) => i >= 0 && i < N && [0, 1, 2].includes(v))));
      assert.equal(g.mode === 'over', E.isSolved(g), 'Fertig genau dann, wenn alle Hinweise erfüllt sind');
    }
    // am Ende: nach Lösung fertig, sonst mit Aufdecken zu Ende bringen
    for (let k = 0; k < N + 5 && g.mode === 'play'; k++) play(g, { t: 'reveal' });
    assert.equal(g.mode, 'over', `seed ${seed}`);
    // das Bild ist genau die Lösung (eindeutig lösbar)
    const filled = g.cells.map((x) => (x === 1 ? '1' : '0')).join('');
    assert.equal(filled, g.sol);
  }
});
