import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'vr',
  maxPlayers: 2,
  // Die Lernrunde läuft immer auf dem normalen Brett (7×6)
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
function resetUi() { S.ui = { ...(S.ui || {}), hint: '', sig: '', animSig: '' }; }
resetUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
let animTimer = null;

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.round}|${g.moveNo}|${g.turn}|${g.mode}`;
    if (sig !== S.ui.sig) {
      // Fall-Animation nur für einen Stein, der gerade neu dazukam
      S.ui.animSig = S.ui.sig && g.last ? `${g.round}|${g.moveNo}` : '';
      S.ui.sig = sig; S.ui.hint = '';
      clearTimeout(animTimer);
      animTimer = setTimeout(() => { S.ui.animSig = ''; }, 900);
    }
  }
  const view = `${S.screen}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Steine ======================
// Gelb: runder Stein mit dunklem Punkt (●). Rot: runder Stein mit weißer Raute (◆). Auch ohne Farbe unterscheidbar.
function discSvg(c, cls = 'vr-disc', extra = '') {
  const inner = c === 0
    ? '<circle cx="50" cy="50" r="15" fill="#5a4300"/>'
    : '<path d="M50 33L67 50L50 67L33 50Z" fill="#fff"/>';
  return `<svg class="${cls} ${c === 0 ? 'y' : 'r'}${extra}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" class="d"/><circle cx="50" cy="50" r="31" class="rim"/>${inner}</svg>`;
}
const colorWord = (c) => M.COLOR_NAMES[c];
const colorMark = (c) => (c === 0 ? '●' : '◆');

// ====================== Darstellung ======================
function bannerHtml() {
  const g = S.game;
  const me = myIndex();
  if (g.mode === 'over') {
    const draw = g.winner === null;
    const title = draw ? 'Unentschieden!' : g.winner === me ? 'Du hast gewonnen! Glückwunsch!' : `${esc(g.players[g.winner].name)} hat gewonnen!`;
    return `<div class="banner done vr-banner"><span class="trophy" aria-hidden="true">${draw ? '🤝' : '🏆'}</span> <h1>${title}</h1></div>`;
  }
  const ap = g.players[g.turn];
  const col = `${colorWord(g.turn)}&nbsp;${colorMark(g.turn)}`;
  return ap.id === cid ? `<div class="banner mine vr-banner">Du bist dran! (${col})</div>` : `<div class="banner vr-banner">${esc(ap.name)} ist dran (${col})</div>`;
}

function scoreHtml(g) {
  const me = myIndex();
  const boxes = g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    return `<div class="vr-pl${g.turn === i && g.mode === 'play' ? ' turn' : ''}">
      <div class="vr-n">${discSvg(i, 'vr-icon')}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="vr-c">${colorWord(i)} ${colorMark(i)}${off}</div>
      <div class="vr-p"><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Punkt' : 'Punkte'}</div></div>`;
  }).join('');
  const starter = g.players[g.starter];
  return `<section class="card vr-score" aria-label="Punktestand">${boxes}
    <p class="vr-round">Runde ${g.round} · ${starter.id === cid ? 'Du beginnst' : esc(starter.name) + ' beginnt'}</p></section>`;
}

function boardHtml(g) {
  const me = myIndex();
  const canTap = g.mode === 'play' && me >= 0 && g.turn === me;
  const win = new Set(g.line || []);
  const anim = S.ui.animSig && S.ui.animSig === `${g.round}|${g.moveNo}`;
  const colsHtml = [];
  for (let c = 0; c < g.cols; c++) {
    const full = M.colFull(g, c);
    let cells = '';
    let stones = 0;
    for (let r = 0; r < g.rows; r++) {
      const p = r * g.cols + c;
      const v = g.board[p];
      if (v === null) { cells += '<span class="vr-cell"><span class="vr-hole"></span></span>'; continue; }
      stones++;
      const isLast = g.last && g.last.p === p;
      const extra = `${win.has(p) ? ' win' : ''}${isLast && g.mode === 'play' ? ' last' : ''}${isLast && anim ? ' drop' : ''}`;
      const style = isLast && anim ? ` style="--fall:${r + 1}"` : '';
      cells += `<span class="vr-cell"${style}>${discSvg(v, 'vr-disc', extra)}</span>`;
    }
    const hint = S.learn && canTap && !full ? ' data-hint="open"' : '';
    const label = `Spalte ${c + 1}, ${full ? 'voll' : `${g.rows - stones} frei`}`;
    colsHtml.push(`<button type="button" class="vr-col${full ? ' full' : ''}${canTap ? ' mine' : ''}" data-act="col" data-c="${c}"${hint} aria-label="${label}">${cells}</button>`);
  }
  return `<div class="vr-board${g.mode === 'over' ? ' ended' : ''}" id="board" role="group" aria-label="Spielbrett" style="--cols:${g.cols};--rows:${g.rows}">${colsHtml.join('')}</div>`;
}

function statusHtml(g) {
  const me = myIndex();
  const hint = S.ui.hint ? `<div class="vr-hint" role="alert">${esc(S.ui.hint)}</div>` : '';
  const lastTxt = g.last ? `${colorWord(g.last.by)} wirft in Spalte ${g.last.col + 1}. ` : '';
  if (g.mode === 'over') {
    const draw = g.winner === null;
    const text = draw
      ? `${lastTxt}Unentschieden: Das Brett ist voll. Ihr bekommt beide ${M.pointsText(M.DRAW)}.`
      : `${lastTxt}Vier in einer Reihe! ${g.winner === me ? 'Du bekommst' : esc(g.players[g.winner].name) + ' bekommt'} ${M.pointsText(M.WIN)}.`;
    const again = S.role === 'host'
      ? `<button class="btn primary huge" data-act="next">▶ Noch eine Runde</button>`
      : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
    return `<p class="big">${text}</p>${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button>`;
  }
  const isMe = g.turn === me;
  const ap = g.players[g.turn];
  const text = isMe
    ? `${lastTxt}Du lässt einen ${colorWord(me) === "Gelb" ? "gelben" : "roten"} Stein fallen. Tippe auf eine Spalte.`
    : `${lastTxt}${esc(ap.name)} überlegt gerade …`;
  return `<p class="big">${text}</p>${hint}`;
}

function gameHtml() {
  const g = S.game;
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    ${scoreHtml(g)}
    <section class="card vr-board-card">${boardHtml(g)}</section>
    <section class="card vr-status action">${statusHtml(g)}</section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Bringe vier Steine deiner Farbe in eine Reihe, bevor das deinem Gegenüber gelingt.</p>
    <h3>Das Brett</h3>
    <p>Das Brett steht aufrecht und hat 7 Spalten mit je 6 Plätzen. Eine Person spielt <b>Gelb</b> (gelbe Steine mit dunklem Punkt ●), die andere <b>Rot</b> (rote Steine mit weißer Raute ◆). Die Steine sind auch an der Form zu erkennen, nicht nur an der Farbe.</p>
    <h3>So lässt du einen Stein fallen</h3>
    <p>Ihr seid abwechselnd dran. Wer dran ist, steht oben auf dem Balken. Tippe einfach auf eine <b>Spalte</b>. Dein Stein fällt nach unten, bis er auf dem Boden oder auf einem anderen Stein liegt. Ist eine Spalte voll, sagt dir das Spiel Bescheid, und du wählst eine andere. Der zuletzt gefallene Stein hat einen dunklen Rand.</p>
    <h3>Wer gewinnt?</h3>
    <ul>
      <li>Wer vier eigene Steine in einer Reihe hat, gewinnt die Runde. Die Reihe darf waagerecht, senkrecht oder schräg sein.</li>
      <li>Die Gewinnreihe leuchtet.</li>
      <li><b>Unentschieden:</b> Ist das ganze Brett voll und niemand hat vier in einer Reihe, gewinnt niemand.</li>
    </ul>
    <h3>Mehrere Runden und Punkte</h3>
    <ul>
      <li>Wer eine Runde gewinnt, bekommt 2 Punkte. Bei einem Unentschieden bekommen beide 1 Punkt.</li>
      <li>Den Punktestand siehst du oben im Spiel.</li>
      <li>Nach jeder Runde kann der Gastgeber auf „Noch eine Runde“ tippen. Dann beginnt die andere Person.</li>
      <li>Mit „Spiel beenden“ hörst du auf, wann du möchtest.</li>
    </ul>
    <h3>Größeres Brett</h3>
    <p>Vor dem Start kannst du die Option „Größeres Brett“ ankreuzen. Dann hat das Brett 8 Spalten mit je 7 Plätzen. Es zählen weiter vier in einer Reihe. Das Spiel dauert etwas länger.</p>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur erlaubte Züge möglich sind, und erkennt das Spielende von allein.</p>
`;
}

// ====================== Bedienung ======================
function tap(c) {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode !== 'play' || me < 0) return;
  if (g.turn !== me) { S.ui.hint = 'Du bist gerade nicht an der Reihe. Bitte warte einen Moment.'; return render(); }
  if (M.colFull(g, c)) { S.ui.hint = 'Die Spalte ist voll. Tippe bitte auf eine andere Spalte.'; return render(); }
  S.ui.hint = '';
  return sess.send({ t: 'drop', c });
}

const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: [
    { id: 'big', label: 'Größeres Brett (8×7)', help: 'Das Brett hat 8 Spalten mit je 7 Plätzen. Es zählen weiter vier in einer Reihe. Das Spiel dauert etwas länger.', def: false },
  ],
  title: 'Vier in Reihe', icon: '🟡', sub: 'Steine fallen lassen, vier in eine Reihe bringen – online für zwei',
  helpTitle: 'Die Spielregeln von Vier in Reihe', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'col': return tap(Number(el.dataset.c));
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
