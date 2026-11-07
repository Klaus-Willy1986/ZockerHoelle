// Drei gewinnt – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zwei Personen setzen abwechselnd ein Zeichen: Person 1 der Spielerliste = Kreuz, Person 2 = Kreis.
// 3×3: drei in einer Reihe gewinnen. Option "Großes Feld" (opts.big): 5×5, vier in einer Reihe.
// Felder sind von links oben nach rechts unten durchnummeriert: Feld = Zeile * Größe + Spalte.
// Mehrere Runden: Punktestand bleibt im Zustand, die beginnende Person wechselt jede Runde.

export const MARK_NAMES = ['Kreuz', 'Kreis'];
export const other = (i) => 1 - i;

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const cache = new Map();

export const sizeOf = (big) => (big ? 5 : 3);
export const needOf = (big) => (big ? 4 : 3);

// Alle Gewinnreihen (Listen von Feldnummern) für Größe n und Länge k
export function winLines(n, k) {
  const key = `${n}x${k}`;
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + dr * (k - 1);
        const ec = c + dc * (k - 1);
        if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
        out.push(Array.from({ length: k }, (_, i) => (r + dr * i) * n + (c + dc * i)));
      }
    }
  }
  cache.set(key, out);
  return out;
}
export const linesOf = (g) => winLines(g.size, g.k);

// rng ist für spätere Erweiterungen vorgesehen (die Regeln selbst brauchen keinen Zufall).
export function createGame(playerList, opts = {}, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(playerList) || playerList.length < 2) throw new Error('Drei gewinnt braucht zwei Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const big = !!o.big;
  const size = sizeOf(big);
  return {
    game: 'drei',
    mode: 'play', // 'play' | 'over' (Ende der laufenden Runde)
    players: playerList.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
    opts: { big },
    size,
    k: needOf(big),
    board: Array(size * size).fill(null), // null | 0 (Kreuz) | 1 (Kreis)
    round: 1,
    starter: 0, // wer in dieser Runde beginnt
    turn: 0,
    scores: [0, 0],
    moveNo: 0,
    last: null, // { by, p }
    winner: null, // Index oder null (unentschieden) – nur sinnvoll bei mode 'over'
    line: null, // Felder der Siegreihe
    endCode: null, // 'line' | 'full'
    endReason: null,
    recap: [],
  };
}

export const freeCells = (g) => g.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
export function legalActions(g) {
  if (!g || g.mode !== 'play') return [];
  return freeCells(g).map((p) => ({ t: 'place', p }));
}

// Siegreihe, die das Feld p enthält (so weit verlängert, wie dieselben Zeichen reichen), sonst null
export function lineThrough(board, n, k, p) {
  const c = board[p];
  if (c === null || c === undefined) return null;
  const r0 = Math.floor(p / n);
  const c0 = p % n;
  const at = (r, cc) => (r >= 0 && r < n && cc >= 0 && cc < n && board[r * n + cc] === c);
  for (const [dr, dc] of DIRS) {
    const run = [p];
    for (let s = 1; at(r0 - dr * s, c0 - dc * s); s++) run.unshift((r0 - dr * s) * n + (c0 - dc * s));
    for (let s = 1; at(r0 + dr * s, c0 + dc * s); s++) run.push((r0 + dr * s) * n + (c0 + dc * s));
    if (run.length >= k) return run;
  }
  return null;
}
// Hat jemand schon gewonnen? (für Tests und Computergegner)
export function winnerOf(board, n, k) {
  for (let p = 0; p < board.length; p++) if (board[p] !== null && lineThrough(board, n, k, p)) return board[p];
  return null;
}

const nameOf = (g, i) => g.players[i].name;
export const pointsText = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

export function place(g, pid, p) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const i = g.players.findIndex((x) => x.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!Number.isInteger(p) || p < 0 || p >= g.board.length) return { ok: false, error: 'Dieses Feld gibt es nicht.' };
  if (g.board[p] !== null) return { ok: false, error: 'Dieses Feld ist schon belegt.' };
  g.board[p] = i;
  g.moveNo += 1;
  g.last = { by: i, p };
  const line = lineThrough(g.board, g.size, g.k, p);
  if (line) {
    g.mode = 'over';
    g.winner = i;
    g.line = line;
    g.endCode = 'line';
    g.scores[i] += 1;
    g.endReason = `${nameOf(g, i)} hat ${g.k} in einer Reihe.`;
    g.recap = [`${nameOf(g, i)} hat gewonnen und bekommt einen Punkt.`];
  } else if (g.board.every((v) => v !== null)) {
    g.mode = 'over';
    g.winner = null;
    g.endCode = 'full';
    g.endReason = 'Das Feld ist voll, niemand hat eine Reihe.';
    g.recap = ['Unentschieden. Niemand bekommt einen Punkt.'];
  } else {
    g.turn = other(i);
    g.recap = [`${nameOf(g, i)} hat ein ${MARK_NAMES[i]} gesetzt.`];
  }
  return { ok: true };
}

// Nächste Runde: leeres Feld, Punktestand bleibt, die andere Person beginnt.
export function nextRound(g) {
  if (!g || g.mode !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.board = Array(g.size * g.size).fill(null);
  g.round += 1;
  g.starter = other(g.starter);
  g.turn = g.starter;
  g.mode = 'play';
  g.moveNo = 0;
  g.last = null;
  g.winner = null;
  g.line = null;
  g.endCode = null;
  g.endReason = null;
  g.recap = [`Runde ${g.round}: ${nameOf(g, g.starter)} beginnt.`];
  return { ok: true };
}

// Rangliste nach Punkten
export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, index: i, points: g.scores[i] }));
  rows.sort((a, b) => b.points - a.points || a.index - b.index);
  let place = 0; let prev = null;
  rows.forEach((r, i) => { if (r.points !== prev) place = i + 1; prev = r.points; r.place = place; });
  return rows;
}

// Nachrichten vom Netz: nie eine Ausnahme, nie ein beschädigter Zustand.
export function handle(g, pid, msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  switch (msg.t) {
    case 'place': return place(g, pid, msg.p);
    case 'next': return g && g.players && g.players.some((x) => x.id === pid) ? nextRound(g) : { ok: false, error: 'Du spielst hier nicht mit.' };
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}
