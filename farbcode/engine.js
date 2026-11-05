// Farbcode knacken – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
//
// Ablauf: Eine Person (Codegeberin) legt einen geheimen Code aus 4 Stiften in 6 Farben fest (Farben dürfen
// sich wiederholen), die andere (Rateperson) hat 10 Versuche. Auswertung je Versuch:
//   b = Stifte mit richtiger Farbe am richtigen Platz („richtig“)
//   w = Stifte mit richtiger Farbe an falscher Stelle („Farbe stimmt“); jede Codestelle zählt nur einmal.
// Der Spielstand besteht nur aus Zahlen, Texten und Listen (JSON-sicher).

export const COLORS = 6;
export const CODE_LEN = 4;
export const MAX_TRIES = 10;
export const NO_SOLVE = MAX_TRIES + 1; // Wertung, wenn der Code nicht geknackt wurde
export const ROUNDS_DUO = 2;

export const COLOR_INFO = [
  { id: 0, name: 'Rot', letter: 'R' },
  { id: 1, name: 'Orange', letter: 'O' },
  { id: 2, name: 'Gelb', letter: 'Y' },
  { id: 3, name: 'Grün', letter: 'G' },
  { id: 4, name: 'Blau', letter: 'B' },
  { id: 5, name: 'Violett', letter: 'V' },
];

export const isBotId = (id) => String(id).startsWith('bot');

// Gültiger Code bzw. Versuch: genau 4 ganze Zahlen von 0 bis 5.
export const isValidCode = (c) => Array.isArray(c) && c.length === CODE_LEN
  && c.every((v) => Number.isInteger(v) && v >= 0 && v < COLORS);

// Auswertung mit Duplikaten: schwarz = gleiche Farbe am gleichen Platz, weiß = je Farbe
// min(Anzahl im Code, Anzahl im Versuch) minus schwarze. Jede Stelle wird nur einmal gezählt.
export function evaluate(code, guess) {
  const cc = Array(COLORS).fill(0);
  const gc = Array(COLORS).fill(0);
  let b = 0;
  for (let i = 0; i < CODE_LEN; i++) {
    if (code[i] === guess[i]) b++;
    else { cc[code[i]]++; gc[guess[i]]++; }
  }
  let w = 0;
  for (let c = 0; c < COLORS; c++) w += Math.min(cc[c], gc[c]);
  return { b, w };
}

export const randomCode = (rng = Math.random) => Array.from({ length: CODE_LEN }, () => Math.min(COLORS - 1, Math.floor(rng() * COLORS)));

// Alle 1296 möglichen Codes (Reihenfolge fest).
export const allCodes = () => {
  const list = [];
  for (let n = 0; n < COLORS ** CODE_LEN; n++) {
    const c = [];
    let x = n;
    for (let i = 0; i < CODE_LEN; i++) { c.unshift(x % COLORS); x = Math.floor(x / COLORS); }
    list.push(c);
  }
  return list;
};

// Schreibweise für Texte: „2 richtig, 1 Farbe stimmt“
export function feedbackText(b, w) {
  if (b === CODE_LEN) return 'alles richtig';
  if (!b && !w) return 'nichts stimmt';
  const parts = [];
  if (b) parts.push(`${b} richtig`);
  if (w) parts.push(w === 1 ? '1 Farbe stimmt' : `${w} Farben stimmen`);
  return parts.join(', ');
}

// ---------- Spielstand ----------
// kind: 'solo' (Computer legt zufällig fest, 1 Person rät), 'bot' (Mensch legt fest, Computer rät),
//       'duo' (2 Personen, 2 Runden mit Rollentausch)
// mode: 'code' (Code wird festgelegt) | 'guess' (es wird geraten) | 'between' (Runde 1 von 2 vorbei) | 'over'
export function createGame(playerList, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 1 || playerList.length > 2) throw new Error('1 oder 2 Personen');
  const players = playerList.map((p) => ({ id: String(p.id), name: String(p.name) }));
  const bot = players.findIndex((p) => isBotId(p.id));
  let kind = 'duo';
  let setter = 0;
  let guesser = 1;
  if (players.length === 1) { kind = 'solo'; setter = -1; guesser = 0; }
  else if (bot >= 0) { kind = 'bot'; guesser = bot; setter = 1 - bot; }
  const g = {
    game: 'fc',
    kind,
    mode: kind === 'solo' ? 'guess' : 'code',
    players,
    round: 1,
    rounds: kind === 'duo' ? ROUNDS_DUO : 1,
    setter,
    guesser,
    code: kind === 'solo' ? randomCode(rng) : null,
    guesses: [], // { g: [4 Zahlen], b, w }
    solved: null, // null = Runde läuft, sonst true/false
    results: [], // abgeschlossene Runden: { setter, guesser, tries, solved }
  };
  return g;
}

export const setterPlayer = (s) => (s.setter >= 0 ? s.players[s.setter] : null);
export const guesserPlayer = (s) => s.players[s.guesser];
export const triesLeft = (s) => MAX_TRIES - s.guesses.length;
export const roundOver = (s) => s.solved !== null;
// Der Code darf von allen gesehen werden, sobald die Runde zu Ende ist.
export const codeRevealed = (s) => s.solved !== null;

export function setCode(state, pid, code) {
  if (!state || state.mode === 'over' || state.mode === 'between') return { ok: false, error: 'Das Spiel ist gerade nicht in dieser Phase.' };
  if (state.mode !== 'code') return { ok: false, error: 'Der Code steht schon fest.' };
  const sp = setterPlayer(state);
  if (!sp || sp.id !== pid) return { ok: false, error: 'Du legst den Code nicht fest.' };
  if (!isValidCode(code)) return { ok: false, error: 'Bitte wähle genau 4 Farben.' };
  state.code = code.slice();
  state.mode = 'guess';
  return { ok: true };
}

// n (optional): Nummer des Versuchs, den die Oberfläche abgeben will (schützt vor doppeltem Absenden).
export function guess(state, pid, g, n) {
  if (!state || state.mode === 'over' || state.mode === 'between') return { ok: false, error: 'Die Runde ist zu Ende.' };
  if (state.mode !== 'guess') return { ok: false, error: 'Der Code steht noch nicht fest.' };
  if (guesserPlayer(state).id !== pid) return { ok: false, error: 'Du bist nicht am Raten.' };
  if (!isValidCode(g)) return { ok: false, error: 'Bitte wähle genau 4 Farben.' };
  if (n !== undefined && n !== state.guesses.length) return { ok: false, error: 'Dieser Versuch ist nicht mehr aktuell.' };
  if (state.guesses.length >= MAX_TRIES) return { ok: false, error: 'Du hast keine Versuche mehr.' };
  const { b, w } = evaluate(state.code, g);
  state.guesses.push({ g: g.slice(), b, w });
  if (b === CODE_LEN) state.solved = true;
  else if (state.guesses.length >= MAX_TRIES) state.solved = false;
  if (state.solved !== null) finishRound(state);
  return { ok: true };
}

function finishRound(state) {
  state.results.push({
    setter: state.setter >= 0 ? state.players[state.setter].id : null,
    guesser: guesserPlayer(state).id,
    tries: state.guesses.length,
    solved: state.solved,
  });
  state.mode = state.round < state.rounds ? 'between' : 'over';
}

// Zweite Runde mit vertauschten Rollen (nur zu zweit).
export function next(state, pid) {
  if (!state || state.mode !== 'between') return { ok: false, error: 'Es gibt keine weitere Runde.' };
  if (!state.players.some((p) => p.id === pid)) return { ok: false, error: 'Du spielst nicht mit.' };
  const t = state.setter;
  state.setter = state.guesser;
  state.guesser = t;
  state.round += 1;
  state.mode = 'code';
  state.code = null;
  state.guesses = [];
  state.solved = null;
  return { ok: true };
}

// Wertung einer Person: Versuche (1..10), nicht geknackt = 11. Ohne Ergebnis: null.
export function scoreOf(state, pid) {
  const r = state.results.find((x) => x.guesser === pid);
  if (!r) return null;
  return r.solved ? r.tries : NO_SOLVE;
}

// Ergebnis nach Spielende. Zu zweit: weniger Versuche gewinnt, gleich = Unentschieden (winner null).
// Alleinspiel: Wertung der Person. Gegen den Computer: Mensch gewinnt, wenn der Computer es nicht schafft.
export function outcome(state) {
  if (!state || state.mode !== 'over') return null;
  const scores = state.players.map((p) => ({ id: p.id, name: p.name, score: scoreOf(state, p.id) }));
  if (state.kind === 'solo') {
    const r = state.results[0];
    return { kind: 'solo', solved: r.solved, tries: r.tries, scores, winner: r.solved ? state.players[0].id : null };
  }
  if (state.kind === 'bot') {
    const r = state.results[0];
    const human = state.players.find((p) => !isBotId(p.id));
    return { kind: 'bot', solved: r.solved, tries: r.tries, scores, winner: r.solved ? r.guesser : human.id };
  }
  const [a, b] = scores;
  let winner = null;
  if (a.score !== null && b.score !== null && a.score !== b.score) winner = a.score < b.score ? a.id : b.id;
  return { kind: 'duo', scores, winner, draw: winner === null };
}

// Alle Nachrichten laufen hierüber (Spieler → Gastgeber).
export function handle(state, pid, msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (msg.t === 'code') return setCode(state, pid, msg.code);
  if (msg.t === 'guess') return guess(state, pid, msg.g, msg.n);
  if (msg.t === 'next') return next(state, pid);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}
