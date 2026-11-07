// Schafskopp – Computergegner (reine Funktionen, keine Oberfläche). Stufen: 0 = Leicht, 1 = Mittel.
// Mittel macht nie einen Fehler; Leicht macht mit 15 % Wahrscheinlichkeit pro Entscheidung einen Fehler.
import * as M from './engine.js';

export const MISTAKE_CHANCE = 0.15;
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.game !== 'sk' || g.phase !== 'play') return null;
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  if (g.source === null || g.source === undefined) return ap.deck.length ? { t: 'flip' } : null;
  const card = M.curCard(g);
  if (!card) return null;
  const tg = M.targetsFor(g, card, botId);
  // richtiger Zug: Mitte, sonst aufdrücken (bei der Person mit den meisten Karten, Gleichstand: Sitzreihenfolge), sonst bei sich
  const right = () => {
    if (tg.center) return { t: 'place', to: 'center' };
    if (tg.others.length) {
      let best = tg.others[0];
      let bn = -1;
      for (const id of tg.others) { const q = g.players.find((p) => p.id === id); const n = q.deck.length + q.pile.length; if (n > bn) { bn = n; best = id; } }
      return { t: 'place', to: 'other', pid: best };
    }
    return { t: 'place', to: 'own' };
  };
  if (level <= 0 && rng() < MISTAKE_CHANCE) {
    const errs = [];
    if (g.source === 'open' && ap.deck.length) errs.push({ t: 'flip' }); // (a)
    if (g.source === 'flipped' && (tg.center || tg.others.length)) errs.push({ t: 'place', to: 'own' }); // (b)
    if (tg.center && tg.others.length) errs.push({ t: 'place', to: 'other', pid: pick(tg.others, rng) }); // (c)
    if (errs.length) return pick(errs, rng);
  }
  return right();
}
