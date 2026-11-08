// Reversi – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels ({t:'place', p}) oder null.
// (Im Modus 'pass' liefert er {t:'ack'}, nur für Testläufe Computer gegen Computer; die Oberfläche lässt Menschen bestätigen.)
// level 0 = Leicht: zufälliger erlaubter Zug, mit 50 % wird eine erreichbare Ecke genommen.
// level 1 = Mittel: Alpha-Beta mit iterativer Vertiefung bis Tiefe 5 (Zeitbudget unter 150 ms), Bewertung aus
//           Ecken, Kanten, Beweglichkeit und (in der Endphase) Steinzahl; ab 8 freien Feldern wird bis zum Ende gerechnet.
//           In 10 % der Züge wird zufällig einer der drei besten Züge genommen.
// Der Computer kennt nur das Brett (es gibt keine verdeckten Informationen).
import { legalCells, CORNERS } from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

export const EASY_CORNER_CHANCE = 0.5;
export const MEDIUM_SLIP = 0.1;
export const MEDIUM_DEPTH = 5;
export const TIME_BUDGET_MS = 100;
export const SOLVE_EMPTIES = 8;

// ---------- Leicht ----------
function easyAction(g, me, rng) {
  const cells = legalCells(g.board, me);
  if (!cells.length) return null;
  const corners = cells.filter((p) => CORNERS.includes(p));
  if (corners.length && rng() < EASY_CORNER_CHANCE) return pick(corners, rng);
  return pick(cells, rng);
}

// ---------- Mittel: schnelle Brettdarstellung (0 leer, 1 Person 0, 2 Person 1) ----------
const RAYS = Array.from({ length: 64 }, (_, p) => {
  const rays = [];
  const r0 = Math.floor(p / 8); const c0 = p % 8;
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    const ray = [];
    for (let r = r0 + dr, c = c0 + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) ray.push(r * 8 + c);
    if (ray.length >= 2) rays.push(ray);
  }
  return rays;
});
// Feldwerte: Ecken sehr gut, Felder neben leeren Ecken schlecht, Kanten gut
const W = (() => {
  const q = [
    [100, -20, 10, 5], [-20, -50, -2, -2], [10, -2, -1, -1], [5, -2, -1, -1],
  ];
  const w = new Int16Array(64);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) w[r * 8 + c] = q[Math.min(r, 7 - r)][Math.min(c, 7 - c)];
  return w;
})();
const CORNER_OF = (p) => { const r = p < 32 ? 0 : 56; const c = (p % 8) < 4 ? 0 : 7; return r + c; };

// Zug ausführen; schreibt umgedrehte Felder an `flipped` (Länge in flipped[0]) – gibt Anzahl zurück (0 = unerlaubt)
function doMove(b, p, side, flipped) {
  if (b[p] !== 0) return 0;
  const opp = 3 - side;
  let n = 0;
  const rays = RAYS[p];
  for (let i = 0; i < rays.length; i++) {
    const ray = rays[i];
    let k = 0;
    while (k < ray.length && b[ray[k]] === opp) k++;
    if (k > 0 && k < ray.length && b[ray[k]] === side) {
      for (let j = 0; j < k; j++) { b[ray[j]] = side; flipped[++n] = ray[j]; }
    }
  }
  if (n) b[p] = side;
  return n;
}
function undoMove(b, p, side, flipped, n) {
  const opp = 3 - side;
  for (let j = 1; j <= n; j++) b[flipped[j]] = opp;
  b[p] = 0;
}
function canMove(b, p, side) {
  if (b[p] !== 0) return false;
  const opp = 3 - side;
  const rays = RAYS[p];
  for (let i = 0; i < rays.length; i++) {
    const ray = rays[i];
    let k = 0;
    while (k < ray.length && b[ray[k]] === opp) k++;
    if (k > 0 && k < ray.length && b[ray[k]] === side) return true;
  }
  return false;
}
function movesOf(b, side) {
  const out = [];
  for (let p = 0; p < 64; p++) if (canMove(b, p, side)) out.push(p);
  return out;
}
const mobility = (b, side) => { let n = 0; for (let p = 0; p < 64; p++) if (canMove(b, p, side)) n++; return n; };

function evaluate(b, side, empties) {
  const opp = 3 - side;
  let pos = 0; let mine = 0; let theirs = 0;
  for (let p = 0; p < 64; p++) {
    const v = b[p];
    if (v === 0) continue;
    let w = W[p];
    // Felder neben einer schon besetzten Ecke sind nicht mehr gefährlich
    if (w < 0 && w !== -2 && w !== -1 && b[CORNER_OF(p)] !== 0) w = 6;
    if (v === side) { pos += w; mine++; } else { pos -= w; theirs++; }
  }
  const mm = mobility(b, side); const om = mobility(b, opp);
  const mob = mm + om === 0 ? 0 : (100 * (mm - om)) / (mm + om + 2);
  const discW = empties <= 10 ? 4 : empties <= 20 ? 1 : 0;
  return pos * 2 + mob * 1.2 + discW * (mine - theirs);
}

const TIMEOUT = { timeout: true };
let nodes = 0; let deadline = 0;
function checkTime() { if ((++nodes & 255) === 0 && Date.now() > deadline) throw TIMEOUT; }

// Negamax mit Alpha-Beta. Wert aus Sicht von `side` (am Zug). passed: Vorgängerzug war ein Passen.
function search(b, side, depth, alpha, beta, passed, empties, exact) {
  checkTime();
  if (depth <= 0 && !exact) return evaluate(b, side, empties);
  const moves = [];
  for (let p = 0; p < 64; p++) if (canMove(b, p, side)) moves.push(p);
  if (!moves.length) {
    if (passed || empties === 0) {
      // Spielende: Steindifferenz (Sieg stark gewichtet)
      let d = 0;
      for (let p = 0; p < 64; p++) { if (b[p] === side) d++; else if (b[p] !== 0) d--; }
      return d > 0 ? 1000 + d : d < 0 ? -1000 + d : 0;
    }
    return -search(b, 3 - side, depth - 1, -beta, -alpha, true, empties, exact);
  }
  if (moves.length > 1) moves.sort((x, y) => W[y] - W[x]);
  const flipped = new Int8Array(20);
  let best = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const p = moves[i];
    const n = doMove(b, p, side, flipped);
    let v;
    try { v = -search(b, 3 - side, depth - 1, -beta, -alpha, false, empties - 1, exact); } finally { undoMove(b, p, side, flipped, n); }
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function toFast(board) {
  const b = new Int8Array(64);
  for (let p = 0; p < 64; p++) b[p] = board[p] === 0 ? 1 : board[p] === 1 ? 2 : 0;
  return b;
}

// Bester Zug (und alle Wurzelwerte) mit iterativer Vertiefung
export function searchBest(board, meIdx, opts = {}) {
  const maxDepth = opts.depth || MEDIUM_DEPTH;
  const budget = opts.budget || TIME_BUDGET_MS;
  const b = toFast(board);
  const side = meIdx === 0 ? 1 : 2;
  let empties = 0;
  for (let p = 0; p < 64; p++) if (b[p] === 0) empties++;
  let roots = movesOf(b, side);
  if (!roots.length) return null;
  if (roots.length === 1) return { p: roots[0], depth: 0, values: new Map([[roots[0], 0]]) };
  roots.sort((x, y) => W[y] - W[x]);
  nodes = 0;
  deadline = Date.now() + budget;
  const flipped = new Int8Array(20);
  let result = { p: roots[0], depth: 0, values: new Map(roots.map((p) => [p, W[p]])) };
  const run = (depth, exact) => {
    let alpha = -Infinity;
    const vals = new Map();
    let bestP = roots[0]; let bestV = -Infinity;
    for (const p of roots) {
      const n = doMove(b, p, side, flipped);
      let v;
      try { v = -search(b, 3 - side, depth - 1, -Infinity, -alpha, false, empties - 1, exact); } finally { undoMove(b, p, side, flipped, n); }
      vals.set(p, v);
      if (v > bestV) { bestV = v; bestP = p; }
      if (v > alpha) alpha = v;
    }
    // beste zuerst für die nächste Runde
    roots = roots.slice().sort((x, y) => vals.get(y) - vals.get(x));
    return { p: bestP, depth, values: vals };
  };
  try {
    for (let d = 1; d <= maxDepth; d++) result = run(d, false);
    if (empties <= SOLVE_EMPTIES && !opts.noSolve) result = run(empties + 1, true);
  } catch (e) {
    if (e !== TIMEOUT) throw e;
  }
  return result;
}

function mediumAction(g, me, rng) {
  const legal = legalCells(g.board, me);
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];
  if (rng() < MEDIUM_SLIP) {
    // Zufall unter den drei besten (nach flacher Suche mit vollem Fenster, damit alle Werte stimmen)
    const b = toFast(g.board);
    const side = me === 0 ? 1 : 2;
    let empties = 0;
    for (let p = 0; p < 64; p++) if (b[p] === 0) empties++;
    const flipped = new Int8Array(20);
    nodes = 0; deadline = Date.now() + TIME_BUDGET_MS;
    const scored = [];
    try {
      for (const p of legal) {
        const n = doMove(b, p, side, flipped);
        let v;
        try { v = -search(b, 3 - side, 2, -Infinity, Infinity, false, empties - 1, false); } finally { undoMove(b, p, side, flipped, n); }
        scored.push({ p, v });
      }
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      return pick(legal, rng);
    }
    scored.sort((x, y) => y.v - x.v);
    return pick(scored.slice(0, 3), rng).p;
  }
  const r = searchBest(g.board, me);
  return r ? r.p : pick(legal, rng);
}

// ---------- Einstieg ----------
export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || !Array.isArray(state.players) || !Array.isArray(state.board)) return null;
  const me = state.players.findIndex((p) => p.id === botId);
  if (me < 0) return null;
  if (state.mode === 'pass') return { t: 'ack' };
  if (state.mode !== 'play' || state.turn !== me) return null;
  const p = level >= 1 ? mediumAction(state, me, rng) : easyAction(state, me, rng);
  return p === null || p === undefined ? null : { t: 'place', p };
}
