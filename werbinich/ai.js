// Wer bin ich? – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel.
//
// Der Computer schummelt nicht: Er kennt nur die Kategorie und die bisherigen Antworten (state.asked) und
// die falsch geratenen Begriffe. Den geheimen Begriff (state.terms) liest er nie.
//   Mittel:  fragt die Frage mit dem größten Informationsgewinn über die noch möglichen Begriffe,
//            rät, sobald höchstens 2 Begriffe übrig sind.
//   Leicht:  fragt zufällig, rät, sobald höchstens 4 Begriffe übrig sind. Er berücksichtigt aber nur die
//            Antworten auf seine eigenen Fragen und nur etwa zwei von fünf Antworten der anderen (den Rest überhört er).
//   Beide:   mit 10 % Wahrscheinlichkeit vertippt sich der Computer beim Raten (ein anderer Begriff der Kategorie).
import { BEGRIFFE, FRAGEN } from './begriffe.js';

export const GUESS_AT = [4, 2];
export const SLIP = 0.1;
const clampIdx = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

// Welche Antworten der Computer berücksichtigt: Mittel alle, Leicht die auf seine eigenen Fragen und etwa zwei von fünf fremden
// (er "überhört" einen großen Teil dessen, was die anderen gefragt haben, wie ein zerstreuter Mitspieler).
export function known(state, botId, level) {
  return level === 1 || !botId ? state.asked : state.asked.filter((x, i) => x.by === botId || i % 5 < 2);
}

// Begriffe der Kategorie, die zu den berücksichtigten Antworten passen (und noch nicht falsch geraten wurden)
export function candidates(state, botId, level = 1) {
  const cat = state.cats && state.cats[state.round];
  const wrong = new Set((state.wrong || []).map((w) => w.id));
  const ans = known(state, botId, level);
  return BEGRIFFE.filter((b) => b.k === cat && !wrong.has(b.id) && ans.every((x) => b.a[x.q] === x.a));
}

// Informationsgewinn (Entropie der Antwortverteilung) einer Frage über die Kandidaten
export function gain(cands, qid) {
  const n = cands.length;
  if (!n) return 0;
  const c = { ja: 0, nein: 0, teils: 0 };
  for (const b of cands) c[b.a[qid]] += 1;
  let h = 0;
  for (const v of Object.values(c)) if (v) { const p = v / n; h -= p * Math.log2(p); }
  return h;
}

export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== 'wb' || state.phase !== 'ask') return null;
  const cur = state.players[state.turn];
  if (!cur || cur.id !== botId) return null;
  const lv = level === 1 ? 1 : 0;
  const cands = candidates(state, botId, lv);
  const asked = new Set(state.asked.map((x) => x.q));
  const free = FRAGEN.filter((f) => !asked.has(f.id));
  const r = state.round;

  let ask = null;
  if (cands.length > GUESS_AT[lv] && free.length) {
    if (lv === 1) {
      let best = 0; let pool = [];
      for (const f of free) {
        const g = gain(cands, f.id);
        if (g > best + 1e-9) { best = g; pool = [f]; } else if (g > 0 && Math.abs(g - best) <= 1e-9) pool.push(f);
      }
      if (pool.length) ask = pool[clampIdx(rng, pool.length)];
    } else {
      ask = free[clampIdx(rng, free.length)];
    }
  }
  if (ask) return { t: 'ask', q: ask.id, r };

  // Raten
  const wrong = new Set((state.wrong || []).map((w) => w.id));
  const cat = state.cats && state.cats[state.round];
  const all = BEGRIFFE.filter((b) => b.k === cat && !wrong.has(b.id));
  if (!all.length) return null;
  const pool = cands.length && rng() >= SLIP ? cands : all;
  return { t: 'guess', id: pool[clampIdx(rng, pool.length)].id, r };
}

// Wie lange sich der Computer Zeit lässt, steht in app.js (bot.delay).
