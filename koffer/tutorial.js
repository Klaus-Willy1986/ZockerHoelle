// Ich packe meinen Koffer – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie.
// Keine Zugempfehlung: Erklärt wird, was die Bereiche und Knöpfe tun, nie, welches Ding man wählen soll.
// Das Ziel (target) ist immer ein ganzer Bereich (Raster, Auswahl) oder ein Knopf, nie eine einzelne Karte.
import * as E from './engine.js';

const GRID = '.kf-grid';
const OFFER = '.kf-offer';
const GO = '[data-act=fertig]';
const UNDO = '[data-act=undo]';
const NEXT = '[data-act=weiter],[data-act=ack]';
const AGAIN = '[data-act=again]';

// Eine Erklärung bleibt sichtbar, solange sich ihre Lage (sig) nicht ändert, und kommt danach nie wieder.
function once(ctx, key, sig) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (!(key in ui.coachSeen)) ui.coachSeen[key] = sig;
    return ui.coachSeen[key] === sig;
  } catch { return false; }
}

const len = (a) => (Array.isArray(a) ? a.length : 0);

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== E.GAME || !Array.isArray(g.players) || !Array.isArray(g.list) || !ctx || typeof ctx !== 'object') return null;
  const me = g.players.findIndex((p) => p && p.id === ctx.id);
  if (me < 0) return null;

  if (g.mode === 'over') {
    const full = g.result && g.result.full;
    const win = !g.players[me].out;
    const head = full ? 'Geschafft! Der Koffer ist voll.' : win ? 'Du hast gewonnen. Herzlichen Glückwunsch.' : 'Das Spiel ist zu Ende. Der Computer hat gewonnen.';
    return { text: `${head} Die Lernrunde ist zu Ende. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest. Ohne Hilfe ist der Koffer in einer richtigen Runde ganz zu.`, target: AGAIN };
  }

  const l = g.last && typeof g.last === 'object' ? g.last : null;
  const sig = `${g.gid}|${g.turnNo}`;

  if (g.phase === 'result' && l) {
    const byMe = l.by === me;
    const actor = g.players[l.by];
    if (l.ok && byMe) {
      if (once(ctx, 'ok', sig)) return { text: 'Richtig! Dein neues Ding liegt jetzt im Koffer. Alle müssen es sich ab jetzt merken, auch du. Tippe auf Weiter.', target: NEXT };
      return { text: 'Richtig! Tippe auf Weiter.', target: NEXT };
    }
    if (!l.ok && byMe) {
      if (once(ctx, 'miss', sig)) return { text: 'Das war nicht ganz richtig. Wer sich vertut, scheidet aus. Im Fenster siehst du, was im Koffer war. Tippe auf Weiter.', target: NEXT };
      return { text: 'Tippe auf Weiter.', target: NEXT };
    }
    const who = actor && E.isBotId(actor.id) ? 'Der Computer' : (actor && actor.name) || 'Die andere Person';
    if (l.ok) {
      if (once(ctx, 'other-ok', sig)) return { text: `${who} hat richtig gepackt und ein neues Ding eingepackt. Schau es dir gut an, du musst es dir merken. Tippe dann auf Weiter.`, target: NEXT };
      return { text: 'Merke dir das neue Ding. Tippe dann auf Weiter.', target: NEXT };
    }
    return { text: `${who} hat sich vertan. Tippe auf Weiter.`, target: NEXT };
  }

  const key = l ? `${g.gid}|${l.no}` : '';
  if (g.phase === 'play' && l && ctx.ui && ctx.ui.ack !== key) {
    if (once(ctx, 'unseen', key)) return { text: 'Schau dir an, was gerade eingepackt wurde, und merke es dir. Tippe dann auf Verstanden.', target: NEXT };
    return { text: 'Tippe auf Verstanden.', target: NEXT };
  }
  const cur = g.players[g.turn];
  if (!cur || cur.id !== ctx.id) {
    const who = cur && E.isBotId(cur.id) ? 'der Computer' : (cur && cur.name) || 'die andere Person';
    if (once(ctx, 'wait', sig)) return { text: `Jetzt packt ${who}. Du musst nichts tun. Der Koffer ist für dich zu: Du siehst nur, wie viele Dinge drin sind.` };
    return { text: `${who.charAt(0).toUpperCase() + who.slice(1)} ist dran. Bitte einen Moment Geduld.` };
  }

  // Ich bin dran
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const seq = len(ui.seq);
  const add = !!ui.add;
  const n = g.list.length;

  if (n === 0) {
    if (!add) {
      if (once(ctx, 'start', sig)) return { text: 'Willkommen! Wir packen zusammen einen Koffer. Du fängst an: Er ist noch leer. Wähle bei Packe etwas Neues ein ein Ding aus.', target: OFFER };
      return { text: 'Wähle bei Packe etwas Neues ein ein Ding aus.', target: OFFER };
    }
    return { text: 'Gut. Tippe jetzt auf Fertig. Dann liegt dein Ding im Koffer.', target: GO };
  }

  if (seq === 0 && !add && once(ctx, 'folge', sig)) {
    return { text: 'Jetzt bist du wieder dran. Tippe alle Dinge, die schon im Koffer sind, in der richtigen Reihenfolge an. In der Lernrunde siehst du sie oben, in einer richtigen Runde ist der Koffer zu.', target: GRID };
  }
  if (seq >= 1 && seq < n && once(ctx, 'zurueck', sig)) {
    return { text: 'Falsch getippt? Mit Zurück nimmst du das zuletzt gewählte Ding wieder weg.', target: UNDO };
  }
  if (seq < n) return { text: `Tippe die Dinge der Reihe nach an. Bisher: ${seq} von ${n}.`, target: GRID };
  if (!add) {
    if (once(ctx, 'neu', sig)) return { text: 'Alles gewählt. Jetzt packst du noch ein neues Ding dazu: Wähle eines bei Packe etwas Neues ein.', target: OFFER };
    return { text: 'Wähle noch ein neues Ding.', target: OFFER };
  }
  if (once(ctx, 'fertig', sig)) return { text: 'Tippe auf Fertig. Das Spiel prüft, ob die Reihenfolge stimmt.', target: GO };
  return { text: 'Tippe auf Fertig.', target: GO };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
