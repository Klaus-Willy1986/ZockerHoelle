// Wildnis-Mosaik – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Legespiel für 1–4 Personen: Jede Person baut eine eigene Landschaft aus Sechseck-Plättchen und besiedelt sie mit Tieren.
// Zufall nur über `rng` (Mischen/Ziehen). Alle Texte deutsch, Zustand JSON-sicher.
//
// ===== API-Überblick =====
//   HABITATS ['berg','wald','wiese','sumpf','fluss'], ANIMALS ['baer','hirsch','lachs','falke','fuchs'] (+ HABITAT_NAMES / ANIMAL_NAMES zur Anzeige)
//   TILES[id]            85 Beutelplättchen (id 0..84): { id, edges:[6 Lebensräume], animals:[1..3 Tiere], key:bool }
//   START_TILES[i]       15 Startplättchen (id 85..99); START_TRIPLETS = [[85,86,87],...] (5 Dreiergruppen); tileDef(id) liefert beide
//   TILE_SIZE_NOTE       Verteilung siehe unten; START_COORDS = [{q:0,r:0},{q:1,r:0},{q:0,r:1}] (paarweise benachbart)
//   createGame(players:[{id,name}], opts={turns:20}, rng) -> state (1..4 Personen, sonst RangeError)
//   handle(state,pid,msg,rng) -> {ok:true}|{ok:false,error}; Nachrichten:
//        {t:'pick', i}                  Paar i (Plättchen i + Marker i) wählen                      (Phase 'choose')
//        {t:'free', ti, mi}             Variante A: beliebiges Plättchen ti + beliebigen Marker mi, kostet 1 Naturmarker (ti != mi)
//        {t:'wipe', idx:[0..3,...]}     Variante B: Marker an diesen Marktplätzen ersetzen, kostet 1 Naturmarker, 1x pro Zug
//        {t:'wipe3'}                    kostenlos, 1x pro Zug, nur wenn genau 3 gleiche Marker im Markt liegen
//        {t:'tile', q, r, rot}          Plättchen legen (Phase 'tile'), rot 0..5                    -> Phase 'token'
//        {t:'token', q, r} | {t:'token', discard:true}   Marker setzen / verwerfen (Phase 'token') -> Zugende
//   Einzelfunktionen: pickPair, freePick, wipeTokens, wipe3, placeTile, placeToken, discardToken (gleiche Argumente wie die Nachrichten)
//   legalTilePlacements(state) -> [{q,r}] freie Felder neben dem eigenen Gebiet (Phase 'tile'; jede Drehung 0..5 ist erlaubt)
//   freeCells(board) -> [{q,r}]; tokenOptions(state) -> [{q,r}] (Phase 'token'); tokenSpots(board, animal) -> [{q,r}]
//   neighbors(q,r) -> 6 {q,r} in Kantenreihenfolge; edgeNeighbor(q,r,edge); oppositeEdge(e); tileEdges(id,rot) -> 6 Lebensräume (gedreht)
//   score(state,pid) -> {tiere:{baer,hirsch,lachs,falke,fuchs}, lebensraum:{berg,wald,wiese,sumpf,fluss}, bonus, natur, summe}
//   scoreBoard(board) -> {tiere, lebensraum}; animalScores(board); habitatStats(board) -> {max:{h:n}, pow}; ranking(state)
//   tokenBalance(state) -> {sack, markt, brett, summe}  (summe ist immer 100); tileBalance(state)
//   activePlayer(state), turnsLeft(state), boardBounds(board)
//
// ===== Hex-Geometrie & Zeichenhinweise =====
// Axiale Koordinaten (q,r), Pointy-top-Sechsecke. Pixel (Mittelpunkt, Kantenlänge s): x = s*√3*(q + r/2), y = s*1.5*r  (y wächst nach unten).
// Kanten 0..5 laufen im UHRZEIGERSINN ab OBEN-RECHTS. Kante i liegt zwischen den Ecken mit den Winkeln (-90+60i)° und (-30+60i)°
// (Winkel 0° = rechts, positiv = im Uhrzeigersinn, weil y nach unten zeigt); ihre Außennormale zeigt auf (-60+60i)°:
//   Kante 0 = oben rechts (NO)  -> Nachbar (q+1, r-1)       Kante 3 = unten links (SW) -> Nachbar (q-1, r+1)
//   Kante 1 = rechts (O)        -> Nachbar (q+1, r  )       Kante 4 = links (W)        -> Nachbar (q-1, r  )
//   Kante 2 = unten rechts (SO) -> Nachbar (q  , r+1)       Kante 5 = oben links (NW)  -> Nachbar (q  , r-1)
// Gegenkante von e ist (e+3)%6.
// Drehung rot (0..5) = rot*60° im Uhrzeigersinn: Auf Kante e des gelegten Plättchens liegt der Lebensraum def.edges[(e - rot + 6) % 6]
// (tileEdges(id,rot)[e]). Zeichnen: Für jede Kante e ein Dreieck/Keil vom Mittelpunkt zur Kante e in der Farbe tileEdges(id,rot)[e];
// ein Doppelplättchen besteht so aus zwei zusammenhängenden Bögen (z. B. 3+3, 2+4, 1+5). Tiersymbole der erlaubten Tiere (def.animals)
// in der Mitte (1–3 Stück nebeneinander); Schlüsselplättchen (def.key) mit Markierung (ein Tier, gibt beim Besiedeln 1 Naturmarker).
//
// ===== Plättchen (Beutel: 85) =====
// 25 Schlüsselplättchen: je Lebensraum 5 (alle 6 Kanten gleich), jedes mit genau einem Tier; je Lebensraum kommt jedes Tier einmal vor
//   (id = lebensraumindex*5 + tierindex).
// 60 Doppelplättchen: je Lebensraumpaar (10 Paare, a<b in Reihenfolge der Lebensräume) 6 Plättchen mit den Aufteilungen
//   a/b-Kanten = 3/3, 3/3, 2/4, 4/2, 1/5, 5/1 (a belegt die Kanten 0..k-1, b den Rest). 55 Plättchen erlauben 3 Tiere, 5 erlauben 2 Tiere.
//   Jedes Tier ist auf genau 40 Plättchen erlaubt (5 Schlüssel + 35 Doppel).
// 5 Startgruppen (je 3 Plättchen, Drehung 0, Felder START_COORDS): Schlüsselplättchen (Lebensraum i, Tier i), Doppel 3/3 und Doppel 2/4.
//
// ===== Zustand (JSON) =====
// { game:'wm', phase:'choose'|'tile'|'token'|'over', active, turnsPerPlayer,
//   players:[{id,name,board:{"q,r":{t:Plättchen-id,rot,tok:null|Tier}},nature,turns,start}],
//   market:{tiles:[4 ids|null], tokens:[4 Tiere|null]}, bagTiles:[ids] (Reststapel, gezogen wird von hinten), bag:{baer,...:Anzahl},
//   selected:null|{ti,mi,free,placed:null|{q,r}}, usedWipe, usedWipe3, recap:[Texte], result:null|{winners:[ids],ranking}, last:{q,r}|null }
// Während 'tile' liegen Plättchen/Marker der Wahl noch im Markt; beim Legen wird der Plättchenplatz, beim Setzen/Verwerfen der Markerplatz
// leer (null) und am Zugende nachgefüllt. Stapelgröße = turns*n+3 inkl. der 4 Marktplättchen (Standard 20*n+3).
//
// ===== Wertung (Variante A) =====
// Bär: Gruppen aus genau 2 benachbarten Bären; Paare 1/2/3/4+ = 4/11/19/27.
// Hirsch: Zerlegung in gerade Linien. Greedy: immer die längste Linie unter den noch freien Hirschen (Achsen NO-SW, O-W, SO-NW; Gleichstand:
//   erst kleinere Achse, dann kleinstes (q,r) des Linienanfangs), entfernen, wiederholen. Linie 1/2/3/4+ = 2/5/9/13 (auch Einzelhirsche).
// Lachs: zusammenhängende Gruppen, in denen jeder Lachs höchstens 2 Lachs-Nachbarn hat (Dreiecke aus 3 zählen mit); Gruppen mit einem
//   Lachs mit 3+ Lachs-Nachbarn zählen gar nicht. Länge 1..7+ = 2/4/7/11/15/20/26.
// Falke: Falken ohne Falken-Nachbarn; Anzahl 1..8+ = 2/5/8/11/14/18/22/26.
// Fuchs: je Fuchs die Zahl verschiedener Tierarten OHNE Fuchs auf den 6 Nachbarplättchen (maximal 4), 1 Punkt je Art.
// Lebensraum: je Lebensraum die größte Gruppe von Plättchen, die über Kanten mit gleichem Lebensraum auf beiden Seiten zusammenhängen
//   (Plättchen mit zwei Lebensräumen zählen in beiden); Punkte = Plättchenzahl. Bonus (nur bei 2–4 Personen, nur wenn die größte Gruppe > 0):
//   alleinig größte Gruppe +3, bei Gleichstand der größten Gruppen je +1. Naturmarker: je 1 Punkt.
// Sieger: meiste Punkte, dann mehr Naturmarker, sonst geteilter Sieg (gleicher place).

export const HABITATS = ['berg', 'wald', 'wiese', 'sumpf', 'fluss'];
export const ANIMALS = ['baer', 'hirsch', 'lachs', 'falke', 'fuchs'];
export const HABITAT_NAMES = { berg: 'Berg', wald: 'Wald', wiese: 'Wiese', sumpf: 'Sumpf', fluss: 'Fluss' };
export const ANIMAL_NAMES = { baer: 'Bär', hirsch: 'Hirsch', lachs: 'Lachs', falke: 'Falke', fuchs: 'Fuchs' };
export const TOKENS_PER_ANIMAL = 20;
export const DEFAULT_TURNS = 20;
export const MARKET_SIZE = 4;
export const START_COORDS = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }];

// ---------- Plättchenverzeichnis ----------
const SPLITS = [3, 3, 2, 4, 1, 5]; // Kanten des ersten Lebensraums je Doppelplättchen eines Paares
const arc = (a, b, ka) => Array.from({ length: 6 }, (_, i) => (i < ka ? a : b));
function buildAnimalSets() {
  const L = [];
  const triples = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 5; c++) triples.push([a, b, c]);
  for (let k = 0; k < 5; k++) for (const t of triples) L.push(t); // 50 Dreiergruppen
  for (let i = 0; i < 5; i++) L.push([i, (i + 1) % 5, (i + 2) % 5]); // 5 weitere Dreiergruppen
  for (let i = 0; i < 5; i++) L.push([i, (i + 1) % 5]); // 5 Zweiergruppen
  return L; // 60
}
function buildTiles() {
  const tiles = [];
  for (let h = 0; h < 5; h++) {
    for (let k = 0; k < 5; k++) tiles.push({ id: h * 5 + k, edges: arc(HABITATS[h], HABITATS[h], 6), animals: [ANIMALS[k]], key: true });
  }
  const sets = buildAnimalSets();
  let n = 0;
  for (let a = 0; a < 5; a++) {
    for (let b = a + 1; b < 5; b++) {
      for (let j = 0; j < 6; j++, n++) {
        const an = sets[(n * 7) % 60].slice().sort((x, y) => x - y).map((i) => ANIMALS[i]);
        tiles.push({ id: 25 + n, edges: arc(HABITATS[a], HABITATS[b], SPLITS[j]), animals: an, key: false });
      }
    }
  }
  return tiles;
}
function buildStart() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const h = (o) => HABITATS[(i + o) % 5];
    const a = (o) => ANIMALS[(i + o) % 5];
    out.push({ id: 85 + i * 3, edges: arc(h(0), h(0), 6), animals: [a(0)], key: true });
    out.push({ id: 86 + i * 3, edges: arc(h(1), h(2), 3), animals: [a(2), a(3)], key: false });
    out.push({ id: 87 + i * 3, edges: arc(h(3), h(4), 2), animals: [a(4), a(0), a(1)], key: false });
  }
  return out;
}
export const TILES = buildTiles();
export const START_TILES = buildStart();
export const START_TRIPLETS = [0, 1, 2, 3, 4].map((i) => [85 + i * 3, 86 + i * 3, 87 + i * 3]);
const ALL = TILES.concat(START_TILES);
export const tileDef = (id) => ALL[id];

// gedrehte Kanten vorberechnen
const ROTE = ALL.map((t) => Array.from({ length: 6 }, (_, rot) => Array.from({ length: 6 }, (_, e) => t.edges[(e - rot + 6) % 6])));
export const tileEdges = (id, rot) => ROTE[id][((rot % 6) + 6) % 6];
export function uniqueRotations(id) {
  const seen = new Set();
  const out = [];
  for (let r = 0; r < 6; r++) { const s = ROTE[id][r].join(','); if (!seen.has(s)) { seen.add(s); out.push(r); } }
  return out;
}

// ---------- Hex ----------
const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
const keyOf = (q, r) => q + ',' + r;
const parseKey = (k) => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1)]; };
export const oppositeEdge = (e) => (e + 3) % 6;
export const edgeNeighbor = (q, r, e) => ({ q: q + DIRS[e][0], r: r + DIRS[e][1] });
export const neighbors = (q, r) => DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));

export function freeCells(board) {
  const seen = new Set();
  const out = [];
  for (const k of Object.keys(board)) {
    const [q, r] = parseKey(k);
    for (const [dq, dr] of DIRS) {
      const nk = keyOf(q + dq, r + dr);
      if (!board[nk] && !seen.has(nk)) { seen.add(nk); out.push({ q: q + dq, r: r + dr }); }
    }
  }
  return out.sort((a, b) => a.r - b.r || a.q - b.q);
}
export function boardBounds(board) {
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const k of Object.keys(board)) {
    const [q, r] = parseKey(k);
    if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }
  return minQ === Infinity ? { minQ: 0, maxQ: 0, minR: 0, maxR: 0 } : { minQ, maxQ, minR, maxR };
}
export function tokenSpots(board, animal) {
  const out = [];
  for (const k of Object.keys(board)) {
    const c = board[k];
    if (c.tok === null && ALL[c.t].animals.includes(animal)) { const [q, r] = parseKey(k); out.push({ q, r }); }
  }
  return out;
}

// ---------- Wertung ----------
const T_BEAR = [0, 4, 11, 19, 27];
const T_STAG = [0, 2, 5, 9, 13];
const T_SALMON = [0, 2, 4, 7, 11, 15, 20, 26];
const T_HAWK = [0, 2, 5, 8, 11, 14, 18, 22, 26];
const T_FOX = [0, 1, 2, 3, 4, 5];

// größte Lebensraumgruppen: { max:{habitat:n}, pow: Summe aller Gruppengrößen^1.5 (nur Heuristik) }
export function habitatStats(board) {
  const keys = Object.keys(board);
  const idx = new Map();
  keys.forEach((k, i) => idx.set(k, i));
  const n = keys.length;
  const par = {};
  for (const h of HABITATS) { par[h] = new Int32Array(n); for (let i = 0; i < n; i++) par[h][i] = i; }
  const find = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  for (let i = 0; i < n; i++) {
    const [q, r] = parseKey(keys[i]);
    const ea = ROTE[board[keys[i]].t][board[keys[i]].rot];
    for (let e = 0; e < 3; e++) {
      const j = idx.get(keyOf(q + DIRS[e][0], r + DIRS[e][1]));
      if (j === undefined) continue;
      const eb = ROTE[board[keys[j]].t][board[keys[j]].rot];
      if (ea[e] !== eb[e + 3]) continue;
      const p = par[ea[e]];
      const ra = find(p, i), rb = find(p, j);
      if (ra !== rb) p[ra] = rb;
    }
  }
  const max = {};
  let pow = 0;
  for (const h of HABITATS) {
    const cnt = new Map();
    for (let i = 0; i < n; i++) {
      if (!ROTE[board[keys[i]].t][0].includes(h)) continue;
      const rt = find(par[h], i);
      cnt.set(rt, (cnt.get(rt) || 0) + 1);
    }
    let m = 0;
    for (const c of cnt.values()) { if (c > m) m = c; pow += Math.pow(c, 1.5); }
    max[h] = m;
  }
  return { max, pow };
}

export function animalScores(board) {
  const tok = new Map();
  for (const k of Object.keys(board)) if (board[k].tok) tok.set(k, board[k].tok);
  const nb = (k) => { const [q, r] = parseKey(k); return DIRS.map(([dq, dr]) => keyOf(q + dq, r + dr)); };
  const of = (a) => [...tok.keys()].filter((k) => tok.get(k) === a);
  const comps = (cells) => {
    const set = new Set(cells), seen = new Set(), out = [];
    for (const c of cells) {
      if (seen.has(c)) continue;
      const comp = [], st = [c];
      seen.add(c);
      while (st.length) { const x = st.pop(); comp.push(x); for (const y of nb(x)) if (set.has(y) && !seen.has(y)) { seen.add(y); st.push(y); } }
      out.push(comp);
    }
    return out;
  };
  // Bär
  let pairs = 0;
  for (const c of comps(of('baer'))) if (c.length === 2) pairs++;
  const baer = T_BEAR[Math.min(4, pairs)];
  // Hirsch
  const rem = new Set(of('hirsch'));
  let hirsch = 0;
  while (rem.size) {
    let best = null;
    for (let a = 0; a < 3; a++) {
      for (const k of rem) {
        const [q, r] = parseKey(k);
        if (rem.has(keyOf(q - DIRS[a][0], r - DIRS[a][1]))) continue; // kein Linienanfang
        let len = 0, cq = q, cr = r;
        while (rem.has(keyOf(cq, cr))) { len++; cq += DIRS[a][0]; cr += DIRS[a][1]; }
        if (!best || len > best.len || (len === best.len && (a < best.a || (a === best.a && (r < best.r || (r === best.r && q < best.q)))))) best = { len, a, q, r };
      }
    }
    let cq = best.q, cr = best.r;
    for (let i = 0; i < best.len; i++) { rem.delete(keyOf(cq, cr)); cq += DIRS[best.a][0]; cr += DIRS[best.a][1]; }
    hirsch += T_STAG[Math.min(4, best.len)];
  }
  // Lachs
  let lachs = 0;
  const sal = new Set(of('lachs'));
  for (const c of comps([...sal])) {
    if (c.some((k) => nb(k).filter((x) => sal.has(x)).length > 2)) continue;
    lachs += T_SALMON[Math.min(7, c.length)];
  }
  // Falke
  const hawks = new Set(of('falke'));
  let single = 0;
  for (const k of hawks) if (!nb(k).some((x) => hawks.has(x))) single++;
  const falke = T_HAWK[Math.min(8, single)];
  // Fuchs
  let fuchs = 0;
  for (const k of of('fuchs')) {
    const s = new Set();
    for (const x of nb(k)) { const a = tok.get(x); if (a && a !== 'fuchs') s.add(a); }
    fuchs += T_FOX[s.size];
  }
  return { baer, hirsch, lachs, falke, fuchs };
}

export function scoreBoard(board) {
  return { tiere: animalScores(board), lebensraum: habitatStats(board).max };
}

function bonuses(state) {
  const n = state.players.length;
  const out = state.players.map(() => 0);
  if (n < 2) return out;
  const st = state.players.map((p) => habitatStats(p.board).max);
  for (const h of HABITATS) {
    const m = Math.max(...st.map((s) => s[h]));
    if (m <= 0) continue;
    const top = st.map((s, i) => (s[h] === m ? i : -1)).filter((i) => i >= 0);
    for (const i of top) out[i] += top.length === 1 ? 3 : 1;
  }
  return out;
}

export function score(state, pid) {
  const i = state.players.findIndex((p) => p.id === pid);
  if (i < 0) return null;
  const p = state.players[i];
  const { tiere, lebensraum } = scoreBoard(p.board);
  const bonus = bonuses(state)[i];
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { tiere, lebensraum, bonus, natur: p.nature, summe: sum(tiere) + sum(lebensraum) + bonus + p.nature };
}

export function ranking(state) {
  const rows = state.players.map((p, i) => ({ id: p.id, name: p.name, score: score(state, p.id).summe, nature: p.nature, idx: i }));
  rows.sort((a, b) => b.score - a.score || b.nature - a.nature || a.idx - b.idx);
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1].score || r.nature !== rows[i - 1].nature) place = i + 1;
    return { id: r.id, name: r.name, score: r.score, nature: r.nature, place };
  });
}

// ---------- Aufbau ----------
export const activePlayer = (state) => state.players[state.active];
export const turnsLeft = (state, idx = state.active) => state.turnsPerPlayer - state.players[idx].turns;
const rint = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));
function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rng() * (i + 1))); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function drawToken(state, rng) {
  const total = ANIMALS.reduce((s, a) => s + state.bag[a], 0);
  if (!total) return null;
  let x = rint(rng, total);
  for (const a of ANIMALS) { if (x < state.bag[a]) { state.bag[a]--; return a; } x -= state.bag[a]; }
  return null;
}
const sameFour = (m) => m.tokens.every((t) => t && t === m.tokens[0]);
function replaceTokens(state, idxs, rng) {
  const old = idxs.map((i) => state.market.tokens[i]);
  idxs.forEach((i) => { state.market.tokens[i] = drawToken(state, rng); });
  for (const a of old) if (a) state.bag[a]++;
}
function fixOverpopulation(state, rng) {
  for (let g = 0; g < 100 && sameFour(state.market); g++) {
    state.recap.push('Vier gleiche Marker im Markt: Alle werden ersetzt.');
    replaceTokens(state, [0, 1, 2, 3], rng);
  }
}
const tripleIdx = (m) => {
  for (const a of ANIMALS) { const ix = []; m.tokens.forEach((t, i) => { if (t === a) ix.push(i); }); if (ix.length === 3) return ix; }
  return null;
};

export function createGame(players, opts = {}, rng = Math.random) {
  if (!Array.isArray(players) || players.length < 1 || players.length > 4) throw new RangeError('Wildnis-Mosaik braucht 1 bis 4 Personen.');
  const turns = Number.isInteger(opts.turns) && opts.turns > 0 ? opts.turns : DEFAULT_TURNS;
  const n = players.length;
  const bagTiles = shuffle(TILES.map((t) => t.id), rng).slice(0, turns * n + 3);
  const starts = shuffle([0, 1, 2, 3, 4], rng);
  const state = {
    game: 'wm', phase: 'choose', active: 0, turnsPerPlayer: turns,
    players: players.map((p, i) => {
      const board = {};
      START_TRIPLETS[starts[i]].forEach((id, j) => { board[keyOf(START_COORDS[j].q, START_COORDS[j].r)] = { t: id, rot: 0, tok: null }; });
      return { id: p.id, name: p.name, board, nature: 0, turns: 0, start: starts[i] };
    }),
    market: { tiles: [], tokens: [] },
    bagTiles, bag: {}, selected: null, usedWipe: false, usedWipe3: false, recap: [], result: null, last: null,
  };
  for (const a of ANIMALS) state.bag[a] = TOKENS_PER_ANIMAL;
  for (let i = 0; i < MARKET_SIZE; i++) {
    state.market.tiles.push(state.bagTiles.length ? state.bagTiles.pop() : null);
    state.market.tokens.push(drawToken(state, rng));
  }
  fixOverpopulation(state, rng);
  state.recap.push(`${state.players[0].name} beginnt.`);
  return state;
}

// ---------- Zug ----------
function check(state, pid, phase) {
  if (!state || state.game !== 'wm') return 'Ungültiger Zustand.';
  if (state.phase === 'over') return 'Das Spiel ist vorbei.';
  if (state.players[state.active].id !== pid) return 'Du bist nicht am Zug.';
  if (state.phase !== phase) {
    return { choose: 'Jetzt wird kein Plättchen gewählt.', tile: 'Jetzt wird kein Plättchen gelegt.', token: 'Jetzt wird kein Marker gesetzt.' }[phase];
  }
  return null;
}
const bad = (error) => ({ ok: false, error });
const isIdx = (x) => Number.isInteger(x) && x >= 0 && x < MARKET_SIZE;

export function pickPair(state, pid, i) {
  const err = check(state, pid, 'choose');
  if (err) return bad(err);
  if (!isIdx(i) || state.market.tiles[i] === null || !state.market.tokens[i]) return bad('Dieses Paar gibt es nicht.');
  state.selected = { ti: i, mi: i, free: false, placed: null };
  state.recap = [];
  state.phase = 'tile';
  return { ok: true };
}

export function freePick(state, pid, ti, mi) {
  const err = check(state, pid, 'choose');
  if (err) return bad(err);
  const me = state.players[state.active];
  if (me.nature < 1) return bad('Kein Naturmarker übrig.');
  if (!isIdx(ti) || !isIdx(mi) || state.market.tiles[ti] === null || !state.market.tokens[mi]) return bad('Ungültige Wahl.');
  if (ti === mi) return bad('Das ist ein normales Paar – dafür braucht man keinen Naturmarker.');
  me.nature--;
  state.selected = { ti, mi, free: true, placed: null };
  state.recap = [`${me.name} setzt einen Naturmarker ein und wählt frei.`];
  state.phase = 'tile';
  return { ok: true };
}

export function wipeTokens(state, pid, idx, rng = Math.random) {
  const err = check(state, pid, 'choose');
  if (err) return bad(err);
  const me = state.players[state.active];
  if (state.usedWipe) return bad('Du hast in diesem Zug schon Marker getauscht.');
  if (me.nature < 1) return bad('Kein Naturmarker übrig.');
  if (!Array.isArray(idx) || !idx.length || idx.length > MARKET_SIZE || !idx.every(isIdx) || new Set(idx).size !== idx.length) return bad('Ungültige Markerwahl.');
  if (idx.some((i) => !state.market.tokens[i])) return bad('Ungültige Markerwahl.');
  me.nature--;
  state.usedWipe = true;
  replaceTokens(state, idx, rng);
  state.recap.push(`${me.name} tauscht ${idx.length} Marker gegen einen Naturmarker.`);
  fixOverpopulation(state, rng);
  return { ok: true };
}

export function wipe3(state, pid, rng = Math.random) {
  const err = check(state, pid, 'choose');
  if (err) return bad(err);
  if (state.usedWipe3) return bad('Das hast du in diesem Zug schon getan.');
  const t = tripleIdx(state.market);
  if (!t) return bad('Es liegen nicht genau drei gleiche Marker im Markt.');
  state.usedWipe3 = true;
  replaceTokens(state, t, rng);
  state.recap.push(`${state.players[state.active].name} ersetzt drei gleiche Marker.`);
  fixOverpopulation(state, rng);
  return { ok: true };
}

export function legalTilePlacements(state) {
  if (!state || state.phase !== 'tile') return [];
  return freeCells(state.players[state.active].board);
}

export function placeTile(state, pid, q, r, rot, rng = Math.random) {
  const err = check(state, pid, 'tile');
  if (err) return bad(err);
  if (!Number.isInteger(q) || !Number.isInteger(r)) return bad('Ungültiges Feld.');
  if (!Number.isInteger(rot) || rot < 0 || rot > 5) return bad('Ungültige Drehung.');
  const me = state.players[state.active];
  if (me.board[keyOf(q, r)]) return bad('Das Feld ist schon belegt.');
  if (!DIRS.some(([dq, dr]) => me.board[keyOf(q + dq, r + dr)])) return bad('Das Plättchen muss an die Landschaft angrenzen.');
  const sel = state.selected;
  me.board[keyOf(q, r)] = { t: state.market.tiles[sel.ti], rot, tok: null };
  state.market.tiles[sel.ti] = null;
  sel.placed = { q, r };
  state.last = { q, r };
  state.phase = 'token';
  state.recap.push(`${me.name} legt ein Plättchen.`);
  if (!tokenOptions(state).length) {
    state.recap.push(`Der Marker (${ANIMAL_NAMES[state.market.tokens[sel.mi]]}) passt nirgends und kommt zurück in den Sack.`);
    giveBack(state);
    endTurn(state, rng);
  }
  return { ok: true };
}

export function tokenOptions(state) {
  if (!state || state.phase !== 'token' || !state.selected) return [];
  return tokenSpots(state.players[state.active].board, state.market.tokens[state.selected.mi]);
}

function giveBack(state) {
  const mi = state.selected.mi;
  state.bag[state.market.tokens[mi]]++;
  state.market.tokens[mi] = null;
}

export function placeToken(state, pid, q, r, rng = Math.random) {
  const err = check(state, pid, 'token');
  if (err) return bad(err);
  if (!Number.isInteger(q) || !Number.isInteger(r)) return bad('Ungültiges Feld.');
  if (!tokenOptions(state).some((o) => o.q === q && o.r === r)) return bad('Dort darf der Marker nicht stehen.');
  const me = state.players[state.active];
  const cell = me.board[keyOf(q, r)];
  const animal = state.market.tokens[state.selected.mi];
  cell.tok = animal;
  state.market.tokens[state.selected.mi] = null;
  state.recap.push(`${me.name} setzt: ${ANIMAL_NAMES[animal]}.`);
  if (ALL[cell.t].key) { me.nature++; state.recap.push(`${me.name} erhält einen Naturmarker.`); }
  endTurn(state, rng);
  return { ok: true };
}

export function discardToken(state, pid, rng = Math.random) {
  const err = check(state, pid, 'token');
  if (err) return bad(err);
  state.recap.push(`${state.players[state.active].name} verwirft den Marker (${ANIMAL_NAMES[state.market.tokens[state.selected.mi]]}).`);
  giveBack(state);
  endTurn(state, rng);
  return { ok: true };
}

function endTurn(state, rng) {
  const me = state.players[state.active];
  const sel = state.selected;
  me.turns++;
  state.market.tiles[sel.ti] = state.bagTiles.length ? state.bagTiles.pop() : null;
  state.market.tokens[sel.mi] = drawToken(state, rng);
  fixOverpopulation(state, rng);
  state.selected = null;
  if (state.players.every((p) => p.turns >= state.turnsPerPlayer)) { finishGame(state); return; }
  state.active = (state.active + 1) % state.players.length;
  state.usedWipe = false;
  state.usedWipe3 = false;
  state.phase = 'choose';
  // Hat jemand weniger Züge (nur bei Sonderzuständen), wird übersprungen
  for (let g = 0; g < state.players.length && state.players[state.active].turns >= state.turnsPerPlayer; g++) state.active = (state.active + 1) % state.players.length;
}

function finishGame(state) {
  state.phase = 'over';
  const rank = ranking(state);
  state.result = { winners: rank.filter((r) => r.place === 1).map((r) => r.id), ranking: rank };
  state.recap.push('Das Spiel ist zu Ende.');
}

export function handle(state, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return bad('Ungültige Nachricht.');
  switch (msg.t) {
    case 'pick': return pickPair(state, pid, msg.i);
    case 'free': return freePick(state, pid, msg.ti, msg.mi);
    case 'wipe': return wipeTokens(state, pid, msg.idx, rng);
    case 'wipe3': return wipe3(state, pid, rng);
    case 'tile': return placeTile(state, pid, msg.q, msg.r, msg.rot, rng);
    case 'token': return msg.discard ? discardToken(state, pid, rng) : placeToken(state, pid, msg.q, msg.r, rng);
    default: return bad('Unbekannte Nachricht.');
  }
}

// ---------- Bilanzen (Tests) ----------
export function tokenBalance(state) {
  let sack = 0, markt = 0, brett = 0;
  for (const a of ANIMALS) sack += state.bag[a];
  for (const t of state.market.tokens) if (t) markt++;
  for (const p of state.players) for (const c of Object.values(p.board)) if (c.tok) brett++;
  return { sack, markt, brett, summe: sack + markt + brett };
}
// Plättchen: Stapel + Markt + gelegte Beutelplättchen (ohne Startplättchen) = Startstapel (turns*n+3)
export function tileBalance(state) {
  let placed = 0;
  for (const p of state.players) for (const c of Object.values(p.board)) if (c.t < 85) placed++;
  const market = state.market.tiles.filter((t) => t !== null).length;
  return { stapel: state.bagTiles.length, markt: market, gelegt: placed, summe: state.bagTiles.length + market + placed };
}
