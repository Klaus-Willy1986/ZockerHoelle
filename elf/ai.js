// Elf voran – Computergegner (reine Funktionen, keine Oberfläche).
// Der Computer nutzt nur öffentliche Angaben und seine eigene Hand: Tisch, eigene Karten, Kartenzahlen, Strafpunkte.
// Die Karten der anderen kennt er nicht: Er schätzt sie, indem er die unbekannten Karten mehrmals zufällig verteilt
// (genau so viele Karten pro Person, wie diese wirklich hat) und die Runde durchspielt (Monte-Carlo).
// Stufen: 0 = Leicht (zufällige erlaubte Karte), 1 = Mittel (Monte-Carlo, 10 % Zufall).
import * as M from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const RANDOM_CHANCE = 0.1; // Mittel greift in 10 % der Fälle zu einer zufälligen erlaubten Karte
export let ROLLOUTS = 700; export const setRollouts = (n) => { ROLLOUTS = n; }; // Durchspiele pro Entscheidung (alle Kandidaten zusammen)
const MIN_PER_CARD = 10;
const MAX_ROLLOUTS = 3500;
export const AIP = { win: 10, diff: 1 };

// Eine Zufallsrunde ab der gegebenen Lage zu Ende spielen. lo/hi: Reihen (0 = nicht eröffnet), hands: Kartenlisten (s*22+r).
// Gibt für alle Personen die Strafpunkte dieser Fortsetzung zurück.
function rollout(lo, hi, hands, active, rng, out) {
  const n = hands.length;
  for (let i = 0; i < n; i++) out[i] = 0;
  let guard = 0;
  for (;;) {
    const h = hands[active];
    let cnt = 0;
    // zufällige spielbare Karte wählen (Reservoir)
    let chosen = -1;
    for (let k = 0; k < h.length; k++) {
      const c = h[k];
      const s = (c / 22) | 0;
      const r = c - s * 22;
      const l = lo[s];
      if (l === 0 ? r === 11 : (r === hi[s] + 1 && r <= 21) || (r === l - 1 && r >= 1)) {
        cnt += 1;
        if (cnt === 1 || rng() * cnt < 1) chosen = k;
      }
    }
    if (chosen < 0) {
      out[active] += 1;
    } else {
      const c = h[chosen];
      h[chosen] = h[h.length - 1];
      h.pop();
      const s = (c / 22) | 0;
      const r = c - s * 22;
      if (lo[s] === 0) { lo[s] = r; hi[s] = r; } else if (r === hi[s] + 1) hi[s] = r; else lo[s] = r;
      if (!h.length) {
        for (let i = 0; i < n; i++) if (i !== active) out[i] += hands[i].length;
        return;
      }
    }
    active = active + 1 === n ? 0 : active + 1;
    if (++guard > 3000) return;
  }
}

function mcChoose(g, ap, legal, rng) {
  const n = g.players.length;
  const meIdx = g.active;
  const mine = new Uint8Array(4 * 22);
  for (const c of ap.hand) mine[c.s * 22 + c.r] = 1;
  // unbekannte Karten = alles, was weder auf dem Tisch liegt noch bei mir ist
  const unseen = [];
  for (let s = 0; s < 4; s++) {
    const w = g.rows[s];
    for (let r = M.MIN_RANK; r <= M.MAX_RANK; r++) {
      if (w && r >= w.lo && r <= w.hi) continue;
      if (mine[s * 22 + r]) continue;
      unseen.push(s * 22 + r);
    }
  }
  // Gleicher Rechenaufwand pro Entscheidung: Je weniger Karten noch im Spiel sind, desto mehr Durchspiele sind möglich
  let left = 0;
  for (const p of g.players) left += p.hand.length;
  const budget = Math.min(MAX_ROLLOUTS, Math.floor((ROLLOUTS * M.TOTAL_CARDS) / Math.max(left, 1)));
  const per = Math.max(MIN_PER_CARD, Math.floor(budget / legal.length));
  const score = new Float64Array(legal.length);
  const out = new Array(n).fill(0);
  const lo = [0, 0, 0, 0];
  const hi = [0, 0, 0, 0];
  const pool = unseen.slice();
  const cap = new Array(n).fill(0);
  const dealt = Array.from({ length: n }, () => []);
  const lacks = g.players.map((p) => new Set(Array.isArray(p.lacks) ? p.lacks : []));
  for (let it = 0; it < per; it++) {
    // Karten der anderen zufällig verteilen
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    // Karten verteilen: Wer schon einmal passen musste, hat die damals anschließenden Karten nicht
    for (let i = 0; i < n; i++) { cap[i] = i === meIdx ? 0 : g.players[i].hand.length; dealt[i].length = 0; }
    for (let q = 0; q < pool.length; q++) {
      const c = pool[q];
      let tot = 0;
      for (let i = 0; i < n; i++) if (cap[i] > 0 && !lacks[i].has(c)) tot += cap[i];
      let who = -1;
      if (tot > 0) {
        let x = rng() * tot;
        for (let i = 0; i < n; i++) if (cap[i] > 0 && !lacks[i].has(c)) { who = i; x -= cap[i]; if (x < 0) break; }
      } else for (let i = 0; i < n; i++) if (cap[i] > 0) { who = i; break; }
      dealt[who].push(c);
      cap[who] -= 1;
    }
    for (let k = 0; k < legal.length; k++) {
      const c = legal[k];
      for (let s = 0; s < 4; s++) { const w = g.rows[s]; lo[s] = w ? w.lo : 0; hi[s] = w ? w.hi : 0; }
      const hands = [];
      for (let i = 0; i < n; i++) {
        if (i === meIdx) hands.push(ap.hand.filter((x) => !(x.s === c.s && x.r === c.r)).map((x) => x.s * 22 + x.r));
        else hands.push(dealt[i].slice());
      }
      const s = c.s;
      if (lo[s] === 0) { lo[s] = c.r; hi[s] = c.r; } else if (c.r === hi[s] + 1) hi[s] = c.r; else lo[s] = c.r;
      if (!hands[meIdx].length) {
        for (let i = 0; i < n; i++) out[i] = i === meIdx ? 0 : hands[i].length;
      } else rollout(lo, hi, hands, (meIdx + 1) % n, rng, out);
      let others = 0;
      let wins = 0;
      for (let i = 0; i < n; i++) if (i !== meIdx) { others += out[i]; if (out[meIdx] < out[i]) wins += 1; }
      score[k] += AIP.win * wins / (n - 1) + (others / (n - 1) - out[meIdx]) * AIP.diff;
    }
  }
  let best = 0;
  for (let k = 1; k < legal.length; k++) if (score[k] > score[best]) best = k;
  return legal[best];
}

export function chooseAction(g, botId, level = 0, rng = Math.random) {
  if (!g || g.game !== 'ev' || g.phase !== 'play') return null;
  const ap = M.activePlayer(g);
  if (!ap || ap.id !== botId) return null;
  const legal = M.legalCards(g, botId);
  if (!legal.length) return { t: 'pass' };
  let card;
  if (legal.length === 1) card = legal[0];
  else if (level <= 0 || rng() < RANDOM_CHANCE) card = pick(legal, rng); // Leicht: immer irgendeine erlaubte Karte
  else card = mcChoose(g, ap, legal, rng);
  return { t: 'play', card: { s: card.s, r: card.r } };
}
