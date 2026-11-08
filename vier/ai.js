// Vier in Reihe – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng, opts) liefert eine ganz normale Nachricht ({t:'drop', c}) oder null.
// Es wird nur das sichtbare Brett benutzt (Spalten, Reihen, Steine, wer am Zug ist).
// level 0 = Leicht: zufällige Spalte, gewinnt aber sofort, wenn möglich, und blockt die Hälfte der sofortigen Gegnergewinne.
// level 1 = Mittel: Alpha-Beta-Suche (Tiefe bis 7, Zeitbudget) mit Bewertung, 10 % Zufallszug (nie ein sofort verlierender, falls es andere gibt).

export const EASY_BLOCK = 0.5;
export const MEDIUM_SLIP = 0.1;
export const DEPTH = 7;
export const BUDGET_MS = 90;

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Hat der Stein auf Feld p (Farbe v, schon gesetzt) vier in einer Reihe?
function fourAt(b, cols, rows, p, v) {
  const r0 = (p / cols) | 0; const c0 = p % cols;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (let s = 1; s < 4; s++) { const r = r0 - dr * s; const c = c0 - dc * s; if (r < 0 || r >= rows || c < 0 || c >= cols || b[r * cols + c] !== v) break; n++; }
    for (let s = 1; s < 4; s++) { const r = r0 + dr * s; const c = c0 + dc * s; if (r < 0 || r >= rows || c < 0 || c >= cols || b[r * cols + c] !== v) break; n++; }
    if (n >= 4) return true;
  }
  return false;
}

// Interne Stellung: Brett mit 0 = leer, 1/2 = Farbe; Höhen je Spalte
function makePos(g) {
  const { cols, rows } = g;
  const b = new Int8Array(cols * rows);
  for (let i = 0; i < b.length; i++) b[i] = g.board[i] === null ? 0 : g.board[i] + 1;
  return { b, cols, rows };
}

function freeRow(b, cols, rows, c) {
  for (let r = rows - 1; r >= 0; r--) if (b[r * cols + c] === 0) return r;
  return -1;
}

// Spalten, mit denen `v` sofort gewinnt
function winningCols(pos, v) {
  const out = [];
  for (let c = 0; c < pos.cols; c++) {
    const r = freeRow(pos.b, pos.cols, pos.rows, c);
    if (r < 0) continue;
    const p = r * pos.cols + c;
    pos.b[p] = v;
    if (fourAt(pos.b, pos.cols, pos.rows, p, v)) out.push(c);
    pos.b[p] = 0;
  }
  return out;
}

// ---------- Leicht ----------
function easyAction(g, me, rng) {
  const pos = makePos(g);
  const v = me + 1;
  const open = [];
  for (let c = 0; c < g.cols; c++) if (freeRow(pos.b, g.cols, g.rows, c) >= 0) open.push(c);
  if (!open.length) return null;
  const wins = winningCols(pos, v);
  if (wins.length) return pick(wins, rng);
  const blocks = winningCols(pos, 3 - v);
  if (blocks.length && rng() < EASY_BLOCK) return pick(blocks, rng);
  return pick(open, rng);
}

// ---------- Mittel ----------
const WINDOWS = new Map();
function windowsOf(cols, rows) {
  const key = `${cols}x${rows}`;
  let w = WINDOWS.get(key);
  if (w) return w;
  w = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const er = r + dr * 3; const ec = c + dc * 3;
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
        w.push([0, 1, 2, 3].map((i) => (r + dr * i) * cols + (c + dc * i)));
      }
    }
  }
  const colWeight = Array.from({ length: cols }, (_, c) => cols - 1 - Math.abs(2 * c - (cols - 1)) + 1); // Mitte bevorzugt
  w = { list: w, colWeight };
  WINDOWS.set(key, w);
  return w;
}
const ORDERS = new Map();
function orderOf(cols) {
  let o = ORDERS.get(cols);
  if (!o) { o = Array.from({ length: cols }, (_, i) => i).sort((a, b) => Math.abs(2 * a - (cols - 1)) - Math.abs(2 * b - (cols - 1)) || a - b); ORDERS.set(cols, o); }
  return o;
}

// Bewertung aus Sicht von `v`: Mitte bevorzugt, offene Dreier/Zweier (Fenster mit nur eigenen Steinen)
function evaluate(pos, v) {
  const { b, cols, rows } = pos;
  const { list, colWeight } = windowsOf(cols, rows);
  const o = 3 - v;
  let s = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = b[r * cols + c];
    if (x === v) s += colWeight[c] * 3; else if (x === o) s -= colWeight[c] * 3;
  }
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    let mine = 0; let theirs = 0;
    for (let j = 0; j < 4; j++) { const x = b[w[j]]; if (x === v) mine++; else if (x === o) theirs++; }
    if (mine && theirs) continue;
    if (mine === 3) s += 60; else if (mine === 2) s += 10;
    else if (theirs === 3) s -= 70; else if (theirs === 2) s -= 10;
  }
  return s;
}

class Timeout extends Error {}

function search(pos, v, depth, alpha, beta, ply, ctx) {
  if ((++ctx.nodes & 511) === 0 && now() > ctx.deadline) throw new Timeout();
  const { b, cols, rows } = pos;
  const order = ctx.order;
  let any = false;
  // sofortiger Gewinn?
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const r = freeRow(b, cols, rows, c);
    if (r < 0) continue;
    any = true;
    const p = r * cols + c;
    b[p] = v;
    const w = fourAt(b, cols, rows, p, v);
    b[p] = 0;
    if (w) return 100000 - ply;
  }
  if (!any) return 0;
  if (depth === 0) return evaluate(pos, v);
  let best = -Infinity;
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const r = freeRow(b, cols, rows, c);
    if (r < 0) continue;
    const p = r * cols + c;
    b[p] = v;
    const val = -search(pos, 3 - v, depth - 1, -beta, -alpha, ply + 1, ctx);
    b[p] = 0;
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Bewertung aller Spalten (Liste {c, val}) bis zur erreichten Tiefe; stoppt beim Zeitbudget
function mediumScores(g, me, maxDepth, budget) {
  const pos = makePos(g);
  const { b, cols, rows } = pos;
  const v = me + 1;
  const ctx = { nodes: 0, deadline: now() + budget, order: orderOf(cols) };
  let lastGood = null;
  let rootOrder = ctx.order.filter((c) => freeRow(b, cols, rows, c) >= 0);
  for (let d = 1; d <= maxDepth; d++) {
    try {
      const res = [];
      let alpha = -Infinity;
      for (const c of rootOrder) {
        const r = freeRow(b, cols, rows, c);
        const p = r * cols + c;
        b[p] = v;
        let val;
        if (fourAt(b, cols, rows, p, v)) val = 100000;
        else {
          try { val = -search(pos, 3 - v, d - 1, -Infinity, -(alpha - 1), 1, ctx); } finally { b[p] = 0; }
        }
        b[p] = 0;
        res.push({ c, val });
        if (val > alpha) alpha = val;
      }
      lastGood = res;
      // beste Spalte zuerst im nächsten Durchgang
      rootOrder = res.slice().sort((x, y) => y.val - x.val).map((x) => x.c);
      if (res.some((x) => x.val >= 99000)) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // Brett wiederherstellen
      for (let i = 0; i < b.length; i++) b[i] = g.board[i] === null ? 0 : g.board[i] + 1;
      break;
    }
  }
  return lastGood;
}

function mediumAction(g, me, rng, opts) {
  const pos = makePos(g);
  const v = me + 1;
  const open = [];
  for (let c = 0; c < g.cols; c++) if (freeRow(pos.b, g.cols, g.rows, c) >= 0) open.push(c);
  if (!open.length) return null;
  if (open.length === 1) return open[0];
  const wins = winningCols(pos, v);
  if (wins.length) return pick(wins, rng);
  // Züge, nach denen die Gegenseite sofort gewinnen könnte, gelten als verlierend
  const safe = open.filter((c) => {
    const r = freeRow(pos.b, g.cols, g.rows, c);
    pos.b[r * g.cols + c] = v;
    const bad = winningCols(pos, 3 - v).length > 0;
    pos.b[r * g.cols + c] = 0;
    return !bad;
  });
  const pool = safe.length ? safe : open;
  if (rng() < MEDIUM_SLIP) return pick(pool, rng);
  const blocks = winningCols(pos, 3 - v);
  if (blocks.length === 1 && open.includes(blocks[0])) return blocks[0];
  const scores = mediumScores(g, me, (opts && opts.depth) || DEPTH, (opts && opts.ms) || BUDGET_MS) || pool.map((c) => ({ c, val: 0 }));
  const cand = scores.filter((s) => pool.includes(s.c));
  const use = cand.length ? cand : scores;
  const best = Math.max(...use.map((s) => s.val));
  const top = use.filter((s) => s.val >= best - 1).map((s) => s.c);
  return pick(top, rng);
}

export function chooseAction(g, botId, level = 0, rng = Math.random, opts = {}) {
  if (!g || g.mode !== 'play' || !Array.isArray(g.players) || !Array.isArray(g.board)) return null;
  const me = g.players.findIndex((p) => p.id === botId);
  if (me < 0 || g.turn !== me) return null;
  const c = level >= 1 ? mediumAction(g, me, rng, opts) : easyAction(g, me, rng);
  return c === null || c === undefined ? null : { t: 'drop', c };
}
