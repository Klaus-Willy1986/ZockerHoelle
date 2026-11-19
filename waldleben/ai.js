// Waldleben – Computergegner (reine Funktionen, keine Oberfläche).
// Der Computer nutzt nur öffentliche Angaben und seine eigene Hand: alle Wälder, die offene Lichtung, die Zahl der
// Karten im Stapel und die Zahl der gezeigten Winterkarten. Die Reihenfolge des Stapels, fremde Hände, fremde Höhlen
// und verdeckte Sprösslinge nutzt er NICHT.
// Stufen: 0 = Leicht (überwiegend zufällig), 1 = Mittel (bewertet Züge nach Punkten, Karten und Kosten; 8 % Zufall).
import * as M from './engine.js';
import { CARDS, cardPoints, count, hasDauer } from './cards.js';

export const RANDOM_CHANCE = 0.08;
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Kopie nur des eigenen Waldes (ohne Verweise auf geheime Dinge)
const forestOf = (p) => ({ trees: p.trees.map((t) => ({ sp: t.sp, id: t.id, sides: t.sides.slice() })), cave: p.cave.map(() => 0) });
const totalOf = (q) => {
  let s = q.cave.length;
  for (const t of q.trees) for (const id of t.sides) if (id !== null) s += cardPoints(q, CARDS[id]);
  return s;
};
// bester freier Platz: bevorzugt Bäume, die damit voll werden (zählt für "voll besetzt"), sonst der erste freie
function bestSlot(p) {
  let best = null;
  p.trees.forEach((t, i) => {
    const free = M.treeFree(t);
    if (!free.length) return;
    const rank = free.length === 1 ? 0 : free.length;
    if (!best || rank < best.rank) best = { tree: i, side: free[0], rank };
  });
  return best;
}

// Wert einer Anlege-Karte, wenn man sie jetzt anlegen würde (ohne Kosten)
function lifeGain(g, p, c, withSlot) {
  const q = forestOf(p);
  const slot = withSlot || bestSlot(p);
  const before = totalOf(q);
  let tree = slot ? slot.tree : -1;
  if (tree < 0) { q.trees.push({ sp: -1, id: -1, sides: [null, null, null, null] }); tree = q.trees.length - 1; }
  const sideIdx = slot ? slot.side : 0;
  q.trees[tree].sides[sideIdx] = c.id;
  let v = totalOf(q) - before;
  const r = c.pts;
  if (r && r.k === 'per') v += 0.6 * r.n; // wächst später noch
  if (r && r.k === 'ifge' && cardPoints(q, c) === 0) v += 0.3 * r.n; // könnte später gelingen
  const f = c.fx;
  if (f) {
    const room = Math.max(0, M.handLimit(p) - p.hand.length);
    if (f.k === 'draw') v += 0.9 * Math.min(f.n, room + c.cost);
    else if (f.k === 'cave') v += 1.0 * f.n;
    else if (f.k === 'extra') v += 1.6;
    else if (f.k === 'dauer') v += f.id === 'draw3' ? 2.4 : f.id === 'hand12' ? 1.0 : 0.9;
  }
  return v;
}

const treesNeeded = (p) => p.trees.length === 0 || M.freeSlots(p) < 1;
const lateGame = (g) => (g.winters >= 2 ? 0.55 : g.winters === 1 ? 0.85 : 1);

// Was es kostet, eine Handkarte abzugeben (sie geht in die Lichtung)
function keepValue(g, p, c) {
  if (c.kind === 'tree') {
    if (p.trees.length === 0) return 2.2;
    if (M.freeSlots(p) < 1) return 1.8;
    if (M.freeSlots(p) < 2) return 1.1;
    return 0.5;
  }
  const gain = lifeGain(g, p, c, null) - c.cost * 0.8;
  return Math.max(0.25, 0.7 * gain + 0.2);
}

// Beste Zahlkarten für eine Karte: auf Wunsch "passend" (alle mit der Baumfarbe der Karte), sonst die billigsten
function choosePay(g, p, c) {
  if (c.cost === 0) return { pay: [], cost: 0, passend: false };
  const others = p.hand.filter((id) => id !== c.id).map((id) => ({ id, sp: CARDS[id].sp, keep: keepValue(g, p, CARDS[id]) }));
  others.sort((a, b) => a.keep - b.keep || a.id - b.id);
  const cheap = others.slice(0, c.cost);
  const same = others.filter((o) => o.sp === c.sp).slice(0, c.cost);
  const sum = (a) => a.reduce((s, x) => s + x.keep, 0);
  const bonus = hasDauer(p, 'pass2') ? 2 : 1;
  const cheapSame = cheap.every((o) => o.sp === c.sp);
  const optA = { pay: cheap.map((o) => o.id), cost: sum(cheap), passend: cheapSame };
  if (cheapSame) optA.cost -= 0.9 * bonus;
  if (same.length === c.cost) {
    const optB = { pay: same.map((o) => o.id), cost: sum(same) - 0.9 * bonus, passend: true };
    if (optB.cost < optA.cost) return optB;
  }
  return optA;
}

function drawValue(g, p) {
  return (2.3 - 0.3 * Math.max(0, p.hand.length - 3)) * lateGame(g);
}

function wantFromClearing(g, p, id) {
  const c = CARDS[id];
  if (c.kind === 'tree') return treesNeeded(p) ? 1.5 : 0.7;
  const gain = lifeGain(g, p, c, null) - c.cost * 0.8;
  return gain + 0.4;
}

function livePlays(g, p) {
  const out = [];
  for (const id of p.hand) {
    if (CARDS[id].kind === 'life' && M.canPlayAsSelf(g, p, id)) out.push(id);
  }
  return out;
}

function lifeMsg(g, p, id, rng, smart) {
  const c = CARDS[id];
  let slot;
  let pay;
  if (smart) {
    slot = bestSlot(p);
    pay = choosePay(g, p, c).pay;
  } else {
    const slots = [];
    p.trees.forEach((t, i) => M.treeFree(t).forEach((s) => slots.push({ tree: i, side: s })));
    slot = pick(slots, rng);
    const o = p.hand.filter((x) => x !== id);
    pay = [];
    while (pay.length < c.cost) pay.push(o.splice(Math.min(o.length - 1, Math.floor(rng() * o.length)), 1)[0]);
  }
  return { t: 'life', card: id, pay, tree: slot.tree, side: slot.side };
}

function drawMsg(g, p, level, rng) {
  if (level === 0) {
    const options = [{ t: 'draw', src: 'deck' }, { t: 'draw', src: 'deck' }];
    for (const id of g.clearing) options.push({ t: 'draw', src: 'clearing', card: id });
    return pick(options, rng);
  }
  let best = null;
  for (const id of g.clearing) {
    const w = wantFromClearing(g, p, id);
    if (!best || w > best.w) best = { id, w };
  }
  if (best && best.w > 1.15) return { t: 'draw', src: 'clearing', card: best.id };
  return { t: 'draw', src: 'deck' };
}

export function chooseAction(g, botId, level, rng) {
  if (!g || g.game !== 'wl' || g.phase !== 'play') return null;
  const p = M.activePlayer(g);
  if (!p || p.id !== botId) return null;
  const canDraw = M.canDrawNow(g, p);
  if (g.drawLeft > 0) return drawMsg(g, p, level, rng);

  const lives = livePlays(g, p);
  const trees = p.hand.filter((id) => CARDS[id].kind === 'tree');

  // ---- Leicht ----
  if (level === 0) {
    const plays = [];
    for (const id of lives) plays.push(() => lifeMsg(g, p, id, rng, false));
    for (const id of trees) plays.push(() => ({ t: 'tree', card: id }));
    if (canDraw && (!plays.length || rng() < 0.45)) return drawMsg(g, p, 0, rng);
    if (plays.length) return pick(plays, rng)();
    if (!p.hand.length) return canDraw ? drawMsg(g, p, 0, rng) : null;
    return { t: 'sprout', card: pick(p.hand, rng) };
  }

  // ---- Mittel ----
  const cands = [];
  if (canDraw) cands.push({ v: drawValue(g, p), msg: () => drawMsg(g, p, 1, rng) });
  for (const id of lives) {
    const c = CARDS[id];
    const pay = choosePay(g, p, c);
    const v = lifeGain(g, p, c, null) - pay.cost;
    cands.push({ v, msg: () => lifeMsg(g, p, id, rng, true) });
  }
  // Baum pflanzen: gut, wenn Plätze fehlen
  const slotNeed = p.hand.some((id) => CARDS[id].kind === 'life');
  for (const id of trees) {
    const c = CARDS[id];
    let v = 0.55;
    if (p.trees.length === 0) v = 2.0; else if (M.freeSlots(p) < 1 && slotNeed) v = 1.9; else if (M.freeSlots(p) < 2 && slotNeed) v = 1.2;
    for (const h of p.hand) {
      const r = CARDS[h].pts;
      if (r && r.k === 'per' && r.w === `tree:${c.sp}`) v += 0.5 * r.n;
    }
    for (const t of p.trees) for (const s of t.sides) { const r = s !== null ? CARDS[s].pts : null; if (r && r.k === 'per' && r.w === `tree:${c.sp}`) v += r.n; }
    if (p.trees.every((t) => t.sp !== c.sp)) v += 0.25; // neue Baumart
    cands.push({ v, msg: () => ({ t: 'tree', card: id }) });
  }
  // Sprössling: die Karte mit dem geringsten Wert opfern
  if (p.hand.length) {
    const ranked = p.hand.map((id) => ({ id, keep: keepValue(g, p, CARDS[id]) })).sort((a, b) => a.keep - b.keep || a.id - b.id);
    const worst = ranked[0];
    const need = treesNeeded(p) && slotNeed;
    let v = (need ? 1.7 : 0.1) - worst.keep + (p.hand.length >= M.handLimit(p) ? 0.6 : 0);
    if (!trees.length && p.trees.length === 0) v += 1.0;
    cands.push({ v, msg: () => ({ t: 'sprout', card: worst.id }) });
  }
  if (!cands.length) return null;
  if (rng() < RANDOM_CHANCE) return pick(cands, rng).msg();
  let best = cands[0];
  for (const c of cands) if (c.v > best.v) best = c;
  return best.msg();
}

// Für den Alleinspiel-Modus der Oberfläche: alle Hilfen zusammen
export { count };
