import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../farbkarten/engine.js';
import { chooseAction } from '../farbkarten/ai.js';
import { coach } from '../farbkarten/tutorial.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Ziele: einfache Selektoren, durch Komma getrennt
const SEL_OK = /^(\[data-act="[a-z-]+"\]|\.[a-z][a-z-]*( \.[a-z][a-z-]*)*)(, (\[data-act="[a-z-]+"\]|\.[a-z][a-z-]*( \.[a-z][a-z-]*)*))*$/;
const EXPLAIN = {
  pen: /nicht gerufen\. Darum/, oppS: /Der Computer hat Aussetzen gelegt/, oppU: /Der Computer hat Richtungswechsel gelegt/,
  oppZ: /Der Computer hat Zwei ziehen gelegt/, oppW4: /Der Computer hat Vier ziehen gelegt/, oppW: /Der Computer hat einen Joker gelegt/,
  mineS: /^Der Computer muss aussetzen/, mineU: /^Zu zweit wirkt Richtungswechsel/, mineZ: /^Der Computer hat 2 Karten gezogen/, mineW4: /^Der Computer hat 4 Karten gezogen/, mineW: /^Du hast einen Joker gelegt/,
  cardS: /Du hast Aussetzen\./, cardU: /Du hast Richtungswechsel\./, cardZ: /Du hast Zwei ziehen\./, cardW: /Du hast einen Joker\. Er passt/, cardW4: /Du hast Vier ziehen\./,
  draw: /Passt sie, darfst du sie legen/, intro: /gleicher Farbe oder gleicher Zahl wie die Karte in der Mitte/,
};

function checkOut(r) {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'));
  if (!r) return;
  assert.ok(r.text.length > 0 && r.text.length <= 200, 'Länge ' + r.text.length + ': ' + r.text);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(r.text), 'keine Emojis');
  assert.ok(!new RegExp('u' + 'no', 'i').test(r.text));
  if (r.target !== undefined) assert.match(r.target, SEL_OK);
}

// Spielt eine Runde: Mensch folgt nur dem Ziel, der Computer (Leicht) spielt selbst.
function playOnce(seed, opts = {}) {
  const dice = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = E.createGame([{ id: 'me', name: 'Anna' }, { id: 'bot1', name: 'Computer' }], opts, dice);
  const ui = { pick: null };
  const ctx = { id: 'me', S: {}, ui };
  const runs = {}, lastOn = {};
  let steps = 0, humanStates = 0;
  while (g.mode === 'play' && steps < 8000) {
    steps++;
    const ap = E.activePlayer(g);
    let r = coach(g, ctx);
    checkOut(r);
    for (const [k, re] of Object.entries(EXPLAIN)) {
      const on = !!(r && re.test(r.text));
      if (on && !lastOn[k]) runs[k] = (runs[k] || 0) + 1;
      lastOn[k] = on;
    }
    const meHand = g.players[0].hand;
    // Ruf offen? (steht vor allem anderen)
    if (g.call && g.call.pid === 'me' && meHand.length === 1) {
      humanStates++;
      assert.equal(r.target, '[data-act="call"]');
      assert.equal(E.handle(g, 'me', { t: 'call' }, dice).ok, true);
      continue;
    }
    let msg;
    if (ap.id === 'me') {
      humanStates++;
      assert.ok(r && r.text, 'Coach braucht Text, wenn der Mensch dran ist');
      assert.ok(r.target, 'Coach braucht ein Ziel, wenn der Mensch dran ist: ' + JSON.stringify(g.last));
      const legal = E.legalCards(g, 0);
      if (g.stage === 'color') { assert.equal(r.target, '[data-act="color"]'); msg = { t: 'color', color: E.COLORS[Math.floor(brain() * 4)] }; }
      else if (g.drawn) {
        assert.match(r.target, /fk-ok.*keep/);
        if (brain() < 0.3) msg = { t: 'keep' };
        else if (E.isWild(g.drawn)) { ui.pick = g.drawn; const r2 = coach(g, ctx); checkOut(r2); assert.equal(r2.target, '[data-act="color"]'); ui.pick = null; msg = { t: 'play', card: g.drawn, color: 'R' }; }
        else msg = { t: 'play', card: g.drawn };
      } else if (g.pending) {
        assert.match(r.target, /draw/);
        msg = legal.length && brain() < 0.5 ? { t: 'play', card: legal[0], color: 'B' } : { t: 'draw' };
      } else if (legal.length) {
        assert.equal(r.target, '.fk-hand .fk-ok');
        const card = legal[Math.floor(brain() * legal.length)];
        if (E.isWild(card)) {
          ui.pick = card;
          const r2 = coach(g, ctx);
          checkOut(r2);
          assert.equal(r2.target, '[data-act="color"]', 'Joker gewählt: Farbauswahl leuchtet');
          assert.match(r2.text, /Farbe/);
          ui.pick = null;
          msg = { t: 'play', card, color: E.COLORS[Math.floor(brain() * 4)] };
        } else msg = { t: 'play', card };
      } else { assert.equal(r.target, '[data-act="draw"]'); msg = { t: 'draw' }; }
    } else {
      assert.ok(r && /Computer/.test(r.text) && !r.target, 'Computer dran: Text ohne Ziel: ' + (r && r.text));
      msg = chooseAction(g, ap.id, 0, brain);
    }
    const res = E.handle(g, ap.id, msg, dice);
    assert.equal(res.ok, true, JSON.stringify(msg) + res.error);
  }
  assert.notEqual(g.mode, 'play');
  const end = coach(g, ctx);
  checkOut(end);
  assert.equal(end.target, g.mode === 'over' ? '[data-act="again"]' : '[data-act="next"]');
  return { runs, humanStates };
}

test('Farbkarten-Lernrunde: Coach deckt jeden Zustand ab, erklärt nur einmal', () => {
  const total = {};
  for (let seed = 1; seed <= 150; seed++) {
    const { runs, humanStates } = playOnce(seed, { stack: seed % 3 === 0, auto: seed % 5 === 0 });
    assert.ok(humanStates >= 1, "zu wenige Zustände " + humanStates + " Seed " + seed);
    for (const [k, n] of Object.entries(runs)) { assert.ok(n <= 1, `${k} ${n}x (Seed ${seed})`); total[k] = (total[k] || 0) + 1; }
  }
  for (const k of ['cardS', 'cardU', 'cardZ', 'cardW', 'cardW4', 'draw', 'intro', 'oppS', 'oppW', 'mineS', 'mineZ']) assert.ok(total[k] > 0, k + ' kam nie vor');
  console.log('Erklärungen (Anzahl Runden):', JSON.stringify(total));
});

test('Farbkarten-Lernrunde: Ruf-Hinweis und Strafe', () => {
  const g = E.createGame([{ id: 'me', name: 'Anna' }, { id: 'bot1', name: 'C' }], {}, seedRng(1));
  g.discard = ['B1', 'R5']; g.color = 'R'; g.active = 0; g.stage = 'play'; g.pending = null; g.drawn = null;
  g.players[0].hand = ['R1', 'G1']; g.players[1].hand = ['Y2', 'Y3', 'Y4'];
  g.deck = ['B2', 'B3', 'B4', 'B6'];
  const ui = {};
  E.handle(g, 'me', { t: 'play', card: 'R1' }, seedRng(2));
  const r = coach(g, { id: 'me', ui });
  assert.equal(r.target, '[data-act="call"]');
  assert.match(r.text, /Letzte Karte/);
  // nicht gerufen: der Computer zieht -> Strafe wird erklärt
  E.handle(g, 'bot1', { t: 'draw' }, seedRng(2));
  assert.equal(g.players[0].hand.length, 3);
  const r2 = coach(g, { id: 'me', ui });
  assert.match(r2.text, /nicht gerufen\. Darum hast du 2 Karten bekommen/);
});

test('Farbkarten-Lernrunde: kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'fk' }, { game: 'fk', players: [], mode: 'play' },
    { game: 'fk', players: [null], mode: 'play' }, { game: 'fk', players: [{ id: 'me', hand: 5 }], mode: 'play', active: 3 },
    { game: 'fk', players: [{ id: 'me', hand: ['R1'] }], mode: 'play', active: 0, discard: [], stage: 'play' }];
  const ctxs = [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 7 } }, { id: 'me', ui: {} }];
  for (const g of bad) for (const c of ctxs) {
    const r = coach(g, c);
    assert.ok(r === null || typeof r.text === 'string');
  }
  const g = E.createGame([{ id: 'me', name: 'A' }, { id: 'b', name: 'B' }], {}, seedRng(1));
  for (const c of ctxs) checkOut(coach(g, c));
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});
