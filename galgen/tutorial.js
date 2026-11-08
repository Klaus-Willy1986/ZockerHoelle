// Galgenmännchen – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Buchstaben- oder Wortvorschläge:
// Das Ziel ist nie eine bestimmte Taste, sondern die ganze Tastatur ("#gg-keys") oder ein Knopf.
// Die Lernrunde hat 2 Wörter (Katze, Gitarre). Jede lange Erklärung gehört zu genau einer Lage und kommt nur einmal vor.

export const TUTORIAL_OPTS = { words: [{ w: 'KATZE', k: 'tiere' }, { w: 'GITARRE', k: 'musik' }], errors: 8 };

// Eine Erklärung bleibt sichtbar, solange ihr Zustand (sig) gleich bleibt, und kommt danach nie wieder.
function once(ctx, key, sig) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (!(key in ui.coachSeen)) ui.coachSeen[key] = sig;
    return ui.coachSeen[key] === sig;
  } catch { return false; }
}

// Eine Erklärung beenden (sie wird nicht mehr gezeigt, auch wenn ihr Zustand wiederkehrt)
function finish(ctx, ...keys) {
  try {
    const seen = ctx && ctx.ui && ctx.ui.coachSeen;
    if (!seen || typeof seen !== 'object') return;
    for (const k of keys) if (k in seen) seen[k] = 'done';
  } catch { /* egal */ }
}

const KEYS = '#gg-keys';

function build(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'gg' || !Array.isArray(g.players) || !Array.isArray(g.mask) || !ctx) return null;
  const me = g.players.findIndex((p) => p && p.id === ctx.id);
  if (me < 0) return null;
  const round = g.round | 0;

  if (g.phase === 'over') {
    finish(ctx, 'cpu', 'wordopen');
    return { text: 'Die Lernrunde ist zu Ende. Ganz oben steht, wer gewonnen hat. Tippe auf Noch eine Runde, wenn du richtig spielen möchtest.', target: '[data-act=again]' };
  }
  const last = round + 1 >= (g.rounds | 0);

  if (g.phase === 'reveal') {
    finish(ctx, 'cpu', 'wordopen', 'wordintro', 'hit', 'errors', 'start');
    const next = { target: '[data-act=next]' };
    if (round === 0) {
      if (g.solved) {
        if (once(ctx, 'solved0', round)) {
          return { text: 'Das Wort ist gelöst! Jeder gefundene Buchstabe bringt einen Punkt, und wer das Wort löst, bekommt dazu Bonuspunkte. Die Punkte stehen unten. Tippe auf Nächstes Wort.', ...next };
        }
      } else if (once(ctx, 'lost0', round)) {
        return { text: 'Verloren: Der Schneemann ist ganz geschmolzen. Dann gibt es keine Bonuspunkte, und das Wort wird gezeigt. Tippe auf Nächstes Wort.', ...next };
      }
      return { text: 'Tippe unten auf Nächstes Wort.', ...next };
    }
    return { text: last ? 'Das war das letzte Wort. Tippe unten auf Zum Endergebnis.' : 'Tippe unten auf Nächstes Wort.', ...next };
  }

  if (g.phase !== 'play') return null;
  const cur = g.players[g.turn | 0];
  const ev = g.last && typeof g.last === 'object' ? g.last : null;
  const seq = g.seq | 0;
  const wordOpen = !!(ctx.ui && typeof ctx.ui === 'object' && ctx.ui.wordOpen);

  if ((g.turn | 0) !== me) {
    const who = cur && String(cur.id).startsWith('bot') ? 'Der Computer' : (cur && cur.name) || 'Die andere Person';
    finish(ctx, 'wordopen');
    if (once(ctx, 'cpu', 0)) {
      return { text: 'Jetzt rät der Computer. Du musst nichts tun. Schau zu, wie die Striche sich füllen oder der Schneemann schmilzt.' };
    }
    return { text: `${who} ist dran. Bitte einen Moment Geduld.` };
  }

  // Ich bin dran
  finish(ctx, 'cpu');
  if (wordOpen) {
    finish(ctx, 'start', 'hit', 'errors', 'wordintro');
    if (once(ctx, 'wordopen', 0)) {
      return { text: 'Schreibe das ganze Wort in das Feld und tippe auf Raten. Mit Abbrechen gehst du zurück zur Tastatur.', target: '#gg-wordin' };
    }
    return { text: 'Schreibe das Wort und tippe auf Raten.', target: '#gg-wordin' };
  }
  finish(ctx, 'wordopen');
  if (round === 0 && seq === 0 && once(ctx, 'start', 0)) {
    return { text: 'Willkommen! Oben stehen Striche, einer für jeden Buchstaben des gesuchten Wortes. Die Kategorie verrät, worum es geht. Tippe unten auf einen Buchstaben, den du für möglich hältst.', target: KEYS };
  }
  if (ev && ev.kind === 'letter' && ev.by === ctx.id && once(ctx, 'hit', seq)) {
    return { text: 'Treffer! Der Buchstabe steht an allen passenden Stellen, und du bekommst für jede Stelle einen Punkt. Nach einem Treffer darfst du gleich noch einmal raten.', target: KEYS };
  }
  if ((g.errs | 0) >= 1 && once(ctx, 'errors', seq)) {
    return { text: 'Kommt ein Buchstabe nicht vor, ist das ein Fehler. Dann schmilzt der Schneemann ein Stück, und die nächste Person ist dran. Die Fehler zählen alle zusammen. Bei acht Fehlern ist das Wort verloren.', target: KEYS };
  }
  if (seq >= 3 && once(ctx, 'wordintro', seq)) {
    return { text: 'Wenn du das Wort schon erkennst, tippe auf Ich weiß das Wort und schreibe es ganz auf. Das bringt Bonuspunkte. Ein falsches Wort ist aber ein Fehler.', target: '[data-act=wordopen]' };
  }
  if (round >= 1 && seq === 0 && once(ctx, 'round2', 0)) {
    return { text: 'Neues Wort, neues Glück. Diesmal hast du keine Hilfe mehr. Tippe auf einen Buchstaben.', target: KEYS };
  }
  return { text: 'Du bist dran. Tippe auf einen Buchstaben.', target: KEYS };
}

export function coach(game, ctx) {
  try {
    const r = build(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
