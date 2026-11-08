import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../minenfeld/engine.js';
import { coach } from '../minenfeld/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const P = [{ id: 'p0', name: 'Du' }];
const mk = () => E.createGame(P, { learn: true }, seeded(1));
const mkCtx = () => ({ id: 'p0', ui: { flagMode: false, note: '', coachSeen: {} } });
const rev = (g, i) => E.handle(g, 'p0', { t: 'reveal', i, now: 1000 });
const flag = (g, i) => E.handle(g, 'p0', { t: 'flag', i });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 130, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“"]/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => { const r = coach(g, ctx); assert.ok(r, `${where}: kein Coach`); check(r, where); return r; };

test('Lösungsweg: jeder Schritt hat einen eigenen Text, jede Erklärung nur einmal, Spiel endet mit Sieg', () => {
  const g = mk();
  const ctx = mkCtx();
  const seen = [];
  const step = (r) => { assert.ok(!seen.includes(r.text), `Text wiederholt: ${r.text}`); seen.push(r.text); };
  let r = must(g, ctx, 'Start'); step(r);
  assert.equal(r.target, '[data-act=cell][data-i="0"]');
  rev(g, 0);
  r = must(g, ctx, 'nach Flut'); step(r);
  assert.equal(r.target, '[data-act=mode][data-mode=flag]');
  ctx.ui.flagMode = true;
  r = must(g, ctx, 'Flaggenmodus'); step(r);
  assert.equal(r.target, '[data-act=cell][data-i="14"]');
  assert.equal(g.mine[14], 1);
  flag(g, 14);
  r = must(g, ctx, 'Flagge steht'); step(r);
  assert.equal(r.target, '[data-act=mode][data-mode=reveal]');
  ctx.ui.flagMode = false;
  r = must(g, ctx, 'Chord'); step(r);
  assert.equal(r.target, '[data-act=cell][data-i="13"]');
  rev(g, 13);
  assert.equal(g.mode, 'won');
  r = must(g, ctx, 'Ende'); step(r);
  assert.equal(r.target, '[data-act=again]');
  assert.equal(seen.length, 6);
});

test('Verloren in der Lernrunde: Nochmal-Knopf, danach geht es weiter', () => {
  const g = mk();
  const ctx = mkCtx();
  rev(g, 20);
  assert.equal(g.mode, 'lost');
  assert.equal(must(g, ctx, 'verloren').target, '[data-act=retry]');
  E.handle(g, 'p0', { t: 'retry', now: 2000 });
  assert.equal(must(g, ctx, 'nach Nochmal').target, '[data-act=mode][data-mode=flag]');
});

test('Falsche Flagge: Coach sagt, wie sie verschwindet', () => {
  const g = mk();
  const ctx = mkCtx();
  rev(g, 0);
  flag(g, 19); // keine Mine
  let r = must(g, ctx, 'falsch');
  assert.equal(r.target, '[data-act=mode][data-mode=flag]');
  ctx.ui.flagMode = true;
  r = must(g, ctx, 'falsch im Modus');
  assert.equal(r.target, '[data-act=cell][data-i="19"]');
  flag(g, 19);
  assert.equal(must(g, ctx, 'weg').target, '[data-act=cell][data-i="14"]');
});

test('Zufällige Lernrunden: Coach liefert immer gültigen Text/Selektor, endet nie mit Fehler', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = seeded(seed);
    const g = mk();
    const ctx = mkCtx();
    let guard = 0;
    while (g.mode === 'play' && guard++ < 200) {
      must(g, ctx, `seed ${seed}`);
      const i = Math.floor(rng() * 25);
      if (rng() < 0.3) { ctx.ui.flagMode = !ctx.ui.flagMode; continue; }
      if (ctx.ui.flagMode) flag(g, i); else rev(g, i);
    }
    must(g, ctx, `Ende ${seed}`);
  }
});

test('Kaputte Eingaben: nie eine Ausnahme', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { open: 1 }, { w: 5, h: 5, open: [], flag: [], mine: [] }, { w: 5, h: 5, open: [0], flag: [0], mine: null }, E.createGame(P, {}, Math.random)];
  for (const g of junk) for (const c of [undefined, null, {}, { ui: null }, { ui: 5 }, mkCtx()]) {
    const r = coach(g, c);
    assert.ok(r === null || typeof r.text === 'string');
  }
});

test('Normales Spiel: keine Anleitung (null), keine Hinweise auf Minen', () => {
  for (const o of [{}, { mid: true }, { hard: true }]) {
    const g = E.createGame(P, o, seeded(3));
    assert.equal(coach(g, mkCtx()), null);
    E.handle(g, 'p0', { t: 'reveal', i: 30, now: 5 });
    assert.equal(coach(g, mkCtx()), null);
  }
});
