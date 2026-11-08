import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../dunkel/engine.js';
import { RAETSEL } from '../dunkel/raetsel.js';
import { LERN } from '../dunkel/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Person ${i + 1}` }));
const grp = (n = 3, o = {}, seed = 1) => Q.createGame(P(n), { mode: 'group', host: 'p1', ...o }, seeded(seed));
const book = (o = {}, seed = 1) => Q.createGame(P(1), { mode: 'book', host: 'p1', ...o }, seeded(seed));
const learn = () => Q.createGame(P(1), { mode: 'learn', host: 'p1', fixed: LERN }, seeded(1), []);
const local = (o = {}) => Q.createGame(P(1), { mode: 'local', host: 'p1', ...o }, seeded(1));

test('createGame: Gruppe mit 5 Rätseln, Kurz mit 3, keine Wiederholung, Leiter zuerst der Gastgeber', () => {
  const g = grp(3);
  assert.equal(g.len, 5); assert.equal(g.rs.length, 5);
  assert.equal(new Set(g.rs.map((r) => r.id)).size, 5);
  assert.equal(Q.leaderId(g), 'p1');
  assert.equal(grp(3, { kurz: true }).rs.length, 3);
  assert.equal(g.phase, 'play');
  assert.deepEqual(Object.values(g.scores), [0, 0, 0]);
});

test('createGame: exclude und leicht', () => {
  const ex = RAETSEL.slice(0, 50).map((r) => r.id);
  const g = grp(2, { exclude: ex });
  assert.ok(g.rs.every((r) => !ex.includes(r.id)));
  const e = grp(2, { leicht: true });
  assert.ok(e.rs.every((r) => r.schwer <= 2));
  // zu wenig übrig -> Fallback auf alles
  const all = grp(2, { exclude: RAETSEL.map((r) => r.id) });
  assert.equal(all.rs.length, 5);
  // group mit einer Person wird Buch
  assert.equal(Q.createGame(P(1), { mode: 'group' }, seeded(1)).mode, 'book');
});

test('Gäste fragen, Spielleiter antwortet, alle Antworten ins Protokoll', () => {
  const g = grp(3);
  assert.ok(Q.handle(g, 'p2', { t: 'ask', text: '  War der Mann   krank? ' }));
  assert.equal(g.log[0].text, 'War der Mann krank?');
  assert.equal(Q.pendingQs(g).length, 1);
  const n = g.log[0].n;
  for (const v of Q.ANSWERS) {
    const h = grp(3);
    Q.handle(h, 'p3', { t: 'ask', text: 'Frage?' });
    assert.ok(Q.handle(h, 'p1', { t: 'answer', n: h.log[0].n, v }));
    assert.equal(h.log[0].a, v);
    assert.equal(Q.pendingQs(h).length, 0);
  }
  assert.ok(Q.handle(g, 'p1', { t: 'answer', n, v: 'ja' }));
  assert.ok(!Q.handle(g, 'p1', { t: 'answer', n, v: 'nein' }), 'schon beantwortet');
});

test('Ungültige Nachrichten: Gäste können nicht bewerten, Spielleiter kann nicht raten oder fragen', () => {
  const g = grp(3);
  Q.handle(g, 'p2', { t: 'ask', text: 'Hallo?' });
  const n = g.log[0].n;
  assert.ok(!Q.handle(g, 'p2', { t: 'answer', n, v: 'ja' }), 'Gast antwortet');
  assert.ok(!Q.handle(g, 'p3', { t: 'hint' }), 'Gast gibt Hinweis');
  assert.ok(!Q.handle(g, 'p2', { t: 'giveup' }), 'Gast löst auf');
  assert.ok(!Q.handle(g, 'p2', { t: 'next' }));
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', text: 'Frage vom Leiter?' }), 'Leiter fragt');
  assert.ok(!Q.handle(g, 'p1', { t: 'guess', text: 'Lösung' }), 'Leiter rät');
  assert.ok(Q.handle(g, 'p2', { t: 'guess', text: 'Er hat Schluckauf' }));
  assert.ok(!Q.handle(g, 'p3', { t: 'judge', v: 'richtig' }), 'Gast bewertet');
  assert.ok(!Q.handle(g, 'p2', { t: 'judge', v: 'richtig' }), 'Rater bewertet sich selbst');
  assert.equal(g.scores.p2, 0);
  assert.ok(!Q.handle(g, 'p1', { t: 'judge', v: 'super' }), 'ungültiges Urteil');
  assert.ok(!Q.handle(g, 'fremd', { t: 'ask', text: 'Hi?' }), 'Unbekannte Person');
  assert.ok(!Q.handle(g, 'p3', { t: 'guess', text: 'Zweiter' }), 'nur ein Versuch gleichzeitig');
});

test('Eingaben: leer, Steuerzeichen, zu lang, falsche Typen, max. offene Fragen', () => {
  const g = grp(3);
  assert.ok(!Q.handle(g, 'p2', { t: 'ask', text: '   ' }));
  assert.ok(!Q.handle(g, 'p2', { t: 'ask', text: 5 }));
  assert.ok(!Q.handle(g, 'p2', { t: 'ask' }));
  assert.ok(!Q.handle(g, 'p2', { t: 'guess', text: '' }));
  assert.ok(Q.handle(g, 'p2', { t: 'ask', text: 'a\u0000b\nc'.repeat(100) }));
  assert.ok(g.log[0].text.length <= Q.MAX_TEXT);
  assert.ok(!/[\u0000-\u001f]/.test(g.log[0].text));
  assert.ok(Q.handle(g, 'p2', { t: 'ask', text: 'zwei?' }));
  assert.ok(Q.handle(g, 'p2', { t: 'ask', text: 'drei?' }));
  assert.ok(!Q.handle(g, 'p2', { t: 'ask', text: 'vier?' }), 'mehr als 3 offene');
  assert.ok(Q.handle(g, 'p3', { t: 'ask', text: 'andere Person darf?' }));
  for (const bad of [null, undefined, 5, 'x', [], {}, { t: 5 }, { t: 'nope' }, { t: '__proto__' }]) assert.ok(!Q.handle(g, 'p1', bad));
  assert.ok(!Q.handle(null, 'p1', { t: 'hint' }));
  assert.ok(!Q.handle({ game: 'xx' }, 'p1', { t: 'hint' }));
});

test('Hinweise: nur Spielleiter, stufenweise, höchstens 3, erscheinen im Protokoll', () => {
  const g = grp(2);
  for (let i = 1; i <= 3; i++) {
    assert.ok(Q.handle(g, 'p1', { t: 'hint' }));
    assert.equal(g.hints, i);
    const last = g.log[g.log.length - 1];
    assert.equal(last.k, 'h'); assert.equal(last.text, Q.riddle(g).hinweise[i - 1]); assert.equal(last.hn, i);
  }
  assert.ok(!Q.handle(g, 'p1', { t: 'hint' }), 'maximal 3');
  assert.deepEqual(Q.hintTexts(g), Q.riddle(g).hinweise);
});

test('Bewertung: Richtig gibt 3 minus Hinweise (mindestens 1), Fast und Falsch keine Punkte', () => {
  for (const [hints, pts] of [[0, 3], [1, 2], [2, 1], [3, 1]]) {
    const g = grp(3);
    for (let i = 0; i < hints; i++) Q.handle(g, 'p1', { t: 'hint' });
    Q.handle(g, 'p3', { t: 'guess', text: 'Lösung' });
    assert.ok(Q.handle(g, 'p1', { t: 'judge', v: 'richtig' }));
    assert.equal(g.phase, 'solved');
    assert.equal(g.scores.p3, pts, `Hinweise ${hints}`);
    assert.equal(g.gain, pts); assert.equal(g.solvedBy, 'p3'); assert.equal(g.wins.p3, 1);
    assert.equal(g.scores.p1, 0); assert.equal(g.scores.p2, 0);
  }
  const g = grp(3);
  Q.handle(g, 'p2', { t: 'guess', text: 'eins' });
  assert.ok(Q.handle(g, 'p1', { t: 'judge', v: 'fast' }));
  assert.equal(g.phase, 'play'); assert.equal(g.guess, null); assert.equal(g.scores.p2, 0);
  Q.handle(g, 'p3', { t: 'guess', text: 'zwei' });
  assert.ok(Q.handle(g, 'p1', { t: 'judge', v: 'falsch' }));
  assert.equal(g.phase, 'play');
  assert.deepEqual(g.log.filter((e) => e.k === 'g').map((e) => e.a), ['fast', 'falsch']);
  assert.ok(!Q.handle(g, 'p1', { t: 'judge', v: 'richtig' }), 'kein Versuch offen');
  assert.ok(!Q.handle(g, 'p2', { t: 'ask', text: 'Frage?' }) === false, 'Fragen gehen nach Fehlversuch weiter');
});

test('Nach der Lösung sind Fragen, Raten und Hinweise gesperrt; Spielleiter wechselt reihum', () => {
  const g = grp(3, { kurz: true });
  const seen = [];
  for (let r = 0; r < 3; r++) {
    seen.push(Q.leaderId(g));
    const guesser = g.players.find((p) => p.id !== Q.leaderId(g)).id;
    Q.handle(g, guesser, { t: 'guess', text: 'x' });
    Q.handle(g, Q.leaderId(g), { t: 'judge', v: 'richtig' });
    assert.equal(g.phase, 'solved');
    assert.ok(!Q.handle(g, guesser, { t: 'ask', text: 'noch?' }));
    assert.ok(!Q.handle(g, guesser, { t: 'guess', text: 'noch?' }));
    assert.ok(!Q.handle(g, Q.leaderId(g), { t: 'hint' }));
    const other = g.players.find((p) => p.id !== Q.leaderId(g) && p.id !== g.host);
    if (other) assert.ok(!Q.handle(g, other.id, { t: 'next' }), 'Gast darf nicht weiter');
    assert.ok(Q.handle(g, Q.leaderId(g), { t: 'next' }));
  }
  assert.deepEqual(seen, ['p1', 'p2', 'p3']);
  assert.equal(g.phase, 'over');
  assert.ok(!Q.handle(g, 'p1', { t: 'next' }));
  assert.ok(!Q.handle(g, 'p2', { t: 'ask', text: 'x' }));
});

test('Auflösen (giveup): durch Spielleiter oder Gastgeber, keine Punkte, nicht durch andere Gäste', () => {
  const g = grp(3);
  assert.ok(!Q.handle(g, 'p3', { t: 'giveup' }));
  Q.handle(g, 'p2', { t: 'guess', text: 'x' });
  assert.ok(Q.handle(g, 'p1', { t: 'giveup' }));
  assert.equal(g.phase, 'solved'); assert.equal(g.solvedBy, null); assert.equal(g.guess, null);
  assert.deepEqual(Object.values(g.scores), [0, 0, 0]);
  // nächster Leiter p2: Gastgeber p1 darf trotzdem auflösen (falls der Leiter weg ist)
  assert.ok(Q.handle(g, 'p1', { t: 'next' }), 'Gastgeber darf weiter');
  assert.equal(Q.leaderId(g), 'p2');
  assert.ok(Q.handle(g, 'p1', { t: 'giveup' }));
  assert.ok(!Q.handle(g, 'p3', { t: 'next' }));
  assert.ok(Q.handle(g, 'p2', { t: 'next' }));
});

test('Protokoll: Reihenfolge, laufende Nummern, Obergrenze', () => {
  const g = grp(2);
  for (let i = 0; i < 400; i++) {
    Q.handle(g, 'p2', { t: 'ask', text: `Frage ${i}?` });
    Q.handle(g, 'p1', { t: 'answer', n: g.n, v: 'ja' });
  }
  assert.ok(g.log.length <= Q.MAX_LOG);
  assert.equal(g.n, 400);
  const ns = g.log.map((e) => e.n);
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
});

test('Rätselbuch: Hinweise, Lösung zeigen, Selbsteinschätzung und Punkte', () => {
  for (const [hints, rate, pts] of [[0, 'ja', 3], [1, 'ja', 2], [2, 'ja', 1], [3, 'ja', 1], [0, 'fast', 1], [2, 'fast', 1], [1, 'nein', 0]]) {
    const g = book();
    for (let i = 0; i < hints; i++) assert.ok(Q.handle(g, 'p1', { t: 'hint' }));
    assert.ok(!Q.handle(g, 'p1', { t: 'rate', v: rate }), 'erst Lösung zeigen');
    assert.ok(!Q.handle(g, 'p1', { t: 'next' }));
    assert.ok(Q.handle(g, 'p1', { t: 'reveal' }));
    assert.ok(!Q.handle(g, 'p1', { t: 'next' }), 'erst bewerten');
    assert.ok(!Q.handle(g, 'p1', { t: 'rate', v: 'vielleicht' }));
    assert.ok(Q.handle(g, 'p1', { t: 'rate', v: rate }));
    assert.ok(!Q.handle(g, 'p1', { t: 'rate', v: 'ja' }), 'nur einmal bewerten');
    assert.equal(g.scores.p1, pts, `${hints}/${rate}`);
    assert.equal(g.wins.p1, rate === 'ja' ? 1 : 0);
  }
  const g = book();
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', text: 'Frage?' }), 'Buch kennt keine Fragen');
  assert.ok(!Q.handle(g, 'p1', { t: 'guess', text: 'x' }));
  assert.ok(!Q.handle(g, 'p1', { t: 'giveup' }));
});

test('Rätselbuch: ganze Partie bis zum Ende, Rangliste', () => {
  const g = book();
  for (let i = 0; i < g.len; i++) {
    Q.handle(g, 'p1', { t: 'reveal' });
    Q.handle(g, 'p1', { t: 'rate', v: 'ja' });
    assert.ok(Q.handle(g, 'p1', { t: 'next' }));
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.scores.p1, 15);
  assert.deepEqual(Q.ranking(g).map((r) => [r.id, r.score, r.rank, r.solved]), [['p1', 15, 1, 5]]);
});

test('Lernrunde: feste Tabelle, jede Frage einmal, Raten mit Auswahl, Ende nach einem Rätsel', () => {
  const g = learn();
  assert.equal(g.len, 1); assert.equal(g.mode, 'learn'); assert.equal(g.rs[0].id, LERN.riddle.id);
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', text: 'freie Frage?' }), 'keine freie Frage');
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', k: 9 }));
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', k: -1 }));
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', k: 1.5 }));
  LERN.table.forEach((t, k) => {
    assert.ok(Q.handle(g, 'p1', { t: 'ask', k }));
    const e = g.log[g.log.length - 1];
    assert.equal(e.text, t.q); assert.equal(e.a, t.a);
    assert.ok(!Q.handle(g, 'p1', { t: 'ask', k }), 'nur einmal');
  });
  assert.ok(Q.handle(g, 'p1', { t: 'hint' }));
  assert.ok(!Q.handle(g, 'p1', { t: 'guess', text: 'frei' }), 'keine freie Lösung');
  assert.ok(Q.handle(g, 'p1', { t: 'guess', k: 0 }));
  assert.equal(g.phase, 'play'); assert.equal(g.scores.p1, 0);
  assert.ok(Q.handle(g, 'p1', { t: 'guess', k: 1 }));
  assert.ok(Q.handle(g, 'p1', { t: 'guess', k: 2 }));
  assert.equal(g.phase, 'solved'); assert.equal(g.scores.p1, 2);
  assert.ok(Q.handle(g, 'p1', { t: 'next' }));
  assert.equal(g.phase, 'over');
});

test('Gruppe an einem Gerät: Namen sammeln, Leiter dran, laut gestellte Fragen, Raten ohne Text', () => {
  const g = local();
  assert.equal(g.phase, 'setup');
  assert.ok(!Q.handle(g, 'p1', { t: 'startlocal' }), 'mindestens 2');
  assert.ok(!Q.handle(g, 'p1', { t: 'addlocal', name: '   ' }));
  assert.ok(Q.handle(g, 'p1', { t: 'addlocal', name: 'Anna' }));
  assert.ok(!Q.handle(g, 'p1', { t: 'addlocal', name: 'anna' }), 'Name doppelt');
  assert.ok(!Q.handle(g, 'p1', { t: 'addlocal', name: 'Person 1' }), 'wie der Gastgeber');
  assert.ok(Q.handle(g, 'p1', { t: 'addlocal', name: 'Bernd mit sehr langem Namen' }));
  assert.equal(g.players[2].name.length, Q.MAX_NAME);
  assert.ok(!Q.handle(g, 'l1', { t: 'addlocal', name: 'Fremd' }), 'nur Gastgeber');
  assert.ok(Q.handle(g, 'p1', { t: 'dellocal', id: 'l2' }));
  assert.ok(!Q.handle(g, 'p1', { t: 'dellocal', id: 'p1' }), 'Gastgeber bleibt');
  assert.ok(!Q.handle(g, 'p1', { t: 'ask', text: 'zu früh?' }));
  assert.ok(Q.handle(g, 'p1', { t: 'startlocal' }));
  assert.equal(g.phase, 'play');
  assert.ok(!Q.handle(g, 'p1', { t: 'addlocal', name: 'Spät' }), 'nach dem Start nicht mehr');
  assert.ok(Q.handle(g, 'p1', { t: 'say', v: 'nein' }));
  assert.equal(g.log[0].a, 'nein'); assert.ok(g.log[0].spoken);
  assert.ok(!Q.handle(g, 'l1', { t: 'say', v: 'ja' }), 'nur Leiter');
  assert.ok(!Q.handle(g, 'p1', { t: 'say', v: 'vielleicht' }));
  assert.ok(Q.handle(g, 'l1', { t: 'guess', text: '' }));
  assert.equal(g.guess.text, 'Lösung gesagt');
  assert.ok(Q.handle(g, 'p1', { t: 'judge', v: 'richtig' }));
  assert.equal(g.scores.l1, 3);
  assert.ok(Q.handle(g, 'p1', { t: 'next' }));
  assert.equal(Q.leaderId(g), 'l1');
  assert.ok(!Q.handle(g, 'l1', { t: 'say', v: 'ja' }) === false, 'neuer Leiter darf antworten');
  // max. 8 Personen
  const h = local();
  for (let i = 0; i < 12; i++) Q.handle(h, 'p1', { t: 'addlocal', name: `N${i}` });
  assert.equal(h.players.length, Q.MAX_PLAYERS);
});

test('say ist nur im Lokalmodus erlaubt', () => {
  const g = grp(2);
  assert.ok(!Q.handle(g, 'p1', { t: 'say', v: 'ja' }));
});

test('ranking: Gleichstand teilt den Rang, Reihenfolge nach Punkten', () => {
  const g = grp(4);
  g.scores = { p1: 3, p2: 5, p3: 5, p4: 0 }; g.wins = { p1: 1, p2: 2, p3: 2, p4: 0 };
  const r = Q.ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['p2', 'p3', 'p1', 'p4']);
  assert.deepEqual(r.map((x) => x.rank), [1, 1, 3, 4]);
  assert.equal(Q.winners(g).length, 2);
});

test('Zustand ist JSON-sicher und überlebt Kopie', () => {
  const g = grp(3);
  Q.handle(g, 'p2', { t: 'ask', text: 'Test?' });
  Q.handle(g, 'p1', { t: 'hint' });
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.ok(Q.handle(copy, 'p1', { t: 'answer', n: copy.log[0].n, v: 'ja' }));
  // Eingaben dürfen den Zustand nicht verändern, wenn sie abgelehnt werden
  const before = JSON.stringify(g);
  Q.handle(g, 'p2', { t: 'answer', n: 1, v: 'ja' });
  Q.handle(g, 'p9', { t: 'ask', text: 'x' });
  assert.equal(JSON.stringify(g), before);
});

test('Hinweistexte stammen aus dem Rätsel; Zustand enthält Lösung technisch (akzeptiert)', () => {
  const g = grp(2);
  assert.ok(typeof Q.riddle(g).loesung === 'string' && Q.riddle(g).loesung.length > 10);
});

test('400 Zufallspartien enden immer (Gruppe, Buch, Lokal) und Punkte stimmen', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rng = seeded(seed * 7919);
    const mode = ['group', 'book', 'local'][seed % 3];
    const n = mode === 'book' ? 1 : 2 + (seed % 7);
    const g = Q.createGame(P(n), { mode, host: 'p1', kurz: seed % 2 === 0 }, rng);
    if (mode === 'local') { for (let i = 2; i <= n; i++) Q.handle(g, 'p1', { t: 'addlocal', name: `L${i}` }); Q.handle(g, 'p1', { t: 'startlocal' }); }
    let steps = 0; let expected = 0;
    while (g.phase !== 'over' && steps++ < 2000) {
      const all = g.players.map((p) => p.id);
      const lid = Q.leaderId(g);
      const any = all[Math.floor(rng() * all.length)];
      const r = rng();
      const msgs = [
        { t: 'ask', text: 'Frage?' }, { t: 'answer', n: Math.ceil(rng() * g.n) || 1, v: Q.ANSWERS[Math.floor(rng() * 5)] }, { t: 'guess', text: 'x' },
        { t: 'judge', v: Q.VERDICTS[Math.floor(rng() * 3)] }, { t: 'hint' }, { t: 'giveup' }, { t: 'reveal' }, { t: 'rate', v: Q.RATES[Math.floor(rng() * 3)] },
        { t: 'next' }, { t: 'say', v: 'ja' }, { t: 'bogus' },
      ];
      const m = msgs[Math.floor(r * msgs.length)];
      const pid = rng() < 0.5 && lid ? lid : any;
      const before = g.phase === 'solved' ? g.solvedBy : undefined;
      const sc = g.players.reduce((s, p) => s + g.scores[p.id], 0);
      const ok = Q.handle(g, pid, m, rng);
      const sc2 = g.players.reduce((s, p) => s + g.scores[p.id], 0);
      assert.ok(sc2 - sc >= 0 && sc2 - sc <= 3, 'Punktsprung');
      if (!ok) assert.equal(sc2, sc);
      expected += sc2 - sc;
      void before;
      assert.ok(g.hints >= 0 && g.hints <= 3);
      assert.ok(g.ri < g.len);
    }
    assert.equal(g.phase, 'over', `Partie ${seed} (${mode}) endete nicht`);
    const total = g.players.reduce((s, p) => s + g.scores[p.id], 0);
    assert.equal(total, expected);
    assert.ok(total <= 3 * g.len);
    JSON.stringify(g);
  }
});
