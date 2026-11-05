import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../farbkarten/engine.js';
import { chooseAction, FORGET_CHANCE } from '../farbkarten/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (a, r) => a[Math.min(a.length - 1, Math.floor(r() * a.length))];

// Reiner Zufall: legt irgendeine erlaubte Karte, ruft immer
function randomMsg(g, rng) {
  if (g.stage === 'color') return { t: 'color', color: pick(E.COLORS, rng) };
  if (g.drawn) return { t: 'play', card: g.drawn, color: pick(E.COLORS, rng), call: true };
  const l = E.legalCards(g, g.active);
  if (!l.length) return { t: 'draw' };
  if (g.pending && rng() < 0.5) return { t: 'draw' };
  return { t: 'play', card: pick(l, rng), color: pick(E.COLORS, rng), call: true };
}

// kinds: Array aus 0 (Leicht), 1 (Mittel), 'rand'. Spielt eine Runde, gibt den Index des Rundensiegers zurück.
function playRound(kinds, seed, opts = {}) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = E.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'C' + i })), opts, dice);
  let steps = 0;
  while (g.mode === 'play' && steps < 8000) {
    steps++;
    const ap = E.activePlayer(g);
    const k = kinds[g.active];
    const msg = k === 'rand' ? randomMsg(g, brain) : chooseAction(g, ap.id, k, brain);
    assert.ok(msg, 'Aktion erwartet');
    const r = E.handle(g, ap.id, msg, dice);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.notEqual(g.mode, 'play', 'Runde endet');
  return g.roundWinner;
}

test('Mittel gegen Leicht (2 Personen, Plätze abwechselnd): >= 60 % der Runden', () => {
  const N = 1500; let mid = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [0, 1] : [1, 0];
    if (kinds[playRound(kinds, i + 1)] === 1) mid++;
  }
  console.log('Mittel gegen Leicht:', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N >= 0.6, 'Quote ' + mid / N);
});

test('Mittel gegen reinen Zufall (2 Personen): klar über 50 % (Kartenglück bleibt groß)', () => {
  const N = 1500; let mid = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? ['rand', 1] : [1, 'rand'];
    if (kinds[playRound(kinds, 1000 + i)] === 1) mid++;
  }
  console.log('Mittel gegen Zufall:', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N >= 0.58, 'Quote ' + mid / N);
});

test('Mittel gegen zwei Zufallsspieler (3 Personen): mehr als ein Drittel', () => {
  const N = 900; let mid = 0;
  for (let i = 0; i < N; i++) {
    const kinds = ['rand', 'rand', 'rand'];
    kinds[i % 3] = 1;
    if (kinds[playRound(kinds, 20000 + i)] === 1) mid++;
  }
  console.log('Mittel gegen 2 Zufall:', (100 * mid / N).toFixed(1) + ' %');
  assert.ok(mid / N > 0.38, 'Quote ' + mid / N);
});

test('Leicht gegen Zufall: keine Fehler, alle Runden enden', () => {
  let leicht = 0;
  const N = 400;
  for (let i = 0; i < N; i++) { const k = i % 2 ? ['rand', 0] : [0, 'rand']; if (k[playRound(k, 3000 + i)] === 0) leicht++; }
  console.log('Leicht gegen Zufall:', (100 * leicht / N).toFixed(1) + ' %');
});

test('3 bis 6 Personen gemischt, mit und ohne Optionen: alles gültig, alle Runden enden', () => {
  for (let n = 3; n <= 6; n++) {
    for (let i = 0; i < 40; i++) {
      const kinds = Array.from({ length: n }, (_, j) => [0, 1, 'rand'][(i + j) % 3]);
      playRound(kinds, 5000 + n * 100 + i, { stack: !!(i & 1), auto: !!(i & 2) });
    }
  }
});

test('Ganze Serien nur mit Computern enden (bis 500 Punkte)', () => {
  for (let i = 0; i < 12; i++) {
    const rng = seedRng(900 + i);
    const g = E.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }, { id: 'bot2', name: 'C' }], { stack: i % 2 === 0 }, rng);
    let steps = 0;
    while (g.mode !== 'over' && steps++ < 60000) {
      if (g.mode === 'round') { E.handle(g, 'bot0', { t: 'next' }, rng); continue; }
      const ap = E.activePlayer(g);
      const m = chooseAction(g, ap.id, g.active % 2, rng);
      assert.equal(E.handle(g, ap.id, m, rng).ok, true);
    }
    assert.equal(g.mode, 'over');
  }
});

test('Pflichten: ohne passende Karte ziehen, Joker nur wenn nötig (Mittel)', () => {
  const g = E.createGame([{ id: 'bot0', name: 'A' }, { id: 'p', name: 'B' }], {}, seedRng(1));
  g.discard = ['B1', 'R5']; g.color = 'R'; g.active = 0; g.stage = 'play'; g.pending = null; g.drawn = null;
  g.players[0].hand = ['G1', 'G2', 'Y3'];
  assert.deepEqual(chooseAction(g, 'bot0', 1, seedRng(2)), { t: 'draw' });
  assert.deepEqual(chooseAction(g, 'bot0', 0, seedRng(2)), { t: 'draw' });
  g.players[0].hand = ['W', 'R9', 'G2', 'Y3'];
  g.players[1].hand = ['G1', 'G2', 'G3', 'G4', 'G5'];
  for (let i = 0; i < 20; i++) assert.equal(chooseAction(g, 'bot0', 1, seedRng(i)).card, 'R9', 'Joker wird gespart');
  g.players[0].hand = ['W', 'G2', 'Y3'];
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(2)).card, 'W', 'nur Joker passt');
  g.players[0].hand = ['W', 'R9'];
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(2)).card, 'R9', 'Mit zwei Karten kommt die Zahl zuerst, der Joker bleibt für den Schluss');
});

test('Mittel wählt als Farbe die am häufigsten gehaltene und ruft immer', () => {
  const g = E.createGame([{ id: 'bot0', name: 'A' }, { id: 'p', name: 'B' }], {}, seedRng(1));
  g.discard = ['B1', 'R5']; g.color = 'R'; g.active = 0; g.stage = 'play';
  g.players[0].hand = ['W', 'G2', 'G3', 'G4', 'Y3'];
  g.players[1].hand = ['G1', 'G2', 'G3'];
  const m = chooseAction(g, 'bot0', 1, seedRng(2));
  assert.deepEqual(m, { t: 'play', card: 'W', color: 'G' });
  g.players[1].hand = ['G1'];
  g.players[0].hand = ['R9', 'R8'];
  g.players[1].hand = ['G1', 'G2', 'G3'];
  for (let i = 0; i < 30; i++) assert.equal(chooseAction(g, 'bot0', 1, seedRng(i)).call, true);
  // Startfarbe
  const s = E.createGame([{ id: 'bot0', name: 'A' }, { id: 'p', name: 'B' }], {}, seedRng(1));
  s.stage = 'color'; s.active = 0; s.players[0].hand = ['B1', 'B2', 'R1', 'G1'];
  assert.deepEqual(chooseAction(s, 'bot0', 1, seedRng(2)), { t: 'color', color: 'B' });
  assert.equal(E.COLORS.includes(chooseAction(s, 'bot0', 0, seedRng(2)).color), true);
});

test('Leicht vergisst den Ruf in etwa 15 % der Fälle', () => {
  const g = E.createGame([{ id: 'bot0', name: 'A' }, { id: 'p', name: 'B' }], {}, seedRng(1));
  g.discard = ['B1', 'R5']; g.color = 'R'; g.active = 0; g.stage = 'play';
  g.players[0].hand = ['R9', 'R8'];
  const rng = seedRng(77); let forgot = 0; const N = 4000;
  for (let i = 0; i < N; i++) if (chooseAction(g, 'bot0', 0, rng).call === false) forgot++;
  assert.ok(Math.abs(forgot / N - FORGET_CHANCE) < 0.03, 'Quote ' + forgot / N);
  // bei mehr Karten kein Ruf
  g.players[0].hand = ['R9', 'R8', 'R7'];
  assert.equal(chooseAction(g, 'bot0', 0, rng).call, undefined);
});

test('Weitergabe: Computer legt weiter oder zieht; gezogene Karte wird gelegt oder behalten', () => {
  const g = E.createGame([{ id: 'bot0', name: 'A' }, { id: 'p', name: 'B' }, { id: 'q', name: 'C' }], { stack: true }, seedRng(1));
  g.discard = ['B1', 'RZ']; g.color = 'R'; g.active = 0; g.stage = 'play'; g.pending = { kind: 'Z', n: 2 };
  g.players[0].hand = ['BZ', 'G2'];
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(2)).card, 'BZ');
  g.players[0].hand = ['G2', 'G3'];
  assert.deepEqual(chooseAction(g, 'bot0', 1, seedRng(2)), { t: 'draw' });
  g.pending = null; g.drawn = 'G3';
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(2)).card, 'G3');
});

test('null, wenn nicht am Zug oder Spiel vorbei; Rechenzeit trivial', () => {
  const g = E.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], {}, seedRng(4));
  assert.equal(chooseAction(g, 'me', 1), null);
  assert.equal(chooseAction(g, 'unbekannt', 0), null);
  assert.equal(chooseAction(null, 'bot1', 0), null);
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) chooseAction(g, 'bot1', 1);
  assert.ok(performance.now() - t0 < 300);
  g.mode = 'round';
  assert.equal(chooseAction(g, 'bot1', 1), null);
});
