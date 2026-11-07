import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../wenig/engine.js';
import { chooseAction, makeView, legalMoves } from '../wenig/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Zufallsspieler: zufällige legale Aktion (gleichverteilt unter allen erlaubten Nachrichten)
function randomAction(g, id, rng) {
  const idx = g.players.findIndex((p) => p.id === id);
  if (g.phase === 'reveal') return chooseAction(g, id, 0, rng); // Aufdecken: zufällige Karte
  if (g.active !== idx) return null;
  const l = legalMoves(makeView(g, idx));
  return l[Math.min(l.length - 1, Math.floor(rng() * l.length))];
}
const act = (g, id, kind, rng) => (kind === 'rand' ? randomAction(g, id, rng) : chooseAction(g, id, kind, rng));

// Ganzes Spiel bis 100 Punkte; Rückgabe: Indizes der Sieger (kann mehrere sein)
function game(kinds, seed, opts = {}) {
  const deal = seedRng(seed * 7 + 1);
  const brain = seedRng(seed * 13 + 5);
  const g = M.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), opts, deal);
  let steps = 0;
  while (g.phase !== 'over') {
    assert.ok(steps++ < 100000, 'Spiel endet nicht');
    if (g.phase === 'round') { assert.equal(M.handle(g, g.hostId, { t: 'next' }, deal).ok, true); continue; }
    if (g.phase === 'reveal') {
      for (let i = 0; i < kinds.length; i++) {
        const m = act(g, 'bot' + i, kinds[i], brain);
        if (m) assert.equal(M.handle(g, 'bot' + i, m, deal).ok, true);
      }
      continue;
    }
    const id = g.players[g.active].id;
    const m = act(g, id, kinds[g.active], brain);
    assert.ok(m, 'Aktion erwartet');
    const r = M.handle(g, id, m, deal);
    assert.equal(r.ok, true, JSON.stringify(m) + ' ' + r.error);
  }
  return M.ranking(g).filter((x) => x.winner).map((x) => x.idx);
}

// 2 Personen, Startwechsel; Anteil der Spiele, die `a` allein gewinnt (Geteilter Sieg zählt nicht als Sieg)
function duel(a, b, N, seed0, opts) {
  let wa = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    const w = game(kinds, seed0 + i, opts);
    if (w.length === 1 && kinds[w[0]] === a) wa++;
  }
  return wa / N;
}

test('Mittel gewinnt >= 75 % gegen Leicht (200 Spiele bis 100 Punkte, 2 Personen, Startwechsel)', () => {
  const q = duel(1, 0, 200, 1);
  console.log('  Mittel vs Leicht:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.75, 'Quote ' + q);
});

test('Mittel gewinnt >= 90 % gegen einen Zufallsspieler (200 Spiele)', () => {
  const q = duel(1, 'rand', 200, 5000);
  console.log('  Mittel vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.9, 'Quote ' + q);
});

test('Leicht ist besser als Zufall (nicht völlig sinnlos)', () => {
  const q = duel(0, 'rand', 100, 9000);
  console.log('  Leicht vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.5, 'Quote ' + q);
});

test('Mittel auch ohne Verdoppelung und zu viert stark gegen Leicht', () => {
  const q = duel(1, 0, 100, 300, { double: false });
  console.log('  Mittel vs Leicht ohne Verdoppelung:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.75, 'Quote ' + q);
  let mid = 0; const N = 80;
  for (let i = 0; i < N; i++) {
    const kinds = [0, 0, 0, 0]; kinds[i % 4] = 1;
    const w = game(kinds, 700 + i);
    if (w.length === 1 && w[0] === i % 4) mid++;
  }
  console.log('  Mittel vs 3x Leicht (Fairness 25 %):', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N > 0.5, 'Quote ' + mid / N);
});

test('Rechenzeit pro Entscheidung < 100 ms (auch bei 8 Personen)', () => {
  let worst = 0; let n = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seedRng(seed);
    const g = M.createGame(Array.from({ length: seed % 2 ? 8 : 3 }, (_, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, rng);
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 4000) {
      if (g.phase === 'round') { M.handle(g, g.hostId, { t: 'next' }, rng); continue; }
      const ids = g.phase === 'reveal' ? g.players.map((p) => p.id) : [g.players[g.active].id];
      for (const id of ids) {
        const t0 = performance.now();
        const m = chooseAction(g, id, 1, rng);
        worst = Math.max(worst, performance.now() - t0); n++;
        if (m) M.handle(g, id, m, rng);
      }
    }
  }
  console.log(`  ${n} Entscheidungen, langsamste ${worst.toFixed(2)} ms`);
  assert.ok(worst < 100, 'zu langsam: ' + worst);
});

test('Der Computer gibt nur gültige Nachrichten aus und nichts, wenn er nicht dran ist', () => {
  const rng = seedRng(3);
  const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }, { id: 'me', name: 'Du' }], {}, rng);
  assert.equal(chooseAction(g, 'me', 1, rng) && chooseAction(g, 'me', 1, rng).t, 'reveal');
  assert.equal(chooseAction(g, 'nobody', 1, rng), null);
  assert.equal(chooseAction(null, 'bot0', 1, rng), null);
  for (const id of ['bot0', 'bot1']) for (let k = 0; k < 2; k++) M.handle(g, id, chooseAction(g, id, 1, rng), rng);
  assert.equal(chooseAction(g, 'bot0', 1, rng), null, 'schon zwei aufgedeckt');
  for (let k = 0; k < 2; k++) M.handle(g, 'me', chooseAction(g, 'me', 0, rng), rng);
  assert.equal(g.phase, 'play');
  const notActive = g.players.filter((_, i) => i !== g.active).map((p) => p.id);
  for (const id of notActive) assert.equal(chooseAction(g, id, 1, rng), null);
});

// ---------- keine Schummelei ----------
// Verändert alles, was der Computer nicht sehen darf (verdeckte Karten aller Personen, Stapelinhalt, Ablage unter der obersten Karte),
// und prüft, dass er mit denselben Zufallszahlen genau dieselbe Entscheidung trifft.
function scramble(g, rng) {
  const h = JSON.parse(JSON.stringify(g));
  const pool = [];
  for (const p of h.players) p.grid.forEach((c) => { if (c && !c.up) pool.push(c); });
  for (const c of pool) c.v = Math.floor(rng() * 15) - 2;
  h.deck = h.deck.map(() => Math.floor(rng() * 15) - 2);
  for (let i = 0; i < h.discard.length - 1; i++) h.discard[i] = Math.floor(rng() * 15) - 2;
  return h;
}
test('KI nutzt keine verdeckten Karten: veränderter Zustand liefert dieselbe Entscheidung (Leicht und Mittel)', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seedRng(seed);
    const n = 2 + (seed % 4);
    const g = M.createGame(Array.from({ length: n }, (_, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, rng);
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 800) {
      if (g.phase === 'round') { M.handle(g, g.hostId, { t: 'next' }, rng); continue; }
      const ids = g.phase === 'reveal' ? g.players.map((p) => p.id) : [g.players[g.active].id];
      for (const id of ids) {
        for (const level of [0, 1]) {
          for (let k = 0; k < 2; k++) {
            const h = scramble(g, seedRng(seed * 31 + steps + k));
            const a = chooseAction(g, id, level, seedRng(steps * 17 + seed));
            const b = chooseAction(h, id, level, seedRng(steps * 17 + seed));
            assert.deepEqual(b, a, `Entscheidung hängt von verdeckten Karten ab (Stufe ${level}, Seed ${seed}, Schritt ${steps})`);
            checked++;
          }
        }
        const m = chooseAction(g, id, 1, rng);
        if (m) M.handle(g, id, m, rng);
      }
    }
  }
  console.log('  verglichene Entscheidungen:', checked);
  assert.ok(checked > 3000);
});

test('makeView enthält nirgends den Wert einer verdeckten Karte und nichts vom Stapel', () => {
  const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(2));
  g.players[1].grid[3].v = 11; // ein auffälliger Wert
  const v = makeView(g, 0);
  const json = JSON.stringify(v);
  for (const p of v.players) for (const c of p.grid) if (c && !c.up) assert.deepEqual(Object.keys(c), ['up']);
  assert.equal(typeof v.deckLen, 'number');
  assert.ok(!('deck' in v) && !('discard' in v));
  assert.ok(Array.isArray(v.players[1].gone));
  assert.ok(json.length < 2500);
  // gezogene Karte sieht nur die ziehende Person
  const h = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(2));
  for (const p of h.players) { M.handle(h, p.id, { t: 'reveal', i: 0 }); M.handle(h, p.id, { t: 'reveal', i: 1 }); }
  M.handle(h, h.players[h.active].id, { t: 'draw' });
  assert.equal(makeView(h, h.active).drawn, h.turn.drawn);
  assert.equal(makeView(h, 1 - h.active).drawn, null);
});
