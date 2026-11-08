import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../zeichnen/engine.js';
import { BEGRIFFE } from '../zeichnen/begriffe.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const T0 = 1_000_000;
const mk = (n = 3, opts = {}, seed = 1) => Q.createGame(P(n), { host: 'p0', now: T0, ...opts }, seedRng(seed));
const word = (g, w, alt = []) => { g.word = { w, alt, k: 'Test' }; return g; };
const H = (g, pid, msg, now = T0) => Q.handle(g, pid, msg, seedRng(9), now);
const dr = (g) => Q.drawerId(g);
const other = (g, i = 0) => Q.guessers(g)[i].id;

// ---------- Raten-Prüfung ----------
test('Normalisierung: Groß/Klein, Leerzeichen, Umlaute, ß, Akzente', () => {
  assert.equal(Q.normalize('  Fahr Rad '), 'fahrrad');
  assert.equal(Q.normalize('Äpfel'), 'aepfel');
  assert.equal(Q.normalize('Löffel'), 'loeffel');
  assert.equal(Q.normalize('Gürtel'), 'guertel');
  assert.equal(Q.normalize('Fuß'), 'fuss');
  assert.equal(Q.normalize('Café'), 'cafe');
  assert.equal(Q.normalize(null), '');
});
test('matches: genau, ohne Umlaut, mit Artikel, Synonyme', () => {
  const w = { w: 'Fahrrad', alt: ['Rad', 'Velo'] };
  for (const t of ['Fahrrad', 'fahrrad', 'FAHRRAD', 'fahr rad', 'Rad', 'velo', 'ein Fahrrad', 'das Rad', 'Der  Velo']) assert.ok(Q.matches(t, w), t);
  for (const t of ['Auto', 'Fahr', 'Fahrradweg', '', '   ', 'Fahrrädchen', 'ein', 'das']) assert.ok(!Q.matches(t, w), t);
  assert.ok(Q.matches('Loeffel', { w: 'Löffel', alt: [] }));
  assert.ok(Q.matches('Löffel', { w: 'Loeffel', alt: [] }));
  assert.ok(Q.matches('Strasse', { w: 'Straße', alt: [] }));
  assert.ok(Q.matches('Gruen', { w: 'Grün', alt: [] }));
  assert.ok(!Q.matches(5, { w: 'Haus', alt: [] }));
  assert.ok(!Q.matches('x', null));
});
test('Tippfehler: Abstand 1 nur ab 6 Buchstaben', () => {
  const lang = { w: 'Fahrrad', alt: [] };
  assert.ok(Q.matches('Fahrrat', lang)); // ersetzt
  assert.ok(Q.matches('Fahrad', lang)); // fehlt
  assert.ok(Q.matches('Fahrradd', lang)); // zu viel
  assert.ok(!Q.matches('Fahrrt', lang)); // Abstand 2
  assert.ok(!Q.matches('Fahrrrrd', lang));
  const kurz = { w: 'Hund', alt: [] };
  assert.ok(!Q.matches('Hand', kurz));
  assert.ok(!Q.matches('Hun', kurz));
  const fuenf = { w: 'Tiger', alt: [] };
  assert.ok(!Q.matches('Tigar', fuenf));
  assert.ok(Q.matches('Banaen'.replace('en', 'ne'), { w: 'Banane', alt: [] }));
  assert.ok(Q.matches('Bannane', { w: 'Banane', alt: [] }));
  // Synonym unter 6 Buchstaben: nur genau
  assert.ok(!Q.matches('Rat', lang));
  assert.equal(Q.levenshtein('kitten', 'sitting'), 3);
  assert.equal(Q.levenshtein('', 'abc'), 3);
});
test('Zwei Wörter: Leerzeichen egal', () => {
  const w = { w: 'Rotes Kreuz', alt: [] };
  assert.ok(Q.matches('roteskreuz', w));
  assert.ok(Q.matches('Rotes  Kreuz', w));
});

// ---------- Hinweis-Buchstaben ----------
test('Maske und Hinweis-Buchstaben', () => {
  const g = word(mk(), 'Fahrrad');
  assert.equal(Q.letterCount('Fahrrad'), 7);
  assert.equal(Q.maskText(g), '_ _ _ _ _ _ _');
  g.hint = 1; assert.equal(Q.maskText(g), 'F _ _ _ _ _ _');
  g.hint = 2; assert.equal(Q.maskText(g), 'F A _ _ _ _ _');
  g.hint = 5; assert.equal(Q.maskText(g), 'F A _ _ _ _ _', 'höchstens 2 Buchstaben');
  word(g, 'Rotes Kreuz'); g.hint = 2;
  assert.equal(Q.maskText(g), 'R O _ _ _   _ _ _ _ _');
  word(g, 'Äpfel'); g.hint = 1; assert.equal(Q.maskText(g), 'Ä _ _ _ _');
  word(g, 'Ei'); g.hint = 2; assert.equal(Q.maskText(g), 'E _', 'nie das ganze Wort');
});
test('Alle Begriffe: Maske verrät nie mehr als 2 Buchstaben', () => {
  const g = mk();
  for (const b of BEGRIFFE) {
    word(g, b.w); g.hint = 2;
    const shown = Q.maskText(g).replace(/[ _]/g, '').length;
    assert.ok(shown <= 2 && shown < Q.letterCount(b.w), b.w);
  }
});

// ---------- Spielstart und Zustand ----------
test('Start: online, 2-8 Personen, Rundenzahl, JSON-sicher', () => {
  const g = mk(3);
  assert.equal(g.mode, 'online'); assert.equal(g.phase, 'draw'); assert.equal(g.len, 3);
  assert.equal(g.limit, 90000); assert.equal(g.t0, T0);
  assert.ok(g.word && g.word.w);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.equal(mk(3, { twice: true }).len, 6);
  assert.equal(mk(8).len, 8);
  assert.equal(mk(3, { long: true }).limit, 150000);
  assert.equal(mk(3, { nolimit: true }).limit, 0);
  assert.equal(mk(3, { nolimit: true, long: true }).limit, 0, 'ohne Zeitdruck hat Vorrang');
  assert.equal(Q.createGame(P(12), { host: 'p0' }, seedRng(1)).players.length, 8);
  assert.equal(mk(1).mode, 'local', 'eine Person: Namen sammeln');
});
test('Zeichner wechselt reihum, jede Person einmal (zweimal mit Option)', () => {
  for (const twice of [false, true]) {
    const g = mk(4, { twice });
    const seen = [];
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 50) {
      seen.push(dr(g));
      assert.ok(H(g, 'p0', { t: 'skip' }));
      assert.ok(H(g, 'p0', { t: 'next' }));
    }
    assert.equal(g.phase, 'over');
    assert.equal(seen.length, twice ? 8 : 4);
    for (const p of P(4)) assert.equal(seen.filter((x) => x === p.id).length, twice ? 2 : 1);
    assert.deepEqual(seen.slice(0, 4), ['p0', 'p1', 'p2', 'p3']);
  }
});
test('Begriffe wiederholen sich innerhalb eines Spiels nicht; exclude wird beachtet', () => {
  const g = mk(8, { twice: true }, 5);
  const ws = [g.word.w];
  for (let i = 1; i < 16; i++) { H(g, 'p0', { t: 'skip' }); H(g, 'p0', { t: 'next' }); ws.push(g.word.w); }
  assert.equal(new Set(ws).size, 16);
  const ex = BEGRIFFE.slice(0, BEGRIFFE.length - 10).map((b) => b.w);
  const g2 = mk(3, { exclude: ex }, 2);
  assert.ok(!ex.includes(g2.word.w));
  const g3 = mk(3, { exclude: BEGRIFFE.map((b) => b.w) }, 2); // alles benutzt: von vorn
  assert.ok(g3.word.w);
});

// ---------- Raten und Punkte ----------
test('Richtig raten: 10 Punkte + Restzeit/9, Zeichner 5', () => {
  const g = word(mk(3), 'Fahrrad', ['Rad']);
  const a = other(g, 0); const b = other(g, 1);
  assert.ok(H(g, a, { t: 'guess', text: 'rad' }, T0)); // volle Zeit: 90 s -> +10
  assert.equal(g.scores[a], 20); assert.equal(g.scores[dr(g)], 5);
  assert.equal(g.phase, 'draw');
  assert.ok(H(g, b, { t: 'guess', text: 'Fahrrad' }, T0 + 45000)); // 45 s Rest -> +5
  assert.equal(g.scores[b], 15); assert.equal(g.scores[dr(g)], 10);
  assert.equal(g.phase, 'result'); assert.equal(g.reason, 'all');
  assert.deepEqual(g.order, [a, b]);
  assert.equal(g.gains[a], 20); assert.equal(g.dgain, 10);
});
test('Restzeit/9 gerundet', () => {
  assert.equal(Q.timeBonus(90000), 10);
  assert.equal(Q.timeBonus(0), 0);
  assert.equal(Q.timeBonus(4400), 0);
  assert.equal(Q.timeBonus(4600), 1);
  assert.equal(Q.timeBonus(13500), 2);
  assert.equal(Q.timeBonus(150000), 17);
  const g = word(mk(2), 'Haus');
  H(g, other(g), { t: 'guess', text: 'Haus' }, T0 + 80000); // 10 s Rest -> +1
  assert.equal(g.scores[other(g)], 11);
  const l = word(mk(2, { long: true }), 'Haus');
  H(l, other(l), { t: 'guess', text: 'Haus' }, T0); assert.equal(l.scores[other(l)], 27);
  const n = word(mk(2, { nolimit: true }), 'Haus');
  H(n, other(n), { t: 'guess', text: 'Haus' }, T0 + 99999999); assert.equal(n.scores[other(n)], 10, 'ohne Limit kein Zeitbonus');
  const z = word(mk(2), 'Haus');
  H(z, other(z), { t: 'guess', text: 'Haus' }, T0 + 500000); assert.equal(z.scores[other(z)], 10, 'nach Ablauf nur 10');
});
test('Zeichner bekommt höchstens 20 Punkte pro Runde', () => {
  const g = word(mk(8), 'Haus');
  for (let i = 0; i < 7; i++) H(g, other(g, i), { t: 'guess', text: 'Haus' });
  assert.equal(g.dgain, 20); assert.equal(g.scores[dr(g)], 20);
  assert.equal(g.phase, 'result');
});
test('Falsche Eingabe landet als Chat-Zeile, richtige ohne Wortlaut', () => {
  const g = word(mk(3), 'Fahrrad');
  const a = other(g, 0);
  H(g, a, { t: 'guess', text: '  Auto  ' });
  assert.deepEqual(g.chat.map((e) => [e.k, e.by, e.text]), [['g', a, 'Auto']]);
  H(g, a, { t: 'guess', text: 'Fahrrad' });
  const ok = g.chat[g.chat.length - 1];
  assert.equal(ok.k, 'ok'); assert.equal(ok.text, undefined);
  assert.ok(!JSON.stringify(g.chat).toLowerCase().includes('fahrrad'));
  assert.equal(g.chat.length, 2);
});
test('Chat-Länge und Text werden begrenzt', () => {
  const g = word(mk(3, { nolimit: true }), 'Fahrrad');
  const a = other(g);
  for (let i = 0; i < 100; i++) H(g, a, { t: 'guess', text: 'x'.repeat(100) + i });
  assert.equal(g.chat.length, Q.MAX_CHAT);
  assert.ok(g.chat.every((e) => e.text.length <= Q.MAX_GUESS));
  assert.equal(g.nc, 100);
});

// ---------- ungültige Nachrichten ----------
test('Zeichner darf nicht raten, Ratende dürfen nicht zeichnen', () => {
  const g = word(mk(3), 'Haus');
  assert.equal(H(g, dr(g), { t: 'guess', text: 'Haus' }), false);
  assert.equal(g.order.length, 0);
  const a = other(g);
  for (const m of [{ t: 'stroke', pts: [[1, 1]], c: 0, w: 0 }, { t: 'clear' }, { t: 'undo' }]) assert.equal(H(g, a, m), false, m.t);
  assert.equal(g.strokes.length, 0);
});
test('Doppelte richtige Antwort zählt nicht', () => {
  const g = word(mk(3), 'Haus');
  const a = other(g);
  assert.ok(H(g, a, { t: 'guess', text: 'Haus' }));
  const s = g.scores[a];
  assert.equal(H(g, a, { t: 'guess', text: 'Haus' }), false);
  assert.equal(g.scores[a], s); assert.equal(g.order.length, 1);
});
test('Unbekannte Person, Müll, falsche Phase', () => {
  const g = word(mk(3), 'Haus');
  assert.equal(H(g, 'fremd', { t: 'guess', text: 'Haus' }), false);
  for (const m of [null, undefined, 5, 'x', {}, { t: 5 }, { t: 'quatsch' }, { t: 'guess' }, { t: 'guess', text: 5 }, { t: 'guess', text: '   ' }]) assert.equal(H(g, other(g), m), false, JSON.stringify(m));
  assert.equal(Q.handle(null, 'p0', { t: 'next' }), false);
  assert.equal(Q.handle({ game: 'x' }, 'p0', { t: 'next' }), false);
  // next/timeup/skip/hint nur für den Gastgeber
  for (const t of ['skip', 'timeup', 'hint', 'next']) assert.equal(H(g, other(g), { t }, T0 + 200000), false, t);
  assert.equal(H(g, 'p0', { t: 'next' }), false, 'next nur in Phase result');
  assert.equal(H(g, 'p0', { t: 'got', id: 'p1' }), false, 'got nur selber Raum');
  assert.equal(H(g, 'p0', { t: 'go' }), false);
  assert.equal(H(g, 'p0', { t: 'addlocal', name: 'X' }), false);
  H(g, 'p0', { t: 'skip' });
  assert.equal(g.phase, 'result');
  assert.equal(H(g, other(g), { t: 'guess', text: 'Haus' }), false, 'nach der Runde kein Raten');
  assert.equal(H(g, dr(g), { t: 'stroke', pts: [[1, 1]], c: 0, w: 0 }), false, 'nach der Runde kein Zeichnen');
  assert.equal(H(g, 'p1', { t: 'next' }), false, 'Gast darf nicht weiter');
});
test('Zeit: timeup nur nach Ablauf, hint nach 50 % und 75 %', () => {
  const g = word(mk(3), 'Fahrrad');
  assert.equal(H(g, 'p0', { t: 'timeup' }, T0 + 10000), false);
  assert.equal(H(g, 'p0', { t: 'hint' }, T0 + 10000), false);
  assert.ok(H(g, 'p0', { t: 'hint' }, T0 + 45000)); assert.equal(g.hint, 1);
  assert.equal(H(g, 'p0', { t: 'hint' }, T0 + 46000), false);
  assert.equal(H(g, 'p0', { t: 'hint' }, T0 + 60000), false);
  assert.ok(H(g, 'p0', { t: 'hint' }, T0 + 67500)); assert.equal(g.hint, 2);
  assert.equal(H(g, 'p0', { t: 'hint' }, T0 + 80000), false);
  assert.equal(H(g, 'p0', { t: 'timeup' }, T0 + 80000), false);
  assert.ok(H(g, 'p0', { t: 'timeup' }, T0 + 90000));
  assert.equal(g.phase, 'result'); assert.equal(g.reason, 'time');
  assert.equal(H(g, 'p0', { t: 'timeup' }, T0 + 99000), false, 'nur einmal');
  const n = word(mk(3, { nolimit: true }), 'Haus');
  assert.equal(H(n, 'p0', { t: 'timeup' }, T0 + 1e9), false, 'ohne Limit kein Ablauf');
  assert.equal(H(n, 'p0', { t: 'hint' }, T0 + 1e9), false, 'ohne Limit keine Hinweise');
  assert.ok(H(n, 'p0', { t: 'skip' }));
});
test('Rundenende: Zeit ohne Treffer gibt keine Punkte', () => {
  const g = word(mk(3), 'Haus');
  H(g, 'p0', { t: 'timeup' }, T0 + 90000);
  assert.deepEqual(Q.ranking(g).map((r) => r.score), [0, 0, 0]);
  assert.equal(g.dgain, 0);
});
test('Weiter setzt die Runde zurück, Punkte bleiben, Ende nach der letzten Runde', () => {
  const g = word(mk(2), 'Haus');
  H(g, other(g), { t: 'guess', text: 'Haus' });
  assert.equal(g.phase, 'result');
  const before = { ...g.scores };
  assert.ok(H(g, 'p0', { t: 'next' }, T0 + 5000));
  assert.equal(g.ri, 1); assert.equal(g.phase, 'draw'); assert.equal(g.t0, T0 + 5000);
  assert.deepEqual(g.scores, before);
  assert.deepEqual([g.strokes, g.chat, g.order, g.hint, g.dgain], [[], [], [], 0, 0]);
  H(g, 'p0', { t: 'skip' }); assert.ok(H(g, 'p0', { t: 'next' }));
  assert.equal(g.phase, 'over');
  assert.equal(H(g, 'p0', { t: 'next' }), false);
  assert.equal(H(g, 'p1', { t: 'guess', text: 'x' }), false);
});
test('Rangliste und Gewinner', () => {
  const g = mk(3);
  g.scores = { p0: 10, p1: 30, p2: 30 }; g.wins = { p0: 1, p1: 2, p2: 3 };
  const rk = Q.ranking(g);
  assert.deepEqual(rk.map((r) => [r.id, r.rank]), [['p2', 1], ['p1', 2], ['p0', 3]]);
  g.wins.p1 = 3;
  assert.deepEqual(Q.winners(g).map((r) => r.id), ['p1', 'p2']);
});

// ---------- Striche ----------
test('Stroke: Fortsetzung mit gleicher Nummer, neuer Strich, Rundung, Klemmen', () => {
  const g = word(mk(3), 'Haus');
  const d = dr(g);
  assert.ok(H(g, d, { t: 'stroke', pts: [[10.123456, 20.987], [2000, -5]], c: 2, w: 1, k: 7 }));
  assert.deepEqual(g.strokes[0], { k: 7, c: 2, w: 1, p: [[10.12, 20.99], [1000, 0]] });
  assert.ok(H(g, d, { t: 'stroke', pts: [[30, 30]], c: 2, w: 1, k: 7 }));
  assert.equal(g.strokes.length, 1); assert.equal(g.strokes[0].p.length, 3);
  assert.ok(H(g, d, { t: 'stroke', pts: [[40, 40]], c: 0, w: 0, k: 8 }));
  assert.equal(g.strokes.length, 2); assert.equal(g.sk, 8);
  assert.equal(H(g, d, { t: 'stroke', pts: [[1, 1]], c: 5, w: 0, k: 8 }), false, 'Farbe darf sich im Strich nicht ändern');
  assert.ok(H(g, d, { t: 'stroke', pts: [[1, 1]], c: 6, w: 2 })); // ohne k: neuer Strich
  assert.equal(g.strokes.length, 3); assert.equal(g.strokes[2].c, 6);
  assert.ok(H(g, d, { t: 'undo' })); assert.equal(g.strokes.length, 2);
  assert.ok(H(g, d, { t: 'clear' })); assert.equal(g.strokes.length, 0);
  assert.equal(H(g, d, { t: 'undo' }), false); assert.equal(H(g, d, { t: 'clear' }), false);
  assert.equal(g.sk, 9, 'Strichzähler wird nie kleiner');
});
test('Stroke: ungültige Daten werden abgelehnt', () => {
  const g = word(mk(3), 'Haus');
  const d = dr(g);
  const bad = [
    { pts: [], c: 0, w: 0 }, { pts: 'x', c: 0, w: 0 }, { pts: [[1]], c: 0, w: 0 }, { pts: [[1, 'a']], c: 0, w: 0 }, { pts: [[NaN, 1]], c: 0, w: 0 },
    { pts: [[1, 1]], c: 7, w: 0 }, { pts: [[1, 1]], c: -1, w: 0 }, { pts: [[1, 1]], c: 0.5, w: 0 }, { pts: [[1, 1]], c: 0, w: 3 }, { pts: [[1, 1]], c: 0 },
    { pts: Array.from({ length: 41 }, (_, i) => [i, i]), c: 0, w: 0 }, { c: 0, w: 0 },
  ];
  for (const b of bad) assert.equal(H(g, d, { t: 'stroke', ...b }), false, JSON.stringify(b).slice(0, 60));
  assert.equal(g.strokes.length, 0);
  assert.ok(H(g, d, { t: 'stroke', pts: Array.from({ length: 40 }, (_, i) => [i, i]), c: 0, w: 0, k: 1 }), '40 Punkte sind erlaubt');
});
test('Stroke: Obergrenzen für Punkte und Striche', () => {
  const g = word(mk(3), 'Haus');
  const d = dr(g);
  for (let i = 0; i < Q.MAX_POINTS / 40; i++) assert.ok(H(g, d, { t: 'stroke', pts: Array.from({ length: 40 }, (_, j) => [j, j]), c: 0, w: 0, k: 1 }));
  assert.equal(H(g, d, { t: 'stroke', pts: [[1, 1]], c: 0, w: 0, k: 1 }), false);
  assert.equal(H(g, d, { t: 'stroke', pts: [[1, 1]], c: 0, w: 0, k: 2 }), false);
  H(g, d, { t: 'clear' });
  for (let i = 0; i < Q.MAX_STROKES; i++) assert.ok(H(g, d, { t: 'stroke', pts: [[i, 1]], c: 0, w: 0, k: 100 + i }));
  assert.equal(H(g, d, { t: 'stroke', pts: [[1, 1]], c: 0, w: 0, k: 9999 }), false);
});
test('Zeichnung gehört zur Runde: nach Weiter leer', () => {
  const g = word(mk(3), 'Haus');
  H(g, dr(g), { t: 'stroke', pts: [[5, 5]], c: 1, w: 1, k: 1 });
  H(g, 'p0', { t: 'skip' }); H(g, 'p0', { t: 'next' });
  assert.equal(g.strokes.length, 0);
  assert.equal(H(g, 'p0', { t: 'stroke', pts: [[5, 5]], c: 1, w: 1 }), dr(g) === 'p0');
});

// ---------- selber Raum ----------
const local = (names = ['B', 'C'], opts = {}) => {
  const g = Q.createGame([{ id: 'h', name: 'A' }], { mode: 'local', host: 'h', now: T0, ...opts }, seedRng(3));
  for (const n of names) assert.ok(H(g, 'h', { t: 'addlocal', name: n }));
  return g;
};
test('selber Raum: Namen sammeln (Duplikate, Grenzen, Entfernen), Start', () => {
  const g = local([]);
  assert.equal(g.phase, 'setup'); assert.equal(g.word, null);
  assert.equal(H(g, 'h', { t: 'startlocal' }), false, 'mindestens 2');
  assert.ok(H(g, 'h', { t: 'addlocal', name: '  Ida  ' }));
  assert.equal(H(g, 'h', { t: 'addlocal', name: 'ida' }), false);
  assert.equal(H(g, 'h', { t: 'addlocal', name: 'a' }), false, 'wie der Gastgeber');
  assert.equal(H(g, 'h', { t: 'addlocal', name: '' }), false);
  assert.equal(H(g, 'h', { t: 'addlocal', name: 5 }), false);
  assert.ok(H(g, 'h', { t: 'addlocal', name: 'x'.repeat(40) })); assert.equal(g.players[2].name.length, Q.MAX_NAME);
  assert.ok(H(g, 'h', { t: 'dellocal', id: 'l2' })); assert.equal(g.players.length, 2);
  assert.equal(H(g, 'h', { t: 'dellocal', id: 'h' }), false);
  for (let i = 0; i < 10; i++) H(g, 'h', { t: 'addlocal', name: 'N' + i });
  assert.equal(g.players.length, 8);
  assert.ok(H(g, 'h', { t: 'startlocal' }));
  assert.equal(g.phase, 'ready'); assert.equal(g.len, 8); assert.equal(g.t0, null);
  assert.equal(H(g, 'l1', { t: 'addlocal', name: 'Z' }), false);
});
test('selber Raum: bereit -> zeichnen -> "Jemand hat es erraten" -> Weiter durch die aktive Person', () => {
  const g = word(local(['B', 'C']), 'Haus');
  H(g, 'h', { t: 'startlocal' }); word(g, 'Haus');
  assert.equal(g.phase, 'ready');
  assert.equal(H(g, 'l1', { t: 'go' }), false, 'nur der Zeichner (oder Gastgeber)');
  assert.equal(H(g, 'h', { t: 'stroke', pts: [[1, 1]], c: 0, w: 0 }), true === false);
  assert.ok(H(g, 'h', { t: 'go' }, T0 + 7000));
  assert.equal(g.phase, 'draw'); assert.equal(g.t0, T0 + 7000);
  assert.equal(H(g, 'h', { t: 'guess', text: 'Haus' }), false, 'selber Raum: kein Tippen');
  assert.equal(H(g, 'l1', { t: 'got', id: 'l2' }), false, 'nur der Zeichner');
  assert.equal(H(g, 'h', { t: 'got', id: 'h' }), false, 'Zeichner kann nicht selbst raten');
  assert.equal(H(g, 'h', { t: 'got', id: 'fremd' }), false);
  assert.ok(H(g, 'h', { t: 'got', id: 'l1' }, T0 + 7000 + 45000));
  assert.equal(g.scores.l1, 15); assert.equal(g.scores.h, 5);
  assert.equal(H(g, 'h', { t: 'got', id: 'l1' }), false, 'doppelt');
  assert.ok(H(g, 'h', { t: 'got', id: 'l2' }, T0 + 97000));
  assert.equal(g.phase, 'result');
  // l1 ist als Nächster dran und darf weiter (aktive Person = Zeichner der Runde: h) – l1 noch nicht
  assert.equal(H(g, 'l1', { t: 'next' }), false);
  assert.ok(H(g, 'h', { t: 'next' }));
  assert.equal(g.phase, 'ready'); assert.equal(Q.drawerId(g), 'l1');
  assert.ok(H(g, 'l1', { t: 'go' }));
  H(g, 'l1', { t: 'skip' });
  assert.equal(g.phase, 'result');
  assert.ok(H(g, 'l1', { t: 'next' }), 'aktive Person darf weiter');
  assert.equal(Q.drawerId(g), 'l2');
});
test('selber Raum: Zeichner (nicht Gastgeber) zeichnet über seine Kennung', () => {
  const g = local(['B', 'C']); H(g, 'h', { t: 'startlocal' }); word(g, 'Haus');
  H(g, 'h', { t: 'go' }); H(g, 'h', { t: 'skip' }); H(g, 'h', { t: 'next' }); H(g, 'l1', { t: 'go' });
  assert.equal(Q.drawerId(g), 'l1');
  assert.ok(H(g, 'l1', { t: 'stroke', pts: [[5, 5]], c: 1, w: 1, k: 1 }));
  assert.equal(H(g, 'h', { t: 'stroke', pts: [[5, 5]], c: 1, w: 1, k: 2 }), false);
});

// ---------- Lernrunde ----------
test('Lernrunde: Mensch zeichnet Haus, Computer rät Zelt, dann Haus', () => {
  const g = Q.createGame([{ id: 'me', name: 'Erna' }, { id: 'bot1', name: 'Computer' }], { mode: 'learn', host: 'me', now: T0 }, seedRng(1));
  assert.equal(g.mode, 'learn'); assert.equal(g.word.w, 'Haus'); assert.equal(g.len, 1); assert.equal(Q.drawerId(g), 'me');
  assert.equal(g.limit, 150000);
  assert.ok(H(g, 'me', { t: 'stroke', pts: [[10, 10], [50, 50]], c: 0, w: 1, k: 1 }));
  assert.equal(H(g, 'me', { t: 'guess', text: 'Haus' }), false);
  assert.ok(H(g, 'bot1', { t: 'guess', text: 'Zelt' }));
  assert.equal(g.chat[0].text, 'Zelt'); assert.equal(g.phase, 'draw');
  assert.ok(H(g, 'bot1', { t: 'guess', text: 'Haus' }, T0 + 20000));
  assert.equal(g.phase, 'result');
  assert.equal(g.scores.bot1, 10 + Q.timeBonus(130000)); assert.equal(g.scores.me, 5);
  assert.ok(H(g, 'me', { t: 'next' }));
  assert.equal(g.phase, 'over');
});

// ---------- Zufallspartien ----------
test('200 Zufallspartien enden immer, Punkte stimmen, Zustand bleibt JSON-sicher', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seedRng(seed);
    const n = 2 + Math.floor(rng() * 7);
    const opts = { host: 'p0', now: T0, twice: rng() < 0.3, long: rng() < 0.3, nolimit: rng() < 0.2 };
    const g = Q.createGame(P(n), opts, rng);
    let now = T0; let steps = 0; const total = {};
    for (const p of P(n)) total[p.id] = 0;
    while (g.phase !== 'over') {
      assert.ok(steps++ < 3000, 'Spiel endet nicht (Seed ' + seed + ')');
      assert.equal(g.phase === 'draw' || g.phase === 'result', true);
      const before = JSON.stringify(g.scores);
      if (g.phase === 'result') {
        assert.ok(H(g, 'p0', { t: 'next' }, now)); now += 1000;
        continue;
      }
      const d = dr(g);
      const r = rng();
      now += Math.floor(rng() * 20000);
      if (r < 0.25) {
        const k = g.sk + 1;
        Q.handle(g, d, { t: 'stroke', pts: [[rng() * 1000, rng() * 1000], [rng() * 1000, rng() * 1000]], c: Math.floor(rng() * 7), w: Math.floor(rng() * 3), k }, rng, now);
      } else if (r < 0.32) Q.handle(g, d, { t: rng() < 0.5 ? 'undo' : 'clear' }, rng, now);
      else if (r < 0.7) {
        const gu = Q.guessers(g)[Math.floor(rng() * (n - 1))].id;
        Q.handle(g, gu, { t: 'guess', text: rng() < 0.4 ? g.word.w : 'falsch' + steps }, rng, now);
      } else if (r < 0.75) Q.handle(g, d, { t: 'guess', text: g.word.w }, rng, now);
      else if (r < 0.85) Q.handle(g, 'p0', { t: 'hint' }, rng, now);
      else if (r < 0.95) Q.handle(g, 'p0', { t: 'timeup' }, rng, now);
      else Q.handle(g, 'p0', { t: 'skip' }, rng, now);
      // Bilanz: Punktesumme = Summe der Erraten-Gewinne + Zeichnerpunkte
      let sum = 0; for (const p of g.players) { assert.ok(g.scores[p.id] >= before.length * 0 && Number.isInteger(g.scores[p.id])); sum += g.scores[p.id]; }
      assert.ok(g.dgain <= 20);
      assert.ok(g.order.length <= n - 1);
      assert.ok(!g.order.includes(dr(g)));
      assert.equal(new Set(g.order).size, g.order.length);
    }
    const sumScores = Object.values(g.scores).reduce((a, b) => a + b, 0);
    const sumWins = Object.values(g.wins).reduce((a, b) => a + b, 0);
    assert.ok(sumScores >= sumWins * 10, 'Seed ' + seed);
    assert.ok(sumScores <= sumWins * (10 + 17 + 5), 'Seed ' + seed);
    assert.equal(g.ri, g.len - 1);
    JSON.parse(JSON.stringify(g));
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  }
});
