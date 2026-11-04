// Barrikade – Lernrunde: Anleitung zum Mitlesen und Vorlesen (reine Funktion, keine Oberfläche).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as E from './engine.js';

const ROLL = '[data-act="roll"]';
const PICK = '[data-act="pick"]';
const DEST = '[data-act="dest"]';
const PLACE = '[data-act="place"]';
const AGAIN = '[data-act="again"]';

const felder = (n) => (n === 1 ? '1 Feld' : `${n} Felder`);

// Erklärung genau einmal: Solange die Lage (key) gleich bleibt, bleibt der Text stehen
// (das Spiel zeichnet mehrmals pro Zug), danach kommt er nie wieder.
function once(seen, name, key) {
  if (seen[name] === undefined) { seen[name] = key; return true; }
  return seen[name] === key;
}

const whoLabel = (p) => `${p.name} (${E.COLOR_NAMES[p.color]})`;

function compute(game, ctx) {
  if (!game || typeof game !== 'object' || game.game !== 'bk' || !Array.isArray(game.players) || !Array.isArray(game.pieces)) return null;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  let seen = {};
  let sel = null;
  if (c.ui && typeof c.ui === 'object') {
    if (!c.ui.coachSeen || typeof c.ui.coachSeen !== 'object') c.ui.coachSeen = {};
    seen = c.ui.coachSeen;
    sel = c.ui.sel || null;
  }
  const me = game.players.find((p) => p && p.id === c.id);
  if (!me) return null;

  if (game.phase === 'over') {
    const w = game.players.find((p) => p.id === game.winner);
    const head = w && w.id === me.id ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : `Das Spiel ist zu Ende. ${w ? w.name : 'Jemand'} hat gewonnen.`;
    return { text: `${head} Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`, target: AGAIN };
  }
  if (c.ui && c.ui.rolling) return { text: 'Der Würfel rollt. Einen Moment bitte.' };

  const ap = E.activePlayer(game);
  if (!ap) return null;
  const recap0 = Array.isArray(game.recap) && typeof game.recap[0] === 'string' ? game.recap[0] : '';
  const mine = ap.id === me.id;

  if (!mine) {
    if (recap0.startsWith(whoLabel(me)) && recap0.includes('kann aber nicht ziehen')) {
      return { text: 'Du kannst nicht ziehen. Mit dieser Zahl ist kein Zug erlaubt. Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  if (game.phase === 'roll') {
    const key = `${game.turnNo}|roll`;
    if (recap0.includes(`${whoLabel(me)} wurde hinausgeworfen`) && once(seen, 'gotCaptured', key)) {
      return { text: 'Eine deiner Figuren wurde hinausgeworfen. Sie muss zurück ins Haus. Das gehört zum Spiel. Tippe auf Würfeln.', target: ROLL };
    }
    if (once(seen, 'intro', key)) {
      return { text: 'Tippe auf Würfeln. Die Zahl sagt dir, wie viele Felder deine Figur zieht.', target: ROLL };
    }
    if (once(seen, 'barrierIntro', key)) {
      return { text: 'Die schwarzen Steine sind Sperren. Man darf sie nicht überspringen. Man kann nur mit genau passendem Wurf auf sie ziehen. Tippe auf Würfeln.', target: ROLL };
    }
    return { text: 'Tippe auf Würfeln.', target: ROLL };
  }

  if (game.phase === 'move') {
    const die = game.die;
    const moves = E.legalMoves(game);
    if (!moves.length) return null;
    const bar = new Set(game.barriers);
    const occ = new Map(game.pieces.filter((p) => p.pos !== 'H').map((p) => [p.pos, p]));
    const selPiece = sel ? game.pieces.find((p) => p.id === sel && p.color === me.color) : null;
    const selMoves = selPiece ? moves.filter((m) => m.piece === selPiece.id) : [];
    const key = `${game.turnNo}|move|${selMoves.length ? selPiece.id : ''}`;

    if (selMoves.length) {
      if (selPiece.pos === 'H' && once(seen, 'house', key)) {
        return { text: 'Diese Figur kommt aus dem Haus. Das Startfeld vor dem Haus zählt schon als erster Schritt. Tippe auf ein leuchtendes Feld.', target: DEST };
      }
      if (selMoves.some((m) => occ.has(m.to) && occ.get(m.to).color !== me.color) && once(seen, 'capture', key)) {
        return { text: 'Auf einem leuchtenden Feld steht eine fremde Figur. Landest du genau dort, wird sie hinausgeworfen und muss zurück ins Haus. Tippe auf ein leuchtendes Feld.', target: DEST };
      }
      if (selMoves.some((m) => bar.has(m.to)) && once(seen, 'barrierTake', key)) {
        return { text: 'Auf einem leuchtenden Feld liegt eine Sperre. Sperren darf man nicht überspringen. Du kannst nur mit genau passendem Wurf darauf ziehen. Dann nimmst du sie auf und stellst sie neu hin.', target: DEST };
      }
      return { text: `Tippe auf ein leuchtendes Feld. Die Figur zieht genau ${felder(die)}.`, target: DEST };
    }

    if (moves.some((m) => bar.has(m.to)) && once(seen, 'barrierReach', key)) {
      return { text: `Du hast eine ${die} gewürfelt. Mit einer Figur erreichst du eine Sperre. Sperren darf man nicht überspringen. Man kann nur mit genau passendem Wurf darauf ziehen. Tippe auf eine leuchtende Figur.`, target: PICK };
    }
    if (once(seen, 'zugzwang', key)) {
      return { text: `Du hast eine ${die} gewürfelt. Wenn du ziehen kannst, musst du ziehen. Tippe auf eine leuchtende Figur.`, target: PICK };
    }
    return { text: `Du hast eine ${die} gewürfelt. Tippe auf eine leuchtende Figur.`, target: PICK };
  }

  if (game.phase === 'place') {
    const key = `${game.turnNo}|place`;
    if (once(seen, 'place', key)) {
      return { text: 'Du hast eine Sperre genommen. Du musst sie auf ein freies Feld stellen. Nur die unterste Reihe ist nicht erlaubt. Tippe auf ein leuchtendes Feld.', target: PLACE };
    }
    return { text: 'Du hast eine Sperre genommen. Setze sie auf ein freies Feld. Tippe auf ein leuchtendes Feld.', target: PLACE };
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
