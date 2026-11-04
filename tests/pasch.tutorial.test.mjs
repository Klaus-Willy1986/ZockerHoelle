import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../pasch/engine.js';
import { coach } from '../pasch/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mkCtx = (id = 'p0') => ({ id, ui: { keep: Array(5).fill(false), pick: null, rolling: false, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 200, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

test('Zufallspartien: Coach liefert in jedem Zustand gültigen Text', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed);
    const n = 1 + (seed % 3);
    const g = P.createGame(players(n));
    const ctx = mkCtx();
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 2000) {
      const ap = P.activePlayer(g);
      const mine = ap.id === 'p0';
      const r = must(g, ctx, `seed ${seed}`);
      if (!mine) assert.equal(r.target, undefined);
      if (mine) {
        ctx.ui.rolling = true;
        assert.equal(must(g, ctx, 'rolling').text, 'Die Würfel rollen.');
        ctx.ui.rolling = false;
      }
      P.roll(g, ap.id, undefined, rng);
      must(g, ctx, 'nach Wurf 1');
      while (g.turn.rolls < P.MAX_ROLLS && rng() < 0.7) {
        ctx.ui.keep = Array.from({ length: 5 }, () => rng() < 0.5);
        must(g, ctx, 'Auswahl');
        ctx.ui.keep = Array(5).fill(true);
        must(g, ctx, 'alles behalten');
        ctx.ui.keep = Array.from({ length: 5 }, (_, i) => i > 0 && rng() < 0.5);
        P.roll(g, ap.id, ctx.ui.keep, rng);
      }
      ctx.ui.keep = Array(5).fill(false);
      const free = P.freeCats(ap.sheet);
      const cat = free[Math.floor(rng() * free.length)];
      ctx.ui.pick = cat;
      const rp = must(g, ctx, 'Bestätigung');
      if (mine) assert.equal(rp.target, '[data-act=pick-yes]');
      ctx.ui.pick = null;
      P.score(g, ap.id, cat);
    }
    assert.equal(g.mode, 'over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
    assert.match(end.text, /Lernrunde ist zu Ende/);
  }
});

test('Erklärungen kommen nur einmal', () => {
  const g = P.createGame(players(1));
  const ctx = mkCtx();
  assert.match(must(g, ctx, 'a').text, /Zettel/);
  assert.equal(must(g, ctx, 'a2').text.includes('Zettel'), true, 'bleibt im gleichen Zustand stehen');
  P.roll(g, 'p0', undefined, seeded(3));
  assert.match(must(g, ctx, 'b').text, /bis zu dreimal/);
  P.roll(g, 'p0', Array(5).fill(false), seeded(4));
  const second = must(g, ctx, 'c').text;
  assert.doesNotMatch(second, /bis zu dreimal/);
  assert.match(second, /Rechts bei jedem Feld/);
  P.roll(g, 'p0', Array(5).fill(false), seeded(5));
  assert.doesNotMatch(must(g, ctx, 'd').text, /Rechts bei jedem Feld/);
});

test('Bonus-Erklärung nur wenn erreichbar, und ohne Zahlen aus dem Nichts', () => {
  const g = P.createGame(players(1));
  const ctx = mkCtx();
  const p = g.players[0];
  p.sheet.ones = 3; p.sheet.twos = 6; p.sheet.threes = 9; p.sheet.fours = 12; p.sheet.fives = 15; // 45
  g.turn = { rolls: 3, dice: [6, 6, 6, 1, 2], kept: Array(5).fill(false) };
  const r = must(g, { ...ctx, ui: { ...ctx.ui, coachSeen: { fields: 99 } } }, 'bonus');
  assert.match(r.text, /63/);
  assert.match(r.text, /35/);
  g.turn.dice = [1, 1, 1, 1, 2];
  assert.doesNotMatch(must(g, mkCtx(), 'kein bonus').text, /Bonus/);
});

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt', () => {
  const rng = seeded(99);
  const g = P.createGame(players(1));
  const ctx = mkCtx();
  let steps = 0;
  while (g.mode !== 'over' && steps++ < 1000) {
    const r = must(g, ctx, 'folgen');
    const first = r.target.split(',')[0].trim();
    if (first === '[data-act=roll]') P.roll(g, 'p0', undefined, rng);
    else if (first.startsWith('[data-act=reroll]')) assert.ok(P.roll(g, 'p0', Array(5).fill(false), rng).ok);
    else if (first === '[data-act=pick]') { ctx.ui.pick = P.freeCats(g.players[0].sheet)[0]; }
    else if (first === '[data-act=pick-yes]') { const c = ctx.ui.pick; ctx.ui.pick = null; assert.ok(P.score(g, 'p0', c).ok); }
    else assert.fail('unerwartetes Ziel ' + first);
  }
  assert.equal(g.mode, 'over');
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { players: [] }, { players: [null] }, { players: [{}], active: 0, turn: {} },
    { mode: 'play', players: [{ id: 'p0', sheet: {} }], active: 0, turn: { rolls: 2, dice: 'x' } },
    { mode: 'play', players: [{ id: 'p0' }], active: 0, turn: { rolls: 1, dice: [1, 2, 3, 4, 5] } }];
  for (const g of bad) {
    for (const c of [undefined, null, {}, { id: 'p0' }, { id: 'p0', ui: null }, { id: 'p0', ui: { pick: 5, keep: 'x' } }, { id: 'p0', S: {}, ui: { pick: 'ones', keep: null, coachSeen: 3 } }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(g, c); });
      check(r, JSON.stringify(g));
    }
  }
});
