// Lernrunde für Vier in Reihe: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Spalten, die pulsieren sollen.
// Nur Erklärungen zu Bedienung und Regeln, nie ein Zugvorschlag (welche Spalte, entscheidest du selbst).
import * as M from './engine.js';

const COL = '.vr-col[data-hint="open"]';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

function myTurn(g, ctx, me) {
  if (!M.openCols(g).length) return null;
  const sig = `${g.round}.${g.moveNo}`;
  const color = M.COLOR_NAMES[me];
  if (firstTime(ctx, 'goal', sig)) {
    return { text: `Ziel: Bringe vier Steine deiner Farbe in eine Reihe. Du spielst ${color}. Tippe auf eine Spalte.`, target: COL };
  }
  if (firstTime(ctx, 'drop', sig)) {
    return { text: 'Dein Stein fällt in der Spalte ganz nach unten, bis er auf dem Boden oder auf einem anderen Stein liegt. Tippe auf eine Spalte.', target: COL };
  }
  if (firstTime(ctx, 'dirs', sig)) {
    return { text: 'Die Reihe darf waagerecht, senkrecht oder schräg verlaufen. Die Gewinnreihe leuchtet. Tippe auf eine Spalte.', target: COL };
  }
  if (firstTime(ctx, 'draw', sig)) {
    return { text: 'Ist das ganze Brett voll und niemand hat vier in einer Reihe, ist es unentschieden. Dann bekommen beide einen Punkt. Tippe auf eine Spalte.', target: COL };
  }
  return { text: 'Du bist dran. Tippe auf eine Spalte.', target: COL };
}

function overStep(g, ctx, me) {
  const target = '[data-act="next"]';
  if (g.winner === null) {
    if (firstTime(ctx, 'over-draw', `${g.round}`)) return { text: 'Das Brett ist voll, niemand hat vier in einer Reihe: unentschieden. Beide bekommen einen Punkt. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
  } else if (g.winner === me) {
    if (firstTime(ctx, 'over-win', `${g.round}`)) return { text: 'Du hast vier in einer Reihe und gewinnst zwei Punkte. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
  } else if (firstTime(ctx, 'over-lose', `${g.round}`)) {
    return { text: 'Der Computer hat vier in einer Reihe und bekommt zwei Punkte. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
  }
  return { text: 'Die Runde ist zu Ende. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.board) || !Array.isArray(game.scores)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    if (game.mode === 'over') return overStep(game, ctx, me);
    if (game.mode !== 'play') return null;
    if (game.turn !== me) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    return myTurn(game, ctx, me);
  } catch {
    return null;
  }
}
