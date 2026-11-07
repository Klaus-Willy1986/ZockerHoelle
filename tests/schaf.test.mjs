import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schaf/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const C = (s, r) => ({ s, r }); // s: 0 Rot 1 Blau 2 Gelb 3 Grün
const key = (c) => c.s * 22 + c.r;
const snap = (g) => JSON.stringify(g);

// Zustand mit festen Karten: decks (oberste Karte = letzte), piles (oberste = letzte); `active` ist dran.
function setup({ n = 3, decks = [], piles = [], rows, active = 0, flipped = null } = {}) {
  const g = M.createGame(players(n), {}, seeded(1));
  g.players.forEach((p, i) => { p.deck = (decks[i] || []).map((c) => ({ ...c })); p.pile = (piles[i] || []).map((c) => ({ ...c })); });
  if (rows) g.rows = rows.map((r) => (r ? { ...r } : null));
  g.active = active;
  g.flipped = flipped ? { ...flipped } : null;
  g.source = null;
  g.last = null; g.notice = null; g.recap = [];
  M.refresh(g);
  return g;
}
const total = (g) => g.players.reduce((s, p) => s + p.deck.length + p.pile.length, 0) + (g.flipped ? 1 : 0)
  + g.rows.reduce((s, r) => s + (r ? r.hi - r.lo + 1 : 0), 0);
const NOROWS = [null, null, null, null];
const P = (g, i) => g.players[i];
const A = (to, pid) => (pid ? { t: 'place', to, pid } : { t: 'place', to });

test('Blatt: alle 84 Karten ausgeteilt, jede genau einmal, gleichmäßig, Reste an die ersten', () => {
  for (let n = 2; n <= 6; n++) {
    const g = M.createGame(players(n), {}, seeded(n));
    const base = Math.floor(84 / n);
    const extra = 84 % n;
    g.players.forEach((p, i) => { assert.equal(p.deck.length, base + (i < extra ? 1 : 0), `n=${n} i=${i}`); assert.equal(p.pile.length, 0); });
    assert.equal(total(g), 84);
    assert.equal(g.penalty, undefined, 'kein Strafstapel mehr');
    const cnt = new Map();
    for (const c of g.players.flatMap((p) => p.deck)) cnt.set(key(c), (cnt.get(key(c)) || 0) + 1);
    assert.equal(cnt.size, 84);
    assert.deepEqual(g.rows, NOROWS);
    assert.equal(g.phase, 'play');
    assert.equal(g.source, null);
  }
});

test('Startperson links vom Geber (rng); createGame prüft Spielerzahl und hostId; JSON, deterministisch', () => {
  assert.throws(() => M.createGame(players(1)));
  assert.throws(() => M.createGame(players(7)));
  assert.throws(() => M.createGame('x'));
  const seen = new Set();
  for (let s = 1; s < 40; s++) { const g = M.createGame(players(4), {}, seeded(s)); assert.equal(g.active, g.starter); assert.equal(g.starter, (g.dealer + 1) % 4); seen.add(g.active); }
  assert.ok(seen.size > 1);
  assert.equal(M.createGame(players(2), {}, seeded(2), 'p1').hostId, 'p1');
  const g = M.createGame(players(4), {}, seeded(3));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.equal(snap(M.createGame(players(3), {}, seeded(9))), snap(M.createGame(players(3), {}, seeded(9))));
});

test('Mitte: 11 eröffnet, ±1 in derselben Farbe, Grenzen 1 und 21, falsche Farbe', () => {
  const g = setup({});
  assert.ok(M.fits(g, C(0, 11)));
  assert.ok(!M.fits(g, C(0, 10)) && !M.fits(g, C(0, 12)));
  g.rows[0] = { lo: 11, hi: 11 };
  assert.ok(!M.fits(g, C(0, 11)));
  assert.ok(M.fits(g, C(0, 12)) && M.fits(g, C(0, 10)));
  assert.ok(!M.fits(g, C(0, 13)) && !M.fits(g, C(0, 9)) && !M.fits(g, C(1, 12)));
  g.rows[0] = { lo: 5, hi: 20 };
  assert.ok(M.fits(g, C(0, 21)) && M.fits(g, C(0, 4)) && !M.fits(g, C(0, 22)));
  g.rows[0] = { lo: 1, hi: 21 };
  assert.ok(!M.fits(g, C(0, 21)) && !M.fits(g, C(0, 1)));
  assert.ok(!M.fits(g, { s: 4, r: 3 }) && !M.fits(g, null));
});

test('Aufdrücken: gleiche Farbe, genau ±1, nicht auf leeren Stapel, nicht auf die eigene Person', () => {
  const g = setup({ piles: [[], [C(2, 14)], []], flipped: C(2, 13), decks: [[C(3, 1)], [C(3, 2)], [C(3, 3)]] });
  assert.ok(M.fitsOn(g, C(2, 13), 'p1') && M.fitsOn(g, C(2, 15), 'p1'));
  assert.ok(!M.fitsOn(g, C(2, 14), 'p1') && !M.fitsOn(g, C(2, 12), 'p1') && !M.fitsOn(g, C(1, 13), 'p1'));
  assert.ok(!M.fitsOn(g, C(2, 13), 'p2'), 'leerer offener Stapel');
  assert.deepEqual(M.targetsFor(g, C(2, 13), 'p0'), { center: false, others: ['p1'] });
  // Nachricht: leer / eigene / falsche Zahl -> freundlich abgelehnt, keine Strafe
  for (const [m, text] of [[A('other', 'p2'), /leeren/], [A('other', 'p0'), /dir selbst/]]) {
    const before = snap(g);
    const r = M.handle(g, 'p0', m);
    assert.equal(r.ok, false); assert.equal(r.soft, true); assert.match(r.error, text);
    const a = JSON.parse(snap(g)); a.notice = null; g.notice = null;
    assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(before))); 
  }
  const h = setup({ piles: [[], [C(2, 14)], []], flipped: C(2, 12), decks: [[C(3, 1)], [C(3, 2)], [C(3, 3)]] });
  const r = M.handle(h, 'p0', A('other', 'p1'));
  assert.equal(r.soft, true); assert.equal(r.error, 'Die Karte passt dort nicht.');
  assert.equal(h.active, 0); assert.ok(!h.last || !h.last.penalty);
  assert.equal(M.handle(h, 'p0', A('other', 'nobody')).ok, false);
  assert.equal(M.handle(h, 'p0', A('other')).ok, false);
  assert.equal(M.handle(h, 'p0', { t: 'place', to: 'x' }).ok, false);
});

test('Aufdrücken: Karte liegt oben, Person hat eine Karte mehr, Zug geht weiter (Aufdecken-Pflicht erneut geprüft)', () => {
  const g = setup({ piles: [[], [C(2, 14)], []], flipped: C(2, 13), decks: [[C(3, 1), C(3, 9)], [C(3, 2)], [C(3, 3)]] });
  const r = M.handle(g, 'p0', A('other', 'p1'));
  assert.equal(r.ok, true);
  assert.deepEqual(M.topOf(P(g, 1)), C(2, 13));
  assert.equal(P(g, 1).pile.length, 2);
  assert.equal(g.active, 0, 'Zug geht weiter');
  assert.equal(g.flipped, null);
  assert.equal(g.source, null, 'eigene offene Karte: leer, jetzt wird aufgedeckt');
  assert.ok(!g.last.penalty);
});

test('Gesetz 2: aufgedeckte Karte -> Mitte, sonst aufdrücken, sonst bei sich (Zug endet)', () => {
  // Mitte
  let g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], decks: [[C(0, 12)], [C(3, 2)], [C(3, 3)]] });
  assert.equal(M.handle(g, 'p0', { t: 'flip' }).ok, true);
  assert.equal(g.source, 'flipped');
  assert.equal(M.handle(g, 'p0', A('center')).ok, true);
  assert.deepEqual(g.rows[0], { lo: 11, hi: 12 });
  assert.equal(g.active, 0);
  // bei sich (nirgends sonst)
  g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], decks: [[C(1, 7)], [C(3, 2)], [C(3, 3)]] });
  M.handle(g, 'p0', { t: 'flip' });
  const r = M.handle(g, 'p0', A('own'));
  assert.equal(r.ok, true); assert.equal(r.schafskopp, null);
  assert.deepEqual(M.topOf(P(g, 0)), C(1, 7));
  assert.equal(g.active, 1, 'Zug beendet');
  assert.equal(g.flipped, null);
  assert.ok(!g.last.penalty);
  // Elf in leere Mitte
  g = setup({ decks: [[C(2, 11)], [C(3, 2)], [C(3, 3)]] });
  M.handle(g, 'p0', { t: 'flip' });
  M.handle(g, 'p0', A('center'));
  assert.deepEqual(g.rows[2], { lo: 11, hi: 11 });
});

test('Mitte: nach oben und unten wachsen; nicht passend -> freundlich abgelehnt', () => {
  const g = setup({ rows: [{ lo: 10, hi: 12 }, null, null, null], piles: [[C(0, 13)]], decks: [[C(1, 5)], [C(3, 2)], [C(3, 3)]] });
  assert.equal(g.source, 'open');
  assert.equal(M.handle(g, 'p0', A('center')).ok, true);
  assert.deepEqual(g.rows[0], { lo: 10, hi: 13 });
  const h = setup({ rows: [{ lo: 10, hi: 12 }, null, null, null], flipped: C(0, 8), decks: [[C(1, 5)], [C(3, 2)]] });
  const r = M.handle(h, 'p0', A('center'));
  assert.equal(r.soft, true);
  assert.equal(h.flipped.r, 8);
  const k = setup({ rows: [{ lo: 10, hi: 12 }, null, null, null], piles: [[C(0, 9)]], decks: [[C(1, 5)], [C(3, 2)]] });
  M.handle(k, 'p0', A('center'));
  assert.deepEqual(k.rows[0], { lo: 9, hi: 12 });
});

test('Gesetz 1: passende offene Oberkarte muss zuerst gespielt werden; danach die nächste geprüft', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(0, 13), C(0, 12)]], decks: [[C(1, 5)], [C(3, 2)], [C(3, 3)]] });
  assert.equal(g.source, 'open');
  M.handle(g, 'p0', A('center'));
  assert.equal(g.source, 'open', 'Karte darunter (13) passt jetzt');
  M.handle(g, 'p0', A('center'));
  assert.deepEqual(g.rows[0], { lo: 11, hi: 13 });
  assert.equal(g.source, null, 'jetzt darf aufgedeckt werden');
  assert.equal(P(g, 0).pile.length, 0);
  // offene Karte passt nur bei jemandem
  const h = setup({ piles: [[C(2, 15)], [C(2, 14)], []], decks: [[C(1, 5)], [C(3, 2)], [C(3, 3)]] });
  assert.equal(h.source, 'open');
  assert.equal(M.handle(h, 'p0', A('other', 'p1')).ok, true);
  assert.deepEqual(M.topOf(P(h, 1)), C(2, 15));
});

test('Fehler a: Aufdecken trotz passender offener Karte -> Karte wird aufgedeckt, von jedem eine Karte, Zug endet', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(0, 12)]], decks: [[C(1, 3), C(1, 4)], [C(2, 1), C(2, 2)], [C(3, 1), C(3, 2)]] });
  const r = M.handle(g, 'p0', { t: 'flip' });
  assert.equal(r.ok, true); assert.equal(r.schafskopp, 'a');
  assert.deepEqual(M.topOf(P(g, 0)), C(1, 4), 'aufgedeckte Karte liegt oben auf dem eigenen offenen Stapel');
  assert.equal(g.flipped, null);
  assert.deepEqual(P(g, 0).deck, [C(3, 2), C(2, 2), C(1, 3)], 'zuerst von p1, dann von p2 (je unten angefügt), eigener Rest oben');
  assert.equal(P(g, 1).deck.length, 1); assert.equal(P(g, 2).deck.length, 1);
  assert.equal(g.active, 1);
  assert.equal(g.last.penalty.reason, 'a'); assert.equal(g.last.penalty.pid, 'p0'); assert.equal(g.last.penalty.got, 2);
  assert.ok(g.recap.some((l) => l.includes('Schafskopp') && l.includes('gepennt') && l.includes('P0')));
});

test('Fehler b: aufgedeckte Karte bei sich ablegen, obwohl sie in die Mitte oder bei jemandem passt', () => {
  let g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], flipped: C(0, 12), decks: [[C(1, 3)], [C(2, 1), C(2, 2)], [C(3, 1), C(3, 2)]] });
  let r = M.handle(g, 'p0', A('own'));
  assert.equal(r.schafskopp, 'b');
  assert.deepEqual(M.topOf(P(g, 0)), C(0, 12), 'Karte liegt dort, wo sie hingelegt wurde');
  assert.equal(P(g, 0).deck.length, 3);
  assert.equal(g.active, 1);
  assert.equal(g.last.penalty.reason, 'b');
  // passt nur bei jemandem
  g = setup({ piles: [[], [C(2, 14)], []], flipped: C(2, 13), decks: [[C(1, 3)], [C(2, 1), C(2, 2)], [C(3, 1), C(3, 2)]] });
  r = M.handle(g, 'p0', A('own'));
  assert.equal(r.schafskopp, 'b');
  assert.equal(g.active, 1);
});

test('Fehler c: aufdrücken, obwohl die Karte in die Mitte passt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[], [C(0, 13)], []], flipped: C(0, 12), decks: [[C(1, 3)], [C(2, 1)], [C(3, 1), C(3, 2)]] });
  const r = M.handle(g, 'p0', A('other', 'p1'));
  assert.equal(r.schafskopp, 'c');
  assert.deepEqual(M.topOf(P(g, 1)), C(0, 12), 'Karte liegt bei P1');
  assert.equal(P(g, 0).deck.length, 3);
  assert.equal(g.active, 1);
  assert.equal(g.last.penalty.reason, 'c');
});

test('Strafkarten: von jeder Person die oberste verdeckte (sonst offene), unten auf den Stapel, in Sitzreihenfolge', () => {
  const g = setup({ n: 4, active: 1, rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(3, 20)], [C(0, 12)], [C(3, 6), C(3, 7)], [C(3, 9)]],
    decks: [[C(2, 1), C(2, 2)], [C(1, 3)], [], [C(3, 3)]] });
  M.handle(g, 'p1', { t: 'flip' }); // Fehler a
  const d = P(g, 1).deck;
  // Reihenfolge: p2 (offen, da Stapel leer), p3 (oberste verdeckte), p0 (oberste verdeckte = 2/2); jede neue Karte kommt ganz nach unten
  assert.deepEqual(d, [C(2, 2), C(3, 3), C(3, 7)]);
  assert.equal(P(g, 2).pile.length, 1); assert.equal(P(g, 3).pile.length, 1); assert.equal(P(g, 3).deck.length, 0);
  assert.equal(P(g, 0).deck.length, 1);
  assert.equal(g.active, 0, 'p2 und p3 können nichts tun und werden übersprungen');
});

test('Strafkarten: hat jemand gar keine Karte mehr, entfällt es; wer alles abgibt, gewinnt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(0, 12)], [], []], decks: [[C(1, 3)], [C(2, 1)], []] });
  M.handle(g, 'p0', { t: 'flip' });
  assert.equal(g.last.penalty.got, 1);
  assert.equal(P(g, 0).deck.length, 1);
  // p1 gibt seine letzte Karte ab und hat dann nichts mehr -> gewinnt sofort
  assert.equal(g.phase, 'over');
  assert.ok(g.result.winners.includes('p1'));
});

test('Kein Schafskopp, wenn die Karte gar nicht passt (nur Hinweis, kein Zugverlust)', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], flipped: C(1, 7), piles: [[], [C(2, 14)], []], decks: [[C(1, 3)], [C(2, 1)], [C(3, 1)]] });
  const before = snap(g);
  for (const m of [A('center'), A('other', 'p1'), A('other', 'p2')]) {
    const r = M.handle(g, 'p0', m);
    assert.equal(r.soft, true);
    assert.equal(g.active, 0);
  }
  g.notice = null;
  assert.equal(snap(g), before);
  // Aufdecken mit Karte in der Hand: freundlich abgelehnt
  const r = M.handle(g, 'p0', { t: 'flip' });
  assert.equal(r.soft, true);
  // eigene Oberkarte "bei mir ablegen" ohne aufgedeckte Karte
  const h = setup({ piles: [[C(1, 9)]], decks: [[C(1, 3)], [C(2, 1)], [C(3, 1)]] });
  assert.equal(M.handle(h, 'p0', A('own')).soft, true);
  assert.equal(h.active, 0);
});

test('Zugende: Spieler ohne Möglichkeit werden übersprungen', () => {
  const g = setup({ rows: NOROWS, decks: [[C(1, 7)], [], [C(3, 3)]], piles: [[], [C(2, 5)], []] });
  M.handle(g, 'p0', { t: 'flip' });
  M.handle(g, 'p0', A('own'));
  assert.equal(g.active, 2, 'p1 hat keinen Stapel und seine offene Karte passt nirgends');
});

test('Spielende: Wer zuerst alle Karten los ist, gewinnt; Ranking nach Restkarten, Ehrentitel Schafskopp', () => {
  const g = setup({ n: 4, rows: [{ lo: 11, hi: 12 }, null, null, null], piles: [[C(0, 13)], [C(1, 5)], [C(1, 6), C(2, 3)], [C(2, 8)]], decks: [[], [C(1, 7), C(1, 9)], [C(3, 4)], [C(3, 5), C(3, 6), C(3, 7)]] });
  const r = M.handle(g, 'p0', A('center'));
  assert.equal(r.ok, true);
  assert.equal(g.phase, 'over');
  const res = g.result;
  assert.equal(res.blocked, false);
  assert.equal(res.finisher, 'p0');
  assert.deepEqual(res.winners, ['p0']);
  assert.deepEqual(res.rest, { p0: 0, p1: 3, p2: 3, p3: 4 });
  assert.deepEqual(res.places, { p0: 1, p1: 2, p2: 2, p3: 4 });
  assert.deepEqual(res.schafskopp, ['p3'], 'meiste Karten');
  assert.deepEqual(M.ranking(g).map((x) => [x.id, x.place]), [['p0', 1], ['p1', 2], ['p2', 2], ['p3', 4]]);
  assert.equal(M.handle(g, 'p1', { t: 'flip' }).ok, false, 'nach dem Ende keine Züge');
});

test('Spielende: letzte Karte (aufgedeckt) in die Mitte -> Sieg; Gleichstand beim Ehrentitel: alle Betroffenen', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], flipped: C(0, 12), decks: [[], [C(1, 1), C(1, 2)], [C(1, 3), C(1, 4)]] });
  M.handle(g, 'p0', A('center'));
  assert.deepEqual(g.result.winners, ['p0']);
  assert.deepEqual(g.result.schafskopp.sort(), ['p1', 'p2']);
});

test('Blockade: niemand hat verdeckte Karten, nichts passt -> Ende, wenigste Restkarten gewinnt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(1, 2), C(1, 4)], [C(2, 5)], [C(3, 6), C(3, 8), C(3, 10)]], decks: [[], [], [C(0, 20)]], active: 2 });
  M.handle(g, 'p2', { t: 'flip' });
  M.handle(g, 'p2', A('own')); // letzte verdeckte Karte, passt nirgends
  assert.equal(g.phase, 'over');
  assert.equal(g.result.blocked, true);
  assert.deepEqual(g.result.winners, ['p1']);
  assert.deepEqual(g.result.places, { p0: 2, p1: 1, p2: 3 });
});

test('Ungültige Nachrichten, falsche Person, falsche Phase ändern nichts', () => {
  const g = M.createGame(players(3), {}, seeded(5), 'p0');
  const before = snap(g);
  const act = M.activePlayer(g).id;
  const other = act === 'p1' ? 'p2' : 'p1';
  const bad = [[null, act], [undefined, act], [{}, act], [{ t: 5 }, act], [{ t: 'xyz' }, act], [{ t: 'end' }, act], [{ t: 'next' }, act], [{ t: 'flip' }, 'fremd'], [{ t: 'flip' }, other], [{ t: 'place', to: 'center' }, other]];
  for (const [m, who] of bad) {
    const r = M.handle(g, who, m);
    assert.equal(r.ok, false, JSON.stringify(m) + who);
    assert.equal(snap(g), before);
  }
  assert.equal(M.handle(null, 'p0', { t: 'flip' }).ok, false);
  assert.equal(M.handle({ game: 'x' }, 'p0', { t: 'flip' }).ok, false);
  const o = setup({ flipped: C(0, 11), decks: [[C(1, 3)], [C(2, 1)], [C(3, 1)]] });
  o.phase = 'over';
  const b2 = snap(o);
  assert.equal(M.handle(o, 'p0', { t: 'flip' }).ok, false);
  assert.equal(M.handle(o, 'p0', A('center')).ok, false);
  assert.equal(snap(o), b2);
});

function randomGame(seed, n) {
  const rng = seeded(seed * 31 + 7);
  const g = M.createGame(players(n), {}, rng);
  const pMistake = [0, 0.3, 0.6][seed % 3];
  let steps = 0; let pens = 0;
  while (g.phase === 'play') {
    assert.ok(steps++ < 60000, 'Spiel endet nicht');
    const ap = M.activePlayer(g);
    const x = rng();
    let msg;
    if (!g.source) msg = { t: 'flip' };
    else {
      const card = M.curCard(g);
      const tg = M.targetsFor(g, card, ap.id);
      if (x < pMistake) {
        const all = [{ t: 'flip' }, A('own'), A('center'), ...g.players.filter((p) => p.id !== ap.id).map((p) => A('other', p.id))];
        msg = all[Math.floor(rng() * all.length)];
      } else if (tg.center) msg = A('center');
      else if (tg.others.length) msg = A('other', tg.others[Math.floor(rng() * tg.others.length)]);
      else msg = A('own');
    }
    const before = g.last && g.last.penalty ? g.last.seq : -1;
    const r = M.handle(g, ap.id, msg);
    if (g.notice) g.notice = null;
    if (r.schafskopp) pens++;
    assert.equal(total(g), 84, 'Kartenbilanz');
    for (const row of g.rows) if (row) assert.ok(row.lo <= 11 && row.hi >= 11 && row.lo >= 1 && row.hi <= 21);
    if (g.phase === 'play') {
      const p = M.activePlayer(g);
      assert.ok(g.flipped || p.deck.length > 0 || (M.topOf(p) && M.playableAnywhere(g, M.topOf(p), p.id)), 'aktive Person kann handeln');
      assert.equal(g.source === 'flipped', !!g.flipped);
    }
  }
  g.pens = pens;
  return g;
}

test('300 Zufallspartien (richtige und falsche Züge gemischt) mit 2-6 Personen enden immer, Kartenbilanz stets 84', () => {
  let blocked = 0; let pens = 0;
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 5);
    const g = randomGame(i + 1, n);
    assert.equal(g.phase, 'over');
    assert.ok(g.result.winners.length >= 1);
    for (const p of g.players) assert.equal(g.result.rest[p.id], M.restCount(g, p));
    if (!g.result.blocked) { const f = g.players.find((p) => p.id === g.result.finisher); assert.equal(f.deck.length + f.pile.length, 0); } else blocked++;
    pens += g.pens;
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
  console.log('Zufallspartien: blockiert', blocked, 'von 300, Schafskopp-Fehler gesamt', pens);
});
