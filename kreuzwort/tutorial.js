// Kreuzworträtsel – Lernrunde: festes kleines Übungsrätsel (5 Wörter, ohne Generator) und Anleitung (Coach).
// coach(game, ctx) gibt { text, target } zurück oder null. Wirft nie.
// In der Lernrunde (Stufe „lern“) nennt der Coach den nächsten Buchstaben, weil es ein festes Übungsrätsel ist.
// In normalen Rätseln gibt er nur Bedienhilfen.
import * as E from './engine.js';

// 5 Wörter, kreuzen sich an den Ecken und in der Mitte (Zeile 0 und 4 waagerecht, Spalten 0, 2, 4 senkrecht)
export const LEARN_PUZZLE = [
  { w: 'PARIS', q: 'Hauptstadt von Frankreich', r: 0, c: 0, d: 'h' },
  { w: 'LINIE', q: 'Strich, den man mit dem Lineal zieht', r: 4, c: 0, d: 'h' },
  { w: 'PFEIL', q: 'Wird vom Bogen abgeschossen', r: 0, c: 0, d: 'v' },
  { w: 'REGEN', q: 'Fällt aus den Wolken', r: 0, c: 2, d: 'v' },
  { w: 'SONNE', q: 'Sie scheint am Tag und wärmt', r: 0, c: 4, d: 'v' },
];

const END = 'Geschafft! Du hast das Übungsrätsel gelöst. Jetzt kannst du ein richtiges Rätsel spielen.';

function once(ctx, key) {
  try {
    const ui = ctx && ctx.ui;
    if (!ui || typeof ui !== 'object') return false;
    if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
    if (ui.coachSeen[key]) return false;
    ui.coachSeen[key] = true;
    return true;
  } catch { return false; }
}

const cellSel = (i) => `[data-act=cell][data-i="${i}"]`;
const keySel = (ch) => `[data-act=key][data-ch="${ch}"]`;
const ok = (g, i) => g.cells[i] === g.sol[i];
const incomplete = (g, w) => E.wordCells(g, w).filter((i) => !ok(g, i));
const done = (g, w) => !!w && incomplete(g, w).length === 0;

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.cells) || !Array.isArray(g.words) || !ctx) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  if (g.mode !== 'play') return null;
  const ui = ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};

  if (g.level !== 'lern') {
    return { text: 'Tippe ein Feld an. Der Hinweis steht über der Tastatur. Tippe unten die Buchstaben ein.' };
  }

  const total = g.cells.length;
  const sel = Number.isInteger(ui.sel) && ui.sel >= 0 && ui.sel < total && g.sol[ui.sel] !== '#' ? ui.sel : -1;
  const dir = ui.dir === 'v' ? 'v' : 'h';
  const word = (n, d) => g.words.find((w) => w.n === n && w.d === d) || null;
  const paris = word(1, 'h');
  const sonne = word(3, 'v');
  if (!paris || !sonne) return { text: 'Tippe ein Feld an und dann unten die Buchstaben.' };
  const cur = sel >= 0 ? E.wordAt(g, sel, dir) : null;

  // Falscher Buchstabe: erst korrigieren
  const wrong = E.wrongCells(g);
  if (wrong.length) {
    const n = wrong[0];
    if (sel !== n) return { text: 'Hier stimmt ein Buchstabe nicht. Tippe auf das leuchtende Feld.', target: cellSel(n) };
    return { text: `Hier gehört ein ${g.sol[n]} hin. Tippe auf die leuchtende Taste.`, target: keySel(g.sol[n]) };
  }

  const startCell = E.wordCells(g, paris)[0];
  // Schritt 1: das erste Wort (Paris, waagerecht)
  if (!done(g, paris)) {
    if (!cur || cur.n !== paris.n || cur.d !== paris.d) {
      if (sel < 0 && once(ctx, 'intro')) return { text: 'Willkommen! In jedes weiße Feld kommt ein Buchstabe. Die kleine Zahl zeigt, wo ein Wort anfängt. Tippe auf das leuchtende Feld mit der 1.', target: cellSel(startCell) };
      return { text: 'Tippe auf das leuchtende Feld mit der 1.', target: cellSel(startCell) };
    }
    const n = incomplete(g, paris)[0];
    if (sel !== n) return { text: 'Tippe auf das leuchtende Feld.', target: cellSel(n) };
    if (once(ctx, 'clue')) return { text: 'Das Wort ist jetzt farbig. Über der Tastatur steht der Hinweis: Hauptstadt von Frankreich, fünf Buchstaben. Tippe auf die leuchtende Taste.', target: keySel(g.sol[n]) };
    if (once(ctx, 'jump')) return { text: 'Prima! Der Cursor springt von allein zum nächsten Feld. Tippe jetzt die leuchtende Taste.', target: keySel(g.sol[n]) };
    return { text: `Tippe jetzt das ${g.sol[n]}.`, target: keySel(g.sol[n]) };
  }

  // Schritt 2: Richtungswechsel am Kreuzungsfeld (Ende von Paris = Anfang von Sonne)
  const cross = E.wordCells(g, sonne)[0];
  if (!ui.coachSeen || !ui.coachSeen.turned) {
    if (sel === cross && dir === 'v') { once(ctx, 'turned'); }
    else if (sel === cross && dir === 'h') {
      if (once(ctx, 'turn')) return { text: 'Dieses Feld gehört zu zwei Wörtern: einem waagerechten und einem senkrechten. Tippe noch einmal darauf, dann wechselt die Richtung.', target: cellSel(cross) };
      return { text: 'Tippe noch einmal auf das leuchtende Feld, dann geht es nach unten.', target: cellSel(cross) };
    } else {
      return { text: 'Tippe auf das leuchtende Feld mit der 3 oben rechts.', target: cellSel(cross) };
    }
  }

  // Schritt 3: das senkrechte Wort (Sonne)
  if (!done(g, sonne)) {
    const n = incomplete(g, sonne)[0];
    const inSonne = cur && cur.n === sonne.n && cur.d === sonne.d;
    if (!inSonne || sel !== n) {
      if (once(ctx, 'down')) return { text: 'Jetzt geht es nach unten. Der Hinweis steht wieder über der Tastatur. Tippe auf das leuchtende Feld.', target: cellSel(n) };
      return { text: 'Tippe auf das leuchtende Feld.', target: cellSel(n) };
    }
    return { text: `Tippe jetzt das ${g.sol[n]}.`, target: keySel(g.sol[n]) };
  }

  // Schritt 4: Prüfen
  if (g.checks === 0) {
    if (once(ctx, 'check')) return { text: 'Bist du unsicher? Mit Prüfen werden falsche Buchstaben rot. Tippe auf Prüfen.', target: '[data-act=check]' };
    return { text: 'Tippe auf Prüfen.', target: '[data-act=check]' };
  }

  // Schritt 5: Hilfe
  if (g.hints === 0) {
    const empty = g.cells.map((x, i) => (x === '' ? i : -1)).filter((i) => i >= 0);
    if (!empty.length) return null;
    if (sel >= 0 && g.cells[sel] === '') {
      if (once(ctx, 'help')) return { text: 'Brauchst du Hilfe? Mit Buchstabe aufdecken zeigt dir das Spiel den Buchstaben in diesem Feld. Das zählt als Hilfe und steht am Ende im Ergebnis.', target: '[data-act=revealL]' };
      return { text: 'Tippe auf Buchstabe aufdecken.', target: '[data-act=revealL]' };
    }
    return { text: 'Tippe auf ein leuchtendes leeres Feld.', target: cellSel(empty[0]) };
  }

  // Schritt 6: Rest allein lösen
  let w = cur && !done(g, cur) ? cur : null;
  if (!w) w = g.words.find((x) => !done(g, x)) || null;
  if (!w) return null;
  const n = incomplete(g, w)[0];
  const inW = cur && cur.n === w.n && cur.d === w.d;
  if (!inW || sel !== n) {
    if (once(ctx, 'rest')) return { text: 'Den Rest schaffst du allein. Tippe auf das leuchtende Feld und dann die Buchstaben. Der Hinweis zeigt dir den Weg.', target: cellSel(n) };
    return { text: 'Tippe auf das leuchtende Feld.', target: cellSel(n) };
  }
  return { text: `Tippe jetzt das ${g.sol[n]}.`, target: keySel(g.sol[n]) };
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
