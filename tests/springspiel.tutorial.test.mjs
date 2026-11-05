import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../springspiel/engine.js';
import { coach } from '../springspiel/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = () => ({ id: 'p0', ui: { sel: null, confirm: null, note: '', coachSeen: {} } });
const mk = (shape = 'eng') => E.createGame([{ id: 'p0', name: 'Du' }], shape);

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 90, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => { const r = coach(g, ctx); assert.ok(r, `${where}: kein Coach`); check(r, where); return r; };

test('Start: erster Zug steht fest und zeigt auf den unteren Stein', () => {
  for (const sh of E.SHAPES) {
    const g = mk(sh);
    const ctx = mkCtx();
    const r = must(g, ctx, 'Start');
    assert.equal(r.target, '.sp-hit[data-i="38"]');
    assert.ok(E.movesFrom(g, 38).length === 1);
    ctx.ui.sel = 38;
    assert.equal(must(g, ctx, 'gewählt').target, '.sp-hit[data-hint=target]');
    ctx.ui.sel = 10; // anderer, ebenfalls erlaubter Stein
    assert.equal(must(g, ctx, 'anderer Stein').target, '.sp-hit[data-hint=target]');
    ctx.ui.sel = 0; // Unsinn
    assert.equal(must(g, ctx, 'Unsinn').target, '.sp-hit[data-i="38"]');
  }
});

test('Zufallspartien: Coach liefert in jedem Zustand gültigen Text und nennt nie einen bestimmten klugen Zug', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const g = mk(seed % 4 === 0 ? 'fra' : 'eng');
    const ctx = mkCtx();
    let guard = 0;
    const texts = new Set();
    while (g.mode !== 'over' && guard++ < 100) {
      const r = must(g, ctx, `seed ${seed} Zug ${g.moves.length}`);
      texts.add(r.text);
      if (g.moves.length > 0) assert.ok(!r.target.includes('data-i='), 'nach dem ersten Zug nie ein einzelner Stein');
      const movable = E.movableStones(g);
      ctx.ui.sel = movable[Math.floor(rng() * movable.length)];
      must(g, ctx, 'gewählt');
      const ms = E.movesFrom(g, ctx.ui.sel);
      const m = ms[Math.floor(rng() * ms.length)];
      // gelegentlich zurücknehmen
      if (g.moves.length >= 3 && rng() < 0.2) { ctx.ui.sel = null; E.undo(g, 'p0'); must(g, ctx, 'nach Rückgängig'); continue; }
      E.move(g, 'p0', m.from, m.to);
      ctx.ui.sel = null;
    }
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
    assert.match(end.text, /Lernrunde ist zu Ende/);
  }
});

test('Rückgängig wird bei Zug 3 einmal vorgestellt', () => {
  const g = mk();
  const ctx = mkCtx();
  const play = () => { const m = E.allMoves(g)[0]; E.move(g, 'p0', m.from, m.to); };
  play(); play();
  assert.notEqual(must(g, ctx, 'Zug 2').target, '[data-act=undo]');
  play();
  const r = must(g, ctx, 'Zug 3');
  assert.equal(r.target, '[data-act=undo]');
  assert.match(r.text, /Rückgängig/);
  // gleicher Zustand: gleicher Text
  assert.equal(must(g, ctx, 'Zug 3 nochmal').text, r.text);
  E.undo(g, 'p0');
  const after = must(g, ctx, 'nach Rückgängig');
  assert.match(after.text, /zurückgenommen/);
  assert.equal(after.target, '.sp-hit[data-hint=can]');
  play();
  assert.notEqual(must(g, ctx, 'wieder Zug 3').target, '[data-act=undo]');
  // Wer weiterspielt, ohne es auszuprobieren, bekommt es nicht mehr
  const g2 = mk(); const c2 = mkCtx();
  const play2 = () => { const m = E.allMoves(g2)[0]; E.move(g2, 'p0', m.from, m.to); };
  play2(); play2(); play2(); must(g2, c2, 'Zug 3'); play2();
  assert.notEqual(must(g2, c2, 'Zug 4').target, '[data-act=undo]');
});

test('Kaputte Eingaben ergeben null und werfen nicht', () => {
  for (const g of [null, undefined, {}, [], 'x', 5, { board: 'x' }, { board: [], moves: 'x' }]) {
    for (const ctx of [undefined, null, {}, { ui: null }, { ui: 'x' }, mkCtx()]) {
      assert.doesNotThrow(() => coach(g, ctx));
      assert.equal(coach(g, ctx), null);
    }
  }
  const g = mk();
  for (const ctx of [undefined, null, {}, { ui: null }, { ui: { sel: 'x', coachSeen: 5 } }, { ui: { sel: NaN } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
    check(coach(g, ctx), 'kaputter Kontext');
  }
});
