import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../koffer/engine.js';
import { chooseAction, recallProb, surviveProb, thinkMs, MEMORY } from '../koffer/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bots = (n) => Array.from({ length: n }, (_, i) => ({ id: 'bot' + (i + 1), name: 'B' + i }));

// Ein Computer allein: Länge der Liste, bei der er scheitert (Alleinspiel-Regeln)
function soloLen(level, rng) {
  const g = E.createGame(bots(1), {}, rng);
  let worst = 0;
  for (let n = 0; n < 500 && g.mode === 'play'; n++) {
    if (g.phase === 'result') { assert.ok(E.handle(g, 'bot1', chooseAction(g, 'bot1', level, rng), rng).ok); continue; }
    const t0 = performance.now();
    const m = chooseAction(g, 'bot1', level, rng);
    worst = Math.max(worst, performance.now() - t0);
    assert.ok(E.handle(g, 'bot1', m, rng).ok, JSON.stringify(m));
  }
  assert.equal(g.mode, 'over');
  return { len: g.list.length, worst };
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

test('Leicht scheitert im Mittel (Median) bei Listenlänge 8 bis 12', () => {
  const rng = seedRng(101); const L = []; let worst = 0;
  for (let i = 0; i < 1500; i++) { const r = soloLen(0, rng); L.push(r.len); worst = Math.max(worst, r.worst); }
  const m = median(L); const mean = L.reduce((a, b) => a + b, 0) / L.length;
  console.log(`Leicht: Median ${m}, Mittelwert ${mean.toFixed(1)}, kürzeste ${Math.min(...L)}, längste ${Math.max(...L)}, langsamste Entscheidung ${worst.toFixed(2)} ms`);
  assert.ok(m >= 8 && m <= 12, 'Median ' + m);
  assert.ok(worst < 150);
});

test('Mittel scheitert im Mittel (Median) bei Listenlänge 14 bis 20', () => {
  const rng = seedRng(202); const L = []; let worst = 0;
  for (let i = 0; i < 1500; i++) { const r = soloLen(1, rng); L.push(r.len); worst = Math.max(worst, r.worst); }
  const m = median(L); const mean = L.reduce((a, b) => a + b, 0) / L.length;
  console.log(`Mittel: Median ${m}, Mittelwert ${mean.toFixed(1)}, kürzeste ${Math.min(...L)}, längste ${Math.max(...L)}, langsamste Entscheidung ${worst.toFixed(2)} ms`);
  assert.ok(m >= 14 && m <= 20, 'Median ' + m);
  assert.ok(worst < 150);
});

test('Mittel gewinnt mindestens 65 % gegen Leicht (Startwechsel)', () => {
  const rng = seedRng(303); let mid = 0; let easy = 0; const N = 1000;
  for (let i = 0; i < N; i++) {
    const midFirst = i % 2 === 0;
    const g = E.createGame(bots(2), {}, rng); // bot1 beginnt
    const level = (id) => ((id === 'bot1') === midFirst ? 1 : 0);
    for (let n = 0; n < 1000 && g.mode === 'play'; n++) {
      const id = g.phase === 'result' ? g.players[g.last.by].id : g.players[g.turn].id;
      assert.ok(E.handle(g, id, chooseAction(g, id, level(id), rng), rng).ok);
    }
    assert.equal(g.mode, 'over');
    const w = g.players.find((p) => !p.out).id;
    if (level(w) === 1) mid++; else easy++;
  }
  console.log(`Mittel gegen Leicht: ${mid} : ${easy} (${((100 * mid) / N).toFixed(1)} %)`);
  assert.ok(mid / N >= 0.65, 'Mittel gewinnt ' + mid / N);
});

test('Gedächtnis-Modell: Wahrscheinlichkeiten sinken mit der Position, Mittel besser als Leicht', () => {
  for (const lv of [0, 1]) {
    let prev = 1.0001;
    for (let k = 1; k <= 60; k++) { const p = recallProb(lv, k); assert.ok(p > 0 && p <= 1 && p <= prev, `Stufe ${lv} Platz ${k}`); prev = p; }
    assert.ok(surviveProb(lv, 1) > surviveProb(lv, 10) && surviveProb(lv, 10) > surviveProb(lv, 30));
  }
  for (const k of [1, 5, 10, 20, 40]) assert.ok(recallProb(1, k) >= recallProb(0, k));
  assert.equal(MEMORY.length, 2);
  assert.ok(surviveProb(0, 0) === 1);
});

test('Denkzeit: 0,25 s pro Ding, höchstens 4 s', () => {
  assert.equal(thinkMs(8), 2000); assert.equal(thinkMs(12), 3000); assert.equal(thinkMs(16), 4000);
  assert.equal(thinkMs(40), 4000); assert.ok(thinkMs(0) >= 900 && thinkMs(0) <= 1000);
});

test('Computer schummelt nicht: Entscheidung hängt nur von Liste (über die Engine), Angebot und Raster ab', () => {
  const rng = seedRng(404);
  const g = E.createGame(bots(3), {}, rng);
  while (g.list.length < 9) { const id = g.phase === 'result' ? g.players[g.last.by].id : g.players[g.turn].id; E.handle(g, id, g.phase === 'result' ? { t: 'weiter' } : { t: 'submit', seq: g.list.slice(), add: g.offer[0] }, rng); }
  while (g.phase === 'result') E.handle(g, g.players[g.last.by].id, { t: 'weiter' }, rng);
  const id = g.players[g.turn].id;
  let diffs = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const a = chooseAction(g, id, seed % 2, seedRng(seed));
    // Verändern, was nicht zur Entscheidung gehört: Raster-Reihenfolge, letzter Zug, Ergebnis, Mitspieler, Zähler
    const h = JSON.parse(JSON.stringify(g));
    h.grid.reverse(); h.last = { by: 99, ok: true, added: 'x' }; h.result = { length: 77 }; h.seq += 5; h.turnNo += 3; h.gid = 5; h.outCount = 3;
    h.players.forEach((p, i) => { if (p.id !== id) { p.lives = 0; p.ok = 50 + i; } });
    const b = chooseAction(h, id, seed % 2, seedRng(seed));
    assert.deepEqual(b.add, a.add, 'neues Ding hängt nur vom Angebot ab');
    assert.equal(b.seq.length, a.seq.length);
    const aOk = a.seq.every((x, i) => x === g.list[i]); const bOk = b.seq.every((x, i) => x === g.list[i]);
    assert.equal(aOk, bOk, 'richtig/falsch darf nicht vom übrigen Zustand abhängen');
    if (!aOk) assert.equal(a.seq.findIndex((x, i) => x !== g.list[i]), b.seq.findIndex((x, i) => x !== g.list[i]), 'Fehlerstelle gleich');
    if (a.seq.join() !== b.seq.join()) diffs++;
  }
  assert.ok(diffs >= 0);
  // Mensch, falsche Person, falsche Phase: keine Aktion
  assert.equal(chooseAction(g, 'p9', 0, rng), null);
  assert.equal(chooseAction(g, g.players[(g.turn + 1) % 3].id, 0, rng), null);
  assert.equal(chooseAction(null, 'bot1', 0, rng), null);
  assert.equal(chooseAction({}, 'bot1', 0, rng), null);
  const over = JSON.parse(JSON.stringify(g)); over.mode = 'over';
  assert.equal(chooseAction(over, id, 0, rng), null);
  // Ergebnisphase: nur der Computer, der gerade dran war, tippt Weiter
  const r = JSON.parse(JSON.stringify(g));
  E.handle(r, id, { t: 'submit', seq: r.list.slice(), add: r.offer[0] }, rng);
  assert.deepEqual(chooseAction(r, id, 0, rng), { t: 'weiter' });
  assert.equal(chooseAction(r, r.players[(r.turn + 1) % 3].id, 0, rng), null);
});

test('Computer ändert den Zustand nicht und liefert gültige Nachrichten (alle Größen, 300 Partien)', () => {
  const rng = seedRng(505);
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 5);
    const g = E.createGame(bots(n), { lives2: i % 3 === 0 }, rng);
    let steps = 0;
    while (g.mode === 'play' && steps++ < 3000) {
      const id = g.phase === 'result' ? g.players[g.last.by].id : g.players[g.turn].id;
      const before = JSON.stringify(g);
      const m = chooseAction(g, id, (i + steps) % 2, rng);
      assert.equal(JSON.stringify(g), before, 'chooseAction verändert den Zustand');
      assert.ok(m && (m.t === 'weiter' || m.t === 'submit'));
      assert.ok(E.handle(g, id, m, rng).ok, JSON.stringify(m));
    }
    assert.equal(g.mode, 'over');
  }
});
