// Galgenmännchen – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein. Der Spielstand besteht nur aus Zahlen, Texten, Wahrheitswerten,
// Listen und Objekten (JSON-sicher).
//
// Ablauf: Ein Wort aus der Wortliste wird als Striche gezeigt (die Kategorie ist bekannt). Reihum rät jede Person
// einen Buchstaben oder das ganze Wort.
//  - Buchstabe kommt vor: erscheint an allen Stellen (1 Punkt je Fundstelle), die Person ist noch einmal dran.
//  - Buchstabe kommt nicht vor: ein Fehler (gemeinsamer Zähler der Gruppe), die nächste Person ist dran.
//  - Wort richtig (Wort-Rate oder letzter Buchstabe): 3 Bonuspunkte + 1 je noch verdecktem Buchstaben, Runde endet.
//  - Wort falsch geraten: ein Fehler, der Zug endet.
//  - Bei `maxErr` Fehlern ist das Wort verloren (kein Bonus, das Wort wird aufgedeckt).
// Allein (eine Person, kein Computer): Serie – es geht Wort für Wort weiter, bis ein Wort verloren ist.
//
// Nachrichten (msg.r = Rundennummer, optional, schützt vor verspäteten Nachrichten):
//   { t:'letter', l:'E' }   Buchstabe raten (A–Z, Ä, Ö, Ü)
//   { t:'word', w:'HAUS' }  ganzes Wort raten
//   { t:'next' }            Gastgeber: nächstes Wort / Endergebnis
//   { t:'skip' }            Gastgeber: der Zug geht ohne Fehler an die nächste Person (z. B. bei Verbindungsabbruch)
//
// Achtung: Das gesuchte Wort (state.word) steht technisch im Zustand, den der Gastgeber an alle Geräte schickt;
// die Oberfläche zeigt es erst am Ende der Runde. Öffentlich ist state.mask (aufgedeckte Buchstaben).
import { WOERTER, KATEGORIEN } from './woerter.js';

export const GAME = 'gg';
export const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split('');
export const MAX_PLAYERS = 6;
export const ROUNDS = { normal: 5, kurz: 3 };
export const MAX_ERR = { normal: 8, easy: 10 };
export const BONUS_BASE = 3;
export const MAX_WORD_INPUT = 30;

export const isBotId = (id) => String(id).startsWith('bot');
const pickIdx = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

// "ß" steht nicht auf der Tastatur und liegt von Anfang an offen; alle anderen Buchstaben müssen geraten werden.
const isKey = (c) => KEYS.includes(c);
// Vergleichsform für Wort-Rate: Großbuchstaben, ß = SS, nur Buchstaben
export function normWord(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFC').toUpperCase().replace(/ß/g, 'SS').replace(/ẞ/g, 'SS').replace(/[^A-ZÄÖÜ]/g, '');
}

export function maxErrors(opts = {}) {
  if (opts.easy) return MAX_ERR.easy;
  if (Number.isInteger(opts.errors) && opts.errors >= 3 && opts.errors <= 15) return opts.errors;
  return MAX_ERR.normal;
}

// ---------- Spielstand ----------
// opts: { errors?:8, easy?:true (10 Fehler), rounds?:1..50 (Standard 5), words?:[{w,k}] (feste Wörter, z. B. Lernrunde),
//         host?:Spielleiter-Id }
export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 1 || playerList.length > MAX_PLAYERS) throw new Error('1 bis 6 Personen');
  const players = playerList.map((p) => ({ id: String(p.id), name: String(p.name) }));
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Doppelte Spieler-Id');
  const fixed = Array.isArray(opts.words) && opts.words.length >= 1
    && opts.words.every((x) => x && typeof x.w === 'string' && /^[A-ZÄÖÜß]{2,20}$/.test(x.w) && typeof x.k === 'string')
    ? opts.words.map((x) => ({ w: x.w, k: x.k })) : null;
  const solo = players.length === 1;
  let rounds = Number.isInteger(opts.rounds) && opts.rounds >= 1 && opts.rounds <= 50 ? opts.rounds : ROUNDS.normal;
  if (fixed) rounds = fixed.length;
  const scores = {};
  for (const p of players) scores[p.id] = 0;
  const s = {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    host: opts.host !== undefined ? String(opts.host) : players[0].id,
    players,
    solo,
    maxErr: maxErrors(opts),
    rounds: solo && !fixed ? 0 : rounds, // 0 = Serie ohne feste Rundenzahl (allein)
    fixed,
    used: [], // schon gespielte Wörter (Nummern in WOERTER)
    round: 0,
    phase: 'play', // play | reveal | over
    turn: 0,
    word: '',
    cat: '',
    mask: [], // öffentlich: aufgedeckte Buchstaben (null = noch verdeckt)
    guessed: [], // schon geratene Buchstaben (öffentlich)
    badWords: [], // falsch geratene Wörter (öffentlich)
    errs: 0,
    solved: null, // null | true | false (am Ende der Runde)
    solvedBy: null,
    gain: {}, // Punkte dieser Runde je Person
    scores,
    wins: 0, // gelöste Wörter
    seq: 0,
    last: null, // letztes Ereignis: { seq, kind: 'letter'|'miss'|'badword'|'solved'|'lost', by, l, n, w, bonus }
  };
  startRound(s, rng);
  return s;
}

function startRound(s, rng) {
  let w; let k;
  if (s.fixed) { ({ w, k } = s.fixed[s.round]); } else {
    const free = [];
    for (let i = 0; i < WOERTER.length; i++) if (!s.used.includes(i)) free.push(i);
    const i = free.length ? free[pickIdx(rng, free.length)] : 0;
    s.used.push(i);
    ({ w, k } = WOERTER[i]);
  }
  s.word = w; s.cat = k;
  s.mask = w.split('').map((c) => (isKey(c) ? null : c));
  s.guessed = []; s.badWords = [];
  s.errs = 0; s.solved = null; s.solvedBy = null;
  s.gain = {};
  for (const p of s.players) s.gain[p.id] = 0;
  s.phase = 'play';
  s.turn = s.round % s.players.length;
  s.last = null;
}

export const isOver = (s) => s.phase === 'over';
export const current = (s) => s.players[s.turn];
export const hiddenCount = (s) => s.mask.filter((c) => c === null).length;
export const errorsLeft = (s) => s.maxErr - s.errs;
export const lettersOf = (s) => s.word.split('');
export const categoryName = (s) => KATEGORIEN[s.cat] || '';

function endRound(s, solved, by) {
  s.solved = solved;
  s.solvedBy = by;
  s.phase = 'reveal';
  s.mask = s.word.split('');
  if (solved) s.wins += 1;
}

// ---------- Nachrichten ----------
const err = (error) => ({ ok: false, error });
const note = (s, ev) => { s.seq += 1; s.last = { seq: s.seq, ...ev }; };

function addErr(s, pid) {
  s.errs += 1;
  if (s.errs >= s.maxErr) { endRound(s, false, null); return true; }
  s.turn = (s.turn + 1) % s.players.length;
  return false;
}

export function handle(state, pid, msg, rng = Math.random) {
  if (!state || state.game !== GAME) return err('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return err('Ungültige Nachricht.');
  if (!state.players.some((p) => p.id === pid)) return err('Du spielst nicht mit.');
  if (msg.r !== undefined && msg.r !== state.round) return err('Diese Runde ist nicht mehr aktuell.');
  if (state.phase === 'over') return err('Das Spiel ist zu Ende.');
  switch (msg.t) {
    case 'letter': {
      if (state.phase !== 'play') return err('Das Wort ist schon aufgelöst.');
      if (current(state).id !== pid) return err('Du bist gerade nicht dran.');
      const l = typeof msg.l === 'string' ? msg.l.normalize('NFC').toUpperCase() : '';
      if (l.length !== 1 || !isKey(l)) return err('Das ist kein Buchstabe.');
      if (state.guessed.includes(l)) return err('Diesen Buchstaben gab es schon.');
      state.guessed.push(l);
      let n = 0;
      state.word.split('').forEach((c, i) => { if (c === l) { state.mask[i] = l; n += 1; } });
      if (n > 0) {
        state.scores[pid] += n; state.gain[pid] += n;
        if (hiddenCount(state) === 0) {
          state.scores[pid] += BONUS_BASE; state.gain[pid] += BONUS_BASE;
          note(state, { kind: 'solved', by: pid, l, n, bonus: BONUS_BASE, via: 'letter' });
          endRound(state, true, pid);
        } else note(state, { kind: 'letter', by: pid, l, n });
      } else {
        const lost = addErr(state, pid);
        note(state, { kind: lost ? 'lost' : 'miss', by: pid, l, n: 0 });
      }
      return { ok: true };
    }
    case 'word': {
      if (state.phase !== 'play') return err('Das Wort ist schon aufgelöst.');
      if (current(state).id !== pid) return err('Du bist gerade nicht dran.');
      if (typeof msg.w !== 'string' || msg.w.length > MAX_WORD_INPUT) return err('Ungültiges Wort.');
      const w = normWord(msg.w);
      if (w.length < 1) return err('Bitte schreibe ein Wort.');
      if (w === normWord(state.word)) {
        const bonus = BONUS_BASE + hiddenCount(state);
        state.scores[pid] += bonus; state.gain[pid] += bonus;
        note(state, { kind: 'solved', by: pid, w: state.word, bonus, via: 'word' });
        endRound(state, true, pid);
      } else {
        if (!state.badWords.includes(w)) state.badWords.push(w);
        const lost = addErr(state, pid);
        note(state, { kind: lost ? 'lost' : 'badword', by: pid, w, via: 'word' });
      }
      return { ok: true };
    }
    case 'skip': {
      if (!state.host || state.host !== pid) return err('Nur der Gastgeber kann einen Zug überspringen.');
      if (state.phase !== 'play') return err('Gerade gibt es keinen Zug.');
      state.turn = (state.turn + 1) % state.players.length;
      return { ok: true };
    }
    case 'next': {
      if (!state.host || state.host !== pid) return err('Nur der Gastgeber kann weiterschalten.');
      if (state.phase !== 'reveal') return err('Es gibt gerade nichts zum Weiterschalten.');
      let finished;
      if (state.solo && !state.fixed) finished = !state.solved || state.used.length >= WOERTER.length;
      else finished = state.round + 1 >= state.rounds;
      if (finished) { state.phase = 'over'; state.last = null; } else { state.round += 1; startRound(state, rng); }
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
