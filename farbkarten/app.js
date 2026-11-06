import * as E from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const CALL_GRACE = 3500; // so lange wartet der Computer, wenn du „Letzte Karte“ noch rufen musst
const LEARN_DELAY = 2600; // in der Lernrunde spielt der Computer langsamer, damit man mitlesen kann

const freshUi = () => ({ pick: null, note: null });

const sess = createSession({
  game: 'fk',
  maxPlayers: 6,
  newGame: (players, opts) => { S.ui = { ...S.ui, ...freshUi() }; return E.createGame(players, opts, Math.random); },
  onMessage: (state, pid, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'next' && pid !== cid) return; // die nächste Runde startet nur der Gastgeber
    E.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    get delay() { return S.learn ? LEARN_DELAY : 900; },
    step: (g, level) => {
      if (!g || g.mode !== 'play') return null;
      const ap = E.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      // Wer nur noch eine Karte hat, bekommt Zeit zum Rufen, bevor der Computer weiterspielt
      if (g.call && !String(g.call.pid).startsWith('bot')) {
        if (graceKey !== `${g.gid}|${g.seq}`) {
          graceKey = `${g.gid}|${g.seq}`;
          graceUntil = Date.now() + CALL_GRACE;
          setTimeout(() => sess.send({ t: 'tick' }), CALL_GRACE + 60);
        }
        if (Date.now() < graceUntil) return null;
      }
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };
let graceKey = '';
let graceUntil = 0;
let noteTimer = null;

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const isMyTurn = (g) => g.mode === 'play' && myIndex() === g.active;

function onStateChanged() {
  const g = S.game;
  if (g && S.ui.pick) {
    const i = myIndex();
    if (!g || i < 0 || g.mode !== 'play' || g.active !== i || g.stage !== 'play' || !g.players[i].hand.includes(S.ui.pick)) S.ui.pick = null;
  }
  render();
}
function setNote(text) {
  S.ui.note = text;
  render();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { S.ui.note = null; render(); }, 4500);
}

// ====================== Darstellung der Karten ======================
const SHAPE = { R: 'circle', B: 'square', G: 'triangle', Y: 'diamond' };
const SHAPE_NAME = { R: 'Kreis', B: 'Quadrat', G: 'Dreieck', Y: 'Raute' };
function shapeSvg(c, cls = 'fk-shape') {
  const s = SHAPE[c];
  const body = s === 'circle' ? '<circle cx="10" cy="10" r="8"/>'
    : s === 'square' ? '<rect x="3" y="3" width="14" height="14" rx="2"/>'
      : s === 'triangle' ? '<polygon points="10,2 18.5,17 1.5,17"/>'
        : '<polygon points="10,1 19,10 10,19 1,10"/>';
  return `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">${body}</svg>`;
}
const SKIP_SVG = '<svg class="fk-sym" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3.2"/><line x1="5.6" y1="18.4" x2="18.4" y2="5.6" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
const REV_SVG = '<svg class="fk-sym" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h15"/><path d="M14 4l4 4-4 4"/><path d="M21 16H6"/><path d="M10 12l-4 4 4 4"/></g></svg>';

function faceHtml(card) {
  if (E.isWild(card)) {
    const four = card === 'W4';
    return `<span class="fk-oval fk-wildoval"><b class="fk-mid${four ? ' fk-w4' : ''}">${four ? '+4' : 'Joker'}</b></span><em class="fk-name">${four ? 'Vier ziehen' : 'Farbwahl'}</em>`;
  }
  const c = card[0], v = card[1];
  const mid = v === 'S' ? SKIP_SVG : v === 'U' ? REV_SVG : v === 'Z' ? '+2' : v;
  return `${shapeSvg(c)}<span class="fk-oval"><b class="fk-mid">${mid}</b></span><em class="fk-name">${E.COLOR_NAMES[c]}</em>`;
}
const cardClass = (card) => (E.isWild(card) ? 'fk-c-W' : 'fk-c-' + card[0]);
const cardLabel = (card) => E.cardName(card);

function backHtml(cls = '') {
  return `<span class="fk-card fk-back ${cls}" aria-hidden="true"><span class="fk-backin"><i></i><i></i><i></i><i></i></span></span>`;
}

// Eine Karte der Hand: immer ein Knopf; spielbare sind hervorgehoben, andere gedimmt
function handCardHtml(card, state) {
  const cls = ['fk-card', cardClass(card), state.ok ? 'fk-ok' : state.dim ? 'fk-no' : '', state.fresh ? 'fk-new' : ''].filter(Boolean).join(' ');
  const label = cardLabel(card) + (state.ok ? ', kann gelegt werden' : '');
  return `<button type="button" class="${cls}" data-act="play" data-card="${card}" aria-label="${esc(label)}">${faceHtml(card)}</button>`;
}
function miniCardHtml(card) {
  return `<span class="fk-card fk-mini ${cardClass(card)}" role="img" aria-label="${esc(cardLabel(card))}">${faceHtml(card)}</span>`;
}

// ====================== Spielfeld ======================
function oppHtml(g, i) {
  const p = g.players[i];
  const l = S.lobby.find((x) => x.id === p.id);
  const off = l && !l.connected ? '<span class="offline"> (nicht verbunden)</span>' : '';
  const act = g.mode === 'play' && i === g.active;
  const n = p.hand.length;
  const backs = Array.from({ length: Math.min(n, 10) }, () => '<i class="fk-mb"></i>').join('');
  const count = n === 1 ? '<span class="fk-last">Letzte Karte!</span>' : `<span class="fk-ctext"><b>${n}</b> Karten</span>`;
  return `<div class="fk-opp${act ? ' fk-act' : ''}" role="group" aria-label="${esc(p.name)}: ${n} ${n === 1 ? 'Karte' : 'Karten'}${act ? ', ist dran' : ''}"><div class="fk-oname">${esc(p.name)}${off}</div>
    ${count}<span class="fk-backs" aria-hidden="true">${backs}</span></div>`;
}

function centerHtml(g) {
  const mi = myIndex();
  const mine = g.mode === 'play' && mi === g.active;
  const legal = mine ? E.legalCards(g, mi) : [];
  const pileOk = mine && g.stage === 'play' && !g.drawn && (g.pending || !legal.length);
  const top = E.topCard(g);
  const col = g.color;
  const cur = col
    ? `<div class="fk-cur fk-c-${col}">${shapeSvg(col, 'fk-curshape')}<span>${E.COLOR_NAMES[col]}</span></div>`
    : `<div class="fk-cur fk-c-W"><span>Farbe offen</span></div>`;
  const dir = `<div class="fk-dir" role="img" aria-label="${g.dir === 1 ? 'Spielrichtung: im Uhrzeigersinn' : 'Spielrichtung: gegen den Uhrzeigersinn'}"><span class="fk-arrow">${g.dir === 1 ? '↻' : '↺'}</span><small>${g.dir === 1 ? 'Richtung' : 'andere Richtung'}</small></div>`;
  const pend = g.pending ? `<div class="fk-pend">Strafe: <b>${g.pending.n}</b> Karten</div>` : '';
  let overlay = '';
  const choosing = mine && (S.ui.pick || g.stage === 'color');
  if (choosing) {
    overlay = `<div class="fk-pickover" role="group" aria-label="Farbe wählen"><p class="fk-picktitle">Welche Farbe soll jetzt gelten?</p>
      <div class="fk-pickgrid">${E.COLORS.map((c) => `<button type="button" class="fk-colorbtn fk-c-${c}" data-act="color" data-color="${c}">${shapeSvg(c, 'fk-curshape')}<span>${E.COLOR_NAMES[c]}</span></button>`).join('')}</div>
      ${S.ui.pick ? '<button type="button" class="btn mini fk-cancel" data-act="pick-cancel">Zurück</button>' : ''}</div>`;
  }
  return `<div class="fk-center">
    <button type="button" class="fk-pile${pileOk ? ' fk-ok' : ''}" data-act="draw" aria-label="Stapel mit ${g.deck.length} Karten. Karte ziehen">${backHtml('fk-bigc')}<span class="fk-pilecount">${g.deck.length}</span></button>
    <div class="fk-disc"><span class="fk-card fk-bigc ${cardClass(top)}" role="img" aria-label="Oberste Karte: ${esc(cardLabel(top))}">${faceHtml(top)}</span></div>
    <div class="fk-info">${cur}${dir}${pend}</div>${overlay}</div>`;
}

function handHtml(g) {
  const i = myIndex();
  if (i < 0) return '<p class="muted center">Du schaust nur zu.</p>';
  const me = g.players[i];
  const mine = g.mode === 'play' && g.active === i && g.stage === 'play';
  const legal = mine ? E.legalCards(g, i) : [];
  const cards = me.hand.map((c) => handCardHtml(c, { ok: mine && (g.opts.hints || S.learn) && legal.includes(c), dim: mine && (g.opts.hints || S.learn) && !legal.includes(c), fresh: mine && g.drawn === c }));
  return `<div class="fk-hand" aria-label="Deine Karten (${me.hand.length})">${cards.join('') || '<p class="muted center">Keine Karten mehr.</p>'}</div>`;
}

function boardHtml(g) {
  const n = g.players.length;
  const mi = Math.max(0, myIndex());
  const opps = [];
  for (let k = 1; k < n; k++) opps.push(oppHtml(g, (mi + k) % n));
  return `<section id="board" class="card fk-board"><div class="fk-opps fk-n${n}">${opps.join('')}</div>${centerHtml(g)}${handHtml(g)}</section>`;
}

function bannerHtml(g) {
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  if (g.mode === 'round') return `<div class="banner done">Die Runde ist zu Ende!</div>`;
  const ap = E.activePlayer(g);
  const mine = ap.id === cid;
  if (g.stage === 'color') return mine ? `<div class="banner mine">Wähle die Farbe!</div>` : `<div class="banner">${esc(ap.name)} wählt Farbe</div>`;
  return mine ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

// Warum passt eine Karte nicht? (nur Erklärung der Regeln)
function whyNot(g, hand, card) {
  const top = E.topCard(g);
  if (g.pending) return g.pending.kind === 'Z' ? 'Jetzt passt nur eine Zwei-ziehen-Karte. Oder ziehe die Strafkarten.' : 'Jetzt passt nur ein Joker Vier ziehen. Oder ziehe die Strafkarten.';
  if (card === 'W4') return `Vier ziehen darf nur gelegt werden, wenn du keine Karte der Farbe ${E.COLOR_NAMES[g.color]} hast.`;
  const what = E.isWild(top) || E.isNumber(top) ? (E.isWild(top) ? '' : ` oder die Zahl ${top[1]}`) : ` oder das Zeichen „${E.cardName(top).split(' ').slice(1).join(' ')}“`;
  return `Diese Karte passt nicht. Sie braucht die Farbe ${E.COLOR_NAMES[g.color]}${what}.`;
}

function eventLine(g) {
  const lines = g.say && g.say.length ? g.say : g.recap.slice(-1);
  return lines.join(' ');
}

function actionHtml(g) {
  const mi = myIndex();
  const me = g.players[mi];
  const mine = isMyTurn(g);
  const ev = eventLine(g);
  const note = S.ui.note ? `<div class="notice" role="alert">${esc(S.ui.note)}</div>` : '';
  const callBtn = g.call && g.call.pid === cid && me.hand.length === 1
    ? `<button type="button" class="btn primary huge fk-call" data-act="call">📣 Letzte Karte!</button>` : '';
  let body;
  if (!mine) {
    const ap = E.activePlayer(g);
    body = `<p class="big">${ev ? esc(ev) : ''}</p><p class="muted">${g.stage === 'color' ? `${esc(ap.name)} wählt gleich eine Farbe.` : `${esc(ap.name)} ist gleich dran. Bitte einen Moment Geduld.`}</p>`;
  } else if (g.stage === 'color') {
    body = `<p class="big">${ev ? esc(ev) + ' ' : ''}Der aufgedeckte Joker lässt dich die Farbe wählen. Tippe auf eine Farbe.</p>`;
  } else {
    const legal = E.legalCards(g, mi);
    if (S.ui.pick) body = `<p class="big">Tippe auf die Farbe, die jetzt gelten soll.</p>`;
    else if (g.drawn) {
      body = `<p class="big">Du hast <b>${esc(cardLabel(g.drawn))}</b> gezogen. Sie passt! Lege sie oder behalte sie.</p>
        <button type="button" class="btn secondary huge" data-act="keep">Behalten und aussetzen</button>`;
    } else if (g.pending) {
      const k = g.pending.kind === 'Z' ? 'Zwei-ziehen' : 'Vier-ziehen';
      body = `<p class="big">${ev ? esc(ev) + ' ' : ''}Du musst <b>${g.pending.n} Karten</b> ziehen${legal.length ? ` – oder eine ${k}-Karte darauf legen` : ''}.</p>
        <button type="button" class="btn ${legal.length ? 'secondary' : 'primary'} huge" data-act="draw">${g.pending.n} Karten ziehen</button>`;
    } else if (legal.length) {
      body = `<p class="big">${ev ? esc(ev) + ' ' : ''}Tippe auf eine <b>hervorgehobene</b> Karte, um sie zu legen.</p>
        <p class="muted">Du musst eine Karte legen, wenn eine passt.</p>`;
    } else {
      body = `<p class="big">${ev ? esc(ev) + ' ' : ''}Du hast keine passende Karte. Ziehe eine Karte vom Stapel.</p>
        <button type="button" class="btn primary huge" data-act="draw">Karte ziehen</button>`;
    }
  }
  return `<section class="card action fk-action">${note}${callBtn}${body}</section>`;
}

function orderHtml(g) {
  const n = g.players.length;
  const mi = Math.max(0, myIndex());
  const names = [];
  for (let k = 0; k < n; k++) {
    const p = g.players[(((mi + g.dir * k) % n) + n) % n];
    names.push(p.id === cid ? 'Du' : esc(p.name));
  }
  return `<p class="muted small center fk-order">Reihenfolge ${g.dir === 1 ? '↻' : '↺'}: ${names.join(' → ')}</p>`;
}

// Punktestand über die Runden
function scoreHtml(g, big = false) {
  const hist = g.history.slice(-8);
  const head = hist.map((h) => `<th scope="col">R${h.round}</th>`).join('');
  const rows = g.players.map((p, i) => {
    const cells = hist.map((h) => `<td>${h.winner === i ? '<b>' + h.points + '</b>' : '–'}</td>`).join('');
    return `<tr><th scope="row">${esc(p.name)}${p.id === cid ? ' (du)' : ''}</th>${cells}<td class="fk-sum"><b>${p.total}</b></td></tr>`;
  }).join('');
  return `<section class="card fk-score"><h2>Punktestand${big ? '' : ' (wer zuerst 500 hat, gewinnt)'}</h2>
    <div class="fk-tablewrap"><table class="fk-table"><thead><tr><th scope="col">Name</th>${head}<th scope="col">Summe</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${hist.length ? '' : '<p class="muted small">Noch keine Runde gespielt. Die Punkte bekommt, wer eine Runde gewinnt.</p>'}</section>`;
}

function recapHtml(g) {
  if (!g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function roundEndHtml(g) {
  const w = g.players[g.roundWinner];
  const hands = g.players.map((p, i) => {
    const pts = E.handPoints(p.hand);
    return `<div class="fk-endrow${i === g.roundWinner ? ' fk-endwin' : ''}"><div class="fk-endname"><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b><span>${i === g.roundWinner ? 'Keine Karten mehr' : `${p.hand.length} Karten = ${pts} Punkte`}</span></div>
      <div class="fk-endcards">${p.hand.map(miniCardHtml).join('')}</div></div>`;
  }).join('');
  const next = S.role === 'host'
    ? `<button type="button" class="btn primary huge" data-act="next">▶ Nächste Runde</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  return `<section class="card action fk-roundend"><h2>${w.id === cid ? 'Du hast' : esc(w.name) + ' hat'} die Runde gewonnen!</h2>
    <p class="big">${w.id === cid ? 'Du bekommst' : 'Das gibt'} <b>${g.roundPoints} Punkte</b> für die Karten der anderen.</p>${hands}${next}</section>`;
}

function overHtml(g) {
  const rank = g.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.total - a.total);
  const win = g.players[g.winner];
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r, k) => `<li class="${r.i === g.winner ? 'win' : ''}"><span class="medal">${r.i === g.winner ? '🏆' : medals[k] || ''}</span>
    <span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.total}</span>
    <div class="rd"><span class="chip">${r.total} Punkte</span></div></li>`).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎴 Neues Spiel</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over"><div class="trophy">🏆</div><h1>${esc(win.name)} gewinnt das Spiel!</h1>
    <p class="center muted">${esc(win.name)} hat ${win.total} Punkte erreicht – nach ${g.history.length} ${g.history.length === 1 ? 'Runde' : 'Runden'}.</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${scoreHtml(g, true)}${recapHtml(g)}`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml(g);
  const tail = g.mode === 'round' ? roundEndHtml(g) : actionHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${boardHtml(g)}${tail}${g.mode === 'play' ? orderHtml(g) : ''}${scoreHtml(g)}${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Werde als Erste/r alle deine Karten los. Wer das schafft, gewinnt die Runde und bekommt Punkte. Wer zuerst <b>500 Punkte</b> hat, gewinnt das ganze Spiel.</p>
    <h3>Die Karten</h3>
    <p>Es gibt Karten in vier Farben: <b>Rot</b> (Kreis), <b>Gelb</b> (Raute), <b>Grün</b> (Dreieck) und <b>Blau</b> (Quadrat). Jede Farbe hat die Zahlen 0 bis 9 und drei Sonderkarten. Dazu kommen die bunten Joker. Die Farbe steht auf jeder Karte unten als Wort.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>In der Mitte liegt eine offene Karte. Du darfst eine Karte darauf legen, die dazu passt: <b>gleiche Farbe</b>, <b>gleiche Zahl</b> oder <b>gleiches Zeichen</b>.</li>
      <li>Karten, die du legen darfst, sind hervorgehoben. Die anderen sind blass. Tippe einfach auf eine hervorgehobene Karte.</li>
      <li>Du <b>musst</b> eine Karte legen, wenn eine passt. Freiwillig ziehen geht nicht.</li>
      <li>Passt keine Karte, tippst du auf den Stapel und ziehst eine Karte. Passt diese, darfst du sie sofort legen – oder behalten und aussetzen. Passt sie nicht, ist die nächste Person dran.</li>
    </ol>
    <h3>Die Sonderkarten</h3>
    <ul>
      <li><b>Aussetzen:</b> Die nächste Person muss einmal aussetzen.</li>
      <li><b>Richtungswechsel:</b> Die Spielrichtung dreht sich um. Zu zweit wirkt er wie Aussetzen.</li>
      <li><b>Zwei ziehen:</b> Die nächste Person zieht 2 Karten und setzt aus.</li>
      <li><b>Joker Farbwahl:</b> Passt immer. Du wählst die Farbe, die danach gilt.</li>
      <li><b>Joker Vier ziehen:</b> Du wählst die Farbe, die nächste Person zieht 4 Karten und setzt aus. Du darfst ihn nur legen, wenn du keine Karte in der aktuellen Farbe hast. Das prüft das Spiel für dich.</li>
    </ul>
    <h3>Letzte Karte!</h3>
    <p>Wenn du nur noch <b>eine Karte</b> hast, musst du „Letzte Karte!“ rufen. Tippe dazu gleich nach dem Legen auf den großen Knopf. Sonst musst du 2 Karten ziehen, sobald die nächste Person an der Reihe ist. Wer die Option „Ruf automatisch“ eingeschaltet hat, muss nicht selbst rufen.</p>
    <h3>Punkte</h3>
    <p>Wer zuerst keine Karten mehr hat, bekommt die Punkte der Karten, die die anderen noch halten: Zahlen zählen so viel wie die Zahl, Aussetzen, Richtungswechsel und Zwei ziehen zählen 20, Joker zählen 50. Danach gibt es eine neue Runde, bis jemand 500 Punkte erreicht.</p>
    <h3>Mit Weitergabe (Option)</h3>
    <p>Ist die Regel „Zwei ziehen / Vier ziehen dürfen weitergegeben werden“ eingeschaltet, darfst du statt zu ziehen eine gleiche Karte darauf legen. Dann muss die nächste Person noch mehr Karten ziehen.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Karten und rechnet alles selbst aus. Ist der Stapel leer, wird die Ablage neu gemischt.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: [
    { id: 'stack', label: 'Zwei ziehen und Vier ziehen dürfen weitergegeben werden', help: 'Wer eine Strafe bekommt, darf statt zu ziehen eine gleiche Karte darauf legen. Dann wird die Strafe größer.', def: false },
    { id: 'hints', label: 'Spielbare Karten anzeigen', help: 'Zeigt dir, welche Karten gerade gelegt werden dürfen. Ohne diese Hilfe musst du selbst schauen, was passt.', def: false },
    { id: 'auto', label: 'Ruf „Letzte Karte“ automatisch', help: 'Das Spiel ruft für dich, wenn du nur noch eine Karte hast.', def: false },
  ],
  title: 'Farbkarten', icon: '🎴', sub: 'Das bunte Kartenspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Farbkarten', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    const mi = myIndex();
    if (act === 'next') return sess.send({ t: 'next' });
    if (act === 'call') return sess.send({ t: 'call' });
    if (g.mode !== 'play' || mi < 0) return undefined;
    const mine = g.active === mi;
    const hand = g.players[mi].hand;
    if (act === 'play') {
      const card = el.dataset.card;
      if (!mine) return setNote('Du bist noch nicht dran. Bitte einen Moment warten.');
      if (g.stage !== 'play') return setNote('Zuerst muss die Farbe gewählt werden.');
      if (!E.legalCards(g, mi).includes(card)) return setNote(g.drawn ? 'Du darfst nur die gezogene Karte legen – oder sie behalten.' : whyNot(g, hand, card));
      if (E.isWild(card)) { S.ui.pick = card; return render(); }
      return sess.send({ t: 'play', card });
    }
    if (act === 'color') {
      const color = el.dataset.color;
      if (!mine) return undefined;
      if (g.stage === 'color') return sess.send({ t: 'color', color });
      if (S.ui.pick) { const card = S.ui.pick; S.ui.pick = null; return sess.send({ t: 'play', card, color }); }
      return undefined;
    }
    if (act === 'pick-cancel') { S.ui.pick = null; return render(); }
    if (act === 'draw') {
      if (!mine) return setNote('Du bist noch nicht dran. Bitte einen Moment warten.');
      if (g.stage !== 'play') return setNote('Zuerst muss die Farbe gewählt werden.');
      if (g.drawn) return setNote('Du hast schon gezogen. Lege die Karte oder behalte sie.');
      if (!g.pending && E.legalCards(g, mi).length) return setNote('Du hast eine passende Karte und musst eine legen. Hervorgehobene Karten passen.');
      return sess.send({ t: 'draw' });
    }
    if (act === 'keep') return sess.send({ t: 'keep' });
    return undefined;
  },
});
function render() { ui.render(); }
ui.boot();
