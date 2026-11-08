// Zeichenraten – reine Regeln (JSON-Zustand, keine Oberfläche, kein Netzwerk).
// Zufall kommt als Parameter `rng`, die Uhrzeit als Parameter `now` (Millisekunden) hinein.
//
// Modi: 'online' (Gastgeber + Gäste), 'local' (alle an einem Gerät, die aktive Person handelt über den Gastgeber),
//       'learn' (Lernrunde: Mensch zeichnet "Haus", der simulierte Computer rät).
// Phasen: 'setup' (nur local: Namen sammeln) -> 'ready' (nur local: Gerät weitergeben) -> 'draw' -> 'result' -> ... -> 'over'.
// Achtung: Der geheime Begriff steht technisch im Zustand (der Gastgeber schickt ihn an alle Geräte);
// die Oberfläche zeigt ihn nur dem Zeichner und nach der Auflösung allen.
//
// Nachrichten (msg.t):
//   stroke {pts:[[x,y],...] (1..40 Punkte, Fläche 0..1000), c:0..6 (6 = Radierer), w:0..2, k?:Strichnummer}  Zeichner
//   clear / undo                                    Zeichner
//   guess {text}                                    alle außer Zeichner (online/Lernrunde)
//   got {id}                                        local: Zeichner meldet, wer es erraten hat
//   go                                              local: Zeichner ist bereit (Zeit läuft los)
//   next                                            Gastgeber (local: auch der Zeichner)
//   timeup / hint / skip                            Gastgeber (Zeitgeber), skip: Runde jetzt beenden (local: auch Zeichner)
//   addlocal {name} / dellocal {id} / startlocal    local, nur Gastgeber, Phase setup
import { BEGRIFFE } from './begriffe.js';

export const GAME = 'zr';
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const MAX_NAME = 14;
export const MODES = ['online', 'local', 'learn'];
export const TIME_MS = { normal: 90000, long: 150000 };
export const HINT_AT = [0.5, 0.75]; // Anteil der Zeit, ab dem der 1. bzw. 2. Buchstabe erscheint
export const PTS = { right: 10, drawer: 5, drawerMax: 20, secDiv: 9 };
export const COLORS = ['#111111', '#d32f2f', '#1f5fbf', '#2e8b3d', '#f2b705', '#8b5a2b'];
export const COLOR_NAMES = ['Schwarz', 'Rot', 'Blau', 'Grün', 'Gelb', 'Braun'];
export const ERASER = 6;
export const MAX_PTS_MSG = 40;
export const MAX_STROKES = 300;
export const MAX_POINTS = 8000;
export const MAX_CHAT = 60;
export const MAX_GUESS = 30;
export const TOLERANCE_MS = 1500;
export const LERN_WORT = { w: 'Haus', alt: [], k: 'Natur' };

export const isBotId = (id) => typeof id === 'string' && id.startsWith('bot');

function pickIdx(rng, n) { return Math.min(n - 1, Math.floor(rng() * n)); }

// ---------- Raten prüfen ----------
const ARTIKEL = ['der', 'die', 'das', 'ein', 'eine', 'einen', 'dem', 'den'];
export function normalize(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function guessVariants(text) {
  const out = [normalize(text)];
  const words = String(text).trim().split(/\s+/);
  if (words.length > 1 && ARTIKEL.includes(normalize(words[0]))) out.push(normalize(words.slice(1).join(' ')));
  return out.filter(Boolean);
}
// Stimmt der Rateversuch mit dem Begriff (oder einem Synonym) überein?
export function matches(text, word) {
  if (!word || typeof text !== 'string') return false;
  const targets = [word.w, ...(Array.isArray(word.alt) ? word.alt : [])].map(normalize).filter(Boolean);
  for (const v of guessVariants(text)) {
    for (const t of targets) {
      if (v === t) return true;
      if (t.length >= 6 && Math.abs(v.length - t.length) <= 1 && levenshtein(v, t) <= 1) return true;
    }
  }
  return false;
}

// ---------- Hinweis-Buchstaben ----------
export const lettersOf = (word) => Array.from(String(word)).filter((ch) => ch !== ' ');
export const letterCount = (word) => lettersOf(word).length;
// Wie viele Buchstaben sind verraten? (Zeit-Hinweise; nie das ganze Wort)
export const shownLetters = (g) => (g.word ? Math.max(0, Math.min(g.hint | 0, 2, letterCount(g.word.w) - 1)) : 0);
// Maske als Wörterliste, z. B. [['F','_','_'],['_','_']]
export function maskWords(g) {
  if (!g.word) return [];
  let seen = 0;
  const show = shownLetters(g);
  return g.word.w.split(' ').map((part) => Array.from(part).map((ch) => {
    const mine = seen++;
    return mine < show ? ch.toLocaleUpperCase('de-DE') : '_';
  }));
}
export const maskText = (g) => maskWords(g).map((w) => w.join(' ')).join('   ');

// ---------- Hilfen ----------
const cleanName = (t) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '');
const cleanText = (t) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS) : '');
export const nameOf = (g, id) => (g.players.find((p) => p.id === id) || { name: '?' }).name;
export const drawerId = (g) => (g.players.length && g.phase !== 'setup' && g.phase !== 'over' ? g.players[g.ri % g.players.length].id : null);
export const drawer = (g) => g.players.find((p) => p.id === drawerId(g)) || null;
export const guessers = (g) => g.players.filter((p) => p.id !== drawerId(g));
export const pointCount = (g) => g.strokes.reduce((n, s) => n + s.p.length, 0);
export const remainingMs = (g, now = Date.now()) => (g.limit > 0 && g.t0 !== null ? Math.max(0, g.limit - (now - g.t0)) : 0);
export const timeBonus = (leftMs) => Math.round(Math.max(0, leftMs) / 1000 / PTS.secDiv);
export const roundsFor = (n, twice) => n * (twice ? 2 : 1);

const copyWord = (b) => ({ w: String(b.w), alt: Array.isArray(b.alt) ? b.alt.map(String) : [], k: String(b.k || '') });

function pickWord(g, rng) {
  let pool = BEGRIFFE.filter((b) => !g.used.includes(b.w));
  if (pool.length < 1) { g.used = []; pool = BEGRIFFE.slice(); }
  const b = pool[pickIdx(rng, pool.length)];
  g.used.push(b.w);
  if (g.used.length > BEGRIFFE.length) g.used = g.used.slice(-BEGRIFFE.length);
  g.word = copyWord(b);
}

function resetRound(g) {
  g.strokes = []; g.chat = []; g.order = []; g.gains = {}; g.dgain = 0; g.hint = 0; g.reason = null;
}

function startRound(g, rng, now) {
  resetRound(g);
  if (g.mode === 'learn') g.word = copyWord(LERN_WORT);
  else pickWord(g, rng);
  g.phase = g.mode === 'local' ? 'ready' : 'draw';
  g.t0 = g.phase === 'draw' ? now : null;
}

// opts: { mode, long, nolimit, twice, host, exclude: [Wörter der letzten Spiele], now, limitMs (Test) }
export function createGame(players, opts = {}, rng = Math.random) {
  const ps = (players || []).slice(0, MAX_PLAYERS).map((p) => ({ id: String(p.id), name: String(p.name) }));
  let mode = MODES.includes(opts.mode) ? opts.mode : 'online';
  if (mode === 'online' && ps.length < 2) mode = 'local';
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const scores = {}; const wins = {};
  for (const p of ps) { scores[p.id] = 0; wins[p.id] = 0; }
  let limit = mode === 'learn' ? TIME_MS.long : opts.nolimit ? 0 : opts.long ? TIME_MS.long : TIME_MS.normal;
  if (mode !== 'learn' && !opts.nolimit && Number.isFinite(opts.limitMs) && opts.limitMs >= 1000) limit = Math.round(opts.limitMs); // nur für Tests und Entwicklung
  const g = {
    game: GAME, gid: Math.floor(rng() * 1e9), mode, host: opts.host || (ps[0] && ps[0].id) || '',
    players: ps, scores, wins, twice: !!opts.twice && mode !== 'learn', limit,
    len: mode === 'learn' ? 1 : roundsFor(ps.length, !!opts.twice), ri: 0, lc: 0, sk: 0, nc: 0,
    phase: mode === 'local' ? 'setup' : 'draw', word: null, used: Array.isArray(opts.exclude) ? opts.exclude.map(String).slice(-BEGRIFFE.length) : [],
    t0: null, hint: 0, strokes: [], chat: [], order: [], gains: {}, dgain: 0, reason: null,
  };
  if (mode !== 'local') startRound(g, rng, now);
  return g;
}

// ---------- Wertung ----------
function award(g, pid, now) {
  const bonus = timeBonus(remainingMs(g, now));
  const gain = PTS.right + bonus;
  g.scores[pid] = (g.scores[pid] || 0) + gain;
  g.wins[pid] = (g.wins[pid] || 0) + 1;
  g.gains[pid] = gain;
  g.order.push(pid);
  const did = drawerId(g);
  const dg = Math.max(0, Math.min(PTS.drawer, PTS.drawerMax - g.dgain));
  g.dgain += dg;
  g.scores[did] = (g.scores[did] || 0) + dg;
  pushChat(g, { k: 'ok', by: pid });
  if (g.order.length >= guessers(g).length) finish(g, 'all');
}

function pushChat(g, e) {
  g.nc++;
  g.chat.push({ n: g.nc, ...e });
  if (g.chat.length > MAX_CHAT) g.chat.splice(0, g.chat.length - MAX_CHAT);
}

function finish(g, reason) {
  g.phase = 'result';
  g.reason = reason;
}

function cleanPoints(pts) {
  if (!Array.isArray(pts) || pts.length < 1 || pts.length > MAX_PTS_MSG) return null;
  const out = [];
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = Number(p[0]); const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const cl = (v) => Math.round(Math.min(1000, Math.max(0, v)) * 100) / 100;
    out.push([cl(x), cl(y)]);
  }
  return out;
}

// Gibt true zurück, wenn sich der Zustand geändert hat.
export function handle(g, pid, msg, rng = Math.random, now = Date.now()) {
  if (!g || g.game !== GAME || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return false;
  const me = g.players.find((p) => p.id === pid);
  if (!me) return false;
  if (g.phase === 'over') return false;
  const isHost = g.host === pid;
  const did = drawerId(g);
  const isDrawer = did === pid;

  switch (msg.t) {
    // ---------- local: Namen sammeln ----------
    case 'addlocal': {
      if (g.mode !== 'local' || g.phase !== 'setup' || !isHost || g.players.length >= MAX_PLAYERS) return false;
      const name = cleanName(msg.name);
      if (!name || g.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
      g.lc++;
      const id = `l${g.lc}`;
      g.players.push({ id, name });
      g.scores[id] = 0; g.wins[id] = 0;
      return true;
    }
    case 'dellocal': {
      if (g.mode !== 'local' || g.phase !== 'setup' || !isHost) return false;
      const i = g.players.findIndex((p) => p.id === msg.id && /^l\d+$/.test(p.id));
      if (i < 0) return false;
      delete g.scores[msg.id]; delete g.wins[msg.id];
      g.players.splice(i, 1);
      return true;
    }
    case 'startlocal': {
      if (g.mode !== 'local' || g.phase !== 'setup' || !isHost || g.players.length < MIN_PLAYERS) return false;
      g.len = roundsFor(g.players.length, g.twice);
      g.ri = 0;
      startRound(g, rng, now);
      return true;
    }
    case 'go': { // local: Zeichner ist bereit, die Zeit läuft los
      if (g.mode !== 'local' || g.phase !== 'ready' || !(isDrawer || isHost)) return false;
      g.phase = 'draw';
      g.t0 = now;
      return true;
    }

    // ---------- Zeichnen ----------
    case 'stroke': {
      if (g.phase !== 'draw' || !isDrawer) return false;
      const { c, w } = msg;
      if (!Number.isInteger(c) || c < 0 || c > ERASER || !Number.isInteger(w) || w < 0 || w > 2) return false;
      const pts = cleanPoints(msg.pts);
      if (!pts) return false;
      if (pointCount(g) + pts.length > MAX_POINTS) return false;
      const last = g.strokes[g.strokes.length - 1];
      const hasK = Number.isInteger(msg.k) && msg.k >= 0 && msg.k <= 1e9;
      if (hasK && last && last.k === msg.k) {
        if (last.c !== c || last.w !== w) return false;
        last.p.push(...pts);
        return true;
      }
      if (g.strokes.length >= MAX_STROKES) return false;
      const k = hasK ? msg.k : g.sk + 1;
      g.strokes.push({ k, c, w, p: pts });
      g.sk = Math.max(g.sk, k);
      return true;
    }
    case 'undo': {
      if (g.phase !== 'draw' || !isDrawer || !g.strokes.length) return false;
      g.strokes.pop();
      return true;
    }
    case 'clear': {
      if (g.phase !== 'draw' || !isDrawer || !g.strokes.length) return false;
      g.strokes = [];
      return true;
    }

    // ---------- Raten ----------
    case 'guess': {
      if (g.phase !== 'draw' || g.mode === 'local' || isDrawer || g.order.includes(pid)) return false;
      const text = cleanText(msg.text);
      if (!text) return false;
      if (matches(text, g.word)) award(g, pid, now);
      else pushChat(g, { k: 'g', by: pid, text });
      return true;
    }
    case 'got': { // local: laut erraten, der Zeichner vergibt die Punkte
      if (g.phase !== 'draw' || g.mode !== 'local' || !(isDrawer || isHost)) return false;
      const who = g.players.find((p) => p.id === msg.id);
      if (!who || who.id === did || g.order.includes(who.id)) return false;
      award(g, who.id, now);
      return true;
    }

    // ---------- Zeitgeber (Gastgeber) ----------
    case 'hint': {
      if (g.phase !== 'draw' || !isHost || g.limit <= 0 || g.t0 === null) return false;
      const el = now - g.t0 + TOLERANCE_MS;
      const want = el >= g.limit * HINT_AT[1] ? 2 : el >= g.limit * HINT_AT[0] ? 1 : 0;
      if (want <= g.hint) return false;
      g.hint = want;
      return true;
    }
    case 'timeup': {
      if (g.phase !== 'draw' || !isHost || g.limit <= 0 || g.t0 === null) return false;
      if (now - g.t0 < g.limit - TOLERANCE_MS) return false;
      finish(g, 'time');
      return true;
    }
    case 'skip': {
      if (g.phase !== 'draw' || !(isHost || (g.mode === 'local' && isDrawer))) return false;
      finish(g, 'skip');
      return true;
    }

    case 'next': {
      if (g.phase !== 'result') return false;
      if (!(isHost || (g.mode === 'local' && isDrawer))) return false;
      if (g.ri + 1 >= g.len) { g.phase = 'over'; return true; }
      g.ri++;
      startRound(g, rng, now);
      return true;
    }
    default:
      return false;
  }
}

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, score: g.scores[p.id] || 0, right: g.wins[p.id] || 0, i }));
  rows.sort((a, b) => b.score - a.score || b.right - a.right || a.i - b.i);
  let rank = 0; let prev = null;
  rows.forEach((r, idx) => {
    if (!prev || r.score !== prev.score || r.right !== prev.right) rank = idx + 1;
    r.rank = rank; prev = r;
  });
  return rows;
}
export const winners = (g) => ranking(g).filter((r) => r.rank === 1);
