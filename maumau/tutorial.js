// Mau-Mau – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as M from './engine.js';

const CARD = '.mm-hand .can';
const DRAW = '[data-act=draw]';

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
  if (!g || typeof g !== 'object' || g.game !== 'mm' || !Array.isArray(g.players) || !g.turn || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};

  if (g.phase === 'over') {
    const r = g.result || {};
    const head = r.winner === me.id ? 'Du hast die Runde gewonnen. Herzlichen Glückwunsch.' : 'Die Runde ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Die Tabelle zeigt die Punkte. Weniger Punkte sind besser. Tippe auf Nächste Runde, wenn du weiterspielen möchtest.`, target: '[data-act=next]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.round, g.discard.length, g.deck.length, g.active, g.turn.drew ? 1 : 0].join('|');

  // Mau rufen (auch wenn jemand anderes am Zug ist)
  if (g.mau && g.mau.pid === me.id && !g.mau.called) {
    return { text: 'Du hast nur noch eine Karte. Dann musst du Mau rufen. Tippe auf den roten Knopf Mau.', target: '[data-act=mau]' };
  }

  if (ap.id !== me.id) {
    if (g.turn.forced === 'seven') return { text: 'Der Computer muss wegen deiner Sieben zwei Karten ziehen und setzt aus. Schau einfach zu.' };
    if (g.turn.forced === 'eight') return { text: 'Der Computer muss wegen deiner Acht aussetzen. Schau einfach zu.' };
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  const f = g.turn.forced;
  if (f === 'seven') {
    if (once(ctx, 'gotSeven', sig)) return { text: 'Der Computer hat eine Sieben gelegt. Dann musst du zwei Karten ziehen und setzt danach aus. Tippe auf Zwei Karten ziehen.', target: DRAW };
    return { text: 'Du musst zwei Karten ziehen. Tippe auf Zwei Karten ziehen.', target: DRAW };
  }
  if (f === 'eight') {
    if (once(ctx, 'gotEight', sig)) return { text: 'Der Computer hat eine Acht gelegt. Dann setzt du eine Runde aus. Tippe auf den Knopf zum Aussetzen.', target: '[data-act=skip]' };
    return { text: 'Du setzt aus. Tippe auf den Knopf zum Aussetzen.', target: '[data-act=skip]' };
  }

  const sel = ui.sel && typeof ui.sel === 'object' ? ui.sel : null;
  if (sel && sel.last) {
    return { text: 'Das ist deine letzte Karte. Beim Legen musst du Mau Mau rufen. Tippe auf den Knopf Mau Mau.', target: '[data-act=play-last]' };
  }
  if (sel) {
    return { text: 'Ein Bube passt auf jede Karte. Wünsche dir jetzt eine Farbe. Die nächste Person muss diese Farbe legen. Tippe auf eine Farbe.', target: '[data-act=wish]' };
  }

  if (g.turn.drew) {
    if (once(ctx, 'drawnFits', sig)) return { text: 'Die gezogene Karte passt. Du darfst sie legen. Du kannst sie auch behalten. Tippe auf die leuchtende Karte.', target: CARD };
    return { text: 'Tippe auf die leuchtende Karte, um sie zu legen.', target: CARD };
  }

  const legal = M.legalCards(g, me.id);
  if (!legal.length) {
    if (once(ctx, 'noMatch', sig)) return { text: 'Du hast keine passende Karte. Dann ziehst du eine Karte vom Stapel. Tippe auf den Stapel.', target: DRAW };
    return { text: 'Du hast keine passende Karte. Tippe auf den Stapel.', target: DRAW };
  }

  if (me.hand.length === 1) {
    return { text: 'Das ist deine letzte Karte. Tippe auf die leuchtende Karte.', target: CARD };
  }
  if (g.wish !== null && g.wish !== undefined && once(ctx, 'wishInfo', sig)) {
    return { text: 'Der Computer hat sich eine Farbe gewünscht. Du musst diese Farbe legen oder einen Buben. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (legal.some((c) => c.r === M.R7) && once(ctx, 'seven', sig)) {
    return { text: 'Du kannst eine Sieben legen. Dann muss die nächste Person zwei Karten ziehen und aussetzen. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (legal.some((c) => c.r === M.R8) && once(ctx, 'eight', sig)) {
    return { text: 'Du kannst eine Acht legen. Dann setzt die nächste Person eine Runde aus. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (legal.some((c) => c.r === M.RJ) && once(ctx, 'jack', sig)) {
    return { text: 'Du kannst einen Buben legen. Ein Bube passt auf jede Karte. Danach wünschst du dir eine Farbe. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (me.hand.length === 2 && once(ctx, 'mauInfo', sig)) {
    return { text: 'Wenn du nach dem Legen nur noch eine Karte hast, musst du Mau rufen. Tippe auf eine leuchtende Karte.', target: CARD };
  }
  if (once(ctx, 'intro', sig)) {
    return { text: 'Lege eine Karte mit gleicher Farbe oder gleichem Wert wie die oberste Karte auf dem Ablagestapel. Tippe auf eine leuchtende Karte.', target: CARD };
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
