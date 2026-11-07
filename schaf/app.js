import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'sk',
  maxPlayers: 6,
  options: [],
  newGame: (players) => M.createGame(players, {}, Math.random, sess.cid),
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg); },
  render: () => render(),
  onState: () => render(),
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase !== 'play') return null;
      const ap = M.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, S.learn ? 1 : level, Math.random); // Lernrunde: Computer spielt Mittel
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = {};

const me = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);
const kartenZahl = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);

// ====================== Darstellung ======================
function cardHtml(c, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[c.s];
  const name = `${su.name} ${c.r}`;
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="sk-card s${c.s}${cls ? ' ' + cls : ''}" aria-label="${name}${verb}" ${attrs}>
    <span class="tl" aria-hidden="true">${su.sym}</span><span class="num" aria-hidden="true">${c.r}</span><span class="br" aria-hidden="true">${su.sym}</span></${tag}>`;
}
const emptySlot = (txt) => `<span class="sk-card empty" aria-hidden="true"><span class="num">${txt}</span></span>`;
const backHtml = (n) => `<span class="sk-card back" aria-hidden="true"><span class="sk-count">${n}</span></span>`;

function lastOf(g) { return g.last && typeof g.last === 'object' ? g.last : null; }

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  const ap = M.activePlayer(g);
  const l = lastOf(g);
  const mine = ap.id === cid;
  if (l && l.penalty) {
    const who = l.penalty.pid === cid ? 'Du hast' : `${esc(l.penalty.name)} hat`;
    const w = l.penalty.pid === cid ? 'bekommst' : 'bekommt';
    return `<div class="banner sk-penbanner${mine ? ' mine' : ''}">🐑 Schafskopp! ${who} eine Karte übersehen und ${w} 2 Strafkarten.</div>`;
  }
  return mine ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function rowsHtml(g) {
  const lastPlace = lastOf(g) && lastOf(g).kind === 'place' ? lastOf(g).card : null;
  return M.SUITS.map((su, s) => {
    const row = g.rows[s];
    let cells = '';
    for (let r = 1; r <= M.MAX_RANK; r++) {
      const on = row && r >= row.lo && r <= row.hi;
      cells += `<i class="${on ? 'on' : ''}${r === M.START ? ' start' : ''}"></i>`;
    }
    const newLo = lastPlace && lastPlace.s === s && row && lastPlace.r === row.lo ? ' new' : '';
    const newHi = lastPlace && lastPlace.s === s && row && lastPlace.r === row.hi ? ' new' : '';
    const label = row ? `${su.name}: Reihe von ${row.lo} bis ${row.hi}` : `${su.name}: noch nicht eröffnet, wartet auf die Elf`;
    return `<div class="sk-row s${s}" role="img" aria-label="${label}">
      <div class="sk-rl"><b aria-hidden="true">${su.sym}</b><span>${su.name}</span></div>
      <div class="sk-end lo${row ? '' : ' none'}${newLo}">${row ? row.lo : '–'}</div>
      <div class="sk-band">${cells}${row ? '' : '<span class="wait">wartet auf die 11</span>'}</div>
      <div class="sk-end hi${row ? '' : ' none'}${newHi}">${row ? row.hi : '–'}</div>
    </div>`;
  }).join('');
}

function isMyTurn(g) { return g.phase === 'play' && M.activePlayer(g).id === cid; }

function pileHtml(g, p, { mine, big }) {
  const top = M.topOf(p);
  const l = lastOf(g);
  const fresh = l && l.kind === 'flip' && l.pid === p.id && top && M.sameCard(l.card, top) ? ' flipin' : '';
  const act = isMyTurn(g);
  const cap = `Offen: ${p.pile.length}`;
  if (!top) return `<div class="sk-col">${emptySlot('leer')}<span class="sk-cap">${cap}</span></div>`;
  if (!act) return `<div class="sk-col">${cardHtml(top, { cls: fresh })}<span class="sk-cap">${cap}</span></div>`;
  if (mine) {
    return `<button type="button" class="sk-col sk-tap" data-act="place" aria-label="Deine offene Karte ${M.cardName(top)} anlegen">${cardHtml(top, { cls: fresh })}<span class="sk-cap">${cap}</span><span class="sk-do">Anlegen</span></button>`;
  }
  return `<button type="button" class="sk-col sk-tap" data-act="steal" data-pid="${esc(p.id)}" aria-label="Offene Karte von ${esc(p.name)}, ${M.cardName(top)}, in die Mitte legen">${cardHtml(top, { cls: fresh })}<span class="sk-cap">${cap}</span><span class="sk-do">legen</span></button>`;
}

function deckHtml(g, p, { mine }) {
  const n = p.deck.length;
  if (mine && isMyTurn(g) && n) {
    return `<button type="button" class="sk-col sk-tap" data-act="flip" aria-label="Deinen Stapel aufdecken, ${n} verdeckte Karten">${backHtml(n)}<span class="sk-cap">Stapel</span><span class="sk-do">Aufdecken</span></button>`;
  }
  return `<div class="sk-col" role="img" aria-label="Verdeckter Stapel mit ${n} Karten">${n ? backHtml(n) : emptySlot('leer')}<span class="sk-cap">Stapel</span></div>`;
}

function oppHtml(g, p) {
  const l = S.lobby.find((x) => x.id === p.id);
  const off = l && !l.connected ? ' <span class="offline">(weg)</span>' : '';
  const act = g.phase === 'play' && M.activePlayer(g).id === p.id;
  return `<li class="sk-opp${act ? ' act' : ''}"><div class="sk-hd"><b class="sk-nm">${esc(p.name)}${off}</b><span class="sk-ct">${kartenZahl(M.restCount(g, p))}</span></div>
    <div class="sk-stacks">${deckHtml(g, p, { mine: false })}${pileHtml(g, p, { mine: false })}</div></li>`;
}

function meHtml(g) {
  const p = me();
  if (!p) return `<p class="big center">Du schaust nur zu.</p>`;
  const act = isMyTurn(g);
  const pts = g.penaltyExtra[p.id] || 0;
  return `<div class="sk-me${act ? ' act' : ''}"><div class="sk-hd"><b class="sk-nm">${esc(p.name)} (du)</b><span class="sk-ct">${kartenZahl(M.restCount(g, p))}${pts ? ` (davon ${pts} Strafpunkt${pts > 1 ? 'e' : ''})` : ''}</span></div>
    <div class="sk-stacks">${deckHtml(g, p, { mine: true })}${pileHtml(g, p, { mine: true, big: true })}
    ${act ? `<button type="button" class="btn secondary sk-end-btn" data-act="end">Zug beenden</button>` : '<div class="sk-end-btn ph" aria-hidden="true"></div>'}</div></div>`;
}

function actionHtml(g) {
  const p = me();
  const ap = M.activePlayer(g);
  const l = lastOf(g);
  const last = l && l.text ? l.text : 'Das Spiel beginnt.';
  const pen = l && l.penalty ? ` ${l.penalty.text.replace('🐑 ', '')}` : '';
  if (g.notice && g.notice.pid === cid) return `<p class="big sk-note">${esc(g.notice.text)}</p><p class="muted">Du bist noch dran.</p>`;
  if (!p) return `<p class="big">${esc(last)}</p>`;
  if (ap.id !== cid) return `<p class="big">${esc(last)}${esc(pen)} <b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  return `<p class="big">${esc(last)}${esc(pen)} Du bist dran: Tippe auf deinen Stapel zum Aufdecken, auf eine offene Karte zum Anlegen, oder beende deinen Zug.</p>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  const others = g.players.filter((p) => p.id !== cid);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card sk-board" id="board">
      <div class="sk-rows" aria-label="Die vier Farbreihen in der Tischmitte">${rowsHtml(g)}</div>
      <p class="sk-pstack">Strafstapel: ${kartenZahl(g.penalty.length)}</p>
      <ul class="sk-opps${others.length === 1 ? ' one' : ''}" aria-label="Die Mitspieler">${others.map((p) => oppHtml(g, p)).join('')}</ul>
      ${meHtml(g)}
    </section>
    <section class="card action sk-action" aria-live="polite">${actionHtml(g)}</section>
    ${recapHtml(g)}`;
}

function overHtml(g) {
  const r = g.result;
  const mine = r.winners.includes(cid);
  const isHost = sess.S.role === 'host';
  const names = r.winners.map((id) => g.players.find((p) => p.id === id).name);
  const head = mine ? (names.length > 1 ? 'Du hast mit gewonnen!' : 'Du hast gewonnen!')
    : (names.length > 1 ? `${esc(names.join(' und '))} haben gewonnen!` : `${esc(names[0])} hat gewonnen!`);
  const rows = M.ranking(g).map((x) => `<tr class="${x.place === 1 ? 'lead' : ''}"><td class="n">${x.place}.</td><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.place === 1 ? ' 🏆' : ''}</td><td class="n">${x.rest}</td></tr>`).join('');
  const btns = isHost
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over sk-over"><div class="trophy">${mine ? '🏆' : '🃏'}</div>
      <h1>${head}</h1>
      <p class="center muted">${r.blocked ? 'Es ging nichts mehr: Wer die wenigsten Karten übrig hat, gewinnt.' : 'Wer keine Karten mehr hat, gewinnt.'}</p>
      <div class="sk-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Platzierung</h2><table class="sk-table"><thead><tr><th class="n">Platz</th><th>Name</th><th class="n">Rest&shy;karten</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Restkarten sind verdeckte und offene Karten plus Strafpunkte. Weniger ist besser.</p></section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Werde als Erste/r alle deine Karten los.</p>
    <p class="muted">Der Name „Schafskopp“ ist Absicht und hat nichts mit dem bayerischen Stichspiel Schafkopf zu tun.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 84 Karten: vier Farben (Rot ●, Blau ■, Gelb ▲, Grün ◆) mit den Zahlen 1 bis 21. 12 Karten kommen verdeckt beiseite, das ist der <b>Strafstapel</b>. Die übrigen Karten werden gleichmäßig verteilt. Jede Person hat vor sich einen <b>verdeckten Stapel</b>. Daneben liegt später ihr <b>offener Stapel</b>, dessen oberste Karte du siehst. Bleibt beim Austeilen eine Karte übrig, bekommen die ersten Personen eine mehr.</p>
    <h3>Die Tischmitte</h3>
    <p>In der Mitte liegen vier Reihen, eine pro Farbe. Eine <b>11</b> darf immer gelegt werden und eröffnet die Reihe ihrer Farbe. Danach darf nur eine Karte <b>derselben Farbe</b> angelegt werden, die um <b>eins höher</b> als das obere Ende oder um <b>eins tiefer</b> als das untere Ende der Reihe ist. Die Reihen wachsen von der 11 aus nach oben bis 21 und nach unten bis 1.</p>
    <h3>Dein Zug</h3>
    <ul>
      <li>Tippe auf deinen Stapel: Die oberste Karte wird aufgedeckt und liegt auf deinem offenen Stapel.</li>
      <li>Passt sie auf den Tisch, tippe auf deine offene Karte, um sie anzulegen. Danach deckst du die nächste Karte auf.</li>
      <li>Passt sie nicht, bleibt sie offen liegen und dein Zug ist zu Ende.</li>
      <li>Liegt zu Beginn deines Zugs schon eine passende Karte auf deinem offenen Stapel, musst du sie zuerst anlegen.</li>
      <li>Du darfst auch die <b>offene oberste Karte der anderen</b> in die Mitte legen, wenn sie passt. Tippe dazu auf ihre offene Karte. Passt sie nicht, sagt dir das Spiel Bescheid. Das kostet nichts.</li>
      <li>Mit „Zug beenden“ beendest du deinen Zug freiwillig.</li>
    </ul>
    <h3>Schafskopp: die Strafkarten</h3>
    <p>Wer seinen Zug beendet, obwohl noch irgendeine offene oberste Karte (deine eigene oder eine fremde) in die Mitte passt, hat sie übersehen. Dann ruft das Spiel „Schafskopp!“ und du bekommst <b>zwei Strafkarten</b> aus dem Strafstapel. Sie kommen verdeckt unten auf deinen Stapel. Ist der Strafstapel leer, zählen die zwei Karten als Strafpunkte. Das Spiel zeigt dir nicht an, welche Karten passen. Du musst selbst schauen.</p>
    <h3>Gewinnen</h3>
    <p>Sobald eine Person gar keine Karten mehr hat, weder verdeckte noch offene, gewinnt sie. Die anderen werden nach ihren Restkarten gereiht (verdeckte und offene Karten plus Strafpunkte). Weniger ist besser. Geht gar nichts mehr, gewinnt, wer die wenigsten Karten übrig hat. Zum Schluss kannst du mit „Noch eine Runde“ neu beginnen.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: [],
  tutorial: { bots: 1, coach },
  title: 'Schafskopp', icon: '🐑', sub: 'Das Kartenspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Schafskopp', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'flip': return sess.send({ t: 'flip' });
      case 'place': return sess.send({ t: 'place' });
      case 'steal': return sess.send({ t: 'place', from: el.dataset.pid });
      case 'end': return sess.send({ t: 'end' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
