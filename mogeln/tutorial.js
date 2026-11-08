// Mogeln – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Zugempfehlungen: erklärt wird, was die Knöpfe tun,
// nie, welche Karten man legen oder ob man glauben oder zweifeln soll.
import * as M from './engine.js';

const CARD = '[data-act=card]';
const PLAY = '[data-act=play]';
const DECIDE = '[data-act=believe],[data-act=call]';
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

const plural = (r) => (Number.isInteger(r) ? M.rankPlural(r) : '?');

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== M.GAME || !Array.isArray(g.players) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    const win = g.result && g.result.winner === me.id;
    const head = win ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Die Runde ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Wer zuerst keine Karten mehr hat und den Zweifel übersteht, gewinnt. Tippe auf Nächste Runde, wenn du weiterspielen möchtest.`, target: NEXT };
  }

  const ap = g.players[g.active];
  if (!ap) return null;
  const sig = [g.gid, g.moves].join('|');
  const mine = ap.id === me.id;
  const lp = g.lastPlay && typeof g.lastPlay === 'object' ? g.lastPlay : null;

  if (g.phase === 'reveal') {
    const l = g.last && typeof g.last === 'object' && g.last.kind === 'reveal' ? g.last : null;
    if (l && l.takerId === me.id && once(ctx, 'took', sig)) {
      return { text: 'Du musst den ganzen Stapel nehmen. Alle Karten daraus sind jetzt auf deiner Hand. Wer viele Karten hat, braucht länger bis zum Sieg. Tippe auf Weiter.', target: NEXT };
    }
    if (l && once(ctx, 'reveal', sig)) {
      return { text: 'Die zuletzt gelegten Karten sind aufgedeckt. War mindestens eine nicht vom angesagten Rang, nimmt die Person, die sie gelegt hat, den ganzen Stapel. Sonst nimmt ihn die Person, die gezweifelt hat. Tippe auf Weiter.', target: NEXT };
    }
    return { text: 'Danach beginnt die Person nach der zweifelnden. Tippe auf Weiter.', target: NEXT };
  }

  if (g.phase === 'play') {
    if (!mine) return { text: 'Jetzt legt der Computer Karten verdeckt ab. Du siehst nicht, welche. Warte einen Moment.' };
    const sel = Array.isArray(ctx.ui && ctx.ui.sel) ? ctx.ui.sel.filter((c) => me.hand.includes(c)) : [];
    if (!sel.length) {
      if (once(ctx, 'first', sig)) {
        return { text: `Ziel: Wer zuerst keine Karten mehr hat, gewinnt. Du legst 1 bis 4 Karten verdeckt ab und sagst damit: Alle ${plural(g.rank)}. Du darfst auch mogeln und andere Karten legen. Tippe auf Karten in deiner Hand, um sie zu markieren.`, target: CARD };
      }
      if (me.hand.length <= M.MAX_PLAY && once(ctx, 'last', sig)) {
        return { text: `Wenn du alle Karten ablegst, muss die nächste Person entscheiden. Glaubt sie dir, hast du gewonnen. Zweifelt sie und alles stimmt, gewinnst du ebenfalls. Angesagt wird: Alle ${plural(g.rank)}.`, target: CARD };
      }
      return { text: `Angesagt wird: Alle ${plural(g.rank)}. Tippe auf Karten, die du ablegen möchtest.`, target: CARD };
    }
    if (once(ctx, 'marked', sig)) {
      return { text: 'Markierte Karten sind angehoben. Tippe noch einmal darauf, um die Markierung zu löschen. Mehr als 4 Karten gehen nicht. Tippe dann auf Karten legen.', target: PLAY };
    }
    return { text: 'Tippe auf Karten legen.', target: PLAY };
  }

  if (g.phase === 'decide') {
    if (!mine) return { text: 'Jetzt überlegt der Computer, ob er dir glaubt oder Mogler ruft.' };
    const n = lp && Number.isInteger(lp.count) ? lp.count : 0;
    if (once(ctx, 'decide', sig)) {
      return { text: `Der Computer hat ${M.kartenZahl(n)} verdeckt gelegt und sagt: Alle ${plural(lp && lp.rank)}. Glauben heißt: Du bist selbst dran und legst den nächsten Rang. Mogler heißt: Die Karten werden aufgedeckt und es zeigt sich, wer recht hat.`, target: DECIDE };
    }
    return { text: 'Tippe auf Glauben oder auf Mogler.', target: DECIDE };
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
