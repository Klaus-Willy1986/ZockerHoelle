import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../bingo/engine.js';
import { chooseAction, delayFor, notices, MISS } from '../bingo/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const INTERVAL = E.TIMER_MS;

// Eine Runde mit simulierter Uhr: alle 8 s wird eine Zahl gezogen, Computer markieren/rufen mit ihren Verzögerungen
// (genau wie die Oberfläche: nach jeder Zustandsänderung wird für jeden Computer die nächste Aktion eingeplant,
// beim Ablauf der Zeit wird neu entschieden). cardsFor: Karten je Computer (gleiche Karten über Seeds).
function simulate({ levels, cards, seed, opts = {} }) {
  const ids = levels.map((_, i) => 'bot' + (i + 1));
  const g = E.createGame(ids.map((id) => ({ id, name: id })), { host: ids[0], ...opts }, seedRng(seed));
  ids.forEach((id, i) => { g.cards[id] = [cards[i].slice()]; g.marks[id] = [E.freshMarks()]; });
  const rngDraw = seedRng(seed * 7 + 1);
  const rngT = seedRng(seed * 13 + 5);
  let now = 0; let nextDraw = INTERVAL; let worst = 0;
  const pending = new Map(); // id -> { at, key }
  const keyOf = (id) => `${g.drawn.length}|${JSON.stringify(g.marks[id])}|${g.phase}`;
  const arm = () => {
    for (const [k, id] of ids.entries()) {
      const t0 = performance.now();
      const a = chooseAction(g, id, levels[k], seedRng(1));
      worst = Math.max(worst, performance.now() - t0);
      const p = pending.get(id);
      if (!a) { pending.delete(id); continue; }
      const key = keyOf(id);
      if (!p || p.key !== key) pending.set(id, { at: now + delayFor(a, rngT), key });
    }
  };
  arm();
  let guard = 0;
  while (g.phase === 'play' && guard++ < 20000) {
    let tNext = nextDraw; let who = null;
    for (const [id, p] of pending) if (p.at < tNext || (p.at === tNext && who === null)) { tNext = p.at; who = id; }
    now = tNext;
    if (who === null) { assert.ok(E.draw(g, g.host, rngDraw).ok); nextDraw += INTERVAL; } else {
      pending.delete(who);
      const a = chooseAction(g, who, levels[ids.indexOf(who)], seedRng(2));
      if (a) assert.ok(E.handle(g, who, a).ok || a.t === 'bingo', JSON.stringify(a));
    }
    if (g.phase === 'play') arm();
    if (g.drawn.length >= E.TOTAL && !pending.size) break;
  }
  return { g, now, worst };
}

test('Mittel gewinnt >= 60 % der Runden gegen Leicht (gleiche Karten, Startwechsel, 600 Runden), Dauer plausibel', () => {
  const N = 300; let midWin = 0; let easyWin = 0; let both = 0; let none = 0; let worst = 0; let totalT = 0; let totalDraws = 0; let rounds = 0;
  for (let s = 1; s <= N; s++) {
    const rng = seedRng(1000 + s);
    const X = E.makeCard(rng); const Y = E.makeCard(rng);
    for (const first of [true, false]) { // Startwechsel: Mittel sitzt vorn oder hinten, Karten wechseln
      const r = simulate({ levels: first ? [1, 0] : [0, 1], cards: first ? [X, Y] : [X, Y].reverse(), seed: s });
      worst = Math.max(worst, r.worst); totalT += r.now; totalDraws += r.g.drawn.length; rounds++;
      const midId = first ? 'bot1' : 'bot2'; const easyId = first ? 'bot2' : 'bot1';
      const w = r.g.winners;
      if (w.includes(midId) && w.includes(easyId)) both++;
      else if (w.includes(midId)) midWin++;
      else if (w.includes(easyId)) easyWin++;
      else none++;
    }
  }
  const rate = (midWin + both / 2) / (2 * N);
  console.log(`Mittel vs Leicht: Mittel ${midWin}, Leicht ${easyWin}, beide ${both}, keiner ${none}; Quote ${(100 * (midWin + both) / rounds).toFixed(1)} % (Mittel im Siegerkreis), nur Mittel ${(100 * midWin / rounds).toFixed(1)} %; Ø ${(totalDraws / rounds).toFixed(1)} Zahlen, Ø ${(totalT / rounds / 1000).toFixed(0)} s; schlechteste Rechenzeit ${worst.toFixed(2)} ms`);
  assert.ok(rate >= 0.6, `Quote ${rate}`);
  assert.ok((midWin + both) / rounds >= 0.6);
  assert.equal(none, 0, 'jede Runde endet mit Sieger');
  assert.ok(totalDraws / rounds >= 25 && totalDraws / rounds <= 60, 'Ø Zahlen ' + totalDraws / rounds);
  assert.ok(totalT / rounds >= 150000 && totalT / rounds <= 520000, 'Ø Dauer ' + totalT / rounds);
  assert.ok(worst < 150, 'Rechenzeit ' + worst);
});

test('Verpasst-Quoten: Leicht ca. 15 %, Mittel ca. 3 %', () => {
  for (const [level, want] of [[0, 0.15], [1, 0.03]]) {
    assert.equal(MISS[level], want);
    let missed = 0; let tot = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const g = { seed: seed * 7919, round: 1 + (seed % 5) };
      for (let n = 1; n <= 75; n++) { tot++; if (!notices(g, 'bot1', level, n)) missed++; }
    }
    const q = missed / tot;
    assert.ok(Math.abs(q - want) < 0.012, `Stufe ${level}: ${q}`);
  }
});

test('Computer markiert nur gezogene Zahlen, nur auf eigener Karte, ruft BINGO nur wenn gültig', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seedRng(seed);
    const g = E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'C' }], { two: seed % 2 === 0, full: seed % 3 === 0 }, rng);
    assert.equal(chooseAction(g, 'bot1', 0, rng), null, 'noch nichts gezogen');
    assert.equal(chooseAction(g, 'fremd', 0, rng), null);
    assert.equal(chooseAction(null, 'bot1', 0, rng), null);
    let steps = 0;
    while (g.phase === 'play' && steps++ < 500) {
      for (let k = 0; k < 20; k++) {
        const a = chooseAction(g, 'bot1', seed % 2, rng);
        if (!a) break;
        if (a.t === 'bingo') { assert.ok(E.isValid(g, 'bot1')); E.handle(g, 'bot1', a); break; }
        assert.equal(a.t, 'mark');
        const v = g.cards.bot1[a.c][a.i];
        assert.ok(g.drawn.includes(v), 'nur gezogene Zahlen');
        assert.ok(E.handle(g, 'bot1', a).ok);
      }
      if (g.phase === 'play') E.draw(g, 'me', rng);
      if (g.drawn.length >= 75) break;
    }
  }
});

test('Kein Schummeln: Karten und Markierungen anderer ändern keine Entscheidung', () => {
  for (const level of [0, 1]) {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seedRng(seed);
      const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }, { id: 'b', name: 'B' }], {}, rng);
      for (let k = 0; k < 8 + (seed % 25); k++) E.draw(g, 'a', rng);
      const twin = JSON.parse(JSON.stringify(g));
      twin.cards.a = [E.makeCard(seedRng(seed + 99))]; twin.cards.b = [E.makeCard(seedRng(seed + 98))];
      twin.marks.a = [E.freshMarks()]; twin.marks.b = [Array(25).fill(1)];
      twin.scores.a = 5; twin.evt = { seq: 99, kind: 'bingo', by: 'b' };
      assert.deepEqual(chooseAction(g, 'bot1', level, seedRng(seed)), chooseAction(twin, 'bot1', level, seedRng(seed)));
    }
  }
});

test('Entscheidung ist reproduzierbar (Neuladen) und Verzögerungen liegen im Bereich', () => {
  const rng = seedRng(4);
  const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], {}, rng);
  for (let k = 0; k < 30; k++) E.draw(g, 'a', rng);
  const a1 = JSON.stringify(chooseAction(JSON.parse(JSON.stringify(g)), 'bot1', 0, seedRng(1)));
  const a2 = JSON.stringify(chooseAction(JSON.parse(JSON.stringify(g)), 'bot1', 0, seedRng(9)));
  assert.equal(a1, a2);
  for (let k = 0; k < 300; k++) {
    const m = delayFor({ t: 'mark' }, rng); const b = delayFor({ t: 'bingo' }, rng);
    assert.ok(m >= 1000 && m <= 3000 && b >= 1000 && b <= 2000);
  }
});

test('Rechenzeit unter 150 ms auch bei vollen Karten und 8 Personen', () => {
  const rng = seedRng(8);
  const g = E.createGame(Array.from({ length: 8 }, (_, i) => ({ id: i ? 'bot' + i : 'h', name: 'P' + i })), { two: true, full: true }, rng);
  for (let k = 0; k < 74; k++) E.draw(g, 'h', rng);
  let worst = 0;
  for (let i = 1; i < 8; i++) { const t0 = performance.now(); chooseAction(g, 'bot' + i, 1, rng); worst = Math.max(worst, performance.now() - t0); }
  assert.ok(worst < 150, 'Rechenzeit ' + worst);
});
