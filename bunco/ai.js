// Bunco – Computergegner. Es gibt keine Entscheidungen: Der Computer würfelt, wenn er dran ist (Leicht und Mittel spielen gleich).
import * as M from './engine.js';

export function chooseAction(g, botId, level = 0, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!g || g.game !== M.GAME || !Array.isArray(g.players) || g.phase === 'over') return null;
  if (g.phase === 'between') return { t: 'next' };
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  return { t: 'roll' };
}
