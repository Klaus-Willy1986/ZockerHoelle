// Barrikade – Computergegner (reine Funktionen, kein DOM). Regelzugriff nur über engine.js.
// chooseAction(state, botId, level, rng) -> {t:'roll'} | {t:'move', piece, to} | {t:'place', node} | null
// level 0 = Leicht (Zufall), level 1 = Mittel (Heuristik mit Wegentfernungen).
import * as E from './engine.js';

const BARRIER_COST = 3; // grobe Schätzung: eine Sperre auf dem Weg kostet etwa so viele Schritte extra
const FAR = 99;
const PATZER_ZUG = 0.4; // Anteil zufälliger Züge der Stufe Mittel
const PATZER_SPERRE = 0.35; // Anteil zufällig gesetzter Sperren der Stufe Mittel

// Kürzeste (gewichtete) Entfernung aller Felder zum Ziel; Sperren kosten Aufschlag. Einmal pro Aufruf, 112 Knoten.
export function distances(barriers) {
  const bar = new Set(barriers);
  const d = {};
  for (const id of E.NODE_IDS) d[id] = FAR;
  d[E.GOAL] = 0;
  const q = [E.GOAL];
  for (let i = 0; i < q.length; i++) {
    const x = q[i];
    const w = 1 + (bar.has(x) ? BARRIER_COST : 0); // Schritt von y nach x
    for (const y of E.NODES[x].nbrs) {
      if (d[x] + w < d[y]) { d[y] = d[x] + w; q.push(y); }
    }
  }
  return d;
}

const pieceDist = (d, p) => (p.pos === 'H' ? d[E.START_NODE[p.color]] + 1 : d[p.pos]);
const bestDist = (d, s, color) => {
  let b = FAR;
  for (const p of s.pieces) if (p.color === color) b = Math.min(b, pieceDist(d, p));
  return b;
};
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

function chooseMoveEasy(s, moves, rng) {
  const win = moves.find((m) => m.to === E.GOAL);
  if (win) return win;
  const grabs = moves.filter((m) => s.barriers.includes(m.to));
  if (grabs.length && rng() < 0.3) return pick(grabs, rng);
  return pick(moves, rng);
}

function chooseMoveMedium(s, moves, rng) {
  const win = moves.find((m) => m.to === E.GOAL);
  if (win) return win;
  if (rng() < PATZER_ZUG) return pick(moves, rng); // gelegentlich ein weniger kluger Zug: bleibt schlagbar
  const color = E.activePlayer(s).color;
  const d = distances(s.barriers);
  const myBest = bestDist(d, s, color);
  const byId = Object.fromEntries(s.pieces.map((p) => [p.id, p]));
  const victimAt = new Map(s.pieces.filter((p) => p.pos !== 'H' && p.color !== color).map((p) => [p.pos, p]));
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const p = byId[m.piece];
    const from = pieceDist(d, p);
    const to = d[m.to];
    let score = from - to; // Fortschritt zum Ziel
    score -= to * 0.12; // lieber die vorderste Figur weiterbringen
    const v = victimAt.get(m.to);
    if (v) score += 3 + Math.max(0, d[E.START_NODE[v.color]] + 1 - to) * 0.35; // je weiter vorn die Figur, desto lieber
    if (s.barriers.includes(m.to)) {
      const d2 = distances(s.barriers.filter((b) => b !== m.to));
      score += 2 + Math.max(0, myBest - bestDist(d2, s, color)) * 0.8;
    }
    score += rng() * 1.6;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function chooseNodeEasy(targets, rng) { return pick(targets, rng); }

function chooseNodeMedium(s, targets, rng) {
  if (rng() < PATZER_SPERRE) return pick(targets, rng);
  const me = E.activePlayer(s);
  const foes = s.players.filter((p) => p.color !== me.color).map((p) => p.color);
  const base = distances(s.barriers);
  const foeBase = foes.map((c) => bestDist(base, s, c));
  const myBase = bestDist(base, s, me.color);
  const lead = Math.min(...foeBase);
  let best = null;
  let bestScore = -Infinity;
  for (const node of targets) {
    const d = distances([...s.barriers, node]);
    let score = 0;
    foes.forEach((c, i) => {
      const inc = bestDist(d, s, c) - foeBase[i];
      score += inc * (foeBase[i] === lead ? 1 : 0.35); // vor allem die Führenden aufhalten
    });
    score -= (bestDist(d, s, me.color) - myBase) * 2.5; // den eigenen Weg nicht verbauen
    for (const p of s.pieces) if (p.color === me.color && p.pos !== 'H') score -= Math.max(0, pieceDist(d, p) - pieceDist(base, p)) * 0.3;
    score += rng() * 2;
    if (score > bestScore) { bestScore = score; best = node; }
  }
  return best;
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.phase === 'over' || state.phase === undefined) return null;
  const ap = E.activePlayer(state);
  if (!ap || ap.id !== botId) return null;
  if (state.phase === 'roll') return { t: 'roll' };
  if (state.phase === 'move') {
    const moves = E.legalMoves(state);
    if (!moves.length) return null;
    const m = level >= 1 ? chooseMoveMedium(state, moves, rng) : chooseMoveEasy(state, moves, rng);
    return m ? { t: 'move', piece: m.piece, to: m.to } : null;
  }
  if (state.phase === 'place') {
    const targets = E.placeTargets(state);
    if (!targets.length) return null;
    return { t: 'place', node: level >= 1 ? chooseNodeMedium(state, targets, rng) : chooseNodeEasy(targets, rng) };
  }
  return null;
}
