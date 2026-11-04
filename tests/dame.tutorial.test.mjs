import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../dame/engine.js';
import { chooseAction } from '../dame/ai.js';
import { coach } from '../dame/tutorial.js';

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

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], board: [] }, { players: [{ id: 'me' }], board: [], mode: 'normal', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = D.createGame([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  g.board = null;
  checkOut(coach(g, ctx));
  const g2 = D.createGame([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  checkOut(coach(g2, { id: 'me', ui: { path: 'kaputt', coachSeen: 7 } }));
  checkOut(coach(g2, { id: 'me', ui: { path: [99, -3] } }));
  assert.equal(coach(g2, { id: 'fremd', ui: {} }), null);
});

test('Partien Mensch (zufällig) gegen Bot: Coach immer sinnvoll, Erklärungen je einmal', () => {
  const seen = { capture: 0, multi: 0, dame: 0, basic: 0, computer: 0, over: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const players = humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }];
    const g = D.createGame(players);
    const me = humanFirst ? 0 : 1;
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, ply) => {
      const keys = [['capture', /Wenn du schlagen kannst/], ['multi', /Wenn es nach dem Sprung/], ['dame', /Ein Stein mit Krone/], ['basic', /Ein Stein zieht ein Feld/]];
      for (const [k, re] of keys) if (re.test(text)) { (shown[k] = shown[k] || new Set()).add(ply); }
    };
    for (let ply = 0; ply < 300 && g.mode === 'normal'; ply++) {
      if (g.turn === me) {
        const legal = D.legalMoves(g);
        const m = legal[Math.floor(rnd() * legal.length)];
        for (let k = 1; k <= m.path.length; k++) {
          ui.path = m.path.slice(0, k - 1);
          const r = coach(g, ctx);
          checkOut(r);
          assert.ok(r && r.target, 'Ziel beim Menschen');
          note(r.text, g.moveNo);
          if (k === 1) assert.match(r.target, /can/);
          else assert.match(r.target, /tgt/);
          if (k >= 3) seen.multi++;
        }
        // mehrfaches Zeichnen im selben Zustand bleibt gleich
        ui.path = [];
        assert.deepEqual(coach(g, ctx), coach(g, ctx));
        if (D.legalMoves(g).some((x) => x.caps.length)) seen.capture++;
        ui.path = [];
        assert.ok(D.move(g, 'me', m.path).ok);
      } else {
        const r = coach(g, ctx);
        checkOut(r);
        assert.match(r.text, /Computer/);
        assert.equal(r.target, undefined);
        seen.computer++;
        const a = chooseAction(g, 'bot1', 0);
        assert.ok(a && D.handle(g, 'bot1', a).ok);
      }
    }
    if (g.mode === 'over') {
      const r = coach(g, ctx);
      checkOut(r);
      assert.equal(r.target, '[data-act="again"]');
      seen.over++;
    }
    for (const [k, s] of Object.entries(shown)) assert.ok(s.size <= 1, `${k} mehrfach erklärt: ${[...s]}`);
    seen.dame += shown.dame ? 1 : 0;
    seen.basic += shown.basic ? 1 : 0;
  }
  assert.ok(seen.computer > 0 && seen.basic > 0);
  console.log('Abdeckung', seen);
});

test('Remis-Angebot und Spielende', () => {
  const g = D.createGame([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  g.drawOffer = 1;
  let r = coach(g, { id: 'me', ui: {} });
  checkOut(r);
  assert.match(r.text, /Remis/);
  assert.match(r.target, /draw-accept/);
  g.drawOffer = 0;
  r = coach(g, { id: 'me', ui: {} });
  checkOut(r);
  assert.equal(r.target, undefined);
  g.drawOffer = null;
  D.resign(g, 'me');
  r = coach(g, { id: 'me', ui: {} });
  assert.equal(r.target, '[data-act="again"]');
});
