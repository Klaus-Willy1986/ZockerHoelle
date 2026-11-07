import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schaf/engine.js';
import { chooseAction } from '../schaf/ai.js';
import { coach } from '../schaf/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {} } });
const C = (s, r) => ({ s, r });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 230, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

// So spielt eine Person, die nur den Hinweisen folgt: Ziel -> Nachricht
function msgFor(target) {
  if (target === '[data-act=flip]') return { t: 'flip' };
  if (target === '[data-act=place]') return { t: 'place' };
  if (target === '[data-act=end]') return { t: 'end' };
  const m = /^\[data-act=steal\]\[data-pid="([^"]+)"\]$/.exec(target);
  assert.ok(m, 'Unbekanntes Ziel ' + target);
  return { t: 'place', from: m[1] };
}

test('Lernrunde gegen den Computer (Mittel): immer gültiger Text, Ziel nur wenn ich handeln muss, Hinweise führen zum Spielende', () => {
  const texts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, rng, 'me');
    const ctx = mkCtx();
    let guard = 0;
    while (g.phase === 'play' && guard++ < 5000) {
      const ap = M.activePlayer(g);
      const r = must(g, ctx, `seed ${seed}`);
      texts.add(r.text);
      if (ap.id !== 'me') {
        assert.equal(r.target, undefined);
        assert.equal(M.handle(g, 'bot1', chooseAction(g, 'bot1', 1, rng)).ok, true);
        continue;
      }
      assert.ok(r.target, 'Ziel erwartet: ' + r.text);
      const res = M.handle(g, 'me', msgFor(r.target));
      assert.equal(res.ok, true, 'Hinweis führt zu gültigem Zug: ' + r.target + ' ' + res.error);
    }
    assert.equal(g.phase, 'over');
    assert.ok(!g.last.penalty || g.last.penalty.pid !== 'me', 'Wer den Hinweisen folgt, bekommt keine Strafe');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
  }
  const all = [...texts].join(' ');
  for (const w of ['verdeckter Stapel', 'passt nicht', 'Elf', 'höher', 'tiefer', 'Strafkarten', 'Zug ist zu Ende', 'offene Karte']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Erklärungen kommen genau einmal, dann die kurze Form', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(3), 'me');
  g.active = 0; g.rows = [null, null, null, null];
  g.players[0].pile = [C(0, 11)]; g.players[0].deck = [C(1, 3)];
  const ctx = mkCtx();
  const a = must(g, ctx, 'a');
  assert.ok(/Elf/.test(a.text));
  assert.equal(a.target, '[data-act=place]');
  assert.equal(must(g, ctx, 'a2').text, a.text); // gleiche Lage -> gleicher Text
  g.moves += 1; // Lage hat sich geändert
  const b = must(g, ctx, 'b');
  assert.notEqual(b.text, a.text);
  assert.ok(!/Elf/.test(b.text));
});

test('Hinweis auf fremde Karte (Strafregel) und Strafe werden erklärt, je einmal', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(4), 'me');
  g.active = 0; g.rows = [{ lo: 11, hi: 11 }, null, null, null];
  g.players[0].pile = []; g.players[0].deck = [C(1, 3)];
  g.players[1].pile = [C(0, 12)]; g.players[1].deck = [C(1, 5)];
  const ctx = mkCtx();
  const a = must(g, ctx, 'steal');
  assert.equal(a.target, '[data-act=steal][data-pid="bot1"]');
  assert.ok(/Strafkarten/.test(a.text));
  g.moves += 1;
  assert.ok(!/Strafkarten/.test(must(g, ctx, 'steal2').text));
  // Strafe des Computers
  g.last = { seq: 1, kind: 'end', pid: 'bot1', name: 'Computer', text: 'x', penalty: { pid: 'bot1', name: 'Computer', text: 'y' } };
  g.active = 1; g.moves += 1;
  const p = must(g, ctx, 'strafe');
  assert.ok(/Schafskopp/.test(p.text));
  g.moves += 1;
  assert.ok(!/Schafskopp/.test(must(g, ctx, 'strafe2').text));
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'sk' }, { game: 'sk', players: [] }, { game: 'sk', players: [{ id: 'me' }], turn: {}, rows: [] },
    { game: 'sk', players: [{ id: 'me', deck: null, pile: null }], turn: {}, rows: [null, null, null, null], phase: 'play', active: 3 }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
