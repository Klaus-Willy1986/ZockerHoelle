// Kartenrennen – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht (zufälliger erlaubter Zug), 1 = Mittel (bewertet jeden Zug).
// Die KI benutzt nur die eigene Hand, das Brett (öffentlich) und die Ablage, nie die Hände der anderen
// und nie den Stapel.
import * as P from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Kartentausch (Mittel): zuerst kleine Zahlen weitergeben, Ass/König/Joker nie, wenn es sich vermeiden lässt.
// Der Wert, den die Partnerin vielleicht braucht, fließt bewusst NICHT ein.
const WEAK = ['2', '3', '5', '6', '8', '9', '10', '4', 'DAME', 'BUBE', '7', 'KING', 'ASS', 'JOKER'];

function chooseSwap(hand, level, rng) {
  if (!hand.length) return null;
  let pool = hand;
  if (level > 0) {
    let best = Infinity;
    for (const c of hand) best = Math.min(best, WEAK.indexOf(c.r));
    pool = hand.filter((c) => WEAK.indexOf(c.r) === best);
  }
  const c = pick(pool, rng);
  return { r: c.r, s: c.s };
}

// ---------- Brettbewertung für ein Team ----------
const stoneVal = (p) => (p < 0 ? 0 : p <= 63 ? 30 + p : 140 + 3 * (p - 64));
const NEAR = 0.09; // grobe Wahrscheinlichkeit, dass eine bestimmte Entfernung mit der Karte der Gegner getroffen wird

function evalBoard(b, team) {
  let mine = 0; let opp = 0; let mineThreat = 0; let oppThreat = 0;
  const ring = []; // [g, abs]
  const stall = [0, 0, 0, 0];
  for (let g = 0; g < 16; g++) {
    const p = b.p[g];
    if (p < 0) stall[g >> 2]++;
    else if (p <= 63) ring.push([g, (g >> 2) * 16 + p]);
  }
  for (let g = 0; g < 16; g++) {
    const v = stoneVal(b.p[g]);
    if ((g >> 2) % 2 === team) mine += v; else opp += v;
  }
  for (const [g, a0] of ring) {
    const a = a0 % 64;
    const mineSide = (g >> 2) % 2 === team;
    const v = stoneVal(b.p[g]);
    const prot = b.pr[g] && b.p[g] === 0;
    if (prot) { if (mineSide) mine += 3; continue; }
    let t = 0;
    for (const [h, e0] of ring) {
      if ((h >> 2) % 2 === (g >> 2) % 2) continue;
      const d = (a - (e0 % 64) + 64) % 64;
      if (d >= 1 && d <= 13) t += NEAR;
    }
    for (let s = 0; s < 4; s++) if (s % 2 !== (g >> 2) % 2 && stall[s] > 0 && a === s * 16) t += 0.15;
    if (mineSide) mineThreat += v * t; else oppThreat += v * t;
  }
  return mine - 0.9 * opp - mineThreat + 0.4 * oppThreat;
}

function cardCost(m) {
  if (m.card.r === 'JOKER') return -10;
  if ((m.card.r === 'ASS' || m.card.r === 'KING') && !m.move.out) return -3;
  return 0;
}

function scoreMove(state, ctl, team, before, m, rng) {
  const b = P.boardOf(state);
  const res = P.resolve(b, ctl, m.as || m.card.r, m.move);
  if (!res.ok) return -Infinity;
  return evalBoard(res.b, team) - before + cardCost(m) + rng() * 1.5;
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.players)) return null;
  const seat = P.seatOfPid(state, botId);
  if (seat < 0) return null;
  const me = state.players[seat];
  if (state.phase === 'swap') {
    if (state.swapSel[seat]) return null;
    const card = chooseSwap(me.hand, level, rng);
    return card ? { t: 'swap', card } : null;
  }
  if (state.phase !== 'play' || state.turn !== seat) return null;
  const moves = P.legalMoves(state, botId);
  if (!moves.length) return { t: 'discardAll' };
  let chosen;
  if (level <= 0) {
    chosen = pick(moves, rng);
  } else {
    const b = P.boardOf(state);
    const ctl = P.ctlSeat(b, seat);
    const team = P.teamOf(seat);
    const before = evalBoard(b, team);
    let best = -Infinity;
    for (const m of moves) {
      const s = scoreMove(state, ctl, team, before, m, rng);
      if (s > best) { best = s; chosen = m; }
    }
    if (!chosen) chosen = pick(moves, rng);
  }
  const msg = { t: 'play', card: { r: chosen.card.r, s: chosen.card.s }, move: chosen.move };
  if (chosen.as) msg.as = chosen.as;
  return msg;
}
