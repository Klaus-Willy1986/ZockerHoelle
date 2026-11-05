import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../maumau/engine.js';
import { chooseAction } from '../maumau/ai.js';
import { coach } from '../maumau/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { sel: null, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

test('Lernrunde gegen den Computer: in jedem Zustand gültiger Text, Ziel nur wenn ich handeln muss', () => {
  const texts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, rng, 'me');
    const ctx = mkCtx();
    let guard = 0;
    while (g.phase === 'play' && guard++ < 1000) {
      const ap = M.activePlayer(g);
      const r = must(g, ctx, `seed ${seed}`);
      texts.add(r.text);
      if (ap.id !== 'me') {
        if (!(g.mau && g.mau.pid === 'me' && !g.mau.called)) assert.equal(r.target, undefined);
        const msg = chooseAction(g, 'bot1', 0, rng);
        assert.equal(M.handle(g, 'bot1', msg, rng).ok, true);
        continue;
      }
      assert.ok(r.target, 'Ziel erwartet');
      // so spielt die Oberfläche: Bube und letzte Karte gehen über eine Auswahl
      const f = g.turn.forced;
      if (f === 'seven') assert.equal(r.target, '[data-act=draw]');
      if (f === 'eight') assert.equal(r.target, '[data-act=skip]');
      let msg;
      if (f === 'seven') msg = { t: 'draw' };
      else if (f === 'eight') msg = { t: 'skip' };
      else {
        const legal = M.legalCards(g, 'me');
        if (!legal.length) { assert.equal(r.target, '[data-act=draw]'); msg = g.turn.drew ? { t: 'pass' } : { t: 'draw' }; }
        else {
          const c = legal[0];
          const last = ap.hand.length === 1;
          if (last) { ctx.ui.sel = { card: c, last: true }; assert.equal(must(g, ctx, 'letzte').target, '[data-act=play-last]'); }
          else if (c.r === M.RJ) { ctx.ui.sel = { card: c, last: false }; assert.equal(must(g, ctx, 'wunsch').target, '[data-act=wish]'); }
          ctx.ui.sel = null;
          msg = { t: 'play', card: c, wish: 1, call: last };
        }
      }
      assert.equal(M.handle(g, 'me', msg, rng).ok, true);
      if (g.mau && g.mau.pid === 'me' && !g.mau.called) {
        const rm = must(g, ctx, 'Mau');
        assert.equal(rm.target, '[data-act=mau]');
        if (rng() < 0.8) M.handle(g, 'me', { t: 'mau' }, rng);
      }
    }
    assert.equal(g.phase, 'over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=next]');
  }
  const all = [...texts].join(' ');
  for (const w of ['Sieben', 'Acht', 'Buben', 'Mau', 'keine passende Karte']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Erklärungen kommen genau einmal, dann die kurze Form', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(3), 'me');
  g.discard = [{ s: 0, r: 5 }];
  g.players[0].hand = [{ s: 0, r: 0 }, { s: 0, r: 6 }, { s: 1, r: 2 }];
  g.active = 0;
  const ctx = mkCtx();
  const a = must(g, ctx, 'a');
  assert.ok(/sieben/i.test(a.text));
  assert.equal(must(g, ctx, 'a2').text, a.text); // gleiche Lage -> gleicher Text
  g.discard.push({ s: 0, r: 2 });
  const b = must(g, ctx, 'b');
  assert.notEqual(b.text, a.text);
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'mm' }, { game: 'mm', players: [] }, { game: 'mm', players: [{ id: 'me' }], turn: {} },
    { game: 'mm', players: [{ id: 'me', hand: null }], turn: {}, discard: [], phase: 'play', active: 3 }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { sel: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
