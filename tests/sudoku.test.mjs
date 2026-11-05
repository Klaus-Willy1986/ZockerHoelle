import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../sudoku/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = [{ id: 'p0', name: 'Du' }];
const CLASSIC = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const CLASSIC_SOL = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const grid = (s) => Array.from(s, Number);

function started(level = 'leicht', seed = 5) {
  const g = E.createGame(P);
  const r = E.apply(g, 'p0', { t: 'new', level }, seeded(seed));
  assert.equal(r.ok, true);
  return g;
}
const emptyIdx = (g) => g.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
const sameState = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

test('Geometrie: 27 Einheiten à 9 Felder, 20 Nachbarn je Feld', () => {
  assert.equal(E.UNITS.length, 27);
  for (const u of E.UNITS) assert.equal(new Set(u).size, 9);
  for (let i = 0; i < 81; i++) assert.equal(E.PEERS[i].length, 20);
  assert.equal(E.BOX[40], 4);
  assert.equal(E.BOX[80], 8);
});

test('Lösungszähler: genau eine, keine und mehrere Lösungen', () => {
  assert.equal(E.countSolutions(CLASSIC), 1);
  assert.equal(E.countSolutions(grid(CLASSIC)), 1);
  assert.equal(E.countSolutions(CLASSIC_SOL), 1);
  // keine Lösung: doppelte Zahl in einer Zeile
  const dup = grid(CLASSIC); dup[1] = 5;
  assert.equal(E.countSolutions(dup), 0);
  // keine Lösung: Feld ohne Kandidaten (Zeile hat 1–8, darüber in der Spalte steht die 9)
  const dead = new Array(81).fill(0);
  for (let c = 0; c < 8; c++) dead[c] = c + 1;
  dead[8 + 9] = 9;
  assert.equal(E.countSolutions(dead), 0);
  // mehrere Lösungen: leeres Gitter, Abbruch bei 2
  assert.equal(E.countSolutions(new Array(81).fill(0), 2), 2);
  assert.equal(E.countSolutions(new Array(81).fill(0), 5), 5);
  // zwei Lösungen: aus der Lösung ein „Rechteck“ aus zwei Zahlenpaaren entfernen
  const s = grid(CLASSIC_SOL);
  const a = s.slice();
  // Zahlen 3 und 4 in den Feldern (0,0)=5? Wir suchen ein austauschbares Rechteck
  let found = null;
  for (let r1 = 0; r1 < 9 && !found; r1++) for (let r2 = r1 + 1; r2 < 9 && !found; r2++) for (let c1 = 0; c1 < 9 && !found; c1++) for (let c2 = c1 + 1; c2 < 9 && !found; c2++) {
    const v = [s[r1 * 9 + c1], s[r1 * 9 + c2], s[r2 * 9 + c1], s[r2 * 9 + c2]];
    if (v[0] === v[3] && v[1] === v[2] && v[0] !== v[1] && Math.floor(r1 / 3) === Math.floor(r2 / 3) && Math.floor(c1 / 3) !== Math.floor(c2 / 3)) found = [r1, r2, c1, c2];
  }
  if (found) {
    const [r1, r2, c1, c2] = found;
    a[r1 * 9 + c1] = a[r1 * 9 + c2] = a[r2 * 9 + c1] = a[r2 * 9 + c2] = 0;
    assert.equal(E.countSolutions(a), 2);
  }
  // ungültige Eingaben
  assert.equal(E.countSolutions([1, 2, 3]), 0);
  assert.equal(E.countSolutions(grid(CLASSIC).map((x, i) => (i === 3 ? 12 : x))), 0);
});

test('solve findet die Lösung des bekannten Rätsels', () => {
  assert.equal(E.solve(CLASSIC).join(''), CLASSIC_SOL);
  assert.equal(E.solve(new Array(81).fill(1)), null);
});

test('Technik-Löser: das bekannte Rätsel ist mit einfachen Techniken lösbar', () => {
  const r = E.techniqueSolve(CLASSIC, 1);
  assert.equal(r.solved, true);
  assert.equal(r.level, 1);
  assert.equal(r.grid.join(''), CLASSIC_SOL);
});

test('Technik-Löser: Ergebnis ist nie falsch (Stichprobe aus allen Stufen)', () => {
  const rng = seeded(11);
  for (const L of E.LEVELS) for (let k = 0; k < 8; k++) {
    const p = E.makePuzzle(L.id, rng);
    const t = E.techniqueSolve(p.puzzle, 3);
    if (t.solved) assert.equal(t.grid.join(''), p.solution);
    else for (let i = 0; i < 81; i++) if (t.grid[i]) assert.equal(String(t.grid[i]), p.solution[i]);
  }
});

test('Technik-Löser: Stufe 1 reicht bei einem Rätsel mit Pärchen nicht, mit Stufe 2 schon (gibt es solche Rätsel)', () => {
  const rng = seeded(21);
  let seen = 0;
  for (let k = 0; k < 30; k++) {
    const p = E.makePuzzle('mittel', rng);
    if (!E.techniqueSolve(p.puzzle, 1).solved && E.techniqueSolve(p.puzzle, 2).solved) seen++;
  }
  assert.ok(seen >= 15, `nur ${seen} von 30 brauchen Stufe 2`);
});

test('Vollständiges Gitter: gültig, zufällig, deterministisch', () => {
  const a = E.generateSolved(seeded(3)), b = E.generateSolved(seeded(3)), c = E.generateSolved(seeded(4));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 81);
  for (const u of E.UNITS) assert.equal(new Set(u.map((i) => a[i])).size, 9);
  assert.equal(E.conflicts(a).length, 0);
});

const EXPECT = { leicht: [38, 41], mittel: [26, 33], schwer: [22, 28] };
for (const L of E.LEVELS) {
  test(`Erzeugung ${L.name}: 30+ Rätsel eindeutig, Vorgaben im Bereich, Technikstufe passt`, () => {
    const rng = seeded(100 + L.clues);
    let sumClues = 0, lv2 = 0;
    for (let k = 0; k < 32; k++) {
      const p = E.makePuzzle(L.id, rng);
      assert.equal(p.puzzle.length, 81);
      assert.equal(E.countSolutions(p.puzzle, 2), 1, 'eindeutig');
      assert.equal(E.solve(p.puzzle).join(''), p.solution, 'passt zur Lösung');
      for (let i = 0; i < 81; i++) if (p.puzzle[i] !== '0') assert.equal(p.puzzle[i], p.solution[i]);
      const clues = [...p.puzzle].filter((c) => c !== '0').length;
      assert.equal(clues, p.clues);
      assert.ok(clues >= EXPECT[L.id][0] && clues <= EXPECT[L.id][1], `${L.id}: ${clues} Vorgaben`);
      // Verteilung: mindestens minPer je Zeile, Spalte und Block
      for (const u of E.UNITS) assert.ok(u.filter((i) => p.puzzle[i] !== '0').length >= L.minPer, 'Verteilung');
      const t = E.techniqueSolve(p.puzzle, L.cap || 3);
      assert.equal(t.solved, true, `${L.id}: mit Technikstufe ${L.cap} lösbar`);
      if (L.id === 'leicht') assert.equal(t.level, 1, 'nur einfache Techniken');
      if (t.level >= 2) lv2++;
      sumClues += clues;
    }
    if (L.id === 'mittel') assert.ok(lv2 >= 16, `Mittel braucht oft Stufe 2 (${lv2})`);
    if (L.id === 'schwer') assert.ok(lv2 >= 20, `Schwer braucht meist mehr als Stufe 1 (${lv2})`);
    EXPECT[L.id].avg = sumClues / 32;
  });
}

test('Die Stufen unterscheiden sich spürbar (Vorgaben)', () => {
  assert.ok(EXPECT.leicht.avg > EXPECT.mittel.avg + 6, `${EXPECT.leicht.avg} vs ${EXPECT.mittel.avg}`);
  assert.ok(EXPECT.mittel.avg > EXPECT.schwer.avg + 2, `${EXPECT.mittel.avg} vs ${EXPECT.schwer.avg}`);
});

test('Erzeugung ist schnell und deterministisch', () => {
  for (const L of E.LEVELS) {
    const t0 = performance.now();
    const a = E.makePuzzle(L.id, seeded(9));
    const ms = performance.now() - t0;
    assert.ok(ms < 300, `${L.id}: ${ms.toFixed(0)} ms`);
    assert.deepEqual(a, E.makePuzzle(L.id, seeded(9)));
  }
  assert.throws(() => E.makePuzzle('unbekannt', seeded(1)));
  assert.throws(() => E.makePuzzle('leicht'));
});

test('Neues Spiel: Auswahl-Modus, JSON-sicher', () => {
  const g = E.createGame(P);
  assert.equal(g.mode, 'choose');
  sameState(g, g);
  const h = started('mittel');
  assert.equal(h.mode, 'play');
  assert.equal(h.level, 'mittel');
  assert.equal(h.cells.length, 81);
  assert.equal(h.seq, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h)), h);
});

test('Vor dem Start und nach dem Ende werden Züge abgelehnt', () => {
  const g = E.createGame(P);
  const before = JSON.stringify(g);
  for (const m of [{ t: 'put', i: 0, d: 1 }, { t: 'undo' }, { t: 'check' }, { t: 'reveal', i: 0 }, { t: 'sync', ms: 5 }]) {
    assert.equal(E.apply(g, 'p0', m).ok, false);
  }
  assert.equal(JSON.stringify(g), before);
});

test('Eingabe: Zahl setzen, Vorgaben sind unveränderlich', () => {
  const g = started();
  const e = emptyIdx(g)[0];
  assert.deepEqual(E.apply(g, 'p0', { t: 'put', i: e, d: 4 }), { ok: true });
  assert.equal(g.cells[e], 4);
  const given = g.cells.findIndex((v, i) => E.isGiven(g, i));
  const snap = JSON.stringify(g);
  for (const m of [{ t: 'put', i: given, d: 9 }, { t: 'erase', i: given }, { t: 'note', i: given, d: 3 }]) {
    const r = E.apply(g, 'p0', m);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(JSON.stringify(g), snap);
  // gleiche Zahl nochmal → abgelehnt
  assert.equal(E.apply(g, 'p0', { t: 'put', i: e, d: 4 }).ok, false);
  assert.equal(JSON.stringify(g), snap);
  // überschreiben geht
  assert.equal(E.apply(g, 'p0', { t: 'put', i: e, d: 5 }).ok, true);
  assert.equal(g.cells[e], 5);
});

test('Löschen und Notizen', () => {
  const g = started();
  const [a, b] = emptyIdx(g);
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: a }).ok, false); // schon leer
  assert.equal(E.apply(g, 'p0', { t: 'note', i: a, d: 3 }).ok, true);
  assert.equal(E.apply(g, 'p0', { t: 'note', i: a, d: 7 }).ok, true);
  assert.equal(g.notes[a], (1 << 2) | (1 << 6));
  assert.equal(E.apply(g, 'p0', { t: 'note', i: a, d: 3 }).ok, true); // wieder aus
  assert.equal(g.notes[a], 1 << 6);
  // Zahl setzen löscht die Notizen dieses Feldes; Notizen in gefüllten Feldern gehen nicht
  assert.equal(E.apply(g, 'p0', { t: 'put', i: a, d: 2 }).ok, true);
  assert.equal(g.notes[a], 0);
  assert.equal(E.apply(g, 'p0', { t: 'note', i: a, d: 3 }).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: a }).ok, true);
  assert.equal(g.cells[a], 0);
  // Notizen löschen
  E.apply(g, 'p0', { t: 'note', i: b, d: 1 });
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: b }).ok, true);
  assert.equal(g.notes[b], 0);
});

test('Rückgängig stellt den Zustand exakt wieder her (unbegrenzt)', () => {
  const g = started('mittel', 8);
  const rng = seeded(77);
  const snaps = [JSON.stringify(g)];
  const stack = [];
  for (let n = 0; n < 300; n++) {
    const e = g.cells.map((v, i) => i).filter((i) => !E.isLocked(g, i));
    const i = e[Math.floor(rng() * e.length)];
    const d = 1 + Math.floor(rng() * 9);
    const kind = rng();
    const m = kind < 0.4 ? { t: 'put', i, d } : kind < 0.7 ? { t: 'note', i, d } : { t: 'erase', i };
    const before = JSON.stringify(g);
    const r = E.apply(g, 'p0', m);
    if (r.ok) { stack.push(before); } else assert.equal(JSON.stringify(g), before);
    if (g.mode === 'over') break;
  }
  assert.ok(stack.length > 100);
  while (stack.length) {
    assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, true);
    assert.equal(JSON.stringify(g), stack.pop());
  }
  assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, false);
  assert.equal(JSON.stringify(g), snaps[0]);
});

test('Hilfen: Prüfen zählt falsche Zahlen, Verraten höchstens dreimal', () => {
  const g = started('leicht', 12);
  const em = emptyIdx(g);
  const [a, b, c, d, e] = em;
  const wrong = (i) => (Number(g.solution[i]) % 9) + 1;
  E.apply(g, 'p0', { t: 'put', i: a, d: Number(g.solution[a]) });
  E.apply(g, 'p0', { t: 'put', i: b, d: wrong(b) });
  assert.equal(E.apply(g, 'p0', { t: 'check' }).ok, true);
  assert.deepEqual(g.check.wrong, [b]);
  assert.equal(g.checks, 1);
  assert.equal(g.flagged.length, 1);
  E.apply(g, 'p0', { t: 'check' });
  assert.equal(g.flagged.length, 1, 'gleiches Feld zählt nicht doppelt');
  // jede Änderung löscht das Prüfergebnis
  E.apply(g, 'p0', { t: 'put', i: b, d: Number(g.solution[b]) });
  assert.equal(g.check, null);
  E.apply(g, 'p0', { t: 'check' });
  assert.deepEqual(g.check.wrong, []);
  // Verraten
  assert.equal(E.apply(g, 'p0', { t: 'reveal', i: a }).ok, false); // nicht leer
  for (const i of [c, d, e]) assert.equal(E.apply(g, 'p0', { t: 'reveal', i }).ok, true);
  assert.equal(g.hints, 3);
  assert.equal(String(g.cells[c]), g.solution[c]);
  const f = em[5];
  const snap = JSON.stringify(g);
  const r = E.apply(g, 'p0', { t: 'reveal', i: f });
  assert.equal(r.ok, false);
  assert.match(r.error, /3/);
  assert.equal(JSON.stringify(g), snap);
  // aufgedeckte Felder sind fest
  assert.equal(E.apply(g, 'p0', { t: 'put', i: c, d: wrong(c) }).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'erase', i: c }).ok, false);
});

test('Verraten entfernt Altlasten aus dem Verlauf (Rückgängig bleibt stimmig)', () => {
  const g = started('leicht', 14);
  const [a, b] = emptyIdx(g);
  E.apply(g, 'p0', { t: 'note', i: a, d: 1 });
  E.apply(g, 'p0', { t: 'put', i: b, d: 1 });
  E.apply(g, 'p0', { t: 'reveal', i: a });
  assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, true); // macht nur b rückgängig
  assert.equal(g.cells[b], 0);
  assert.equal(String(g.cells[a]), g.solution[a]);
  assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, false);
});

function fillCorrect(g, skip = []) {
  for (const i of emptyIdx(g)) if (!skip.includes(i)) E.apply(g, 'p0', { t: 'put', i, d: Number(g.solution[i]) });
}

test('Spielende: richtig gefüllt → Ende mit Zeit; falsch gefüllt → weiterspielbar', () => {
  const g = started('leicht', 3);
  const em = emptyIdx(g);
  const last = em[em.length - 1];
  fillCorrect(g, [last]);
  assert.equal(g.mode, 'play');
  assert.equal(E.isFull(g), false);
  const wrongD = (Number(g.solution[last]) % 9) + 1;
  E.apply(g, 'p0', { t: 'put', i: last, d: wrongD, ms: 4000 });
  assert.equal(E.isFull(g), true);
  assert.equal(g.mode, 'play', 'voll aber falsch → nicht beendet');
  assert.equal(E.isSolved(g), false);
  assert.ok(E.conflicts(g.cells).length > 0, 'ein vollständiges falsches Gitter hat Regelverstöße');
  assert.deepEqual(E.wrongCells(g), [last]);
  E.apply(g, 'p0', { t: 'put', i: last, d: Number(g.solution[last]), ms: 61500 });
  assert.equal(g.mode, 'over');
  assert.equal(g.result.ms, 61500);
  assert.equal(g.result.level, 'leicht');
  assert.equal(g.result.record, null);
  assert.equal(E.apply(g, 'p0', { t: 'put', i: last, d: 1 }).ok, false);
  assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, false);
  // neues Rätsel nach dem Ende
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'schwer' }, seeded(2)).ok, true);
  assert.equal(g.mode, 'play');
  assert.equal(g.result, null);
  assert.equal(g.seq, 2);
});

test('Verraten des letzten Feldes beendet das Spiel mit Hilfe-Zähler', () => {
  const g = started('leicht', 4);
  const em = emptyIdx(g);
  fillCorrect(g, [em[0]]);
  E.apply(g, 'p0', { t: 'reveal', i: em[0], ms: 9000 });
  assert.equal(g.mode, 'over');
  assert.equal(g.result.hints, 1);
});

test('Zeit: kommt nur über den Zeitstempel der Nachricht, wird nie kleiner', () => {
  const g = started();
  assert.equal(g.elapsed, 0);
  const e = emptyIdx(g);
  E.apply(g, 'p0', { t: 'put', i: e[0], d: 1, ms: 5000 });
  assert.equal(g.elapsed, 5000);
  E.apply(g, 'p0', { t: 'put', i: e[1], d: 1, ms: 2000 });
  assert.equal(g.elapsed, 5000);
  E.apply(g, 'p0', { t: 'sync', ms: 7777.9 });
  assert.equal(g.elapsed, 7777);
  E.apply(g, 'p0', { t: 'put', i: e[2], d: 1 });
  assert.equal(g.elapsed, 7777);
  const snap = JSON.stringify(g);
  for (const ms of [-1, NaN, Infinity, '5', null]) assert.equal(E.apply(g, 'p0', { t: 'sync', ms }).ok, false);
  assert.equal(JSON.stringify(g), snap);
  E.apply(g, 'p0', { t: 'sync', ms: 1e15 });
  assert.ok(g.elapsed <= 100 * 3600 * 1000);
});

test('Ungültige Nachrichten ändern nie den Zustand', () => {
  const g = started();
  E.apply(g, 'p0', { t: 'put', i: emptyIdx(g)[0], d: 3, ms: 100 });
  const snap = JSON.stringify(g);
  const e = emptyIdx(g)[1];
  const junk = [null, undefined, 5, 'x', [], {}, { t: 7 }, { t: 'zzz' }, { t: 'put' }, { t: 'put', i: -1, d: 1 }, { t: 'put', i: 81, d: 1 },
    { t: 'put', i: 1.5, d: 1 }, { t: 'put', i: '3', d: 1 }, { t: 'put', i: e, d: 0 }, { t: 'put', i: e, d: 10 }, { t: 'put', i: e, d: '5' },
    { t: 'put', i: e, d: NaN }, { t: 'note', i: e, d: 0 }, { t: 'note', i: 99, d: 1 }, { t: 'erase', i: 'a' }, { t: 'reveal', i: -5 },
    { t: 'new', level: 'xx' }, { t: 'new' }, { t: 'new', level: 3 }, { t: 'put', i: e, d: 1, ms: -3 }, { t: '__proto__' }, { t: 'constructor' }];
  for (const m of junk) {
    const r = E.apply(g, 'p0', m, seeded(1));
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, 'string');
    assert.equal(JSON.stringify(g), snap, JSON.stringify(m));
  }
  assert.equal(E.apply(g, 'fremd', { t: 'put', i: e, d: 1 }).ok, false);
  assert.equal(E.apply(null, 'p0', { t: 'put', i: e, d: 1 }).ok, false);
  assert.equal(E.apply({}, 'p0', { t: 'put', i: e, d: 1 }).ok, false);
  assert.equal(JSON.stringify(g), snap);
  // Neues Rätsel ohne Zufallsfunktion
  assert.equal(E.apply(g, 'p0', { t: 'new', level: 'leicht' }, null).ok, false);
  assert.equal(JSON.stringify(g), snap);
});

test('Zufallspartien: JSON bleibt gleich, Zustand bleibt gültig', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const rng = seeded(seed);
    const g = E.createGame(P);
    E.apply(g, 'p0', { t: 'new', level: E.LEVELS[seed % 3].id }, rng);
    const msgs = ['put', 'note', 'erase', 'undo', 'check', 'reveal', 'sync'];
    for (let n = 0; n < 400 && g.mode === 'play'; n++) {
      const t = msgs[Math.floor(rng() * msgs.length)];
      E.apply(g, 'p0', { t, i: Math.floor(rng() * 81), d: 1 + Math.floor(rng() * 9), ms: n * 10 });
      assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
      assert.equal(g.cells.length, 81);
      assert.ok(g.hints <= E.MAX_HINTS);
      for (let i = 0; i < 81; i++) if (E.isGiven(g, i)) assert.equal(String(g.cells[i]), g.puzzle[i]);
    }
  }
});

test('Anzahl je Zahl und Regelverstöße', () => {
  const g = started('leicht', 6);
  const c = E.placedCounts(g);
  assert.equal(c.slice(1).reduce((a, b) => a + b, 0), 81 - E.emptyCount(g));
  assert.deepEqual(E.conflicts(E.solve(CLASSIC)), []);
  const cells = grid(CLASSIC_SOL);
  cells[0] = cells[1];
  assert.deepEqual(E.conflicts(cells), [0, 1].concat(E.conflicts(cells).filter((i) => i > 1)));
  assert.ok(E.conflicts(cells).includes(0) && E.conflicts(cells).includes(1));
});

test('Bestzeit-Logik', () => {
  assert.deepEqual(E.bestUpdate(0, 90000, 0), { record: true, best: 90000, eligible: true });
  assert.deepEqual(E.bestUpdate(null, 90000, 0), { record: true, best: 90000, eligible: true });
  assert.deepEqual(E.bestUpdate(80000, 90000, 0), { record: false, best: 80000, eligible: true });
  assert.deepEqual(E.bestUpdate(80000, 80000, 0), { record: false, best: 80000, eligible: true });
  assert.deepEqual(E.bestUpdate(80000, 70000, 0), { record: true, best: 70000, eligible: true });
  assert.equal(E.bestUpdate(0, 1000, 1).record, false, 'mit aufgedecktem Feld keine Bestzeit');
  assert.equal(E.bestUpdate(0, 0, 0).record, false);
  // Eintragen ins Ergebnis, nur einmal
  const g = started('leicht', 3);
  fillCorrect(g);
  assert.equal(g.mode, 'over');
  const b = E.settleResult(g, 0);
  assert.equal(g.result.record, g.result.ms > 0);
  assert.equal(E.settleResult(g, 0), null, 'nur einmal');
  assert.equal(E.settleResult(started(), 0), null);
});

test('Zeitanzeige', () => {
  assert.equal(E.fmtTime(0), '00:00');
  assert.equal(E.fmtTime(59999), '00:59');
  assert.equal(E.fmtTime(61000), '01:01');
  assert.equal(E.fmtTime(3600000 + 65000), '1:01:05');
  assert.equal(E.fmtTime(-5), '00:00');
  assert.equal(E.fmtTime('x'), '00:00');
});

test('Übungsrätsel: eindeutig, alle leeren Felder sind sichere nächste Schritte', () => {
  const lp = E.learnPuzzle();
  assert.equal(E.countSolutions(lp.puzzle), 1);
  assert.equal(E.solve(lp.puzzle).join(''), lp.solution);
  assert.equal(E.techniqueSolve(lp.puzzle, 1).solved, true);
  assert.equal([...lp.puzzle].filter((c) => c === '0').length, E.LEARN_ORDER.length);
  const g = E.createGame(P, { learn: true });
  assert.equal(g.mode, 'play');
  assert.equal(g.level, 'lern');
  for (const i of E.LEARN_ORDER) assert.equal(g.cells[i], 0);
});
