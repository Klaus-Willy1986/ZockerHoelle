// Schiffe versenken – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zwei Personen, 10×10 Felder (Spalten A–J, Zeilen 1–10). Feld-Nummer = Zeile * 10 + Spalte (0..99).
//
// Ablauf: mode 'setup' (beide stellen ihre Flotte auf, dann "fertig") → 'play' (abwechselnd schießen) → 'over'.
// Person 1 der Spielerliste beginnt mit dem Schießen.
//
// Hinweis zur versteckten Information: Der Zustand (beim Gastgeber, und per Netz auch bei den Gästen) enthält technisch
// beide Flotten (g.fleets). Die Oberfläche zeigt nur die eigene. Der Computer bekommt nur seine eigene Sicht (siehe ai.js).

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const COLS = 'ABCDEFGHIJ';
export const FLEET = [
  { id: 'schlachtschiff', name: 'Schlachtschiff', len: 5 },
  { id: 'kreuzer', name: 'Kreuzer', len: 4 },
  { id: 'zerstoerer1', name: 'Zerstörer', len: 3 },
  { id: 'zerstoerer2', name: 'Zerstörer', len: 3 },
  { id: 'uboot', name: 'U-Boot', len: 2 },
];
export const TOTAL = FLEET.reduce((s, f) => s + f.len, 0); // 17

export const other = (i) => 1 - i;
export const cellOf = (x, y) => y * SIZE + x;
export const xOf = (c) => c % SIZE;
export const yOf = (c) => Math.floor(c / SIZE);
export const cellName = (c) => `Spalte ${COLS[xOf(c)]}, Zeile ${yOf(c) + 1}`;
const isInt = (n) => Number.isInteger(n);
const inBoard = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < SIZE && y < SIZE;

export const DEFAULT_OPTS = { touch: false, again: false };
export const normOpts = (o) => ({ touch: !!(o && o.touch), again: !!(o && o.again) });

// ---------- Schiffe und Felder ----------
// Felder eines Schiffs der Länge len, das bei (x,y) beginnt (links bzw. oben); null, wenn es über den Rand ragt.
export function shipCells(len, x, y, dir) {
  if (!inBoard(x, y) || (dir !== 'h' && dir !== 'v')) return null;
  const out = [];
  for (let k = 0; k < len; k++) {
    const cx = dir === 'h' ? x + k : x;
    const cy = dir === 'v' ? y + k : y;
    if (!inBoard(cx, cy)) return null;
    out.push(cellOf(cx, cy));
  }
  return out;
}
export const placed = (s) => s.x !== null && s.y !== null;
export const cellsOf = (s) => (placed(s) ? shipCells(s.len, s.x, s.y, s.dir) || [] : []);
export const allPlaced = (fleet) => fleet.every(placed);
export function neighbors8(c) {
  const x = xOf(c); const y = yOf(c);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && inBoard(x + dx, y + dy)) out.push(cellOf(x + dx, y + dy));
  }
  return out;
}
const emptyFleet = () => FLEET.map((f) => ({ id: f.id, name: f.name, len: f.len, x: null, y: null, dir: 'h' }));

// Darf Schiff `idx` der Flotte `fleet` bei (x,y) in Richtung dir liegen? (die anderen Schiffe der Flotte zählen, das Schiff selbst nicht)
export function checkPlacement(fleet, idx, x, y, dir, touch) {
  const s = fleet[idx];
  if (!s) return { ok: false, error: 'Dieses Schiff gibt es nicht.' };
  const cells = shipCells(s.len, x, y, dir);
  if (!cells) return { ok: false, error: 'Dort passt das Schiff nicht hin. Es ragt über den Rand.' };
  const occ = new Set();
  fleet.forEach((o, i) => { if (i !== idx) cellsOf(o).forEach((c) => occ.add(c)); });
  for (const c of cells) if (occ.has(c)) return { ok: false, error: 'Dort liegt schon ein Schiff.' };
  if (!touch) {
    for (const c of cells) for (const n of neighbors8(c)) {
      if (occ.has(n)) return { ok: false, error: 'Schiffe dürfen sich nicht berühren. Lass ein Feld Abstand.' };
    }
  }
  return { ok: true, cells };
}

// Zufällige, regelkonforme Flotte (alle Schiffe gesetzt). Immer gültig.
export function randomFleet(opts, rng = Math.random) {
  const touch = !!(opts && opts.touch);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const fleet = emptyFleet();
    let ok = true;
    for (let i = 0; i < fleet.length && ok; i++) {
      const cands = [];
      for (const dir of ['h', 'v']) {
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          if (checkPlacement(fleet, i, x, y, dir, touch).ok) cands.push([x, y, dir]);
        }
      }
      if (!cands.length) { ok = false; break; }
      const [x, y, dir] = cands[Math.min(cands.length - 1, Math.floor(rng() * cands.length))];
      Object.assign(fleet[i], { x, y, dir });
    }
    if (ok) return fleet;
  }
  // Notlösung (wird praktisch nie gebraucht): feste, gültige Aufstellung
  const fleet = emptyFleet();
  fleet.forEach((s, i) => Object.assign(s, { x: 0, y: i * 2, dir: 'h' }));
  return fleet;
}

// ---------- Spielstart ----------
// prev: das vorige (beendete) Spiel derselben Personen – davon werden Punktestand und Rundenzahl übernommen.
export function createGame(playerList, opts = DEFAULT_OPTS, rng = Math.random, prev = null) {
  const players = playerList.slice(0, 2).map((p) => ({ id: p.id, name: p.name }));
  const score = {};
  players.forEach((p) => { score[p.id] = 0; });
  let round = 1;
  if (prev && prev.score && Array.isArray(prev.players) && players.every((p) => prev.players.some((q) => q.id === p.id))) {
    players.forEach((p) => { score[p.id] = Number(prev.score[p.id]) || 0; });
    round = (Number(prev.round) || 1) + 1;
  }
  return {
    game: 'sv',
    mode: 'setup', // 'setup' | 'play' | 'over'
    players,
    opts: normOpts(opts),
    fleets: [emptyFleet(), emptyFleet()],
    ready: [false, false],
    grid: [Array(CELLS).fill(null), Array(CELLS).fill(null)], // grid[i]: Schüsse von Person i: null | 'w' Wasser | 'h' Treffer | 's' versenkt
    sunk: [[], []], // sunk[i]: von Person i versenkte Schiffe { id, name, len, cells }
    hits: [0, 0], // Treffer von Person i (0..17)
    turn: 0,
    moveNo: 0,
    last: null, // { by, cell, r: 'w'|'h'|'s', ship }
    recap: [],
    winner: null,
    score,
    round,
  };
}

// ---------- Abfragen ----------
export const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const shipAt = (fleet, c) => fleet.findIndex((s) => cellsOf(s).includes(c));
export const shotsLeft = (g, i) => g.grid[i].map((v, c) => (v === null ? c : -1)).filter((c) => c >= 0);
export const legalShots = (g) => (g.mode === 'play' ? shotsLeft(g, g.turn) : []);
// Schiffe der Person i, die noch schwimmen (Liste von Indizes in g.fleets[i])
export const afloat = (g, i) => g.fleets[i].map((s, k) => (g.sunk[other(i)].some((u) => u.id === s.id) ? -1 : k)).filter((k) => k >= 0);
// Restflotte der Person i, nur aus öffentlichen Angaben (versenkte Schiffe stehen in g.sunk)
export const remainingDefs = (g, i) => FLEET.filter((f) => !g.sunk[other(i)].some((u) => u.id === f.id));
export const allShipsPlaced = (g, i) => allPlaced(g.fleets[i]);

// ---------- Aufstellen ----------
function checkSetup(g, pid) {
  if (!g || g.mode !== 'setup') return { ok: false, error: 'Das Aufstellen ist vorbei.' };
  const i = idxOf(g, pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.ready[i]) return { ok: false, error: 'Du bist schon fertig.' };
  return { ok: true, i };
}

export function placeShip(g, pid, idx, x, y, dir) {
  const c = checkSetup(g, pid);
  if (!c.ok) return c;
  if (!isInt(idx) || idx < 0 || idx >= FLEET.length) return { ok: false, error: 'Dieses Schiff gibt es nicht.' };
  const r = checkPlacement(g.fleets[c.i], idx, x, y, dir, g.opts.touch);
  if (!r.ok) return r;
  Object.assign(g.fleets[c.i][idx], { x, y, dir });
  g.moveNo += 1;
  return { ok: true };
}

export function randomize(g, pid, rng = Math.random) {
  const c = checkSetup(g, pid);
  if (!c.ok) return c;
  g.fleets[c.i] = randomFleet(g.opts, rng);
  g.moveNo += 1;
  return { ok: true };
}

export function setReady(g, pid) {
  const c = checkSetup(g, pid);
  if (!c.ok) return c;
  if (!allPlaced(g.fleets[c.i])) return { ok: false, error: 'Stelle zuerst alle fünf Schiffe auf.' };
  g.ready[c.i] = true;
  g.moveNo += 1;
  if (g.ready[0] && g.ready[1]) {
    g.mode = 'play';
    g.turn = 0;
    g.recap = [`Alle Schiffe stehen. ${g.players[0].name} schießt zuerst.`];
  }
  return { ok: true };
}

// ---------- Schießen ----------
export function shoot(g, pid, x, y) {
  if (!g || g.mode !== 'play') return { ok: false, error: 'Es wird gerade nicht geschossen.' };
  const i = idxOf(g, pid);
  if (i < 0) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.turn !== i) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (!inBoard(x, y)) return { ok: false, error: 'Dieses Feld gibt es nicht.' };
  const c = cellOf(x, y);
  if (g.grid[i][c] !== null) return { ok: false, error: 'Auf dieses Feld hast du schon geschossen.' };
  const opp = other(i);
  const k = shipAt(g.fleets[opp], c);
  let r = 'w';
  let ship = null;
  if (k < 0) {
    g.grid[i][c] = 'w';
  } else {
    r = 'h';
    g.grid[i][c] = 'h';
    g.hits[i] += 1;
    const s = g.fleets[opp][k];
    const cells = cellsOf(s);
    if (cells.every((q) => g.grid[i][q] !== null)) {
      r = 's';
      ship = { id: s.id, name: s.name, len: s.len };
      cells.forEach((q) => { g.grid[i][q] = 's'; });
      g.sunk[i].push({ id: s.id, name: s.name, len: s.len, cells });
    }
  }
  g.moveNo += 1;
  g.last = { by: i, cell: c, r, ship: ship ? ship.name : null };
  const nm = g.players[i].name;
  const where = cellName(c);
  g.recap = [`${nm} schießt auf ${where}: ${r === 'w' ? 'Wasser' : r === 'h' ? 'Treffer' : `Treffer, versenkt: ${ship.name}`}.`];
  if (g.hits[i] >= TOTAL) {
    g.mode = 'over';
    g.winner = i;
    g.score[pid] = (g.score[pid] || 0) + 1;
    return { ok: true, r, ship: ship ? ship.name : null, over: true };
  }
  if (!(r !== 'w' && g.opts.again)) g.turn = opp;
  return { ok: true, r, ship: ship ? ship.name : null };
}

// Nachrichten vom Netz: nie eine Ausnahme, nie ein beschädigter Zustand.
export function handle(g, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  try {
    switch (msg.t) {
      case 'place': return placeShip(g, pid, msg.ship, msg.x, msg.y, msg.dir);
      case 'random': return randomize(g, pid, rng);
      case 'ready': return setReady(g, pid);
      case 'shoot': return shoot(g, pid, msg.x, msg.y);
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch {
    return { ok: false, error: 'Das hat nicht geklappt.' };
  }
}
