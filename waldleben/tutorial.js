// Waldleben – Anleitung für die Lernrunde (reine Funktion des Spielzustands und der Auswahl auf dem Bildschirm).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
// ctx = { id, ui: { sel, pay, tree, lsel, coachSeen } }
import * as M from './engine.js';
import { CARDS } from './cards.js';

const DECK = '[data-act=deck]';
const HAND_TREE = '.wl-hand .wl-card.tree';
const HAND_CAN = '.wl-hand .wl-card.life.can';
const HAND_ANY = '.wl-hand .wl-card';
const HAND_PAY = '.wl-hand .wl-card:not(.sel):not(.pay)';
const LICH = '.wl-lich .wl-mini';
const TAKE = '[data-act=take]';
const PLANT = '[data-act=plant]';
const SPROUT = '[data-act=sprout]';
const PTREE = '.wl-ptree:not([disabled])';
const PLACE = '[data-act=place]:not([disabled])';
const CANCEL = '[data-act=cancel]';

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

const isNum = (x) => Number.isInteger(x);

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'wl' || !Array.isArray(g.players) || !Array.isArray(g.clearing) || !ctx || typeof ctx !== 'object') return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me || !Array.isArray(me.hand) || !Array.isArray(me.trees)) return null;
  const u = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const sel = isNum(u.sel) && me.hand.includes(u.sel) ? u.sel : null;
  const pay = Array.isArray(u.pay) ? u.pay.filter((x) => me.hand.includes(x) && x !== sel) : [];
  const treeSel = isNum(u.tree) && me.trees[u.tree] ? u.tree : null;
  const lsel = isNum(u.lsel) && g.clearing.includes(u.lsel) ? u.lsel : null;
  const sig = `${g.gid}|${g.turns}`; // Jede Erklärung gehört zu einem Zug: sie bleibt in diesem Zug stehen und kommt später nie wieder

  if (g.phase === 'over') {
    const r = g.result || {};
    const mine = Array.isArray(r.winners) && r.winners.includes(me.id);
    const head = mine ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Diesmal hat der Computer gewonnen.';
    return { text: `${head} Die dritte Winterkarte beendet das Spiel. Gewertet werden alle Karten im Wald und die Höhle. Unten steht die Wertung. Tippe auf Neues Spiel.`, target: '[data-act=again]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;

  // ---- Computer ist dran ----
  if (ap.id !== me.id) {
    if (g.winters >= 1 && once(ctx, 'winter', sig)) return { text: 'Eine Winterkarte wurde aufgedeckt. Sobald die dritte Winterkarte erscheint, endet das Spiel sofort. Schau zu.' };
    if (g.clearing.length >= 7 && once(ctx, 'lichtVoll', sig)) return { text: 'Die Lichtung wird voll. Ab 10 Karten wird sie sofort geleert. Schau einfach zu.' };
    if (once(ctx, 'botFirst', sig)) return { text: 'Jetzt spielt der Computer. Er baut seinen eigenen Wald. Schau einfach zu.' };
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  // ---- ich bin dran: mitten im Ziehen ----
  if (g.drawLeft > 0) {
    if (lsel !== null) return { text: 'Tippe auf Diese Karte nehmen. Dann liegt sie auf deiner Hand.', target: TAKE };
    if (g.clearing.length > 0 && once(ctx, 'lichTake', sig)) {
      return { text: 'Du ziehst bis zu zwei Karten. Du darfst auch eine offene Karte aus der Lichtung nehmen. Tippe jetzt auf eine Karte in der Lichtung.', target: LICH };
    }
    if (once(ctx, 'draw2', sig)) return { text: 'Du darfst noch eine Karte ziehen, vom Stapel oder aus der Lichtung. Tippe auf Vom Stapel ziehen.', target: DECK };
    return { text: 'Tippe auf Vom Stapel ziehen.', target: DECK };
  }

  // ---- Karte aus der Lichtung angetippt, aber nicht im Ziehen ----
  if (lsel !== null) {
    if (M.canDrawNow(g, me)) return { text: 'Tippe auf Diese Karte nehmen.', target: TAKE };
    return { text: 'Tippe auf Zurück.', target: CANCEL };
  }

  const handIds = me.hand.filter((id) => isNum(id) && CARDS[id]);
  const trees = handIds.filter((id) => CARDS[id].kind === 'tree');
  const lives = handIds.filter((id) => M.canPlayAsSelf(g, me, id) && CARDS[id].kind === 'life');
  const canDraw = M.canDrawNow(g, me);

  // ---- eine Handkarte ist gewählt ----
  if (sel !== null) {
    const c = CARDS[sel];
    if (c.kind === 'tree') {
      if (once(ctx, 'plant', sig)) return { text: 'Ein Baum kostet nichts. Er bringt keine Punkte, hat aber 4 Plätze für Karten. Tippe auf Pflanzen. Danach kommt eine Karte vom Stapel in die Lichtung.', target: PLANT };
      return { text: 'Tippe auf Baum pflanzen.', target: PLANT };
    }
    const affordable = me.hand.length - 1 >= c.cost;
    if (!affordable || M.freeSlots(me) === 0) {
      if (once(ctx, 'sproutBtn', sig)) return { text: 'Diese Karte kannst du jetzt nicht anlegen. Jede Karte darf aber verdeckt als Sprössling gepflanzt werden. Das ist ein Baum ohne Art. Tippe auf Als Sprössling pflanzen.', target: SPROUT };
      return { text: 'Tippe auf Als Sprössling pflanzen.', target: SPROUT };
    }
    if (pay.length < c.cost) {
      const rest = c.cost - pay.length;
      if (once(ctx, 'pay', sig)) return { text: `Diese Karte kostet ${c.cost}. Du bezahlst, indem du ${c.cost === 1 ? 'eine andere Handkarte' : c.cost + ' andere Handkarten'} abgibst. Sie kommen in die Lichtung. Tippe auf ${rest === 1 ? 'eine Handkarte' : rest + ' Handkarten'}.`, target: HAND_PAY };
      return { text: `Tippe auf ${rest === 1 ? 'noch eine Handkarte' : 'noch ' + rest + ' Handkarten'} zum Bezahlen.`, target: HAND_PAY };
    }
    const passend = c.cost >= 1 && pay.every((id) => CARDS[id] && CARDS[id].sp === c.sp);
    if (treeSel === null) {
      if (passend && once(ctx, 'passend', sig)) return { text: 'Passend bezahlt: Alle Zahlkarten haben die Baumfarbe der Karte. Dafür ziehst du eine Karte extra. Wähle jetzt einen Baum.', target: PTREE };
      if (once(ctx, 'where', sig)) return { text: 'Jetzt wählst du den Baum, an den die Karte kommt. Tippe auf einen Baum. Danach wählst du die Seite.', target: PTREE };
      return { text: 'Tippe auf einen Baum.', target: PTREE };
    }
    if (once(ctx, 'side', sig)) return { text: 'Jeder Baum hat vier Seiten: oben, unten, links und rechts. Auf jede Seite passt eine Karte. Tippe auf einen freien Platz.', target: PLACE };
    return { text: 'Tippe auf einen freien Platz.', target: PLACE };
  }

  // ---- freie Wahl: Ziehen oder Ausspielen ----
  if (g.turns <= 1 && once(ctx, 'intro', sig)) {
    return { text: 'Du bist dran. Pro Zug machst du genau eins: Karten ziehen oder eine Karte ausspielen. Wir beginnen mit dem Ziehen. Tippe auf Vom Stapel ziehen.', target: DECK };
  }
  if (lives.length) {
    if (once(ctx, 'lifeIntro', sig)) return { text: 'Jetzt legst du ein Tier, eine Pflanze oder einen Pilz an einen Baum an. Tippe auf eine leuchtende Karte.', target: HAND_CAN };
    return { text: 'Tippe auf eine leuchtende Karte.', target: HAND_CAN };
  }
  if (trees.length) {
    if (me.trees.length === 0 && once(ctx, 'treeFirst', sig)) return { text: 'Ohne Baum kannst du keine Karten anlegen. Spiele jetzt eine Baumkarte aus. Tippe auf eine Baumkarte in deiner Hand.', target: HAND_TREE };
    if (once(ctx, 'treeMore', sig)) return { text: 'Du kannst einen weiteren Baum pflanzen. Jeder Baum bringt vier neue Plätze. Tippe auf eine Baumkarte.', target: HAND_TREE };
    return { text: 'Tippe auf eine Baumkarte.', target: HAND_TREE };
  }
  const seenS = ctx.ui && ctx.ui.coachSeen ? ctx.ui.coachSeen.sproutPick : undefined;
  const taught = seenS !== undefined && seenS !== sig;
  if (handIds.length && me.trees.length === 0 && !taught) {
    if (once(ctx, 'sproutPick', sig)) return { text: 'Du hast noch keinen Baum. Jede Handkarte darfst du verdeckt als Sprössling pflanzen. Das ist ein Baum ohne Art. Tippe auf eine Handkarte.', target: HAND_ANY };
  }
  if (canDraw) {
    if (once(ctx, 'drawOnly', sig)) return { text: 'Jetzt kannst du keine Karte ausspielen. Dann ziehst du Karten. Tippe auf Vom Stapel ziehen.', target: DECK };
    return { text: 'Tippe auf Vom Stapel ziehen.', target: DECK };
  }
  if (handIds.length) {
    if (once(ctx, 'sproutPick', sig)) return { text: 'Jede Handkarte darfst du verdeckt als Sprössling pflanzen. Das ist ein Baum ohne Art. Tippe auf eine Handkarte.', target: HAND_ANY };
    return { text: 'Tippe auf eine Handkarte.', target: HAND_ANY };
  }
  if (canDraw) return { text: 'Tippe auf Vom Stapel ziehen.', target: DECK };
  return null;
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
