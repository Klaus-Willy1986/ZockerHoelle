// Stichprophet – reine Spiellogik für 3 bis 6 Personen (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen, erster Geber) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Alle Zustände sind reines JSON.
//
// Karten sind Zahlen 0..59:
//   0..51   Farbkarten: id = Farbe * 13 + (Wert - 1); Farbe 0 Rot ♥, 1 Gelb ♦, 2 Grün ♣, 3 Blau ♠; Wert 1..13
//   52..55  Zauberer (vier Stück, höchste Karten)
//   56..59  Narren (vier Stück, niedrigste Karten)
//
// Ablauf: Runde r (r = 1, 2, 3 …): jede Person bekommt r Karten. Die oberste Karte des Rests wird aufgedeckt:
//   ihre Farbe ist Trumpf; Narr → kein Trumpf; Zauberer → der Geber wählt die Trumpffarbe (Phase 'trump');
//   ist der Stapel leer (letzte Runde), gibt es keine Aufdeckkarte und keinen Trumpf.
//   Dann sagt jede Person an, wie viele Stiche sie macht (Phase 'bid', links vom Geber beginnend), dann wird gespielt.
// Wertung je Runde: richtig angesagt → 20 + 10 je Stich; sonst −10 je Stich Differenz.
//
// Nachrichten (handle): { t:'bid', n } · { t:'play', card } · { t:'trump', suit } · { t:'next' } (nur Gastgeber)
// Phasen: 'trump' → 'bid' → 'play' → 'round_over' (nächste Runde per 'next') | 'over' (letzte Runde gespielt)
//
// Hinweis: Die Hände stehen technisch im Zustand (wie bei den anderen Kartenspielen im Projekt akzeptiert);
// die Oberfläche zeigt nie fremde Hände, und der Computer liest sie nie.

export const SUITS = [
  { sym: '♥', name: 'Rot' },
  { sym: '♦', name: 'Gelb' },
  { sym: '♣', name: 'Grün' },
  { sym: '♠', name: 'Blau' },
];
export const NUM_CARDS = 60;
export const WIZ = 52;
export const FOOL = 56;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const BID_RIGHT = 20; // Grundpunkte für richtig angesagt
export const BID_STEP = 10; // je Stich (richtig: Pluspunkte, falsch: Minuspunkte je Abweichung)

export const isCardId = (c) => Number.isInteger(c) && c >= 0 && c < NUM_CARDS;
export const isWizard = (id) => id >= WIZ && id < FOOL;
export const isFool = (id) => id >= FOOL && id < NUM_CARDS;
export const kindOf = (id) => (id >= FOOL ? 2 : id >= WIZ ? 1 : 0); // 0 Farbkarte, 1 Zauberer, 2 Narr
export const suitOf = (id) => (id < WIZ ? Math.floor(id / 13) : -1);
export const rankOf = (id) => (id < WIZ ? (id % 13) + 1 : 0);
export const cardName = (id) => (isWizard(id) ? 'Zauberer' : isFool(id) ? 'Narr' : `${SUITS[suitOf(id)].name} ${rankOf(id)}`);
export const cardLabel = (id) => (isWizard(id) ? '🧙 Zauberer' : isFool(id) ? '🤡 Narr' : `${SUITS[suitOf(id)].sym} ${rankOf(id)}`);
export const trumpName = (t) => (Number.isInteger(t) ? `${SUITS[t].sym} ${SUITS[t].name}` : t === 'none' ? 'Kein Trumpf' : '');
export const trumpSuit = (g) => (g && Number.isInteger(g.trump) ? g.trump : -1);

// Sortierung für die Hand: Zauberer, dann Farben (Wert absteigend), zuletzt Narren
export function sortHand(ids) {
  const key = (id) => (isWizard(id) ? -1000 + id : isFool(id) ? 1000 + id : suitOf(id) * 100 - rankOf(id));
  return ids.slice().sort((a, b) => key(a) - key(b));
}

// ---------- Stichregeln (reine Funktionen auf Kartennummern, auch für den Computer) ----------
// Maßgebende Farbe eines Stichs: Farbe der ersten Nicht-Narren-Karte; ist diese ein Zauberer (oder gibt es nur Narren): -1 (keine)
export function ledSuitOf(ids) {
  for (const c of ids) {
    if (isFool(c)) continue;
    return isWizard(c) ? -1 : suitOf(c);
  }
  return -1;
}
// Schlägt die Karte c die bisher führende Karte cur? (trump: Trumpffarbe 0..3 oder -1)
export function beats(c, cur, trump) {
  if (isFool(c)) return false;
  if (isWizard(cur)) return false; // der erste Zauberer gewinnt
  if (isWizard(c)) return true;
  if (isFool(cur)) return true;
  const sc = suitOf(c);
  const su = suitOf(cur);
  if (sc === su) return rankOf(c) > rankOf(cur);
  return sc === trump && su !== trump;
}
// Index (im Stich) der Gewinnerkarte
export function winnerIndex(ids, trump) {
  let cur = 0;
  for (let i = 1; i < ids.length; i++) if (beats(ids[i], ids[cur], trump)) cur = i;
  return cur;
}
// Erlaubte Karten der Hand zu einem laufenden Stich (Farbzwang; Zauberer und Narren immer erlaubt)
export function legalPlays(hand, trickIds) {
  const led = ledSuitOf(trickIds);
  if (led < 0) return hand.slice();
  if (!hand.some((c) => suitOf(c) === led)) return hand.slice();
  return hand.filter((c) => suitOf(c) === led || kindOf(c) !== 0);
}
export const roundPoints = (bid, tricks) => (bid === tricks ? BID_RIGHT + BID_STEP * tricks : -BID_STEP * Math.abs(bid - tricks));

// Anzahl Runden bei n Personen
export const maxRounds = (n) => Math.floor(NUM_CARDS / n);
export const shortRounds = (n) => Math.ceil(maxRounds(n) / 2);

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const activePlayer = (g) => g.players[g.turn];
const RECAP_MAX = 6;
function pushRecap(g, line) {
  g.recap.unshift(line);
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}
const stichZahl = (n) => (n === 1 ? '1 Stich' : `${n} Stiche`);

// Welche Zahl darf die Person jetzt NICHT ansagen? (Option „Der Letzte darf nicht ausgleichen“), sonst null
export function forbiddenBid(g, pid) {
  if (!g || g.phase !== 'bid' || !g.opts.lastNotEqual) return null;
  const i = idxOf(g, pid);
  if (i < 0 || g.turn !== i || i !== g.dealer) return null;
  const sum = g.players.reduce((s, p) => s + (p.bid === null ? 0 : p.bid), 0);
  const f = g.round - sum;
  return f >= 0 && f <= g.round ? f : null;
}

// Erlaubte Karten der Person (leer, wenn sie nicht dran ist)
export function legalCards(g, pid) {
  if (!g || g.phase !== 'play') return [];
  const i = idxOf(g, pid);
  if (i < 0 || g.turn !== i) return [];
  return legalPlays(g.players[i].hand, g.trick.cards.map((x) => x.card));
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) throw new Error('Stichprophet braucht 3 bis 6 Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const n = playerList.length;
  const full = maxRounds(n);
  let total = o.short ? shortRounds(n) : full;
  if (Number.isInteger(o.totalRounds) && o.totalRounds >= 1 && o.totalRounds <= full) total = o.totalRounds;
  const g = {
    game: 'st',
    gid: Math.floor(rng() * 1e9),
    opts: { hints: !!o.hints, lastNotEqual: !!o.lastNotEqual, short: !!o.short },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], bid: null, tricks: 0, delta: 0, score: 0 })),
    round: Number.isInteger(o.startRound) && o.startRound >= 1 && o.startRound <= total ? o.startRound : 1, // startRound: nur für Tests
    totalRounds: total,
    dealer: Number.isInteger(o.dealer) && o.dealer >= 0 && o.dealer < n ? o.dealer : Math.min(n - 1, Math.floor(rng() * n)),
    leader: 0, turn: 0, trump: null, upcard: null,
    trick: { cards: [] }, last: null, played: [],
    sheet: [], phase: 'bid', recap: [], result: null,
  };
  deal(g, rng);
  return g;
}

function deal(g, rng) {
  const n = g.players.length;
  const r = g.round;
  const deck = shuffle(Array.from({ length: NUM_CARDS }, (_, i) => i), rng);
  for (const p of g.players) { p.hand = []; p.bid = null; p.tricks = 0; p.delta = 0; }
  for (let i = 0; i < r; i++) for (let k = 0; k < n; k++) g.players[(g.dealer + 1 + k) % n].hand.push(deck.pop());
  for (const p of g.players) p.hand = sortHand(p.hand);
  g.upcard = deck.length ? deck.pop() : null;
  g.played = [];
  g.trick = { cards: [] };
  g.last = null;
  g.result = null;
  g.recap = [];
  g.leader = (g.dealer + 1) % n;
  g.turn = g.leader;
  const dn = g.players[g.dealer].name;
  if (g.upcard === null) { g.trump = 'none'; g.phase = 'bid'; pushRecap(g, `${dn} hat gegeben. Es gibt keine Aufdeckkarte, also keinen Trumpf.`); }
  else if (isFool(g.upcard)) { g.trump = 'none'; g.phase = 'bid'; pushRecap(g, `${dn} hat gegeben. Aufgedeckt wurde ein Narr: kein Trumpf in dieser Runde.`); }
  else if (isWizard(g.upcard)) { g.trump = null; g.phase = 'trump'; g.turn = g.dealer; pushRecap(g, `${dn} hat gegeben. Aufgedeckt wurde ein Zauberer: ${dn} wählt die Trumpffarbe.`); }
  else { g.trump = suitOf(g.upcard); g.phase = 'bid'; pushRecap(g, `${dn} hat gegeben. Aufgedeckt wurde ${cardName(g.upcard)}: ${trumpName(g.trump)} ist Trumpf.`); }
}

export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'round_over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.round += 1;
  g.dealer = (g.dealer + 1) % g.players.length;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

function doTrump(g, pid, msg) {
  if (g.phase !== 'trump') return { ok: false, error: 'Der Trumpf steht schon fest.' };
  if (g.turn !== idxOf(g, pid)) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const s = msg.suit;
  if (!(Number.isInteger(s) && s >= 0 && s < 4)) return { ok: false, error: 'Diese Farbe gibt es nicht.' };
  g.trump = s;
  g.phase = 'bid';
  g.turn = g.leader;
  pushRecap(g, `${g.players[g.dealer].name} wählt ${trumpName(s)} als Trumpf.`);
  return { ok: true };
}

function doBid(g, pid, msg) {
  if (g.phase !== 'bid') return { ok: false, error: g.phase === 'play' ? 'Es wird schon gespielt.' : 'Jetzt wird nicht angesagt.' };
  const i = idxOf(g, pid);
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const n = msg.n;
  if (!(Number.isInteger(n) && n >= 0 && n <= g.round)) return { ok: false, error: 'Diese Ansage gibt es nicht.' };
  if (forbiddenBid(g, pid) === n) return { ok: false, error: 'Als Letzte oder Letzter darfst du nicht so ansagen, dass alle Ansagen genau aufgehen.' };
  g.players[i].bid = n;
  pushRecap(g, `${g.players[i].name} sagt ${stichZahl(n)} an.`);
  if (g.players.every((p) => p.bid !== null)) { g.phase = 'play'; g.turn = g.leader; }
  else g.turn = (i + 1) % g.players.length;
  return { ok: true };
}

function finishRound(g) {
  const rows = g.players.map((p) => {
    const d = roundPoints(p.bid, p.tricks);
    p.delta = d; p.score += d;
    return { id: p.id, name: p.name, bid: p.bid, tricks: p.tricks, delta: d, ok: p.bid === p.tricks };
  });
  g.sheet.push({ round: g.round, rows: rows.map((r) => ({ id: r.id, bid: r.bid, tricks: r.tricks, delta: r.delta })) });
  g.result = { round: g.round, rows, winners: null };
  g.trick = { cards: [] };
  g.turn = g.leader;
  const okN = rows.filter((r) => r.ok).length;
  pushRecap(g, okN ? `${okN === 1 ? '1 Person hat' : okN + ' Personen haben'} richtig angesagt.` : 'Niemand hat richtig angesagt.');
  if (g.round >= g.totalRounds) {
    const best = Math.max(...g.players.map((p) => p.score));
    g.result.winners = g.players.filter((p) => p.score === best).map((p) => p.id);
    g.phase = 'over';
  } else g.phase = 'round_over';
}

function doPlay(g, pid, msg) {
  if (g.phase !== 'play') return { ok: false, error: g.phase === 'bid' || g.phase === 'trump' ? 'Zuerst muss angesagt werden.' : 'Die Runde ist zu Ende.' };
  const i = idxOf(g, pid);
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const card = msg.card;
  if (!isCardId(card)) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  const p = g.players[i];
  const pos = p.hand.indexOf(card);
  if (pos < 0) return { ok: false, error: 'Diese Karte hast du nicht auf der Hand.' };
  if (!legalCards(g, pid).includes(card)) return { ok: false, error: 'Du musst Farbe bekennen.' };
  p.hand.splice(pos, 1);
  g.trick.cards.push({ pid, card });
  const n = g.players.length;
  if (g.trick.cards.length < n) { g.turn = (i + 1) % n; return { ok: true }; }
  const cards = g.trick.cards.map((x) => x.card);
  const wi = winnerIndex(cards, trumpSuit(g));
  const wpid = g.trick.cards[wi].pid;
  const wIdx = idxOf(g, wpid);
  const w = g.players[wIdx];
  w.tricks += 1;
  g.played.push(...cards);
  g.last = { cards: g.trick.cards.map((x) => ({ ...x })), winner: wpid };
  pushRecap(g, `${w.name} gewinnt den Stich (${cards.map(cardLabel).join(', ')}).`);
  g.trick = { cards: [] };
  g.leader = wIdx; g.turn = wIdx;
  if (g.players.every((q) => q.hand.length === 0)) finishRound(g);
  return { ok: true, trick: true };
}

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== 'st') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'next') {
    if (pid !== g.hostId) return { ok: false, error: 'Nur der Gastgeber kann die nächste Runde starten.' };
    if (g.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
    return nextRound(g, rng);
  }
  if (msg.t === 'trump') return doTrump(g, pid, msg);
  if (msg.t === 'bid') return doBid(g, pid, msg);
  if (msg.t === 'play') return doPlay(g, pid, msg);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

// Spielstand-Tabelle: mehr Punkte zuerst (bei Gleichstand gleicher Platz).
export function ranking(g) {
  const rows = g.players.map((p, idx) => ({ id: p.id, name: p.name, score: p.score, idx }));
  rows.sort((a, b) => b.score - a.score || a.idx - b.idx);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; delete r.idx; });
  return rows;
}
