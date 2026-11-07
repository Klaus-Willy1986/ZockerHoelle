import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../reihen/engine.js';
import * as W from '../reihen/work.js';
import { chooseAction } from '../reihen/ai.js';
import { coach } from '../reihen/tutorial.js';

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
  assert.ok(r.text.trim().length > 0 && r.text.length <= 170, 'Text (Länge ' + r.text.length + '): ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text) && !/[●■▲◆★✔✖]/.test(r.text), 'kein Emoji/Zeichen');
  assert.ok(!/Rummikub/i.test(r.text), 'neutrale Namen');
  assert.ok(!/beste|besser|empfehl|am klügsten|solltest|Tipp:|diesen Zug|diese Steine|lege den|lege die/i.test(r.text), 'keine Empfehlung: ' + r.text);
  assert.ok(!/(Rot|Blau|Gelb|Grün) \d/.test(r.text), 'keine konkreten Steine: ' + r.text);
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (rng, humanFirst = true) => E.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], {}, rng);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  const g0 = mk(seeded(1));
  for (const g of [null, undefined, {}, { players: null }, { game: 'rg', players: [], table: [], pile: [] }, { game: 'rg', players: [{ id: 'me', hand: null }], table: null, pile: [], phase: 'play', active: 0 },
    { game: 'rg', players: [{ id: 'me', hand: [1, 2], melded: false }], table: [], pile: [], phase: 'play', active: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { sel: 'kaputt', work: 7, coachSeen: 7 } }));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { sel: [null, -5, 1e9, 'a'], work: [null, [1, 'x', 2.5], 'y', [999]] } }));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { work: [[1, 1, 1]] } }));
  const g2 = mk(seeded(3));
  g2.recap = null; g2.lastPlayed = null;
  checkOut(coach(g2, ctx));
  const g3 = mk(seeded(4));
  g3.phase = 'kaputt';
  assert.equal(coach(g3, ctx), null);
  g3.phase = 'play'; g3.pile = null;
  assert.equal(coach(g3, ctx), null);
  assert.equal(coach(mk(seeded(4)), { id: 'fremd', ui: {} }), null);
  assert.ok(g0);
});

test('Partien Mensch (gesteuert) gegen Computer: Coach immer sinnvoll, Erklärungen je einmal, Ziel bei eigenem Zug', () => {
  const keys = [
    ['bad', /Rot umrandet heißt/], ['open30', /Noch zu wenig für die Eröffnung/], ['play', /Alle Sätze sind gültig/], ['newset', /Mit „Neuer Satz“ legst du/], ['back', /Mit „Zurück in die Hand“/],
    ['tap', /Tippe einen Stein in deiner Hand an/], ['kinds', /Ein Satz braucht 3 Steine/], ['open', /Dein erster Zug heißt Eröffnung/], ['draw', /Mit „Stein ziehen“/],
    ['attach', /an Sätze auf dem Tisch anlegen/], ['rearr', /teilen, auflösen und Steine umlegen/], ['joker', /Der Joker \(Stern\)/], ['last', /Orange umrandete Steine/],
    ['pass', /Der Stapel ist leer/], ['end', /Die Runde endet, wenn/], ['opp', /Jetzt ist der Computer dran\. Schau einfach zu\. Was/],
  ];
  const seen = {}; let computer = 0, over = 0, mineTurns = 0, targets = 0, withSel = 0, withWork = 0, bads = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seeded(seed);
    const g = mk(rnd, seed % 2 === 1);
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const note = (text, sig) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(sig); };
    let ply = 0;
    for (; ply < 900 && g.phase !== 'over'; ply++) {
      const r = coach(g, ctx);
      checkOut(r);
      const ap = E.activePlayer(g);
      const sigOf = () => `${g.round}|${g.pile.length}|${E.tableIds(g.table).length}|${g.passes}|${g.active}`;
      if (ap.id === 'me') {
        mineTurns++;
        const me = g.players.find((p) => p.id === 'me');
        // Zustände der Oberfläche durchspielen: nichts, Auswahl, Arbeitskopie mit (ungültigem) Satz, Arbeitskopie mit gültigem Zug
        const sig = sigOf();
        const states = [{ sel: [], work: W.cloneTable(g.table) }];
        const hand = me.hand.slice();
        if (hand.length) { states.push({ sel: [hand[0]], work: W.cloneTable(g.table) }); withSel++; }
        if (hand.length > 2) {
          const bad = W.cloneTable(g.table).concat([hand.slice(0, 3)]);
          states.push({ sel: [], work: bad }); withWork++;
        }
        const act = chooseAction(g, 'me', seed % 3 === 0 ? 1 : 0, rnd);
        if (act && act.t === 'play') { states.push({ sel: [], work: act.table.map((s) => s.slice()) }); withWork++; }
        for (const st of states) {
          ui.sel = st.sel; ui.work = st.work;
          const rr = coach(g, ctx);
          checkOut(rr);
          assert.ok(rr && rr.target, 'Mensch dran: Ziel erwartet');
          targets++;
          note(rr.text, sig);
          if (/Rot umrandet/.test(rr.text)) bads++;
        }
        ui.sel = []; ui.work = null;
        assert.ok(E.handle(g, 'me', act || { t: 'draw' }, rnd).ok);
      } else {
        assert.ok(r && /Computer/.test(r.text), 'Computer-Text: ' + (r && r.text));
        note(r.text, sigOf());
        computer++;
        E.handle(g, 'bot1', chooseAction(g, 'bot1', seed % 3 === 0 ? 1 : 0, rnd), rnd);
      }
    }
    const last = coach(g, ctx);
    checkOut(last);
    assert.ok(/zu Ende/.test(last.text) && last.target === '[data-act="next"]');
    over++;
    for (const [k, s] of Object.entries(shown)) { assert.equal(s.size, 1, `${k} nur einmal (${[...s]})`); seen[k] = (seen[k] || 0) + 1; }
  }
  assert.equal(over, 60);
  assert.ok(seen.tap >= 55 && seen.kinds >= 55 && seen.open >= 25 && seen.draw >= 40 && seen.newset >= 50, JSON.stringify(seen));
  assert.ok(seen.bad >= 30 && seen.play >= 20 && seen.attach >= 10 && seen.rearr >= 10 && seen.joker >= 10 && seen.opp >= 55, JSON.stringify(seen));
  assert.ok(mineTurns > 400 && computer > 400 && targets > 1000 && withSel > 300 && withWork > 300 && bads > 30);
  console.log('Erklärungen (Partien):', JSON.stringify(seen), '| eigene Züge', mineTurns, 'Computerzüge', computer);
});

test('Texte vollständig, ohne Zugempfehlung', () => {
  const rnd = seeded(7);
  const g = mk(rnd, true);
  const all = new Set();
  const ctx = { id: 'me', ui: {} };
  for (let i = 0; i < 120 && g.phase !== 'over'; i++) {
    const r = coach(g, ctx);
    if (r) all.add(r.text);
    const ap = E.activePlayer(g);
    E.handle(g, ap.id, chooseAction(g, ap.id, 1, rnd), rnd);
  }
  for (const t of all) checkOut({ text: t });
  assert.ok(all.size >= 6);
});

test('Eröffnung unter 30 Punkten und ungültiger Satz: passende Erklärung', () => {
  const g = mk(seeded(3), true);
  const me = g.players[0];
  g.active = 0;
  me.hand = [0, 1, 2, 13, 26, 39, 40, 41, 50, 51, 52, 60, 70, 80];
  const ctx = { id: 'me', ui: { work: [[0, 1, 2]], sel: [] } };
  let r = coach(g, ctx);
  checkOut(r);
  assert.match(r.text, /Noch zu wenig für die Eröffnung/);
  assert.equal(r.target, '.rg-open');
  r = coach(g, ctx); // dieselbe Lage: dieselbe Erklärung bleibt stehen
  assert.match(r.text, /Noch zu wenig/);
  const ctx2 = { id: 'me', ui: { work: [[0, 1, 13]], sel: [] } };
  r = coach(g, ctx2);
  assert.match(r.text, /Rot umrandet/);
  assert.equal(r.target, '.rg-set.bad');
});
