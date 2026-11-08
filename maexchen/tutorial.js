// Mäxchen – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Zugempfehlungen: erklärt wird, was die Knöpfe tun,
// nie, was man ansagen oder ob man glauben soll.
import * as M from './engine.js';

const ROLL = '[data-act=roll]';
const LIFT = '[data-act=lift]';
const SAY = '[data-act=say]';
const DECIDE = '[data-act=believe],[data-act=doubt]';
const DOUBT = '[data-act=doubt]';
const NEXT = '[data-act=next]';

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
    return { text: `${head} Wer kein Leben mehr hat, ist raus. Wer als Letzte oder Letzter noch Leben hat, gewinnt. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`, target: '[data-act=again]' };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.moves].join('|');
  const mine = ap.id === me.id;

  if (g.phase === 'reveal') {
    const l = g.last && typeof g.last === 'object' ? g.last : null;
    if (l && l.kind === 'reveal') {
      if (l.out && once(ctx, 'out', sig)) {
        return { text: 'Wer kein Leben mehr hat, ist raus. Es spielen nur noch die anderen weiter. Tippe auf Weiter.', target: NEXT };
      }
      if (l.loss === 2 && once(ctx, 'maex-lost', sig)) {
        return { text: 'Ein angesagtes Mäxchen kostet zwei Leben. Wer richtig lag, verliert nichts. Das Leben-Symbol zeigt dir den neuen Stand. Tippe auf Weiter.', target: NEXT };
      }
      if (once(ctx, 'reveal', sig)) {
        return { text: 'Der Becher ist offen und der echte Wurf zählt. War er niedriger als die Ansage, wurde gelogen und die ansagende Person verliert ein Leben. Sonst verliert die zweifelnde Person ein Leben. Tippe auf Weiter.', target: NEXT };
      }
    }
    return { text: 'Wer ein Leben verloren hat, fängt die nächste Runde an. Tippe auf Weiter.', target: NEXT };
  }

  if (g.phase === 'roll') {
    if (!mine) return { text: 'Jetzt würfelt der Computer unter seinem Becher. Du siehst seinen Wurf nicht. Warte einen Moment.' };
    if (g.announced !== null && once(ctx, 'rollafter', sig)) {
      return { text: 'Du hast der Ansage geglaubt. Jetzt würfelst du selbst unter dem Becher und musst danach einen höheren Wert ansagen. Tippe auf Würfeln.', target: ROLL };
    }
    if (once(ctx, 'roll', sig)) {
      return { text: 'Du würfelst mit zwei Würfeln unter einem Becher. Nur du darfst hineinsehen. Der höchste Wurf ist das Mäxchen, eine 2 und eine 1. Tippe auf Würfeln.', target: ROLL };
    }
    return { text: 'Tippe auf Würfeln.', target: ROLL };
  }

  if (g.phase === 'announce') {
    if (!mine) return { text: 'Der Computer hat gewürfelt und überlegt, was er ansagt. Er darf auch schwindeln.' };
    const lifted = !!(ctx.ui && ctx.ui.lifted);
    if (!lifted) {
      if (once(ctx, 'lift', sig)) return { text: 'Der Becher ist noch zu. Tippe auf Becher anheben, dann siehst du deinen Wurf. Niemand sonst sieht ihn.', target: LIFT };
      return { text: 'Tippe auf Becher anheben, um deinen Wurf zu sehen.', target: LIFT };
    }
    if (g.cup === M.MAEXCHEN && once(ctx, 'maex-real', sig)) {
      return { text: 'Du hast ein Mäxchen gewürfelt, den höchsten Wurf. Du musst es nicht ansagen. Wähle eine Zahl und tippe auf Ansagen.', target: SAY };
    }
    if (once(ctx, 'say', sig)) {
      return { text: 'Sage jetzt einen Wert an. Er muss höher sein als die letzte Ansage. Du darfst ehrlich sein oder schwindeln. Die höhere Augenzahl steht vorn, 4 und 2 ist 42. Tippe auf Ansagen.', target: SAY };
    }
    return { text: 'Wähle eine Zahl und tippe auf Ansagen.', target: SAY };
  }

  if (g.phase === 'decide') {
    if (!mine) return { text: 'Jetzt überlegt der Computer, ob er dir glaubt.' };
    if (g.announced === M.MAEXCHEN && once(ctx, 'maex-decide', sig)) {
      return { text: 'Ein Mäxchen ist nicht zu überbieten, darum kannst du ihm nicht glauben. Du musst aufdecken. Stimmt es, verlierst du zwei Leben. War es gelogen, verliert der Computer zwei.', target: DOUBT };
    }
    if (g.announced === M.MAEXCHEN) return { text: 'Bei einem Mäxchen musst du aufdecken.', target: DOUBT };
    if (once(ctx, 'decide', sig)) {
      return { text: 'Jetzt entscheidest du. Glauben heißt: Du würfelst selbst und musst höher ansagen. Aufdecken heißt: Der Becher wird gelüftet und der echte Wurf zeigt, wer recht hat.', target: DECIDE };
    }
    return { text: 'Tippe auf Glauben oder Aufdecken.', target: DECIDE };
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
