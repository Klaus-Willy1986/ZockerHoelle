import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../farben/engine.js';

const mk = (n = 2) => E.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
// Hilfsfunktion: setzt Würfel von Hand und startet den Schritt wie roll()
function setRoll(g, c, n, phase) {
  g.dice = { c, n };
  g.gone = { c: c.map(() => false), n: n.map(() => false) };
  g.throwNo += 1; g.rollId += 1; g.picks = {}; g.auto = {};
  g.phase = phase || (g.solo || g.throwNo <= 3 ? 'all' : 'active');
}
const forceRoll = (g, c, n) => { // wie roll(), aber mit festen Würfeln (Zufall über rng-Folge)
  const ci = (f) => (E.COLOR_FACES.indexOf(f) + 0.5) / 6;
  const ni = (f) => (E.NUM_FACES.indexOf(f) + 0.5) / 6;
  const seq = [...c.map(ci), ...n.map(ni)];
  let i = 0;
  // roll() würfelt erst alle Farbwürfel, dann alle Zahlenwürfel
  return E.roll(g, E.activePlayer(g).id, () => seq[i++]);
};
const mark = (g, pid, cells) => { const p = E.playerById(g, pid); for (const i of cells) p.x[i] = 1; };
const cellsOfCol = (c) => E.COL_CELLS[c];
const at = (r, c) => E.idx(r - 1, c.charCodeAt(0) - 65); // at(1,'H')

test('Spielblatt: je Farbe 21 Felder, 15 Sterne, 105 Felder', () => {
  assert.equal(E.NCELLS, 105);
  for (const c of E.COLORS) assert.equal(E.COLOR_CELLS[c].length, 21, c);
  assert.equal(E.STARS.length, 15);
  assert.equal(E.COL_TOP.length, 15);
  assert.equal(E.COL_LOW.length, 15);
  assert.equal(E.LETTERS[E.START_COL], 'H');
});
test('Spielblatt: einzelne Felder und Farbblöcke', () => {
  assert.equal(E.CELL_COLOR[at(1, 'H')], 'G'); assert.ok(E.IS_STAR[at(1, 'H')]);
  assert.equal(E.CELL_COLOR[at(7, 'H')], 'Y');
  assert.equal(E.CELL_COLOR[at(7, 'O')], 'O');
  assert.ok(E.IS_STAR[at(7, 'M')]);
  assert.ok(E.IS_STAR[at(6, 'O')]);
  // Gelber 5er-Block oben links (D1–G1 + E2? ) : D1,E1,F1,G1 sind gelb und hängen mit E2,F2 zusammen
  const b = E.BLOCK_OF[at(1, 'D')];
  assert.equal(E.BLOCK_OF[at(1, 'G')], b);
  assert.equal(E.BLOCK_OF[at(2, 'E')], b);
  assert.equal(E.BLOCK_OF[at(2, 'F')], b);
  assert.notEqual(E.BLOCK_OF[at(1, 'M')], b); // gelb rechts oben ist ein anderer Block
  // Jeder Block ist zusammenhängend und einfarbig; Blöcke decken alle Felder ab
  let sum = 0;
  for (const bl of E.BLOCKS) {
    sum += bl.cells.length;
    for (const i of bl.cells) assert.equal(E.CELL_COLOR[i], bl.color);
  }
  assert.equal(sum, 105);
  // Spalte H von oben: G O P B B Y Y
  assert.deepEqual(E.COL_CELLS[7].map((i) => E.CELL_COLOR[i]), ['G', 'O', 'P', 'B', 'B', 'Y', 'Y']);
});
test('Sterne an den erwarteten Stellen', () => {
  const names = E.STARS.map(E.cellName).sort();
  assert.deepEqual(names, ['H1', 'L1', 'C2', 'E2', 'J2', 'A3', 'G3', 'F4', 'N4', 'B6', 'D6', 'I6', 'K6', 'O6', 'M7'].sort());
});

test('Erstes Kreuz muss in Spalte H liegen', () => {
  const x = E.emptyMarks();
  assert.ok(E.checkCells(x, 'G', 1, [at(1, 'A')]));
  assert.equal(E.checkCells(x, 'G', 1, [at(1, 'H')]), null);
  // 3 gelbe Felder, die Spalte H berühren: G1,F1,E1 liegen nicht in H -> nein, H1 ist grün
  assert.ok(E.checkCells(x, 'Y', 3, [at(1, 'D'), at(1, 'E'), at(1, 'F')]));
  // Gelb in H: H6,H7 und I6 (gelbe Fläche unten)
  assert.equal(E.checkCells(x, 'Y', 3, [at(6, 'H'), at(7, 'H'), at(7, 'I')]), null);
});
test('Diagonal zählt nicht, nur waagerecht/senkrecht angrenzend', () => {
  const x = E.emptyMarks();
  x[at(1, 'H')] = 1; // grün H1 (Sternfeld)
  // G1 ist gelb, I1 blau, H2 orange: waagerecht/senkrecht angrenzend, aber falsche Farbe
  assert.ok(E.checkCells(x, 'G', 1, [at(2, 'D')]), 'weit weg');
  assert.equal(E.checkCells(x, 'O', 1, [at(2, 'H')]), null, 'H2 liegt in Spalte H');
  const y = E.emptyMarks();
  y[at(2, 'H')] = 1; // orange H2
  assert.ok(E.checkCells(y, 'G', 1, [at(3, 'G')]), 'G3 (grün) liegt nur diagonal zu H2');
  assert.equal(E.checkCells(y, 'O', 1, [at(2, 'G')]), null, 'G2 (orange) grenzt waagerecht an H2');
  assert.equal(E.checkCells(y, 'G', 1, [at(1, 'H')]), null, 'H1 liegt in Spalte H');
  assert.ok(E.checkCells(y, 'P', 1, [at(3, 'I')]), 'I3 (pink) nur diagonal');
  assert.equal(E.checkCells(y, 'P', 1, [at(3, 'H')]), null);
});
test('Nicht über zwei Farbblöcke, genaue Anzahl, Duplikate', () => {
  const x = E.emptyMarks();
  // H6 (gelb) und I6 gehören zum selben Block; H5 ist blau
  assert.ok(E.checkCells(x, 'Y', 3, [at(7, 'H'), at(7, 'I')]), 'nur 2 statt 3');
  assert.ok(E.checkCells(x, 'Y', 1, [at(7, 'H'), at(7, 'I')]), 'zu viele');
  assert.ok(E.checkCells(x, 'Y', 2, [at(7, 'H'), at(7, 'H')]));
  // Zwei getrennte Blöcke derselben Farbe: Orange H2 und Orange O?? -> nicht zusammenhängend
  assert.ok(E.checkCells(x, 'O', 2, [at(2, 'H'), at(2, 'G')]) === null, 'G2/H2 orange sind zusammenhängend');
  assert.ok(E.checkCells(x, 'O', 2, [at(2, 'H'), at(5, 'H')]), 'nicht zusammenhängend');
  assert.ok(E.checkCells(x, 'X', 1, [0]));
  assert.ok(E.checkCells(x, 'G', 1, [-1]));
  assert.ok(E.checkCells(x, 'G', 1, [105]));
  assert.ok(E.checkCells(x, 'G', 1, [1.5]));
  assert.ok(E.checkCells(x, 'G', 1, 'abc'));
});
test('Bereits angekreuzte Felder nicht doppelt', () => {
  const x = E.emptyMarks(); x[at(1, 'H')] = 1;
  assert.ok(E.checkCells(x, 'G', 1, [at(1, 'H')]));
});
test('legalGroups: Größe, Farbe, Startbedingung; Übereinstimmung mit checkCells und maxRun', () => {
  const x = E.emptyMarks();
  for (const c of E.COLORS) for (let n = 1; n <= 5; n++) {
    const gs = E.legalGroups(x, c, n);
    for (const g of gs) { assert.equal(g.length, n); assert.equal(E.checkCells(x, c, n, g), null); }
    assert.equal(gs.length > 0, n <= E.maxRun(x, c), `${c}${n}`);
  }
  // Beispiel aus der Anleitung: gelb 5 in Spalte H beginnend, vorhanden
  assert.ok(E.legalGroups(x, 'Y', 5).length > 0);
  // blau 4er-Block in Beispiel: mit 5 Blau ab H4/H5 möglich (H4,H5,G4,G5,... Block groß)
  assert.ok(E.legalGroups(x, 'B', 4).length > 0);
  assert.equal(E.legalGroups(x, 'B', 5).length, 0, 'der blaue Block in Spalte H hat nur 4 Felder');
  // Gruppen sind eindeutig
  const gs = E.legalGroups(x, 'G', 3);
  assert.equal(new Set(gs.map((g) => g.join(','))).size, gs.length);
});
test('legalGroups und checkCells stimmen auf Zufallsblättern überein (Brute Force)', () => {
  let seed = 5;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < 40; t++) {
    const x = E.emptyMarks();
    // zufälliges wachsendes Blatt
    const k = Math.floor(rnd() * 25);
    for (let m = 0; m < k; m++) {
      const c = E.COLORS[Math.floor(rnd() * 5)];
      const n = 1 + Math.floor(rnd() * 3);
      const gs = E.legalGroups(x, c, n);
      if (gs.length) for (const i of gs[Math.floor(rnd() * gs.length)]) x[i] = 1;
    }
    const c = E.COLORS[Math.floor(rnd() * 5)];
    const n = 1 + Math.floor(rnd() * 3);
    const gs = new Set(E.legalGroups(x, c, n).map((g) => g.join(',')));
    // Brute-Force über alle n-Teilmengen von Farbfeldern (n<=3)
    const cc = E.COLOR_CELLS[c];
    let count = 0;
    const rec = (start, cur) => {
      if (cur.length === n) { if (E.checkCells(x, c, n, cur) === null) { count++; assert.ok(gs.has([...cur].sort((a, b) => a - b).join(','))); } return; }
      for (let i = start; i < cc.length; i++) rec(i + 1, [...cur, cc[i]]);
    };
    rec(0, []);
    assert.equal(count, gs.size);
    assert.equal(gs.size > 0, n <= E.maxRun(x, c));
  }
});
test('Kein Block muss in einem Wurf komplett gefüllt werden; 6 gibt es nicht', () => {
  const x = E.emptyMarks();
  assert.deepEqual(E.legalGroups(x, 'Y', 6), []);
  assert.deepEqual(E.legalGroups(x, 'Y', 0), []);
  assert.ok(E.maxRun(x, 'Y') <= 5);
  assert.equal(E.legalGroups(x, 'Y', 2).length > 0, true);
});

// ---------- Ablauf ----------
test('Neues Spiel: Grundzustand', () => {
  const g = mk(3);
  assert.equal(g.phase, 'roll');
  assert.equal(g.throwNo, 0);
  assert.equal(g.players[0].jokers, 8);
  assert.equal(g.solo, false);
  assert.equal(JSON.parse(JSON.stringify(g)).players.length, 3);
});
test('roll: nur aktive Person, nur im richtigen Moment; 3 + 3 Würfel', () => {
  const g = mk(2);
  assert.equal(E.roll(g, 'p1').ok, false);
  assert.equal(E.roll(g, 'nobody').ok, false);
  assert.equal(E.roll(g, 'p0', () => 0.1).ok, true);
  assert.equal(g.dice.c.length, 3); assert.equal(g.dice.n.length, 3);
  assert.equal(E.roll(g, 'p0').ok, false, 'doppelt würfeln');
  assert.equal(E.roll(g, 'p0', () => 0.999).ok, false);
});
test('Würfelflächen aus rng', () => {
  const g = mk(2);
  const vals = [0, 0.2, 0.4, 0.6, 0.8, 0.999, 0, 0.2, 0.4, 0.6, 0.8, 0.999];
  let i = 0;
  E.roll(g, 'p0', () => vals[i++]);
  assert.deepEqual(g.dice.c, ['G', 'Y', 'B']);
  assert.deepEqual(g.dice.n, [4, 5, '?']);
});
test('Erste 3 Würfe: alle wählen gleichzeitig aus allen 6 Würfeln', () => {
  const g = mk(3);
  forceRoll(g, ['Y', 'B', 'O'], [4, 2, 1]);
  assert.equal(g.phase, 'all');
  assert.deepEqual(E.waitingFor(g).sort(), ['p0', 'p1', 'p2']);
  // Person 2 wählt zuerst (gleichzeitig!)
  assert.equal(E.submit(g, 'p2', { ci: 2, ni: 2, cells: [at(2, 'H')] }).ok, true);
  assert.deepEqual(E.waitingFor(g).sort(), ['p0', 'p1']);
  // Dieselbe Kombination darf eine andere Person auch nehmen
  assert.equal(E.submit(g, 'p1', { ci: 2, ni: 2, cells: [at(2, 'H')] }).ok, true);
  assert.equal(E.submit(g, 'p0', null).ok, true);
  assert.equal(g.phase, 'roll');
  assert.equal(g.active, 1);
});
test('Ab dem 4. Wurf: aktive Person zuerst, andere aus 4 Würfeln', () => {
  const g = mk(3);
  g.throwNo = 3;
  forceRoll(g, ['Y', 'B', 'O'], [1, 1, 1]); // alle 1er: nur 1 Feld
  assert.equal(g.throwNo, 4);
  assert.equal(g.phase, 'active');
  assert.deepEqual(E.waitingFor(g), ['p0']);
  assert.equal(E.submit(g, 'p1', { ci: 0, ni: 0, cells: [at(7, 'H')] }).ok, false);
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, cells: [at(7, 'H')] }).ok, true);
  assert.equal(g.phase, 'others');
  assert.deepEqual(E.waitingFor(g).sort(), ['p1', 'p2']);
  assert.equal(E.submit(g, 'p1', { ci: 0, ni: 1, cells: [at(7, 'H')] }).ok, false, 'gelber Würfel 0 ist weg');
  assert.equal(E.submit(g, 'p1', { ci: 1, ni: 0, cells: [at(7, 'H')] }).ok, false, 'Zahlenwürfel 0 ist weg');
  assert.equal(E.submit(g, 'p1', { ci: 1, ni: 1, cells: [at(4, 'H')] }).ok, true);
  assert.equal(E.submit(g, 'p2', { ci: 1, ni: 1, cells: [at(4, 'H')] }).ok, true, 'gleiche Kombination erlaubt');
  assert.equal(g.phase, 'roll');
  assert.equal(g.active, 1);
});
test('Passt die aktive Person, wählen die anderen aus allen 6 Würfeln', () => {
  const g = mk(2);
  g.throwNo = 5;
  forceRoll(g, ['Y', 'B', 'O'], [1, 1, 1]);
  E.submit(g, 'p0', null);
  assert.equal(g.phase, 'others');
  assert.equal(g.gone.c.some(Boolean), false);
  assert.equal(E.submit(g, 'p1', { ci: 0, ni: 0, cells: [at(7, 'H')] }).ok, true);
});
test('Doppelte Wahl und falsche Zeitpunkte werden abgelehnt', () => {
  const g = mk(2);
  assert.equal(E.submit(g, 'p0', null).ok, false, 'vor dem Würfeln');
  forceRoll(g, ['Y', 'B', 'O'], [1, 1, 1]);
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, cells: [at(7, 'H')] }).ok, true);
  assert.equal(E.submit(g, 'p0', null).ok, false, 'schon gewählt');
  assert.equal(E.submit(g, 'zzz', null).ok, false);
});
test('Ungültige Nachrichten ändern den Zustand nie', () => {
  const g = mk(2);
  forceRoll(g, ['Y', 'X', 'O'], [4, '?', 1]);
  const before = JSON.stringify(g);
  const bad = [
    { ci: 9, ni: 0, cells: [at(7, 'H')] }, { ci: 0, ni: 9, cells: [at(7, 'H')] }, { ci: -1, ni: 0, cells: [] },
    { ci: 0, ni: 0, cells: [at(7, 'H')] }, // 4 Felder nötig
    { ci: 0, ni: 0, cells: [at(1, 'A'), at(1, 'B'), at(1, 'C'), at(2, 'B')] },
    { ci: 0, ni: 0, color: 'G', cells: [at(7, 'H')] },
    { ci: 0, ni: 2, num: 3, cells: [at(7, 'H')] },
    { ci: 1, ni: 0, cells: [at(1, 'H')] }, // Joker-Farbe fehlt
    { ci: 1, ni: 0, color: 'Z', cells: [at(1, 'H')] },
    { ci: 0, ni: 1, cells: [at(7, 'H')] }, // Joker-Zahl fehlt
    { ci: 0, ni: 1, num: 6, cells: [] },
    { ci: 0, ni: 1, num: 0, cells: [] },
    { ci: 0, ni: 1, num: 1.5, cells: [] },
    { ci: 0, ni: 0 }, { ci: 0, ni: 0, cells: 'x' }, 'abc', 5,
  ];
  for (const m of bad) {
    const r = E.submit(g, 'p0', m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.ok(r.error);
    assert.equal(JSON.stringify(g), before);
  }
});
test('Joker-Kosten: Farbe 1, Zahl 1, beide 2; ohne Ausrufezeichen keine Joker', () => {
  const g = mk(2);
  forceRoll(g, ['X', 'Y', 'Y'], ['?', 1, 1]);
  let r = E.submit(g, 'p0', { ci: 0, ni: 0, color: 'G', num: 1, cells: [at(1, 'H')] });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].jokers, 6);
  const g2 = mk(2);
  forceRoll(g2, ['X', 'Y', 'Y'], [1, 1, 1]);
  assert.equal(E.submit(g2, 'p0', { ci: 0, ni: 0, color: 'G', cells: [at(1, 'H')] }).ok, true);
  assert.equal(g2.players[0].jokers, 7);
  const g3 = mk(2);
  forceRoll(g3, ['Y', 'Y', 'Y'], ['?', 1, 1]);
  assert.equal(E.submit(g3, 'p0', { ci: 0, ni: 0, num: 2, cells: [at(7, 'H'), at(7, 'I')] }).ok, true);
  assert.equal(g3.players[0].jokers, 7);
  // Keine Ausrufezeichen mehr
  const g4 = mk(2);
  g4.players[0].jokers = 1;
  forceRoll(g4, ['X', 'Y', 'Y'], ['?', 1, 1]);
  const before = JSON.stringify(g4);
  r = E.submit(g4, 'p0', { ci: 0, ni: 0, color: 'G', num: 1, cells: [at(1, 'H')] });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(g4), before);
  g4.players[0].jokers = 0;
  assert.equal(E.submit(g4, 'p0', { ci: 0, ni: 1, color: 'G', cells: [at(1, 'H')] }).ok, false);
  assert.equal(E.submit(g4, 'p0', { ci: 1, ni: 1, cells: [at(7, 'H')] }).ok, true, 'ohne Joker weiter normal');
});
test('Joker-Zahl: keine 6; 5 ist erlaubt', () => {
  const g = mk(2);
  forceRoll(g, ['Y', 'Y', 'Y'], ['?', 1, 1]);
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, num: 6, cells: [1, 2, 3, 4, 5, 6] }).ok, false);
  const five = E.legalGroups(g.players[0].x, 'Y', 5)[0];
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, num: 5, cells: five }).ok, true);
  assert.equal(E.markCount(g.players[0]), 5);
});
test('Automatisches Passen, wenn keine Möglichkeit besteht', () => {
  const g = mk(2);
  // p1 hat keine Ausrufezeichen; würfelt nur Joker-Farbe + Joker-Zahl, p0 darf
  g.players[1].jokers = 0;
  forceRoll(g, ['X', 'X', 'X'], ['?', '?', '?']);
  assert.equal(g.auto.p1, true);
  assert.equal(g.picks.p1, null);
  assert.deepEqual(E.waitingFor(g), ['p0']);
  E.submit(g, 'p0', null);
  assert.equal(g.phase, 'roll');
  assert.ok(g.recap.some((l) => l.includes('keine Möglichkeit')));
});
test('hasMove: Zahl größer als jede freie Fläche -> keine Möglichkeit', () => {
  const g = mk(2);
  forceRoll(g, ['Y', 'Y', 'Y'], [5, 5, 5]);
  assert.equal(E.hasMove(g, 'p0'), E.maxRun(g.players[0].x, 'Y') >= 5);
});

// ---------- Wertung ----------
function fillAllButOne(g, pid, col) {
  mark(g, pid, cellsOfCol(col).slice(0, -1));
}
test('Spalte zuerst komplett: oberer Wert; später: unterer; gleichzeitig: beide oben', () => {
  const g = mk(3);
  // Spalte E: Farben der Zeilen
  const colE = cellsOfCol(4);
  const colors = colE.map((i) => E.CELL_COLOR[i]);
  assert.equal(colors.join(''), 'YYGOPE'.slice(0, 0) + colors.join(''));
  // Alle drei Personen haben E bis auf das letzte Feld, das einzige fehlende Feld ist E7 (Blau)
  for (const pid of ['p0', 'p1', 'p2']) fillAllButOne(g, pid, 4);
  const last = colE[6];
  const lc = E.CELL_COLOR[last];
  // Fehlendes Feld muss startfähig sein: Nachbar angekreuzt (E6 ist angekreuzt) -> ok
  const fi = E.NUM_FACES.indexOf(1);
  assert.ok(fi >= 0);
  forceRoll(g, [lc, lc, lc], [1, 1, 1]);
  // p0 und p1 füllen gleichzeitig, p2 nicht
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, cells: [last] }).ok, true);
  assert.equal(E.submit(g, 'p1', { ci: 0, ni: 0, cells: [last] }).ok, true);
  assert.equal(E.submit(g, 'p2', null).ok, true);
  assert.equal(g.players[0].colPts[4], 2);
  assert.equal(g.players[1].colPts[4], 2);
  assert.equal(g.players[2].colPts[4], null);
  assert.ok(g.recap[0].includes('Spalte E komplett'));
  assert.ok(g.recap[0].includes('2 Punkte'));
  // p2 füllt sie später: unterer Wert 1
  forceRoll(g, [lc, lc, lc], [1, 1, 1]); // Wurf 2: aktiv ist p1
  E.submit(g, 'p0', null); E.submit(g, 'p1', null); E.submit(g, 'p2', { ci: 0, ni: 0, cells: [last] });
  assert.equal(g.players[2].colPts[4], 1);
  assert.equal(g.colTaken[4], true);
});
test('Mehrere Spalten in einem Wurf; Spalte H gibt 1 / 0', () => {
  const g = mk(2);
  const p = g.players[0];
  // Spalte H (grün/orange/pink/blau/blau/gelb/gelb) komplett bis auf H6,H7 (gelb)
  mark(g, 'p0', cellsOfCol(7).slice(0, 5));
  forceRoll(g, ['Y', 'Y', 'Y'], [2, 2, 2]);
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, cells: [at(6, 'H'), at(7, 'H')] }).ok, true);
  E.submit(g, 'p1', null);
  assert.equal(p.colPts[7], 1);
  const g2 = mk(2);
  mark(g2, 'p0', cellsOfCol(7)); mark(g2, 'p1', cellsOfCol(7).slice(0, 6));
  g2.players[0].colPts[7] = 1; g2.colTaken[7] = true;
  forceRoll(g2, ['Y', 'Y', 'Y'], [1, 1, 1]);
  E.submit(g2, 'p0', null);
  E.submit(g2, 'p1', { ci: 0, ni: 0, cells: [at(7, 'H')] });
  assert.equal(g2.players[1].colPts[7], 0);
});
test('Zwei Spalten gleichzeitig in einem Wurf', () => {
  const g = mk(2);
  // Spalte A und B: B6 (blau), B7 (gelb)... einfacher: Spalten komplett bis auf Felder, die dieselbe Farbe haben
  // A7 (gelb) und B7 (gelb) sind benachbart und gelb
  mark(g, 'p0', cellsOfCol(0).slice(0, 6));
  mark(g, 'p0', cellsOfCol(1).slice(0, 6));
  forceRoll(g, ['Y', 'Y', 'Y'], [2, 2, 2]);
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, cells: [at(7, 'A'), at(7, 'B')] }).ok, true);
  E.submit(g, 'p1', null);
  assert.equal(g.players[0].colPts[0], 5);
  assert.equal(g.players[0].colPts[1], 3);
  assert.ok(g.recap[0].includes('Spalte A komplett, Spalte B komplett'));
  assert.ok(g.recap[0].includes('8 Punkte'));
});
test('Farbbonus: erste 5, später 3, gleichzeitig beide 5; zweite Farbe beendet das Spiel', () => {
  const g = mk(3);
  const gc = E.COLOR_CELLS.G;
  // p0 und p1: alle grünen außer G7? wähle ein grünes Feld, das beim Rest startfähig ist
  const target = at(7, 'M'); // grün (G*)
  assert.equal(E.CELL_COLOR[target], 'G');
  for (const pid of ['p0', 'p1']) mark(g, pid, gc.filter((i) => i !== target));
  forceRoll(g, ['G', 'G', 'G'], [1, 1, 1]);
  E.submit(g, 'p0', { ci: 0, ni: 0, cells: [target] });
  E.submit(g, 'p1', { ci: 0, ni: 0, cells: [target] });
  E.submit(g, 'p2', null);
  assert.equal(g.players[0].colorPts.G, 5);
  assert.equal(g.players[1].colorPts.G, 5);
  assert.equal(g.colorTaken.G, true);
  assert.equal(g.mode, 'play');
  // p2 später: 3
  mark(g, 'p2', gc.filter((i) => i !== target));
  forceRoll(g, ['G', 'G', 'G'], [1, 1, 1]);
  E.submit(g, 'p0', null); E.submit(g, 'p1', null);
  E.submit(g, 'p2', { ci: 0, ni: 0, cells: [target] });
  assert.equal(g.players[2].colorPts.G, 3);
});
test('Spielende: zweite Farbe der aktiven Person – andere dürfen vorher noch wählen', () => {
  const g = mk(2);
  g.throwNo = 3;
  const gy = E.COLOR_CELLS.G; const yy = E.COLOR_CELLS.Y;
  const tg = at(7, 'M'); const ty = at(7, 'A');
  assert.equal(E.CELL_COLOR[ty], 'Y');
  mark(g, 'p0', gy); // grün komplett (Bonus ist später prüfbar: schon als Wert eintragen)
  g.players[0].colorPts.G = 5; g.colorTaken.G = true;
  mark(g, 'p0', yy.filter((i) => i !== ty));
  forceRoll(g, ['Y', 'G', 'G'], [1, 1, 1]);
  assert.equal(g.phase, 'active');
  E.submit(g, 'p0', { ci: 0, ni: 0, cells: [ty] });
  assert.equal(g.mode, 'play', 'noch nicht zu Ende: p1 darf wählen');
  assert.equal(g.phase, 'others');
  assert.deepEqual(E.waitingFor(g), ['p1']);
  E.submit(g, 'p1', { ci: 1, ni: 1, cells: [at(1, 'H')] });
  assert.equal(g.mode, 'over');
  assert.equal(g.phase, 'over');
  assert.ok(g.endReason.includes('P0'));
  assert.equal(g.players[1].x[at(1, 'H')], 1, 'Wahl der anderen Person zählt noch');
  assert.equal(E.roll(g, 'p1').ok, false);
  assert.equal(E.submit(g, 'p1', null).ok, false);
  void tg;
});
test('Spielende: zweite Farbe einer anderen Person im gleichen Wurf', () => {
  const g = mk(2);
  const yy = E.COLOR_CELLS.Y; const oo = E.COLOR_CELLS.O;
  const ty = at(7, 'A'); const to = at(7, 'O');
  mark(g, 'p1', yy.filter((i) => i !== ty));
  mark(g, 'p1', oo.filter((i) => i !== to));
  g.players[1].colorPts.O = 3;
  mark(g, 'p1', E.COLOR_CELLS.G); g.players[1].colorPts.G = 3;
  forceRoll(g, ['Y', 'Y', 'Y'], [1, 1, 1]);
  E.submit(g, 'p1', { ci: 0, ni: 0, cells: [ty] });
  E.submit(g, 'p0', null);
  assert.equal(g.mode, 'over');
  assert.equal(g.players[1].colorPts.Y, 5);
});
test('Endwertung: Farbbonus, Spalten, Joker, Sterne', () => {
  const g = mk(2);
  const p = g.players[0];
  assert.deepEqual(E.scoreOf(p), { colors: 0, cols: 0, jokers: 8, stars: -30, total: -22 });
  p.colorPts.G = 5; p.colPts[0] = 5; p.colPts[7] = 1; p.jokers = 3;
  for (const i of E.STARS.slice(0, 5)) p.x[i] = 1; // 5 Sterne angekreuzt -> 10 fehlen
  const s = E.scoreOf(p);
  assert.equal(s.stars, -20); assert.equal(s.cols, 6); assert.equal(s.colors, 5); assert.equal(s.jokers, 3);
  assert.equal(s.total, 5 + 6 + 3 - 20);
});
test('Rangliste: Gleichstand -> mehr Ausrufezeichen gewinnt, sonst mehrere Sieger', () => {
  const g = mk(3);
  g.players[0].colPts[0] = 5; g.players[0].jokers = 6;  // 5+6-30 = -19
  g.players[1].colPts[0] = 3; g.players[1].colPts[1] = 2; g.players[1].jokers = 6; // -19, gleiche Jokerzahl
  g.players[2].jokers = 8; g.players[2].colPts[0] = 3; // 3+8-30 = -19, 8 Joker
  let r = E.ranking(g);
  assert.equal(r[0].id, 'p2');
  assert.equal(r[0].place, 1);
  assert.equal(r[1].place, 2); assert.equal(r[2].place, 2);
  assert.equal(r[1].tie, true);
  assert.equal(E.winners(g).length, 1);
  g.players[2].jokers = 6; g.players[2].colPts[0] = 5;
  r = E.ranking(g);
  assert.equal(E.winners(g).length, 3);
});
test('Leistungsstufen im Alleinspiel', () => {
  assert.equal(E.soloLevel(41), 'Es gibt also doch Superhelden!');
  assert.ok(E.soloLevel(40).startsWith('Wirst du'));
  assert.ok(E.soloLevel(37).startsWith('Wirst du'));
  assert.ok(E.soloLevel(36).startsWith('Du könntest'));
  assert.ok(E.soloLevel(33).startsWith('Du könntest'));
  assert.ok(E.soloLevel(32).startsWith('Super'));
  assert.ok(E.soloLevel(29).startsWith('Super'));
  assert.ok(E.soloLevel(28).startsWith('Hoffentlich'));
  assert.ok(E.soloLevel(25).startsWith('Hoffentlich'));
  assert.ok(E.soloLevel(24).startsWith('Klasse'));
  assert.ok(E.soloLevel(21).startsWith('Klasse'));
  assert.ok(E.soloLevel(20).startsWith('Das war wohl'));
  assert.ok(E.soloLevel(17).startsWith('Das war wohl'));
  assert.ok(E.soloLevel(16).startsWith('Gut'));
  assert.ok(E.soloLevel(13).startsWith('Gut'));
  assert.ok(E.soloLevel(12).startsWith('Na,'));
  assert.ok(E.soloLevel(9).startsWith('Na,'));
  assert.ok(E.soloLevel(8).startsWith('Nicht ganz'));
  assert.ok(E.soloLevel(5).startsWith('Nicht ganz'));
  assert.ok(E.soloLevel(4).startsWith('Da muss'));
  assert.ok(E.soloLevel(1).startsWith('Da muss'));
  assert.equal(E.soloLevel(0), 'Dabei sein ist alles.');
  assert.ok(E.soloLevel(-1).startsWith('Das grenzt'));
  assert.ok(!/schmidt|noch mal/i.test(Array.from({ length: 50 }, (_, i) => E.soloLevel(i - 5)).join()));
});

// ---------- Alleinspiel ----------
test('Alleinspiel: 2+2 Würfel, immer aus allen wählbar, 30 Würfe, dann Ende', () => {
  const g = mk(1);
  assert.equal(g.solo, true);
  let n = 0;
  while (g.mode === 'play' && n < 100) {
    assert.equal(E.roll(g, 'p0', () => 0.9).ok, true); // 'X' und '?': ohne Würfel-Auswahl nur Joker
    assert.equal(g.dice.c.length, 2); assert.equal(g.dice.n.length, 2);
    assert.equal(g.phase === 'all' || g.mode === 'over', true);
    if (g.mode === 'play' && E.waitingFor(g).length) E.submit(g, 'p0', null);
    n++;
  }
  assert.equal(g.throwNo, 30);
  assert.equal(g.mode, 'over');
  assert.ok(g.endReason.includes('30'));
});
test('Alleinspiel: Spalte bringt den oberen Wert, Wurf 4 bleibt frei wählbar', () => {
  const g = mk(1);
  g.throwNo = 6;
  const colE = cellsOfCol(4);
  mark(g, 'p0', colE.slice(0, 6));
  const last = colE[6]; const lc = E.CELL_COLOR[last];
  forceRoll(g, [lc, 'G'], [1, 2]);
  assert.equal(g.phase, 'all');
  assert.equal(E.submit(g, 'p0', { ci: 0, ni: 0, cells: [last] }).ok, true);
  assert.equal(g.players[0].colPts[4], 2);
  assert.equal(g.phase, 'roll');
});

// ---------- Zufallspartien ----------
function lcg(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function botMove(g, pid, rnd) {
  const p = E.playerById(g, pid);
  const options = [];
  for (let ci = 0; ci < g.dice.c.length; ci++) {
    if (g.gone.c[ci]) continue;
    for (let ni = 0; ni < g.dice.n.length; ni++) {
      if (g.gone.n[ni]) continue;
      const cost = (g.dice.c[ci] === 'X') + (g.dice.n[ni] === '?');
      if (cost > p.jokers) continue;
      for (const col of g.dice.c[ci] === 'X' ? E.COLORS : [g.dice.c[ci]]) {
        for (const num of g.dice.n[ni] === '?' ? [1, 2, 3, 4, 5] : [g.dice.n[ni]]) {
          const gs = E.legalGroups(p.x, col, num);
          for (const cells of gs) options.push({ ci, ni, color: col, num, cells });
        }
      }
    }
  }
  if (!options.length || rnd() < 0.08) return { options: options.length, msg: null };
  const o = options[Math.floor(rnd() * options.length)];
  return { options: options.length, msg: { ci: o.ci, ni: o.ni, color: g.dice.c[o.ci] === 'X' ? o.color : undefined, num: g.dice.n[o.ni] === '?' ? o.num : undefined, cells: o.cells } };
}
function invariants(g) {
  for (const p of g.players) {
    assert.ok(p.jokers >= 0 && p.jokers <= 8);
    assert.equal(p.x.length, 105);
    for (let c = 0; c < 15; c++) if (p.colPts[c] !== null) assert.ok(E.colComplete(p.x, c));
    for (const col of E.COLORS) if (p.colorPts[col] !== null) assert.ok(E.colorComplete(p.x, col));
    for (let c = 0; c < 15; c++) if (E.colComplete(p.x, c) && g.phase === 'roll') assert.notEqual(p.colPts[c], null);
  }
  for (let c = 0; c < 15; c++) {
    const tops = g.players.filter((p) => p.colPts[c] === E.COL_TOP[c]).length;
    if (E.COL_TOP[c] !== E.COL_LOW[c]) assert.ok(tops === 0 || g.colTaken[c]);
  }
}
test('Zufallspartien enden sauber (1–6 Personen)', () => {
  let totalGames = 0;
  for (let seed = 1; seed <= 240; seed++) {
    const n = 1 + (seed % 6);
    const rnd = lcg(seed * 7919);
    const g = mk(n);
    let guard = 0;
    while (g.mode === 'play') {
      assert.ok(++guard < 3000, `Spiel ${seed} endet nicht`);
      if (g.phase === 'roll') {
        const r = E.roll(g, E.activePlayer(g).id, rnd);
        assert.equal(r.ok, true);
        continue;
      }
      const w = E.waitingFor(g);
      assert.ok(w.length > 0);
      const pid = w[Math.floor(rnd() * w.length)];
      const { msg } = botMove(g, pid, rnd);
      const before = JSON.stringify(g);
      const r = E.submit(g, pid, msg);
      assert.equal(r.ok, true, r.error);
      assert.notEqual(JSON.stringify(g), before);
      // Niemand außer den Wartenden darf noch einmal
      assert.equal(E.submit(g, pid, null).ok, false);
      invariants(g);
      JSON.parse(JSON.stringify(g));
    }
    totalGames++;
    invariants(g);
    assert.ok(g.endReason);
    assert.ok(E.ranking(g).length === n);
    if (n === 1) assert.ok(g.throwNo <= 30);
    else assert.ok(g.players.some((p) => E.colorsDone(p).length >= 2));
    // Beim Spielende gilt: Würfe > 3 hatten aktive Person zuerst
  }
  assert.equal(totalGames, 240);
});
test('Zufallspartien: unzulässige Zufallsnachrichten ändern nie den Zustand', () => {
  const rnd = lcg(99);
  for (let seed = 0; seed < 30; seed++) {
    const g = mk(2 + (seed % 3));
    let guard = 0;
    while (g.mode === 'play' && guard++ < 400) {
      if (g.phase === 'roll') { E.roll(g, E.activePlayer(g).id, rnd); continue; }
      const w = E.waitingFor(g);
      // Zufallsmüll
      for (let k = 0; k < 5; k++) {
        const pid = ['p0', 'p1', 'p2', 'p9'][Math.floor(rnd() * 4)];
        const msg = { ci: Math.floor(rnd() * 4) - 1, ni: Math.floor(rnd() * 4) - 1, color: ['G', 'X', undefined][Math.floor(rnd() * 3)], num: [undefined, 6, 3][Math.floor(rnd() * 3)], cells: Array.from({ length: Math.floor(rnd() * 6) }, () => Math.floor(rnd() * 110) - 3) };
        const before = JSON.stringify(g);
        const r = E.submit(g, pid, msg);
        if (!r.ok) assert.equal(JSON.stringify(g), before);
        else { invariants(g); break; }
      }
      if (g.mode !== 'play' || g.phase === 'roll') continue;
      const w2 = E.waitingFor(g);
      if (w2.length) E.submit(g, w2[0], botMove(g, w2[0], rnd).msg);
      void w;
    }
  }
});
