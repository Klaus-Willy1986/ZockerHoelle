import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../bauern/engine.js';
import { chooseAction } from '../bauern/ai.js';

const sq = B.sq;
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mk = (a = 'p0', b = 'p1', opts) => B.createGame([{ id: a, name: 'A' }, { id: b, name: 'B' }], opts);
function setup(pieces, turn = 0, ids = ['bot1', 'human'], opts) {
  const g = mk(ids[0], ids[1], opts);
  g.board = Array(64).fill(0);
  for (const [k, v] of Object.entries(pieces)) g.board[sq(k)] = v === 'w' ? 1 : 2;
  g.turn = turn;
  return g;
}

let thinkMs = 0;
let thinkN = 0;
let peakMs = 0;

// Spieler: 0 Leicht, 1 Mittel, 'rnd' Zufall. a spielt Index 0 der Spielerliste (in Runde 1 Weiß).
function playGame(kindWhite, kindBlack, seed) {
  const rng = seeded(seed);
  const g = mk('p0', 'p1');
  const kinds = [kindWhite, kindBlack];
  let plies = 0;
  while (g.mode === 'play') {
    assert.ok(plies < 150, 'Partie muss enden');
    const who = g.turn;
    const id = `p${who}`;
    let msg;
    if (kinds[who] === 'rnd') {
      const ms = B.legalMoves(g);
      const m = ms[Math.floor(rng() * ms.length)];
      msg = { t: 'move', from: m.from, to: m.to };
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, id, kinds[who], rng);
      const dt = performance.now() - t0;
      if (kinds[who] === 1) { thinkMs += dt; thinkN++; peakMs = Math.max(peakMs, dt); }
    }
    assert.ok(msg, 'Bot muss am Zug eine Aktion liefern');
    const r = B.handle(g, id, msg);
    assert.ok(r.ok, 'ungültige Nachricht ' + JSON.stringify(msg) + ' ' + r.error);
    plies++;
  }
  return g.winner; // 0 | 1
}
// Anteil Siege von A gegen B über n Partien, Seitenwechsel
function series(kA, kB, n, seed0) {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const aWhite = i % 2 === 0;
    const w = playGame(aWhite ? kA : kB, aWhite ? kB : kA, seed0 + i);
    if ((w === 0) === aWhite) wins++;
  }
  return wins / n;
}

test('Bot gegen Bot (je 200 Partien, Seitenwechsel): Zielquoten und Rechenzeit', { timeout: 900000 }, () => {
  const r = {};
  r.MvR = series(1, 'rnd', 200, 1000);
  r.MvL = series(1, 0, 200, 2000);
  r.LvR = series(0, 'rnd', 200, 3000);
  console.log('Siegquote:', JSON.stringify(r));
  assert.ok(r.MvR >= 0.95, `Mittel gegen Zufall ${r.MvR}`);
  assert.ok(r.MvL >= 0.8, `Mittel gegen Leicht ${r.MvL}`);
  assert.ok(r.LvR > 0.5, `Leicht gegen Zufall ${r.LvR}`);
  const mean = thinkMs / thinkN;
  console.log(`Rechenzeit Mittel: Ø ${mean.toFixed(1)} ms, Spitze ${peakMs.toFixed(1)} ms über ${thinkN} Züge`);
  assert.ok(mean < 150, 'Ø Rechenzeit < 150 ms: ' + mean);
  assert.ok(peakMs < 250, 'Spitze Rechenzeit: ' + peakMs);
});

test('Bot handelt nie, wenn er nicht am Zug ist / Spiel vorbei / unbekannt / kaputt', () => {
  const g = mk('bot1', 'human'); // Weiß = Bot
  assert.equal(chooseAction(g, 'human', 1), null);
  const g2 = mk('human', 'bot1');
  for (const lv of [0, 1]) assert.equal(chooseAction(g2, 'bot1', lv), null);
  assert.equal(chooseAction(g2, 'niemand', 1), null);
  const g3 = setup({ e7: 'w', a2: 'b' }, 0, ['bot1', 'human']);
  B.handle(g3, 'bot1', { t: 'move', from: sq('e7'), to: sq('e8') });
  assert.equal(chooseAction(g3, 'bot1', 1), null);
  for (const bad of [null, undefined, {}, { mode: 'play' }]) assert.equal(chooseAction(bad, 'bot1', 1), null);
  // Nach Seitenwechsel spielt der Bot mit der richtigen Farbe
  const r = mk('bot1', 'human');
  r.mode = 'over';
  B.nextRound(r); // Mensch ist Weiß
  assert.equal(chooseAction(r, 'bot1', 1), null);
  B.move(r, 'human', sq('e2'), sq('e4'));
  const m = chooseAction(r, 'bot1', 1, seeded(3));
  assert.ok(m && B.handle(r, 'bot1', m).ok);
});

test('Beide Stufen gewinnen sofort, wenn es geht (Durchbruch, letzter Bauer, Blockade)', () => {
  for (let s = 1; s <= 30; s++) {
    const lv = s % 2;
    // Durchbruch statt anderer Züge
    const g = setup({ e7: 'w', a2: 'w', c3: 'w', h7: 'b', g6: 'b' }, 0);
    const m = chooseAction(g, 'bot1', lv, seeded(s));
    assert.equal(B.sqName(m.to)[1], '8');
    assert.ok(B.handle(g, 'bot1', m).ok);
    assert.equal(g.endCode, 'goal');
    // Schwarz-Durchbruch
    const h = setup({ d2: 'b', a7: 'w', b7: 'w', h4: 'b' }, 1, ['human', 'bot1']);
    const mb = chooseAction(h, 'bot1', lv, seeded(s));
    assert.equal(B.sqName(mb.to), 'd1');
    // letzter gegnerischer Bauer wird geschlagen (statt zu ziehen), weiter vom Ziel entfernt
    const k = setup({ e4: 'w', a2: 'w', d5: 'b' }, 0);
    const mc = chooseAction(k, 'bot1', lv, seeded(s));
    assert.equal(B.sqName(mc.to), 'd5');
    // Blockade herstellen: e3-e4 sperrt den einzigen schwarzen Bauern e5
    const j = setup({ e3: 'w', a2: 'w', e5: 'b' }, 0);
    const mj = chooseAction(j, 'bot1', lv, seeded(s));
    assert.ok(B.handle(j, 'bot1', mj).ok);
    assert.equal(j.mode === 'over' && j.winner === 0, true, 'Blockade-Sieg');
  }
});

test('Mittel: nimmt einen Sieg im nächsten Zug und spielt nie sofort verlierend, wenn es anders geht', () => {
  // Geprüft über viele zufällig erreichte Stellungen (gespielt wird immer dasselbe Mittel).
  const rnd = seeded(99);
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const g = mk('bot1', 'human');
    const plies = Math.floor(rnd() * 20);
    for (let i = 0; i < plies && g.mode === 'play'; i++) {
      const ms = B.legalMoves(g);
      const m = ms[Math.floor(rnd() * ms.length)];
      B.move(g, g.players[B.playerOfColor(g, g.turn)].id, m.from, m.to);
    }
    if (g.mode !== 'play') continue;
    const botColor = 0;
    if (g.turn !== botColor) { g.turn = botColor; g.ep = null; }
    const moves = B.legalMoves(g);
    const losing = (m) => {
      const h = JSON.parse(JSON.stringify(g));
      B.move(h, 'bot1', m.from, m.to);
      if (h.mode === 'over') return false;
      return B.legalMoves(h).some((x) => (x.to >> 3) === 0 || (() => { const k = JSON.parse(JSON.stringify(h)); B.move(k, 'human', x.from, x.to); return k.mode === 'over'; })());
    };
    const safeExists = moves.some((m) => !losing(m));
    const winExists = moves.some((m) => { const h = JSON.parse(JSON.stringify(g)); B.move(h, 'bot1', m.from, m.to); return h.mode === 'over'; });
    for (let t = 0; t < 4; t++) {
      const msg = chooseAction(g, 'bot1', 1, seeded(n * 7 + t));
      const chosen = moves.find((m) => m.from === msg.from && m.to === msg.to);
      assert.ok(chosen, 'legaler Zug');
      if (winExists) {
        const h = JSON.parse(JSON.stringify(g)); B.move(h, 'bot1', msg.from, msg.to);
        assert.equal(h.mode, 'over', 'Sieg im nächsten Zug wird genommen');
      } else if (safeExists) {
        assert.equal(losing(chosen), false, 'kein sofort verlierender Zug');
      }
    }
    checked++;
  }
  assert.ok(checked > 200);
});

test('Leicht verhindert in etwa der Hälfte der Fälle den sofortigen Durchbruch', () => {
  // Schwarzer Bauer d2 droht d1 (Durchbruch). Weiß kann ihn mit c1 schräg schlagen; die anderen Weiß-Züge helfen nicht.
  let prevented = 0;
  const N = 400;
  for (let s = 0; s < N; s++) {
    const g = setup({ c1: 'w', h2: 'w', d2: 'b', g7: 'b' }, 0);
    const msg = chooseAction(g, 'bot1', 0, seeded(s + 1));
    if (B.sqName(msg.to) === 'd2') prevented++;
  }
  const rate = prevented / N;
  console.log('Leicht schlägt den Durchbruch-Bauern in', (rate * 100).toFixed(0), '% (zufällig wären 33 %)');
  assert.ok(rate > 0.5 && rate < 0.85, `Quote ${rate}`);
});

test('Optionen: Bots halten sich an Schlagzwang und en passant', () => {
  for (let s = 0; s < 30; s++) {
    const g = setup({ e4: 'w', d5: 'b', a2: 'w', h8: 'b' }, 0, ['bot1', 'human'], { mustCapture: true });
    const m = chooseAction(g, 'bot1', s % 2, seeded(s));
    assert.deepEqual([B.sqName(m.from), B.sqName(m.to)], ['e4', 'd5']);
  }
  // en passant: Der Bot kennt die Möglichkeit (nur sofort im nächsten Zug) und spielt immer gültig
  let used = 0;
  for (let s = 0; s < 40; s++) {
    const g = setup({ e5: 'w', d7: 'b', h7: 'b', a2: 'w' }, 1, ['human', 'bot1']);
    assert.ok(B.move(g, 'bot1', sq('d7'), sq('d5')).ok);
    const m = chooseAction(g, 'human', 1, seeded(s)); // 'human' hat Weiß und ist am Zug
    assert.ok(m && B.handle(g, 'human', m).ok);
    if (g.last.kind === 'ep') used++;
  }
  console.log('Mittel schlägt im Vorbeigehen in', used, 'von 40 Fällen');
});
