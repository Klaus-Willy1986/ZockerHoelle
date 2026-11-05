// Farbkarten – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Mischen) kommt nur über den Parameter `rng` herein und wird nur im Gastgeber benutzt.
//
// Karten sind kurze Texte: Farbe + Wert.
//   Farben: R Rot, Y Gelb, G Grün, B Blau.  Werte: 0-9, S Aussetzen, U Richtungswechsel, Z Zwei ziehen.
//   Joker: 'W' Farbwahl, 'W4' Vier ziehen (ohne Farbe; die gewählte Farbe steht in g.color).

export const COLORS = ['R', 'Y', 'G', 'B'];
export const COLOR_NAMES = { R: 'Rot', Y: 'Gelb', G: 'Grün', B: 'Blau' };
export const WIN_SCORE = 500;
export const HAND_SIZE = 7;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const CALL_PENALTY = 2;
const RECAP_MAX = 6;

// ---------- Karten ----------
export function fullDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push(c + '0');
    for (let k = 0; k < 2; k++) {
      for (let v = 1; v <= 9; v++) d.push(c + v);
      d.push(c + 'S', c + 'U', c + 'Z');
    }
  }
  for (let i = 0; i < 4; i++) d.push('W', 'W4');
  return d;
}
const CARD_RE = /^(?:[RYGB](?:[0-9SUZ])|W4?)$/;
export const isCard = (c) => typeof c === 'string' && CARD_RE.test(c);
export const isWild = (c) => c[0] === 'W';
export const cardColor = (c) => (isWild(c) ? null : c[0]);
export const cardValue = (c) => (isWild(c) ? c : c.slice(1)); // '0'..'9' | 'S' | 'U' | 'Z' | 'W' | 'W4'
export const isNumber = (c) => !isWild(c) && /[0-9]/.test(c[1]);
export const isAction = (c) => isWild(c) || 'SUZ'.includes(c[1]);
export function cardPoints(c) {
  if (isWild(c)) return 50;
  return isNumber(c) ? Number(c[1]) : 20;
}
const VALUE_NAMES = { S: 'Aussetzen', U: 'Richtungswechsel', Z: 'Zwei ziehen', W: 'Joker Farbwahl', W4: 'Joker Vier ziehen' };
export function cardName(c) {
  if (!isCard(c)) return '?';
  if (isWild(c)) return VALUE_NAMES[c];
  return `${COLOR_NAMES[c[0]]} ${isNumber(c) ? c[1] : VALUE_NAMES[c[1]]}`;
}
const cmpCards = (a, b) => {
  const ka = isWild(a) ? 4 : COLORS.indexOf(a[0]);
  const kb = isWild(b) ? 4 : COLORS.indexOf(b[0]);
  if (ka !== kb) return ka - kb;
  const va = isWild(a) ? a : a.slice(1), vb = isWild(b) ? b : b.slice(1);
  const order = (v) => '0123456789SUZ'.indexOf(v[0]) + (v === 'W4' ? 100 : 0);
  return order(va) - order(vb);
};
export const sortHand = (hand) => hand.sort(cmpCards);
export const handPoints = (hand) => hand.reduce((s, c) => s + cardPoints(c), 0);

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Hilfen ----------
export const activePlayer = (g) => g.players[g.active];
export const topCard = (g) => g.discard[g.discard.length - 1];
export const stepFrom = (g, i, k = 1) => {
  const n = g.players.length;
  return (((i + g.dir * k) % n) + n) % n;
};
export const nextIndex = (g, i = g.active) => stepFrom(g, i, 1);

function note(g, text) {
  g.say.push(text);
  g.recap.push(text);
  if (g.recap.length > RECAP_MAX) g.recap.splice(0, g.recap.length - RECAP_MAX);
}

// Karten ziehen; ist der Stapel leer, wird der Ablagestapel (ohne oberste Karte) neu gemischt.
function drawCards(g, idx, n, rng) {
  const p = g.players[idx];
  const taken = [];
  for (let k = 0; k < n; k++) {
    if (!g.deck.length && g.discard.length > 1) {
      const top = g.discard.pop();
      g.deck = shuffle(g.discard, rng);
      g.discard = [top];
      g.reshuffled = (g.reshuffled || 0) + 1;
    }
    if (!g.deck.length) break;
    const c = g.deck.pop();
    p.hand.push(c);
    taken.push(c);
  }
  sortHand(p.hand);
  return taken;
}

// Darf diese Karte jetzt gelegt werden? (hand = Hand der Person, wegen „Vier ziehen“)
export function canPlay(g, hand, card) {
  if (!isCard(card)) return false;
  if (g.pending) {
    if (g.pending.kind === 'Z') return !isWild(card) && card[1] === 'Z';
    return card === 'W4';
  }
  if (card === 'W') return true;
  if (card === 'W4') return !hand.some((c) => !isWild(c) && c[0] === g.color);
  if (card[0] === g.color) return true;
  const top = topCard(g);
  return !isWild(top) && top.slice(1) === card.slice(1);
}

// Alle Karten (ohne Doppelte), die diese Person jetzt legen dürfte.
export function legalCards(g, idx) {
  if (!g || g.mode !== 'play' || g.stage !== 'play' || idx !== g.active) return [];
  const hand = g.players[idx].hand;
  const pool = g.drawn ? [g.drawn] : hand;
  return [...new Set(pool.filter((c) => canPlay(g, hand, c)))];
}

// ---------- Spielstand ----------
export function createGame(playerList, opts = {}, rng = Math.random) {
  const n = Array.isArray(playerList) ? playerList.length : 0;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('Farbkarten geht nur mit 2 bis 6 Personen.');
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = {
    game: 'fk',
    gid: Math.floor(rng() * 1e9),
    mode: 'play', // 'play' | 'round' (Runde zu Ende) | 'over' (Serie zu Ende)
    opts: { stack: !!o.stack, auto: !!o.auto },
    players: playerList.map((p) => ({ id: p.id, name: p.name, hand: [], total: 0 })),
    round: 1,
    history: [], // [{ round, winner, points }]
    deck: [], discard: [], reshuffled: 0,
    dir: 1, active: 0, starter: 0, color: null,
    stage: 'play', // 'play' | 'color' (Start-Joker: erste Person wählt die Farbe)
    pending: null, // { kind: 'Z' | 'W4', n } nur mit Weitergabe
    drawn: null, call: null,
    seq: 0, last: null, recap: [], say: [], penalty: null,
    winner: -1, roundWinner: -1, roundPoints: 0,
  };
  deal(g, rng);
  return g;
}

function deal(g, rng) {
  const n = g.players.length;
  g.deck = shuffle(fullDeck(), rng);
  g.discard = [];
  g.reshuffled = 0;
  for (const p of g.players) p.hand = [];
  for (let k = 0; k < HAND_SIZE; k++) for (let i = 0; i < n; i++) g.players[i].hand.push(g.deck.pop());
  for (const p of g.players) sortHand(p.hand);
  let top = g.deck.pop();
  while (top === 'W4') { // „Vier ziehen“ darf nicht am Anfang liegen: zurück in den Stapel
    g.deck.splice(Math.min(g.deck.length, Math.floor(rng() * (g.deck.length + 1))), 0, top);
    top = g.deck.pop();
  }
  g.discard.push(top);
  g.dir = 1;
  g.starter = (g.round - 1) % n;
  g.active = g.starter;
  g.stage = 'play';
  g.pending = null; g.drawn = null; g.call = null;
  g.mode = 'play';
  g.roundWinner = -1; g.roundPoints = 0;
  g.recap = [];
  g.say = [];
  g.penalty = null;
  g.color = cardColor(top);
  const first = g.players[g.starter];
  g.last = { kind: 'start', pid: first.id, name: first.name, card: top };
  note(g, `Neue Runde. Aufgedeckt: ${cardName(top)}.`);
  if (top === 'W') {
    g.stage = 'color';
    g.color = null;
  } else if (top[1] === 'S') {
    note(g, `${first.name} muss aussetzen.`);
    g.active = stepFrom(g, g.starter, 1);
    g.last = { kind: 'start', pid: first.id, name: first.name, card: top, skipped: first.id };
  } else if (top[1] === 'U') {
    if (n === 2) {
      note(g, `Richtungswechsel: ${first.name} muss aussetzen.`);
      g.active = stepFrom(g, g.starter, 1);
    } else {
      g.dir = -1;
      note(g, 'Richtungswechsel: Es geht in die andere Richtung.');
    }
  } else if (top[1] === 'Z') {
    drawCards(g, g.starter, 2, rng);
    note(g, `${first.name} zieht 2 Karten und muss aussetzen.`);
    g.active = stepFrom(g, g.starter, 1);
  }
  g.seq++;
}

// Ruf-Strafe: Wer nur noch eine Karte hat und nicht gerufen hat, zieht zwei, sobald die nächste Person handelt.
function settleCall(g, actorIdx, rng) {
  if (!g.call) return;
  const ci = g.players.findIndex((p) => p.id === g.call.pid);
  if (ci < 0) { g.call = null; return; }
  if (ci === actorIdx) return; // Die Person ist selbst noch einmal dran und kann noch rufen
  g.call = null;
  const c = g.players[ci];
  if (c.hand.length === 1) {
    const got = drawCards(g, ci, CALL_PENALTY, rng).length;
    note(g, `${c.name} hat „Letzte Karte“ nicht gerufen und zieht ${got} Karten.`);
    g.penalty = { pid: c.id, name: c.name, n: got, seq: g.seq + 1 };
  }
}

function endRound(g, idx) {
  const w = g.players[idx];
  let pts = 0;
  g.players.forEach((p, i) => { if (i !== idx) pts += handPoints(p.hand); });
  w.total += pts;
  g.roundWinner = idx;
  g.roundPoints = pts;
  g.history.push({ round: g.round, winner: idx, points: pts });
  g.call = null; g.drawn = null; g.pending = null;
  note(g, `${w.name} hat keine Karten mehr und bekommt ${pts} Punkte.`);
  if (w.total >= WIN_SCORE) {
    g.mode = 'over';
    g.winner = idx;
    note(g, `${w.name} hat ${w.total} Punkte und gewinnt das ganze Spiel.`);
  } else {
    g.mode = 'round';
  }
}

// Wirkung der gelegten Karte und nächste Person bestimmen.
function afterPlay(g, idx, card, rng, finished) {
  const n = g.players.length;
  const stackOn = g.opts.stack && !finished;
  const penalize = (kind, base) => {
    const total = (g.pending ? g.pending.n : 0) + base;
    const vi = stepFrom(g, idx, 1);
    if (stackOn) {
      g.pending = { kind, n: total };
      g.active = vi;
      note(g, `${g.players[vi].name} muss ${total} Karten ziehen – oder eine ${kind === 'Z' ? 'Zwei-ziehen' : 'Vier-ziehen'}-Karte darauf legen.`);
    } else {
      g.pending = null;
      const got = drawCards(g, vi, total, rng).length;
      note(g, `${g.players[vi].name} zieht ${got} Karten und muss aussetzen.`);
      g.last.victim = g.players[vi].id; g.last.drawn = got;
      g.active = stepFrom(g, idx, 2);
    }
  };
  if (card === 'W4') penalize('W4', 4);
  else if (card === 'W') g.active = stepFrom(g, idx, 1);
  else if (card[1] === 'Z') penalize('Z', 2);
  else if (card[1] === 'S') {
    const vi = stepFrom(g, idx, 1);
    note(g, `${g.players[vi].name} muss aussetzen.`);
    g.last.victim = g.players[vi].id;
    g.active = stepFrom(g, idx, 2);
  } else if (card[1] === 'U') {
    g.dir = -g.dir;
    if (n === 2) {
      note(g, `Richtungswechsel: ${g.players[1 - idx].name} muss aussetzen.`);
      g.last.victim = g.players[1 - idx].id;
      g.active = idx;
    } else {
      note(g, 'Richtungswechsel: Es geht in die andere Richtung.');
      g.active = stepFrom(g, idx, 1);
    }
  } else g.active = stepFrom(g, idx, 1);
  if (finished) g.active = idx;
}

const fail = (error) => ({ ok: false, error });
const ok = () => ({ ok: true });

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return fail('Kein Spiel.');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('Unbekannte Nachricht.');
  const idx = g.players.findIndex((p) => p.id === pid);
  if (idx < 0) return fail('Du spielst nicht mit.');
  const me = g.players[idx];

  if (msg.t === 'next') {
    if (g.mode !== 'round') return fail('Die Runde ist noch nicht zu Ende.');
    g.round += 1;
    deal(g, rng);
    return ok();
  }
  if (g.mode !== 'play') return fail('Das Spiel ist zu Ende.');

  if (msg.t === 'call') {
    if (!g.call || g.call.pid !== pid || me.hand.length !== 1) return fail('Jetzt kannst du nicht rufen.');
    g.say = [];
    g.call = null;
    g.last = { kind: 'call', pid, name: me.name };
    note(g, `${me.name}: „Letzte Karte!“`);
    g.seq++;
    return ok();
  }

  if (idx !== g.active) return fail('Du bist nicht dran.');

  if (msg.t === 'color') {
    if (g.stage !== 'color') return fail('Jetzt wird keine Farbe gewählt.');
    if (!COLORS.includes(msg.color)) return fail('Unbekannte Farbe.');
    g.say = [];
    g.color = msg.color;
    g.stage = 'play';
    g.last = { kind: 'color', pid, name: me.name, color: msg.color };
    note(g, `${me.name} wählt ${COLOR_NAMES[msg.color]}.`);
    g.seq++;
    return ok();
  }
  if (g.stage !== 'play') return fail('Zuerst muss die Farbe gewählt werden.');

  if (msg.t === 'play') {
    const card = msg.card;
    if (!isCard(card) || !me.hand.includes(card)) return fail('Diese Karte hast du nicht.');
    if (g.drawn && card !== g.drawn) return fail('Du darfst nur die gezogene Karte legen.');
    if (!canPlay(g, me.hand, card)) return fail('Diese Karte passt nicht.');
    let color = null;
    if (isWild(card)) {
      if (!COLORS.includes(msg.color)) return fail('Bitte wähle eine Farbe.');
      color = msg.color;
    }
    if (msg.call !== undefined && typeof msg.call !== 'boolean') return fail('Ungültiger Ruf.');
    // --- gültig: ab hier wird der Zustand verändert ---
    g.say = [];
    settleCall(g, idx, rng);
    me.hand.splice(me.hand.indexOf(card), 1);
    g.discard.push(card);
    g.drawn = null;
    g.color = isWild(card) ? color : card[0];
    g.last = { kind: 'play', pid, name: me.name, card, color: g.color };
    note(g, `${me.name} legt ${cardName(card)}${isWild(card) ? ` und wählt ${COLOR_NAMES[color]}` : ''}.`);
    const finished = me.hand.length === 0;
    if (!finished && me.hand.length === 1) {
      if (g.opts.auto || msg.call === true) {
        g.call = null;
        g.last.called = true;
      } else g.call = { pid };
    } else if (g.call && g.call.pid === pid) g.call = null;
    afterPlay(g, idx, card, rng, finished);
    if (finished) endRound(g, idx);
    g.seq++;
    return ok();
  }

  if (msg.t === 'draw') {
    if (g.drawn) return fail('Du hast schon gezogen.');
    if (g.pending) {
      g.say = [];
      settleCall(g, idx, rng);
      const n = g.pending.n;
      const got = drawCards(g, idx, n, rng).length;
      g.pending = null;
      g.last = { kind: 'penalty', pid, name: me.name, n: got };
      note(g, `${me.name} zieht ${got} Karten und muss aussetzen.`);
      g.active = stepFrom(g, idx, 1);
      g.seq++;
      return ok();
    }
    if (legalCards(g, idx).length) return fail('Du hast eine passende Karte und musst eine legen.');
    g.say = [];
    settleCall(g, idx, rng);
    const taken = drawCards(g, idx, 1, rng);
    if (!taken.length) {
      g.last = { kind: 'draw', pid, name: me.name, n: 0 };
      note(g, `${me.name} kann keine Karte ziehen – der Stapel ist leer.`);
      g.active = stepFrom(g, idx, 1);
    } else {
      const drawnCard = taken[0];
      g.last = { kind: 'draw', pid, name: me.name, n: 1 };
      if (canPlay(g, me.hand, drawnCard)) {
        g.drawn = drawnCard;
        g.last.playable = true;
        note(g, `${me.name} zieht eine Karte.`);
      } else {
        note(g, `${me.name} zieht eine Karte und muss aussetzen.`);
        g.active = stepFrom(g, idx, 1);
      }
    }
    g.seq++;
    return ok();
  }

  if (msg.t === 'keep') {
    if (!g.drawn) return fail('Es gibt nichts zu behalten.');
    g.say = [];
    settleCall(g, idx, rng);
    g.drawn = null;
    g.last = { kind: 'keep', pid, name: me.name };
    note(g, `${me.name} behält die Karte und setzt aus.`);
    g.active = stepFrom(g, idx, 1);
    g.seq++;
    return ok();
  }
  return fail('Unbekannte Nachricht.');
}
