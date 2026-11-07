// Kneipenquiz – Computergegner (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel.
//
// WICHTIG: Hier gibt es keine echte künstliche Intelligenz. Der Computer ist ein simulierter Mitspieler:
// chooseAction(state, botId, level, rng) kennt die Lösung der aktuellen Frage und "würfelt" damit nur eine
// Trefferquote per rng aus (so wie ein Mensch, der es mal weiß und mal nicht). Das ist kein Schummeln im
// Sinne der Spielwirkung: Der Computer sieht nie die Antworten der anderen und nutzt keinen Joker.
//
//   Trefferquote  mc/tf:  Leicht 45 % (daneben: geraten, mit Vorliebe für die ersten Antworten),
//                         Mittel 70 % (mc) und 80 % (tf)
//   Schätzfragen:         Abweichung zufällig und gleichverteilt bis ±50 % (Leicht) bzw. ±15 % (Mittel) von c
//                         (liegt c nahe 0, bezogen auf 10 % der Spanne), gerundet auf die Reglerschritte
//   Reihenfolge:          je Element richtig: Leicht 40 %, Mittel 70 %
//   Antwortzeit:          2 bis 6 Sekunden (thinkDelay)
import * as E from './engine.js';

export const RATES = { mc: [0.45, 0.7], tf: [0.45, 0.8], order: [0.4, 0.7] };
export const EST_ERR = [0.5, 0.15];
export const DELAY_MIN = 2000;
export const DELAY_MAX = 6000;

export const thinkDelay = (rng = Math.random) => Math.round(DELAY_MIN + rng() * (DELAY_MAX - DELAY_MIN));

function chooseMc(q, level, rng) {
  if (rng() < RATES.mc[level]) return q.c;
  const wrong = [0, 1, 2, 3].filter((i) => i !== q.c);
  // Verzerrung: Wer rät, nimmt eher die oberen Antworten
  const w = wrong.map((_, k) => 3 - k);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < wrong.length; k++) { r -= w[k]; if (r < 0) return wrong[k]; }
  return wrong[wrong.length - 1];
}

function chooseEst(q, level, rng) {
  const range = q.max - q.min;
  const base = Math.max(Math.abs(q.c), 0.1 * range);
  const err = (rng() * 2 - 1) * EST_ERR[level] * base;
  const st = E.estStep(q);
  let v = q.c + err;
  v = q.min + Math.round((v - q.min) / st) * st;
  v = Math.min(q.max, Math.max(q.min, v));
  return Number(v.toPrecision(12));
}

function chooseOrder(q, level, rng) {
  const n = q.items.length;
  const p = RATES.order[level];
  let m = 0;
  for (let i = 0; i < n; i++) if (rng() < p) m++;
  if (m === n - 1) m = rng() < 0.5 ? n : n - 2; // genau n-1 Treffer gibt es nicht
  const fixedCount = (perm) => perm.filter((v, i) => v === i).length;
  const id = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < 200; k++) {
    const perm = E.shuffle(id, rng);
    if (fixedCount(perm) === m) return perm;
  }
  return id;
}

// Gibt die Nachricht { t:'answer', v } für den Computer zurück oder null, wenn er nichts tun kann.
export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== 'qz' || state.phase !== 'ask') return null;
  if (!state.players.some((p) => p.id === botId) || botId in state.answers) return null;
  const q = state.qs[state.qi];
  const lv = level === 1 ? 1 : 0;
  let v;
  if (q.t === 'mc') v = chooseMc(q, lv, rng);
  else if (q.t === 'tf') v = rng() < RATES.tf[lv] ? q.c : !q.c;
  else if (q.t === 'est') v = chooseEst(q, lv, rng);
  else v = chooseOrder(q, lv, rng);
  return { t: 'answer', q: state.qi, v };
}
