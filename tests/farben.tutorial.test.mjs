import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../farben/engine.js';
import { coach } from '../farben/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const freshPick = () => ({ ci: null, ni: null, jc: null, jn: null, ask: null, cells: [], pass: false });
const mkCtx = (id = 'p0') => ({ id, ui: { rolling: false, pick: freshPick(), coachSeen: {} } });

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

// Kleiner Nachbau der Bedienung aus farben/app.js: klickt das erste markierte Element.
function clickFirst(g, ctx, rng, target) {
  const pk = ctx.ui.pick;
  const me = g.players.find((p) => p.id === ctx.id);
  const first = target.split(',')[0].trim();
  let m;
  if (first === '[data-act=roll]') return E.roll(g, ctx.id, rng);
  if (first === '[data-act=again]') return null;
  if (first === '[data-act=pass-yes]') { ctx.ui.pick = freshPick(); return E.submit(g, ctx.id, null); }
  if (first === '[data-act=pass]') { pk.pass = true; return null; }
  if (first === '[data-act=reset-dice]') { ctx.ui.pick = freshPick(); return null; }
  if (first === '[data-act=joker-cancel]') { pk[pk.ask.kind === 'c' ? 'ci' : 'ni'] = null; pk.ask = null; return null; }
  if ((m = first.match(/^\[data-act=joker-pick\]\[data-v="(\w+)"\]$/))) {
    const ask = pk.ask; pk.ask = null;
    if (ask.kind === 'c') pk.jc = m[1]; else pk.jn = Number(m[1]);
    return null;
  }
  if ((m = first.match(/^\[data-act=die\]\[data-kind=(c|n)\]\[data-i="(\d)"\]$/))) {
    const [, kind, i] = m;
    const key = kind === 'c' ? 'ci' : 'ni';
    pk[key] = Number(i); pk.cells = [];
    const face = g.dice[kind][Number(i)];
    if (face === 'X' || face === '?') pk.ask = { kind, i: Number(i) };
    return null;
  }
  if (first === '.fw-cell.opt') {
    const color = g.dice.c[pk.ci] === 'X' ? pk.jc : g.dice.c[pk.ci];
    const num = g.dice.n[pk.ni] === '?' ? pk.jn : g.dice.n[pk.ni];
    const groups = E.legalGroups(me.x, color, num);
    const opt = new Set();
    for (const gr of groups) if (pk.cells.every((i) => gr.includes(i))) for (const i of gr) if (!pk.cells.includes(i)) opt.add(i);
    assert.ok(opt.size > 0, 'leuchtende Felder fehlen');
    pk.cells.push([...opt].sort((a, b) => a - b)[0]);
    return null;
  }
  if (first === '[data-act=confirm]') {
    const msg = { ci: pk.ci, ni: pk.ni, cells: [...pk.cells].sort((a, b) => a - b) };
    if (g.dice.c[pk.ci] === 'X') msg.color = pk.jc;
    if (g.dice.n[pk.ni] === '?') msg.num = pk.jn;
    ctx.ui.pick = freshPick();
    return E.submit(g, ctx.id, msg);
  }
  assert.fail('unerwartetes Ziel ' + first);
  return null;
}

test('Alleinspiel: nur dem Ziel folgen führt bis zum Spielende', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const rng = seeded(seed);
    const g = E.createGame(players(1));
    const ctx = mkCtx();
    let steps = 0;
    while (g.mode !== 'over' && steps++ < 5000) {
      const r = must(g, ctx, `seed ${seed} Schritt ${steps}`);
      assert.ok(r.target, 'Ziel fehlt: ' + r.text);
      const res = clickFirst(g, ctx, rng, r.target);
      if (res) assert.ok(res.ok, `${r.target}: ${res.error}`);
    }
    assert.equal(g.mode, 'over', `seed ${seed}`);
    assert.equal(g.throwNo, E.SOLO_THROWS);
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
    assert.match(end.text, /Lernrunde ist zu Ende/);
  }
});

test('Mehrpersonenspiel: Coach liefert immer Text, auch beim Warten', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const rng = seeded(seed + 50);
    const g = E.createGame(players(3));
    const ctx = mkCtx();
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 400) {
      const ap = E.activePlayer(g);
      if (g.phase === 'roll') {
        const r = must(g, ctx, 'roll');
        if (ap.id !== 'p0') assert.equal(r.target, undefined);
        E.roll(g, ap.id, rng);
        continue;
      }
      for (const id of E.waitingFor(g)) {
        const p = E.playerById(g, id);
        if (id === 'p0') {
          must(g, ctx, 'wählen');
          ctx.ui.pick = { ...freshPick(), ci: 0 }; must(g, ctx, 'Farbwürfel');
          ctx.ui.pick = { ...freshPick(), ni: 0 }; must(g, ctx, 'Zahlenwürfel');
          ctx.ui.pick = { ...freshPick(), pass: true }; must(g, ctx, 'passen');
          ctx.ui.pick = freshPick();
        } else {
          must(g, ctx, 'warten');
        }
        // zufällige erlaubte Wahl oder passen
        const opts = [];
        for (let ci = 0; ci < g.dice.c.length; ci++) for (let ni = 0; ni < g.dice.n.length; ni++) {
          if (g.gone.c[ci] || g.gone.n[ni]) continue;
          const cf = g.dice.c[ci]; const nf = g.dice.n[ni];
          for (const color of cf === 'X' ? E.COLORS : [cf]) for (const num of nf === '?' ? [1, 2, 3, 4, 5] : [nf]) {
            const cost = (cf === 'X' ? 1 : 0) + (nf === '?' ? 1 : 0);
            if (cost > p.jokers) continue;
            for (const cells of E.legalGroups(p.x, color, num).slice(0, 3)) opts.push({ ci, ni, color, num, cells });
          }
        }
        if (!opts.length || rng() < 0.1) E.submit(g, id, null);
        else E.submit(g, id, opts[Math.floor(rng() * opts.length)]);
      }
    }
    must(g, ctx, 'Ende');
  }
});

test('Jokerwürfel und erste Spalte H werden erklärt', () => {
  const g = E.createGame(players(1));
  const ctx = mkCtx();
  assert.match(must(g, ctx, 'start').text, /vier Würfel/);
  g.phase = 'all'; g.throwNo = 1; g.rollId = 1;
  g.dice = { c: ['X', 'G'], n: [3, '?'] };
  g.gone = { c: [false, false], n: [false, false] };
  const r = must(g, ctx, 'würfel');
  assert.match(r.text, /Farbe sagt/);
  g.rollId = 2;
  assert.match(must(g, ctx, 'würfel2').text, /Joker/);
  // Erstes Kreuz in Spalte H (Farbe/Zahl so wählen, dass es erlaubt ist)
  const col = E.COLORS.find((c) => E.legalGroups(g.players[0].x, c, 3).length > 0);
  g.dice = { c: ['X', col], n: [3, '?'] };
  ctx.ui.pick = { ...freshPick(), ci: 1, ni: 0 };
  const c = must(g, ctx, 'felder');
  assert.match(c.text, /Spalte H/);
  assert.match(c.text, new RegExp(`3 ${E.COLOR_MANY[col]} Felder`));
  assert.equal(c.target, '.fw-cell.opt');
  // Joker-Frage
  ctx.ui.pick = { ...freshPick(), ci: 0, ask: { kind: 'c', i: 0 } };
  const a = must(g, ctx, 'joker');
  assert.match(a.text, /die Farbe selbst/);
  assert.match(a.target, /joker-pick/);
  // Joker aufgebraucht: Joker-Würfel werden nicht markiert
  g.players[0].jokers = 0;
  ctx.ui.pick = freshPick();
  const t = must(g, ctx, 'ohne Joker').target;
  assert.ok(!t.includes('[data-kind=c][data-i="0"]'));
});

test('Spielende, Warten und Rollen', () => {
  const g = E.createGame(players(1));
  const ctx = mkCtx();
  ctx.ui.rolling = true;
  assert.equal(must(g, ctx, 'rolling').text, 'Die Würfel rollen.');
  ctx.ui.rolling = false;
  g.mode = 'over'; g.phase = 'over';
  assert.equal(must(g, ctx, 'over').target, '[data-act=again]');
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { players: [] }, { players: [null] }, { phase: 'roll', players: [{}], active: 0 },
    { mode: 'play', phase: 'all', players: [{ id: 'p0', x: [], jokers: 3 }], active: 0, dice: { c: [], n: [] }, gone: {}, picks: {} },
    { mode: 'play', phase: 'all', players: [{ id: 'p0' }], active: 0, dice: 'x', gone: null, picks: null },
    { mode: 'play', phase: 'active', players: [{ id: 'p0', x: [1] }], active: 0, dice: { c: ['X'], n: ['?'] }, gone: { c: [false], n: [false] }, picks: {} }];
  for (const g of bad) {
    for (const c of [undefined, null, {}, { id: 'p0' }, { id: 'p0', ui: null }, { id: 'p0', ui: { pick: 5, coachSeen: 3 } },
      { id: 'p0', ui: { pick: { ci: 7, ni: 'a', ask: {}, cells: 'x' } } }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(g, c); });
      check(r, JSON.stringify(g));
    }
  }
});
