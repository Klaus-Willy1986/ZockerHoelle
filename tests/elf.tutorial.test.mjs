import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../elf/engine.js';
import { chooseAction } from '../elf/ai.js';
import { coach } from '../elf/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {} } });
const NO_STRATEGY = /\bTipp\b|besser|beste|solltest|empfehl|klug|Strategie|Vorteil|am liebsten|lieber/i;
const SHORT = new Set(['Jetzt ist der Computer dran. Schau einfach zu.', 'Tippe auf eine leuchtende Karte.', 'Du musst passen. Tippe auf Passen.', 'Du hast die Runde gewonnen. Tippe auf Nächste Runde.', 'Die Runde ist zu Ende. Tippe auf Nächste Runde.']);

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  assert.ok(!NO_STRATEGY.test(r.text), `${where}: Strategie-Hinweis in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

// Eine ganze Lernrunde (bis zum Spielende) so spielen, wie die Oberfläche es tut
function playLearn(seed, seq) {
  const rng = seeded(seed);
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { limit: 20 }, rng, 'me');
  const ctx = mkCtx();
  let guard = 0; let rounds = 0; let sawPass = false;
  for (;;) {
    assert.ok(guard++ < 5000, 'Endlosspiel');
    const r = must(g, ctx, `seed ${seed}`);
    seq.push(r.text);
    if (g.phase === 'over') {
      if (g.result.gameOver) { assert.equal(r.target, '[data-act=again]'); return { rounds: rounds + 1, sawPass }; }
      assert.equal(r.target, '[data-act=next]');
      assert.equal(M.handle(g, 'me', { t: 'next' }, rng).ok, true);
      rounds++;
      continue;
    }
    const ap = M.activePlayer(g);
    if (ap.id !== 'me') {
      assert.equal(r.target, undefined, 'Beim Computer kein Ziel');
      assert.equal(M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng).ok, true);
      continue;
    }
    assert.ok(r.target, 'Ziel erwartet');
    const legal = M.legalCards(g, 'me');
    if (!legal.length) { assert.equal(r.target, '[data-act=pass]'); sawPass = true; assert.equal(M.handle(g, 'me', { t: 'pass' }, rng).ok, true); } else {
      assert.equal(r.target, '.ev-hand .can');
      assert.equal(M.handle(g, 'me', { t: 'play', card: legal[Math.floor(rng() * legal.length)] }, rng).ok, true);
    }
  }
}

test('Lernrunde gegen den Computer: in jedem Zustand gültiger Text, Ziel nur wenn ich handeln muss, alles kommt vor', () => {
  const texts = new Set();
  let passSeen = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const seq = [];
    const r = playLearn(seed, seq);
    seq.forEach((t) => texts.add(t));
    if (r.sawPass) passSeen++;
  }
  assert.ok(passSeen > 5, 'Passen kam zu selten vor');
  const all = [...texts].join(' ');
  for (const w of ['Elf', 'nach oben', 'nach unten', 'neuen Farbe', 'passen', 'Strafpunkt', 'Runde', 'wenigsten']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Jede Erklärung erscheint nur einmal (zusammenhängend), danach nur noch die kurze Form', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const seq = [];
    playLearn(seed, seq);
    const lastIdx = new Map();
    seq.forEach((t, i) => {
      if (SHORT.has(t)) return;
      if (lastIdx.has(t)) assert.equal(lastIdx.get(t), i - 1, `Erklärung kommt wieder: "${t}" (Seed ${seed})`);
      lastIdx.set(t, i);
    });
  }
});

test('Gleiche Lage gibt gleichen Text; neue Lage wechselt zur nächsten Erklärung', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(3), 'me');
  g.rows = [{ lo: 11, hi: 11 }, null, null, null];
  g.moves = 1;
  g.players[0].hand = [{ s: 0, r: 12 }, { s: 0, r: 10 }, { s: 1, r: 11 }, { s: 2, r: 3 }];
  g.active = 0;
  const ctx = mkCtx();
  const a = must(g, ctx, 'a');
  assert.ok(/oben/.test(a.text));
  assert.equal(must(g, ctx, 'a2').text, a.text);
  g.moves = 2; g.active = 0;
  const b = must(g, ctx, 'b');
  assert.ok(/unten/.test(b.text));
  g.moves = 3;
  const c = must(g, ctx, 'c');
  assert.ok(/neuen Farbe/.test(c.text));
  g.moves = 4;
  const d = must(g, ctx, 'd');
  assert.ok(/Du darfst eine Karte legen/.test(d.text));
  g.moves = 5;
  assert.equal(must(g, ctx, 'e').text, 'Tippe auf eine leuchtende Karte.');
});

test('Passen wird einmal erklärt, Ziel ist der Passen-Knopf', () => {
  const g = M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(5), 'me');
  g.rows = [{ lo: 11, hi: 11 }, null, null, null];
  g.moves = 3;
  g.players[0].hand = [{ s: 0, r: 20 }, { s: 2, r: 3 }];
  g.active = 0;
  const ctx = mkCtx();
  const a = must(g, ctx, 'p');
  assert.equal(a.target, '[data-act=pass]');
  assert.ok(/Strafpunkt/.test(a.text));
  g.moves = 5;
  const b = must(g, ctx, 'p2');
  assert.equal(b.target, '[data-act=pass]');
  assert.notEqual(b.text, a.text);
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'ev' }, { game: 'ev', players: [] }, { game: 'ev', players: [{ id: 'me' }], rows: [] },
    { game: 'ev', players: [{ id: 'me', hand: null }], rows: [], phase: 'play', active: 3 },
    { game: 'ev', players: [{ id: 'me', hand: [{ s: 'x' }] }], rows: [null], phase: 'play', active: 0, moves: 0 },
    { game: 'ev', players: [{ id: 'me', hand: [] }], rows: [null, null, null, null], phase: 'over', result: null }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
