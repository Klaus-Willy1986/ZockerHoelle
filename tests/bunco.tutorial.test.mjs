import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../bunco/engine.js';
import { chooseAction } from '../bunco/ai.js';
import { coach } from '../bunco/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {} } });
const NEW = (seed) => M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(seed));
const ADVICE = /am besten|besser|empfehl|solltest|Tipp:|lieber|klug|Strategie|rate ich/i;

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 230, `${where}: Text (${r.text.length}) "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  assert.ok(!ADVICE.test(r.text), `${where}: Empfehlung "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

test('Lernrunde gegen den Computer: Text immer gültig, Ziel nur wenn ich handeln muss, Spiel endet', () => {
  const texts = new Map();
  let ended = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const rng = seeded(seed * 3);
    const g = NEW(seed);
    const ctx = mkCtx();
    let n = 0;
    while (g.phase !== 'over' && n++ < 20000) {
      const r = coach(g, ctx);
      assert.ok(r, 'kein Coach in Phase ' + g.phase);
      check(r, `seed ${seed} Zug ${g.moves}`);
      texts.set(r.text, (texts.get(r.text) || 0) + 1);
      const mine = g.phase === 'between' || M.activePlayer(g).id === 'me';
      if (mine) {
        assert.ok(r.target, 'Ziel erwartet');
        if (r.target === '[data-act=roll]') assert.equal(g.phase, 'roll');
        if (r.target === '[data-act=next]') assert.equal(g.phase, 'between');
        const res = r.target === '[data-act=next]' ? M.handle(g, 'me', { t: 'next' }) : M.handle(g, 'me', { t: 'roll' }, rng);
        assert.equal(res.ok, true, res.error);
      } else {
        assert.equal(M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng).ok, true);
      }
    }
    assert.equal(g.phase, 'over');
    const r = coach(g, ctx);
    check(r, 'Ende');
    assert.equal(r.target, '[data-act=again]');
    ended++;
  }
  assert.equal(ended, 80);
  console.log('verschiedene Texte:', texts.size);
});

test('Jede Erklärung kommt nur einmal (pro Partie)', () => {
  const once = ['Oben steht die Zielzahl', 'Eine neue Runde hat begonnen', 'Mini-Bunco: Drei gleiche', 'Treffer! Wer Punkte macht', 'Kein Treffer: Dann ist die nächste', 'Bunco! Drei Würfel', 'Wer in einer Runde 21 Punkte erreicht'];
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const g = NEW(seed + 100);
    const ctx = mkCtx();
    const seen = {}; let prev = '';
    let n = 0;
    while (g.phase !== 'over' && n++ < 20000) {
      const r = coach(g, ctx);
      for (const k of once) {
        if (r.text.startsWith(k) || r.text.includes(k)) {
          if (r.text !== prev || seen[k] === undefined) seen[k] = (seen[k] || 0) + (r.text !== prev ? 1 : 0);
          assert.ok(seen[k] <= 1, `Seed ${seed}: "${k}" mehrfach`);
        }
      }
      prev = r.text;
      if (g.phase === 'between') M.handle(g, 'me', { t: 'next' });
      else if (M.activePlayer(g).id === 'me') M.handle(g, 'me', { t: 'roll' }, rng);
      else M.handle(g, 'bot1', { t: 'roll' }, rng);
    }
  }
});

test('Coach: kaputte Eingaben werfen nie', () => {
  const bad = [null, undefined, 5, 'x', {}, { game: 'bc' }, { game: 'bc', players: 'x' }, { game: 'bc', players: [], phase: 'roll' }, { game: 'bc', players: [{ id: 'me' }], phase: 'roll', active: 9 }, { game: 'bc', players: [{ id: 'me' }], phase: 'roll', active: 0, last: 5 }];
  for (const b of bad) for (const c of [null, undefined, {}, { id: 'me' }, { id: 'me', ui: 5 }, mkCtx()]) {
    assert.doesNotThrow(() => coach(b, c));
    const r = coach(b, c);
    assert.ok(r === null || typeof r.text === 'string');
  }
});

test('Erster Hinweis erklärt die Zielzahl; Coach nennt nie eine Empfehlung', () => {
  const g = NEW(5);
  const r = coach(g, mkCtx());
  assert.match(r.text, /Zielzahl/);
  assert.equal(r.target, '[data-act=roll]');
});
