import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../kachelstadt/engine.js';

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
const pick = (a, rng) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))];
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- unabhängige Hilfen (nicht aus der Engine abgeleitet) ----------
const kindAt = (t, r, p) => {
  const s = E.rotatedSegments(t, r).find((q) => q.p.includes(p));
  return s ? s.k : null;
};
const DXY = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function edgesFit(ta, ra, tb, rb, side) { // tb liegt auf Seite `side` von ta
  for (let i = 0; i < 3; i++) {
    const p = side * 3 + i;
    const q = ((side + 2) % 4) * 3 + (2 - i);
    if (kindAt(ta, ra, p) !== kindAt(tb, rb, q)) return false;
  }
  return true;
}
function consistent(board) {
  for (const k of Object.keys(board)) {
    const [x, y] = k.split(',').map(Number);
    for (let s = 0; s < 4; s++) {
      const nb = board[(x + DXY[s][0]) + ',' + (y + DXY[s][1])];
      if (nb && !edgesFit(board[k].t, board[k].r, nb.t, nb.r, s)) return false;
    }
  }
  return true;
}
function bruteForce(board, t) {
  const ks = Object.keys(board).map((k) => k.split(',').map(Number));
  const xs = ks.map((a) => a[0]), ys = ks.map((a) => a[1]);
  const out = [];
  for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y++) {
    for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x++) {
      if (board[x + ',' + y]) continue;
      for (let r = 0; r < 4; r++) {
        let touch = false, ok = true;
        for (let s = 0; s < 4; s++) {
          const nb = board[(x + DXY[s][0]) + ',' + (y + DXY[s][1])];
          if (!nb) continue;
          touch = true;
          if (!edgesFit(t, r, nb.t, nb.r, s)) ok = false;
        }
        if (touch && ok) out.push(`${x},${y},${r}`);
      }
    }
  }
  return out.sort();
}

const names = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
// Brettstellung bauen: tiles = [[x,y,typ,r,[[spieler,seg],...]]]
function mk(n, tiles, o = {}) {
  const s = E.createGame(names(n), {}, mulberry(1));
  s.board = {};
  for (const [x, y, t, r, ms = []] of tiles) {
    s.board[x + ',' + y] = { t, r, m: ms.map(([p, seg]) => ({ p, seg })) };
    for (const [p] of ms) s.players[p].meeples--;
  }
  assert.ok(consistent(s.board), 'Teststellung inkonsistent');
  s.deck = o.deck ?? ['B', 'B', 'B', 'B'];
  s.deckLeft = s.deck.length;
  s.current = o.current;
  s.phase = 'place';
  s.active = o.active ?? 0;
  s.last = null; s.recap = []; s.round = tiles.length;
  return s;
}
const turn = (s, x, y, r, seg = null) => {
  const pid = E.activePlayer(s).id;
  let a = E.placeTile(s, pid, x, y, r);
  assert.equal(a.ok, true, a.error);
  if (s.phase === 'meeple') { a = E.placeMeeple(s, pid, seg); assert.equal(a.ok, true, a.error); }
};
const scores = (s) => s.players.map((p) => p.score);
const hands = (s) => s.players.map((p) => p.meeples);

// ---------- Plättchendaten ----------
test('Plättchendaten: 72 Plättchen, 24 Typen, 10 Wappen', () => {
  assert.equal(E.TILE_TYPES.length, 24);
  assert.equal(Object.values(E.TILE_COUNTS).reduce((a, b) => a + b, 0), 72);
  assert.deepEqual(Object.keys(E.TILES).sort(), Object.keys(E.TILE_COUNTS).sort());
  let shields = 0;
  for (const t of E.TILE_TYPES) shields += E.TILE_COUNTS[t] * E.TILES[t].filter((s) => s.shield).length;
  assert.equal(shields, 10);
  assert.equal(E.START_TILE, 'D');
  const s = E.createGame(names(3), {}, mulberry(3));
  assert.equal(s.deck.length + 1 + 1 + s.discarded.length, 72); // Stapel + Startplättchen + gezogenes
});

test('Jede Randposition gehört genau einem Segment; Segmente sind stimmig', () => {
  for (const t of E.TILE_TYPES) {
    const cnt = Array(12).fill(0);
    E.TILES[t].forEach((seg) => {
      assert.ok(['city', 'road', 'field', 'monastery'].includes(seg.k));
      if (seg.k === 'monastery') assert.equal(seg.p.length, 0);
      else assert.ok(seg.p.length > 0, t);
      if (seg.shield) assert.equal(seg.k, 'city');
      if (seg.adj) { assert.equal(seg.k, 'field'); for (const a of seg.adj) assert.equal(E.TILES[t][a].k, 'city'); }
      for (const p of seg.p) { assert.ok(p >= 0 && p < 12); cnt[p]++; }
    });
    assert.deepEqual(cnt, Array(12).fill(1), 'Typ ' + t);
    // Straßen: Positionen liegen in Kantenmitte (1 mod 3)
    for (const seg of E.TILES[t]) if (seg.k === 'road') for (const p of seg.p) assert.equal(p % 3, 1, t);
    // Städte belegen ganze Kanten
    for (const seg of E.TILES[t]) if (seg.k === 'city') for (let side = 0; side < 4; side++) {
      const n = [0, 1, 2].filter((i) => seg.p.includes(side * 3 + i)).length;
      assert.ok(n === 0 || n === 3, t);
    }
    // Felder haben nur an Stadtkanten Anschluss, wenn adj gesetzt ist: adj nur für Wiesen neben Städten
    if (!E.TILES[t].some((s) => s.k === 'city')) for (const seg of E.TILES[t]) assert.equal(seg.adj, undefined);
  }
});

test('Drehung: Position p -> (p+3r) mod 12, Randarten konsistent', () => {
  for (const t of E.TILE_TYPES) {
    for (let r = 0; r < 4; r++) {
      const rot = E.rotatedSegments(t, r);
      assert.equal(rot.length, E.TILES[t].length);
      rot.forEach((seg, i) => {
        assert.equal(seg.k, E.TILES[t][i].k);
        assert.deepEqual(seg.p, E.TILES[t][i].p.map((p) => (p + 3 * r) % 12));
        assert.equal(!!seg.shield, !!E.TILES[t][i].shield);
      });
      const e = E.edgeKinds(t, r);
      for (let p = 0; p < 12; p++) assert.equal(e[(p + 3 * r) % 12], E.edgeKinds(t, 0)[p]);
    }
    assert.deepEqual(E.rotatedSegments(t, 4), E.rotatedSegments(t, 0));
  }
  assert.deepEqual(E.uniqueRotations('B'), [0]);
  assert.deepEqual(E.uniqueRotations('U'), [0, 1]);
  assert.deepEqual(E.uniqueRotations('D'), [0, 1, 2, 3]);
  assert.equal(E.uniqueRotations('X').length, 1);
});

test('Randpassung: Beispiele', () => {
  assert.equal(E.oppositePos(0), 8); // N0 trifft S2 des Nachbarn oben
  assert.equal(E.oppositePos(4), 10); // E1 <-> W1
  assert.equal(E.oppositePos(3), 11);
  // Startplättchen D: Stadt oben, Straße E-W
  const s = mk(2, [[0, 0, 'D', 0]], { current: 'E' });
  const l = E.legalPlacements(s).map((m) => `${m.x},${m.y},${m.r}`);
  assert.ok(l.includes('0,-1,2'), 'Stadt auf Stadt');
  assert.ok(!l.includes('0,-1,0'));
  assert.ok(!l.includes('1,0,0') && !l.includes('1,0,2')); // Stadt an Straße/Wiese passt nicht
  const s2 = mk(2, [[0, 0, 'D', 0]], { current: 'U' });
  const l2 = E.legalPlacements(s2).map((m) => `${m.x},${m.y},${m.r}`);
  assert.ok(l2.includes('1,0,1') && l2.includes('-1,0,1')); // Straße geradeaus
  assert.ok(!l2.includes('1,0,0')); // Straße N-S passt nicht an Wiese/Straße
});

test('Randpassung: alle Typpaare und Drehungen gegen unabhängige Prüfung', () => {
  for (const a of E.TILE_TYPES) {
    for (const b of E.TILE_TYPES) {
      const board = { '0,0': { t: a, r: 0, m: [] } };
      const s = mk(2, [[0, 0, a, 0]], { current: b });
      const got = E.legalPlacements(s).map((m) => `${m.x},${m.y},${m.r}`).sort();
      assert.deepEqual(got, bruteForce(board, b), `${a}/${b}`);
    }
  }
});

test('Randpassung: zufällige Stellungen aus Partien', () => {
  const rng = mulberry(77);
  for (let g = 0; g < 10; g++) {
    const s = E.createGame(names(3), {}, rng);
    while (s.phase !== 'over') {
      if (s.phase === 'place') {
        const got = E.legalPlacements(s).map((m) => `${m.x},${m.y},${m.r}`).sort();
        assert.deepEqual(got, bruteForce(s.board, s.current));
        assert.ok(consistent(s.board));
        const m = pick(E.legalPlacements(s), rng);
        turn(s, m.x, m.y, m.r, null);
      }
    }
  }
});

// ---------- Aufbau und Ablauf ----------
test('Startplättchen mittig, Reihenfolge und Zustand', () => {
  const s = E.createGame(names(4), {}, mulberry(11));
  assert.deepEqual(Object.keys(s.board), ['0,0']);
  assert.equal(s.board['0,0'].t, 'D');
  assert.equal(s.phase, 'place');
  assert.equal(s.active, 0);
  assert.equal(s.game, 'ks');
  assert.deepEqual(s.players.map((p) => p.color), [0, 1, 2, 3]);
  assert.deepEqual(s.players.map((p) => p.meeples), [7, 7, 7, 7]);
  assert.equal(E.COLOR_NAMES.length, 5);
  assert.ok(typeof s.current === 'string');
  assert.equal(s.deckLeft, s.deck.length);
  assert.throws(() => E.createGame(names(1)));
  assert.throws(() => E.createGame(names(6)));
  const order = [];
  while (s.phase !== 'over' && order.length < 8) {
    order.push(s.active);
    const m = E.legalPlacements(s)[0];
    turn(s, m.x, m.y, m.r, null);
  }
  assert.deepEqual(order, [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.deepEqual(E.boardBounds(mk(2, [[0, 0, 'D', 0], [2, -1, 'B', 0], [-3, 4, 'B', 0]])), { minX: -3, maxX: 2, minY: -1, maxY: 4 });
});

test('Gleicher rng liefert gleichen Stapel', () => {
  const a = E.createGame(names(2), {}, mulberry(5));
  const b = E.createGame(names(2), {}, mulberry(5));
  const c = E.createGame(names(2), {}, mulberry(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.deck, c.deck);
});

// ---------- Straßen ----------
test('Straße: fertig mit Kreuzungen an beiden Enden, Gefolgsmann kehrt zurück', () => {
  const s = mk(2, [[0, 0, 'D', 0], [-1, 0, 'W', 2, [[0, 0]]]], { current: 'W' });
  // vor dem Schließen: Straße offen
  const f0 = E.featureAt(s, 0, 0, 1);
  assert.equal(f0.kind, 'road');
  assert.equal(f0.tiles.length, 2);
  assert.equal(f0.complete, false);
  assert.equal(f0.open, 1);
  assert.equal(f0.score, 2);
  assert.deepEqual(f0.meeples, [{ p: 0, count: 1 }]);
  turn(s, 1, 0, 0, null);
  assert.deepEqual(scores(s), [3, 0]);
  assert.equal(hands(s)[0], 7);
  assert.equal(s.board['-1,0'].m.length, 0);
  assert.ok(s.recap.some((t) => /Straße fertig: P0 bekommt 3 Punkte/.test(t)), s.recap.join('|'));
  assert.ok(s.recap.some((t) => /zurück/.test(t)));
  // verzweigt: die Kreuzung trennt die Äste in eigene Straßen
  const south = E.featureAt(s, 1, 0, 2);
  assert.equal(south.tiles.length, 1);
  assert.equal(south.complete, false);
  const f1 = E.featureAt(s, 0, 0, 1);
  assert.equal(f1.complete, true);
  assert.equal(f1.tiles.length, 3);
});

test('Straße mit Kreuzung (vierfach) und einfache Straße', () => {
  const s = mk(2, [[0, 0, 'D', 0], [-1, 0, 'X', 0, [[0, 3]]]], { current: 'U' }); // X: Straße 3 zeigt nach Westen (Position 10)
  // X-Straße zum Plättchen D hin ist Segment 0 (N), 1 (E), 2 (S), 3 (W) -> Gefolgsmann auf der W-Straße, nicht auf D-Straße
  assert.equal(E.featureAt(s, -1, 0, 1).tiles.length, 2); // E-Straße des X + D
  assert.equal(E.featureAt(s, -1, 0, 1).complete, false);
  // U geradeaus rechts von D: Straße offen (3 Plättchen X, D, U), kein Abschluss
  turn(s, 1, 0, 1, null);
  assert.deepEqual(scores(s), [0, 0]);
  assert.equal(E.featureAt(s, 0, 0, 1).tiles.length, 3);
  // eine weitere Kreuzung schließt rechts: X in (2,0)
  s.current = 'X'; s.phase = 'place'; s.active = 0;
  turn(s, 2, 0, 0, null);
  assert.deepEqual(scores(s), [0, 0]); // kein Gefolgsmann auf dieser Straße
  const f = E.featureAt(s, 0, 0, 1);
  assert.equal(f.complete, true);
  assert.equal(f.tiles.length, 4);
  assert.equal(f.score, 4);
});

test('Straße: Schleife aus vier Kurven', () => {
  const s = mk(2, [[0, 0, 'V', 3, [[0, 0]]], [1, 0, 'V', 0], [0, 1, 'V', 2]], { current: 'V' });
  assert.equal(E.featureAt(s, 0, 0, 0).complete, false);
  turn(s, 1, 1, 1, null);
  assert.deepEqual(scores(s), [4, 0]);
  assert.equal(hands(s)[0], 7);
  assert.equal(E.featureAt(s, 1, 1, 0).complete, true);
  assert.equal(E.featureAt(s, 1, 1, 0).open, 0);
});

// ---------- Städte ----------
test('Stadt mit Wappen: 2 Punkte je Plättchen + 2 je Wappen', () => {
  const s = mk(2, [[0, 0, 'D', 0, [[0, 0]]], [0, -1, 'M', 2]], { current: 'E' });
  assert.equal(E.featureAt(s, 0, 0, 0).shields, 1);
  turn(s, 1, -1, 3, null);
  assert.deepEqual(scores(s), [8, 0]); // 3 Plättchen * 2 + 1 Wappen * 2
  assert.equal(hands(s)[0], 7);
});

test('Stadt mit zwei Gefolgsleuten verschiedener Personen: Gleichstand, beide voll', () => {
  const s = mk(2, [[0, 0, 'D', 0, [[0, 0]]], [1, -1, 'E', 3, [[1, 0]]]], { current: 'M' });
  turn(s, 0, -1, 2, null);
  assert.deepEqual(scores(s), [8, 8]);
  assert.deepEqual(hands(s), [7, 7]);
});

test('Stadt: Mehrheit bekommt alle Punkte', () => {
  const s = mk(2, [[0, 0, 'D', 0, [[0, 0], [0, 0]]], [0, -1, 'G', 1, [[1, 0]]]], { current: 'E', active: 1 });
  turn(s, 0, -2, 2, null);
  assert.deepEqual(scores(s), [6, 0]);
  assert.deepEqual(hands(s), [7, 7]);
});

test('Stadt: keine Wertung ohne Gefolgsmann, auch nicht später', () => {
  const s = mk(2, [[0, 0, 'D', 0]], { current: 'E' });
  turn(s, 0, -1, 2, null);
  assert.deepEqual(scores(s), [0, 0]);
});

// ---------- Klöster ----------
function block(cx, cy, skip) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (skip && skip.some(([a, b]) => a === dx && b === dy)) continue;
    out.push([cx + dx, cy + dy, 'B', 0]);
  }
  return out;
}
test('Kloster: Wertung beim Setzen des neunten Feldes (Kloster zuletzt)', () => {
  const tiles = block(0, 0, [[0, 0]]);
  const s = mk(2, tiles, { current: 'B' });
  turn(s, 0, 0, 0, 0); // Mönch auf das Kloster in der Mitte
  assert.deepEqual(scores(s), [9, 0]);
  assert.equal(hands(s)[0], 7);
});

test('Kloster: Wertung durch ein Nachbarplättchen', () => {
  const tiles = block(0, 0, [[1, 1]]);
  tiles.find((t) => t[0] === 0 && t[1] === 0).push([[0, 0]]);
  const s = mk(2, tiles, { current: 'B', active: 1 });
  assert.equal(E.featureAt(s, 0, 0, 0).score, 8); // 1 + 7 Nachbarn
  turn(s, 1, 1, 0, null);
  assert.deepEqual(scores(s), [9, 0]);
  assert.equal(hands(s)[0], 7);
});

// ---------- Wiesen / Bauern ----------
test('Bauern bleiben liegen, wenn die Stadt fertig wird; Ritter kehrt zurück', () => {
  const s = mk(2, [[0, 0, 'D', 0, [[0, 0]]], [0, -1, 'M', 2], [0, -2, 'B', 0, [[1, 1]]]], { current: 'E' });
  assert.deepEqual(hands(s), [6, 6]);
  turn(s, 1, -1, 3, null);
  assert.deepEqual(scores(s), [8, 0]);
  assert.deepEqual(hands(s), [7, 6]); // Bauer von P1 bleibt liegen
  assert.equal(s.board['0,-2'].m.length, 1);
  assert.equal(s.board['0,0'].m.length, 0);
});

function farmScene() {
  // Stadt D + M + E (fertig), Wiese über B-Plättchen verbunden
  return [[0, 0, 'D', 0], [0, -1, 'M', 2], [1, -1, 'E', 3], [0, -2, 'B', 0], [1, -2, 'B', 0]];
}
test('Schlusswertung Wiese: 3 je fertiger Stadt, jede Stadt je Wiese nur einmal', () => {
  const t = farmScene();
  t[3] = [0, -2, 'B', 0, [[0, 1]]]; // Bauer P0 auf der großen Wiese (grenzt über M und E an dieselbe Stadt)
  const s = mk(2, t, { current: 'B', deck: [] });
  assert.equal(E.featureAt(s, 0, -2, 1).score, 3);
  turn(s, 2, -2, 0, null);
  assert.equal(s.phase, 'over');
  assert.deepEqual(scores(s), [3, 0]);
  assert.deepEqual(s.result.winners, ['p0']);
});

test('Schlusswertung Wiese: zwei Wiesen derselben Stadt, beide zählen', () => {
  const t = farmScene();
  t[3] = [0, -2, 'B', 0, [[0, 1]]];
  t[0] = [0, 0, 'D', 0, [[1, 2]]]; // Bauer P1 auf der kleinen Wiese neben der Stadt
  const s = mk(2, t, { current: 'B', deck: [] });
  turn(s, 2, -2, 0, null);
  assert.deepEqual(scores(s), [3, 3]);
  assert.deepEqual(s.result.winners, ['p0', 'p1']);
  assert.deepEqual(s.result.ranking.map((r) => r.place), [1, 1]);
});

test('Schlusswertung Wiese: zwei fertige Städte = 6 Punkte; unfertige Stadt zählt nicht', () => {
  const s = mk(2, [[0, 0, 'H', 0, [[0, 2]]], [0, -1, 'E', 2], [0, 1, 'E', 0]], { current: 'B', deck: [] });
  turn(s, 1, 0, 0, null);
  // zwei Städte (H-Nord + E, H-Süd + E) fertig; Bauer P0: 6
  assert.equal(s.players[0].score, 6);
  const s2 = mk(2, [[0, 0, 'H', 0, [[0, 2]]], [0, -1, 'E', 2]], { current: 'B', deck: [] });
  turn(s2, 1, 0, 0, null);
  assert.equal(s2.players[0].score, 3); // nur eine fertig
});

test('Schlusswertung unfertiger Straße und Stadt (1 je Plättchen)', () => {
  const s = mk(2, [[0, 0, 'D', 0, [[0, 0]]], [1, 0, 'U', 1, [[1, 0]]]], { current: 'B', deck: [] });
  turn(s, 0, 1, 0, null);
  assert.deepEqual(scores(s), [1, 2]);
  assert.equal(s.phase, 'over');
  // Stadt mit Wappen, unfertig: Plättchen + Wappen
  const s2 = mk(2, [[0, 0, 'D', 0], [0, -1, 'M', 2, [[1, 0]]]], { current: 'B', deck: [] });
  turn(s2, 0, 1, 0, null);
  assert.deepEqual(scores(s2), [0, 3]); // 2 Plättchen + 1 Wappen
});

test('Schlusswertung unfertiges Kloster: 1 + belegte Nachbarfelder', () => {
  const tiles = [[0, 0, 'B', 0, [[0, 0]]], [0, -1, 'B', 0], [1, 0, 'B', 0], [0, 1, 'B', 0], [-1, 0, 'B', 0], [1, -1, 'B', 0]];
  const s = mk(2, tiles, { current: 'B', deck: [] });
  turn(s, 2, 0, 0, null);
  assert.equal(scores(s)[0], 6);
  assert.equal(s.phase, 'over');
});

// ---------- Gefolgsleute setzen ----------
test('Gefolgsmann nur auf freiem Gebilde, auch bei Besetzung über mehrere Plättchen', () => {
  const s = mk(2, [[0, 0, 'D', 0, [[1, 0]]]], { current: 'M' });
  assert.equal(E.placeTile(s, 'p0', 0, -1, 2).ok, true);
  assert.equal(s.phase, 'meeple');
  const o = E.meepleOptions(s);
  assert.ok(!o.some((q) => q.kind === 'city'), 'Stadt ist durch P1 besetzt');
  assert.ok(o.some((q) => q.kind === 'field'));
  const before = JSON.stringify(s);
  const r = E.placeMeeple(s, 'p0', 0);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s), before);
  assert.equal(E.placeMeeple(s, 'p0', 1).ok, true); // Wiese ist frei
  assert.equal(s.players[0].meeples, 6);
  assert.equal(s.active, 1);
  // Straße über mehrere Plättchen
  const s2 = mk(2, [[0, 0, 'D', 0], [1, 0, 'U', 1, [[1, 0]]]], { current: 'U' });
  E.placeTile(s2, 'p0', -1, 0, 1);
  assert.ok(!E.meepleOptions(s2).some((q) => q.kind === 'road'));
  // freie Straße: Option vorhanden
  const s3 = mk(2, [[0, 0, 'D', 0]], { current: 'U' });
  E.placeTile(s3, 'p0', 1, 0, 1);
  assert.ok(E.meepleOptions(s3).some((q) => q.kind === 'road'));
});

test('Ohne Gefolgsleute in der Hand: direkt zum nächsten Zug', () => {
  const s = mk(2, [[0, 0, 'D', 0]], { current: 'U' });
  s.players[0].meeples = 0;
  assert.equal(E.placeTile(s, 'p0', 1, 0, 1).ok, true);
  assert.equal(s.phase, 'place');
  assert.equal(s.active, 1);
  assert.deepEqual(E.meepleOptions(s), []);
});

test('Plättchen ohne legale Platzierung wird verworfen und neu gezogen', () => {
  const s = mk(2, [[0, 0, 'B', 0]], { current: 'B', deck: ['B', 'C'] });
  turn(s, 1, 0, 0, null);
  assert.deepEqual(s.discarded, ['C']);
  assert.equal(s.current, 'B');
  assert.equal(s.deckLeft, 0);
  assert.equal(s.active, 1);
  assert.ok(s.recap.some((t) => /nirgends/.test(t)));
  // letztes Plättchen unlegbar: Spiel endet
  const s2 = mk(2, [[0, 0, 'B', 0]], { current: 'B', deck: ['C'] });
  turn(s2, 1, 0, 0, null);
  assert.equal(s2.phase, 'over');
  assert.equal(s2.current, null);
});

// ---------- Robustheit ----------
test('Ungültige Nachrichten ändern nie den Zustand', () => {
  const s = E.createGame(names(2), {}, mulberry(9));
  const m0 = E.legalPlacements(s)[0];
  const bad = [
    ['p0', null], ['p0', 'x'], ['p0', {}], ['p0', { t: 'foo' }], ['p1', { t: 'place', x: m0.x, y: m0.y, r: m0.r }],
    ['nobody', { t: 'place', x: m0.x, y: m0.y, r: m0.r }], ['p0', { t: 'place', x: 0, y: 0, r: 0 }], ['p0', { t: 'place', x: 9, y: 9, r: 0 }],
    ['p0', { t: 'place', x: 1.5, y: 0, r: 0 }], ['p0', { t: 'place', x: m0.x, y: m0.y, r: 4 }], ['p0', { t: 'place', x: m0.x, y: m0.y, r: -1 }],
    ['p0', { t: 'place', x: '0', y: '1', r: 0 }], ['p0', { t: 'place' }], ['p0', { t: 'meeple', seg: null }], ['p0', { t: 'meeple', seg: 0 }],
  ];
  for (const [pid, msg] of bad) {
    const before = JSON.stringify(s);
    const r = E.handle(s, pid, msg, Math.random);
    assert.equal(r.ok, false, JSON.stringify(msg));
    assert.equal(typeof r.error, 'string');
    assert.equal(JSON.stringify(s), before);
  }
  // unpassende Drehung
  const wrong = [0, 1, 2, 3].filter((r) => !E.legalPlacements(s).some((m) => m.x === m0.x && m.y === m0.y && m.r === r));
  for (const r of wrong) {
    const before = JSON.stringify(s);
    assert.equal(E.handle(s, 'p0', { t: 'place', x: m0.x, y: m0.y, r }).ok, false);
    assert.equal(JSON.stringify(s), before);
  }
  // Meeple-Phase
  const s2 = mk(2, [[0, 0, 'D', 0]], { current: 'U' });
  E.placeTile(s2, 'p0', 1, 0, 1);
  assert.equal(s2.phase, 'meeple');
  for (const [pid, msg] of [['p1', { t: 'meeple', seg: null }], ['p0', { t: 'meeple', seg: 99 }], ['p0', { t: 'meeple', seg: '1' }],
    ['p0', { t: 'meeple', seg: -1 }], ['p0', { t: 'meeple', seg: 0.5 }], ['p0', { t: 'place', x: 2, y: 0, r: 0 }]]) {
    const before = JSON.stringify(s2);
    assert.equal(E.handle(s2, pid, msg).ok, false, JSON.stringify(msg));
    assert.equal(JSON.stringify(s2), before);
  }
  // nach Spielende
  s2.phase = 'over';
  assert.equal(E.handle(s2, 'p0', { t: 'meeple', seg: null }).ok, false);
});

function randomTurn(s, rng) {
  const pid = E.activePlayer(s).id;
  if (s.phase === 'place') {
    const m = pick(E.legalPlacements(s), rng);
    return E.handle(s, pid, { t: 'place', x: m.x, y: m.y, r: m.r }, rng);
  }
  const o = E.meepleOptions(s);
  const seg = o.length && rng() < 0.6 ? pick(o, rng).seg : null;
  return E.handle(s, pid, { t: 'meeple', seg }, rng);
}

test('JSON-Sicherheit: Zustand nach Serialisierung liefert gleichen Ablauf', () => {
  for (let g = 0; g < 6; g++) {
    const rng1 = mulberry(100 + g), rng2 = mulberry(100 + g);
    let a = E.createGame(names(2 + (g % 4)), {}, mulberry(g));
    let b = clone(a);
    while (a.phase !== 'over') {
      const ra = randomTurn(a, rng1);
      b = clone(b);
      const rb = randomTurn(b, rng2);
      assert.deepEqual(ra, rb);
      assert.deepEqual(a, b);
    }
    assert.equal(JSON.stringify(a), JSON.stringify(clone(a)));
  }
});

test('Zufallspartien (2-5 Personen): enden, Gefolgsleute-Bilanz, Punkte', () => {
  let games = 0, sum = 0, cnt = 0;
  for (let g = 0; g < 320; g++) {
    const n = 2 + (g % 4);
    const rng = mulberry(5000 + g);
    const s = E.createGame(names(n), {}, rng);
    let tiles = 1, steps = 0;
    while (s.phase !== 'over') {
      assert.ok(steps++ < 400);
      const before = Object.keys(s.board).length;
      const r = randomTurn(s, rng);
      assert.equal(r.ok, true, r.error);
      const after = Object.keys(s.board).length;
      tiles += after - before;
      for (let p = 0; p < n; p++) {
        const onBoard = Object.values(s.board).reduce((a, t) => a + t.m.filter((m) => m.p === p).length, 0);
        assert.equal(onBoard + s.players[p].meeples, 7, 'Bilanz');
        assert.ok(s.players[p].score >= 0);
      }
      if (s.phase === 'place') assert.ok(E.legalPlacements(s).length > 0);
    }
    assert.ok(tiles <= 72);
    assert.ok(Object.keys(s.board).length - 1 <= 71);
    assert.equal(s.players.length, n);
    assert.equal(s.result.ranking.length, n);
    assert.ok(s.result.winners.length >= 1);
    const total = s.players.reduce((a, p) => a + p.score, 0);
    assert.ok(total > 0 && total < 600, 'Summe ' + total);
    sum += total / n; cnt++; games++;
  }
  console.log(`  ${games} Zufallspartien, Ø Punkte je Person ${(sum / cnt).toFixed(1)}`);
  assert.ok(games >= 300);
});

test('Rangliste mit Gleichstand', () => {
  const s = E.createGame(names(3), {}, mulberry(1));
  s.players[0].score = 5; s.players[1].score = 9; s.players[2].score = 5;
  assert.deepEqual(E.ranking(s).map((r) => [r.id, r.place]), [['p1', 1], ['p0', 2], ['p2', 2]]);
});
