import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../stadt/engine.js';
import { WOERTER } from '../stadt/woerter.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }];
const P3 = [...P2, { id: 'c', name: 'Carla' }];
const mk = (pl = P2, opts = {}, seed = 1) => Q.createGame(pl, { host: pl[0].id, ...opts }, seeded(seed));
const fillAll = (g, id, arr) => { g.cats.forEach((_, i) => assert.ok(Q.handle(g, id, { t: 'fill', cat: i, v: arr[i] ?? '' }).ok)); };
const ok = (g, id, m) => { const r = Q.handle(g, id, m); assert.ok(r.ok, `${JSON.stringify(m)}: ${r.error}`); return r; };
const bad = (g, id, m) => { const r = Q.handle(g, id, m); assert.equal(r.ok, false, `${JSON.stringify(m)} sollte scheitern`); assert.equal(typeof r.error, 'string'); return r; };
const json = (g) => JSON.parse(JSON.stringify(g));
const CAT = { stadt: 0, land: 1, fluss: 2, name: 3, tier: 4, beruf: 5 };

// ---------- Wörterbuch ----------
const EXC = { // sehr schwierige Kombinationen: erlaubte Mindestmenge (statt 6)
  land: { F: 3, H: 3, J: 4, O: 3, R: 3, W: 2, Z: 2 },
  fluss: { Z: 5 },
  pflanze: { U: 4 },
  essen: { U: 5 },
};
test('Wörterbuch: alle 8 Kategorien, Mindestmengen je Buchstabe, keine Duplikate, richtiger Anfangsbuchstabe', () => {
  assert.deepEqual(Object.keys(WOERTER).sort(), Object.keys(Q.CATS).sort());
  assert.equal(Q.LETTERS.length, 22);
  for (const bad of ['Q', 'X', 'Y', 'C']) assert.ok(!Q.LETTERS.includes(bad));
  let total = 0; let under = 0;
  for (const [cat, list] of Object.entries(WOERTER)) {
    assert.ok(Array.isArray(list));
    const seen = new Set();
    const per = {};
    for (const w of list) {
      assert.equal(typeof w, 'string');
      assert.equal(w, w.trim(), `Leerzeichen am Rand: "${w}"`);
      assert.ok(w.length >= 2, `zu kurz: ${w}`);
      assert.ok(!/\s{2,}/.test(w), `Doppel-Leerzeichen: ${w}`);
      assert.ok(!/[0-9]/.test(w), `Ziffer: ${w}`);
      const k = Q.norm(w);
      assert.ok(!seen.has(k), `Duplikat in ${cat}: ${w}`);
      seen.add(k);
      const L = k[0].toUpperCase();
      assert.ok(Q.LETTERS.includes(L), `Buchstabe ${L} (${cat}: ${w}) wird nie gezogen`);
      (per[L] = per[L] || []).push(w);
      total++;
    }
    for (const L of Q.LETTERS) {
      const n = (per[L] || []).length;
      const min = (EXC[cat] && EXC[cat][L]) || 6;
      assert.ok(n >= min, `${cat} ${L}: nur ${n} (Soll ${min})`);
      if (min < 6) under++;
      assert.ok(n >= 2, `${cat} ${L}: jede Kombination mindestens 2`);
    }
  }
  assert.ok(total > 1000, 'zu wenige Wörter: ' + total);
  assert.ok(under <= 12);
  console.log(`      Wörterbuch: ${total} Einträge, ${under} Kombinationen unter 6`);
});

test('Wörterbuch: bekannte Beispiele sind gültig, Erfundenes nicht', () => {
  assert.ok(Q.inDict('stadt', 'berlin') && Q.inDict('stadt', '  BERLIN ') && Q.inDict('stadt', 'Köln') && Q.inDict('stadt', 'koeln'));
  assert.ok(Q.inDict('stadt', 'Gießen') && Q.inDict('stadt', 'giessen') && Q.inDict('stadt', 'GIESSEN'));
  assert.ok(Q.inDict('stadt', 'Den  Haag') && Q.inDict('stadt', 'denhaag'));
  assert.ok(Q.inDict('land', 'Österreich') && Q.inDict('land', 'oesterreich') && Q.inDict('land', 'Guinea Bissau'));
  assert.ok(Q.inDict('fluss', 'Rhone') && Q.inDict('fluss', 'Rhône'));
  assert.ok(!Q.inDict('stadt', 'Schlumpfhausen') && !Q.inDict('fluss', 'Berlin') && !Q.inDict('nix', 'Berlin'));
});

test('norm: Groß/Klein, Leerzeichen, ß = ss, Umlaute, Akzente', () => {
  assert.equal(Q.norm('  Straße '), 'strasse');
  assert.equal(Q.norm('STRASSE'), 'strasse');
  assert.equal(Q.norm('Ärger'), 'aerger');
  assert.equal(Q.norm('Garmisch-Partenkirchen'), Q.norm('garmisch partenkirchen'));
  assert.equal(Q.norm('Zoë'), 'zoe');
  assert.equal(Q.norm(null), '');
  assert.equal(Q.norm(undefined), '');
  assert.equal(Q.norm(42), '42');
  assert.ok(Q.startsWithLetter('Österreich', 'O') && Q.startsWithLetter('straße', 'S') && !Q.startsWithLetter('Berlin', 'A') && !Q.startsWithLetter('', 'A') && !Q.startsWithLetter('  ', 'A'));
  assert.equal(Q.clean('  a\nb\t c  '), 'a b c');
  assert.equal(Q.clean('x'.repeat(100)).length, Q.MAX_LEN);
  assert.equal(Q.clean(null), '');
});

// ---------- Spielaufbau ----------
test('createGame: Standardwerte, Optionen, Buchstaben ohne Wiederholung', () => {
  const g = mk();
  assert.equal(g.game, 'sl'); assert.equal(g.rounds, 6); assert.deepEqual(g.cats, ['stadt', 'land', 'fluss', 'name', 'tier', 'beruf']);
  assert.equal(g.round, 0); assert.equal(g.phase, 'fill'); assert.equal(g.letters.length, 6); assert.equal(g.letter, g.letters[0]);
  assert.equal(new Set(g.letters).size, 6);
  assert.ok(g.letters.every((l) => Q.LETTERS.includes(l)));
  assert.equal(g.stopOpt, false);
  assert.deepEqual(g.drafts.a, ['', '', '', '', '', '']);
  const m = mk(P2, { more: true, rounds: 10, stop: true });
  assert.equal(m.cats.length, 8); assert.equal(m.rounds, 10); assert.equal(new Set(m.letters).size, 10); assert.equal(m.stopOpt, true);
  assert.deepEqual(m.cats.slice(6), ['pflanze', 'essen']);
  assert.deepEqual(mk(P2, { cats: ['tier', 'stadt'] }).cats, ['tier', 'stadt']);
  assert.equal(mk(P2, { cats: ['unsinn'] }).cats.length, 6);
  assert.equal(mk(P2, { cats: ['tier', 'tier'] }).cats.length, 6);
  assert.equal(mk(P2, { rounds: 0 }).rounds, 6); assert.equal(mk(P2, { rounds: 99 }).rounds, 6); assert.equal(mk(P2, { rounds: 4.5 }).rounds, 6);
  assert.equal(mk(P2, { rounds: 22 }).rounds, 22);
  assert.deepEqual(mk(P2, { rounds: 2, letters: ['B', 'S'] }).letters, ['B', 'S']);
  assert.notDeepEqual(mk(P2, { rounds: 2, letters: ['B', 'B'] }).letters, ['B', 'B']);
  assert.equal(mk(P2, { rounds: 2, letters: ['Q', 'S'] }).letters.every((l) => Q.LETTERS.includes(l)), true);
  assert.throws(() => Q.createGame([], {}, Math.random));
  assert.throws(() => Q.createGame(Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, name: 'x' })), {}, Math.random));
  assert.throws(() => Q.createGame([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], {}, Math.random));
  assert.doesNotThrow(() => mk([{ id: 'a', name: 'A' }]));
});

test('Buchstaben: über viele Spiele nie Q X Y C, nie doppelt, alle kommen vor', () => {
  const seen = new Set();
  for (let s = 1; s <= 300; s++) {
    const g = mk(P2, { rounds: 10 }, s);
    assert.equal(new Set(g.letters).size, 10);
    for (const l of g.letters) { assert.ok(!'QXYC'.includes(l)); assert.match(l, /^[A-Z]$/); seen.add(l); }
  }
  assert.equal(seen.size, 22);
});

// ---------- Eingabe ----------
test('Entwürfe: speichern, säubern, bleiben im Zustand', () => {
  const g = mk();
  ok(g, 'a', { t: 'fill', cat: 0, v: '  Berlin  ' });
  assert.equal(g.drafts.a[0], 'Berlin');
  ok(g, 'a', { t: 'fill', cat: 1, v: 'x'.repeat(200) });
  assert.equal(g.drafts.a[1].length, Q.MAX_LEN);
  ok(g, 'a', { t: 'fill', cat: 2, v: 'Zeile\nzwei' });
  assert.equal(g.drafts.a[2], 'Zeile zwei');
  ok(g, 'a', { t: 'fill', cat: 0, v: '' });
  assert.equal(g.drafts.a[0], '');
  bad(g, 'a', { t: 'fill', cat: 6, v: 'x' }); bad(g, 'a', { t: 'fill', cat: -1, v: 'x' }); bad(g, 'a', { t: 'fill', cat: 1.5, v: 'x' }); bad(g, 'a', { t: 'fill', cat: '1', v: 'x' });
  bad(g, 'a', { t: 'fill', cat: 0, v: 5 }); bad(g, 'a', { t: 'fill', cat: 0 }); bad(g, 'a', { t: 'fill', cat: 0, v: null });
  assert.deepEqual(Object.keys(g.drafts.b).map((k) => g.drafts.b[k]), ['', '', '', '', '', '']);
});

test('Ungültige Nachrichten, falsche Person, falsche Phase, falsche Runde', () => {
  const g = mk();
  bad(g, 'zz', { t: 'done' });
  bad(g, 'a', null); bad(g, 'a', 'done'); bad(g, 'a', {}); bad(g, 'a', { t: 5 }); bad(g, 'a', { t: 'quatsch' });
  bad(null, 'a', { t: 'done' }); bad({ game: 'x' }, 'a', { t: 'done' });
  bad(g, 'a', { t: 'fill', r: 3, cat: 0, v: 'x' });
  ok(g, 'a', { t: 'fill', r: 0, cat: 0, v: 'x' });
  bad(g, 'a', { t: 'next' }); bad(g, 'a', { t: 'timeup' }); bad(g, 'a', { t: 'vote', pid: 'b', cat: 0 }); bad(g, 'a', { t: 'reopen' });
  bad(g, 'b', { t: 'skip' }); // nur Gastgeber
  bad(g, 'a', { t: 'answers', v: ['', '', '', '', '', ''] }); // nur Computer
  bad(g, 'a', { t: 'done', v: ['x'] }); bad(g, 'a', { t: 'done', v: 'x' });
  bad(g, 'a', { t: 'stop' }); // ohne Option
  ok(g, 'a', { t: 'done' });
  bad(g, 'a', { t: 'done' }); bad(g, 'a', { t: 'fill', cat: 0, v: 'y' });
  assert.equal(g.drafts.a[0], 'x');
});

test('Runde endet erst, wenn alle fertig sind; Doch noch ändern', () => {
  const g = mk();
  ok(g, 'a', { t: 'done' });
  assert.equal(g.phase, 'fill');
  assert.deepEqual(Q.pending(g).map((p) => p.id), ['b']);
  ok(g, 'a', { t: 'reopen' });
  assert.deepEqual(Q.pending(g).map((p) => p.id), ['a', 'b']);
  bad(g, 'a', { t: 'reopen' });
  ok(g, 'a', { t: 'fill', cat: 0, v: 'Berlin' });
  ok(g, 'a', { t: 'done' }); ok(g, 'b', { t: 'done' });
  assert.equal(g.phase, 'reveal');
  assert.deepEqual(Q.pending(g), []);
  bad(g, 'a', { t: 'reopen' }); bad(g, 'a', { t: 'done' }); bad(g, 'a', { t: 'fill', cat: 0, v: 'x' });
});

test('done mit allen Antworten auf einmal', () => {
  const g = mk(P2, { cats: ['stadt', 'land'], letters: ['B', 'S'], rounds: 2 });
  ok(g, 'a', { t: 'done', r: 0, v: ['Berlin', 'Belgien'] });
  assert.deepEqual(g.drafts.a, ['Berlin', 'Belgien']);
  ok(g, 'b', { t: 'done', v: ['Bonn', 'Bolivien'] });
  assert.equal(g.reveal.gain.a, 20); assert.equal(g.reveal.gain.b, 20);
});

// ---------- Stopp ----------
test('Stopp: nur mit Option, nur mit allen Feldern, nur einmal; Frist endet mit timeup (nur Gastgeber)', () => {
  const g = mk(P3, { stop: true }, 4);
  bad(g, 'a', { t: 'stop' }); // Felder leer
  fillAll(g, 'a', ['1', '2', '3', '4', '5', '6'].map((x) => x));
  ok(g, 'a', { t: 'stop' });
  assert.deepEqual(g.stop, { by: 'a' }); assert.ok(g.done.a);
  assert.equal(g.phase, 'fill');
  bad(g, 'a', { t: 'stop' });
  fillAll(g, 'b', ['x', 'x', 'x', 'x', 'x', 'x']);
  bad(g, 'b', { t: 'stop' }); // schon gestoppt
  bad(g, 'a', { t: 'reopen' }); // nach Stopp nicht mehr
  bad(g, 'b', { t: 'timeup' }); // nicht Gastgeber
  fillAll(g, 'c', ['', 'y']);
  ok(g, 'a', { t: 'timeup' });
  assert.equal(g.phase, 'reveal');
  // was eingetragen ist, zählt (auch ohne Fertig)
  assert.equal(g.reveal.cats[0].rows.b.a, 'x');
  assert.equal(g.reveal.cats[1].rows.c.a, 'y');
  bad(g, 'a', { t: 'timeup' });
});
test('Stopp: ohne Stopp-Frist kein timeup; Stopp mit v; Solo ohne Stopp', () => {
  const g = mk(P2, { stop: true }, 4);
  bad(g, 'a', { t: 'timeup' });
  ok(g, 'a', { t: 'stop', v: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.equal(g.drafts.a[5], 'f');
  ok(g, 'b', { t: 'done' }); // alle fertig -> sofort aufgelöst
  assert.equal(g.phase, 'reveal');
  const s = mk([{ id: 'a', name: 'A' }], { stop: true });
  fillAll(s, 'a', ['a', 'b', 'c', 'd', 'e', 'f']);
  bad(s, 'a', { t: 'stop' });
  bad(s, 'a', { t: 'timeup' });
  const sk = mk(P2, { stop: true });
  fillAll(sk, 'a', ['a', 'b', 'c', 'd', 'e', 'f']);
  ok(sk, 'a', { t: 'stop' });
  ok(sk, 'a', { t: 'skip' });
  assert.equal(sk.phase, 'reveal');
});

test('skip: Gastgeber beendet die Runde ohne Säumige', () => {
  const g = mk(P3);
  ok(g, 'b', { t: 'done' });
  bad(g, 'b', { t: 'skip' });
  fillAll(g, 'c', ['', '', '', '', '', '']);
  ok(g, 'a', { t: 'skip' });
  assert.equal(g.phase, 'reveal');
});

// ---------- Wertung ----------
function play(g, answers) { // answers: {a:[...], b:[...]}
  for (const [id, arr] of Object.entries(answers)) ok(g, id, { t: 'done', v: g.cats.map((_, i) => arr[i] ?? '') });
  assert.equal(g.phase, 'reveal');
  return g.reveal;
}
const G = (pl, letters = ['B', 'S']) => mk(pl, { cats: ['stadt', 'land', 'fluss', 'tier'], letters, rounds: 2 });

test('Wertung: einzigartig 10, gleich 5, einzige Antwort 20, leer/falscher Buchstabe 0', () => {
  const g = G(P3);
  const rv = play(g, { a: ['Berlin', 'Belgien', 'Bode', 'Biber'], b: ['Bonn', 'Belgien', '', 'Amsel'], c: ['bonn', '  BELGIEN ', '', ''] });
  const r = rv.cats;
  assert.equal(r[0].rows.a.pts, 10); assert.equal(r[0].rows.b.pts, 5); assert.equal(r[0].rows.c.pts, 5); // Bonn gleich
  assert.ok(r[0].rows.b.shared && !r[0].rows.a.shared);
  assert.deepEqual([r[1].rows.a.pts, r[1].rows.b.pts, r[1].rows.c.pts], [5, 5, 5]); // alle gleich
  assert.deepEqual([r[2].rows.a.pts, r[2].rows.b.pts, r[2].rows.c.pts], [20, 0, 0]); // einzige Antwort
  assert.equal(r[3].rows.a.pts, 20); assert.equal(r[3].rows.b.st, 'wrong'); assert.equal(r[3].rows.b.pts, 0); assert.equal(r[3].rows.c.st, 'empty');
  assert.equal(rv.gain.a, 10 + 5 + 20 + 20); assert.equal(rv.gain.b, 5 + 5); assert.equal(rv.gain.c, 5 + 5);
  assert.equal(g.scores.a, 55); assert.equal(g.scores.b, 10); assert.equal(g.base.a, 0);
});

test('Wertung: Gleichstand ohne Groß/Klein/Leerzeichen, ß = ss', () => {
  const g = G(P2, ['S', 'B']);
  const rv = play(g, { a: ['Straßburg', 'Schweden', 'Saale', 'Specht'], b: ['STRASSBURG', ' schweden', 'Saale ', 'Schwan'] });
  assert.deepEqual(rv.cats.slice(0, 3).map((c) => [c.rows.a.pts, c.rows.b.pts]), [[5, 5], [5, 5], [5, 5]]);
  assert.deepEqual([rv.cats[3].rows.a.pts, rv.cats[3].rows.b.pts], [10, 10]);
  assert.ok(rv.cats[0].rows.a.valid);
});

test('Wertung: falscher Anfangsbuchstabe und leer zählen nicht als "einzige Antwort"-Konkurrenz', () => {
  const g = G(P2);
  const rv = play(g, { a: ['Berlin'], b: ['Hamburg'] });
  assert.equal(rv.cats[0].rows.a.pts, 20); assert.equal(rv.cats[0].rows.b.pts, 0);
  assert.equal(rv.cats[0].rows.b.st, 'wrong');
});

test('Wertung: Wort mit richtigem Anfang aber falscher Kategorie ist ungeprüft (nicht im Wörterbuch dieser Kategorie)', () => {
  const g = G(P2);
  const rv = play(g, { a: ['Bär'], b: [] });
  assert.equal(rv.cats[0].rows.a.st, 'unknown');
});

test('Ungeprüft: allein oder nur mit Computern -> gültig mit halben Punkten (5 bzw. 10 wenn einzige)', () => {
  const s = G([{ id: 'a', name: 'Anna' }]);
  const rv = play(s, { a: ['Blumenhausen', 'Belgien', 'Bode', 'Biber'] });
  const u = rv.cats[0].rows.a;
  assert.equal(u.st, 'unknown'); assert.ok(u.valid && u.half); assert.equal(u.pts, 10); // einzige: 20 -> 10
  assert.equal(rv.cats[1].rows.a.pts, 20);
  assert.equal(rv.gain.a, 10 + 20 + 20 + 20);
  // gegen Computer: gleiche Regel (Computer antworten nur aus dem Wörterbuch, stimmen nie ab)
  const g = G([{ id: 'a', name: 'Anna' }, { id: 'bot1', name: 'Computer' }]);
  ok(g, 'a', { t: 'done', v: ['Blumenhausen', 'Belgien', '', ''] });
  ok(g, 'bot1', { t: 'answers', v: ['Berlin', 'Belgien', 'Bode', 'Biber'] });
  const r = g.reveal.cats;
  assert.equal(r[0].rows.a.pts, 5); assert.ok(r[0].rows.a.half); assert.equal(r[0].rows.bot1.pts, 10);
  assert.equal(r[1].rows.a.pts, 5); assert.equal(r[1].rows.bot1.pts, 5);
  assert.equal(g.reveal.cats[2].rows.bot1.pts, 20);
  // Abstimmen geht dort nicht
  bad(g, 'a', { t: 'vote', pid: 'a', cat: 0 });
  bad(g, 'bot1', { t: 'vote', pid: 'a', cat: 0 });
  bad(s, 'a', { t: 'vote', pid: 'a', cat: 0 });
});

test('Ungeprüft mit Menschen: bleibt gültig, bis die Mehrheit der ANDEREN "Gilt nicht" tippt', () => {
  // zwei Menschen: eine andere Person genügt
  const g = G(P2);
  play(g, { a: ['Blumenhausen', 'Belgien'], b: ['Berlin', 'Bolivien'] });
  const row = () => g.reveal.cats[0].rows.a;
  assert.equal(row().st, 'unknown'); assert.ok(row().valid && !row().half); assert.equal(row().pts, 10); assert.equal(row().need, 1);
  const before = g.scores.a;
  bad(g, 'a', { t: 'vote', pid: 'a', cat: 0 }); // nicht über sich selbst
  bad(g, 'b', { t: 'vote', pid: 'b', cat: 0 });
  bad(g, 'b', { t: 'vote', pid: 'a', cat: 1 }); // Belgien ist bekannt
  bad(g, 'b', { t: 'vote', pid: 'b', cat: 0 }); // Berlin bekannt/selbst
  bad(g, 'b', { t: 'vote', pid: 'a', cat: 9 }); bad(g, 'b', { t: 'vote', pid: 'zz', cat: 0 }); bad(g, 'b', { t: 'vote', pid: 5, cat: 0 });
  ok(g, 'b', { t: 'vote', pid: 'a', cat: 0 });
  assert.ok(row().rejected && !row().valid); assert.equal(row().pts, 0); assert.equal(row().votes, 1);
  assert.equal(g.scores.a, before - 10);
  // Berlin ist jetzt einzige gültige Antwort? (Blumenhausen ungültig) -> Berlin 20
  assert.equal(g.reveal.cats[0].rows.b.pts, 20);
  assert.equal(g.scores.b, g.reveal.gain.b);
  // zurücknehmen
  ok(g, 'b', { t: 'vote', pid: 'a', cat: 0 });
  assert.ok(row().valid); assert.equal(row().pts, 10); assert.equal(g.scores.a, before);
  assert.deepEqual(g.votes, {});
});

test('Ungeprüft: Mehrheit bei drei und vier Menschen', () => {
  const g = G(P3);
  play(g, { a: ['Blumenhausen'], b: ['Berlin'], c: ['Bonn'] });
  const row = () => g.reveal.cats[0].rows.a;
  assert.equal(row().need, 2);
  ok(g, 'b', { t: 'vote', pid: 'a', cat: 0 });
  assert.ok(row().valid && row().pts === 10); // 1 von 2: noch gültig
  ok(g, 'c', { t: 'vote', pid: 'a', cat: 0 });
  assert.ok(row().rejected && row().pts === 0); // Mehrheit
  ok(g, 'c', { t: 'vote', pid: 'a', cat: 0 }); // zurücknehmen
  assert.ok(row().valid);
  // vier Menschen: 3 von 3 anderen -> 2 reichen
  const four = [...P3, { id: 'd', name: 'Dora' }];
  const h = G(four);
  play(h, { a: ['Blumenhausen'], b: ['Berlin'], c: ['Bonn'], d: ['Bochum'] });
  assert.equal(h.reveal.cats[0].rows.a.need, 2);
  // drei Computer + zwei Menschen: nur Menschen zählen
  const m = G([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'bot1', name: 'C1' }, { id: 'bot2', name: 'C2' }]);
  ok(m, 'a', { t: 'done', v: ['Blumenhausen', '', '', ''] }); ok(m, 'b', { t: 'done' });
  ok(m, 'bot1', { t: 'answers', v: ['Berlin', '', '', ''] }); ok(m, 'bot2', { t: 'answers', v: ['Bonn', '', '', ''] });
  assert.equal(m.reveal.cats[0].rows.a.need, 1);
  ok(m, 'b', { t: 'vote', pid: 'a', cat: 0 });
  assert.ok(m.reveal.cats[0].rows.a.rejected);
});

test('Ungeprüft: gleiche ungeprüfte Wörter zählen als gleich (5), Stimmen wirken je Person', () => {
  const g = G(P3);
  play(g, { a: ['Blumenhausen'], b: ['blumenhausen'], c: ['Berlin'] });
  const rows = g.reveal.cats[0].rows;
  assert.deepEqual([rows.a.pts, rows.b.pts, rows.c.pts], [5, 5, 10]);
  ok(g, 'c', { t: 'vote', pid: 'a', cat: 0 });
  assert.equal(rows.a.pts, 5); // 1 von 2: noch gültig
  ok(g, 'b', { t: 'vote', pid: 'a', cat: 0 }); // b hat das gleiche Wort, darf aber über a abstimmen
  assert.ok(g.reveal.cats[0].rows.a.rejected);
  assert.equal(g.reveal.cats[0].rows.b.pts, 10); // b ist jetzt allein mit dem Wort (a ungültig)
});

test('Votes: Stimmen von Computern oder Nicht-Menschen zählen nicht; nach "next" keine Abstimmung mehr', () => {
  const g = G(P2);
  play(g, { a: ['Blumenhausen'], b: ['Berlin'] });
  ok(g, 'b', { t: 'vote', pid: 'a', cat: 0 });
  ok(g, 'a', { t: 'next' });
  assert.equal(g.phase, 'fill'); assert.equal(g.round, 1);
  bad(g, 'b', { t: 'vote', pid: 'a', cat: 0 });
  assert.deepEqual(g.votes, {});
});

test('Punkte bleiben zwischen den Runden erhalten, Votes wirken nur auf die laufende Auflösung', () => {
  const g = G(P2);
  play(g, { a: ['Berlin'], b: ['Bonn'] });
  assert.deepEqual([g.scores.a, g.scores.b], [10, 10]);
  bad(g, 'b', { t: 'next' }); // nur Gastgeber
  ok(g, 'a', { t: 'next' });
  assert.equal(g.round, 1); assert.equal(g.letter, 'S'); assert.equal(g.phase, 'fill');
  assert.deepEqual(g.base, { a: 10, b: 10 }); assert.deepEqual(g.done, {}); assert.equal(g.stop, null); assert.equal(g.reveal, null);
  assert.deepEqual(g.drafts.a, ['', '', '', '']);
  play(g, { a: ['Stuttgart'], b: ['Stuttgart'] });
  assert.deepEqual([g.scores.a, g.scores.b], [15, 15]);
  bad(g, 'b', { t: 'next' });
  ok(g, 'a', { t: 'next' });
  assert.equal(g.phase, 'over'); assert.equal(g.reveal, null);
  bad(g, 'a', { t: 'next' }); bad(g, 'a', { t: 'done' }); bad(g, 'a', { t: 'vote', pid: 'b', cat: 0 });
  assert.equal(Q.isOver(g), true);
  assert.deepEqual(Q.ranking(g).map((r) => [r.id, r.score, r.rank]), [['a', 15, 1], ['b', 15, 1]]);
  assert.equal(Q.winners(g).length, 2);
});

test('Rangliste: Rang, Gleichstand, Reihenfolge', () => {
  const g = mk(P3);
  g.scores = { a: 10, b: 30, c: 10 };
  assert.deepEqual(Q.ranking(g).map((r) => [r.id, r.rank]), [['b', 1], ['a', 2], ['c', 2]]);
});

test('Nachricht von Spielleiter-Id: ohne host in opts ist die erste Person Gastgeber', () => {
  const g = Q.createGame(P2, {}, seeded(2));
  assert.equal(g.host, 'a');
  bad(g, 'b', { t: 'skip' });
});

test('Zustand ist JSON-sicher in jeder Phase', () => {
  const g = G(P2);
  assert.deepEqual(json(g), g);
  ok(g, 'a', { t: 'fill', cat: 0, v: 'Berlin' });
  assert.deepEqual(json(g), g);
  play(g, { a: ['Berlin', 'Blumen'], b: ['Bonn'] });
  assert.deepEqual(json(g), g);
  ok(g, 'b', { t: 'vote', pid: 'a', cat: 1 });
  assert.deepEqual(json(g), g);
  ok(g, 'a', { t: 'next' });
  ok(g, 'a', { t: 'done' }); ok(g, 'b', { t: 'done' });
  ok(g, 'a', { t: 'next' });
  assert.deepEqual(json(g), g);
});

test('200+ Zufallspartien enden immer, Punkte stimmen mit unabhängiger Neuberechnung überein', () => {
  const words = ['Berlin', 'Bonn', 'Belgien', 'Biber', 'Blumenhausen', 'Hamburg', 'Stuttgart', 'Schaf', 'Xyz', 'Zoe', 'Zürich', 'Aare', 'Ulm', '', '', '  ', 'Österreich', 'Weser'];
  for (let seed = 1; seed <= 250; seed++) {
    const r = seeded(seed * 7 + 1);
    const np = 1 + Math.floor(r() * 5);
    const pl = Array.from({ length: np }, (_, i) => ({ id: i < 3 || r() < 0.5 ? 'h' + i : 'bot' + i, name: 'P' + i }));
    pl[0].id = 'h0';
    const g = Q.createGame(pl, { host: 'h0', rounds: 2 + Math.floor(r() * 5), more: r() < 0.5, stop: r() < 0.5 }, r);
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 400) {
      assert.deepEqual(json(g), g);
      if (g.phase === 'fill') {
        const todo = g.players.filter((p) => !g.done[p.id]);
        const p = todo[Math.floor(r() * todo.length)];
        const k = r();
        if (Q.isBotId(p.id)) Q.handle(g, p.id, { t: 'answers', v: g.cats.map(() => words[Math.floor(r() * words.length)]) });
        else if (k < 0.3) Q.handle(g, p.id, { t: 'fill', cat: Math.floor(r() * g.cats.length), v: words[Math.floor(r() * words.length)] });
        else if (k < 0.4) Q.handle(g, p.id, { t: 'reopen' });
        else if (k < 0.5 && g.stopOpt) Q.handle(g, p.id, { t: 'stop', v: g.cats.map(() => words[Math.floor(r() * words.length)]) });
        else if (k < 0.55 && g.stop) Q.handle(g, 'h0', { t: 'timeup' });
        else if (k < 0.58) Q.handle(g, 'h0', { t: 'skip' });
        else Q.handle(g, p.id, { t: 'done', v: g.cats.map(() => words[Math.floor(r() * words.length)]) });
      } else if (g.phase === 'reveal') {
        // Abstimmen (Zufall, auch Unsinn) und Gegenprobe
        for (let v = 0; v < 3; v++) Q.handle(g, pl[Math.floor(r() * np)].id, { t: 'vote', pid: pl[Math.floor(r() * np)].id, cat: Math.floor(r() * g.cats.length) });
        const lc = g.letter.toLowerCase();
        const hs = g.players.filter((p) => !Q.isBotId(p.id));
        let total = {};
        g.cats.forEach((cat, ci) => {
          const rows = g.players.map((p) => {
            const a = g.drafts[p.id][ci]; const k2 = Q.norm(a);
            let valid = false; let half = false;
            if (k2 && k2[0] === lc) {
              if (Q.inDict(cat, a)) valid = true;
              else {
                const others = hs.filter((h) => h.id !== p.id);
                if (!others.length) { valid = true; half = true; } else {
                  const vs = (g.votes[`${ci}|${p.id}`] || []).filter((x) => others.some((h) => h.id === x)).length;
                  valid = vs < Math.floor(others.length / 2) + 1;
                }
              }
            }
            return { p, k: k2, valid, half };
          });
          const vr = rows.filter((x) => x.valid);
          for (const x of vr) {
            let pts = vr.length === 1 ? 20 : vr.filter((y) => y.k === x.k).length > 1 ? 5 : 10;
            if (x.half) pts = Math.floor(pts / 2);
            total[x.p.id] = (total[x.p.id] || 0) + pts;
          }
        });
        for (const p of g.players) {
          assert.equal(g.reveal.gain[p.id], total[p.id] || 0, `Seed ${seed}`);
          assert.equal(g.scores[p.id], g.base[p.id] + (total[p.id] || 0));
        }
        assert.equal(Q.handle(g, 'h0', { t: 'next' }).ok, true);
      }
    }
    assert.equal(g.phase, 'over', `Seed ${seed} endet nicht`);
    assert.ok(Q.ranking(g).length === np && Q.winners(g).length >= 1);
    assert.ok(Object.values(g.scores).every((v) => Number.isInteger(v) && v >= 0));
  }
});
