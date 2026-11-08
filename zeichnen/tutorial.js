// Zeichenraten – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Tipps zum Zeichnen oder Raten, nur Bedienung und Regeln.
// In der Lernrunde zeichnet der Mensch "Haus"; der Computer rät nach festen Zeitpunkten ("Zelt", dann "Haus").
// Jede Erklärung gehört zu genau einer Stufe. Die Stufe hängt nur von Zählern ab, die nie kleiner werden
// (g.sk = Anzahl begonnener Striche, g.nc = Anzahl Chat-Zeilen) und kommt deshalb höchstens einmal vor.

function stage(g) {
  if (g.phase === 'over') return 'over';
  if (g.phase === 'result') return 'result';
  if (g.phase !== 'draw') return null;
  const sk = Number.isInteger(g.sk) ? g.sk : 0;
  const nc = Number.isInteger(g.nc) ? g.nc : 0;
  if (nc >= 1) return 'chat';
  if (sk >= 4) return 'zeit';
  return 'strich' + Math.max(0, sk);
}

const TEXTE = {
  strich0: { text: 'Du bist dran mit Zeichnen. Dein geheimer Begriff steht oben, nur du siehst ihn. Male ihn mit dem Finger auf die weiße Fläche. Der Computer rät gleich mit.', target: '#board' },
  strich1: { text: 'Gut gemacht! Unter der Fläche wählst du die Farbe. Tippe auf ein Farbfeld und male weiter. Mit den drei Knöpfen daneben änderst du die Dicke des Pinsels.', target: '.zr-colors button, .zr-brush button' },
  strich2: { text: 'Das Gummi ist der Radierer: Er malt weiß und nimmt Gemaltes weg. Mit Rückgängig verschwindet der letzte Strich, mit Alles löschen die ganze Zeichnung.', target: '[data-act=tool-e], [data-act=undo], [data-act=clear]' },
  strich3: { text: 'Ganz oben läuft der Zeitbalken. Wenn die Hälfte der Zeit um ist, bekommen die Ratenden den ersten Buchstaben verraten, später den zweiten. Male einfach weiter.', target: '.zr-timewrap' },
  zeit: { text: 'Die Ratenden schreiben ihre Wörter in ein Feld unter der Zeichnung und tippen auf Raten. Du selbst rätst nicht mit, denn du kennst den Begriff ja. Gleich meldet sich der Computer.', target: '.zr-chat' },
  chat: { text: 'Der Computer hat falsch geraten. Falsche Versuche sehen alle in der Liste, damit jeder weiß, was schon dran war. Richtige Antworten werden nicht verraten, da steht nur: hat es erraten.', target: '.zr-chat' },
  result: { text: 'Aufgelöst! Wer richtig rät, bekommt 10 Punkte und noch etwas dazu, je schneller, desto mehr. Du als Zeichner bekommst für jeden, der es errät, 5 Punkte. Tippe auf Weiter.', target: '[data-act=next]' },
  over: { text: 'Die Lernrunde ist zu Ende. Jetzt kannst du mit anderen spielen oder mit allen am selben Gerät. Tippe auf Noch eine Runde, wenn du weiterüben möchtest.', target: '[data-act=again]' },
};

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'zr' || g.mode !== 'learn' || !Array.isArray(g.players) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;
  const s = stage(g);
  return s ? TEXTE[s] : null;
}

export const STUFEN = Object.keys(TEXTE);

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? { text: r.text, target: r.target } : null;
  } catch {
    return null;
  }
}
