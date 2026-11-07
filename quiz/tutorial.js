// Kneipenquiz – Anleitung für die Lernrunde (reine Funktion des Spielstands).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Antwortempfehlung, nur Bedienung und Regeln.
// Die Lernrunde hat 3 feste Beispielfragen (mc, Schätzfrage, Stimmt/Stimmt nicht), unabhängig von fragen.js.
// Jede Erklärung gehört zu genau einer Lage (Frage + Phase) und kommt deshalb nur einmal vor.

export const TUTORIAL_BANK = [
  { id: 'lr1', k: 'allg', t: 'mc', d: 1, q: 'Aus welchen Zutaten wird Bier hauptsächlich gebraut?', a: ['Reis und Zucker', 'Wasser, Malz und Hopfen', 'Milch und Honig', 'Trauben und Hefe'], c: 1, fun: 'Das ist mein Fach. Prost auf die Lernrunde!' },
  { id: 'lr2', k: 'allg', t: 'est', d: 1, q: 'Wie viele Beine hat eine Spinne?', c: 8, unit: 'Beine', min: 0, max: 20, fun: 'Acht Beine, und kein einziges davon steht an meiner Theke.' },
  { id: 'lr3', k: 'allg', t: 'tf', d: 1, q: 'Die Sonne geht im Osten auf.', c: true, fun: 'Jeden Morgen aufs Neue. Das kann ich bestätigen.' },
];

function compute(g, ctx) {
  if (!g || typeof g !== 'object' || g.game !== 'qz' || !Array.isArray(g.players) || !Array.isArray(g.qs) || !ctx) return null;
  const me = g.players.find((p) => p && p.id === ctx.id);
  if (!me) return null;

  if (g.phase === 'over') {
    return { text: 'Die Lernrunde ist zu Ende. Ganz oben steht der Stammtisch-König oder die Stammtisch-Königin. Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.', target: '[data-act=again]' };
  }
  const q = g.qs[g.qi];
  if (!q) return null;
  const answers = g.answers && typeof g.answers === 'object' ? g.answers : {};

  if (g.phase === 'reveal') {
    if (q.t === 'mc') return { text: 'Das ist die Auflösung. Oben steht die richtige Antwort, darunter siehst du, wer richtig lag. Eine richtige Antwort bringt 10 Punkte. Tippe auf Weiter.', target: '[data-act=next]' };
    if (q.t === 'est') return { text: 'Bei Schätzfragen gewinnt, wer am nächsten dran ist: 15, 10 und 5 Punkte. Genau getroffen bringt 5 Punkte extra. Tippe auf Weiter.', target: '[data-act=next]' };
    return { text: 'Unter der Auflösung zeigt Die Theke alle Punkte. Jeder Bierkrug steht für 10 Punkte. Tippe auf Weiter.', target: '[data-act=next]' };
  }

  if (g.phase === 'ask') {
    if (me.id in answers) {
      const wait = ['Deine Antwort ist abgegeben. Jetzt antwortet noch der Computer. Du musst nichts tun.',
        'Abgegeben. Gleich ist auch der Computer fertig, dann kommt die Auflösung.',
        'Geschafft. Gleich kommt die Auflösung, du musst nur kurz warten.'];
      return { text: wait[Math.min(2, Math.max(0, g.qi | 0))] };
    }
    if (q.t === 'mc') {
      const used = g.jokerUsed && g.jokerUsed[me.id];
      if (g.joker && !used && g.qi === 0) {
        return { text: 'Der 50:50-Joker blendet zwei falsche Antworten aus. Du hast ihn einmal pro Spiel. Tippe ihn an, oder antworte gleich.', target: '[data-act=joker], [data-act=pick]' };
      }
      return { text: 'So antwortest du: Lies die Frage in Ruhe und tippe auf eine der Antworten. Es gibt kein Zeitlimit.', target: '[data-act=pick]' };
    }
    if (q.t === 'est') return { text: 'Bei einer Schätzfrage stellst du eine Zahl ein: mit dem Schieberegler oder mit Plus und Minus. Dann tippst du auf Das ist meine Antwort.', target: '[data-act=est-ok]' };
    if (q.t === 'tf') return { text: 'Hier gibt es nur zwei Knöpfe: Stimmt oder Stimmt nicht. Tippe auf einen davon.', target: '[data-act=pick]' };
    return { text: 'Tippe die Karten nacheinander an und tippe dann auf Fertig.', target: '[data-act=ord-pick]' };
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
