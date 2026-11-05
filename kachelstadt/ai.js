// Kachelstadt – Computergegner (reine Funktionen, kein DOM). Regelzugriff nur über engine.js.
// chooseAction(state, botId, level, rng) -> {t:'place',x,y,r} | {t:'meeple',seg|null} | null
// null = nicht am Zug oder Spiel vorbei. level 0 = Leicht (Zufall), level 1 = Mittel (Bewertung per Simulation).
// Der Zug besteht aus zwei Nachrichten (Phase 'place', danach 'meeple'); Mittel bewertet beide Phasen mit derselben Funktion.
import * as E from './engine.js';

const WEIGHT = 0.75; // Gewicht der Stellungsbewertung gegenüber sofortigen Punkten
const OPP_FACTOR = 0.8; // Punkte, die Gegner durch meinen Zug erhalten, zählen so stark negativ
const MAX_FARMERS = 2;
const FARMER_FROM_PLACED = 11; // erst nach 10 Zügen Bauern
const RANDOM_TOP3 = 0.1;

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const PF = [1, 0.7, 0.5, 0.35, 0.22];

// Lage der Person me an einem Gebilde: +1 allein vorn, 0.5 Gleichstand, -0.5 fremd vorn, 0 niemand
function control(f, me) {
  if (!f.total) return 0;
  let max = 0, leaders = 0;
  for (const p in f.m) { if (f.m[p] > max) { max = f.m[p]; leaders = 1; } else if (f.m[p] === max) leaders++; }
  const mine = f.m[me] || 0;
  if (mine === max) return leaders === 1 ? 1 : 0.5;
  return -0.5;
}

// Erwarteter Endwert eines unfertigen Gebildes (grobe Schätzung)
function ev(an, f, ctx) {
  const hf = Math.min(1, (ctx.deckLeft + 2) / 12);
  const sz = f.tiles.size;
  switch (f.kind) {
    case 'road': {
      const pf = PF[Math.min(f.open, 4)] * hf;
      return pf * (sz + 1.5) + (1 - pf) * sz * 0.6;
    }
    case 'city': {
      const pf = PF[Math.min(Math.ceil(f.open / 3), 4)] * hf;
      return pf * (2 * (sz + 1) + 2 * f.shields) + (1 - pf) * (sz + f.shields) * 0.5;
    }
    case 'monastery': {
      const pf = Math.min(0.9, Math.pow(f.n / 8, 1.5)) * hf;
      return pf * 9 + (1 - pf) * (1 + f.n) * 0.5;
    }
    default: {
      let done = 0, inc = 0;
      for (const r of f.cities) { if (an.feats.get(r).open === 0) done++; else inc++; }
      return 0.8 * (3 * done + 1.2 * inc * hf);
    }
  }
}

// Bewertet ein auf dem Brett liegendes Plättchen (key) samt möglichem Gefolgsmann.
// -> { none:Wert, opts:[{seg,score}] }  (Konstanten, die für alle Alternativen gleich sind, fehlen)
function evaluate(board, key, me, ctx) {
  const an = E.analyzeBoard(board);
  const [x, y] = key.split(',').map(Number);
  const t = board[key];
  const segs = E.TILES[t.t];
  const touched = new Map();
  segs.forEach((s, i) => { if (s.k !== 'field') { const f = an.featureOf(key, i); touched.set(f.root, f); } });
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const nk = (x + dx) + ',' + (y + dy);
    const nt = board[nk];
    if (!nt) continue;
    const si = E.TILES[nt.t].findIndex((s) => s.k === 'monastery');
    if (si >= 0) { const f = an.featureOf(nk, si); touched.set(f.root, f); }
  }
  let imm = 0;
  for (const f of touched.values()) {
    if (f.open !== 0 || !f.total) continue;
    const v = E.featureValue(an, f);
    let max = 0;
    for (const p in f.m) max = Math.max(max, f.m[p]);
    for (const p in f.m) if (f.m[p] === max) imm += +p === me ? v : -OPP_FACTOR * v;
  }
  let H = 0, farmers = 0;
  for (const f of an.feats.values()) {
    if (!f.total) continue;
    if (f.kind !== 'field' && f.open === 0) continue;
    H += control(f, me) * ev(an, f, ctx);
    if (f.kind === 'field') farmers += f.m[me] || 0;
  }
  const base = imm + WEIGHT * H;
  const opts = [];
  if (ctx.hand > 0) {
    const seen = new Set();
    segs.forEach((s, i) => {
      const f = an.featureOf(key, i);
      if (f.total || seen.has(f.root)) return;
      seen.add(f.root);
      if (f.kind !== 'field' && f.open === 0) { opts.push({ seg: i, score: base + E.featureValue(an, f) }); return; }
      if (ctx.hand < 2) return; // mindestens ein Gefolgsmann bleibt in Reserve
      if (f.kind === 'field' && (farmers >= MAX_FARMERS || ctx.placed < FARMER_FROM_PLACED)) return;
      const hf = Math.min(1, (ctx.deckLeft + 2) / 12);
      let cost = (1.2 + 0.5 * (E.MEEPLES - (ctx.hand - 1))) * hf;
      if (f.kind === 'field') cost += 1.5;
      opts.push({ seg: i, score: base + WEIGHT * ev(an, f, ctx) - cost });
    });
  }
  return { none: base, opts };
}

const ctxOf = (state, withTile) => ({
  hand: state.players[state.active].meeples,
  placed: Object.keys(state.board).length + (withTile ? 0 : 1),
  deckLeft: state.deckLeft,
});

function bestOf(list, rng) {
  list.sort((a, b) => b.score - a.score);
  if (list.length > 1 && rng() < RANDOM_TOP3) return list[Math.floor(rng() * Math.min(3, list.length))];
  return list[0];
}

function chooseEasy(state, rng) {
  if (state.phase === 'place') {
    const l = E.legalPlacements(state);
    if (!l.length) return null;
    const m = pick(l, rng);
    return { t: 'place', x: m.x, y: m.y, r: m.r };
  }
  const o = E.meepleOptions(state);
  if (o.length && rng() < 0.25) return { t: 'meeple', seg: pick(o, rng).seg };
  return { t: 'meeple', seg: null };
}

function chooseMedium(state, rng) {
  const me = state.active;
  if (state.phase === 'place') {
    const ctx = ctxOf(state, false);
    const rots = E.uniqueRotations(state.current);
    const cands = [];
    for (const m of E.legalPlacements(state)) {
      if (!rots.includes(m.r)) continue; // gleichwertige Drehungen nur einmal prüfen
      const key = m.x + ',' + m.y;
      const board = Object.assign({}, state.board);
      board[key] = { t: state.current, r: m.r, m: [] };
      const ev0 = evaluate(board, key, me, ctx);
      let best = ev0.none;
      for (const o of ev0.opts) if (o.score > best) best = o.score;
      cands.push({ m, score: best + rng() * 0.05 });
    }
    if (!cands.length) return null;
    const c = bestOf(cands, rng);
    return { t: 'place', x: c.m.x, y: c.m.y, r: c.m.r };
  }
  const options = E.meepleOptions(state);
  if (!options.length) return { t: 'meeple', seg: null };
  const key = state.last.x + ',' + state.last.y;
  const ev0 = evaluate(state.board, key, me, ctxOf(state, true));
  const list = [{ seg: null, score: ev0.none }];
  for (const o of ev0.opts) if (options.some((q) => q.seg === o.seg)) list.push({ seg: o.seg, score: o.score + rng() * 0.05 });
  return { t: 'meeple', seg: bestOf(list, rng).seg };
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== 'ks' || state.phase === 'over') return null;
  const pl = state.players[state.active];
  if (!pl || pl.id !== botId) return null;
  if (state.phase !== 'place' && state.phase !== 'meeple') return null;
  if (level === 0) return chooseEasy(state, rng);
  return chooseMedium(state, rng);
}
