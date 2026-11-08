import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../koffer/engine.js';
import { chooseAction } from '../koffer/ai.js';
import { coach } from '../koffer/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>#,-]+$/;
const mkG = (rng, o = { show: true, cap: 5 }) => E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'Computer' }], o, rng);
const mkCtx = () => ({ id: 'me', ui: { coachSeen: {}, seq: [], add: null, ack: '' } });

function check(r, where) {
  if (r === null) return;
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 240, `${where}: Text "${r.text}"`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  if (r.target) assert.ok(!/data-id|nth|kf-card|chip|tile/.test(r.target), 'Ziel darf keine bestimmte Karte sein: ' + r.target);
  assert.ok(!/tippe (auf )?(diese|die|das) (linke|rechte|erste|obere|untere|\w+ste) (karte|ding)|zeige mir|tipp:|am besten|solltest du|empfehl/i.test(r.text), 'keine Zugempfehlung: ' + r.text);
}
// Nennt der Text ein Ding aus dem Koffer oder dem Angebot? Das wäre ein Tipp.
const itemNames = E.ALL_IDS.map((id) => E.itemOf(id).n);

function runLesson(seed) {
  const rng = seeded(seed);
  const g = mkG(rng); const ctx = mkCtx();
  const texts = []; let steps = 0;
  while (g.mode !== 'over' && steps++ < 400) {
    const r = coach(g, ctx);
    assert.ok(r, 'immer ein Coach-Text');
    check(r, 'folgen');
    for (const n of itemNames) assert.ok(!r.text.includes(n), `Text nennt ein Ding (${n}): ${r.text}`);
    texts.push(r.text);
    const key = g.last ? `${g.gid}|${g.last.no}` : '';
    if (g.phase === 'play' && g.players[g.turn].id === 'bot1') {
      // Computer dran: keine Aktion von mir, kein Ziel
      if (g.last && ctx.ui.ack !== key) { assert.match(r.target, /ack/); ctx.ui.ack = key; continue; }
      assert.equal(r.target, undefined, 'Computer dran: kein Ziel');
      E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng); continue;
    }
    if (g.phase === 'result') {
      assert.match(r.target, /weiter|ack/);
      const actor = g.players[g.last.by].id;
      if (actor === 'me') { ctx.ui.ack = key; assert.ok(E.handle(g, 'me', { t: 'weiter' }, rng).ok); }
      else { ctx.ui.ack = key; assert.ok(E.handle(g, 'me', { t: 'weiter' }, rng).ok, 'Computer-Ergebnis: Mensch darf Weiter'); }
      ctx.ui.seq = []; ctx.ui.add = null;
      continue;
    }
    if (g.phase === 'play' && g.last && ctx.ui.ack !== key) { ctx.ui.ack = key; continue; }
    // ich bin dran
    assert.ok(['.kf-grid', '.kf-offer', '[data-act=fertig]', '[data-act=undo]'].includes(r.target), 'Ziel ' + r.target);
    const n = g.list.length;
    if (ctx.ui.seq.length < n) { ctx.ui.seq.push(g.list[ctx.ui.seq.length]); assert.equal(r.target === '.kf-grid' || r.target === '[data-act=undo]', true, 'Raster oder Zurück: ' + r.target); continue; }
    if (!ctx.ui.add) { assert.equal(r.target, '.kf-offer'); ctx.ui.add = g.offer[0]; continue; }
    assert.equal(r.target, '[data-act=fertig]');
    assert.ok(E.handle(g, 'me', { t: 'submit', seq: ctx.ui.seq.slice(), add: ctx.ui.add }, rng).ok);
    ctx.ui.seq = []; ctx.ui.add = null;
  }
  assert.equal(g.mode, 'over');
  const end = coach(g, ctx);
  assert.equal(end.target, '[data-act=again]'); assert.match(end.text, /Lernrunde ist zu Ende/);
  return texts;
}

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt (20 Partien)', () => {
  for (let seed = 1; seed <= 20; seed++) runLesson(seed);
});

test('jede Erklärung kommt nur einmal (lange Texte erscheinen nur in einem zusammenhängenden Stück)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const texts = runLesson(seed);
    const longs = [...new Set(texts.filter((t) => t.length > 70))];
    for (const t of longs) {
      let runs = 0; let prev = null;
      for (const x of texts) { if (x === t && prev !== t) runs++; prev = x; }
      assert.equal(runs, 1, `Text mehrfach: ${t}`);
    }
    assert.ok(longs.length >= 3, 'Lernrunde erklärt etwas: ' + longs.length);
  }
});

test('Lernrunde erklärt Spielidee, Folge, neues Ding, Fehler (Texte vorhanden)', () => {
  const all = [].concat(...[1, 2, 3, 4, 5].map(runLesson)).join(' | ');
  assert.match(all, /Koffer/); assert.match(all, /Reihenfolge/); assert.match(all, /neues Ding/i); assert.match(all, /Zurück/);
  // Fehlertext: Mensch macht einen Fehler
  const rng = seeded(9); const g = mkG(rng, { show: true, cap: 5, lives2: true }); const ctx = mkCtx();
  E.handle(g, 'me', { t: 'submit', seq: [], add: g.offer[0] }, rng); E.handle(g, 'me', { t: 'weiter' }, rng);
  E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng); E.handle(g, 'bot1', { t: 'weiter' }, rng);
  E.handle(g, 'me', { t: 'submit', seq: ['quatsch', 'unsinn'], add: g.offer[0] }, rng);
  assert.equal(g.last.ok, false);
  const r = coach(g, ctx);
  check(r, 'Fehler');
  assert.match(r.text, /nicht ganz richtig/); assert.match(r.text, /scheidet aus/); assert.match(r.target, /weiter/);
});

test('Spielende beim Computer-Sieg und beim Koffer-voll', () => {
  const rng = seeded(4); const g = mkG(rng); const ctx = mkCtx();
  E.handle(g, 'me', { t: 'submit', seq: [], add: g.offer[0] }, rng); E.handle(g, 'me', { t: 'weiter' }, rng);
  E.handle(g, 'bot1', { t: 'submit', seq: ['falsch'], add: g.offer[0] }, rng);
  assert.equal(g.mode, 'over');
  assert.match(coach(g, ctx).text, /Du hast gewonnen/);
  const g2 = mkG(seeded(5)); g2.players[0].out = true; g2.mode = 'over'; g2.result = { full: false, length: 3 };
  assert.match(coach(g2, mkCtx()).text, /Computer hat gewonnen/);
});

test('robust gegen kaputte Eingaben (wirft nie)', () => {
  const g = mkG(seeded(3));
  const junk = [null, undefined, 0, 'x', [], {}, { game: 'kf' }, { game: 'kf', players: 'x' }, { game: 'kf', players: [], list: [] }, { game: 'kf', players: [null], list: [] },
    { ...g, list: null }, { ...g, players: [{ id: 'me' }], list: [1, 2], grid: null, offer: null, last: 5 }, { ...g, phase: 'result', last: null }, { ...g, phase: 'result', last: { by: 7, ok: true } }, { ...g, turn: 99 }];
  const ctxs = [null, undefined, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: 5 }, { id: 'me', ui: { seq: 'x', add: 3, coachSeen: 7 } }, { id: 'zzz', ui: {} }, mkCtx()];
  for (const j of junk) for (const c of ctxs) {
    let r;
    assert.doesNotThrow(() => { r = coach(j, c); });
    check(r, 'kaputt');
  }
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});

test('Selektoren nur auf Bereiche und Knöpfe, mehrere Zustände zufällig', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = seeded(seed); const g = mkG(rng, { show: true, cap: 8 }); const ctx = mkCtx();
    for (let k = 0; k < 30 && g.mode !== 'over'; k++) {
      ctx.ui.seq = g.list.slice(0, Math.floor(rng() * (g.list.length + 1))); ctx.ui.add = rng() < 0.5 ? g.offer[0] : null; ctx.ui.ack = rng() < 0.5 ? (g.last ? `${g.gid}|${g.last.no}` : '') : 'alt';
      check(coach(g, ctx), 'zufall');
      const id = g.phase === 'result' ? g.players[g.last.by].id : g.players[g.turn].id;
      if (g.phase === 'result') E.handle(g, id, { t: 'weiter' }, rng);
      else if (id === 'bot1') E.handle(g, id, chooseAction(g, id, 1, rng), rng);
      else E.handle(g, id, { t: 'submit', seq: g.list.slice(), add: g.offer[0] }, rng);
    }
  }
});
