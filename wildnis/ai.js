// Wildnis-Mosaik – Computergegner (reine Funktionen, kein DOM). Regelzugriff nur über engine.js.
// chooseAction(state, botId, level, rng) -> {t:'pick',i} | {t:'free',ti,mi} | {t:'wipe3'} | {t:'tile',q,r,rot} | {t:'token',q,r} | {t:'token',discard:true} | null
// null = nicht am Zug oder Spiel vorbei. Eine Nachricht je Aufruf, phasenweise (choose / tile / token).
// level 0 = Leicht (Zufall, nie Naturmarker, verwirft Marker mit 20 %), level 1 = Mittel (Bewertung, Naturmarker sparsam).
// Es werden nur öffentliche Informationen genutzt (Markt, alle Landschaften); Stapel- und Sackreihenfolge sind tabu.
//
// Mittel: Die Tierwertung hängt nur von den Markern ab, die Lebensraumwertung nur von Plättchen und Drehung. Deshalb wird je Paar
// getrennt bewertet: bester Marker-Platz (bestehende Plättchen) bzw. Marker auf dem neuen Plättchen am Feld, plus Lebensraumwert je
// (Feld, Drehung). Das ist exakt, aber billig (wenige Auswertungen statt Produkt aller Wahlen).
import * as E from './engine.js';

const USE_VALUE = 1.2; // Wert eines gesetzten Markers über seine Punkte hinaus (Züge sind begrenzt)
const NATURE_VALUE = 1.5; // Naturmarker: 1 Punkt + Flexibilität
const FREE_MARGIN = 3.5; // freie Wahl (Naturmarker) nur, wenn sie so viel mehr bringt als das beste normale Paar
const BEAR_POTENTIAL = 1.5; // einzelner Bär mit freiem Nachbarplättchen für einen zweiten Bären
const BONUS_W = 0.7; // Gewicht der geschätzten Lebensraum-Boni
const POW_W = 0.08; // Tie-Breaker: große zusammenhängende Gruppen bevorzugen
const LOW_GAIN = 2.5; // unter diesem Wert eines normalen Zuges lohnt das kostenlose Ersetzen von drei gleichen Markern

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const sumObj = (o) => { let s = 0; for (const k in o) s += o[k]; return s; };
const key = (q, r) => q + ',' + r;

function marketPairs(state) {
  const out = [];
  for (let i = 0; i < 4; i++) if (state.market.tiles[i] !== null && state.market.tokens[i]) out.push(i);
  return out;
}
function hasTriple(tokens) {
  const c = {};
  for (const t of tokens) if (t) c[t] = (c[t] || 0) + 1;
  return Object.values(c).includes(3);
}

// ---------- Leicht ----------
function chooseEasy(state, rng) {
  if (state.phase === 'choose') return { t: 'pick', i: pick(marketPairs(state), rng) };
  if (state.phase === 'tile') {
    const c = pick(E.legalTilePlacements(state), rng);
    return { t: 'tile', q: c.q, r: c.r, rot: Math.min(5, Math.floor(rng() * 6)) };
  }
  const o = E.tokenOptions(state);
  if (!o.length || rng() < 0.2) return { t: 'token', discard: true };
  const c = pick(o, rng);
  return { t: 'token', q: c.q, r: c.r };
}

// ---------- Mittel ----------
// Wert der Tierlage (Punkte + Potenzialschätzung für Bären)
function animalVal(board) {
  let v = sumObj(E.animalScores(board));
  for (const k in board) {
    if (board[k].tok !== 'baer') continue;
    const [q, r] = k.split(',').map(Number);
    let lone = true, open = false;
    for (const n of E.neighbors(q, r)) {
      const c = board[key(n.q, n.r)];
      if (!c) continue;
      if (c.tok === 'baer') lone = false;
      else if (c.tok === null && E.tileDef(c.t).animals.includes('baer')) open = true;
    }
    if (lone && open) v += BEAR_POTENTIAL;
  }
  return v;
}

function habVal(board, oppMax, multi) {
  const st = E.habitatStats(board);
  let v = sumObj(st.max) + POW_W * st.pow;
  if (multi) {
    for (const h of E.HABITATS) {
      const m = st.max[h];
      if (m > oppMax[h]) v += BONUS_W * 3;
      else if (m === oppMax[h] && m > 0) v += BONUS_W;
    }
  }
  return v;
}

function oppMaxOf(state) {
  const best = {};
  for (const h of E.HABITATS) best[h] = 0;
  state.players.forEach((p, i) => {
    if (i === state.active) return;
    const m = E.habitatStats(p.board).max;
    for (const h of E.HABITATS) if (m[h] > best[h]) best[h] = m[h];
  });
  return best;
}

const withCell = (board, k, cell) => { const b = Object.assign({}, board); b[k] = cell; return b; };
const tokGain = (board, A0, k, animal) =>
  animalVal(withCell(board, k, { t: board[k].t, rot: board[k].rot, tok: animal })) - A0 + USE_VALUE + (E.tileDef(board[k].t).key ? NATURE_VALUE : 0);

// bester Plan für das Paar (Plättchen ti, Marker mi): {value, q, r, rot, tok:{q,r}|null}
function planFor(state, ti, mi, ctx, rng) {
  const board = state.players[state.active].board;
  const tileId = state.market.tiles[ti];
  const def = E.tileDef(tileId);
  const animal = state.market.tokens[mi];
  const A0 = animalVal(board);
  let bestOld = { v: 0, tok: null }; // 0 = Marker verwerfen
  for (const s of E.tokenSpots(board, animal)) {
    const v = tokGain(board, A0, key(s.q, s.r), animal) + rng() * 0.02;
    if (v > bestOld.v) bestOld = { v, tok: s };
  }
  const rots = E.uniqueRotations(tileId);
  let best = null;
  for (const c of E.freeCells(board)) {
    const k = key(c.q, c.r);
    let newV = -Infinity;
    if (def.animals.includes(animal)) {
      const b0 = withCell(board, k, { t: tileId, rot: 0, tok: null });
      newV = tokGain(b0, animalVal(b0), k, animal) + rng() * 0.02;
    }
    const useNew = newV > bestOld.v;
    const tokV = useNew ? newV : bestOld.v;
    for (const rot of rots) {
      const hv = habVal(withCell(board, k, { t: tileId, rot, tok: null }), ctx.oppMax, ctx.multi);
      const value = hv + tokV + rng() * 0.01;
      if (!best || value > best.value) best = { value, q: c.q, r: c.r, rot, tok: useNew ? { q: c.q, r: c.r } : bestOld.tok };
    }
  }
  if (best) best.value -= ctx.h0;
  return best;
}

function chooseMedium(state, rng) {
  const me = state.players[state.active];
  const board = me.board;
  const multi = state.players.length > 1;
  const oppMax = multi ? oppMaxOf(state) : null;
  const ctx = { oppMax, multi, h0: habVal(board, oppMax, multi) };

  if (state.phase === 'choose') {
    const pairs = marketPairs(state);
    let bestN = null;
    for (const i of pairs) {
      const p = planFor(state, i, i, ctx, rng);
      if (p && (!bestN || p.value > bestN.value)) bestN = { value: p.value, i };
    }
    const bestVal = bestN ? bestN.value : -Infinity;
    if (!state.usedWipe3 && hasTriple(state.market.tokens) && bestVal < LOW_GAIN) return { t: 'wipe3' };
    if (me.nature >= 1) {
      const margin = E.turnsLeft(state) <= 3 ? 1.5 : FREE_MARGIN; // kurz vor Schluss ist der Marker nur noch 1 Punkt wert
      let bestF = null;
      for (const ti of pairs) for (const mi of pairs) {
        if (ti === mi) continue;
        const p = planFor(state, ti, mi, ctx, rng);
        if (p && (!bestF || p.value > bestF.value)) bestF = { value: p.value, ti, mi };
      }
      if (bestF && bestF.value - NATURE_VALUE > bestVal + margin) return { t: 'free', ti: bestF.ti, mi: bestF.mi };
    }
    return { t: 'pick', i: bestN ? bestN.i : pairs[0] };
  }

  const sel = state.selected;
  if (state.phase === 'tile') {
    const p = planFor(state, sel.ti, sel.mi, ctx, rng);
    return { t: 'tile', q: p.q, r: p.r, rot: p.rot };
  }
  const animal = state.market.tokens[sel.mi];
  const A0 = animalVal(board);
  let best = { v: 0, tok: null };
  for (const s of E.tokenOptions(state)) {
    const v = tokGain(board, A0, key(s.q, s.r), animal) + rng() * 0.02;
    if (v > best.v) best = { v, tok: s };
  }
  return best.tok ? { t: 'token', q: best.tok.q, r: best.tok.r } : { t: 'token', discard: true };
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== 'wm' || state.phase === 'over') return null;
  const pl = state.players[state.active];
  if (!pl || pl.id !== botId) return null;
  if (state.phase !== 'choose' && state.phase !== 'tile' && state.phase !== 'token') return null;
  return level === 0 ? chooseEasy(state, rng) : chooseMedium(state, rng);
}
