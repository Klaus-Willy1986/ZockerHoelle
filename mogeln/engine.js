// Mogeln – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind. Alle Zustände sind reines JSON.
// Karten sind Nummern 0..51: id = Farbe * 13 + Rang (Farbe 0..3 = ♣ ♠ ♥ ♦, Rang 0..12 = A 2 3 4 5 6 7 8 9 10 B D K).
// Hinweis: Hände, der Stapel (`pile`) und die zuletzt gelegten Karten (`lastPlay.ids`) stehen technisch im Zustand
// (wie bei den anderen Kartenspielen); die Oberfläche zeigt nur die eigene Hand und nach dem Aufdecken die aufgedeckten Karten.
//
// Ablauf: Phase 'play' (aktive Person legt 1 bis 4 Karten verdeckt und sagt an: "alles <Rang>"; der Rang ist vorgegeben
//   und läuft reihum aufsteigend A, 2, ..., K, A, ...) -> 'decide' (die NÄCHSTE Person glaubt -> sie ist selbst dran;
//   oder ruft "Mogler!" -> 'reveal') -> 'reveal' (die zuletzt gelegten Karten sind aufgedeckt; `next` geht weiter)
//   oder 'over' (eine Person ist ihre Karten los und hat den Zweifel überstanden).
// Mogler: Stimmte mindestens eine Karte nicht, nimmt die legende Person den ganzen Stapel; sonst die zweifelnde Person.
//   Danach beginnt die Person nach der zweifelnden Person, der Stapel ist leer, der Rang geht weiter.
// Wer nach seiner Ablage keine Karten mehr hat, gewinnt, sobald die nächste Person glaubt oder zu Unrecht zweifelt.
// Spielstand über Runden: Siegpunkt je gewonnener Runde.

export const GAME = 'mg';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_PLAY = 4;
export const DECK_SIZE = 52;
export const MOVE_CAP = 600; // Sicherung: spätestens dann endet die Runde (wenigste Karten gewinnen)
const RECAP_MAX = 6;

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
// sym = Anzeige auf der Karte, name = einzelne Karte, plural = "Alle: <plural>"
export const RANKS = [
  { sym: 'A', name: 'Ass', plural: 'Asse' },
  { sym: '2', name: 'Zwei', plural: 'Zweier' },
  { sym: '3', name: 'Drei', plural: 'Dreier' },
  { sym: '4', name: 'Vier', plural: 'Vierer' },
  { sym: '5', name: 'Fünf', plural: 'Fünfer' },
  { sym: '6', name: 'Sechs', plural: 'Sechser' },
  { sym: '7', name: 'Sieben', plural: 'Siebener' },
  { sym: '8', name: 'Acht', plural: 'Achter' },
  { sym: '9', name: 'Neun', plural: 'Neuner' },
  { sym: '10', name: 'Zehn', plural: 'Zehner' },
  { sym: 'B', name: 'Bube', plural: 'Buben' },
  { sym: 'D', name: 'Dame', plural: 'Damen' },
  { sym: 'K', name: 'König', plural: 'Könige' },
];

export const isCardId = (c) => Number.isInteger(c) && c >= 0 && c < DECK_SIZE;
export const suitOf = (c) => Math.floor(c / 13);
export const rankOf = (c) => c % 13;
export const makeCard = (s, r) => s * 13 + r;
export const cardName = (c) => `${SUITS[suitOf(c)].sym} ${RANKS[rankOf(c)].name}`;
export const rankPlural = (r) => RANKS[((r % 13) + 13) % 13].plural;
export const kartenZahl = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);
export const sortHand = (hand) => hand.sort((a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b));

export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function pushRecap(g, line) {
  g.recap.unshift(line); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

// Alle Karten gleichmäßig verteilt, der Rest geht an die ersten Personen (Platz 0, 1, ...)
function deal(g, rng) {
  const deck = shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i), rng);
  for (const p of g.players) p.hand = [];
  deck.forEach((c, i) => g.players[i % g.players.length].hand.push(c));
  for (const p of g.players) sortHand(p.hand);
  g.pile = [];
  g.lastPlay = null;
  g.rank = 0; // Zug 1: Asse
  g.active = g.starter;
  g.announcer = null;
  g.phase = 'play';
  g.moves = 0;
  g.result = null;
  g.recap = [];
  g.last = null;
}

export function createGame(players, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error('Mogeln braucht 2 bis 6 Personen.');
  const g = {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    hostId: hostId === null || hostId === undefined ? String(players[0].id) : String(hostId),
    opts: {},
    players: players.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], wins: 0 })),
    round: 1,
    starter: 0,
    rank: 0, pile: [], lastPlay: null, active: 0, announcer: null, moves: 0,
    phase: 'play', result: null, recap: [], last: null,
  };
  deal(g, rng);
  return g;
}

// Der Rang, den die nächste Ablage ansagen muss (Phase 'play'), bzw. der zuletzt angesagte Rang (decide/reveal)
export const shownRank = (g) => (g.phase === 'play' || !g.lastPlay ? g.rank : g.lastPlay.rank);
export const totalCards = (g) => g.players.reduce((s, p) => s + p.hand.length, 0) + g.pile.length;

export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  g.round += 1;
  g.starter = (g.starter + 1) % g.players.length;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

function finish(g, winnerIdx, why) {
  const w = g.players[winnerIdx];
  w.wins += 1;
  g.phase = 'over';
  g.active = winnerIdx;
  g.result = { winner: w.id, winnerName: w.name, capped: why === 'cap' };
  const t = why === 'cap'
    ? `Die Runde war sehr lang. ${w.name} hat die wenigsten Karten und gewinnt.`
    : `${w.name} ist alle Karten los und gewinnt die Runde!`;
  pushRecap(g, t);
  g.last = { kind: 'over', pid: w.id, name: w.name, text: t };
}

// Notbremse (Sicherung gegen Endlosrunden): die Person mit den wenigsten Karten gewinnt (bei Gleichstand die erste ab der aktiven)
function capEnd(g) {
  let best = -1;
  let bestN = Infinity;
  for (let k = 0; k < g.players.length; k++) {
    const i = (g.active + k) % g.players.length;
    if (g.players[i].hand.length < bestN) { best = i; bestN = g.players[i].hand.length; }
  }
  finish(g, best, 'cap');
}

const ok = (extra) => Object.assign({ ok: true }, extra || {});
const fail = (error) => ({ ok: false, error });

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== GAME || !Array.isArray(g.players)) return fail('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('Ungültige Nachricht.');
  const idx = idxOf(g, pid);
  if (idx < 0) return fail('Du spielst nicht mit.');
  const me = g.players[idx];
  const mine = idx === g.active;

  switch (msg.t) {
    case 'play': {
      if (g.phase !== 'play') return fail('Jetzt wird nichts gelegt.');
      if (!mine) return fail('Du bist nicht an der Reihe.');
      const ids = msg.cards;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PLAY) return fail('Du musst 1 bis 4 Karten legen.');
      if (!ids.every(isCardId) || new Set(ids).size !== ids.length) return fail('Ungültige Karten.');
      if (!ids.every((c) => me.hand.includes(c))) return fail('Diese Karten hast du nicht.');
      me.hand = me.hand.filter((c) => !ids.includes(c));
      const played = ids.slice();
      for (const c of played) g.pile.push(c);
      const rank = g.rank;
      g.lastPlay = { pid: me.id, name: me.name, count: played.length, rank, ids: played };
      g.announcer = idx;
      g.rank = (rank + 1) % 13;
      g.active = (idx + 1) % g.players.length;
      g.phase = 'decide';
      g.moves += 1;
      const text = `${me.name} hat ${kartenZahl(played.length)} gelegt: ${rankPlural(rank)}`;
      g.last = { kind: 'play', pid: me.id, name: me.name, count: played.length, rank, text };
      pushRecap(g, text);
      if (g.moves >= MOVE_CAP) capEnd(g);
      return ok();
    }

    case 'believe': {
      if (g.phase !== 'decide') return fail('Jetzt wird nicht geglaubt.');
      if (!mine) return fail('Du bist nicht an der Reihe.');
      const ann = g.players[g.announcer];
      g.moves += 1;
      const text = `${me.name} glaubt ${ann.name}.`;
      g.last = { kind: 'believe', pid: me.id, name: me.name, text };
      pushRecap(g, text);
      if (!ann.hand.length) { finish(g, g.announcer, 'empty'); return ok({ won: ann.id }); }
      g.phase = 'play';
      if (g.moves >= MOVE_CAP) capEnd(g);
      return ok();
    }

    case 'call': {
      if (g.phase !== 'decide') return fail('Jetzt wird nicht gezweifelt.');
      if (!mine) return fail('Du bist nicht an der Reihe.');
      const lp = g.lastPlay;
      const ann = g.players[g.announcer];
      const liar = lp.ids.some((c) => rankOf(c) !== lp.rank);
      const taker = liar ? ann : me;
      const taken = g.pile.length;
      for (const c of g.pile) taker.hand.push(c);
      g.pile = [];
      sortHand(taker.hand);
      const l = {
        kind: 'reveal', announcerId: ann.id, announcerName: ann.name, doubterId: me.id, doubterName: me.name,
        rank: lp.rank, ids: lp.ids.slice(), liar, takerId: taker.id, takerName: taker.name, taken,
      };
      l.text = liar
        ? `${ann.name} hat gemogelt und nimmt den Stapel (${kartenZahl(taken)}).`
        : `${ann.name} hat die Wahrheit gesagt. ${me.name} hat zu Unrecht gezweifelt und nimmt den Stapel (${kartenZahl(taken)}).`;
      g.last = l;
      pushRecap(g, l.text);
      g.moves += 1;
      if (!liar && !ann.hand.length) { finish(g, g.announcer, 'empty'); g.last = l; return ok({ liar, taker: taker.id, won: ann.id }); }
      g.phase = 'reveal';
      g.active = (idx + 1) % g.players.length; // nach dem Aufdecken beginnt die Person nach der zweifelnden Person
      if (g.moves >= MOVE_CAP) capEnd(g);
      return ok({ liar, taker: taker.id });
    }

    case 'next': {
      if (g.phase === 'reveal') {
        g.phase = 'play';
        g.moves += 1;
        if (g.moves >= MOVE_CAP) capEnd(g);
        return ok();
      }
      if (g.phase === 'over') {
        if (pid !== g.hostId) return fail('Nur der Gastgeber kann die nächste Runde starten.');
        return nextRound(g, rng);
      }
      return fail('Es gibt gerade nichts weiterzuklicken.');
    }

    default:
      return fail('Unbekannte Nachricht.');
  }
}

// Spielstand-Tabelle über alle Runden: mehr Siege zuerst
export function standings(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, wins: p.wins, idx: i, cards: p.hand.length }));
  rows.sort((a, b) => b.wins - a.wins || a.idx - b.idx);
  return rows;
}
// Rangliste der Runde: Sieger/in zuerst, dann nach Kartenzahl (weniger ist besser)
export function ranking(g) {
  const w = g.result ? g.result.winner : null;
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, cards: p.hand.length, wins: p.wins, idx: i }));
  rows.sort((a, b) => (b.id === w) - (a.id === w) || a.cards - b.cards || a.idx - b.idx);
  let place = 0;
  let lastCards = -1;
  return rows.map((r, i) => {
    if (r.id === w) { place = 1; lastCards = -2; } else if (r.cards !== lastCards) { place = i + 1; lastCards = r.cards; }
    return { place, id: r.id, name: r.name, cards: r.cards, wins: r.wins };
  });
}
