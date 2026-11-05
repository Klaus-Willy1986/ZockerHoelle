import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../farbcode/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }];
const solo = (rng) => F.createGame([{ id: 'a', name: 'Anna' }], rng);
const ev = (c, g) => F.evaluate(c, g);
// Buchstabenschreibweise: R=0 O=1 Y=2 G=3 B=4 V=5
const code = (s) => [...s].map((ch) => 'ROYGBV'.indexOf(ch));

// ---------- Auswertung ----------
test('Auswertung: einfache Fälle', () => {
  assert.deepEqual(ev(code('RGBY'), code('RGBY')), { b: 4, w: 0 });
  assert.deepEqual(ev(code('RGBY'), code('VVVV')), { b: 0, w: 0 });
  assert.deepEqual(ev(code('RGBY'), code('GRYB')), { b: 0, w: 4 });
  assert.deepEqual(ev(code('RGBY'), code('RGVV')), { b: 2, w: 0 });
  assert.deepEqual(ev(code('RGBY'), code('GVVV')), { b: 0, w: 1 });
});
test('Auswertung: Duplikate (jede Codestelle zählt nur einmal)', () => {
  assert.deepEqual(ev(code('RRBB'), code('RRRR')), { b: 2, w: 0 });
  assert.deepEqual(ev(code('RBBB'), code('RRRR')), { b: 1, w: 0 });
  assert.deepEqual(ev(code('RGBY'), code('RRRR')), { b: 1, w: 0 });
  assert.deepEqual(ev(code('GRBY'), code('RRRR')), { b: 1, w: 0 });
  assert.deepEqual(ev(code('RRGG'), code('GGRR')), { b: 0, w: 4 });
  assert.deepEqual(ev(code('RRGG'), code('RGRG')), { b: 2, w: 2 });
  assert.deepEqual(ev(code('RGGG'), code('GRRR')), { b: 0, w: 2 });
  assert.deepEqual(ev(code('RRRG'), code('GRRR')), { b: 2, w: 2 });
  assert.deepEqual(ev(code('RRBB'), code('BBRB')), { b: 1, w: 2 });
  assert.deepEqual(ev(code('RBBY'), code('BBBB')), { b: 2, w: 0 });
  assert.deepEqual(ev(code('RBYY'), code('YYBR')), { b: 0, w: 4 });
  assert.deepEqual(ev(code('RRRR'), code('RRRR')), { b: 4, w: 0 });
  // Beispiel aus der Hilfe: Code Rot Blau Blau Grün, Versuch Rot Grün Blau Gelb
  assert.deepEqual(ev(code('RBBG'), code('RGBY')), { b: 2, w: 1 });
  // Ein schwarzer Stift verbraucht seine Codestelle: Code R G G B, Versuch G G R R -> schwarz 1 (Platz 2), weiß: G nicht mehr (beide G-Stellen im Code: eine belegt), R 1
  assert.deepEqual(ev(code('RGGB'), code('GGRR')), { b: 1, w: 2 });
});

// Einfache Referenz mit Markieren statt Zählen
function ref(code, guess) {
  const cu = [false, false, false, false];
  const gu = [false, false, false, false];
  let b = 0; let w = 0;
  for (let i = 0; i < 4; i++) if (code[i] === guess[i]) { b++; cu[i] = true; gu[i] = true; }
  for (let i = 0; i < 4; i++) {
    if (gu[i]) continue;
    for (let j = 0; j < 4; j++) {
      if (!cu[j] && code[j] === guess[i]) { w++; cu[j] = true; break; }
    }
  }
  return { b, w };
}
test('Auswertung: alle 1296 x 1296 Paare gegen eine Referenz', () => {
  const all = F.allCodes();
  assert.equal(all.length, 1296);
  assert.equal(new Set(all.map((c) => c.join(''))).size, 1296);
  let n = 0;
  for (const c of all) {
    for (const g of all) {
      const a = F.evaluate(c, g);
      const r = ref(c, g);
      if (a.b !== r.b || a.w !== r.w) assert.fail(`${c} / ${g}: ${JSON.stringify(a)} statt ${JSON.stringify(r)}`);
      n++;
    }
  }
  assert.equal(n, 1296 * 1296);
});
test('Auswertung: Symmetrie, Grenzen und Summenregel', () => {
  const rng = seedRng(5);
  for (let i = 0; i < 3000; i++) {
    const c = F.randomCode(rng); const g = F.randomCode(rng);
    const a = F.evaluate(c, g); const b = F.evaluate(g, c);
    assert.deepEqual(a, b);
    assert.ok(a.b + a.w <= 4 && a.b >= 0 && a.w >= 0);
    assert.ok(!(a.b === 3 && a.w === 1), 'drei richtig und einer nur Farbe ist unmöglich');
  }
});
test('Auswertung verändert ihre Eingaben nicht', () => {
  const c = code('RRGB'); const g = code('GRRB');
  const c0 = c.slice(); const g0 = g.slice();
  F.evaluate(c, g);
  assert.deepEqual(c, c0); assert.deepEqual(g, g0);
});
test('Texte zur Auswertung', () => {
  assert.equal(F.feedbackText(2, 1), '2 richtig, 1 Farbe stimmt');
  assert.equal(F.feedbackText(0, 1), '1 Farbe stimmt');
  assert.equal(F.feedbackText(1, 2), '1 richtig, 2 Farben stimmen');
  assert.equal(F.feedbackText(0, 0), 'nichts stimmt');
  assert.equal(F.feedbackText(4, 0), 'alles richtig');
});
test('Zufallscode ist gültig und deckt alle Farben ab', () => {
  const rng = seedRng(1);
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const c = F.randomCode(rng); assert.ok(F.isValidCode(c)); c.forEach((v) => seen.add(v)); }
  assert.equal(seen.size, 6);
  assert.ok(F.isValidCode(F.randomCode(() => 0.999999999)));
  assert.ok(F.isValidCode(F.randomCode(() => 0)));
});
test('isValidCode weist Unsinn ab', () => {
  for (const c of [null, undefined, 0, 'RGBY', [], [0, 1, 2], [0, 1, 2, 3, 4], [0, 1, 2, 6], [0, 1, 2, -1], [0, 1, 2, 1.5], [0, 1, 2, '3'], [0, 1, 2, null], [0, 1, 2, NaN], [0, 1, 2, Infinity], {}, { length: 4 }]) {
    assert.equal(F.isValidCode(c), false, JSON.stringify(c));
  }
  assert.equal(F.isValidCode([0, 0, 0, 0]), true);
  assert.equal(F.isValidCode([5, 5, 5, 5]), true);
});

// ---------- Alleinspiel ----------
test('Alleinspiel: Start, Sieg im 3. Versuch', () => {
  const g = solo(seedRng(3));
  assert.equal(g.kind, 'solo'); assert.equal(g.mode, 'guess'); assert.ok(F.isValidCode(g.code));
  assert.equal(g.setter, -1); assert.equal(g.guesser, 0);
  const c = g.code;
  const wrong = c.map((v) => (v + 1) % 6);
  assert.deepEqual(F.guess(g, 'a', wrong), { ok: true });
  assert.equal(g.guesses.length, 1);
  assert.equal(g.solved, null);
  assert.ok(F.guess(g, 'a', wrong).ok);
  assert.equal(F.codeRevealed(g), false);
  assert.ok(F.guess(g, 'a', c).ok);
  assert.equal(g.solved, true); assert.equal(g.mode, 'over');
  assert.deepEqual(g.results, [{ setter: null, guesser: 'a', tries: 3, solved: true }]);
  assert.equal(F.scoreOf(g, 'a'), 3);
  const o = F.outcome(g);
  assert.equal(o.solved, true); assert.equal(o.tries, 3); assert.equal(o.winner, 'a');
  assert.equal(F.guess(g, 'a', c).ok, false, 'nach dem Ende kein Versuch mehr');
  assert.equal(g.guesses.length, 3);
});
test('Alleinspiel: Sieg im ersten und im zehnten Versuch', () => {
  const g1 = solo(seedRng(4));
  assert.ok(F.guess(g1, 'a', g1.code).ok);
  assert.equal(F.scoreOf(g1, 'a'), 1);
  const g10 = solo(seedRng(5));
  const wrong = g10.code.map((v) => (v + 1) % 6);
  for (let i = 0; i < 9; i++) assert.ok(F.guess(g10, 'a', wrong).ok);
  assert.equal(g10.mode, 'guess');
  assert.equal(F.triesLeft(g10), 1);
  assert.ok(F.guess(g10, 'a', g10.code).ok);
  assert.equal(g10.solved, true); assert.equal(F.scoreOf(g10, 'a'), 10);
});
test('Alleinspiel: Niederlage nach 10 Versuchen, Code wird aufgedeckt', () => {
  const g = solo(seedRng(6));
  const wrong = g.code.map((v) => (v + 1) % 6);
  for (let i = 0; i < 10; i++) { assert.equal(g.mode, 'guess'); assert.ok(F.guess(g, 'a', wrong).ok); }
  assert.equal(g.mode, 'over'); assert.equal(g.solved, false);
  assert.equal(F.codeRevealed(g), true);
  assert.equal(F.scoreOf(g, 'a'), F.NO_SOLVE);
  assert.equal(F.scoreOf(g, 'a'), 11);
  assert.equal(F.outcome(g).winner, null);
  assert.equal(F.guess(g, 'a', g.code).ok, false);
  assert.equal(g.guesses.length, 10);
});
test('Alleinspiel: Code ist durch rng bestimmt (Zufall nur als Parameter)', () => {
  const a = solo(seedRng(11)); const b = solo(seedRng(11)); const c = solo(seedRng(12));
  assert.deepEqual(a.code, b.code);
  assert.notDeepEqual(a.code, c.code);
  assert.deepEqual(F.createGame([{ id: 'a', name: 'A' }], () => 0).code, [0, 0, 0, 0]);
});
test('Alleinspiel: Auswertung im Spielstand stimmt mit evaluate überein', () => {
  const rng = seedRng(21);
  const g = solo(rng);
  while (g.mode === 'guess') {
    const x = F.randomCode(rng);
    F.guess(g, 'a', x);
    const last = g.guesses[g.guesses.length - 1];
    assert.deepEqual({ b: last.b, w: last.w }, F.evaluate(g.code, x));
  }
});

// ---------- Gegen den Computer ----------
test('Gegen den Computer: Mensch legt fest, Computer rät', () => {
  const g = F.createGame([{ id: 'a', name: 'Anna' }, { id: 'bot1', name: 'Computer' }]);
  assert.equal(g.kind, 'bot'); assert.equal(g.mode, 'code'); assert.equal(g.code, null);
  assert.equal(g.players[g.setter].id, 'a'); assert.equal(g.players[g.guesser].id, 'bot1');
  assert.equal(F.guess(g, 'bot1', [0, 0, 1, 1]).ok, false, 'noch kein Code');
  assert.equal(F.guess(g, 'a', [0, 0, 1, 1]).ok, false);
  assert.equal(F.setCode(g, 'bot1', [0, 0, 1, 1]).ok, false, 'Computer legt nicht fest');
  assert.ok(F.setCode(g, 'a', [2, 2, 3, 4]).ok);
  assert.equal(g.mode, 'guess');
  assert.equal(F.setCode(g, 'a', [1, 1, 1, 1]).ok, false, 'Code nicht nachträglich ändern');
  assert.deepEqual(g.code, [2, 2, 3, 4]);
  assert.equal(F.guess(g, 'a', [2, 2, 3, 4]).ok, false, 'Mensch rät hier nicht');
  assert.ok(F.guess(g, 'bot1', [0, 0, 1, 1]).ok);
  assert.ok(F.guess(g, 'bot1', [2, 2, 3, 4]).ok);
  assert.equal(g.mode, 'over');
  const o = F.outcome(g);
  assert.equal(o.kind, 'bot'); assert.equal(o.solved, true); assert.equal(o.tries, 2); assert.equal(o.winner, 'bot1');
});
test('Gegen den Computer: Reihenfolge der Spieler egal, Mensch gewinnt bei Misserfolg', () => {
  const g = F.createGame([{ id: 'bot1', name: 'Computer' }, { id: 'a', name: 'Anna' }]);
  assert.equal(g.players[g.setter].id, 'a'); assert.equal(g.players[g.guesser].id, 'bot1');
  assert.ok(F.setCode(g, 'a', [5, 5, 5, 5]).ok);
  for (let i = 0; i < 10; i++) assert.ok(F.guess(g, 'bot1', [0, 0, 0, 0]).ok);
  assert.equal(g.mode, 'over');
  const o = F.outcome(g);
  assert.equal(o.solved, false); assert.equal(o.winner, 'a');
  assert.equal(F.scoreOf(g, 'bot1'), 11);
  assert.equal(F.scoreOf(g, 'a'), null);
});

// ---------- Zu zweit ----------
function playDuo(triesA, triesB) {
  // a legt Runde 1 fest, b rät (triesB Versuche; >10 = scheitert); danach umgekehrt
  const g = F.createGame(P2);
  assert.equal(g.kind, 'duo'); assert.equal(g.mode, 'code'); assert.equal(g.round, 1); assert.equal(g.rounds, 2);
  assert.equal(g.players[g.setter].id, 'a'); assert.equal(g.players[g.guesser].id, 'b');
  const run = (setter, guesser, tries) => {
    assert.ok(F.setCode(g, setter, [1, 2, 3, 4]).ok);
    const n = Math.min(tries, 10);
    for (let i = 1; i < n; i++) assert.ok(F.guess(g, guesser, [0, 0, 0, 0]).ok);
    if (tries <= 10) assert.ok(F.guess(g, guesser, [1, 2, 3, 4]).ok);
    else assert.ok(F.guess(g, guesser, [0, 0, 0, 0]).ok);
  };
  run('a', 'b', triesB);
  assert.equal(g.mode, 'between');
  assert.ok(F.next(g, 'a').ok);
  assert.equal(g.round, 2); assert.equal(g.mode, 'code'); assert.equal(g.code, null); assert.deepEqual(g.guesses, []);
  assert.equal(g.players[g.setter].id, 'b'); assert.equal(g.players[g.guesser].id, 'a');
  run('b', 'a', triesA);
  assert.equal(g.mode, 'over');
  return g;
}
test('Zu zweit: Rollenwechsel und Sieger nach zwei Runden', () => {
  const g = playDuo(3, 5);
  assert.equal(F.scoreOf(g, 'a'), 3); assert.equal(F.scoreOf(g, 'b'), 5);
  const o = F.outcome(g);
  assert.equal(o.winner, 'a'); assert.equal(o.draw, false);
  assert.deepEqual(g.results.map((r) => [r.setter, r.guesser]), [['a', 'b'], ['b', 'a']]);
  assert.equal(F.outcome(playDuo(6, 2)).winner, 'b');
});
test('Zu zweit: Unentschieden und nicht geknackt = 11', () => {
  assert.equal(F.outcome(playDuo(4, 4)).draw, true);
  assert.equal(F.outcome(playDuo(4, 4)).winner, null);
  const both = playDuo(11, 11);
  assert.equal(F.scoreOf(both, 'a'), 11); assert.equal(F.scoreOf(both, 'b'), 11);
  assert.equal(F.outcome(both).draw, true);
  const one = playDuo(10, 11);
  assert.equal(F.outcome(one).winner, 'a');
  const other = playDuo(11, 10);
  assert.equal(F.outcome(other).winner, 'b');
});
test('Zu zweit: falsche Person, falsche Phase', () => {
  const g = F.createGame(P2);
  assert.equal(F.setCode(g, 'b', [0, 0, 0, 0]).ok, false, 'Rateperson legt nicht fest');
  assert.equal(F.guess(g, 'b', [0, 0, 0, 0]).ok, false, 'vor dem Code kein Raten');
  assert.equal(F.next(g, 'a').ok, false, 'next nur zwischen den Runden');
  assert.equal(F.setCode(g, 'x', [0, 0, 0, 0]).ok, false);
  assert.ok(F.setCode(g, 'a', [0, 0, 0, 0]).ok);
  assert.equal(F.guess(g, 'a', [0, 0, 0, 0]).ok, false, 'Codegeberin rät nicht');
  assert.equal(F.guess(g, 'x', [0, 0, 0, 0]).ok, false);
  assert.equal(F.next(g, 'a').ok, false);
  assert.ok(F.guess(g, 'b', [0, 0, 0, 0]).ok);
  assert.equal(g.mode, 'between');
  assert.equal(F.guess(g, 'b', [0, 0, 0, 0]).ok, false);
  assert.equal(F.setCode(g, 'a', [0, 0, 0, 0]).ok, false);
  assert.equal(F.next(g, 'x').ok, false, 'Fremde können nicht fortsetzen');
  assert.equal(F.outcome(g), null, 'kein Ergebnis vor dem Ende');
});
test('Doppeltes Absenden: Versuchsnummer schützt', () => {
  const g = solo(seedRng(8));
  assert.ok(F.guess(g, 'a', [0, 0, 0, 0], 0).ok);
  assert.equal(F.guess(g, 'a', [0, 0, 0, 0], 0).ok, false);
  assert.equal(g.guesses.length, 1);
  assert.ok(F.guess(g, 'a', [0, 0, 0, 0], 1).ok);
  assert.equal(F.guess(g, 'a', [0, 0, 0, 0], '2').ok, false);
  assert.equal(F.guess(g, 'a', [0, 0, 0, 0], 5).ok, false);
  assert.equal(g.guesses.length, 2);
});

// ---------- Ungültige Nachrichten ändern nie den Zustand ----------
test('Ungültige Nachrichten: {ok:false,error} und Zustand bleibt gleich', () => {
  const states = [];
  const s0 = F.createGame(P2); states.push(s0);
  const s1 = F.createGame(P2); F.setCode(s1, 'a', [1, 2, 3, 4]); states.push(s1);
  const s2 = F.createGame(P2); F.setCode(s2, 'a', [1, 2, 3, 4]); F.guess(s2, 'b', [1, 2, 3, 4]); states.push(s2);
  const s3 = solo(seedRng(2)); states.push(s3);
  const s4 = solo(seedRng(2)); for (let i = 0; i < 10; i++) F.guess(s4, 'a', [0, 0, 0, 0]); states.push(s4);
  const s5 = F.createGame([{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }]); states.push(s5);
  const junk = [undefined, null, 0, 1, 'x', true, [], [1], {}, { t: 1 }, { t: 'quatsch' }, { t: 'guess' }, { t: 'guess', g: 'RGBY' },
    { t: 'guess', g: [0, 1, 2] }, { t: 'guess', g: [0, 1, 2, 9] }, { t: 'guess', g: [0, 1, 2, 3.5] }, { t: 'guess', g: ['0', '1', '2', '3'] },
    { t: 'guess', g: [0, 1, 2, 3, 4] }, { t: 'guess', g: [null, null, null, null] }, { t: 'guess', g: [0, 1, 2, 3], n: 'x' },
    { t: 'code' }, { t: 'code', code: null }, { t: 'code', code: [0, 1, 2] }, { t: 'code', code: [6, 6, 6, 6] }, { t: 'code', code: [-1, 0, 0, 0] },
    { t: '__proto__' }, { t: 'constructor' }];
  let bad = 0;
  for (const s of states) {
    for (const pid of ['a', 'b', 'bot1', 'x', '', null, undefined, 3]) {
      for (const m of junk) {
        const before = JSON.stringify(s);
        const r = F.handle(s, pid, m);
        if (!r.ok) {
          bad++;
          assert.equal(typeof r.error, 'string');
          assert.equal(JSON.stringify(s), before, `Zustand verändert durch ${JSON.stringify(m)} von ${pid}`);
        } else {
          // Gültige Nachricht von der richtigen Person: Zustand nur durch erlaubte Aktion verändert; zurücksetzen nicht nötig
          assert.fail(`unerwartet akzeptiert: ${JSON.stringify(m)} von ${pid} in ${s.mode}`);
        }
      }
    }
  }
  assert.ok(bad > 1000);
  // Direkte Funktionen mit kaputtem Zustand werfen nicht
  for (const fn of [F.setCode, F.guess, F.next]) {
    for (const st of [null, undefined, 0, 'x']) assert.equal(fn(st, 'a', [0, 0, 0, 0]).ok, false);
  }
  assert.equal(F.outcome(null), null);
});

// ---------- JSON-Sicherheit ----------
test('Spielstand übersteht JSON-Kopie in jeder Phase', () => {
  const same = (g) => assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  const g = F.createGame(P2); same(g);
  F.setCode(g, 'a', [1, 2, 3, 4]); same(g);
  F.guess(g, 'b', [0, 1, 2, 3]); same(g);
  F.guess(g, 'b', [1, 2, 3, 4]); same(g);
  F.next(g, 'b'); same(g);
  F.setCode(g, 'b', [5, 5, 5, 5]); F.guess(g, 'a', [5, 5, 5, 5]); same(g);
  assert.equal(g.mode, 'over');
  // Spielen mit der Kopie funktioniert weiter
  const g2 = JSON.parse(JSON.stringify(F.createGame(P2)));
  assert.ok(F.handle(g2, 'a', { t: 'code', code: [0, 1, 2, 3] }).ok);
  const g3 = JSON.parse(JSON.stringify(g2));
  assert.ok(F.handle(g3, 'b', { t: 'guess', g: [0, 1, 2, 3], n: 0 }).ok);
  assert.equal(g3.mode, 'between');
  assert.equal(JSON.stringify(g2).includes('undefined'), false);
});
test('createGame verlangt 1 oder 2 Personen', () => {
  assert.throws(() => F.createGame([]));
  assert.throws(() => F.createGame(null));
  assert.throws(() => F.createGame([1, 2, 3].map((i) => ({ id: 'p' + i, name: 'P' }))));
});

// ---------- Zufallspartien ----------
test('Zufallspartien: Invarianten bleiben immer erhalten', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seedRng(seed * 31 + 7);
    const kind = seed % 3;
    const players = kind === 0 ? [{ id: 'a', name: 'A' }] : kind === 1 ? P2 : [{ id: 'bot1', name: 'C' }, { id: 'a', name: 'A' }];
    const g = F.createGame(players, rng);
    const ids = players.map((p) => p.id);
    let guard = 0; let rounds = 1;
    while (g.mode !== 'over' && guard++ < 400) {
      const pid = rng() < 0.9 ? ids[Math.floor(rng() * ids.length)] : 'zzz';
      const r = rng();
      const before = JSON.stringify(g);
      let res;
      if (r < 0.2) res = F.handle(g, pid, { t: 'code', code: F.randomCode(rng) });
      else if (r < 0.9) res = F.handle(g, pid, { t: 'guess', g: rng() < 0.5 && g.code ? g.code : F.randomCode(rng), n: rng() < 0.7 ? g.guesses.length : undefined });
      else res = F.handle(g, pid, { t: 'next' });
      if (!res.ok) assert.equal(JSON.stringify(g), before);
      assert.ok(g.guesses.length <= F.MAX_TRIES);
      assert.ok(['code', 'guess', 'between', 'over'].includes(g.mode));
      if (g.mode === 'guess') assert.ok(F.isValidCode(g.code));
      if (g.mode === 'code') assert.equal(g.code, null);
      if (g.solved === true) assert.ok(g.guesses.some((x) => x.b === 4));
      if (g.solved === false) assert.equal(g.guesses.length, 10);
      if (g.round > rounds) rounds = g.round;
    }
    assert.equal(g.mode, 'over', `Seed ${seed} endet`);
    assert.equal(g.results.length, g.rounds);
    assert.equal(rounds, g.rounds);
    const o = F.outcome(g);
    assert.ok(o && o.kind === (kind === 0 ? 'solo' : kind === 1 ? 'duo' : 'bot'));
    for (const r of g.results) assert.ok(r.tries >= 1 && r.tries <= 10 && typeof r.solved === 'boolean');
  }
});
