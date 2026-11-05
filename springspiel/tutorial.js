// Springspiel – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps: Es wird nur gezeigt,
// was bedient werden kann und welche Sprünge erlaubt sind (nie, welcher Sprung klug wäre).
import * as E from './engine.js';

const FIRST_STONE = 38; // der erste Zug steht fest: Der Stein unten springt in die Mitte (es gibt beim Start nur 4 Möglichkeiten)

function seenOf(ctx) {
  const ui = ctx && ctx.ui;
  if (!ui || typeof ui !== 'object') return null;
  if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
  return ui.coachSeen;
}

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.board) || !Array.isArray(g.moves)) return null;
    if (g.mode === 'over') {
    return { text: 'Kein Zug mehr möglich. Geschafft, die Lernrunde ist zu Ende!', target: '[data-act=again]' };
  }
  const seen = seenOf(ctx);
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const n = g.moves.length;
  const sel = Number.isInteger(ui.sel) && E.movesFrom(g, ui.sel).length ? ui.sel : null;

  // Erster Zug (steht fest)
  if (n === 0) {
    if (sel === null) {
      return {
        text: 'Tippe auf den leuchtenden Stein. Er springt über seinen Nachbarn.',
        target: `.sp-hit[data-i="${FIRST_STONE}"]`,
      };
    }
    return { text: 'Grün zeigt, wohin er springen darf. Tippe auf das leuchtende Loch.', target: '.sp-hit[data-hint=target]' };
  }

  if (sel !== null) {
    return { text: 'Tippe auf ein leuchtendes Loch. Nochmal auf den Stein tippen wählt ab.', target: '.sp-hit[data-hint=target]' };
  }

  // Rückgängig kennenlernen (einmalig bei Zug 3)
  if (seen) {
    if (!seen.undoDone) {
      if (seen.undoAt == null && n === 3) seen.undoAt = 3;
      if (seen.undoAt != null) {
        if (n < seen.undoAt) { seen.undoDone = true; seen.undoneN = n; }
        else if (n > seen.undoAt) seen.undoDone = true;
        else return { text: 'Falsch gesprungen? Tippe auf Rückgängig. Das geht so oft du willst.', target: '[data-act=undo]' };
      }
    }
    if (seen.undoDone && seen.undoneN === n) {
      return { text: 'Zug zurückgenommen. Tippe auf einen leuchtenden Stein und spiele weiter.', target: '.sp-hit[data-hint=can]' };
    }
  }

  let pre = '';
  if (n === 1) pre = 'Der übersprungene Stein ist weg. ';
  else if (n === 5) pre = 'Ziel: am Ende wenige Steine übrig. ';
  return { text: `${pre}Tippe auf einen leuchtenden Stein.${pre ? '' : ' Nur diese können springen.'}`, target: '.sp-hit[data-hint=can]' };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
