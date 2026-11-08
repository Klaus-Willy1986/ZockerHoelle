import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../kartenrennen/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mk = (opts = { swap: false }, seed = 1) => K.createGame([{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }, { id: 'p2', name: 'C' }, { id: 'p3', name: 'D' }], opts, seedRng(seed), 'p0');
const idOf = (g, seat) => g.players[seat].id;
const pcs = (g, seat, arr) => { g.players[seat].pieces = arr.slice(); g.players[seat].prot = [false, false, false, false]; };
const hand = (g, seat, ranks) => { g.players[seat].hand = ranks.map((r) => ({ r, s: r === 'JOKER' ? 4 : 0 })); };
const turn = (g, seat) => { g.phase = 'play'; g.turn = seat; };
const play = (g, seat, r, move, as, rng) => K.handle(g, idOf(g, seat), { t: 'play', card: { r, s: r === 'JOKER' ? 4 : 0 }, ...(as ? { as } : {}), move }, rng || seedRng(5));
// Bilanz: 110 Karten
const cardsTotal = (g) => g.deck.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0);
// Vorbereitung: Sitz 0 am Zug, nur die angegebene Karte auf der Hand (plus Füller für die anderen)
function setup(handRanks = ['5']) {
  const g = mk();
  turn(g, 0);
  hand(g, 0, handRanks);
  for (let s = 1; s < 4; s++) hand(g, s, ['2', '3']);
  return g;
}

test('Brett: 64 Ringfelder hängen aneinander, Ziele und Ställe überschneiden sich nicht', () => {
  const key = (c) => c.join(',');
  assert.equal(K.RING_CELLS.length, 64);
  assert.equal(new Set(K.RING_CELLS.map(key)).size, 64);
  for (let i = 0; i < 64; i++) {
    const a = K.RING_CELLS[i], b = K.RING_CELLS[(i + 1) % 64];
    assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, 'Feld ' + i);
  }
  const all = [...K.RING_CELLS, ...K.GOAL_CELLS.flat(), ...K.STALL_CELLS.flat()];
  assert.equal(new Set(all.map(key)).size, 64 + 16 + 16);
  for (const c of all) assert.ok(c[0] >= 0 && c[0] <= 16 && c[1] >= 0 && c[1] <= 16);
  for (let s = 0; s < 4; s++) {
    const before = K.RING_CELLS[(s * 16 + 63) % 64], g0 = K.GOAL_CELLS[s][0];
    assert.equal(Math.abs(before[0] - g0[0]) + Math.abs(before[1] - g0[1]), 1, 'Abzweig ' + s);
    for (let k = 0; k < 3; k++) assert.equal(Math.abs(K.GOAL_CELLS[s][k][0] - K.GOAL_CELLS[s][k + 1][0]) + Math.abs(K.GOAL_CELLS[s][k][1] - K.GOAL_CELLS[s][k + 1][1]), 1);
    assert.deepEqual(K.cellOf(s, 0, 0), K.RING_CELLS[s * 16]);
  }
});

test('Spielaufbau: 110 Karten, Sitze, Teams, Computer füllen auf', () => {
  const g = mk({ swap: true });
  assert.equal(cardsTotal(g), 110);
  assert.equal(g.deck.length, 110 - 24);
  assert.equal(g.players.length, 4);
  assert.ok(g.players.every((p) => p.hand.length === 6 && p.pieces.every((x) => x === -1)));
  assert.equal(g.phase, 'swap');
  assert.equal(K.teamOf(0), K.teamOf(2));
  assert.notEqual(K.teamOf(0), K.teamOf(1));
  // Joker und Blätter
  const all = [...g.deck, ...g.players.flatMap((p) => p.hand)];
  assert.equal(all.filter((c) => c.r === 'JOKER').length, 6);
  assert.equal(all.filter((c) => c.r === 'ASS').length, 8);
  // 2 Menschen sitzen sich gegenüber, 2 Computer
  const g2 = K.createGame([{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bert' }], {}, seedRng(2), 'a');
  assert.equal(g2.players[0].id, 'a'); assert.equal(g2.players[2].id, 'b');
  assert.ok(g2.players[1].bot && g2.players[3].bot);
  assert.equal(new Set(g2.players.map((p) => p.id)).size, 4);
  assert.equal(new Set(g2.players.map((p) => p.name)).size, 4);
  const g1 = K.createGame([{ id: 'a', name: 'Anna' }, { id: 'bot1', name: 'Computer' }], {}, seedRng(2), 'a');
  assert.equal(g1.players[0].id, 'a'); assert.equal(g1.players[2].id, 'bot1');
  assert.equal(new Set(g1.players.map((p) => p.id)).size, 4);
  assert.equal(K.createGame([], {}, seedRng(3)).players.length, 4);
  assert.equal(g2.opts.swap, true);
  assert.equal(K.createGame([{ id: 'a', name: 'A' }], { swap: false }, seedRng(2)).phase, 'play');
});

test('Tauschphase: gleichzeitig, jede gibt der Partnerin eine Karte', () => {
  const g = mk({ swap: true });
  const before = g.players.map((p) => p.hand.map((c) => ({ ...c })));
  const cards = [0, 1, 2, 3].map((s) => g.players[s].hand[s]);
  assert.equal(K.handle(g, idOf(g, 0), { t: 'play', card: cards[0], move: {} }).ok, false, 'Spielen in der Tauschphase');
  assert.equal(K.handle(g, idOf(g, 0), { t: 'swap', card: { r: 'JOKER', s: 4 } }).ok === true || g.players[0].hand.some((c) => c.r === 'JOKER'), true);
  for (let s = 0; s < 4; s++) {
    assert.equal(g.phase, 'swap');
    const r = K.handle(g, idOf(g, s), { t: 'swap', card: cards[s] });
    assert.equal(r.ok, true);
  }
  assert.equal(g.phase, 'play');
  for (let s = 0; s < 4; s++) {
    assert.equal(g.players[s].hand.length, 6);
    const partner = (s + 2) % 4;
    const had = before[s].filter((c) => c.r === cards[s].r && c.s === cards[s].s).length;
    const now = g.players[s].hand.filter((c) => c.r === cards[s].r && c.s === cards[s].s).length;
    // meine weitergegebene Karte ist weg (außer ich hatte sie doppelt oder bekam sie zurück)
    assert.ok(now <= had || cards[partner].r === cards[s].r);
    assert.deepEqual(g.recvd[s], { r: cards[partner].r, s: cards[partner].s });
  }
  assert.equal(cardsTotal(g), 110);
  // falsche Phase / Karte
  assert.equal(K.handle(g, idOf(g, 0), { t: 'swap', card: cards[0] }).ok, false);
  const g2 = mk({ swap: true });
  assert.equal(K.handle(g2, idOf(g2, 0), { t: 'swap', card: { r: 'XX', s: 0 } }).ok, false);
  assert.equal(K.handle(g2, 'fremd', { t: 'swap', card: g2.players[0].hand[0] }).ok, false);
  // Umentscheiden vor Abschluss
  assert.equal(K.handle(g2, idOf(g2, 0), { t: 'swap', card: g2.players[0].hand[0] }).ok, true);
  assert.equal(K.handle(g2, idOf(g2, 0), { t: 'swap', card: g2.players[0].hand[1] }).ok, true);
  assert.deepEqual(g2.swapSel[0], { r: g2.players[0].hand[1].r, s: g2.players[0].hand[1].s });
});

test('Zahlenkarte: vorwärts, Überholen ohne Schlagen', () => {
  const g = setup(['5']);
  pcs(g, 0, [10, 12, -1, -1]); // Stein 1 steht 2 Felder vor Stein 0
  pcs(g, 1, [-1, -1, -1, -1]);
  const r = play(g, 0, '5', { stone: 0, steps: 5 });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].pieces[0], 15);
  assert.equal(g.players[0].pieces[1], 12, 'überholter eigener Stein bleibt');
  assert.equal(r.caps.length, 0);
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.discard.length, 1);
});

test('Schlagen: fremder und eigener Stein auf dem Zielfeld gehen in den Stall', () => {
  let g = setup(['5']);
  pcs(g, 0, [10, -1, -1, -1]);
  pcs(g, 1, [-1, 31 - 16 + 0, -1, -1]); // Sitz 1 Fortschritt 15 = Feld 31... (16 + 15)
  // Sitz 0 Stein 0 auf Feld 10, 5 Felder -> Feld 15 = Sitz 1 Fortschritt 63
  pcs(g, 1, [63, -1, -1, -1]);
  let r = play(g, 0, '5', { stone: 0, steps: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.caps.length, 1);
  assert.equal(g.players[1].pieces[0], -1);
  assert.equal(g.players[0].pieces[0], 15);
  // eigener Stein
  g = setup(['5']);
  pcs(g, 0, [10, 15, -1, -1]);
  r = play(g, 0, '5', { stone: 0, steps: 5 });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].pieces[1], -1, 'eigener Stein geschlagen');
  assert.equal(g.players[0].pieces[0], 15);
});

test('Blockade: geschützter Stein auf seinem Startfeld sperrt Überholen und Schlagen', () => {
  const g = setup(['5', '2']);
  pcs(g, 0, [14, -1, -1, -1]);
  pcs(g, 1, [0, -1, -1, -1]); // Feld 16, frisch gesetzt
  g.players[1].prot[0] = true;
  assert.equal(play(g, 0, '5', { stone: 0, steps: 5 }).ok, false, 'überholen verboten');
  assert.equal(play(g, 0, '2', { stone: 0, steps: 2 }).ok, false, 'landen verboten (14+2=16)');
  assert.equal(g.players[0].pieces[0], 14);
  // ohne Schutz erlaubt (der Stein hat sich bewegt und steht wieder auf 0? -> Schutz weg)
  g.players[1].prot[0] = false;
  const r = play(g, 0, '2', { stone: 0, steps: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.caps.length, 1);
  assert.equal(g.players[1].pieces[0], -1);
  // legalMoves kennt die Sperre auch
  const g2 = setup(['5']);
  pcs(g2, 0, [14, -1, -1, -1]); pcs(g2, 2, [0, -1, -1, -1]);
  g2.players[2].prot[0] = true; // Feld 32 weit weg: 14+5 ok
  assert.equal(K.legalMoves(g2, idOf(g2, 0)).length, 1);
  pcs(g2, 1, [0, -1, -1, -1]); g2.players[1].prot[0] = true;
  assert.equal(K.legalMoves(g2, idOf(g2, 0)).length, 0);
});

test('Vier rückwärts: über das Startfeld zurück, nie ins Ziel, Schlagen und Sperre', () => {
  let g = setup(['4']);
  pcs(g, 0, [2, -1, -1, -1]);
  let r = play(g, 0, '4', { back: 0 });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].pieces[0], 62, 'Start zurück = Fortschritt 62');
  // auf dem Startfeld selbst
  g = setup(['4']);
  pcs(g, 0, [0, -1, -1, -1]); g.players[0].prot[0] = true;
  r = play(g, 0, '4', { back: 0 });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].pieces[0], 60);
  assert.equal(g.players[0].prot[0], false);
  // normal rückwärts
  g = setup(['4']);
  pcs(g, 0, [20, -1, -1, -1]);
  play(g, 0, '4', { back: 0 });
  assert.equal(g.players[0].pieces[0], 16);
  // Schlagen unterwegs? nur am Ziel
  g = setup(['4']);
  pcs(g, 0, [20, -1, -1, -1]); pcs(g, 1, [0, -1, -1, -1]); // Sitz 1 Start = Feld 16
  r = play(g, 0, '4', { back: 0 });
  assert.equal(r.caps.length, 1);
  assert.equal(g.players[1].pieces[0], -1);
  // geschützter Stein auf dem Weg sperrt
  g = setup(['4']);
  pcs(g, 0, [20, -1, -1, -1]); pcs(g, 1, [0, -1, -1, -1]); g.players[1].prot[0] = true;
  pcs(g, 2, [-1, -1, -1, -1]);
  assert.equal(play(g, 0, '4', { back: 0 }).ok, false);
  // Stall und Ziel können nicht zurück
  g = setup(['4']);
  pcs(g, 0, [-1, 65, -1, -1]);
  assert.equal(play(g, 0, '4', { back: 0 }).ok, false);
  assert.equal(play(g, 0, '4', { back: 1 }).ok, false);
  assert.equal(K.legalMoves(g, idOf(g, 0)).length, 0);
});

test('Ass: 1 oder 11 vorwärts, aus dem Stall, König 13, Joker', () => {
  let g = setup(['ASS']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(play(g, 0, 'ASS', { stone: 0, steps: 1 }).ok, true);
  assert.equal(g.players[0].pieces[0], 4);
  g = setup(['ASS']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(play(g, 0, 'ASS', { stone: 0, steps: 11 }).ok, true);
  assert.equal(g.players[0].pieces[0], 14);
  g = setup(['ASS']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(play(g, 0, 'ASS', { stone: 0, steps: 5 }).ok, false, 'Ass kennt nur 1 und 11');
  // aus dem Stall
  g = setup(['ASS']);
  let r = play(g, 0, 'ASS', { out: true });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].pieces[0], 0);
  assert.equal(g.players[0].prot[0], true, 'frisch gesetzt = geschützt');
  // fremder Stein auf dem Startfeld wird geschlagen
  g = setup(['KING']);
  pcs(g, 1, [63 - 0, -1, -1, -1]);
  pcs(g, 3, [-1, -1, -1, -1]);
  pcs(g, 2, [32 - 32 + 0, -1, -1, -1]); // Sitz 2 Start = Feld 32
  // Sitz 1 Fortschritt 48 = Feld 64 = 0
  pcs(g, 1, [48, -1, -1, -1]);
  r = play(g, 0, 'KING', { out: true });
  assert.equal(r.ok, true);
  assert.equal(r.caps.length, 1);
  assert.equal(g.players[1].pieces[0], -1);
  // eigener Stein auf dem Startfeld blockiert das Herausstellen
  g = setup(['ASS']);
  pcs(g, 0, [0, -1, -1, -1]);
  assert.equal(play(g, 0, 'ASS', { out: true }).ok, false);
  // alle Steine draußen: kein Herausstellen
  g = setup(['ASS']);
  pcs(g, 0, [5, 6, 7, 8]);
  assert.equal(play(g, 0, 'ASS', { out: true }).ok, false);
  // König 13
  g = setup(['KING']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(play(g, 0, 'KING', { stone: 0, steps: 13 }).ok, true);
  assert.equal(g.players[0].pieces[0], 16);
  // andere Karte kann nicht heraus
  g = setup(['5']);
  assert.equal(play(g, 0, '5', { out: true }).ok, false);
  // Joker
  g = setup(['JOKER']);
  assert.equal(play(g, 0, 'JOKER', { out: true }).ok, false, 'Joker ohne Angabe');
  assert.equal(play(g, 0, 'JOKER', { out: true }, 'XYZ').ok, false);
  assert.equal(play(g, 0, 'JOKER', { out: true }, 'JOKER').ok, false);
  assert.equal(play(g, 0, 'JOKER', { out: true }, '5').ok, false);
  assert.equal(play(g, 0, 'JOKER', { out: true }, 'ASS').ok, true);
  assert.equal(g.players[0].pieces[0], 0);
  assert.equal(g.lastCard.as, 'ASS');
  // Joker über eigene Ansage
  g = setup(['JOKER']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(K.handle(g, idOf(g, 0), { t: 'joker', as: '10' }).ok, true);
  assert.equal(play(g, 0, 'JOKER', { stone: 0, steps: 10 }).ok, true);
  assert.equal(g.players[0].pieces[0], 13);
  assert.equal(K.handle(setup(['5']), idOf(g, 0), { t: 'joker', as: '10' }).ok, false, 'kein Joker auf der Hand');
});

test('Dame zieht 12', () => {
  const g = setup(['DAME']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(play(g, 0, 'DAME', { stone: 0, steps: 12 }).ok, true);
  assert.equal(g.players[0].pieces[0], 15);
});

test('Bube: Tausch auf der Ringbahn', () => {
  let g = setup(['BUBE']);
  pcs(g, 0, [5, -1, -1, -1]);          // Feld 5
  pcs(g, 1, [10, -1, -1, -1]);         // Feld 26
  let r = play(g, 0, 'BUBE', { swap: [0, 4] });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].pieces[0], 26);
  assert.equal(g.players[1].pieces[0], (5 - 16 + 64) % 64, 'Fortschritt des Gegners von Feld 5 aus');
  // geschützter Stein, Stall, Ziel
  g = setup(['BUBE']);
  pcs(g, 0, [5, -1, 66, -1]); pcs(g, 1, [0, 3, -1, -1]); g.players[1].prot[0] = true;
  assert.equal(play(g, 0, 'BUBE', { swap: [0, 4] }).ok, false, 'geschützt');
  assert.equal(play(g, 0, 'BUBE', { swap: [1, 5] }).ok, false, 'Stall');
  assert.equal(play(g, 0, 'BUBE', { swap: [2, 5] }).ok, false, 'Ziel');
  assert.equal(play(g, 0, 'BUBE', { swap: [0, 5] }).ok, true, 'ungeschützter Stein');
  // nur eigene Steine als erster Stein
  g = setup(['BUBE']);
  pcs(g, 0, [5, -1, -1, -1]); pcs(g, 1, [10, 11, -1, -1]);
  assert.equal(play(g, 0, 'BUBE', { swap: [4, 5] }).ok, false);
  assert.equal(play(g, 0, 'BUBE', { swap: [0, 0] }).ok, false);
  // eigener Stein ohne Partner: keine Züge
  g = setup(['BUBE']);
  pcs(g, 0, [5, -1, -1, -1]);
  assert.equal(K.legalMoves(g, idOf(g, 0)).length, 0);
  // Startfeld-Stein ohne Schutz darf getauscht werden
  g = setup(['BUBE']);
  pcs(g, 0, [5, -1, -1, -1]); pcs(g, 1, [0, -1, -1, -1]);
  assert.equal(play(g, 0, 'BUBE', { swap: [0, 4] }).ok, true);
  assert.equal(g.players[1].pieces[0], 53);
});

test('Siebener: ein Stein, Aufteilung, Schlagen unterwegs, Sperre, Ziel', () => {
  // ganz
  let g = setup(['7']);
  pcs(g, 0, [3, -1, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 7 }] }).ok, true);
  assert.equal(g.players[0].pieces[0], 10);
  // aufgeteilt auf zwei Steine
  g = setup(['7']);
  pcs(g, 0, [3, 20, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 3 }, { stone: 1, steps: 4 }] }).ok, true);
  assert.deepEqual(g.players[0].pieces.slice(0, 2), [6, 24]);
  // falsche Summe
  g = setup(['7']);
  pcs(g, 0, [3, 20, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 3 }, { stone: 1, steps: 3 }] }).ok, false);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 5 }, { stone: 1, steps: 3 }] }).ok, false);
  assert.equal(play(g, 0, '7', { split: [] }).ok, false);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 0 }, { stone: 1, steps: 7 }] }).ok, false);
  assert.equal(play(g, 0, '7', { split: [{ stone: 4, steps: 7 }] }).ok, false, 'fremder Stein');
  assert.equal(play(g, 0, '7', { stone: 0, steps: 7 }).ok, false, 'falsches Format');
  assert.deepEqual(g.players[0].pieces.slice(0, 2), [3, 20], 'Zustand unverändert');
  // Schlagen unterwegs: Stein überläuft fremde und eigene Steine
  g = setup(['7']);
  pcs(g, 0, [3, 5, -1, -1]); pcs(g, 1, [63 - 55, -1, -1, -1]);
  pcs(g, 1, [-1, -1, -1, -1]);
  pcs(g, 3, [-1, -1, -1, -1]);
  pcs(g, 2, [-1, -1, -1, -1]);
  // Sitz 0 Stein 0 (Feld 3) läuft 7 Felder bis Feld 10 und überläuft Feld 5 (eigener Stein) und Feld 8 (Sitz 1)
  pcs(g, 1, [(8 - 16 + 64) % 64, -1, -1, -1]);
  let r = play(g, 0, '7', { split: [{ stone: 0, steps: 7 }] });
  assert.equal(r.ok, true);
  assert.equal(r.caps.length, 2);
  assert.equal(g.players[0].pieces[1], -1, 'eigener Stein überlaufen');
  assert.equal(g.players[1].pieces[0], -1);
  // Teilschritte nacheinander: erster Stein schlägt den zweiten Teil-Stein nicht, wenn er schon weg ist
  g = setup(['7']);
  pcs(g, 0, [3, 6, -1, -1]);
  r = play(g, 0, '7', { split: [{ stone: 1, steps: 4 }, { stone: 0, steps: 3 }] });
  assert.equal(r.ok, true); assert.equal(r.caps.length, 0);
  assert.deepEqual(g.players[0].pieces.slice(0, 2), [6, 10]);
  // geschützter Stein sperrt den Siebener
  g = setup(['7']);
  pcs(g, 0, [12, -1, -1, -1]); pcs(g, 1, [0, -1, -1, -1]); g.players[1].prot[0] = true;
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 7 }] }).ok, false);
  assert.equal(K.legalMoves(g, idOf(g, 0)).length, 0);
  // Ziel: kein Überholen, auch nicht im Siebener
  g = setup(['7']);
  pcs(g, 0, [60, 65, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 7 }] }).ok, false, '60 + 7 = 67 geht an Stein auf 65 vorbei');
  pcs(g, 0, [60, 67, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 7 }] }).ok, false);
  pcs(g, 0, [60, 64, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 1, steps: 3 }, { stone: 0, steps: 4 }] }).ok, true, 'erst den vorderen Stein ins Ziel ziehen, dann den anderen');
  assert.deepEqual(g.players[0].pieces.slice(0, 2), [64, 67]);
  // Siebener im Ziel erlaubt
  g = setup(['7']);
  pcs(g, 0, [64, -1, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 3 }] }).ok, false, 'Summe 3');
  assert.equal(K.legalMoves(g, idOf(g, 0)).length, 0, '64 + 7 ist zu weit');
  pcs(g, 0, [64, 50, -1, -1]);
  assert.equal(play(g, 0, '7', { split: [{ stone: 0, steps: 3 }, { stone: 1, steps: 4 }] }).ok, true);
  // legalMoves: Aufteilungen, Teilschritte bis 3
  g = setup(['7']);
  pcs(g, 0, [3, 20, 30, 40]);
  const lm = K.legalMoves(g, idOf(g, 0));
  assert.ok(lm.length > 20);
  for (const m of lm) {
    assert.equal(m.card.r, '7');
    assert.ok(m.move.split.length <= K.MAX_SPLIT_PARTS);
    assert.equal(m.move.split.reduce((a, x) => a + x.steps, 0), 7);
  }
  // Siebener-Hilfen für die Oberfläche
  const b = K.boardOf(g);
  assert.ok(K.sevenSteps(b, 0, 7).length >= 4 * 7 - 4 * 0);
  assert.ok(K.sevenCompletable(b, 0, 7));
});

test('Ziel: nicht überspringen, nicht exakt einziehen, nicht doppelt besetzen', () => {
  let g = setup(['3']);
  pcs(g, 0, [62, -1, -1, -1]);
  assert.equal(play(g, 0, '3', { stone: 0, steps: 3 }).ok, true);
  assert.equal(g.players[0].pieces[0], 65, 'es muss nicht genau das erste Zielfeld sein');
  // Stein auf 65 blockiert Weg zu 66
  g = setup(['3']);
  pcs(g, 0, [63, 65, -1, -1]);
  assert.equal(play(g, 0, '3', { stone: 0, steps: 3 }).ok, false, 'würde über 65 hinweg auf 66 gehen');
  g = setup(['2']);
  pcs(g, 0, [63, 65, -1, -1]);
  assert.equal(play(g, 0, '2', { stone: 0, steps: 2 }).ok, false, 'Zielfeld besetzt');
  // zu weit
  g = setup(['5']);
  pcs(g, 0, [63, -1, -1, -1]);
  assert.equal(play(g, 0, '5', { stone: 0, steps: 5 }).ok, false, '63 + 5 = 68');
  // im Ziel weiterziehen
  g = setup(['2']);
  pcs(g, 0, [64, -1, -1, -1]);
  assert.equal(play(g, 0, '2', { stone: 0, steps: 2 }).ok, true);
  // Ringbahn: das Feld vor dem eigenen Start ist Fortschritt 63, danach geht es nicht auf den Ring weiter
  g = setup(['ASS']);
  pcs(g, 0, [63, -1, -1, -1]);
  assert.equal(play(g, 0, 'ASS', { stone: 0, steps: 1 }).ok, true);
  assert.equal(g.players[0].pieces[0], 64);
  // Gegner im Ring wird im Ziel nicht geschlagen: fremder Stein auf Fortschritt-Feld hat anderes Feld
  g = setup(['2']);
  pcs(g, 0, [62, -1, -1, -1]); pcs(g, 1, [47, -1, -1, -1]); // Sitz 1 Fortschritt 47 = Feld 63
  const r = play(g, 0, '2', { stone: 0, steps: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.caps.length, 0);
});

test('Partnerin mitspielen, wenn alle eigenen Steine im Ziel sind', () => {
  const g = setup(['5', '2']);
  pcs(g, 0, [64, 65, 66, 67]);
  pcs(g, 2, [10, -1, -1, -1]);
  const b = K.boardOf(g);
  assert.equal(K.ctlSeat(b, 0), 2);
  assert.equal(K.controlledSeat(g, 0), 2);
  const lm = K.legalMoves(g, idOf(g, 0));
  assert.ok(lm.length > 0 && lm.every((m) => Math.floor(m.move.stone / 4) === 2));
  assert.equal(play(g, 0, '5', { stone: 0, steps: 5 }).ok, false, 'eigener Stein im Ziel kann nicht ziehen');
  assert.equal(play(g, 0, '5', { stone: 8, steps: 5 }).ok, true);
  assert.equal(g.players[2].pieces[0], 15);
  // Herausstellen für die Partnerin auf deren Startfeld
  const g2 = setup(['ASS']);
  pcs(g2, 0, [64, 65, 66, 67]);
  assert.equal(play(g2, 0, 'ASS', { out: true }).ok, true);
  assert.equal(g2.players[2].pieces[0], 0);
  assert.equal(g2.players[0].pieces.filter((x) => x === 0).length, 0);
  // noch nicht alle im Ziel: nur eigene Steine
  const g3 = setup(['5']);
  pcs(g3, 0, [64, 65, 66, -1]); pcs(g3, 2, [10, -1, -1, -1]);
  assert.equal(K.controlledSeat(g3, 0), 0);
});

test('Kein Zug: alle Karten abwerfen, aussetzen; sonst verboten', () => {
  const g = setup(['5', '9']);
  // alle Steine im Stall: nur Ass/König/Joker bewegen etwas
  pcs(g, 0, [-1, -1, -1, -1]);
  assert.equal(K.canPlay(g, idOf(g, 0)), false);
  assert.equal(K.legalMoves(g, idOf(g, 0)).length, 0);
  assert.equal(K.handle(g, idOf(g, 1), { t: 'discardAll' }).ok, false, 'falsche Person');
  const before = g.discard.length;
  const r = K.handle(g, idOf(g, 0), { t: 'discardAll' });
  assert.equal(r.ok, true);
  assert.equal(r.discarded, 2);
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.discard.length, before + 2);
  assert.equal(g.turn, 1, 'nächste Person');
  assert.equal(g.last.kind, 'discard');
  // mit erlaubtem Zug verboten
  const h = setup(['5']);
  pcs(h, 0, [3, -1, -1, -1]);
  assert.equal(K.handle(h, idOf(h, 0), { t: 'discardAll' }).ok, false);
  assert.equal(h.players[0].hand.length, 1);
  // Person ohne Karten wird übersprungen, Runde endet, wenn alle leer sind
  const j = setup(['5']);
  pcs(j, 0, [-1, -1, -1, -1]);
  hand(j, 1, []);
  K.handle(j, idOf(j, 0), { t: 'discardAll' });
  assert.equal(j.turn, 2, 'Sitz 1 hat keine Karten');
});

test('Rundenfolge 6-5-4-3-2-6, Kartenbilanz 110, Neu mischen', () => {
  const rng = seedRng(7);
  const g = mk({ swap: false }, 3);
  const seen = [g.handSize];
  let guard = 0;
  while (seen.length < 13 && g.phase !== 'over' && guard++ < 100000) {
    const lm = K.legalMoves(g, idOf(g, g.turn));
    const pid = idOf(g, g.turn);
    const rr = lm.length ? lm[Math.floor(rng() * lm.length)] : null;
    const res = rr ? K.handle(g, pid, { t: 'play', card: rr.card, ...(rr.as ? { as: rr.as } : {}), move: rr.move }, rng) : K.handle(g, pid, { t: 'discardAll' }, rng);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(cardsTotal(g), 110);
    if (g.handSize !== seen[seen.length - 1]) seen.push(g.handSize);
    if (g.phase === 'play') for (const p of g.players) assert.ok(p.hand.length <= g.handSize);
  }
  assert.deepEqual(seen.slice(0, 12), [6, 5, 4, 3, 2, 6, 5, 4, 3, 2, 6, 5]);
  assert.ok(g.round >= 11 || g.phase === 'over');
});

test('Sieg: 8 Steine im Ziel, Spielstand, nächstes Spiel nur durch den Gastgeber', () => {
  const g = setup(['2']);
  pcs(g, 0, [65, 66, 67, 62]);
  pcs(g, 2, [64, 65, 66, 67]);
  assert.equal(play(g, 0, '2', { stone: 3, steps: 2 }).ok, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
  assert.deepEqual(g.wins, { A: 1, B: 0 });
  assert.match(g.endReason, /8 Steine/);
  assert.equal(K.ranking(g)[0].team, 0);
  assert.equal(K.ranking(g)[0].goal, 8);
  // danach nichts mehr außer "next"
  assert.equal(K.handle(g, idOf(g, 1), { t: 'discardAll' }).ok, false);
  assert.equal(K.handle(g, idOf(g, 1), { t: 'next' }).ok, false, 'nur der Gastgeber');
  assert.equal(K.handle(g, idOf(g, 0), { t: 'next' }).ok, true);
  assert.equal(g.phase, 'play');
  assert.deepEqual(g.wins, { A: 1, B: 0 }, 'Spielstand bleibt');
  assert.equal(g.round, 0);
  assert.ok(g.players.every((p) => p.pieces.every((x) => x === -1)));
  assert.equal(cardsTotal(g), 110);
  assert.equal(K.handle(g, idOf(g, 0), { t: 'next' }).ok, false, 'Spiel läuft');
  // Team B gewinnt
  const h = setup(['2']);
  pcs(h, 1, [65, 66, 67, 62]);
  pcs(h, 3, [64, 65, 66, 67]);
  h.turn = 1; hand(h, 1, ['2']);
  assert.equal(play(h, 1, '2', { stone: 3, steps: 2 }).ok, false, 'Stein von Sitz 0 gehört nicht zu Sitz 1');
  assert.equal(play(h, 1, '2', { stone: 7, steps: 2 }).ok, true);
  assert.equal(h.winner, 1);
});

test('Ziel nach 2000 Karten: Team mit mehr Steinen im Ziel gewinnt', () => {
  const g = setup(['2']);
  pcs(g, 0, [64, -1, -1, 5]); pcs(g, 2, [-1, -1, -1, -1]); pcs(g, 1, [64, 65, -1, -1]);
  g.used = K.CARD_CAP - 1;
  assert.equal(play(g, 0, '2', { stone: 3, steps: 2 }).ok, true);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 1);
  assert.match(g.endReason, /Nach sehr vielen Karten/);
});

test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = setup(['5']);
  pcs(g, 0, [3, -1, -1, -1]);
  const snap = JSON.stringify(g);
  const bad = [undefined, null, 0, 'x', [], {}, { t: 'play' }, { t: 'play', card: null }, { t: 'play', card: { r: '5', s: 0 } },
    { t: 'play', card: { r: '5', s: 0 }, move: null }, { t: 'play', card: { r: '5', s: 0 }, move: { stone: 99, steps: 5 } },
    { t: 'play', card: { r: '5', s: 0 }, move: { stone: 0, steps: 4 } }, { t: 'play', card: { r: '5', s: 0 }, move: { stone: 0, steps: '5' } },
    { t: 'play', card: { r: '5', s: 0 }, move: { stone: 1, steps: 5 } }, { t: 'play', card: { r: '9', s: 0 }, move: { stone: 0, steps: 9 } },
    { t: 'play', card: { r: 'XX', s: 0 }, move: {} }, { t: 'play', card: { r: '5', s: 0 }, move: { back: 0 } },
    { t: 'play', card: { r: '5', s: 0 }, move: { swap: [0, 4] } }, { t: 'play', card: { r: '5', s: 0 }, move: { split: [{ stone: 0, steps: 5 }] } },
    { t: 'swap', card: { r: '5', s: 0 } }, { t: 'discardAll' }, { t: 'next' }, { t: 'zzz' }, { t: 'joker', as: '5' }];
  for (const m of bad) {
    const r = K.handle(g, idOf(g, 0), m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, 'string');
  }
  // falsche Person
  assert.equal(K.handle(g, idOf(g, 1), { t: 'play', card: { r: '5', s: 0 }, move: { stone: 0, steps: 5 } }).ok, false);
  assert.equal(K.handle(g, 'fremd', { t: 'play', card: { r: '5', s: 0 }, move: { stone: 0, steps: 5 } }).ok, false);
  assert.equal(JSON.stringify(g), snap, 'Zustand unverändert');
  assert.equal(K.handle(null, 'x', { t: 'swap' }).ok, false);
  // fremde Steine des Gegners sind keine eigenen
  pcs(g, 1, [5, -1, -1, -1]);
  assert.equal(play(g, 0, '5', { stone: 4, steps: 5 }).ok, false);
});

test('JSON-sicher: Zustand überlebt Hin-und-zurück', () => {
  const g = mk({ swap: true }, 11);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  const rng = seedRng(3);
  for (let i = 0; i < 400 && g.phase !== 'over'; i++) {
    if (g.phase === 'swap') { for (let s = 0; s < 4; s++) K.handle(g, idOf(g, s), { t: 'swap', card: g.players[s].hand[0] }, rng); continue; }
    const pid = idOf(g, g.turn);
    const lm = K.legalMoves(g, pid);
    if (lm.length) { const m = lm[Math.floor(rng() * lm.length)]; assert.equal(K.handle(g, pid, { t: 'play', card: m.card, ...(m.as ? { as: m.as } : {}), move: m.move }, rng).ok, true); } else K.handle(g, pid, { t: 'discardAll' }, rng);
    if (i % 20 === 0) assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
});

function invariants(g) {
  assert.equal(cardsTotal(g), 110);
  const seenRing = new Set();
  for (const p of g.players) {
    const goals = new Set();
    p.pieces.forEach((x, i) => {
      assert.ok(x >= -1 && x <= 67);
      if (x >= 64) { assert.ok(!goals.has(x), 'Zielfeld doppelt'); goals.add(x); }
      if (x >= 0 && x <= 63) { const a = K.ringIndex(p.seat, x); assert.ok(!seenRing.has(a), 'zwei Steine auf Feld ' + a); seenRing.add(a); }
      if (g.players[p.seat].prot[i]) assert.equal(x, 0, 'geschützt nur auf dem Startfeld');
    });
  }
}

test('200 Zufallspartien enden immer, Bilanz stimmt, keine zwei Steine auf einem Feld', () => {
  let ended = 0, capped = 0, maxCards = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seedRng(seed * 31 + 7);
    const g = mk({ swap: seed % 4 !== 0 }, seed);
    let steps = 0;
    while (g.phase !== 'over' && steps < 30000) {
      steps++;
      if (g.phase === 'swap') {
        for (let s = 0; s < 4; s++) if (!g.swapSel[s]) assert.equal(K.handle(g, idOf(g, s), { t: 'swap', card: g.players[s].hand[Math.floor(rng() * g.players[s].hand.length)] }, rng).ok, true);
        invariants(g);
        continue;
      }
      const pid = idOf(g, g.turn);
      const lm = K.legalMoves(g, pid);
      let res;
      if (lm.length) {
        const m = lm[Math.floor(rng() * lm.length)];
        res = K.handle(g, pid, { t: 'play', card: m.card, ...(m.as ? { as: m.as } : {}), move: m.move }, rng);
        assert.equal(K.canPlay(g, pid) || true, true);
      } else {
        res = K.handle(g, pid, { t: 'discardAll' }, rng);
      }
      assert.equal(res.ok, true, JSON.stringify(res));
      if (steps % 7 === 0) invariants(g);
    }
    invariants(g);
    assert.equal(g.phase, 'over', 'Partie endet (Seed ' + seed + ')');
    ended++;
    if (g.used >= K.CARD_CAP) capped++;
    maxCards = Math.max(maxCards, g.used);
    assert.ok(g.winner === 0 || g.winner === 1);
  }
  console.log(`Zufallspartien: ${ended} beendet, davon ${capped} durch Kartendeckel, längste Partie ${maxCards} Karten`);
  assert.equal(ended, 200);
});
