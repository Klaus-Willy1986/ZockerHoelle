// Springspiel (Steckspiel-Solitär) – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Brett: 7x7-Raster, Feld-Index = Zeile * 7 + Spalte. Werte in board: -1 = kein Loch, 0 = leeres Loch, 1 = Stein.

export const SIZE = 7;
export const CELLS = SIZE * SIZE;
export const CENTER = 24; // Zeile 3, Spalte 3
export const SHAPES = ['eng', 'fra'];
export const SHAPE_NAMES = { eng: 'Englisch', fra: 'Französisch' };
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // hoch, rechts, runter, links

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;

// Ist (r,c) ein Loch auf dem Brett dieser Form?
export function isHole(shape, r, c) {
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
  const edge = (v) => v < 2 || v > 4;
  if (edge(r) && edge(c)) {
    // Eckfelder: englisches Brett ohne alle vier 2x2-Ecken; französisches Brett behält die innersten Eckfelder
    if (shape === 'fra') return (r === 1 || r === 5) && (c === 1 || c === 5);
    return false;
  }
  return true;
}
export const holeCount = (shape) => { let n = 0; for (let i = 0; i < CELLS; i++) if (isHole(shape, rowOf(i), colOf(i))) n++; return n; };

export function createGame(playerList, shape = 'eng') {
  const sh = SHAPES.includes(shape) ? shape : 'eng';
  const board = Array.from({ length: CELLS }, (_, i) => (isHole(sh, rowOf(i), colOf(i)) ? 1 : -1));
  board[CENTER] = 0;
  const list = Array.isArray(playerList) && playerList.length ? playerList : [{ id: 'p0', name: 'Du' }];
  return {
    game: 'sp',
    mode: 'play', // 'play' | 'over'
    shape: sh,
    players: [{ id: list[0].id, name: list[0].name }],
    board,
    moves: [], // Verlauf: [von, übersprungen, nach]
  };
}

export const stonesLeft = (g) => g.board.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
export const moveCount = (g) => g.moves.length;
export const lastMove = (g) => (g.moves.length ? g.moves[g.moves.length - 1] : null);

// Alle erlaubten Sprünge des Steins auf Feld i: [{from, over, to}]
export function movesFrom(g, i) {
  const out = [];
  if (!g || !Array.isArray(g.board) || !Number.isInteger(i) || i < 0 || i >= CELLS || g.board[i] !== 1) return out;
  const r = rowOf(i), c = colOf(i);
  for (const [dr, dc] of DIRS) {
    const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
    if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) continue;
    const over = idx(r1, c1), to = idx(r2, c2);
    if (g.board[over] === 1 && g.board[to] === 0) out.push({ from: i, over, to });
  }
  return out;
}
export function allMoves(g) {
  const out = [];
  for (let i = 0; i < CELLS; i++) out.push(...movesFrom(g, i));
  return out;
}
export const movableStones = (g) => { const s = []; for (let i = 0; i < CELLS; i++) if (movesFrom(g, i).length) s.push(i); return s; };
export const targetsFrom = (g, i) => movesFrom(g, i).map((m) => m.to);

const isPlayer = (g, pid) => !!g && Array.isArray(g.players) && g.players.length > 0 && g.players[0].id === pid;

export function move(g, pid, from, to) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= CELLS || to < 0 || to >= CELLS) return { ok: false, error: 'Ungültiges Feld.' };
  const m = movesFrom(g, from).find((x) => x.to === to);
  if (!m) return { ok: false, error: 'Dieser Sprung ist nicht erlaubt.' };
  g.board[m.from] = 0;
  g.board[m.over] = 0;
  g.board[m.to] = 1;
  g.moves.push([m.from, m.over, m.to]);
  if (!allMoves(g).length) g.mode = 'over';
  return { ok: true };
}

// Letzten Zug zurücknehmen (beliebig oft).
export function undo(g, pid) {
  if (!g || !Array.isArray(g.moves)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (!g.moves.length) return { ok: false, error: 'Es gibt noch keinen Zug zum Zurücknehmen.' };
  const [from, over, to] = g.moves.pop();
  g.board[from] = 1;
  g.board[over] = 1;
  g.board[to] = 0;
  g.mode = 'play';
  return { ok: true };
}

// Neu anfangen (optional mit anderer Brettform).
export function restart(g, pid, shape) {
  if (!g || !Array.isArray(g.players)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (shape !== undefined && !SHAPES.includes(shape)) return { ok: false, error: 'Diese Brettform gibt es nicht.' };
  Object.assign(g, createGame(g.players, shape === undefined ? g.shape : shape));
  return { ok: true };
}

// Nachrichten der Oberfläche; ungültige Nachrichten verändern nie den Zustand.
export function handle(g, pid, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: 'Ungültige Nachricht.' };
  switch (msg.t) {
    case 'move': return move(g, pid, msg.from, msg.to);
    case 'undo': return undo(g, pid);
    case 'restart': return restart(g, pid);
    case 'shape': return SHAPES.includes(msg.shape) ? restart(g, pid, msg.shape) : { ok: false, error: 'Diese Brettform gibt es nicht.' };
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}

// ---------- Bewertung ----------
export function rating(g) {
  const stones = stonesLeft(g);
  const center = stones === 1 && g.board[CENTER] === 1;
  let key, title, text;
  if (stones === 1 && center) { key = 'grand'; title = 'Großmeister'; text = 'Ein einziger Stein, genau in der Mitte. Besser geht es nicht!'; }
  else if (stones === 1) { key = 'master'; title = 'Meister'; text = 'Nur ein Stein ist übrig geblieben. Sehr stark!'; }
  else if (stones === 2) { key = 'verygood'; title = 'Sehr gut'; text = 'Das ist ein tolles Ergebnis.'; }
  else if (stones === 3) { key = 'good'; title = 'Gut'; text = 'Das war eine gute Runde.'; }
  else if (stones === 4) { key = 'fair'; title = 'Ordentlich'; text = 'Das ist ordentlich. Mit etwas Übung geht noch mehr.'; }
  else if (stones <= 7) { key = 'practice'; title = 'Weiter üben'; text = 'Mit etwas Übung bleiben noch weniger Steine übrig.'; }
  else { key = 'more'; title = 'Das geht noch besser'; text = 'Kein Problem, probiere es gern noch einmal.'; }
  return { stones, center, key, title, text };
}

// Ist Ergebnis a besser als b? (weniger Steine; bei Gleichstand zählt die Mitte). b darf null sein.
export function better(a, b) {
  if (!a || !Number.isFinite(a.stones)) return false;
  if (!b || !Number.isFinite(b.stones)) return true;
  if (a.stones !== b.stones) return a.stones < b.stones;
  return !!a.center && !b.center;
}
export const resultOf = (g) => { const r = rating(g); return { stones: r.stones, center: r.center }; };
