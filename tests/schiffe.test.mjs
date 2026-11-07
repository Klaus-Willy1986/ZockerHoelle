import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schiffe/engine.js';

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
const P = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }];
const mk = (opts, rng) => M.createGame(P, opts, rng || mulberry(1));
const ids = ['a', 'b'];

// Flotte fest setzen: Liste [x,y,dir] je Schiff in der Reihenfolge der Flotte
const FIX = [[0, 0, 'h'], [0, 2, 'h'], [0, 4, 'h'], [0, 6, 'h'], [0, 8, 'h']];
function setFleet(g, i, spec = FIX) {
  spec.forEach(([x, y, dir], k) => Object.assign(g.fleets[i][k], { x, y, dir }));
}
function startPlay(opts, specA = FIX, specB = FIX) {
  const g = mk(opts);
  setFleet(g, 0, specA); setFleet(g, 1, specB);
  assert.ok(M.handle(g, 'a', { t: 'ready' }).ok);
  assert.ok(M.handle(g, 'b', { t: 'ready' }).ok);
  assert.equal(g.mode, 'play');
  return g;
}
const shot = (g, i, c) => M.handle(g, ids[i], { t: 'shoot', x: M.xOf(c), y: M.yOf(c) });

test('Flotte: 5 Schiffe, 17 Felder', () => {
  assert.equal(M.FLEET.length, 5);
  assert.deepEqual(M.FLEET.map((f) => f.len), [5, 4, 3, 3, 2]);
  assert.equal(M.TOTAL, 17);
  assert.equal(M.cellName(M.cellOf(2, 3)), 'Spalte C, Zeile 4');
});

test('Start: Aufstellen, leere Flotten, Optionen mit Standard "aus", Runde 1', () => {
  const g = mk();
  assert.equal(g.mode, 'setup');
  assert.deepEqual(g.opts, { touch: false, again: false });
  assert.ok(g.fleets.every((f) => f.length === 5 && f.every((s) => s.x === null)));
  assert.equal(g.round, 1);
  assert.deepEqual(g.score, { a: 0, b: 0 });
  assert.deepEqual(mk({ touch: 1, again: 'x' }).opts, { touch: true, again: true });
});

test('Platzieren: Rand, Überlappung, Berührung (auch diagonal), Fremde, falsche Eingaben', () => {
  const g = mk();
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 0, x: 0, y: 0, dir: 'h' }).ok); // 5 lang bei A1
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 1, x: 7, y: 5, dir: 'h' }).ok, false, 'über den Rand (7+4>10)');
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 1, x: 3, y: 9, dir: 'v' }).ok, false, 'über den unteren Rand');
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 1, x: 2, y: 0, dir: 'v' }).ok, false, 'Überlappung');
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 1, x: 0, y: 1, dir: 'h' }).ok, false, 'Berührung seitlich');
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 1, x: 5, y: 1, dir: 'h' }).ok, false, 'Berührung diagonal (E1 -> F2)');
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 1, x: 6, y: 0, dir: 'v' }).ok === true, 'Abstand 1 Feld ist erlaubt');
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 2, x: 0, y: 2, dir: 'h' }).ok, 'ein Feld Abstand ist erlaubt');
  for (const bad of [{ ship: 9 }, { ship: -1 }, { ship: 1.5 }, { ship: '1' }, { x: -1 }, { x: 10 }, { y: 1.5 }, { dir: 'x' }, { dir: undefined }, { x: '3' }]) {
    const m = { t: 'place', ship: 3, x: 4, y: 5, dir: 'h', ...bad };
    assert.equal(M.handle(g, 'a', m).ok, false, JSON.stringify(bad));
  }
  assert.equal(M.handle(g, 'x', { t: 'place', ship: 3, x: 4, y: 5, dir: 'h' }).ok, false);
  JSON.stringify(g);
});

test('Platzieren: Verschieben und Drehen eines gesetzten Schiffs (zählt sich nicht selbst als Hindernis)', () => {
  const g = mk();
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 0, x: 0, y: 0, dir: 'h' }).ok);
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 0, x: 1, y: 0, dir: 'h' }).ok, 'ein Feld nach rechts');
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 0, x: 1, y: 0, dir: 'v' }).ok, 'drehen');
  assert.deepEqual(M.cellsOf(g.fleets[0][0]), [1, 11, 21, 31, 41]);
  assert.equal(g.fleets[0].filter(M.placed).length, 1);
});

test('Option "Schiffe dürfen sich berühren": Berührung erlaubt, Überlappung weiterhin nicht', () => {
  const g = mk({ touch: true });
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 0, x: 0, y: 0, dir: 'h' }).ok);
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 1, x: 0, y: 1, dir: 'h' }).ok, 'direkt daneben');
  assert.ok(M.handle(g, 'a', { t: 'place', ship: 2, x: 5, y: 1, dir: 'h' }).ok, 'diagonal');
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 3, x: 0, y: 0, dir: 'v' }).ok, false, 'Überlappung');
});

test('Fertig: erst wenn alle 5 stehen; danach keine Änderung mehr; Spielstart wenn beide fertig', () => {
  const g = mk();
  assert.equal(M.handle(g, 'a', { t: 'ready' }).ok, false);
  setFleet(g, 0, FIX.slice(0, 4).concat([[null, null, 'h']]));
  g.fleets[0][4].x = null;
  assert.equal(M.handle(g, 'a', { t: 'ready' }).ok, false);
  setFleet(g, 0);
  assert.ok(M.handle(g, 'a', { t: 'ready' }).ok);
  assert.equal(g.mode, 'setup');
  assert.equal(M.handle(g, 'a', { t: 'random' }).ok, false, 'nach Fertig keine Änderung');
  assert.equal(M.handle(g, 'a', { t: 'place', ship: 0, x: 5, y: 5, dir: 'v' }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'shoot', x: 0, y: 0 }).ok, false, 'Schießen vor dem Start');
  setFleet(g, 1);
  assert.ok(M.handle(g, 'b', { t: 'ready' }).ok);
  assert.equal(g.mode, 'play');
  assert.equal(g.turn, 0);
  assert.equal(M.handle(g, 'a', { t: 'random' }).ok, false, 'im Spiel kein Aufstellen mehr');
});

function fleetValid(fleet, touch) {
  assert.equal(fleet.length, 5);
  const seen = new Set();
  fleet.forEach((s, i) => {
    assert.equal(s.len, M.FLEET[i].len);
    const cells = M.shipCells(s.len, s.x, s.y, s.dir);
    assert.ok(cells && cells.length === s.len, 'im Brett');
    for (const c of cells) { assert.ok(!seen.has(c), 'Überlappung'); seen.add(c); }
  });
  assert.equal(seen.size, 17);
  if (!touch) {
    fleet.forEach((s, i) => {
      const own = new Set(M.cellsOf(s));
      for (const c of own) for (const n of M.neighbors8(c)) {
        if (own.has(n)) continue;
        assert.ok(!fleet.some((o, j) => j !== i && M.cellsOf(o).includes(n)), 'Berührung');
      }
    });
  }
}

test('Zufallsaufstellung ist in 500 Versuchen immer gültig (mit und ohne Berührung)', () => {
  for (const touch of [false, true]) {
    const rng = mulberry(touch ? 7 : 8);
    for (let k = 0; k < 500; k++) fleetValid(M.randomFleet({ touch }, rng), touch);
  }
  // über handle, beliebig oft neu würfeln
  const g = mk(); const rng = mulberry(3);
  for (let k = 0; k < 50; k++) { assert.ok(M.handle(g, 'a', { t: 'random' }, rng).ok); fleetValid(g.fleets[0], false); }
  assert.ok(M.handle(g, 'a', { t: 'ready' }).ok);
});

test('Zufallsaufstellung ohne rng-Angabe (Math.random) ist gültig', () => {
  for (let k = 0; k < 100; k++) fleetValid(M.randomFleet({}), false);
});

test('Schüsse: Wasser, Treffer, Versenkt mit Schiffsname, Wechsel nach jedem Schuss', () => {
  const g = startPlay();
  // Anna schießt auf Wasser (B-Feld Zeile 2: Feld 10 ist leer)
  let r = shot(g, 0, M.cellOf(9, 9));
  assert.ok(r.ok); assert.equal(r.r, 'w');
  assert.equal(g.turn, 1);
  assert.equal(g.grid[0][99], 'w');
  assert.equal(shot(g, 0, 1).ok, false, 'nicht dran');
  // Ben trifft das U-Boot (ship 4: (0,8) und (1,8))
  r = shot(g, 1, M.cellOf(0, 8));
  assert.equal(r.r, 'h'); assert.equal(g.turn, 0);
  shot(g, 0, M.cellOf(8, 9));
  r = shot(g, 1, M.cellOf(1, 8));
  assert.equal(r.r, 's'); assert.equal(r.ship, 'U-Boot');
  assert.deepEqual(g.grid[1][80], 's'); assert.deepEqual(g.grid[1][81], 's');
  assert.equal(g.last.r, 's'); assert.equal(g.last.ship, 'U-Boot');
  assert.equal(g.sunk[1].length, 1);
  assert.equal(g.sunk[1][0].len, 2);
  assert.match(g.recap[0], /Treffer, versenkt: U-Boot/);
  // doppelt schießen und falsche Felder
  assert.equal(shot(g, 0, 99).ok, false, 'schon beschossen');
  assert.equal(M.handle(g, 'a', { t: 'shoot', x: 10, y: 0 }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'shoot', x: -1, y: 0 }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'shoot', x: 1.5, y: 0 }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'shoot', x: '1', y: '1' }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'shoot' }).ok, false);
  assert.equal(M.handle(g, 'x', { t: 'shoot', x: 0, y: 0 }).ok, false);
  assert.equal(M.handle(g, 'a', null).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'quatsch' }).ok, false);
  assert.equal(g.turn, 0);
});

test('Mehrfelder-Schiff: erst nach dem letzten Feld versenkt, Treffer in beliebiger Reihenfolge', () => {
  const g = startPlay();
  // Anna beschießt Bens Schlachtschiff (0,0)-(4,0) in gemischter Reihenfolge; Ben schießt zwischendurch Wasser
  const order = [2, 0, 4, 1, 3];
  const res = [];
  order.forEach((x, k) => {
    res.push(shot(g, 0, x).r);
    if (k < 4) shot(g, 1, M.cellOf(9, k));
  });
  assert.deepEqual(res, ['h', 'h', 'h', 'h', 's']);
  assert.equal(g.sunk[0][0].name, 'Schlachtschiff');
  assert.equal(M.remainingDefs(g, 1).length, 4);
  assert.equal(M.afloat(g, 1).length, 4);
});

test('Sieg: wer zuerst alle 17 Felder trifft; Punktestand; danach keine Schüsse mehr', () => {
  const g = startPlay();
  const targets = M.FLEET.flatMap((f, k) => M.cellsOf(g.fleets[1][k]));
  assert.equal(targets.length, 17);
  let i = 0;
  while (g.mode === 'play') {
    assert.ok(shot(g, 0, targets[i++]).ok);
    if (g.mode === 'play') assert.ok(shot(g, 1, M.legalShots(g)[0]).ok); // Ben schießt irgendwohin (nur 16 Schüsse, kann nicht gewinnen)
  }
  assert.equal(g.winner, 0);
  assert.equal(g.mode, 'over');
  assert.equal(g.hits[0], 17);
  assert.equal(g.score.a, 1); assert.equal(g.score.b, 0);
  assert.equal(shot(g, 1, 50).ok, false);
  assert.equal(shot(g, 0, 98).ok, false);
});

test('Option "Treffer = nochmal schießen": Treffer und Versenkt behalten den Zug, Wasser wechselt', () => {
  const g = startPlay({ again: true });
  assert.equal(shot(g, 0, 0).r, 'h'); assert.equal(g.turn, 0);
  assert.equal(shot(g, 0, 1).r, 'h'); assert.equal(g.turn, 0);
  assert.equal(shot(g, 0, 2).r, 'h'); assert.equal(g.turn, 0);
  assert.equal(shot(g, 0, 3).r, 'h'); assert.equal(g.turn, 0);
  assert.equal(shot(g, 0, 4).r, 's'); assert.equal(g.turn, 0, 'auch nach Versenkt nochmal');
  assert.equal(shot(g, 0, 99).r, 'w'); assert.equal(g.turn, 1);
  assert.equal(shot(g, 0, 98).ok, false);
  // ohne Option: Wechsel nach Treffer
  const h = startPlay();
  shot(h, 0, 0); assert.equal(h.turn, 1);
});

test('Sieg mit "nochmal schießen": Spiel endet sofort, kein weiterer Zug', () => {
  const g = startPlay({ again: true });
  for (const c of M.FLEET.flatMap((f, k) => M.cellsOf(g.fleets[1][k]))) assert.ok(shot(g, 0, c).ok);
  assert.equal(g.mode, 'over'); assert.equal(g.winner, 0); assert.equal(g.score.a, 1);
});

test('Neue Runde: Punktestand und Rundenzahl werden übernommen, Aufstellung leer; Startwechsel durch Reihenfolge', () => {
  const g = startPlay();
  for (const c of M.FLEET.flatMap((f, k) => M.cellsOf(g.fleets[1][k]))) { shot(g, 0, c); if (g.mode === 'play') shot(g, 1, M.legalShots(g)[0]); }
  assert.equal(g.mode, 'over');
  const rng = mulberry(4);
  const g2 = M.createGame([P[1], P[0]], g.opts, rng, g); // Reihenfolge getauscht (Ben beginnt)
  assert.equal(g2.round, 2);
  assert.deepEqual(g2.score, { b: 0, a: 1 });
  assert.equal(g2.mode, 'setup');
  assert.ok(g2.fleets.every((f) => f.every((s) => s.x === null)));
  M.handle(g2, 'b', { t: 'random' }, rng); M.handle(g2, 'a', { t: 'random' }, rng);
  M.handle(g2, 'b', { t: 'ready' }); M.handle(g2, 'a', { t: 'ready' });
  assert.equal(g2.players[g2.turn].id, 'b', 'wer zuerst in der Liste steht, schießt zuerst');
  // anderes Paar -> neuer Stand
  const g3 = M.createGame([{ id: 'x', name: 'X' }, P[0]], {}, rng, g);
  assert.equal(g3.round, 1); assert.equal(g3.score.a, 0);
  // kaputte prev wirft nicht
  for (const prev of [null, undefined, {}, { score: 5 }, { players: 3 }, 'x']) assert.equal(M.createGame(P, {}, rng, prev).round, 1);
});

test('JSON-Sicherheit: Zustand übersteht stringify/parse zu jedem Zeitpunkt', () => {
  const rng = mulberry(11);
  const g = mk({ again: true }, rng);
  const same = () => assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  same();
  M.handle(g, 'a', { t: 'random' }, rng); same();
  M.handle(g, 'b', { t: 'random' }, rng); M.handle(g, 'a', { t: 'ready' }); M.handle(g, 'b', { t: 'ready' }); same();
  for (let k = 0; k < 40 && g.mode === 'play'; k++) { const c = M.legalShots(g)[0]; shot(g, g.turn, c); same(); }
  const copy = JSON.parse(JSON.stringify(g));
  const c = M.legalShots(copy)[0];
  if (c !== undefined) assert.ok(M.handle(copy, ids[copy.turn], { t: 'shoot', x: M.xOf(c), y: M.yOf(c) }).ok, 'Kopie bleibt spielbar');
});

test('Zufallspartien enden immer (alle Optionen), jeder Zug ist legal, Treffer zählen stimmt', () => {
  let games = 0;
  for (const opts of [{}, { touch: true }, { again: true }, { touch: true, again: true }]) {
    for (let s = 1; s <= 60; s++) {
      const rng = mulberry(s * 31 + (opts.touch ? 1 : 0) + (opts.again ? 2 : 0));
      const g = M.createGame(P, opts, rng);
      M.handle(g, 'a', { t: 'random' }, rng); M.handle(g, 'b', { t: 'random' }, rng);
      M.handle(g, 'a', { t: 'ready' }); M.handle(g, 'b', { t: 'ready' });
      let n = 0;
      while (g.mode === 'play') {
        assert.ok(n++ < 200, 'Partie endet nicht');
        const legal = M.legalShots(g);
        const c = legal[Math.floor(rng() * legal.length)];
        const turn = g.turn;
        const r = shot(g, turn, c);
        assert.ok(r.ok, r.error);
        if (g.mode === 'play' && !(r.r !== 'w' && opts.again)) assert.equal(g.turn, 1 - turn);
      }
      assert.equal(g.mode, 'over');
      assert.ok(g.hits[g.winner] === 17 && g.hits[1 - g.winner] < 17);
      assert.equal(g.score[ids[g.winner]], 1);
      assert.equal(g.sunk[g.winner].length, 5);
      games++;
    }
  }
  assert.equal(games, 240);
});

test('Gäste/Fremde: keine Wirkung, Zustand bleibt unverändert', () => {
  const g = startPlay();
  const before = JSON.stringify(g);
  assert.equal(M.handle(g, 'fremd', { t: 'shoot', x: 5, y: 5 }).ok, false);
  assert.equal(M.handle(g, 'b', { t: 'shoot', x: 5, y: 5 }).ok, false); // Ben nicht dran
  assert.equal(M.handle(g, 'a', { t: 'ready' }).ok, false);
  assert.equal(JSON.stringify(g), before);
  for (const bad of [undefined, null, 5, 'x', [], {}, { t: 5 }]) assert.equal(M.handle(g, 'a', bad).ok, false);
  assert.equal(M.handle(null, 'a', { t: 'shoot', x: 0, y: 0 }).ok, false);
});
