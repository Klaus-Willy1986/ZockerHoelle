// Stapelrennen – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt nur über den Parameter `rng` herein und wird nur im Gastgeber benutzt.
//
// Karten sind Zahlen: 1 bis 12 sind Zahlenkarten, 0 ist ein Joker.
// Ein Aufbaustapel ist ein Array von Karten; sein Wert ist die Kartenzahl (jede Karte zählt eins mehr).
// Bei allen Stapeln (Spielerstapel, Hilfsstapel, Kartenstock) liegt die oberste Karte am Ende des Arrays.

export const JOKER = 0;
export const MAX_NUM = 12; // höchste Zahl: Ein Aufbaustapel ist bei 12 fertig
export const SETS = 12; // zwölf Sätze mit den Zahlen 1 bis 12
export const JOKERS = 18;
export const DECK_SIZE = SETS * MAX_NUM + JOKERS; // 162
export const HAND_SIZE = 5;
export const AUX_COUNT = 4; // Hilfsstapel je Person
export const BUILD_COUNT = 4; // Aufbaustapel in der Tischmitte
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const TARGET_POINTS = 500;
export const WIN_BONUS = 25;
export const CARD_POINTS = 5;
const RECAP_MAX = 6;

export const pileSizeFor = (n) => (n <= 4 ? 30 : 20);

export function makeDeck() {
  const d = [];
  for (let s = 0; s < SETS; s++) for (let v = 1; v <= MAX_NUM; v++) d.push(v);
  for (let j = 0; j < JOKERS; j++) d.push(JOKER);
  return d;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const cardName = (c) => (c === JOKER ? 'Joker' : String(c));
export const topOf = (stack) => (stack.length ? stack[stack.length - 1] : null);
export const activePlayer = (state) => state.players[state.active];

// Wert eines Aufbaustapels = Kartenzahl; gebraucht wird die nächste Zahl.
export const buildValue = (build) => build.length;
export const buildNeeds = (build) => build.length + 1;
export const canPlayOn = (card, build) => build.length < MAX_NUM && (card === JOKER || card === build.length + 1);
export const targetsFor = (state, card) => {
  const res = [];
  state.build.forEach((b, i) => { if (canPlayOn(card, b)) res.push(i); });
  return res;
};

// Wert einer Karte in einem Aufbaustapel an Position idx (bei Joker die Zahl, die er vertritt).
export const valueAt = (idx) => idx + 1;

const sortHand = (hand) => hand.sort((a, b) => (a === JOKER ? 99 : a) - (b === JOKER ? 99 : b));

function pushRecap(state, line) {
  state.recap.unshift(line);
  if (state.recap.length > RECAP_MAX) state.recap.length = RECAP_MAX;
}

function drawUp(state, p) {
  let n = 0;
  while (p.hand.length < HAND_SIZE && state.draw.length) { p.hand.push(state.draw.pop()); n++; }
  sortHand(p.hand);
  return n;
}

// ---------- Spielstand ----------
export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Stapelrennen geht mit 2 bis 6 Personen.');
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  const full = pileSizeFor(playerList.length);
  const pileSize = Number.isInteger(o.pile) ? Math.max(3, Math.min(full, o.pile)) : full;
  const state = {
    game: 'sr',
    gid: Math.floor(rng() * 1e9),
    mode: 'play', // 'play' | 'roundover' (nur bei mehreren Runden) | 'over'
    opts: { points: !!o.points },
    pileSize,
    round: 1,
    starter: 0,
    seq: 0,
    players: playerList.map((p) => ({ id: p.id, name: p.name, pile: [], aux: [[], [], [], []], hand: [], score: 0 })),
    build: [[], [], [], []],
    draw: [],
    active: 0,
    played: 0, // Karten, die in diesem Zug schon gelegt wurden
    recap: [],
    last: null,
    roundWinner: null,
    winner: null,
    gain: 0,
    endReason: null,
  };
  deal(state, rng);
  return state;
}

function deal(state, rng) {
  const deck = shuffle(makeDeck(), rng);
  for (const p of state.players) {
    p.pile = deck.splice(0, state.pileSize);
    p.aux = [[], [], [], []];
    p.hand = [];
  }
  state.draw = deck;
  state.build = [[], [], [], []];
  state.active = state.starter;
  state.roundWinner = null;
  state.gain = 0;
  state.endReason = null;
  state.last = null;
  state.recap = [];
  state.mode = 'play';
  beginTurn(state);
}

// Beginn eines Zugs: auf 5 Handkarten auffüllen. Wer gar keine Karte bekommen kann, wird übersprungen.
function beginTurn(state) {
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const p = activePlayer(state);
    drawUp(state, p);
    if (p.hand.length > 0) { state.played = 0; return; }
    state.active = (state.active + 1) % n;
  }
  // Niemand kann noch eine Handkarte bekommen: Patt, wer weniger Spielerstapel hat, gewinnt.
  let best = 0;
  state.players.forEach((q, i) => { if (q.pile.length < state.players[best].pile.length) best = i; });
  state.active = best;
  state.played = 0;
  endRound(state, best, 'Es sind keine Karten mehr zum Ziehen da. Es gewinnt, wer die wenigsten Karten im Spielerstapel hat.');
}

function nextTurn(state) {
  state.active = (state.active + 1) % state.players.length;
  state.played = 0;
  beginTurn(state);
}

function endRound(state, wi, reason) {
  const w = state.players[wi];
  state.roundWinner = wi;
  state.played = 0;
  let gain = 0;
  if (state.opts.points) {
    gain = WIN_BONUS + CARD_POINTS * state.players.reduce((s, q, i) => s + (i === wi ? 0 : q.pile.length), 0);
    w.score += gain;
  }
  state.gain = gain;
  state.endReason = reason || `${w.name} hat den Spielerstapel abgebaut.`;
  if (!state.opts.points) {
    state.mode = 'over';
    state.winner = wi;
    pushRecap(state, `${w.name} hat gewonnen!`);
    return;
  }
  pushRecap(state, `${w.name} gewinnt die Runde und bekommt ${gain} Punkte.`);
  const top = Math.max(...state.players.map((q) => q.score));
  if (top >= TARGET_POINTS) {
    let win = state.players.findIndex((q) => q.score === top);
    if (state.players[wi].score === top) win = wi;
    state.mode = 'over';
    state.winner = win;
  } else {
    state.mode = 'roundover';
  }
}

// ---------- Hilfen für Oberfläche und Computer ----------
// Alle Karten, die gerade gelegt werden dürfen: { from, i, card, targets }
export function sourcesOf(state, pi) {
  const p = state.players[pi];
  const res = [];
  if (!p || state.mode !== 'play') return res;
  p.hand.forEach((card, i) => {
    const targets = targetsFor(state, card);
    if (targets.length) res.push({ from: 'hand', i, card, targets });
  });
  if (p.pile.length) {
    const card = topOf(p.pile);
    const targets = targetsFor(state, card);
    if (targets.length) res.push({ from: 'pile', i: 0, card, targets });
  }
  p.aux.forEach((s, i) => {
    if (!s.length) return;
    const card = topOf(s);
    const targets = targetsFor(state, card);
    if (targets.length) res.push({ from: 'aux', i, card, targets });
  });
  return res;
}

export function legalPlays(state, pi) {
  const res = [];
  for (const s of sourcesOf(state, pi)) for (const to of s.targets) res.push({ t: 'play', from: s.from, i: s.i, to, card: s.card });
  return res;
}

export const cardsLeft = (p) => p.pile.length;

// ---------- Aktionen ----------
const isIdx = (v, max) => Number.isInteger(v) && v >= 0 && v < max;

export function play(state, pid, msg, rng = Math.random) {
  if (!state || state.mode !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const p = activePlayer(state);
  if (!p || p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (!isIdx(msg.to, BUILD_COUNT)) return { ok: false, error: 'Diesen Aufbaustapel gibt es nicht.' };
  let card;
  if (msg.from === 'hand') {
    if (!isIdx(msg.i, p.hand.length)) return { ok: false, error: 'Diese Handkarte gibt es nicht.' };
    card = p.hand[msg.i];
  } else if (msg.from === 'pile') {
    if (!p.pile.length) return { ok: false, error: 'Dein Spielerstapel ist leer.' };
    card = topOf(p.pile);
  } else if (msg.from === 'aux') {
    if (!isIdx(msg.i, AUX_COUNT)) return { ok: false, error: 'Diesen Hilfsstapel gibt es nicht.' };
    if (!p.aux[msg.i].length) return { ok: false, error: 'Dieser Hilfsstapel ist leer.' };
    card = topOf(p.aux[msg.i]);
  } else {
    return { ok: false, error: 'Diese Karte kann nicht gelegt werden.' };
  }
  const b = state.build[msg.to];
  if (!canPlayOn(card, b)) return { ok: false, error: `Diese Karte passt nicht. Auf diesem Aufbaustapel wird die ${buildNeeds(b)} gebraucht.` };

  // ab hier ist alles gültig
  if (msg.from === 'hand') p.hand.splice(msg.i, 1);
  else if (msg.from === 'pile') p.pile.pop();
  else p.aux[msg.i].pop();
  b.push(card);
  const value = b.length;
  const src = msg.from === 'pile' ? ' vom Spielerstapel' : msg.from === 'aux' ? ' vom Hilfsstapel' : '';
  const what = card === JOKER ? `einen Joker (zählt als ${value})` : `die ${card}`;
  pushRecap(state, `${p.name} legt ${what}${src} auf Aufbaustapel ${msg.to + 1}.`);
  state.last = { kind: 'play', pid: p.id, name: p.name, b: msg.to, card, value, from: msg.from, refill: false, removed: false };
  state.played += 1;
  state.seq += 1;
  const res = { ok: true, card, value };

  if (b.length === MAX_NUM) {
    // fertiger Aufbaustapel: entfernen, mischen, unter den Kartenstock legen
    const done = shuffle(b.slice(), rng);
    state.build[msg.to] = [];
    state.draw = done.concat(state.draw);
    state.last.removed = true;
    pushRecap(state, `Aufbaustapel ${msg.to + 1} ist bis ${MAX_NUM} fertig. Er wird gemischt und unter den Kartenstock gelegt.`);
    res.completed = true;
  }
  if (msg.from === 'pile' && p.pile.length === 0) {
    endRound(state, state.active);
    res.won = true;
    return res;
  }
  if (p.hand.length === 0) {
    const got = drawUp(state, p);
    if (got > 0) {
      state.last.refill = true;
      pushRecap(state, `${p.name} hat alle Handkarten gespielt und zieht ${got} neue Karten.`);
      res.refilled = got;
    } else {
      // nichts mehr zum Ziehen und nichts zum Abwerfen: der Zug endet von selbst
      pushRecap(state, `${p.name} hat keine Handkarte mehr. Der Zug ist zu Ende.`);
      nextTurn(state);
      res.auto = true;
    }
  }
  return res;
}

export function discard(state, pid, msg) {
  if (!state || state.mode !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const p = activePlayer(state);
  if (!p || p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (!isIdx(msg.i, p.hand.length)) return { ok: false, error: 'Diese Handkarte gibt es nicht.' };
  if (!isIdx(msg.to, AUX_COUNT)) return { ok: false, error: 'Diesen Hilfsstapel gibt es nicht.' };
  const card = p.hand.splice(msg.i, 1)[0];
  p.aux[msg.to].push(card);
  pushRecap(state, `${p.name} wirft ${card === JOKER ? 'einen Joker' : `die ${card}`} ab. Der Zug ist zu Ende.`);
  state.last = { kind: 'discard', pid: p.id, name: p.name, card, aux: msg.to };
  state.seq += 1;
  nextTurn(state);
  return { ok: true, card };
}

// Nächste Runde einer Serie (nur nach einer Runde mit Punkten, wenn noch niemand 500 hat).
export function nextRound(state, pid, rng = Math.random) {
  if (!state || state.mode !== 'roundover') return { ok: false, error: 'Es gibt gerade keine neue Runde zu starten.' };
  if (!state.players.some((p) => p.id === pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  state.round += 1;
  state.starter = (state.starter + 1) % state.players.length;
  state.seq += 1;
  deal(state, rng);
  return { ok: true };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(state, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (msg.t === 'play') return play(state, pid, msg, rng);
  if (msg.t === 'discard') return discard(state, pid, msg);
  if (msg.t === 'next') return nextRound(state, pid, rng);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

// Rangliste: bei Punkten nach Punkten, sonst Gewinner zuerst, dann nach Restkarten im Spielerstapel.
export function ranking(state) {
  const rows = state.players.map((p, i) => ({ id: p.id, name: p.name, idx: i, score: p.score, left: p.pile.length }));
  const pts = state.opts.points;
  rows.sort((a, b) => (state.winner === a.idx ? -1 : state.winner === b.idx ? 1 : 0)
    || (pts ? b.score - a.score : 0) || a.left - b.left || a.idx - b.idx);
  rows.forEach((r, k) => {
    const prev = rows[k - 1];
    const same = prev && (pts ? prev.score === r.score && state.winner !== r.idx && state.winner !== prev.idx : prev.left === r.left && state.winner !== prev.idx);
    r.place = same ? prev.place : k + 1;
  });
  return rows;
}

// Gesamtzahl aller Karten im Spiel (zur Prüfung: bleibt immer gleich)
export function totalCards(state) {
  return state.draw.length + state.build.reduce((s, b) => s + b.length, 0)
    + state.players.reduce((s, p) => s + p.pile.length + p.hand.length + p.aux.reduce((a, x) => a + x.length, 0), 0);
}
