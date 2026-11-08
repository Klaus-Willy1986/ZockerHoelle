import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../patience/engine.js';

const seededRng = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = [{ id: 'p0', name: 'Du' }];
const c = E.mkCard; // (Farbe, Rang)
const CL = 0, SP = 1, HE = 2, DI = 3;
const blank = (free = false, draw3 = false) => {
  const g = E.createGame(P, { free, draw3 }, seededRng(1));
  g.tab = Array.from({ length: free ? 8 : 7 }, () => []);
  g.down = new Array(g.tab.length).fill(0);
  g.stock = []; g.waste = []; g.found = [0, 0, 0, 0]; g.cells = [null, null, null, null]; g.undo = []; g.moves = 0;
  return g;
};
const mv = (g, from, to) => E.handle(g, 'p0', { t: 'move', from, to });
const T = (i, j) => ({ k: 't', i, j });

function allSources(g) {
  const out = [{ k: 'w' }];
  g.tab.forEach((col, i) => { for (let j = 0; j < col.length; j++) out.push({ k: 't', i, j }); });
  for (let i = 0; i < 4; i++) out.push({ k: 'c', i });
  return out;
}
const balance = (g) => {
  const all = [...g.tab.flat(), ...g.stock, ...g.waste, ...g.cells.filter((x) => x !== null)];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= g.found[s]; r++) all.push(c(s, r));
  assert.equal(all.length, 52, 'Kartenzahl');
  assert.equal(new Set(all).size, 52, 'alle Karten verschieden');
};

test('Klondike: Austeilen 28 Karten in 7 Spalten + 24 Stock', () => {
  const g = E.createGame(P, {}, seededRng(5));
  assert.equal(g.free, false);
  assert.deepEqual(g.tab.map((x) => x.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(g.down, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(g.stock.length, 24);
  assert.equal(g.waste.length, 0);
  assert.deepEqual(g.found, [0, 0, 0, 0]);
  assert.equal(g.mode, 'play');
  balance(g);
});

test('FreeCell: Austeilen 7/6 Karten in 8 Spalten, 4 freie Zellen', () => {
  const g = E.createGame(P, { free: true }, seededRng(5));
  assert.deepEqual(g.tab.map((x) => x.length), [7, 7, 7, 7, 6, 6, 6, 6]);
  assert.deepEqual(g.down, new Array(8).fill(0));
  assert.equal(g.cells.length, 4);
  assert.equal(g.stock.length, 0);
  assert.equal(g.draw3, false);
  balance(g);
});

test('gleicher Startwert gibt gleiche Verteilung; Nochmal dasselbe Spiel', () => {
  const a = E.createGame(P, {}, seededRng(9));
  const b = E.createGame(P, { seed: a.seed });
  assert.deepEqual(a.tab, b.tab);
  assert.deepEqual(a.stock, b.stock);
  const g = E.createGame(P, {}, seededRng(11));
  const start = JSON.stringify([g.tab, g.stock]);
  // ein paar Züge, dann again
  E.handle(g, 'p0', { t: 'draw' });
  assert.equal(E.handle(g, 'p0', { t: 'again' }).ok, true);
  assert.equal(JSON.stringify([g.tab, g.stock]), start);
  assert.equal(g.moves, 0);
  assert.equal(g.undo.length, 0);
  const n = E.handle(g, 'p0', { t: 'new', free: true });
  assert.equal(n.ok, true);
  assert.equal(g.free, true);
  assert.equal(g.tab.length, 8);
  assert.equal(E.handle(g, 'p0', { t: 'again' }).ok, true);
  assert.equal(g.free, true);
});

test('Absteigend in wechselnden Farben, auch Reihe verschieben, Aufdecken', () => {
  const g = blank();
  g.tab[0] = [c(CL, 5), c(CL, 9), c(HE, 8)];
  g.down[0] = 1; // Kreuz 5 verdeckt
  g.tab[1] = [c(SP, 10)];
  g.tab[2] = [c(SP, 7)];
  assert.equal(mv(g, T(0, 2), { k: 't', i: 2 }).ok, false, 'Herz 8 auf Pik 7: falsch');
  assert.equal(mv(g, T(0, 1), { k: 't', i: 1 }).ok, false, 'Kreuz 9 (schwarz) auf Pik 10: gleiche Farbe');
  // Kreuz 9 + Herz 8 gehören nicht zusammen auf Pik 10? Kreuz 9 auf Pik 10 ist schwarz auf schwarz -> verboten
  g.tab[1] = [c(HE, 10)];
  assert.equal(mv(g, T(0, 1), { k: 't', i: 1 }).ok, true, 'Reihe Kreuz 9 + Herz 8 auf Herz 10');
  assert.deepEqual(g.tab[1], [c(HE, 10), c(CL, 9), c(HE, 8)]);
  assert.deepEqual(g.tab[0], [c(CL, 5)]);
  assert.equal(g.down[0], 0, 'Aufgedeckt');
  assert.equal(g.moves, 1);
  // verdeckte Karte darf nicht gewählt werden
  g.tab[3] = [c(DI, 4), c(SP, 3)]; g.down[3] = 1;
  assert.equal(mv(g, T(3, 0), { k: 't', i: 2 }).ok, false);
  // falsche Reihe (nicht zusammenhängend)
  g.tab[4] = [c(HE, 12), c(CL, 3)];
  assert.equal(E.cardsAt(g, T(4, 0)).length, 0);
});

test('Klondike: leere Spalte nimmt nur einen König (mit allem darauf)', () => {
  const g = blank();
  g.tab[0] = [c(HE, 12)];
  g.tab[1] = [c(SP, 13), c(HE, 12), c(CL, 11)];
  g.tab[2] = [c(DI, 13), c(CL, 12)];
  assert.equal(mv(g, T(0, 0), { k: 't', i: 3 }).ok, false, 'Dame in leere Spalte: nein');
  assert.equal(mv(g, T(2, 1), { k: 't', i: 3 }).ok, false, 'Dame nicht');
  assert.equal(mv(g, T(2, 0), { k: 't', i: 3 }).ok, false, 'ganze Spalte in leere: sinnlos/nein');
  g.tab[4] = [c(CL, 13), c(HE, 12), c(CL, 11)];
  g.tab[3] = [];
  assert.equal(mv(g, T(4, 0), { k: 't', i: 3 }).ok, false, 'Spalte von oben nach leer ist sinnlos');
  g.tab[5] = [c(HE, 5), c(SP, 13), c(HE, 12), c(CL, 11)]; g.down[5] = 1;
  assert.equal(mv(g, T(5, 1), { k: 't', i: 3 }).ok, true, 'König mit Dame und Bube');
  assert.equal(g.tab[3].length, 3);
  assert.equal(g.down[5], 0);
  balanceSub(g);
});
function balanceSub() {}

test('Stock ziehen: 1 Karte und 3 Karten, Rückführung beliebig oft', () => {
  for (const draw3 of [false, true]) {
    const g = E.createGame(P, { draw3 }, seededRng(3));
    const first = g.stock.slice();
    const n = draw3 ? 3 : 1;
    assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true);
    assert.equal(g.waste.length, n);
    assert.equal(g.stock.length, 24 - n);
    assert.equal(g.waste[g.waste.length - 1], first[first.length - n], 'oberste Ablagekarte');
    // alles ziehen
    while (g.stock.length) E.handle(g, 'p0', { t: 'draw' });
    assert.equal(g.waste.length, 24);
    for (let round = 0; round < 3; round++) {
      assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true, 'Rückführung');
      assert.equal(g.stock.length, 24);
      assert.equal(g.waste.length, 0);
      assert.deepEqual(g.stock, first, 'gleiche Reihenfolge wie am Anfang');
      while (g.stock.length) E.handle(g, 'p0', { t: 'draw' });
    }
    balance(g);
  }
  // Wenn nichts da ist: Fehler
  const e = blank();
  assert.equal(E.handle(e, 'p0', { t: 'draw' }).ok, false);
  const f = blank(true);
  f.stock = [1]; assert.equal(E.handle(f, 'p0', { t: 'draw' }).ok, false, 'FreeCell hat keinen Stapel');
});

test('Ablage und Zielstapel: Ass zuerst, Farbe aufsteigend', () => {
  const g = blank();
  g.waste = [c(HE, 2), c(HE, 1)];
  g.tab[0] = [c(SP, 1)];
  assert.equal(mv(g, { k: 'w' }, { k: 'f' }).ok, true);
  assert.equal(g.found[HE], 1);
  assert.equal(mv(g, { k: 'w' }, { k: 'f' }).ok, true);
  assert.equal(g.found[HE], 2);
  g.tab[1] = [c(CL, 3)];
  assert.equal(mv(g, T(1, 0), { k: 'f' }).ok, false, 'Kreuz 3 ohne Ass');
  assert.equal(mv(g, T(0, 0), { k: 'f' }).ok, true);
  assert.equal(g.found[SP], 1);
  assert.equal(g.tab[0].length, 0);
  // Reihe mit 2 Karten nicht auf Zielstapel
  g.tab[2] = [c(DI, 1), c(CL, 1)];
  assert.equal(mv(g, T(2, 0), { k: 'f' }).ok, false);
});

test('Gewinn-Erkennung und Ergebnis', () => {
  const g = blank();
  g.found = [13, 12, 13, 13];
  g.tab[0] = [c(SP, 13)];
  assert.equal(E.isWon(g), false);
  const r = E.handle(g, 'p0', { t: 'move', from: T(0, 0), to: { k: 'f' }, ms: 65000 });
  assert.equal(r.ok, true);
  assert.equal(E.isWon(g), true);
  assert.equal(g.mode, 'over');
  assert.deepEqual(g.result, { moves: 1, ms: 65000 });
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, false, 'nach Ende kein Zug');
  assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, true, 'Zurück nach Ende');
  assert.equal(g.mode, 'play');
  assert.equal(g.result, null);
  assert.equal(E.ranking(g)[0].won, false);
  assert.equal(E.fmtTime(65000), '1:05');
  assert.equal(E.better({ moves: 90, ms: 5 }, { moves: 100, ms: 1 }), true);
  assert.equal(E.better({ moves: 100, ms: 5 }, { moves: 100, ms: 9 }), true);
  assert.equal(E.better({ moves: 110, ms: 5 }, { moves: 100, ms: 9 }), false);
  assert.equal(E.better({ moves: 110, ms: 5 }, null), true);
});

test('Automatisch ablegen: Klondike (alles offen) und FreeCell (geordnete Reihen)', () => {
  const g = blank();
  g.tab[0] = [c(CL, 13), c(HE, 12), c(SP, 11)];
  g.tab[1] = [c(DI, 13), c(CL, 12)];
  g.waste = [c(HE, 13)];
  g.stock = [c(SP, 13)];
  g.found = [10, 10, 11, 12];
  g.tab[2] = [c(CL, 11)]; // Kreuz 11 offen
  g.found[CL] = 10; g.found[SP] = 10;
  // Karten nachrechnen: Kreuz 1..10 (10) + K,Q,J; Pik 1..10 + K, J; Herz 1..11 + Q, K; Karo 1..12 + K ...
  g.tab[0] = [c(CL, 13), c(HE, 12), c(SP, 11)];
  assert.equal(E.autoAvailable(g), true);
  const steps = E.autoMoves(g);
  assert.ok(steps.length > 0);
  // Pik Dame fehlt im Beispiel; Auto kann nicht vollständig gewinnen, legt aber ab, was geht
  const before = g.moves;
  const r = E.handle(g, 'p0', { t: 'auto' });
  assert.equal(r.ok, true);
  assert.ok(g.moves > before);
  // verdeckte Karte -> nicht verfügbar
  const h = E.createGame(P, {}, seededRng(4));
  assert.equal(E.autoAvailable(h), false);
  assert.equal(E.handle(h, 'p0', { t: 'auto' }).ok, false);

  // FreeCell: vollständig gewinnbar
  const f = blank(true);
  for (let s = 0; s < 4; s++) f.found[s] = 0;
  // vier geordnete Spalten K..A: K♣ Q♥ J♠ 10♦ 9♣ 8♥ 7♠ 6♦ 5♣ 4♥ 3♠ 2♦ A♣  (alternierend)
  const seq = (s0, s1) => { const out = []; for (let r = 13; r >= 1; r--) out.push(c((13 - r) % 2 === 0 ? s0 : s1, r)); return out; };
  f.tab[0] = seq(CL, HE); f.tab[1] = seq(SP, DI); f.tab[2] = seq(HE, CL); f.tab[3] = seq(DI, SP);
  assert.equal(E.autoAvailable(f), true);
  assert.equal(E.handle(f, 'p0', { t: 'auto' }).ok, true);
  assert.equal(E.isWon(f), true);
  assert.equal(f.mode, 'over');
  assert.equal(f.undo.length, 1, 'ein Zurück macht alles rückgängig');
  assert.equal(E.handle(f, 'p0', { t: 'undo' }).ok, true);
  assert.equal(f.moves, 0);
  assert.equal(f.tab[0].length, 13);
});

test('FreeCell: Mehrfachzug-Formel (freie Zellen + 1) * 2^(leere Spalten ohne Ziel)', () => {
  const g = blank(true);
  g.tab[0] = [c(SP, 1)]; // Spalten 0..: mit Karten, Rest leer
  g.tab[1] = [c(SP, 2)];
  assert.equal(E.countMovable(g, 0), (4 + 1) * 2 ** 6);
  g.tab = g.tab.map((x, i) => (i < 8 ? (x.length ? x : [c(DI, 13 - i)]) : x));
  assert.equal(E.countMovable(g, 0), 5, 'keine leere Spalte, 4 Zellen');
  g.cells = [c(CL, 1), null, null, null];
  assert.equal(E.countMovable(g, 0), 4);
  g.cells = [c(CL, 1), c(CL, 2), null, null];
  assert.equal(E.countMovable(g, 0), 3);
  g.tab[5] = [];
  assert.equal(E.countMovable(g, 0), 3 * 2, 'eine leere Spalte');
  assert.equal(E.countMovable(g, 5), 3, 'Ziel ist die leere Spalte: zählt nicht mit');
  g.tab[6] = [];
  assert.equal(E.countMovable(g, 5), 3 * 2);
  assert.equal(E.countMovable(g, 1), 3 * 4);
  g.cells = [c(CL, 1), c(CL, 2), c(CL, 3), c(CL, 4)];
  assert.equal(E.countMovable(g, 1), 1 * 4);
  assert.equal(E.countMovable(blank(false), 0), 52);
});

test('FreeCell: Reihe wird nur bis zur Höchstzahl bewegt', () => {
  const g = blank(true);
  // Reihe K♠ Q♥ J♣ 10♦ 9♠ (5 Karten) in Spalte 0; Ziel: Spalte 1 mit rotem Ass? nein: leere Spalte
  for (let i = 1; i < 8; i++) g.tab[i] = [c(DI, 13 - i + (i === 7 ? 0 : 0))].filter(() => true);
  g.tab[0] = [c(SP, 11), c(HE, 10), c(SP, 9), c(HE, 8), c(SP, 7)];
  g.tab[1] = [c(DI, 12)]; // Dame rot, Bube Pik darf drauf
  g.cells = [c(CL, 1), c(CL, 2), null, null]; // 2 freie Zellen -> max 3 Karten
  assert.equal(E.countMovable(g, 1), 3);
  assert.equal(mv(g, T(0, 0), { k: 't', i: 1 }).ok, false, '5 Karten sind zu viel');
  g.cells = [null, null, null, c(CL, 1)]; // 3 freie Zellen -> 4
  assert.equal(mv(g, T(0, 0), { k: 't', i: 1 }).ok, false, '5 > 4');
  g.cells = [null, null, null, null]; // 5 Karten gehen
  assert.equal(mv(g, T(0, 0), { k: 't', i: 1 }).ok, true);
  assert.equal(g.tab[1].length, 6);
  assert.equal(g.tab[0].length, 0);
});

test('FreeCell: Zellen nehmen eine Karte, leere Spalte jede Karte, Zielstapel', () => {
  const g = blank(true);
  for (let i = 0; i < 8; i++) g.tab[i] = [c(DI, 13 - i)];
  g.tab[0] = [c(SP, 5), c(HE, 4)];
  g.tab[7] = [c(CL, 1)];
  assert.equal(mv(g, T(0, 1), { k: 'c', i: 2 }).ok, true);
  assert.equal(g.cells[2], c(HE, 4));
  assert.equal(mv(g, { k: 'c', i: 2 }, { k: 'c', i: 3 }).ok, false, 'Zelle auf Zelle nein');
  assert.equal(mv(g, T(0, 0), { k: 'c', i: 2 }).ok, false, 'Zelle belegt');
  assert.equal(mv(g, T(7, 0), { k: 'f' }).ok, true, 'Kreuz Ass hoch');
  assert.equal(g.tab[7].length, 0);
  assert.equal(mv(g, { k: 'c', i: 2 }, { k: 't', i: 7 }).ok, true, 'jede Karte in leere Spalte');
  assert.equal(g.cells[2], null);
  // Zellen gibt es bei Klondike nicht
  const k = blank(false);
  k.tab[0] = [c(SP, 5)];
  assert.equal(mv(k, T(0, 0), { k: 'c', i: 0 }).ok, false);
});

test('legalMovesFrom nennt genau die erlaubten Ziele', () => {
  const g = blank();
  g.tab[0] = [c(HE, 1)];
  g.tab[1] = [c(SP, 2)];
  g.tab[2] = [c(CL, 2)];
  const m = E.legalMovesFrom(g, T(0, 0));
  assert.deepEqual(m, [{ k: 'f' }, { k: 't', i: 1 }, { k: 't', i: 2 }]);
  assert.deepEqual(E.legalMovesFrom(g, T(1, 0)), []);
  assert.deepEqual(E.legalMovesFrom(g, { k: 'w' }), []);
  assert.deepEqual(E.legalMovesFrom(g, { k: 'x' }), []);
  assert.deepEqual(E.legalMovesFrom(null, T(0, 0)), []);
  assert.equal(E.canPlace(g, [], { k: 'f' }), false);
});

test('Zurück-Stack: unbegrenzt, stellt alles genau wieder her', () => {
  const g = E.createGame(P, {}, seededRng(21));
  const snaps = [JSON.stringify([g.tab, g.down, g.stock, g.waste, g.found, g.moves])];
  const rng = seededRng(4);
  for (let k = 0; k < 150; k++) {
    const moves = [];
    for (const f of allSources(g)) for (const to of E.legalMovesFrom(g, f)) moves.push([f, to]);
    if (E.canPlace(g, [1], { k: 'f' }) || g.stock.length || g.waste.length) moves.push(null);
    if (!moves.length) break;
    const m = moves[Math.floor(rng() * moves.length)];
    const r = m ? mv(g, m[0], m[1]) : E.handle(g, 'p0', { t: 'draw' });
    assert.equal(r.ok, true);
    snaps.push(JSON.stringify([g.tab, g.down, g.stock, g.waste, g.found, g.moves]));
  }
  assert.equal(g.undo.length, snaps.length - 1);
  while (g.undo.length) {
    snaps.pop();
    assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, true);
    assert.equal(JSON.stringify([g.tab, g.down, g.stock, g.waste, g.found, g.moves]), snaps[snaps.length - 1]);
  }
  assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, false);
  balance(g);
});

test('Ungültige Nachrichten, falsche Person, kaputte Eingaben ändern nichts', () => {
  const g = E.createGame(P, {}, seededRng(2));
  const before = JSON.stringify(g);
  for (const msg of [null, undefined, 5, 'x', [], {}, { t: 'foo' }, { t: 'move' }, { t: 'move', from: 5, to: 7 }, { t: 'move', from: { k: 't', i: 99, j: 0 }, to: { k: 'f' } },
    { t: 'move', from: { k: 't', i: 0, j: 0 }, to: { k: 'q' } }, { t: 'move', from: { k: 't', i: 'a', j: 0 }, to: { k: 'f' } },
    { t: 'move', from: { k: 'c', i: 0 }, to: { k: 'f' } }, { t: 'move', from: { k: 't', i: 6, j: 0 }, to: { k: 't', i: 6 } }]) {
    const r = E.handle(g, 'p0', msg);
    assert.equal(r.ok, false, JSON.stringify(msg));
  }
  assert.equal(JSON.stringify(g), before);
  for (const t of ['draw', 'undo', 'auto', 'again', 'new', 'sync']) {
    const r = E.handle(g, 'fremd', { t });
    assert.equal(r.ok, false, t);
  }
  assert.equal(E.handle(g, 'fremd', { t: 'move', from: { k: 'w' }, to: { k: 'f' } }).ok, false);
  assert.equal(JSON.stringify(g), before);
  assert.equal(E.handle(null, 'p0', { t: 'draw' }).ok, false);
  assert.equal(E.handle({}, 'p0', { t: 'draw' }).ok, false);
  const e = E.createGame(null, null, seededRng(1));
  assert.equal(e.players[0].id, 'p0');
  // Zeit: nie rückwärts, nie unsinnig
  E.handle(g, 'p0', { t: 'draw', ms: 5000 });
  E.handle(g, 'p0', { t: 'draw', ms: 1000 });
  assert.equal(g.elapsed, 5000);
  E.handle(g, 'p0', { t: 'draw', ms: 'abc' });
  E.handle(g, 'p0', { t: 'draw', ms: -5 });
  E.handle(g, 'p0', { t: 'draw', ms: Infinity });
  assert.equal(g.elapsed, 5000);
});

test('Zustand ist JSON-sicher (Rundlauf) in beiden Spielarten', () => {
  for (const free of [false, true]) {
    const g = E.createGame(P, { free }, seededRng(8));
    const rng = seededRng(3);
    for (let k = 0; k < 40; k++) {
      const moves = [];
      for (const f of allSources(g)) for (const to of E.legalMovesFrom(g, f)) moves.push([f, to]);
      if (!moves.length) break;
      const m = moves[Math.floor(rng() * moves.length)];
      mv(g, m[0], m[1]);
    }
    const copy = JSON.parse(JSON.stringify(g));
    assert.deepEqual(copy, g);
    assert.equal(E.handle(copy, 'p0', { t: 'undo' }).ok, g.undo.length > 0);
    assert.ok(!/undefined|NaN/.test(JSON.stringify(g)));
  }
});

test('Lernrunde-Verteilung: 52 Karten, gewinnbar mit einfachen Zügen', () => {
  const g = E.learnGame(P);
  balance(g);
  assert.equal(g.learn, true);
  // Skript: Bube auf Dame, ziehen, Pik 9 ab, dann auto/Ablegen
  assert.equal(mv(g, T(0, 1), { k: 't', i: 1 }).ok, true);
  assert.equal(g.down[0], 0);
  assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true);
  assert.equal(mv(g, { k: 'w' }, { k: 'f' }).ok, true);
  for (let k = 0; k < 100 && g.mode === 'play'; k++) {
    const src = allSources(g).find((f) => E.legalMovesFrom(g, f).some((d) => d.k === 'f'));
    if (src) assert.equal(mv(g, src, { k: 'f' }).ok, true);
    else assert.equal(E.handle(g, 'p0', { t: 'draw' }).ok, true);
  }
  assert.equal(E.isWon(g), true, 'Lernrunde ist gewinnbar');
  balance(g);
});

test('Vorbereiteter Fast-Gewinn (preset)', () => {
  for (const k of ['klondike', 'freecell']) {
    const g = E.presetGame(P, k);
    balance(g);
    assert.equal(g.free, k === 'freecell');
    assert.equal(mv(g, T(0, 0), { k: 'f' }).ok, true);
    assert.equal(E.isWon(g), false);
    assert.equal(mv(g, T(1, 0), { k: 'f' }).ok, true);
    assert.equal(E.isWon(g), true);
  }
});

test('200 Zufallsspiele mit zufälligen legalen Zügen enden ohne Fehler (Kartenbilanz 52 jederzeit)', () => {
  let won = 0, totalMoves = 0;
  for (let n = 0; n < 200; n++) {
    const rng = seededRng(1000 + n);
    const free = n % 2 === 1;
    const g = E.createGame(P, { free, draw3: n % 4 === 0 }, rng);
    balance(g);
    for (let step = 0; step < 400 && g.mode === 'play'; step++) {
      const moves = [];
      for (const f of allSources(g)) for (const to of E.legalMovesFrom(g, f)) moves.push([f, to]);
      // Ablegen auf Zielstapel bevorzugen, damit Spiele auch enden
      const fm = moves.filter((m) => m[1].k === 'f');
      let r;
      if (fm.length && rng() < 0.7) { const m = fm[Math.floor(rng() * fm.length)]; r = mv(g, m[0], m[1]); }
      else if (!free && rng() < 0.3 && (g.stock.length || g.waste.length)) r = E.handle(g, 'p0', { t: 'draw' });
      else if (moves.length) { const m = moves[Math.floor(rng() * moves.length)]; r = mv(g, m[0], m[1]); }
      else if (!free && (g.stock.length || g.waste.length)) r = E.handle(g, 'p0', { t: 'draw' });
      else break;
      assert.equal(r.ok, true, JSON.stringify(r));
      if (step % 7 === 0) balance(g);
      if (E.autoAvailable(g)) { if (rng() < 0.5) assert.equal(E.handle(g, 'p0', { t: 'auto' }).ok, true); }
      else assert.equal(E.handle(g, 'p0', { t: 'auto' }).ok, false);
    }
    balance(g);
    assert.ok(g.tab.every((col, i) => col.length === 0 || g.down[i] < col.length), 'oberste Karte offen');
    if (g.mode === 'over') { won++; assert.equal(E.isWon(g), true); }
    totalMoves += g.moves;
  }
  console.log('gewonnen:', won, 'Züge gesamt:', totalMoves);
  assert.ok(totalMoves > 1000);
});
