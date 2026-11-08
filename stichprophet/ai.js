// Stichprophet – Computergegner (reine Funktionen, keine Oberfläche). Stufen: 0 = Leicht, 1 = Mittel.
//
// Leicht: sagt nach einer groben Zählung an (Zauberer, hohe Trümpfe, Asse) mit kleiner Zufallsabweichung
//   und spielt grob regelkonform: eine zufällige erlaubte Karte, bei erreichter Ansage bevorzugt niedrige Karten.
// Mittel: Determinisierung (Monte-Carlo). Die KI kennt nur, was auch ein Mensch weiß: die eigene Hand, alle bereits
//   gespielten Karten, die Aufdeckkarte, den Trumpf und die Ansagen. Die unbekannten Karten verteilt sie ~100-mal
//   zufällig auf die anderen Personen (die Handgrößen sind ja bekannt) und spielt jede Probe bis zum Rundenende durch.
//   - Ansage: je Probe wird ein „alle wollen Stiche“- und ein „alle weichen aus“-Durchgang gespielt; daraus ergibt sich
//     der Bereich, in dem die eigene Stichzahl steuerbar ist. Gewählt wird die Ansage mit dem besten Erwartungswert.
//   - Spielen: je erlaubter Karte wird der Rest der Runde gespielt (alle Personen mit ihrer bekannten Ansage:
//     Stiche holen, solange noch einer fehlt, danach ausweichen); gewählt wird die Karte mit den meisten Punkten.
// Ehrlichkeit: Die KI arbeitet nur auf viewOf() – fremde Hände kommen darin nur als Kartenanzahl vor.
//   (Test: tests/stichprophet.ai.test.mjs)
import * as M from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const SAMPLES = 100;
export const BUDGET_MS = 100; // Rechenzeit pro Entscheidung (ein Zeitbudget bricht die Proben ab)
const MIN_SAMPLES = 6;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------- Sicht: nur Erlaubtes ----------
export function viewOf(g, pid) {
  const me = g.players.findIndex((p) => p.id === pid);
  const n = g.players.length;
  const known = new Set(g.players[me].hand);
  for (const c of g.played) known.add(c);
  for (const t of g.trick.cards) known.add(t.card);
  if (g.upcard !== null) known.add(g.upcard);
  const unknown = [];
  for (let c = 0; c < M.NUM_CARDS; c++) if (!known.has(c)) unknown.push(c);
  return {
    me, n, dealer: g.dealer, round: g.round, trump: M.trumpSuit(g), trumpNone: g.trump === 'none',
    hand: g.players[me].hand.slice(),
    sizes: g.players.map((p) => p.hand.length), // nur die Anzahl, nie der Inhalt
    bids: g.players.map((p) => p.bid), won: g.players.map((p) => p.tricks),
    trick: g.trick.cards.map((t) => ({ who: g.players.findIndex((p) => p.id === t.pid), card: t.card })),
    turn: g.turn, leader: g.leader, unknown, lastNotEqual: !!g.opts.lastNotEqual,
  };
}

// ---------- Schätzung für Leicht (und als Rückfall) ----------
export function estimateTricks(hand, trump) {
  let s = 0;
  for (const c of hand) {
    if (M.isWizard(c)) { s += 1; continue; }
    if (M.isFool(c)) continue;
    const r = M.rankOf(c);
    if (M.suitOf(c) === trump) s += r >= 12 ? 0.9 : r >= 10 ? 0.55 : r >= 8 ? 0.3 : 0.1;
    else s += r === 13 ? 0.55 : r === 12 ? 0.3 : r === 11 ? 0.1 : 0;
  }
  return s;
}

function clampBid(b, r, forbidden, rng) {
  let x = Math.max(0, Math.min(r, b));
  if (forbidden !== null && x === forbidden) {
    const alts = [x - 1, x + 1].filter((v) => v >= 0 && v <= r);
    x = alts.length === 1 ? alts[0] : pick(alts, rng);
  }
  return x;
}

// ---------- Simulation (volle Information in der gezogenen Welt) ----------
const strength = (c, trump) => {
  if (M.isWizard(c)) return 200;
  if (M.isFool(c)) return 0;
  return M.rankOf(c) + (M.suitOf(c) === trump ? 100 : 0);
};

function legalSim(hand, led) {
  if (led < 0) return hand;
  let has = false;
  for (let i = 0; i < hand.length; i++) if (M.suitOf(hand[i]) === led) { has = true; break; }
  if (!has) return hand;
  const out = [];
  for (let i = 0; i < hand.length; i++) { const c = hand[i]; if (M.suitOf(c) === led || M.kindOf(c) !== 0) out.push(c); }
  return out;
}

// Spielweise in der Simulation: Wer noch Stiche braucht, holt sie (billigste Gewinnerkarte); wer genug hat, weicht aus.
function policy(S, hand, legal) {
  if (legal.length === 1) return legal[0];
  const t = S.trump;
  const want = S.bids[S.turn] - S.won[S.turn] > 0;
  let best = -1, bs = 0;
  if (!S.trick.length) {
    for (let i = 0; i < legal.length; i++) {
      const s = strength(legal[i], t);
      if (best < 0 || (want ? s > bs : s < bs)) { best = i; bs = s; }
    }
    return legal[best];
  }
  const cur = S.trick[S.best];
  let low = -1, ls = 0;
  for (let i = 0; i < legal.length; i++) {
    const c = legal[i];
    const s = strength(c, t);
    const win = M.beats(c, cur, t);
    if (want) {
      if (win && (best < 0 || s < bs)) { best = i; bs = s; }
    } else if (!win && (best < 0 || s > bs)) { best = i; bs = s; }
    if (low < 0 || s < ls) { low = i; ls = s; }
  }
  return legal[best >= 0 ? best : low];
}

// Spielt von der Lage in S bis zum Rundenende. S: { n, hands, bids, won, trick, who, best, led, turn, trump }
function playOut(S) {
  const n = S.n;
  for (;;) {
    const hand = S.hands[S.turn];
    if (!hand.length && !S.trick.length) return;
    const c = policy(S, hand, legalSim(hand, S.led));
    hand.splice(hand.indexOf(c), 1);
    if (!S.trick.length) { S.best = 0; S.led = -2; }
    else if (M.beats(c, S.trick[S.best], S.trump)) S.best = S.trick.length;
    if (S.led === -2 && !M.isFool(c)) S.led = M.isWizard(c) ? -1 : M.suitOf(c);
    S.trick.push(c); S.who.push(S.turn);
    if (S.trick.length === n) {
      const w = S.who[S.best];
      S.won[w] += 1;
      S.turn = w; S.trick = []; S.who = []; S.best = 0; S.led = -2;
    } else S.turn = (S.turn + 1) % n;
  }
}

function sampleHands(v, rng) {
  const pool = v.unknown.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rng() * (i + 1))); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let k = 0;
  const hands = [];
  for (let p = 0; p < v.n; p++) {
    if (p === v.me) { hands.push(v.hand.slice()); continue; }
    hands.push(pool.slice(k, k + v.sizes[p])); k += v.sizes[p];
  }
  return hands;
}

function mkSim(v, hands, bids) {
  const S = { n: v.n, hands, bids, won: v.won.slice(), trick: [], who: [], best: 0, led: -2, turn: v.turn, trump: v.trump };
  for (const t of v.trick) {
    S.trick.push(t.card); S.who.push(t.who);
  }
  if (S.trick.length) {
    S.best = M.winnerIndex(S.trick, v.trump);
    S.led = M.ledSuitOf(S.trick);
    if (S.led === -1 && S.trick.every((c) => M.isFool(c))) S.led = -2;
  }
  return S;
}

// ---------- Entscheidungen ----------
function pickTrumpEasy(g, me, rng) {
  const n = [0, 0, 0, 0];
  for (const c of g.players[me].hand) if (!M.isWizard(c) && !M.isFool(c)) n[M.suitOf(c)] += 1;
  const mx = Math.max(...n);
  return pick([0, 1, 2, 3].filter((s) => n[s] === mx), rng);
}
function pickTrumpMid(g, me) {
  let bi = 0, bs = -1;
  for (let s = 0; s < 4; s++) {
    const sc = estimateTricks(g.players[me].hand, s) + 0.01 * g.players[me].hand.filter((c) => M.suitOf(c) === s).length;
    if (sc > bs) { bs = sc; bi = s; }
  }
  return bi;
}

function bidMid(g, botId, rng, samples, budget) {
  const v = viewOf(g, botId);
  const r = v.round;
  const forb = M.forbiddenBid(g, botId);
  const lo = new Int16Array(samples), hi = new Int16Array(samples);
  const t0 = nowMs();
  let done = 0;
  for (let k = 0; k < samples; k++) {
    const hands = sampleHands(v, rng);
    const A = mkSim(v, hands.map((h) => h.slice()), new Array(v.n).fill(99));
    playOut(A); hi[k] = A.won[v.me];
    const B = mkSim(v, hands.map((h) => h.slice()), new Array(v.n).fill(-1));
    playOut(B); lo[k] = B.won[v.me];
    done++;
    if (done >= MIN_SAMPLES && nowMs() - t0 > budget) break;
  }
  let bestB = 0, bestV = -1e9;
  for (let b = 0; b <= r; b++) {
    if (forb !== null && b === forb) continue;
    let sum = 0;
    for (let k = 0; k < done; k++) {
      const l = Math.min(lo[k], hi[k]), h = Math.max(lo[k], hi[k]);
      if (b >= l && b <= h) {
        const p = l < h && b > l && b < h ? 0.8 : l === h ? 0.85 : 0.55;
        sum += p * M.roundPoints(b, b) + (1 - p) * -M.BID_STEP;
      } else sum += M.roundPoints(b, b < l ? l : h);
    }
    if (sum > bestV) { bestV = sum; bestB = b; }
  }
  return bestB;
}

function playMid(g, botId, legal, rng, samples, budget) {
  const v = viewOf(g, botId);
  const cands = legal.slice().sort((a, b) => strength(a, v.trump) - strength(b, v.trump));
  const sum = cands.map(() => 0);
  const t0 = nowMs();
  let done = 0;
  for (let k = 0; k < samples; k++) {
    const hands = sampleHands(v, rng);
    cands.forEach((c, i) => {
      const hs = hands.map((h) => h.slice());
      const S = mkSim(v, hs, v.bids);
      // eigene Karte c spielen, dann den Rest der Runde
      const hand = hs[v.me];
      hand.splice(hand.indexOf(c), 1);
      if (!S.trick.length) { S.best = 0; S.led = -2; } else if (M.beats(c, S.trick[S.best], S.trump)) S.best = S.trick.length;
      if (S.led === -2 && !M.isFool(c)) S.led = M.isWizard(c) ? -1 : M.suitOf(c);
      S.trick.push(c); S.who.push(v.me);
      if (S.trick.length === v.n) { const w = S.who[S.best]; S.won[w] += 1; S.turn = w; S.trick = []; S.who = []; S.best = 0; S.led = -2; }
      else S.turn = (v.me + 1) % v.n;
      playOut(S);
      sum[i] += M.roundPoints(v.bids[v.me], S.won[v.me]);
    });
    done++;
    if (done >= MIN_SAMPLES && nowMs() - t0 > budget) break;
  }
  let bi = 0;
  for (let i = 1; i < cands.length; i++) if (sum[i] > sum[bi]) bi = i;
  return cands[bi];
}

export function chooseAction(g, botId, level = 0, rng = Math.random, opts = {}) {
  if (!g || g.game !== 'st' || (g.phase !== 'trump' && g.phase !== 'bid' && g.phase !== 'play')) return null;
  const me = g.players.findIndex((p) => p.id === botId);
  if (me < 0 || g.turn !== me) return null;
  const samples = opts.samples || SAMPLES;
  const budget = opts.budgetMs === undefined ? BUDGET_MS : opts.budgetMs;
  const hand = g.players[me].hand;

  if (g.phase === 'trump') return { t: 'trump', suit: level <= 0 ? pickTrumpEasy(g, me, rng) : pickTrumpMid(g, me) };

  if (g.phase === 'bid') {
    const forb = M.forbiddenBid(g, botId);
    if (level <= 0) {
      const est = estimateTricks(hand, M.trumpSuit(g));
      const dev = rng();
      const b = Math.round(est + (dev < 0.25 ? -1 : dev > 0.75 ? 1 : 0));
      return { t: 'bid', n: clampBid(b, g.round, forb, rng) };
    }
    return { t: 'bid', n: bidMid(g, botId, rng, samples, budget) };
  }

  const legal = M.legalCards(g, botId);
  if (!legal.length) return null;
  if (legal.length === 1) return { t: 'play', card: legal[0] };
  const t = M.trumpSuit(g);
  if (level <= 0) {
    const p = g.players[me];
    if (p.tricks >= p.bid) {
      const low = Math.min(...legal.map((c) => strength(c, t)));
      return { t: 'play', card: pick(legal.filter((c) => strength(c, t) === low), rng) };
    }
    return { t: 'play', card: pick(legal, rng) };
  }
  return { t: 'play', card: playMid(g, botId, legal, rng, samples, budget) };
}
