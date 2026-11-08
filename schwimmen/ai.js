// Schwimmen – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel. Genutzt werden nur die eigene Hand, der Tisch und öffentliche Angaben
// (wer geklopft/getauscht hat). Fremde Hände und der Stapel werden nie angesehen.
import * as M from './engine.js';

export const KNOCK_EASY = 25;
export const KNOCK_EASY_CHANCE = 0.2;
export const KNOCK_MID = 27;
export const KNOCK_MID_SWAPPED = 24;
const POT_WEIGHT = 0.2; // Gleichstand: lieber das Blatt mit mehr Aussicht (zweite Farbe)

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

function suitSums(hand) {
  const s = [0, 0, 0, 0];
  for (const c of hand) s[c.s] += M.cardValue(c);
  return s;
}

// ----- Leicht: einfache Regel -----
function easy(g, me, rng) {
  const hand = me.hand;
  const v = M.handValue(hand);
  if (v === 31) return { t: 'call31' };
  if (g.knocker === null && v >= KNOCK_EASY && rng() < KNOCK_EASY_CHANCE) return { t: 'knock' };
  const sums = suitSums(hand);
  let best = 0;
  for (let s = 1; s < 4; s++) if (sums[s] > sums[best]) best = s;
  // beste Tischkarte meiner Farbe
  let tj = -1;
  g.table.forEach((c, j) => { if (c.s === best && (tj < 0 || M.cardValue(c) > M.cardValue(g.table[tj]))) tj = j; });
  if (tj < 0) return { t: 'pass' };
  // abgeben: schwächste Karte, die nicht zu meiner Farbe gehört (sonst die schwächste überhaupt)
  let hi = -1;
  hand.forEach((c, i) => { if (c.s !== best && (hi < 0 || M.cardValue(c) < M.cardValue(hand[hi]))) hi = i; });
  if (hi < 0) hand.forEach((c, i) => { if (hi < 0 || M.cardValue(c) < M.cardValue(hand[hi])) hi = i; });
  if (M.cardValue(g.table[tj]) > M.cardValue(hand[hi]) || hand[hi].s !== best) return { t: 'swap1', hand: hi, table: tj };
  return { t: 'pass' };
}

// ----- Mittel: rechnet alle Züge durch -----
function mid(g, me, rng) {
  const hand = me.hand;
  const cur = M.handValue(hand);
  if (cur === 31) return { t: 'call31' };
  const opts = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const h = hand.slice();
      h[i] = g.table[j];
      opts.push({ msg: { t: 'swap1', hand: i, table: j }, v: M.handValue(h), cost: 1 });
    }
  }
  opts.push({ msg: { t: 'swap3' }, v: M.handValue(g.table), cost: 2 });
  const pot = (h) => { const q = suitSums(h).sort((a, b) => b - a); return q[0] + POT_WEIGHT * q[1]; };
  for (const o of opts) {
    const h = o.msg.t === 'swap3' ? g.table : (() => { const x = hand.slice(); x[o.msg.hand] = g.table[o.msg.table]; return x; })();
    o.p = o.v === 30.5 ? 30.5 : pot(h);
  }
  const bv = Math.max(...opts.map((o) => o.v));
  const bestSet0 = opts.filter((o) => o.v === bv);
  const bp = Math.max(...bestSet0.map((o) => o.p));
  const bestSet = bestSet0.filter((o) => o.p === bp);
  const bestMove = () => {
    const cheap = bestSet.filter((o) => o.cost === 1);
    return pick(cheap.length ? cheap : bestSet, rng).msg;
  };
  if (bv === 31) return bestMove();
  if (g.knocker === null) {
    const swappedOthers = g.players.some((p) => !p.out && p.id !== me.id && g.swapped && g.swapped[p.id]);
    const thr = swappedOthers ? KNOCK_MID_SWAPPED : KNOCK_MID;
    if (cur >= thr) return { t: 'knock' };
  }
  if (bv > cur) return bestMove();
  return { t: 'pass' };
}

// Liefert die Nachricht für den Computer oder null, wenn er nicht handeln darf.
export function chooseAction(g, botId, level, rng = Math.random) {
  try {
    if (!g || g.game !== 'sw' || g.phase !== 'play') return null;
    const me = g.players.find((p) => p.id === botId);
    if (!me || me.out || M.activePlayer(g).id !== botId) return null;
    return level >= 1 ? mid(g, me, rng) : easy(g, me, rng);
  } catch {
    return { t: 'pass' };
  }
}
