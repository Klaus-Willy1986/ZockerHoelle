import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../phasen/engine.js';

const d = (v, c = 'B') => ({ v, c });
const dice = (...vs) => vs.map((v) => (typeof v === 'object' ? v : d(v)));
const mk = (n = 3) => P.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
const force = (g, vals, phaseNo) => {
  const t = g.turn; t.stage = 'choose'; t.attempt = 1; t.started = true;
  t.dice = vals; t.kept = Array(10).fill(false); t.eval = P.evaluate(vals, phaseNo);
};

test('Anleitung: Phase 3 Beispiel 9-9-9-9-5-4-W-2-9-W = 47 Punkte', () => {
  const r = P.evaluate(dice(9, 9, 9, 9, 5, 4, 'W', 2, 9, 'W'), 3);
  assert.equal(r.ok, true);
  assert.equal(r.score, 47);
});
test('Anleitung: Phase 1 mit 8-8-8 / 8-8-W', () => {
  const r = P.evaluate(dice(8, 8, 8, 8, 8, 'W', 1, 2, 3, 4), 1);
  assert.equal(r.ok, true);
  assert.equal(r.score, 40);
});
test('Anleitung: Phase 4 mit 10-9-8-7-6-5-4 oder mit Joker', () => {
  assert.ok(P.evaluate(dice(10, 9, 8, 7, 6, 5, 4, 1, 1, 1), 4).ok);
  const j = P.evaluate(dice(7, 6, 'W', 4, 3, 'W', 1, 1, 1, 1), 4);
  assert.ok(j.ok);
  assert.equal(j.score, 7 + 6 + 4 + 3 + 1); // 1-3-4-6-7 echt, W ersetzen 5 und 2 -> Folge 1..7
});
test('Folge braucht verschiedene aufeinanderfolgende Zahlen', () => {
  assert.equal(P.evaluate(dice(5, 5, 6, 7, 8, 9, 10, 1, 2, 3), 4).ok, false); // 5-10 = nur 6 Zahlen (+1,2,3 getrennt)
  assert.equal(P.evaluate(dice(1, 2, 3, 4, 5, 6, 7, 10, 10, 10), 4).ok, true);
});
test('Farbphase: Joker zählt nur in eigener Farbe', () => {
  const blue7 = dice(d(5, 'B'), d(6, 'B'), d(7, 'B'), d(8, 'B'), d(9, 'B'), d(10, 'B'), d('W', 'B'), d(1, 'R'), d(2, 'R'), d(3, 'G'));
  const r = P.evaluate(blue7, 8);
  assert.equal(r.ok, true);
  assert.equal(r.score, 5 + 6 + 7 + 8 + 9 + 10);
  const fremd = dice(d(5, 'B'), d(6, 'B'), d(7, 'B'), d(8, 'B'), d(9, 'B'), d(10, 'B'), d('W', 'R'), d(1, 'R'), d(2, 'R'), d(3, 'G'));
  assert.equal(P.evaluate(fremd, 8).ok, false);
});
test('Nur Joker reichen für eine Kombination; Phase 9 und 10', () => {
  assert.ok(P.evaluate(dice('W', 'W', 'W', 'W', 6, 6, 6, 6, 2, 3), 9).ok);
  assert.equal(P.evaluate(dice(7, 7, 7, 7, 7, 3, 3, 3, 1, 2), 10).score, 35 + 9);
  assert.equal(P.evaluate(dice(7, 7, 7, 7, 7, 3, 3, 1, 1, 2), 10).ok, false);
});
test('Würfel: 6 Würfel 5-10, 4 Würfel 1-4 und zweimal W', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) for (let k = 0; k < 10; k++) seen.add(`${k < 6 ? 'H' : 'L'}${P.rollDie(k).v}`);
  for (const v of [5, 6, 7, 8, 9, 10]) assert.ok(seen.has('H' + v));
  for (const v of [1, 2, 3, 4, 'W']) assert.ok(seen.has('L' + v));
  assert.ok(!seen.has('H1') && !seen.has('L5') && !seen.has('LW' + 'x'));
});
test('Zug: 3 Versuche, Fehlschlag wiederholt die Phase', () => {
  const g = mk(2);
  let c = 0;
  const rng = () => ((c++ % 6) / 6) + 0.01; // lauter verschiedene Zahlen: Phase 1 ist nie erfüllt
  assert.ok(P.roll(g, 'p0', null, rng).ok);
  assert.equal(g.turn.attempt, 1);
  assert.equal(P.roll(g, 'p1', null).ok, false);
  assert.equal(P.finish(g, 'p0', true).ok, false); // noch Würfe übrig
  assert.ok(P.roll(g, 'p0', Array(10).fill(false), rng).ok);
  assert.ok(P.roll(g, 'p0', Array(10).fill(false), rng).ok);
  assert.equal(P.roll(g, 'p0', Array(10).fill(false)).ok, false);
  assert.ok(P.finish(g, 'p0').ok);
  assert.equal(g.players[0].phaseNo, 1);
  assert.equal(g.active, 1);
});
test('Phase notieren, freiwillig nicht notieren', () => {
  const g = mk(2);
  force(g, dice(8, 8, 8, 5, 5, 5, 1, 2, 3, 4), 1);
  P.finish(g, 'p0', false);
  assert.equal(g.players[0].phaseNo, 1);
  assert.equal(g.players[0].scores[0], null);
  force(g, dice(8, 8, 8, 5, 5, 5, 1, 2, 3, 4), 1); g.active = 0;
  P.finish(g, 'p0', true);
  assert.equal(g.players[0].phaseNo, 2);
  assert.equal(g.players[0].scores[0], 39);
});
test('5-Phasen-Bonus ab 221 Punkten, sonst 0', () => {
  const g = mk(2);
  const p = g.players[0];
  p.phaseNo = 5; p.scores = [40, 40, 40, 40, null, null, null, null, null, null]; // 160
  force(g, dice(1, 2, 3, 4, 5, 6, 7, 8, 10, 10), 5); // Achterfolge 1-8 = 36 -> 196 <221
  P.finish(g, 'p0');
  assert.equal(p.bonus5, 0);
  const h = mk(2);
  const q = h.players[0];
  q.phaseNo = 5; q.scores = [60, 60, 50, 40, null, null, null, null, null, null]; // 210
  force(h, dice(3, 4, 5, 6, 7, 8, 9, 10, 1, 1), 5); // 3..10 = 52 -> 262
  P.finish(h, 'p0');
  assert.equal(q.bonus5, 40);
});
test('Anleitung: Beispiel A-E zum 10-Phasen-Bonus und Spielende am Stück', () => {
  const g = mk(5); // A=p0 ... E=p4
  const pl = g.players;
  pl[0].phaseNo = 10; pl[1].phaseNo = 10; pl[2].phaseNo = 8; pl[3].phaseNo = 7; pl[4].phaseNo = 10;
  g.active = 1; g.turn = { stage: 'roll', attempt: 0, dice: null, kept: null, eval: null, startPhase: 10, final: false, started: false };
  force(g, dice(5, 5, 5, 5, 5, 6, 6, 6, 1, 2), 10);
  P.finish(g, 'p1');
  assert.equal(g.mode, 'final');
  assert.equal(pl[1].bonus10, 40);
  assert.deepEqual(g.queue, [2, 3, 4, 0]);
  // C (p2) in Phase 8 schafft 8, 9 und 10 am Stück, bekommt aber keinen Bonus
  force(g, dice(...[5, 6, 7, 8, 9, 10].map((v) => d(v, 'R')), d(1, 'R'), d(2, 'G'), d(3, 'G'), d(4, 'G')), 8);
  P.finish(g, 'p2');
  assert.equal(pl[2].phaseNo, 9);
  assert.equal(g.active, 2);
  assert.equal(g.turn.stage, 'roll');
  force(g, dice(9, 9, 9, 9, 9, 2, 2, 1, 3, 4), 9); P.finish(g, 'p2');
  force(g, dice(9, 9, 9, 9, 9, 2, 2, 2, 3, 4), 10); P.finish(g, 'p2');
  assert.equal(pl[2].phaseNo, 11);
  assert.equal(pl[2].bonus10, 0);
  // D (p3) scheitert an Phase 7 -> Spiel für D endet
  g.turn.stage = 'choose'; g.turn.attempt = 3; g.turn.dice = dice(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); g.turn.eval = P.evaluate(g.turn.dice, 7);
  P.finish(g, 'p3');
  assert.equal(pl[3].stopped, true);
  // E (p4) in Phase 10, nach B in derselben Runde -> Bonus
  assert.equal(g.active, 4);
  force(g, dice(4, 4, 4, 4, 4, 2, 2, 2, 1, 1), 10); g.turn.startPhase = 10;
  P.finish(g, 'p4');
  assert.equal(pl[4].bonus10, 40);
  // A (p0) ist bereits in der nächsten Runde -> kein Bonus
  assert.equal(g.active, 0);
  force(g, dice(4, 4, 4, 4, 4, 2, 2, 2, 1, 1), 10); g.turn.startPhase = 10;
  P.finish(g, 'p0');
  assert.equal(pl[0].bonus10, 0);
  assert.equal(g.mode, 'over');
  const rk = P.ranking(g);
  assert.equal(rk[rk.length - 1].id, 'p3');
});
test('Zufallspartien mit Vorschlags-Hilfe enden immer', () => {
  for (let n = 0; n < 60; n++) {
    const g = mk(2 + (n % 3));
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 50000) {
      const id = P.activePlayer(g).id;
      let keep = null;
      assert.ok(P.roll(g, id, null).ok);
      while (g.turn.attempt < 3 && !g.turn.eval.ok) {
        const k = Array(10).fill(false);
        for (const i of P.suggestKeep(g.turn.dice, P.activePlayer(g).phaseNo)) k[i] = true;
        if (k.every(Boolean)) k[0] = false;
        assert.ok(P.roll(g, id, k).ok);
      }
      assert.ok(P.finish(g, id, true).ok);
    }
    assert.equal(g.mode, 'over');
    const rk = P.ranking(g);
    assert.ok(rk[0].finished);
  }
});
