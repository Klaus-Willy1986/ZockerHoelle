// Phasenwürfeln – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
import * as P from './engine.js';

const toMask = (idx) => {
  const keep = Array(P.NUM_DICE).fill(false);
  idx.forEach((i) => { keep[i] = true; });
  return keep;
};
// Mindestens ein Würfel muss neu gewürfelt werden.
const leaveOneFree = (keep, rng) => {
  if (keep.every(Boolean)) keep[Math.min(P.NUM_DICE - 1, Math.floor(rng() * P.NUM_DICE))] = false;
  return keep;
};

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.mode === 'over' || !state.turn) return null;
  const ap = P.activePlayer(state);
  if (!ap || ap.id !== botId || ap.stopped) return null;
  const t = state.turn;
  if (t.stage === 'roll') return { t: 'roll' };
  if (t.stage !== 'choose' || !t.dice || !t.eval) return null;
  const canRoll = t.attempt < P.MAX_ATTEMPTS;
  const done = { t: 'finish', note: true }; // „Punkte nicht eintragen“ nutzt der Computer nie

  if (t.eval.ok) {
    if (!canRoll || t.final || level <= 0) return done;
    // Mittel: Nur die nicht benötigten Würfel neu würfeln – die Phase bleibt sicher, die Punkte können nur steigen.
    if (rng() < 0.15) return done;
    const keep = toMask(t.eval.used.map((u) => u.i));
    return keep.every(Boolean) ? done : { t: 'roll', keep };
  }
  if (!canRoll) return done;

  const idx = P.suggestKeep(t.dice, ap.phaseNo);
  let keep;
  if (level <= 0) {
    keep = rng() < 0.6 ? toMask(idx) : t.dice.map(() => rng() < 0.45);
  } else {
    keep = toMask(idx);
    if (rng() < 0.08 && idx.length > 1) keep[idx[Math.floor(rng() * idx.length)]] = false; // kleiner Fehlgriff
  }
  return { t: 'roll', keep: leaveOneFree(keep, rng) };
}
