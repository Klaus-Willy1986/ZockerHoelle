// Lernrunde für Dame: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Elemente, die pulsieren sollen.
// Keine Strategie-Tipps, nur: was kann man tun, was muss man tun, wie funktioniert das Spiel.
import * as P from './engine.js';

const PICK = 'button.dm-sq.can';
const TARGET = 'button.dm-sq.tgt';

// Eine Erklärung bleibt innerhalb des Zugs stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

function humanTurn(g, ctx, me) {
  const sig = `${g.moveNo}`;
  const legal = P.legalMoves(g);
  if (!legal.length) return null;
  const forced = legal.some((m) => m.caps.length > 0);
  let path = Array.isArray(ctx.ui.path) ? ctx.ui.path : [];
  const pre = (m) => path.every((v, k) => m.path[k] === v);
  if (path.length && !legal.some((m) => m.path.length > path.length && pre(m))) path = [];

  if (path.length >= 2) {
    const text = firstTime(ctx, 'multi', sig)
      ? 'Du musst weiterschlagen. Wenn es nach dem Sprung noch geht, springst du im selben Zug weiter. Tippe das markierte Feld an.'
      : 'Du musst weiterschlagen. Tippe das markierte Feld an.';
    return { text, target: TARGET };
  }
  if (path.length === 1) {
    return { text: forced ? 'Tippe jetzt das markierte Feld an. Dann schlägst du den Stein.' : 'Tippe jetzt das markierte Feld an. Dort zieht dein Stein hin.', target: TARGET };
  }
  if (forced) {
    const text = firstTime(ctx, 'capture', sig)
      ? 'Wenn du schlagen kannst, musst du schlagen. Tippe einen leuchtenden Stein an.'
      : 'Du musst schlagen. Tippe einen leuchtenden Stein an.';
    return { text, target: PICK };
  }
  if (g.board.some((p) => P.isDame(p)) && firstTime(ctx, 'dame', sig)) {
    return { text: 'Ein Stein mit Krone ist eine Dame. Sie zieht beliebig weit schräg, vorwärts und rückwärts. Tippe einen leuchtenden Stein an.', target: PICK };
  }
  if (firstTime(ctx, 'basic', sig)) {
    return { text: 'Ein Stein zieht ein Feld schräg nach vorne. Tippe einen leuchtenden Stein an.', target: PICK };
  }
  return { text: 'Du bist dran. Tippe einen leuchtenden Stein an.', target: PICK };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.board)) return null;
    const me = game.players.findIndex((p) => p.id === ctx.id);
    if (me < 0) return null;
    if (game.mode === 'over') {
      return { text: 'Das Spiel ist zu Ende. Tippe auf Noch eine Partie spielen, wenn du weiterspielen möchtest.', target: '[data-act="again"]' };
    }
    if (game.drawOffer !== null && game.drawOffer !== undefined) {
      if (game.drawOffer === me) return { text: 'Du hast Remis angeboten. Das heißt unentschieden. Bitte warte auf die Antwort.' };
      return { text: 'Der Computer bietet Remis an. Das heißt unentschieden. Tippe auf Annehmen oder auf Weiterspielen.', target: '[data-act="draw-accept"], [data-act="draw-decline"]' };
    }
    if (game.mode !== 'normal') return null;
    if (game.turn !== me) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    return humanTurn(game, ctx, me);
  } catch {
    return null;
  }
}
