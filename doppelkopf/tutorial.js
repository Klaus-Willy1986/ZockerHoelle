// Doppelkopf – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as M from './engine.js';

const CARD = '.dk-hand .can';
const NEXT = '[data-act=next]';

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
  if (!g || typeof g !== 'object' || g.game !== 'dk' || !Array.isArray(g.players) || !g.trick || !Array.isArray(g.trick.cards) || !ctx) return null;
  const mi = g.players.findIndex((p) => p && p.id === ctx.id);
  if (mi < 0) return null;
  const me = g.players[mi];
  if (!me || !Array.isArray(me.hand) || !Array.isArray(g.team)) return null;

  if (g.phase === 'over') {
    const r = g.result || {};
    const head = r.gameWinner === me.id ? 'Du hast das ganze Spiel gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Die Punkte aller Runden sind zusammengezählt.';
    return { text: `${head} Du kannst ein neues Spiel starten oder zurück zum Anfang gehen.`, target: '[data-act=again]' };
  }
  if (g.phase === 'round_over') {
    const r = g.result || {};
    const mine = g.team[mi];
    const head = r.winner === mine ? 'Deine Seite hat die Runde gewonnen. Herzlichen Glückwunsch.' : 'Die andere Seite hat die Runde gewonnen.';
    return { text: `${head} Es gibt auch Sonderpunkte: Fuchs, Doppelkopf, Karlchen. Tippe auf Nächste Runde.`, target: NEXT };
  }

  const sig = [g.gid, g.round, g.phase, g.tricksDone, g.trick.cards.length, g.turn].join('|');
  const done = g.tricksDone;
  const myTeam = g.team[mi] === 're' ? 'Re' : 'Kontra';

  if (g.turn !== mi) {
    const ap = g.players[g.turn];
    return { text: `Jetzt ist ${ap && ap.name ? ap.name : 'eine andere Person'} dran. Schau einfach zu.` };
  }

  const legal = M.legalCards(g, me.id);
  const led = g.trick.cards.length ? g.trick.cards[0].card : null;

  if (led === null) {
    if (g.wedding && g.wedding.player === mi && once(ctx, 'wedding', sig)) {
      return { text: 'Beide Kreuz-Damen: Hochzeit. Wer bis zum dritten Stich einen Stich gewinnt, spielt mit dir. Tippe auf eine leuchtende Karte.', target: CARD };
    }
    if (once(ctx, 'team', sig)) {
      const ann = myTeam === 'Re' ? 'Re' : 'Kontra';
      return { text: `Re hat die Kreuz-Damen, Kontra die anderen. Du bist ${myTeam}. Vorher darfst du ${ann} ansagen. Tippe auf eine leuchtende Karte.`, target: CARD };
    }
    if (done >= 1 && once(ctx, 'trumps', sig)) return { text: 'Trümpfe haben unten einen goldenen Streifen. Die Herz-Zehn ist der höchste. Tippe auf eine leuchtende Karte.', target: CARD };
    if (done >= 2 && once(ctx, 'augen', sig)) return { text: 'Augen: Ass elf, Zehn zehn, König vier, Dame drei, Bube zwei. Tippe auf eine leuchtende Karte.', target: CARD };
    if (done >= 3 && once(ctx, 'winLead', sig)) return { text: 'Wer den Stich gewinnt, spielt aus. Das bist jetzt du. Tippe auf eine leuchtende Karte.', target: CARD };
    return { text: 'Tippe auf eine leuchtende Karte.', target: CARD };
  }

  const restricted = legal.length < me.hand.length;
  const grp = M.groupOf(led);
  if (restricted && once(ctx, 'follow', sig)) {
    const what = grp === 3 ? 'Trumpf' : `die Farbe ${M.SUITS[grp].name}`;
    return { text: `Bedienpflicht: Es wurde ${what} gespielt. Gib diese Art zu. Dame und Bube sind Trumpf. Tippe auf eine leuchtende Karte.`, target: CARD };
  }
  if (!restricted && done >= 1 && once(ctx, 'free', sig)) {
    return { text: 'Nichts von dieser Art? Dann darfst du jede Karte spielen. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (once(ctx, 'trick', sig)) {
    return { text: 'Der höchste Trumpf gewinnt den Stich, sonst die höchste Karte der Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (g.known.some((k, i) => k && i !== mi) && once(ctx, 'known', sig)) {
    return { text: 'Wer Kreuz-Dame spielt oder Re ansagt, ist als Re bekannt. Das steht am Namen. Tippe auf eine leuchtende Karte.', target: CARD };
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
