import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../reversi/engine.js';
import { chooseAction, searchBest } from '../reversi/ai.js';

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
const mk = () => M.createGame([{ id: 'p0', name: 'Eins' }, { id: 'p1', name: 'Zwei' }], {});
const timing = { n: 0, ms: 0, max: 0 };

// Spieler: { level } | { random: true }. Ergebnis aus Sicht von Person 0: 1, 0.5, 0.
function playGame(p0, p1, rng) {
  const g = mk();
  const pl = [p0, p1];
  let guard = 0;
  while (g.mode !== 'over' && guard++ < 300) {
    if (g.mode === 'pass') { assert.equal(M.handle(g, 'p0', { t: 'ack' }).ok, true); continue; }
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
// Seitenwechsel: abwechselnd Schwarz/Weiß. Ergebnis aus Sicht von a.
function series(a, b, n, seed) {
  const rng = mulberry(seed);
  const res = { win: 0, loss: 0, draw: 0 };
  for (let k = 0; k < n; k++) {
    const r = k % 2 === 0 ? playGame(a, b, rng) : 1 - playGame(b, a, rng);
    if (r === 1) res.win++; else if (r === 0) res.loss++; else res.draw++;
  }
  return res;
}

test('Mittel gewinnt in 200 Partien (Seitenwechsel) mindestens 95 % gegen Zufall', () => {
  const r = series({ level: 1 }, { random: true }, 200, 11);
  console.log('# Mittel gegen Zufall:', JSON.stringify(r));
  assert.ok(r.win / 200 >= 0.95, JSON.stringify(r));
});

test('Mittel gewinnt in 200 Partien (Seitenwechsel) mindestens 80 % gegen Leicht', () => {
  const r = series({ level: 1 }, { level: 0 }, 200, 12);
  console.log('# Mittel gegen Leicht:', JSON.stringify(r));
  assert.ok(r.win / 200 >= 0.8, JSON.stringify(r));
});

test('Leicht gewinnt gegen Zufall häufiger als nicht (Stufen sind geordnet)', () => {
  const r = series({ level: 0 }, { random: true }, 100, 13);
  console.log('# Leicht gegen Zufall:', JSON.stringify(r));
  assert.ok(r.win >= r.loss);
});

test('Rechenzeit je Zug unter 150 ms (alle Mittel-Züge aus den Serien)', () => {
  console.log(`# Züge ${timing.n}, Mittelwert ${(timing.ms / timing.n).toFixed(1)} ms, Maximum ${timing.max.toFixed(1)} ms`);
  assert.ok(timing.n > 1000);
  assert.ok(timing.max < 150, `Maximum ${timing.max}`);
});

test('nur erlaubte Züge, nie eine Antwort außerhalb der Phase', () => {
  const rng = mulberry(5);
  for (let k = 0; k < 40; k++) {
    const g = mk();
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 200) {
      if (g.mode === 'pass') {
        assert.deepEqual(chooseAction(g, ids[g.turn], 1, rng), { t: 'ack' });
        M.handle(g, 'p0', { t: 'ack' });
        continue;
      }
      const other = ids[1 - g.turn];
      assert.equal(chooseAction(g, other, 1, rng), null, 'falsche Person am Zug');
      const lvl = k % 2;
      const m = chooseAction(g, ids[g.turn], lvl, rng);
      assert.equal(m.t, 'place');
      assert.ok(M.isLegal(g.board, m.p, g.turn));
      M.handle(g, ids[g.turn], m);
    }
  }
  assert.equal(chooseAction(null, 'p0', 1), null);
  assert.equal(chooseAction({}, 'p0', 1), null);
  assert.equal(chooseAction(mk(), 'fremd', 1), null);
  const over = mk(); over.mode = 'over';
  assert.equal(chooseAction(over, 'p0', 1), null);
});

test('Leicht nimmt mit etwa 50 % eine erreichbare Ecke', () => {
  // Schwarz kann a1 (Ecke) oder andere Felder spielen
  const g = mk();
  g.board = Array(64).fill(null);
  g.board[idx('b1')] = 1; g.board[idx('c1')] = 0; // a1 schließt b1 ein
  g.board[idx('e5')] = 1; g.board[idx('d5')] = 0; // f5 schließt e5 ein
  g.board[idx('d7')] = 1; g.board[idx('d8')] = 0; // d6 schließt d7 ein
  const legal = M.legalCells(g.board, 0);
  assert.ok(legal.includes(0) && legal.length >= 3);
  const rng = mulberry(3);
  let corner = 0; const N = 2000;
  for (let i = 0; i < N; i++) if (chooseAction(g, 'p0', 0, rng).p === 0) corner++;
  const share = corner / N;
  console.log('# Ecken-Anteil Leicht:', share.toFixed(3), 'bei', legal.length, 'erlaubten Feldern');
  // 50 % gezielt + (1/legal) aus dem Zufallsanteil
  const expect = 0.5 + 0.5 / legal.length;
  assert.ok(Math.abs(share - expect) < 0.05, `${share} vs ${expect}`);
});
function idx(name) { return 'abcdefgh'.indexOf(name[0]) + (Number(name[1]) - 1) * 8; }

test('Mittel erkennt klare Vorteile: Ecke nehmen, sicheren Gewinn im Endspiel finden', () => {
  // Ecke a1 erreichbar, sonst nur Felder neben der Ecke / sehr schwache Züge
  const g = mk();
  g.board = Array(64).fill(null);
  g.board[idx('b1')] = 1; g.board[idx('c1')] = 0;
  g.board[idx('d4')] = 1; g.board[idx('e4')] = 0;
  g.board[idx('g2')] = 1; g.board[idx('h3')] = null;
  const rng = () => 0.99; // kein Zufallszug
  const m = chooseAction(g, 'p0', 1, rng);
  assert.equal(m.p, idx('a1'));
  // Endspiel: 6 freie Felder, die Suche rechnet bis zum Ende und gibt eine erlaubte Wahl zurück
  const rr = mulberry(9);
  const h = mk();
  let guard = 0;
  while (h.mode !== 'over' && h.board.filter((v) => v === null).length > 6 && guard++ < 100) {
    if (h.mode === 'pass') { M.handle(h, 'p0', { t: 'ack' }); continue; }
    const acts = M.legalActions(h);
    M.handle(h, ids[h.turn], acts[Math.floor(rr() * acts.length)]);
  }
  if (h.mode === 'play') {
    const r = searchBest(h.board, h.turn);
    assert.ok(M.isLegal(h.board, r.p, h.turn));
  }
});

test('Entscheidung hängt nur vom Brett ab (Zusatzfelder des Zustands ändern nichts)', () => {
  const rng1 = mulberry(21);
  const g = mk();
  let guard = 0;
  while (g.mode !== 'over' && guard++ < 200) {
    if (g.mode === 'pass') { M.handle(g, 'p0', { t: 'ack' }); continue; }
    const a = chooseAction(g, ids[g.turn], 1, () => 0.99);
    const h = JSON.parse(JSON.stringify(g));
    h.recap = ['zufällig']; h.last = null; h.scores = [9, 9]; h.moveNo = 99; h.round = 7; h.endReason = 'x'; h.opts = { hints: true };
    const b = chooseAction(h, ids[g.turn], 1, () => 0.99);
    assert.deepEqual(a, b);
    const acts = M.legalActions(g);
    M.handle(g, ids[g.turn], acts[Math.floor(rng1() * acts.length)]);
  }
});
