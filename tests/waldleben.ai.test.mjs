import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../waldleben/engine.js';
import { chooseAction } from '../waldleben/ai.js';

const seedRng = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

function playGame(levels, seed, opts = {}, hook = null, onMsg = null) {
  const deal = seedRng(seed);
  const brain = seedRng(seed * 7 + 1);
  const g = M.createGame(levels.map((l, i) => ({ id: 'bot' + i, name: 'B' + i })), opts, deal);
  let st = 0; let maxMs = 0;
  while (g.phase === 'play') {
    assert.ok(st++ < 4000, 'Endlosspiel');
    const ap = M.activePlayer(g);
    if (hook) hook(g, ap, levels[g.active], seed, st);
    const t0 = performance.now();
    const msg = chooseAction(g, ap.id, levels[g.active], brain);
    maxMs = Math.max(maxMs, performance.now() - t0);
    assert.ok(msg, 'Computer liefert keine Nachricht');
    if (onMsg) onMsg(msg);
    const r = M.handle(g, ap.id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  return { g, maxMs, pts: g.players.map((p) => M.score(g, p).total) };
}

for (const n of [2, 3, 4, 5]) {
  test(`Mittel schlägt Leicht deutlich (${n} Personen, 100 Partien)`, () => {
    let wins = 0; let pm = 0; let pl = 0; let maxMs = 0;
    for (let s = 1; s <= 100; s++) {
      const rot = s % n;
      const lv = Array.from({ length: n }, (_, k) => ((k + rot) % n === 0 ? 1 : 0));
      const r = playGame(lv, s * 31 + n);
      maxMs = Math.max(maxMs, r.maxMs);
      const mi = lv.indexOf(1);
      const others = r.pts.filter((_, i) => i !== mi);
      if (r.pts[mi] > Math.max(...others)) wins++;
      pm += r.pts[mi]; pl += others.reduce((a, b) => a + b, 0) / others.length;
    }
    console.log(`# n=${n}: Mittel gewinnt ${wins}/100, Ø ${(pm / 100).toFixed(1)} gegen Ø ${(pl / 100).toFixed(1)} Punkte, längste Rechenzeit ${maxMs.toFixed(1)} ms`);
    assert.ok(wins >= 85, `nur ${wins} Siege`);
    assert.ok(pm > pl * 1.5);
    assert.ok(maxMs < 150, `Rechenzeit ${maxMs}`);
  });
}

test('Leicht und Mittel spielen immer gültige Züge (Kurzspiel, kleine Stapel, 200 Partien)', () => {
  for (let s = 1; s <= 200; s++) {
    const n = 2 + (s % 4);
    const lv = Array.from({ length: n }, (_, k) => (s + k) % 2);
    const r = playGame(lv, s + 500, s % 3 === 0 ? { short: true } : s % 3 === 1 ? { deck: 40 } : {});
    assert.equal(r.g.phase, 'over');
    assert.equal(M.totalCards(r.g), M.deckTotal(r.g));
  }
});

test('Leicht legt auch Karten an und spielt nicht nur Ziehen', () => {
  let lives = 0; let trees = 0; let draws = 0; let sprouts = 0;
  for (let s = 1; s <= 20; s++) {
    playGame([0, 0], s, {}, null, (m) => { if (m.t === 'life') lives++; else if (m.t === 'tree') trees++; else if (m.t === 'draw') draws++; else sprouts++; });
  }
  console.log(`# Leicht: ${lives} angelegt, ${trees} Bäume, ${sprouts} Sprösslinge, ${draws} Karten gezogen`);
  assert.ok(lives > 100 && trees > 50 && draws > 100, `${lives}/${trees}/${draws}`);
});

test('Falsche Person oder beendetes Spiel: keine Nachricht', () => {
  const g = M.createGame([{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }], {}, seedRng(1));
  assert.equal(chooseAction(g, 'bot1', 1, seedRng(2)), null);
  assert.equal(chooseAction(null, 'bot0', 1, seedRng(2)), null);
  assert.equal(chooseAction({ game: 'x' }, 'bot0', 1, seedRng(2)), null);
  g.phase = 'over';
  assert.equal(chooseAction(g, 'bot0', 1, seedRng(2)), null);
});

// Der Computer darf verdeckte Dinge nicht nutzen: Stapelreihenfolge, fremde Hände, fremde Höhlen, Ablage, Sprösslinge.
test('KI schummelt nicht: verändertes verdecktes Wissen ändert die Entscheidung nicht', () => {
  let checked = 0;
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let s = 1; s <= 25; s++) {
    for (const level of [0, 1]) {
      playGame([level, level, level], s * 3 + level, {}, (g, ap, lv, seed, st) => {
        if (st % 3 !== 0) return;
        const alt = JSON.parse(JSON.stringify(g));
        const r = seedRng(s * 99 + st);
        // Stapel: andere Reihenfolge (Winterkarten bleiben im Stapel)
        shuffle(alt.deck, r);
        shuffle(alt.discard, r);
        // fremde Hände: durch andere Karten ersetzen (gleiche Anzahl)
        const pool = alt.deck.slice();
        for (const p of alt.players) {
          if (p.id === ap.id) continue;
          p.hand = p.hand.map(() => pool[Math.floor(r() * pool.length)]);
          p.cave = p.cave.map(() => pool[Math.floor(r() * pool.length)]);
          for (const t of p.trees) if (t.sp === -1) t.id = -1;
        }
        const a = chooseAction(g, ap.id, lv, seedRng(seed + st));
        const b = chooseAction(alt, ap.id, lv, seedRng(seed + st));
        assert.deepEqual(b, a, `Entscheidung hängt von verdecktem Wissen ab (Stufe ${lv}, seed ${seed}, Zug ${st})`);
        checked++;
      });
    }
  }
  assert.ok(checked > 400, 'Prüfungen: ' + checked);
  console.log('# Schummel-Prüfungen:', checked);
});
