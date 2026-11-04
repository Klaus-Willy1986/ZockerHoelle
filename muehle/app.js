import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'muehle',
  maxPlayers: 2,
  newGame: (players) => { resetUi(); return M.createGame(players); },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 900,
    // Der Computer handelt, wenn er am Zug ist oder auf ein Remis-Angebot antworten muss
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
function resetUi() { S.ui = { ...(S.ui || {}), sel: null, hint: '', confirmResign: false, sig: '' }; }
resetUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.moveNo}|${g.turn}|${g.removing}|${g.mode}|${g.drawOffer}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; S.ui.hint = ''; S.ui.confirmResign = false; }
  }
  // Beim Wechsel (Lobby → Spiel, Spiel → Ende, neues Spiel) wieder ganz nach oben springen
  const view = `${S.screen}|${g ? g.mode : ''}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Brett (SVG) ======================
const HALF = [130, 87, 43];
const CX = 150;
const COORD = Array.from({ length: 24 }, (_, p) => {
  const h = HALF[Math.floor(p / 8)];
  const [dx, dy] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]][p % 8];
  return [CX + dx * h, CX + dy * h];
});

function stoneSvg(c, x, y, r = 15) {
  return c === 0
    ? `<circle class="mh-stone-w" cx="${x}" cy="${y}" r="${r}"/><circle class="mh-stone-w-ring" cx="${x}" cy="${y}" r="${r - 6}"/>`
    : `<circle class="mh-stone-b" cx="${x}" cy="${y}" r="${r}"/><circle class="mh-stone-b-ring" cx="${x}" cy="${y}" r="${r - 6}"/>`;
}
function iconSvg(c) {
  return `<svg class="mh-icon" viewBox="0 0 30 30" aria-hidden="true">${stoneSvg(c, 15, 15, 13)}</svg>`;
}

// Was ist für mich gerade antippbar?
function options(g) {
  const me = myIndex();
  const o = { can: new Set(), targets: new Set(), rem: new Set(), free: new Set() };
  if (g.mode !== 'play' || me < 0 || g.turn !== me || g.drawOffer !== null) return o;
  if (g.removing) { M.removablePoints(g, M.other(me)).forEach((p) => o.rem.add(p)); return o; }
  if (g.toPlace[me] > 0) { M.freePoints(g).forEach((p) => o.free.add(p)); return o; }
  M.movableStones(g, me).forEach((p) => o.can.add(p));
  if (S.ui.sel !== null && g.board[S.ui.sel] === me) M.targetsFrom(g, S.ui.sel).forEach((p) => o.targets.add(p));
  return o;
}

function boardHtml(g, interactive) {
  const o = interactive ? options(g) : { can: new Set(), targets: new Set(), rem: new Set(), free: new Set() };
  const sel = S.ui.sel;
  const lines = [0, 1, 2].map((r) => `<rect class="mh-line" x="${CX - HALF[r]}" y="${CX - HALF[r]}" width="${HALF[r] * 2}" height="${HALF[r] * 2}"/>`).join('')
    + [1, 3, 5, 7].map((k) => `<line class="mh-line" x1="${COORD[k][0]}" y1="${COORD[k][1]}" x2="${COORD[16 + k][0]}" y2="${COORD[16 + k][1]}"/>`).join('');
  const dots = COORD.map(([x, y]) => `<circle class="mh-dot" cx="${x}" cy="${y}" r="4.5"/>`).join('');
  let marks = '';
  const last = g.last;
  if (last) {
    if (last.from !== null && last.from !== undefined) { const [x, y] = COORD[last.from]; marks += `<circle class="mh-last" cx="${x}" cy="${y}" r="16"/>`; }
    if (last.removed !== null && last.removed !== undefined) {
      const [x, y] = COORD[last.removed];
      marks += `<path class="mh-gone" d="M${x - 8} ${y - 8}L${x + 8} ${y + 8}M${x + 8} ${y - 8}L${x - 8} ${y + 8}"/>`;
    }
  }
  const stones = g.board.map((c, p) => {
    if (c === null) return '';
    const [x, y] = COORD[p];
    return stoneSvg(c, x, y) + (last && last.to === p ? `<circle class="mh-last" cx="${x}" cy="${y}" r="20"/>` : '');
  }).join('');
  let hl = '';
  const ring = (set, cls, r, pulse) => [...set].map((p) => `<circle class="${cls}${pulse ? ' mh-pulse' : ''}" cx="${COORD[p][0]}" cy="${COORD[p][1]}" r="${r}"/>`).join('');
  hl += ring(o.free, 'mh-free', 9, false);
  hl += ring(o.can, 'mh-can', 19, true);
  hl += ring(o.targets, 'mh-target', 12, false);
  hl += ring(o.rem, 'mh-rem', 20, true);
  if (sel !== null && interactive) hl += `<circle class="mh-sel" cx="${COORD[sel][0]}" cy="${COORD[sel][1]}" r="21"/>`;
  const hits = COORD.map(([x, y], p) => {
    const act = o.free.has(p) || o.can.has(p) || o.targets.has(p) || o.rem.has(p) || (sel === p);
    const c = g.board[p];
    const label = c === null ? 'freier Punkt' : `${M.COLOR_NAMES[c]}er Stein`.replace('Weißer', 'weißer').replace('Schwarzer', 'schwarzer');
    return `<circle class="mh-hit${act ? ' act' : ''}" data-act="${interactive ? 'pt' : 'noop'}" data-p="${p}" cx="${x}" cy="${y}" r="21"${act ? ` tabindex="0" role="button" aria-label="Punkt ${p + 1}, ${label}"` : ''}/>`;
  }).join('');
  return `<svg class="mh-board${g.mode === 'over' ? ' mh-ended' : ''}" id="mh-board" viewBox="0 0 300 300" role="group" aria-label="Spielbrett">${lines}${dots}${marks}${hl}${stones}${hits}</svg>`;
}

// ====================== Darstellung ======================
function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = g.players[g.turn];
  const col = M.COLOR_NAMES[g.turn];
  if (g.drawOffer !== null) {
    return g.drawOffer === myIndex() ? `<div class="banner">Du wartest auf eine Antwort</div>` : `<div class="banner mine">Bitte antworte auf das Remis-Angebot</div>`;
  }
  return ap.id === cid ? `<div class="banner mine">Du bist dran! (${col})</div>` : `<div class="banner">${esc(ap.name)} ist dran (${col})</div>`;
}

function playersHtml(g) {
  const me = myIndex();
  return `<div class="mh-players">${g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const placing = g.toPlace[i] > 0;
    const fly = M.canFly(g, i);
    const extra = fly ? `<span class="mh-fly">darf fliegen</span>` : '';
    return `<div class="mh-pl${g.turn === i && g.mode === 'play' ? ' turn' : ''}">
      <div class="mh-n">${iconSvg(i)}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="mh-c">${M.COLOR_NAMES[i]}${off}</div>
      <div class="mh-x">${placing ? `Noch <b>${g.toPlace[i]}</b> zu setzen<br>` : ''}<b>${M.countOn(g, i)}</b> auf dem Brett ${extra}</div></div>`;
  }).join('')}</div>`;
}

function statusHtml(g) {
  const me = myIndex();
  const isMe = g.turn === me;
  const ap = g.players[g.turn];
  const phase = M.phaseOf(g) === 'place' ? 'Phase 1: Steine setzen' : 'Phase 2: Steine ziehen';
  let html = `<span class="mh-phase">${phase}</span>`;
  if (g.drawOffer !== null) {
    if (g.drawOffer === me) {
      return html + `<div class="confirm"><p class="big">Du hast <b>Remis</b> angeboten. ${esc(g.players[1 - me].name)} überlegt noch …</p>
        <button class="btn secondary" data-act="draw-cancel">Angebot zurücknehmen</button></div>`;
    }
    return html + `<div class="confirm"><p class="big"><b>${esc(g.players[g.drawOffer].name)}</b> bietet dir <b>Remis</b> an (unentschieden). Möchtest du das annehmen?</p>
      <button class="btn primary huge" data-act="draw-accept">Annehmen (Remis)</button>
      <button class="btn secondary huge" data-act="draw-decline">Ablehnen, weiterspielen</button></div>`;
  }
  if (g.removing) {
    html += isMe
      ? `<p class="mh-status">Mühle! Tippe einen Stein des Gegners an, den du entfernen willst.</p>`
      : `<p class="mh-status">${esc(ap.name)} hat eine Mühle gebildet und entfernt gleich einen Stein.</p>`;
  } else if (g.toPlace[g.turn] > 0) {
    html += isMe
      ? `<p class="mh-status">Du setzt: noch ${g.toPlace[me]} ${g.toPlace[me] === 1 ? 'Stein' : 'Steine'}. Tippe auf einen freien Punkt.</p>`
      : `<p class="mh-status">${esc(ap.name)} setzt einen Stein …</p>`;
  } else if (isMe) {
    const fly = M.canFly(g, me);
    html += S.ui.sel !== null
      ? `<p class="mh-status">Tippe auf einen grünen Punkt, um dorthin zu ziehen. Tippe den Stein noch einmal an, um abzubrechen.</p>`
      : `<p class="mh-status">Tippe einen deiner Steine mit orangem Ring an.</p>`;
    if (fly) html += `<p class="big">Du hast nur noch 3 Steine und darfst <b>fliegen</b>: Dein Stein darf auf jeden freien Punkt springen.</p>`;
  } else {
    html += `<p class="mh-status">${esc(ap.name)} zieht gerade …</p>`;
  }
  if (S.ui.hint) html += `<div class="mh-hint" role="alert">${esc(S.ui.hint)}</div>`;
  return html;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function legendHtml(g) {
  const me = myIndex();
  const parts = [];
  if (g.mode === 'play' && g.turn === me && g.drawOffer === null) {
    if (g.removing) parts.push('<span class="l-rem">Roter Ring: darf entfernt werden</span>');
    else if (g.toPlace[me] > 0) parts.push('<span class="l-can">Oranger Punkt: frei</span>');
    else { parts.push('<span class="l-can">Oranger Ring: kann ziehen</span>'); parts.push('<span class="l-tgt">Grün: mögliches Ziel</span>'); }
  }
  if (g.last) parts.push('<span class="l-last">Blau gestrichelt: letzter Zug</span>');
  return parts.length ? `<div class="mh-legend">${parts.join('')}</div>` : '';
}

function controlsHtml(g) {
  if (g.mode !== 'play') return '';
  if (S.ui.confirmResign) {
    return `<section class="card"><div class="confirm bad"><p class="big">Möchtest du wirklich aufgeben? Dann hat ${esc(g.players[1 - myIndex()].name)} gewonnen.</p>
      <button class="btn secondary huge" data-act="resign-yes">Ja, ich gebe auf</button>
      <button class="btn primary" data-act="resign-no">Nein, weiterspielen</button></div></section>`;
  }
  return `<section class="card"><div class="mh-actions">
    <button class="btn ghost" data-act="draw-offer" ${g.drawOffer !== null ? 'disabled' : ''}>Remis anbieten</button>
    <button class="btn ghost" data-act="resign">Aufgeben</button></div></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml();
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    <section class="card mh-statcard">${statusHtml(g)}</section>
    <section class="card mh-board-card">${boardHtml(g, true)}${legendHtml(g)}</section>
    ${playersHtml(g)}
    ${recapHtml(g)}${controlsHtml(g)}`;
}

const REASONS = { two: 'Nur noch 2 Steine', blocked: 'Keine Zugmöglichkeit', resign: 'Aufgegeben', repeat: 'Remis', agreed: 'Remis' };

function overHtml() {
  const g = S.game;
  const me = myIndex();
  const draw = g.winner === null;
  const title = draw ? 'Remis – unentschieden!' : g.winner === me ? 'Du hast gewonnen! Glückwunsch!' : `${esc(g.players[g.winner].name)} hat gewonnen!`;
  const sub = draw ? '' : ` (${M.COLOR_NAMES[g.winner]})`;
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over mh-over"><div class="trophy">${draw ? '🤝' : '🏆'}</div><h1>${title}${sub}</h1>
      <p class="center"><span class="mh-reason">${esc(REASONS[g.endCode] || '')}</span></p>
      <p class="center muted">${esc(g.endReason || '')}</p>
      ${again}
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${playersHtml(g)}
    <section class="card mh-board-card">${boardHtml(g, false)}</section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Mache deinem Gegenüber so viele Steine weg, dass nur noch 2 übrig sind – oder so, dass kein Stein mehr ziehen kann.</p>
    <h3>Das Brett</h3>
    <p>Das Brett hat 24 Punkte auf drei Quadraten, die ineinander liegen. In der Mitte jeder Seite sind die Quadrate durch eine Linie verbunden. Jede Person hat 9 Steine. <b>Weiß</b> (die Person, die zuerst genannt wird) fängt an, <b>Schwarz</b> ist danach dran. Ziehen darfst du nur entlang der Linien.</p>
    <h3>Phase 1: Setzen</h3>
    <p>Ihr setzt abwechselnd je einen Stein auf einen freien Punkt, bis alle 18 Steine gesetzt sind. Tippe dazu einfach auf einen freien Punkt (orange markiert). Gesetzte Steine bleiben erst einmal liegen.</p>
    <h3>Phase 2: Ziehen</h3>
    <p>Danach zieht ihr abwechselnd: Tippe zuerst einen eigenen Stein an (nur Steine mit orangem Ring können ziehen). Die erlaubten Ziele leuchten grün. Tippe auf ein Ziel, der Stein wandert dorthin – immer nur einen Schritt auf einen freien, angrenzenden Punkt. Tippst du den gewählten Stein noch einmal an, wird die Auswahl aufgehoben.</p>
    <h3>Mühle</h3>
    <p>Hast du drei eigene Steine in einer geraden Linie (auf einer Seite eines Quadrats oder auf einer Verbindungslinie), ist das eine <b>Mühle</b>. Dann darfst du sofort einen Stein deines Gegenübers vom Brett nehmen. Tippe dazu auf einen Stein mit rotem Ring.</p>
    <ul>
      <li>Steine, die selbst in einer Mühle stehen, sind geschützt. Nur wenn <b>alle</b> Steine deines Gegenübers in Mühlen stehen, darfst du einen beliebigen nehmen.</li>
      <li>Schließt ein Zug zwei Mühlen gleichzeitig, nimmst du trotzdem nur einen Stein.</li>
      <li>Öffnest du eine Mühle und schließt sie später wieder, zählt sie erneut.</li>
      <li>Entfernte Steine kommen nicht zurück, auch nicht in Phase 1.</li>
    </ul>
    <h3>Fliegen</h3>
    <p>Hast du nur noch 3 Steine (und alle gesetzt), darfst du <b>fliegen</b>: Dann darf jeder deiner Steine auf jeden freien Punkt springen, auch wenn er weit weg ist.</p>
    <h3>Wer gewinnt?</h3>
    <ul>
      <li>Wer nach dem Setzen nur noch 2 Steine hat, hat verloren.</li>
      <li>Wer in Phase 2 keinen Stein mehr ziehen kann (und nicht fliegen darf), hat verloren.</li>
      <li><b>Remis</b> (unentschieden): Entsteht dieselbe Stellung mit derselben Person am Zug zum dritten Mal, endet das Spiel automatisch mit Remis. Außerdem kannst du Remis anbieten. Dein Gegenüber kann annehmen oder ablehnen.</li>
      <li>Du kannst jederzeit aufgeben. Dazu wirst du noch einmal gefragt.</li>
    </ul>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur erlaubte Züge möglich sind, und erkennt Mühlen und das Spielende von allein. Wie du ziehst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
function tap(p) {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode !== 'play' || me < 0 || g.turn !== me || g.drawOffer !== null) return;
  const c = g.board[p];
  S.ui.hint = '';
  if (g.removing) {
    if (c === me) S.ui.hint = 'Das ist dein eigener Stein. Tippe einen Stein deines Gegners an.';
    else if (c === null) S.ui.hint = 'Dort steht kein Stein. Tippe einen Stein deines Gegners an (roter Ring).';
    else if (!M.removablePoints(g, M.other(me)).includes(p)) S.ui.hint = 'Dieser Stein steht in einer Mühle und ist geschützt. Wähle einen Stein mit rotem Ring.';
    else return sess.send({ t: 'remove', p });
    return render();
  }
  if (g.toPlace[me] > 0) {
    if (c !== null) S.ui.hint = 'Dieser Punkt ist schon besetzt. Tippe auf einen freien Punkt.';
    else return sess.send({ t: 'place', p });
    return render();
  }
  // Ziehphase
  if (S.ui.sel !== null) {
    if (p === S.ui.sel) { S.ui.sel = null; return render(); }
    if (c === me && M.targetsFrom(g, p).length) { S.ui.sel = p; return render(); }
    if (c === null && M.targetsFrom(g, S.ui.sel).includes(p)) { const from = S.ui.sel; S.ui.sel = null; return sess.send({ t: 'move', from, to: p }); }
    S.ui.hint = c === null ? 'Dorthin darfst du nicht ziehen. Tippe auf einen grünen Punkt.' : c === me ? 'Dieser Stein kann nicht ziehen.' : 'Das ist ein Stein deines Gegners.';
    return render();
  }
  if (c === me) {
    if (M.targetsFrom(g, p).length) S.ui.sel = p;
    else S.ui.hint = 'Dieser Stein kann gerade nicht ziehen. Wähle einen Stein mit orangem Ring.';
  } else if (c === null) S.ui.hint = 'Wähle zuerst einen deiner Steine aus (oranger Ring).';
  else S.ui.hint = 'Das ist ein Stein deines Gegners. Wähle einen deiner Steine aus (oranger Ring).';
  render();
}

const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  title: 'Mühle', icon: '⚫', sub: 'Das klassische Brettspiel für zwei – online',
  helpTitle: 'Die Spielregeln von Mühle', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'pt': return tap(Number(el.dataset.p));
      case 'noop': return undefined;
      case 'draw-offer': return sess.send({ t: 'draw-offer' });
      case 'draw-cancel': return sess.send({ t: 'draw-cancel' });
      case 'draw-accept': return sess.send({ t: 'draw-accept' });
      case 'draw-decline': return sess.send({ t: 'draw-decline' });
      case 'resign': S.ui.confirmResign = true; return render();
      case 'resign-no': S.ui.confirmResign = false; return render();
      case 'resign-yes': S.ui.confirmResign = false; return sess.send({ t: 'resign' });
    }
    return undefined;
  },
});
function render() { ui.render(); }
// Tastatur: Enter/Leertaste auf einem markierten Punkt wirkt wie Antippen
$app.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList?.contains('mh-hit')) { ev.preventDefault(); ev.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
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
