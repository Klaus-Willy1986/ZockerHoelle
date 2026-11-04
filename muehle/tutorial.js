// Lernrunde für Mühle: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Punkte, die pulsieren sollen.
// Keine Strategie-Tipps, nur: was kann man tun, was muss man tun, wie funktioniert das Spiel.
import * as M from './engine.js';

const hit = (kind) => `.mh-hit[data-hint="${kind}"]`;

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

function removeStep(g, ctx, me) {
  const sig = `r${g.moveNo}`;
  const opp = M.other(me);
  const removable = M.removablePoints(g, opp);
  if (!removable.length) return null;
  if (firstTime(ctx, 'mill', sig)) {
    return { text: 'Drei Steine in einer Reihe sind eine Mühle. Du darfst einen Stein des Gegners wegnehmen. Tippe einen Stein mit rotem Ring an.', target: hit('rem') };
  }
  const own = g.board.map((v, i) => (v === opp ? i : -1)).filter((i) => i >= 0);
  const someProtected = removable.length < own.length;
  if (someProtected && firstTime(ctx, 'protect', sig)) {
    return { text: 'Steine in einer Mühle sind geschützt. Du kannst nur Steine mit rotem Ring nehmen. Tippe einen davon an.', target: hit('rem') };
  }
  return { text: 'Du hast eine Mühle. Tippe einen Stein mit rotem Ring an. Er wird weggenommen.', target: hit('rem') };
}

function placeStep(g, ctx, me) {
  if (!M.freePoints(g).length) return null;
  const left = g.toPlace[me];
  if (firstTime(ctx, 'place', `p${g.moveNo}`)) {
    return { text: 'Setze abwechselnd Steine auf freie Punkte, bis alle gesetzt sind. Tippe einen orangen Punkt an.', target: hit('free') };
  }
  return { text: `Du bist dran. Du hast noch ${left} ${left === 1 ? 'Stein' : 'Steine'} zu setzen. Tippe einen orangen Punkt an.`, target: hit('free') };
}

function moveStep(g, ctx, me) {
  const sig = `m${g.moveNo}`;
  const sel = ctx.ui.sel;
  const picked = Number.isInteger(sel) && sel >= 0 && sel < 24 && g.board[sel] === me && M.targetsFrom(g, sel).length > 0;
  if (!picked && !M.movableStones(g, me).length) return null;
  let intro = '';
  if (M.canFly(g, me) && firstTime(ctx, 'fly', sig)) {
    intro = 'Du hast nur noch drei Steine. Jetzt darfst du fliegen: Dein Stein darf auf jeden freien Punkt springen. ';
  } else if (firstTime(ctx, 'move', sig)) {
    intro = 'Ziehe einen Stein auf einen benachbarten freien Punkt, entlang der Linien. ';
  } else if (!picked) {
    intro = 'Du bist dran. ';
  }
  const text = intro + (picked ? 'Tippe jetzt auf einen grünen Punkt. Dorthin zieht dein Stein.' : 'Tippe einen Stein mit orangem Ring an.');
  return { text, target: picked ? hit('target') : hit('can') };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.board) || !Array.isArray(game.toPlace)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    if (game.mode === 'over') {
      return { text: 'Das Spiel ist zu Ende. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target: '[data-act="again"]' };
    }
    if (game.mode !== 'play') return null;
    if (game.drawOffer !== null && game.drawOffer !== undefined) {
      if (game.drawOffer === me) return { text: 'Du hast Remis angeboten. Das heißt unentschieden. Bitte warte auf die Antwort.' };
      return { text: 'Der Computer bietet Remis an. Das heißt unentschieden. Tippe auf Annehmen oder auf Ablehnen.', target: '[data-act="draw-accept"], [data-act="draw-decline"]' };
    }
    if (game.turn !== me) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    if (game.removing) return removeStep(game, ctx, me);
    if (game.toPlace[me] > 0) return placeStep(game, ctx, me);
    return moveStep(game, ctx, me);
  } catch {
    return null;
  }
}
