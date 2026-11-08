// Bilderrätsel – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie.
// Die Lernrunde ist ein festes kleines Herz (5×5). Das Ziel markiert nur Bedienschritte, in normalen Spielen gibt es keine Hinweise.
import * as E from './engine.js';

const END = 'Geschafft! Du hast das Herz ausgemalt. Jetzt kannst du ein richtiges Rätsel spielen.';

const cellSel = (i) => `[data-cell="${i}"]`;
const CROSS_CELL = 0; // oben links: sicher leer (die linke Spalte hat nur eine 2, und die steckt in den beiden vollen Zeilen)

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.cells) || typeof g.sol !== 'string' || !ctx) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (g.mode !== 'play') return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  if (ui.newPanel) return { text: 'Du kannst hier ein neues Rätsel wählen. Mit Zurück geht es mit dem Übungsbild weiter.', target: '[data-act=new-cancel]' };

  if (g.level !== 'lern') {
    return { text: 'Tippe ein Feld an, um es auszumalen. Die Zahlen am Rand verraten dir, wie viele Felder in einer Reihe dran sind.' };
  }

  const n = g.n;
  const mode = ui.mode === 'cross' ? 'cross' : 'fill';
  if (E.wrongCells(g).length) {
    return { text: 'Dieses Feld passt nicht. Tippe auf Zurück, dann versuchst du es noch einmal.', target: '[data-act=undo]' };
  }
  const missing = [];
  for (let i = 0; i < g.sol.length; i++) if (g.sol[i] === '1' && g.cells[i] !== 1) missing.push(i);
  if (!missing.length) return null;
  const rowMissing = (r) => missing.filter((i) => Math.floor(i / n) === r);

  // Feld ausmalen: erst in den Ausmal-Modus wechseln, falls nötig
  const fillThen = (i, text) => {
    if (mode === 'cross') return { text: 'Wähle jetzt wieder Ausmalen. Dann kannst du Felder ausmalen.', target: '[data-act=mode-fill]' };
    return { text, target: cellSel(i) };
  };

  // 1. Zeile mit der 5
  const r1 = rowMissing(1);
  if (r1.length) {
    if (r1.length === 5) {
      return fillThen(r1[0], 'Willkommen! Die Zahlen am Rand sagen dir, wie viele Felder in einer Reihe ausgemalt werden. Die 5 heißt: alle 5 Felder dieser Zeile. Tippe auf das leuchtende Feld.');
    }
    if (r1.length === 4) return fillThen(r1[0], 'Gut so! Du kannst auch den Finger über mehrere Felder ziehen, dann werden alle ausgemalt. Tippen geht genauso. Male die Zeile fertig.');
    return fillThen(r1[0], 'Tippe auf das leuchtende Feld.');
  }
  // 2. Zeile mit der 5
  const r2 = rowMissing(2);
  if (r2.length) {
    if (r2.length === 5) return fillThen(r2[0], 'Prima! Auch die nächste Zeile hat eine 5. Male sie genauso aus.');
    return fillThen(r2[0], 'Tippe auf das leuchtende Feld.');
  }
  // Kreuz für ein sicher leeres Feld
  if (g.cells[CROSS_CELL] !== 2 && !(ui.coachSeen && ui.coachSeen.crossed)) {
    if (mode === 'fill') {
      return { text: 'Manche Felder sind sicher leer. Die markierst du mit einem Kreuz. Tippe auf Leer markieren.', target: '[data-act=mode-cross]' };
    }
    return { text: 'Ganz links steht nur die 2, und die ist schon ausgemalt. Dieses Feld bleibt also leer. Tippe darauf.', target: cellSel(CROSS_CELL) };
  }
  if (ui.coachSeen) ui.coachSeen.crossed = true;
  if (mode === 'cross') return { text: 'Das Kreuz sitzt. Jetzt malst du wieder aus. Tippe auf Ausmalen.', target: '[data-act=mode-fill]' };

  // Prüfen, kurz vor dem Ende
  if (missing.length === 1 && g.checks === 0) {
    return { text: 'Fast fertig! Mit Prüfen zeigt dir das Spiel, bei welchen Reihen schon alles stimmt. Dort erscheint ein Häkchen. Tippe auf Prüfen.', target: '[data-act=check]' };
  }

  if (missing.length === 1) return { text: 'Noch ein Feld! Tippe auf das leuchtende Feld.', target: cellSel(missing[0]) };
  if (missing.length === g.total - 10) return { text: 'Jetzt fehlen noch ein paar Felder. Schau auf die Zahlen: Die 4 oben heißt vier Felder untereinander. Tippe auf das leuchtende Feld.', target: cellSel(missing[0]) };
  return { text: 'Tippe auf das leuchtende Feld.', target: cellSel(missing[0]) };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
