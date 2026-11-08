// Reversi – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// 8×8-Brett, zwei Personen. Felder sind von links oben nach rechts unten durchnummeriert: Feld = Zeile * 8 + Spalte
// (Spalten a–h von links nach rechts, Zeilen 1–8 von oben nach unten; d4 = 27).
// Im Brett steht die Nummer der Person (0 oder 1) oder null. Wer Schwarz ist (g.black), beginnt jede Runde.
// Mehrere Runden: Punktestand bleibt im Zustand, die Farben wechseln jede Runde.
// Muss eine Person passen, bleibt das Spiel im Modus 'pass', bis jemand mit { t: 'ack' } bestätigt.

export const N = 8;
export const SIZE = 64;
export const COLOR_NAMES = ['Schwarz', 'Weiß'];
export const other = (i) => 1 - i;
export const CORNERS = [0, 7, 56, 63];
export const WIN_POINTS = 2;
export const DRAW_POINTS = 1;

export const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export const cellName = (p) => `${'abcdefgh'[p % N]}${Math.floor(p / N) + 1}`;

// Eingeschlossene gegnerische Steine, die ein Stein von `side` auf Feld p umdrehen würde (leer, wenn der Zug nicht erlaubt ist)
export function flipsFor(board, p, side) {
  if (!Array.isArray(board) || !Number.isInteger(p) || p < 0 || p >= SIZE || board[p] !== null) return [];
  const r0 = Math.floor(p / N);
  const c0 = p % N;
  const out = [];
  for (const [dr, dc] of DIRS) {
    const run = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === 1 - side) { run.push(r * N + c); r += dr; c += dc; }
    if (run.length && r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === side) out.push(...run);
  }
  return out;
}
export const isLegal = (board, p, side) => flipsFor(board, p, side).length > 0;
export function legalCells(board, side) {
  const out = [];
  for (let p = 0; p < SIZE; p++) if (board[p] === null && flipsFor(board, p, side).length) out.push(p);
  return out;
}
// Zug auf dem Brett ausführen (verändert das Brett); gibt die umgedrehten Felder zurück ([] = nicht erlaubt, nichts geändert)
export function applyMove(board, p, side) {
  const f = flipsFor(board, p, side);
  if (!f.length) return f;
  board[p] = side;
  for (const q of f) board[q] = side;
  return f;
}
export function countsOf(board) {
  const c = [0, 0];
  for (const v of board) if (v === 0 || v === 1) c[v] += 1;
  return c;
}
export function startBoard(black) {
  const b = Array(SIZE).fill(null);
  const white = 1 - black;
  b[27] = white; b[36] = white; // d4, e5
  b[35] = black; b[28] = black; // d5, e4
  return b;
}

const nameOf = (g, i) => g.players[i].name;
export const pointsText = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
export const colorOf = (g, i) => COLOR_NAMES[i === g.black ? 0 : 1];

export function createGame(playerList, opts = {}, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(playerList) || playerList.length < 2) throw new Error('Reversi braucht zwei Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    game: 'rv',
    mode: 'play', // 'play' | 'pass' (jemand muss passen, wartet auf OK) | 'over' (Ende der laufenden Runde)
    players: playerList.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
    opts: { hints: !!o.hints },
    board: startBoard(0),
    round: 1,
    black: 0, // wer in dieser Runde Schwarz ist (und beginnt)
    turn: 0,
    scores: [0, 0],
    moveNo: 0,
    last: null, // { by, p, flips }
    passer: null, // im Modus 'pass': wer nicht ziehen kann
    passes: 0, // wie oft in dieser Runde gepasst wurde
    winner: null, // Index oder null (unentschieden) – nur bei mode 'over'
    final: null, // Steinzahl [Person 0, Person 1] am Rundenende
    endCode: null, // 'full' | 'stuck'
    endReason: null,
    recap: [],
  };
}

export const legalActions = (g) => (!g || g.mode !== 'play' ? [] : legalCells(g.board, g.turn).map((p) => ({ t: 'place', p })));

function finishRound(g, code) {
  const c = countsOf(g.board);
  g.mode = 'over';
  g.passer = null;
  g.final = c;
  g.endCode = code;
  g.winner = c[0] === c[1] ? null : c[0] > c[1] ? 0 : 1;
  if (g.winner === null) {
    g.scores[0] += DRAW_POINTS; g.scores[1] += DRAW_POINTS;
    g.endReason = `Unentschieden: ${c[0]} zu ${c[1]} Steine.`;
    g.recap = [`Unentschieden, ${c[0]} zu ${c[1]}. Beide bekommen einen Punkt.`];
  } else {
    g.scores[g.winner] += WIN_POINTS;
    const w = g.winner;
    g.endReason = `${nameOf(g, w)} hat mehr Steine: ${c[w]} zu ${c[1 - w]}.`;
    g.recap = [`${nameOf(g, w)} hat gewonnen, ${c[w]} zu ${c[1 - w]}, und bekommt zwei Punkte.`];
  }
}

export function place(g, pid, p) {
  if (!g || g.mode === 'over') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  if (g.mode === 'pass') return { ok: false, error: 'Bitte zuerst den Hinweis mit OK bestätigen.' };
  if (g.mode !== 'play') return { ok: false, error: 'Gerade ist kein Zug möglich.' };
  const i = g.players.findIndex((x) => x.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!Number.isInteger(p) || p < 0 || p >= SIZE) return { ok: false, error: 'Dieses Feld gibt es nicht.' };
  if (g.board[p] !== null) return { ok: false, error: 'Dieses Feld ist schon belegt.' };
  const flips = applyMove(g.board, p, i);
  if (!flips.length) return { ok: false, error: 'Dort kannst du nicht setzen.' };
  g.moveNo += 1;
  g.last = { by: i, p, flips };
  const opp = other(i);
  const n = flips.length;
  const what = `${nameOf(g, i)} hat auf ${cellName(p)} gesetzt und ${n === 1 ? 'einen Stein' : n + ' Steine'} umgedreht.`;
  if (legalCells(g.board, opp).length) {
    g.turn = opp;
    g.recap = [what];
  } else if (legalCells(g.board, i).length) {
    g.mode = 'pass';
    g.passer = opp;
    g.passes += 1;
    g.turn = i;
    g.recap = [what, `${nameOf(g, opp)} kann nicht ziehen. ${nameOf(g, i)} ist wieder dran.`];
  } else {
    finishRound(g, g.board.every((v) => v !== null) ? 'full' : 'stuck');
    g.recap.unshift(what);
  }
  return { ok: true };
}

// Hinweis „Du kannst nicht ziehen“ bestätigen (die Person, die passen muss, oder die andere)
export function ack(g, pid) {
  if (!g || g.mode !== 'pass') return { ok: false, error: 'Es gibt nichts zu bestätigen.' };
  if (!g.players.some((x) => x.id === pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  g.mode = 'play';
  g.passer = null;
  return { ok: true };
}

// Nächste Runde: Startstellung, Punktestand bleibt, die Farben wechseln (Schwarz beginnt).
export function nextRound(g) {
  if (!g || g.mode !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.black = other(g.black);
  g.board = startBoard(g.black);
  g.round += 1;
  g.turn = g.black;
  g.mode = 'play';
  g.moveNo = 0;
  g.last = null;
  g.passer = null;
  g.passes = 0;
  g.winner = null;
  g.final = null;
  g.endCode = null;
  g.endReason = null;
  g.recap = [`Runde ${g.round}: ${nameOf(g, g.black)} spielt Schwarz und beginnt.`];
  return { ok: true };
}

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, index: i, points: g.scores[i] }));
  rows.sort((a, b) => b.points - a.points || a.index - b.index);
  let pl = 0; let prev = null;
  rows.forEach((r, i) => { if (r.points !== prev) pl = i + 1; prev = r.points; r.place = pl; });
  return rows;
}

// Nachrichten vom Netz: nie eine Ausnahme, nie ein beschädigter Zustand.
export function handle(g, pid, msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  try {
    switch (msg.t) {
      case 'place': return place(g, pid, msg.p);
      case 'ack': return ack(g, pid);
      case 'next': return g && g.players && g.players.some((x) => x.id === pid) ? nextRound(g) : { ok: false, error: 'Du spielst hier nicht mit.' };
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch {
    return { ok: false, error: 'Ungültige Nachricht.' };
  }
}
