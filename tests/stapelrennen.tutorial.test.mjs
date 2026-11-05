import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../stapelrennen/engine.js';
import { coach } from '../stapelrennen/tutorial.js';
import { chooseAction } from '../stapelrennen/ai.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>*-]+$/;
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i === 0 ? 'me' : 'bot' + i, name: i === 0 ? 'Ich' : 'C' + i }));
const mkCtx = () => ({ id: 'me', ui: { sel: null, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 200, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  assert.ok(!new RegExp('sk' + 'ip', 'i').test(r.text));
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

// Der Mensch folgt nur dem Ziel des Coachs (so wie der Browser-Test): gibt true zurück, wenn etwas getan wurde.
function follow(g, ctx, rng) {
  const r = must(g, ctx, 'folgen');
  assert.ok(r.target, 'Mensch ist dran, also gibt es ein Ziel: ' + r.text);
  const first = r.target.split(',')[0].trim();
  const me = g.players[g.active];
  if (first === '[data-act=src].sr-ok') {
    const s = P.sourcesOf(g, g.active)[0];
    ctx.ui.sel = { from: s.from, i: s.i };
  } else if (first === '[data-act=src][data-from=hand]') {
    ctx.ui.sel = { from: 'hand', i: Math.floor(rng() * me.hand.length) };
  } else if (first === '[data-act=to-build]') {
    const s = ctx.ui.sel;
    const card = s.from === 'hand' ? me.hand[s.i] : s.from === 'pile' ? P.topOf(me.pile) : P.topOf(me.aux[s.i]);
    const to = P.targetsFor(g, card)[0];
    assert.ok(P.play(g, 'me', { from: s.from, i: s.i, to }, rng).ok);
    ctx.ui.sel = null;
  } else if (first === '[data-act=to-aux]') {
    assert.ok(P.discard(g, 'me', { i: ctx.ui.sel.i, to: Math.floor(rng() * 4) }).ok);
    ctx.ui.sel = null;
  } else assert.fail('unerwartetes Ziel ' + first);
}

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt (Computer spielt mit)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed);
    const g = P.createGame(players(2), { pile: 10 }, rng);
    const ctx = mkCtx();
    let steps = 0, seenJokerText = false;
    while (g.mode === 'play' && steps++ < 3000) {
      if (P.activePlayer(g).id !== 'me') {
        const r = must(g, ctx, 'Computer dran');
        assert.equal(r.target, undefined);
        assert.match(r.text, /Computer/);
        P.handle(g, g.players[g.active].id, chooseAction(g, g.players[g.active].id, 0, rng), rng);
        continue;
      }
      if (/Joker/.test(must(g, ctx, 'x').text)) seenJokerText = true;
      follow(g, ctx, rng);
    }
    assert.equal(g.mode, 'over', 'Seed ' + seed);
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=again]');
    assert.match(end.text, /Lernrunde ist zu Ende/);
    assert.ok(seenJokerText || seed > 0);
  }
});

test('Zufallspartien mit angetippten Karten: Coach liefert in jedem Zustand gültigen Text', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const rng = seeded(seed * 3);
    const g = P.createGame(players(2 + (seed % 3)), {}, rng);
    const ctx = mkCtx();
    let steps = 0;
    while (g.mode === 'play' && steps++ < 4000) {
      const p = P.activePlayer(g);
      const mine = p.id === 'me';
      ctx.ui.sel = null;
      const r0 = must(g, ctx, 'ohne Auswahl');
      if (!mine) assert.equal(r0.target, undefined);
      if (mine) {
        // jede Quelle antippen: Coach sagt, was als Nächstes kommt
        for (let i = 0; i < p.hand.length; i++) {
          ctx.ui.sel = { from: 'hand', i };
          const r = must(g, ctx, 'Hand angetippt');
          const targets = P.targetsFor(g, p.hand[i]);
          assert.equal(r.target, targets.length ? '[data-act=to-build]' : '[data-act=to-aux]');
        }
        ctx.ui.sel = { from: 'pile', i: 0 };
        must(g, ctx, 'Stapel angetippt');
        ctx.ui.sel = { from: 'aux', i: 1 };
        must(g, ctx, 'Hilfsstapel angetippt');
        ctx.ui.sel = { from: 'hand', i: 99 };
        must(g, ctx, 'ungültige Auswahl');
        ctx.ui.sel = null;
      }
      const m = chooseAction(g, p.id, p.id === 'me' ? 1 : 0, rng) || { t: 'discard', i: 0, to: 0 };
      assert.ok(P.handle(g, p.id, m, rng).ok);
    }
    assert.equal(g.mode, 'over');
    assert.equal(must(g, ctx, 'Ende').target, '[data-act=again]');
  }
});

test('Serie: Coach zeigt auf Nächste Runde', () => {
  const g = P.createGame(players(2), { points: true }, seeded(5));
  g.players[0].pile = [1];
  g.players[1].pile = [4, 4];
  P.play(g, 'me', { from: 'pile', to: 0 });
  assert.equal(g.mode, 'roundover');
  assert.equal(must(g, mkCtx(), 'Runde').target, '[data-act=next-round]');
});

test('Erklärungen kommen nur einmal', () => {
  const g = P.createGame(players(2), {}, seeded(8));
  g.players[0].hand = [1, 1, 7, 9, 12];
  g.players[0].pile = [11, 6];
  const ctx = mkCtx();
  assert.match(must(g, ctx, 'a').text, /goldenen Rand/);
  assert.match(must(g, ctx, 'a2').text, /goldenen Rand/, 'bleibt im gleichen Zustand stehen');
  assert.equal(must(g, ctx, 'a3').target, '[data-act=src].sr-ok');
  P.play(g, 'me', { from: 'hand', i: 0, to: 0 }); // die 1
  const second = must(g, ctx, 'b').text;
  assert.doesNotMatch(second, /goldenen Rand/);
  assert.match(second, /beginnt mit der 1/);
  P.play(g, 'me', { from: 'hand', i: 0, to: 1 }); // zweite 1
  assert.doesNotMatch(must(g, ctx, 'c').text, /beginnt mit der 1/);
});

test('Joker wird beim ersten Joker erklärt, danach der gültige Wert', () => {
  const g = P.createGame(players(2), {}, seeded(8));
  g.players[0].hand = [0, 2, 9, 9, 9];
  g.players[0].pile = [11, 6];
  const ctx = mkCtx();
  ctx.ui.coachSeen = { intro: -1, start1: -1 };
  assert.match(must(g, ctx, 'j').text, /Der Joker zählt als jede Zahl/);
  P.play(g, 'me', { from: 'hand', i: 0, to: 0 });
  const after = must(g, ctx, 'nach Joker').text;
  assert.match(after, /Dein Joker zählt hier als 1/);
  // Auswahl eines Jokers
  const { g: g2 } = { g: P.createGame(players(2), {}, seeded(9)) };
  g2.players[0].hand = [0, 9, 9, 9, 9];
  const c2 = mkCtx();
  c2.ui.sel = { from: 'hand', i: 0 };
  assert.match(must(g2, c2, 'sel').text, /Joker zählt als die Zahl/);
});

test('Abwerfen: erst wenn nichts mehr passt, mit Erklärung; Zug endet danach', () => {
  const g = P.createGame(players(2), {}, seeded(8));
  g.players[0].hand = [5, 6, 7, 8, 9];
  g.players[0].pile = [12, 11];
  const ctx = mkCtx();
  const r = must(g, ctx, 'nichts passt');
  assert.match(r.text, /Abwerfen heißt/);
  assert.equal(r.target, '[data-act=src][data-from=hand]');
  ctx.ui.sel = { from: 'hand', i: 2 };
  const r2 = must(g, ctx, 'gewählt');
  assert.equal(r2.target, '[data-act=to-aux]');
  P.discard(g, 'me', { i: 2, to: 0 });
  assert.equal(must(g, ctx, 'Computer').target, undefined);
});

test('Texte sind kurz, ohne Strategie-Wörter', () => {
  const g = P.createGame(players(2), {}, seeded(3));
  const ctx = mkCtx();
  const t = must(g, ctx, 't').text;
  assert.ok(!/besser|am besten|solltest|Tipp:|klug/i.test(t));
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { players: [] }, { players: [null] }, { players: [{}], active: 0 }, { mode: 'play', players: [{ id: 'me' }], build: [], active: 0 },
    { mode: 'play', players: [{ id: 'me', hand: 'x', pile: null, aux: 3 }], build: [[], [], [], []], active: 0, seq: 1 },
    { mode: 'play', players: [{ id: 'me', hand: [1], pile: [2], aux: [[], [], [], []] }], build: [[], [], [], []], active: 0, seq: 1, last: 7 },
    { mode: 'play', players: [{ id: 'me', hand: [1], pile: [2], aux: [[], [], [], []] }], build: 'x', active: 5 }];
  for (const g of bad) {
    for (const c of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { sel: 5 } }, { id: 'me', ui: { sel: { from: 'aux', i: 'x' }, coachSeen: 3 } }, { id: 'me', ui: { sel: { from: 'hand', i: 0 } } }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(g, c); });
      check(r, JSON.stringify(g));
    }
  }
});
