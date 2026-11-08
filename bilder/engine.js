// Bilderrätsel (Zahlen-Ausmalrätsel) – Regeln, Linien-Löser, Spielzustand (reine Funktionen, kein DOM, kein Date.now).
// Zufall kommt immer als Parameter `rng` (Funktion, liefert Zahlen von 0 bis unter 1) herein.
// Zustand: nur Zahlen, Texte, Listen – damit er sich verlustfrei als JSON speichern lässt.
// Feldzustände: 0 = leer, 1 = ausgemalt, 2 = Kreuz (sicher leer).
import { BILDER } from './bilder.js';

export { BILDER };

export const LEVELS = [
  { id: 'leicht', n: 5, name: 'Leicht', text: '5 × 5 Felder, ein kleines Symbol' },
  { id: 'mittel', n: 8, name: 'Mittel', text: '8 × 8 Felder' },
  { id: 'schwer', n: 10, name: 'Schwer', text: '10 × 10 Felder' },
];
export const levelOf = (id) => LEVELS.find((l) => l.id === id) || null;
export const levelName = (id) => (id === 'lern' ? 'Übung' : (levelOf(id) ? levelOf(id).name : ''));
// Kästchen: „Schwer“ geht vor „Leicht“, ohne Häkchen gilt Mittel.
export const levelFromOpts = (o) => (o && o.hard ? 'schwer' : o && o.easy ? 'leicht' : 'mittel');
export const sizeKey = (level) => (level === 'lern' ? 5 : (levelOf(level) ? levelOf(level).n : 0));

// ---------- Hinweise ----------
// Längen der zusammenhängenden Reihen einer Linie (Liste aus 0/1 oder Feldzuständen, nur 1 zählt). Leere Linie → [0].
export function clueOf(line) {
  const out = [];
  let run = 0;
  for (const x of line) {
    if (x === 1 || x === '#') run++;
    else if (run) { out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out.length ? out : [0];
}
const rowsOf = (p) => p.map((r) => Array.from(r, (c) => (c === '#' ? 1 : 0)));
export const pictureGrid = (p) => rowsOf(p);
export function cluesOfPicture(p) {
  const g = rowsOf(p), n = g.length, m = g[0] ? g[0].length : 0;
  return {
    rows: g.map((r) => clueOf(r)),
    cols: Array.from({ length: m }, (_, c) => clueOf(Array.from({ length: n }, (_, r) => g[r][c]))),
  };
}
export const sameClue = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- Linien-Löser (Standard-Folgerung je Zeile/Spalte, ohne Raten) ----------
// line: Array aus -1 (unbekannt), 0 (leer), 1 (voll). Liefert neue Linie oder null bei Widerspruch.
export function solveLine(clue, line) {
  const n = line.length;
  const ks = clue.length === 1 && clue[0] === 0 ? [] : clue;
  const all = new Array(n).fill(-2); // -2 = noch keine Anordnung gesehen
  let any = false;
  const cur = new Array(n).fill(0);
  function rec(k, pos) {
    if (k === ks.length) {
      for (let i = pos; i < n; i++) if (line[i] === 1) return;
      for (let i = pos; i < n; i++) cur[i] = 0;
      any = true;
      for (let i = 0; i < n; i++) all[i] = all[i] === -2 ? cur[i] : (all[i] === cur[i] ? cur[i] : -1);
      return;
    }
    let need = 0;
    for (let j = k; j < ks.length; j++) need += ks[j] + 1;
    need -= 1;
    for (let s = pos; s + need <= n; s++) {
      let ok = true;
      for (let i = pos; i < s; i++) if (line[i] === 1) { ok = false; break; }
      if (!ok) break; // eine volle Zelle vor dem Start bleibt auch bei späterem Start übrig
      for (let i = s; i < s + ks[k]; i++) if (line[i] === 0) { ok = false; break; }
      if (ok && s + ks[k] < n && line[s + ks[k]] === 1) ok = false;
      if (!ok) continue;
      for (let i = pos; i < s; i++) cur[i] = 0;
      for (let i = s; i < s + ks[k]; i++) cur[i] = 1;
      if (s + ks[k] < n) cur[s + ks[k]] = 0;
      rec(k + 1, Math.min(n, s + ks[k] + 1));
    }
  }
  rec(0, 0);
  if (!any) return null;
  return all.map((x, i) => (x === -1 ? line[i] : x));
}
// Löst nur mit Linien-Folgerungen. → { solved, grid (-1/0/1), contradiction, rounds }
export function solveLines(rowClues, colClues) {
  const n = rowClues.length, m = colClues.length;
  const grid = Array.from({ length: n }, () => new Array(m).fill(-1));
  let rounds = 0, changed = true;
  while (changed) {
    changed = false; rounds++;
    for (let r = 0; r < n; r++) {
      const res = solveLine(rowClues[r], grid[r]);
      if (!res) return { solved: false, grid, contradiction: true, rounds };
      for (let c = 0; c < m; c++) if (res[c] !== grid[r][c]) { grid[r][c] = res[c]; changed = true; }
    }
    for (let c = 0; c < m; c++) {
      const col = grid.map((row) => row[c]);
      const res = solveLine(colClues[c], col);
      if (!res) return { solved: false, grid, contradiction: true, rounds };
      for (let r = 0; r < n; r++) if (res[r] !== grid[r][c]) { grid[r][c] = res[r]; changed = true; }
    }
  }
  return { solved: grid.every((row) => row.every((x) => x !== -1)), grid, contradiction: false, rounds };
}
export const solvesWithoutGuessing = (p) => {
  const { rows, cols } = cluesOfPicture(p);
  const r = solveLines(rows, cols);
  if (!r.solved) return false;
  return r.grid.every((row, y) => row.every((x, c) => x === (p[y][c] === '#' ? 1 : 0)));
};

// ---------- Katalog ----------
export const imagesOf = (n) => BILDER.filter((b) => b.g === n);
export const bildOf = (id) => BILDER.find((b) => b.id === id) || null;
// Fest für die Lernrunde: ein kleines Herz (5 × 5)
export const LEARN_BILD = { id: 'lern-herz', n: 'Herz', a: 'ein', g: 5, p: ['.#.#.', '#####', '#####', '.###.', '..#..'] };

// ---------- Spielzustand ----------
export function createGame(players, opts = {}) {
  const g = {
    v: 1, players: (players || []).map((p) => ({ id: String(p.id), name: String(p.name || '') })),
    mode: 'choose', seq: 0, level: '', n: 0, img: '', name: '', art: '', sol: '', rows: [], cols: [], total: 0,
    cells: [], hist: [], revealed: [], hints: 0, checks: 0, flagged: [], check: null, elapsed: 0, result: null, seen: [],
  };
  if (opts.learn) loadBild(g, 'lern', LEARN_BILD);
  return g;
}
function loadBild(g, level, b) {
  const n = b.g;
  const { rows, cols } = cluesOfPicture(b.p);
  g.level = level; g.n = n; g.img = b.id; g.name = b.n; g.art = b.a || 'ein';
  g.sol = b.p.join('').replace(/#/g, '1').replace(/\./g, '0');
  g.rows = rows; g.cols = cols;
  g.total = g.sol.split('').filter((c) => c === '1').length;
  g.cells = new Array(n * n).fill(0);
  g.hist = []; g.revealed = []; g.hints = 0; g.checks = 0; g.flagged = []; g.check = null; g.elapsed = 0; g.result = null;
  if (level !== 'lern') { g.seen = (g.seen || []).concat(b.id).slice(-40); }
  g.seq += 1;
  g.mode = 'play';
}
export function startPuzzle(g, levelId, rng) {
  const lv = levelOf(levelId);
  if (!lv) throw new Error('Unbekannte Stufe');
  const all = imagesOf(lv.n);
  let unseen = all.filter((x) => !(g.seen || []).includes(x.id));
  if (!unseen.length) { g.seen = []; unseen = all; }
  let pool = unseen.filter((x) => x.id !== g.img);
  if (!pool.length) pool = unseen;
  const b = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  loadBild(g, levelId, b);
  return g;
}

export const isLocked = (g, i) => g.revealed.includes(i);
const lineAt = (g, kind, k) => (kind === 'r'
  ? g.cells.slice(k * g.n, k * g.n + g.n)
  : Array.from({ length: g.n }, (_, r) => g.cells[r * g.n + k]));
export const lineOk = (g, kind, k) => sameClue(clueOf(lineAt(g, kind, k)), kind === 'r' ? g.rows[k] : g.cols[k]);
export const rowOk = (g, r) => lineOk(g, 'r', r);
export const colOk = (g, c) => lineOk(g, 'c', c);
export const isSolved = (g) => g.cells.length > 0 && g.n > 0
  && Array.from({ length: g.n }, (_, k) => k).every((k) => rowOk(g, k) && colOk(g, k));
// Widerspruch zur Lösung: ausgemalt, wo es leer ist – oder Kreuz, wo ausgemalt werden muss
export const wrongCells = (g) => g.cells.reduce((a, x, i) => ((x === 1 && g.sol[i] === '0') || (x === 2 && g.sol[i] === '1') ? (a.push(i), a) : a), []);
export const filledCount = (g) => g.cells.filter((x) => x === 1).length;
export const clueSum = (c) => (c.length === 1 && c[0] === 0 ? 0 : c.reduce((a, b) => a + b, 0));

// ---------- Zeit, Bestzeit ----------
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
// Aufgedeckte Felder zählen nicht für die Bestzeit.
export function bestUpdate(prev, ms, hints = 0) {
  const p = Number(prev) > 0 ? Number(prev) : 0;
  const eligible = !(hints > 0) && Number(ms) > 0;
  const record = eligible && (p === 0 || ms < p);
  return { record, best: record ? ms : p, eligible };
}
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
  g.result = { ms: g.elapsed, level: g.level, n: g.n, hints: g.hints, checks: g.checks, mistakes: g.flagged.length, record: null, prev: 0, img: g.img, name: g.name, art: g.art };
}

// Zustand nach einem Tipp: Ausmalen: leer/Kreuz → ausgemalt, ausgemalt → leer. Leer-Modus: leer/ausgemalt → Kreuz, Kreuz → leer.
export const tapValue = (cur, mode) => (mode === 'cross' ? (cur === 2 ? 0 : 2) : (cur === 1 ? 0 : 1));

// apply(g, pid, msg, rng) → { ok:true } | { ok:false, error }. Bei Fehler bleibt der Zustand unverändert.
export function apply(g, pid, msg, rng = Math.random) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return bad('Kein Spiel vorhanden.');
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return bad('Unbekannte Eingabe.');
  if (!g.players.some((p) => p.id === pid)) return bad('Du bist in diesem Spiel nicht dabei.');
  if (msg.ms !== undefined && !(typeof msg.ms === 'number' && Number.isFinite(msg.ms) && msg.ms >= 0)) return bad('Ungültige Zeitangabe.');

  if (msg.t === 'new') {
    if (typeof msg.level !== 'string' || !levelOf(msg.level)) return bad('Diese Größe gibt es nicht.');
    if (typeof rng !== 'function') return bad('Zufall fehlt.');
    startPuzzle(g, msg.level, rng);
    return { ok: true };
  }
  if (g.mode !== 'play') return bad(g.mode === 'over' ? 'Dieses Bild ist schon fertig.' : 'Bitte starte zuerst ein Rätsel.');
  const N = g.n * g.n;

  switch (msg.t) {
    case 'sync':
      touch(g, msg.ms);
      return { ok: true };
    case 'set': {
      if (!isInt(msg.i, 0, N - 1) || !isInt(msg.v, 0, 2)) return bad('Ungültiges Feld.');
      if (isLocked(g, msg.i)) return bad('Dieses Feld wurde aufgedeckt und ist fest.');
      if (g.cells[msg.i] === msg.v) return bad('Das Feld hat schon diesen Zustand.');
      touch(g, msg.ms);
      g.hist.push([[msg.i, g.cells[msg.i]]]);
      g.cells[msg.i] = msg.v;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'paint': {
      // Ziehen über mehrere Felder: v setzen; bei v = 0 nur Felder im Zustand `from` leeren
      if (!Array.isArray(msg.cells) || !msg.cells.length || msg.cells.length > N || !isInt(msg.v, 0, 2)) return bad('Ungültige Reihe.');
      if (!msg.cells.every((i) => isInt(i, 0, N - 1))) return bad('Ungültiges Feld.');
      if (msg.v === 0 && !isInt(msg.from, 1, 2)) return bad('Ungültige Reihe.');
      const todo = [];
      for (const i of new Set(msg.cells)) {
        if (isLocked(g, i)) continue;
        if (msg.v === 0 ? g.cells[i] === msg.from : g.cells[i] !== msg.v) todo.push(i);
      }
      if (!todo.length) return bad('Hier gibt es nichts zu ändern.');
      touch(g, msg.ms);
      g.hist.push(todo.map((i) => [i, g.cells[i]]));
      for (const i of todo) g.cells[i] = msg.v;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'undo': {
      if (!g.hist.length) return bad('Es gibt nichts zum Rückgängigmachen.');
      touch(g, msg.ms);
      for (const [i, v] of g.hist.pop()) g.cells[i] = v;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'clear': {
      const todo = g.cells.map((x, i) => (x && !isLocked(g, i) ? i : -1)).filter((i) => i >= 0);
      if (!todo.length) return bad('Es ist schon alles leer.');
      touch(g, msg.ms);
      g.hist.push(todo.map((i) => [i, g.cells[i]]));
      for (const i of todo) g.cells[i] = 0;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'check': {
      touch(g, msg.ms);
      const wrong = wrongCells(g);
      g.checks += 1;
      for (const i of wrong) if (!g.flagged.includes(i)) g.flagged.push(i);
      g.check = {
        wrong,
        rows: [...new Set(wrong.map((i) => Math.floor(i / g.n)))].sort((a, b) => a - b),
        cols: [...new Set(wrong.map((i) => i % g.n))].sort((a, b) => a - b),
      };
      return { ok: true };
    }
    case 'reveal': {
      // Ein Feld aufdecken: bevorzugt ein noch fehlendes ausgemaltes Feld, sonst ein falsch gesetztes
      const missing = [], wrong = wrongCells(g);
      for (let i = 0; i < N; i++) if (g.sol[i] === '1' && g.cells[i] !== 1 && !isLocked(g, i)) missing.push(i);
      const pool = missing.length ? missing : wrong.filter((i) => !isLocked(g, i));
      if (!pool.length) return bad('Es gibt nichts aufzudecken.');
      if (typeof rng !== 'function') return bad('Zufall fehlt.');
      touch(g, msg.ms);
      const i = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      g.cells[i] = g.sol[i] === '1' ? 1 : 2;
      g.revealed.push(i);
      g.hist = g.hist.map((h) => h.filter((e) => e[0] !== i)).filter((h) => h.length);
      g.hints += 1;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    default:
      return bad('Unbekannte Eingabe.');
  }
}
