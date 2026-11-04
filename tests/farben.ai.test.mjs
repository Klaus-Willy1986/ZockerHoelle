import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../farben/engine.js';
import { chooseAction } from '../farben/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Reiner Zufallsspieler: irgendeine mögliche Wahl, sonst passen
function randomAction(g, id, rng) {
  if (g.phase === 'roll') return { t: 'roll' };
  const p = E.playerById(g, id);
  const opts = [];
  for (let ci = 0; ci < g.dice.c.length; ci++) for (let ni = 0; ni < g.dice.n.length; ni++) {
    if (g.gone.c[ci] || g.gone.n[ni]) continue;
    const cf = g.dice.c[ci]; const nf = g.dice.n[ni];
    if ((cf === 'X' ? 1 : 0) + (nf === '?' ? 1 : 0) > p.jokers) continue;
    for (const color of cf === 'X' ? E.COLORS : [cf]) for (const num of nf === '?' ? [1, 2, 3, 4, 5] : [nf]) {
      for (const cells of E.legalGroups(p.x, color, num)) opts.push({ t: 'pick', ci, ni, color, num, cells });
    }
  }
  if (!opts.length) return { t: 'pass' };
  return opts[Math.floor(rng() * opts.length)];
}

let moves = 0; let ms = 0;
// kinds: 0 (Leicht), 1 (Mittel), 'rand'
function play(kinds, seed) {
  const dice = seedRng(seed * 7 + 1); const brain = seedRng(seed * 13 + 5);
  const g = E.createGame(kinds.map((k, i) => ({ id: 'bot' + (i + 1), name: 'C' + i })));
  let steps = 0;
  while (g.mode === 'play' && steps < 5000) {
    steps++;
    // erste Person, die etwas tun muss
    const ids = g.phase === 'roll' ? [E.activePlayer(g).id] : E.waitingFor(g);
    assert.ok(ids.length, 'jemand muss dran sein');
    const id = ids[0];
    const k = kinds[g.players.findIndex((p) => p.id === id)];
    let msg;
    const t0 = performance.now();
    if (k === 'rand') msg = randomAction(g, id, brain);
    else { msg = chooseAction(g, id, k, brain); ms += performance.now() - t0; moves++; }
    assert.ok(msg, 'Aktion erwartet');
    const r = msg.t === 'roll' ? E.roll(g, id, dice) : msg.t === 'pass' ? E.submit(g, id, null) : E.submit(g, id, { ci: msg.ci, ni: msg.ni, color: msg.color, num: msg.num, cells: msg.cells });
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.equal(g.mode, 'over', 'Partie endet');
  return g;
}

// Siegpunkte für die Person an Platz idx (Alleinsieg 1, Gleichstand anteilig)
function share(g, idx) {
  const w = E.winners(g);
  return w.some((r) => r.id === g.players[idx].id) ? 1 / w.length : 0;
}

function duel(a, b, n, seed0) {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    wins += share(play(kinds, seed0 + i), i % 2 ? 1 : 0);
  }
  return wins / n;
}

test('Mittel schlägt Leicht in mindestens 70 % der 2er-Partien', () => {
  const q = duel(1, 0, 200, 100);
  console.log('Mittel vs Leicht:', (100 * q).toFixed(1) + ' %');
  assert.ok(q >= 0.7, 'Quote ' + q);
});

test('Mittel schlägt reine Zufallsspieler in über 85 % der 2er-Partien', () => {
  const q = duel(1, 'rand', 200, 1000);
  console.log('Mittel vs Zufall:', (100 * q).toFixed(1) + ' %');
  assert.ok(q > 0.85, 'Quote ' + q);
});

test('Leicht gegen Zufall: keine Fehler, Partien enden', () => {
  const q = duel(0, 'rand', 100, 2000);
  console.log('Leicht vs Zufall:', (100 * q).toFixed(1) + ' %');
});

test('3er und 4er Partien gemischt: alles gültig, alle enden', () => {
  for (let i = 0; i < 40; i++) play([1, 0, 'rand'], 3000 + i);
  for (let i = 0; i < 40; i++) play([1, 0, 1, 'rand'], 4000 + i);
  for (let i = 0; i < 20; i++) play([1, 1, 1, 1], 5000 + i);
  for (let i = 0; i < 20; i++) play([0, 0, 0], 6000 + i);
});

test('Rechenzeit pro Zug im Mittel unter 100 ms', () => {
  assert.ok(moves > 500, 'genug Züge gemessen');
  const avg = ms / moves;
  console.log('Rechenzeit je Zug:', avg.toFixed(2), 'ms');
  assert.ok(avg < 100, 'Durchschnitt ' + avg);
});

test('Alleinspiel (30 Würfe): Punkte im Schnitt', () => {
  for (const lvl of [0, 1]) {
    let tot = 0; const N = 100;
    for (let i = 0; i < N; i++) {
      const dice = seedRng(i + 1); const brain = seedRng(i * 3 + 7);
      const g = E.createGame([{ id: 'bot1', name: 'C' }]);
      let guard = 0;
      while (g.mode === 'play' && guard++ < 500) {
        const m = chooseAction(g, 'bot1', lvl, brain);
        assert.ok(m);
        const r = m.t === 'roll' ? E.roll(g, 'bot1', dice) : m.t === 'pass' ? E.submit(g, 'bot1', null) : E.submit(g, 'bot1', m);
        assert.equal(r.ok, true);
      }
      assert.equal(g.mode, 'over');
      tot += E.scoreOf(g.players[0]).total;
    }
    console.log(lvl ? 'Mittel' : 'Leicht', 'Alleinspiel Ø', (tot / N).toFixed(1));
  }
});

test('null, wenn nichts zu tun ist', () => {
  const g = E.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }]);
  assert.equal(chooseAction(g, 'me', 1), null); // nicht am Wurf
  assert.deepEqual(chooseAction(g, 'bot1', 1), { t: 'roll' });
  assert.equal(chooseAction(g, 'unbekannt', 0), null);
  E.roll(g, 'bot1', seedRng(5));
  const m = chooseAction(g, 'bot1', 1, seedRng(2));
  assert.ok(m && m.t !== 'roll');
  E.submit(g, 'bot1', m.t === 'pass' ? null : m);
  assert.equal(chooseAction(g, 'bot1', 1), null); // schon gewählt
  assert.equal(chooseAction(g, 'bot1', 0), null);
  g.mode = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.equal(chooseAction(null, 'bot1', 1), null);
});
