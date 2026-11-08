// Rommé – Computergegner (reine Funktionen, kein DOM). Regelzugriff nur über engine.js.
// chooseAction(state, botId, level, rng) -> {t:'draw',from} | {t:'meld',table} | {t:'discard',card} | null
// null = nicht am Zug oder Runde vorbei. Jeder gelieferte Auslege-Zug wurde vorab mit engine.checkTurn geprüft (immer gültig).
// level 0 = Leicht, level 1 = Mittel.
// Genutzt werden NUR die eigene Hand, der Tisch, die Ablage (offen), die Eröffnungsmarken und die Stapelgröße.
// Stapelreihenfolge und fremde Hände werden nie gelesen.
//
// Leicht: bildet aus der eigenen Hand (Joker nur innerhalb neuer Sätze) disjunkte Folgen/Sätze, eröffnet erst bei >= 40 Punkten, legt nie an,
//   nimmt die Ablage nur, wenn die oberste Karte sofort einen Satz bildet (sonst Stapel), wirft die höchste Einzelkarte ab (in 30 % der Fälle irgendeine Einzelkarte).
// Mittel: beste Aufteilung der Hand (Suche über Kartentypen mit Joker), nimmt die Ablage, wenn sie die Hand verbessert,
//   legt an Folgen/Sätze auf dem Tisch an, tauscht Joker, wirft die Karte mit dem geringsten Nutzen ab
//   (Nachbarn/Paare in der Hand, sichtbare Karten auf Tisch und Ablage, Anlegemöglichkeiten).
import * as E from './engine.js';

const JT = 52; // Typ "Joker"
const NODE_CAP = 20000;
const EVAL_CAP = 4000;
const isJ = (id) => id >= 104;
const tOf = (id) => (id >= 104 ? JT : id % 52);
const mk = (s, r) => s * 13 + r - 1;
const tsuit = (t) => Math.floor(t / 13);
const trank = (t) => (t % 13) + 1;
const posType = (s, p) => mk(s, p === 14 ? 1 : p);
const posVal = (p) => (p === 1 ? 1 : p === 14 ? 11 : p >= 10 ? 10 : p);
const rv = (r) => (r === 1 ? 11 : r >= 10 ? 10 : r);

// ---------- Ausgangslage (Hand + Tisch) ----------
function makeBase(handIds, sets) {
  const H = new Int8Array(53);
  const ids = Array.from({ length: 52 }, () => []);
  const jok = [];
  for (const id of handIds.slice().sort((a, b) => a - b)) {
    if (isJ(id)) { jok.push(id); H[JT]++; } else { const t = id % 52; ids[t].push(id); H[t]++; }
  }
  return { sets, an: sets.map(E.analyzeSet), H, ids, jok };
}

// ---------- Kandidaten ----------
// Kandidat: { kind:'new'|'att', need:[Typen aus der Hand], jh:Joker aus der Hand, key:[Slots], low, count, val, openVal, j, end }
function genCandidates(base, { maxJ, useTable }) {
  const { H, an } = base;
  const cands = [];
  const att = (j, end, ts, jh, key) => ({ kind: 'att', j, end, need: ts, jh, key: [key], low: ts.length ? Math.min(...ts) : JT, count: ts.length + jh, val: 0, openVal: 0 });
  if (useTable) {
    an.forEach((a, j) => {
      if (!a.valid) return;
      const hasJ = a.jokerAs.length > 0;
      const n = a.order.length;
      if (a.kind === 'folge') {
        for (let k = 1; k <= 3 && a.hi + k <= 14 && n + k <= 14; k++) {
          const ts = []; for (let i = 1; i <= k; i++) ts.push(posType(a.suit, a.hi + i));
          if (ts.every((t) => H[t] > 0)) cands.push(att(j, 'hi', ts, 0, `${j}:hi`));
        }
        for (let k = 1; k <= 3 && a.lo - k >= 1 && n + k <= 14; k++) {
          const ts = []; for (let i = k; i >= 1; i--) ts.push(posType(a.suit, a.lo - i));
          if (ts.every((t) => H[t] > 0)) cands.push(att(j, 'lo', ts, 0, `${j}:lo`));
        }
        if (maxJ > 0 && H[JT] > 0 && !hasJ && n < 14) cands.push(att(j, a.hi < 14 ? 'hi' : 'lo', [], 1, a.hi < 14 ? `${j}:hi` : `${j}:lo`));
      } else if (n === 3) {
        const used = new Set(a.order.filter((id) => !isJ(id)).map((id) => E.CARDS[id].suit));
        for (let c = 0; c < 4; c++) if (!used.has(c) && H[mk(c, a.rank)] > 0) cands.push(att(j, 'hi', [mk(c, a.rank)], 0, `${j}:g`));
        if (maxJ > 0 && H[JT] > 0 && !hasJ) cands.push(att(j, 'hi', [], 1, `${j}:g`));
      }
    });
  }
  const seen = new Set();
  const emit = (types, jh, value) => {
    if (types.length + jh === 0) return;
    const sig = types.join() + '|' + jh;
    if (seen.has(sig)) return;
    seen.add(sig);
    cands.push({ kind: 'new', need: types, jh, key: [], low: Math.min(...types), count: types.length + jh, val: value, openVal: value });
  };
  // neue Folgen
  for (let s = 0; s < 4; s++) {
    for (let a = 1; a <= 12; a++) {
      const types = []; let jh = 0; let value = 0;
      for (let p = a; p <= 14; p++) {
        const t = posType(s, p);
        if (H[t] > 0) types.push(t); else jh++;
        value += posVal(p);
        if (jh > maxJ) break;
        if (p - a + 1 >= 3 && types.length >= 2) emit(types.slice(), jh, value);
      }
    }
  }
  // neue Sätze
  for (let r = 1; r <= 13; r++) {
    for (let mask = 1; mask < 16; mask++) {
      const types = [];
      let ok = true;
      for (let c = 0; c < 4; c++) if (mask & (1 << c)) { if (H[mk(c, r)] > 0) types.push(mk(c, r)); else ok = false; }
      if (!ok || types.length < 2) continue;
      for (let size = Math.max(3, types.length); size <= 4; size++) {
        const jh = size - types.length;
        if (jh <= maxJ) emit(types, jh, rv(r) * size);
      }
    }
  }
  return cands;
}

// ---------- Suche ----------
// Beste Menge disjunkter Kandidaten. Rückgabe { chosen, count, val, jused } oder null.
function search(base, cands, { melded, minJused = 0, cap = NODE_CAP }) {
  const byLow = Array.from({ length: 53 }, () => []);
  for (const c of cands) byLow[c.low].push(c);
  for (const l of byLow) l.sort((a, b) => b.count - a.count || b.val - a.val);
  const cnt = Int8Array.from(base.H);
  const used = new Set();
  const chosen = [];
  let remain = 0;
  for (let t = 0; t < 53; t++) remain += cnt[t];
  let best = null;
  let nodes = 0;
  const better = (c, v, ju) => !best || c > best.count || (c === best.count && (v > best.val || (v === best.val && ju < best.jused)));
  function rec(p, minIdx, count, val, openVal, jused) {
    if (nodes++ > cap) return;
    while (p <= JT && cnt[p] === 0) { p++; minIdx = 0; }
    if (p > JT) {
      if (count >= 1 && (melded || openVal >= E.OPEN_MIN) && jused >= minJused && better(count, val, jused)) best = { chosen: chosen.slice(), count, val, jused };
      return;
    }
    if (best && count + remain < best.count) return;
    const list = byLow[p];
    for (let i = minIdx; i < list.length; i++) {
      const c = list[i];
      if (c.jh > cnt[JT]) continue;
      let ok = true;
      for (const k of c.key) if (used.has(k)) { ok = false; break; }
      if (!ok) continue;
      let q = 0;
      for (; q < c.need.length; q++) { if (cnt[c.need[q]] <= 0) break; cnt[c.need[q]]--; }
      if (q === c.need.length) {
        cnt[JT] -= c.jh; remain -= c.count;
        for (const k of c.key) used.add(k);
        chosen.push(c);
        rec(p, i, count + c.count, val + c.val, openVal + c.openVal, jused + c.jh);
        chosen.pop();
        for (const k of c.key) used.delete(k);
        cnt[JT] += c.jh; remain += c.count;
      }
      for (let r = 0; r < q; r++) cnt[c.need[r]]++;
    }
    const keep = cnt[p];
    remain -= keep; cnt[p] = 0;
    rec(p + 1, 0, count, val, openVal, jused);
    cnt[p] = keep; remain += keep;
  }
  rec(0, 0, 0, 0, 0, 0);
  return best;
}

// ---------- Plan -> Tisch ----------
function buildTable(base, chosen) {
  const pool = base.ids.map((a) => a.slice());
  const jp = base.jok.slice();
  const add = new Map();
  const fresh = [];
  for (const c of chosen) {
    const ids = c.need.map((t) => pool[t].shift());
    for (let i = 0; i < c.jh; i++) ids.push(jp.shift());
    if (c.kind === 'att') add.set(c.j, (add.get(c.j) || []).concat(ids));
    else fresh.push(ids);
  }
  return base.sets.map((s, j) => (add.has(j) ? s.concat(add.get(j)) : s.slice())).concat(fresh);
}

// ---------- Joker austauschen (nur nach der Eröffnung) ----------
function swapVariants(hand, table) {
  const an = table.map(E.analyzeSet);
  const swaps = [];
  an.forEach((a, j) => {
    if (!a.valid || !a.jokerAs.length) return;
    const handOf = (pred) => hand.find((id) => !isJ(id) && pred(E.CARDS[id]));
    const ja = a.jokerAs[0];
    let id;
    if (a.kind === 'folge') id = handOf((c) => c.suit === ja.suit && c.rank === ja.rank);
    else {
      const usedS = new Set(a.order.filter((x) => !isJ(x)).map((x) => E.CARDS[x].suit));
      id = handOf((c) => c.rank === a.rank && !usedS.has(c.suit));
    }
    if (id !== undefined) swaps.push({ j, jid: ja.id, tile: id });
  });
  const apply = (list) => {
    const sets = table.map((s) => s.slice());
    let h = hand.slice();
    const usedT = new Set();
    let n = 0;
    for (const w of list) {
      if (usedT.has(w.tile)) continue;
      usedT.add(w.tile);
      sets[w.j] = sets[w.j].map((id) => (id === w.jid ? w.tile : id));
      h = h.filter((id) => id !== w.tile); h.push(w.jid);
      n++;
    }
    return { sets, hand: h, s: n };
  };
  const out = [];
  swaps.slice(0, 3).forEach((w) => out.push(apply([w])));
  if (swaps.length >= 2) out.push(apply(swaps));
  return out.filter((v) => v.s > 0);
}

// ---------- Entscheidungen ----------
function easyPlan(state, me) {
  const base = makeBase(me.hand, state.table);
  const cands = genCandidates(base, { maxJ: Math.min(1, base.H[JT]), useTable: false });
  const r = search(base, cands, { melded: me.melded, cap: 6000 });
  if (!r) return { table: null, singles: me.hand.filter((id) => !isJ(id)) };
  const left = [];
  const pool = base.ids.map((a) => a.slice());
  for (const c of r.chosen) c.need.forEach((t) => pool[t].shift());
  pool.forEach((a) => left.push(...a));
  return { table: buildTable(base, r.chosen), singles: left };
}

function mediumPlan(state, me, botId) {
  const variants = [{ sets: state.table, hand: me.hand, s: 0 }];
  if (me.melded && state.opts && state.opts.swap) variants.push(...swapVariants(me.hand, state.table));
  let best = null;
  for (const v of variants) {
    const base = makeBase(v.hand, v.sets);
    const cands = genCandidates(base, { maxJ: Math.min(1, base.H[JT]), useTable: me.melded });
    const r = search(base, cands, { melded: me.melded, minJused: v.s });
    if (!r) continue;
    const table = buildTable(base, r.chosen);
    const chk = E.checkTurn(state, botId, table);
    if (!chk.ok) continue;
    const jokersPlayed = chk.played.filter((id) => isJ(id) && me.hand.includes(id)).length;
    const score = chk.played.length * 1000 + chk.newValue - 3 * jokersPlayed;
    if (!best || score > best.score) best = { score, table: chk.table };
  }
  return best ? best.table : null;
}

// Wert der besten Aufteilung einer Hand (ohne Eröffnungssperre, ohne Tisch)
function laidScore(handIds) {
  const base = makeBase(handIds, []);
  const cands = genCandidates(base, { maxJ: Math.min(1, base.H[JT]), useTable: false });
  const r = search(base, cands, { melded: true, cap: EVAL_CAP });
  return r ? r.count * 100 + r.val : 0;
}

function visibleTypes(state, me) {
  const seen = new Int8Array(53);
  for (const id of E.tableIds(state.table)) seen[tOf(id)]++;
  for (const id of state.discard) seen[tOf(id)]++;
  for (const id of me.hand) seen[tOf(id)]++;
  return seen;
}

// Nutzen einer Handkarte (je höher, desto eher behalten)
function utility(id, Hc, seen, attachTypes, melded) {
  if (isJ(id)) return 1000;
  const t = id % 52;
  const s = tsuit(t), r = trank(t);
  let score = 0;
  for (let c = 0; c < 4; c++) {
    if (c === s) continue;
    const o = mk(c, r);
    if (Hc[o] > 0 && seen[mk(c, r)] < 2 + 1) score += 2;
  }
  const nb = (rr) => (rr >= 1 && rr <= 13 ? mk(s, rr) : -1);
  const around = r === 1 ? [[13, 1], [12, 2], [2, 1], [3, 2]] : r === 13 ? [[12, 1], [11, 2], [1, 1], [2, 2]] : [[r - 1, 1], [r + 1, 1], [r - 2, 2], [r + 2, 2]];
  for (const [rr, w] of around) {
    const o = nb(rr);
    if (o < 0 || Hc[o] === 0) continue;
    // Gegenstück ist "tot", wenn die Karten, die die Lücke schließen, alle schon sichtbar sind
    score += w === 1 ? 2 : 1;
  }
  if (melded && attachTypes.has(t)) score += 5;
  return score - cardVal(id) / 100;
}
const cardVal = (id) => E.cardValue(id);

function attachTypesOf(table) {
  const out = new Set();
  for (const set of table) {
    const a = E.analyzeSet(set);
    if (!a.valid) continue;
    if (a.kind === 'folge') {
      if (a.hi < 14) out.add(posType(a.suit, a.hi + 1));
      if (a.lo > 1) out.add(posType(a.suit, a.lo - 1));
    } else if (a.order.length === 3) {
      const used = new Set(a.order.filter((id) => !isJ(id)).map((id) => E.CARDS[id].suit));
      for (let c = 0; c < 4; c++) if (!used.has(c)) out.add(mk(c, a.rank));
    }
  }
  return out;
}

function mediumDiscard(state, me) {
  const Hc = new Int8Array(53);
  for (const id of me.hand) Hc[tOf(id)]++;
  const seen = visibleTypes(state, me);
  const att = attachTypesOf(state.table);
  let best = null;
  for (const id of me.hand) {
    if (state.takenFromDiscard === id && me.hand.length > 1) continue;
    const u = utility(id, Hc, seen, att, me.melded);
    if (!best || u < best.u) best = { id, u };
  }
  return best ? best.id : me.hand[0];
}

function easyDiscard(state, me, singles, rng) {
  const ok = (id) => !(state.takenFromDiscard === id && me.hand.length > 1);
  let pool = singles.filter((id) => ok(id) && !isJ(id));
  if (!pool.length) pool = me.hand.filter((id) => ok(id) && !isJ(id));
  if (!pool.length) pool = me.hand.filter(ok);
  if (!pool.length) pool = me.hand.slice();
  // Einzelkarten: Karten ohne Partner (kein gleicher Wert, keine Nachbarn) kommen zuerst, davon die höchste
  const Hc = new Int8Array(53);
  for (const id of me.hand) Hc[tOf(id)]++;
  const none = new Int8Array(53);
  const partner = (id) => Math.floor(utility(id, Hc, none, new Set(), false) + cardVal(id) / 100 + 0.001);
  const lone = pool.filter((id) => partner(id) === 0);
  const from = lone.length ? lone : pool;
  // Leicht ist nicht stur: manchmal fliegt irgendeine Einzelkarte
  if (rng() < 0.3) return from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
  const top = Math.max(...from.map(cardVal));
  const best = from.filter((id) => cardVal(id) === top);
  return best[Math.min(best.length - 1, Math.floor(rng() * best.length))];
}

function drawFrom(state, me, level) {
  const top = state.discard.length ? state.discard[state.discard.length - 1] : null;
  if (top === null) return 'pile';
  if (!state.pile.length && state.discard.length < 2) return 'discard';
  if (level === 0) {
    if (isJ(top)) return 'pile';
    const H = new Int8Array(53);
    for (const id of me.hand) if (!isJ(id)) H[id % 52]++;
    const tt = top % 52;
    H[tt]++;
    const base = { H, an: [] };
    const cands = genCandidates(base, { maxJ: 0, useTable: false });
    const need = (c) => { const m = {}; for (const t of c.need) m[t] = (m[t] || 0) + 1; return m; };
    const hit = cands.some((c) => c.need.includes(tt) && Object.entries(need(c)).every(([t, n]) => H[t] >= n));
    return hit ? 'discard' : 'pile';
  }
  // Mittel
  const t = tOf(top);
  if (me.melded && attachTypesOf(state.table).has(t) && !isJ(top)) return 'discard';
  if (isJ(top)) return 'discard';
  const before = laidScore(me.hand);
  const after = laidScore(me.hand.concat([top]));
  if (after > before) return 'discard';
  const Hc = new Int8Array(53);
  for (const id of me.hand) Hc[tOf(id)]++;
  const u = utility(top, Hc, visibleTypes(state, me), new Set(), false);
  return u >= 3.5 ? 'discard' : 'pile';
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.phase !== 'play') return null;
  const me = state.players[state.active];
  if (!me || me.id !== botId) return null;
  if (state.turn === 'draw') return { t: 'draw', from: drawFrom(state, me, level) };
  if (level === 0) {
    const plan = easyPlan(state, me);
    if (plan.table) {
      const chk = E.checkTurn(state, botId, plan.table);
      if (chk.ok) return { t: 'meld', table: chk.table };
    }
    return { t: 'discard', card: easyDiscard(state, me, plan.singles, rng) };
  }
  const table = mediumPlan(state, me, botId);
  if (table) return { t: 'meld', table };
  return { t: 'discard', card: mediumDiscard(state, me) };
}
