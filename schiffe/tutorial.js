// Lernrunde für Schiffe versenken: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und das, was leuchten soll.
// Nur Regeln und Bedienung – keine Hinweise, wohin man schießen sollte.
import * as M from './engine.js';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

const BOARD = '#board';
const FIRE = '[data-act="fire"]';

function setupStep(g, ctx, me) {
  const fleet = g.fleets[me];
  // Zustand nur anhand der eigenen Aufstellung (g.moveNo zählt auch die Schritte des Computers mit)
  const sig = `s${fleet.map((s) => `${s.x},${s.y}${s.dir}`).join(';')}`;
  if (g.ready[me]) return { text: 'Du bist fertig. Der Computer stellt noch seine Schiffe auf. Einen Moment bitte.' };
  if (!fleet.every((s) => s.x !== null)) {
    if (firstTime(ctx, 'setup', sig)) {
      return { text: 'Zuerst stellst du deine fünf Schiffe auf. Tippe ein Schiff an, dann ein Feld im Meer. Oder tippe auf Zufällig aufstellen, dann macht das der Computer für dich.', target: '[data-act="random"]' };
    }
    return { text: 'Stelle deine Schiffe auf: Schiff antippen, dann Feld antippen. Oder tippe auf Zufällig aufstellen.', target: '[data-act="random"]' };
  }
  if (firstTime(ctx, 'ready', sig)) {
    return { text: 'Alle fünf Schiffe stehen. Wenn du zufrieden bist, tippe auf Fertig. Mit Zufällig aufstellen kannst du es auch noch einmal neu würfeln.', target: '[data-act="ready"]' };
  }
  return { text: 'Alle Schiffe stehen. Tippe auf Fertig, wenn du zufrieden bist.', target: '[data-act="ready"]' };
}

function resultText(g, me) {
  const l = g.last;
  if (!l || l.by !== me) return null;
  if (l.r === 'w') return { key: 'water', text: 'Wasser heißt: Auf diesem Feld war kein Schiff. Der Punkt bleibt als Merkzeichen stehen.' };
  if (l.r === 'h') return { key: 'hit', text: 'Treffer! Hier liegt ein Schiff, aber noch nicht alle Felder davon sind getroffen.' };
  return { key: 'sunk', text: `Versenkt! Du hast alle Felder von diesem Schiff getroffen: ${l.ship}.` };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || !Array.isArray(game.players) || !Array.isArray(game.fleets) || !Array.isArray(game.ready)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    if (game.mode === 'over') {
      return { text: 'Die Runde ist zu Ende. Wer zuerst alle 17 Schiffsfelder des anderen getroffen hat, gewinnt. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target: '[data-act="again"]' };
    }
    if (game.mode === 'setup') return setupStep(game, ctx, me);
    if (game.mode !== 'play') return null;

    const sig = `m${game.moveNo}`;
    if (game.turn !== me) {
      const r = resultText(game, me);
      if (r && firstTime(ctx, r.key, sig)) return { text: `${r.text} Jetzt ist der Computer dran.` };
      return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    // Ich bin dran
    const sel = ctx.ui.sel;
    const picked = Number.isInteger(sel) && sel >= 0 && sel < M.CELLS && game.grid[me][sel] === null;
    if (picked) return { text: 'Du hast ein Feld gewählt. Tippe jetzt auf Hier schießen.', target: FIRE };
    if (firstTime(ctx, 'shoot', sig)) {
      return { text: 'Jetzt wird abwechselnd geschossen. Das große Feld ist das Meer des Computers. Tippe ein Feld an, dann auf Hier schießen. Wer zuerst alle 17 Schiffsfelder trifft, gewinnt.', target: BOARD };
    }
    const mine = resultText(game, me);
    if (mine && game.opts && game.opts.again) {
      const m = firstTime(ctx, mine.key, sig) ? mine : null;
      return { text: m ? `${m.text} Bei dieser Regel darfst du nach einem Treffer noch einmal schießen.` : 'Du darfst noch einmal schießen.', target: BOARD };
    }
    if (game.last && game.last.by !== me && firstTime(ctx, 'theirs', sig)) {
      return { text: 'Der Computer hat auf dein Meer geschossen. Unten siehst du dein Feld: Ein Kreuz ist ein Treffer auf dein Schiff, ein Punkt ist Wasser.', target: BOARD };
    }
    return { text: 'Du bist dran. Tippe ein Feld im großen Meer an.', target: BOARD };
  } catch {
    return null;
  }
}
