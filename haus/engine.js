// Haus & Hof – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Würfel-Grundstückshandelsspiel für 2–6 Personen auf einem Ring aus 40 Feldern der Stadt Marburg.
// Zufall (Würfel, Kartenstapel) nur über `rng`. Alle Texte deutsch, Zustand JSON-sicher.
//
// ===== API-Überblick =====
//   createGame(players:[{id,name}], opts, rng) -> state          (2..6 Personen, sonst RangeError)
//        opts: { startMoney:1500, auction:true, maxRounds:30 }   maxRounds = Runden (1 Runde = 1 Zug je Person), 0 = unbegrenzt
//   handle(state, pid, msg, rng) -> {ok:true} | {ok:false, error:"deutscher Text"}
//   Nachrichten (t) und Phasen:
//     Phase 'roll'    {t:'roll'} würfeln & ziehen | {t:'pay_jail'} 50 zahlen (nur im Gefängnis) | {t:'use_card'} Freikarte (nur im Gefängnis)
//     Phase 'buy'     {t:'buy'} kaufen | {t:'decline'} ablehnen (-> Auktion, wenn opts.auction, sonst bleibt das Grundstück frei)
//                     Die Kauf-Phase gibt es nur, wenn das Bargeld reicht; sonst geht es ohne Rückfrage direkt in die Auktion.
//     Phase 'auction' {t:'bid', amount} Gebot (Vielfaches von 10, mindestens Höchstgebot+10, höchstens Bargeld) | {t:'pass_bid'} passen
//     Phase 'raise'   Schuld > Bargeld: {t:'sell', sq} | {t:'mortgage', sq} | {t:'declare_bankrupt'}  (sobald Bargeld reicht, wird sofort gezahlt)
//     Phase 'manage'  nach dem Zug: {t:'build', sq} | {t:'sell', sq} | {t:'mortgage', sq} | {t:'unmortgage', sq} | {t:'end'} (Zug beenden)
//     Phase 'over'    Spiel beendet, state.result gesetzt.
//   Ablauf: roll -> (buy -> auction) | raise ... -> manage -> end -> nächste Person (nach Pasch: wieder 'roll' für dieselbe Person).
//   Wer handeln darf, sagt activePlayer(state): in 'auction' die Person, die bieten muss, in 'raise' die Schuldnerin/der Schuldner
//   (kann bei Ereigniskarten "alle zahlen an dich" eine andere Person als die am Zug sein), sonst die Person am Zug.
//   turnPlayer(state) ist immer die Person, deren Zug läuft.
//
// ===== Hilfsfunktionen (für Oberfläche und KI) =====
//   SQUARES[0..39]       Brett: { i, type, name, group?, color?, price?, mortgage?, houseCost?, rent? }
//                        type: 'start'|'street'|'station'|'utility'|'tax'|'event'|'jail'|'free'|'gojail'; tax hat amount.
//   CARDS[0..15]         Ereigniskarten { id, kind, text, ... }; COLOR_IDS (8 Farben), COLOR_NAMES, colorGroups (8 Felderlisten)
//   squareInfo(i)        = SQUARES[i];  groupOf(sq) -> Gruppennummer | -1
//   houseCost(sq), mortgageValue(sq), unmortgageCost(sq)
//   canBuild(state,pid,sq) / canSell / canMortgage / canUnmortgage -> bool;  buildError / sellError / mortgageError / unmortgageError -> null | Text
//   rentOf(state, sq, diceSum, opts) -> aktuelle Miete (0 bei frei/hypothekiert); opts {double:true (Bahnhof doppelt), mult:10 (Versorger)}
//   netWorth(state,pid)  Bargeld + Kaufpreise (Hypothek: abzüglich Hypothekswert) + Häuser/Hotels zum Einkaufspreis
//   liquidation(state,pid) Bargeld + was Verkauf der Häuser (halber Preis) und Beleihen noch einbringt
//   ownedBy(state,pid) -> sortierte Feldnummern;  ranking(state) -> [{id,name,worth,out,place}] (beste zuerst)
//   activePlayer(state), turnPlayer(state)
//
// ===== Zustand (JSON) =====
//   { game:'haus', opts, players:[{id,name,cash,pos,jail:0|1..3,freeCards,out,token:0..5}], owners:{sq:pid}, houses:{sq:0..5} (5 = Hotel,
//     für alle 22 Straßen vorhanden), mortgaged:{sq:true}, supply:{houses:32,hotels:12}, dice:[a,b], doubles, rollAgain, phase, active (Index),
//     auction:null|{sq,turn,high,highBy,passed:[ids],order:[ids]}, debt:null|{from,to:pid|'bank',amount,then:[...]}, cont, deck (Reststapel,
//     Ziehen von hinten), discardPile, round (ab 1), turns (Zugzähler), bank (Bankguthaben, siehe unten), outOrder, recap:[letzte Texte],
//     card:null|{pid,id,text} (zuletzt gezogene Karte dieses Wurfs), last:null|{pid,from,to,kind} (letzte Bewegung), seq (zählt gültige Nachrichten),
//     result:null|{winners:[ids], ranking, reason:'last'|'rounds'} }
//   Jail: 0 = frei, 1..3 = Nummer des nächsten Versuchs (1 = gerade eingesperrt). Das Brett selbst kennt "Besuch" (Feld 10) ohne Wirkung.
//   Geldbilanz: JEDE Bargeldänderung läuft über state.bank mit; Invariante: Summe(cash) + bank === Personen * startMoney.
//
// ===== Brett (SQUARES) =====
//    0 Rathaus (Start), Durchgang +200   10 Hexenturm (Besuch)             20 Lahnwiesen (nichts)            30 Gehe in den Hexenturm
//    1 Afföllerstraße (braun)            11 Frankfurter Straße (rosa)      21 Schwanallee (rot)              31 Marktplatz (grün)
//    2 Ereignis                          12 Stadtwerke Strom (Versorger)   22 Ereignis                       32 Reitgasse (grün)
//    3 Cappeler Straße (braun)           13 Biegenstraße (rosa)            23 Gutenbergstraße (rot)          33 Ereignis
//    4 Semestergebühr 200                14 Bahnhofstraße (rosa)           24 Weidenhäuser Straße (rot)      34 Ketzerbach (grün)
//    5 Hauptbahnhof                      15 Südbahnhof                     25 Bahnhof Cappel                 35 Bahnhof Wehrda
//    6 Ockershäuser Allee (himmel)       16 Universitätsstraße (orange)    26 Steinweg (gelb)                36 Ereignis
//    7 Ereignis                          17 Ereignis                       27 Wettergasse (gelb)             37 Elisabethkirche (blau)
//    8 Marbacher Weg (himmel)            18 Rudolphsplatz (orange)         28 Stadtwerke Wasser (Versorger)  38 Parkgebühr Oberstadt 100
//    9 Wehrdaer Weg (himmel)             19 Pilgrimstein (orange)          29 Barfüßerstraße (gelb)          39 Landgrafenschloss (blau)
//   Farbgruppen (colorGroups): braun [1,3] (Haus 50), himmel [6,8,9] (50), rosa [11,13,14] (100), orange [16,18,19] (100),
//   rot [21,23,24] (150), gelb [26,27,29] (150), grün [31,32,34] (200), blau [37,39] (200) – 22 Straßen. Bahnhöfe 5/15/25/35, Versorger 12/28.
//   Miete Straße: rent[0..5] = ohne Haus, 1–4 Häuser, Hotel; ohne Haus und bei Besitz der ganzen Farbe verdoppelt sich rent[0].
//   Bahnhof: 25/50/100/200 nach Zahl besessener Bahnhöfe; Versorger: 4x (1 Versorger) / 10x (2) Augensumme des letzten Wurfs.
//   Hypothekswert = halber Kaufpreis, Rückzahlung = Hypothekswert + 10 % (aufgerundet). Hauskosten je Stufe = houseCost; Hotel = 5. Stufe
//   (kostet einen weiteren Hauspreis, gibt 4 Häuser an den Vorrat zurück); Verkauf je Stufe zum halben Preis.
//
// ===== Regeln im Detail =====
//   Pasch: nochmal würfeln (nach 'manage'); 3. Pasch in Folge -> direkt ins Gefängnis ohne zu ziehen. Pasch aus dem Gefängnis: raus, ziehen, aber
//   kein Zusatzwurf. Gefängnis verlassen: 50 zahlen oder Freikarte (vor dem Würfeln), oder Pasch; nach dem 3. Fehlversuch zahlt man 50 und zieht.
//   Auktion: Beginn bei der Person nach der Ablehnenden (die Ablehnende ist zuletzt dran); wer nicht mehr mindestens Höchstgebot+10 bezahlen kann,
//   passt automatisch. Wer passt, scheidet aus. Bietet niemand, bleibt das Grundstück frei.
//   Ereigniskarten: "nächster Versorger" in fremdem Besitz: neuer Wurf (rng), 10x Augensumme. Abgelegte Karten werden neu gemischt, wenn der Stapel leer ist;
//   die Freikarte bleibt bei der Person, bis sie benutzt wird (dann in den Ablagestapel).
//   Zahlungsnot: Bargeld < Schuld -> 'raise'. Reicht liquidation() nicht, ist die Person sofort bankrott (ohne 'raise').
//   Bankrott: Häuser gehen zum halben Preis an die Bank, dann bekommt die Gläubigerin alles Bargeld, alle Grundstücke (Hypothek bleibt; sie zahlt sofort 10 % des
//   Hypothekswerts Zinsen, soweit ihr Bargeld reicht) und Freikarten. Schuld an die Bank: Grundstücke werden frei (ohne Hypothek, ohne Häuser, ohne Versteigerung),
//   Bargeld geht an die Bank. Bei mehreren Gläubigern ("du zahlst allen") bekommt nur die erste Gläubigerin die Masse.
//   Spielende: nur eine Person übrig, oder nach maxRounds Runden: höchstes netWorth gewinnt (Gleichstand: mehrere Siegerinnen).
//   Kein Tauschhandel in dieser Version. Bekannte Vereinfachung: verkaufte Hotels geben bei Hausmangel im Vorrat weniger Häuser zurück (siehe sell).

export const COLOR_IDS = ['braun', 'himmel', 'rosa', 'orange', 'rot', 'gelb', 'gruen', 'blau'];
export const COLOR_NAMES = { braun: 'Braun', himmel: 'Himmelblau', rosa: 'Rosa', orange: 'Orange', rot: 'Rot', gelb: 'Gelb', gruen: 'Grün', blau: 'Blau' };
export const BOARD_SIZE = 40;
export const PASS_BONUS = 200;
export const JAIL_SQ = 10;
export const JAIL_FEE = 50;
export const HOUSES_SUPPLY = 32;
export const HOTELS_SUPPLY = 12;
export const STATION_RENT = [25, 50, 100, 200];
export const DEFAULT_OPTS = { startMoney: 1500, auction: true, maxRounds: 30 };
const RECAP_MAX = 12;
const MAX_PLAYERS = 6;

// ---------- Brett ----------
const STREETS = [
  // [Feld, Name, Gruppe, Preis, Miete[0..5]]
  [1, 'Afföllerstraße', 0, 60, [2, 10, 30, 90, 160, 250]],
  [3, 'Cappeler Straße', 0, 60, [4, 20, 60, 180, 320, 450]],
  [6, 'Ockershäuser Allee', 1, 100, [6, 30, 90, 270, 400, 550]],
  [8, 'Marbacher Weg', 1, 100, [6, 30, 90, 270, 400, 550]],
  [9, 'Wehrdaer Weg', 1, 120, [8, 40, 100, 300, 450, 600]],
  [11, 'Frankfurter Straße', 2, 140, [10, 50, 150, 450, 625, 750]],
  [13, 'Biegenstraße', 2, 140, [10, 50, 150, 450, 625, 750]],
  [14, 'Bahnhofstraße', 2, 160, [12, 60, 180, 500, 700, 900]],
  [16, 'Universitätsstraße', 3, 180, [14, 70, 200, 550, 750, 950]],
  [18, 'Rudolphsplatz', 3, 180, [14, 70, 200, 550, 750, 950]],
  [19, 'Pilgrimstein', 3, 200, [16, 80, 220, 600, 800, 1000]],
  [21, 'Schwanallee', 4, 220, [18, 90, 250, 700, 875, 1050]],
  [23, 'Gutenbergstraße', 4, 220, [18, 90, 250, 700, 875, 1050]],
  [24, 'Weidenhäuser Straße', 4, 240, [20, 100, 300, 750, 925, 1100]],
  [26, 'Steinweg', 5, 260, [22, 110, 330, 800, 975, 1150]],
  [27, 'Wettergasse', 5, 260, [22, 110, 330, 800, 975, 1150]],
  [29, 'Barfüßerstraße', 5, 280, [24, 120, 360, 850, 1025, 1200]],
  [31, 'Marktplatz', 6, 300, [26, 130, 390, 900, 1100, 1275]],
  [32, 'Reitgasse', 6, 300, [26, 130, 390, 900, 1100, 1275]],
  [34, 'Ketzerbach', 6, 320, [28, 150, 450, 1000, 1200, 1400]],
  [37, 'Elisabethkirche', 7, 350, [35, 175, 500, 1100, 1300, 1500]],
  [39, 'Landgrafenschloss', 7, 400, [50, 200, 600, 1400, 1700, 2000]],
];
const GROUP_HOUSE_COST = [50, 50, 100, 100, 150, 150, 200, 200];
const STATIONS = { 5: 'Hauptbahnhof', 15: 'Südbahnhof', 25: 'Bahnhof Cappel', 35: 'Bahnhof Wehrda' };
const UTILITIES = { 12: 'Stadtwerke Strom', 28: 'Stadtwerke Wasser' };

function buildSquares() {
  const sq = Array.from({ length: BOARD_SIZE }, (_, i) => ({ i, type: 'event', name: 'Ereignis' }));
  Object.assign(sq[0], { type: 'start', name: 'Rathaus (Start)' });
  Object.assign(sq[10], { type: 'jail', name: 'Hexenturm (Besuch)' });
  Object.assign(sq[20], { type: 'free', name: 'Lahnwiesen' });
  Object.assign(sq[30], { type: 'gojail', name: 'Gehe in den Hexenturm' });
  Object.assign(sq[4], { type: 'tax', name: 'Semestergebühr', amount: 200 });
  Object.assign(sq[38], { type: 'tax', name: 'Parkgebühr Oberstadt', amount: 100 });
  for (const [i, name, g, price, rent] of STREETS) {
    sq[i] = { i, type: 'street', name, group: g, color: COLOR_IDS[g], price, mortgage: price / 2, houseCost: GROUP_HOUSE_COST[g], rent };
  }
  for (const i of Object.keys(STATIONS)) sq[i] = { i: +i, type: 'station', name: STATIONS[i], price: 200, mortgage: 100, rent: STATION_RENT };
  for (const i of Object.keys(UTILITIES)) sq[i] = { i: +i, type: 'utility', name: UTILITIES[i], price: 150, mortgage: 75, rent: [4, 10] };
  return sq;
}
export const SQUARES = buildSquares();
export const STATION_SQS = [5, 15, 25, 35];
export const UTILITY_SQS = [12, 28];
export const colorGroups = COLOR_IDS.map((_, g) => SQUARES.filter((s) => s.type === 'street' && s.group === g).map((s) => s.i));
export const squareInfo = (i) => SQUARES[i];
export const groupOf = (sq) => (SQUARES[sq] && SQUARES[sq].type === 'street' ? SQUARES[sq].group : -1);
const isProp = (sq) => SQUARES[sq] && ['street', 'station', 'utility'].includes(SQUARES[sq].type);
export const houseCost = (sq) => SQUARES[sq].houseCost || 0;
export const mortgageValue = (sq) => SQUARES[sq].mortgage || 0;
export const unmortgageCost = (sq) => mortgageValue(sq) + Math.ceil(mortgageValue(sq) * 0.1);

// ---------- Ereigniskarten (16, gemeinsamer Stapel) ----------
export const FREE_CARD = 12;
export const CARDS = [
  { id: 0, kind: 'goto', sq: 0, text: 'Rücke vor bis zum Rathaus (Start). Der Durchgang bringt dir 200.' },
  { id: 1, kind: 'goto', sq: 11, text: 'Rücke vor bis zur Frankfurter Straße. Kommst du über das Rathaus (Start), erhältst du 200.' },
  { id: 2, kind: 'goto', sq: 39, text: 'Rücke vor bis zum Landgrafenschloss. Kommst du über das Rathaus (Start), erhältst du 200.' },
  { id: 3, kind: 'station', text: 'Rücke vor bis zum nächsten Bahnhof. Gehört er jemandem, zahlst du die doppelte Miete.' },
  { id: 4, kind: 'station', text: 'Fahre zum nächsten Bahnhof. Gehört er jemandem, zahlst du die doppelte Miete.' },
  { id: 5, kind: 'utility', text: 'Rücke vor bis zum nächsten Versorger. Gehört er jemandem, würfle neu und zahle das 10-Fache der Augensumme.' },
  { id: 6, kind: 'gain', amount: 50, text: 'Die Stadtkasse Marburg zahlt eine Dividende: Du erhältst 50.' },
  { id: 7, kind: 'gain', amount: 150, text: 'Dein Bausparvertrag wird fällig: Du erhältst 150.' },
  { id: 8, kind: 'pay', amount: 40, text: 'Strafzettel fürs Falschparken: Zahle 40 an die Bank.' },
  { id: 9, kind: 'pay', amount: 150, text: 'Die Dachrinne ist kaputt: Zahle 150 an die Bank.' },
  { id: 10, kind: 'back', steps: 3, text: 'Gehe drei Felder zurück.' },
  { id: 11, kind: 'jail', text: 'Gehe direkt in den Hexenturm. Gehe nicht über das Rathaus (Start), ziehe keine 200 ein.' },
  { id: 12, kind: 'free', text: 'Du kommst aus dem Hexenturm frei. Behalte diese Karte, bis du sie brauchst.' },
  { id: 13, kind: 'repair', house: 25, hotel: 100, text: 'Hausreparatur: Zahle 25 je Haus und 100 je Hotel an die Bank.' },
  { id: 14, kind: 'collect', amount: 50, text: 'Dein Geburtstag: Jede andere Person zahlt dir 50.' },
  { id: 15, kind: 'payall', amount: 50, text: 'Du lädst alle zum Essen ein: Zahle jeder anderen Person 50.' },
];

// ---------- Hilfsfunktionen ----------
const err = (error) => ({ ok: false, error });
const P = (state, id) => state.players.find((p) => p.id === id);
const die = (rng) => 1 + Math.min(5, Math.floor(rng() * 6));
export const activePlayer = (state) => {
  if (state.phase === 'auction' && state.auction) return P(state, state.auction.turn);
  if (state.phase === 'raise' && state.debt) return P(state, state.debt.from);
  return state.players[state.active];
};
export const turnPlayer = (state) => state.players[state.active];
export const ownedBy = (state, pid) =>
  Object.keys(state.owners).filter((k) => state.owners[k] === pid).map(Number).sort((a, b) => a - b);
const ownsGroup = (state, pid, g) => colorGroups[g].every((s) => state.owners[s] === pid);
const levelsInGroup = (state, sq) => colorGroups[groupOf(sq)].map((s) => state.houses[s] || 0);

function log(state, text) {
  state.recap.push(text);
  while (state.recap.length > RECAP_MAX) state.recap.shift();
}
// Alle Bargeldbewegungen: from/to = Personen-id oder 'bank'
function money(state, from, to, amount) {
  if (amount <= 0) return;
  if (from === 'bank') state.bank -= amount;
  else P(state, from).cash -= amount;
  if (to === 'bank') state.bank += amount;
  else P(state, to).cash += amount;
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function rentOf(state, sq, diceSum = 0, opts = {}) {
  const s = SQUARES[sq];
  const o = state.owners[sq];
  if (!isProp(sq) || o === undefined || state.mortgaged[sq]) return 0;
  if (s.type === 'street') {
    const lvl = state.houses[sq] || 0;
    if (lvl === 0 && ownsGroup(state, o, s.group)) return s.rent[0] * 2;
    return s.rent[lvl];
  }
  if (s.type === 'station') {
    const n = STATION_SQS.filter((x) => state.owners[x] === o).length;
    return STATION_RENT[n - 1] * (opts.double ? 2 : 1);
  }
  const n = UTILITY_SQS.filter((x) => state.owners[x] === o).length;
  return (opts.mult || (n === 2 ? 10 : 4)) * diceSum;
}

const levelCost = (sq, lvl) => lvl * houseCost(sq);
export function netWorth(state, pid) {
  const p = P(state, pid);
  if (!p || p.out) return 0;
  let w = p.cash;
  for (const sq of ownedBy(state, pid)) {
    w += SQUARES[sq].price - (state.mortgaged[sq] ? mortgageValue(sq) : 0);
    if (SQUARES[sq].type === 'street') w += levelCost(sq, state.houses[sq] || 0);
  }
  return w;
}
export function liquidation(state, pid) {
  const p = P(state, pid);
  let w = p.cash;
  for (const sq of ownedBy(state, pid)) {
    if (SQUARES[sq].type === 'street') w += levelCost(sq, state.houses[sq] || 0) / 2;
    if (!state.mortgaged[sq]) w += mortgageValue(sq);
  }
  return w;
}

export function ranking(state) {
  const alive = state.players.filter((p) => !p.out).map((p) => ({ id: p.id, name: p.name, worth: netWorth(state, p.id), out: false }));
  alive.sort((a, b) => b.worth - a.worth);
  const outs = state.outOrder.slice().reverse().map((id) => ({ id, name: P(state, id).name, worth: 0, out: true }));
  const list = alive.concat(outs);
  list.forEach((r, i) => {
    r.place = i > 0 && !r.out && !list[i - 1].out && list[i - 1].worth === r.worth ? list[i - 1].place : i + 1;
  });
  return list;
}

// ---------- Spielstart ----------
export function createGame(players, opts = {}, rng = Math.random) {
  if (!Array.isArray(players) || players.length < 2 || players.length > MAX_PLAYERS) throw new RangeError('Haus & Hof geht mit 2 bis 6 Personen.');
  const o = { ...DEFAULT_OPTS, ...opts };
  const state = {
    game: 'haus',
    opts: o,
    players: players.map((p, i) => ({ id: p.id, name: p.name, cash: o.startMoney, pos: 0, jail: 0, freeCards: 0, out: false, token: i })),
    owners: {},
    houses: {},
    mortgaged: {},
    supply: { houses: HOUSES_SUPPLY, hotels: HOTELS_SUPPLY },
    dice: [0, 0],
    doubles: 0,
    rollAgain: false,
    phase: 'roll',
    active: 0,
    auction: null,
    debt: null,
    cont: null,
    deck: shuffle(CARDS.map((c) => c.id), rng),
    discardPile: [],
    round: 1,
    turns: 0,
    bank: 0,
    outOrder: [],
    recap: [],
    card: null,
    last: null,
    seq: 0,
    result: null,
  };
  for (const s of SQUARES) if (s.type === 'street') state.houses[s.i] = 0;
  log(state, `Das Spiel beginnt. ${state.players[0].name} ist am Zug.`);
  return state;
}

// ---------- Prüfungen: Bauen, Verkaufen, Hypothek ----------
export function buildError(state, pid, sq) {
  const s = SQUARES[sq];
  if (!s || s.type !== 'street') return 'Häuser kann man nur auf Straßen bauen.';
  if (state.owners[sq] !== pid) return 'Dieses Grundstück gehört dir nicht.';
  if (!ownsGroup(state, pid, s.group)) return 'Du brauchst alle Grundstücke dieser Farbe.';
  if (colorGroups[s.group].some((x) => state.mortgaged[x])) return 'In dieser Farbe ist ein Grundstück beliehen.';
  const lvl = state.houses[sq] || 0;
  if (lvl >= 5) return 'Hier steht schon ein Hotel.';
  if (lvl > Math.min(...levelsInGroup(state, sq))) return 'Baue gleichmäßig: zuerst auf den anderen Grundstücken dieser Farbe.';
  if (P(state, pid).cash < s.houseCost) return `Zu wenig Bargeld (${s.houseCost} nötig).`;
  if (lvl === 4 && state.supply.hotels < 1) return 'Die Bank hat kein Hotel mehr.';
  if (lvl < 4 && state.supply.houses < 1) return 'Die Bank hat keine Häuser mehr.';
  return null;
}
export function sellError(state, pid, sq) {
  const s = SQUARES[sq];
  if (!s || s.type !== 'street') return 'Nur Häuser auf Straßen kann man verkaufen.';
  if (state.owners[sq] !== pid) return 'Dieses Grundstück gehört dir nicht.';
  const lvl = state.houses[sq] || 0;
  if (lvl < 1) return 'Hier steht kein Haus.';
  if (lvl < Math.max(...levelsInGroup(state, sq))) return 'Verkaufe gleichmäßig: zuerst auf dem Grundstück mit den meisten Häusern.';
  return null;
}
export function mortgageError(state, pid, sq) {
  if (!isProp(sq)) return 'Dieses Feld kann man nicht beleihen.';
  if (state.owners[sq] !== pid) return 'Dieses Grundstück gehört dir nicht.';
  if (state.mortgaged[sq]) return 'Dieses Grundstück ist schon beliehen.';
  if (SQUARES[sq].type === 'street' && levelsInGroup(state, sq).some((l) => l > 0)) return 'Verkaufe zuerst alle Häuser dieser Farbe.';
  return null;
}
export function unmortgageError(state, pid, sq) {
  if (!isProp(sq)) return 'Dieses Feld kann man nicht auslösen.';
  if (state.owners[sq] !== pid) return 'Dieses Grundstück gehört dir nicht.';
  if (!state.mortgaged[sq]) return 'Dieses Grundstück ist nicht beliehen.';
  if (P(state, pid).cash < unmortgageCost(sq)) return `Zu wenig Bargeld (${unmortgageCost(sq)} nötig).`;
  return null;
}
export const canBuild = (state, pid, sq) => !buildError(state, pid, sq);
export const canSell = (state, pid, sq) => !sellError(state, pid, sq);
export const canMortgage = (state, pid, sq) => !mortgageError(state, pid, sq);
export const canUnmortgage = (state, pid, sq) => !unmortgageError(state, pid, sq);

function doBuild(state, p, sq) {
  const lvl = state.houses[sq] || 0;
  money(state, p.id, 'bank', houseCost(sq));
  if (lvl === 4) { state.supply.hotels--; state.supply.houses += 4; } else state.supply.houses--;
  state.houses[sq] = lvl + 1;
  log(state, `${p.name} baut auf ${SQUARES[sq].name} ${lvl === 4 ? 'ein Hotel' : 'ein Haus'}.`);
}
function doSell(state, p, sq) {
  const lvl = state.houses[sq];
  const hp = houseCost(sq);
  let refund = hp / 2;
  if (lvl === 5) {
    state.supply.hotels++;
    if (state.supply.houses >= 4) { state.supply.houses -= 4; state.houses[sq] = 4; } else {
      const k = state.supply.houses; // Hausmangel: Hotel wird weiter abgebaut
      state.supply.houses = 0; state.houses[sq] = k; refund = ((5 - k) * hp) / 2;
    }
  } else { state.supply.houses++; state.houses[sq] = lvl - 1; }
  money(state, 'bank', p.id, refund);
  log(state, `${p.name} verkauft ${lvl === 5 ? 'das Hotel' : 'ein Haus'} auf ${SQUARES[sq].name} (+${refund}).`);
}
function doMortgage(state, p, sq) {
  state.mortgaged[sq] = true;
  money(state, 'bank', p.id, mortgageValue(sq));
  log(state, `${p.name} beleiht ${SQUARES[sq].name} (+${mortgageValue(sq)}).`);
}
function doUnmortgage(state, p, sq) {
  delete state.mortgaged[sq];
  money(state, p.id, 'bank', unmortgageCost(sq));
  log(state, `${p.name} löst ${SQUARES[sq].name} aus (-${unmortgageCost(sq)}).`);
}

// ---------- Schulden, Bankrott ----------
function transfer(state, d) {
  money(state, d.from, d.to, d.amount);
  const to = d.to === 'bank' ? 'die Bank' : P(state, d.to).name;
  log(state, `${P(state, d.from).name} zahlt ${d.amount} an ${to}${d.why ? ' (' + d.why + ')' : ''}.`);
}

// Arbeitet Schulden der Reihe nach ab. true = Phase geöffnet ('raise') oder Spiel zu Ende.
function queueDebts(state, items) {
  for (let k = 0; k < items.length; k++) {
    const d = items[k];
    const from = P(state, d.from);
    if (from.out || d.amount <= 0) continue;
    if (from.cash >= d.amount) { transfer(state, d); continue; }
    if (liquidation(state, d.from) < d.amount) {
      log(state, `${from.name} kann ${d.amount} nicht aufbringen.`);
      bankrupt(state, d.from, d.to);
      if (state.phase === 'over') return true;
      continue;
    }
    state.debt = { from: d.from, to: d.to, amount: d.amount, why: d.why || '', then: items.slice(k + 1) };
    state.phase = 'raise';
    log(state, `${from.name} muss ${d.amount} zahlen und braucht Bargeld: Häuser verkaufen oder Grundstücke beleihen.`);
    return true;
  }
  return false;
}

function bankrupt(state, pid, creditor) {
  const p = P(state, pid);
  // Häuser gehen zum halben Preis an die Bank
  for (const sq of ownedBy(state, pid)) {
    const lvl = state.houses[sq] || 0;
    if (lvl > 0) {
      money(state, 'bank', pid, levelCost(sq, lvl) / 2);
      if (lvl === 5) state.supply.hotels++; else state.supply.houses += lvl;
      state.houses[sq] = 0;
    }
  }
  const props = ownedBy(state, pid);
  const cred = creditor !== 'bank' ? P(state, creditor) : null;
  if (cred && !cred.out) {
    money(state, pid, cred.id, p.cash);
    cred.freeCards += p.freeCards;
    for (const sq of props) {
      state.owners[sq] = cred.id;
      if (state.mortgaged[sq]) money(state, cred.id, 'bank', Math.min(cred.cash, Math.ceil(mortgageValue(sq) * 0.1)));
    }
    log(state, `${p.name} ist bankrott. ${cred.name} erhält alles.`);
  } else {
    money(state, pid, 'bank', p.cash);
    for (const sq of props) { delete state.owners[sq]; delete state.mortgaged[sq]; }
    for (let i = 0; i < p.freeCards; i++) state.discardPile.push(FREE_CARD);
    log(state, `${p.name} ist bankrott. Die Grundstücke gehen zurück an die Bank.`);
  }
  p.freeCards = 0;
  p.cash = 0;
  p.out = true;
  p.jail = 0;
  state.outOrder.push(pid);
  if (state.auction) state.auction.passed.push(pid);
  const alive = state.players.filter((x) => !x.out);
  if (alive.length <= 1) finish(state, 'last');
}

function finish(state, reason) {
  state.phase = 'over';
  state.auction = null;
  state.debt = null;
  state.cont = null;
  const rk = ranking(state);
  const best = reason === 'last' ? rk[0].worth : Math.max(...rk.filter((r) => !r.out).map((r) => r.worth));
  const winners = reason === 'last' ? [rk[0].id] : rk.filter((r) => !r.out && r.worth === best).map((r) => r.id);
  state.result = { winners, ranking: rk, reason };
  log(state, winners.length === 1 ? `Spielende: ${P(state, winners[0]).name} gewinnt.` : `Spielende: Gleichstand zwischen ${winners.map((w) => P(state, w).name).join(' und ')}.`);
}

// ---------- Zugablauf ----------
function nextTurn(state) {
  const n = state.players.length;
  let i = state.active;
  do { i = (i + 1) % n; } while (state.players[i].out);
  if (i <= state.active) state.round++;
  state.active = i;
  state.doubles = 0;
  state.rollAgain = false;
  state.cont = null;
  state.turns++;
  if (state.opts.maxRounds > 0 && state.round > state.opts.maxRounds) { finish(state, 'rounds'); return; }
  state.phase = 'roll';
  state.card = null;
  log(state, `${state.players[i].name} ist am Zug.`);
}

// Nichts mehr offen: Fortsetzung (Gefängnis-Zug nach Zahlung) oder 'manage'
function proceed(state, rng) {
  if (state.phase === 'over') return;
  const p = state.players[state.active];
  if (p.out) { nextTurn(state); return; }
  if (state.cont) {
    const c = state.cont;
    state.cont = null;
    if (c.k === 'jailmove') {
      p.jail = 0;
      log(state, `${p.name} zahlt ${JAIL_FEE} und verlässt den Hexenturm.`);
      stepAndLand(state, p, c.sum, rng);
      return;
    }
  }
  state.phase = 'manage';
}

function stepAndLand(state, p, sum, rng) {
  const from = p.pos;
  const np = from + sum;
  p.pos = np % BOARD_SIZE;
  if (np >= BOARD_SIZE) { money(state, 'bank', p.id, PASS_BONUS); log(state, `${p.name} zieht über das Rathaus (Start) (+${PASS_BONUS}).`); }
  state.last = { pid: p.id, from, to: p.pos, kind: 'dice' };
  log(state, `${p.name} zieht auf ${SQUARES[p.pos].name}.`);
  if (!land(state, p, sum, rng, {})) proceed(state, rng);
}
function advanceTo(state, p, target, rng, opts) {
  const from = p.pos;
  if (target <= from) { money(state, 'bank', p.id, PASS_BONUS); log(state, `${p.name} zieht über das Rathaus (Start) (+${PASS_BONUS}).`); }
  p.pos = target;
  state.last = { pid: p.id, from, to: target, kind: 'card' };
  log(state, `${p.name} rückt vor auf ${SQUARES[target].name}.`);
  return land(state, p, 0, rng, opts);
}
function sendToJail(state, p, why) {
  const from = p.pos;
  p.pos = JAIL_SQ;
  p.jail = 1;
  state.rollAgain = false;
  state.doubles = 0;
  state.last = { pid: p.id, from, to: JAIL_SQ, kind: 'jail' };
  log(state, `${p.name} kommt in den Hexenturm${why ? ' (' + why + ')' : ''}.`);
}

function startAuction(state, p) {
  if (!state.opts.auction) {
    log(state, `${SQUARES[p.pos].name} bleibt frei.`);
    return false;
  }
  const alive = state.players.filter((x) => !x.out).map((x) => x.id);
  const start = alive.indexOf(p.id);
  const order = alive.slice(start + 1).concat(alive.slice(0, start + 1));
  state.auction = { sq: p.pos, turn: order[0], high: 0, highBy: null, passed: [], order };
  state.phase = 'auction';
  log(state, `Auktion für ${SQUARES[p.pos].name}.`);
  return !auctionNext(state, null, order[order.length - 1]);
}
// Nächste Bietende bestimmen. Gibt true zurück, wenn die Auktion beendet wurde (Zuschlag oder unverkauft).
function auctionNext(state, rng, afterId) {
  const A = state.auction;
  const n = A.order.length;
  let idx = A.order.indexOf(afterId);
  for (let guard = 0; guard < 1000; guard++) {
    const live = A.order.filter((id) => !A.passed.includes(id));
    if (live.length === 0 || (A.highBy && live.length === 1 && live[0] === A.highBy)) { endAuction(state); return true; }
    idx = (idx + 1) % n;
    const id = A.order[idx];
    if (A.passed.includes(id) || id === A.highBy) continue;
    if (P(state, id).cash < A.high + 10) { A.passed.push(id); continue; }
    A.turn = id;
    return false;
  }
  return false;
}
function endAuction(state) {
  const A = state.auction;
  state.auction = null;
  if (A.highBy) {
    const w = P(state, A.highBy);
    money(state, w.id, 'bank', A.high);
    state.owners[A.sq] = w.id;
    if (SQUARES[A.sq].type === 'street') state.houses[A.sq] = 0;
    log(state, `${w.name} ersteigert ${SQUARES[A.sq].name} für ${A.high}.`);
  } else log(state, `Niemand bietet: ${SQUARES[A.sq].name} bleibt frei.`);
  state.phase = 'manage'; // wird von proceed() gesetzt
}

// Landung auf dem aktuellen Feld. true = Phase geöffnet (buy/auction/raise) oder Spielende.
function land(state, p, sum, rng, opts) {
  const s = SQUARES[p.pos];
  if (isProp(p.pos)) {
    const o = state.owners[p.pos];
    if (o === undefined) {
      if (p.cash >= s.price) { state.phase = 'buy'; return true; }
      log(state, `${p.name} kann sich ${s.name} (${s.price}) nicht leisten.`);
      return startAuction(state, p);
    }
    if (o === p.id) return false;
    if (state.mortgaged[p.pos]) { log(state, `${s.name} ist beliehen: keine Miete.`); return false; }
    let ro = opts;
    let dsum = sum;
    if (s.type === 'utility' && opts.mult) { dsum = die(rng) + die(rng); log(state, `${p.name} würfelt ${dsum} für die Nebenkosten.`); ro = { mult: opts.mult }; }
    const rent = rentOf(state, p.pos, dsum, ro);
    return queueDebts(state, [{ from: p.id, to: o, amount: rent, why: 'Miete ' + s.name }]);
  }
  if (s.type === 'tax') return queueDebts(state, [{ from: p.id, to: 'bank', amount: s.amount, why: s.name }]);
  if (s.type === 'gojail') { sendToJail(state, p, 'Feld "Gehe in den Hexenturm"'); return false; }
  if (s.type === 'event') return drawCard(state, p, rng);
  return false;
}

function nearest(from, list) {
  for (let k = 1; k <= BOARD_SIZE; k++) { const q = (from + k) % BOARD_SIZE; if (list.includes(q)) return q; }
  return list[0];
}
function drawCard(state, p, rng) {
  if (!state.deck.length) { state.deck = shuffle(state.discardPile.slice(), rng); state.discardPile = []; }
  const id = state.deck.pop();
  const c = CARDS[id];
  state.card = { pid: p.id, id, text: c.text };
  log(state, `Ereignis für ${p.name}: ${c.text}`);
  if (c.kind === 'free') p.freeCards++; else state.discardPile.push(id);
  const others = state.players.filter((x) => !x.out && x.id !== p.id);
  switch (c.kind) {
    case 'goto': return advanceTo(state, p, c.sq, rng, {});
    case 'station': return advanceTo(state, p, nearest(p.pos, STATION_SQS), rng, { double: true });
    case 'utility': return advanceTo(state, p, nearest(p.pos, UTILITY_SQS), rng, { mult: 10 });
    case 'back': {
      const from = p.pos;
      p.pos = (p.pos - c.steps + BOARD_SIZE) % BOARD_SIZE;
      state.last = { pid: p.id, from, to: p.pos, kind: 'card' };
      log(state, `${p.name} geht zurück auf ${SQUARES[p.pos].name}.`);
      return land(state, p, 0, rng, {});
    }
    case 'gain': money(state, 'bank', p.id, c.amount); return false;
    case 'pay': return queueDebts(state, [{ from: p.id, to: 'bank', amount: c.amount, why: 'Ereignis' }]);
    case 'jail': sendToJail(state, p, 'Ereigniskarte'); return false;
    case 'free': return false;
    case 'repair': {
      let h = 0, t = 0;
      for (const sq of ownedBy(state, p.id)) { const l = state.houses[sq] || 0; if (l === 5) t++; else h += l; }
      return queueDebts(state, [{ from: p.id, to: 'bank', amount: h * c.house + t * c.hotel, why: 'Reparatur' }]);
    }
    case 'collect': return queueDebts(state, others.map((o) => ({ from: o.id, to: p.id, amount: c.amount, why: 'Ereignis' })));
    case 'payall': return queueDebts(state, others.map((o) => ({ from: p.id, to: o.id, amount: c.amount, why: 'Ereignis' })));
  }
  return false;
}

// ---------- Nachrichten ----------
function doRoll(state, p, rng) {
  const a = die(rng), b = die(rng), sum = a + b;
  const dbl = a === b;
  state.dice = [a, b];
  state.card = null;
  log(state, `${p.name} würfelt ${a} und ${b}${dbl ? ' (Pasch)' : ''}.`);
  if (p.jail > 0) {
    state.rollAgain = false;
    if (dbl) { p.jail = 0; log(state, `${p.name} würfelt einen Pasch und ist frei.`); stepAndLand(state, p, sum, rng); return; }
    if (p.jail < 3) { p.jail++; log(state, `${p.name} bleibt im Hexenturm.`); state.phase = 'manage'; return; }
    state.cont = { k: 'jailmove', sum };
    log(state, `Dritter Fehlversuch: ${p.name} muss ${JAIL_FEE} zahlen.`);
    if (!queueDebts(state, [{ from: p.id, to: 'bank', amount: JAIL_FEE, why: 'Hexenturm' }])) proceed(state, rng);
    return;
  }
  if (dbl) {
    state.doubles++;
    if (state.doubles >= 3) { sendToJail(state, p, 'dritter Pasch'); state.phase = 'manage'; return; }
    state.rollAgain = true;
  } else state.rollAgain = false;
  stepAndLand(state, p, sum, rng);
}

function needPhase(state, ...phases) {
  return phases.includes(state.phase) ? null : 'Das ist jetzt nicht möglich.';
}
const sqOf = (m) => (Number.isInteger(m.sq) ? m.sq : -1);

const HANDLERS = {
  roll(state, p, m, rng) {
    const e = needPhase(state, 'roll'); if (e) return e;
    doRoll(state, p, rng);
  },
  pay_jail(state, p) {
    const e = needPhase(state, 'roll'); if (e) return e;
    if (p.jail < 1) return 'Du bist nicht im Gefängnis.';
    if (p.cash < JAIL_FEE) return `Zu wenig Bargeld (${JAIL_FEE} nötig).`;
    money(state, p.id, 'bank', JAIL_FEE);
    p.jail = 0;
    log(state, `${p.name} zahlt ${JAIL_FEE} und verlässt den Hexenturm.`);
  },
  use_card(state, p) {
    const e = needPhase(state, 'roll'); if (e) return e;
    if (p.jail < 1) return 'Du bist nicht im Gefängnis.';
    if (p.freeCards < 1) return 'Du hast keine Freikarte.';
    p.freeCards--;
    state.discardPile.push(FREE_CARD);
    p.jail = 0;
    log(state, `${p.name} setzt die Freikarte ein und verlässt den Hexenturm.`);
  },
  buy(state, p, m, rng) {
    const e = needPhase(state, 'buy'); if (e) return e;
    const s = SQUARES[p.pos];
    if (p.cash < s.price) return `Zu wenig Bargeld (${s.price} nötig).`;
    money(state, p.id, 'bank', s.price);
    state.owners[p.pos] = p.id;
    if (s.type === 'street') state.houses[p.pos] = 0;
    log(state, `${p.name} kauft ${s.name} für ${s.price}.`);
    proceed(state, rng);
  },
  decline(state, p, m, rng) {
    const e = needPhase(state, 'buy'); if (e) return e;
    log(state, `${p.name} lehnt den Kauf von ${SQUARES[p.pos].name} ab.`);
    if (!startAuction(state, p)) proceed(state, rng);
  },
  bid(state, p, m, rng) {
    const e = needPhase(state, 'auction'); if (e) return e;
    const A = state.auction;
    const amt = m.amount;
    if (!Number.isInteger(amt) || amt % 10 !== 0) return 'Gebote sind ganze Zehnerbeträge.';
    if (amt < A.high + 10) return `Das Gebot muss mindestens ${A.high + 10} betragen.`;
    if (amt > p.cash) return 'Du hast nicht genug Bargeld für dieses Gebot.';
    A.high = amt;
    A.highBy = p.id;
    log(state, `${p.name} bietet ${amt}.`);
    if (auctionNext(state, rng, p.id)) proceed(state, rng);
  },
  pass_bid(state, p, m, rng) {
    const e = needPhase(state, 'auction'); if (e) return e;
    const A = state.auction;
    A.passed.push(p.id);
    log(state, `${p.name} passt.`);
    if (auctionNext(state, rng, p.id)) proceed(state, rng);
  },
  build(state, p, m) {
    const e = needPhase(state, 'manage'); if (e) return e;
    const er = buildError(state, p.id, sqOf(m)); if (er) return er;
    doBuild(state, p, m.sq);
  },
  sell(state, p, m, rng) {
    const e = needPhase(state, 'manage', 'raise'); if (e) return e;
    const er = sellError(state, p.id, sqOf(m)); if (er) return er;
    doSell(state, p, m.sq);
    if (state.phase === 'raise') settleDebt(state, rng);
  },
  mortgage(state, p, m, rng) {
    const e = needPhase(state, 'manage', 'raise'); if (e) return e;
    const er = mortgageError(state, p.id, sqOf(m)); if (er) return er;
    doMortgage(state, p, m.sq);
    if (state.phase === 'raise') settleDebt(state, rng);
  },
  unmortgage(state, p, m) {
    const e = needPhase(state, 'manage'); if (e) return e;
    const er = unmortgageError(state, p.id, sqOf(m)); if (er) return er;
    doUnmortgage(state, p, m.sq);
  },
  end(state, p) {
    const e = needPhase(state, 'manage'); if (e) return e;
    if (state.rollAgain && !p.out && p.jail === 0) { state.rollAgain = false; state.phase = 'roll'; state.card = null; log(state, `${p.name} würfelt nochmal.`); } else nextTurn(state);
  },
  declare_bankrupt(state, p, m, rng) {
    const e = needPhase(state, 'raise'); if (e) return e;
    const d = state.debt;
    state.debt = null;
    bankrupt(state, p.id, d.to);
    if (state.phase === 'over') return;
    if (!queueDebts(state, d.then)) proceed(state, rng);
  },
};

function settleDebt(state, rng) {
  const d = state.debt;
  if (P(state, d.from).cash < d.amount) return;
  state.debt = null;
  transfer(state, d);
  if (!queueDebts(state, d.then)) proceed(state, rng);
}

export function handle(state, pid, msg, rng = Math.random) {
  if (!msg || typeof msg.t !== 'string') return err('Ungültige Nachricht.');
  if (state.phase === 'over') return err('Das Spiel ist beendet.');
  const p = P(state, pid);
  if (!p) return err('Unbekannte Person.');
  if (p.out) return err('Du bist ausgeschieden.');
  const actor = activePlayer(state);
  if (!actor || actor.id !== pid) return err('Du bist gerade nicht an der Reihe.');
  const fn = Object.prototype.hasOwnProperty.call(HANDLERS, msg.t) ? HANDLERS[msg.t] : null;
  if (!fn) return err('Unbekannte Aktion.');
  const e = fn(state, p, msg, rng);
  if (e) return err(e);
  state.seq++;
  return { ok: true };
}
