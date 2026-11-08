import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../vier/engine.js';
import { chooseAction } from '../vier/ai.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ids = ['p0', 'p1'];
const mk = (big = false) => M.createGame([{ id: 'p0', name: 'Eins' }, { id: 'p1', name: 'Zwei' }], { big });
const timing = { n: 0, ms: 0, max: 0 };

// Spieler: { level } | { random: true }. Ergebnis aus Sicht von Spieler 0: 1, 0.5, 0.
function playGame(p0, p1, rng, big = false) {
  const g = mk(big);
  const pl = [p0, p1];
  let guard = 0;
  while (g.mode === 'play' && guard++ < 100) {
    const i = g.turn;
    const p = pl[i];
    let msg;
    if (p.random) {
      const acts = M.legalActions(g);
      msg = acts[Math.floor(rng() * acts.length)];
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, ids[i], p.level, rng);
      const dt = performance.now() - t0;
      timing.n++; timing.ms += dt; timing.max = Math.max(timing.max, dt);
    }
    assert.ok(msg, 'keine Nachricht');
    const r = M.handle(g, ids[i], msg);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
  }
  assert.equal(g.mode, 'over', 'Partie endet nicht');
  return g.winner === null ? 0.5 : g.winner === 0 ? 1 : 0;
}
// Abwechselnd beginnen (Seitenwechsel); Ergebnis aus Sicht von a
function series(a, b, n, seed, big = false) {
  const rng = mulberry(seed);
  const res = { win: 0, loss: 0, draw: 0 };
  for (let k = 0; k < n; k++) {
    const swap = k % 2 === 1;
    const r = swap ? 1 - playGame(b, a, rng, big) : playGame(a, b, rng, big);
    if (r === 1) res.win++; else if (r === 0) res.loss++; else res.draw++;
  }
  return res;
}
const quote = (r, n) => (r.win + 0.5 * r.draw) / n;

test('Mittel gewinnt >= 95 % gegen Zufall (200 Partien, Seitenwechsel)', () => {
  const r = series({ level: 1 }, { random: true }, 200, 11);
  console.log('Mittel vs. Zufall', r);
  assert.ok(r.win / 200 >= 0.95, JSON.stringify(r));
});
test('Mittel gewinnt >= 80 % gegen Leicht (200 Partien, Seitenwechsel)', () => {
  const r = series({ level: 1 }, { level: 0 }, 200, 22);
  console.log('Mittel vs. Leicht', r);
  assert.ok(r.win / 200 >= 0.8, JSON.stringify(r));
});
test('Leicht ist schlagbarer als Mittel und schlägt Zufall überwiegend', () => {
  const r = series({ level: 0 }, { random: true }, 200, 33);
  console.log('Leicht vs. Zufall', r);
  assert.ok(r.win / 200 >= 0.7, JSON.stringify(r));
});
test('Mittel auf dem großen Brett (8×7) schlägt Zufall und Leicht', () => {
  const a = series({ level: 1 }, { random: true }, 40, 44, true);
  const b = series({ level: 1 }, { level: 0 }, 40, 55, true);
  console.log('8×7: Mittel vs. Zufall', a, 'Mittel vs. Leicht', b);
  assert.ok(a.win / 40 >= 0.9 && b.win / 40 >= 0.8);
});

test('Rechenzeit pro Zug < 150 ms (Mittel, beide Brettgrößen, auch auf leerem Brett)', () => {
  const g = mk();
  let t0 = performance.now();
  chooseAction(g, 'p0', 1, mulberry(1));
  assert.ok(performance.now() - t0 < 150);
  const gb = mk(true);
  t0 = performance.now();
  chooseAction(gb, 'p0', 1, mulberry(1));
  assert.ok(performance.now() - t0 < 150);
  series({ level: 1 }, { level: 1 }, 10, 66);
  series({ level: 1 }, { level: 1 }, 6, 67, true);
  console.log(`Rechenzeit Mittel: ${timing.n} Züge, Mittel ${(timing.ms / timing.n).toFixed(1)} ms, Maximum ${timing.max.toFixed(1)} ms`);
  assert.ok(timing.max < 150, 'Maximum ' + timing.max);
});

test('Leicht und Mittel nehmen einen sofortigen Gewinn mit', () => {
  for (const level of [0, 1]) for (let seed = 1; seed <= 30; seed++) {
    const g = mk();
    // Gelb hat drei unten in 1,2,3; Rot hat 0 und 6 oben drauf
    M.handle(g, 'p0', { t: 'drop', c: 1 }); M.handle(g, 'p1', { t: 'drop', c: 6 });
    M.handle(g, 'p0', { t: 'drop', c: 2 }); M.handle(g, 'p1', { t: 'drop', c: 6 });
    M.handle(g, 'p0', { t: 'drop', c: 3 }); M.handle(g, 'p1', { t: 'drop', c: 0 });
    // Gelb ist dran und gewinnt mit 4 (Reihe 1-4) – oder 0 ist besetzt von Rot
    const a = chooseAction(g, 'p0', level, mulberry(seed));
    assert.equal(a.c, 4, `Level ${level}: ${JSON.stringify(a)}`);
  }
});
test('Mittel blockt einen sofortigen Gegnergewinn (immer), Leicht in etwa der Hälfte der Fälle', () => {
  const setup = () => {
    const g = mk();
    // Rot (p1) hat drei senkrecht in Spalte 5; Gelb ist am Zug und hat keinen eigenen Gewinn
    M.handle(g, 'p0', { t: 'drop', c: 0 }); M.handle(g, 'p1', { t: 'drop', c: 5 });
    M.handle(g, 'p0', { t: 'drop', c: 1 }); M.handle(g, 'p1', { t: 'drop', c: 5 });
    M.handle(g, 'p0', { t: 'drop', c: 0 }); M.handle(g, 'p1', { t: 'drop', c: 5 });
    return g;
  };
  for (let seed = 1; seed <= 40; seed++) assert.equal(chooseAction(setup(), 'p0', 1, mulberry(seed), { ms: 400 }).c, 5, 'Mittel blockt');
  // Mittel ohne Zufallszug (rng nie < 0,1) blockt sicher
  let blocked = 0; const N = 600;
  const rng = mulberry(99);
  for (let i = 0; i < N; i++) if (chooseAction(setup(), 'p0', 0, rng).c === 5) blocked++;
  console.log('Leicht blockt', blocked, 'von', N);
  // 50 % Block + Zufallsspalte (1/7): erwartet ca. 0,5 + 0,5/7 = 57 %
  assert.ok(blocked / N > 0.45 && blocked / N < 0.7, 'Anteil ' + blocked / N);
});

test('Mittel macht nie einen Zug, der sofort verliert, wenn es andere gibt (auch beim Zufallszug)', () => {
  const rng = mulberry(7);
  let checked = 0;
  for (let k = 0; k < 150; k++) {
    const g = mk(k % 3 === 0);
    while (g.mode === 'play') {
      const i = g.turn;
      if (i === 0) {
        const a = chooseAction(g, 'p0', 1, rng, { ms: 15 });
        // verliert dieser Zug sofort? (Gegner kann darauf gewinnen und es gab einen Zug ohne diese Folge)
        const losing = (c) => {
          const h = JSON.parse(JSON.stringify(g));
          if (!M.drop(h, 'p0', c).ok || h.mode === 'over') return false;
          return M.legalActions(h).some((m) => { const x = JSON.parse(JSON.stringify(h)); M.drop(x, 'p1', m.c); return x.winner === 1; });
        };
        const alt = M.legalActions(g).some((m) => !losing(m.c));
        const wins = M.legalActions(g).some((m) => { const x = JSON.parse(JSON.stringify(g)); M.drop(x, 'p0', m.c); return x.winner === 0; });
        if (alt) { assert.ok(!losing(a.c) || wins, 'verlierender Zug obwohl Alternative'); checked++; }
        M.handle(g, 'p0', a);
      } else {
        const acts = M.legalActions(g);
        M.handle(g, 'p1', acts[Math.floor(rng() * acts.length)]);
      }
    }
  }
  assert.ok(checked > 500, 'geprüft ' + checked);
});

test('Computer schummelt nicht und nutzt nur das Brett: gleiche Entscheidung bei verändertem Rest des Zustands', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = mulberry(seed);
    const g = mk(seed % 5 === 0);
    for (let n = 0; n < seed % 14; n++) { const a = M.legalActions(g); if (g.mode !== 'play') break; M.handle(g, ids[g.turn], a[Math.floor(rng() * a.length)]); }
    if (g.mode !== 'play') continue;
    const me = ids[g.turn];
    const g2 = JSON.parse(JSON.stringify(g));
    g2.scores = [99, 0]; g2.recap = ['x']; g2.round = 9; g2.starter = 1 - g.starter; g2.last = null; g2.endReason = 'zzz'; g2.moveNo = 77;
    for (const level of [0, 1]) {
      const a = chooseAction(g, me, level, mulberry(seed + 1000), { ms: 5000 });
      const b = chooseAction(g2, me, level, mulberry(seed + 1000), { ms: 5000 });
      assert.deepEqual(a, b, `Level ${level}, Seed ${seed}`);
    }
  }
});

test('Zustand bleibt unverändert; ungültige Eingaben liefern null; Zug ist immer erlaubt', () => {
  const g = mk();
  M.handle(g, 'p0', { t: 'drop', c: 3 });
  const snap = JSON.stringify(g);
  assert.equal(chooseAction(g, 'p0', 1, Math.random), null, 'nicht am Zug');
  assert.equal(chooseAction(g, 'fremd', 1, Math.random), null);
  assert.equal(chooseAction(null, 'p1', 1), null);
  assert.equal(chooseAction({}, 'p1', 1), null);
  chooseAction(g, 'p1', 1, Math.random); chooseAction(g, 'p1', 0, Math.random);
  assert.equal(JSON.stringify(g), snap);
  // Fast volles Brett: nur eine Spalte frei
  const h = mk();
  const rng = mulberry(5);
  while (h.mode === 'play' && M.openCols(h).length > 1) { const a = M.legalActions(h); const m = a[Math.floor(rng() * a.length)]; M.handle(h, ids[h.turn], m); }
  if (h.mode === 'play') for (const level of [0, 1]) assert.equal(chooseAction(h, ids[h.turn], level, rng).c, M.openCols(h)[0]);
});
