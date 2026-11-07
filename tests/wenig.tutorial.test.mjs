import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../wenig/engine.js';
import { chooseAction } from '../wenig/ai.js';
import { coach } from '../wenig/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>*-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { take: false, coachSeen: {} } });
const BANNED = /beste|besser tauschen|solltest|empfehl|tausche die|lege die|am besten|klug|\bTipp\b|Strategie|Vorteil/i;

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 260, `${where}: Text "${r.text}" (${r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen oder lange Zahl in "${r.text}"`);
  assert.ok(!BANNED.test(r.text), `${where}: Empfehlung in "${r.text}"`);
  assert.ok(!/Skyjo/i.test(r.text));
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

test('Lernrunde: in jedem Zustand gültiger Text; Ziel nur, wenn ich handeln muss; nie eine Empfehlung', () => {
  const texts = new Map();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { limit: 30 }, rng, 'me');
    const ctx = mkCtx();
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 4000) {
      const r = coach(g, ctx);
      assert.ok(r, `seed ${seed}: kein Coach in Phase ${g.phase}`);
      check(r, `seed ${seed}`);
      texts.set(r.text, (texts.get(r.text) || 0) + 1);
      if (g.phase === 'round') {
        assert.equal(r.target, '[data-act=next]');
        M.handle(g, 'me', { t: 'next' }, rng);
        continue;
      }
      if (g.phase === 'reveal') {
        const mine = g.players[0];
        if (M.upCount(mine) < 2) {
          assert.ok(r.target && r.target.includes('.down'), 'verdeckte Karten als Ziel');
          const i = mine.grid.findIndex((c) => !c.up);
          M.handle(g, 'me', { t: 'reveal', i }, rng);
        } else {
          assert.equal(r.target, undefined);
          M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng);
        }
        continue;
      }
      const ap = M.activePlayer(g);
      if (ap.id !== 'me') {
        assert.equal(r.target, undefined, 'beim Computer kein Ziel');
        M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng);
        continue;
      }
      assert.ok(r.target, 'Ziel erwartet');
      const st = g.turn.stage;
      const live = ap.grid.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
      if (st === 'flip') {
        assert.ok(r.target.includes('.down'));
        M.handle(g, 'me', { t: 'flip', i: ap.grid.findIndex((c) => c && !c.up) }, rng);
      } else if (st === 'drawn') {
        assert.ok(r.target.includes('[data-act=put]') && r.target.includes('[data-act=cell]'));
        M.handle(g, 'me', seed % 2 ? { t: 'discard' } : { t: 'swap', from: 'drawn', i: live[0] }, rng);
      } else if (seed % 3 === 0) {
        // Ablage nehmen: erst auswählen (Oberfläche), dann tauschen
        assert.ok(r.target.includes('[data-act=take]') && r.target.includes('[data-act=draw]'));
        ctx.ui.take = true;
        const r2 = coach(g, ctx); check(r2, 'take');
        assert.ok(r2.target.includes('[data-act=cell]') && !r2.target.includes('draw'));
        ctx.ui.take = false;
        M.handle(g, 'me', { t: 'swap', from: 'discard', i: live[live.length - 1] }, rng);
      } else {
        assert.ok(r.target.includes('[data-act=take]') && r.target.includes('[data-act=draw]'));
        M.handle(g, 'me', { t: 'draw' }, rng);
      }
    }
    assert.equal(g.phase, 'over');
    const end = coach(g, ctx);
    check(end, 'Spielende');
    assert.equal(end.target, '[data-act=again]');
  }
  console.log('  verschiedene Texte:', texts.size);
  assert.ok(texts.size >= 12);
});

test('Jede Erklärung kommt nur einmal (pro Lage), auch über mehrere Runden', () => {
  const rng = seeded(11);
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { limit: 60 }, rng, 'me');
  const ctx = mkCtx();
  const longTexts = new Map(); // Erklärung -> Anzahl verschiedener Lagen, in denen sie erschien
  let lastKey = '';
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 4000) {
    const r = coach(g, ctx);
    if (r.text.length > 100 && r.text !== lastKey) longTexts.set(r.text, (longTexts.get(r.text) || 0) + 1);
    lastKey = r.text;
    if (g.phase === 'round') { M.handle(g, 'me', { t: 'next' }, rng); continue; }
    if (g.phase === 'reveal') {
      const mine = g.players[0];
      if (M.upCount(mine) < 2) M.handle(g, 'me', { t: 'reveal', i: mine.grid.findIndex((c) => !c.up) }, rng);
      else M.handle(g, 'bot1', chooseAction(g, 'bot1', 1, rng), rng);
      continue;
    }
    const ap = M.activePlayer(g);
    if (ap.id !== 'me') { M.handle(g, 'bot1', chooseAction(g, 'bot1', 1, rng), rng); continue; }
    const m = chooseAction(g, 'me', 1, rng);
    M.handle(g, 'me', m, rng);
  }
  for (const [t, n] of longTexts) assert.equal(n, 1, `Erklärung mehrfach gezeigt: "${t}" (${n}x)`);
  assert.ok(longTexts.size >= 8, 'mehrere Erklärungen: ' + longTexts.size);
});

test('Lernrunde erklärt Aufdecken, Ziel, Ablage/Stapel, Tauschen, Ablegen, Dreier-Spalte, Rundenende, Verdoppelung, Spielende', () => {
  const rng = seeded(5);
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, rng, 'me');
  const ctx = mkCtx();
  const seen = [];
  const note = (t) => { if (!seen.includes(t)) seen.push(t); };
  note(coach(g, ctx).text);
  M.handle(g, 'me', { t: 'reveal', i: 0 }, rng);
  note(coach(g, ctx).text);
  M.handle(g, 'me', { t: 'reveal', i: 1 }, rng);
  note(coach(g, ctx).text);
  M.handle(g, 'bot1', { t: 'reveal', i: 0 }, rng); M.handle(g, 'bot1', { t: 'reveal', i: 1 }, rng);
  if (g.active !== 0) { g.active = 0; }
  note(coach(g, ctx).text);
  M.handle(g, 'me', { t: 'draw' }, rng);
  note(coach(g, ctx).text);
  M.handle(g, 'me', { t: 'discard' }, rng);
  note(coach(g, ctx).text);
  g.phase = 'round'; g.result = { round: 1 };
  note(coach(g, ctx).text);
  g.phase = 'over';
  note(coach(g, ctx).text);
  const all = seen.join(' | ');
  for (const re of [/zwei Karten auf/, /wenige Punkte/, /offene Karte der Ablage/, /Stapel/, /tauschen/, /Ablage/, /verdeckte Karte auf/, /Runde ist zu Ende/, /doppelt/, /hundert Punkte/]) assert.ok(re.test(all), 'fehlt: ' + re);
  const col = coach(Object.assign(M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'C' }], {}, seeded(2), 'me'), {}), { id: 'me', ui: { coachSeen: {} } });
  assert.ok(col);
  // Dreier-Spalte: tritt als Erklärung auf, sobald es zwei gleiche offene Karten in einer Spalte gibt
  const h = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'C' }], {}, seeded(8), 'me');
  const c2 = mkCtx();
  h.phase = 'play'; h.active = 0; h.turn = { stage: 'start', drawn: null };
  h.players[0].grid[0] = { v: 4, up: true }; h.players[0].grid[4] = { v: 4, up: true };
  coach(h, c2); // 'start'
  h.discard.push(1); // neue Lage
  const t = coach(h, c2);
  assert.ok(/drei gleiche/i.test(t.text), t.text);
});

test('Robust: wirft nie, auch bei kaputten Eingaben', () => {
  for (const [g, c] of [[null, null], [{}, {}], [undefined, { id: 'x' }], [{ game: 'wm' }, { id: 'me' }], [{ game: 'wm', players: [] , turn: {} }, { id: 'me', ui: null }], [M.createGame([{ id: 'me', name: 'A' }, { id: 'b', name: 'B' }]), { id: 'me' }]]) {
    assert.doesNotThrow(() => coach(g, c));
  }
  assert.equal(coach(M.createGame([{ id: 'me', name: 'A' }, { id: 'b', name: 'B' }]), { id: 'fremd', ui: {} }), null);
});
