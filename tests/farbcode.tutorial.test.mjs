import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../farbcode/engine.js';
import { coach } from '../farbcode/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const solo = (rng) => F.createGame([{ id: 'p0', name: 'P0' }], rng);
const mkCtx = (id = 'p0') => ({ id, ui: { cur: [null, null, null, null], sel: null, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${(r.text || '').length})`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed);
    const g = solo(rng);
    const ctx = mkCtx();
    let steps = 0;
    while (g.mode !== 'over' && steps++ < 2000) {
      const r = must(g, ctx, 'folgen');
      const first = r.target.split(',')[0].trim();
      if (first === '[data-act=color]') {
        const i = ctx.ui.cur.indexOf(null);
        assert.ok(i >= 0, 'Farbziel nur wenn noch ein Feld frei ist (oder ein Feld gewählt)');
        ctx.ui.cur[i] = Math.floor(rng() * 6);
        if (ctx.ui.sel !== null) { ctx.ui.cur[ctx.ui.sel] = 2; ctx.ui.sel = null; }
      } else if (first === '[data-act=submit]:not([disabled])') {
        assert.ok(F.isValidCode(ctx.ui.cur));
        assert.ok(F.guess(g, 'p0', ctx.ui.cur).ok);
        ctx.ui.cur = [null, null, null, null];
      } else assert.fail('unerwartetes Ziel ' + first);
    }
    assert.equal(g.mode, 'over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
    assert.match(end.text, /Lernrunde ist zu Ende/);
  }
});

test('Erklärungen: Start, Auswertung (nur einmal), Duplikat-Regel', () => {
  const g = solo(seeded(3));
  const ctx = mkCtx();
  assert.match(must(g, ctx, 'a').text, /geheimen Code/);
  assert.equal(must(g, ctx, 'a').target, '[data-act=color]');
  ctx.ui.cur = [0, null, null, null];
  assert.match(must(g, ctx, 'b').text, /Tippe weiter/);
  ctx.ui.cur = [0, 0, 1, 1];
  const full = must(g, ctx, 'c');
  assert.match(full.target, /submit/);
  F.guess(g, 'p0', [0, 0, 1, 1]);
  ctx.ui.cur = [null, null, null, null];
  const ev = must(g, ctx, 'd');
  assert.match(ev.text, /Schwarz:/);
  assert.match(ev.text, /Weiß:/);
  assert.equal(must(g, ctx, 'd2').text, ev.text, 'bleibt im gleichen Zustand stehen');
  F.guess(g, 'p0', [0, 1, 2, 3]);
  const t2 = must(g, ctx, 'e').text;
  assert.doesNotMatch(t2, /Schwarz:/);
  // Letzter Versuch hatte keine Wiederholung -> keine Duplikat-Erklärung
  assert.doesNotMatch(t2, /nur einmal/);
  F.guess(g, 'p0', [4, 4, 5, 5]);
  assert.match(must(g, ctx, 'f').text, /nur einmal/);
  F.guess(g, 'p0', [4, 4, 5, 5]);
  assert.doesNotMatch(must(g, ctx, 'g').text, /nur einmal/);
});

test('Auswahl eines Feldes: Hinweis zum Ersetzen', () => {
  const g = solo(seeded(5));
  const ctx = mkCtx();
  ctx.ui.cur = [1, 2, 3, 4]; ctx.ui.sel = 2;
  const r = must(g, ctx, 'ersetzen');
  assert.match(r.text, /neue Farbe/);
  assert.equal(r.target, '[data-act=color]');
});

test('Letzter Versuch wird angekündigt, keine Strategie-Tipps', () => {
  const g = solo(seeded(9));
  const ctx = mkCtx();
  const all = [];
  for (let i = 0; i < 9; i++) { all.push(must(g, ctx, 'v' + i).text); F.guess(g, 'p0', [0, 0, 0, 0]); ctx.ui.cur = [null, null, null, null]; }
  const last = must(g, ctx, 'letzter');
  all.push(last.text);
  assert.match(last.text, /letzter Versuch/);
  const bad = /(probier|versuche es mit|am besten|tipp:|empfehl|klug|Strategie|zuerst Rot|nimm )/i;
  for (const t of all) assert.doesNotMatch(t, bad, t);
  // Texte nennen nie eine bestimmte Farbe als Vorschlag
  for (const t of all) assert.doesNotMatch(t, /(Rot|Blau|Grün|Gelb|Orange|Violett)/, t);
});

test('Zu zweit: Rollen und Wartetexte', () => {
  const g = F.createGame([{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }]);
  const a = mkCtx('p0'); const b = mkCtx('p1');
  const ra = must(g, a, 'setter');
  assert.match(ra.text, /Code/);
  assert.equal(ra.target, '[data-act=color]');
  a.ui.cur = [0, 1, 2, 3];
  assert.equal(must(g, a, 'voll').target, '[data-act=setcode]:not([disabled])');
  const rb = must(g, b, 'warten');
  assert.equal(rb.target, undefined);
  F.setCode(g, 'p0', [0, 1, 2, 3]);
  assert.equal(must(g, a, 'zuschauer').target, undefined);
  assert.equal(must(g, b, 'rater').target, '[data-act=color]');
  F.guess(g, 'p0', [0, 0, 0, 0]);
  F.guess(g, 'p1', [0, 1, 2, 3]);
  assert.equal(g.mode, 'between');
  assert.equal(must(g, a, 'between').target, '[data-act=next]');
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { players: [] }, { players: [null] }, { players: [{}], guesses: [] },
    { mode: 'guess', players: [{ id: 'p0' }], guesses: 'x' },
    { mode: 'guess', players: [{ id: 'p0' }], guesses: [null], guesser: 0 },
    { mode: 'guess', players: [{ id: 'p0' }], guesses: [{ g: 5, b: 'x', w: null }], guesser: 0, setter: -1 },
    { mode: 'code', players: [{ id: 'p0' }], guesses: [], setter: 7 }];
  for (const g of bad) {
    for (const c of [undefined, null, {}, { id: 'p0' }, { id: 'p0', ui: null }, { id: 'p0', ui: { cur: 'x', sel: 'y' } },
      { id: 'p0', S: {}, ui: { cur: [9, 9, 9, 9], sel: 99, coachSeen: 3 } }, { id: 'p0', ui: { cur: [null, null, null, null], sel: 1.5 } }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(g, c); });
      check(r, JSON.stringify(g));
    }
  }
});
