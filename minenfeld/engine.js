// Minenfeld – reine Spiellogik (keine Oberfläche, kein Netzwerk). Zustand ist reines JSON.
// Feld-Index = Zeile * w + Spalte. Minen werden erst beim ersten Tipp verteilt (erstes Feld + Nachbarn sind frei).

export const LEVELS = {
  leicht: { id: 'leicht', name: 'Leicht', w: 8, h: 8, mines: 8, cell: 44 },
  mittel: { id: 'mittel', name: 'Mittel', w: 10, h: 10, mines: 15, cell: 36 },
  schwer: { id: 'schwer', name: 'Schwer', w: 12, h: 12, mines: 28, cell: 30 },
};
export const LEARN = { id: 'lern', name: 'Übung', w: 5, h: 5, mines: 3, cell: 56 };
export const LEVEL_IDS = ['leicht', 'mittel', 'schwer'];
// Festes Übungsfeld: Minen unten links, unten rechts und rechts in der Mitte
export const LEARN_MINES = [14, 20, 24];
export const LEARN_FIRST = 0;

export const levelOf = (opts) => (opts && opts.hard ? 'schwer' : opts && opts.mid ? 'mittel' : 'leicht');
export const levelInfo = (id) => (id === 'lern' ? LEARN : LEVELS[id] || LEVELS.leicht);

export function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rowOf = (g, i) => Math.floor(i / g.w);
export const colOf = (g, i) => i % g.w;
export function neighbors(g, i) {
  const r = Math.floor(i / g.w), c = i % g.w, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < g.h && cc >= 0 && cc < g.w) out.push(rr * g.w + cc);
  }
  return out;
}
export function numberAt(g, i) {
  if (!g.mine) return 0;
  let n = 0;
  for (const j of neighbors(g, i)) if (g.mine[j]) n++;
  return n;
}
export const cellCount = (g) => g.w * g.h;
export const openedCount = (g) => g.open.reduce((a, v) => a + (v ? 1 : 0), 0);
export const flagCount = (g) => g.flag.reduce((a, v) => a + (v ? 1 : 0), 0);
export const flagsLeft = (g) => g.mines - flagCount(g);
export const safeTotal = (g) => g.w * g.h - g.mines;

export function createGame(playerList, opts = {}, rng = Math.random) {
  const o = opts || {};
  const learn = !!o.learn;
  const lv = learn ? LEARN : LEVELS[levelOf(o)];
  const list = Array.isArray(playerList) && playerList.length ? playerList : [{ id: 'p0', name: 'Du' }];
  const n = lv.w * lv.h;
  const g = {
    game: 'mn',
    mode: learn ? 'play' : 'ready', // ready (noch kein Tipp) | play | won | lost
    level: lv.id,
    w: lv.w, h: lv.h, mines: lv.mines,
    learn,
    chord: learn ? true : o.chord !== false,
    seed: Math.floor((typeof rng === 'function' ? rng() : Math.random()) * 2147483646) + 1,
    players: [{ id: list[0].id, name: list[0].name }],
    mine: null,
    open: new Array(n).fill(0),
    flag: new Array(n).fill(0),
    first: learn ? LEARN_FIRST : -1,
    trigger: -1,
    startAt: 0,
    elapsed: 0,
    result: null,
  };
  if (learn) { g.mine = new Array(n).fill(0); for (const i of LEARN_MINES) g.mine[i] = 1; }
  return g;
}

// Minen nach dem ersten Tipp verteilen (seed-fähig). Das Feld und seine Nachbarn bleiben frei.
export function placeMines(g, first) {
  const n = g.w * g.h;
  const banned = new Set([first, ...neighbors(g, first)]);
  const cand = [];
  for (let i = 0; i < n; i++) if (!banned.has(i)) cand.push(i);
  const rnd = mulberry32(g.seed);
  const k = Math.min(g.mines, cand.length);
  for (let a = 0; a < k; a++) {
    const b = a + Math.floor(rnd() * (cand.length - a));
    [cand[a], cand[b]] = [cand[b], cand[a]];
  }
  g.mine = new Array(n).fill(0);
  for (let a = 0; a < k; a++) g.mine[cand[a]] = 1;
  g.mines = k;
}

const isPlayer = (g, pid) => !!g && Array.isArray(g.players) && g.players.length > 0 && g.players[0].id === pid;
const validGame = (g) => !!g && g.game === 'mn' && Array.isArray(g.open) && Array.isArray(g.flag) && Number.isInteger(g.w) && Number.isInteger(g.h);
const timeOf = (g, now) => Math.max(1, (Number.isFinite(now) ? now : g.startAt + 1) - g.startAt);

// Iterative Flutfüllung ab einem sicheren Feld. Flaggen auf geöffneten Feldern verschwinden.
function flood(g, start) {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (g.open[i] || g.mine[i]) continue;
    g.open[i] = 1;
    g.flag[i] = 0;
    if (numberAt(g, i) === 0) for (const j of neighbors(g, i)) if (!g.open[j]) stack.push(j);
  }
}

function openCell(g, i, now) {
  if (g.mine[i]) {
    g.mode = 'lost';
    g.trigger = i;
    g.elapsed = timeOf(g, now);
    return;
  }
  flood(g, i);
}

function checkWin(g, now) {
  if (g.mode !== 'play') return;
  if (openedCount(g) === safeTotal(g)) {
    g.mode = 'won';
    g.elapsed = timeOf(g, now);
    for (let i = 0; i < g.mine.length; i++) if (g.mine[i]) g.flag[i] = 1;
  }
}

export function reveal(g, pid, i, now) {
  if (!validGame(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.mode !== 'ready' && g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!Number.isInteger(i) || i < 0 || i >= g.w * g.h) return { ok: false, error: 'Ungültiges Feld.' };
  if (g.open[i]) return chord(g, i, now);
  if (g.flag[i]) return { ok: false, error: 'Dort steht eine Flagge. Nimm sie zuerst weg, dann kannst du das Feld aufdecken.' };
  if (g.mode === 'ready') {
    placeMines(g, i);
    g.mode = 'play';
    g.first = i;
  }
  if (!g.startAt) g.startAt = Number.isFinite(now) ? now : 1;
  openCell(g, i, now);
  checkWin(g, now);
  return { ok: true };
}

function chord(g, i, now) {
  const n = numberAt(g, i);
  if (!g.mine) return { ok: false, error: 'Dieses Feld ist schon offen.' };
  if (n === 0) return { ok: false, error: 'Dieses Feld ist schon offen.' };
  if (!g.chord) return { ok: false, error: 'Dieses Feld ist schon offen. Tippe die verdeckten Felder einzeln an.' };
  const nb = neighbors(g, i);
  const flags = nb.filter((j) => g.flag[j]).length;
  if (flags !== n) return { ok: false, error: 'Die Zahl passt noch nicht zur Zahl der Flaggen ringsum.' };
  const todo = nb.filter((j) => !g.open[j] && !g.flag[j]);
  if (!todo.length) return { ok: false, error: 'Ringsum ist schon alles offen.' };
  for (const j of todo) {
    if (g.open[j]) continue;
    openCell(g, j, now);
    if (g.mode === 'lost') return { ok: true };
  }
  checkWin(g, now);
  return { ok: true };
}

export function toggleFlag(g, pid, i) {
  if (!validGame(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.mode !== 'ready' && g.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  if (!Number.isInteger(i) || i < 0 || i >= g.w * g.h) return { ok: false, error: 'Ungültiges Feld.' };
  if (g.open[i]) return { ok: false, error: 'Auf ein offenes Feld kommt keine Flagge.' };
  g.flag[i] = g.flag[i] ? 0 : 1;
  return { ok: true };
}

// Nochmal mit demselben Feld: gleiche Minen, die erste Aufdeckstelle wird sofort wieder aufgedeckt.
export function retry(g, pid, now) {
  if (!validGame(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (g.mode !== 'lost') return { ok: false, error: 'Nochmal geht erst nach einer Mine.' };
  if (!g.mine || !Number.isInteger(g.first) || g.first < 0) return { ok: false, error: 'Ungültiger Spielstand.' };
  g.open.fill(0);
  g.flag.fill(0);
  g.trigger = -1;
  g.elapsed = 0;
  g.result = null;
  g.startAt = Number.isFinite(now) ? now : 1;
  g.mode = 'play';
  openCell(g, g.first, now);
  checkWin(g, now);
  return { ok: true };
}

export function setChord(g, pid, on) {
  if (!validGame(g)) return { ok: false, error: 'Ungültiger Spielstand.' };
  if (!isPlayer(g, pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (typeof on !== 'boolean') return { ok: false, error: 'Ungültige Nachricht.' };
  if (!g.learn) g.chord = on;
  return { ok: true };
}

// Nachrichten der Oberfläche; ungültige Nachrichten verändern nie den Zustand.
export function handle(g, pid, msg, rng) { // eslint-disable-line no-unused-vars
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: 'Ungültige Nachricht.' };
  switch (msg.t) {
    case 'reveal': return reveal(g, pid, msg.i, msg.now);
    case 'flag': return toggleFlag(g, pid, msg.i);
    case 'retry': return retry(g, pid, msg.now);
    case 'opts': return setChord(g, pid, msg.chord);
    default: return { ok: false, error: 'Unbekannte Nachricht.' };
  }
}

// ---------- Ergebnis ----------
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// Bestzeit je Stufe: prev = bisherige Bestzeit in ms (0 = keine). Schreibt g.result.
export function settleResult(g, prev) {
  if (!g || g.mode !== 'won') return null;
  const p = Number.isFinite(prev) && prev > 0 ? prev : 0;
  const record = !g.learn && (!p || g.elapsed < p);
  g.result = { ms: g.elapsed, record, prev: p };
  return { record, best: record ? g.elapsed : p };
}
export function ranking(g) {
  if (!g || !Array.isArray(g.players)) return [];
  return [{ id: g.players[0].id, name: g.players[0].name, score: g.mode === 'won' ? 1 : 0, ms: g.elapsed }];
}
