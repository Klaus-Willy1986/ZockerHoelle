// Doppelkopf – Computergegner (reine Funktionen, keine Oberfläche). Stufen: 0 = Leicht, 1 = Mittel.
//
// Leicht: spielt eine zufällige erlaubte Karte und sagt nie an.
// Mittel: Determinisierung (Perfect-Information-Monte-Carlo). Die KI kennt nur, was auch ein Mensch am Tisch weiß:
//   die eigene Hand, alle gespielten Karten, wer welche Farbe nicht bedienen konnte, wer sich als Re/Kontra gezeigt
//   hat (Kreuz-Dame gespielt, Ansage, Hochzeit) und die eigene Teamzugehörigkeit. Sie verteilt die unbekannten Karten
//   ~100-mal zufällig auf die anderen (passend zu diesen Hinweisen), spielt für jede Kandidatenkarte die Runde mit
//   einfachen Regeln zu Ende und wählt die Karte mit dem besten Mittel der Augendifferenz (plus Sieg/Fuchs-Bonus).
//   Sie sagt „Re“/„Kontra“ mit 40 % Wahrscheinlichkeit an, wenn die Hand stark ist (mindestens 6 Trümpfe).
// Ehrlichkeit: Die KI arbeitet nur auf einer bereinigten Sicht (viewOf), in der von fremden Händen nur die Anzahl
//   der Karten steht. (Test: tests/doppelkopf.ai.test.mjs)
import * as M from './engine.js';

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const SAMPLES = 100;
export const BUDGET_MS = 200; // Rechenzeit pro Entscheidung (ein Zeitbudget bricht die Stichproben ab)
const MIN_SAMPLES = 8;
export const STRONG_TRUMPS = 6;
export const ANNOUNCE_CHANCE = 0.4;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------- Tabellen ----------
const GRP = new Int8Array(48), POW = new Int16Array(48), VAL = new Int8Array(48), TYP = new Int8Array(48);
for (let id = 0; id < 48; id++) { GRP[id] = M.groupOf(id); POW[id] = M.power(id); VAL[id] = M.cardValue(id); TYP[id] = M.cardType(id); }

// ---------- Sicht: nur Öffentliches + eigene Hand ----------
export function viewOf(g, pid) {
  const me = g.players.findIndex((p) => p.id === pid);
  const idx = (id) => g.players.findIndex((p) => p.id === id);
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const eyes = [0, 0, 0, 0];
  const kdPlayed = [0, 0, 0, 0];
  const seen = new Set(g.players[me].hand);
  const noteTrick = (cards) => {
    const gl = GRP[cards[0].card];
    for (const c of cards) {
      const p = idx(c.pid);
      seen.add(c.card);
      if (M.isKreuzDame(c.card)) kdPlayed[p] += 1;
      if (GRP[c.card] !== gl) voids[p].add(gl);
    }
  };
  const history = g.history.map((t) => {
    noteTrick(t.cards);
    eyes[idx(t.winner)] += t.augen;
    return { cards: t.cards.map((c) => ({ p: idx(c.pid), card: c.card })), winner: idx(t.winner), augen: t.augen };
  });
  const trick = g.trick.cards.map((c) => ({ p: idx(c.pid), card: c.card }));
  if (trick.length) noteTrick(g.trick.cards);
  const unknown = [];
  for (let c = 0; c < 48; c++) if (!seen.has(c)) unknown.push(c);
  return {
    me, hand: g.players[me].hand.slice(), sizes: g.players.map((p) => p.hand.length),
    history, trick, tricksDone: g.tricksDone, turn: g.turn,
    voids, eyes, kdPlayed, unknown,
    myTeam: g.team[me], known: g.known.slice(),
    wedding: g.wedding ? { player: g.wedding.player, partner: g.wedding.partner, state: g.wedding.state } : null,
    announced: { re: g.announced.re, kontra: g.announced.kontra },
  };
}

// ---------- Welt ziehen ----------
export function sampleWorld(v, rng) {
  const me = v.me;
  const pool = v.unknown.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rng() * (i + 1))); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const others = [0, 1, 2, 3].filter((p) => p !== me);
  const need = [0, 0, 0, 0];
  for (const p of others) need[p] = v.sizes[p];
  const hands = [[], [], [], []];
  hands[me] = v.hand.slice();
  // 1) Unbekannte Kreuz-Damen: gehören den passenden Personen (Hochzeit: der Hochzeitsperson; sonst verschiedenen)
  const kdLeft = pool.filter((c) => M.isKreuzDame(c));
  let rest = pool.filter((c) => !M.isKreuzDame(c));
  const trumpVoid = (p) => v.voids[p].has(M.TRUMP_GROUP);
  const giveKD = (p, c) => { hands[p].push(c); need[p] -= 1; };
  if (kdLeft.length) {
    if (v.wedding && v.wedding.player !== me) {
      for (const c of kdLeft) giveKD(v.wedding.player, c);
    } else {
      const used = new Set();
      const can = (p) => p !== me && need[p] > 0 && !trumpVoid(p) && v.known[p] !== 'kontra' && v.kdPlayed[p] === 0 && !used.has(p);
      const musts = others.filter((p) => v.known[p] === 're' && v.kdPlayed[p] === 0);
      let left = kdLeft.slice();
      for (const p of musts) { if (!left.length) break; if (need[p] > 0) { giveKD(p, left.pop()); used.add(p); } }
      while (left.length) {
        let cand = others.filter(can);
        if (!cand.length) cand = others.filter((p) => need[p] > 0 && !used.has(p));
        if (!cand.length) cand = others.filter((p) => need[p] > 0);
        const p = pick(cand, rng);
        giveKD(p, left.pop()); used.add(p);
      }
    }
  }
  // 2) Rest verteilen: am stärksten eingeschränkte Person zuerst
  const order = others.slice().sort((a, b) => v.voids[b].size - v.voids[a].size || (rng() < 0.5 ? -1 : 1));
  for (let oi = 0; oi < order.length; oi++) {
    const p = order[oi];
    if (oi === order.length - 1) { while (need[p] > 0 && rest.length) { hands[p].push(rest.pop()); need[p] -= 1; } break; }
    const keep = [];
    for (const c of rest) {
      if (need[p] > 0 && !v.voids[p].has(GRP[c])) { hands[p].push(c); need[p] -= 1; } else keep.push(c);
    }
    rest = keep;
  }
  // Notfall (unmögliche Einschränkungen): Reste ohne Rücksicht verteilen
  for (const p of others) while (need[p] > 0 && rest.length) { hands[p].push(rest.pop()); need[p] -= 1; }
  // Teams in dieser Welt
  const tm = [0, 0, 0, 0].map(() => 'kontra');
  let wedPlayer = -1, wedOpen = false;
  if (v.wedding) {
    wedPlayer = v.wedding.player; tm[wedPlayer] = 're';
    if (v.wedding.partner !== null) tm[v.wedding.partner] = 're';
    wedOpen = v.wedding.state === 'open';
  } else {
    for (let p = 0; p < 4; p++) tm[p] = v.kdPlayed[p] > 0 || hands[p].some((c) => M.isKreuzDame(c)) ? 're' : 'kontra';
  }
  tm[me] = v.myTeam;
  return {
    hands,
    trick: v.trick.map((t) => ({ p: t.p, c: t.card })),
    turn: v.turn, done: v.tricksDone, eyes: v.eyes.slice(), tm, wedPlayer, wedOpen, foxes: [],
  };
}

function cloneSim(s) {
  return { hands: s.hands.map((h) => h.slice()), trick: s.trick.map((t) => ({ p: t.p, c: t.c })), turn: s.turn, done: s.done, eyes: s.eyes.slice(), tm: s.tm.slice(), wedPlayer: s.wedPlayer, wedOpen: s.wedOpen, foxes: s.foxes.slice() };
}

// ---------- Simulation ----------
const key = (c, gl) => (GRP[c] === 3 ? 1000 + POW[c] : GRP[c] === gl ? POW[c] : -1);

function legalOf(s, p) {
  const h = s.hands[p];
  if (!s.trick.length) return h;
  const gl = GRP[s.trick[0].c];
  const f = h.filter((c) => GRP[c] === gl);
  return f.length ? f : h;
}

function applyCard(s, p, c) {
  const h = s.hands[p];
  h.splice(h.indexOf(c), 1);
  s.trick.push({ p, c });
  if (s.trick.length < 4) { s.turn = (p + 1) % 4; return; }
  const last = s.done === 11;
  const gl = GRP[s.trick[0].c];
  let b = 0;
  for (let i = 1; i < 4; i++) {
    const a = key(s.trick[i].c, gl), k = key(s.trick[b].c, gl);
    if (a > k || (a === k && last && POW[s.trick[i].c] === 100 && POW[s.trick[b].c] === 100)) b = i;
  }
  const w = s.trick[b].p;
  let aug = 0;
  for (const t of s.trick) { aug += VAL[t.c]; if (M.isFuchs(t.c)) s.foxes.push({ f: t.p, w }); }
  s.eyes[w] += aug;
  s.done += 1;
  s.trick.length = 0;
  s.turn = w;
  if (s.wedOpen) {
    if (w !== s.wedPlayer && s.done <= 3) { s.tm[w] = 're'; s.wedOpen = false; } else if (s.done >= 3) s.wedOpen = false;
  }
}

// Spielregel der simulierten Personen (einfach, aber vernünftig)
function policy(s, p, rng, noise) {
  const legal = legalOf(s, p);
  if (legal.length === 1) return legal[0];
  if (noise && rng() < noise) return legal[Math.min(legal.length - 1, Math.floor(rng() * legal.length))];
  const tr = s.trick;
  if (!tr.length) {
    // Ausspielen: Fehlfarben-Ass, sonst kleinste Fehlfarbe, sonst kleinster Trumpf
    let bestA = -1, bestF = -1, bestFc = 1e9, bestT = -1, bestTc = 1e9;
    for (const c of legal) {
      if (GRP[c] !== 3) {
        if (POW[c] === 4) { if (bestA < 0) bestA = c; continue; }
        const cost = VAL[c] * 10 + POW[c];
        if (cost < bestFc) { bestFc = cost; bestF = c; }
      } else if (POW[c] < bestTc) { bestTc = POW[c]; bestT = c; }
    }
    let nT = 0, topT = -1, topP = -1;
    for (const c of legal) if (GRP[c] === 3) { nT++; if (POW[c] < 100 && POW[c] > topP) { topP = POW[c]; topT = c; } }
    if (nT >= 7 && topT >= 0) return topT; // viele Trümpfe: Trümpfe ziehen
    if (bestA >= 0) return bestA;
    return bestF >= 0 ? bestF : bestT;
  }
  const gl = GRP[tr[0].c];
  let b = 0;
  for (let i = 1; i < tr.length; i++) if (key(tr[i].c, gl) > key(tr[b].c, gl)) b = i;
  const bc = tr[b].c, bp = tr[b].p, bk = key(bc, gl);
  const last = tr.length === 3;
  let trickVal = 0;
  for (const t of tr) trickVal += VAL[t.c];
  const mate = s.tm[bp] === s.tm[p];
  if (mate && (last || POW[bc] >= 77)) {
    // Partner:in sticht schon: Augen dazugeben (aber keine Dulle/Dame verschenken)
    let best = -1, bv = -1, bpw = 1e9;
    for (const c of legal) { const v2 = VAL[c] - (POW[c] >= 87 ? 20 : 0); if (v2 > bv || (v2 === bv && POW[c] < bpw)) { bv = v2; bpw = POW[c]; best = c; } }
    return best;
  }
  if (!mate) {
    let win = -1, wpw = 1e9;
    for (const c of legal) if (key(c, gl) > bk && POW[c] < wpw) { wpw = POW[c]; win = c; }
    if (win >= 0 && (last || trickVal + VAL[win] >= 10 || POW[win] < 80)) return win;
  }
  // abwerfen: wenig Augen, wenig Stärke
  let best = -1, bc2 = 1e9;
  for (const c of legal) { const cost = VAL[c] * 100 + POW[c]; if (cost < bc2) { bc2 = cost; best = c; } }
  return best;
}

export const ROLLOUTS = 1; // Durchläufe je Verteilung (die anderen spielen mit etwas Zufall)
export const OPP_NOISE = 0.25;
function runOut(s, rng) {
  while (s.done < 12) {
    const p = s.turn;
    applyCard(s, p, policy(s, p, rng, OPP_NOISE));
  }
}

function evaluate(s, me) {
  let re = 0;
  for (let p = 0; p < 4; p++) if (s.tm[p] === 're') re += s.eyes[p];
  const mine = s.tm[me];
  const myEyes = mine === 're' ? re : 240 - re;
  const win = mine === 're' ? re >= 121 : 240 - re >= 120;
  let fox = 0;
  for (const f of s.foxes) if (s.tm[f.f] !== s.tm[f.w]) fox += s.tm[f.w] === mine ? 8 : -8;
  return (myEyes - (240 - myEyes)) + (win ? 80 : -80) + fox;
}

// ---------- Entscheidungen ----------
export function chooseAction(g, botId, level = 0, rng = Math.random, opts = {}) {
  if (!g || g.game !== 'dk' || g.phase !== 'play') return null;
  const me = g.players.findIndex((p) => p.id === botId);
  if (me < 0 || g.turn !== me) return null;
  const hand = g.players[me].hand;
  if (!hand.length) return null;

  if (level >= 1) {
    const can = M.canAnnounce(g, botId);
    if (can && hand.filter(M.isTrump).length >= STRONG_TRUMPS && rng() < ANNOUNCE_CHANCE) return { t: 'announce', what: can };
  }

  const legal = M.legalCards(g, botId);
  if (!legal.length) return null;
  if (level <= 0) return { t: 'play', card: pick(legal, rng) };
  // gleiche Karten (doppelt) sind gleichwertig: nur eine je Typ
  const cand = [];
  const typesSeen = new Set();
  for (const c of legal) if (!typesSeen.has(TYP[c])) { typesSeen.add(TYP[c]); cand.push(c); }
  if (cand.length === 1) return { t: 'play', card: cand[0] };

  const samples = opts.samples || SAMPLES;
  const budget = opts.budgetMs === undefined ? BUDGET_MS : opts.budgetMs;
  const v = viewOf(g, botId);
  const sum = cand.map(() => 0);
  const t0 = nowMs();
  let done = 0;
  for (let n = 0; n < samples; n++) {
    const w = sampleWorld(v, rng);
    cand.forEach((c, i) => {
      for (let k = 0; k < ROLLOUTS; k++) {
        const s = cloneSim(w);
        applyCard(s, me, c);
        runOut(s, rng);
        sum[i] += evaluate(s, me);
      }
    });
    done++;
    if (done >= MIN_SAMPLES && nowMs() - t0 > budget) break;
  }
  let bi = 0;
  for (let i = 1; i < cand.length; i++) if (sum[i] > sum[bi]) bi = i;
  return { t: 'play', card: cand[bi] };
}
