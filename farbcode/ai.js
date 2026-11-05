// Farbcode knacken – Computer als Rateperson (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
//  Mittel: wählt immer einen Code, der zu allen bisherigen Auswertungen passt (im Schnitt rund 4,7 Versuche).
//  Leicht: mit 40 % Wahrscheinlichkeit irgendein beliebiger Code, sonst ein Code, der zu den letzten drei
//          Auswertungen passt (ältere „vergisst“ er) – im Schnitt rund 6 bis 7 Versuche, gelegentlich ohne Erfolg.
import * as F from './engine.js';

const ALL = F.allCodes();
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const FIRST = [0, 0, 1, 1];
export const EASY_RANDOM = 0.4;
export const EASY_MEMORY = 3;

// Alle Codes, die zu den bisherigen Versuchen und Auswertungen passen.
export function consistent(guesses) {
  return ALL.filter((c) => guesses.every((x) => {
    const r = F.evaluate(c, x.g);
    return r.b === x.b && r.w === x.w;
  }));
}

export function chooseGuess(game, level, rng = Math.random) {
  const hist = game.guesses;
  if (level === 0 && rng() < EASY_RANDOM) return pick(ALL, rng).slice();
  if (!hist.length) return level === 0 ? pick(ALL, rng).slice() : FIRST.slice();
  const cand = consistent(level === 0 ? hist.slice(-EASY_MEMORY) : hist);
  if (!cand.length) return pick(ALL, rng).slice(); // dürfte nie vorkommen
  return pick(cand, rng).slice();
}

// Wird vom Spiel aufgerufen: { id, msg } oder null, wenn der Computer nicht dran ist.
export function chooseAction(game, botId, level, rng = Math.random) {
  if (!game || game.mode !== 'guess') return null;
  if (F.guesserPlayer(game).id !== botId) return null;
  return { t: 'guess', g: chooseGuess(game, level, rng), n: game.guesses.length };
}
