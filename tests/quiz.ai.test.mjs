import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../quiz/engine.js';
import { chooseAction, thinkDelay, DELAY_MIN, DELAY_MAX } from '../quiz/ai.js';
import { FRAGEN } from './quiz.fixture.mjs';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const players = [{ id: 'a', name: 'A' }, { id: 'bot1', name: 'Computer' }];
const oneQ = (q) => Q.createGame(players, { host: 'a', fixed: [q, q] }, seedRng(1), []);
const byType = (t) => FRAGEN.filter((q) => q.t === t);
const N = 6000;

// Trefferquote einer Stufe bei einem Fragetyp
function rate(type, level, seed) {
  const rng = seedRng(seed);
  const qs = byType(type);
  let hit = 0; let elems = 0;
  for (let i = 0; i < N; i++) {
    const q = qs[i % qs.length];
    const g = oneQ(q);
    const m = chooseAction(g, 'bot1', level, rng);
    assert.ok(m && m.t === 'answer');
    if (type === 'mc' || type === 'tf') hit += m.v === q.c ? 1 : 0;
    else { hit += m.v.filter((v, k) => v === k).length; elems += 4; }
  }
  return hit / (type === 'order' ? elems : N);
}
const near = (x, target, msg) => assert.ok(Math.abs(x - target) <= 0.08, `${msg}: ${x.toFixed(3)} statt ${target} ±0,08`);

test('Trefferquoten mc: Leicht 45 %, Mittel 70 %', () => {
  near(rate('mc', 0, 1), 0.45, 'mc Leicht');
  near(rate('mc', 1, 2), 0.7, 'mc Mittel');
});
test('Trefferquoten tf: Leicht 45 %, Mittel 80 %', () => {
  near(rate('tf', 0, 3), 0.45, 'tf Leicht');
  near(rate('tf', 1, 4), 0.8, 'tf Mittel');
});
test('Reihenfolge: je Element Leicht 40 %, Mittel 70 %', () => {
  near(rate('order', 0, 5), 0.4, 'order Leicht');
  near(rate('order', 1, 6), 0.7, 'order Mittel');
});

test('Falsche mc-Antworten sind geraten mit Vorliebe für die oberen Antworten, aber alle kommen vor', () => {
  const rng = seedRng(9);
  const cnt = [0, 0, 0, 0];
  for (let i = 0; i < 8000; i++) {
    const q = { ...byType('mc')[0], c: 3 };
    const m = chooseAction(oneQ(q), 'bot1', 0, rng);
    if (m.v !== 3) cnt[m.v]++;
  }
  assert.ok(cnt[0] > cnt[1] && cnt[1] > cnt[2] && cnt[2] > 0);
});

test('Schätzen: Fehler begrenzt (Leicht ±50 %, Mittel ±15 % von c), Mittel genauer als Leicht', () => {
  const q = { id: 'e', k: 'allg', t: 'est', d: 1, q: 'Wie viel?', c: 1000, unit: 'm', min: 0, max: 5000 };
  const st = Q.estStep(q);
  const run = (level, seed) => {
    const rng = seedRng(seed);
    let sum = 0; let max = 0; let min = Infinity; let maxV = -Infinity;
    for (let i = 0; i < 3000; i++) {
      const m = chooseAction(oneQ(q), 'bot1', level, rng);
      assert.equal(typeof m.v, 'number');
      assert.ok(m.v >= q.min && m.v <= q.max);
      const d = Math.abs(m.v - q.c);
      sum += d; max = Math.max(max, d);
    }
    return { mean: sum / 3000, max };
  };
  const easy = run(0, 1); const mid = run(1, 2);
  assert.ok(mid.max <= 150 + st, `Mittel max ${mid.max}`);
  assert.ok(easy.max <= 500 + st, `Leicht max ${easy.max}`);
  assert.ok(easy.max > 300, 'Leicht streut weit');
  assert.ok(mid.mean < easy.mean * 0.6, `Mittel ${mid.mean} vs Leicht ${easy.mean}`);
  assert.ok(mid.mean > 20 && easy.mean > 100, 'nicht immer exakt');
});

test('Schätzen: Werte bleiben im Bereich (Jahreszahlen, c nahe 0)', () => {
  const rng = seedRng(4);
  for (const q of byType('est').concat([{ id: 'n', k: 'allg', t: 'est', d: 1, q: '?', c: 0, unit: '', min: 0, max: 100 }])) {
    for (let i = 0; i < 300; i++) for (const lv of [0, 1]) {
      const m = chooseAction(oneQ(q), 'bot1', lv, rng);
      assert.ok(Q.handle(oneQ(q), 'bot1', m).ok, `${q.q} ${m.v}`);
    }
  }
});

test('Antworten sind immer gültig und werden vom Spiel angenommen (alle Typen, beide Stufen)', () => {
  const rng = seedRng(8);
  for (const q of FRAGEN) for (const lv of [0, 1]) {
    const g = oneQ(q);
    const m = chooseAction(g, 'bot1', lv, rng);
    assert.equal(m.q, 0);
    assert.ok(Q.handle(g, 'bot1', m).ok, `${q.id} ${JSON.stringify(m)}`);
  }
});

test('Computer liest/ändert den Zustand nicht, nutzt keinen Joker und antwortet nur einmal', () => {
  const g = Q.createGame(players, { host: 'a', len: 12 }, seedRng(3), FRAGEN);
  const before = JSON.stringify(g);
  const m = chooseAction(g, 'bot1', 1, seedRng(1));
  assert.equal(JSON.stringify(g), before);
  assert.equal(m.t, 'answer');
  assert.ok(Q.handle(g, 'bot1', m).ok);
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)), null, 'schon geantwortet');
  assert.equal(chooseAction(g, 'unbekannt', 1, seedRng(1)), null);
  assert.equal(g.jokerUsed.bot1, undefined);
  Q.handle(g, 'a', { t: 'answer', v: g.qs[0].t === 'order' ? [0, 1, 2, 3] : g.qs[0].t === 'est' ? g.qs[0].c : g.qs[0].t === 'mc' ? 0 : true });
  assert.equal(g.phase, 'reveal');
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)), null, 'nicht in der Auflösung');
  for (const bad of [null, undefined, {}, { game: 'qz' }, { game: 'qz', phase: 'over' }]) assert.equal(chooseAction(bad, 'bot1', 0, Math.random), null);
});

test('Antwortverzögerung liegt zwischen 2 und 6 Sekunden', () => {
  assert.equal(DELAY_MIN, 2000);
  assert.equal(DELAY_MAX, 6000);
  const rng = seedRng(5);
  let min = Infinity; let max = 0; let sum = 0;
  for (let i = 0; i < 5000; i++) { const d = thinkDelay(rng); min = Math.min(min, d); max = Math.max(max, d); sum += d; }
  assert.ok(min >= 2000 && max <= 6000, `${min}..${max}`);
  assert.ok(min < 2200 && max > 5800, 'Bereich wird ausgenutzt');
  assert.ok(Math.abs(sum / 5000 - 4000) < 150);
  assert.equal(thinkDelay(() => 0), 2000);
  assert.equal(thinkDelay(() => 0.999999), 6000);
  const d = thinkDelay();
  assert.ok(d >= 2000 && d <= 6000);
});

test('Ganzes Quiz gegen 3 Computer läuft durch und liefert eine Rangliste', () => {
  const ps = [{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C1' }, { id: 'bot2', name: 'C2' }, { id: 'bot3', name: 'C3' }];
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seedRng(seed);
    const g = Q.createGame(ps, { host: 'a', len: 12 }, rng, FRAGEN);
    while (g.phase !== 'over') {
      if (g.phase === 'ask') {
        for (const p of ps) {
          if (p.id === 'a') { const q = g.qs[g.qi]; Q.handle(g, 'a', { t: 'answer', v: q.t === 'order' ? [0, 1, 2, 3] : q.t === 'mc' ? 0 : q.t === 'tf' ? true : q.c }); } else {
            const m = chooseAction(g, p.id, p.id === 'bot3' ? 1 : 0, rng);
            if (m) assert.ok(Q.handle(g, p.id, m).ok);
          }
        }
      } else Q.handle(g, 'a', { t: 'next' });
    }
    assert.equal(Q.ranking(g).length, 4);
  }
});

test('Mittel schlägt Leicht im Durchschnitt über viele Quizrunden', () => {
  const ps = [{ id: 'bot1', name: 'L' }, { id: 'bot2', name: 'M' }];
  let l = 0; let m = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seedRng(seed);
    const g = Q.createGame(ps, { host: 'bot1', len: 20 }, rng, FRAGEN);
    while (g.phase !== 'over') {
      if (g.phase === 'ask') {
        Q.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng));
        Q.handle(g, 'bot2', chooseAction(g, 'bot2', 1, rng));
      } else Q.handle(g, 'bot1', { t: 'next' });
    }
    l += g.scores.bot1; m += g.scores.bot2;
  }
  assert.ok(m > l * 1.3, `Mittel ${m / 60} vs Leicht ${l / 60}`);
});
