// Doppelkopf – reine Spiellogik für genau 4 Personen (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen, erster Geber) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Alle Zustände sind reines JSON.
//
// Karten sind Zahlen 0..47: id = Typ * 2 + Exemplar (jede Karte gibt es doppelt), Typ = Farbe * 6 + Wert.
// Farbe 0 Kreuz ♣, 1 Pik ♠, 2 Herz ♥, 3 Karo ♦. Wert 0=9, 1=10, 2=Bube, 3=Dame, 4=König, 5=Ass.
// Augen: Ass 11, 10 → 10, König 4, Dame 3, Bube 2, 9 → 0 (zusammen 240).
//
// Normalspiel: Trumpf (hoch → niedrig): Herz-10 ("Dulle"), Damen (♣ ♠ ♥ ♦), Buben (♣ ♠ ♥ ♦), Karo Ass, 10, König, 9.
// Fehlfarben ♣ ♠ ♥: Ass, 10, König, 9 (Herz ohne die Herz-10). Gleiche Karten: die zuerst gespielte ist höher
// (Ausnahme: im letzten Stich schlägt die zweite Dulle die erste).
// Teams: Re = Personen mit einer Kreuz-Dame, Kontra = die anderen. Wer beide Kreuz-Damen hat, hat eine Hochzeit
// (opts.wedding, Standard an): Die Person ist Re, die erste andere Person, die bis zum 3. Stich einen Stich gewinnt,
// wird ihre Partnerin; sonst spielt sie allein (Punkte ×3 für die Einzelperson, Nullsumme).
// Ohne opts.wedding spielt die Person mit beiden Kreuz-Damen von Anfang an allein.
//
// Hinweis: Die Hände stehen technisch im Zustand (wie bei anderen Kartenspielen im Projekt); die Oberfläche zeigt
// fremde Hände nie, und die Computer-KI liest nur die eigene Hand und öffentliche Informationen.
//
// Hilfsfunktionen: cardSuit, cardRank, cardType, cardValue, cardLabel, cardName, isTrump(card), groupOf, power,
//   legalCards(state,pid), trickWinner(state,trick[,isLast]), teamOf(state,pid), canAnnounce(state,pid),
//   sortCards(ids), scoreRound(state), ranking(state).
// Nachrichten (handle): { t:'play', card } · { t:'announce', what:'re'|'kontra' } · { t:'next' } (nur Gastgeber)
// Phasen: 'play' (12 Stiche) → 'round_over' (nächste Runde per 'next') | 'over' (letzte Runde gespielt).

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANKS = [
  { sym: '9', name: 'Neun', aug: 0 },
  { sym: '10', name: 'Zehn', aug: 10 },
  { sym: 'B', name: 'Bube', aug: 2 },
  { sym: 'D', name: 'Dame', aug: 3 },
  { sym: 'K', name: 'König', aug: 4 },
  { sym: 'A', name: 'Ass', aug: 11 },
];
export const R9 = 0, R10 = 1, RJ = 2, RQ = 3, RK = 4, RA = 5;
export const NP = 4;
export const CARDS = 48;
export const HAND = 12;
export const TRICKS = 12;
export const TOTAL_AUGEN = 240;
export const DEFAULT_ROUNDS = 6;
export const TRUMP_GROUP = 3;
export const DULLE_TYPE = 2 * 6 + R10; // Herz-10
export const KREUZ_DAME_TYPE = 0 * 6 + RQ;
export const KREUZ_BUBE_TYPE = 0 * 6 + RJ;
export const FUCHS_TYPE = 3 * 6 + RA; // Karo-Ass

export const cardType = (id) => id >> 1;
export const cardSuit = (id) => Math.floor((id >> 1) / 6);
export const cardRank = (id) => (id >> 1) % 6;
export const cardValue = (id) => RANKS[cardRank(id)].aug;
export const cardName = (id) => `${SUITS[cardSuit(id)].name} ${RANKS[cardRank(id)].name}`;
export const cardLabel = (id) => `${SUITS[cardSuit(id)].sym} ${RANKS[cardRank(id)].name}`;
export const isCardId = (c) => Number.isInteger(c) && c >= 0 && c < CARDS;
export const isDulle = (id) => cardType(id) === DULLE_TYPE;
export const isKreuzDame = (id) => cardType(id) === KREUZ_DAME_TYPE;
export const isFuchs = (id) => cardType(id) === FUCHS_TYPE;

export function isTrump(id) {
  const s = cardSuit(id), r = cardRank(id);
  return s === 3 || r === RJ || r === RQ || cardType(id) === DULLE_TYPE;
}
export const groupOf = (id) => (isTrump(id) ? TRUMP_GROUP : cardSuit(id));
// Stärke: Dulle 100 · Damen 90..87 · Buben 80..77 · Karo Ass 70, 10 69, König 68, 9 67 · Fehlfarbe Ass 4, 10 3, König 2, 9 1
// genaue Reihenfolge (siehe Tabelle unten)
const FARB_ORDER = [1, 3, 0, 0, 2, 4]; // Wert → Stärke in einer Fehlfarbe: 9=1, 10=3, K=2, A=4 (B/D nie Fehlfarbe)
const KARO_ORDER = [67, 69, 0, 0, 68, 70];
const POWER = new Int16Array(CARDS);
for (let id = 0; id < CARDS; id++) {
  const s = cardSuit(id), r = cardRank(id);
  let p;
  if (cardType(id) === DULLE_TYPE) p = 100;
  else if (r === RQ) p = 90 - s;
  else if (r === RJ) p = 80 - s;
  else if (s === 3) p = KARO_ORDER[r];
  else p = FARB_ORDER[r];
  POWER[id] = p;
}
export const power = (id) => POWER[id];
export const powerOf = power;

// Hand sortieren: Trümpfe zuerst (stark → schwach), dann ♣, ♠, ♥ (Ass, 10, König, 9)
export function sortCards(ids) {
  const key = (id) => (isTrump(id) ? 0 : 1000 + cardSuit(id) * 100) - POWER[id];
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

// Stichwertung. trick = { cards: [{ pid, card }, …] } in Spielreihenfolge. isLast: ist es der 12. Stich?
export function trickWinner(g, trick, isLast) {
  const last = isLast === undefined ? !!g && g.tricksDone === TRICKS - 1 : !!isLast;
  const cs = trick.cards;
  const gl = groupOf(cs[0].card);
  const key = (c) => (isTrump(c) ? 1000 + POWER[c] : groupOf(c) === gl ? POWER[c] : -1);
  let best = 0;
  for (let i = 1; i < cs.length; i++) {
    const a = key(cs[i].card), b = key(cs[best].card);
    if (a > b || (a === b && last && isDulle(cs[i].card) && isDulle(cs[best].card))) best = i;
  }
  return cs[best].pid;
}

// Karten der Hand, die jetzt erlaubt sind (leer, wenn die Person nicht dran ist).
export function legalCards(g, pid) {
  if (!g || g.phase !== 'play') return [];
  const i = idxOf(g, pid);
  if (i < 0 || g.turn !== i) return [];
  const hand = g.players[i].hand;
  if (!g.trick.cards.length) return hand.slice();
  const grp = groupOf(g.trick.cards[0].card);
  const follow = hand.filter((c) => groupOf(c) === grp);
  return follow.length ? follow : hand.slice();
}

// Nur für die Engine/KI-Sicht (Hände verdeckt!): wahres Team der Person.
export function teamOf(g, pid) {
  const i = idxOf(g, pid);
  return i < 0 ? null : g.team[i];
}

// Welche Ansage darf die Person jetzt machen? 're' | 'kontra' | null. Nur vor der ersten eigenen Karte, einmal je Team.
export function canAnnounce(g, pid) {
  if (!g || g.phase !== 'play') return null;
  const i = idxOf(g, pid);
  if (i < 0) return null;
  if (g.players[i].hand.length !== HAND) return null;
  const t = g.team[i];
  if (g.announced[t] !== null) return null;
  if (g.wedding && g.wedding.state === 'open' && t !== 're') return null; // wer Partner:in wird, steht noch nicht fest
  if (g.wedding && g.wedding.state === 'open' && g.wedding.player !== i) return null;
  return t;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length !== NP) throw new Error('Doppelkopf braucht genau 4 Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const rounds = Number.isInteger(o.rounds) && o.rounds >= 1 && o.rounds <= 20 ? o.rounds : DEFAULT_ROUNDS;
  const g = {
    game: 'dk',
    gid: Math.floor(rng() * 1e9),
    opts: { hints: !!o.hints, wedding: o.wedding === undefined ? true : !!o.wedding, rounds },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], won: [], tricks: 0, points: 0, total: 0 })),
    round: 1,
    dealer: Number.isInteger(o.dealer) && o.dealer >= 0 && o.dealer < NP ? o.dealer : Math.min(NP - 1, Math.floor(rng() * NP)),
    leader: 0, turn: 0,
    trick: emptyTrick(), last: null, history: [], tricksDone: 0,
    team: [], known: [], wedding: null, announced: { re: null, kontra: null },
    phase: 'play', recap: [], result: null,
  };
  deal(g, rng);
  return g;
}

function deal(g, rng) {
  const deck = shuffle(Array.from({ length: CARDS }, (_, i) => i), rng);
  dealHands(g, g.players.map((p, i) => deck.slice(i * HAND, (i + 1) * HAND)));
}

// Verteilt vorgegebene Hände (je 12 Karten) und setzt Teams, Hochzeit und Rundenzustand zurück.
// (Auch für Tests mit festen Händen.)
export function dealHands(g, hands) {
  g.players.forEach((p, i) => {
    p.hand = sortCards(hands[i]);
    p.won = []; p.tricks = 0; p.points = 0;
  });
  g.leader = (g.dealer + 1) % NP;
  g.turn = g.leader;
  g.trick = emptyTrick();
  g.last = null; g.history = []; g.tricksDone = 0;
  g.announced = { re: null, kontra: null };
  g.phase = 'play'; g.result = null; g.recap = [];
  // Teams
  const kd = g.players.map((p) => p.hand.filter(isKreuzDame).length);
  g.team = kd.map((n) => (n > 0 ? 're' : 'kontra'));
  g.known = g.players.map(() => null);
  g.wedding = null;
  const w = kd.findIndex((n) => n === 2);
  pushRecap(g, `${g.players[g.dealer].name} hat gegeben. ${g.players[g.leader].name} spielt aus.`);
  if (w >= 0) {
    g.wedding = { player: w, partner: null, state: g.opts.wedding ? 'open' : 'alone' };
    g.known[w] = 're';
    if (!g.opts.wedding) g.known = g.known.map((k, i) => (i === w ? 're' : 'kontra'));
    pushRecap(g, g.opts.wedding
      ? `${g.players[w].name} hat eine Hochzeit (beide Kreuz-Damen). Wer bis zum 3. Stich einen Stich gewinnt, wird Partner oder Partnerin.`
      : `${g.players[w].name} hat beide Kreuz-Damen und spielt allein gegen alle.`);
  }
}

// Nächste Runde: neu geben, Geber rotiert, Gesamtstand bleibt.
export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'round_over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.round += 1;
  g.dealer = (g.dealer + 1) % NP;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

// Wer ist öffentlich als Re/Kontra bekannt? Schlussfolgerungen: zwei Re bekannt → Rest Kontra; zwei Kontra → Rest Re.
function deduce(g) {
  if (g.wedding && g.wedding.state === 'open') return;
  const re = g.known.filter((k) => k === 're').length;
  const ko = g.known.filter((k) => k === 'kontra').length;
  const reTotal = g.team.filter((t) => t === 're').length;
  const koTotal = NP - reTotal;
  if (re === reTotal) g.known = g.known.map((k) => k || 'kontra');
  else if (ko === koTotal) g.known = g.known.map((k) => k || 're');
}

function doAnnounce(g, pid, msg) {
  if (g.phase !== 'play') return { ok: false, error: 'Jetzt kann nichts angesagt werden.' };
  const i = idxOf(g, pid);
  if (msg.what !== 're' && msg.what !== 'kontra') return { ok: false, error: 'Diese Ansage gibt es nicht.' };
  if (g.players[i].hand.length !== HAND) return { ok: false, error: 'Angesagt wird nur vor deiner ersten Karte.' };
  const can = canAnnounce(g, pid);
  if (!can) return { ok: false, error: 'Du kannst gerade nichts ansagen.' };
  if (can !== msg.what) return { ok: false, error: `Du gehörst nicht zu ${msg.what === 're' ? 'Re' : 'Kontra'}.` };
  g.announced[can] = i;
  g.known[i] = can;
  deduce(g);
  pushRecap(g, `${g.players[i].name} sagt „${can === 're' ? 'Re' : 'Kontra'}“ an. Der Spielwert verdoppelt sich.`);
  return { ok: true };
}

function resolveWedding(g, winnerIdx) {
  const w = g.wedding;
  if (!w || w.state !== 'open') return;
  if (winnerIdx !== w.player && g.tricksDone <= 3) {
    w.partner = winnerIdx; w.state = 'partner';
    g.team[winnerIdx] = 're';
    g.known = g.team.slice();
    pushRecap(g, `${g.players[winnerIdx].name} hat den Stich gewonnen und ist jetzt Partner oder Partnerin von ${g.players[w.player].name} (Re).`);
  } else if (g.tricksDone >= 3) {
    w.state = 'alone';
    g.known = g.team.slice();
    pushRecap(g, `Niemand hat einen Stich gegen ${g.players[w.player].name} gewonnen. ${g.players[w.player].name} spielt allein gegen alle.`);
  }
}

function doPlay(g, pid, msg) {
  if (g.phase !== 'play') return { ok: false, error: 'Die Runde ist zu Ende.' };
  const i = idxOf(g, pid);
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const card = msg.card;
  if (!isCardId(card)) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  const p = g.players[i];
  if (!p.hand.includes(card)) return { ok: false, error: 'Diese Karte hast du nicht.' };
  if (!legalCards(g, pid).includes(card)) return { ok: false, error: 'Du musst bedienen.' };
  p.hand.splice(p.hand.indexOf(card), 1);
  g.trick.cards.push({ pid, card });
  if (isKreuzDame(card) && g.known[i] !== 're') { g.known[i] = 're'; deduce(g); }
  if (g.trick.cards.length < NP) { g.turn = (i + 1) % NP; return { ok: true }; }
  const wpid = trickWinner(g, g.trick, g.tricksDone === TRICKS - 1);
  const wi = idxOf(g, wpid);
  const w = g.players[wi];
  const cards = g.trick.cards.map((x) => x.card);
  const aug = cards.reduce((s, x) => s + cardValue(x), 0);
  const winCard = g.trick.cards.find((x) => x.pid === wpid).card;
  w.won.push(...cards); w.tricks += 1; w.points += aug;
  const rec = { cards: g.trick.cards.map((x) => ({ ...x })), winner: wpid, winCard, augen: aug, last: g.tricksDone === TRICKS - 1 };
  g.history.push(rec);
  g.last = rec;
  g.tricksDone += 1;
  pushRecap(g, `${w.name} gewinnt den Stich (${cards.map(cardLabel).join(', ')}).`);
  g.trick = emptyTrick();
  g.leader = wi; g.turn = wi;
  resolveWedding(g, wi);
  if (g.tricksDone >= TRICKS) finishRound(g);
  return { ok: true, trick: true };
}

// Wertung der Runde (aus Verlauf und endgültigen Teams). Verändert den Zustand nicht.
export function scoreRound(g) {
  const reIdx = [], koIdx = [];
  g.team.forEach((t, i) => (t === 're' ? reIdx : koIdx).push(i));
  const reAug = reIdx.reduce((s, i) => s + g.players[i].points, 0);
  const koAug = koIdx.reduce((s, i) => s + g.players[i].points, 0);
  const reWon = reAug >= 121;
  const winner = reWon ? 're' : 'kontra';
  const loserAug = reWon ? koAug : reAug;
  const lines = [{ key: 'gewonnen', label: 'Gewonnen', pts: 1 }];
  if (!reWon) lines.push({ key: 'alten', label: 'Gegen die Alten', pts: 1 });
  if (loserAug <= 89) lines.push({ key: 'k90', label: 'Keine 90', pts: 1 });
  if (loserAug <= 59) lines.push({ key: 'k60', label: 'Keine 60', pts: 1 });
  if (loserAug <= 29) lines.push({ key: 'k30', label: 'Keine 30', pts: 1 });
  if (loserAug === 0) lines.push({ key: 'schwarz', label: 'Schwarz', pts: 1 });
  const base = lines.reduce((s, l) => s + l.pts, 0);
  const announcedRe = g.announced.re !== null, announcedKo = g.announced.kontra !== null;
  const mult = (announcedRe ? 2 : 1) * (announcedKo ? 2 : 1);
  const sp = { re: { fuchs: 0, doppelkopf: 0, karlchen: 0 }, kontra: { fuchs: 0, doppelkopf: 0, karlchen: 0 } };
  const idx = (pid) => g.players.findIndex((p) => p.id === pid);
  for (const tr of g.history) {
    const wt = g.team[idx(tr.winner)];
    for (const c of tr.cards) {
      if (isFuchs(c.card) && g.team[idx(c.pid)] !== wt) sp[wt].fuchs += 1;
    }
    if (tr.augen >= 40) sp[wt].doppelkopf += 1;
    if (tr.last && cardType(tr.winCard) === KREUZ_BUBE_TYPE) sp[wt].karlchen += 1;
  }
  const sum = (t) => sp[t].fuchs + sp[t].doppelkopf + sp[t].karlchen;
  const reBalance = (reWon ? 1 : -1) * base * mult + sum('re') - sum('kontra');
  const delta = {};
  const r = reIdx.length;
  g.players.forEach((p, i) => {
    delta[p.id] = (g.team[i] === 're' ? (reBalance * (NP - r)) / r : -reBalance) + 0; // + 0: kein „−0“
  });
  return {
    winner, reAugen: reAug, kontraAugen: koAug, lines, base, mult,
    announced: { re: announcedRe, kontra: announcedKo },
    special: sp, reBalance, delta,
    teams: Object.fromEntries(g.players.map((p, i) => [p.id, g.team[i]])),
    alone: r === 1, gameWinner: null, winners: [],
  };
}

function finishRound(g) {
  const res = scoreRound(g);
  g.players.forEach((p) => { p.total += res.delta[p.id]; });
  g.known = g.team.slice();
  const wn = res.winner === 're' ? 'Re' : 'Kontra';
  pushRecap(g, `${wn} gewinnt die Runde mit ${res.winner === 're' ? res.reAugen : res.kontraAugen} Augen.`);
  g.turn = g.leader;
  if (g.round >= g.opts.rounds) {
    g.phase = 'over';
    const best = Math.max(...g.players.map((p) => p.total));
    const top = g.players.filter((p) => p.total === best);
    res.gameWinner = top.length === 1 ? top[0].id : null;
    res.winners = top.map((p) => p.id); // bei Punktgleichstand an der Spitze mehrere
  } else g.phase = 'round_over';
  g.result = res;
}

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== 'dk') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'next') {
    if (pid !== g.hostId) return { ok: false, error: 'Nur der Gastgeber kann die nächste Runde starten.' };
    if (g.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
    return nextRound(g, rng);
  }
  if (msg.t === 'play') return doPlay(g, pid, msg);
  if (msg.t === 'announce') return doAnnounce(g, pid, msg);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

// Gesamtstand: mehr Punkte zuerst (bei Gleichstand gleicher Platz).
export function ranking(g) {
  const rows = g.players.map((p, idx) => ({ id: p.id, name: p.name, score: p.total, idx }));
  rows.sort((a, b) => b.score - a.score || a.idx - b.idx);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; delete r.idx; });
  return rows;
}
