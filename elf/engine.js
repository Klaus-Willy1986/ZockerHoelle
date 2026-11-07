// Elf voran – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind { s: Farbe 0..3, r: Zahl 1..21 }. Alle Zustände sind reines JSON.
// Die Reihen: rows[s] ist null (Farbe noch nicht eröffnet) oder { lo, hi } = niedrigste und höchste gelegte Zahl.

export const SUITS = [
  { sym: '●', name: 'Rot' },
  { sym: '■', name: 'Blau' },
  { sym: '▲', name: 'Gelb' },
  { sym: '◆', name: 'Grün' },
];
export const START = 11; // Die Elf eröffnet eine Reihe
export const MIN_RANK = 1;
export const MAX_RANK = 21;
export const TOTAL_CARDS = 84;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_LIMIT = 30;
export const SHORT_LIMIT = 15;
const RECAP_MAX = 6;

export const cardName = (c) => `${SUITS[c.s].name} ${c.r}`;
export const sameCard = (a, b) => !!a && !!b && a.s === b.s && a.r === b.r;
export const isCard = (c) => !!c && typeof c === 'object' && Number.isInteger(c.s) && Number.isInteger(c.r) && c.s >= 0 && c.s < 4 && c.r >= MIN_RANK && c.r <= MAX_RANK;
export const sortHand = (hand) => hand.sort((a, b) => a.s - b.s || a.r - b.r);

export function fullDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = MIN_RANK; r <= MAX_RANK; r++) d.push({ s, r });
  return d;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const nextPlayerIndex = (g) => (g.active + 1) % g.players.length;

function pushRecap(g, line) {
  g.recap.unshift(line); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

// Darf diese Karte jetzt gelegt werden?
// Eine Elf, deren Farbe noch nicht liegt (eröffnet eine Reihe) – oder die Zahl direkt über/unter der Reihe der Farbe.
export function playable(g, c) {
  if (!g || !Array.isArray(g.rows) || !isCard(c)) return false;
  const row = g.rows[c.s];
  if (!row) return c.r === START;
  return (c.r === row.hi + 1 && c.r <= MAX_RANK) || (c.r === row.lo - 1 && c.r >= MIN_RANK);
}

export function legalCards(g, pid) {
  const p = g.players[idxOf(g, pid)];
  if (!p) return [];
  return p.hand.filter((c) => playable(g, c)).map((c) => ({ s: c.s, r: c.r }));
}
export const hasPlayable = (g, p) => p.hand.some((c) => playable(g, c));

// ---------- Rundenaufbau ----------
function deal(g, rng) {
  const n = g.players.length;
  const deck = shuffle(fullDeck(), rng);
  for (const p of g.players) { p.hand = []; p.lacks = []; }
  deck.forEach((c, i) => g.players[i % n].hand.push(c)); // reihum, Reste gehen an die ersten Personen
  for (const p of g.players) sortHand(p.hand);
  g.rows = [null, null, null, null];
  // Es beginnt die erste Person (in Reihenfolge) mit einer Elf
  let st = g.players.findIndex((p) => p.hand.some((c) => c.r === START));
  if (st < 0) st = 0;
  g.starter = st;
  g.active = st;
  g.moves = 0;
  g.phase = 'play';
  g.result = null;
  g.recap = [];
  g.last = null;
  pushRecap(g, `${g.players[st].name} hat eine Elf und beginnt.`);
}

function normLimit(o) {
  if (Number.isInteger(o.limit) && o.limit >= 1 && o.limit <= 999) return o.limit;
  return o.short ? SHORT_LIMIT : DEFAULT_LIMIT;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Elf voran braucht 2 bis 6 Personen.');
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = {
    game: 'ev',
    gid: Math.floor(rng() * 1e9),
    opts: { hints: !!o.hints, limit: normLimit(o) },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], lacks: [], points: 0 })),
    round: 1,
    starter: 0,
    rows: [null, null, null, null],
    active: 0, moves: 0,
    phase: 'play', result: null, recap: [], last: null,
  };
  deal(g, rng);
  return g;
}

// Nächste Runde: neu geben, der Spielstand bleibt. Nur wenn die Runde aus ist und das Spiel noch läuft.
export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  if (g.result && g.result.gameOver) return { ok: false, error: 'Das Spiel ist zu Ende.' };
  g.round += 1;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

// Rangliste: wenigste Strafpunkte zuerst, Gleichstand teilt den Rang.
export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, points: p.points, idx: i, cards: p.hand.length }));
  rows.sort((a, b) => a.points - b.points || a.idx - b.idx);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1; });
  return rows;
}

function endRound(g, winnerIdx) {
  const w = g.players[winnerIdx];
  const add = {};
  for (const p of g.players) add[p.id] = p === w ? 0 : p.hand.length;
  for (const p of g.players) p.points += add[p.id];
  const gameOver = g.players.some((p) => p.points >= g.opts.limit);
  g.phase = 'over';
  g.result = { winner: w.id, winnerName: w.name, add, gameOver, champions: [] };
  if (gameOver) {
    const best = Math.min(...g.players.map((p) => p.points));
    g.result.champions = g.players.filter((p) => p.points === best).map((p) => p.id);
  }
  pushRecap(g, `${w.name} hat keine Karten mehr und gewinnt die Runde!`);
  g.last = { kind: 'over', pid: w.id, name: w.name, text: g.recap[0] };
}

// ---------- Aktionen ----------
function doPlay(g, pid, msg) {
  const card = msg.card;
  if (!isCard(card)) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  const p = g.players[g.active];
  const hi = p.hand.findIndex((c) => sameCard(c, card));
  if (hi < 0) return { ok: false, error: 'Diese Karte hast du nicht.' };
  if (!playable(g, card)) return { ok: false, error: 'Diese Karte passt jetzt nicht.' };
  const [c] = p.hand.splice(hi, 1);
  const row = g.rows[c.s];
  let text;
  if (!row) {
    g.rows[c.s] = { lo: c.r, hi: c.r };
    text = g.moves === 0 && g.rows.filter(Boolean).length === 1
      ? `${p.name} legt ${cardName(c)} und beginnt die Runde.`
      : `${p.name} legt ${cardName(c)} und eröffnet eine neue Reihe.`;
  } else {
    if (c.r === row.hi + 1) row.hi = c.r; else row.lo = c.r;
    text = `${p.name} legt ${cardName(c)}.`;
  }
  g.moves += 1;
  pushRecap(g, text);
  g.last = { kind: 'play', pid: p.id, name: p.name, card: { s: c.s, r: c.r }, text };
  if (!p.hand.length) { endRound(g, g.active); return { ok: true, won: true }; }
  g.active = nextPlayerIndex(g);
  return { ok: true };
}

// Öffentliche Folgerung aus einem Passen: Diese Person hatte keine der Karten, die gerade anschließen konnten.
// Gemerkt als Kartennummern s*22+r in players[i].lacks (jeder am Tisch hat das gesehen).
function noteLacks(g, p) {
  if (!Array.isArray(p.lacks)) p.lacks = [];
  for (let s = 0; s < 4; s++) {
    const w = g.rows[s];
    const cand = w ? [w.hi + 1, w.lo - 1] : [START];
    for (const r of cand) {
      if (r < MIN_RANK || r > MAX_RANK) continue;
      const id = s * 22 + r;
      if (!p.lacks.includes(id)) p.lacks.push(id);
    }
  }
}

function doPass(g) {
  const p = g.players[g.active];
  if (hasPlayable(g, p)) return { ok: false, error: 'Du hast eine Karte, die passt. Du musst eine Karte legen.' };
  noteLacks(g, p);
  p.points += 1;
  g.moves += 1;
  const text = `${p.name} muss passen und bekommt 1 Strafpunkt.`;
  pushRecap(g, text);
  g.last = { kind: 'pass', pid: p.id, name: p.name, text };
  g.active = nextPlayerIndex(g);
  return { ok: true };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== 'ev') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'next') {
    if (pid !== g.hostId) return { ok: false, error: 'Nur der Gastgeber kann die nächste Runde starten.' };
    return nextRound(g, rng);
  }
  if (msg.t !== 'play' && msg.t !== 'pass') return { ok: false, error: 'Unbekannte Nachricht.' };
  if (g.phase !== 'play') return { ok: false, error: 'Die Runde ist zu Ende.' };
  if (activePlayer(g).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  return msg.t === 'play' ? doPlay(g, pid, msg) : doPass(g);
}

