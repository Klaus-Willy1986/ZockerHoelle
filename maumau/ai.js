// Mau-Mau – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
import * as M from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const FORGET_CHANCE = 0.15; // Leicht vergisst „Mau!“ / „Mau Mau!“ manchmal

// Karten, die weder in meiner Hand noch auf dem Ablagestapel liegen (also beim Gegner oder im Stapel sind)
function unseenCards(g, hand) {
  const cnt = Array(32).fill(g.decks);
  for (const c of g.discard) cnt[c.s * 8 + c.r] -= 1;
  for (const c of hand) cnt[c.s * 8 + c.r] -= 1;
  const out = [];
  cnt.forEach((k, i) => { for (let j = 0; j < k; j++) out.push({ s: i >> 3, r: i & 7 }); });
  return out;
}

// Wunschfarbe: die Farbe, die ich am häufigsten halte (bei Gleichstand zufällig)
function bestSuit(hand, rng) {
  const n = [0, 0, 0, 0];
  for (const c of hand) if (c.r !== M.RJ) n[c.s] += 1;
  const mx = Math.max(...n);
  return pick([0, 1, 2, 3].filter((s) => n[s] === mx), rng);
}

function scoreCard(g, me, hand, c, rng, unseen) {
  const rest = hand.slice();
  rest.splice(rest.findIndex((x) => M.sameCard(x, c)), 1);
  if (!rest.length) return 1000; // letzte Karte
  const n = g.players.length;
  const nextI = M.nextPlayerIndex(g);
  const nextCnt = g.players[nextI].hand.length;
  let s = rng(); // Gleichstand zufällig lösen
  // Folgekarten: wie viele meiner übrigen Karten passen danach auf diese Karte?
  const follow = rest.filter((x) => x.r === M.RJ || x.s === c.s || x.r === c.r).length;
  s += 3 * follow;
  // Farbe/Wert, die ich viel halte, lieber halten: Karte aus einer schwachen Farbe loswerden
  const sameSuit = rest.filter((x) => x.s === c.s).length;
  s -= 0.6 * sameSuit;
  // Je weniger unbekannte Karten auf meine Karte passen, desto eher muss der Gegner ziehen
  if (c.r !== M.RJ && unseen.length) s -= 30 * unseen.filter((x) => x.r === M.RJ || x.s === c.s || x.r === c.r).length / unseen.length;
  s += 0.12 * M.cardValue(c); // teure Karten früher loswerden
  if (c.r === M.RJ) {
    // Buben für Notfälle behalten
    s -= 40;
    if (rest.length <= 2) s += 25;
  }
  if (c.r === M.R7) s += nextCnt <= 3 ? 30 : 7;
  if (c.r === M.R8) s += nextCnt <= 3 ? 20 : 4;
  if (c.r === M.RA && g.opts.ace && n > 2) {
    // Richtung drehen: die Person davor wird die nächste
    const prevI = ((g.active - g.dir) % n + n) % n;
    const prevCnt = g.players[prevI].hand.length;
    if (nextCnt <= 2 && prevCnt > nextCnt) s += 14;
    else if (prevCnt <= 2 && prevCnt < nextCnt) s -= 14;
  }
  return s;
}

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.game !== 'mm' || g.phase !== 'play') return null;
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  if (g.turn.forced === 'seven') return { t: 'draw' };
  if (g.turn.forced === 'eight') return { t: 'skip' };
  const legal = M.legalCards(g, botId);
  if (!legal.length) return g.turn.drew ? { t: 'pass' } : { t: 'draw' };

  let card;
  let wish = 0;
  if (level <= 0) {
    card = pick(legal, rng);
    wish = Math.floor(rng() * 4);
  } else {
    let best = -Infinity;
    const unseen = unseenCards(g, ap.hand);
    for (const c of legal) {
      const s = scoreCard(g, ap, ap.hand, c, rng, unseen);
      if (s > best) { best = s; card = c; }
    }
    const rest = ap.hand.slice();
    rest.splice(rest.findIndex((x) => M.sameCard(x, card)), 1);
    wish = bestSuit(rest, rng);
  }
  const forget = level <= 0 && rng() < FORGET_CHANCE;
  return { t: 'play', card: { s: card.s, r: card.r }, wish, call: !forget };
}
