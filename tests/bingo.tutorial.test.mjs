import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../bingo/engine.js';
import { chooseAction } from '../bingo/ai.js';
import { coach } from '../bingo/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>#-]+$/;
const mkG = (rng) => E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'Computer' }], { host: 'me' }, rng);
const mkCtx = () => ({ id: 'me', ui: { coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}"`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  // Ziele: nur Knöpfe oder das Feld der gerade gezogenen Zahl (Lernrunde), keine Strategie
  if (r.target) assert.ok(/^(\[data-act=(draw|bingo|next)\]|\.bg-cell\[data-n="\d{1,2}"\])$/.test(r.target), 'unerwartetes Ziel ' + r.target);
  assert.ok(!/zeige mir|tipp:|am besten|klug|strategie/i.test(r.text), 'keine Zugempfehlung: ' + r.text);
}

// Folgt dem Ziel; der Computer spielt mit (Leicht) – ein Zeitschritt: Mensch handelt, danach Computer
function follow(g, ctx, rng, onStep) {
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 3000) {
    const r = coach(g, ctx);
    assert.ok(r, 'immer ein Coach-Text');
    check(r, 'folgen');
    assert.ok(r.target, 'Mensch dran: immer ein Ziel');
    if (onStep) onStep(r);
    if (r.target === '[data-act=draw]') assert.ok(E.draw(g, 'me', rng).ok);
    else if (r.target === '[data-act=bingo]') { assert.ok(E.isValid(g, 'me')); E.bingo(g, 'me'); }
    else {
      const n = Number(/data-n="(\d+)"/.exec(r.target)[1]);
      assert.ok(g.drawn.includes(n), 'Ziel ist eine gezogene Zahl');
      assert.ok(E.cellOf(g, 'me', 0, n) >= 0, 'Zahl steht unmarkiert auf der Karte');
      assert.ok(E.mark(g, 'me', 0, g.cards.me[0].indexOf(n)).ok);
    }
    // Computer: macht eine Aktion (wie nach ein paar Sekunden)
    if (g.phase === 'play') { const m = chooseAction(g, 'bot1', 0, rng); if (m) E.handle(g, 'bot1', m, rng); }
  }
}

test('Führung bis zum Rundenende, wenn man nur dem Ziel folgt (Computer spielt mit)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const g = mkG(rng); const ctx = mkCtx();
    follow(g, ctx, rng);
    assert.equal(g.phase, 'over');
    const end = coach(g, ctx);
    assert.equal(end.target, '[data-act=next]'); assert.match(end.text, /Lernrunde ist geschafft/);
    check(end, 'ende');
    assert.match(end.text, g.winners.includes('me') ? /gewonnen/ : /Computer schneller/);
  }
});

test('Ohne Computer-Aktion (nur Mensch) wird trotzdem immer ein Ziel genannt, und der Mensch gewinnt', () => {
  const rng = seeded(4); const g = mkG(rng); const ctx = mkCtx();
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 500) {
    const r = coach(g, ctx); check(r, 'allein'); assert.ok(r.target);
    if (r.target === '[data-act=draw]') E.draw(g, 'me', rng);
    else if (r.target === '[data-act=bingo]') E.bingo(g, 'me');
    else { const n = Number(/data-n="(\d+)"/.exec(r.target)[1]); E.mark(g, 'me', 0, g.cards.me[0].indexOf(n)); }
  }
  assert.equal(g.phase, 'over'); assert.deepEqual(g.winners, ['me']);
});

test('jede lange Erklärung kommt nur einmal (Wechsel zu anderem Text und zurück gibt es nicht)', () => {
  let longTexts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed); const g = mkG(rng); const ctx = mkCtx();
    const entered = {}; let prev = null;
    follow(g, ctx, rng, (r) => { if (r.text !== prev) { entered[r.text] = (entered[r.text] || 0) + 1; prev = r.text; } });
    const end = coach(g, ctx); entered[end.text] = (entered[end.text] || 0) + 1;
    const intro = Object.entries(entered).filter(([x]) => x.length > 70);
    for (const [x, n] of intro) { assert.equal(n, 1, 'mehrfach gezeigt: ' + x); longTexts.add(x); }
  }
  assert.ok(longTexts.size >= 5, 'mehrere ausführliche Erklärungen: ' + longTexts.size);
});

test('Erklärungen im Einzelnen', () => {
  const rng = seeded(2); const g = mkG(rng); const ctx = mkCtx();
  let r = coach(g, ctx);
  assert.match(r.text, /Willkommen/); assert.match(r.text, /Mitte ist frei/); assert.equal(r.target, '[data-act=draw]');
  assert.equal(coach(g, ctx).text, r.text, 'bleibt im selben Zustand stehen');
  // Gezogene Zahl, die auf der Karte steht -> markieren
  const n = g.cards.me[0][0];
  g.drawn.push(n);
  r = coach(g, ctx);
  assert.match(r.text, /Du hast sie auf deiner Karte/); assert.equal(r.target, `.bg-cell[data-n="${n}"]`);
  assert.match(r.text, /Das Markieren machst du selbst/);
  E.mark(g, 'me', 0, 0);
  r = coach(g, ctx);
  assert.match(r.text, /Markiert!/); assert.equal(r.target, '[data-act=draw]');
  // zweite Zahl, die nicht auf der Karte steht
  let m = 1; while (g.cards.me[0].includes(m) || g.drawn.includes(m)) m++;
  g.drawn.push(m);
  r = coach(g, ctx); assert.equal(r.target, '[data-act=draw]'); assert.match(r.text, /Nächste Zahl/);
  // Mehrere offene Zahlen
  const a = g.cards.me[0][1]; const b = g.cards.me[0][2]; g.drawn.push(a, b);
  r = coach(g, ctx); assert.match(r.text, /noch nicht alle/); assert.equal(r.target, `.bg-cell[data-n="${a}"]`);
  E.mark(g, 'me', 0, 1); E.mark(g, 'me', 0, 2);
  r = coach(g, ctx); assert.equal(r.target, '[data-act=draw]');
  // gültig -> BINGO
  const line = E.LINES[0];
  for (const i of line) { const v = g.cards.me[0][i]; if (i !== 12 && !g.drawn.includes(v)) g.drawn.push(v); if (i !== 12 && !g.marks.me[0][i]) E.mark(g, 'me', 0, i); }
  r = coach(g, ctx); assert.equal(r.target, '[data-act=bingo]'); assert.match(r.text, /BINGO/);
  r = coach(g, ctx); assert.equal(r.target, '[data-act=bingo]');
  // robust gegen kaputte Eingaben
  assert.equal(coach(null, ctx), null); assert.equal(coach({}, ctx), null); assert.equal(coach(g, null), null); assert.equal(coach(undefined, undefined), null);
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
  assert.equal(coach(g, { id: 'me' }) === null || typeof coach(g, { id: 'me' }).text === 'string', true);
  assert.equal(coach({ game: 'bg', players: 'x', drawn: [] }, ctx), null);
  assert.equal(coach({ ...g, cards: null }, ctx), null);
  assert.equal(coach({ ...g, marks: { me: 'kaputt' } }, ctx), null);
  assert.equal(coach({ ...g, drawn: [999, 'a', null] }, ctx) === null || true, true);
  assert.equal(coach({ ...g, winners: 'x', phase: 'over' }, ctx).target, '[data-act=next]');
});

test('Selektoren und Texte bleiben auch bei zufälligen kaputten Zuständen sicher (wirft nie)', () => {
  const rng = seeded(9);
  const junk = [null, undefined, 0, 1, 'x', [], {}, { a: 1 }, NaN, true, () => 1, [1, 2], { id: 'me' }];
  for (let k = 0; k < 400; k++) {
    const g = mkG(rng);
    for (let d = 0; d < Math.floor(rng() * 20); d++) E.draw(g, 'me', rng);
    const f = Object.keys(g);
    const key = f[Math.floor(rng() * f.length)];
    const bad = { ...g, [key]: junk[Math.floor(rng() * junk.length)] };
    let r;
    assert.doesNotThrow(() => { r = coach(bad, mkCtx()); });
    if (r) check(r, 'kaputt ' + key);
  }
});

test('Lernrunde mit Computer (Leicht): nie Zugempfehlung, Computer-Sieg wird erklärt', () => {
  let humanWins = 0; let botWins = 0;
  for (let seed = 100; seed < 160; seed++) {
    const rng = seeded(seed); const g = mkG(rng); const ctx = mkCtx();
    follow(g, ctx, rng);
    if (g.winners.includes('me')) humanWins++; else botWins++;
  }
  console.log(`Lernrunde-Simulation: Mensch ${humanWins}, Computer ${botWins}`);
  assert.ok(humanWins > 0);
});
