import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'double', label: 'Verdoppelung beim Beenden', help: 'Wer eine Runde beendet, aber nicht die wenigsten Punkte hat, bekommt seine Punkte doppelt (nur wenn es Pluspunkte sind).', def: true },
];

const freshUi = () => ({ take: false, oppOpen: true });
// Nur für Tests: ?limit=30 lässt das Spiel schon bei 30 Punkten enden (Standard: 100)
const testLimit = () => { const n = Number(new URLSearchParams(location.search).get('limit')); return Number.isInteger(n) && n >= 1 ? n : undefined; };

const sess = createSession({
  game: 'wm',
  maxPlayers: M.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => { S.ui = { ...S.ui, ...freshUi() }; return M.createGame(players, { ...opts, limit: testLimit() }, Math.random, sess.cid); },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g) return null;
      const isBot = (p) => String(p.id).startsWith('bot');
      if (g.phase === 'reveal') {
        for (const p of g.players) {
          if (!isBot(p)) continue;
          const msg = chooseAction(g, p.id, level, Math.random);
          if (msg) return { id: p.id, msg };
        }
        return null;
      }
      if (g.phase !== 'play') return null;
      const ap = M.activePlayer(g);
      if (!ap || !isBot(ap)) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const me = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);

// Ist die Person gerade mit einem Zug dran?
const myTurn = (g) => g.phase === 'play' && M.activePlayer(g).id === cid;

function onStateChanged() {
  const g = S.game;
  if (S.ui.take && !(g && myTurn(g) && g.turn.stage === 'start')) S.ui.take = false;
  render();
}

// ====================== Darstellung ======================
const spoken = (v) => (v < 0 ? `minus ${-v}` : String(v));

function cardHtml(v, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const type = tag === 'button' ? ' type="button"' : ' role="img"';
  return `<${tag}${type} class="wm-card ${M.bandOf(v)}${cls ? ' ' + cls : ''}" aria-label="Karte ${spoken(v)}${verb}" ${attrs}><span class="n" aria-hidden="true">${M.fmt(v)}</span></${tag}>`;
}
function backHtml({ cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const type = tag === 'button' ? ' type="button"' : ' role="img"';
  return `<${tag}${type} class="wm-card back down${cls ? ' ' + cls : ''}" aria-label="Verdeckte Karte${verb}" ${attrs}></${tag}>`;
}
const emptyHtml = () => `<div class="wm-card gone wm-cell" role="img" aria-label="Spalte entfernt"></div>`;

// Welche Felder meines Rasters kann ich gerade antippen?
function tapMode(g) {
  const p = me();
  if (!p) return null;
  if (g.phase === 'reveal') return M.upCount(p) < 2 ? 'reveal' : null;
  if (!myTurn(g)) return null;
  const st = g.turn.stage;
  if (st === 'flip') return 'flip';
  if (st === 'drawn') return 'swap';
  if (st === 'start' && S.ui.take) return 'swap';
  return null;
}

function myGridHtml(g) {
  const p = me();
  const mode = tapMode(g);
  const cells = p.grid.map((c, i) => {
    if (!c) return emptyHtml();
    const can = mode === 'swap' || ((mode === 'reveal' || mode === 'flip') && !c.up);
    const attrs = can ? `data-act="cell" data-i="${i}"` : '';
    const tag = can ? 'button' : 'div';
    const cls = `wm-cell${can ? ' can' : ''}`;
    const row = Math.floor(i / 4) + 1;
    const col = (i % 4) + 1;
    const pos = `Zeile ${row}, Spalte ${col}`;
    if (c.up) return cardHtml(c.v, { cls, tag, attrs, verb: `, ${pos}${can ? ', antippen zum Tauschen' : ''}` });
    return backHtml({ cls, tag, attrs, verb: `, ${pos}${can ? ', antippen' : ''}` });
  }).join('');
  return `<div class="wm-mine"><h2 class="wm-h">Deine Karten <span class="wm-open">offen: ${M.openSum(p)} Punkte</span></h2>
    <div class="wm-grid" role="group" aria-label="Deine Karten">${cells}</div></div>`;
}

function miniGrid(p, label) {
  const cells = p.grid.map((c) => {
    if (!c) return '<span class="wm-card gone" aria-hidden="true"></span>';
    if (c.up) return `<span class="wm-card ${M.bandOf(c.v)}" aria-hidden="true"><span class="n">${M.fmt(c.v)}</span></span>`;
    return '<span class="wm-card back down" aria-hidden="true"></span>';
  }).join('');
  const open = p.grid.filter((c) => c && c.up).map((c) => spoken(c.v)).join(', ');
  return `<div class="wm-mini" role="img" aria-label="${esc(label)}: ${open ? 'offene Karten ' + open : 'noch keine offene Karte'}">${cells}</div>`;
}

function opponentsHtml(g) {
  const others = g.players.filter((p) => p.id !== cid);
  if (!others.length) return '';
  const ap = g.phase === 'play' ? M.activePlayer(g) : null;
  const many = others.length >= 3;
  const open = !many || S.ui.oppOpen;
  const lis = others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    return `<li class="wm-opp${ap && ap.id === p.id ? ' act' : ''}"><b class="wm-nm">${esc(p.name)}${off}</b>
      <span class="wm-sum">offen: ${M.openSum(p)} Punkte</span>${miniGrid(p, `Karten von ${p.name}`)}</li>`;
  }).join('');
  const tog = many ? `<button type="button" class="btn mini wm-tog" data-act="opps-toggle" aria-expanded="${open}">${open ? 'Mitspieler verbergen' : 'Mitspieler zeigen'}</button>` : '';
  return `<section class="card wm-others"><h2>Mitspieler${tog}</h2>${open ? `<ul class="wm-opps${others.length === 1 ? ' one' : ''}">${lis}</ul>` : ''}</section>`;
}

function bannerHtml(g) {
  const p = me();
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  if (g.phase === 'round') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  if (g.phase === 'reveal') {
    const ups = p ? M.upCount(p) : 2;
    if (ups === 0) return `<div class="banner mine">Decke zwei deiner Karten auf</div>`;
    if (ups === 1) return `<div class="banner mine">Decke noch eine Karte auf</div>`;
    return `<div class="banner">Bitte warte: Die anderen decken noch Karten auf</div>`;
  }
  const ap = M.activePlayer(g);
  if (ap.id === cid) {
    const st = g.turn.stage;
    if (st === 'flip') return `<div class="banner mine">Decke jetzt eine verdeckte Karte auf</div>`;
    if (st === 'drawn') return `<div class="banner mine">Du hast gezogen: tausche die Karte oder lege sie ab</div>`;
    if (S.ui.take) return `<div class="banner mine">Tippe auf die Karte, die du tauschen willst</div>`;
    return `<div class="banner mine">Du bist dran: nimm die offene Karte oder ziehe vom Stapel</div>`;
  }
  if (g.turn.stage === 'drawn') return `<div class="banner">${esc(ap.name)} hat eine Karte gezogen</div>`;
  if (g.turn.stage === 'flip') return `<div class="banner">${esc(ap.name)} deckt eine Karte auf</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function centerHtml(g) {
  const topV = g.discard[g.discard.length - 1];
  const mine = myTurn(g);
  const st = g.turn.stage;
  const canStart = mine && st === 'start' && !S.ui.take;
  const cnt = `<span class="wm-count">${g.deck.length}</span>`;
  const pile = canStart
    ? `<button type="button" class="wm-pile" data-act="draw" aria-label="Stapel: Karte ziehen, ${g.deck.length} Karten im Stapel">${backHtml()}${cnt}</button>`
    : `<div class="wm-pile" role="img" aria-label="Verdeckter Stapel mit ${g.deck.length} Karten">${backHtml()}${cnt}</div>`;
  let disc;
  if (canStart) disc = cardHtml(topV, { cls: 'can', tag: 'button', attrs: 'data-act="take"', verb: ', von der Ablage nehmen' });
  else disc = cardHtml(topV, { cls: S.ui.take ? 'sel' : '' });
  let hand;
  let handLbl = 'Deine Karte';
  if (mine && st === 'drawn') { hand = cardHtml(g.turn.drawn, { cls: 'big' }); handLbl = 'Gezogen'; }
  else if (mine && S.ui.take) { hand = cardHtml(topV, { cls: 'sel' }); handLbl = 'Genommen'; }
  else if (g.phase === 'play' && !mine && st === 'drawn') { hand = backHtml({ cls: 'dim' }); handLbl = esc(M.activePlayer(g).name); }
  else { hand = `<div class="wm-card slot" role="img" aria-label="Keine Karte in der Hand"></div>`; }
  return `<div class="wm-center"><div class="wm-col">${pile}<span class="wm-lbl">Stapel</span></div>
    <div class="wm-col">${disc}<span class="wm-lbl">Ablage</span></div>
    <div class="wm-col">${hand}<span class="wm-lbl">${handLbl}</span></div></div>`;
}

function actionHtml(g) {
  const p = me();
  if (!p) return `<p class="big">Du schaust nur zu.</p>`;
  if (g.phase === 'reveal') {
    const ups = M.upCount(p);
    if (ups === 0) return `<p class="big">Tippe auf <b>zwei</b> deiner verdeckten Karten, um sie aufzudecken.</p>`;
    if (ups === 1) return `<p class="big">Tippe noch auf <b>eine</b> verdeckte Karte.</p>`;
    return `<p class="big">Du hast zwei Karten aufgedeckt. Es geht gleich los, sobald auch alle anderen zwei Karten aufgedeckt haben.</p>`;
  }
  const ap = M.activePlayer(g);
  const last = g.endBy !== null
    ? (ap.id === cid ? ' <b>Das ist dein letzter Zug.</b>' : ` ${esc(g.players[g.endBy].name)} hat alles aufgedeckt, jede andere Person hat noch einen Zug.`)
    : '';
  if (ap.id !== cid) {
    return `<p class="big"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.${last}</p>`;
  }
  const st = g.turn.stage;
  if (st === 'flip') return `<p class="big">Du hast die Karte abgelegt. Tippe auf eine <b>verdeckte</b> Karte, um sie aufzudecken.${last}</p>`;
  if (st === 'drawn') {
    return `<p class="big">Du hast eine <b>${M.fmt(g.turn.drawn)}</b> gezogen.</p>
      <button type="button" class="btn secondary huge wm-put" data-act="put">Auf die Ablage legen</button>
      <p class="big wm-or">oder tippe eine eigene Karte zum Tauschen.</p>`;
  }
  if (S.ui.take) {
    return `<p class="big">Du hast die <b>${M.fmt(g.discard[g.discard.length - 1])}</b> genommen. Tippe auf eine deiner Karten, um sie zu tauschen.</p>
      <button type="button" class="btn ghost wm-put" data-act="take-cancel">Doch nicht, zurücklegen</button>`;
  }
  return `<p class="big">Tippe auf die <b>offene Karte</b> der Ablage, um sie zu nehmen, oder auf den <b>Stapel</b>, um eine zu ziehen.${last}</p>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function tableHtml(g, withRound) {
  const rows = M.ranking(g);
  const r = g.result;
  const head = `<tr><th>Name</th>${withRound ? '<th class="n">Karten</th><th class="n">Diese<br>Runde</th>' : ''}<th class="n">Gesamt</th></tr>`;
  const body = rows.map((x) => {
    const dbl = withRound && r && r.doubled && r.finisher === x.id;
    return `<tr class="${x.winner || (!withRound && x.rank === 1 && g.round > 1) ? 'lead' : ''}"><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.winner ? ' 🏆' : ''}</td>${withRound ? `<td class="n add">${r.raw[x.id]}</td><td class="n">${r.pts[x.id]}${dbl ? ' <small>(doppelt)</small>' : ''}</td>` : ''}<td class="n">${x.total}</td></tr>`;
  }).join('');
  return `<table class="wm-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function scoreHtml(g) {
  return `<section class="card"><h2>Punktestand</h2>${tableHtml(g, false)}
    <p class="muted small">Weniger Punkte sind besser. Das Spiel endet, sobald jemand ${g.limit} oder mehr Punkte hat.</p></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'round' || g.phase === 'over') return overHtml(g);
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card wm-board" id="board">${centerHtml(g)}<div class="wm-action action" aria-live="polite">${actionHtml(g)}</div>${myGridHtml(g)}</section>
    ${opponentsHtml(g)}${scoreHtml(g)}${recapHtml(g)}`;
}

function doubleText(g) {
  const r = g.result;
  if (!r.finisher) return 'Die Runde wurde nach sehr vielen Zügen beendet. Niemand bekommt doppelte Punkte.';
  const name = esc(r.finisherName);
  const raw = r.raw[r.finisher];
  if (r.doubled) return `<b>${name}</b> hat die Runde beendet, hatte aber nicht die wenigsten Punkte. Darum zählen die ${raw} Punkte <b>doppelt</b>: ${r.pts[r.finisher]}.`;
  if (!g.opts.double) return `<b>${name}</b> hat die Runde beendet. Das Verdoppeln war ausgeschaltet.`;
  if (raw <= 0) return `<b>${name}</b> hat die Runde beendet. Punkte von null oder weniger werden nie verdoppelt.`;
  return `<b>${name}</b> hat die Runde beendet und hatte die wenigsten Punkte. Darum zählen die Punkte ganz normal.`;
}

function overHtml(g) {
  const r = g.result;
  const final = g.phase === 'over';
  const rows = M.ranking(g);
  const winners = rows.filter((x) => x.winner);
  const iWon = winners.some((x) => x.id === cid);
  const isHost = sess.S.role === 'host';
  const title = final
    ? (winners.length > 1 ? `Gemeinsam gewonnen: ${winners.map((x) => esc(x.name)).join(' und ')}!` : iWon ? 'Du hast das Spiel gewonnen!' : `${esc(winners[0].name)} hat das Spiel gewonnen!`)
    : `Runde ${g.round} ist zu Ende`;
  const btns = isHost
    ? (final
      ? `<button type="button" class="btn primary huge" data-act="again">▶ Neues Spiel</button>`
      : `<button type="button" class="btn primary huge" data-act="next">▶ Nächste Runde</button>`)
    : `<p class="muted center">${final ? 'Der Gastgeber kann ein neues Spiel starten.' : 'Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.'}</p>`;
  const grids = g.players.map((p) => `<li class="wm-opp"><b class="wm-nm">${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b><span class="wm-sum">${r.raw[p.id]} Punkte</span>${miniGrid(p, `Karten von ${p.name}`)}</li>`).join('');
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card over wm-over" id="board"><div class="trophy">${final && iWon ? '🏆' : final ? '🃏' : '📋'}</div>
      <h1>${title}</h1>
      ${tableHtml(g, true)}
      <p class="big wm-dbl">${doubleText(g)}</p>
      <p class="muted small">Regel: Wer die Runde beendet, aber nicht die wenigsten Punkte hat (andere mit gleich vielen oder weniger), bekommt seine Punkte doppelt. Das gilt nur für Pluspunkte.${final ? '' : ` Das Spiel endet, sobald jemand ${g.limit} oder mehr Punkte hat.`}</p>
      <div class="wm-btns">${btns}<button type="button" class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Alle Karten dieser Runde</h2><ul class="wm-opps">${grids}</ul></section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Am Ende des Spiels möglichst <b>wenige Punkte</b> haben. Weniger ist mehr!</p>
    <h3>Die Karten</h3>
    <p>Gespielt wird mit 150 Karten. Auf jeder Karte steht eine Zahl, und genau so viele Punkte zählt sie. Es gibt die Zahlen von minus 2 bis 12. Minuskarten sind gut für dich, denn sie ziehen Punkte ab. Zur besseren Lesbarkeit sind die Karten auch farbig: minus 2 und minus 1 blau, null grün, 1 bis 4 gelb, 5 bis 8 orange, 9 bis 12 rot.</p>
    <h3>So beginnt eine Runde</h3>
    <ul>
      <li>Jede Person bekommt 12 verdeckte Karten, die in 3 Zeilen mit je 4 Karten vor ihr liegen.</li>
      <li>Eine Karte liegt offen auf der <b>Ablage</b>. Alle übrigen Karten liegen verdeckt auf dem <b>Stapel</b>.</li>
      <li>Zuerst deckt jede Person zwei ihrer Karten auf. Das geht für alle gleichzeitig: einfach zwei verdeckte Karten antippen.</li>
      <li>Es beginnt, wer mit den beiden aufgedeckten Karten die höchste Summe hat. Bei gleicher Summe beginnt, wer die höchste Einzelkarte hat. Danach geht es reihum im Uhrzeigersinn. In den nächsten Runden beginnt jeweils die nächste Person.</li>
    </ul>
    <h3>Dein Zug</h3>
    <p>Du hast in jedem Zug <b>zwei Möglichkeiten</b>:</p>
    <ul>
      <li><b>A: Die offene Karte der Ablage nehmen.</b> Tippe auf sie und danach auf eine deiner Karten, offen oder verdeckt. Die beiden Karten werden getauscht. Deine alte Karte kommt offen auf die Ablage.</li>
      <li><b>B: Vom Stapel ziehen.</b> Du siehst die gezogene Karte groß neben dem Stapel. Nur du siehst sie. Dann kannst du entweder eine deiner Karten (offen oder verdeckt) gegen sie tauschen, wobei die alte Karte offen auf die Ablage kommt. Oder du legst die gezogene Karte auf die Ablage. Dann musst du danach eine deiner verdeckten Karten aufdecken.</li>
    </ul>
    <h3>Drei gleiche in einer Spalte</h3>
    <p>Liegen drei gleiche offene Karten untereinander in einer Spalte, werden sie sofort aus dem Spiel genommen und auf die Ablage gelegt. Die Spalte zählt dann null Punkte. Das gilt nach jedem Tausch und jedem Aufdecken, auch für Minuskarten.</p>
    <h3>Das Ende einer Runde</h3>
    <ul>
      <li>Sobald eine Person <b>alle ihre Karten offen</b> hat, bekommen alle anderen noch genau <b>einen letzten Zug</b>.</li>
      <li>Danach werden alle verdeckten Karten aufgedeckt und gezählt. Entfernte Spalten zählen null.</li>
      <li><b>Verdoppelung:</b> Hat die Person, die die Runde beendet hat, nicht die wenigsten Punkte (eine andere Person hat gleich viele oder weniger), zählen ihre Punkte doppelt. Das gilt nur für Pluspunkte, Minuspunkte bleiben, wie sie sind. Du kannst die Verdoppelung auf der Startseite ausschalten.</li>
      <li>Ist der Stapel einmal leer, werden die Karten der Ablage (außer der obersten) neu gemischt.</li>
    </ul>
    <h3>Das Ende des Spiels</h3>
    <p>Es werden mehrere Runden gespielt. Die Punkte werden zusammengezählt. Sobald jemand am Ende einer Runde <b>100 Punkte oder mehr</b> hat, ist das Spiel zu Ende. Es gewinnt, wer die <b>wenigsten</b> Punkte hat. Bei Gleichstand gewinnen mehrere gemeinsam.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und zählt alles selbst. Auf dem Bildschirm steht immer, was du als Nächstes tun kannst.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 1, coach },
  title: 'Wenig ist mehr', icon: '🂠', sub: 'Das Kartenspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Wenig ist mehr', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    switch (act) {
      case 'cell': {
        const i = Number(el.dataset.i);
        if (g.phase === 'reveal') return sess.send({ t: 'reveal', i });
        if (g.turn.stage === 'flip') return sess.send({ t: 'flip', i });
        if (g.turn.stage === 'drawn') return sess.send({ t: 'swap', from: 'drawn', i });
        if (S.ui.take) { S.ui.take = false; return sess.send({ t: 'swap', from: 'discard', i }); }
        return undefined;
      }
      case 'take': S.ui.take = true; return render();
      case 'take-cancel': S.ui.take = false; return render();
      case 'draw': return sess.send({ t: 'draw' });
      case 'put': return sess.send({ t: 'discard' });
      case 'opps-toggle': S.ui.oppOpen = !S.ui.oppOpen; return render();
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
