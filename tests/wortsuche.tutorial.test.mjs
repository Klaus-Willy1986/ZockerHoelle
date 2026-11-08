import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wortsuche/engine.js';
import { chooseAction } from '../wortsuche/ai.js';
import { coach } from '../wortsuche/tutorial.js';

const seeded = (s) => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>#-]+$/;
const mkG = (rng) => E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'Computer' }], { learn: true }, rng);
const mkCtx = () => ({ id: 'me', ui: { coachSeen: {}, start: -1 } });
const CELL = /\.ws-cell\[data-i="(\d+)"\]/;

function check(r, where) {
  if (r === null) return;
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 230, `${where}: Text "${r.text}"`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  assert.ok(!/zeige mir|tipp:|am besten|ich empfehle/i.test(r.text), 'keine Zugempfehlung');
}

// Ein "Mensch", der nur dem Ziel der Anleitung folgt: erst Anfang, dann Ende
function follow(g, ctx, r, rng) {
  const m = CELL.exec(r.target || '');
  if (!r.target) return false;
  if (/data-act=again/.test(r.target)) return false;
  assert.ok(m, 'Ziel ist ein Feld: ' + r.target);
  const i = Number(m[1]);
  if (ctx.ui.start < 0) { ctx.ui.start = i; return true; }
  const a = ctx.ui.start; ctx.ui.start = -1;
  assert.equal(E.handle(g, 'me', { t: 'line', a, b: i }).ok, true, 'Linie trifft');
  return true;
}

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt (Computer spielt mit)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seeded(seed);
    const g = mkG(rng); const ctx = mkCtx();
    let steps = 0;
    while (g.mode !== 'over' && steps++ < 200) {
      const r = coach(g, ctx);
      assert.ok(r, 'immer ein Coach-Text');
      check(r, 'folgen');
      assert.ok(r.target, 'immer ein Ziel');
      assert.ok(follow(g, ctx, r, rng));
      if (ctx.ui.start < 0 && rng() < 0.5) { const m = chooseAction(g, 'bot1', 0, rng); if (m) E.handle(g, 'bot1', m); }
    }
    assert.equal(g.mode, 'over');
    const end = coach(g, ctx);
    assert.equal(end.target, '[data-act=again]'); assert.match(end.text, /Lernrunde ist zu Ende/);
    assert.ok(g.scores[0] >= 30, 'Mensch hat mindestens 3 Wörter');
  }
});

test('jede lange Erklärung kommt nur einmal', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed); const g = mkG(rng); const ctx = mkCtx();
    const entered = {}; let prev = null; let steps = 0;
    while (g.mode !== 'over' && steps++ < 200) {
      const r = coach(g, ctx);
      if (r.text !== prev) { entered[r.text] = (entered[r.text] || 0) + 1; prev = r.text; }
      follow(g, ctx, r, rng);
      if (ctx.ui.start < 0 && seed % 2) { const m = chooseAction(g, 'bot1', 0, rng); if (m) E.handle(g, 'bot1', m); }
    }
    const intro = Object.entries(entered).filter(([x]) => x.length > 70);
    assert.ok(intro.length >= 4, 'mehrere ausführliche Erklärungen: ' + intro.length);
    for (const [x, n] of intro) assert.equal(n, 1, 'mehrfach gezeigt: ' + x);
  }
});

test('Erklärungen im Einzelnen', () => {
  const g = mkG(seeded(3)); const ctx = mkCtx();
  const w0 = g.words[0]; const c0 = E.wordCells(g.n, w0);
  let r = coach(g, ctx);
  assert.match(r.text, /Willkommen/); assert.match(r.text, /Liste/); assert.match(r.text, /ersten Buchstaben/);
  assert.equal(r.target, `.ws-cell[data-i="${c0[0]}"]`);
  // Anfang gewählt: Ziel ist das Ende
  ctx.ui.start = c0[0];
  r = coach(g, ctx);
  assert.match(r.text, /letzten Buchstaben/); assert.match(r.text, /Linie/);
  assert.equal(r.target, `.ws-cell[data-i="${c0[c0.length - 1]}"]`);
  // vom Ende her gewählt: Ziel ist der Anfang
  ctx.ui.start = c0[c0.length - 1];
  assert.equal(coach(g, ctx).target, `.ws-cell[data-i="${c0[0]}"]`);
  // falsches Anfangsfeld: kein Ziel, freundlicher Text
  const stray = [...Array(g.n * g.n).keys()].find((i) => !g.words.some((w) => { const c = E.wordCells(g.n, w); return c[0] === i || c[c.length - 1] === i; }));
  ctx.ui.start = stray;
  r = coach(g, ctx);
  assert.equal(r.target, undefined); assert.match(r.text, /kein Wortanfang/);
  ctx.ui.start = -1;
  // erstes Wort gefunden
  E.handle(g, 'me', { t: 'line', a: c0[0], b: c0[c0.length - 1] });
  r = coach(g, ctx);
  assert.match(r.text, /durchgestrichen/); assert.match(r.text, /10 Punkte/); assert.match(r.target, /#ws-list/);
  const c1 = E.wordCells(g.n, g.words[1]);
  E.handle(g, 'me', { t: 'line', a: c1[0], b: c1[c1.length - 1] });
  r = coach(g, ctx);
  assert.match(r.text, /Computer/); assert.match(r.target, /#ws-score/);
  const c2 = E.wordCells(g.n, g.words[2]);
  E.handle(g, 'me', { t: 'line', a: c2[0], b: c2[c2.length - 1] });
  assert.match(coach(g, ctx).text, /schräg und rückwärts/);
  // Ohne Gegner: anderer Text bei zwei gefundenen Wörtern
  const solo = E.createGame([{ id: 'me', name: 'Ich' }], { learn: true }, seeded(4)); const cs = mkCtx();
  for (let k = 0; k < 2; k++) { const c = E.wordCells(solo.n, solo.words[k]); E.handle(solo, 'me', { t: 'line', a: c[0], b: c[c.length - 1] }); coach(solo, cs); }
  assert.match(coach(solo, cs).text, /Punkte stehen unter der Wortliste/);
});

test('Anleitung nennt nie die Lage eines Wortes im Text und steht nur auf Anfang oder Ende', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed); const g = mkG(rng); const ctx = mkCtx();
    let steps = 0;
    while (g.mode !== 'over' && steps++ < 200) {
      const r = coach(g, ctx);
      assert.ok(!/Zeile|Spalte|links oben|rechts unten|diagonal/i.test(r.text), r.text);
      const m = CELL.exec(r.target || '');
      if (m) {
        const i = Number(m[1]);
        assert.ok(g.words.some((w) => { if (w.by >= 0) return false; const c = E.wordCells(g.n, w); return c[0] === i || c[c.length - 1] === i; }), 'Ziel ist Anfang oder Ende eines gesuchten Wortes');
      }
      follow(g, ctx, r, rng);
    }
  }
});

test('kaputte Eingaben: wirft nie, liefert null oder gültigen Text', () => {
  const g = mkG(seeded(9));
  const junk = [undefined, null, 5, 'x', [], {}, { players: 5 }, { players: [], words: [], n: 8 }, { ...g, words: null }, { ...g, n: 'x' }, { ...g, players: [null] }, { ...g, words: [null, 5] }, { ...g, mode: 'over' }, { ...g, words: g.words.map((w) => ({ ...w, by: 0 })) }];
  const ctxs = [undefined, null, 5, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: 5 }, { id: 'me', ui: { start: 'x', coachSeen: 3 } }, { id: 'zz', ui: {} }, mkCtx()];
  for (const j of junk) for (const c of ctxs) { let r; assert.doesNotThrow(() => { r = coach(j, c); }); check(r, 'kaputt'); }
});
