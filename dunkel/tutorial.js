// Dunkle Rätsel – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Lösungsvorschläge, nur Bedienung und Regeln.
// Die Lernrunde hat ein festes Beispiel-Rätsel. Der Computer antwortet aus einer kleinen Tabelle (keine freie Frage).
// Jede Erklärung gehört zu genau einer Lage (Stufe) und kommt deshalb nur einmal vor.

export const LERN = {
  riddle: {
    id: 'lr1', titel: 'Der Mann im Regen', schwer: 1,
    geschichte: 'Ein Mann steht im strömenden Regen. Er hat keinen Schirm und keinen Hut. Seine Kleidung ist völlig durchnässt, aber kein einziges Haar auf seinem Kopf wird nass.',
    loesung: 'Der Mann hat keine Haare. Er ist kahl. Deshalb kann kein Haar nass werden.',
    hinweise: ['Es geht um etwas, das der Mann nicht hat.', 'Es hat mit seinem Kopf zu tun.', 'Auf seinem Kopf wächst nichts.'],
  },
  table: [
    { q: 'Ist der Mann krank?', a: 'nein' },
    { q: 'Ist es draußen kalt?', a: 'egal' },
    { q: 'Hat das mit seinen Haaren zu tun?', a: 'ja' },
    { q: 'Hat er nur wenige Haare?', a: 'fast' },
  ],
  guesses: [
    { t: 'Er trägt eine Perücke aus Plastik.', v: 'falsch' },
    { t: 'Er hat sehr kurze Haare.', v: 'fast' },
    { t: 'Er hat keine Haare auf dem Kopf.', v: 'richtig' },
  ],
};

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'dr' || g.mode !== 'learn' || !Array.isArray(g.players) || !Array.isArray(g.log) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    return { text: 'Die Lernrunde ist zu Ende. Du kannst jetzt allein im Rätselbuch spielen oder mit anderen eine Gruppe aufmachen. Tippe auf Noch eine Runde, wenn du weiterüben möchtest.', target: '[data-act=again]' };
  }
  if (g.phase === 'solved') {
    return { text: 'Geschafft! Jetzt steht die Lösung für alle da. Du bekommst Punkte: drei Punkte ohne Hinweis, für jeden Hinweis einen Punkt weniger, mindestens einen. Tippe auf Weiter.', target: '[data-act=next]' };
  }
  if (g.phase !== 'play') return null;

  const asked = g.log.filter((e) => e && e.k === 'q').length;
  const guesses = g.log.filter((e) => e && e.k === 'g').length;
  const h = g.hints | 0;

  if (guesses >= 2) return { text: 'Noch nicht ganz. Auch falsche Versuche kosten nichts. Probiere die andere Möglichkeit.', target: '[data-act=lguess]' };
  if (guesses === 1) return { text: 'Der Computer bewertet deinen Versuch mit Richtig, Fast oder Falsch. Bei Fast fehlt nur noch ein kleines Stück. Du darfst es noch einmal versuchen.', target: '[data-act=lguess-open], [data-act=lguess]' };
  if (h >= 3) return { text: 'Das war der dritte und letzte Hinweis. Er verrät fast alles. Wenn du es weißt, tippe auf Ich glaube, ich weiß es.', target: '[data-act=lguess-open]' };
  if (h === 2) return { text: 'Der zweite Hinweis ist schon deutlicher. Insgesamt gibt es drei Hinweise.', target: '[data-act=hint]' };
  if (h === 1) return { text: 'Der Hinweis steht jetzt im Protokoll. Jeder Hinweis, den du nimmst, kostet am Ende einen Punkt. Du kannst weiter fragen oder noch einen Hinweis holen.', target: '[data-act=lask]' };
  if (asked === 0) return { text: 'Lies zuerst die Geschichte oben. Sie ist ein Rätsel: Was ist da passiert? Du darfst Ja-Nein-Fragen stellen. Tippe unten auf eine Frage.', target: '[data-act=lask]' };
  if (asked === 1) return { text: 'Der Spielleiter antwortet mit Ja, Nein, Egal oder Fast. Egal heißt: Die Frage ist unwichtig. Fast heißt: Du bist ganz nah dran. Stelle eine weitere Frage.', target: '[data-act=lask]' };
  if (asked === 2) return { text: 'Wenn du nicht weiterkommst, tippe auf Hinweis. Es gibt bis zu drei Hinweise, vom vagen bis zum deutlichen. Du kannst es aber auch ohne versuchen.', target: '[data-act=hint]' };
  return { text: 'Wenn du glaubst, die Lösung zu kennen, tippe auf Ich glaube, ich weiß es. Dann wählst du eine Antwort aus. In einer echten Runde tippst du sie selbst ein.', target: '[data-act=lguess-open]' };
}

export function coach(game, ctx) {
  try {
    const r = compute(game, ctx);
    return r && typeof r.text === 'string' && r.text ? r : null;
  } catch {
    return null;
  }
}
