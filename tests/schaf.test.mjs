import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schaf/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const C = (s, r) => ({ s, r }); // s: 0 Rot 1 Blau 2 Gelb 3 Grün
const key = (c) => c.s * 22 + c.r;
const snap = (g) => JSON.stringify(g);

// Zustand mit festen Karten: p0 ist dran. decks/piles: je Person (Deck: oberste Karte = letzte)
function setup({ n = 3, decks = [], piles = [], rows, penalty, active = 0 } = {}) {
  const g = M.createGame(players(n), {}, seeded(1));
  g.players.forEach((p, i) => { p.deck = (decks[i] || []).map((c) => ({ ...c })); p.pile = (piles[i] || []).map((c) => ({ ...c })); });
  if (rows) g.rows = rows.map((r) => (r ? { ...r } : null));
  if (penalty) g.penalty = penalty.map((c) => ({ ...c }));
  g.penaltyExtra = Object.fromEntries(g.players.map((p) => [p.id, 0]));
  g.active = active;
  g.turn = { acts: 0 };
  g.idle = 0;
  g.last = null; g.notice = null;
  return g;
}
const total = (g) => g.players.reduce((s, p) => s + p.deck.length + p.pile.length, 0) + g.penalty.length
  + g.rows.reduce((s, r) => s + (r ? r.hi - r.lo + 1 : 0), 0);
const R11 = [null, null, null, null];

test('Blatt: 84 Karten, jede genau einmal, 12 Strafkarten, gleichmäßig verteilt, Reste an die ersten', () => {
  for (let n = 2; n <= 6; n++) {
    const g = M.createGame(players(n), {}, seeded(n));
    assert.equal(g.penalty.length, 12);
    const dealt = 72;
    const base = Math.floor(dealt / n);
    const extra = dealt % n;
    g.players.forEach((p, i) => { assert.equal(p.deck.length, base + (i < extra ? 1 : 0), `n=${n} i=${i}`); assert.equal(p.pile.length, 0); });
    assert.equal(total(g), 84);
    const cnt = new Map();
    for (const c of [...g.penalty, ...g.players.flatMap((p) => p.deck)]) cnt.set(key(c), (cnt.get(key(c)) || 0) + 1);
    assert.equal(cnt.size, 84);
    for (const v of cnt.values()) assert.equal(v, 1);
    assert.equal(g.phase, 'play');
    assert.deepEqual(g.rows, R11);
    assert.deepEqual(g.penaltyExtra, Object.fromEntries(g.players.map((p) => [p.id, 0])));
  }
});

test('Startperson: links vom Geber, hängt vom rng ab; createGame prüft Spielerzahl und hostId', () => {
  assert.throws(() => M.createGame(players(1)));
  assert.throws(() => M.createGame(players(7)));
  assert.throws(() => M.createGame('x'));
  const seen = new Set();
  for (let s = 1; s < 40; s++) { const g = M.createGame(players(4), {}, seeded(s)); assert.equal(g.active, g.starter); assert.equal(g.starter, (g.dealer + 1) % 4); seen.add(g.active); }
  assert.ok(seen.size > 1);
  assert.equal(M.createGame(players(2), {}, seeded(2), 'p1').hostId, 'p1');
  assert.equal(M.createGame(players(2), undefined, seeded(2)).hostId, 'p0');
});

test('Zustand ist reines JSON und deterministisch', () => {
  const g = M.createGame(players(4), {}, seeded(3));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.equal(snap(M.createGame(players(3), {}, seeded(9))), snap(M.createGame(players(3), {}, seeded(9))));
});

test('Anlegeregeln: 11 eröffnet, ±1 in derselben Farbe, Grenzen 1 und 21, falsche Farbe', () => {
  const g = setup({});
  assert.ok(M.fits(g, C(0, 11)));
  assert.ok(!M.fits(g, C(0, 10)));
  assert.ok(!M.fits(g, C(0, 12)));
  g.rows[0] = { lo: 11, hi: 11 };
  assert.ok(!M.fits(g, C(0, 11)), 'zweite Elf der Reihe gibt es nicht');
  assert.ok(M.fits(g, C(0, 12)) && M.fits(g, C(0, 10)));
  assert.ok(!M.fits(g, C(0, 13)) && !M.fits(g, C(0, 9)));
  assert.ok(!M.fits(g, C(1, 12)), 'andere Farbe, Reihe nicht eröffnet');
  assert.ok(M.fits(g, C(1, 11)));
  g.rows[0] = { lo: 5, hi: 20 };
  assert.ok(M.fits(g, C(0, 21)) && M.fits(g, C(0, 4)));
  assert.ok(!M.fits(g, C(0, 22)));
  g.rows[0] = { lo: 1, hi: 21 };
  assert.ok(!M.fits(g, C(0, 21)) && !M.fits(g, C(0, 1)));
  g.rows[2] = { lo: 1, hi: 15 };
  assert.ok(!M.fits(g, C(2, 0)));
  assert.ok(M.fits(g, C(2, 16)));
  assert.ok(!M.fits(g, { s: 4, r: 3 }) && !M.fits(g, null));
});

test('Aufdecken: passende Karte bleibt im Zug, nicht passende beendet den Zug automatisch', () => {
  const g = setup({ decks: [[C(0, 3), C(0, 11)], [C(1, 2)], [C(2, 2)]] });
  const r = M.handle(g, 'p0', { t: 'flip' });
  assert.equal(r.ok, true); assert.equal(r.fits, true);
  assert.equal(g.active, 0, 'Zug geht weiter');
  assert.deepEqual(M.topOf(g.players[0]), C(0, 11));
  assert.equal(M.handle(g, 'p0', { t: 'place' }).ok, true);
  assert.deepEqual(g.rows[0], { lo: 11, hi: 11 });
  assert.equal(g.players[0].pile.length, 0);
  assert.equal(g.active, 0);
  const r2 = M.handle(g, 'p0', { t: 'flip' }); // 0/3 passt nicht
  assert.equal(r2.fits, false);
  assert.equal(g.active, 1, 'Zug beendet');
  assert.deepEqual(M.topOf(g.players[0]), C(0, 3), 'Karte bleibt offen liegen');
});

test('Anlegen nach oben und unten, Reihe wächst', () => {
  const g = setup({ rows: [{ lo: 10, hi: 12 }, null, null, null], piles: [[C(0, 13)]], decks: [[C(0, 9), C(1, 5)], [C(2, 2)], [C(2, 3)]] });
  M.handle(g, 'p0', { t: 'place' });
  assert.deepEqual(g.rows[0], { lo: 10, hi: 13 });
  M.handle(g, 'p0', { t: 'flip' }); // 1/5 passt nicht -> Zug zu Ende; 0/9 bleibt unten im Stapel
  assert.equal(g.active, 1);
  const g2 = setup({ rows: [{ lo: 10, hi: 12 }, null, null, null], piles: [[C(0, 9)]], decks: [[C(1, 5)]] });
  M.handle(g2, 'p0', { t: 'place' });
  assert.deepEqual(g2.rows[0], { lo: 9, hi: 12 });
});

test('Pflicht: Aufdecken ist verboten, solange die eigene offene Oberkarte passt', () => {
  const g = setup({ piles: [[C(0, 11)]], decks: [[C(1, 3)]] });
  const before = snap(g);
  const r = M.handle(g, 'p0', { t: 'flip' });
  assert.equal(r.ok, false); assert.equal(r.soft, true);
  const after = JSON.parse(snap(g));
  assert.ok(after.notice && after.notice.pid === 'p0');
  after.notice = null;
  assert.equal(JSON.stringify(after), before, 'außer dem Hinweis nichts geändert');
});

test('Fremde Oberkarte in die Mitte legen; vorherige Karte liegt wieder oben', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(1, 2)], [C(0, 5), C(0, 12)], []], decks: [[C(1, 7)], [C(2, 1)], [C(2, 4)]] });
  const r = M.handle(g, 'p0', { t: 'place', from: 'p1' });
  assert.equal(r.ok, true);
  assert.deepEqual(g.rows[0], { lo: 11, hi: 12 });
  assert.deepEqual(M.topOf(g.players[1]), C(0, 5));
  assert.equal(g.active, 0, 'Zug geht weiter');
  assert.ok(g.recap[0].includes('P1'));
});

test('Karte passt nicht: freundlicher Hinweis, keine Strafe, nichts bewegt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[], [C(0, 15)], []], decks: [[C(1, 7)], [C(2, 1)], [C(2, 4)]] });
  const b = JSON.parse(snap(g));
  const r = M.handle(g, 'p0', { t: 'place', from: 'p1' });
  assert.equal(r.ok, false); assert.equal(r.soft, true);
  assert.equal(r.error, 'Die Karte passt nicht.');
  assert.deepEqual(g.penaltyExtra, b.penaltyExtra);
  assert.equal(g.penalty.length, 12);
  assert.equal(g.players[0].deck.length, 1);
  g.notice = null;
  assert.equal(snap(g), snap(b));
  // leerer fremder Stapel / eigener leerer Stapel / unbekannte Person
  assert.equal(M.handle(g, 'p0', { t: 'place', from: 'p2' }).soft, true);
  assert.equal(M.handle(g, 'p0', { t: 'place' }).soft, true);
  assert.equal(M.handle(g, 'p0', { t: 'place', from: 'nobody' }).ok, false);
  assert.equal(M.handle(g, 'p0', { t: 'place', from: 5 }).ok, false);
});

test('Strafe: Zug beenden (freiwillig) mit passender EIGENER Oberkarte -> 2 Strafkarten unten auf den Stapel', () => {
  const pen = [C(3, 1), C(3, 2), C(3, 3)];
  const g = setup({ piles: [[C(0, 11)]], decks: [[C(1, 3), C(1, 4)], [C(2, 1)], [C(2, 4)]], penalty: pen });
  const r = M.handle(g, 'p0', { t: 'end' });
  assert.equal(r.ok, true); assert.equal(r.missed, true);
  const p = g.players[0];
  assert.equal(p.deck.length, 4);
  assert.deepEqual(p.deck.slice(0, 2), [C(3, 2), C(3, 3)], 'beide Strafkarten ganz unten');
  assert.deepEqual(p.deck.slice(2), [C(1, 3), C(1, 4)], 'bisheriger Stapel bleibt oben');
  assert.equal(g.penalty.length, 1);
  assert.equal(g.active, 1);
  assert.ok(g.recap.some((l) => l.includes('Schafskopp') && l.includes('P0')));
  assert.ok(g.last.penalty && g.last.penalty.pid === 'p0');
});

test('Strafe: Zug endet automatisch nach nicht passender Aufdeckkarte, während eine FREMDE Oberkarte passt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[], [C(0, 12)], []], decks: [[C(1, 7)], [C(2, 1)], [C(2, 4)]], penalty: [C(3, 1), C(3, 2)] });
  const r = M.handle(g, 'p0', { t: 'flip' });
  assert.equal(r.fits, false);
  assert.equal(g.active, 1);
  assert.equal(g.players[0].deck.length, 2, 'zwei Strafkarten unten');
  assert.equal(g.penalty.length, 0);
});

test('Keine Strafe, wenn nichts passt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[], [C(0, 15)], [C(2, 9)]], decks: [[C(1, 7)], [C(2, 1)], [C(2, 4)]] });
  M.handle(g, 'p0', { t: 'flip' });
  assert.equal(g.active, 1);
  assert.equal(g.players[0].deck.length, 0);
  assert.equal(g.penalty.length, 12);
  assert.deepEqual(g.penaltyExtra, { p0: 0, p1: 0, p2: 0 });
  assert.ok(!g.last.penalty);
});

test('Freiwilliges Beenden ohne passende Karte: nur ein Hinweis (zuerst aufdecken)', () => {
  const g = setup({ piles: [[C(0, 3)]], decks: [[C(1, 7)], [C(2, 1)], [C(2, 4)]] });
  const b = JSON.parse(snap(g));
  const r = M.handle(g, 'p0', { t: 'end' });
  assert.equal(r.ok, false); assert.equal(r.soft, true);
  g.notice = null;
  assert.equal(snap(g), snap(b));
});

test('Strafstapel leer oder fast leer -> Strafpunkte zählen als Restkarten', () => {
  const g = setup({ piles: [[C(0, 11)]], decks: [[C(1, 3)], [C(2, 1)], [C(2, 4)]], penalty: [C(3, 1)] });
  M.handle(g, 'p0', { t: 'end' });
  assert.equal(g.players[0].deck.length, 2, 'eine echte Strafkarte');
  assert.equal(g.penaltyExtra.p0, 1, 'eine als Strafpunkt');
  assert.equal(g.penalty.length, 0);
  assert.equal(M.restCount(g, g.players[0]), g.players[0].deck.length + g.players[0].pile.length + 1);
  const g2 = setup({ piles: [[C(0, 11)]], decks: [[C(1, 3)], [C(2, 1)], [C(2, 4)]], penalty: [] });
  M.handle(g2, 'p0', { t: 'end' });
  assert.equal(g2.penaltyExtra.p0, 2);
  assert.equal(g2.players[0].deck.length, 1);
  assert.equal(M.restCount(g2, g2.players[0]), 1 + 1 + 2);
});

test('Spielende: wer keine Karten mehr hat, gewinnt; Platzierung nach Restkarten, Gleichstand teilt den Platz', () => {
  const g = setup({ n: 4, rows: [{ lo: 11, hi: 12 }, null, null, null], piles: [[C(0, 13)], [C(1, 5)], [C(1, 6), C(2, 3)], [C(2, 8)]], decks: [[], [C(1, 7), C(1, 9)], [C(3, 4)], [C(3, 5), C(3, 6)]] });
  g.penaltyExtra.p3 = 1;
  const r = M.handle(g, 'p0', { t: 'place' });
  assert.equal(r.won, true);
  assert.equal(g.phase, 'over');
  const res = g.result;
  assert.equal(res.blocked, false);
  assert.equal(res.finisher, 'p0');
  assert.deepEqual(res.winners, ['p0']);
  assert.deepEqual(res.rest, { p0: 0, p1: 3, p2: 3, p3: 4 });
  assert.deepEqual(res.places, { p0: 1, p1: 2, p2: 2, p3: 4 });
  assert.deepEqual(M.ranking(g).map((x) => [x.id, x.place]), [['p0', 1], ['p1', 2], ['p2', 2], ['p3', 4]]);
  assert.equal(M.handle(g, 'p1', { t: 'flip' }).ok, false, 'nach dem Ende keine Züge');
});

test('Spielende: auch wer durch fremdes Anlegen seinen letzten offenen Stapel verliert, gewinnt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(1, 2)], [C(0, 12)], []], decks: [[C(1, 7)], [], [C(2, 4)]] });
  const r = M.handle(g, 'p0', { t: 'place', from: 'p1' });
  assert.equal(r.won, true);
  assert.deepEqual(g.result.winners, ['p1']);
  assert.equal(g.result.finisher, 'p1');
});

test('Blockade: niemand hat verdeckte Karten, nichts passt -> Ende, wenigste Restkarten gewinnt', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(1, 2), C(1, 3)], [C(2, 5)], [C(3, 6), C(3, 7), C(3, 8)]], decks: [[], [], [C(0, 20)]], active: 2 });
  const r = M.handle(g, 'p2', { t: 'flip' }); // letzte verdeckte Karte, passt nicht
  assert.equal(r.fits, false);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.blocked, true);
  assert.equal(g.result.finisher, null);
  assert.deepEqual(g.result.winners, ['p1']);
  assert.deepEqual(g.result.places, { p0: 2, p1: 1, p2: 3 });
});

test('Blockade-Gleichstand: alle Gleichen gewinnen gemeinsam', () => {
  const g = setup({ n: 2, rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(1, 2)], [C(2, 5)]], decks: [[], [C(3, 3)]], active: 1 });
  M.handle(g, 'p1', { t: 'flip' });
  // p0: 1 offen, p1: 2 offen -> p0 gewinnt
  assert.deepEqual(g.result.winners, ['p0']);
  const h = setup({ n: 2, rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(1, 2)], [C(2, 5)]], decks: [[], []], active: 0 });
  h.players[0].pile.push(C(2, 9));
  h.players[1].pile.push(C(2, 10)); // beide 2 Karten, nichts passt
  // Zug von p0 beenden: nichts kann passieren -> Zug ruft endTurn über Beenden (Stapel leer, nichts passt)
  assert.equal(M.handle(h, 'p0', { t: 'end' }).ok, true);
  assert.equal(h.phase, 'over');
  assert.deepEqual(h.result.winners.sort(), ['p0', 'p1']);
});

test('Spieler ohne Möglichkeit werden übersprungen (Stapel leer, nichts passt)', () => {
  const g = setup({ rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[], [C(2, 5)], []], decks: [[C(1, 7)], [], [C(2, 4)]] });
  M.handle(g, 'p0', { t: 'flip' }); // passt nicht -> Zug zu Ende; p1 hat keine Aktion -> p2
  assert.equal(g.active, 2);
});

test('Ungültige Nachrichten, falsche Person, falsche Phase ändern nichts', () => {
  const g = M.createGame(players(3), {}, seeded(5), 'p0');
  const before = snap(g);
  const bad = [
    [null, 'p0'], [undefined, 'p0'], [{}, 'p0'], [{ t: 5 }, 'p0'], [{ t: 'xyz' }, 'p0'],
    [{ t: 'flip' }, 'fremd'], [{ t: 'flip' }, 'p1'], [{ t: 'place' }, 'p2'], [{ t: 'end' }, 'p1'], [{ t: 'next' }, 'p0'],
  ];
  const act = M.activePlayer(g).id;
  for (const [m, who] of bad) {
    const w = who === 'p1' && act === 'p1' ? 'p2' : who;
    const r = M.handle(g, w, m);
    assert.equal(r.ok, false, JSON.stringify(m) + w);
    assert.equal(snap(g), before);
  }
  assert.equal(M.handle(null, 'p0', { t: 'flip' }).ok, false);
  assert.equal(M.handle({ game: 'x' }, 'p0', { t: 'flip' }).ok, false);
  const o = setup({ piles: [[C(0, 11)]], decks: [[C(1, 3)], [C(2, 1)], [C(2, 4)]] });
  o.phase = 'over';
  const b2 = snap(o);
  for (const t of ['flip', 'place', 'end']) assert.equal(M.handle(o, 'p0', { t }).ok, false);
  assert.equal(snap(o), b2);
});

test('Termination auch bei dauerndem freiwilligem Beenden (Leerlauf endet die Runde)', () => {
  const g = setup({ n: 2, rows: [{ lo: 11, hi: 11 }, null, null, null], piles: [[C(0, 12)], [C(2, 5)]], decks: [[], []], penalty: [], active: 0 });
  let k = 0;
  while (g.phase === 'play' && k++ < 200) M.handle(g, M.activePlayer(g).id, { t: 'end' });
  assert.equal(g.phase, 'over');
  assert.ok(k < 200);
});

function randomGame(seed, n) {
  const rng = seeded(seed * 31 + 7);
  const g = M.createGame(players(n), {}, rng);
  const pEnd = [0, 0.05, 0.3][seed % 3];
  let steps = 0;
  while (g.phase === 'play') {
    assert.ok(steps++ < 20000, 'Spiel endet nicht');
    const id = M.activePlayer(g).id;
    const src = M.fittingSources(g);
    let msg;
    const x = rng();
    if (x < pEnd) msg = { t: 'end' };
    else if (src.length && rng() < 0.8) msg = { t: 'place', from: src[Math.floor(rng() * src.length)] };
    else if (x < 0.5) msg = { t: 'place', from: g.players[Math.floor(rng() * n)].id };
    else msg = { t: 'flip' };
    M.handle(g, id, msg);
    if (g.notice) g.notice = null;
    assert.equal(total(g), 84, 'Kartenbilanz');
    // Stapel/Strafstapel: Karten in Reihen sind lückenlos und einmalig
    for (const r of g.rows) if (r) assert.ok(r.lo <= 11 && r.hi >= 11 && r.lo >= 1 && r.hi <= 21);
    // Wer nicht handeln kann, darf nicht dran sein
    if (g.phase === 'play') { const p = M.activePlayer(g); assert.ok(p.deck.length > 0 || M.anyFit(g)); }
  }
  return g;
}

test('300 Zufallspartien mit 2-6 Personen enden immer, Kartenbilanz stets 84', () => {
  let blocked = 0; let pen = 0;
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 5);
    const g = randomGame(i + 1, n);
    assert.equal(g.phase, 'over');
    assert.ok(g.result.winners.length >= 1);
    for (const p of g.players) assert.equal(g.result.rest[p.id], M.restCount(g, p));
    if (!g.result.blocked) { const f = g.players.find((p) => p.id === g.result.finisher); assert.equal(f.deck.length + f.pile.length, 0); }
    else blocked++;
    pen += g.players.reduce((s, p) => s + g.penaltyExtra[p.id], 0) + (12 - g.penalty.length);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
  console.log('Zufallspartien: blockiert', blocked, 'Strafkarten/-punkte gesamt', pen);
});
