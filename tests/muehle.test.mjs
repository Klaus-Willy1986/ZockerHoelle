import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../muehle/engine.js';

const mk = () => M.createGame([{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }]);
const ids = ['a', 'b'];
const idOf = (g) => ids[g.turn];
// Stellung direkt aufbauen: w = Punkte Weiß, b = Punkte Schwarz
const setup = (w, b, { toPlace = [0, 0], turn = 0 } = {}) => {
  const g = mk();
  g.board = Array(24).fill(null);
  w.forEach((p) => { g.board[p] = 0; });
  b.forEach((p) => { g.board[p] = 1; });
  g.toPlace = [...toPlace];
  g.turn = turn;
  return g;
};

test('Brett: 24 Punkte, 16 Mühlen, 32 Verbindungen, jede Verbindung symmetrisch', () => {
  assert.equal(M.MILLS.length, 16);
  assert.equal(new Set(M.MILLS.map((m) => m.join())).size, 16);
  let edges = 0;
  M.NEIGHBORS.forEach((n, p) => {
    edges += n.length;
    n.forEach((q) => assert.ok(M.NEIGHBORS[q].includes(p)));
    assert.ok(n.length === 2 || n.length === 3 || n.length === 4);
  });
  assert.equal(edges / 2, 32);
  assert.deepEqual(M.NEIGHBORS[0], [1, 7]);
  assert.deepEqual(M.NEIGHBORS[1], [0, 2, 9]);
  assert.deepEqual(M.NEIGHBORS[9], [1, 8, 10, 17]);
  assert.deepEqual(M.NEIGHBORS[23], [15, 16, 22]);
  // jede Mühle besteht aus Punkten, die der Reihe nach verbunden sind
  for (const m of M.MILLS) {
    assert.ok(M.NEIGHBORS[m[0]].includes(m[1]));
    assert.ok(M.NEIGHBORS[m[1]].includes(m[2]));
  }
});

test('Start: Weiß beginnt, je 9 Steine, leeres Brett', () => {
  const g = mk();
  assert.equal(g.turn, 0);
  assert.deepEqual(g.toPlace, [9, 9]);
  assert.equal(g.board.filter((x) => x !== null).length, 0);
  assert.equal(M.phaseOf(g), 'place');
});

test('Setzen: abwechselnd, besetzter Punkt und falsche Person werden abgelehnt', () => {
  const g = mk();
  assert.equal(M.place(g, 'b', 0).ok, false);
  assert.ok(M.place(g, 'a', 0).ok);
  assert.equal(g.turn, 1);
  assert.equal(M.place(g, 'b', 0).ok, false);
  assert.equal(M.place(g, 'a', 5).ok, false);
  assert.equal(M.place(g, 'b', 24).ok, false);
  assert.equal(M.place(g, 'b', -1).ok, false);
  assert.equal(M.place(g, 'b', 1.5).ok, false);
  assert.equal(M.place(g, 'b', '3').ok, false);
  assert.equal(M.place(g, 'x', 3).ok, false);
  assert.ok(M.place(g, 'b', 3).ok);
  assert.deepEqual(g.toPlace, [8, 8]);
});

test('Während des Setzens darf nicht gezogen werden', () => {
  const g = mk();
  M.place(g, 'a', 0);
  M.place(g, 'b', 5);
  assert.equal(M.move(g, 'a', 0, 1).ok, false);
});

test('Mühle beim Setzen: ein Stein darf entfernt werden, danach ist der Gegner dran', () => {
  const g = mk();
  for (const [pid, p] of [['a', 0], ['b', 8], ['a', 1], ['b', 16]]) assert.ok(M.place(g, pid, p).ok);
  const r = M.place(g, 'a', 2);
  assert.ok(r.ok && r.mill);
  assert.equal(g.removing, true);
  assert.equal(g.turn, 0);
  assert.equal(M.place(g, 'a', 3).ok, false); // erst entfernen
  assert.equal(M.removeStone(g, 'b', 8).ok, false); // falsche Person
  assert.equal(M.removeStone(g, 'a', 1).ok, false); // eigener Stein
  assert.equal(M.removeStone(g, 'a', 5).ok, false); // leerer Punkt
  assert.ok(M.removeStone(g, 'a', 8).ok);
  assert.equal(g.board[8], null);
  assert.equal(g.turn, 1);
  assert.equal(g.removing, false);
  assert.equal(g.toPlace[1], 7); // entfernte Steine werden nicht ersetzt
  assert.equal(g.last.removed, 8);
  assert.match(g.recap[0], /Anna.*Mühle.*Ben/);
});

test('Geschützte Steine: nur Steine außerhalb von Mühlen, sonst alle', () => {
  const g = setup([0, 1], [4, 5, 6, 10, 18], { toPlace: [7, 4], turn: 0 });
  // Schwarz hat Mühle 4-5-6; Weiß schließt Mühle 0-1-2 durch Setzen
  assert.ok(M.place(g, 'a', 2).mill);
  assert.deepEqual(M.removablePoints(g, 1), [10, 18]);
  assert.equal(M.removeStone(g, 'a', 4).ok, false);
  assert.match(M.removeStone(g, 'a', 4).error, /Mühle/);
  assert.ok(M.removeStone(g, 'a', 10).ok);
  // alle in Mühlen -> beliebiger Stein
  const h = setup([0, 1], [4, 5, 6], { toPlace: [7, 6], turn: 0 });
  M.place(h, 'a', 2);
  assert.deepEqual(M.removablePoints(h, 1), [4, 5, 6]);
  assert.ok(M.removeStone(h, 'a', 4).ok);
});

test('Zwei Mühlen mit einem Zug: nur ein Stein wird entfernt', () => {
  // Weiß: 0,1 und 6,5 fehlt Punkt 2? Mühle A: 0-1-2, Mühle B: 2-3-4 -> Punkt 2 schließt beide
  const g = setup([0, 1, 3, 4], [8, 12, 16, 21], { toPlace: [5, 5], turn: 0 });
  assert.ok(M.place(g, 'a', 2).mill);
  assert.ok(M.removeStone(g, 'a', 8).ok);
  assert.equal(g.removing, false);
  assert.equal(g.turn, 1);
  assert.equal(g.board.filter((x) => x === 1).length, 3);
});

test('Ziehen: nur auf angrenzende freie Punkte', () => {
  const g = setup([0, 2, 4, 20], [9, 10, 12, 13], { turn: 0 });
  assert.equal(M.move(g, 'a', 0, 2).ok, false); // besetzt
  assert.equal(M.move(g, 'a', 0, 4).ok, false); // nicht angrenzend
  assert.equal(M.move(g, 'a', 0, 8).ok, false); // diagonal, nicht verbunden
  assert.equal(M.move(g, 'a', 9, 1).ok, false); // fremder Stein
  assert.equal(M.move(g, 'a', 5, 6).ok, false); // leer
  assert.equal(M.move(g, 'b', 9, 1).ok, false); // nicht am Zug
  assert.ok(M.move(g, 'a', 0, 1).ok);
  assert.equal(g.board[0], null);
  assert.equal(g.board[1], 0);
  assert.deepEqual(g.last, { by: 0, from: 0, to: 1, removed: null });
  assert.equal(g.turn, 1);
  // Verbindungslinie zwischen den Quadraten
  assert.ok(M.move(g, 'b', 9, 17).ok);
});

test('Springen (Fliegen) nur mit genau 3 Steinen', () => {
  const g = setup([0, 2, 4], [9, 10, 12, 13], { turn: 0 });
  assert.ok(M.canFly(g, 0));
  assert.ok(!M.canFly(g, 1));
  assert.deepEqual(M.targetsFrom(g, 0).length, 24 - 7);
  assert.ok(M.move(g, 'a', 0, 20).ok);
  // Schwarz hat 4 Steine und darf nicht springen
  assert.equal(M.move(g, 'b', 9, 21).ok, false);
  // Fliegen erst nach der Setzphase
  const h = setup([0, 2, 4], [9, 10, 12, 13], { toPlace: [0, 1], turn: 0 });
  assert.ok(M.canFly(h, 0)); // Weiß hat nichts mehr zu setzen
  const k = setup([0, 2, 4], [9, 10, 12, 13], { toPlace: [1, 0], turn: 0 });
  assert.ok(!M.canFly(k, 0));
});

test('Mühle durch Ziehen, Öffnen und erneutes Schließen zählt wieder', () => {
  const g = setup([0, 1, 2, 12], [10, 11, 13, 14, 20], { turn: 0 });
  assert.ok(M.move(g, 'a', 2, 3).ok);
  assert.equal(g.removing, false);
  assert.ok(M.move(g, 'b', 20, 19).ok);
  const r = M.move(g, 'a', 3, 2);
  assert.ok(r.mill);
  assert.equal(g.removing, true);
});

test('Gewinn: Gegner auf 2 Steine reduziert (nach der Setzphase)', () => {
  const g = setup([0, 1, 3, 5], [10, 12, 14], { turn: 0 });
  assert.ok(M.move(g, 'a', 3, 2).mill);
  assert.ok(M.removeStone(g, 'a', 10).ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, 0);
  assert.equal(g.endCode, 'two');
  // danach nichts mehr
  assert.equal(M.move(g, 'b', 12, 11).ok, false);
  assert.equal(M.resign(g, 'a').ok, false);
});

test('Während des Setzens führt ein Stand von 2 Steinen auf dem Brett noch nicht zum Verlust', () => {
  const g = setup([0, 1], [3, 4], { toPlace: [5, 5], turn: 0 });
  assert.ok(M.place(g, 'a', 2).mill);
  assert.ok(M.removeStone(g, 'a', 3).ok);
  assert.equal(g.mode, 'play');
  assert.equal(M.countOn(g, 1), 1);
  assert.equal(M.totalOf(g, 1), 6);
});

test('Gewinn: Gegner ist eingesperrt (kein Zug, kein Fliegen)', () => {
  // Schwarz: 0, 8, 9, 15 – alle Nachbarn sind besetzt
  const k = setup([1, 7, 10, 17, 14, 23, 20], [0, 8, 9, 15], { turn: 0 });
  assert.equal(M.movableStones(k, 1).length, 0);
  assert.ok(!M.canFly(k, 1));
  assert.ok(M.move(k, 'a', 20, 21).ok);
  assert.equal(k.mode, 'over');
  assert.equal(k.winner, 0);
  assert.equal(k.endCode, 'blocked');
  assert.match(k.endReason, /Ben/);
});

test('Eingesperrt, aber mit 3 Steinen: kein Verlust, da Fliegen möglich', () => {
  const g = setup([1, 7, 9, 15, 20], [0, 8, 2], { turn: 0 });
  assert.ok(M.move(g, 'a', 20, 21).ok);
  assert.equal(g.mode, 'play');
  assert.ok(M.canFly(g, 1));
});

test('Remis durch dreifache Wiederholung (gleiche Stellung, gleiche Person am Zug)', () => {
  const g = setup([0, 2, 5, 13], [18, 20, 22, 10], { turn: 0 });
  const seq = [['a', 0, 1], ['b', 18, 19], ['a', 1, 0], ['b', 19, 18]];
  // Stellung nach Zug 4 == Ausgangsstellung (Weiß am Zug). Die Ausgangsstellung selbst zählt noch nicht.
  for (let i = 0; i < 9; i++) {
    const [p, f, t] = seq[i % 4];
    assert.equal(g.mode, 'play', 'Zug ' + i);
    const r = M.move(g, p, f, t);
    assert.ok(r.ok, r.error);
    if (i < 8) assert.equal(g.mode, 'play');
  }
  // Ausgangsstellung nach Zug 1 (Schwarz am Zug) zum dritten Mal nach 9 Zügen
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, null);
  assert.equal(g.endCode, 'repeat');
});

test('Wiederholung: verschiedene Person am Zug zählt nicht als gleiche Stellung', () => {
  const g = setup([0, 2, 5, 13], [18, 20, 22, 10], { turn: 0 });
  M.move(g, 'a', 0, 1);
  assert.deepEqual(Object.keys(g.seen).length, 1);
  assert.ok(Object.keys(g.seen)[0].endsWith('|1'));
});

test('Remis anbieten / annehmen / ablehnen', () => {
  const g = mk();
  assert.equal(M.drawAccept(g, 'b').ok, false); // nichts angeboten
  assert.ok(M.drawOffer(g, 'a').ok);
  assert.equal(M.drawOffer(g, 'b').ok, false); // schon eines offen
  assert.equal(M.drawAccept(g, 'a').ok, false); // eigenes Angebot
  assert.equal(M.drawDecline(g, 'a').ok, false);
  assert.equal(M.place(g, 'a', 0).ok, false); // erst antworten
  assert.ok(M.drawDecline(g, 'b').ok);
  assert.equal(g.drawOffer, null);
  assert.ok(M.place(g, 'a', 0).ok);
  assert.ok(M.drawOffer(g, 'a').ok); // auch außerhalb der eigenen Reihe
  assert.ok(M.drawCancel(g, 'a').ok);
  assert.equal(M.drawCancel(g, 'a').ok, false);
  assert.ok(M.drawOffer(g, 'b').ok);
  assert.ok(M.drawAccept(g, 'a').ok);
  assert.equal(g.mode, 'over');
  assert.equal(g.winner, null);
  assert.equal(g.endCode, 'agreed');
});

test('Aufgeben: jederzeit, auch außerhalb der eigenen Reihe', () => {
  const g = mk();
  assert.equal(M.resign(g, 'x').ok, false);
  assert.ok(M.resign(g, 'b').ok);
  assert.equal(g.winner, 0);
  assert.equal(g.endCode, 'resign');
  assert.match(g.endReason, /Ben/);
});

test('Ungültige Nachrichten beschädigen nichts', () => {
  const g = mk();
  M.place(g, 'a', 0);
  const before = JSON.stringify(g);
  const bad = [null, undefined, 5, 'x', {}, { t: 'place' }, { t: 'place', p: null }, { t: 'place', p: {} }, { t: 'move', from: 0 },
    { t: 'move', from: 'a', to: 'b' }, { t: 'remove', p: 0 }, { t: 'remove' }, { t: 'zzz' }, { t: 'draw-accept' }, { t: 'place', p: 0 },
    { t: 'place', p: NaN }, { t: 'place', p: Infinity }, { t: '__proto__' }, { t: 'move', from: [1], to: [2] }];
  for (const m of bad) {
    const r = M.handle(g, 'b', m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, 'string');
    assert.equal(JSON.stringify(g), before);
  }
  assert.equal(M.handle(g, 'b', { t: 'place', p: 'x' }).ok, false);
  assert.equal(JSON.stringify(g), before);
});

test('Zustand ist JSON-fest', () => {
  const g = mk();
  M.place(g, 'a', 3);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

// ---------- Zufallspartien ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function checkInvariants(g) {
  assert.equal(g.board.length, 24);
  for (const c of [0, 1]) {
    const on = M.countOn(g, c);
    assert.ok(on + g.toPlace[c] <= 9, 'nie mehr als 9 Steine');
    assert.ok(g.toPlace[c] >= 0);
    assert.ok(on <= 9);
  }
  assert.ok(Math.abs(g.toPlace[0] - g.toPlace[1]) <= 1);
}

test('600 Zufallspartien enden sauber, Invarianten halten', () => {
  const ends = { two: 0, blocked: 0, repeat: 0, resign: 0, agreed: 0 };
  let mills = 0, flights = 0;
  for (let n = 0; n < 600; n++) {
    const r = rng(n + 1);
    const g = mk();
    let steps = 0;
    while (g.mode === 'play' && steps++ < 3000) {
      const acts = M.legalActions(g);
      assert.ok(acts.length > 0, 'am Zug muss es immer eine Möglichkeit geben');
      // Mühlen bevorzugen, damit Partien auch in die Endphase kommen
      let a = acts[Math.floor(r() * acts.length)];
      const millActs = acts.filter((x) => {
        if (x.t !== 'place' && x.t !== 'move') return false;
        const b = [...g.board]; if (x.t === 'move') b[x.from] = null; b[x.to ?? x.p] = g.turn;
        return M.inMill(b, x.to ?? x.p);
      });
      if (millActs.length && r() < 0.8) a = millActs[Math.floor(r() * millActs.length)];
      if (a.t === 'move' && M.canFly(g, g.turn)) flights++;
      const before = g.moveNo;
      const res = M.handle(g, idOf(g), a);
      assert.ok(res.ok, JSON.stringify(a) + ' ' + res.error);
      if (res.mill) mills++;
      if (g.mode === 'play') {
        checkInvariants(g);
        assert.ok(g.moveNo >= before);
        // falsche Person darf nie ziehen, Zustand bleibt gleich
        if (n % 20 === 0) {
          const snap = JSON.stringify(g);
          assert.equal(M.handle(g, ids[1 - g.turn], a).ok, false);
          assert.equal(JSON.stringify(g), snap);
        }
      }
    }
    assert.equal(g.mode, 'over', 'Partie ' + n + ' endet');
    assert.ok(g.endCode in ends);
    ends[g.endCode]++;
    if (g.endCode === 'two') {
      const loser = g.winner === null ? -1 : 1 - g.winner;
      assert.ok(M.countOn(g, loser) <= 2 && g.toPlace[loser] === 0);
    }
    if (g.endCode === 'blocked') {
      const loser = 1 - g.winner;
      assert.equal(M.hasLegalAction(g, loser), false);
    }
    assert.ok(g.endReason && g.endReason.length > 3);
    assert.equal(M.legalActions(g).length, 0);
  }
  assert.ok(mills > 500, 'es gab Mühlen: ' + mills);
  assert.ok(flights > 0, 'es wurde geflogen');
  assert.ok(ends.two + ends.blocked + ends.repeat === 600);
});

test('Zufallspartien mit Remis-Angeboten und Aufgeben dazwischen', () => {
  for (let n = 0; n < 200; n++) {
    const r = rng(9000 + n);
    const g = mk();
    let steps = 0;
    while (g.mode === 'play' && steps++ < 3000) {
      const x = r();
      if (x < 0.03) { M.handle(g, ids[Math.floor(r() * 2)], { t: 'draw-offer' }); }
      else if (g.drawOffer !== null) {
        const resp = r() < 0.7 ? 'draw-decline' : r() < 0.5 ? 'draw-accept' : 'draw-cancel';
        const who = resp === 'draw-cancel' ? ids[g.drawOffer] : ids[1 - g.drawOffer];
        assert.ok(M.handle(g, who, { t: resp }).ok);
      } else if (x > 0.998) { M.handle(g, ids[Math.floor(r() * 2)], { t: 'resign' }); }
      else {
        const acts = M.legalActions(g);
        assert.ok(acts.length);
        assert.ok(M.handle(g, idOf(g), acts[Math.floor(r() * acts.length)]).ok);
      }
    }
    assert.equal(g.mode, 'over');
  }
});
