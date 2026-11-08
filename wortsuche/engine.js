// Wortsuche – reine Spiellogik (keine Oberfläche, kein Netzwerk). Der Zustand ist reines JSON.
// Hinweis: Er enthält technisch die Lage ALLER Wörter (words[].r/c/d). Die Oberfläche zeigt nur das Gitter und die
// Wortliste; Lage und Richtung bleiben im DOM verborgen (außer kurz bei der Option "erster Buchstabe leuchtet"
// und in der Lernrunde). Wie bei den anderen Spielen mit verdeckter Information akzeptiert.
//
// Bedienung: Zwei Tipps (Anfangs- und Endfeld) ergeben eine Linie. Die Oberfläche prüft sie vorab mit probe();
// eine Treffer-Linie geht als { t:'line', a, b } an handle(). Computer melden { t:'find', word } (nur Computer-Kennungen).
// Wertung: 10 Punkte für das Wort, wer es zuerst bestätigt. Ende, wenn alle Wörter gefunden sind.
import { THEMEN, THEMA_IDS } from './woerter.js';

export const GAME = 'ws';
export const MAX_PLAYERS = 6;
export const PTS_FIND = 10;
export const HELP_COST = { solo: 1, multi: 2 };
export const MAX_MS = 24 * 3600 * 1000;

// Richtungen (Zeilen- und Spaltenschritt): → ↓ ↘ ← ↑ ↖ ↙ ↗
export const DIRS8 = [[0, 1], [1, 0], [1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1], [-1, 1]];
export const STUFEN = {
  leicht: { n: 8, count: 8, dirs: [0, 1], label: 'Leicht', cell: 44 },
  mittel: { n: 10, count: 10, dirs: [0, 1, 2], label: 'Mittel', cell: 36 },
  schwer: { n: 12, count: 12, dirs: [0, 1, 2, 3, 4, 5, 6, 7], label: 'Schwer', cell: 30 },
};
export const STUFE_IDS = Object.keys(STUFEN);
export const LERN_WOERTER = 5;

export const isBotId = (id) => String(id).startsWith('bot');

export function stufeOf(o) {
  const x = o && typeof o === 'object' ? o : {};
  if (STUFEN[x.stufe]) return x.stufe;
  return x.hard ? 'schwer' : x.easy ? 'leicht' : 'mittel';
}

// Buchstabenhäufigkeit im Deutschen (Prozent, gerundet) für die Füllbuchstaben
const FREQ = { A: 6.5, B: 1.9, C: 3.1, D: 5.1, E: 17.4, F: 1.7, G: 3.0, H: 4.8, I: 7.5, J: 0.3, K: 1.2, L: 3.4, M: 2.5, N: 9.8, O: 2.5, P: 0.8, Q: 0.1, R: 7.0, S: 7.3, T: 6.2, U: 4.4, V: 0.7, W: 1.9, X: 0.1, Y: 0.1, Z: 1.1 };
const FREQ_LETTERS = Object.keys(FREQ);
const FREQ_SUM = FREQ_LETTERS.reduce((a, k) => a + FREQ[k], 0);

const mkRi = (rng) => (n) => Math.min(n - 1, Math.floor(rng() * n));
function mkShuffle(rng) {
  const ri = mkRi(rng);
  return (a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
}
function randomLetter(rng, not) {
  for (let k = 0; k < 20; k++) {
    let r = rng() * FREQ_SUM;
    let out = FREQ_LETTERS[FREQ_LETTERS.length - 1];
    for (const L of FREQ_LETTERS) { r -= FREQ[L]; if (r < 0) { out = L; break; } }
    if (out !== not) return out;
  }
  return not === 'E' ? 'N' : 'E';
}

const rev = (s) => [...s].reverse().join('');

// Alle Fundstellen eines Wortes im Gitter (alle 8 Richtungen): [{ r, c, d }]
export function occurrences(letters, n, word) {
  const out = [];
  const L = word.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (letters[r * n + c] !== word[0]) continue;
      for (let d = 0; d < 8; d++) {
        const [dr, dc] = DIRS8[d];
        const er = r + dr * (L - 1); const ec = c + dc * (L - 1);
        if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
        let ok = true;
        for (let k = 1; k < L; k++) if (letters[(r + dr * k) * n + (c + dc * k)] !== word[k]) { ok = false; break; }
        if (ok) out.push({ r, c, d });
      }
    }
  }
  return out;
}

// Felder (Indizes) eines platzierten Wortes
export function wordCells(n, wd) {
  const [dr, dc] = DIRS8[wd.d];
  return Array.from({ length: wd.w.length }, (_, k) => (wd.r + dr * k) * n + (wd.c + dc * k));
}

// Wörter für ein Gitter wählen: keins in einem anderen enthalten (auch rückwärts), keine Palindrome
function pickWords(pool, count, maxLen, rng) {
  const shuffle = mkShuffle(rng);
  const cand = shuffle(pool.filter((x) => /^[A-Z]{4,10}$/.test(x) && x.length <= maxLen && x !== rev(x)));
  const out = [];
  for (const x of cand) {
    if (out.length >= count) break;
    if (out.some((y) => y.includes(x) || x.includes(y) || y.includes(rev(x)) || x.includes(rev(y)))) continue;
    out.push(x);
  }
  return out;
}

// Gitter erzeugen. Rückgabe: { letters, words:[{w,r,c,d}] } mit w alphabetisch sortiert.
export function buildGrid(stufe, wordPool, rng, count) {
  const cfg = STUFEN[stufe];
  const n = cfg.n;
  const want = count || cfg.count;
  const ri = mkRi(rng);
  for (let attempt = 0; attempt < 200; attempt++) {
    const picked = pickWords(wordPool, want, n, rng);
    if (picked.length < want) continue;
    const order = picked.slice().sort((a, b) => b.length - a.length);
    const cells = Array(n * n).fill('');
    const mine = Array(n * n).fill(false);
    const placed = [];
    let failed = false;
    for (const word of order) {
      let done = false;
      for (let t = 0; t < 300 && !done; t++) {
        const d = cfg.dirs[ri(cfg.dirs.length)];
        const [dr, dc] = DIRS8[d];
        const r = ri(n); const c = ri(n);
        const er = r + dr * (word.length - 1); const ec = c + dc * (word.length - 1);
        if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
        let ok = true; let cross = 0;
        for (let k = 0; k < word.length; k++) {
          const cur = cells[(r + dr * k) * n + (c + dc * k)];
          if (cur && cur !== word[k]) { ok = false; break; }
          if (cur) cross += 1;
        }
        if (!ok || cross === word.length) continue;
        for (let k = 0; k < word.length; k++) { const i = (r + dr * k) * n + (c + dc * k); cells[i] = word[k]; mine[i] = true; }
        placed.push({ w: word, r, c, d });
        done = true;
      }
      if (!done) { failed = true; break; }
    }
    if (failed) continue;
    for (let i = 0; i < n * n; i++) if (!cells[i]) cells[i] = randomLetter(rng);
    // Jedes Wort darf genau einmal vorkommen (alle 8 Richtungen). Mehrfachfunde: Füllbuchstaben ändern.
    let clean = false;
    for (let round = 0; round < 400 && !clean; round++) {
      const letters = cells.join('');
      let bad = null;
      for (const p of placed) {
        const hits = occurrences(letters, n, p.w).filter((h) => !(h.r === p.r && h.c === p.c && h.d === p.d));
        if (hits.length) { bad = { p, h: hits[0] }; break; }
      }
      if (!bad) { clean = true; break; }
      const idx = wordCells(n, { w: bad.p.w, r: bad.h.r, c: bad.h.c, d: bad.h.d }).filter((i) => !mine[i]);
      if (!idx.length) break; // liegt ganz auf Wörtern: neu würfeln
      const i = idx[ri(idx.length)];
      cells[i] = randomLetter(rng, cells[i]);
    }
    if (!clean) continue;
    placed.sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
    return { letters: cells.join(''), words: placed };
  }
  throw new Error('Gitter konnte nicht erzeugt werden');
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const ri = mkRi(rng);
  const learn = !!o.learn;
  const stufe = learn ? 'leicht' : stufeOf(o);
  const cfg = STUFEN[stufe];
  const tid = THEMEN[o.theme] ? o.theme : THEMA_IDS[ri(THEMA_IDS.length)];
  const grid = buildGrid(stufe, THEMEN[tid].woerter, rng, learn ? LERN_WOERTER : cfg.count);
  const players = playerList.slice(0, MAX_PLAYERS).map((p) => ({ id: p.id, name: p.name }));
  return {
    game: 'ws',
    mode: 'play', // 'play' | 'over'
    players,
    stufe, n: cfg.n,
    theme: { id: tid, name: THEMEN[tid].name },
    letters: grid.letters,
    words: grid.words.map((x) => ({ ...x, by: -1 })), // by: Index der Person, die das Wort gefunden hat (-1 = noch gesucht)
    scores: players.map(() => 0),
    helps: players.map(() => 0), // wie oft jemand "erster Buchstabe leuchtet" genutzt hat
    helped: players.map(() => []), // Wortnummern, für die die Hilfe schon bezahlt ist
    help: !!o.help,
    time: !!o.time,
    learn,
    began: false, // Alleinspiel: Uhr läuft ab dem ersten Tipp
    elapsed: 0, // Alleinspiel: gespielte Millisekunden (vom Gerät gemeldet)
    result: null, // Alleinspiel: { timeMs, helps, record }
    seed: ri(2147483647), // nur als Kennung der Partie (Zeitgeber der Oberfläche)
    seq: 0,
    evt: null, // letztes Ereignis: { seq, kind:'find', by, k }
  };
}

// ---------- Abfragen ----------
export const playerIndex = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const foundCount = (g) => g.words.filter((x) => x.by >= 0).length;
export const unfound = (g) => g.words.map((x, k) => (x.by < 0 ? k : -1)).filter((k) => k >= 0);
export const isSolo = (g) => g.players.length === 1;
export const cellRC = (g, i) => [Math.floor(i / g.n), i % g.n];

// Felder einer geraden Linie von Feld a nach Feld b (jeweils eingeschlossen) oder null
export function lineCells(g, a, b) {
  const n = g.n;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n * n || b >= n * n || a === b) return null;
  const r1 = Math.floor(a / n); const c1 = a % n; const r2 = Math.floor(b / n); const c2 = b % n;
  const dr = r2 - r1; const dc = c2 - c1;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
  const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
  const sr = Math.sign(dr); const sc = Math.sign(dc);
  return Array.from({ length: len }, (_, k) => (r1 + sr * k) * n + (c1 + sc * k));
}

// Prüft eine Linie, ohne etwas zu ändern: { kind: 'nolinie'|'falsch'|'schon'|'treffer', k? }
export function probe(g, a, b) {
  if (!g || !Array.isArray(g.words)) return { kind: 'falsch' };
  const cells = lineCells(g, a, b);
  if (!cells) return { kind: 'nolinie' };
  for (let k = 0; k < g.words.length; k++) {
    const wc = wordCells(g.n, g.words[k]);
    if (wc.length !== cells.length) continue;
    const same = wc.every((x, i) => x === cells[i]) || wc.every((x, i) => x === cells[cells.length - 1 - i]);
    if (same) return { kind: g.words[k].by >= 0 ? 'schon' : 'treffer', k };
  }
  return { kind: 'falsch' };
}

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, score: g.scores[i], words: g.words.filter((x) => x.by === i).length, helps: g.helps[i], i }));
  const max = Math.max(...rows.map((r) => r.score));
  const out = rows.map((r) => ({ ...r, rank: 1 + rows.filter((q) => q.score > r.score).length, win: r.score === max }));
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i);
}

export function outcome(g) {
  if (g.mode !== 'over') return null;
  const rk = ranking(g);
  return { kind: isSolo(g) ? 'solo' : 'multi', timeMs: g.result ? g.result.timeMs : null, winners: rk.filter((r) => r.win).map((r) => r.id), ranking: rk };
}

// Bestzeit im Alleinspiel: mit Hilfe zählt die Zeit nicht. Gibt { record, best } zurück (best in ms oder null)
export function settleResult(g, prevBest) {
  if (!g || !g.result) return null;
  const prev = Number.isFinite(prevBest) && prevBest > 0 ? prevBest : null;
  if (g.result.helps > 0) { g.result.record = false; return { record: false, best: prev }; }
  const record = prev === null || g.result.timeMs < prev;
  g.result.record = record;
  return { record, best: record ? g.result.timeMs : prev };
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Aktionen ----------
const bad = (error, kind = 'fehler') => ({ ok: false, error, kind });

function tick(g, msg) {
  // Alleinspiel: Die Uhr kommt vom Gerät. Sie läuft nur vorwärts und ist nach oben begrenzt.
  if (isSolo(g) && g.mode === 'play' && msg && Number.isFinite(msg.ms)) g.elapsed = Math.max(g.elapsed, Math.min(MAX_MS, Math.round(msg.ms)));
}

function award(g, pi, k) {
  const wd = g.words[k];
  wd.by = pi;
  g.scores[pi] += PTS_FIND;
  g.seq += 1;
  g.evt = { seq: g.seq, kind: 'find', by: pi, k };
  if (foundCount(g) >= g.words.length) {
    g.mode = 'over';
    if (isSolo(g)) g.result = { timeMs: g.elapsed, helps: g.helps[0], record: null };
  }
  return { ok: true, k, by: pi };
}

export function line(g, pid, a, b) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  const p = probe(g, a, b);
  if (p.kind === 'nolinie') return bad('Das ist keine gerade Linie.', 'nolinie');
  if (p.kind === 'schon') return bad('Dieses Wort ist schon gefunden.', 'schon');
  if (p.kind !== 'treffer') return bad('Das ist kein gesuchtes Wort.', 'falsch');
  return award(g, pi, p.k);
}

export function find(g, pid, word) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  if (!isBotId(pid)) return bad('Nur der Computer meldet Wörter so.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  const k = g.words.findIndex((x) => x.w === word);
  if (k < 0) return bad('Dieses Wort gibt es nicht.');
  if (g.words[k].by >= 0) return bad('Dieses Wort ist schon gefunden.', 'schon');
  return award(g, pi, k);
}

export function help(g, pid, k) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  if (!g.help) return bad('Diese Hilfe ist nicht eingeschaltet.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  if (!Number.isInteger(k) || k < 0 || k >= g.words.length) return bad('Dieses Wort gibt es nicht.');
  if (g.words[k].by >= 0) return bad('Dieses Wort ist schon gefunden.', 'schon');
  if (g.helped[pi].includes(k)) return { ok: true, free: true };
  g.helped[pi].push(k);
  g.helps[pi] += 1;
  g.scores[pi] -= isSolo(g) ? HELP_COST.solo : HELP_COST.multi;
  g.seq += 1;
  return { ok: true, free: false };
}

export function handle(g, pid, msg, rng) { // eslint-disable-line no-unused-vars
  if (!g || typeof g !== 'object') return bad('Kein Spiel.');
  if (!msg || typeof msg !== 'object') return bad('Ungültige Nachricht.');
  if (typeof pid !== 'string' && typeof pid !== 'number') return bad('Unbekannte Person.');
  if (playerIndex(g, pid) < 0) return bad('Du spielst nicht mit.');
  tick(g, msg);
  switch (msg.t) {
    case 'line': return line(g, pid, msg.a, msg.b);
    case 'find': return find(g, pid, msg.word);
    case 'help': return help(g, pid, msg.k);
    case 'begin':
      if (!isSolo(g) || g.mode !== 'play') return bad('Hier läuft keine Uhr.');
      if (!g.began) { g.began = true; g.seq += 1; }
      return { ok: true };
    case 'sync':
      return isSolo(g) && g.mode === 'play' ? { ok: true } : bad('Hier läuft keine Uhr.');
    default: return bad('Unbekannte Nachricht.');
  }
}
