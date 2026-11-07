import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schiffe/engine.js';
import { chooseAction, decideShot, viewOf } from '../schiffe/ai.js';

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
const PL = [{ id: 'p0', name: 'Computer A' }, { id: 'p1', name: 'Computer B' }];
const timing = { n: 0, ms: 0, max: 0 };

function setupGame(rng, opts) {
  const g = M.createGame(PL, opts, rng);
  for (const id of ids) {
    // der Computer stellt selbst auf (über chooseAction), wie in der App
    let m; let guard = 0;
    while ((m = chooseAction(g, id, 1, rng)) && guard++ < 5) assert.ok(M.handle(g, id, m, rng).ok);
  }
  assert.equal(g.mode, 'play');
  return g;
}
// players: 0 = Leicht, 1 = Mittel, 'rand' = Zufallsschütze. Gibt den Gewinner-Index zurück.
function playGame(p0, p1, rng, opts) {
  const g = setupGame(rng, opts);
  const players = [p0, p1];
  let guard = 0;
  while (g.mode === 'play' && guard++ < 300) {
    const i = g.turn;
    let msg;
    if (players[i] === 'rand') {
      const s = M.legalShots(g);
      const c = s[Math.floor(rng() * s.length)];
      msg = { t: 'shoot', x: M.xOf(c), y: M.yOf(c) };
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, ids[i], players[i], rng);
      const dt = performance.now() - t0;
      timing.n++; timing.ms += dt; timing.max = Math.max(timing.max, dt);
    }
    assert.ok(msg, 'keine Nachricht');
    const r = M.handle(g, ids[i], msg, rng);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
  }
  assert.equal(g.mode, 'over', 'Partie endet nicht');
  return g.winner;
}
// Anteil Siege von a gegen b; gleiche Rundenzahl, Start wechselt (Startspieler = Index 0 der Liste)
function winRate(a, b, n, seed, opts = {}) {
  const rng = mulberry(seed);
  let w = 0;
  for (let k = 0; k < n; k++) {
    const aFirst = k % 2 === 0;
    const win = aFirst ? playGame(a, b, rng, opts) : playGame(b, a, rng, opts);
    if (aFirst ? win === 0 : win === 1) w++;
  }
  return w / n;
}

test('Zielwerte: Mittel gewinnt >= 85 % gegen Zufallsschützen und >= 70 % gegen Leicht', () => {
  for (const opts of [{}, { touch: true }, { again: true }]) {
    const vsRand = winRate(1, 'rand', 300, 101, opts);
    const vsEasy = winRate(1, 0, 300, 202, opts);
    const easyVsRand = winRate(0, 'rand', 200, 303, opts);
    console.log(`Optionen ${JSON.stringify(opts)}: Mittel gegen Zufall ${(vsRand * 100).toFixed(1)} %, Mittel gegen Leicht ${(vsEasy * 100).toFixed(1)} %, Leicht gegen Zufall ${(easyVsRand * 100).toFixed(1)} %`);
    assert.ok(vsRand >= 0.85, `Mittel gegen Zufall ${vsRand}`);
    assert.ok(vsEasy >= 0.70, `Mittel gegen Leicht ${vsEasy}`);
    assert.ok(easyVsRand >= 0.6, `Leicht gegen Zufall ${easyVsRand}`);
  }
});

test('Rechenzeit: jeder Zug unter 100 ms', () => {
  assert.ok(timing.n > 1000);
  console.log(`Rechenzeit: ${timing.n} Entscheidungen, Mittelwert ${(timing.ms / timing.n).toFixed(3)} ms, Maximum ${timing.max.toFixed(2)} ms`);
  assert.ok(timing.max < 100, 'Maximum ' + timing.max);
});

test('Aufstellung des Computers: zufällig, regelkonform, erst "random", dann "ready", dann nichts', () => {
  const rng = mulberry(5);
  for (const opts of [{}, { touch: true }]) {
    const g = M.createGame(PL, opts, rng);
    assert.deepEqual(chooseAction(g, 'p0', 0, rng), { t: 'random' });
    assert.ok(M.handle(g, 'p0', { t: 'random' }, rng).ok);
    assert.ok(M.allPlaced(g.fleets[0]));
    assert.deepEqual(chooseAction(g, 'p0', 1, rng), { t: 'ready' });
    assert.ok(M.handle(g, 'p0', { t: 'ready' }).ok);
    assert.equal(chooseAction(g, 'p0', 1, rng), null);
    assert.equal(chooseAction(g, 'unbekannt', 1, rng), null);
  }
  assert.equal(chooseAction(null, 'p0', 1), null);
});

test('Sicht: nur eigene Schüsse und versenkte Schiffe – keine gegnerischen Schiffspositionen', () => {
  assert.ok(decideShot.length <= 3 && viewOf.length === 2, 'Signatur: decideShot(view, level, rng)');
  const rng = mulberry(9);
  const g = setupGame(rng, {});
  // ein paar Schüsse spielen
  for (let k = 0; k < 40; k++) { const s = M.legalShots(g); const c = s[Math.floor(rng() * s.length)]; M.handle(g, ids[g.turn], { t: 'shoot', x: M.xOf(c), y: M.yOf(c) }); }
  for (const i of [0, 1]) {
    const v = viewOf(g, i);
    assert.deepEqual(Object.keys(v).sort(), ['shots', 'sunk', 'touch']);
    assert.equal(v.shots.length, 100);
    assert.ok(v.shots.every((x) => x === null || x === 'w' || x === 'h' || x === 's'));
    // Felder mit Treffer/Versenkt in der Sicht sind genau die eigenen Schüsse (nicht mehr verraten)
    assert.equal(v.shots.filter((x) => x === 'h' || x === 's').length, g.hits[i]);
    // Alle Felder der gegnerischen Flotte, die noch NICHT beschossen sind, tauchen in der Sicht nirgends auf
    const hidden = new Set(g.fleets[1 - i].flatMap((s) => M.cellsOf(s)).filter((c) => g.grid[i][c] === null));
    const txt = JSON.stringify(v);
    assert.ok(hidden.size > 0);
    for (const c of hidden) assert.equal(v.shots[c], null);
    // versenkte Schiffe: nur Länge und Felder
    v.sunk.forEach((s) => { assert.deepEqual(Object.keys(s).sort(), ['cells', 'len']); s.cells.forEach((c) => assert.equal(v.shots[c], 's')); });
    assert.ok(!/fleets|Schlachtschiff|zerstoerer/.test(txt));
  }
});

test('Entscheidung hängt nur von der Sicht ab: Spielen funktioniert, wenn g.fleets nicht lesbar ist', () => {
  for (const level of [0, 1]) {
    const rng = mulberry(77 + level);
    const g = setupGame(rng, { touch: level === 1 });
    for (let k = 0; k < 60 && g.mode === 'play'; k++) {
      const i = g.turn;
      // Während der Entscheidung ist die gegnerische (und eigene) Flotte gesperrt
      const real = g.fleets;
      Object.defineProperty(g, 'fleets', { get() { throw new Error('Flotte gelesen!'); }, configurable: true });
      let msg;
      try { msg = chooseAction(g, ids[i], level, rng); } finally { Object.defineProperty(g, 'fleets', { value: real, writable: true, configurable: true, enumerable: true }); }
      assert.ok(msg && msg.t === 'shoot');
      assert.ok(M.handle(g, ids[i], msg, rng).ok);
    }
  }
});

test('Gleiche Sicht, gleicher Zufall: gleiche Entscheidung, auch wenn die gegnerische Flotte anders liegt', () => {
  for (let s = 1; s <= 20; s++) {
    const g1 = setupGame(mulberry(s), {});
    const g2 = JSON.parse(JSON.stringify(g1));
    g2.fleets[1] = M.randomFleet({}, mulberry(1000 + s)); // andere Flotte, bisher unbeschossen -> gleiche Sicht
    for (let k = 0; k < 5; k++) {
      const a = decideShot(viewOf(g1, 0), 1, mulberry(k + s));
      const b = decideShot(viewOf(g2, 0), 1, mulberry(k + s));
      assert.equal(a, b);
    }
  }
});

test('Mittel: nach einem Treffer folgen Nachbarfelder, dann wird die Linie fortgesetzt', () => {
  const rng = () => 0.5; // kein Zufallsschuss (0.5 >= 0.1)
  const sh = Array(100).fill(null);
  sh[M.cellOf(4, 4)] = 'h';
  const v = { touch: false, shots: sh, sunk: [] };
  const c = decideShot(v, 1, rng);
  assert.ok([M.cellOf(3, 4), M.cellOf(5, 4), M.cellOf(4, 3), M.cellOf(4, 5)].includes(c), 'Nachbar');
  // zwei Treffer in einer Zeile -> Verlängerung links oder rechts
  sh[M.cellOf(5, 4)] = 'h';
  sh[M.cellOf(4, 3)] = 'w'; sh[M.cellOf(4, 5)] = 'w';
  for (const r of [0.2, 0.5, 0.9]) {
    const c2 = decideShot({ touch: false, shots: sh, sunk: [] }, 1, () => r);
    assert.ok([M.cellOf(3, 4), M.cellOf(6, 4)].includes(c2), 'Linie fortsetzen, bekommen ' + c2);
  }
  // Wasser an beiden Enden eines senkrechten Treffer-Paars: nie in die Nachbarschaft von Wasser-Sackgasse
  const sh2 = Array(100).fill(null);
  sh2[M.cellOf(0, 0)] = 'h';
  assert.ok([M.cellOf(1, 0), M.cellOf(0, 1)].includes(decideShot({ touch: false, shots: sh2, sunk: [] }, 1, rng)));
});

test('Mittel: versenkte Schiffe werden ausgeblendet (keine Nachbarfelder, keine offenen Treffer)', () => {
  // U-Boot bei (4,4),(5,4) versenkt: ohne Berührung sind alle Felder drumherum leer
  const sh = Array(100).fill(null);
  const cells = [M.cellOf(4, 4), M.cellOf(5, 4)];
  cells.forEach((c) => { sh[c] = 's'; });
  const around = new Set(cells.flatMap((c) => M.neighbors8(c)));
  // 10 % Zufallsschüsse können überall hin gehen; der Rest darf nicht neben das versenkte Schiff zielen
  let inAround = 0;
  for (let k = 0; k < 400; k++) if (around.has(decideShot({ touch: false, shots: sh, sunk: [{ len: 2, cells }] }, 1, mulberry(k * 7 + 1)))) inAround++;
  assert.ok(inAround / 400 < 0.05, 'zu oft neben dem versenkten Schiff: ' + inAround);
});

test('Leicht: folgt nach einem Treffer zu etwa 60 % den Nachbarfeldern, sonst zufällig', () => {
  const sh = Array(100).fill(null);
  sh[M.cellOf(4, 4)] = 'h';
  const near = new Set([M.cellOf(3, 4), M.cellOf(5, 4), M.cellOf(4, 3), M.cellOf(4, 5)]);
  const rng = mulberry(42);
  let n = 0; const N = 4000; const seen = new Set();
  for (let k = 0; k < N; k++) { const c = decideShot({ touch: false, shots: sh, sunk: [] }, 0, rng); seen.add(c); if (near.has(c)) n++; }
  const frac = n / N;
  console.log(`Leicht: Nachbarschuss-Anteil ${(frac * 100).toFixed(1)} %`);
  assert.ok(frac > 0.58 && frac < 0.66, 'Anteil ' + frac);
  assert.ok(seen.size > 60, 'sonst breit gestreut');
  assert.ok(!seen.has(M.cellOf(4, 4)), 'nie auf ein beschossenes Feld');
  // ohne Treffer: gleichmäßig zufällig
  const none = new Set();
  for (let k = 0; k < 2000; k++) none.add(decideShot({ touch: false, shots: Array(100).fill(null), sunk: [] }, 0, rng));
  assert.equal(none.size, 100);
});

test('Nie ein bereits beschossenes Feld; letzte freie Stelle wird genommen; nichts frei -> null', () => {
  for (const level of [0, 1]) {
    const rng = mulberry(3 + level);
    const sh = Array(100).fill('w');
    sh[57] = null;
    assert.equal(decideShot({ touch: false, shots: sh, sunk: [] }, level, rng), 57);
    assert.equal(decideShot({ touch: false, shots: Array(100).fill('w'), sunk: [] }, level, rng), null);
  }
});
