// Ludo – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Würfel) kommt nur über den Parameter rng herein und wird nur im Gastgeber benutzt.

export const COLOR_NAMES = ['Rot', 'Blau', 'Grün', 'Gelb'];
export const LETTERS = ['R', 'B', 'G', 'Y'];
export const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
export const SHAPE_NAMES = ['Kreis', 'Quadrat', 'Dreieck', 'Raute'];
export const PIECES = 4;
export const RING = 40;
export const GOAL_FIRST = 40; // erste Zielfeld-Nummer (Fortschritt), 40..43
export const GOAL_LAST = 43;
export const MAX_ROLLS = 3;
const RECAP_MAX = 6;

// Sitzplätze: 2 Personen sitzen gegenüber (Rot, Grün), 3 = Rot, Blau, Grün, 4 = alle.
export const SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

// ---------- Brett (11x11-Raster, Spalte/Zeile ab 0) ----------
// Rundweg im Uhrzeigersinn, Feld 0 = Startfeld von Rot. Start von Farbe c = Feld 10*c.
export const RING_CELLS = [
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [10, 5],
  [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10], [5, 10],
  [4, 10], [4, 9], [4, 8], [4, 7], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 5],
];
export const GOAL_CELLS = [
  [[1, 5], [2, 5], [3, 5], [4, 5]],
  [[5, 1], [5, 2], [5, 3], [5, 4]],
  [[9, 5], [8, 5], [7, 5], [6, 5]],
  [[5, 9], [5, 8], [5, 7], [5, 6]],
];
export const HOME_CELLS = [
  [[1, 1], [2, 1], [1, 2], [2, 2]],
  [[8, 1], [9, 1], [8, 2], [9, 2]],
  [[8, 8], [9, 8], [8, 9], [9, 9]],
  [[1, 8], [2, 8], [1, 9], [2, 9]],
];
export const startIndex = (color) => color * 10;
// Fortschritt: -1 = Haus, 0..39 = Rundweg (0 = eigenes Startfeld), 40..43 = Zielgerade
export const ringIndex = (color, progress) => (color * 10 + progress) % RING;
export function cellOf(color, progress, piece) {
  if (progress < 0) return HOME_CELLS[color][piece];
  if (progress >= GOAL_FIRST) return GOAL_CELLS[color][progress - GOAL_FIRST];
  return RING_CELLS[ringIndex(color, progress)];
}

// ---------- Spielstand ----------
export function createGame(playerList, rng = Math.random) {
  const n = playerList.length;
  const seats = SEATS[n];
  if (!seats) throw new Error('Ludo geht nur mit 2 bis 4 Personen.');
  const state = {
    game: 'ludo',
    gid: Math.floor(rng() * 1e9),
    mode: 'play', // 'play' | 'over'
    players: playerList.map((p, i) => ({ id: p.id, name: p.name, color: seats[i], pieces: Array(PIECES).fill(-1) })),
    active: 0,
    turn: null,
    rollId: 0,
    last: null, // letzter Wurf / Zug, für die Anzeige
    recap: [],
    winner: null,
    endReason: null,
  };
  state.turn = newTurn(state, false);
  return state;
}

export const activePlayer = (state) => state.players[state.active];
export const homeCount = (p) => p.pieces.filter((x) => x < 0).length;
export const goalCount = (p) => p.pieces.filter((x) => x >= GOAL_FIRST).length;
const isParked = (p, prog) => {
  if (prog < GOAL_FIRST) return false;
  for (let q = prog + 1; q <= GOAL_LAST; q++) if (!p.pieces.includes(q)) return false;
  return true;
};
// Hat die Person eine Figur, die überhaupt noch ziehen könnte (Rundweg oder Zielgerade, nicht ganz hinten festgeparkt)?
export const hasBoardPiece = (p) => p.pieces.some((x) => x >= 0 && !isParked(p, x));

function newTurn(state, bonus) {
  const p = state.players[state.active];
  return { stage: 'roll', rolls: 0, maxRolls: hasBoardPiece(p) ? 1 : MAX_ROLLS, die: null, movable: [], bonus };
}

function pushRecap(state, line) {
  state.recap.unshift(line); // neueste zuerst
  if (state.recap.length > RECAP_MAX) state.recap.length = RECAP_MAX;
}

// Alle erlaubten Züge der Person pi bei Augenzahl die (inkl. Pflichtregeln).
export function legalMoves(state, pi, die) {
  const p = state.players[pi];
  const own = p.pieces;
  const startBlocked = own.includes(0);
  const homes = homeCount(p);
  let res = [];
  own.forEach((prog, i) => {
    if (prog < 0) {
      if (die === 6 && !startBlocked) res.push({ piece: i, from: -1, to: 0 });
      return;
    }
    const np = prog + die;
    if (np > GOAL_LAST) return;
    if (own.includes(np)) return;
    for (const q of own) if (q >= GOAL_FIRST && q > prog && q < np) return; // Zielgerade: nicht überspringen
    res.push({ piece: i, from: prog, to: np });
  });
  if (homes > 0 && startBlocked) {
    const off = res.filter((m) => m.from === 0);
    if (off.length) res = off;
  } else if (homes > 0 && die === 6 && !startBlocked) {
    res = res.filter((m) => m.from === -1);
  }
  return res;
}

function nextPlayer(state) {
  state.active = (state.active + 1) % state.players.length;
  state.turn = newTurn(state, false);
}

export function roll(state, pid, rng = Math.random) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(state);
  if (!p || p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const t = state.turn;
  if (t.stage !== 'roll') return { ok: false, error: 'Du musst jetzt eine Figur ziehen.' };
  const die = 1 + Math.min(5, Math.floor(rng() * 6));
  t.rolls += 1;
  t.die = die;
  state.rollId += 1;
  const moves = legalMoves(state, state.active, die);
  const base = { pid: p.id, name: p.name, color: p.color, die, rollId: state.rollId };
  if (moves.length) {
    t.stage = 'move';
    t.movable = moves.map((m) => m.piece);
    state.last = { ...base, kind: 'roll' };
    return { ok: true, die, moves };
  }
  t.movable = [];
  if (t.rolls < t.maxRolls) {
    const text = `${p.name} würfelt eine ${die} und kann nicht ziehen – du würfelst gleich noch einmal (Versuch ${t.rolls + 1} von ${t.maxRolls}).`;
    pushRecap(state, text);
    state.last = { ...base, kind: 'nomove', again: true, text };
    return { ok: true, die, moves: [], again: true };
  }
  const text = `${p.name} würfelt eine ${die} und kann nicht ziehen.`;
  pushRecap(state, text);
  state.last = { ...base, kind: 'nomove', again: false, text };
  nextPlayer(state);
  return { ok: true, die, moves: [], again: false };
}

export function move(state, pid, piece) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(state);
  if (!p || p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const t = state.turn;
  if (t.stage !== 'move') return { ok: false, error: 'Du musst zuerst würfeln.' };
  if (!Number.isInteger(piece) || piece < 0 || piece >= PIECES || !t.movable.includes(piece)) {
    return { ok: false, error: 'Diese Figur darf jetzt nicht ziehen.' };
  }
  const m = legalMoves(state, state.active, t.die).find((x) => x.piece === piece);
  if (!m) return { ok: false, error: 'Diese Figur darf jetzt nicht ziehen.' };
  const fromCell = cellOf(p.color, m.from, piece);
  p.pieces[piece] = m.to;
  const toCell = cellOf(p.color, m.to, piece);
  const captured = [];
  if (m.to <= 39) {
    const abs = ringIndex(p.color, m.to);
    for (const o of state.players) {
      if (o === p) continue;
      o.pieces.forEach((q, j) => {
        if (q >= 0 && q <= 39 && ringIndex(o.color, q) === abs) {
          o.pieces[j] = -1;
          captured.push({ pid: o.id, name: o.name, color: o.color, piece: j });
        }
      });
    }
  }
  const die = t.die;
  const toGoal = m.to >= GOAL_FIRST;
  const felder = die === 1 ? '1 Feld' : `${die} Felder`;
  let text;
  if (m.from < 0) text = `${p.name} stellt eine Figur auf das Startfeld.`;
  else if (toGoal) text = `${p.name} zieht ${felder} und kommt in der Zielgerade an.`;
  else text = `${p.name} zieht ${felder} weiter.`;
  for (const c of captured) text += ` ${c.name} wird geschlagen und muss zurück ins Haus!`;
  pushRecap(state, text);
  state.last = {
    kind: 'move', pid: p.id, name: p.name, color: p.color, die, rollId: state.rollId,
    piece, from: fromCell, to: toCell, captured, text,
  };
  if (p.pieces.every((x) => x >= GOAL_FIRST)) {
    state.mode = 'over';
    state.winner = state.active;
    state.endReason = `${p.name} hat alle vier Figuren ins Ziel gebracht.`;
    state.turn = { stage: 'over', rolls: 0, maxRolls: 0, die: null, movable: [], bonus: false };
    return { ok: true, captured, won: true };
  }
  if (die === 6) {
    pushRecap(state, `${p.name} hat eine 6 gewürfelt und darf noch einmal würfeln.`);
    state.turn = newTurn(state, true);
    return { ok: true, captured, again: true };
  }
  nextPlayer(state);
  return { ok: true, captured, again: false };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(state, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (msg.t === 'roll') return roll(state, pid, rng);
  if (msg.t === 'move') return move(state, pid, msg.piece);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

export function ranking(state) {
  const rows = state.players.map((p, i) => ({
    id: p.id, name: p.name, color: p.color, goal: goalCount(p), home: homeCount(p),
    progress: p.pieces.reduce((s, x) => s + Math.max(0, x + 1), 0), idx: i,
  }));
  rows.sort((a, b) => (state.winner === a.idx ? -1 : state.winner === b.idx ? 1 : 0) || b.goal - a.goal || b.progress - a.progress || a.idx - b.idx);
  return rows;
}
