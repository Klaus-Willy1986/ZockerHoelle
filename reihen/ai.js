// Reihen & Gruppen – Computergegner (reine Funktionen, kein DOM). Regelzugriff nur über engine.js.
// chooseAction(state, botId, level, rng) -> {t:'play', table:[[ids]]} | {t:'draw'} | null
// null = nicht am Zug oder Runde vorbei. Jeder gelieferte Legezug wurde vorab mit engine.checkTurn geprüft (immer gültig).
// level 0 = Leicht, level 1 = Mittel.
// Genutzt werden NUR die eigene Hand, der Tisch, die eigene Eröffnungsmarke und (nicht ausgewertet) die Stapelgröße;
// Hände der anderen und die Stapelreihenfolge werden nie gelesen.
//
// Leicht: bildet aus der eigenen Hand (ohne Joker) disjunkte gültige Reihen/Gruppen, gierig (große/wertvolle zuerst), eröffnet erst bei >= 30,
//   legt nichts an den Tisch an; zieht sonst; in 20 % der Fälle zieht sie trotz möglichem Zug.
// Mittel: Suche über Steintypen (Zählvektor, Memo-frei, Knotenlimit) nach der besten Aufteilung: maximiert die Zahl gelegter Handsteine
//   (dann deren Wert, dann möglichst wenige Joker). Bausteine neben neuen Sätzen aus der Hand: Anlegen an Reihenenden / 4. Farbe der Gruppen,
//   Steine vom Rand langen Reihen (>= 4) oder aus der Mitte (>= 7) oder aus 4er-Gruppen ausleihen, Joker vom Tisch austauschen
//   (die ausgetauschten Joker müssen sofort wieder verbaut werden). Vor der Eröffnung: nur neue Sätze, Summe >= 30.
//   10 % Zufall (zieht statt zu legen), nur bei mehr als 6 Handsteinen.
import * as E from './engine.js';

const JT = 52; // Typ "Joker"
const NODE_CAP = 22000;
const isJ = (id) => id >= 104;
const tcol = (t) => Math.floor(t / 13);
const tnum = (t) => (t % 13) + 1;
const mk = (c, n) => c * 13 + n - 1;

// ---------- Ausgangslage (Hand + Tisch) ----------
function makeBase(handIds, sets) {
  const H = new Int8Array(53);
  const ids = Array.from({ length: 52 }, () => []);
  const jok = [];
  for (const id of handIds.slice().sort((a, b) => a - b)) {
    if (isJ(id)) { jok.push(id); H[JT]++; } else { ids[id % 52].push(id); H[id % 52]++; }
  }
  return { sets, an: sets.map(E.analyzeSet), H, ids, jok };
}

// ---------- Kandidaten ----------
// Kandidat: { kind:'new'|'att', need:[Typen aus der Hand], jh:Joker aus der Hand, parts:[Typen], src:[null|Leihe], borrows:[Leihe], keys:[Slots],
//             low, count, val, openVal, j, end }
// Leihe: { id, j, op:'lo'|'hi'|'mid'|'g', pos, keys }
function genCandidates(base, { melded, maxJ, useTable }) {
  const { H, an, sets } = base;
  const B = Array.from({ length: 52 }, () => []);
  const cands = [];
  const seen = new Set();
  const runs = [];
  if (useTable) {
    an.forEach((a, j) => {
      if (!a.valid) return;
      const L = a.order.length;
      if (a.kind === 'reihe') {
        const first = a.order.findIndex((id) => !isJ(id));
        const s = E.TILES[a.order[first]].num - first;
        const e = s + L - 1;
        const c = E.TILES[a.order.find((id) => !isJ(id))].color;
        runs.push({ j, s, e, L, c });
        if (L >= 4) {
          const lim = L === 4 ? [`${j}:lim`] : [];
          const lo = a.order[0], hi = a.order[L - 1];
          if (!isJ(lo)) B[lo % 52].push({ id: lo, j, op: 'lo', pos: 0, keys: [`${j}:lo`, ...lim] });
          if (!isJ(hi)) B[hi % 52].push({ id: hi, j, op: 'hi', pos: L - 1, keys: [`${j}:hi`, ...lim] });
          for (let i = 3; i <= L - 4; i++) {
            const id = a.order[i];
            if (!isJ(id)) B[id % 52].push({ id, j, op: 'mid', pos: i, keys: [`${j}:lo`, `${j}:hi`, `${j}:mid`] });
          }
        }
      } else {
        const reals = a.order.filter((id) => !isJ(id));
        const num = E.TILES[reals[0]].num;
        const used = new Set(reals.map((id) => E.TILES[id].color));
        if (L === 4) {
          for (const id of reals) B[id % 52].push({ id, j, op: 'g', pos: 0, keys: [`${j}:g`] });
        } else {
          for (let c = 0; c < 4; c++) if (!used.has(c) && H[mk(c, num)] > 0) cands.push(att(j, 'hi', [mk(c, num)], 0, `${j}:g`));
          if (maxJ > 0 && H[JT] > 0) cands.push(att(j, 'hi', [], 1, `${j}:g`));
        }
      }
    });
    for (const r of runs) {
      for (let k = 1; k <= 3 && r.e + k <= 13 && r.L + k <= 13; k++) {
        const ts = []; for (let i = 1; i <= k; i++) ts.push(mk(r.c, r.e + i));
        if (ts.every((t) => H[t] > 0)) cands.push(att(r.j, 'hi', ts, 0, `${r.j}:hi`));
      }
      for (let k = 1; k <= 3 && r.s - k >= 1 && r.L + k <= 13; k++) {
        const ts = []; for (let i = k; i >= 1; i--) ts.push(mk(r.c, r.s - i));
        if (ts.every((t) => H[t] > 0)) cands.push(att(r.j, 'lo', ts, 0, `${r.j}:lo`));
      }
      if (maxJ > 0 && H[JT] > 0 && r.L < 13) cands.push(att(r.j, r.e < 13 ? 'hi' : 'lo', [], 1, r.e < 13 ? `${r.j}:hi` : `${r.j}:lo`));
    }
  }
  function att(j, end, ts, jh, key) {
    return { kind: 'att', j, end, need: ts, jh, parts: ts, src: ts.map(() => null), borrows: [], keys: [key], low: ts.length ? ts[0] : JT, count: ts.length + jh, val: ts.reduce((s, t) => s + tnum(t), 0), openVal: 0 };
  }
  function emit(types, jh, value) {
    let combos = [[]];
    for (const t of types) {
      const opts = [];
      if (H[t] > 0) opts.push(null);
      for (const b of B[t]) opts.push(b);
      if (!opts.length) return;
      const next = [];
      for (const c of combos) for (const o of opts) if (!o || !c.includes(o)) next.push(c.concat([o]));
      combos = next.slice(0, 8);
    }
    for (const c of combos) {
      const need = types.filter((t, i) => c[i] === null);
      const borrows = c.filter(Boolean);
      if (need.length + jh === 0) continue;
      const keys = [];
      let dup = false;
      for (const b of borrows) for (const k of b.keys) { if (keys.includes(k)) dup = true; keys.push(k); }
      if (dup) continue;
      const sig = `${types.join()}|${jh}|${borrows.map((b) => b.id).join()}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      cands.push({ kind: 'new', need, jh, parts: types, src: c, borrows, keys, low: need.length ? need[0] : JT, count: need.length + jh, val: need.reduce((s, t) => s + tnum(t), 0), openVal: value });
    }
  }
  const avail = (t) => H[t] > 0 || B[t].length > 0;
  // neue Reihen
  for (let c = 0; c < 4; c++) {
    for (let s = 1; s <= 11; s++) {
      const types = []; let jh = 0; let value = 0;
      for (let e = s; e <= 13; e++) {
        if (avail(mk(c, e))) types.push(mk(c, e)); else jh++;
        value += e;
        if (jh > maxJ) break;
        if (e - s + 1 >= 3 && types.length >= 1) emit(types.slice(), jh, value);
      }
    }
  }
  // neue Gruppen
  for (let n = 1; n <= 13; n++) {
    for (let mask = 1; mask < 16; mask++) {
      const types = [];
      let ok = true;
      for (let c = 0; c < 4; c++) if (mask & (1 << c)) { if (avail(mk(c, n))) types.push(mk(c, n)); else ok = false; }
      if (!ok) continue;
      for (let size = Math.max(3, types.length); size <= 4; size++) {
        const jh = size - types.length;
        if (jh <= maxJ) emit(types, jh, n * size);
      }
    }
  }
  return cands;
}

// ---------- Suche ----------
// Beste Menge disjunkter Kandidaten. Rückgabe { chosen, count, val, jused } oder null.
function search(base, cands, { melded, minJused }) {
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
    if (nodes++ > NODE_CAP) return;
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
      for (const k of c.keys) if (used.has(k)) { ok = false; break; }
      if (!ok) continue;
      let q = 0;
      for (; q < c.need.length; q++) { if (cnt[c.need[q]] <= 0) break; cnt[c.need[q]]--; }
      if (q === c.need.length) {
        cnt[JT] -= c.jh; remain -= c.count;
        for (const k of c.keys) used.add(k);
        chosen.push(c);
        rec(p, i, count + c.count, val + c.val, openVal + c.openVal, jused + c.jh);
        chosen.pop();
        for (const k of c.keys) used.delete(k);
        cnt[JT] += c.jh; remain += c.count;
      }
      for (let r = 0; r < q; r++) cnt[c.need[r]]++;
    }
    // Rest dieses Typs liegen lassen
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
  const ops = new Map();
  const op = (j) => { if (!ops.has(j)) ops.set(j, { hi: [], lo: [], rem: new Set(), mid: null }); return ops.get(j); };
  const fresh = [];
  for (const c of chosen) {
    if (c.kind === 'att') {
      const ids = c.need.map((t) => pool[t].shift());
      for (let i = 0; i < c.jh; i++) ids.push(jp.shift());
      const o = op(c.j);
      (c.end === 'lo' ? o.lo : o.hi).push(...ids);
    } else {
      const ids = [];
      c.parts.forEach((t, i) => {
        const b = c.src[i];
        if (b === null) ids.push(pool[t].shift());
        else {
          ids.push(b.id);
          const o = op(b.j);
          if (b.op === 'mid') o.mid = b.pos; else o.rem.add(b.id);
        }
      });
      for (let i = 0; i < c.jh; i++) ids.push(jp.shift());
      fresh.push(ids);
    }
  }
  const out = [];
  base.sets.forEach((s, j) => {
    const o = ops.get(j);
    if (!o) { out.push(s); return; }
    const order = base.an[j].valid ? base.an[j].order : s;
    if (o.mid !== null) { out.push(order.slice(0, o.mid), order.slice(o.mid + 1)); return; }
    out.push(o.lo.concat(order.filter((id) => !o.rem.has(id)), o.hi));
  });
  return out.concat(fresh);
}

// ---------- Joker austauschen (nur nach der Eröffnung) ----------
function swapVariants(hand, table) {
  const an = table.map(E.analyzeSet);
  const swaps = [];
  an.forEach((a, j) => {
    if (!a.valid || !a.jokerAs.length) return;
    const handOf = (t) => hand.find((id) => !isJ(id) && id % 52 === t);
    if (a.kind === 'reihe') {
      for (const ja of a.jokerAs) { const id = handOf(mk(ja.color, ja.num)); if (id !== undefined) swaps.push({ j, jid: ja.id, tile: id }); }
    } else {
      const num = E.TILES[a.order[0]].num;
      const usedC = new Set(a.order.filter((id) => !isJ(id)).map((id) => E.TILES[id].color));
      for (const ja of a.jokerAs) {
        for (let c = 0; c < 4; c++) {
          if (usedC.has(c)) continue;
          const id = handOf(mk(c, num));
          if (id !== undefined) { swaps.push({ j, jid: ja.id, tile: id }); break; }
        }
      }
    }
  });
  const apply = (list) => {
    const sets = table.map((s) => s.slice());
    let h = hand.slice();
    const usedJ = new Set(); const usedT = new Set(); const usedS = new Set();
    let n = 0;
    for (const w of list) {
      if (usedJ.has(w.jid) || usedT.has(w.tile) || usedS.has(w.j)) continue;
      usedJ.add(w.jid); usedT.add(w.tile); usedS.add(w.j);
      sets[w.j] = sets[w.j].map((id) => (id === w.jid ? w.tile : id));
      h = h.filter((id) => id !== w.tile); h.push(w.jid);
      n++;
    }
    return { sets, hand: h, s: n };
  };
  const out = [];
  swaps.slice(0, 4).forEach((w) => out.push(apply([w])));
  if (swaps.length >= 2) out.push(apply(swaps));
  return out.filter((v) => v.s > 0);
}

// ---------- Entscheidungen ----------
const draw = () => ({ t: 'draw' });

function easyPlan(state, me) {
  const base = makeBase(me.hand.filter((id) => !isJ(id)), state.table);
  const cands = genCandidates(base, { melded: me.melded, maxJ: 0, useTable: false });
  cands.sort((a, b) => b.count - a.count || b.openVal - a.openVal);
  const cnt = Int8Array.from(base.H);
  const chosen = [];
  let total = 0;
  for (const c of cands) {
    if (c.need.every((t) => cnt[t] > 0)) { c.need.forEach((t) => cnt[t]--); chosen.push(c); total += c.openVal; }
  }
  if (!chosen.length) return null;
  if (!me.melded && total < E.OPEN_MIN) return null;
  return buildTable(base, chosen);
}

function mediumPlan(state, me, botId) {
  const J0 = me.hand.filter(isJ).length;
  const variants = [{ sets: state.table, hand: me.hand, s: 0 }];
  if (me.melded) variants.push(...swapVariants(me.hand, state.table));
  let best = null;
  for (const v of variants) {
    const base = makeBase(v.hand, v.sets);
    const cands = genCandidates(base, { melded: me.melded, maxJ: Math.min(2, base.H[JT]), useTable: me.melded });
    const r = search(base, cands, { melded: me.melded, minJused: v.s });
    if (!r) continue;
    const table = buildTable(base, r.chosen);
    const chk = E.checkTurn(state, botId, table);
    if (!chk.ok) continue;
    const jokersPlayed = chk.played.filter((id) => isJ(id) && me.hand.includes(id)).length;
    const score = chk.played.length * 1000 + chk.newValue - 3 * jokersPlayed;
    if (!best || score > best.score) best = { score, table: chk.table };
  }
  void J0;
  return best ? best.table : null;
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.phase !== 'play') return null;
  const me = state.players[state.active];
  if (!me || me.id !== botId) return null;
  if (level === 0) {
    const table = easyPlan(state, me);
    const roll = rng();
    if (!table || roll < 0.2) return draw();
    const chk = E.checkTurn(state, botId, table);
    return chk.ok ? { t: 'play', table: chk.table } : draw();
  }
  const table = mediumPlan(state, me, botId);
  const roll = rng();
  if (!table) return draw();
  if (me.hand.length > 6 && roll < 0.1) return draw();
  return { t: 'play', table };
}
