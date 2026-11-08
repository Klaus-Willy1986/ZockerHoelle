import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../galgen/engine.js';
import { WOERTER, KATEGORIEN } from '../galgen/woerter.js';
import { snowmanSvg, meltStage, PARTS } from '../galgen/draw.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }];
const fixed = (words, players = P2, extra = {}) => G.createGame(players, { words: words.map(([w, k]) => ({ w, k: k || 'tiere' })), host: players[0].id, ...extra }, seedRng(1));
const ok = (r) => assert.ok(r.ok, JSON.stringify(r));

test('Wortliste: Mengen, Zeichen, Länge, Duplikate', () => {
  assert.ok(WOERTER.length >= 400, 'Anzahl ' + WOERTER.length);
  const cats = {};
  const seen = new Set();
  for (const { w, k } of WOERTER) {
    assert.ok(k in KATEGORIEN, 'Kategorie ' + k);
    assert.match(w, /^[A-ZÄÖÜß]{4,12}$/, 'Wort ' + w);
    assert.ok(!seen.has(w), 'Duplikat ' + w);
    seen.add(w);
    cats[k] = (cats[k] || 0) + 1;
  }
  assert.ok(Object.keys(KATEGORIEN).length >= 8);
  for (const k of Object.keys(KATEGORIEN)) assert.ok(cats[k] >= 40, `${k}: ${cats[k]}`);
  for (const v of Object.values(KATEGORIEN)) assert.ok(v.length > 3);
});

test('Treffer: Buchstabe erscheint überall, 1 Punkt je Fundstelle, gleiche Person bleibt dran', () => {
  const g = fixed([['KATZE'], ['HUND']]);
  ok(G.handle(g, 'a', { t: 'letter', l: 'k' }));
  assert.deepEqual(g.mask, ['K', null, null, null, null]);
  assert.equal(g.scores.a, 1); assert.equal(g.turn, 0); assert.equal(g.errs, 0);
  ok(G.handle(g, 'a', { t: 'letter', l: 'Z' }));
  assert.equal(g.scores.a, 2);
  // zwei Fundstellen
  const h = fixed([['HASE']]); ok(G.handle(h, 'a', { t: 'letter', l: 'A' })); assert.equal(h.scores.a, 1);
  const w = fixed([['ANANAS']]); ok(G.handle(w, 'a', { t: 'letter', l: 'A' })); assert.equal(w.scores.a, 3);
  assert.equal(w.last.n, 3);
});

test('Fehler: zählt gemeinsam, Galgen wächst, nächste Person ist dran', () => {
  const g = fixed([['KATZE']]);
  ok(G.handle(g, 'a', { t: 'letter', l: 'X' }));
  assert.equal(g.errs, 1); assert.equal(g.turn, 1); assert.equal(g.scores.a, 0);
  ok(G.handle(g, 'b', { t: 'letter', l: 'Q' }));
  assert.equal(g.errs, 2); assert.equal(g.turn, 0);
  assert.deepEqual(g.guessed, ['X', 'Q']);
  assert.equal(g.last.kind, 'miss');
});

test('Wort-Rate: richtig = 3 Bonus + 1 je verdecktem Buchstaben, Runde endet', () => {
  const g = fixed([['KATZE'], ['HUND']]);
  ok(G.handle(g, 'a', { t: 'letter', l: 'K' })); // 1 Punkt, 4 verdeckt
  ok(G.handle(g, 'a', { t: 'word', w: ' katze ' }));
  assert.equal(g.phase, 'reveal'); assert.equal(g.solved, true); assert.equal(g.solvedBy, 'a');
  assert.equal(g.scores.a, 1 + 3 + 4); assert.equal(g.scores.b, 0);
  assert.deepEqual(g.mask, ['K', 'A', 'T', 'Z', 'E']);
  assert.equal(g.wins, 1);
  assert.equal(g.last.bonus, 7);
});

test('Wort-Rate: falsch = Fehler, Zug endet, Wort steht in badWords', () => {
  const g = fixed([['KATZE']]);
  ok(G.handle(g, 'a', { t: 'word', w: 'Hund' }));
  assert.equal(g.errs, 1); assert.equal(g.turn, 1); assert.deepEqual(g.badWords, ['HUND']); assert.equal(g.phase, 'play');
  assert.equal(g.last.kind, 'badword');
});

test('Letzter Buchstabe löst: 3 Bonus, kein Aufschlag', () => {
  const g = fixed([['HUND'], ['KATZE']]);
  for (const l of 'HUN') ok(G.handle(g, 'a', { t: 'letter', l }));
  assert.equal(g.scores.a, 3);
  ok(G.handle(g, 'a', { t: 'letter', l: 'D' }));
  assert.equal(g.scores.a, 3 + 1 + 3); assert.equal(g.phase, 'reveal'); assert.equal(g.solved, true);
});

test('Niederlage nach N Fehlern: kein Bonus, Wort aufgedeckt (8, Leicht 10)', () => {
  for (const [opts, n] of [[{}, 8], [{ easy: true }, 10]]) {
    const g = fixed([['KATZE'], ['HUND']], P2, opts);
    assert.equal(g.maxErr, n);
    const wrong = 'BFGHJMOPQRSVWXY'.split('');
    for (let i = 0; i < n; i++) {
      assert.equal(g.phase, 'play');
      ok(G.handle(g, G.current(g).id, { t: 'letter', l: wrong[i] }));
    }
    assert.equal(g.phase, 'reveal'); assert.equal(g.solved, false); assert.equal(g.solvedBy, null);
    assert.equal(g.scores.a + g.scores.b, 0); assert.equal(g.mask.join(''), 'KATZE');
    assert.equal(g.last.kind, 'lost');
  }
  assert.equal(G.createGame(P2, { errors: 5 }).maxErr, 5);
  assert.equal(G.createGame(P2, { errors: 99 }).maxErr, 8);
});

test('Falsches Wort beim letzten Fehler beendet die Runde als verloren', () => {
  const g = fixed([['KATZE'], ['HUND']], P2, { errors: 3 });
  ok(G.handle(g, 'a', { t: 'letter', l: 'X' })); ok(G.handle(g, 'b', { t: 'letter', l: 'Q' }));
  ok(G.handle(g, 'a', { t: 'word', w: 'Haus' }));
  assert.equal(g.phase, 'reveal'); assert.equal(g.solved, false);
});

test('Rundenwechsel: nur Gastgeber, Startperson wechselt, Ende nach den Runden, Rangliste', () => {
  const g = fixed([['HUND'], ['KATZE']]);
  ok(G.handle(g, 'a', { t: 'word', w: 'HUND' }));
  assert.equal(G.handle(g, 'b', { t: 'next' }).ok, false);
  ok(G.handle(g, 'a', { t: 'next' }));
  assert.equal(g.round, 1); assert.equal(g.word, 'KATZE'); assert.equal(g.turn, 1); assert.equal(g.errs, 0);
  assert.deepEqual(g.guessed, []); assert.deepEqual(g.gain, { a: 0, b: 0 });
  ok(G.handle(g, 'b', { t: 'word', w: 'KATZE' }));
  ok(G.handle(g, 'a', { t: 'next' }));
  assert.equal(g.phase, 'over');
  const rk = G.ranking(g);
  assert.equal(rk[0].rank, 1); assert.equal(G.winners(g).length, rk.filter((r) => r.rank === 1).length);
  assert.equal(g.scores.a, 7); assert.equal(g.scores.b, 8);
  assert.equal(G.winners(g)[0].id, 'b');
  assert.equal(G.handle(g, 'a', { t: 'letter', l: 'A' }).ok, false);
});

test('Solo-Serie: weiter solange gelöst, Ende beim ersten verlorenen Wort', () => {
  const g = G.createGame([{ id: 'a', name: 'Anna' }], { errors: 3 }, seedRng(3));
  assert.equal(g.solo, true); assert.equal(g.rounds, 0);
  const seen = new Set([g.word]);
  for (let i = 0; i < 6; i++) {
    ok(G.handle(g, 'a', { t: 'word', w: g.word }));
    ok(G.handle(g, 'a', { t: 'next' }));
    assert.equal(g.phase, 'play'); assert.ok(!seen.has(g.word), 'Wort nicht doppelt'); seen.add(g.word);
  }
  assert.equal(g.wins, 6);
  const nope = 'QXYJVWK'.split('').filter((c) => !g.word.includes(c));
  for (let i = 0; i < 3; i++) ok(G.handle(g, 'a', { t: 'letter', l: nope[i] }));
  assert.equal(g.solved, false); assert.equal(g.wins, 6);
  ok(G.handle(g, 'a', { t: 'next' }));
  assert.equal(g.phase, 'over');
});

test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = fixed([['KATZE'], ['HUND']]);
  const bad = (pid, msg) => assert.equal(G.handle(g, pid, msg).ok, false, JSON.stringify(msg));
  bad('b', { t: 'letter', l: 'A' }); // nicht dran
  bad('zz', { t: 'letter', l: 'A' });
  bad('a', null); bad('a', 'x'); bad('a', {}); bad('a', { t: 5 }); bad('a', { t: 'foo' });
  bad('a', { t: 'letter' }); bad('a', { t: 'letter', l: 'AB' }); bad('a', { t: 'letter', l: '1' }); bad('a', { t: 'letter', l: 'ß' }); bad('a', { t: 'letter', l: 5 }); bad('a', { t: 'letter', l: '' });
  bad('a', { t: 'word' }); bad('a', { t: 'word', w: 5 }); bad('a', { t: 'word', w: '   ' }); bad('a', { t: 'word', w: 'X'.repeat(40) });
  bad('a', { t: 'letter', l: 'A', r: 3 }); // alte Runde
  bad('a', { t: 'next' }); bad('a', { t: 'skip', r: 9 });
  assert.equal(G.handle(null, 'a', { t: 'letter', l: 'A' }).ok, false);
  assert.equal(G.handle({ game: 'xx' }, 'a', { t: 'letter', l: 'A' }).ok, false);
  ok(G.handle(g, 'a', { t: 'letter', l: 'A' }));
  bad('a', { t: 'letter', l: 'A' }); // schon geraten
  bad('b', { t: 'skip' }); // nur Gastgeber
  ok(G.handle(g, 'a', { t: 'skip' })); assert.equal(g.turn, 1); assert.equal(g.errs, 0);
  ok(G.handle(g, 'b', { t: 'word', w: 'katze' }));
  bad('b', { t: 'letter', l: 'B' }); bad('b', { t: 'word', w: 'x' }); bad('b', { t: 'skip' }); // Phase reveal
  assert.throws(() => G.createGame([], {}));
  assert.throws(() => G.createGame(Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: 'x' })), {}));
  assert.throws(() => G.createGame([{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }], {}));
});

test('Umlaute und ß: Taste Ä Ö Ü, ß liegt offen, Wort-Rate mit ss/ß', () => {
  const g = fixed([['KÄFER'], ['STRAßE']], [{ id: 'a', name: 'A' }]);
  ok(G.handle(g, 'a', { t: 'letter', l: 'ä' }));
  assert.equal(g.mask[1], 'Ä');
  ok(G.handle(g, 'a', { t: 'word', w: 'käfer' }));
  ok(G.handle(g, 'a', { t: 'next' }));
  assert.equal(g.mask[4], 'ß'); assert.equal(g.mask.filter((c) => c === null).length, 5);
  ok(G.handle(g, 'a', { t: 'word', w: 'Strasse' }));
  assert.equal(g.solved, true);
});

test('Zustand ist JSON-sicher, öffentliche Maske verrät das Wort nicht', () => {
  const g = G.createGame(P2, {}, seedRng(9));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  assert.ok(g.mask.every((c) => c === null));
  assert.equal(g.mask.length, g.word.length);
  assert.ok(g.word.length >= 4 && g.cat in KATEGORIEN);
});

test('Zeichnung: Stufen, SVG', () => {
  for (const max of [8, 10]) {
    let prev = 0;
    for (let e = 0; e <= max; e++) { const s = meltStage(e, max); assert.ok(s >= prev && s <= PARTS.length); if (e < max) assert.ok(s < PARTS.length); prev = s; }
    assert.equal(meltStage(max, max), PARTS.length);
    assert.equal(new Set(Array.from({ length: max + 1 }, (_, e) => snowmanSvg(e, max, e >= max))).size, max + 1, 'jede Stufe sieht anders aus');
  }
  assert.match(snowmanSvg(0, 8), /^<svg[^>]*aria-label/);
});

test('300 Zufallspartien enden immer; Punkte-Bilanz stimmt', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seedRng(seed);
    const n = 1 + Math.floor(rng() * 6);
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'S' + i }));
    const g = G.createGame(players, { rounds: 1 + Math.floor(rng() * 4), easy: rng() < 0.3, host: 'p0' }, rng);
    let steps = 0; let total = 0;
    while (g.phase !== 'over' && steps++ < 5000) {
      if (g.phase === 'reveal') { ok(G.handle(g, 'p0', { t: 'next' }, rng)); continue; }
      const cur = G.current(g).id;
      const before = g.scores[cur];
      const r = rng();
      let msg;
      if (r < 0.1) msg = { t: 'word', w: rng() < 0.5 ? g.word : 'ZZZZ' };
      else { const free = G.KEYS.filter((k) => !g.guessed.includes(k)); msg = { t: 'letter', l: free[Math.floor(rng() * free.length)] }; }
      ok(G.handle(g, cur, msg, rng));
      assert.ok(g.scores[cur] >= before);
      assert.ok(g.errs <= g.maxErr);
      if (g.phase === 'reveal') assert.equal(g.mask.join(''), g.word);
    }
    assert.equal(g.phase, 'over', 'Seed ' + seed);
    total = Object.values(g.scores).reduce((a, b) => a + b, 0);
    assert.ok(total >= 0); assert.ok(g.wins <= g.rounds || g.rounds === 0);
  }
});
