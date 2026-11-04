// Farbenwürfeln – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.

export const COLS = 15;
export const ROWS = 7;
export const START_COL = 7; // Spalte H
export const MAX_CELLS = 5;
export const START_JOKERS = 8;
export const SOLO_THROWS = 30;
export const FREE_THROWS = 3; // in den ersten 3 Würfen wählen alle aus allen Würfeln
export const LETTERS = 'ABCDEFGHIJKLMNO'.split('');
export const COLORS = ['G', 'Y', 'B', 'P', 'O'];
export const COLOR_NAMES = { G: 'Grün', Y: 'Gelb', B: 'Blau', P: 'Pink', O: 'Orange' };
// Wortformen für Sätze („1 grünes Feld“, „4 grüne Felder“)
export const COLOR_ONE = { G: 'grünes', Y: 'gelbes', B: 'blaues', P: 'pinkes', O: 'oranges' };
export const COLOR_MANY = { G: 'grüne', Y: 'gelbe', B: 'blaue', P: 'pinke', O: 'orange' };
export const COL_TOP = [5, 3, 3, 3, 2, 2, 2, 1, 2, 2, 2, 3, 3, 3, 5];
export const COL_LOW = [3, 2, 2, 2, 1, 1, 1, 0, 1, 1, 1, 2, 2, 2, 3];
export const COLOR_TOP = 5;
export const COLOR_LOW = 3;
export const STAR_PENALTY = 2;
export const COLOR_FACES = ['G', 'Y', 'B', 'P', 'O', 'X']; // X = Joker (schwarzes Kreuz)
export const NUM_FACES = [1, 2, 3, 4, 5, '?']; // ? = Joker

// Zeile 1 oben … Zeile 7 unten, Spalten A–O. Ein * hinter dem Buchstaben = Sternfeld.
const SHEET = [
  'G G G Y Y Y Y G* B B B O* Y Y Y',
  'O G Y* G Y* Y O O P B* B O O G G',
  'B* G P G G G G* P P P Y Y O G G',
  'B P P G O O* B B G G Y Y O P* B',
  'P O O O O P B B O O O P P P P',
  'P B* B P* P P P Y Y* O P* B B B O*',
  'Y Y B B B B P Y Y Y G G G* O O',
].map((r) => r.split(' '));

export const CELL_COLOR = [];
export const IS_STAR = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const t = SHEET[r][c];
    CELL_COLOR.push(t[0]);
    IS_STAR.push(t.length > 1);
  }
}
export const NCELLS = ROWS * COLS;
export const idx = (r, c) => r * COLS + c;
export const rowOf = (i) => Math.floor(i / COLS);
export const colOf = (i) => i % COLS;
export const cellName = (i) => `${LETTERS[colOf(i)]}${rowOf(i) + 1}`;

export const NEIGHBORS = Array.from({ length: NCELLS }, (_, i) => {
  const r = rowOf(i); const c = colOf(i);
  const n = [];
  if (r > 0) n.push(i - COLS);
  if (r < ROWS - 1) n.push(i + COLS);
  if (c > 0) n.push(i - 1);
  if (c < COLS - 1) n.push(i + 1);
  return n;
});

// Farbblöcke (zusammenhängende Gebiete gleicher Farbe)
export const BLOCK_OF = Array(NCELLS).fill(-1);
export const BLOCKS = [];
for (let i = 0; i < NCELLS; i++) {
  if (BLOCK_OF[i] >= 0) continue;
  const id = BLOCKS.length;
  const cells = [];
  const stack = [i];
  BLOCK_OF[i] = id;
  while (stack.length) {
    const x = stack.pop();
    cells.push(x);
    for (const y of NEIGHBORS[x]) if (BLOCK_OF[y] < 0 && CELL_COLOR[y] === CELL_COLOR[i]) { BLOCK_OF[y] = id; stack.push(y); }
  }
  BLOCKS.push({ id, color: CELL_COLOR[i], cells: cells.sort((a, b) => a - b) });
}
export const COLOR_CELLS = Object.fromEntries(COLORS.map((c) => [c, CELL_COLOR.map((x, i) => (x === c ? i : -1)).filter((i) => i >= 0)]));
export const COL_CELLS = Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => idx(r, c)));
export const STARS = IS_STAR.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);

// ---------- Platzierung ----------
const hasMarks = (x) => x.some((v) => v);
const isStartCell = (x, i) => colOf(i) === START_COL || NEIGHBORS[i].some((n) => x[n]);

// Größte zusammenhängende freie Fläche einer Farbe, in der man überhaupt beginnen darf.
export function maxRun(x, color) {
  let best = 0;
  const seen = new Set();
  for (const s of COLOR_CELLS[color]) {
    if (x[s] || seen.has(s) || !isStartCell(x, s)) continue;
    let size = 0;
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const a = stack.pop();
      size++;
      for (const b of NEIGHBORS[a]) if (!x[b] && CELL_COLOR[b] === color && !seen.has(b)) { seen.add(b); stack.push(b); }
    }
    best = Math.max(best, size);
  }
  return Math.min(best, MAX_CELLS);
}

// Prüft eine Auswahl von Feldern (Indizes). Gibt Fehlertext oder null zurück.
export function checkCells(x, color, n, cells) {
  if (!Array.isArray(cells) || cells.length !== n) return `Es müssen genau ${n} Felder angekreuzt werden.`;
  const set = new Set();
  for (const i of cells) {
    if (!Number.isInteger(i) || i < 0 || i >= NCELLS) return 'Dieses Feld gibt es nicht.';
    if (set.has(i)) return 'Ein Feld wurde doppelt gewählt.';
    set.add(i);
  }
  for (const i of cells) {
    if (x[i]) return 'Ein Feld ist schon angekreuzt.';
    if (CELL_COLOR[i] !== color) return 'Alle Felder müssen die gewählte Farbe haben.';
  }
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const a = stack.pop();
    for (const b of NEIGHBORS[a]) if (set.has(b) && !seen.has(b)) { seen.add(b); stack.push(b); }
  }
  if (seen.size !== cells.length) return 'Die Felder müssen waagerecht oder senkrecht zusammenhängen.';
  if (!cells.some((i) => isStartCell(x, i))) {
    return hasMarks(x) ? 'Die Felder müssen an ein angekreuztes Feld grenzen oder in Spalte H beginnen.' : 'Das erste Kreuz muss in Spalte H stehen.';
  }
  return null;
}

// Alle erlaubten Feldgruppen (sortierte Index-Listen) für Farbe und Zahl.
export function legalGroups(x, color, n) {
  if (!COLORS.includes(color) || !Number.isInteger(n) || n < 1 || n > MAX_CELLS) return [];
  let level = new Map();
  for (const i of COLOR_CELLS[color]) if (!x[i]) level.set(String(i), [i]);
  for (let k = 1; k < n; k++) {
    const next = new Map();
    for (const g of level.values()) {
      const inG = new Set(g);
      for (const a of g) {
        for (const b of NEIGHBORS[a]) {
          if (inG.has(b) || x[b] || CELL_COLOR[b] !== color) continue;
          const ng = [...g, b].sort((p, q) => p - q);
          const key = ng.join(',');
          if (!next.has(key)) next.set(key, ng);
        }
      }
    }
    level = next;
  }
  return [...level.values()].filter((g) => g.some((i) => isStartCell(x, i)));
}

// ---------- Blatt & Wertung ----------
export const emptyMarks = () => Array(NCELLS).fill(0);
export const colComplete = (x, c) => COL_CELLS[c].every((i) => x[i]);
export const colorComplete = (x, color) => COLOR_CELLS[color].every((i) => x[i]);
export const colorsDone = (p) => COLORS.filter((c) => colorComplete(p.x, c));
export const colsDone = (p) => Array.from({ length: COLS }, (_, c) => c).filter((c) => colComplete(p.x, c));
export const markCount = (p) => p.x.reduce((s, v) => s + v, 0);
export const colorProgress = (p, color) => COLOR_CELLS[color].filter((i) => p.x[i]).length;
export const missingStars = (p) => STARS.filter((i) => !p.x[i]).length;

export function scoreOf(p) {
  const colors = COLORS.reduce((s, c) => s + (p.colorPts[c] || 0), 0);
  const cols = p.colPts.reduce((s, v) => s + (v || 0), 0);
  const jokers = p.jokers;
  const stars = -STAR_PENALTY * missingStars(p);
  return { colors, cols, jokers, stars, total: colors + cols + jokers + stars };
}

// ---------- Spielstand ----------
export function createGame(playerList) {
  const solo = playerList.length === 1;
  return {
    game: 'fw',
    mode: 'play', // 'play' | 'over'
    phase: 'roll', // 'roll' | 'all' | 'active' | 'others' | 'over'
    solo,
    players: playerList.map((p) => ({
      id: p.id, name: p.name, x: emptyMarks(), jokers: START_JOKERS,
      colPts: Array(COLS).fill(null), colorPts: Object.fromEntries(COLORS.map((c) => [c, null])), last: [],
    })),
    active: 0,
    throwNo: 0,
    rollId: 0,
    dice: null, // { c: [...], n: [...] }
    gone: null, // { c: [bool], n: [bool] }
    picks: {}, // id -> null (gepasst) | { ci, ni, color, num, cost, cells }
    auto: {},
    colTaken: Array(COLS).fill(false),
    colorTaken: Object.fromEntries(COLORS.map((c) => [c, false])),
    recap: [],
    endReason: null,
  };
}

export const activePlayer = (s) => s.players[s.active];
export const playerById = (s, id) => s.players.find((p) => p.id === id);
const rollIdx = (rng) => Math.min(5, Math.floor(rng() * 6));

// Welche Farben / Zahlen kann man mit diesem Würfel wählen?
const faceColors = (face) => (face === 'X' ? COLORS : [face]);
const faceNums = (face) => (face === '?' ? [1, 2, 3, 4, 5] : [face]);

// Gibt es für diese Person mit den noch liegenden Würfeln überhaupt eine Möglichkeit?
export function hasMove(state, pid) {
  const p = playerById(state, pid);
  if (!p || !state.dice) return false;
  const runs = {};
  for (const c of COLORS) runs[c] = maxRun(p.x, c);
  for (let ci = 0; ci < state.dice.c.length; ci++) {
    if (state.gone.c[ci]) continue;
    for (let ni = 0; ni < state.dice.n.length; ni++) {
      if (state.gone.n[ni]) continue;
      const cost = (state.dice.c[ci] === 'X' ? 1 : 0) + (state.dice.n[ni] === '?' ? 1 : 0);
      if (cost > p.jokers) continue;
      for (const col of faceColors(state.dice.c[ci])) for (const n of faceNums(state.dice.n[ni])) if (n <= runs[col]) return true;
    }
  }
  return false;
}

export function waitingFor(state) {
  if (state.mode !== 'play') return [];
  const ids = state.players.map((p) => p.id);
  let who = [];
  if (state.phase === 'all') who = ids;
  else if (state.phase === 'active') who = [activePlayer(state).id];
  else if (state.phase === 'others') who = ids.filter((id) => id !== activePlayer(state).id);
  return who.filter((id) => !(id in state.picks));
}

function startStep(state) {
  for (const id of waitingFor(state)) {
    if (!hasMove(state, id)) { state.picks[id] = null; state.auto[id] = true; }
  }
  advance(state);
}

export function roll(state, pid, rng = Math.random) {
  if (!state || state.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (state.phase !== 'roll') return { ok: false, error: 'Es kann gerade nicht gewürfelt werden.' };
  if (activePlayer(state).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const k = state.solo ? 2 : 3;
  state.dice = { c: Array.from({ length: k }, () => COLOR_FACES[rollIdx(rng)]), n: Array.from({ length: k }, () => NUM_FACES[rollIdx(rng)]) };
  state.gone = { c: Array(k).fill(false), n: Array(k).fill(false) };
  state.throwNo += 1;
  state.rollId += 1;
  state.picks = {};
  state.auto = {};
  for (const p of state.players) p.last = [];
  state.phase = state.solo || state.throwNo <= FREE_THROWS ? 'all' : 'active';
  startStep(state);
  return { ok: true };
}

// Wahl einer Person: msg = null (passen) oder { ci, ni, color?, num?, cells }.
export function submit(state, pid, msg) {
  if (!state || state.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!['all', 'active', 'others'].includes(state.phase)) return { ok: false, error: 'Gerade ist keine Auswahl nötig.' };
  const p = playerById(state, pid);
  if (!p) return { ok: false, error: 'Unbekannte Person.' };
  if (pid in state.picks) return { ok: false, error: 'Du hast schon gewählt.' };
  if (!waitingFor(state).includes(pid)) return { ok: false, error: 'Du bist gerade nicht an der Reihe.' };
  if (msg === null || msg === undefined) {
    state.picks[pid] = null;
    advance(state);
    return { ok: true };
  }
  if (typeof msg !== 'object') return { ok: false, error: 'Ungültige Wahl.' };
  const { ci, ni } = msg;
  if (!Number.isInteger(ci) || ci < 0 || ci >= state.dice.c.length || state.gone.c[ci]) return { ok: false, error: 'Dieser Farbwürfel ist nicht mehr da.' };
  if (!Number.isInteger(ni) || ni < 0 || ni >= state.dice.n.length || state.gone.n[ni]) return { ok: false, error: 'Dieser Zahlenwürfel ist nicht mehr da.' };
  const cf = state.dice.c[ci];
  const nf = state.dice.n[ni];
  let color = cf;
  if (cf === 'X') { if (!COLORS.includes(msg.color)) return { ok: false, error: 'Bitte wähle eine Farbe für den Joker.' }; color = msg.color; }
  else if (msg.color !== undefined && msg.color !== null && msg.color !== cf) return { ok: false, error: 'Die Farbe passt nicht zum Würfel.' };
  let num = nf;
  if (nf === '?') { if (!Number.isInteger(msg.num) || msg.num < 1 || msg.num > MAX_CELLS) return { ok: false, error: 'Bitte wähle eine Zahl von 1 bis 5 für den Joker.' }; num = msg.num; }
  else if (msg.num !== undefined && msg.num !== null && msg.num !== nf) return { ok: false, error: 'Die Zahl passt nicht zum Würfel.' };
  const cost = (cf === 'X' ? 1 : 0) + (nf === '?' ? 1 : 0);
  if (cost > p.jokers) return { ok: false, error: 'Dafür hast du nicht genug Ausrufezeichen.' };
  const err = checkCells(p.x, color, num, msg.cells);
  if (err) return { ok: false, error: err };
  for (const i of msg.cells) p.x[i] = 1;
  p.jokers -= cost;
  p.last = [...msg.cells].sort((a, b) => a - b);
  state.picks[pid] = { ci, ni, color, num, cost, cells: p.last };
  advance(state);
  return { ok: true };
}

function advance(state) {
  if (waitingFor(state).length > 0) return;
  if (state.phase === 'active') {
    const pk = state.picks[activePlayer(state).id];
    if (pk) { state.gone.c[pk.ci] = true; state.gone.n[pk.ni] = true; }
    state.phase = 'others';
    startStep(state);
    return;
  }
  finalize(state);
}

const plural = (n, color) => `${n} ${n === 1 ? COLOR_ONE[color] + ' Feld' : COLOR_MANY[color] + ' Felder'}`;

function finalize(state) {
  const recap = [];
  const gain = {};
  const notes = {};
  for (const p of state.players) { gain[p.id] = 0; notes[p.id] = []; }
  // Spalten: wer sie in diesem Wurf erstmals füllt; war der obere Wert noch frei, bekommen ihn alle zugleich
  for (let c = 0; c < COLS; c++) {
    const fresh = state.players.filter((p) => p.colPts[c] === null && colComplete(p.x, c));
    if (!fresh.length) continue;
    const pts = state.colTaken[c] ? COL_LOW[c] : COL_TOP[c];
    state.colTaken[c] = true;
    for (const p of fresh) { p.colPts[c] = pts; gain[p.id] += pts; notes[p.id].push(`Spalte ${LETTERS[c]} komplett`); }
  }
  for (const col of COLORS) {
    const fresh = state.players.filter((p) => p.colorPts[col] === null && colorComplete(p.x, col));
    if (!fresh.length) continue;
    const pts = state.colorTaken[col] ? COLOR_LOW : COLOR_TOP;
    state.colorTaken[col] = true;
    for (const p of fresh) { p.colorPts[col] = pts; gain[p.id] += pts; notes[p.id].push(`Farbe ${COLOR_NAMES[col]} komplett`); }
  }
  for (const p of state.players) {
    const pk = state.picks[p.id];
    if (!pk) { recap.push(`${p.name}: nichts angekreuzt${state.auto[p.id] ? ' (keine Möglichkeit)' : ''}`); continue; }
    let t = `${p.name}: ${plural(pk.num, pk.color)}`;
    if (notes[p.id].length) t += `, ${notes[p.id].join(', ')}`;
    if (pk.cost) t += ` (${pk.cost} Joker)`;
    if (gain[p.id]) t += ` – ${gain[p.id]} ${gain[p.id] === 1 ? 'Punkt' : 'Punkte'}`;
    recap.push(t);
  }
  state.recap = recap;

  const finisher = state.players.filter((p) => colorsDone(p).length >= 2);
  if (finisher.length) {
    return endGame(state, finisher.length === 1
      ? `${finisher[0].name} hat die zweite Farbe komplett.`
      : `${finisher.map((p) => p.name).join(' und ')} haben die zweite Farbe komplett.`);
  }
  if (state.solo && state.throwNo >= SOLO_THROWS) return endGame(state, `Alle ${SOLO_THROWS} Würfe sind gespielt.`);
  state.active = (state.active + 1) % state.players.length;
  state.phase = 'roll';
  return undefined;
}

function endGame(state, reason) {
  state.mode = 'over';
  state.phase = 'over';
  state.endReason = reason;
}

// Rangliste: meiste Punkte, dann mehr übrige Ausrufezeichen, sonst gleicher Platz.
export function ranking(state) {
  const list = state.players.map((p) => ({ id: p.id, name: p.name, ...scoreOf(p), colorsDone: colorsDone(p).length, missing: missingStars(p) }))
    .sort((a, b) => b.total - a.total || b.jokers - a.jokers);
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.place = prev && prev.total === r.total && prev.jokers === r.jokers ? prev.place : i + 1;
  });
  list.forEach((r) => { r.tie = list.filter((x) => x.place === r.place).length > 1; });
  return list;
}
export const winners = (state) => ranking(state).filter((r) => r.place === 1);

// Alleinspiel: Leistungsstufe nach Punkten
export function soloLevel(total) {
  if (total > 40) return 'Es gibt also doch Superhelden!';
  if (total >= 37) return 'Wirst du „Glückspilz“ oder „The Brain“ genannt?';
  if (total >= 33) return 'Du könntest auch professioneller Würfelspieler sein.';
  if (total >= 29) return 'Super! Welch grandioses Ergebnis!';
  if (total >= 25) return 'Hoffentlich ohne Schummeln geschafft!';
  if (total >= 21) return 'Klasse! Das lief ja gut.';
  if (total >= 17) return 'Das war wohl nicht dein erstes Mal…';
  if (total >= 13) return 'Gut, aber das geht noch besser.';
  if (total >= 9) return 'Na, wird doch langsam.';
  if (total >= 5) return 'Nicht ganz schlecht.';
  if (total >= 1) return 'Da muss wohl noch etwas geübt werden.';
  if (total === 0) return 'Dabei sein ist alles.';
  return 'Das grenzt ja schon an Arbeitsverweigerung.';
}
