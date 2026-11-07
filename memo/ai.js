// Paare finden – Computer als Mitspieler (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht des Spiels oder null.
// Stufen: 0 = Leicht, 1 = Mittel.
//
// Der Computer schummelt nicht: Er benutzt von den Karten nur das, was offen auf dem Tisch lag
// (state.reveals = öffentliche Aufdeckungen, state.st = Kartenstatus). state.cards (die verdeckten Bilder)
// wird nie gelesen. Sein "Gedächtnis" wird bei jedem Aufruf neu aus diesen öffentlichen Aufdeckungen berechnet;
// das Vergessen ist eine feste Zufallsfunktion von (Spiel, Karte, Runde) – so entscheidet er zwischen
// erstem und zweitem Aufdecken eines Zuges gleich und nach einem Neuladen der Seite genauso.
//  Leicht: merkt sich nur die letzten 2 aufgedeckten Karten, und auch die nur mit 60 % Zuverlässigkeit.
//  Mittel: merkt sich alle bisher aufgedeckten Karten, vergisst aber pro Runde jede Karte mit 8 % Wahrscheinlichkeit.
export const EASY_MEMORY = 2;
export const EASY_RELIABLE = 0.6;
export const MID_FORGET = 0.08;

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Feste "Zufallszahl" in [0,1) aus ganzen Zahlen
function hash(seed, a, b, c) {
  let x = (seed ^ Math.imul(a + 1, 0x9E3779B1) ^ Math.imul(b + 7, 0x85EBCA6B) ^ Math.imul(c + 13, 0xC2B2AE35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Was der Computer sich gemerkt hat: Liste { i, c } verdeckter Karten, deren Bild er (noch) weiß.
export function memory(g, level) {
  const out = [];
  const reveals = g.reveals || [];
  const n = Math.max(1, g.players.length);
  if (level === 0) {
    const from = Math.max(0, reveals.length - EASY_MEMORY);
    for (let k = from; k < reveals.length; k++) {
      const r = reveals[k];
      if (g.st[r.i] === 0 && hash(g.seed, r.i, k, 99) < EASY_RELIABLE && !out.some((x) => x.i === r.i)) out.push({ i: r.i, c: r.c });
    }
    return out;
  }
  const last = new Map(); // je Karte die jüngste Aufdeckung
  for (const r of reveals) last.set(r.i, r);
  for (const r of last.values()) {
    if (g.st[r.i] !== 0) continue;
    const rounds = Math.floor((g.turnNo - r.t) / n);
    let keeps = true;
    for (let k = 0; k < rounds && keeps; k++) if (hash(g.seed, r.i, r.t + k, 7) < MID_FORGET) keeps = false;
    if (keeps) out.push({ i: r.i, c: r.c });
  }
  return out;
}

export function chooseAction(game, botId, level, rng = Math.random) {
  if (!game || game.mode !== 'play') return null;
  const cur = game.players[game.turn];
  if (!cur || cur.id !== botId) return null;
  if (game.pending) return { t: 'weiter' };
  const known = memory(game, level === 1 ? 1 : 0);
  const isKnown = (i) => known.some((k) => k.i === i);
  const down = game.st.map((s, i) => (s === 0 ? i : -1)).filter((i) => i >= 0);
  if (!down.length) return null;
  const unknown = down.filter((i) => !isKnown(i));
  const randomCard = () => pick(unknown.length ? unknown : down, rng);

  if (game.open.length === 1) {
    // Zweite Karte: Das Bild der ersten liegt offen auf dem Tisch. Ist die passende Karte bekannt, nimm sie.
    const first = game.open[0];
    const sym = game.reveals[game.reveals.length - 1].c;
    const mate = known.find((k) => k.c === sym && k.i !== first);
    if (mate) return { t: 'flip', i: mate.i };
    return { t: 'flip', i: randomCard() };
  }
  // Erste Karte: Ist ein ganzes Paar bekannt, deck es auf.
  for (const k of known) {
    if (known.some((o) => o.c === k.c && o.i !== k.i)) return { t: 'flip', i: k.i };
  }
  return { t: 'flip', i: randomCard() };
}
