// Wenig ist mehr – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie.
// Es werden nur Bedienung und Regeln erklärt, niemals ein Zug empfohlen.
import * as M from './engine.js';

const MINE = '.wm-mine';
const CELL = `${MINE} [data-act=cell]`;
const HIDDEN = `${MINE} .wm-cell.down`;
const SRC = '[data-act=take], [data-act=draw]';

// Eine Erklärung bleibt sichtbar, solange sich die Lage (sig) nicht ändert, und kommt danach nie wieder.
function once(ctx, key, sig) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (!(key in ui.coachSeen)) ui.coachSeen[key] = sig;
    return ui.coachSeen[key] === sig;
  } catch { return false; }
}

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'wm' || !Array.isArray(g.players) || !g.turn || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const sigBase = [g.gid, g.round, g.discard.length, g.deck.length, g.active, g.turn.stage].join('|');

  if (g.phase === 'over') {
    return { text: 'Das Spiel ist zu Ende, weil jemand hundert Punkte erreicht hat. Wer die wenigsten Punkte hat, gewinnt. Tippe auf Neues Spiel, wenn du noch einmal üben möchtest.', target: '[data-act=again]' };
  }
  if (g.phase === 'round') {
    if (once(ctx, 'roundEnd', sigBase)) {
      return { text: 'Die Runde ist zu Ende. Alle Karten sind aufgedeckt. Wer die Runde beendet hat, aber nicht die wenigsten Punkte hat, bekommt seine Punkte doppelt. Das Spiel endet bei hundert Punkten. Tippe auf Nächste Runde.', target: '[data-act=next]' };
    }
    return { text: 'Die Runde ist zu Ende. Weniger Punkte sind besser. Tippe auf Nächste Runde.', target: '[data-act=next]' };
  }

  const ups = M.upCount(me);
  const rs = `${g.gid}|${g.round}`;
  if (g.phase === 'reveal') {
    if (ups === 0) {
      if (once(ctx, 'reveal0', rs)) return { text: 'Zu Beginn deckt jede Person zwei Karten auf. Tippe auf zwei deiner verdeckten Karten, um sie umzudrehen. Jede Karte zählt so viele Punkte, wie draufsteht.', target: HIDDEN };
      return { text: 'Tippe auf zwei deiner verdeckten Karten, um sie aufzudecken.', target: HIDDEN };
    }
    if (ups === 1) {
      if (once(ctx, 'goal', rs)) return { text: 'Das Ziel: Am Ende möchtest du möglichst wenige Punkte haben. Tippe jetzt noch auf eine zweite verdeckte Karte.', target: HIDDEN };
      return { text: 'Tippe noch auf eine zweite verdeckte Karte.', target: HIDDEN };
    }
    return { text: 'Warte kurz, bis der Computer zwei Karten aufgedeckt hat.' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;

  if (g.endBy !== null && g.endBy !== undefined && ap.id !== me.id && once(ctx, 'ending', rs)) {
    const who = g.players[g.endBy];
    return { text: `${who && who.id === me.id ? 'Du hast' : 'Der Computer hat'} alle Karten aufgedeckt. Jede andere Person bekommt jetzt noch genau einen Zug. Danach wird alles aufgedeckt und gezählt.` };
  }
  if (ap.id !== me.id) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };

  if (g.endBy !== null && g.endBy !== undefined && once(ctx, 'lastTurn', rs)) {
    return { text: 'Der Computer hat alle Karten aufgedeckt. Das ist dein letzter Zug in dieser Runde. Danach wird gezählt.', target: g.turn.stage === 'flip' ? HIDDEN : g.turn.stage === 'drawn' ? `${CELL}, [data-act=put]` : ui.take ? CELL : SRC };
  }

  const stage = g.turn.stage;
  if (stage === 'flip') {
    if (once(ctx, 'flip', sigBase)) return { text: 'Du hast die Karte auf die Ablage gelegt. Jetzt deckst du eine deiner verdeckten Karten auf. Tippe auf eine verdeckte Karte.', target: HIDDEN };
    return { text: 'Tippe auf eine verdeckte Karte, um sie aufzudecken.', target: HIDDEN };
  }
  if (stage === 'drawn') {
    if (once(ctx, 'drawn', sigBase)) {
      return { text: 'Du hast eine Karte gezogen. Du kannst sie gegen eine eigene Karte tauschen, offen oder verdeckt. Oder du legst sie auf die Ablage und deckst danach eine verdeckte Karte auf.', target: `${CELL}, [data-act=put]` };
    }
    return { text: 'Tippe auf eine eigene Karte zum Tauschen oder auf Auf die Ablage legen.', target: `${CELL}, [data-act=put]` };
  }

  // Zugbeginn
  if (ui.take) {
    if (once(ctx, 'take', sigBase)) {
      return { text: 'Du hast die offene Karte genommen. Tippe jetzt auf eine deiner Karten. Sie wird gegen die genommene Karte getauscht und kommt offen auf die Ablage.', target: CELL };
    }
    return { text: 'Tippe auf eine deiner Karten, um sie zu tauschen.', target: CELL };
  }
  if (once(ctx, 'start', sigBase)) {
    return { text: 'Jetzt bist du dran. Du hast zwei Möglichkeiten. Tippe auf die offene Karte der Ablage, um sie zu nehmen. Oder tippe auf den Stapel, um die oberste Karte zu ziehen.', target: SRC };
  }
  const pair = me.grid.some((c, i) => c && c.up && i < 4 && [i, i + 4, i + 8].filter((j) => me.grid[j] && me.grid[j].up && me.grid[j].v === c.v).length >= 2);
  if ((pair || ups >= 3) && once(ctx, 'column', sigBase)) {
    return { text: 'Wenn drei gleiche offene Karten in einer Spalte liegen, werden sie sofort aus dem Spiel genommen. Diese Spalte zählt dann null Punkte.', target: SRC };
  }
  return { text: 'Du bist dran. Nimm die offene Karte oder ziehe vom Stapel.', target: SRC };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
