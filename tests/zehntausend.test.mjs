import test from 'node:test';
import assert from 'node:assert/strict';
import * as Z from '../zehntausend/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// rng, das vorgegebene Augenzahlen liefert
const fixed = (...vals) => { let i = 0; return () => (vals[i++ % vals.length] - 0.5) / 6; };
const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }];
const mk = (players = P2, opts) => Z.createGame(players, opts, seedRng(1));
const A = Z.DEFAULT_OPTS;
const NOP = { pairs: false, entry: true, short: false };

// ---------- Wertungstabelle ----------
test('Wertung: Einzelwürfel und Drillinge', () => {
  const table = [
    [[1], 100], [[5], 50], [[1, 5], 150], [[1, 1], 200], [[5, 5], 100], [[1, 1, 5, 5], 300],
    [[1, 1, 1], 1000], [[2, 2, 2], 200], [[3, 3, 3], 300], [[4, 4, 4], 400], [[5, 5, 5], 500], [[6, 6, 6], 600],
    [[2, 2], 0], [[3], 0], [[2], 0], [[4], 0], [[6], 0], [[2, 2, 3], 0], [[1, 2], 0], [[5, 6], 0], [[1, 1, 1, 5], 1050], [[1, 1, 1, 1, 5], 2050],
    [[2, 2, 2, 1], 300], [[2, 2, 2, 5, 5], 300], [[5, 5, 5, 1], 600], [[6, 6, 6, 1, 5], 750],
  ];
  for (const [vals, pts] of table) assert.equal(Z.scoreExact(vals, A), pts, JSON.stringify(vals));
});

test('Wertung: vier, fünf, sechs gleiche', () => {
  const t = (v, n) => Array(n).fill(v);
  const base = { 1: 1000, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600 };
  const mult = { 3: 1, 4: 2, 5: 4, 6: 8 };
  for (let v = 1; v <= 6; v++) {
    for (const n of [3, 4, 5, 6]) assert.equal(Z.scoreExact(t(v, n), A), base[v] * mult[n], `${n}x${v}`);
  }
  assert.equal(Z.scoreExact(t(1, 4), A), 2000);
  assert.equal(Z.scoreExact(t(1, 5), A), 4000);
  assert.equal(Z.scoreExact(t(1, 6), A), 8000);
  assert.equal(Z.scoreExact(t(2, 4), A), 400);
  assert.equal(Z.scoreExact(t(2, 5), A), 800);
  assert.equal(Z.scoreExact(t(2, 6), A), 1600);
  // vier gleiche + Einzelwürfel
  assert.equal(Z.scoreExact([2, 2, 2, 2, 1, 5], A), 400 + 150);
  assert.equal(Z.scoreExact([5, 5, 5, 5, 1], A), 1000 + 100);
  // fünf Einser + eine 5
  assert.equal(Z.scoreExact([1, 1, 1, 1, 1, 5], A), 4050);
});

test('Wertung: Straße und drei Paare', () => {
  assert.equal(Z.scoreExact([1, 2, 3, 4, 5, 6], A), 1500);
  assert.equal(Z.scoreExact([6, 5, 4, 3, 2, 1], A), 1500);
  assert.equal(Z.scoreExact([1, 2, 3, 4, 5], A), 0, 'fünf Zahlen der Reihe nach sind keine Straße (2-3-4 zählen nicht)');
  assert.equal(Z.scoreExact([2, 2, 4, 4, 6, 6], A), 1000);
  assert.equal(Z.scoreExact([2, 2, 4, 4, 6, 6], NOP), 0, 'ohne Option zählen Paare nicht');
  assert.equal(Z.scoreExact([1, 1, 5, 5, 3, 3], A), 1000);
  assert.equal(Z.scoreExact([1, 1, 5, 5, 3, 3], NOP), 0, 'ohne Paare zählen die Dreier nicht');
  assert.equal(Z.scoreExact([2, 2, 2, 2, 3, 3], A), 0, 'vier gleiche plus ein Paar sind keine drei Paare; die Dreier zählen nicht');
  assert.equal(Z.scoreExact([2, 2, 2, 2, 5, 5], A), 500, 'vier Zweier = 400, zwei Fünfer = 100');
  assert.equal(Z.scoreExact([1, 1, 1, 1, 5, 5], A), 2100);
  assert.equal(Z.scoreExact([1, 1, 2, 2, 3], A), 0, 'drei Paare nur mit allen sechs Würfeln');
  assert.equal(Z.scoreExact([1, 1, 2, 2], A), 0);
});

test('Wertung: ungültige Eingaben', () => {
  for (const bad of [null, undefined, 'x', [], [0], [7], [1.5], [1, 2, 3, 4, 5, 6, 1], [NaN], ['1'], {}]) assert.equal(Z.scoreExact(bad, A), 0, JSON.stringify(bad));
});

test('Patzererkennung: alle Würfe mit 1 bis 3 Würfeln und die Straßen-/Paarwürfe', () => {
  const rec = (n, cur, fn) => { if (cur.length === n) return fn(cur.slice()); for (let v = 1; v <= 6; v++) { cur.push(v); rec(n, cur, fn); cur.pop(); } };
  for (let n = 1; n <= 6; n++) {
    rec(n, [], (d) => {
      const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach((v) => { c[v] += 1; });
      const simple = c[1] > 0 || c[5] > 0 || c.some((x) => x >= 3);
      const straight = n === 6 && c.slice(1).every((x) => x === 1);
      const pairs = n === 6 && c.slice(1).filter((x) => x === 2).length === 3;
      assert.equal(Z.hasScoring(d, A), simple || straight || pairs, d.join(''));
      assert.equal(Z.hasScoring(d, NOP), simple || straight, d.join('') + ' ohne Paare');
    });
  }
  assert.equal(Z.hasScoring([2, 3, 4, 6], A), false);
  assert.equal(Z.hasScoring([2, 2, 3, 4, 6, 6], A), false);
  assert.equal(Z.hasScoring([2, 2, 3, 3, 4, 4], A), true);
  assert.equal(Z.hasScoring([2, 2, 3, 3, 4, 4], NOP), false);
});

test('beste Teilmenge für die KI', () => {
  let b = Z.bestSubset([1, 5, 2, 3, 4, 4], A);
  assert.deepEqual(b.idx.sort(), [0, 1]); assert.equal(b.pts, 150); assert.equal(b.left, 4);
  b = Z.bestSubset([1, 2, 3, 4, 5, 6], A);
  assert.equal(b.pts, 1500); assert.equal(b.left, 0);
  b = Z.bestSubset([3, 3, 3, 1, 2, 6], A);
  assert.equal(b.pts, 400); assert.deepEqual(b.idx, [0, 1, 2, 3]);
  b = Z.bestSubset([2, 3, 4, 6, 6], A);
  assert.equal(b, null);
  // Gleichstand: bei preferMore bleibt mehr übrig (hier: 1-1-1 = 1000 gegen 1-1-1 + nichts anderes; Beispiel mit zwei Wegen zu 300)
  b = Z.bestSubset([1, 1, 5, 5, 5], A);
    assert.equal(b.pts, 700);
  assert.equal(Z.bestSubset([4], A), null);
  assert.equal(Z.bestSubset('x', A), null);
  // Bester Satz bei 1-1-1-1 gegen 1-1-1 + 1
  assert.equal(Z.bestSubset([1, 1, 1, 1, 2, 3], A).pts, 2000);
  // Zufallsprüfung: bestSubset passt zu hasScoring und scoreExact
  const r = seedRng(5);
  for (let i = 0; i < 500; i++) {
    const n = 1 + Math.floor(r() * 6);
    const d = Array.from({ length: n }, () => 1 + Math.floor(r() * 6));
    const bs = Z.bestSubset(d, A);
    assert.equal(!!bs, Z.hasScoring(d, A));
    if (bs) {
      assert.equal(Z.scoreExact(bs.idx.map((k) => d[k]), A), bs.pts);
      assert.equal(bs.left, n - bs.idx.length);
    }
  }
});

// ---------- Zugablauf ----------
test('createGame: Anfangszustand, JSON, Optionen', () => {
  const g = mk();
  assert.equal(g.mode, 'play'); assert.equal(g.active, 0); assert.equal(g.turn.phase, 'start');
  assert.deepEqual(g.opts, { pairs: true, entry: true, short: false });
  assert.equal(Z.targetOf(g), 10000);
  assert.equal(Z.targetOf(mk(P2, { short: true })), 5000);
  assert.deepEqual(Z.normOpts({ pairs: false, entry: false, short: true }), { pairs: false, entry: false, short: true });
  assert.deepEqual(Z.normOpts(null), Z.DEFAULT_OPTS);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('Wurf, Wertung und Weiterwürfeln', () => {
  const g = mk(P2, { entry: false });
  assert.equal(Z.handle(g, 'a', { t: 'roll' }, fixed(1, 5, 2, 3, 4, 6)).ok, true);
  assert.deepEqual(g.turn.dice, [1, 5, 2, 3, 4, 6]);
  assert.equal(g.turn.phase, 'pick');
  const r = Z.handle(g, 'a', { t: 'keep', idx: [0, 1] });
  assert.equal(r.ok, true); assert.equal(g.turn.pts, 150); assert.deepEqual(g.turn.aside, [1, 5]); assert.equal(Z.diceLeft(g.turn), 4);
  assert.equal(g.turn.phase, 'after');
  // Weiterwürfeln mit 4 Würfeln
  assert.equal(Z.handle(g, 'a', { t: 'roll' }, fixed(2, 2, 2, 6)).ok, true);
  assert.equal(g.turn.dice.length, 4);
  assert.equal(Z.handle(g, 'a', { t: 'keep', idx: [0, 1, 2] }).ok, true);
  assert.equal(g.turn.pts, 350); assert.equal(g.turn.aside.length, 5);
  assert.equal(Z.handle(g, 'a', { t: 'bank' }).ok, true);
  assert.equal(g.players[0].score, 350); assert.equal(g.turn.phase, 'end'); assert.equal(g.turn.result.kind, 'bank');
  assert.equal(Z.handle(g, 'b', { t: 'next' }).ok, false, 'nur die Person am Zug darf weiter');
  assert.equal(Z.handle(g, 'a', { t: 'next' }).ok, true);
  assert.equal(g.active, 1); assert.equal(g.turn.phase, 'start'); assert.equal(g.turn.pts, 0);
});

test('Patzer: Punkte verfallen, nächste Person', () => {
  const g = mk(P2, { entry: false });
  Z.handle(g, 'a', { t: 'roll' }, fixed(1, 2, 3, 4, 6, 6));
  Z.handle(g, 'a', { t: 'keep', idx: [0] });
  assert.equal(g.turn.pts, 100);
  const r = Z.handle(g, 'a', { t: 'roll' }, fixed(2, 3, 4, 6, 2));
  assert.equal(r.ok, true); assert.equal(r.patzer, true);
  assert.equal(g.turn.phase, 'end'); assert.equal(g.turn.result.kind, 'patzer'); assert.equal(g.turn.result.lost, 100);
  assert.equal(g.players[0].score, 0); assert.equal(g.players[0].turns, 1);
  assert.match(g.recap[0], /Patzer/);
  assert.equal(Z.handle(g, 'a', { t: 'bank' }).ok, false);
  assert.equal(Z.handle(g, 'a', { t: 'roll' }).ok, false, 'nach dem Patzer kein weiterer Wurf');
  Z.handle(g, 'a', { t: 'next' });
  assert.equal(g.active, 1);
});

test('Patzer gleich im ersten Wurf (6 Würfel ohne Wertung)', () => {
  const g = mk();
  const r = Z.handle(g, 'a', { t: 'roll' }, fixed(2, 2, 3, 4, 6, 6));
  assert.equal(r.patzer, true);
  const g2 = mk(P2, { pairs: false });
  assert.equal(Z.handle(g2, 'a', { t: 'roll' }, fixed(2, 2, 3, 3, 4, 4)).patzer, true);
  const g3 = mk(P2, { pairs: true });
  assert.equal(Z.handle(g3, 'a', { t: 'roll' }, fixed(2, 2, 3, 3, 4, 4)).patzer, undefined);
  assert.equal(Z.handle(g3, 'a', { t: 'keep', idx: [0, 1, 2, 3, 4, 5] }).pts, 1000);
});

test('Heiße Würfel: alle sechs gewertet, wieder sechs Würfel', () => {
  const g = mk(P2, { entry: false });
  Z.handle(g, 'a', { t: 'roll' }, fixed(1, 2, 3, 4, 5, 6));
  assert.equal(Z.handle(g, 'a', { t: 'keep', idx: [0, 1, 2, 3, 4, 5] }).pts, 1500);
  assert.equal(g.turn.hot, true); assert.equal(Z.diceLeft(g.turn), 6);
  Z.handle(g, 'a', { t: 'roll' }, fixed(1, 3, 3, 4, 6, 6));
  assert.equal(g.turn.dice.length, 6); assert.equal(g.turn.hot, false); assert.deepEqual(g.turn.aside, []); assert.equal(g.turn.pts, 1500, 'Zugpunkte bleiben');
  // Heiße Würfel auch über mehrere Würfe
  const h = mk(P2, { entry: false });
  Z.handle(h, 'a', { t: 'roll' }, fixed(1, 1, 1, 2, 3, 4));
  Z.handle(h, 'a', { t: 'keep', idx: [0, 1, 2] });
  Z.handle(h, 'a', { t: 'roll' }, fixed(5, 5, 5));
  Z.handle(h, 'a', { t: 'keep', idx: [0, 1, 2] });
  assert.equal(h.turn.hot, true); assert.equal(h.turn.pts, 1500);
});

test('Einstiegshürde', () => {
  const g = mk(P2, { entry: true });
  Z.handle(g, 'a', { t: 'roll' }, fixed(1, 2, 3, 4, 6, 6));
  Z.handle(g, 'a', { t: 'keep', idx: [0] });
  assert.equal(Z.canBank(g, g.players[0], g.turn), false);
  const r = Z.handle(g, 'a', { t: 'bank' });
  assert.equal(r.ok, false); assert.match(r.error, /500/);
  Z.handle(g, 'a', { t: 'roll' }, fixed(5, 5, 5));
  Z.handle(g, 'a', { t: 'keep', idx: [0, 1, 2] }); // 100 + 500 = 600
  assert.equal(Z.canBank(g, g.players[0], g.turn), true);
  assert.equal(Z.handle(g, 'a', { t: 'bank' }).ok, true);
  assert.equal(g.players[0].entered, true);
  Z.handle(g, 'a', { t: 'next' });
  // Bernd hat noch kein Konto, Anna darf danach ab sofort kleine Beträge buchen
  Z.handle(g, 'b', { t: 'roll' }, fixed(2, 2, 2, 3, 4, 6));
  Z.handle(g, 'b', { t: 'keep', idx: [0, 1, 2] });
  assert.equal(Z.handle(g, 'b', { t: 'bank' }).ok, false);
  Z.handle(g, 'b', { t: 'roll' }, fixed(1, 1, 3));
  Z.handle(g, 'b', { t: 'keep', idx: [0, 1] }); // 200 + 200 = 400
  assert.equal(Z.handle(g, 'b', { t: 'bank' }).ok, false);
  Z.handle(g, 'b', { t: 'roll' }, fixed(5));
  Z.handle(g, 'b', { t: 'keep', idx: [0] }); // 450 – noch immer zu wenig
  assert.equal(g.turn.pts, 450);
  assert.equal(Z.handle(g, 'b', { t: 'bank' }).ok, false);
  // Ohne Hürde sofort möglich
  const h = mk(P2, { entry: false });
  Z.handle(h, 'a', { t: 'roll' }, fixed(1, 2, 3, 4, 6, 6));
  Z.handle(h, 'a', { t: 'keep', idx: [0] });
  assert.equal(Z.handle(h, 'a', { t: 'bank' }).ok, true);
  assert.equal(h.players[0].score, 100);
});

test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = mk();
  const before = JSON.stringify(g);
  for (const m of [null, undefined, 'roll', 5, {}, { t: 'x' }, { t: 'keep' }, { t: 'keep', idx: [0] }, { t: 'bank' }, { t: 'next' }]) {
    assert.equal(Z.handle(g, 'a', m).ok, false, JSON.stringify(m));
  }
  assert.equal(Z.handle(g, 'b', { t: 'roll' }).ok, false, 'falsche Person');
  assert.equal(Z.handle(g, 'zz', { t: 'roll' }).ok, false);
  assert.equal(JSON.stringify(g), before, 'abgelehnte Nachrichten verändern nichts');
  Z.handle(g, 'a', { t: 'roll' }, fixed(1, 1, 2, 3, 4, 6));
  const snap = JSON.stringify(g);
  assert.equal(g.turn.phase, 'pick');
  for (const idx of [[], [6], [-1], [0, 0], [1.5], ['0'], 'x', null, [0, 2], [2], [0, 1, 2], [0, 1, 2, 3, 4, 5, 6]]) {
    assert.equal(Z.handle(g, 'a', { t: 'keep', idx }).ok, false, JSON.stringify(idx));
  }
  assert.equal(Z.handle(g, 'a', { t: 'roll' }).ok, false, 'erst Würfel zur Seite legen');
  assert.equal(Z.handle(g, 'a', { t: 'bank' }).ok, false);
  assert.equal(Z.handle(g, 'a', { t: 'next' }).ok, false);
  assert.equal(Z.handle(g, 'b', { t: 'keep', idx: [0] }).ok, false);
  assert.equal(JSON.stringify(g), snap);
  assert.equal(Z.handle(g, 'a', { t: 'keep', idx: [1, 0] }).pts, 200, 'Reihenfolge der Indizes egal');
});

// ---------- Schlussrunde ----------
function setupNearEnd(opts = { entry: false, short: true }, n = 3) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = Z.createGame(players, opts, seedRng(3));
  g.players.forEach((p) => { p.entered = true; });
  return g;
}
const bankWith = (g, pid, vals, idx, ...more) => {
  Z.handle(g, pid, { t: 'roll' }, fixed(...vals));
  Z.handle(g, pid, { t: 'keep', idx });
  return Z.handle(g, pid, { t: 'bank' });
};

test('Schlussrunde: Ziel erreicht, alle anderen noch ein Zug, dann Ende', () => {
  const g = setupNearEnd();
  g.players[0].score = 4000; g.players[1].score = 4800; g.players[2].score = 2000;
  const r = bankWith(g, 'p0', [1, 1, 1, 2, 3, 4], [0, 1, 2]); // +1000 = 5000
  assert.equal(r.ok, true);
  assert.equal(g.finalFrom, 0); assert.equal(g.finalLeft, 2); assert.equal(g.mode, 'play');
  assert.ok(g.recap.some((l) => /Alle anderen haben noch einen Zug/.test(l)));
  Z.handle(g, 'p0', { t: 'next' });
  assert.equal(g.active, 1);
  // p1 patzt: Zug verbraucht
  Z.handle(g, 'p1', { t: 'roll' }, fixed(2, 3, 4, 6, 6, 2));
  assert.equal(g.finalLeft, 1); assert.equal(g.mode, 'play');
  Z.handle(g, 'p1', { t: 'next' });
  // p2 bucht und das Spiel endet sofort
  bankWith(g, 'p2', [5, 5, 5, 2, 3, 4], [0, 1, 2]);
  assert.equal(g.mode, 'over');
  const rank = Z.ranking(g);
  assert.equal(rank[0].id, 'p0'); assert.equal(rank[0].score, 5000);
  assert.equal(Z.winners(g).length, 1);
});

test('Schlussrunde: Überholen in der Schlussrunde, Gleichstand und weitere Zielerreicher', () => {
  const g = setupNearEnd({ entry: false, short: true });
  g.players[0].score = 4900; g.players[1].score = 4950; g.players[2].score = 0;
  bankWith(g, 'p0', [1, 2, 3, 4, 6, 6], [0]); // 5000
  Z.handle(g, 'p0', { t: 'next' });
  bankWith(g, 'p1', [1, 1, 2, 3, 4, 6], [0, 1]); // 4950+200 = 5150, überholt, löst aber nichts Neues aus
  assert.equal(g.finalFrom, 0); assert.equal(g.finalLeft, 1);
  Z.handle(g, 'p1', { t: 'next' });
  Z.handle(g, 'p2', { t: 'roll' }, fixed(2, 3, 4, 6, 6, 2));
  assert.equal(g.mode, 'over');
  const w = Z.winners(g);
  assert.equal(w.length, 1); assert.equal(w[0].id, 'p1');
  // Gleichstand
  const h = setupNearEnd({ entry: false, short: true }, 2);
  h.players[0].score = 4900; h.players[1].score = 4900;
  bankWith(h, 'p0', [1, 2, 3, 4, 6, 6], [0]);
  Z.handle(h, 'p0', { t: 'next' });
  bankWith(h, 'p1', [1, 2, 3, 4, 6, 6], [0]);
  assert.equal(h.mode, 'over');
  assert.equal(Z.winners(h).length, 2);
  assert.ok(Z.ranking(h).every((r) => r.tie));
});

test('Schlussrunde: nicht erreicht, Spiel läuft weiter; Ziel 10 000 / Kurzspiel 5000', () => {
  const g = setupNearEnd({ entry: false, short: false });
  g.players[0].score = 4000;
  bankWith(g, 'p0', [1, 1, 1, 2, 3, 4], [0, 1, 2]);
  assert.equal(g.finalFrom, null);
  const h = setupNearEnd({ entry: false, short: false });
  h.players[0].score = 9000;
  bankWith(h, 'p0', [1, 1, 1, 2, 3, 4], [0, 1, 2]);
  assert.equal(h.finalFrom, 0);
  const k = setupNearEnd({ entry: false, short: false });
  k.players[0].score = 9950; // 50 fehlen
  bankWith(k, 'p0', [5, 2, 3, 4, 6, 6], [0]);
  assert.equal(k.finalFrom, 0, 'genau 10000 genügt');
});

test('Solo: Zugzählung und Ende beim Erreichen des Ziels', () => {
  const g = Z.createGame([{ id: 'a', name: 'Anna' }], { entry: false, short: true }, seedRng(1));
  let turns = 0;
  while (g.mode === 'play' && turns < 100) {
    Z.handle(g, 'a', { t: 'roll' }, fixed(1, 1, 1, 5, 5, 5));
    Z.handle(g, 'a', { t: 'keep', idx: [0, 1, 2, 3, 4, 5] }); // 1000 + 500 = 1500 heiße Würfel
    Z.handle(g, 'a', { t: 'bank' });
    turns++;
    if (g.mode === 'play') Z.handle(g, 'a', { t: 'next' });
  }
  assert.equal(turns, 4); // 4 × 1500 = 6000 ≥ 5000 (3 × 1500 = 4500 reicht nicht)
  assert.equal(g.mode, 'over'); assert.equal(g.players[0].turns, 4); assert.equal(g.finalFrom, null);
  assert.equal(Z.ranking(g)[0].turns, 4);
  // Patzer zählen als Zug
  const h = Z.createGame([{ id: 'a', name: 'Anna' }], { entry: false }, seedRng(1));
  Z.handle(h, 'a', { t: 'roll' }, fixed(2, 3, 4, 6, 6, 2));
  assert.equal(h.players[0].turns, 1);
  Z.handle(h, 'a', { t: 'next' });
  assert.equal(h.active, 0); assert.equal(h.round, 2);
});

test('Nach Spielende nimmt das Spiel nichts mehr an', () => {
  const g = Z.createGame([{ id: 'a', name: 'Anna' }], { entry: false, short: true }, seedRng(1));
  g.players[0].score = 4950;
  bankWith(g, 'a', [5, 2, 3, 4, 6, 6], [0]);
  assert.equal(g.mode, 'over');
  for (const m of [{ t: 'roll' }, { t: 'next' }, { t: 'bank' }, { t: 'keep', idx: [0] }]) assert.equal(Z.handle(g, 'a', m).ok, false);
});

// ---------- Zufallspartien ----------
function randomAction(g, brain) {
  const t = g.turn;
  const ap = Z.activePlayer(g);
  if (t.phase === 'start') return { t: 'roll' };
  if (t.phase === 'end') return { t: 'next' };
  if (t.phase === 'pick') {
    // zufällige gültige Teilmenge
    const subs = [];
    for (let m = 1; m < (1 << t.dice.length); m++) {
      const idx = t.dice.map((_, i) => i).filter((i) => m & (1 << i));
      if (Z.scoreExact(idx.map((i) => t.dice[i]), g.opts) > 0) subs.push(idx);
    }
    assert.ok(subs.length > 0, 'nach einem Wurf ohne Patzer gibt es eine Wertung');
    return { t: 'keep', idx: subs[Math.floor(brain() * subs.length)] };
  }
  return Z.canBank(g, ap, t) && brain() < 0.5 ? { t: 'bank' } : { t: 'roll' };
}

test('Zufallspartien: enden immer, Bilanz stimmt, Zustand bleibt JSON', () => {
  let games = 0;
  for (let seed = 1; seed <= 240; seed++) {
    const n = 1 + (seed % 6);
    const opts = { pairs: seed % 3 !== 0, entry: seed % 4 !== 0, short: seed % 2 === 0 };
    const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
    const g = Z.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), opts, dice);
    const gained = Array(n).fill(0);
    let steps = 0;
    while (g.mode === 'play' && steps++ < 100000) {
      const ap = Z.activePlayer(g);
      const prev = ap.score;
      const msg = randomAction(g, brain);
      const r = Z.handle(g, ap.id, msg, dice);
      assert.equal(r.ok, true, `${JSON.stringify(msg)} ${r.error}`);
      gained[g.active] += ap.score - prev;
      // Invarianten
      const t = g.turn;
      assert.ok(t.aside.length <= 6 && t.pts >= 0 && t.pts % 50 === 0);
      assert.ok(g.players.every((p) => p.score >= 0 && p.score % 50 === 0));
      if (g.mode === 'play' && t.phase === 'after') assert.equal(Z.diceLeft(t) + (t.hot ? 0 : t.aside.length), 6);
      if (steps % 97 === 0) assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
    }
    assert.equal(g.mode, 'over', `Partie ${seed} endet`);
    games++;
    // Bilanz: Konto = Summe der gebuchten Zugpunkte
    g.players.forEach((p, i) => assert.equal(p.score, gained[i]));
    const target = Z.targetOf(g);
    const reached = g.players.filter((p) => p.score >= target);
    assert.ok(reached.length >= 1, 'jemand hat das Ziel erreicht');
    if (n > 1) {
      // alle anderen hatten genau einen Zug in der Schlussrunde: Zugzahlen unterscheiden sich um höchstens 1
      const ts = g.players.map((p) => p.turns);
      assert.ok(Math.max(...ts) - Math.min(...ts) <= 1, `Zugzahlen ${ts}`);
      assert.ok(g.players[g.finalFrom].score >= target);
    }
    const rank = Z.ranking(g);
    assert.equal(rank[0].score, Math.max(...g.players.map((p) => p.score)));
    assert.ok(Z.winners(g).length >= 1);
  }
  assert.equal(games, 240);
});

test('Hürde in Zufallspartien: erstes Buchen immer mindestens 500', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const dice = seedRng(seed), brain = seedRng(seed + 99);
    const g = Z.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { entry: true, short: true }, dice);
    let guard = 0;
    while (g.mode === 'play' && guard++ < 50000) {
      const ap = Z.activePlayer(g);
      const was = ap.entered;
      const prev = ap.score;
      const r = Z.handle(g, ap.id, randomAction(g, brain), dice);
      assert.ok(r.ok);
      if (!was && ap.score > prev) assert.ok(ap.score - prev >= 500);
    }
  }
});

test('Würfel sind gleichverteilt und liegen zwischen 1 und 6', () => {
  const r = seedRng(11);
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) c[Z.rollDie(r)] += 1;
  assert.equal(c[0], 0);
  for (let v = 1; v <= 6; v++) assert.ok(c[v] > 800 && c[v] < 1200, `Augenzahl ${v}: ${c[v]}`);
  assert.equal(Z.rollDie(() => 0.9999999), 6); assert.equal(Z.rollDie(() => 0), 1); assert.equal(Z.rollDie(() => 1), 6);
});
