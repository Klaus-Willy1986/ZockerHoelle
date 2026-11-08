import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../stichprophet/engine.js';
import { chooseAction, viewOf } from '../stichprophet/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'bot' + i, name: 'B' + i }));

// kinds: Stufe je Sitz (0 Leicht, 1 Mittel). Spielt ein ganzes Spiel. Rückgabe: Endpunkte je Sitz.
function playGame(kinds, seed, opts = {}, timing, hook) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(players(kinds.length), opts, deal, 'bot0');
  let steps = 0;
  while (g.phase !== 'over') {
    assert.ok(steps++ < 30000, 'Endlosschleife');
    if (g.phase === 'round_over') { assert.equal(M.handle(g, 'bot0', { t: 'next' }, deal).ok, true); continue; }
    const id = g.players[g.turn].id;
    const k = kinds[g.turn];
    const t0 = performance.now();
    const msg = chooseAction(g, id, k, brain);
    if (timing && k === 1) timing.push(performance.now() - t0);
    assert.ok(msg, 'Aktion erwartet');
    if (hook) hook(g, id, k, msg);
    const r = M.handle(g, id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  return g.players.map((p) => p.score);
}

test('Mittel erzielt höhere Gesamtpunktzahl als Leicht in >= 75 % der Spiele (100 kurze Spiele, 4 Personen, Sitzwechsel)', () => {
  let wins = 0, ties = 0;
  const timing = [];
  const N = 100;
  const base = [1, 0, 1, 0];
  for (let i = 0; i < N; i++) {
    const kinds = base.slice(i % 4).concat(base.slice(0, i % 4));
    const sc = playGame(kinds, 100 + i, { short: true }, timing);
    let a = 0, b = 0;
    kinds.forEach((k, j) => { if (k) a += sc[j]; else b += sc[j]; });
    if (a > b) wins++; else if (a === b) ties++;
  }
  const mx = Math.max(...timing);
  console.log(`Mittel vs Leicht: ${wins}/${N} Spiele gewonnen (${ties} gleich), längste Entscheidung ${mx.toFixed(1)} ms`);
  assert.ok(wins / N >= 0.75, 'Quote ' + wins / N);
  assert.ok(mx < 150, 'Rechenzeit ' + mx);
});

test('Mittel (1 gegen 3 Leicht) liegt im Schnitt klar vorn', () => {
  let better = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const kinds = [0, 0, 0, 0]; kinds[i % 4] = 1;
    const sc = playGame(kinds, 500 + i, { short: true });
    const others = sc.filter((_, j) => j !== i % 4);
    if (sc[i % 4] > others.reduce((a, b) => a + b, 0) / 3) better++;
  }
  console.log(`1 Mittel gegen 3 Leicht: über dem Schnitt der anderen in ${better}/${N}`);
  assert.ok(better / N >= 0.75, 'Quote ' + better / N);
});

test('Auch bei 3, 5 und 6 Personen: Mittel schlägt Leicht, alle Züge gültig', () => {
  for (const n of [3, 5, 6]) {
    let wins = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const kinds = Array.from({ length: n }, (_, j) => ((j + i) % 2 ? 1 : 0));
      if (!kinds.includes(0) || !kinds.includes(1)) kinds[0] = 1 - kinds[1];
      const sc = playGame(kinds, 900 + n * 50 + i, { short: true, lastNotEqual: i % 2 === 0 });
      const m = kinds.map((k, j) => (k ? sc[j] : null)).filter((x) => x !== null);
      const l = kinds.map((k, j) => (k ? null : sc[j])).filter((x) => x !== null);
      if (m.reduce((a, b) => a + b, 0) / m.length > l.reduce((a, b) => a + b, 0) / l.length) wins++;
    }
    console.log(`${n} Personen: Mittel vorn in ${wins}/${N}`);
    assert.ok(wins / N >= 0.6, `n=${n}: ${wins}/${N}`);
  }
});

test('Rechenzeit < 150 ms im ungünstigsten Fall (3 Personen Runde 20, 6 Personen Runde 10, 4 Personen Runde 15)', () => {
  for (const [n, r] of [[3, 20], [6, 10], [4, 15], [5, 12]]) {
    const rng = seedRng(n * 31 + r);
    const g = M.createGame(players(n), {}, rng, 'bot0');
    // schnell bis zur letzten Runde (Zufall)
    while (g.round < r || g.phase === 'round_over') {
      if (g.phase === 'round_over') { M.handle(g, 'bot0', { t: 'next' }, rng); continue; }
      const id = g.players[g.turn].id;
      if (g.phase === 'trump') M.handle(g, id, { t: 'trump', suit: 0 });
      else if (g.phase === 'bid') M.handle(g, id, { t: 'bid', n: 0 });
      else { const l = M.legalCards(g, id); M.handle(g, id, { t: 'play', card: l[0] }); }
    }
    assert.equal(g.round, r);
    let mx = 0;
    // Trumpf (falls nötig), alle Ansagen, die ersten Spielzüge
    let guard = 0;
    while (g.phase !== 'round_over' && g.phase !== 'over' && guard++ < 400) {
      const id = g.players[g.turn].id;
      const t0 = performance.now();
      const msg = chooseAction(g, id, 1, rng);
      mx = Math.max(mx, performance.now() - t0);
      assert.equal(M.handle(g, id, msg, rng).ok, true);
    }
    console.log(`n=${n}, Runde ${r}: längste Entscheidung ${mx.toFixed(1)} ms`);
    assert.ok(mx < 150, `n=${n} r=${r}: ${mx} ms`);
  }
});

test('KI schummelt nicht: verändertes verdecktes Zustand (fremde Hände, Rest) ergibt dieselbe Entscheidung', () => {
  let compared = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const n = 3 + (seed % 4);
    const rng = seedRng(seed);
    const g = M.createGame(players(n), { lastNotEqual: seed % 2 === 0 }, rng, 'bot0');
    // zu einer zufälligen Runde/Lage spielen
    const stopAt = 1 + Math.floor(rng() * 40);
    for (let s = 0; s < stopAt && g.phase !== 'over'; s++) {
      if (g.phase === 'round_over') { M.handle(g, 'bot0', { t: 'next' }, rng); continue; }
      const id = g.players[g.turn].id;
      M.handle(g, id, chooseAction(g, id, 0, rng), rng);
    }
    if (g.phase !== 'trump' && g.phase !== 'bid' && g.phase !== 'play') continue;
    const id = g.players[g.turn].id;
    const me = g.turn;
    for (const level of [0, 1]) {
      const a = chooseAction(g, id, level, seedRng(seed + 77));
      // Welt verändern: alle unbekannten Karten (fremde Hände) neu mischen, Handgrößen bleiben
      const h = JSON.parse(JSON.stringify(g));
      const pool = [];
      h.players.forEach((p, i) => { if (i !== me) pool.push(...p.hand); });
      const r2 = seedRng(seed * 3 + 11);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      let k = 0;
      h.players.forEach((p, i) => { if (i !== me) { p.hand = pool.slice(k, k + p.hand.length); k += p.hand.length; } });
      const changed = JSON.stringify(h.players.map((p) => p.hand)) !== JSON.stringify(g.players.map((p) => p.hand));
      const b = chooseAction(h, id, level, seedRng(seed + 77));
      assert.deepEqual(b, a, `Seed ${seed} Stufe ${level}: Entscheidung hängt von fremden Händen ab`);
      if (changed) compared++;
      // Die Sicht enthält fremde Hände nie als Inhalt
      const v = viewOf(g, id);
      assert.ok(!('hands' in v));
      v.sizes.forEach((s, i) => assert.equal(typeof s, 'number', `Größe ${i}`));
      const vj = JSON.stringify(v);
      for (let i = 0; i < n; i++) if (i !== me) for (const c of g.players[i].hand) {
        // Karte darf nur im Pool "unknown" stehen, nicht als Hand
        assert.ok(v.unknown.includes(c), 'Fremdkarte gehört in den unbekannten Pool');
      }
      assert.ok(vj.length > 0);
    }
  }
  console.log('Vergleiche mit veränderter Welt:', compared);
  assert.ok(compared > 20);
});

test('Wizard-Trumpfwahl und Ansagen gültig (auch mit „Der Letzte darf nicht ausgleichen“)', () => {
  let trumps = 0, forbiddenSeen = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const n = 3 + (seed % 4);
    const rng = seedRng(seed);
    const g = M.createGame(players(n), { lastNotEqual: true }, rng, 'bot0');
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 4000) {
      if (g.phase === 'round_over') { M.handle(g, 'bot0', { t: 'next' }, rng); continue; }
      const id = g.players[g.turn].id;
      const level = g.turn % 2;
      const f = M.forbiddenBid(g, id);
      const msg = chooseAction(g, id, level, rng);
      if (g.phase === 'trump') { assert.equal(msg.t, 'trump'); trumps++; }
      if (f !== null) { forbiddenSeen++; assert.notEqual(msg.n, f); }
      assert.equal(M.handle(g, id, msg, rng).ok, true, JSON.stringify(msg));
    }
    assert.equal(g.phase, 'over');
  }
  console.log('Trumpfwahlen:', trumps, 'Verbotene Ansagen vermieden:', forbiddenSeen);
  assert.ok(trumps > 0 && forbiddenSeen > 0);
});

test('chooseAction gibt null, wenn die KI nicht dran ist oder das Spiel nicht läuft', () => {
  const g = M.createGame(players(3), { dealer: 2 }, seedRng(1), 'bot0');
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(1)), null);
  assert.equal(chooseAction(g, 'unbekannt', 1, seedRng(1)), null);
  assert.equal(chooseAction(null, 'bot0', 1), null);
  assert.equal(chooseAction({ game: 'x' }, 'bot0', 1), null);
  g.phase = 'round_over';
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(1)), null);
});
