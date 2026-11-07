import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../drei/engine.js';
import { chooseAction } from '../drei/ai.js';

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
// rng ohne Zufallszug: nie unter 0,15 (so entsteht kein Versehen), sonst gleichmäßig
const calm = (rng) => () => 0.15 + 0.85 * rng();
const timing = { n: 0, ms: 0, max: 0 };

// Spieler: { level } | { random: true } | { level, calm: true }. Ergebnis aus Sicht von Spieler 0: 1, 0.5, 0.
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
      msg = chooseAction(g, ids[i], p.level, p.calm ? calm(rng) : rng);
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
// Abwechselnd beginnen; Ergebnis aus Sicht von a
function series(a, b, n, seed, big = false) {
  const rng = mulberry(seed);
  const res = { win: 0, loss: 0, draw: 0 };
  for (let k = 0; k < n; k++) {
    const r = k % 2 === 0 ? playGame(a, b, rng, big) : 1 - playGame(b, a, rng, big);
    if (r === 1) res.win++; else if (r === 0) res.loss++; else res.draw++;
  }
  return res;
}

// Hinweis: Mittel macht absichtlich in 15 % der Züge einen Zufallszug (damit Menschen gewinnen können). Die echte Verlustquote gegen
// Zufall liegt deshalb bei etwa 0,5 % pro Partie, nicht bei 0. Die feste Stichprobe (Startwert 2, 200 Partien) ist reproduzierbar;
// die Langzeit-Grenzen prüft der Test darunter.
test('Mittel (3×3) verliert in 200 Partien (fester Startwert) nie gegen Zufall und gewinnt mindestens 90 %', () => {
  const r = series({ level: 1 }, { random: true }, 200, 2);
  console.log('Mittel gegen Zufall 3×3 (200):', r);
  assert.equal(r.loss, 0, 'verloren');
  assert.ok(r.win / 200 >= 0.9, `Siege ${r.win}`);
});

test('Mittel (3×3) gegen Zufall über 3000 Partien: höchstens 1,5 % Niederlagen, mindestens 88 % Siege', () => {
  const r = series({ level: 1 }, { random: true }, 3000, 99);
  console.log('Mittel gegen Zufall 3×3 (3000):', r);
  assert.ok(r.loss / 3000 <= 0.015, `Niederlagen ${r.loss}`);
  assert.ok(r.win / 3000 >= 0.88, `Siege ${r.win}`);
});

test('Mittel (3×3) ohne Zufallszüge: gegen sich selbst immer unentschieden, gegen Zufall nie verloren', () => {
  const r = series({ level: 1, calm: true }, { level: 1, calm: true }, 300, 3);
  console.log('Mittel gegen Mittel ohne Zufall (300):', r);
  assert.equal(r.draw, 300);
  const r2 = series({ level: 1, calm: true }, { random: true }, 500, 4);
  assert.equal(r2.loss, 0);
});

test('Mittel (3×3) schlägt Leicht in mindestens 70 % der Partien', () => {
  const r = series({ level: 1 }, { level: 0 }, 300, 11);
  console.log('Mittel gegen Leicht 3×3 (300):', r);
  assert.ok(r.win / 300 >= 0.7, `Siege ${r.win}`);
});

test('Mittel (3×3) kann gelegentlich verlieren (Zufallszüge), aber selten', () => {
  const r = series({ level: 1 }, { level: 1, calm: true }, 1000, 21);
  console.log('Mittel mit Zufall gegen perfekten Gegner (1000):', r);
  assert.ok(r.loss > 0, 'nie ein Versehen');
  assert.ok(r.loss / 1000 < 0.12, `zu oft verloren: ${r.loss}`);
});

test('Mittel (5×5) schlägt Zufall (≥ 95 %) und Leicht (≥ 80 %)', () => {
  const r = series({ level: 1 }, { random: true }, 100, 5, true);
  const l = series({ level: 1 }, { level: 0 }, 100, 6, true);
  console.log('5×5 Mittel gegen Zufall:', r, ' gegen Leicht:', l);
  assert.ok(r.win >= 95, `gegen Zufall ${r.win}`);
  assert.ok(l.win >= 80, `gegen Leicht ${l.win}`);
});

test('Leicht kommt auf beiden Feldgrößen zu Ende und spielt nur erlaubte Züge', () => {
  const a = series({ level: 0 }, { level: 0 }, 100, 1);
  const b = series({ level: 0 }, { level: 0 }, 100, 2, true);
  assert.equal(a.win + a.loss + a.draw, 100);
  assert.equal(b.win + b.loss + b.draw, 100);
});

// Stellung bauen: Zeichen von Spieler 0 und 1, Spieler `turn` am Zug
const setup = (p0, p1, turn, big = false) => {
  const g = mk(big);
  p0.forEach((c) => { g.board[c] = 0; });
  p1.forEach((c) => { g.board[c] = 1; });
  g.turn = turn; g.moveNo = p0.length + p1.length;
  return g;
};

test('Leicht: sieht Gewinn und Block nur in etwa 40 % der Fälle', () => {
  const rng = mulberry(9);
  // Spieler 1 kann mit Feld 5 gewinnen (3,4,5); Spieler 0 könnte mit 2 gewinnen (0,1,2). Freie Felder: 2,5,7,8
  const g = setup([0, 1, 6], [3, 4, 8], 1);
  let win = 0; const N = 4000;
  for (let i = 0; i < N; i++) { if (chooseAction(g, 'p1', 0, rng).p === 5) win++; }
  const share = win / N;
  // 0,4 Gewinn + (0,6 · 0,4 Block auf Feld 2 – nicht 5) + Zufall: Feld 5 etwa 0,4 + 0,36/… ; wichtig: weder immer noch nie
  console.log('Leicht Gewinnfeld gewählt:', (share * 100).toFixed(1), '%');
  assert.ok(share > 0.4 && share < 0.65, `Anteil ${share}`);
  // Nur Block nötig: Spieler 0 am Zug, Gegner (1) droht mit 3,4 -> 5; 0 hat keinen Gewinn
  const g2 = setup([0, 8], [3, 4], 0);
  let blk = 0;
  for (let i = 0; i < N; i++) { if (chooseAction(g2, 'p0', 0, rng).p === 5) blk++; }
  const bs = blk / N; // 0,4 + 0,6 · 1/6 = 0,5
  console.log('Leicht Blockfeld gewählt:', (bs * 100).toFixed(1), '%');
  assert.ok(bs > 0.42 && bs < 0.58, `Block ${bs}`);
});

test('Mittel gewinnt sofort und blockt sofort (ohne Zufallszug)', () => {
  for (let s = 1; s <= 30; s++) {
    const rng = calm(mulberry(s));
    const g = setup([0, 1, 6], [3, 4, 8], 1); // 1 kann mit 5 gewinnen
    assert.equal(chooseAction(g, 'p1', 1, rng).p, 5);
    const g2 = setup([0, 8], [3, 4], 0); // 0 muss 5 blocken
    assert.equal(chooseAction(g2, 'p0', 1, rng).p, 5);
    // 5×5: gewinnen und blocken
    const b1 = setup([0, 1, 2], [5, 6], 0, true); // 0 gewinnt mit 3
    assert.equal(chooseAction(b1, 'p0', 1, rng).p, 3);
    const b2 = setup([12, 18], [0, 1, 2], 0, true); // Gegner droht mit 3 (0,1,2,3)
    assert.equal(chooseAction(b2, 'p0', 1, rng).p, 3);
    const b3 = setup([0, 1, 2], [20, 21, 22], 1, true); // eigener Gewinn (23) geht vor Block (3)
    assert.equal(chooseAction(b3, 'p1', 1, rng).p, 23);
  }
});

test('Auch ein Zufallszug von Mittel lässt keinen Sofortgewinn zu, wenn es anders geht', () => {
  const always = () => 0; // immer Zufallszug (und immer „verlorene“ Stellungen erlaubt)
  const g2 = setup([0, 8], [3, 4], 0);
  for (let i = 0; i < 50; i++) assert.equal(chooseAction(g2, 'p0', 1, always).p, 5);
});

test('Mittel verteilt gleichwertige Eröffnungszüge (spielt nicht jedes Mal gleich)', () => {
  const seen = new Set();
  const rng = calm(mulberry(77));
  for (let i = 0; i < 60; i++) seen.add(chooseAction(mk(), 'p0', 1, rng).p);
  assert.ok(seen.size >= 3, [...seen].join());
});

test('Rechenzeit: jeder Zug weit unter 100 ms (auch kalt, auch 5×5)', () => {
  const t0 = performance.now();
  chooseAction(mk(), 'p0', 1, calm(mulberry(1)));
  const cold = performance.now() - t0;
  const t1 = performance.now();
  chooseAction(mk(true), 'p0', 1, calm(mulberry(1)));
  const big = performance.now() - t1;
  console.log(`Rechenzeit: erster Zug 3×3 ${cold.toFixed(2)} ms, 5×5 ${big.toFixed(2)} ms; Mittelwert ${(timing.ms / timing.n).toFixed(3)} ms, Höchstwert ${timing.max.toFixed(2)} ms über ${timing.n} Züge`);
  assert.ok(cold < 100 && big < 100 && timing.max < 100);
});

test('Eingaben: null bei falscher Person, Spielende oder kaputtem Zustand; Zustand bleibt unverändert', () => {
  const g = mk();
  const snap = JSON.stringify(g);
  assert.equal(chooseAction(g, 'p1', 1), null, 'nicht am Zug');
  assert.equal(chooseAction(g, 'fremd', 1), null);
  for (const bad of [null, undefined, {}, { mode: 'play' }, { mode: 'play', players: [], board: [] }, { mode: 'over', players: g.players, board: g.board }]) {
    assert.equal(chooseAction(bad, 'p0', 1), null);
    assert.equal(chooseAction(bad, 'p0', 0), null);
  }
  const full = mk();
  full.board = [0, 1, 0, 0, 1, 1, 1, 0, 0]; // voll, aber „play“ (kaputt)
  assert.equal(chooseAction(full, 'p0', 1), null);
  assert.equal(chooseAction(full, 'p0', 0), null);
  chooseAction(g, 'p0', 0); chooseAction(g, 'p0', 1);
  assert.equal(JSON.stringify(g), snap);
});
