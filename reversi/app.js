import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'rv',
  maxPlayers: 2,
  newGame: (players, opts) => { resetUi(); return M.createGame(players, opts); },
  onMessage: (state, pid, msg) => {
    // „Noch eine Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    M.handle(state, pid, msg);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 800,
    step: (g, level) => {
      // Das Passen bestätigt immer ein Mensch (der Computer bestätigt nie von selbst)
      if (!g || g.mode !== 'play') return null;
      const bot = g.players.find((p) => String(p.id).startsWith('bot'));
      if (!bot) return null;
      const msg = chooseAction(g, bot.id, level);
      return msg ? { id: bot.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
function resetUi() { S.ui = { ...(S.ui || {}), hint: '', sig: '', animKey: '', animAt: 0 }; }
resetUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const showHints = (g) => !!(g.opts && g.opts.hints) || !!S.learn;

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.round}|${g.moveNo}|${g.turn}|${g.mode}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.hint = ''; }
  }
  const view = `${S.screen}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Steine ======================
// Schwarz: dunkle Scheibe mit hellem Punkt (●). Weiß: helle Scheibe mit dunklem Ring (○). Auch ohne Farbe unterscheidbar.
const colClass = (g, i) => (i === g.black ? 'k' : 'w');
const colWord = (g, i) => M.colorOf(g, i);
function discHtml(c, old) {
  if (old) return `<span class="rv-disc flip"><i class="rv-face ${c}"></i><i class="rv-face back ${old}"></i></span>`;
  return `<span class="rv-disc"><i class="rv-face ${c}"></i></span>`;
}
function iconHtml(c) { return `<span class="rv-icon"><i class="rv-face ${c}"></i></span>`; }

// ====================== Darstellung ======================
function bannerHtml() {
  const g = S.game;
  const me = myIndex();
  if (g.mode === 'over') {
    const draw = g.winner === null;
    const title = draw ? 'Unentschieden!' : g.winner === me ? 'Du hast gewonnen! Glückwunsch!' : `${esc(g.players[g.winner].name)} hat gewonnen!`;
    return `<div class="banner done rv-banner"><span class="trophy" aria-hidden="true">${draw ? '🤝' : '🏆'}</span> <h1>${title}</h1></div>`;
  }
  if (g.mode === 'pass') {
    return g.passer === me
      ? `<div class="banner rv-banner">Du musst passen</div>`
      : `<div class="banner rv-banner">${esc(g.players[g.passer].name)} muss passen</div>`;
  }
  const ap = g.players[g.turn];
  const col = colWord(g, g.turn);
  return ap.id === cid ? `<div class="banner mine rv-banner">Du bist dran! (${col})</div>` : `<div class="banner rv-banner">${esc(ap.name)} ist dran (${col})</div>`;
}

function scoreHtml(g) {
  const me = myIndex();
  const counts = M.countsOf(g.board);
  const boxes = g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    return `<div class="rv-pl${g.turn === i && g.mode !== 'over' ? ' turn' : ''}">
      <div class="rv-n">${iconHtml(colClass(g, i))}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="rv-stones"><b>${counts[i]}</b> ${counts[i] === 1 ? 'Stein' : 'Steine'}</div>
      <div class="rv-p"><span>${colWord(g, i)}</span><span><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Punkt' : 'Punkte'}</span>${off}</div></div>`;
  }).join('');
  const starter = g.players[g.black];
  return `<section class="card rv-score" aria-label="Steinzahl und Punktestand">${boxes}
    <p class="rv-round">Runde ${g.round} · ${starter.id === cid ? 'Du beginnst' : esc(starter.name) + ' beginnt'}</p></section>`;
}

function boardHtml(g) {
  const me = myIndex();
  const canTap = g.mode === 'play' && me >= 0 && g.turn === me;
  const legal = new Set(canTap ? M.legalCells(g.board, me) : []);
  const hints = showHints(g);
  // Umdreh-Bewegung nur kurz nach einem Zug (nicht bei jedem Neuzeichnen)
  const key = `${g.round}|${g.moveNo}`;
  if (S.ui.animKey !== key) { S.ui.animKey = key; S.ui.animAt = Date.now(); }
  const fresh = g.last && Date.now() - S.ui.animAt < 900;
  const flipIdx = new Map(fresh ? g.last.flips.map((p, i) => [p, i]) : []);
  const cells = g.board.map((c, p) => {
    const name = M.cellName(p);
    const isLegal = legal.has(p);
    const last = g.last && g.last.p === p;
    const cls = ['rv-cell', isLegal ? 'free' : '', isLegal && hints ? 'hint' : '', last ? 'last' : '', (p + Math.floor(p / 8)) % 2 ? 'alt' : ''].filter(Boolean).join(' ');
    let inner = '';
    let what = 'leer';
    if (c !== null) {
      const col = colClass(g, c);
      what = col === 'k' ? 'schwarzer Stein' : 'weißer Stein';
      inner = flipIdx.has(p)
        ? `<span class="rv-wrap" style="--d:${flipIdx.get(p) * 70}ms">${discHtml(col, colClass(g, 1 - c))}</span>`
        : discHtml(col);
    } else if (isLegal && hints) {
      inner = '<span class="rv-dot"></span>';
      what = 'leer, hier darfst du setzen';
    }
    return `<button type="button" class="${cls}" data-act="cell" data-p="${p}"${isLegal ? ' data-hint="legal"' : ''} aria-label="Feld ${name}: ${what}${last ? ', zuletzt gesetzt' : ''}"${c !== null || !canTap ? ' aria-disabled="true"' : ''}>${inner}</button>`;
  }).join('');
  return `<div class="rv-board${g.mode === 'over' ? ' ended' : ''}" id="board" role="group" aria-label="Spielbrett">${cells}</div>`;
}

function statusHtml(g) {
  const me = myIndex();
  const hint = S.ui.hint ? `<div class="rv-hint" role="alert">${esc(S.ui.hint)}</div>` : '';
  const recap = g.mode !== 'over' && g.moveNo > 0 && g.recap[0] ? `<p class="rv-last">${esc(g.recap[0])}</p>` : '<p class="rv-last"></p>';
  if (g.mode === 'over') {
    const c = g.final || M.countsOf(g.board);
    const why = g.endCode === 'full' ? 'Das Brett ist voll.' : 'Niemand kann mehr ziehen.';
    const result = g.winner === null
      ? `Unentschieden, ${c[0]} zu ${c[1]} Steine. Beide bekommen einen Punkt.`
      : g.winner === me
        ? `Du hast mit ${c[g.winner]} zu ${c[1 - g.winner]} Steinen gewonnen und bekommst 2 Punkte.`
        : `${esc(g.players[g.winner].name)} gewinnt mit ${c[g.winner]} zu ${c[1 - g.winner]} Steinen und bekommt 2 Punkte.`;
    const again = S.role === 'host'
      ? `<button class="btn primary huge" data-act="next">▶ Noch eine Runde</button>`
      : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
    return `<p class="big">${why} ${result}</p>${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button>`;
  }
  if (g.mode === 'pass') {
    const pn = esc(g.players[g.passer].name);
    const nn = esc(g.players[g.turn].name);
    const text = g.passer === me
      ? `Du kannst nicht ziehen, ${nn} ist wieder dran.`
      : `${pn} kann nicht ziehen. ${g.turn === me ? 'Du bist' : nn + ' ist'} wieder dran.`;
    return `<p class="big">${text}</p><button class="btn primary huge" data-act="ack">OK</button>`;
  }
  const isMe = g.turn === me;
  const ap = g.players[g.turn];
  const text = isMe
    ? (showHints(g) ? 'Du bist dran. Tippe auf ein Feld mit Punkt, um dort zu setzen.' : 'Du bist dran. Tippe auf das Feld, auf das du deinen Stein legen willst.')
    : `${esc(ap.name)} überlegt …`;
  return `<p class="big">${text}</p>${hint}${recap}`;
}

function gameHtml() {
  const g = S.game;
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    ${scoreHtml(g)}
    <section class="card rv-board-card">${boardHtml(g)}</section>
    <section class="card rv-status action">${statusHtml(g)}</section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Am Ende liegen mehr Steine deiner Farbe auf dem Brett als Steine deines Gegenübers.</p>
    <h3>Das Brett und die Steine</h3>
    <p>Das Brett hat 8 mal 8 Felder. Die Steine sind Scheiben mit zwei Seiten: <b>Schwarz</b> (dunkel, mit hellem Punkt) und <b>Weiß</b> (hell, mit dunklem Ring). Man erkennt sie auch an der Form, nicht nur an der Farbe. Am Anfang liegen vier Steine in der Mitte. Schwarz beginnt.</p>
    <h3>So setzt du einen Stein</h3>
    <ul>
      <li>Du legst einen Stein auf ein <b>leeres</b> Feld.</li>
      <li>Dabei musst du mindestens einen Stein deines Gegenübers <b>einschließen</b>: Zwischen dem neuen Stein und einem deiner anderen Steine liegt eine ununterbrochene Reihe gegnerischer Steine. Die Reihe darf waagerecht, senkrecht oder schräg verlaufen.</li>
      <li>Alle eingeschlossenen Steine werden <b>umgedreht</b> und gehören dann dir. Es können mehrere Reihen gleichzeitig eingeschlossen werden.</li>
      <li>Tippe einfach auf das Feld. Geht ein Feld nicht, sagt dir das Spiel Bescheid, und du kannst es noch einmal versuchen.</li>
    </ul>
    <h3>Wenn du nicht ziehen kannst</h3>
    <p>Gibt es für dich kein Feld, auf das du setzen darfst, musst du passen. Das Spiel sagt dir Bescheid, du tippst auf „OK“, und dein Gegenüber ist noch einmal dran.</p>
    <h3>Ecken</h3>
    <p>Steine in den vier Ecken können nicht mehr umgedreht werden.</p>
    <h3>Wann ist das Spiel zu Ende?</h3>
    <ul>
      <li>Wenn das Brett voll ist, oder wenn beide nicht mehr ziehen können.</li>
      <li>Wer dann mehr Steine hat, gewinnt. Gleich viele Steine sind ein Unentschieden.</li>
    </ul>
    <h3>Mehrere Runden und Punkte</h3>
    <ul>
      <li>Der Sieg bringt 2 Punkte, bei einem Unentschieden bekommen beide 1 Punkt.</li>
      <li>Die Steinzahl beider Seiten und den Punktestand siehst du oben.</li>
      <li>Nach jeder Runde kann der Gastgeber auf „Noch eine Runde“ tippen. Dann tauschen die Farben, und die andere Person beginnt als Schwarz.</li>
      <li>Mit „Spiel beenden“ hörst du auf, wann du möchtest.</li>
    </ul>
    <h3>Mögliche Felder anzeigen</h3>
    <p>Vor dem Start kannst du „Mögliche Felder anzeigen“ ankreuzen. Dann zeigt ein kleiner Punkt, wo du setzen darfst. Das ist nur eine Hilfe zum Erlaubten, keine Empfehlung.</p>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur erlaubte Züge möglich sind, und erkennt das Spielende von allein.</p>
`;
}

// ====================== Bedienung ======================
function tap(p) {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode === 'over' || me < 0) return;
  if (g.mode === 'pass') { S.ui.hint = 'Bitte tippe zuerst auf OK.'; return render(); }
  if (g.turn !== me) { S.ui.hint = 'Du bist gerade nicht an der Reihe. Bitte warte einen Moment.'; return render(); }
  if (g.board[p] !== null) { S.ui.hint = 'Dort kannst du nicht setzen. Dieses Feld ist schon besetzt.'; return render(); }
  if (!M.isLegal(g.board, p, me)) { S.ui.hint = 'Dort kannst du nicht setzen. Dein Stein muss mindestens einen Stein deines Gegenübers einschließen.'; return render(); }
  S.ui.hint = '';
  return sess.send({ t: 'place', p });
}

const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: [
    { id: 'hints', label: 'Mögliche Felder anzeigen', help: 'Zeigt dir mit einem kleinen Punkt, auf welche Felder du setzen darfst. Ohne diese Hilfe musst du selbst schauen, wo es geht.', def: false },
  ],
  title: 'Reversi', icon: '⚫', sub: 'Steine einschließen und umdrehen – online für zwei',
  helpTitle: 'Die Spielregeln von Reversi', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'cell': return tap(Number(el.dataset.p));
      case 'ack': return sess.send({ t: 'ack' });
      case 'next': return S.role === 'host' ? sess.send({ t: 'next' }) : undefined;
    }
    return undefined;
  },
});
function render() { ui.render(); }
// Der Schließen-Knopf im Hilfefenster liegt im Fenster, dessen Klick nicht nach oben weitergereicht wird (ui.js).
$app.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('.modal [data-act="help-close"]');
  if (!b) return;
  ev.stopPropagation();
  S.ui.helpOpen = false;
  render();
}, true);
ui.boot();
