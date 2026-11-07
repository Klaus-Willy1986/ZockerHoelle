import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../memo/engine.js';
import { chooseAction } from '../memo/ai.js';
import { coach } from '../memo/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>#-]+$/;
const mkG = (rng) => E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'Computer' }], { size: 'klein' }, rng);
const mkCtx = () => ({ id: 'me', ui: { coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}"`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  if (r.target) assert.ok(!/data-i|nth|card/.test(r.target), 'Ziel darf keine bestimmte Karte sein: ' + r.target);
  assert.ok(!/tippe (auf )?(diese|die) (linke|rechte|erste|obere|untere)|zeige mir|tipp:/i.test(r.text), 'keine Zugempfehlung');
}

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt (Computer spielt mit)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed);
    const g = mkG(rng); const ctx = mkCtx();
    let steps = 0; const texts = [];
    while (g.mode !== 'over' && steps++ < 3000) {
      const r = coach(g, ctx);
      assert.ok(r, 'immer ein Coach-Text');
      check(r, 'folgen');
      texts.push(r.text);
      if (g.turn === 1) { const m = chooseAction(g, 'bot1', 0, rng); assert.ok(E.handle(g, 'bot1', m).ok); assert.equal(r.target, undefined, 'Computer dran: kein Ziel'); continue; }
      assert.ok(r.target, 'Mensch dran: ein Ziel');
      if (r.target === '[data-act=weiter]') { assert.ok(g.pending); E.handle(g, 'me', { t: 'weiter' }); }
      else if (r.target === '#board') { assert.ok(!g.pending); const d = E.downIndices(g); assert.ok(E.handle(g, 'me', { t: 'flip', i: d[Math.floor(rng() * d.length)] }).ok); }
      else assert.fail('unerwartetes Ziel ' + r.target);
    }
    assert.equal(g.mode, 'over');
    const end = coach(g, ctx);
    assert.equal(end.target, '[data-act=again]'); assert.match(end.text, /Lernrunde ist zu Ende/);
  }
});

test('jede lange Erklärung kommt nur einmal (Wechsel zu einem anderen Text und zurück gibt es nicht)', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const rng = seeded(seed); const g = mkG(rng); const ctx = mkCtx();
    const entered = {}; let prev = null; let steps = 0;
    while (g.mode !== 'over' && steps++ < 3000) {
      const r = coach(g, ctx);
      if (r.text !== prev) { entered[r.text] = (entered[r.text] || 0) + 1; prev = r.text; }
      if (g.turn === 1) E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng));
      else if (g.pending) E.handle(g, 'me', { t: 'weiter' });
      else { const d = E.downIndices(g); E.handle(g, 'me', { t: 'flip', i: d[Math.floor(rng() * d.length)] }); }
    }
    const intro = Object.entries(entered).filter(([x]) => x.length > 70);
    assert.ok(intro.length >= 4, 'mehrere ausführliche Erklärungen: ' + intro.length);
    for (const [x, n] of intro) assert.equal(n, 1, 'mehrfach gezeigt: ' + x);
  }
});

test('Erklärungen im Einzelnen', () => {
  const rng = seeded(2); const g = mkG(rng); const ctx = mkCtx();
  assert.match(coach(g, ctx).text, /Willkommen/); assert.equal(coach(g, ctx).target, '#board');
  const d = E.downIndices(g); const i = d[0]; const j = d.find((x) => g.cards[x] !== g.cards[i]);
  E.flip(g, 'me', i);
  assert.match(coach(g, ctx).text, /zweite verdeckte Karte/);
  E.flip(g, 'me', j);
  const miss = coach(g, ctx); assert.match(miss.text, /kein Paar/); assert.equal(miss.target, '[data-act=weiter]');
  assert.equal(coach(g, ctx).text, miss.text, 'bleibt im selben Zustand stehen');
  E.weiter(g, 'me');
  assert.match(coach(g, ctx).text, /Computer dran/);
  E.handle(g, 'bot1', { t: 'flip', i: E.downIndices(g)[0] });
  assert.match(coach(g, ctx).text, /Computer dran/, 'bleibt im selben Zug stehen');
  assert.equal(coach(null, ctx), null); assert.equal(coach({}, ctx), null); assert.equal(coach(g, null), null);
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});
