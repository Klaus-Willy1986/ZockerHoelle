// Zehntausend – Anleitung für die Lernrunde (reine Funktion des Spielzustands).
// Gibt { text, target } zurück oder null. Wirft nie. Keine Strategie-Tipps, nur Bedienung und Regeln.
import * as Z from './engine.js';

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

// Erste Erklärung aus der Liste, die jetzt (noch) gezeigt werden darf
function firstPre(ctx, sig, list) {
  for (const [key, text, when] of list) {
    if (when === false) continue;
    if (once(ctx, key, sig)) return text + ' ';
  }
  return '';
}

const END = 'Geschafft! Die Lernrunde ist zu Ende. Du kannst jetzt eine richtige Runde spielen.';

function build(g, ctx) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !g.turn) return null;
  if (g.mode === 'over') return { text: END, target: '[data-act=again]' };
  const ui = ctx && ctx.ui && typeof ctx.ui === 'object' ? ctx.ui : {};
  if (ui.rolling) return { text: 'Die Würfel rollen.' };
  const ap = g.players[g.active];
  const t = g.turn;
  if (!ap || !ctx) return null;
  if (ap.id !== ctx.id) return { text: 'Bitte einen Moment Geduld. Gleich bist du wieder dran.' };
  const opts = g.opts || {};
  const sig = `${g.rollId}|${t.phase}`;
  const finalPre = g.finalFrom != null && g.finalFrom !== g.active
    ? [['final', 'Schlussrunde: Jemand hat das Ziel erreicht. Alle anderen haben jetzt noch einen Zug. Danach gewinnt die höchste Punktzahl.']] : [];
  const entryPre = opts.entry && !ap.entered
    ? [['entry', `Einstiegshürde: Wer noch kein Konto hat, braucht in einem Zug mindestens ${Z.ENTRY} Punkte, bevor er aufhören darf.`]] : [];

  if (t.phase === 'start') {
    const pre = firstPre(ctx, sig, [['start', 'Du hast sechs Würfel. Pro Zug sammelst du Punkte und buchst sie aufs Konto.'], ...finalPre]);
    return { text: `${pre}Tippe auf Würfeln.`, target: '[data-act=roll]' };
  }

  if (t.phase === 'end') {
    const r = t.result || {};
    if (r.kind === 'patzer') {
      const pre = firstPre(ctx, sig, [['patzer', 'Das war ein Patzer: Kein Würfel hat gezählt. Die Punkte dieses Zugs sind weg.']]);
      return { text: `${pre}Tippe auf Weiter.`, target: '[data-act=next]' };
    }
    const pre = firstPre(ctx, sig, [['banked', 'Die Punkte sind jetzt sicher auf deinem Konto.']]);
    return { text: `${pre}Tippe auf Weiter.`, target: '[data-act=next]' };
  }

  if (t.phase === 'pick') {
    if (!Array.isArray(t.dice)) return null;
    const sel = Array.isArray(ui.sel) ? ui.sel : [];
    const vals = t.dice.filter((_, i) => sel[i] === true);
    const pts = vals.length ? Z.scoreExact(vals, opts) : 0;
    if (vals.length && pts === 0) {
      return { text: 'Diese Auswahl zählt nicht. Es dürfen nur Würfel markiert sein, die Punkte bringen. Tippe auf einen Würfel, um die Markierung zu ändern.', target: '[data-act=toggle]' };
    }
    if (pts > 0) {
      const pre = firstPre(ctx, sig, [['confirm', 'Mit dem Knopf legst du die markierten Würfel zur Seite.'], ...entryPre, ...finalPre]);
      return { text: `${pre}Diese Auswahl gibt ${pts} Punkte. Tippe auf Diese Würfel gelten.`, target: '[data-act=keep]' };
    }
    const pre = firstPre(ctx, sig, [
      ['mark', 'Tippe die Würfel an, die Punkte bringen. Markierte Würfel werden grün. Der Knopf unten zeigt die Punkte.'],
      ['table', 'Die Punkte: Eine 1 zählt 100, eine 5 zählt 50. Drei Einser zählen 1000, drei Zweier 200, drei Dreier 300, drei Vierer 400, drei Fünfer 500, drei Sechser 600.'],
      ['table2', `Vier gleiche zählen doppelt, fünf gleiche vierfach, sechs gleiche achtfach. Eine Straße von 1 bis 6 zählt 1500.${opts.pairs ? ' Drei Paare zählen 1000.' : ''}`],
      ['one', 'Mindestens ein Würfel muss zählen, mehrere sind erlaubt. Drei gleiche zählen nur, wenn sie im selben Wurf gefallen sind.'],
      ...entryPre, ...finalPre,
    ]);
    return { text: `${pre}Tippe die Würfel an, die zählen sollen.`, target: '[data-act=toggle]' };
  }

  if (t.phase === 'after') {
    const ok = Z.canBank(g, ap, t);
    const left = Z.diceLeft(t);
    const pre = firstPre(ctx, sig, [
      ['hot', 'Heiße Würfel: Alle sechs Würfel haben gezählt. Du darfst mit allen sechs neu würfeln, deine Zugpunkte bleiben.', t.hot === true],
      ...(ok ? [] : entryPre),
      ['after', 'Jetzt hast du die Wahl. Weiterwürfeln kann Punkte bringen, aber ohne Treffer sind alle Zugpunkte weg. Aufhören bucht sie aufs Konto.'],
      ...entryPre, ...finalPre,
    ]);
    if (!ok) {
      return { text: `${pre}Aufhören geht noch nicht. Tippe auf Weiterwürfeln.`, target: '[data-act=roll]' };
    }
    return { text: `${pre}Tippe auf Weiterwürfeln mit ${left} ${left === 1 ? 'Würfel' : 'Würfeln'} oder auf Aufhören.`, target: '[data-act=roll], [data-act=bank]:not([disabled])' };
  }
  return null;
}

export function coach(game, ctx) {
  try { return build(game, ctx) || null; } catch { return null; }
}
