import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../haus/engine.js';
import { chooseAction } from '../haus/ai.js';

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
const ALL = E.SQUARES.map((q) => q.i);

// Zufallsspieler: zufällige legale Aktion bei Auswahlphasen, kauft 50 %
function randomAction(s, rng) {
  const me = E.activePlayer(s);
  const legal = (fn) => ALL.filter((q) => fn(s, me.id, q));
  switch (s.phase) {
    case 'roll':
      if (me.jail > 0) { const r = rng(); if (r < 0.2 && me.cash >= 50) return { t: 'pay_jail' }; if (r < 0.4 && me.freeCards > 0) return { t: 'use_card' }; }
      return { t: 'roll' };
    case 'buy': return rng() < 0.5 ? { t: 'buy' } : { t: 'decline' };
    case 'auction': {
      const bid = s.auction.high + 10 * (1 + Math.floor(rng() * 3));
      return rng() < 0.5 && bid <= me.cash ? { t: 'bid', amount: bid } : { t: 'pass_bid' };
    }
    case 'raise': {
      const o = [...legal(E.canSell).map((q) => ({ t: 'sell', sq: q })), ...legal(E.canMortgage).map((q) => ({ t: 'mortgage', sq: q }))];
      return o.length ? pick(o, rng) : { t: 'declare_bankrupt' };
    }
    default: {
      if (rng() < 0.6) return { t: 'end' };
      const o = [...legal(E.canBuild).map((q) => ({ t: 'build', sq: q })), ...legal(E.canMortgage).map((q) => ({ t: 'mortgage', sq: q })), ...legal(E.canUnmortgage).map((q) => ({ t: 'unmortgage', sq: q }))];
      return o.length ? pick(o, rng) : { t: 'end' };
    }
  }
}

// kinds: je Platz 0/1 = Computerstufe, 'r' = Zufall
function play(kinds, seed, maxRounds = 40) {
  const rng = mulberry(seed);
  const s = E.createGame(kinds.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), { maxRounds }, rng);
  let steps = 0, maxMs = 0, totalMs = 0, calls = 0;
  while (s.phase !== 'over') {
    assert.ok(steps++ < 40000, 'Endlosspiel');
    const a = E.activePlayer(s);
    const k = kinds[+a.id.slice(1)];
    let msg;
    if (k === 'r') msg = randomAction(s, rng);
    else {
      const t0 = performance.now();
      msg = chooseAction(s, a.id, k, rng);
      const dt = performance.now() - t0;
      maxMs = Math.max(maxMs, dt); totalMs += dt; calls++;
    }
    assert.ok(msg, 'Computer lieferte keine Aktion in Phase ' + s.phase);
    const r = E.handle(s, a.id, msg, rng);
    assert.equal(r.ok, true, `Engine lehnt ab: ${JSON.stringify(msg)} ${r.error}`);
  }
  assert.equal(s.players.reduce((x, p) => x + p.cash, 0) + s.bank, 1500 * kinds.length);
  return { s, maxMs, totalMs, calls };
}
// Punkte der Plätze `mine` (Mittel): 1 bei Sieg, geteilt bei Gleichstand
const share = (s, id) => (s.result.winners.includes(id) ? 1 / s.result.winners.length : 0);

function duel(a, b, n, seed0) {
  let pts = 0, ms = 0, calls = 0, max = 0, rounds = 0, ends = 0;
  for (let i = 0; i < n; i++) {
    const first = i % 2 === 0;
    const r = play(first ? [a, b] : [b, a], seed0 + i);
    pts += share(r.s, first ? 'p0' : 'p1');
    ms += r.totalMs; calls += r.calls; max = Math.max(max, r.maxMs); rounds += r.s.round;
    if (r.s.result.reason === 'last') ends++;
  }
  return { q: pts / n, avgMs: ms / Math.max(1, calls), max, rounds: rounds / n, ends };
}

test('Mittel schlägt Leicht in mindestens 75 % der 200 Zweierpartien (Startwechsel, 40 Runden)', () => {
  const r = duel(1, 0, 200, 1000);
  console.log(`  Mittel gegen Leicht (2 Pers.): ${(r.q * 100).toFixed(1)} %, Ø ${r.rounds.toFixed(1)} Runden, ${r.ends} Partien durch Bankrott, Rechenzeit Ø ${r.avgMs.toFixed(3)} ms, max ${r.max.toFixed(2)} ms`);
  assert.ok(r.q >= 0.75, `Quote ${r.q}`);
  assert.ok(r.max < 50, `Spitzenzeit ${r.max}`);
});

test('Mittel schlägt Zufall in mindestens 90 % der 200 Zweierpartien', () => {
  const r = duel(1, 'r', 200, 5000);
  console.log(`  Mittel gegen Zufall (2 Pers.): ${(r.q * 100).toFixed(1)} %, Ø ${r.rounds.toFixed(1)} Runden`);
  assert.ok(r.q >= 0.9, `Quote ${r.q}`);
});

test('Leicht gegen Zufall (Information, Leicht muss vorn liegen)', () => {
  const r = duel(0, 'r', 200, 9000);
  console.log(`  Leicht gegen Zufall (2 Pers.): ${(r.q * 100).toFixed(1)} %`);
  assert.ok(r.q > 0.5);
});

test('4 Personen: Mittel gegen drei Leicht bzw. drei Zufall (200 Partien je Gegnerart, Startplatz wechselt)', () => {
  for (const [opp, need] of [[0, 0.75], ['r', 0.9]]) {
    let pts = 0;
    for (let i = 0; i < 200; i++) {
      const seat = i % 4;
      const kinds = [opp, opp, opp, opp]; kinds[seat] = 1;
      pts += share(play(kinds, 12000 + i + (opp === 0 ? 0 : 500)).s, 'p' + seat);
    }
    console.log(`  Mittel gegen 3x ${opp === 0 ? 'Leicht' : 'Zufall'} (4 Pers., Zufallsanteil 25 %): ${(pts / 2).toFixed(1)} %`);
    assert.ok(pts / 200 >= need, `Quote ${pts / 200}`);
  }
});

test('Mittel gegen Mittel und gemischte Runden mit 2 bis 6 Personen: alle Nachrichten gültig, alle Partien enden', () => {
  let games = 0;
  for (let n = 2; n <= 6; n++) {
    for (let i = 0; i < 20; i++) {
      const kinds = Array.from({ length: n }, (_, j) => [1, 0, 'r', 1][(i + j) % 4]);
      const r = play(kinds, 20000 + n * 100 + i);
      assert.ok(['rounds', 'last'].includes(r.s.result.reason));
      games++;
    }
  }
  assert.equal(games, 100);
});

test('Partien mit unbegrenzten Runden enden durch Bankrott (Sicherheitsgrenze auf Züge)', () => {
  let ended = 0;
  for (let i = 0; i < 30; i++) {
    const rng = mulberry(30000 + i);
    const s = E.createGame([{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }], { maxRounds: 0 }, rng);
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 100000) {
      const a = E.activePlayer(s);
      assert.equal(E.handle(s, a.id, chooseAction(s, a.id, i % 2, rng), rng).ok, true);
    }
    if (s.phase === 'over') ended++;
  }
  console.log(`  unbegrenzt: ${ended} von 30 Partien durch Bankrott beendet`);
  assert.ok(ended >= 25);
});

test('Rechenzeit: jede Entscheidung unter 50 ms (Mittel und Leicht, 6 Personen)', () => {
  let max = 0, calls = 0, total = 0;
  for (let i = 0; i < 6; i++) {
    const r = play([1, 0, 1, 0, 1, 0], 40000 + i);
    max = Math.max(max, r.maxMs); calls += r.calls; total += r.totalMs;
  }
  console.log(`  Rechenzeit: ${calls} Entscheidungen, Ø ${(total / calls).toFixed(3)} ms, max ${max.toFixed(2)} ms`);
  assert.ok(max < 50);
});

test('chooseAction liefert null, wenn die Person nicht handeln darf oder das Spiel vorbei ist', () => {
  const rng = mulberry(5);
  const s = E.createGame([{ id: 'me', name: 'A' }, { id: 'bot', name: 'C' }], {}, rng);
  for (const level of [0, 1]) {
    assert.equal(chooseAction(s, 'bot', level, rng), null);
    assert.equal(chooseAction(s, 'unbekannt', level, rng), null);
    assert.deepEqual(chooseAction(s, 'me', level, rng), { t: 'roll' });
  }
  assert.equal(chooseAction(null, 'me', 1, rng), null);
  s.phase = 'over';
  assert.equal(chooseAction(s, 'me', 1, rng), null);
});

test('Nachricht passt zur Phase (buy, auction, raise, manage) und wird von der Engine akzeptiert', () => {
  for (const level of [0, 1]) {
    const rng = mulberry(77 + level);
    const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
    const seen = new Set();
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 6000) {
      const id = E.activePlayer(s).id;
      const m = chooseAction(s, id, level, rng);
      const allowed = { roll: ['roll', 'pay_jail', 'use_card'], buy: ['buy', 'decline'], auction: ['bid', 'pass_bid'], raise: ['sell', 'mortgage', 'declare_bankrupt'], manage: ['build', 'unmortgage', 'mortgage', 'sell', 'end'] }[s.phase];
      assert.ok(allowed.includes(m.t), `${s.phase}: ${m.t}`);
      seen.add(s.phase);
      assert.equal(E.handle(s, id, m, rng).ok, true);
    }
    assert.ok(seen.has('buy') && seen.has('auction') && seen.has('manage'));
  }
});

test('Leicht zahlt das Gefängnis nie vor Runde 5; Freikarte nutzt jede Stufe', () => {
  const rng = mulberry(3);
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
  s.players[0].jail = 1; s.players[0].pos = 10;
  for (let r = 1; r <= 4; r++) { s.round = r; assert.deepEqual(chooseAction(s, 'a', 0, rng), { t: 'roll' }); }
  s.round = 6;
  assert.deepEqual(chooseAction(s, 'a', 0, rng), { t: 'pay_jail' });
  s.players[0].freeCards = 1;
  for (const level of [0, 1]) assert.deepEqual(chooseAction(s, 'a', level, rng), { t: 'use_card' });
});

test('Mittel: früh im Gefängnis zahlen (viele freie Grundstücke), spät drinbleiben', () => {
  const rng = mulberry(4);
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
  s.players[0].jail = 1; s.players[0].pos = 10;
  assert.deepEqual(chooseAction(s, 'a', 1, rng), { t: 'pay_jail' });
  for (const q of ALL) if (['street', 'station', 'utility'].includes(E.SQUARES[q].type)) s.owners[q] = 'b';
  assert.deepEqual(chooseAction(s, 'a', 1, rng), { t: 'roll' });
});

test('Mittel: kauft bezahlbar, hält Reserve, löst Komplettierung ohne Reserve; Leicht kauft nie ohne 100 Rest', () => {
  const rng = mulberry(8);
  const mk = () => { const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng); s.phase = 'buy'; return s; };
  let s = mk(); s.players[0].pos = 6; s.owners[8] = 'a'; // gleiche Farbe schon im Besitz
  assert.equal(chooseAction(s, 'a', 1, rng).t, 'buy');
  s.players[0].cash = 150; // Rest 50 < Reserve
  assert.equal(chooseAction(s, 'a', 1, rng).t, 'decline');
  s = mk(); s.players[0].pos = 6; // unwichtiges Einzelgrundstück: lieber in die Auktion
  assert.equal(chooseAction(s, 'a', 1, rng).t, 'decline');
  s = mk(); s.players[0].pos = 9; s.owners[6] = 'a'; s.owners[8] = 'a'; s.players[0].cash = 125; // komplettiert Farbe
  assert.equal(chooseAction(s, 'a', 1, rng).t, 'buy');
  s = mk(); s.players[0].pos = 6; s.players[0].cash = 150;
  for (let i = 0; i < 30; i++) assert.equal(chooseAction(s, 'a', 0, rng).t, 'decline');
});

test('Auktion: Leicht bietet höchstens bis zum halben Preis, Mittel bis ca. 90 %, bei Komplettierung mehr', () => {
  const rng = mulberry(9);
  const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
  s.phase = 'auction'; s.auction = { sq: 24, turn: 'a', high: 0, highBy: null, passed: [], order: ['a', 'b'] }; // Preis 240
  const maxBid = (level) => { let h = 0; for (; h < 600; h += 10) { s.auction.high = h; const m = chooseAction(s, 'a', level, rng); if (m.t !== 'bid') break; assert.equal(m.amount, h + 10); } return h; };
  assert.equal(maxBid(0), 120); // höchstes Gebot 120 = halber Preis
  assert.equal(maxBid(1), 210); // letztes Gebot 216 -> 210 (Zehnerschritte)
  s.owners[21] = 'a'; s.owners[23] = 'a';
  assert.ok(maxBid(1) >= 340);
});

test('Zahlungsnot: Leicht zuerst Hypotheken, dann Häuser; Mittel beginnt beim wertlosesten Besitz', () => {
  const rng = mulberry(10);
  const mk = () => {
    const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
    s.owners[1] = 'a'; s.owners[3] = 'a'; s.owners[39] = 'a'; s.owners[37] = 'a'; s.owners[5] = 'a';
    s.houses[37] = 2; s.houses[39] = 2; s.supply.houses = 28;
    s.phase = 'raise'; s.debt = { from: 'a', to: 'b', amount: 5000, why: '', then: [] };
    return s;
  };
  const s = mk();
  const m0 = chooseAction(s, 'a', 0, rng);
  assert.equal(m0.t, 'mortgage');
  assert.equal(m0.sq, 1); // billigster beleihbarer Besitz (Farbe Blau steht voll bebaut nicht zur Wahl)
  const m1 = chooseAction(s, 'a', 1, rng);
  assert.ok(['mortgage', 'sell'].includes(m1.t));
  assert.ok(m1.t === 'sell' || [1, 3, 5].includes(m1.sq), 'Mittel beleiht keine bebaute Farbe');
  // nur Häuser übrig -> verkaufen
  for (const q of [1, 3, 5]) s.mortgaged[q] = true;
  assert.equal(chooseAction(s, 'a', 0, rng).t, 'sell');
  assert.equal(chooseAction(s, 'a', 1, rng).t, 'sell');
  // nichts mehr: aufgeben
  s.houses[37] = 0; s.houses[39] = 0; s.mortgaged[37] = true; s.mortgaged[39] = true; s.mortgaged[5] = true;
  assert.deepEqual(chooseAction(s, 'a', 1, rng), { t: 'declare_bankrupt' });
});

test('Mittel baut gleichmäßig (nur legale Bauzüge) und bleibt bei Reserve; Leicht baut selten', () => {
  const rng = mulberry(11);
  const mk = () => {
    const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
    for (const q of E.colorGroups[3]) s.owners[q] = 'a';
    s.phase = 'manage';
    return s;
  };
  const s = mk();
  s.players[0].cash = 1000; s.bank = 3000 - 2500;
  const built = [];
  for (let i = 0; i < 40; i++) {
    const m = chooseAction(s, 'a', 1, rng);
    if (m.t === 'end') break;
    assert.equal(m.t, 'build');
    assert.equal(E.handle(s, 'a', m, rng).ok, true);
    built.push(m.sq);
  }
  assert.ok(built.length >= 4);
  const lv = E.colorGroups[3].map((q) => s.houses[q]);
  assert.ok(Math.max(...lv) - Math.min(...lv) <= 1);
  assert.ok(s.players[0].cash >= 100);
  const t = mk(); t.players[0].cash = 1000;
  let builds = 0;
  for (let i = 0; i < 100; i++) if (chooseAction(t, 'a', 0, mulberry(i)).t === 'build') builds++;
  assert.ok(builds < 30, 'Leicht baut selten: ' + builds);
  t.players[0].cash = 300;
  for (let i = 0; i < 30; i++) assert.equal(chooseAction(t, 'a', 0, rng).t, 'end');
});

test('Die KI liest den Kartenstapel nicht: gleiche Entscheidung bei vertauschtem Stapel', () => {
  for (let g = 0; g < 10; g++) {
    const rng = mulberry(500 + g);
    const s = E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, rng);
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 400) {
      const id = E.activePlayer(s).id;
      const level = steps % 2;
      const c = JSON.parse(JSON.stringify(s));
      c.deck = c.deck.slice().reverse(); c.discardPile = c.discardPile.slice().reverse();
      const m1 = chooseAction(s, id, level, mulberry(steps));
      const m2 = chooseAction(c, id, level, mulberry(steps));
      assert.deepEqual(m1, m2);
      assert.equal(E.handle(s, id, m1, rng).ok, true);
    }
  }
});
