// Backgammon – Lernrunde: Anleitung zum Mitlesen und Vorlesen (reine Funktion, keine Oberfläche).
// coach(game, ctx) -> { text, target? } | null. Wirft nie. Keine Zugempfehlungen: nur Bedienung und Regeln.
import * as P from './engine.js';

const ROLL = '[data-act="roll"]';
const SOURCES = '.bg-pt.can';
const TARGETS = '.bg-pt.tgt';
const DIE = '[data-act="die"]';
const NEXT = '[data-act="next"]';

// Erklärung genau einmal: Solange die Lage (key) gleich bleibt, bleibt der Text stehen
// (das Spiel zeichnet mehrmals pro Zug), danach kommt er nie wieder.
function once(seen, name, key) {
  if (seen[name] === undefined) { seen[name] = key; return true; }
  return seen[name] === key;
}

function compute(game, ctx) {
  if (!game || typeof game !== 'object' || game.game !== 'bgm' || !Array.isArray(game.players) || !Array.isArray(game.board) || !Array.isArray(game.left)) return null;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const ui = c.ui && typeof c.ui === 'object' ? c.ui : {};
  if (!ui.coachSeen || typeof ui.coachSeen !== 'object') ui.coachSeen = {};
  const seen = ui.coachSeen;
  const me = game.players.findIndex((p) => p && p.id === c.id);
  if (me < 0) return null;
  const mine = game.board[me];
  const theirs = game.board[1 - me];
  if (!Array.isArray(mine) || !Array.isArray(theirs)) return null;

  if (game.mode === 'over') {
    const won = game.winner === me;
    const kind = game.kind === 'backgammon' ? ' Das war sogar ein Backgammon, das zählt 3 Punkte.' : game.kind === 'gammon' ? ' Das war ein Gammon, das zählt 2 Punkte.' : '';
    const head = won ? `Du hast gewonnen. Herzlichen Glückwunsch.${kind}` : `Das Spiel ist zu Ende. Der Computer hat alle Steine heraus.${kind}`;
    return { text: `${head} Tippe auf Noch eine Runde, wenn du weiterspielen möchtest.`, target: NEXT };
  }
  if (ui.rolling) return { text: 'Die Würfel rollen. Einen Moment bitte.' };

  const ap = game.players[game.turn];
  if (!ap) return null;
  const pass = game.pass && typeof game.pass === 'object' ? game.pass : null;
  const key = [game.gid, game.rollId, game.turn, game.stage, game.left.length].join('|');

  if (ap.id !== c.id) {
    if (pass && pass.p === me && once(seen, 'passMine', `${game.gid}|${pass.rollId}`)) {
      return { text: 'Du kannst nicht ziehen. Mit diesem Wurf ist kein Zug erlaubt, deshalb verfällt er. Jetzt ist der Computer dran. Schau einfach zu.' };
    }
    return { text: 'Jetzt ist der Computer dran. Schau einfach zu.' };
  }

  if (game.stage === 'roll') {
    if (mine[25] > 0 && once(seen, 'gotHit', key)) {
      return { text: 'Einer deiner Steine wurde geschlagen. Er liegt jetzt auf der Bar, dem Mittelstreifen. Du musst ihn zuerst wieder einsetzen. Tippe auf Würfeln.', target: ROLL };
    }
    if (pass && pass.p === me && once(seen, 'passMine', `${game.gid}|${pass.rollId}`)) {
      return { text: 'Du kannst nicht ziehen. Mit diesem Wurf ist kein Zug erlaubt, deshalb verfällt er. Tippe auf Würfeln.', target: ROLL };
    }
    if (once(seen, 'introRoll', key)) {
      return { text: 'Ziel: Alle deine 15 Steine in dein Heimfeld unten rechts bringen und dann herausspielen. Tippe auf Würfeln. Du würfelst zwei Würfel.', target: ROLL };
    }
    return { text: 'Tippe auf Würfeln.', target: ROLL };
  }

  if (game.stage === 'move') {
    const lr = game.lastRoll && typeof game.lastRoll === 'object' ? game.lastRoll : { dice: [0, 0] };
    const moves = P.legalMoves(game);
    const sel = P.selectionFor(game, me, ui.sel, moves);
    const target = ui.choice ? DIE : sel !== null ? TARGETS : SOURCES;
    const [a, b] = lr.dice;
    const rest = game.left.join(' und ');
    const hits = moves.some((m) => m.to >= 1 && theirs[25 - m.to] === 1);
    const offs = moves.some((m) => m.to === 0);
    let home = mine[0];
    for (let q = 1; q <= 6; q++) home += mine[q];
    if (ui.choice) return { text: 'Mit welcher Zahl willst du herausspielen? Tippe auf einen der Knöpfe. Beide sind erlaubt, weil kein Stein weiter hinten steht.', target };
    if (mine[25] > 0 && once(seen, 'bar', key)) {
      return { text: `Du hast ${a} und ${b} gewürfelt. Dein Stein auf der Bar muss zuerst wieder aufs Brett. Er kommt ins Heimfeld der anderen Seite, oben rechts. Tippe auf eine Spitze mit Rahmen und Punkt.`, target };
    }
    if (once(seen, 'dice', key)) {
      return { text: `Du hast ${a} und ${b} gewürfelt. Jede Zahl ziehst du einzeln. Tippe auf einen Stein von dir. Dann siehst du das Ziel mit Rahmen und Punkt. Tippe auf das Ziel.`, target };
    }
    if (a === b && once(seen, 'double', key)) {
      return { text: `Ein Pasch. Du ziehst die ${a} viermal. Tippe auf einen Stein und dann auf sein Ziel.`, target };
    }
    if (hits && once(seen, 'hit', key)) {
      return { text: 'Du kannst einen einzelnen Stein der anderen Seite schlagen. Einen einzelnen Stein nennt man Blot. Landest du genau darauf, kommt er auf die Bar und muss neu einsetzen.', target };
    }
    if (home === P.STONES && once(seen, 'bearAll', key)) {
      return { text: 'Alle 15 Steine stehen im Heimfeld. Jetzt darfst du herausspielen. Tippe auf einen Stein und dann auf Raus rechts unten.', target };
    }
    if (offs && once(seen, 'off', key)) {
      return { text: 'Ein Stein kann heraus. Tippe auf den Stein und dann auf das Feld Raus.', target };
    }
    if (sel !== null) return { text: `Noch zu spielen: ${rest}. Tippe jetzt auf ein Ziel mit Rahmen und Punkt.`, target };
    return { text: `Noch zu spielen: ${rest}. Tippe auf einen Stein von dir.`, target };
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
