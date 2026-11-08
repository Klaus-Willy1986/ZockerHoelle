// Rommé – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Kartenspiel für 2–4 Personen mit 2 französischen Blättern (104 Karten) plus 6 Jokern = 110 Karten.
// Zufall nur über `rng` (Mischen, Startperson). Alle Texte deutsch, Zustand JSON-sicher.
//
// ===== API-Überblick =====
//   SUITS [{sym,name,red}] (0 ♣ Kreuz, 1 ♠ Pik, 2 ♥ Herz, 3 ♦ Karo), RANK_SYM, RANK_NAMES (Rang 1..13: Ass, 2..10, Bube, Dame, König)
//   CARDS[id] 110 Karten, id 0..109: { id, suit:0..3 | -1 (Joker), rank:1..13 | 0 (Joker) }
//   OPEN_MIN 40, HAND_SIZE 13, JOKER_PENALTY 20, CARD_COUNT 110
//   createGame(players:[{id,name}], opts={swap,double,hand}, rng) -> state (2..4 Personen, sonst RangeError)
//   newRound(state, rng) -> {ok}   Folgerunde (nur phase 'over'): neu mischen/austeilen, Punkte bleiben, Startperson rotiert
//   handle(state, pid, msg, rng) -> {ok:true} | {ok:false, error:"deutscher Text"}  (wirft nie, ändert den Zustand bei Fehlern nicht)
//        {t:'draw', from:'pile'|'discard'}  Karte nehmen (nur turn 'draw'). Stapel leer: Ablage ohne oberste Karte wird neu gemischt.
//        {t:'meld', table:[[id,...],...]}   kompletter neuer Tisch (Auslegen, Anlegen, Umlegen). Nur turn 'play', beliebig oft pro Zug.
//        {t:'discard', card:id}             Karte ablegen = Zugende (letzte Karte weg = Rundenende)
//        {t:'next'}                         nächste Runde (nur phase 'over'; Host-Prüfung macht die Oberfläche)
//   Hilfsfunktionen für die Oberfläche (ohne Nebenwirkung auf den Zustand):
//     analyzeSet(ids) -> { valid, kind:'folge'|'satz'|null, value, reason, jokerAs:[{id,suit,rank}], order:[ids], lo, hi (Folge: Positionen 1..14), suit/rank }
//     checkTurn(state,pid,table) -> { ok, error, newValue, played:[ids], table:[[ids]] (normalisiert), sets:[analyzeSet je Satz], bad:[Indizes] }
//     openValue(state, table), normalizeTable(table), tableIds(table), sortHand(ids), sumValue(ids), cardLabel(id), cardValue(id)
//     canDiscard(state,pid,card) -> '' | Begründung;  cardBalance(state) -> {hand,tisch,stapel,ablage,summe} (summe immer 110);  ranking(state)
//
// ===== Regeln =====
// Folge: mindestens 3 Karten einer Farbe in lückenloser Reihenfolge; Ass niedrig (A-2-3) oder hoch (Q-K-A), kein Umlauf K-A-2.
// Satz: 3 oder 4 Karten gleichen Werts in verschiedenen Farben. Höchstens EIN Joker pro Folge/Satz.
// Werte beim Auslegen: Ass 11 (in A-2-3 zählt es 1), Bube/Dame/König/10 je 10, Zahlen nach Augen, Joker = vertretene Karte.
// Strafpunkte der Hand: Ass 11, Bild/10 je 10, Zahlen nach Augen, Joker 20.
// Zug: 1) nehmen (Stapel oder oberste Ablagekarte)  2) optional auslegen  3) eine Karte ablegen.
// Eröffnung: Wer noch nichts ausgelegt hat, braucht in seinen neuen Sätzen (nur aus der Hand, Tisch unverändert) zusammen >= 40 Punkte.
//   Danach (auch im selben Zug mit einer zweiten Meldung) anlegen und umlegen: alle Karten, die lagen, bleiben liegen, alle Sätze gültig.
//   Joker austauschen ist so ein Umlegen (opts.swap, Standard an); ohne swap muss jeder Joker im selben Satz bleiben.
// Die gerade von der Ablage genommene Karte darf nicht gleich wieder abgelegt werden (außer sie ist die letzte Karte).
// Rundenende: Hand leer (durch Ablegen oder Auslegen). Wertung: Gewinner + Summe der Strafpunkte der anderen, andere − eigene.
//   "Rommé in einem Zug" (ohne vorherige Eröffnung alles in einem Zug los): doppelte Wertung (opts.double, Standard an).
//   Sicherung: nach PLY_CAP Zügen endet die Runde (niedrigste Strafpunkte gewinnen, Gleichstand teilt).

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANK_SYM = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];
export const RANK_NAMES = ['', 'Ass', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn', 'Bube', 'Dame', 'König'];
export const OPEN_MIN = 40;
export const HAND_SIZE = 13;
export const JOKER_PENALTY = 20;
export const CARD_COUNT = 110;
export const PLY_CAP = 400;

function buildCards() {
  const c = [];
  for (let id = 0; id < 104; id++) c.push({ id, suit: Math.floor((id % 52) / 13), rank: (id % 13) + 1 });
  for (let id = 104; id < 110; id++) c.push({ id, suit: -1, rank: 0 });
  return c;
}
export const CARDS = buildCards();
const isCard = (id) => Number.isInteger(id) && id >= 0 && id < CARD_COUNT;
export const isJoker = (id) => id >= 104;
// Wert einer Karte beim Auslegen als Zahl 1..13 (Ass hier 11 bzw. in der Folge als Position bewertet)
export const rankValue = (r) => (r === 1 ? 11 : r >= 10 ? 10 : r);
export const cardValue = (id) => (isJoker(id) ? JOKER_PENALTY : rankValue(CARDS[id].rank));
export const sumValue = (ids) => ids.reduce((s, id) => s + cardValue(id), 0);
export const cardLabel = (id) => (isCard(id) ? (isJoker(id) ? 'Joker' : `${SUITS[CARDS[id].suit].sym} ${RANK_NAMES[CARDS[id].rank]}`) : '?');
export function sortHand(ids) {
  return ids.slice().sort((a, b) => {
    const ta = CARDS[a], tb = CARDS[b];
    const sa = ta.suit < 0 ? 9 : ta.suit, sb = tb.suit < 0 ? 9 : tb.suit;
    return sa - sb || ta.rank - tb.rank || a - b;
  });
}
export function sortByRank(ids) {
  return ids.slice().sort((a, b) => {
    const ta = CARDS[a], tb = CARDS[b];
    const ra = ta.suit < 0 ? 99 : ta.rank, rb = tb.suit < 0 ? 99 : tb.rank;
    return ra - rb || ta.suit - tb.suit || a - b;
  });
}
export const activePlayer = (state) => state.players[state.active];
export const tableIds = (table) => [].concat(...table);
// Wert einer Position in der Folge (1 = Ass niedrig zählt 1, 14 = Ass hoch zählt 11, Bild/10 je 10)
const posValue = (p) => (p === 1 ? 1 : p === 14 ? 11 : p >= 10 ? 10 : p);
const posRank = (p) => (p === 14 ? 1 : p);

// ---------- Sätze analysieren ----------
const GENERIC = 'Eine Folge hat eine Farbe und lückenlose Werte, ein Satz hat gleiche Werte in verschiedenen Farben.';
const bad = (reason, ids) => ({ valid: false, kind: null, value: 0, reason, jokerAs: [], order: ids.slice(), lo: 0, hi: 0 });

// Mögliche Belegungen der echten Karten einer Folge auf Positionen start..start+n-1 (Ass 1 oder 14)
function runLayouts(reals, n, start) {
  const out = [];
  const pos = new Map();
  const rec = (i, used) => {
    if (i === reals.length) { out.push(new Map(pos)); return; }
    const id = reals[i];
    const r = CARDS[id].rank;
    const opts = r === 1 ? [1, 14] : [r];
    for (const p of opts) {
      if (p < start || p > start + n - 1 || used.has(p)) continue;
      used.add(p); pos.set(id, p);
      rec(i + 1, used);
      used.delete(p); pos.delete(id);
    }
  };
  rec(0, new Set());
  return out;
}

function asFolge(reals, jokers) {
  const suit = CARDS[reals[0]].suit;
  const n = reals.length + jokers.length;
  let best = null;
  for (let s = 1; s + n - 1 <= 14; s++) {
    for (const lay of runLayouts(reals, n, s)) {
      let value = 0;
      for (let p = s; p < s + n; p++) value += posValue(p);
      if (!best || value > best.value) best = { value, s, lay };
    }
  }
  if (!best) return null;
  const slot = new Array(n).fill(null);
  for (const [id, p] of best.lay) slot[p - best.s] = id;
  const jokerAs = [];
  let j = 0;
  for (let i = 0; i < n; i++) if (slot[i] === null) { slot[i] = jokers[j]; jokerAs.push({ id: jokers[j], suit, rank: posRank(best.s + i) }); j++; }
  return { valid: true, kind: 'folge', value: best.value, reason: '', jokerAs, order: slot, lo: best.s, hi: best.s + n - 1, suit, rank: 0 };
}

function asSatz(reals, jokers) {
  const rank = CARDS[reals[0]].rank;
  const n = reals.length + jokers.length;
  const sorted = reals.slice().sort((a, b) => CARDS[a].suit - CARDS[b].suit);
  const used = new Set(sorted.map((id) => CARDS[id].suit));
  const free = [0, 1, 2, 3].filter((c) => !used.has(c));
  const jokerAs = jokers.map((id, i) => ({ id, suit: free[i], rank }));
  return { valid: true, kind: 'satz', value: rankValue(rank) * n, reason: '', jokerAs, order: sorted.concat(jokers), lo: 0, hi: 0, suit: -1, rank };
}

export function analyzeSet(ids) {
  if (!Array.isArray(ids)) return bad('Das ist kein Satz.', []);
  const list = ids.slice();
  if (!list.every(isCard) || new Set(list).size !== list.length) return bad('Ungültige Karten im Satz.', list);
  if (list.length < 3) return bad('Mindestens 3 Karten nötig.', list);
  if (list.length > 14) return bad('Eine Folge hat höchstens 14 Karten.', list);
  const jokers = list.filter(isJoker);
  const reals = list.filter((id) => !isJoker(id));
  if (jokers.length > 1) return bad('In einem Satz darf nur ein Joker liegen.', list);
  if (!reals.length) return bad('Ein Satz braucht echte Karten, nicht nur Joker.', list);
  const suits = reals.map((id) => CARDS[id].suit);
  const ranks = reals.map((id) => CARDS[id].rank);
  const sameSuit = suits.every((c) => c === suits[0]);
  const sameRank = ranks.every((x) => x === ranks[0]);
  let reason = '';
  if (sameRank && reals.length > 1) {
    if (new Set(suits).size !== suits.length) reason = 'In einem Satz darf jede Farbe nur einmal vorkommen.';
    else if (list.length > 4) reason = 'Ein Satz hat höchstens 4 Karten.';
    else return asSatz(reals, jokers);
    return bad(reason, list);
  }
  if (sameSuit) {
    if (new Set(ranks).size !== ranks.length) return bad('In einer Folge darf kein Wert doppelt vorkommen.', list);
    const a = asFolge(reals, jokers);
    if (a) return a;
    if (ranks.includes(13) && ranks.includes(1) && ranks.includes(2)) return bad('Kein Umlauf: Nach dem König geht es nicht mit Ass und Zwei weiter.', list);
    return bad(jokers.length ? 'In der Folge fehlen Karten, die der Joker nicht allein ausfüllen kann.' : 'In der Folge fehlt eine Karte. Die Werte müssen lückenlos sein.', list);
  }
  return bad(GENERIC, list);
}

export function normalizeTable(table) {
  return table.map((s) => { const a = analyzeSet(s); return a.valid ? a.order : s.slice(); });
}

// ---------- Mischen / Austeilen ----------
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const handSizeOf = (state) => state.opts.hand;
function deal(state, rng) {
  const ids = shuffle(Array.from({ length: CARD_COUNT }, (_, i) => i), rng);
  for (const p of state.players) { p.hand = ids.splice(0, handSizeOf(state)); p.melded = false; }
  state.discard = [ids.shift()];
  state.pile = ids;
  state.table = [];
  state.phase = 'play';
  state.turn = 'draw';
  state.result = null;
  state.lastDrawn = null;
  state.lastDrawnBy = null;
  state.lastPlayed = [];
  state.lastDiscard = state.discard[0];
  state.takenFromDiscard = null;
  state.openedNow = false;
  state.plies = 0;
}

export function normalizeOpts(o) {
  const x = o && typeof o === 'object' ? o : {};
  const hand = Number.isInteger(x.hand) && x.hand >= 3 && x.hand <= 13 ? x.hand : HAND_SIZE;
  return { swap: x.swap === undefined ? true : !!x.swap, double: x.double === undefined ? true : !!x.double, hand };
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 2 || playerList.length > 4) throw new RangeError('Rommé braucht 2 bis 4 Personen.');
  const state = {
    game: 'rm', phase: 'play', turn: 'draw', round: 1, starter: 0, active: 0,
    players: playerList.map((p) => ({ id: p.id, name: p.name, hand: [], melded: false, score: 0 })),
    table: [], pile: [], discard: [], recap: [], result: null, lastDrawn: null, lastDrawnBy: null, lastPlayed: [], lastDiscard: null,
    takenFromDiscard: null, openedNow: false, plies: 0, opts: normalizeOpts(opts),
  };
  deal(state, rng);
  state.starter = Math.min(state.players.length - 1, Math.floor(rng() * state.players.length));
  state.active = state.starter;
  state.recap = [`Runde 1: ${state.players[state.starter].name} beginnt.`];
  return state;
}

export function newRound(state, rng = Math.random) {
  if (!state || state.phase !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  deal(state, rng);
  state.round += 1;
  state.starter = (state.starter + 1) % state.players.length;
  state.active = state.starter;
  state.recap = [`Runde ${state.round}: ${state.players[state.starter].name} beginnt.`];
  return { ok: true };
}

// ---------- Eröffnungswert ----------
const keyOf = (s) => s.slice().sort((a, b) => a - b).join(',');
// Wert der neuen Sätze (nicht schon so auf dem Tisch liegend); nur gültige Sätze zählen
export function openValue(state, table) {
  const left = state.table.map(keyOf);
  let sum = 0;
  for (const s of table) {
    if (!s.length) continue;
    const k = keyOf(s);
    const at = left.indexOf(k);
    if (at >= 0) { left.splice(at, 1); continue; }
    const a = analyzeSet(s);
    if (a.valid) sum += a.value;
  }
  return sum;
}

// ---------- Zug prüfen (Auslegen) ----------
export function checkTurn(state, pid, table) {
  const fail = (error, extra = {}) => ({ ok: false, error, newValue: 0, played: [], table: [], sets: [], bad: [], ...extra });
  if (!state || !Array.isArray(state.players)) return fail('Kein Spiel.');
  if (state.phase !== 'play') return fail('Diese Runde ist zu Ende.');
  const p = state.players.find((x) => x.id === pid);
  if (!p) return fail('Du spielst hier nicht mit.');
  if (activePlayer(state).id !== pid) return fail('Du bist nicht an der Reihe.');
  if (state.turn !== 'play') return fail('Nimm zuerst eine Karte vom Stapel oder von der Ablage.');
  if (!Array.isArray(table) || !table.every((s) => Array.isArray(s))) return fail('Ungültiger Tisch.');
  const sets = table.filter((s) => s.length > 0).map((s) => s.slice());
  const flat = tableIds(sets);
  if (!flat.every(isCard)) return fail('Ungültige Karten auf dem Tisch.');
  if (new Set(flat).size !== flat.length) return fail('Eine Karte liegt mehrfach auf dem Tisch.');
  const oldSet = new Set(tableIds(state.table));
  const hand = new Set(p.hand);
  const newSet = new Set(flat);
  for (const id of flat) if (!oldSet.has(id) && !hand.has(id)) return fail(`Die Karte ${cardLabel(id)} gehört dir nicht.`);
  for (const id of oldSet) if (!newSet.has(id)) return fail('Karten, die auf dem Tisch lagen, dürfen nicht zurück in die Hand. Alle müssen liegen bleiben.');
  const played = flat.filter((id) => !oldSet.has(id));
  if (!played.length) return fail('Du musst mindestens eine Karte aus deiner Hand auslegen.');
  const analyses = sets.map(analyzeSet);
  const badIdx = analyses.map((a, i) => (a.valid ? -1 : i)).filter((i) => i >= 0);
  if (badIdx.length) {
    const i = badIdx[0];
    return fail(`Satz ${i + 1} (${sets[i].map(cardLabel).join(', ')}) ist ungültig: ${analyses[i].reason}`, { table: sets, sets: analyses, bad: badIdx, played });
  }
  const norm = analyses.map((a) => a.order);
  const valOf = new Map();
  analyses.forEach((a) => {
    const jk = new Map(a.jokerAs.map((j) => [j.id, j]));
    a.order.forEach((id, i) => {
      if (jk.has(id)) valOf.set(id, a.kind === 'folge' ? posValue(a.lo + i) : rankValue(jk.get(id).rank));
      else valOf.set(id, a.kind === 'folge' ? posValue(a.lo + i) : rankValue(CARDS[id].rank));
    });
  });
  let newValue = played.reduce((s, id) => s + valOf.get(id), 0);
  if (!p.melded) {
    const oldKeys = state.table.map(keyOf);
    const pool = norm.map(keyOf);
    for (const k of oldKeys) {
      const at = pool.indexOf(k);
      if (at < 0) return fail('Vor der Eröffnung dürfen die Sätze auf dem Tisch nicht verändert werden.', { table: norm, sets: analyses, played });
      pool.splice(at, 1);
    }
    newValue = openValue(state, norm);
    if (newValue < OPEN_MIN) {
      return fail(`Zum Eröffnen brauchst du neue Sätze mit zusammen mindestens ${OPEN_MIN} Punkten (jetzt: ${newValue}).`, { table: norm, sets: analyses, played, newValue });
    }
  } else if (!state.opts.swap) {
    // ohne Joker-Tausch: jeder Joker bleibt in einem Satz, der alle seine alten Kartenpartner enthält
    for (const old of state.table) {
      for (const jid of old.filter(isJoker)) {
        const now = sets.find((s) => s.includes(jid));
        if (!now || !old.every((id) => now.includes(id))) return fail('Einen Joker auf dem Tisch darfst du nicht austauschen oder umlegen (in den Regeln ausgeschaltet).', { table: norm, sets: analyses, played });
      }
    }
  }
  return { ok: true, error: '', newValue, played, table: norm, sets: analyses, bad: [] };
}

export function canDiscard(state, pid, card) {
  if (!state || state.phase !== 'play') return 'Diese Runde ist zu Ende.';
  const p = state.players.find((x) => x.id === pid);
  if (!p) return 'Du spielst hier nicht mit.';
  if (activePlayer(state).id !== pid) return 'Du bist nicht an der Reihe.';
  if (state.turn !== 'play') return 'Nimm zuerst eine Karte vom Stapel oder von der Ablage.';
  if (!p.hand.includes(card)) return 'Diese Karte hast du nicht auf der Hand.';
  if (state.takenFromDiscard === card && p.hand.length > 1) return 'Die Karte, die du eben von der Ablage genommen hast, darfst du nicht gleich wieder ablegen.';
  return '';
}

// ---------- Zugende / Rundenende ----------
const pointsText = (n) => `${n} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
function endRound(state, winners, reason, romme = false) {
  const pen = {};
  for (const p of state.players) pen[p.id] = sumValue(p.hand);
  const losers = state.players.filter((p) => !winners.includes(p.id));
  const mult = romme && state.opts.double ? 2 : 1;
  const total = losers.reduce((s, p) => s + pen[p.id], 0) * mult;
  const share = Math.floor(total / winners.length);
  const deltas = {};
  for (const p of state.players) deltas[p.id] = winners.includes(p.id) ? share : -pen[p.id] * mult;
  for (const p of state.players) p.score += deltas[p.id];
  state.phase = 'over';
  state.result = { winners: winners.slice(), deltas, reason, double: mult === 2, pen };
  const names = winners.map((id) => state.players.find((p) => p.id === id).name).join(' und ');
  state.recap.push(reason === 'leer'
    ? `${names} ist alle Karten los: Rommé${mult === 2 ? ' in einem Zug, doppelte Wertung' : ''}! (+${share})`
    : `Die Runde dauert zu lange. ${names} hat die wenigsten Strafpunkte und gewinnt (+${share}).`);
  for (const p of state.players) if (!winners.includes(p.id)) state.recap.push(`${p.name}: ${pointsText(deltas[p.id])} (Restkarten ${pen[p.id]}).`);
}
function finishTurn(state) {
  state.plies += 1;
  if (state.plies >= PLY_CAP) {
    const sums = state.players.map((x) => sumValue(x.hand));
    const low = Math.min(...sums);
    endRound(state, state.players.filter((_, i) => sums[i] === low).map((x) => x.id), 'blockade');
    return;
  }
  state.active = (state.active + 1) % state.players.length;
  state.turn = 'draw';
  state.openedNow = false;
  state.takenFromDiscard = null;
}
function clearHint(state, pid) {
  if (state.lastDrawnBy === pid) { state.lastDrawn = null; state.lastDrawnBy = null; }
}

export function drawCard(state, pid, from, rng = Math.random) {
  if (!state || state.phase !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const p = state.players.find((x) => x.id === pid);
  if (!p) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (activePlayer(state).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (state.turn !== 'draw') return { ok: false, error: 'Du hast schon eine Karte genommen. Lege aus oder lege eine Karte ab.' };
  if (from !== 'pile' && from !== 'discard') return { ok: false, error: 'Nimm die Karte vom Stapel oder von der Ablage.' };
  state.lastPlayed = [];
  if (from === 'pile') {
    if (!state.pile.length) {
      if (state.discard.length < 2) return { ok: false, error: 'Der Stapel ist leer. Nimm die Karte von der Ablage.' };
      const top = state.discard.pop();
      state.pile = shuffle(state.discard.splice(0), rng);
      state.discard = [top];
      state.recap = ['Der Stapel war leer: Die Ablage wurde neu gemischt.'];
    } else state.recap = [];
    const id = state.pile.pop();
    p.hand.push(id);
    state.lastDrawn = id; state.lastDrawnBy = pid;
    state.takenFromDiscard = null;
    state.recap.push(`${p.name} nimmt eine Karte vom Stapel.`);
  } else {
    if (!state.discard.length) return { ok: false, error: 'Die Ablage ist leer.' };
    const id = state.discard.pop();
    p.hand.push(id);
    state.lastDrawn = id; state.lastDrawnBy = pid;
    state.takenFromDiscard = id;
    state.lastDiscard = state.discard.length ? state.discard[state.discard.length - 1] : null;
    state.recap = [`${p.name} nimmt ${cardLabel(id)} von der Ablage.`];
  }
  state.turn = 'play';
  return { ok: true };
}

export function meldTable(state, pid, table) {
  const c = checkTurn(state, pid, table);
  if (!c.ok) return { ok: false, error: c.error };
  const p = state.players.find((x) => x.id === pid);
  const gone = new Set(c.played);
  p.hand = p.hand.filter((id) => !gone.has(id));
  state.table = c.table;
  const first = !p.melded;
  if (first) state.openedNow = true;
  p.melded = true;
  state.lastPlayed = c.played.slice();
  const n = c.played.length;
  state.recap = [`${p.name} ${first ? 'eröffnet und legt' : 'legt'} ${n} ${n === 1 ? 'Karte' : 'Karten'} aus (${c.newValue} Punkte).`];
  if (!p.hand.length) endRound(state, [p.id], 'leer', state.openedNow);
  return { ok: true };
}

export function discardCard(state, pid, card) {
  const why = canDiscard(state, pid, card);
  if (why) return { ok: false, error: why };
  const p = state.players.find((x) => x.id === pid);
  p.hand = p.hand.filter((id) => id !== card);
  state.discard.push(card);
  state.lastDiscard = card;
  clearHint(state, pid);
  state.recap = (Array.isArray(state.recap) ? state.recap : []).concat([`${p.name} legt ${cardLabel(card)} ab.`]).slice(-2);
  if (!p.hand.length) endRound(state, [p.id], 'leer', state.openedNow);
  else finishTurn(state);
  return { ok: true };
}

export function ranking(state) {
  const rows = state.players.map((p, i) => ({ id: p.id, name: p.name, score: p.score, idx: i }));
  rows.sort((a, b) => b.score - a.score || a.idx - b.idx);
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1].score) place = i + 1;
    return { id: r.id, name: r.name, score: r.score, place };
  });
}

export function cardBalance(state) {
  const hand = state.players.reduce((s, p) => s + p.hand.length, 0);
  const tisch = tableIds(state.table).length;
  const stapel = state.pile.length;
  const ablage = state.discard.length;
  return { hand, tisch, stapel, ablage, summe: hand + tisch + stapel + ablage };
}
export const tileBalance = cardBalance;

export function handle(state, pid, msg, rng = Math.random) {
  try {
    if (!state || typeof state !== 'object' || !Array.isArray(state.players)) return { ok: false, error: 'Kein Spiel.' };
    if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
    switch (msg.t) {
      case 'draw': return drawCard(state, pid, msg.from, rng);
      case 'meld': return meldTable(state, pid, msg.table);
      case 'discard': return discardCard(state, pid, msg.card);
      case 'next':
        if (!state.players.some((x) => x.id === pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
        return newRound(state, rng);
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch (e) {
    return { ok: false, error: 'Das hat nicht geklappt.' };
  }
}
