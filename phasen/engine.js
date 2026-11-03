// Phasenwürfeln – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Regeln nach der Ravensburger-Anleitung "Phase 10 Würfel".

export const COLORS = ['B', 'R', 'O', 'G'];
export const COLOR_NAMES = { B: 'Blau', R: 'Rot', O: 'Orange', G: 'Grün' };
export const NUM_DICE = 10;
export const MAX_ATTEMPTS = 3;
export const BONUS = 40;
export const BONUS5_MIN_POINTS = 221; // "mehr als 220 Punkte" nach Phase 5

const set = (n) => ({ t: 'set', n });
const run = (n) => ({ t: 'run', n });
// Die Phasenliste steht auf dem Block. Phase 1, 3, 4, 8 sind durch die Anleitung belegt, der Rest ist die Standardliste.
export const PHASES = [
  { no: 1, name: 'Zwei Drillinge', parts: [set(3), set(3)], text: 'Zweimal drei gleiche Zahlen. Es darf auch zweimal dieselbe Zahl sein.' },
  { no: 2, name: 'Drilling + Viererfolge', parts: [set(3), run(4)], text: 'Drei gleiche Zahlen und vier aufeinanderfolgende Zahlen (z. B. 3‑4‑5‑6).' },
  { no: 3, name: 'Vierling + Viererfolge', parts: [set(4), run(4)], text: 'Vier gleiche Zahlen und vier aufeinanderfolgende Zahlen (z. B. 3‑4‑5‑6).' },
  { no: 4, name: 'Siebenerfolge', parts: [run(7)], text: 'Sieben aufeinanderfolgende Zahlen (z. B. 2‑3‑4‑5‑6‑7‑8).' },
  { no: 5, name: 'Achterfolge', parts: [run(8)], text: 'Acht aufeinanderfolgende Zahlen (z. B. 1‑2‑3‑4‑5‑6‑7‑8).' },
  { no: 6, name: 'Neunerfolge', parts: [run(9)], text: 'Neun aufeinanderfolgende Zahlen (1 bis 9 oder 2 bis 10).' },
  { no: 7, name: 'Zwei Vierlinge', parts: [set(4), set(4)], text: 'Zweimal vier gleiche Zahlen. Es darf auch zweimal dieselbe Zahl sein.' },
  { no: 8, name: 'Sieben in einer Farbe', flush: 7, parts: [], text: 'Sieben Würfel in derselben Farbe. Zahlen sind egal. Ein Joker zählt hier nur in seiner eigenen Farbe.' },
  { no: 9, name: 'Fünfling + Zwilling', parts: [set(5), set(2)], text: 'Fünf gleiche Zahlen und zwei gleiche Zahlen.' },
  { no: 10, name: 'Fünfling + Drilling', parts: [set(5), set(3)], text: 'Fünf gleiche Zahlen und drei gleiche Zahlen.' },
];

// ---------- Würfel ----------
const HIGH = [5, 6, 7, 8, 9, 10]; // 6 Würfel
const LOW = [1, 2, 3, 4, 'W', 'W']; // 4 Würfel
export const dieFaces = (d) => (d < 6 ? HIGH : LOW);
// Die genaue Farbverteilung steht nicht in der Anleitung; jeder Würfel hat eine eigene Mischung der vier Farben.
export const dieColor = (d, f) => (f < 4 ? COLORS[(d + f) % 4] : f === 4 ? COLORS[(d + 1) % 4] : COLORS[(d + 2) % 4]);
export function rollDie(d, rng = Math.random) {
  const f = Math.min(5, Math.floor(rng() * 6));
  return { v: dieFaces(d)[f], c: dieColor(d, f) };
}
const val = (die) => (die.v === 'W' ? 0 : die.v);

// ---------- Auswertung einer Phase ----------
function needOptions(part) {
  if (part.t === 'set') return Array.from({ length: 10 }, (_, i) => ({ [i + 1]: part.n }));
  const out = [];
  for (let s = 1; s + part.n - 1 <= 10; s++) {
    const o = {};
    for (let k = 0; k < part.n; k++) o[s + k] = 1;
    out.push(o);
  }
  return out;
}
function allNeeds(parts) {
  let res = [{}];
  for (const p of parts) {
    const opts = needOptions(p);
    res = res.flatMap((r) => opts.map((o) => {
      const m = { ...r };
      for (const [n, k] of Object.entries(o)) m[n] = (m[n] || 0) + k;
      return m;
    }));
  }
  return res;
}
function indexDice(dice) {
  const byNum = {};
  const wild = [];
  dice.forEach((d, i) => {
    if (d.v === 'W') wild.push(i);
    else (byNum[d.v] ||= []).push(i);
  });
  return { byNum, wild };
}
function useNeed(need, byNum, wild) {
  const used = [];
  let missing = 0;
  let score = 0;
  const missingNums = [];
  for (const [n, k] of Object.entries(need)) {
    const have = byNum[n] || [];
    const take = Math.min(k, have.length);
    for (let j = 0; j < take; j++) used.push({ i: have[j], as: Number(n) });
    score += take * Number(n);
    for (let j = take; j < k; j++) { missing += 1; missingNums.push(Number(n)); }
  }
  return { used, missing, score, missingNums };
}

export function evaluate(dice, phaseNo) {
  const ph = PHASES[phaseNo - 1];
  if (!dice) return { ok: false, score: 0, used: [] };
  if (ph.flush) {
    let best = { ok: false, score: 0, used: [] };
    for (const c of COLORS) {
      const idx = dice.map((d, i) => i).filter((i) => dice[i].c === c).sort((a, b) => val(dice[b]) - val(dice[a]));
      if (idx.length < ph.flush) continue;
      const pick = idx.slice(0, ph.flush);
      const score = pick.reduce((s, i) => s + val(dice[i]), 0);
      if (!best.ok || score > best.score) best = { ok: true, score, used: pick.map((i) => ({ i, as: dice[i].v })) };
    }
    return best;
  }
  const { byNum, wild } = indexDice(dice);
  let best = { ok: false, score: 0, used: [] };
  for (const need of allNeeds(ph.parts)) {
    const r = useNeed(need, byNum, wild);
    if (r.missing > wild.length) continue;
    if (!best.ok || r.score > best.score) {
      const used = r.used.concat(r.missingNums.map((n, j) => ({ i: wild[j], as: n })));
      best = { ok: true, score: r.score, used };
    }
  }
  return best;
}

// Nur für Tests (Computergegner in den Zufallspartien). In der Oberfläche gibt es bewusst keine Vorschläge.
export function suggestKeep(dice, phaseNo) {
  const ev = evaluate(dice, phaseNo);
  if (ev.ok) return ev.used.map((u) => u.i);
  const ph = PHASES[phaseNo - 1];
  if (ph.flush) {
    let bestIdx = [];
    for (const c of COLORS) {
      const idx = dice.map((d, i) => i).filter((i) => dice[i].c === c).sort((a, b) => val(dice[b]) - val(dice[a]));
      if (idx.length > bestIdx.length) bestIdx = idx;
    }
    return bestIdx.slice(0, ph.flush);
  }
  const { byNum, wild } = indexDice(dice);
  let best = null;
  for (const need of allNeeds(ph.parts)) {
    const r = useNeed(need, byNum, wild);
    const wilds = Math.min(r.missing, wild.length);
    const cover = r.used.length + wilds;
    if (!best || cover > best.cover || (cover === best.cover && r.score > best.score)) {
      best = { cover, score: r.score, idx: r.used.map((u) => u.i).concat(wild.slice(0, wilds)) };
    }
  }
  return best ? best.idx : [];
}

// ---------- Spielstand ----------
export const totalOf = (p) => p.scores.reduce((s, x) => s + (x || 0), 0) + (p.bonus5 || 0) + (p.bonus10 || 0);

function newTurn(state, final = false) {
  const p = state.players[state.active];
  return { stage: 'roll', attempt: 0, dice: null, kept: null, eval: null, startPhase: p.phaseNo, final, started: false };
}

export function createGame(playerList) {
  const state = {
    game: 'p10',
    mode: 'normal', // 'normal' | 'final' | 'over'
    players: playerList.map((p) => ({ id: p.id, name: p.name, phaseNo: 1, scores: Array(10).fill(null), bonus5: null, bonus10: 0, stopped: false })),
    active: 0,
    round: 1,
    finisher: null,
    queue: [],
    rollId: 0,
    recap: [],
    endReason: null,
    turn: null,
  };
  state.turn = newTurn(state);
  return state;
}

export const activePlayer = (state) => state.players[state.active];

export function roll(state, pid, keep, rng = Math.random) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(state);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const t = state.turn;
  if (t.stage === 'roll') {
    if (!t.started) { state.recap = []; t.started = true; }
    t.dice = Array.from({ length: NUM_DICE }, (_, d) => rollDie(d, rng));
    t.kept = Array(NUM_DICE).fill(false);
    t.attempt = 1;
    t.stage = 'choose';
  } else if (t.stage === 'choose') {
    if (t.attempt >= MAX_ATTEMPTS) return { ok: false, error: 'Du hast keine Würfe mehr übrig.' };
    const k = Array.isArray(keep) && keep.length === NUM_DICE ? keep.map(Boolean) : Array(NUM_DICE).fill(false);
    if (k.every(Boolean)) return { ok: false, error: 'Du musst mindestens einen Würfel neu würfeln.' };
    t.dice = t.dice.map((d, i) => (k[i] ? d : rollDie(i, rng)));
    t.kept = k;
    t.attempt += 1;
  } else {
    return { ok: false, error: 'Es kann gerade nicht gewürfelt werden.' };
  }
  t.eval = evaluate(t.dice, p.phaseNo);
  state.rollId += 1;
  return { ok: true };
}

function record(state, p, idx, score) {
  const no = p.phaseNo;
  p.scores[no - 1] = score;
  state.recap.push(`${p.name}: Phase ${no} geschafft – ${score} Punkte eingetragen`);
  if (no === 5) {
    p.bonus5 = totalOf(p) >= BONUS5_MIN_POINTS ? BONUS : 0;
    state.recap.push(p.bonus5 ? `${p.name}: 5‑Phasen‑Bonus (+${BONUS}) – mehr als 220 Punkte!` : `${p.name}: kein 5‑Phasen‑Bonus (unter 221 Punkte)`);
  }
  p.phaseNo += 1;
}

export function finish(state, pid, note = true) {
  if (state.mode === 'over') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(state);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const t = state.turn;
  if (t.stage !== 'choose') return { ok: false, error: 'Bitte zuerst würfeln.' };
  const idx = state.active;
  const ev = t.eval;

  if (ev.ok) {
    if (!t.final && note === false) {
      state.recap.push(`${p.name}: Phase ${p.phaseNo} geschafft, Punkte aber nicht eingetragen (Phase wird wiederholt)`);
      return endTurn(state);
    }
    record(state, p, idx, ev.score);
    if (p.phaseNo > 10) {
      if (state.finisher === null) {
        state.finisher = idx;
        p.bonus10 = BONUS;
        state.recap.push(`${p.name}: Alle 10 Phasen geschafft! 10‑Phasen‑Bonus (+${BONUS})`);
        state.mode = 'final';
        const n = state.players.length;
        state.queue = Array.from({ length: n - 1 }, (_, k) => (idx + 1 + k) % n);
        state.active = state.queue[0];
        state.turn = newTurn(state, true);
        return { ok: true };
      }
      // Letzte Runde: Bonus nur, wenn der Zug in Phase 10 begann und die Person nach dem Ersten (gleiche Runde) dran ist
      if (t.startPhase === 10 && idx > state.finisher) {
        p.bonus10 = BONUS;
        state.recap.push(`${p.name}: Alle 10 Phasen geschafft! 10‑Phasen‑Bonus (+${BONUS}) – ebenfalls in derselben Runde`);
      } else {
        state.recap.push(`${p.name}: Alle 10 Phasen geschafft!`);
      }
      return endTurn(state);
    }
    if (t.final) {
      // Am Stück weiter mit der nächsten Phase
      state.turn = { ...newTurn(state, true), startPhase: t.startPhase, started: true };
      return { ok: true };
    }
    return endTurn(state);
  }

  if (t.attempt < MAX_ATTEMPTS) return { ok: false, error: 'Du hast noch Würfe übrig.' };
  if (t.final) {
    p.stopped = true;
    state.recap.push(`${p.name}: Phase ${p.phaseNo} nicht geschafft – das Spiel ist für ${p.name} zu Ende`);
  } else {
    state.recap.push(`${p.name}: Phase ${p.phaseNo} nicht geschafft – im nächsten Zug noch einmal`);
  }
  return endTurn(state);
}

function endTurn(state) {
  if (state.mode === 'normal') {
    state.active = (state.active + 1) % state.players.length;
    if (state.active === 0) state.round += 1;
    state.turn = newTurn(state);
  } else {
    state.queue.shift();
    if (state.queue.length === 0) {
      state.mode = 'over';
      state.endReason = 'Alle haben ihre letzte Runde gespielt.';
      state.turn = null;
    } else {
      state.active = state.queue[0];
      state.turn = newTurn(state, true);
    }
  }
  return { ok: true };
}

export function ranking(state) {
  return state.players
    .map((p) => ({
      id: p.id, name: p.name, total: totalOf(p), finished: p.phaseNo > 10, phaseNo: p.phaseNo,
      maxSingle: Math.max(0, ...p.scores.map((x) => x || 0)), scores: p.scores, bonus5: p.bonus5, bonus10: p.bonus10,
    }))
    .sort((a, b) => (Number(b.finished) - Number(a.finished)) || (b.total - a.total) || (b.maxSingle - a.maxSingle));
}
