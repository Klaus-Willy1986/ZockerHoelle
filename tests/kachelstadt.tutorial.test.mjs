import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../kachelstadt/engine.js';
import { chooseAction } from '../kachelstadt/ai.js';
import { coach } from '../kachelstadt/tutorial.js';

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
  assert.ok(!/Carcassonne|Meeple/i.test(r.text), 'neutrale Namen');
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (rng, humanFirst = true) => E.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], {}, rng);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { game: 'ks', players: [], board: {} }, { game: 'ks', players: [{ id: 'me' }], board: {}, phase: 'place', active: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk(seeded(1));
  g.board = null;
  checkOut(coach(g, ctx));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { rot: 'kaputt', coachSeen: 7 } }));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { rot: 99 } }));
  const g2 = mk(seeded(3));
  g2.recap = null;
  checkOut(coach(g2, ctx));
  assert.equal(coach(mk(seeded(4)), { id: 'fremd', ui: {} }), null);
});

test('Partien Mensch (zufällig) gegen Bot: Coach immer sinnvoll, Erklärungen je einmal', () => {
  const keys = [['place1', /Das ist dein Plättchen/], ['alt', /Helle Felder/], ['meeple1', /Jetzt darfst du einen Gefolgsmann/], ['kinds', /Ritter stehen in Städten/], ['farmer', /Ein Bauer bleibt/], ['score', /Eine Wertung/], ['empty', /Alle deine Gefolgsleute/]];
  const seen = {}; let computer = 0, over = 0, place = 0, meeple = 0, targets = 0, games = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = seeded(seed);
    const humanFirst = seed % 2 === 1;
    const g = mk(rnd, humanFirst);
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, ply) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(ply); };
    let ply = 0;
    for (; ply < 600 && g.phase !== 'over'; ply++) {
      const r = coach(g, ctx);
      checkOut(r);
      const ap = E.activePlayer(g);
      if (ap.id === 'me') {
        assert.ok(r && r.target, 'Mensch dran: Ziel erwartet');
        targets++;
        note(r.text, g.round);
        if (g.phase === 'place') {
          place++;
          const l = E.legalPlacements(g);
          ui.rot = rnd() < 0.5 ? 0 : Math.floor(rnd() * 4);
          checkOut(coach(g, ctx));
          const m = l[Math.floor(rnd() * l.length)];
          assert.ok(E.placeTile(g, 'me', m.x, m.y, m.r).ok);
        } else {
          meeple++;
          const o = E.meepleOptions(g);
          assert.ok(o.length > 0);
          E.placeMeeple(g, 'me', rnd() < 0.6 ? o[Math.floor(rnd() * o.length)].seg : null);
        }
      } else {
        assert.ok(/Computer/.test(r.text), 'Computer-Text: ' + r.text);
        note(r.text, g.round);
        computer++;
        E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rnd));
      }
    }
    games++;
    const last = coach(g, ctx);
    checkOut(last);
    assert.ok(/zu Ende/.test(last.text) && last.target === '[data-act="again"]');
    over++;
    for (const [k, s] of Object.entries(shown)) { assert.equal(s.size, 1, `${k} nur einmal (Zug ${[...s]})`); seen[k] = (seen[k] || 0) + 1; }
  }
  assert.equal(over, 30);
  assert.ok(seen.place1 >= 25 && seen.meeple1 >= 20 && seen.kinds >= 15, JSON.stringify(seen));
  assert.ok(seen.score >= 5, 'Wertung wird erklärt: ' + JSON.stringify(seen));
  assert.ok(place > 100 && meeple > 50 && computer > 100 && targets > 100);
  console.log('Erklärungen (Partien):', JSON.stringify(seen), 'Spiele', games);
});
