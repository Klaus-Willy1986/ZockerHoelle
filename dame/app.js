import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ path: [], confirmResign: false, sig: '' });

const sess = createSession({
  game: 'dame',
  maxPlayers: 2,
  newGame: (players) => { Object.assign(S.ui, freshUi()); return P.createGame(players); },
  onMessage: (state, pid, msg) => { P.handle(state, pid, msg); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const colorWord = (i) => P.COLOR_NAMES[i];
const dot = (i, extra = '') => `<span class="dm-dot ${i === 0 ? 'w' : 'b'} ${extra}" aria-hidden="true"></span>`;

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.moveNo}|${g.mode}|${g.turn}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.path = []; S.ui.confirmResign = false; }
  }
  render();
}

// ====================== Modell für die Anzeige ======================
function model() {
  const g = S.game;
  const me = myIndex();
  const myTurn = !!g && g.mode === 'normal' && g.turn === me;
  const legal = myTurn ? P.legalMoves(g) : [];
  let path = S.ui.path;
  const pre = (m) => path.every((v, k) => m.path[k] === v);
  let cands = legal.filter((m) => m.path.length > path.length && pre(m));
  if (path.length && !cands.length) { path = S.ui.path = []; cands = legal; }
  if (!path.length) cands = legal;
  const forced = legal.some((m) => m.caps.length > 0);
  const movable = new Set(path.length ? [] : legal.map((m) => m.from));
  // Bei nur einem gewählten Stein darf man auch einen anderen beweglichen Stein wählen
  const others = new Set(path.length === 1 ? legal.map((m) => m.from) : []);
  const targets = new Map(); // Feld -> schlägt?
  if (path.length) for (const m of cands) targets.set(m.path[path.length], m.caps.length > 0);
  const gone = new Set(path.length > 1 && cands.length ? cands[0].caps.slice(0, path.length - 1) : []);
  return { g, me, myTurn, legal, forced, path, movable, others, targets, gone };
}

// ====================== Darstellung ======================
function boardHtml(g, { m = null, flip = false, small = false } = {}) {
  const path = m ? m.path : [];
  const board = g.board.slice();
  if (path.length > 1) { board[path[path.length - 1]] = board[path[0]]; board[path[0]] = 0; }
  const lastSet = new Set(g.last ? g.last.path : []);
  const pathSet = new Set(path);
  const cells = [];
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr;
      const c = flip ? 7 - dc : dc;
      const i = r * 8 + c;
      if (!P.isDark(i)) { cells.push('<div class="dm-sq lt"></div>'); continue; }
      const p = board[i];
      const cls = ['dm-sq', 'dk'];
      let inner = '';
      if (p) {
        const who = P.ownerOf(p);
        inner = `<span class="dm-pc ${who === 0 ? 'w' : 'b'}${P.isDame(p) ? ' k' : ''}${m && m.gone.has(i) ? ' gone' : ''}"></span>`;
      }
      if (lastSet.has(i)) cls.push('last');
      if (pathSet.has(i)) cls.push('path');
      let label = p ? `${P.ownerOf(p) === g.players.findIndex((x) => x.id === cid) ? 'Dein' : 'Gegnerischer'} ${P.isDame(p) ? 'Dame' : 'Stein'}` : 'Leeres Feld';
      let interactive = false;
      if (m && m.myTurn) {
        if (path.length > 1 && i === path[path.length - 1]) cls.push('cur');
        if (path.length === 1 && i === path[0]) { cls.push('sel'); interactive = true; label += ', ausgewählt – nochmal antippen zum Abwählen'; }
        else if (m.movable.has(i) || m.others.has(i)) { cls.push('can'); interactive = true; label += ', kann ziehen – antippen zum Auswählen'; }
        if (m.targets.has(i)) { cls.push('tgt'); if (m.targets.get(i)) cls.push('cap'); interactive = true; label = m.targets.get(i) ? 'Zielfeld zum Schlagen' : 'Zielfeld'; }
      }
      cells.push(interactive
        ? `<button class="${cls.join(' ')}" data-act="sq" data-i="${i}" aria-label="${label}">${inner}</button>`
        : `<div class="${cls.join(' ')}" role="img" aria-label="${label}">${inner}</div>`);
    }
  }
  return `<div class="dm-board${small ? ' small' : ''}" id="board">${cells.join('')}</div>`;
}

const capText = (name, n, you) => {
  const who = you ? 'Du hast' : `${esc(name)} hat`;
  if (n === 0) return `${who} noch keinen Stein geschlagen.`;
  return `${who} ${n === 1 ? 'einen Stein' : n + ' Steine'} geschlagen.`;
};

function playerCard(g, i) {
  const p = g.players[i];
  const you = p.id === cid;
  const l = S.lobby.find((x) => x.id === p.id);
  const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
  const n = P.countPieces(g.board, i);
  const kings = g.board.filter((x) => P.ownerOf(x) === i && P.isDame(x)).length;
  return `<div class="dm-pl${g.mode === 'normal' && g.turn === i ? ' turn' : ''}">${dot(i)}
    <div><b>${esc(p.name)}${you ? ' (du)' : ''}</b> – ${colorWord(i)}${off}<br>
    ${capText(p.name, g.captured[i], you)}<br><span class="dm-note">Auf dem Brett: ${n} ${n === 1 ? 'Stein' : 'Steine'}${kings ? `, davon ${kings} ${kings === 1 ? 'Dame' : 'Damen'}` : ''}</span></div></div>`;
}

function bannerHtml(m) {
  const g = m.g;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  if (m.myTurn) return `<div class="banner mine">${dot(m.me, 'dm-banner-dot')}Du bist dran!</div>`;
  const t = g.players[g.turn];
  return `<div class="banner">${dot(g.turn, 'dm-banner-dot')}${esc(t.name)} ist dran</div>`;
}

function hintHtml(m) {
  if (!m.myTurn) return '';
  let html;
  if (m.path.length > 1) {
    html = `<div class="dm-hint force">Du musst weiterschlagen! Tippe das grün markierte Feld an.</div>`;
  } else if (m.path.length === 1) {
    html = `<div class="dm-hint${m.forced ? ' force' : ''}">${m.forced ? 'Schlagzwang: ' : ''}Tippe jetzt das grün markierte Feld an. Du kannst auch einen anderen leuchtenden Stein wählen.</div>`;
  } else if (m.forced) {
    html = `<div class="dm-hint force">Schlagzwang: Du musst schlagen! Tippe einen leuchtenden Stein an.</div>`;
  } else {
    html = `<div class="dm-hint">Tippe einen leuchtenden Stein an, dann das grün markierte Zielfeld.</div>`;
  }
  if (m.path.length) html += `<button class="btn secondary" data-act="undo">↩ ${m.path.length > 1 ? 'Zug von vorn beginnen' : 'Auswahl aufheben'}</button>`;
  return html;
}

function drawHtml(m) {
  const g = m.g;
  if (g.mode !== 'normal' || g.drawOffer === null) return '';
  if (g.drawOffer === m.me) {
    return `<section class="card confirm"><p class="big">Du hast Remis angeboten. Bitte warte auf die Antwort von ${esc(g.players[1 - m.me].name)}.</p>
      <button class="btn ghost" data-act="draw-cancel">Angebot zurückziehen</button></section>`;
  }
  return `<section class="card confirm"><p class="big"><b>${esc(g.players[g.drawOffer].name)}</b> bietet dir Remis (Unentschieden) an. Möchtest du?</p>
    <button class="btn primary huge" data-act="draw-accept">✔ Remis annehmen</button>
    <button class="btn secondary huge" data-act="draw-decline">Nein, weiterspielen</button></section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function actionsHtml(m) {
  const g = m.g;
  const other = g.players[1 - m.me]?.name || '';
  if (S.ui.confirmResign) {
    return `<section class="card confirm bad dm-actions"><p class="big">Wirklich aufgeben? Dann hat ${esc(other)} gewonnen.</p>
      <button class="btn secondary huge" data-act="resign-yes">Ja, ich gebe auf</button>
      <button class="btn primary huge" data-act="resign-no">Nein, weiterspielen</button></section>`;
  }
  const canOffer = P.canOfferDraw(g, m.me);
  return `<section class="card dm-actions"><div class="dm-sidebtns">
    <button class="btn secondary" data-act="draw-offer" ${canOffer ? '' : 'disabled'}>🤝 Remis anbieten</button>
    <button class="btn ghost" data-act="resign">🏳 Aufgeben</button></div>
    ${!canOffer && g.drawOffer === null && g.offerBlock[m.me] >= 0 ? '<p class="dm-note center">Remis anbieten geht wieder, nachdem ihr eine Runde weitergespielt habt.</p>' : ''}</section>`;
}

function gameHtml() {
  const g = S.game;
  const m = model();
  if (g.mode === 'over') return overHtml(m);
  const flip = m.me === 1;
  const top = flip ? 0 : 1; // Gegenüber oben, ich unten
  const bottom = flip ? 1 : 0;
  return `${headerHtml()}${lostHtml()}${bannerHtml(m)}${drawHtml(m)}${hintHtml(m)}
    ${playerCard(g, m.me >= 0 ? 1 - m.me : top)}
    ${boardHtml(g, { m, flip })}
    ${playerCard(g, m.me >= 0 ? m.me : bottom)}
    ${recapHtml(g)}${m.me >= 0 ? actionsHtml(m) : ''}`;
}

function overHtml(m) {
  const g = m.g;
  const draw = g.winner === 'draw';
  const win = draw ? null : g.players[g.winner];
  const mine = !draw && g.winner === m.me;
  const title = draw ? 'Remis – unentschieden' : mine ? 'Du hast gewonnen! 🎉' : `${esc(win.name)} hat gewonnen!`;
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">♛ Noch eine Partie spielen</button><p class="muted center">Beim nächsten Spiel tauscht ihr die Farben.</p>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">${draw ? '🤝' : '🏆'}</div><h1>${title}</h1><p class="center big">${esc(g.endReason || '')}</p>
    ${boardHtml(g, { m: null, flip: m.me === 1, small: true })}
    <p class="center">${capText(g.players[0].name, g.captured[0], g.players[0].id === cid)}<br>${capText(g.players[1].name, g.captured[1], g.players[1].id === cid)}</p>
    ${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Schlage alle Steine der anderen Person – oder sorge dafür, dass sie nicht mehr ziehen kann.</p>
    <h3>Das Brett</h3>
    <p>Gespielt wird nur auf den <b>dunklen Feldern</b>. Jede Person hat 12 Steine. Deine Steine stehen immer <b>unten</b> auf deinem Bildschirm. Die erste Person (Gastgeber) spielt <b>Weiß</b> und beginnt, die zweite spielt <b>Schwarz</b>. Beim nächsten Spiel tauscht ihr die Farben.</p>
    <h3>So bedienst du das Spiel</h3>
    <ol>
      <li>Tippe einen <b>leuchtenden</b> Stein an. Nur Steine, die ziehen dürfen, leuchten.</li>
      <li>Die erlaubten <b>Zielfelder werden grün</b> markiert. Tippe ein Zielfeld an – fertig.</li>
      <li>Hast du den falschen Stein erwischt? Tippe ihn noch einmal an oder tippe auf „Auswahl aufheben“.</li>
    </ol>
    <h3>Ziehen</h3>
    <p>Ein normaler Stein zieht ein Feld <b>schräg vorwärts</b> auf ein freies Feld.</p>
    <h3>Schlagen</h3>
    <p>Steht ein gegnerischer Stein schräg neben deinem Stein und dahinter ist das Feld frei, springst du darüber. Der übersprungene Stein ist geschlagen. Normale Steine dürfen dabei auch <b>rückwärts</b> schlagen.</p>
    <p><b>Schlagzwang:</b> Wer schlagen kann, <b>muss</b> schlagen. Du darfst frei wählen, welchen Stein du schlägst – es muss nicht die größte Beute sein. Dann leuchten nur die Steine, die schlagen dürfen.</p>
    <p><b>Mehrfachsprung:</b> Kannst du nach dem Sprung von der neuen Position aus gleich weiterschlagen, <b>musst</b> du weiterschlagen. Dabei darfst du die Richtung wechseln. Tippe dazu nacheinander die grün markierten Felder an. Geschlagene Steine werden erst am Ende des Zugs vom Brett genommen. Bis dahin bleiben sie (blass) liegen, versperren den Weg und dürfen nicht noch einmal übersprungen werden.</p>
    <h3>Die Dame</h3>
    <p>Erreicht ein Stein die <b>letzte Reihe</b> (die Grundreihe der anderen Seite), wird er am Ende des Zugs zur <b>Dame</b> und bekommt eine Krone ♛. Erreicht ein Stein die letzte Reihe mitten in einem Mehrfachsprung, springt er als normaler Stein weiter, wenn er kann. Er wird erst am Ende des Zugs zur Dame – im selben Zug schlägt er nicht mehr als Dame weiter.</p>
    <p>Die Dame zieht beliebig viele freie Felder schräg, <b>vorwärts und rückwärts</b>. Sie schlägt auch aus der Entfernung: Sie springt über genau einen gegnerischen Stein und darf dahinter auf <b>jedes freie Feld</b> derselben Linie landen. Kann sie von einem Landefeld aus weiterschlagen, musst du auf einem Feld landen, von dem das möglich ist.</p>
    <h3>Spielende</h3>
    <p><b>Gewonnen</b> hat, wer alle gegnerischen Steine geschlagen hat oder wer die andere Person blockiert, sodass sie nicht mehr ziehen kann.</p>
    <p><b>Remis</b> (Unentschieden): Du kannst über „Remis anbieten“ ein Unentschieden vorschlagen. Die andere Person kann annehmen oder ablehnen. Außerdem endet das Spiel automatisch unentschieden, wenn 40 Züge in Folge weder geschlagen noch ein normaler Stein gezogen wurde (beide Seiten zusammengezählt), oder wenn dieselbe Stellung mit derselben Person am Zug zum dritten Mal entsteht.</p>
    <p><b>Aufgeben</b> ist jederzeit möglich. Vorher fragen wir noch einmal nach.</p>
    <p class="muted">Keine Sorge: Das Programm achtet selbst auf alle Regeln. Du kannst keinen unerlaubten Zug machen. Welchen Zug du wählst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
function tapSquare(i) {
  const m = model();
  if (!m.myTurn) return;
  const path = m.path;
  if (path.length === 0) {
    if (m.movable.has(i)) S.ui.path = [i];
    return render();
  }
  if (path.length === 1 && i === path[0]) { S.ui.path = []; return render(); }
  if (path.length === 1 && m.others.has(i) && !m.targets.has(i)) { S.ui.path = [i]; return render(); }
  if (m.targets.has(i)) {
    const next = [...path, i];
    const done = m.legal.some((x) => x.path.length === next.length && x.path.every((v, k) => v === next[k]));
    if (done) {
      S.ui.path = [];
      sess.send({ t: 'move', path: next });
      return render();
    }
    S.ui.path = next;
    return render();
  }
}

const ui = createUI({
  sess, $app,
  title: 'Dame', icon: '♛', sub: 'Das klassische Brettspiel für zwei – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Dame', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'sq': return tapSquare(Number(el.dataset.i));
      case 'undo': S.ui.path = []; return render();
      case 'draw-offer': return sess.send({ t: 'draw-offer' });
      case 'draw-cancel': return sess.send({ t: 'draw-cancel' });
      case 'draw-accept': return sess.send({ t: 'draw-accept' });
      case 'draw-decline': return sess.send({ t: 'draw-decline' });
      case 'resign': S.ui.confirmResign = true; return render();
      case 'resign-no': S.ui.confirmResign = false; return render();
      case 'resign-yes': S.ui.confirmResign = false; return sess.send({ t: 'resign' });
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
