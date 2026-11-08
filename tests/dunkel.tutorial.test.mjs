import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../dunkel/engine.js';
import { coach, LERN } from '../dunkel/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mk = () => Q.createGame([{ id: 'me', name: 'Erna' }], { mode: 'learn', host: 'me', fixed: LERN }, seeded(1), []);
const ctx = { id: 'me', ui: {} };

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 260, `${where}: Text (${(r.text || '').length})`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const stageKey = (g) => {
  const a = g.log.filter((e) => e.k === 'q').length; const c = g.log.filter((e) => e.k === 'g').length;
  if (g.phase !== 'play') return g.phase;
  if (c >= 2) return 'g2'; if (c === 1) return 'g1'; if (g.hints >= 1) return `h${g.hints}`; return `a${Math.min(a, 3)}`;
};

test('Coach liefert in jeder Lage der Lernrunde Text mit gültigem Selektor', () => {
  const g = mk();
  check(coach(g, ctx), 'Start');
  assert.ok(coach(g, ctx));
});

test('Führung vom Anfang bis zum Ende; jede Erklärung gehört zu genau einer Lage', () => {
  const g = mk();
  const textToStage = new Map(); const order = [];
  const see = () => {
    const r = coach(g, ctx); assert.ok(r, `kein Coach in ${stageKey(g)}`); check(r, stageKey(g));
    const s = stageKey(g);
    if (textToStage.has(r.text)) assert.equal(textToStage.get(r.text), s, `Text doppelt in verschiedenen Lagen: ${r.text}`);
    textToStage.set(r.text, s);
    if (order[order.length - 1] !== s) order.push(s);
    return r;
  };
  see();
  Q.handle(g, 'me', { t: 'ask', k: 0 }); see();
  Q.handle(g, 'me', { t: 'ask', k: 1 }); see();
  Q.handle(g, 'me', { t: 'ask', k: 2 }); see();
  Q.handle(g, 'me', { t: 'hint' }); see();
  Q.handle(g, 'me', { t: 'hint' }); see();
  Q.handle(g, 'me', { t: 'hint' }); see();
  Q.handle(g, 'me', { t: 'guess', k: 0 }); see();
  Q.handle(g, 'me', { t: 'guess', k: 1 }); see();
  Q.handle(g, 'me', { t: 'guess', k: 2 }); see();
  Q.handle(g, 'me', { t: 'next' }); see();
  assert.equal(new Set(textToStage.values()).size, textToStage.size, 'jede Lage hat einen eigenen Text');
  assert.ok(textToStage.size >= 9, `nur ${textToStage.size} Erklärungen`);
});

test('Viele zufällige Lernrunden: Coach wirft nie, Texte stets gültig, Lage und Text eindeutig', () => {
  const textToStage = new Map();
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed);
    const g = mk();
    for (let i = 0; i < 40 && g.phase !== 'over'; i++) {
      const r = coach(g, ctx); assert.ok(r, `Partie ${seed}`); check(r, `Partie ${seed}`);
      const s = stageKey(g);
      if (textToStage.has(r.text)) assert.equal(textToStage.get(r.text), s, r.text);
      textToStage.set(r.text, s);
      const pick = Math.floor(rng() * 4);
      if (pick === 0) Q.handle(g, 'me', { t: 'ask', k: Math.floor(rng() * 4) });
      else if (pick === 1) Q.handle(g, 'me', { t: 'hint' });
      else if (pick === 2) Q.handle(g, 'me', { t: 'guess', k: Math.floor(rng() * 3) });
      else Q.handle(g, 'me', { t: 'next' });
    }
    assert.ok(coach(g, ctx));
  }
});

test('Kaputte Eingaben: Coach gibt null statt zu werfen', () => {
  const g = mk();
  for (const bad of [null, undefined, 0, 'x', [], {}, { game: 'dr' }, { game: 'dr', mode: 'learn' }, { ...g, players: null }, { ...g, log: null }, { ...g, phase: 'wasauchimmer' }, { ...g, log: [null, 5, {}] }, { ...g, hints: 'x' }]) {
    assert.doesNotThrow(() => coach(bad, ctx));
    check(coach(bad, ctx), 'kaputt');
  }
  assert.equal(coach(g, null), null);
  assert.equal(coach(g, { id: 'fremd' }), null);
  assert.equal(coach({ ...g, mode: 'group' }, ctx), null, 'nur Lernrunde');
});

test('Keine Lösungsvorschläge: kein Text nennt die Lösung oder rät zu einer Antwortoption', () => {
  const g = mk();
  const bad = /kahl|keine haare|glatze|perücke|richtige antwort ist|du solltest|am besten|beste/i;
  const sol = LERN.riddle.loesung.toLowerCase();
  for (let step = 0; step < 12; step++) {
    const r = coach(g, ctx);
    if (!r) break;
    assert.ok(!bad.test(r.text), r.text);
    assert.ok(!r.text.toLowerCase().includes(sol));
    const m = [{ t: 'ask', k: step % 4 }, { t: 'hint' }, { t: 'guess', k: step % 3 }, { t: 'next' }][step % 4];
    Q.handle(g, 'me', m);
  }
});

test('Selektoren treffen nur bekannte Knöpfe', () => {
  const known = new Set(['lask', 'hint', 'lguess-open', 'lguess', 'next', 'again']);
  const g = mk();
  for (let step = 0; step < 14; step++) {
    const r = coach(g, ctx);
    for (const m of (r.target || '').matchAll(/data-act=([\w-]+)/g)) assert.ok(known.has(m[1]), m[1]);
    Q.handle(g, 'me', [{ t: 'ask', k: step % 4 }, { t: 'hint' }, { t: 'guess', k: step % 3 }, { t: 'next' }][step % 4]);
  }
});
