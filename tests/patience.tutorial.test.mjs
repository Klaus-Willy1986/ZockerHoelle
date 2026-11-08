import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../patience/engine.js';
import { coach } from '../patience/tutorial.js';

const P = [{ id: 'p0', name: 'Du' }];
const c = E.mkCard;
const seededRng = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const T = (i, j) => ({ k: 't', i, j });
const ctxOf = () => ({ id: 'p0', ui: { sel: null, coachSeen: {} } });
const SELECTOR_OK = /^(\[data-(k|act)=[a-z]+\])(\[data-(i|j)="\d+"\])*$/;

function sources(g) {
  const out = [{ k: 'w' }];
  g.tab.forEach((col, i) => col.forEach((_, j) => out.push(T(i, j))));
  return out;
}

test('Coach: Lernrunde als Skript – jede Erklärung genau einmal, in Reihenfolge', () => {
  const g = E.learnGame(P);
  const ctx = ctxOf();
  const texts = [];
  const step = () => { const r = coach(g, ctx); assert.ok(r && r.text); if (r.target) assert.match(r.target, SELECTOR_OK); texts.push(r.text); return r; };
  let r = step(); assert.match(r.text, /sieben Spalten/);
  ctx.ui.sel = T(0, 1); r = step(); assert.match(r.text, /rot auf schwarz/);
  assert.equal(r.target, '[data-k=t][data-i="1"][data-j="0"]');
  assert.equal(E.handle(g, 'p0', { t: 'move', from: T(0, 1), to: { k: 't', i: 1 } }).ok, true); ctx.ui.sel = null;
  r = step(); assert.match(r.text, /aufgedeckt/); assert.equal(r.target, '[data-k=s]');
  E.handle(g, 'p0', { t: 'draw' });
  r = step(); assert.match(r.text, /Pik 9/); assert.equal(r.target, '[data-k=w]');
  ctx.ui.sel = { k: 'w' }; r = step(); assert.match(r.text, /Zielstapel/); assert.equal(r.target, '[data-k=f][data-i="1"]');
  E.handle(g, 'p0', { t: 'move', from: { k: 'w' }, to: { k: 'f' } }); ctx.ui.sel = null;
  r = step(); assert.match(r.text, /Zurück/); assert.equal(r.target, '[data-act=undo]');
  E.handle(g, 'p0', { t: 'undo' });
  r = step(); assert.match(r.text, /^Zurückgenommen/);
  E.handle(g, 'p0', { t: 'move', from: { k: 'w' }, to: { k: 'f' } });
  r = step(); assert.match(r.text, /Prima/);
  // Zurück wird nur einmal erklärt
  E.handle(g, 'p0', { t: 'undo' });
  E.handle(g, 'p0', { t: 'move', from: { k: 'w' }, to: { k: 'f' } });
  r = step(); assert.doesNotMatch(r.text, /Mit Zurück nimmst/);
  assert.equal(texts.filter((t) => /Mit Zurück nimmst/.test(t)).length, 1);
  assert.equal(texts.filter((t) => /sieben Spalten/.test(t)).length, 1);
  // Ende
  for (let k = 0; k < 100 && g.mode === 'play'; k++) {
    const src = sources(g).find((f) => E.legalMovesFrom(g, f).some((d) => d.k === 'f'));
    if (src) E.handle(g, 'p0', { t: 'move', from: src, to: { k: 'f' } }); else E.handle(g, 'p0', { t: 'draw' });
  }
  r = coach(g, ctx); assert.match(r.text, /Geschafft/); assert.equal(r.target, '[data-act=leave-now]');
});

test('Coach: keine Zugempfehlungen (keine Wörter wie "besser", "klug", "am besten")', () => {
  const g = E.learnGame(P);
  const ctx = ctxOf();
  const all = new Set();
  const rng = seededRng(7);
  for (let k = 0; k < 300 && g.mode === 'play'; k++) {
    for (const sel of [null, { k: 'w' }, T(0, 1), T(3, 0), { k: 'c', i: 0 }]) {
      ctx.ui.sel = sel;
      const r = coach(g, ctx);
      assert.ok(r && typeof r.text === 'string' && r.text.length > 5);
      if (r.target) assert.match(r.target, SELECTOR_OK);
      all.add(r.text);
    }
    ctx.ui.sel = null;
    const moves = [];
    for (const f of sources(g)) for (const to of E.legalMovesFrom(g, f)) moves.push([f, to]);
    if (moves.length && rng() < 0.8) { const m = moves[Math.floor(rng() * moves.length)]; E.handle(g, 'p0', { t: 'move', from: m[0], to: m[1] }); }
    else if (g.stock.length || g.waste.length) E.handle(g, 'p0', { t: 'draw' });
    if (rng() < 0.1) E.handle(g, 'p0', { t: 'undo' });
  }
  for (const t of all) assert.doesNotMatch(t, /am besten|besser|klug|empfehl|solltest|Tipp:/i, t);
});

test('Coach: kaputte Eingaben werfen nie', () => {
  const bad = [null, undefined, 5, 'x', [], {}, { tab: 1 }, { tab: [], found: 'a', stock: [] }, { tab: [[]], found: [0, 0, 0, 0], stock: [], waste: null, moves: 'x' }];
  for (const g of bad) for (const ctx of [undefined, null, {}, { ui: null }, { ui: { sel: 5 } }, { ui: { sel: { k: 'x' }, coachSeen: 3 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
  assert.equal(coach(null, null), null);
  // gewöhnliche Spiele (nicht Lernrunde) liefern trotzdem Text
  const g = E.createGame(P, {}, seededRng(3));
  const r = coach(g, ctxOf());
  assert.ok(r && r.text);
});
