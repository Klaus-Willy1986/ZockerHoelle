// Lernrunde für Schach: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Elemente, die pulsieren sollen.
// Erklärt Regeln und Bedienung Schritt für Schritt (je Zug eine Erklärung, jede nur einmal). Keine Zugempfehlung für die Partie:
// "Probiere es aus" zeigt nur die gerade erklärte Figur, nicht einen guten Zug.
import * as P from './engine.js';

const TYPE_CLASS = ['', 't-p', 't-n', 't-b', 't-r', 't-q', 't-k'];
const PICK = 'button.sc-sq.can';
const TGT = 'button.sc-sq.tgt';

// Reihenfolge: zuerst Brett und Ziel, dann Ereignisse (sobald sie möglich sind), dann die Figuren einzeln, am Ende Matt und Remis
const ORDER = ['board', 'goal', 'check', 'castle', 'ep', 'promo', 'capture', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'matt', 'draw'];

function texts(me) {
  return {
    board: `Das Brett hat 64 Felder: Spalten a bis h, Reihen 1 bis 8. Du bist ${P.COLOR_NAMES[me]}, deine Figuren stehen unten.`,
    goal: 'Ziel: den gegnerischen König Schachmatt setzen. Er wird dann angegriffen und kann nicht entkommen.',
    check: 'Schach! Dein König wird angegriffen. Rette ihn: wegziehen, den Angreifer schlagen oder dazwischenstellen.',
    castle: 'Rochade: Der König geht zwei Felder zum Turm, der Turm springt auf seine andere Seite. Tippe den König an.',
    ep: 'Im Vorbeigehen schlagen: Zieht ein Bauer zwei Felder neben deinen Bauern, darfst du ihn sofort schlagen.',
    promo: 'Umwandlung: Ein Bauer auf der letzten Reihe wird zu Dame, Turm, Läufer oder Springer. Tippe den Bauern an.',
    capture: 'Schlagen: Zieh auf eine gegnerische Figur, dann kommt sie vom Brett (roter Ring). Tippe eine passende Figur an.',
    pawn: 'Der Bauer geht ein Feld vor, vom Start aus zwei. Er schlägt nur schräg. Probiere es aus: Tippe einen Bauern an.',
    knight: 'Der Springer hüpft in L-Form und darf über Figuren springen. Probiere es aus: Tippe einen Springer an.',
    bishop: 'Der Läufer zieht beliebig weit schräg. Probiere es aus: Tippe einen Läufer an.',
    rook: 'Der Turm zieht beliebig weit gerade. Probiere es aus: Tippe einen Turm an.',
    queen: 'Die Dame zieht gerade und schräg, beliebig weit. Probiere es aus: Tippe die Dame an.',
    king: 'Der König zieht ein Feld in jede Richtung, nie auf ein angegriffenes Feld. Probiere es aus: Tippe den König an.',
    matt: 'Schachmatt: Der König steht im Schach und kein Zug rettet ihn. Die Partie ist zu Ende.',
    draw: 'Remis heißt unentschieden: Patt, dreimal gleiche Stellung, 50 Züge ohne Bauern oder Schlagen, zu wenig Figuren.',
  };
}

function pickTarget(key, legal, me) {
  const t = { pawn: 1, knight: 2, bishop: 3, rook: 4, queen: 5, king: 6 }[key];
  if (t) return `${PICK}.${TYPE_CLASS[t]}`;
  if (key === 'capture') return `${PICK}.cp`;
  if (key === 'castle') return `${PICK}.ck`;
  if (key === 'ep') return `${PICK}.ep`;
  if (key === 'promo') return `${PICK}.pr`;
  if (key === 'check') return PICK;
  return null;
}
function selTarget(key, mine) {
  if (key === 'capture' && mine.some((m) => m.capture)) return `${TGT}.cap`;
  if (key === 'castle' && mine.some((m) => m.castle)) return `${TGT}.rk`;
  if (key === 'ep' && mine.some((m) => m.ep)) return `${TGT}.epx`;
  if (key === 'promo' && mine.some((m) => m.promo)) return `${TGT}.prx`;
  return TGT;
}

function applicable(g, legal, me) {
  const has = (t) => legal.some((m) => m.piece === t);
  return {
    board: true,
    goal: true,
    check: !!g.check,
    castle: legal.some((m) => m.castle),
    ep: legal.some((m) => m.ep),
    promo: legal.some((m) => m.promo),
    capture: legal.some((m) => m.capture),
    pawn: has(1), knight: has(2), bishop: has(3), rook: has(4), queen: has(5), king: has(6),
    matt: true,
    draw: true,
  };
}

function humanTurn(g, ctx, me) {
  const legal = P.legalMoves(g);
  if (!legal.length) return null;
  const ui = ctx.ui;
  if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
  const sel = Number.isInteger(ui.sel) && legal.some((m) => m.from === ui.sel) ? ui.sel : null;
  const mine = sel === null ? [] : legal.filter((m) => m.from === sel);
  // Umwandlung: Auswahl der neuen Figur
  if (ui.promo && typeof ui.promo === 'object' && !ui.coachSeen.promoPick) {
    ui.coachSeen.promoPick = true;
    ui.coachPromoSig = `${g.round}|${g.moveNo}`;
  }
  if (ui.promo && typeof ui.promo === 'object') {
    const text = ui.coachPromoSig === `${g.round}|${g.moveNo}`
      ? 'Wähle jetzt die neue Figur für deinen Bauern: Dame, Turm, Läufer oder Springer.'
      : 'Wähle die neue Figur für deinen Bauern.';
    return { text, target: '[data-act="promo"]' };
  }
  const sig = `${g.round}|${g.moveNo}`;
  let turn = ui.coachTurn;
  if (!turn || typeof turn !== 'object' || turn.sig !== sig) {
    const ok = applicable(g, legal, me);
    const key = ORDER.find((k) => ok[k] && !ui.coachSeen[k]) || null;
    turn = ui.coachTurn = { sig, key };
    if (key) ui.coachSeen[key] = true;
  }
  const T = texts(me);
  const key = turn.key;
  if (!key) {
    return sel === null
      ? { text: g.check ? 'Du stehst im Schach. Tippe eine leuchtende Figur an, die helfen kann.' : 'Du bist dran. Tippe eine leuchtende Figur an, dann ein markiertes Feld.', target: PICK }
      : { text: 'Tippe auf ein markiertes Feld. Dorthin zieht deine Figur.', target: TGT };
  }
  const text = T[key];
  if (sel !== null) return { text, target: selTarget(key, mine) };
  return { text, target: pickTarget(key, legal, me) || '#board' };
}

function overText(g, pi) {
  const r = g.result || {};
  const mine = g.winner === pi;
  const next = ' Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.';
  if (r.reason === 'checkmate') return `${mine ? 'Schachmatt! Du hast gewonnen.' : 'Schachmatt! Der Computer hat gewonnen.'}${next}`;
  const why = {
    stalemate: 'Patt: Wer am Zug ist, kann nicht ziehen, steht aber nicht im Schach.',
    threefold: 'Dieselbe Stellung gab es zum dritten Mal.',
    fifty: '50 Züge lang gab es keinen Bauernzug und kein Schlagen.',
    dead: 'Mit den übrigen Figuren kann niemand mehr Schachmatt setzen.',
    maxply: 'Die Partie wurde beendet.',
  }[r.reason] || '';
  return `Remis, also unentschieden. ${why}${next}`;
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.board) || !game.opts) return null;
    const pi = game.players.findIndex((p) => p.id === ctx.id);
    if (pi < 0) return null;
    if (game.mode === 'over') return { text: overText(game, pi), target: '[data-act="next"]' };
    if (game.mode !== 'play') return null;
    const me = pi === game.white ? 0 : 1;
    if (game.turn !== me) {
      const ui = ctx.ui;
      if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
      const other = game.check && !ui.coachSeen.checkgiven;
      if (other) {
        ui.coachSeen.checkgiven = `${game.round}|${game.moveNo}`;
      }
      if (ui.coachSeen.checkgiven === `${game.round}|${game.moveNo}`) {
        return { text: 'Du hast Schach gesagt. Der Computer muss seinen König retten, sonst ist es Schachmatt.' };
      }
      return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    return humanTurn(game, ctx, me);
  } catch {
    return null;
  }
}
