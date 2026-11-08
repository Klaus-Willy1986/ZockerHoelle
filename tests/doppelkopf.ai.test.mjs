import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../doppelkopf/engine.js';
import { chooseAction, viewOf, sampleWorld, SAMPLES, BUDGET_MS, STRONG_TRUMPS, ANNOUNCE_CHANCE } from '../doppelkopf/ai.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P4 = [0, 1, 2, 3].map((i) => ({ id: 'bot' + i, name: 'B' + i }));

// Eine Runde mit gegebenen Stufen je Platz (0 Leicht, 1 Mittel); optional Zeitmessung (nur Mittel)
function playRound(kindsOrFn, seed, timing, opts = {}) {
  const deal = seedRng(seed * 7 + 1), brain = seedRng(seed * 13 + 5);
  const g = M.createGame(P4, { rounds: 99, ...opts }, deal);
  const kinds = typeof kindsOrFn === 'function' ? kindsOrFn(g) : kindsOrFn;
  let steps = 0;
  while (g.phase === 'play' && steps++ < 100) {
    const id = g.players[g.turn].id;
    const k = kinds[g.turn];
    const t0 = performance.now();
    const msg = chooseAction(g, id, k, brain);
    if (timing && k === 1) timing.push(performance.now() - t0);
    assert.ok(msg, 'Aktion erwartet');
    const r = M.handle(g, id, msg, deal);
    assert.equal(r.ok, true, JSON.stringify(msg) + ' ' + r.error);
  }
  assert.ok(g.phase === 'round_over' || g.phase === 'over', 'Runde endet');
  return { g, kinds };
}

test('Ziel: 200 Runden mit Sitzwechsel, 2 Mittel + 2 Leicht: Mittel holt deutlich mehr Spielpunkte als Leicht', () => {
  let m = 0, l = 0, wins = 0, n = 0;
  for (let i = 0; i < 200; i++) {
    const kinds = [0, 1, 2, 3].map((s) => ((s + i) % 2 ? 0 : 1)); // Plätze wechseln jede Runde
    const { g } = playRound(kinds, 1000 + i);
    g.players.forEach((p, s) => { if (kinds[s] === 1) m += g.result.delta[p.id]; else l += g.result.delta[p.id]; });
    n++;
  }
  void wins;
  const share = (m - l) / (Math.abs(m) + Math.abs(l));
  console.log(`200 Runden (2 Mittel + 2 Leicht): Punkte Mittel ${m}, Leicht ${l}, Vorsprung ${(100 * share).toFixed(0)} % des Umsatzes, pro Runde und Platz Mittel ${(m / n / 2).toFixed(2)}`);
  assert.equal(m + l, 0, 'Nullsumme');
  assert.ok(m > l, 'Mittel > Leicht');
  assert.ok(share >= 0.2, 'Vorsprung ' + share);
});

test('Ziel: Mittel-Team (2 Mittel) schlägt das Leicht-Team in mindestens 60 % der Runden (je 100 Runden als Re und als Kontra)', () => {
  const res = { re: { n: 0, w: 0, pts: 0 }, kontra: { n: 0, w: 0, pts: 0 } };
  let seed = 5000;
  for (const side of ['re', 'kontra']) {
    while (res[side].n < 100) {
      seed++;
      // gemischte Teams: das Mittel-Team ist genau eine Seite (Hochzeit ausgenommen, dort gäbe es kein Zweierteam)
      const probe = M.createGame(P4, { rounds: 99 }, seedRng(seed * 7 + 1));
      if (probe.wedding) continue;
      const { g } = playRound((g0) => g0.team.map((t) => (t === side ? 1 : 0)), seed);
      res[side].n++;
      if (g.result.winner === side) res[side].w++;
      res[side].pts += g.result.delta[g.players.find((p, i) => g.team[i] === side).id];
    }
  }
  const rate = (res.re.w + res.kontra.w) / 200;
  console.log(`Mittel-Team gegen Leicht-Team: als Re ${res.re.w}/100, als Kontra ${res.kontra.w}/100, zusammen ${(100 * rate).toFixed(1)} % (Ziel 65 %), Punkte je Mittel-Person: Re ${res.re.pts}, Kontra ${res.kontra.pts}`);
  assert.ok(rate >= 0.6, 'Gewinnquote ' + rate);
  assert.ok(res.re.pts > 0 && res.kontra.pts > 0, 'Punkte positiv');
});

test('Rechenzeit pro Entscheidung (Mittel): Durchschnitt und Spitze unter 250 ms', () => {
  const times = [];
  for (let i = 0; i < 40; i++) playRound([1, 1, 1, 1], 7000 + i, times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  console.log(`Rechenzeit Mittel: Ø ${avg.toFixed(1)} ms, Spitze ${max.toFixed(1)} ms bei ${times.length} Entscheidungen (Verteilungen ${SAMPLES}, Budget ${BUDGET_MS} ms)`);
  assert.ok(avg < 100, 'Durchschnitt ' + avg);
  assert.ok(max < 250, 'Spitze ' + max);
});

test('Zeitbudget: sehr kleines Budget bricht die Verteilungen ab, Antwort bleibt gültig', () => {
  const g = M.createGame(P4, { rounds: 9 }, seedRng(3));
  const id = g.players[g.turn].id;
  const t0 = performance.now();
  const m = chooseAction(g, id, 1, seedRng(1), { budgetMs: 0, samples: 5000 });
  assert.ok(performance.now() - t0 < 100);
  assert.ok(m.t === 'play' || m.t === 'announce');
  const m2 = m.t === 'announce' ? { t: 'play', card: chooseAction(g, id, 0, seedRng(2)).card } : m;
  assert.equal(M.handle(g, id, m2).ok, true);
});

// ---------- Ehrlichkeit: fremde Hände und fremde Teams werden nie gelesen ----------
function midGame(seed, plays) {
  const rng = seedRng(seed);
  const g = M.createGame(P4, { rounds: 9, wedding: seed % 5 !== 0 }, rng);
  for (let i = 0; i < plays && g.phase === 'play'; i++) {
    const id = g.players[g.turn].id; const l = M.legalCards(g, id);
    if (rng() < 0.1) { const c = M.canAnnounce(g, id); if (c) M.handle(g, id, { t: 'announce', what: c }); }
    M.handle(g, id, { t: 'play', card: l[Math.floor(rng() * l.length)] });
  }
  return g;
}
function mutations(g, me, rng) {
  const out = [];
  const others = [0, 1, 2, 3].filter((i) => i !== me);
  // 1) fremde Hände neu mischen (gleiche Größen, gleiche Karten) – auch gegen Bedienpflicht-Hinweise
  { const c = JSON.parse(JSON.stringify(g)); const pool = others.flatMap((i) => c.players[i].hand); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } let k = 0; for (const i of others) { const n = c.players[i].hand.length; c.players[i].hand = pool.slice(k, k + n); k += n; } out.push(c); }
  // 2) fremde Hände vertauschen
  { const c = JSON.parse(JSON.stringify(g)); const [a, b] = others; [c.players[a].hand, c.players[b].hand] = [c.players[b].hand.slice(0, c.players[b].hand.length), c.players[a].hand]; if (c.players[a].hand.length === c.players[b].hand.length) out.push(c); }
  // 3) fremde Teams verändern (wahre Teams der anderen sind verdeckt)
  { const c = JSON.parse(JSON.stringify(g)); for (const i of others) c.team[i] = rng() < 0.5 ? 're' : 'kontra'; out.push(c); }
  { const c = JSON.parse(JSON.stringify(g)); for (const i of others) c.team[i] = c.team[i] === 're' ? 'kontra' : 're'; out.push(c); }
  return out;
}

test('KI nutzt keine fremden Hände/Teams: veränderte verdeckte Daten -> identische Entscheidung', () => {
  let checked = 0; const diff = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const g = midGame(seed, (seed * 5) % 44);
    if (g.phase !== 'play') continue;
    const me = g.turn; const id = g.players[me].id;
    // die Teams ohne Hochzeit sind aus der eigenen Hand ableitbar; bei Mutation von Team-Daten anderer bleibt das eigene Team gleich
    const base = chooseAction(g, id, 1, seedRng(seed + 1000), { budgetMs: Infinity });
    diff.add(JSON.stringify(base));
    for (const m of mutations(g, me, seedRng(seed))) {
      const alt = chooseAction(m, id, 1, seedRng(seed + 1000), { budgetMs: Infinity });
      assert.deepEqual(alt, base, `Seed ${seed}: Entscheidung hängt von verdeckten Daten ab`);
      checked++;
    }
  }
  assert.ok(checked >= 120, 'geprüfte Zustände ' + checked);
  assert.ok(diff.size > 8, 'Entscheidungen variieren sinnvoll');
  console.log('Fremde Hände/Teams verändert, Entscheidung identisch:', checked, 'Fälle');
});

test('Sicht der KI: eigene Hand + Öffentliches; unbekannte Karten = genau die Karten der anderen', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = midGame(seed, (seed * 3) % 40);
    if (g.phase !== 'play') continue;
    const me = g.turn;
    const v = viewOf(g, g.players[me].id);
    assert.deepEqual(v.hand, g.players[me].hand);
    const others = [0, 1, 2, 3].filter((i) => i !== me).flatMap((i) => g.players[i].hand).sort((a, b) => a - b);
    assert.deepEqual(v.unknown.slice().sort((a, b) => a - b), others);
    assert.deepEqual(v.sizes, g.players.map((p) => p.hand.length));
    assert.ok(!('players' in v) && !('team' in v), 'keine rohen Spielerdaten in der Sicht');
    assert.equal(v.myTeam, g.team[me]);
  }
});

test('Verteilungen passen zu den Hinweisen: Größen, Farbverzicht, Kreuz-Damen (Hochzeit, Re/Kontra bekannt, nie zwei bei einer Person)', () => {
  let worlds = 0, kdChecks = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const g = midGame(seed, (seed * 7) % 40);
    if (g.phase !== 'play') continue;
    const me = g.turn;
    const v = viewOf(g, g.players[me].id);
    const rng = seedRng(seed * 3);
    for (let k = 0; k < 6; k++) {
      const w = sampleWorld(v, rng);
      worlds++;
      const all = [];
      for (let p = 0; p < 4; p++) {
        assert.equal(w.hands[p].length, g.players[p].hand.length, 'Handgröße');
        all.push(...w.hands[p]);
      }
      assert.deepEqual(w.hands[me], g.players[me].hand);
      assert.equal(new Set(all).size, all.length, 'keine Karte doppelt');
      assert.deepEqual(all.sort((a, b) => a - b), g.players.flatMap((p) => p.hand).sort((a, b) => a - b), 'dieselbe Kartenmenge');
            // Kreuz-Damen
      const kdHolders = [0, 1, 2, 3].filter((p) => w.hands[p].some(M.isKreuzDame));
      const perHand = w.hands.map((h) => h.filter(M.isKreuzDame).length);
      if (!g.wedding) { assert.ok(perHand.every((n) => n <= 1), 'ohne Hochzeit nie zwei Kreuz-Damen bei einer Person'); kdChecks++; }
      else if (g.wedding.player !== me) { for (const p of kdHolders) if (p !== g.wedding.player) assert.fail('Kreuz-Dame bei Nicht-Hochzeitsperson'); }
      for (let p = 0; p < 4; p++) if (p !== me && !g.wedding && v.known[p] === 'kontra') assert.equal(perHand[p], 0, 'bekannt Kontra: keine Kreuz-Dame');
      for (let p = 0; p < 4; p++) if (p !== me && !g.wedding && v.known[p] === 're' && v.kdPlayed[p] === 0) assert.ok(perHand[p] >= 1, 'bekannt Re ohne gespielte Kreuz-Dame: hat eine');
    }
  }
  // Farbverzicht wird eingehalten (hart, wo es möglich ist)
  let violated = 0, total = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const g = midGame(seed, 20 + (seed % 18));
    if (g.phase !== 'play') continue;
    const me = g.turn; const v = viewOf(g, g.players[me].id); const rng = seedRng(seed);
    for (let k = 0; k < 5; k++) { const w = sampleWorld(v, rng); for (let p = 0; p < 4; p++) if (p !== me) for (const grp of v.voids[p]) { total++; if (w.hands[p].some((c) => M.groupOf(c) === grp)) violated++; } }
  }
  console.log(`Verteilungen geprüft: ${worlds}, Kreuz-Damen-Prüfungen ${kdChecks}, Farbverzicht verletzt ${violated} von ${total}`);
  assert.ok(worlds > 200);
  assert.ok(total === 0 || violated / total < 0.05, 'Farbverzicht meist eingehalten');
});

// ---------- Verhalten ----------
test('Leicht: zufällige erlaubte Karte, streut, sagt nie an', () => {
  const g = M.createGame(P4, { rounds: 9, dealer: 3 }, seedRng(2));
  const id = g.players[g.turn].id;
  const seen = new Set(); const rng = seedRng(5);
  for (let i = 0; i < 300; i++) { const m = chooseAction(g, id, 0, rng); assert.equal(m.t, 'play'); assert.ok(M.legalCards(g, id).includes(m.card)); seen.add(m.card); }
  assert.ok(seen.size >= 8, 'Leicht streut: ' + seen.size);
});

test('Mittel: Bedienpflicht immer beachtet; null, wenn nicht dran oder Runde vorbei', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = midGame(seed, (seed * 3) % 44);
    if (g.phase !== 'play') continue;
    const id = g.players[g.turn].id;
    for (const lv of [0, 1]) { const m = chooseAction(g, id, lv, seedRng(seed)); assert.ok(m.t === 'announce' || M.legalCards(g, id).includes(m.card)); }
    assert.equal(chooseAction(g, g.players[(g.turn + 1) % 4].id, 1, seedRng(1)), null, 'nicht dran');
  }
  const { g } = playRound([1, 1, 1, 1], 3);
  assert.equal(chooseAction(g, 'bot0', 1), null);
  assert.equal(chooseAction(null, 'bot0', 1), null);
  assert.equal(chooseAction({ game: 'mm' }, 'bot0', 1), null);
  assert.equal(chooseAction(M.createGame(P4, {}, seedRng(1)), 'unbekannt', 1), null);
});

test('Ansagen: Mittel sagt bei starker Hand (>= 6 Trümpfe) in etwa 40 % der Fälle an, sonst nie; Leicht nie', () => {
  const C = (s, r, c = 0) => (s * 6 + r) * 2 + c;
  const mk = (hand) => { const g = M.createGame(P4, { rounds: 9, dealer: 3 }, seedRng(1)); const rest = []; for (let i = 0; i < 48; i++) if (!hand.includes(i)) rest.push(i); const hands = [hand, rest.slice(0, 12), rest.slice(12, 24), rest.slice(24, 36)]; M.dealHands(g, hands); return g; };
  // starke Hand: 6 Trümpfe inkl. Kreuz-Dame/Dulle
  const strong = mk([C(2, 1, 0), C(0, 3, 0), C(1, 3, 0), C(0, 2, 0), C(1, 2, 0), C(3, 5, 0), C(0, 5, 0), C(0, 4, 0), C(1, 5, 0), C(1, 4, 0), C(2, 5, 0), C(2, 4, 0)]);
  assert.ok(strong.players[0].hand.filter(M.isTrump).length >= STRONG_TRUMPS);
  assert.equal(M.canAnnounce(strong, 'bot0'), 're');
  let n = 0; const rng = seedRng(12);
  for (let i = 0; i < 2000; i++) { const m = chooseAction(strong, 'bot0', 1, rng); if (m.t === 'announce') { assert.equal(m.what, 're'); n++; } }
  console.log('Ansage bei starker Hand:', (n / 20).toFixed(1), '% (Ziel 40 %)');
  assert.ok(Math.abs(n / 2000 - ANNOUNCE_CHANCE) < 0.05);
  for (let i = 0; i < 200; i++) assert.equal(chooseAction(strong, 'bot0', 0, rng).t, 'play', 'Leicht sagt nie an');
  // schwache Hand: nie
  const weak = mk([C(0, 5, 0), C(0, 5, 1), C(1, 5, 0), C(1, 5, 1), C(2, 5, 0), C(2, 4, 0), C(2, 0, 0), C(0, 4, 0), C(0, 1, 0), C(1, 4, 0), C(1, 1, 0), C(0, 3, 0)]);
  assert.ok(weak.players[0].hand.filter(M.isTrump).length < STRONG_TRUMPS);
  for (let i = 0; i < 300; i++) assert.equal(chooseAction(weak, 'bot0', 1, rng).t, 'play');
  // nach der Ansage / nach der ersten Karte keine zweite
  M.handle(strong, 'bot0', { t: 'announce', what: 're' });
  for (let i = 0; i < 200; i++) assert.equal(chooseAction(strong, 'bot0', 1, rng).t, 'play');
});

test('Mittel gegen Mittel endet immer; Hochzeiten, Ansagen und alle Spielwerte gültig (80 Runden)', () => {
  let ann = 0, wed = 0;
  for (let i = 0; i < 80; i++) {
    const { g } = playRound([1, 1, 1, 1], 9000 + i);
    assert.equal(g.players.reduce((s, p) => s + p.points, 0), 240);
    assert.equal(Object.values(g.result.delta).reduce((a, b) => a + b, 0), 0);
    if (g.announced.re !== null || g.announced.kontra !== null) ann++;
    if (g.wedding) wed++;
  }
  console.log(`Mittel gegen Mittel: ${ann} von 80 Runden mit Ansage, ${wed} Hochzeiten`);
  assert.ok(ann > 5);
});
