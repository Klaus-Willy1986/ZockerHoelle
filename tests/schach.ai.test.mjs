import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../schach/engine.js';
import { chooseAction } from '../schach/ai.js';

const sq = C.sq;
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mk = (a = 'p0', b = 'p1') => C.createGame([{ id: a, name: 'A' }, { id: b, name: 'B' }]);
const fromFen = (fen, ids = ['p0', 'p1']) => { const g = mk(...ids); assert.ok(C.setFen(g, fen), fen); return g; };

// Die Serienpartien laufen mit kurzem Zeitbudget (40 ms je Zug, Tiefe bis 4), damit der Test schnell bleibt.
// Die echte Rechenzeit (1,2 s Budget) wird getrennt gemessen.
const SERIES_MS = 40;
const CAP = 200; // Zugdeckel in Halbzügen: danach Remis (zählt halb)
let peakMs = 0;

// Spieler: 0 Leicht, 1 Mittel, 'rnd' Zufall
function playGame(kindWhite, kindBlack, seed) {
  const rng = seeded(seed);
  const g = mk();
  const kinds = [kindWhite, kindBlack];
  let plies = 0;
  while (g.mode === 'play' && plies < CAP) {
    const who = g.turn; const id = `p${who}`;
    let msg;
    if (kinds[who] === 'rnd') {
      const ms = C.legalMoves(g);
      const m = ms[Math.floor(rng() * ms.length)];
      msg = { t: 'move', from: m.from, to: m.to, promo: m.promo };
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, id, kinds[who], rng, { timeMs: SERIES_MS });
      peakMs = Math.max(peakMs, performance.now() - t0);
    }
    assert.ok(msg, 'Bot muss am Zug eine Aktion liefern');
    const r = C.handle(g, id, msg);
    assert.ok(r.ok, 'ungültige Nachricht ' + JSON.stringify(msg) + ' ' + r.error);
    plies++;
  }
  if (g.mode !== 'over' || g.result.winner === 'draw') return 'draw';
  return g.result.winner; // 0 | 1 (Farbe)
}
// Punkte von A gegen B über n Partien (Sieg 1, Remis 0,5), Seitenwechsel
function series(kA, kB, n, seed0) {
  let pts = 0; let draws = 0; let wins = 0;
  for (let i = 0; i < n; i++) {
    const aWhite = i % 2 === 0;
    const w = playGame(aWhite ? kA : kB, aWhite ? kB : kA, seed0 + i);
    if (w === 'draw') { pts += 0.5; draws++; } else if ((w === 0) === aWhite) { pts += 1; wins++; }
  }
  return { share: pts / n, draws, wins };
}

test('Mittel gewinnt gegen Zufall in mindestens 90 % der 60 Partien (Remis zählt halb)', () => {
  const r = series(1, 'rnd', 60, 1000);
  console.log('Mittel gegen Zufall:', JSON.stringify(r));
  assert.ok(r.share >= 0.9, 'Anteil ' + r.share);
});
test('Mittel gewinnt gegen Leicht in mindestens 85 % der 60 Partien (Remis zählt halb)', () => {
  const r = series(1, 0, 60, 2000);
  console.log('Mittel gegen Leicht:', JSON.stringify(r));
  assert.ok(r.share >= 0.85, 'Anteil ' + r.share);
});
test('Leicht schlägt Zufall deutlich (60 Partien), Leicht ist schwächer als Mittel', () => {
  const r = series(0, 'rnd', 60, 3000);
  console.log('Leicht gegen Zufall:', JSON.stringify(r));
  assert.ok(r.share >= 0.75, 'Anteil ' + r.share);
});

test('Rechenzeit Mittel: mit echtem Zeitbudget nie über 1,5 s (Anfangs-, Mittelspiel-, Endspielstellungen)', () => {
  const fens = [C.START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'];
  let worst = 0; let sum = 0;
  for (const f of fens) {
    const g = fromFen(f);
    const t0 = performance.now();
    const m = chooseAction(g, g.turn === 0 ? 'p0' : 'p1', 1, seeded(5));
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt); sum += dt;
    assert.ok(m && C.handle(g, g.turn === 0 ? 'p0' : 'p1', m).ok, 'gültiger Zug');
    assert.ok(dt < 1500, `Rechenzeit ${dt.toFixed(0)} ms bei ${f}`);
  }
  console.log(`Mittel Rechenzeit: Spitze ${worst.toFixed(0)} ms, Mittel ${(sum / fens.length).toFixed(0)} ms`);
});
test('Rechenzeit Leicht unter 150 ms', () => {
  let worst = 0;
  for (const f of [C.START_FEN, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1']) {
    const g = fromFen(f);
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const m = chooseAction(g, g.turn === 0 ? 'p0' : 'p1', 0, seeded(i + 1));
      worst = Math.max(worst, performance.now() - t0);
      assert.ok(m);
    }
  }
  console.log(`Leicht Rechenzeit: Spitze ${worst.toFixed(0)} ms`);
  assert.ok(worst < 150, 'Leicht zu langsam: ' + worst);
});

test('Mattsuche: Matt in 1 wird gefunden (Mittel, auch mit Zufallszahl 0 im 5-%-Zweig)', () => {
  const cases = [
    ['6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8'],
    ['6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1', 'g5f7'],
    ['7k/8/6K1/8/8/8/8/R7 w - - 0 1', 'a1a8'],
    ['r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7'],
  ];
  for (const [f, mv] of cases) {
    for (const rv of [0, 0.5, 0.999]) {
      const g = fromFen(f);
      const m = chooseAction(g, 'p0', 1, () => rv, { timeMs: 100 });
      assert.equal(`${C.sqName(m.from)}${C.sqName(m.to)}`, mv, f);
    }
  }
  // Schwarz findet auch Matt
  const g = fromFen('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
  const m = chooseAction(g, 'p1', 1, () => 0.9, { timeMs: 100 });
  assert.equal(`${C.sqName(m.from)}${C.sqName(m.to)}`, 'd8h4');
});
test('Mittel lässt kein Matt in 1 zu, wenn es sich vermeiden lässt (auch im Zufallszweig)', () => {
  // Weiß droht Qxf7#, Schwarz (Mittel) muss darauf reagieren
  const g0 = fromFen('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3');
  for (const rv of [0, 0.01, 0.04, 0.5]) {
    const g = JSON.parse(JSON.stringify(g0));
    let k = 0;
    const rng = () => [rv, 0, 0.5, 0.3][k++ % 4];
    const m = chooseAction(g, 'p1', 1, rng, { timeMs: 150 });
    assert.ok(C.handle(g, 'p1', m).ok);
    // danach darf Weiß kein Matt in 1 haben
    const mates = C.legalMoves(g).filter((x) => { const h = JSON.parse(JSON.stringify(g)); C.handle(h, 'p0', { t: 'move', from: x.from, to: x.to, promo: x.promo }); return h.result && h.result.reason === 'checkmate'; });
    assert.equal(mates.length, 0, `rv=${rv}: Matt in 1 zugelassen mit ${C.toSAN(g0, m)}`);
  }
});
test('Mittel nimmt eine ungedeckte Dame; Leicht nimmt freie Figuren in mindestens 65 % der Fälle', () => {
  const f = 'k7/8/8/3q4/8/8/8/K2R4 w - - 0 1'; // Turm d1 schlägt Dame d5 (frei)
  const g = fromFen(f);
  const m = chooseAction(g, 'p0', 1, () => 0.9, { timeMs: 100 });
  assert.equal(`${C.sqName(m.from)}${C.sqName(m.to)}`, 'd1d5');
  let took = 0; const N = 300; const rng = seeded(77);
  for (let i = 0; i < N; i++) {
    const a = chooseAction(fromFen(f), 'p0', 0, rng);
    if (a.from === sq('d1') && a.to === sq('d5')) took++;
  }
  console.log(`Leicht nimmt freie Dame: ${(100 * took / N).toFixed(0)} %`);
  assert.ok(took / N >= 0.65 && took / N < 0.995, 'Anteil ' + took / N);
});
test('Computer wandelt immer in eine Dame um', () => {
  for (const lv of [0, 1]) {
    const g = fromFen('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
    const m = chooseAction(g, 'p0', lv, seeded(3), { timeMs: 60 });
    assert.equal(m.promo, 'q', 'Stufe ' + lv);
    assert.equal(C.handle(g, 'p0', m).ok, true);
    assert.equal(g.board[sq('e8')], 5);
    const b = fromFen('7k/8/8/8/8/8/4p3/K7 b - - 0 1');
    const mb = chooseAction(b, 'p1', lv, seeded(3), { timeMs: 60 });
    if (mb.from === sq('e2')) assert.equal(mb.promo, 'q');
  }
});
test('Mittel führt Endspiele zu Ende: König+Dame und König+Turm gegen König (Matt, kein Remis)', () => {
  for (const [fen, name] of [['8/8/8/4k3/8/8/8/KQ6 w - - 0 1', 'Dame'], ['8/8/8/4k3/8/8/8/KR6 w - - 0 1', 'Turm'], ['8/8/3k4/8/8/8/8/K5R1 w - - 0 1', 'Turm 2']]) {
    for (let seed = 1; seed <= 5; seed++) {
      const rng = seeded(seed * 31);
      const g = fromFen(fen);
      let plies = 0;
      while (g.mode === 'play' && plies < 160) {
        let msg;
        if (g.turn === 0) msg = chooseAction(g, 'p0', 1, rng, { timeMs: 60 });
        else { const ms = C.legalMoves(g); const x = ms[Math.floor(rng() * ms.length)]; msg = { t: 'move', from: x.from, to: x.to }; }
        assert.ok(C.handle(g, g.turn === 0 ? 'p0' : 'p1', msg).ok);
        plies++;
      }
      assert.equal(g.mode, 'over', `${name} seed ${seed}: kein Ende in 160 Halbzügen`);
      assert.equal(g.result.reason, 'checkmate', `${name} seed ${seed}: ${g.result.reason}`);
    }
  }
});
test('Computer liefert null, wenn er nicht dran ist, die Runde zu Ende ist oder die Eingabe kaputt ist', () => {
  const g = mk('p0', 'bot1');
  assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.equal(chooseAction(g, 'bot1', 0), null);
  assert.equal(chooseAction(g, 'unbekannt', 1), null);
  assert.equal(chooseAction(null, 'bot1', 1), null);
  assert.equal(chooseAction({}, 'bot1', 1), null);
  assert.equal(chooseAction({ mode: 'play', board: 'x', players: [] }, 'bot1', 1), null);
  const over = fromFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'); C.handle(over, 'p0', { t: 'move', from: sq('a1'), to: sq('a8') });
  assert.equal(chooseAction(over, 'p1', 1), null);
  const stale = mk('bot1', 'p1');
  assert.ok(chooseAction(stale, 'bot1', 1, seeded(1), { timeMs: 30 }));
});
test('Computer ändert den übergebenen Zustand nicht und entscheidet reproduzierbar (nutzt nur das Brett)', () => {
  const g = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const snap = JSON.stringify(g);
  const a = chooseAction(g, 'p0', 0, seeded(9));
  assert.equal(JSON.stringify(g), snap);
  const copy = JSON.parse(snap);
  const b = chooseAction(copy, 'p0', 0, seeded(9));
  assert.deepEqual(a, b);
  const m1 = chooseAction(g, 'p0', 1, seeded(9), { timeMs: 80, maxDepth: 3 });
  const m2 = chooseAction(copy, 'p0', 1, seeded(9), { timeMs: 80, maxDepth: 3 });
  assert.deepEqual(m1, m2);
  assert.equal(JSON.stringify(g), snap);
});
test('Computer spielt über 400 Zufallsstellungen nie einen unerlaubten Zug', () => {
  const rnd = seeded(4242);
  let n = 0;
  for (let game = 0; game < 40; game++) {
    const g = mk();
    for (let ply = 0; ply < 60 && g.mode === 'play'; ply++) {
      const id = g.turn === 0 ? 'p0' : 'p1';
      if (ply % 6 === 0 || ply > 40) {
        for (const lv of [0, 1]) {
          const m = chooseAction(g, id, lv, rnd, { timeMs: 8, maxDepth: 3 });
          assert.ok(C.legalMoves(g).some((x) => x.from === m.from && x.to === m.to && (!m.promo || x.promo === m.promo)), 'illegal ' + JSON.stringify(m));
          n++;
        }
      }
      const ms = C.legalMoves(g);
      const x = ms[Math.floor(rnd() * ms.length)];
      C.handle(g, id, { t: 'move', from: x.from, to: x.to, promo: x.promo });
    }
  }
  assert.ok(n >= 400, 'Anzahl Stellungen ' + n);
});
test('Spitzenzeit in den Serienpartien (nur zur Information)', () => { console.log(`Spitzenzeit je Zug in den Serien (Budget ${SERIES_MS} ms): ${peakMs.toFixed(0)} ms`); });
