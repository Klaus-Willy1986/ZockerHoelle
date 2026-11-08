// Galgenmännchen – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels oder null.
// Stufen: 0 = Leicht, 1 = Mittel.
//
// Der Computer schummelt nicht: Er liest nur Öffentliches – die Striche (state.mask), die schon geratenen Buchstaben
// (state.guessed), die falsch geratenen Wörter (state.badWords) und die Fehlerzahl. Das gesuchte Wort (state.word)
// und die Kategorie werden nie gelesen. Wissen über die Wortliste ist erlaubt.
//  Leicht: rät Buchstaben nach Zufall, bevorzugt aber häufige (Reihenfolge E N I R S A T D H U L C G M O B W F K Z P V J Y X Q,
//          dann Ä Ö Ü), und meidet in gut jedem dritten Zug Buchstaben, die zu keinem passenden Listenwort gehören.
//          Rät nie das ganze Wort.
//  Mittel: nimmt alle Wörter der Wortliste, die zu Länge, aufgedeckten Buchstaben und den Fehlversuchen passen,
//          und rät den Buchstaben, der in den meisten dieser Wörter vorkommt. Bleibt nur noch ein passendes Wort
//          übrig, rät er das ganze Wort.
import { WOERTER } from './woerter.js';
import { KEYS, GAME } from './engine.js';

export const EASY_ORDER = 'ENIRSATDHULCGMOBWFKZPVJYXQÄÖÜ'.split('');
export const EASY_DECAY = 0.82; // Gewicht des Buchstabens an Stelle k der Liste = EASY_DECAY ^ k
export const EASY_SMART = 0.35; // Anteil der Züge, in denen Leicht unmögliche Buchstaben meidet
export const DELAY_MS = 1200;

const LIST = WOERTER.map((x) => x.w);

// Passende Wörter der Liste zu dem, was alle sehen (ß-Stellen sind von Anfang an offen).
export function candidates(state) {
  const mask = state.mask;
  const guessed = new Set(state.guessed);
  const bad = new Set(state.badWords || []);
  const out = [];
  for (const w of LIST) {
    if (w.length !== mask.length || bad.has(w)) continue;
    let ok = true;
    for (let i = 0; i < w.length && ok; i++) {
      const c = w[i];
      if (mask[i] !== null) ok = c === mask[i];
      else ok = !guessed.has(c);
    }
    if (ok) out.push(w);
  }
  return out;
}

function pickWeighted(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== GAME || state.phase !== 'play' || !Array.isArray(state.mask)) return null;
  const cur = state.players[state.turn];
  if (!cur || cur.id !== botId) return null;
  const guessed = new Set(state.guessed);
  const free = KEYS.filter((k) => !guessed.has(k));
  if (!free.length) return null;
  if (level === 1) {
    const cands = candidates(state);
    if (cands.length === 1) return { t: 'word', w: cands[0], r: state.round };
    if (cands.length > 1) {
      const cnt = {};
      for (const w of cands) for (const c of new Set(w)) cnt[c] = (cnt[c] || 0) + 1;
      let best = null;
      for (const k of free) {
        const n = cnt[k] || 0;
        if (n > 0 && (best === null || n > cnt[best])) best = k;
      }
      if (best) return { t: 'letter', l: best, r: state.round };
    }
    // Wort nicht in der Liste: wie "Leicht" weiterraten
  }
  // Leicht: zufällig, aber bevorzugt häufige Buchstaben aus der Liste; mit Wissen über die Liste nur so weit,
  // dass sie Buchstaben meidet, die in keinem passenden Wort vorkommen (Wahrscheinlichkeit EASY_SMART).
  let order = EASY_ORDER.filter((k) => !guessed.has(k));
  if (rng() < EASY_SMART) {
    const inCand = new Set();
    for (const w of candidates(state)) for (const c of w) inCand.add(c);
    const narrowed = order.filter((k) => inCand.has(k));
    if (narrowed.length) order = narrowed;
  }
  const pool = order.length ? order : free;
  const l = pickWeighted(pool, pool.map((_, i) => EASY_DECAY ** i), rng);
  return { t: 'letter', l, r: state.round };
}
