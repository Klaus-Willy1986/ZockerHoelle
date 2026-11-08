// Bunco – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Es gibt keine Entscheidungen, also auch keine Zugempfehlungen:
// erklärt wird nur, was die Knöpfe und Zahlen bedeuten.
import * as M from './engine.js';

const ROLL = '[data-act=roll]';
const NEXT = '[data-act=next]';
const TARGET = '.bc-target';

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
  if (!g || typeof g !== 'object' || g.game !== M.GAME || !Array.isArray(g.players) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    const win = g.result && Array.isArray(g.result.winners) && g.result.winners.includes(me.id);
    const head = win ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Nach sechs Runden zählen zuerst die Rundensiege, danach die Gesamtpunkte. Tippe auf Noch eine Partie, wenn du weiterspielen möchtest.`, target: '[data-act=again]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.moves].join('|');
  const mine = ap.id === me.id;
  const l = g.last && typeof g.last === 'object' && g.last.kind === 'roll' ? g.last : null;

  if (g.phase === 'between') {
    if (l && l.bunco && once(ctx, 'bunco', sig)) {
      return { text: 'Bunco! Drei Würfel mit der Zielzahl sind 21 Punkte auf einmal, und die Runde ist sofort zu Ende. Tippe auf Weiter für die nächste Runde.', target: NEXT };
    }
    if (once(ctx, 'goal', sig)) {
      return { text: 'Wer in einer Runde 21 Punkte erreicht, beendet sie. Wer in der Runde die meisten Punkte hat, bekommt einen Pokal. Die Pokale siehst du in der Punktetafel. Tippe auf Weiter.', target: NEXT };
    }
    return { text: 'Tippe auf Weiter für die nächste Runde. Die Zielzahl wird um eins größer.', target: NEXT };
  }

  if (g.phase === 'roll') {
    if (!mine) {
      if (l && l.pid === me.id && l.points === 0 && once(ctx, 'miss', sig)) {
        return { text: 'Kein Treffer: Dann ist die nächste Person dran. Jetzt würfelt der Computer. Warte einen Moment.', target: TARGET };
      }
      return { text: 'Jetzt würfelt der Computer. Warte einen Moment.' };
    }
    if (g.rolls === 0 && g.round === 1 && once(ctx, 'roll1', sig)) {
      return { text: 'Oben steht die Zielzahl dieser Runde. Jeder Würfel, der diese Zahl zeigt, zählt einen Punkt. Du würfelst mit drei Würfeln. Tippe auf Würfeln.', target: ROLL };
    }
    if (g.rolls === 0 && g.round > 1 && once(ctx, 'newround', sig)) {
      return { text: 'Eine neue Runde hat begonnen, die Zielzahl ist jetzt eine andere. Die Punkte dieser Runde fangen bei null an, deine Rundensiege bleiben. Tippe auf Würfeln.', target: ROLL };
    }
    if (l && l.pid === me.id && l.mini && once(ctx, 'mini', sig)) {
      return { text: 'Mini-Bunco: Drei gleiche Würfel einer anderen Zahl bringen 5 Punkte. Weil du gepunktet hast, darfst du noch einmal würfeln.', target: ROLL };
    }
    if (l && l.pid === me.id && l.points > 0 && once(ctx, 'again', sig)) {
      return { text: 'Treffer! Wer Punkte macht, darf gleich noch einmal würfeln. Ohne Treffer ist die nächste Person dran. Tippe auf Würfeln.', target: ROLL };
    }
    return { text: 'Tippe auf Würfeln.', target: ROLL };
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
