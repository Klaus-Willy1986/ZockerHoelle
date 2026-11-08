import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schwimmen/engine.js';
import { chooseAction } from '../schwimmen/ai.js';
import { coach } from '../schwimmen/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { selH: null, selT: null, note: null, coachSeen: {} } });
const BAD = /\bTipp\b|empfehl|am besten|beste[rn]?\b|besser|solltest|klug|Strategie|Vorschlag|lieber|rate dir/i;

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  assert.ok(!BAD.test(r.text), `${where}: Zugempfehlung? "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

// Spielt eine ganze Lernrunde: der Mensch folgt dem Ziel des Coaches.
function playLearn(seed, texts, targets) {
  const rng = seeded(seed);
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { show: true }, rng, 'me');
  const ctx = mkCtx();
  let guard = 0;
  while (g.phase === 'play' && guard++ < 2000) {
    const ap = M.activePlayer(g);
    const r = must(g, ctx, `seed ${seed}`);
    texts.push(r.text);
    if (ap.id !== 'me') {
      assert.equal(r.target, undefined, 'kein Ziel, wenn der Computer dran ist');
      assert.equal(M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng).ok, true);
      continue;
    }
    assert.ok(r.target, 'Ziel erwartet');
    targets.add(r.target);
    if (r.target === '[data-act=knock]') { assert.equal(M.handle(g, 'me', { t: 'knock' }, rng).ok, true); continue; }
    assert.equal(r.target, '.sw-hand [data-act=hand]');
    ctx.ui.selH = Math.floor(rng() * 3);
    const r2 = must(g, ctx, 'nach Handkarte');
    assert.equal(r2.target, '.sw-table [data-act=table]');
    ctx.ui.selH = null;
    ctx.ui.selT = Math.floor(rng() * 3);
    assert.equal(must(g, ctx, 'nach Tischkarte').target, '.sw-hand [data-act=hand]');
    const j = ctx.ui.selT; ctx.ui.selT = null;
    assert.equal(M.handle(g, 'me', { t: 'swap1', hand: Math.floor(rng() * 3), table: j }, rng).ok, true);
  }
  assert.equal(g.phase, 'over');
  const end = must(g, ctx, 'Ende');
  assert.equal(end.target, g.result.final ? '[data-act=again]' : '[data-act=next]');
  return { g, ctx };
}

test('Lernrunde gegen den Computer: in jedem Zustand gültiger Text, Ziel nur wenn ich handeln muss', () => {
  const texts = []; const targets = new Set();
  let ended = 0;
  for (let seed = 1; seed <= 60; seed++) { playLearn(seed, texts, targets); ended++; }
  assert.equal(ended, 60);
  const all = texts.join(' ');
  for (const w of ['Tischkarte', 'Alle drei tauschen', 'Schieben', 'Leben', '31', 'Klopfen', 'Handwert']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
  assert.ok(targets.has('[data-act=knock]'));
});

test('Jede lange Erklärung kommt genau einmal', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { show: true }, seeded(3), 'me');
  const ctx = mkCtx();
  const seen = new Map();
  const rng = seeded(11);
  let turns = 0;
  while (g.phase === 'play' && turns < 40) {
    const ap = M.activePlayer(g);
    if (ap.id === 'me') {
      const t1 = must(g, ctx, 'a').text;
      assert.equal(must(g, ctx, 'b').text, t1, 'bleibt in derselben Lage gleich');
      seen.set(t1, (seen.get(t1) || 0) + 1);
      turns++;
      M.handle(g, 'me', { t: 'pass' }, rng);
    } else M.handle(g, 'bot1', { t: 'pass' }, rng);
  }
  const longOnes = [...seen.entries()].filter(([t]) => t.length > 120);
  assert.ok(longOnes.length >= 6, 'mehrere Erklärungen: ' + longOnes.length);
  for (const [t, n] of longOnes) assert.equal(n, 1, 'mehrfach: ' + t);
  // am Ende nur noch die kurze Form
  assert.ok(must(g, ctx, 'kurz').text.length < 100);
});

test('Computer klopft: Hinweis auf den letzten Zug (einmal), kein Ziel wenn der Computer dran ist', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(5), 'me');
  const ctx = mkCtx();
  M.handle(g, 'me', { t: 'pass' });
  M.handle(g, 'bot1', { t: 'knock' });
  const r = must(g, ctx, 'geklopft');
  assert.match(r.text, /Computer hat geklopft/);
  assert.equal(r.target, '.sw-hand [data-act=hand]');
  assert.equal(must(g, ctx, 'nochmal').text, r.text);
  // ich klopfe, Computer ist dran
  const h = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(6), 'me');
  M.handle(h, 'me', { t: 'knock' });
  const r2 = must(h, mkCtx(), 'ich geklopft');
  assert.match(r2.text, /Du hast geklopft/);
  assert.equal(r2.target, undefined);
});

test('Rundenende und Spielende: eigener Text und Knopf', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(8), 'me');
  g.players[0].hand = [{ s: 2, r: 7 }, { s: 2, r: 3 }, { s: 2, r: 6 }];
  M.handle(g, 'me', { t: 'call31' });
  const r = must(g, mkCtx(), '31');
  assert.match(r.text, /Du hast 31 angesagt/);
  assert.equal(r.target, '[data-act=next]');
  g.result.final = true; g.result.champions = ['me'];
  const r2 = must(g, mkCtx(), 'Ende');
  assert.match(r2.text, /gewonnen/);
  assert.equal(r2.target, '[data-act=again]');
});

test('Kaputte Eingaben: wirft nie, liefert null oder gültigen Text', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(2), 'me');
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'sw' }, { game: 'sw', players: 5 }, { game: 'mm', players: [], table: [] }, { game: 'sw', players: [{}], table: [], phase: 'play', active: 3 }, JSON.parse(JSON.stringify({ ...g, players: [null] }))];
  for (const b of bad) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: 5 }, { id: 'zz', ui: {} }, mkCtx()]) {
    let r;
    assert.doesNotThrow(() => { r = coach(b, ctx); });
    if (r !== null) check(r, 'kaputt');
  }
  // gültiger Zustand, kaputte ui-Auswahl
  for (const sel of [{ selH: 'a', selT: {} }, { selH: -5, selT: 99 }, { selH: 1.5 }, { selH: null, selT: null, coachSeen: 3 }]) {
    const r = coach(g, { id: 'me', ui: { ...sel } });
    if (r !== null) check(r, 'ui');
  }
  // Zuschauer (nicht im Spiel): null
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});

test('Mit Handwert-Anzeige beginnt die Anleitung mit Hand und Tisch, ohne Zugempfehlung', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { show: true }, seeded(4), 'me');
  const r = must(g, mkCtx(), 'intro');
  assert.match(r.text, /drei Karten/);
  assert.match(r.text, /Tisch/);
  assert.match(r.text, /Handwert/);
});
