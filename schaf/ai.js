// Schafskopp – Computergegner (reine Funktionen, keine Oberfläche). Stufen: 0 = Leicht, 1 = Mittel.
// Mittel übersieht nie eine anlegbare Karte; Leicht übersieht sie mit 15 % Wahrscheinlichkeit.
import * as M from './engine.js';

export const MISS_CHANCE = 0.15;

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.game !== 'sk' || g.phase !== 'play') return null;
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  const src = M.fittingSources(g); // in Sitzreihenfolge ab mir
  const mine = src.includes(botId);
  const miss = level <= 0 && src.length > 0 && rng() < MISS_CHANCE;
  if (src.length && !miss) return { t: 'place', from: mine ? botId : src[0] };
  if (mine) return { t: 'end' }; // übersehen: eigene Karte liegt noch oben, Aufdecken ist verboten
  if (ap.deck.length) return { t: 'flip' };
  return src.length || M.anyFit(g) ? { t: 'end' } : null;
}
