import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../barrikade/engine.js';
import { chooseAction } from '../barrikade/ai.js';
import { coach } from '../barrikade/tutorial.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEL_OK = /^(\[data-act="[a-z-]+"\]|\.[a-z][a-z-]*)$/;
const EXPLAIN = {
  intro: /^Tippe auf Würfeln\. Die Zahl/, barrierIntro: /schwarzen Steine sind Sperren/, zugzwang: /musst du ziehen/, barrierReach: /erreichst du eine Sperre/,
  house: /zählt schon als erster Schritt/, capture: /fremde Figur\. Landest/, barrierTake: /liegt eine Sperre/, place: /Nur die unterste Reihe/, gotCaptured: /wurde hinausgeworfen/,
};

function checkOut(r, g) {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'));
  if (!r) return;
  assert.ok(r.text.length > 0 && r.text.length <= 200, 'Länge ' + r.text.length + ': ' + r.text);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(r.text), 'keine Emojis');
  if (r.target !== undefined) assert.match(r.target, SEL_OK);
  if (g && g.phase === 'move') for (const m of r.text.matchAll(/eine (\d) gewürfelt/g)) assert.equal(Number(m[1]), g.die);
  if (g && g.phase === 'move') for (const m of r.text.matchAll(/genau (\d+) Felder?/g)) assert.equal(Number(m[1]), g.die);
}

function playOnce(seed, maxSteps = 4000) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = E.createGame([{ id: 'me', name: 'Anna' }, { id: 'bot1', name: 'Computer' }]);
  const ui = { sel: null };
  const ctx = { id: 'me', S: {}, ui };
  const runs = {}, lastKind = {};
  let steps = 0, human = 0;
  const track = (r) => {
    for (const [k, re] of Object.entries(EXPLAIN)) {
      const on = !!(r && re.test(r.text));
      if (on && !lastKind[k]) runs[k] = (runs[k] || 0) + 1;
      lastKind[k] = on;
    }
  };
  while (g.phase !== 'over' && steps < maxSteps) {
    steps++;
    const ap = E.activePlayer(g);
    ui.sel = null;
    const r = coach(g, ctx);
    checkOut(r, g);
    track(r);
    if (ap.id === 'me') {
      human++;
      assert.ok(r && r.target, 'Ziel nötig, wenn der Mensch dran ist: ' + g.phase);
      if (g.phase === 'roll') { assert.equal(r.target, '[data-act="roll"]'); E.roll(g, 'me', dice); }
      else if (g.phase === 'move') {
        assert.equal(r.target, '[data-act="pick"]');
        const mv = E.legalMoves(g);
        const m = mv[Math.floor(brain() * mv.length)];
        ui.sel = m.piece;
        const r2 = coach(g, ctx);
        checkOut(r2, g); track(r2);
        assert.equal(r2.target, '[data-act="dest"]');
        const res = E.move(g, 'me', m.piece, m.to);
        assert.equal(res.ok, true);
      } else if (g.phase === 'place') {
        assert.equal(r.target, '[data-act="place"]');
        const t = E.placeTargets(g);
        assert.equal(E.place(g, 'me', t[Math.floor(brain() * t.length)]).ok, true);
      } else assert.fail('Phase ' + g.phase);
    } else {
      assert.ok(r && /Computer/.test(r.text) && !r.target, 'Computer dran: Text ohne Ziel');
      const msg = chooseAction(g, ap.id, 0, brain);
      assert.ok(msg);
      if (msg.t === 'roll') E.roll(g, ap.id, dice);
      else if (msg.t === 'move') assert.equal(E.move(g, ap.id, msg.piece, msg.to).ok, true);
      else assert.equal(E.place(g, ap.id, msg.node).ok, true);
    }
  }
  if (g.phase === 'over') {
    const end = coach(g, ctx);
    checkOut(end, g);
    assert.equal(end.target, '[data-act="again"]');
  }
  return { runs, human };
}

test('Barrikade-Lernrunde: Coach deckt jeden Zustand ab, erklärt nur einmal', () => {
  const total = {};
  for (let seed = 1; seed <= 12; seed++) {
    const { runs, human } = playOnce(seed);
    assert.ok(human > 20);
    for (const [k, n] of Object.entries(runs)) { assert.ok(n <= 1, `${k} ${n}x (Seed ${seed})`); total[k] = (total[k] || 0) + 1; }
  }
  for (const k of ['intro', 'barrierIntro', 'zugzwang', 'house', 'place']) assert.ok(total[k] > 0, k + ' kam nie vor');
  console.log('Erklärungen gesehen:', total);
});

test('Barrikade-Lernrunde: kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'bk' }, { game: 'bk', players: [], pieces: [] },
    { game: 'bk', players: [null], pieces: [null], phase: 'move' }, { game: 'bk', players: [{ id: 'me' }], pieces: [], phase: 'move', active: 0 }];
  const ctxs = [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 7, sel: 5 } }, { id: 'me', ui: {} }];
  for (const g of bad) for (const c of ctxs) {
    const r = coach(g, c);
    assert.ok(r === null || typeof r.text === 'string');
  }
  const g = E.createGame([{ id: 'me', name: 'A' }, { id: 'b', name: 'B' }]);
  for (const c of ctxs) checkOut(coach(g, c), g);
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});
