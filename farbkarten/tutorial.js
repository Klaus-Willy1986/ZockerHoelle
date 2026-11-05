// Farbkarten – Lernrunde: Anleitung zum Mitlesen und Vorlesen (reine Funktion, keine Oberfläche).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as E from './engine.js';

const T = {
  hand: '.fk-hand .fk-ok',
  draw: '[data-act="draw"]',
  color: '[data-act="color"]',
  call: '[data-act="call"]',
  keep: '[data-act="keep"]',
  next: '[data-act="next"]',
  again: '[data-act="again"]',
};

// Erklärung genau einmal: Solange die Lage (key) gleich bleibt, bleibt der Text stehen
// (das Spiel zeichnet mehrmals pro Zug), danach kommt er nie wieder.
function once(seen, name, key) {
  if (seen[name] === undefined) { seen[name] = key; return true; }
  return seen[name] === key;
}

const COLOR_ADJ = { R: 'Rot', Y: 'Gelb', G: 'Grün', B: 'Blau' };

function compute(game, ctx) {
  if (!game || typeof game !== 'object' || game.game !== 'fk' || !Array.isArray(game.players)) return null;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  let seen = {};
  if (c.ui && typeof c.ui === 'object') {
    if (!c.ui.coachSeen || typeof c.ui.coachSeen !== 'object') c.ui.coachSeen = {};
    seen = c.ui.coachSeen;
  }
  const mi = game.players.findIndex((p) => p && p.id === c.id);
  if (mi < 0) return null;
  const me = game.players[mi];
  const hand = Array.isArray(me.hand) ? me.hand : [];

  if (game.mode === 'over') {
    const w = game.players[game.winner];
    return { text: `Das Spiel ist zu Ende. ${w ? (w.id === me.id ? 'Du hast' : w.name + ' hat') : 'Jemand hat'} 500 Punkte erreicht. Tippe auf Neues Spiel, wenn du weiterspielen möchtest.`, target: T.again };
  }
  if (game.mode === 'round') {
    const w = game.players[game.roundWinner];
    const who = w ? (w.id === me.id ? 'Du hast' : w.name + ' hat') : 'Jemand hat';
    return { text: `Die Runde ist zu Ende. ${who} keine Karten mehr und bekommt Punkte für die Karten der anderen. Tippe auf Nächste Runde.`, target: T.next };
  }
  if (game.mode !== 'play') return null;

  const ap = game.players[game.active];
  if (!ap) return null;
  const last = game.last && typeof game.last === 'object' ? game.last : null;
  const key = [game.gid, game.round, game.seq].join('|');
  const lastCard = last && last.kind === 'play' && typeof last.card === 'string' ? last.card : '';
  const cardKind = (card) => (card === 'W' ? 'W' : card === 'W4' ? 'W4' : card[1]);

  // 1. Ruf „Letzte Karte“
  if (game.call && game.call.pid === me.id && hand.length === 1) {
    return { text: 'Du hast nur noch eine Karte. Tippe auf Letzte Karte, damit der Ruf zählt. Sonst musst du 2 Karten ziehen.', target: T.call };
  }

  const myTurn = ap.id === me.id;

  // 2. Was gerade passiert ist (jede Erklärung genau einmal)
  let pre = null;
  if (game.penalty && game.penalty.pid === me.id && game.penalty.seq === game.seq && once(seen, 'pen', key)) {
    pre = 'Du hast Letzte Karte nicht gerufen. Darum hast du 2 Karten bekommen.';
  } else if (lastCard && last.pid !== me.id) {
    const k = cardKind(lastCard);
    const victimMe = last.victim === me.id;
    if (k === 'S' && victimMe && once(seen, 'oppS', key)) pre = 'Der Computer hat Aussetzen gelegt. Du setzt einmal aus, der Computer ist gleich nochmal dran.';
    else if (k === 'U' && victimMe && once(seen, 'oppU', key)) pre = 'Der Computer hat Richtungswechsel gelegt. Zu zweit heißt das: Du setzt aus.';
    else if (k === 'Z' && victimMe && once(seen, 'oppZ', key)) pre = `Der Computer hat Zwei ziehen gelegt. Du hast ${last.drawn || 2} Karten bekommen und setzt aus.`;
    else if (k === 'W4' && victimMe && once(seen, 'oppW4', key)) pre = `Der Computer hat Vier ziehen gelegt. Du hast ${last.drawn || 4} Karten bekommen und setzt aus.`;
    else if ((k === 'W' || k === 'W4') && game.color && once(seen, 'oppW', key)) pre = `Der Computer hat einen Joker gelegt und ${COLOR_ADJ[game.color]} gewählt. Jetzt zählt diese Farbe.`;
  } else if (lastCard && last.pid === me.id) {
    const k = cardKind(lastCard);
    if (k === 'S' && once(seen, 'mineS', key)) pre = 'Der Computer muss aussetzen. Du bist gleich nochmal dran.';
    else if (k === 'U' && once(seen, 'mineU', key)) pre = 'Zu zweit wirkt Richtungswechsel wie Aussetzen. Du bist nochmal dran.';
    else if (k === 'Z' && once(seen, 'mineZ', key)) pre = 'Der Computer hat 2 Karten gezogen und setzt aus. Du bist nochmal dran.';
    else if (k === 'W4' && once(seen, 'mineW4', key)) pre = 'Der Computer hat 4 Karten gezogen und setzt aus. Du bist nochmal dran.';
    else if (k === 'W' && once(seen, 'mineW', key)) pre = 'Du hast einen Joker gelegt. Der Computer muss jetzt die gewählte Farbe legen.';
  }

  if (!myTurn) {
    return { text: pre || 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  // 3. Ich bin dran
  const tail = (t) => (pre && pre.length + t.length < 190 ? `${pre} ${t}` : t);
  if (game.stage === 'color') {
    return { text: 'Der aufgedeckte Joker lässt dich die Farbe wählen. Tippe auf eine Farbe.', target: T.color };
  }
  const ui = c.ui && typeof c.ui === 'object' ? c.ui : {};
  if (ui.pick) return { text: 'Wähle jetzt die Farbe, die ab jetzt gelten soll. Tippe auf eine Farbe.', target: T.color };

  const legal = E.legalCards(game, mi);
  if (game.drawn) {
    return { text: tail('Die gezogene Karte passt. Lege sie, oder tippe auf Behalten und aussetzen.'), target: `${T.hand}, ${T.keep}` };
  }
  if (game.pending) {
    const n = game.pending.n;
    if (legal.length) return { text: tail(`Du musst ${n} Karten ziehen. Oder lege eine gleiche Karte darauf. Tippe auf Ziehen oder auf eine leuchtende Karte.`), target: `${T.draw}, ${T.hand}` };
    return { text: tail(`Du musst ${n} Karten ziehen. Das ist die Strafe. Tippe auf Karten ziehen.`), target: T.draw };
  }
  if (!legal.length) {
    if (once(seen, 'draw', key) && !pre) return { text: 'Du hast keine passende Karte. Tippe auf den Stapel, um eine Karte zu ziehen. Passt sie, darfst du sie legen.', target: T.draw };
    return { text: tail('Du hast keine passende Karte. Tippe auf den Stapel.'), target: T.draw };
  }

  // Sonderkarten, die du jetzt legen dürftest: beim ersten Mal erklären
  if (!pre) {
    const kinds = new Set(legal.map(cardKind));
    if (kinds.has('S') && once(seen, 'cardS', key)) pre = 'Du hast Aussetzen. Legst du sie, muss der Computer einmal aussetzen. Du bist dann gleich nochmal dran.';
    else if (kinds.has('U') && once(seen, 'cardU', key)) pre = 'Du hast Richtungswechsel. Zu zweit wirkt er wie Aussetzen: Der Computer setzt aus, du bist nochmal dran.';
    else if (kinds.has('Z') && once(seen, 'cardZ', key)) pre = 'Du hast Zwei ziehen. Legst du sie, muss der Computer 2 Karten ziehen und aussetzen.';
    else if (kinds.has('W') && once(seen, 'cardW', key)) pre = 'Du hast einen Joker. Er passt immer, und du wählst die Farbe, die danach gilt.';
    else if (kinds.has('W4') && once(seen, 'cardW4', key)) pre = 'Du hast Vier ziehen. Er ist erlaubt, weil du keine Karte in der aktuellen Farbe hast. Der Computer zieht 4 Karten.';
  }
  if (pre) return { text: `${pre} Tippe auf eine leuchtende Karte.`, target: T.hand };
  if (once(seen, 'intro', key)) {
    return { text: 'Du bist dran. Lege eine Karte mit gleicher Farbe oder gleicher Zahl wie die Karte in der Mitte. Tippe auf eine leuchtende Karte.', target: T.hand };
  }
  return { text: 'Du bist dran. Tippe auf eine leuchtende Karte.', target: T.hand };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
