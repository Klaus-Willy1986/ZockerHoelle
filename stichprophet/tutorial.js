// Stichprophet – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as M from './engine.js';

const CARD = '.st-hand button.can';
const BID = '[data-act=bid]';
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
  if (!g || typeof g !== 'object' || g.game !== 'st' || !Array.isArray(g.players) || !g.trick || !Array.isArray(g.trick.cards) || !ctx) return null;
  const mi = g.players.findIndex((p) => p && p.id === ctx.id);
  if (mi < 0) return null;
  const me = g.players[mi];
  if (!me || !Array.isArray(me.hand)) return null;
  const nameOf = (i) => (g.players[i] && g.players[i].name) || 'Der Computer';

  if (g.phase === 'over') {
    const r = g.result || {};
    const won = Array.isArray(r.winners) && r.winners.includes(me.id);
    const head = won ? 'Du hast das ganze Spiel gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Diesmal hat der Computer vorne gelegen.';
    return { text: `${head} Du kannst ein neues Spiel starten oder zurück zum Anfang gehen.`, target: '[data-act=again]' };
  }
  if (g.phase === 'round_over') {
    const sig = [g.gid, g.round].join('|');
    if (once(ctx, 'score1', sig)) {
      return { text: 'Die Runde ist zu Ende. Richtig angesagt bringt 20 Punkte und 10 Punkte je Stich. Sonst gibt es 10 Minuspunkte für jeden Stich daneben. Tippe auf Nächste Runde.', target: '[data-act=next]' };
    }
    return { text: 'Die Punkte sind eingetragen. Tippe auf Nächste Runde.', target: '[data-act=next]' };
  }

  const done = g.players.reduce((s, p) => s + (p.tricks || 0), 0);
  const sig = [g.gid, g.round, g.phase, g.turn, done, g.trick.cards.length].join('|');

  if (g.phase === 'trump') {
    if (g.turn === mi) {
      if (once(ctx, 'trumpPick', sig)) return { text: 'Aufgedeckt wurde ein Zauberer. Darum darfst du als Geber die Trumpffarbe wählen. Tippe auf eine Farbe.', target: TRUMP };
      return { text: 'Du darfst die Trumpffarbe wählen. Tippe auf eine Farbe.', target: TRUMP };
    }
    return { text: `Aufgedeckt wurde ein Zauberer. ${nameOf(g.turn)} wählt als Geber die Trumpffarbe. Schau einfach zu.` };
  }

  const hand = me.hand;
  const hasWiz = hand.some((c) => M.isWizard(c));
  const hasFool = hand.some((c) => M.isFool(c));

  if (g.phase === 'bid') {
    if (g.turn !== mi) return { text: `${nameOf(g.turn)} sagt jetzt an, wie viele Stiche es macht. Schau einfach zu.` };
    if (once(ctx, 'bid1', sig)) return { text: `Hier sagst du an, wie viele Stiche du in dieser Runde machst. Du hast ${hand.length === 1 ? 'eine Karte' : hand.length + ' Karten'}. Tippe auf eine Zahl.`, target: BID };
    if (g.trump === 'none' && once(ctx, 'noTrump', sig)) return { text: 'Diesmal gibt es keinen Trumpf. Es zählt nur die ausgespielte Farbe. Tippe auf eine Zahl.', target: BID };
    if (Number.isInteger(g.trump) && once(ctx, 'trumpInfo', sig)) return { text: 'Die aufgedeckte Karte bestimmt den Trumpf. Trumpf sticht jede andere Farbe. Tippe auf eine Zahl.', target: BID };
    if (hasWiz && once(ctx, 'wizard', sig)) return { text: 'Du hast einen Zauberer. Er ist die höchste Karte und gewinnt jeden Stich. Tippe auf eine Zahl.', target: BID };
    if (hasFool && once(ctx, 'fool', sig)) return { text: 'Du hast einen Narren. Er ist die niedrigste Karte und verliert fast immer. Tippe auf eine Zahl.', target: BID };
    if (g.dealer === mi && once(ctx, 'dealerBid', sig)) return { text: 'Du hast gegeben und sagst als Letzte oder Letzter an. Tippe auf eine Zahl.', target: BID };
    return { text: 'Tippe auf eine Zahl.', target: BID };
  }

  // Spielphase
  if (g.turn !== mi) return { text: `Jetzt ist ${nameOf(g.turn)} dran. Schau einfach zu.` };
  const legal = M.legalCards(g, me.id);
  const led = g.trick.cards.map((t) => t.card);
  if (!led.length) {
    if (once(ctx, 'lead1', sig)) return { text: 'Du spielst aus. Tippe auf eine leuchtende Karte. Sie liegt dann in der Tischmitte.', target: CARD };
    if (done >= 1 && once(ctx, 'winLead', sig)) return { text: 'Wer einen Stich gewinnt, spielt als Nächster aus. Das bist jetzt du. Tippe auf eine leuchtende Karte.', target: CARD };
    if (done >= 2 && once(ctx, 'stichRule', sig)) return { text: 'So gewinnt man einen Stich: Der erste Zauberer gewinnt. Sonst gewinnt der höchste Trumpf, sonst die höchste Karte der ausgespielten Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
    return { text: 'Tippe auf eine leuchtende Karte.', target: CARD };
  }
  const ledSuit = M.ledSuitOf(led);
  const restricted = legal.length < hand.length;
  if (restricted && once(ctx, 'follow', sig)) {
    return { text: `Farbzwang: Es wurde ${M.SUITS[ledSuit] ? M.SUITS[ledSuit].name : 'eine Farbe'} ausgespielt und du hast diese Farbe. Du musst sie zugeben. Zauberer und Narren darfst du immer spielen. Tippe auf eine leuchtende Karte.`, target: CARD };
  }
  if (!restricted && ledSuit >= 0 && once(ctx, 'free', sig)) {
    return { text: 'Du hast die ausgespielte Farbe nicht. Dann darfst du jede Karte spielen, auch einen Trumpf. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (ledSuit < 0 && once(ctx, 'wizLed', sig)) {
    return { text: 'Am Anfang liegt ein Zauberer oder ein Narr. Darum gibt es keinen Farbzwang. Tippe auf eine leuchtende Karte.', target: CARD };
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
