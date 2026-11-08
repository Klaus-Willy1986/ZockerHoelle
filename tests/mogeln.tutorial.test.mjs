import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../mogeln/engine.js';
import { chooseAction } from '../mogeln/ai.js';
import { coach } from '../mogeln/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {}, sel: [] } });
const NEW = (seed) => M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], {}, seeded(seed), 'me');

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 260, `${where}: Text (${r.text.length}) "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => { const r = coach(g, ctx); assert.ok(r, `${where}: kein Coach`); check(r, where); return r; };
// Strategie-Wörter, die in Hinweisen nie vorkommen dürfen
const ADVICE = /am besten|besser|empfehl|solltest|Tipp:|lieber|klug|Strategie|schwindle|mogle jetzt|lüge jetzt|sag(e)? (die )?Wahrheit|zweifle jetzt|glaube jetzt|rate ich|Vorsicht|Achtung/i;

// Spielt nur nach den Hinweisen; `rng` entscheidet, was gelegt wird und ob geglaubt wird (alles ist erlaubt)
function followHints(g, ctx, r, rng) {
  const t = r.target;
  const me = g.players.find((p) => p.id === 'me');
  if (t === '[data-act=card]') {
    const free = me.hand.filter((x) => !ctx.ui.sel.includes(x));
    ctx.ui.sel.push(free[Math.floor(rng() * free.length)]);
    return { ok: true };
  }
  if (t === '[data-act=play]') {
    const want = 1 + Math.floor(rng() * 4);
    while (ctx.ui.sel.length < Math.min(want, me.hand.length)) {
      const free = me.hand.filter((x) => !ctx.ui.sel.includes(x));
      ctx.ui.sel.push(free[Math.floor(rng() * free.length)]);
    }
    const cards = ctx.ui.sel.slice(0, 4); ctx.ui.sel = [];
    return M.handle(g, 'me', { t: 'play', cards }, rng);
  }
  if (t === '[data-act=believe],[data-act=call]') return M.handle(g, 'me', { t: rng() < 0.5 ? 'believe' : 'call' }, rng);
  if (t === '[data-act=next]') return M.handle(g, 'me', { t: 'next' }, rng);
  assert.fail('Unbekanntes Ziel ' + t);
  return null;
}

test('Lernrunde gegen den Computer: immer gültiger Text, Ziel nur wenn ich handeln muss, Hinweise führen zum Rundenende', () => {
  const texts = new Set();
  let ended = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const rng = seeded(seed * 3);
    const g = NEW(seed);
    const ctx = mkCtx();
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 8000) {
      const r = must(g, ctx, `seed ${seed} ${g.phase}`);
      texts.add(r.text);
      assert.ok(!ADVICE.test(r.text), 'Strategie-Hinweis: ' + r.text);
      const myTurn = g.phase === 'reveal' || M.activePlayer(g).id === 'me';
      if (!myTurn) {
        assert.equal(r.target, undefined, 'Kein Ziel, wenn der Computer dran ist: ' + r.text);
        const m = chooseAction(g, 'bot1', 0, rng);
        assert.equal(M.handle(g, 'bot1', m, rng).ok, true);
        continue;
      }
      assert.ok(r.target, 'Ziel erwartet: ' + r.text);
      const res = followHints(g, ctx, r, rng);
      assert.equal(res.ok, true, 'Hinweis führt zu gültigem Zug: ' + r.target + ' ' + res.error);
    }
    assert.equal(g.phase, 'over');
    const end = must(g, ctx, 'Ende');
    assert.equal(end.target, '[data-act=next]'); texts.add(end.text);
    ended++;
  }
  assert.equal(ended, 80);
  const all = [...texts].join(' ');
  for (const w of ['Alle', 'verdeckt', 'mogeln', 'Mogler', 'Glauben', 'Stapel', 'Weiter', 'keine Karten mehr', 'Karten legen', 'markieren']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Jede Erklärung kommt nur einmal: ein langer Text taucht nach einem anderen nie wieder auf', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const g = NEW(seed);
    const ctx = mkCtx();
    const seq = [];
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 8000) {
      const r = must(g, ctx, 'seq');
      if (r.target && seq[seq.length - 1] !== r.text) seq.push(r.text);
      const myTurn = g.phase === 'reveal' || M.activePlayer(g).id === 'me';
      if (!myTurn) { M.handle(g, 'bot1', chooseAction(g, 'bot1', 1, rng), rng); continue; }
      followHints(g, ctx, r, rng);
    }
    const counts = {};
    for (const t of seq) counts[t] = (counts[t] || 0) + 1;
    for (const [t, n] of Object.entries(counts)) if (t.length > 80 && !/Runde ist zu Ende|gewonnen/.test(t)) assert.equal(n, 1, t);
  }
});

test('Erklärungen: gleiche Lage -> gleicher Text, nächste Lage -> kurze Form; Ziele passen zur Lage', () => {
  const g = NEW(2);
  const ctx = mkCtx();
  assert.equal(g.active, 0);
  const a = must(g, ctx, 'a');
  assert.equal(a.target, '[data-act=card]');
  assert.ok(/Alle Asse/.test(a.text) && /verdeckt/.test(a.text) && /mogeln/.test(a.text));
  assert.equal(must(g, ctx, 'a2').text, a.text);
  ctx.ui.sel = [g.players[0].hand[0]];
  const b = must(g, ctx, 'b');
  assert.equal(b.target, '[data-act=play]');
  assert.ok(/Karten legen/.test(b.text));
  assert.equal(must(g, ctx, 'b2').text, b.text);
  M.handle(g, 'me', { t: 'play', cards: ctx.ui.sel }, seeded(5)); ctx.ui.sel = [];
  assert.equal(must(g, ctx, 'c').target, undefined); // Computer entscheidet
  M.handle(g, 'bot1', { t: 'believe' });
  M.handle(g, 'bot1', { t: 'play', cards: [g.players[1].hand[0]] });
  const d = must(g, ctx, 'd');
  assert.equal(d.target, '[data-act=believe],[data-act=call]');
  assert.ok(/Glauben/.test(d.text) && /Mogler/.test(d.text));
  M.handle(g, 'me', { t: 'call' });
  const e = must(g, ctx, 'e');
  assert.equal(e.target, '[data-act=next]');
  assert.ok(/aufgedeckt/.test(e.text) || /Stapel/.test(e.text));
  // Sortierung der Erklärung bei "Stapel genommen"
  M.handle(g, 'me', { t: 'next' });
  assert.equal(g.phase, 'play');
  const f = must(g, ctx, 'f');
  if (M.activePlayer(g).id === 'me') assert.ok(/Angesagt wird: Alle/.test(f.text) || /Alle/.test(f.text));
});

test('Wer den Stapel nehmen muss, bekommt eine Erklärung dazu (einmal); ausgewählte fremde Karten werden ignoriert', () => {
  const g = NEW(7);
  g.phase = 'reveal'; g.active = 0;
  g.last = { kind: 'reveal', takerId: 'me', taken: 5, ids: [1], rank: 0, liar: true };
  const ctx = mkCtx();
  const a = must(g, ctx, 'took');
  assert.ok(/Stapel nehmen/.test(a.text) && a.target === '[data-act=next]');
  g.moves += 1;
  assert.ok(!/Stapel nehmen/.test(must(g, ctx, 'took2').text));
  // Auswahl mit Karten, die nicht (mehr) auf der Hand sind
  const h = NEW(8); const c2 = mkCtx(); c2.ui.sel = [999, -1, 'x'];
  assert.equal(must(h, c2, 'sel').target, '[data-act=card]');
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'mg' }, { game: 'mg', players: [] }, { game: 'mg', players: [{ id: 'me' }], phase: 'play', active: 0 },
    { game: 'mg', players: [{ id: 'me', hand: [1] }], phase: 'decide', active: 5, lastPlay: 'x' },
    { game: 'mg', players: [{ id: 'me', hand: [] }], phase: 'decide', active: 0, lastPlay: { count: 'a', rank: null } },
    { game: 'mg', players: [{ id: 'me', hand: [] }], phase: 'reveal', active: 0, last: 5 }, { game: 'mg', players: [{ id: 'me' }], phase: 'over', result: null }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }, { id: 'me', ui: { sel: 5 } }, { id: 'me', ui: { sel: [null] } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
