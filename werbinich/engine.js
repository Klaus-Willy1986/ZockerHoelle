// Wer bin ich? – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Das Spiel denkt sich pro Runde einen geheimen Begriff aus (Katalog: begriffe.js). Reihum stellt jede Person
// genau EINE Frage aus der Liste ODER rät. Wer richtig rät, bekommt 10 minus Anzahl der gestellten Fragen
// (höchstens 8 zählen) Punkte, mindestens 2. Falsch geraten kostet 1 Punkt.
// Zufall kommt als Parameter `rng` hinein. Der Spielstand besteht nur aus Zahlen, Texten und Listen (JSON-sicher).
// Achtung: Die geheimen Begriffe (terms) stehen technisch im Zustand, der an alle Geräte geht;
// die Oberfläche zeigt sie erst bei der Auflösung.
import { BEGRIFFE, FRAGEN, KATEGORIE_IDS } from './begriffe.js';

export const GAME = 'wb';
export const MAX_PLAYERS = 6;
export const LENGTHS = { kurz: 3, normal: 5 };
export const PTS = { top: 10, maxAsked: 8, min: 2, wrong: -1 };

export const isBotId = (id) => String(id).startsWith('bot');
const clampIdx = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = clampIdx(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const byId = new Map(BEGRIFFE.map((b) => [b.id, b]));
const qIds = new Set(FRAGEN.map((f) => f.id));
export const term = (id) => byId.get(id) || null;

export const pointsFor = (askedCount) => Math.max(PTS.min, PTS.top - Math.min(PTS.maxAsked, Math.max(0, askedCount | 0)));

// ---------- Spielstand ----------
// opts: { kurz, len, fixed: [Begriffs-Ids], exclude: [Begriffs-Ids schon gespielt], host }
export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 1 || playerList.length > MAX_PLAYERS) throw new Error('1 bis 6 Personen');
  const players = playerList.map((p) => ({ id: String(p.id), name: String(p.name) }));
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Doppelte Spieler-Id');
  let terms = [];
  if (Array.isArray(opts.fixed) && opts.fixed.length) {
    terms = opts.fixed.filter((id) => byId.has(id));
  } else {
    const len = Number.isInteger(opts.len) && opts.len >= 1 && opts.len <= 10 ? opts.len : opts.kurz ? LENGTHS.kurz : LENGTHS.normal;
    const ex = new Set((opts.exclude || []).map(String));
    let cats = [];
    for (let i = 0; i < len; i++) {
      if (!cats.length || i % KATEGORIE_IDS.length === 0) cats = shuffle(KATEGORIE_IDS, rng);
      const k = cats[i % KATEGORIE_IDS.length];
      const all = BEGRIFFE.filter((b) => b.k === k && !terms.includes(b.id));
      let pool = all.filter((b) => !ex.has(b.id));
      if (!pool.length) pool = all;
      terms.push(pool[clampIdx(rng, pool.length)].id);
    }
  }
  if (!terms.length) throw new Error('Keine Begriffe');
  const cats = terms.map((id) => byId.get(id).k);
  const scores = {}; const stats = {};
  for (const p of players) { scores[p.id] = 0; stats[p.id] = { right: 0, wrong: 0 }; }
  return {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    host: opts.host !== undefined ? String(opts.host) : players[0].id,
    players,
    len: terms.length,
    terms, // geheim: ein Begriff je Runde
    cats, // öffentlich: die Kategorie je Runde (wird zu Beginn genannt)
    round: 0,
    phase: 'ask', // ask | reveal | over
    turn: 0, // Index der Person, die dran ist
    asked: [], // [{ q, a, by }] Fragen dieser Runde mit Antwort
    wrong: [], // [{ id, by }] falsch geratene Begriffe dieser Runde
    scores,
    stats,
    reveal: null, // { term, by, pts, asked } nach richtigem Raten
    results: [], // abgeschlossene Runden
    seq: 0,
    evt: null, // letztes Ereignis: { kind:'ask'|'wrong'|'right', by, ... }
  };
}

export const secret = (s) => byId.get(s.terms[s.round]) || null;
export const category = (s) => (s.cats && s.cats[s.round]) || null;
export const isOver = (s) => s.phase === 'over';
export const current = (s) => s.players[s.turn] || null;
export const askedIds = (s) => s.asked.map((x) => x.q);
export const wrongIds = (s) => s.wrong.map((x) => x.id);
export const playerIndex = (s, id) => s.players.findIndex((p) => p.id === id);
export const questionsLeft = (s) => FRAGEN.length - s.asked.length;

// ---------- Nachrichten ----------
const err = (error) => ({ ok: false, error });

export function handle(state, pid, msg, rng = Math.random) {
  if (!state || state.game !== GAME) return err('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return err('Ungültige Nachricht.');
  const pi = playerIndex(state, pid);
  if (pi < 0) return err('Du spielst nicht mit.');
  if (msg.r !== undefined && msg.r !== state.round) return err('Diese Runde ist nicht mehr aktuell.');
  switch (msg.t) {
    case 'ask': {
      if (state.phase === 'over') return err('Das Spiel ist zu Ende.');
      if (state.phase !== 'ask') return err('Die Runde ist schon aufgelöst.');
      if (state.turn !== pi) return err('Du bist nicht dran.');
      if (typeof msg.q !== 'string' || !qIds.has(msg.q)) return err('Diese Frage gibt es nicht.');
      if (state.asked.some((x) => x.q === msg.q)) return err('Diese Frage wurde schon gestellt.');
      const a = secret(state).a[msg.q];
      state.asked.push({ q: msg.q, a, by: pid });
      state.evt = { kind: 'ask', by: pid, q: msg.q, a };
      state.turn = (state.turn + 1) % state.players.length;
      state.seq += 1;
      return { ok: true, a };
    }
    case 'guess': {
      if (state.phase === 'over') return err('Das Spiel ist zu Ende.');
      if (state.phase !== 'ask') return err('Die Runde ist schon aufgelöst.');
      if (state.turn !== pi) return err('Du bist nicht dran.');
      const g = typeof msg.id === 'string' ? byId.get(msg.id) : null;
      const sec = secret(state);
      if (!g || g.k !== category(state)) return err('Diesen Begriff gibt es hier nicht.');
      if (state.wrong.some((x) => x.id === g.id)) return err('Das hast du schon geraten.');
      if (g.id === sec.id) {
        const pts = pointsFor(state.asked.length);
        state.scores[pid] += pts;
        state.stats[pid].right += 1;
        state.reveal = { term: sec.id, by: pid, pts, asked: state.asked.length, wrong: state.wrong.length };
        state.results.push({ round: state.round, term: sec.id, by: pid, pts, asked: state.asked.length });
        state.phase = 'reveal';
        state.evt = { kind: 'right', by: pid, id: g.id, pts };
        state.seq += 1;
        return { ok: true, right: true, pts };
      }
      state.scores[pid] += PTS.wrong;
      state.stats[pid].wrong += 1;
      state.wrong.push({ id: g.id, by: pid });
      state.evt = { kind: 'wrong', by: pid, id: g.id };
      state.turn = (state.turn + 1) % state.players.length;
      state.seq += 1;
      return { ok: true, right: false, pts: PTS.wrong };
    }
    case 'skip': { // Gastgeber überspringt eine Person, die nicht mehr da ist
      if (!isHost(state, pid)) return err('Nur der Gastgeber kann weiterschalten.');
      if (state.phase !== 'ask') return err('Es gibt gerade nichts zu überspringen.');
      if (state.players.length < 2) return err('Allein gibt es niemanden zum Überspringen.');
      state.turn = (state.turn + 1) % state.players.length;
      state.evt = { kind: 'skip', by: pid };
      state.seq += 1;
      return { ok: true };
    }
    case 'next': {
      if (!isHost(state, pid)) return err('Nur der Gastgeber kann weiterschalten.');
      if (state.phase !== 'reveal') return err('Es gibt gerade nichts zum Weiterschalten.');
      if (state.round + 1 >= state.len) { state.phase = 'over'; state.evt = null; } else {
        state.round += 1;
        state.phase = 'ask';
        state.turn = state.round % state.players.length; // Startperson wechselt reihum
        state.asked = []; state.wrong = []; state.reveal = null; state.evt = null;
      }
      state.seq += 1;
      return { ok: true };
    }
    default: return err('Unbekannte Nachricht.');
  }
}
const isHost = (s, pid) => !s.host || s.host === pid;

// ---------- Rangliste ----------
// Sortiert nach Punkten (absteigend); gleiche Punkte teilen sich den Rang, die Reihenfolge der Anmeldung bleibt.
export function ranking(state) {
  const list = state.players.map((p) => ({ id: p.id, name: p.name, score: state.scores[p.id], right: state.stats[p.id].right, wrong: state.stats[p.id].wrong }));
  list.sort((a, b) => b.score - a.score);
  return list.map((r) => ({ ...r, rank: 1 + list.filter((o) => o.score > r.score).length }));
}
export const winners = (state) => ranking(state).filter((r) => r.rank === 1);
