import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../bingo/engine.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const P2 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }];
const mk = (opts = {}, players = P2, seed = 1) => E.createGame(players, { host: 'a', ...opts }, seeded(seed));
const drawN = (g, n, rng) => { for (let i = 0; i < n; i++) assert.ok(E.draw(g, g.host, rng).ok); };
// Zahl n auf Karte (pid,c) markieren (muss gezogen sein)
const markNum = (g, pid, n, c = 0) => { const i = g.cards[pid][c].indexOf(n); return E.mark(g, pid, c, i); };
// Setzt eine Zahl direkt als gezogen (ohne rng) – für gezielte Fälle
const force = (g, nums) => { for (const n of nums) if (!g.drawn.includes(n)) g.drawn.push(n); };
const rowNums = (g, pid, line, c = 0) => line.filter((i) => i !== E.FREE).map((i) => g.cards[pid][c][i]);

test('Karte: 5x5, Spalten B-I-N-G-O mit richtigen Bereichen, einzigartig, Mitte frei', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const card = E.makeCard(seeded(seed));
    assert.equal(card.length, 25);
    assert.equal(card[E.FREE], 0);
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
      if (i === 12) continue;
      const c = i % 5; const v = card[i];
      assert.ok(Number.isInteger(v) && v >= c * 15 + 1 && v <= c * 15 + 15, `Feld ${i}: ${v}`);
      assert.ok(!seen.has(v)); seen.add(v);
    }
    assert.equal(seen.size, 24);
  }
  assert.equal(E.letterOf(1), 'B'); assert.equal(E.letterOf(15), 'B'); assert.equal(E.letterOf(16), 'I'); assert.equal(E.letterOf(38), 'N');
  assert.equal(E.letterOf(46), 'G'); assert.equal(E.letterOf(60), 'G'); assert.equal(E.letterOf(61), 'O'); assert.equal(E.letterOf(75), 'O');
  assert.equal(E.label(38), 'N 38');
});

test('Karten sind zufällig verschieden und alle Zahlen kommen vor', () => {
  const all = new Set(); const cards = new Set();
  for (let seed = 1; seed <= 200; seed++) { const c = E.makeCard(seeded(seed)); cards.add(c.join()); c.forEach((v) => all.add(v)); }
  assert.ok(cards.size > 190);
  for (let n = 1; n <= 75; n++) assert.ok(all.has(n), 'Zahl ' + n + ' nie auf einer Karte');
});

test('createGame: Optionen, Standardwerte, eine bzw. zwei Karten, Mitte markiert, JSON-sicher', () => {
  const g = mk();
  assert.equal(g.game, 'bg'); assert.equal(g.phase, 'play'); assert.deepEqual(g.drawn, []);
  assert.equal(g.two, false); assert.equal(g.auto, false); assert.equal(g.full, false); assert.equal(g.timer, false);
  assert.equal(g.host, 'a'); assert.equal(g.round, 1);
  for (const p of g.players) {
    assert.equal(g.cards[p.id].length, 1); assert.equal(g.marks[p.id].length, 1);
    assert.equal(g.marks[p.id][0][12], 1); assert.equal(g.marks[p.id][0].filter((x) => x).length, 1);
    assert.equal(g.scores[p.id], 0);
  }
  const g2 = mk({ two: true, auto: true, full: true, timer: true });
  assert.equal(g2.cards.a.length, 2); assert.notDeepEqual(g2.cards.a[0], g2.cards.a[1]);
  assert.ok(g2.two && g2.auto && g2.full && g2.timer);
  assert.deepEqual(JSON.parse(JSON.stringify(g2)), g2);
  assert.equal(mk({}, P2.concat(Array.from({ length: 10 }, (_, i) => ({ id: 'x' + i, name: 'X' })))).players.length, 8);
  assert.equal(E.createGame(P2, null, seeded(1)).host, 'a');
  assert.equal(E.createGame(P2, { host: 'nobody' }, seeded(1)).host, 'a');
});

test('Ziehen: ohne Zurücklegen, alle 75, nur der Gastgeber, danach Fehler', () => {
  const rng = seeded(3);
  const g = mk({}, P2, 2);
  assert.equal(E.draw(g, 'b', rng).ok, false, 'Gast darf nicht ziehen');
  assert.equal(E.draw(g, 'fremd', rng).ok, false);
  assert.deepEqual(g.drawn, []);
  const seen = new Set();
  for (let i = 0; i < 75; i++) { const r = E.draw(g, 'a', rng); assert.ok(r.ok); assert.ok(r.n >= 1 && r.n <= 75); assert.ok(!seen.has(r.n)); seen.add(r.n); assert.equal(E.lastDrawn(g), r.n); }
  assert.equal(seen.size, 75);
  assert.equal(E.draw(g, 'a', rng).ok, false);
  assert.equal(g.drawn.length, 75);
  assert.equal(g.phase, 'play', 'Runde endet nicht von selbst; Markieren und BINGO gehen weiter');
});

test('Ziehen ist gleichmäßig (jede Zahl als erste, grobe Prüfung)', () => {
  const cnt = Array(76).fill(0);
  for (let s = 1; s <= 7500; s++) { const g = mk({}, P2, 7); const n = E.draw(g, 'a', seeded(s * 31)).n; cnt[n]++; }
  for (let n = 1; n <= 75; n++) assert.ok(cnt[n] > 40 && cnt[n] < 170, `Zahl ${n}: ${cnt[n]}`);
});

test('Markieren: nur gezogene Zahlen, nur eigene Karte, Mitte und doppelt ungültig', () => {
  const rng = seeded(5);
  const g = mk({}, P2, 4);
  const v = g.cards.a[0][0];
  let r = E.mark(g, 'a', 0, 0);
  assert.equal(r.ok, false); assert.equal(r.code, 'not-drawn'); assert.match(r.error, /noch nicht gezogen/);
  assert.equal(g.marks.a[0][0], 0, 'falsch angetippt markiert nicht');
  const seqBefore = g.seq;
  force(g, [v]);
  r = E.mark(g, 'a', 0, 0); assert.ok(r.ok); assert.equal(g.marks.a[0][0], 1);
  assert.ok(g.seq > seqBefore);
  r = E.mark(g, 'a', 0, 0); assert.equal(r.ok, false); assert.equal(r.code, 'again');
  assert.equal(E.mark(g, 'a', 0, 12).code, 'free');
  assert.equal(E.mark(g, 'fremd', 0, 1).ok, false);
  assert.equal(E.mark(g, 'a', 1, 1).ok, false, 'Karte 2 gibt es nicht');
  assert.equal(E.mark(g, 'a', 0, 25).ok, false); assert.equal(E.mark(g, 'a', 0, -1).ok, false);
  assert.equal(E.mark(g, 'a', 0, 1.5).ok, false); assert.equal(E.mark(g, 'a', 0, '3').ok, false);
  assert.equal(E.mark(g, 'a', 0.5, 1).ok, false); assert.equal(E.mark(g, 'a', 0, NaN).ok, false);
  // Die Zahl steht auf der Karte von b nicht automatisch markiert
  assert.ok(g.marks.b[0].filter((x) => x).length === 1);
  // gezogene Zahl auf der Karte des anderen markieren: Feld muss auf eigener Karte stehen (Index bestimmt Zahl)
  const w = g.cards.b[0][3]; force(g, [w]);
  const idxA = g.cards.a[0].indexOf(w);
  if (idxA < 0) assert.ok(E.mark(g, 'b', 0, 3).ok);
  void rng;
});

test('Markieren: ohne Karte-Angabe gilt Karte 0 (msg ohne c)', () => {
  const g = mk({}, P2, 9);
  force(g, [g.cards.a[0][4]]);
  assert.ok(E.handle(g, 'a', { t: 'mark', i: 4 }).ok);
  assert.equal(g.marks.a[0][4], 1);
});

test('Zwei Karten: jede Karte einzeln, Gewinn mit einer Karte reicht', () => {
  const g = mk({ two: true }, P2, 11);
  const line = E.LINES[0];
  force(g, rowNums(g, 'a', line, 1));
  for (const i of line) if (i !== E.FREE) assert.ok(E.mark(g, 'a', 1, i).ok);
  assert.ok(E.validMarks(g.marks.a[1], false)); assert.ok(!E.validMarks(g.marks.a[0], false));
  assert.ok(E.isValid(g, 'a'));
  const r = E.bingo(g, 'a'); assert.ok(r.ok); assert.deepEqual(g.winners, ['a']);
  // Markierungen auf beiden Karten dürfen nicht vermischt werden
  assert.equal(g.marks.a[0].filter((x) => x).length, 1);
});

test('Alle 12 Linien (5 Reihen, 5 Spalten, 2 Diagonalen) gewinnen; 11 von 12 Feldern nicht', () => {
  assert.equal(E.LINES.length, 12);
  for (let li = 0; li < 12; li++) {
    const line = E.LINES[li];
    const g = mk({}, P2, 20 + li);
    force(g, rowNums(g, 'a', line));
    const cells = line.filter((i) => i !== E.FREE);
    for (const i of cells.slice(0, -1)) assert.ok(E.mark(g, 'a', 0, i).ok);
    assert.equal(E.isValid(g, 'a'), false);
    const bad = E.bingo(g, 'a');
    assert.equal(bad.ok, false); assert.equal(bad.code, 'not-yet'); assert.match(bad.error, /Noch nicht ganz/);
    assert.equal(g.phase, 'play', 'falscher Ruf hat keine Strafe');
    assert.equal(g.scores.a, 0);
    assert.ok(E.mark(g, 'a', 0, cells[cells.length - 1]).ok);
    assert.ok(E.isValid(g, 'a'));
    assert.ok(E.bingo(g, 'a').ok);
    assert.equal(g.phase, 'over'); assert.deepEqual(g.winners, ['a']); assert.equal(g.scores.a, 1);
    assert.ok(E.winLines(g.marks.a[0], false).some((l) => l.join() === line.join()));
  }
});

test('Mitte zählt: Reihe 3 und Spalte 3 brauchen nur 4 Felder, beide Diagonalen auch', () => {
  for (const li of [2, 7, 10, 11]) {
    const g = mk({}, P2, 40 + li);
    const line = E.LINES[li];
    assert.ok(line.includes(E.FREE));
    force(g, rowNums(g, 'a', line));
    assert.equal(rowNums(g, 'a', line).length, 4);
    for (const i of line) if (i !== E.FREE) assert.ok(E.mark(g, 'a', 0, i).ok);
    assert.ok(E.bingo(g, 'a').ok);
  }
});

test('Volles Haus: eine Reihe reicht nicht, die ganze Karte schon', () => {
  const g = mk({ full: true }, P2, 6);
  const line = E.LINES[0];
  force(g, rowNums(g, 'a', line));
  for (const i of line) if (i !== E.FREE) E.mark(g, 'a', 0, i);
  assert.equal(E.isValid(g, 'a'), false);
  assert.equal(E.bingo(g, 'a').ok, false);
  assert.equal(E.missing(g, 'a'), 19, '6 von 25 markiert (Mitte + Reihe)');
  force(g, g.cards.a[0].filter((v, i) => i !== 12));
  for (let i = 0; i < 25; i++) if (i !== 12) E.mark(g, 'a', 0, i);
  assert.ok(E.isValid(g, 'a'));
  assert.ok(E.bingo(g, 'a').ok);
  assert.deepEqual(E.winLines(g.marks.a[0], true), [Array.from({ length: 25 }, (_, i) => i)]);
});

test('missing: Felder bis zum Gewinn (Reihe: kleinste Lücke über alle Linien, Volles Haus: alle offenen)', () => {
  const g = mk({}, P2, 8);
  assert.equal(E.missing(g, 'a'), 4, 'nur die Mitte markiert: Linien durch die Mitte haben 4 offene Felder');
  const line = E.LINES[0];
  force(g, rowNums(g, 'a', line));
  E.mark(g, 'a', 0, line[0]); E.mark(g, 'a', 0, line[1]);
  assert.equal(E.missing(g, 'a'), 3, 'Reihe 1: 2 von 5 markiert');
  for (const i of line.slice(2)) E.mark(g, 'a', 0, i);
  assert.equal(E.missing(g, 'a'), 0);
  assert.equal(E.missing(g, 'fremd'), 25);
  assert.equal(E.missingMarks(Array(25).fill(1), true), 0);
});

test('Gleichzeitig gültig: erste Nachricht gewinnt, alle anderen Gültigen gewinnen mit (Reihenfolge der Nachrichten)', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const g = mk({}, players, 12);
  // Alle drei bekommen dieselbe Karte, damit gleichzeitig gültig
  const card = g.cards.a[0].slice();
  for (const id of ['b', 'c']) g.cards[id] = [card.slice()];
  const line = E.LINES[6];
  force(g, line.map((i) => card[i]).filter((n) => n));
  for (const id of ['a', 'b']) for (const i of line) if (i !== 12) assert.ok(E.mark(g, id, 0, i).ok);
  // c hat nicht markiert
  assert.ok(E.bingo(g, 'b').ok);
  assert.deepEqual(g.winners, ['b', 'a'], 'Auslöser zuerst, dann die übrigen Gültigen in Spielerreihenfolge');
  assert.equal(g.winBy, 'b');
  assert.equal(g.scores.a, 1); assert.equal(g.scores.b, 1); assert.equal(g.scores.c, 0);
  // späte Nachricht von a und c: Runde ist vorbei, nichts ändert sich
  const snap = JSON.stringify(g);
  assert.equal(E.bingo(g, 'a').ok, false);
  assert.equal(E.bingo(g, 'c').ok, false);
  assert.equal(JSON.stringify(g), snap);
  assert.equal(E.mark(g, 'c', 0, 1).ok, false);
  assert.equal(E.draw(g, 'a', seeded(1)).ok, false);
});

test('Falscher Ruf: keine Strafe, merkt sich nur ein Ereignis; Person, die nicht mitspielt, wird abgelehnt', () => {
  const g = mk({}, P2, 13);
  const r = E.bingo(g, 'a');
  assert.equal(r.ok, false); assert.equal(g.phase, 'play'); assert.equal(g.evt.kind, 'nobingo'); assert.equal(g.evt.by, 'a');
  assert.equal(E.bingo(g, 'fremd').ok, false);
  assert.equal(g.scores.a, 0);
});

test('Automatisch markieren: Menschen werden beim Ziehen markiert, Computer nicht', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'bot1', name: 'C' }];
  const rng = seeded(77);
  const g = mk({ auto: true, two: true }, players, 14);
  for (let k = 0; k < 40; k++) {
    const n = E.draw(g, 'a', rng).n;
    g.cards.a.forEach((card, c) => card.forEach((v, i) => { if (v === n) assert.equal(g.marks.a[c][i], 1); }));
  }
  g.cards.a.forEach((card, c) => card.forEach((v, i) => { if (i !== 12) assert.equal(g.marks.a[c][i], g.drawn.includes(v) ? 1 : 0); }));
  assert.equal(g.marks.bot1[0].filter((x) => x).length, 1, 'Computer markiert selbst');
  // ohne auto bleibt alles unmarkiert
  const h = mk({}, players, 14);
  drawN(h, 40, rng);
  assert.equal(h.marks.a[0].filter((x) => x).length, 1);
});

test('Nächste Runde: nur Gastgeber, nur nach Rundenende, Punkte bleiben, neue Karten, Zahlen zurückgesetzt', () => {
  const rng = seeded(9);
  const g = mk({ two: true }, P2, 15);
  assert.equal(E.next(g, 'a', rng).ok, false, 'Runde läuft noch');
  const line = E.LINES[3];
  force(g, rowNums(g, 'a', line));
  for (const i of line) if (i !== 12) E.mark(g, 'a', 0, i);
  assert.ok(E.bingo(g, 'a').ok);
  const oldCards = JSON.stringify(g.cards); const gid = g.gid; const seq = g.seq;
  assert.equal(E.next(g, 'b', rng).ok, false, 'Gast darf nicht');
  assert.equal(E.next(g, 'fremd', rng).ok, false);
  assert.ok(E.handle(g, 'a', { t: 'next' }, rng).ok);
  assert.equal(g.round, 2); assert.equal(g.phase, 'play'); assert.deepEqual(g.drawn, []); assert.deepEqual(g.winners, []);
  assert.equal(g.scores.a, 1, 'Punktestand bleibt'); assert.equal(g.scores.b, 0);
  assert.notEqual(JSON.stringify(g.cards), oldCards); assert.notEqual(g.gid, gid); assert.ok(g.seq > seq);
  assert.equal(g.cards.a.length, 2); assert.equal(g.marks.a[1][12], 1);
  assert.equal(g.marks.a[0].filter((x) => x).length, 1);
  assert.equal(E.draw(g, 'a', rng).ok, true);
});

test('Ungültige Nachrichten, falsche Phase, falsche Person: Zustand bleibt unverändert', () => {
  const g = mk({}, P2, 16);
  const snap = JSON.stringify(g);
  for (const m of [null, undefined, 5, 'draw', [], {}, { t: 'x' }, { t: 'mark', i: 'a' }, { t: 'mark', c: {}, i: 1 }, { t: 'bingo', extra: 1 }, { t: 'next' }, { t: 'draw', n: 3 }]) {
    const pid = m && m.t === 'draw' ? 'b' : 'a';
    const r = E.handle(g, pid, m, seeded(1));
    if (m && m.t === 'bingo') { assert.equal(r.ok, false); continue; }
    assert.equal(r.ok, false, JSON.stringify(m));
  }
  // Die falsche Bingo-Nachricht legt ein Ereignis ab, sonst nichts
  g.seq -= 1; g.evt = null;
  assert.equal(JSON.stringify(g), snap);
  assert.equal(E.handle(null, 'a', { t: 'draw' }).ok, false);
  assert.equal(E.handle({}, 'a', { t: 'draw' }).ok, false);
  assert.equal(E.handle({ game: 'xx' }, 'a', { t: 'draw' }).ok, false);
  assert.equal(E.mark(null, 'a', 0, 1).ok, false); assert.equal(E.bingo(null, 'a').ok, false); assert.equal(E.draw(null, 'a').ok, false); assert.equal(E.next(null, 'a').ok, false);
});

test('Falsche Phase: Markieren/Ziehen/Bingo nach Rundenende, Nächste Runde während der Runde', () => {
  const g = mk({}, P2, 17);
  g.phase = 'over';
  assert.equal(E.draw(g, 'a').ok, false); assert.equal(E.mark(g, 'a', 0, 1).ok, false); assert.equal(E.bingo(g, 'a').ok, false);
  g.phase = 'play';
  assert.equal(E.next(g, 'a').ok, false);
});

test('Wertung: Siegpunkte über Runden, Rangfolge mit Gleichstand', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const rng = seeded(2);
  const g = mk({}, players, 18);
  assert.equal(E.outcome(g), null);
  g.scores = { a: 2, b: 2, c: 1 };
  let rk = E.ranking(g);
  assert.deepEqual(rk.map((r) => [r.id, r.rank]), [['a', 1], ['b', 1], ['c', 3]]);
  g.scores = { a: 0, b: 0, c: 0 };
  for (const w of ['b', 'b', 'c']) {
    const line = E.LINES[0];
    force(g, rowNums(g, w, line));
    for (const i of line) if (i !== 12) E.mark(g, w, 0, i);
    assert.ok(E.bingo(g, w).ok);
    const o = E.outcome(g); assert.deepEqual(o.winners, [w]); assert.equal(o.by, w);
    E.next(g, 'a', rng);
  }
  assert.deepEqual(g.scores, { a: 0, b: 2, c: 1 });
  rk = E.ranking(g);
  assert.deepEqual(rk.map((r) => [r.id, r.points, r.rank]), [['b', 2, 1], ['c', 1, 2], ['a', 0, 3]]);
});

test('JSON-Sicherheit über viele Aktionen', () => {
  const rng = seeded(21);
  const g = mk({ two: true, auto: false }, P2, 19);
  for (let k = 0; k < 30; k++) {
    E.draw(g, 'a', rng);
    for (const id of ['a', 'b']) for (let c = 0; c < 2; c++) for (const n of g.drawn) { const i = E.cellOf(g, id, c, n); if (i >= 0) E.mark(g, id, c, i); }
    const copy = JSON.parse(JSON.stringify(g));
    assert.deepEqual(copy, g);
    if (g.phase === 'over') break;
    E.bingo(g, 'a');
  }
});

test('250 Zufallspartien enden immer mit Sieger; Bilanzen stimmen (Zahlen, Punkte, Markierungen)', () => {
  for (let seed = 1; seed <= 250; seed++) {
    const rng = seeded(seed * 17);
    const n = 1 + (seed % 5);
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const g = E.createGame(players, { host: 'p0', two: seed % 2 === 0, full: seed % 5 === 0, auto: seed % 3 === 0 }, rng);
    let rounds = 0; let totalWins = 0; let steps = 0;
    while (rounds < 3 && steps++ < 20000) {
      assert.ok(E.draw(g, 'p0', rng).ok);
      // jeder markiert zufällig (manchmal vergisst jemand etwas), dann ruft, wer gültig ist
      for (const p of players) {
        for (let c = 0; c < g.cards[p.id].length; c++) for (const num of g.drawn) {
          const i = E.cellOf(g, p.id, c, num);
          if (i >= 0 && (rng() < 0.9 || g.drawn.length >= 75)) assert.ok(E.mark(g, p.id, c, i).ok);
        }
      }
      // Bilanz der Markierungen: nur gezogene Zahlen sind markiert
      for (const p of players) g.cards[p.id].forEach((card, c) => card.forEach((v, i) => { if (i !== 12 && g.marks[p.id][c][i]) assert.ok(g.drawn.includes(v)); }));
      assert.equal(new Set(g.drawn).size, g.drawn.length); assert.ok(g.drawn.length <= 75);
      const before = players.filter((p) => E.isValid(g, p.id)).map((p) => p.id);
      for (const p of players) {
        if (g.phase !== 'play') break;
        const r = E.bingo(g, p.id);
        assert.equal(r.ok, before.includes(p.id) || g.phase === 'over', 'Ruf wird nur bei gültiger Karte angenommen');
      }
      if (g.phase === 'over') {
        assert.ok(g.winners.length >= 1);
        for (const w of g.winners) assert.ok(E.isValid(g, w));
        for (const p of players) if (!g.winners.includes(p.id)) assert.ok(!before.includes(p.id) || false, 'Gültige gewinnen mit');
        totalWins += g.winners.length;
        assert.equal(Object.values(g.scores).reduce((a, b) => a + b, 0), totalWins);
        rounds++;
        assert.ok(E.next(g, 'p0', rng).ok);
      }
    }
    assert.equal(rounds, 3, 'Seed ' + seed);
  }
});
