// Elf voran – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as M from './engine.js';

const CARD = '.ev-hand .can';
const PASS = '[data-act=pass]';

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
  if (!g || typeof g !== 'object' || g.game !== 'ev' || !Array.isArray(g.players) || !Array.isArray(g.rows) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me || !Array.isArray(me.hand)) return null;
  const limit = g.opts && Number.isInteger(g.opts.limit) ? g.opts.limit : M.DEFAULT_LIMIT;

  if (g.phase === 'over') {
    const r = g.result || {};
    if (r.gameOver) {
      const mine = Array.isArray(r.champions) && r.champions.includes(me.id);
      const head = mine ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Diesmal hat der Computer gewonnen.';
      return { text: `${head} Für jede übrige Karte gibt es einen Strafpunkt. Das Spiel endet bei ${limit} Strafpunkten. Wer die wenigsten hat, gewinnt. Tippe auf Neues Spiel.`, target: '[data-act=again]' };
    }
    const won = r.winner === me.id;
    if (!once(ctx, 'roundEnd', `${g.gid}|${g.round}`)) return { text: `${won ? 'Du hast die Runde gewonnen.' : 'Die Runde ist zu Ende.'} Tippe auf Nächste Runde.`, target: '[data-act=next]' };
    const head = won ? 'Du hast die Runde gewonnen. Herzlichen Glückwunsch.' : 'Die Runde ist zu Ende. Der Computer hat keine Karten mehr.';
    return { text: `${head} Wer keine Karten mehr hat, gewinnt die Runde. Alle anderen bekommen für jede übrige Karte einen Strafpunkt. Tippe auf Nächste Runde.`, target: '[data-act=next]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const roundSig = `${g.gid}|${g.round}`;
  const sig = `${roundSig}|${g.moves}`;

  if (ap.id !== me.id) {
    if (g.moves === 0 && once(ctx, 'botStart', roundSig)) return { text: 'Der Computer hat eine Elf. Wer eine Elf hat, beginnt die Runde. Schau einfach zu.' };
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  const legal = M.legalCards(g, me.id);
  if (!legal.length) {
    if (once(ctx, 'pass', sig)) return { text: 'Du hast keine Karte, die passt. Dann musst du passen und bekommst einen Strafpunkt. Tippe auf Passen.', target: PASS };
    return { text: 'Du musst passen. Tippe auf Passen.', target: PASS };
  }

  if (g.moves === 0 && once(ctx, 'start', roundSig)) {
    return { text: 'Du hast eine Elf. Wer eine Elf hat, beginnt. Lege jetzt eine Elf auf den Tisch. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (g.last && g.last.kind === 'pass' && g.last.pid !== me.id && once(ctx, 'botPass', sig)) {
    return { text: 'Der Computer hatte keine passende Karte. Er musste passen und hat einen Strafpunkt bekommen. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  const rowOf = (c) => g.rows[c.s];
  if (legal.some((c) => rowOf(c) && c.r === rowOf(c).hi + 1) && once(ctx, 'up', sig)) {
    return { text: 'Du kannst nach oben anlegen. Die Zahl muss um eins größer sein als die höchste Zahl der Reihe in dieser Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (legal.some((c) => rowOf(c) && c.r === rowOf(c).lo - 1) && once(ctx, 'down', sig)) {
    return { text: 'Du kannst auch nach unten anlegen. Die Zahl muss um eins kleiner sein als die niedrigste Zahl der Reihe in dieser Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (legal.some((c) => c.r === M.START && !rowOf(c)) && once(ctx, 'newrow', sig)) {
    return { text: 'Eine Elf in einer neuen Farbe darfst du immer legen. Sie eröffnet in dieser Farbe eine neue Reihe. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (me.hand.length === 1 && once(ctx, 'last', sig)) {
    return { text: 'Das ist deine letzte Karte. Wenn du sie legst, gewinnst du die Runde. Tippe auf die leuchtende Karte.', target: CARD };
  }
  if (once(ctx, 'intro', sig)) {
    return { text: 'Du darfst eine Karte legen: eine Karte, die an eine Reihe anschließt, oder eine Elf in einer neuen Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  return { text: 'Tippe auf eine leuchtende Karte.', target: CARD };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
