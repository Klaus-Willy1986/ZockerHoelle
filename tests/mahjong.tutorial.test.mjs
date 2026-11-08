import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../mahjong/engine.js';
import { coach } from '../mahjong/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const P = [{ id: 'p0', name: 'Du' }];
const mkCtx = () => ({ id: 'p0', ui: { sel: null, coachSeen: {}, blockedTried: false } });
const learn = () => E.createGame(P, { learn: true, free: true, hints: true }, seeded(1));

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 200, `${where}: Text "${r.text}"`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

// Tippen wie in der Oberfläche (app.js onTile)
function tap(g, ctx, i) {
  const ui = ctx.ui;
  if (!(g.kinds[i] >= 0)) return;
  if (!E.isFree(g, i)) { ui.blockedTried = true; return; }
  const sel = ui.sel;
  if (sel === null || !(g.kinds[sel] >= 0) || !E.isFree(g, sel)) { ui.sel = i; return; }
  if (sel === i) { ui.sel = null; return; }
  if (E.sameKind(g.kinds[sel], g.kinds[i])) { ui.sel = null; E.handle(g, 'p0', { t: 'pair', a: sel, b: i }); return; }
  ui.sel = i;
}
// Führt die Anweisung des Coachs so aus, wie ein Mensch das leuchtende Ziel antippen würde.
function follow(g, ctx, r, rng) {
  const t = r.target;
  let m;
  if ((m = /\.mj-tile\[data-i="(\d+)"\]/.exec(t))) { tap(g, ctx, Number(m[1])); ctx.ui.sel = ctx.ui.sel; return 'tile'; }
  if (t === '[data-act=hint]') { assert.equal(E.handle(g, 'p0', { t: 'hint' }, rng).ok, true); ctx.ui.sel = null; return 'hint'; }
  if (t === '[data-act=undo]') { assert.equal(E.handle(g, 'p0', { t: 'undo' }).ok, true); ctx.ui.sel = null; return 'undo'; }
  if (t === '[data-act=shuffle]') { assert.equal(E.handle(g, 'p0', { t: 'shuffle' }, rng).ok, true); ctx.ui.sel = null; return 'shuffle'; }
  if (t === '[data-act=again]') return 'again';
  assert.fail('unbekanntes Ziel ' + t);
}

test('Lernrunde: nur dem Ziel folgen führt zum Ende, alle Erklärungen kommen vor', () => {
  const g = learn();
  const ctx = mkCtx();
  const rng = seeded(5);
  const texts = [];
  const kinds = new Set();
  let steps = 0, last = '';
  while (steps++ < 80) {
    const r = coach(g, ctx);
    assert.ok(r, 'kein Coach');
    check(r, 'Lernrunde');
    assert.ok(r.target, 'Ziel fehlt: ' + r.text);
    texts.push(r.text);
    last = follow(g, ctx, r, rng);
    kinds.add(last);
    if (last === 'again') break;
  }
  assert.equal(last, 'again');
  assert.equal(g.mode, 'over');
  assert.ok(steps <= 45, `${steps} Schritte`);
  assert.ok(kinds.has('hint') && kinds.has('undo') && kinds.has('shuffle'), 'Hinweis, Zurück, Mischen werden gezeigt: ' + [...kinds]);
  const all = texts.join(' | ');
  assert.match(all, /eingeklemmt/); assert.match(all, /Hinweis/); assert.match(all, /Zurück/); assert.match(all, /Neu mischen/);
  assert.match(coach(g, ctx).text, /Alle Steine sind weg/);
  assert.equal(g.hints, 1, 'Hinweis nur einmal');
  assert.equal(g.mixes, 1, 'Mischen nur einmal');
});

test('Lernrunde: jede Erklärung erscheint nur einmal (zusammenhängend, nie wieder)', () => {
  const g = learn();
  const ctx = mkCtx();
  const rng = seeded(8);
  const seq = [];
  for (let s = 0; s < 80; s++) {
    const r = coach(g, ctx);
    seq.push(r.text);
    if (follow(g, ctx, r, rng) === 'again') break;
  }
  const explain = (t) => /eingeklemmt: |Du weißt nicht|Falsch getippt|Manchmal geht es nicht|Immer zwei gleiche/.test(t);
  const blocks = [];
  for (const t of seq) { if (!blocks.length || blocks[blocks.length - 1] !== t) blocks.push(t); }
  const ex = blocks.filter(explain);
  assert.equal(new Set(ex).size, ex.length, 'Erklärung kehrt wieder: ' + ex.join(' || '));
  assert.ok(ex.length >= 4, 'Erklärungen: ' + ex.length);
});

test('Lernrunde: Coach-Text und Ziel sind bei zufälligem Verhalten immer gültig (300 Läufe)', () => {
  const rng = seeded(99);
  let again = 0;
  for (let run = 0; run < 300; run++) {
    const g = learn();
    const ctx = mkCtx();
    for (let step = 0; step < 60 && g.mode === 'play'; step++) {
      const r = coach(g, ctx);
      check(r, `Lauf ${run}`);
      assert.ok(r && r.target, 'Ziel fehlt');
      // zufällige Handlung: Stein antippen, Hinweis, Zurück, Mischen, oder dem Coach folgen
      const x = rng();
      if (x < 0.15) follow(g, ctx, r, rng);
      else if (x < 0.65) tap(g, ctx, Math.floor(rng() * g.kinds.length));
      else if (x < 0.75) E.handle(g, 'p0', { t: 'hint' }, rng);
      else if (x < 0.85) E.handle(g, 'p0', { t: 'undo' });
      else if (x < 0.9) E.handle(g, 'p0', { t: 'shuffle' }, rng);
      else tap(g, ctx, E.freeTiles(g)[0] ?? 0);
    }
    if (g.mode === 'over') { again++; assert.match(coach(g, ctx).text, /Geschafft/); }
  }
  assert.ok(again > 0, 'zufällige Läufe erreichen manchmal das Ende: ' + again);
});

test('Lernrunde: markierter Stein ohne freien Partner und Sackgasse haben sinnvolle Texte', () => {
  const g = learn();
  const ctx = mkCtx();
  // einen freien Stein markieren, dessen gleicher Partner noch nicht frei ist
  const lonely = E.freeTiles(g).find((i) => !E.freeTiles(g).some((j) => j !== i && E.sameKind(g.kinds[i], g.kinds[j])));
  assert.ok(lonely !== undefined);
  ctx.ui.sel = lonely;
  const r = coach(g, ctx);
  check(r, 'einsam');
  assert.match(r.text, /noch keinen freien gleichen/);
  assert.equal(r.target, `.mj-tile[data-i="${lonely}"]`);
  // Sackgasse: zwei Steine übereinander
  const h = learn();
  h.kinds = new Array(12).fill(-1);
  const pos = E.geometry('lern').pos;
  h.kinds[pos.findIndex((p) => p[0] === 0 && p[1] === 4 && p[2] === 0)] = 3;
  h.kinds[pos.findIndex((p) => p[0] === 1 && p[1] === 4 && p[2] === 1)] = 3;
  const r2 = coach(h, mkCtx());
  check(r2, 'Sackgasse');
  assert.equal(r2.target, '[data-act=shuffle]');
});

test('Coach: kaputte Eingaben werfen nie und liefern null oder gültige Antwort', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { kinds: 'x' }, { kinds: [], hist: [] }, { kinds: [], hist: [], layout: 'lern' }, { kinds: [1], hist: 'x', layout: 'lern' },
    { mode: 'play', kinds: [1, 1], hist: [], layout: 'unbekannt' }, { mode: 'over', kinds: [], hist: [], layout: 'lern' }];
  const ctxs = [undefined, null, {}, { ui: null }, { ui: 5 }, { ui: { coachSeen: 7, sel: 'a' } }, mkCtx()];
  for (const g of bad) for (const c of ctxs) {
    let r;
    assert.doesNotThrow(() => { r = coach(g, c); });
    check(r, JSON.stringify(g));
  }
  const g = learn();
  g.hist = [null, 5, 'x', ['p']];
  assert.doesNotThrow(() => coach(g, mkCtx()));
  const h = learn();
  h.kinds = h.kinds.slice(0, 5);
  assert.doesNotThrow(() => coach(h, mkCtx()));
});

test('Coach: keine Zugempfehlung außerhalb der Lernrunde (normales Brett ohne Ziel)', () => {
  for (const o of [{}, { small: true }, { tiny: true }]) {
    const g = E.createGame(P, o, seeded(3));
    const r = coach(g, mkCtx());
    check(r, 'normal');
    assert.equal(r.target, undefined, 'kein leuchtendes Ziel');
  }
});

test('Coach verändert den Spielzustand nicht', () => {
  const g = learn();
  const before = JSON.stringify(g);
  const ctx = mkCtx();
  for (let i = 0; i < 5; i++) coach(g, ctx);
  assert.equal(JSON.stringify(g), before);
});
