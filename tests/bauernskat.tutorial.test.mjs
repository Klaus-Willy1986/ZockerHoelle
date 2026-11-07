import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../bauernskat/engine.js';
import { chooseAction } from '../bauernskat/ai.js';
import { coach } from '../bauernskat/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {} } });
const P = [{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }];

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${r.text && r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen oder lange Zahl in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  // keine Zugempfehlung
  assert.ok(!/(spiele|lege|nimm)\s+(am besten|diese|den|die|das|jetzt die|besser)/i.test(r.text) && !/beste|empfehl|klug|am besten|tipp:/i.test(r.text), `${where}: Empfehlung in "${r.text}"`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};

test('Lernrunde gegen den Computer: in jedem Zustand gültiger Text, Ziel nur wenn ich handeln muss', () => {
  const texts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = M.createGame(P, { hints: true, dealer: 1 }, rng, 'me');
    const ctx = mkCtx();
    assert.equal(g.turn, 0, 'in der Lernrunde bin ich Vorhand');
    let guard = 0;
    while ((g.phase === 'trump' || g.phase === 'play') && guard++ < 100) {
      const r = must(g, ctx, `seed ${seed}`);
      texts.add(r.text);
      if (g.turn !== 0) {
        assert.equal(r.target, undefined, 'kein Ziel, wenn der Computer dran ist');
        const msg = chooseAction(g, 'bot1', 0, rng);
        assert.equal(M.handle(g, 'bot1', msg, rng).ok, true);
        continue;
      }
      assert.ok(r.target, 'Ziel erwartet');
      let msg;
      if (g.phase === 'trump') { assert.equal(r.target, '[data-act=trump]'); msg = { t: 'trump', suit: Math.floor(rng() * 4) }; }
      else { assert.equal(r.target, '.bsk-mine .can'); const l = M.legalCols(g, 'me'); msg = { t: 'play', col: l[Math.floor(rng() * l.length)] }; }
      assert.equal(M.handle(g, 'me', msg, rng).ok, true);
    }
    assert.equal(g.phase, 'round_over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=next]');
  }
  const all = [...texts].join(' ');
  for (const w of ['Trumpf', 'Buben', 'Bedienpflicht', 'verdeckte', 'Augen', 'Stich']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Jede Erklärung kommt nur in einer Lage vor (danach nie wieder), auch über mehrere Runden', () => {
  const rng = seeded(11);
  const g = M.createGame(P, { hints: true, dealer: 1, target: 20 }, rng, 'me');
  const ctx = mkCtx();
  const where = new Map(); // Text -> Zustandsschlüssel der ersten Anzeige
  const GENERIC = (t) => t.length < 60 || /^(Du hast die Runde|Der Computer hat die Runde|Die Runde ist unentschieden|Das Spiel ist zu Ende|Du hast das ganze)/.test(t);
  for (let round = 0; round < 4; round++) {
    let guard = 0;
    while ((g.phase === 'trump' || g.phase === 'play') && guard++ < 100) {
      const key = [g.round, g.phase, g.players[0].tricks + g.players[1].tricks, g.trick.cards.length, g.turn].join('|');
      const r = must(g, ctx, 'x');
      assert.equal(must(g, ctx, 'x').text, r.text, 'gleiche Lage, gleicher Text');
      if (!GENERIC(r.text)) {
        if (!where.has(r.text)) where.set(r.text, key);
        assert.equal(where.get(r.text), key, 'Erklärung taucht in anderer Lage wieder auf: ' + r.text);
      }
      const id = g.players[g.turn].id;
      const msg = g.turn === 0 ? (g.phase === 'trump' ? { t: 'trump', suit: 1 } : { t: 'play', col: M.legalCols(g, 'me')[0] }) : chooseAction(g, 'bot1', 0, rng);
      assert.equal(M.handle(g, id, msg, rng).ok, true);
    }
    assert.equal(g.phase, 'round_over');
    M.handle(g, 'me', { t: 'next' }, rng);
    // ab Runde 2 bin ich nicht mehr Vorhand: auch dann gültige Texte
  }
  assert.ok(where.size >= 4, 'mehrere verschiedene Erklärungen: ' + where.size);
});

test('Bedienpflicht-Erklärung erscheint, wenn der Computer eine Farbe ausspielt und ich bedienen muss', () => {
  const C = (s, r) => s * 8 + r;
  const g = M.createGame(P, { dealer: 0 }, seeded(2), 'me'); // Vorhand ist der Computer
  g.dealer = 0; g.leader = 1; g.turn = 1;
  M.handle(g, 'bot1', { t: 'trump', suit: 2 });
  g.players[1].cols.forEach((c, k) => { c.up = C(0, k % 4); });
  g.players[0].cols.forEach((c, k) => { c.up = k < 3 ? C(0, 5 + (k % 2)) : C(1, k % 4); });
  M.handle(g, 'bot1', { t: 'play', col: 0 });
  const ctx = mkCtx();
  const r = must(g, ctx, 'follow');
  assert.ok(/Bedienpflicht/.test(r.text) && /Kreuz/.test(r.text), r.text);
  assert.equal(r.target, '.bsk-mine .can');
  // keine Karte der Farbe offen -> anderer Text
  const h = JSON.parse(JSON.stringify(g));
  h.players[0].cols.forEach((c, k) => { c.up = C(1, k % 4); });
  const r2 = must(h, mkCtx(), 'frei');
  assert.ok(/jede offene Karte|Trumpf/.test(r2.text), r2.text);
});

test('Spielende: Hinweis auf neues Spiel', () => {
  const g = M.createGame(P, { dealer: 1, target: 1 }, seeded(5), 'me');
  const rng = seeded(1);
  M.handle(g, 'me', { t: 'trump', suit: 0 });
  let guard = 0;
  while (g.phase === 'play' && guard++ < 100) {
    const id = g.players[g.turn].id; const l = M.legalCols(g, id);
    M.handle(g, id, { t: 'play', col: l[Math.floor(rng() * l.length)] });
  }
  const r = must(g, mkCtx(), 'over');
  if (g.phase === 'over') assert.equal(r.target, '[data-act=again]');
  else assert.equal(r.target, '[data-act=next]');
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'bsk' }, { game: 'bsk', players: [] }, { game: 'bsk', players: [{ id: 'me' }], trick: {} },
    { game: 'bsk', players: [{ id: 'me', cols: null }, { id: 'b' }], trick: { cards: [] }, phase: 'play', turn: 3 },
    { game: 'bsk', players: [{ id: 'me', cols: [] }, { id: 'b', cols: [] }], trick: { cards: [{ card: 'x' }] }, phase: 'play', turn: 0, trump: 99 }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
