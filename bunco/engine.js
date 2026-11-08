// Bunco – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Würfel) kommt immer als Parameter `rng` hinein. Alle Zustände sind reines JSON. Es gibt keine verdeckten Informationen.
//
// Ablauf: 6 Runden, in Runde k ist die Zielzahl k. Wer dran ist, würfelt alle 3 Würfel:
//   jeder Würfel mit der Zielzahl = 1 Punkt; drei Zielzahlen = Bunco (21 Punkte, Runde endet sofort);
//   drei gleiche andere Zahlen = Mini-Bunco (5 Punkte). Wer Punkte macht, würfelt weiter; ohne Punkte ist die nächste Person dran.
//   Sobald jemand 21 Rundenpunkte erreicht, endet die Runde. Rundensieg = meiste Rundenpunkte (Gleichstand: alle).
//   Gesamtsieg: meiste Rundensiege, dann meiste Gesamtpunkte, sonst geteilt.
//   Alleinspiel (1 Person): pro Runde 10 Würfelreihen (eine Reihe endet ohne Punkte), Runde endet auch bei 21 Punkten; Gesamtpunkte zählen.

export const GAME = 'bc';
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const ROUNDS = 6;
export const GOAL = 21;
export const BUNCO_POINTS = 21;
export const MINI_POINTS = 5;
export const SOLO_TURNS = 10;
const ROLL_CAP = 1500; // Sicherung pro Runde: danach endet die Runde

const die = (rng) => Math.min(5, Math.floor(rng() * 6)) + 1;
export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
const NUM_PL = ['', 'Einer', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'];
export const pluralName = (n) => NUM_PL[n] || '';

// Wertung eines Wurfs: { hits, points, bunco, mini }
export function scoreRoll(dice, target) {
  const hits = dice.filter((d) => d === target).length;
  const triple = dice[0] === dice[1] && dice[1] === dice[2];
  if (hits === 3) return { hits, points: BUNCO_POINTS, bunco: true, mini: false };
  if (triple) return { hits, points: MINI_POINTS, bunco: false, mini: true };
  return { hits, points: hits, bunco: false, mini: false };
}

function pushRecap(g, text) {
  g.recap.unshift(text);
  if (g.recap.length > 6) g.recap.length = 6;
}

export function createGame(players, opts = {}, rng = Math.random) {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error('1 bis 8 Personen');
  return {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    opts: {},
    solo: players.length === 1,
    phase: 'roll', // roll | between | over
    players: players.map((p) => ({ id: String(p.id), name: String(p.name), pts: 0, total: 0, wins: 0 })),
    round: 1,
    target: 1,
    active: 0,
    dice: null,
    rollId: 0,
    rolls: 0, // Würfe in dieser Runde
    turn: 0, // Alleinspiel: beendete Würfelreihen in dieser Runde
    moves: 0,
    last: null,
    recap: [],
    history: [], // [{ round, scores:[…], winners:[ids] }]
    result: null,
  };
}

// Text zu einem Wurf, aus Sicht der Person myId
export function resultText(l, myId) {
  if (!l || l.kind !== 'roll') return '';
  const me = l.pid === myId;
  const nm = me ? 'Du' : l.name;
  let t;
  if (l.bunco) t = `${nm}: Bunco! 21 Punkte!`;
  else if (l.mini) t = `${nm}: Mini-Bunco, drei ${pluralName(l.dice[0])}, 5 Punkte`;
  else if (l.hits > 0) t = `${nm}: ${l.hits === 1 ? 'Ein Treffer, 1 Punkt' : (l.hits === 2 ? 'Zwei' : 'Drei') + ' Treffer, ' + l.hits + ' Punkte'}`;
  else t = `${nm}: Kein Treffer, ${l.solo ? 'die Reihe ist zu Ende' : 'weiter zur nächsten Person'}`;
  if (l.points > 0 && !l.roundEnd) t += `. ${me ? 'Du darfst' : l.name + ' darf'} nochmal würfeln`;
  return t;
}

export function roundText(h, g, myId) {
  if (!h) return '';
  if (g.solo) return `Runde ${h.round} ist zu Ende: ${h.scores[0]} Punkte`;
  const names = h.winners.map((id) => (id === myId ? 'dir' : (g.players.find((p) => p.id === id) || {}).name));
  if (!names.length) return `Runde ${h.round} ist zu Ende, niemand hat gepunktet`;
  const best = Math.max(...h.scores);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1] : names[0];
  return `Runde ${h.round} geht an ${list} mit ${best} Punkten`;
}

function endRound(g, why) {
  const scores = g.players.map((p) => p.pts);
  const best = Math.max(...scores);
  const winners = g.solo || best <= 0 ? [] : g.players.filter((p) => p.pts === best).map((p) => p.id);
  for (const p of g.players) if (winners.includes(p.id)) p.wins += 1;
  const h = { round: g.round, scores, winners, why };
  g.history.push(h);
  pushRecap(g, roundText(h, g, null));
  if (g.round >= ROUNDS) {
    g.phase = 'over';
    const rank = ranking(g);
    g.result = { winners: rank.filter((r) => r.place === 1).map((r) => r.id), solo: g.solo, total: g.players.reduce((a, p) => a + p.total, 0) };
  } else {
    g.phase = 'between';
  }
}

const ok = (extra) => Object.assign({ ok: true }, extra || {});
const fail = (error) => ({ ok: false, error });

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== GAME) return fail('Kein Spiel');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('Ungültige Nachricht');
  if (g.phase === 'over') return fail('Das Spiel ist zu Ende');
  const idx = idxOf(g, pid);
  if (idx < 0) return fail('Du spielst nicht mit');
  const me = g.players[idx];

  switch (msg.t) {
    case 'roll': {
      if (g.phase !== 'roll') return fail('Jetzt wird nicht gewürfelt');
      if (idx !== g.active) return fail('Du bist nicht dran');
      const dice = [die(rng), die(rng), die(rng)];
      const s = scoreRoll(dice, g.target);
      me.pts += s.points;
      me.total += s.points;
      g.dice = dice;
      g.rollId += 1;
      g.rolls += 1;
      g.moves += 1;
      const roundEnd = me.pts >= GOAL || g.rolls >= ROLL_CAP || (g.solo && s.points === 0 && g.turn + 1 >= SOLO_TURNS);
      g.last = { kind: 'roll', pid: me.id, name: me.name, dice: dice.slice(), target: g.target, hits: s.hits, points: s.points, bunco: s.bunco, mini: s.mini, solo: g.solo, roundEnd };
      g.last.text = resultText(g.last, null);
      pushRecap(g, g.last.text);
      if (s.points === 0) {
        if (g.solo) g.turn += 1;
        else g.active = (g.active + 1) % g.players.length;
      }
      if (roundEnd) endRound(g, s.bunco ? 'bunco' : me.pts >= GOAL ? 'goal' : 'end');
      return ok({ points: s.points });
    }
    case 'next': {
      if (g.phase !== 'between') return fail('Es gibt gerade nichts weiterzuklicken');
      g.round += 1;
      g.target = g.round;
      g.active = (g.round - 1) % g.players.length;
      g.dice = null;
      g.rolls = 0;
      g.turn = 0;
      g.last = null;
      for (const p of g.players) p.pts = 0;
      g.phase = 'roll';
      g.moves += 1;
      return ok();
    }
    default:
      return fail('Unbekannte Nachricht');
  }
}

// Rangliste: meiste Rundensiege, dann meiste Gesamtpunkte; gleiche Werte teilen den Platz
export function ranking(g) {
  const rows = g.players.map((p) => ({ id: p.id, name: p.name, wins: p.wins, total: p.total }));
  rows.sort((a, b) => (b.wins - a.wins) || (b.total - a.total));
  let place = 1;
  return rows.map((r, i) => {
    if (i > 0 && (rows[i - 1].wins !== r.wins || rows[i - 1].total !== r.total)) place = i + 1;
    return { place, ...r };
  });
}
