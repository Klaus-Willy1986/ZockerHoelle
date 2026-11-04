// Mühle – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels oder null.
// level 0 = Leicht (meist zufällig, nimmt gern eine Mühle), level 1 = Mittel (kleine Suche).
import { MILLS, NEIGHBORS, legalActions, inMill } from './engine.js';

const MILLS_OF = Array.from({ length: 24 }, (_, p) => MILLS.filter((m) => m.includes(p)));
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// ---------- Hilfen auf einfachen Brett-Feldern (null | 0 | 1) ----------
function boardAfter(board, a, c) {
  const b = board.slice();
  if (a.t === 'place') b[a.p] = c;
  else { b[a.from] = null; b[a.to] = c; }
  return b;
}
const target = (a) => (a.t === 'place' ? a.p : a.to);

// Punkte, an denen die Gegenseite sofort eine Mühle schließen könnte
function threatPoints(g, opp) {
  const out = new Set();
  const flies = g.toPlace[opp] === 0 && g.board.filter((v) => v === opp).length === 3;
  for (const m of MILLS) {
    const mine = m.filter((q) => g.board[q] === opp);
    const empty = m.filter((q) => g.board[q] === null);
    if (mine.length !== 2 || empty.length !== 1) continue;
    const p = empty[0];
    let reach = g.toPlace[opp] > 0 || flies;
    if (!reach) reach = NEIGHBORS[p].some((q) => g.board[q] === opp && !m.includes(q));
    if (reach) out.add(p);
  }
  return out;
}

// ---------- Leicht ----------
function easyAction(g, me, rng) {
  const acts = legalActions(g);
  if (!acts.length) return null;
  if (g.removing) return pick(acts, rng); // legalActions nennt nur ungeschützte Steine (wenn möglich)
  const mills = acts.filter((a) => inMill(boardAfter(g.board, a, me), target(a)));
  if (mills.length && rng() < 0.8) return pick(mills, rng);
  const th = threatPoints(g, 1 - me);
  if (th.size && rng() < 0.35) {
    const blocks = acts.filter((a) => th.has(target(a)));
    if (blocks.length) return pick(blocks, rng);
  }
  return pick(acts, rng);
}

// ---------- Mittel: Suche über ganze Züge (setzen/ziehen samt Entfernen) ----------
const INF = 1e9;
const TOL = 1.6; // Züge in dieser Nähe zum besten gelten als gleichwertig
const OOPS = 0.12; // Anteil der Züge mit kleinem Versehen
const TOL_FLY = 8; // im Endspiel mit Fliegen nimmt er auch Züge, die Drohungen aufbauen
const MAX_DEPTH = 3;
const MAX_DEPTH_FLY = 5; // wenn jemand fliegen darf, ist die Suche billiger und wichtiger
const TIME_MS = 90;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Zustand: b = Brett (-1 leer, 0, 1), tp = noch zu setzen, cnt = Steine auf dem Brett
const fromGame = (g) => ({
  b: g.board.map((v) => (v === null ? -1 : v)),
  tp: [g.toPlace[0], g.toPlace[1]],
  cnt: [g.board.filter((v) => v === 0).length, g.board.filter((v) => v === 1).length],
});
const millAt = (b, p, c) => MILLS_OF[p].some((m) => b[m[0]] === c && b[m[1]] === c && b[m[2]] === c);

function removables(b, victim) {
  const all = [];
  const free = [];
  for (let i = 0; i < 24; i++) if (b[i] === victim) { all.push(i); if (!millAt(b, i, victim)) free.push(i); }
  return free.length ? free : all;
}

// Alle ganzen Züge von side: { f: -1 setzen | Startpunkt, t: Ziel, r: -1 | entfernter Punkt }
function genMoves(st, side) {
  const { b, tp, cnt } = st;
  const opp = 1 - side;
  const out = [];
  const add = (f, t) => {
    if (f >= 0) b[f] = -1;
    b[t] = side;
    if (millAt(b, t, side)) {
      const rs = removables(b, opp);
      if (rs.length) for (const r of rs) out.push({ f, t, r });
      else out.push({ f, t, r: -1 });
    } else out.push({ f, t, r: -1 });
    b[t] = -1;
    if (f >= 0) b[f] = side;
  };
  if (tp[side] > 0) {
    for (let i = 0; i < 24; i++) if (b[i] === -1) add(-1, i);
  } else {
    const fly = cnt[side] === 3;
    for (let f = 0; f < 24; f++) {
      if (b[f] !== side) continue;
      if (fly) { for (let t = 0; t < 24; t++) if (b[t] === -1) add(f, t); } else for (const t of NEIGHBORS[f]) if (b[t] === -1) add(f, t);
    }
  }
  out.sort((x, y) => (y.r >= 0) - (x.r >= 0));
  return out;
}

function apply(st, side, m) {
  const b = st.b.slice();
  const tp = st.tp.slice();
  const cnt = st.cnt.slice();
  if (m.f >= 0) b[m.f] = -1; else { tp[side] -= 1; cnt[side] += 1; }
  b[m.t] = side;
  if (m.r >= 0) { b[m.r] = -1; cnt[1 - side] -= 1; }
  return { b, tp, cnt };
}

function mobility(st, c) {
  const { b, tp, cnt } = st;
  if (tp[c] > 0) return 24 - cnt[0] - cnt[1];
  let free = 0;
  for (let i = 0; i < 24; i++) if (b[i] === -1) free++;
  if (cnt[c] === 3) return free ? 6 : 0; // Fliegen: beweglich, aber nicht überbewerten
  let n = 0;
  for (let i = 0; i < 24; i++) if (b[i] === c) for (const q of NEIGHBORS[i]) if (b[q] === -1) n++;
  return n;
}

// Spielende nach einem Zug von mover? +1 mover gewinnt, -1 mover verliert, 0 läuft weiter
function outcome(st, mover) {
  const opp = 1 - mover;
  if (st.tp[opp] === 0 && st.cnt[opp] <= 2) return 1;
  if (st.tp[mover] === 0 && st.cnt[mover] <= 2) return -1;
  if (st.tp[opp] === 0 && mobility(st, opp) === 0) return 1;
  return 0;
}

function evaluate(st, me) {
  const { b, tp, cnt } = st;
  const opp = 1 - me;
  let mills = 0; let open = 0;
  const flyMe = tp[me] === 0 && cnt[me] === 3;
  const flyOpp = tp[opp] === 0 && cnt[opp] === 3;
  for (const m of MILLS) {
    let a = 0; let o = 0; let e = 0;
    for (const q of m) { if (b[q] === me) a++; else if (b[q] === opp) o++; else e++; }
    if (a === 3) mills += 1; else if (o === 3) mills -= 1;
    else if (a === 2 && e === 1) open += flyMe ? 3 : 1;
    else if (o === 2 && e === 1) open -= flyOpp ? 4 : 1.2;
  }
  let s = 12 * ((cnt[me] + tp[me]) - (cnt[opp] + tp[opp])) + 4 * mills + 3.5 * open;
  if (tp[0] === 0 && tp[1] === 0) s += 1.5 * (mobility(st, me) - mobility(st, opp));
  else {
    let pos = 0;
    for (let i = 0; i < 24; i++) if (b[i] === me) pos += NEIGHBORS[i].length; else if (b[i] === opp) pos -= NEIGHBORS[i].length;
    s += 0.5 * pos;
  }
  return s;
}

class Timeout extends Error {}

function search(st, side, depth, alpha, beta, ctx) {
  if ((++ctx.nodes & 255) === 0 && now() > ctx.deadline) throw new Timeout();
  const moves = genMoves(st, side);
  if (!moves.length) return -900 - depth;
  let best = -INF;
  for (const m of moves) {
    const nx = apply(st, side, m);
    const o = outcome(nx, side);
    let v;
    if (o) v = o * (1000 + depth);
    else if (depth <= 1) v = evaluate(nx, side);
    else v = -search(nx, 1 - side, depth - 1, -beta, -alpha, ctx);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function mediumAction(g, me, rng) {
  const st = fromGame(g);
  let moves;
  if (g.removing) moves = removables(st.b, 1 - me).map((r) => ({ f: -2, t: -1, r }));
  else moves = genMoves(st, me);
  if (!moves.length) return null;
  const toMsg = (m) => {
    if (m.f === -2) return { t: 'remove', p: m.r };
    if (m.f === -1) return { t: 'place', p: m.t };
    return { t: 'move', from: m.f, to: m.t };
  };
  if (moves.length === 1) return toMsg(moves[0]);

  const applyRoot = (m) => {
    if (m.f === -2) {
      const b = st.b.slice(); const cnt = st.cnt.slice();
      b[m.r] = -1; cnt[1 - me] -= 1;
      return { b, tp: st.tp.slice(), cnt };
    }
    return apply(st, me, m);
  };
  const children = moves.map((m) => {
    const nx = applyRoot(m);
    const o = outcome(nx, me);
    // Dieselbe Stellung zum dritten Mal wäre Remis
    let draw = false;
    if (!o && m.r < 0 && m.f !== -2 && st.tp[0] === 0 && st.tp[1] === 0) {
      const key = `${nx.b.map((v) => (v < 0 ? '-' : v)).join('')}|${1 - me}`;
      draw = (g.seen[key] || 0) >= 2;
    }
    return { m, nx, o, draw };
  });

  const ctx = { nodes: 0, deadline: now() + TIME_MS };
  let result = null;
  const flyEnd = st.tp[0] + st.tp[1] === 0 && (st.cnt[0] === 3 || st.cnt[1] === 3);
  // Zieht sich eine Partie sehr lange hin, spielt er forscher (flachere Suche), damit sie nicht ewig dauert
  const maxDepth = g.moveNo > 120 ? 2 : flyEnd ? MAX_DEPTH_FLY : MAX_DEPTH;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const scores = [];
    let best = -INF;
    try {
      for (const c of children) {
        let v;
        if (c.o) v = c.o * (1000 + depth);
        else if (c.draw) v = 0;
        else if (depth === 1) v = evaluate(c.nx, me);
        else v = -search(c.nx, 1 - me, depth - 1, -INF, -(best - TOL), ctx);
        scores.push(v);
        if (v > best) best = v;
      }
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
    result = { scores, best };
    if (best >= 1000) break; // Gewinn gefunden
  }
  const { scores, best } = result;
  // Gleichwertige Züge: die mit der besten Einschätzung der Stellung vorn, daraus zufällig (damit er Druck macht, aber nicht immer gleich spielt)
  const good = [];
  const tol = flyEnd ? TOL_FLY : TOL;
  scores.forEach((v, i) => { if (v >= best - tol) good.push({ m: children[i].m, s: children[i].o ? 0 : evaluate(children[i].nx, me) }); });
  good.sort((x, y) => y.s - x.s);
  // Gelegentlich ein kleines Versehen (nie ein Steinverlust), damit der Computer nicht unfehlbar wirkt
  if (!flyEnd && best < 900 && rng() < OOPS) {
    const ok = [];
    scores.forEach((v, i) => { if (v >= best - 10) ok.push(children[i].m); });
    return toMsg(pick(ok, rng));
  }
  return toMsg(pick(good.slice(0, 3), rng).m);
}

// ---------- Einstieg ----------
export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.mode !== 'play' || !Array.isArray(state.players)) return null;
  const me = state.players.findIndex((p) => p.id === botId);
  if (me < 0) return null;
  // Remis-Angebot des Gegenübers: sofort antworten (Ablehnung, außer die Stellung wiederholt sich)
  if (state.drawOffer !== null && state.drawOffer !== undefined) {
    if (state.drawOffer === me) return null;
    const key = `${state.board.map((v) => (v === null ? '-' : v)).join('')}|${state.turn}`;
    return (state.seen && state.seen[key] >= 2) ? { t: 'draw-accept' } : { t: 'draw-decline' };
  }
  if (state.turn !== me) return null;
  const act = level >= 1 ? mediumAction(state, me, rng) : easyAction(state, me, rng);
  return act || null;
}
