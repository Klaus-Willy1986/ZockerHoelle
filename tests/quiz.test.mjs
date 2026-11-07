import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../quiz/engine.js';
import { FRAGEN, KATEGORIEN } from './quiz.fixture.mjs';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mk = (n = 2, opts = {}, seed = 1) => Q.createGame(P(n), { host: 'p0', ...opts }, seedRng(seed), FRAGEN);
// Eine feste Frage direkt in den Zustand setzen (für Wertungstests)
function fixedGame(n, q, opts = {}) {
  return Q.createGame(P(n), { host: 'p0', fixed: [q, { ...q, id: q.id + 'b' }], ...opts }, seedRng(7), []);
}
const MC = { id: 'x1', k: 'allg', t: 'mc', d: 1, q: 'Frage?', a: ['a', 'b', 'c', 'd'], c: 2 };
const TF = { id: 'x2', k: 'allg', t: 'tf', d: 1, q: 'Stimmt?', c: false };
const EST = { id: 'x3', k: 'allg', t: 'est', d: 1, q: 'Wie viel?', c: 1000, unit: 'km', min: 0, max: 2000 };
const ORD = { id: 'x4', k: 'allg', t: 'order', d: 1, q: 'Ordne!', items: ['A', 'B', 'C', 'D'] };
const ans = (g, pid, v) => Q.handle(g, pid, { t: 'answer', v });

// ---------- Zusammenstellung ----------
test('Fragenzahl je Länge und Optionen', () => {
  assert.equal(mk(2).len, 12);
  assert.equal(mk(2, { kurz: true }).len, 8);
  assert.equal(mk(2, { lang: true }).len, 20);
  assert.equal(mk(2, { len: 20 }).len, 20);
  assert.equal(mk(2, { len: 7 }).len, 12, 'ungültige Länge -> Standard');
  assert.equal(mk(2).qs.length, 12);
});

test('Typmischung: ca. 55 % mc, 20 % tf, 15 % est, 10 % order', () => {
  assert.deepEqual(Q.typeCounts(8), { mc: 4, tf: 2, est: 1, order: 1 });
  assert.deepEqual(Q.typeCounts(12), { mc: 7, tf: 2, est: 2, order: 1 });
  assert.deepEqual(Q.typeCounts(20), { mc: 11, tf: 4, est: 3, order: 2 });
  for (const len of [8, 12, 20]) {
    for (let seed = 1; seed <= 30; seed++) {
      const g = mk(3, { len }, seed);
      const c = { mc: 0, tf: 0, est: 0, order: 0 };
      for (const q of g.qs) c[q.t]++;
      assert.deepEqual(c, Q.typeCounts(len), `len ${len} seed ${seed}`);
    }
  }
});

test('Keine Frage doppelt, Schwierigkeit gemischt, alle Fragen gültig', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = mk(2, { len: [8, 12, 20][seed % 3] }, seed);
    const ids = g.qs.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, 'doppelte Frage');
    assert.ok(g.qs.every((q) => Q.isValidQuestion(q)));
    assert.ok(g.qs.some((q) => q.d === 1) && g.qs.some((q) => q.d === 2), 'nur eine Schwierigkeit');
  }
});

test('Höchstens 2 Fragen derselben Kategorie hintereinander', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = mk(2, { len: [8, 12, 20][seed % 3] }, seed);
    for (let i = 2; i < g.qs.length; i++) {
      assert.ok(!(g.qs[i].k === g.qs[i - 1].k && g.qs[i].k === g.qs[i - 2].k), `Serie bei Seed ${seed} ab ${i}`);
    }
  }
});

test('Kategorien sind gemischt (viele verschiedene)', () => {
  const g = mk(2, { len: 12 }, 5);
  assert.ok(new Set(g.qs.map((q) => q.k)).size >= 6);
  for (const q of g.qs) assert.ok(KATEGORIEN[q.k]);
});

test('exclude: benutzte Fragen kommen nicht vor; wenn zu wenig übrig, wird aufgefüllt', () => {
  const g1 = mk(2, { len: 12 }, 3);
  const used = g1.qs.map((q) => q.id);
  const g2 = mk(2, { len: 12, exclude: used }, 4);
  assert.ok(g2.qs.every((q) => !used.includes(q.id)));
  // fast alles ausgeschlossen: nur 5 frei, 12 verlangt -> 12 Fragen ohne Wiederholung
  const ex = FRAGEN.slice(5).map((q) => q.id);
  const g3 = mk(2, { len: 12, exclude: ex }, 5);
  assert.equal(g3.qs.length, 12);
  assert.equal(new Set(g3.qs.map((q) => q.id)).size, 12);
  const fresh = g3.qs.filter((q) => !ex.includes(q.id));
  assert.equal(fresh.length, 5, 'alle freien werden zuerst genommen');
});

test('Reihenfolge-Fragen: Anzeigereihenfolge ist eine Mischung, nie schon sortiert', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const g = mk(2, { len: 20 }, seed);
    for (const q of g.qs.filter((x) => x.t === 'order')) {
      assert.deepEqual([...q.shown].sort(), [0, 1, 2, 3]);
      assert.ok(q.shown.some((v, i) => v !== i), 'unsortiert erwartet');
    }
  }
});

test('Deterministisch bei gleichem Seed', () => {
  assert.deepEqual(mk(3, {}, 11), mk(3, {}, 11));
  assert.notDeepEqual(mk(3, {}, 11).qs.map((q) => q.id), mk(3, {}, 12).qs.map((q) => q.id));
});

test('Ungültige Fragen und Doppelte in der Sammlung werden übergangen; leere Sammlung wirft', () => {
  const bad = [{ id: 'z', t: 'mc' }, null, { ...MC, id: 'y', c: 9 }, { ...EST, id: 'w', min: 5, max: 5 }, { ...ORD, id: 'v', items: ['A', 'A', 'B', 'C'] }];
  const g = Q.createGame(P(1), { len: 8 }, seedRng(1), [...bad, ...FRAGEN, ...FRAGEN]);
  assert.equal(new Set(g.qs.map((q) => q.id)).size, 8);
  assert.throws(() => Q.createGame(P(1), {}, seedRng(1), bad));
  assert.throws(() => Q.createGame(P(1), {}, seedRng(1), []));
  assert.throws(() => Q.createGame([], {}, seedRng(1), FRAGEN));
  assert.throws(() => Q.createGame(P(9), {}, seedRng(1), FRAGEN));
  assert.throws(() => Q.createGame([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], {}, seedRng(1), FRAGEN));
});

test('Kleine Sammlung ohne order/est: Auffüllen mit mc, keine Abstürze', () => {
  const small = FRAGEN.filter((q) => q.t === 'mc').slice(0, 10);
  const g = Q.createGame(P(2), { len: 8 }, seedRng(2), small);
  assert.equal(g.qs.length, 8);
  const tiny = FRAGEN.slice(0, 3);
  assert.equal(Q.createGame(P(2), { len: 8 }, seedRng(2), tiny).qs.length, 3);
});

// ---------- Antworten, Warten, Auflösung ----------
test('Warten auf alle: erst wenn alle geantwortet haben, kommt die Auflösung', () => {
  const g = fixedGame(3, MC);
  assert.equal(g.phase, 'ask');
  assert.deepEqual(Q.pending(g).map((p) => p.id), ['p0', 'p1', 'p2']);
  assert.ok(ans(g, 'p0', 2).ok);
  assert.equal(g.phase, 'ask');
  assert.deepEqual(Q.pending(g).map((p) => p.id), ['p1', 'p2']);
  assert.ok(ans(g, 'p2', 1).ok);
  assert.equal(g.phase, 'ask');
  assert.equal(g.reveal, null);
  assert.ok(ans(g, 'p1', 2).ok);
  assert.equal(g.phase, 'reveal');
  assert.deepEqual(g.reveal.right.sort(), ['p0', 'p1']);
  assert.deepEqual(g.scores, { p0: 10, p1: 10, p2: 0 });
  assert.deepEqual(g.stats.p0, { right: 1, total: 1 });
  assert.deepEqual(g.stats.p2, { right: 0, total: 1 });
  assert.equal(g.reveal.res.p2.pts, 0);
});

test('mc und tf: richtig = 10 Punkte', () => {
  let g = fixedGame(2, MC);
  ans(g, 'p0', 2); ans(g, 'p1', 3);
  assert.deepEqual(g.scores, { p0: 10, p1: 0 });
  g = fixedGame(2, TF);
  ans(g, 'p0', false); ans(g, 'p1', true);
  assert.deepEqual(g.scores, { p0: 10, p1: 0 });
});

test('Kommentar: fun der Frage oder Standardspruch je nach Lage', () => {
  let g = fixedGame(2, { ...MC, fun: 'Prost, ein Klassiker!' });
  ans(g, 'p0', 2); ans(g, 'p1', 2);
  assert.equal(g.reveal.comment, 'Prost, ein Klassiker!');
  g = fixedGame(2, MC);
  ans(g, 'p0', 2); ans(g, 'p1', 2);
  assert.ok(Q.SPRUECHE.alle.includes(g.reveal.comment));
  g = fixedGame(2, MC);
  ans(g, 'p0', 0); ans(g, 'p1', 1);
  assert.ok(Q.SPRUECHE.keiner.includes(g.reveal.comment));
  g = fixedGame(2, MC);
  ans(g, 'p0', 2); ans(g, 'p1', 1);
  assert.ok(Q.SPRUECHE.gemischt.includes(g.reveal.comment));
  g = fixedGame(1, MC);
  ans(g, 'p0', 2);
  assert.ok(Q.SPRUECHE.einRichtig.includes(g.reveal.comment));
  for (const list of Object.values(Q.SPRUECHE)) assert.ok(list.length >= 3 && list.every((t) => t.length > 10 && t.length < 90));
});

// ---------- Schätzfragen ----------
test('est: nächste Antwort 15, zweite 10, dritte 5, Rest 0; exakt +5', () => {
  const g = fixedGame(4, EST);
  ans(g, 'p0', 1100); // Abweichung 100 -> Rang 2
  ans(g, 'p1', 1000); // exakt -> Rang 1: 15 + 5
  ans(g, 'p2', 1500); // 500 -> Rang 4
  ans(g, 'p3', 800); // 200 -> Rang 3
  assert.deepEqual(g.scores, { p0: 10, p1: 20, p2: 0, p3: 5 });
  assert.equal(g.reveal.res.p1.rank, 1);
  assert.equal(g.reveal.res.p2.rank, 4);
});

test('est: Gleichstand teilt den Rang (Rang danach springt)', () => {
  let g = fixedGame(4, EST);
  ans(g, 'p0', 900); ans(g, 'p1', 1100); // beide 100 daneben -> beide Rang 1
  ans(g, 'p2', 1300); // Rang 3 -> 5
  ans(g, 'p3', 1900); // Rang 4 -> 0
  assert.deepEqual(g.scores, { p0: 15, p1: 15, p2: 5, p3: 0 });
  // Gleichstand um Platz 2
  g = fixedGame(4, EST);
  ans(g, 'p0', 1000); ans(g, 'p1', 1200); ans(g, 'p2', 800); ans(g, 'p3', 1900);
  assert.deepEqual(g.scores, { p0: 20, p1: 10, p2: 10, p3: 0 });
  // alle gleich
  g = fixedGame(3, EST);
  ans(g, 'p0', 1500); ans(g, 'p1', 500); ans(g, 'p2', 1500);
  assert.deepEqual(g.scores, { p0: 15, p1: 15, p2: 15 });
});

test('est: exakt richtig bringt +5 auch bei geteiltem Rang', () => {
  const g = fixedGame(2, EST);
  ans(g, 'p0', 1000); ans(g, 'p1', 1000);
  assert.deepEqual(g.scores, { p0: 20, p1: 20 });
});

test('est: Kommazahlen ohne Rundungsfehler (Gleichstand 0,1 daneben)', () => {
  const q = { ...EST, c: 2.5, min: 0, max: 10, unit: 'kg' };
  const g = fixedGame(2, q);
  ans(g, 'p0', 2.4); ans(g, 'p1', 2.6);
  assert.deepEqual(g.scores, { p0: 15, p1: 15 });
});

test('est: allein spielen staffelt nach Nähe (keine 15 Punkte fürs Raten)', () => {
  const pts = (v) => { const g = fixedGame(1, EST); ans(g, 'p0', v); return g.scores.p0; };
  assert.equal(pts(1000), 20);
  assert.equal(pts(1090), 15); // 4,5 % der Spanne
  assert.equal(pts(1180), 10); // 9 %
  assert.equal(pts(1350), 5); // 17,5 %
  assert.equal(pts(1900), 0);
});

test('est: Statistik "richtig" = höchstens 10 % der Spanne daneben', () => {
  const g = fixedGame(3, EST);
  ans(g, 'p0', 1190); ans(g, 'p1', 1250); ans(g, 'p2', 1000);
  assert.equal(g.reveal.res.p0.ok, true);
  assert.equal(g.reveal.res.p1.ok, false);
  assert.equal(g.reveal.res.p2.ok, true);
});

test('est: Schrittweite und Startwert', () => {
  assert.equal(Q.estStep({ min: 0, max: 2000, c: 1000 }), 20);
  assert.equal(Q.estStep({ min: 1900, max: 2020, c: 1949 }), 1);
  assert.equal(Q.estStep({ min: 0, max: 20, c: 8 }), 1);
  assert.equal(Q.estStep({ min: 0, max: 1, c: 0.5 }), 0.01);
  assert.equal(Q.estStep({ min: 0, max: 100000, c: 5 }), 1000);
  assert.equal(Q.estStep({ min: 1826, max: 1920, c: 1872 }), 1);
  assert.equal(Q.estStep({ min: 0, max: 10000, c: 3600 }), 100);
  assert.equal(Q.estMid(EST), 1000);
  for (const q of FRAGEN.filter((x) => x.t === 'est')) {
    const st = Q.estStep(q);
    const steps = (q.max - q.min) / st;
    assert.ok(steps >= 5 && steps <= 200, `${q.q}: ${steps} Schritte`);
    assert.ok(Q.estMid(q) >= q.min && Q.estMid(q) <= q.max);
    const k = (q.max - q.min) / st;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${q.q}: max nicht über den Regler erreichbar`);
  }
});

// ---------- Reihenfolge ----------
test('order: 3 Punkte je richtigem Element, alles richtig +3 (max 15)', () => {
  const sc = (v) => { const g = fixedGame(1, ORD); ans(g, 'p0', v); return g.scores.p0; };
  assert.equal(sc([0, 1, 2, 3]), 15);
  assert.equal(sc([1, 0, 2, 3]), 6);
  assert.equal(sc([3, 2, 1, 0]), 0);
  assert.equal(sc([0, 2, 1, 3]), 6);
  assert.equal(sc([1, 2, 3, 0]), 0);
  assert.equal(sc([0, 1, 3, 2]), 6);
  const g = fixedGame(2, ORD);
  ans(g, 'p0', [0, 1, 2, 3]); ans(g, 'p1', [0, 2, 1, 3]);
  assert.equal(g.reveal.res.p0.ok, true);
  assert.equal(g.reveal.res.p1.ok, false);
  assert.equal(g.reveal.res.p1.hit, 2);
  assert.deepEqual(g.stats.p1, { right: 0, total: 1 });
});

test('order: ungültige Antworten werden abgelehnt', () => {
  const g = fixedGame(1, ORD);
  for (const v of [[0, 1, 2], [0, 1, 2, 2], [0, 1, 2, 4], [0, 1, 2, '3'], 'abcd', null, 3, [0, 1, 2, 3, 0], [0, 1, 2, -1], [0, 1, 2, 1.5]]) {
    assert.equal(ans(g, 'p0', v).ok, false, JSON.stringify(v));
  }
  assert.equal(g.phase, 'ask');
});

// ---------- Ungültiges ----------
test('Ungültige Nachrichten, doppelte Antwort, falsche Phase', () => {
  const g = fixedGame(2, MC);
  const bad = [undefined, null, 5, 'x', [], {}, { t: 5 }, { t: 'unbekannt' }, { t: 'answer' }, { t: 'answer', v: 4 }, { t: 'answer', v: -1 }, { t: 'answer', v: 1.5 }, { t: 'answer', v: '2' }, { t: 'answer', v: true }, { t: 'answer', v: [2] }, { t: 'answer', v: NaN }, { t: 'answer', v: 2, q: 5 }, { t: 'next' }, { t: 'joker', q: 3 }];
  for (const m of bad) {
    const r = Q.handle(g, 'p0', m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, 'string');
  }
  assert.deepEqual(g.answers, {});
  assert.equal(Q.handle(g, 'fremd', { t: 'answer', v: 1 }).ok, false, 'Unbekannte Person');
  assert.equal(Q.handle(null, 'p0', { t: 'answer', v: 1 }).ok, false);
  assert.equal(Q.handle({}, 'p0', { t: 'answer', v: 1 }).ok, false);
  assert.ok(ans(g, 'p0', 1).ok);
  assert.equal(ans(g, 'p0', 2).ok, false, 'doppelte Antwort');
  assert.equal(g.answers.p0, 1, 'erste Antwort bleibt');
  assert.equal(Q.handle(g, 'p0', { t: 'draft', v: 3 }).ok, false, 'Entwurf nach Antwort');
  assert.ok(ans(g, 'p1', 2).ok);
  // Auflösung: keine Antworten mehr, kein Joker, kein Timeout
  assert.equal(g.phase, 'reveal');
  assert.equal(ans(g, 'p1', 0).ok, false);
  assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false);
  assert.equal(Q.handle(g, 'p0', { t: 'timeout' }).ok, false);
  const snap = JSON.stringify(g);
  assert.equal(Q.handle(g, 'p1', { t: 'next' }).ok, false, 'nur der Gastgeber');
  assert.equal(JSON.stringify(g), snap);
  assert.ok(Q.handle(g, 'p0', { t: 'next', q: 0 }).ok);
  assert.equal(g.qi, 1);
  assert.equal(g.phase, 'ask');
  assert.deepEqual(g.answers, {});
  assert.equal(Q.handle(g, 'p0', { t: 'answer', v: 1, q: 0 }).ok, false, 'veraltete Frage');
  assert.equal(Q.handle(g, 'p0', { t: 'next' }).ok, false, 'next vor Auflösung');
});

// ---------- Joker ----------
test('Joker: blendet zwei falsche aus, nur einmal, nur mc, nur vor der Antwort', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = Q.createGame(P(2), { host: 'p0', fixed: [MC, MC] }, seedRng(seed), []);
    assert.ok(Q.hasJoker(g, 'p0'));
    assert.ok(Q.handle(g, 'p0', { t: 'joker' }, seedRng(seed)).ok);
    const h = g.hidden.p0;
    assert.equal(h.length, 2);
    assert.ok(!h.includes(MC.c));
    assert.equal(new Set(h).size, 2);
    assert.equal(g.jokerUsed.p0, true);
    assert.equal(Q.hasJoker(g, 'p0'), false);
    assert.equal(g.hidden.p1, undefined, 'andere Person sieht alles');
    assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false, 'zweiter Joker');
    assert.equal(ans(g, 'p0', h[0]).ok, false, 'ausgeblendete Antwort');
    assert.ok(ans(g, 'p0', MC.c).ok);
  }
  // nächste Frage: Joker weg, aber Ausblendung ist verschwunden
  const g = Q.createGame(P(1), { fixed: [MC, MC] }, seedRng(2), []);
  Q.handle(g, 'p0', { t: 'joker' }, seedRng(2));
  ans(g, 'p0', 2);
  Q.handle(g, 'p0', { t: 'next' });
  assert.deepEqual(g.hidden, {});
  assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false);
  assert.equal(ans(g, 'p0', 0).ok, true);
});

test('Joker: nach der Antwort nicht mehr, bei anderen Typen nicht, ohne Option nicht', () => {
  let g = fixedGame(2, MC);
  ans(g, 'p0', 1);
  assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false);
  for (const q of [TF, EST, ORD]) {
    g = fixedGame(2, q);
    assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false, q.t);
    assert.equal(g.jokerUsed.p0, undefined, 'Joker bleibt erhalten');
  }
  g = fixedGame(2, MC, { joker: false });
  assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false);
  assert.equal(g.joker, false);
  assert.equal(Q.hasJoker(g, 'p0'), false);
});

test('Joker ist pro Spiel einmal: nicht auf einer späteren mc-Frage erneut', () => {
  const g = Q.createGame(P(1), { fixed: [TF, MC, MC] }, seedRng(1), []);
  ans(g, 'p0', false); Q.handle(g, 'p0', { t: 'next' });
  assert.ok(Q.handle(g, 'p0', { t: 'joker' }).ok);
  ans(g, 'p0', 2); Q.handle(g, 'p0', { t: 'next' });
  assert.equal(Q.handle(g, 'p0', { t: 'joker' }).ok, false);
});

// ---------- Zeit ----------
test('Timeout: Entwurf zählt, sonst keine Antwort; nur der Gastgeber', () => {
  const g = fixedGame(3, EST, { timer: true });
  assert.equal(g.timer, true);
  assert.ok(Q.handle(g, 'p1', { t: 'draft', v: 1000 }).ok);
  assert.ok(Q.handle(g, 'p1', { t: 'draft', v: 900 }).ok, 'Entwurf darf sich ändern');
  assert.deepEqual(g.answers, {});
  assert.equal(Q.handle(g, 'p1', { t: 'timeout' }).ok, false, 'Gast darf nicht');
  assert.equal(g.phase, 'ask');
  assert.ok(Q.handle(g, 'p0', { t: 'timeout', q: 0 }).ok);
  assert.equal(g.phase, 'reveal');
  assert.equal(g.reveal.res.p1.a, 900);
  assert.equal(g.reveal.res.p0.a, null);
  assert.equal(g.reveal.res.p0.pts, 0);
  assert.equal(g.reveal.res.p1.pts, 15);
  assert.deepEqual(g.drafts, {});
  assert.deepEqual(g.stats.p0, { right: 0, total: 1 });
  assert.equal(Q.handle(g, 'p0', { t: 'timeout' }).ok, false, 'schon aufgelöst');
});

test('Entwurf: null löscht, ungültig wird abgelehnt, Antwort ersetzt Entwurf', () => {
  const g = fixedGame(2, ORD);
  assert.ok(Q.handle(g, 'p0', { t: 'draft', v: [0, 1, 2, 3] }).ok);
  assert.ok(Q.handle(g, 'p0', { t: 'draft', v: null }).ok);
  assert.deepEqual(g.drafts, {});
  assert.equal(Q.handle(g, 'p0', { t: 'draft', v: [0, 1] }).ok, false);
  Q.handle(g, 'p0', { t: 'draft', v: [3, 2, 1, 0] });
  ans(g, 'p0', [0, 1, 2, 3]);
  assert.deepEqual(g.drafts, {});
  Q.handle(g, 'p0', { t: 'timeout' });
  assert.equal(g.reveal.res.p0.pts, 15);
});

test('Timeout ohne jede Antwort: alle bekommen 0, Spiel läuft weiter', () => {
  const g = fixedGame(2, MC, { timer: true });
  Q.handle(g, 'p0', { t: 'timeout' });
  assert.deepEqual(g.scores, { p0: 0, p1: 0 });
  assert.equal(g.phase, 'reveal');
  assert.ok(Q.handle(g, 'p0', { t: 'next' }).ok);
});

test('Ohne gesetzten Gastgeber darf jede Person weiterschalten', () => {
  const g = Q.createGame(P(2), { fixed: [MC, MC] }, seedRng(1), []);
  assert.equal(g.host, 'p0');
  const g2 = Q.createGame(P(2), { host: 'p1', fixed: [MC, MC] }, seedRng(1), []);
  ans(g2, 'p0', 1); ans(g2, 'p1', 1);
  assert.equal(Q.handle(g2, 'p0', { t: 'next' }).ok, false);
  assert.ok(Q.handle(g2, 'p1', { t: 'next' }).ok);
});

// ---------- Ende, Rangliste ----------
function playAll(g, pick) {
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 1000) {
    if (g.phase === 'ask') for (const p of g.players) if (!(p.id in g.answers)) assert.ok(ans(g, p.id, pick(g, p.id)).ok);
    if (g.phase === 'reveal') assert.ok(Q.handle(g, g.host, { t: 'next' }).ok);
  }
  assert.equal(g.phase, 'over');
}
const right = (g) => { const q = g.qs[g.qi]; return q.t === 'order' ? [0, 1, 2, 3] : q.c; };
const wrong = (g) => { const q = g.qs[g.qi]; return q.t === 'mc' ? (q.c + 1) % 4 : q.t === 'tf' ? !q.c : q.t === 'est' ? (q.c > (q.min + q.max) / 2 ? q.min : q.max) : [3, 2, 1, 0]; };

test('Spielende: Rangliste, Sieger, Statistik', () => {
  const g = mk(3, {}, 9);
  playAll(g, (s, id) => (id === 'p0' ? right(s) : id === 'p1' ? wrong(s) : right(s)));
  const rk = Q.ranking(g);
  assert.equal(rk.length, 3);
  assert.equal(rk[0].rank, 1);
  assert.ok(rk[0].score >= rk[1].score && rk[1].score >= rk[2].score);
  const total = Q.maxPoints(g);
  assert.equal(g.scores.p0, total, 'immer richtig = alle Punkte (im est mit exakt +5)');
  assert.equal(g.scores.p2, total, 'Gleichstand');
  assert.deepEqual(Q.winners(g).map((w) => w.id).sort(), ['p0', 'p2']);
  assert.ok(rk.find((r) => r.id === 'p1').rank === 3);
  assert.equal(g.stats.p0.right, 12);
  assert.equal(g.stats.p0.total, 12);
  assert.ok(g.stats.p1.right < 12);
  assert.equal(g.stats.p1.total, 12);
  assert.equal(Q.isOver(g), true);
  assert.equal(g.reveal, null);
  assert.equal(ans(g, 'p0', 1).ok, false);
  assert.equal(Q.handle(g, 'p0', { t: 'next' }).ok, false);
  assert.equal(Q.handle(g, 'p0', { t: 'timeout' }).ok, false);
});

test('Rangliste: Gleichstand teilt den Rang, Reihenfolge der Anmeldung bleibt', () => {
  const g = mk(4, {}, 1);
  g.scores = { p0: 30, p1: 50, p2: 30, p3: 10 };
  const rk = Q.ranking(g);
  assert.deepEqual(rk.map((r) => [r.id, r.rank]), [['p1', 1], ['p0', 2], ['p2', 2], ['p3', 4]]);
  assert.deepEqual(Q.winners(g).map((w) => w.id), ['p1']);
  g.scores = { p0: 0, p1: 0, p2: 0, p3: 0 };
  assert.equal(Q.winners(g).length, 4);
});

test('Allein: komplettes Spiel, Punkte stimmen mit den Antworten überein', () => {
  const g = mk(1, { kurz: true }, 4);
  playAll(g, right);
  assert.equal(g.scores.p0, Q.maxPoints(g));
  assert.equal(Q.winners(g)[0].id, 'p0');
  assert.equal(g.stats.p0.right, 8);
});

// ---------- JSON-Sicherheit ----------
test('Zustand ist JSON-sicher und nach dem Kopieren identisch spielbar', () => {
  const g = mk(3, { timer: true }, 21);
  const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
  same(g, g);
  let clone = JSON.parse(JSON.stringify(g));
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 500) {
    const step = (state) => {
      if (state.phase === 'ask') {
        for (const p of state.players) {
          if (p.id in state.answers) continue;
          const v = right(state);
          if (state.qs[state.qi].t === 'mc' && p.id === 'p1') Q.handle(state, p.id, { t: 'joker' }, seedRng(state.qi));
          Q.handle(state, p.id, { t: 'answer', v: p.id === 'p2' ? wrong(state) : v }, seedRng(state.qi + 100));
        }
      } else if (state.phase === 'reveal') Q.handle(state, 'p0', { t: 'next' });
    };
    step(g); step(clone);
    assert.equal(JSON.stringify(clone), JSON.stringify(g));
    clone = JSON.parse(JSON.stringify(g));
  }
  assert.equal(g.phase, 'over');
  const text = JSON.stringify(g);
  assert.ok(!/undefined|NaN|Infinity/.test(text));
  assert.equal(JSON.stringify(JSON.parse(text)), text);
});

// ---------- Zufallspartien ----------
test('200 Zufallspartien mit 1 bis 8 Personen enden immer', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seedRng(seed * 7919);
    const n = 1 + (seed % 8);
    const opts = { host: 'p0', len: [8, 12, 20][seed % 3], joker: seed % 4 !== 0, timer: seed % 5 === 0, exclude: seed % 3 === 0 ? FRAGEN.slice(0, 20).map((q) => q.id) : [] };
    const g = Q.createGame(P(n), opts, rng, FRAGEN);
    let steps = 0; let asked = 0;
    while (g.phase !== 'over') {
      assert.ok(++steps < 20000, `Partie ${seed} endet nicht`);
      const q = g.qs[g.qi];
      if (g.phase === 'ask') {
        const p = g.players[Math.floor(rng() * n)];
        const k = rng();
        let m;
        if (k < 0.1) m = { t: 'joker' };
        else if (k < 0.2) m = { t: 'draft', v: randomAnswer(q, rng) };
        else if (k < 0.27) m = { t: 'timeout' };
        else if (k < 0.32) m = { t: 'answer', v: 'müll' };
        else if (k < 0.34) m = { t: 'nonsense' };
        else m = { t: 'answer', v: randomAnswer(q, rng) };
        const before = JSON.stringify(g);
        const r = Q.handle(g, rng() < 0.9 ? p.id : g.host, m, rng);
        if (!r.ok) assert.equal(JSON.stringify(g), before, 'abgelehnte Nachricht ändert nichts');
      } else {
        assert.equal(Q.handle(g, g.players[n - 1].id, { t: 'next' }).ok, n === 1, 'nur Gastgeber');
        if (g.phase === 'reveal') { asked++; assert.ok(Q.handle(g, 'p0', { t: 'next' }).ok); }
        else asked++;
      }
    }
    assert.equal(asked, g.len, `Partie ${seed}: Fragenzahl`);
    const sum = Object.values(g.scores).reduce((a, b) => a + b, 0);
    assert.ok(sum >= 0 && sum <= Q.maxPoints(g) * n);
    for (const p of g.players) {
      assert.equal(g.stats[p.id].total, g.len);
      assert.ok(g.stats[p.id].right <= g.len);
      assert.ok(Number.isInteger(g.scores[p.id]) && g.scores[p.id] >= 0 && g.scores[p.id] <= Q.maxPoints(g));
    }
    assert.ok(Q.winners(g).length >= 1);
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(g))), JSON.stringify(g));
  }
});
function randomAnswer(q, rng) {
  if (q.t === 'mc') return Math.floor(rng() * 4);
  if (q.t === 'tf') return rng() < 0.5;
  if (q.t === 'est') return Number((q.min + rng() * (q.max - q.min)).toFixed(2));
  const a = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

test('Texte: Antwort- und Lösungstexte', () => {
  assert.equal(Q.answerText(MC, 2), 'C: c');
  assert.equal(Q.answerText(TF, true), 'Stimmt');
  assert.equal(Q.answerText(TF, false), 'Stimmt nicht');
  assert.equal(Q.answerText(EST, 1000), '1000 km');
  assert.equal(Q.answerText({ ...EST, c: 384400 }, 384400), '384.400 km');
  assert.equal(Q.answerText({ ...EST, c: 1969, unit: 'Jahr' }, 1969), '1969 Jahr');
  assert.equal(Q.answerText(ORD, [1, 0, 2, 3]), 'B – A – C – D');
  assert.equal(Q.correctText(ORD), 'A – B – C – D');
  assert.equal(Q.answerText(MC, null), 'keine Antwort');
});

// ---------- Nerd-Runde, Nerd-Level (d:3), neue Kategorien ----------
test('Nerd-Runde: nur Nerd-Kategorien, keine Wiederholung, Typmischung wie sonst', () => {
  assert.deepEqual(Q.NERD_KATEGORIEN, ['nerd', 'weltall', 'spiele', 'erfinder', 'serien']);
  for (const len of [8, 12, 20]) {
    for (let seed = 1; seed <= 60; seed++) {
      const g = mk(2, { len, nerd: true }, seed);
      assert.equal(g.nerd, true);
      assert.equal(g.qs.length, len);
      assert.ok(g.qs.every((q) => Q.NERD_KATEGORIEN.includes(q.k)), 'fremde Kategorie');
      assert.equal(new Set(g.qs.map((q) => q.id)).size, len);
      const c = { mc: 0, tf: 0, est: 0, order: 0 };
      for (const q of g.qs) c[q.t]++;
      assert.deepEqual(c, Q.typeCounts(len));
      for (let i = 2; i < len; i++) assert.ok(!(g.qs[i].k === g.qs[i - 1].k && g.qs[i].k === g.qs[i - 2].k));
    }
  }
  assert.equal(mk(2, { len: 12 }, 3).nerd, false);
});

test('Nerd-Runde: Schwierigkeit im Mittel etwa 40/35/25 % (kleine Fixture-Sammlung)', () => {
  const tot = { 1: 0, 2: 0, 3: 0 }; let n = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const g = mk(1, { len: 20, nerd: true }, seed);
    for (const q of g.qs) { tot[q.d]++; n++; }
    assert.ok(g.qs.filter((q) => q.d === 3).length >= 3 && g.qs.some((q) => q.d === 1) && g.qs.some((q) => q.d === 2));
  }
  const f = [1, 2, 3].map((d) => tot[d] / n);
  assert.ok(Math.abs(f[0] - 0.4) < 0.08 && Math.abs(f[1] - 0.35) < 0.08 && Math.abs(f[2] - 0.25) < 0.06, 'Anteile ' + f);
  // große Sammlung mit genug von jeder Stufe und jedem Typ: Plan wird genau erreicht
  const big = [];
  for (const k of Q.NERD_KATEGORIEN) for (const t of ['mc', 'tf', 'est', 'order']) for (let d = 1; d <= 3; d++) for (let r = 0; r < 4; r++) {
    const b = t === 'mc' ? { ...MC } : t === 'tf' ? { ...TF } : t === 'est' ? { ...EST } : { ...ORD };
    big.push({ ...b, id: `${k}${t}${d}${r}`, k, d });
  }
  for (let seed = 1; seed <= 50; seed++) {
    const g = Q.createGame(P(1), { len: 20, nerd: true }, seedRng(seed), big);
    assert.deepEqual([1, 2, 3].map((d) => g.qs.filter((q) => q.d === d).length), [8, 7, 5]);
    const g12 = Q.createGame(P(1), { len: 12, nerd: true }, seedRng(seed), big);
    assert.deepEqual([1, 2, 3].map((d) => g12.qs.filter((q) => q.d === d).length), [5, 4, 3]);
  }
});

test('Nerd-Runde: Wiederholungen vermeiden mit exclude, Auffüllen wenn zu wenig frei', () => {
  const nerdIds = FRAGEN.filter((q) => Q.NERD_KATEGORIEN.includes(q.k)).map((q) => q.id);
  assert.equal(nerdIds.length, 40);
  const g1 = mk(1, { len: 12, nerd: true }, 1);
  const g2 = mk(1, { len: 12, nerd: true, exclude: g1.qs.map((q) => q.id) }, 2);
  assert.ok(g2.qs.every((q) => !g1.qs.some((x) => x.id === q.id)));
  const g3 = mk(1, { len: 20, nerd: true, exclude: nerdIds.slice(5) }, 3);
  assert.equal(g3.qs.length, 20);
  assert.equal(new Set(g3.qs.map((q) => q.id)).size, 20);
  assert.ok(g3.qs.every((q) => Q.NERD_KATEGORIEN.includes(q.k)));
});

test('Nerd-Runde: zu wenig Fragen eines Typs wird mit anderen Typen ausgeglichen', () => {
  const pool = FRAGEN.filter((q) => Q.NERD_KATEGORIEN.includes(q.k) && q.t !== 'order' && q.t !== 'est');
  const g = Q.createGame(P(1), { len: 12, nerd: true }, seedRng(2), pool);
  assert.equal(g.qs.length, 12);
  assert.ok(g.qs.every((q) => q.t === 'mc' || q.t === 'tf'));
  assert.equal(new Set(g.qs.map((q) => q.id)).size, 12);
  const small = FRAGEN.filter((q) => Q.NERD_KATEGORIEN.includes(q.k)).slice(0, 5);
  assert.equal(Q.createGame(P(1), { len: 12, nerd: true }, seedRng(2), small).qs.length, 5);
});

test('Nerd-Runde ohne Nerd-Fragen in der Sammlung: normale Mischung statt Absturz', () => {
  const old = FRAGEN.filter((q) => !Q.NERD_KATEGORIEN.includes(q.k));
  const g = Q.createGame(P(1), { len: 8, nerd: true }, seedRng(2), old);
  assert.equal(g.qs.length, 8);
  assert.equal(g.nerd, false);
});

test('Normale Runde: Nerd-Level (d:3) höchstens 1 pro 6 Fragen, neue Kategorien kommen vor', () => {
  const seen = new Set(); let d3total = 0; let withNerdCat = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const len = [8, 12, 20][seed % 3];
    const g = mk(2, { len }, seed);
    const d3 = g.qs.filter((q) => q.d === 3).length;
    assert.ok(d3 <= Math.floor(len / 6), `Seed ${seed}: ${d3} Nerd-Level-Fragen bei ${len}`);
    d3total += d3;
    if (g.qs.some((q) => Q.NERD_KATEGORIEN.includes(q.k))) withNerdCat++;
    for (const q of g.qs) seen.add(q.k);
  }
  for (const k of Q.NERD_KATEGORIEN) assert.ok(seen.has(k), 'Kategorie nie gezogen: ' + k);
  assert.ok(d3total > 100, 'd:3 kommt vor: ' + d3total);
  assert.ok(withNerdCat > 120, 'neue Kategorien in vielen Runden: ' + withNerdCat);
});

test('d:3, fehlende und unbekannte Kategorien werden robust behandelt', () => {
  assert.ok(Q.isValidQuestion({ ...MC, d: 3 }));
  assert.equal(Q.isValidQuestion({ ...MC, d: 4 }), false);
  assert.equal(Q.isValidQuestion({ ...MC, d: 0 }), false);
  const noCat = { ...MC }; delete noCat.k;
  assert.ok(Q.isValidQuestion(noCat));
  assert.equal(Q.isValidQuestion({ ...MC, k: 5 }), false);
  const odd = [];
  for (let i = 0; i < 30; i++) {
    const base = { ...FRAGEN[i % 40], id: 'o' + i, d: 1 + (i % 3) };
    if (i % 3 === 0) delete base.k; else if (i % 3 === 1) base.k = 'unbekannt' + (i % 2);
    odd.push(base);
  }
  for (let seed = 1; seed <= 40; seed++) {
    for (const nerd of [false, true]) {
      const g = Q.createGame(P(2), { len: 8, nerd }, seedRng(seed), odd);
      assert.equal(g.qs.length, 8);
      assert.equal(new Set(g.qs.map((q) => q.id)).size, 8);
    }
  }
  // alle ohne Kategorie, alle d:3: läuft trotzdem
  const flat = FRAGEN.slice(0, 40).map((q, i) => { const c = { ...q, id: 'z' + i, d: 3 }; delete c.k; return c; });
  const g = Q.createGame(P(1), { len: 12 }, seedRng(1), flat);
  assert.equal(g.qs.length, 12);
  assert.equal(Q.createGame(P(1), { len: 12, nerd: true }, seedRng(1), flat).qs.length, 12);
  // ganzes Spiel mit Mischung durchspielbar
  const g2 = Q.createGame(P(3), { len: 8, nerd: true, host: 'p0' }, seedRng(5), FRAGEN);
  playAll(g2, right);
  assert.equal(g2.scores.p0, Q.maxPoints(g2));
});
