import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../muehle/engine.js';
import { chooseAction } from '../muehle/ai.js';

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

const ids = ['bot1', 'bot2'];
const mk = () => M.createGame([{ id: 'bot1', name: 'Computer' }, { id: 'bot2', name: 'Gegner' }]);

const timing = { n: 0, ms: 0, max: 0 };

// Spieler: { level: 0|1 } oder { random: true }. Gibt Ergebnis aus Sicht von Spieler 0 zurück (1, 0.5, 0).
function playGame(p0, p1, rng) {
  const g = mk();
  const players = [p0, p1];
  let guard = 0;
  while (g.mode === 'play' && guard++ < 1500) {
    const i = g.drawOffer !== null ? 1 - g.drawOffer : g.turn;
    const pl = players[i];
    let msg;
    if (pl.random) {
      const acts = M.legalActions(g);
      msg = acts[Math.floor(rng() * acts.length)];
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, ids[i], pl.level, rng);
      const dt = performance.now() - t0;
      timing.n++; timing.ms += dt; timing.max = Math.max(timing.max, dt);
    }
    assert.ok(msg, `Keine Nachricht (Spieler ${i}, Stufe ${pl.level})`);
    const r = M.handle(g, ids[i], msg);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
  }
  assert.equal(g.mode, 'over', 'Partie endet nicht');
  return g.winner === null ? 0.5 : g.winner === 0 ? 1 : 0;
}

const score = (a, b, n, seed) => {
  const rng = mulberry(seed);
  let s = 0;
  for (let k = 0; k < n; k++) s += k % 2 === 0 ? playGame(a, b, rng) : 1 - playGame(b, a, rng);
  return s / n;
};

test('Mittel schlägt Leicht in mindestens 65 % der Partien', () => {
  const r = score({ level: 1 }, { level: 0 }, 120, 11);
  console.log('Mittel gegen Leicht:', (r * 100).toFixed(1), '%');
  assert.ok(r >= 0.65, `nur ${r}`);
});

test('Mittel gegen Zufallsspieler: über 90 %', () => {
  const r = score({ level: 1 }, { random: true }, 80, 22);
  console.log('Mittel gegen Zufall:', (r * 100).toFixed(1), '%');
  assert.ok(r > 0.9, `nur ${r}`);
});

test('Leicht gegen Zufall (schlagbar, aber besser) und alle Kombinationen sind regelkonform', () => {
  const r = score({ level: 0 }, { random: true }, 60, 33);
  console.log('Leicht gegen Zufall:', (r * 100).toFixed(1), '%');
  assert.ok(r > 0.6);
  const a = score({ level: 0 }, { level: 0 }, 40, 44);
  const b = score({ level: 1 }, { level: 1 }, 40, 55);
  console.log('Leicht-Leicht:', a, ' Mittel-Mittel:', b);
});

test('Rechenzeit pro Zug: Mittel im Mittel unter 150 ms', () => {
  console.log(`Züge: ${timing.n}, Mittel ${(timing.ms / timing.n).toFixed(1)} ms, Maximum ${timing.max.toFixed(0)} ms`);
  assert.ok(timing.n > 1000);
  assert.ok(timing.ms / timing.n < 150);
  assert.ok(timing.max < 400);
});

test('nicht am Zug oder Spiel vorbei: null', () => {
  const g = mk();
  for (const lv of [0, 1]) {
    assert.equal(chooseAction(g, 'bot2', lv), null); // Weiß beginnt
    assert.ok(chooseAction(g, 'bot1', lv));
    assert.equal(chooseAction(g, 'unbekannt', lv), null);
  }
  M.resign(g, 'bot1');
  assert.equal(chooseAction(g, 'bot2', 1), null);
  assert.equal(chooseAction(g, 'bot1', 0), null);
});

const setup = (w, b, { toPlace = [0, 0], turn = 0 } = {}) => {
  const g = mk();
  g.board = Array(24).fill(null);
  w.forEach((p) => { g.board[p] = 0; });
  b.forEach((p) => { g.board[p] = 1; });
  g.toPlace = [...toPlace];
  g.turn = turn;
  return g;
};

test('Sonderfälle: Mühle bilden, danach entfernen, Fliegen, Remis-Angebot', () => {
  for (const lv of [0, 1]) {
    const rng = mulberry(5 + lv);
    // Mühle sofort möglich (Setzen): Mittel immer, Leicht fast immer – hier mit festem rng
    for (let k = 0; k < 20; k++) {
      const g = setup([0, 1], [3, 5, 12], { toPlace: [5, 5], turn: 0 });
      const m = chooseAction(g, 'bot1', lv, rng);
      assert.equal(m.t, 'place');
      assert.equal(M.handle(g, 'bot1', m).ok, true);
    }
    // Entfernen nach eigener Mühle
    const g = setup([0, 1, 2, 10], [3, 5, 12, 20], { toPlace: [0, 0], turn: 0 });
    g.removing = true;
    const m = chooseAction(g, 'bot1', lv, rng);
    assert.equal(m.t, 'remove');
    assert.equal(M.handle(g, 'bot1', m).ok, true);
    // Mehrstufig: Ziehen -> Mühle -> Entfernen
    const h = setup([0, 1, 10, 4], [3, 5, 12, 20, 22], { toPlace: [0, 0], turn: 0 });
    const m1 = chooseAction(h, 'bot1', lv, () => 0.99);
    assert.equal(m1.t, 'move');
    assert.equal(M.handle(h, 'bot1', m1).ok, true);
    if (h.removing) {
      const m2 = chooseAction(h, 'bot1', lv, rng);
      assert.equal(m2.t, 'remove');
      assert.equal(M.handle(h, 'bot1', m2).ok, true);
    }
    // Nur noch 3 Steine: Fliegen (Zug zu einem nicht angrenzenden Punkt möglich)
    const f = setup([0, 12, 21], [2, 3, 4, 14, 16], { toPlace: [0, 0], turn: 0 });
    for (let k = 0; k < 30; k++) {
      const mf = chooseAction(f, 'bot1', lv, rng);
      assert.equal(mf.t, 'move');
      assert.ok(M.legalActions(f).some((a) => a.from === mf.from && a.to === mf.to));
    }
    const fl = setup([0, 12, 21], [2, 3, 4, 14, 16], { toPlace: [0, 0], turn: 0 });
    const seenFar = new Set();
    for (let k = 0; k < 60; k++) { const mf = chooseAction(fl, 'bot1', lv, rng); seenFar.add(M.NEIGHBORS[mf.from].includes(mf.to)); }
    if (lv === 0) assert.ok(seenFar.has(false), 'Leicht fliegt nie');
    // Remis-Angebot des Gegners: ablehnen; Bot hat selbst nie etwas angeboten
    const d = setup([0, 1, 10, 4], [3, 5, 12, 20, 22], { toPlace: [0, 0], turn: 0 });
    assert.equal(M.drawOffer(d, 'bot2').ok, true);
    assert.deepEqual(chooseAction(d, 'bot1', lv, rng), { t: 'draw-decline' });
    assert.equal(M.handle(d, 'bot1', { t: 'draw-decline' }).ok, true);
    // Auch wenn der Bot gar nicht am Zug ist
    const d2 = setup([0, 1, 10, 4], [3, 5, 12, 20, 22], { toPlace: [0, 0], turn: 1 });
    M.drawOffer(d2, 'bot2');
    d2.drawOffer = 1; d2.turn = 1;
    assert.equal(chooseAction(d2, 'bot1', lv, rng).t, 'draw-decline');
    assert.equal(chooseAction(d2, 'bot2', lv, rng), null); // eigenes Angebot: nichts tun
    // Wiederholte Stellung: Annahme
    const d3 = setup([0, 1, 10, 4], [3, 5, 12, 20, 22], { toPlace: [0, 0], turn: 0 });
    d3.seen[`${d3.board.map((v) => (v === null ? '-' : v)).join('')}|0`] = 2;
    M.drawOffer(d3, 'bot2');
    assert.deepEqual(chooseAction(d3, 'bot1', lv, rng), { t: 'draw-accept' });
  }
});

test('Mittel nimmt eine offene Mühle der Gegenseite weg (blockt)', () => {
  const rng = mulberry(9);
  const g = setup([8, 9], [0, 1, 20], { toPlace: [4, 4], turn: 0 });
  // Schwarz droht mit 2 (Punkte 0,1,2). Weiß hat selbst 8,9,10 offen -> Mittel schließt zuerst die eigene Mühle
  const m = chooseAction(g, 'bot1', 1, rng);
  assert.deepEqual(m, { t: 'place', p: 10 });
  const g2 = setup([8, 20], [0, 1, 23], { toPlace: [4, 4], turn: 0 });
  assert.deepEqual(chooseAction(g2, 'bot1', 1, rng), { t: 'place', p: 2 });
});
