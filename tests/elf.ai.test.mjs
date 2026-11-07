import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../elf/engine.js';
import { chooseAction } from '../elf/ai.js';

const seedRng = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const C = (s, r) => ({ s, r });

// Reiner Zufallsspieler: legt irgendeine erlaubte Karte
function randomAction(g, id, rng) {
  const l = M.legalCards(g, id);
  return l.length ? { t: 'play', card: l[Math.min(l.length - 1, Math.floor(rng() * l.length))] } : { t: 'pass' };
}
const act = (kind, g, id, brain) => (kind === 'rand' ? randomAction(g, id, brain) : chooseAction(g, id, kind, brain));

// Eine einzelne Runde; gibt die Strafpunkte dieser Runde je Sitz zurück
function playRound(kinds, seed) {
  const deal = seedRng(seed);
  const brain = seedRng(seed * 7 + 1);
  const g = M.createGame(kinds.map((k, i) => ({ id: 'bot' + i, name: 'B' + i })), { limit: 999 }, deal);
  let st = 0;
  while (g.phase === 'play' && st++ < 5000) {
    const ap = M.activePlayer(g);
    const msg = act(kinds[g.active], g, ap.id, brain);
    assert.ok(msg, 'Computer liefert keine Nachricht');
    const r = M.handle(g, ap.id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg));
  }
  assert.equal(g.phase, 'over');
  return g.players.map((p) => p.points);
}

// Vergleicht den Sitz "fokus" mit den anderen; die Sitze rotieren von Runde zu Runde (Startwechsel)
function compare(base, rounds, seed0) {
  const n = base.length;
  const wins = base.map(() => 0); // wie oft der Fokus (Index 0 in base) strikt weniger Punkte als Sitz j hat
  for (let i = 0; i < rounds; i++) {
    const rot = i % n;
    const kinds = base.map((_, k) => base[(k + rot) % n]);
    const pts = playRound(kinds, seed0 + i);
    const focusSeat = (0 - rot + n) % n; // wo steht base[0] jetzt?
    for (let j = 1; j < n; j++) {
      const seat = ((j - rot) % n + n) % n;
      if (pts[focusSeat] < pts[seat]) wins[j] += 1;
    }
  }
  return wins.map((w) => w / rounds);
}

test('Mittel gegen Leicht und reinen Zufall (3 Personen, 200 Runden, wechselnde Plätze)', () => {
  const q = compare([1, 0, 'rand'], 200, 1000);
  console.log('3 Personen: Mittel hat weniger Strafpunkte als Leicht in', (100 * q[1]).toFixed(1), '%, als reiner Zufall in', (100 * q[2]).toFixed(1), '%');
  assert.ok(q[1] >= 0.7, 'gegen Leicht ' + q[1]);
  assert.ok(q[2] >= 0.75, 'gegen Zufall ' + q[2]);
});

test('Mittel gegen reinen Zufall (2 Personen, 200 Runden): mindestens 90 %', () => {
  const q = compare([1, 'rand'], 200, 5000);
  console.log('2 Personen: Mittel schlägt Zufall in', (100 * q[1]).toFixed(1), '%');
  assert.ok(q[1] >= 0.9, 'Quote ' + q[1]);
});

test('Leicht gegen Zufall: Partien enden, alles gültig, etwa gleich stark', () => {
  const q = compare([0, 'rand', 'rand'], 60, 9000);
  console.log('Leicht vs Zufall (3er):', (100 * q[1]).toFixed(1), '% /', (100 * q[2]).toFixed(1), '%');
  assert.ok(q[1] > 0.3 && q[2] > 0.3 && q[1] < 0.7 && q[2] < 0.7);
});

test('Rechenzeit unter 50 ms pro Entscheidung (2 bis 6 Personen)', () => {
  // Aufwärmen
  playRound([1, 1], 1);
  let max = 0; let count = 0; let sum = 0;
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 6; seed++) {
      const deal = seedRng(seed * 13 + n);
      const g = M.createGame(Array.from({ length: n }, (_, i) => ({ id: 'bot' + i, name: 'B' + i })), { limit: 999 }, deal);
      let st = 0;
      while (g.phase === 'play' && st++ < 5000) {
        const ap = M.activePlayer(g);
        const t0 = process.hrtime.bigint();
        const msg = chooseAction(g, ap.id, 1, deal);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        max = Math.max(max, ms); sum += ms; count++;
        assert.equal(M.handle(g, ap.id, msg, deal).ok, true);
      }
    }
  }
  console.log('Rechenzeit: Höchstwert', max.toFixed(1), 'ms, Mittel', (sum / count).toFixed(2), 'ms über', count, 'Entscheidungen');
  assert.ok(max < 50, 'Höchstwert ' + max);
});

test('Der Computer schummelt nicht: Entscheidung hängt nur von eigener Hand, Tisch, Kartenzahlen und Strafpunkten ab', () => {
  for (const level of [0, 1]) {
    for (let seed = 1; seed <= 40; seed++) {
      const n = 2 + (seed % 4);
      const deal = seedRng(seed);
      const g = M.createGame(Array.from({ length: n }, (_, i) => ({ id: 'bot' + i, name: 'B' + i })), { limit: 999 }, deal);
      // ein Stück spielen
      for (let k = 0; k < (seed * 3) % 40 && g.phase === 'play'; k++) {
        const ap = M.activePlayer(g);
        M.handle(g, ap.id, chooseAction(g, ap.id, 1, deal), deal);
      }
      if (g.phase !== 'play') continue;
      const me = M.activePlayer(g).id;
      const ref = chooseAction(g, me, level, seedRng(seed + 99));
      // 1) Die Hände der anderen werden durch Wächter ersetzt: nur .length ist erlaubt
      const spy = JSON.parse(JSON.stringify(g));
      spy.players.forEach((p) => {
        if (p.id === me) return;
        const len = p.hand.length;
        p.hand = new Proxy(new Array(len).fill(0), {
          get(t, k) { if (k === 'length') return len; throw new Error('Zugriff auf fremde Hand: ' + String(k)); },
          has() { throw new Error('Zugriff auf fremde Hand'); },
          ownKeys() { throw new Error('Zugriff auf fremde Hand'); },
        });
      });
      assert.deepEqual(chooseAction(spy, me, level, seedRng(seed + 99)), ref);
      // 2) Andere Karten in den fremden Händen (gleiche Anzahl) ändern die Entscheidung nicht
      const swapped = JSON.parse(JSON.stringify(g));
      const others = swapped.players.filter((p) => p.id !== me);
      const pool = others.flatMap((p) => p.hand).reverse();
      let off = 0;
      for (const p of others) { p.hand = pool.slice(off, off + p.hand.length); off += p.hand.length; }
      assert.deepEqual(chooseAction(swapped, me, level, seedRng(seed + 99)), ref);
    }
  }
});

test('Leicht wählt zufällig unter den erlaubten Karten (auch Elfen), nie eine unerlaubte', () => {
  const g = M.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], {}, seedRng(1));
  g.rows = [{ lo: 11, hi: 11 }, null, null, null];
  g.players[0].hand = [C(0, 12), C(1, 11), C(1, 5)];
  g.active = 0; g.moves = 1;
  const rng = seedRng(7);
  const cnt = { '0-12': 0, '1-11': 0, other: 0 }; const N = 3000;
  for (let i = 0; i < N; i++) {
    const m = chooseAction(g, 'bot1', 0, rng);
    assert.equal(m.t, 'play');
    const k = m.card.s + '-' + m.card.r;
    if (k in cnt) cnt[k]++; else cnt.other++;
  }
  assert.equal(cnt.other, 0);
  assert.ok(cnt['0-12'] / N > 0.4 && cnt['0-12'] / N < 0.6, JSON.stringify(cnt));
});

test('Mittel legt immer eine erlaubte Karte, passt nur ohne Zug, sonst null', () => {
  const g = M.createGame([{ id: 'bot1', name: 'A' }, { id: 'me', name: 'B' }], {}, seedRng(1));
  g.rows = [{ lo: 10, hi: 12 }, null, null, null];
  g.moves = 1;
  g.active = 0;
  g.players[0].hand = [C(0, 20), C(2, 3)];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(2)), { t: 'pass' });
  assert.deepEqual(chooseAction(g, 'bot1', 0, seedRng(2)), { t: 'pass' });
  g.players[0].hand = [C(0, 13), C(2, 3)];
  assert.deepEqual(chooseAction(g, 'bot1', 1, seedRng(2)), { t: 'play', card: C(0, 13) });
  assert.equal(chooseAction(g, 'me', 1), null); // nicht dran
  g.phase = 'over';
  assert.equal(chooseAction(g, 'bot1', 1), null);
  assert.equal(chooseAction(null, 'bot1', 1), null);
  assert.equal(chooseAction({ game: 'mm' }, 'bot1', 1), null);
});

test('2-6 Computer (gemischt) spielen ganze Partien: alle Nachrichten gültig, alle enden', () => {
  let seed = 90000;
  for (let n = 2; n <= 6; n++) {
    for (let i = 0; i < 4; i++) {
      const kinds = Array.from({ length: n }, (_, k) => ((k + i) % 3 === 0 ? 'rand' : (k + i) % 3 === 1 ? 1 : 0));
      const deal = seedRng(seed++); const brain = seedRng(seed);
      const g = M.createGame(kinds.map((k, j) => ({ id: 'bot' + j, name: 'B' + j })), { short: true }, deal);
      let guard = 0;
      for (;;) {
        assert.ok(guard++ < 30000);
        if (g.phase === 'over') { if (g.result.gameOver) break; assert.equal(M.handle(g, g.hostId, { t: 'next' }, deal).ok, true); continue; }
        const ap = M.activePlayer(g);
        assert.equal(M.handle(g, ap.id, act(kinds[g.active], g, ap.id, brain), deal).ok, true);
      }
    }
  }
});
