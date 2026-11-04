// Ludo – Lernrunde: Anleitung zum Mitlesen und Vorlesen (reine Funktion, keine Oberfläche).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as P from './engine.js';

const ROLL = '[data-act="roll"]';
const PIECE = '.lu-can';
const AGAIN = '[data-act="again"]';

const felder = (n) => (n === 1 ? '1 Feld' : `${n} Felder`);

// Erklärung genau einmal: Solange die Lage (key) gleich bleibt, bleibt der Text stehen
// (das Spiel zeichnet mehrmals pro Zug), danach kommt er nie wieder.
function once(seen, name, key) {
  if (seen[name] === undefined) { seen[name] = key; return true; }
  return seen[name] === key;
}

function compute(game, ctx) {
  if (!game || typeof game !== 'object' || game.game !== 'ludo' || !Array.isArray(game.players) || !game.turn) return null;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  let seen = {};
  if (c.ui && typeof c.ui === 'object') {
    if (!c.ui.coachSeen || typeof c.ui.coachSeen !== 'object') c.ui.coachSeen = {};
    seen = c.ui.coachSeen;
  }
  const mi = game.players.findIndex((p) => p && p.id === c.id);
  if (mi < 0) return null;
  const me = game.players[mi];

  if (game.mode === 'over') {
    const w = game.players[game.winner];
    const head = w && w.id === me.id ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : `Das Spiel ist zu Ende. ${w ? w.name : 'Jemand'} hat gewonnen.`;
    return { text: `${head} Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`, target: AGAIN };
  }
  if (c.ui && c.ui.rolling) return { text: 'Der Würfel rollt. Einen Moment bitte.' };

  const t = game.turn;
  const ap = game.players[game.active];
  if (!ap) return null;
  const last = game.last && typeof game.last === 'object' ? game.last : null;
  const key = [game.gid, game.rollId, game.active, t.stage, t.rolls].join('|');

  if (ap.id !== me.id) {
    if (last && last.kind === 'nomove' && last.pid === me.id && last.rollId === game.rollId) {
      return { text: 'Du kannst nicht ziehen. Mit dieser Zahl ist kein Zug erlaubt. Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  if (t.stage === 'roll') {
    if (t.rolls > 0 && last && last.kind === 'nomove' && last.pid === me.id) {
      return { text: `Du kannst nicht ziehen. Würfle noch einmal. Das ist Versuch ${t.rolls + 1} von ${t.maxRolls}.`, target: ROLL };
    }
    if (last && last.kind === 'move' && last.captured && last.captured.some((x) => x && x.pid === me.id) && once(seen, 'gotCaptured', key)) {
      return { text: 'Eine deiner Figuren wurde rausgeworfen. Sie muss zurück ins Haus. Das gehört zum Spiel. Tippe auf Würfeln.', target: ROLL };
    }
    if (t.bonus && once(seen, 'bonus', key)) {
      return { text: 'Du hast eine 6 gewürfelt. Deshalb darfst du noch einmal würfeln. Tippe auf Würfeln.', target: ROLL };
    }
    if (t.bonus) return { text: 'Du darfst noch einmal würfeln. Tippe auf Würfeln.', target: ROLL };
    if (t.maxRolls > 1 && once(seen, 'intro', key)) {
      return { text: `Tippe auf Würfeln. Du hast noch keine Figur auf dem Brett. Du darfst bis zu ${t.maxRolls} mal würfeln, bis eine 6 fällt.`, target: ROLL };
    }
    return { text: 'Tippe auf Würfeln.', target: ROLL };
  }

  if (t.stage === 'move') {
    const die = t.die;
    const moves = P.legalMoves(game, game.active, die).filter((m) => (t.movable || []).includes(m.piece));
    const fromHome = moves.some((m) => m.from < 0);
    const captures = moves.some((m) => m.to >= 0 && m.to <= 39 && game.players.some((o) => o !== me && o.pieces.some((q) => q >= 0 && q <= 39 && P.ringIndex(o.color, q) === P.ringIndex(me.color, m.to))));
    const toGoal = moves.some((m) => m.to >= P.GOAL_FIRST);
    if (die === 6 && fromHome && once(seen, 'six', key)) {
      return { text: 'Eine 6. Mit einer 6 kommt eine Figur aus dem Haus auf dein Startfeld. Tippe auf eine Figur mit leuchtendem Ring.', target: PIECE };
    }
    if (captures && once(seen, 'capture', key)) {
      return { text: 'Du kannst eine fremde Figur rauswerfen. Landest du genau auf ihr, muss sie zurück in ihr Haus. Tippe auf eine Figur mit leuchtendem Ring.', target: PIECE };
    }
    if (toGoal && once(seen, 'goal', key)) {
      return { text: 'Eine Figur kann in die Zielgerade ziehen. Das sind die vier Felder zur Mitte. Im Ziel ist die Figur in Sicherheit. Tippe auf eine leuchtende Figur.', target: PIECE };
    }
    if (moves.length <= 1) {
      return { text: `Du hast eine ${die} gewürfelt. Nur eine Figur darf ziehen. Tippe auf die Figur mit leuchtendem Ring.`, target: PIECE };
    }
    return { text: `Du hast eine ${die} gewürfelt. Deine Figur zieht ${felder(die)}. Tippe auf eine Figur mit leuchtendem Ring.`, target: PIECE };
  }
  return null;
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
