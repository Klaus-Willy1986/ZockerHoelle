// Backgammon – reine Spiellogik (keine Oberfläche, kein Netzwerk).
//
// Zwei Personen: players[0] = Hell (Weiß), players[1] = Dunkel (Schwarz). Je 15 Steine, 24 Spitzen.
//
// STEINE / BRETT (alles aus EIGENER Sicht der Person, damit beide Seiten gleich gerechnet werden):
//   g.board = [ B0, B1 ]   (B0 = Hell, B1 = Dunkel), jedes B ist eine 26-Felder-Liste:
//     B[0]      = „Raus“ (herausgespielte Steine)
//     B[1..24]  = Spitzen aus eigener Sicht. Spitze 1 ist die letzte Heimfeld-Spitze (Ziel), Spitzen 1–6 sind das Heimfeld.
//     B[25]     = Bar (geschlagene Steine)
//   Jede Person zieht von hohen zu niedrigen Nummern. Eine Spitze q der Person i ist dieselbe Spitze wie 25−q der anderen Person:
//   der Stein der anderen Person auf „meiner“ Spitze q liegt in board[1−i][25−q].
//   Summe jeder Liste ist immer 15.
// Aufstellung (je Person, eigene Sicht): 2 auf 24, 5 auf 13, 3 auf 8, 5 auf 6.
//
// ZUG: g.turn = Index der Person am Zug, g.stage = 'roll' (muss würfeln) | 'move' (muss ziehen) | 'done' (Partie zu Ende).
//   g.lastRoll = { p, dice:[a,b], rollId }, g.left = noch nicht gespielte Würfelzahlen (Pasch: 4 Stück).
//   Ein Teilzug = { from, to, die }: from 25 = Bar, to 0 = Raus, sonst Spitzennummern aus Sicht der ziehenden Person.
//
// NACHRICHTEN: { t:'roll' }, { t:'move', from, to, die? }, { t:'next' } (nächste Partie bzw. neues Match). Kein Zurück.
//   Gibt es zu from/to mehrere mögliche Würfelzahlen (Herausspielen mit größerer Zahl), gilt msg.die, sonst die kleinere.
// HILFSFUNKTIONEN (für Oberfläche und Computer): legalMoves(g), canPlay(g), pipCount(g,i), winnerPoints(g,i), plays(g), ranking(g).
//
// REGELN: Bar-Pflicht, Blot schlagen, Pflicht möglichst beide Würfel zu spielen, sonst die größere Zahl,
//   Herausspielen erst mit allen 15 im Heimfeld (exakt oder von der höchsten besetzten Spitze mit größerer Zahl).
//   Wertung: 1 Punkt, Gammon 2, Backgammon 3. Match bis 3 Punkte (Option to5: 5, Option one: ein Spiel). Kein Dopplerwürfel.
//   Eröffnung: beide würfeln einen Würfel, höhere Zahl beginnt und zieht mit beiden Zahlen; danach beginnt in jeder Partie die verlierende Person.

export const NAMES = ['Hell', 'Dunkel'];
export const SHAPE_NAMES = ['rund mit Punkt', 'rund mit Raute'];
export const STONES = 15;
export const BAR = 25;
export const OFF = 0;
export const other = (i) => 1 - i;

const d6 = (rng) => 1 + Math.min(5, Math.floor(rng() * 6));

export function startBoard() {
  const one = Array(26).fill(0);
  one[24] = 2; one[13] = 5; one[8] = 3; one[6] = 5;
  return [one.slice(), one.slice()];
}

const cloneB = (b) => [b[0].slice(), b[1].slice()];
const removeOne = (arr, v) => { const i = arr.indexOf(v); const c = arr.slice(); if (i >= 0) c.splice(i, 1); return c; };
const uniq = (arr) => [...new Set(arr)];

// ---------- Züge auf einer Stellung (b = Brett, p = ziehende Person) ----------
function allHome(me) {
  let n = me[0];
  for (let q = 1; q <= 6; q++) n += me[q];
  return n === STONES;
}

// Alle Teilzüge mit genau einer Würfelzahl (ohne Pflichtregeln zu Würfelzahlen)
export function singleMoves(b, p, die) {
  const me = b[p];
  const op = b[1 - p];
  const out = [];
  if (me[BAR] > 0) {
    const t = BAR - die;
    if (op[BAR - t] < 2) out.push({ from: BAR, to: t, die });
    return out;
  }
  const home = allHome(me);
  let high = 0;
  for (let q = 24; q >= 1; q--) if (me[q] > 0) { high = q; break; }
  for (let f = 1; f <= 24; f++) {
    if (me[f] <= 0) continue;
    const t = f - die;
    if (t >= 1) {
      if (op[BAR - t] < 2) out.push({ from: f, to: t, die });
    } else if (home && (t === 0 || f === high)) {
      out.push({ from: f, to: OFF, die });
    }
  }
  return out;
}

// führt den Teilzug aus, gibt zurück, ob ein Stein geschlagen wurde
function applyMove(b, p, m) {
  const me = b[p];
  const op = b[1 - p];
  me[m.from] -= 1;
  let hit = false;
  if (m.to >= 1) {
    const k = BAR - m.to;
    if (op[k] === 1) { op[k] = 0; op[BAR] += 1; hit = true; }
    me[m.to] += 1;
  } else {
    me[OFF] += 1;
  }
  return hit;
}

const posKey = (b, p, left) => `${p}|${b[0].join(',')}|${b[1].join(',')}|${left.join(',')}`;

// Wie viele der übrigen Würfelzahlen lassen sich höchstens noch spielen?
function maxLen(b, p, left, memo) {
  if (!left.length) return 0;
  const key = posKey(b, p, left);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  outer: for (const d of uniq(left)) {
    for (const m of singleMoves(b, p, d)) {
      const nb = cloneB(b);
      applyMove(nb, p, m);
      const v = 1 + maxLen(nb, p, removeOne(left, d), memo);
      if (v > best) best = v;
      if (best === left.length) break outer;
    }
  }
  memo.set(key, best);
  return best;
}

// Erlaubte nächste Teilzüge einer Stellung inkl. Pflichtregeln (möglichst viele Würfel, sonst größere Zahl)
export function legalMovesPos(b, p, left, memo = new Map()) {
  if (!left.length) return [];
  const cands = [];
  let best = 0;
  for (const d of uniq(left)) {
    for (const m of singleMoves(b, p, d)) {
      const nb = cloneB(b);
      applyMove(nb, p, m);
      const v = 1 + maxLen(nb, p, removeOne(left, d), memo);
      cands.push({ m, v });
      if (v > best) best = v;
    }
  }
  let res = cands.filter((c) => c.v === best).map((c) => c.m);
  if (best === 1 && left.length === 2 && left[0] !== left[1]) {
    const hi = Math.max(left[0], left[1]);
    if (res.some((m) => m.die === hi)) res = res.filter((m) => m.die === hi);
  }
  return res;
}

export function legalMoves(g) {
  if (!g || g.mode !== 'play' || g.stage !== 'move' || !Array.isArray(g.left)) return [];
  return legalMovesPos(g.board, g.turn, g.left);
}
export const canPlay = (g) => legalMoves(g).length > 0;

// Alle vollständigen Zugfolgen mit dem aktuellen Wurf (nach Endstellung zusammengefasst), für den Computer.
// -> [{ moves:[{from,to,die,hit}], board }]
export function plays(g) {
  if (!g || g.mode !== 'play' || g.stage !== 'move') return [];
  const p = g.turn;
  const memo = new Map();
  const seen = new Set();
  const ends = new Map();
  const rec = (b, left, path) => {
    const key = posKey(b, p, left);
    if (seen.has(key)) return;
    seen.add(key);
    const ms = legalMovesPos(b, p, left, memo);
    if (!ms.length) {
      const bk = `${b[0].join(',')}|${b[1].join(',')}`;
      if (!ends.has(bk)) ends.set(bk, { moves: path, board: b });
      return;
    }
    for (const m of ms) {
      const nb = cloneB(b);
      const hit = applyMove(nb, p, m);
      rec(nb, removeOne(left, m.die), path.concat([{ ...m, hit }]));
    }
  };
  rec(cloneB(g.board), g.left.slice(), []);
  return [...ends.values()];
}

// Augenzahl bis zum Ziel (Summe der Abstände aller Steine zum Herausspielen)
export function pipCount(g, i) {
  const b = Array.isArray(g.board) ? g.board[i] : g[i];
  let s = 0;
  for (let q = 1; q <= 25; q++) s += q * b[q];
  return s;
}

// Wertung der Partie für den Gewinner w: normal 1, Gammon 2, Backgammon 3
export function winnerPoints(g, w) {
  const l = 1 - w;
  const lb = g.board[l];
  if (lb[OFF] > 0) return { kind: 'normal', points: 1 };
  let inHome = lb[BAR];
  for (let q = 19; q <= 24; q++) inHome += lb[q]; // Heimfeld des Gewinners
  if (inHome > 0) return { kind: 'backgammon', points: 3 };
  return { kind: 'gammon', points: 2 };
}

export const targetOf = (opts) => (opts && opts.one ? 1 : opts && opts.to5 ? 5 : 3);
export const pointsText = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
const nameOf = (g, i) => g.players[i].name;

// ---------- Spielablauf ----------
function openingRoll(rng) {
  for (let k = 0; k < 50; k++) {
    const a = d6(rng);
    const b = d6(rng);
    if (a !== b) return [a, b];
  }
  return [1, 2];
}

function setRoll(g, p, dice) {
  g.rollId += 1;
  g.lastRoll = { p, dice: dice.slice(), rollId: g.rollId };
  g.left = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
  g.pass = null;
  g.last = null;
  g.recap = [`${nameOf(g, p)} hat ${dice[0]} und ${dice[1]} gewürfelt${dice[0] === dice[1] ? ' (Pasch: viermal ' + dice[0] + ')' : ''}.`];
  g.stage = 'move';
  if (!legalMoves(g).length) {
    g.pass = { p, rollId: g.rollId, all: true };
    g.recap.push(`${nameOf(g, p)} kann nicht ziehen. Der Wurf verfällt.`);
    endTurn(g);
  }
}
function endTurn(g) {
  g.left = [];
  g.turn = other(g.turn);
  g.stage = 'roll';
}

function startMatchOrGame(g, rng, firstGameOfMatch) {
  g.board = startBoard();
  g.last = null; g.pass = null; g.lastRoll = null; g.left = []; g.winner = null; g.kind = null; g.points = 0;
  g.mode = 'play';
  if (firstGameOfMatch) {
    const [a, b] = openingRoll(rng);
    g.opening = [a, b];
    g.starter = a > b ? 0 : 1;
    g.turn = g.starter;
    g.recap = [`Eröffnungswurf: ${nameOf(g, 0)} ${a}, ${nameOf(g, 1)} ${b}. ${nameOf(g, g.starter)} beginnt und zieht mit ${a} und ${b}.`];
    const rec = g.recap;
    setRoll(g, g.starter, [a, b]);
    g.recap = rec.concat(g.recap);
  } else {
    g.opening = null;
    g.turn = g.starter;
    g.stage = 'roll';
    g.recap = [`Partie ${g.gameNo}: ${nameOf(g, g.starter)} beginnt.`];
  }
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 2) throw new Error('Backgammon braucht zwei Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const norm = { to5: !!o.to5, one: !!o.one, hints: !!o.hints, pip: !!o.pip };
  const g = {
    game: 'bgm',
    gid: Math.floor(rng() * 1e9),
    mode: 'play', // 'play' | 'over' (Partie zu Ende; bei matchWinner != null das ganze Match)
    players: playerList.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
    opts: norm,
    target: targetOf(norm),
    board: startBoard(),
    turn: 0,
    stage: 'roll',
    left: [],
    rollId: 0,
    lastRoll: null,
    last: null, // letzter Teilzug { p, from, to, die, hit }
    pass: null, // { p, rollId, all } wenn Wurf ganz/teilweise verfallen ist
    scores: [0, 0],
    gameNo: 1,
    starter: 0,
    opening: null,
    winner: null,
    kind: null,
    points: 0,
    matchWinner: null,
    recap: [],
  };
  startMatchOrGame(g, rng, true);
  return g;
}

function finish(g, w) {
  const r = winnerPoints(g, w);
  g.mode = 'over';
  g.stage = 'done';
  g.left = [];
  g.winner = w;
  g.kind = r.kind;
  g.points = r.points;
  g.scores[w] += r.points;
  const word = r.kind === 'backgammon' ? 'Backgammon' : r.kind === 'gammon' ? 'Gammon' : 'normal gewonnen';
  g.recap = [`${nameOf(g, w)} hat alle 15 Steine herausgespielt (${word}) und bekommt ${pointsText(r.points)}.`];
  if (g.scores[w] >= g.target) {
    g.matchWinner = w;
    g.recap.push(g.target === 1 ? `${nameOf(g, w)} hat das Spiel gewonnen.` : `${nameOf(g, w)} hat das Match bis ${g.target} Punkte gewonnen.`);
  }
}

export function roll(g, pid, rng = Math.random) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Die Partie ist zu Ende.' };
  const i = g.players.findIndex((x) => x.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (g.stage !== 'roll') return { ok: false, error: 'Du hast schon gewürfelt. Ziehe jetzt.' };
  setRoll(g, i, [d6(rng), d6(rng)]);
  return { ok: true };
}

export function move(g, pid, from, to, die) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Die Partie ist zu Ende.' };
  const i = g.players.findIndex((x) => x.id === pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (g.stage !== 'move') return { ok: false, error: 'Würfle zuerst.' };
  if (!Number.isInteger(from) || !Number.isInteger(to) || (die !== undefined && die !== null && !Number.isInteger(die))) return { ok: false, error: 'Ungültiger Zug.' };
  let cands = legalMoves(g).filter((m) => m.from === from && m.to === to);
  if (die !== undefined && die !== null) cands = cands.filter((m) => m.die === die);
  if (!cands.length) {
    const any = legalMoves(g);
    if (!any.length) return { ok: false, error: 'Kein Zug möglich.' };
    if (g.board[i][BAR] > 0 && from !== BAR) return { ok: false, error: 'Zuerst muss dein Stein von der Bar zurück aufs Brett.' };
    return { ok: false, error: 'Dieser Zug ist nicht erlaubt.' };
  }
  cands.sort((a, b) => a.die - b.die);
  const m = cands[0];
  const hit = applyMove(g.board, i, m);
  g.last = { p: i, from: m.from, to: m.to, die: m.die, hit, rollId: g.rollId };
  g.left = removeOne(g.left, m.die);
  const nm = nameOf(g, i);
  const fromTxt = m.from === BAR ? 'von der Bar' : `von Spitze ${m.from}`;
  const toTxt = m.to === OFF ? 'heraus' : `auf Spitze ${m.to}`;
  g.recap = g.recap.concat([`${nm} zieht ${fromTxt} ${toTxt} (Zahl ${m.die})${hit ? ' und schlägt einen Stein' : ''}.`]).slice(-6);
  if (g.board[i][OFF] === STONES) { finish(g, i); return { ok: true }; }
  if (!g.left.length) { endTurn(g); return { ok: true }; }
  if (!legalMoves(g).length) {
    g.pass = { p: i, rollId: g.rollId, all: false };
    g.recap.push(`${nm} kann die restlichen Zahlen nicht spielen. Sie verfallen.`);
    endTurn(g);
  }
  return { ok: true };
}

// Nächste Partie (Punktestand bleibt, die verlierende Person beginnt) oder, wenn das Match entschieden ist, ein neues Match.
export function nextGame(g, rng = Math.random) {
  if (!g || g.mode !== 'over') return { ok: false, error: 'Die Partie läuft noch.' };
  if (g.matchWinner !== null) {
    g.scores = [0, 0];
    g.gameNo = 1;
    g.matchWinner = null;
    startMatchOrGame(g, rng, true);
  } else {
    g.gameNo += 1;
    g.starter = other(g.winner);
    startMatchOrGame(g, rng, false);
  }
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
export function handle(g, pid, msg, rng = Math.random) {
  try {
    if (!msg || typeof msg !== 'object' || !g || typeof g !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
    switch (msg.t) {
      case 'roll': return roll(g, pid, rng);
      case 'move': return move(g, pid, msg.from, msg.to, msg.die);
      case 'next': return g.players && g.players.some((x) => x.id === pid) ? nextGame(g, rng) : { ok: false, error: 'Du spielst hier nicht mit.' };
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch {
    return { ok: false, error: 'Ungültige Nachricht.' };
  }
}

// Für die Oberfläche: Welcher Ausgangsort gilt gerade als gewählt?
// Bar-Pflicht → Bar (25); sonst die vom Menschen gewählte Spitze, falls sie noch ziehen darf;
// sonst, wenn nur von einer einzigen Stelle gezogen werden kann, diese. Sonst null.
export function selectionFor(g, me, sel, moves = legalMoves(g)) {
  if (!g || !g.board || !g.board[me] || !moves.length) return null;
  if (g.board[me][BAR] > 0) return BAR;
  if (sel !== null && sel !== undefined && moves.some((m) => m.from === sel)) return sel;
  const froms = uniq(moves.map((m) => m.from));
  return froms.length === 1 ? froms[0] : null;
}
