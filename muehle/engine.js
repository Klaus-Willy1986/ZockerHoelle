// Mühle – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Neun-Männer-Mühle für zwei Personen. Person 1 der Spielerliste = Weiß (beginnt), Person 2 = Schwarz.
//
// Punkte 0..23: drei Quadrate (Ring 0 außen, 1 Mitte, 2 innen) mit je 8 Punkten, im Uhrzeigersinn
// ab links oben: 0 links oben, 1 oben Mitte, 2 rechts oben, 3 rechts Mitte, 4 rechts unten,
// 5 unten Mitte, 6 links unten, 7 links Mitte. Punkt = Ring * 8 + Position.

export const STONES = 9;
export const COLOR_NAMES = ['Weiß', 'Schwarz'];

const SIDES = [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0]];
export const MILLS = [];
for (let r = 0; r < 3; r++) for (const s of SIDES) MILLS.push(s.map((k) => r * 8 + k));
for (const k of [1, 3, 5, 7]) MILLS.push([k, 8 + k, 16 + k]);

export const NEIGHBORS = Array.from({ length: 24 }, (_, p) => {
  const r = Math.floor(p / 8);
  const k = p % 8;
  const n = [r * 8 + ((k + 1) % 8), r * 8 + ((k + 7) % 8)];
  if (k % 2 === 1) { if (r > 0) n.push(p - 8); if (r < 2) n.push(p + 8); }
  return n.sort((a, b) => a - b);
});
const MILLS_OF = Array.from({ length: 24 }, (_, p) => MILLS.filter((m) => m.includes(p)));

export const other = (i) => 1 - i;
const isPoint = (p) => Number.isInteger(p) && p >= 0 && p < 24;

export function createGame(playerList) {
  return {
    game: 'muehle',
    mode: 'play', // 'play' | 'over'
    players: playerList.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
    board: Array(24).fill(null), // null | 0 (Weiß) | 1 (Schwarz)
    toPlace: [STONES, STONES],
    turn: 0, // wer jetzt handelt (auch beim Entfernen)
    removing: false, // true: turn muss einen gegnerischen Stein entfernen
    drawOffer: null, // Index der Person, die Remis angeboten hat
    seen: {}, // Stellungen der Ziehphase -> Häufigkeit
    moveNo: 0,
    last: null, // { by, from, to, removed }
    recap: [],
    winner: null, // Index oder null (Remis)
    endCode: null, // 'two' | 'blocked' | 'resign' | 'repeat' | 'agreed'
    endReason: null,
  };
}

// ---------- Hilfsfunktionen (reine Abfragen) ----------
export const countOn = (g, c) => g.board.filter((x) => x === c).length;
export const totalOf = (g, c) => countOn(g, c) + g.toPlace[c];
export const isPlacing = (g, c) => g.toPlace[c] > 0;
export const canFly = (g, c) => g.toPlace[c] === 0 && countOn(g, c) === 3;
export const inMill = (board, p) => board[p] !== null && MILLS_OF[p].some((m) => m.every((q) => board[q] === board[p]));
export const phaseOf = (g) => (g.toPlace[0] > 0 || g.toPlace[1] > 0 ? 'place' : 'move');

export function targetsFrom(g, from) {
  const c = g.board[from];
  if (c === null || c === undefined) return [];
  if (g.toPlace[c] > 0) return [];
  if (canFly(g, c)) return g.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  return NEIGHBORS[from].filter((q) => g.board[q] === null);
}
export function movableStones(g, c) {
  if (g.toPlace[c] > 0) return [];
  return g.board.map((v, i) => (v === c && targetsFrom(g, i).length ? i : -1)).filter((i) => i >= 0);
}
export const freePoints = (g) => g.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
export function removablePoints(g, victim) {
  const all = g.board.map((v, i) => (v === victim ? i : -1)).filter((i) => i >= 0);
  const free = all.filter((i) => !inMill(g.board, i));
  return free.length ? free : all;
}
export const hasLegalAction = (g, c) => (g.toPlace[c] > 0 ? freePoints(g).length > 0 : movableStones(g, c).length > 0);

// Alle Zugmöglichkeiten der Person am Zug (für Tests und Computergegner; die Oberfläche erklärt keine Züge).
export function legalActions(g) {
  if (g.mode !== 'play' || g.drawOffer !== null) return [];
  const c = g.turn;
  if (g.removing) return removablePoints(g, other(c)).map((p) => ({ t: 'remove', p }));
  if (g.toPlace[c] > 0) return freePoints(g).map((p) => ({ t: 'place', p }));
  const out = [];
  for (const from of movableStones(g, c)) for (const to of targetsFrom(g, from)) out.push({ t: 'move', from, to });
  return out;
}

// ---------- Spielablauf ----------
const nameOf = (g, i) => g.players[i].name;
const posKey = (g) => `${g.board.map((v) => (v === null ? '-' : v)).join('')}|${g.turn}`;

function endGame(g, winner, code, reason) {
  g.mode = 'over';
  g.winner = winner;
  g.endCode = code;
  g.endReason = reason;
  g.removing = false;
  g.drawOffer = null;
}

// Nach einer vollständigen Aktion: Sieg prüfen, Zug weitergeben, Stellungen zählen.
function finishAction(g, mover) {
  const opp = other(mover);
  g.moveNo += 1;
  g.drawOffer = null;
  for (const c of [opp, mover]) {
    if (g.toPlace[c] === 0 && countOn(g, c) <= 2) {
      endGame(g, other(c), 'two', `${nameOf(g, c)} hat nur noch 2 Steine.`);
      return;
    }
  }
  g.turn = opp;
  if (!hasLegalAction(g, opp)) {
    endGame(g, mover, 'blocked', `${nameOf(g, opp)} kann keinen Stein mehr ziehen.`);
    return;
  }
  if (phaseOf(g) === 'place') { g.seen = {}; return; }
  const key = posKey(g);
  g.seen[key] = (g.seen[key] || 0) + 1;
  if (g.seen[key] >= 3) endGame(g, null, 'repeat', 'Dieselbe Stellung ist zum dritten Mal entstanden.');
}

function afterPlacedOrMoved(g, mover, to, verb) {
  g.last = { by: mover, from: g.last?.from ?? null, to, removed: null };
  if (inMill(g.board, to)) {
    const victims = removablePoints(g, other(mover));
    if (victims.length) {
      g.removing = true;
      g.seen = {};
      g.recap = [`${nameOf(g, mover)} hat ${verb} und eine Mühle gebildet.`];
      return { ok: true, mill: true };
    }
  }
  g.recap = [`${nameOf(g, mover)} hat ${verb}.`];
  finishAction(g, mover);
  return { ok: true };
}

const checkTurn = (g, pid) => {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const i = g.players.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.drawOffer !== null) return { ok: false, error: 'Bitte zuerst auf das Remis-Angebot antworten.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  return { ok: true, i };
};

export function place(g, pid, p) {
  const c = checkTurn(g, pid);
  if (!c.ok) return c;
  if (g.removing) return { ok: false, error: 'Du musst zuerst einen Stein des Gegners entfernen.' };
  if (g.toPlace[c.i] <= 0) return { ok: false, error: 'Du hast keine Steine mehr zum Setzen.' };
  if (!isPoint(p)) return { ok: false, error: 'Dieser Punkt gibt es nicht.' };
  if (g.board[p] !== null) return { ok: false, error: 'Dieser Punkt ist schon besetzt.' };
  g.board[p] = c.i;
  g.toPlace[c.i] -= 1;
  g.last = { by: c.i, from: null, to: p, removed: null };
  return afterPlacedOrMoved(g, c.i, p, 'einen Stein gesetzt');
}

export function move(g, pid, from, to) {
  const c = checkTurn(g, pid);
  if (!c.ok) return c;
  if (g.removing) return { ok: false, error: 'Du musst zuerst einen Stein des Gegners entfernen.' };
  if (g.toPlace[c.i] > 0) return { ok: false, error: 'Zuerst müssen alle Steine gesetzt werden.' };
  if (!isPoint(from) || !isPoint(to)) return { ok: false, error: 'Dieser Punkt gibt es nicht.' };
  if (g.board[from] !== c.i) return { ok: false, error: 'Dort steht kein Stein von dir.' };
  if (g.board[to] !== null) return { ok: false, error: 'Das Ziel ist nicht frei.' };
  const fly = canFly(g, c.i);
  if (!fly && !NEIGHBORS[from].includes(to)) return { ok: false, error: 'Du darfst nur auf einen angrenzenden freien Punkt ziehen.' };
  g.board[from] = null;
  g.board[to] = c.i;
  g.last = { by: c.i, from, to, removed: null };
  return afterPlacedOrMoved(g, c.i, to, fly ? 'einen Stein fliegen lassen' : 'einen Stein gezogen');
}

export function removeStone(g, pid, p) {
  const c = checkTurn(g, pid);
  if (!c.ok) return c;
  if (!g.removing) return { ok: false, error: 'Du darfst gerade keinen Stein entfernen.' };
  if (!isPoint(p)) return { ok: false, error: 'Dieser Punkt gibt es nicht.' };
  const opp = other(c.i);
  if (g.board[p] !== opp) return { ok: false, error: 'Dort steht kein Stein deines Gegners.' };
  if (!removablePoints(g, opp).includes(p)) return { ok: false, error: 'Dieser Stein steht in einer Mühle und ist geschützt.' };
  g.board[p] = null;
  g.removing = false;
  g.last = { ...g.last, removed: p };
  g.recap = [`${nameOf(g, c.i)} hat eine Mühle gebildet und einen Stein von ${nameOf(g, opp)} entfernt.`];
  finishAction(g, c.i);
  return { ok: true };
}

export function resign(g, pid) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const i = g.players.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  g.recap = [`${nameOf(g, i)} hat aufgegeben.`];
  endGame(g, other(i), 'resign', `${nameOf(g, i)} hat aufgegeben.`);
  return { ok: true };
}

export function drawOffer(g, pid) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const i = g.players.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.drawOffer !== null) return { ok: false, error: 'Es gibt schon ein Remis-Angebot.' };
  g.drawOffer = i;
  g.recap = [`${nameOf(g, i)} bietet Remis an.`];
  return { ok: true };
}
export function drawCancel(g, pid) {
  const i = g?.players.findIndex((p) => p.id === pid);
  if (!g || g.mode !== 'play' || g.drawOffer === null || g.drawOffer !== i) return { ok: false, error: 'Es gibt kein Angebot von dir.' };
  g.drawOffer = null;
  g.recap = [`${nameOf(g, i)} nimmt das Remis-Angebot zurück.`];
  return { ok: true };
}
export function drawAccept(g, pid) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const i = g.players.findIndex((p) => p.id === pid);
  if (i < 0 || g.drawOffer === null || g.drawOffer === i) return { ok: false, error: 'Es gibt kein Angebot für dich.' };
  g.recap = [`${nameOf(g, i)} hat das Remis angenommen.`];
  endGame(g, null, 'agreed', 'Beide haben sich auf Remis geeinigt.');
  return { ok: true };
}
export function drawDecline(g, pid) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const i = g.players.findIndex((p) => p.id === pid);
  if (i < 0 || g.drawOffer === null || g.drawOffer === i) return { ok: false, error: 'Es gibt kein Angebot für dich.' };
  g.drawOffer = null;
  g.recap = [`${nameOf(g, i)} hat das Remis abgelehnt.`];
  return { ok: true };
}

// Nachrichten vom Netz: nie eine Ausnahme, nie ein beschädigter Zustand.
export function handle(g, pid, msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  switch (msg.t) {
    case 'place': return place(g, pid, msg.p);
    case 'move': return move(g, pid, msg.from, msg.to);
    case 'remove': return removeStone(g, pid, msg.p);
    case 'resign': return resign(g, pid);
    case 'draw-offer': return drawOffer(g, pid);
    case 'draw-cancel': return drawCancel(g, pid);
    case 'draw-accept': return drawAccept(g, pid);
    case 'draw-decline': return drawDecline(g, pid);
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}
