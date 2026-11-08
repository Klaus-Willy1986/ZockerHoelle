// Bingo – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Der Zustand ist reines JSON. Zufall kommt immer als Parameter `rng` hinein.
//
// 75 Zahlen: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75. Jede Karte hat 5 x 5 Felder (Spalten B-I-N-G-O),
// das mittlere Feld (Index 12) ist frei und zählt als markiert. Zahlen je Spalte zufällig und einzigartig.
// Gezogen wird eine Zahl nach der anderen ohne Zurücklegen (nur der Gastgeber, g.host, darf ziehen).
// Markiert wird von Hand (msg mark); nur gezogene Zahlen lassen sich markieren. Mit der Option auto
// markiert das Spiel die Zahlen auf den Karten der Menschen von selbst (Computer markieren immer selbst).
// Gewinnen: "BINGO!" (msg bingo) mit einer komplett markierten Reihe/Spalte/Diagonale (Option full: ganze Karte).
// Mehrere zugleich gültige Karten: Die erste eintreffende Nachricht gewinnt, alle anderen im selben Moment
// gültigen Personen gewinnen mit. Nach dem Ende der Runde ändert sich nichts mehr (spätere Nachrichten sind ungültig).
// Hinweis: Der Zustand enthält technisch die Karten ALLER Personen (nötig für "x Felder fehlen");
// die Oberfläche zeigt nur die eigenen Karten. Künftig gezogene Zahlen stehen nicht im Zustand.

export const GAME = 'bg';
export const MAX_PLAYERS = 8;
export const TOTAL = 75;
export const FREE = 12;
export const LETTERS = 'BINGO';
export const TIMER_MS = 8000;

export const isBotId = (id) => String(id).startsWith('bot');
export const letterOf = (n) => LETTERS[Math.min(4, Math.max(0, Math.floor((n - 1) / 15)))];
export const label = (n) => `${letterOf(n)} ${n}`;

// 5 Reihen, 5 Spalten, 2 Diagonalen (Feldindex = Reihe * 5 + Spalte)
export const LINES = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L;
})();

const ri = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = ri(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function makeCard(rng = Math.random) {
  const card = Array(25).fill(0);
  for (let c = 0; c < 5; c++) {
    const pool = shuffle(Array.from({ length: 15 }, (_, k) => c * 15 + k + 1), rng).slice(0, 5);
    for (let r = 0; r < 5; r++) card[r * 5 + c] = pool[r];
  }
  card[FREE] = 0;
  return card;
}
export const freshMarks = () => { const m = Array(25).fill(0); m[FREE] = 1; return m; };

// ---------- Prüfen ----------
export const lineDone = (marks, line) => line.every((i) => marks[i] === 1);
export function validMarks(marks, full) { return full ? marks.every((x) => x === 1) : LINES.some((l) => lineDone(marks, l)); }
// Wie viele Felder fehlen noch bis zum Gewinn (kleinster Wert über alle Reihen/Spalten/Diagonalen, bei Volles Haus: alle offenen)
export function missingMarks(marks, full) {
  if (full) return marks.filter((x) => x !== 1).length;
  return Math.min(...LINES.map((l) => l.filter((i) => marks[i] !== 1).length));
}
export const winLines = (marks, full) => (full ? (marks.every((x) => x === 1) ? [Array.from({ length: 25 }, (_, i) => i)] : []) : LINES.filter((l) => lineDone(marks, l)));

export const playerIndex = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const hasPlayer = (g, pid) => playerIndex(g, pid) >= 0;
export const isValid = (g, pid) => !!g.marks[pid] && g.marks[pid].some((m) => validMarks(m, g.full));
export const missing = (g, pid) => (g.marks[pid] ? Math.min(...g.marks[pid].map((m) => missingMarks(m, g.full))) : 25);
export const remaining = (g) => { const d = new Set(g.drawn); const out = []; for (let n = 1; n <= TOTAL; n++) if (!d.has(n)) out.push(n); return out; };
export const lastDrawn = (g) => (g.drawn.length ? g.drawn[g.drawn.length - 1] : null);
// Zahl n steht auf Karte c der Person und ist noch nicht markiert -> Feldindex, sonst -1
export function cellOf(g, pid, c, n) { const card = g.cards[pid] && g.cards[pid][c]; return card ? card.findIndex((v, i) => i !== FREE && v === n && g.marks[pid][c][i] !== 1) : -1; }

// ---------- Spiel anlegen ----------
function deal(g, rng) {
  g.cards = {}; g.marks = {};
  for (const p of g.players) {
    const cs = [makeCard(rng)];
    if (g.two) { let c2 = makeCard(rng); for (let k = 0; k < 20 && c2.join() === cs[0].join(); k++) c2 = makeCard(rng); cs.push(c2); }
    g.cards[p.id] = cs;
    g.marks[p.id] = cs.map(() => freshMarks());
  }
  g.drawn = []; g.phase = 'play'; g.winners = []; g.winBy = null; g.evt = null;
  g.seed = ri(rng, 2147483647);
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const players = (Array.isArray(playerList) ? playerList : []).slice(0, MAX_PLAYERS).map((p) => ({ id: String(p.id), name: String(p.name) }));
  const g = {
    game: GAME,
    phase: 'play', // 'play' | 'over' (Ende der Runde)
    players,
    host: o.host && players.some((p) => p.id === o.host) ? o.host : (players[0] ? players[0].id : ''),
    two: !!o.two, auto: !!o.auto, full: !!o.full, timer: !!o.timer,
    gid: ri(rng, 2147483647), // Kennung der Partie (für Zeitgeber)
    round: 1,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    cards: {}, marks: {}, drawn: [], winners: [], winBy: null,
    seed: 0, // nur zum Berechnen des "Verpassens" der Computer
    seq: 0, evt: null,
  };
  deal(g, rng);
  return g;
}

// ---------- Aktionen ----------
const bad = (error, code) => ({ ok: false, error, code: code || 'bad' });
const note = (g, kind, extra = {}) => { g.seq += 1; g.evt = { seq: g.seq, kind, ...extra }; };

export function draw(g, pid, rng = Math.random) {
  if (!g || g.phase !== 'play') return bad('Die Runde läuft nicht.');
  if (pid !== g.host) return bad('Nur der Gastgeber zieht die Zahlen.');
  const rest = remaining(g);
  if (!rest.length) return bad('Es sind schon alle Zahlen gezogen.');
  const n = rest[ri(rng, rest.length)];
  g.drawn.push(n);
  if (g.auto) {
    for (const p of g.players) {
      if (isBotId(p.id)) continue;
      g.cards[p.id].forEach((card, c) => card.forEach((v, i) => { if (v === n) g.marks[p.id][c][i] = 1; }));
    }
  }
  note(g, 'draw', { n });
  // Sind alle 75 gezogen, geht es ohne neue Zahlen weiter: Markieren und "BINGO!" sind weiter möglich.
  return { ok: true, n };
}

export function mark(g, pid, c, i) {
  if (!g || g.phase !== 'play') return bad('Die Runde läuft nicht.');
  if (!hasPlayer(g, pid)) return bad('Du spielst nicht mit.');
  if (!Number.isInteger(c) || c < 0 || c >= g.cards[pid].length) return bad('Diese Karte gibt es nicht.');
  if (!Number.isInteger(i) || i < 0 || i >= 25) return bad('Dieses Feld gibt es nicht.');
  if (i === FREE) return bad('Das mittlere Feld ist frei und zählt schon.', 'free');
  const v = g.cards[pid][c][i];
  if (g.marks[pid][c][i] === 1) return bad('Dieses Feld ist schon markiert.', 'again');
  if (!g.drawn.includes(v)) return bad('Die wurde noch nicht gezogen.', 'not-drawn');
  g.marks[pid][c][i] = 1;
  note(g, 'mark', { by: pid, c, i });
  return { ok: true };
}

export function bingo(g, pid) {
  if (!g || g.phase !== 'play') return bad('Die Runde ist schon vorbei.');
  if (!hasPlayer(g, pid)) return bad('Du spielst nicht mit.');
  if (!isValid(g, pid)) {
    note(g, 'nobingo', { by: pid });
    return bad('Noch nicht ganz – weiter geht’s.', 'not-yet');
  }
  // Erste eintreffende Nachricht gewinnt; wer im selben Moment ebenfalls gültig ist, gewinnt mit
  const win = [pid, ...g.players.map((p) => p.id).filter((id) => id !== pid && isValid(g, id))];
  g.winners = win; g.winBy = pid; g.phase = 'over';
  for (const id of win) g.scores[id] += 1;
  note(g, 'bingo', { by: pid, count: g.drawn.length });
  return { ok: true, winners: win };
}

export function next(g, pid, rng = Math.random) {
  if (!g || g.phase !== 'over') return bad('Die Runde läuft noch.');
  if (pid !== g.host) return bad('Nur der Gastgeber startet die nächste Runde.');
  g.round += 1;
  g.gid = ri(rng, 2147483647);
  deal(g, rng);
  note(g, 'next');
  return { ok: true };
}

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || typeof g !== 'object' || g.game !== GAME) return bad('Kein Spiel.');
  if (!msg || typeof msg !== 'object') return bad('Ungültige Nachricht.');
  if (msg.t === 'draw') return draw(g, pid, rng);
  if (msg.t === 'mark') return mark(g, pid, msg.c === undefined ? 0 : msg.c, msg.i);
  if (msg.t === 'bingo') return bingo(g, pid);
  if (msg.t === 'next') return next(g, pid, rng);
  return bad('Unbekannte Nachricht.');
}

// ---------- Wertung ----------
export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, points: g.scores[p.id] || 0, i, win: g.phase === 'over' && g.winners.includes(p.id) }));
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((q) => q.points > r.points).length })).sort((a, b) => a.rank - b.rank || a.i - b.i);
}
export function outcome(g) {
  if (!g || g.phase !== 'over') return null;
  return { winners: g.winners.slice(), by: g.winBy, drawn: g.drawn.length, ranking: ranking(g) };
}
