// Sudoku – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie.
// In der Lernrunde (Übungsrätsel, Stufe „lern“) darf der Coach das nächste Feld und die passende Zahl nennen,
// weil es ein Lernrätsel mit eindeutigem nächsten Schritt ist. In normalen Spielen gibt er nur Bedienhilfen.
import * as E from './engine.js';

const END = 'Geschafft! Du hast das Übungsrätsel gelöst. Jetzt kannst du ein richtiges Rätsel spielen.';

function once(ctx, key) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (ui.coachSeen[key]) return false;
    ui.coachSeen[key] = true;
    return true;
  } catch { return false; }
}

const cellSel = (i) => `[data-act=cell][data-i="${i}"]`;
const keySel = (d) => `[data-act=key][data-d="${d}"]`;

// Warum ist diese Zahl hier die richtige? (Zeile, Spalte oder Block hat nur noch diese eine Lücke)
function reason(g, i, d) {
  const gaps = (unit) => unit.filter((j) => !g.cells[j]).length;
  if (gaps(E.UNITS[E.ROW[i]]) === 1) return `In jeder Zeile steht jede Zahl nur einmal. In dieser Zeile fehlt nur die ${d}. Tippe auf die leuchtende Zahl.`;
  if (gaps(E.UNITS[9 + E.COL[i]]) === 1) return `Auch in jeder Spalte steht jede Zahl nur einmal. In dieser Spalte fehlt nur die ${d}. Tippe auf die leuchtende Zahl.`;
  if (gaps(E.UNITS[18 + E.BOX[i]]) === 1) return `Auch in jedem Block aus 3 mal 3 Feldern steht jede Zahl nur einmal. Hier fehlt nur die ${d}. Tippe auf die leuchtende Zahl.`;
  return `Hier gehört die ${d} hin. Alle anderen Zahlen stehen in der Zeile, Spalte oder im Block schon. Tippe auf die leuchtende Zahl.`;
}

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.cells) || !ctx) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (g.mode !== 'play') return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  if (ui.newPanel) return { text: 'Du kannst hier ein neues Rätsel wählen. Mit Zurück geht es mit dem Übungsrätsel weiter.', target: '[data-act=new-cancel]' };

  if (g.level !== 'lern') {
    return { text: 'Tippe ein leeres Feld an und dann unten die Zahl, die du eintragen willst.' };
  }

  if (E.wrongCells(g).length) {
    return { text: 'Diese Zahl passt nicht. Tippe auf Rückgängig, dann versuchst du es noch einmal.', target: '[data-act=undo]' };
  }
  if (ui.notes) {
    return { text: 'Die Notizen sind eingeschaltet. Tippe auf Notizen, um sie auszuschalten.', target: '[data-act=notes]' };
  }

  const open = E.LEARN_ORDER.filter((i) => g.cells[i] === 0);
  if (!open.length) return null;
  const sel = Number.isInteger(ui.sel) ? ui.sel : -1;

  if (sel >= 0 && sel < 81 && g.cells[sel] === 0 && !E.isGiven(g, sel)) {
    const d = Number(g.solution[sel]);
    return { text: reason(g, sel, d), target: keySel(d) };
  }

  const next = open[0];
  let pre = '';
  if (once(ctx, 'start')) pre = 'Ziel: In jeder Zeile, jeder Spalte und jedem Block aus 3 mal 3 Feldern steht jede Zahl von 1 bis 9 genau einmal. ';
  else if (sel >= 0 && sel < 81 && g.cells[sel]) pre = E.isGiven(g, sel) ? 'Dieses Feld ist schon gefüllt. ' : 'Richtig! ';
  return { text: `${pre}Tippe auf das leuchtende leere Feld.`, target: cellSel(next) };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
