import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wildnis/engine.js';
import { chooseAction } from '../wildnis/ai.js';
import { coach } from '../wildnis/tutorial.js';

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
  assert.ok(r.text.trim().length > 0 && r.text.length <= 200, 'Text: ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  assert.ok(!/beste|besser|empfehl|am klügsten|solltest|Tipp:/i.test(r.text), 'keine Empfehlung: ' + r.text);
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (rng, humanFirst = true) => E.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], {}, rng);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  const g0 = mk(seeded(1));
  for (const g of [null, undefined, {}, { players: null }, { game: 'wm', players: [], market: { tiles: [], tokens: [] } }, { game: 'wm', players: [{ id: 'me' }], market: null, phase: 'choose', active: 0 },
    { game: 'wm', players: [{ id: 'me', turns: 0, nature: 0, board: {} }], market: { tiles: [0], tokens: ['baer'] }, phase: 'tile', active: 0, selected: null }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  const g = mk(seeded(1));
  g.market = null;
  checkOut(coach(g, ctx));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { rot: 'kaputt', coachSeen: 7 } }));
  const g2 = mk(seeded(3));
  g2.recap = null;
  checkOut(coach(g2, ctx));
  const g3 = mk(seeded(4));
  g3.phase = 'token'; g3.selected = null;
  checkOut(coach(g3, ctx));
  g3.phase = 'tile'; g3.selected = { ti: 9, mi: 9 };
  checkOut(coach(g3, ctx));
  assert.equal(coach(mk(seeded(4)), { id: 'fremd', ui: {} }), null);
  assert.ok(g0);
});

test('Partien Mensch (zufällig, auch mit Naturmarkern) gegen Bot: Coach immer sinnvoll, Erklärungen je einmal', () => {
  const keys = [
    ['pair', /Im Markt liegen vier Paare/], ['habitat', /Jedes Plättchen hat Lebensräume/], ['nature', /Du hast einen Naturmarker/], ['wipe3', /Drei gleiche Tiere im Markt darfst/],
    ['sc-baer', /Bären: Zwei Bären/], ['sc-hirsch', /Hirsche: Eine gerade Reihe/], ['sc-lachs', /Lachse: Sich berührende/], ['sc-falke', /Falken: Es zählen nur/], ['sc-fuchs', /Füchse: Jeder Fuchs/],
    ['sc-hab', /Lebensräume: Je Lebensraum/], ['sc-bonus', /Bonus: Die alleinig/], ['tile1', /Dein Plättchen liegt links/], ['rot', /Mit „Drehen“ stellst/], ['groups', /Berühren sich an einer Kante/],
    ['two', /Viele Plättchen haben zwei Lebensräume/], ['tok1', /Jetzt kommt dein Tier/], ['key', /goldenem Rand/], ['one', /höchstens ein Tier/], ['discard', /auch wegwerfen/], ['four', /Vier gleiche Tiere im Markt werden/],
  ];
  const seen = {}; let computer = 0, over = 0, choose = 0, tile = 0, token = 0, targets = 0, free = 0, wipe = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = seeded(seed);
    const g = mk(rnd, seed % 2 === 1);
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, sig) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(sig); };
    let ply = 0;
    for (; ply < 800 && g.phase !== 'over'; ply++) {
      const total = g.players.reduce((s, p) => s + p.turns, 0);
      const r = coach(g, ctx);
      checkOut(r);
      const ap = E.activePlayer(g);
      if (ap.id === 'me') {
        assert.ok(r && r.target, 'Mensch dran: Ziel erwartet (' + g.phase + ')');
        targets++;
        note(r.text, g.phase === 'choose' && /Vier gleiche/.test(r.text) ? 'f' + total : 't' + g.players.find((p) => p.id === 'me').turns + g.phase);
        if (g.phase === 'choose') {
          choose++;
          const me = g.players.find((p) => p.id === 'me');
          const tiles = [0, 1, 2, 3].filter((i) => g.market.tiles[i] !== null);
          const toks = [0, 1, 2, 3].filter((i) => g.market.tokens[i]);
          const x = rnd();
          if (x < 0.15 && me.nature > 0 && !g.usedWipe) { assert.ok(E.handle(g, 'me', { t: 'wipe', idx: [0, 2] }, rnd).ok); wipe++; checkOut(coach(g, ctx)); continue; }
          if (x < 0.3 && me.nature > 0) {
            const ti = tiles[0], mi = toks.find((m) => m !== ti);
            if (mi !== undefined) { assert.ok(E.handle(g, 'me', { t: 'free', ti, mi }, rnd).ok); free++; continue; }
          }
          if (x < 0.4 && !g.usedWipe3 && E.handle(g, 'me', { t: 'wipe3' }, rnd).ok) { checkOut(coach(g, ctx)); continue; }
          const i = tiles.find((t) => g.market.tokens[t]);
          assert.ok(E.handle(g, 'me', { t: 'pick', i }, rnd).ok);
        } else if (g.phase === 'tile') {
          tile++;
          const l = E.legalTilePlacements(g);
          ui.rot = Math.floor(rnd() * 6);
          checkOut(coach(g, ctx));
          const m = l[Math.floor(rnd() * l.length)];
          assert.ok(E.placeTile(g, 'me', m.q, m.r, Math.floor(rnd() * 6), rnd).ok);
        } else {
          token++;
          const o = E.tokenOptions(g);
          assert.ok(o.length > 0);
          if (rnd() < 0.2) E.discardToken(g, 'me', rnd); else { const c = o[Math.floor(rnd() * o.length)]; E.placeToken(g, 'me', c.q, c.r, rnd); }
        }
      } else {
        assert.ok(/Computer/.test(r.text), 'Computer-Text: ' + r.text);
        note(r.text, 'f' + total);
        computer++;
        E.handle(g, 'bot1', chooseAction(g, 'bot1', seed % 3 === 0 ? 1 : 0, rnd), rnd);
      }
    }
    const last = coach(g, ctx);
    checkOut(last);
    assert.ok(/zu Ende/.test(last.text) && last.target === '[data-act="again"]');
    over++;
    for (const [k, s] of Object.entries(shown)) { assert.equal(s.size, 1, `${k} nur einmal (${[...s]})`); seen[k] = (seen[k] || 0) + 1; }
  }
  assert.equal(over, 40);
  assert.ok(seen.pair >= 35 && seen.tile1 >= 35 && seen.tok1 >= 35 && seen.rot >= 35, JSON.stringify(seen));
  assert.ok(seen['sc-baer'] >= 30 && seen['sc-bonus'] >= 30, 'Wertung wird erklärt: ' + JSON.stringify(seen));
  assert.ok(choose > 200 && tile > 200 && token > 200 && computer > 200 && targets > 400);
  assert.ok(free > 0 && wipe > 0, 'Naturmarker-Aktionen kamen vor');
  console.log('Erklärungen (Partien):', JSON.stringify(seen), '| Naturmarker frei', free, 'tauschen', wipe);
});

test('Lernrunde zeigt Wertung und Spielregeln ohne Zugempfehlung (Texte vollständig)', () => {
  const rnd = seeded(7);
  const g = mk(rnd, true);
  const ctx = { id: 'me', ui: {} };
  const all = new Set();
  for (let i = 0; i < 40 && g.phase !== 'over'; i++) {
    const r = coach(g, ctx);
    if (r) all.add(r.text);
    if (E.activePlayer(g).id === 'me') {
      if (g.phase === 'choose') E.handle(g, 'me', { t: 'pick', i: [0, 1, 2, 3].find((k) => g.market.tiles[k] !== null && g.market.tokens[k]) }, rnd);
      else if (g.phase === 'tile') { const m = E.legalTilePlacements(g)[0]; E.placeTile(g, 'me', m.q, m.r, 0, rnd); }
      else { const o = E.tokenOptions(g)[0]; E.placeToken(g, 'me', o.q, o.r, rnd); }
    } else E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rnd), rnd);
  }
  for (const t of all) checkOut({ text: t });
  assert.ok([...all].some((t) => /Wertung am Ende, Bären/.test(t) || /Wertung, Hirsche/.test(t)));
});
