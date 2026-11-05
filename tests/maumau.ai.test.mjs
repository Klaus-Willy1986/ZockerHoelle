import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../maumau/engine.js';
import { chooseAction } from '../maumau/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Zufallsspieler: wählt gleichverteilt unter allen erlaubten Nachrichten, auch beim „Mau“-Ruf (Münzwurf)
function randomAction(g, id, rng) {
  if (g.turn.forced === 'seven') return { t: 'draw' };
  if (g.turn.forced === 'eight') return { t: 'skip' };
  const legal = M.legalCards(g, id);
  if (!legal.length) return g.turn.drew ? { t: 'pass' } : { t: 'draw' };
  return { t: 'play', card: legal[Math.floor(rng() * legal.length)], wish: Math.floor(rng() * 4), call: rng() < 0.5 };
}

// kinds: 0 = Leicht, 1 = Mittel, 'rand' = Zufall. Eine Runde; Gewinner-Index.
function play(kinds, seed, opts = {}) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), opts, deal);
  let steps = 0;
  while (g.phase === 'play' && steps < 5000) {
    steps++;
    const ap = M.activePlayer(g);
    const k = kinds[g.active];
    const msg = k === 'rand' ? randomAction(g, ap.id, brain) : chooseAction(g, ap.id, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = M.handle(g, ap.id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.phase, 'over', 'Runde endet');
  return g.players.findIndex((p) => p.id === g.result.winner);
}

// Zweier-Partien: abwechselnde Startplätze; Best-of-2 pro Paarung wird als Einzelrunden gezählt
function duel(a, b, N, seed0, opts) {
  let wa = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    const w = play(kinds, seed0 + i, opts);
    if (kinds[w] === a) wa++;
  }
  return wa / N;
}

test('Mittel schlägt Leicht in >= 60 % der Runden (2 Personen)', () => {
  const q = duel(1, 0, 1000, 1);
  console.log('Mittel vs Leicht (2er):', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.6, 'Quote ' + q);
});

test('Mittel schlägt Leicht auch zu dritt und mit Ass-Option', () => {
  let mid = 0, N = 600;
  for (let i = 0; i < N; i++) {
    const kinds = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][i % 3];
    if (kinds[play(kinds, 500 + i, { ace: i % 2 === 0 })] === 1) mid++;
  }
  console.log('Mittel vs 2x Leicht (3er, Fairness 33 %):', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N > 0.4, 'Quote ' + mid / N);
});

test('Mittel schlägt den Zufall in > 75 % (2er)', () => {
  const q = duel(1, 'rand', 1000, 10000);
  console.log('Mittel vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.75, 'Quote ' + q);
});

test('Mittel gegen einen Zufallsspieler, der nie etwas vergisst: spürbar besser als 50 %', () => {
  // Obergrenze durch Glück: selbst eine Monte-Carlo-Suche kommt hier nur auf etwa 63-65 %
  let mid = 0; const N = 1000;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? ['rand', 1] : [1, 'rand'];
    const deal = seedRng(40000 + i), brain = seedRng(i + 3);
    const g = M.createGame(kinds.map((k, j) => ({ id: 'bot' + j, name: 'C' + j })), {}, deal);
    let st = 0;
    while (g.phase === 'play' && st++ < 5000) {
      const ap = M.activePlayer(g);
      let msg = kinds[g.active] === 'rand' ? randomAction(g, ap.id, brain) : chooseAction(g, ap.id, 1, brain);
      if (msg.t === 'play' && kinds[g.active] === 'rand') msg = { ...msg, call: true };
      assert.equal(M.handle(g, ap.id, msg, deal).ok, true);
    }
    if (kinds[g.players.findIndex((p) => p.id === g.result.winner)] === 1) mid++;
  }
  console.log('Mittel vs Zufall (ruft immer):', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N > 0.57, 'Quote ' + mid / N);
});

test('Leicht gegen Zufall: Partien enden, alles gültig', () => {
  const q = duel(0, 'rand', 400, 30000);
  console.log('Leicht vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.3);
});

test('2-6 Computer (gemischt), mit und ohne Option: alle Nachrichten gültig, alle enden', () => {
  let seed = 90000;
  for (let n = 2; n <= 6; n++) {
    for (const opts of [{}, { ace: true }, { auto: true }]) {
      for (let i = 0; i < 25; i++) {
        const kinds = Array.from({ length: n }, (_, k) => (k + i) % 3 === 0 ? 'rand' : (k + i) % 3 === 1 ? 1 : 0);
        play(kinds, seed++, opts);
      }
    }
  }
});

test('Leicht vergisst Mau in etwa 15 % der Fälle, Mittel nie', () => {
  const g = M.createGame([{ id: 'bot1', name: 'A' }, { id: 'bot2', name: 'B' }], {}, seedRng(4));
  const rng = seedRng(9);
  let forgot = 0; const N = 2000;
  for (let i = 0; i < N; i++) { const m = chooseAction(g, 'bot1', 0, rng); if (m.t === 'play' && !m.call) forgot++; else if (m.t === 'draw') forgot += 0; }
  const rate = forgot / N;
  console.log('Leicht vergisst:', (100 * rate).toFixed(1) + ' %');
  assert.ok(rate > 0.08 && rate < 0.22, 'Rate ' + rate);
  for (let i = 0; i < 200; i++) { const m = chooseAction(g, 'bot1', 1, rng); if (m.t === 'play') assert.equal(m.call, true); }
});

test('Mittel: Bube nur im Notfall, 7 bei kleiner Kartenzahl des Gegners, Wunsch = häufigste Farbe', () => {
  const g = M.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], {}, seedRng(1));
  g.discard = [{ s: 2, r: 2 }];
  g.players[0].hand = [{ s: 0, r: 4 }, { s: 2, r: 5 }, { s: 1, r: 1 }, { s: 1, r: 6 }, { s: 1, r: 7 }];
  const m = chooseAction(g, 'bot1', 1, seedRng(2));
  assert.deepEqual(m.card, { s: 2, r: 5 }, 'keinen Buben, wenn eine andere Karte passt');
  g.players[0].hand = [{ s: 0, r: 4 }, { s: 1, r: 6 }, { s: 1, r: 1 }, { s: 1, r: 7 }];
  const j = chooseAction(g, 'bot1', 1, seedRng(2));
  assert.deepEqual(j.card, { s: 0, r: 4 });
  assert.equal(j.wish, 1, 'wünscht Pik, die häufigste Farbe');
  // 7 gegen Gegner mit 2 Karten
  g.players[1].hand = [{ s: 3, r: 3 }, { s: 3, r: 2 }];
  g.discard = [{ s: 0, r: 2 }];
  g.players[0].hand = [{ s: 0, r: 0 }, { s: 0, r: 5 }, { s: 1, r: 2 }, { s: 3, r: 6 }];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(2)).card, { s: 0, r: 0 });
});

test('Pflichtaktionen: Ziehen, Aussetzen, Behalten; sonst null', () => {
  const g = M.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], {}, seedRng(1));
  assert.equal(chooseAction(g, 'me', 1), null); // nicht dran
  g.turn.forced = 'seven';
  assert.deepEqual(chooseAction(g, 'bot1', 1), { t: 'draw' });
  g.turn.forced = 'eight';
  assert.deepEqual(chooseAction(g, 'bot1', 0), { t: 'skip' });
  g.turn.forced = null;
  g.discard = [{ s: 0, r: 0 }];
  g.players[0].hand = [{ s: 2, r: 5 }, { s: 3, r: 6 }];
  assert.deepEqual(chooseAction(g, 'bot1', 1), { t: 'draw' });
  g.phase = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.equal(chooseAction(null, 'bot1', 1), null);
});

test('Rechenzeit trivial', () => {
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) play([1, 1, 0, 1], 70000 + i);
  assert.ok(Date.now() - t0 < 5000, 'Zeit ' + (Date.now() - t0));
});
