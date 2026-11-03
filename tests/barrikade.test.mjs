import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../barrikade/engine.js';

const mk = (n = 2) => B.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
const id = B.nodeId;
// Leeres Brett für gezielte Tests: keine Sperren, alle Figuren im Haus
function bare(n = 2) {
  const g = mk(n);
  g.barriers = [];
  return g;
}
const put = (g, pieceId, pos) => { g.pieces.find((p) => p.id === pieceId).pos = pos; };
const setRoll = (g, die) => { g.phase = 'move'; g.die = die; };
// Deterministischer Zufall
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fixed = (n) => () => (n - 1) / 6 + 0.01; // würfelt immer n

// ---------- Wegenetz ----------
test('Wegenetz: Knoten- und Kantenzahl', () => {
  assert.equal(B.NODE_IDS.length, 112); // 111 Felder + Ziel
  assert.equal(B.EDGES.length, 121);
  assert.equal(B.NODE_IDS.filter((x) => B.NODES[x].r === 12).length, 17);
  assert.equal(B.NODE_IDS.filter((x) => B.NODES[x].r === 10).length, 17);
  assert.equal(B.NODE_IDS.filter((x) => B.NODES[x].r === 6).length, 9);
});
test('Wegenetz: symmetrisch, ohne Doppelkanten und Selbstschleifen', () => {
  for (const n of Object.values(B.NODES)) {
    assert.equal(new Set(n.nbrs).size, n.nbrs.length);
    for (const m of n.nbrs) {
      assert.notEqual(m, n.id);
      assert.ok(B.NODES[m].nbrs.includes(n.id), `${n.id} <-> ${m}`);
    }
  }
  const keys = new Set(B.EDGES.map(([a, b]) => [a, b].sort().join('|')));
  assert.equal(keys.size, B.EDGES.length);
});
test('Wegenetz: alle Felder vom Ziel erreichbar, Ziel ist Sackgasse', () => {
  for (const x of B.NODE_IDS) assert.ok(Number.isFinite(B.DIST_TO_GOAL[x]), x);
  assert.deepEqual(B.NODES[B.GOAL].nbrs, [id(0, 8)]);
  assert.equal(B.DIST_TO_GOAL[id(0, 8)], 1);
  assert.equal(B.DIST_TO_GOAL[id(0, 0)], 9);
  assert.equal(B.DIST_TO_GOAL[id(2, 8)], 19); // Zwischen Reihe 2 und 0 gibt es nur die Verbindungen ganz links und ganz rechts
  assert.equal(B.DIST_TO_GOAL[id(4, 8)], 21);
});
test('Wegenetz: Eigenheiten nach dem Plan (Kreuzungen, Lücken)', () => {
  assert.deepEqual([...B.NODES[id(3, 8)].nbrs].sort(), [id(2, 8), id(4, 8)].sort());
  assert.ok(!B.NODES[id(1, 5)]);
  assert.deepEqual([...B.NODES[id(1, 0)].nbrs].sort(), [id(0, 0), id(2, 0)].sort());
  assert.ok(B.NODES[id(9, 6)].nbrs.includes(id(8, 6)) && B.NODES[id(9, 6)].nbrs.includes(id(10, 6)));
  assert.equal(B.NODES[id(9, 6)].nbrs.length, 2);
  assert.equal(B.NODES[id(10, 4)].nbrs.length, 3); // links, rechts, unten ((9,4) gibt es nicht)
  assert.equal(Math.max(...Object.values(B.NODES).map((n) => n.nbrs.length)), 3); // nur Abzweigungen, keine Vierer-Kreuzung
});
test('Wegenetz: 11 Start-Sperren auf existierenden Feldern, nicht in der untersten Reihe', () => {
  assert.equal(B.START_BARRIERS.length, 11);
  assert.equal(new Set(B.START_BARRIERS).size, 11);
  for (const b of B.START_BARRIERS) { assert.ok(B.NODES[b]); assert.ok(B.NODES[b].r < 12); }
  for (const c of ['R', 'G', 'Y', 'B']) assert.ok(B.NODES[B.START_NODE[c]]);
});

// ---------- Aufbau ----------
test('Aufbau: Farben je nach Personenzahl, 5 Figuren im Haus', () => {
  assert.deepEqual(mk(2).players.map((p) => p.color), ['R', 'B']);
  assert.deepEqual(mk(3).players.map((p) => p.color), ['R', 'Y', 'B']);
  assert.deepEqual(mk(4).players.map((p) => p.color), ['R', 'G', 'Y', 'B']);
  const g = mk(4);
  assert.equal(g.pieces.length, 20);
  assert.ok(g.pieces.every((p) => p.pos === 'H'));
  assert.equal(g.barriers.length, 11);
  assert.equal(g.phase, 'roll');
  assert.throws(() => B.createGame([{ id: 'a', name: 'A' }]));
});

// ---------- Zugerzeugung ----------
test('Haus: erster Schritt ist das Startfeld', () => {
  const g = bare();
  const piece = g.pieces[0]; // Rot
  const t1 = B.targetsFor(g, piece, 1);
  assert.deepEqual([...t1.keys()], [B.START_NODE.R]);
  const t2 = B.targetsFor(g, piece, 2);
  assert.deepEqual([...t2.keys()].sort(), [id(12, 1), id(12, 3)].sort()); // (11,2) existiert nicht
  // Auslegung "Start zählt nicht": von dort n Felder
  const t2b = B.targetsFor(g, piece, 2, false);
  assert.ok(t2b.has(id(12, 0)) && t2b.has(id(12, 4)));
  assert.ok(!t2b.has(B.START_NODE.R));
});
test('Genaue Schrittzahl, kein Knoten doppelt im Weg, keine Umkehr', () => {
  const g = bare();
  put(g, 'R0', id(8, 8));
  for (let n = 1; n <= 6; n++) {
    const t = B.targetsFor(g, g.pieces[0], n);
    assert.ok(t.size > 0);
    for (const [to, path] of t) {
      assert.equal(path.length, n);
      assert.equal(path[n - 1], to);
      assert.equal(new Set([id(8, 8), ...path]).size, n + 1);
      let cur = id(8, 8);
      for (const step of path) { assert.ok(B.NODES[cur].nbrs.includes(step)); cur = step; }
    }
  }
  // Mit 2 Schritten nie zurück auf das Startfeld
  assert.ok(!B.targetsFor(g, g.pieces[0], 2).has(id(8, 8)));
  // Drei Schritte um die Ecke (8,8) -> (8,9) -> (8,10) -> (9,10): Abbiegen erlaubt
  assert.ok(B.targetsFor(g, g.pieces[0], 3).has(id(9, 10)));
});
test('Keine Figur zieht auf eigenem Weg im Kreis zurück (Sackgasse Ziel)', () => {
  const g = bare();
  put(g, 'R0', id(0, 8));
  assert.ok(B.targetsFor(g, g.pieces[0], 1).has(B.GOAL));
  assert.ok(!B.targetsFor(g, g.pieces[0], 2).has(B.GOAL)); // Ziel nur mit genauem Wurf
  put(g, 'R0', id(0, 6));
  assert.ok(B.targetsFor(g, g.pieces[0], 3).has(B.GOAL));
  assert.ok(!B.targetsFor(g, g.pieces[0], 4).has(B.GOAL));
  assert.ok(!B.targetsFor(g, g.pieces[0], 2).has(B.GOAL));
});
test('Sperren: nicht überspringbar, nur als letztes Feld betretbar', () => {
  const g = bare();
  g.barriers = [id(12, 8)];
  put(g, 'R0', id(12, 5));
  const t3 = B.targetsFor(g, g.pieces[0], 3);
  assert.ok(t3.has(id(12, 8)));
  const t4 = B.targetsFor(g, g.pieces[0], 4);
  assert.ok(!t4.has(id(12, 9)), 'nicht hinter der Sperre');
  for (const path of t4.values()) assert.ok(!path.slice(0, -1).includes(id(12, 8)));
  // Weg außen herum bleibt möglich, wenn kurz genug
  put(g, 'R0', id(10, 8));
  g.barriers = [id(10, 9)];
  const t = B.targetsFor(g, g.pieces[0], 2);
  assert.ok(!t.has(id(10, 10)));
  // Sperre im ersten Schritt: man kann nur mit Wurf 1 drauf
  assert.ok(B.targetsFor(g, g.pieces[0], 1).has(id(10, 9)));
});
test('Springen über eigene und fremde Figuren erlaubt', () => {
  const g = bare();
  put(g, 'R0', id(12, 5));
  put(g, 'R1', id(12, 6));
  put(g, 'B0', id(12, 7));
  const t = B.targetsFor(g, g.pieces[0], 3);
  assert.ok(t.has(id(12, 8)));
});
test('Nicht auf die eigene Figur, aber auf eine fremde (Rauswerfen)', () => {
  const g = bare();
  put(g, 'R0', id(12, 5));
  put(g, 'R1', id(12, 7));
  put(g, 'B0', id(12, 3));
  const t = B.targetsFor(g, g.pieces[0], 2);
  assert.ok(!t.has(id(12, 7)));
  assert.ok(t.has(id(12, 3)));
  // Haus: Startfeld mit eigener Figur blockiert Wurf 1
  const h = bare();
  put(h, 'R1', B.START_NODE.R);
  assert.equal(B.targetsFor(h, h.pieces[0], 1).size, 0);
  assert.ok(B.targetsFor(h, h.pieces[0], 2).size > 0); // darüber springen geht
});
test('Rauswerfen: Figur kommt ins Haus zurück, Zug endet', () => {
  const g = bare();
  put(g, 'R0', id(12, 5));
  put(g, 'B0', id(12, 3));
  setRoll(g, 2);
  const r = B.move(g, 'p0', 'R0', id(12, 3));
  assert.ok(r.ok);
  assert.equal(g.pieces.find((p) => p.id === 'B0').pos, 'H');
  assert.equal(g.pieces.find((p) => p.id === 'R0').pos, id(12, 3));
  assert.equal(g.active, 1);
  assert.equal(g.phase, 'roll');
  assert.match(g.recap[0], /hinausgeworfen/);
});
test('Rauswerfen aus dem Haus-Startfeld heraus', () => {
  const g = bare();
  put(g, 'B0', B.START_NODE.R);
  setRoll(g, 1);
  assert.ok(B.move(g, 'p0', 'R0', B.START_NODE.R).ok);
  assert.equal(g.pieces.find((p) => p.id === 'B0').pos, 'H');
});
test('Ziel nur mit genauem Wurf, Spiel endet sofort', () => {
  const g = bare();
  put(g, 'R0', id(0, 6));
  setRoll(g, 4);
  assert.equal(B.move(g, 'p0', 'R0', B.GOAL).ok, false);
  assert.equal(g.phase, 'move');
  setRoll(g, 3);
  const r = B.move(g, 'p0', 'R0', B.GOAL);
  assert.ok(r.ok && r.won);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
  assert.equal(B.roll(g, 'p1').ok, false);
  const rk = B.ranking(g);
  assert.equal(rk[0].id, 'p0');
  assert.equal(rk.length, 2);
});
test('Ziel mit Rauswerfen über die Sperre auf (0,8): Sperre blockiert den Weg', () => {
  const g = mk(2); // Start-Sperre liegt auf (0,8)
  put(g, 'R0', id(0, 6));
  assert.ok(!B.targetsFor(g, g.pieces[0], 3).has(B.GOAL));
  assert.ok(B.targetsFor(g, g.pieces[0], 2).has(id(0, 8)));
});

// ---------- Sperre versetzen ----------
test('Sperre aufnehmen und versetzen', () => {
  const g = mk(2);
  put(g, 'R0', id(4, 6));
  setRoll(g, 2);
  const r = B.move(g, 'p0', 'R0', id(4, 8));
  assert.ok(r.ok && r.place);
  assert.equal(g.phase, 'place');
  assert.equal(g.hand, 1);
  assert.equal(g.barriers.length, 10);
  assert.equal(g.active, 0); // noch dieselbe Person
  const tg = B.placeTargets(g);
  assert.ok(tg.length > 0);
  for (const t of tg) {
    assert.ok(B.NODES[t].r < 12);
    assert.notEqual(t, B.GOAL);
    assert.ok(!g.barriers.includes(t));
    assert.ok(!g.pieces.some((p) => p.pos === t));
  }
  assert.ok(!tg.includes(id(12, 4)));
  assert.ok(!tg.includes(id(4, 8))); // dort steht jetzt die Figur
  // ungültige Ziele
  for (const bad of [id(12, 3), B.GOAL, id(4, 8), id(0, 8), 'xx', null, 5, undefined]) {
    assert.equal(B.place(g, 'p0', bad).ok, false, String(bad));
  }
  assert.equal(B.place(g, 'p1', id(1, 0)).ok, false);
  assert.equal(g.hand, 1);
  assert.ok(B.place(g, 'p0', id(1, 0)).ok);
  assert.equal(g.hand, 0);
  assert.equal(g.barriers.length, 11);
  assert.ok(g.barriers.includes(id(1, 0)));
  assert.equal(g.active, 1);
  assert.equal(g.phase, 'roll');
});
test('Gegnerisches Rauswerfen auf Sperrenfeld gibt es nicht gleichzeitig; in der Hand kein Würfeln', () => {
  const g = mk(2);
  put(g, 'R0', id(4, 6));
  setRoll(g, 2);
  B.move(g, 'p0', 'R0', id(4, 8));
  assert.equal(B.roll(g, 'p0').ok, false);
  assert.equal(B.move(g, 'p0', 'R0', id(4, 7)).ok, false);
});

// ---------- Zugzwang / Passen ----------
test('Kein Zug möglich: Wurf verfällt, nächste Person ist dran (Zugzwang gilt nur, wenn ein Zug existiert)', () => {
  // Rot hat nur eine Figur (R0) in (0,0), Nachbarn (0,1) und (1,0) sind durch Blau besetzt -> mit 1 sind das Rauswurf-Züge, also Zug da.
  // Mit Sperren statt Figuren: betreten mit genau 1 ist auch ein Zug. Kein Zug entsteht nur bei Wurf>=2 mit Sperren direkt vor der Figur:
  const g = bare();
  g.pieces = g.pieces.filter((p) => p.color === 'B' || p.id === 'R0');
  put(g, 'R0', id(1, 0));
  g.barriers = [id(0, 0), id(2, 0)];
  const r = B.roll(g, 'p0', fixed(2));
  assert.ok(r.ok);
  assert.equal(r.passed, true);
  assert.equal(g.active, 1);
  assert.equal(g.phase, 'roll');
  assert.match(g.recap[0], /kann aber nicht ziehen/);
  assert.equal(g.die, 2);
  // mit Wurf 1 geht es (Sperre aufnehmen)
  g.active = 0; g.phase = 'roll';
  assert.equal(B.roll(g, 'p0', fixed(1)).passed, false);
});

// ---------- Ungültige Nachrichten ----------
test('Ungültige Nachrichten ändern den Zustand nie', () => {
  const g = mk(3);
  const snap = () => JSON.stringify(g);
  const before = snap();
  assert.equal(B.roll(g, 'p1').ok, false); // nicht dran
  assert.equal(B.roll(g, 'niemand').ok, false);
  assert.equal(B.move(g, 'p0', 'R0', id(12, 2)).ok, false); // noch nicht gewürfelt
  assert.equal(B.place(g, 'p0', id(1, 0)).ok, false);
  assert.equal(snap(), before);
  B.roll(g, 'p0', fixed(2));
  const mid = snap();
  assert.equal(B.roll(g, 'p0').ok, false); // doppelt würfeln
  assert.equal(B.move(g, 'p1', 'B0', id(12, 14)).ok, false); // falsche Person
  assert.equal(B.move(g, 'p0', 'B0', id(12, 13)).ok, false); // fremde Figur
  assert.equal(B.move(g, 'p0', 'R0', id(12, 6)).ok, false); // falsches Zielfeld
  assert.equal(B.move(g, 'p0', 'nix', id(12, 3)).ok, false);
  assert.equal(B.move(g, 'p0', 'R0', undefined).ok, false);
  assert.equal(B.move(g, 'p0', {}, {}).ok, false);
  assert.equal(B.move(g, 'p0', 'R0', '__proto__').ok, false);
  assert.equal(B.place(g, 'p0', id(1, 0)).ok, false);
  assert.equal(snap(), mid);
});

// ---------- Zufallspartien ----------
function invariants(g) {
  const seen = new Set();
  for (const p of g.pieces) {
    if (p.pos === 'H') continue;
    assert.ok(B.NODES[p.pos], 'Feld existiert ' + p.pos);
    assert.ok(!seen.has(p.pos), 'zwei Figuren auf ' + p.pos);
    seen.add(p.pos);
  }
  assert.equal(new Set(g.barriers).size, g.barriers.length, 'Sperre doppelt');
  for (const b of g.barriers) { assert.ok(!seen.has(b), 'Figur auf Sperre ' + b); assert.ok(B.NODES[b]); assert.notEqual(b, B.GOAL); }
  assert.equal(g.barriers.length + g.hand, 11);
  assert.ok(g.hand === 0 || g.phase === 'place');
  for (const p of g.players) assert.equal(g.pieces.filter((x) => x.color === p.color).length, 5);
  assert.equal(g.pieces.length, g.players.length * 5);
}
function playRandom(n, seed, greedy, limit = 60000) {
  const rng = mulberry(seed);
  const g = mk(n);
  let steps = 0;
  const LIMIT = limit;
  let passes = 0; let captures = 0; let barrierMoves = 0;
  while (g.phase !== 'over' && steps++ < LIMIT) {
    const pid = B.activePlayer(g).id;
    if (g.phase === 'roll') {
      const r = B.roll(g, pid, rng);
      assert.ok(r.ok);
      if (r.passed) passes++;
    } else if (g.phase === 'move') {
      const ms = B.legalMoves(g);
      assert.ok(ms.length > 0, 'Zugzwang: es gibt Züge');
      let m = ms[Math.floor(rng() * ms.length)];
      if (greedy && rng() < greedy) {
        let best = Infinity;
        for (const x of ms) { const d = B.DIST_TO_GOAL[x.to]; if (d < best) { best = d; m = x; } }
      }
      const before = g.pieces.filter((p) => p.pos === 'H').length;
      const res = B.move(g, pid, m.piece, m.to);
      assert.ok(res.ok, JSON.stringify(res));
      if (g.pieces.filter((p) => p.pos === 'H').length > before) captures++;
      if (res.place) barrierMoves++;
    } else if (g.phase === 'place') {
      const tg = B.placeTargets(g);
      assert.ok(tg.length > 0);
      assert.ok(B.place(g, pid, tg[Math.floor(rng() * tg.length)]).ok);
    }
    invariants(g);
  }
  return { g, steps, passes, captures, barrierMoves };
}
test('Zufallspartien (rein zufällig, begrenzt) 2/3/4 Personen: Invarianten halten', () => {
  let caps = 0; let bars = 0;
  for (let i = 0; i < 30; i++) {
    const r = playRandom(2 + (i % 3), 1000 + i, 0, 4000);
    caps += r.captures; bars += r.barrierMoves;
    if (r.g.phase === 'over') {
      assert.ok(r.g.winner);
      assert.equal(r.g.pieces.filter((p) => p.pos === B.GOAL).length, 1);
    }
  }
  assert.ok(caps > 0 && bars > 0, 'Rauswerfen und Sperren kommen vor');
});
test('Zufallspartien (meist zufällig, gelegentlich zielstrebig) enden alle', () => {
  for (let i = 0; i < 60; i++) {
    const r = playRandom(2 + (i % 3), 3000 + i, 0.3);
    assert.equal(r.g.phase, 'over', `Partie ${i} nach ${r.steps} Schritten nicht beendet`);
  }
});
test('Zufallspartien mit zielstrebigen Zügen: alle enden, genau ein Gewinner', () => {
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 3);
    const r = playRandom(n, 5000 + i, 0.8);
    assert.equal(r.g.phase, 'over', `Partie ${i} (${n} Personen) nach ${r.steps} Schritten nicht beendet`);
    assert.equal(r.g.pieces.filter((p) => p.pos === B.GOAL).length, 1);
    const w = B.playerById(r.g, r.g.winner);
    assert.ok(r.g.pieces.some((p) => p.pos === B.GOAL && p.color === w.color));
    assert.equal(B.ranking(r.g)[0].id, w.id);
  }
});
test('Zufallspartien ändern bei abgelehnten Zügen nie den Zustand', () => {
  const rng = mulberry(42);
  const g = mk(4);
  for (let k = 0; k < 600 && g.phase !== 'over'; k++) {
    const pid = B.activePlayer(g).id;
    // Störversuche
    const before = JSON.stringify(g);
    const junk = [
      () => B.move(g, 'x', 'R0', id(12, 2)),
      () => B.place(g, pid, id(12, 5)),
      () => B.move(g, pid, 'R0', 'q'),
      () => B.roll(g, g.players[(g.active + 1) % g.players.length].id),
    ];
    for (const f of junk) {
      const r = f();
      if (r.ok) { assert.fail('Störversuch wurde akzeptiert'); }
    }
    // (move/place/roll mit gültigem Spieler in falscher Phase ändern nichts)
    if (g.phase === 'roll') { assert.equal(JSON.stringify(g), before); B.roll(g, pid, rng); }
    else if (g.phase === 'move') { const ms = B.legalMoves(g); const m = ms[Math.floor(rng() * ms.length)]; B.move(g, pid, m.piece, m.to); }
    else if (g.phase === 'place') { const t = B.placeTargets(g); B.place(g, pid, t[Math.floor(rng() * t.length)]); }
    invariants(g);
  }
});
test('Sperre geschlagen: es gibt immer 11 Sperren (Brett + Hand) über eine ganze Partie', () => {
  const r = playRandom(4, 777, 0.7);
  assert.equal(r.g.barriers.length + r.g.hand, 11);
});
