// Barrikade – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Der Zufall (Würfel) kommt als Parameter `rng` herein und wird nur im Gastgeber benutzt.

// Eine Figur im Haus: Der erste Schritt ist das Startfeld vor dem Haus (Schritt 1), danach folgen n-1 weitere Schritte.
// Auslegung der Anleitung ("die Punkte der Ausgangsfelder werden nicht mitgezählt") – bei Bedarf auf false stellen:
// dann steht die Figur zuerst auf dem Startfeld (ohne zu zählen) und zieht von dort n Felder.
export const HOUSE_EXIT_COUNTS_START_AS_STEP = true;

export const GOAL = 'Z';
export const PIECES_PER_PLAYER = 5;
export const NUM_BARRIERS = 11;
export const COLOR_NAMES = { R: 'Rot', G: 'Grün', Y: 'Gelb', B: 'Blau' };
export const COLOR_LETTERS = { R: 'R', G: 'G', Y: 'Y', B: 'B' };
export const HOUSE_COL = { R: 2, G: 6, Y: 10, B: 14 }; // Spalte des Hauses / Startfelds in der untersten Reihe
export const BOTTOM_ROW = 12;

// ---------- Wegenetz ----------
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ROW_COLS = {
  0: range(0, 16), 1: [0, 16], 2: range(0, 16), 3: [8], 4: range(6, 10), 5: [6, 10], 6: range(4, 12),
  7: [4, 12], 8: range(2, 14), 9: [2, 6, 10, 14], 10: range(0, 16), 11: [0, 4, 8, 12, 16], 12: range(0, 16),
};
export const nodeId = (r, c) => `${r}_${c}`;

export const NODES = {}; // id -> { id, r, c, nbrs: [id] }
for (const [r, cols] of Object.entries(ROW_COLS)) {
  for (const c of cols) NODES[nodeId(Number(r), c)] = { id: nodeId(Number(r), c), r: Number(r), c, nbrs: [] };
}
NODES[GOAL] = { id: GOAL, r: -1, c: 8, nbrs: [] };
export const EDGES = [];
function link(a, b) {
  NODES[a].nbrs.push(b);
  NODES[b].nbrs.push(a);
  EDGES.push([a, b]);
}
for (const n of Object.values(NODES)) {
  if (n.id === GOAL) continue;
  const right = nodeId(n.r, n.c + 1);
  if (NODES[right]) link(n.id, right);
  const down = nodeId(n.r + 1, n.c);
  if (NODES[down]) link(n.id, down);
}
link(GOAL, nodeId(0, 8));
export const NODE_IDS = Object.keys(NODES);

export const START_NODE = Object.fromEntries(Object.entries(HOUSE_COL).map(([k, c]) => [k, nodeId(BOTTOM_ROW, c)]));
export const START_BARRIERS = [
  nodeId(0, 8), nodeId(2, 8), nodeId(3, 8), nodeId(4, 8), nodeId(6, 6), nodeId(6, 10),
  nodeId(10, 0), nodeId(10, 4), nodeId(10, 8), nodeId(10, 12), nodeId(10, 16),
];

// Kürzeste Wege zum Ziel (ohne Hindernisse), nur für Anzeige und Tests
export const DIST_TO_GOAL = (() => {
  const d = { [GOAL]: 0 };
  const q = [GOAL];
  while (q.length) {
    const x = q.shift();
    for (const y of NODES[x].nbrs) if (d[y] === undefined) { d[y] = d[x] + 1; q.push(y); }
  }
  return d;
})();

export const seatColors = (n) => ({ 2: ['R', 'B'], 3: ['R', 'Y', 'B'], 4: ['R', 'G', 'Y', 'B'] }[n]);

// ---------- Spielstand ----------
export function createGame(playerList) {
  const n = playerList.length;
  const cols = seatColors(n);
  if (!cols) throw new Error('Barrikade braucht 2 bis 4 Personen.');
  const players = playerList.map((p, i) => ({ id: p.id, name: p.name, color: cols[i] }));
  const pieces = [];
  for (const p of players) for (let i = 0; i < PIECES_PER_PLAYER; i++) pieces.push({ id: `${p.color}${i}`, color: p.color, pos: 'H' });
  return {
    game: 'bk',
    players,
    pieces, // pos: 'H' (im Haus) oder Feld-Id
    barriers: [...START_BARRIERS], // Sperren auf dem Brett
    hand: 0, // 1, solange eine aufgenommene Sperre noch gesetzt werden muss
    active: 0,
    phase: 'roll', // 'roll' | 'move' | 'place' | 'over'
    die: null,
    dieBy: null,
    rollId: 0,
    turnNo: 1,
    recap: [],
    winner: null,
    endReason: null,
    lastTo: null, // Zielfeld des letzten Zugs (nur für die Anzeige)
  };
}

export const activePlayer = (s) => s.players[s.active];
export const playerById = (s, id) => s.players.find((p) => p.id === id);
const pieceAt = (s, node) => s.pieces.find((p) => p.pos === node);
const log = (s, line) => { s.recap.unshift(line); if (s.recap.length > 5) s.recap.length = 5; };
const who = (p) => `${p.name} (${COLOR_NAMES[p.color]})`;

// ---------- Züge ----------
// Alle Endfelder, die die Figur mit genau n Schritten erreichen kann. Map: Zielfeld -> ein möglicher Weg.
export function targetsFor(s, piece, n, exitCounts = HOUSE_EXIT_COUNTS_START_AS_STEP) {
  const occ = new Map(s.pieces.filter((p) => p.pos !== 'H').map((p) => [p.pos, p]));
  const bar = new Set(s.barriers);
  const out = new Map();
  const visited = new Set();
  const path = [];
  const dfs = (cur, left) => {
    for (const nb of NODES[cur].nbrs) {
      if (visited.has(nb)) continue; // kein Feld zweimal im selben Zug (auch keine Umkehr)
      if (left === 1) {
        const o = occ.get(nb);
        if (o && o.color === piece.color) continue; // nicht auf eigene Figur
        if (!out.has(nb)) out.set(nb, [...path, nb]);
      } else {
        if (bar.has(nb)) continue; // Sperren nicht überspringen
        visited.add(nb); path.push(nb);
        dfs(nb, left - 1);
        visited.delete(nb); path.pop();
      }
    }
  };
  if (piece.pos === 'H') {
    const st = START_NODE[piece.color];
    if (exitCounts) {
      if (n === 1) {
        const o = occ.get(st);
        if (!(o && o.color === piece.color)) out.set(st, [st]);
      } else {
        visited.add(st); path.push(st);
        dfs(st, n - 1);
      }
    } else {
      visited.add(st); // Startfeld zählt nicht als Schritt
      dfs(st, n);
    }
  } else {
    visited.add(piece.pos);
    dfs(piece.pos, n);
  }
  return out;
}

// Alle erlaubten Züge der Person am Zug für den aktuellen Wurf: [{piece, to}]
export function legalMoves(s) {
  if (s.phase !== 'move') return [];
  const color = activePlayer(s).color;
  const res = [];
  for (const p of s.pieces) {
    if (p.color !== color) continue;
    for (const to of targetsFor(s, p, s.die).keys()) res.push({ piece: p.id, to });
  }
  return res;
}

// Felder, auf die eine aufgenommene Sperre gesetzt werden darf: frei und oberhalb der untersten Reihe
export function placeTargets(s) {
  if (s.phase !== 'place') return [];
  const taken = new Set(s.barriers);
  for (const p of s.pieces) if (p.pos !== 'H') taken.add(p.pos);
  return NODE_IDS.filter((id) => id !== GOAL && NODES[id].r < BOTTOM_ROW && !taken.has(id));
}

function nextTurn(s) {
  s.active = (s.active + 1) % s.players.length;
  s.phase = 'roll';
  s.turnNo += 1;
}

export function roll(s, pid, rng = Math.random) {
  if (s.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(s);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (s.phase !== 'roll') return { ok: false, error: 'Du hast schon gewürfelt.' };
  const n = Math.min(6, 1 + Math.floor(rng() * 6));
  s.die = n;
  s.dieBy = pid;
  s.rollId += 1;
  s.phase = 'move';
  if (legalMoves(s).length === 0) {
    log(s, `${who(p)} hat eine ${n} gewürfelt, kann aber nicht ziehen.`);
    nextTurn(s);
    return { ok: true, passed: true, n };
  }
  return { ok: true, passed: false, n };
}

export function move(s, pid, pieceId, to) {
  if (s.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(s);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (s.phase !== 'move') return { ok: false, error: 'Du musst jetzt nicht ziehen.' };
  const piece = s.pieces.find((x) => x.id === pieceId);
  if (!piece || piece.color !== p.color) return { ok: false, error: 'Das ist nicht deine Figur.' };
  if (typeof to !== 'string' || !targetsFor(s, piece, s.die).has(to)) return { ok: false, error: 'Dorthin darfst du mit dieser Figur nicht ziehen.' };
  const n = s.die;
  const fromHouse = piece.pos === 'H';
  let line = `${who(p)} hat eine ${n} gewürfelt und ${fromHouse ? 'eine Figur aus dem Haus gezogen' : 'gezogen'}.`;
  const victim = pieceAt(s, to);
  if (victim) {
    victim.pos = 'H';
    const vp = s.players.find((x) => x.color === victim.color);
    line += ` ${who(vp)} wurde hinausgeworfen.`;
  }
  piece.pos = to;
  s.lastTo = to;
  if (to === GOAL) {
    s.phase = 'over';
    s.winner = p.id;
    s.endReason = `${p.name} hat das Ziel mit genau passendem Wurf erreicht.`;
    log(s, `${who(p)} erreicht das Ziel!`);
    return { ok: true, won: true };
  }
  const bi = s.barriers.indexOf(to);
  if (bi >= 0) {
    s.barriers.splice(bi, 1);
    s.hand = 1;
    s.phase = 'place';
    line += ' Eine Sperre wurde aufgenommen.';
    log(s, line);
    return { ok: true, place: true };
  }
  log(s, line);
  nextTurn(s);
  return { ok: true };
}

export function place(s, pid, node) {
  if (s.phase === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(s);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (s.phase !== 'place') return { ok: false, error: 'Du hast gerade keine Sperre in der Hand.' };
  if (typeof node !== 'string' || !placeTargets(s).includes(node)) return { ok: false, error: 'Dorthin darfst du die Sperre nicht stellen.' };
  s.barriers.push(node);
  s.hand = 0;
  log(s, `${p.name} hat die Sperre neu aufgestellt.`);
  nextTurn(s);
  return { ok: true };
}

// Wie weit ist die nächste Figur einer Person vom Ziel entfernt (kürzester Weg, ohne Hindernisse)?
export function nearestDistance(s, color) {
  let best = Infinity;
  for (const p of s.pieces) {
    if (p.color !== color) continue;
    const d = p.pos === 'H' ? DIST_TO_GOAL[START_NODE[color]] + 1 : DIST_TO_GOAL[p.pos];
    if (d < best) best = d;
  }
  return best;
}

// Siegerin/Sieger zuerst, alle anderen nur zur Info nach der nächsten Figur am Ziel
export function ranking(s) {
  return s.players
    .map((p) => ({ id: p.id, name: p.name, color: p.color, won: s.winner === p.id, dist: nearestDistance(s, p.color) }))
    .sort((a, b) => (Number(b.won) - Number(a.won)) || a.dist - b.dist);
}
