import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../romme/engine.js';
import * as W from '../romme/work.js';
import { chooseAction } from '../romme/ai.js';
import { coach } from '../romme/tutorial.js';

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
  assert.ok(r.text.trim().length > 0 && r.text.length <= 190, 'Text (Länge ' + r.text.length + '): ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text) && !/[♣♠♥♦★✔✖]/.test(r.text), 'kein Emoji/Zeichen');
  assert.ok(!/Rummikub|Canasta|Rommee/i.test(r.text), 'neutrale Namen');
  assert.ok(!/beste|besser|empfehl|am klügsten|solltest|Tipp:|diesen Zug|diese Karten|lege den|lege die/i.test(r.text), 'keine Empfehlung: ' + r.text);
  assert.ok(!/(Kreuz|Pik|Herz|Karo) (Ass|Zwei|Drei|Vier|Fünf|Sechs|Sieben|Acht|Neun|Zehn|Bube|Dame|König)/.test(r.text), 'keine konkreten Karten: ' + r.text);
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (rng, humanFirst = true) => E.createGame(humanFirst ? [{ id: 'me', name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: 'me', name: 'A' }], {}, rng);

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: 'me', ui: {} };
  const g0 = mk(seeded(1));
  for (const g of [null, undefined, {}, { players: null }, { game: 'rm', players: [], table: [], pile: [], discard: [] }, { game: 'rm', players: [{ id: 'me', hand: null }], table: null, pile: [], discard: [], phase: 'play', active: 0 },
    { game: 'rm', players: [{ id: 'me', hand: [1, 2], melded: false }], table: [], pile: [], discard: [], phase: 'play', active: 0, turn: 'play', plies: 0 }, { game: 'rm', players: [null], table: [], pile: [], discard: [] }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: 'me' }, { id: 'me', ui: null }]) checkOut(coach(g, c));
  }
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { sel: 'kaputt', work: 7, coachSeen: 7 } }));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { sel: [null, -5, 1e9, 'a'], work: [null, [1, 'x', 2.5], 'y', [999]] } }));
  checkOut(coach(mk(seeded(2)), { id: 'me', ui: { work: [[1, 1, 1]] } }));
  const g2 = mk(seeded(3));
  g2.recap = null; g2.lastPlayed = null; g2.turn = 'play';
  checkOut(coach(g2, ctx));
  const g3 = mk(seeded(4));
  g3.phase = 'kaputt';
  assert.equal(coach(g3, ctx), null);
  g3.phase = 'play'; g3.pile = null;
  assert.equal(coach(g3, ctx), null);
  g3.pile = []; g3.discard = null;
  assert.equal(coach(g3, ctx), null);
  assert.equal(coach(mk(seeded(4)), { id: 'fremd', ui: {} }), null);
  assert.ok(g0);
});

test('Partien Mensch (gesteuert) gegen Computer: Coach immer sinnvoll, Erklärungen je einmal, Ziel bei eigenem Zug', () => {
  const keys = [
    ['bad', /Rot umrandet heißt/], ['open40', /Noch zu wenig für die Eröffnung/], ['meld', /Alle Sätze sind gültig/], ['newset', /Mit „Neuer Satz“ legst du/], ['back', /Mit „Zurück in die Hand“/],
    ['tap', /Tippe eine Karte in deiner Hand an/], ['kinds', /Ein Satz braucht 3 Karten/], ['open', /Dein erstes Auslegen heißt Eröffnung/], ['discard', /Schritt 3: Markiere eine Karte/],
    ['attach', /an Sätze auf dem Tisch anlegen/], ['rearr', /Karten zwischen Sätzen umlegen/], ['joker', /Der Joker \(Stern\)/], ['last', /Orange umrandete Karten/],
    ['end', /Die Runde endet, wenn jemand/], ['opp', /Jetzt ist der Computer dran\. Schau einfach zu\. Was/], ['take', /Schritt 1: Nimm eine Karte/], ['ablage', /Von der Ablage nimmst du/], ['steps', /drei Schritte/],
  ];
  const seen = {}; let computer = 0, over = 0, mineTurns = 0, targets = 0, withSel = 0, withWork = 0, bads = 0, draws = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seeded(seed);
    const g = mk(rnd, seed % 2 === 1);
    const ui = {};
    const ctx = { id: 'me', ui };
    const shown = {};
    const sigOf = () => `${g.round}|${g.plies}|${g.turn}|${E.tableIds(g.table).length}|${g.players.find((p) => p.id === 'me').hand.length}|${g.active}`;
    const note = (text, sig) => { for (const [k, re] of keys) if (re.test(text)) (shown[k] = shown[k] || new Set()).add(sig); };
    let ply = 0;
    for (; ply < 1500 && g.phase !== 'over'; ply++) {
      const r = coach(g, ctx);
      checkOut(r);
      const ap = E.activePlayer(g);
      if (ap.id === 'me') {
        const me = g.players.find((p) => p.id === 'me');
        const sig = sigOf();
        if (g.turn === 'draw') {
          draws++;
          const rr = coach(g, ctx); checkOut(rr);
          assert.ok(rr && rr.target, 'Karte nehmen: Ziel erwartet');
          note(rr.text, sig);
          const act = chooseAction(g, 'me', seed % 3 === 0 ? 1 : 0, rnd);
          assert.ok(E.handle(g, 'me', act, rnd).ok);
          continue;
        }
        mineTurns++;
        // Zustände der Oberfläche durchspielen: nichts, Auswahl, Arbeitskopie mit (ungültigem) Satz, Arbeitskopie mit gültigem Zug
        const states = [{ sel: [], work: W.cloneTable(g.table) }];
        const hand = me.hand.slice();
        if (hand.length) { states.push({ sel: [hand[0]], work: W.cloneTable(g.table) }); withSel++; }
        if (hand.length > 2) { states.push({ sel: [], work: W.cloneTable(g.table).concat([hand.slice(0, 3)]) }); withWork++; }
        const act = chooseAction(g, 'me', seed % 3 === 0 ? 1 : 0, rnd);
        if (act && act.t === 'meld') { states.push({ sel: [], work: act.table.map((s) => s.slice()) }); withWork++; }
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
        assert.ok(E.handle(g, 'me', act, rnd).ok);
      } else {
        assert.ok(r && /Computer/.test(r.text), 'Computer-Text: ' + (r && r.text));
        note(r.text, `${g.round}|${g.plies}|${g.turn}|${g.active}`);
        computer++;
        E.handle(g, 'bot1', chooseAction(g, 'bot1', seed % 3 === 0 ? 1 : 0, rnd), rnd);
      }
    }
    const last = coach(g, ctx);
    checkOut(last);
    assert.ok(/zu Ende/.test(last.text) && last.target === '[data-act="next"]');
    over++;
    for (const [k, s] of Object.entries(shown)) { if (k === 'opp') continue; assert.equal(s.size, 1, `${k} nur einmal pro Zugschritt (${[...s]})`); seen[k] = (seen[k] || 0) + 1; }
    assert.ok((shown.opp ? shown.opp.size : 0) <= 1, 'opp nur ein einziges Mal je Runde: ' + (shown.opp ? [...shown.opp] : ''));
  }
  assert.equal(over, 60);
  assert.ok(seen.take >= 55 && seen.tap >= 55 && seen.kinds >= 55 && seen.discard >= 50, JSON.stringify(seen));
  assert.ok(seen.open >= 20 && seen.newset >= 40 && seen.bad >= 25 && seen.meld >= 15, JSON.stringify(seen));
  assert.ok(mineTurns > 300 && computer > 300 && targets > 800 && withSel > 250 && withWork > 250 && bads > 25 && draws > 300);
  console.log('Erklärungen (Partien):', JSON.stringify(seen), '| eigene Züge', mineTurns, 'Computerzüge', computer);
});

test('Texte vollständig, ohne Zugempfehlung', () => {
  const rnd = seeded(7);
  const g = mk(rnd, true);
  const all = new Set();
  const ctx = { id: 'me', ui: {} };
  for (let i = 0; i < 200 && g.phase !== 'over'; i++) {
    const r = coach(g, ctx);
    if (r) all.add(r.text);
    const ap = E.activePlayer(g);
    E.handle(g, ap.id, chooseAction(g, ap.id, 1, rnd), rnd);
  }
  for (const t of all) checkOut({ text: t });
  assert.ok(all.size >= 4);
});

test('Eröffnung unter 40 Punkten und ungültiger Satz: passende Erklärung; Ende-Text', () => {
  const g = mk(seeded(3), true);
  const me = g.players[0];
  g.active = 0; g.turn = 'play';
  me.hand = [0, 1, 2, 13, 26, 39, 40, 41, 50, 51, 52, 60, 70];
  let r = coach(g, { id: 'me', ui: { work: [[0, 1, 2]], sel: [] } });
  assert.match(r.text, /Noch zu wenig für die Eröffnung/); assert.equal(r.target, '.rm-open');
  r = coach(g, { id: 'me', ui: { work: [[0, 1, 13]], sel: [] } });
  assert.match(r.text, /Rot umrandet/); assert.equal(r.target, '.rm-set.bad');
  r = coach(g, { id: 'me', ui: { sel: [0] } });
  assert.match(r.text, /Neuer Satz/);
  g.phase = 'over';
  r = coach(g, { id: 'me', ui: {} });
  assert.match(r.text, /zu Ende/); assert.equal(r.target, '[data-act="next"]');
});

test('Selektoren der Erklärungen existieren in der Oberfläche (Quelltextabgleich)', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../romme/app.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../romme/draw.js', import.meta.url), 'utf8');
  const tut = fs.readFileSync(new URL('../romme/tutorial.js', import.meta.url), 'utf8');
  const sels = new Set([...tut.matchAll(/(?:target:|const (?:HAND|PILES) =) '([^']+)'/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())));
  assert.ok(sels.size >= 10);
  for (const s of sels) {
    for (const cls of s.match(/\.[a-z][\w-]+/g) || []) assert.ok(app.includes(cls.slice(1)) || /coach/.test(cls), `Klasse ${cls} (${s}) kommt in der Oberfläche nicht vor`);
    for (const m of s.matchAll(/data-act="([^"]+)"/g)) assert.ok(app.includes(`data-act="${m[1]}"`) || app.includes(`data-act=\\"${m[1]}\\"`) || new RegExp(`'${m[1]}'`).test(app), `data-act ${m[1]} fehlt`);
  }
});
