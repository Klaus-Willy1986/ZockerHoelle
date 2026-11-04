// Dame – Computergegner. Reine Funktionen, kein DOM. Regeln nur über engine.js.
// chooseAction(state, botId, level, rng) -> Nachricht ({t:'move', path} / {t:'draw-decline'} / {t:'draw-accept'}) oder null.
// level 0 = Leicht, 1 = Mittel.
import { legalMovesFor, ownerOf, isDame, rowOf, colOf, playerIndex, countPieces } from './engine.js';

const WIN = 100000;
const MAN = 100;
const DAME = 300;
const MAX_DEPTH = 4;
const NODE_LIMIT = 9000;
const TIME_LIMIT_MS = 110;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Zug auf einer Kopie des Bretts ausführen (Regeln wie in engine.move: Umwandlung erst am Zugende).
function applyMove(board, m, who) {
  const b = board.slice();
  const piece = b[m.from];
  b[m.from] = 0;
  for (const c of m.caps) b[c] = 0;
  const end = m.path[m.path.length - 1];
  b[end] = !isDame(piece) && rowOf(end) === (who === 0 ? 0 : 7) ? (who === 0 ? 2 : 4) : piece;
  return b;
}

// Bewertung aus Sicht von `who` (positiv = gut für who).
function evalBoard(board, who) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const o = ownerOf(p);
    let v;
    if (isDame(p)) {
      v = DAME;
      const r = rowOf(i);
      const c = colOf(i);
      if (r > 0 && r < 7 && c > 0 && c < 7) v += 6; // Dame in der Mitte beweglicher
    } else {
      const adv = o === 0 ? 7 - rowOf(i) : rowOf(i); // 0..7
      v = MAN + adv * 5;
      if (colOf(i) === 0 || colOf(i) === 7) v += 3; // Randsteine sind schwerer zu schlagen
      if (adv === 0) v += 6; // Grundreihe hält Damen fern
    }
    s += o === who ? v : -v;
  }
  return s;
}

function search(ctx, board, who, depth, alpha, beta, ext) {
  ctx.nodes++;
  if (ctx.nodes > ctx.limit || ((ctx.nodes & 255) === 0 && now() > ctx.deadline)) ctx.abort = true;
  if (ctx.abort) return 0;
  const moves = legalMovesFor(board, who);
  if (!moves.length) return -WIN - depth;
  if (depth <= 0) {
    if (!moves[0].caps.length || ext <= 0) {
      const mob = moves.length - legalMovesFor(board, 1 - who).length;
      return evalBoard(board, who) + mob * 2;
    }
    ext--; // Schlagfolge zu Ende spielen (Horizonteffekt vermeiden)
  }
  moves.sort((a, b) => b.caps.length - a.caps.length);
  let best = -Infinity;
  for (const m of moves) {
    const v = -search(ctx, applyMove(board, m, who), 1 - who, depth - 1, -beta, -alpha, ext);
    if (ctx.abort) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const posKey = (board, turn) => board.join('') + turn;

function pickMittel(state, who, moves, rng) {
  if (moves.length === 1) return moves[0];
  const MARGIN = 7; // gleichwertige Züge: etwas Zufall
  let result = null;
  const t0 = now();
  for (let depth = 2; depth <= MAX_DEPTH; depth++) {
    const ctx = { nodes: 0, limit: NODE_LIMIT, deadline: t0 + TIME_LIMIT_MS, abort: false };
    const scored = [];
    let best = -Infinity;
    for (const m of moves) {
      const nb = applyMove(state.board, m, who);
      let v;
      if ((state.history[posKey(nb, 1 - who)] || 0) >= 2) {
        v = 0; // würde Remis durch Stellungswiederholung bedeuten
      } else {
        v = -search(ctx, nb, 1 - who, depth - 1, -WIN * 2, -(best - MARGIN - 1), 2);
      }
      if (ctx.abort) break;
      scored.push({ m, v });
      if (v > best) best = v;
    }
    if (ctx.abort) break;
    result = scored.filter((x) => x.v >= best - MARGIN);
    if (best >= WIN - 50 || best <= -WIN) break; // entschieden
    if (now() - t0 > TIME_LIMIT_MS * 0.4) break;
  }
  if (!result) result = moves.map((m) => ({ m, v: 0 }));
  // Gelegentlich (ca. 7 %) ein nur etwas schwächerer Zug, damit der Computer nicht perfekt wirkt
  let top = result.reduce((a, b) => (b.v > a.v ? b : a));
  if (rng() < 0.07 && result.length > 1) {
    const alt = result.filter((x) => x !== top);
    return alt[Math.floor(rng() * alt.length)].m;
  }
  const near = result.filter((x) => x.v >= top.v - MARGIN);
  return near[Math.floor(rng() * near.length)].m;
}

// Leicht: meist zufällig, manchmal der Zug, der am wenigsten Steine verliert.
function pickLeicht(state, who, moves, rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (moves.length === 1 || rng() >= 0.4) return pick(moves);
  let bestNet = -Infinity;
  let pool = [];
  for (const m of moves) {
    const nb = applyMove(state.board, m, who);
    const reply = legalMovesFor(nb, 1 - who);
    const loss = reply.reduce((a, r) => Math.max(a, r.caps.length), 0);
    const net = m.caps.length - loss;
    if (net > bestNet) { bestNet = net; pool = [m]; } else if (net === bestNet) pool.push(m);
  }
  return pick(pool);
}

// Die Stellung ist "remisreif": nur noch Damen und lange ohne Fortschritt (und der Computer nicht klar vorn).
function drawIsFair(state, idx) {
  const b = state.board;
  const onlyDames = b.every((p) => !p || isDame(p));
  const long = state.noProgress >= 30 || (onlyDames && state.noProgress >= 16);
  if (!long) return false;
  const val = (who) => b.reduce((a, p) => a + (p && ownerOf(p) === who ? (isDame(p) ? DAME : MAN) : 0), 0);
  return val(idx) - val(1 - idx) <= 150 && countPieces(b, idx) > 0;
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.mode !== 'normal') return null;
  const idx = playerIndex(state, botId);
  if (idx < 0) return null;
  if (state.drawOffer !== null) {
    if (state.drawOffer === idx) return null; // der Computer bietet nie Remis an
    return { t: drawIsFair(state, idx) ? 'draw-accept' : 'draw-decline' };
  }
  if (state.turn !== idx) return null;
  const moves = legalMovesFor(state.board, idx);
  if (!moves.length) return null;
  const m = level >= 1 ? pickMittel(state, idx, moves, rng) : pickLeicht(state, idx, moves, rng);
  return { t: 'move', path: m.path.slice() };
}
