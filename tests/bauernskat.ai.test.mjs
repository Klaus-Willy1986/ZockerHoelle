import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../bauernskat/engine.js';
import { chooseAction, viewOf, SAMPLES, BUDGET_MS } from '../bauernskat/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P2 = [{ id: 'bot0', name: 'A' }, { id: 'bot1', name: 'B' }];

// Zufallsspieler: gleichverteilt unter allen erlaubten Nachrichten (auch Trumpf)
function randomAction(g, id, rng) {
  if (g.phase === 'trump') return { t: 'trump', suit: [0, 1, 2, 3, 'grand'][Math.floor(rng() * 5)] };
  const legal = M.legalCols(g, id);
  return { t: 'play', col: legal[Math.floor(rng() * legal.length)] };
}

// kinds: 0 = Leicht, 1 = Mittel, 'rand' = Zufall. Eine Runde bis zum Ende. Rückgabe: Zustand.
function playRound(kinds, seed, timing) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(P2, { target: 99 }, deal);
  let steps = 0;
  while ((g.phase === 'trump' || g.phase === 'play') && steps++ < 100) {
    const id = g.players[g.turn].id;
    const k = kinds[g.turn];
    let msg;
    if (k === 'rand') msg = randomAction(g, id, brain);
    else {
      const t0 = performance.now();
      msg = chooseAction(g, id, k, brain);
      if (timing && k === 1) timing.push(performance.now() - t0);
    }
    assert.ok(msg, 'Aktion erwartet');
    const r = M.handle(g, id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.ok(g.phase === 'round_over' || g.phase === 'over', 'Runde endet');
  return g;
}

// 200 Runden, Startplätze wechseln; Anteil gewonnener Runden von Typ a (Unentschieden zählen nicht als Sieg)
function duel(a, b, N, seed0, timing) {
  let wa = 0, draws = 0;
  for (let i = 0; i < N; i++) {
    const kinds = i % 2 ? [b, a] : [a, b];
    const g = playRound(kinds, seed0 + i, timing);
    if (!g.result.winner) { draws++; continue; }
    if (kinds[g.players.findIndex((p) => p.id === g.result.winner)] === a) wa++;
  }
  return { rate: wa / N, draws };
}

test('Mittel gewinnt >= 75 % gegen Leicht (200 Runden, Startwechsel)', () => {
  const r = duel(1, 0, 200, 1);
  console.log('Mittel vs Leicht:', (100 * r.rate).toFixed(1) + ' %', 'Unentschieden', r.draws);
  assert.ok(r.rate >= 0.75, 'Quote ' + r.rate);
});

test('Mittel gewinnt >= 90 % gegen einen reinen Zufallsspieler (200 Runden, Startwechsel)', () => {
  const r = duel(1, 'rand', 200, 10000);
  console.log('Mittel vs Zufall:', (100 * r.rate).toFixed(1) + ' %', 'Unentschieden', r.draws);
  assert.ok(r.rate >= 0.9, 'Quote ' + r.rate);
});

test('Leicht schlägt den Zufall nicht schlechter als etwa gleichauf, alles gültig', () => {
  const r = duel(0, 'rand', 200, 30000);
  console.log('Leicht vs Zufall:', (100 * r.rate).toFixed(1) + ' %');
  assert.ok(r.rate > 0.4);
});

test('Rechenzeit pro Entscheidung (Mittel): Durchschnitt und Spitze', () => {
  const times = [];
  duel(1, 'rand', 60, 50000, times);
  duel(1, 1, 20, 51000, times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  console.log(`Rechenzeit Mittel: Ø ${avg.toFixed(1)} ms, Spitze ${max.toFixed(1)} ms bei ${times.length} Entscheidungen (Stichproben ${SAMPLES}, Budget ${BUDGET_MS} ms)`);
  assert.ok(avg < 100, 'Durchschnitt ' + avg);
  assert.ok(max < 250, 'Spitze ' + max);
});

test('Zeitbudget: sehr kleines Budget bricht die Stichproben ab, Antwort bleibt gültig', () => {
  const g = M.createGame(P2, {}, seedRng(3));
  const id = g.players[g.turn].id;
  const m = chooseAction(g, id, 1, seedRng(1), { budgetMs: 0, samples: 5000 });
  assert.equal(m.t, 'trump');
  assert.equal(M.handle(g, id, m).ok, true);
  const t0 = performance.now();
  const p = chooseAction(g, g.players[g.turn].id, 1, seedRng(1), { budgetMs: 0, samples: 5000 });
  assert.ok(performance.now() - t0 < 100);
  assert.equal(p.t, 'play');
  assert.ok(M.legalCols(g, g.players[g.turn].id).includes(p.col));
});

// ---------- Ehrlichkeit: verdeckte Karten werden nie gelesen ----------
function midGame(seed, plays) {
  const rng = seedRng(seed);
  const g = M.createGame(P2, { target: 99 }, rng);
  if (plays >= 0) M.handle(g, g.players[g.turn].id, { t: 'trump', suit: Math.floor(rng() * 5) === 4 ? 'grand' : Math.floor(rng() * 4) });
  for (let i = 0; i < plays && g.phase === 'play'; i++) {
    const id = g.players[g.turn].id; const l = M.legalCols(g, id);
    M.handle(g, id, { t: 'play', col: l[Math.floor(rng() * l.length)] });
  }
  return g;
}
const hiddenSlots = (g) => g.players.flatMap((p, pi) => p.cols.map((c, k) => [pi, k]).filter(([, k]) => p.cols[k].down !== null));

function mutations(g, rng) {
  const out = [];
  const slots = hiddenSlots(g);
  // 1) alle verdeckten Karten untereinander mischen (andere Verteilung, gleiche Karten)
  { const c = JSON.parse(JSON.stringify(g)); const vals = slots.map(([p, k]) => c.players[p].cols[k].down); for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; } slots.forEach(([p, k], i) => { c.players[p].cols[k].down = vals[i]; }); out.push(c); }
  // 2) die verdeckten Karten beider Seiten spaltenweise tauschen (nur wo beide eine haben)
  { const c = JSON.parse(JSON.stringify(g)); for (let k = 0; k < 8; k++) { const a = c.players[0].cols[k].down, b = c.players[1].cols[k].down; if (a === null || b === null) continue; c.players[0].cols[k].down = b; c.players[1].cols[k].down = a; } out.push(c); }
  // 3) Unsinn: überall dieselbe Karte bzw. 0 (nur „liegt dort etwas“ darf zählen)
  { const c = JSON.parse(JSON.stringify(g)); slots.forEach(([p, k]) => { c.players[p].cols[k].down = 0; }); out.push(c); }
  { const c = JSON.parse(JSON.stringify(g)); slots.forEach(([p, k]) => { c.players[p].cols[k].down = 31; }); out.push(c); }
  return out;
}

test('KI nutzt keine verdeckten Karten: veränderte verdeckte Karten (eigene und fremde) -> identische Entscheidung', () => {
  let checked = 0, differentOpen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const g = midGame(seed, seed % 12 === 0 ? -1 : seed % 12);
    if (g.phase !== 'trump' && g.phase !== 'play') continue;
    const id = g.players[g.turn].id;
    const base = chooseAction(g, id, 1, seedRng(seed + 1000), { budgetMs: Infinity });
    differentOpen.add(JSON.stringify(base));
    for (const m of mutations(g, seedRng(seed))) {
      const alt = chooseAction(m, id, 1, seedRng(seed + 1000), { budgetMs: Infinity });
      assert.deepEqual(alt, base, `Seed ${seed}: Entscheidung hängt von verdeckten Karten ab`);
      checked++;
    }
  }
  assert.ok(checked >= 150, 'geprüfte Zustände ' + checked);
  assert.ok(differentOpen.size > 5, 'Entscheidungen variieren sinnvoll');
  console.log('Verdeckte Karten verändert, Entscheidung identisch:', checked, 'Fälle');
});

test('Sicht der KI enthält von verdeckten Plätzen nur „liegt dort eine Karte?“', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = midGame(seed, seed % 10);
    const v = viewOf(g, 'bot0');
    const slots = hiddenSlots(g).length;
    assert.equal(v.unknown.length, slots, 'unbekannte Karten = verdeckte Plätze');
    assert.deepEqual(v.hid, g.players.map((p) => p.cols.map((c) => c.down !== null)));
    // unbekannt = nichts davon ist offen, gewonnen oder im Stich
    const seen = new Set([...g.players.flatMap((p) => p.cols.map((c) => c.up).filter((x) => x !== null)), ...g.players.flatMap((p) => p.won), ...g.trick.cards.map((t) => t.card)]);
    for (const c of v.unknown) assert.ok(!seen.has(c));
    assert.equal(seen.size + v.unknown.length, 32);
  }
});

test('KI-Antwort hängt von den offenen Karten ab (nicht konstant)', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) { const g = midGame(seed, 4); if (g.phase !== 'play') continue; seen.add(chooseAction(g, g.players[g.turn].id, 1, seedRng(1)).col); }
  assert.ok(seen.size >= 3);
});

// ---------- Verhalten ----------
test('Leicht: Trumpf = Farbe mit den meisten eigenen offenen Karten, Spielzug immer erlaubt und zufällig', () => {
  const g = M.createGame(P2, {}, seedRng(2), 'bot0');
  g.dealer = 1; g.leader = 0; g.turn = 0;
  const C = (s, r) => s * 8 + r;
  const ups = [C(2, 0), C(2, 1), C(2, 5), C(0, 3), C(0, 7), C(1, 2), C(3, 6), C(1, 0)];
  g.players[0].cols.forEach((c, k) => { c.up = ups[k]; });
  for (let i = 0; i < 20; i++) assert.deepEqual(chooseAction(g, 'bot0', 0, seedRng(i)), { t: 'trump', suit: 2 });
  // Buben zählen nicht zu den Farben
  g.players[0].cols.forEach((c, k) => { c.up = [C(0, 4), C(0, 4 + 0), C(1, 4), C(1, 0), C(1, 1), C(0, 1), C(2, 4), C(3, 4)][k]; });
  assert.equal(chooseAction(g, 'bot0', 0, seedRng(1)).suit, 1);
  M.handle(g, 'bot0', { t: 'trump', suit: 1 });
  const cols = new Set();
  const rng = seedRng(5);
  for (let i = 0; i < 200; i++) { const m = chooseAction(g, 'bot0', 0, rng); assert.equal(m.t, 'play'); assert.ok(M.legalCols(g, 'bot0').includes(m.col)); cols.add(m.col); }
  assert.ok(cols.size >= 6, 'Leicht streut: ' + cols.size);
});

test('Bedienpflicht in jeder KI-Entscheidung beachtet; null, wenn nicht dran oder Runde vorbei', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = midGame(seed, seed % 14);
    if (g.phase !== 'play') continue;
    const id = g.players[g.turn].id;
    for (const lv of [0, 1]) assert.ok(M.legalCols(g, id).includes(chooseAction(g, id, lv, seedRng(seed)).col));
    assert.equal(chooseAction(g, g.players[1 - g.turn].id, 1, seedRng(1)), null, 'nicht dran');
  }
  const g = playRound([1, 1], 4);
  assert.equal(chooseAction(g, 'bot0', 1), null);
  assert.equal(chooseAction(g, 'bot1', 0), null);
  assert.equal(chooseAction(null, 'bot0', 1), null);
  assert.equal(chooseAction({ game: 'mm' }, 'bot0', 1), null);
  assert.equal(chooseAction(M.createGame(P2, {}, seedRng(1)), 'unbekannt', 1), null);
});

test('Mittel wählt als Vorhand einen gültigen Trumpf; alle Optionen kommen im Lauf vor; Mittel gegen Mittel endet immer', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 150; seed++) {
    const g = M.createGame(P2, {}, seedRng(seed));
    const id = g.players[g.turn].id;
    const m = chooseAction(g, id, 1, seedRng(seed));
    assert.equal(m.t, 'trump');
    assert.equal(M.handle(g, id, m).ok, true);
    seen.add(m.suit);
  }
  console.log('Mittel wählte Trumpf:', [...seen].join(','));
  assert.ok(seen.size >= 4);
  for (let i = 0; i < 20; i++) playRound([1, 1], 70000 + i);
});
