// Lernrunde für Wildnis-Mosaik: liefert zu jedem Spielstand einen kurzen, vorlesbaren Satz und die Stellen, die pulsieren sollen.
// Es werden nur Regeln erklärt, nie Züge empfohlen. Jede Erklärung kommt nur in einem einzigen Zug; danach folgt nur noch der kurze Standardsatz.
import * as E from './engine.js';

// Eine Erklärung bleibt in dem Zustand stehen, in dem sie zum ersten Mal kam (egal wie oft gezeichnet wird), und kommt danach nie wieder.
function firstTime(ctx, key, sig) {
  if (!ctx.ui.coachSeen || typeof ctx.ui.coachSeen !== 'object') ctx.ui.coachSeen = {};
  const seen = ctx.ui.coachSeen;
  if (!(key in seen)) seen[key] = sig;
  return seen[key] === sig;
}

const MARKET = '[data-act="mt"]';
const hasTriple = (g) => {
  const c = {};
  for (const t of g.market.tokens) if (t) c[t] = (c[t] || 0) + 1;
  return Object.values(c).includes(3);
};
const fourNow = (g) => Array.isArray(g.recap) && g.recap.some((l) => typeof l === 'string' && /Vier gleiche/.test(l));
const totalTurns = (g) => g.players.reduce((s, p) => s + (Number(p.turns) || 0), 0);

// Liste von { key, when?, text, target }: die erste, die noch nicht gezeigt wurde und passt
function pick(ctx, sig, list, fallback) {
  for (const it of list) {
    if (it.when && !it.when()) continue;
    if (firstTime(ctx, it.key, sig)) return { text: it.text, target: it.target };
  }
  return fallback;
}

function chooseStep(g, ctx, me) {
  const p = g.players[me];
  const sig = `c${p.turns}`;
  if (fourNow(g) && firstTime(ctx, 'four', `f${totalTurns(g)}`)) {
    return { text: 'Vier gleiche Tiere im Markt werden immer sofort alle ersetzt. Dann tippe auf ein Paar.', target: MARKET };
  }
  return pick(ctx, sig, [
    { key: 'pair', text: 'Im Markt liegen vier Paare: oben ein Plättchen, darunter ein Tier. Tippe auf ein Paar, um beides zu nehmen.', target: MARKET },
    { key: 'habitat', text: 'Jedes Plättchen hat Lebensräume: Berg, Wald, Wiese, Sumpf, Fluss. Jeder hat eine Farbe und ein Muster. Die Tiere in der Mitte dürfen dort wohnen.', target: MARKET },
    { key: 'nature', when: () => p.nature >= 1, text: 'Du hast einen Naturmarker. Damit kannst du Plättchen und Tier frei wählen oder Tiere im Markt tauschen. Das ist freiwillig und kostet einen Marker.', target: '.wn-nat, [data-act="free-mode"], [data-act="wipe-mode"]' },
    { key: 'wipe3', when: () => !g.usedWipe3 && hasTriple(g), text: 'Drei gleiche Tiere im Markt darfst du kostenlos austauschen. Das ist freiwillig. Tippst du stattdessen auf ein Paar, bleibt alles, wie es ist.', target: '[data-act="wipe3"], ' + MARKET },
    { key: 'sc-baer', text: 'Wertung am Ende, Bären: Zwei Bären nebeneinander sind ein Paar. 1 Paar bringt 4 Punkte, 2 Paare 11, 3 Paare 19, 4 oder mehr 27.', target: MARKET },
    { key: 'sc-hirsch', text: 'Wertung, Hirsche: Eine gerade Reihe nebeneinander zählt. Eine Reihe aus 1, 2, 3 oder 4 und mehr Hirschen bringt 2, 5, 9 oder 13 Punkte.', target: MARKET },
    { key: 'sc-lachs', text: 'Wertung, Lachse: Sich berührende Lachse bilden einen Lauf, in dem jeder Lachs höchstens 2 Lachs-Nachbarn hat. Länge 1 bis 7 bringt 2, 4, 7, 11, 15, 20, 26 Punkte.', target: MARKET },
    { key: 'sc-falke', text: 'Wertung, Falken: Es zählen nur Falken ohne Falken-Nachbarn. 1 bis 8 Einzelgänger bringen 2, 5, 8, 11, 14, 18, 22, 26 Punkte.', target: MARKET },
    { key: 'sc-fuchs', text: 'Wertung, Füchse: Jeder Fuchs bringt 1 Punkt je andere Tierart auf den Nachbar-Plättchen, höchstens 4 Punkte.', target: MARKET },
    { key: 'sc-hab', text: 'Wertung, Lebensräume: Je Lebensraum zählt deine größte zusammenhängende Gruppe, 1 Punkt je Plättchen. Gruppen verbinden sich über gleiche Kanten.', target: MARKET },
    { key: 'sc-bonus', text: 'Bonus: Die alleinig größte Gruppe eines Lebensraums bringt 3 Punkte, bei Gleichstand 1 Punkt. Jeder Naturmarker am Ende zählt 1 Punkt.', target: MARKET },
  ], { text: 'Du bist dran. Tippe auf ein Paar im Markt.', target: MARKET });
}

function tileStep(g, ctx, me) {
  const sel = g.selected;
  if (!sel || g.market.tiles[sel.ti] === undefined || g.market.tiles[sel.ti] === null) return null;
  if (!E.legalTilePlacements(g).length) return null;
  const def = E.tileDef(g.market.tiles[sel.ti]);
  const sig = `t${g.players[me].turns}`;
  return pick(ctx, sig, [
    { key: 'tile1', text: 'Dein Plättchen liegt links groß da. Tippe im Gebiet auf ein grünes Feld, um es anzulegen. Es muss an ein Plättchen angrenzen.', target: '.wn-cand' },
    { key: 'rot', text: 'Mit „Drehen“ stellst du das Plättchen in eine von sechs Lagen. Jede Lage ist erlaubt. Auf den grünen Feldern siehst du, wie es dort läge.', target: '[data-act="rot"], .wn-cand' },
    { key: 'groups', text: 'Berühren sich an einer Kante gleiche Lebensräume, wachsen sie zu einer Gruppe. Am Ende zählt je Lebensraum deine größte Gruppe.', target: '.wn-cand' },
    { key: 'two', when: () => new Set(def.edges).size > 1, text: 'Viele Plättchen haben zwei Lebensräume. Ein solches Plättchen zählt für beide Gruppen.', target: '.wn-cand' },
  ], { text: 'Tippe auf ein grünes Feld, um das Plättchen anzulegen. Mit „Drehen“ änderst du die Lage.', target: '.wn-cand' });
}

function tokenStep(g, ctx, me) {
  const sel = g.selected;
  if (!sel || !g.market.tokens[sel.mi]) return null;
  const opts = E.tokenOptions(g);
  if (!opts.length) return null;
  const board = g.players[me].board;
  const sig = `k${g.players[me].turns}`;
  return pick(ctx, sig, [
    { key: 'tok1', text: 'Jetzt kommt dein Tier. Es darf nur auf ein Plättchen mit seinem Symbol. Grün markierte Plättchen sind erlaubt. Tippe auf eines.', target: '.wn-tokopt' },
    { key: 'key', when: () => opts.some((o) => board[o.q + ',' + o.r] && E.tileDef(board[o.q + ',' + o.r].t).key), text: 'Ein Plättchen mit goldenem Rand ist ein Schlüsselplättchen. Setzt du dort ein Tier, bekommst du einen Naturmarker.', target: '.wn-tokopt' },
    { key: 'one', text: 'Auf jedem Plättchen steht höchstens ein Tier. Ein Plättchen mit Tier ist nicht mehr frei.', target: '.wn-tokopt' },
    { key: 'discard', text: 'Du kannst das Tier auch wegwerfen. Es kommt dann zurück in den Sack. Das ist erlaubt.', target: '[data-act="discard"], .wn-tokopt' },
  ], { text: 'Tippe auf ein grün markiertes Plättchen, um dein Tier zu setzen, oder wirf es weg.', target: '.wn-tokopt, [data-act="discard"]' });
}

export function coach(game, ctx) {
  try {
    if (!game || !ctx || !ctx.ui || typeof ctx.ui !== 'object' || game.game !== 'wm' || !Array.isArray(game.players) || !game.market || !Array.isArray(game.market.tokens) || !Array.isArray(game.market.tiles)) return null;
    const me = game.players.findIndex((p) => p && p.id === ctx.id);
    if (me < 0) return null;
    if (game.phase === 'over') {
      return { text: 'Das Spiel ist zu Ende. Unten steht bei jeder Zahl, wie sie entstanden ist. Tippe auf Noch eine Runde, wenn du weiterüben willst.', target: '[data-act="again"]' };
    }
    if (game.phase !== 'choose' && game.phase !== 'tile' && game.phase !== 'token') return null;
    if (game.active !== me) {
      if (fourNow(game) && firstTime(ctx, 'four', `f${totalTurns(game)}`)) {
        return { text: 'Vier gleiche Tiere im Markt werden immer sofort alle ersetzt. Jetzt ist der Computer dran.' };
      }
      return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    if (game.phase === 'choose') return chooseStep(game, ctx, me);
    if (game.phase === 'tile') return tileStep(game, ctx, me);
    return tokenStep(game, ctx, me);
  } catch {
    return null;
  }
}
