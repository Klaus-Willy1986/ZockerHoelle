// Lernrunde für Rommé: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Stellen, die pulsieren sollen.
// Es werden nur Regeln und Knöpfe erklärt, nie Züge empfohlen und nie konkrete Karten genannt. Jede Erklärung kommt nur in einem einzigen Zugschritt.
import * as E from './engine.js';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird), und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  if (!ctx.ui.coachSeen || typeof ctx.ui.coachSeen !== 'object') ctx.ui.coachSeen = {};
  const seen = ctx.ui.coachSeen;
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}
function pick(ctx, sig, list, fallback) {
  for (const it of list) {
    if (!it.when()) continue;
    if (firstTime(ctx, it.key, sig)) return { text: it.text, target: it.target };
  }
  return fallback;
}

const HAND = '.rm-hand [data-act="card"]';
const PILES = '.rm-pile[data-from="pile"], .rm-pile[data-from="discard"]';
const ids = (a) => (Array.isArray(a) ? a.filter((x) => Number.isInteger(x) && x >= 0 && x < E.CARD_COUNT) : []);
const sets = (t) => (Array.isArray(t) ? t.filter(Array.isArray).map(ids) : null);

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || game.game !== 'rm' || !Array.isArray(game.players) || !Array.isArray(game.table) || !Array.isArray(game.pile) || !Array.isArray(game.discard)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    const p = game.players[me];
    if (!p || !Array.isArray(p.hand)) return null;
    if (game.phase === 'over') {
      return { text: 'Die Runde ist zu Ende. Wer alle Karten los ist, bekommt die Restkarten der anderen als Punkte. Tippe auf „Nächste Runde“, wenn du weiterüben willst.', target: '[data-act="next"]' };
    }
    if (game.phase !== 'play') return null;
    if (game.active !== me) {
      const sig = `o${game.round}|${game.plies}|${game.turn}`;
      return pick(ctx, sig, [
        { key: 'opp', when: () => true, text: 'Jetzt ist der Computer dran. Schau einfach zu. Was er getan hat, steht gleich oben.', target: '.rm-opps' },
      ], { text: 'Jetzt ist der Computer dran. Schau einfach zu.', target: '.rm-opps' });
    }
    const tableN = E.tableIds(game.table).length;
    const sig = `m${game.round}|${game.plies}|${game.turn}|${tableN}|${p.hand.length}`;
    if (game.turn === 'draw') {
      return pick(ctx, sig, [
        { key: 'take', when: () => true, text: 'Du bist dran. Schritt 1: Nimm eine Karte. Tippe auf den Stapel (verdeckt) oder auf die Ablage (offene Karte).', target: PILES },
        { key: 'ablage', when: () => game.discard.length > 0, text: 'Von der Ablage nimmst du immer die oberste Karte, und du siehst vorher, welche es ist. Vom Stapel kommt eine Überraschung.', target: '.rm-pile[data-from="discard"]' },
        { key: 'steps', when: () => true, text: 'Ein Zug hat drei Schritte: Karte nehmen, Auslegen (freiwillig) und Ablegen. Der aktuelle Schritt ist gelb markiert.', target: '.rm-steps' },
      ], { text: 'Du bist dran. Nimm eine Karte vom Stapel oder von der Ablage.', target: PILES });
    }
    const sel = ids(ctx.ui.sel);
    const work = sets(ctx.ui.work) || game.table.map((s) => ids(s));
    const old = new Set(E.tableIds(game.table));
    const flat = E.tableIds(work);
    const placed = flat.filter((id) => !old.has(id)).length;
    const hasBad = work.some((s) => s.length > 0 && !E.analyzeSet(s).valid);
    let chk = null;
    try { chk = E.checkTurn(game, p.id, work); } catch { chk = null; }
    const hasJoker = p.hand.some((id) => id >= 104) || E.tableIds(game.table).some((id) => id >= 104);
    return pick(ctx, sig, [
      { key: 'bad', when: () => placed > 0 && hasBad, text: 'Rot umrandet heißt: Dieser Satz ist noch nicht gültig. Darunter steht der Grund. Zum Auslegen müssen alle Sätze gültig sein.', target: '.rm-set.bad' },
      { key: 'open40', when: () => placed > 0 && !p.melded && !hasBad && !!chk && !chk.ok, text: 'Noch zu wenig für die Eröffnung: Du brauchst neue Sätze mit zusammen mindestens 40 Punkten. Die Summe steht unter dem Tisch.', target: '.rm-open' },
      { key: 'meld', when: () => placed > 0 && !!chk && chk.ok, text: 'Alle Sätze sind gültig. Mit „Auslegen“ legst du sie auf den Tisch. Mit „Alles zurücksetzen“ fängst du neu an.', target: '[data-act="meld"]' },
      { key: 'newset', when: () => sel.length > 0, text: 'Mit „Neuer Satz“ legst du alle markierten Karten als Satz auf den Tisch. Mehrere Karten markierst du nacheinander.', target: '[data-act="newset"]' },
      { key: 'back', when: () => placed > 0, text: 'Mit „Zurück in die Hand“ nimmst du markierte Karten zurück, die du gerade erst hingelegt hast.', target: '[data-act="back"]' },
      { key: 'tap', when: () => true, text: 'Tippe eine Karte in deiner Hand an: Sie wird markiert und hebt sich. Nochmal tippen nimmt die Markierung weg.', target: HAND },
      { key: 'kinds', when: () => true, text: 'Ein Satz braucht 3 Karten oder mehr. Folge: eine Farbe, Werte nacheinander. Satz: gleicher Wert, jede Farbe nur einmal.', target: HAND },
      { key: 'open', when: () => !p.melded, text: 'Dein erstes Auslegen heißt Eröffnung: Neue Sätze mit zusammen mindestens 40 Punkten. Das Ass zählt 11, Bilder 10, Zahlen ihre Augen.', target: '.rm-open, .rm-live' },
      { key: 'discard', when: () => true, text: 'Schritt 3: Markiere eine Karte und tippe auf „Ablegen“. Die Karte kommt auf die Ablage und dein Zug ist zu Ende.', target: '[data-act="discard"]' },
      { key: 'attach', when: () => !!p.melded && game.table.length > 0, text: 'Du hast eröffnet: Jetzt kannst du Karten an Sätze auf dem Tisch anlegen. Karte markieren, beim Satz „Hierhin legen“ tippen.', target: '[data-act="here"]' },
      { key: 'rearr', when: () => !!p.melded && game.table.length > 0, text: 'Du darfst auch Karten zwischen Sätzen umlegen. Am Ende müssen alle Sätze gültig sein, und keine Karte darf den Tisch verlassen.', target: '.rm-table .rm-c' },
      { key: 'joker', when: () => hasJoker, text: 'Der Joker (Stern) ersetzt eine beliebige Karte. In jedem Satz darf aber nur ein Joker liegen.', target: '.rm-joker' },
      { key: 'last', when: () => Array.isArray(game.lastPlayed) && game.lastPlayed.length > 0, text: 'Orange umrandete Karten wurden zuletzt gelegt. Grün umrandet sind deine gerade ausgelegten Karten.', target: '.rm-c.last, .rm-table' },
      { key: 'end', when: () => p.hand.length <= 6, text: 'Die Runde endet, wenn jemand seine letzte Karte los ist. Die Restkarten der anderen zählen dann als Pluspunkte für diese Person.', target: '.rm-hand' },
    ], { text: 'Du bist dran. Markiere Karten in deiner Hand, oder lege eine Karte ab.', target: HAND });
  } catch {
    return null;
  }
}
