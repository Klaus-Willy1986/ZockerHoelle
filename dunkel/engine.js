// Dunkle Rätsel – reine Regeln (JSON-Zustand, keine Oberfläche).
// Modi: 'book' (Rätselbuch, allein), 'group' (online, eine Person ist Spielleitung), 'local' (Gruppe an einem Gerät),
// 'learn' (Lernrunde: der Computer antwortet aus einer festen Tabelle).
// Die Lösung steht technisch im Zustand (wie bei anderen Spielen mit verdeckten Infos); die Oberfläche zeigt sie nur
// der Spielleitung nach "Lösung ansehen" und am Ende allen.
import { RAETSEL } from './raetsel.js';

export const GAME = 'dr';
export const MAX_PLAYERS = 8;
export const MAX_TEXT = 140;
export const MAX_NAME = 14;
export const LENGTHS = { normal: 5, kurz: 3 };
export const MAX_HINTS = 3;
export const MAX_OPEN_Q = 3; // so viele unbeantwortete Fragen darf eine Person haben
export const MAX_LOG = 300;
export const ANSWERS = ['ja', 'nein', 'egal', 'fast', 'anders'];
export const ANSWER_LABEL = { ja: 'Ja', nein: 'Nein', egal: 'Egal', fast: 'Fast!', anders: 'Anders fragen' };
export const VERDICTS = ['richtig', 'fast', 'falsch'];
export const VERDICT_LABEL = { richtig: 'Richtig!', fast: 'Fast', falsch: 'Falsch' };
export const RATES = ['ja', 'fast', 'nein'];
export const MODES = ['book', 'group', 'local', 'learn'];

export const isBotId = (id) => typeof id === 'string' && id.startsWith('bot');
export const pointsFor = (hints) => Math.max(1, 3 - (hints | 0));
export const ratePoints = (rate, hints) => (rate === 'ja' ? pointsFor(hints) : rate === 'fast' ? 1 : 0);

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cleanText = (t) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');
const cleanName = (t) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '');

// opts: { mode, kurz, leicht, exclude: [ids], host, fixed: { riddle, table, guesses } }
export function createGame(players, opts = {}, rng = Math.random, bank = RAETSEL) {
  const ps = (players || []).slice(0, MAX_PLAYERS).map((p) => ({ id: String(p.id), name: String(p.name) }));
  let mode = MODES.includes(opts.mode) ? opts.mode : (ps.length > 1 ? 'group' : 'book');
  if (mode === 'group' && ps.length < 2) mode = 'book';
  let rs; let len;
  const extra = {};
  if (mode === 'learn') {
    const f = opts.fixed;
    rs = [JSON.parse(JSON.stringify(f.riddle))];
    len = 1;
    extra.table = JSON.parse(JSON.stringify(f.table));
    extra.guessOpts = JSON.parse(JSON.stringify(f.guesses));
  } else {
    len = opts.kurz ? LENGTHS.kurz : LENGTHS.normal;
    const ex = new Set(Array.isArray(opts.exclude) ? opts.exclude : []);
    let pool = bank.filter((r) => !ex.has(r.id));
    if (opts.leicht) { const easy = pool.filter((r) => r.schwer <= 2); if (easy.length >= len) pool = easy; }
    if (pool.length < len) pool = bank.slice();
    rs = shuffle(pool, rng).slice(0, len).map((r) => ({ id: r.id, titel: r.titel, geschichte: r.geschichte, loesung: r.loesung, hinweise: r.hinweise.slice(), schwer: r.schwer }));
  }
  const scores = {}; const wins = {};
  for (const p of ps) { scores[p.id] = 0; wins[p.id] = 0; }
  const g = {
    game: GAME, gid: Math.floor(rng() * 1e9), mode, host: opts.host || (ps[0] && ps[0].id) || '',
    players: ps, scores, wins, len, ri: 0, rs, phase: mode === 'local' ? 'setup' : 'play', lc: 0, n: 0,
    hints: 0, log: [], guess: null, solvedBy: null, gain: 0, rated: null, ...extra,
  };
  return g;
}

export const riddle = (g) => g.rs[g.ri];
export const leaderId = (g) => (g.mode === 'group' || g.mode === 'local') && g.players.length ? g.players[g.ri % g.players.length].id : null;
export const leader = (g) => g.players.find((p) => p.id === leaderId(g)) || null;
export const pendingQs = (g) => g.log.filter((e) => e.k === 'q' && e.a === null);
export const openQsOf = (g, id) => pendingQs(g).filter((e) => e.by === id).length;
export const hintTexts = (g) => riddle(g).hinweise.slice(0, g.hints);
export const nameOf = (g, id) => (g.players.find((p) => p.id === id) || { name: '?' }).name;

function push(g, e) {
  g.n++;
  g.log.push({ n: g.n, ...e });
  if (g.log.length > MAX_LOG) g.log.splice(0, g.log.length - MAX_LOG);
}

function resetRiddle(g) {
  g.hints = 0; g.log = []; g.guess = null; g.solvedBy = null; g.gain = 0; g.rated = null;
}

function solve(g, by, pts) {
  g.phase = 'solved';
  g.solvedBy = by;
  g.gain = pts;
  if (by) { g.scores[by] = (g.scores[by] || 0) + pts; g.wins[by] = (g.wins[by] || 0) + 1; }
}

// Gibt true zurück, wenn sich der Zustand geändert hat.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== GAME || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return false;
  const me = g.players.find((p) => p.id === pid);
  if (!me) return false;
  if (g.phase === 'over') return false;
  const lid = leaderId(g);
  const isLeader = lid === pid;
  const isHost = g.host === pid;
  const mode = g.mode;

  switch (msg.t) {
    // ---------- Gruppe an einem Gerät: Namen sammeln ----------
    case 'addlocal': {
      if (mode !== 'local' || g.phase !== 'setup' || !isHost || g.players.length >= MAX_PLAYERS) return false;
      const name = cleanName(msg.name);
      if (!name || g.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
      g.lc++;
      const id = `l${g.lc}`;
      g.players.push({ id, name });
      g.scores[id] = 0; g.wins[id] = 0;
      return true;
    }
    case 'dellocal': {
      if (mode !== 'local' || g.phase !== 'setup' || !isHost) return false;
      const i = g.players.findIndex((p) => p.id === msg.id && /^l\d+$/.test(p.id));
      if (i < 0) return false;
      delete g.scores[msg.id]; delete g.wins[msg.id];
      g.players.splice(i, 1);
      return true;
    }
    case 'startlocal': {
      if (mode !== 'local' || g.phase !== 'setup' || !isHost || g.players.length < 2) return false;
      g.phase = 'play';
      return true;
    }

    // ---------- Fragen ----------
    case 'ask': {
      if (g.phase !== 'play') return false;
      if (mode === 'learn') {
        const k = msg.k;
        if (!Number.isInteger(k) || k < 0 || k >= g.table.length || g.log.some((e) => e.k === 'q' && e.src === k)) return false;
        push(g, { k: 'q', by: pid, text: g.table[k].q, a: g.table[k].a, src: k });
        return true;
      }
      if (mode !== 'group' || isLeader) return false;
      const text = cleanText(msg.text);
      if (!text || openQsOf(g, pid) >= MAX_OPEN_Q) return false;
      push(g, { k: 'q', by: pid, text, a: null });
      return true;
    }
    case 'answer': {
      if (g.phase !== 'play' || !(mode === 'group' || mode === 'local') || !isLeader || !ANSWERS.includes(msg.v)) return false;
      const e = g.log.find((x) => x.k === 'q' && x.n === msg.n && x.a === null);
      if (!e) return false;
      e.a = msg.v;
      return true;
    }
    case 'say': { // nur Gruppe an einem Gerät: die Frage wurde laut gestellt, der Spielleiter hält die Antwort fest
      if (g.phase !== 'play' || mode !== 'local' || !isLeader || !ANSWERS.includes(msg.v)) return false;
      push(g, { k: 'q', by: pid, text: 'Frage aus der Runde', a: msg.v, spoken: true });
      return true;
    }

    // ---------- Lösungsversuch ----------
    case 'guess': {
      if (g.phase !== 'play' || g.guess) return false;
      if (mode === 'learn') {
        const k = msg.k;
        if (!Number.isInteger(k) || k < 0 || k >= g.guessOpts.length) return false;
        const o = g.guessOpts[k];
        if (g.log.some((e) => e.k === 'g' && e.src === k)) return false;
        push(g, { k: 'g', by: pid, text: o.t, a: o.v, src: k });
        if (o.v === 'richtig') solve(g, pid, pointsFor(g.hints));
        return true;
      }
      if (!(mode === 'group' || mode === 'local') || isLeader) return false;
      let text = cleanText(msg.text);
      if (!text) { if (mode === 'local') text = 'Lösung gesagt'; else return false; }
      g.guess = { by: pid, text };
      push(g, { k: 'g', by: pid, text, a: null });
      return true;
    }
    case 'judge': {
      if (g.phase !== 'play' || !(mode === 'group' || mode === 'local') || !isLeader || !g.guess || !VERDICTS.includes(msg.v)) return false;
      const e = g.log.slice().reverse().find((x) => x.k === 'g' && x.a === null && x.by === g.guess.by);
      if (e) e.a = msg.v;
      const by = g.guess.by;
      g.guess = null;
      if (msg.v === 'richtig') solve(g, by, pointsFor(g.hints));
      return true;
    }

    // ---------- Hinweise ----------
    case 'hint': {
      if (g.phase !== 'play' || g.hints >= MAX_HINTS) return false;
      const allowed = mode === 'book' || mode === 'learn' || ((mode === 'group' || mode === 'local') && isLeader);
      if (!allowed) return false;
      g.hints++;
      push(g, { k: 'h', by: pid, text: riddle(g).hinweise[g.hints - 1], hn: g.hints });
      return true;
    }

    // ---------- Auflösen / Bewerten ----------
    case 'reveal': { // Rätselbuch: Lösung zeigen
      if (g.phase !== 'play' || mode !== 'book') return false;
      g.phase = 'solved';
      return true;
    }
    case 'giveup': { // Gruppe: Spielleitung (oder Gastgeber) löst auf, niemand bekommt Punkte
      if (g.phase !== 'play' || !(mode === 'group' || mode === 'local') || !(isLeader || isHost)) return false;
      g.guess = null;
      solve(g, null, 0);
      return true;
    }
    case 'rate': {
      if (g.phase !== 'solved' || mode !== 'book' || g.rated !== null || !RATES.includes(msg.v)) return false;
      g.rated = msg.v;
      const pts = ratePoints(msg.v, g.hints);
      g.gain = pts;
      g.scores[pid] += pts;
      if (msg.v === 'ja') g.wins[pid] = (g.wins[pid] || 0) + 1;
      return true;
    }
    case 'next': {
      if (g.phase !== 'solved') return false;
      if (mode === 'book' && g.rated === null) return false;
      if ((mode === 'group' || mode === 'local') && !(isLeader || isHost)) return false;
      if (g.ri + 1 >= g.len) { g.phase = 'over'; return true; }
      g.ri++;
      g.phase = 'play';
      resetRiddle(g);
      return true;
    }
    default:
      return false;
  }
}

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, score: g.scores[p.id] || 0, solved: g.wins[p.id] || 0, i }));
  rows.sort((a, b) => b.score - a.score || b.solved - a.solved || a.i - b.i);
  let rank = 0; let prev = null;
  rows.forEach((r, idx) => {
    if (!prev || r.score !== prev.score || r.solved !== prev.solved) rank = idx + 1;
    r.rank = rank; prev = r;
  });
  return rows;
}
export const winners = (g) => ranking(g).filter((r) => r.rank === 1);
