// Schwimmen (31) – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind { s: Farbe 0..3, r: Wert 0..7 } (Skatblatt, 32 Karten). Alle Zustände sind reines JSON.
// Hand- und Stapelkarten stehen technisch im Zustand; die Oberfläche zeigt nur die eigenen Karten und den Tisch.

export const GAME = 'sw';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const START_LIVES = 3;
export const HAND_SIZE = 3;
export const TABLE_SIZE = 3;
const RECAP_MAX = 6;
const MOVE_CAP = 300; // Sicherung: spätestens dann wird die Runde aufgedeckt

export const SUITS = [
  { sym: '♣', name: 'Kreuz', red: false },
  { sym: '♠', name: 'Pik', red: false },
  { sym: '♥', name: 'Herz', red: true },
  { sym: '♦', name: 'Karo', red: true },
];
export const RANKS = [
  { sym: '7', name: 'Sieben', value: 7 },
  { sym: '8', name: 'Acht', value: 8 },
  { sym: '9', name: 'Neun', value: 9 },
  { sym: '10', name: 'Zehn', value: 10 },
  { sym: 'B', name: 'Bube', value: 10 },
  { sym: 'D', name: 'Dame', value: 10 },
  { sym: 'K', name: 'König', value: 10 },
  { sym: 'A', name: 'Ass', value: 11 },
];

export const cardName = (c) => `${SUITS[c.s].sym} ${RANKS[c.r].name}`;
export const cardValue = (c) => RANKS[c.r].value;
export const sameCard = (a, b) => !!a && !!b && a.s === b.s && a.r === b.r;
export const isCard = (c) => !!c && typeof c === 'object' && Number.isInteger(c.s) && Number.isInteger(c.r) && c.s >= 0 && c.s < 4 && c.r >= 0 && c.r < 8;
export const fmtVal = (v) => (v === 30.5 ? '30,5' : String(v));

// Handwert: höchste Summe einer Farbe; drei gleiche Werte (verschiedene Farben) = 30,5.
export function handValue(hand) {
  if (!Array.isArray(hand) || !hand.length) return 0;
  if (hand.length === 3 && hand.every((c) => c.r === hand[0].r) && new Set(hand.map((c) => c.s)).size === 3) return 30.5;
  const sum = [0, 0, 0, 0];
  for (const c of hand) sum[c.s] += cardValue(c);
  return Math.max(...sum);
}

export function fullDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 0; r < 8; r++) d.push({ s, r });
  return d;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Hilfen ----------
export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const alivePlayers = (g) => g.players.filter((p) => !p.out);
export const aliveCount = (g) => alivePlayers(g).length;
export const isSwimming = (p) => !p.out && p.lives === 0;
const sortHand = (hand) => hand.sort((a, b) => a.s - b.s || a.r - b.r);
const copyCards = (a) => a.map((c) => ({ s: c.s, r: c.r }));

function pushRecap(g, line) {
  g.recap.unshift(line); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

function nextAliveIdx(g, from) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!g.players[i].out) return i;
  }
  return from;
}

// ---------- Rundenaufbau ----------
function deal(g, rng) {
  g.deck = shuffle(fullDeck(), rng);
  for (const p of g.players) p.hand = [];
  for (const p of g.players) {
    if (p.out) continue;
    for (let k = 0; k < HAND_SIZE; k++) p.hand.push(g.deck.pop());
    sortHand(p.hand);
  }
  g.table = [];
  for (let k = 0; k < TABLE_SIZE; k++) g.table.push(g.deck.pop());
  g.active = g.starter;
  g.knocker = null;
  g.left = 0;
  g.passes = 0;
  g.swapped = {};
  g.moves = 0;
  g.phase = 'play';
  g.result = null;
  g.recap = [];
  g.last = null;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Schwimmen braucht 2 bis 6 Personen.');
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    opts: { show: !!o.show },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], lives: START_LIVES, out: false, outRound: 0 })),
    round: 1,
    starter: 0,
    deck: [], table: [], active: 0, knocker: null, left: 0, passes: 0, swapped: {}, moves: 0,
    phase: 'play', result: null, recap: [], last: null,
  };
  deal(g, rng);
  return g;
}

// Nächste Runde der Serie: neu mischen und geben, die Startperson rotiert, Leben bleiben.
export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'over') return { ok: false, error: 'Die Runde läuft noch.' };
  if (g.result && g.result.final) return { ok: false, error: 'Das Spiel ist zu Ende.' };
  g.round += 1;
  g.starter = nextAliveIdx(g, g.starter);
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

// ---------- Rundenende ----------
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`);
const lebenWort = (n) => (n === 1 ? 'ein Leben' : 'zwei Leben');

function finishRound(g, kind, callerId) {
  const alive = alivePlayers(g);
  const values = {};
  for (const p of alive) values[p.id] = handValue(p.hand);
  const loss = {};
  let text;
  let low = [];
  if (kind === '31') {
    const caller = g.players[idxOf(g, callerId)];
    for (const p of alive) if (p.id !== caller.id) loss[p.id] = 1;
    text = `${caller.name} hat 31! Alle anderen verlieren ein Leben.`;
    pushRecap(g, `${caller.name} sagt „31!“ an.`);
  } else {
    const min = Math.min(...alive.map((p) => values[p.id]));
    low = alive.filter((p) => values[p.id] === min);
    for (const p of low) loss[p.id] = g.knocker === p.id ? 2 : 1;
    const names = low.map((p) => p.name);
    const kn = low.find((p) => p.id === g.knocker);
    if (kn) {
      text = low.length === 1
        ? `${kn.name} hat geklopft und hat das niedrigste Blatt (${fmtVal(min)}). Das kostet zwei Leben.`
        : `${kn.name} hat geklopft und hat mit ${joinNames(names.filter((x) => x !== kn.name))} das niedrigste Blatt (${fmtVal(min)}). ${kn.name} verliert zwei Leben, die anderen je ein Leben.`;
    } else {
      text = `${joinNames(names)} ${low.length === 1 ? 'hat' : 'haben'} das niedrigste Blatt (${fmtVal(min)}) und ${low.length === 1 ? 'verliert' : 'verlieren'} ein Leben.`;
    }
    pushRecap(g, 'Alle Karten werden aufgedeckt.');
  }
  // Leben abziehen; wer schon schwimmt (0 Leben) und noch einmal verliert, scheidet aus
  const willOut = [];
  for (const p of alive) {
    const n = loss[p.id] || 0;
    if (!n) continue;
    if (p.lives === 0) willOut.push(p);
    else p.lives = Math.max(0, p.lives - n);
  }
  let champions;
  let draw = false;
  if (willOut.length && willOut.length === alive.length) {
    // Alle würden gleichzeitig ausscheiden: niemand scheidet aus, das Spiel endet unentschieden
    draw = true;
    champions = alive.map((p) => p.id);
  } else {
    for (const p of willOut) { p.out = true; p.outRound = g.round; }
    const left = alivePlayers(g);
    champions = left.length <= 1 ? left.map((p) => p.id) : null;
  }
  const final = champions !== null;
  g.phase = 'over';
  g.result = {
    kind, caller: kind === '31' ? callerId : null, knocker: g.knocker, values, loss, low: low.map((p) => p.id),
    eliminated: draw ? [] : willOut.map((p) => p.id),
    swimming: alive.filter((p) => isSwimming(p) && (loss[p.id] || 0) > 0).map((p) => p.id),
    final, draw, champions: final ? champions : [], text,
  };
  for (const p of willOut) if (!draw) pushRecap(g, `${p.name} schwimmt nicht mehr mit und scheidet aus.`);
  pushRecap(g, text);
  g.last = { kind: 'over', text };
}

// ---------- Züge ----------
function replaceTable(g) {
  const fresh = [g.deck.pop(), g.deck.pop(), g.deck.pop()];
  g.deck.unshift(...g.table); // die alten Tischkarten wandern unter den Stapel
  g.table = fresh;
  g.passes = 0;
  pushRecap(g, 'Alle haben geschoben: Drei neue Karten liegen auf dem Tisch.');
}

function afterMove(g) {
  g.moves += 1;
  if (g.knocker !== null) {
    g.left -= 1;
    if (g.left <= 0) { finishRound(g, 'show', null); return; }
  }
  if (g.moves >= MOVE_CAP) { pushRecap(g, 'Es geht nicht voran: Die Runde wird aufgedeckt.'); finishRound(g, 'show', null); return; }
  g.active = nextAliveIdx(g, g.active);
}

function check31(g, p) {
  if (handValue(p.hand) === 31) { finishRound(g, '31', p.id); return true; }
  return false;
}

function doSwap1(g, p, msg) {
  const { hand: i, table: j } = msg;
  if (!Number.isInteger(i) || i < 0 || i >= HAND_SIZE || !Number.isInteger(j) || j < 0 || j >= TABLE_SIZE) return { ok: false, error: 'Diese Karte gibt es nicht.' };
  const mine = p.hand[i];
  const theirs = g.table[j];
  p.hand[i] = theirs;
  g.table[j] = mine;
  g.passes = 0;
  g.swapped[p.id] = true;
  pushRecap(g, `${p.name} tauscht ${cardName(mine)} gegen ${cardName(theirs)}.`);
  g.last = { kind: 'swap1', pid: p.id, name: p.name, gave: mine, took: theirs };
  if (check31(g, p)) return { ok: true, thirtyOne: true };
  afterMove(g);
  return { ok: true };
}

function doSwap3(g, p) {
  const old = p.hand;
  p.hand = g.table;
  g.table = old;
  g.passes = 0;
  g.swapped[p.id] = true;
  pushRecap(g, `${p.name} tauscht alle drei Karten.`);
  g.last = { kind: 'swap3', pid: p.id, name: p.name };
  if (check31(g, p)) return { ok: true, thirtyOne: true };
  afterMove(g);
  return { ok: true };
}

function doPass(g, p) {
  g.passes += 1;
  pushRecap(g, `${p.name} schiebt.`);
  g.last = { kind: 'pass', pid: p.id, name: p.name };
  if (g.knocker === null && g.passes >= aliveCount(g)) replaceTable(g);
  afterMove(g);
  return { ok: true };
}

function doKnock(g, p) {
  if (g.knocker !== null) return { ok: false, error: 'Es wurde schon geklopft.' };
  g.knocker = p.id;
  g.left = aliveCount(g) - 1;
  g.passes = 0;
  pushRecap(g, `${p.name} klopft! Alle anderen haben noch einen Zug.`);
  g.last = { kind: 'knock', pid: p.id, name: p.name };
  g.moves += 1;
  g.active = nextAliveIdx(g, g.active);
  return { ok: true };
}

function doCall31(g, p) {
  if (handValue(p.hand) !== 31) return { ok: false, error: 'Du hast noch keine 31.' };
  finishRound(g, '31', p.id);
  return { ok: true, thirtyOne: true };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== GAME) return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  const idx = idxOf(g, pid);
  if (idx < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (msg.t === 'next') {
    if (pid !== g.hostId) return { ok: false, error: 'Nur der Gastgeber kann die nächste Runde starten.' };
    return nextRound(g, rng);
  }
  if (!['swap1', 'swap3', 'pass', 'knock', 'call31'].includes(msg.t)) return { ok: false, error: 'Unbekannte Nachricht.' };
  if (g.phase !== 'play') return { ok: false, error: 'Die Runde ist zu Ende.' };
  const p = g.players[idx];
  if (p.out) return { ok: false, error: 'Du bist leider ausgeschieden.' };
  if (msg.t === 'call31') return doCall31(g, p);
  if (g.active !== idx) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (msg.t === 'swap1') return doSwap1(g, p, msg);
  if (msg.t === 'swap3') return doSwap3(g, p);
  if (msg.t === 'pass') return doPass(g, p);
  return doKnock(g, p);
}

// Rangliste: wer noch dabei ist zuerst (mehr Leben vorn), dann die Ausgeschiedenen (später ausgeschieden vorn).
export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, lives: p.lives, out: p.out, swim: isSwimming(p), outRound: p.outRound, idx: i }));
  rows.sort((a, b) => (a.out - b.out) || (a.out ? b.outRound - a.outRound : b.lives - a.lives) || a.idx - b.idx);
  const champs = g.result && g.result.final ? g.result.champions : [];
  rows.forEach((r, k) => {
    const prev = rows[k - 1];
    const tie = prev && prev.out === r.out && (r.out ? prev.outRound === r.outRound : prev.lives === r.lives);
    r.rank = tie ? prev.rank : k + 1;
    r.winner = champs.includes(r.id);
  });
  return rows;
}
