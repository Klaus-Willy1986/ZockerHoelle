// Qwixx – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Wird im Browser (ES-Modul) und in Node (Tests) verwendet.

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const COLOR_NAMES = { red: 'Rot', yellow: 'Gelb', green: 'Grün', blue: 'Blau' };
// Rot & Gelb: 2 → 12 aufsteigend. Grün & Blau: 12 → 2 absteigend.
export const ASC = { red: true, yellow: true, green: false, blue: false };
export const POINTS = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
export const PENALTY = 5;
export const MAX_PENALTIES = 4;
export const MIN_CROSSES_TO_LOCK = 5;
export const ROW_LEN = 11;

export const numberAt = (color, idx) => (ASC[color] ? idx + 2 : 12 - idx);
export const indexOfNumber = (color, num) => (ASC[color] ? num - 2 : 12 - num);

function emptyRows() {
  const rows = {};
  for (const c of COLORS) rows[c] = { marks: Array(ROW_LEN).fill(false), lock: false };
  return rows;
}

export function lastMarkedIndex(row) {
  for (let i = ROW_LEN - 1; i >= 0; i--) if (row.marks[i]) return i;
  return -1;
}
export const markCount = (row) => row.marks.filter(Boolean).length;
export const crossCount = (row) => markCount(row) + (row.lock ? 1 : 0);

export function scoreOf(player) {
  const perColor = {};
  let sum = 0;
  for (const c of COLORS) {
    const n = crossCount(player.rows[c]);
    perColor[c] = { crosses: n, points: POINTS[n] };
    sum += POINTS[n];
  }
  const penalty = player.penalties * PENALTY;
  return { perColor, sum, penalty, total: sum - penalty };
}

export function createGame(playerList) {
  return {
    phase: 'roll', // 'roll' | 'white' | 'color' | 'over'
    players: playerList.map((p) => ({ id: p.id, name: p.name, rows: emptyRows(), penalties: 0 })),
    closed: { red: false, yellow: false, green: false, blue: false },
    dice: null,
    active: 0,
    round: 0,
    rollId: 0,
    picks: {}, // id -> Zug oder null (= nichts ankreuzen), nur für den aktuellen Schritt
    auto: {}, // id -> true, wenn automatisch übersprungen (keine Möglichkeit)
    turnCrosses: {},
    recap: [], // Zusammenfassung der letzten Runde (Texte)
    endReason: null,
  };
}

export function rollDice(state, rng = Math.random) {
  const d = () => 1 + Math.floor(rng() * 6);
  const dice = { w1: d(), w2: d() };
  for (const c of COLORS) dice[c] = state.closed[c] ? null : d();
  return dice;
}

function canMark(row, idx) {
  if (idx <= lastMarkedIndex(row)) return false;
  if (idx === ROW_LEN - 1 && markCount(row) < MIN_CROSSES_TO_LOCK) return false;
  return true;
}

// Alle erlaubten Züge eines Spielers im aktuellen Schritt.
export function legalMoves(state, pid, step = state.phase) {
  const player = state.players.find((p) => p.id === pid);
  if (!player || !state.dice) return [];
  const moves = [];
  const seen = new Set();
  const add = (color, sum, how) => {
    if (state.closed[color]) return;
    const idx = indexOfNumber(color, sum);
    if (idx < 0 || idx >= ROW_LEN) return;
    if (!canMark(player.rows[color], idx)) return;
    const key = color + idx;
    if (seen.has(key)) return;
    seen.add(key);
    moves.push({ color, idx, num: sum, how });
  };
  if (step === 'white') {
    const sum = state.dice.w1 + state.dice.w2;
    for (const c of COLORS) add(c, sum, { w: null, sum });
  } else if (step === 'color') {
    if (state.players[state.active].id !== pid) return [];
    for (const c of COLORS) {
      if (state.dice[c] == null) continue;
      for (const w of ['w1', 'w2']) add(c, state.dice[w] + state.dice[c], { w: state.dice[w], c: state.dice[c], sum: state.dice[w] + state.dice[c] });
    }
  }
  return moves;
}

const nameOf = (state, pid) => state.players.find((p) => p.id === pid).name;

function startStep(state) {
  state.picks = {};
  state.auto = {};
  const ids = state.phase === 'white' ? state.players.map((p) => p.id) : [state.players[state.active].id];
  for (const id of ids) {
    if (legalMoves(state, id, state.phase).length === 0) {
      state.picks[id] = null;
      state.auto[id] = true;
    }
  }
  maybeResolve(state);
}

export function roll(state, pid, rng = Math.random) {
  if (state.phase !== 'roll') return { ok: false, error: 'Es kann gerade nicht gewürfelt werden.' };
  if (state.players[state.active].id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  state.dice = rollDice(state, rng);
  state.round += 1;
  state.rollId += 1;
  state.recap = [];
  state.turnCrosses = {};
  for (const p of state.players) state.turnCrosses[p.id] = 0;
  state.phase = 'white';
  startStep(state);
  return { ok: true };
}

export function submit(state, pid, move) {
  if (state.phase !== 'white' && state.phase !== 'color') return { ok: false, error: 'Gerade ist keine Auswahl nötig.' };
  if (!state.players.some((p) => p.id === pid)) return { ok: false, error: 'Unbekannter Spieler.' };
  if (pid in state.picks) return { ok: false, error: 'Du hast schon gewählt.' };
  if (state.phase === 'color' && state.players[state.active].id !== pid) return { ok: false, error: 'Nur der Spieler am Zug wählt jetzt.' };
  if (move) {
    const legal = legalMoves(state, pid).find((m) => m.color === move.color && m.idx === move.idx);
    if (!legal) return { ok: false, error: 'Dieser Zug ist nicht erlaubt.' };
    state.picks[pid] = { color: legal.color, idx: legal.idx, num: legal.num, how: legal.how };
  } else {
    state.picks[pid] = null;
  }
  maybeResolve(state);
  return { ok: true };
}

function pendingIds(state) {
  const ids = state.phase === 'white' ? state.players.map((p) => p.id) : [state.players[state.active].id];
  return ids.filter((id) => !(id in state.picks));
}
export const waitingFor = (state) => (state.phase === 'white' || state.phase === 'color' ? pendingIds(state) : []);

function maybeResolve(state) {
  if (pendingIds(state).length > 0) return;
  // Alle Wahlen gegen den Zustand VOR dem Schritt prüfen und gleichzeitig anwenden.
  const locked = new Set();
  const stepName = state.phase === 'white' ? 'Schritt 1' : 'Schritt 2';
  for (const p of state.players) {
    if (!(p.id in state.picks)) continue;
    const mv = state.picks[p.id];
    if (!mv) {
      if (state.phase === 'white' || p.id === state.players[state.active].id) {
        state.recap.push(`${p.name}: ${stepName} – nichts angekreuzt${state.auto[p.id] ? ' (keine Möglichkeit)' : ''}`);
      }
      continue;
    }
    const row = p.rows[mv.color];
    row.marks[mv.idx] = true;
    state.turnCrosses[p.id] += 1;
    let text = `${p.name}: ${COLOR_NAMES[mv.color]} ${mv.num} angekreuzt`;
    if (mv.idx === ROW_LEN - 1) {
      row.lock = true;
      locked.add(mv.color);
      text += ` und die Reihe ${COLOR_NAMES[mv.color]} gesperrt 🔒`;
    }
    state.recap.push(text);
  }
  for (const c of locked) state.closed[c] = true;

  const closedCount = COLORS.filter((c) => state.closed[c]).length;
  if (closedCount >= 2) return endGame(state, 'Zwei Reihen sind gesperrt.');

  if (state.phase === 'white') {
    state.phase = 'color';
    startStep(state);
    return;
  }
  // Ende der Runde: Fehlwurf für den Spieler am Zug, wenn er gar nichts angekreuzt hat.
  const act = state.players[state.active];
  if (state.turnCrosses[act.id] === 0) {
    act.penalties += 1;
    state.recap.push(`${act.name}: Fehlwurf (−${PENALTY} Punkte)`);
    if (act.penalties >= MAX_PENALTIES) return endGame(state, `${act.name} hat den vierten Fehlwurf.`);
  }
  state.active = (state.active + 1) % state.players.length;
  state.phase = 'roll';
  state.picks = {};
  state.auto = {};
}

function endGame(state, reason) {
  state.phase = 'over';
  state.endReason = reason;
  state.picks = {};
  state.auto = {};
}

export function ranking(state) {
  return state.players
    .map((p) => ({ id: p.id, name: p.name, ...scoreOf(p), penalties: p.penalties }))
    .sort((a, b) => b.total - a.total);
}
