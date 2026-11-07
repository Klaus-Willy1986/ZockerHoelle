import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../quiz/engine.js';
import { coach, TUTORIAL_BANK } from '../quiz/tutorial.js';
import { chooseAction } from '../quiz/ai.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const players = [{ id: 'me', name: 'Erna' }, { id: 'bot1', name: 'Computer' }];
const mkGame = (seed = 1) => Q.createGame(players, { host: 'me', joker: true, timer: false, fixed: TUTORIAL_BANK }, seeded(seed), []);
const mkCtx = () => ({ id: 'me', ui: { coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}" (${(r.text || '').length})`);
  assert.ok(!/[„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}
const must = (g, ctx, where) => { const r = coach(g, ctx); assert.ok(r, `${where}: kein Coach`); check(r, where); return r; };

test('Die Lernrunde hat 3 feste gültige Fragen: mc, Schätzfrage, Stimmt/Stimmt nicht', () => {
  assert.deepEqual(TUTORIAL_BANK.map((q) => q.t), ['mc', 'est', 'tf']);
  assert.ok(TUTORIAL_BANK.every((q) => Q.isValidQuestion(q)));
  const g = mkGame();
  assert.equal(g.len, 3);
  assert.deepEqual(g.qs.map((q) => q.id), ['lr1', 'lr2', 'lr3']);
});

test('Führung vom Anfang bis zum Ende, wenn man nur dem Ziel folgt', () => {
  const g = mkGame();
  const ctx = mkCtx();
  const texts = [];
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 60) {
    const r = must(g, ctx, 'folgen ' + steps);
    texts.push(r.text);
    const q = g.qs[g.qi];
    if (g.phase === 'reveal') { assert.equal(r.target, '[data-act=next]'); Q.handle(g, 'me', { t: 'next' }); continue; }
    if (!('me' in g.answers)) {
      if (q.t === 'mc') {
        if (/Joker/.test(r.text)) {
          assert.equal(r.target, '[data-act=joker], [data-act=pick]');
          assert.ok(Q.handle(g, 'me', { t: 'joker' }, seeded(3)).ok);
          continue;
        }
        assert.equal(r.target, '[data-act=pick]');
        const shown = [0, 1, 2, 3].filter((i) => !(g.hidden.me || []).includes(i));
        assert.ok(Q.handle(g, 'me', { t: 'answer', v: shown[0] }).ok);
      } else if (q.t === 'est') {
        assert.equal(r.target, '[data-act=est-ok]');
        assert.ok(Q.handle(g, 'me', { t: 'answer', v: Q.estMid(q) }).ok);
      } else {
        assert.equal(r.target, '[data-act=pick]');
        assert.ok(Q.handle(g, 'me', { t: 'answer', v: true }).ok);
      }
    } else {
      assert.equal(r.target, undefined, 'beim Warten kein Ziel');
      Q.handle(g, 'bot1', chooseAction(g, 'bot1', 0, seeded(5)));
    }
  }
  assert.equal(g.phase, 'over');
  const end = must(g, ctx, 'Ende');
  assert.equal(end.target, '[data-act=again]');
  assert.match(end.text, /Lernrunde ist zu Ende/);
  // jede Erklärung nur einmal, in 4 bis 5 inhaltlichen Schritten + Warte- und Schlusstexte
  texts.push(end.text);
  assert.equal(new Set(texts).size, texts.length, 'Text doppelt: ' + texts.join(' | '));
});

test('Inhalt: Antworten, Joker, Auflösung, Punkte', () => {
  const g = mkGame();
  const ctx = mkCtx();
  const a = must(g, ctx, 'a');
  assert.match(a.text, /50:50-Joker/);
  assert.match(a.text, /zwei falsche/);
  assert.match(a.text, /einmal/);
  Q.handle(g, 'me', { t: 'joker' }, seeded(2));
  const b = must(g, ctx, 'b');
  assert.match(b.text, /tippe auf eine der Antworten/);
  assert.match(b.text, /kein Zeitlimit/);
  Q.handle(g, 'me', { t: 'answer', v: 1 });
  assert.match(must(g, ctx, 'c').text, /antwortet noch der Computer/);
  Q.handle(g, 'bot1', { t: 'answer', v: 0 });
  const d = must(g, ctx, 'd');
  assert.match(d.text, /Auflösung/);
  assert.match(d.text, /10 Punkte/);
  Q.handle(g, 'me', { t: 'next' });
  assert.match(must(g, ctx, 'e').text, /Schieberegler/);
  assert.match(must(g, ctx, 'e').text, /Plus und Minus/);
  Q.handle(g, 'me', { t: 'answer', v: 8 }); Q.handle(g, 'bot1', { t: 'answer', v: 6 });
  const f = must(g, ctx, 'f');
  assert.match(f.text, /15, 10 und 5 Punkte/);
  assert.match(f.text, /5 Punkte extra/);
  Q.handle(g, 'me', { t: 'next' });
  assert.match(must(g, ctx, 'g').text, /Stimmt oder Stimmt nicht/);
  Q.handle(g, 'me', { t: 'answer', v: true }); Q.handle(g, 'bot1', { t: 'answer', v: true });
  assert.match(must(g, ctx, 'h').text, /Die Theke/);
  assert.match(must(g, ctx, 'h').text, /10 Punkte/);
});

test('Joker-Erklärung nur, solange der Joker unbenutzt ist und nur bei der ersten Frage', () => {
  const g = mkGame();
  const ctx = mkCtx();
  Q.handle(g, 'me', { t: 'answer', v: 1 }); Q.handle(g, 'bot1', { t: 'answer', v: 1 });
  Q.handle(g, 'me', { t: 'next' });
  for (const gg of [g]) assert.doesNotMatch(must(gg, ctx, 'x').text, /Joker/);
  const g2 = mkGame();
  const first = must(g2, ctx, 'y');
  assert.match(first.text, /Joker/);
  assert.equal(must(g2, ctx, 'y2').text, first.text, 'bleibt im gleichen Zustand stehen');
});

test('Keine Antwortempfehlung und keine Strategie-Tipps in keinem Text', () => {
  const all = [];
  const ctx = mkCtx();
  const g = mkGame();
  const grab = () => all.push(coach(g, ctx).text);
  grab();
  Q.handle(g, 'me', { t: 'joker' }, seeded(1)); grab();
  Q.handle(g, 'me', { t: 'answer', v: 0 }); grab();
  Q.handle(g, 'bot1', { t: 'answer', v: 0 }); grab();
  Q.handle(g, 'me', { t: 'next' }); grab();
  Q.handle(g, 'me', { t: 'answer', v: 3 }); Q.handle(g, 'bot1', { t: 'answer', v: 3 }); grab();
  Q.handle(g, 'me', { t: 'next' }); grab();
  Q.handle(g, 'me', { t: 'answer', v: false }); grab();
  Q.handle(g, 'bot1', { t: 'answer', v: false }); grab();
  Q.handle(g, 'me', { t: 'next' }); grab();
  const bad = /(am besten|empfehl|tipp:|klug|Strategie|nimm |wähle die|richtige Antwort ist|Wasser, Malz|Spinne|Sonne|wahrscheinlich|vermutlich|rate ich)/i;
  for (const t of all) assert.doesNotMatch(t, bad, t);
  assert.ok(all.length >= 8);
  assert.ok(all.every((t) => t.length <= 220));
});

test('Zwei Läufe mit neuer Lernrunde: Erklärungen kommen wieder (neuer Zustand)', () => {
  const ctx = mkCtx();
  const t1 = must(mkGame(1), ctx, 'l1').text;
  const t2 = must(mkGame(2), ctx, 'l2').text;
  assert.equal(t1, t2);
});

test('kaputte Eingaben werfen nie', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { game: 'qz' }, { game: 'qz', players: [] }, { game: 'qz', players: [null], qs: [] },
    { game: 'qz', players: [{ id: 'me' }], qs: [null], qi: 0, phase: 'ask' },
    { game: 'qz', players: [{ id: 'me' }], qs: [{ t: 'mc' }], qi: 5, phase: 'ask' },
    { game: 'qz', players: [{ id: 'me' }], qs: [{ t: 'est' }], qi: 0, phase: 'ask', answers: 'x' },
    { game: 'qz', players: [{ id: 'me' }], qs: [{ t: 'mc' }], qi: 0, phase: 'reveal', jokerUsed: 5 },
    { game: 'qz', players: [{ id: 'me' }], qs: [{ t: 'zz' }], qi: 0, phase: 'ask', answers: {}, joker: true }];
  for (const g of bad) {
    for (const c of [undefined, null, {}, { id: 'me' }, { id: 'me', ui: null }, { id: 'me', ui: { coachSeen: 3 } }, { id: 'zz' }]) {
      let r;
      assert.doesNotThrow(() => { r = coach(g, c); });
      check(r, JSON.stringify(g));
    }
  }
});
