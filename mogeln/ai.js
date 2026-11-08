// Mogeln – Computergegner (reine Funktionen). Stufen: 0 = Leicht, 1 = Mittel.
// Der Computer nutzt nur: die EIGENE Hand, die Größe des Stapels, die Handgrößen (Kartenzahlen) und die Ansagen.
// Er liest nie die Karten der anderen, den Inhalt des Stapels oder die zuletzt gelegten Karten (`lastPlay.ids`).
import * as M from './engine.js';

export const EASY_BELIEVE = 0.7; // Leicht glaubt zu 70 %, ruft zu 30 % "Mogler!"
export const MEDIUM_NOISE = 0.1; // Mittel: 10 % Zufall bei der Entscheidung
export const MEDIUM_CALL_AT = 0.5; // Mittel ruft, wenn seine Schätzung "gelogen" mindestens so hoch ist
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
// P(mindestens c Treffer) beim Ziehen von h Karten aus U Karten, von denen m Treffer sind
export function probAtLeast(U, m, h, c) {
  if (c <= 0) return 1;
  if (h < c || m < c || U <= 0) return 0;
  const tot = choose(U, h);
  let p = 0;
  for (let x = c; x <= Math.min(m, h); x++) p += (choose(m, x) * choose(U - m, h - x)) / tot;
  return Math.max(0, Math.min(1, p));
}

// Wie viele eigene Züge dauert es (grob), bis der Rang einer Karte dran ist? Karten mit großem Wert sind gute Lügenkarten.
function turnsUntil(rank, nowRank, n) {
  let inv = 1;
  for (let i = 1; i < 13; i++) if ((n * i) % 13 === 1) { inv = i; break; }
  return ((((rank - nowRank) % 13) + 13) % 13 * inv) % 13;
}

function lieCard(g, hand, level, rng) {
  if (level <= 0) return pick(hand, rng);
  const n = g.players.length;
  const copies = {};
  for (const c of hand) copies[M.rankOf(c)] = (copies[M.rankOf(c)] || 0) + 1;
  let best = null;
  let bestKey = null;
  for (const c of hand) {
    const r = M.rankOf(c);
    const key = [turnsUntil(r, g.rank, n), -copies[r]];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) { best = c; bestKey = key; }
  }
  return best;
}

// Mittel: Wie wahrscheinlich ist die Ansage gelogen? (nur aus eigener Hand, Kartenzahlen und Ansage)
export function lieEstimate(g, botId) {
  const lp = g.lastPlay;
  const me = g.players.find((p) => p.id === botId);
  const ann = g.players[g.announcer];
  if (!lp || !me || !ann) return 0.5;
  const c = lp.count;
  const k = me.hand.filter((x) => M.rankOf(x) === lp.rank).length;
  if (k + c > 4) return 1; // so viele Karten dieses Rangs gibt es nicht: sicher gelogen
  const left = ann.hand.length; // so viele Karten hat die Person nach dem Legen noch
  if (left === 0) return 1; // wer so gewinnen würde, wird immer angezweifelt
  const U = M.DECK_SIZE - me.hand.length;
  const before = left + c; // so viele Karten hatte die Person vor dem Legen
  const m = 4 - k; // so viele Karten dieses Rangs können bei den anderen liegen
  // Wer wahrheitsgemäß legt, legt alle Karten des Rangs; gelogen wird meist mit nur einer Karte.
  const pExact = probAtLeast(U, m, before, c) - probAtLeast(U, m, before, c + 1);
  const pMore = probAtLeast(U, m, before, c + 1);
  const pNone = 1 - probAtLeast(U, m, before, 1);
  const pSome = Math.max(0, 1 - pNone - probAtLeast(U, m, before, c)); // weniger als c, aber nicht keine
  const shape = c === 1 ? 1 : c === 2 ? 0.25 : c === 3 ? 0.08 : 0.03;
  const truthW = pExact + 0.4 * pMore;
  const lieW = pNone * shape + 0.3 * pSome * shape;
  let est = truthW + lieW > 0 ? lieW / (truthW + lieW) : 0.5;
  est += left <= 2 ? 0.35 : left <= 4 ? 0.2 : left <= 6 ? 0.1 : 0; // je weniger Karten, desto eher wird gemogelt (und desto gefährlicher)
  return Math.min(1, est);
}

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  try { return decide(g, botId, level, rng); } catch { return null; }
}

function decide(g, botId, level, rng) {
  if (!g || g.game !== M.GAME || !Array.isArray(g.players)) return null;
  if (g.phase === 'over') return null;
  if (g.phase === 'reveal') return { t: 'next' };
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;

  if (g.phase === 'play') {
    const hand = ap.hand;
    if (!hand.length) return null;
    const truth = hand.filter((c) => M.rankOf(c) === g.rank);
    // Mittel: Reicht eine Ablage, um alle Karten loszuwerden, wird sie versucht (auch mit gemogelten Karten)
    if (level >= 1 && hand.length <= M.MAX_PLAY && hand.length > truth.length) return { t: 'play', cards: hand.slice() };
    if (truth.length) return { t: 'play', cards: truth.slice(0, M.MAX_PLAY) };
    return { t: 'play', cards: [lieCard(g, hand, level, rng)] };
  }

  if (g.phase === 'decide') {
    if (level <= 0) return rng() < EASY_BELIEVE ? { t: 'believe' } : { t: 'call' };
    let call = lieEstimate(g, botId) >= MEDIUM_CALL_AT;
    if (rng() < MEDIUM_NOISE) call = !call;
    return call ? { t: 'call' } : { t: 'believe' };
  }
  return null;
}
