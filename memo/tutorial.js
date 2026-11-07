// Paare finden – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie.
// Keine Zugempfehlung: Das Ziel ist nie eine bestimmte Karte, sondern das ganze Spielfeld ("#board") oder ein Knopf.
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

const END = 'Geschafft! Die Lernrunde ist zu Ende. Du kannst jetzt eine richtige Runde spielen.';
const BOARD = '#board';
const WEITER = '[data-act=weiter]';

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !Array.isArray(g.st)) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (!ctx || typeof ctx !== 'object') return null;
  const me = g.players.findIndex((p) => p && p.id === ctx.id);
  if (me < 0) return null;
  const evt = g.evt && typeof g.evt === 'object' ? g.evt : null;
  const open = Array.isArray(g.open) ? g.open.length : 0;

  if (g.turn !== me) {
    const cur = g.players[g.turn];
    const who = cur && E.isBotId(cur.id) ? 'der Computer' : (cur && cur.name) || 'die andere Person';
    if (g.pending) return { text: 'Kein Paar. Gleich werden die Karten wieder umgedreht.' };
    if (once(ctx, 'cpu', g.turnNo)) {
      return { text: `Jetzt ist ${who} dran. Du musst nichts tun. Schau zu: So lernst du die Bilder auf den Karten kennen.` };
    }
    return { text: `${who.charAt(0).toUpperCase() + who.slice(1)} ist dran. Bitte einen Moment Geduld.` };
  }

  if (g.pending) {
    if (once(ctx, 'miss', g.seq)) {
      return { text: 'Zwei verschiedene Bilder, das ist kein Paar. Die Karten bleiben offen, damit du sie dir merken kannst. Tippe dann auf Weiter.', target: WEITER };
    }
    return { text: 'Tippe auf Weiter. Dann werden die Karten umgedreht.', target: WEITER };
  }

  if (open === 1) {
    if (once(ctx, 'second', g.seq)) {
      return { text: 'Tippe jetzt auf eine zweite verdeckte Karte. Zeigen beide dasselbe Bild, ist das ein Paar.', target: BOARD };
    }
    return { text: 'Tippe auf eine zweite verdeckte Karte.', target: BOARD };
  }

  // Du bist dran, noch nichts aufgedeckt
  if (evt && evt.kind === 'match' && evt.by === me && evt.seq === g.seq && once(ctx, 'match', g.seq)) {
    return { text: 'Ein Paar! Du behältst es und bekommst einen Punkt. Die Punkte stehen unter dem Spielfeld. Du darfst gleich noch einmal.', target: BOARD };
  }
  if (g.seq === 0 && once(ctx, 'start', 0)) {
    return { text: 'Willkommen! In jedem Zug deckst du zwei Karten auf. Tippe auf eine verdeckte Karte. Sie dreht sich um und zeigt ihr Bild.', target: BOARD };
  }
  if (g.turnNo >= 1 && once(ctx, 'memory', g.turnNo)) {
    return { text: 'Du bist wieder dran. Bilder, die schon einmal offen waren, musst du dir merken. Das ist das Besondere an diesem Spiel.', target: BOARD };
  }
  return { text: 'Tippe auf eine verdeckte Karte.', target: BOARD };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
