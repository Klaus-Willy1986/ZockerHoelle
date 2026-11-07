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
  if (target === '[data-act=place-center]') return { t: 'place', to: 'center' };
  if (target === '[data-act=place-own]') return { t: 'place', to: 'own' };
  const m = /^\[data-act=place-other\]\[data-pid="([^"]+)"\]$/.exec(target);
  assert.ok(m, 'Unbekanntes Ziel ' + target);
  return { t: 'place', to: 'other', pid: m[1] };
}

test('Lernrunde gegen den Computer (Mittel): immer gültiger Text, Ziel nur wenn ich handeln muss, Hinweise führen zum Spielende ohne Fehler', () => {
  const texts = new Set();
  for (let seed = 1; seed <= 60; seed++) {
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
      assert.ok(!res.schafskopp, 'Wer den Hinweisen folgt, macht keinen Fehler');
    }
    assert.equal(g.phase, 'over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
  }
  const all = [...texts].join(' ');
  for (const w of ['verdeckter Stapel', 'Elf', 'aufdrücken', 'Bei mir ablegen', 'Schafskopp', 'offene Karte prüfen']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Erklärungen kommen genau einmal, dann die kurze Form', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(3), 'me');
  g.active = 0; g.rows = [null, null, null, null];
  g.players[0].pile = []; g.players[0].deck = [C(1, 3)]; g.flipped = C(0, 11); g.source = 'flipped';
  const ctx = mkCtx();
  const a = must(g, ctx, 'a');
  assert.ok(/Elf/.test(a.text));
  assert.equal(a.target, '[data-act=place-center]');
  assert.equal(must(g, ctx, 'a2').text, a.text); // gleiche Lage -> gleicher Text
  g.moves += 1;
  const b = must(g, ctx, 'b');
  assert.notEqual(b.text, a.text);
  assert.ok(!/Elf/.test(b.text));
});

test('Aufdrücken (mit Beispiel), Bei-mir-ablegen, Gesetz 1 und Strafe werden erklärt, je einmal', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(4), 'me');
  g.active = 0; g.rows = [{ lo: 11, hi: 11 }, null, null, null];
  g.players[0].pile = []; g.players[0].deck = [C(1, 3)];
  g.players[1].pile = [C(2, 14)]; g.players[1].deck = [C(1, 5)];
  g.flipped = C(2, 13); g.source = 'flipped';
  const ctx = mkCtx();
  const a = must(g, ctx, 'other');
  assert.equal(a.target, '[data-act=place-other][data-pid="bot1"]');
  assert.ok(/aufdrücken/.test(a.text));
  g.moves += 1;
  assert.ok(!/aufdrücken/.test(must(g, ctx, 'other2').text));
  g.flipped = C(3, 9);
  assert.equal(must(g, ctx, 'own').target, '[data-act=place-own]');
  // Gesetz 1: offene Karte
  g.flipped = null; g.players[0].pile = [C(0, 12)]; g.source = 'open'; g.moves += 1;
  const l1 = must(g, ctx, 'law1');
  assert.ok(/offene Karte prüfen/.test(l1.text));
  assert.equal(l1.target, '[data-act=place-center]');
  // Strafe
  g.last = { seq: 1, kind: 'flip', pid: 'bot1', name: 'Computer', text: 'x', penalty: { pid: 'bot1', name: 'Computer', reason: 'a', got: 1, text: 'y' } };
  g.active = 1; g.moves += 1;
  assert.ok(/Schafskopp/.test(must(g, ctx, 'strafe').text));
  g.moves += 1;
  assert.ok(!/Schafskopp/.test(must(g, ctx, 'strafe2').text));
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'sk' }, { game: 'sk', players: [] }, { game: 'sk', players: [{ id: 'me' }], turn: {}, rows: [] },
    { game: 'sk', players: [{ id: 'me', deck: null, pile: null }], rows: [null, null, null, null], phase: 'play', active: 0, source: 'flipped', flipped: { s: 1, r: 4 } }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
