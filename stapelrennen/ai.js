// Stapelrennen – Computergegner. Reine Funktionen: chooseAction(game, pid, level, rng) -> Nachricht oder null.
// Pro Aufruf genau EINE Aktion (eine Karte legen oder abwerfen). Danach kommt der Computer erneut an die Reihe.
//   Stufe 0 (Leicht): legt nur gelegentlich eine mögliche Karte, wirft zufällig ab.
//   Stufe 1 (Mittel): spielt zuerst vom Spielerstapel, legt Karten nur, wenn sie den Spielerstapel voranbringen,
//                     hebt Joker auf und wirft möglichst absteigend auf Hilfsstapel ab.
import * as P from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

function msgOf(m) { return { t: 'play', from: m.from, i: m.i, to: m.to }; }

function leicht(g, pi, rng) {
  const plays = P.legalPlays(g, pi);
  const p = g.players[pi];
  if (plays.length && rng() < (g.played === 0 ? 0.7 : 0.5)) return msgOf(pick(plays, rng));
  return { t: 'discard', i: Math.floor(rng() * p.hand.length), to: Math.floor(rng() * P.AUX_COUNT) };
}

// Gibt es eine Kette von Karten (Hand, oberste Hilfsstapelkarten), die einen Aufbaustapel bis kurz vor die
// Karte des Spielerstapels bringt? Dann ist der erste Schritt dieser Kette ein Zug, der den Spielerstapel voranbringt.
function chain(g, pi) {
  const p = g.players[pi];
  const need = P.topOf(p.pile);
  if (need === null || need === P.JOKER) return null;
  let best = null;
  g.build.forEach((b, bi) => {
    if (b.length >= need - 1) return;
    const hand = p.hand.map((c, i) => ({ c, i }));
    const len = p.aux.map((s) => s.length);
    const top = (k) => (len[k] > 0 ? p.aux[k][len[k] - 1] : null);
    let cur = b.length, jokers = 0, first = null, steps = 0;
    while (cur < need - 1) {
      const want = cur + 1;
      let step = null;
      let h = hand.findIndex((x) => x.c === want);
      if (h >= 0) { step = { from: 'hand', i: hand[h].i }; hand.splice(h, 1); }
      else {
        const k = [0, 1, 2, 3].find((x) => top(x) === want);
        if (k !== undefined) { step = { from: 'aux', i: k }; len[k]--; }
        else {
          h = hand.findIndex((x) => x.c === P.JOKER);
          if (h >= 0) { step = { from: 'hand', i: hand[h].i }; hand.splice(h, 1); jokers++; }
          else {
            const kj = [0, 1, 2, 3].find((x) => top(x) === P.JOKER);
            if (kj !== undefined) { step = { from: 'aux', i: kj }; len[kj]--; jokers++; }
          }
        }
      }
      if (!step) return;
      if (!first) first = { ...step, to: bi };
      cur++; steps++;
    }
    if (!best || jokers < best.jokers || (jokers === best.jokers && steps < best.steps)) best = { jokers, steps, first };
  });
  return best ? best.first : null;
}

function mittel(g, pi, rng) {
  const p = g.players[pi];
  // 1. Karte vom Spielerstapel, wenn sie passt
  const pileCard = P.topOf(p.pile);
  if (pileCard !== null) {
    const targets = P.targetsFor(g, pileCard);
    if (targets.length) {
      // ein Joker vom Spielerstapel kommt auf den längsten Aufbaustapel
      const to = pileCard === P.JOKER ? targets.reduce((a, b) => (g.build[b].length > g.build[a].length ? b : a)) : targets[0];
      return { t: 'play', from: 'pile', i: 0, to };
    }
    // 2. Karten, die den Spielerstapel voranbringen
    const c = chain(g, pi);
    if (c) return msgOf(c);
  }
  // 3. Abwerfen: möglichst auf gleiche oder größere Karte, nie einen Joker (außer es gibt nichts anderes)
  let bestMove = null;
  p.hand.forEach((c, i) => {
    p.aux.forEach((s, k) => {
      let cost;
      if (!s.length) cost = 3;
      else {
        const t = P.topOf(s);
        cost = t === P.JOKER ? 8 : t >= c ? t - c : 6 + (c - t);
      }
      if (c === P.JOKER) cost += 100;
      cost += rng() * 0.01;
      if (!bestMove || cost < bestMove.cost) bestMove = { cost, i, to: k };
    });
  });
  return { t: 'discard', i: bestMove.i, to: bestMove.to };
}

export function chooseAction(g, pid, level, rng = Math.random) {
  if (!g || g.mode !== 'play' || !Array.isArray(g.players)) return null;
  const pi = g.active;
  const p = g.players[pi];
  if (!p || p.id !== pid || !p.hand.length) return null;
  return level >= 1 ? mittel(g, pi, rng) : leicht(g, pi, rng);
}
