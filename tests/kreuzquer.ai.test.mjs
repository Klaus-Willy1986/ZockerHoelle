import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../kreuzquer/engine.js';
import { chooseAction } from '../kreuzquer/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// wie onMessage in kreuzquer/app.js
function handle(g, pid, msg, dice) {
  if (msg.t === 'roll') return E.roll(g, pid, dice);
  if (msg.t === 'pick') return E.submit(g, pid, msg.move || null);
  return { ok: false, error: 'unbekannt' };
}

// kinds: 0 (Leicht), 1 (Mittel), 'rand' (reiner Zufall). Rückgabe: Gewinner-Indizes (mehrere bei Unentschieden)
function play(kinds, seed) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = E.createGame(kinds.map((k, i) => ({ id: 'bot' + (i + 1), name: 'C' + i })));
  let steps = 0;
  while (g.phase !== 'over' && steps < 5000) {
    steps++;
    const ids = g.phase === 'roll' ? [g.players[g.active].id] : E.waitingFor(g);
    assert.ok(ids.length > 0, 'jemand muss handeln');
    const pid = ids[0];
    const k = kinds[g.players.findIndex((p) => p.id === pid)];
    let msg;
    if (k === 'rand') {
      if (g.phase === 'roll') msg = { t: 'roll' };
      else { const mv = E.legalMoves(g, pid); const i = Math.floor(brain() * (mv.length + 1)); msg = { t: 'pick', move: i < mv.length ? { color: mv[i].color, idx: mv[i].idx } : null }; }
    } else msg = chooseAction(g, pid, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = handle(g, pid, msg, dice);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.phase, 'over', 'Partie endet');
  const rank = E.ranking(g);
  const top = rank[0].total;
  return rank.filter((r) => r.total === top).map((r) => g.players.findIndex((p) => p.id === r.id));
}

// Anteil gewonnener Partien (Unentschieden zählt halb)
function share(kindsFor, target, N, seed0) {
  let pts = 0;
  for (let i = 0; i < N; i++) {
    const kinds = kindsFor(i);
    const w = play(kinds, seed0 + i);
    const mine = w.filter((x) => kinds[x] === target).length;
    if (mine) pts += mine / w.length;
  }
  return pts / N;
}

test('Mittel schlägt Leicht (2 Personen, Startplatz wechselt): >= 70 %', () => {
  const q = share((i) => (i % 2 ? [0, 1] : [1, 0]), 1, 400, 1);
  console.log('Mittel vs Leicht:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.7, 'Quote ' + q);
});

test('Mittel schlägt reinen Zufall (2 Personen): > 85 %', () => {
  const q = share((i) => (i % 2 ? ['rand', 1] : [1, 'rand']), 1, 400, 1000);
  console.log('Mittel vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.85, 'Quote ' + q);
});

test('Leicht schlägt reinen Zufall meistens (2 Personen)', () => {
  const q = share((i) => (i % 2 ? ['rand', 0] : [0, 'rand']), 0, 300, 2000);
  console.log('Leicht vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.5, 'Quote ' + q);
});

test('3 und 4 Personen: alles gültig, alle Partien enden, Mittel vorn', () => {
  for (const n of [3, 4]) {
    const q = share((i) => { const k = Array(n).fill('rand'); k[i % n] = 1; return k; }, 1, 200, 3000 + n * 500);
    console.log(`Mittel vs ${n - 1} Zufall:`, (100 * q).toFixed(1) + ' %');
    assert.ok(q > 0.6, `${n} Personen: ${q}`);
  }
  for (let i = 0; i < 100; i++) play(Array.from({ length: 2 + (i % 3) }, (_, j) => (i + j) % 2), 5000 + i);
});

test('Rechenzeit trivial', () => {
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) play([1, 1, 1, 1], 7000 + i);
  assert.ok(Date.now() - t0 < 5000, 'Zeit ' + (Date.now() - t0));
});

test('null, wenn nichts zu tun ist', () => {
  const g = E.createGame([{ id: 'bot1', name: 'A' }, { id: 'bot2', name: 'B' }, { id: 'me', name: 'M' }]);
  assert.equal(chooseAction(g, 'bot2', 1), null, 'nicht am Zug beim Würfeln');
  assert.deepEqual(chooseAction(g, 'bot1', 0), { t: 'roll' });
  E.roll(g, 'bot1', seedRng(3));
  const waiting = E.waitingFor(g);
  const other = g.players.map((p) => p.id).find((id) => !waiting.includes(id));
  if (other) assert.equal(chooseAction(g, other, 1), null, 'schon gewählt');
  g.phase = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.equal(chooseAction(null, 'bot1', 1), null);
});
