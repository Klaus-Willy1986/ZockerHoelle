import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../muehle/engine.js';
import { chooseAction } from '../muehle/ai.js';
import { coach } from '../muehle/tutorial.js';

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
const mk = (humanFirst = true) => M.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }]);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], board: [] }, { players: [{ id: 'me' }], board: [], mode: 'play', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk();
  g.board = null;
  checkOut(coach(g, ctx));
  const g2 = mk();
  checkOut(coach(g2, { id: 'me', ui: { sel: 'kaputt', coachSeen: 7 } }));
  checkOut(coach(g2, { id: 'me', ui: { sel: 99 } }));
  g2.toPlace = null;
  checkOut(coach(g2, ctx));
  assert.equal(coach(mk(), { id: 'fremd', ui: {} }), null);
});

test('Partien Mensch (zufällig) gegen Bot: Coach immer sinnvoll, Erklärungen je einmal', () => {
  const keys = [['place', /Setze abwechselnd/], ['mill', /Drei Steine in einer Reihe/], ['protect', /sind geschützt/], ['move', /benachbarten freien Punkt/], ['fly', /fliegen/]];
  const total = { place: 0, mill: 0, protect: 0, move: 0, fly: 0, computer: 0, over: 0, remove: 0, target: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const g = mk(humanFirst);
    const me = humanFirst ? 0 : 1;
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, ply) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(ply); };
    for (let ply = 0; ply < 400 && g.mode === 'play'; ply++) {
      if (g.turn === me) {
        const legal = M.legalActions(g);
        const m = legal[Math.floor(rnd() * legal.length)];
        ui.sel = null;
        const r = coach(g, ctx);
        checkOut(r);
        assert.ok(r && r.target, 'Ziel beim Menschen');
        note(r.text, `${g.moveNo}${g.removing}`);
        if (g.removing) { total.remove++; assert.match(r.target, /rem/); }
        else if (g.toPlace[me] > 0) assert.match(r.target, /free/);
        else assert.match(r.target, /can/);
        assert.deepEqual(coach(g, ctx), r, 'gleicher Zustand, gleiche Antwort');
        if (m.t === 'move') {
          ui.sel = m.from;
          const r2 = coach(g, ctx);
          checkOut(r2);
          assert.match(r2.target, /target/);
          note(r2.text, `${g.moveNo}${g.removing}`);
          total.target++;
        }
        ui.sel = null;
        assert.ok(M.handle(g, 'me', m).ok);
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
    if (g.mode === 'over') {
      const r = coach(g, ctx);
      checkOut(r);
      assert.equal(r.target, '[data-act="again"]');
      total.over++;
    }
    for (const [k, s] of Object.entries(shown)) { assert.ok(s.size <= 1, `${k} mehrfach erklärt: ${[...s]}`); total[k] += 1; }
  }
  assert.ok(total.computer > 0 && total.place > 0 && total.mill > 0 && total.move > 0 && total.target > 0 && total.over > 0);
  console.log('Abdeckung', total);
});

test('Flug-Erklärung bei drei Steinen, Remis-Angebot und Spielende', () => {
  const g = mk();
  g.toPlace = [0, 0];
  g.board = Array(24).fill(null);
  [0, 3, 12].forEach((p) => { g.board[p] = 0; });
  [5, 9, 14, 20].forEach((p) => { g.board[p] = 1; });
  const ui = {};
  let r = coach(g, { id: 'me', ui });
  checkOut(r);
  assert.match(r.text, /fliegen/);
  assert.match(coach(g, { id: 'me', ui }).text, /fliegen/, 'bleibt im selben Zug stehen');
  g.moveNo++;
  assert.doesNotMatch(coach(g, { id: 'me', ui }).text, /fliegen/);
  g.drawOffer = 1;
  r = coach(g, { id: 'me', ui: {} });
  checkOut(r);
  assert.match(r.text, /Remis/);
  assert.match(r.target, /draw-accept/);
  g.drawOffer = 0;
  r = coach(g, { id: 'me', ui: {} });
  checkOut(r);
  assert.equal(r.target, undefined);
  g.drawOffer = null;
  M.resign(g, 'me');
  r = coach(g, { id: 'me', ui: {} });
  assert.equal(r.target, '[data-act="again"]');
});
