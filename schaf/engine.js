// Schafskopp – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// (Der Name ist Absicht und hat nichts mit dem bayerischen Stichspiel Schafkopf zu tun.)
// Ein Spiel ist eine Runde: Wer zuerst keine Karten mehr hat, gewinnt.
// Zufall (Mischen, Startperson) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind { s: Farbe 0..3, r: Zahl 1..21 }. Alle Zustände sind reines JSON.
// Hinweis: Die verdeckten Stapel stehen technisch im Zustand (wie bei den anderen Kartenspielen);
// die Oberfläche zeigt davon nur Rücken und Anzahl.

export const SUITS = [
  { sym: '●', name: 'Rot', id: 'rot' },
  { sym: '■', name: 'Blau', id: 'blau' },
  { sym: '▲', name: 'Gelb', id: 'gelb' },
  { sym: '◆', name: 'Grün', id: 'gruen' },
];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const START = 11; // Die Elf eröffnet jede Reihe
export const MAX_RANK = 21;
export const DECK_SIZE = 84;
export const PENALTY_STACK = 12; // Strafstapel, wird beim Austeilen verdeckt beiseitegelegt
export const PENALTY_CARDS = 2; // so viele Karten gibt es fürs Übersehen
const RECAP_MAX = 6;
const MOVE_CAP = 5000; // Sicherung: spätestens dann endet eine Runde

export const cardName = (c) => `${SUITS[c.s].name} ${c.r}`;
export const sameCard = (a, b) => !!a && !!b && a.s === b.s && a.r === b.r;
const isCard = (c) => !!c && typeof c === 'object' && Number.isInteger(c.s) && Number.isInteger(c.r) && c.s >= 0 && c.s < 4 && c.r >= 1 && c.r <= MAX_RANK;

export function fullDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= MAX_RANK; r++) d.push({ s, r });
  return d;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const activePlayer = (g) => g.players[g.active];
export const topOf = (p) => (p && p.pile.length ? p.pile[p.pile.length - 1] : null);
export const restCount = (g, p) => p.deck.length + p.pile.length + (g.penaltyExtra[p.id] || 0);

// Darf diese Karte jetzt in die Tischmitte? (11 eröffnet; sonst Farbe gleich und ±1 am Ende der Reihe)
export function fits(g, c) {
  if (!g || !isCard(c)) return false;
  const row = g.rows[c.s];
  if (c.r === START) return row === null;
  if (!row) return false;
  return (c.r === row.hi + 1 && row.hi < MAX_RANK) || (c.r === row.lo - 1 && row.lo > 1);
}

// Wessen oberste offene Karte passt gerade? (Personen-IDs, in Sitzreihenfolge ab der aktiven Person)
export function fittingSources(g) {
  const out = [];
  const n = g.players.length;
  for (let k = 0; k < n; k++) {
    const p = g.players[(g.active + k) % n];
    const t = topOf(p);
    if (t && fits(g, t)) out.push(p.id);
  }
  return out;
}
export const anyFit = (g) => g.players.some((p) => { const t = topOf(p); return !!t && fits(g, t); });
export const ownFits = (g) => { const t = topOf(activePlayer(g)); return !!t && fits(g, t); };
const canAct = (g, p) => p.deck.length > 0 || anyFit(g);

function pushRecap(g, line) {
  g.recap.unshift(line); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}
function setLast(g, o) { g.last = { seq: g.moves, ...o }; }

// ---------- Rundenaufbau ----------
function deal(g, rng) {
  const n = g.players.length;
  const deck = shuffle(fullDeck(), rng);
  g.penalty = deck.splice(0, PENALTY_STACK);
  for (const p of g.players) { p.deck = []; p.pile = []; }
  let i = 0;
  while (deck.length) g.players[i++ % n].deck.push(deck.pop());
  g.penaltyExtra = {};
  for (const p of g.players) g.penaltyExtra[p.id] = 0;
  g.rows = [null, null, null, null];
  g.starter = (g.dealer + 1) % n;
  g.active = g.starter;
  g.turn = { acts: 0 };
  g.idle = 0;
  g.moves = 0;
  g.phase = 'play';
  g.result = null;
  g.recap = [];
  g.last = null;
  g.notice = null;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Schafskopp braucht 2 bis 6 Personen.');
  }
    const n = playerList.length;
  const g = {
    game: 'sk',
    gid: Math.floor(rng() * 1e9),
    opts: {},
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), deck: [], pile: [] })),
    dealer: Math.min(n - 1, Math.floor(rng() * n)),
    starter: 0, active: 0,
    rows: [null, null, null, null],
    penalty: [], penaltyExtra: {},
    turn: { acts: 0 }, idle: 0, moves: 0,
    phase: 'play', result: null, recap: [], last: null, notice: null,
  };
  deal(g, rng);
  return g;
}

// ---------- Rundenende ----------
// Plätze nach Restkarten (verdeckt + offen + Strafpunkte): weniger ist besser, Gleichstand teilt den Platz.
function placesOf(g) {
  const rest = {};
  for (const p of g.players) rest[p.id] = restCount(g, p);
  const sorted = [...g.players].sort((a, b) => rest[a.id] - rest[b.id] || idxOf(g, a.id) - idxOf(g, b.id));
  const places = {};
  sorted.forEach((p, i) => { places[p.id] = i > 0 && rest[p.id] === rest[sorted[i - 1].id] ? places[sorted[i - 1].id] : i + 1; });
  return { rest, places, order: sorted.map((p) => p.id) };
}

function endRound(g, finisherIdx, blocked) {
  const { rest, places, order } = placesOf(g);
  const winners = g.players.filter((p) => places[p.id] === 1).map((p) => p.id);
  const fin = finisherIdx >= 0 ? g.players[finisherIdx] : null;
  g.result = { blocked: !!blocked, finisher: fin ? fin.id : null, finisherName: fin ? fin.name : null, rest, places, order, winners };
  g.phase = 'over';
  g.turn = { acts: 0 };
  g.notice = null;
  const names = winners.map((id) => g.players[idxOf(g, id)].name).join(' und ');
  pushRecap(g, blocked ? `Es geht nichts mehr. Die Karten werden gezählt: ${names} ${winners.length > 1 ? 'haben' : 'hat'} am wenigsten.` : `${fin.name} hat keine Karten mehr und gewinnt!`);
  setLast(g, { kind: 'over', pid: fin ? fin.id : '', name: fin ? fin.name : '', text: g.recap[0] });
}

// ---------- Zugwechsel ----------
function penalize(g, p) {
  const got = [];
  for (let i = 0; i < PENALTY_CARDS; i++) {
    if (g.penalty.length) { const c = g.penalty.pop(); p.deck.unshift(c); got.push(c); } // verdeckt UNTEN auf den Stapel
    else g.penaltyExtra[p.id] = (g.penaltyExtra[p.id] || 0) + 1; // Strafstapel leer: Strafpunkt
  }
  const kw = PENALTY_CARDS === 2 ? 'zwei' : String(PENALTY_CARDS);
  pushRecap(g, `🐑 Schafskopp! ${p.name} hat eine Karte übersehen und bekommt ${kw} Strafkarten.`);
  g.last = { ...(g.last || { seq: g.moves, kind: 'penalty', pid: p.id, name: p.name, text: '' }), penalty: { pid: p.id, name: p.name, text: g.recap[0] } };
}

function endTurn(g) {
  const p = activePlayer(g);
  if (anyFit(g)) penalize(g, p);
  g.idle = g.turn.acts === 0 ? g.idle + 1 : 0;
  const n = g.players.length;
  if (g.idle >= 3 * n || g.moves > MOVE_CAP) { endRound(g, -1, true); return; }
  for (let k = 1; k <= n; k++) {
    const i = (g.active + k) % n;
    if (canAct(g, g.players[i])) {
      g.active = i;
      g.turn = { acts: 0 };
      return;
    }
  }
  endRound(g, -1, true); // niemand kann mehr etwas tun
}

// ---------- Aktionen ----------
const soft = (g, pid, text) => { g.notice = { pid, text }; return { ok: false, error: text, soft: true }; };

function doFlip(g, pid) {
  const p = activePlayer(g);
  if (ownFits(g)) return soft(g, pid, 'Deine offene Karte passt auf den Tisch. Lege sie zuerst an.');
  if (!p.deck.length) return soft(g, pid, 'Dein Stapel ist leer.');
  g.notice = null;
  g.moves += 1;
  g.turn.acts += 1;
  g.idle = 0;
  const c = p.deck.pop();
  p.pile.push(c);
  const f = fits(g, c);
  pushRecap(g, `${p.name} deckt ${cardName(c)} auf. ${f ? 'Sie passt.' : 'Sie passt nicht.'}`);
  setLast(g, { kind: 'flip', pid: p.id, name: p.name, card: { s: c.s, r: c.r }, fits: f, text: g.recap[0] });
  if (!f) endTurn(g);
  return { ok: true, card: { s: c.s, r: c.r }, fits: f };
}

function doPlace(g, pid, msg) {
  const from = msg.from === undefined || msg.from === null ? pid : msg.from;
  if (typeof from !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  const fi = idxOf(g, from);
  if (fi < 0) return { ok: false, error: 'Diese Person gibt es nicht.' };
  const src = g.players[fi];
  const c = topOf(src);
  if (!c) return soft(g, pid, 'Dort liegt keine offene Karte.');
  if (!fits(g, c)) return soft(g, pid, 'Die Karte passt nicht.');
  g.notice = null;
  g.moves += 1;
  g.turn.acts += 1;
  g.idle = 0;
  const me = activePlayer(g);
  src.pile.pop();
  const opened = g.rows[c.s] === null;
  if (opened) g.rows[c.s] = { lo: c.r, hi: c.r };
  else if (c.r === g.rows[c.s].hi + 1) g.rows[c.s].hi = c.r;
  else g.rows[c.s].lo = c.r;
  const own = src.id === me.id;
  let text = `${me.name} legt ${cardName(c)}${opened ? ' und eröffnet die Reihe' : ''}${own ? '' : ` von ${src.name}`} in die Mitte.`;
  if (own && !opened) text = `${me.name} legt ${cardName(c)} an.`;
  pushRecap(g, text);
  setLast(g, { kind: 'place', pid: me.id, name: me.name, from: src.id, card: { s: c.s, r: c.r }, text });
  if (!src.deck.length && !src.pile.length) { endRound(g, fi, false); return { ok: true, won: true }; }
  if (!me.deck.length && !anyFit(g)) endTurn(g); // nichts mehr zu tun
  return { ok: true, card: { s: c.s, r: c.r } };
}

function doEnd(g, pid) {
  const p = activePlayer(g);
  if (!anyFit(g) && p.deck.length) return soft(g, pid, 'Decke zuerst eine Karte auf.');
  g.notice = null;
  g.moves += 1;
  const missed = anyFit(g);
  if (!missed) pushRecap(g, `${p.name} beendet den Zug.`);
  setLast(g, { kind: 'end', pid: p.id, name: p.name, text: missed ? `${p.name} beendet den Zug.` : g.recap[0] });
  endTurn(g);
  return { ok: true, missed };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben
// (Ausnahme: freundliche Hinweise „passt nicht“ setzen nur g.notice und liefern ok:false, soft:true).
export function handle(g, pid, msg) {
  if (!g || g.game !== 'sk') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (!['flip', 'place', 'end'].includes(msg.t)) return { ok: false, error: 'Unbekannte Nachricht.' };
  if (g.phase !== 'play') return { ok: false, error: 'Die Runde ist zu Ende.' };
  if (activePlayer(g).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (msg.t === 'flip') return doFlip(g, pid);
  if (msg.t === 'place') return doPlace(g, pid, msg);
  return doEnd(g, pid);
}

// Rangliste: weniger Restkarten zuerst (laufend berechnet); Gleichstand teilt den Platz.
export function ranking(g) {
  const { rest, places } = placesOf(g);
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, rest: rest[p.id], place: places[p.id], idx: i }));
  rows.sort((a, b) => a.place - b.place || a.idx - b.idx);
  return rows;
}
