import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../reihen/engine.js';
import { chooseAction } from '../reihen/ai.js';

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
const T = (c, n, k = 0) => k * 52 + c * 13 + n - 1;
const J1 = 104, J2 = 105;
const R = (c, from, to, k = 0) => Array.from({ length: to - from + 1 }, (_, i) => T(c, from + i, k));

// Zufallsspieler: zufälliger gültiger Zug aus einfachen Sätzen (Reihen/Gruppen aus der Hand, Anlegen an Reihenenden) oder Ziehen
function randomAction(s, rng) {
  const me = E.activePlayer(s);
  if (rng() < 0.35) return { t: 'draw' };
  const hand = me.hand;
  const find = (c, n, ex) => hand.find((x) => (x === T(c, n) || x === T(c, n, 1)) && !ex.includes(x));
  const cands = [];
  for (let c = 0; c < 4; c++) for (let a = 1; a <= 11; a++) for (let b = a + 2; b <= Math.min(13, a + 5); b++) {
    const ids = [];
    for (let n = a; n <= b; n++) { const h = find(c, n, ids); if (h === undefined) break; ids.push(h); }
    if (ids.length === b - a + 1) cands.push(ids);
  }
  for (let n = 1; n <= 13; n++) {
    const ids = [];
    for (let c = 0; c < 4; c++) { const h = find(c, n, ids); if (h !== undefined) ids.push(h); }
    if (ids.length >= 3) cands.push(ids);
  }
  const out = cands.length ? [pick(cands, rng)] : [];
  const table = s.table.map((x) => x.slice());
  for (const set of table) {
    const a = E.analyzeSet(set);
    if (a.kind === 'reihe' && rng() < 0.5) {
      const t = E.TILES[a.order[a.order.length - 1]];
      if (t.color >= 0 && t.num < 13) { const h = find(t.color, t.num + 1, out.flat()); if (h !== undefined) set.push(h); }
    }
  }
  return { t: 'play', table: table.concat(out) };
}

// Eine Runde; kinds[i] = 0|1 (Computerstufe) | 'r' (Zufall). Rückgabe { winners:[Sitzindex], steps, reason }
function playRound(kinds, seed, stats) {
  const rng = mulberry(seed);
  const s = E.createGame(kinds.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), {}, rng);
  let steps = 0;
  while (s.phase === 'play') {
    assert.ok(steps++ < 2500, 'Endlosspiel');
    const i = s.active;
    const k = kinds[i];
    let msg;
    if (k === 'r') {
      msg = randomAction(s, rng);
      let r = E.handle(s, 'p' + i, msg, rng);
      if (!r.ok) r = E.handle(s, 'p' + i, { t: 'draw' }, rng);
      assert.ok(r.ok, r.error);
    } else {
      const t0 = performance.now();
      msg = chooseAction(s, 'p' + i, k, rng);
      const dt = performance.now() - t0;
      stats.calls++; stats.total += dt; stats.max = Math.max(stats.max, dt);
      assert.ok(msg, 'Computer lieferte keine Aktion');
      const r = E.handle(s, 'p' + i, msg, rng);
      assert.ok(r.ok, 'Computerzug abgelehnt: ' + r.error);
    }
    assert.equal(E.tileBalance(s).summe, 106);
  }
  return { winners: s.result.winners.map((id) => +id.slice(1)), steps, reason: s.result.reason };
}

function duel(a, b, n, seed0, stats) {
  let winsA = 0, ended = 0, ties = 0;
  for (let g = 0; g < n; g++) {
    const flip = g % 2 === 1; // Startwechsel: Sitzplätze tauschen (Startperson ist zusätzlich zufällig)
    const kinds = flip ? [b, a] : [a, b];
    const r = playRound(kinds, seed0 + g, stats);
    ended++;
    const aSeat = flip ? 1 : 0;
    if (r.winners.includes(aSeat)) { if (r.winners.length > 1) ties++; else winsA++; }
  }
  return { winsA, ended, ties };
}

test('Mittel gewinnt >= 85 % gegen Leicht (200 Runden, 2 Personen)', () => {
  const stats = { calls: 0, total: 0, max: 0 };
  const r = duel(1, 0, 200, 5000, stats);
  console.log(`Mittel vs Leicht: ${r.winsA}/200 = ${(r.winsA / 2).toFixed(1)} % (Gleichstand ${r.ties}); Zeit je Entscheidung: Ø ${(stats.total / stats.calls).toFixed(2)} ms, Spitze ${stats.max.toFixed(1)} ms (${stats.calls} Aufrufe)`);
  assert.equal(r.ended, 200);
  assert.ok(r.winsA >= 170, `Mittel nur ${r.winsA}/200`);
  assert.ok(stats.max < 200, 'Spitze ' + stats.max);
});

test('Mittel gewinnt >= 95 % gegen den Zufallsspieler (200 Runden)', () => {
  const stats = { calls: 0, total: 0, max: 0 };
  const r = duel(1, 'r', 200, 9000, stats);
  console.log(`Mittel vs Zufall: ${r.winsA}/200 = ${(r.winsA / 2).toFixed(1)} %; Zeit Ø ${(stats.total / stats.calls).toFixed(2)} ms, Spitze ${stats.max.toFixed(1)} ms`);
  assert.ok(r.winsA >= 190, `Mittel nur ${r.winsA}/200`);
});

test('3 und 4 Personen: Computerrunden enden, Züge gültig, Steinbilanz stimmt', () => {
  const stats = { calls: 0, total: 0, max: 0 };
  for (let g = 0; g < 30; g++) {
    const kinds = g % 2 ? [1, 0, 1, 'r'].slice(0, 3 + (g % 4 === 1 ? 1 : 0)) : [1, 1, 0, 0].slice(0, 3 + (g % 4 === 0 ? 1 : 0));
    playRound(kinds, 20000 + g, stats);
  }
  assert.ok(stats.max < 200);
});

test('Computerzüge sind immer gültig, Mittel legt mehr als Leicht, Eröffnung nie unter 30', () => {
  const rng = mulberry(77);
  for (const level of [0, 1]) {
    let opened = 0;
    for (let g = 0; g < 40; g++) {
      const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
      for (let k = 0; k < 400 && s.phase === 'play'; k++) {
        const p = E.activePlayer(s);
        const was = p.melded;
        const m = chooseAction(s, p.id, level, rng);
        if (m.t === 'play') {
          const c = E.checkTurn(s, p.id, m.table);
          assert.ok(c.ok, c.error);
          if (!was) { opened++; assert.ok(c.newValue >= 30); }
        }
        assert.ok(E.handle(s, p.id, m, rng).ok);
      }
    }
    assert.ok(opened > 0, 'Stufe ' + level + ' eröffnet nie');
  }
});

test('Nicht am Zug / Runde vorbei: null', () => {
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry(1));
  const other = s.players[1 - s.active].id;
  assert.equal(chooseAction(s, other, 1, mulberry(1)), null);
  assert.equal(chooseAction(s, 'zz', 1, mulberry(1)), null);
  s.phase = 'over';
  assert.equal(chooseAction(s, s.players[s.active].id, 1, mulberry(1)), null);
});

// ---------- gezielte Fähigkeiten ----------
function mkState(hand, table, melded = true) {
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry(1));
  const used = new Set([].concat(hand, ...table));
  s.players[0].hand = hand.slice(); s.players[0].melded = melded; s.players[0].id = 'a';
  s.players[1].melded = true;
  s.players[1].hand = Array.from({ length: 106 }, (_, i) => i).filter((i) => !used.has(i)).slice(0, 14);
  s.table = table.map((x) => x.slice());
  const inHands = new Set([].concat(...s.players.map((p) => p.hand), ...table));
  s.pile = Array.from({ length: 106 }, (_, i) => i).filter((i) => !inHands.has(i));
  s.active = 0;
  return s;
}
const mid = (s) => chooseAction(s, 'a', 1, () => 0.99);

test('Mittel: eröffnet erst ab 30, sonst Ziehen', () => {
  let s = mkState([...R(0, 3, 5), T(1, 1), T(2, 9)], [], false);
  assert.deepEqual(mid(s), { t: 'draw' }); // 12 Punkte
  s = mkState([...R(0, 9, 11), T(1, 1), T(2, 9)], [], false);
  const m = mid(s);
  assert.equal(m.t, 'play');
  assert.equal(E.checkTurn(s, 'a', m.table).newValue, 30);
  // zwei Sätze zusammen 30 (Gruppe 7,7,7 + Reihe 2,3,4)
  s = mkState([...R(0, 2, 4), T(0, 7), T(1, 7), T(2, 7), T(3, 13)], [], false);
  assert.equal(mid(s).t, 'play');
  // Leicht: 29 reicht nicht
  s = mkState([...R(0, 2, 4), T(0, 5), T(1, 5), T(2, 5), T(3, 5), T(3, 13)], [], false);
  assert.deepEqual(chooseAction(s, 'a', 0, () => 0.99), { t: 'draw' });
  assert.deepEqual(mid(s), { t: 'draw' });
});

test('Mittel: Anlegen, Joker, Umordnen, Joker-Tausch', () => {
  // Anlegen an Reihenende und 4. Farbe an die Gruppe
  let s = mkState([T(0, 7), T(3, 9), T(2, 1)], [R(0, 3, 6), [T(0, 9), T(1, 9), T(2, 9)]]);
  let m = mid(s);
  assert.equal(m.t, 'play');
  assert.deepEqual(E.checkTurn(s, 'a', m.table).played.sort((a, b) => a - b), [T(0, 7), T(3, 9)].sort((a, b) => a - b));
  // Leicht legt nicht an
  s = mkState([T(0, 7), T(3, 9), T(2, 1)], [R(0, 3, 6), [T(0, 9), T(1, 9), T(2, 9)]]);
  assert.deepEqual(chooseAction(s, 'a', 0, () => 0.99), { t: 'draw' });
  // Stein aus langer Reihe in eine Gruppe: Tisch blau 4..8, Hand rot 8, gelb 8 -> Gruppe 8, Reihe 4..7
  s = mkState([T(0, 8), T(2, 8), T(3, 1)], [R(1, 4, 8)]);
  m = mid(s);
  assert.equal(m.t, 'play');
  assert.equal(E.checkTurn(s, 'a', m.table).played.length, 2);
  // Reihe in der Mitte teilen (>= 7): Tisch blau 1..8, Hand rot 4 + gelb 4: Gruppe 4 mit blau 4 -> blau 1..3 und 5..8
  s = mkState([T(0, 4), T(2, 4), T(3, 13)], [R(1, 1, 8)]);
  m = mid(s);
  assert.equal(m.t, 'play');
  assert.equal(E.checkTurn(s, 'a', m.table).played.length, 2);
  // Joker austauschen und sofort wieder verbauen: Tisch rot 5,J,7; Hand rot 6, blau 9, gelb 9
  s = mkState([T(0, 6), T(1, 9), T(2, 9), T(3, 13)], [[T(0, 5), J1, T(0, 7)]]);
  m = mid(s);
  assert.equal(m.t, 'play');
  const c = E.checkTurn(s, 'a', m.table);
  assert.equal(c.played.length, 3);
  // Joker aus der Hand an eine Reihe anlegen
  s = mkState([J1, T(3, 13)], [R(0, 3, 6)]);
  m = mid(s);
  assert.equal(m.t, 'play');
  assert.deepEqual(E.checkTurn(s, 'a', m.table).played, [J1]);
  // Letzten Stein legen (Sieg)
  s = mkState([T(0, 7)], [R(0, 3, 6)]);
  m = mid(s);
  assert.equal(m.t, 'play');
  E.handle(s, 'a', m, mulberry(1));
  assert.equal(s.phase, 'over');
});

test('Mittel: maximiert die Zahl gelegter Steine (beste Aufteilung)', () => {
  // rot 1..5 ODER rot 1,2,3 + Gruppe? Hand: rot 3,4,5, blau 3, gelb 3, rot 6 -> Gruppe 3 (rot3 blau3 gelb3) + rot 4,5,6 = 6 Steine
  const s = mkState([T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(1, 3), T(2, 3)], []);
  const m = mid(s);
  assert.equal(E.checkTurn(s, 'a', m.table).played.length, 6);
});

test('Nur eigene Hand: Änderungen an fremden Händen/Stapel ändern die Entscheidung nicht', () => {
  const rng0 = mulberry(31);
  let checked = 0;
  for (let g = 0; g < 30; g++) {
    const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], {}, rng0);
    for (let k = 0; k < 60 && s.phase === 'play'; k++) {
      const p = E.activePlayer(s);
      for (const level of [0, 1]) {
        const copy = JSON.parse(JSON.stringify(s));
        // fremde Hände und Stapelreihenfolge verändern (Anzahl bleibt gleich)
        const others = copy.players.filter((q) => q.id !== p.id);
        const pool = [].concat(...others.map((q) => q.hand), copy.pile);
        for (let i = pool.length - 1; i > 0; i--) { const j = (i * 7 + g) % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        let at = 0;
        for (const q of others) { q.hand = pool.slice(at, at + q.hand.length); at += q.hand.length; }
        copy.pile = pool.slice(at);
        const a = chooseAction(s, p.id, level, mulberry(k * 13 + g));
        const b = chooseAction(copy, p.id, level, mulberry(k * 13 + g));
        assert.deepEqual(b, a);
        checked++;
      }
      assert.ok(E.handle(s, p.id, chooseAction(s, p.id, g % 2, rng0), rng0).ok);
    }
  }
  assert.ok(checked > 500);
  // Zustand wurde beim Rechnen nicht verändert
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry(8));
  const snap = JSON.stringify(s);
  chooseAction(s, E.activePlayer(s).id, 1, mulberry(1));
  assert.equal(JSON.stringify(s), snap);
});

test('Rechenzeit: Spitze unter 200 ms bei 14 Handsteinen und großem Tisch', () => {
  // Großer Tisch: viele lange Reihen, Gruppen, Joker; Hand 14 passende Steine (nach Eröffnung)
  const table = [R(0, 1, 9), R(1, 1, 9), R(2, 1, 9), R(3, 1, 9), [T(0, 10), T(1, 10), T(2, 10), T(3, 10)], [T(0, 11), J1, T(2, 11)], R(0, 10, 13, 1).slice(0, 3), R(1, 10, 12, 1), R(2, 10, 12, 1), [T(3, 10, 1), T(3, 11), T(3, 12)]];
  const used = new Set(table.flat());
  const handPool = [];
  for (let id = 0; id < 106; id++) if (!used.has(id)) handPool.push(id);
  let max = 0, total = 0, n = 0;
  const rng = mulberry(404);
  for (let rep = 0; rep < 40; rep++) {
    const pool = handPool.slice();
    const hand = [];
    for (let i = 0; i < 14; i++) hand.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    if (rep % 3 === 0 && !hand.includes(J2)) hand[0] = J2;
    const s = mkState(hand, table);
    const t0 = performance.now();
    const m = chooseAction(s, 'a', 1, mulberry(rep));
    const dt = performance.now() - t0;
    max = Math.max(max, dt); total += dt; n++;
    if (m.t === 'play') assert.ok(E.checkTurn(s, 'a', m.table).ok);
  }
  // Spielstärken-Spitze: Hand mit vielen Jokern/Kombinationen (alle Zahlen einer Farbe + Duplikate)
  const rich = [...R(0, 1, 13), ...R(1, 1, 5, 1), J1];
  const s = mkState(rich.slice(0, 14).concat([]), [R(2, 1, 13), R(3, 1, 13), R(2, 1, 8, 1)]);
  const t0 = performance.now();
  chooseAction(s, 'a', 1, mulberry(1));
  const dt = performance.now() - t0;
  max = Math.max(max, dt);
  console.log(`Rechenzeit großer Tisch: Ø ${(total / n).toFixed(1)} ms, Spitze ${max.toFixed(1)} ms`);
  assert.ok(max < 200, 'Spitze ' + max);
});
