// Bauernskat (Offiziersskat) – reine Spiellogik für genau 2 Personen (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen, erster Geber) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Alle Zustände sind reines JSON.
//
// Karten sind Zahlen 0..31: id = Farbe * 8 + Wert. Farbe 0 Kreuz ♣, 1 Pik ♠, 2 Herz ♥, 3 Karo ♦.
// Wert 0=7, 1=8, 2=9, 3=10, 4=Bube, 5=Dame, 6=König, 7=Ass.
//
// Spielfeld: Jede Person hat 8 Spalten { down: verdeckte Karte | null, up: offene Karte | null }.
// Wird die offene Karte gespielt, rückt die verdeckte Karte sofort als offene nach (down -> up, down = null).
// Hinweis: Die verdeckten Karten stehen technisch im Zustand (wie bei anderen Kartenspielen im Projekt);
// die Oberfläche zeigt sie nie, und die Computer-KI liest sie nie.
//
// Hilfsfunktionen für die Oberfläche:
//   cardSuit(id), cardRank(id)        Farbe 0..3 / Wert 0..7
//   cardValue(id)                     Augen der Karte (Ass 11, 10 → 10, König 4, Dame 3, Bube 2, 7/8/9 → 0)
//   cardLabel(id)                     z. B. "♥ Dame" (mit Farbsymbol), cardName(id): "Herz Dame"
//   isTrump(state, id)                Ist die Karte Trumpf? (Buben immer; dazu die Trumpffarbe; bei Grand nur Buben)
//   groupOf(state, id)                Bedien-Gruppe: 4 = Trumpf, sonst die Farbe 0..3
//   power(state, id)                  Stärke innerhalb der Gruppe (höher sticht)
//   legalCols(state, pid)             Spalten (0..7), deren offene Karte jetzt gespielt werden darf
//   trickWinner(state, trick)         pid des Stichgewinners (trick = { cards: [{pid, card, col}, {…}] })
//   sortCards(state, ids)             Karten sortiert (Trumpf zuerst, dann Farbe, absteigend nach Stärke)
//   ranking(state)                    Spielstand-Tabelle: [{ id, name, score, rank }]
//
// Nachrichten (handle): { t:'trump', suit: 0..3 | 'grand' } · { t:'play', col: 0..7 } · { t:'next' } (nur Gastgeber)
// Phasen: 'trump' (Vorhand wählt) → 'play' (16 Stiche) → 'round_over' (nächste Runde per 'next') | 'over' (Ziel erreicht).

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANKS = [
  { sym: '7', name: 'Sieben', aug: 0 },
  { sym: '8', name: 'Acht', aug: 0 },
  { sym: '9', name: 'Neun', aug: 0 },
  { sym: '10', name: 'Zehn', aug: 10 },
  { sym: 'B', name: 'Bube', aug: 2 },
  { sym: 'D', name: 'Dame', aug: 3 },
  { sym: 'K', name: 'König', aug: 4 },
  { sym: 'A', name: 'Ass', aug: 11 },
];
export const RJ = 4; // Wert Bube
export const COLS = 8;
export const TRICKS = 16;
export const TOTAL_AUGEN = 120;
export const DEFAULT_TARGET = 5;
// Reihenfolge außerhalb der Buben: Ass > 10 > König > Dame > 9 > 8 > 7
const ORDER = [0, 1, 2, 5, -1, 3, 4, 6]; // je Wert; der Bube (-1) gehört nie zu einer Farbe

export const cardSuit = (id) => id >> 3;
export const cardRank = (id) => id & 7;
export const cardValue = (id) => RANKS[id & 7].aug;
export const cardName = (id) => `${SUITS[id >> 3].name} ${RANKS[id & 7].name}`;
export const cardLabel = (id) => `${SUITS[id >> 3].sym} ${RANKS[id & 7].name}`;
export const isCardId = (c) => Number.isInteger(c) && c >= 0 && c < 32;

export const isGrand = (g) => g.trump === 'grand';
export function isTrump(g, id) {
  if ((id & 7) === RJ) return true;
  return Number.isInteger(g.trump) && (id >> 3) === g.trump;
}
export const groupOf = (g, id) => (isTrump(g, id) ? 4 : id >> 3);
// Stärke innerhalb der Gruppe: Buben 100+ (Kreuz 103, Pik 102, Herz 101, Karo 100), Trumpffarbe/Farbe 0..6
export function power(g, id) {
  const r = id & 7;
  if (r === RJ) return 100 + (3 - (id >> 3));
  return ORDER[r];
}

export function sortCards(g, ids) {
  const key = (id) => (isTrump(g, id) ? 0 : 1) * 1000 + (isTrump(g, id) ? 0 : (id >> 3) * 100) - power(g, id);
  return ids.slice().sort((a, b) => key(a) - key(b) || a - b);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const activePlayer = (g) => g.players[g.turn];
const emptyTrick = () => ({ cards: [] });
const RECAP_MAX = 6;
function pushRecap(g, line) {
  g.recap.unshift(line);
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

export const trumpName = (t) => (t === 'grand' ? 'Grand' : Number.isInteger(t) ? `${SUITS[t].sym} ${SUITS[t].name}` : '');

// Stichwertung: Stich mit zwei Karten. Gewinner ist, wer die höhere Karte der ausgespielten Gruppe hat,
// oder – wenn die ausgespielte Gruppe kein Trumpf ist – wer Trumpf zugegeben hat.
export function trickWinner(g, trick) {
  const [a, b] = trick.cards;
  const ga = groupOf(g, a.card);
  const gb = groupOf(g, b.card);
  if (ga === gb) return power(g, b.card) > power(g, a.card) ? b.pid : a.pid;
  if (gb === 4) return b.pid;
  return a.pid;
}

// Spalten, deren offene Karte der Person jetzt erlaubt sind (leer, wenn sie nicht dran ist).
export function legalCols(g, pid) {
  if (!g || g.phase !== 'play') return [];
  const i = idxOf(g, pid);
  if (i < 0 || g.turn !== i) return [];
  const cols = g.players[i].cols;
  const open = [];
  cols.forEach((c, k) => { if (c.up !== null) open.push(k); });
  if (!g.trick.cards.length) return open;
  const grp = groupOf(g, g.trick.cards[0].card);
  const follow = open.filter((k) => groupOf(g, cols[k].up) === grp);
  return follow.length ? follow : open;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length !== 2) throw new Error('Bauernskat braucht genau 2 Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const target = Number.isInteger(o.target) && o.target >= 1 && o.target <= 20 ? o.target : DEFAULT_TARGET;
  const g = {
    game: 'bsk',
    gid: Math.floor(rng() * 1e9),
    opts: { hints: !!o.hints, showPoints: !!o.showPoints, grandDouble: o.grandDouble === undefined ? true : !!o.grandDouble, target },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), cols: [], won: [], tricks: 0, points: 0, score: 0 })),
    round: 1,
    dealer: o.dealer === 0 || o.dealer === 1 ? o.dealer : Math.min(1, Math.floor(rng() * 2)),
    leader: 0, turn: 0, trump: null,
    trick: emptyTrick(), last: null,
    phase: 'trump', recap: [], result: null,
  };
  deal(g, rng);
  return g;
}

function deal(g, rng) {
  const deck = shuffle(Array.from({ length: 32 }, (_, i) => i), rng);
  for (const p of g.players) {
    p.cols = [];
    p.won = []; p.tricks = 0; p.points = 0;
  }
  for (let k = 0; k < COLS; k++) for (const p of g.players) p.cols.push({ down: deck.pop(), up: null });
  for (let k = 0; k < COLS; k++) for (const p of g.players) p.cols[k].up = deck.pop();
  g.leader = 1 - g.dealer; // Vorhand = wer nicht gegeben hat
  g.turn = g.leader;
  g.trump = null;
  g.trick = emptyTrick();
  g.last = null;
  g.phase = 'trump';
  g.result = null;
  g.recap = [];
  pushRecap(g, `${g.players[g.dealer].name} hat gegeben. ${g.players[g.leader].name} wählt den Trumpf.`);
}

// Nächste Runde: neu geben, Geber wechselt, Spielpunkte bleiben.
export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'round_over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.round += 1;
  g.dealer = 1 - g.dealer;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

function doTrump(g, pid, msg) {
  if (g.phase !== 'trump') return { ok: false, error: 'Der Trumpf ist schon gewählt.' };
  if (g.turn !== idxOf(g, pid)) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const s = msg.suit;
  if (!(s === 'grand' || (Number.isInteger(s) && s >= 0 && s < 4))) return { ok: false, error: 'Diesen Trumpf gibt es nicht.' };
  g.trump = s;
  g.phase = 'play';
  pushRecap(g, `${g.players[g.turn].name} wählt ${s === 'grand' ? 'Grand (nur die Buben sind Trumpf)' : trumpName(s) + ' als Trumpf'}.`);
  return { ok: true };
}

function finishRound(g) {
  const [a, b] = g.players;
  const res = { winner: null, winnerName: null, augen: { [a.id]: a.points, [b.id]: b.points }, tricks: { [a.id]: a.tricks, [b.id]: b.tricks },
    trump: g.trump, grand: g.trump === 'grand', value: 0, schneider: false, schwarz: false, gained: { [a.id]: 0, [b.id]: 0 }, gameWinner: null };
  let w = null;
  if (a.points > 60) w = a; else if (b.points > 60) w = b;
  if (w) {
    const l = w === a ? b : a;
    res.winner = w.id; res.winnerName = w.name;
    res.schwarz = l.tricks === 0;
    res.schneider = !res.schwarz && l.points <= 30;
    let v = res.schwarz ? 3 : res.schneider ? 2 : 1;
    if (res.grand && g.opts.grandDouble) v *= 2;
    res.value = v;
    res.gained[w.id] = v;
    w.score += v;
    pushRecap(g, `${w.name} gewinnt die Runde mit ${w.points} Augen${res.schwarz ? ' (Schwarz)' : res.schneider ? ' (Schneider)' : ''} und bekommt ${v} ${v === 1 ? 'Punkt' : 'Punkte'}.`);
  } else {
    pushRecap(g, 'Unentschieden: Beide haben 60 Augen. Niemand bekommt Punkte.');
  }
  g.trick = emptyTrick();
  g.turn = g.leader;
  if (w && w.score >= g.opts.target) {
    res.gameWinner = w.id;
    g.phase = 'over';
  } else g.phase = 'round_over';
  g.result = res;
}

function doPlay(g, pid, msg) {
  if (g.phase !== 'play') return { ok: false, error: g.phase === 'trump' ? 'Zuerst muss der Trumpf gewählt werden.' : 'Die Runde ist zu Ende.' };
  const i = idxOf(g, pid);
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const col = msg.col;
  if (!(Number.isInteger(col) && col >= 0 && col < COLS)) return { ok: false, error: 'Diese Spalte gibt es nicht.' };
  const p = g.players[i];
  if (p.cols[col].up === null) return { ok: false, error: 'In dieser Spalte liegt keine Karte mehr.' };
  if (!legalCols(g, pid).includes(col)) return { ok: false, error: 'Du musst Farbe bekennen.' };
  const c = p.cols[col];
  const card = c.up;
  c.up = c.down; c.down = null; // verdeckte Karte wird sofort aufgedeckt
  g.trick.cards.push({ pid, card, col });
  if (g.trick.cards.length < 2) { g.turn = 1 - i; return { ok: true }; }
  const wpid = trickWinner(g, g.trick);
  const wi = idxOf(g, wpid);
  const w = g.players[wi];
  const cards = g.trick.cards.map((x) => x.card);
  const aug = cards.reduce((s, x) => s + cardValue(x), 0);
  w.won.push(...cards); w.tricks += 1; w.points += aug;
  g.last = { cards: g.trick.cards.map((x) => ({ ...x })), winner: wpid, augen: aug };
  pushRecap(g, `${w.name} gewinnt den Stich (${cards.map(cardLabel).join(', ')}).`);
  g.trick = emptyTrick();
  g.leader = wi; g.turn = wi;
  if (g.players[0].tricks + g.players[1].tricks >= TRICKS) finishRound(g);
  return { ok: true, trick: true };
}

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== 'bsk') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'next') {
    if (pid !== g.hostId) return { ok: false, error: 'Nur der Gastgeber kann die nächste Runde starten.' };
    if (g.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
    return nextRound(g, rng);
  }
  if (msg.t === 'trump') return doTrump(g, pid, msg);
  if (msg.t === 'play') return doPlay(g, pid, msg);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

// Spielstand-Tabelle: mehr Spielpunkte zuerst (bei Gleichstand gleicher Platz).
export function ranking(g) {
  const rows = g.players.map((p, idx) => ({ id: p.id, name: p.name, score: p.score, idx }));
  rows.sort((a, b) => b.score - a.score || a.idx - b.idx);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; delete r.idx; });
  return rows;
}
