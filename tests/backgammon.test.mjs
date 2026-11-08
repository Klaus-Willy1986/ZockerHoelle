import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../backgammon/engine.js';

const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }];
function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const val = (v) => (v - 1) / 6 + 0.01; // Zufallszahl, die genau v würfelt
const script = (...vs) => { let i = 0; return () => (i < vs.length ? vs[i++] : 0.5); };
const mk = (opts = {}, rng = seedRng(1)) => P.createGame(P2, opts, rng);

// Stellung setzen: spec = { Spitze: Anzahl, bar: n, off: n }; fehlende Steine kommen auf „off“
function put(g, i, spec) {
  const b = Array(26).fill(0);
  let n = 0;
  for (const [k, v] of Object.entries(spec)) { b[k === 'bar' ? 25 : k === 'off' ? 0 : Number(k)] = v; n += v; }
  if (!('off' in spec)) b[0] += 15 - n;
  g.board[i] = b;
}
function turnTo(g, i, left, stage = 'move') {
  g.mode = 'play'; g.turn = i; g.stage = stage; g.left = left.slice(); g.winner = null;
  g.lastRoll = { p: i, dice: [left[0], left.length > 1 ? left[1] : left[0]], rollId: g.rollId };
}
const mv = (g, id, from, to, die) => P.handle(g, id, { t: 'move', from, to, die });
const sum = (b) => b.reduce((x, y) => x + y, 0);
const key = (m) => `${m.from}>${m.to}:${m.die}`;

test('Aufstellung: je 15 Steine, 26 Felder, Standardstellung, spiegelverkehrt, Augenzahl 167', () => {
  const g = mk();
  assert.equal(g.board.length, 2);
  for (const b of g.board) {
    assert.equal(b.length, 26);
    assert.equal(sum(b), 15);
    assert.deepEqual([b[24], b[13], b[8], b[6]], [2, 5, 3, 5]);
    assert.equal(b[0], 0); assert.equal(b[25], 0);
  }
  assert.equal(P.pipCount(g, 0), 167);
  assert.equal(P.pipCount(g, 1), 167);
  // dieselbe Spitze aus beiden Sichten: Hell auf 24 steht auf Dunkels Spitze 1 ... (Dunkel hat dort keinen Stein)
  assert.equal(g.board[1][25 - 24], 0);
  assert.equal(g.game, 'bgm');
});

test('Optionen: Ziel 3, to5 = 5, one = 1 (one hat Vorrang), Spielerzahl', () => {
  assert.equal(mk().target, 3);
  assert.equal(mk({ to5: true }).target, 5);
  assert.equal(mk({ one: true }).target, 1);
  assert.equal(mk({ one: true, to5: true }).target, 1);
  assert.throws(() => P.createGame([P2[0]], {}));
  assert.throws(() => P.createGame(null, {}));
  assert.equal(mk(null).target, 3);
});

test('Eröffnungswurf: höhere Zahl beginnt und zieht mit beiden Würfeln, Gleichstand wird wiederholt', () => {
  const g = P.createGame(P2, {}, script(0.1, val(5), val(3)));
  assert.deepEqual(g.opening, [5, 3]);
  assert.equal(g.turn, 0); assert.equal(g.starter, 0);
  assert.equal(g.stage, 'move');
  assert.deepEqual(g.left, [5, 3]);
  assert.deepEqual(g.lastRoll.dice, [5, 3]);
  const h = P.createGame(P2, {}, script(0.1, val(2), val(6)));
  assert.equal(h.turn, 1); assert.equal(h.starter, 1);
  assert.deepEqual(h.left, [2, 6]);
  const t = P.createGame(P2, {}, script(0.1, val(4), val(4), val(1), val(6)));
  assert.deepEqual(t.opening, [1, 6]);
  assert.equal(t.turn, 1);
  assert.match(t.recap.join(' '), /Eröffnungswurf/);
  // ganz gleichmäßiger Zufall darf nicht hängen bleiben
  const c = P.createGame(P2, {}, () => 0.5);
  assert.notEqual(c.opening[0], c.opening[1]);
});

test('Normaler Zug und Schlagen eines Blots', () => {
  const g = mk();
  put(g, 0, { 10: 1, 13: 5, 8: 3, 6: 5 });
  put(g, 1, { 12: 1, 20: 2, 10: 3, 8: 5 }); // Dunkel eigene Spitze 12 = Hell-Spitze 13 ... Blot von Dunkel auf Hell-13? Dunkel 12 -> Hell 13
  // Dunkel-Spitze s liegt auf Hell-Spitze 25-s: 12 -> 13 (mit 5 Hellen: blockiert), 20 -> 5, 10 -> 15, 8 -> 17
  put(g, 1, { 15: 1, 20: 2, 10: 3, 8: 5 }); // Blot auf Hell-Spitze 10 (25-15)
  turnTo(g, 0, [3, 2]);
  const ms = P.legalMoves(g);
  assert.ok(ms.some((m) => m.from === 13 && m.to === 10 && m.die === 3), 'Schlagzug 13->10');
  assert.ok(!ms.some((m) => m.to === 5), 'Spitze 5 ist von zwei gegnerischen Steinen besetzt'); // 8->5 (3) und 6.. blockiert, 7?
  const r = mv(g, 'a', 13, 10, 3);
  assert.equal(r.ok, true);
  assert.equal(g.board[0][10], 2);
  assert.equal(g.board[1][25], 1, 'Geschlagener Stein auf der Bar');
  assert.equal(g.board[1][15], 0);
  assert.equal(g.last.hit, true);
  assert.deepEqual(g.left, [2]);
  assert.equal(sum(g.board[1]), 15);
});

test('Blockierte Spitze (2 oder mehr gegnerische Steine) ist verboten', () => {
  const g = mk();
  put(g, 0, { 8: 1, 24: 1 });
  put(g, 1, { 20: 2, 15: 2, 5: 11 }); // Hell-Spitzen 5 und 10 gesperrt
  turnTo(g, 0, [3, 6]);
  const ms = P.legalMoves(g);
  assert.ok(!ms.some((m) => m.from === 8 && m.to === 5));
  const r = mv(g, 'a', 8, 5, 3);
  assert.equal(r.ok, false);
  assert.equal(g.board[0][8], 1);
});

test('Bar-Pflicht: zuerst einsetzen, Einsetzen auf 25 − Zahl, Schlagen beim Einsetzen', () => {
  const g = mk();
  put(g, 0, { bar: 1, 13: 5, 6: 5, 8: 3, 24: 1 });
  put(g, 1, { 6: 1, 5: 2, 12: 5, 17: 3, 19: 3 }); // Dunkel-Blot auf Dunkel-Spitze 6 = Hell-Spitze 19
  turnTo(g, 0, [6, 2]);
  const ms = P.legalMoves(g);
  assert.ok(ms.every((m) => m.from === 25), 'nur von der Bar');
  assert.deepEqual(ms.map(key).sort(), ['25>19:6', '25>23:2']);
  const bad = mv(g, 'a', 13, 7, 6);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Bar/);
  const r = mv(g, 'a', 25, 19, 6);
  assert.equal(r.ok, true);
  assert.equal(g.board[1][25], 1, 'Blot beim Einsetzen geschlagen');
  assert.equal(g.board[0][25], 0);
  // jetzt dürfen andere Steine ziehen (2)
  assert.ok(P.legalMoves(g).every((m) => m.die === 2));
});

test('Pasch: viermal die Augenzahl, vier Teilzüge', () => {
  const g = P.createGame(P2, {}, script(0.1, val(3), val(1)));
  assert.equal(g.left.length, 2);
  const h = mk();
  turnTo(h, 0, [], 'roll');
  const r = P.handle(h, 'a', { t: 'roll' }, script(val(4), val(4)));
  assert.equal(r.ok, true);
  assert.deepEqual(h.left, [4, 4, 4, 4]);
  for (let k = 0; k < 4; k++) {
    assert.equal(h.turn, 0, `vor Zug ${k + 1}`);
    const m = P.legalMoves(h)[0];
    assert.equal(m.die, 4);
    assert.equal(mv(h, 'a', m.from, m.to, 4).ok, true);
  }
  assert.equal(h.turn, 1);
  assert.equal(h.stage, 'roll');
  assert.deepEqual(h.left, []);
});

test('Wurf und Zugwechsel: falsche Person, falsche Phase, kein Zurück', () => {
  const g = mk({}, seedRng(7));
  const first = g.turn;
  const me = P2[first].id; const you = P2[1 - first].id;
  assert.equal(g.stage, 'move');
  assert.equal(P.handle(g, me, { t: 'roll' }).ok, false, 'schon gewürfelt');
  assert.equal(P.handle(g, you, { t: 'move', from: 24, to: 20, die: 4 }).ok, false, 'nicht dran');
  assert.equal(P.handle(g, 'fremd', { t: 'roll' }).ok, false);
  assert.equal(P.handle(g, me, { t: 'undo' }).ok, false);
  assert.equal(P.handle(g, me, { t: 'next' }).ok, false, 'Partie läuft noch');
});

test('Pflicht, beide Würfel zu spielen: Zug, der den zweiten Würfel verbauen würde, ist nicht erlaubt', () => {
  // Ein Stein auf 6, alle anderen raus. 6 zuerst würde herausspielen und die 2 verfallen lassen; 2 zuerst erlaubt danach die 6 (Herausspielen).
  const g = mk();
  put(g, 0, { 6: 1 });
  put(g, 1, { 13: 2, 14: 2, 22: 2 });
  turnTo(g, 0, [6, 2]);
  const naive = [6, 2].flatMap((d) => P.singleMoves(g.board, 0, d));
  assert.deepEqual(naive.map(key).sort(), ['6>0:6', '6>4:2']);
  assert.deepEqual(P.legalMoves(g).map(key), ['6>4:2']);
  const bad = JSON.parse(JSON.stringify(g));
  assert.equal(mv(bad, 'a', 6, 0, 6).ok, false);
  for (const p of P.plays(g)) assert.equal(p.moves.length, 2);
  assert.equal(mv(g, 'a', 6, 4, 2).ok, true);
  assert.deepEqual(P.legalMoves(g).map(key), ['4>0:6']);
  assert.equal(mv(g, 'a', 4, 0, 6).ok, true);
  assert.equal(g.mode, 'over');
});

test('Nur ein Würfel spielbar: der größere muss gespielt werden', () => {
  const g = mk();
  put(g, 0, { bar: 1 }); // 14 weitere „raus“
  g.board[0][0] = 14;
  put(g, 1, { 11: 2, 4: 13 }); // Dunkel-Spitze 11 = Hell-Spitze 14 gesperrt
  g.board[1][0] = 0;
  turnTo(g, 0, [5, 6]);
  // 6: 25->19 -> weiter 5 nach 14 gesperrt; 5: 25->20 -> weiter 6 nach 14 gesperrt
  const ms = P.legalMoves(g);
  assert.deepEqual(ms.map(key), ['25>19:6']);
  assert.equal(mv(g, 'a', 25, 20, 5).ok, false);
  // 6 ist blockiert: dann der kleinere
  const h = mk();
  put(h, 0, { bar: 1 }); h.board[0][0] = 14;
  put(h, 1, { 6: 2, 11: 2, 4: 11 });
  turnTo(h, 0, [5, 6]);
  assert.deepEqual(P.legalMoves(h).map(key), ['25>20:5']);
});

test('Herausspielen: erst mit allen 15 im Heimfeld, exakt oder von der höchsten Spitze mit größerer Zahl', () => {
  // Ein Stein draußen: kein Herausspielen
  const g = mk();
  put(g, 0, { 7: 1, 3: 2, 1: 12 });
  put(g, 1, { 6: 15 });
  turnTo(g, 0, [3, 1]);
  assert.ok(!P.legalMoves(g).some((m) => m.to === 0));
  // alle im Heimfeld: exakt
  const h = mk();
  put(h, 0, { 6: 2, 4: 3, 2: 10 });
  put(h, 1, { 6: 15 });
  turnTo(h, 0, [4, 2]);
  assert.ok(P.legalMoves(h).some((m) => m.from === 4 && m.to === 0 && m.die === 4));
  assert.equal(mv(h, 'a', 4, 0, 4).ok, true);
  assert.equal(h.board[0][0], 1);
  // größere Zahl nur von der höchsten besetzten Spitze
  const k = mk();
  put(k, 0, { 5: 2, 3: 3, 2: 10 });
  put(k, 1, { 6: 15 });
  turnTo(k, 0, [6]);
  const ms = P.legalMoves(k);
  assert.deepEqual(ms.filter((m) => m.to === 0).map(key), ['5>0:6'], '6 darf nur von 5 heraus (höchste Spitze)');
  // steht noch ein Stein höher, ist die größere Zahl dort nicht erlaubt
  const l = mk();
  put(l, 0, { 5: 1, 3: 3, 2: 11 });
  put(l, 1, { 6: 15 });
  turnTo(l, 0, [4]);
  assert.ok(!P.legalMoves(l).some((m) => m.from === 3 && m.to === 0), '4 aus Spitze 3 geht nicht, solange auf 5 ein Stein steht');
  assert.ok(P.legalMoves(l).some((m) => m.from === 5 && m.to === 1));
  // Die-Auswahl bei Mehrdeutigkeit
  const m2 = mk();
  put(m2, 0, { 2: 15 });
  put(m2, 1, { 6: 15 });
  turnTo(m2, 0, [5, 3]);
  const offs = P.legalMoves(m2).filter((m) => m.from === 2 && m.to === 0);
  assert.deepEqual(offs.map((m) => m.die).sort(), [3, 5]);
  assert.equal(mv(m2, 'a', 2, 0, 5).ok, true);
  assert.deepEqual(m2.left, [3], 'gewählte größere Zahl verbraucht');
  const m3 = mk();
  put(m3, 0, { 2: 15 }); put(m3, 1, { 6: 15 }); turnTo(m3, 0, [5, 3]);
  assert.equal(P.handle(m3, 'a', { t: 'move', from: 2, to: 0 }).ok, true);
  assert.deepEqual(m3.left, [5], 'ohne Angabe: kleinere Zahl');
  assert.equal(mv(m3, 'a', 2, 0, 4).ok, false, 'Zahl 4 gibt es nicht');
});

test('Sieg, Wertung normal / Gammon / Backgammon, Matchende und nächste Partie', () => {
  const setup = (loserSpec, loserOff) => {
    const g = mk({});
    put(g, 0, { 1: 1, off: 14 });
    put(g, 1, loserSpec);
    if (loserOff !== undefined) { g.board[1][0] = loserOff; }
    turnTo(g, 0, [1]);
    return g;
  };
  // normal: Verlierer hat einen Stein heraus
  let g = setup({ 13: 14, off: 1 });
  assert.equal(mv(g, 'a', 1, 0, 1).ok, true);
  assert.equal(g.mode, 'over'); assert.equal(g.winner, 0); assert.equal(g.kind, 'normal'); assert.equal(g.points, 1);
  assert.deepEqual(g.scores, [1, 0]);
  assert.equal(g.matchWinner, null);
  assert.equal(g.stage, 'done');
  // Gammon: Verlierer hat keinen Stein heraus, alle Steine aber außerhalb von Hells Heimfeld (Dunkel-Spitzen 19–24)
  g = setup({ 13: 15 });
  mv(g, 'a', 1, 0, 1);
  assert.equal(g.kind, 'gammon'); assert.equal(g.points, 2);
  assert.deepEqual(P.winnerPoints(g, 0), { kind: 'gammon', points: 2 });
  // Backgammon: Verlierer hat noch einen Stein in Hells Heimfeld (Dunkel-Spitze 19..24) bzw. auf der Bar
  g = setup({ 13: 14, 20: 1 });
  mv(g, 'a', 1, 0, 1);
  assert.equal(g.kind, 'backgammon'); assert.equal(g.points, 3);
  assert.equal(g.matchWinner, 0, '3 Punkte beenden das Match bis 3');
  g = setup({ 13: 14, bar: 1 });
  mv(g, 'a', 1, 0, 1);
  assert.equal(g.kind, 'backgammon');
  // Grenzfall: Dunkel-Spitze 18 liegt noch nicht in Hells Heimfeld
  g = setup({ 13: 14, 18: 1 });
  mv(g, 'a', 1, 0, 1);
  assert.equal(g.kind, 'gammon');
  // Match bis 3: nach 2 Punkten weiter, nächste Partie: Verlierer beginnt, Punktestand bleibt
  g = setup({ 13: 15 });
  mv(g, 'a', 1, 0, 1);
  assert.equal(g.matchWinner, null);
  assert.equal(P.handle(g, 'b', { t: 'move', from: 13, to: 7, die: 6 }).ok, false, 'nach Partieende kein Zug');
  assert.equal(P.handle(g, 'a', { t: 'roll' }).ok, false);
  assert.equal(P.handle(g, 'a', { t: 'next' }, seedRng(3)).ok, true);
  assert.equal(g.mode, 'play'); assert.equal(g.gameNo, 2);
  assert.equal(g.turn, 1, 'Verlierer beginnt'); assert.equal(g.stage, 'roll');
  assert.deepEqual(g.scores, [2, 0]);
  assert.equal(P.pipCount(g, 0), 167);
  assert.equal(g.opening, null);
  assert.equal(g.winner, null);
  // zweite Partie: Hell gewinnt normal -> 3 Punkte -> Match zu Ende -> next startet neues Match mit neuem Eröffnungswurf
  put(g, 0, { 1: 1, off: 14 });
  put(g, 1, { 13: 14, off: 1 });
  turnTo(g, 0, [1]);
  mv(g, 'a', 1, 0, 1);
  assert.deepEqual(g.scores, [3, 0]); assert.equal(g.matchWinner, 0);
  assert.equal(P.ranking(g)[0].id, 'a'); assert.equal(P.ranking(g)[0].points, 3);
  assert.equal(P.handle(g, 'a', { t: 'next' }, seedRng(5)).ok, true);
  assert.deepEqual(g.scores, [0, 0]); assert.equal(g.gameNo, 1); assert.equal(g.matchWinner, null);
  assert.ok(g.opening, 'neuer Eröffnungswurf'); assert.equal(g.stage === 'move' || g.stage === 'roll', true);
});

test('Option „ein Spiel“: erste Partie entscheidet', () => {
  const g = mk({ one: true });
  put(g, 0, { 1: 1, off: 14 });
  put(g, 1, { 13: 14, off: 1 });
  turnTo(g, 0, [1]);
  mv(g, 'a', 1, 0, 1);
  assert.equal(g.matchWinner, 0);
  assert.match(g.recap.join(' '), /Spiel gewonnen/);
});

test('Keine legalen Züge: Wurf verfällt automatisch (Bar blockiert), Zug geht weiter', () => {
  const g = mk();
  put(g, 0, { bar: 1, 13: 14 });
  put(g, 1, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 13: 3 }); // Dunkel-Spitzen 1–6 = Hell 19–24 komplett gesperrt
  g.board[1][0] = 0;
  turnTo(g, 0, [], 'roll');
  const r = P.handle(g, 'a', { t: 'roll' }, script(val(2), val(5)));
  assert.equal(r.ok, true);
  assert.equal(g.turn, 1);
  assert.equal(g.stage, 'roll');
  assert.deepEqual(g.pass, { p: 0, rollId: g.rollId, all: true });
  assert.deepEqual(g.left, []);
  assert.match(g.recap.join(' '), /kann nicht ziehen/);
  assert.equal(P.canPlay(g), false);
  assert.equal(sum(g.board[0]), 15);
  // nächster Wurf löscht den Hinweis
  P.handle(g, 'b', { t: 'roll' }, script(val(1), val(2)));
  assert.ok(g.pass === null || g.pass.p === 1);
});

test('Restliche Würfel verfallen, wenn nach dem ersten Zug nichts mehr geht', () => {
  const g = mk();
  put(g, 0, { 8: 1 }); // alle anderen raus
  put(g, 1, { 20: 2, 22: 2 }); // Hell-Spitzen 5 und 3 gesperrt
  turnTo(g, 0, [3, 2]);
  assert.deepEqual(P.legalMoves(g).map(key), ['8>6:2'], 'nur die 2 geht (3: 8->5 gesperrt)');
  assert.equal(mv(g, 'a', 8, 6, 2).ok, true);
  assert.equal(g.turn, 1, 'Zug wechselt, weil die 3 nicht mehr spielbar ist');
  assert.equal(g.stage, 'roll');
  assert.deepEqual(g.pass, { p: 0, rollId: g.rollId, all: false });
  assert.deepEqual(g.left, []);
  assert.match(g.recap.join(' '), /verfallen/);
  // gar kein Zug mit Wurf: sofortiger Wechsel beim Würfeln
  const h = mk();
  put(h, 0, { 8: 1 });
  put(h, 1, { 20: 2, 18: 2 }); // Hell 5 und 7 gesperrt
  turnTo(h, 0, [], 'roll');
  P.handle(h, 'a', { t: 'roll' }, script(val(3), val(1)));
  assert.equal(h.turn, 1);
  assert.equal(h.pass.all, true);
});

test('Pasch, der nur teilweise spielbar ist: gespielt wird so viel wie möglich, der Rest verfällt', () => {
  const g = mk();
  put(g, 0, { 7: 1 }); // Stein auf 7, alle anderen raus
  put(g, 1, { 20: 2 }); // Hell-Spitze 5 gesperrt
  turnTo(g, 0, [1, 1, 1, 1]);
  // 7->6 ok, danach 6->5 gesperrt (Herausspielen mit 1 nicht möglich)
  assert.deepEqual(P.legalMoves(g).map(key), ['7>6:1']);
  assert.equal(mv(g, 'a', 7, 6, 1).ok, true);
  assert.equal(g.turn, 1);
  assert.equal(g.pass.all, false);
  assert.deepEqual(g.left, []);
});

test('Ungültige Nachrichten und JSON-Sicherheit (nie eine Ausnahme)', () => {
  const g = mk({}, seedRng(11));
  const before = JSON.stringify(g);
  const junk = [null, undefined, 5, 'x', [], {}, { t: 'move' }, { t: 'move', from: 'a', to: 3 }, { t: 'move', from: 24, to: 18.5 }, { t: 'move', from: 1e9, to: -3, die: 'x' },
    { t: 'roll', extra: 1 }, { t: 'next' }, { t: 'undo' }, { t: 'move', from: 24, to: 20, die: 99 }, { t: 'move', from: null, to: null }, { t: '__proto__' }];
  for (const who of ['a', 'b', 'zz', null, undefined]) {
    for (const m of junk) {
      let r;
      assert.doesNotThrow(() => { r = P.handle(g, who, m); });
      assert.ok(r && typeof r.ok === 'boolean');
    }
  }
  // gültiger Wurf durch Junk kann passiert sein; Zustand bleibt gültig
  for (const b of g.board) assert.equal(sum(b), 15);
  assert.doesNotThrow(() => P.handle(null, 'a', { t: 'roll' }));
  assert.doesNotThrow(() => P.handle({}, 'a', { t: 'roll' }));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.ok(before.length > 100);
  // JSON-Zustand lässt sich weiterspielen
  const h = JSON.parse(JSON.stringify(mk({}, seedRng(12))));
  const m = P.legalMoves(h)[0];
  assert.equal(P.handle(h, h.players[h.turn].id, { t: 'move', from: m.from, to: m.to, die: m.die }).ok, true);
});

test('selectionFor: Bar-Pflicht, gewählte Spitze, einzige Quelle', () => {
  const g = mk();
  put(g, 0, { bar: 1, 13: 14 });
  put(g, 1, { 6: 15 });
  turnTo(g, 0, [2, 3]);
  assert.equal(P.selectionFor(g, 0, null), 25);
  const h = mk();
  turnTo(h, 0, [2, 3]);
  assert.equal(P.selectionFor(h, 0, null), null);
  assert.equal(P.selectionFor(h, 0, 13), 13);
  assert.equal(P.selectionFor(h, 0, 5), null, 'Spitze ohne Zug zählt nicht');
  const k = mk();
  put(k, 0, { 8: 1 }); k.board[0][0] = 14; put(k, 1, { 6: 15 });
  turnTo(k, 0, [2, 3]);
  assert.equal(P.selectionFor(k, 0, null), 8, 'einzige Quelle');
});

test('300 Zufallspartien: enden immer, Steinbilanz 15 je Seite, Wertung stimmt, JSON gleich', () => {
  const stats = { normal: 0, gammon: 0, backgammon: 0, hits: 0, passes: 0, turns: 0 };
  for (let n = 0; n < 300; n++) {
    const dice = seedRng(n * 31 + 7); const brain = seedRng(n * 17 + 3);
    const opts = n % 3 === 0 ? { one: true } : n % 3 === 1 ? {} : { to5: true };
    const g = P.createGame(P2, opts, dice);
    let steps = 0;
    while (g.mode === 'play' && steps < 20000) {
      steps++;
      const id = g.players[g.turn].id;
      if (g.stage === 'roll') { assert.equal(P.handle(g, id, { t: 'roll' }, dice).ok, true); }
      else {
        const ms = P.legalMoves(g);
        assert.ok(ms.length > 0, 'im Zugabschnitt gibt es immer einen Zug');
        assert.ok(g.left.length > 0);
        const m = ms[Math.floor(brain() * ms.length)];
        const r = P.handle(g, id, { t: 'move', from: m.from, to: m.to, die: m.die }, dice);
        assert.equal(r.ok, true, JSON.stringify(m) + r.error);
        if (g.last && g.last.hit) stats.hits++;
      }
      for (const b of g.board) { assert.equal(sum(b), 15, 'Steinbilanz'); assert.ok(b.every((x) => Number.isInteger(x) && x >= 0)); }
      if (g.pass) stats.passes++;
      if (steps % 40 === 0) assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
      // Spitzen: nie beide Seiten auf derselben Spitze
      for (let q = 1; q <= 24; q++) assert.ok(!(g.board[0][q] > 0 && g.board[1][25 - q] > 0), `Spitze ${q} doppelt besetzt`);
    }
    stats.turns += steps;
    assert.equal(g.mode, 'over', 'Partie ' + n + ' endet');
    assert.equal(g.board[g.winner][0], 15);
    const w = g.winner; const l = 1 - w;
    const exp = g.board[l][0] > 0 ? 1 : (g.board[l][25] + [19, 20, 21, 22, 23, 24].reduce((s, q) => s + g.board[l][q], 0) > 0 ? 3 : 2);
    assert.equal(g.points, exp);
    assert.equal(g.scores[w], exp);
    assert.equal(g.kind, exp === 1 ? 'normal' : exp === 2 ? 'gammon' : 'backgammon');
    stats[g.kind]++;
    assert.equal(g.matchWinner, g.scores[w] >= g.target ? w : null);
    if (g.matchWinner === null) { assert.equal(P.handle(g, 'a', { t: 'next' }, dice).ok, true); assert.equal(g.mode, 'play'); assert.equal(g.turn, l); }
  }
  console.log('Zufallspartien:', JSON.stringify(stats));
  assert.ok(stats.hits > 100 && stats.passes > 10, 'Schlagen und Aussetzen kommen vor');
});
