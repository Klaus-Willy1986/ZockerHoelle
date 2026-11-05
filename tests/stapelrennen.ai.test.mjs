import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../stapelrennen/engine.js';
import { chooseAction } from '../stapelrennen/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Zufallsspieler: legt mit 60 % eine zufällige mögliche Karte, sonst wirft er zufällig ab.
function randomAction(g, brain) {
  const plays = P.legalPlays(g, g.active);
  if (plays.length && brain() < 0.6) { const m = plays[Math.floor(brain() * plays.length)]; return { t: 'play', from: m.from, i: m.i, to: m.to }; }
  const p = g.players[g.active];
  return { t: 'discard', i: Math.floor(brain() * p.hand.length), to: Math.floor(brain() * 4) };
}

// kinds: Array aus 0 (Leicht), 1 (Mittel), 'rand'. Gibt { winner, steps, g } zurück.
function play(kinds, seed) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = P.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), {}, deal);
  let steps = 0;
  while (g.mode === 'play' && steps < 30000) {
    steps++;
    const ap = P.activePlayer(g);
    const k = kinds[g.active];
    const msg = k === 'rand' ? randomAction(g, brain) : chooseAction(g, ap.id, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = P.handle(g, ap.id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.mode, 'over', 'Partie endet');
  return { winner: g.winner, steps, g };
}

// Gewinnquote von `a` gegen `b` (Startplätze wechseln).
function winRate(a, b, N, base) {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    const r = play(kinds, base + i);
    w += r.winner === (i % 2 ? 1 : 0) ? 1 : 0;
  }
  return w / N;
}

test('Mittel gegen Leicht, 2 Personen: >= 70 %', () => {
  const q = winRate(1, 0, 300, 1);
  console.log('Mittel vs Leicht:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.7, 'Quote ' + q);
});

test('Mittel gegen Zufall (2er): > 80 %', () => {
  const q = winRate(1, 'rand', 300, 1000);
  console.log('Mittel vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.8, 'Quote ' + q);
});

test('Leicht gegen Zufall: Partien enden, Leicht ist nicht chancenlos und nicht übermächtig', () => {
  const q = winRate(0, 'rand', 150, 3000);
  console.log('Leicht vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.3 && q < 0.95);
});

test('Mittel gegen Mittel: ausgeglichen (Startplatz entscheidet nicht)', () => {
  const q = winRate(1, 1, 200, 4000);
  console.log('Mittel vs Mittel (Platz 1):', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.3 && q < 0.7);
});

test('Partien mit 3 bis 6 Personen (gemischt): alles gültig, alle enden', () => {
  for (let i = 0; i < 30; i++) play([1, 0, 'rand'], 7000 + i);
  for (let i = 0; i < 20; i++) play([1, 0, 1, 'rand'], 8000 + i);
  for (let i = 0; i < 10; i++) play([1, 1, 0, 0, 'rand'], 9000 + i);
  for (let i = 0; i < 10; i++) play([0, 0, 0, 1, 1, 0], 9500 + i);
});

test('Spiellänge: Mittel braucht erkennbar weniger Aktionen als Leicht', () => {
  const avg = (k, base) => { let s = 0; const N = 40; for (let i = 0; i < N; i++) s += play([k, k], base + i).steps; return s / N; };
  const mid = avg(1, 100), low = avg(0, 200);
  console.log('Aktionen je Partie, Mittel:', mid.toFixed(0), 'Leicht:', low.toFixed(0));
  assert.ok(mid < low);
});

test('null, wenn nicht am Zug oder Spiel vorbei; Rechenzeit trivial', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], {}, seedRng(3));
  assert.equal(chooseAction(g, 'me', 1), null);
  assert.equal(chooseAction(g, 'me', 0), null);
  assert.ok(chooseAction(g, 'bot1', 1));
  assert.equal(chooseAction(null, 'bot1', 1), null);
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) assert.ok(chooseAction(g, 'bot1', i % 2, seedRng(i)));
  assert.ok((Date.now() - t0) / 200 < 20, 'je Aktion < 20 ms');
  g.mode = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
});

test('Aktionen des Computers sind immer gültig und ändern den Zustand um genau eine Aktion', () => {
  for (let lvl = 0; lvl <= 1; lvl++) {
    const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'bot2', name: 'B' }], {}, seedRng(40 + lvl));
    const rng = seedRng(5 + lvl);
    let n = 0;
    while (g.mode === 'play' && n++ < 20000) {
      const seq = g.seq;
      const m = chooseAction(g, P.activePlayer(g).id, lvl, rng);
      assert.ok(m.t === 'play' || m.t === 'discard');
      assert.equal(P.handle(g, P.activePlayer(g).id, m, rng).ok, true);
      assert.equal(g.seq, seq + 1);
    }
    assert.equal(g.mode, 'over');
  }
});

test('Mittel: Spielerstapel zuerst; wirft keinen Joker ab, solange es Alternativen gibt', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'x', name: 'B' }], {}, seedRng(1));
  const p = g.players[0];
  p.pile = [4, 1];
  p.hand = [0, 9, 9, 9, 9];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(1)), { t: 'play', from: 'pile', i: 0, to: 0 });
  p.pile = [4, 7];
  const m = chooseAction(g, 'bot1', 1, seedRng(1));
  assert.equal(m.t, 'discard');
  assert.notEqual(p.hand[m.i], 0, 'kein Joker');
  // nur Joker auf der Hand: er muss abgeworfen werden
  p.hand = [0];
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)).t, 'discard');
  // Kette: Aufbaustapel hat 1, auf dem Spielerstapel liegt die 4, in der Hand 2 und 3 -> 2 legen
  p.pile = [9, 4];
  g.build[0] = [1];
  p.hand = [2, 3, 9, 9, 9];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(1)), { t: 'play', from: 'hand', i: 0, to: 0 });
  // Lücke: Joker darf die Lücke schließen, wenn es sonst nicht klappt
  p.hand = [3, 0, 9, 9, 9];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(1)), { t: 'play', from: 'hand', i: 1, to: 0 });
  // Lücke ohne Ersatz: nichts spielen, abwerfen
  p.hand = [3, 8, 9, 9, 9];
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)).t, 'discard');
});

test('Mittel: wirft möglichst auf gleiche oder größere Karte ab', () => {
  const g = P.createGame([{ id: 'bot1', name: 'A' }, { id: 'x', name: 'B' }], {}, seedRng(1));
  const p = g.players[0];
  p.pile = [12, 12];
  p.hand = [5, 11, 11, 11, 11];
  p.aux = [[9], [5], [], [7]];
  const m = chooseAction(g, 'bot1', 1, seedRng(1));
  assert.deepEqual(m, { t: 'discard', i: 0, to: 1 }, 'die 5 kommt auf die 5');
  p.hand = [6];
  p.aux = [[9], [5], [], [7]];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(1)), { t: 'discard', i: 0, to: 3 }, 'die 6 kommt auf die 7');
});
