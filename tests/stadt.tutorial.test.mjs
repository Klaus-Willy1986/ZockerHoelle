import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../stadt/engine.js';
import { coach, TUTORIAL_OPTS } from '../stadt/tutorial.js';
import { chooseAction } from '../stadt/ai.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const players = [{ id: 'me', name: 'Erna' }, { id: 'bot1', name: 'Computer' }];
const mkGame = (seed = 1) => Q.createGame(players, { ...TUTORIAL_OPTS, host: 'me' }, seeded(seed));
const mkCtx = () => ({ id: 'me', ui: {} });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${(r.text || '').length})`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => { const r = coach(g, ctx); assert.ok(r, `${where}: kein Coach`); check(r, where); return r; };
const WORDS = [['Berlin', 'Belgien', 'Biber'], ['Stuttgart', 'Spanien', 'Schaf']];

test('Die Lernrunde: 2 Runden, Buchstaben B und S, 3 Kategorien, kein Stopp', () => {
  const g = mkGame();
  assert.equal(g.rounds, 2); assert.deepEqual(g.letters, ['B', 'S']); assert.deepEqual(g.cats, ['stadt', 'land', 'tier']); assert.equal(g.stopOpt, false);
});

test('Führung vom Anfang bis zum Ende, wenn man nur dem Ziel folgt (jede Erklärung nur einmal)', () => {
  const g = mkGame();
  const ctx = mkCtx();
  const texts = []; const targets = [];
  let steps = 0; let last = '';
  const note = (r) => { if (r.text !== last) { texts.push(r.text); last = r.text; } targets.push(r.target); };
  while (g.phase !== 'over' && steps++ < 80) {
    const r = must(g, ctx, 'folgen ' + steps);
    note(r);
    if (g.phase === 'reveal') { assert.equal(r.target, '[data-act=next]'); Q.handle(g, 'me', { t: 'next' }); continue; }
    if (!g.done.me) {
      const mine = g.drafts.me;
      const idx = mine.findIndex((t) => !t);
      if (idx === -1) { assert.equal(r.target, '[data-act=done]'); assert.ok(Q.handle(g, 'me', { t: 'done' }).ok); continue; }
      assert.equal(r.target, `.sl-in[data-i="${idx}"]`);
      assert.ok(Q.handle(g, 'me', { t: 'fill', cat: idx, v: WORDS[g.round][idx] }).ok);
    } else {
      assert.equal(r.target, undefined, 'beim Warten kein Ziel');
      Q.handle(g, 'bot1', chooseAction(g, 'bot1', 0, seeded(5)));
    }
  }
  assert.equal(g.phase, 'over');
  const end = must(g, ctx, 'Ende');
  assert.equal(end.target, '[data-act=again]');
  assert.match(end.text, /Lernrunde ist zu Ende/);
  texts.push(end.text);
  assert.equal(new Set(texts).size, texts.length, 'Text doppelt: ' + texts.join(' | '));
  assert.ok(texts.length >= 9, 'Schritte: ' + texts.length);
  // erwähnte Knöpfe gibt es
  assert.ok(texts.some((t) => /Fertig/.test(t)) && texts.some((t) => /Nächste Runde/.test(t)) && texts.some((t) => /Zum Endergebnis/.test(t)));
  assert.ok(texts.some((t) => /10 Punkte/.test(t)) && texts.some((t) => /5\./.test(t) || /5 Punkte/.test(t)) && texts.some((t) => /ungeprüft/.test(t)) && texts.some((t) => /Buchstabe/.test(t)) && texts.some((t) => /Auflösung/.test(t)));
});

test('Ungeprüftes Wort wird erklärt (nur im Auflösungsschritt)', () => {
  const g = mkGame();
  Q.handle(g, 'me', { t: 'done', v: ['Blumenhausen', 'Belgien', 'Biber'] });
  Q.handle(g, 'bot1', chooseAction(g, 'bot1', 0, seeded(1)));
  const r = must(g, mkCtx(), 'ungeprüft');
  assert.match(r.text, /ungeprüft/);
  const h = mkGame();
  Q.handle(h, 'me', { t: 'done', v: ['Berlin', 'Belgien', 'Biber'] });
  Q.handle(h, 'bot1', chooseAction(h, 'bot1', 1, seeded(1)));
  assert.doesNotMatch(must(h, mkCtx(), 'bekannt').text, /ungeprüft/);
});

test('Keine Wort- oder Zugempfehlungen in den Texten', () => {
  const all = [];
  for (let seed = 1; seed <= 40; seed++) {
    const g = mkGame(seed);
    let n = 0;
    while (g.phase !== 'over' && n++ < 60) {
      const r = must(g, mkCtx(), 'zufall');
      all.push(r.text);
      if (g.phase === 'reveal') Q.handle(g, 'me', { t: 'next' });
      else if (!g.done.me) { const rr = seeded(seed + n); Q.handle(g, 'me', rr() < 0.5 ? { t: 'fill', cat: Math.floor(rr() * 3), v: 'Wort' } : { t: 'done' }); } else Q.handle(g, 'bot1', chooseAction(g, 'bot1', 0, seeded(seed)));
    }
  }
  const joined = all.join(' ');
  for (const w of ['Berlin', 'Belgien', 'Biber', 'Stuttgart', 'Spanien', 'Schaf', 'am besten', 'solltest', 'empfehle', 'Tipp:', 'Vorschlag']) assert.ok(!joined.includes(w), 'enthält ' + w);
});

test('Kaputte Eingaben: wirft nie, liefert null oder gültigen Coach', () => {
  const bads = [undefined, null, 0, 'x', [], {}, { game: 'sl' }, { game: 'sl', players: [] }, { game: 'sl', players: [{ id: 'me' }], cats: [] }, { game: 'sl', players: [{ id: 'me' }], cats: 5, phase: 'fill' },
    { game: 'sl', players: [{ id: 'me' }], cats: ['stadt'], phase: 'fill', drafts: { me: 'x' }, done: 5 },
    { game: 'sl', players: [null, { id: 'me' }], cats: ['stadt'], phase: 'reveal', reveal: { cats: [null, { rows: null }, 7] } },
    { game: 'sl', players: [{ id: 'me' }], cats: ['stadt'], phase: 'over' }, { game: 'sl', players: [{ id: 'me' }], cats: ['stadt'], phase: 'wasanderes' }];
  for (const b of bads) for (const c of [undefined, null, {}, { id: 'me' }, { id: 'x' }]) { assert.doesNotThrow(() => coach(b, c)); check(coach(b, c), 'kaputt'); }
  const g = mkGame(); g.round = 'x'; g.rounds = null; g.drafts = null;
  assert.doesNotThrow(() => coach(g, mkCtx()));
});
