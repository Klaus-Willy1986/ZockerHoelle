// Bauernskat – Computergegner (reine Funktionen, keine Oberfläche). Stufen: 0 = Leicht, 1 = Mittel.
//
// Leicht: spielt zufällig eine erlaubte Karte; wählt als Trumpf die Farbe mit den meisten eigenen offenen Karten.
// Mittel: Determinisierung (Perfect-Information-Monte-Carlo). Die KI kennt nur, was auch ein Mensch sieht:
//   alle offenen Karten, die bereits gewonnenen Stiche und den laufenden Stich. Die verdeckten Karten – auch die
//   eigenen! – sind unbekannt. Sie verteilt die unbekannten Karten ~60-mal zufällig auf alle verdeckten Plätze,
//   spielt für jede Kandidatenkarte einfache Greedy-Partien bis zum Rundenende durch und wählt die Karte mit der
//   besten mittleren Augendifferenz. Der Trumpf wird mit denselben Partien bewertet (nur offene Karten bekannt).
// Ehrlichkeit: Die KI arbeitet nur auf einer bereinigten Sicht (viewOf), in der von verdeckten Plätzen nur
//   steht, OB dort eine Karte liegt – nie welche. (Test: tests/bauernskat.ai.test.mjs)
import * as M from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const SAMPLES = 150;
export const BUDGET_MS = 200; // Rechenzeit pro Entscheidung (ein Zeitbudget bricht die Stichproben ab)
const MIN_SAMPLES = 8;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------- Sicht: nur Öffentliches ----------
export function viewOf(g, pid) {
  const me = g.players.findIndex((p) => p.id === pid);
  const ups = g.players.map((p) => p.cols.map((c) => c.up));
  const hid = g.players.map((p) => p.cols.map((c) => c.down !== null)); // nur: liegt dort noch eine verdeckte Karte?
  const known = new Set();
  for (const row of ups) for (const c of row) if (c !== null) known.add(c);
  for (const p of g.players) for (const c of p.won) known.add(c);
  for (const t of g.trick.cards) known.add(t.card);
  const unknown = [];
  for (let c = 0; c < 32; c++) if (!known.has(c)) unknown.push(c);
  return {
    me, trump: g.trump, phase: g.phase, turn: g.turn,
    ups, hid, unknown,
    lead: g.trick.cards.length ? g.trick.cards[0].card : -1,
    points: g.players.map((p) => p.points),
  };
}

// ---------- Tabellen je Trumpf ----------
const TABS = new Map();
function tabFor(trump) {
  const key = trump === 'grand' ? 4 : trump;
  if (TABS.has(key)) return TABS.get(key);
  const fake = { trump };
  const grp = new Int8Array(32), pw = new Int16Array(32), val = new Int8Array(32), cost = new Int16Array(32);
  for (let id = 0; id < 32; id++) {
    grp[id] = M.groupOf(fake, id); pw[id] = M.power(fake, id); val[id] = M.cardValue(id);
    cost[id] = grp[id] === 4 ? 50 + pw[id] : pw[id];
  }
  const t = { grp, pw, val, cost };
  TABS.set(key, t);
  return t;
}

// ---------- Simulation (Greedy-Partie mit voller Information in der gezogenen Welt) ----------
function openCols(u) { const o = []; for (let k = 0; k < 8; k++) if (u[k] >= 0) o.push(k); return o; }

// Antwort auf eine ausgespielte Karte: bester Nettostich, bei Gleichstand die billigste Karte
function follow(t, u, L) {
  const gl = t.grp[L];
  let any = false;
  for (let k = 0; k < 8; k++) if (u[k] >= 0 && t.grp[u[k]] === gl) { any = true; break; }
  let best = -1, bestNet = -1e9, bestCost = 1e9;
  for (let k = 0; k < 8; k++) {
    const x = u[k];
    if (x < 0) continue;
    if (any && t.grp[x] !== gl) continue;
    const win = t.grp[x] === gl ? t.pw[x] > t.pw[L] : t.grp[x] === 4;
    const tot = t.val[L] + t.val[x];
    const net = win ? tot : -tot;
    if (net > bestNet || (net === bestNet && t.cost[x] < bestCost)) { best = k; bestNet = net; bestCost = t.cost[x]; }
  }
  return { col: best, net: bestNet };
}

function lead(t, u, other) {
  let best = -1, bestNet = -1e9, bestCost = 1e9;
  for (let k = 0; k < 8; k++) {
    const x = u[k];
    if (x < 0) continue;
    const r = follow(t, other, x);
    const net = -r.net;
    if (net > bestNet || (net === bestNet && t.cost[x] < bestCost)) { best = k; bestNet = net; bestCost = t.cost[x]; }
  }
  return best;
}

// sim: { u:[Int8Array(8),Int8Array(8)], d:[…], aug:[a,b], turn, lc: Führungskarte|-1, lcol }
function cloneSim(s) {
  return { u: [s.u[0].slice(), s.u[1].slice()], d: [s.d[0].slice(), s.d[1].slice()], aug: [s.aug[0], s.aug[1]], turn: s.turn, lc: s.lc, lcol: s.lcol, left: s.left };
}

function applyMove(t, s, col) {
  const p = s.turn;
  const x = s.u[p][col];
  s.u[p][col] = s.d[p][col]; s.d[p][col] = -1;
  if (s.lc < 0) { s.lc = x; s.lcol = col; s.turn = 1 - p; return; }
  const L = s.lc;
  const win = t.grp[x] === t.grp[L] ? t.pw[x] > t.pw[L] : t.grp[x] === 4;
  const w = win ? p : 1 - p;
  s.aug[w] += t.val[L] + t.val[x];
  s.lc = -1; s.turn = w; s.left -= 1;
}

// Legale Spalten in der Simulation (Bedienpflicht)
function legalOf(t, s) {
  const u = s.u[s.turn];
  if (s.lc < 0) return openCols(u);
  const gl = t.grp[s.lc];
  const f = [];
  for (let k = 0; k < 8; k++) if (u[k] >= 0 && t.grp[u[k]] === gl) f.push(k);
  return f.length ? f : openCols(u);
}

// Die Gegenseite wird als „meistens vernünftig, manchmal zufällig“ angenommen (OPP_NOISE). Eine rein
// perfekte Gegenseite anzunehmen macht die Wahl ängstlich und im Test deutlich schlechter.
export const OPP_NOISE = 0.5;
function runOut(t, s, me, rng) {
  while (s.left > 0) {
    const p = s.turn;
    let col;
    if (p !== me && rng() < OPP_NOISE) { const l = legalOf(t, s); col = l[Math.min(l.length - 1, Math.floor(rng() * l.length))]; }
    else col = s.lc < 0 ? lead(t, s.u[p], s.u[1 - p]) : follow(t, s.u[p], s.lc).col;
    applyMove(t, s, col);
  }
}

// Welt ziehen: unbekannte Karten zufällig auf alle verdeckten Plätze (eigene und fremde) verteilen
function sampleWorld(v, rng, trump) {
  const pool = v.unknown.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rng() * (i + 1))); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const s = { u: [new Int8Array(8), new Int8Array(8)], d: [new Int8Array(8), new Int8Array(8)], aug: [v.points[0], v.points[1]], turn: v.turn, lc: v.lead, lcol: -1, left: 0, trump };
  let n = 0;
  for (let p = 0; p < 2; p++) for (let k = 0; k < 8; k++) {
    s.u[p][k] = v.ups[p][k] === null ? -1 : v.ups[p][k];
    s.d[p][k] = v.hid[p][k] ? pool[n++] : -1;
  }
  // verbleibende Stiche: Karten beider Personen / 2 (ein laufender Stich zählt mit)
  let cards = 0;
  for (let p = 0; p < 2; p++) for (let k = 0; k < 8; k++) { if (s.u[p][k] >= 0) cards++; if (s.d[p][k] >= 0) cards++; }
  s.left = Math.ceil((cards + (v.lead >= 0 ? 1 : 0)) / 2);
  return s;
}

// Bewertung einer durchgespielten Welt: Sieg/Niederlage zählt stark, die Augendifferenz verfeinert
const score = (a, b) => (a > 60 ? 60 : a < 60 && b > 60 ? -60 : 0) + (a - b) * 0.5;

// ---------- Entscheidungen ----------
function pickTrumpEasy(g, me, rng) {
  const n = [0, 0, 0, 0];
  for (const c of g.players[me].cols) if (c.up !== null && M.cardRank(c.up) !== M.RJ) n[M.cardSuit(c.up)] += 1;
  const mx = Math.max(...n);
  return pick([0, 1, 2, 3].filter((s) => n[s] === mx), rng);
}

export function chooseAction(g, botId, level = 0, rng = Math.random, opts = {}) {
  if (!g || g.game !== 'bsk' || (g.phase !== 'trump' && g.phase !== 'play')) return null;
  const me = g.players.findIndex((p) => p.id === botId);
  if (me < 0 || g.turn !== me) return null;
  const samples = opts.samples || SAMPLES;
  const budget = opts.budgetMs === undefined ? BUDGET_MS : opts.budgetMs;

  if (g.phase === 'trump') {
    if (level <= 0) return { t: 'trump', suit: pickTrumpEasy(g, me, rng) };
    const v = viewOf(g, botId);
    const options = [0, 1, 2, 3, 'grand'];
    const sum = [0, 0, 0, 0, 0];
    const t0 = nowMs();
    let done = 0;
    for (let n = 0; n < samples; n++) {
      const w = sampleWorld(v, rng, null);
      options.forEach((o, i) => {
        const s = cloneSim(w);
        const t = tabFor(o);
        runOut(t, s, me, rng);
        sum[i] += score(s.aug[me], s.aug[1 - me]);
      });
      done++;
      if (done >= MIN_SAMPLES && nowMs() - t0 > budget) break;
    }
    let bi = 0;
    for (let i = 1; i < 5; i++) if (sum[i] > sum[bi]) bi = i;
    return { t: 'trump', suit: options[bi] };
  }

  const legal = M.legalCols(g, botId);
  if (!legal.length) return null;
  if (level <= 0 || legal.length === 1) return { t: 'play', col: legal.length === 1 ? legal[0] : pick(legal, rng) };

  const v = viewOf(g, botId);
  const t = tabFor(g.trump);
  const sum = legal.map(() => 0);
  const t0 = nowMs();
  let done = 0;
  for (let n = 0; n < samples; n++) {
    const w = sampleWorld(v, rng, g.trump);
    legal.forEach((col, i) => {
      const s = cloneSim(w);
      applyMove(t, s, col);
      runOut(t, s, me, rng);
      sum[i] += score(s.aug[me], s.aug[1 - me]);
    });
    done++;
    if (done >= MIN_SAMPLES && nowMs() - t0 > budget) break;
  }
  let bi = 0;
  for (let i = 1; i < legal.length; i++) if (sum[i] > sum[bi]) bi = i;
  return { t: 'play', col: legal[bi] };
}
