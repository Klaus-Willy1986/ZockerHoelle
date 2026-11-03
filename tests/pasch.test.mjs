import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../pasch/engine.js';

const mk = (n = 2) => P.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
const seq = (...vs) => { let i = 0; return () => (vs[i++ % vs.length] - 1 + 0.5) / 6; }; // liefert Augenzahlen der Reihe nach
const force = (g, dice, rolls = 1) => { g.turn = { rolls, dice, kept: Array(5).fill(false) }; };
const S = P.scoreFor;

test('Obere Felder zählen nur die jeweilige Augenzahl', () => {
  assert.equal(S('ones', [1, 1, 2, 3, 1]), 3);
  assert.equal(S('sixes', [6, 6, 2, 3, 1]), 12);
  assert.equal(S('fours', [1, 2, 3, 5, 6]), 0);
  assert.equal(S('fives', [5, 5, 5, 5, 5]), 25);
});
test('Dreier- und Viererpasch', () => {
  assert.equal(S('three', [3, 3, 3, 4, 5]), 18);
  assert.equal(S('three', [3, 3, 4, 4, 5]), 0);
  assert.equal(S('three', [3, 3, 3, 3, 5]), 17);
  assert.equal(S('four', [3, 3, 3, 3, 5]), 17);
  assert.equal(S('four', [3, 3, 3, 4, 5]), 0);
  assert.equal(S('four', [6, 6, 6, 6, 6]), 30);
});
test('Full House inkl. fünf gleiche', () => {
  assert.equal(S('full', [2, 2, 5, 5, 5]), 25);
  assert.equal(S('full', [2, 2, 5, 5, 4]), 0);
  assert.equal(S('full', [2, 2, 2, 2, 5]), 0);
  assert.equal(S('full', [4, 4, 4, 4, 4]), 25);
  assert.equal(S('full', [1, 2, 3, 4, 5]), 0);
});
test('Straßen', () => {
  assert.equal(S('small', [1, 2, 3, 4, 6]), 30);
  assert.equal(S('small', [2, 3, 4, 5, 5]), 30);
  assert.equal(S('small', [3, 4, 5, 6, 3]), 30);
  assert.equal(S('small', [1, 2, 3, 5, 6]), 0);
  assert.equal(S('small', [1, 2, 3, 4, 5]), 30);
  assert.equal(S('large', [1, 2, 3, 4, 5]), 40);
  assert.equal(S('large', [6, 5, 4, 3, 2]), 40);
  assert.equal(S('large', [1, 2, 3, 4, 6]), 0);
  assert.equal(S('large', [1, 2, 3, 4, 4]), 0);
});
test('Fünferpasch und Chance', () => {
  assert.equal(S('five', [2, 2, 2, 2, 2]), 50);
  assert.equal(S('five', [2, 2, 2, 2, 3]), 0);
  assert.equal(S('chance', [1, 2, 3, 4, 6]), 16);
});
test('Ungültige Eingaben in scoreFor ergeben 0', () => {
  assert.equal(S('quatsch', [1, 1, 1, 1, 1]), 0);
  assert.equal(S('ones', null), 0);
  assert.equal(S('ones', [1, 1]), 0);
});
test('Bonus ab 63 oben, Zwischensumme und Gesamtsumme', () => {
  const sh = P.emptySheet();
  Object.assign(sh, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }); // 63
  assert.equal(P.upperSum(sh), 63);
  assert.equal(P.bonusOf(sh), 35);
  sh.chance = 20;
  assert.equal(P.totalOf({ sheet: sh }), 63 + 35 + 20);
  sh.sixes = 12;
  assert.equal(P.bonusOf(sh), 0);
  assert.equal(P.toBonus(sh), 6);
});
test('Kein Bonus für weitere Fünferpasch: nur 50 pro Feld', () => {
  const g = mk(1);
  force(g, [3, 3, 3, 3, 3]);
  P.score(g, 'p0', 'five');
  assert.equal(g.players[0].sheet.five, 50);
  assert.equal(P.totalOf(g.players[0]), 50);
});
test('Würfeln: Reihenfolge, Würfelzahl, Auswahl', () => {
  const g = mk(2);
  assert.equal(P.roll(g, 'p1', null).ok, false);
  assert.equal(P.score(g, 'p0', 'ones').ok, false); // noch nicht gewürfelt
  assert.ok(P.roll(g, 'p0', null, seq(1, 2, 3, 4, 5)).ok);
  assert.deepEqual(g.turn.dice, [1, 2, 3, 4, 5]);
  assert.equal(P.roll(g, 'p0', null).ok, false); // keep fehlt
  assert.equal(P.roll(g, 'p0', [true, true, true, true, true]).ok, false);
  assert.ok(P.roll(g, 'p0', [true, true, false, false, false], seq(6, 6, 6)).ok);
  assert.deepEqual(g.turn.dice, [1, 2, 6, 6, 6]);
  assert.equal(g.turn.rolls, 2);
  assert.ok(P.roll(g, 'p0', [false, false, true, true, true], seq(4, 4)).ok);
  assert.deepEqual(g.turn.dice, [4, 4, 6, 6, 6]);
  assert.equal(P.roll(g, 'p0', [false, false, false, false, false]).ok, false); // 4. Wurf
});
test('Ungültige Meldungen verändern den Zustand nicht', () => {
  const g = mk(2);
  P.roll(g, 'p0', null, seq(1, 1, 1, 1, 1));
  const before = JSON.stringify(g);
  for (const bad of [
    () => P.roll(g, 'p0', 'x'), () => P.roll(g, 'p0', [true]), () => P.roll(g, 'p1', Array(5).fill(false)),
    () => P.score(g, 'p1', 'ones'), () => P.score(g, 'p0', 'nix'), () => P.score(g, 'p0', undefined),
    () => P.score(g, 'p0', '__proto__'), () => P.score(g, 'p0', 'toString'),
  ]) { const r = bad(); assert.equal(r.ok, false); assert.ok(r.error); }
  assert.equal(JSON.stringify(g), before);
});
test('Eintragen: Feld belegt, Streichen mit 0, nächste Person', () => {
  const g = mk(2);
  force(g, [1, 2, 3, 4, 6]);
  assert.ok(P.score(g, 'p0', 'five').ok);
  assert.equal(g.players[0].sheet.five, 0);
  assert.match(g.recap[0], /gestrichen/);
  assert.equal(g.active, 1);
  assert.equal(g.turn.rolls, 0);
  force(g, [1, 1, 1, 1, 1]);
  g.active = 0;
  assert.equal(P.score(g, 'p0', 'five').ok, false); // belegt (auch mit 0)
  assert.equal(g.players[0].sheet.five, 0);
});
test('Eintragen nach 1. Wurf (früh aufhören) erlaubt', () => {
  const g = mk(2);
  P.roll(g, 'p0', null, seq(6, 6, 6, 6, 6));
  assert.ok(P.score(g, 'p0', 'five').ok);
  assert.equal(g.players[0].sheet.five, 50);
  assert.match(g.recap[0], /Fünferpasch – 50 Punkte/);
});
test('Bonus-Hinweis im Rückblick', () => {
  const g = mk(1);
  Object.assign(g.players[0].sheet, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15 }); // 45
  force(g, [6, 6, 6, 1, 2]);
  P.score(g, 'p0', 'sixes');
  assert.ok(g.recap.some((l) => /Bonus/.test(l)));
});
test('Rangliste: Gleichstand teilt den Sieg', () => {
  const g = mk(3);
  g.players[0].sheet.chance = 20; g.players[1].sheet.chance = 20; g.players[2].sheet.chance = 10;
  const w = P.winners(g);
  assert.equal(w.length, 2);
  assert.ok(w.every((r) => r.tie && r.place === 1));
  const r = P.ranking(g);
  assert.equal(r[2].place, 3);
  assert.equal(r[2].tie, false);
});
test('Zustand ist JSON-sicher', () => {
  const g = mk(3);
  P.roll(g, 'p0', null);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});
test('Zufallspartien (400) enden nach 13 Runden mit Invarianten', () => {
  let seed = 12345;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let n = 0; n < 400; n++) {
    const np = 1 + (n % 5);
    const g = mk(np);
    let guard = 0, turns = 0;
    while (g.mode !== 'over' && guard++ < 1000) {
      const id = P.activePlayer(g).id;
      assert.ok(P.roll(g, id, null, rng).ok);
      const extra = Math.floor(rng() * 3);
      for (let k = 0; k < extra; k++) {
        const keep = Array.from({ length: 5 }, () => rng() < 0.5);
        if (keep.every(Boolean)) keep[0] = false;
        assert.ok(P.roll(g, id, keep, rng).ok);
      }
      assert.ok(g.turn.dice.every((v) => Number.isInteger(v) && v >= 1 && v <= 6));
      const free = P.freeCats(P.activePlayer(g).sheet);
      assert.ok(free.length > 0);
      const cat = free[Math.floor(rng() * free.length)];
      const expected = P.scoreFor(cat, g.turn.dice);
      assert.ok(P.score(g, id, cat).ok);
      assert.equal(g.players.find((p) => p.id === id).sheet[cat], expected);
      turns++;
    }
    assert.equal(g.mode, 'over');
    assert.equal(turns, 13 * np);
    for (const p of g.players) {
      assert.equal(P.filledCount(p.sheet), 13);
      const t = P.totalOf(p);
      assert.ok(t >= 0 && t <= 375 + 35 + 50);
    }
    assert.ok(P.winners(g).length >= 1);
    assert.equal(P.roll(g, 'p0', null).ok, false);
  }
});
