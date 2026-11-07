import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../schiffe/engine.js';
import { chooseAction } from '../schiffe/ai.js';
import { coach } from '../schiffe/tutorial.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const validSel = (s) => typeof s === 'string' && s.length > 0 && /^[\w\s.#\-\[\]="':>,*()~+]+$/.test(s);
const checkOut = (r) => {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'), 'null oder Objekt');
  if (!r) return;
  assert.ok(r.text.trim().length > 0 && r.text.length <= 230, 'Text: ' + r.text.length + ' ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  // keine Strategie: nie ein Feld nennen und nichts empfehlen
  assert.ok(!/Spalte [A-J]|Zeile \d|\b[A-J]\d{1,2}\b|am besten|\bbesser\b|\bTipp\b|Strategie|\bEcke|\bMitte\b|\bRand\b|\bklug|schlau|empfehl/i.test(r.text), 'Strategie-Hinweis? ' + r.text);
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (opts, humanFirst = true) => M.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], opts, seeded(1));

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], fleets: [], ready: [] }, { players: [{ id: 'me' }], fleets: [], ready: [], mode: 'play', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk();
  g.fleets = null;
  checkOut(coach(g, ctx));
  const g2 = mk();
  M.handle(g2, 'me', { t: 'random' }); M.handle(g2, 'bot1', { t: 'random' }); M.handle(g2, 'me', { t: 'ready' }); M.handle(g2, 'bot1', { t: 'ready' });
  checkOut(coach(g2, { id: 'me', ui: { sel: 'kaputt', coachSeen: 7 } }));
  checkOut(coach(g2, { id: 'me', ui: { sel: 999 } }));
  g2.grid = null;
  checkOut(coach(g2, ctx));
  assert.equal(coach(mk(), { id: 'fremd', ui: {} }), null);
});

test('Aufstellen: Zufällig wird vorgeschlagen, dann Fertig; jede Erklärung nur einmal', () => {
  const g = mk();
  const ui = {};
  const ctx = { id: 'me', ui };
  let r = coach(g, ctx);
  checkOut(r);
  assert.match(r.text, /Zufällig aufstellen/);
  assert.match(r.text, /Schiff an/);
  assert.equal(r.target, '[data-act="random"]');
  const intro = r.text;
  assert.equal(coach(g, ctx).text, intro, 'gleicher Zustand, gleiche Antwort');
  // ein Schiff manuell gesetzt -> Zustand wechselt, Einleitung kommt nicht wieder
  assert.ok(M.handle(g, 'me', { t: 'place', ship: 0, x: 0, y: 0, dir: 'h' }).ok);
  r = coach(g, ctx);
  checkOut(r);
  assert.notEqual(r.text, intro);
  assert.equal(r.target, '[data-act="random"]');
  // alles gesetzt
  assert.ok(M.handle(g, 'me', { t: 'random' }, seeded(2)).ok);
  r = coach(g, ctx);
  checkOut(r);
  assert.equal(r.target, '[data-act="ready"]');
  assert.match(r.text, /Fertig/);
  const fertig1 = r.text;
  assert.ok(M.handle(g, 'me', { t: 'random' }, seeded(3)).ok);
  assert.notEqual(coach(g, ctx).text, fertig1, 'Erklärung nur einmal');
  assert.equal(coach(g, ctx).target, '[data-act="ready"]');
  // fertig: warten auf den Computer
  assert.ok(M.handle(g, 'me', { t: 'ready' }).ok);
  r = coach(g, ctx);
  checkOut(r);
  assert.match(r.text, /Computer/);
  assert.equal(r.target, undefined);
});

test('Partien Mensch (zufällig) gegen Computer: Coach immer sinnvoll, Erklärungen je einmal, nie eine Zielempfehlung', () => {
  const keys = [['shoot', /Jetzt wird abwechselnd geschossen/], ['water', /Wasser heißt/], ['hit', /Treffer! Hier liegt/], ['sunk', /Versenkt! Du hast alle Felder/], ['theirs', /Der Computer hat auf dein Meer geschossen/], ['setup', /Zuerst stellst du/], ['ready', /Alle fünf Schiffe stehen/]];
  const total = { shoot: 0, water: 0, hit: 0, sunk: 0, theirs: 0, setup: 0, ready: 0, computer: 0, over: 0, fire: 0, board: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seeded(seed);
    const opts = { again: seed % 3 === 0, touch: seed % 4 === 0 };
    const humanFirst = seed % 2 === 1;
    const g = mk(opts, humanFirst);
    const me = humanFirst ? 0 : 1;
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, sig) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(sig); };
    // Aufstellen
    for (let k = 0; k < 6; k++) {
      const r = coach(g, ctx); checkOut(r); note(r.text, `${g.moveNo}`);
      if (g.mode !== 'setup') { assert.equal(g.mode, 'play'); }
      else if (g.ready[me]) { assert.equal(r.target, undefined); assert.match(r.text, /Computer/); }
      else assert.ok(r.target);
      if (k === 0) assert.ok(M.handle(g, 'me', { t: 'random' }, rnd).ok);
      else if (k === 1) assert.ok(M.handle(g, 'me', { t: 'place', ship: 4, x: 9, y: 9, dir: 'h' }).ok === false);
      else if (k === 2) assert.ok(M.handle(g, 'me', { t: 'ready' }).ok);
      else if (!g.ready[1 - me]) assert.ok(M.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rnd), rnd).ok);
    }
    if (!g.ready[1 - me]) M.handle(g, 'bot1', { t: 'ready' });
    assert.equal(g.mode, 'play');
    for (let ply = 0; ply < 400 && g.mode === 'play'; ply++) {
      if (g.turn === me) {
        ui.sel = null;
        const r = coach(g, ctx);
        checkOut(r);
        assert.ok(r && r.target === '#board', 'Ziel beim Menschen ist das ganze Feld, kein einzelnes Feld');
        note(r.text, `${g.moveNo}`);
        total.board++;
        assert.deepEqual(coach(g, ctx), r, 'gleicher Zustand, gleiche Antwort');
        const legal = M.legalShots(g);
        const c = legal[Math.floor(rnd() * legal.length)];
        ui.sel = c;
        const r2 = coach(g, ctx);
        checkOut(r2);
        assert.equal(r2.target, '[data-act="fire"]');
        total.fire++;
        ui.sel = null;
        assert.ok(M.handle(g, 'me', { t: 'shoot', x: M.xOf(c), y: M.yOf(c) }).ok);
      } else {
        const r = coach(g, ctx);
        checkOut(r);
        assert.match(r.text, /Computer/);
        assert.equal(r.target, undefined);
        note(r.text, `${g.moveNo}`);
        total.computer++;
        const a = chooseAction(g, 'bot1', 0, rnd);
        assert.ok(a && M.handle(g, 'bot1', a, rnd).ok);
      }
    }
    assert.equal(g.mode, 'over');
    const r = coach(g, ctx);
    checkOut(r);
    assert.equal(r.target, '[data-act="again"]');
    assert.match(r.text, /17/);
    total.over++;
    for (const [k, s] of Object.entries(shown)) { assert.ok(s.size <= 1, `${k} mehrfach erklärt: ${[...s]}`); total[k] += 1; }
  }
  assert.ok(total.shoot > 0 && total.water > 0 && total.hit > 0 && total.sunk > 0 && total.theirs > 0 && total.setup > 0 && total.ready > 0 && total.over > 0 && total.computer > 0);
  console.log('Abdeckung', total);
});

test('Die Texte nennen weder ein Feld noch eine Empfehlung (alle Zustände einer Partie)', () => {
  const g = mk({ again: true });
  const rnd = seeded(5);
  M.handle(g, 'me', { t: 'random' }, rnd); M.handle(g, 'bot1', { t: 'random' }, rnd); M.handle(g, 'me', { t: 'ready' }); M.handle(g, 'bot1', { t: 'ready' });
  const ui = {};
  const texts = new Set();
  while (g.mode === 'play') {
    const r = coach(g, { id: 'me', ui });
    checkOut(r); texts.add(r.text);
    const a = g.turn === 0 ? { t: 'shoot', x: M.xOf(M.legalShots(g)[0]), y: M.yOf(M.legalShots(g)[0]) } : chooseAction(g, 'bot1', 1, rnd);
    assert.ok(M.handle(g, g.turn === 0 ? 'me' : 'bot1', a, rnd).ok);
  }
  assert.ok(texts.size >= 3);
});
