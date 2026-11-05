// Sudoku – Spielregeln, Rätsel-Erzeugung und Technik-Löser (reine Funktionen, kein DOM, kein Date.now).
// Zufall kommt immer als Parameter `rng` (Funktion, liefert Zahlen von 0 bis unter 1) herein.
// Zustand: nur Zahlen, Texte, Listen – damit er sich verlustfrei als JSON speichern lässt.

export const SIZE = 81;
export const MAX_HINTS = 3;

// Stufen: Ziel-Vorgaben, erlaubte Lösungstechniken (cap), Mindestanzahl Vorgaben je Zeile/Spalte/Block
export const LEVELS = [
  { id: 'leicht', name: 'Leicht', clues: 40, slack: 1, cap: 1, minPer: 3, tries: 3, text: 'Zum Einstieg. Es gibt viele Zahlen vorgegeben.' },
  { id: 'mittel', name: 'Mittel', clues: 32, slack: 1, cap: 2, minPer: 2, tries: 20, extra: 3, text: 'Etwas knifliger. Hier musst du auch mal um die Ecke denken.' },
  { id: 'schwer', name: 'Schwer', clues: 26, slack: 2, cap: 3, minPer: 2, tries: 6, extra: 2, text: 'Für Geübte. Nur wenige Zahlen sind vorgegeben.' },
];
export const levelOf = (id) => LEVELS.find((l) => l.id === id) || null;
export const levelName = (id) => (id === 'lern' ? 'Übung' : (levelOf(id) ? levelOf(id).name : ''));

// ---------- Geometrie ----------
export const ROW = Array.from({ length: SIZE }, (_, i) => Math.floor(i / 9));
export const COL = Array.from({ length: SIZE }, (_, i) => i % 9);
export const BOX = Array.from({ length: SIZE }, (_, i) => Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3));
export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) UNITS.push(Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)));
export const PEERS = Array.from({ length: SIZE }, (_, i) => {
  const s = new Set();
  for (const u of [UNITS[ROW[i]], UNITS[9 + COL[i]], UNITS[18 + BOX[i]]]) for (const j of u) if (j !== i) s.add(j);
  return [...s];
});
export const peersOf = (i) => PEERS[i];

const POP = new Uint8Array(512);
for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);
const digitOf = (mask) => 31 - Math.clz32(mask) + 1; // nur für Einzelbits

const toArr = (g) => (typeof g === 'string' ? Array.from(g, (c) => (c >= '1' && c <= '9' ? Number(c) : 0)) : Array.from(g, Number));
export const gridToString = (g) => Array.from(g, (v) => String(v)).join('');
export const validGrid = (g) => {
  try {
    const a = toArr(g);
    return a.length === SIZE && a.every((v) => Number.isInteger(v) && v >= 0 && v <= 9);
  } catch { return false; }
};

// ---------- Lösungszähler ----------
// Zählt Lösungen bis `limit` (Abbruch dort). Ungültiges Gitter (doppelte Zahl) → 0.
function search(grid, limit, rng, wantFirst) {
  const g = toArr(grid);
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < SIZE; i++) {
    const v = g[i];
    if (!v) continue;
    const b = 1 << (v - 1);
    if ((rows[ROW[i]] & b) || (cols[COL[i]] & b) || (boxes[BOX[i]] & b)) return { count: 0, first: null };
    rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
  }
  let count = 0;
  let first = null;
  const rec = () => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < SIZE; i++) {
      if (g[i]) continue;
      const mask = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 511;
      const n = POP[mask];
      if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) {
      count++;
      if (wantFirst && !first) first = g.slice();
      return count >= limit;
    }
    if (bestN === 0) return false;
    const digits = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << (d - 1))) digits.push(d);
    if (rng) for (let k = digits.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [digits[k], digits[j]] = [digits[j], digits[k]]; }
    const r = ROW[best], c = COL[best], b = BOX[best];
    for (const d of digits) {
      const bit = 1 << (d - 1);
      g[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      const stop = rec();
      g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (stop) return true;
    }
    return false;
  };
  rec();
  return { count, first };
}
export function countSolutions(grid, limit = 2) {
  if (!validGrid(grid)) return 0;
  return search(grid, Math.max(1, limit), null, false).count;
}
export function solve(grid) {
  if (!validGrid(grid)) return null;
  return search(grid, 1, null, true).first;
}
export function generateSolved(rng) {
  const r = search(new Array(SIZE).fill(0), 1, rng, true);
  return r.first;
}

// ---------- Technik-Löser ----------
// Stufe 1: einziger Kandidat im Feld, einziger Platz in Zeile/Spalte/Block
// Stufe 2: Pärchen (offen/versteckt), Zeigen und Beanspruchen (Block ↔ Zeile/Spalte)
// Stufe 3: Drillinge (offen/versteckt), X-Wing
export function techniqueSolve(grid, maxLevel = 3) {
  const v = toArr(grid);
  const cand = new Array(SIZE).fill(0);
  const used = (i) => {
    let m = 0;
    for (const p of PEERS[i]) if (v[p]) m |= 1 << (v[p] - 1);
    return m;
  };
  for (let i = 0; i < SIZE; i++) {
    if (v[i]) continue;
    cand[i] = ~used(i) & 511;
    if (!cand[i]) return { solved: false, level: 0, steps: 0, grid: v };
  }
  let level = 0, steps = 0;
  const place = (i, d) => {
    v[i] = d; cand[i] = 0;
    const b = ~(1 << (d - 1));
    for (const p of PEERS[i]) cand[p] &= b;
  };
  const elim = (i, mask) => {
    if (v[i] === 0 && (cand[i] & mask)) { cand[i] &= ~mask; return true; }
    return false;
  };

  const singles = () => {
    for (let i = 0; i < SIZE; i++) if (!v[i] && POP[cand[i]] === 1) { place(i, digitOf(cand[i])); return true; }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        let n = 0, at = -1;
        for (const i of u) if (!v[i] && (cand[i] & bit)) { n++; at = i; if (n > 1) break; }
        if (n === 1) { place(at, d); return true; }
      }
    }
    return false;
  };

  const pointing = () => {
    let ch = false;
    for (let b = 0; b < 9; b++) {
      const box = UNITS[18 + b];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        const cells = box.filter((i) => !v[i] && (cand[i] & bit));
        if (cells.length < 2) continue;
        if (cells.every((i) => ROW[i] === ROW[cells[0]])) {
          for (const j of UNITS[ROW[cells[0]]]) if (BOX[j] !== b && elim(j, bit)) ch = true;
        }
        if (cells.every((i) => COL[i] === COL[cells[0]])) {
          for (const j of UNITS[9 + COL[cells[0]]]) if (BOX[j] !== b && elim(j, bit)) ch = true;
        }
      }
    }
    return ch;
  };
  const claiming = () => {
    let ch = false;
    for (let k = 0; k < 18; k++) {
      const line = UNITS[k];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        const cells = line.filter((i) => !v[i] && (cand[i] & bit));
        if (cells.length < 2) continue;
        if (cells.every((i) => BOX[i] === BOX[cells[0]])) {
          for (const j of UNITS[18 + BOX[cells[0]]]) if (!line.includes(j) && elim(j, bit)) ch = true;
        }
      }
    }
    return ch;
  };

  const combos = (arr, k, cb, start = 0, cur = []) => {
    if (cur.length === k) return cb(cur);
    for (let x = start; x < arr.length; x++) {
      cur.push(arr[x]);
      const r = combos(arr, k, cb, x + 1, cur);
      cur.pop();
      if (r) return true;
    }
    return false;
  };
  const naked = (k) => {
    let ch = false;
    for (const u of UNITS) {
      const cells = u.filter((i) => !v[i] && POP[cand[i]] >= 2 && POP[cand[i]] <= k);
      if (cells.length < k) continue;
      combos(cells, k, (cmb) => {
        let un = 0;
        for (const i of cmb) un |= cand[i];
        if (POP[un] !== k) return false;
        for (const j of u) if (!v[j] && !cmb.includes(j) && elim(j, un)) ch = true;
        return false;
      });
    }
    return ch;
  };
  const hidden = (k) => {
    let ch = false;
    for (const u of UNITS) {
      const pos = new Array(10).fill(0);
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        for (let x = 0; x < 9; x++) if (!v[u[x]] && (cand[u[x]] & bit)) pos[d] |= 1 << x;
      }
      const digits = [];
      for (let d = 1; d <= 9; d++) if (POP[pos[d]] >= 2 && POP[pos[d]] <= k) digits.push(d);
      if (digits.length < k) continue;
      combos(digits, k, (cmb) => {
        let un = 0, dm = 0;
        for (const d of cmb) { un |= pos[d]; dm |= 1 << (d - 1); }
        if (POP[un] !== k) return false;
        for (let x = 0; x < 9; x++) if (un & (1 << x) && elim(u[x], ~dm & 511)) ch = true;
        return false;
      });
    }
    return ch;
  };
  const xwing = () => {
    let ch = false;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);
      for (const off of [0, 9]) { // Zeilen, dann Spalten
        const lines = [];
        for (let a = 0; a < 9; a++) {
          let m = 0;
          for (let x = 0; x < 9; x++) { const i = UNITS[off + a][x]; if (!v[i] && (cand[i] & bit)) m |= 1 << x; }
          if (POP[m] === 2) lines.push([a, m]);
        }
        for (let p = 0; p < lines.length; p++) {
          for (let q = p + 1; q < lines.length; q++) {
            if (lines[p][1] !== lines[q][1]) continue;
            for (let x = 0; x < 9; x++) {
              if (!(lines[p][1] & (1 << x))) continue;
              for (let a = 0; a < 9; a++) {
                if (a === lines[p][0] || a === lines[q][0]) continue;
                if (elim(UNITS[off + a][x], bit)) ch = true;
              }
            }
          }
        }
      }
    }
    return ch;
  };

  const stepsByLevel = [
    null,
    [],
    [() => naked(2), () => hidden(2), pointing, claiming],
    [() => naked(3), () => hidden(3), xwing],
  ];
  let guard = 0;
  while (guard++ < 2000) {
    if (v.every((x) => x)) break;
    if (singles()) { level = Math.max(level, 1); steps++; continue; }
    let moved = false;
    for (let lv = 2; lv <= maxLevel && !moved; lv++) {
      for (const f of stepsByLevel[lv]) if (f()) { moved = true; level = Math.max(level, lv); steps++; break; }
    }
    if (!moved) break;
  }
  const solved = v.every((x) => x);
  return { solved, level, steps, grid: v };
}
// Schwierigkeitsgrad: 1–3 = Technikstufe, 4 = braucht mehr als die bekannten Techniken (raten)
export function gradeOf(grid) {
  const r = techniqueSolve(grid, 3);
  return r.solved ? Math.max(1, r.level) : 4;
}

// ---------- Rätsel-Erzeugung ----------
function shuffled(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let k = n - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
}
function carve(solved, def, rng) {
  const g = solved.slice();
  const rn = new Array(9).fill(9), cn = new Array(9).fill(9), bn = new Array(9).fill(9);
  let clues = SIZE;
  for (const i of shuffled(SIZE, rng)) {
    if (clues <= def.clues) break;
    if (rn[ROW[i]] <= def.minPer || cn[COL[i]] <= def.minPer || bn[BOX[i]] <= def.minPer) continue;
    const old = g[i];
    g[i] = 0;
    const ok = def.cap ? techniqueSolve(g, def.cap).solved : countSolutions(g, 2) === 1;
    if (ok) { clues--; rn[ROW[i]]--; cn[COL[i]]--; bn[BOX[i]]--; } else g[i] = old;
  }
  return { grid: g, clues };
}
// Reicht die Technikstufe noch nicht, werden (innerhalb der erlaubten Techniken) weitere Zahlen entfernt.
function carveMore(c, def, want, rng, extra) {
  const g = c.grid;
  let left = extra;
  for (const i of shuffled(SIZE, rng)) {
    if (left <= 0 || gradeOf(g) >= want) break;
    if (!g[i]) continue;
    if (UNITS[ROW[i]].filter((j) => g[j]).length <= def.minPer || UNITS[9 + COL[i]].filter((j) => g[j]).length <= def.minPer
      || UNITS[18 + BOX[i]].filter((j) => g[j]).length <= def.minPer) continue;
    const old = g[i];
    g[i] = 0;
    if (techniqueSolve(g, def.cap).solved) { c.clues--; left--; } else g[i] = old;
  }
}
// Liefert { puzzle, solution, clues, grade } (Texte mit 81 Ziffern, 0 = leer)
export function makePuzzle(levelId, rng) {
  const def = levelOf(levelId);
  if (!def) throw new Error('Unbekannte Stufe');
  if (typeof rng !== 'function') throw new Error('rng fehlt');
  let best = null;
  for (let t = 0; t < def.tries; t++) {
    const solved = generateSolved(rng);
    const c = carve(solved, def, rng);
    const wantGrade = def.id === 'leicht' ? 1 : def.id === 'mittel' ? 2 : 3;
    if (def.id !== 'leicht') carveMore(c, def, wantGrade, rng, def.extra);
    const grade = gradeOf(c.grid);
    // Güte: Wunschstufe getroffen, Vorgaben nah am Ziel
    const gradeOk = def.id === 'schwer' ? grade >= 2 : grade === wantGrade;
    const cluesOk = c.clues <= def.clues + def.slack;
    const score = (gradeOk ? 0 : 100) + (cluesOk ? 0 : 50) + Math.max(0, c.clues - def.clues) - (def.id === 'schwer' ? Math.min(grade, 4) : 0);
    if (!best || score < best.score) best = { score, puzzle: gridToString(c.grid), solution: gridToString(solved), clues: c.clues, grade };
    if (gradeOk && cluesOk) break;
  }
  return { puzzle: best.puzzle, solution: best.solution, clues: best.clues, grade: best.grade };
}

// Übungsrätsel der Lernrunde: festes Muster, 6 leere Felder, jedes ist ein sicherer nächster Schritt.
export const LEARN_ORDER = [0, 22, 64, 25, 71, 37];
export function learnPuzzle() {
  const sol = Array.from({ length: SIZE }, (_, i) => ((3 * (ROW[i] % 3) + Math.floor(ROW[i] / 3) + COL[i]) % 9) + 1);
  const pz = sol.slice();
  for (const i of LEARN_ORDER) pz[i] = 0;
  return { puzzle: gridToString(pz), solution: gridToString(sol) };
}

// ---------- Spielzustand ----------
function loadPuzzle(g, level, p) {
  g.level = level;
  g.puzzle = p.puzzle;
  g.solution = p.solution;
  g.cells = toArr(p.puzzle);
  g.notes = new Array(SIZE).fill(0);
  g.hist = [];
  g.revealed = [];
  g.hints = 0;
  g.checks = 0;
  g.flagged = [];
  g.check = null;
  g.elapsed = 0;
  g.result = null;
  g.seq += 1;
  g.mode = 'play';
}
export function createGame(players, opts = {}) {
  const g = {
    v: 1, players: (players || []).map((p) => ({ id: String(p.id), name: String(p.name || '') })),
    mode: 'choose', seq: 0, level: '', puzzle: '', solution: '', cells: [], notes: [], hist: [], revealed: [],
    hints: 0, checks: 0, flagged: [], check: null, elapsed: 0, result: null,
  };
  if (opts.learn) loadPuzzle(g, 'lern', learnPuzzle());
  return g;
}
export function startPuzzle(g, levelId, rng) {
  loadPuzzle(g, levelId, makePuzzle(levelId, rng));
  return g;
}

export const isGiven = (g, i) => g.puzzle.charCodeAt(i) !== 48;
export const isLocked = (g, i) => isGiven(g, i) || g.revealed.includes(i);
export const isFull = (g) => g.cells.length === SIZE && g.cells.every((x) => x > 0);
export const isSolved = (g) => isFull(g) && g.cells.every((x, i) => String(x) === g.solution[i]);
export const emptyCount = (g) => g.cells.filter((x) => !x).length;
// Wie oft eine Zahl schon im Gitter steht (Index 1–9)
export function placedCounts(g) {
  const c = new Array(10).fill(0);
  for (const x of g.cells) if (x) c[x]++;
  return c;
}
// Felder, die gegen die Regeln verstoßen (gleiche Zahl in Zeile, Spalte oder Block)
export function conflicts(cells) {
  const bad = new Set();
  for (const u of UNITS) {
    const seen = {};
    for (const i of u) {
      const x = cells[i];
      if (!x) continue;
      (seen[x] = seen[x] || []).push(i);
    }
    for (const k of Object.keys(seen)) if (seen[k].length > 1) for (const i of seen[k]) bad.add(i);
  }
  return [...bad].sort((a, b) => a - b);
}
export const wrongCells = (g) => g.cells.reduce((a, x, i) => (x && String(x) !== g.solution[i] ? (a.push(i), a) : a), []);

// ---------- Zeit, Bestzeit ----------
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
// Bestzeit je Stufe: prev = bisherige Bestzeit in ms (0/null = keine). Aufgedeckte Felder zählen nicht.
export function bestUpdate(prev, ms, hints = 0) {
  const p = Number(prev) > 0 ? Number(prev) : 0;
  const eligible = !(hints > 0) && Number(ms) > 0;
  const record = eligible && (p === 0 || ms < p);
  return { record, best: record ? ms : p, eligible };
}
// Wird vom Gastgeber nach dem Spielende aufgerufen, trägt das Ergebnis ein und liefert die neue Bestzeit.
export function settleResult(g, prev) {
  if (!g || g.mode !== 'over' || !g.result || g.result.record !== null) return null;
  const b = bestUpdate(prev, g.result.ms, g.result.hints);
  g.result.record = b.record;
  g.result.prev = Number(prev) > 0 ? Number(prev) : 0;
  return b;
}

// ---------- Nachrichten ----------
const bad = (error) => ({ ok: false, error });
const isInt = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
const MAX_MS = 100 * 3600 * 1000;

function touch(g, ms) {
  if (ms === undefined) return;
  g.elapsed = Math.min(MAX_MS, Math.max(g.elapsed, Math.floor(ms)));
}
function finishIfDone(g) {
  if (!isSolved(g)) return;
  g.mode = 'over';
  g.check = null;
  g.result = { ms: g.elapsed, level: g.level, hints: g.hints, checks: g.checks, mistakes: g.flagged.length, record: null, prev: 0 };
}

// apply(g, pid, msg, rng) → { ok:true } | { ok:false, error }. Bei Fehler bleibt der Zustand unverändert.
export function apply(g, pid, msg, rng = Math.random) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return bad('Kein Spiel vorhanden.');
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return bad('Unbekannte Eingabe.');
  if (!g.players.some((p) => p.id === pid)) return bad('Du bist in diesem Spiel nicht dabei.');
  if (msg.ms !== undefined && !(typeof msg.ms === 'number' && Number.isFinite(msg.ms) && msg.ms >= 0)) return bad('Ungültige Zeitangabe.');

  if (msg.t === 'new') {
    if (typeof msg.level !== 'string' || !levelOf(msg.level)) return bad('Diese Stufe gibt es nicht.');
    if (typeof rng !== 'function') return bad('Zufall fehlt.');
    startPuzzle(g, msg.level, rng);
    return { ok: true };
  }
  if (g.mode !== 'play') return bad(g.mode === 'over' ? 'Dieses Rätsel ist schon gelöst.' : 'Bitte wähle zuerst eine Stufe.');

  switch (msg.t) {
    case 'sync':
      touch(g, msg.ms);
      return { ok: true };
    case 'put': {
      if (!isInt(msg.i, 0, 80) || !isInt(msg.d, 1, 9)) return bad('Ungültiges Feld oder ungültige Zahl.');
      if (isLocked(g, msg.i)) return bad('Diese Zahl ist fest und kann nicht geändert werden.');
      if (g.cells[msg.i] === msg.d) return bad('Diese Zahl steht schon in diesem Feld.');
      touch(g, msg.ms);
      g.hist.push([msg.i, g.cells[msg.i], g.notes[msg.i]]);
      g.cells[msg.i] = msg.d;
      g.notes[msg.i] = 0;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'erase': {
      if (!isInt(msg.i, 0, 80)) return bad('Ungültiges Feld.');
      if (isLocked(g, msg.i)) return bad('Diese Zahl ist fest und kann nicht gelöscht werden.');
      if (!g.cells[msg.i] && !g.notes[msg.i]) return bad('Dieses Feld ist schon leer.');
      touch(g, msg.ms);
      g.hist.push([msg.i, g.cells[msg.i], g.notes[msg.i]]);
      g.cells[msg.i] = 0;
      g.notes[msg.i] = 0;
      g.check = null;
      return { ok: true };
    }
    case 'note': {
      if (!isInt(msg.i, 0, 80) || !isInt(msg.d, 1, 9)) return bad('Ungültiges Feld oder ungültige Zahl.');
      if (isLocked(g, msg.i) || g.cells[msg.i]) return bad('Notizen gehen nur in leeren Feldern.');
      touch(g, msg.ms);
      g.hist.push([msg.i, g.cells[msg.i], g.notes[msg.i]]);
      g.notes[msg.i] ^= 1 << (msg.d - 1);
      g.check = null;
      return { ok: true };
    }
    case 'undo': {
      if (!g.hist.length) return bad('Es gibt nichts zum Rückgängigmachen.');
      touch(g, msg.ms);
      const [i, v, n] = g.hist.pop();
      g.cells[i] = v;
      g.notes[i] = n;
      g.check = null;
      return { ok: true };
    }
    case 'check': {
      touch(g, msg.ms);
      const wrong = wrongCells(g);
      g.checks += 1;
      for (const i of wrong) if (!g.flagged.includes(i)) g.flagged.push(i);
      g.check = { wrong };
      return { ok: true };
    }
    case 'reveal': {
      if (!isInt(msg.i, 0, 80)) return bad('Ungültiges Feld.');
      if (g.hints >= MAX_HINTS) return bad(`Du hast schon alle ${MAX_HINTS} Hilfen benutzt.`);
      if (g.cells[msg.i]) return bad('Bitte wähle ein leeres Feld aus.');
      touch(g, msg.ms);
      g.cells[msg.i] = Number(g.solution[msg.i]);
      g.notes[msg.i] = 0;
      g.revealed.push(msg.i);
      g.hist = g.hist.filter((h) => h[0] !== msg.i);
      g.hints += 1;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    default:
      return bad('Unbekannte Eingabe.');
  }
}
