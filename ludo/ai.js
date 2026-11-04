// Ludo – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
import * as P from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Welche fremden Figuren stehen auf dem Rundweg-Feld abs (0..39)?
function enemiesAt(state, me, abs) {
  let n = 0;
  for (const o of state.players) {
    if (o === me) continue;
    for (const q of o.pieces) if (q >= 0 && q <= 39 && P.ringIndex(o.color, q) === abs) n++;
  }
  return n;
}

// Wie bedroht ist Rundweg-Feld abs für Person me? (Gegner 1–6 Felder dahinter, oder Einsteigen auf deren Startfeld)
function threat(state, me, abs, skipAbs = -1) {
  let t = 0;
  for (const o of state.players) {
    if (o === me) continue;
    for (const q of o.pieces) {
      if (q < 0 || q > 39) continue;
      const e = P.ringIndex(o.color, q);
      if (e === skipAbs) continue;
      const d = (abs - e + P.RING) % P.RING;
      if (d >= 1 && d <= 6) t += 1;
    }
    if (P.homeCount(o) > 0 && abs === P.startIndex(o.color)) t += 0.5;
  }
  return t;
}

function scoreMove(state, me, m, rng) {
  const toRing = m.to >= 0 && m.to <= 39;
  const abs = toRing ? P.ringIndex(me.color, m.to) : -1;
  let s = rng() * 6; // leichter Zufall bei Gleichstand
  const caps = toRing ? enemiesAt(state, me, abs) : 0;
  if (caps) s += 100 + 10 * caps;
  if (m.to >= P.GOAL_FIRST) {
    s += 45;
    if (m.to === P.GOAL_LAST) s += 5;
  }
  if (m.from < 0) s += 38; // Figur herausstellen
  if (m.from === 0 && P.homeCount(me) > 0) s += 12; // Startfeld freimachen
  if (m.from >= 0 && m.from <= 39) {
    const t0 = threat(state, me, P.ringIndex(me.color, m.from));
    if (t0 > 0) s += 22 + 8 * t0; // aus Gefahr retten
  }
  if (toRing && !caps) {
    const t1 = threat(state, me, abs);
    if (t1 > 0) s -= 20 + 8 * t1; // nicht in Gefahr laufen
  }
  s += m.to * 0.25; // Vorwärtsdrang
  return s;
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.mode !== 'play') return null;
  const ap = P.activePlayer(state);
  if (!ap || ap.id !== botId || !state.turn) return null;
  const t = state.turn;
  if (t.stage === 'roll') return { t: 'roll' };
  if (t.stage !== 'move') return null;
  const moves = P.legalMoves(state, state.active, t.die).filter((m) => t.movable.includes(m.piece));
  if (!moves.length) return null;
  if (moves.length === 1) return { t: 'move', piece: moves[0].piece };
  let chosen;
  if (level <= 0) {
    const caps = moves.filter((m) => m.to >= 0 && m.to <= 39 && enemiesAt(state, ap, P.ringIndex(ap.color, m.to)) > 0);
    chosen = caps.length && rng() < 0.4 ? pick(caps, rng) : pick(moves, rng);
  } else {
    let best = -Infinity;
    for (const m of moves) {
      const s = scoreMove(state, ap, m, rng);
      if (s > best) { best = s; chosen = m; }
    }
  }
  return { t: 'move', piece: chosen.piece };
}
