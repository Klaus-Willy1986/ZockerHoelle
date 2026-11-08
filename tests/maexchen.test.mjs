import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../maexchen/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const snap = (g) => JSON.stringify(g);
// Rng, der genau die gewünschten Würfel liefert
const dice = (a, b) => { const q = [(a - 0.5) / 6, (b - 0.5) / 6]; let i = 0; return () => q[i++ % 2]; };
const mk = (n = 3, opts = {}) => M.createGame(players(n), opts, seeded(1));
// aktive Person würfelt a,b
const rollAs = (g, a, b) => { const r = M.handle(g, M.activePlayer(g).id, { t: 'roll' }, dice(a, b)); assert.equal(r.ok, true, r.error); return r; };
const say = (g, v) => M.handle(g, M.activePlayer(g).id, { t: 'say', v });

test('Wertung: Reihenfolge der 21 Werte, Würfelwerte, Wahrscheinlichkeiten', () => {
  assert.deepEqual(M.ORDER, [31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 21]);
  assert.equal(new Set(M.ORDER).size, 21);
  assert.equal(M.valueOf(2, 4), 42); assert.equal(M.valueOf(4, 2), 42);
  assert.equal(M.valueOf(1, 2), 21); assert.equal(M.valueOf(2, 1), 21);
  assert.equal(M.valueOf(3, 3), 33); assert.equal(M.valueOf(1, 1), 11); assert.equal(M.valueOf(6, 1), 61);
  // alle 36 Würfe ergeben gültige Werte; Häufigkeit passt zu weight()
  const cnt = {};
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { const v = M.valueOf(a, b); assert.ok(M.isValue(v)); cnt[v] = (cnt[v] || 0) + 1; }
  for (const v of M.ORDER) assert.equal(cnt[v] / 36, M.weight(v), 'Gewicht ' + v);
  assert.ok(Math.abs(M.ORDER.reduce((s, v) => s + M.weight(v), 0) - 1) < 1e-12);
  assert.ok(M.rankOf(31) < M.rankOf(65) && M.rankOf(65) < M.rankOf(11) && M.rankOf(11) < M.rankOf(66) && M.rankOf(66) < M.rankOf(21));
  assert.ok(Math.abs(M.probAtLeast(31) - 1) < 1e-12);
  assert.ok(Math.abs(M.probAtLeast(21) - 2 / 36) < 1e-12);
  assert.ok(Math.abs(M.probAtLeast(66) - 3 / 36) < 1e-12);
  for (let i = 1; i < M.ORDER.length; i++) assert.ok(M.probAtLeast(M.ORDER[i]) < M.probAtLeast(M.ORDER[i - 1]));
});

test('Start: 6 Leben, kurz = 3 Leben, 2 bis 8 Personen, Phase roll', () => {
  const g = mk(4);
  assert.equal(g.phase, 'roll'); assert.equal(g.game, 'mx');
  assert.ok(g.players.every((p) => p.lives === 6));
  assert.ok(mk(2, { short: true }).players.every((p) => p.lives === 3));
  assert.throws(() => M.createGame(players(1), {}, seeded(1)));
  assert.throws(() => M.createGame(players(9), {}, seeded(1)));
  assert.doesNotThrow(() => M.createGame(players(8), {}, seeded(1)));
});

test('Würfeln: nur aktive Person, nur in Phase roll, Wert passt zu den Würfeln', () => {
  const g = mk(3);
  assert.equal(M.handle(g, 'p1', { t: 'roll' }).ok, false);
  const before = snap(g);
  assert.equal(M.handle(g, 'xx', { t: 'roll' }).ok, false);
  assert.equal(snap(g), before);
  rollAs(g, 4, 2);
  assert.equal(g.phase, 'announce'); assert.equal(g.cup, 42); assert.deepEqual(g.cupDice, [4, 2]); assert.equal(g.rollId, 1);
  assert.equal(M.handle(g, 'p0', { t: 'roll' }).ok, false); // zweimal würfeln geht nicht
});

test('Ansagen: erste beliebig (ab 31), danach höher; Wert muss gültig sein', () => {
  const g = mk(3);
  rollAs(g, 3, 1);
  for (const v of [0, 30, 33.5, '42', null, undefined, 67, 12, 13, 23, 100, NaN]) {
    const b = snap(g);
    assert.equal(say(g, v).ok, false, 'ungültig: ' + v);
    assert.equal(snap(g), b);
  }
  assert.equal(M.handle(g, 'p1', { t: 'say', v: 31 }).ok, false); // falsche Person
  assert.equal(say(g, 31).ok, true);
  assert.equal(g.phase, 'decide'); assert.equal(g.active, 1); assert.equal(g.announced, 31);
  assert.equal(M.handle(g, 'p1', { t: 'say', v: 41 }).ok, false); // falsche Phase
  // allowedSays
  assert.deepEqual(M.allowedSays(g), M.ORDER.slice(1));
  assert.equal(M.allowedSays(mk(2)).length, 21);
  const g2 = mk(2); g2.announced = 21; assert.deepEqual(M.allowedSays(g2), []);
});

test('Glauben: nächste Person würfelt selbst und muss höher ansagen (nicht gleich, nicht niedriger)', () => {
  const g = mk(3);
  rollAs(g, 5, 2); say(g, 52);
  assert.equal(M.handle(g, 'p0', { t: 'believe' }).ok, false); // falsche Person
  assert.equal(M.handle(g, 'p1', { t: 'believe' }).ok, true);
  assert.equal(g.phase, 'roll'); assert.equal(g.active, 1); assert.equal(g.cup, null); assert.equal(g.announced, 52);
  rollAs(g, 4, 3);
  assert.equal(say(g, 52).ok, false); assert.equal(say(g, 51).ok, false); assert.equal(say(g, 43).ok, false);
  assert.equal(say(g, 53).ok, true);
  assert.equal(g.active, 2); assert.equal(g.announcer, 1);
});

test('Zweifeln: gelogen -> ansagende Person verliert 1; ehrlich oder genau gleich -> zweifelnde Person verliert 1', () => {
  let g = mk(3);
  rollAs(g, 3, 1); say(g, 52); // gelogen (31 < 52)
  let r = M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(r.ok, true); assert.equal(r.liar, true);
  assert.equal(g.players[0].lives, 5); assert.equal(g.players[1].lives, 6);
  assert.equal(g.phase, 'reveal'); assert.equal(g.active, 0); // Verlierer beginnt
  assert.equal(g.last.kind, 'reveal'); assert.match(g.last.text, /P0 hat gelogen und verliert ein Leben 🍺/);

  g = mk(3);
  rollAs(g, 5, 2); say(g, 52); // genau gleich = wahr
  r = M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(r.liar, false); assert.equal(g.players[1].lives, 5); assert.equal(g.players[0].lives, 6);
  assert.equal(g.active, 1);
  assert.match(g.last.text, /P1 hat zu Unrecht gezweifelt und verliert ein Leben/);

  g = mk(3);
  rollAs(g, 6, 5); say(g, 41); // höher als angesagt = wahr
  M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(g.players[1].lives, 5);
});

test('Mäxchen: angesagt und wahr -> Zweifler verliert 2; gelogen -> Ansager verliert 2; kein Überbieten möglich, Glauben verboten', () => {
  let g = mk(3);
  rollAs(g, 1, 2); say(g, 21);
  assert.equal(M.handle(g, 'p1', { t: 'believe' }).ok, false);
  assert.equal(g.phase, 'decide');
  M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(g.players[1].lives, 4); assert.equal(g.players[0].lives, 6);
  assert.match(g.last.text, /zwei Leben/);

  g = mk(3);
  rollAs(g, 6, 6); say(g, 21);
  M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(g.players[0].lives, 4); assert.equal(g.players[1].lives, 6);
  assert.match(g.last.text, /Mäxchen/);

  // Mäxchen echt gewürfelt, niedriger angesagt, angezweifelt: normal 1 Leben für den Zweifler
  g = mk(3);
  rollAs(g, 2, 1); say(g, 31);
  M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(g.players[1].lives, 5);
  // Mäxchen muss man nicht ansagen: Ansage von niedrigem Wert geht
  // Mäxchen kann nach 66 gelogen werden
  g = mk(3); g.announced = 66; g.phase = 'announce'; g.cup = 31; g.cupDice = [3, 1];
  assert.deepEqual(M.allowedSays(g), [21]);
});

test('look: nur Sicht, kein Zustandswechsel; nur die würfelnde Person in Phase announce', () => {
  const g = mk(3);
  assert.equal(M.handle(g, 'p0', { t: 'look' }).ok, false);
  rollAs(g, 4, 1);
  const b = snap(g);
  assert.equal(M.handle(g, 'p0', { t: 'look' }).ok, true);
  assert.equal(snap(g), b);
  assert.equal(M.handle(g, 'p1', { t: 'look' }).ok, false);
});

test('Nächste Runde: Verlierer beginnt; ausgeschieden -> die nächste Person mit Leben; next nur in Phase reveal', () => {
  const g = mk(3);
  assert.equal(M.handle(g, 'p0', { t: 'next' }).ok, false);
  rollAs(g, 3, 1); say(g, 52); M.handle(g, 'p1', { t: 'doubt' }); // P0 verliert, beginnt
  assert.equal(M.handle(g, 'p2', { t: 'roll' }).ok, false);
  assert.equal(M.handle(g, 'p2', { t: 'next' }).ok, true); // jede Person darf weiter
  assert.equal(g.phase, 'roll'); assert.equal(g.active, 0); assert.equal(g.announced, null); assert.equal(g.cup, null); assert.equal(g.round, 2);
  // Ausscheiden
  const h = mk(3);
  h.players[0].lives = 1;
  rollAs(h, 3, 1); say(h, 52); M.handle(h, 'p1', { t: 'doubt' });
  assert.equal(h.players[0].lives, 0); assert.deepEqual(h.eliminated, ['p0']);
  assert.equal(h.phase, 'reveal'); assert.equal(h.active, 1); // nächste Person mit Leben
  assert.match(h.last.text, /P0 ist raus/);
  M.handle(h, 'p2', { t: 'next' });
  // P0 wird übersprungen
  rollAs(h, 6, 4); say(h, 64);
  assert.equal(h.active, 2);
  M.handle(h, 'p2', { t: 'believe' }); rollAs(h, 6, 5); say(h, 65);
  assert.equal(h.active, 1); // zurück zu P1, P0 übersprungen
  assert.equal(M.handle(h, 'p0', { t: 'roll' }).ok, false);
});

test('Ausgeschiedene Person: Aktionen verweigert; Spielende: letzte Person mit Leben gewinnt, danach nichts mehr', () => {
  const g = mk(2);
  g.players[0].lives = 1;
  rollAs(g, 3, 1); say(g, 52); M.handle(g, 'p1', { t: 'doubt' });
  assert.equal(g.phase, 'over'); assert.deepEqual(g.result.winners, ['p1']); assert.deepEqual(g.eliminated, ['p0']);
  const b = snap(g);
  for (const t of ['roll', 'say', 'believe', 'doubt', 'next', 'look']) assert.equal(M.handle(g, 'p1', { t, v: 31 }).ok, false);
  assert.equal(snap(g), b);
  const rk = M.ranking(g);
  assert.deepEqual(rk.map((x) => [x.id, x.place]), [['p1', 1], ['p0', 2]]);
});

test('Ranking: Ausscheiden in Reihenfolge, wer länger dabei war, steht vorn', () => {
  const g = mk(4);
  g.eliminated = ['p2', 'p0', 'p3']; g.players[2].lives = 0; g.players[0].lives = 0; g.players[3].lives = 0;
  g.result = { winners: ['p1'] }; g.phase = 'over';
  assert.deepEqual(M.ranking(g).map((x) => x.id), ['p1', 'p3', 'p0', 'p2']);
  assert.deepEqual(M.ranking(g).map((x) => x.place), [1, 2, 3, 4]);
});

test('Ungültige Nachrichten und Zustände, JSON-Sicherheit', () => {
  const g = mk(3);
  for (const m of [undefined, null, 0, 'roll', [], {}, { t: 5 }, { t: 'nope' }, { t: 'say' }]) {
    const b = snap(g);
    assert.equal(M.handle(g, 'p0', m).ok, false);
    assert.equal(snap(g), b);
  }
  assert.equal(M.handle(null, 'p0', { t: 'roll' }).ok, false);
  assert.equal(M.handle({}, 'p0', { t: 'roll' }).ok, false);
  assert.equal(M.handle(g, undefined, { t: 'roll' }).ok, false);
  rollAs(g, 4, 5);
  say(g, 54);
  assert.deepEqual(JSON.parse(snap(g)), g);
  const copy = JSON.parse(snap(g));
  assert.equal(M.handle(copy, 'p1', { t: 'doubt' }).ok, true);
  assert.ok(!snap(g).includes('NaN') && !snap(g).includes('undefined'));
});

// Zufallspartien mit zufälligen (gültigen und ungültigen) Eingaben
test('600 Zufallspartien enden immer; Leben-Bilanz, Rundenfolge und Gewinner stimmen', () => {
  for (let seed = 1; seed <= 600; seed++) {
    const rng = seeded(seed * 31 + 7);
    const n = 2 + (seed % 7);
    const short = seed % 3 === 0;
    const g = M.createGame(players(n), { short }, rng);
    const start = short ? 3 : 6;
    let steps = 0; let lost = 0; let rounds = 1;
    while (g.phase !== 'over' && steps++ < 20000) {
      const ap = M.activePlayer(g);
      assert.ok(ap.lives > 0, 'aktive Person hat Leben');
      const before = g.players.reduce((s, p) => s + p.lives, 0);
      let res;
      if (g.phase === 'roll') res = M.handle(g, ap.id, { t: 'roll' }, rng);
      else if (g.phase === 'announce') {
        const al = M.allowedSays(g);
        // zusätzlich eine ungültige Ansage probieren
        if (g.announced !== null) assert.equal(M.handle(g, ap.id, { t: 'say', v: g.announced }, rng).ok, false);
        res = M.handle(g, ap.id, { t: 'say', v: rng() < 0.5 && al.includes(g.cup) ? g.cup : al[Math.floor(rng() * al.length)] }, rng);
      } else if (g.phase === 'decide') {
        res = g.announced !== 21 && rng() < 0.55 ? M.handle(g, ap.id, { t: 'believe' }, rng) : M.handle(g, ap.id, { t: 'doubt' }, rng);
      } else if (g.phase === 'reveal') { res = M.handle(g, g.players[Math.floor(rng() * n)].id, { t: 'next' }, rng); rounds++; }
      assert.equal(res.ok, true, g.phase + ' ' + res.error);
      const after = g.players.reduce((s, p) => s + p.lives, 0);
      assert.ok(before - after === 0 || before - after === 1 || before - after === 2);
      lost += before - after;
      assert.ok(g.players.every((p) => p.lives >= 0 && p.lives <= start));
    }
    assert.equal(g.phase, 'over', 'Partie endet (Seed ' + seed + ')');
    assert.equal(g.players.filter((p) => p.lives > 0).length, 1);
    assert.deepEqual(g.result.winners, [g.players.find((p) => p.lives > 0).id]);
    assert.equal(g.eliminated.length, n - 1);
    assert.equal(g.round, rounds);
    // Bilanz: verlorene Leben = Start - Rest, Summe passt
    assert.equal(n * start - g.players.reduce((s, p) => s + p.lives, 0), lost);
    assert.ok(M.ranking(g).length === n && M.ranking(g)[0].place === 1);
    JSON.parse(JSON.stringify(g));
  }
});
