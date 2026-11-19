// Waldleben – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Karten sind Nummern (siehe cards.js). Alle Zustände sind reines JSON.
//
// Aufbau eines Zustands g:
//   players[i] = { id, name, hand:[Nr], trees:[{ sp, id, sides:[Nr|null ×4] }], cave:[Nr] }
//     sides: 0 oben, 1 unten, 2 links, 3 rechts; sp = Baumart 0..5, -1 = Sprössling (id = -1: verdeckt, Art unbekannt)
//   deck (Ende = oben), clearing (Lichtung, offen), discard (Ablage), winters (0..3), winterOut
//   active, drawLeft (noch zu ziehende Karten in einer Zieh-Aktion), extra (Extrazug folgt), phase 'play' | 'over'
import { CARDS, SPECIES, TOTAL, N_TREES, WINTER_FIRST, WINTER_IDS, isId, count, lifeCards, cardPoints, explainPoints, hasDauer, ptsText, fxText } from './cards.js';

export { CARDS, SPECIES };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const HAND_START = 5;
export const LICHTUNG_START = 3;
export const HAND_LIMIT = 10;
export const LICHTUNG_MAX = 10; // ab 10 Karten wird die Lichtung geleert
// So viele Karten (ohne die 3 Winterkarten) sind im Stapel-Spiel, je nach Personenzahl; Kurzspiel = 60 %.
export const DEFAULT_DECK = { 2: 60, 3: 80, 4: 96, 5: 113 };
export const defaultDeck = (n, short = false) => { const b = DEFAULT_DECK[n] || 113; return short ? Math.round(b * 0.6) : b; };
export const MAX_TURNS = 600; // Notbremse gegen Endlosspiele
const RECAP_MAX = 8;
export const SIDE_NAMES = ['oben', 'unten', 'links', 'rechts'];

export const cardName = (id) => CARDS[id].name;
export const sideName = (s) => SIDE_NAMES[s];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
const handHas = (p, id) => p.hand.includes(id);
const dropFrom = (arr, id) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); return i >= 0; };

function pushRecap(g, line) {
  g.recap.unshift(line);
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

// ---------- Regeln rund um Hand und Ziehen ----------
export const handLimit = (p) => HAND_LIMIT + (hasDauer(p, 'hand12') ? 2 : 0);
export const passBonus = (p) => (hasDauer(p, 'pass2') ? 2 : 1);
export const drawBase = (p) => 2 + (hasDauer(p, 'draw3') ? 1 : 0);
export const freeSlots = (p) => p.trees.reduce((n, t) => n + t.sides.filter((s) => s === null).length, 0);
export const treeFree = (t) => t.sides.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0);

// Wie viele Karten muss die aktive Person in dieser Zieh-Aktion noch ziehen? (0 = es läuft keine)
export function drawNeed(g, p) {
  if (g.drawLeft > 0) return g.drawLeft;
  return Math.max(0, Math.min(drawBase(p), handLimit(p) - p.hand.length));
}
export const canDrawNow = (g, p) => g.phase === 'play' && drawNeed(g, p) > 0;

// Kann diese Handkarte als sie selbst gespielt werden (Baum immer; Tier/Pflanze/Pilz: bezahlbar und freier Platz)?
export function canPlayAsSelf(g, p, id) {
  if (!isId(id) || !handHas(p, id)) return false;
  const c = CARDS[id];
  if (c.kind === 'tree') return true;
  if (c.kind !== 'life') return false;
  return p.hand.length - 1 >= c.cost && freeSlots(p) > 0;
}

// ---------- Aufbau ----------
export function createGame(playerList, opts = {}, rng = Math.random, hostId = null) {
  if (!Array.isArray(playerList) || playerList.length < MIN_PLAYERS || playerList.length > MAX_PLAYERS) {
    throw new Error('Waldleben braucht 2 bis 5 Personen.');
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  const n = playerList.length;
  let pool = shuffle(Array.from({ length: WINTER_FIRST }, (_, i) => i), rng);
  const minDeck = n * HAND_START + LICHTUNG_START + 12;
  let size = defaultDeck(n, !!o.short);
  if (Number.isInteger(o.deck)) size = o.deck;
  size = Math.max(minDeck, Math.min(WINTER_FIRST, size));
  pool = pool.slice(0, size);
  const players = playerList.map((p) => ({ id: String(p.id), name: String(p.name), hand: [], trees: [], cave: [] }));
  for (const p of players) for (let i = 0; i < HAND_START; i++) p.hand.push(pool.pop());
  const clearing = [];
  for (let i = 0; i < LICHTUNG_START; i++) clearing.push(pool.pop());
  // Die 3 Winterkarten werden ins untere Drittel des Stapels gemischt (Ende der Liste = oben).
  const k = Math.ceil(pool.length / 3);
  const bottom = shuffle(pool.slice(0, k).concat(WINTER_IDS), rng);
  const deck = bottom.concat(pool.slice(k));
  const g = {
    game: 'wl',
    gid: Math.floor(rng() * 1e9),
    opts: { hints: !!o.hints, short: !!o.short, deck: size },
    hostId: hostId === null || hostId === undefined ? String(playerList[0].id) : String(hostId),
    players, deck, clearing, discard: [],
    winters: 0, winterOut: 0,
    active: 0, drawLeft: 0, extra: false, turns: 0, turnDraws: [],
    phase: 'play', result: null, recap: [], last: null,
  };
  pushRecap(g, `${players[0].name} beginnt.`);
  return g;
}

// ---------- Wertung ----------
export function score(g, p) {
  const out = { total: 0, trees: [], cave: p.cave.length, lifeCount: 0 };
  p.trees.forEach((t, i) => {
    const row = { i, sp: t.sp, cards: [], sum: 0 };
    t.sides.forEach((id, side) => {
      if (id === null) return;
      const c = CARDS[id];
      const pts = cardPoints(p, c);
      row.cards.push({ side, id, pts, how: explainPoints(p, c) });
      row.sum += pts;
      out.lifeCount += 1;
    });
    out.trees.push(row);
    out.total += row.sum;
  });
  out.total += out.cave;
  return out;
}
export const pointsOf = (g, p) => score(g, p).total;

// Rangliste: meiste Punkte zuerst, Gleichstand teilt den Rang.
export function ranking(g) {
  const rows = g.players.map((p, idx) => ({ id: p.id, name: p.name, idx, points: score(g, p).total, cave: p.cave.length, cards: lifeCards(p).length }));
  rows.sort((a, b) => b.points - a.points || a.idx - b.idx);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1; });
  return rows;
}

function finish(g, why) {
  if (g.phase === 'over') return;
  g.phase = 'over';
  g.drawLeft = 0;
  const r = ranking(g);
  const best = r[0].points;
  g.result = { why, winners: r.filter((x) => x.points === best).map((x) => x.id) };
  const text = why === 'winter' ? '❄️ Die dritte Winterkarte ist da: Das Spiel ist zu Ende!' : 'Das Spiel ist zu Ende (zu viele Züge).';
  pushRecap(g, text);
  g.last = { kind: 'over', pid: null, name: '', text };
}

// ---------- Stapel und Lichtung ----------
function revealWinter(g) {
  g.winters += 1;
  g.winterOut += 1;
  const text = g.winters >= 3 ? '❄️ Dritte Winterkarte aufgedeckt!' : `❄️ Winterkarte ${g.winters} von 3 aufgedeckt. Der Winter rückt näher.`;
  if (g.winters < 3) { pushRecap(g, text); g.last = { kind: 'winter', pid: null, name: '', text, n: g.winters }; }
  if (g.winters >= 3) finish(g, 'winter');
}

// Oberste Karte vom Stapel (Winterkarten werden aufgedeckt und zählen). -1 = keine Karte (Stapel leer oder Spielende).
function pullDeck(g, rng) {
  for (let guard = 0; guard < 8; guard++) {
    if (g.phase === 'over') return -1;
    if (!g.deck.length) {
      if (!g.discard.length) return -1;
      g.deck = shuffle(g.discard.splice(0), rng);
    }
    const id = g.deck.pop();
    if (CARDS[id].kind === 'winter') { revealWinter(g); continue; }
    return id;
  }
  return -1;
}

function revealToClearing(g, rng) {
  const id = pullDeck(g, rng);
  if (id >= 0) g.clearing.push(id);
  return id;
}

// Lichtung prüfen: ab 10 Karten wird sie geleert.
function checkClearing(g) {
  if (g.phase !== 'play') return false;
  if (g.clearing.length >= LICHTUNG_MAX) {
    const n = g.clearing.length;
    g.discard.push(...g.clearing.splice(0));
    pushRecap(g, `Die Lichtung hatte ${n} Karten und wird geleert.`);
    g.last = { kind: 'cleared', pid: null, name: '', text: `Lichtung geleert (${n} Karten).`, n };
    return true;
  }
  return false;
}

function drawUpTo(g, p, n, rng) {
  let got = 0;
  for (let i = 0; i < n && p.hand.length < handLimit(p); i++) {
    const id = pullDeck(g, rng);
    if (id < 0) break;
    p.hand.push(id);
    got += 1;
  }
  return got;
}

function endTurn(g) {
  if (g.phase !== 'play') return;
  g.turns += 1;
  g.drawLeft = 0;
  g.turnDraws = [];
  if (g.turns >= MAX_TURNS) { finish(g, 'turns'); return; }
  if (g.extra) {
    g.extra = false;
    pushRecap(g, `${g.players[g.active].name} ist gleich noch einmal dran.`);
    return;
  }
  g.active = (g.active + 1) % g.players.length;
}

const kartenWort = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);

// ---------- Aktionen ----------
function doDraw(g, p, msg, rng) {
  const src = msg.src;
  if (src !== 'deck' && src !== 'clearing') return { ok: false, error: 'Unbekannte Quelle.' };
  if (g.drawLeft === 0) {
    const need = drawNeed(g, p);
    if (need <= 0) return { ok: false, error: `Deine Hand ist voll (${handLimit(p)} Karten). Spiele zuerst eine Karte aus.` };
    g.drawLeft = need;
    g.turnDraws = [];
  }
  let id;
  if (src === 'deck') {
    id = pullDeck(g, rng);
    if (g.phase === 'over') { g.drawLeft = 0; return { ok: true, over: true }; }
    if (id < 0) { g.drawLeft = 0; if (!g.turnDraws.length) return { ok: false, error: 'Der Stapel ist leer.' }; id = null; }
    if (id !== null) g.turnDraws.push({ src: 'deck' });
  } else {
    if (!isId(msg.card) || !g.clearing.includes(msg.card)) { if (!g.turnDraws.length) g.drawLeft = 0; return { ok: false, error: 'Diese Karte liegt nicht in der Lichtung.' }; }
    id = msg.card;
    dropFrom(g.clearing, id);
    g.turnDraws.push({ src: 'clearing', id });
  }
  if (id !== null) { p.hand.push(id); g.drawLeft -= 1; }
  if (g.drawLeft <= 0 || id === null) {
    const d = g.turnDraws;
    const fromL = d.filter((x) => x.src === 'clearing');
    const fromD = d.length - fromL.length;
    let text = `${p.name} zieht ${kartenWort(d.length)}`;
    if (fromL.length && fromD) text += ` (${kartenWort(fromD)} vom Stapel, ${fromL.map((x) => cardName(x.id)).join(' und ')} aus der Lichtung)`;
    else if (fromL.length) text += ` aus der Lichtung (${fromL.map((x) => cardName(x.id)).join(', ')})`;
    else text += ' vom Stapel';
    text += '.';
    pushRecap(g, text);
    g.last = { kind: 'draw', pid: p.id, name: p.name, text };
    endTurn(g);
  }
  return { ok: true };
}

function checkHandCard(g, p, id) {
  if (!isId(id)) return 'Diese Karte gibt es nicht.';
  if (!handHas(p, id)) return 'Diese Karte hast du nicht auf der Hand.';
  return null;
}

function doTree(g, p, msg, rng, sprout) {
  const err = checkHandCard(g, p, msg.card);
  if (err) return { ok: false, error: err };
  const c = CARDS[msg.card];
  if (!sprout && c.kind !== 'tree') return { ok: false, error: 'Das ist keine Baumkarte. Tiere, Pflanzen und Pilze legst du an einen Baum an.' };
  dropFrom(p.hand, msg.card);
  let text;
  if (sprout) {
    p.trees.push({ sp: -1, id: -1, sides: [null, null, null, null] });
    text = `${p.name} pflanzt einen Sprössling (verdeckt).`;
  } else {
    p.trees.push({ sp: c.sp, id: c.id, sides: [null, null, null, null] });
    text = `${p.name} pflanzt eine ${c.name}.`;
  }
  const rev = revealToClearing(g, rng);
  if (g.phase === 'over') { pushRecap(g, text); return { ok: true, over: true }; }
  if (rev >= 0) text += ` ${cardName(rev)} kommt in die Lichtung.`;
  pushRecap(g, text);
  g.last = { kind: sprout ? 'sprout' : 'tree', pid: p.id, name: p.name, text };
  checkClearing(g);
  endTurn(g);
  return { ok: true };
}

function doLife(g, p, msg, rng) {
  const err = checkHandCard(g, p, msg.card);
  if (err) return { ok: false, error: err };
  const c = CARDS[msg.card];
  if (c.kind !== 'life') return { ok: false, error: 'Diese Karte kann man nicht an einen Baum anlegen.' };
  const pay = Array.isArray(msg.pay) ? msg.pay : null;
  if (!pay || pay.length !== c.cost) return { ok: false, error: `Diese Karte kostet ${kartenWort(c.cost)}. Bitte wähle genau so viele Karten zum Bezahlen.` };
  const seen = new Set();
  for (const id of pay) {
    if (!isId(id) || !handHas(p, id)) return { ok: false, error: 'Eine Zahlkarte hast du nicht auf der Hand.' };
    if (id === c.id) return { ok: false, error: 'Die Karte kann sich nicht selbst bezahlen.' };
    if (seen.has(id)) return { ok: false, error: 'Eine Karte kann nur einmal bezahlen.' };
    seen.add(id);
  }
  if (!Number.isInteger(msg.tree) || msg.tree < 0 || msg.tree >= p.trees.length) return { ok: false, error: 'Diesen Baum gibt es nicht.' };
  if (!Number.isInteger(msg.side) || msg.side < 0 || msg.side > 3) return { ok: false, error: 'Diese Seite gibt es nicht.' };
  const tree = p.trees[msg.tree];
  if (tree.sides[msg.side] !== null) return { ok: false, error: 'Dieser Platz ist schon besetzt.' };
  // ausführen
  dropFrom(p.hand, c.id);
  for (const id of pay) { dropFrom(p.hand, id); g.clearing.push(id); }
  tree.sides[msg.side] = c.id;
  const passend = c.cost >= 1 && pay.every((id) => CARDS[id].sp === c.sp);
  let text = `${p.name} legt ${c.sym} ${c.name} an einen Baum (${sideName(msg.side)})`;
  text += c.cost ? ` und bezahlt mit ${kartenWort(c.cost)}.` : '.';
  const extra = [];
  const f = c.fx;
  if (f && f.k === 'draw') { const got = drawUpTo(g, p, f.n, rng); extra.push(`zieht ${kartenWort(got)}`); }
  if (f && f.k === 'cave') {
    let put = 0;
    for (let i = 0; i < f.n; i++) { const id = pullDeck(g, rng); if (id < 0) break; p.cave.push(id); put += 1; }
    extra.push(`legt ${kartenWort(put)} in die Höhle`);
  }
  if (f && f.k === 'extra') { g.extra = true; extra.push('bekommt einen Extrazug'); }
  if (g.phase === 'over') { pushRecap(g, text); return { ok: true, over: true, passend }; }
  if (passend) {
    const got = drawUpTo(g, p, passBonus(p), rng);
    extra.push(`bezahlt passend und zieht ${kartenWort(got)}`);
  }
  if (g.phase === 'over') { pushRecap(g, text); return { ok: true, over: true, passend }; }
  if (extra.length) text += ` ${p.name} ${extra.join(', ')}.`;
  pushRecap(g, text);
  g.last = { kind: 'life', pid: p.id, name: p.name, text, card: c.id, passend };
  checkClearing(g);
  endTurn(g);
  return { ok: true, passend };
}

// Verarbeitet eine Nachricht vom Netz; ändert den Zustand nur bei gültigen Eingaben.
export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== 'wl') return { ok: false, error: 'Kein Spiel.' };
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return { ok: false, error: 'Ungültige Nachricht.' };
  if (idxOf(g, pid) < 0) return { ok: false, error: 'Du spielst nicht mit.' };
  if (!['draw', 'tree', 'sprout', 'life'].includes(msg.t)) return { ok: false, error: 'Unbekannte Nachricht.' };
  if (g.phase !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(g);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  if (msg.t === 'draw') return doDraw(g, p, msg, rng);
  if (g.drawLeft > 0) return { ok: false, error: 'Du hast schon eine Karte gezogen. Ziehe zuerst zu Ende.' };
  if (msg.t === 'tree') return doTree(g, p, msg, rng, false);
  if (msg.t === 'sprout') return doTree(g, p, msg, rng, true);
  return doLife(g, p, msg, rng);
}

// Kleine Hilfen für Oberfläche, Computer und Tests
export const treeCount = (g) => g.players.reduce((n, p) => n + p.trees.length, 0);
export function totalCards(g) {
  // Bilanz: Alle Karten des Spiels sind irgendwo (Winterkarten, die schon aufgedeckt wurden, zählen über winterOut).
  const inForest = g.players.reduce((n, p) => n + p.trees.length + lifeCards(p).length + p.cave.length + p.hand.length, 0);
  return inForest + g.deck.length + g.clearing.length + g.discard.length + g.winterOut;
}
export const deckTotal = (g) => g.opts.deck + 3;
export { count, ptsText, fxText, TOTAL, N_TREES };
