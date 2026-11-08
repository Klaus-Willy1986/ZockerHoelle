// Wer bin ich? – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Frage- oder Rate-Empfehlung: Die Anleitung erklärt nur
// die Bedienung und die Regeln, sie sagt nie, welche Frage man stellen oder welchen Begriff man raten soll.
// Die Lernrunde hat 2 feste Begriffe (ein Tier, ein Gegenstand) und einen Computer als Mitspieler.
// Jede ausführliche Erklärung gehört zu genau einem Zustand (seq) und kommt danach nie wieder vor.

export const TUTORIAL_TERMS = ['elefant', 'loeffel'];

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
const ASK = '[data-act=ask]';
const KNOW = '[data-act=know]';
const PICK = '[data-act=pick]';
const NEXT = '[data-act=next]';

function build(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'wb' || !Array.isArray(g.players)) return null;
  if (g.phase === 'over') return { text: END, target: '[data-act=again]' };
  if (!ctx || typeof ctx !== 'object') return null;
  const me = g.players.findIndex((p) => p && p.id === ctx.id);
  if (me < 0) return null;
  const asked = Array.isArray(g.asked) ? g.asked.length : 0;
  const seq = Number.isFinite(g.seq) ? g.seq : 0;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};

  if (g.phase === 'reveal') {
    const rv = g.reveal && typeof g.reveal === 'object' ? g.reveal : null;
    if (rv && rv.by === ctx.id) {
      if (once(ctx, 'rev-me', seq)) {
        return { text: 'Richtig geraten! Je weniger Fragen gestellt wurden, desto mehr Punkte gibt es: zehn minus die Zahl der Fragen, mindestens zwei. Tippe auf Weiter.', target: NEXT };
      }
      return { text: 'Richtig! Tippe auf Weiter.', target: NEXT };
    }
    if (once(ctx, 'rev-bot', seq)) {
      return { text: 'Diesmal hat der Computer den Begriff erraten und bekommt die Punkte. Das ist nicht schlimm. Tippe auf Weiter.', target: NEXT };
    }
    return { text: 'Der Computer hat es erraten. Tippe auf Weiter.', target: NEXT };
  }

  if (g.phase !== 'ask') return null;
  if (g.turn !== me) {
    if (once(ctx, 'cpu', seq)) {
      return { text: 'Jetzt ist der Computer dran. Er stellt eine Frage oder rät. Alle Antworten stehen oben im Verlauf. Du musst nichts tun.' };
    }
    return { text: 'Der Computer ist dran. Bitte einen Moment Geduld.' };
  }

  if (ui.pick) {
    if (once(ctx, 'pick', seq)) {
      return { text: 'Hier stehen alle Begriffe der Kategorie. Tippe auf den, den du meinst. Rätst du falsch, verlierst du einen Punkt. Mit Zurück gehst du ohne Raten zu den Fragen.', target: PICK };
    }
    return { text: 'Tippe auf den Begriff, den du meinst.', target: PICK };
  }

  if (asked === 0 && g.round === 0 && once(ctx, 'start', seq)) {
    return { text: 'Willkommen! Das Spiel hat sich einen Begriff ausgedacht. Oben steht seine Kategorie. Tippe unten auf eine Frage-Karte. Das Spiel antwortet sofort mit Ja, Nein oder Teils.', target: ASK };
  }
  if (asked >= 1 && g.round === 0 && once(ctx, 'verlauf', seq)) {
    return { text: 'Oben im Verlauf siehst du alle Antworten: Grün heißt Ja, Rot heißt Nein, Gelb heißt Teils. Jede Person stellt pro Zug nur eine Frage, dann ist die nächste dran.', target: '.wb-chips' };
  }
  if (asked >= 3 && once(ctx, 'know', seq)) {
    return { text: 'Du darfst jederzeit raten. Tippe dafür auf Ich weiß es und wähle den Begriff aus der Liste. Je früher du richtig rätst, desto mehr Punkte bekommst du.', target: KNOW };
  }
  return { text: 'Du bist dran: Tippe auf eine Frage-Karte oder auf Ich weiß es.', target: `${ASK}, ${KNOW}` };
}

export function coach(game, ctx) {
  try {
    const r = build(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
