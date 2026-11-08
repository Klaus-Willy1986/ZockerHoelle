// Minenfeld – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie.
// Die Lernrunde nutzt ein festes 5x5-Übungsfeld, bei dem jeder Schritt eindeutig folgt; der Coach darf hier
// das nächste Feld markieren. Im normalen Spiel gibt es keine Hinweise.
import * as E from './engine.js';

const cellSel = (i) => `[data-act=cell][data-i="${i}"]`;
const MODE = (m) => `[data-act=mode][data-mode=${m}]`;
const MINE_SIDE = 14; // Mine, die durch die 1 oben rechts feststeht (Zeile 3, Spalte 5)
const NUMBER_CELL = 13; // die 1 daneben (Zeile 3, Spalte 4): öffnet mit passender Flagge das letzte sichere Feld

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.open) || !Array.isArray(g.flag) || !Array.isArray(g.mine)) return null;
  if (g.w !== 5 || g.h !== 5) return null;
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const flagMode = !!ui.flagMode;

  if (g.mode === 'won') return { text: 'Geschafft! Alle sicheren Felder sind offen. Jetzt kannst du ein richtiges Feld spielen.', target: '[data-act=again]' };
  if (g.mode === 'lost') return { text: 'Das war eine Mine. Nicht schlimm! Tippe auf Nochmal, dann geht es weiter.', target: '[data-act=retry]' };

  // Falsche Flagge (dort liegt keine Mine): zuerst wieder wegnehmen
  const wrong = g.flag.findIndex((f, i) => f && !g.mine[i]);
  if (wrong >= 0) {
    if (!flagMode) return { text: 'Hier liegt keine Mine. Schalte auf Flagge setzen, um die Flagge wegzunehmen.', target: MODE('flag') };
    return { text: 'Tippe die Flagge noch einmal an, dann ist sie weg.', target: cellSel(wrong) };
  }

  const opened = g.open.reduce((a, v) => a + (v ? 1 : 0), 0);
  if (opened === 0) {
    return { text: 'Tippe auf das leuchtende Feld. Ist ringsum keine Mine, öffnet sich gleich ein ganzes Stück.', target: cellSel(E.LEARN_FIRST) };
  }
  const flagged = !!g.flag[MINE_SIDE];
  if (!flagged) {
    if (!flagMode) {
      return { text: 'Die Zahl zählt Minen ringsum. Diese 1 hat nur ein verdecktes Nachbarfeld: Dort liegt die Mine. Tippe auf Flagge setzen.', target: MODE('flag') };
    }
    return { text: 'Tippe auf das leuchtende Feld, um die Flagge zu setzen. Langes Drücken geht auch.', target: cellSel(MINE_SIDE) };
  }
  if (flagMode) return { text: 'Die Flagge steht. Schalte wieder auf Aufdecken.', target: MODE('reveal') };
  return { text: 'Diese 1 hat ihre Flagge. Tippe sie an, dann öffnet Schnell aufdecken die übrigen Nachbarn.', target: cellSel(NUMBER_CELL) };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
