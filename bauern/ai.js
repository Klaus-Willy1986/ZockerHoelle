// Bauernschach – Computergegner. Reine Funktionen, kein DOM. Regeln nur über engine.js.
// chooseAction(state, botId, level, rng) -> { t: 'move', from, to } oder null.
// level 0 = Leicht, 1 = Mittel. Es gibt keine verdeckte Information.
import { genMoves, applyMove, colorOf, dirOf, goalRank, startRank, countPawns, reachedGoal, KIND_CAPTURE, KIND_EP } from './engine.js';

const WIN = 100000;
const MAX_DEPTH = 6;
const NODE_LIMIT = 90000;
const TIME_LIMIT_MS = 85;
const RANDOM_SHARE = 0.1;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const from = (m) => m & 63;
const to = (m) => (m >> 6) & 63;
const kind = (m) => m >> 12;
const epOf = (g) => (g.ep ? g.ep.to : -1);

// ---------- Zug machen / zurücknehmen auf einem veränderbaren Brett ----------
function make(board, m, color) {
  return applyMove(board, m, color);
}
function unmake(board, m, color) {
  const f = from(m); const t = to(m); const k = kind(m);
  board[f] = color + 1;
  board[t] = k === KIND_CAPTURE ? 2 - color : 0;
  if (k === KIND_EP) board[t - dirOf(color) * 8] = 2 - color;
}

// Hat die Person `color` einen Zug, der sofort gewinnt? (Grundreihe, letzter Bauer geschlagen, Gegenseite blockiert)
function winningMove(board, color, ep, opts) {
  const foe = 1 - color;
  const moves = genMoves(board, color, ep, opts);
  const goal = goalRank(color);
  for (const m of moves) {
    if ((to(m) >> 3) === goal) return m;
  }
  for (const m of moves) {
    const k = kind(m);
    const nep = make(board, m, color);
    const wins = (k >= KIND_CAPTURE && countPawns(board, foe) === 0) || genMoves(board, foe, nep, opts).length === 0;
    unmake(board, m, color);
    if (wins) return m;
  }
  return null;
}
// Kann die Person `color` im nächsten Zug die Grundreihe erreichen?
function breakthroughMove(board, color, ep, opts) {
  const goal = goalRank(color);
  return genMoves(board, color, ep, opts).find((m) => (to(m) >> 3) === goal) ?? null;
}

// ---------- Bewertung (aus Sicht der Person am Zug) ----------
const FREE_WIN = 6000;
function evaluate(board, color, ep, opts) {
  const maxB = [-1, -1, -1, -1, -1, -1, -1, -1];
  const minW = [9, 9, 9, 9, 9, 9, 9, 9];
  const maxAny = [-1, -1, -1, -1, -1, -1, -1, -1];
  const minAny = [9, 9, 9, 9, 9, 9, 9, 9];
  const pawns = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const r = i >> 3; const f = i & 7;
    pawns.push(i);
    if (r > maxAny[f]) maxAny[f] = r;
    if (r < minAny[f]) minAny[f] = r;
    if (p === 2) { if (r > maxB[f]) maxB[f] = r; } else if (r < minW[f]) minW[f] = r;
  }
  const score = [0, 0];
  const dist = [99, 99];
  const cnt = [0, 0];
  for (const i of pawns) {
    const p = board[i];
    const c = p - 1;
    const r = i >> 3; const f = i & 7;
    const adv = c === 0 ? r : 7 - r; // 0..7: Vorsprung zur Grundreihe
    cnt[c]++;
    let s = 100 + adv * 7 + (adv >= 4 ? (adv - 3) * (adv - 3) * 5 : 0);
    // Blockade: Feld davor besetzt und nichts zum Schlagen
    const ahead = i + dirOf(c) * 8;
    if (adv < 7 && board[ahead] !== 0) {
      let canCap = false;
      if (f > 0 && board[ahead - 1] === 2 - c) canCap = true;
      if (f < 7 && board[ahead + 1] === 2 - c) canCap = true;
      if (!canCap) s -= 14;
    }
    // freier Bauer: niemand mehr davor (gleiche Linie) und kein gegnerischer Bauer vor ihm auf den Nachbarlinien
    let free;
    if (c === 0) {
      free = maxAny[f] <= r && !(f > 0 && maxB[f - 1] >= r + 1) && !(f < 7 && maxB[f + 1] >= r + 1);
    } else {
      free = minAny[f] >= r && !(f > 0 && minW[f - 1] <= r - 1) && !(f < 7 && minW[f + 1] <= r - 1);
    }
    if (free) {
      let d = 7 - adv;
      if (r === startRank(c)) d -= 1;
      if (d < dist[c]) dist[c] = d;
      s += 25 + adv * 14;
    }
    score[c] += s;
  }
  const me = color; const foe = 1 - color;
  let v = score[me] - score[foe];
  // Rennen der freien Bauern: wer zuerst ankommt (die Person am Zug zieht zuerst)
  if (dist[me] < 99 || dist[foe] < 99) {
    if (dist[me] <= dist[foe]) v += FREE_WIN - dist[me] * 20;
    else v -= FREE_WIN - dist[foe] * 20;
  }
  // Beweglichkeit: wer bald nicht mehr ziehen kann, verliert
  v += (genMoves(board, me, ep, opts).length - genMoves(board, foe, -1, opts).length) * 3;
  return v;
}

function orderKey(m, color) {
  const t = to(m);
  if ((t >> 3) === goalRank(color)) return 1000;
  const r = t >> 3;
  const adv = color === 0 ? r : 7 - r;
  return (kind(m) >= KIND_CAPTURE ? 100 : 0) + adv;
}
function ordered(moves, color) {
  return moves.map((m) => [orderKey(m, color), m]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function search(ctx, board, color, ep, depth, alpha, beta, ply) {
  ctx.nodes++;
  if (ctx.nodes > ctx.limit || ((ctx.nodes & 127) === 0 && now() > ctx.deadline)) ctx.abort = true;
  if (ctx.abort) return 0;
  const moves = genMoves(board, color, ep, ctx.opts);
  if (!moves.length) return -(WIN - ply);
  if (depth <= 0) return evaluate(board, color, ep, ctx.opts);
  const goal = goalRank(color);
  let best = -Infinity;
  for (const m of ordered(moves, color)) {
    let v;
    if ((to(m) >> 3) === goal) {
      v = WIN - ply - 1;
    } else {
      const nep = make(board, m, color);
      v = -search(ctx, board, 1 - color, nep, depth - 1, -beta, -alpha, ply + 1);
      unmake(board, m, color);
      if (ctx.abort) return 0;
    }
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// Mittel: Alpha-Beta bis Tiefe 6 (Halbzüge), Zeit- und Knotenlimit; 10 % Zufallszug (nie ein sofort verlierender, wenn es anders geht).
function pickMittel(state, color, moves, rng) {
  const opts = state.opts;
  const board = Int8Array.from(state.board);
  const ep = epOf(state);
  const win = winningMove(board, color, ep, opts);
  if (win !== null) return win;
  if (moves.length === 1) return moves[0];
  if (rng() < RANDOM_SHARE) {
    const safe = moves.filter((m) => {
      const nep = make(board, m, color);
      const bad = breakthroughMove(board, 1 - color, nep, opts) !== null || winningMove(board, 1 - color, nep, opts) !== null;
      unmake(board, m, color);
      return !bad;
    });
    return pick(safe.length ? safe : moves, rng);
  }
  const t0 = now();
  let order = ordered(moves, color);
  let result = null;
  for (let depth = 2; depth <= MAX_DEPTH; depth++) {
    const ctx = { nodes: 0, limit: NODE_LIMIT, deadline: t0 + TIME_LIMIT_MS, abort: false, opts };
    const scored = [];
    let alpha = -WIN * 2;
    for (const m of order) {
      const nep = make(board, m, color);
      const v = -search(ctx, board, 1 - color, nep, depth - 1, -WIN * 2, -alpha + 1, 1);
      unmake(board, m, color);
      if (ctx.abort) break;
      scored.push([v, m]);
      if (v > alpha) alpha = v;
    }
    if (ctx.abort) break;
    scored.sort((a, b) => b[0] - a[0]);
    result = scored;
    order = scored.map((x) => x[1]);
    if (scored[0][0] >= WIN - 200) break; // Sieg gefunden
  }
  if (!result) return pick(moves, rng);
  const top = result[0][0];
  const best = result.filter((x) => x[0] === top).map((x) => x[1]);
  return pick(best, rng);
}

// Leicht: zufälliger Zug; gewinnt sofort, wenn möglich; verhindert mit 50 % den sofortigen Durchbruch des Gegners.
function pickLeicht(state, color, moves, rng) {
  const opts = state.opts;
  const board = Int8Array.from(state.board);
  const ep = epOf(state);
  const win = winningMove(board, color, ep, opts);
  if (win !== null) return win;
  if (moves.length > 1 && rng() < 0.5 && breakthroughMove(board, 1 - color, -1, opts) !== null) {
    const safe = moves.filter((m) => {
      const nep = make(board, m, color);
      const bad = breakthroughMove(board, 1 - color, nep, opts) !== null;
      unmake(board, m, color);
      return !bad;
    });
    if (safe.length) return pick(safe, rng);
  }
  return pick(moves, rng);
}

export function chooseAction(state, botId, level, rng = Math.random) {
  try {
    if (!state || state.mode !== 'play' || !Array.isArray(state.board)) return null;
    const color = colorOf(state, botId);
    if (color < 0 || state.turn !== color) return null;
    const moves = genMoves(state.board, color, epOf(state), state.opts);
    if (!moves.length) return null;
    const m = level >= 1 ? pickMittel(state, color, moves, rng) : pickLeicht(state, color, moves, rng);
    return { t: 'move', from: from(m), to: to(m) };
  } catch {
    return null;
  }
}
export { reachedGoal };
