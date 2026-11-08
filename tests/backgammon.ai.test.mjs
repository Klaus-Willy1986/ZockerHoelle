import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../backgammon/engine.js';
import { chooseAction } from '../backgammon/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P2 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const val = (v) => (v - 1) / 6 + 0.01;

let maxMs = 0;
// kinds: [kindOfPlayer0, kindOfPlayer1], jeweils 0 (Leicht), 1 (Mittel) oder 'rand' (reiner Zufall)
function play(kinds, seed) {
  const dice = seedRng(seed * 7 + 1); const brain = seedRng(seed * 13 + 5);
  const g = P.createGame(P2, { one: true }, dice);
  let steps = 0;
  while (g.mode === 'play' && steps < 20000) {
    steps++;
    const id = g.players[g.turn].id;
    const k = kinds[g.turn];
    let msg;
    if (k === 'rand') {
      if (g.stage === 'roll') msg = { t: 'roll' };
      else { const m = P.legalMoves(g); const c = m[Math.floor(brain() * m.length)]; msg = { t: 'move', from: c.from, to: c.to, die: c.die }; }
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, id, k, brain);
      maxMs = Math.max(maxMs, performance.now() - t0);
    }
    assert.ok(msg, 'Aktion erwartet');
    const r = P.handle(g, id, msg, dice);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.mode, 'over');
  return g.winner;
}
// Anteil Siege von „a“ gegen „b“ mit Startwechsel
function share(a, b, n) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const winner = play(swap ? [b, a] : [a, b], i + 1);
    if ((winner === 0) !== swap) w++;
  }
  return w / n;
}

test('Mittel gewinnt >= 90 % gegen Zufall (200 Spiele, Startwechsel)', () => {
  const r = share(1, 'rand', 200);
  console.log('Mittel gegen Zufall:', (r * 100).toFixed(1), '%');
  assert.ok(r >= 0.9, 'Anteil ' + r);
});

test('Mittel gewinnt >= 70 % gegen Leicht (200 Spiele, Startwechsel)', () => {
  const r = share(1, 0, 200);
  console.log('Mittel gegen Leicht:', (r * 100).toFixed(1), '%');
  assert.ok(r >= 0.7, 'Anteil ' + r);
});

test('Leicht ist spielbar und schlägt Zufall überwiegend nicht (nur Plausibilität: alle Züge legal)', () => {
  const r = share(0, 'rand', 60);
  console.log('Leicht gegen Zufall:', (r * 100).toFixed(1), '%');
  assert.ok(r > 0.4);
});

test('Rechenzeit unter 150 ms, auch bei Pasch und Bar', () => {
  console.log('längste Entscheidung in den Spielen:', maxMs.toFixed(1), 'ms');
  assert.ok(maxMs < 150, 'maxMs ' + maxMs);
  let worst = 0;
  for (const d of [1, 2, 3, 4, 5, 6]) {
    const g = P.createGame(P2, {}, () => 0.3);
    g.turn = 0; g.stage = 'roll'; g.left = [];
    P.handle(g, 'a', { t: 'roll' }, () => val(d));
    const t0 = performance.now();
    const m = chooseAction(g, 'a', 1, () => 0.5);
    worst = Math.max(worst, performance.now() - t0);
    assert.equal(P.handle(g, 'a', m).ok, true);
  }
  console.log('Pasch-Eröffnung, schlechtester Wert:', worst.toFixed(1), 'ms');
  assert.ok(worst < 150);
});

test('Computer verändert den Zustand nicht und kennt nur das offene Brett (gleiche Entscheidung bei gleichem Zufall)', () => {
  for (let n = 0; n < 40; n++) {
    const dice = seedRng(n + 3);
    const g = P.createGame(P2, {}, dice);
    for (let k = 0; k < 30 && g.mode === 'play'; k++) {
      const id = g.players[g.turn].id;
      const before = JSON.stringify(g);
      const m1 = chooseAction(g, id, 1, seedRng(5));
      assert.equal(JSON.stringify(g), before, 'Zustand unverändert');
      // Zusatzfelder, die nichts mit dem Brett zu tun haben, ändern nichts
      const h = JSON.parse(before); h.recap = ['x']; h.opening = null;
      const m2 = chooseAction(h, id, 1, seedRng(5));
      assert.deepEqual(m1, m2);
      // Leicht liefert ebenfalls eine legale Aktion
      const e = chooseAction(g, id, 0, seedRng(k));
      assert.ok(e);
      if (g.stage === 'move') assert.ok(P.legalMoves(g).some((x) => x.from === e.from && x.to === e.to && x.die === e.die));
      P.handle(g, id, m1, dice);
    }
  }
  const g = P.createGame(P2, {}, seedRng(1));
  assert.equal(chooseAction(g, g.players[1 - g.turn].id, 1), null, 'nur wer dran ist');
  assert.equal(chooseAction(g, 'zz', 1), null);
  assert.equal(chooseAction(null, 'a', 1), null);
  g.mode = 'over';
  assert.equal(chooseAction(g, 'a', 1), null);
});

test('Leicht schlägt einen Blot in etwa der Hälfte der Fälle oder öfter', () => {
  let hits = 0; const N = 400;
  for (let i = 0; i < N; i++) {
    const g = P.createGame(P2, {}, seedRng(1));
    const h = Array(26).fill(0); h[13] = 5; h[8] = 3; h[6] = 5; h[24] = 2;
    const d = Array(26).fill(0); d[10] = 1; d[19] = 5; d[17] = 3; d[12] = 5; d[1] = 1; // Blot auf Dunkel-Spitze 10 (= Hell 15) und Spitze 1 (= Hell 24? dort stehen eigene)
    // Dunkel-Blot auf Hell-Spitze 11 (Dunkel 14)
    d[10] = 0; d[14] = 1; d[12] = 4; d[1] = 0; d[19] += 1;
    g.board = [h, d]; g.turn = 0; g.stage = 'move'; g.mode = 'play'; g.left = [2, 4]; g.rollId = 100 + i; g.gid = i;
    g.lastRoll = { p: 0, dice: [2, 4], rollId: g.rollId };
    // Schlagzug: 13->11 mit 2 ist möglich
    const rng = seedRng(i + 1);
    let hit = false;
    for (let k = 0; k < 2 && g.mode === 'play' && g.turn === 0; k++) {
      const m = chooseAction(g, 'a', 0, rng);
      if (m.to === 11) hit = true;
      P.handle(g, 'a', m);
    }
    if (hit) hits++;
  }
  console.log('Leicht schlägt Blot:', hits, 'von', N);
  assert.ok(hits / N >= 0.45, 'Quote ' + hits / N);
});
