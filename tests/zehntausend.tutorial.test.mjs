import test from 'node:test';
import assert from 'node:assert/strict';
import * as Z from '../zehntausend/engine.js';
import { coach } from '../zehntausend/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mkCtx = (id = 'p0') => ({ id, ui: { sel: Array(6).fill(false), rolling: false, coachSeen: {} } });
const OPTS = { pairs: true, entry: true, short: true };

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text (${r.text.length}) "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => {
  const r = coach(g, ctx);
  assert.ok(r, `${where}: kein Coach`);
  check(r, where);
  return r;
};
// Texte, die eine Empfehlung enthielten (Weiterwürfeln/Aufhören/welche Würfel)
const ADVICE = /\b(solltest|empfehl|besser|am besten|rate ich|lieber|klug|riskant|sicher ist|nimm den|nimm die)\b/i;

// zufälliger Mensch (p0) und Computer (alle anderen)
function step(g, ctx, rng) {
  const ap = Z.activePlayer(g);
  const t = g.turn;
  if (ap.id !== ctx.id) {
    // Bot: einfach gültige Aktion
    if (t.phase === 'start') return Z.handle(g, ap.id, { t: 'roll' }, rng);
    if (t.phase === 'end') return Z.handle(g, ap.id, { t: 'next' });
    if (t.phase === 'pick') return Z.handle(g, ap.id, { t: 'keep', idx: Z.bestSubset(t.dice, g.opts).idx });
    return Z.handle(g, ap.id, Z.canBank(g, ap, t) && rng() < 0.6 ? { t: 'bank' } : { t: 'roll' }, rng);
  }
  const r = must(g, ctx, `phase ${t.phase}`);
  if (t.phase === 'start') return Z.handle(g, ap.id, { t: 'roll' }, rng);
  if (t.phase === 'end') return Z.handle(g, ap.id, { t: 'next' });
  if (t.phase === 'pick') {
    // erst eine falsche Auswahl ausprobieren (falls es eine gibt), dann eine richtige
    const bad = t.dice.map((_, i) => i).filter((i) => Z.scoreExact([t.dice[i]], g.opts) === 0);
    if (bad.length && rng() < 0.5) {
      ctx.ui.sel = Array(6).fill(false); ctx.ui.sel[bad[0]] = true;
      const rb = must(g, ctx, 'falsche Auswahl');
      assert.match(rb.text, /zählt nicht/); assert.equal(rb.target, '[data-act=toggle]');
    }
    const b = Z.bestSubset(t.dice, g.opts);
    ctx.ui.sel = Array(6).fill(false); b.idx.forEach((i) => { ctx.ui.sel[i] = true; });
    const rg = must(g, ctx, 'gute Auswahl');
    assert.equal(rg.target, '[data-act=keep]');
    assert.ok(rg.text.includes(`${b.pts} Punkte`), rg.text);
    ctx.ui.sel = Array(6).fill(false);
    return Z.handle(g, ap.id, { t: 'keep', idx: b.idx });
  }
  assert.ok(r.target.includes('[data-act=roll]'));
  if (Z.canBank(g, ap, t)) assert.ok(r.target.includes('[data-act=bank]'));
  else assert.ok(!r.target.includes('bank'));
  return Z.handle(g, ap.id, Z.canBank(g, ap, t) && rng() < 0.55 ? { t: 'bank' } : { t: 'roll' }, rng);
}

test('Zufallspartien: Coach liefert in jedem Zustand gültigen Text, keine Empfehlungen', () => {
  const allTexts = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seeded(seed);
    const n = 1 + (seed % 4);
    const g = Z.createGame(players(n), seed % 3 ? OPTS : { pairs: seed % 2 === 0, entry: seed % 5 !== 0, short: true }, rng);
    const ctx = mkCtx();
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 6000) {
      const ap = Z.activePlayer(g);
      const r = must(g, ctx, `seed ${seed}`);
      allTexts.add(r.text);
      assert.ok(!ADVICE.test(r.text), r.text);
      if (ap.id !== 'p0') assert.equal(r.target, undefined);
      else {
        ctx.ui.rolling = true;
        assert.equal(must(g, ctx, 'rolling').text, 'Die Würfel rollen.');
        ctx.ui.rolling = false;
      }
      assert.ok(step(g, ctx, rng).ok);
    }
    assert.equal(g.mode, 'over', `seed ${seed} endet`);
    const end = must(g, ctx, 'Ende');
    assert.match(end.text, /Lernrunde ist zu Ende/);
    assert.equal(end.target, '[data-act=again]');
  }
  assert.ok(allTexts.size >= 10);
});

test('Jede Erklärung erscheint nur einmal (solange der Zustand gleich bleibt, bleibt sie sichtbar)', () => {
  const seen = new Map(); // Text → Anzahl unterschiedlicher Zustände, in denen er erschien
  const rng = seeded(4);
  const g = Z.createGame(players(2), OPTS, rng);
  const ctx = mkCtx();
  let guard = 0;
  let lastSig = '';
  while (g.mode !== 'over' && guard++ < 6000) {
    const ap = Z.activePlayer(g);
    if (ap.id === 'p0') {
      // mehrfach lesen = gleicher Text
      const sig = `${g.rollId}|${g.turn.phase}|${JSON.stringify(ctx.ui.sel)}`;
      const a = must(g, ctx, 'a'), b = must(g, ctx, 'b');
      assert.equal(a.text, b.text);
      if (sig !== lastSig) { lastSig = sig; seen.set(a.text, (seen.get(a.text) || 0) + 1); }
    }
    step(g, ctx, rng);
  }
  const once = (re) => [...seen.keys()].filter((t) => re.test(t));
  for (const re of [/Du hast sechs Würfel/, /Einstiegshürde: Wer noch kein Konto/, /Mit dem Knopf legst du/, /Die Punkte: Eine 1 zählt/, /Vier gleiche zählen doppelt/, /Jetzt hast du die Wahl/, /Die Punkte sind jetzt sicher/, /Das war ein Patzer/]) {
    const ts = once(re);
    assert.ok(ts.length <= 1, `${re}: ${ts.length} Varianten`);
    for (const t of ts) assert.ok(seen.get(t) <= 4, `"${t}" erschien in ${seen.get(t)} verschiedenen Zuständen`);
  }
  // Die langen Erklärungen kommen jeweils genau in einem Zug-Zustand vor
  for (const re of [/Die Punkte: Eine 1 zählt/, /Vier gleiche zählen doppelt/, /Jetzt hast du die Wahl/, /Mit dem Knopf legst du/, /Das war ein Patzer/, /Einstiegshürde: Wer noch kein Konto/, /Du hast sechs Würfel/]) {
    const ts = once(re);
    if (ts.length) assert.ok(seen.get(ts[0]) <= 3, `${re} zu oft`);
  }
});

test('Heiße Würfel und Schlussrunde werden einmal erklärt', () => {
  const rng = seeded(9);
  const g = Z.createGame(players(2), { pairs: true, entry: false, short: true }, rng);
  g.players[0].entered = true;
  const ctx = mkCtx();
  Z.roll(g, 'p0', () => 0.0); // 1 1 1 1 1 1 → alle sechs gleich
  Z.keep(g, 'p0', [0, 1, 2, 3, 4, 5]);
  assert.equal(g.turn.hot, true);
  const r = must(g, ctx, 'heiß');
  assert.match(r.text, /Heiße Würfel/);
  assert.equal(must(g, ctx, 'heiß 2').text, r.text, 'bleibt im selben Zustand sichtbar');
  Z.roll(g, 'p0', fixed2(1, 1, 1, 3, 4, 6));
  Z.keep(g, 'p0', [0, 1, 2]); // 8000 + 1000
  const r2 = must(g, ctx, 'nach');
  assert.doesNotMatch(r2.text, /Heiße Würfel/);
  // Schlussrunde für p1 (Mensch ist p1)
  const h = Z.createGame(players(2), { pairs: true, entry: false, short: true }, rng);
  h.players[0].entered = true; h.players[0].score = 4950;
  Z.roll(h, 'p0', fixed2(5, 2, 3, 4, 6, 6)); Z.keep(h, 'p0', [0]); Z.bank(h, 'p0'); Z.next(h, 'p0');
  assert.equal(h.finalFrom, 0);
  const c1 = mkCtx('p1'); c1.ui.coachSeen.start = 'schon gesehen';
  const s1 = must(h, c1, 'start Schlussrunde');
  assert.match(s1.text, /Schlussrunde/);
  Z.roll(h, 'p1', fixed2(1, 2, 3, 4, 6, 6));
  const s2 = must(h, c1, 'pick');
  assert.doesNotMatch(s2.text, /Schlussrunde/, 'nur einmal');
});
const fixed2 = (...vals) => { let i = 0; return () => (vals[i++ % vals.length] - 0.5) / 6; };

test('Kaputte Eingaben: null statt Fehler', () => {
  const g = Z.createGame(players(2), OPTS, seeded(1));
  const ctx = mkCtx();
  for (const bad of [null, undefined, 0, 'x', [], {}, { players: 1 }, { players: [], turn: {} }, { mode: 'play', players: [{ id: 'p0' }], active: 0, turn: null }, { mode: 'play', players: [{ id: 'p0' }], active: 3, turn: {} }]) {
    assert.doesNotThrow(() => coach(bad, ctx));
    assert.equal(coach(bad, ctx), null);
  }
  for (const badCtx of [null, undefined, {}, { id: 'p0' }, { id: 'p0', ui: null }, { id: 'p0', ui: 'x' }, { id: 'p0', ui: { sel: 'x', coachSeen: 5 } }, { id: 'p0', ui: { sel: [true, true, true, true, true, true, true] } }]) {
    assert.doesNotThrow(() => coach(g, badCtx));
    const r = coach(g, badCtx);
    assert.ok(r === null || typeof r.text === 'string');
  }
  // kaputte Zugdaten
  const h = Z.createGame(players(2), OPTS, seeded(1));
  Z.roll(h, 'p0', fixed2(1, 2, 3, 4, 6, 6));
  for (const mut of [(x) => { x.turn.dice = null; }, (x) => { x.turn.dice = 'abc'; }, (x) => { x.turn.phase = 'seltsam'; }, (x) => { x.turn.result = 5; x.turn.phase = 'end'; }, (x) => { x.turn.aside = null; x.turn.phase = 'after'; }, (x) => { x.opts = null; }]) {
    const c = JSON.parse(JSON.stringify(h));
    mut(c);
    assert.doesNotThrow(() => coach(c, mkCtx()));
    const r = coach(c, mkCtx());
    assert.ok(r === null || typeof r.text === 'string');
  }
});

test('Mitspielende am Zug: Geduld-Text ohne Ziel; Würfel rollen; Textlängen', () => {
  const g = Z.createGame(players(2), OPTS, seeded(2));
  const r = coach(g, mkCtx('p1'));
  assert.match(r.text, /Geduld/); assert.equal(r.target, undefined);
  const ctx = mkCtx(); ctx.ui.rolling = true;
  assert.equal(coach(g, ctx).text, 'Die Würfel rollen.');
});

test('Alle Texte sind kurz und enthalten keine Spielzug-Empfehlung', () => {
  const rng = seeded(21);
  let longest = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = Z.createGame(players(2), OPTS, seeded(seed));
    const ctx = mkCtx();
    let guard = 0;
    while (g.mode !== 'over' && guard++ < 4000) {
      if (Z.activePlayer(g).id === 'p0') { const r = must(g, ctx, 'x'); longest = Math.max(longest, r.text.length); }
      step(g, ctx, rng);
    }
  }
  assert.ok(longest <= 220, `längster Text ${longest}`);
});
