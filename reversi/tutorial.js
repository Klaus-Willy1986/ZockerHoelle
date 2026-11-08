// Lernrunde für Reversi: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Felder, die pulsieren sollen.
// Nur Erklärungen zu Bedienung und Regeln, nie ein Zugvorschlag (welches Feld, entscheidest du selbst).
import * as M from './engine.js';

const CELL = '.rv-cell[data-hint="legal"]';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

function myTurn(g, ctx, me) {
  const sig = `${g.round}.${g.moveNo}`;
  const color = M.colorOf(g, me);
  const empty = g.board.filter((v) => v === null).length;
  if (firstTime(ctx, 'goal', sig)) {
    return { text: `Ziel: Am Ende sollen mehr Steine deiner Farbe auf dem Brett liegen als Steine deines Gegenübers. Du bist ${color}. Die Felder mit Punkt sind erlaubt.`, target: CELL };
  }
  if (firstTime(ctx, 'place', sig)) {
    return { text: 'Du setzt einen Stein, indem du auf ein leeres Feld mit Punkt tippst. Dort muss mindestens ein gegnerischer Stein eingeschlossen werden.', target: CELL };
  }
  if (firstTime(ctx, 'flip', sig)) {
    return { text: 'Eingeschlossene Steine werden umgedreht und gehören dann dir. Das geht waagerecht, senkrecht und schräg, auch in mehrere Richtungen auf einmal.', target: CELL };
  }
  const corner = M.CORNERS.some((q) => g.board[q] !== null);
  if (corner && firstTime(ctx, 'corner', sig)) {
    return { text: 'In einer Ecke liegt ein Stein. Steine in den vier Ecken können nicht mehr umgedreht werden.', target: CELL };
  }
  if (empty <= 20 && firstTime(ctx, 'end', sig)) {
    return { text: 'Das Spiel endet, wenn das Brett voll ist oder niemand mehr ziehen kann. Dann gewinnt, wer mehr Steine hat.', target: CELL };
  }
  return { text: 'Du bist dran. Tippe auf ein Feld mit Punkt.', target: CELL };
}

function passStep(g, ctx, me) {
  const target = '[data-act="ack"]';
  const first = firstTime(ctx, 'pass', `${g.round}.${g.moveNo}`);
  const nn = g.players[g.turn].name;
  if (g.passer === me) {
    return { text: first
      ? `Du kannst nicht ziehen, weil du keinen Stein einschließen kannst. Das nennt man Passen. ${nn} ist wieder dran. Tippe auf OK.`
      : `Du kannst nicht ziehen, ${nn} ist wieder dran. Tippe auf OK.`, target };
  }
  return { text: first
    ? 'Der Computer kann keinen Stein einschließen und muss passen. Du bist wieder dran. Tippe auf OK.'
    : 'Der Computer kann nicht ziehen. Du bist wieder dran. Tippe auf OK.', target };
}

function overStep(g, ctx, me) {
  const target = '[data-act="next"]';
  const more = 'Tippe auf Noch eine Runde, um weiterzuspielen.';
  const c = g.final || M.countsOf(g.board);
  const end = firstTime(ctx, 'end', `o${g.round}`)
    ? 'Das Spiel endet, wenn das Brett voll ist oder niemand mehr ziehen kann. '
    : '';
  if (g.winner === null) {
    return { text: `${end}Gleich viele Steine, ${c[0]} zu ${c[1]}: unentschieden. Beide bekommen einen Punkt. ${more}`, target };
  }
  if (g.winner === me) {
    return { text: `${end}Du hast mehr Steine, ${c[me]} zu ${c[1 - me]}, und bekommst 2 Punkte. ${more}`, target };
  }
  return { text: `${end}Der Computer hat mehr Steine, ${c[1 - me]} zu ${c[me]}, und bekommt 2 Punkte. ${more}`, target };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.board) || !Array.isArray(game.scores)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    if (game.mode === 'over') return overStep(game, ctx, me);
    if (game.mode === 'pass') return passStep(game, ctx, me);
    if (game.mode !== 'play') return null;
    if (game.turn !== me) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    return myTurn(game, ctx, me);
  } catch {
    return null;
  }
}
