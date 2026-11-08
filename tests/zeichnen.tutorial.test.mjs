import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../zeichnen/engine.js';
import { coach, STUFEN } from '../zeichnen/tutorial.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEL = /^[\[\]\w=":.,\s()>#-]+$/;
const players = [{ id: 'me', name: 'Erna' }, { id: 'bot1', name: 'Computer' }];
const mkGame = (seed = 1) => Q.createGame(players, { mode: 'learn', host: 'me', now: 0 }, seedRng(seed));
const ctx = { id: 'me', ui: {} };
const STRICH = (g, k) => ({ t: 'stroke', pts: [[10 * k, 10], [20 * k, 40]], c: k % 6, w: k % 3, k });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 260, `${where}: Text (${(r.text || '').length})`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
// Keine Tipps zum Zeichnen oder Raten, keine "bester Zug"-Sprache
const TIPP = /\b(am besten|tipp:|empfehle|empfehlung|besser wäre|solltest du zeichnen|zeichne lieber|rate lieber)\b/i;

test('Führung vom Anfang bis zum Ende: Stufen in fester Reihenfolge, jede Erklärung nur einmal', () => {
  const g = mkGame();
  const texts = [];
  const note = (where) => { const r = coach(g, ctx); assert.ok(r, where); check(r, where); texts.push(r.text); return r; };
  note('Start');
  for (let k = 1; k <= 5; k++) { Q.handle(g, 'me', STRICH(g, k), Math.random, 0); note('Strich ' + k); }
  Q.handle(g, 'bot1', { t: 'guess', text: 'Zelt' }, Math.random, 1000); note('Zelt');
  Q.handle(g, 'bot1', { t: 'guess', text: 'Haus' }, Math.random, 2000);
  assert.equal(g.phase, 'result');
  const rr = note('Auflösung'); assert.equal(rr.target, '[data-act=next]');
  Q.handle(g, 'me', { t: 'next' }, Math.random, 3000);
  assert.equal(g.phase, 'over');
  const oo = note('Ende'); assert.equal(oo.target, '[data-act=again]');
  // Reihenfolge und Einmaligkeit
  for (let i = 1; i < texts.length; i++) assert.ok(texts[i] === texts[i - 1] || !texts.slice(0, i - 1).includes(texts[i]), 'Text kehrt wieder: ' + texts[i]);
  assert.equal(new Set(texts).size, STUFEN.length, 'alle Stufen kamen genau einmal dran');
});
test('Jede Stufe hat einen eigenen Text, keine Tipps, Ziele zeigen auf vorhandene Knöpfe', () => {
  const g = mkGame();
  const seen = new Map();
  const probe = (label) => { const r = coach(g, ctx); assert.ok(r, label); assert.ok(!TIPP.test(r.text), r.text); seen.set(r.text, r.target); };
  probe('s0');
  for (let k = 1; k <= 4; k++) { Q.handle(g, 'me', STRICH(g, k), Math.random, 0); probe('s' + k); }
  Q.handle(g, 'bot1', { t: 'guess', text: 'Zelt' }); probe('chat');
  Q.handle(g, 'bot1', { t: 'guess', text: 'Haus' }); probe('result');
  Q.handle(g, 'me', { t: 'next' }); probe('over');
  assert.equal(seen.size, STUFEN.length);
  const sels = [...seen.values()].join(',');
  for (const s of ['#board', '.zr-timewrap', '.zr-chat', '[data-act=next]', '[data-act=again]', '[data-act=tool-e]', '[data-act=undo]', '[data-act=clear]']) assert.ok(sels.includes(s), s);
});
test('Der Text hängt nur an nie sinkenden Zählern: Rückgängig/Löschen bringt keinen alten Text zurück', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = seedRng(seed);
    const g = mkGame(seed);
    const texts = [];
    let steps = 0; let now = 0;
    while (g.phase !== 'over' && steps++ < 400) {
      now += 500;
      const r = rng();
      if (g.phase === 'result') Q.handle(g, 'me', { t: 'next' }, rng, now);
      else if (r < 0.4) Q.handle(g, 'me', STRICH(g, g.sk + 1), rng, now);
      else if (r < 0.55) Q.handle(g, 'me', { t: rng() < 0.5 ? 'undo' : 'clear' }, rng, now);
      else if (r < 0.7) Q.handle(g, 'bot1', { t: 'guess', text: ['Zelt', 'Baum', 'Haus'][Math.floor(rng() * 3)] }, rng, now);
      else if (r < 0.75) Q.handle(g, 'me', { t: 'guess', text: 'Haus' }, rng, now);
      else if (r < 0.8) Q.handle(g, 'me', { t: 'skip' }, rng, now);
      else Q.handle(g, 'bot1', { t: 'stroke', pts: [[1, 1]], c: 0, w: 0 }, rng, now);
      const c = coach(g, ctx);
      if (c) { check(c, 'Seed ' + seed); if (texts[texts.length - 1] !== c.text) { assert.ok(!texts.includes(c.text), `Seed ${seed}: Text wiederholt: ${c.text}`); texts.push(c.text) } }
    }
    assert.ok(texts.length <= STUFEN.length);
  }
});
test('Kaputte Eingaben werfen nie', () => {
  const bad = [null, undefined, 0, 'x', [], {}, { game: 'zr' }, { game: 'zr', mode: 'learn' }, { game: 'zr', mode: 'learn', players: 5 }, { game: 'zr', mode: 'learn', players: [null] },
    { game: 'zr', mode: 'learn', players: players, phase: 'draw', sk: 'x', nc: null }, { game: 'zr', mode: 'learn', players: players, phase: 'quatsch' }, { ...mkGame(), phase: 7 }, { ...mkGame(), sk: -3, nc: NaN }];
  for (const g of bad) { assert.doesNotThrow(() => coach(g, ctx)); assert.doesNotThrow(() => coach(g, null)); assert.doesNotThrow(() => coach(g, {})); }
  assert.equal(coach(mkGame(), null), null);
  assert.equal(coach(mkGame(), { id: 'fremd' }), null);
  const online = Q.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { host: 'a' }, seedRng(1));
  assert.equal(coach(online, { id: 'a' }), null, 'nur in der Lernrunde');
});
