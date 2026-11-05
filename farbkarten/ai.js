// Farbkarten – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
import * as E from './engine.js';

export const FORGET_CHANCE = 0.15; // Leicht vergisst den Ruf „Letzte Karte“ in 15 % der Fälle

const pickOne = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

function colorCounts(hand) {
  const c = { R: 0, Y: 0, G: 0, B: 0 };
  for (const x of hand) if (!E.isWild(x)) c[x[0]]++;
  return c;
}

// Farbe wählen: Leicht zufällig, Mittel die Farbe, die er am häufigsten hält.
function chooseColor(hand, level, rng) {
  if (level <= 0) return pickOne(E.COLORS, rng);
  const c = colorCounts(hand);
  const best = Math.max(...E.COLORS.map((k) => c[k]));
  if (best === 0) return pickOne(E.COLORS, rng);
  return pickOne(E.COLORS.filter((k) => c[k] === best), rng);
}

function playMsg(card, hand, level, rng) {
  const rest = hand.slice();
  rest.splice(rest.indexOf(card), 1);
  const msg = { t: 'play', card };
  if (E.isWild(card)) msg.color = chooseColor(rest, level, rng);
  if (rest.length === 1) msg.call = level >= 1 ? true : rng() >= FORGET_CHANCE;
  return msg;
}

// Gewichte der Bewertung (Mittel)
export const WEIGHTS = { num: 0.3, act: 2, actNext: 30, hold: 60, emergency: 55 };

// Bewertung einer Karte (Mittel)
function score(g, ap, card, legal, rng) {
  const W = WEIGHTS;
  const hand = ap.hand;
  const rest = hand.slice();
  rest.splice(rest.indexOf(card), 1);
  const n = g.players.length;
  const nextCount = g.players[E.nextIndex(g)].hand.length;
  const prevCount = g.players[E.stepFrom(g, g.active, -1)].hand.length;
  let s = rng() * 2;
  if (rest.length === 0) return 1000 + s;
  const onlyWilds = legal.every((c) => E.isWild(c));
  const danger = nextCount <= 2 || rest.length <= 2;
  if (E.isWild(card)) {
    s -= card === 'W4' ? W.hold + 10 : W.hold;
    if (onlyWilds) s += 80;
    if (danger) s += W.emergency;
    if (card === 'W4' && nextCount <= 3) s += 10;
    return s;
  }
  const v = card.slice(1);
  if (E.isNumber(card)) s += Number(v) * W.num;
  else {
    s += W.act;
    if (v === 'S' || v === 'Z' || (v === 'U' && n === 2)) s += nextCount <= 3 ? W.actNext : 8;
    else if (v === 'U') s += nextCount <= 3 && prevCount > nextCount ? 25 : 3;
  }
  return s;
}

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.mode !== 'play') return null;
  const ap = E.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  const hand = ap.hand;
  if (g.stage === 'color') return { t: 'color', color: chooseColor(hand, level, rng) };
  if (g.stage !== 'play') return null;

  if (g.drawn) {
    const card = g.drawn;
    if (level >= 1 && E.isWild(card)) {
      const nextCount = g.players[E.nextIndex(g)].hand.length;
      if (!(nextCount <= 2 || hand.length <= 2)) return { t: 'keep' };
    }
    return playMsg(card, hand, level, rng);
  }

  const legal = E.legalCards(g, g.active);
  if (g.pending) {
    if (!legal.length) return { t: 'draw' };
    if (level <= 0 && rng() < 0.5) return { t: 'draw' };
    return playMsg(legal[0], hand, level, rng);
  }
  if (!legal.length) return { t: 'draw' };
  if (level <= 0) return playMsg(pickOne(legal, rng), hand, level, rng);
  let best = legal[0], bs = -Infinity;
  for (const c of legal) {
    const s = score(g, ap, c, legal, rng);
    if (s > bs) { bs = s; best = c; }
  }
  return playMsg(best, hand, level, rng);
}
