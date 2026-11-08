import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../backgammon/engine.js';
import { chooseAction } from '../backgammon/ai.js';
import { coach } from '../backgammon/tutorial.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEL_OK = /^(\[data-act="[a-z-]+"\]|\.[a-z][a-z-]*(\.[a-z][a-z-]*)?)$/;
// Erklärungen, die pro Partie nur ein einziges Mal (in einem Lauf gleicher Lage) vorkommen dürfen
const EXPLAIN = {
  intro: /^Ziel: Alle deine 15 Steine/,
  dice: /Jede Zahl ziehst du einzeln\. Tippe auf einen Stein von dir\. Dann siehst du/,
  double: /^Ein Pasch\./,
  hit: /Du kannst einen einzelnen Stein der anderen Seite schlagen/,
  bar: /Dein Stein auf der Bar muss zuerst wieder aufs Brett/,
  gotHit: /wurde geschlagen\. Er liegt jetzt auf der Bar/,
  bearAll: /Alle 15 Steine stehen im Heimfeld/,
  off: /^Ein Stein kann heraus\./,
  passMine: /^Du kannst nicht ziehen\. Mit diesem Wurf/,
};
const STRATEGY = /beste|klug|empfehl|solltest|am besten|Vorteil|Strategie|Falle|riskant|sicher/i;

function checkOut(r, g) {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'));
  if (!r) return;
  assert.ok(r.text.length > 0 && r.text.length <= 260, 'Länge ' + r.text.length + ': ' + r.text);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(r.text), 'keine Emojis');
  assert.ok(!STRATEGY.test(r.text), 'Strategie-Wort: ' + r.text);
  if (r.target !== undefined) assert.match(r.target, SEL_OK);
  // genannte Würfelzahlen müssen im Zustand stehen
  for (const m of r.text.matchAll(/Du hast (\d) und (\d) gewürfelt/g)) assert.deepEqual([Number(m[1]), Number(m[2])], g.lastRoll.dice);
}

function playOnce(seed) {
  const dice = seedRng(seed * 7 + 1); const brain = seedRng(seed * 13 + 5);
  const g = P.createGame([{ id: 'me', name: 'Anna' }, { id: 'bot1', name: 'Computer' }], { one: true, hints: true }, dice);
  const ui = {};
  const ctx = { id: 'me', S: {}, ui };
  const runs = {}; const last = {};
  let steps = 0; let humanStates = 0; let missingTarget = 0;
  while (g.mode === 'play' && steps < 20000) {
    steps++;
    const id = g.players[g.turn].id;
    const r = coach(g, ctx);
    checkOut(r, g);
    // Lauf zählen
    for (const [k, re] of Object.entries(EXPLAIN)) {
      const on = !!(r && re.test(r.text));
      if (on && !last[k]) runs[k] = (runs[k] || 0) + 1;
      last[k] = on;
    }
    if (id === 'me') {
      humanStates++;
      assert.ok(r, 'Coach-Text für den Menschen');
      if (!r.target) missingTarget++;
      // gleicher Zustand zweimal gefragt: gleicher Text (Zeichnen mehrmals pro Zug)
      const r2 = coach(g, ctx);
      assert.deepEqual(r2, r, 'wiederholtes Zeichnen: gleicher Text');
    } else assert.match(r.text, /Computer/);
    const msg = id === 'me'
      ? (g.stage === 'roll' ? { t: 'roll' } : seed % 2 ? chooseAction(g, 'me', 1, brain) : (() => { const ms = P.legalMoves(g); const m = ms[Math.floor(brain() * ms.length)]; ui.sel = Math.floor(brain() * 2) ? m.from : null; return { t: 'move', from: m.from, to: m.to, die: m.die }; })())
      : chooseAction(g, id, 1, brain);
    assert.equal(P.handle(g, id, msg, dice).ok, true);
  }
  checkOut(coach(g, ctx), g);
  const end = coach(g, ctx);
  assert.match(end.text, /Noch eine Runde/);
  assert.equal(end.target, '[data-act="next"]');
  return { runs, humanStates, missingTarget };
}

test('Coach über 80 Zufallspartien: sinnvolle Texte, Selektoren, jede Erklärung nur einmal, keine Strategie', () => {
  const total = {};
  let human = 0; let missing = 0;
  for (let n = 1; n <= 80; n++) {
    const r = playOnce(n);
    human += r.humanStates; missing += r.missingTarget;
    for (const [k, v] of Object.entries(r.runs)) {
      assert.ok(v <= 1, `Erklärung „${k}“ ${v}× in Partie ${n}`);
      total[k] = (total[k] || 0) + 1;
    }
  }
  console.log('Menschliche Zustände:', human, '· ohne Ziel:', missing, '· Erklärungen (Partien mit Treffer):', JSON.stringify(total));
  assert.equal(missing, 0, 'Mensch dran, aber kein Ziel');
  for (const k of ['intro', 'dice', 'hit', 'bar', 'bearAll', 'off', 'double']) assert.ok(total[k] >= 15, 'Erklärung kommt vor: ' + k);
});

test('Coach: Auswahl und Zielmarkierung (Quelle, Ziel, Zahlenwahl)', () => {
  const g = P.createGame([{ id: 'me', name: 'Anna' }, { id: 'bot1', name: 'Computer' }], { one: true, hints: true }, () => 0.3);
  const mkctx = (ui) => ({ id: 'me', S: {}, ui });
  const first = g.players[g.turn].id === 'me';
  assert.ok(first || true);
  // eigene Stellung erzwingen: Mensch zieht
  g.turn = 0; g.stage = 'move'; g.left = [3, 5]; g.lastRoll = { p: 0, dice: [3, 5], rollId: 1 };
  const ui = { coachSeen: {} };
  assert.equal(coach(g, mkctx(ui)).target, '.bg-pt.can');
  ui.sel = 13;
  assert.equal(coach(g, mkctx(ui)).target, '.bg-pt.tgt');
  ui.choice = { from: 2, to: 0, dice: [3, 5] };
  assert.equal(coach(g, mkctx(ui)).target, '[data-act="die"]');
});

test('Coach: kaputte Eingaben liefern null statt Fehler', () => {
  const g = P.createGame([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'C' }], {}, seedRng(1));
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'bgm' }, { game: 'bgm', players: [], board: [], left: [] }, { ...g, board: null }, { ...g, players: null }, { ...g, lastRoll: 'x' }, { ...g, left: null }];
  for (const b of bad) {
    for (const c of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'zz', ui: {} }, { id: 'me', ui: { sel: 'x', choice: 5, rolling: 1 } }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(b, c); });
      assert.ok(r === null || typeof r.text === 'string');
    }
  }
  // Würfel rollen
  const r = coach(g, { id: 'me', ui: { rolling: true } });
  assert.match(r.text, /Würfel rollen/);
  // Zuschauer (nicht in der Liste)
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});
