import * as P from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ sel: null, sig: '' });

const sess = createSession({
  game: 'bs',
  maxPlayers: 2,
  newGame: (players, opts) => { Object.assign(S.ui, freshUi()); return P.createGame(players, S.learn ? {} : opts); },
  onMessage: (state, pid, msg) => {
    // „Noch eine Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    P.handle(state, pid, msg);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.mode !== 'play') return null;
      const bot = g.players.find((p) => String(p.id).startsWith('bot'));
      const msg = bot && chooseAction(g, bot.id, level);
      return msg ? { id: bot.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const myColor = (g) => { const i = myIndex(); return i < 0 ? 0 : (i === g.white ? 0 : 1); };

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.round}|${g.moveNo}|${g.turn}|${g.mode}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; }
  }
  render();
}

// ====================== Modell für die Anzeige ======================
function model() {
  const g = S.game;
  const me = myColor(g);
  const myTurn = g.mode === 'play' && myIndex() >= 0 && g.turn === me;
  const legal = myTurn ? P.legalMoves(g) : [];
  const movable = new Set(legal.map((m) => m.from));
  let sel = S.ui.sel;
  if (sel !== null && !movable.has(sel)) sel = S.ui.sel = null;
  const targets = new Map(); // Zielfeld -> schlägt?
  if (sel !== null) for (const m of legal) if (m.from === sel) targets.set(m.to, m.capture);
  const forced = g.opts.mustCapture && legal.some((m) => m.capture);
  return { g, me, myTurn, legal, movable, sel, targets, forced };
}

// ====================== Darstellung ======================
// Bauer als Zeichnung: Weiß hell mit dunklem Rand, Schwarz dunkel mit hellem Rand.
const PAWN_PATH = 'M50 12c-8.3 0-15 6.7-15 15 0 4.7 2.2 8.9 5.6 11.7C34 42 31 50 30 58h-4.5c-3.3 0-6 2.7-6 6v8h61V64c0-3.3-2.7-6-6-6H70c-1-8-4-16-10.6-19.3C62.8 35.9 65 31.7 65 27c0-8.3-6.7-15-15-15z';
const pawnSvg = (c, cls = 'bs-pc') => `<svg class="${cls} ${c === 0 ? 'w' : 'b'}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${PAWN_PATH}"/></svg>`;

function boardHtml(g, m, { flip = false } = {}) {
  const lastFrom = g.last ? g.last.from : -1;
  const lastTo = g.last ? g.last.to : -1;
  const meC = m ? m.me : 0;
  const cells = [];
  const ranks = [];
  const files = [];
  for (let dr = 0; dr < 8; dr++) {
    const r = flip ? dr : 7 - dr;
    ranks.push(`<span>${r + 1}</span>`);
    for (let dc = 0; dc < 8; dc++) {
      const c = flip ? 7 - dc : dc;
      const i = r * 8 + c;
      if (dr === 0) files.push(`<span>${String.fromCharCode(97 + c)}</span>`);
      const p = g.board[i];
      const cls = ['bs-sq', ((r + c) & 1) === 0 ? 'dk' : 'lt'];
      if (i === lastFrom) cls.push('from');
      if (i === lastTo) cls.push('to');
      let label = `${P.sqName(i)}: ${p ? (p === meC + 1 ? 'dein Bauer' : 'gegnerischer Bauer') : 'leeres Feld'}`;
      let interactive = false;
      if (m && m.myTurn) {
        if (m.sel === i) { cls.push('sel'); interactive = true; label += ', ausgewählt – nochmal antippen zum Abwählen'; }
        else if (m.movable.has(i)) { cls.push('can'); interactive = true; label += ', kann ziehen – antippen zum Auswählen'; }
        if (m.targets.has(i)) {
          cls.push('tgt');
          if (m.targets.get(i)) cls.push('cap');
          interactive = true;
          label = `${P.sqName(i)}: Zielfeld${m.targets.get(i) ? ' zum Schlagen' : ''}`;
        }
      }
      if (p) cls.push('has');
      const inner = p ? pawnSvg(p - 1) : '';
      cells.push(interactive
        ? `<button type="button" class="${cls.join(' ')}" data-act="sq" data-i="${i}" data-sq="${P.sqName(i)}" aria-label="${label}">${inner}</button>`
        : `<div class="${cls.join(' ')}" data-sq="${P.sqName(i)}" role="img" aria-label="${label}">${inner}</div>`);
    }
  }
  return `<div class="bs-frame" id="board" role="group" aria-label="Spielbrett">
    <div class="bs-ranks" aria-hidden="true">${ranks.join('')}</div>
    <div class="bs-grid">${cells.join('')}</div>
    <div class="bs-corner" aria-hidden="true"></div>
    <div class="bs-files" aria-hidden="true">${files.join('')}</div></div>`;
}

const cname = (c) => P.COLOR_NAMES[c];

function bannerHtml(m) {
  const g = m.g;
  if (g.mode === 'over') {
    const mine = g.winner === myIndex();
    const title = mine ? 'Du hast gewonnen!' : `${esc(g.players[g.winner].name)} hat gewonnen!`;
    return `<div class="banner done bs-banner"><span class="trophy" aria-hidden="true">🏆</span> <h1>${title}</h1></div>`;
  }
  if (m.myTurn) return `<div class="banner mine bs-banner">Du bist dran! (${cname(m.me)})</div>`;
  const t = g.players[P.playerOfColor(g, g.turn)];
  return `<div class="banner bs-banner">${esc(t.name)} ist dran (${cname(g.turn)})</div>`;
}

function scoreHtml(g) {
  const me = myIndex();
  const order = me >= 0 ? [me, 1 - me] : [0, 1];
  const boxes = order.map((i) => {
    const p = g.players[i];
    const col = i === g.white ? 0 : 1;
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const n = P.countPawns(g.board, col);
    return `<div class="bs-pl${g.mode === 'play' && g.turn === col ? ' turn' : ''}">
      <div class="bs-n">${pawnSvg(col, 'bs-icon')}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="bs-c">${cname(col)}${off}</div>
      <div class="bs-p"><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Punkt' : 'Punkte'}</div>
      <div class="bs-c">${n} ${n === 1 ? 'Bauer' : 'Bauern'} auf dem Brett</div></div>`;
  }).join('');
  const rules = `Schlagzwang: ${g.opts.mustCapture ? 'an' : 'aus'} · Im Vorbeigehen schlagen: ${g.opts.enpassant ? 'an' : 'aus'}`;
  return `<section class="card bs-score" aria-label="Punktestand">${boxes}
    <p class="bs-round">Runde ${g.round}</p><p class="bs-rules">${rules}</p></section>`;
}

function actionHtml(m) {
  const g = m.g;
  const last = g.last ? P.moveText(g.last) : (g.mode === 'play' ? 'Weiß beginnt.' : '');
  if (g.mode === 'over') {
    const me = myIndex();
    const other = g.players[1 - me] ? g.players[1 - me].name : '';
    const again = S.role === 'host'
      ? `<button class="btn primary huge" data-act="next">▶ Noch eine Runde</button><p class="muted center">In der nächsten Runde tauscht ihr die Farben.</p>`
      : `<p class="muted center">Der Gastgeber kann die nächste Runde starten. Du bleibst einfach auf dieser Seite.</p>`;
    void other;
    return `<section class="card action bs-action over"><p class="big bs-last">${esc(g.endReason || '')}</p>
      <p class="center big"><b>Punktestand:</b> ${esc(g.players[0].name)} ${g.scores[0]} : ${g.scores[1]} ${esc(g.players[1].name)}</p>
      ${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
  }
  let hint = '';
  if (m.myTurn) {
    if (m.sel !== null) hint = `<p class="bs-hint">Tippe auf ein markiertes Feld (Rahmen und Punkt). Du kannst auch einen anderen leuchtenden Bauern antippen.</p><button class="btn secondary" data-act="undo">↩ Auswahl aufheben</button>`;
    else if (m.forced) hint = `<p class="bs-hint force">Schlagzwang: Du musst einen Bauern schlagen. Tippe einen leuchtenden Bauern an.</p>`;
    else hint = `<p class="bs-hint">Tippe einen leuchtenden Bauern an, dann ein markiertes Feld.</p>`;
  } else {
    const t = g.players[P.playerOfColor(g, g.turn)];
    hint = `<p class="bs-hint">${String(t.id).startsWith('bot') ? 'Der Computer' : esc(t.name)} überlegt …</p>`;
  }
  return `<section class="card action bs-action"><p class="big bs-last">${esc(last)}</p>${hint}</section>`;
}

function gameHtml() {
  const g = S.game;
  const m = model();
  // Das Brett steht direkt unter der Statuszeile (feste Höhe); alles Wechselnde steht darunter.
  return `${ui.header()}${ui.lost()}${bannerHtml(m)}
    ${boardHtml(g, m, { flip: m.me === 1 })}
    ${actionHtml(m)}${scoreHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Bringe einen deiner Bauern bis zur letzten Reihe der anderen Seite – oder sorge dafür, dass die andere Person nicht mehr ziehen kann.</p>
    <h3>Das Brett</h3>
    <p>Das Brett hat 8 mal 8 Felder. Die Spalten heißen a bis h, die Reihen 1 bis 8. Jede Person hat nur <b>8 Bauern</b>. <b>Weiß</b> (hell) steht auf Reihe 2 und beginnt, <b>Schwarz</b> (dunkel) steht auf Reihe 7. Deine Bauern stehen immer <b>unten</b> auf deinem Bildschirm und ziehen nach oben.</p>
    <h3>So bedienst du das Spiel</h3>
    <ol>
      <li>Tippe einen <b>leuchtenden</b> Bauern an. Nur Bauern, die ziehen dürfen, leuchten.</li>
      <li>Die erlaubten <b>Zielfelder</b> bekommen einen grünen Rahmen und einen Punkt. Tippe ein Zielfeld an – der Bauer zieht dorthin.</li>
      <li>Falscher Bauer? Tippe ihn noch einmal an oder tippe auf „Auswahl aufheben“. Oder tippe einfach einen anderen leuchtenden Bauern an.</li>
    </ol>
    <h3>Wie ein Bauer zieht</h3>
    <p><b>Ein Feld geradeaus:</b> Ist das Feld direkt vor dem Bauern frei, darf er dorthin. Beispiel: Dein Bauer steht auf e3. Ist e4 frei, darfst du nach e4 ziehen.</p>
    <p><b>Zwei Felder am Anfang:</b> Steht der Bauer noch auf seinem Startfeld (Weiß auf Reihe 2, Schwarz auf Reihe 7), darf er auch zwei Felder geradeaus ziehen. Beide Felder müssen frei sein. Beispiel: Von e2 nach e4, wenn e3 und e4 frei sind.</p>
    <p><b>Schlagen:</b> Ein Bauer schlägt ein Feld <b>schräg nach vorn</b>. Der geschlagene Bauer kommt vom Brett. Beispiel: Dein Bauer steht auf e4, ein gegnerischer Bauer steht auf d5. Dann darfst du nach d5 ziehen und schlägst ihn. Geradeaus kann ein Bauer nicht schlagen. Steht ein Bauer direkt vor einem anderen, behindern sie sich.</p>
    <p><b>Im Vorbeigehen schlagen (en passant):</b> Macht ein gegnerischer Bauer den Doppelschritt und landet direkt neben deinem Bauern, darfst du ihn schlagen, als wäre er nur ein Feld gezogen. Das geht nur <b>sofort im nächsten Zug</b>. Beispiel: Dein Bauer steht auf e5. Der Gegner zieht von d7 nach d5. Du darfst nach d6 ziehen, und der Bauer auf d5 ist geschlagen. Diese Regel kannst du beim Eröffnen des Spiels ausschalten.</p>
    <p><b>Schlagzwang (nur wenn eingeschaltet):</b> Wer schlagen kann, muss schlagen. Standardmäßig ist er ausgeschaltet.</p>
    <p>Bauern ziehen nie rückwärts. Es gibt keine Umwandlung.</p>
    <h3>Wer gewinnt?</h3>
    <ul>
      <li>Ein Bauer erreicht die <b>letzte Reihe</b> der anderen Seite (Weiß Reihe 8, Schwarz Reihe 1). Das gewinnt sofort.</li>
      <li>Alle Bauern der anderen Person sind geschlagen.</li>
      <li>Die andere Person ist am Zug und kann <b>nicht ziehen</b>, weil alle ihre Bauern blockiert sind. Wer nicht ziehen kann, verliert.</li>
    </ul>
    <h3>Mehrere Runden</h3>
    <p>Wer eine Runde gewinnt, bekommt 1 Punkt. Mit „Noch eine Runde“ spielt ihr weiter, dabei tauscht ihr die Farben. Den Punktestand siehst du unter dem Brett. Mit „Spiel beenden“ hört ihr auf.</p>
    <p class="muted">Keine Sorge: Das Programm achtet selbst auf alle Regeln. Du kannst keinen unerlaubten Zug machen. Welchen Zug du wählst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
function tapSquare(i) {
  const m = model();
  if (!m.myTurn) return;
  if (m.sel === null) {
    if (m.movable.has(i)) S.ui.sel = i;
    return render();
  }
  if (i === m.sel) { S.ui.sel = null; return render(); }
  if (m.targets.has(i)) {
    const from = m.sel;
    S.ui.sel = null;
    sess.send({ t: 'move', from, to: i });
    return render();
  }
  if (m.movable.has(i)) { S.ui.sel = i; return render(); }
}

const ui = createUI({
  sess, $app,
  title: 'Bauernrennen', icon: '♟', sub: 'Nur Bauern auf dem Brett – wer kommt zuerst ans Ziel? Für zwei, online zusammen spielen',
  helpTitle: 'Die Spielregeln von Bauernrennen', helpBody: helpBody(),
  bots: [1], levels: ['Leicht', 'Mittel'],
  options: [
    { id: 'enpassant', label: 'Im Vorbeigehen schlagen erlauben', help: 'Ein Bauer darf nach einem Doppelschritt sofort „im Vorbeigehen“ geschlagen werden (en passant).', def: true },
    { id: 'mustCapture', label: 'Schlagzwang', help: 'Wer schlagen kann, muss schlagen.', def: false },
  ],
  tutorial: { bots: 1, coach },
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'sq': return tapSquare(Number(el.dataset.i));
      case 'undo': S.ui.sel = null; return render();
      case 'next': return S.role === 'host' ? sess.send({ t: 'next' }) : undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
