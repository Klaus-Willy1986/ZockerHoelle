// Schiffe versenken – Computergegner (reine Funktionen, keine Oberfläche).
// Der Computer entscheidet nur anhand seiner EIGENEN SICHT (viewOf): eigene Schüsse samt Ergebnis, versenkte Schiffe.
// Die gegnerische Flotte (g.fleets) wird hier nie gelesen.
//   level 0 = Leicht, level 1 = Mittel.
import { SIZE, CELLS, FLEET, cellOf, xOf, yOf, neighbors8 } from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Die Sicht der Person i: nichts, was sie nicht auch am Bildschirm sähe.
export function viewOf(g, i) {
  return {
    touch: !!(g.opts && g.opts.touch),
    shots: g.grid[i].slice(), // 100 Felder: null | 'w' | 'h' | 's'
    sunk: g.sunk[i].map((s) => ({ len: s.len, cells: s.cells.slice() })), // versenkte Schiffe (Länge, Felder)
  };
}

const neighbors4 = (c) => {
  const x = xOf(c); const y = yOf(c);
  const out = [];
  if (x > 0) out.push(c - 1);
  if (x < SIZE - 1) out.push(c + 1);
  if (y > 0) out.push(c - SIZE);
  if (y < SIZE - 1) out.push(c + SIZE);
  return out;
};
const unshot = (view) => view.shots.map((v, c) => (v === null ? c : -1)).filter((c) => c >= 0);
const openHits = (view) => view.shots.map((v, c) => (v === 'h' ? c : -1)).filter((c) => c >= 0);

// ---------- Leicht ----------
function easyShot(view, rng) {
  const hits = openHits(view);
  if (hits.length && rng() < 0.6) {
    const near = [...new Set(hits.flatMap(neighbors4))].filter((c) => view.shots[c] === null);
    if (near.length) return pick(near, rng);
  }
  return pick(unshot(view), rng);
}

// ---------- Mittel: Wahrscheinlichkeitsdichte über die noch möglichen Schiffslängen ----------
function remainingLens(view) {
  const lens = FLEET.map((f) => f.len);
  for (const s of view.sunk) {
    const k = lens.indexOf(s.len);
    if (k >= 0) lens.splice(k, 1);
  }
  return lens;
}

function mediumShot(view, rng) {
  const free = unshot(view);
  if (rng() < 0.1) return pick(free, rng); // gelegentlich ein Zufallsschuss
  const lens = remainingLens(view);
  const hits = openHits(view);
  const hitSet = new Set(hits);
  // Felder, die nicht mehr zu einem noch schwimmenden Schiff gehören können
  const dead = new Uint8Array(CELLS);
  view.shots.forEach((v, c) => { if (v === 'w' || v === 's') dead[c] = 1; });
  if (!view.touch) for (const s of view.sunk) for (const c of s.cells) neighbors8(c).forEach((n) => { if (view.shots[n] === null) dead[n] = 1; });

  const score = new Float64Array(CELLS);
  const targetScore = new Float64Array(CELLS);
  let anyTarget = false;
  for (const len of lens) {
    for (const dir of [0, 1]) {
      const maxX = dir === 0 ? SIZE - len : SIZE - 1;
      const maxY = dir === 1 ? SIZE - len : SIZE - 1;
      for (let y = 0; y <= maxY; y++) for (let x = 0; x <= maxX; x++) {
        const cells = [];
        let ok = true;
        let covered = 0;
        for (let k = 0; k < len; k++) {
          const c = cellOf(dir === 0 ? x + k : x, dir === 1 ? y + k : y);
          if (dead[c]) { ok = false; break; }
          if (hitSet.has(c)) covered++;
          cells.push(c);
        }
        if (!ok) continue;
        if (!view.touch && hits.length) {
          // ein offener Treffer direkt neben dem Schiff, aber nicht darin: das wäre eine Berührung
          const inShip = new Set(cells);
          if (cells.some((c) => neighbors8(c).some((n) => hitSet.has(n) && !inShip.has(n)))) continue;
        }
        if (covered > 0) {
          anyTarget = true;
          const w = covered * covered * 10;
          for (const c of cells) if (view.shots[c] === null) targetScore[c] += w;
        }
        for (const c of cells) if (view.shots[c] === null) score[c] += 1;
      }
    }
  }
  const use = anyTarget ? targetScore : score;
  let best = -1;
  let cand = [];
  for (const c of free) {
    if (use[c] > best + 1e-9) { best = use[c]; cand = [c]; } else if (Math.abs(use[c] - best) <= 1e-9) cand.push(c);
  }
  if (best <= 0) return pick(free, rng);
  return pick(cand, rng);
}

// view -> Feld-Nummer des Schusses
export function decideShot(view, level, rng = Math.random) {
  if (!unshot(view).length) return null;
  return level >= 1 ? mediumShot(view, rng) : easyShot(view, rng);
}

// Nachricht des Computers (oder null, wenn er gerade nichts zu tun hat)
export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g) return null;
  const i = g.players.findIndex((p) => p.id === botId);
  if (i < 0) return null;
  if (g.mode === 'setup') {
    if (g.ready[i]) return null;
    return g.fleets[i].every((s) => s.x !== null) ? { t: 'ready' } : { t: 'random' };
  }
  if (g.mode !== 'play' || g.turn !== i) return null;
  const c = decideShot(viewOf(g, i), level, rng);
  return c === null ? null : { t: 'shoot', x: xOf(c), y: yOf(c) };
}
