import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../drei/engine.js';
import { chooseAction } from '../drei/ai.js';
import { coach } from '../drei/tutorial.js';

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
  assert.ok(r.text.trim().length > 0 && r.text.length <= 200, 'Text: ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
// Keine Strategie in der Lernrunde: Wörter, die auf Ratschläge hindeuten, dürfen nicht vorkommen
const STRATEGIE = /(beste[rn]?|klug|am besten|Ecke|Mitte|Zentrum|blocke|verhindere|Falle|Gabel|Trick|\bTipps?\b|empfehl|solltest|besser)/i;
const mk = (humanFirst = true, big = false) => M.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], { big });

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
  const keys = [['place', /Ihr setzt abwechselnd/], ['win', /Wer zuerst/], ['draw', /ganze Feld voll/], ['over-win', /Du hast eine Reihe/], ['over-lose', /Der Computer hat eine Reihe/], ['over-draw', /Das Feld ist voll, niemand/]];
  const total = { place: 0, win: 0, draw: 0, 'over-win': 0, 'over-lose': 0, 'over-draw': 0, computer: 0, human: 0, over: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const g = mk(humanFirst, seed % 3 === 0);
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
          assert.match(r.target, /free/);
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
  assert.ok(total.computer > 0 && total.place > 0 && total.win > 0 && total.over > 0);
  console.log('Abdeckung', total);
});

test('Reihenfolge der Erklärungen: Setzen, dann Gewinn, dann Unentschieden; danach nur noch die kurze Aufforderung', () => {
  const g = mk();
  const ui = {};
  const ctx = { id: 'me', ui };
  const texts = [];
  for (const p of [0, 4, 2]) {
    texts.push(coach(g, ctx).text);
    M.place(g, 'me', p);
    M.place(g, 'bot1', [1, 3, 5][texts.length - 1]);
  }
  assert.match(texts[0], /Ihr setzt abwechselnd/);
  assert.match(texts[1], /gewinnt/);
  assert.match(texts[2], /unentschieden/);
  assert.equal(coach(g, ctx).text, 'Du bist dran. Tippe auf ein freies Feld.');
});

test('Erklärung bleibt im selben Zustand stehen (mehrfaches Zeichnen)', () => {
  const g = mk();
  const ui = {};
  const a = coach(g, { id: 'me', ui }).text;
  for (let i = 0; i < 5; i++) assert.equal(coach(g, { id: 'me', ui }).text, a);
});

test('Spielende: Sieg, Niederlage, Unentschieden und der Hinweis auf „Noch eine Runde“', () => {
  const ctx = () => ({ id: 'me', ui: {} });
  const win = mk();
  [[0, 'me'], [3, 'bot1'], [1, 'me'], [4, 'bot1'], [2, 'me']].forEach(([p, id]) => M.place(win, id, p));
  let r = coach(win, ctx());
  assert.match(r.text, /gewinnst/); assert.equal(r.target, '[data-act="next"]'); checkOut(r);
  const lose = mk();
  [[0, 'me'], [3, 'bot1'], [1, 'me'], [4, 'bot1'], [8, 'me'], [5, 'bot1']].forEach(([p, id]) => M.place(lose, id, p));
  r = coach(lose, ctx());
  assert.match(r.text, /Computer hat eine Reihe/); checkOut(r);
  const draw = mk();
  [[0, 'me'], [1, 'bot1'], [2, 'me'], [4, 'bot1'], [3, 'me'], [5, 'bot1'], [7, 'me'], [6, 'bot1'], [8, 'me']].forEach(([p, id]) => M.place(draw, id, p));
  assert.equal(draw.winner, null);
  r = coach(draw, ctx());
  assert.match(r.text, /unentschieden/); checkOut(r);
});

test('Hinweise enthalten auch bei 5×5 keine Strategie und sagen „vier“', () => {
  const g = mk(true, true);
  const ui = {};
  const r1 = coach(g, { id: 'me', ui });
  M.place(g, 'me', 0); M.place(g, 'bot1', 1);
  const r2 = coach(g, { id: 'me', ui });
  checkOut(r1); checkOut(r2);
  assert.match(r2.text, /vier/);
  assert.doesNotMatch(r1.text + r2.text, STRATEGIE);
});
