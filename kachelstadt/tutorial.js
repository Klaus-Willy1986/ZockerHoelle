// Lernrunde für Kachelstadt: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Stellen, die pulsieren sollen.
// Keine Zug-Empfehlungen, nur Erklärungen: was ist möglich, wie funktioniert das Spiel.
import * as E from './engine.js';

const CAND = '.ks-cand';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird),
// und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  const seen = ctx.ui.coachSeen || (ctx.ui.coachSeen = {});
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

const isScoring = (l) => typeof l === 'string' && /fertig: .*Punkt/.test(l);

function placeStep(g, ctx, me) {
  const sig = `p${g.round}`;
  const legal = E.legalPlacements(g);
  if (!legal.length) return null;
  const seen = new Set(legal.map((m) => m.r));
  const allowed = E.uniqueRotations(g.current).filter((r) => seen.has(r));
  const rot = Number.isInteger(ctx.ui.rot) ? ctx.ui.rot : allowed[0];
  const someAlt = allowed.length > 1 && legal.some((m) => m.r !== rot) && new Set(legal.filter((m) => m.r === rot).map((m) => m.x + ',' + m.y)).size < new Set(legal.map((m) => m.x + ',' + m.y)).size;
  if (scoringNow(g) && firstTime(ctx, 'score', sig)) {
    return { text: 'Eine Wertung! Fertige Straße: 1 Punkt je Plättchen. Fertige Stadt: 2 je Plättchen, 2 je Wappen. Kloster: 9. Die Gefolgsleute kommen zurück. Dann tippe auf ein grünes Feld.', target: CAND };
  }
  if (firstTime(ctx, 'place1', sig)) {
    return allowed.length > 1
      ? { text: 'Das ist dein Plättchen. Die Kanten müssen passen: Stadt an Stadt, Straße an Straße, Wiese an Wiese. Mit „Drehen“ drehst du es. Tippe auf ein grünes Feld.', target: '[data-act="rot"], ' + CAND }
      : { text: 'Das ist dein Plättchen. Die Kanten müssen passen: Stadt an Stadt, Straße an Straße, Wiese an Wiese. Grüne Felder zeigen, wo es passt. Tippe auf ein grünes Feld.', target: CAND };
  }
  if (someAlt && firstTime(ctx, 'alt', sig)) {
    return { text: 'Helle Felder mit Pfeil: Dort passt dein Plättchen nur anders gedreht. Tippst du darauf, dreht das Spiel es für dich.', target: '.ks-cand.alt' };
  }
  const hand = g.players[me].meeples;
  if (hand === 0 && firstTime(ctx, 'empty', sig)) {
    return { text: 'Alle deine Gefolgsleute stehen auf dem Brett. Sie kommen nach einer Wertung zurück. Lege jetzt dein Plättchen auf ein grünes Feld.', target: CAND };
  }
  return { text: 'Du bist dran. Tippe auf ein grünes Feld, um dein Plättchen zu legen.', target: CAND };
}

function scoringNow(g) {
  return Array.isArray(g.recap) && g.recap.some(isScoring);
}

function meepleStep(g, ctx) {
  const sig = `m${g.round}`;
  const opts = E.meepleOptions(g);
  const hasField = opts.some((o) => o.kind === 'field');
  if (firstTime(ctx, 'meeple1', sig)) {
    return { text: 'Jetzt darfst du einen Gefolgsmann auf dein neues Plättchen stellen. Tippe auf eine Nummer. Oder wähle „Keinen Gefolgsmann setzen“.', target: '.ks-mt-c' };
  }
  if (firstTime(ctx, 'kinds', sig)) {
    return { text: 'Ritter stehen in Städten, Wegelagerer an Straßen, Mönche im Kloster, Bauern auf Wiesen. Dort darf noch kein anderer Gefolgsmann stehen.', target: '.ks-mt-c, [data-act="mp-none"]' };
  }
  if (hasField && firstTime(ctx, 'farmer', sig)) {
    return { text: 'Ein Bauer bleibt bis zum Spielende stehen. Er bringt dann 3 Punkte für jede fertige Stadt, die an seine Wiese grenzt.', target: '.ks-mt-c, [data-act="mp-none"]' };
  }
  return { text: 'Tippe auf eine Nummer, um einen Gefolgsmann zu setzen. Oder wähle „Keinen Gefolgsmann setzen“.', target: '.ks-mt-c, [data-act="mp-none"]' };
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || game.game !== 'ks' || !Array.isArray(game.players) || !game.board || typeof game.board !== 'object') return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    if (game.phase === 'over') {
      return { text: 'Das Spiel ist zu Ende. Auch Unfertiges zählt: 1 Punkt je Plättchen (und Wappen). Bauern: 3 Punkte je fertiger Stadt. Tippe auf Noch eine Runde.', target: '[data-act="again"]' };
    }
    if (game.phase !== 'place' && game.phase !== 'meeple') return null;
    if (game.active !== me) {
      if (scoringNow(game) && firstTime(ctx, 'score', `c${game.round}`)) {
        return { text: 'Eine Wertung! Fertige Straße: 1 Punkt je Plättchen. Fertige Stadt: 2 je Plättchen, 2 je Wappen. Kloster: 9. Die Gefolgsleute kommen zurück. Jetzt ist der Computer dran.' };
      }
      return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    if (game.phase === 'meeple') return meepleStep(game, ctx);
    if (!game.current) return null;
    return placeStep(game, ctx, me);
  } catch {
    return null;
  }
}
