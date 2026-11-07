// Lernrunde für Reihen & Gruppen: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Stellen, die pulsieren sollen.
// Es werden nur Regeln und Knöpfe erklärt, nie Züge empfohlen und nie konkrete Steine genannt. Jede Erklärung kommt nur in einem einzigen Zug.
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

const HAND = '.rg-hand [data-act="tile"]';
const ids = (a) => (Array.isArray(a) ? a.filter((x) => Number.isInteger(x) && x >= 0 && x < E.TILE_COUNT) : []);
const sets = (t) => (Array.isArray(t) ? t.filter(Array.isArray).map(ids) : null);

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || game.game !== 'rg' || !Array.isArray(game.players) || !Array.isArray(game.table) || !Array.isArray(game.pile)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    const p = game.players[me];
    if (game.phase === 'over') {
      return { text: 'Die Runde ist zu Ende. Wer alle Steine gelegt hat, bekommt die Reststeine der anderen als Punkte. Tippe auf „Nächste Runde“, wenn du weiterüben willst.', target: '[data-act="next"]' };
    }
    if (game.phase !== 'play') return null;
    if (game.active !== me) {
      const sig = `o${game.round}|${game.pile.length}|${E.tableIds(game.table).length}`;
      return pick(ctx, sig, [
        { key: 'opp', when: () => true, text: 'Jetzt ist der Computer dran. Schau einfach zu. Was er getan hat, steht gleich oben.', target: '.rg-opps' },
      ], { text: 'Jetzt ist der Computer dran. Schau einfach zu.', target: '.rg-opps' });
    }
    // Eigener Zug
    const sig = `m${game.round}|${game.pile.length}|${E.tableIds(game.table).length}|${game.passes}`;
    const sel = ids(ctx.ui.sel);
    const work = sets(ctx.ui.work) || game.table.map((s) => ids(s));
    const old = new Set(E.tableIds(game.table));
    const flat = E.tableIds(work);
    const placed = flat.filter((id) => !old.has(id)).length;
    const hasBad = work.some((s) => s.length > 0 && !E.analyzeSet(s).valid);
    let chk = null;
    try { chk = E.checkTurn(game, p.id, work); } catch { chk = null; }
    const hasJoker = p.hand.some((id) => id >= 104) || E.tableIds(game.table).some((id) => id >= 104);
    const empty = game.pile.length === 0;
    return pick(ctx, sig, [
      { key: 'bad', when: () => placed > 0 && hasBad, text: 'Rot umrandet heißt: Dieser Satz ist noch nicht gültig. Darunter steht der Grund. Zum Legen müssen alle Sätze gültig sein.', target: '.rg-set.bad' },
      { key: 'open30', when: () => placed > 0 && !p.melded && !hasBad && !!chk && !chk.ok, text: 'Noch zu wenig für die Eröffnung: Du brauchst neue Sätze mit zusammen mindestens 30 Punkten. Die Summe steht unter dem Tisch.', target: '.rg-open' },
      { key: 'play', when: () => placed > 0 && !!chk && chk.ok, text: 'Alle Sätze sind gültig. Mit „Legen“ beendest du deinen Zug. Mit „Alles zurücksetzen“ fängst du neu an.', target: '[data-act="play"]' },
      { key: 'newset', when: () => sel.length > 0, text: 'Mit „Neuer Satz“ legst du alle markierten Steine als Satz auf den Tisch. Mehrere Steine markierst du nacheinander.', target: '[data-act="newset"]' },
      { key: 'back', when: () => placed > 0, text: 'Mit „Zurück in die Hand“ nimmst du markierte Steine zurück, die du in diesem Zug gelegt hast.', target: '[data-act="back"]' },
      { key: 'tap', when: () => true, text: 'Tippe einen Stein in deiner Hand an: Er wird markiert und hebt sich. Nochmal tippen nimmt die Markierung weg.', target: HAND },
      { key: 'kinds', when: () => true, text: 'Ein Satz braucht 3 Steine oder mehr. Reihe: eine Farbe, Zahlen nacheinander. Gruppe: gleiche Zahl, jede Farbe nur einmal.', target: HAND },
      { key: 'open', when: () => !p.melded, text: 'Dein erster Zug heißt Eröffnung: Neue Sätze mit zusammen mindestens 30 Punkten. Jeder Stein zählt so viel wie seine Zahl.', target: '.rg-open, .rg-live' },
      { key: 'draw', when: () => !empty, text: 'Mit „Stein ziehen“ nimmst du einen Stein vom Stapel, dann ist der Nächste dran. Das geht nur, wenn du noch nichts gelegt hast.', target: '[data-act="draw"]' },
      { key: 'attach', when: () => !!p.melded && game.table.length > 0, text: 'Du hast eröffnet: Jetzt kannst du Steine an Sätze auf dem Tisch anlegen. Stein markieren, beim Satz „Hierhin legen“ tippen.', target: '[data-act="here"]' },
      { key: 'rearr', when: () => !!p.melded && game.table.length > 0, text: 'Auf dem Tisch darfst du Sätze teilen, auflösen und Steine umlegen. Am Ende müssen alle Sätze gültig sein und ein Stein aus deiner Hand neu dazukommen.', target: '[data-act="split"], [data-act="dissolve"]' },
      { key: 'joker', when: () => hasJoker, text: 'Der Joker (Stern) ersetzt einen beliebigen Stein. Jeder Satz braucht aber mindestens einen echten Stein.', target: '.rg-joker' },
      { key: 'last', when: () => Array.isArray(game.lastPlayed) && game.lastPlayed.length > 0, text: 'Orange umrandete Steine wurden zuletzt gelegt. Grün umrandet sind deine in diesem Zug gelegten Steine.', target: '.rg-t.last, .rg-table' },
      { key: 'pass', when: () => empty, text: 'Der Stapel ist leer: Wenn du nicht legen kannst, tippst du auf „Passen“. Passen alle hintereinander, endet die Runde.', target: '[data-act="draw"]' },
      { key: 'end', when: () => p.hand.length <= 6 || game.pile.length <= 12, text: 'Die Runde endet, wenn jemand alle Steine gelegt hat. Die Reststeine der anderen zählen dann als Pluspunkte für diese Person.', target: '.rg-hand' },
    ], { text: 'Du bist dran. Markiere Steine in deiner Hand oder tippe auf „Stein ziehen“.', target: HAND });
  } catch {
    return null;
  }
}
