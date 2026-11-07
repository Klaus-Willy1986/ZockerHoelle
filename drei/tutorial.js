// Lernrunde für Drei gewinnt: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Felder, die pulsieren sollen.
// Nur Erklärungen zu Bedienung und Regeln, nie ein Zugvorschlag (welches Feld, entscheidest du selbst).
import * as M from './engine.js';

const CELL = '.dr-cell[data-hint="free"]';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

function myTurn(g, ctx, me) {
  if (!M.freeCells(g).length) return null;
  const sig = `${g.round}.${g.moveNo}`;
  const mark = M.MARK_NAMES[me];
  const need = g.k === 3 ? 'drei' : 'vier';
  if (firstTime(ctx, 'place', sig)) {
    return { text: `Ihr setzt abwechselnd ein Zeichen. Du bist das ${mark}. Tippe auf ein freies Feld, dann erscheint dein Zeichen.`, target: CELL };
  }
  if (firstTime(ctx, 'win', sig)) {
    return { text: `Wer zuerst ${need} gleiche Zeichen in einer Reihe hat, gewinnt. Die Reihe darf waagerecht, senkrecht oder schräg sein. Tippe auf ein freies Feld.`, target: CELL };
  }
  if (firstTime(ctx, 'draw', sig)) {
    return { text: 'Ist das ganze Feld voll und niemand hat eine Reihe, ist es unentschieden. Dann bekommt niemand einen Punkt. Tippe auf ein freies Feld.', target: CELL };
  }
  return { text: 'Du bist dran. Tippe auf ein freies Feld.', target: CELL };
}

function overStep(g, ctx, me) {
  const target = '[data-act="next"]';
  if (g.winner === null) {
    if (firstTime(ctx, 'over-draw', `${g.round}`)) return { text: 'Das Feld ist voll, niemand hat eine Reihe: unentschieden. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
  } else if (g.winner === me) {
    if (firstTime(ctx, 'over-win', `${g.round}`)) return { text: 'Du hast eine Reihe und gewinnst einen Punkt. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
  } else if (firstTime(ctx, 'over-lose', `${g.round}`)) {
    return { text: 'Der Computer hat eine Reihe und bekommt einen Punkt. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target };
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
