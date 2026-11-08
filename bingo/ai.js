// Bingo – Computer als Mitspieler (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels (mark oder bingo) oder null.
// Stufen: 0 = Leicht, 1 = Mittel.
//
// Der Computer schummelt nicht: Er benutzt nur seine eigene Karte, seine eigenen Markierungen und die öffentlich
// gezogenen Zahlen. Karten und Markierungen der anderen liest er nie.
//  - Er markiert gezogene Zahlen nach 1 bis 3 Sekunden (markDelay) – und überhört einen Teil der Zahlen:
//    Leicht 15 %, Mittel 3 %. Welche, ist eine feste Zufallsfunktion von (Partie, Runde, Computer, Zahl);
//    so entscheidet er nach einem Neuladen der Seite genauso.
//  - Sobald seine Karte gültig ist, ruft er nach 1 bis 2 Sekunden BINGO (bingoDelay).
import * as E from './engine.js';

export const MISS = [0.15, 0.03];
export const MARK_MIN = 1000;
export const MARK_MAX = 3000;
export const BINGO_MIN = 1000;
export const BINGO_MAX = 2000;

export const markDelay = (rng = Math.random) => Math.round(MARK_MIN + rng() * (MARK_MAX - MARK_MIN));
export const bingoDelay = (rng = Math.random) => Math.round(BINGO_MIN + rng() * (BINGO_MAX - BINGO_MIN));

// Feste "Zufallszahl" in [0,1) aus ganzen Zahlen
function hash(a, b, c, d) {
  let x = (a ^ Math.imul(b + 1, 0x9E3779B1) ^ Math.imul(c + 7, 0x85EBCA6B) ^ Math.imul(d + 13, 0xC2B2AE35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const idNum = (id) => { let h = 0; for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return h; };

// Hat der Computer diese Zahl mitbekommen?
export function notices(state, botId, level, n) {
  const miss = MISS[level === 1 ? 1 : 0];
  return hash((state.seed | 0) ^ Math.imul(state.round | 0, 0x27d4eb2f), idNum(botId), n, 5) >= miss;
}

export function chooseAction(state, botId, level, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!state || state.game !== E.GAME || state.phase !== 'play' || !Array.isArray(state.players)) return null;
  if (!state.players.some((p) => p.id === botId)) return null;
  const marks = state.marks && state.marks[botId];
  const cards = state.cards && state.cards[botId];
  if (!marks || !cards) return null;
  if (marks.some((m) => E.validMarks(m, !!state.full))) return { t: 'bingo' };
  const lv = level === 1 ? 1 : 0;
  for (const n of state.drawn) { // in der Reihenfolge des Ziehens
    if (!notices(state, botId, lv, n)) continue;
    for (let c = 0; c < cards.length; c++) {
      const i = cards[c].findIndex((v, k) => k !== E.FREE && v === n && marks[c][k] !== 1);
      if (i >= 0) return { t: 'mark', c, i };
    }
  }
  return null;
}

// Wie lange der Computer für diese Nachricht braucht
export const delayFor = (msg, rng = Math.random) => (msg && msg.t === 'bingo' ? bingoDelay(rng) : markDelay(rng));
