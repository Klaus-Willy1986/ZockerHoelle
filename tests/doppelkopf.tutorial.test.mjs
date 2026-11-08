import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../doppelkopf/engine.js';
import { chooseAction } from '../doppelkopf/ai.js';
import { coach } from '../doppelkopf/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {} } });
const P = [{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer 1' }, { id: 'bot2', name: 'Computer 2' }, { id: 'bot3', name: 'Computer 3' }];
const C = (s, r, c = 0) => (s * 6 + r) * 2 + c;

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 160, `${where}: Text "${r.text}" (${r.text && r.text.length})`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen oder lange Zahl in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  // keine Zugempfehlung
  assert.ok(!/(spiele|lege|nimm)\s+(am besten|diese|den|die|das|jetzt die|besser)/i.test(r.text) && !/beste|empfehl|klug|am besten|tipp:|solltest|lieber/i.test(r.text), `${where}: Empfehlung in "${r.text}"`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};
const start = (seed, opts = {}) => M.createGame(P, { hints: true, dealer: 3, rounds: 2, ...opts }, seeded(seed), 'me');

function playOut(g, rng, ctx, onStep) {
  let guard = 0;
  while (g.phase === 'play' && guard++ < 100) {
    const r = must(g, ctx, `seed ${g.gid}`);
    if (onStep) onStep(r);
    const id = g.players[g.turn].id;
    if (g.turn !== 0) {
      assert.equal(r.target, undefined, 'kein Ziel, wenn ein Computer dran ist');
      const msg = chooseAction(g, id, 0, rng);
      assert.equal(M.handle(g, id, msg, rng).ok, true);
      continue;
    }
    assert.equal(r.target, '.dk-hand .can', 'Ziel erwartet');
    const l = M.legalCards(g, 'me');
    assert.equal(M.handle(g, 'me', { t: 'play', card: l[Math.floor(rng() * l.length)] }, rng).ok, true);
  }
}

test('Lernrunde mit drei Computern: in jedem Zustand gültiger Text, Ziel nur wenn ich handeln muss', () => {
  const texts = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const rng = seeded(seed);
    const g = start(seed);
    const ctx = mkCtx();
    assert.equal(g.turn, 0, 'in der Lernrunde bin ich Vorhand');
    playOut(g, rng, ctx, (r) => texts.add(r.text));
    assert.equal(g.phase, 'round_over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=next]');
    assert.ok(/Sonderpunkte/.test(end.text));
  }
  const all = [...texts].join(' ');
  for (const w of ['Kreuz-Dame', 'ansagen', 'Trumpf', 'Bedienpflicht', 'Augen', 'Stich', 'Hochzeit']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Jede Erklärung kommt nur in einer Lage vor (danach nie wieder), auch über mehrere Runden', () => {
  const rng = seeded(11);
  const g = start(11, { rounds: 5 });
  const ctx = mkCtx();
  const where = new Map(); // Text -> Zustandsschlüssel der ersten Anzeige
  const GENERIC = (t) => t.length < 60 || /^(Deine Seite|Die andere Seite|Das Spiel ist zu Ende|Du hast das ganze|Jetzt ist)/.test(t);
  for (let round = 0; round < 4; round++) {
    let guard = 0;
    while (g.phase === 'play' && guard++ < 100) {
      const key = [g.round, g.phase, g.tricksDone, g.trick.cards.length, g.turn].join('|');
      const r = must(g, ctx, 'x');
      assert.equal(must(g, ctx, 'x').text, r.text, 'gleiche Lage, gleicher Text');
      if (!GENERIC(r.text)) {
        if (!where.has(r.text)) where.set(r.text, key);
        assert.equal(where.get(r.text), key, 'Erklärung taucht in anderer Lage wieder auf: ' + r.text);
      }
      const id = g.players[g.turn].id;
      const msg = g.turn === 0 ? { t: 'play', card: M.legalCards(g, 'me')[0] } : chooseAction(g, id, 0, rng);
      assert.equal(M.handle(g, id, msg, rng).ok, true);
    }
    assert.equal(g.phase, 'round_over');
    M.handle(g, 'me', { t: 'next' }, rng);
  }
  assert.ok(where.size >= 4, 'mehrere verschiedene Erklärungen: ' + where.size);
  // jeder Text (Schlüssel) nur einmal in der ganzen Lernrunde
  const seen = new Set();
  for (const t of where.keys()) { assert.ok(!seen.has(t)); seen.add(t); }
});

test('Teamerklärung nennt mein Team; Hochzeit wird erklärt, wenn ich beide Kreuz-Damen habe', () => {
  let weddings = 0, normal = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const h = start(seed);
    const r = must(h, mkCtx(), 'Start');
    if (h.wedding && h.wedding.player === 0) { weddings++; assert.ok(/Hochzeit/.test(r.text) && /Beide Kreuz-Damen/.test(r.text), r.text); } else { normal++; assert.ok(r.text.includes(h.team[0] === 're' ? 'Du bist Re' : 'Du bist Kontra'), r.text); }
    assert.equal(r.target, '.dk-hand .can');
  }
  assert.ok(weddings >= 1 && normal >= 20, `Hochzeiten ${weddings}, normal ${normal}`);
});

test('Bedienpflicht-Erklärung erscheint, wenn ein Computer eine Art ausspielt und ich bedienen muss; sonst freie Wahl', () => {
  const g = start(2, { dealer: 2 }); // Vorhand ist Computer 3, danach bin ich dran
  const mine = [C(0, 5), C(0, 1), C(1, 5), C(2, 4), C(3, 0), C(3, 5), C(0, 3), C(1, 2), C(2, 2), C(2, 3), C(3, 3), C(2, 1)];
  const lead = [C(0, 4), C(1, 4), C(1, 1), C(1, 0), C(2, 5), C(2, 0), C(3, 4), C(3, 2), C(0, 2), C(0, 0, 1), C(1, 3), C(3, 1)];
  const used = new Set([...mine, ...lead]);
  const rest = []; for (let i = 0; i < 48; i++) if (!used.has(i)) rest.push(i);
  M.dealHands(g, [mine, rest.slice(0, 12), rest.slice(12, 24), lead]);
  assert.equal(g.turn, 3);
  M.handle(g, 'bot3', { t: 'play', card: C(0, 4) }); // Kreuz-König (Fehlfarbe)
  assert.equal(g.turn, 0);
  const r = must(g, mkCtx(), 'follow');
  assert.ok(/Bedienpflicht/.test(r.text) && /Kreuz/.test(r.text), r.text);
  assert.equal(r.target, '.dk-hand .can');
  // Trumpf ausgespielt
  const h = JSON.parse(JSON.stringify(g));
  h.trick.cards = [{ pid: 'bot3', card: C(3, 4) }];
  const r2 = must(h, mkCtx(), 'trumpf');
  assert.ok(/Bedienpflicht/.test(r2.text) && /Trumpf/.test(r2.text), r2.text);
  // nichts Passendes: freie Wahl (erst nach dem ersten Stich erklärt)
  const f = JSON.parse(JSON.stringify(g));
  f.players[0].hand = f.players[0].hand.filter((c) => M.groupOf(c) !== 0); f.tricksDone = 1;
  const r3 = must(f, mkCtx(), 'frei');
  assert.ok(/jede Karte spielen/.test(r3.text), r3.text);
});

test('Rundenende und Spielende: Hinweis auf Nächste Runde bzw. neues Spiel', () => {
  const rng = seeded(5);
  const g = start(5, { rounds: 1 });
  playOut(g, rng, mkCtx());
  assert.equal(g.phase, 'over');
  const r = must(g, mkCtx(), 'over');
  assert.equal(r.target, '[data-act=again]');
  assert.ok(/Punkte|Spiel/.test(r.text));
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'dk' }, { game: 'dk', players: [] }, { game: 'dk', players: [{ id: 'me' }], trick: {} },
    { game: 'dk', players: [{ id: 'me', hand: null }, { id: 'b' }], trick: { cards: [] }, phase: 'play', turn: 3, team: [] },
    { game: 'dk', players: [{ id: 'me', hand: [] }, { id: 'b', hand: [] }], trick: { cards: [{ card: 'x' }] }, phase: 'play', turn: 0, team: ['re', 'kontra'], known: null, tricksDone: 'x' },
    { game: 'dk', players: [{ id: 'me', hand: [999, -1] }], trick: { cards: [{ card: 77 }] }, phase: 'play', turn: 0, team: ['re'], known: [], tricksDone: 0 }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
