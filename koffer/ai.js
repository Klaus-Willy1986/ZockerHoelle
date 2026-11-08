// Ich packe meinen Koffer – Computer als Mitspieler (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels oder null.
// Stufen: 0 = Leicht, 1 = Mittel.
//
// Simuliertes Gedächtnis (dokumentierte Ausnahme: Der Computer "sieht" die Liste nicht wirklich an, er würfelt nur,
// ob er sie behalten hätte – wie ein Mensch, der sich irgendwann vertut; kein Mensch sieht dabei etwas Verdecktes):
// Die Engine gibt die Liste nur über E.botList(state, botId) heraus (nur für den Computer, der gerade dran ist).
// Jedes Ding auf Platz k (1 = erstes) wird mit der Wahrscheinlichkeit p(k) = A · D^(k-1) richtig erinnert.
// Vergisst der Computer auch nur ein Ding, macht er in diesem Zug genau einen Fehler (an der ersten vergessenen Stelle
// wählt er ein anderes Ding). Weil in jedem Zug die ganze Liste erinnert werden muss, scheitert er im Mittel (Median):
//   Leicht: A = 0,9995, D = 0,995  -> bei Listenlänge etwa 10
//   Mittel: A = 0,9999, D = 0,999  -> bei Listenlänge etwa 17
// Außer der Liste (über die Engine) benutzt er nur das Angebot (offer) und das Raster (grid) dieses Zuges.
import * as E from './engine.js';

export const MEMORY = [
  { A: 0.9995, D: 0.995 }, // Leicht
  { A: 0.9999, D: 0.999 }, // Mittel
];
export const recallProb = (level, k) => { const m = MEMORY[level === 1 ? 1 : 0]; return Math.min(1, m.A * Math.pow(m.D, Math.max(0, k - 1))); };
export const surviveProb = (level, n) => { let p = 1; for (let k = 1; k <= n; k++) p *= recallProb(level, k); return p; };

// Denkzeit des Computers: 0,25 s pro Ding der Liste, höchstens 4 s, mindestens 0,9 s.
export const thinkMs = (n) => Math.max(900, Math.min(4000, Math.round(250 * n)));

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

export function chooseAction(game, botId, level, rng = Math.random) {
  if (!game || game.mode !== 'play' || !Array.isArray(game.players)) return null;
  if (game.phase === 'result') {
    const actor = game.last && game.players[game.last.by];
    return actor && actor.id === botId ? { t: 'weiter' } : null;
  }
  const cur = game.players[game.turn];
  if (!cur || cur.id !== botId || game.phase !== 'play') return null;
  const list = E.botList(game, botId);
  const offer = Array.isArray(game.offer) ? game.offer : [];
  if (!offer.length) return null;
  const add = pick(offer, rng);
  const seq = list.slice();
  const forgot = list.findIndex((id, k) => rng() >= recallProb(level, k + 1));
  if (forgot >= 0) {
    const others = (Array.isArray(game.grid) ? game.grid : []).filter((id) => id !== list[forgot] && !seq.slice(0, forgot).includes(id));
    seq[forgot] = others.length ? pick(others, rng) : '?';
  }
  return { t: 'submit', seq, add };
}
