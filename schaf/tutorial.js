// Schafskopp – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. In der Lernrunde sind Hinweise erlaubt (Ziel-Markierung).
import * as M from './engine.js';

const FLIP = '[data-act=flip]';
const CENTER = '[data-act=place-center]';
const OWN = '[data-act=place-own]';
const otherSel = (pid) => `[data-act=place-other][data-pid="${pid}"]`;

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
  if (!g || typeof g !== 'object' || g.game !== 'sk' || !Array.isArray(g.players) || !Array.isArray(g.rows) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    const r = g.result || {};
    const head = r.winners && r.winners.includes(me.id) ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Wer zuerst alle Karten los ist, gewinnt. Wer am Ende die meisten Karten hat, ist der Schafskopp des Spiels. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`, target: '[data-act=again]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.moves].join('|');
  const last = g.last && typeof g.last === 'object' ? g.last : null;

  if (last && last.penalty && once(ctx, 'penalty', sig)) {
    return { text: last.penalty.pid === me.id
      ? 'Schafskopp! Du hast gepennt und bekommst von jedem eine Karte. Dein Zug ist damit zu Ende.'
      : 'Schafskopp! Der Computer hat gepennt und bekommt von jedem eine Karte, auch von dir.' };
  }

  if (ap.id !== me.id) return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };

  const src = g.source;
  if (src === 'flipped' || src === 'open') {
    const card = M.curCard(g);
    if (!card) return null;
    const tg = M.targetsFor(g, card, me.id);
    const name = M.cardName(card);
    if (src === 'open' && once(ctx, 'law1', sig)) {
      return { text: 'Erst deine offene Karte prüfen: Passt sie in die Mitte oder bei jemand anderem, musst du sie zuerst dorthin legen. Erst wenn sie nirgends passt, deckst du auf. Tippe auf das Ziel.', target: tg.center ? CENTER : otherSel(tg.others[0]) };
    }
    if (tg.center) {
      if (card.r === M.START && once(ctx, 'eleven', sig)) {
        return { text: `Du hast ${name} aufgedeckt. Eine Elf darf immer in die Mitte und eröffnet die Reihe ihrer Farbe. Immer zuerst die Mitte prüfen. Tippe auf In die Mitte.`, target: CENTER };
      }
      if (once(ctx, 'center', sig)) {
        return { text: `Du hast ${name} aufgedeckt. Sie passt an eine Reihe in der Mitte: gleiche Farbe und eine Zahl höher oder tiefer am Ende. Wer die Mitte übersieht, ist der Schafskopp. Tippe auf In die Mitte.`, target: CENTER };
      }
      return { text: `${name}: Die Karte passt in die Mitte. Tippe auf In die Mitte.`, target: CENTER };
    }
    if (tg.others.length) {
      if (once(ctx, 'other', sig)) {
        return { text: `${name} passt nicht in die Mitte, aber bei dem Computer: gleiche Farbe und genau eins höher oder tiefer als seine offene Karte. Das heißt aufdrücken. Tippe auf seine offene Karte.`, target: otherSel(tg.others[0]) };
      }
      return { text: `${name}: Die Karte passt bei dem Computer. Tippe auf seine offene Karte.`, target: otherSel(tg.others[0]) };
    }
    if (once(ctx, 'own', sig)) {
      return { text: `${name} passt weder in die Mitte noch bei jemand anderem. Dann legst du sie bei dir ab. Danach ist dein Zug zu Ende. Tippe auf Bei mir ablegen.`, target: OWN };
    }
    return { text: `${name} passt nirgends. Tippe auf Bei mir ablegen.`, target: OWN };
  }

  if (me.deck.length) {
    if (once(ctx, 'intro', sig)) return { text: 'Vor dir liegt dein verdeckter Stapel. Tippe darauf, um die oberste Karte aufzudecken. Danach entscheidest du, wohin sie kommt.', target: FLIP };
    return { text: 'Deine offene Karte passt nirgends. Tippe auf deinen Stapel, um aufzudecken.', target: FLIP };
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
