import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../bauern/engine.js';
import { chooseAction } from '../bauern/ai.js';
import { coach } from '../bauern/tutorial.js';

const sq = B.sq;
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validSel = (s) => typeof s === 'string' && s.length > 0 && /^[\w\s.#\-\[\]="':>,*()~+]+$/.test(s);
const checkOut = (r) => {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'), 'null oder Objekt');
  if (!r) return;
  assert.ok(r.text.trim().length > 0 && r.text.length <= 200, 'Text: ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  assert.ok(!/(beste|bester|empfehl|Tipps?\b|Vorsicht|Achtung|Gefahr|droht|Falle)/i.test(r.text), 'keine Strategie: ' + r.text);
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (players, opts) => B.createGame(players, opts);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], board: [] }, { players: [{ id: 'me' }], board: [], mode: 'play', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  const broken = { ...g, board: null };
  checkOut(coach(broken, ctx));
  checkOut(coach({ ...g, opts: undefined }, ctx));
  checkOut(coach(g, { id: 'me', ui: { sel: 'kaputt', coachSeen: 7 } }));
  checkOut(coach(g, { id: 'me', ui: { sel: 99 } }));
  checkOut(coach(g, { id: 'me', ui: { sel: -3 } }));
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});

test('Partien Mensch (zufällig) gegen Bot: Coach immer sinnvoll, Erklärungen je einmal', () => {
  const seen = { goal: 0, straight: 0, double: 0, diag: 0, capture: 0, ep: 0, blocked: 0, goalnear: 0, computer: 0, over: 0 };
  const keys = [
    ['goal', /Dein Ziel/], ['straight', /Ein Bauer zieht ein Feld geradeaus/], ['double', /Vom Startfeld aus/],
    ['diag', /Ein Bauer schlägt schräg/], ['capture', /Du kannst schräg schlagen/], ['ep', /im Vorbeigehen/],
    ['blocked', /direkt vor einem anderen/], ['goalnear', /letzte Reihe erreicht, gewinnt sofort/],
  ];
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const players = humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }];
    const g = mk(players);
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, tag) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(tag); };
    for (let round = 1; round <= 2; round++) {
      for (let ply = 0; ply < 200 && g.mode === 'play'; ply++) {
        const me = B.colorOf(g, 'me');
        if (g.turn === me) {
          const legal = B.legalMoves(g);
          const m = legal[Math.floor(rnd() * legal.length)];
          // Phase 1: nichts gewählt
          ui.sel = null;
          let r = coach(g, ctx);
          checkOut(r);
          assert.ok(r && r.target, 'Ziel beim Menschen');
          assert.match(r.target, /\.can/);
          note(r.text, `${g.round}.${g.moveNo}.pick`);
          assert.deepEqual(coach(g, ctx), r, 'gleicher Zustand, gleicher Text');
          // Phase 2: gewählt
          ui.sel = m.from;
          r = coach(g, ctx);
          checkOut(r);
          assert.match(r.target, /\.tgt/);
          note(r.text, `${g.round}.${g.moveNo}.sel`);
          assert.deepEqual(coach(g, ctx), r);
          ui.sel = null;
          assert.ok(B.move(g, 'me', m.from, m.to).ok);
        } else {
          const r = coach(g, ctx);
          checkOut(r);
          assert.match(r.text, /Computer/);
          assert.equal(r.target, undefined);
          seen.computer++;
          const a = chooseAction(g, 'bot1', 0, rnd);
          assert.ok(a && B.handle(g, 'bot1', a).ok);
        }
      }
      assert.equal(g.mode, 'over');
      const r = coach(g, ctx);
      checkOut(r);
      assert.equal(r.target, '[data-act="next"]');
      assert.match(r.text, /Noch eine Runde/);
      seen.over++;
      B.nextRound(g);
      if (round === 1) assert.ok(B.legalMoves(g).length > 0);
    }
    for (const [k, s] of Object.entries(shown)) {
      assert.ok(s.size <= 1, `${k} mehrfach erklärt: ${[...s]}`);
      seen[k] += 1;
    }
  }
  console.log('Abdeckung (Partien mit Erklärung)', JSON.stringify(seen));
  assert.ok(seen.goal > 0 && seen.straight > 0 && seen.computer > 0 && seen.over > 0);
  assert.ok(seen.diag + seen.capture > 0);
});

test('Erklärungen: Reihenfolge und Inhalt in der ersten Runde', () => {
  const g = mk([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  const ui = {};
  const ctx = { id: 'me', ui };
  let r = coach(g, ctx);
  assert.match(r.text, /Dein Ziel.*obersten Reihe/);
  assert.equal(r.target, 'button.bs-sq.can');
  ui.sel = sq('e2');
  r = coach(g, ctx);
  assert.match(r.text, /Ein Feld geradeaus/i);
  B.move(g, 'me', sq('e2'), sq('e3'));
  B.move(g, 'bot1', sq('d7'), sq('d5'));
  ui.sel = sq('a2');
  r = coach(g, ctx);
  assert.match(r.text, /zwei Felder geradeaus/);
  // Die Ziel-Erklärung kommt nicht noch einmal
  ui.sel = null;
  r = coach(g, ctx);
  assert.doesNotMatch(r.text, /Dein Ziel/);
  // Schwarz: unterste Reihe
  const s = mk([{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }]);
  B.move(s, 'bot1', sq('e2'), sq('e4'));
  assert.match(coach(s, { id: 'me', ui: {} }).text, /untersten Reihe/);
});

test('Schlagen, im Vorbeigehen, Blockade und Ende werden erklärt', () => {
  const setup = (pieces, turn = 0) => { const g = mk([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]); g.board = Array(64).fill(0); for (const [k, v] of Object.entries(pieces)) g.board[sq(k)] = v === 'w' ? 1 : 2; g.turn = turn; return g; };
  const ui = { coachSeen: { goal: 'x' } };
  const g = setup({ e4: 'w', d5: 'b', a2: 'w', h7: 'b' });
  assert.match(coach(g, { id: 'me', ui }).text, /schräg schlagen/);
  const h = setup({ e5: 'w', d7: 'b', h7: 'b', a2: 'w' }, 1);
  B.move(h, 'bot1', sq('d7'), sq('d5'));
  const ui2 = { coachSeen: { goal: 'x', capture: 'x' } };
  assert.match(coach(h, { id: 'me', ui: ui2 }).text, /Vorbeigehen/);
  const k = setup({ e4: 'w', e5: 'b', a2: 'w', h7: 'b' });
  assert.match(coach(k, { id: 'me', ui: { coachSeen: { goal: 'x' } } }).text, /blockiert/);
  // Ende: Blockade, Durchbruch, alles geschlagen
  const e1 = setup({ e3: 'w', e5: 'b' });
  B.move(e1, 'me', sq('e3'), sq('e4'));
  assert.match(coach(e1, { id: 'me', ui: {} }).text, /nicht ziehen/);
  const e2 = setup({ e7: 'w', a2: 'b' });
  B.move(e2, 'me', sq('e7'), sq('e8'));
  assert.match(coach(e2, { id: 'me', ui: {} }).text, /Durchbruch/);
  const e3 = setup({ e4: 'w', d5: 'b', a2: 'w' });
  B.move(e3, 'me', sq('e4'), sq('d5'));
  assert.match(coach(e3, { id: 'me', ui: {} }).text, /alle Bauern/);
  const e4 = setup({ d2: 'b', a7: 'w' }, 1);
  B.handle(e4, 'bot1', { t: 'move', from: sq('d2'), to: sq('d1') });
  assert.match(coach(e4, { id: 'me', ui: {} }).text, /Computer hat gewonnen/);
});
