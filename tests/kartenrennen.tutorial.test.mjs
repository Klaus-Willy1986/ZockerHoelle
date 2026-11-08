import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../kartenrennen/engine.js';
import { chooseAction } from '../kartenrennen/ai.js';
import { coach } from '../kartenrennen/tutorial.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEL_OK = /^(\[data-act="[a-z-]+"\]|\.[a-z][a-z-]*(\.[a-z][a-z-]*)?)$/;
const EXPLAIN = {
  swap: /verdeckt an ihre Partnerin/, intro: /^Jetzt bist du dran\. Spiele eine Karte/, stall: /noch im Stall\. Ein Stein kommt nur/,
  partner: /Deshalb spielst du jetzt die Steine deiner Partnerin/, gotCaptured: /wurde geschlagen\. Er muss/, joker: /Der Joker ersetzt jede Karte\. Du wählst/,
  capture: /Hier steht ein fremder Stein/, ownCapture: /Stein aus deinem Team/, goal: /kommt in dein Ziel/, discard: /Dann musst du alle Karten abwerfen/,
  r2: /^Eine 2:/, r3: /^Eine 3:/, r5: /^Eine 5:/, r6: /^Eine 6:/, r8: /^Eine 8:/, r9: /^Eine 9:/, r10: /^Eine 10:/,
  dame: /^Die Dame ist/, vier: /^Die Vier geht/, sieben: /^Die Sieben hat/, bube: /^Der Bube tauscht/, ass: /^Das Ass:/, koenig: /^Der König:/,
};
const BAD_ADVICE = /beste|empfehl|solltest|sinnvoll|klug|Tipp:|Strategie|am besten|lohnt/i;

function checkOut(r) {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'));
  if (!r) return;
  assert.ok(r.text.length > 0 && r.text.length <= 230, 'Länge ' + r.text.length + ': ' + r.text);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(r.text), 'keine Emojis');
  assert.ok(!BAD_ADVICE.test(r.text), 'keine Zugempfehlung: ' + r.text);
  if (r.target !== undefined) assert.match(r.target, SEL_OK);
}

const ME = 'me';
function mkGame(seed) {
  return K.createGame([{ id: ME, name: 'Anna' }, { id: 'bot1', name: 'Computer 1' }, { id: 'bot2', name: 'Computer 2' }, { id: 'bot3', name: 'Computer 3' }], { swap: true }, seedRng(seed), ME);
}

// Der Mensch spielt zufällig, so wie die Oberfläche es verlangt (Karte, Ersatzkarte, Option, Stein, Ziel).
function humanTurn(g, ui, r, brain, rng, runs, lastKind, track) {
  const step = (check) => {
    const out = coach(g, { id: ME, ui });
    checkOut(out);
    track(out);
    assert.ok(out && out.text && out.target, 'Coach braucht Text und Ziel, wenn der Mensch handeln muss');
    if (check) assert.equal(out.target, check, out.text);
    return out;
  };
  const seat = g.players.findIndex((p) => p.id === ME);
  if (g.phase === 'swap') {
    const hand = g.players[seat].hand;
    step('[data-act="swapcard"]');
    ui.swapPick = Math.floor(brain() * hand.length);
    step('[data-act="swapok"]');
    const c = hand[ui.swapPick];
    ui.swapPick = null;
    return K.handle(g, ME, { t: 'swap', card: c }, rng);
  }
  if (!K.canPlay(g, ME)) {
    step('[data-act="discard"]');
    return K.handle(g, ME, { t: 'discardAll' }, rng);
  }
  ui.sel = null;
  step('.kr-card.can');
  const play = [...K.playableCards(g, ME)];
  const key = play[Math.floor(brain() * play.length)];
  const [rk, sk] = key.split('|');
  const idx = g.players[seat].hand.findIndex((c) => c.r === rk && c.s === Number(sk));
  const sel = { card: { r: rk, s: Number(sk) }, idx, as: null, opt: null, stone: null, parts: [], left: 7, pb: null };
  ui.sel = sel;
  const send = (move) => { const msg = { t: 'play', card: sel.card, move }; if (rk === 'JOKER') msg.as = sel.as; ui.sel = null; return K.handle(g, ME, msg, rng); };
  for (let guard = 0; guard < 20; guard++) {
    const st = K.selStage(g, ME, sel);
    if (st.stage === 'joker') { step('[data-act="jokeras"]'); sel.as = st.ranks[Math.floor(brain() * st.ranks.length)]; continue; }
    if (st.stage === 'opt') {
      step('[data-act="opt"]');
      const o = st.options[Math.floor(brain() * st.options.length)];
      if (o === 'out') return send({ out: true });
      sel.opt = o; continue;
    }
    if (st.stage === 'stone') { step('.kr-tapstone.kr-can'); sel.stone = st.stones[Math.floor(brain() * st.stones.length)]; continue; }
    if (st.stage === 'target') {
      step('.kr-tgt');
      const t = st.targets[Math.floor(brain() * st.targets.length)];
      if (st.eff === 'BUBE') return send({ swap: [sel.stone, t.g] });
      if (st.eff === '4') return send({ back: sel.stone });
      if (st.eff === '7') {
        sel.parts.push({ stone: sel.stone, steps: t.steps });
        sel.pb = K.stepBoard(sel.pb || K.boardOf(g), sel.stone, t.steps);
        sel.left -= t.steps; sel.stone = null;
        if (sel.left === 0) return send({ split: sel.parts });
        continue;
      }
      return send({ stone: sel.stone, steps: t.steps });
    }
    assert.fail('unerwartete Stufe ' + st.stage);
  }
  assert.fail('Schleife');
  return null;
}

function playOnce(seed) {
  const rng = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = mkGame(seed);
  const ui = {};
  const runs = {}; const lastKind = {};
  let steps = 0, humanTurns = 0;
  const track = (r) => {
    for (const [k, re] of Object.entries(EXPLAIN)) {
      const on = !!(r && re.test(r.text));
      if (on && !lastKind[k]) runs[k] = (runs[k] || 0) + 1;
      lastKind[k] = on;
    }
  };
  while (g.phase !== 'over' && steps < 60000) {
    steps++;
    const mySeat = g.players.findIndex((p) => p.id === ME);
    const humanActs = g.phase === 'swap' ? !g.swapSel[mySeat] : g.turn === mySeat;
    if (humanActs) {
      humanTurns++;
      const res = humanTurn(g, ui, null, brain, rng, runs, lastKind, track);
      assert.equal(res.ok, true, JSON.stringify(res));
      continue;
    }
    // Computer (oder Warten): Coach zeigt Text ohne Ziel
    const out = coach(g, { id: ME, ui });
    checkOut(out);
    track(out);
    assert.ok(out && out.text && !out.target, 'Warten: Text ohne Ziel: ' + JSON.stringify(out));
    let acted = false;
    for (const p of g.players) {
      if (p.id === ME) continue;
      const msg = chooseAction(g, p.id, 0, brain);
      if (!msg) continue;
      if (g.phase === 'play' && g.turn !== p.seat) continue;
      assert.equal(K.handle(g, p.id, msg, rng).ok, true);
      acted = true;
      break;
    }
    assert.ok(acted, 'Computer muss handeln können');
  }
  assert.equal(g.phase, 'over');
  const end = coach(g, { id: ME, ui });
  checkOut(end);
  assert.equal(end.target, '[data-act="next"]');
  return { runs, humanTurns };
}

test('Kartenrennen-Lernrunde: Coach deckt jeden Zustand ab, erklärt nur einmal, keine Zugempfehlung', () => {
  const total = {};
  for (let seed = 1; seed <= 30; seed++) {
    const { runs, humanTurns } = playOnce(seed);
    assert.ok(humanTurns > 20);
    for (const [k, n] of Object.entries(runs)) { assert.ok(n <= 1, `${k} ${n}x (Seed ${seed})`); total[k] = (total[k] || 0) + 1; }
  }
  console.log('Erklärungen (in wie vielen von 30 Partien):', JSON.stringify(total));
  for (const k of ['swap', 'intro', 'stall', 'joker', 'capture', 'goal', 'discard', 'r2', 'r5', 'r10', 'dame', 'vier', 'sieben', 'bube', 'ass', 'koenig', 'gotCaptured']) assert.ok(total[k] > 0, k + ' kam nie vor');
});

test('Kartenrennen-Lernrunde: kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'kr' }, { game: 'kr', players: [] }, { game: 'kr', players: [null, null, null, null] },
    { game: 'kr', players: [{ id: ME, hand: 5 }, {}, {}, {}], phase: 'play', turn: 0 }, { game: 'kr', players: [{ id: ME, hand: [] }, {}, {}, {}], phase: 'swap', swapSel: null },
    { game: 'kr', players: [{ id: ME, hand: [], pieces: null }, {}, {}, {}], phase: 'play', turn: 9 }];
  const ctxs = [undefined, null, {}, { id: ME }, { id: ME, ui: null }, { id: ME, ui: { coachSeen: 7 } }, { id: ME, ui: { sel: 5 } }, { id: ME, ui: { sel: { card: null } } }, { id: ME, ui: { sel: { card: { r: 'XX' } } } }];
  for (const g of bad) for (const c of ctxs) assert.doesNotThrow(() => { const r = coach(g, c); assert.ok(r === null || typeof r.text === 'string'); });
  const g = mkGame(1);
  for (const c of ctxs) checkOut(coach(g, c));
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});

test('Kartenrennen-Lernrunde: Beispiele', () => {
  const g = mkGame(1);
  const ui = {};
  assert.match(coach(g, { id: ME, ui }).text, /verdeckt an ihre Partnerin/);
  assert.equal(coach(g, { id: ME, ui }).target, '[data-act="swapcard"]', 'bleibt stehen, solange sich nichts ändert');
  ui.swapPick = 0;
  assert.equal(coach(g, { id: ME, ui }).target, '[data-act="swapok"]');
  g.swapSel[0] = { r: g.players[0].hand[0].r, s: g.players[0].hand[0].s };
  assert.equal(coach(g, { id: ME, ui }).target, undefined);
  g.phase = 'over'; g.winner = 0;
  assert.match(coach(g, { id: ME, ui }).text, /Dein Team hat gewonnen/);
  g.winner = 1;
  assert.match(coach(g, { id: ME, ui }).text, /andere Team/);
});
