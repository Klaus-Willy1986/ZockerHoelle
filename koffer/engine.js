// Ich packe meinen Koffer – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Der Zustand ist reines JSON. Hinweis: Er enthält technisch die ganze Liste (list) und geht so auch an Gäste;
// die Oberfläche zeigt sie aber nie (nur mit der Option "Liste bleibt sichtbar" für die Person, die dran ist,
// und nach einem Fehler als Auflösung für alle).
//
// Ablauf eines Zuges (phase 'play'): Wer dran ist, wiederholt ALLE bisher eingepackten Dinge in der richtigen
// Reihenfolge (seq) und packt EIN neues Ding aus den 8 angebotenen (add) dazu. Nachricht: { t:'submit', seq:[ids], add:id }.
//  - Folge stimmt (Länge und Reihenfolge): Das neue Ding wird angehängt (phase 'result', last.ok = true).
//  - Jede Abweichung: Die Person verliert einen Fehlerpunkt (normal 1 Leben, mit Option lives2 zwei). Ohne Leben ist sie
//    raus. Die Liste bleibt unverändert und wird allen als Auflösung gezeigt (last.expected).
// Danach bestätigt die Person mit { t:'weiter' } (phase 'result' -> nächste Person, phase 'play').
// Allein spielen (solo): Wer sich vertut, ist fertig; Bestleistung = Länge der Liste (result.length).
// Ende: Es ist nur noch eine Person drin (sie gewinnt), allein nach dem ersten Fehler, oder die Liste ist voll (MAX_LIST).
import { DINGE, DINGE_BY_ID } from './dinge.js';

export const GAME = 'kf';
export const MAX_PLAYERS = 8;
export const MAX_LIST = 50; // so viele Dinge passen höchstens in den Koffer
export const OFFER_N = 8; // so viele neue Karten stehen zur Auswahl
export const GRID_MIN = 24;
export const GRID_MAX = 30;
export const ALL_IDS = DINGE.map((x) => x.id);

export const isBotId = (id) => String(id).startsWith('bot');
export const itemOf = (id) => DINGE_BY_ID[id] || { id, e: '❓', n: String(id) };

const shuffleWith = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rng() * (i + 1))); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Größe des Rasters bei n benutzten Dingen: 24, wächst auf 28 und 30; ist die Liste länger als 28, passt sie mit 2 Ablenkern hinein.
export function gridSizeFor(n) {
  const base = n < 12 ? GRID_MIN : n < 20 ? 28 : GRID_MAX;
  return Math.max(base, Math.min(ALL_IDS.length, n + 2));
}

// Raster: alle benutzten Dinge + zufällige Ablenker, gemischt (keine Doppelten).
export function makeGrid(list, rng = Math.random) {
  const used = [...new Set(list)];
  const size = gridSizeFor(used.length);
  const rest = shuffleWith(ALL_IDS.filter((id) => !used.includes(id)), rng).slice(0, Math.max(0, size - used.length));
  return shuffleWith([...used, ...rest], rng);
}

// Auswahl neuer Dinge: noch nicht in der Liste, möglichst auch nicht als Ablenker im Raster.
export function makeOffer(list, grid, rng = Math.random) {
  const fresh = ALL_IDS.filter((id) => !list.includes(id));
  const apart = fresh.filter((id) => !grid.includes(id));
  const pool = apart.length >= OFFER_N ? apart : fresh;
  return shuffleWith(pool, rng).slice(0, OFFER_N);
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const list = Array.isArray(playerList) ? playerList.slice(0, MAX_PLAYERS) : [];
  const solo = list.length === 1;
  const options = { lives2: !!o.lives2 && !solo, show: !!o.show };
  const g = {
    game: GAME,
    mode: 'play', // 'play' | 'over'
    phase: 'play', // 'play' (Person gibt Folge ein) | 'result' (Ergebnis wird angezeigt, wartet auf "Weiter")
    solo,
    opts: options,
    players: list.map((p) => ({ id: p.id, name: p.name, lives: options.lives2 ? 2 : 1, out: false, outNo: 0, ok: 0 })),
    list: [], // der Koffer: Kennungen in der Reihenfolge des Einpackens
    grid: [], // Raster dieses Zuges (alle benutzten Dinge + Ablenker, gemischt)
    offer: [], // die neuen Karten dieses Zuges
    turn: 0,
    turnNo: 0,
    seq: 0, // zählt jede angenommene Aktion
    gid: Math.floor(rng() * 2147483647), // Kennung dieser Partie
    cap: Number.isInteger(o.cap) && o.cap >= 2 && o.cap <= MAX_LIST ? o.cap : MAX_LIST, // Lernrunde: kürzerer Koffer
    outCount: 0,
    last: null, // Ergebnis des letzten Zuges
    result: null, // Endergebnis
  };
  deal(g, rng);
  return g;
}

function deal(g, rng) {
  g.grid = g.list.length ? makeGrid(g.list, rng) : [];
  g.offer = makeOffer(g.list, g.grid, rng);
}

// ---------- Abfragen ----------
export const current = (g) => g.players[g.turn];
export const playerIndex = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const activePlayers = (g) => g.players.filter((p) => !p.out);

// Der Koffer, wie ihn nur der Computer-Mitspieler "kennt" (seine Gedächtnis-Simulation, siehe ai.js).
export function botList(g, botId) {
  const cur = g && g.players && g.players[g.turn];
  return cur && cur.id === botId && isBotId(botId) && Array.isArray(g.list) ? g.list.slice() : [];
}

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, i, out: p.out, lives: p.lives, ok: p.ok, outNo: p.outNo }));
  // Wer am längsten dabei war, steht vorn: Wer drin ist, vor allen, dann später Ausgeschiedene vor früheren.
  const key = (r) => (r.out ? r.outNo : Infinity);
  const out = rows.map((r) => ({ ...r, rank: 1 + rows.filter((q) => key(q) > key(r)).length, win: !r.out && g.mode === 'over' }));
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i);
}

export function outcome(g) {
  if (g.mode !== 'over') return null;
  const rk = ranking(g);
  return { solo: g.solo, length: g.list.length, full: !!(g.result && g.result.full), winners: g.solo ? [] : rk.filter((r) => r.win).map((r) => r.id), ranking: rk };
}

// ---------- Aktionen ----------
const bad = (error) => ({ ok: false, error });
const isId = (x) => typeof x === 'string' && x.length > 0 && x.length < 40;

export function submit(g, pid, msg, rng = Math.random) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  if (g.phase !== 'play') return bad('Bitte zuerst auf Weiter tippen.');
  if (pi !== g.turn) return bad('Du bist gerade nicht dran.');
  const seq = msg.seq;
  if (!Array.isArray(seq) || seq.length > MAX_LIST + 2 || !seq.every(isId)) return bad('Ungültige Folge.');
  const add = msg.add === undefined || msg.add === null ? null : msg.add;
  if (add !== null && (!isId(add) || !g.offer.includes(add))) return bad('Dieses neue Ding steht nicht zur Auswahl.');
  const list = g.list;
  const same = seq.length === list.length && seq.every((id, i) => id === list[i]);
  const p = g.players[pi];
  g.seq += 1;
  if (same) {
    if (add === null) { g.seq -= 1; return bad('Bitte wähle ein neues Ding zum Einpacken.'); }
    g.list = list.concat(add);
    p.ok += 1;
    g.last = { no: g.turnNo, by: pi, ok: true, added: add, n: g.list.length, seq: seq.slice(), expected: null, firstBad: -1, lost: false, out: false, livesLeft: p.lives };
    if (g.list.length >= g.cap) {
      g.mode = 'over';
      g.result = { full: true, length: g.list.length };
      return { ok: true, correct: true, over: true };
    }
    g.phase = 'result';
    return { ok: true, correct: true };
  }
  let firstBad = 0;
  while (firstBad < seq.length && firstBad < list.length && seq[firstBad] === list[firstBad]) firstBad += 1;
  p.lives -= 1;
  const out = g.solo || p.lives <= 0;
  if (out) { p.out = true; g.outCount += 1; p.outNo = g.outCount; p.lives = Math.max(0, p.lives); }
  g.last = { no: g.turnNo, by: pi, ok: false, added: null, n: list.length, seq: seq.slice(), expected: list.slice(), firstBad, lost: true, out, livesLeft: p.lives };
  if (g.solo || activePlayers(g).length <= 1) {
    g.mode = 'over';
    g.result = { full: false, length: list.length };
    return { ok: true, correct: false, out, over: true };
  }
  g.phase = 'result';
  return { ok: true, correct: false, out };
}

export function weiter(g, pid, msg, rng = Math.random) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  if (g.phase !== 'result' || !g.last) return bad('Es gibt gerade nichts weiterzugeben.');
  const actor = g.players[g.last.by];
  const skip = !!(msg && msg.skip === true);
  if (pi !== g.last.by && !isBotId(actor.id) && !skip) return bad('Nur wer gerade dran war, tippt auf Weiter.');
  let t = g.last.by;
  for (let k = 0; k < g.players.length; k++) {
    t = (t + 1) % g.players.length;
    if (!g.players[t].out) break;
  }
  g.turn = t;
  g.turnNo += 1;
  g.phase = 'play';
  g.seq += 1;
  deal(g, rng);
  return { ok: true };
}

export function handle(g, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return bad('Ungültige Nachricht.');
  if (msg.t === 'submit') return submit(g, pid, msg, rng);
  if (msg.t === 'weiter') return weiter(g, pid, msg, rng);
  return bad('Unbekannte Nachricht.');
}
