// Wenig ist mehr – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind ganze Zahlen von -2 bis 12. Ein Feld im Raster ist { v: Wert, up: offen? } oder null (Spalte entfernt).
// Raster: 3 Zeilen x 4 Spalten, Index i = Zeile * 4 + Spalte. Alle Zustände sind reines JSON.

export const GAME = 'wm';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const COLS = 4;
export const ROWS = 3;
export const CELLS = 12;
export const LIMIT = 100;
export const MIN_VALUE = -2;
export const MAX_VALUE = 12;
const RECAP_MAX = 6;
const MOVE_CAP = 1500; // Sicherung: spätestens dann endet eine Runde

export const countOf = (v) => (v === -2 ? 5 : v === -1 ? 10 : v === 0 ? 15 : 10);
export const isValue = (v) => Number.isInteger(v) && v >= MIN_VALUE && v <= MAX_VALUE;
export const fmt = (v) => (v < 0 ? `−${-v}` : String(v)); // Anzeige mit echtem Minuszeichen
export const bandOf = (v) => (v < 0 ? 'neg' : v === 0 ? 'zero' : v <= 4 ? 'low' : v <= 8 ? 'mid' : 'high');

export function fullDeck() {
  const d = [];
  for (let v = MIN_VALUE; v <= MAX_VALUE; v++) for (let k = 0; k < countOf(v); k++) d.push(v);
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
export const colCells = (c) => [c, c + COLS, c + 2 * COLS];
export const upCount = (p) => p.grid.filter((c) => c && c.up).length;
export const hiddenCount = (p) => p.grid.filter((c) => c && !c.up).length;
export const openSum = (p) => p.grid.reduce((s, c) => s + (c && c.up ? c.v : 0), 0);
export const fullSum = (p) => p.grid.reduce((s, c) => s + (c ? c.v : 0), 0);
const allUp = (p) => p.grid.every((c) => c === null || c.up);

function note(g, text) {
  g.recap.unshift(text); // neueste zuerst
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

// ---------- Rundenaufbau ----------
function deal(g, rng) {
  g.deck = shuffle(fullDeck(), rng);
  g.discard = [];
  for (const p of g.players) {
    p.grid = Array.from({ length: CELLS }, () => ({ v: g.deck.pop(), up: false }));
    p.gone = [];
    p.round = 0;
  }
  g.discard.push(g.deck.pop());
  g.phase = 'reveal';
  g.active = g.starter === null ? 0 : g.starter;
  g.turn = { stage: 'start', drawn: null };
  g.endBy = null;
  g.moves = 0;
  g.result = null;
  g.recap = [];
  g.last = null;
}

export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Wenig ist mehr braucht 2 bis 8 Personen.');
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    opts: { double: o.double === undefined ? true : !!o.double },
    limit: Number.isInteger(o.limit) && o.limit >= 1 ? o.limit : LIMIT,
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players: playerList.map((p) => ({ id: String(p.id), name: String(p.name), grid: [], gone: [], total: 0, round: 0 })),
    round: 1,
    starter: null, // in Runde 1 entscheidet das Aufdecken
    phase: 'reveal', // reveal | play | round | over
    deck: [], discard: [], active: 0,
    turn: { stage: 'start', drawn: null }, // stage: start | drawn | flip
    endBy: null, moves: 0, result: null, recap: [], last: null,
  };
  deal(g, rng);
  return g;
}

// Nächste Runde: neu mischen und geben, die Startperson rotiert, der Spielstand bleibt.
export function nextRound(g, rng = Math.random) {
  if (!g || g.phase !== 'round') return { ok: false, error: 'Die Runde läuft noch.' };
  g.round += 1;
  g.starter = ((g.starter === null ? 0 : g.starter) + 1) % g.players.length;
  g.gid = Math.floor(rng() * 1e9);
  deal(g, rng);
  return { ok: true };
}

function startPlay(g) {
  if (g.starter === null) {
    let best = 0;
    let bestSum = -Infinity;
    let bestMax = -Infinity;
    g.players.forEach((p, i) => {
      const ups = p.grid.filter((c) => c.up).map((c) => c.v);
      const s = ups.reduce((a, b) => a + b, 0);
      const m = Math.max(...ups);
      if (s > bestSum || (s === bestSum && m > bestMax)) { best = i; bestSum = s; bestMax = m; }
    });
    g.starter = best;
  }
  g.active = g.starter;
  g.phase = 'play';
  g.turn = { stage: 'start', drawn: null };
  note(g, `${g.players[g.active].name} beginnt.`);
  g.last = { kind: 'start', pid: g.players[g.active].id, name: g.players[g.active].name };
}

// ---------- Karten ziehen ----------
function drawCard(g, rng) {
  if (!g.deck.length) {
    if (g.discard.length <= 1) return null;
    const top = g.discard.pop();
    g.deck = shuffle(g.discard, rng);
    g.discard = [top];
    note(g, 'Der Stapel war leer: Die Karten der Ablage wurden neu gemischt.');
  }
  return g.deck.pop();
}

// ---------- Spalten ----------
// Drei gleiche offene Karten in einer Spalte kommen aus dem Spiel (auf die Ablage). Gibt die Anzahl entfernter Spalten zurück.
export function removeTriples(g, p) {
  let n = 0;
  for (let c = 0; c < COLS; c++) {
    const cells = colCells(c).map((i) => p.grid[i]);
    if (cells.every((x) => x && x.up && x.v === cells[0].v)) {
      const v = cells[0].v;
      for (const i of colCells(c)) { g.discard.push(p.grid[i].v); p.grid[i] = null; }
      p.gone.push(v);
      note(g, `${p.name}: Drei gleiche Karten (${fmt(v)}) in einer Spalte kommen aus dem Spiel.`);
      n += 1;
    }
  }
  return n;
}

// ---------- Rundenende ----------
function finishRound(g) {
  const raw = {};
  for (const p of g.players) {
    for (const c of p.grid) if (c) c.up = true;
    raw[p.id] = fullSum(p);
  }
  const fin = g.endBy === null ? null : g.players[g.endBy];
  let doubled = false;
  const pts = { ...raw };
  if (fin && g.opts.double && raw[fin.id] > 0) {
    const beaten = g.players.some((p) => p.id !== fin.id && raw[p.id] <= raw[fin.id]);
    if (beaten) { doubled = true; pts[fin.id] = raw[fin.id] * 2; }
  }
  for (const p of g.players) { p.round = pts[p.id]; p.total += pts[p.id]; }
  g.result = { round: g.round, finisher: fin ? fin.id : null, finisherName: fin ? fin.name : null, raw, pts, doubled };
  g.turn = { stage: 'start', drawn: null };
  const over = g.players.some((p) => p.total >= g.limit);
  g.phase = over ? 'over' : 'round';
  note(g, doubled
    ? `Die Runde ist zu Ende. ${fin.name} hatte nicht die wenigsten Punkte: ${raw[fin.id]} Punkte zählen doppelt.`
    : 'Die Runde ist zu Ende.');
  if (over) {
    const min = Math.min(...g.players.map((p) => p.total));
    const names = g.players.filter((p) => p.total === min).map((p) => p.name);
    note(g, `Das Spiel ist zu Ende. ${names.length > 1 ? 'Gemeinsam gewinnen' : 'Es gewinnt'} ${names.join(' und ')}.`);
  }
  g.last = { kind: 'over', round: g.round };
}

function endTurn(g) {
  const p = g.players[g.active];
  if (g.endBy === null && allUp(p)) {
    g.endBy = g.active;
    note(g, `${p.name} hat alle Karten aufgedeckt. Alle anderen haben noch einen letzten Zug.`);
  }
  g.moves += 1;
  const next = (g.active + 1) % g.players.length;
  if ((g.endBy !== null && next === g.endBy) || g.moves > MOVE_CAP) { finishRound(g); return; }
  g.active = next;
  g.turn = { stage: 'start', drawn: null };
}

// ---------- Aktionen ----------
const fail = (error) => ({ ok: false, error });
const validCell = (p, i) => Number.isInteger(i) && i >= 0 && i < CELLS && !!p.grid[i];

function doReveal(g, p, msg) {
  if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i >= CELLS || !p.grid[msg.i]) return fail('Diese Karte gibt es nicht.');
  if (upCount(p) >= 2) return fail('Du hast schon zwei Karten aufgedeckt.');
  if (p.grid[msg.i].up) return fail('Diese Karte ist schon offen.');
  p.grid[msg.i].up = true;
  g.last = { kind: 'reveal', pid: p.id, name: p.name };
  if (g.players.every((q) => upCount(q) >= 2)) startPlay(g);
  return { ok: true };
}

function doDraw(g, p, rng) {
  if (g.turn.stage !== 'start') return fail('Du hast schon eine Karte genommen oder gezogen.');
  const v = drawCard(g, rng);
  if (v === null) return fail('Es gibt keine Karte mehr zum Ziehen.');
  g.turn = { stage: 'drawn', drawn: v };
  note(g, `${p.name} zieht eine Karte vom Stapel.`);
  g.last = { kind: 'draw', pid: p.id, name: p.name };
  return { ok: true };
}

function doSwap(g, p, msg) {
  if (msg.from !== 'discard' && msg.from !== 'drawn') return fail('Ungültige Nachricht.');
  if (!validCell(p, msg.i)) return fail('Diese Karte gibt es nicht.');
  let nv;
  if (msg.from === 'discard') {
    if (g.turn.stage !== 'start') return fail('Du hast schon eine Karte genommen oder gezogen.');
    nv = g.discard.pop();
  } else {
    if (g.turn.stage !== 'drawn') return fail('Du hast keine gezogene Karte.');
    nv = g.turn.drawn;
  }
  const old = p.grid[msg.i];
  p.grid[msg.i] = { v: nv, up: true };
  g.discard.push(old.v);
  note(g, `${p.name} ${msg.from === 'discard' ? `nimmt die ${fmt(nv)} von der Ablage` : `tauscht die gezogene ${fmt(nv)}`} gegen ${old.up ? 'eine offene' : 'eine verdeckte'} Karte. Die ${fmt(old.v)} liegt jetzt oben auf der Ablage.`);
  g.last = { kind: 'swap', pid: p.id, name: p.name, got: nv, gave: old.v, i: msg.i };
  removeTriples(g, p);
  endTurn(g);
  return { ok: true };
}

function doDiscard(g, p) {
  if (g.turn.stage !== 'drawn') return fail('Du hast keine gezogene Karte.');
  const v = g.turn.drawn;
  g.discard.push(v);
  g.turn = { stage: 'start', drawn: null };
  note(g, `${p.name} legt die gezogene ${fmt(v)} auf die Ablage.`);
  g.last = { kind: 'put', pid: p.id, name: p.name, card: v };
  if (hiddenCount(p) > 0) g.turn = { stage: 'flip', drawn: null };
  else endTurn(g);
  return { ok: true };
}

function doFlip(g, p, msg) {
  if (g.turn.stage !== 'flip') return fail('Du darfst jetzt keine Karte aufdecken.');
  if (!validCell(p, msg.i)) return fail('Diese Karte gibt es nicht.');
  if (p.grid[msg.i].up) return fail('Diese Karte ist schon offen.');
  p.grid[msg.i].up = true;
  note(g, `${p.name} deckt eine Karte auf: ${fmt(p.grid[msg.i].v)}.`);
  g.last = { kind: 'flip', pid: p.id, name: p.name, card: p.grid[msg.i].v, i: msg.i };
  removeTriples(g, p);
  endTurn(g);
  return { ok: true };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== GAME) return fail('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('Ungültige Nachricht.');
  const idx = idxOf(g, pid);
  if (idx < 0) return fail('Du spielst nicht mit.');
  if (msg.t === 'next') {
    if (pid !== g.hostId) return fail('Nur der Gastgeber kann die nächste Runde starten.');
    return nextRound(g, rng);
  }
  const p = g.players[idx];
  if (g.phase === 'reveal') {
    if (msg.t !== 'reveal') return fail('Zuerst deckt jede Person zwei Karten auf.');
    return doReveal(g, p, msg);
  }
  if (g.phase !== 'play') return fail('Die Runde ist zu Ende.');
  if (!['draw', 'swap', 'discard', 'flip'].includes(msg.t)) return fail('Unbekannte Nachricht.');
  if (g.active !== idx) return fail('Du bist nicht an der Reihe.');
  if (msg.t === 'draw') return doDraw(g, p, rng);
  if (msg.t === 'swap') return doSwap(g, p, msg);
  if (msg.t === 'discard') return doDiscard(g, p);
  return doFlip(g, p, msg);
}

// Rangliste: wenigste Punkte zuerst; winner = alle mit den wenigsten Punkten, wenn das Spiel zu Ende ist.
export function ranking(g) {
  const rows = g.players.map((p, i) => ({ id: p.id, name: p.name, total: p.total, round: p.round, idx: i }));
  rows.sort((a, b) => a.total - b.total || a.idx - b.idx);
  const min = rows.length ? rows[0].total : 0;
  rows.forEach((r, k) => {
    r.rank = k > 0 && r.total === rows[k - 1].total ? rows[k - 1].rank : k + 1;
    r.winner = g.phase === 'over' && r.total === min;
  });
  return rows;
}
