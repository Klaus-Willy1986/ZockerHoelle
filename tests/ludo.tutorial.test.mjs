import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../ludo/engine.js';
import { chooseAction } from '../ludo/ai.js';
import { coach } from '../ludo/tutorial.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEL_OK = /^(\[data-act="[a-z-]+"\]|\.[a-z][a-z-]*)$/;
const EXPLAIN = { six: /^Eine 6\./, capture: /rauswerfen\. Landest|hinausgeworfen und muss zurück ins Haus\. Tippe/, goal: /in die Zielgerade ziehen/, bonus: /Deshalb darfst du noch einmal/, intro: /noch keine Figur auf dem Brett\. Du darfst bis zu/, gotCaptured: /wurde rausgeworfen/ };

function checkOut(r, g) {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'));
  if (!r) return;
  assert.ok(r.text.length > 0 && r.text.length <= 200, 'Länge ' + r.text.length + ': ' + r.text);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(r.text), 'keine Emojis');
  if (r.target !== undefined) assert.match(r.target, SEL_OK);
  // genannte Zahlen müssen im Zustand stehen
  if (g && g.turn && g.turn.stage === 'move') for (const m of r.text.matchAll(/eine (\d) gewürfelt/g)) assert.equal(Number(m[1]), g.turn.die);
}

function playOnce(seed) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = L.createGame([{ id: 'me', name: 'Anna' }, { id: 'bot1', name: 'Computer' }], seedRng(seed));
  const ui = {};
  const ctx = { id: 'me', S: {}, ui };
  const runs = {}; // Text-Läufe pro Erklärung
  const lastKind = {};
  let steps = 0, humanStates = 0, targetFails = 0;
  while (g.mode === 'play' && steps < 20000) {
    steps++;
    const ap = L.activePlayer(g);
    const r = coach(g, ctx);
    checkOut(r, g);
    // Lauf zählen
    for (const [k, re] of Object.entries(EXPLAIN)) {
      const on = !!(r && re.test(r.text));
      if (on && !lastKind[k]) runs[k] = (runs[k] || 0) + 1;
      lastKind[k] = on;
    }
    let msg;
    if (ap.id === 'me') {
      humanStates++;
      assert.ok(r && r.text, 'Coach braucht Text, wenn der Mensch dran ist');
      assert.ok(r.target, 'Coach braucht Ziel, wenn der Mensch dran ist');
      if (g.turn.stage === 'roll') { assert.equal(r.target, '[data-act="roll"]'); msg = { t: 'roll' }; }
      else { assert.equal(r.target, '.lu-can'); msg = { t: 'move', piece: g.turn.movable[Math.floor(brain() * g.turn.movable.length)] }; }
    } else {
      assert.ok(r && /Computer/.test(r.text) && !r.target, 'Computer dran: Text ohne Ziel');
      msg = chooseAction(g, ap.id, 0, brain);
    }
    const res = L.handle(g, ap.id, msg, dice);
    assert.equal(res.ok, true);
  }
  assert.equal(g.mode, 'over');
  const end = coach(g, ctx);
  checkOut(end, g);
  assert.equal(end.target, '[data-act="again"]');
  return { runs, humanStates, ui };
}

test('Ludo-Lernrunde: Coach deckt jeden Zustand ab, erklärt nur einmal', () => {
  const total = {};
  for (let seed = 1; seed <= 40; seed++) {
    const { runs, humanStates } = playOnce(seed);
    assert.ok(humanStates > 10);
    for (const [k, n] of Object.entries(runs)) { assert.ok(n <= 1, `${k} ${n}x (Seed ${seed})`); total[k] = (total[k] || 0) + 1; }
  }
  for (const k of ['six', 'capture', 'goal', 'bonus', 'intro', 'gotCaptured']) assert.ok(total[k] > 0, k + ' kam nie vor');
});

test('Ludo-Lernrunde: kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'ludo' }, { game: 'ludo', players: [], turn: {} },
    { game: 'ludo', players: [null], turn: { stage: 'move', movable: null } }, { game: 'ludo', players: [{ id: 'me', pieces: 5 }], turn: { stage: 'move' }, active: 3 }];
  const ctxs = [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 7 } }, { id: 'me', ui: {} }];
  for (const g of bad) for (const c of ctxs) {
    const r = coach(g, c);
    assert.ok(r === null || typeof r.text === 'string');
  }
  const g = L.createGame([{ id: 'me', name: 'A' }, { id: 'b', name: 'B' }], seedRng(1));
  for (const c of ctxs) checkOut(coach(g, c), g);
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});

test('Ludo-Lernrunde: Beispiele', () => {
  const g = L.createGame([{ id: 'me', name: 'A' }, { id: 'b', name: 'B' }], seedRng(1));
  const ui = {};
  assert.match(coach(g, { id: 'me', ui }).text, /bis zu 3 mal/);
  g.turn.rolls = 1; g.last = { kind: 'nomove', pid: 'me', again: true, rollId: 1 };
  assert.match(coach(g, { id: 'me', ui }).text, /Versuch 2 von 3/);
  assert.match(coach(g, { id: 'me', ui: { rolling: true } }).text, /rollt/);
});
