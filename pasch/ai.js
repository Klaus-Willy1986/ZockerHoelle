// Pasch & Straße – Computergegner (reine Funktionen, keine Oberfläche).
// Regelzugriff nur über engine.js. Stufen: 0 = Leicht, 1 = Mittel.
import * as P from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Üblicher Erwartungswert, den ein Feld bei vernünftigem Spiel bringt.
const EXPECTED = {
  ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2,
  three: 21.7, four: 13.1, full: 22.6, small: 29.5, large: 32.7, five: 16.8, chance: 22,
};
// Wie ungern ein Feld mit 0 gestrichen wird (Pasch und Straßen nicht leichtfertig streichen).
const STRIKE_COST = { ones: 1.2, five: 0.9, large: 1.0, small: 1.0 };

// Mittel: Wert, den es hat, dieses Feld mit diesen Würfeln zu belegen.
function gain(cat, dice) {
  const def = P.catOf(cat);
  const pts = P.scoreFor(cat, dice);
  let g = pts - EXPECTED[cat];
  if (pts === 0) g = -EXPECTED[cat] * (STRIKE_COST[cat] ?? 1);
  if (def.upper) g += 0.8 * (pts - 3 * def.face); // Bonus ab 63 im Blick behalten
  return g;
}

function bestGain(dice, free) {
  let best = -Infinity;
  let bestCat = free[0];
  for (const c of free) {
    const g = gain(c, dice);
    if (g > best) { best = g; bestCat = c; }
  }
  return { gain: best, cat: bestCat };
}

// Alle Ergebnisse von k Würfeln als sortierte Mehrfachmengen mit Wahrscheinlichkeit.
const OUTCOMES = (() => {
  const fact = [1, 1, 2, 6, 24, 120];
  const res = [[{ d: [], p: 1 }]];
  for (let k = 1; k <= 5; k++) {
    const list = [];
    const rec = (start, cur) => {
      if (cur.length === k) {
        const cnt = Array(7).fill(0);
        cur.forEach((v) => { cnt[v] += 1; });
        let perm = fact[k];
        for (let v = 1; v <= 6; v++) perm /= fact[cnt[v]];
        list.push({ d: cur.slice(), p: perm / 6 ** k });
        return;
      }
      for (let v = start; v <= 6; v++) { cur.push(v); rec(v, cur); cur.pop(); }
    };
    rec(1, []);
    res.push(list);
  }
  return res;
})();

// Mittel: Welche Würfel behalten? Erwartungswert über den nächsten Wurf, bester Plan gewinnt.
function planKeep(dice, free, rng, noise) {
  const now = bestGain(dice, free);
  let bestKeep = null;
  let bestVal = -Infinity;
  const seen = new Set();
  for (let m = 0; m < 31; m++) { // 31 = alle behalten (zählt als Aufhören)
    const keep = dice.map((_, i) => !!(m & (1 << i)));
    const kept = dice.filter((_, i) => keep[i]).sort();
    const key = kept.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    let ev = 0;
    for (const o of OUTCOMES[5 - kept.length]) ev += o.p * bestGain(kept.concat(o.d), free).gain;
    ev += (rng() - 0.5) * noise;
    if (ev > bestVal) { bestVal = ev; bestKeep = keep; }
  }
  return { stop: now.gain + (rng() - 0.5) * noise >= bestVal, keep: bestKeep, cat: now.cat };
}

// Leicht: zufälliger Teil der Würfel, mit leichter Vorliebe für gleiche Zahlen.
// Feineinstellung Leicht (gemessen: im Schnitt ca. 125 Punkte über 13 Runden).
const TUNE = { A: 0.3, B: 0.3, S1: 0.05, S2: 0.12, POS: 0.9, Q: 0.85 };
function randomKeep(dice, rng) {
  const { A, B } = TUNE;
  const cnt = Array(7).fill(0);
  dice.forEach((v) => { cnt[v] += 1; });
  if (rng() < TUNE.Q) {
    // Häufigste Augenzahl behalten (bei Gleichstand eine zufällige, höhere etwas lieber).
    let bv = 0;
    let bs = -1;
    for (let v = 1; v <= 6; v++) { const sc = cnt[v] * 10 + v + rng() * 4; if (cnt[v] && sc > bs) { bs = sc; bv = v; } }
    const k2 = dice.map((v) => v === bv);
    if (!k2.every(Boolean)) return k2;
  }
  const keep = dice.map((v) => rng() < A + B * (cnt[v] - 1) + (v >= 4 ? 0.05 : 0));
  if (keep.every(Boolean)) keep[Math.floor(rng() * 5)] = false;
  return keep;
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.mode !== 'play') return null;
  const ap = P.activePlayer(state);
  if (!ap || ap.id !== botId || !state.turn) return null;
  const t = state.turn;
  const free = P.freeCats(ap.sheet);
  if (!free.length) return null;
  if (t.rolls === 0) return { t: 'roll' };
  if (!t.dice) return null;

  if (level <= 0) {
    // Leicht: nach 1–3 Würfen aufhören; Feld: 60 % das mit den meisten Punkten, sonst irgendeines.
    const stop = t.rolls >= P.MAX_ROLLS || rng() < (t.rolls === 1 ? TUNE.S1 : TUNE.S2);
    if (!stop) return { t: 'roll', keep: randomKeep(t.dice, rng) };
    let cat;
    if (rng() < 0.6) {
      let best = -1;
      for (const c of free) {
        const s = P.scoreFor(c, t.dice) + rng() * 0.5;
        if (s > best) { best = s; cat = c; }
      }
    } else {
      // Zufällig – aber ein Feld, das etwas bringt, wenn es eines gibt (gestrichen wird nicht planvoll).
      const pos = free.filter((c) => P.scoreFor(c, t.dice) > 0);
      cat = pick(pos.length && rng() < TUNE.POS ? pos : free, rng);
    }
    return { t: 'score', cat };
  }

  // Mittel
  if (t.rolls >= P.MAX_ROLLS) {
    const noise = 5;
    let best = -Infinity; let cat = free[0];
    for (const c of free) { const g = gain(c, t.dice) + (rng() - 0.5) * noise; if (g > best) { best = g; cat = c; } }
    return { t: 'score', cat };
  }
  const plan = planKeep(t.dice, free, rng, 3);
  if (plan.stop) {
    let best = -Infinity; let cat = plan.cat;
    for (const c of free) { const g = gain(c, t.dice) + (rng() - 0.5) * 5; if (g > best) { best = g; cat = c; } }
    return { t: 'score', cat };
  }
  return { t: 'roll', keep: plan.keep };
}
