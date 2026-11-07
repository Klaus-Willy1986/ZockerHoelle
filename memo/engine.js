// Paare finden (Memory) – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Der Zustand ist reines JSON. Hinweis: Er enthält technisch die Bilder ALLER Karten (cards);
// die Oberfläche zeigt aber nur aufgedeckte Karten (faceOf). Wie bei den anderen Kartenspielen akzeptiert.
//
// Ablauf eines Zuges: Wer dran ist, deckt zwei Karten auf (flip).
//  - gleiches Bild: Die Karten sind gefunden (st = 2), die Person bekommt 1 Punkt und ist noch einmal dran.
//  - sonst bleiben beide offen (pending), bis "Weiter" kommt (weiter); dann werden sie umgedreht
//    und die nächste Person ist dran.
// Karten-Status in st: 0 verdeckt, 1 aufgedeckt, 2 gefunden (weg).

export const SIZES = {
  klein: { cols: 4, rows: 3, pairs: 6, label: 'Klein' },
  mittel: { cols: 4, rows: 4, pairs: 8, label: 'Mittel' },
  gross: { cols: 5, rows: 4, pairs: 10, label: 'Groß' },
  riesig: { cols: 6, rows: 5, pairs: 15, label: 'Riesig' },
};
export const SIZE_IDS = Object.keys(SIZES);
export const DEFAULT_SIZE = 'mittel';
export const DEFAULT_THEME = 'tiere';
export const MAX_PLAYERS = 4;

const it = (id, e, n) => ({ id, e, n });
export const THEMES = {
  tiere: {
    name: 'Tiere',
    items: [it('katze', '🐱', 'Katze'), it('hund', '🐶', 'Hund'), it('maus', '🐭', 'Maus'), it('hase', '🐰', 'Hase'),
      it('fuchs', '🦊', 'Fuchs'), it('baer', '🐻', 'Bär'), it('frosch', '🐸', 'Frosch'), it('affe', '🐵', 'Affe'),
      it('pinguin', '🐧', 'Pinguin'), it('huhn', '🐔', 'Huhn'), it('loewe', '🦁', 'Löwe'), it('schwein', '🐷', 'Schwein'),
      it('kuh', '🐮', 'Kuh'), it('pferd', '🐴', 'Pferd'), it('elefant', '🐘', 'Elefant'), it('eule', '🦉', 'Eule'),
      it('schildkroete', '🐢', 'Schildkröte'), it('biene', '🐝', 'Biene')],
  },
  fruechte: {
    name: 'Obst und Gemüse',
    items: [it('apfel', '🍎', 'Apfel'), it('banane', '🍌', 'Banane'), it('trauben', '🍇', 'Trauben'), it('erdbeere', '🍓', 'Erdbeere'),
      it('kirschen', '🍒', 'Kirschen'), it('zitrone', '🍋', 'Zitrone'), it('orange', '🍊', 'Orange'), it('melone', '🍉', 'Wassermelone'),
      it('birne', '🍐', 'Birne'), it('ananas', '🍍', 'Ananas'), it('kiwi', '🥝', 'Kiwi'), it('karotte', '🥕', 'Karotte'),
      it('mais', '🌽', 'Mais'), it('brokkoli', '🥦', 'Brokkoli'), it('pilz', '🍄', 'Pilz'), it('kartoffel', '🥔', 'Kartoffel'),
      it('pfeffer', '🌶️', 'Peperoni')],
  },
  fahrzeuge: {
    name: 'Fahrzeuge',
    items: [it('auto', '🚗', 'Auto'), it('bus', '🚌', 'Bus'), it('fahrrad', '🚲', 'Fahrrad'), it('flugzeug', '✈️', 'Flugzeug'),
      it('zug', '🚂', 'Dampflok'), it('schiff', '🚢', 'Schiff'), it('traktor', '🚜', 'Traktor'), it('krankenwagen', '🚑', 'Krankenwagen'),
      it('feuerwehr', '🚒', 'Feuerwehr'), it('hubschrauber', '🚁', 'Hubschrauber'), it('roller', '🛵', 'Roller'), it('rakete', '🚀', 'Rakete'),
      it('segelboot', '⛵', 'Segelboot'), it('motorrad', '🏍️', 'Motorrad'), it('lastwagen', '🚚', 'Lastwagen'), it('kanu', '🛶', 'Kanu')],
  },
  natur: {
    name: 'Natur',
    items: [it('sonnenblume', '🌻', 'Sonnenblume'), it('rose', '🌹', 'Rose'), it('tanne', '🌲', 'Tanne'), it('palme', '🌴', 'Palme'),
      it('kaktus', '🌵', 'Kaktus'), it('pilz', '🍄', 'Pilz'), it('sonne', '☀️', 'Sonne'), it('mond', '🌙', 'Mond'),
      it('stern', '⭐', 'Stern'), it('wolke', '☁️', 'Wolke'), it('regenbogen', '🌈', 'Regenbogen'), it('schnee', '❄️', 'Schneeflocke'),
      it('feuer', '🔥', 'Feuer'), it('tropfen', '💧', 'Wassertropfen'), it('kleeblatt', '🍀', 'Kleeblatt'), it('berg', '⛰️', 'Berg'),
      it('welle', '🌊', 'Welle'), it('muschel', '🐚', 'Muschel'), it('blitz', '⚡', 'Blitz')],
  },
};
export const THEME_IDS = Object.keys(THEMES);

export const isBotId = (id) => String(id).startsWith('bot');

// Bild (Emoji + Name) einer Karten-Kennung
export function itemOf(theme, id) {
  const t = THEMES[theme] || THEMES[DEFAULT_THEME];
  return t.items.find((x) => x.id === id) || { id, e: '❓', n: String(id) };
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const size = SIZES[o.size] ? o.size : DEFAULT_SIZE;
  const theme = THEMES[o.theme] ? o.theme : DEFAULT_THEME;
  const hold = o.hold !== false;
  const { cols, rows, pairs } = SIZES[size];
  const ri = (n) => Math.min(n - 1, Math.floor(rng() * n));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pool = shuffle(THEMES[theme].items.map((x) => x.id)).slice(0, pairs);
  const cards = shuffle(pool.flatMap((id) => [id, id]));
  const players = playerList.slice(0, MAX_PLAYERS).map((p) => ({ id: p.id, name: p.name }));
  return {
    game: 'pf',
    mode: 'play', // 'play' | 'over'
    players,
    size, cols, rows, pairs, theme, hold,
    cards, // Kennungen aller Karten (nur aufgedeckte dürfen angezeigt werden)
    st: Array(cards.length).fill(0), // 0 verdeckt, 1 aufgedeckt, 2 gefunden
    open: [], // gerade aufgedeckte (noch nicht gefundene) Karten, höchstens 2
    pending: false, // zwei verschiedene Karten liegen offen und warten auf "Weiter"
    turn: 0, // Index der Person, die dran ist
    turnNo: 0, // zählt Zugwechsel
    scores: players.map(() => 0), // gefundene Paare
    triesBy: players.map(() => 0), // Versuche (je zwei aufgedeckte Karten)
    tries: 0,
    found: [], // [{ by, c, a, b }]
    reveals: [], // öffentliche Aufdeckungen in Reihenfolge: { i, c, t } (t = Zugnummer) – Grundlage für das Gedächtnis des Computers
    seed: ri(2147483647), // nur zum Berechnen des "Vergessens" des Computers
    seq: 0, // zählt jede angenommene Aktion
    evt: null, // letztes Ereignis: { seq, kind: 'flip'|'match'|'miss'|'back', cards, by, c }
  };
}

// ---------- Abfragen ----------
export const current = (g) => g.players[g.turn];
export const faceOf = (g, i) => (g.st[i] === 0 ? null : g.cards[i]); // nur Aufgedecktes verrät sein Bild
export const downCount = (g) => g.st.filter((s) => s === 0).length;
export const downIndices = (g) => g.st.map((s, i) => (s === 0 ? i : -1)).filter((i) => i >= 0);
export const playerIndex = (g, pid) => g.players.findIndex((p) => p.id === pid);

export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, pairs: g.scores[i], tries: g.triesBy[i], i }));
  const max = Math.max(...rows.map((r) => r.pairs));
  const out = rows.map((r) => ({ ...r, rank: 1 + rows.filter((q) => q.pairs > r.pairs).length, win: r.pairs === max }));
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i);
}

export function outcome(g) {
  if (g.mode !== 'over') return null;
  const rk = ranking(g);
  return { kind: g.players.length === 1 ? 'solo' : 'multi', tries: g.tries, winners: rk.filter((r) => r.win).map((r) => r.id), ranking: rk };
}

// ---------- Aktionen ----------
const bad = (error) => ({ ok: false, error });
const note = (g, kind, cards, by, c) => { g.seq += 1; g.evt = { seq: g.seq, kind, cards, by, c: c === undefined ? null : c }; };

export function flip(g, pid, i) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  if (pi !== g.turn) return bad('Du bist gerade nicht dran.');
  if (g.pending || g.open.length >= 2) return bad('Bitte zuerst auf Weiter tippen.');
  if (!Number.isInteger(i) || i < 0 || i >= g.cards.length) return bad('Diese Karte gibt es nicht.');
  if (g.st[i] !== 0) return bad('Diese Karte ist schon aufgedeckt.');
  g.st[i] = 1;
  g.open.push(i);
  g.reveals.push({ i, c: g.cards[i], t: g.turnNo });
  if (g.open.length === 1) { note(g, 'flip', [i], pi, g.cards[i]); return { ok: true }; }
  const [a, b] = g.open;
  g.tries += 1;
  g.triesBy[pi] += 1;
  if (g.cards[a] === g.cards[b]) {
    g.st[a] = 2; g.st[b] = 2;
    g.open = [];
    g.scores[pi] += 1;
    g.found.push({ by: pi, c: g.cards[a], a, b });
    note(g, 'match', [a, b], pi, g.cards[a]);
    if (g.found.length >= g.pairs) g.mode = 'over';
    return { ok: true, match: true };
  }
  g.pending = true;
  note(g, 'miss', [a, b], pi);
  return { ok: true, match: false };
}

export function weiter(g, pid) {
  if (!g || g.mode !== 'play') return bad('Das Spiel läuft nicht.');
  const pi = playerIndex(g, pid);
  if (pi < 0) return bad('Du spielst nicht mit.');
  if (!g.pending) return bad('Es gibt gerade nichts weiterzugeben.');
  // Bei "Karten bleiben aufgedeckt" bestimmt nur, wer dran ist, wann es weitergeht. Sonst darf es auch die Zeitschaltung des Gastgebers.
  if (pi !== g.turn && g.hold) return bad('Nur wer dran ist, tippt auf Weiter.');
  const cards = g.open.slice();
  for (const k of cards) g.st[k] = 0;
  g.open = [];
  g.pending = false;
  g.turn = (g.turn + 1) % g.players.length;
  g.turnNo += 1;
  note(g, 'back', cards, g.turn);
  return { ok: true };
}

export function handle(g, pid, msg, rng) { // eslint-disable-line no-unused-vars
  if (!msg || typeof msg !== 'object') return bad('Ungültige Nachricht.');
  if (msg.t === 'flip') return flip(g, pid, msg.i);
  if (msg.t === 'weiter') return weiter(g, pid);
  return bad('Unbekannte Nachricht.');
}
