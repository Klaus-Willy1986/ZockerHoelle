import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../memo/engine.js';
import { chooseAction, memory } from '../memo/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// kind: 0 Leicht, 1 Mittel, 'z' reiner Zufall (deckt nur verdeckte Karten zufällig auf)
function play(kinds, rng, size = 'mittel') {
  const g = E.createGame(kinds.map((k, i) => ({ id: 'bot' + (i + 1), name: 'B' + i })), { size }, rng);
  let worst = 0; let n = 0;
  while (g.mode === 'play' && n++ < 5000) {
    const k = kinds[g.turn]; const id = g.players[g.turn].id;
    let msg;
    if (k === 'z') msg = g.pending ? { t: 'weiter' } : { t: 'flip', i: E.downIndices(g)[Math.floor(rng() * E.downCount(g))] };
    else { const t0 = performance.now(); msg = chooseAction(g, id, k, rng); worst = Math.max(worst, performance.now() - t0); }
    assert.ok(E.handle(g, id, msg, rng).ok, JSON.stringify(msg));
  }
  assert.equal(g.mode, 'over');
  return { g, worst };
}
function match(a, b, N, size, seed) {
  const rng = seedRng(seed); let wa = 0; let wb = 0; let d = 0; let worst = 0;
  for (let i = 0; i < N; i++) {
    const first = i % 2 === 0; // Startwechsel
    const r = play(first ? [a, b] : [b, a], rng, size); worst = Math.max(worst, r.worst);
    const [s0, s1] = r.g.scores; const sa = first ? s0 : s1; const sb = first ? s1 : s0;
    if (sa > sb) wa++; else if (sb > sa) wb++; else d++;
  }
  return { wa, wb, d, worst };
}

test('Mittel gewinnt >= 80 % gegen Leicht (4x4, Startwechsel, 200 Spiele)', () => {
  const r = match(1, 0, 200, 'mittel', 11);
  console.log('Mittel vs Leicht', JSON.stringify(r));
  assert.ok(r.wa / 200 >= 0.8, `nur ${r.wa} Siege`);
  assert.ok(r.worst < 20, 'Rechenzeit ' + r.worst);
});
test('Leicht schlägt reinen Zufall >= 60 % (Unentschieden zählen halb)', () => {
  const r = match(0, 'z', 400, 'mittel', 12);
  console.log('Leicht vs Zufall', JSON.stringify(r));
  assert.ok((r.wa + r.d / 2) / 400 >= 0.6, JSON.stringify(r));
  assert.ok(r.wa > 2 * r.wb, 'Siege deutlich vor Niederlagen');
});
test('Mittel schlägt Zufall fast immer; alle Größen und 2 bis 4 Computer laufen durch', () => {
  const r = match(1, 'z', 100, 'riesig', 13);
  assert.ok(r.wa >= 95, JSON.stringify(r));
  for (const size of E.SIZE_IDS) for (const k of [[1, 0, 1], [0, 1, 0, 1], [0, 0]]) play(k, seedRng(5), size);
});

test('Computer deckt nur verdeckte Karten auf, antwortet nur, wenn er dran ist, und tippt bei Kein-Paar auf Weiter', () => {
  const rng = seedRng(3);
  const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], { size: 'klein' }, rng);
  assert.equal(chooseAction(g, 'bot1', 1, rng), null);
  g.turn = 1;
  const m = chooseAction(g, 'bot1', 1, rng);
  assert.equal(m.t, 'flip'); assert.equal(g.st[m.i], 0);
  g.turn = 0; g.pending = true; g.open = [0, 1];
  g.turn = 1;
  assert.deepEqual(chooseAction(g, 'bot1', 0, rng), { t: 'weiter' });
});

test('Kein Schummeln: Änderung der nie aufgedeckten Bilder ändert keine Entscheidung', () => {
  for (const level of [0, 1]) {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seedRng(seed);
      const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], { size: 'mittel' }, rng);
      // Ein paar Züge zufällig spielen, dann an verschiedenen Stellen vergleichen
      let steps = 0;
      while (g.mode === 'play' && steps++ < 40) {
        const who = g.players[g.turn].id;
        if (who === 'bot1') {
          const everRevealed = new Set(g.reveals.map((r) => r.i));
          const twin = JSON.parse(JSON.stringify(g));
          twin.cards = twin.cards.map((c, i) => (everRevealed.has(i) ? c : 'GEFAELSCHT' + ((i * 7 + seed) % 5)));
          const s1 = seed * 1000 + steps;
          const m1 = chooseAction(g, who, level, seedRng(s1));
          const m2 = chooseAction(twin, who, level, seedRng(s1));
          assert.deepEqual(m1, m2, `Entscheidung hängt von verdeckten Bildern ab (Stufe ${level}, Seed ${seed}, Schritt ${steps})`);
          E.handle(g, who, m1, rng);
        } else if (g.pending) E.handle(g, who, { t: 'weiter' });
        else { const d = E.downIndices(g); E.handle(g, who, { t: 'flip', i: d[Math.floor(rng() * d.length)] }); }
      }
    }
  }
});

test('Gedächtnis: Leicht höchstens 2 Karten, Mittel nur Aufgedecktes, nie gefundene', () => {
  const rng = seedRng(9);
  const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], { size: 'mittel' }, rng);
  let n = 0;
  while (g.mode === 'play' && n++ < 200) {
    const who = g.players[g.turn].id;
    const easy = memory(g, 0); const mid = memory(g, 1);
    assert.ok(easy.length <= 2, 'Leicht merkt sich höchstens 2');
    const seen = new Set(g.reveals.map((r) => r.i));
    for (const k of [...easy, ...mid]) { assert.ok(seen.has(k.i)); assert.equal(g.st[k.i], 0); assert.equal(g.cards[k.i], k.c); }
    const a = chooseAction(g, who, 1, rng) || (g.pending ? { t: 'weiter' } : { t: 'flip', i: E.downIndices(g)[0] });
    E.handle(g, who, who === 'bot1' ? a : (g.pending ? { t: 'weiter' } : { t: 'flip', i: E.downIndices(g)[0] }), rng);
  }
});

test('Mittel nutzt bekannte Paare: frisch aufgedecktes, passendes Gegenstück wird genommen', () => {
  let used = 0; let tests = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seedRng(seed);
    const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], { size: 'klein' }, rng);
    // Mensch deckt zwei verschiedene Karten auf
    const d = E.downIndices(g); const i = d[0]; const j = d.find((x) => g.cards[x] !== g.cards[i]);
    E.flip(g, 'a', i); E.flip(g, 'a', j); E.weiter(g, 'a');
    // Computer deckt eine Karte auf, die zufällig zu i passt? Wir erzwingen: Computer-Zug mit offener Karte = Gegenstück von i
    const mate = g.cards.findIndex((c, x) => c === g.cards[i] && x !== i);
    E.flip(g, 'bot1', mate);
    const m = chooseAction(g, 'bot1', 1, rng);
    tests++;
    if (m.i === i) used++;
  }
  console.log(`Gegenstück genommen: ${used}/${tests}`);
  assert.ok(used / tests >= 0.9, 'Mittel nimmt bekanntes Gegenstück (vergisst nur selten)');
});
test('Rechenzeit pro Entscheidung klein', () => {
  const rng = seedRng(4);
  const g = E.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }], { size: 'riesig' }, rng);
  g.turn = 1;
  const t0 = performance.now();
  for (let k = 0; k < 1000; k++) chooseAction(g, 'bot1', 1, rng);
  assert.ok((performance.now() - t0) / 1000 < 1, 'unter 1 ms');
});
