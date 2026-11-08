import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../stadt/engine.js';
import { WOERTER } from '../stadt/woerter.js';
import { chooseAction, knownWords, thinkDelay, hash01, KNOW, BLANK, DELAY_MIN, DELAY_MAX } from '../stadt/ai.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = [{ id: 'me', name: 'Erna' }, { id: 'bot1', name: 'Computer 1' }, { id: 'bot2', name: 'Computer 2' }];
const mk = (seed = 1, opts = {}) => Q.createGame(players, { host: 'me', more: true, rounds: 10, ...opts }, seeded(seed));

test('Zielwerte: Wissen 50 % / 90 %, Lücken 25 % / 5 %, nur Wörterbuch', () => {
  assert.deepEqual(KNOW, [0.5, 0.9]); assert.deepEqual(BLANK, [0.25, 0.05]);
  for (const lv of [0, 1]) {
    let cells = 0; let blanks = 0; let known = 0; let avail = 0; let dict = 0; let unknown = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const g = mk(seed);
      const a = chooseAction(g, 'bot1', lv, seeded(seed + 1000));
      assert.equal(a.t, 'answers'); assert.equal(a.v.length, 8); assert.equal(a.r, 0);
      a.v.forEach((w, i) => {
        cells++;
        if (!w) { blanks++; return; }
        dict++;
        assert.ok(Q.inDict(g.cats[i], w), `${w} nicht im Wörterbuch`);
        assert.ok(Q.startsWithLetter(w, g.letter), `${w} beginnt nicht mit ${g.letter}`);
        const kn = knownWords('bot1', g.letter, g.cats[i], lv);
        assert.ok(kn.includes(w));
      });
      for (const c of g.cats) { const all = WOERTER[c].filter((w) => Q.startsWithLetter(w, g.letter)); avail += all.length; known += knownWords('bot1', g.letter, c, lv).length; }
      // gleiche Eingaben in der Auflösung: nie ungeprüft
      Q.handle(g, 'bot1', a); Q.handle(g, 'bot2', chooseAction(g, 'bot2', lv, seeded(seed))); Q.handle(g, 'me', { t: 'done' });
      for (const c of g.reveal.cats) for (const id of ['bot1', 'bot2']) { assert.notEqual(c.rows[id].st, 'unknown'); assert.notEqual(c.rows[id].st, 'wrong'); }
    }
    const bl = blanks / cells; const kn = known / avail;
    console.log(`      Stufe ${lv ? 'Mittel' : 'Leicht'}: leer ${(bl * 100).toFixed(1)} %, Wissen ${(kn * 100).toFixed(1)} %`);
    assert.ok(Math.abs(bl - BLANK[lv]) < 0.03, `Lücken ${bl}`);
    assert.ok(Math.abs(kn - KNOW[lv]) < 0.05, `Wissen ${kn}`);
    assert.equal(unknown, 0); void dict;
  }
});

test('Wissen ist fest (deterministisch) je Computer+Buchstabe+Kategorie und unabhängig vom Zufall', () => {
  const a = knownWords('bot1', 'B', 'stadt', 0); const b = knownWords('bot1', 'B', 'stadt', 0);
  assert.deepEqual(a, b);
  assert.notDeepEqual(knownWords('bot1', 'B', 'tier', 0), knownWords('bot2', 'B', 'tier', 0));
  assert.ok(knownWords('bot1', 'B', 'stadt', 1).length >= knownWords('bot1', 'B', 'stadt', 0).length);
  assert.ok(knownWords('bot1', 'B', 'unsinn', 0).length === 0);
  for (const w of knownWords('bot1', 'S', 'tier', 0)) assert.ok(Q.startsWithLetter(w, 'S'));
  for (const lv of [0, 1]) for (const L of Q.LETTERS) for (const c of Object.keys(Q.CATS)) assert.ok(knownWords('bot3', L, c, lv).length >= 1, `${c} ${L}`);
  assert.ok(hash01('x') >= 0 && hash01('x') < 1 && hash01('x') === hash01('x'));
  // Zufall wählt unter den bekannten Wörtern: über viele Würfe kommen mehrere verschiedene vor
  const g = mk(5);
  const seen = new Set();
  for (let s = 1; s <= 200; s++) seen.add(chooseAction(g, 'bot1', 1, seeded(s)).v[0]);
  assert.ok(seen.size >= 3);
});

test('Rechenzeit unter 150 ms und Verzögerung 3 bis 8 Sekunden', () => {
  const g = mk(3);
  let worst = 0;
  for (let i = 0; i < 300; i++) { const t0 = performance.now(); chooseAction(g, 'bot1', i % 2, seeded(i)); worst = Math.max(worst, performance.now() - t0); }
  console.log(`      schlechteste Rechenzeit ${worst.toFixed(2)} ms`);
  assert.ok(worst < 150);
  assert.equal(DELAY_MIN, 3000); assert.equal(DELAY_MAX, 8000);
  assert.equal(thinkDelay(() => 0), 3000); assert.equal(thinkDelay(() => 0.999999), 8000);
  for (let i = 0; i < 200; i++) { const d = thinkDelay(seeded(i)); assert.ok(d >= 3000 && d <= 8000); }
});

test('Computer schummelt nicht: verändertes verdecktes Zustand ändert die Entscheidung nicht', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = mk(seed);
    const base = chooseAction(g, 'bot1', seed % 2, seeded(seed));
    const h = JSON.parse(JSON.stringify(g));
    // Entwürfe der anderen, Antworten, Stimmen, Punkte verändern
    h.drafts.me = h.cats.map((c) => (WOERTER[c].find((w) => Q.startsWithLetter(w, h.letter)) || 'X'));
    h.drafts.bot2 = h.cats.map(() => 'Zzz');
    h.scores = { me: 999, bot1: 0, bot2: 5 }; h.votes = { '0|me': ['bot1'] }; h.stop = { by: 'me' }; h.done = { me: true };
    assert.deepEqual(chooseAction(h, 'bot1', seed % 2, seeded(seed)), base);
    const drafts = JSON.stringify(g.drafts); chooseAction(g, 'bot1', 0, seeded(1));
    assert.equal(JSON.stringify(g.drafts), drafts, 'Zustand wird nicht verändert');
  }
});

test('Ungültige Lage: keine Aktion', () => {
  const g = mk(1);
  assert.equal(chooseAction(null, 'bot1', 0), null); assert.equal(chooseAction({}, 'bot1', 0), null);
  assert.equal(chooseAction(g, 'bot9', 0), null);
  Q.handle(g, 'bot1', chooseAction(g, 'bot1', 0, seeded(1)));
  assert.equal(chooseAction(g, 'bot1', 0), null); // schon fertig
  Q.handle(g, 'bot2', chooseAction(g, 'bot2', 1, seeded(1))); Q.handle(g, 'me', { t: 'done' });
  assert.equal(g.phase, 'reveal');
  assert.equal(chooseAction(g, 'bot1', 0), null);
});

test('Komplette Partien gegen Computer (Leicht/Mittel) enden immer; Computer-Wörter sind nie ungültig', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const lv = seed % 2;
    const g = mk(seed, { rounds: 4 });
    let n = 0;
    while (g.phase !== 'over' && n++ < 100) {
      if (g.phase === 'fill') {
        for (const b of ['bot1', 'bot2']) { const a = chooseAction(g, b, lv, seeded(seed * 9 + n)); if (a) assert.ok(Q.handle(g, b, a).ok); }
        assert.ok(Q.handle(g, 'me', { t: 'done' }).ok);
      } else assert.ok(Q.handle(g, 'me', { t: 'next' }).ok);
    }
    assert.equal(g.phase, 'over');
  }
});
