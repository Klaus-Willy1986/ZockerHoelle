import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../sudoku/engine.js';
import { coach } from '../sudoku/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const P = [{ id: 'p0', name: 'Du' }];
const mkCtx = () => ({ id: 'p0', ui: { sel: -1, notes: false, newPanel: false, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 200, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

// Führt die Anweisung des Coachs so aus, wie ein Mensch das leuchtende Ziel antippen würde.
function follow(g, ctx, r) {
  const t = r.target;
  let m;
  if ((m = /\[data-act=cell\]\[data-i="(\d+)"\]/.exec(t))) { ctx.ui.sel = Number(m[1]); return 'cell'; }
  if ((m = /\[data-act=key\]\[data-d="(\d)"\]/.exec(t))) { assert.equal(E.apply(g, 'p0', { t: ctx.ui.notes ? 'note' : 'put', i: ctx.ui.sel, d: Number(m[1]) }).ok, true); return 'key'; }
  if (t === '[data-act=undo]') { assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, true); return 'undo'; }
  if (t === '[data-act=notes]') { ctx.ui.notes = !ctx.ui.notes; return 'notes'; }
  if (t === '[data-act=new-cancel]') { ctx.ui.newPanel = false; return 'cancel'; }
  if (t === '[data-act=again]') return 'again';
  assert.fail('unbekanntes Ziel ' + t);
}

test('Lernrunde: nur dem Ziel folgen führt zum Ende', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  let steps = 0, last = '';
  const seen = new Set();
  while (steps++ < 60) {
    const r = coach(g, ctx);
    assert.ok(r, 'kein Coach');
    check(r, 'Lernrunde');
    seen.add(r.text);
    assert.ok(r.target, 'Ziel fehlt');
    last = follow(g, ctx, r);
    if (last === 'again') break;
  }
  assert.equal(last, 'again');
  assert.equal(g.mode, 'over');
  assert.ok(steps <= 20, `${steps} Schritte`);
  assert.match(coach(g, ctx).text, /Übungsrätsel gelöst/);
  assert.ok(seen.size >= 5, 'abwechslungsreiche Texte');
  // Reihenfolge der Erklärungen: Zeile, Spalte, Block kommen vor
  const all = [...seen].join(' | ');
  assert.match(all, /Zeile/); assert.match(all, /Spalte/); assert.match(all, /Block/);
});

test('Lernrunde: falsche Zahl → Coach bietet Rückgängig an', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  const i = E.LEARN_ORDER[0];
  ctx.ui.sel = i;
  const d = (Number(g.solution[i]) % 9) + 1;
  E.apply(g, 'p0', { t: 'put', i, d });
  const r = coach(g, ctx);
  check(r, 'falsch');
  assert.equal(r.target, '[data-act=undo]');
  assert.match(r.text, /passt nicht/);
  follow(g, ctx, r);
  assert.equal(coach(g, ctx).target.includes('data-act=key'), true);
});

test('Lernrunde: Notizen an, Neues-Rätsel-Fenster und beliebige Reihenfolge', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  ctx.ui.notes = true;
  assert.equal(coach(g, ctx).target, '[data-act=notes]');
  ctx.ui.notes = false;
  ctx.ui.newPanel = true;
  check(coach(g, ctx), 'Panel');
  assert.equal(coach(g, ctx).target, '[data-act=new-cancel]');
  ctx.ui.newPanel = false;
  // ein anderes leeres Feld als das vorgeschlagene wählen: Coach nennt die Zahl dafür
  const other = E.LEARN_ORDER[3];
  ctx.ui.sel = other;
  const r = coach(g, ctx);
  assert.equal(r.target, `[data-act=key][data-d="${g.solution[other]}"]`);
  // ein vorgegebenes Feld gewählt → zurück zum leuchtenden leeren Feld
  ctx.ui.sel = g.puzzle.split('').findIndex((c) => c !== '0');
  const r2 = coach(g, ctx);
  assert.match(r2.target, /data-act=cell/);
});

test('Normale Spiele: Coach verrät keine Felder und keine Zahlen', () => {
  const rng = seeded(4);
  for (const L of E.LEVELS) {
    const g = E.createGame(P);
    assert.equal(coach(g, mkCtx()), null, 'Auswahl-Modus');
    E.apply(g, 'p0', { t: 'new', level: L.id }, rng);
    const ctx = mkCtx();
    for (const sel of [-1, 0, 40, 80]) {
      ctx.ui.sel = sel;
      const r = coach(g, ctx);
      check(r, 'normal');
      assert.equal(r.target, undefined, 'kein Ziel in normalen Spielen');
      assert.ok(!/\d/.test(r.text), 'keine Ziffern im Text');
    }
  }
});

test('Zufallszustände: Coach liefert immer gültigen Text oder null', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const rng = seeded(seed);
    const g = E.createGame(P, { learn: seed % 2 === 0 });
    if (g.mode === 'choose') E.apply(g, 'p0', { t: 'new', level: E.LEVELS[seed % 3].id }, rng);
    const ctx = mkCtx();
    for (let n = 0; n < 150 && g.mode === 'play'; n++) {
      ctx.ui.sel = Math.floor(rng() * 82) - 1;
      ctx.ui.notes = rng() < 0.2;
      ctx.ui.newPanel = rng() < 0.1;
      check(coach(g, ctx), `seed ${seed} n ${n}`);
      const t = ['put', 'note', 'erase', 'undo', 'check', 'reveal'][Math.floor(rng() * 6)];
      E.apply(g, 'p0', { t, i: Math.floor(rng() * 81), d: 1 + Math.floor(rng() * 9) });
    }
    check(coach(g, ctx), 'Ende');
  }
});

test('Coach wirft nie bei kaputten Eingaben', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { mode: 'play' }, { mode: 'play', cells: [] }, { mode: 'over' }, { mode: 'play', cells: 'abc', level: 'lern' }]) {
    for (const ctx of [undefined, null, {}, { ui: null }, { ui: 5 }, mkCtx()]) {
      assert.doesNotThrow(() => coach(bad, ctx));
      check(coach(bad, ctx), 'kaputt');
    }
  }
  const g = E.createGame(P, { learn: true });
  for (const sel of [NaN, 'a', 1e9, -50, null, undefined, {}]) {
    const ctx = mkCtx(); ctx.ui.sel = sel;
    assert.doesNotThrow(() => coach(g, ctx));
    check(coach(g, ctx), 'sel ' + String(sel));
  }
});
