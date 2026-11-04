// Kreuz & Quer – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
// Rückgabe: Nachricht wie ein Mensch sie schickt ({ t: 'roll' } oder { t: 'pick', move }) oder null.
import * as E from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const asMsg = (m) => ({ t: 'pick', move: m ? { color: m.color, idx: m.idx } : null });

// Übersprungene Felder, wenn in dieser Reihe an Stelle idx angekreuzt wird.
const gapOf = (player, m) => m.idx - (E.lastMarkedIndex(player.rows[m.color]) + 1);

function leicht(moves, rng) {
  if (moves.length && rng() < 0.6) return asMsg(pick(moves, rng));
  return asMsg(null);
}

function mittel(state, botId, moves, rng) {
  const me = state.players.find((p) => p.id === botId);
  const closedCount = E.COLORS.filter((c) => state.closed[c]).length;
  // In frühen Runden wird strenger ausgewählt, später darf die Lücke größer sein.
  let maxGap = state.round <= 3 ? 1 : state.round <= 8 ? 2 : 3;
  if (closedCount >= 1 || me.penalties >= 2) maxGap += 1;
  // Wer am Zug ist und noch nichts angekreuzt hat, vermeidet den Fehlwurf (kreuzt dann auch mit großer Lücke).
  const mustCross = state.phase === 'color' && state.players[state.active].id === botId && state.turnCrosses[botId] === 0;
  const myTotal = E.scoreOf(me).total;
  const bestOther = Math.max(...state.players.filter((p) => p.id !== botId).map((p) => E.scoreOf(p).total), -99);

  const scored = moves.map((m) => {
    const row = me.rows[m.color];
    const n = E.crossCount(row);
    const gap = gapOf(me, m);
    let s = (E.POINTS[n + 1] - E.POINTS[n]) * 1.2 - gap * 3.5 + rng() * 3;
    const locks = m.idx === E.ROW_LEN - 1;
    if (locks) {
      s += 12;
      // Zweite Sperre beendet das Spiel: nur, wenn er dabei nicht klar hinten liegt.
      if (closedCount >= 1 && myTotal + E.POINTS[n + 2] - E.POINTS[n] < bestOther - 4) s -= 100;
    }
    return { m, gap, s, locks };
  }).sort((a, b) => b.s - a.s);

  if (!scored.length) return asMsg(null);
  if (mustCross) {
    const safe = scored.filter((x) => !x.locks || x.s > -50);
    const list = safe.length ? safe : scored;
    return asMsg(list.slice().sort((a, b) => (a.gap - b.gap) || (b.s - a.s))[0].m);
  }
  const ok = scored.filter((x) => (x.locks && x.s > -50) || x.gap <= maxGap);
  if (!ok.length) return asMsg(null);
  if (rng() < 0.1) return asMsg(null); // ab und zu etwas Zufall
  return asMsg(ok[0].m);
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.phase === 'over') return null;
  if (state.phase === 'roll') {
    return state.players[state.active].id === botId ? { t: 'roll' } : null;
  }
  if (!E.waitingFor(state).includes(botId)) return null;
  const moves = E.legalMoves(state, botId);
  return level >= 1 ? mittel(state, botId, moves, rng) : leicht(moves, rng);
}
