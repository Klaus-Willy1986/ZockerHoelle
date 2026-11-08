// Zehntausend – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.
// Der Zustand ist reines JSON.

export const NUM_DICE = 6;
export const TARGET = 10000;
export const SHORT_TARGET = 5000;
export const ENTRY = 500;
export const MAX_PLAYERS = 6;

export const DEFAULT_OPTS = { pairs: true, entry: true, short: false };
export function normOpts(o) {
  const x = o && typeof o === 'object' ? o : {};
  return { pairs: x.pairs !== false, entry: x.entry !== false, short: !!x.short };
}
export const targetOf = (state) => (state && state.opts && state.opts.short ? SHORT_TARGET : TARGET);

// ---------- Wertung ----------
const TRIPLE = { 1: 1000, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600 };
const MULT = { 3: 1, 4: 2, 5: 4, 6: 8 };

const countsOf = (vals) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of vals) c[v] += 1;
  return c;
};

// Beste Wertung für genau diese Würfel, wenn JEDER dieser Würfel zur Wertung gehören muss.
// Ergebnis 0 = keine gültige Wertung (mindestens ein Würfel zählt nicht oder Auswahl leer).
export function scoreExact(vals, opts) {
  if (!Array.isArray(vals) || vals.length < 1 || vals.length > NUM_DICE) return 0;
  if (!vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)) return 0;
  const o = normOpts(opts);
  const c = countsOf(vals);
  let best = 0;
  if (vals.length === 6) {
    if (c.slice(1).every((n) => n === 1)) best = Math.max(best, 1500);
    if (o.pairs && c.slice(1).filter((n) => n === 2).length === 3) best = Math.max(best, 1000);
  }
  // Je Augenzahl: Satz aus m >= 3 gleichen plus Einzelwürfel (nur bei 1 und 5) oder nur Einzelwürfel
  let total = 0;
  let valid = true;
  for (let v = 1; v <= 6 && valid; v++) {
    const n = c[v];
    if (n === 0) continue;
    const single = v === 1 ? 100 : v === 5 ? 50 : 0;
    let bv = -1;
    for (let m = 0; m <= n; m++) {
      if (m !== 0 && m < 3) continue;
      const rest = n - m;
      if (rest > 0 && !single) continue;
      const p = (m ? TRIPLE[v] * MULT[m] : 0) + rest * single;
      if (p > bv) bv = p;
    }
    if (bv < 0) valid = false; else total += bv;
  }
  if (valid) best = Math.max(best, total);
  return best;
}

const subsetValues = (vals, mask) => vals.filter((_, i) => mask & (1 << i));

// Bringt der Wurf überhaupt irgendeine Wertung? (sonst Patzer)
export function hasScoring(vals, opts) {
  if (!Array.isArray(vals) || !vals.length) return false;
  for (let m = 1; m < (1 << vals.length); m++) if (scoreExact(subsetValues(vals, m), opts) > 0) return true;
  return false;
}

// Beste Teilmenge für den Computer: maximale Punkte; bei Gleichstand die mit mehr übrigen Würfeln
// (preferMore = false: bei Gleichstand die mit weniger übrigen Würfeln). null bei Patzer.
export function bestSubset(vals, opts, preferMore = true) {
  if (!Array.isArray(vals)) return null;
  let best = null;
  for (let m = 1; m < (1 << vals.length); m++) {
    const pts = scoreExact(subsetValues(vals, m), opts);
    if (pts <= 0) continue;
    const used = subsetValues(vals, m).length;
    const better = !best || pts > best.pts || (pts === best.pts && (preferMore ? used < best.used : used > best.used));
    if (better) best = { mask: m, pts, used };
  }
  if (!best) return null;
  return { idx: vals.map((_, i) => i).filter((i) => best.mask & (1 << i)), pts: best.pts, left: vals.length - best.used };
}

// ---------- Spielstand ----------
const newTurn = () => ({ phase: 'start', dice: [], aside: [], pts: 0, last: 0, kept: [], rolls: 0, hot: false, result: null });

export function rollDie(rng = Math.random) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

export function createGame(playerList, opts, rng = Math.random) {
  const o = normOpts(opts);
  return {
    game: 'zt',
    gid: Math.floor(rng() * 1e9),
    mode: 'play', // 'play' | 'over'
    opts: o,
    players: playerList.map((p) => ({ id: p.id, name: p.name, score: 0, entered: false, turns: 0 })),
    active: 0,
    round: 1,
    rollId: 0,
    finalFrom: null, // Index der Person, die das Ziel erreicht hat (Schlussrunde läuft)
    finalLeft: 0, // so viele Personen haben in der Schlussrunde noch einen Zug
    recap: [],
    turn: newTurn(),
  };
}

export const activePlayer = (state) => state.players[state.active];
export const diceLeft = (turn) => (turn.hot ? NUM_DICE : NUM_DICE - turn.aside.length);
// Darf die Person jetzt aufhören (Einstiegshürde)?
export function canBank(state, p, turn) {
  if (!turn || turn.phase !== 'after' || turn.pts <= 0) return false;
  if (state.opts.entry && !p.entered && turn.pts < ENTRY) return false;
  return true;
}

const err = (error) => ({ ok: false, error });
function check(state, pid) {
  if (!state || state.mode !== 'play') return err('Das Spiel ist zu Ende.');
  const p = activePlayer(state);
  if (!p || p.id !== pid) return err('Du bist nicht an der Reihe.');
  return null;
}

export function roll(state, pid, rng = Math.random) {
  const e = check(state, pid);
  if (e) return e;
  const t = state.turn;
  if (t.phase !== 'start' && t.phase !== 'after') return err('Du kannst jetzt nicht würfeln.');
  let n;
  if (t.phase === 'start') n = NUM_DICE;
  else if (t.hot) { n = NUM_DICE; t.aside = []; t.hot = false; } else n = NUM_DICE - t.aside.length;
  if (n < 1) return err('Du hast keine Würfel mehr.');
  state.recap = [];
  t.dice = Array.from({ length: n }, () => rollDie(rng));
  t.rolls += 1;
  state.rollId += 1;
  const p = activePlayer(state);
  if (!hasScoring(t.dice, state.opts)) {
    // Patzer
    const lost = t.pts;
    t.phase = 'end';
    t.result = { kind: 'patzer', lost };
    t.pts = 0;
    p.turns += 1;
    state.recap = [`${p.name}: Patzer – nichts gewertet, ${lost} Punkte des Zugs sind weg.`];
    afterTurnEnded(state);
    return { ok: true, patzer: true };
  }
  t.phase = 'pick';
  return { ok: true };
}

export function keep(state, pid, idx) {
  const e = check(state, pid);
  if (e) return e;
  const t = state.turn;
  if (t.phase !== 'pick') return err('Du kannst jetzt keine Würfel zur Seite legen.');
  if (!Array.isArray(idx) || idx.length < 1 || idx.length > t.dice.length) return err('Bitte wähle Würfel aus.');
  const set = new Set();
  for (const i of idx) {
    if (!Number.isInteger(i) || i < 0 || i >= t.dice.length || set.has(i)) return err('Ungültige Auswahl.');
    set.add(i);
  }
  const vals = [...set].sort((a, b) => a - b).map((i) => t.dice[i]);
  const pts = scoreExact(vals, state.opts);
  if (pts <= 0) return err('Diese Würfel ergeben keine Wertung.');
  t.pts += pts;
  t.aside = t.aside.concat(vals);
  t.last = pts;
  t.kept = [...set].sort((a, b) => a - b);
  t.hot = t.aside.length === NUM_DICE;
  t.phase = 'after';
  return { ok: true, pts };
}

export function bank(state, pid) {
  const e = check(state, pid);
  if (e) return e;
  const t = state.turn;
  const p = activePlayer(state);
  if (t.phase !== 'after') return err('Du kannst jetzt nicht aufhören.');
  if (!canBank(state, p, t)) return err(`Du brauchst in einem Zug mindestens ${ENTRY} Punkte, bevor du aufhören darfst.`);
  const got = t.pts;
  p.score += got;
  p.entered = true;
  p.turns += 1;
  t.result = { kind: 'bank', pts: got };
  t.phase = 'end';
  state.recap = [`${p.name}: ${got} Punkte gebucht, Konto: ${p.score}.`];
  const target = targetOf(state);
  if (state.finalFrom == null && p.score >= target) {
    if (state.players.length === 1) { state.mode = 'over'; return { ok: true, over: true }; }
    state.finalFrom = state.active;
    state.finalLeft = state.players.length - 1;
    state.recap.push(`${p.name} hat ${target} Punkte erreicht! Alle anderen haben noch einen Zug.`);
  }
  afterTurnEnded(state);
  return { ok: true };
}

// Zugende (Patzer oder Buchen): prüft, ob die Schlussrunde damit zu Ende ist.
function afterTurnEnded(state) {
  if (state.finalFrom == null || state.active === state.finalFrom) return;
  state.finalLeft -= 1;
  if (state.finalLeft <= 0) state.mode = 'over';
}

export function next(state, pid) {
  const e = check(state, pid);
  if (e) return e;
  const t = state.turn;
  if (t.phase !== 'end') return err('Der Zug läuft noch.');
  const n = state.players.length;
  state.active = (state.active + 1) % n;
  if (state.active === 0) state.round += 1;
  state.turn = newTurn();
  return { ok: true };
}

export function handle(state, pid, msg, rng = Math.random) {
  if (!msg || typeof msg !== 'object') return err('Ungültige Nachricht.');
  switch (msg.t) {
    case 'roll': return roll(state, pid, rng);
    case 'keep': return keep(state, pid, msg.idx);
    case 'bank': return bank(state, pid);
    case 'next': return next(state, pid);
    default: return err('Unbekannte Nachricht.');
  }
}

// Rangliste; gleiche Punktzahl = gleicher Platz (tie); Gewinner = alle mit der höchsten Punktzahl.
export function ranking(state) {
  const list = state.players
    .map((p) => ({ id: p.id, name: p.name, score: p.score, turns: p.turns }))
    .sort((a, b) => b.score - a.score);
  list.forEach((r, i) => { r.place = i > 0 && list[i - 1].score === r.score ? list[i - 1].place : i + 1; });
  list.forEach((r) => { r.tie = list.filter((x) => x.place === r.place).length > 1; });
  return list;
}
export const winners = (state) => ranking(state).filter((r) => r.place === 1);
