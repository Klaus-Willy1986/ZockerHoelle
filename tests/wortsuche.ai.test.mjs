import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wortsuche/engine.js';
import { chooseAction, thinkDelay, DELAYS } from '../wortsuche/ai.js';

const seeded = (s) => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const BOTS = [{ id: 'bot1', name: 'Computer 1' }, { id: 'bot2', name: 'Computer 2' }];

test('Wartezeiten: Leicht 14 bis 24 s, Mittel 6 bis 12 s', () => {
  assert.deepEqual(DELAYS, [[14000, 24000], [6000, 12000]]);
  const rng = seeded(1);
  for (const [lv, lo, hi] of [[0, 14000, 24000], [1, 6000, 12000]]) {
    let mn = Infinity; let mx = -Infinity; let sum = 0;
    for (let i = 0; i < 5000; i++) { const d = thinkDelay(lv, rng); mn = Math.min(mn, d); mx = Math.max(mx, d); sum += d; assert.ok(d >= lo && d <= hi); }
    assert.ok(mn < lo + 300 && mx > hi - 300, 'ganze Spanne genutzt');
    assert.ok(Math.abs(sum / 5000 - (lo + hi) / 2) < 300, 'Mittelwert');
  }
  assert.ok(thinkDelay(7, () => 0) === 14000, 'unbekannte Stufe wie Leicht');
});

test('Entscheidung: immer ein noch gesuchtes Wort der Liste, sonst nichts', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = seeded(seed);
    const g = E.createGame(BOTS, { stufe: E.STUFE_IDS[seed % 3] }, rng);
    while (g.mode === 'play') {
      const m = chooseAction(g, 'bot1', seed % 2, rng);
      assert.equal(m.t, 'find');
      const k = g.words.findIndex((x) => x.w === m.word);
      assert.ok(k >= 0 && g.words[k].by < 0);
      assert.equal(E.handle(g, 'bot1', m).ok, true);
    }
    assert.equal(chooseAction(g, 'bot1', 1, rng), null, 'nach dem Ende nichts');
    assert.deepEqual(g.scores, [10 * g.words.length, 0]);
  }
  const g = E.createGame(BOTS, {}, seeded(3));
  assert.equal(chooseAction(g, 'bot9', 0, seeded(1)), null);
  assert.equal(chooseAction(null, 'bot1', 0), null);
  assert.equal(chooseAction({}, 'bot1', 0), null);
  assert.equal(chooseAction({ game: 'ws', mode: 'play', players: [], words: 5 }, 'bot1', 0), null);
});

// Zeitsimulation: jeder Computer meldet nach seiner Wartezeit ein Wort; wer zuerst dran ist, bekommt es.
function simulate(levels, seed, stufe = 'mittel') {
  const rng = seeded(seed);
  const players = levels.map((_, i) => ({ id: 'bot' + (i + 1), name: 'C' + (i + 1) }));
  const g = E.createGame(players, { stufe }, rng);
  const next = levels.map((lv) => thinkDelay(lv, rng));
  let guard = 0;
  while (g.mode === 'play' && guard++ < 1000) {
    const i = next.indexOf(Math.min(...next));
    const t = next[i];
    const m = chooseAction(g, players[i].id, levels[i], rng);
    assert.ok(m);
    assert.equal(E.handle(g, players[i].id, m).ok, true);
    next[i] = t + thinkDelay(levels[i], rng);
  }
  return g;
}

test('200 simulierte Partien: Mittel schlägt Leicht in mindestens 70 Prozent', () => {
  let midWins = 0; let ties = 0; let easyWins = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const g = simulate([1, 0], seed);
    assert.equal(g.mode, 'over');
    if (g.scores[0] > g.scores[1]) midWins++; else if (g.scores[0] < g.scores[1]) easyWins++; else ties++;
  }
  console.log(`Mittel gewinnt ${midWins}/200 (${(midWins / 2).toFixed(1)} %), Leicht ${easyWins}, Gleichstand ${ties}`);
  assert.ok(midWins >= 140, 'Mittel gewinnt ' + midWins);
  // gleich starke Computer: keiner ist im Vorteil (viele Gleichstände, weil die Wartezeiten eng beieinander liegen)
  let a = 0; let b = 0;
  for (let seed = 1; seed <= 1000; seed++) { const g = simulate([1, 1], 1000 + seed); if (g.scores[0] > g.scores[1]) a++; else if (g.scores[0] < g.scores[1]) b++; }
  console.log(`gleich starke Computer: ${a} gegen ${b} (Rest Gleichstand)`);
  assert.ok(a + b > 50 && a / (a + b) > 0.35 && a / (a + b) < 0.65, `gleich starke Computer: ${a} gegen ${b}`);
  // auch bei Leicht und Schwer
  let w = 0;
  for (let seed = 1; seed <= 200; seed++) { const g = simulate([1, 0], 2000 + seed, seed % 2 ? 'leicht' : 'schwer'); if (g.scores[0] > g.scores[1]) w++; }
  assert.ok(w >= 140, 'Mittel gegen Leicht bei Leicht/Schwer: ' + w);
});

test('Rechenzeit unter 150 ms, auch beim größten Gitter', () => {
  const g = E.createGame(BOTS, { stufe: 'schwer' }, seeded(5));
  const t = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) chooseAction(g, 'bot1', 1, seeded(i));
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / 1000;
  assert.ok(ms < 150, 'ms ' + ms);
});

test('Der Computer schummelt nicht: Lage der Wörter und Gitter ändern die Entscheidung nicht', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = E.createGame(BOTS, { stufe: E.STUFE_IDS[seed % 3] }, seeded(seed));
    // ein paar Wörter als gefunden markieren (öffentlich)
    for (let k = 0; k < seed % 4; k++) E.handle(g, 'bot2', { t: 'find', word: g.words[k].w });
    const twin = JSON.parse(JSON.stringify(g));
    twin.letters = twin.letters.split('').reverse().join('');
    twin.words.forEach((wd) => { wd.r = 0; wd.c = 0; wd.d = 7; });
    for (const lv of [0, 1]) {
      assert.deepEqual(chooseAction(g, 'bot1', lv, seeded(seed * 7)), chooseAction(twin, 'bot1', lv, seeded(seed * 7)));
    }
  }
});

test('Lernrunde: Computer findet höchstens ein Wort und lässt mindestens drei übrig', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = seeded(seed);
    const g = E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'Computer' }], { learn: true }, rng);
    assert.equal(g.words.length, 5);
    let botFinds = 0;
    for (let i = 0; i < 20; i++) {
      const m = chooseAction(g, 'bot1', 0, rng);
      if (!m) break;
      E.handle(g, 'bot1', m); botFinds++;
    }
    assert.equal(botFinds, 1);
    assert.ok(E.unfound(g).length >= 3);
    // Mensch findet weiter: Computer meldet sich nicht mehr, sobald nur noch drei offen sind
    assert.equal(chooseAction(g, 'bot1', 0, rng), null);
  }
});
