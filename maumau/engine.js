// Mau-Mau – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind { s: Farbe 0..3, r: Wert 0..7 }. Alle Zustände sind reines JSON.

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANKS = [
  { sym: '7', name: 'Sieben', value: 7 },
  { sym: '8', name: 'Acht', value: 8 },
  { sym: '9', name: 'Neun', value: 9 },
  { sym: '10', name: 'Zehn', value: 10 },
  { sym: 'B', name: 'Bube', value: 20 },
  { sym: 'D', name: 'Dame', value: 10 },
  { sym: 'K', name: 'König', value: 10 },
  { sym: 'A', name: 'Ass', value: 11 },
];
export const R7 = 0;
export const R8 = 1;
export const RJ = 4; // Bube
export const RA = 7; // Ass
export const HAND_SIZE = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const PENALTY = 2;
const RECAP_MAX = 6;
const MOVE_CAP = 700; // Sicherung: spätestens dann endet eine Runde

export const cardName = (c) => `${SUITS[c.s].sym} ${RANKS[c.r].name}`;
export const cardValue = (c) => RANKS[c.r].value;
export const sameCard = (a, b) => !!a && !!b && a.s === b.s && a.r === b.r;
export const handPoints = (hand) => hand.reduce((s, c) => s + cardValue(c), 0);
const isCard = (c) => !!c && typeof c === 'object' && Number.isInteger(c.s) && Number.isInteger(c.r) && c.s >= 0 && c.s < 4 && c.r >= 0 && c.r < 8;
const sortHand = (hand) => hand.sort((a, b) => a.s - b.s || a.r - b.r);

export function fullDeck(copies) {
  const d = [];
  for (let k = 0; k < copies; k++) for (let s = 0; s < 4; s++) for (let r = 0; r < 8; r++) d.push({ s, r });
  return d;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const top = (g) => g.discard[g.discard.length - 1];
export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
const nextIdx = (g, from) => ((from + g.dir) % g.players.length + g.players.length) % g.players.length;
export const nextPlayerIndex = (g) => nextIdx(g, g.active);

function pushRecap(g, line) {
  g.recap.unshift(line); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

// Darf diese Karte jetzt auf den Ablagestapel? (Wunsch nach einem Buben gilt, solange der Bube oben liegt.)
export function playable(g, c) {
  if (!g || !isCard(c) || !g.discard.length) return false;
  if (c.r === RJ) return true;
  if (g.wish !== null && g.wish !== undefined) return c.s === g.wish;
  const t = top(g);
  return c.s === t.s || c.r === t.r;
}

// Alle verschiedenen spielbaren Karten der Person (ohne Doppelte).
export function legalCards(g, pid) {
  const p = g.players[idxOf(g, pid)];
  if (!p) return [];
  const out = [];
  for (const c of p.hand) if (playable(g, c) && !out.some((x) => sameCard(x, c))) out.push({ s: c.s, r: c.r });
  return out;
}

export const hasPlayable = (g, p) => p.hand.some((c) => playable(g, c));

function reshuffle(g, rng) {
  if (g.deck.length || g.discard.length <= 1) return false;
  const t = g.discard.pop();
  g.deck = shuffle(g.discard, rng);
  g.discard = [t];
  pushRecap(g, 'Der Stapel war leer: Die Karten vom Ablagestapel wurden neu gemischt.');
  return true;
}

// Zieht bis zu k Karten; gibt die gezogenen zurück.
function drawCards(g, p, k, rng) {
  const got = [];
  for (let i = 0; i < k; i++) {
    if (!g.deck.length) reshuffle(g, rng);
    if (!g.deck.length) break;
    const c = g.deck.pop();
    p.hand.push(c);
    got.push(c);
  }
  sortHand(p.hand);
  return got;
}

const kartenWort = (n) => (n === 1 ? 'eine Karte' : n === 2 ? 'zwei Karten' : `${n} Karten`);

// ---------- Rundenaufbau ----------
function deal(g, rng) {
  const n = g.players.length;
  g.deck = shuffle(fullDeck(n >= 5 ? 2 : 1), rng);
  g.discard = [];
  for (const p of g.players) p.hand = [];
  for (let k = 0; k < HAND_SIZE; k++) for (const p of g.players) p.hand.push(g.deck.pop());
  for (const p of g.players) sortHand(p.hand);
  g.discard.push(g.deck.pop()); // Startkarte: zählt als normale Karte
  g.active = g.starter;
  g.dir = 1;
  g.wish = null;
  g.mau = null;
  g.stall = 0;
  g.moves = 0;
  g.turn = { forced: null, drew: false, drawn: null };
  g.phase = 'play';
  g.result = null;
  g.recap = [];
  g.last = null;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Mau-Mau braucht 2 bis 6 Personen.');
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = {
    game: 'mm',
    gid: Math.floor(rng() * 1e9),
    opts: { ace: !!o.ace, auto: !!o.auto },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], wins: 0, points: 0 })),
    decks: playerList.length >= 5 ? 2 : 1,
    round: 1,
    starter: 0,
    deck: [], discard: [], active: 0, dir: 1, wish: null, mau: null, stall: 0, moves: 0,
    turn: { forced: null, drew: false, drawn: null },
    phase: 'play', result: null, recap: [], last: null,
  };
  deal(g, rng);
  return g;
}

// Nächste Runde der Serie: neu mischen und geben, die Startperson rotiert, der Spielstand bleibt.
export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.round += 1;
  g.starter = (g.starter + 1) % g.players.length;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

// ---------- Rundenende ----------
function endRound(g, winnerIdx, blocked) {
  const w = g.players[winnerIdx];
  const pts = {};
  for (const p of g.players) pts[p.id] = p === w ? 0 : handPoints(p.hand);
  for (const p of g.players) p.points += pts[p.id];
  w.wins += 1;
  g.phase = 'over';
  g.mau = null;
  g.turn = { forced: null, drew: false, drawn: null };
  g.result = { winner: w.id, winnerName: w.name, points: pts, blocked: !!blocked };
  pushRecap(g, blocked
    ? `Es geht nichts mehr. ${w.name} hat die wenigsten Punkte und gewinnt die Runde.`
    : `${w.name} hat keine Karten mehr und gewinnt die Runde!`);
  g.last = { kind: 'over', pid: w.id, name: w.name, text: g.recap[0] };
}

function blockedEnd(g, rng) {
  let best = -1;
  let bestPts = Infinity;
  let bestCnt = Infinity;
  for (let k = 0; k < g.players.length; k++) {
    const i = (g.active + k) % g.players.length;
    const p = g.players[i];
    const pts = handPoints(p.hand);
    if (pts < bestPts || (pts === bestPts && p.hand.length < bestCnt)) { best = i; bestPts = pts; bestCnt = p.hand.length; }
  }
  endRound(g, best, true);
}

// ---------- Hilfen für Züge ----------
function advance(g) {
  g.active = nextIdx(g, g.active);
  g.turn = { forced: null, drew: false, drawn: null };
}

// Hat jemand „Mau!“ vergessen? Wird aufgerufen, sobald eine ANDERE Person handelt.
function settleMau(g, actorIdx, rng) {
  const m = g.mau;
  if (!m) return;
  const actor = g.players[actorIdx];
  if (actor.id === m.pid) return;
  g.mau = null;
  if (m.called) return;
  const p = g.players[idxOf(g, m.pid)];
  if (!p) return;
  const got = drawCards(g, p, PENALTY, rng);
  pushRecap(g, `${p.name} hat „Mau!“ vergessen und zieht zur Strafe ${kartenWort(got.length)}.`);
}

function checkEnd(g, rng) {
  if (g.phase !== 'play') return;
  g.moves += 1;
  if (g.stall >= g.players.length || g.moves > MOVE_CAP) blockedEnd(g, rng);
}

// ---------- Aktionen ----------
function doPlay(g, pid, msg, rng) {
  if (g.turn.forced) return { ok: false, error: g.turn.forced === 'seven' ? 'Du musst zwei Karten ziehen.' : 'Du musst diese Runde aussetzen.' };
  const card = msg.card;
  if (!isCard(card)) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  if (msg.call !== undefined && typeof msg.call !== 'boolean') return { ok: false, error: 'Ungültige Nachricht.' };
  if (msg.wish !== undefined && msg.wish !== null && !(Number.isInteger(msg.wish) && msg.wish >= 0 && msg.wish < 4)) return { ok: false, error: 'Diese Farbe gibt es nicht.' };
  const ai = g.active;
  const p = g.players[ai];
  const hi = p.hand.findIndex((c) => sameCard(c, card));
  if (hi < 0) return { ok: false, error: 'Diese Karte hast du nicht.' };
  if (!playable(g, card)) return { ok: false, error: 'Diese Karte passt jetzt nicht.' };
  const after = p.hand.length - 1;
  const call = msg.call === true || g.opts.auto;
  const wins = after === 0 && call;
  const isJack = card.r === RJ;
  if (isJack && !wins && !(Number.isInteger(msg.wish) && msg.wish >= 0 && msg.wish < 4)) return { ok: false, error: 'Bitte wünsche dir eine Farbe.' };

  settleMau(g, ai, rng);
  const [c] = p.hand.splice(hi, 1);
  g.discard.push(c);
  g.wish = isJack && !wins ? msg.wish : null;
  g.stall = 0;
  let text = `${p.name} legt ${cardName(c)}.`;
  if (isJack && !wins) text = `${p.name} legt ${cardName(c)} und wünscht sich ${SUITS[msg.wish].sym} ${SUITS[msg.wish].name}.`;

  if (after === 0 && call) {
    pushRecap(g, text);
    pushRecap(g, `${p.name} ruft: „Mau Mau!“`);
    g.last = { kind: 'play', pid: p.id, name: p.name, card: c, text };
    endRound(g, ai, false);
    return { ok: true, won: true };
  }
  pushRecap(g, text);
  g.last = { kind: 'play', pid: p.id, name: p.name, card: c, text };
  if (after === 0) {
    const got = drawCards(g, p, PENALTY, rng);
    pushRecap(g, `${p.name} hat „Mau Mau!“ vergessen und zieht zur Strafe ${kartenWort(got.length)}.`);
    if (!p.hand.length) { endRound(g, ai, false); return { ok: true, won: true }; } // Stapel leer: nichts zu ziehen
  } else if (after === 1) {
    g.mau = { pid: p.id, called: call };
    if (call) pushRecap(g, `${p.name} ruft: „Mau!“`);
  }
  if (c.r === RA && g.opts.ace && g.players.length > 2) {
    g.dir = -g.dir;
    pushRecap(g, 'Ass: Die Spielrichtung dreht sich um.');
  }
  advance(g);
  if (c.r === R7) g.turn.forced = 'seven';
  else if (c.r === R8) g.turn.forced = 'eight';
  checkEnd(g, rng);
  return { ok: true };
}

function doDraw(g, pid, rng) {
  const ai = g.active;
  const p = g.players[ai];
  const f = g.turn.forced;
  if (f === 'eight') return { ok: false, error: 'Du musst diese Runde aussetzen.' };
  if (f === 'seven') {
    settleMau(g, ai, rng);
    const got = drawCards(g, p, 2, rng);
    pushRecap(g, `${p.name} muss wegen der Sieben ${kartenWort(got.length)} ziehen und setzt aus.`);
    g.last = { kind: 'seven', pid: p.id, name: p.name, n: got.length };
    if (got.length) g.stall = 0;
    advance(g);
    checkEnd(g, rng);
    return { ok: true, drew: got.length };
  }
  if (g.turn.drew) return { ok: false, error: 'Du hast schon gezogen.' };
  if (hasPlayable(g, p)) return { ok: false, error: 'Du hast eine passende Karte und musst eine Karte spielen.' };
  settleMau(g, ai, rng);
  const got = drawCards(g, p, 1, rng);
  if (!got.length) {
    pushRecap(g, `${p.name} kann keine Karte ziehen und setzt aus.`);
    g.last = { kind: 'skip', pid: p.id, name: p.name, text: g.recap[0] };
    g.stall += 1;
    advance(g);
    checkEnd(g, rng);
    return { ok: true, drew: 0 };
  }
  g.stall = 0;
  const c = got[0];
  if (playable(g, c)) {
    g.turn.drew = true;
    g.turn.drawn = { s: c.s, r: c.r };
    pushRecap(g, `${p.name} zieht eine Karte. Sie passt.`);
    g.last = { kind: 'draw', pid: p.id, name: p.name, fits: true };
    return { ok: true, drew: 1, fits: true };
  }
  pushRecap(g, `${p.name} zieht eine Karte. Sie passt nicht.`);
  g.last = { kind: 'draw', pid: p.id, name: p.name, fits: false };
  advance(g);
  checkEnd(g, rng);
  return { ok: true, drew: 1, fits: false };
}

function doPass(g, pid, rng) {
  if (!g.turn.drew) return { ok: false, error: 'Du kannst nur eine gezogene Karte behalten.' };
  const ai = g.active;
  settleMau(g, ai, rng);
  pushRecap(g, `${g.players[ai].name} behält die gezogene Karte.`);
  g.last = { kind: 'keep', pid: g.players[ai].id, name: g.players[ai].name };
  advance(g);
  checkEnd(g, rng);
  return { ok: true };
}

function doSkip(g, pid, rng) {
  if (g.turn.forced !== 'eight') return { ok: false, error: 'Du musst nicht aussetzen.' };
  const ai = g.active;
  settleMau(g, ai, rng);
  pushRecap(g, `${g.players[ai].name} setzt wegen der Acht eine Runde aus.`);
  g.last = { kind: 'eight', pid: g.players[ai].id, name: g.players[ai].name };
  advance(g);
  checkEnd(g, rng);
  return { ok: true };
}

function doMau(g, pid) {
  if (!g.mau || g.mau.pid !== pid) return { ok: false, error: 'Du musst jetzt nicht „Mau!“ rufen.' };
  if (g.mau.called) return { ok: false, error: 'Du hast schon „Mau!“ gerufen.' };
  g.mau.called = true;
  const p = g.players[idxOf(g, pid)];
  pushRecap(g, `${p.name} ruft: „Mau!“`);
  return { ok: true };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== 'mm') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'next') {
    if (pid !== g.hostId) return { ok: false, error: 'Nur der Gastgeber kann die nächste Runde starten.' };
    return nextRound(g, rng);
  }
  if (g.phase !== 'play') return { ok: false, error: 'Die Runde ist zu Ende.' };
  if (msg.t === 'mau') return doMau(g, pid);
  if (!['play', 'draw', 'pass', 'skip'].includes(msg.t)) return { ok: false, error: 'Unbekannte Nachricht.' };
  if (activePlayer(g).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (msg.t === 'play') return doPlay(g, pid, msg, rng);
  if (msg.t === 'draw') return doDraw(g, pid, rng);
  if (msg.t === 'pass') return doPass(g, pid, rng);
  return doSkip(g, pid, rng);
}

// Spielstand-Tabelle: mehr gewonnene Runden zuerst, dann weniger Punkte.
export function standings(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, wins: p.wins, points: p.points, idx: i, cards: p.hand.length }));
  rows.sort((a, b) => b.wins - a.wins || a.points - b.points || a.idx - b.idx);
  return rows;
}
