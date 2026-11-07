// Haus & Hof – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) -> eine Nachricht für engine.handle oder null (nicht am Zug / Spiel vorbei).
// Stufen: 0 = Leicht, 1 = Mittel. Nutzt nur öffentliche Information (Besitz, Geld, Häuser, Runde); die Reihenfolge des Kartenstapels wird nie gelesen.
// Mittel lehnt Käufe von Einzelgrundstücken ohne Bezug zu eigenem Besitz bewusst ab, damit die Auktion läuft (auch für Menschen am Tisch: öfter Auktionen).
// Regelzugriff nur über engine.js. In 'manage' liefert die KI eine Aktion nach der anderen und zuletzt {t:'end'}.
import * as E from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const P = (state, id) => state.players.find((p) => p.id === id);
const S = E.SQUARES;

function freeProps(state) {
  let n = 0;
  for (const s of S) if (['street', 'station', 'utility'].includes(s.type) && state.owners[s.i] === undefined) n++;
  return n;
}
// Besitzt die Person alle anderen Grundstücke der Farbe von sq? (dann komplettiert sq die Farbe)
function completes(state, pid, sq) {
  if (S[sq].type !== 'street') return false;
  return E.colorGroups[S[sq].group].every((x) => x === sq || state.owners[x] === pid);
}
// Würde sq einer Gegnerin die Farbe komplettieren (alle anderen Felder gehören derselben fremden Person)?
function blocks(state, pid, sq) {
  if (S[sq].type !== 'street') return false;
  const others = E.colorGroups[S[sq].group].filter((x) => x !== sq);
  const o = state.owners[others[0]];
  return o !== undefined && o !== pid && others.every((x) => state.owners[x] === o);
}
// Besitzt die Person schon ein anderes Grundstück derselben Farbe bzw. schon einen Bahnhof/Versorger?
function relevant(state, pid, sq) {
  const s = S[sq];
  const same = s.type === 'street' ? E.colorGroups[s.group] : s.type === 'station' ? E.STATION_SQS : E.UTILITY_SQS;
  return same.some((x) => x !== sq && state.owners[x] === pid);
}
// größte Miete, die mich auf einem fremden Feld treffen könnte (grobe Gefahr)
function threat(state, pid) {
  let m = 0;
  for (const k of Object.keys(state.owners)) {
    const sq = +k;
    if (state.owners[sq] === pid) continue;
    m = Math.max(m, E.rentOf(state, sq, 7));
  }
  return m;
}
function legal(fn, state, pid, list) { return list.filter((sq) => fn(state, pid, sq)); }
const ALL = S.map((s) => s.i);
// Stellschrauben der Stufe Mittel (zum Abstimmen exportiert)
export const TUNE = { buyReserve: 80, needCap: 400, buildReserve: 100, completeF: 2.0, bidF: 0.9, blockF: 1.2, mortCap: 3, auctionFirst: true };

// Bargeld, das noch für die ersten drei Häuser auf eigenen Komplettfarben fehlt (nur unbeliehene Farben)
function buildNeed(state, pid) {
  let need = 0;
  for (const g of E.colorGroups) {
    if (!g.every((x) => state.owners[x] === pid && !state.mortgaged[x])) continue;
    for (const x of g) need += Math.max(0, 3 - (state.houses[x] || 0)) * S[x].houseCost;
  }
  return need;
}

// Wert eines Besitzes für die Zahlungsnot: Verlust beim Aufgeben (je kleiner, desto lieber verkaufen)
function lossOf(state, sq, kind) {
  const s = S[sq];
  if (kind === 'sell') {
    const l = state.houses[sq];
    return (s.rent[l] - s.rent[l - 1]) / (s.houseCost / 2);
  }
  const base = s.type === 'street' ? s.rent[0] : s.type === 'station' ? 25 : 14;
  const bonus = s.type === 'street' && E.colorGroups[s.group].every((x) => state.owners[x] === state.owners[sq]) ? 3 : 1;
  return (base * bonus) / s.mortgage;
}

function raiseAction(state, me, level, rng) {
  const sells = legal(E.canSell, state, me.id, ALL);
  const morts = legal(E.canMortgage, state, me.id, ALL);
  if (!sells.length && !morts.length) return { t: 'declare_bankrupt' };
  if (level <= 0) {
    // zuerst Hypotheken (billigstes Grundstück zuerst), dann Häuser
    if (morts.length) { morts.sort((a, b) => S[a].price - S[b].price); return { t: 'mortgage', sq: morts[0] }; }
    return { t: 'sell', sq: pick(sells, rng) };
  }
  let best = null, bl = Infinity;
  for (const sq of sells) { const l = lossOf(state, sq, 'sell'); if (l < bl) { bl = l; best = { t: 'sell', sq }; } }
  for (const sq of morts) { const l = lossOf(state, sq, 'mortgage'); if (l < bl) { bl = l; best = { t: 'mortgage', sq }; } }
  return best;
}

function jailAction(state, me, level) {
  if (me.freeCards > 0) return { t: 'use_card' };
  if (me.cash < 50) return { t: 'roll' };
  if (level <= 0) return state.round >= 5 && me.cash >= 400 ? { t: 'pay_jail' } : { t: 'roll' };
  const free = freeProps(state);
  const oppHouses = state.players.reduce((n, o) => (o.id === me.id || o.out ? n : n + E.ownedBy(state, o.id).reduce((k, sq) => k + (state.houses[sq] || 0), 0)), 0);
  if (free >= 8 && me.cash >= 250) return { t: 'pay_jail' };   // frühe Phase: Grundstücke kaufen
  if (free >= 4 && oppHouses < 6 && me.cash >= 600) return { t: 'pay_jail' };
  return { t: 'roll' };                                         // später: im Gefängnis sicher kassieren
}

function buyAction(state, me, level, rng) {
  const sq = me.pos, price = S[sq].price;
  if (level <= 0) return rng() < 0.6 && me.cash - price >= 100 ? { t: 'buy' } : { t: 'decline' };
  // Strategisch unwichtige Einzelgrundstücke überlässt Mittel der Auktion (dort gehen sie oft unter Listenpreis weg)
  if (TUNE.auctionFirst && !completes(state, me.id, sq) && !blocks(state, me.id, sq) && !relevant(state, me.id, sq)) return { t: 'decline' };
  let reserve = TUNE.buyReserve + Math.min(TUNE.needCap, buildNeed(state, me.id));
  if (completes(state, me.id, sq)) reserve = 0;
  else if (blocks(state, me.id, sq)) reserve = 40;
  else if (S[sq].type === 'station') reserve = 50;
  if (me.cash - price >= reserve) return { t: 'buy' };
  return { t: 'decline' };
}

function auctionAction(state, me, level) {
  const A = state.auction;
  const s = S[A.sq];
  let maxBid;
  if (level <= 0) maxBid = Math.min(s.price * 0.5, me.cash - 20);
  else {
    let f = TUNE.bidF;
    if (completes(state, me.id, A.sq)) f = TUNE.completeF;
    else if (blocks(state, me.id, A.sq)) f = TUNE.blockF;
    else if (s.type === 'station') f = 1.0;
    maxBid = Math.min(s.price * f, me.cash - (f > 1.2 ? 20 : 100));
  }
  const bid = A.high + 10;
  if (bid <= maxBid && bid <= me.cash) return { t: 'bid', amount: bid };
  return { t: 'pass_bid' };
}

function manageAction(state, me, level, rng) {
  const th = threat(state, me.id);
  if (level <= 0) {
    const un = legal(E.canUnmortgage, state, me.id, ALL).filter((sq) => me.cash - E.unmortgageCost(sq) >= 400);
    if (un.length) return { t: 'unmortgage', sq: un[0] };
    if (rng() < 0.12) {
      const b = legal(E.canBuild, state, me.id, ALL).filter((sq) => me.cash - S[sq].houseCost >= 400);
      if (b.length) return { t: 'build', sq: pick(b, rng) };
    }
    return { t: 'end' };
  }
  const reserve = Math.max(TUNE.buildReserve, Math.min(400, Math.round(th * 0.5)));
  // 1. bauen: gleichmäßig, wo die Miete je Euro am stärksten steigt (Ziel auch dann, wenn das Bargeld noch fehlt)
  const targets = ALL.filter((sq) => { const e = E.buildError(state, me.id, sq); return !e || e.startsWith('Zu wenig Bargeld'); });
  if (targets.length) {
    let best = targets[0], bs = -Infinity;
    for (const sq of targets) {
      const l = state.houses[sq] || 0;
      const gain = (S[sq].rent[l + 1] - S[sq].rent[l]) / S[sq].houseCost;
      const sc = gain + S[sq].rent[3] / 4000 - (l === 4 ? 0.8 : 0);
      if (sc > bs) { bs = sc; best = sq; }
    }
    const cost = S[best].houseCost;
    if (me.cash - cost >= reserve) return { t: 'build', sq: best };
    if (E.canBuild(state, me.id, best) && me.cash - cost >= 30 && (state.houses[best] || 0) < 3) return { t: 'build', sq: best };
    // Geld fehlt: Besitz außerhalb dieser Farbe beleihen (nur für die ersten Häuser)
    if ((state.houses[best] || 0) < 3) {
      const g = new Set(E.colorGroups[S[best].group]);
      const monos = (sq) => S[sq].type === 'street' && E.colorGroups[S[sq].group].every((x) => state.owners[x] === me.id);
      const m = ALL.filter((sq) => !g.has(sq) && !monos(sq) && E.canMortgage(state, me.id, sq));
      if (m.length && me.cash - cost < 30 && Object.keys(state.mortgaged).filter((k) => state.owners[k] === me.id).length < TUNE.mortCap) {
        m.sort((x, y) => lossOf(state, x, 'mortgage') - lossOf(state, y, 'mortgage'));
        return { t: 'mortgage', sq: m[0] };
      }
    }
    return { t: 'end' };
  }
  // 2. Hypotheken lösen (Farbkomplettierer und hohe Mieten zuerst), nur bei Überschuss
  const un = legal(E.canUnmortgage, state, me.id, ALL).filter((sq) => me.cash - E.unmortgageCost(sq) >= reserve);
  if (un.length) {
    un.sort((a, b) => (completes(state, me.id, b) ? 1 : 0) - (completes(state, me.id, a) ? 1 : 0) || S[b].price - S[a].price);
    return { t: 'unmortgage', sq: un[0] };
  }
  return { t: 'end' };
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.phase === 'over') return null;
  const actor = E.activePlayer(state);
  if (!actor || actor.id !== botId || actor.out) return null;
  switch (state.phase) {
    case 'roll': return actor.jail > 0 ? jailAction(state, actor, level) : { t: 'roll' };
    case 'buy': return buyAction(state, actor, level, rng);
    case 'auction': return auctionAction(state, actor, level);
    case 'raise': return raiseAction(state, actor, level, rng);
    case 'manage': return manageAction(state, actor, level, rng);
  }
  return null;
}
