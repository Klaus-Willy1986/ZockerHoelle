// Bauernschach – reine Spiellogik, keine Oberfläche, kein Netzwerk.
// Brett: 64 Felder, Index = Reihe * 8 + Spalte. Feld 0 = a1 (unten links aus Sicht von Weiß), Feld 63 = h8.
// Reihe 1 hat den Index 0..7, Reihe 8 den Index 56..63. Weiß zieht "aufwärts" (Reihe wächst), Schwarz "abwärts".
// Inhalt: 0 leer, 1 weißer Bauer, 2 schwarzer Bauer. Farbe: 0 = Weiß (beginnt), 1 = Schwarz.
// Jede Person hat nur 8 Bauern, es gibt keine Umwandlung.
// Sieg: Bauer erreicht die gegnerische Grundreihe, ODER alle gegnerischen Bauern sind geschlagen,
// ODER die Gegenseite kann nicht ziehen (wer am Zug ist und nicht ziehen kann, verliert).
// Mehrere Runden: Punktestand (Sieg = 1 Punkt) bleibt im Zustand, in jeder neuen Runde wechseln die Farben.
// Optionen: opts.enpassant (Standard an), opts.mustCapture ("Schlagzwang", Standard aus).

export const COLOR_NAMES = ['Weiß', 'Schwarz'];
export const other = (c) => 1 - c;
export const fileOf = (i) => i & 7;
export const rankOf = (i) => i >> 3; // 0..7 (Reihe 1..8)
export const sqName = (i) => String.fromCharCode(97 + fileOf(i)) + (rankOf(i) + 1);
export const sq = (name) => (Number(name[1]) - 1) * 8 + (name.charCodeAt(0) - 97);
export const dirOf = (color) => (color === 0 ? 1 : -1);
export const startRank = (color) => (color === 0 ? 1 : 6);
export const goalRank = (color) => (color === 0 ? 7 : 0);

export const KIND_STEP = 0;
export const KIND_DOUBLE = 1;
export const KIND_CAPTURE = 2;
export const KIND_EP = 3;
const KIND_NAMES = ['step', 'double', 'capture', 'ep'];

export function startBoard() {
  const b = Array(64).fill(0);
  for (let f = 0; f < 8; f++) { b[8 + f] = 1; b[48 + f] = 2; }
  return b;
}

export const normOpts = (o) => {
  const x = o && typeof o === 'object' ? o : {};
  return { enpassant: x.enpassant === undefined ? true : !!x.enpassant, mustCapture: !!x.mustCapture };
};

// Zugerzeugung auf einem Brett. Ein Zug ist eine Zahl: from | (to << 6) | (kind << 12).
// ep = Feld, das beim letzten Doppelschritt übersprungen wurde (oder -1). Rückgabe: Liste von Zahlen.
export function genMoves(board, color, ep, opts) {
  const piece = color + 1;
  const foe = 2 - color;
  const dir = dirOf(color);
  const d8 = dir * 8;
  const sr = startRank(color);
  const quiet = [];
  const caps = [];
  for (let from = 0; from < 64; from++) {
    if (board[from] !== piece) continue;
    const r = from >> 3;
    const f = from & 7;
    const nr = r + dir;
    if (nr < 0 || nr > 7) continue;
    const one = from + d8;
    if (board[one] === 0) {
      quiet.push(from | (one << 6));
      if (r === sr && board[one + d8] === 0) quiet.push(from | ((one + d8) << 6) | (KIND_DOUBLE << 12));
    }
    if (f > 0) {
      const t = one - 1;
      if (board[t] === foe) caps.push(from | (t << 6) | (KIND_CAPTURE << 12));
      else if (opts.enpassant && t === ep && board[t] === 0) caps.push(from | (t << 6) | (KIND_EP << 12));
    }
    if (f < 7) {
      const t = one + 1;
      if (board[t] === foe) caps.push(from | (t << 6) | (KIND_CAPTURE << 12));
      else if (opts.enpassant && t === ep && board[t] === 0) caps.push(from | (t << 6) | (KIND_EP << 12));
    }
  }
  if (opts.mustCapture && caps.length) return caps;
  return caps.concat(quiet);
}
export const mFrom = (m) => m & 63;
export const mTo = (m) => (m >> 6) & 63;
export const mKind = (m) => m >> 12;

// Zug auf dem Brett ausführen (verändert board). Gibt das neue ep-Feld zurück (-1 = keins).
export function applyMove(board, m, color) {
  const from = m & 63;
  const to = (m >> 6) & 63;
  const kind = m >> 12;
  board[from] = 0;
  board[to] = color + 1;
  if (kind === KIND_EP) board[to - dirOf(color) * 8] = 0;
  return kind === KIND_DOUBLE ? (from + to) >> 1 : -1;
}

export const countPawns = (board, color) => {
  let n = 0;
  for (let i = 0; i < 64; i++) if (board[i] === color + 1) n++;
  return n;
};
export const reachedGoal = (board, color) => {
  const base = goalRank(color) * 8;
  for (let f = 0; f < 8; f++) if (board[base + f] === color + 1) return true;
  return false;
};

const obj = (m) => ({ from: m & 63, to: (m >> 6) & 63, kind: KIND_NAMES[m >> 12], capture: (m >> 12) >= KIND_CAPTURE });

export function legalMoves(g) {
  if (!g || g.mode !== 'play') return [];
  return genMoves(g.board, g.turn, g.ep ? g.ep.to : -1, g.opts).map(obj);
}
export const mustCaptureNow = (g) => !!g && g.opts.mustCapture && legalMoves(g).some((m) => m.capture);

export const colorOf = (g, pid) => {
  const i = g.players.findIndex((p) => p.id === pid);
  return i < 0 ? -1 : (i === g.white ? 0 : 1);
};
export const playerOfColor = (g, color) => (color === 0 ? g.white : 1 - g.white);

// rng wird für die Regeln nicht gebraucht (kein Zufall, keine verdeckte Information).
export function createGame(playerList, opts = {}, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(playerList) || playerList.length !== 2) throw new Error('Bauernschach braucht genau 2 Personen.');
  return {
    game: 'bs',
    mode: 'play', // 'play' | 'over' (Ende der laufenden Runde)
    players: playerList.map((p) => ({ id: p.id, name: p.name })),
    opts: normOpts(opts),
    white: 0, // Index der Person, die in dieser Runde Weiß spielt
    board: startBoard(),
    turn: 0, // Farbe am Zug
    moveNo: 0,
    ep: null, // { to, pawn }: Doppelschritt eben gespielt, nur im nächsten Zug schlagbar
    last: null, // { by, from, to, kind }
    round: 1,
    scores: [0, 0], // pro Person (Index in players)
    winner: null, // Index der Person (nur bei mode 'over')
    endCode: null, // 'goal' | 'all' | 'blocked'
    endReason: null,
    recap: [],
  };
}

const nameOfColor = (g, c) => g.players[playerOfColor(g, c)].name;
export const pointsText = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

// Kurzer Satz zum letzten Zug, auch zum Vorlesen: "Weiß zieht e2 nach e4."
export function moveText(last) {
  if (!last) return '';
  const w = COLOR_NAMES[last.by];
  const a = sqName(last.from);
  const b = sqName(last.to);
  if (last.kind === 'ep') return `${w} schlägt im Vorbeigehen: ${a} nach ${b}.`;
  if (last.kind === 'capture') return `${w} schlägt: ${a} nach ${b}.`;
  return `${w} zieht ${a} nach ${b}.`;
}

export function move(g, pid, from, to) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const me = colorOf(g, pid);
  if (me < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== me) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) {
    return { ok: false, error: 'Dieser Zug ist nicht gültig.' };
  }
  const list = genMoves(g.board, me, g.ep ? g.ep.to : -1, g.opts);
  const m = list.find((x) => (x & 63) === from && ((x >> 6) & 63) === to);
  if (m === undefined) {
    const forced = g.opts.mustCapture && list.some((x) => (x >> 12) >= KIND_CAPTURE);
    return { ok: false, error: forced ? 'Schlagzwang: Du musst einen Bauern schlagen.' : 'Dieser Zug ist nicht erlaubt.' };
  }
  const kind = m >> 12;
  const nep = applyMove(g.board, m, me);
  g.ep = nep >= 0 && g.opts.enpassant ? { to: nep, pawn: to } : null;
  g.last = { by: me, from, to, kind: KIND_NAMES[kind] };
  g.moveNo += 1;
  g.recap = [moveText(g.last)];
  const foe = other(me);
  const name = nameOfColor(g, me);
  const foeName = nameOfColor(g, foe);
  g.turn = foe;
  let endCode = null;
  let reason = '';
  if (reachedGoal(g.board, me)) {
    endCode = 'goal';
    reason = `${name} (${COLOR_NAMES[me]}) hat die Grundreihe der Gegenseite erreicht.`;
  } else if (countPawns(g.board, foe) === 0) {
    endCode = 'all';
    reason = `${name} hat alle Bauern von ${foeName} geschlagen.`;
  } else if (genMoves(g.board, foe, g.ep ? g.ep.to : -1, g.opts).length === 0) {
    endCode = 'blocked';
    reason = `${foeName} kann nicht mehr ziehen. Wer nicht ziehen kann, verliert.`;
  }
  if (endCode) {
    const wi = playerOfColor(g, me);
    g.mode = 'over';
    g.winner = wi;
    g.endCode = endCode;
    g.endReason = reason;
    g.scores[wi] += 1;
    g.ep = null;
    g.recap.push(`${name} hat gewonnen und bekommt einen Punkt.`);
  }
  return { ok: true };
}

// Nächste Runde: Startaufstellung, Punktestand bleibt, die Farben wechseln (Weiß beginnt wieder).
export function nextRound(g) {
  if (!g || g.mode !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.white = 1 - g.white;
  g.board = startBoard();
  g.turn = 0;
  g.moveNo = 0;
  g.ep = null;
  g.last = null;
  g.round += 1;
  g.mode = 'play';
  g.winner = null;
  g.endCode = null;
  g.endReason = null;
  g.recap = [`Runde ${g.round}: ${nameOfColor(g, 0)} spielt Weiß und beginnt.`];
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
export function handle(g, pid, msg, rng = Math.random) { // eslint-disable-line no-unused-vars
  try {
    if (!g || !msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
    switch (msg.t) {
      case 'move': return move(g, pid, msg.from, msg.to);
      case 'next': return g.players && g.players.some((x) => x.id === pid) ? nextRound(g) : { ok: false, error: 'Du spielst hier nicht mit.' };
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch {
    return { ok: false, error: 'Ungültige Nachricht.' };
  }
}
