import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../galgen/engine.js';
import { coach, TUTORIAL_OPTS } from '../galgen/tutorial.js';
import { chooseAction } from '../galgen/ai.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>#-]+$/;
const players = [{ id: 'me', name: 'Erna' }, { id: 'bot1', name: 'Computer' }];
const mk = (seed = 1) => G.createGame(players, { ...TUTORIAL_OPTS, host: 'me' }, seeded(seed));
const mkCtx = (ui = {}) => ({ id: 'me', ui: { coachSeen: {}, ...ui } });

function check(r, where) {
  if (r === null) return;
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 240, `${where}: Text "${r.text}" (${(r.text || '').length})`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  if (r.target) assert.ok(!/data-l|nth/.test(r.target), 'Ziel darf keine bestimmte Taste sein: ' + r.target);
  assert.ok(!/tippe auf (den )?(buchstaben )?[a-zäöü]([ .,!]|$)|am besten|empfehl|zeige mir|tipp:/i.test(r.text), 'keine Empfehlung: ' + r.text);
}
// Mensch folgt dem Ziel: Taste (zufällig) oder Wort-Knopf; Computer spielt Leicht
function play(seed, wordOpenSometimes = true) {
  const rng = seeded(seed);
  const g = mk(seed); const ctx = mkCtx();
  const texts = []; let prev = null; const entered = {};
  let steps = 0; let wordOpened = false;
  while (g.phase !== 'over' && steps++ < 2000) {
    const r = coach(g, ctx);
    assert.ok(r, 'immer ein Coach-Text');
    check(r, 'Schritt ' + steps);
    if (r.text !== prev) { entered[r.text] = (entered[r.text] || 0) + 1; texts.push(r.text); prev = r.text; }
    if (g.phase === 'reveal') { assert.equal(r.target, '[data-act=next]'); G.handle(g, 'me', { t: 'next' }); ctx.ui.wordOpen = false; continue; }
    if (G.current(g).id === 'bot1') { assert.equal(r.target, undefined, 'Computer dran: kein Ziel'); G.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng)); continue; }
    assert.ok(r.target, 'Mensch dran: ein Ziel');
    if (r.target === '#gg-keys') { const free = G.KEYS.filter((k) => !g.guessed.includes(k)); assert.ok(G.handle(g, 'me', { t: 'letter', l: free[Math.floor(rng() * free.length)] }).ok); }
    else if (r.target === '[data-act=wordopen]') { ctx.ui.wordOpen = true; wordOpened = true; }
    else if (r.target === '#gg-wordin') { assert.ok(ctx.ui.wordOpen); ctx.ui.wordOpen = false; G.handle(g, 'me', { t: 'word', w: rng() < 0.5 ? g.word : 'HAUS' }); }
    else assert.fail('unerwartetes Ziel ' + r.target);
  }
  assert.equal(g.phase, 'over');
  const end = coach(g, ctx);
  assert.equal(end.target, '[data-act=again]'); assert.match(end.text, /Lernrunde ist zu Ende/);
  return { texts, entered, wordOpened };
}

test('Lernrunde: 2 feste Wörter, Computer spielt mit', () => {
  const g = mk();
  assert.equal(g.rounds, 2); assert.equal(g.words, undefined); assert.equal(g.word, 'KATZE'); assert.equal(g.players.length, 2); assert.equal(g.solo, false);
});

test('Führung bis zum Ende bei vielen Partien; lange Erklärungen nur einmal', () => {
  let sawWordIntro = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { texts, entered, wordOpened } = play(seed);
    for (const [t, n] of Object.entries(entered)) if (t.length > 60) assert.equal(n, 1, `Text mehrmals: ${t}`);
    if (wordOpened) sawWordIntro++;
    assert.ok(texts.length >= 4);
  }
  assert.ok(sawWordIntro > 0, 'Wort-Rate wurde mindestens einmal erklärt');
});

test('Alle Lerninhalte kommen vor: Striche, Buchstabe, Fehler/Schneemann, Wort raten, Punkte', () => {
  const all = new Set();
  for (let seed = 1; seed <= 60; seed++) play(seed).texts.forEach((t) => all.add(t));
  const joined = [...all].join(' | ');
  for (const re of [/Striche/, /Buchstaben/, /Fehler/, /Schneemann/, /Ich weiß das Wort/, /Punkt/, /Bonus/, /Kategorie/, /Nächstes Wort|Endergebnis/]) assert.match(joined, re);
});

test('Kaputte Eingaben: kein Absturz, null oder gültig', () => {
  const bad = [undefined, null, 5, 'x', [], {}, { game: 'gg' }, { game: 'gg', players: 5 }, { game: 'gg', players: [], mask: [] }, { game: 'gg', players: [null], mask: [], phase: 'play' }];
  for (const b of bad) for (const c of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, mkCtx()]) { const r = coach(b, c); check(r, 'kaputt'); }
  const g = mk(); g.last = 5; g.turn = 99; g.phase = 'zzz';
  check(coach(g, mkCtx()), 'komisch');
  const h = mk(); h.players = [null]; check(coach(h, mkCtx()), 'null-Spieler');
  assert.equal(coach(mk(), { id: 'fremd', ui: {} }), null);
});

test('Selektoren gibt es im Spiel: nur #gg-keys, #gg-wordin, wordopen, next, again', () => {
  const targets = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed); const g = mk(seed); const ctx = mkCtx();
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 500) {
      const r = coach(g, ctx); if (r.target) targets.add(r.target);
      if (g.phase === 'reveal') G.handle(g, 'me', { t: 'next' });
      else if (G.current(g).id === 'bot1') G.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng));
      else if (r.target === '[data-act=wordopen]') { ctx.ui.wordOpen = true; }
      else if (r.target === '#gg-wordin') { ctx.ui.wordOpen = false; G.handle(g, 'me', { t: 'word', w: 'X' }); }
      else { const free = G.KEYS.filter((k) => !g.guessed.includes(k)); G.handle(g, 'me', { t: 'letter', l: free[0] }); }
    }
    const e = coach(g, ctx); if (e.target) targets.add(e.target);
  }
  for (const t of targets) assert.ok(['#gg-keys', '#gg-wordin', '[data-act=wordopen]', '[data-act=next]', '[data-act=again]'].includes(t), t);
});
