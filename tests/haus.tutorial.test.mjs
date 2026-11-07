import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../haus/engine.js';
import { chooseAction } from '../haus/ai.js';
import { coach } from '../haus/tutorial.js';

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
  assert.ok(r.text.trim().length > 0 && r.text.length <= 260, 'Text: ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  assert.ok(!/monopoly/i.test(r.text), 'neutrale Namen');
  assert.ok(!/kaufe (das|die|den)|jetzt bauen|du solltest|am besten/i.test(r.text), 'keine Empfehlung: ' + r.text);
  if (r.target !== undefined && r.target !== null) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (rng, humanFirst = true, opts = { maxRounds: 12 }) => E.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], opts, rng);
const ALL = Array.from({ length: 40 }, (_, i) => i);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { game: 'haus', players: [], owners: {}, houses: {} }, { game: 'haus', players: [{ id: 'me' }], owners: {}, houses: {}, phase: 'roll', active: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk(seeded(1));
  g.houses = null; checkOut(coach(g, ctx));
  const g2 = mk(seeded(2)); g2.recap = null; checkOut(coach(g2, ctx));
  const g3 = mk(seeded(3)); g3.card = 7; g3.debt = 'x'; checkOut(coach(g3, ctx));
  checkOut(coach(mk(seeded(4)), { id: 'me', ui: { coachSeen: 7 } }));
  assert.equal(coach(mk(seeded(5)), { id: 'fremd', ui: {} }), null);
});

function humanMove(g, rnd) {
  const me = g.players.find((p) => p.id === 'me');
  switch (g.phase) {
    case 'roll':
      if (me.jail > 0 && rnd() < 0.3 && me.cash >= 50) return { t: 'pay_jail' };
      return { t: 'roll' };
    case 'buy': return { t: rnd() < 0.6 ? 'buy' : 'decline' };
    case 'auction': {
      const A = g.auction;
      return rnd() < 0.4 && A.high + 10 <= me.cash ? { t: 'bid', amount: A.high + 10 } : { t: 'pass_bid' };
    }
    case 'raise': return chooseAction(g, 'me', 1, rnd);
    case 'manage': {
      const b = ALL.filter((s) => E.canBuild(g, 'me', s));
      if (b.length && rnd() < 0.7) return { t: 'build', sq: b[Math.floor(rnd() * b.length)] };
      const m = ALL.filter((s) => E.canMortgage(g, 'me', s));
      if (m.length && rnd() < 0.15) return { t: 'mortgage', sq: m[Math.floor(rnd() * m.length)] };
      return { t: 'end' };
    }
  }
  return null;
}

test('Partien Mensch (zufällig) gegen Computer: Coach immer sinnvoll, Erklärungen je einmal', () => {
  const keys = [['roll1', /Rundweg/], ['pasch1', /Pasch!/], ['jail1', /Fehlversuchen|nächsten Zug kommst du frei/], ['event1', /Ereignisfeld/], ['buy1', /noch frei/], ['auction1', /Versteigerung: Alle/], ['raise1', /Bargeld reicht nicht/], ['rent1', /Miete bezahlt/], ['tax1', /Steuerfeld/], ['build1', /alle Straßen einer Farbe/], ['manage1', /fast vorbei/], ['mortgage1', /Beleihen \(Hypothek\)/], ['rentIn1', /zahlt dir Miete/]];
  const seen = {}; let computer = 0, humanStates = 0, games = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seeded(seed);
    const g = mk(rnd, seed % 2 === 1, { maxRounds: 12, auction: seed % 7 !== 0 });
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, seq) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(seq); };
    for (let ply = 0; ply < 3000 && g.phase !== 'over'; ply++) {
      const r = coach(g, ctx);
      checkOut(r);
      assert.ok(r, 'Text immer da');
      note(r.text, g.seq);
      const ap = E.activePlayer(g);
      if (ap.id === 'me') {
        assert.ok(r.target, 'Mensch dran: Ziel erwartet ' + g.phase);
        humanStates++;
        const again = coach(g, ctx); // gleiche Darstellung, gleicher Text
        assert.equal(again.text, r.text, 'stabil bei erneutem Zeichnen');
        const m = humanMove(g, rnd);
        const res = E.handle(g, 'me', m, rnd);
        assert.ok(res.ok, JSON.stringify(m) + ' ' + res.error);
      } else {
        assert.ok(/Computer/.test(r.text), 'Computer-Text: ' + r.text);
        computer++;
        E.handle(g, 'bot1', chooseAction(g, 'bot1', seed % 3 === 0 ? 0 : 1, rnd), rnd);
      }
    }
    assert.equal(g.phase, 'over');
    games++;
    const last = coach(g, ctx);
    checkOut(last);
    assert.ok(/zu Ende/.test(last.text) && last.target === '[data-act="again"]');
    for (const [k, s] of Object.entries(shown)) { assert.equal(s.size, 1, `${k} nur einmal (Zustände ${[...s]})`); seen[k] = (seen[k] || 0) + 1; }
  }
  assert.ok(seen.roll1 === games && seen.buy1 >= 50 && seen.manage1 >= 50, JSON.stringify(seen));
  assert.ok(seen.rent1 >= 20 && seen.event1 >= 20 && seen.auction1 >= 10, JSON.stringify(seen));
  assert.ok(humanStates > 500 && computer > 300);
  console.log('Erklärungen (Partien):', JSON.stringify(seen), 'Spiele', games);
});
