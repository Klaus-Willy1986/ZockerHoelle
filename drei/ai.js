// Drei gewinnt – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels ({t:'place', p}) oder null.
// level 0 = Leicht: zufällig, gewinnt bzw. blockt nur manchmal (40 %).
// level 1 = Mittel: 3×3 perfekte Suche mit 15 % Zufallszug, 5×5 Reihen-Bewertung mit 15 % Zufallszug.
import { winLines, lineThrough } from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const free = (b) => { const o = []; for (let i = 0; i < b.length; i++) if (b[i] === null) o.push(i); return o; };

export const EASY_CHANCE = 0.4; // Wahrscheinlichkeit, einen Gewinn/Block zu sehen
export const MEDIUM_SLIP = 0.15; // Anteil der Zufallszüge bei Mittel

// Felder, mit denen `side` jetzt sofort gewinnen würde
function winningCells(b, n, k, side) {
  const out = [];
  for (let p = 0; p < b.length; p++) {
    if (b[p] !== null) continue;
    b[p] = side;
    if (lineThrough(b, n, k, p)) out.push(p);
    b[p] = null;
  }
  return out;
}

// ---------- Leicht ----------
function easyAction(g, me, rng) {
  const b = g.board.slice();
  const cells = free(b);
  if (!cells.length) return null;
  const wins = winningCells(b, g.size, g.k, me);
  if (wins.length && rng() < EASY_CHANCE) return pick(wins, rng);
  const blocks = winningCells(b, g.size, g.k, 1 - me);
  if (blocks.length && rng() < EASY_CHANCE) return pick(blocks, rng);
  return pick(cells, rng);
}

// ---------- Mittel, 3×3: vollständige Suche (Negamax mit Merkliste) ----------
const LINES3 = winLines(3, 3);
const lineWinner = (b) => {
  for (const [x, y, z] of LINES3) if (b[x] !== null && b[x] === b[y] && b[y] === b[z]) return b[x];
  return null;
};
const MEMO = new Map(); // Stellung + Person am Zug -> Wert (gilt für jede Partie, daher dauerhaft)
// Wert aus Sicht der Person `side` am Zug: > 0 gewinnt (je schneller, desto größer), < 0 verliert, 0 unentschieden
const code = (b) => { let k = 0; for (let i = 0; i < 9; i++) k = k * 3 + (b[i] === null ? 2 : b[i]); return k; };
const flip = (c) => (c > 0 ? -(c - 1) : c < 0 ? -(c + 1) : 0);
function negamax(b, side) {
  const key = code(b) * 2 + side;
  const hit = MEMO.get(key);
  if (hit !== undefined) return hit;
  let best = -Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i] !== null) continue;
    b[i] = side;
    const v = lineWinner(b) !== null ? 10 : flip(negamax(b, 1 - side));
    b[i] = null;
    if (v > best) best = v;
  }
  const res = best === -Infinity ? 0 : best;
  MEMO.set(key, res);
  return res;
}
// Aussicht gegen eine Gegenseite, die manchmal danebenzieht: Erwartungswert (1 Sieg, 0,5 unentschieden, 0 Niederlage) für `me`,
// wenn `me` weiter nur Züge mit bestem Wert spielt und die Gegenseite zufällig zieht. Dient nur zur Auswahl unter gleichwertigen Zügen.
const BAIT = new Map();
function bait(b, side, me) {
  const w = lineWinner(b);
  if (w !== null) return w === me ? 1 : 0;
  const key = (code(b) * 2 + side) * 2 + me;
  const hit = BAIT.get(key);
  if (hit !== undefined) return hit;
  const cells = [];
  for (let i = 0; i < 9; i++) if (b[i] === null) cells.push(i);
  let res;
  if (!cells.length) res = 0.5;
  else if (side === me) {
    let best = -Infinity; let arg = [];
    for (const i of cells) {
      b[i] = side;
      const v = lineWinner(b) !== null ? 10 : flip(negamax(b, 1 - side));
      if (v > best) { best = v; arg = [i]; } else if (v === best) arg.push(i);
      b[i] = null;
    }
    res = Math.max(...arg.map((i) => { b[i] = side; const e = bait(b, 1 - side, me); b[i] = null; return e; }));
  } else {
    let sum = 0;
    for (const i of cells) { b[i] = side; sum += bait(b, 1 - side, me); b[i] = null; }
    res = sum / cells.length;
  }
  BAIT.set(key, res);
  return res;
}

// Unter allen gleich guten Zügen bevorzugt er die, bei denen die Gegenseite am leichtesten danebenzieht (ohne selbst etwas zu riskieren).
const CORNERS = [0, 2, 6, 8];
function perfect3(g, me, rng) {
  const b = g.board.slice();
  // Leeres Feld: Alle Eröffnungen sind gleich gut (Ecke ist die beste Falle). Das spart die Rechenzeit der allerersten Suche.
  if (b.every((v) => v === null)) return pick(CORNERS, rng);
  let best = -Infinity;
  let moves = [];
  for (let i = 0; i < 9; i++) {
    if (b[i] !== null) continue;
    b[i] = me;
    const v = lineWinner(b) !== null ? 10 : flip(negamax(b, 1 - me));
    b[i] = null;
    if (v > best) { best = v; moves = [i]; } else if (v === best) moves.push(i);
  }
  if (moves.length > 1) {
    const scored = moves.map((i) => { b[i] = me; const e = bait(b, 1 - me, me); b[i] = null; return { i, e }; });
    const top = Math.max(...scored.map((x) => x.e));
    moves = scored.filter((x) => x.e >= top - 1e-9).map((x) => x.i);
  }
  return moves.length ? pick(moves, rng) : null;
}

// ---------- Mittel, 5×5: sofort gewinnen, sofort blocken, sonst Reihen bewerten ----------
const OWN = [1, 6, 40, 0];
const BLOCK = [0, 3, 24, 0];
function heuristic(g, me, rng) {
  const n = g.size; const k = g.k;
  const b = g.board.slice();
  const lines = winLines(n, k);
  const wins = winningCells(b, n, k, me);
  if (wins.length) return pick(wins, rng);
  const blocks = winningCells(b, n, k, 1 - me);
  if (blocks.length) return pick(blocks, rng);
  const mid = (n - 1) / 2;
  // offene Drohungen (k-1 eigene + 1 freies Feld), die ein Zug von `side` auf Feld p erzeugen würde
  const threatsAfter = (p, side) => {
    b[p] = side;
    let t = 0;
    for (const ln of lines) {
      if (!ln.includes(p)) continue;
      let mine = 0; let empty = 0;
      for (const q of ln) { if (b[q] === side) mine++; else if (b[q] === null) empty++; }
      if (mine === k - 1 && empty === 1) t++;
    }
    b[p] = null;
    return t;
  };
  const scored = [];
  for (let p = 0; p < b.length; p++) {
    if (b[p] !== null) continue;
    let s = 0;
    for (const ln of lines) {
      if (!ln.includes(p)) continue;
      let mine = 0; let opp = 0;
      for (const q of ln) { if (b[q] === me) mine++; else if (b[q] === 1 - me) opp++; }
      if (opp === 0) s += OWN[mine];
      else if (mine === 0) s += BLOCK[opp];
    }
    if (threatsAfter(p, me) >= 2) s += 500;
    if (threatsAfter(p, 1 - me) >= 2) s += 300;
    s -= (Math.abs(Math.floor(p / n) - mid) + Math.abs((p % n) - mid)) * 0.8; // Mitte etwas bevorzugt
    scored.push({ p, s });
  }
  if (!scored.length) return null;
  const top = Math.max(...scored.map((x) => x.s));
  return pick(scored.filter((x) => x.s >= top - 0.5).map((x) => x.p), rng);
}

// Ein Zufallszug ist nie ein „Verschenken auf einen Blick“: Felder, nach denen die Gegenseite sofort gewinnen könnte, werden gemieden.
// Bei 3×3 führt er außerdem nur in SLIP_LOSING_SHARE der Fälle in eine verlorene Stellung. So kann ein Mensch gelegentlich
// gewinnen, der Computer wirkt aber nicht leichtsinnig.
export const SLIP_LOSING_SHARE = 0.4;
function slipCells(g, me, cells, rng) {
  const b = g.board.slice();
  const safe = cells.filter((p) => {
    b[p] = me;
    const bad = winningCells(b, g.size, g.k, 1 - me).length > 0;
    b[p] = null;
    return !bad;
  });
  if (!safe.length) return cells;
  if (g.size === 3 && rng() >= SLIP_LOSING_SHARE) {
    const fine = safe.filter((p) => {
      b[p] = me;
      const v = lineWinner(b) !== null ? 10 : flip(negamax(b, 1 - me));
      b[p] = null;
      return v >= 0;
    });
    if (fine.length) return fine;
  }
  return safe;
}

function mediumAction(g, me, rng) {
  const cells = free(g.board);
  if (!cells.length) return null;
  if (rng() < MEDIUM_SLIP) return pick(slipCells(g, me, cells, rng), rng);
  return g.size === 3 ? perfect3(g, me, rng) : heuristic(g, me, rng);
}

// ---------- Einstieg ----------
export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.mode !== 'play' || !Array.isArray(state.players) || !Array.isArray(state.board)) return null;
  const me = state.players.findIndex((p) => p.id === botId);
  if (me < 0 || state.turn !== me) return null;
  const p = level >= 1 ? mediumAction(state, me, rng) : easyAction(state, me, rng);
  return p === null || p === undefined ? null : { t: 'place', p };
}
