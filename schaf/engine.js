// Schafskopp – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// (Der Name ist Absicht und hat nichts mit dem Kartenspiel Schafkopf zu tun.)
// Zufall (Mischen, Startperson) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind { s: Farbe 0..3, r: Zahl 1..21 }. Alle Zustände sind reines JSON.
// Hinweis: Die verdeckten Stapel stehen technisch im Zustand (wie bei den anderen Kartenspielen);
// die Oberfläche zeigt davon nur Rücken und Anzahl.
//
// Regeln in Kürze:
//  - Mitte: vier Farbreihen, 11 eröffnet, sonst gleiche Farbe ±1 am Ende der Reihe.
//  - Aufdrücken: Karte derselben Farbe, genau ±1 zur obersten offenen Karte einer ANDEREN Person
//    (nie auf einen leeren offenen Stapel).
//  - Gesetz 1: Wer dran ist, muss zuerst die eigene oberste offene Karte spielen, solange sie in der Mitte
//    oder bei jemandem passt. Erst dann darf aufgedeckt werden.
//  - Gesetz 2: Jede spielbare Karte (offene Oberkarte oder aufgedeckte): erst Mitte, sonst bei jemandem
//    aufdrücken, sonst auf den eigenen offenen Stapel (dann endet der Zug).
//  - Fehler = „Schafskopp“: Die Aktion wird ausgeführt, die Person bekommt von jeder anderen Person eine Karte
//    (unten auf den verdeckten Stapel), und der Zug endet.
//  - Gesetz 3: Wer zuerst alle Karten los ist, gewinnt. Wer am Ende die meisten hat, trägt den Ehrentitel „Schafskopp“.

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
const RECAP_MAX = 6;
const MOVE_CAP = 5000; // Sicherung: spätestens dann endet die Partie

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
export const restCount = (g, p) => p.deck.length + p.pile.length + (g.flipped && g.players[g.active] === p ? 1 : 0);

// ---------- Passt eine Karte? ----------
// In die Mitte: 11 eröffnet; sonst Farbe gleich und ±1 am Ende der Reihe.
export function fits(g, c) {
  if (!g || !isCard(c)) return false;
  const row = g.rows[c.s];
  if (c.r === START) return row === null;
  if (!row) return false;
  return (c.r === row.hi + 1 && row.hi < MAX_RANK) || (c.r === row.lo - 1 && row.lo > 1);
}
// Aufdrücken: auf die oberste offene Karte einer anderen Person (gleiche Farbe, genau ±1).
export function fitsOn(g, c, targetId) {
  if (!isCard(c)) return false;
  const t = g.players.find((p) => p.id === targetId);
  const top = topOf(t);
  return !!top && top.s === c.s && Math.abs(top.r - c.r) === 1;
}
// Alle Ziele, bei denen die Karte (von Person selfId) passt: { center, others: [pid in Sitzreihenfolge ab selfId] }
export function targetsFor(g, c, selfId) {
  const out = { center: fits(g, c), others: [] };
  const si = idxOf(g, selfId);
  const n = g.players.length;
  for (let k = 1; k < n; k++) {
    const p = g.players[(si + k) % n];
    if (fitsOn(g, c, p.id)) out.others.push(p.id);
  }
  return out;
}
export const playableAnywhere = (g, c, selfId) => { const t = targetsFor(g, c, selfId); return t.center || t.others.length > 0; };
// Die „aktuelle Karte“ der aktiven Person: die aufgedeckte, sonst die oberste offene eigene.
export const curCard = (g) => (g.flipped ? g.flipped : topOf(activePlayer(g)));

function pushRecap(g, line) {
  g.recap.unshift(line); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}
function setLast(g, o) { g.last = { seq: g.moves, ...o }; }

// ---------- Rundenaufbau ----------
function deal(g, rng) {
  const n = g.players.length;
  const deck = shuffle(fullDeck(), rng);
  for (const p of g.players) { p.deck = []; p.pile = []; }
  let i = 0;
  while (deck.length) g.players[i++ % n].deck.push(deck.pop());
  g.rows = [null, null, null, null];
  g.starter = (g.dealer + 1) % n;
  g.active = g.starter;
  g.flipped = null;
  g.source = null;
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
    flipped: null, source: null, moves: 0,
    phase: 'play', result: null, recap: [], last: null, notice: null,
  };
  deal(g, rng);
  settle(g);
  return g;
}

// ---------- Spielende ----------
// Plätze nach Restkarten: weniger ist besser, Gleichstand teilt den Platz.
function placesOf(g) {
  const rest = {};
  for (const p of g.players) rest[p.id] = restCount(g, p);
  const sorted = [...g.players].sort((a, b) => rest[a.id] - rest[b.id] || idxOf(g, a.id) - idxOf(g, b.id));
  const places = {};
  sorted.forEach((p, i) => { places[p.id] = i > 0 && rest[p.id] === rest[sorted[i - 1].id] ? places[sorted[i - 1].id] : i + 1; });
  return { rest, places, order: sorted.map((p) => p.id) };
}

function endGame(g, finisherIdx, blocked) {
  const { rest, places, order } = placesOf(g);
  const vals = Object.values(rest);
  const mx = Math.max(...vals);
  const winners = g.players.filter((p) => places[p.id] === 1).map((p) => p.id);
  const schafskopp = mx === Math.min(...vals) ? [] : g.players.filter((p) => rest[p.id] === mx).map((p) => p.id); // Ehrentitel, keine Punkte
  const fin = finisherIdx >= 0 ? g.players[finisherIdx] : null;
  g.result = { blocked: !!blocked, finisher: fin ? fin.id : null, finisherName: fin ? fin.name : null, rest, places, order, winners, schafskopp };
  g.phase = 'over';
  g.flipped = null; g.source = null;
  g.notice = null;
  const names = winners.map((id) => g.players[idxOf(g, id)].name).join(' und ');
  pushRecap(g, blocked ? `Es geht nichts mehr. Die Karten werden gezählt: ${names} ${winners.length > 1 ? 'haben' : 'hat'} am wenigsten.` : `${fin.name} hat keine Karten mehr und gewinnt!`);
  const pen = g.last && g.last.penalty ? { penalty: g.last.penalty } : {};
  setLast(g, { kind: 'over', pid: fin ? fin.id : '', name: fin ? fin.name : '', text: g.recap[0], ...pen });
}

// Hat jemand keine Karten mehr? (aktive Person zuerst)
function checkWin(g) {
  const n = g.players.length;
  for (let k = 0; k < n; k++) {
    const i = (g.active + k) % n;
    if (restCount(g, g.players[i]) === 0) { endGame(g, i, false); return true; }
  }
  return false;
}

// ---------- Zugablauf ----------
const canAct = (g, p) => p.deck.length > 0 || (!!topOf(p) && playableAnywhere(g, topOf(p), p.id));

// Bestimmt, was die aktive Person jetzt tun muss (Gesetz 1) oder ob ihr Zug schon zu Ende ist.
function settle(g) {
  const p = activePlayer(g);
  if (g.flipped) { g.source = 'flipped'; return; }
  const t = topOf(p);
  if (t && playableAnywhere(g, t, p.id)) { g.source = 'open'; return; }
  g.source = null;
  if (!p.deck.length) endTurn(g);
}

function endTurn(g) {
  g.flipped = null;
  g.source = null;
  const n = g.players.length;
  if (g.moves > MOVE_CAP) { endGame(g, -1, true); return; }
  for (let k = 1; k <= n; k++) {
    const i = (g.active + k) % n;
    if (canAct(g, g.players[i])) { g.active = i; settle(g); return; }
  }
  endGame(g, -1, true); // niemand kann mehr etwas tun
}

const REASON = {
  a: 'hat aufgedeckt, obwohl die offene Karte noch passte',
  b: 'hat eine Karte bei sich abgelegt, obwohl sie woanders passte',
  c: 'hat eine Karte aufgedrückt, obwohl sie in die Mitte passte',
};
export const reasonText = (reason) => REASON[reason] || '';

// Fehler: von jeder anderen Person eine Karte (oberste verdeckte, sonst oberste offene), verdeckt unten auf den Stapel.
function penalize(g, reason) {
  const p = activePlayer(g);
  const n = g.players.length;
  let got = 0;
  for (let k = 1; k < n; k++) {
    const q = g.players[(g.active + k) % n];
    const c = q.deck.length ? q.deck.pop() : q.pile.length ? q.pile.pop() : null;
    if (c) { p.deck.unshift(c); got += 1; }
  }
  pushRecap(g, `🐑 Schafskopp! ${p.name} ist die Schlafmütze: gepennt – und bekommt von jedem eine Karte.`);
  g.last = { ...(g.last || { seq: g.moves, kind: 'penalty', pid: p.id, name: p.name, text: '' }), penalty: { pid: p.id, name: p.name, reason, got, text: g.recap[0] } };
  // Wer durch die Abgabe keine Karten mehr hat, gewinnt.
  const n2 = g.players.length;
  for (let k = 1; k < n2; k++) {
    const i = (g.active + k) % n2;
    if (restCount(g, g.players[i]) === 0) { endGame(g, i, false); return; }
  }
  endTurn(g);
}

// ---------- Aktionen ----------
const soft = (g, pid, text) => { g.notice = { pid, text }; return { ok: false, error: text, soft: true }; };

function doFlip(g, pid) {
  const p = activePlayer(g);
  if (g.flipped) return soft(g, pid, 'Platziere zuerst die aufgedeckte Karte.');
  if (!p.deck.length) return soft(g, pid, 'Dein Stapel ist leer.');
  const violation = g.source === 'open'; // Gesetz 1 verletzt
  g.notice = null;
  g.moves += 1;
  const c = p.deck.pop();
  pushRecap(g, `${p.name} deckt ${cardName(c)} auf.`);
  if (violation) {
    p.pile.push(c);
    setLast(g, { kind: 'flip', pid: p.id, name: p.name, card: { s: c.s, r: c.r }, text: g.recap[0] });
    penalize(g, 'a');
    return { ok: true, card: { s: c.s, r: c.r }, schafskopp: 'a' };
  }
  g.flipped = c;
  g.source = 'flipped';
  setLast(g, { kind: 'flip', pid: p.id, name: p.name, card: { s: c.s, r: c.r }, text: g.recap[0] });
  return { ok: true, card: { s: c.s, r: c.r } };
}

function doPlace(g, pid, msg) {
  const to = msg.to;
  if (to !== 'center' && to !== 'other' && to !== 'own') return { ok: false, error: 'Ungültige Nachricht.' };
  const p = activePlayer(g);
  const fromFlipped = !!g.flipped;
  const card = fromFlipped ? g.flipped : topOf(p);
  if (!card) return soft(g, pid, 'Du hast gerade keine Karte zum Ablegen. Decke zuerst auf.');
  const take = () => { if (fromFlipped) g.flipped = null; else p.pile.pop(); };

  if (to === 'own') {
    if (!fromFlipped) return soft(g, pid, 'Diese Karte liegt schon bei dir.');
    const mistake = playableAnywhere(g, card, p.id);
    g.notice = null; g.moves += 1;
    g.flipped = null;
    p.pile.push(card);
    pushRecap(g, `${p.name} legt ${cardName(card)} bei sich ab.`);
    setLast(g, { kind: 'place', to: 'own', pid: p.id, name: p.name, card: { s: card.s, r: card.r }, text: g.recap[0] });
    if (mistake) penalize(g, 'b'); else endTurn(g);
    return { ok: true, schafskopp: mistake ? 'b' : null };
  }

  if (to === 'center') {
    if (!fits(g, card)) return soft(g, pid, 'Die Karte passt dort nicht.');
    g.notice = null; g.moves += 1;
    take();
    const opened = g.rows[card.s] === null;
    if (opened) g.rows[card.s] = { lo: card.r, hi: card.r };
    else if (card.r === g.rows[card.s].hi + 1) g.rows[card.s].hi = card.r;
    else g.rows[card.s].lo = card.r;
    pushRecap(g, `${p.name} legt ${cardName(card)} in die Mitte${opened ? ' und eröffnet die Reihe' : ''}.`);
    setLast(g, { kind: 'place', to: 'center', pid: p.id, name: p.name, card: { s: card.s, r: card.r }, text: g.recap[0] });
    if (!checkWin(g)) settle(g);
    return { ok: true };
  }

  // to === 'other'
  const tid = msg.pid;
  if (typeof tid !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  const ti = idxOf(g, tid);
  if (ti < 0) return { ok: false, error: 'Diese Person gibt es nicht.' };
  const q = g.players[ti];
  if (q === p) return soft(g, pid, 'Bei dir selbst kannst du nur ablegen, nicht aufdrücken.');
  if (!q.pile.length) return soft(g, pid, 'Auf einen leeren offenen Stapel darf nichts gelegt werden.');
  if (!fitsOn(g, card, q.id)) return soft(g, pid, 'Die Karte passt dort nicht.');
  const mistake = fits(g, card);
  g.notice = null; g.moves += 1;
  take();
  q.pile.push(card);
  pushRecap(g, `${p.name} drückt ${cardName(card)} bei ${q.name} auf.`);
  setLast(g, { kind: 'place', to: 'other', target: q.id, pid: p.id, name: p.name, card: { s: card.s, r: card.r }, text: g.recap[0] });
  if (mistake) { penalize(g, 'c'); return { ok: true, schafskopp: 'c' }; }
  if (!checkWin(g)) settle(g);
  return { ok: true };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben
// (Ausnahme: freundliche Hinweise „passt dort nicht“ setzen nur g.notice und liefern ok:false, soft:true).
export function handle(g, pid, msg) {
  if (!g || g.game !== 'sk') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (!['flip', 'place'].includes(msg.t)) return { ok: false, error: 'Unbekannte Nachricht.' };
  if (g.phase !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (activePlayer(g).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (msg.t === 'flip') return doFlip(g, pid);
  return doPlace(g, pid, msg);
}

// Rangliste: weniger Restkarten zuerst (laufend berechnet); Gleichstand teilt den Platz.
export function ranking(g) {
  const { rest, places } = placesOf(g);
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, rest: rest[p.id], place: places[p.id], idx: i }));
  rows.sort((a, b) => a.place - b.place || a.idx - b.idx);
  return rows;
}

// Für Tests und Wiederaufnahme: bestimmt neu, was die aktive Person tun muss.
export const refresh = settle;
