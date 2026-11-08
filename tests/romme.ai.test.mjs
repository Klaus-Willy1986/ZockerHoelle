import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../romme/engine.js';
import { chooseAction } from '../romme/ai.js';

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
const C = (s, r, k = 0) => k * 52 + s * 13 + r - 1;
const J = [104, 105, 106, 107, 108, 109];
const R = (s, from, to, k = 0) => Array.from({ length: to - from + 1 }, (_, i) => C(s, from + i, k));

// Eine Runde mit Computern; kinds[i] = 0|1; Rückgabe der Endlage
function playRound(kinds, seed, stats, opts = {}) {
  const rng = mulberry(seed);
  const s = E.createGame(kinds.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), opts, rng);
  let steps = 0;
  while (s.phase === 'play') {
    assert.ok(steps++ < 4000, 'Endlosspiel');
    const i = s.active;
    const t0 = performance.now();
    const msg = chooseAction(s, 'p' + i, kinds[i], rng);
    const dt = performance.now() - t0;
    stats.calls++; stats.total += dt; stats.max = Math.max(stats.max, dt);
    assert.ok(msg, 'Computer lieferte keine Aktion');
    if (msg.t === 'meld') { const c = E.checkTurn(s, 'p' + i, msg.table); assert.ok(c.ok, c.error); if (!s.players[i].melded) assert.ok(c.newValue >= 40); stats.melds++; if (s.table.length && !s.players[i].melded === false) stats.after++; }
    const r = E.handle(s, 'p' + i, msg, rng);
    assert.ok(r.ok, 'Computerzug abgelehnt: ' + JSON.stringify(msg) + ' ' + r.error);
    assert.equal(E.cardBalance(s).summe, 110);
  }
  if (s.result.reason === 'blockade') stats.caps++;
  stats.rounds++; stats.plies += s.plies;
  return s;
}
const newStats = () => ({ calls: 0, total: 0, max: 0, melds: 0, after: 0, caps: 0, rounds: 0, plies: 0 });

test('Mittel schlägt Leicht in >= 80 % der Runden (200 Runden, 2 Personen, Startwechsel); Rechenzeit < 150 ms', () => {
  const stats = newStats();
  let wins = 0, losses = 0;
  for (let g = 0; g < 200; g++) {
    const flip = g % 2 === 1; // Sitzplätze tauschen (Startperson ist zusätzlich zufällig)
    const s = playRound(flip ? [0, 1] : [1, 0], 500 + g, stats);
    const mid = flip ? 'p1' : 'p0';
    if (s.result.deltas[mid] > 0) wins++; else losses++;
  }
  console.log(`Mittel vs Leicht: ${wins}/200 = ${(wins / 2).toFixed(1)} % positiv (Verlust ${losses}); Deckel ${stats.caps}; Ø ${(stats.plies / 200).toFixed(1)} Züge; Zeit je Entscheidung Ø ${(stats.total / stats.calls).toFixed(2)} ms, Spitze ${stats.max.toFixed(1)} ms`);
  assert.ok(wins >= 160, `Mittel nur ${wins}/200`);
  assert.ok(stats.max < 150, 'Spitze ' + stats.max);
  assert.ok(stats.melds > 200);
});

test('Gleiche Stufe gegeneinander und 3/4 Personen: Runden enden, Züge gültig, Bilanz stimmt, Zeit < 150 ms', () => {
  const stats = newStats();
  let capsWithMedium = 0, capsEasyOnly = 0;
  for (let g = 0; g < 60; g++) {
    const kinds = [[1, 1], [0, 0], [1, 0, 1], [0, 1, 0, 1], [1, 1, 1, 0]][g % 5];
    const before = stats.caps;
    playRound(kinds, 9000 + g, stats, { swap: g % 3 !== 0 });
    if (stats.caps > before) { if (kinds.includes(1)) capsWithMedium++; else capsEasyOnly++; }
  }
  console.log(`Gemischte Runden: ${stats.rounds}, Zugdeckel nur bei reinen Leicht-Runden ${capsEasyOnly}, mit Mittel ${capsWithMedium}, Zeit Spitze ${stats.max.toFixed(1)} ms`);
  assert.ok(stats.max < 150);
  assert.equal(capsWithMedium, 0, 'Runden mit Mittel enden ohne Zugdeckel');
});

test('Computer schummelt nicht: Stapelreihenfolge und fremde Hände ändern die Entscheidung nicht', () => {
  let checked = 0;
  for (let g = 0; g < 40; g++) {
    const rng = mulberry(300 + g);
    const kinds = [1, 0, 1][g % 3] === 1 ? [1, 0] : [0, 1];
    const s = E.createGame([{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }, { id: 'p2', name: 'C' }].slice(0, 2 + (g % 2)), {}, rng);
    for (let k = 0; k < 120 && s.phase === 'play'; k++) {
      const me = E.activePlayer(s);
      const level = (g + k) % 2;
      const a = chooseAction(s, me.id, level, mulberry(k + 5));
      // verdeckte Information verändern: Stapel mischen, Hände der anderen vertauschen/ersetzen (Kartenanzahl bleibt)
      const t = JSON.parse(JSON.stringify(s));
      const r2 = mulberry(g * 100 + k);
      for (let i = t.pile.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [t.pile[i], t.pile[j]] = [t.pile[j], t.pile[i]]; }
      const others = t.players.filter((p) => p.id !== me.id);
      const pool = [].concat(...others.map((p) => p.hand), t.pile);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      let at = 0;
      for (const p of others) { p.hand = pool.slice(at, at + p.hand.length); at += p.hand.length; }
      t.pile = pool.slice(at);
      const b = chooseAction(t, me.id, level, mulberry(k + 5));
      assert.deepEqual(b, a, `Stufe ${level}: Entscheidung hängt von verdeckten Karten ab`);
      checked++;
      assert.ok(E.handle(s, me.id, a, rng).ok);
    }
  }
  assert.ok(checked > 2000);
});

test('Nicht am Zug / Runde vorbei: null', () => {
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry(1));
  const other = s.players[1 - s.active].id;
  assert.equal(chooseAction(s, other, 1, mulberry(1)), null);
  assert.equal(chooseAction(s, 'zz', 1, mulberry(1)), null);
  assert.equal(chooseAction(null, 'a', 1), null);
  s.phase = 'over';
  assert.equal(chooseAction(s, s.players[s.active].id, 1, mulberry(1)), null);
});

// ---------- gezielte Fähigkeiten ----------
function mkState(hand, table, melded = true, discardTop = null, turn = 'play', opts = {}) {
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], opts, mulberry(1));
  const used = new Set([].concat(hand, ...table));
  s.players[0].hand = hand.slice(); s.players[0].melded = melded;
  s.players[1].melded = true;
  const rest = Array.from({ length: 110 }, (_, i) => i).filter((i) => !used.has(i) && i !== discardTop);
  s.players[1].hand = rest.splice(0, 13);
  s.table = table.map((x) => x.slice());
  s.discard = [discardTop === null ? rest.shift() : discardTop];
  s.pile = rest;
  s.active = 0; s.turn = turn; s.takenFromDiscard = null;
  return s;
}
const act = (s, level) => chooseAction(s, 'a', level, () => 0.99);

test('Eröffnung: erst ab 40 Punkten (Leicht und Mittel), sonst Ablegen', () => {
  for (const level of [0, 1]) {
    // ♣ 3-4-5 = 12 -> nicht eröffnen
    let s = mkState([...R(0, 3, 5), C(1, 1), C(2, 9), C(3, 12)], [], false);
    const a = act(s, level);
    assert.equal(a.t, 'discard', 'Stufe ' + level);
    // 39: Satz 13er (30) + Folge 2-3-4 (9) -> Ablegen
    s = mkState([C(0, 13), C(1, 13), C(2, 13), C(3, 2), C(3, 3), C(3, 4), C(0, 7)], [], false);
    assert.equal(act(s, level).t, 'discard', 'Stufe ' + level + ' 39');
    // 42: -> auslegen
    s = mkState([C(0, 13), C(1, 13), C(2, 13), C(3, 3), C(3, 4), C(3, 5), C(0, 7)], [], false);
    const m = act(s, level);
    assert.equal(m.t, 'meld', 'Stufe ' + level + ' 42');
    assert.ok(E.checkTurn(s, 'a', m.table).newValue >= 40);
  }
  // 40 genau, zwei Sätze, mit Mittel
  const s = mkState([C(1, 10), C(1, 11), C(1, 12), C(1, 13), C(0, 3)], [], false);
  assert.equal(act(s, 1).t, 'meld');
});

test('Leicht: legt nie an, nimmt Ablage nur wenn sie sofort einen Satz bildet', () => {
  // anlegen möglich (♣ 7 an ♣ 3-6), Leicht tut es nicht (eröffnet hat sie)
  let s = mkState([C(0, 7), C(3, 9), C(2, 1)], [R(0, 3, 6)]);
  assert.equal(act(s, 0).t, 'discard');
  assert.equal(act(s, 1).t, 'meld');
  // Ablage: ♥ 9 ergibt mit ♠ 9, ♦ 9 sofort einen Satz
  s = mkState([C(1, 9), C(3, 9), C(0, 2), C(2, 5)], [], true, C(2, 9), 'draw');
  assert.deepEqual(act(s, 0), { t: 'draw', from: 'discard' });
  // Ablage passt nicht: Stapel
  s = mkState([C(1, 9), C(3, 9), C(0, 2), C(2, 5)], [], true, C(0, 13), 'draw');
  assert.deepEqual(act(s, 0), { t: 'draw', from: 'pile' });
  // Ablage bildet nur ein Paar: Stapel
  s = mkState([C(1, 9), C(0, 2), C(2, 5)], [], true, C(2, 9), 'draw');
  assert.deepEqual(act(s, 0), { t: 'draw', from: 'pile' });
  // Leicht wirft die höchste Einzelkarte ab
  s = mkState([C(0, 2), C(1, 3), C(2, 9), C(3, 12), C(0, 6)], [], false);
  const d = act(s, 0);
  assert.equal(d.t, 'discard'); assert.equal(d.card, C(3, 12));
});

test('Mittel: Anlegen an Folgen und Sätze (auch fremde), Joker verbauen, Ablage nehmen wenn sie hilft', () => {
  // Anlegen an Folgenende und 4. Farbe
  let s = mkState([C(0, 7), C(3, 9), C(2, 1)], [R(0, 3, 6), [C(0, 9), C(1, 9), C(2, 9)]]);
  let m = act(s, 1);
  assert.equal(m.t, 'meld');
  assert.deepEqual(E.checkTurn(s, 'a', m.table).played.sort((x, y) => x - y), [C(0, 7), C(3, 9)].sort((x, y) => x - y));
  // Anlegen nach unten (♣ 2 an ♣ 3-6) und Ass oben (Q-K + A)
  s = mkState([C(0, 2), C(3, 1), C(2, 8)], [R(0, 3, 6), [C(3, 11), C(3, 12), C(3, 13)]]);
  m = act(s, 1);
  assert.equal(m.t, 'meld');
  assert.equal(E.checkTurn(s, 'a', m.table).played.length, 2);
  // Ablage nehmen: ♥ 9 + ♠ 9 + ♦ 9 ergeben einen Satz
  s = mkState([C(1, 9), C(3, 9), C(0, 2), C(2, 5), C(3, 12)], [], true, C(2, 9), 'draw');
  assert.deepEqual(act(s, 1), { t: 'draw', from: 'discard' });
  // Ablage hilft nicht: Stapel
  s = mkState([C(1, 9), C(3, 3), C(0, 2), C(2, 5), C(3, 12)], [], true, C(0, 13), 'draw');
  assert.deepEqual(act(s, 1), { t: 'draw', from: 'pile' });
  // Ablage passt an den Tisch (nach der Eröffnung)
  s = mkState([C(1, 9), C(3, 3), C(0, 2), C(2, 5), C(3, 12)], [R(2, 6, 9)], true, C(2, 10), 'draw');
  assert.deepEqual(act(s, 1), { t: 'draw', from: 'discard' });
  // Joker auf dem Tisch austauschen und verbauen: Tisch ♣ 5, Joker, ♣ 7; Hand ♣ 6, ♥ 9, ♦ 9
  s = mkState([C(0, 6), C(2, 9), C(3, 9), C(3, 13)], [[C(0, 5), J[0], C(0, 7)]]);
  m = act(s, 1);
  assert.equal(m.t, 'meld');
  const chk = E.checkTurn(s, 'a', m.table);
  assert.ok(chk.ok); assert.ok(chk.played.includes(C(0, 6)));
  assert.ok(m.table.some((st) => st.includes(J[0]) && st.includes(C(2, 9))), 'Joker im neuen Satz');
  // Ohne erlaubten Tausch: kein Tausch
  s = mkState([C(0, 6), C(2, 9), C(3, 9), C(3, 13)], [[C(0, 5), J[0], C(0, 7)]], true, null, 'play', { swap: false });
  m = act(s, 1);
  if (m.t === 'meld') assert.ok(m.table.some((st) => st.includes(J[0]) && st.includes(C(0, 5))));
  // Joker aus der Hand: auslegen, wenn Sätze damit möglich
  s = mkState([C(0, 5), C(0, 6), J[1], C(3, 13), C(2, 2)], []);
  m = act(s, 1);
  assert.equal(m.t, 'meld');
});

test('Mittel wirft Karten mit geringem Nutzen ab und behält Nachbarn, Paare und Joker', () => {
  // ♣ 5,6 (Nachbarn), ♥ 5 (Paar mit ♣ 5), ♠ 13 allein, Joker: abwerfen ♠ 13
  const s = mkState([C(0, 5), C(0, 6), C(2, 5), C(1, 13), J[0]], [], false);
  const d = act(s, 1);
  assert.equal(d.t, 'discard'); assert.equal(d.card, C(1, 13));
  // Joker wird nie abgeworfen, wenn andere Karten da sind
  const s2 = mkState([J[0], C(0, 2), C(1, 9)], [], false);
  assert.notEqual(act(s2, 1).card, J[0]);
  assert.notEqual(act(s2, 0).card, J[0]);
  // die eben von der Ablage genommene Karte wird nicht abgelegt
  const s3 = mkState([C(1, 13), C(0, 2), C(2, 8)], [], false);
  s3.takenFromDiscard = C(1, 13);
  for (const level of [0, 1]) assert.notEqual(act(s3, level).card, C(1, 13));
});

test('Computer gewinnt, wenn er alles auslegen kann (Rommé)', () => {
  const s = mkState([...R(1, 5, 8), C(0, 9), C(1, 9), C(2, 9)], [], false);
  const m = act(s, 1);
  assert.equal(m.t, 'meld');
  const r = E.handle(s, 'a', m, mulberry(1));
  assert.ok(r.ok); assert.equal(s.phase, 'over'); assert.ok(s.result.double);
});
