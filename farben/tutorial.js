// Farbenwürfeln – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
// Markiert werden nur Würfel und Felder, mit denen der Zug auch wirklich möglich ist.
import * as E from './engine.js';

const WORT = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];
const wort = (n) => WORT[n] || String(n);

// Eine Erklärung bleibt sichtbar, solange sich der Zustand (sig) nicht ändert, und kommt danach nie wieder.
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
const WAIT = 'Bitte einen Moment Geduld.';

// Alle möglichen Kombinationen aus Farb- und Zahlenwürfel, mit denen etwas angekreuzt werden kann.
function combos(g, me) {
  const runs = {};
  for (const c of E.COLORS) runs[c] = E.maxRun(me.x, c);
  const out = [];
  for (let ci = 0; ci < g.dice.c.length; ci++) {
    if (g.gone.c[ci]) continue;
    const cf = g.dice.c[ci];
    for (let ni = 0; ni < g.dice.n.length; ni++) {
      if (g.gone.n[ni]) continue;
      const nf = g.dice.n[ni];
      const cost = (cf === 'X' ? 1 : 0) + (nf === '?' ? 1 : 0);
      if (cost > me.jokers) continue;
      for (const color of (cf === 'X' ? E.COLORS : [cf])) {
        for (const num of (nf === '?' ? [1, 2, 3, 4, 5] : [nf])) {
          if (num <= runs[color]) out.push({ ci, ni, color, num });
        }
      }
    }
  }
  return out;
}

const uniq = (a) => [...new Set(a)];
const dieSel = (kind, i) => `[data-act=die][data-kind=${kind}][data-i="${i}"]`;

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players)) return null;
  if (g.mode === 'over' || g.phase === 'over') return { text: END, target: '[data-act=again]' };
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  if (ui.rolling) return { text: 'Die Würfel rollen.' };
  if (!ctx) return null;
  const me = g.players.find((p) => p.id === ctx.id);
  if (!me) return null;
  const ap = g.players[g.active];

  // ---- würfeln ----
  if (g.phase === 'roll') {
    if (!ap || ap.id !== ctx.id) return { text: WAIT };
    const sig = g.throwNo;
    const k = g.solo ? 2 : 3;
    if (g.throwNo === 0 && once(ctx, 'start', sig)) {
      return { text: `Du würfelst ${wort(2 * k)} Würfel, ${wort(k)} mit Farben und ${wort(k)} mit Zahlen. Tippe auf Würfeln.`, target: '[data-act=roll]' };
    }
    if (g.auto && g.auto[ctx.id]) {
      return { text: 'Diesmal ging leider nichts. Das passiert manchmal. Tippe auf Würfeln.', target: '[data-act=roll]' };
    }
    if (once(ctx, 'goal', sig)) {
      return { text: 'Du kreuzt Felder auf deinem Blatt an. Ganze Spalten und ganze Farben bringen Punkte. Tippe auf Würfeln.', target: '[data-act=roll]' };
    }
    return { text: 'Tippe auf Würfeln.', target: '[data-act=roll]' };
  }

  // ---- Auswahl ----
  const waiting = E.waitingFor(g).includes(ctx.id);
  if (!waiting) return { text: WAIT };
  if (!g.dice || !g.gone) return null;
  const pk = ui.pick && typeof ui.pick === 'object' ? ui.pick : { ci: null, ni: null, jc: null, jn: null, ask: null, cells: [], pass: false };
  const sig = g.rollId;

  if (pk.pass) return { text: 'Tippe auf Ja, nichts ankreuzen.', target: '[data-act=pass-yes]' };

  const cf = pk.ci != null ? g.dice.c[pk.ci] : null;
  const nf = pk.ni != null ? g.dice.n[pk.ni] : null;
  const pc = cf == null ? null : (cf === 'X' ? pk.jc : cf);
  const pn = nf == null ? null : (nf === '?' ? pk.jn : nf);
  const cs = combos(g, me).filter((c) => (pk.ci == null || c.ci === pk.ci) && (pk.ni == null || c.ni === pk.ni)
    && (pc == null || c.color === pc) && (pn == null || c.num === pn));

  // Joker: Farbe oder Zahl bestimmen
  if (pk.ask) {
    const isC = pk.ask.kind === 'c';
    const vals = uniq(cs.map((c) => (isC ? c.color : c.num)));
    const sel = vals.map((v) => `[data-act=joker-pick][data-v="${v}"]`).join(', ');
    return {
      text: `Mit dem Joker bestimmst du ${isC ? 'die Farbe' : 'die Zahl'} selbst. Das kostet ein Ausrufezeichen. Tippe auf ${isC ? 'eine Farbe' : 'eine Zahl'}.`,
      target: sel || '[data-act=joker-cancel]',
    };
  }

  // Felder auf dem Blatt
  if (pk.ci != null && pk.ni != null && pc != null && pn != null) {
    const groups = E.legalGroups(me.x, pc, pn);
    if (groups.length === 0) {
      return {
        text: 'Mit diesen Würfeln geht nichts. Tippe auf Andere Würfel wählen. Du kannst auch auf Nichts ankreuzen tippen.',
        target: '[data-act=reset-dice], [data-act=pass]',
      };
    }
    const sel = Array.isArray(pk.cells) ? pk.cells : [];
    const left = pn - sel.length;
    if (left <= 0) {
      const text = once(ctx, 'confirm', sig)
        ? 'Alles gewählt. Mit Ja, so ankreuzen trägst du die Kreuze ein.'
        : 'Das passt. Tippe auf Ja, so ankreuzen.';
      return { text, target: '[data-act=confirm]' };
    }
    const what = `${pn} ${pn === 1 ? E.COLOR_ONE[pc] + ' Feld' : E.COLOR_MANY[pc] + ' Felder'}`;
    const base = `Du kreuzt ${what} an. Tippe ${sel.length ? 'noch ' : 'jetzt auf '}${sel.length ? 'auf ' : ''}${left} markierte${left === 1 ? 's Feld' : ' Felder'}.`;
    let pre = '';
    if (sel.length === 0) {
      const none = me.x.every((v) => !v);
      if (none) pre = 'Das erste Kreuz muss in der mittleren Spalte H stehen. ';
      else if (once(ctx, 'adj', sig)) pre = 'Neue Kreuze müssen an ein altes Kreuz grenzen. ';
      else if (once(ctx, 'cells', sig)) pre = 'Die Felder eines Wurfs müssen aneinander grenzen. ';
    }
    return { text: pre + base, target: '.fw-cell.opt' };
  }

  // Würfel wählen
  if (cs.length === 0) {
    return { text: 'Mit diesen Würfeln geht nichts. Tippe auf Nichts ankreuzen.', target: '[data-act=pass]' };
  }
  const wantC = pk.ci == null;
  const kind = wantC ? 'c' : 'n';
  const idxs = uniq(cs.map((c) => (wantC ? c.ci : c.ni)));
  const target = idxs.map((i) => dieSel(kind, i)).join(', ');
  const action = pk.ci == null && pk.ni == null ? 'Tippe zuerst auf einen Farbwürfel.'
    : wantC ? 'Tippe jetzt auf einen Farbwürfel.' : 'Tippe jetzt auf einen Zahlenwürfel.';
  const jokerOn = g.dice.c.some((f, i) => f === 'X' && !g.gone.c[i]) || g.dice.n.some((f, i) => f === '?' && !g.gone.n[i]);
  let pre = '';
  if (pk.ci != null || pk.ni != null) pre = '';
  else if (once(ctx, 'dice', sig)) pre = 'Die Farbe sagt, in welcher Farbe du ankreuzt. Die Zahl sagt, wie viele Felder. ';
  else if (jokerOn && once(ctx, 'joker', sig)) pre = `Ein Würfel mit Kreuz oder Fragezeichen ist ein Joker. Damit bestimmst du Farbe oder Zahl selbst. Das kostet ein Ausrufezeichen. Du hast noch ${me.jokers} davon. `;
  else if (!g.solo && g.phase === 'all' && once(ctx, 'all', sig)) pre = 'Alle wählen gleichzeitig. ';
  else if (once(ctx, 'pass', sig)) pre = 'Du darfst auch auf Nichts ankreuzen tippen. ';
  return { text: pre + action, target };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
