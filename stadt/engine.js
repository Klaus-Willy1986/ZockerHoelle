// Stadt, Land, Fluss – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein. Der Spielstand besteht nur aus Zahlen, Texten, Wahrheitswerten,
// Listen und Objekten (JSON-sicher).
//
// Ablauf einer Runde: Phase 'fill' (alle schreiben gleichzeitig, kein Zeitdruck) -> 'reveal' (Auflösung) -> ...
// -> 'over'. Die Runde endet, wenn alle auf "Fertig" getippt haben. Mit Option `stop`: Tippt jemand auf STOPP
// (erst möglich, wenn alle Felder ausgefüllt sind), läuft eine Frist (der Gastgeber schickt danach `timeup`).
//
// Nachrichten (msg.r = Rundennummer, optional, schützt vor verspäteten Nachrichten):
//   { t:'fill', cat:i, v:'text' }   Entwurf für Kategorie i (wird gespeichert, bleibt beim Neuladen erhalten)
//   { t:'done', v?:[Texte] }        "Fertig" (optional mit allen Entwürfen)
//   { t:'stop', v?:[Texte] }        "STOPP!" (alle Felder müssen ausgefüllt sein; nur mit Option stop)
//   { t:'reopen' }                  "Doch noch ändern" (nur solange die Runde offen und kein Stopp läuft)
//   { t:'vote', pid, cat }          "Gilt nicht" für die ungeprüfte Antwort von pid in Kategorie cat (Umschalter)
//   { t:'next' }                    Gastgeber: nächste Runde / Endergebnis
//   { t:'timeup' }                  Gastgeber: Stopp-Frist abgelaufen
//   { t:'skip' }                    Gastgeber: Runde ohne Säumige beenden
//   { t:'answers', v:[Texte] }      nur für Computer-Mitspieler (ai.js): alle Antworten auf einmal, danach fertig
//
// Wertung je Antwort: 0 Punkte bei leer/ungültig; gültig = beginnt mit dem Buchstaben UND (steht im Wörterbuch
// ODER wird nicht von der Mehrheit der ANDEREN menschlichen Personen angezweifelt). Gültig und einzige gültige
// Antwort der Kategorie: 20; gültig und dasselbe Wort bei mindestens einer anderen gültigen Antwort: 5; sonst 10.
// Ungeprüftes Wort ohne andere Menschen (allein / nur Computer): gültig mit halben Punkten (10 bzw. 5).
//
// Achtung: Die Entwürfe der anderen stehen technisch im Zustand (der Gastgeber schickt ihn an alle Geräte);
// die Oberfläche zeigt sie erst in der Auflösung.
import { WOERTER } from './woerter.js';

export const GAME = 'sl';
export const LETTERS = 'ABDEFGHIJKLMNOPRSTUVWZ'.split(''); // ohne Q, X, Y, C (und ß, Umlaute)
export const CATS = { stadt: 'Stadt', land: 'Land', fluss: 'Fluss', name: 'Name', tier: 'Tier', beruf: 'Beruf', pflanze: 'Pflanze / Obst', essen: 'Essen / Trinken' };
export const BASE_CATS = ['stadt', 'land', 'fluss', 'name', 'tier', 'beruf'];
export const MORE_CATS = [...BASE_CATS, 'pflanze', 'essen'];
export const ROUNDS = { kurz: 4, normal: 6, lang: 10 };
export const PTS = { only: 20, own: 10, same: 5 };
export const STOP_MS = 30000;
export const MAX_PLAYERS = 8;
export const MAX_LEN = 40;

export const isBotId = (id) => String(id).startsWith('bot');
const clampIdx = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = clampIdx(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Vergleichsschlüssel ----------
// Groß/Klein, Leerzeichen, Bindestriche und Satzzeichen egal; ß = ss; ä/ö/ü = ae/oe/ue; Akzente fallen weg.
export function norm(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFC').toLowerCase()
    .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-.,;:!?'’`´_()/]+/g, '');
}
// Eingabe säubern: nur Text, einzeilig, getrimmt, höchstens MAX_LEN Zeichen
export const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN).trim();

const DICT = {};
for (const [cat, list] of Object.entries(WOERTER)) DICT[cat] = new Set(list.map(norm));
export const inDict = (cat, word) => !!DICT[cat] && DICT[cat].has(norm(word));
export const startsWithLetter = (word, letter) => { const k = norm(word); return k.length > 0 && k[0] === String(letter).toLowerCase(); };

// ---------- Spielstand ----------
// opts: { cats?:[Kategorie-Ids], more?:true (8 statt 6), rounds?:1..22 (Standard 6), stop?:true,
//         letters?:[feste Buchstaben, z. B. für die Lernrunde], host?:Spielleiter-Id }
export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 1 || playerList.length > MAX_PLAYERS) throw new Error('1 bis 8 Personen');
  const players = playerList.map((p) => ({ id: String(p.id), name: String(p.name) }));
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Doppelte Spieler-Id');
  let cats = opts.more ? MORE_CATS : BASE_CATS;
  if (Array.isArray(opts.cats) && opts.cats.length >= 1 && opts.cats.length <= 8 && new Set(opts.cats).size === opts.cats.length && opts.cats.every((c) => c in CATS)) cats = opts.cats;
  cats = cats.slice();
  const rounds = Number.isInteger(opts.rounds) && opts.rounds >= 1 && opts.rounds <= LETTERS.length ? opts.rounds : ROUNDS.normal;
  let letters;
  if (Array.isArray(opts.letters) && opts.letters.length >= rounds && new Set(opts.letters).size === opts.letters.length && opts.letters.every((l) => LETTERS.includes(l))) letters = opts.letters.slice(0, rounds);
  else letters = shuffle(LETTERS, rng).slice(0, rounds);
  const scores = {};
  for (const p of players) scores[p.id] = 0;
  const s = {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    host: opts.host !== undefined ? String(opts.host) : players[0].id,
    players,
    cats,
    rounds,
    letters,
    stopOpt: !!opts.stop,
    round: 0,
    phase: 'fill', // fill | reveal | over
    letter: letters[0],
    drafts: {},
    done: {},
    stop: null, // { by: Spieler-Id }
    votes: {}, // "Kategorie|Spieler" -> [Ids derer, die "Gilt nicht" getippt haben]
    base: { ...scores }, // Punkte zu Beginn der Runde
    scores,
    reveal: null,
  };
  startRound(s);
  return s;
}

function startRound(s) {
  s.letter = s.letters[s.round];
  s.phase = 'fill';
  s.drafts = {};
  for (const p of s.players) s.drafts[p.id] = s.cats.map(() => '');
  s.done = {}; s.stop = null; s.votes = {}; s.reveal = null;
  s.base = { ...s.scores };
}

export const isOver = (s) => s.phase === 'over';
export const humans = (s) => s.players.filter((p) => !isBotId(p.id));
export const pending = (s) => (s.phase === 'fill' ? s.players.filter((p) => !s.done[p.id]) : []);
export const allFilled = (s, pid) => !!s.drafts[pid] && s.drafts[pid].length === s.cats.length && s.drafts[pid].every((t) => clean(t).length > 0);
// Stimmen, die nötig sind, um eine ungeprüfte Antwort von `authorId` zu kippen: Mehrheit der ANDEREN Menschen
export const votesNeeded = (s, authorId) => Math.floor(humans(s).filter((p) => p.id !== authorId).length / 2) + 1;
const voteKey = (cat, pid) => `${cat}|${pid}`;

// ---------- Wertung ----------
export function scoreRound(s) {
  const lc = String(s.letter).toLowerCase();
  const hs = humans(s);
  const cats = [];
  const gain = {};
  for (const p of s.players) gain[p.id] = 0;
  s.cats.forEach((catId, ci) => {
    const rows = {};
    for (const p of s.players) {
      const a = clean((s.drafts[p.id] || [])[ci]);
      const k = norm(a);
      let st = 'empty';
      if (k) st = k[0] !== lc ? 'wrong' : inDict(catId, a) ? 'known' : 'unknown';
      const row = { a, st, valid: st === 'known', half: false, rejected: false, votes: 0, need: 0, pts: 0 };
      if (st === 'unknown') {
        const others = hs.filter((h) => h.id !== p.id);
        if (!others.length) { row.valid = true; row.half = true; } else {
          const ids = new Set(((s.votes[voteKey(ci, p.id)]) || []).filter((v) => others.some((h) => h.id === v)));
          row.votes = ids.size;
          row.need = Math.floor(others.length / 2) + 1;
          row.rejected = row.votes >= row.need;
          row.valid = !row.rejected;
        }
      }
      rows[p.id] = row;
    }
    const valid = s.players.filter((p) => rows[p.id].valid);
    const count = {};
    for (const p of valid) { const k = norm(rows[p.id].a); count[k] = (count[k] || 0) + 1; }
    for (const p of valid) {
      const r = rows[p.id];
      let pts = valid.length === 1 ? PTS.only : count[norm(r.a)] > 1 ? PTS.same : PTS.own;
      if (r.half) pts = Math.floor(pts / 2);
      r.pts = pts;
      r.shared = count[norm(r.a)] > 1;
      gain[p.id] += pts;
    }
    cats.push({ id: catId, rows });
  });
  return { letter: s.letter, round: s.round, cats, gain };
}

function applyScores(s) {
  for (const p of s.players) s.scores[p.id] = s.base[p.id] + s.reveal.gain[p.id];
}

function resolve(s) {
  s.phase = 'reveal';
  s.reveal = scoreRound(s);
  applyScores(s);
}

// ---------- Nachrichten ----------
const err = (error) => ({ ok: false, error });
const isHostMsg = (s, pid) => !s.host || s.host === pid;

function setAll(s, pid, v) {
  if (!Array.isArray(v) || v.length !== s.cats.length) return false;
  s.drafts[pid] = v.map(clean);
  return true;
}

export function handle(state, pid, msg, rng = Math.random) {
  if (!state || state.game !== GAME) return err('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return err('Ungültige Nachricht.');
  if (!state.players.some((p) => p.id === pid)) return err('Du spielst nicht mit.');
  if (msg.r !== undefined && msg.r !== state.round) return err('Diese Runde ist nicht mehr aktuell.');
  if (state.phase === 'over') return err('Das Spiel ist zu Ende.');
  switch (msg.t) {
    case 'fill': {
      if (state.phase !== 'fill') return err('Die Runde ist schon vorbei.');
      if (state.done[pid]) return err('Du bist schon fertig.');
      if (!Number.isInteger(msg.cat) || msg.cat < 0 || msg.cat >= state.cats.length) return err('Dieses Feld gibt es nicht.');
      if (typeof msg.v !== 'string') return err('Ungültiger Text.');
      state.drafts[pid][msg.cat] = clean(msg.v);
      return { ok: true };
    }
    case 'done': case 'stop': {
      if (state.phase !== 'fill') return err('Die Runde ist schon vorbei.');
      if (state.done[pid]) return err('Du bist schon fertig.');
      if (msg.v !== undefined && !setAll(state, pid, msg.v)) return err('Ungültige Antworten.');
      if (msg.t === 'stop') {
        if (!state.stopOpt) return err('In diesem Spiel gibt es kein Stopp.');
        if (state.players.length < 2) return err('Stopp gibt es nur mit mehreren Personen.');
        if (state.stop) return err('Es hat schon jemand Stopp gerufen.');
        if (!allFilled(state, pid)) return err('Stopp geht erst, wenn alle Felder ausgefüllt sind.');
        state.stop = { by: pid };
      }
      state.done[pid] = true;
      if (state.players.every((p) => state.done[p.id])) resolve(state);
      return { ok: true };
    }
    case 'reopen': {
      if (state.phase !== 'fill') return err('Die Runde ist schon vorbei.');
      if (!state.done[pid]) return err('Du bist noch nicht fertig.');
      if (state.stop) return err('Nach Stopp geht das nicht mehr.');
      delete state.done[pid];
      return { ok: true };
    }
    case 'answers': {
      if (!isBotId(pid)) return err('Nur für Computer-Mitspieler.');
      if (state.phase !== 'fill') return err('Die Runde ist schon vorbei.');
      if (state.done[pid]) return err('Schon fertig.');
      if (!setAll(state, pid, msg.v)) return err('Ungültige Antworten.');
      state.done[pid] = true;
      if (state.players.every((p) => state.done[p.id])) resolve(state);
      return { ok: true };
    }
    case 'timeup': {
      if (!isHostMsg(state, pid)) return err('Nur der Gastgeber kann die Frist beenden.');
      if (state.phase !== 'fill') return err('Die Runde ist schon vorbei.');
      if (!state.stop) return err('Es läuft keine Stopp-Frist.');
      resolve(state);
      return { ok: true };
    }
    case 'skip': {
      if (!isHostMsg(state, pid)) return err('Nur der Gastgeber kann die Runde beenden.');
      if (state.phase !== 'fill') return err('Die Runde ist schon vorbei.');
      resolve(state);
      return { ok: true };
    }
    case 'vote': {
      if (state.phase !== 'reveal') return err('Abstimmen geht nur bei der Auflösung.');
      if (isBotId(pid)) return err('Computer stimmen nicht ab.');
      if (typeof msg.pid !== 'string' || !state.players.some((p) => p.id === msg.pid)) return err('Diese Person gibt es nicht.');
      if (msg.pid === pid) return err('Über die eigene Antwort stimmst du nicht ab.');
      if (!Number.isInteger(msg.cat) || msg.cat < 0 || msg.cat >= state.cats.length) return err('Diese Kategorie gibt es nicht.');
      const row = state.reveal.cats[msg.cat].rows[msg.pid];
      if (!row || row.st !== 'unknown') return err('Nur ungeprüfte Antworten können angezweifelt werden.');
      if (humans(state).filter((p) => p.id !== msg.pid).length < 1) return err('Ohne andere Menschen gibt es keine Abstimmung.');
      const key = voteKey(msg.cat, msg.pid);
      const list = state.votes[key] || [];
      state.votes[key] = list.includes(pid) ? list.filter((x) => x !== pid) : list.concat(pid);
      if (!state.votes[key].length) delete state.votes[key];
      state.reveal = scoreRound(state);
      applyScores(state);
      return { ok: true };
    }
    case 'next': {
      if (!isHostMsg(state, pid)) return err('Nur der Gastgeber kann weiterschalten.');
      if (state.phase !== 'reveal') return err('Es gibt gerade nichts zum Weiterschalten.');
      if (state.round + 1 >= state.rounds) { state.phase = 'over'; state.reveal = null; } else { state.round += 1; startRound(state); }
      return { ok: true };
    }
    default: return err('Unbekannte Nachricht.');
  }
}

// ---------- Rangliste ----------
// Sortiert nach Punkten (absteigend); gleiche Punkte teilen sich den Rang, die Reihenfolge der Anmeldung bleibt.
export function ranking(state) {
  const list = state.players.map((p) => ({ id: p.id, name: p.name, score: state.scores[p.id] }));
  list.sort((a, b) => b.score - a.score);
  return list.map((r) => ({ ...r, rank: 1 + list.filter((o) => o.score > r.score).length }));
}
export const winners = (state) => ranking(state).filter((r) => r.rank === 1);
