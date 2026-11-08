import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'show', label: 'Mein Handwert anzeigen', help: 'Zeigt dir bei deinen Karten, wie viele Punkte dein Blatt gerade hat. Ohne diese Hilfe musst du selbst rechnen.', def: false },
];

const freshUi = () => ({ selH: null, selT: null, note: null });

const sess = createSession({
  game: 'sw',
  maxPlayers: 6,
  options: OPTIONS,
  newGame: (players, opts) => { S.ui = { ...S.ui, ...freshUi() }; return M.createGame(players, opts, Math.random, sess.cid); },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.game !== 'sw' || g.phase !== 'play') return null;
      const ap = M.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const me = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);
const noteKey = (g) => `${g.gid}|${g.round}|${g.moves}|${g.phase}`;
const myTurn = (g) => g.phase === 'play' && M.activePlayer(g).id === cid && !M.activePlayer(g).out;
const showVal = (g) => !!g.opts.show || !!S.learn;

function onStateChanged() {
  const g = S.game;
  if ((S.ui.selH !== null || S.ui.selT !== null) && (!g || !myTurn(g))) { S.ui.selH = null; S.ui.selT = null; }
  render();
}

// ====================== Darstellung ======================
const LABELED = new Set([4, 5, 6, 7]); // Bube, Dame, König, Ass bekommen ein Wort
function cardHtml(c, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[c.s];
  const rk = M.RANKS[c.r];
  const name = `${su.name} ${rk.name}`;
  const word = LABELED.has(c.r) ? `<span class="nm">${rk.name}</span>` : '';
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="sw-card${su.red ? ' red' : ''}${cls ? ' ' + cls : ''}" title="${name}" aria-label="${name}${verb}" ${attrs}>
    <span class="tl"><span class="rk">${rk.sym}</span><span class="ss" aria-hidden="true">${su.sym}</span></span>
    <span class="mid" aria-hidden="true">${su.sym}</span>${word}</${tag}>`;
}
const backHtml = () => '<span class="sw-card back" aria-hidden="true"></span>';

function livesHtml(p) {
  if (p.out) return '<span class="sw-lives" aria-label="ausgeschieden">💤</span>';
  const slots = [0, 1, 2].map((i) => (i < p.lives ? '<span aria-hidden="true">🍺</span>' : '<span class="lost" aria-hidden="true">🐟</span>')).join('');
  const swim = p.lives === 0 ? '<span class="swim" aria-hidden="true">🏊</span>' : '';
  const label = p.lives === 0 ? 'schwimmt, keine Leben mehr' : p.lives === 1 ? 'noch 1 Leben' : `noch ${p.lives} Leben`;
  return `<span class="sw-lives" role="img" aria-label="${label}">${slots}${swim}</span>`;
}
const statusText = (g, p) => {
  if (p.out) return 'ausgeschieden';
  if (g.phase === 'play' && M.activePlayer(g).id === p.id) return g.knocker === p.id ? 'hat geklopft' : 'ist dran';
  if (g.knocker === p.id) return 'hat geklopft';
  if (p.lives === 0) return 'schwimmt';
  return ' ';
};

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  const ap = M.activePlayer(g);
  const last = g.knocker !== null && g.knocker !== ap.id;
  if (ap.id === cid) return `<div class="banner mine">${last ? 'Du bist dran – letzter Zug!' : 'Du bist dran!'}</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function opponentsHtml(g) {
  const others = g.players.filter((p) => p.id !== cid);
  const lis = others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' (nicht verbunden)' : '';
    const act = g.phase === 'play' && !p.out && M.activePlayer(g).id === p.id;
    const knock = g.knocker === p.id ? ' ✊' : '';
    const backs = p.out ? '' : `<span class="sw-backs" aria-hidden="true">${[0, 1, 2].map(backHtml).join('')}</span>`;
    return `<li class="sw-opp${act ? ' act' : ''}${p.out ? ' out' : ''}"><span class="sw-who"><b class="sw-nm">${esc(p.name)}${knock}${off}</b><span class="sw-sub">${statusText(g, p)}</span></span>${livesHtml(p)}${backs}</li>`;
  }).join('');
  return `<ul class="sw-opps" aria-label="Die Mitspieler">${lis}</ul>`;
}

function tableHtml(g) {
  const can = myTurn(g);
  const cards = g.table.map((c, j) => {
    const cls = S.ui.selT === j ? 'sel' : '';
    return can ? cardHtml(c, { cls, tag: 'button', attrs: `data-act="table" data-j="${j}"`, verb: ', tauschen' }) : cardHtml(c, { cls });
  }).join('');
  return `<div class="sw-tablebox"><span class="sw-lbl">Tisch</span><div class="sw-table" role="group" aria-label="Die Karten auf dem Tisch">${cards}</div></div>`;
}

function stateLineHtml(g) {
  if (g.knocker === null) return '<p class="sw-state">Noch hat niemand geklopft.</p>';
  const k = g.players.find((p) => p.id === g.knocker);
  const n = g.left;
  return `<p class="sw-state on">✊ ${k.id === cid ? 'Du hast' : esc(k.name) + ' hat'} geklopft. Noch ${n === 1 ? 'ein Zug' : n + ' Züge'}, dann wird aufgedeckt.</p>`;
}

function handHtml(g) {
  const p = me();
  if (!p) return '';
  if (p.out) return `<section class="card sw-handcard"><h2>Deine Karten</h2><p class="sw-out">Du bist ausgeschieden. Schau den anderen zu.</p></section>`;
  const can = myTurn(g);
  const cards = p.hand.map((c, i) => {
    const cls = S.ui.selH === i ? 'sel' : '';
    return can ? cardHtml(c, { cls, tag: 'button', attrs: `data-act="hand" data-i="${i}"`, verb: ', abgeben' }) : cardHtml(c, { cls });
  }).join('');
  const val = showVal(g) ? `<p class="sw-val">Dein Handwert: <b>${M.fmtVal(M.handValue(p.hand))}</b></p>` : '';
  return `<section class="card sw-handcard"><div class="sw-handhead"><h2>Deine Karten</h2>${livesHtml(p)}</div>${val}<div class="sw-hand" role="group" aria-label="Deine Handkarten">${cards}</div></section>`;
}

function messageHtml(g) {
  const p = me();
  if (!p) return '<p class="big">Du schaust nur zu.</p>';
  if (p.out) return '<p class="big">Du bist ausgeschieden. Schau den anderen weiter zu.</p>';
  const n = S.ui.note;
  if (n && n.key === noteKey(g)) return `<p class="big warn">${esc(n.text)}</p>`;
  const ap = M.activePlayer(g);
  if (ap.id !== cid) {
    const k = g.knocker !== null ? ` ${g.knocker === cid ? 'Du hast' : esc(g.players.find((x) => x.id === g.knocker).name) + ' hat'} geklopft.` : '';
    return `<p class="big"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.${k}</p>`;
  }
  if (S.ui.selH !== null && p.hand[S.ui.selH]) return `<p class="big">Du gibst <b>${esc(M.cardName(p.hand[S.ui.selH]))}</b> ab. Tippe jetzt auf die Tischkarte, die du dafür nehmen möchtest.</p>`;
  if (S.ui.selT !== null && g.table[S.ui.selT]) return `<p class="big">Du nimmst <b>${esc(M.cardName(g.table[S.ui.selT]))}</b>. Tippe jetzt auf deine Karte, die du dafür abgibst.</p>`;
  if (g.knocker !== null) return `<p class="big">Es wurde geklopft. Das ist dein <b>letzter Zug</b>. Tausche, schiebe oder sage 31 an.</p>`;
  return `<p class="big">Tippe auf eine deiner Karten und dann auf eine Tischkarte, um sie zu tauschen. Oder wähle einen Knopf.</p>`;
}

function actionHtml(g) {
  const p = me();
  const mine = !!p && !p.out && myTurn(g);
  const dis = mine ? '' : ' disabled';
  const knockDis = mine && g.knocker === null ? '' : ' disabled';
  const t31Dis = p && !p.out && g.phase === 'play' ? '' : ' disabled';
  return `<div class="sw-msg">${messageHtml(g)}</div>
    <div class="sw-btns">
      <button class="btn secondary" data-act="swap3"${dis}>Alle drei tauschen</button>
      <button class="btn secondary" data-act="pass"${dis}>Schieben</button>
      <button class="btn knock" data-act="knock"${knockDis}>✊ Klopfen</button>
      <button class="btn t31" data-act="call31"${t31Dis}>31 ansagen</button>
    </div>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 5).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card sw-board" id="board">${opponentsHtml(g)}${tableHtml(g)}${stateLineHtml(g)}</section>
    ${handHtml(g)}
    <section class="card action sw-action" aria-live="polite">${actionHtml(g)}</section>
    ${recapHtml(g)}`;
}

const lebenText = (n) => (n === 1 ? 'ein Leben' : 'zwei Leben');

function myOutcome(g) {
  const r = g.result;
  const p = me();
  if (!p || !(p.id in r.values)) return '';
  if (r.final) return '';
  const n = r.loss[p.id] || 0;
  if (r.eliminated.includes(p.id)) return 'Du schwimmst schon und hast wieder verloren: Du scheidest aus.';
  if (!n) return r.kind === '31' && r.caller === p.id ? 'Du bleibst verschont.' : 'Du bleibst diesmal verschont.';
  if (p.lives === 0) return `Du verlierst ${lebenText(n)} und schwimmst jetzt. 🏊 Noch einmal verlieren, und du scheidest aus.`;
  return `Du verlierst ${lebenText(n)}.`;
}

function overHtml(g) {
  const r = g.result;
  const isHost = sess.S.role === 'host';
  const champMe = r.final && r.champions.includes(cid) && !r.draw;
  const champNames = r.champions.map((id) => g.players.find((p) => p.id === id).name);
  let trophy = '🃏';
  let head;
  if (r.final) {
    trophy = champMe ? '🏆' : '🏅';
    head = r.draw ? 'Unentschieden! Ihr schwimmt alle zusammen.' : champMe ? 'Du hast das Spiel gewonnen!' : `${esc(champNames[0])} hat das Spiel gewonnen!`;
  } else if (r.kind === '31') {
    head = r.caller === cid ? 'Du hast 31!' : `${esc(g.players.find((p) => p.id === r.caller).name)} hat 31!`;
    if (r.caller === cid) trophy = '🏆';
  } else head = 'Alle Karten sind aufgedeckt!';
  const rows = g.players.filter((p) => p.id in r.values).map((p) => {
    const n = r.loss[p.id] || 0;
    const out = r.eliminated.includes(p.id);
    const res = out ? 'scheidet aus 💤' : n ? `−${n} ${n === 1 ? 'Leben' : 'Leben'} 🍺` : 'verschont';
    const cls = n ? 'lose' : r.caller === p.id ? 'win' : '';
    const star = r.knocker === p.id ? ' ✊' : '';
    return `<div class="sw-row ${cls}"><div class="head"><span>${esc(p.name)}${p.id === cid ? ' (du)' : ''}${star}</span><span>${M.fmtVal(r.values[p.id])} Punkte</span></div>
      <div class="cards">${p.hand.map((c) => cardHtml(c, { cls: 'sm' })).join('')}</div><div class="res">${res}</div></div>`;
  }).join('');
  const standing = M.ranking(g).map((x) => `<tr><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.winner ? ' 🏆' : ''}</td><td class="n">${livesHtml(g.players[x.idx])}</td></tr>`).join('');
  const btns = isHost
    ? (r.final
      ? `<button class="btn primary huge" data-act="again">▶ Neues Spiel</button>`
      : `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button><button class="btn secondary" data-act="again">Neues Spiel (alle Leben zurück)</button>`)
    : `<p class="muted center">${r.final ? 'Der Gastgeber startet ein neues Spiel.' : 'Der Gastgeber startet die nächste Runde.'} Du bleibst einfach auf dieser Seite.</p>`;
  const mine = myOutcome(g);
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card over action sw-over"><div class="trophy">${trophy}</div>
      <h1>${head}</h1>
      <p class="big">${esc(r.text)}${mine ? ' ' + esc(mine) : ''}</p>
      <div class="sw-btns1">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Die Hände</h2><div class="sw-rows">${rows}</div></section>
    <section class="card"><h2>Leben</h2><table class="sw-table2"><tbody>${standing}</tbody></table>
      <p class="muted small">🍺 = Leben, 🐟 = verloren. Ohne Leben schwimmst du 🏊. Verlierst du dann noch einmal, scheidest du aus.</p></section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Habe am Ende ein möglichst hohes Blatt. Wer das niedrigste Blatt hat, verliert ein Leben. Wer als Letzte/r übrig bleibt, gewinnt.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 32 Karten: 7, 8, 9, 10, Bube, Dame, König und Ass in Kreuz ♣, Pik ♠, Herz ♥ und Karo ♦. Jede Person bekommt <b>3 Karten</b> auf die Hand. Drei weitere Karten liegen <b>offen auf dem Tisch</b>. Es spielen 2 bis 6 Personen.</p>
    <h3>So zählt dein Blatt</h3>
    <ul>
      <li>Ass zählt 11. König, Dame, Bube und 10 zählen je 10. 7, 8 und 9 zählen nach Augen.</li>
      <li>Es zählen nur Karten <b>einer Farbe</b>: Deine höchste Farbsumme ist dein Handwert. Beispiel: ♥ Ass, ♥ 10 und ♣ 7 sind 21 Punkte.</li>
      <li><b>Drei gleiche Karten</b> (zum Beispiel drei Damen) zählen 30,5.</li>
      <li>Ass, eine 10er-Karte und noch eine 10er-Karte in derselben Farbe sind <b>31</b>, das beste Blatt.</li>
    </ul>
    <h3>Dein Zug</h3>
    <p>Reihum macht jede Person einen Zug:</p>
    <ul>
      <li><b>Eine Karte tauschen:</b> Tippe auf eine deiner Karten und dann auf eine Tischkarte.</li>
      <li><b>Alle drei tauschen:</b> Du nimmst alle drei Tischkarten, deine Karten liegen danach auf dem Tisch.</li>
      <li><b>Schieben:</b> Du tauschst nichts. Haben alle nacheinander einmal geschoben, kommen drei neue Karten auf den Tisch.</li>
      <li><b>Klopfen:</b> Du glaubst, dein Blatt reicht. Danach hat jede andere Person noch genau einen Zug, dann werden alle Karten aufgedeckt. Es darf nur einmal geklopft werden.</li>
    </ul>
    <h3>31</h3>
    <p>Wer 31 hat, tippt auf „31 ansagen“. Die Runde endet sofort, alle anderen verlieren ein Leben. Der Knopf ist immer da. Hast du noch keine 31, sagt dir das Spiel freundlich Bescheid. Erreichst du 31 durch einen Tausch, endet die Runde von selbst.</p>
    <h3>Leben und Schwimmen</h3>
    <ul>
      <li>Jede Person startet mit <b>3 Leben</b> (🍺).</li>
      <li>Beim Aufdecken verliert die Person mit dem <b>niedrigsten</b> Blatt ein Leben. Haben mehrere gleich wenig, verlieren alle von ihnen ein Leben.</li>
      <li>Wer geklopft hat und das niedrigste Blatt hat (auch geteilt), verliert <b>zwei Leben</b>.</li>
      <li>Bei 31 verlieren alle anderen je ein Leben.</li>
      <li>Ohne Leben „schwimmst“ du (🏊). Verlierst du dann noch einmal, scheidest du aus.</li>
    </ul>
    <p class="muted">Mit „Nächste Runde“ geht es weiter, die Leben bleiben. Die Startperson wechselt jede Runde. Im Kästchen „Mein Handwert anzeigen“ kannst du dir die Punkte deines Blatts zeigen lassen.</p>
`;
}

// ====================== Bedienung ======================
function trySwap() {
  if (S.ui.selH === null || S.ui.selT === null) return render();
  const msg = { t: 'swap1', hand: S.ui.selH, table: S.ui.selT };
  S.ui.selH = null; S.ui.selT = null;
  return sess.send(msg);
}

const ui = createUI({
  sess, $app,
  bots: [1, 2, 3, 4, 5], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 1, coach },
  title: 'Schwimmen', icon: '🏊', sub: 'Das Kartenspiel mit 31 – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Schwimmen', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    switch (act) {
      case 'hand': {
        if (!myTurn(g)) return undefined;
        const i = Number(el.dataset.i);
        S.ui.selH = S.ui.selH === i ? null : i;
        return trySwap();
      }
      case 'table': {
        if (!myTurn(g)) return undefined;
        const j = Number(el.dataset.j);
        S.ui.selT = S.ui.selT === j ? null : j;
        return trySwap();
      }
      case 'swap3': S.ui.selH = null; S.ui.selT = null; return sess.send({ t: 'swap3' });
      case 'pass': S.ui.selH = null; S.ui.selT = null; return sess.send({ t: 'pass' });
      case 'knock': S.ui.selH = null; S.ui.selT = null; return sess.send({ t: 'knock' });
      case 'call31': {
        const p = me();
        if (!p || g.phase !== 'play') return undefined;
        if (M.handValue(p.hand) !== 31) { S.ui.note = { key: noteKey(g), text: 'Du hast noch keine 31. Spiel einfach weiter.' }; return render(); }
        return sess.send({ t: 'call31' });
      }
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
