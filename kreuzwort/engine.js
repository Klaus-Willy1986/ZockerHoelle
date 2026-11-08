// Kreuzworträtsel – Regeln, Rätsel-Erzeugung (Backtracking) und Prüfung (reine Funktionen, kein DOM, kein Date.now).
// Zufall kommt immer als Parameter `rng` (liefert Zahlen von 0 bis unter 1) herein.
// Zustand: nur Zahlen, Texte, Listen – verlustfrei als JSON speicherbar.
import { WOERTER } from './woerter.js';

export const MAX_COLS = 11;
export const MAX_ROWS = 13;

// Stufen: Wortzahl, längstes Wort, schwerste Hinweisstufe
export const LEVELS = [
  { id: 'leicht', name: 'Leicht', count: 10, maxLen: 6, maxD: 1, text: '10 Wörter, kurze Wörter' },
  { id: 'mittel', name: 'Mittel', count: 13, maxLen: 8, maxD: 2, text: '13 Wörter' },
  { id: 'schwer', name: 'Schwer', count: 16, maxLen: 10, maxD: 2, text: '16 Wörter' },
];
export const levelOf = (id) => LEVELS.find((l) => l.id === id) || null;
export const levelName = (id) => (id === 'lern' ? 'Übung' : (levelOf(id) ? levelOf(id).name : ''));
// Optionen → Stufe. Leicht hat Vorrang vor Schwer, wenn beide Kästchen angekreuzt sind.
export const levelFromOpts = (o) => (o && o.easy ? 'leicht' : o && o.hard ? 'schwer' : 'mittel');

// ---------- Rätsel aus Wortliste erzeugen ----------
const shuffle = (a, rng) => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
const pick = (a, rng) => a[Math.floor(rng() * a.length)];

const OFF = 20; // Mittelpunkt des Arbeitsgitters
const DIM = 41;

function tryBuild(pool, byLetter, count, rng) {
  const ch = new Array(DIM * DIM).fill('');
  const mask = new Array(DIM * DIM).fill(0); // 1 = waagerecht, 2 = senkrecht
  const placed = [];
  const used = new Set();
  const box = { r0: OFF, r1: OFF, c0: OFF, c1: OFF };
  let nodes = 0;
  const idx = (r, c) => r * DIM + c;

  function check(e, r, c, d) {
    const L = e.w.length;
    const dr = d === 'v' ? 1 : 0, dc = 1 - dr;
    const r1 = r + (L - 1) * dr, c1 = c + (L - 1) * dc;
    if (r < 1 || c < 1 || r1 >= DIM - 1 || c1 >= DIM - 1) return null;
    const nb = { r0: Math.min(box.r0, r), r1: Math.max(box.r1, r1), c0: Math.min(box.c0, c), c1: Math.max(box.c1, c1) };
    if (nb.r1 - nb.r0 + 1 > MAX_ROWS || nb.c1 - nb.c0 + 1 > MAX_COLS) return null;
    if (ch[idx(r - dr, c - dc)] || ch[idx(r1 + dr, c1 + dc)]) return null;
    const bit = d === 'v' ? 2 : 1;
    let cross = 0;
    for (let k = 0; k < L; k++) {
      const rr = r + k * dr, cc = c + k * dc;
      const ex = ch[idx(rr, cc)];
      if (ex) {
        if (ex !== e.w[k] || (mask[idx(rr, cc)] & bit)) return null;
        cross++;
      } else if (ch[idx(rr + dc, cc + dr)] || ch[idx(rr - dc, cc - dr)]) return null;
    }
    if (cross < 1) return null;
    const area = (nb.r1 - nb.r0 + 1) * (nb.c1 - nb.c0 + 1) - (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1);
    return { cross, grow: area, nb };
  }

  function put(e, r, c, d) {
    const dr = d === 'v' ? 1 : 0, dc = 1 - dr;
    const bit = d === 'v' ? 2 : 1;
    const undo = [];
    for (let k = 0; k < e.w.length; k++) {
      const i = idx(r + k * dr, c + k * dc);
      undo.push([i, ch[i], mask[i]]);
      ch[i] = e.w[k]; mask[i] |= bit;
    }
    const old = { ...box };
    box.r0 = Math.min(box.r0, r); box.c0 = Math.min(box.c0, c);
    box.r1 = Math.max(box.r1, r + (e.w.length - 1) * dr); box.c1 = Math.max(box.c1, c + (e.w.length - 1) * dc);
    placed.push({ e, r, c, d }); used.add(e.w);
    return () => { for (const [i, a, b] of undo) { ch[i] = a; mask[i] = b; } Object.assign(box, old); placed.pop(); used.delete(e.w); };
  }

  function gather() {
    const out = new Map();
    for (let t = 0; t < 90; t++) {
      const p = pick(placed, rng);
      const k = Math.floor(rng() * p.e.w.length);
      const dr = p.d === 'v' ? 1 : 0, dc = 1 - dr;
      const r = p.r + k * dr, c = p.c + k * dc;
      const list = byLetter[p.e.w[k]];
      if (!list) continue;
      const [e, j] = pick(list, rng);
      if (used.has(e.w)) continue;
      const nd = p.d === 'h' ? 'v' : 'h';
      const r0 = nd === 'v' ? r - j : r, c0 = nd === 'h' ? c - j : c;
      const key = `${e.w}|${r0}|${c0}|${nd}`;
      if (out.has(key)) continue;
      const ok = check(e, r0, c0, nd);
      if (ok) out.set(key, { e, r: r0, c: c0, d: nd, score: ok.cross * 2.2 - ok.grow * 0.12 + rng() * 2.5 });
    }
    return [...out.values()].sort((a, b) => b.score - a.score);
  }

  const start = pick(pool.filter((e) => e.w.length >= 5), rng) || pick(pool, rng);
  const sr = OFF, sc = OFF - Math.floor(start.w.length / 2);
  put(start, sr, sc, 'h');
  const rec = () => {
    if (placed.length >= count) return placed.filter((p) => p.d === 'h').length >= 3 && placed.filter((p) => p.d === 'v').length >= 3;
    if (++nodes > 500) return false;
    const cands = gather();
    for (let t = 0; t < Math.min(5, cands.length); t++) {
      const cd = cands[t];
      const undo = put(cd.e, cd.r, cd.c, cd.d);
      if (rec()) return true;
      undo();
      if (nodes > 500) return false;
    }
    return false;
  };
  if (!rec()) return null;
  return placed.map((p) => ({ w: p.e.w, q: p.e.h, k: p.e.k, r: p.r - box.r0, c: p.c - box.c0, d: p.d }));
}

// Aus einer Liste platzierter Wörter ({w, q, r, c, d:'h'|'v'}) das Gitter mit Nummern bauen
export function buildPuzzle(placed) {
  let rows = 0, cols = 0;
  for (const p of placed) {
    const L = p.w.length;
    rows = Math.max(rows, p.r + (p.d === 'v' ? L : 1));
    cols = Math.max(cols, p.c + (p.d === 'h' ? L : 1));
  }
  const g = new Array(rows * cols).fill('#');
  for (const p of placed) for (let k = 0; k < p.w.length; k++) g[(p.r + (p.d === 'v' ? k : 0)) * cols + p.c + (p.d === 'h' ? k : 0)] = p.w[k];
  const has = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && g[r * cols + c] !== '#';
  const words = [];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!has(r, c)) continue;
      const startH = !has(r, c - 1) && has(r, c + 1);
      const startV = !has(r - 1, c) && has(r + 1, c);
      if (!startH && !startV) continue;
      n++;
      for (const [d, on] of [['h', startH], ['v', startV]]) {
        if (!on) continue;
        let len = 0;
        while (has(r + (d === 'v' ? len : 0), c + (d === 'h' ? len : 0))) len++;
        const src = placed.find((p) => p.r === r && p.c === c && p.d === d);
        words.push({ n, d, r, c, len, q: src ? src.q : '' });
      }
    }
  }
  return { cols, rows, sol: g.join(''), words };
}

export function generate(levelId, rng = Math.random, list = WOERTER) {
  const lv = levelOf(levelId);
  if (!lv) throw new Error('Unbekannte Stufe');
  const pool = list.filter((e) => e.w.length >= 3 && e.w.length <= lv.maxLen && e.d <= lv.maxD);
  const byLetter = {};
  for (const e of pool) for (let j = 0; j < e.w.length; j++) (byLetter[e.w[j]] = byLetter[e.w[j]] || []).push([e, j]);
  for (let attempt = 0; attempt < 400; attempt++) {
    const placed = tryBuild(pool, byLetter, lv.count, rng);
    if (placed) {
      const pz = buildPuzzle(placed);
      pz.themes = [...new Set(placed.map((p) => p.k))];
      return pz;
    }
  }
  throw new Error('Rätsel konnte nicht erzeugt werden');
}

// Prüft ein Rätsel streng. Liefert eine Liste von Problemen (leer = gültig).
export function validate(pz, wordSet = new Set(WOERTER.map((e) => e.w))) {
  const bad = [];
  if (!pz || typeof pz !== 'object') return ['kein Rätsel'];
  const { cols, rows, sol, words } = pz;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return ['Größe ungültig'];
  if (cols > MAX_COLS || rows > MAX_ROWS) bad.push(`Gitter zu groß ${cols}x${rows}`);
  if (typeof sol !== 'string' || sol.length !== cols * rows) return ['Gitterlänge falsch'];
  if (!/^[A-Z#]+$/.test(sol)) bad.push('Zeichen ungültig');
  const at = (r, c) => sol[r * cols + c];
  const has = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && at(r, c) !== '#';
  // alle Buchstabenfolgen ≥ 2
  const runs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!has(r, c)) continue;
    if (!has(r, c - 1)) { let s = ''; let k = 0; while (has(r, c + k)) s += at(r, c + k++); if (s.length >= 2) runs.push({ d: 'h', r, c, w: s }); }
    if (!has(r - 1, c)) { let s = ''; let k = 0; while (has(r + k, c)) s += at(r + k++, c); if (s.length >= 2) runs.push({ d: 'v', r, c, w: s }); }
  }
  const seen = new Set();
  for (const run of runs) {
    if (!wordSet.has(run.w)) bad.push(`Folge ${run.w} ist kein Wort der Liste`);
    if (seen.has(run.w)) bad.push(`Wort doppelt: ${run.w}`);
    seen.add(run.w);
  }
  if (!Array.isArray(words) || words.length !== runs.length) bad.push(`Wortzahl ${words && words.length} statt ${runs.length}`);
  else {
    for (const w of words) {
      const m = runs.find((x) => x.d === w.d && x.r === w.r && x.c === w.c);
      if (!m || m.w.length !== w.len) bad.push(`Wort bei ${w.r},${w.c} passt nicht zum Gitter`);
      if (typeof w.q !== 'string' || !w.q) bad.push(`Hinweis fehlt bei ${w.n}`);
    }
  }
  // Zusammenhang
  const letters = [];
  for (let i = 0; i < sol.length; i++) if (sol[i] !== '#') letters.push(i);
  if (!letters.length) bad.push('leer');
  else {
    const vis = new Set([letters[0]]);
    const st = [letters[0]];
    while (st.length) {
      const i = st.pop(), r = Math.floor(i / cols), c = i % cols;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) if (has(rr, cc) && !vis.has(rr * cols + cc)) { vis.add(rr * cols + cc); st.push(rr * cols + cc); }
    }
    if (vis.size !== letters.length) bad.push('nicht zusammenhängend');
  }
  // Nummerierung: Anfangsfelder in Lesereihenfolge, laufend ab 1
  if (Array.isArray(words)) {
    const starts = [];
    for (const w of words) { const k = `${w.r},${w.c}`; if (!starts.some((s) => s.k === k)) starts.push({ k, r: w.r, c: w.c, n: w.n }); }
    starts.sort((a, b) => a.r - b.r || a.c - b.c);
    starts.forEach((s, i) => { if (s.n !== i + 1) bad.push(`Nummer ${s.n} statt ${i + 1}`); });
    for (const w of words) { const s = starts.find((x) => x.r === w.r && x.c === w.c); if (s && s.n !== w.n) bad.push('Nummer uneinheitlich'); }
  }
  return bad;
}

// ---------- Spielzustand ----------
function loadPuzzle(g, level, pz) {
  g.level = level;
  g.cols = pz.cols; g.rows = pz.rows; g.sol = pz.sol;
  g.words = pz.words.map((w) => ({ n: w.n, d: w.d, r: w.r, c: w.c, len: w.len, q: w.q }));
  g.cells = Array.from(pz.sol, (x) => (x === '#' ? '#' : ''));
  g.revealed = [];
  g.hints = 0; g.helpLetters = 0; g.helpWords = 0; g.checks = 0;
  g.flagged = []; g.check = null; g.elapsed = 0; g.result = null;
  g.seq += 1;
  g.mode = 'play';
}
export function createGame(players, opts = {}) {
  const g = {
    v: 1, players: (players || []).map((p) => ({ id: String(p.id), name: String(p.name || '') })),
    mode: 'choose', seq: 0, level: '', cols: 0, rows: 0, sol: '', words: [], cells: [], revealed: [],
    hints: 0, helpLetters: 0, helpWords: 0, checks: 0, flagged: [], check: null, elapsed: 0, result: null,
  };
  if (opts.learn && opts.puzzle) loadPuzzle(g, 'lern', buildPuzzle(opts.puzzle));
  return g;
}
export function startPuzzle(g, levelId, rng) {
  loadPuzzle(g, levelId, generate(levelId, rng));
  return g;
}

export const isBlock = (g, i) => g.sol[i] === '#';
export const isLocked = (g, i) => g.revealed.includes(i);
export const letterTotal = (g) => (g.sol.match(/[A-Z]/g) || []).length;
export const emptyCount = (g) => g.cells.filter((x) => x === '').length;
export const isFull = (g) => g.cells.length > 0 && emptyCount(g) === 0;
export const isSolved = (g) => g.cells.length > 0 && g.sol.length === g.cells.length && g.cells.every((x, i) => g.sol[i] === '#' || x === g.sol[i]);
export const wrongCells = (g) => g.cells.reduce((a, x, i) => (x && x !== '#' && x !== g.sol[i] ? (a.push(i), a) : a), []);

export const wordCells = (g, w) => Array.from({ length: w.len }, (_, k) => (w.r + (w.d === 'v' ? k : 0)) * g.cols + w.c + (w.d === 'h' ? k : 0));
export function wordAt(g, i, d) {
  return g.words.find((w) => w.d === d && wordCells(g, w).includes(i)) || null;
}
export const dirName = (d) => (d === 'h' ? 'waagerecht' : 'senkrecht');
export const clueText = (w) => `${w.n} ${dirName(w.d)}: ${w.q} (${w.len})`;
export const answerOf = (g, w) => wordCells(g, w).map((i) => g.sol[i]).join('');
export function wordIndex(g, w) { return g.words.findIndex((x) => x.n === w.n && x.d === w.d); }
export function stepWord(g, w, delta) {
  const n = g.words.length;
  if (!n) return null;
  const i = w ? wordIndex(g, w) : -1;
  return g.words[(((i < 0 ? (delta > 0 ? -1 : 0) : i) + delta) % n + n) % n];
}

// ---------- Zeit, Bestzeit ----------
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
// Aufgedeckte Buchstaben/Wörter zählen nicht für die Bestzeit.
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
  g.result = { ms: g.elapsed, level: g.level, hints: g.hints, helpLetters: g.helpLetters, helpWords: g.helpWords, checks: g.checks, mistakes: g.flagged.length, record: null, prev: 0 };
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
  if (g.mode !== 'play') return bad(g.mode === 'over' ? 'Dieses Rätsel ist schon gelöst.' : 'Bitte starte zuerst ein Rätsel.');

  const okCell = (i) => isInt(i, 0, g.cells.length - 1) && !isBlock(g, i);
  switch (msg.t) {
    case 'sync':
      touch(g, msg.ms);
      return { ok: true };
    case 'put': {
      const ch = typeof msg.ch === 'string' ? msg.ch.toUpperCase() : '';
      if (!okCell(msg.i) || !/^[A-Z]$/.test(ch)) return bad('Ungültiges Feld oder ungültiger Buchstabe.');
      if (isLocked(g, msg.i)) return bad('Dieser Buchstabe ist aufgedeckt und fest.');
      touch(g, msg.ms);
      if (g.cells[msg.i] === ch) return { ok: true };
      g.cells[msg.i] = ch;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'erase': {
      if (!okCell(msg.i)) return bad('Ungültiges Feld.');
      if (isLocked(g, msg.i)) return bad('Dieser Buchstabe ist aufgedeckt und fest.');
      if (!g.cells[msg.i]) return bad('Dieses Feld ist schon leer.');
      touch(g, msg.ms);
      g.cells[msg.i] = '';
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
    case 'revealLetter': {
      if (!okCell(msg.i)) return bad('Ungültiges Feld.');
      if (g.cells[msg.i] === g.sol[msg.i]) return bad('Dieses Feld ist schon richtig.');
      touch(g, msg.ms);
      g.cells[msg.i] = g.sol[msg.i];
      g.revealed.push(msg.i);
      g.hints += 1; g.helpLetters += 1;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    case 'revealWord': {
      const w = g.words.find((x) => x.n === msg.n && x.d === msg.d);
      if (!w) return bad('Dieses Wort gibt es nicht.');
      const todo = wordCells(g, w).filter((i) => g.cells[i] !== g.sol[i]);
      if (!todo.length) return bad('Dieses Wort ist schon richtig.');
      touch(g, msg.ms);
      for (const i of todo) { g.cells[i] = g.sol[i]; if (!g.revealed.includes(i)) g.revealed.push(i); }
      g.hints += 1; g.helpWords += 1;
      g.check = null;
      finishIfDone(g);
      return { ok: true };
    }
    default:
      return bad('Unbekannte Eingabe.');
  }
}
