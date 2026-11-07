// Schafskopp – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. In der Lernrunde sind Hinweise erlaubt (Ziel-Markierung).
import * as M from './engine.js';

const FLIP = '[data-act=flip]';
const PLACE = '[data-act=place]';
const END = '[data-act=end]';

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

const stealSel = (pid) => `[data-act=steal][data-pid="${pid}"]`;

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'sk' || !Array.isArray(g.players) || !g.turn || !Array.isArray(g.rows) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    const r = g.result || {};
    const head = r.winners && r.winners.includes(me.id) ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Wer keine Karten mehr hat, gewinnt. Die anderen werden nach ihren Restkarten gereiht. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`, target: '[data-act=again]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.moves].join('|');
  const last = g.last && typeof g.last === 'object' ? g.last : null;

  if (last && last.penalty && once(ctx, 'penalty', sig)) {
    return { text: last.penalty.pid === me.id
      ? 'Schafskopp! Du hast eine passende Karte übersehen und bekommst zwei Strafkarten unten auf deinen Stapel.'
      : 'Schafskopp! Der Computer hat eine passende Karte übersehen und bekommt zwei Strafkarten.' };
  }

  if (ap.id !== me.id) {
    if (last && last.pid === me.id && last.kind === 'flip' && !last.fits && once(ctx, 'turnEnd', sig)) {
      return { text: 'Die aufgedeckte Karte passt nicht. Sie bleibt offen liegen und dein Zug ist zu Ende. Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  const own = M.topOf(me);
  const others = M.fittingSources(g).filter((id) => id !== me.id);

  if (own && M.fits(g, own)) {
    const row = g.rows[own.s];
    if (own.r === M.START && once(ctx, 'eleven', sig)) {
      return { text: 'Deine offene Karte ist eine Elf. Eine Elf darf immer in die Mitte gelegt werden und eröffnet die Reihe ihrer Farbe. Tippe auf deine offene Karte.', target: PLACE };
    }
    if (row && own.r === row.hi + 1 && once(ctx, 'up', sig)) {
      return { text: 'Die Karte passt: Sie hat dieselbe Farbe und ist um eins höher als das obere Ende der Reihe. Tippe auf deine offene Karte, um sie anzulegen.', target: PLACE };
    }
    if (row && own.r === row.lo - 1 && once(ctx, 'down', sig)) {
      return { text: 'Die Karte passt: Sie hat dieselbe Farbe und ist um eins tiefer als das untere Ende der Reihe. Tippe auf deine offene Karte, um sie anzulegen.', target: PLACE };
    }
    return { text: 'Deine offene Karte passt. Tippe darauf, um sie anzulegen.', target: PLACE };
  }

  if (others.length) {
    if (once(ctx, 'steal', sig)) {
      return { text: 'Die offene Karte vom Computer passt auf den Tisch. Du darfst sie in die Mitte legen. Wer den Zug beendet, obwohl noch etwas passt, bekommt zwei Strafkarten. Tippe auf die Karte.', target: stealSel(others[0]) };
    }
    return { text: 'Noch eine offene Karte passt. Tippe auf sie, um sie in die Mitte zu legen.', target: stealSel(others[0]) };
  }

  if (me.deck.length) {
    if (!last || last.pid !== me.id) {
      if (once(ctx, 'intro', sig)) return { text: 'Vor dir liegt dein verdeckter Stapel. Tippe darauf, um die oberste Karte aufzudecken. Passt sie auf den Tisch, legst du sie an. Wenn nicht, ist dein Zug zu Ende.', target: FLIP };
    }
    if (last && last.kind === 'place' && last.pid === me.id && once(ctx, 'again', sig)) {
      return { text: 'Nach dem Anlegen darfst du weitermachen. Decke die nächste Karte von deinem Stapel auf.', target: FLIP };
    }
    if (own && once(ctx, 'openCard', sig)) {
      return { text: 'Neben deinem Stapel liegt deine offene Karte. Sie passt gerade nicht. Darum deckst du die nächste Karte auf. Tippe auf deinen Stapel.', target: FLIP };
    }
    return { text: 'Tippe auf deinen Stapel, um aufzudecken.', target: FLIP };
  }
  return { text: 'Du kannst nichts mehr anlegen. Tippe auf Zug beenden.', target: END };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
