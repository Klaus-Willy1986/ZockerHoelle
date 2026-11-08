// Patience – Anleitung für die Lernrunde (reine Funktion des Spielzustands, wirft nie).
// Die Lernrunde nutzt eine feste kleine Verteilung (engine.learnGame). Es werden nur die Bedienung und die Regeln erklärt;
// markiert wird nur die Stelle, die gerade erklärt wird – nie, welcher Zug klug wäre.
import * as E from './engine.js';

const HJ = E.mkCard(2, 11); // Herz Bube
const S9 = E.mkCard(1, 9); // Pik 9

function seenOf(ctx) {
  const ui = ctx && ctx.ui;
  if (!ui || typeof ui !== 'object') return null;
  if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
  return ui.coachSeen;
}
const same = (a, b) => !!a && !!b && a.k === b.k && a.i === b.i && a.j === b.j;

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.tab) || !Array.isArray(g.found) || !Array.isArray(g.stock)) return null;
  if (g.mode === 'over') return { text: 'Geschafft! Alle Karten liegen oben auf den Zielstapeln. Die Lernrunde ist zu Ende.', target: '[data-act=leave-now]' };
  const seen = seenOf(ctx);
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const sel = ui.sel && typeof ui.sel === 'object' ? ui.sel : null;
  const n = g.moves;
  if (seen && seen.undoAt != null && !seen.undoDone) {
    if (n < seen.undoAt) { seen.undoDone = true; seen.undoneN = n; }
    else if (n > seen.undoAt) seen.undoDone = true;
  }

  // 1. Absteigend, abwechselnde Farben, Aufdecken
  if (g.tab[0] && g.tab[0].includes(HJ)) {
    if (same(sel, { k: 't', i: 0, j: 1 })) {
      return { text: 'Die Karte ist markiert. Auf die schwarze Dame darf sie: eine Zahl kleiner und die andere Farbe, also rot auf schwarz. Tippe auf die Dame.', target: '[data-k=t][data-i="1"][data-j="0"]' };
    }
    if (sel) return { text: 'Tippe die markierte Karte noch einmal an, dann ist sie wieder frei. Danach tippe auf den roten Buben.', target: '[data-k=t][data-i="0"][data-j="1"]' };
    return { text: 'Das sind die sieben Spalten. Nur die oberste Karte jeder Spalte liegt offen. Tippe auf den roten Buben, um ihn zu markieren.', target: '[data-k=t][data-i="0"][data-j="1"]' };
  }
  const afterHJ = n <= 1 && g.tab[1] && g.tab[1].includes(HJ);
  const spadeDone = g.found[1] >= 9;

  // 2. Stapel ziehen
  if (!spadeDone && g.stock.includes(S9)) {
    const pre = afterHJ ? 'Gut! Unter dem Buben ist eine neue Karte aufgedeckt worden – so geht das Spiel voran. ' : '';
    return { text: `${pre}Links oben liegt der Stapel mit verdeckten Karten. Tippe darauf, um eine Karte zu ziehen.`, target: '[data-k=s]' };
  }

  // 3. Zielstapel
  if (!spadeDone && g.waste.length && g.waste[g.waste.length - 1] === S9) {
    const undone = seen && seen.undoDone && seen.undoneN === n;
    if (sel && sel.k === 'w') return { text: 'Rechts oben sind die Zielstapel. Dort sammelst du jede Farbe vom Ass bis zum König. Tippe auf den Stapel mit dem Pik-Zeichen.', target: '[data-k=f][data-i="1"]' };
    return { text: `${undone ? 'Zurückgenommen. ' : ''}Die gezogene Karte liegt jetzt auf der Ablage. Es ist die Pik 9, und die passt auf den Pik-Zielstapel. Tippe zuerst die Karte an.`, target: '[data-k=w]' };
  }
  if (!spadeDone) {
    return { text: 'Tippe auf den Stapel, um die nächste Karte zu ziehen, oder tippe eine offene Karte an.', target: '[data-k=s]' };
  }

  // 4. Zurück kennenlernen (einmalig)
  if (seen && !seen.undoDone) {
    if (seen.undoAt == null) seen.undoAt = n;
    return { text: 'Die Karte liegt auf dem Zielstapel. Falsch gelegt? Mit Zurück nimmst du jeden Zug zurück, so oft du möchtest. Probiere es aus und tippe auf Zurück.', target: '[data-act=undo]' };
  }
  if (!seen) return { text: 'Mit Zurück nimmst du jeden Zug zurück.', target: '[data-act=undo]' };

  // 5. Freies Spiel
  if (!seen.freeShown) {
    seen.freeShown = true;
    seen.freeAt = n;
  }
  if (sel) return { text: 'Die Karte ist markiert. Tippe auf die Spalte oder den Zielstapel, wohin sie soll. Nochmal auf die Karte tippen hebt die Markierung auf.', target: null };
  if (seen.freeAt === n) {
    return { text: 'Prima, jetzt kennst du das Wichtigste. Ziel: Alle vier Zielstapel bis zum König füllen. Spiele jetzt allein weiter. Mit Doppeltippen legt sich eine Karte selbst oben ab, wenn sie passt.', target: null };
  }
  return { text: 'Tippe eine offene Karte an, dann ihr Ziel. Den Stapel links oben tippst du an, um zu ziehen.', target: null };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
