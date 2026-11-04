// Pasch & Straße – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as P from './engine.js';

const WORT = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];
const wort = (n) => WORT[n] || String(n);

// Eine Erklärung bleibt sichtbar, solange sich der Zustand (sig) nicht ändert, und kommt danach nie wieder.
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

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  if (ui.rolling) return { text: 'Die Würfel rollen.' };
  const ap = g.players[g.active];
  const t = g.turn;
  if (!ap || !t || !ctx) return null;
  if (ap.id !== ctx.id) return { text: 'Bitte einen Moment Geduld. Gleich bist du wieder dran.' };

  const sig = g.rollId;
  const mal = `${wort(P.MAX_ROLLS)}mal`;

  if (t.rolls === 0) {
    if (once(ctx, 'start', sig)) return { text: 'Du füllst Feld für Feld deinen Zettel. Tippe jetzt auf Würfeln.', target: '[data-act=roll]' };
    return { text: 'Tippe auf Würfeln.', target: '[data-act=roll]' };
  }

  if (!Array.isArray(t.dice) || t.dice.length !== P.NUM_DICE) return null;
  const me = ap;
  const sheet = me.sheet || {};

  // Ein Feld ist angetippt und wartet auf die Bestätigung
  const pick = ui.pick;
  const def = typeof pick === 'string' ? P.catOf(pick) : null;
  if (def && sheet[def.id] == null) {
    const pts = P.scoreFor(def.id, t.dice);
    const main = pts === 0
      ? `Das passt nicht zu deinem Wurf. Das Feld ${def.name} wird mit null Punkten gestrichen. Tippe auf Ja, hier eintragen.`
      : `Das Feld ${def.name} bringt dir ${pts} Punkte. Tippe auf Ja, hier eintragen.`;
    const pre = once(ctx, 'confirm', sig) ? 'Mit Ja trägst du das Feld ein. Mit Zurück wählst du ein anderes. ' : '';
    return { text: pre + main, target: '[data-act=pick-yes]' };
  }

  // Bonus: wird mit diesem Wurf oben die Grenze erreichbar?
  const up = P.upperSum(sheet);
  const bonusReachable = up < P.BONUS_LIMIT && P.CATS.some((c) => c.upper && sheet[c.id] == null && up + P.scoreFor(c.id, t.dice) >= P.BONUS_LIMIT);
  const preFields = 'Rechts bei jedem Feld steht, wie viele Punkte es mit deinem Wurf bringt. ';
  const preBonus = `Mit diesem Wurf kannst du oben ${P.BONUS_LIMIT} Punkte erreichen. Ab ${P.BONUS_LIMIT} Punkten oben gibt es ${P.BONUS} Bonuspunkte. `;

  if (t.rolls >= P.MAX_ROLLS) {
    let pre = '';
    if (once(ctx, 'fields', sig)) pre = preFields;
    else if (bonusReachable && once(ctx, 'bonus', sig)) pre = preBonus;
    return { text: `${pre}Das war dein letzter Wurf. Wähle jetzt ein Feld auf deinem Zettel.`, target: '[data-act=pick]' };
  }

  const keep = Array.isArray(ui.keep) ? ui.keep : [];
  const rest = P.NUM_DICE - keep.filter(Boolean).length;
  if (rest === 0) {
    return { text: 'Mindestens ein Würfel muss neu gewürfelt werden. Tippe auf einen Würfel, um ihn wieder abzuwählen.', target: '[data-act=toggle]' };
  }
  const base = 'Tippe auf die Würfel, die du behalten willst, und dann auf neu würfeln. Oder wähle gleich ein Feld.';
  let pre = '';
  if (once(ctx, 'reroll', sig)) pre = `Du darfst in jedem Zug bis zu ${mal} würfeln. `;
  else if (once(ctx, 'fields', sig)) pre = preFields;
  else if (bonusReachable && once(ctx, 'bonus', sig)) pre = preBonus;
  return { text: pre + base, target: '[data-act=reroll]:not([disabled]), [data-act=pick]' };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
