import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../maexchen/engine.js';
import { chooseAction } from '../maexchen/ai.js';
import { coach } from '../maexchen/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const mkCtx = (id = 'me') => ({ id, ui: { coachSeen: {}, lifted: false } });
const NEW = (seed, short = true) => M.createGame([{ id: 'me', name: 'Du' }, { id: 'bot1', name: 'Computer' }], { short }, seeded(seed));

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 230, `${where}: Text (${r.text.length}) "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => { const r = coach(g, ctx); assert.ok(r, `${where}: kein Coach`); check(r, where); return r; };
// Strategie-Wörter, die in Hinweisen nie vorkommen dürfen
const ADVICE = /am besten|besser|empfehl|solltest|Tipp:|lieber|klug|Strategie|schwindle|lüge jetzt|sag(e)? (die )?Wahrheit|zweifle jetzt|glaube jetzt|rate ich/i;

// Spielt nur nach den Hinweisen; `rng` entscheidet bei Glauben/Aufdecken (beides ist erlaubt)
function followHints(g, ctx, r, rng) {
  const t = r.target;
  if (t === '[data-act=roll]') return M.handle(g, 'me', { t: 'roll' }, rng);
  if (t === '[data-act=lift]') { ctx.ui.lifted = true; return M.handle(g, 'me', { t: 'look' }); }
  if (t === '[data-act=say]') { const al = M.allowedSays(g); return M.handle(g, 'me', { t: 'say', v: al.includes(g.cup) ? g.cup : al[Math.floor(rng() * al.length)] }); }
  if (t === '[data-act=believe],[data-act=doubt]') return M.handle(g, 'me', { t: rng() < 0.5 ? 'believe' : 'doubt' });
  if (t === '[data-act=doubt]') return M.handle(g, 'me', { t: 'doubt' });
  if (t === '[data-act=next]') return M.handle(g, 'me', { t: 'next' });
  assert.fail('Unbekanntes Ziel ' + t);
}

test('Lernrunde gegen den Computer: immer gültiger Text, Ziel nur wenn ich handeln muss, Hinweise führen zum Spielende', () => {
  const texts = new Set();
  let ended = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const rng = seeded(seed * 3);
    const g = NEW(seed, seed % 2 === 0);
    const ctx = mkCtx();
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 5000) {
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
    assert.equal(end.target, '[data-act=again]'); texts.add(end.text);
    ended++;
  }
  assert.equal(ended, 80);
  const all = [...texts].join(' ');
  for (const w of ['Becher anheben', 'höher', 'Glauben', 'Aufdecken', 'Mäxchen', 'Leben', 'schwindeln', 'Weiter', 'raus']) assert.ok(all.includes(w), 'Erklärung fehlt: ' + w);
});

test('Jede Erklärung kommt nur einmal: ein langer Text taucht nach einem anderen nie wieder auf', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const g = NEW(seed, false);
    const ctx = mkCtx();
    const seq = [];
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 5000) {
      const r = must(g, ctx, 'seq');
      if (r.target && seq[seq.length - 1] !== r.text) seq.push(r.text); // nur Erklärungen mit Handlungsziel (Warte-Hinweise des Computers dürfen sich wiederholen)
      const myTurn = g.phase === 'reveal' || M.activePlayer(g).id === 'me';
      if (!myTurn) { M.handle(g, 'bot1', chooseAction(g, 'bot1', 1, rng), rng); continue; }
      followHints(g, ctx, r, rng);
    }
    const seen = new Set();
    for (const t of seq) {
      if (t.length > 80) { assert.ok(!seen.has(t), 'Erklärung wiederholt: ' + t); }
      seen.add(t);
    }
    // jede lange Erklärung insgesamt nur in einem zusammenhängenden Abschnitt
    const counts = {};
    for (const t of seq) counts[t] = (counts[t] || 0) + 1;
    for (const [t, n] of Object.entries(counts)) if (t.length > 80 && !/Spiel ist zu Ende|gewonnen/.test(t)) assert.equal(n, 1, t);
  }
});

test('Erklärungen: gleiche Lage -> gleicher Text, nächste Lage -> kurze Form', () => {
  const g = NEW(2);
  const ctx = mkCtx();
  const a = must(g, ctx, 'a');
  assert.equal(a.target, '[data-act=roll]');
  assert.ok(/Mäxchen/.test(a.text) && /Becher/.test(a.text));
  assert.equal(must(g, ctx, 'a2').text, a.text);
  M.handle(g, 'me', { t: 'roll' }, seeded(5));
  const b = must(g, ctx, 'b');
  assert.equal(b.target, '[data-act=lift]');
  ctx.ui.lifted = true;
  const c = must(g, ctx, 'c');
  assert.equal(c.target, '[data-act=say]');
  assert.ok(/höher/.test(c.text));
  M.handle(g, 'me', { t: 'say', v: 52 }); // Computer ist dran zu entscheiden
  assert.equal(must(g, ctx, 'd').target, undefined);
  M.handle(g, 'bot1', { t: 'believe' }); M.handle(g, 'bot1', { t: 'roll' }, seeded(9)); M.handle(g, 'bot1', { t: 'say', v: 53 });
  const e = must(g, ctx, 'e');
  assert.equal(e.target, '[data-act=believe],[data-act=doubt]');
  assert.ok(/Glauben/.test(e.text));
  M.handle(g, 'me', { t: 'doubt' });
  const f = must(g, ctx, 'f');
  assert.equal(f.target, '[data-act=next]');
  assert.ok(/Becher ist offen/.test(f.text));
  M.handle(g, 'me', { t: 'next' }); // nächste Runde
  // zweite Runde: kurze Form
  const h = must(g, ctx, 'h');
  if (M.activePlayer(g).id === 'me') assert.equal(h.text, 'Tippe auf Würfeln.');
});

test('Mäxchen wird erklärt (angesagt: aufdecken; verloren: zwei Leben), auch wenn man es selbst würfelt', () => {
  const g = NEW(4, false);
  g.phase = 'decide'; g.active = 0; g.announcer = 1; g.announced = 21; g.cup = 31; g.cupDice = [3, 1];
  const ctx = mkCtx();
  const a = must(g, ctx, 'maex');
  assert.equal(a.target, '[data-act=doubt]');
  assert.ok(/zwei Leben/.test(a.text));
  g.moves += 1;
  assert.equal(must(g, ctx, 'maex2').text, 'Bei einem Mäxchen musst du aufdecken.');
  const h = NEW(5, false);
  h.phase = 'announce'; h.active = 0; h.cup = 21; h.cupDice = [2, 1];
  const c2 = mkCtx(); c2.ui.lifted = true;
  assert.ok(/Mäxchen gewürfelt/.test(must(h, c2, 'real').text));
  // Verlust von 2 Leben
  const r = NEW(6, false);
  r.phase = 'reveal'; r.active = 0; r.last = { kind: 'reveal', loss: 2, out: false };
  assert.ok(/zwei Leben/.test(must(r, mkCtx(), 'lost2').text));
  r.last = { kind: 'reveal', loss: 1, out: true };
  assert.ok(/raus/.test(must(r, mkCtx(), 'out').text));
});

test('Wirft nie, auch bei kaputten Eingaben', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { game: 'mx' }, { game: 'mx', players: [] }, { game: 'mx', players: [{ id: 'me' }], phase: 'announce', active: 0 },
    { game: 'mx', players: [{ id: 'me', lives: 3 }], phase: 'decide', active: 5, announced: 'x' },
    { game: 'mx', players: [{ id: 'me', lives: 3 }], phase: 'reveal', active: 0, last: 5 }, { game: 'mx', players: [{ id: 'me' }], phase: 'over', result: null }];
  for (const g of junk) for (const ctx of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 5 } }]) {
    assert.doesNotThrow(() => coach(g, ctx));
  }
});
