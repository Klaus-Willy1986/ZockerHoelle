// Lernrunde für Haus & Hof: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Stellen, die pulsieren sollen.
// Keine Zug-Empfehlungen, nur Erklärungen: was ist möglich, wie funktioniert das Spiel.
import * as E from './engine.js';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder. Der Zustand wird durch game.seq erkannt (zählt gültige Nachrichten).
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen && typeof ctx.ui.coachSeen === 'object' ? ctx.ui.coachSeen : (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

const ALL = Array.from({ length: E.BOARD_SIZE }, (_, i) => i);

// Textzeilen seit dem letzten Würfeln
function sinceRoll(g) {
  const r = Array.isArray(g.recap) ? g.recap.filter((l) => typeof l === 'string') : [];
  let k = -1;
  for (let i = r.length - 1; i >= 0; i--) if (/ würfelt \d+ und \d+/.test(r[i])) { k = i; break; }
  return k >= 0 ? r.slice(k) : [];
}
const paidRent = (lines, name) => lines.some((l) => l.startsWith(name + ' zahlt ') && l.includes('(Miete '));
const gotRent = (lines, name) => lines.some((l) => l.includes(' an ' + name + ' (Miete '));
const paidTax = (lines, name) => lines.some((l) => l.startsWith(name + ' zahlt ') && /\((Semestergebühr|Parkgebühr Oberstadt)\)/.test(l));

const BUY = '[data-act="buy"], [data-act="decline"]';
const BID = '[data-act="bid"], [data-act="pass_bid"]';
const END = '[data-act="end"]';

function other(g, ctx, me, ap, sig) {
  const lines = sinceRoll(g);
  if (gotRent(lines, me.name) && firstTime(ctx, 'rentIn1', 'c' + sig)) {
    return { text: 'Der Computer ist auf deinem Grundstück gelandet und zahlt dir Miete. Das Geld kommt direkt auf dein Konto. Schau einfach weiter zu.' };
  }
  if (g.phase === 'auction') return { text: 'Der Computer entscheidet gerade bei der Versteigerung. Schau einfach zu.' };
  if (g.phase === 'raise') return { text: 'Der Computer muss Geld beschaffen. Schau einfach zu.' };
  if (g.phase === 'buy') return { text: 'Der Computer überlegt, ob er das Grundstück kauft. Schau einfach zu.' };
  return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
}

function rollStep(g, ctx, me, sig) {
  if (me.jail > 0) {
    if (firstTime(ctx, 'jail1', sig)) {
      return { text: 'Du sitzt im Hexenturm. Du kommst frei mit einem Pasch, mit 50 Zahlen oder mit einer Freikarte. Nach drei Fehlversuchen zahlst du 50 und ziehst weiter.', target: '[data-act="roll"], [data-act="pay_jail"], [data-act="use_card"]' };
    }
    return { text: 'Du bist noch im Hexenturm. Würfle einen Pasch, oder wähle einen anderen Weg hinaus.', target: '[data-act="roll"]' };
  }
  if (g.doubles > 0 && firstTime(ctx, 'pasch1', sig)) {
    return { text: 'Pasch! Beide Würfel zeigen dieselbe Zahl. Darum darfst du noch einmal würfeln. Dreimal hintereinander ein Pasch schickt dich aber in den Hexenturm.', target: '[data-act="roll"]' };
  }
  if (firstTime(ctx, 'roll1', sig)) {
    return { text: 'Das Brett ist ein Rundweg mit 40 Feldern. Du würfelst mit zwei Würfeln und ziehst deine Figur im Uhrzeigersinn so viele Felder weiter, wie die Augensumme zeigt. Tippe auf Würfeln.', target: '[data-act="roll"]' };
  }
  return { text: 'Du bist dran. Tippe auf Würfeln.', target: '[data-act="roll"]' };
}

function eventStep(g, ctx, me, sig) {
  if (g.card && g.card.pid === me.id && firstTime(ctx, 'event1', sig)) {
    return { text: 'Ereignisfeld: Du ziehst eine Karte und tust, was darauf steht. Das kann Geld bringen, Geld kosten oder dich auf ein anderes Feld schicken.', target: null };
  }
  return null;
}

function buyStep(g, ctx, me, sig) {
  const ev = eventStep(g, ctx, me, sig);
  if (ev) return { ...ev, target: BUY };
  if (firstTime(ctx, 'buy1', sig)) {
    const auc = g.opts && g.opts.auction === false ? 'Kaufst du nicht, bleibt das Feld frei.' : 'Kaufst du nicht, wird es versteigert: Alle dürfen bieten.';
    return { text: `Dieses Feld ist noch frei. Wenn du es kaufst, gehört es dir, und andere zahlen dir Miete, wenn sie darauf landen. ${auc}`, target: BUY };
  }
  return { text: 'Möchtest du dieses Feld kaufen? Tippe auf Kaufen oder auf Nicht kaufen.', target: BUY };
}

function auctionStep(g, ctx, sig) {
  if (firstTime(ctx, 'auction1', sig)) {
    return { text: 'Versteigerung: Alle bieten der Reihe nach. Du kannst mehr bieten oder passen. Wer passt, ist raus. Das höchste Gebot bekommt das Feld.', target: BID };
  }
  return { text: 'Du bist beim Bieten dran. Tippe auf ein Gebot oder auf Passen.', target: BID };
}

function raiseStep(g, ctx, sig) {
  const t = '[data-act="sell"]:not([disabled]), [data-act="mortgage"]:not([disabled]), [data-act="declare_bankrupt"]';
  if (firstTime(ctx, 'raise1', sig)) {
    return { text: 'Du musst zahlen, aber dein Bargeld reicht nicht. Verkaufe Häuser oder beleihe Grundstücke (Hypothek), bis es reicht. Sonst bist du bankrott und scheidest aus.', target: t };
  }
  return { text: 'Du musst noch Geld beschaffen: Häuser verkaufen oder Grundstücke beleihen.', target: t };
}

function manageStep(g, ctx, me, sig) {
  const lines = sinceRoll(g);
  const ev = eventStep(g, ctx, me, sig);
  if (ev) return { ...ev, target: END };
  if (paidTax(lines, me.name) && firstTime(ctx, 'tax1', sig)) {
    return { text: 'Steuerfeld: Hier zahlst du eine feste Gebühr an die Bank. Das Geld kommt aus deinem Bargeld.', target: END };
  }
  if (paidRent(lines, me.name) && firstTime(ctx, 'rent1', sig)) {
    return { text: 'Das Grundstück gehört jemand anderem. Darum hast du Miete bezahlt. Je mehr Häuser dort stehen, desto höher ist die Miete.', target: END };
  }
  if (me.jail > 0 && firstTime(ctx, 'jail1', sig)) {
    return { text: 'Du bist im Hexenturm gelandet. Beim nächsten Zug kommst du frei mit einem Pasch, mit 50 Zahlen oder mit einer Freikarte. Bauen und Beleihen geht auch von dort.', target: END };
  }
  if (ALL.some((sq) => E.canBuild(g, me.id, sq)) && firstTime(ctx, 'build1', sig)) {
    return { text: 'Dir gehören alle Straßen einer Farbe. Nun darfst du dort Häuser bauen, immer gleichmäßig auf alle Straßen der Farbe. Mehr Häuser bringen mehr Miete. Du musst nicht bauen.', target: '[data-act="build"]:not([disabled])' };
  }
  if (firstTime(ctx, 'manage1', sig)) {
    return { text: 'Dein Zug ist fast vorbei. Jetzt darfst du noch verwalten: bauen, Häuser verkaufen oder beleihen. Das ist freiwillig. Tippe auf Zug beenden, wenn du fertig bist.', target: END };
  }
  if (ALL.some((sq) => E.canMortgage(g, me.id, sq)) && firstTime(ctx, 'mortgage1', sig)) {
    return { text: 'Beleihen (Hypothek): Du bekommst von der Bank sofort das halbe Geld des Grundstücks. Solange es beliehen ist, gibt es dort keine Miete. Auslösen kostet etwas mehr.', target: '[data-act="mortgage"]:not([disabled])' };
  }
  if (g.rollAgain && me.jail === 0) return { text: 'Du hattest einen Pasch. Tippe auf Weiter, dann würfelst du noch einmal.', target: END };
  return { text: 'Du kannst noch verwalten oder deinen Zug beenden.', target: END };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || game.game !== 'haus' || !Array.isArray(game.players)
      || !game.owners || typeof game.owners !== 'object' || !game.houses || typeof game.houses !== 'object') return null;
    const me = game.players.find((p) => p && p.id === ctx.id);
    if (!me) return null;
    if (game.phase === 'over') {
      const why = game.result && game.result.reason === 'last'
        ? 'Alle anderen sind bankrott.'
        : 'Beim Kurzspiel gewinnt nach der letzten Runde, wer am meisten besitzt: Bargeld, Grundstücke und Häuser zählen.';
      return { text: `Das Spiel ist zu Ende. ${why} Tippe auf Noch eine Runde, wenn du magst.`, target: '[data-act="again"]' };
    }
    const ap = E.activePlayer(game);
    if (!ap || me.out) return null;
    const sig = String(game.seq);
    if (ap.id !== me.id) return other(game, ctx, me, ap, sig);
    switch (game.phase) {
      case 'roll': return rollStep(game, ctx, me, sig);
      case 'buy': return buyStep(game, ctx, me, sig);
      case 'auction': return auctionStep(game, ctx, sig);
      case 'raise': return raiseStep(game, ctx, sig);
      case 'manage': return manageStep(game, ctx, me, sig);
      default: return null;
    }
  } catch {
    return null;
  }
}
