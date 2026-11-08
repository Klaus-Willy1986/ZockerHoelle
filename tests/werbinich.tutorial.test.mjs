import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../werbinich/engine.js';
import { chooseAction } from '../werbinich/ai.js';
import { coach, TUTORIAL_TERMS } from '../werbinich/tutorial.js';
import { BEGRIFFE, FRAGEN } from '../werbinich/begriffe.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>#-]+$/;
const mkG = (rng) => E.createGame([{ id: 'me', name: 'Ich' }, { id: 'bot1', name: 'Computer' }], { fixed: TUTORIAL_TERMS, host: 'me' }, rng);
const mkCtx = () => ({ id: 'me', ui: { coachSeen: {}, pick: false } });

function check(r, where) {
  if (r === null) return;
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 230, `${where}: Text "${r.text}"`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
  if (r.target) assert.ok(!/data-q|data-id|nth|first|last/.test(r.target), 'Ziel darf keine bestimmte Karte sein: ' + r.target);
  assert.ok(!/frage (dich )?(am besten|zuerst) |rate (am besten )?(den|die|das) [A-Z]|zeige mir|tipp:|beste frage|gute frage/i.test(r.text), 'keine Empfehlung: ' + r.text);
}
// Der "Mensch" folgt dem Ziel; gibt zurück, was er getan hat
function follow(g, ctx, r, rng) {
  const t = r.target;
  if (t === '[data-act=next]') { assert.equal(g.phase, 'reveal'); assert.ok(E.handle(g, 'me', { t: 'next' }).ok); return 'next'; }
  if (t === '[data-act=know]') { ctx.ui.pick = true; return 'know'; }
  if (t === '[data-act=pick]') {
    assert.ok(ctx.ui.pick);
    const pool = BEGRIFFE.filter((b) => b.k === E.category(g) && !g.wrong.some((w) => w.id === b.id));
    assert.ok(E.handle(g, 'me', { t: 'guess', id: pool[Math.floor(rng() * pool.length)].id }).ok);
    ctx.ui.pick = false; return 'pick';
  }
  if (t === '[data-act=ask], [data-act=know]' || t === '[data-act=ask]' || t === '.wb-chips') {
    const free = FRAGEN.filter((f) => !g.asked.some((x) => x.q === f.id));
    if (!free.length) { ctx.ui.pick = true; return 'know'; }
    assert.ok(E.handle(g, 'me', { t: 'ask', q: free[Math.floor(rng() * free.length)].id }).ok);
    return 'ask';
  }
  assert.fail('unerwartetes Ziel ' + t);
  return null;
}

test('Führung bis zum Spielende, wenn man nur dem Ziel folgt (Computer spielt mit)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = mkG(rng); const ctx = mkCtx();
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 3000) {
      const r = coach(g, ctx);
      assert.ok(r, 'immer ein Coach-Text');
      check(r, 'folgen');
      if (g.phase === 'ask' && g.turn === 1) {
        assert.equal(r.target, undefined, 'Computer dran: kein Ziel');
        assert.ok(E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng).ok);
        continue;
      }
      assert.ok(r.target, 'Mensch dran: ein Ziel');
      follow(g, ctx, r, rng);
    }
    assert.equal(g.phase, 'over', 'Partie ' + seed);
    const end = coach(g, ctx);
    assert.equal(end.target, '[data-act=again]'); assert.match(end.text, /Lernrunde ist zu Ende/);
    assert.deepEqual(g.terms, TUTORIAL_TERMS);
  }
});

test('jede lange Erklärung kommt nur einmal (Wechsel zu einem anderen Text und zurück gibt es nicht)', () => {
  const seenTypes = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seeded(seed * 3); const g = mkG(rng); const ctx = mkCtx();
    const entered = {}; let prev = null; let steps = 0;
    while (g.phase !== 'over' && steps++ < 3000) {
      const r = coach(g, ctx);
      if (r.text !== prev) { entered[r.text] = (entered[r.text] || 0) + 1; prev = r.text; }
      if (g.phase === 'ask' && g.turn === 1) { E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng); continue; }
      follow(g, ctx, r, rng);
    }
    const intro = Object.entries(entered).filter(([x]) => x.length > 70);
    for (const [x, n] of intro) { assert.equal(n, 1, 'mehrfach gezeigt: ' + x); seenTypes.add(x); }
  }
  assert.ok(seenTypes.size >= 5, 'mehrere ausführliche Erklärungen: ' + seenTypes.size);
});

test('Erklärungen im Einzelnen', () => {
  const rng = seeded(2); const g = mkG(rng); const ctx = mkCtx();
  const r0 = coach(g, ctx);
  assert.match(r0.text, /Willkommen/); assert.equal(r0.target, '[data-act=ask]');
  assert.equal(coach(g, ctx).text, r0.text, 'bleibt im selben Zustand stehen');
  E.handle(g, 'me', { t: 'ask', q: 'leb' });
  assert.match(coach(g, ctx).text, /Computer dran/);
  E.handle(g, 'bot1', { t: 'ask', q: 'men', r: 0 });
  const v = coach(g, ctx); assert.match(v.text, /Verlauf/); assert.equal(v.target, '.wb-chips');
  E.handle(g, 'me', { t: 'ask', q: 'tie' }); E.handle(g, 'bot1', { t: 'ask', q: 'sae' });
  const k = coach(g, ctx); assert.match(k.text, /Ich weiß es/); assert.equal(k.target, '[data-act=know]');
  ctx.ui.pick = true;
  const p = coach(g, ctx); assert.match(p.text, /Begriffe der Kategorie/); assert.equal(p.target, '[data-act=pick]');
  ctx.ui.pick = false;
  E.handle(g, 'me', { t: 'guess', id: 'elefant' });
  const rv = coach(g, ctx); assert.match(rv.text, /Richtig geraten/); assert.equal(rv.target, '[data-act=next]');
  E.handle(g, 'me', { t: 'next' });
  assert.equal(g.round, 1);
  // Runde 2: Computer beginnt und rät
  assert.match(coach(g, ctx).text, /Computer/);
  E.handle(g, 'bot1', { t: 'guess', id: 'loeffel' });
  const rb = coach(g, ctx); assert.match(rb.text, /computer den Begriff erraten/i); assert.equal(rb.target, '[data-act=next]');
  // kaputte Eingaben
  assert.equal(coach(null, ctx), null); assert.equal(coach({}, ctx), null); assert.equal(coach(g, null), null);
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null); assert.equal(coach(g, {}), null); assert.equal(coach('x', ctx), null);
  assert.equal(coach({ game: 'wb' }, ctx), null); assert.equal(coach({ game: 'wb', players: 'x' }, ctx), null);
  const kaputt = JSON.parse(JSON.stringify(g)); kaputt.asked = null; kaputt.seq = 'x'; kaputt.reveal = 5;
  assert.doesNotThrow(() => coach(kaputt, mkCtx()));
});

test('Zufällig zerstörte Zustände lassen coach nie abstürzen und liefern gültige Selektoren', () => {
  const rng = seeded(77);
  for (let i = 0; i < 400; i++) {
    const g = mkG(rng);
    const steps = Math.floor(rng() * 12);
    for (let k = 0; k < steps; k++) {
      const who = g.players[g.turn] ? g.players[g.turn].id : 'me';
      if (g.phase === 'reveal') { E.handle(g, 'me', { t: 'next' }); continue; }
      if (g.phase === 'over') break;
      E.handle(g, who, rng() < 0.8 ? { t: 'ask', q: FRAGEN[Math.floor(rng() * FRAGEN.length)].id } : { t: 'guess', id: BEGRIFFE[Math.floor(rng() * BEGRIFFE.length)].id });
    }
    const x = JSON.parse(JSON.stringify(g));
    const kill = ['asked', 'wrong', 'players', 'reveal', 'phase', 'turn', 'seq', 'round', 'evt', 'cats'];
    for (const key of kill) if (rng() < 0.15) x[key] = rng() < 0.5 ? null : 'kaputt';
    const ctx = rng() < 0.2 ? { id: 'me', ui: null } : mkCtx();
    let r;
    assert.doesNotThrow(() => { r = coach(x, ctx); });
    if (r !== null) check(r, 'zufall');
  }
});

test('keine Erklärung nennt einen geheimen Begriff oder verrät eine Antwort', () => {
  const rng = seeded(5); const g = mkG(rng); const ctx = mkCtx();
  const texts = new Set();
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 3000) {
    const r = coach(g, ctx); texts.add(r.text);
    if (g.phase === 'ask' && g.turn === 1) { E.handle(g, 'bot1', chooseAction(g, 'bot1', 0, rng), rng); continue; }
    follow(g, ctx, r, rng);
  }
  for (const t of texts) for (const id of TUTORIAL_TERMS) assert.ok(!t.toLowerCase().includes(BEGRIFFE.find((b) => b.id === id).n.toLowerCase()), 'verrät: ' + t);
});
