import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'hints', label: 'Spielbare Karten anzeigen', help: 'Zeigt dir, welche Karten gerade gelegt werden dürfen. Ohne diese Hilfe musst du selbst schauen, was passt.', def: false },
  { id: 'short', label: 'Kurzspiel', help: 'Das Spiel endet schon bei 15 statt bei 30 Strafpunkten.', def: false },
];
const LEARN_LIMIT = 20; // In der Lernrunde endet das Spiel früher

// Nur für Tests: ?limit=10 in der Adresse setzt die Punktegrenze
const urlLimit = () => {
  try { const v = Number(new URLSearchParams(location.search).get('limit')); return Number.isInteger(v) && v >= 1 && v <= 999 ? v : null; } catch { return null; }
};

const freshUi = () => ({ note: null });

const sess = createSession({
  game: 'ev',
  maxPlayers: 6,
  options: OPTIONS,
  newGame: (players, opts) => {
    S.ui = { ...S.ui, ...freshUi() };
    const o = { ...opts };
    const ul = urlLimit();
    if (ul) o.limit = ul; else if (S.learn) o.limit = LEARN_LIMIT;
    return M.createGame(players, o, Math.random, sess.cid);
  },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase !== 'play') return null;
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

function onStateChanged() {
  S.ui.note = null;
  render();
}

// ====================== Darstellung ======================
const kartenZahl = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);
const punkteZahl = (n) => (n === 1 ? '1 Strafpunkt' : `${n} Strafpunkte`);

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">${g.result && g.result.gameOver ? 'Das Spiel ist zu Ende' : `Runde ${g.round} ist zu Ende`}</div>`;
  const ap = M.activePlayer(g);
  if (ap.id === cid) return `<div class="banner mine">${M.hasPlayable(g, ap) ? 'Du bist dran!' : 'Du musst passen'}</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

const TILE_W = 36; const TILE_GAP = 2; const TAG_W = 34; // Maße des Zahlenbandes (für die Startposition)

function rowHtml(g, s) {
  const su = M.SUITS[s];
  const w = g.rows[s];
  const lastC = g.last && g.last.kind === 'play' ? g.last.card : null;
  let tiles = '';
  for (let r = M.MIN_RANK; r <= M.MAX_RANK; r++) {
    const on = !!w && r >= w.lo && r <= w.hi;
    const isNew = !!lastC && lastC.s === s && lastC.r === r && on;
    tiles += `<span class="ev-t${on ? ' on' : ''}${isNew ? ' new' : ''}${r === M.START ? ' mid' : ''}">${r}</span>`;
  }
  const txt = w ? `${su.name}: ${w.lo === w.hi ? w.lo : `${w.lo} bis ${w.hi}`}` : `${su.name}: noch keine Karte`;
  return `<div class="ev-row s${s}" role="img" aria-label="${esc(txt)}"><span class="ev-tag" aria-hidden="true">${su.sym}</span>${tiles}</div>`;
}

function boardHtml(g) {
  const rows = [0, 1, 2, 3].map((s) => rowHtml(g, s)).join('');
  const chips = [0, 1, 2, 3].map((s) => {
    const su = M.SUITS[s];
    const w = g.rows[s];
    return `<li class="ev-chip s${s}"><span class="sy" aria-hidden="true">${su.sym}</span> ${su.name}: <b>${w ? (w.lo === w.hi ? w.lo : `${w.lo} bis ${w.hi}`) : 'noch leer'}</b></li>`;
  }).join('');
  return `<section class="card ev-board" id="board">
    <div class="ev-scroll" tabindex="0" role="group" aria-label="Die vier Reihen auf dem Tisch"><div class="ev-rows">${rows}</div></div>
    <p class="ev-swipe muted">Wische die Reihen seitwärts.</p>
    <ul class="ev-sum" aria-label="Die Reihen in Worten">${chips}</ul>
  </section>`;
}

function playersHtml(g) {
  const ap = M.activePlayer(g);
  const lis = g.players.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(weg)</span>' : '';
    const n = p.hand.length;
    return `<li class="ev-opp${g.phase === 'play' && ap.id === p.id ? ' act' : ''}"><b class="ev-nm">${esc(p.name)}${p.id === cid ? ' (du)' : ''}${off}</b>
      <span class="ev-st"><b>${n}</b><small>${n === 1 ? 'Karte' : 'Karten'}</small></span>
      <span class="ev-st"><b>${p.points}</b><small>${p.points === 1 ? 'Strafpunkt' : 'Strafpunkte'}</small></span></li>`;
  }).join('');
  return `<section class="card ev-players"><ul class="ev-opps" aria-label="Alle Mitspielenden">${lis}</ul></section>`;
}

function actionHtml(g) {
  const p = me();
  if (!p) return `<p class="big">Du schaust nur zu.</p>`;
  const ap = M.activePlayer(g);
  if (ap.id !== cid) return `<p class="big"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  if (!M.hasPlayable(g, p)) {
    return `<p class="big">Du hast keine Karte, die passt. Du musst <b>passen</b> und bekommst <b>1 Strafpunkt</b>.</p>
      <button class="btn primary huge" data-act="pass">Passen (+1 Strafpunkt)</button>`;
  }
  const note = S.ui.note ? `<p class="ev-note">${esc(S.ui.note)}</p>` : '';
  const hint = g.opts.hints || S.learn ? ' Tippe auf eine hervorgehobene Karte.' : ' Tippe auf die Karte, die du legen möchtest.';
  if (g.moves === 0) return `${note}<p class="big">Du hast eine Elf und beginnst. Lege eine <b>Elf</b> auf den Tisch.${hint}</p>`;
  return `${note}<p class="big">Lege <b>eine Karte</b>: eine Zahl, die an eine Reihe anschließt, oder eine <b>Elf</b> in einer neuen Farbe.${hint}</p>`;
}

function cardHtml(c, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[c.s];
  const name = `${su.name} ${c.r}`;
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="ev-card s${c.s}${cls ? ' ' + cls : ''}" aria-label="${name}${verb}" ${attrs}><span class="n">${c.r}</span><span class="y" aria-hidden="true">${su.sym}</span></${tag}>`;
}

function handHtml(g) {
  const p = me();
  if (!p) return '';
  const myTurn = g.phase === 'play' && M.activePlayer(g).id === cid;
  const hints = !!g.opts.hints || !!S.learn;
  const groups = [0, 1, 2, 3].map((s) => {
    const cs = p.hand.filter((c) => c.s === s);
    if (!cs.length) return '';
    const cards = cs.map((c) => {
      const ok = myTurn && M.playable(g, c);
      const cls = myTurn && hints ? (ok ? 'can' : 'dim') : '';
      return myTurn ? cardHtml(c, { cls, tag: 'button', attrs: `data-act="card" data-s="${c.s}" data-r="${c.r}"`, verb: ', legen' }) : cardHtml(c);
    }).join('');
    return `<div class="ev-group"><h3 class="ev-gl s${s}"><span aria-hidden="true">${M.SUITS[s].sym}</span> ${M.SUITS[s].name} (${cs.length})</h3><div class="ev-cards">${cards}</div></div>`;
  }).join('');
  return `<section class="card ev-handcard"><h2>Deine Karten (${p.hand.length})</h2><div class="ev-hand" role="group" aria-label="Deine Handkarten">${groups}</div></section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 5).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function tableHtml(g, withRound) {
  const rows = M.ranking(g);
  const head = `<tr><th>Name</th>${withRound ? '<th class="n">Diese<br>Runde</th>' : ''}<th class="n">Strafpunkte<br>gesamt</th></tr>`;
  const body = rows.map((r) => `<tr class="${g.phase === 'over' && g.result && g.result.gameOver && r.rank === 1 ? 'lead' : ''}"><td>${esc(r.name)}${r.id === cid ? ' (du)' : ''}${g.result && g.result.gameOver && r.rank === 1 ? ' 🏆' : ''}</td>${withRound ? `<td class="n add">${g.result.add[r.id] ? '+' + g.result.add[r.id] : '0'}</td>` : ''}<td class="n">${r.points}</td></tr>`).join('');
  return `<section class="card"><h2>Spielstand</h2><table class="ev-table"><thead>${head}</thead><tbody>${body}</tbody></table>
    <p class="muted small">Das Spiel endet, sobald am Ende einer Runde jemand ${g.opts.limit} Strafpunkte hat. Wer dann die wenigsten Strafpunkte hat, gewinnt.</p></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    ${boardHtml(g)}
    ${playersHtml(g)}
    <section class="card action ev-action" aria-live="polite">${actionHtml(g)}</section>
    ${handHtml(g)}
    ${recapHtml(g)}`;
}

function overHtml(g) {
  const r = g.result;
  const isHost = sess.S.role === 'host';
  const champs = r.champions || [];
  let title; let trophy = '🃏';
  if (r.gameOver) {
    if (champs.length === 1) {
      const w = g.players.find((p) => p.id === champs[0]);
      title = champs[0] === cid ? 'Du hast das Spiel gewonnen!' : `${esc(w.name)} hat das Spiel gewonnen!`;
    } else {
      title = `Gleichstand: ${champs.map((id) => esc(g.players.find((p) => p.id === id).name)).join(' und ')} gewinnen gemeinsam!`;
    }
    if (champs.includes(cid)) trophy = '🏆';
  } else {
    title = r.winner === cid ? 'Du hast die Runde gewonnen!' : `${esc(r.winnerName)} hat die Runde gewonnen!`;
  }
  const btns = isHost
    ? (r.gameOver
      ? `<button class="btn primary huge" data-act="again">▶ Neues Spiel</button>`
      : `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>
         <button class="btn secondary" data-act="again">Neues Spiel (Spielstand löschen)</button>`)
    : `<p class="muted center">${r.gameOver ? 'Der Gastgeber kann ein neues Spiel starten.' : 'Der Gastgeber startet die nächste Runde.'} Du bleibst einfach auf dieser Seite.</p>`;
  const left = g.players.filter((p) => p.id !== r.winner).map((p) => `<li>${esc(p.name)}${p.id === cid ? ' (du)' : ''}: ${kartenZahl(p.hand.length)} übrig = ${punkteZahl(r.add[p.id])}</li>`).join('');
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over ev-over"><div class="trophy">${trophy}</div>
      <h1>${title}</h1>
      ${r.gameOver ? `<p class="center muted">Das Spiel ist zu Ende: Jemand hat ${g.opts.limit} Strafpunkte erreicht.</p>` : `<p class="center muted">${esc(r.winnerName)} hat keine Karten mehr.</p>`}
      <div class="ev-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card ev-left"><h2>Strafpunkte dieser Runde</h2><ul>${left}</ul>
      <p class="muted small">Für jede übrige Karte gibt es einen Strafpunkt. Strafpunkte vom Passen sind schon in der Summe.</p></section>
    ${tableHtml(g, true)}
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Werde als Erste/r alle deine Karten los. Wer am Ende die wenigsten Strafpunkte hat, gewinnt.</p>
    <h3>Das Blatt</h3>
    <p>Es gibt 84 Karten: vier Farben mit den Zahlen 1 bis 21. Die Farben sind Rot ●, Blau ■, Gelb ▲ und Grün ◆. Zu jeder Farbe gehört ein Zeichen, damit du sie auch ohne die Farbe erkennst. Alle Karten werden reihum verteilt. Bleiben Karten übrig, bekommen die ersten Personen eine mehr. Es gibt keinen Stapel zum Ziehen.</p>
    <h3>Der Tisch</h3>
    <p>In der Mitte liegen vier Reihen, eine pro Farbe, von 1 bis 21. Dort, wo Karten liegen, ist das Feld gefüllt. Du kannst die Reihen mit dem Finger nach links und rechts wischen.</p>
    <h3>Dein Zug</h3>
    <ul>
      <li>Es beginnt die Person, die eine <b>Elf</b> hat. Sie legt eine ihrer Elfen. Danach geht es reihum im Uhrzeigersinn.</li>
      <li>Du darfst in deinem Zug <b>genau eine Karte</b> legen, und du musst es tun, wenn du kannst.</li>
      <li>Erlaubt ist eine <b>Elf in einer neuen Farbe</b>. Sie eröffnet eine neue Reihe.</li>
      <li>Erlaubt ist auch eine Karte, die in ihrer Farbe an die Reihe anschließt: die Zahl direkt <b>über</b> der höchsten oder direkt <b>unter</b> der niedrigsten gelegten Zahl. Nach oben geht es bis 21, nach unten bis 1.</li>
      <li>Hast du keine passende Karte, musst du <b>passen</b>. Dafür bekommst du <b>1 Strafpunkt</b>. Du ziehst keine Karte.</li>
    </ul>
    <h3>Rundenende und Spielende</h3>
    <p>Die Runde endet, sobald jemand keine Karten mehr hat. Alle anderen bekommen so viele Strafpunkte, wie sie Karten übrig haben. Die Strafpunkte vom Passen kommen dazu. Der Gastgeber startet mit „Nächste Runde“ die nächste Runde, die Strafpunkte bleiben erhalten.</p>
    <p>Das Spiel endet, wenn am Ende einer Runde jemand <b>30 Strafpunkte</b> oder mehr hat (beim Kurzspiel 15). Es gewinnt, wer dann die <b>wenigsten Strafpunkte</b> hat. Bei Gleichstand gewinnen mehrere gemeinsam.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und rechnet alles selbst. Auf Wunsch zeigt es dir, welche Karten du legen darfst.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 1, coach },
  title: 'Elf voran', icon: '🃏', sub: 'Das Kartenspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Elf voran', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'card': {
        const card = { s: Number(el.dataset.s), r: Number(el.dataset.r) };
        if (!g) return undefined;
        if (!M.playable(g, card)) { S.ui.note = 'Diese Karte passt gerade nicht. Versuche eine andere.'; return render(); }
        return sess.send({ t: 'play', card });
      }
      case 'pass': return sess.send({ t: 'pass' });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }

// Das Zahlenband behält seine Wischposition (auch wenn die Seite neu gezeichnet wird); zu Beginn steht die Elf in der Mitte.
$app.addEventListener('scroll', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('ev-scroll')) S.ui.sx = e.target.scrollLeft;
}, true);
new MutationObserver(() => {
  const n = $app.querySelector('.ev-scroll');
  if (!n) return;
  if (typeof S.ui.sx !== 'number') S.ui.sx = Math.max(0, TAG_W + (M.START - 1) * (TILE_W + TILE_GAP) + TILE_W / 2 - n.clientWidth / 2);
  n.scrollLeft = S.ui.sx;
}).observe($app, { childList: true });
ui.boot();
