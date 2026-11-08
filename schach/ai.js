// Schach – Computergegner. Reine Funktionen, kein DOM. Regeln nur über engine.js.
// chooseAction(state, botId, level, rng, opts) -> { t: 'move', from, to, promo? } oder null.
// level 0 = Leicht (Tiefe 1–2, Rauschen), 1 = Mittel (Alpha-Beta, Ruhesuche, iterative Vertiefung mit Zeitbudget).
// opts: { timeMs, maxDepth } nur für Tests (Standard Mittel: 1200 ms, Tiefe bis 6). Es gibt keine verdeckte Information.
import {
  posOf, make, unmake, genPseudo, attacked, legalInts, hasLegal, inCheckPos, keyOfPos, typeOf, colorOfPlayer,
  mFrom, mTo, mPromo, mFlag, RAY, KN,
} from './engine.js';

const MATE = 100000;
const INF = 1e9;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const PROMO_LETTER = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };

const VAL = [0, 100, 320, 330, 500, 900, 0];
// Figur-Feld-Tabellen, Reihe 8 oben (Sicht von Weiß)
const PST = [null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  null];
const KING_MID = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
// Tabelle für Weiß: Index (7-Reihe)*8+Spalte; für Schwarz gespiegelt: Reihe*8+Spalte
const pstIdx = (c, s) => (c === 0 ? ((7 - (s >> 3)) << 3) | (s & 7) : s);
const PASSED = [0, 5, 10, 20, 35, 60, 100, 0];
const centerDist = (s) => { const f = s & 7; const r = s >> 3; return Math.max(3 - f, f - 4) + Math.max(3 - r, r - 4); };
const kingDist = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

// Bewertung in Hundertstel-Bauern aus Sicht der Seite am Zug
function evaluate(pos) {
  const b = pos.board;
  let score = 0; // aus Sicht von Weiß
  let phase = 0;
  const mat = [0, 0]; const pawns = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]];
  const pawnAt = [[], []]; const bishops = [0, 0];
  for (let s = 0; s < 64; s++) {
    const p = b[s]; if (!p) continue;
    const c = p > 6 ? 1 : 0; const t = c ? p - 6 : p;
    if (t === 1) { pawns[c][s & 7]++; pawnAt[c].push(s); }
    if (t === 3) bishops[c]++;
    if (t === 2 || t === 3) phase += 1; else if (t === 4) phase += 2; else if (t === 5) phase += 4;
    if (t !== 6) mat[c] += VAL[t];
  }
  if (phase > 24) phase = 24;
  for (let s = 0; s < 64; s++) {
    const p = b[s]; if (!p) continue;
    const c = p > 6 ? 1 : 0; const t = c ? p - 6 : p;
    const sign = c ? -1 : 1;
    let v = VAL[t];
    if (t === 6) {
      const i = pstIdx(c, s);
      v += (KING_MID[i] * phase + KING_END[i] * (24 - phase)) / 24;
      // Königssicherheit: Bauernschild und offene Linie (nur mit vielen Figuren auf dem Brett)
      if (phase > 8) {
        const f = s & 7; const r = s >> 3; const dr = c ? -1 : 1;
        let shield = 0;
        for (let df = -1; df <= 1; df++) {
          const nf = f + df; if (nf < 0 || nf > 7) continue;
          for (let k = 1; k <= 2; k++) {
            const nr = r + dr * k; if (nr < 0 || nr > 7) break;
            if (b[nr * 8 + nf] === (c ? 7 : 1)) { shield += k === 1 ? 10 : 5; break; }
          }
          if (pawns[c][nf] === 0) shield -= 12;
        }
        v += (shield * phase) / 24;
      }
    } else {
      v += PST[t][pstIdx(c, s)];
      if (t === 1) {
        // Freibauer und Doppelbauer
        const f = s & 7; const r = s >> 3; let passed = true;
        for (let df = -1; df <= 1 && passed; df++) {
          const nf = f + df; if (nf < 0 || nf > 7) continue;
          for (const q of pawnAt[1 - c]) if ((q & 7) === nf && (c === 0 ? (q >> 3) > r : (q >> 3) < r)) { passed = false; break; }
        }
        if (passed) v += PASSED[c === 0 ? r : 7 - r] * (1 + (24 - phase) / 24);
        if (pawns[c][f] > 1) v -= 8;
      } else if (t === 2 || t === 3) {
        // Beweglichkeit
        let n = 0;
        if (t === 2) { const kn = KN[s]; for (let i = 0; i < kn.length; i++) { const q = b[kn[i]]; if (q === 0 || (q > 6 ? 1 : 0) !== c) n++; } } else {
          const rays = RAY[s];
          for (let d = 4; d < 8; d++) { const ray = rays[d]; for (let i = 0; i < ray.length; i++) { const q = b[ray[i]]; if (q === 0) { n++; continue; } if ((q > 6 ? 1 : 0) !== c) n++; break; } }
        }
        v += (t === 2 ? 4 : 3) * n;
      } else if (t === 4 || t === 5) {
        let n = 0;
        const rays = RAY[s];
        for (let d = 0; d < (t === 4 ? 4 : 8); d++) { const ray = rays[d]; for (let i = 0; i < ray.length; i++) { const q = b[ray[i]]; if (q === 0) { n++; continue; } if ((q > 6 ? 1 : 0) !== c) n++; break; } }
        v += (t === 4 ? 2 : 1) * n;
        if (t === 4) { const f = s & 7; if (pawns[c][f] === 0) v += pawns[1 - c][f] === 0 ? 15 : 8; }
      }
    }
    score += sign * v;
  }
  if (bishops[0] >= 2) score += 30;
  if (bishops[1] >= 2) score -= 30;
  // Endspiel: Wer klar vorn liegt, treibt den gegnerischen König an den Rand und holt den eigenen König heran
  const diff = mat[0] - mat[1];
  if (phase <= 14 && Math.abs(diff) >= 200) {
    const lead = diff > 0 ? 0 : 1;
    const wk = pos.king[lead]; const lk = pos.king[1 - lead];
    const bonus = 12 * centerDist(lk) + 5 * (14 - kingDist(wk, lk) * 2);
    score += lead === 0 ? bonus : -bonus;
  }
  return (pos.turn === 0 ? score : -score) + 8;
}

// ---------- Suche ----------
const S = { nodes: 0, deadline: 0, abort: false, killers: [], noQ: false };

function orderScore(pos, m, killer0, killer1) {
  const b = pos.board;
  const to = (m >> 6) & 63;
  const victim = b[to];
  let sc = 0;
  if (victim) sc = 10000 + 10 * VAL[typeOf(victim)] - VAL[typeOf(b[m & 63])] / 10;
  else if ((m >> 15) === 2) sc = 10000 + 900;
  const pr = (m >> 12) & 7;
  if (pr) sc += 8000 + VAL[pr];
  if (!victim && !pr) { if (m === killer0) sc = 9000; else if (m === killer1) sc = 8900; }
  return sc;
}
function sortMoves(pos, ms, ply, first) {
  const k = S.killers[ply] || [0, 0];
  const scores = ms.map((m) => (m === first ? 1e6 : orderScore(pos, m, k[0], k[1])));
  const idx = ms.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  return idx.map((i) => ms[i]);
}

function qsearch(pos, alpha, beta, ply) {
  S.nodes++;
  if ((S.nodes & 1023) === 0 && now() > S.deadline) S.abort = true;
  if (S.abort) return 0;
  const c = pos.turn;
  const inChk = attacked(pos, pos.king[c], c ^ 1);
  let stand;
  if (!inChk) {
    stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
  } else stand = -MATE + ply;
  if (ply > 30) return evaluate(pos);
  const ms = sortMoves(pos, genPseudo(pos, [], !inChk), ply, 0);
  let legal = 0;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (!inChk) {
      // Delta-Beschneidung: Schlag bringt auch mit Reserve nicht mehr an alpha heran
      const victim = pos.board[(m >> 6) & 63];
      if (stand + (victim ? VAL[typeOf(victim)] : 100) + 200 < alpha && !((m >> 12) & 7)) continue;
    }
    const u = make(pos, m);
    if (attacked(pos, pos.king[c], c ^ 1)) { unmake(pos, m, u); continue; }
    legal++;
    const sc = -qsearch(pos, -beta, -alpha, ply + 1);
    unmake(pos, m, u);
    if (S.abort) return 0;
    if (sc > stand) stand = sc;
    if (sc > alpha) { alpha = sc; if (alpha >= beta) break; }
  }
  if (inChk && legal === 0) return -MATE + ply;
  return stand;
}

function search(pos, depth, alpha, beta, ply) {
  S.nodes++;
  if ((S.nodes & 1023) === 0 && now() > S.deadline) S.abort = true;
  if (S.abort) return 0;
  const c = pos.turn;
  const inChk = attacked(pos, pos.king[c], c ^ 1);
  if (inChk && ply < 24) depth++;
  if (depth <= 0) return S.noQ ? evaluate(pos) : qsearch(pos, alpha, beta, ply);
  if (ply > 0 && pos.halfmove >= 100) return 0;
  const ms = sortMoves(pos, genPseudo(pos, []), ply, 0);
  let legal = 0; let best = -INF;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const u = make(pos, m);
    if (attacked(pos, pos.king[c], c ^ 1)) { unmake(pos, m, u); continue; }
    legal++;
    const sc = -search(pos, depth - 1, -beta, -alpha, ply + 1);
    unmake(pos, m, u);
    if (S.abort) return 0;
    if (sc > best) best = sc;
    if (sc > alpha) {
      alpha = sc;
      if (alpha >= beta) {
        if (!pos.board[(m >> 6) & 63] && !((m >> 12) & 7)) { const k = S.killers[ply] || (S.killers[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } }
        break;
      }
    }
  }
  if (legal === 0) return inChk ? -MATE + ply : 0;
  return best;
}

const isMated = (pos) => inCheckPos(pos) && !hasLegal(pos);
// Lässt der Zug sofort Matt in 1 zu?
function allowsMate1(pos, m) {
  const u = make(pos, m);
  let bad = false;
  const reply = genPseudo(pos, []); const c = pos.turn;
  for (let i = 0; i < reply.length && !bad; i++) {
    const r = make(pos, reply[i]);
    if (!attacked(pos, pos.king[c], c ^ 1) && isMated(pos)) bad = true;
    unmake(pos, reply[i], r);
  }
  unmake(pos, m, u);
  return bad;
}
function givesMate(pos, m) {
  const u = make(pos, m);
  const r = isMated(pos);
  unmake(pos, m, u);
  return r;
}

// Wie viele Male war die Stellung nach dem Zug schon da? (für Dreifachstellung)
function seenAfter(pos, m, positions) {
  const u = make(pos, m);
  const hm = pos.halfmove;
  const n = (positions && positions[keyOfPos(pos)]) || 0;
  unmake(pos, m, u);
  return { n, hm };
}

function rootMoves(pos) {
  const ms = legalInts(pos);
  return ms;
}

function toMsg(m) {
  const pr = mPromo(m);
  const msg = { t: 'move', from: mFrom(m), to: mTo(m) };
  if (pr) msg.promo = PROMO_LETTER[pr] || 'q';
  return msg;
}

// Leicht: Tiefe 1–2 mit Rauschen. 30 % Zufallszug unter den besten fünf.
function chooseEasy(pos, positions, rng) {
  const ms = rootMoves(pos);
  if (!ms.length) return null;
  const depth = rng() < 0.5 ? 1 : 2;
  S.nodes = 0; S.abort = false; S.deadline = now() + 1e9; S.killers = []; S.noQ = true;
  const scored = ms.map((m) => {
    let sc;
    if (givesMate(pos, m)) sc = MATE;
    else {
      const seen = seenAfter(pos, m, positions);
      const u = make(pos, m);
      if (!hasLegal(pos)) sc = 0;
      else if (seen.n >= 2 || seen.hm >= 100) sc = 0;
      else sc = -search(pos, depth - 1, -INF, INF, 1);
      unmake(pos, m, u);
    }
    return { m, sc: sc + rng() * 30 };
  });
  scored.sort((a, b) => b.sc - a.sc);
  const top = scored.slice(0, 5);
  const pick = rng() < 0.3 ? top[Math.floor(rng() * top.length)] : scored[0];
  return pick.m;
}

// Mittel: iterative Vertiefung, Alpha-Beta, Ruhesuche, Zeitbudget
function chooseMedium(pos, positions, rng, opts) {
  const ms0 = rootMoves(pos);
  if (!ms0.length) return null;
  if (ms0.length === 1) return ms0[0];
  const timeMs = opts.timeMs === undefined ? 1200 : opts.timeMs;
  const maxDepth = opts.maxDepth || 6;
  const c = pos.turn;
  const start = now();
  // Mattsuche: Matt in 1 sofort nehmen
  for (const m of ms0) if (givesMate(pos, m)) return m;
  // Zug mit Wiederholung/50-Züge-Remis bewerten wir direkt mit 0
  const drawing = new Set();
  for (const m of ms0) { const s = seenAfter(pos, m, positions); if (s.n >= 2 || s.hm >= 100) drawing.add(m); }
  S.noQ = false; S.killers = [];
  let order = ms0.slice();
  let bestMove = order.find((m) => !drawing.has(m)) || order[0];
  let bestScore = -INF;
  let scores = new Map();
  for (let depth = 1; depth <= maxDepth; depth++) {
    S.nodes = 0; S.abort = false; S.deadline = depth <= 2 ? start + 1e9 : start + timeMs;
    let alpha = -INF; const beta = INF;
    let itBest = null; let itScore = -INF; const itScores = new Map();
    const sorted = sortMoves(pos, order, 0, bestMove);
    for (const m of sorted) {
      let sc;
      if (drawing.has(m)) sc = 0;
      else {
        const u = make(pos, m);
        sc = -search(pos, depth - 1, -beta, -alpha, 1);
        unmake(pos, m, u);
      }
      if (S.abort) break;
      itScores.set(m, sc);
      if (sc > itScore) { itScore = sc; itBest = m; }
      if (sc > alpha) alpha = sc;
    }
    if (S.abort) break;
    bestMove = itBest; bestScore = itScore; scores = itScores;
    order = sorted;
    if (bestScore >= MATE - 100) break;
    if (now() - start > timeMs * 0.5 && depth >= 4) break;
  }
  // 5 %: Zufallszug unter den besten drei (nie einer, der Matt in 1 zulässt, nie ein grober Fehler)
  if (rng() < 0.05 && bestScore < MATE - 100) {
    S.nodes = 0; S.abort = false; S.deadline = now() + 1e9; S.noQ = false;
    const sc = ms0.map((m) => {
      if (drawing.has(m)) return { m, sc: 0 };
      const u = make(pos, m);
      const v = -search(pos, 1, -INF, INF, 1);
      unmake(pos, m, u);
      return { m, sc: v };
    }).sort((a, b) => b.sc - a.sc);
    const top = sc.slice(0, 3).filter((x) => x.sc > sc[0].sc - 120 && !allowsMate1(pos, x.m));
    if (top.length) return top[Math.floor(rng() * top.length)].m;
  }
  void scores; void c;
  return bestMove;
}

export function chooseAction(state, botId, level = 1, rng = Math.random, opts = {}) {
  try {
    if (!state || state.mode !== 'play' || !Array.isArray(state.board)) return null;
    const color = colorOfPlayer(state, botId);
    if (color < 0 || color !== state.turn) return null;
    const pos = posOf(state);
    pos.queenOnly = true; // Computer verwandelt immer in eine Dame
    const m = level >= 1 ? chooseMedium(pos, state.positions, rng, opts || {}) : chooseEasy(pos, state.positions, rng);
    return m === null || m === undefined ? null : toMsg(m);
  } catch {
    return null;
  }
}

export const _internals = { evaluate, mFlag };
