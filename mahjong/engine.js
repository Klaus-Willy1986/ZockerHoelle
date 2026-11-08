// Mahjong-Solitär – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zustand ist reines JSON. Steine werden über ihren Platz (Index in der Brettform) angesprochen.
// kinds[i] = Art des Steins auf Platz i (0..35), -1 = Platz ist leer (Stein abgeräumt).
import { LAYOUTS } from './layouts.js';

export const GAME = 'mj';

// ---------- Steinsatz ----------
// 0–8 Kreise 1–9, 9–17 Stäbe 1–9, 18–26 Zeichen 1–9, 27–30 Winde O S W N, 31–33 Drachen (rot, grün, weiß),
// 34 Blumen (alle 4 gleich), 35 Jahreszeiten (alle 4 gleich).
export const KIND_COUNT = 36;
export const SUITS = ['Kreise', 'Stäbe', 'Zeichen'];
export const WINDS = ['Ost', 'Süd', 'West', 'Nord'];
export const DRAGONS = ['Roter Drache', 'Grüner Drache', 'Weißer Drache'];
export const FLOWER = 34;
export const SEASON = 35;

export function kindInfo(k) {
  if (!Number.isInteger(k) || k < 0 || k >= KIND_COUNT) return null;
  if (k < 27) return { type: 'suit', suit: Math.floor(k / 9), n: (k % 9) + 1, name: `${SUITS[Math.floor(k / 9)]} ${(k % 9) + 1}` };
  if (k < 31) return { type: 'wind', w: k - 27, name: `Wind ${WINDS[k - 27]}` };
  if (k < 34) return { type: 'dragon', d: k - 31, name: DRAGONS[k - 31] };
  return k === FLOWER ? { type: 'flower', name: 'Blume' } : { type: 'season', name: 'Jahreszeit' };
}
export const kindName = (k) => { const i = kindInfo(k); return i ? i.name : '?'; };
// Gleich sind Steine derselben Art; alle Blumen untereinander und alle Jahreszeiten untereinander ebenfalls.
export const sameKind = (a, b) => Number.isInteger(a) && a >= 0 && a === b;

// Alle 144 Steine des Satzes (als Liste von Arten)
export function fullSet() {
  const out = [];
  for (let k = 0; k < KIND_COUNT; k++) for (let c = 0; c < 4; c++) out.push(k);
  return out;
}
// Alle 72 Paare des Satzes (je zwei gleiche Steine)
export function allPairs() {
  const out = [];
  for (let k = 0; k < KIND_COUNT; k++) out.push(k, k);
  return out;
}

// ---------- Geometrie einer Brettform ----------
const geoCache = new Map();
export function geometry(layout) {
  if (geoCache.has(layout)) return geoCache.get(layout);
  const L = LAYOUTS[layout];
  if (!L) return null;
  const geo = geometryFrom(L.tiles, layout);
  geoCache.set(layout, geo);
  return geo;
}
// Nachbarschaften für eine beliebige Liste [Ebene, Spalte, Zeile] (auch für Tests mit handgebauten Brettern)
export function geometryFrom(pos, name = 'eigen') {
  const n = pos.length;
  const under = Array.from({ length: n }, () => []); // under[j]: Plätze, die Platz j direkt oder indirekt verdeckt
  const above = Array.from({ length: n }, () => []); // above[i]: Plätze, die auf Platz i liegen
  const lefts = Array.from({ length: n }, () => []);
  const rights = Array.from({ length: n }, () => []);
  const rightOf = Array.from({ length: n }, () => []); // rightOf[j]: Plätze, für die j der linke Nachbar ist
  const leftOf = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const [zi, xi, yi] = pos[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const [zj, xj, yj] = pos[j];
      if (zj > zi && Math.abs(xj - xi) <= 1 && Math.abs(yj - yi) <= 1) { above[i].push(j); under[j].push(i); }
      if (zj === zi && Math.abs(yj - yi) <= 1) {
        if (xj === xi - 2) { lefts[i].push(j); rightOf[j].push(i); }
        if (xj === xi + 2) { rights[i].push(j); leftOf[j].push(i); }
      }
    }
  }
  // over[i]: alle Plätze, die (auch über mehrere Ebenen hinweg) auf i liegen – als Zeichenkette-Menge für schnellen Test
  const over = Array.from({ length: n }, () => new Set());
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pos[b][0] - pos[a][0]);
  for (const i of order) { for (const j of above[i]) { over[i].add(j); for (const k of over[j]) over[i].add(k); } }
  return { name, n, pos, under, above, over, lefts, rights, rightOf, leftOf };
}

// Größe der Brettform: { cols, rows, levels } in halben Einheiten
export function layoutBounds(layout) {
  const geo = geometry(layout);
  let mx = 0, my = 0, mz = 0;
  for (const [z, x, y] of geo.pos) { mx = Math.max(mx, x + 2); my = Math.max(my, y + 2); mz = Math.max(mz, z); }
  return { cols: mx, rows: my, levels: mz };
}

// ---------- Frei-Regel ----------
// Ein Stein ist frei, wenn kein Stein auf ihm liegt und seine linke oder seine rechte Seite frei ist.
export function isFreeIn(geo, kinds, i) {
  if (!geo || !Array.isArray(kinds) || !Number.isInteger(i) || i < 0 || i >= geo.n || !(kinds[i] >= 0)) return false;
  for (const j of geo.above[i]) if (kinds[j] >= 0) return false;
  let l = false, r = false;
  for (const j of geo.lefts[i]) if (kinds[j] >= 0) { l = true; break; }
  for (const j of geo.rights[i]) if (kinds[j] >= 0) { r = true; break; }
  return !(l && r);
}
export const isFree = (g, i) => !!g && isFreeIn(geometry(g.layout), g.kinds, i);
export function freeTiles(g) {
  const geo = geometry(g.layout);
  const out = [];
  for (let i = 0; i < geo.n; i++) if (isFreeIn(geo, g.kinds, i)) out.push(i);
  return out;
}
export function freePairsIn(geo, kinds) {
  const by = new Map();
  for (let i = 0; i < geo.n; i++) if (isFreeIn(geo, kinds, i)) { const k = kinds[i]; if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  const out = [];
  for (const list of by.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) out.push([list[a], list[b]]);
  return out;
}
export const freePairs = (g) => freePairsIn(geometry(g.layout), g.kinds);
export const stonesLeft = (g) => g.kinds.reduce((n, k) => n + (k >= 0 ? 1 : 0), 0);
// Nichts mehr abzuräumen? Oder: Es ist noch etwas übrig, aber kein Paar mehr möglich.
export const isStuck = (g) => !!g && g.mode === 'play' && stonesLeft(g) > 0 && freePairs(g).length === 0;

// ---------- Erzeuger (Rückwärts-Aufbau) ----------
// Das Brett wird in Gedanken in zufälliger, aber regelgerechter Reihenfolge Paar für Paar abgeräumt (zwei freie Plätze
// nach dem anderen, bis nichts mehr übrig ist). Das erste Paar dieser Reihenfolge bekommt die Art des letzten Aufbau-Schritts
// und so weiter: Die Steinarten werden also in umgekehrter Entfernungsreihenfolge auf die Plätze gelegt.
// Jede so erzeugte Verteilung ist daher lösbar (genau in dieser Reihenfolge).
// positions: verfügbare Plätze (Indizes). Liefert eine Liste von Platzpaaren [[a,b], …] oder null.
export function removalOrder(geo, positions, rng, cap = 4000) {
  const n = geo.n;
  const alive = new Uint8Array(n);
  for (const p of positions) alive[p] = 1;
  const cover = new Int16Array(n), lc = new Int16Array(n), rc = new Int16Array(n);
  for (const i of positions) {
    for (const j of geo.above[i]) if (alive[j]) cover[i]++;
    for (const j of geo.lefts[i]) if (alive[j]) lc[i]++;
    for (const j of geo.rights[i]) if (alive[j]) rc[i]++;
  }
  const isF = (i) => alive[i] === 1 && cover[i] === 0 && (lc[i] === 0 || rc[i] === 0);
  const rem = (i) => { alive[i] = 0; for (const u of geo.under[i]) cover[u]--; for (const r of geo.rightOf[i]) lc[r]--; for (const l of geo.leftOf[i]) rc[l]--; };
  const res = (i) => { alive[i] = 1; for (const u of geo.under[i]) cover[u]++; for (const r of geo.rightOf[i]) lc[r]++; for (const l of geo.leftOf[i]) rc[l]++; };
  let left = positions.length, steps = 0;
  const out = [];
  const dead = new Set();
  const keyOf = () => { let k = ''; for (const p of positions) k += alive[p] ? '1' : '0'; return k; };
  function dfs() {
    if (left === 0) return true;
    if (++steps > cap) return false;
    const fr = [];
    for (const p of positions) if (isF(p)) fr.push(p);
    if (fr.length < 2) return false;
    const key = keyOf();
    if (dead.has(key)) return false;
    const tried = Math.min(fr.length * (fr.length - 1) / 2, 12);
    const seen = new Set();
    for (let t = 0; t < tried * 3 && seen.size < tried; t++) {
      const x = Math.floor(rng() * fr.length);
      let y = Math.floor(rng() * (fr.length - 1)); if (y >= x) y++;
      const a = fr[Math.min(x, y)], b = fr[Math.max(x, y)];
      const id = a * 256 + b;
      if (seen.has(id)) continue;
      seen.add(id);
      rem(a); rem(b); left -= 2;
      out.push([a, b]);
      if (dfs()) return true;
      out.pop(); left += 2; res(b); res(a);
      if (steps > cap) return false;
    }
    dead.add(key);
    return false;
  }
  return dfs() ? out : null;
}

// Verteilt pairKinds (eine Art je Paar) lösbar auf die Plätze. Liefert kinds (Länge geo.n, -1 für unbenutzte Plätze) oder null.
export function generate(geo, positions, pairKinds, rng, tries = 60) {
  if (positions.length !== pairKinds.length * 2) return null;
  for (let t = 0; t < tries; t++) {
    const order = removalOrder(geo, positions, rng);
    if (!order) continue;
    const kinds = new Array(geo.n).fill(-1);
    order.forEach(([a, b], idx) => { kinds[a] = pairKinds[idx]; kinds[b] = pairKinds[idx]; });
    return kinds;
  }
  return null;
}

// ---------- Löser ----------
// Sucht eine vollständige Abräum-Reihenfolge [[a,b], …] für die Steine in kinds. null = keine gefunden.
// limit = höchstens so viele Suchschritte (schützt vor sehr langen Rechnungen); info.aborted zeigt einen Abbruch.
const Z1 = [], Z2 = [];
(function initZobrist() {
  let s = 0x9e3779b9;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  for (let i = 0; i < 256; i++) { Z1.push(next()); Z2.push(next()); }
})();

export function solveKinds(geo, kinds, limit = 3000000, info = {}) {
  // Mehrere Anläufe mit leicht anderer Reihenfolge (Neustarts helfen bei festgefahrenen Suchen);
  // als unlösbar bekannte Zustände bleiben zwischen den Anläufen gespeichert.
  const failed = new Set();
  let total = 0, att = 0;
  const per = Math.min(limit, 2500);
  let rs = 12345;
  const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
  while (total < limit) {
    const inf = {};
    const r = solveOnce(geo, kinds, Math.min(per, limit - total), inf, failed, att === 0 ? 0 : 5 + (att * 7) % 40, rnd);
    total += inf.nodes || 0;
    att++;
    if (r || !inf.aborted) { info.aborted = false; info.nodes = total; info.attempts = att; return r; }
  }
  info.aborted = true; info.nodes = total; info.attempts = att;
  return null;
}

function solveOnce(geo, kinds, limit, info, failed, noise, rnd) {
  const n = geo.n;
  const alive = new Uint8Array(n);
  const cover = new Int16Array(n), lc = new Int16Array(n), rc = new Int16Array(n);
  const remaining = new Int16Array(KIND_COUNT);
  let left = 0;
  for (let i = 0; i < n; i++) if (kinds[i] >= 0) { alive[i] = 1; left++; remaining[kinds[i]]++; }
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    for (const j of geo.above[i]) if (alive[j]) cover[i]++;
    for (const j of geo.lefts[i]) if (alive[j]) lc[i]++;
    for (const j of geo.rights[i]) if (alive[j]) rc[i]++;
  }
  // Gewicht: wie viele andere Steine wegen i festhängen
  const weight = new Int16Array(n);
  for (let i = 0; i < n; i++) weight[i] = geo.under[i].length * 2 + geo.rightOf[i].length + geo.leftOf[i].length + geo.pos[i][0] * 2;
  let h1 = 0, h2 = 0, nodes = 0;
  info.aborted = false;
  const path = [];
  const cnt4 = new Int16Array(KIND_COUNT), tl = new Int16Array(KIND_COUNT * 4);
  const cmp = (a, b) => geo.over[a].has(b) || geo.over[b].has(a); // liegt einer auf dem anderen?
  const onTop = (a, b) => geo.over[b].has(a); // a liegt (auch mittelbar) auf b
  const pairOk = (a, b, c, d) => {
    if (cmp(a, b) || cmp(c, d)) return false;
    const ab_cd = onTop(a, c) || onTop(a, d) || onTop(b, c) || onTop(b, d); // erstes Paar muss vor dem zweiten gehen
    const cd_ab = onTop(c, a) || onTop(c, b) || onTop(d, a) || onTop(d, b);
    return !(ab_cd && cd_ab);
  };
  const isF = (i) => alive[i] === 1 && cover[i] === 0 && (lc[i] === 0 || rc[i] === 0);
  const remove = (i) => {
    alive[i] = 0; left--; remaining[kinds[i]]--;
    h1 ^= Z1[i]; h2 ^= Z2[i];
    for (const u of geo.under[i]) cover[u]--;
    for (const r of geo.rightOf[i]) lc[r]--;
    for (const l of geo.leftOf[i]) rc[l]--;
  };
  const restore = (i) => {
    alive[i] = 1; left++; remaining[kinds[i]]++;
    h1 ^= Z1[i]; h2 ^= Z2[i];
    for (const u of geo.under[i]) cover[u]++;
    for (const r of geo.rightOf[i]) lc[r]++;
    for (const l of geo.leftOf[i]) rc[l]++;
  };
  // Wie viele Steine werden frei, wenn dieses Paar geht? (Mehr ist besser; Gewicht als Zweitkriterium)
  const nb = [];
  function score(a, b) {
    let before = 0, after = 0;
    nb.length = 0;
    for (const i of [a, b]) { for (const u of geo.under[i]) nb.push(u); for (const r of geo.rightOf[i]) nb.push(r); for (const l of geo.leftOf[i]) nb.push(l); }
    for (const i of nb) if (isF(i)) before++;
    remove(a); remove(b);
    for (const i of nb) if (isF(i)) after++;
    restore(b); restore(a);
    return (after - before) * 10 + weight[a] + weight[b];
  }
  function dfs() {
    if (left === 0) return true;
    if (info.aborted) return false;
    if (++nodes > limit) { info.aborted = true; return false; }
    const key = h1 + ':' + h2;
    if (failed.has(key)) return false;
    // Übrige Steine einer Art (2 oder 4): Es muss eine Paarung geben, bei der in keinem Paar einer auf dem anderen liegt
    // und sich die Paare nicht gegenseitig blockieren (sonst ist der Zustand sicher unlösbar).
    for (let k = 0; k < KIND_COUNT; k++) { cnt4[k] = 0; }
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const k = kinds[i];
      if (remaining[k] <= 4) tl[k * 4 + cnt4[k]++] = i;
    }
    for (let k = 0; k < KIND_COUNT; k++) {
      if (cnt4[k] === 2) { if (cmp(tl[k * 4], tl[k * 4 + 1])) { failed.add(key); return false; } }
      else if (cnt4[k] === 4) {
        const t0 = tl[k * 4], t1 = tl[k * 4 + 1], t2 = tl[k * 4 + 2], t3 = tl[k * 4 + 3];
        if (!(pairOk(t0, t1, t2, t3) || pairOk(t0, t2, t1, t3) || pairOk(t0, t3, t1, t2))) { failed.add(key); return false; }
      }
    }
    const by = new Map();
    for (let i = 0; i < n; i++) if (isF(i)) { const k = kinds[i]; let l = by.get(k); if (!l) by.set(k, l = []); l.push(i); }
    const cands = [];
    for (const [k, list] of by) {
      if (list.length < 2) continue;
      if (remaining[k] === list.length) {
        // Alle übrigen Steine dieser Art sind frei: Reihenfolge egal, nimm sie sofort weg (das gibt nur Platz).
        const a = list[0], b = list[1];
        cands.length = 0;
        cands.push([a, b, 1e9]);
        break;
      }
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        cands.push([list[x], list[y], score(list[x], list[y]) + (noise ? rnd() * noise : 0)]);
      }
    }
    if (!cands.length) { failed.add(key); return false; }
    cands.sort((p, q) => q[2] - p[2]);
    for (const [a, b] of cands) {
      remove(a); remove(b);
      path.push([a, b]);
      if (dfs()) return true;
      path.pop();
      restore(b); restore(a);
      if (info.aborted) return false;
    }
    failed.add(key);
    return false;
  }
  const ok = dfs();
  info.nodes = nodes;
  return ok ? path.slice() : null;
}
export const solve = (g, limit, info) => (g && Array.isArray(g.kinds) ? solveKinds(geometry(g.layout), g.kinds, limit, info) : null);

// ---------- Spiel anlegen ----------
export const DEFAULT_OPTS = { small: false, tiny: false, hints: true, free: false, learn: false };
export function normOpts(o) {
  const x = o && typeof o === 'object' ? o : {};
  return {
    small: !!x.small, tiny: !!x.tiny,
    hints: x.hints === undefined ? true : !!x.hints,
    free: !!x.free, learn: !!x.learn,
  };
}
export function layoutOf(opts) {
  const o = normOpts(opts);
  return o.learn ? 'lern' : o.tiny ? 'mauer' : o.small ? 'pyramide' : 'schildkroete';
}
export const layoutName = (key) => (LAYOUTS[key] ? LAYOUTS[key].name : '?');

const seededRng = (s) => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LERN_KINDS = [2, 15, 22, 27, 31, 34]; // sechs verschiedene Paare für das Übungsbrett

function deal(layout, rng) {
  const geo = geometry(layout);
  const positions = Array.from({ length: geo.n }, (_, i) => i);
  let pairKinds;
  if (layout === 'lern') pairKinds = LERN_KINDS.slice();
  else {
    pairKinds = allPairs();
    for (let i = pairKinds.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pairKinds[i], pairKinds[j]] = [pairKinds[j], pairKinds[i]]; }
    pairKinds = pairKinds.slice(0, geo.n / 2);
  }
  const useRng = layout === 'lern' ? seededRng(77) : rng;
  const kinds = generate(geo, positions, pairKinds, useRng);
  return kinds;
}

export function createGame(playerList, opts, rng = Math.random) {
  const o = normOpts(opts);
  const layout = layoutOf(o);
  let kinds = deal(layout, rng);
  for (let t = 0; !kinds && t < 20; t++) kinds = deal(layout, rng);
  if (!kinds) throw new Error('Brett konnte nicht erzeugt werden');
  const list = Array.isArray(playerList) && playerList.length ? playerList : [{ id: 'p0', name: 'Du' }];
  return {
    game: GAME,
    mode: 'play', // 'play' | 'over'
    gid: Math.floor(rng() * 1e9),
    seq: 0,
    players: [{ id: list[0].id, name: list[0].name }],
    opts: o,
    layout,
    kinds,
    hist: [], // ['p', a, b, art] = Paar entfernt; ['m', vorherigeKinds] = gemischt
    hints: 0, mixes: 0, hintN: 0, hint: null,
    elapsed: 0,
    result: null,
  };
}

// ---------- Zeit, Bestzeit ----------
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
// prevAll: bisher beste Zeit (alle Spiele), prevClean: beste Zeit ohne Hilfe (kein Hinweis, kein Mischen). 0/null = keine.
export function settleResult(g, prevAll, prevClean) {
  if (!g || g.mode !== 'over' || !g.result || g.result.record !== null) return null;
  const ms = g.result.ms;
  const pa = Number(prevAll) > 0 ? Number(prevAll) : 0;
  const pc = Number(prevClean) > 0 ? Number(prevClean) : 0;
  const clean = g.result.hints === 0 && g.result.mixes === 0;
  const recordAll = ms > 0 && (pa === 0 || ms < pa);
  const recordClean = clean && ms > 0 && (pc === 0 || ms < pc);
  g.result.record = recordAll;
  g.result.recordClean = recordClean;
  g.result.clean = clean;
  g.result.prev = pa;
  g.result.prevClean = pc;
  return { recordAll, recordClean, best: recordAll ? ms : pa, bestClean: recordClean ? ms : pc };
}

// ---------- Nachrichten ----------
const bad = (error) => ({ ok: false, error });
const MAX_MS = 100 * 3600 * 1000;
function touch(g, ms) {
  if (ms === undefined) return;
  g.elapsed = Math.min(MAX_MS, Math.max(g.elapsed, Math.floor(ms)));
}
const isIdx = (g, i) => Number.isInteger(i) && i >= 0 && i < g.kinds.length;

// Übrige Steine neu verteilen (lösbar, per Rückwärts-Aufbau). Liefert true bei Erfolg.
export function reshuffle(g, rng) {
  const geo = geometry(g.layout);
  const positions = [];
  const kindsLeft = [];
  for (let i = 0; i < geo.n; i++) if (g.kinds[i] >= 0) { positions.push(i); kindsLeft.push(g.kinds[i]); }
  if (positions.length < 2 || positions.length % 2) return false;
  const cnt = new Map();
  for (const k of kindsLeft) cnt.set(k, (cnt.get(k) || 0) + 1);
  const pairs = [];
  for (const [k, c] of cnt) { if (c % 2) return false; for (let x = 0; x < c / 2; x++) pairs.push(k); }
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  const kinds = generate(geo, positions, pairs, rng, 600);
  if (!kinds) return false;
  g.kinds = kinds;
  return true;
}

// apply(g, pid, msg, rng) → { ok:true } | { ok:false, error }. Bei Fehler bleibt der Zustand unverändert.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !Array.isArray(g.kinds)) return bad('Kein Spiel vorhanden.');
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return bad('Unbekannte Eingabe.');
  if (!g.players.some((p) => p.id === pid)) return bad('Du bist in diesem Spiel nicht dabei.');
  if (msg.ms !== undefined && !(typeof msg.ms === 'number' && Number.isFinite(msg.ms) && msg.ms >= 0)) return bad('Ungültige Zeitangabe.');
  if (typeof rng !== 'function') return bad('Zufall fehlt.');

  if (msg.t === 'new') {
    let kinds = null, o = null, layout = null;
    o = normOpts(msg.opts !== undefined ? msg.opts : g.opts);
    layout = layoutOf(o);
    kinds = deal(layout, rng);
    for (let t = 0; !kinds && t < 20; t++) kinds = deal(layout, rng);
    if (!kinds) return bad('Das Brett konnte nicht aufgebaut werden. Bitte versuche es noch einmal.');
    g.opts = o; g.layout = layout; g.kinds = kinds; g.mode = 'play'; g.hist = [];
    g.hints = 0; g.mixes = 0; g.hintN = 0; g.hint = null; g.elapsed = 0; g.result = null; g.seq += 1; g.gid = Math.floor(rng() * 1e9);
    return { ok: true };
  }
  if (g.mode !== 'play') return bad('Dieses Spiel ist schon geschafft.');
  const geo = geometry(g.layout);
  if (!geo) return bad('Ungültiges Brett.');

  switch (msg.t) {
    case 'sync':
      touch(g, msg.ms);
      return { ok: true };
    case 'pair': {
      const { a, b } = msg;
      if (!isIdx(g, a) || !isIdx(g, b) || a === b) return bad('Ungültige Steine.');
      if (g.kinds[a] < 0 || g.kinds[b] < 0) return bad('Dieser Stein ist schon weg.');
      if (!sameKind(g.kinds[a], g.kinds[b])) return bad('Das sind keine gleichen Steine.');
      if (!isFreeIn(geo, g.kinds, a) || !isFreeIn(geo, g.kinds, b)) return bad('Der Stein ist noch eingeklemmt.');
      touch(g, msg.ms);
      const k = g.kinds[a];
      g.kinds[a] = -1; g.kinds[b] = -1;
      g.hist.push(['p', a, b, k]);
      g.hint = null;
      g.seq += 1;
      if (stonesLeft(g) === 0) {
        g.mode = 'over';
        g.result = { ms: g.elapsed, layout: g.layout, hints: g.hints, mixes: g.mixes, record: null, recordClean: null, clean: null, prev: 0, prevClean: 0 };
      }
      return { ok: true };
    }
    case 'undo': {
      if (!g.hist.length) return bad('Es gibt noch nichts zum Zurücknehmen.');
      touch(g, msg.ms);
      const h = g.hist.pop();
      if (h[0] === 'p') { g.kinds[h[1]] = h[3]; g.kinds[h[2]] = h[3]; } else g.kinds = h[1].slice();
      g.hint = null;
      g.seq += 1;
      return { ok: true };
    }
    case 'hint': {
      if (!g.opts.hints) return bad('Hinweise sind ausgeschaltet.');
      const pairs = freePairsIn(geo, g.kinds);
      if (!pairs.length) return bad('Es gibt kein Paar mehr.');
      touch(g, msg.ms);
      g.hint = pairs[Math.floor(rng() * pairs.length) % pairs.length];
      g.hints += 1;
      g.hintN += 1;
      g.seq += 1;
      return { ok: true };
    }
    case 'shuffle': {
      const before = g.kinds.slice();
      if (!reshuffle(g, rng)) { g.kinds = before; return bad('Mischen geht hier leider nicht mehr. Geh mit „Zurück“ ein paar Schritte zurück.'); }
      touch(g, msg.ms);
      g.hist.push(['m', before]);
      g.mixes += 1;
      g.hint = null;
      g.seq += 1;
      return { ok: true };
    }
    default:
      return bad('Unbekannte Eingabe.');
  }
}
