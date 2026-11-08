import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../stichprophet/engine.js';
import { chooseAction } from '../stichprophet/ai.js';
import { coach } from '../stichprophet/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {} } });
const P = [{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer 1' }, { id: 'bot2', name: 'Computer 2' }];
const LEARN = { hints: true, dealer: 2, totalRounds: 4 };

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${r.text && r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen oder lange Zahl in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  assert.ok(!/(spiele|lege|nimm|sag)\s+(am besten|diese|den|die|das|jetzt die|besser|lieber)/i.test(r.text) && !/beste|empfehl|klug|am besten|tipp:|solltest|lieber eine/i.test(r.text), `${where}: Empfehlung in "${r.text}"`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};
const botMove = (g, rng) => { const id = g.players[g.turn].id; const msg = chooseAction(g, id, 0, rng); assert.equal(M.handle(g, id, msg, rng).ok, true, JSON.stringify(msg)); };

// Spielt die Lernrunde so, wie die Anleitung es verlangt (Ziel anklicken). Rückgabe: alle Texte.
function playLearn(seed, texts, targets) {
  const rng = seeded(seed);
  const g = M.createGame(P, LEARN, rng, 'me');
  const ctx = mkCtx();
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 2000) {
    const r = must(g, ctx, `seed ${seed} ${g.phase}`);
    texts && texts.add(r.text);
    if (g.phase === 'round_over') {
      assert.equal(r.target, '[data-act=next]');
      M.handle(g, 'me', { t: 'next' }, rng);
      continue;
    }
    if (g.turn !== 0) {
      assert.equal(r.target, undefined, 'kein Ziel, wenn der Computer dran ist');
      botMove(g, rng);
      continue;
    }
    assert.ok(r.target, 'Ziel erwartet, wenn ich dran bin');
    targets && targets.add(r.target);
    let msg;
    if (g.phase === 'trump') { assert.equal(r.target, '[data-act=trump]'); msg = { t: 'trump', suit: Math.floor(rng() * 4) }; }
    else if (g.phase === 'bid') { assert.equal(r.target, '[data-act=bid]'); msg = { t: 'bid', n: Math.floor(rng() * (g.round + 1)) }; }
    else { assert.equal(r.target, '.st-hand button.can'); const l = M.legalCards(g, 'me'); msg = { t: 'play', card: l[Math.floor(rng() * l.length)] }; }
    assert.equal(M.handle(g, 'me', msg, rng).ok, true);
  }
  assert.equal(g.phase, 'over');
  const end = must(g, ctx, 'Ende');
  assert.equal(end.target, '[data-act=again]');
  return g;
}

test('Lernrunde (3 Personen, 4 Runden): in jedem Zustand gültiger Text, Ziel nur wenn ich handeln muss', () => {
  const texts = new Set(); const targets = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const g = playLearn(seed, texts, targets);
    assert.equal(g.round, 4); assert.equal(g.totalRounds, 4);
  }
  const all = [...texts].join(' ');
  for (const w of ['Trumpf', 'Zauberer', 'Narr', 'Farbzwang', 'Stich', 'Punkte', 'sagst du an', 'Zahl']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
  assert.ok(targets.size >= 3);
});

test('Jede Erklärung kommt nur in einer Lage vor (danach nie wieder), über alle 4 Runden', () => {
  let longTexts = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const rng = seeded(seed + 100);
    const g = M.createGame(P, LEARN, rng, 'me');
    const ctx = mkCtx();
    const where = new Map();
    const GENERIC = (t) => t.length < 60 || /^(Das Spiel ist zu Ende|Die Punkte sind)|Schau einfach zu\.$/.test(t);
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 2000) {
      const key = [g.round, g.phase, g.players.reduce((s, p) => s + p.tricks, 0), g.trick.cards.length, g.turn].join('|');
      const r = must(g, ctx, 'x');
      assert.equal(must(g, ctx, 'x').text, r.text, 'gleiche Lage, gleicher Text');
      if (!GENERIC(r.text)) {
        longTexts++;
        if (!where.has(r.text)) where.set(r.text, key);
        assert.equal(where.get(r.text), key, 'Erklärung taucht in anderer Lage wieder auf: ' + r.text);
      }
      if (g.phase === 'round_over') { M.handle(g, 'me', { t: 'next' }, rng); continue; }
      const id = g.players[g.turn].id;
      let msg;
      if (g.turn !== 0) msg = chooseAction(g, id, 0, rng);
      else if (g.phase === 'trump') msg = { t: 'trump', suit: 1 };
      else if (g.phase === 'bid') msg = { t: 'bid', n: 0 };
      else msg = { t: 'play', card: M.legalCards(g, 'me')[0] };
      assert.equal(M.handle(g, id, msg, rng).ok, true);
    }
    assert.ok(where.size >= 4, 'mehrere verschiedene Erklärungen: ' + where.size);
  }
  assert.ok(longTexts > 100);
});

test('Farbzwang-Erklärung: erscheint, wenn ich bedienen muss; Zauberer-Anspiel erklärt, dass es keinen Zwang gibt', () => {
  const C = (s, v) => s * 13 + (v - 1);
  const g = M.createGame(P, { hints: true, dealer: 2, totalRounds: 4 }, seeded(2), 'me');
  g.round = 3;
  g.players[0].hand = [C(0, 5), C(0, 6), C(1, 2)]; g.players[1].hand = [C(0, 9), C(1, 1), C(2, 1)]; g.players[2].hand = [C(3, 1), C(3, 2), C(3, 3)];
  g.players.forEach((p) => { p.bid = 1; p.tricks = 0; });
  g.phase = 'play'; g.trump = 'none'; g.upcard = null; g.leader = 1; g.turn = 1; g.trick = { cards: [] };
  M.handle(g, 'bot1', { t: 'play', card: C(0, 9) });
  M.handle(g, 'bot2', { t: 'play', card: C(3, 1) });
  assert.equal(g.turn, 0);
  const r = must(g, mkCtx(), 'follow');
  assert.ok(/Farbzwang/.test(r.text) && /Rot/.test(r.text), r.text);
  assert.equal(r.target, '.st-hand button.can');
  // keine Karte der Farbe -> anderer Text
  const h = JSON.parse(JSON.stringify(g));
  h.players[0].hand = [C(1, 2), C(2, 3), C(3, 4)];
  const r2 = must(h, mkCtx(), 'frei');
  assert.ok(/nicht/.test(r2.text) && /jede Karte/.test(r2.text), r2.text);
  // Zauberer als Anspiel
  const k = JSON.parse(JSON.stringify(g));
  k.trick = { cards: [{ pid: 'bot1', card: 52 }, { pid: 'bot2', card: C(3, 1) }] };
  const r3 = must(k, mkCtx(), 'zauberer');
  assert.ok(/keinen Farbzwang/.test(r3.text), r3.text);
});

test('Trumpfwahl durch mich als Geber (Zauberer aufgedeckt) und Zuschauen', () => {
  for (const dealer of [0, 1, 2]) {
    const g = M.createGame(P, { hints: true, dealer }, seeded(4 + dealer), 'me');
    // Zauberer als Aufdeckkarte erzwingen
    const w = 52;
    for (const p of g.players) p.hand = p.hand.filter((c) => c !== w);
    g.upcard = w; g.trump = null; g.phase = 'trump'; g.turn = g.dealer;
    const r = must(g, mkCtx(), 'trump');
    if (dealer === 0) { assert.equal(r.target, '[data-act=trump]'); assert.ok(/Trumpf/.test(r.text)); assert.ok(/Zauberer/.test(r.text)); }
    else { assert.equal(r.target, undefined); assert.ok(/Schau einfach zu/.test(r.text)); }
  }
});

test('Ansage-Texte: verschiedene Hinweise nacheinander, jeder nur einmal', () => {
  const seen = []; const ctx = mkCtx();
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed * 7);
    const g = M.createGame(P, { hints: true, dealer: seed % 3 }, rng, 'me');
    if (g.phase === 'trump') M.handle(g, g.players[g.turn].id, { t: 'trump', suit: 0 });
    while (g.phase === 'bid' && g.turn !== 0) M.handle(g, g.players[g.turn].id, { t: 'bid', n: 0 });
    if (g.phase !== 'bid') continue;
    const r = must(g, ctx, 'bid');
    assert.equal(r.target, '[data-act=bid]');
    seen.push(r.text);
  }
  const uniq = new Set(seen);
  assert.ok(uniq.size >= 3, 'verschiedene Texte: ' + uniq.size);
  for (const t of uniq) if (t.length > 40) assert.equal(seen.filter((x) => x === t).length, 1, 'lange Erklärung mehrfach: ' + t);
});

test('Spielende: Hinweis auf neues Spiel; Rundenende: Nächste Runde mit Wertungserklärung nur einmal', () => {
  const g = playLearn(7);
  const r = must(g, mkCtx(), 'over');
  assert.equal(r.target, '[data-act=again]');
  // Wertungserklärung nur beim ersten Rundenende lang
  const rng = seeded(3);
  const h = M.createGame(P, LEARN, rng, 'me');
  const ctx = mkCtx();
  const ends = [];
  let guard = 0;
  while (h.phase !== 'over' && guard++ < 2000) {
    if (h.phase === 'round_over') { ends.push(must(h, ctx, 'end').text); M.handle(h, 'me', { t: 'next' }, rng); continue; }
    const id = h.players[h.turn].id;
    let msg;
    if (h.turn !== 0) msg = chooseAction(h, id, 0, rng);
    else if (h.phase === 'trump') msg = { t: 'trump', suit: 0 };
    else if (h.phase === 'bid') msg = { t: 'bid', n: 0 };
    else msg = { t: 'play', card: M.legalCards(h, 'me')[0] };
    M.handle(h, id, msg, rng);
  }
  assert.equal(ends.length, 3);
  assert.ok(/20 Punkte/.test(ends[0]));
  assert.ok(!/20 Punkte/.test(ends[1]) && !/20 Punkte/.test(ends[2]));
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'st' }, { game: 'st', players: [] }, { game: 'st', players: [{ id: 'me' }], trick: {} },
    { game: 'st', players: [{ id: 'me', hand: null }, { id: 'b' }], trick: { cards: [] }, phase: 'play', turn: 3 },
    { game: 'st', players: [{ id: 'me', hand: [] }, { id: 'b', hand: [] }], trick: { cards: [{ card: 'x' }] }, phase: 'play', turn: 0, trump: 99 },
    { game: 'st', players: [{ id: 'me', hand: [1, 2] }, { id: 'b', hand: [] }], trick: { cards: [{ card: 'x' }] }, phase: 'bid', turn: 0, trump: 99, round: 'a' }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
