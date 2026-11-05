// Kachelstadt – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Legespiel mit Plättchen, Gefolgsleuten und laufender Wertung. Zufall nur über `rng` (Mischen in createGame).
//
// ===== API-Überblick =====
//   TILES[typ]        Array von Segmenten { k:'city'|'road'|'field'|'monastery', p:[Randpositionen 0..11], shield?, adj? }
//   TILE_COUNTS[typ]  Anzahl im Spiel (Summe 72, inkl. Startplättchen); START_TILE = 'D'
//   createGame(players:[{id,name}], opts={}, rng) -> state (2..5 Personen, sonst Error)
//   legalPlacements(state)            -> [{x,y,r}]   für state.current (nur in Phase 'place')
//   placeTile(state,pid,x,y,r)        -> {ok:true} | {ok:false,error}
//   meepleOptions(state)              -> [{seg,kind}] (nur in Phase 'meeple')
//   placeMeeple(state,pid,seg|null)   -> {ok:true} | {ok:false,error}   (beendet den Zug, wertet, zieht nach)
//   handle(state,pid,msg,rng)         -> msg {t:'place',x,y,r} | {t:'meeple',seg:Zahl|null}
//   ranking(state), featureAt(state,x,y,seg), rotatedSegments(typ,r), boardBounds(state)
//   Hilfen für Oberfläche/Computergegner: activePlayer, analyzeBoard, featureValue, uniqueRotations, edgeKinds
//
// ===== Koordinaten & Plättchen =====
// Brett: state.board["x,y"] = { t:Typ, r:0..3, m:[{p:Spielerindex, seg:Segmentindex}] }; x wächst nach rechts, y nach UNTEN.
// Startplättchen liegt auf "0,0" (r=0). 12 Randpositionen im Uhrzeigersinn: N0 N1 N2 E0 E1 E2 S0 S1 S2 W0 W1 W2
// (Index 0..11; Seite = floor(p/3): 0 oben, 1 rechts, 2 unten, 3 links). Drehung r*90° im Uhrzeigersinn: p -> (p+3r) mod 12.
// `seg` ist IMMER der Index des Segments in TILES[typ] (die Drehung ändert nur die Positionen, nicht den Index);
// rotatedSegments(typ,r)[seg] liefert dasselbe Segment mit gedrehten Positionen (zum Zeichnen). `adj` verweist auf Segmentindizes.
// Positionen auf der Seite: i = p%3 (0..2) läuft im Uhrzeigersinn; Mitte (i=1) ist die Kantenmitte (dort enden Straßen).
//
// ===== Zustand (JSON) =====
// { game:'ks', phase:'place'|'meeple'|'over', players:[{id,name,score,meeples(in der Hand),color}], active, deck:[Typen], deckLeft,
//   current:Typ|null, board, last:{x,y}|null, recap:[Texte des letzten Zuges], result:null|{winners:[ids],ranking}, round (gelegte Plättchen),
//   discarded:[aussortierte Typen] }
// Nach Spielende liegen die Gefolgsleute der Schlusswertung noch auf dem Brett (Bilanz: Brett + Hand = 7).

export const MEEPLES = 7;
export const COLOR_NAMES = ['Schwarz', 'Rot', 'Gelb', 'Grün', 'Blau'];
export const START_TILE = 'D';

const rg = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
const city = (p, shield = false) => (shield ? { k: 'city', p, shield: true } : { k: 'city', p });
const road = (p) => ({ k: 'road', p });
const field = (p, adj) => (adj ? { k: 'field', p, adj } : { k: 'field', p });
const monastery = () => ({ k: 'monastery', p: [] });
const BIG = [0, 1, 2, 3, 4, 5, 9, 10, 11];
const TWO = [0, 1, 2, 9, 10, 11];
const SIDE = [3, 4, 5, 9, 10, 11];

export const TILES = {
  A: [monastery(), road([7]), field([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11])],
  B: [monastery(), field(rg(0, 11))],
  C: [city(rg(0, 11), true)],
  D: [city([0, 1, 2]), road([4, 10]), field([3, 11], [0]), field([5, 6, 7, 8, 9])],
  E: [city([0, 1, 2]), field(rg(3, 11), [0])],
  F: [city(SIDE, true), field([0, 1, 2], [0]), field([6, 7, 8], [0])],
  G: [city(SIDE), field([0, 1, 2], [0]), field([6, 7, 8], [0])],
  H: [city([0, 1, 2]), city([6, 7, 8]), field([3, 4, 5, 9, 10, 11], [0, 1])],
  I: [city([0, 1, 2]), city([3, 4, 5]), field(rg(6, 11), [0, 1])],
  J: [city([0, 1, 2]), road([4, 7]), field([5, 6]), field([3, 8, 9, 10, 11], [0])],
  K: [city([0, 1, 2]), road([10, 7]), field([8, 9]), field([3, 4, 5, 6, 11], [0])],
  L: [city([0, 1, 2]), road([10]), road([4]), road([7]), field([11, 3], [0]), field([9, 8]), field([5, 6])],
  M: [city(TWO, true), field(rg(3, 8), [0])],
  N: [city(TWO), field(rg(3, 8), [0])],
  O: [city(TWO, true), road([4, 7]), field([5, 6]), field([3, 8], [0])],
  P: [city(TWO), road([4, 7]), field([5, 6]), field([3, 8], [0])],
  Q: [city(BIG, true), field([6, 7, 8], [0])],
  R: [city(BIG), field([6, 7, 8], [0])],
  S: [city(BIG, true), road([7]), field([6], [0]), field([8], [0])],
  T: [city(BIG), road([7]), field([6], [0]), field([8], [0])],
  U: [road([1, 7]), field([9, 10, 11, 0, 8]), field([2, 3, 4, 5, 6])],
  V: [road([10, 7]), field([8, 9]), field([0, 1, 2, 3, 4, 5, 6, 11])],
  W: [road([10]), road([4]), road([7]), field([11, 0, 1, 2, 3]), field([5, 6]), field([8, 9])],
  X: [road([1]), road([4]), road([7]), road([10]), field([2, 3]), field([5, 6]), field([8, 9]), field([11, 0])],
};
export const TILE_COUNTS = {
  A: 2, B: 4, C: 1, D: 4, E: 5, F: 2, G: 1, H: 3, I: 2, J: 3, K: 3, L: 3, M: 2, N: 3,
  O: 2, P: 3, Q: 1, R: 3, S: 2, T: 1, U: 8, V: 9, W: 4, X: 1,
};
export const TILE_TYPES = Object.keys(TILES);

// ---------- Drehung, Randarten ----------
const ROT = {}; // typ -> [r] -> Segmente
const EDGE = {}; // typ -> [r] -> String(12) aus 'c' (Stadt) 'r' (Straße) 'f' (Wiese)
const POS2SEG = {}; // typ -> [r] -> Array(12) Segmentindex
const UNIQ = {}; // typ -> [r, ...] verschiedene Drehungen
const KCH = { city: 'c', road: 'r', field: 'f' };
for (const t of TILE_TYPES) {
  ROT[t] = []; EDGE[t] = []; POS2SEG[t] = [];
  const sigs = new Set();
  UNIQ[t] = [];
  for (let r = 0; r < 4; r++) {
    const segs = TILES[t].map((s) => {
      const o = { k: s.k, p: s.p.map((p) => (p + 3 * r) % 12) };
      if (s.shield) o.shield = true;
      if (s.adj) o.adj = s.adj.slice();
      return o;
    });
    ROT[t][r] = segs;
    const edge = Array(12).fill('?');
    const pos = Array(12).fill(-1);
    segs.forEach((s, i) => { for (const p of s.p) { edge[p] = KCH[s.k]; pos[p] = i; } });
    EDGE[t][r] = edge.join('');
    POS2SEG[t][r] = pos;
    const sig = segs.map((s) => `${s.k}:${s.p.slice().sort((a, b) => a - b).join(',')}${s.shield ? '*' : ''}`).sort().join('|');
    if (!sigs.has(sig)) { sigs.add(sig); UNIQ[t].push(r); }
  }
}
export function rotatedSegments(type, r) { return ROT[type][((r % 4) + 4) % 4]; }
export function edgeKinds(type, r) { return EDGE[type][((r % 4) + 4) % 4]; }
export function uniqueRotations(type) { return UNIQ[type].slice(); }
// Gegenposition von p auf der Nachbarkante
export const oppositePos = (p) => ((Math.floor(p / 3) + 2) % 4) * 3 + (2 - (p % 3));

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const keyOf = (x, y) => x + ',' + y;
const XY = new Map();
function xy(k) {
  let v = XY.get(k);
  if (!v) { const i = k.indexOf(','); v = [+k.slice(0, i), +k.slice(i + 1)]; XY.set(k, v); }
  return v;
}

function fitsAt(board, t, x, y, r) {
  if (board[keyOf(x, y)]) return false;
  const e = EDGE[t][r];
  let touch = false;
  for (let s = 0; s < 4; s++) {
    const nt = board[keyOf(x + DX[s], y + DY[s])];
    if (!nt) continue;
    touch = true;
    const ne = EDGE[nt.t][nt.r];
    const o = ((s + 2) % 4) * 3;
    for (let i = 0; i < 3; i++) if (e[s * 3 + i] !== ne[o + 2 - i]) return false;
  }
  return touch;
}

export function placementsFor(board, t) {
  const cand = new Map();
  for (const k of Object.keys(board)) {
    const [x, y] = xy(k);
    for (let s = 0; s < 4; s++) {
      const cx = x + DX[s], cy = y + DY[s];
      const ck = keyOf(cx, cy);
      if (!board[ck] && !cand.has(ck)) cand.set(ck, [cx, cy]);
    }
  }
  const list = [...cand.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const [x, y] of list) for (let r = 0; r < 4; r++) if (fitsAt(board, t, x, y, r)) out.push({ x, y, r });
  return out;
}

export function legalPlacements(state) {
  if (!state || state.phase !== 'place' || !state.current) return [];
  return placementsFor(state.board, state.current);
}

// ---------- Analyse (Zusammenhang der Gebilde) ----------
// analyzeBoard(board) -> { feats:Map(root->feature), find(i), base:Map(key->erste Knoten-ID), featureOf(key,seg), nodeKey, nodeSeg }
// feature: { kind, root, nodes:[ID], tiles:Set<key>, shields, open (offene Randpositionen; Kloster: 8-Nachbarn), m:{spielerindex:anzahl}, total,
//            cities:Set<root>|null (nur Wiesen), n (nur Kloster: belegte Nachbarfelder) }
export function analyzeBoard(board) {
  const keys = Object.keys(board);
  const base = new Map();
  let n = 0;
  for (const k of keys) { base.set(k, n); n += TILES[board[k].t].length; }
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const nodeKey = new Array(n);
  const nodeSeg = new Int8Array(n);
  for (const k of keys) {
    const b = base.get(k);
    const t = board[k];
    const [x, y] = xy(k);
    const pos = POS2SEG[t.t][t.r];
    const nsegs = TILES[t.t].length;
    for (let s = 0; s < nsegs; s++) { nodeKey[b + s] = k; nodeSeg[b + s] = s; }
    for (let side = 1; side <= 2; side++) {
      const nk = keyOf(x + DX[side], y + DY[side]);
      const nb = base.get(nk);
      if (nb === undefined) continue;
      const nt = board[nk];
      const npos = POS2SEG[nt.t][nt.r];
      const o = ((side + 2) % 4) * 3;
      for (let i = 0; i < 3; i++) {
        const a = pos[side * 3 + i], c = npos[o + 2 - i];
        if (a < 0 || c < 0) continue;
        if (TILES[t.t][a].k !== TILES[nt.t][c].k) continue;
        const ra = find(b + a), rc = find(nb + c);
        if (ra !== rc) par[ra] = rc;
      }
    }
  }
  const feats = new Map();
  for (const k of keys) {
    const b = base.get(k);
    const t = board[k];
    const segs = TILES[t.t];
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      const id = b + s;
      const root = seg.k === 'monastery' ? id : find(id);
      let f = feats.get(root);
      if (!f) {
        f = { kind: seg.k, root, nodes: [], tiles: new Set(), shields: 0, open: 0, m: {}, total: 0, cities: null, n: 0 };
        if (seg.k === 'field') f.cities = new Set();
        feats.set(root, f);
      }
      f.nodes.push(id);
      f.tiles.add(k);
      if (seg.shield) f.shields++;
      if (seg.k === 'field' && seg.adj) for (const a of seg.adj) f.cities.add(find(b + a));
      if (seg.k === 'monastery') {
        const [x, y] = xy(k);
        let c = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const nk = keyOf(x + dx, y + dy);
          if (board[nk]) { c++; f.tiles.add(nk); }
        }
        f.n = c; f.open = 8 - c;
      }
    }
    const [x, y] = xy(k);
    const pos = POS2SEG[t.t][t.r];
    for (let side = 0; side < 4; side++) {
      if (board[keyOf(x + DX[side], y + DY[side])]) continue;
      for (let i = 0; i < 3; i++) {
        const s = pos[side * 3 + i];
        if (s >= 0) feats.get(find(b + s)).open++;
      }
    }
    for (const mm of t.m) {
      const f = feats.get(segs[mm.seg].k === 'monastery' ? b + mm.seg : find(b + mm.seg));
      f.m[mm.p] = (f.m[mm.p] || 0) + 1;
      f.total++;
    }
  }
  return {
    feats, find, base, nodeKey, nodeSeg,
    featureOf(key, seg) {
      const b = base.get(key);
      if (b === undefined) return null;
      const id = b + seg;
      return feats.get(TILES[board[key].t][seg].k === 'monastery' ? id : find(id));
    },
  };
}

// Wert eines Gebildes: fertig = volle Wertung, sonst Schlusswertung; Wiese: 3 je fertiger Stadt
export function featureValue(an, f) {
  const sz = f.tiles.size;
  switch (f.kind) {
    case 'road': return sz;
    case 'city': return f.open === 0 ? 2 * sz + 2 * f.shields : sz + f.shields;
    case 'monastery': return f.open === 0 ? 9 : 1 + f.n;
    default: {
      let c = 0;
      for (const r of f.cities) if (an.feats.get(r).open === 0) c++;
      return 3 * c;
    }
  }
}

// Anzeige/Tests: Gebilde, zu dem Segment `seg` des Plättchens bei (x,y) gehört
export function featureAt(state, x, y, seg) {
  const k = keyOf(x, y);
  const t = state.board[k];
  if (!t || !TILES[t.t][seg]) return null;
  const an = analyzeBoard(state.board);
  const f = an.featureOf(k, seg);
  const complete = f.kind === 'field' ? false : f.open === 0;
  return {
    kind: f.kind,
    tiles: [...f.tiles].map((q) => { const [a, b] = xy(q); return { x: a, y: b }; }),
    segs: f.nodes.map((id) => { const [a, b] = xy(an.nodeKey[id]); return { x: a, y: b, seg: an.nodeSeg[id] }; }),
    complete, open: f.open, shields: f.shields,
    meeples: Object.keys(f.m).map((p) => ({ p: +p, count: f.m[p] })),
    score: featureValue(an, f),
  };
}

export function boardBounds(state) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k of Object.keys(state.board)) {
    const [x, y] = xy(k);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

// ---------- Spielaufbau ----------
export const activePlayer = (state) => state.players[state.active];

export function createGame(players, opts = {}, rng = Math.random) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 5) throw new RangeError('Kachelstadt braucht 2 bis 5 Personen.');
  const deck = [];
  for (const t of TILE_TYPES) {
    const c = TILE_COUNTS[t] - (t === START_TILE ? 1 : 0);
    for (let i = 0; i < c; i++) deck.push(t);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const state = {
    game: 'ks', phase: 'place',
    players: players.map((p, i) => ({ id: p.id, name: p.name, score: 0, meeples: MEEPLES, color: i })),
    active: 0, deck, deckLeft: deck.length, current: null,
    board: { '0,0': { t: START_TILE, r: 0, m: [] } },
    last: null, recap: [], result: null, round: 0, discarded: [],
  };
  state.recap.push(`${state.players[0].name} beginnt.`);
  if (!draw(state)) finishGame(state);
  return state;
}

// Zieht das nächste legbare Plättchen; unlegbare werden aussortiert. false = Stapel leer.
function draw(state) {
  state.current = null;
  state.phase = 'place';
  while (state.deck.length) {
    const t = state.deck.pop();
    state.deckLeft = state.deck.length;
    if (placementsFor(state.board, t).length) { state.current = t; return true; }
    state.discarded.push(t);
    state.recap.push('Ein Plättchen passt nirgends an und wird aus dem Spiel genommen.');
  }
  state.deckLeft = 0;
  return false;
}

// ---------- Zug ----------
function checkTurn(state, pid, phase) {
  if (!state || state.game !== 'ks') return 'Ungültiger Zustand.';
  if (state.phase === 'over') return 'Das Spiel ist vorbei.';
  if (state.players[state.active].id !== pid) return 'Du bist nicht am Zug.';
  if (state.phase !== phase) return phase === 'place' ? 'Jetzt wird kein Plättchen gelegt.' : 'Jetzt wird kein Gefolgsmann gesetzt.';
  return null;
}

export function placeTile(state, pid, x, y, r) {
  const err = checkTurn(state, pid, 'place');
  if (err) return { ok: false, error: err };
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(r) || r < 0 || r > 3) return { ok: false, error: 'Ungültige Position oder Drehung.' };
  if (!fitsAt(state.board, state.current, x, y, r)) return { ok: false, error: 'Das Plättchen passt dort nicht.' };
  const me = state.players[state.active];
  state.recap = [`${me.name} legt ein Plättchen.`];
  state.board[keyOf(x, y)] = { t: state.current, r, m: [] };
  state.current = null;
  state.last = { x, y };
  state.round++;
  if (computeOptions(state).length) state.phase = 'meeple';
  else endTurn(state);
  return { ok: true };
}

function computeOptions(state) {
  const me = state.players[state.active];
  if (me.meeples <= 0 || !state.last) return [];
  const k = keyOf(state.last.x, state.last.y);
  const t = state.board[k];
  const an = analyzeBoard(state.board);
  const out = [];
  TILES[t.t].forEach((s, i) => {
    const f = an.featureOf(k, i);
    if (f.total === 0) out.push({ seg: i, kind: s.k });
  });
  return out;
}

export function meepleOptions(state) {
  return state && state.phase === 'meeple' ? computeOptions(state) : [];
}

export function placeMeeple(state, pid, seg) {
  const err = checkTurn(state, pid, 'meeple');
  if (err) return { ok: false, error: err };
  if (seg !== null && seg !== undefined) {
    if (!Number.isInteger(seg)) return { ok: false, error: 'Ungültiges Segment.' };
    if (!computeOptions(state).some((o) => o.seg === seg)) return { ok: false, error: 'Dort darf kein Gefolgsmann stehen.' };
    const me = state.players[state.active];
    state.board[keyOf(state.last.x, state.last.y)].m.push({ p: state.active, seg });
    me.meeples--;
    const kind = TILES[state.board[keyOf(state.last.x, state.last.y)].t][seg].k;
    const word = { city: 'in einer Stadt', road: 'an einer Straße', field: 'auf einer Wiese', monastery: 'in einem Kloster' }[kind];
    state.recap.push(`${me.name} setzt einen Gefolgsmann ${word}.`);
  }
  endTurn(state);
  return { ok: true };
}

export function handle(state, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Ungültige Nachricht.' };
  if (msg.t === 'place') return placeTile(state, pid, msg.x, msg.y, msg.r);
  if (msg.t === 'meeple') return placeMeeple(state, pid, msg.seg === undefined ? null : msg.seg);
  return { ok: false, error: 'Unbekannte Nachricht.' };
}

// ---------- Wertung ----------
const KIND_NAME = { road: 'Straße', city: 'Stadt', monastery: 'Kloster', field: 'Wiese' };
const pts = (v) => (v === 1 ? '1 Punkt' : v + ' Punkte');

// Verteilt die Punkte eines Gebildes an die Mehrheit; liefert true, wenn jemand Punkte bekam
function award(state, an, f, final) {
  if (f.total === 0) return false;
  const v = featureValue(an, f);
  let max = 0;
  for (const p of Object.keys(f.m)) max = Math.max(max, f.m[p]);
  const winners = Object.keys(f.m).filter((p) => f.m[p] === max).map(Number).sort((a, b) => a - b);
  if (v <= 0) return false;
  for (const p of winners) state.players[p].score += v;
  const names = winners.map((p) => state.players[p].name);
  const who = names.length === 1 ? `${names[0]} bekommt` : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} bekommen je`;
  state.recap.push(`${final ? 'Schlusswertung ' : ''}${KIND_NAME[f.kind]}${final ? '' : ' fertig'}: ${who} ${pts(v)}.`);
  return true;
}

function endTurn(state) {
  const an = analyzeBoard(state.board);
  const { x, y } = state.last;
  const k = keyOf(x, y);
  const t = state.board[k];
  const touched = new Map();
  TILES[t.t].forEach((s, i) => { if (s.k !== 'field') { const f = an.featureOf(k, i); touched.set(f.root, f); } });
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const nk = keyOf(x + dx, y + dy);
    const nt = state.board[nk];
    if (!nt) continue;
    const si = TILES[nt.t].findIndex((s) => s.k === 'monastery');
    if (si >= 0) { const f = an.featureOf(nk, si); touched.set(f.root, f); }
  }
  const done = new Set();
  for (const f of touched.values()) {
    if (f.open === 0 && f.total > 0) { award(state, an, f, false); done.add(f.root); }
  }
  if (done.size) {
    const back = {};
    for (const bk of Object.keys(state.board)) {
      const bt = state.board[bk];
      if (!bt.m.length) continue;
      const b = an.base.get(bk);
      bt.m = bt.m.filter((mm) => {
        const f = an.featureOf(bk, mm.seg);
        if (!done.has(f.root)) return true;
        state.players[mm.p].meeples++;
        back[mm.p] = (back[mm.p] || 0) + 1;
        return false;
      });
    }
    const parts = Object.keys(back).map((p) => `${state.players[p].name} ${back[p]}`);
    state.recap.push(`Gefolgsleute kehren zurück: ${parts.join(', ')}.`);
  }
  state.active = (state.active + 1) % state.players.length;
  if (!draw(state)) finishGame(state);
}

function finishGame(state) {
  state.phase = 'over';
  state.current = null;
  const an = analyzeBoard(state.board);
  for (const f of an.feats.values()) award(state, an, f, true);
  const rank = ranking(state);
  state.result = { winners: rank.filter((r) => r.place === 1).map((r) => r.id), ranking: rank };
  state.recap.push('Das Spiel ist zu Ende.');
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
