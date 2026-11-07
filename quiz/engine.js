// Kneipenquiz – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall kommt immer als Parameter `rng` hinein, die Fragensammlung als Parameter `bank` (Liste von Fragen).
// Der Spielstand besteht nur aus Zahlen, Texten, Wahrheitswerten und Listen (JSON-sicher).
//
// Frageformat (bank): { id, k:'kategorie-id', t:'mc'|'tf'|'est'|'order', d:1|2, q:'Text', fun?:'Kommentar' }
// d: 1 leicht, 2 mittel, 3 Nerd-Level; k darf fehlen oder unbekannt sein.
//   mc:    a:[4 Texte], c:0..3
//   tf:    c:true|false
//   est:   c:Zahl, unit:'Einheit', min, max
//   order: items:[4 Texte in korrekter Reihenfolge]; die Anzeigereihenfolge (`shown`) mischt createGame per rng.
// Antworten: mc Index, tf Wahrheitswert, est Zahl, order Liste der Element-Indizes in der gewählten Reihenfolge
// (richtig ist [0,1,2,3]).
//
// Phasen: 'ask' (alle antworten gleichzeitig) -> 'reveal' (Auflösung) -> ... -> 'over'.
// Achtung: Die richtigen Antworten stehen technisch im Zustand (der Gastgeber schickt ihn an alle Geräte);
// die Oberfläche zeigt sie erst in der Auflösung.

export const GAME = 'qz';
export const LENGTHS = { kurz: 8, normal: 12, lang: 20 };
export const MIX = { mc: 0.55, tf: 0.2, est: 0.15, order: 0.1 };
export const TYPES = ['mc', 'tf', 'est', 'order'];
export const PTS = { right: 10, est: [15, 10, 5], exact: 5, orderEach: 3, orderAll: 3 };
export const TIMER_MS = 30000;
export const MAX_PLAYERS = 8;
// Nerd-Runde: nur Fragen aus diesen Kategorien, Schwierigkeit 1/2/3 etwa 40/35/25 %
export const NERD_KATEGORIEN = ['nerd', 'weltall', 'spiele', 'erfinder', 'serien'];
export const NERD_MIX = [0.4, 0.35, 0.25];

export const isBotId = (id) => String(id).startsWith('bot');
const clampIdx = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));
const pick = (arr, rng) => arr[clampIdx(rng, arr.length)];

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = clampIdx(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Fragen prüfen ----------
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
export function isValidQuestion(q) {
  if (!q || typeof q !== 'object') return false;
  if (!(isStr(q.id) || Number.isFinite(q.id)) || !isStr(q.q)) return false;
  if (q.k !== undefined && typeof q.k !== 'string') return false; // fehlende Kategorie ist erlaubt
  if (!TYPES.includes(q.t) || (q.d !== 1 && q.d !== 2 && q.d !== 3)) return false;
  switch (q.t) {
    case 'mc': return Array.isArray(q.a) && q.a.length === 4 && q.a.every(isStr) && Number.isInteger(q.c) && q.c >= 0 && q.c < 4;
    case 'tf': return typeof q.c === 'boolean';
    case 'est': return [q.c, q.min, q.max].every(Number.isFinite) && q.min < q.max && q.c >= q.min && q.c <= q.max && typeof q.unit === 'string';
    case 'order': return Array.isArray(q.items) && q.items.length === 4 && q.items.every(isStr) && new Set(q.items).size === 4;
    default: return false;
  }
}

// Anzahl je Fragetyp bei n Fragen: ca. 55 % mc, 20 % tf, 15 % est, Rest order (mindestens 1).
export function typeCounts(n) {
  const c = { mc: Math.round(MIX.mc * n), tf: Math.round(MIX.tf * n), est: Math.round(MIX.est * n), order: 0 };
  c.order = n - c.mc - c.tf - c.est;
  if (c.order < 1 && n >= 4) { c.mc -= 1 - c.order; c.order = 1; }
  return c;
}

// Schrittweite des Schiebereglers: ca. 100 Schritte von min bis max, "schöne" Werte (1, 2, 5 × 10^n),
// bei ganzzahligen Grenzen mindestens 1.
export function estStep(q) {
  const range = q.max - q.min;
  const raw = range / 100;
  const allInt = [q.min, q.max, q.c].every(Number.isInteger);
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Schöne Schrittweiten (1, 2, 5 x 10^n) von groß nach klein; bevorzugt eine, die genau bis max reicht,
  // damit der Regler beide Enden erreicht.
  const cands = [];
  for (let e = 0; e >= -3; e--) for (const m of [5, 2, 1]) cands.push(m * mag * 10 ** e);
  const fine = cands.filter((c) => c <= raw * 1.0000001 && (!allInt || c >= 1));
  let step = fine.find((c) => Math.abs(range / c - Math.round(range / c)) < 1e-9 && range / c <= 400);
  if (step === undefined) step = fine.length ? fine[0] : (allInt ? 1 : mag);
  return Number(step.toPrecision(6));
}
export const estMid = (q) => {
  const st = estStep(q);
  const v = q.min + Math.round((q.max - q.min) / 2 / st) * st;
  return Number(Math.min(q.max, v).toPrecision(12));
};
// "Richtig" bei Schätzfragen für die Statistik: höchstens 10 % der Spanne daneben (mindestens ein Schritt).
export const estTolerance = (q) => Math.max(estStep(q), 0.1 * (q.max - q.min));

// Jahreszahlen und kleine Zahlen ohne Tausenderpunkt (1969), große Zahlen mit (384.400).
export const fmtNum = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: Math.abs(n) >= 10000 });
export function answerText(q, v) {
  if (v === null || v === undefined) return 'keine Antwort';
  if (q.t === 'mc') return `${'ABCD'[v]}: ${q.a[v]}`;
  if (q.t === 'tf') return v ? 'Stimmt' : 'Stimmt nicht';
  if (q.t === 'est') return `${fmtNum(v)}${q.unit ? ' ' + q.unit : ''}`;
  return v.map((i) => q.items[i]).join(' – ');
}
export const correctText = (q) => (q.t === 'order' ? q.items.join(' – ') : answerText(q, q.c));

// ---------- Fragen zusammenstellen ----------
function permNotIdentity(n, rng) {
  const id = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < 50; k++) { const p = shuffle(id, rng); if (p.some((v, i) => v !== i)) return p; }
  return id.slice(1).concat(id[0]);
}
const prepare = (q, rng) => {
  const c = JSON.parse(JSON.stringify(q));
  if (c.t === 'order') c.shown = permNotIdentity(c.items.length, rng);
  return c;
};

const catOf = (q) => (typeof q.k === 'string' && q.k) || '_';

// Plan der Schwierigkeiten für n Fragen (Anzahl je Stufe). Nerd-Runde: 40/35/25 %. Sonst höchstens 1 Nerd-Frage (d:3) pro 6 Fragen.
function diffPlan(n, nerd, pool, rng) {
  let d1; let d2; let d3;
  if (nerd) {
    d1 = Math.round(NERD_MIX[0] * n); d2 = Math.round(NERD_MIX[1] * n); d3 = n - d1 - d2;
  } else {
    d3 = Math.min(Math.floor(n / 6), pool.filter((q) => q.d === 3).length);
    const rest = n - d3;
    const extra = rng() < 0.5;
    d1 = extra ? Math.ceil(rest / 2) : Math.floor(rest / 2); d2 = rest - d1;
  }
  return { 1: d1, 2: d2, 3: d3 };
}

function selectQuestions(n, pool, rng, nerd) {
  const by = { mc: [], tf: [], est: [], order: [] };
  for (const q of pool) by[q.t].push(q);
  const counts = typeCounts(n);
  // Fehlt von einem Typ etwas, springt zuerst mc, dann die übrigen Typen ein.
  let miss = 0;
  for (const t of ['order', 'est', 'tf', 'mc']) {
    if (counts[t] > by[t].length) { miss += counts[t] - by[t].length; counts[t] = by[t].length; }
  }
  for (const t of ['mc', 'tf', 'est', 'order']) {
    const room = by[t].length - counts[t];
    const add = Math.min(room, miss);
    counts[t] += add; miss -= add;
  }
  const rem = diffPlan(n, nerd, pool, rng);
  const cap = Math.floor(n / 6);
  let d3used = 0;
  const catCount = {};
  const chosen = [];
  for (const t of ['order', 'est', 'tf', 'mc']) {
    const rest = shuffle(by[t], rng);
    for (let i = 0; i < counts[t]; i++) {
      // Stufe wählen: zufällig nach Restbedarf, aber nur eine, die dieser Typ noch anbieten kann
      const avail = [1, 2, 3].filter((d) => rem[d] > 0 && rest.some((q) => q.d === d));
      let want = 0;
      if (avail.length) {
        let r = rng() * avail.reduce((a, d) => a + rem[d], 0);
        want = avail[avail.length - 1];
        for (const d of avail) { r -= rem[d]; if (r < 0) { want = d; break; } }
      }
      let cand = rest.filter((q) => q.d === want);
      if (!cand.length) cand = rest.filter((q) => nerd || q.d !== 3 || d3used < cap);
      if (!cand.length) cand = rest;
      const min = Math.min(...cand.map((q) => catCount[catOf(q)] || 0));
      const q = cand.find((x) => (catCount[catOf(x)] || 0) === min); // rest ist schon gemischt
      rest.splice(rest.indexOf(q), 1);
      catCount[catOf(q)] = (catCount[catOf(q)] || 0) + 1;
      if (q.d === 3) d3used++;
      if (rem[q.d] > 0) rem[q.d]--;
      chosen.push(q);
    }
  }
  // Reihenfolge: nie 3 gleiche Kategorien hintereinander (wenn irgendwie möglich), Fragetypen möglichst abwechselnd
  const bad = (seq, typeToo) => {
    let v = 0;
    for (let i = 2; i < seq.length; i++) {
      if (catOf(seq[i]) === catOf(seq[i - 1]) && catOf(seq[i]) === catOf(seq[i - 2])) v += 100;
      if (typeToo && seq[i].t === seq[i - 1].t && seq[i].t === seq[i - 2].t) v += 1;
    }
    return v;
  };
  let bestSeq = null; let bestV = Infinity;
  for (let k = 0; k < 400 && bestV > 0; k++) {
    const seq = shuffle(chosen, rng);
    const v = bad(seq, k < 250);
    if (v < bestV) { bestV = v; bestSeq = seq; }
  }
  if (bestV >= 100) { // Typ-Abwechslung aufgeben, nur Kategorien
    for (let k = 0; k < 400 && bestV >= 100; k++) {
      const seq = shuffle(chosen, rng);
      const v = bad(seq, false);
      if (v < bestV) { bestV = v; bestSeq = seq; }
    }
  }
  return bestSeq;
}

// ---------- Spielstand ----------
// opts: { len (8|12|20) | kurz | lang, joker (Standard an), timer (Standard aus), host (Spielleiter-Id),
//         exclude: [ids bereits benutzter Fragen], fixed: [Fragen in fester Reihenfolge] }
export function createGame(playerList, opts = {}, rng = Math.random, bank = []) {
  if (!Array.isArray(playerList) || playerList.length < 1 || playerList.length > MAX_PLAYERS) throw new Error('1 bis 8 Personen');
  const players = playerList.map((p) => ({ id: String(p.id), name: String(p.name) }));
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Doppelte Spieler-Id');
  let qs; let nerd = false;
  if (Array.isArray(opts.fixed) && opts.fixed.length) {
    qs = opts.fixed.filter(isValidQuestion).map((q) => prepare(q, rng));
  } else {
    const len = [8, 12, 20].includes(opts.len) ? opts.len : opts.lang ? 20 : opts.kurz ? 8 : 12;
    const valid = (Array.isArray(bank) ? bank : []).filter(isValidQuestion);
    const seen = new Set();
    const uniq = valid.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
    const ex = new Set((opts.exclude || []).map(String));
    // Nerd-Runde: nur die Nerd-Kategorien (gibt es keine, wird normal gemischt)
    nerd = !!opts.nerd && uniq.some((q) => NERD_KATEGORIEN.includes(q.k));
    const base = nerd ? uniq.filter((q) => NERD_KATEGORIEN.includes(q.k)) : uniq;
    let pool = base.filter((q) => !ex.has(String(q.id)));
    if (pool.length < len) pool = pool.concat(shuffle(base.filter((q) => ex.has(String(q.id))), rng).slice(0, len - pool.length));
    const n = Math.min(len, pool.length);
    qs = n ? selectQuestions(n, pool, rng, nerd).map((q) => prepare(q, rng)) : [];
  }
  if (!qs.length) throw new Error('Keine Fragen vorhanden');
  const scores = {}; const stats = {};
  for (const p of players) { scores[p.id] = 0; stats[p.id] = { right: 0, total: 0 }; }
  return {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    host: opts.host !== undefined ? String(opts.host) : players[0].id,
    players,
    len: qs.length,
    joker: opts.joker !== false,
    timer: !!opts.timer,
    nerd,
    qs,
    qi: 0,
    phase: 'ask', // ask | reveal | over
    answers: {}, // Antworten zur aktuellen Frage
    drafts: {}, // vorläufige Antworten (zählen nur, wenn die Zeit abläuft)
    hidden: {}, // Joker: ausgeblendete Antworten je Person (nur aktuelle Frage)
    jokerUsed: {},
    scores,
    stats,
    reveal: null,
  };
}

export const question = (s) => s.qs[s.qi];
export const isOver = (s) => s.phase === 'over';
export const pending = (s) => (s.phase === 'ask' ? s.players.filter((p) => !(p.id in s.answers)) : []);
export const hasJoker = (s, pid) => !!s.joker && !s.jokerUsed[pid];
export const maxPoints = (s) => s.qs.reduce((a, q) => a + (q.t === 'est' ? 20 : q.t === 'order' ? 15 : 10), 0);

// ---------- Antworten prüfen ----------
function validAnswer(q, v) {
  switch (q.t) {
    case 'mc': return Number.isInteger(v) && v >= 0 && v < 4;
    case 'tf': return typeof v === 'boolean';
    case 'est': return typeof v === 'number' && Number.isFinite(v) && v >= q.min && v <= q.max;
    case 'order': return Array.isArray(v) && v.length === q.items.length && new Set(v).size === v.length && v.every((i) => Number.isInteger(i) && i >= 0 && i < q.items.length);
    default: return false;
  }
}
const norm = (q, v) => (q.t === 'order' ? v.slice() : v);

// ---------- Auflösung ----------
export const SPRUECHE = {
  alle: ['Alle richtig! Da gebe ich glatt eine Runde aus.', 'Lauter Schlauberger am Tisch. Prost!', 'Das war wohl ein Geschenk. Ihr seid große Klasse!'],
  keiner: ['Eine knifflige Frage. Da wäre ich auch ins Grübeln gekommen. Prost!', 'Keiner richtig, aber gute Laune ist auch ein Gewinn.', 'Die war gemein, das gebe ich zu. Weiter geht es!'],
  gemischt: ['Gut gemacht, die Theke freut sich.', 'Ein Schluck Wissen gefällig? Prost!', 'So gefällt mir das. Weiter so!', 'Das war schon ordentlich. Nächste Runde!'],
  einRichtig: ['Richtig! Das nenne ich Stammgast-Wissen.', 'Sehr gut, dafür schenke ich dir ein Bier ein.', 'Das hast du fein gemacht. Prost!'],
  einFalsch: ['Knapp daneben, aber ich schenke dir trotzdem ein.', 'Nicht schlimm, das wusste ich auch nicht. Prost!', 'Das war eine knifflige. Die nächste klappt bestimmt.'],
};

function resolve(s, rng) {
  const q = s.qs[s.qi];
  const res = {};
  for (const p of s.players) {
    const a = p.id in s.answers ? s.answers[p.id] : null;
    res[p.id] = { a, ok: false, pts: 0 };
  }
  const ids = s.players.map((p) => p.id);
  if (q.t === 'mc' || q.t === 'tf') {
    for (const id of ids) if (res[id].a !== null && res[id].a === q.c) { res[id].ok = true; res[id].pts = PTS.right; }
  } else if (q.t === 'order') {
    for (const id of ids) {
      const a = res[id].a;
      if (a === null) continue;
      const hit = a.filter((v, i) => v === i).length;
      res[id].hit = hit;
      res[id].pts = hit * PTS.orderEach + (hit === q.items.length ? PTS.orderAll : 0);
      res[id].ok = hit === q.items.length;
    }
  } else {
    const range = q.max - q.min;
    const ans = ids.filter((id) => res[id].a !== null);
    for (const id of ans) res[id].dev = Math.round(Math.abs(res[id].a - q.c) * 1e9) / 1e9;
    for (const id of ans) {
      const rank = 1 + ans.filter((o) => res[o].dev < res[id].dev).length;
      res[id].rank = rank;
      let pts;
      if (s.players.length === 1) { // allein: Rang gibt es nicht, deshalb nach Nähe gestaffelt
        const f = res[id].dev / range;
        pts = f <= 0.05 ? PTS.est[0] : f <= 0.1 ? PTS.est[1] : f <= 0.2 ? PTS.est[2] : 0;
      } else pts = PTS.est[rank - 1] || 0;
      if (res[id].dev === 0) pts += PTS.exact;
      res[id].pts = pts;
      res[id].ok = res[id].dev <= estTolerance(q) + 1e-9;
    }
  }
  for (const id of ids) {
    s.scores[id] += res[id].pts;
    s.stats[id].total += 1;
    if (res[id].ok) s.stats[id].right += 1;
  }
  const right = ids.filter((id) => res[id].ok);
  let text;
  if (isStr(q.fun)) text = q.fun;
  else if (ids.length === 1) text = pick(res[ids[0]].ok ? SPRUECHE.einRichtig : SPRUECHE.einFalsch, rng);
  else if (right.length === ids.length) text = pick(SPRUECHE.alle, rng);
  else if (!right.length) text = pick(SPRUECHE.keiner, rng);
  else text = pick(SPRUECHE.gemischt, rng);
  s.reveal = { qi: s.qi, res, right, comment: text };
  s.phase = 'reveal';
  s.drafts = {};
}

// ---------- Nachrichten ----------
const err = (error) => ({ ok: false, error });
const isHostMsg = (s, pid) => !s.host || s.host === pid;

export function handle(state, pid, msg, rng = Math.random) {
  if (!state || state.game !== GAME) return err('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return err('Ungültige Nachricht.');
  if (!state.players.some((p) => p.id === pid)) return err('Du spielst nicht mit.');
  if (msg.q !== undefined && msg.q !== state.qi) return err('Diese Frage ist nicht mehr aktuell.');
  const q = state.qs[state.qi];
  switch (msg.t) {
    case 'answer': case 'draft': {
      if (state.phase === 'over') return err('Das Quiz ist zu Ende.');
      if (state.phase !== 'ask') return err('Die Antwort kommt zu spät.');
      if (pid in state.answers) return err('Du hast schon geantwortet.');
      if (msg.t === 'draft' && msg.v === null) { delete state.drafts[pid]; return { ok: true }; }
      if (!validAnswer(q, msg.v)) return err('Diese Antwort gibt es nicht.');
      if (q.t === 'mc' && (state.hidden[pid] || []).includes(msg.v)) return err('Diese Antwort ist ausgeblendet.');
      if (msg.t === 'draft') { state.drafts[pid] = norm(q, msg.v); return { ok: true }; }
      state.answers[pid] = norm(q, msg.v);
      delete state.drafts[pid];
      if (state.players.every((p) => p.id in state.answers)) resolve(state, rng);
      return { ok: true };
    }
    case 'joker': {
      if (state.phase !== 'ask') return err('Der Joker geht nur bei einer offenen Frage.');
      if (!state.joker) return err('In diesem Spiel gibt es keinen Joker.');
      if (state.jokerUsed[pid]) return err('Du hast deinen Joker schon benutzt.');
      if (pid in state.answers) return err('Der Joker geht nur vor deiner Antwort.');
      if (q.t !== 'mc') return err('Den Joker gibt es nur bei Fragen mit vier Antworten.');
      const wrong = [0, 1, 2, 3].filter((i) => i !== q.c);
      const keep = pick(wrong, rng);
      state.hidden[pid] = wrong.filter((i) => i !== keep);
      state.jokerUsed[pid] = true;
      return { ok: true };
    }
    case 'timeout': {
      if (!isHostMsg(state, pid)) return err('Nur der Gastgeber kann die Zeit beenden.');
      if (state.phase !== 'ask') return err('Die Frage ist schon aufgelöst.');
      for (const p of state.players) {
        if (!(p.id in state.answers) && p.id in state.drafts) state.answers[p.id] = state.drafts[p.id];
      }
      resolve(state, rng);
      return { ok: true };
    }
    case 'next': {
      if (!isHostMsg(state, pid)) return err('Nur der Gastgeber kann weiterschalten.');
      if (state.phase !== 'reveal') return err('Es gibt gerade nichts zum Weiterschalten.');
      if (state.qi + 1 >= state.qs.length) { state.phase = 'over'; state.reveal = null; } else {
        state.qi += 1; state.phase = 'ask'; state.answers = {}; state.drafts = {}; state.hidden = {}; state.reveal = null;
      }
      return { ok: true };
    }
    default: return err('Unbekannte Nachricht.');
  }
}

// ---------- Rangliste ----------
// Sortiert nach Punkten (absteigend); gleiche Punkte teilen sich den Rang und die Reihenfolge der Anmeldung bleibt.
export function ranking(state) {
  const list = state.players.map((p) => ({ id: p.id, name: p.name, score: state.scores[p.id], right: state.stats[p.id].right, total: state.stats[p.id].total }));
  list.sort((a, b) => b.score - a.score);
  return list.map((r) => ({ ...r, rank: 1 + list.filter((o) => o.score > r.score).length }));
}
export const winners = (state) => ranking(state).filter((r) => r.rank === 1);
