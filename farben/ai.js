// Farbenwürfeln – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
import * as E from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const faceColors = (face) => (face === 'X' ? E.COLORS : [face]);
const faceNums = (face) => (face === '?' ? [1, 2, 3, 4, 5] : [face]);

// Alle möglichen Wahlen (Würfelkombination mit Farbe/Zahl) samt erlaubten Feldgruppen.
function options(state, p) {
  const out = [];
  const cache = new Map();
  const groupsOf = (color, n) => {
    const k = color + n;
    if (!cache.has(k)) cache.set(k, E.legalGroups(p.x, color, n));
    return cache.get(k);
  };
  for (let ci = 0; ci < state.dice.c.length; ci++) {
    if (state.gone.c[ci]) continue;
    for (let ni = 0; ni < state.dice.n.length; ni++) {
      if (state.gone.n[ni]) continue;
      const cf = state.dice.c[ci]; const nf = state.dice.n[ni];
      const cost = (cf === 'X' ? 1 : 0) + (nf === '?' ? 1 : 0);
      if (cost > p.jokers) continue;
      for (const color of faceColors(cf)) {
        for (const num of faceNums(nf)) {
          const groups = groupsOf(color, num);
          if (groups.length) out.push({ ci, ni, color, num, cost, jc: cf === 'X', jn: nf === '?', groups, key: color + num });
        }
      }
    }
  }
  return out;
}

const toMsg = (o, cells) => {
  const m = { t: 'pick', ci: o.ci, ni: o.ni, cells: [...cells] };
  if (o.jc) m.color = o.color;
  if (o.jn) m.num = o.num;
  return m;
};

// Gewichte der Bewertung (per Simulation im Alleinspiel abgestimmt)
export const W = { cw: 1, jk: 4, star: 3, cc: 0.9, ce: 1, base: 0.4, fl: 1, easyTry: 6 };
// ---------- Mittel: Bewertung einer Feldgruppe ----------
function colFill(p, c) { let n = 0; for (const i of E.COL_CELLS[c]) if (p.x[i]) n++; return n; }

function evalGroup(state, p, group, color, ctx) {
  let s = group.length * W.base;
  const perCol = new Map();
  for (const i of group) {
    const c = E.colOf(i);
    perCol.set(c, (perCol.get(c) || 0) + 1);
    if (E.IS_STAR[i]) s += W.star;
  }
  for (const [c, add] of perCol) {
    if (p.colPts[c] !== null) continue;
    const after = ctx.fill[c] + add;
    const pts = state.colTaken[c] ? E.COL_LOW[c] : E.COL_TOP[c];
    if (after === E.ROWS) s += pts + 0.5;
    else s += pts * (add / E.ROWS) * (1 + W.ce * after / E.ROWS) * W.cc;
  }
  const size = E.COLOR_CELLS[color].length;
  if (p.colorPts[color] === null) {
    const after = ctx.prog[color] + group.length;
    const pts = state.colorTaken[color] ? E.COLOR_LOW : E.COLOR_TOP;
    if (after === size) s += pts + 1;
    else s += pts * (group.length / size) * (1 + 3 * after / size) * ctx.cw;
  }
  // Anschluss halten: neue offene Nachbarfelder (nicht schon neben Kreuzen)
  const inG = new Set(group);
  const seen = new Set();
  for (const i of group) {
    for (const n of E.NEIGHBORS[i]) {
      if (p.x[n] || inG.has(n) || seen.has(n)) continue;
      seen.add(n);
      if (!E.NEIGHBORS[n].some((m) => p.x[m])) s += 0.1;
    }
  }
  if (W.fl) {
    for (const i of group) p.x[i] = 1;
    let f = 0;
    for (const c of E.COLORS) f += E.maxRun(p.x, c);
    for (const i of group) p.x[i] = 0;
    s += W.fl * f;
  }
  return s;
}

function makeCtx(p) {
  const ctx = { cw: W.cw, fill: Array.from({ length: E.COLS }, (_, c) => colFill(p, c)), prog: {} };
  for (const c of E.COLORS) ctx.prog[c] = E.colorProgress(p, c);
  return ctx;
}

function chooseMedium(state, p, opts, rng) {
  const ctx = makeCtx(p);
  const bestOf = new Map();
  const scored = opts.map((o) => {
    let b = bestOf.get(o.key);
    if (!b) {
      b = { s: -Infinity, g: null };
      for (const g of o.groups) {
        const s = evalGroup(state, p, g, o.color, ctx) + rng() * 0.35;
        if (s > b.s) { b.s = s; b.g = g; }
      }
      bestOf.set(o.key, b);
    }
    return { o, g: b.g, s: b.s - o.cost * W.jk };
  });
  // kleine Patzer: ab und zu eine zufällige Möglichkeit ohne Joker
  if (rng() < 0.1) {
    const free = scored.filter((x) => x.o.cost === 0);
    const x = pick(free.length ? free : scored, rng);
    return toMsg(x.o, x.g);
  }
  let best = scored[0];
  for (const x of scored) if (x.s > best.s) best = x;
  if (best.s < 0.2) return { t: 'pass' };
  return toMsg(best.o, best.g);
}

function chooseEasy(state, p, opts, rng) {
  if (rng() < 0.25) return { t: 'pass' };
  const free = opts.filter((o) => o.cost === 0);
  const pool = free.length && rng() > 0.08 ? free : opts;
  const o = pick(pool, rng);
  // Feldgruppe: zufällig, aber unter ein paar Zufallsvorschlägen nimmt er den, der ihm am besten gefällt
  let g = pick(o.groups, rng);
  if (W.easyTry > 1) {
    const ctx = makeCtx(p);
    let bs = evalGroup(state, p, g, o.color, ctx);
    for (let k = 1; k < W.easyTry; k++) {
      const h = pick(o.groups, rng);
      const hs = evalGroup(state, p, h, o.color, ctx);
      if (hs > bs) { bs = hs; g = h; }
    }
  }
  return toMsg(o, g);
}

// Eine Nachricht für die Person botId (roll / pick / pass) oder null, wenn nichts zu tun ist.
export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.mode !== 'play') return null;
  if (state.phase === 'roll') {
    return E.activePlayer(state).id === botId ? { t: 'roll' } : null;
  }
  if (!E.waitingFor(state).includes(botId)) return null;
  const p = E.playerById(state, botId);
  if (!p || !state.dice) return null;
  const opts = options(state, p);
  if (!opts.length) return { t: 'pass' };
  return level >= 1 ? chooseMedium(state, p, opts, rng) : chooseEasy(state, p, opts, rng);
}
