import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../kreuzwort/engine.js';
import { coach, LEARN_PUZZLE } from '../kreuzwort/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const P = [{ id: 'p0', name: 'Du' }];
const mkCtx = () => ({ id: 'p0', ui: { sel: -1, dir: 'h', msg: null, newPanel: false, coachSeen: {} } });
const learn = () => E.createGame(P, { learn: true, puzzle: LEARN_PUZZLE });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

// Dieselbe Bedienlogik wie in app.js (Tippen auf Feld, Taste, Hilfen)
const tapCell = (g, ui, i) => {
  const h = E.wordAt(g, i, 'h'), v = E.wordAt(g, i, 'v');
  if (ui.sel === i && h && v) ui.dir = ui.dir === 'h' ? 'v' : 'h';
  else if (!(ui.dir === 'h' ? h : v)) ui.dir = h ? 'h' : 'v';
  ui.sel = i;
};
const advance = (g, ui) => {
  const w = E.wordAt(g, ui.sel, ui.dir);
  if (!w || g.mode !== 'play') return;
  const cells = E.wordCells(g, w);
  const k = cells.indexOf(ui.sel);
  let j = -1;
  for (let x = k + 1; x < cells.length; x++) if (g.cells[cells[x]] === '') { j = x; break; }
  if (j < 0 && k + 1 < cells.length) j = k + 1;
  if (j >= 0) ui.sel = cells[j];
};
function follow(g, ui, r) {
  const t = r.target;
  let m;
  if ((m = /\[data-act=cell\]\[data-i="(\d+)"\]/.exec(t))) { tapCell(g, ui, Number(m[1])); return 'cell'; }
  if ((m = /\[data-act=key\]\[data-ch="([A-Z])"\]/.exec(t))) {
    assert.ok(ui.sel >= 0, 'Taste ohne Feld');
    if (!E.isLocked(g, ui.sel)) assert.equal(E.apply(g, 'p0', { t: 'put', i: ui.sel, ch: m[1] }).ok, true);
    advance(g, ui);
    return 'key';
  }
  if (t === '[data-act=check]') { assert.equal(E.apply(g, 'p0', { t: 'check' }).ok, true); return 'check'; }
  if (t === '[data-act=revealL]') { assert.equal(E.apply(g, 'p0', { t: 'revealLetter', i: ui.sel }).ok, true); return 'reveal'; }
  if (t === '[data-act=again]') return 'again';
  assert.fail('unbekanntes Ziel ' + t);
}

test('Übungsrätsel: 5 Wörter, gültig, ohne Generator', () => {
  assert.equal(LEARN_PUZZLE.length, 5);
  const pz = E.buildPuzzle(LEARN_PUZZLE);
  assert.deepEqual(E.validate(pz, new Set(LEARN_PUZZLE.map((x) => x.w))), []);
  const g = learn();
  assert.equal(g.mode, 'play'); assert.equal(g.level, 'lern'); assert.equal(g.words.length, 5);
});

test('Lernrunde: nur dem Ziel folgen führt zum Ende', () => {
  const g = learn();
  const ctx = mkCtx();
  let steps = 0, last = '';
  const seen = [];
  const kinds = new Set();
  while (steps++ < 120) {
    const r = coach(g, ctx);
    assert.ok(r, 'kein Coach');
    check(r, 'Lernrunde');
    seen.push(r.text);
    assert.ok(r.target, 'Ziel fehlt');
    last = follow(g, ctx.ui, r);
    kinds.add(last);
    if (last === 'again') break;
  }
  assert.equal(last, 'again');
  assert.equal(g.mode, 'over');
  assert.ok(steps <= 60, `${steps} Schritte`);
  assert.match(coach(g, ctx).text, /Übungsrätsel gelöst/);
  for (const k of ['cell', 'key', 'check', 'reveal']) assert.ok(kinds.has(k), `Schritt ${k} fehlt`);
  const all = seen.join(' | ');
  for (const re of [/Zahl/, /Hinweis/, /Cursor/, /Richtung/, /Prüfen/, /aufdecken/, /Hilfe/]) assert.match(all, re);
  // jede Erklärung nur einmal: lange Texte (Erklärungen) kommen nie doppelt vor
  const long = seen.filter((t) => t.length > 60);
  assert.equal(new Set(long).size, long.length, 'Erklärung wiederholt sich');
  assert.equal(g.hints, 1);
  assert.equal(g.checks, 1);
});

test('Lernrunde: Cursor springt wie in der App, Richtungswechsel nötig', () => {
  const g = learn();
  const ctx = mkCtx();
  const dirs = new Set();
  let n = 0;
  while (n++ < 120) {
    const r = coach(g, ctx);
    if (follow(g, ctx.ui, r) === 'again') break;
    dirs.add(ctx.ui.dir);
  }
  assert.deepEqual([...dirs].sort(), ['h', 'v']);
});

test('Lernrunde: falscher Buchstabe wird freundlich korrigiert', () => {
  const g = learn();
  const ctx = mkCtx();
  ctx.ui.sel = 0;
  E.apply(g, 'p0', { t: 'put', i: 0, ch: 'Q' });
  const r = coach(g, ctx);
  check(r, 'falsch');
  assert.match(r.text, /Hier gehört ein P hin/);
  assert.match(r.target, /data-ch="P"/);
  ctx.ui.sel = 6;
  assert.match(coach(g, ctx).target, /data-act=cell\]\[data-i="0"/);
});

test('Coach: normale Rätsel nur mit Bedienhilfe, keine Lösungsbuchstaben', () => {
  const g = E.createGame(P);
  E.apply(g, 'p0', { t: 'new', level: 'mittel' }, seeded(3));
  const ctx = mkCtx();
  const r = coach(g, ctx);
  check(r, 'normal');
  assert.equal(r.target, undefined);
  assert.ok(!/Tippe jetzt das/.test(r.text));
  for (let s = 1; s <= 30; s++) {
    const h = E.createGame(P);
    E.apply(h, 'p0', { t: 'new', level: ['leicht', 'mittel', 'schwer'][s % 3] }, seeded(s));
    const c = mkCtx();
    c.ui.sel = s % 5;
    const rr = coach(h, c);
    check(rr, 'Zufall ' + s);
    assert.ok(rr && !rr.target);
  }
});

test('Coach: Wahl-Bildschirm, kaputte Eingaben und Selektoren', () => {
  const g = E.createGame(P);
  assert.equal(coach(g, mkCtx()), null);
  for (const bad of [null, undefined, 0, 'x', {}, { mode: 'play' }, { mode: 'play', cells: [], words: [] }, { mode: 'play', cells: [1], words: [1], level: 'lern', sol: 'A' }]) {
    for (const ctx of [undefined, null, {}, { ui: null }, { ui: { sel: 'x', dir: 5 } }, mkCtx()]) {
      let r;
      assert.doesNotThrow(() => { r = coach(bad, ctx); });
      check(r, 'kaputt');
    }
  }
  // sehr viele Zufallszustände der Lernrunde: Coach liefert immer etwas Gültiges
  for (let s = 1; s <= 300; s++) {
    const rng = seeded(s);
    const h = learn();
    const ctx = mkCtx();
    for (let k = 0; k < 40 && h.mode === 'play'; k++) {
      const letters = h.sol.split('').map((c, i) => (c === '#' ? -1 : i)).filter((i) => i >= 0);
      const i = letters[Math.floor(rng() * letters.length)];
      const x = rng();
      if (x < 0.4) tapCell(h, ctx.ui, i);
      else if (x < 0.7) E.apply(h, 'p0', { t: 'put', i, ch: h.sol[i] });
      else if (x < 0.8) E.apply(h, 'p0', { t: 'put', i, ch: String.fromCharCode(65 + Math.floor(rng() * 26)) });
      else if (x < 0.85) E.apply(h, 'p0', { t: 'check' });
      else if (x < 0.9) { ctx.ui.sel = i; E.apply(h, 'p0', { t: 'revealLetter', i }); }
      else ctx.ui.dir = ctx.ui.dir === 'h' ? 'v' : 'h';
      const r = coach(h, ctx);
      assert.ok(r, `kein Coach (Seed ${s})`);
      check(r, `Zufall ${s}/${k}`);
    }
  }
});
