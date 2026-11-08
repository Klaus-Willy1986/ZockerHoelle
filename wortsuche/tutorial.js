// Wortsuche – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie.
// ctx = { id, ui } mit ui.start (gerade gewähltes Anfangsfeld, -1 = keins) und ui.coachSeen (merkt gezeigte Erklärungen).
// Erlaubt (nur in der Lernrunde): Das Ziel ist der Anfangs- bzw. Endbuchstabe eines gesuchten Wortes. Das ist eine
// Bedienhilfe für das Üben, keine Strategie: Die Wörter stehen nie im Zug, nur zum Kennenlernen der zwei Tipps.
// Jede Erklärung gehört zu einer Lage (Zahl meiner gefundenen Wörter) und kommt deshalb nur einmal vor.
import { wordCells } from './engine.js';

function once(ctx, key, sig) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (!(key in ui.coachSeen)) ui.coachSeen[key] = sig;
    return ui.coachSeen[key] === sig;
  } catch { return false; }
}

const END = 'Geschafft! Die Lernrunde ist zu Ende. Du kannst jetzt eine richtige Runde spielen.';
const cellSel = (i) => `.ws-cell[data-i="${i}"]`;

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !Array.isArray(g.words) || !Number.isInteger(g.n)) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (!ctx || typeof ctx !== 'object') return null;
  const me = g.players.findIndex((p) => p && p.id === ctx.id);
  if (me < 0) return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const start = Number.isInteger(ui.start) && ui.start >= 0 ? ui.start : -1;
  const open = g.words.map((x, k) => (x && x.by < 0 ? k : -1)).filter((k) => k >= 0);
  if (!open.length) return null;
  const mine = g.words.filter((x) => x && x.by === me).length;
  const rivals = g.players.length > 1;
  const ends = (k) => { const c = wordCells(g.n, g.words[k]); return [c[0], c[c.length - 1]]; };

  // Ein Anfangsfeld ist gewählt: Ziel ist das andere Ende des Wortes
  if (start >= 0) {
    for (const k of open) {
      const [a, b] = ends(k);
      if (a === start || b === start) {
        const other = a === start ? b : a;
        if (mine === 0 && once(ctx, 'second', 0)) {
          return { text: 'Gut! Jetzt tippe auf den letzten Buchstaben desselben Wortes. Dann zeichnet das Spiel eine bunte Linie. Im leichten Spiel stehen die Wörter nach rechts oder nach unten.', target: cellSel(other) };
        }
        return { text: 'Tippe jetzt auf den letzten Buchstaben des Wortes.', target: cellSel(other) };
      }
    }
    return { text: 'Das ist kein Wortanfang aus der Liste. Tippe nochmal auf dasselbe Feld, dann kannst du neu anfangen.' };
  }

  // Nichts gewählt: Ziel ist der Anfang des nächsten gesuchten Wortes (zum Üben der zwei Tipps)
  const cell = cellSel(ends(open[0])[0]);
  if (mine === 0 && once(ctx, 'intro', 0)) {
    return { text: 'Willkommen! Im Gitter sind Wörter versteckt. Sie stehen in der Liste unter dem Gitter. Tippe auf den ersten Buchstaben eines Wortes. Er ist hier markiert.', target: cell };
  }
  if (mine === 1 && once(ctx, 'found', 1)) {
    return { text: 'Gefunden! Die Linie bleibt bunt, und das Wort in der Liste ist durchgestrichen. Du bekommst 10 Punkte. Such jetzt das nächste Wort.', target: `#ws-list, ${cell}` };
  }
  if (mine === 2 && once(ctx, 'wett', 2)) {
    return rivals
      ? { text: 'Der Computer sucht mit. Wer ein Wort zuerst findet, bekommt die 10 Punkte. Die Punkte stehen unter der Wortliste.', target: `#ws-score, ${cell}` }
      : { text: 'Die Punkte stehen unter der Wortliste. Jedes Wort bringt 10 Punkte.', target: `#ws-score, ${cell}` };
  }
  if (mine === 3 && once(ctx, 'dirs', 3)) {
    return { text: 'Gleich geschafft! In schwereren Spielen stehen Wörter auch schräg und rückwärts. Das Prinzip bleibt gleich: erst Anfang, dann Ende.', target: cell };
  }
  return { text: 'Such das nächste Wort aus der Liste. Tippe auf seinen ersten Buchstaben.', target: cell };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
