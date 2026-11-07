import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'drei',
  maxPlayers: 2,
  // Die Lernrunde läuft immer auf dem kleinen Feld (3×3)
  newGame: (players, opts) => { resetUi(); return M.createGame(players, S.learn ? { big: false } : opts); },
  onMessage: (state, pid, msg) => {
    // „Noch eine Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    M.handle(state, pid, msg);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 700,
    step: (g, level) => {
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
function resetUi() { S.ui = { ...(S.ui || {}), hint: '', sig: '' }; }
resetUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

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

// ====================== Zeichen ======================
// Kreuz: zwei dicke Striche (blau). Kreis: dicker Ring (orange). Unterscheidbar auch ohne Farbe.
function markSvg(c, cls = 'dr-mark') {
  return c === 0
    ? `<svg class="${cls} x" viewBox="0 0 100 100" aria-hidden="true"><path d="M24 24L76 76M76 24L24 76"/></svg>`
    : `<svg class="${cls} o" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="29"/></svg>`;
}
const markWord = (c) => M.MARK_NAMES[c];

// ====================== Darstellung ======================
function bannerHtml() {
  const g = S.game;
  const me = myIndex();
  if (g.mode === 'over') {
    const draw = g.winner === null;
    const title = draw ? 'Unentschieden!' : g.winner === me ? 'Du hast gewonnen! Glückwunsch!' : `${esc(g.players[g.winner].name)} hat gewonnen!`;
    return `<div class="banner done dr-banner"><span class="trophy" aria-hidden="true">${draw ? '🤝' : '🏆'}</span> <h1>${title}</h1></div>`;
  }
  const ap = g.players[g.turn];
  const col = markWord(g.turn);
  return ap.id === cid ? `<div class="banner mine dr-banner">Du bist dran! (${col})</div>` : `<div class="banner dr-banner">${esc(ap.name)} ist dran (${col})</div>`;
}

function scoreHtml(g) {
  const me = myIndex();
  const boxes = g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    return `<div class="dr-pl${g.turn === i && g.mode === 'play' ? ' turn' : ''}">
      <div class="dr-n">${markSvg(i, 'dr-icon')}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="dr-c">${markWord(i)}${off}</div>
      <div class="dr-p"><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Punkt' : 'Punkte'}</div></div>`;
  }).join('');
  const starter = g.players[g.starter];
  return `<section class="card dr-score" aria-label="Punktestand">${boxes}
    <p class="dr-round">Runde ${g.round} · ${starter.id === cid ? 'Du beginnst' : esc(starter.name) + ' beginnt'}</p></section>`;
}

function boardHtml(g) {
  const me = myIndex();
  const canTap = g.mode === 'play' && me >= 0 && g.turn === me;
  const win = new Set(g.line || []);
  const n = g.size;
  const cells = g.board.map((c, p) => {
    const r = Math.floor(p / n) + 1; const col = (p % n) + 1;
    const what = c === null ? 'frei' : markWord(c);
    const free = c === null && canTap;
    const cls = ['dr-cell', c === 0 ? 'mx' : c === 1 ? 'mo' : 'me', free ? 'free' : '', win.has(p) ? 'win' : '', g.last && g.last.p === p && g.mode === 'play' ? 'last' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-act="cell" data-p="${p}"${free ? ' data-hint="free"' : ''} aria-label="Zeile ${r}, Spalte ${col}: ${what}${win.has(p) ? ', gehört zur Gewinnreihe' : ''}"${c !== null || !canTap ? ' aria-disabled="true"' : ''}>${c === null ? '' : markSvg(c)}</button>`;
  }).join('');
  return `<div class="dr-board n${n}${g.mode === 'over' ? ' ended' : ''}" id="board" role="group" aria-label="Spielfeld" style="--n:${n}">${cells}</div>`;
}

function statusHtml(g) {
  const me = myIndex();
  const hint = S.ui.hint ? `<div class="dr-hint" role="alert">${esc(S.ui.hint)}</div>` : '';
  if (g.mode === 'over') {
    const draw = g.winner === null;
    const text = draw
      ? 'Unentschieden: Das Feld ist voll. Niemand bekommt einen Punkt.'
      : `${g.k === 3 ? 'Drei' : 'Vier'} in einer Reihe! ${g.winner === me ? 'Du bekommst' : esc(g.players[g.winner].name) + ' bekommt'} einen Punkt.`;
    const again = S.role === 'host'
      ? `<button class="btn primary huge" data-act="next">▶ Noch eine Runde</button>`
      : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
    return `<p class="big">${text}</p>${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button>`;
  }
  const isMe = g.turn === me;
  const ap = g.players[g.turn];
  const text = isMe
    ? `Du setzt ein ${markWord(me)}. Tippe auf ein freies Feld (gelb umrandet).`
    : `${esc(ap.name)} setzt gleich ein ${markWord(g.turn)} …`;
  return `<p class="big">${text}</p>${hint}`;
}

function gameHtml() {
  const g = S.game;
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    ${scoreHtml(g)}
    <section class="card dr-board-card">${boardHtml(g)}</section>
    <section class="card dr-status action">${statusHtml(g)}</section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Setze drei gleiche Zeichen in eine Reihe, bevor das deinem Gegenüber gelingt.</p>
    <h3>Das Spielfeld</h3>
    <p>Das Feld hat 9 Felder: 3 Reihen mit je 3 Feldern. Eine Person spielt das <b>Kreuz</b> (blau, zwei gekreuzte Striche), die andere den <b>Kreis</b> (orange, ein Ring). Die Zeichen sind auch an der Form zu erkennen, nicht nur an der Farbe.</p>
    <h3>So setzt du ein Zeichen</h3>
    <p>Ihr setzt abwechselnd ein Zeichen. Wer dran ist, steht oben auf dem grünen Balken. Tippe dann auf ein freies Feld. Freie Felder sind gelb umrandet. Besetzte Felder kannst du nicht benutzen.</p>
    <h3>Wer gewinnt?</h3>
    <ul>
      <li>Wer drei gleiche Zeichen in einer Reihe hat, gewinnt die Runde. Die Reihe darf waagerecht, senkrecht oder schräg sein.</li>
      <li>Die Gewinnreihe leuchtet grün.</li>
      <li><b>Unentschieden:</b> Ist das ganze Feld voll und niemand hat eine Reihe, gewinnt niemand.</li>
    </ul>
    <h3>Mehrere Runden und Punkte</h3>
    <ul>
      <li>Wer eine Runde gewinnt, bekommt 1 Punkt. Bei einem Unentschieden bekommt niemand einen Punkt.</li>
      <li>Den Punktestand siehst du oben im Spiel.</li>
      <li>Nach jeder Runde kann der Gastgeber auf „Noch eine Runde“ tippen. Dann beginnt die andere Person.</li>
      <li>Mit „Spiel beenden“ hörst du auf, wann du möchtest.</li>
    </ul>
    <h3>Großes Feld</h3>
    <p>Vor dem Start kannst du die Option „Großes Feld“ ankreuzen. Dann hat das Feld 5 mal 5 Felder, und es gewinnt, wer <b>vier</b> gleiche Zeichen in einer Reihe hat. Das Spiel dauert dann etwas länger.</p>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur erlaubte Züge möglich sind, und erkennt das Spielende von allein.</p>
`;
}

// ====================== Bedienung ======================
function tap(p) {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode !== 'play' || me < 0) return;
  if (g.turn !== me) { S.ui.hint = 'Du bist gerade nicht an der Reihe. Bitte warte einen Moment.'; return render(); }
  if (g.board[p] !== null) { S.ui.hint = 'Dieses Feld ist schon besetzt. Tippe auf ein freies Feld.'; return render(); }
  S.ui.hint = '';
  return sess.send({ t: 'place', p });
}

const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: [
    { id: 'big', label: 'Großes Feld: 5×5, vier in einer Reihe', help: 'Das Feld hat 5 mal 5 Felder. Wer zuerst vier gleiche Zeichen in einer Reihe hat, gewinnt. Das Spiel dauert etwas länger.', def: false },
  ],
  title: 'Drei gewinnt', icon: '⭕', sub: 'Das klassische Spiel mit Kreuz und Kreis – online für zwei',
  helpTitle: 'Die Spielregeln von Drei gewinnt', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'cell': return tap(Number(el.dataset.p));
      case 'next': return S.role === 'host' ? sess.send({ t: 'next' }) : undefined;
    }
    return undefined;
  },
});
function render() { ui.render(); }
// Der Schließen-Knopf im Hilfefenster liegt im Fenster, dessen Klick nicht nach oben weitergereicht wird (ui.js).
// Darum fangen wir diesen Klick schon vorher ab.
$app.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('.modal [data-act="help-close"]');
  if (!b) return;
  ev.stopPropagation();
  S.ui.helpOpen = false;
  render();
}, true);
ui.boot();
