// Kartenrennen – Lernrunde: Anleitung zum Mitlesen und Vorlesen (reine Funktion, keine Oberfläche).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Zugempfehlungen, nur Bedienung und Regeln.
// ctx = { id, ui } mit ui.sel (Auswahl der Person), ui.swapPick, ui.coachSeen (merkt, was schon erklärt wurde).
import * as K from './engine.js';

const SWAPCARD = '[data-act="swapcard"]';
const SWAPOK = '[data-act="swapok"]';
const CARD = '.kr-card.can';
const JOKERAS = '[data-act="jokeras"]';
const OPT = '[data-act="opt"]';
const STONE = '.kr-tapstone.kr-can';
const TARGET = '.kr-tgt';
const DISCARD = '[data-act="discard"]';
const NEXT = '[data-act="next"]';

const felder = (n) => (n === 1 ? '1 Feld' : `${n} Felder`);

// Erklärung genau einmal: Solange die Lage (key) gleich bleibt, bleibt der Text stehen
// (das Spiel zeichnet mehrmals pro Zug), danach kommt er nie wieder.
function once(seen, name, key) {
  if (seen[name] === undefined) { seen[name] = key; return true; }
  return seen[name] === key;
}

function rankText(eff, hasOut) {
  switch (eff) {
    case '2': case '3': case '5': case '6': case '8': case '9': case '10':
      return `Eine ${eff}: Ein Stein zieht ${felder(Number(eff))} vorwärts, im Uhrzeigersinn.`;
    case 'DAME': return 'Die Dame ist eine 12: Ein Stein zieht 12 Felder vorwärts.';
    case '4': return 'Die Vier geht rückwärts: Ein Stein zieht 4 Felder zurück. So kommt er nie ins Ziel.';
    case '7': return 'Die Sieben hat 7 Felder. Du darfst sie auf mehrere Steine verteilen, Schritt für Schritt. Auf allen Feldern, über die ein Stein läuft, werden andere Steine geschlagen.';
    case 'BUBE': return 'Der Bube tauscht den Platz von einem deiner Steine mit einem anderen Stein auf der Ringbahn.';
    case 'ASS': return `Das Ass: Ein Stein zieht 1 oder 11 Felder${hasOut ? ' oder kommt aus dem Stall auf dein Startfeld' : ''}.`;
    case 'KING': return `Der König: Ein Stein zieht 13 Felder${hasOut ? ' oder kommt aus dem Stall auf dein Startfeld' : ''}.`;
    default: return '';
  }
}

function compute(game, ctx) {
  if (!game || typeof game !== 'object' || game.game !== 'kr' || !Array.isArray(game.players) || game.players.length !== 4) return null;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const ui = c.ui && typeof c.ui === 'object' ? c.ui : {};
  let seen = {};
  if (c.ui && typeof c.ui === 'object') {
    if (!c.ui.coachSeen || typeof c.ui.coachSeen !== 'object') c.ui.coachSeen = {};
    seen = c.ui.coachSeen;
  }
  const seat = game.players.findIndex((p) => p && p.id === c.id);
  if (seat < 0) return null;
  const me = game.players[seat];
  if (!me || !Array.isArray(me.hand)) return null;
  const key = [game.gid, game.round, game.used, game.phase].join('|');

  if (game.phase === 'over') {
    const mine = game.winner === K.teamOf(seat);
    const head = mine ? 'Dein Team hat gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Das andere Team hat gewonnen.';
    return { text: `${head} Tippe auf Noch ein Spiel, wenn du weiterspielen möchtest.`, target: NEXT };
  }

  if (game.phase === 'swap') {
    if (game.swapSel && game.swapSel[seat]) return { text: 'Du hast deine Karte weitergegeben. Die anderen wählen noch. Einen Moment bitte.' };
    const pick = ui.swapPick;
    if (Number.isInteger(pick) && me.hand[pick]) return { text: 'Tippe auf Diese Karte weitergeben.', target: SWAPOK };
    if (once(seen, 'swap', key)) {
      return { text: 'Zu Beginn jeder Runde gibt jede Person eine Karte verdeckt an ihre Partnerin weiter, die dir gegenüber sitzt. Tippe auf eine Karte aus deiner Hand.', target: SWAPCARD };
    }
    return { text: 'Wähle eine Karte für deine Partnerin. Tippe auf eine Karte.', target: SWAPCARD };
  }

  if (game.phase !== 'play') return null;
  const ap = game.players[game.turn];
  if (!ap) return null;
  if (ap.id !== me.id) {
    const last = game.last && typeof game.last === 'object' ? game.last : null;
    if (last && last.kind === 'play' && Array.isArray(last.caps) && last.seat !== seat && last.caps.some((x) => x && K.seatOfStone(x.g) === seat) && once(seen, 'gotCaptured', key)) {
      return { text: 'Einer deiner Steine wurde geschlagen. Er muss zurück in den Stall. Das gehört zum Spiel. Jetzt spielt ' + ap.name + '.' };
    }
    return { text: `Jetzt spielt ${ap.name}. Schau einfach zu.` };
  }

  const ctl = K.controlledSeat(game, seat);
  if (!K.canPlay(game, me.id)) {
    if (once(seen, 'discard', key)) return { text: 'Du kannst mit keiner Karte ziehen. Dann musst du alle Karten abwerfen und setzt in dieser Runde aus. Tippe auf Karten abwerfen.', target: DISCARD };
    return { text: 'Wieder kein Zug möglich. Tippe auf Karten abwerfen.', target: DISCARD };
  }
  const sel = ui.sel && typeof ui.sel === 'object' && ui.sel.card ? ui.sel : null;
  const st = K.selStage(game, me.id, sel);
  const b = K.boardOf(game);

  if (st.stage === 'card' || st.stage === 'none') {
    if (once(seen, 'intro', key)) {
      return { text: 'Jetzt bist du dran. Spiele eine Karte: Tippe auf eine grün umrandete Karte. Danach tippst du auf einen Stein und auf das markierte Zielfeld.', target: CARD };
    }
    if (ctl !== seat && once(seen, 'partner', key)) {
      return { text: 'Alle deine Steine sind im Ziel. Deshalb spielst du jetzt die Steine deiner Partnerin mit. Tippe auf eine grün umrandete Karte.', target: CARD };
    }
    const last = game.last && typeof game.last === 'object' ? game.last : null;
    if (last && last.kind === 'play' && Array.isArray(last.caps) && last.seat !== seat && last.caps.some((x) => x && K.seatOfStone(x.g) === seat) && once(seen, 'gotCaptured', key)) {
      return { text: 'Einer deiner Steine wurde geschlagen. Er muss zurück in den Stall. Das gehört zum Spiel. Tippe auf eine grün umrandete Karte.', target: CARD };
    }
    const inStall = [0, 1, 2, 3].every((i) => b.p[ctl * 4 + i] < 0);
    if (inStall && once(seen, 'stall', key)) {
      return { text: 'Deine Steine stehen noch im Stall. Ein Stein kommt nur mit Ass, König oder Joker auf dein Startfeld, das Eckfeld mit dem Pfeil. Tippe auf eine grün umrandete Karte.', target: CARD };
    }
    return { text: 'Tippe auf eine grün umrandete Karte.', target: CARD };
  }

  const eff = st.eff || (sel && sel.card && sel.card.r);
  const rk = 'rank:' + eff;
  if (st.stage === 'joker') {
    if (once(seen, 'joker', key)) return { text: 'Der Joker ersetzt jede Karte. Du wählst, welche Karte er sein soll. Tippe auf einen Knopf.', target: JOKERAS };
    return { text: 'Welche Karte soll der Joker sein? Tippe auf einen Knopf.', target: JOKERAS };
  }
  if (st.stage === 'opt') {
    const t = rankText(eff, true);
    if (t && once(seen, rk, key)) return { text: `${t} Tippe auf einen Knopf.`, target: OPT };
    return { text: 'Wähle, was du tun möchtest. Tippe auf einen Knopf.', target: OPT };
  }
  if (st.stage === 'stone') {
    const t = rankText(eff, false);
    if (eff === '7' && sel && sel.parts && sel.parts.length) return { text: `Noch ${felder(st.left)} zu ziehen. Tippe auf einen Stein mit leuchtendem Ring.`, target: STONE };
    if (t && once(seen, rk, key)) return { text: `${t} Tippe auf einen Stein mit leuchtendem Ring.`, target: STONE };
    return { text: 'Tippe auf einen Stein mit leuchtendem Ring.', target: STONE };
  }
  if (st.stage === 'target') {
    if (eff === 'BUBE') return { text: 'Tippe auf den Stein, mit dem du tauschen möchtest. Er ist grün markiert.', target: TARGET };
    let capture = false; let ownCapture = false; let toGoal = false;
    if (eff !== '7' && Array.isArray(st.targets)) {
      const r = eff === '4' ? K.backCheck(b, st.stone) : K.forwardCheck(b, st.stone, st.targets[0].steps, false);
      if (r) {
        for (const h of r.caps) { if (K.teamOf(K.seatOfStone(h)) === K.teamOf(K.seatOfStone(st.stone))) ownCapture = true; else capture = true; }
        toGoal = r.to >= K.GOAL_FIRST;
      }
    }
    if (capture && once(seen, 'capture', key)) return { text: 'Hier steht ein fremder Stein. Landest du genau darauf, wird er geschlagen und muss zurück in seinen Stall. Tippe auf das grüne Feld.', target: TARGET };
    if (ownCapture && once(seen, 'ownCapture', key)) return { text: 'Achtung: Hier steht ein Stein aus deinem Team. Auch eigene Steine werden geschlagen, wenn du genau darauf landest. Tippe auf das grüne Feld.', target: TARGET };
    if (toGoal && once(seen, 'goal', key)) return { text: 'Dieser Stein kommt in dein Ziel, die Felder zur Mitte. Im Ziel ist er sicher und darf nicht mehr überholen. Tippe auf das grüne Feld.', target: TARGET };
    if (eff === '7') return { text: `Wie viele Felder soll der Stein ziehen? Tippe auf ein grünes Feld. Die Zahl zeigt die Felder. Noch ${felder(st.left)} zu ziehen.`, target: TARGET };
    return { text: 'Tippe auf das grüne Feld, um den Zug zu machen.', target: TARGET };
  }
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
