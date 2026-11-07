// Reihen & Gruppen – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Legespiel mit Zahlensteinen für 2–4 Personen: Steine zu Reihen und Gruppen ordnen, die Hand zuerst leer legen.
// Zufall nur über `rng` (Mischen, Startperson). Alle Texte deutsch, Zustand JSON-sicher.
//
// ===== API-Überblick =====
//   COLORS ['rot','blau','gelb','gruen'] (Farbindex 0..3), COLOR_NAMES ['Rot','Blau','Gelb','Grün'], JOKER_VALUE 30, OPEN_MIN 30, HAND_SIZE 14
//   TILES[id]  106 Steine, id 0..105: { id, color:0..3 | -1 (Joker), num:1..13 | 0 (Joker) }
//   createGame(players:[{id,name}], opts={}, rng) -> state (2..4 Personen, sonst RangeError)
//   newRound(state, rng) -> {ok}   Folgerunde (nur wenn phase 'over'): neu mischen/austeilen, Punkte bleiben, Startperson rotiert
//   handle(state, pid, msg, rng) -> {ok:true} | {ok:false, error:"deutscher Text"}  (wirft nie, ändert den Zustand bei Fehlern nicht)
//        {t:'play', table:[[id,...],...]}   kompletter neuer Tisch als Liste von Sätzen (Reihenfolge innerhalb eines Satzes egal; die Engine
//                                          sortiert beim Speichern: Reihen aufsteigend, Gruppen nach Farbe, Joker an ihrem Platz). Leere Sätze
//                                          werden ignoriert. Hand neu = Hand alt minus (Tischsteine neu minus Tischsteine alt).
//        {t:'draw'}                         Stein ziehen, Zug endet (Stapel leer: Passen)
//        {t:'next'}                         nächste Runde (nur in phase 'over', jede mitspielende Person; Host-Prüfung macht die Oberfläche/das Netz)
//   Spielende gibt es nicht in der Engine: die Oberfläche beendet das Spiel ("Spiel beenden"), ranking(state) liefert den Gesamtstand.
//   Einzelfunktionen: playTable(state,pid,table), draw(state,pid)
//   Hilfsfunktionen für die Oberfläche (alle ohne Nebenwirkung auf den Zustand):
//     analyzeSet(ids) -> { valid, kind:'reihe'|'gruppe'|null, value, reason:''|"Text", jokerAs:[{id,color,num}], order:[ids] }
//         ids in beliebiger Reihenfolge. value = Summe der Zahlenwerte (Joker mit vertretener Zahl; bei Mehrdeutigkeit der höchste zulässige
//         Wert, z. B. [5,6,Joker] -> Joker=7; gilt auch, wenn der Satz als Reihe oder Gruppe lesbar ist: dann zählt die wertvollere Lesart).
//         order = kanonische Anzeigereihenfolge (Reihe aufsteigend, Joker an der vertretenen Stelle; Gruppe nach Farbe, Joker am Ende).
//         jokerAs = für jeden Joker die vertretene Farbe/Zahl (Gruppe: eine fehlende Farbe, ersten freien Index zuerst).
//         Ungültig: valid false, kind null, value 0, reason = Begründung für die Person.
//     checkTurn(state,pid,table) -> { ok, error, newValue, played:[ids], table:[[ids]] (normalisiert), sets:[analyzeSet je Satz], bad:[Satzindizes] }
//         Prüft einen Zug ohne ihn auszuführen (dieselbe Prüfung wie bei {t:'play'}). newValue = Wert der gelegten Handsteine (Joker mit vertretener
//         Zahl); vor der Eröffnung = Wert der neuen Sätze (muss >= 30 sein). bad = Sätze mit Regelverstoß (zum Markieren).
//     tileLabel(id) -> "Rot 5" | "Joker";  sortHand(ids) -> neue Liste nach Farbe, dann Zahl (Joker zuletzt);  sumValue(ids) -> Strafwert (Joker 30)
//     activePlayer(state), ranking(state), tileBalance(state) -> {hand,tisch,stapel,summe} (summe immer 106), tileValue(id) (Joker 30)
//     normalizeTable(table) -> Tisch mit kanonisch geordneten Sätzen (ungültige Sätze bleiben unverändert), tableIds(table) -> alle Steine
//
// ===== Steine =====
// 104 Zahlensteine: id = kopie*52 + farbe*13 + (zahl-1)   (kopie 0|1, farbe 0..3, zahl 1..13), id%52 = Typ (farbe*13 + zahl-1)
// 2 Joker: id 104 und 105.
//
// ===== Zustand (JSON) =====
// { game:'rg', phase:'play'|'over', round, starter (Index der Startperson dieser Runde), active (Index),
//   players:[{id,name,hand:[ids],melded:bool,score}], table:[[ids]], pile:[ids] (gezogen wird von hinten),
//   passes (aufeinanderfolgende Pässe bei leerem Stapel), recap:[Texte des letzten Zuges],
//   result:null | { winners:[ids], deltas:{id:Punkte}, reason:'leer'|'blockade' }  (nur phase 'over', gilt für die letzte Runde),
//   lastDrawn: id|null, lastDrawnBy: Spieler-id|null  (zuletzt gezogener Stein; nur für diese Person hervorheben; wird gelöscht, sobald sie wieder handelt),
//   lastPlayed:[ids] (im letzten Zug aus der Hand gelegte Steine), opts:{} }
//
// ===== Regeln (Kurzfassung) =====
// Reihe: 3–13 Steine einer Farbe, lückenlos aufsteigend (kein Umlauf 13 -> 1). Gruppe: 3 oder 4 Steine gleicher Zahl, alle Farben verschieden.
// Joker vertritt einen beliebigen Stein; jeder Satz braucht mindestens einen echten Stein; in einer Gruppe vertritt ein Joker eine fehlende Farbe.
// Zug: (A) legen: danach muss der ganze Tisch aus gültigen Sätzen bestehen, mindestens ein Handstein wird gelegt, kein Stein verlässt den Tisch.
// (B) ziehen (Stapel leer: passen), Zug endet. Eröffnung: im ersten Legezug nur neue Sätze aus der Hand, Wert >= 30, alte Sätze unverändert.
// Rundenende: Hand leer, oder Stapel leer und alle Personen passen einmal hintereinander (Blockade).
// Wertung: Strafwert der Resthand (Joker 30). Leerlegende Person: + Summe der Strafen der anderen, andere: − eigene Strafe.
// Blockade: niedrigster Strafwert gewinnt (Gleichstand: alle gleich Niedrigen gewinnen, Pluspunkte gleichmäßig geteilt, abgerundet).
// Die Partie ist endlich: jedes Legen verringert die Hand, jedes Ziehen den Stapel; bei leerem Stapel beendet ein Passumlauf die Runde.

export const COLORS = ['rot', 'blau', 'gelb', 'gruen'];
export const COLOR_NAMES = ['Rot', 'Blau', 'Gelb', 'Grün'];
export const JOKER_VALUE = 30;
export const OPEN_MIN = 30;
export const HAND_SIZE = 14;
export const TILE_COUNT = 106;

function buildTiles() {
  const t = [];
  for (let id = 0; id < 104; id++) t.push({ id, color: Math.floor((id % 52) / 13), num: (id % 13) + 1 });
  t.push({ id: 104, color: -1, num: 0 }, { id: 105, color: -1, num: 0 });
  return t;
}
export const TILES = buildTiles();
export const isJoker = (id) => id >= 104;
export const tileValue = (id) => (id >= 104 ? JOKER_VALUE : TILES[id].num);
export const sumValue = (ids) => ids.reduce((s, id) => s + tileValue(id), 0);
export const tileLabel = (id) => (isTile(id) ? (isJoker(id) ? 'Joker' : `${COLOR_NAMES[TILES[id].color]} ${TILES[id].num}`) : '?');
const isTile = (id) => Number.isInteger(id) && id >= 0 && id < TILE_COUNT;
export function sortHand(ids) {
  return ids.slice().sort((a, b) => {
    const ta = TILES[a], tb = TILES[b];
    const ca = ta.color < 0 ? 9 : ta.color, cb = tb.color < 0 ? 9 : tb.color;
    return ca - cb || ta.num - tb.num || a - b;
  });
}
export const activePlayer = (state) => state.players[state.active];
export const tableIds = (table) => [].concat(...table);

// ---------- Sätze analysieren ----------
const rangeSum = (s, n) => (n * (2 * s + n - 1)) / 2;
const GENERIC = 'Steine einer Reihe müssen dieselbe Farbe haben und aufeinanderfolgen, Steine einer Gruppe dieselbe Zahl in verschiedenen Farben.';
const bad = (reason, ids) => ({ valid: false, kind: null, value: 0, reason, jokerAs: [], order: ids.slice() });

function asReihe(reals, jokers) {
  const color = TILES[reals[0]].color;
  const nums = reals.map((id) => TILES[id].num);
  const n = reals.length + jokers.length;
  const lo = Math.min(...nums);
  const s = Math.min(lo, 14 - n); // höchster zulässiger Wert: Joker möglichst oben
  const slot = new Array(n).fill(null);
  for (const id of reals) slot[TILES[id].num - s] = id;
  const jokerAs = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (slot[i] === null) { slot[i] = jokers[j]; jokerAs.push({ id: jokers[j], color, num: s + i }); j++; }
  }
  return { valid: true, kind: 'reihe', value: rangeSum(s, n), reason: '', jokerAs, order: slot };
}
function asGruppe(reals, jokers) {
  const num = TILES[reals[0]].num;
  const n = reals.length + jokers.length;
  const sorted = reals.slice().sort((a, b) => TILES[a].color - TILES[b].color);
  const used = new Set(sorted.map((id) => TILES[id].color));
  const free = [0, 1, 2, 3].filter((c) => !used.has(c));
  const jokerAs = jokers.map((id, i) => ({ id, color: free[i], num }));
  return { valid: true, kind: 'gruppe', value: num * n, reason: '', jokerAs, order: sorted.concat(jokers) };
}

export function analyzeSet(ids) {
  if (!Array.isArray(ids)) return bad('Das ist kein Satz.', []);
  const list = ids.slice();
  if (!list.every(isTile) || new Set(list).size !== list.length) return bad('Ungültige Steine im Satz.', list);
  if (list.length < 3) return bad('Mindestens 3 Steine nötig.', list);
  if (list.length > 13) return bad('Ein Satz hat höchstens 13 Steine.', list);
  const jokers = list.filter(isJoker);
  const reals = list.filter((id) => !isJoker(id));
  if (!reals.length) return bad('Ein Satz braucht mindestens einen echten Stein, nicht nur Joker.', list);
  const n = list.length;
  const colors = reals.map((id) => TILES[id].color);
  const nums = reals.map((id) => TILES[id].num);
  const sameColor = colors.every((c) => c === colors[0]);
  const sameNum = nums.every((x) => x === nums[0]);
  const distinctNums = new Set(nums).size === nums.length;
  const distinctColors = new Set(colors).size === colors.length;
  const cands = [];
  let runReason = '';
  if (sameColor) {
    if (!distinctNums) runReason = 'In einer Reihe darf keine Zahl doppelt vorkommen.';
    else {
      const span = Math.max(...nums) - Math.min(...nums) + 1;
      if (span - reals.length > jokers.length) runReason = 'In der Reihe fehlen Zahlen, die die Joker nicht ausfüllen können.';
      else cands.push(asReihe(reals, jokers));
    }
  }
  let grpReason = '';
  if (sameNum) {
    if (!distinctColors) grpReason = 'In einer Gruppe darf jede Farbe nur einmal vorkommen.';
    else if (n > 4) grpReason = 'Eine Gruppe hat höchstens 4 Steine.';
    else cands.push(asGruppe(reals, jokers));
  }
  if (cands.length) return cands.sort((a, b) => b.value - a.value)[0];
  if (sameNum && reals.length > 1) return bad(grpReason, list);
  if (sameColor && reals.length > 1) return bad(runReason, list);
  if (reals.length === 1) return bad(n > 4 ? 'Mit so vielen Jokern geht nur eine Reihe, und die passt hier nicht.' : GENERIC, list);
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
function deal(state, rng) {
  const ids = shuffle(Array.from({ length: TILE_COUNT }, (_, i) => i), rng);
  for (const p of state.players) { p.hand = ids.splice(0, HAND_SIZE); p.melded = false; }
  state.pile = ids;
  state.table = [];
  state.passes = 0;
  state.phase = 'play';
  state.result = null;
  state.lastDrawn = null;
  state.lastDrawnBy = null;
  state.lastPlayed = [];
}

export function createGame(playerList, opts = {}, rng = Math.random) {
  if (!Array.isArray(playerList) || playerList.length < 2 || playerList.length > 4) throw new RangeError('Reihen & Gruppen braucht 2 bis 4 Personen.');
  const state = {
    game: 'rg', phase: 'play', round: 1, starter: 0, active: 0,
    players: playerList.map((p) => ({ id: p.id, name: p.name, hand: [], melded: false, score: 0 })),
    table: [], pile: [], passes: 0, recap: [], result: null, lastDrawn: null, lastDrawnBy: null, lastPlayed: [],
    opts: opts && typeof opts === 'object' ? { ...opts } : {},
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

// ---------- Zug prüfen ----------
export function checkTurn(state, pid, table) {
  const fail = (error, extra = {}) => ({ ok: false, error, newValue: 0, played: [], table: [], sets: [], bad: [], ...extra });
  if (!state || !Array.isArray(state.players)) return fail('Kein Spiel.');
  if (state.phase !== 'play') return fail('Diese Runde ist zu Ende.');
  const p = state.players.find((x) => x.id === pid);
  if (!p) return fail('Du spielst hier nicht mit.');
  if (activePlayer(state).id !== pid) return fail('Du bist nicht an der Reihe.');
  if (!Array.isArray(table) || !table.every((s) => Array.isArray(s))) return fail('Ungültiger Tisch.');
  const sets = table.filter((s) => s.length > 0).map((s) => s.slice());
  const flat = tableIds(sets);
  if (!flat.every(isTile)) return fail('Ungültige Steine auf dem Tisch.');
  if (new Set(flat).size !== flat.length) return fail('Ein Stein liegt mehrfach auf dem Tisch.');
  const oldSet = new Set(tableIds(state.table));
  const hand = new Set(p.hand);
  const newSet = new Set(flat);
  for (const id of flat) if (!oldSet.has(id) && !hand.has(id)) return fail(`Der Stein ${tileLabel(id)} gehört dir nicht.`);
  for (const id of oldSet) if (!newSet.has(id)) return fail('Steine, die auf dem Tisch lagen, dürfen nicht zurück in die Hand. Alle müssen liegen bleiben.');
  const played = flat.filter((id) => !oldSet.has(id));
  if (!played.length) return fail('Du musst mindestens einen Stein aus deiner Hand legen.');
  const analyses = sets.map(analyzeSet);
  const badIdx = analyses.map((a, i) => (a.valid ? -1 : i)).filter((i) => i >= 0);
  if (badIdx.length) {
    const i = badIdx[0];
    const lab = sets[i].map(tileLabel).join(', ');
    return fail(`Satz ${i + 1} (${lab}) ist ungültig: ${analyses[i].reason}`, { table: sets, sets: analyses, bad: badIdx, played });
  }
  const norm = analyses.map((a) => a.order);
  const valOf = new Map();
  analyses.forEach((a) => { for (const id of a.order) valOf.set(id, tileValue(id)); a.jokerAs.forEach((j) => valOf.set(j.id, j.num)); });
  let newValue = played.reduce((s, id) => s + valOf.get(id), 0);
  if (!p.melded) {
    const oldSets = state.table.map((s) => s.slice().sort((a, b) => a - b).join(','));
    const keys = norm.map((s) => s.slice().sort((a, b) => a - b).join(','));
    const pool = keys.slice();
    for (const k of oldSets) {
      const at = pool.indexOf(k);
      if (at < 0) return fail('Vor dem Eröffnen dürfen die Sätze auf dem Tisch nicht verändert werden.', { table: norm, sets: analyses, played });
      pool.splice(at, 1);
    }
    const fresh = [];
    const left = oldSets.slice();
    keys.forEach((k, i) => { const at = left.indexOf(k); if (at >= 0) left.splice(at, 1); else fresh.push(i); });
    newValue = fresh.reduce((s, i) => s + analyses[i].value, 0);
    if (newValue < OPEN_MIN) {
      return fail(`Zum Eröffnen brauchst du neue Sätze mit zusammen mindestens ${OPEN_MIN} Punkten (jetzt: ${newValue}).`, { table: norm, sets: analyses, played, newValue });
    }
  }
  return { ok: true, error: '', newValue, played, table: norm, sets: analyses, bad: [] };
}

// ---------- Zugende / Rundenende ----------
const pointsText = (n) => `${n} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
function endRound(state, winners, reason) {
  const pen = {};
  for (const p of state.players) pen[p.id] = sumValue(p.hand);
  const losers = state.players.filter((p) => !winners.includes(p.id));
  const total = losers.reduce((s, p) => s + pen[p.id], 0);
  const share = Math.floor(total / winners.length);
  const deltas = {};
  for (const p of state.players) deltas[p.id] = winners.includes(p.id) ? share : -pen[p.id];
  for (const p of state.players) p.score += deltas[p.id];
  state.phase = 'over';
  state.result = { winners: winners.slice(), deltas, reason };
  const names = winners.map((id) => state.players.find((p) => p.id === id).name).join(' und ');
  state.recap.push(reason === 'leer'
    ? `${names} hat alle Steine gelegt und gewinnt die Runde (+${share}).`
    : `Niemand kann mehr legen. ${names} hat die wenigsten Reststeine und gewinnt die Runde (+${share}).`);
  for (const p of state.players) if (!winners.includes(p.id)) state.recap.push(`${p.name}: ${pointsText(deltas[p.id])} (Reststeine ${pen[p.id]}).`);
}
const advance = (state) => { state.active = (state.active + 1) % state.players.length; };
function clearHint(state, pid) {
  if (state.lastDrawnBy === pid) { state.lastDrawn = null; state.lastDrawnBy = null; }
}

export function playTable(state, pid, table) {
  const c = checkTurn(state, pid, table);
  if (!c.ok) return { ok: false, error: c.error };
  const p = state.players.find((x) => x.id === pid);
  const gone = new Set(c.played);
  p.hand = p.hand.filter((id) => !gone.has(id));
  state.table = c.table;
  const first = !p.melded;
  p.melded = true;
  state.passes = 0;
  clearHint(state, pid);
  state.lastPlayed = c.played.slice();
  state.recap = [`${p.name} ${first ? 'eröffnet und legt' : 'legt'} ${c.played.length} ${c.played.length === 1 ? 'Stein' : 'Steine'} (${c.newValue} Punkte).`];
  if (!p.hand.length) endRound(state, [p.id], 'leer');
  else advance(state);
  return { ok: true };
}

export function draw(state, pid) {
  if (!state || state.phase !== 'play') return { ok: false, error: 'Diese Runde ist zu Ende.' };
  const p = state.players.find((x) => x.id === pid);
  if (!p) return { ok: false, error: 'Du spielst hier nicht mit.' };
  if (activePlayer(state).id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  state.lastPlayed = [];
  if (state.pile.length) {
    const id = state.pile.pop();
    p.hand.push(id);
    state.passes = 0;
    state.lastDrawn = id;
    state.lastDrawnBy = pid;
    state.recap = [`${p.name} zieht einen Stein.`];
    advance(state);
    return { ok: true };
  }
  clearHint(state, pid);
  state.passes += 1;
  state.recap = [`${p.name} passt (Stapel leer).`];
  if (state.passes >= state.players.length) {
    const sums = state.players.map((x) => sumValue(x.hand));
    const low = Math.min(...sums);
    endRound(state, state.players.filter((_, i) => sums[i] === low).map((x) => x.id), 'blockade');
  } else advance(state);
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

export function tileBalance(state) {
  const hand = state.players.reduce((s, p) => s + p.hand.length, 0);
  const tisch = tableIds(state.table).length;
  const stapel = state.pile.length;
  return { hand, tisch, stapel, summe: hand + tisch + stapel };
}

export function handle(state, pid, msg, rng = Math.random) {
  try {
    if (!state || typeof state !== 'object' || !Array.isArray(state.players)) return { ok: false, error: 'Kein Spiel.' };
    if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
    switch (msg.t) {
      case 'play': return playTable(state, pid, msg.table);
      case 'draw': return draw(state, pid);
      case 'next':
        if (!state.players.some((x) => x.id === pid)) return { ok: false, error: 'Du spielst hier nicht mit.' };
        return newRound(state, rng);
      default: return { ok: false, error: 'Unbekannte Nachricht.' };
    }
  } catch (e) {
    return { ok: false, error: 'Das hat nicht geklappt.' };
  }
}
