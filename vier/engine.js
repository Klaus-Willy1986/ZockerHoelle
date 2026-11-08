// Vier in Reihe – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zwei Personen lassen abwechselnd einen Stein in eine Spalte fallen: Person 1 = Gelb (●), Person 2 = Rot (◆).
// Standard: 7 Spalten × 6 Reihen. Option "Größeres Brett" (opts.big): 8 Spalten × 7 Reihen.
// Feldnummer = Reihe * Spalten + Spalte; Reihe 0 ist OBEN, die unterste Reihe ist rows-1.
// Punkte: Sieg 2, Unentschieden 1 für jede Seite (ganze Zahlen; entspricht 1 und 0,5).

export const COLOR_NAMES = ['Gelb', 'Rot'];
export const other = (i) => 1 - i;
export const WIN = 2;
export const DRAW = 1;

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const colsOf = (big) => (big ? 8 : 7);
export const rowsOf = (big) => (big ? 7 : 6);

export function createGame(playerList, opts = {}, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(playerList) || playerList.length < 2) throw new Error('Vier in Reihe braucht zwei Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const big = !!o.big;
  const cols = colsOf(big);
  const rows = rowsOf(big);
  return {
    game: 'vr',
    mode: 'play', // 'play' | 'over' (Ende der laufenden Runde)
    players: playerList.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
    opts: { big },
    cols,
    rows,
    board: Array(cols * rows).fill(null), // null | 0 (Gelb) | 1 (Rot)
    round: 1,
    starter: 0,
    turn: 0,
    scores: [0, 0],
    moveNo: 0,
    last: null, // { by, p, col, row }
    winner: null,
    line: null, // Felder der Siegreihe(n)
    endCode: null, // 'line' | 'full'
    endReason: null,
    recap: [],
  };
}

// Unterstes freies Feld einer Spalte (Reihe) oder -1, wenn voll
export function dropRow(board, cols, rows, c) {
  for (let r = rows - 1; r >= 0; r--) if (board[r * cols + c] === null) return r;
  return -1;
}
export const colFull = (g, c) => dropRow(g.board, g.cols, g.rows, c) < 0;
export function openCols(g) {
  const out = [];
  for (let c = 0; c < g.cols; c++) if (!colFull(g, c)) out.push(c);
  return out;
}
export function legalActions(g) {
  if (!g || g.mode !== 'play') return [];
  return openCols(g).map((c) => ({ t: 'drop', c }));
}

// Alle Felder, die über Feld p zu einer Reihe von mindestens k gleichen Steinen gehören (leer, wenn keine)
export function lineThrough(board, cols, rows, k, p) {
  const c = board[p];
  if (c === null || c === undefined) return [];
  const r0 = Math.floor(p / cols);
  const c0 = p % cols;
  const at = (r, cc) => r >= 0 && r < rows && cc >= 0 && cc < cols && board[r * cols + cc] === c;
  const out = new Set();
  for (const [dr, dc] of DIRS) {
    const run = [p];
    for (let s = 1; at(r0 - dr * s, c0 - dc * s); s++) run.unshift((r0 - dr * s) * cols + (c0 - dc * s));
    for (let s = 1; at(r0 + dr * s, c0 + dc * s); s++) run.push((r0 + dr * s) * cols + (c0 + dc * s));
    if (run.length >= k) run.forEach((x) => out.add(x));
  }
  return [...out].sort((a, b) => a - b);
}
// Hat jemand vier in einer Reihe? (für Tests) -> 0 | 1 | null
export function winnerOf(board, cols, rows, k = 4) {
  for (let p = 0; p < board.length; p++) if (board[p] !== null && lineThrough(board, cols, rows, k, p).length) return board[p];
  return null;
}

const nameOf = (g, i) => g.players[i].name;
export const pointsText = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

export function drop(g, pid, c) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const i = g.players.findIndex((x) => x.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!Number.isInteger(c) || c < 0 || c >= g.cols) return { ok: false, error: 'Diese Spalte gibt es nicht.' };
  const row = dropRow(g.board, g.cols, g.rows, c);
  if (row < 0) return { ok: false, error: 'Die Spalte ist voll.' };
  const p = row * g.cols + c;
  g.board[p] = i;
  g.moveNo += 1;
  g.last = { by: i, p, col: c, row };
  const line = lineThrough(g.board, g.cols, g.rows, 4, p);
  if (line.length) {
    g.mode = 'over';
    g.winner = i;
    g.line = line;
    g.endCode = 'line';
    g.scores[i] += WIN;
    g.endReason = `${nameOf(g, i)} hat vier in einer Reihe.`;
    g.recap = [`${nameOf(g, i)} hat gewonnen und bekommt ${pointsText(WIN)}.`];
  } else if (g.board.every((v) => v !== null)) {
    g.mode = 'over';
    g.winner = null;
    g.endCode = 'full';
    g.scores[0] += DRAW;
    g.scores[1] += DRAW;
    g.endReason = 'Das Brett ist voll, niemand hat vier in einer Reihe.';
    g.recap = [`Unentschieden. Beide bekommen ${pointsText(DRAW)}.`];
  } else {
    g.turn = other(i);
    g.recap = [`${nameOf(g, i)} wirft in Spalte ${c + 1}.`];
  }
  return { ok: true };
}

// Nächste Runde: leeres Brett, Punktestand bleibt, die andere Person beginnt.
export function nextRound(g) {
  if (!g || g.mode !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.board = Array(g.cols * g.rows).fill(null);
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

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, index: i, points: g.scores[i] }));
  rows.sort((a, b) => b.points - a.points || a.index - b.index);
  let place = 0; let prev = null;
  rows.forEach((r, i) => { if (r.points !== prev) place = i + 1; prev = r.points; r.place = place; });
  return rows;
}

// Nachrichten vom Netz: nie eine Ausnahme, nie ein beschädigter Zustand.
export function handle(g, pid, msg, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  switch (msg.t) {
    case 'drop': return drop(g, pid, msg.c);
    case 'next': return g && g.players && g.players.some((x) => x.id === pid) ? nextRound(g) : { ok: false, error: 'Du spielst hier nicht mit.' };
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}
