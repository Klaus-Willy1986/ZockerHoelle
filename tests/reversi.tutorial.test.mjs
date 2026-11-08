import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../reversi/engine.js';
import { chooseAction } from '../reversi/ai.js';
import { coach } from '../reversi/tutorial.js';

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
// Keine Zugempfehlung: Wörter, die auf Ratschläge hindeuten, dürfen nicht vorkommen
const STRATEGIE = /(beste[rn]?|klug|am besten|blocke|verhindere|Falle|Trick|\bTipps?\b|empfehl|solltest|besser|Vorteil|wichtig)/i;
const mk = (humanFirst = true) => M.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], { hints: true });

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], board: [] }, { players: [{ id: 'me' }], board: [], scores: [], mode: 'play', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk(); g.board = null; checkOut(coach(g, ctx));
  const g2 = mk(); checkOut(coach(g2, { id: 'me', ui: { coachSeen: 7 } }));
  g2.scores = null; checkOut(coach(g2, ctx));
  const g3 = mk(); g3.mode = 'pass'; g3.passer = null; g3.final = null; checkOut(coach(g3, ctx));
  const g4 = mk(); g4.mode = 'over'; g4.final = 'x'; g4.winner = 0; checkOut(coach(g4, ctx));
  assert.equal(coach(mk(), { id: 'fremd', ui: {} }), null);
});

test('Partien Mensch (zufällig) gegen Bot: Hinweis immer sinnvoll, jede Erklärung genau einmal, keine Zugempfehlung', () => {
  const keys = [['goal', /^Ziel:/], ['place', /Du setzt einen Stein/], ['flip', /Eingeschlossene Steine/], ['corner', /In einer Ecke/], ['end', /Das Spiel endet/], ['pass', /Das nennt man Passen|muss passen\. Du bist wieder dran/]];
  const total = { goal: 0, place: 0, flip: 0, corner: 0, end: 0, pass: 0, over: 0, computer: 0, human: 0, passSteps: 0 };
  for (let seed = 1; seed <= 80; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const g = mk(humanFirst);
    const me = humanFirst ? 0 : 1;
    const ui = {};
    const ctx = { id: 'me', ui };
    const counts = {};
    const note = (text) => { for (const [k, re] of keys) if (re.test(text)) counts[k] = (counts[k] || 0) + 1; };
    const seen = new Set();
    for (let round = 0; round < 3; round++) {
      let guard = 0;
      while (g.mode !== 'over' && guard++ < 200) {
        const r = coach(g, ctx);
        checkOut(r);
        assert.ok(r, 'immer ein Hinweis');
        assert.ok(!STRATEGIE.test(r.text), 'Strategie: ' + r.text);
        if (g.mode === 'pass') {
          assert.equal(r.target, '[data-act="ack"]');
          total.passSteps++;
          note(r.text);
          M.handle(g, 'me', { t: 'ack' });
          continue;
        }
        if (g.turn === me) {
          assert.match(r.target, /legal/);
          note(r.text);
          total.human++;
          // dieselbe Stellung nochmal zeichnen: gleicher Text (stabil)
          assert.equal(coach(g, ctx).text, r.text);
          const legal = M.legalActions(g);
          M.handle(g, 'me', legal[Math.floor(rnd() * legal.length)]);
        } else {
          assert.match(r.text, /Computer/);
          assert.equal(r.target, undefined);
          total.computer++;
          M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rnd));
        }
        if (seen.size < 0) seen.add(r.text);
      }
      const r = coach(g, ctx);
      checkOut(r);
      assert.equal(r.target, '[data-act="next"]');
      assert.match(r.text, /Noch eine Runde/);
      assert.ok(!STRATEGIE.test(r.text), r.text);
      total.over++;
      const again = coach(g, ctx);
      assert.equal(again.text, r.text, 'Ende-Text bleibt beim Neuzeichnen gleich');
      M.handle(g, 'me', { t: 'next' });
    }
    for (const [k, n] of Object.entries(counts)) {
      if (k === 'pass') continue;
      assert.ok(n <= 3 * 1, `Erklärung ${k} zu oft: ${n}`);
    }
    // Regelerklärungen (außer Ende/Passen/Ecken) kommen in der ganzen Sitzung genau einmal
    for (const k of ['goal', 'place', 'flip']) assert.equal(counts[k] || 0, 1, `${k} genau einmal (Seed ${seed})`);
    assert.ok((counts.end || 0) <= 1 && (counts.corner || 0) <= 1, JSON.stringify(counts));
    for (const k of Object.keys(counts)) total[k] += counts[k];
  }
  console.log('# Coach:', JSON.stringify(total));
  assert.ok(total.corner > 0 && total.end > 0 && total.pass > 0, 'alle Erklärungen kommen vor');
});

test('Passen: Text für die Person, die passen muss, und für die andere', () => {
  const g = mk(true);
  g.mode = 'pass'; g.passer = 0; g.turn = 1;
  const a = coach(g, { id: 'me', ui: {} });
  assert.match(a.text, /Du kannst nicht ziehen.*Das nennt man Passen. Computer ist wieder dran/);
  assert.equal(a.target, '[data-act="ack"]');
  const ui = {};
  coach(g, { id: 'me', ui });
  g.moveNo = 5;
  const later = coach(g, { id: 'me', ui });
  assert.equal(later.text, 'Du kannst nicht ziehen, Computer ist wieder dran. Tippe auf OK.');
  g.passer = 1; g.turn = 0;
  const b = coach(g, { id: 'me', ui: {} });
  assert.match(b.text, /Computer kann keinen Stein einschließen und muss passen/);
});

test('Ecken-Hinweis nennt nur die Tatsache', () => {
  const g = mk(true);
  g.board[0] = 1;
  const ui = { coachSeen: { goal: 'x', place: 'x', flip: 'x' } };
  const r = coach(g, { id: 'me', ui });
  assert.match(r.text, /Ecken können nicht mehr umgedreht werden/);
  assert.ok(!STRATEGIE.test(r.text));
});
