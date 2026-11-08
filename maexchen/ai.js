// Mäxchen – Computergegner (reine Funktionen). Stufen: 0 = Leicht, 1 = Mittel.
// Der Computer nutzt nur den EIGENEN Wurf (nur wenn er gerade unter dem Becher nachsieht) und die Ansagen.
// Den Becher anderer Personen (g.cup in der Entscheidungsphase) liest er nie.
import * as M from './engine.js';

export const EASY_TRUTH = 0.5; // Leicht sagt zu 50 % die Wahrheit
export const EASY_DOUBT = 0.3; // Leicht zweifelt zufällig mit 30 %
export const MEDIUM_DOUBT_BELOW = 0.35; // Mittel zweifelt, wenn die Ansage wahrscheinlich gelogen ist
export const MEDIUM_NOISE = 0.1; // Mittel: 10 % Zufall
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.game !== M.GAME || !Array.isArray(g.players)) return null;
  if (g.phase === 'over') return null;
  if (g.phase === 'reveal') return { t: 'next' };
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  const higher = M.allowedSays(g);

  if (g.phase === 'roll') return { t: 'roll' };

  if (g.phase === 'announce') {
    if (!higher.length) return null;
    const real = g.cup; // eigener Wurf: der Computer hat selbst gewürfelt
    const okReal = M.isValue(real) && higher.includes(real);
    if (level <= 0) {
      if (okReal && rng() < EASY_TRUTH) return { t: 'say', v: real };
      return { t: 'say', v: pick(higher, rng) };
    }
    if (M.isValue(real) && real === M.MAEXCHEN) return { t: 'say', v: real };
    if (rng() < MEDIUM_NOISE) return { t: 'say', v: pick(higher, rng) };
    if (okReal) return { t: 'say', v: real }; // wahr
    return { t: 'say', v: higher[0] }; // gelogen, aber nur minimal höher als nötig
  }

  if (g.phase === 'decide') {
    const a = g.announced;
    if (a === M.MAEXCHEN) return { t: 'doubt' }; // Überbieten unmöglich
    if (level <= 0) return rng() < EASY_DOUBT ? { t: 'doubt' } : { t: 'believe' };
    let doubt = M.probAtLeast(a) < MEDIUM_DOUBT_BELOW;
    if (rng() < MEDIUM_NOISE) doubt = !doubt;
    return doubt ? { t: 'doubt' } : { t: 'believe' };
  }
  return null;
}
