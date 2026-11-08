import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schwimmen/engine.js';
import { chooseAction } from '../schwimmen/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Spielt ein ganzes Spiel bis zum Ausscheiden. kinds[i] = Stufe (0/1). Gibt den Index des Siegers (oder -1 bei Unentschieden) zurück.
function playGame(kinds, seed) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, deal);
  let steps = 0;
  while (steps < 100000) {
    if (g.phase === 'over') {
      if (g.result.final) break;
      assert.equal(M.handle(g, g.hostId, { t: 'next' }, deal).ok, true);
      continue;
    }
    steps++;
    const ap = M.activePlayer(g);
    const msg = chooseAction(g, ap.id, kinds[g.active], brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = M.handle(g, ap.id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.phase, 'over');
  assert.ok(g.result.final, 'Spiel endet');
  return g.result.draw ? -1 : g.players.findIndex((p) => p.id === g.result.champions[0]);
}

test('Mittel gewinnt >= 55 % gegen 2x Leicht (3 Personen, 200 Spiele, Sitzwechsel; Zufall wäre 33 %)', () => {
  let mid = 0, draws = 0; const N = 200;
  for (let i = 0; i < N; i++) {
    const kinds = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][i % 3];
    const w = playGame(kinds, 300 + i);
    if (w < 0) draws++; else if (kinds[w] === 1) mid++;
  }
  console.log('Mittel vs 2x Leicht (3er):', (100 * mid / N).toFixed(1) + ' %', 'Unentschieden', draws);
  assert.ok(mid / N >= 0.55, 'Quote ' + mid / N);
});

test('Mittel gegen 2x Leicht, große Stichprobe (1000 Spiele): >= 57 %', () => {
  let mid = 0; const N = 1000;
  for (let i = 0; i < N; i++) {
    const kinds = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][i % 3];
    const w = playGame(kinds, 20000 + i);
    if (w >= 0 && kinds[w] === 1) mid++;
  }
  console.log('Mittel vs 2x Leicht (3er, 1000 Spiele):', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N >= 0.57, 'Quote ' + mid / N);
});

test('Mittel gewinnt >= 65 % gegen Leicht (2 Personen, 200 Spiele, Sitzwechsel)', () => {
  let mid = 0; const N = 200;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [0, 1] : [1, 0];
    const w = playGame(kinds, 900 + i);
    if (w >= 0 && kinds[w] === 1) mid++;
  }
  console.log('Mittel vs Leicht (2er):', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N >= 0.65, 'Quote ' + mid / N);
});

test('Spiele mit 4-6 Computern enden immer', () => {
  for (let n = 4; n <= 6; n++) for (let i = 0; i < 20; i++) playGame(Array.from({ length: n }, (_, k) => (k + i) % 2), 5000 + n * 100 + i);
});

test('Rechenzeit pro Entscheidung < 150 ms', () => {
  const rng = seedRng(3);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }, { id: 'bot2', name: 'C' }], {}, rng);
    for (let lv = 0; lv < 2; lv++) {
      const t = performance.now();
      chooseAction(g, M.activePlayer(g).id, lv, rng);
      worst = Math.max(worst, performance.now() - t);
    }
  }
  console.log('längste Rechenzeit (ms):', worst.toFixed(2));
  assert.ok(worst < 150);
});

test('KI schummelt nicht: fremde Hände und Stapel ändern die Entscheidung nicht', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const deal = seedRng(seed);
    const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }, { id: 'bot2', name: 'C' }], {}, deal);
    // ein paar Züge spielen, damit verschiedene Lagen entstehen
    for (let k = 0; k < seed % 7 && g.phase === 'play'; k++) M.handle(g, M.activePlayer(g).id, chooseAction(g, M.activePlayer(g).id, k % 2, deal), deal);
    if (g.phase !== 'play') continue;
    const ap = M.activePlayer(g);
    for (const lv of [0, 1]) {
      const base = chooseAction(g, ap.id, lv, seedRng(seed + 77));
      const h = JSON.parse(JSON.stringify(g));
      // fremde Hände und Stapel kräftig verändern (Karten vertauschen / mischen)
      const fake = seedRng(seed + 999);
      const others = h.players.filter((p) => p.id !== ap.id);
      const pool = [...h.deck, ...others.flatMap((p) => p.hand)];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(fake() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      let k = 0;
      for (const p of others) p.hand = p.hand.map(() => pool[k++]);
      h.deck = pool.slice(k);
      assert.deepEqual(chooseAction(h, ap.id, lv, seedRng(seed + 77)), base, `seed ${seed} Stufe ${lv}`);
    }
  }
});

test('Nur wer am Zug ist bekommt eine Aktion; gültige Aktionen in jeder Lage', () => {
  const rng = seedRng(11);
  const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, rng);
  assert.equal(chooseAction(g, 'bot1', 1, rng), null);
  assert.equal(chooseAction(g, 'nobody', 1, rng), null);
  assert.equal(chooseAction(null, 'bot0', 1, rng), null);
  assert.ok(chooseAction(g, 'bot0', 1, rng));
});

test('Mittel sagt 31 an und tauscht zu 31, wenn möglich; klopft ab 27', () => {
  const rng = seedRng(5);
  const mk = () => M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, rng);
  let g = mk();
  g.players[0].hand = [{ s: 2, r: 7 }, { s: 2, r: 3 }, { s: 2, r: 6 }];
  assert.deepEqual(chooseAction(g, 'bot0', 1, rng), { t: 'call31' });
  g = mk();
  g.players[0].hand = [{ s: 2, r: 7 }, { s: 2, r: 3 }, { s: 0, r: 0 }];
  g.table = [{ s: 1, r: 1 }, { s: 2, r: 5 }, { s: 3, r: 2 }];
  assert.deepEqual(chooseAction(g, 'bot0', 1, rng), { t: 'swap1', hand: 2, table: 1 });
  g = mk();
  g.players[0].hand = [{ s: 2, r: 7 }, { s: 2, r: 3 }, { s: 0, r: 0 }]; // 21
  g.table = [{ s: 1, r: 1 }, { s: 3, r: 5 }, { s: 3, r: 2 }];
  g.players[0].hand = [{ s: 2, r: 7 }, { s: 2, r: 3 }, { s: 2, r: 2 }]; // 30
  g.table = [{ s: 1, r: 1 }, { s: 3, r: 5 }, { s: 3, r: 0 }];
  assert.deepEqual(chooseAction(g, 'bot0', 1, rng), { t: 'knock' });
});
