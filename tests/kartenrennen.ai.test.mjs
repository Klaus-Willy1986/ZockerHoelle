import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../kartenrennen/engine.js';
import { chooseAction } from '../kartenrennen/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mkBots = (seed, opts = { swap: true }) => K.createGame([1, 2, 3, 4].map((i) => ({ id: 'bot' + i, name: 'C' + i })), opts, seedRng(seed), null);

// levels: Stufe je Sitz (0 Leicht, 1 Mittel)
function play(levels, seed) {
  const rng = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = mkBots(seed);
  let steps = 0, maxMs = 0;
  while (g.phase !== 'over' && steps < 50000) {
    steps++;
    let acted = false;
    for (const p of g.players) {
      const t0 = performance.now();
      const msg = chooseAction(g, p.id, levels[p.seat], brain);
      maxMs = Math.max(maxMs, performance.now() - t0);
      if (!msg) continue;
      const r = K.handle(g, p.id, msg, rng);
      assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
      acted = true;
      if (g.phase === 'over') break;
    }
    assert.ok(acted, 'Es muss immer jemand handeln können (' + g.phase + ')');
  }
  assert.equal(g.phase, 'over', 'Partie endet');
  return { g, maxMs };
}

test('Mittel (2 Plätze) gegen Leicht (2 Plätze), 200 Spiele mit Sitzwechsel: Mittel gewinnt >= 80 %, alle Partien enden, < 150 ms', () => {
  const N = 200; let mid = 0, maxMs = 0, capped = 0, cards = 0;
  for (let i = 0; i < N; i++) {
    const levels = i % 2 ? [0, 1, 0, 1] : [1, 0, 1, 0];
    const { g, maxMs: ms } = play(levels, i + 1);
    maxMs = Math.max(maxMs, ms);
    cards += g.used;
    if (g.used >= K.CARD_CAP) capped++;
    if (levels[g.winner] === 1) mid++;
  }
  console.log(`Mittel vs Leicht: ${(100 * mid / N).toFixed(1)} % (${mid}/${N}), Kartendeckel ${capped}x, im Schnitt ${(cards / N).toFixed(0)} Karten, langsamste Entscheidung ${maxMs.toFixed(1)} ms`);
  assert.ok(mid / N >= 0.8, 'Quote ' + mid / N);
  assert.ok(maxMs < 150, 'Rechenzeit ' + maxMs);
});

test('Leicht gegen Leicht und Mittel gegen Mittel: Partien enden', () => {
  for (let i = 0; i < 30; i++) play([0, 0, 0, 0], 500 + i);
  for (let i = 0; i < 30; i++) play([1, 1, 1, 1], 600 + i);
});

test('Rechenzeit im schwersten Fall (Joker, Sieben, Bube, 4 Steine) unter 150 ms', () => {
  const g = mkBots(3, { swap: false });
  g.phase = 'play'; g.turn = 0;
  g.players[0].hand = ['JOKER', 'JOKER', 'JOKER', '7', '7', 'BUBE'].map((r) => ({ r, s: r === 'JOKER' ? 4 : 0 }));
  g.players[0].pieces = [3, 10, 20, 30];
  g.players[1].pieces = [1, 40, 50, 60]; g.players[2].pieces = [5, 6, 7, 8]; g.players[3].pieces = [12, 22, 33, 44];
  for (const level of [0, 1]) {
    const t0 = performance.now();
    const msg = chooseAction(g, g.players[0].id, level, seedRng(1));
    const ms = performance.now() - t0;
    console.log(`schwerster Fall, Stufe ${level}: ${ms.toFixed(1)} ms`);
    assert.ok(ms < 150, 'Rechenzeit ' + ms);
    assert.equal(msg.t, 'play');
    const copy = JSON.parse(JSON.stringify(g));
    assert.equal(K.handle(copy, copy.players[0].id, msg).ok, true);
  }
});

test('Kartentausch Mittel: schwache Karte, nie Ass/König/Joker wenn vermeidbar, Partnerin-Wert egal', () => {
  const g = mkBots(4);
  for (const s of [0, 1, 2, 3]) {
    const p = g.players[s];
    p.hand = ['KING', 'ASS', '9', 'JOKER', 'DAME', '3'].map((r) => ({ r, s: 0 }));
    const msg = chooseAction(g, p.id, 1, seedRng(s));
    assert.equal(msg.t, 'swap');
    assert.equal(msg.card.r, '3');
  }
  g.players[0].hand = ['KING', 'ASS', 'JOKER', '7', 'KING', 'BUBE'].map((r) => ({ r, s: 0 }));
  assert.ok(!['KING', 'ASS', 'JOKER'].includes(chooseAction(g, g.players[0].id, 1, seedRng(1)).card.r));
  g.players[0].hand = ['KING', 'ASS', 'JOKER'].map((r) => ({ r, s: 0 }));
  assert.ok(['KING', 'ASS', 'JOKER'].includes(chooseAction(g, g.players[0].id, 1, seedRng(1)).card.r));
  // wer schon gewählt hat, tauscht nicht noch einmal
  g.swapSel[0] = { r: 'KING', s: 0 };
  assert.equal(chooseAction(g, g.players[0].id, 1, seedRng(1)), null);
  // Entscheidung hängt nicht von der Partnerin ab
  const h = mkBots(4);
  h.players[0].hand = ['2', '3', '9'].map((r) => ({ r, s: 0 }));
  const a = chooseAction(h, h.players[0].id, 1, seedRng(9));
  h.players[2].hand = ['ASS', 'ASS', 'ASS'].map((r) => ({ r, s: 0 }));
  assert.deepEqual(chooseAction(h, h.players[0].id, 1, seedRng(9)), a);
});

test('KI schummelt nicht: andere Hände, Stapel und fremde Tauschwahl ändern die Entscheidung nicht', () => {
  let compared = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const rng = seedRng(seed), brain = seedRng(seed + 100);
    const g = mkBots(seed);
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 400) {
      for (const p of g.players) {
        for (const level of [0, 1]) {
          const copy = JSON.parse(JSON.stringify(g));
          // alles Verdeckte der anderen verändern
          const r2 = seedRng(seed * 977 + steps);
          for (const q of copy.players) {
            if (q.id === p.id) continue;
            q.hand = q.hand.map(() => ({ r: K.PLAYABLE_RANKS[Math.floor(r2() * 13)], s: Math.floor(r2() * 4) }));
          }
          copy.deck = copy.deck.map(() => ({ r: 'JOKER', s: 4 }));
          copy.swapSel = copy.swapSel.map((x, i) => (i === p.seat ? x : x ? { r: 'ASS', s: 0 } : null));
          copy.recvd = copy.recvd.map((x, i) => (i === p.seat ? x : null));
          const a = chooseAction(g, p.id, level, seedRng(steps * 3 + level));
          const b = chooseAction(copy, p.id, level, seedRng(steps * 3 + level));
          assert.deepEqual(b, a, `Seed ${seed} Schritt ${steps} Stufe ${level}`);
          if (a) compared++;
        }
        const msg = chooseAction(g, p.id, 1, brain);
        if (msg) { assert.equal(K.handle(g, p.id, msg, rng).ok, true); if (g.phase === 'over') break; }
      }
    }
  }
  console.log('Entscheidungen verglichen:', compared);
  assert.ok(compared > 1000);
});

test('KI: Eingaben außerhalb ihres Zuges ergeben null, kaputte Zustände werfen nicht', () => {
  const g = mkBots(8, { swap: false });
  const other = g.players.find((p) => p.seat !== g.turn);
  assert.equal(chooseAction(g, other.id, 1, Math.random), null);
  assert.equal(chooseAction(g, 'fremd', 1, Math.random), null);
  assert.equal(chooseAction(null, 'x', 1), null);
  assert.equal(chooseAction({}, 'x', 1), null);
  const ap = g.players[g.turn];
  const m = chooseAction(g, ap.id, 1, Math.random);
  assert.ok(m && (m.t === 'play' || m.t === 'discardAll'));
  g.phase = 'over';
  assert.equal(chooseAction(g, ap.id, 1, Math.random), null);
});

test('Mittel nimmt Schlagen von Gegnern und das Ziel mit, vermeidet das Schlagen eigener Steine', () => {
  const g = mkBots(9, { swap: false });
  g.phase = 'play'; g.turn = 0;
  g.players[0].hand = [{ r: '5', s: 0 }];
  g.players[0].pieces = [3, 20, -1, -1]; g.players[0].prot = [false, false, false, false];
  g.players[1].pieces = [(8 - 16 + 64) % 64, -1, -1, -1]; // Feld 8 = Gegner
  g.players[2].pieces = [-1, -1, -1, -1]; g.players[3].pieces = [-1, -1, -1, -1];
  const m = chooseAction(g, g.players[0].id, 1, seedRng(1));
  assert.deepEqual(m.move, { stone: 0, steps: 5 }, 'schlägt den Gegner auf Feld 8');
  // eigener Stein auf dem Zielfeld: lieber den anderen Stein ziehen
  g.players[1].pieces = [-1, -1, -1, -1];
  g.players[0].pieces = [3, 8, -1, -1];
  const m2 = chooseAction(g, g.players[0].id, 1, seedRng(1));
  assert.deepEqual(m2.move, { stone: 1, steps: 5 });
  // Ziel erreichen
  g.players[0].pieces = [60, 30, -1, -1];
  const m3 = chooseAction(g, g.players[0].id, 1, seedRng(1));
  assert.deepEqual(m3.move, { stone: 0, steps: 5 });
});
