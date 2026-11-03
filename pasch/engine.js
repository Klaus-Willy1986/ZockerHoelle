// Pasch & Straße – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind.

export const NUM_DICE = 5;
export const MAX_ROLLS = 3;
export const BONUS_LIMIT = 63;
export const BONUS = 35;

export const CATS = [
  { id: 'ones', name: 'Einser', upper: true, face: 1, hint: 'Alle Einser zählen' },
  { id: 'twos', name: 'Zweier', upper: true, face: 2, hint: 'Alle Zweier zählen' },
  { id: 'threes', name: 'Dreier', upper: true, face: 3, hint: 'Alle Dreier zählen' },
  { id: 'fours', name: 'Vierer', upper: true, face: 4, hint: 'Alle Vierer zählen' },
  { id: 'fives', name: 'Fünfer', upper: true, face: 5, hint: 'Alle Fünfer zählen' },
  { id: 'sixes', name: 'Sechser', upper: true, face: 6, hint: 'Alle Sechser zählen' },
  { id: 'three', name: 'Dreierpasch', hint: 'Mindestens 3 gleiche – alle Augen zählen' },
  { id: 'four', name: 'Viererpasch', hint: 'Mindestens 4 gleiche – alle Augen zählen' },
  { id: 'full', name: 'Full House', hint: '3 gleiche + 2 gleiche – 25 Punkte' },
  { id: 'small', name: 'Kleine Straße', hint: '4 Zahlen der Reihe nach – 30 Punkte' },
  { id: 'large', name: 'Große Straße', hint: '5 Zahlen der Reihe nach – 40 Punkte' },
  { id: 'five', name: 'Fünferpasch', hint: 'Alle 5 gleich – 50 Punkte' },
  { id: 'chance', name: 'Chance', hint: 'Alle Augen zählen – immer möglich' },
];
export const CAT_IDS = CATS.map((c) => c.id);
export const catOf = (id) => CATS.find((c) => c.id === id);

const counts = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of dice) c[v] += 1;
  return c;
};
const sum = (dice) => dice.reduce((s, v) => s + v, 0);
const hasRun = (c, len) => {
  for (let s = 1; s + len - 1 <= 6; s++) {
    let ok = true;
    for (let k = 0; k < len; k++) if (c[s + k] === 0) ok = false;
    if (ok) return true;
  }
  return false;
};

// Punkte, die ein Feld mit diesen Würfeln ergibt (0, wenn der Wurf nicht passt).
export function scoreFor(cat, dice) {
  const def = catOf(cat);
  if (!def || !Array.isArray(dice) || dice.length !== NUM_DICE) return 0;
  const c = counts(dice);
  const max = Math.max(...c.slice(1));
  switch (cat) {
    case 'three': return max >= 3 ? sum(dice) : 0;
    case 'four': return max >= 4 ? sum(dice) : 0;
    case 'full': {
      const vals = c.slice(1).filter((n) => n > 0).sort((a, b) => a - b);
      const two3 = vals.length === 2 && vals[0] === 2 && vals[1] === 3;
      return two3 || max === 5 ? 25 : 0; // fünf gleiche zählen als Full House
    }
    case 'small': return hasRun(c, 4) ? 30 : 0;
    case 'large': return hasRun(c, 5) ? 40 : 0;
    case 'five': return max === 5 ? 50 : 0;
    case 'chance': return sum(dice);
    default: return def.face * c[def.face];
  }
}

// ---------- Zettel ----------
export const emptySheet = () => Object.fromEntries(CAT_IDS.map((id) => [id, null]));
export const upperSum = (sheet) => CATS.filter((c) => c.upper).reduce((s, c) => s + (sheet[c.id] || 0), 0);
export const bonusOf = (sheet) => (upperSum(sheet) >= BONUS_LIMIT ? BONUS : 0);
export const lowerSum = (sheet) => CATS.filter((c) => !c.upper).reduce((s, c) => s + (sheet[c.id] || 0), 0);
export const totalOf = (p) => upperSum(p.sheet) + bonusOf(p.sheet) + lowerSum(p.sheet);
export const filledCount = (sheet) => CAT_IDS.filter((id) => sheet[id] != null).length;
export const freeCats = (sheet) => CAT_IDS.filter((id) => sheet[id] == null);
// Rein informativ: so viele Punkte fehlen oben noch bis 63.
export const toBonus = (sheet) => Math.max(0, BONUS_LIMIT - upperSum(sheet));

// ---------- Spielstand ----------
const newTurn = () => ({ rolls: 0, dice: null, kept: null });

export function createGame(playerList) {
  return {
    game: 'pasch',
    mode: 'play', // 'play' | 'over'
    players: playerList.map((p) => ({ id: p.id, name: p.name, sheet: emptySheet() })),
    active: 0,
    round: 1,
    rollId: 0,
    recap: [],
    turn: newTurn(),
  };
}

export const activePlayer = (state) => state.players[state.active];

export function rollDie(rng = Math.random) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

export function roll(state, pid, keep, rng = Math.random) {
  if (!state || state.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(state);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const t = state.turn;
  if (t.rolls >= MAX_ROLLS) return { ok: false, error: 'Du hast keine Würfe mehr übrig.' };
  if (t.rolls === 0) {
    state.recap = [];
    t.dice = Array.from({ length: NUM_DICE }, () => rollDie(rng));
    t.kept = Array(NUM_DICE).fill(false);
  } else {
    if (!Array.isArray(keep) || keep.length !== NUM_DICE) return { ok: false, error: 'Ungültige Auswahl.' };
    const k = keep.map((x) => x === true);
    if (k.every(Boolean)) return { ok: false, error: 'Du musst mindestens einen Würfel neu würfeln.' };
    t.dice = t.dice.map((d, i) => (k[i] ? d : rollDie(rng)));
    t.kept = k;
  }
  t.rolls += 1;
  state.rollId += 1;
  return { ok: true };
}

export function score(state, pid, cat) {
  if (!state || state.mode !== 'play') return { ok: false, error: 'Das Spiel ist zu Ende.' };
  const p = activePlayer(state);
  if (p.id !== pid) return { ok: false, error: 'Du bist nicht an der Reihe.' };
  const t = state.turn;
  if (t.rolls < 1) return { ok: false, error: 'Bitte würfle zuerst.' };
  if (typeof cat !== 'string' || !CAT_IDS.includes(cat)) return { ok: false, error: 'Dieses Feld gibt es nicht.' };
  if (p.sheet[cat] != null) return { ok: false, error: 'Dieses Feld ist schon belegt.' };
  const pts = scoreFor(cat, t.dice);
  p.sheet[cat] = pts;
  const def = catOf(cat);
  state.recap = [pts === 0 ? `${p.name}: ${def.name} – gestrichen (0 Punkte)` : `${p.name}: ${def.name} – ${pts} Punkte`];
  if (def.upper && upperSum(p.sheet) >= BONUS_LIMIT && upperSum(p.sheet) - pts < BONUS_LIMIT) {
    state.recap.push(`${p.name}: Bonus erreicht! +${BONUS} Punkte`);
  }
  // Nächste Person
  const next = (state.active + 1) % state.players.length;
  if (state.players.every((q) => filledCount(q.sheet) === CAT_IDS.length)) {
    state.mode = 'over';
    state.turn = newTurn();
    return { ok: true };
  }
  if (next === 0) state.round += 1;
  state.active = next;
  state.turn = newTurn();
  return { ok: true };
}

// Rangliste; gleiche Punktzahl = gleicher Platz (tie), Gewinner = alle mit der höchsten Punktzahl.
export function ranking(state) {
  const list = state.players
    .map((p) => ({ id: p.id, name: p.name, total: totalOf(p), upper: upperSum(p.sheet), bonus: bonusOf(p.sheet), sheet: p.sheet }))
    .sort((a, b) => b.total - a.total);
  list.forEach((r, i) => { r.place = i > 0 && list[i - 1].total === r.total ? list[i - 1].place : i + 1; });
  list.forEach((r) => { r.tie = list.filter((x) => x.place === r.place).length > 1; });
  return list;
}
export const winners = (state) => ranking(state).filter((r) => r.place === 1);
