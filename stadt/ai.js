// Stadt, Land, Fluss – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel.
//
// Der Computer ist ein simulierter Mitspieler und antwortet nur aus dem eingebauten Wörterbuch (nie "ungeprüft").
//   Wissen:   Leicht kennt je Kategorie nur 50 % der vorhandenen Wörter zum Buchstaben, Mittel 90 %.
//             Welche Wörter er kennt, ist fest (deterministische Teilmenge je Computer-Id + Buchstabe + Kategorie).
//   Lücken:   Leicht lässt 25 % der Felder leer, Mittel 5 %.
//   Auswahl:  zufällig unter den Wörtern, die er kennt.
//   Zeit:     3 bis 8 Sekunden (thinkDelay).
// Der Computer sieht nie die Entwürfe der anderen: chooseAction liest nur Buchstabe, Kategorien und die eigene Id.
import { WOERTER } from './woerter.js';
import { norm } from './engine.js';

export const KNOW = [0.5, 0.9];
export const BLANK = [0.25, 0.05];
export const DELAY_MIN = 3000;
export const DELAY_MAX = 8000;

export const thinkDelay = (rng = Math.random) => Math.round(DELAY_MIN + rng() * (DELAY_MAX - DELAY_MIN));

// kleine, stabile Streuwertfunktion (FNV-1a) -> [0, 1)
export function hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 4294967296;
}

// Wörter, die dieser Computer zu Buchstabe und Kategorie "kennt" (fest, unabhängig vom Zufall).
export function knownWords(botId, letter, catId, level) {
  const lv = level === 1 ? 1 : 0;
  const lc = String(letter).toLowerCase();
  const all = (WOERTER[catId] || []).filter((w) => norm(w)[0] === lc);
  const scored = all.map((w) => ({ w, h: hash01(`${botId}|${letter}|${catId}|${w}`) }));
  const keep = scored.filter((x) => x.h < KNOW[lv]);
  if (!keep.length && scored.length) keep.push(scored.reduce((a, b) => (b.h < a.h ? b : a)));
  return keep.map((x) => x.w);
}

// Gibt { t:'answers', r, v:[Wörter] } für den Computer zurück oder null, wenn er nichts tun kann.
export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== 'sl' || state.phase !== 'fill' || !Array.isArray(state.cats)) return null;
  if (!state.players.some((p) => p.id === botId) || (state.done && state.done[botId])) return null;
  const lv = level === 1 ? 1 : 0;
  const v = state.cats.map((catId) => {
    if (rng() < BLANK[lv]) return '';
    const known = knownWords(botId, state.letter, catId, lv);
    if (!known.length) return '';
    return known[Math.min(known.length - 1, Math.floor(rng() * known.length))];
  });
  return { t: 'answers', r: state.round, v };
}
