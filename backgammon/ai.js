// Backgammon – Computergegner (reine Funktionen, keine Oberfläche).
// chooseAction(state, botId, level, rng) liefert eine ganz normale Nachricht ({t:'roll'} oder {t:'move',from,to,die}) oder null.
// level 0 = Leicht: zufälliger legaler Zugplan, schlägt aber mit 50 % einen Blot, wenn es geht.
// level 1 = Mittel: bewertet alle vollständigen Zugfolgen des Wurfs mit einer Heuristik (Augenzahl, Blots mit Trefferwahrscheinlichkeit,
//           gebaute Spitzen/Blockade, Bar, Heimfeld) und nimmt die beste; mit 10 % eine der drei besten.
// Der Computer kennt nur das offene Brett und den eigenen Wurf (Würfel der Zukunft kennt niemand).
import * as P from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

export const MEDIUM_SLIP = 0.1;
export const EASY_HIT_CHANCE = 0.5;

// Wahrscheinlichkeit (über 36 Würfe), dass die Gegenseite meinen Blot auf meiner Spitze q schlägt
function hitProb(me, op, q) {
  const target = 25 - q; // dieselbe Spitze aus Sicht der Gegenseite
  const barred = op[25] > 0;
  const srcs = [];
  for (let s = barred ? 25 : target + 1; s <= 25; s++) if (op[s] > 0 && s - target >= 1 && (!barred || s === 25)) srcs.push(s - target);
  if (!srcs.length) return 0;
  // Spitze, die ein Gegnerstein auf dem Weg betritt, ist blockiert, wenn ich dort 2 oder mehr Steine habe
  const open = (s, step) => me[25 - (s - step)] < 2;
  let n = 0;
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      let hit = false;
      for (const d of srcs) {
        const s = target + d;
        if (a === b) {
          for (let k = 1; k <= 4 && !hit; k++) {
            if (k * a !== d) continue;
            let ok = true;
            for (let j = 1; j < k; j++) if (!open(s, j * a)) ok = false;
            if (ok) hit = true;
          }
        } else if (a === d || b === d) hit = true;
        else if (a + b === d && (open(s, a) || open(s, b))) hit = true;
        if (hit) break;
      }
      if (hit) n++;
    }
  }
  return n / 36;
}

// Bewertung einer Stellung für Person p (größer = besser)
export function evalBoard(board, p) {
  const me = board[p];
  const op = board[1 - p];
  let myPip = 0; let opPip = 0; let maxQ = 0; let maxS = 0;
  for (let q = 1; q <= 25; q++) {
    myPip += q * me[q]; opPip += q * op[q];
    if (me[q] > 0) maxQ = q;
    if (op[q] > 0) maxS = q;
  }
  let s = opPip - myPip + 2 * me[0] - 2 * op[0];
  const contact = maxQ + maxS > 25;
  if (contact) {
    let homeMade = 0;
    let run = 0; let bestRun = 0;
    for (let q = 1; q <= 24; q++) {
      const c = me[q];
      if (c === 1) s -= hitProb(me, op, q) * (25 - q + 8);
      if (c >= 2) {
        if (q <= 6) { s += 3 + (q >= 4 ? 1 : 0); homeMade++; } else if (q >= 19) s += q === 20 || q === 21 ? 4 : 3; else s += 2;
        run++;
        if (run > bestRun) bestRun = run;
      } else run = 0;
      if (c > 4) s -= (c - 4) * 2;
    }
    s += bestRun * bestRun * 0.8;
    s += op[25] * (8 + 2 * homeMade);
    s -= me[25] * 8;
  } else {
    // reines Rennen: leere Lücken im Heimfeld sind schlecht, Stapel auf hohen Spitzen kosten
    let gaps = 0;
    for (let q = 1; q <= 6; q++) if (me[q] === 0 && (q < maxQ)) gaps++;
    s -= gaps * 0.5;
  }
  return s;
}

const cache = { key: '', n0: 0, moves: [] };

function sameMove(a, b) { return a.from === b.from && a.to === b.to && a.die === b.die; }

function makePlan(state, me, level, rng) {
  const all = P.plays(state);
  if (!all.length) return [];
  if (level <= 0) {
    const hits = all.filter((pl) => pl.moves.some((m) => m.hit));
    if (hits.length && rng() < EASY_HIT_CHANCE) return pick(hits, rng).moves;
    return pick(all, rng).moves;
  }
  const scored = all.map((pl) => ({ pl, s: evalBoard(pl.board, me) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored.length > 1 && rng() < MEDIUM_SLIP) return pick(scored.slice(0, 3), rng).pl.moves;
  return scored[0].pl.moves;
}

export function chooseAction(state, botId, level = 0, rng = Math.random) {
  if (!state || state.mode !== 'play' || !Array.isArray(state.players)) return null;
  const me = state.players.findIndex((p) => p.id === botId);
  if (me < 0 || state.turn !== me) return null;
  if (state.stage === 'roll') return { t: 'roll' };
  if (state.stage !== 'move') return null;
  const legal = P.legalMoves(state);
  if (!legal.length) return null;
  if (legal.length === 1) { const m = legal[0]; return { t: 'move', from: m.from, to: m.to, die: m.die }; }
  const key = `${state.gid}|${state.gameNo}|${state.rollId}|${me}|${level}`;
  let idx = cache.key === key ? cache.n0 - state.left.length : -1;
  let next = idx >= 0 ? cache.moves[idx] : null;
  if (!next || !legal.some((m) => sameMove(m, next))) {
    const moves = makePlan(state, me, level, rng);
    cache.key = key; cache.n0 = state.left.length; cache.moves = moves;
    next = moves[0];
    if (!next || !legal.some((m) => sameMove(m, next))) next = pick(legal, rng);
  }
  return { t: 'move', from: next.from, to: next.to, die: next.die };
}
