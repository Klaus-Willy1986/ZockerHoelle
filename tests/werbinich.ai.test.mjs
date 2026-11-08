import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../werbinich/engine.js';
import { chooseAction, candidates, gain, GUESS_AT, SLIP } from '../werbinich/ai.js';
import { BEGRIFFE, FRAGEN } from '../werbinich/begriffe.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// levels: Stufe je Computer (0 Leicht, 1 Mittel)
function play(levels, rng, opts = {}) {
  const g = E.createGame(levels.map((l, i) => ({ id: 'bot' + (i + 1), name: 'B' + i })), opts, rng);
  let worst = 0; let n = 0;
  while (g.phase !== 'over' && n++ < 20000) {
    if (g.phase === 'reveal') { assert.ok(E.handle(g, g.host, { t: 'next' }, rng).ok); continue; }
    const id = g.players[g.turn].id;
    const t0 = performance.now();
    const msg = chooseAction(g, id, levels[g.turn], rng);
    worst = Math.max(worst, performance.now() - t0);
    const r = E.handle(g, id, msg, rng);
    assert.ok(r.ok, JSON.stringify([msg, r]));
  }
  assert.equal(g.phase, 'over');
  return { g, worst };
}

test('Mittel gewinnt >= 70 % gegen Leicht (200 Spiele, 2 Personen, Startwechsel)', () => {
  const rng = seedRng(21); let w = 0; let l = 0; let d = 0; let worst = 0;
  for (let i = 0; i < 200; i++) {
    const first = i % 2 === 0;
    const r = play(first ? [1, 0] : [0, 1], rng); worst = Math.max(worst, r.worst);
    const sm = r.g.scores[first ? 'bot1' : 'bot2']; const sl = r.g.scores[first ? 'bot2' : 'bot1'];
    if (sm > sl) w++; else if (sm < sl) l++; else d++;
  }
  console.log(`Mittel gegen Leicht: ${w} Siege, ${l} Niederlagen, ${d} unentschieden von 200; langste Entscheidung ${worst.toFixed(1)} ms`);
  assert.ok(w / 200 >= 0.7, `nur ${w} Siege`);
  assert.ok(worst < 150, 'Rechenzeit ' + worst);
});

test('Mittel vs Mittel und Leicht vs Leicht sind ausgeglichen (keine Startperson-Verzerrung über 70 %)', () => {
  for (const lv of [0, 1]) {
    const rng = seedRng(30 + lv); let first = 0; let second = 0;
    for (let i = 0; i < 200; i++) {
      const r = play([lv, lv], rng);
      if (r.g.scores.bot1 > r.g.scores.bot2) first++; else if (r.g.scores.bot1 < r.g.scores.bot2) second++;
    }
    console.log(`Stufe ${lv} gegen sich selbst: Startperson ${first} Siege, andere ${second}`);
    assert.ok(first / (first + second) < 0.7 && second / (first + second) < 0.7);
  }
});

test('Alle Besetzungen (1 bis 3 Computer, alle Stufen) spielen komplett durch; Rechenzeit < 150 ms', () => {
  let worst = 0;
  for (const lv of [[0], [1], [0, 0], [1, 1], [0, 1, 0], [1, 0, 1], [1, 1, 1], [0, 0, 0]]) {
    for (let seed = 1; seed <= 12; seed++) { const r = play(lv, seedRng(seed * 7 + lv.length), seed % 2 ? {} : { kurz: true }); worst = Math.max(worst, r.worst); }
  }
  assert.ok(worst < 150, 'Rechenzeit ' + worst);
});

test('Zahlen: Mittel braucht allein im Schnitt wenige Fragen und rät fast immer richtig', () => {
  const rng = seedRng(41); let rounds = 0; let asked = 0; let right = 0; let wrong = 0;
  for (let i = 0; i < 60; i++) {
    const { g } = play([1], rng);
    for (const r of g.results) { rounds++; asked += r.asked; }
    right += g.stats.bot1.right; wrong += g.stats.bot1.wrong;
  }
  console.log(`Mittel allein: ${(asked / rounds).toFixed(2)} Fragen je Begriff, ${wrong} Fehlversuche bei ${rounds} Begriffen`);
  assert.ok(asked / rounds < 8, 'zu viele Fragen: ' + asked / rounds);
  assert.ok(wrong / rounds < 0.5, 'zu viele Fehlversuche');
});

test('Mittel fragt die Frage mit dem größten Informationsgewinn; rät erst bei höchstens 2 Möglichkeiten', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seedRng(seed);
    const g = E.createGame([{ id: 'bot1', name: 'C' }], {}, rng);
    let steps = 0;
    while (g.phase === 'ask' && steps++ < 30) {
      const c = candidates(g, 'bot1', 1);
      assert.ok(c.some((b) => b.id === E.secret(g).id), 'echter Begriff bleibt möglich');
      const m = chooseAction(g, 'bot1', 1, rng);
      if (c.length > GUESS_AT[1]) {
        assert.equal(m.t, 'ask');
        const free = FRAGEN.filter((f) => !g.asked.some((x) => x.q === f.id));
        const best = Math.max(...free.map((f) => gain(c, f.id)));
        assert.ok(Math.abs(gain(c, m.q) - best) < 1e-9, 'nicht die beste Frage');
        assert.ok(gain(c, m.q) > 0, 'Frage ohne Wirkung');
      } else assert.equal(m.t, 'guess');
      assert.ok(E.handle(g, 'bot1', m, rng).ok);
    }
  }
});

test('Leicht rät bei höchstens 4 Möglichkeiten (nach den Antworten, die er berücksichtigt)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seedRng(seed + 100);
    const g = E.createGame([{ id: 'bot1', name: 'C' }], {}, rng);
    let steps = 0;
    while (g.phase === 'ask' && steps++ < 80) {
      const c = candidates(g, 'bot1', 0);
      const m = chooseAction(g, 'bot1', 0, rng);
      if (c.length > GUESS_AT[0] && g.asked.length < FRAGEN.length) assert.equal(m.t, 'ask'); else assert.equal(m.t, 'guess');
      assert.ok(E.handle(g, 'bot1', m, rng).ok);
    }
  }
  assert.equal(GUESS_AT[0], 4); assert.equal(GUESS_AT[1], 2);
});

test('Fehlerrate beim Raten liegt bei etwa 10 %', () => {
  const rng = seedRng(5);
  const g = E.createGame([{ id: 'bot1', name: 'C' }], { fixed: ['hund'] }, rng);
  // alle Fragen stellen: genau ein Begriff bleibt übrig
  for (const f of FRAGEN) E.handle(g, 'bot1', { t: 'ask', q: f.id });
  assert.equal(candidates(g, 'bot1', 1).length, 1);
  let miss = 0; const N = 4000;
  for (let i = 0; i < N; i++) { const m = chooseAction(g, 'bot1', 1, rng); assert.equal(m.t, 'guess'); if (m.id !== 'hund') miss++; }
  console.log(`Fehlgriffe beim Raten: ${(100 * miss / N).toFixed(1)} %`);
  assert.ok(Math.abs(miss / N - SLIP) < 0.025, 'Quote ' + miss / N);
});

test('Kein Schummeln: ein anderer geheimer Begriff ändert keine Entscheidung (gleiche Antworten, gleicher Zufall)', () => {
  for (const level of [0, 1]) {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seedRng(seed);
      const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], {}, rng);
      let steps = 0;
      while (g.phase === 'ask' && steps++ < 60) {
        const who = g.players[g.turn].id;
        if (who === 'bot1') {
          const twin = JSON.parse(JSON.stringify(g));
          // alle geheimen Begriffe austauschen (andere Begriffe, auch in anderen Runden und Kategorien)
          twin.terms = twin.terms.map((t, i) => BEGRIFFE.filter((b) => b.k === twin.cats[i])[(seed * 3 + i * 5) % BEGRIFFE.filter((b) => b.k === twin.cats[i]).length].id);
          const s1 = seed * 1000 + steps;
          const m1 = chooseAction(g, who, level, seedRng(s1));
          const m2 = chooseAction(twin, who, level, seedRng(s1));
          assert.deepEqual(m1, m2, `Stufe ${level}, Partie ${seed}`);
          assert.ok(E.handle(g, who, m1, rng).ok);
        } else {
          // Mensch: stellt Fragen (erst viele, dann rät er richtig)
          const free = FRAGEN.filter((f) => !g.asked.some((x) => x.q === f.id));
          if (g.asked.length < 5 + (seed % 5) && free.length) E.handle(g, 'a', { t: 'ask', q: free[Math.floor(rng() * free.length)].id });
          else E.handle(g, 'a', { t: 'guess', id: E.secret(g).id });
        }
      }
    }
  }
});

test('Computer tut nichts, wenn er nicht dran ist, die Runde aufgelöst ist oder das Spiel nicht passt', () => {
  const rng = seedRng(3);
  const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], {}, rng);
  assert.equal(chooseAction(g, 'bot1', 1, rng), null);
  assert.equal(chooseAction(g, 'fremd', 1, rng), null);
  E.handle(g, 'a', { t: 'ask', q: 'leb' });
  const m = chooseAction(g, 'bot1', 1, rng);
  assert.equal(m.t, 'ask'); assert.equal(m.r, 0);
  assert.equal(chooseAction(null, 'bot1', 1, rng), null);
  assert.equal(chooseAction({ game: 'xx' }, 'bot1', 1, rng), null);
  E.handle(g, 'bot1', { t: 'guess', id: E.secret(g).id });
  assert.equal(g.phase, 'reveal');
  assert.equal(chooseAction(g, 'bot1', 1, rng), null);
});

test('Die Antworten, die der Computer berücksichtigt, sind eine Teilmenge der öffentlichen Antworten', () => {
  const rng = seedRng(8);
  const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], {}, rng);
  for (const q of ['leb', 'men', 'tie', 'sae', 'vb', 'fel']) E.handle(g, g.players[g.turn].id, { t: 'ask', q });
  // Mittel kennt alle, Leicht höchstens so viele
  assert.ok(candidates(g, 'bot1', 1).length <= candidates(g, 'bot1', 0).length);
  assert.ok(candidates(g, 'bot1', 0).some((b) => b.id === E.secret(g).id));
});
