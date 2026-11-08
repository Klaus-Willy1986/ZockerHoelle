// Wortsuche – Computer als Mitspieler (reine Funktionen, keine Oberfläche).
// Stufen: 0 = Leicht, 1 = Mittel.
//
// WICHTIG: Der Computer sucht nicht wirklich im Gitter. Er ist ein simulierter Mitspieler, der nur ZEITPUNKTE würfelt:
// Nach einer Wartezeit (thinkDelay) meldet er { t:'find', word } für ein noch gesuchtes Wort aus der öffentlichen
// Wortliste. Er benutzt weder die Lage der Wörter noch die Buchstaben des Gitters und sieht nie die Tipps der anderen.
// Das ist erlaubt und hier dokumentiert: Der Computer ist ein Tempo-Gegner, kein Suchprogramm.
//   Leicht: ein Wort alle 14 bis 24 Sekunden
//   Mittel: ein Wort alle  6 bis 12 Sekunden
// Lernrunde: Der Computer findet höchstens ein Wort und lässt immer mindestens drei Wörter für dich übrig.

export const DELAYS = [[14000, 24000], [6000, 12000]];
export const LEARN_BOT_MAX = 1;
export const LEARN_KEEP = 3;

export const thinkDelay = (level, rng = Math.random) => {
  const [lo, hi] = DELAYS[level === 1 ? 1 : 0];
  return Math.round(lo + rng() * (hi - lo));
};

// Gibt { t:'find', word } für den Computer zurück oder null, wenn er nichts tun kann.
export function chooseAction(state, botId, level, rng = Math.random) {
  if (!state || state.game !== 'ws' || state.mode !== 'play' || !Array.isArray(state.words) || !Array.isArray(state.players)) return null;
  const bi = state.players.findIndex((p) => p.id === botId);
  if (bi < 0) return null;
  const open = state.words.map((x) => (x.by < 0 ? x.w : null)).filter((x) => x !== null);
  if (!open.length) return null;
  if (state.learn) {
    const mine = state.words.filter((x) => x.by === bi).length;
    if (mine >= LEARN_BOT_MAX || open.length <= LEARN_KEEP) return null;
  }
  const word = open[Math.min(open.length - 1, Math.floor(rng() * open.length))];
  return { t: 'find', word };
}
