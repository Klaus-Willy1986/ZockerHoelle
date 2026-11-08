// Bingo – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie.
// Keine Zugempfehlung im Sinne einer Strategie: Es gibt beim Bingo keine Wahl. In der Lernrunde darf das Ziel-Highlight
// das Feld einer gerade gezogenen Zahl zeigen (so lernt man, wo man tippt). Alle anderen Ziele sind Knöpfe.
// Jede ausführliche Erklärung gehört zu genau einer Lage und kommt deshalb nur einmal vor.
import * as E from './engine.js';

// Eine Erklärung bleibt sichtbar, solange sich ihr Zustand (sig) nicht ändert, und kommt danach nie wieder.
function once(ctx, key, sig) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (!(key in ui.coachSeen)) ui.coachSeen[key] = sig;
    return ui.coachSeen[key] === sig;
  } catch { return false; }
}

const DRAW = '[data-act=draw]';
const BINGO = '[data-act=bingo]';
const NEXT = '[data-act=next]';
const cell = (n) => `.bg-cell[data-n="${n}"]`;

function pendingNumbers(g, me) {
  // gezogene Zahlen, die auf meiner Karte stehen und noch nicht markiert sind (in Reihenfolge des Ziehens)
  const out = [];
  for (const n of g.drawn) {
    for (let c = 0; c < g.cards[me].length; c++) if (E.cellOf(g, me, c, n) >= 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function build(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== E.GAME || !Array.isArray(g.players) || !Array.isArray(g.drawn)) return null;
  if (!g.cards || !g.marks || typeof g.cards !== 'object' || typeof g.marks !== 'object') return null;
  if (!ctx || typeof ctx !== 'object') return null;
  const me = ctx.id;
  if (!g.players.some((p) => p && p.id === me) || !Array.isArray(g.cards[me]) || !Array.isArray(g.marks[me])) return null;
  const won = Array.isArray(g.winners) && g.winners.includes(me);

  if (g.phase === 'over') {
    if (won) return { text: 'BINGO! Du hast die Runde gewonnen. Die Lernrunde ist geschafft. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target: NEXT };
    return { text: 'Diesmal war der Computer schneller, das passiert. Die Lernrunde ist geschafft. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target: NEXT };
  }

  const n = g.drawn.length;
  const last = n ? g.drawn[n - 1] : null;

  if (E.isValid(g, me)) {
    if (once(ctx, 'bingo', n)) return { text: 'Du hast eine ganze Reihe markiert! Jetzt musst du es sagen: Tippe auf den großen Knopf BINGO.', target: BINGO };
    return { text: 'Tippe auf den Knopf BINGO.', target: BINGO };
  }

  if (n === 0) {
    return { text: 'Willkommen! Das ist deine Karte. Die Mitte ist frei. Der Computer spielt mit. Tippe auf Nächste Zahl, dann wird die erste Zahl gezogen.', target: DRAW };
  }

  const pend = pendingNumbers(g, me);
  if (pend.length) {
    const t = pend[pend.length - 1];
    if (once(ctx, 'mark', n)) {
      return { text: 'Oben steht die gezogene Zahl. Du hast sie auf deiner Karte! Tippe sie an, dann wird sie markiert. Das Markieren machst du selbst.', target: cell(t) };
    }
    if (pend.length > 1) return { text: 'Du hast noch nicht alle gezogenen Zahlen markiert. Tippe die nächste an.', target: cell(pend[0]) };
    return { text: 'Tippe die gezogene Zahl auf deiner Karte an.', target: cell(t) };
  }

  const marked = g.marks[me].some((m) => Array.isArray(m) && m.filter((x) => x === 1).length > 1);
  if (marked && once(ctx, 'goal', n)) {
    return { text: 'Markiert! Du gewinnst, wenn eine ganze Reihe, Spalte oder Diagonale markiert ist. Die Mitte zählt mit. Tippe auf Nächste Zahl.', target: DRAW };
  }
  if (!marked && last !== null && once(ctx, 'notmine', n)) {
    return { text: 'Diese Zahl steht nicht auf deiner Karte. Das ist ganz normal, nicht jede Zahl passt. Tippe auf Nächste Zahl.', target: DRAW };
  }
  return { text: 'Tippe auf Nächste Zahl.', target: DRAW };
}

export function coach(game, ctx) {
  try {
    const r = build(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
