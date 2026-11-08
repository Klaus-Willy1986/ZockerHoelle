// Zehntausend – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel. Genutzt wird nur, was am Tisch sichtbar ist:
// der aktuelle Wurf, die Zugpunkte, die Punktstände und die Regel-Optionen.
import * as Z from './engine.js';

// ---------- Mittel: Schwellenregel nach Anzahl der übrigen Würfel ----------
// Die Schwellen werden beim ersten Gebrauch einmal berechnet: Für jede Zahl übriger Würfel n (1–6) und jeden
// Zugpunktestand p steht fest, wie viele Punkte man im Schnitt am Ende des Zugs bucht, wenn man weiterwürfelt
// (R) oder aufhört (p). Aufgehört wird, sobald p mindestens R ist; das ergibt je Würfelzahl eine Schwelle
// (etwa 300 bei einem Würfel, 250 bei zweien, 450 bei dreien, deutlich mehr bei vier und fünf).
// Beim Werten wird die Teilmenge gewählt, die diesen Erwartungswert am größten macht.
const STEP = 50;
const KMAX = 100; // bis 5000 Zugpunkte, darüber wird immer aufgehört
const FACT = [1, 1, 2, 6, 24, 120, 720];

function outcomes(n) {
  const list = [];
  const rec = (s, cur) => {
    if (cur.length === n) {
      const c = [0, 0, 0, 0, 0, 0, 0];
      cur.forEach((v) => { c[v] += 1; });
      let perm = FACT[n];
      for (let v = 1; v <= 6; v++) perm /= FACT[c[v]];
      list.push({ d: cur.slice(), p: perm / 6 ** n });
      return;
    }
    for (let v = s; v <= 6; v++) { cur.push(v); rec(v, cur); cur.pop(); }
  };
  rec(1, []);
  return list;
}

const CACHE = new Map();
function tables(opts) {
  const o = Z.normOpts(opts);
  const key = `${o.pairs ? 1 : 0}${o.entry ? 1 : 0}`;
  if (CACHE.has(key)) return CACHE.get(key);
  // Für jeden möglichen Wurf: die sinnvollen Wertungen (Punkte, übrige Würfel)
  const subs = [null];
  const memo = new Map(); // gleiche Würfelmengen nur einmal bewerten
  const worth = (cnt) => {
    let k = 0;
    for (let v = 6; v >= 1; v--) k = k * 7 + cnt[v];
    let r = memo.get(k);
    if (r === undefined) {
      const arr = [];
      for (let v = 1; v <= 6; v++) for (let j = 0; j < cnt[v]; j++) arr.push(v);
      r = arr.length ? Z.scoreExact(arr, o) : 0;
      memo.set(k, r);
    }
    return r;
  };
  for (let n = 1; n <= 6; n++) {
    subs[n] = outcomes(n).map((x) => {
      const c = [0, 0, 0, 0, 0, 0, 0];
      x.d.forEach((v) => { c[v] += 1; });
      const seen = new Map();
      const sub = [0, 0, 0, 0, 0, 0, 0];
      const rec = (v, used) => {
        if (v > 6) {
          if (!used) return;
          const pts = worth(sub);
          if (pts > 0) seen.set(`${n - used}:${pts}`, { pts, left: n - used });
          return;
        }
        for (let m = 0; m <= c[v]; m++) { sub[v] = m; rec(v + 1, used + m); }
        sub[v] = 0;
      };
      rec(1, 0);
      // Wertungen weglassen, die von einer anderen übertroffen werden (mehr Punkte und mehr übrige Würfel)
      const all = [...seen.values()].map((e) => ({ ...e, eff: e.left === 0 ? 6 : e.left }));
      const keep = all.filter((a) => !all.some((e) => e !== a && e.pts >= a.pts && e.eff >= a.eff && (e.pts > a.pts || e.eff > a.eff)));
      return { p: x.p, opts: keep };
    });
  }
  const build = (hurdle) => {
    const W = Array.from({ length: 7 }, () => new Float64Array(KMAX + 1));
    const R = Array.from({ length: 7 }, () => new Float64Array(KMAX + 1));
    for (let n = 0; n <= 6; n++) { W[n][KMAX] = KMAX * STEP; R[n][KMAX] = KMAX * STEP; }
    for (let k = KMAX - 1; k >= 0; k--) {
      const p = k * STEP;
      for (let n = 1; n <= 6; n++) {
        let ev = 0;
        for (const x of subs[n]) {
          let best = 0;
          for (const s of x.opts) {
            const v = W[s.left === 0 ? 6 : s.left][Math.min(KMAX, k + s.pts / STEP)];
            if (v > best) best = v;
          }
          ev += x.p * best;
        }
        R[n][k] = ev;
        W[n][k] = hurdle && p < Z.ENTRY ? ev : Math.max(p, ev);
      }
    }
    return { W, R };
  };
  const t = {};
  Object.defineProperty(t, 'entered', { get() { const v = build(false); Object.defineProperty(t, 'entered', { value: v }); return v; }, configurable: true });
  Object.defineProperty(t, 'fresh', { get() { const v = o.entry ? build(true) : t.entered; Object.defineProperty(t, 'fresh', { value: v }); return v; }, configurable: true });
  CACHE.set(key, t);
  return t;
}
const kOf = (p) => Math.min(KMAX, Math.max(0, Math.round(p / STEP)));

// Rechnet die Schwellen vorab aus (z. B. kurz nach dem Start), damit der erste Zug des Computers nicht stockt.
export function warmUp(opts) { try { const t = tables(opts); void t.fresh; void t.entered; } catch { /* egal */ } }

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.mode !== 'play' || !state.turn) return null;
  const me = Z.activePlayer(state);
  if (!me || me.id !== botId) return null;
  const t = state.turn;
  if (t.phase === 'start') return { t: 'roll' };
  if (t.phase === 'end') return { t: 'next' };

  if (t.phase === 'pick') {
    if (level <= 0) {
      const b = Z.bestSubset(t.dice, state.opts, true);
      return b ? { t: 'keep', idx: b.idx } : null;
    }
    const T = tables(state.opts)[me.entered ? 'entered' : 'fresh'];
    const v = t.dice;
    let best = null;
    for (let m = 1; m < (1 << v.length); m++) {
      const sub = v.filter((_, i) => m & (1 << i));
      const pts = Z.scoreExact(sub, state.opts);
      if (pts <= 0) continue;
      const left = v.length - sub.length;
      const val = T.W[left === 0 ? 6 : left][kOf(t.pts + pts)];
      // Gleichstand: mehr Punkte, dann mehr übrige Würfel
      if (!best || val > best.val + 1e-9 || (Math.abs(val - best.val) <= 1e-9 && (pts > best.pts || (pts === best.pts && left > best.left)))) {
        best = { val, pts, left, idx: v.map((_, i) => i).filter((i) => m & (1 << i)) };
      }
    }
    return best ? { t: 'keep', idx: best.idx } : null;
  }
  if (t.phase !== 'after') return null;

  // Aufhören oder weiterwürfeln?
  if (!Z.canBank(state, me, t)) return { t: 'roll' };
  const left = Z.diceLeft(t);
  if (level <= 0) {
    return t.pts >= 300 || left <= 2 ? { t: 'bank' } : { t: 'roll' };
  }
  const total = me.score + t.pts;
  if (state.finalFrom != null && state.active !== state.finalFrom) {
    // Schlussrunde: weiterwürfeln, bis die Person vorne überholt ist
    const lead = Math.max(...state.players.filter((_, i) => i !== state.active).map((p) => p.score));
    return total > lead ? { t: 'bank' } : { t: 'roll' };
  }
  if (total >= Z.targetOf(state)) return { t: 'bank' };
  const T = tables(state.opts)[me.entered ? 'entered' : 'fresh'];
  const k = kOf(t.pts);
  return t.pts >= T.R[left][k] ? { t: 'bank' } : { t: 'roll' };
}
