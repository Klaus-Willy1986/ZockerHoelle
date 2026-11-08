// Kartenrennen – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt nur über den Parameter rng herein und wird nur im Gastgeber benutzt.
// Der Zustand ist reines JSON.
//
// REGELN IN KÜRZE (Entscheidungen bei unklaren Fragen sind mit "Festlegung" markiert):
// - 4 Sitze (0,1,2,3 im Uhrzeigersinn). Team A = Sitze 0 und 2, Team B = Sitze 1 und 3. Fehlen Menschen, füllen
//   Computer die Plätze auf (Reihenfolge der Belegung: Sitz 0, 2, 1, 3, damit Partner gegenüber sitzen).
// - Ringbahn mit 64 Feldern (16 je Sitz). Das Startfeld von Sitz s ist Feld 16*s. Ein Stein hat den Fortschritt
//   -1 (Stall), 0..63 (Ringbahn, 0 = eigenes Startfeld) oder 64..67 (Zielfelder). Nach Fortschritt 63 (das Feld vor dem
//   eigenen Startfeld) geht es in die 4 Zielfelder ab. Ein Stein hat die Nummer g = Sitz*4 + Index (0..15).
// - Karten: 110 (2 Blätter à 52 + 6 Joker). Runde 1: 6 Karten je Person, danach 5, 4, 3, 2, dann wieder 6 ...
//   Reicht der Stapel für die nächste Austeilung nicht, werden Stapel und Ablage neu gemischt.
// - Tauschphase (opts.swap, Standard an): Alle geben gleichzeitig EINE Karte verdeckt an die Partnerin weiter.
// - Reihum spielt jede Person genau eine Karte. Kann sie keine Karte spielen, muss sie alle Karten abwerfen
//   (Nachricht discardAll, nur erlaubt, wenn wirklich kein Zug möglich ist) und setzt in der Runde aus.
// - Zahlen 2,3,5,6,8,9,10, Dame (12): Vorwärts. 4: 4 Felder rückwärts (nie ins Ziel; vom Startfeld aus geht es
//   über das Startfeld zurück auf die Felder vor dem Start = Fortschritt 60..63). 7: 7 Felder, aufteilbar.
//   Ass: 1 oder 11 vorwärts oder aus dem Stall. König: 13 vorwärts oder aus dem Stall. Bube: Tausch zweier Steine
//   auf der Ringbahn. Joker ersetzt jede dieser Karten.
// - Aus dem Stall: nur mit Ass, König, Joker (als Ass/König), auf das eigene Startfeld. Steht dort ein fremder oder
//   (Festlegung) ein eigener Stein: ein fremder wird geschlagen; steht dort ein eigener Stein, ist das Herausstellen
//   nicht erlaubt. Der frisch gesetzte Stein ist "geschützt", bis er sich bewegt hat.
// - Überholen: erlaubt (fremde und eigene Steine), außer geschützte Steine auf ihren Startfeldern (blockieren;
//   auf ihnen darf man auch nicht landen). Landet ein Stein genau auf einem Ringfeld mit einem anderen Stein (fremd
//   oder eigen), geht dieser in den Stall (Schlagen).
// - Festlegung Siebener: Jeder Teilschritt wird wie ein einzelner Zug ausgeführt, und ALLE Felder, über die ein Stein
//   beim Siebener läuft, schlagen dort stehende Steine (fremde und eigene), nicht nur das Zielfeld.
// - Ziel: Zielfelder dürfen nicht übersprungen und nicht doppelt besetzt werden (auch im Siebener nicht). Es muss
//   nicht genau das letzte Zielfeld getroffen werden.
// - Hat eine Person alle ihre 4 Steine im Ziel, spielt sie ab dann die Steine ihrer Partnerin mit.
// - Das Team gewinnt mit allen 8 Steinen im Ziel. Sicherung: nach 2000 ausgespielten/abgeworfenen Karten endet die
//   Partie, und das Team mit mehr Steinen im Ziel (dann mehr Fortschritt) gewinnt.
// - Legale Siebener-Aufteilungen für legalMoves() sind auf höchstens 3 Teilschritte begrenzt (die Prüfung von
//   Zügen akzeptiert bis zu 7 Teilschritte).

export const SEATS = 4;
export const PER = 16;
export const RING = 64;
export const GOAL_FIRST = 64;
export const GOAL_LAST = 67;
export const PIECES = 4;
export const HAND_SIZES = [6, 5, 4, 3, 2];
export const CARD_CAP = 2000;
export const DECK_SIZE = 110;
export const MAX_SPLIT_PARTS = 3;
export const COLOR_NAMES = ['Rot', 'Blau', 'Gelb', 'Grün'];
export const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
export const SHAPE_NAMES = ['Kreis', 'Quadrat', 'Dreieck', 'Raute'];
export const TEAM_NAMES = ['Rot & Gelb', 'Blau & Grün'];
export const FILL = [0, 2, 1, 3];
const RECAP_MAX = 8;

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'BUBE', 'DAME', 'KING', 'ASS', 'JOKER'];
export const PLAYABLE_RANKS = RANKS.filter((r) => r !== 'JOKER');
export const RANK_NAMES = { 2: 'Zwei', 3: 'Drei', 4: 'Vier', 5: 'Fünf', 6: 'Sechs', 7: 'Sieben', 8: 'Acht', 9: 'Neun', 10: 'Zehn', BUBE: 'Bube', DAME: 'Dame', KING: 'König', ASS: 'Ass', JOKER: 'Joker' };
export const RANK_SYM = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', BUBE: 'B', DAME: 'D', KING: 'K', ASS: 'A', JOKER: '★' };
const FWD = { 2: [2], 3: [3], 5: [5], 6: [6], 8: [8], 9: [9], 10: [10], DAME: [12], ASS: [1, 11], KING: [13] };
const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));

export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const seatOfStone = (g) => g >> 2;
export const indexOfStone = (g) => g & 3;
export const stoneId = (seat, i) => seat * 4 + i;
export const startIndex = (seat) => seat * PER;
export const ringIndex = (seat, prog) => (seat * PER + prog) % RING;
export const cardName = (c, as) => (c.r === 'JOKER' ? (as ? `Joker (als ${RANK_NAMES[as]})` : 'Joker') : `${SUITS[c.s].sym} ${RANK_NAMES[c.r]}`);
export const sameCard = (a, b) => !!a && !!b && a.r === b.r && (a.r === 'JOKER' || a.s === b.s);
const isCard = (c) => !!c && typeof c === 'object' && typeof c.r === 'string' && RANKS.includes(c.r);

// ---------- Brett (17x17-Raster, Spalte/Zeile ab 0) ----------
// Feld 0 = Startfeld von Sitz 0 (oben links), im Uhrzeigersinn: Sitz 1 oben rechts (Feld 16), Sitz 2 unten rechts (32),
// Sitz 3 unten links (48).
export const RING_CELLS = (() => {
  const c = [];
  for (let i = 0; i < 64; i++) {
    if (i <= 16) c.push([i, 0]);
    else if (i <= 32) c.push([16, i - 16]);
    else if (i <= 48) c.push([16 - (i - 32), 16]);
    else c.push([0, 16 - (i - 48)]);
  }
  return c;
})();
export const GOAL_CELLS = [
  [[1, 1], [2, 1], [3, 1], [4, 1]],
  [[15, 1], [15, 2], [15, 3], [15, 4]],
  [[15, 15], [14, 15], [13, 15], [12, 15]],
  [[1, 15], [1, 14], [1, 13], [1, 12]],
];
export const STALL_CELLS = [
  [[2, 3], [3, 3], [2, 4], [3, 4]],
  [[13, 3], [14, 3], [13, 4], [14, 4]],
  [[13, 12], [14, 12], [13, 13], [14, 13]],
  [[2, 12], [3, 12], [2, 13], [3, 13]],
];
export function cellOf(seat, prog, piece) {
  if (prog < 0) return STALL_CELLS[seat][piece];
  if (prog >= GOAL_FIRST) return GOAL_CELLS[seat][prog - GOAL_FIRST];
  return RING_CELLS[ringIndex(seat, prog)];
}

// ---------- leichtes Brettmodell (für Regeln, KI und Vorschau) ----------
// b.p[g] = Fortschritt, b.pr[g] = frisch gesetzt (geschützt, solange der Stein auf Fortschritt 0 steht)
export function boardOf(state) {
  const p = []; const pr = [];
  for (let s = 0; s < 4; s++) for (let i = 0; i < 4; i++) { p.push(state.players[s].pieces[i]); pr.push(!!state.players[s].prot[i]); }
  return { p, pr };
}
export const cloneBoard = (b) => ({ p: b.p.slice(), pr: b.pr.slice() });
function setBoard(state, b) {
  for (let s = 0; s < 4; s++) for (let i = 0; i < 4; i++) { state.players[s].pieces[i] = b.p[s * 4 + i]; state.players[s].prot[i] = !!b.pr[s * 4 + i]; }
}
const isProt = (b, g) => b.pr[g] && b.p[g] === 0;
const absOf = (g, prog) => (seatOfStone(g) * PER + prog) % RING;
function stonesAtAbs(b, abs, except) {
  const r = [];
  for (let h = 0; h < 16; h++) if (h !== except && b.p[h] >= 0 && b.p[h] <= 63 && absOf(h, b.p[h]) === abs) r.push(h);
  return r;
}
function goalTaken(b, seat, q, except) {
  for (let i = 0; i < 4; i++) { const h = seat * 4 + i; if (h !== except && b.p[h] === q) return true; }
  return false;
}
export const goalCount = (b, seat) => { let n = 0; for (let i = 0; i < 4; i++) if (b.p[seat * 4 + i] >= GOAL_FIRST) n++; return n; };
export const allHome = (b, seat) => goalCount(b, seat) === 4;
// Welcher Sitz bewegt die Steine, wenn Sitz `seat` an der Reihe ist?
export function ctlSeat(b, seat) { return allHome(b, seat) ? partnerOf(seat) : seat; }

// Vorwärtszug von Stein g um k Felder. seven = alle überlaufenen Felder schlagen. Ergebnis {to, caps} oder null.
export function forwardCheck(b, g, k, seven = false) {
  const p = b.p[g];
  if (!Number.isInteger(k) || k < 1 || p < 0) return null;
  const np = p + k;
  if (np > GOAL_LAST) return null;
  const caps = [];
  const seat = seatOfStone(g);
  for (let q = p + 1; q <= np; q++) {
    if (q <= 63) {
      for (const h of stonesAtAbs(b, absOf(g, q), g)) {
        if (isProt(b, h)) return null;
        if (q === np || seven) caps.push(h);
      }
    } else if (goalTaken(b, seat, q, g)) return null;
  }
  return { to: np, caps };
}
// 4 Felder rückwärts (nur auf der Ringbahn, nie ins Ziel).
export function backCheck(b, g) {
  const p = b.p[g];
  if (p < 0 || p > 63) return null;
  const cur = absOf(g, p);
  const caps = [];
  for (let j = 1; j <= 4; j++) {
    for (const h of stonesAtAbs(b, (cur - j + RING * 2) % RING, g)) {
      if (isProt(b, h)) return null;
      if (j === 4) caps.push(h);
    }
  }
  return { to: (p + RING - 4) % RING, caps };
}
// Stein aus dem Stall auf das Startfeld von Sitz ctl.
export function outCheck(b, ctl) {
  let g = -1;
  for (let i = 0; i < 4; i++) { if (b.p[ctl * 4 + i] === 0) return null; if (g < 0 && b.p[ctl * 4 + i] < 0) g = ctl * 4 + i; }
  if (g < 0) return null;
  return { g, to: 0, caps: stonesAtAbs(b, startIndex(ctl), g) };
}
export function swapCheck(b, ctl, a, c) {
  if (!Number.isInteger(a) || !Number.isInteger(c) || a === c || a < 0 || c < 0 || a > 15 || c > 15) return false;
  if (seatOfStone(a) !== ctl) return false;
  for (const g of [a, c]) if (b.p[g] < 0 || b.p[g] > 63 || isProt(b, g)) return false;
  return true;
}
function capture(b, caps, out) {
  for (const h of caps) { if (out) out.push({ g: h, from: b.p[h] }); b.p[h] = -1; b.pr[h] = false; }
}
function applyForward(b, g, k, seven, steps, capOut) {
  const r = forwardCheck(b, g, k, seven);
  if (!r) return false;
  steps.push({ g, from: b.p[g], to: r.to });
  capture(b, r.caps, capOut);
  b.p[g] = r.to; b.pr[g] = false;
  return true;
}

// Prüft und führt einen vollständigen Zug aus. Liefert {ok, b, steps, caps} oder {ok:false, error}.
export function resolve(b0, ctl, rank, move) {
  const bad = (error) => ({ ok: false, error });
  if (!move || typeof move !== 'object') return bad('Dieser Zug ist ungültig.');
  const b = cloneBoard(b0);
  const steps = []; const caps = [];
  const mine = (g) => Number.isInteger(g) && g >= 0 && g < 16 && seatOfStone(g) === ctl;
  if (rank === 'ASS' || rank === 'KING' || FWD[rank]) {
    if (move.out) {
      if (rank !== 'ASS' && rank !== 'KING') return bad('Mit dieser Karte kommt kein Stein aus dem Stall.');
      const r = outCheck(b, ctl);
      if (!r) return bad('Es darf jetzt kein Stein aus dem Stall kommen.');
      steps.push({ g: r.g, from: -1, to: 0 });
      capture(b, r.caps, caps);
      b.p[r.g] = 0; b.pr[r.g] = true;
      return { ok: true, b, steps, caps };
    }
    if (!mine(move.stone) || !FWD[rank].includes(move.steps)) return bad('Dieser Zug ist ungültig.');
    if (!applyForward(b, move.stone, move.steps, false, steps, caps)) return bad('Mit diesem Stein geht das nicht.');
    return { ok: true, b, steps, caps };
  }
  if (rank === '4') {
    if (!mine(move.back)) return bad('Dieser Zug ist ungültig.');
    const r = backCheck(b, move.back);
    if (!r) return bad('Dieser Stein darf nicht rückwärts ziehen.');
    steps.push({ g: move.back, from: b.p[move.back], to: r.to });
    capture(b, r.caps, caps);
    b.p[move.back] = r.to; b.pr[move.back] = false;
    return { ok: true, b, steps, caps };
  }
  if (rank === '7') {
    const sp = move.split;
    if (!Array.isArray(sp) || sp.length < 1 || sp.length > 7) return bad('Dieser Zug ist ungültig.');
    let sum = 0;
    for (const part of sp) {
      if (!part || !mine(part.stone) || !Number.isInteger(part.steps) || part.steps < 1) return bad('Dieser Zug ist ungültig.');
      sum += part.steps;
      if (sum > 7) return bad('Der Siebener hat genau 7 Felder.');
      if (!applyForward(b, part.stone, part.steps, true, steps, caps)) return bad('Dieser Teilschritt ist nicht erlaubt.');
    }
    if (sum !== 7) return bad('Der Siebener hat genau 7 Felder.');
    return { ok: true, b, steps, caps };
  }
  if (rank === 'BUBE') {
    const sw = move.swap;
    if (!Array.isArray(sw) || sw.length !== 2 || !swapCheck(b, ctl, sw[0], sw[1])) return bad('Dieser Tausch ist nicht erlaubt.');
    const [a, c] = sw;
    const pa = b.p[a]; const pc = b.p[c];
    const aa = absOf(a, pa); const ac = absOf(c, pc);
    b.p[a] = (ac - seatOfStone(a) * PER + RING) % RING;
    b.p[c] = (aa - seatOfStone(c) * PER + RING) % RING;
    b.pr[a] = false; b.pr[c] = false;
    steps.push({ g: a, from: pa, to: b.p[a] }, { g: c, from: pc, to: b.p[c] });
    return { ok: true, b, steps, caps };
  }
  return bad('Diese Karte kann nicht gespielt werden.');
}

// Siebener-Hilfen: nächste Teilschritte, nach denen sich die 7 noch vollenden lässt (für die Oberfläche).
export function sevenCompletable(b, ctl, left, memo = new Map()) {
  if (left === 0) return true;
  const key = `${left}|${b.p.join(',')}|${b.pr.map((x) => (x ? 1 : 0)).join('')}`;
  if (memo.has(key)) return memo.get(key);
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) {
    const g = ctl * 4 + i;
    if (b.p[g] < 0) continue;
    for (let k = 1; k <= left && !ok; k++) {
      const r = forwardCheck(b, g, k, true);
      if (!r) break;
      const b2 = cloneBoard(b);
      applyForward(b2, g, k, true, [], null);
      if (sevenCompletable(b2, ctl, left - k, memo)) ok = true;
    }
  }
  memo.set(key, ok);
  return ok;
}
export function sevenSteps(b, ctl, left) {
  const out = [];
  const memo = new Map();
  for (let i = 0; i < 4; i++) {
    const g = ctl * 4 + i;
    if (b.p[g] < 0) continue;
    for (let k = 1; k <= left; k++) {
      const r = forwardCheck(b, g, k, true);
      if (!r) break;
      const b2 = cloneBoard(b);
      applyForward(b2, g, k, true, [], null);
      if (sevenCompletable(b2, ctl, left - k, memo)) out.push({ stone: g, steps: k, to: r.to });
    }
  }
  return out;
}
function sevenSplits(b, ctl) {
  const out = []; const seen = new Set();
  const rec = (bb, left, last, parts) => {
    if (left === 0) {
      const sig = `${bb.p.join(',')}|${bb.pr.map((x) => (x ? 1 : 0)).join('')}`;
      if (!seen.has(sig)) { seen.add(sig); out.push({ split: parts.map((x) => ({ ...x })) }); }
      return;
    }
    if (parts.length >= MAX_SPLIT_PARTS) return;
    for (let i = 0; i < 4; i++) {
      const g = ctl * 4 + i;
      if (g === last || bb.p[g] < 0) continue;
      for (let k = 1; k <= left; k++) {
        if (parts.length === MAX_SPLIT_PARTS - 1 && k !== left) continue;
        const r = forwardCheck(bb, g, k, true);
        if (!r) break;
        const b2 = cloneBoard(bb);
        applyForward(b2, g, k, true, [], null);
        parts.push({ stone: g, steps: k });
        rec(b2, left - k, g, parts);
        parts.pop();
      }
    }
  };
  rec(b, 7, -1, []);
  return out;
}

// Alle vollständigen Züge für eine (wirksame) Karte `rank` ohne Joker.
export function movesFor(b, ctl, rank) {
  const out = [];
  if (FWD[rank]) {
    for (let i = 0; i < 4; i++) {
      const g = ctl * 4 + i;
      if (b.p[g] < 0) continue;
      for (const k of FWD[rank]) if (forwardCheck(b, g, k)) out.push({ stone: g, steps: k });
    }
    if ((rank === 'ASS' || rank === 'KING') && outCheck(b, ctl)) out.push({ out: true });
  } else if (rank === '4') {
    for (let i = 0; i < 4; i++) { const g = ctl * 4 + i; if (backCheck(b, g)) out.push({ back: g }); }
  } else if (rank === '7') {
    out.push(...sevenSplits(b, ctl));
  } else if (rank === 'BUBE') {
    for (let i = 0; i < 4; i++) {
      const a = ctl * 4 + i;
      for (let c = 0; c < 16; c++) {
        if (seatOfStone(c) === ctl && c < a) continue; // eigene Paare nur einmal
        if (swapCheck(b, ctl, a, c)) out.push({ swap: [a, c] });
      }
    }
  }
  return out;
}

// ---------- Spielstand ----------
function newDeck() {
  const d = [];
  for (let k = 0; k < 2; k++) for (let s = 0; s < 4; s++) for (const r of PLAYABLE_RANKS) d.push({ r, s });
  for (let k = 0; k < 6; k++) d.push({ r: 'JOKER', s: 4 });
  return d;
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const sortHand = (h) => h.sort((a, b) => RANK_ORDER[a.r] - RANK_ORDER[b.r] || a.s - b.s);
function pushRecap(state, line) {
  state.recap.unshift(line); // neueste zuerst
  if (state.recap.length > RECAP_MAX) state.recap.length = RECAP_MAX;
}

function startRound(state, rng) {
  const size = HAND_SIZES[state.round % HAND_SIZES.length];
  state.handSize = size;
  if (state.deck.length < SEATS * size) {
    state.deck = shuffle(state.deck.concat(state.discard), rng);
    state.discard = [];
  }
  for (const p of state.players) { p.hand = []; for (let k = 0; k < size; k++) p.hand.push(state.deck.pop()); sortHand(p.hand); }
  state.starter = state.round % SEATS;
  state.turn = state.starter;
  state.jokerAs = null;
  state.recvd = [null, null, null, null];
  state.swapSel = [null, null, null, null];
  state.phase = state.opts.swap ? 'swap' : 'play';
  const k = size === 1 ? '1 Karte' : `${size} Karten`;
  pushRecap(state, `Runde ${state.round + 1}: Jede Person bekommt ${k}.`);
  state.last = { kind: 'round', seat: -1, text: `Runde ${state.round + 1} beginnt, jede Person hat ${k}.` };
}

function buildState(seatPlayers, opts, rng, hostId, wins) {
  const state = {
    game: 'kr',
    gid: Math.floor(rng() * 1e9),
    phase: 'play', // 'swap' | 'play' | 'over'
    opts: { swap: opts && opts.swap !== undefined ? !!opts.swap : true, hints: !!(opts && opts.hints) },
    hostId,
    players: seatPlayers.map((p, s) => ({ id: p.id, name: p.name, seat: s, bot: !!p.bot, hand: [], pieces: [-1, -1, -1, -1], prot: [false, false, false, false] })),
    turn: 0,
    starter: 0,
    round: 0,
    handSize: 0,
    deck: shuffle(newDeck(), rng),
    discard: [],
    swapSel: [null, null, null, null],
    recvd: [null, null, null, null],
    jokerAs: null,
    used: 0,
    lastCard: null,
    last: null,
    recap: [],
    wins: wins ? { A: wins.A, B: wins.B } : { A: 0, B: 0 },
    winner: null, // 0 = Team A, 1 = Team B
    endReason: null,
  };
  startRound(state, rng);
  return state;
}

// playerList: bis zu 4 Menschen/Computer {id,name,bot?}. Fehlende Plätze füllen Computer auf (ids bot1, bot2 ...).
export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  const list = Array.isArray(playerList) ? playerList.slice(0, 4) : [];
  const ids = new Set(list.map((p) => p.id));
  const names = new Set(list.map((p) => p.name));
  const seatPlayers = [null, null, null, null];
  list.forEach((p, i) => { seatPlayers[FILL[i]] = { id: p.id, name: p.name, bot: !!p.bot || String(p.id).startsWith('bot') }; });
  let k = 1; let n = 1;
  for (let s = 0; s < 4; s++) {
    if (seatPlayers[s]) continue;
    while (ids.has('bot' + k)) k++;
    let name = 'Computer';
    while (names.has(name)) { n++; name = 'Computer ' + n; }
    ids.add('bot' + k); names.add(name);
    seatPlayers[s] = { id: 'bot' + k, name, bot: true };
  }
  return buildState(seatPlayers, opts, rng, hostId, null);
}

export const activePlayer = (state) => state.players[state.turn];
export const seatOfPid = (state, pid) => state.players.findIndex((p) => p.id === pid);
export const teamGoal = (state, team) => state.players.reduce((n, p) => n + (teamOf(p.seat) === team ? p.pieces.filter((x) => x >= GOAL_FIRST).length : 0), 0);
const teamProgress = (state, team) => state.players.reduce((n, p) => n + (teamOf(p.seat) === team ? p.pieces.reduce((s, x) => s + Math.max(0, x + 1), 0) : 0), 0);
export const controlledSeat = (state, seat) => ctlSeat(boardOf(state), seat);
export const handOf = (state, pid) => { const s = seatOfPid(state, pid); return s < 0 ? [] : state.players[s].hand; };

// Alle erlaubten Züge der aktiven Person pid: [{ card:{r,s}, as?, move }] (je Kartenart; Joker einzeln je Ersatzkarte).
export function legalMoves(state, pid) {
  if (!state || state.phase !== 'play') return [];
  const seat = seatOfPid(state, pid);
  if (seat < 0 || seat !== state.turn) return [];
  const b = boardOf(state);
  const ctl = ctlSeat(b, seat);
  const seen = new Set();
  const out = [];
  for (const c of state.players[seat].hand) {
    const key = c.r === 'JOKER' ? 'J' : `${c.r}|${c.s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const card = { r: c.r, s: c.s };
    if (c.r === 'JOKER') {
      for (const as of PLAYABLE_RANKS) for (const move of movesFor(b, ctl, as)) out.push({ card, as, move });
    } else for (const move of movesFor(b, ctl, c.r)) out.push({ card, move });
  }
  return out;
}
export function canPlay(state, pid) {
  if (!state || state.phase !== 'play') return false;
  const seat = seatOfPid(state, pid);
  if (seat < 0 || seat !== state.turn) return false;
  const b = boardOf(state);
  const ctl = ctlSeat(b, seat);
  for (const c of state.players[seat].hand) {
    for (const r of c.r === 'JOKER' ? PLAYABLE_RANKS : [c.r]) if (movesFor(b, ctl, r).length) return true;
  }
  return false;
}
// Welche Karten (Rang) der Hand sind überhaupt spielbar? -> Menge von "r|s" (Joker "JOKER|4")
export function playableCards(state, pid) {
  const set = new Set();
  for (const m of legalMoves(state, pid)) set.add(`${m.card.r}|${m.card.s}`);
  return set;
}

function describe(state, seat, rank, as, res) {
  const p = state.players[seat];
  const ART = { BUBE: 'einen Buben', KING: 'einen König', ASS: 'ein Ass', DAME: 'eine Dame' };
  const label = rank === 'JOKER' ? `den Joker als ${RANK_NAMES[as]}` : (ART[rank] || `eine ${RANK_NAMES[rank]}`);
  const sn = (g) => `${COLOR_NAMES[seatOfStone(g)]} ${indexOfStone(g) + 1}`;
  const eff = rank === 'JOKER' ? as : rank;
  let t = `${p.name} spielt ${label}`;
  if (eff === 'BUBE') t += ` und tauscht Stein ${sn(res.steps[0].g)} mit Stein ${sn(res.steps[1].g)}.`;
  else if (res.steps.length === 1 && res.steps[0].from < 0) t += ` und stellt Stein ${sn(res.steps[0].g)} auf das Startfeld.`;
  else if (eff === '4') t += ` und zieht Stein ${sn(res.steps[0].g)} 4 Felder zurück.`;
  else if (eff === '7') t += ` und zieht: ${res.steps.map((s) => `Stein ${sn(s.g)} ${s.to - s.from} ${s.to - s.from === 1 ? 'Feld' : 'Felder'}`).join(', ')}.`;
  else t += ` und zieht Stein ${sn(res.steps[0].g)} ${res.steps[0].to - res.steps[0].from} ${res.steps[0].to - res.steps[0].from === 1 ? 'Feld' : 'Felder'} weiter.`;
  for (const c of res.caps) t += ` Stein ${sn(c.g)} wird geschlagen und kommt in den Stall!`;
  return t;
}

function finish(state, team, reason) {
  state.phase = 'over';
  state.winner = team;
  state.endReason = reason;
  state.wins[team === 0 ? 'A' : 'B'] += 1;
  state.last = { kind: 'over', seat: -1, text: reason };
  pushRecap(state, reason);
}
function checkEnd(state) {
  for (const team of [0, 1]) {
    if (teamGoal(state, team) === 8) { finish(state, team, `Team ${TEAM_NAMES[team]} hat alle 8 Steine ins Ziel gebracht.`); return true; }
  }
  if (state.used >= CARD_CAP) {
    const ga = teamGoal(state, 0); const gb = teamGoal(state, 1);
    const team = ga !== gb ? (ga > gb ? 0 : 1) : (teamProgress(state, 0) >= teamProgress(state, 1) ? 0 : 1);
    finish(state, team, `Nach sehr vielen Karten endet das Spiel. Team ${TEAM_NAMES[team]} hat mehr Steine im Ziel.`);
    return true;
  }
  return false;
}
function advance(state, rng) {
  state.jokerAs = null;
  if (checkEnd(state)) return;
  if (state.players.every((p) => p.hand.length === 0)) {
    state.round += 1;
    startRound(state, rng);
    return;
  }
  let s = state.turn;
  for (let k = 0; k < 4; k++) { s = (s + 1) % 4; if (state.players[s].hand.length) break; }
  state.turn = s;
}

function removeFromHand(hand, card) {
  let i = hand.findIndex((c) => c.r === card.r && (c.r === 'JOKER' || c.s === card.s));
  if (i < 0 && card.r !== 'JOKER' && !Number.isInteger(card.s)) i = hand.findIndex((c) => c.r === card.r);
  return i;
}

function doSwap(state, seat, card) {
  if (state.phase !== 'swap') return { ok: false, error: 'Es wird gerade nicht getauscht.' };
  if (!isCard(card)) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  const hand = state.players[seat].hand;
  const i = removeFromHand(hand, card);
  if (i < 0) return { ok: false, error: 'Diese Karte hast du nicht.' };
  state.swapSel[seat] = { r: hand[i].r, s: hand[i].s };
  if (state.swapSel.every((x) => x)) {
    const given = state.swapSel.map((c, s) => { const h = state.players[s].hand; return h.splice(removeFromHand(h, c), 1)[0]; });
    for (let s = 0; s < 4; s++) { const to = partnerOf(s); state.players[to].hand.push(given[s]); state.recvd[to] = { r: given[s].r, s: given[s].s }; }
    for (const p of state.players) sortHand(p.hand);
    state.swapSel = [null, null, null, null];
    state.phase = 'play';
    pushRecap(state, 'Alle haben eine Karte an ihre Partnerin weitergegeben.');
    state.last = { kind: 'swapdone', seat: -1, text: 'Die Karten sind getauscht.' };
  }
  return { ok: true };
}

function doPlay(state, seat, msg, rng) {
  if (state.phase !== 'play') return { ok: false, error: 'Es wird gerade nicht gespielt.' };
  if (state.turn !== seat) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!isCard(msg.card)) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  const p = state.players[seat];
  const i = removeFromHand(p.hand, msg.card);
  if (i < 0) return { ok: false, error: 'Diese Karte hast du nicht.' };
  const card = p.hand[i];
  let eff = card.r;
  if (card.r === 'JOKER') {
    eff = msg.as !== undefined ? msg.as : state.jokerAs;
    if (!PLAYABLE_RANKS.includes(eff)) return { ok: false, error: 'Sage, welche Karte der Joker ersetzt.' };
  }
  const b = boardOf(state);
  const ctl = ctlSeat(b, seat);
  const res = resolve(b, ctl, eff, msg.move);
  if (!res.ok) return res;
  setBoard(state, res.b);
  p.hand.splice(i, 1);
  state.discard.push({ r: card.r, s: card.s });
  state.used += 1;
  state.lastCard = { r: card.r, s: card.s, as: card.r === 'JOKER' ? eff : null };
  const text = describe(state, seat, card.r, eff, res);
  pushRecap(state, text);
  state.last = { kind: 'play', seat, ctl, card: state.lastCard, steps: res.steps, caps: res.caps, text };
  advance(state, rng);
  return { ok: true, caps: res.caps, steps: res.steps };
}

function doDiscardAll(state, seat, rng) {
  if (state.phase !== 'play') return { ok: false, error: 'Es wird gerade nicht gespielt.' };
  if (state.turn !== seat) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const p = state.players[seat];
  if (canPlay(state, p.id)) return { ok: false, error: 'Du hast noch einen erlaubten Zug.' };
  const n = p.hand.length;
  for (const c of p.hand) state.discard.push({ r: c.r, s: c.s });
  p.hand = [];
  state.used += n;
  const text = `${p.name} kann nichts spielen, wirft ${n === 1 ? 'die Karte' : 'alle ' + n + ' Karten'} ab und setzt in dieser Runde aus.`;
  pushRecap(state, text);
  state.last = { kind: 'discard', seat, text, n };
  advance(state, rng);
  return { ok: true, discarded: n };
}

// Verarbeitet eine Nachricht; ändert den Zustand nur bei gültigen Eingaben.
export function handle(state, pid, msg, rng = Math.random) {
  if (!state || !msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (msg.t === 'next') {
    if (state.phase !== 'over') return { ok: false, error: 'Das Spiel läuft noch.' };
    if (state.hostId && pid !== state.hostId) return { ok: false, error: 'Nur der Gastgeber startet das nächste Spiel.' };
    const fresh = buildState(state.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot })), state.opts, rng, state.hostId, state.wins);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    return { ok: true };
  }
  if (state.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const seat = seatOfPid(state, pid);
  if (seat < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'swap') return doSwap(state, seat, msg.card);
  if (msg.t === 'play') return doPlay(state, seat, msg, rng);
  if (msg.t === 'discardAll') return doDiscardAll(state, seat, rng);
  if (msg.t === 'joker') {
    if (state.phase !== 'play' || state.turn !== seat) return { ok: false, error: 'Du bist nicht an der Reihe.' };
    if (!PLAYABLE_RANKS.includes(msg.as)) return { ok: false, error: 'Diese Karte kann der Joker nicht ersetzen.' };
    if (!state.players[seat].hand.some((c) => c.r === 'JOKER')) return { ok: false, error: 'Du hast keinen Joker.' };
    state.jokerAs = msg.as;
    return { ok: true };
  }
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

// Teamwertung: Sieger zuerst.
export function ranking(state) {
  const rows = [0, 1].map((team) => ({
    team, name: TEAM_NAMES[team], goal: teamGoal(state, team), progress: teamProgress(state, team),
    members: state.players.filter((p) => teamOf(p.seat) === team).map((p) => p.name),
    wins: team === 0 ? state.wins.A : state.wins.B,
  }));
  rows.sort((a, b) => (state.winner === a.team ? -1 : state.winner === b.team ? 1 : 0) || b.goal - a.goal || b.progress - a.progress || a.team - b.team);
  return rows;
}

// ---------- Hilfen für Oberfläche und Lernrunde ----------
// Teilschritt eines Siebeners auf einer Kopie des Bretts ausführen (Vorschau).
export function stepBoard(b, g, k) {
  const b2 = cloneBoard(b);
  applyForward(b2, g, k, true, [], null);
  return b2;
}

// In welchem Schritt steht die Auswahl `sel` = { card, as, opt, stone, pb?, left? } der Person pid?
// Stufen: 'card' (noch nichts gewählt), 'joker' (Ersatzkarte wählen), 'opt' (z. B. 1 oder 11, aus dem Stall),
// 'stone' (Stein wählen), 'target' (Zielfeld bzw. Tauschstein wählen), 'none' (mit dieser Karte geht nichts).
export function selStage(state, pid, sel) {
  const seat = seatOfPid(state, pid);
  if (!sel || !sel.card || seat < 0) return { stage: 'card' };
  const real = boardOf(state);
  const ctl = ctlSeat(real, seat);
  const b = sel.pb || real;
  const eff = sel.card.r === 'JOKER' ? sel.as : sel.card.r;
  if (!eff) return { stage: 'joker', ranks: PLAYABLE_RANKS.filter((r) => movesFor(real, ctl, r).length > 0), ctl };
  if (eff === '7') {
    const left = Number.isInteger(sel.left) ? sel.left : 7;
    const steps = sevenSteps(b, ctl, left);
    const stones = [...new Set(steps.map((s) => s.stone))];
    if (!stones.length) return { stage: 'none', eff, ctl };
    if (!stones.includes(sel.stone)) return { stage: 'stone', eff, stones, left, ctl };
    return { stage: 'target', eff, stone: sel.stone, left, ctl, targets: steps.filter((s) => s.stone === sel.stone).map((s) => ({ steps: s.steps, to: s.to })) };
  }
  if (eff === 'BUBE') {
    const stones = [];
    for (let i = 0; i < 4; i++) {
      const a = ctl * 4 + i;
      for (let c = 0; c < 16; c++) if (swapCheck(b, ctl, a, c)) { stones.push(a); break; }
    }
    if (!stones.length) return { stage: 'none', eff, ctl };
    if (!stones.includes(sel.stone)) return { stage: 'stone', eff, stones, ctl };
    const targets = [];
    for (let c = 0; c < 16; c++) if (swapCheck(b, ctl, sel.stone, c)) targets.push({ g: c });
    return { stage: 'target', eff, stone: sel.stone, ctl, targets };
  }
  if (eff === '4') {
    const moves = movesFor(b, ctl, '4');
    const stones = moves.map((m) => m.back);
    if (!stones.length) return { stage: 'none', eff, ctl };
    if (!stones.includes(sel.stone)) return { stage: 'stone', eff, stones, ctl };
    return { stage: 'target', eff, stone: sel.stone, ctl, targets: [{ steps: 4, to: backCheck(b, sel.stone).to }] };
  }
  const moves = movesFor(b, ctl, eff);
  if (!moves.length) return { stage: 'none', eff, ctl };
  const key = (m) => (m.out ? 'out' : 's' + m.steps);
  const options = [...new Set(moves.map(key))];
  const opt = options.includes(sel.opt) ? sel.opt : (options.length === 1 && options[0] !== 'out' ? options[0] : null);
  if (!opt) return { stage: 'opt', eff, options, ctl };
  if (opt === 'out') return { stage: 'out', eff, ctl };
  const stones = moves.filter((m) => key(m) === opt).map((m) => m.stone);
  if (!stones.includes(sel.stone)) return { stage: 'stone', eff, opt, options, stones, ctl };
  const k = Number(opt.slice(1));
  return { stage: 'target', eff, opt, options, stone: sel.stone, ctl, targets: [{ steps: k, to: b.p[sel.stone] + k }] };
}
