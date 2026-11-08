import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../galgen/engine.js';
import { chooseAction, candidates } from '../galgen/ai.js';
import { WOERTER } from '../galgen/woerter.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Ein Computer allein löst ein Wort (8 Fehler); liefert { solved, worst (ms) }
function solveOne(level, rng, extra = {}) {
  const g = G.createGame([{ id: 'bot1', name: 'Computer' }], { rounds: 1, ...extra }, rng);
  let worst = 0; let n = 0;
  while (g.phase === 'play' && n++ < 100) {
    const t0 = performance.now();
    const m = chooseAction(g, 'bot1', level, rng);
    worst = Math.max(worst, performance.now() - t0);
    assert.ok(G.handle(g, 'bot1', m, rng).ok, JSON.stringify(m));
  }
  assert.notEqual(g.phase, 'play');
  return { solved: g.solved, worst };
}
function rate(level, N, seed) {
  const rng = seedRng(seed); let s = 0; let worst = 0;
  for (let i = 0; i < N; i++) { const r = solveOne(level, rng); if (r.solved) s++; worst = Math.max(worst, r.worst); }
  return { rate: s / N, worst };
}

test('Mittel löst >= 85 % der Wörter (200 Runden, 8 Fehler)', () => {
  const r = rate(1, 200, 21);
  console.log('Mittel', JSON.stringify(r));
  assert.ok(r.rate >= 0.85, 'Quote ' + r.rate);
  assert.ok(r.worst < 150, 'Rechenzeit ' + r.worst);
});

test('Leicht löst >= 50 % der Wörter (200 Runden, 8 Fehler), aber weniger als Mittel', () => {
  const r = rate(0, 200, 22);
  const m = rate(1, 200, 22);
  console.log('Leicht', JSON.stringify(r));
  assert.ok(r.rate >= 0.5, 'Quote ' + r.rate);
  assert.ok(r.rate < m.rate);
  assert.ok(r.worst < 150);
  // mehrere andere Startwerte: Quote bleibt robust
  for (const seed of [5, 6, 7]) assert.ok(rate(0, 200, seed).rate >= 0.5, 'Seed ' + seed);
});

test('Mittel rät das Wort, sobald nur ein Listenwort passt; Leicht rät nie das Wort', () => {
  const g = G.createGame([{ id: 'bot1', name: 'C' }], { rounds: 1, words: [{ w: 'KOALA', k: 'tiere' }] }, seedRng(1));
  let sawWord = false;
  while (g.phase === 'play') {
    const c = candidates(g);
    const m = chooseAction(g, 'bot1', 1, seedRng(2));
    if (c.length === 1) { assert.equal(m.t, 'word'); assert.equal(m.w, c[0]); sawWord = true; } else assert.equal(m.t, 'letter');
    G.handle(g, 'bot1', m);
  }
  assert.ok(sawWord && g.solved);
  for (let i = 0; i < 100; i++) {
    const h = G.createGame([{ id: 'bot1', name: 'C' }], { rounds: 1 }, seedRng(i));
    while (h.phase === 'play') { const m = chooseAction(h, 'bot1', 0, seedRng(i + 1000)); assert.equal(m.t, 'letter'); G.handle(h, 'bot1', m); }
  }
});

test('Der Computer schummelt nicht: Entscheidung hängt nur von Öffentlichem ab (Wort und Kategorie getauscht)', () => {
  const rng = seedRng(4);
  for (let i = 0; i < 300; i++) {
    const g = G.createGame([{ id: 'bot1', name: 'C' }, { id: 'p', name: 'P' }], { rounds: 1, host: 'p' }, rng);
    // ein paar Züge, dann Wort vertauschen gegen ein anderes, das zur Maske und zu den Fehlversuchen passt
    for (let k = 0; k < Math.floor(rng() * 4) && g.phase === 'play'; k++) {
      const free = G.KEYS.filter((x) => !g.guessed.includes(x));
      G.handle(g, G.current(g).id, { t: 'letter', l: free[Math.floor(rng() * free.length)] });
    }
    if (g.phase !== 'play') continue;
    g.turn = 0;
    const alt = candidates(g).filter((w) => w !== g.word);
    const copy = JSON.parse(JSON.stringify(g));
    if (alt.length) { copy.word = alt[Math.floor(rng() * alt.length)]; copy.cat = 'musik'; }
    copy.cat = copy.cat === g.cat ? 'musik' : copy.cat;
    for (const level of [0, 1]) {
      assert.deepEqual(chooseAction(g, 'bot1', level, seedRng(i)), chooseAction(copy, 'bot1', level, seedRng(i)), 'Stufe ' + level);
    }
  }
});

test('KI wirft nie bei kaputten Eingaben und antwortet nur, wenn sie dran ist', () => {
  const g = G.createGame([{ id: 'bot1', name: 'C' }, { id: 'p', name: 'P' }], {}, seedRng(1));
  assert.equal(chooseAction(null, 'bot1', 0), null);
  assert.equal(chooseAction({}, 'bot1', 0), null);
  assert.equal(chooseAction(g, 'p', 0), null);
  assert.equal(chooseAction(g, 'nobody', 1), null);
  g.phase = 'reveal'; assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.ok(WOERTER.length > 0);
});
