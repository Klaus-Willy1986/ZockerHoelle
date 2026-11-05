// Stapelrennen – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as P from './engine.js';

// Eine Erklärung bleibt sichtbar, solange sich der Zustand (sig) nicht ändert, und kommt danach nie wieder.
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

// Die gewählte Karte (falls es sie gibt und sie wirklich da ist)
function selected(p, sel) {
  if (!sel || typeof sel !== 'object') return null;
  if (sel.from === 'hand' && Number.isInteger(sel.i) && sel.i >= 0 && sel.i < p.hand.length) return { ...sel, card: p.hand[sel.i] };
  if (sel.from === 'pile' && p.pile.length) return { from: 'pile', i: 0, card: P.topOf(p.pile) };
  if (sel.from === 'aux' && Number.isInteger(sel.i) && sel.i >= 0 && sel.i < P.AUX_COUNT && p.aux[sel.i].length) return { from: 'aux', i: sel.i, card: P.topOf(p.aux[sel.i]) };
  return null;
}

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !Array.isArray(g.build)) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (g.mode === 'roundover') return { text: 'Die Runde ist zu Ende. Tippe auf Nächste Runde.', target: '[data-act=next-round]' };
  const ap = g.players[g.active];
  if (!ap || !ctx) return null;
  if (ap.id !== ctx.id) return { text: 'Der Computer ist dran. Bitte einen Moment Geduld. Gleich bist du wieder dran.' };
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const sig = g.seq;

  // Eine Karte ist angetippt
  const sel = selected(ap, ui.sel);
  if (sel) {
    const targets = P.targetsFor(g, sel.card);
    if (sel.from === 'hand' && !targets.length) {
      const pre = once(ctx, 'discard', sig) ? 'Abwerfen heißt: Du legst eine Handkarte auf einen Hilfsstapel. Dann ist dein Zug zu Ende. ' : '';
      return { text: `${pre}Diese Karte passt nirgends. Tippe auf einen Hilfsstapel, um sie abzuwerfen.`, target: '[data-act=to-aux]' };
    }
    if (!targets.length) return { text: 'Diese Karte passt gerade nirgends. Tippe sie noch einmal an.', target: '[data-act=src].sr-sel' };
    const pre = sel.card === P.JOKER && once(ctx, 'jokerSel', sig) ? 'Der Joker zählt als die Zahl, die der Stapel braucht. ' : '';
    return { text: `${pre}Tippe jetzt auf einen leuchtenden Aufbaustapel in der Mitte.`, target: '[data-act=to-build]' };
  }

  const srcs = P.sourcesOf(g, g.active);
  if (srcs.length) {
    let pre = '';
    const last = g.last;
    if (once(ctx, 'intro', sig)) pre = 'Wer zuerst den Spielerstapel mit dem goldenen Rand leert, gewinnt. ';
    else if (srcs.some((s) => P.canPlayOn(s.card, [])) && once(ctx, 'start1', sig)) pre = 'Ein Aufbaustapel beginnt mit der 1. Dann kommen 2, 3 und so weiter bis 12. ';
    else if (srcs.some((s) => s.card === P.JOKER) && once(ctx, 'joker', sig)) pre = 'Der Joker zählt als jede Zahl, die gerade gebraucht wird. ';
    else if (last && last.kind === 'play' && last.card === P.JOKER && last.pid === ap.id && once(ctx, 'jokerDone', sig)) pre = `Dein Joker zählt hier als ${last.value}. `;
    else if (last && last.refill && last.pid === ap.id && once(ctx, 'refill', sig)) pre = 'Alle Handkarten gespielt: Es wurden gleich fünf neue gezogen. ';
    return { text: `${pre}Tippe auf eine leuchtende Karte, um sie zu legen.`, target: '[data-act=src].sr-ok' };
  }

  const last = g.last;
  let pre = '';
  if (once(ctx, 'discard', sig)) pre = 'Abwerfen heißt: Du legst eine Handkarte auf einen Hilfsstapel. Dann ist dein Zug zu Ende. ';
  else if (last && last.kind === 'play' && last.card === P.JOKER && last.pid === ap.id && once(ctx, 'jokerDone', sig)) pre = `Dein Joker zählt hier als ${last.value}. `;
  return { text: `${pre}Nichts passt mehr. Tippe auf eine Handkarte zum Abwerfen.`, target: '[data-act=src][data-from=hand]' };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
