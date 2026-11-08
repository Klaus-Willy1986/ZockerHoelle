// Mäxchen – reine Spiellogik (keine Oberfläche, kein Netzwerk).
// Zufall (Würfel) kommt immer als Parameter `rng` hinein, damit Tests deterministisch sind. Alle Zustände sind reines JSON.
// Hinweis: Der echte Wurf unter dem Becher (`cup`, `cupDice`) steht technisch im Zustand (wie bei den anderen Spielen die
// verdeckten Karten); die Oberfläche zeigt ihn nur der würfelnden Person und nach dem Aufdecken allen.
//
// Ablauf: Phase 'roll' (aktive Person würfelt verdeckt) -> 'announce' (sie sagt einen höheren Wert an, wahr oder gelogen)
//   -> 'decide' (die nächste Person glaubt -> würfelt selbst: 'roll', oder zweifelt -> 'reveal')
//   -> 'reveal' (Ergebnis sichtbar; `next` startet die nächste Runde) oder 'over' (nur noch eine Person hat Leben).
// Wertung von niedrig nach hoch: 31 32 41 42 43 51 52 53 54 61 62 63 64 65, Paschs 11..66, Mäxchen 21.
// Zweifel: War der echte Wurf kleiner als die Ansage, verliert die ansagende Person; sonst die zweifelnde.
// Ein angezweifeltes Mäxchen kostet 2 Leben (der Lügner oder der Zweifler).

export const GAME = 'mx';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const LIVES = 6;
export const LIVES_SHORT = 3;
export const MAEXCHEN = 21;
export const ORDER = [31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 21];
const RECAP_MAX = 6;
const MOVE_CAP = 20000; // Sicherung: spätestens dann endet die Partie

export const isValue = (v) => Number.isInteger(v) && ORDER.includes(v);
export const rankOf = (v) => ORDER.indexOf(v);
export const isPasch = (v) => isValue(v) && v !== MAEXCHEN && Math.floor(v / 10) === v % 10;
// Wert zweier Würfel: höhere Augenzahl vorn, Paschs 11..66, 21 = Mäxchen
export function valueOf(a, b) {
  if (a === b) return a * 11;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi * 10 + lo;
}
// Wahrscheinlichkeit, mit zwei Würfeln genau diesen Wert zu würfeln (Paschs 1/36, alle anderen 2/36)
export const weight = (v) => (isPasch(v) ? 1 : 2) / 36;
// Wahrscheinlichkeit, dass ein echter Wurf mindestens so hoch ist wie v
export function probAtLeast(v) {
  const r = rankOf(v);
  if (r < 0) return 0;
  let p = 0;
  for (let i = r; i < ORDER.length; i++) p += weight(ORDER[i]);
  return p;
}
export const lossFor = (announced) => (announced === MAEXCHEN ? 2 : 1);
export const valueText = (v) => (v === MAEXCHEN ? '21 (Mäxchen)' : isPasch(v) ? `${v} (Pasch)` : String(v));
export const beer = (n) => '🍺'.repeat(Math.max(0, n));
const lifeWord = (n) => (n === 1 ? 'ein Leben' : n === 2 ? 'zwei Leben' : `${n} Leben`);

const die = (rng) => Math.min(5, Math.floor(rng() * 6)) + 1;
export const activePlayer = (g) => g.players[g.active];
const idxOf = (g, pid) => g.players.findIndex((p) => p.id === pid);
export const isAlive = (p) => p.lives > 0;
export const aliveCount = (g) => g.players.filter(isAlive).length;
// nächste Person mit Leben nach Platz i (im Kreis)
export function nextAlive(g, i) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (isAlive(g.players[j])) return j; }
  return i;
}
// erlaubte Ansagen: alles, was höher ist als die letzte Ansage (am Rundenanfang alles)
export function allowedSays(g) {
  if (!g || g.announced === null || g.announced === undefined) return ORDER.slice();
  const r = rankOf(g.announced);
  return ORDER.filter((v) => rankOf(v) > r);
}

function pushRecap(g, text) {
  g.recap.unshift(text);
  if (g.recap.length > RECAP_MAX) g.recap.length = RECAP_MAX;
}

export function createGame(players, opts = {}, rng = Math.random) {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error('2 bis 8 Personen');
  const o = { short: !!(opts && opts.short) };
  const lives = o.short ? LIVES_SHORT : LIVES;
  return {
    game: GAME,
    gid: Math.floor(rng() * 1e9),
    opts: o,
    phase: 'roll',
    players: players.map((p) => ({ id: String(p.id), name: String(p.name), lives })),
    startLives: lives,
    active: 0,
    announced: null, // letzte Ansage dieser Runde
    announcer: null, // Platz der ansagenden Person
    cup: null, // echter Wurf unter dem Becher (Wert), verdeckt
    cupDice: null, // [a, b]
    rollId: 0,
    round: 1,
    moves: 0,
    last: null,
    recap: [],
    eliminated: [],
    result: null,
  };
}

function revealText(l) {
  if (l.liar) {
    return l.loss === 2
      ? `${l.announcerName} hat ein Mäxchen angesagt, aber gelogen, und verliert zwei Leben ${beer(2)}`
      : `${l.announcerName} hat gelogen und verliert ein Leben ${beer(1)}`;
  }
  return l.loss === 2
    ? `${l.announcerName} hat die Wahrheit gesagt: Es war ein Mäxchen! ${l.doubterName} hat zu Unrecht gezweifelt und verliert zwei Leben ${beer(2)}`
    : `${l.announcerName} hat die Wahrheit gesagt. ${l.doubterName} hat zu Unrecht gezweifelt und verliert ein Leben ${beer(1)}`;
}
export { revealText };

const ok = (extra) => Object.assign({ ok: true }, extra || {});
const fail = (error) => ({ ok: false, error });

export function handle(g, pid, msg, rng = Math.random) {
  if (!g || g.game !== GAME) return fail('Kein Spiel');
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('Ungültige Nachricht');
  if (g.phase === 'over') return fail('Das Spiel ist zu Ende');
  const idx = idxOf(g, pid);
  if (idx < 0) return fail('Du spielst nicht mit');
  const me = g.players[idx];
  const mine = idx === g.active;

  switch (msg.t) {
    case 'look': // nur Sicht: kein Zustandswechsel
      if (g.phase !== 'announce' || !mine) return fail('Du hast gerade keinen Becher');
      return ok({ look: true });

    case 'roll': {
      if (g.phase !== 'roll') return fail('Jetzt wird nicht gewürfelt');
      if (!mine) return fail('Du bist nicht dran');
      const a = die(rng);
      const b = die(rng);
      g.cupDice = [a, b];
      g.cup = valueOf(a, b);
      g.rollId += 1;
      g.phase = 'announce';
      g.moves += 1;
      return ok();
    }

    case 'say': {
      if (g.phase !== 'announce') return fail('Jetzt wird nichts angesagt');
      if (!mine) return fail('Du bist nicht dran');
      const v = msg.v;
      if (!isValue(v)) return fail('Diesen Wert gibt es nicht');
      if (g.announced !== null && rankOf(v) <= rankOf(g.announced)) return fail('Die Ansage muss höher sein als die letzte');
      g.announced = v;
      g.announcer = idx;
      g.active = nextAlive(g, idx);
      g.phase = 'decide';
      g.moves += 1;
      g.last = { kind: 'say', pid: me.id, name: me.name, v, text: `${me.name} sagt ${valueText(v)} an.` };
      pushRecap(g, g.last.text);
      return ok();
    }

    case 'believe': {
      if (g.phase !== 'decide') return fail('Jetzt wird nicht geglaubt');
      if (!mine) return fail('Du bist nicht dran');
      if (g.announced === MAEXCHEN) return fail('Ein Mäxchen kann niemand überbieten: Du musst aufdecken');
      g.phase = 'roll';
      g.cup = null; g.cupDice = null;
      g.moves += 1;
      g.last = { kind: 'believe', pid: me.id, name: me.name, text: `${me.name} glaubt die Ansage und würfelt selbst.` };
      pushRecap(g, g.last.text);
      return ok();
    }

    case 'doubt': {
      if (g.phase !== 'decide') return fail('Jetzt wird nicht gezweifelt');
      if (!mine) return fail('Du bist nicht dran');
      const ann = g.players[g.announcer];
      const liar = rankOf(g.cup) < rankOf(g.announced);
      const loserIdx = liar ? g.announcer : idx;
      const loser = g.players[loserIdx];
      const loss = lossFor(g.announced);
      loser.lives = Math.max(0, loser.lives - loss);
      const out = loser.lives === 0;
      if (out) g.eliminated.push(loser.id);
      const l = {
        kind: 'reveal', announcerId: ann.id, announcerName: ann.name, doubterId: me.id, doubterName: me.name,
        announced: g.announced, real: g.cup, dice: g.cupDice ? g.cupDice.slice() : null, liar, loserId: loser.id, loserName: loser.name, loss, out,
      };
      l.text = revealText(l) + (out ? `. ${loser.name} ist raus.` : '');
      g.last = l;
      pushRecap(g, l.text);
      g.moves += 1;
      if (aliveCount(g) <= 1) {
        g.phase = 'over';
        const w = g.players.filter(isAlive).map((p) => p.id);
        g.result = { winners: w };
        g.active = Math.max(0, g.players.findIndex(isAlive));
      } else {
        g.phase = 'reveal';
        g.active = isAlive(loser) ? loserIdx : nextAlive(g, loserIdx);
      }
      return ok({ liar, loser: loser.id, loss });
    }

    case 'next': {
      if (g.phase !== 'reveal') return fail('Es gibt gerade nichts weiterzuklicken');
      g.phase = 'roll';
      g.announced = null; g.announcer = null; g.cup = null; g.cupDice = null;
      g.round += 1;
      g.moves += 1;
      if (g.moves >= MOVE_CAP) forceEnd(g);
      return ok();
    }

    default:
      return fail('Unbekannte Nachricht');
  }
}

// Notbremse (Sicherung gegen Endlosspiele): die Person mit den meisten Leben gewinnt
function forceEnd(g) {
  const best = Math.max(...g.players.map((p) => p.lives));
  g.result = { winners: g.players.filter((p) => p.lives === best).map((p) => p.id), capped: true };
  g.phase = 'over';
}

// Rangliste: Siegerin zuerst, dann nach Ausscheiden (wer zuletzt ausschied, ist weiter vorn)
export function ranking(g) {
  const winners = g.result ? g.result.winners : [];
  const rows = [];
  const byId = (id) => g.players.find((p) => p.id === id);
  winners.forEach((id) => rows.push(byId(id)));
  const rest = g.players.filter((p) => !winners.includes(p.id));
  const outOrder = (id) => g.eliminated.indexOf(id);
  rest.sort((a, b) => (isAlive(b) - isAlive(a)) || (b.lives - a.lives) || (outOrder(b.id) - outOrder(a.id)));
  rest.forEach((p) => rows.push(p));
  return rows.map((p, i) => ({ place: winners.includes(p.id) ? 1 : i + 1, id: p.id, name: p.name, lives: p.lives }));
}
