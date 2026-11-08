import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../vier/engine.js';
import { chooseAction } from '../vier/ai.js';
import { coach } from '../vier/tutorial.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const validSel = (s) => typeof s === 'string' && s.length > 0 && /^[\w\s.#\-\[\]="':>,*()~+]+$/.test(s);
const checkOut = (r) => {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'), 'null oder Objekt');
  if (!r) return;
  assert.ok(r.text.trim().length > 0 && r.text.length <= 220, 'Text: ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const STRATEGIE = /(beste[rn]?|klug|am besten|Mitte|Zentrum|blocke|verhindere|Falle|Gabel|Trick|\bTipps?\b|empfehl|solltest|besser|Spalte \d)/i;
const mk = (humanFirst = true) => M.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], { big: false });

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], board: [] }, { players: [{ id: 'me' }], board: [], scores: [], mode: 'play', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk(); g.board = null; checkOut(coach(g, ctx));
  const g2 = mk(); checkOut(coach(g2, { id: 'me', ui: { coachSeen: 7 } }));
  g2.scores = null; checkOut(coach(g2, ctx));
  assert.equal(coach(mk(), { id: 'fremd', ui: {} }), null);
});

test('Partien Mensch (zufällig) gegen Bot: Hinweis immer sinnvoll, jede Erklärung genau einmal, keine Zugempfehlung', () => {
  const keys = [['goal', /Ziel:/], ['drop', /fällt in der Spalte/], ['dirs', /waagerecht, senkrecht oder schräg/], ['draw', /ganze Brett voll/], ['over-win', /Du hast vier in einer Reihe/], ['over-lose', /Der Computer hat vier/], ['over-draw', /Das Brett ist voll, niemand/]];
  const total = { goal: 0, drop: 0, dirs: 0, draw: 0, 'over-win': 0, 'over-lose': 0, 'over-draw': 0, computer: 0, human: 0, over: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const g = mk(humanFirst);
    const me = humanFirst ? 0 : 1;
    const ui = {};
    const ctx = { id: 'me', ui };
    const counts = {};
    const note = (text) => { for (const [k, re] of keys) if (re.test(text)) counts[k] = (counts[k] || 0) + 1; };
    for (let round = 0; round < 4; round++) {
      let guard = 0;
      while (g.mode === 'play' && guard++ < 100) {
        if (g.turn === me) {
          const legal = M.legalActions(g);
          const r = coach(g, ctx);
          checkOut(r);
          assert.ok(r && r.target, 'Ziel beim Menschen');
          assert.match(r.target, /open/);
          assert.doesNotMatch(r.text, STRATEGIE);
          note(r.text);
          assert.deepEqual(coach(g, ctx), r, 'gleicher Zustand, gleiche Antwort');
          total.human++;
          assert.ok(M.handle(g, 'me', legal[Math.floor(rnd() * legal.length)]).ok);
        } else {
          const r = coach(g, ctx);
          checkOut(r);
          assert.match(r.text, /Computer/);
          assert.equal(r.target, undefined);
          total.computer++;
          const a = chooseAction(g, 'bot1', 0, rnd);
          assert.ok(a && M.handle(g, 'bot1', a).ok);
        }
      }
      assert.equal(g.mode, 'over');
      const r = coach(g, ctx);
      checkOut(r);
      assert.equal(r.target, '[data-act="next"]');
      assert.doesNotMatch(r.text, STRATEGIE);
      note(r.text);
      assert.deepEqual(coach(g, ctx), r);
      total.over++;
      M.nextRound(g);
    }
    for (const [k, c] of Object.entries(counts)) {
      assert.ok(c <= 1, `${k} mehrfach erklärt (${c}) in Partie ${seed}`);
      total[k] += 1;
    }
  }
  assert.ok(total.computer > 0 && total.goal > 0 && total.drop > 0 && total.dirs > 0 && total.over > 0);
  console.log('Abdeckung', total);
});

test('Reihenfolge: Ziel, Fallen, Richtungen, Unentschieden; danach nur noch die kurze Aufforderung', () => {
  const g = mk();
  const ctx = { id: 'me', ui: {} };
  const texts = [];
  for (let i = 0; i < 5; i++) {
    texts.push(coach(g, ctx).text);
    M.drop(g, 'me', [0, 1, 2, 0, 1][i]); M.drop(g, 'bot1', [4, 5, 6, 4, 5][i]);
  }
  assert.match(texts[0], /Ziel:/);
  assert.match(texts[1], /fällt/);
  assert.match(texts[2], /schräg/);
  assert.match(texts[3], /unentschieden/);
  assert.equal(texts[4], 'Du bist dran. Tippe auf eine Spalte.');
});

test('Erklärung bleibt im selben Zustand stehen (mehrfaches Zeichnen)', () => {
  const g = mk();
  const ui = {};
  const a = coach(g, { id: 'me', ui }).text;
  for (let i = 0; i < 5; i++) assert.equal(coach(g, { id: 'me', ui }).text, a);
});

test('Spielende: Sieg, Niederlage, Unentschieden und der Hinweis auf „Noch eine Runde“', () => {
  const win = mk();
  win.mode = 'over'; win.winner = 0;
  assert.match(coach(win, { id: 'me', ui: {} }).text, /Du hast vier in einer Reihe.*Noch eine Runde/);
  const lose = mk(); lose.mode = 'over'; lose.winner = 1;
  assert.match(coach(lose, { id: 'me', ui: {} }).text, /Computer hat vier.*Noch eine Runde/);
  const draw = mk(); draw.mode = 'over'; draw.winner = null;
  assert.match(coach(draw, { id: 'me', ui: {} }).text, /unentschieden.*Noch eine Runde/);
  const ui = {};
  const first = coach(win, { id: 'me', ui }).text;
  assert.equal(coach(win, { id: 'me', ui }).text, first);
  M.nextRound(win); win.mode = 'over'; win.winner = 0;
  assert.match(coach(win, { id: 'me', ui }).text, /^Die Runde ist zu Ende/);
});
