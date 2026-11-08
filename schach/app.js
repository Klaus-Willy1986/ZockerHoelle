import * as P from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { pieceSvg, svgOfCode } from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ sel: null, sig: '', promo: null, msg: '' });

// Test-Hilfen über die Adresse: ?maxply=40 beendet die Partie nach 40 Halbzügen als Remis, ?fen=… startet in einer Stellung.
const query = () => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } };

const sess = createSession({
  game: 'sc',
  maxPlayers: 2,
  newGame: (players, opts) => {
    Object.assign(S.ui, freshUi());
    const g = P.createGame(players, S.learn ? { hints: true } : opts);
    const q = query();
    const mp = Number(q.get('maxply'));
    if (mp > 0) g.maxply = Math.floor(mp);
    const fen = q.get('fen');
    if (fen && !S.learn) P.setFen(g, fen);
    return g;
  },
  onMessage: (state, pid, msg) => {
    // „Noch eine Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    P.handle(state, pid, msg);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
  bot: {
    delay: 600,
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
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; S.ui.promo = null; S.ui.msg = ''; }
  }
  render();
}

// ====================== Modell für die Anzeige ======================
function model() {
  const g = S.game;
  const me = myColor(g);
  const myTurn = g.mode === 'play' && myIndex() >= 0 && g.turn === me;
  const legal = myTurn ? P.legalMoves(g) : [];
  const byFrom = new Map();
  for (const m of legal) { if (!byFrom.has(m.from)) byFrom.set(m.from, []); byFrom.get(m.from).push(m); }
  let sel = S.ui.sel;
  if (sel !== null && !byFrom.has(sel)) sel = S.ui.sel = null;
  const targets = new Map(); // Zielfeld -> Züge dorthin
  if (sel !== null) for (const m of byFrom.get(sel)) { if (!targets.has(m.to)) targets.set(m.to, []); targets.get(m.to).push(m); }
  return { g, me, myTurn, legal, byFrom, sel, targets, hints: !!g.opts.hints };
}

// ====================== Darstellung ======================
const TCLS = ['', 't-p', 't-n', 't-b', 't-r', 't-q', 't-k'];
const PIECE_DESC = ['', 'Bauer', 'Springer', 'Läufer', 'Turm', 'Dame', 'König'];

function boardHtml(g, m, { flip = false } = {}) {
  const lastFrom = g.last ? g.last.from : -1;
  const lastTo = g.last ? g.last.to : -1;
  const meC = m ? m.me : 0;
  const kingInCheck = g.check && g.mode === 'play' ? g.board.indexOf(P.pieceOf(6, g.turn)) : -1;
  const cells = []; const ranks = []; const files = [];
  for (let dr = 0; dr < 8; dr++) {
    const r = flip ? dr : 7 - dr;
    ranks.push(`<span>${r + 1}</span>`);
    for (let dc = 0; dc < 8; dc++) {
      const c = flip ? 7 - dc : dc;
      const i = r * 8 + c;
      if (dr === 0) files.push(`<span>${String.fromCharCode(97 + c)}</span>`);
      const p = g.board[i];
      const cls = ['sc-sq', ((r + c) & 1) === 0 ? 'dk' : 'lt'];
      if (i === lastFrom) cls.push('from');
      if (i === lastTo) cls.push('to');
      if (i === kingInCheck) cls.push('chk');
      const t = p ? P.typeOf(p) : 0;
      const own = p && P.pieceColor(p) === meC;
      let label = `${P.sqName(i)}: ${p ? `${own ? 'deine' : 'gegnerische'} Figur, ${PIECE_DESC[t]}${P.pieceColor(p) === 0 ? ' (Weiß)' : ' (Schwarz)'}` : 'leeres Feld'}`;
      let interactive = false;
      let inner = p ? svgOfCode(p) : '';
      if (m && m.myTurn) {
        const moves = m.byFrom.get(i);
        if (own) {
          interactive = true;
          cls.push('mine', TCLS[t]);
          if (moves) {
            if (m.hints) cls.push('can');
            if (moves.some((x) => x.capture)) cls.push('cp');
            if (moves.some((x) => x.castle)) cls.push('ck');
            if (moves.some((x) => x.ep)) cls.push('ep');
            if (moves.some((x) => x.promo)) cls.push('pr');
            label += m.sel === i ? ', ausgewählt – nochmal antippen zum Abwählen' : ', kann ziehen – antippen zum Auswählen';
          } else label += ', kann gerade nicht ziehen';
        }
        if (m.sel === i) cls.push('sel');
        if (m.sel !== null) interactive = true;
        const tg = m.targets.get(i);
        if (tg && m.hints) {
          cls.push('tgt');
          if (tg.some((x) => x.capture)) cls.push('cap');
          if (tg.some((x) => x.castle)) { cls.push('rk'); inner += pieceSvg(4, meC, 'sc-rkicon'); }
          if (tg.some((x) => x.ep)) cls.push('epx');
          if (tg.some((x) => x.promo)) cls.push('prx');
          label = `${P.sqName(i)}: Zielfeld${tg.some((x) => x.capture) ? ' zum Schlagen' : ''}${tg.some((x) => x.castle) ? ' für die Rochade' : ''}${tg.some((x) => x.promo) ? ', hier wird der Bauer umgewandelt' : ''}`;
        }
      }
      if (p) cls.push('has');
      cells.push(interactive
        ? `<button type="button" class="${cls.join(' ')}" data-act="sq" data-i="${i}" data-sq="${P.sqName(i)}" data-p="${p}" aria-label="${label}">${inner}</button>`
        : `<div class="${cls.join(' ')}" data-sq="${P.sqName(i)}" data-p="${p}" role="img" aria-label="${label}">${inner}</div>`);
    }
  }
  return `<div class="sc-frame" id="board" role="group" aria-label="Schachbrett">
    <div class="sc-ranks" aria-hidden="true">${ranks.join('')}</div>
    <div class="sc-grid">${cells.join('')}</div>
    <div class="sc-corner" aria-hidden="true"></div>
    <div class="sc-files" aria-hidden="true">${files.join('')}</div></div>`;
}

const cname = (c) => P.COLOR_NAMES[c];
const nameOf = (g, color) => g.players[P.playerOfColor(g, color)].name;

function bannerHtml(m) {
  const g = m.g;
  if (g.mode === 'over') {
    const r = g.result;
    if (r.winner === 'draw') return `<div class="banner done sc-banner"><span class="trophy" aria-hidden="true">🤝</span> <h1>Remis – unentschieden</h1></div>`;
    const mine = g.winner === myIndex();
    const title = mine ? 'Schachmatt! Du hast gewonnen!' : `Schachmatt! ${esc(g.players[g.winner].name)} hat gewonnen!`;
    return `<div class="banner done sc-banner"><span class="trophy" aria-hidden="true">🏆</span> <h1>${title}</h1></div>`;
  }
  const chk = g.check ? 'Schach! ' : '';
  if (m.myTurn) return `<div class="banner mine sc-banner${g.check ? ' check' : ''}">${chk}Du bist dran! (${cname(m.me)})</div>`;
  return `<div class="banner sc-banner${g.check ? ' check' : ''}">${chk}${esc(nameOf(g, g.turn))} ist dran (${cname(g.turn)})</div>`;
}

function capturedHtml(g) {
  const order = [5, 4, 3, 2, 1];
  const row = (byColor) => {
    const list = g.captured[byColor].slice().sort((a, b) => order.indexOf(P.typeOf(a)) - order.indexOf(P.typeOf(b)));
    const icons = list.map((p) => svgOfCode(p, 'sc-cap-pc')).join('');
    return `<div class="sc-caprow"><span class="sc-lbl">${cname(byColor)} hat geschlagen:</span>${icons || '<span class="sc-none">noch nichts</span>'}</div>`;
  };
  return `<section class="card sc-capcard" aria-label="geschlagen"><div class="sc-caprow" style="min-height:0"><b>geschlagen</b></div>${row(0)}${row(1)}</section>`;
}

function scoreHtml(g) {
  const me = myIndex();
  const order = me >= 0 ? [me, 1 - me] : [0, 1];
  const boxes = order.map((i) => {
    const p = g.players[i];
    const col = i === g.white ? 0 : 1;
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    return `<div class="sc-pl${g.mode === 'play' && g.turn === col ? ' turn' : ''}">
      <div class="sc-n">${pieceSvg(6, col, 'sc-icon')}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="sc-c">${cname(col)}${off}</div>
      <div class="sc-p"><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Punkt' : 'Punkte'}</div></div>`;
  }).join('');
  return `<section class="card sc-score" aria-label="Punktestand">${boxes}
    <p class="sc-round">Runde ${g.round}</p><p class="sc-rules">Sieg = 2 Punkte, Remis = 1 Punkt · Mögliche Felder anzeigen: ${g.opts.hints ? 'an' : 'aus'}</p></section>`;
}

function logHtml(g) {
  const items = g.log.slice(-6).reverse();
  const body = S.ui.listOpen
    ? (items.length ? `<ul class="sc-log">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Noch kein Zug gespielt.</p>')
    : '';
  return `<section class="card"><button class="btn ghost" data-act="movelist" aria-expanded="${S.ui.listOpen ? 'true' : 'false'}">${S.ui.listOpen ? '▲ Zugliste einklappen' : '▼ Letzte Züge anzeigen'}</button>${body}</section>`;
}

const PROMO_CHOICES = [['q', 5, 'Dame'], ['r', 4, 'Turm'], ['b', 3, 'Läufer'], ['n', 2, 'Springer']];

function actionHtml(m) {
  const g = m.g;
  const last = g.last ? g.last.text : (g.mode === 'play' ? 'Weiß beginnt.' : '');
  if (g.mode === 'over') {
    const again = S.role === 'host'
      ? `<button class="btn primary huge" data-act="next">▶ Noch eine Runde</button><p class="muted center">In der nächsten Runde tauscht ihr die Farben.</p>`
      : `<p class="muted center">Der Gastgeber kann die nächste Runde starten. Du bleibst einfach auf dieser Seite.</p>`;
    return `<section class="card action sc-action over"><p class="big sc-last">${esc(g.result.text)}</p>
      <p class="center big"><b>Punktestand:</b> ${esc(g.players[0].name)} ${g.scores[0]} : ${g.scores[1]} ${esc(g.players[1].name)}</p>
      ${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
  }
  let hint = '';
  if (m.myTurn && S.ui.promo) {
    hint = `<p class="sc-hint">Dein Bauer wird umgewandelt. Wähle die neue Figur:</p>
      <div class="sc-promo">${PROMO_CHOICES.map(([k, t, n]) => `<button class="btn secondary" data-act="promo" data-p="${k}">${pieceSvg(t, m.me, 'sc-big')} ${n}</button>`).join('')}</div>
      <button class="btn ghost" data-act="promo-cancel">Abbrechen</button>`;
  } else if (m.myTurn) {
    const msg = S.ui.msg ? `<p class="sc-msg" role="alert">${esc(S.ui.msg)}</p>` : '';
    if (m.sel !== null) hint = `${msg}<p class="sc-hint">${m.hints ? 'Tippe auf ein markiertes Feld (Rahmen und Punkt).' : 'Tippe auf das Feld, auf das die Figur ziehen soll.'} Zum Abwählen tippe die Figur nochmal an.</p>`;
    else hint = `${msg}<p class="sc-hint">${m.hints ? 'Tippe eine leuchtende Figur an.' : 'Tippe eine deiner Figuren an.'}${g.check ? ' Dein König steht im Schach.' : ''}</p>`;
  } else {
    const bot = String(g.players[P.playerOfColor(g, g.turn)].id).startsWith('bot');
    hint = `<p class="sc-hint">${bot ? 'Der Computer' : esc(nameOf(g, g.turn))} überlegt …</p>`;
  }
  return `<section class="card action sc-action"><p class="big sc-last">${esc(last)}</p>${hint}</section>`;
}

function gameHtml() {
  const g = S.game;
  const m = model();
  return `${ui.header()}${ui.lost()}${bannerHtml(m)}
    ${boardHtml(g, m, { flip: m.me === 1 })}
    ${capturedHtml(g)}${actionHtml(m)}${logHtml(g)}${scoreHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Setze den König der anderen Seite <b>Schachmatt</b>. Das heißt: Sein König wird angegriffen (er steht „im Schach“) und kann nicht mehr entkommen.</p>
    <h3>Das Brett</h3>
    <p>Das Brett hat 8 mal 8 Felder. Die Spalten heißen a bis h, die Reihen 1 bis 8. <b>Weiß</b> (helle Figuren) beginnt, <b>Schwarz</b> (dunkle Figuren) zieht danach. Deine Figuren stehen immer <b>unten</b> auf deinem Bildschirm.</p>
    <h3>So bedienst du das Spiel</h3>
    <ol>
      <li>Tippe eine deiner Figuren an.</li>
      <li>Die Felder, auf die sie ziehen darf, bekommen einen grünen Rahmen und einen Punkt (ein roter Ring heißt: Dort steht eine gegnerische Figur, du schlägst sie). Tippe ein markiertes Feld an – die Figur zieht dorthin.</li>
      <li>Falsche Figur? Tippe sie noch einmal an oder tippe eine andere deiner Figuren an.</li>
      <li>Tippst du auf ein Feld, das nicht erlaubt ist, sagt das Spiel freundlich Bescheid.</li>
    </ol>
    <p>Die Markierungen kannst du vor dem Spiel unter „Mögliche Felder anzeigen“ ausschalten. Dann siehst du nur die Figur, die du angetippt hast.</p>
    <h3>Wie die Figuren ziehen</h3>
    <p><b>Bauer:</b> Ein Feld geradeaus, vom Startplatz aus auch zwei Felder. Er schlägt nur schräg nach vorn. Steht etwas direkt vor ihm, ist er blockiert.</p>
    <p><b>Springer:</b> Er springt in L-Form: zwei Felder geradeaus und eins zur Seite. Er darf über andere Figuren springen.</p>
    <p><b>Läufer:</b> Beliebig weit schräg, immer auf Feldern einer Farbe.</p>
    <p><b>Turm:</b> Beliebig weit gerade, vor, zurück und zur Seite.</p>
    <p><b>Dame:</b> Wie Turm und Läufer zusammen: beliebig weit gerade und schräg.</p>
    <p><b>König:</b> Ein Feld in jede Richtung. Er darf nie auf ein Feld, das angegriffen wird.</p>
    <p>Außer dem Springer darf keine Figur über andere hinwegziehen. Zieht eine Figur auf ein Feld mit einer gegnerischen Figur, ist diese <b>geschlagen</b> und kommt vom Brett. Geschlagene Figuren siehst du als kleine Reihe unter dem Brett.</p>
    <h3>Schach</h3>
    <p>Wird ein König angegriffen, sagt das Spiel „Schach!“. Dann musst du sofort etwas dagegen tun: den König wegziehen, die angreifende Figur schlagen oder eine Figur dazwischenstellen. Du darfst nie einen Zug machen, nach dem dein eigener König im Schach steht – das Spiel lässt das nicht zu.</p>
    <h3>Besondere Züge</h3>
    <p><b>Rochade:</b> König und Turm ziehen in einem Zug. Der König geht zwei Felder zum Turm hin, der Turm springt auf die andere Seite des Königs. Du ziehst dazu den König auf das Feld mit dem Turm-Zeichen. Das geht nur, wenn König und Turm noch nie gezogen haben, zwischen ihnen alles frei ist, dein König nicht im Schach steht und nicht über oder auf ein angegriffenes Feld ziehen muss. Es gibt die kurze (zum Turm in der Ecke h) und die lange Rochade (zum Turm in der Ecke a).</p>
    <p><b>Im Vorbeigehen schlagen (en passant):</b> Zieht ein gegnerischer Bauer zwei Felder und landet direkt neben deinem Bauern, darfst du ihn sofort im nächsten Zug schlagen, als hätte er nur ein Feld gezogen. Beispiel: Dein Bauer steht auf e5, der Gegner zieht d7 nach d5. Du darfst nach d6 ziehen, und der Bauer auf d5 ist geschlagen.</p>
    <p><b>Umwandlung:</b> Erreicht ein Bauer die letzte Reihe, wird er zu einer anderen Figur. Du wählst mit großen Knöpfen: Dame, Turm, Läufer oder Springer. Der Computer wählt immer die Dame.</p>
    <h3>Wie die Partie endet</h3>
    <ul>
      <li><b>Schachmatt:</b> Der König steht im Schach und kein Zug rettet ihn. Wer matt setzt, gewinnt.</li>
      <li><b>Patt:</b> Wer am Zug ist, kann gar nicht ziehen, steht aber nicht im Schach. Das ist ein Remis (unentschieden).</li>
      <li><b>Dreifachstellung:</b> Dieselbe Stellung mit demselben Spieler am Zug kommt zum dritten Mal vor. Remis.</li>
      <li><b>50 Züge:</b> 50 Züge lang weder ein Bauer gezogen noch eine Figur geschlagen. Remis.</li>
      <li><b>Zu wenig Figuren:</b> Nur zwei Könige, König mit einem Läufer oder einem Springer gegen König, oder Läufer gegen Läufer auf gleichfarbigen Feldern. Niemand kann mehr matt setzen. Remis.</li>
    </ul>
    <p>Ein Remis-Angebot und eine Uhr gibt es nicht. Das Spiel endet von selbst, sobald eine dieser Regeln greift.</p>
    <h3>Mehrere Runden</h3>
    <p>Ein Sieg zählt 2 Punkte, ein Remis 1 Punkt für jede Seite. Mit „Noch eine Runde“ spielt ihr weiter, dabei tauscht ihr die Farben. Mit „Spiel beenden“ hört ihr auf.</p>
    <p class="muted">Keine Sorge: Das Programm achtet selbst auf alle Regeln. Welchen Zug du wählst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
function say(text) { S.ui.msg = text; }

function tapSquare(i) {
  const m = model();
  if (!m.myTurn || S.ui.promo) return;
  const p = m.g.board[i];
  const own = p && P.pieceColor(p) === m.me;
  if (m.sel !== null && i === m.sel) { S.ui.sel = null; S.ui.msg = ''; return render(); }
  if (m.sel !== null && m.targets.has(i)) {
    const list = m.targets.get(i);
    const from = m.sel;
    S.ui.msg = '';
    if (list.some((x) => x.promo)) { S.ui.promo = { from, to: i }; return render(); }
    S.ui.sel = null;
    sess.send({ t: 'move', from, to: i });
    return render();
  }
  if (own) {
    if (m.byFrom.has(i)) { S.ui.sel = i; S.ui.msg = ''; return render(); }
    say(m.g.check ? 'Diese Figur kann dem König nicht helfen und gerade nicht ziehen.' : 'Diese Figur kann gerade nicht ziehen.');
    return render();
  }
  if (m.sel !== null) { say(P.whyIllegal(m.g, m.sel, i)); return render(); }
  say('Tippe zuerst eine deiner Figuren an.');
  return render();
}

const ui = createUI({
  sess, $app,
  title: 'Schach', icon: '♞', sub: 'Das Spiel der Könige – für zwei, online zusammen spielen',
  helpTitle: 'Die Spielregeln von Schach', helpBody: helpBody(),
  bots: [1], levels: ['Leicht', 'Mittel'],
  options: [
    { id: 'hints', label: 'Mögliche Felder anzeigen', help: 'Nach dem Antippen einer Figur werden die erlaubten Felder markiert. Ohne Haken siehst du nur die gewählte Figur.', def: true },
  ],
  tutorial: { bots: 1, coach },
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'sq': return tapSquare(Number(el.dataset.i));
      case 'promo': {
        const pr = S.ui.promo;
        if (!pr) return undefined;
        S.ui.promo = null; S.ui.sel = null;
        sess.send({ t: 'move', from: pr.from, to: pr.to, promo: el.dataset.p });
        return render();
      }
      case 'promo-cancel': S.ui.promo = null; return render();
      case 'movelist': S.ui.listOpen = !S.ui.listOpen; return render();
      case 'next': return S.role === 'host' ? sess.send({ t: 'next' }) : undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
