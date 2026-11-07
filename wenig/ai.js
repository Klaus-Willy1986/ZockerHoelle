// Wenig ist mehr – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel. Der Computer arbeitet nur mit seiner eigenen Sicht (makeView):
// eigene offene Karten, offene Karten der anderen, oberste Karte der Ablage, Größe des Stapels,
// entfernte Spalten und seine eigene gezogene Karte. Verdeckte Karten und der Stapelinhalt sind für ihn unsichtbar.
import * as M from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const RANDOM_EASY = 0.25;
export const RANDOM_MID = 0.1;

// Die Sicht einer Person auf den Spielstand: nirgends ein Wert einer verdeckten Karte.
export function makeView(g, idx) {
  const cell = (c) => (c === null ? null : c.up ? { up: true, v: c.v } : { up: false });
  const mineActive = g.active === idx && g.phase === 'play';
  return {
    n: g.players.length,
    idx,
    double: !!g.opts.double,
    phase: g.phase,
    active: g.active,
    stage: g.turn.stage,
    drawn: mineActive && g.turn.stage === 'drawn' ? g.turn.drawn : null,
    top: g.discard[g.discard.length - 1],
    deckLen: g.deck.length,
    endBy: g.endBy,
    players: g.players.map((p) => ({ grid: p.grid.map(cell), gone: p.gone.slice(), total: p.total })),
  };
}

const hiddenIdx = (grid) => grid.map((c, i) => (c && !c.up ? i : -1)).filter((i) => i >= 0);
const liveIdx = (grid) => grid.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);

// Alle erlaubten Nachrichten in dieser Lage (zufälliger Zug = gleichverteilt darunter)
export function legalMoves(view) {
  const grid = view.players[view.idx].grid;
  if (view.stage === 'start') return [{ t: 'draw' }, ...liveIdx(grid).map((i) => ({ t: 'swap', from: 'discard', i }))];
  if (view.stage === 'drawn') return [{ t: 'discard' }, ...liveIdx(grid).map((i) => ({ t: 'swap', from: 'drawn', i }))];
  return hiddenIdx(grid).map((i) => ({ t: 'flip', i }));
}

// ---------- Leicht ----------
function easy(view, rng) {
  const grid = view.players[view.idx].grid;
  if (rng() < RANDOM_EASY) return pick(legalMoves(view), rng);
  if (view.stage === 'start') {
    if (view.top <= 3) return { t: 'swap', from: 'discard', i: pick(liveIdx(grid), rng) };
    return { t: 'draw' };
  }
  if (view.stage === 'drawn') {
    if (view.drawn <= 3) return { t: 'swap', from: 'drawn', i: pick(liveIdx(grid), rng) };
    return { t: 'discard' };
  }
  return { t: 'flip', i: pick(hiddenIdx(grid), rng) };
}

// ---------- Mittel ----------
// Wie oft jeder Wert (-2..12) noch unbekannt ist (Stapel, verdeckte Karten, vergrabene Ablage)
function unseen(view) {
  const c = [];
  for (let v = M.MIN_VALUE; v <= M.MAX_VALUE; v++) c.push(M.countOf(v));
  const dec = (v) => { if (M.isValue(v)) c[v - M.MIN_VALUE] = Math.max(0, c[v - M.MIN_VALUE] - 1); };
  for (const p of view.players) {
    for (const x of p.grid) if (x && x.up) dec(x.v);
    for (const v of p.gone) { dec(v); dec(v); dec(v); }
  }
  dec(view.top);
  if (view.drawn !== null) dec(view.drawn);
  return c;
}

function stats(view) {
  const c = unseen(view);
  const tot = c.reduce((a, b) => a + b, 0) || 1;
  let E = 0;
  c.forEach((k, i) => { E += (k * (i + M.MIN_VALUE)) / tot; });
  const prob = (v) => (M.isValue(v) ? c[v - M.MIN_VALUE] / tot : 0);
  return { c, tot, E, prob };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Erwartete Endpunkte der anderen (bekannte Karten + Erwartungswert für jede verdeckte)
function othersEstimate(view, E) {
  let min = Infinity;
  let maxHid = 0;
  view.players.forEach((p, i) => {
    if (i === view.idx) return;
    let s = 0;
    let h = 0;
    for (const x of p.grid) { if (!x) continue; if (x.up) s += x.v; else { s += E; h += 1; } }
    if (s < min) min = s;
    if (h > maxHid) maxHid = h;
  });
  return { min, maxHid };
}

// Kosten, wenn ich die Runde jetzt mit `mine` Punkten beende (Verdoppelung unwahrscheinlich gewollt)
function finishCost(view, mine, st) {
  const o = othersEstimate(view, st.E);
  if (!isFinite(o.min)) return 0;
  const sd = 2 + 1.2 * Math.sqrt(o.maxHid);
  const pOk = sigmoid((o.min - mine - 0.5) / sd);
  const dbl = view.double ? (1 - pOk) * Math.max(0, mine) : (1 - pOk) * 1.0;
  return dbl - pOk * 1.0;
}

// Wert, wenn Karte x an Stelle i gelegt wird (positiv = gut, in Punkten)
function placementNet(view, i, x, st) {
  const grid = view.players[view.idx].grid;
  const col = i % M.COLS;
  const others = M.colCells(col).filter((j) => j !== i).map((j) => grid[j]);
  const cell = grid[i];
  const cur = cell.up ? cell.v : st.E;
  let gain;
  const triple = others[0].up && others[1].up && others[0].v === x && others[1].v === x;
  if (triple) gain = cur + 2 * x;
  else gain = cur - x;
  const pot = (v) => 0.6 * st.prob(v) * 3 * v;
  const upSame = others.filter((z) => z.up && z.v === x).length;
  const hid = others.filter((z) => !z.up).length;
  if (!triple && upSame === 1 && hid === 1) gain += pot(x);
  if (cell.up && x !== cell.v) {
    const pair = others.filter((z) => z.up && z.v === cell.v).length;
    if (pair === 1 && hid === 1) gain -= pot(cell.v);
  }
  // Beendet dieser Zug die Runde?
  const hidAfter = grid.filter((z) => z && !z.up).length - (cell.up ? 0 : 1);
  if (hidAfter === 0) {
    const vals = grid.map((z) => (z ? z.v : null));
    vals[i] = x;
    const cs = M.colCells(col).map((j) => vals[j]);
    if (cs.every((v) => v === cs[0])) cs.forEach((_, k) => { vals[M.colCells(col)[k]] = 0; });
    const mine = vals.reduce((a, v) => a + (v === null ? 0 : v), 0);
    gain -= finishCost(view, mine, st);
  }
  return gain;
}

function bestPlacement(view, x, st, rng) {
  const grid = view.players[view.idx].grid;
  let best = -Infinity;
  let list = [];
  for (const i of liveIdx(grid)) {
    const n = placementNet(view, i, x, st);
    if (n > best + 1e-9) { best = n; list = [i]; } else if (Math.abs(n - best) <= 1e-9) list.push(i);
  }
  return { net: best, i: pick(list, rng) };
}

// Wert, wenn ich die gezogene Karte ablege und eine verdeckte aufdecke
function flipNet(view, st) {
  const grid = view.players[view.idx].grid;
  const hid = hiddenIdx(grid);
  if (hid.length !== 1) return 0;
  const known = grid.reduce((a, z) => a + (z && z.up ? z.v : 0), 0);
  return -finishCost(view, known + st.E, st);
}

function flipChoice(view, st, rng) {
  const grid = view.players[view.idx].grid;
  let best = -Infinity;
  let pickI = -1;
  for (const i of hiddenIdx(grid)) {
    const others = M.colCells(i % M.COLS).filter((j) => j !== i).map((j) => grid[j]);
    let s = rng() * 0.1;
    if (others[0].up && others[1].up && others[0].v === others[1].v) s += 0.6 * st.prob(others[0].v) * 3 * others[0].v;
    if (s > best) { best = s; pickI = i; }
  }
  return { t: 'flip', i: pickI };
}

function mid(view, rng) {
  const st = stats(view);
  if (rng() < RANDOM_MID) return pick(legalMoves(view), rng);
  if (view.stage === 'flip') return flipChoice(view, st, rng);
  if (view.stage === 'drawn') {
    const bp = bestPlacement(view, view.drawn, st, rng);
    if (bp.net > flipNet(view, st)) return { t: 'swap', from: 'drawn', i: bp.i };
    return { t: 'discard' };
  }
  // Anfang des Zuges: Ablage nehmen oder ziehen?
  const take = bestPlacement(view, view.top, st, rng);
  let ev = 0;
  const fl = flipNet(view, st);
  for (let v = M.MIN_VALUE; v <= M.MAX_VALUE; v++) {
    const p = st.c[v - M.MIN_VALUE] / st.tot;
    if (!p) continue;
    const sub = { ...view, drawn: v };
    ev += p * Math.max(bestPlacement(sub, v, stats(sub), () => 0).net, fl);
  }
  if (take.net > ev && view.deckLen >= 0) return { t: 'swap', from: 'discard', i: take.i };
  return { t: 'draw' };
}

// Wählt die nächste Nachricht für den Computer (oder null, wenn er nichts tun muss).
export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.game !== M.GAME) return null;
  const idx = g.players.findIndex((p) => p.id === botId);
  if (idx < 0) return null;
  const view = makeView(g, idx);
  const grid = view.players[idx].grid;
  if (g.phase === 'reveal') {
    if (grid.filter((c) => c && c.up).length >= 2) return null;
    return { t: 'reveal', i: pick(hiddenIdx(grid), rng) };
  }
  if (g.phase !== 'play' || g.active !== idx) return null;
  return level <= 0 ? easy(view, rng) : mid(view, rng);
}
