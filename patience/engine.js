// Patience (Klondike und FreeCell) – reine Spiellogik, JSON-Zustand, keine Oberfläche.
// Karte = Zahl 0..51: id = Farbe * 13 + (Rang - 1). Farben: 0 ♣, 1 ♠, 2 ♥, 3 ♦ (2 und 3 sind rot). Rang 1 = Ass … 13 = König.
// Zustand: tab (Spalten, unten → oben), down (Klondike: Anzahl verdeckter Karten unten in jeder Spalte), stock (oberste = letzte),
// waste (oberste = letzte), found[Farbe] = Anzahl Karten auf dem Zielstapel, cells (Freie Zellen, null = leer).

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANK_SYM = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];
export const RANK_NAME = ['', 'Ass', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Bube', 'Dame', 'König'];
export const CELL_COUNT = 4;

export const cardSuit = (c) => Math.floor(c / 13);
export const cardRank = (c) => (c % 13) + 1;
export const isRed = (c) => cardSuit(c) >= 2;
export const cardName = (c) => `${SUITS[cardSuit(c)].name} ${RANK_NAME[cardRank(c)]}`;
export const mkCard = (suit, rank) => suit * 13 + rank - 1;

const isInt = (v) => Number.isInteger(v);
const validCard = (c) => isInt(c) && c >= 0 && c < 52;

// Zufallszahlen aus einem Startwert (damit "Nochmal dasselbe Spiel" dieselbe Verteilung gibt).
export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(seed) {
  const r = seeded(seed);
  const a = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function dealInto(g, seed) {
  const d = shuffled(seed);
  g.seed = seed;
  g.found = [0, 0, 0, 0];
  g.cells = [null, null, null, null];
  g.waste = [];
  g.moves = 0;
  g.undo = [];
  g.elapsed = 0;
  g.result = null;
  g.mode = 'play';
  if (g.free) {
    g.tab = Array.from({ length: 8 }, () => []);
    d.forEach((c, i) => g.tab[i % 8].push(c));
    g.down = new Array(8).fill(0);
    g.stock = [];
  } else {
    g.tab = Array.from({ length: 7 }, () => []);
    g.down = [];
    let p = 0;
    for (let i = 0; i < 7; i++) { for (let k = 0; k <= i; k++) g.tab[i].push(d[p++]); g.down.push(i); }
    g.stock = d.slice(p);
  }
}

export function createGame(playerList, opts, rng = Math.random) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const list = Array.isArray(playerList) && playerList.length ? playerList : [{ id: 'p0', name: 'Du' }];
  const g = {
    game: 'pt',
    free: !!o.free,
    draw3: !o.free && !!o.draw3,
    players: [{ id: list[0].id, name: list[0].name }],
  };
  const seed = isInt(o.seed) && o.seed > 0 ? o.seed : Math.floor(rng() * 2147483646) + 1;
  dealInto(g, seed);
  return g;
}

// Feste, kleine Übungsverteilung für die Lernrunde (Klondike, eine Karte ziehen). 52 Karten bleiben im Spiel.
export function learnGame(playerList) {
  const c = mkCard;
  const g = {
    game: 'pt', free: false, draw3: false, learn: true,
    players: [{ id: (playerList && playerList[0] && playerList[0].id) || 'p0', name: (playerList && playerList[0] && playerList[0].name) || 'Du' }],
    seed: 1, mode: 'play', moves: 0, undo: [], elapsed: 0, result: null,
    found: [9, 8, 9, 9],
    cells: [null, null, null, null],
    waste: [],
    stock: [c(2, 13), c(3, 10), c(1, 9)], // gezogen wird zuerst Pik 9, dann Karo 10, dann Herz König
    tab: [
      [c(1, 13), c(2, 11)],
      [c(0, 12)],
      [c(0, 13), c(1, 10)],
      [c(3, 13), c(1, 11)],
      [c(2, 12), c(1, 12)],
      [c(0, 11), c(0, 10)],
      [c(3, 12), c(3, 11), c(2, 10)],
    ],
    down: [1, 0, 1, 1, 1, 1, 2],
  };
  return g;
}

// Fast gelöste Verteilung zum Testen der Ergebnis-Seite (Hook ?preset=). Zwei Züge bis zum Sieg.
export function presetGame(playerList, kind) {
  const free = kind === 'freecell';
  const g = createGame(playerList, { free });
  g.found = [13, 12, 12, 13];
  g.tab = Array.from({ length: free ? 8 : 7 }, () => []);
  g.tab[0] = [mkCard(1, 13)];
  g.tab[1] = [mkCard(2, 13)];
  g.down = new Array(g.tab.length).fill(0);
  g.stock = []; g.waste = []; g.cells = [null, null, null, null];
  g.seed = 7;
  return g;
}

// ---------- Abfragen ----------
const colTop = (col) => (col.length ? col[col.length - 1] : null);
export const stockLeft = (g) => g.stock.length;
export const freeCells = (g) => g.cells.filter((c) => c === null).length;
export const emptyCols = (g) => g.tab.filter((c) => c.length === 0).length;
export const isWon = (g) => !!g && Array.isArray(g.found) && g.found.every((n) => n === 13);
export const foundCount = (g) => g.found.reduce((a, b) => a + b, 0);

// Passt b (Karte, die man ablegt) auf a (Karte, die schon liegt)? Absteigend und abwechselnde Farben.
export const fitsOn = (a, b) => cardRank(a) === cardRank(b) + 1 && isRed(a) !== isRed(b);
export function isRun(cards) {
  for (let i = 1; i < cards.length; i++) if (!fitsOn(cards[i - 1], cards[i])) return false;
  return true;
}

// Wie viele Karten dürfen auf einmal auf Spalte toCol (oder, bei -1, irgendeine nicht-leere Spalte) ziehen?
export function countMovable(g, toCol = -1) {
  if (!g.free) return 52;
  let empties = emptyCols(g);
  if (isInt(toCol) && toCol >= 0 && toCol < g.tab.length && g.tab[toCol].length === 0) empties--;
  return (freeCells(g) + 1) * 2 ** Math.max(0, empties);
}

// Die Karten, die bei "from" gemeint sind (leer, wenn ungültig/verdeckt/keine zusammenhängende Reihe).
export function cardsAt(g, from) {
  if (!g || !from || typeof from !== 'object') return [];
  if (from.k === 't') {
    const col = isInt(from.i) ? g.tab[from.i] : null;
    if (!col || !isInt(from.j) || from.j < g.down[from.i] || from.j >= col.length) return [];
    const run = col.slice(from.j);
    return isRun(run) ? run : [];
  }
  if (from.k === 'w') return g.waste.length ? [colTop(g.waste)] : [];
  if (from.k === 'c') return isInt(from.i) && validCard(g.cells[from.i]) ? [g.cells[from.i]] : [];
  return [];
}

// Darf die Reihe cards auf das Ziel to? (from nur nötig, um "leere Spalte auf leere Spalte" auszuschließen)
export function canPlace(g, cards, to, from) {
  if (!cards.length || !to || typeof to !== 'object') return false;
  const lead = cards[0];
  if (to.k === 'f') return cards.length === 1 && g.found[cardSuit(lead)] === cardRank(lead) - 1;
  if (to.k === 'c') {
    if (from && from.k === 'c') return false;
    if (!g.free || cards.length !== 1 || !isInt(to.i) || to.i < 0 || to.i >= CELL_COUNT) return false;
    return g.cells[to.i] === null;
  }
  if (to.k === 't') {
    if (!isInt(to.i) || to.i < 0 || to.i >= g.tab.length) return false;
    if (from && from.k === 't' && from.i === to.i) return false;
    if (cards.length > countMovable(g, to.i)) return false;
    const col = g.tab[to.i];
    if (!col.length) {
      if (from && from.k === 't' && from.j === 0) return false; // ganze Spalte in leere Spalte: sinnlos
      return g.free ? true : cardRank(lead) === 13;
    }
    return fitsOn(colTop(col), lead);
  }
  return false;
}

// Alle erlaubten Ziele für die Karten bei "from": [{k:'f'},{k:'t',i},{k:'c',i}]
export function legalMovesFrom(g, from) {
  const cards = cardsAt(g, from);
  if (!cards.length) return [];
  const out = [];
  if (canPlace(g, cards, { k: 'f' }, from)) out.push({ k: 'f' });
  for (let i = 0; i < g.tab.length; i++) if (canPlace(g, cards, { k: 't', i }, from)) out.push({ k: 't', i });
  if (g.free && cards.length === 1 && !(from.k === 'c')) {
    const i = g.cells.indexOf(null);
    if (i >= 0) out.push({ k: 'c', i });
  }
  return out;
}

// ---------- Ausführen (ohne Prüfung, intern) ----------
const snapshot = (g) => JSON.stringify([g.tab, g.down, g.stock, g.waste, g.found, g.cells, g.moves]);
function restore(g, s) {
  const [tab, down, stock, waste, found, cells, moves] = JSON.parse(s);
  Object.assign(g, { tab, down, stock, waste, found, cells, moves });
}
function fixFlip(g, i) {
  const col = g.tab[i];
  if (col.length && g.down[i] >= col.length) g.down[i] = col.length - 1;
  if (!col.length) g.down[i] = 0;
}
function doMove(g, from, to) {
  const cards = cardsAt(g, from);
  if (from.k === 't') { g.tab[from.i].length = from.j; fixFlip(g, from.i); }
  else if (from.k === 'w') g.waste.pop();
  else g.cells[from.i] = null;
  if (to.k === 'f') g.found[cardSuit(cards[0])]++;
  else if (to.k === 'c') g.cells[to.i] = cards[0];
  else g.tab[to.i].push(...cards);
  g.moves++;
}
function doDraw(g) {
  if (g.stock.length) {
    const n = Math.min(g.draw3 ? 3 : 1, g.stock.length);
    for (let k = 0; k < n; k++) g.waste.push(g.stock.pop());
  } else {
    g.stock = g.waste.slice().reverse();
    g.waste = [];
  }
  g.moves++;
}
const canDraw = (g) => !g.free && (g.stock.length > 0 || g.waste.length > 0);

// ---------- Automatisch ablegen ----------
// Wann ist das Spiel nur noch "Ablegen"? Klondike: alle Spalten ganz offen. FreeCell: jede Spalte ist eine geordnete Reihe.
function autoCondition(g) {
  if (!g || g.mode !== 'play' || isWon(g)) return false;
  if (g.free) return g.tab.every((col) => isRun(col));
  return g.tab.every((col, i) => col.length === 0 || g.down[i] === 0);
}
export const autoAvailable = (g) => autoCondition(g) && autoMoves(g).length > 0;

function foundationStep(g) {
  for (let i = 0; i < g.tab.length; i++) {
    const col = g.tab[i];
    if (col.length && col.length > g.down[i]) {
      const f = { k: 't', i, j: col.length - 1 };
      if (canPlace(g, [col[col.length - 1]], { k: 'f' }, f)) return { from: f, to: { k: 'f' } };
    }
  }
  if (g.waste.length && canPlace(g, [colTop(g.waste)], { k: 'f' })) return { from: { k: 'w' }, to: { k: 'f' } };
  for (let i = 0; i < CELL_COUNT; i++) {
    if (validCard(g.cells[i]) && canPlace(g, [g.cells[i]], { k: 'f' })) return { from: { k: 'c', i }, to: { k: 'f' } };
  }
  return null;
}

// Liste der Schritte (auf einer Kopie berechnet): [{t:'move',from,to} | {t:'draw'}], endet mit dem letzten Ablegen.
export function autoMoves(g) {
  if (!autoCondition(g)) return [];
  const c = JSON.parse(JSON.stringify(g));
  const steps = [];
  let lastGood = 0, idle = 0;
  for (let guard = 0; guard < 600; guard++) {
    if (isWon(c)) break;
    const s = foundationStep(c);
    if (s) { steps.push({ t: 'move', from: s.from, to: s.to }); doMove(c, s.from, s.to); lastGood = steps.length; idle = 0; continue; }
    if (!canDraw(c) || idle > c.stock.length + c.waste.length + 1) break;
    steps.push({ t: 'draw' }); doDraw(c); idle++;
  }
  return steps.slice(0, lastGood);
}

function finish(g) {
  if (isWon(g)) { g.mode = 'over'; g.result = { moves: g.moves, ms: g.elapsed }; }
}

const isPlayer = (g, pid) => !!g && Array.isArray(g.players) && g.players.length > 0 && g.players[0].id === pid;
const okShape = (g) => g && typeof g === 'object' && Array.isArray(g.tab) && Array.isArray(g.stock) && Array.isArray(g.undo);

function setTime(g, ms) {
  if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms < 1e9) g.elapsed = Math.floor(Math.max(ms, g.elapsed || 0));
}

function push(g) { g.undo.push(snapshot(g)); }

export function move(g, pid, from, to) {
  if (!okShape(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  const cards = cardsAt(g, from);
  if (!cards.length) return { ok: false, error: 'Diese Karte kann nicht bewegt werden.' };
  if (!canPlace(g, cards, to, from)) return { ok: false, error: 'Dort kannst du die Karte nicht ablegen.' };
  push(g);
  doMove(g, from, to);
  finish(g);
  return { ok: true };
}

export function draw(g, pid) {
  if (!okShape(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (!canDraw(g)) return { ok: false, error: 'Hier gibt es keinen Stapel zum Ziehen.' };
  push(g);
  doDraw(g);
  return { ok: true };
}

export function auto(g, pid) {
  if (!okShape(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  const steps = autoMoves(g);
  if (!steps.length) return { ok: false, error: 'Es gibt noch nichts automatisch abzulegen.' };
  push(g);
  for (const s of steps) { if (s.t === 'draw') doDraw(g); else doMove(g, s.from, s.to); }
  finish(g);
  return { ok: true, steps: steps.length };
}

export function undo(g, pid) {
  if (!okShape(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (!g.undo.length) return { ok: false, error: 'Es gibt noch nichts zurückzunehmen.' };
  restore(g, g.undo.pop());
  g.mode = 'play';
  g.result = null;
  return { ok: true };
}

export function handle(g, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: 'Ungültige Nachricht.' };
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return { ok: false, error: 'Ungültiger Spielstand.' };
  switch (msg.t) {
    case 'move': setTime(g, msg.ms); return move(g, pid, msg.from, msg.to);
    case 'draw': setTime(g, msg.ms); return draw(g, pid);
    case 'auto': setTime(g, msg.ms); return auto(g, pid);
    case 'undo': return undo(g, pid);
    case 'sync': if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' }; if (g.mode === 'play') setTime(g, msg.ms); return { ok: true };
    case 'again': {
      if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
      if (g.learn) { const lg = learnGame(g.players); for (const k of Object.keys(g)) delete g[k]; Object.assign(g, lg); return { ok: true }; }
      dealInto(g, g.seed);
      return { ok: true };
    }
    case 'new': {
      if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
      const ng = createGame(g.players, { free: !!msg.free, draw3: !!msg.draw3 }, rng);
      for (const k of Object.keys(g)) delete g[k];
      Object.assign(g, ng);
      return { ok: true };
    }
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}

// Ergebnis für die Bestenliste (ein Spieler).
export const ranking = (g) => (g && g.players ? g.players.map((p) => ({ id: p.id, name: p.name, moves: g.moves, won: isWon(g) })) : []);
export const better = (a, b) => {
  if (!a || !Number.isFinite(a.moves)) return false;
  if (!b || !Number.isFinite(b.moves)) return true;
  return a.moves < b.moves || (a.moves === b.moves && Number.isFinite(a.ms) && Number.isFinite(b.ms) && a.ms < b.ms);
};
export const fmtTime = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const cardTotal = (g) => g.tab.reduce((n, c) => n + c.length, 0) + g.stock.length + g.waste.length + foundCount(g) + g.cells.filter((c) => c !== null).length;
