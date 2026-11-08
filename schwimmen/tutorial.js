// Schwimmen – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as M from './engine.js';

const HAND = '.sw-hand [data-act=hand]';
const TABLE = '.sw-table [data-act=table]';

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

// Reihenfolge der Erklärungen an meinen freien Zügen (jede genau einmal)
const TOPICS = [
  ['intro', 'Du hast drei Karten, drei liegen offen auf dem Tisch. Es zählen Karten einer Farbe. Das Ass zählt elf, Bild und Zehn je zehn. Dein Handwert steht bei deinen Karten. Tippe auf eine deiner Karten.', HAND],
  ['swap', 'So tauschst du eine Karte: Tippe erst auf eine deiner Karten, dann auf eine Tischkarte. Die beiden wechseln den Platz. Tippe jetzt auf eine deiner Karten.', HAND],
  ['swap3', 'Mit dem Knopf Alle drei tauschen nimmst du alle drei Tischkarten, deine Karten liegen danach auf dem Tisch. Heute tauschst du einzeln. Tippe auf eine deiner Karten.', HAND],
  ['pass', 'Mit dem Knopf Schieben tauschst du nichts. Wenn alle nacheinander geschoben haben, kommen drei neue Karten auf den Tisch. Tippe auf eine deiner Karten.', HAND],
  ['lives', 'Jede Person hat drei Leben, als Bierkrüge neben dem Namen. Das niedrigste Blatt verliert ein Leben. Ohne Leben schwimmst du, noch einmal verlieren heißt ausscheiden. Tippe auf eine deiner Karten.', HAND],
  ['thirtyone', 'Ass, Zehn und noch eine Zehnerkarte in einer Farbe sind 31. Dann tippst du auf 31 ansagen und alle anderen verlieren ein Leben. Tippe auf eine deiner Karten.', HAND],
  ['knock', 'Mit Klopfen sagst du, dass du aufhören möchtest. Danach hat jede andere Person noch einen Zug, dann werden alle Karten aufgedeckt. Probiere es aus und tippe auf Klopfen.', '[data-act=knock]'],
];

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'sw' || !Array.isArray(g.players) || !Array.isArray(g.table) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};

  if (g.phase === 'over') {
    const r = g.result || {};
    if (r.final) {
      const head = Array.isArray(r.champions) && r.champions.includes(me.id) && !r.draw ? 'Du hast das ganze Spiel gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende.';
      return { text: `${head} Tippe auf Neues Spiel, wenn du weiterspielen möchtest.`, target: '[data-act=again]' };
    }
    let how = 'Alle Karten sind aufgedeckt.';
    if (r.kind === '31') how = r.caller === me.id ? 'Du hast 31 angesagt.' : 'Der Computer hat 31 angesagt.';
    return { text: `${how} Wer verloren hat, verliert Leben, du siehst es unten bei den Händen. Tippe auf Nächste Runde, wenn du weiterspielen möchtest.`, target: '[data-act=next]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.round, g.moves, g.active].join('|');

  if (ap.id !== me.id) {
    if (g.knocker === me.id) return { text: 'Du hast geklopft. Jetzt hat der Computer noch einen Zug, dann werden alle Karten aufgedeckt. Schau einfach zu.' };
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  const selH = Number.isInteger(ui.selH) ? ui.selH : null;
  const selT = Number.isInteger(ui.selT) ? ui.selT : null;
  if (selH !== null) return { text: 'Gut. Tippe jetzt auf die Tischkarte, die du dafür nehmen möchtest.', target: TABLE };
  if (selT !== null) return { text: 'Gut. Tippe jetzt auf die Karte aus deiner Hand, die du dafür abgibst.', target: HAND };

  if (g.knocker !== null && g.knocker !== me.id && once(ctx, 'botKnocked', sig)) {
    return { text: 'Der Computer hat geklopft. Du hast jetzt noch einen letzten Zug, danach werden alle Karten aufgedeckt. Tippe auf eine deiner Karten.', target: HAND };
  }
  for (const [key, text, target] of TOPICS) {
    if (key === 'knock' && g.knocker !== null) continue;
    if (once(ctx, key, sig)) return { text, target };
  }
  if (g.knocker === null) return { text: 'Du bist dran. Tippe auf eine deiner Karten oder wähle einen Knopf.', target: HAND };
  return { text: 'Das ist dein letzter Zug. Tippe auf eine deiner Karten.', target: HAND };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
