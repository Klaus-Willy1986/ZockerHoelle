// Stadt, Land, Fluss – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Wortvorschläge, nur Bedienung und Regeln.
// Die Lernrunde hat 2 Runden (Buchstaben B und S) mit nur 3 Kategorien (Stadt, Land, Tier).
// Jede Erklärung gehört zu genau einer Lage (Runde + Phase + Fortschritt) und kommt deshalb nur einmal vor.

export const TUTORIAL_OPTS = { cats: ['stadt', 'land', 'tier'], rounds: 2, letters: ['B', 'S'], stop: false };

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'sl' || !Array.isArray(g.players) || !Array.isArray(g.cats) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    return { text: 'Die Lernrunde ist zu Ende. Ganz oben in der Rangliste steht, wer gewonnen hat. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target: '[data-act=again]' };
  }
  const round = g.round | 0;
  const last = round + 1 >= (g.rounds | 0);

  if (g.phase === 'reveal') {
    const rows = g.reveal && Array.isArray(g.reveal.cats) ? g.reveal.cats.map((c) => c && c.rows && c.rows[me.id]).filter(Boolean) : [];
    const unknown = rows.some((r) => r.st === 'unknown');
    if (last) return { text: 'Das war die letzte Runde. Ein Wort, das das Wörterbuch nicht kennt, steht als ungeprüft da. Tippe unten auf Zum Endergebnis.', target: '[data-act=next]' };
    if (unknown) return { text: 'Das ist die Auflösung. Ein Wort mit dem Zeichen ungeprüft kennt das Wörterbuch nicht. Gegen den Computer zählt es mit halben Punkten. Tippe unten auf Nächste Runde.', target: '[data-act=next]' };
    return { text: 'Das ist die Auflösung. Ein Wort, das nur du hast, bringt 10 Punkte. Ein Wort, das auch die anderen haben, bringt 5 Punkte. Wer als Einziger etwas weiß, bekommt 20. Tippe unten auf Nächste Runde.', target: '[data-act=next]' };
  }

  if (g.phase === 'ask' || g.phase === 'fill') {
    const done = g.done && typeof g.done === 'object' ? g.done : {};
    if (done[me.id]) {
      const wait = ['Du bist fertig. Jetzt schreibt noch der Computer seine Wörter. Das dauert ein paar Sekunden.',
        'Geschafft. Gleich ist auch der Computer fertig, dann kommt die Auflösung.'];
      return { text: wait[Math.min(1, Math.max(0, round))] };
    }
    const mine = g.drafts && Array.isArray(g.drafts[me.id]) ? g.drafts[me.id] : [];
    const filled = mine.filter((t) => typeof t === 'string' && t.trim().length > 0).length;
    const n = g.cats.length;
    const firstEmpty = Math.max(0, mine.findIndex((t) => !(typeof t === 'string' && t.trim().length > 0)));
    if (filled >= n) {
      return { text: round === 0
        ? 'Alle Felder sind ausgefüllt. Wenn du fertig bist, tippe unten auf Fertig. Du darfst auch Felder leer lassen.'
        : 'Alles ausgefüllt. Tippe unten auf Fertig.', target: '[data-act=done]' };
    }
    if (filled === 0) {
      return { text: round === 0
        ? 'Oben steht der Buchstabe dieser Runde. Schreibe in jedes Feld ein Wort, das mit diesem Buchstaben beginnt. Groß oder klein ist egal. Tippe auf das erste Feld.'
        : 'Neue Runde, neuer Buchstabe. Diesmal geht es ohne Hilfe. Tippe auf das erste Feld und schreibe los.', target: '.sl-in[data-i="0"]' };
    }
    return { text: round === 0
      ? 'Prima. Mit der Eingabetaste springst du zum nächsten Feld. Du kannst dir so viel Zeit lassen, wie du magst.'
      : 'Weiter so. Fülle die übrigen Felder aus.', target: `.sl-in[data-i="${firstEmpty}"]` };
  }
  return null;
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
