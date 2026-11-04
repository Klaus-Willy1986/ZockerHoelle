// Phasenwürfeln – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as P from './engine.js';

const WORT = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];
const wort = (n) => WORT[n] || String(n);

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

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  if (ui.rolling) return { text: 'Die Würfel rollen.' };
  const ap = g.players[g.active];
  const t = g.turn;
  if (!ap || !t || !ctx) return null;
  if (ap.id !== ctx.id) return { text: 'Bitte einen Moment Geduld. Gleich bist du wieder dran.' };

  const sig = `${g.rollId}|${t.stage}`;
  const maxTries = wort(P.MAX_ATTEMPTS);

  if (t.stage === 'roll') {
    if (once(ctx, 'start', sig)) {
      return { text: 'Tippe auf Würfeln. Oben steht, welche Phase du schaffen musst. Zum Beispiel bestimmte gleiche Zahlen oder Zahlen der Reihe nach.', target: '[data-act=roll]' };
    }
    if (t.final) return { text: 'Letzte Runde. Tippe auf Würfeln.', target: '[data-act=roll]' };
    return { text: 'Tippe auf Würfeln.', target: '[data-act=roll]' };
  }

  if (t.stage !== 'choose' || !Array.isArray(t.dice) || !t.eval) return null;
  const ev = t.eval;
  const canRoll = t.attempt < P.MAX_ATTEMPTS;
  const hasJoker = t.dice.some((d) => d && d.v === 'W');
  const pre = hasJoker && once(ctx, 'joker', sig)
    ? 'Das W ist ein Joker. Es ersetzt jede Zahl, zählt aber null Punkte. ' : '';

  if (ev.ok) {
    if (ui.confirmSkip) {
      return { text: 'Die Phase ist geschafft. Tippe auf Zurück, um die Punkte doch einzutragen.', target: '[data-act=finish-skip-no]' };
    }
    const main = once(ctx, 'ok', sig)
      ? 'Geschafft! Die Phase ist erfüllt. Tippe auf Punkte eintragen.'
      : 'Geschafft! Tippe auf Punkte eintragen.';
    return { text: pre + main, target: '[data-act=finish-yes]' };
  }

  if (!canRoll) {
    const end = t.final
      ? 'Damit ist dein Spiel zu Ende.'
      : g.solo ? 'Dafür gibt es Punkte Abzug. Danach versuchst du sie noch einmal.' : 'Danach versuchst du sie noch einmal.';
    return { text: `${pre}Leider nicht geschafft. ${end} Tippe auf OK, weiter.`, target: '[data-act=finish-yes]' };
  }

  const keep = Array.isArray(ui.keep) ? ui.keep : [];
  const rest = t.dice.length - keep.filter(Boolean).length;
  if (rest === 0) {
    return { text: 'Mindestens ein Würfel muss neu gewürfelt werden. Tippe auf einen Würfel, um ihn wieder abzuwählen.', target: '[data-act=toggle]' };
  }
  const base = 'Tippe auf die Würfel, die du behalten willst, und dann auf neu würfeln.';
  const intro = !pre && once(ctx, 'tries', sig)
    ? `Du hast ${maxTries} Versuche für jede Phase. Bei jedem Versuch behältst du Würfel und würfelst die anderen neu. ` : '';
  return { text: `${pre}${intro}${base}`, target: '[data-act=reroll]:not([disabled])' };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
