// Dame (deutsche Regeln, 8x8) – reine Spiellogik, keine Oberfläche, kein Netzwerk.
// Brett: 64 Felder, Index = Reihe * 8 + Spalte. Reihe 0 ist OBEN (Seite von Schwarz), Reihe 7 UNTEN (Seite von Weiß).
// Nur die dunklen Felder ((Reihe + Spalte) ungerade) werden benutzt.
// Steine: 0 leer, 1 weißer Stein, 2 weiße Dame, 3 schwarzer Stein, 4 schwarze Dame.
// Spielerinnen/Spieler: Index 0 = Weiß (beginnt), Index 1 = Schwarz.

export const SIZE = 8;
export const NO_PROGRESS_LIMIT = 40; // Züge ohne Schlagen und ohne Zug eines normalen Steins
export const REPEAT_LIMIT = 3;
export const COLOR_NAMES = ['Weiß', 'Schwarz'];

export const rowOf = (i) => i >> 3;
export const colOf = (i) => i & 7;
export const isDark = (i) => ((rowOf(i) + colOf(i)) & 1) === 1;
const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const ownerOf = (p) => (p === 0 ? -1 : p <= 2 ? 0 : 1);
export const isDame = (p) => p === 2 || p === 4;
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const fwd = (who) => (who === 0 ? -1 : 1);
const promoRow = (who) => (who === 0 ? 0 : 7);

// "a1" = unten links (Weiß-Seite), "h8" = oben rechts
export const sq = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
export const sqName = (i) => String.fromCharCode(97 + colOf(i)) + (8 - rowOf(i));

export function startBoard() {
  const b = Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    if (!isDark(i)) continue;
    if (rowOf(i) <= 2) b[i] = 3;
    else if (rowOf(i) >= 5) b[i] = 1;
  }
  return b;
}

// ---------- Zugerzeugung ----------
// Mögliche Sprünge von pos aus. b: Brett (der ziehende Stein steht NICHT darauf), removed: schon übersprungene Felder
// (diese Steine bleiben bis Zugende liegen: sie blockieren und dürfen nicht noch einmal übersprungen werden).
function jumpsFrom(b, pos, dame, who, removed) {
  const out = [];
  const r0 = rowOf(pos);
  const c0 = colOf(pos);
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    if (dame) while (inb(r, c) && b[r * 8 + c] === 0) { r += dr; c += dc; }
    if (!inb(r, c)) continue;
    const o = r * 8 + c;
    const p = b[o];
    if (p === 0 || ownerOf(p) === who || removed.includes(o)) continue;
    let lr = r + dr;
    let lc = c + dc;
    while (inb(lr, lc) && b[lr * 8 + lc] === 0) {
      out.push({ over: o, land: lr * 8 + lc });
      if (!dame) break;
      lr += dr; lc += dc;
    }
  }
  return out;
}

// Alle vollständigen Schlagfolgen eines Steins. Jede: { path: [von, landung1, landung2 …], caps: [übersprungene Felder in Reihenfolge] }
export function captureSeqs(board, from) {
  const piece = board[from];
  const who = ownerOf(piece);
  const dame = isDame(piece);
  const b = board.slice();
  b[from] = 0;
  const results = [];
  const dfs = (pos, path, caps) => {
    let jumps = jumpsFrom(b, pos, dame, who, caps);
    if (!jumps.length) {
      if (path.length > 1) results.push({ from, path, caps });
      return;
    }
    if (dame) {
      // Eine Dame muss, wenn möglich, auf einem Feld landen, von dem aus sie weiterschlagen kann.
      const keep = [];
      const byOver = new Map();
      for (const j of jumps) { if (!byOver.has(j.over)) byOver.set(j.over, []); byOver.get(j.over).push(j); }
      for (const [over, list] of byOver) {
        const cont = list.filter((j) => jumpsFrom(b, j.land, true, who, [...caps, over]).length > 0);
        keep.push(...(cont.length ? cont : list));
      }
      jumps = keep;
    }
    for (const j of jumps) dfs(j.land, [...path, j.land], [...caps, j.over]);
  };
  dfs(from, [from], []);
  return results;
}

function simpleMoves(board, from) {
  const piece = board[from];
  const who = ownerOf(piece);
  const dame = isDame(piece);
  const out = [];
  for (const [dr, dc] of DIRS) {
    if (!dame && dr !== fwd(who)) continue;
    let r = rowOf(from) + dr;
    let c = colOf(from) + dc;
    while (inb(r, c) && board[r * 8 + c] === 0) {
      out.push({ from, path: [from, r * 8 + c], caps: [] });
      if (!dame) break;
      r += dr; c += dc;
    }
  }
  return out;
}

// Alle erlaubten Züge der Person, die am Zug ist (bei Schlagzwang nur Schlagzüge).
export function legalMovesFor(board, who) {
  const caps = [];
  const simple = [];
  for (let i = 0; i < 64; i++) {
    if (ownerOf(board[i]) !== who) continue;
    caps.push(...captureSeqs(board, i));
  }
  if (caps.length) return caps;
  for (let i = 0; i < 64; i++) {
    if (ownerOf(board[i]) === who) simple.push(...simpleMoves(board, i));
  }
  return simple;
}
export const legalMoves = (state) => (state.mode === 'over' ? [] : legalMovesFor(state.board, state.turn));
export const mustCapture = (state) => legalMoves(state).some((m) => m.caps.length > 0);

export const countPieces = (board, who) => board.filter((p) => ownerOf(p) === who && p !== 0).length;
const posKey = (board, turn) => board.join('') + turn;

// ---------- Spielstand ----------
export function createGame(playerList) {
  if (!Array.isArray(playerList) || playerList.length !== 2) throw new Error('Dame braucht genau 2 Personen.');
  const board = startBoard();
  return {
    game: 'dame',
    mode: 'normal', // 'normal' | 'over'
    players: playerList.map((p) => ({ id: p.id, name: p.name })),
    board,
    turn: 0,
    moveNo: 0,
    captured: [0, 0], // von Weiß / von Schwarz geschlagene Steine
    noProgress: 0,
    history: { [posKey(board, 0)]: 1 },
    drawOffer: null, // Index der Person, die Remis angeboten hat
    offerBlock: [-1, -1], // nach Ablehnung: erst nach einem eigenen weiteren Zug wieder anbieten
    last: null, // { by, path, caps, promoted }
    recap: [],
    winner: null, // 0 | 1 | 'draw'
    endKind: null,
    endReason: null,
  };
}

export const playerIndex = (state, pid) => state.players.findIndex((p) => p.id === pid);

function finish(state, winner, kind, reason) {
  state.mode = 'over';
  state.winner = winner;
  state.endKind = kind;
  state.endReason = reason;
  state.drawOffer = null;
}

const plural = (n) => (n === 1 ? 'einen Stein' : `${n} Steine`);

export function move(state, pid, path) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const me = playerIndex(state, pid);
  if (me < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (state.turn !== me) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!Array.isArray(path) || path.length < 2 || path.length > 40 || !path.every((x) => Number.isInteger(x) && x >= 0 && x < 64)) {
    return { ok: false, error: 'Dieser Zug ist nicht gültig.' };
  }
  const legal = legalMoves(state);
  const m = legal.find((x) => x.path.length === path.length && x.path.every((v, i) => v === path[i]));
  if (!m) {
    const forced = legal.some((x) => x.caps.length > 0);
    return { ok: false, error: forced ? 'Du musst schlagen – und einen begonnenen Mehrfachsprung zu Ende führen.' : 'Dieser Zug ist nicht erlaubt.' };
  }

  const board = state.board;
  const name = state.players[me].name;
  const piece = board[m.from];
  const wasMan = !isDame(piece);
  board[m.from] = 0;
  for (const c of m.caps) board[c] = 0;
  const end = m.path[m.path.length - 1];
  let promoted = false;
  let placed = piece;
  if (wasMan && rowOf(end) === promoRow(me)) { placed = me === 0 ? 2 : 4; promoted = true; }
  board[end] = placed;

  state.captured[me] += m.caps.length;
  state.noProgress = m.caps.length > 0 || wasMan ? 0 : state.noProgress + 1;
  state.last = { by: me, path: m.path.slice(), caps: m.caps.slice(), promoted };
  state.recap = [m.caps.length ? `${name} hat ${plural(m.caps.length)} geschlagen.` : `${name} hat gezogen.`];
  if (promoted) state.recap.push(`${name} hat eine Dame bekommen.`);
  if (state.drawOffer !== null && state.drawOffer !== me) {
    state.recap.push(`${name} hat das Remis-Angebot nicht angenommen.`);
    state.offerBlock[state.drawOffer] = state.moveNo;
    state.drawOffer = null;
  }
  state.moveNo += 1;
  state.turn = 1 - me;

  const key = posKey(board, state.turn);
  state.history[key] = (state.history[key] || 0) + 1;

  const opp = state.players[1 - me].name;
  if (countPieces(board, 1 - me) === 0) {
    finish(state, me, 'win', `${name} hat alle Steine von ${opp} geschlagen.`);
  } else if (legalMovesFor(board, 1 - me).length === 0) {
    finish(state, me, 'win', `${opp} kann nicht mehr ziehen – alle Steine sind blockiert.`);
  } else if (state.history[key] >= REPEAT_LIMIT) {
    finish(state, 'draw', 'draw', 'Remis: Dieselbe Stellung ist zum dritten Mal entstanden.');
  } else if (state.noProgress >= NO_PROGRESS_LIMIT) {
    finish(state, 'draw', 'draw', `Remis: ${NO_PROGRESS_LIMIT} Züge in Folge ohne Schlagen und ohne Zug eines normalen Steins.`);
  }
  return { ok: true };
}

export function resign(state, pid) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const me = playerIndex(state, pid);
  if (me < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  state.recap = [];
  finish(state, 1 - me, 'resign', `${state.players[me].name} hat aufgegeben.`);
  return { ok: true };
}

// Nach einer Ablehnung darf erst nach einer weiteren Runde (2 Zügen) wieder Remis angeboten werden.
export const canOfferDraw = (state, me) => state.mode === 'normal' && state.drawOffer === null
  && !(state.offerBlock[me] >= 0 && state.moveNo <= state.offerBlock[me] + 1);

export function drawOffer(state, pid) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const me = playerIndex(state, pid);
  if (me < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (state.drawOffer !== null) return { ok: false, error: 'Es gibt schon ein Remis-Angebot.' };
  if (!canOfferDraw(state, me)) return { ok: false, error: 'Bitte spielt erst noch eine Runde weiter, bevor du wieder Remis anbietest.' };
  state.drawOffer = me;
  return { ok: true };
}

export function drawAnswer(state, pid, accept) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const me = playerIndex(state, pid);
  if (me < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (state.drawOffer === null) return { ok: false, error: 'Es gibt kein Remis-Angebot.' };
  if (state.drawOffer === me) return { ok: false, error: 'Du kannst dein eigenes Angebot nicht annehmen.' };
  if (accept) {
    finish(state, 'draw', 'draw', 'Remis: Beide haben sich auf ein Unentschieden geeinigt.');
  } else {
    state.offerBlock[state.drawOffer] = state.moveNo;
    state.recap = [`${state.players[me].name} hat das Remis-Angebot abgelehnt.`];
    state.drawOffer = null;
  }
  return { ok: true };
}

export function drawCancel(state, pid) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const me = playerIndex(state, pid);
  if (state.drawOffer === null || state.drawOffer !== me) return { ok: false, error: 'Du hast kein Remis angeboten.' };
  state.drawOffer = null;
  return { ok: true };
}

// Einstieg für Nachrichten aus dem Netz. Verändert den Zustand nur bei gültigen Nachrichten.
export function handle(state, pid, msg) {
  if (!state || !msg || typeof msg !== 'object') return { ok: false, error: 'Unbekannte Nachricht.' };
  switch (msg.t) {
    case 'move': return move(state, pid, msg.path);
    case 'resign': return resign(state, pid);
    case 'draw-offer': return drawOffer(state, pid);
    case 'draw-accept': return drawAnswer(state, pid, true);
    case 'draw-decline': return drawAnswer(state, pid, false);
    case 'draw-cancel': return drawCancel(state, pid);
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}
