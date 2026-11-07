// Lernrunde für Bauernschach: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Elemente, die pulsieren sollen.
// Keine Strategie-Tipps, keine Zugempfehlung, keine Warnung vor Bedrohungen: nur Regeln und Bedienung.
import * as P from './engine.js';

const PICK = 'button.bs-sq.can';
const TARGET = 'button.bs-sq.tgt';

// Eine Erklärung bleibt stehen, solange sie im selben Zustand (Zug und Auswahl-Phase) gezeigt wird,
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}
const showing = (ctx, key, sig) => {
  const seen = ctx.ui.coachSeen;
  return !!seen && seen[key] === sig;
};

const TOPICS_PICK = ['goal', 'capture', 'ep', 'blocked', 'goalnear'];
const TOPICS_SEL = ['straight', 'double', 'diag', 'ep'];

function humanTurn(g, ctx, me) {
  const legal = P.legalMoves(g);
  if (!legal.length) return null;
  const sel = Number.isInteger(ctx.ui.sel) && legal.some((m) => m.from === ctx.ui.sel) ? ctx.ui.sel : null;
  const phase = sel === null ? 'pick' : 'sel';
  const sig = `${g.round}|${g.moveNo}|${phase}`;
  const dirTxt = me === 0 ? 'obersten Reihe (Reihe 8)' : 'untersten Reihe (Reihe 1)';
  const forced = g.opts.mustCapture && legal.some((m) => m.capture);

  if (phase === 'sel') {
    const mine = legal.filter((m) => m.from === sel);
    const has = (k) => mine.some((m) => m.kind === k);
    const applicable = {
      straight: true,
      double: has('double'),
      diag: has('capture'),
      ep: has('ep'),
    };
    const texts = {
      straight: 'Ein Bauer zieht ein Feld geradeaus, wenn das Feld davor frei ist. Die Zielfelder sind markiert. Tippe auf ein markiertes Feld.',
      double: 'Vom Startfeld aus darf ein Bauer auch zwei Felder geradeaus ziehen, wenn beide Felder frei sind. Tippe auf ein markiertes Feld.',
      diag: 'Ein Bauer schlägt schräg nach vorn. Geradeaus kann er nicht schlagen. Tippe auf ein markiertes Feld.',
      ep: 'Das ist ein Sonderfall: Nach einem Doppelschritt darf der Bauer daneben sofort im Vorbeigehen schlagen. Tippe auf das markierte Feld.',
    };
    for (const k of TOPICS_SEL) if (applicable[k] && showing(ctx, k, sig)) return { text: texts[k], target: TARGET };
    for (const k of TOPICS_SEL) if (applicable[k] && firstTime(ctx, k, sig)) return { text: texts[k], target: TARGET };
    return { text: forced ? 'Du musst schlagen. Tippe auf ein markiertes Feld.' : 'Tippe auf ein markiertes Feld. Dorthin zieht dein Bauer.', target: TARGET };
  }

  const hasCap = legal.some((m) => m.kind === 'capture');
  const hasEp = legal.some((m) => m.kind === 'ep');
  const blocked = g.board.some((p, i) => p === me + 1 && g.board[i + P.dirOf(me) * 8] === 2 - me);
  const near = g.board.some((p, i) => p === me + 1 && (i >> 3) === P.goalRank(me) - P.dirOf(me));
  const applicable = { goal: true, capture: hasCap, ep: hasEp, blocked, goalnear: near };
  const texts = {
    goal: `Dein Ziel: Bring einen Bauern bis zur ${dirTxt}. Dann hast du gewonnen. Tippe einen leuchtenden Bauern an.`,
    capture: 'Du kannst schräg schlagen. Ein geschlagener Bauer kommt vom Brett. Tippe einen leuchtenden Bauern an.',
    ep: 'Im Vorbeigehen schlagen ist möglich, aber nur direkt nach einem Doppelschritt. Tippe einen leuchtenden Bauern an.',
    blocked: 'Steht ein Bauer direkt vor einem anderen, sind beide blockiert. Wer gar nicht mehr ziehen kann, verliert. Tippe einen leuchtenden Bauern an.',
    goalnear: 'Wer die letzte Reihe erreicht, gewinnt sofort. Tippe einen leuchtenden Bauern an.',
  };
  for (const k of TOPICS_PICK) if (applicable[k] && showing(ctx, k, sig)) return { text: texts[k], target: PICK };
  for (const k of TOPICS_PICK) if (applicable[k] && firstTime(ctx, k, sig)) return { text: texts[k], target: PICK };
  return { text: forced ? 'Du musst schlagen. Tippe einen leuchtenden Bauern an.' : 'Du bist dran. Tippe einen leuchtenden Bauern an.', target: PICK };
}

function overText(g, me) {
  const mine = g.winner === me; // me = Index der Person
  const how = {
    goal: mine ? 'Dein Bauer hat die letzte Reihe erreicht. Das ist der Durchbruch.' : 'Ein Bauer des Computers hat die letzte Reihe erreicht. Das ist der Durchbruch.',
    all: mine ? 'Du hast alle Bauern des Computers geschlagen.' : 'Der Computer hat alle deine Bauern geschlagen.',
    blocked: mine ? 'Der Computer kann nicht mehr ziehen. Wer nicht ziehen kann, verliert.' : 'Du kannst nicht mehr ziehen. Wer nicht ziehen kann, verliert.',
  }[g.endCode] || '';
  return `${mine ? 'Du hast gewonnen.' : 'Der Computer hat gewonnen.'} ${how} Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`;
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.board) || !game.opts) return null;
    const pi = game.players.findIndex((p) => p.id === ctx.id);
    if (pi < 0) return null;
    if (game.mode === 'over') return { text: overText(game, pi), target: '[data-act="next"]' };
    if (game.mode !== 'play') return null;
    const me = pi === game.white ? 0 : 1;
    if (game.turn !== me) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    return humanTurn(game, ctx, me);
  } catch {
    return null;
  }
}
