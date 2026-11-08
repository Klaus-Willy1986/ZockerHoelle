// Mahjong-Solitär – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie.
// Die Lernrunde nutzt ein kleines Übungsbrett mit 12 Steinen. Der Coach darf dort ein passendes Paar leuchten lassen
// (es stammt aus einer vollständigen Lösung, sodass die Runde immer aufgeht). Es werden keine Zugempfehlungen für
// normale Spiele gegeben.
import * as E from './engine.js';

const tileSel = (i) => `.mj-tile[data-i="${i}"]`;

function seenOf(ctx) {
  const ui = ctx && ctx.ui;
  if (!ui || typeof ui !== 'object') return null;
  if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
  return ui.coachSeen;
}

// Ein Stein, der noch eingeklemmt ist (bevorzugt einer mit einem Stein obendrauf)
function blockedTile(g) {
  const geo = E.geometry(g.layout);
  let side = -1;
  for (let i = 0; i < geo.n; i++) {
    if (!(g.kinds[i] >= 0) || E.isFreeIn(geo, g.kinds, i)) continue;
    if (geo.above[i].some((j) => g.kinds[j] >= 0)) return i;
    if (side < 0) side = i;
  }
  return side;
}

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.kinds) || !Array.isArray(g.hist) || !E.geometry(g.layout)) return null;
  if (g.mode === 'over') return { text: 'Geschafft! Alle Steine sind weg. Jetzt kannst du ein richtiges Spiel spielen.', target: '[data-act=again]' };
  if (g.layout !== 'lern') return { text: 'Tippe einen freien Stein an, dann einen gleichen zweiten.' };
  const seen = seenOf(ctx);
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  const pairs = g.hist.filter((h) => Array.isArray(h) && h[0] === 'p').length;
  const left = E.stonesLeft(g);
  const sel = Number.isInteger(ui.sel) && g.kinds[ui.sel] >= 0 && E.isFree(g, ui.sel) ? ui.sel : null;

  // Sackgasse: Neu mischen anbieten
  if (E.isStuck(g)) {
    return { text: 'Hier geht es nicht weiter. Tippe auf Neu mischen, dann liegen die Steine wieder anders.', target: '[data-act=shuffle]' };
  }
  const sol = E.solve(g, 20000);

  // Ein Stein ist markiert: Partner zeigen
  if (sel !== null) {
    const kind = g.kinds[sel];
    const mate = E.freeTiles(g).find((j) => j !== sel && E.sameKind(g.kinds[j], kind));
    if (mate !== undefined) {
      const onPath = sol && sol[0] && sol[0].includes(sel) ? sol[0].find((j) => j !== sel) : undefined;
      return { text: 'Gut. Tippe jetzt den gleichen Stein an, der leuchtet.', target: tileSel(onPath !== undefined ? onPath : mate) };
    }
    return { text: 'Zu diesem Stein gibt es noch keinen freien gleichen. Tippe ihn nochmal an, dann ist er nicht mehr markiert.', target: tileSel(sel) };
  }

  if (seen) {
    // Eingeklemmte Steine kennenlernen (einmalig, nach dem ersten Paar)
    if (pairs >= 1 && !seen.blockedDone) {
      if (ui.blockedTried) seen.blockedDone = true;
      else {
        const b = blockedTile(g);
        if (b >= 0) return { text: 'Dieser Stein ist eingeklemmt: Es liegt etwas auf ihm, oder links und rechts ist kein Platz. Tippe ihn an.', target: tileSel(b) };
        seen.blockedDone = true;
      }
    }
    // Hinweis kennenlernen
    if (seen.blockedDone && !seen.hintDone) {
      if (g.hints > 0) seen.hintDone = true;
      else return { text: 'Du weißt nicht weiter? Tippe auf Hinweis. Dann leuchtet ein Paar kurz grün.', target: '[data-act=hint]' };
    }
    // Zurück kennenlernen (braucht mindestens zwei Paare)
    if (seen.hintDone && !seen.undoDone) {
      if (seen.undoAt == null && pairs >= 2) seen.undoAt = pairs;
      if (seen.undoAt != null) {
        if (pairs < seen.undoAt) seen.undoDone = true;
        else if (pairs > seen.undoAt) seen.undoAt = pairs;
        else return { text: 'Falsch getippt? Mit Zurück nimmst du den letzten Schritt zurück. Das geht so oft du willst.', target: '[data-act=undo]' };
      }
    }
    // Mischen kennenlernen
    if (seen.undoDone && !seen.shuffleDone && left >= 4) {
      if (g.mixes > 0) seen.shuffleDone = true;
      else return { text: 'Manchmal geht es nicht weiter. Dann hilft Neu mischen: Die übrigen Steine liegen neu, und es geht immer zu Ende. Probiere es aus.', target: '[data-act=shuffle]' };
    }
  }

  // Nächstes Paar leuchten lassen
  if (sol && sol.length) {
    let pre = '';
    if (pairs === 0 && seen && !seen.start) { seen.start = true; pre = 'Immer zwei gleiche Steine dürfen weg. '; }
    return { text: `${pre}Tippe auf den leuchtenden Stein.`, target: tileSel(sol[0][0]) };
  }
  return { text: 'Tippe auf Zurück oder Neu mischen.', target: '[data-act=undo]' };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
