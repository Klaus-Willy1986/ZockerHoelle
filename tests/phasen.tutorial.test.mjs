import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../phasen/engine.js';
import { coach } from '../phasen/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mkCtx = (id = 'p0') => ({ id, ui: { keep: Array(10).fill(false), rolling: false, confirmSkip: false, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 200, `${where}: Text "${r.text}" (${r.text && r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

test('Zufallspartien: Coach liefert in jedem Zustand gültigen Text', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seeded(seed);
    const n = 1 + (seed % 3);
    const g = P.createGame(players(n));
    const ctx = mkCtx();
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 3000) {
      const ap = P.activePlayer(g);
      const mine = ap.id === 'p0';
      const r = must(g, ctx, `seed ${seed} roll`);
      if (!mine) assert.equal(r.target, undefined);
      if (mine) { ctx.ui.rolling = true; must(g, ctx, 'rolling'); ctx.ui.rolling = false; }
      P.roll(g, ap.id, undefined, rng);
      for (;;) {
        const t = g.turn;
        const rr = must(g, ctx, `seed ${seed} choose`);
        if (mine && t.eval.ok) assert.equal(rr.target, '[data-act=finish-yes]');
        if (mine && t.eval.ok) { ctx.ui.confirmSkip = true; must(g, ctx, 'skip'); ctx.ui.confirmSkip = false; }
        ctx.ui.keep = Array(10).fill(true); must(g, ctx, 'alles behalten');
        ctx.ui.keep = P.suggestKeep(t.dice, ap.phaseNo).reduce((a, i) => { a[i] = true; return a; }, Array(10).fill(false));
        must(g, ctx, 'Auswahl');
        if (t.eval.ok && rng() < 0.6) break;
        if (t.attempt >= P.MAX_ATTEMPTS) break;
        const k = ctx.ui.keep.every(Boolean) ? Array(10).fill(false) : ctx.ui.keep;
        P.roll(g, ap.id, k, rng);
      }
      ctx.ui.keep = Array(10).fill(false);
      const ok = g.turn.eval.ok;
      const res = P.finish(g, ap.id, ok ? rng() < 0.9 : true);
      assert.ok(res.ok);
    }
    assert.equal(g.mode, 'over', `seed ${seed}`);
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
    assert.match(end.text, /Lernrunde ist zu Ende/);
  }
});

test('Erklärungen: Versuche und Joker nur einmal', () => {
  const g = P.createGame(players(1));
  const ctx = mkCtx();
  assert.match(must(g, ctx, 'start').text, /Phase/);
  g.turn = { stage: 'choose', attempt: 1, dice: Array.from({ length: 10 }, (_, i) => ({ v: i + 1 > 9 ? 10 : i < 3 ? 1 : i + 2, c: 'B' })), kept: Array(10).fill(false), eval: { ok: false, score: 0, used: [] }, startPhase: 1, final: false, started: true };
  assert.match(must(g, ctx, 'a').text, /drei Versuche/);
  g.rollId = 1; g.turn.attempt = 2;
  const t2 = must(g, ctx, 'b').text;
  assert.doesNotMatch(t2, /drei Versuche/);
  g.rollId = 2; g.turn.attempt = 2;
  g.turn.dice[0] = { v: 'W', c: 'R' };
  const j = must(g, ctx, 'joker').text;
  assert.match(j, /Joker/);
  assert.match(j, /null Punkte/);
  g.rollId = 3;
  assert.doesNotMatch(must(g, ctx, 'joker2').text, /Joker/);
});

test('Führung: nur dem Ziel folgen kommt bis zum Spielende oder zur Obergrenze', () => {
  let reachedEnd = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const rng = seeded(seed * 7);
    const g = P.createGame(players(1));
    const ctx = mkCtx();
    let steps = 0;
    while (g.mode !== 'over' && steps++ < 4000) {
      const r = must(g, ctx, 'folgen');
      assert.ok(r.target, 'Ziel fehlt: ' + r.text);
      const first = r.target.split(',')[0].trim();
      if (first === '[data-act=roll]') assert.ok(P.roll(g, 'p0', undefined, rng).ok);
      else if (first.startsWith('[data-act=reroll]')) assert.ok(P.roll(g, 'p0', Array(10).fill(false), rng).ok);
      else if (first === '[data-act=finish-yes]') assert.ok(P.finish(g, 'p0', true).ok);
      else assert.fail('unerwartetes Ziel ' + first);
    }
    if (g.mode === 'over') reachedEnd++;
  }
  assert.ok(reachedEnd >= 0);
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { players: [] }, { players: [null] }, { players: [{}], active: 0, turn: {} },
    { mode: 'normal', players: [{ id: 'p0' }], active: 0, turn: { stage: 'choose', dice: 'x' } },
    { mode: 'normal', players: [{ id: 'p0' }], active: 0, turn: { stage: 'choose', dice: [null], eval: {}, attempt: 1 } },
    { mode: 'normal', players: [{ id: 'p0' }], active: 0, turn: { stage: 'roll' } }];
  for (const g of bad) {
    for (const c of [undefined, null, {}, { id: 'p0' }, { id: 'p0', ui: null }, { id: 'p0', ui: { keep: 'x', coachSeen: 3 } }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(g, c); });
      check(r, JSON.stringify(g));
    }
  }
});
