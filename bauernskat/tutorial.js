// Bauernskat – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as M from './engine.js';

const CARD = '.bsk-mine .can';
const TRUMP = '[data-act=trump]';

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
  if (!g || typeof g !== 'object' || g.game !== 'bsk' || !Array.isArray(g.players) || !g.trick || !Array.isArray(g.trick.cards) || !ctx) return null;
  const mi = g.players.findIndex((p) => p && p.id === ctx.id);
  if (mi < 0) return null;
  const me = g.players[mi];
  const opp = g.players[1 - mi];
  if (!opp || !Array.isArray(me.cols)) return null;

  if (g.phase === 'over') {
    const r = g.result || {};
    const head = r.gameWinner === me.id ? 'Du hast das ganze Spiel gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Du kannst ein neues Spiel starten oder zurück zum Anfang gehen.`, target: '[data-act=again]' };
  }
  if (g.phase === 'round_over') {
    const r = g.result || {};
    const head = r.winner === me.id ? 'Du hast die Runde gewonnen. Herzlichen Glückwunsch.' : r.winner ? 'Der Computer hat die Runde gewonnen.' : 'Die Runde ist unentschieden.';
    return { text: `${head} Die Augen wurden gezählt. Wer mehr als 60 hat, gewinnt. Tippe auf Nächste Runde.`, target: '[data-act=next]' };
  }

  const sig = [g.gid, g.round, g.phase, me.tricks + opp.tricks, g.trick.cards.length, g.turn].join('|');
  const done = me.tricks + opp.tricks;

  if (g.phase === 'trump') {
    if (g.turn === mi) {
      if (!once(ctx, 'trump1', sig)) return { text: 'Bestimme den Trumpf. Tippe auf eine Farbe oder Grand.', target: TRUMP };
      return { text: 'Jede Person hat 8 Spalten: unten verdeckt, oben offen. Du bestimmst den Trumpf. Tippe auf eine Farbe oder auf Grand.', target: TRUMP };
    }
    return { text: 'Der Computer bestimmt jetzt den Trumpf. Schau einfach zu.' };
  }

  if (g.turn !== mi) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };

  const legal = M.legalCols(g, me.id);
  const open = me.cols.filter((c) => c && c.up !== null).length;
  const led = g.trick.cards.length ? g.trick.cards[0].card : null;

  if (led === null) {
    if (once(ctx, 'lead1', sig)) return { text: `Trumpf ist ${M.trumpName(g.trump)}. Die vier Buben sind immer Trumpf und stechen alles. Du spielst aus. Tippe auf eine leuchtende Karte.`, target: CARD };
    if (done >= 1 && once(ctx, 'reveal', sig)) return { text: 'Die verdeckte Karte unter einer gespielten wird umgedreht. Ab dem nächsten Stich kannst du sie spielen. Tippe auf eine leuchtende Karte.', target: CARD };
    if (done >= 3 && once(ctx, 'augen', sig)) return { text: 'Jeder Stich zählt Augen: Ass 11, Zehn 10, König 4, Dame 3, Bube 2. Wer über 60 Augen hat, gewinnt. Tippe auf eine leuchtende Karte.', target: CARD };
    if (done >= 2 && once(ctx, 'winLead', sig)) return { text: 'Wer den Stich gewinnt, spielt als Nächster aus. Das bist jetzt du. Tippe auf eine leuchtende Karte.', target: CARD };
    return { text: 'Tippe auf eine leuchtende Karte.', target: CARD };
  }

  const restricted = legal.length < open;
  const ledGroup = M.groupOf(g, led);
  if (restricted && once(ctx, 'follow', sig)) {
    const what = ledGroup === 4 ? 'Trumpf' : `die Farbe ${M.SUITS[ledGroup].name}`;
    return { text: `Bedienpflicht: Der Computer hat ${what} ausgespielt. Gib eine offene Karte dieser Art zu. Tippe auf eine leuchtende Karte.`, target: CARD };
  }
  if (!restricted && done >= 1 && once(ctx, 'free', sig)) {
    return { text: 'Du hast keine offene Karte dieser Art. Dann darfst du jede offene Karte spielen. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (once(ctx, 'trick', sig)) {
    return { text: 'Die höhere Karte derselben Art gewinnt den Stich. Trumpf sticht jede andere Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
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
