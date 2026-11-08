import test from 'node:test';
import assert from 'node:assert/strict';
import * as Z from '../zehntausend/engine.js';
import { chooseAction } from '../zehntausend/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// kinds: Array aus 0 (Leicht) / 1 (Mittel). Gibt das Endergebnis zurück.
function play(kinds, seed, opts) {
  const r = seedRng(seed * 7 + 1);
  const g = Z.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), opts, r);
  let steps = 0;
  while (g.mode === 'play' && steps++ < 50000) {
    const ap = Z.activePlayer(g);
    const msg = chooseAction(g, ap.id, kinds[g.active], r);
    assert.ok(msg, 'Aktion erwartet');
    const res = Z.handle(g, ap.id, msg, r);
    assert.equal(res.ok, true, JSON.stringify(msg) + ' ' + res.error);
  }
  assert.equal(g.mode, 'over', 'Partie endet');
  return g;
}

// Gewinnquote von `a` gegen `b` (Sitzwechsel; Gleichstand zählt halb)
function winRate(a, b, N, base, opts) {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const swap = i % 2 === 1;
    const g = play(swap ? [b, a] : [a, b], base + i, opts);
    const mine = g.players[swap ? 1 : 0].score, theirs = g.players[swap ? 0 : 1].score;
    w += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
  }
  return w / N;
}

test('Mittel gewinnt mindestens 70 % gegen Leicht (200 Spiele bis 10 000, Sitzwechsel)', () => {
  const r = winRate(1, 0, 200, 1000);
  console.log('Mittel gegen Leicht:', r);
  assert.ok(r >= 0.7, `Quote ${r}`);
});

test('Mittel gewinnt auch mit anderen Regeln (ohne Paare / ohne Hürde / Kurzspiel)', () => {
  for (const opts of [{ pairs: false }, { entry: false }, { short: true }]) {
    const r = winRate(1, 0, 100, 5000, opts);
    console.log('Mittel gegen Leicht', JSON.stringify(opts), r);
    assert.ok(r >= 0.62, `Quote ${r} bei ${JSON.stringify(opts)}`);
  }
});

test('Leicht gegen Leicht und Mittel gegen Mittel: faire Verteilung, Partien enden', () => {
  assert.ok(Math.abs(winRate(0, 0, 100, 300) - 0.5) < 0.2);
  assert.ok(Math.abs(winRate(1, 1, 100, 400) - 0.5) < 0.2);
});

test('Partien mit 1 bis 6 Computern enden, Solo-Zugzahlen vernünftig', () => {
  for (let n = 1; n <= 6; n++) for (let s = 0; s < 6; s++) {
    const kinds = Array.from({ length: n }, (_, i) => (i + s) % 2);
    const g = play(kinds, 90 + n * 10 + s, s % 2 ? { short: true } : {});
    assert.equal(g.mode, 'over');
  }
  let t0 = 0, t1 = 0;
  for (let i = 0; i < 100; i++) { t0 += play([0], 2000 + i).players[0].turns; t1 += play([1], 2000 + i).players[0].turns; }
  console.log('Solo: Leicht', t0 / 100, 'Mittel', t1 / 100, 'Züge im Schnitt');
  assert.ok(t1 < t0);
  assert.ok(t1 / 100 > 5 && t0 / 100 < 80);
});

test('Computer wählt nur gültige Würfel und hört nur auf, wenn es erlaubt ist', () => {
  for (const level of [0, 1]) for (let s = 1; s <= 60; s++) {
    const r = seedRng(s);
    const g = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { entry: s % 2 === 0 }, r);
    let steps = 0;
    while (g.mode === 'play' && steps++ < 30000) {
      const ap = Z.activePlayer(g);
      const m = chooseAction(g, ap.id, level, r);
      if (m.t === 'bank') assert.ok(Z.canBank(g, ap, g.turn));
      if (m.t === 'keep') assert.ok(Z.scoreExact(m.idx.map((i) => g.turn.dice[i]), g.opts) > 0);
      assert.ok(Z.handle(g, ap.id, m, r).ok);
    }
  }
});

test('Leicht: wählt gierig alles Punktende, hört bei 300 Zugpunkten oder höchstens 2 Würfeln auf', () => {
  const mk = (opts) => Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { entry: false, ...opts }, seedRng(1));
  const fixedRoll = (g, vals) => { let i = 0; Z.roll(g, 'bot0', () => (vals[i++ % vals.length] - 0.5) / 6); };
  const g = mk();
  fixedRoll(g, [1, 5, 2, 3, 4, 4]);
  assert.deepEqual(chooseAction(g, 'bot0', 0, seedRng(1)), { t: 'keep', idx: [0, 1] });
  Z.keep(g, 'bot0', [0, 1]); // 150, 4 Würfel übrig
  assert.deepEqual(chooseAction(g, 'bot0', 0), { t: 'roll' });
  fixedRoll(g, [1, 1, 1, 4]);
  Z.keep(g, 'bot0', [0, 1, 2]); // 1150, 1 Würfel
  assert.deepEqual(chooseAction(g, 'bot0', 0), { t: 'bank' });
  // höchstens 2 Würfel übrig → aufhören
  const h = mk();
  fixedRoll(h, [1, 1, 3, 3, 4, 6]);
  Z.keep(h, 'bot0', [0, 1]);
  fixedRoll(h, [5, 5, 3, 4]);
  Z.keep(h, 'bot0', [0, 1]); // 300 Punkte → ohnehin
  const k = mk();
  fixedRoll(k, [1, 2, 3, 4, 6, 6]); Z.keep(k, 'bot0', [0]); // 100, 5 übrig
  fixedRoll(k, [5, 2, 3, 4, 6]); Z.keep(k, 'bot0', [0]); // 150, 4 übrig
  fixedRoll(k, [5, 2, 3, 4]); Z.keep(k, 'bot0', [0]); // 200, 3 übrig
  assert.deepEqual(chooseAction(k, 'bot0', 0), { t: 'roll' });
  fixedRoll(k, [5, 2, 3]); Z.keep(k, 'bot0', [0]); // 250, 2 übrig
  assert.deepEqual(chooseAction(k, 'bot0', 0), { t: 'bank' });
  // mit Hürde: darf nicht aufhören → würfelt weiter
  const e = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { entry: true }, seedRng(1));
  fixedRoll(e, [1, 1, 1, 4, 3, 2]); Z.keep(e, 'bot0', [0, 1, 2]); // 1000 → darf aufhören
  assert.deepEqual(chooseAction(e, 'bot0', 0), { t: 'bank' });
  const e2 = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { entry: true }, seedRng(1));
  fixedRoll(e2, [1, 2, 3, 4, 6, 6]); Z.keep(e2, 'bot0', [0]);
  fixedRoll(e2, [5, 2, 3, 4, 6]); Z.keep(e2, 'bot0', [0]);
  fixedRoll(e2, [5, 2, 3, 4]); Z.keep(e2, 'bot0', [0]);
  fixedRoll(e2, [5, 2, 3]); Z.keep(e2, 'bot0', [0]); // 250, 2 Würfel, aber Hürde
  assert.deepEqual(chooseAction(e2, 'bot0', 0), { t: 'roll' });
});

test('Mittel: Schwellen nach übrigen Würfeln, Schlussrunde bis zum Überholen, beste Teilmenge', () => {
  const mk = (opts) => Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { entry: false, ...opts }, seedRng(1));
  const fixedRoll = (g, pid, vals) => { let i = 0; Z.roll(g, pid, () => (vals[i++ % vals.length] - 0.5) / 6); };
  // sechs Würfel (heiße Würfel) → immer weiter
  const g = mk();
  fixedRoll(g, 'bot0', [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(chooseAction(g, 'bot0', 1), { t: 'keep', idx: [0, 1, 2, 3, 4, 5] });
  Z.keep(g, 'bot0', [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(chooseAction(g, 'bot0', 1), { t: 'roll' });
  // ein Würfel übrig, 300+ Punkte → aufhören; wenige Punkte → weiter
  const h = mk();
  h.players[0].entered = true;
  fixedRoll(h, 'bot0', [2, 2, 2, 1, 1, 3]);
  const a = chooseAction(h, 'bot0', 1);
  assert.equal(a.t, 'keep');
  assert.ok(Z.scoreExact(a.idx.map((i) => h.turn.dice[i]), h.opts) >= 100, 'gültige Wahl');
  // Beste Teilmenge (max. Punkte): 5-5-5 + 1 statt nur 1
  const b = mk();
  fixedRoll(b, 'bot0', [5, 5, 5, 1, 2, 3]);
  const bm = chooseAction(b, 'bot0', 1);
  assert.deepEqual(bm.idx.sort(), [0, 1, 2, 3]);
  // Schlussrunde: weiterwürfeln, bis Person vorne überholt ist
  const f = mk({ short: true });
  f.players[0].entered = true; f.players[0].score = 3000; f.players[1].score = 5200; f.finalFrom = 1; f.finalLeft = 1;
  fixedRoll(f, 'bot0', [1, 1, 1, 4, 3, 2]); Z.keep(f, 'bot0', [0, 1, 2]); // 4000 < 5200
  assert.deepEqual(chooseAction(f, 'bot0', 1), { t: 'roll' });
  f.turn.pts = 2300; // 5300 > 5200
  assert.deepEqual(chooseAction(f, 'bot0', 1), { t: 'bank' });
  // Ziel erreicht → aufhören
  const z = mk({ short: true });
  z.players[0].entered = true; z.players[0].score = 4500;
  fixedRoll(z, 'bot0', [1, 1, 1, 4, 3, 2]); Z.keep(z, 'bot0', [0, 1, 2]);
  assert.deepEqual(chooseAction(z, 'bot0', 1), { t: 'bank' });
  // Hürde beachten: ohne Konto und unter 500 nie aufhören
  const e = mk({ entry: true });
  fixedRoll(e, 'bot0', [1, 2, 3, 4, 6, 6]); Z.keep(e, 'bot0', [0]);
  fixedRoll(e, 'bot0', [5, 2, 3, 4, 6]); Z.keep(e, 'bot0', [0]);
  fixedRoll(e, 'bot0', [5, 2, 3, 4]); Z.keep(e, 'bot0', [0]);
  fixedRoll(e, 'bot0', [5, 2, 3]); Z.keep(e, 'bot0', [0]); // 250, 2 Würfel
  assert.deepEqual(chooseAction(e, 'bot0', 1), { t: 'roll' });
  // ohne Hürde: bei 2 Würfeln und 250 Punkten aufhören
  const e2 = mk({ entry: false });
  fixedRoll(e2, 'bot0', [1, 2, 3, 4, 6, 6]); Z.keep(e2, 'bot0', [0]);
  fixedRoll(e2, 'bot0', [5, 2, 3, 4, 6]); Z.keep(e2, 'bot0', [0]);
  fixedRoll(e2, 'bot0', [5, 2, 3, 4]); Z.keep(e2, 'bot0', [0]);
  fixedRoll(e2, 'bot0', [5, 2, 3]); Z.keep(e2, 'bot0', [0]);
  assert.deepEqual(chooseAction(e2, 'bot0', 1), { t: 'bank' });
});

test('Falsche Person, Spielende, kaputte Zustände: null statt Fehler', () => {
  const g = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], {}, seedRng(1));
  assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.equal(chooseAction(null, 'bot0', 1), null);
  assert.equal(chooseAction({}, 'bot0', 1), null);
  assert.equal(chooseAction({ mode: 'play', players: [], active: 0, turn: {} }, 'bot0', 1), null);
  g.mode = 'over';
  assert.equal(chooseAction(g, 'bot0', 1), null);
});

test('Rechenzeit: jede Entscheidung unter 150 ms (auch die erste mit Tabellenaufbau)', async () => {
  // Frischer Modulstand: die allererste Entscheidung baut die Schwellentabellen auf
  const fresh = await import('../zehntausend/ai.js?frisch=' + Date.now());
  const g0 = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { pairs: false, entry: true }, seedRng(1));
  let first = 0;
  const rr = seedRng(77);
  for (let i = 0; i < 20 && g0.mode === 'play'; i++) {
    const ap = Z.activePlayer(g0);
    const t0 = performance.now();
    const m = fresh.chooseAction(g0, ap.id, 1, rr);
    first = Math.max(first, performance.now() - t0);
    Z.handle(g0, ap.id, m, rr);
  }
  console.log('Erste Entscheidungen (mit Tabellenaufbau):', first.toFixed(1), 'ms');
  assert.ok(first < 150, `${first} ms`);
  let worst = 0;
  for (const opts of [{}, { pairs: false }, { entry: false }]) {
    for (const level of [0, 1]) {
      const r = seedRng(level + 3);
      const g = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], opts, r);
      let steps = 0;
      while (g.mode === 'play' && steps++ < 6000) {
        const ap = Z.activePlayer(g);
        const t0 = performance.now();
        const m = chooseAction(g, ap.id, level, r);
        worst = Math.max(worst, performance.now() - t0);
        Z.handle(g, ap.id, m, r);
      }
    }
  }
  console.log('Längste Entscheidung:', worst.toFixed(1), 'ms');
  assert.ok(worst < 150, `${worst} ms`);
});

test('KI schummelt nicht: Entscheidung hängt nur von Wurf, Zugpunkten und Punktständen ab', () => {
  for (let s = 1; s <= 80; s++) {
    const r = seedRng(s);
    const g = Z.createGame([{ id: 'bot0', name: 'C' }, { id: 'bot1', name: 'D' }], { entry: s % 3 !== 0 }, r);
    let steps = 0;
    while (g.mode === 'play' && steps++ < 800) {
      const ap = Z.activePlayer(g);
      for (const level of [0, 1]) {
        const base = chooseAction(g, ap.id, level, seedRng(5));
        // Veränderte, nicht sichtbare Dinge: Zufallsquelle, Namen, Spielkennung, Rundenzähler, Wurfzähler, Hinweistexte
        const c = JSON.parse(JSON.stringify(g));
        c.gid = 1; c.recap = ['x']; c.rollId += 99; c.round += 5; c.players.forEach((p) => { p.name = 'Z'; p.turns += 3; });
        c.turn.rolls += 7; c.turn.last = 0; c.turn.kept = [];
        assert.deepEqual(chooseAction(c, ap.id, level, seedRng(99)), base, `Stufe ${level}`);
      }
      Z.handle(g, ap.id, chooseAction(g, ap.id, s % 2, r), r);
    }
  }
});
