// Farbcode knacken – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as F from './engine.js';

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
const COLORS = '[data-act=color]';
const SUBMIT = '[data-act=submit]:not([disabled])';
const SETCODE = '[data-act=setcode]:not([disabled])';

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !Array.isArray(g.guesses)) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (!ctx || typeof ctx !== 'object') return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const cur = Array.isArray(ui.cur) ? ui.cur.slice(0, F.CODE_LEN) : [];
  const filled = cur.filter((v) => Number.isInteger(v)).length;
  const full = filled === F.CODE_LEN;
  const sel = Number.isInteger(ui.sel) && ui.sel >= 0 && ui.sel < F.CODE_LEN ? ui.sel : null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.mode === 'between') return { text: 'Die Runde ist zu Ende. Tippe auf Weiter, dann tauscht ihr die Rollen.', target: '[data-act=next]' };

  if (g.mode === 'code') {
    const setter = g.players[g.setter];
    if (!setter || setter.id !== me.id) return { text: 'Bitte einen Moment Geduld. Die andere Person denkt sich einen Code aus.' };
    if (sel !== null) return { text: 'Tippe auf die neue Farbe für dieses Feld.', target: COLORS };
    if (full) return { text: 'Alle vier Felder sind gefüllt. Tippe auf Code festlegen.', target: SETCODE };
    return { text: 'Denke dir einen geheimen Code aus. Tippe unten auf vier Farben.', target: COLORS };
  }

  const guesser = g.players[g.guesser];
  if (!guesser || guesser.id !== me.id) return { text: 'Bitte einen Moment Geduld. Gleich bist du wieder dran.' };

  const n = g.guesses.length;
  const last = n ? g.guesses[n - 1] : null;
  if (sel !== null) return { text: 'Tippe auf die neue Farbe für dieses Feld.', target: COLORS };

  if (n === 0) {
    if (full) return { text: 'Alle vier Felder sind voll. Tippe auf Versuch abgeben. Dann wertet das Spiel aus.', target: SUBMIT };
    if (filled === 0) return { text: 'Dein Ziel: den geheimen Code knacken. Tippe unten auf eine Farbe. Farben dürfen sich wiederholen.', target: COLORS };
    return { text: 'Tippe weiter, bis vier Felder voll sind. Einen Stift ersetzt du: erst antippen, dann neue Farbe wählen.', target: COLORS };
  }

  const target = full ? SUBMIT : COLORS;
  if (once(ctx, 'eval', n)) {
    return {
      text: 'Schwarz: richtige Farbe am richtigen Platz. Weiß: Farbe stimmt, Platz nicht.' + (full ? ' Dann Versuch abgeben.' : ''),
      target,
    };
  }
  const dup = last && Array.isArray(last.g) && new Set(last.g).size < last.g.length;
  if (dup && once(ctx, 'dup', n)) {
    return { text: 'Jeder Stift im Code zählt nur einmal, auch bei mehrfach gesetzter Farbe.' + (full ? ' Dann Versuch abgeben.' : ''), target };
  }
  if (n === F.MAX_TRIES - 1 && once(ctx, 'lastTry', n)) {
    return { text: 'Das ist dein letzter Versuch. Danach wird der Code aufgedeckt.' + (full ? ' Dann abgeben.' : ''), target };
  }
  if (full) return { text: 'Tippe auf Versuch abgeben.', target: SUBMIT };
  if (filled === 0 && last) {
    const t = F.feedbackText(Number(last.b) || 0, Number(last.w) || 0);
    return { text: `Dein letzter Versuch: ${t}. Setze nun deinen nächsten Versuch.`, target: COLORS };
  }
  return { text: 'Tippe weiter auf Farben, bis vier Felder gefüllt sind.', target: COLORS };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
