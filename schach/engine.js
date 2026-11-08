// Schach – reine Spiellogik, keine Oberfläche, kein Netzwerk.
// Brett: 64 Felder, Index = Reihe * 8 + Spalte. Feld 0 = a1, Feld 63 = h8.
// Figurencodes: 0 leer; Weiß 1..6 = Bauer, Springer, Läufer, Turm, Dame, König; Schwarz 7..12 (gleiche Reihenfolge).
// Farbe: 0 = Weiß (beginnt), 1 = Schwarz. Jeder Zustand ist reines JSON.
// Zustand: board, turn, castling ("KQkq" oder "-"), ep (Feld hinter einem Doppelschritt oder -1), halfmove, fullmove,
//   positions ({Stellungsschlüssel: Anzahl} für die Dreifachstellung), result ({winner: 0|1|'draw', reason, text} oder null).
// Wertung: Sieg = 2 Punkte, Remis = 1 Punkt für jede Person (entspricht 1 / 0,5).
// Ein Zug ist intern eine Zahl: from | to << 6 | promo << 12 | flag << 15 (flag: 1 Doppelschritt, 2 en passant, 3 kurze, 4 lange Rochade).

export const COLOR_NAMES = ['Weiß', 'Schwarz'];
export const PAWN = 1; export const KNIGHT = 2; export const BISHOP = 3; export const ROOK = 4; export const QUEEN = 5; export const KING = 6;
export const TYPE_NAMES = ['', 'Bauer', 'Springer', 'Läufer', 'Turm', 'Dame', 'König'];
export const typeOf = (p) => (p > 6 ? p - 6 : p);
export const pieceColor = (p) => (p > 6 ? 1 : 0);
export const pieceOf = (type, color) => type + (color ? 6 : 0);
export const fileOf = (i) => i & 7;
export const rankOf = (i) => i >> 3;
export const sqName = (i) => String.fromCharCode(97 + (i & 7)) + ((i >> 3) + 1);
export const sq = (name) => (Number(name[1]) - 1) * 8 + (name.charCodeAt(0) - 97);
const FEN_CHARS = ' PNBRQKpnbrqk';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMO_LETTER = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };
const PROMO_TYPE = { n: 2, b: 3, r: 4, q: 5 };
const FL_DOUBLE = 1; const FL_EP = 2; const FL_CK = 3; const FL_CQ = 4;

export const mFrom = (m) => m & 63;
export const mTo = (m) => (m >> 6) & 63;
export const mPromo = (m) => (m >> 12) & 7;
export const mFlag = (m) => m >> 15;

// ---------- Tabellen ----------
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
export const KN = []; export const KG = []; export const RAY = [];
for (let s = 0; s < 64; s++) {
  const f = s & 7; const r = s >> 3;
  KN.push([[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].map(([a, b]) => [f + a, r + b]).filter(([a, b]) => a >= 0 && a < 8 && b >= 0 && b < 8).map(([a, b]) => b * 8 + a));
  KG.push(DIRS.map(([a, b]) => [f + a, r + b]).filter(([a, b]) => a >= 0 && a < 8 && b >= 0 && b < 8).map(([a, b]) => b * 8 + a));
  RAY.push(DIRS.map(([a, b]) => { const out = []; let x = f + a; let y = r + b; while (x >= 0 && x < 8 && y >= 0 && y < 8) { out.push(y * 8 + x); x += a; y += b; } return out; }));
}
const CM = new Array(64).fill(15);
CM[0] = 15 & ~2; CM[7] = 15 & ~1; CM[4] = 15 & ~3; CM[56] = 15 & ~8; CM[63] = 15 & ~4; CM[60] = 15 & ~12;

// ---------- Stellung (veränderbar, für Suche und Regeln) ----------
export function startBoard() {
  const b = new Array(64).fill(0);
  const back = [4, 2, 3, 5, 6, 3, 2, 4];
  for (let f = 0; f < 8; f++) { b[f] = back[f]; b[8 + f] = 1; b[48 + f] = 7; b[56 + f] = back[f] + 6; }
  return b;
}
const castlingMask = (s) => (typeof s === 'string' ? (s.includes('K') ? 1 : 0) | (s.includes('Q') ? 2 : 0) | (s.includes('k') ? 4 : 0) | (s.includes('q') ? 8 : 0) : 0);
const castlingStr = (m) => ((m & 1 ? 'K' : '') + (m & 2 ? 'Q' : '') + (m & 4 ? 'k' : '') + (m & 8 ? 'q' : '')) || '-';

export function posOf(g) {
  const board = Int8Array.from(g.board);
  const king = [board.indexOf(6), board.indexOf(12)];
  return { board, turn: g.turn, castling: castlingMask(g.castling), ep: Number.isInteger(g.ep) ? g.ep : -1, halfmove: g.halfmove | 0, king, queenOnly: false };
}

// Wird das Feld s von Farbe `by` angegriffen?
export function attacked(pos, s, by) {
  const b = pos.board; const f = s & 7; const r = s >> 3;
  if (by === 0) {
    if (r > 0) { if (f > 0 && b[s - 9] === 1) return true; if (f < 7 && b[s - 7] === 1) return true; }
  } else if (r < 7) { if (f > 0 && b[s + 7] === 7) return true; if (f < 7 && b[s + 9] === 7) return true; }
  const o = by ? 6 : 0;
  const kn = KN[s]; for (let i = 0; i < kn.length; i++) if (b[kn[i]] === 2 + o) return true;
  const kg = KG[s]; for (let i = 0; i < kg.length; i++) if (b[kg[i]] === 6 + o) return true;
  const rays = RAY[s];
  for (let d = 0; d < 8; d++) {
    const ray = rays[d];
    for (let i = 0; i < ray.length; i++) {
      const p = b[ray[i]];
      if (p === 0) continue;
      if (p === 5 + o || p === (d < 4 ? 4 : 3) + o) return true;
      break;
    }
  }
  return false;
}

// Pseudo-legale Züge der Seite am Zug in `out` sammeln. caps = nur Schlagzüge und Umwandlungen (für die Ruhesuche).
export function genPseudo(pos, out, caps = false) {
  const b = pos.board; const c = pos.turn; const off = c ? 6 : 0;
  const dir = c ? -1 : 1; const promoRank = c ? 0 : 7; const startRank = c ? 6 : 1;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (p === 0 || (p > 6 ? 1 : 0) !== c) continue;
    const t = p - off;
    if (t === 1) {
      const r = s >> 3; const f = s & 7; const one = s + 8 * dir;
      if (b[one] === 0) {
        if ((one >> 3) === promoRank) {
          out.push(s | (one << 6) | (5 << 12));
          if (!pos.queenOnly) out.push(s | (one << 6) | (4 << 12), s | (one << 6) | (3 << 12), s | (one << 6) | (2 << 12));
        } else if (!caps) {
          out.push(s | (one << 6));
          if (r === startRank && b[one + 8 * dir] === 0) out.push(s | ((one + 8 * dir) << 6) | (FL_DOUBLE << 15));
        }
      }
      for (let k = -1; k <= 1; k += 2) {
        const nf = f + k; if (nf < 0 || nf > 7) continue;
        const to = one + k; const q = b[to];
        if (q !== 0 && (q > 6 ? 1 : 0) !== c) {
          if ((to >> 3) === promoRank) {
            out.push(s | (to << 6) | (5 << 12));
            if (!pos.queenOnly) out.push(s | (to << 6) | (4 << 12), s | (to << 6) | (3 << 12), s | (to << 6) | (2 << 12));
          } else out.push(s | (to << 6));
        } else if (q === 0 && to === pos.ep) out.push(s | (to << 6) | (FL_EP << 15));
      }
    } else if (t === 2 || t === 6) {
      const list = t === 2 ? KN[s] : KG[s];
      for (let i = 0; i < list.length; i++) {
        const to = list[i]; const q = b[to];
        if (q === 0) { if (!caps) out.push(s | (to << 6)); } else if ((q > 6 ? 1 : 0) !== c) out.push(s | (to << 6));
      }
      if (t === 6 && !caps) {
        if (c === 0 && s === 4) {
          if ((pos.castling & 1) && b[5] === 0 && b[6] === 0 && b[7] === 4 && !attacked(pos, 4, 1) && !attacked(pos, 5, 1)) out.push(4 | (6 << 6) | (FL_CK << 15));
          if ((pos.castling & 2) && b[3] === 0 && b[2] === 0 && b[1] === 0 && b[0] === 4 && !attacked(pos, 4, 1) && !attacked(pos, 3, 1)) out.push(4 | (2 << 6) | (FL_CQ << 15));
        } else if (c === 1 && s === 60) {
          if ((pos.castling & 4) && b[61] === 0 && b[62] === 0 && b[63] === 10 && !attacked(pos, 60, 0) && !attacked(pos, 61, 0)) out.push(60 | (62 << 6) | (FL_CK << 15));
          if ((pos.castling & 8) && b[59] === 0 && b[58] === 0 && b[57] === 0 && b[56] === 10 && !attacked(pos, 60, 0) && !attacked(pos, 59, 0)) out.push(60 | (58 << 6) | (FL_CQ << 15));
        }
      }
    } else {
      const d0 = t === 4 ? 0 : t === 3 ? 4 : 0; const d1 = t === 4 ? 4 : t === 3 ? 8 : 8;
      const rays = RAY[s];
      for (let d = d0; d < d1; d++) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const to = ray[i]; const q = b[to];
          if (q === 0) { if (!caps) out.push(s | (to << 6)); continue; }
          if ((q > 6 ? 1 : 0) !== c) out.push(s | (to << 6));
          break;
        }
      }
    }
  }
  return out;
}

// Zug ausführen; liefert die Rücknahme-Information (Zahl) für unmake.
export function make(pos, m) {
  const from = m & 63; const to = (m >> 6) & 63; const pr = (m >> 12) & 7; const fl = m >> 15;
  const b = pos.board; const p = b[from]; const c = pos.turn;
  const cap = b[to];
  const u = cap | (pos.castling << 4) | ((pos.ep + 1) << 8) | (pos.halfmove << 15);
  b[to] = pr ? pr + (c ? 6 : 0) : p;
  b[from] = 0;
  if (fl === FL_EP) b[c ? to + 8 : to - 8] = 0;
  else if (fl === FL_CK) { b[c ? 61 : 5] = b[c ? 63 : 7]; b[c ? 63 : 7] = 0; } else if (fl === FL_CQ) { b[c ? 59 : 3] = b[c ? 56 : 0]; b[c ? 56 : 0] = 0; }
  if (p === 6 || p === 12) pos.king[c] = to;
  pos.castling &= CM[from] & CM[to];
  pos.ep = fl === FL_DOUBLE ? (from + to) >> 1 : -1;
  pos.halfmove = (p === 1 || p === 7 || cap !== 0) ? 0 : pos.halfmove + 1;
  pos.turn = c ^ 1;
  return u;
}
export function unmake(pos, m, u) {
  const from = m & 63; const to = (m >> 6) & 63; const pr = (m >> 12) & 7; const fl = m >> 15;
  pos.turn ^= 1;
  const c = pos.turn; const b = pos.board;
  const p = pr ? (c ? 7 : 1) : b[to];
  b[from] = p;
  b[to] = u & 15;
  if (fl === FL_EP) b[c ? to + 8 : to - 8] = c ? 1 : 7;
  else if (fl === FL_CK) { b[c ? 63 : 7] = b[c ? 61 : 5]; b[c ? 61 : 5] = 0; } else if (fl === FL_CQ) { b[c ? 56 : 0] = b[c ? 59 : 3]; b[c ? 59 : 3] = 0; }
  if (p === 6 || p === 12) pos.king[c] = from;
  pos.castling = (u >> 4) & 15;
  pos.ep = ((u >> 8) & 127) - 1;
  pos.halfmove = u >> 15;
}
export const inCheckPos = (pos, c = pos.turn) => attacked(pos, pos.king[c], c ^ 1);

export function legalInts(pos) {
  const ps = genPseudo(pos, []);
  const c = pos.turn; const out = [];
  for (let i = 0; i < ps.length; i++) {
    const m = ps[i];
    const u = make(pos, m);
    if (!attacked(pos, pos.king[c], c ^ 1)) out.push(m);
    unmake(pos, m, u);
  }
  return out;
}
export const hasLegal = (pos) => {
  const ps = genPseudo(pos, []); const c = pos.turn;
  for (let i = 0; i < ps.length; i++) {
    const u = make(pos, ps[i]);
    const ok = !attacked(pos, pos.king[c], c ^ 1);
    unmake(pos, ps[i], u);
    if (ok) return true;
  }
  return false;
};

// ---------- FEN ----------
function fenBoard(board) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = ''; let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f];
      if (!p) empty++; else { if (empty) { row += empty; empty = 0; } row += FEN_CHARS[p]; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}
export const fenOf = (g) => `${fenBoard(g.board)} ${g.turn ? 'b' : 'w'} ${g.castling || '-'} ${g.ep >= 0 ? sqName(g.ep) : '-'} ${g.halfmove | 0} ${g.fullmove | 0 || 1}`;

// FEN lesen: liefert { board, turn, castling, ep, halfmove, fullmove } oder null
export function parseFen(fen) {
  try {
    const parts = String(fen).trim().split(/\s+/);
    if (parts.length < 2) return null;
    const rows = parts[0].split('/');
    if (rows.length !== 8) return null;
    const board = new Array(64).fill(0);
    for (let i = 0; i < 8; i++) {
      const r = 7 - i; let f = 0;
      for (const ch of rows[i]) {
        if (/[1-8]/.test(ch)) f += Number(ch);
        else { const k = FEN_CHARS.indexOf(ch); if (k < 1) return null; if (f > 7) return null; board[r * 8 + f] = k; f++; }
      }
      if (f !== 8) return null;
    }
    if (board.filter((p) => p === 6).length !== 1 || board.filter((p) => p === 12).length !== 1) return null;
    if (board.some((p, i) => (p === 1 || p === 7) && (i < 8 || i > 55))) return null;
    const turn = parts[1] === 'b' ? 1 : parts[1] === 'w' ? 0 : -1;
    if (turn < 0) return null;
    let cm = castlingMask(parts[2] || '-');
    if (board[4] !== 6 || board[7] !== 4) cm &= ~1;
    if (board[4] !== 6 || board[0] !== 4) cm &= ~2;
    if (board[60] !== 12 || board[63] !== 10) cm &= ~4;
    if (board[60] !== 12 || board[56] !== 10) cm &= ~8;
    let ep = -1;
    if (parts[3] && /^[a-h][36]$/.test(parts[3])) {
      const e = sq(parts[3]);
      // nur sinnvoll, wenn dahinter wirklich ein gegnerischer Bauer steht
      if (turn === 0 && e >> 3 === 5 && board[e - 8] === 7 && board[e] === 0) ep = e;
      if (turn === 1 && e >> 3 === 2 && board[e + 8] === 1 && board[e] === 0) ep = e;
    }
    const halfmove = Math.max(0, parseInt(parts[4], 10) || 0);
    const fullmove = Math.max(1, parseInt(parts[5], 10) || 1);
    // der Gegner darf nicht im Schach stehen (sonst wäre die Stellung unmöglich)
    const pos = { board: Int8Array.from(board), turn, castling: cm, ep, halfmove, king: [board.indexOf(6), board.indexOf(12)] };
    if (attacked(pos, pos.king[turn ^ 1], turn)) return null;
    return { board, turn, castling: castlingStr(cm), ep, halfmove, fullmove };
  } catch { return null; }
}

// Stellungsschlüssel für die Dreifachstellung: Figuren, Seite am Zug, Rochaderechte, en passant nur wenn wirklich möglich.
export function keyOfPos(pos) {
  let epPart = '-';
  if (pos.ep >= 0) {
    const ms = legalInts(pos);
    if (ms.some((m) => mFlag(m) === FL_EP)) epPart = sqName(pos.ep);
  }
  return `${fenBoard(pos.board)} ${pos.turn ? 'b' : 'w'} ${castlingStr(pos.castling)} ${epPart}`;
}
export const keyOf = (g) => keyOfPos(posOf(g));

// Tote Stellung: nur Könige, König + Springer, König + Läufer(n) alle auf Feldern gleicher Farbe
export function isDead(board) {
  let knights = 0; const bishopSquares = [];
  for (let i = 0; i < 64; i++) {
    const t = typeOf(board[i]);
    if (!board[i] || t === 6) continue;
    if (t === 2) knights++;
    else if (t === 3) bishopSquares.push(((i >> 3) + (i & 7)) & 1);
    else return false;
  }
  if (knights === 0) return bishopSquares.every((x) => x === bishopSquares[0]);
  return knights === 1 && bishopSquares.length === 0;
}

// ---------- Perft (Prüfung der Regeln) ----------
function perftPos(pos, depth) {
  if (depth === 0) return 1;
  const ps = genPseudo(pos, []); const c = pos.turn; let n = 0;
  for (let i = 0; i < ps.length; i++) {
    const u = make(pos, ps[i]);
    if (!attacked(pos, pos.king[c], c ^ 1)) n += depth === 1 ? 1 : perftPos(pos, depth - 1);
    unmake(pos, ps[i], u);
  }
  return n;
}
export function perft(fenOrState, depth) {
  const st = typeof fenOrState === 'string' ? parseFen(fenOrState) : fenOrState;
  if (!st) throw new Error('Ungültige Stellung');
  return perftPos(posOf(st), depth);
}

// ---------- Zugbeschreibung (SAN, vorlesbarer Text) ----------
const GER_ACC = ['', 'den Bauern', 'den Springer', 'den Läufer', 'den Turm', 'die Dame', 'den König'];
const GER_DAT = ['', 'dem Bauern', 'dem Springer', 'dem Läufer', 'dem Turm', 'der Dame', 'dem König'];
const GER_TO = ['', '', 'zum Springer', 'zum Läufer', 'zum Turm', 'zur Dame', ''];
const SAN_LETTER = ' PNBRQK';

function describe(pos, m) {
  const from = m & 63; const to = (m >> 6) & 63; const fl = m >> 15;
  const p = pos.board[from];
  return { from, to, type: typeOf(p), color: pieceColor(p), cap: fl === FL_EP ? 1 : typeOf(pos.board[to]), promo: (m >> 12) & 7, fl };
}
const moveObj = (pos, m) => {
  const d = describe(pos, m);
  return { from: d.from, to: d.to, promo: d.promo ? PROMO_LETTER[d.promo] : undefined, piece: d.type, capture: d.cap > 0, castle: d.fl === FL_CK ? 'K' : d.fl === FL_CQ ? 'Q' : null, ep: d.fl === FL_EP };
};
// Zug als Zahl in der Zugliste suchen
function findInt(list, from, to, promo) {
  const pt = promo ? PROMO_TYPE[String(promo).toLowerCase()] || 0 : 0;
  return list.find((m) => (m & 63) === from && ((m >> 6) & 63) === to && (pt ? ((m >> 12) & 7) === pt : true));
}

function sanOfInt(pos, m, list) {
  const d = describe(pos, m);
  let s;
  if (d.fl === FL_CK) s = 'O-O';
  else if (d.fl === FL_CQ) s = 'O-O-O';
  else {
    const dest = sqName(d.to);
    if (d.type === 1) {
      s = (d.cap ? `${String.fromCharCode(97 + (d.from & 7))}x` : '') + dest;
      if (d.promo) s += `=${SAN_LETTER[d.promo]}`;
    } else {
      s = SAN_LETTER[d.type];
      const others = list.filter((x) => x !== m && ((x >> 6) & 63) === d.to && typeOf(pos.board[x & 63]) === d.type && (x & 63) !== d.from);
      if (others.length) {
        const sameFile = others.some((x) => (x & 7) === (d.from & 7));
        const sameRank = others.some((x) => ((x & 63) >> 3) === (d.from >> 3));
        if (!sameFile) s += String.fromCharCode(97 + (d.from & 7));
        else if (!sameRank) s += (d.from >> 3) + 1;
        else s += sqName(d.from);
      }
      s += (d.cap ? 'x' : '') + dest;
    }
  }
  const u = make(pos, m);
  const chk = inCheckPos(pos);
  const mate = chk && !hasLegal(pos);
  unmake(pos, m, u);
  return s + (mate ? '#' : chk ? '+' : '');
}
function textOfInt(pos, m) {
  const d = describe(pos, m);
  const C = COLOR_NAMES[d.color];
  const to = sqName(d.to);
  if (d.fl === FL_CK) return `${C} rochiert kurz.`;
  if (d.fl === FL_CQ) return `${C} rochiert lang.`;
  if (d.fl === FL_EP) return `${C} schlägt mit dem Bauern im Vorbeigehen auf ${to}.`;
  if (d.cap) return `${C} schlägt mit ${GER_DAT[d.type]} ${GER_ACC[d.cap]} auf ${to}.${d.promo ? ` Der Bauer wird ${GER_TO[d.promo]}.` : ''}`;
  if (d.promo) return `${C} zieht Bauer nach ${to}. Der Bauer wird ${GER_TO[d.promo]}.`;
  return `${C} zieht ${TYPE_NAMES[d.type]} nach ${to}.`;
}
function shortOfInt(pos, m) {
  const d = describe(pos, m);
  const to = sqName(d.to);
  if (d.fl === FL_CK) return 'Rochade kurz';
  if (d.fl === FL_CQ) return 'Rochade lang';
  if (d.fl === FL_EP) return `Bauer schlägt im Vorbeigehen auf ${to}`;
  const promo = d.promo ? ` und wird ${TYPE_NAMES[d.promo]}` : '';
  if (d.cap) return `${TYPE_NAMES[d.type]} schlägt auf ${to}${promo}`;
  return `${TYPE_NAMES[d.type]} nach ${to}${promo}`;
}
const toInt = (g, mv) => {
  const pos = posOf(g);
  const list = legalInts(pos);
  const m = mv && typeof mv === 'object' ? findInt(list, mv.from, mv.to, mv.promo) : undefined;
  return { pos, list, m };
};
// Zug (vor dem Ausführen!) als Standardnotation, z. B. "Nf3", "exd5", "O-O", "e8=Q+"
export function toSAN(g, mv) {
  const { pos, list, m } = toInt(g, mv);
  return m === undefined ? '' : sanOfInt(pos, m, list);
}
// Zug (vor dem Ausführen!) als vorlesbarer Satz: "Weiß zieht Springer nach f3."
export function moveText(g, mv) {
  const { pos, m } = toInt(g, mv);
  return m === undefined ? '' : textOfInt(pos, m);
}

// ---------- Abfragen für Oberfläche und Computer ----------
export function legalMoves(g) {
  if (!g || g.mode !== 'play' || !Array.isArray(g.board)) return [];
  const pos = posOf(g);
  return legalInts(pos).map((m) => moveObj(pos, m));
}
export function inCheck(g, color) {
  const pos = posOf(g);
  const c = color === undefined ? g.turn : color;
  return pos.king[c] >= 0 && inCheckPos(pos, c);
}
export const colorOfPlayer = (g, pid) => {
  const i = g.players.findIndex((p) => p.id === pid);
  return i < 0 ? -1 : (i === g.white ? 0 : 1);
};
export const playerOfColor = (g, color) => (color === 0 ? g.white : 1 - g.white);

// Warum geht dieser Zug nicht? (freundlicher Text)
export function whyIllegal(g, from, to) {
  const pos = posOf(g);
  const p = pos.board[from];
  if (!p || pieceColor(p) !== g.turn) return 'Dieser Zug ist nicht erlaubt.';
  const ps = genPseudo(pos, []);
  const hit = ps.some((m) => (m & 63) === from && ((m >> 6) & 63) === to);
  if (hit) return 'Dieser Zug ist nicht erlaubt: Dein König stünde im Schach.';
  if (typeOf(p) === 6 && (from >> 3) === (to >> 3) && Math.abs((from & 7) - (to & 7)) === 2) return 'Dieser Zug ist nicht erlaubt: Die Rochade geht jetzt nicht.';
  return 'Dieser Zug ist nicht erlaubt.';
}

// ---------- Spielzustand ----------
export const normOpts = (o) => {
  const x = o && typeof o === 'object' ? o : {};
  return { hints: x.hints === undefined ? true : !!x.hints };
};

function resetPosition(g, parsed) {
  g.board = parsed.board.slice();
  g.turn = parsed.turn;
  g.castling = parsed.castling;
  g.ep = parsed.ep;
  g.halfmove = parsed.halfmove;
  g.fullmove = parsed.fullmove;
  g.moveNo = 0;
  g.last = null;
  g.log = [];
  g.captured = [[], []];
  g.check = inCheck(g);
  g.positions = { [keyOf(g)]: 1 };
}

export function createGame(playerList, opts = {}, rng = Math.random) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(playerList) || playerList.length !== 2) throw new Error('Schach braucht genau 2 Personen.');
  const g = {
    game: 'sc',
    mode: 'play', // 'play' | 'over' (Ende der laufenden Runde)
    players: playerList.map((p) => ({ id: p.id, name: p.name })),
    opts: normOpts(opts),
    white: 0, // Index der Person, die in dieser Runde Weiß spielt
    round: 1,
    scores: [0, 0], // pro Person: Sieg 2, Remis 1
    result: null, // { winner: 0 | 1 (Farbe) | 'draw', reason, text }
    winner: null, // Index der Person oder null (Remis)
  };
  resetPosition(g, parseFen(START_FEN));
  return g;
}

// Stellung aus FEN setzen (Test- und Übungshilfe); Zähler und Zugliste beginnen neu. Gibt true bei Erfolg zurück.
export function setFen(g, fen) {
  const parsed = parseFen(fen);
  if (!parsed) return false;
  resetPosition(g, parsed);
  g.mode = 'play'; g.result = null; g.winner = null;
  return true;
}

const nameOfColor = (g, c) => g.players[playerOfColor(g, c)].name;
export const pointsText = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

const RESULT_TEXT = {
  fifty: 'Remis: 50 Züge lang wurde weder ein Bauer gezogen noch etwas geschlagen.',
  threefold: 'Remis: Dieselbe Stellung gab es zum dritten Mal.',
  dead: 'Remis: Mit den übrigen Figuren kann niemand mehr Schachmatt setzen.',
};

function finish(g, winnerColor, reason, text) {
  g.mode = 'over';
  g.result = { winner: winnerColor, reason, text };
  if (winnerColor === 'draw') { g.winner = null; g.scores[0] += 1; g.scores[1] += 1; } else {
    const wi = playerOfColor(g, winnerColor);
    g.winner = wi;
    g.scores[wi] += 2;
  }
  g.ep = -1;
}

const PROMO_ERR = 'Bitte wähle, in welche Figur sich dein Bauer verwandeln soll.';

export function move(g, pid, from, to, promo) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const me = colorOfPlayer(g, pid);
  if (me < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== me) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) return { ok: false, error: 'Dieser Zug ist nicht gültig.' };
  if (promo !== undefined && promo !== null && !(typeof promo === 'string' && /^[qrbnQRBN]$/.test(promo))) return { ok: false, error: 'Diese Figur gibt es nicht.' };
  const pos = posOf(g);
  const list = legalInts(pos);
  const cands = list.filter((x) => (x & 63) === from && ((x >> 6) & 63) === to);
  if (!cands.length) return { ok: false, error: whyIllegal(g, from, to) };
  let m = cands[0];
  if (mPromo(m)) {
    const pt = promo ? PROMO_TYPE[String(promo).toLowerCase()] : 0;
    m = cands.find((x) => mPromo(x) === pt);
    if (!m) return { ok: false, error: PROMO_ERR, needPromo: true };
  }
  const san = sanOfInt(pos, m, list);
  const text = textOfInt(pos, m);
  const short = shortOfInt(pos, m);
  const d = describe(pos, m);
  // Zug ausführen
  const capturedPiece = d.fl === FL_EP ? pieceOf(1, 1 - me) : pos.board[d.to];
  make(pos, m);
  g.board = Array.from(pos.board);
  g.castling = castlingStr(pos.castling);
  g.ep = pos.ep;
  g.halfmove = pos.halfmove;
  g.turn = pos.turn;
  const num = g.fullmove;
  if (me === 1) g.fullmove += 1;
  g.moveNo += 1;
  if (capturedPiece) g.captured[me].push(capturedPiece);
  const foeMated = !hasLegal(pos);
  const chk = inCheckPos(pos);
  g.check = chk;
  const suffix = foeMated && chk ? ' – Schachmatt' : chk ? ' – Schach' : '';
  g.last = { by: me, from: d.from, to: d.to, piece: d.type, capture: d.cap > 0, promo: d.promo ? PROMO_LETTER[d.promo] : null, castle: d.fl === FL_CK ? 'K' : d.fl === FL_CQ ? 'Q' : null, ep: d.fl === FL_EP, san, text, check: chk, mate: foeMated && chk };
  g.log.push(`${num}. ${COLOR_NAMES[me]}: ${short}${suffix}`);
  if (g.log.length > 12) g.log.splice(0, g.log.length - 12);
  const key = keyOfPos(pos);
  g.positions[key] = (g.positions[key] || 0) + 1;
  const name = nameOfColor(g, me);
  if (foeMated && chk) finish(g, me, 'checkmate', `Schachmatt! ${name} (${COLOR_NAMES[me]}) hat gewonnen.`);
  else if (foeMated) finish(g, 'draw', 'stalemate', `Patt: ${nameOfColor(g, g.turn)} kann nicht ziehen, steht aber nicht im Schach. Das ist ein Remis.`);
  else if (isDead(pos.board)) finish(g, 'draw', 'dead', RESULT_TEXT.dead);
  else if (g.positions[key] >= 3) finish(g, 'draw', 'threefold', RESULT_TEXT.threefold);
  else if (g.halfmove >= 100) finish(g, 'draw', 'fifty', RESULT_TEXT.fifty);
  else if (g.maxply && g.moveNo >= g.maxply) finish(g, 'draw', 'maxply', `Remis: Die Partie wurde nach ${g.maxply} Halbzügen beendet.`);
  return { ok: true };
}

// Nächste Runde: Startaufstellung, Punktestand bleibt, die Farben wechseln.
export function nextRound(g) {
  if (!g || g.mode !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.white = 1 - g.white;
  resetPosition(g, parseFen(START_FEN));
  g.round += 1;
  g.mode = 'play';
  g.result = null;
  g.winner = null;
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
      case 'move': return move(g, pid, msg.from, msg.to, msg.promo);
      case 'next': return g.players && g.players.some((x) => x.id === pid) ? nextRound(g) : { ok: false, error: 'Du spielst hier nicht mit.' };
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch {
    return { ok: false, error: 'Ungültige Nachricht.' };
  }
}
