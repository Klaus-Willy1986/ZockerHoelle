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

const penSentence = (pen) => (pen.pid === cid ? `Du ${M.reasonText(pen.reason).replace(/^hat /, 'hast ')}.` : `${pen.name} ${M.reasonText(pen.reason)}.`);

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  const ap = M.activePlayer(g);
  const l = lastOf(g);
  const mine = ap.id === cid;
  if (l && l.penalty) {
    const t = l.penalty.pid === cid ? 'Du hast gepennt und bekommst von jedem eine Karte.' : `${esc(l.penalty.name)} hat gepennt und bekommt von jedem eine Karte.`;
    return `<div class="banner sk-penbanner${mine ? ' mine' : ''}">🐑 Schafskopp! ${t}</div>`;
  }
  return mine ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function rowsHtml(g) {
  const lastPlace = lastOf(g) && lastOf(g).kind === 'place' && lastOf(g).to === 'center' ? lastOf(g).card : null;
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

// Aufdeckkarte an fester Stelle (für alle sichtbar)
function stageHtml(g) {
  const ap = M.activePlayer(g);
  if (g.phase === 'play' && g.flipped) {
    const who = ap.id === cid ? 'Du hast aufgedeckt:' : `${esc(ap.name)} hat aufgedeckt:`;
    return `<div class="sk-stage on">${cardHtml(g.flipped, { cls: 'flipin' })}<div class="sk-st-t"><b>${who}</b><span>${M.cardName(g.flipped)}</span></div></div>`;
  }
  return `<div class="sk-stage">${emptySlot('')}<div class="sk-st-t"><span>Hier erscheint die aufgedeckte Karte.</span></div></div>`;
}

function pileHtml(g, p, { mine }) {
  const top = M.topOf(p);
  const l = lastOf(g);
  const fresh = l && l.pid === p.id && l.kind === 'flip' && top && M.sameCard(l.card, top) ? ' flipin' : '';
  const cap = `Offen: ${p.pile.length}`;
  if (!top) return `<div class="sk-col">${emptySlot('leer')}<span class="sk-cap">${cap}</span></div>`;
  if (!mine && isMyTurn(g)) {
    return `<button type="button" class="sk-col sk-tap" data-act="place-other" data-pid="${esc(p.id)}" aria-label="Bei ${esc(p.name)} aufdrücken, oberste offene Karte ${M.cardName(top)}">${cardHtml(top, { cls: fresh })}<span class="sk-cap">${cap}</span><span class="sk-do">aufdrücken</span></button>`;
  }
  return `<div class="sk-col">${cardHtml(top, { cls: fresh })}<span class="sk-cap">${cap}</span></div>`;
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
  return `<div class="sk-me${act ? ' act' : ''}"><div class="sk-hd"><b class="sk-nm">${esc(p.name)} (du)</b><span class="sk-ct">${kartenZahl(M.restCount(g, p))}</span></div>
    <div class="sk-stacks">${deckHtml(g, p, { mine: true })}${pileHtml(g, p, { mine: true })}</div></div>`;
}

function actionHtml(g) {
  const p = me();
  const ap = M.activePlayer(g);
  const l = lastOf(g);
  const pen = l && l.penalty ? ` ${penSentence(l.penalty)}` : '';
  if (!p) return `<p class="big">${esc(l && l.text ? l.text : 'Das Spiel beginnt.')}</p>`;
  if (ap.id !== cid) {
    const last = l && l.text ? l.text : 'Das Spiel beginnt.';
    return `<p class="big">${esc(last)}${esc(pen)} <b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  }
  const note = g.notice && g.notice.pid === cid ? `<p class="sk-note">${esc(g.notice.text)}</p>` : '';
  const text = g.flipped
    ? `Du hast ${M.cardName(g.flipped)} aufgedeckt. Wohin damit?`
    : `Du bist dran. Decke eine Karte auf oder lege deine offene Karte ab.`;
  return `<p class="big">${esc(text)}${esc(pen)}</p>${note}
    <div class="sk-btns2"><button type="button" class="btn primary huge" data-act="place-center">In die Mitte</button>
    <button type="button" class="btn secondary huge" data-act="place-own">Bei mir ablegen</button></div>
    <p class="muted small">Zum Aufdrücken tippe auf die offene Karte einer anderen Person.</p>`;
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
      ${stageHtml(g)}
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
  const rows = M.ranking(g).map((x) => `<tr class="${x.place === 1 ? 'lead' : ''}"><td class="n">${x.place}.</td><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.place === 1 ? ' 🏆' : ''}${r.schafskopp.includes(x.id) ? ' 🐑' : ''}</td><td class="n">${x.rest}</td></tr>`).join('');
  const sk = r.schafskopp.length
    ? `<p class="center sk-honor">🐑 Schafskopp der Runde: <b>${esc(r.schafskopp.map((id) => g.players.find((p) => p.id === id).name).join(' und '))}</b> (die meisten Karten)</p>` : '';
  const btns = isHost
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over sk-over"><div class="trophy">${mine ? '🏆' : '🃏'}</div>
      <h1>${head}</h1>
      <p class="center muted">${r.blocked ? 'Es ging nichts mehr: Wer die wenigsten Karten übrig hat, gewinnt.' : 'Wer zuerst alle Karten los ist, gewinnt.'}</p>
      ${sk}
      <div class="sk-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Platzierung</h2><table class="sk-table"><thead><tr><th class="n">Platz</th><th>Name</th><th class="n">Rest&shy;karten</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Restkarten sind verdeckte und offene Karten. Weniger ist besser.</p></section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Werde als Erste/r alle deine Karten los.</p>
    <p class="muted">Der Name „Schafskopp“ ist Absicht und hat nichts mit dem Schafkopf-Kartenspiel zu tun.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 84 Karten: vier Farben (Rot ●, Blau ■, Gelb ▲, Grün ◆) mit den Zahlen 1 bis 21. Alle Karten werden gleichmäßig verteilt. Jede Person hat einen <b>verdeckten Stapel</b>. Daneben entsteht ein <b>offener Stapel</b>, dessen oberste Karte alle sehen. Bleibt beim Austeilen etwas übrig, bekommen die ersten Personen eine Karte mehr.</p>
    <h3>Die Tischmitte</h3>
    <p>In der Mitte liegen vier Reihen, eine pro Farbe. Eine <b>11</b> darf immer in die Mitte und eröffnet die Reihe ihrer Farbe. Danach passt nur eine Karte <b>derselben Farbe</b>, die um <b>eins höher</b> als das obere Ende oder um <b>eins tiefer</b> als das untere Ende der Reihe ist.</p>
    <h3>Aufdrücken</h3>
    <p>Du darfst eine Karte auch bei einer <b>anderen Person</b> auf deren offenen Stapel legen. Sie muss dieselbe Farbe haben und genau um eins höher oder tiefer sein als die oberste offene Karte dieser Person. Beispiel: Liegt bei jemandem eine gelbe 14 oben, passen die gelbe 13 und die gelbe 15. Auf einen leeren offenen Stapel darf nichts gelegt werden. Tippe dazu auf die offene Karte der anderen Person.</p>
    <h3>Gesetz 1: Erst die offene Karte</h3>
    <p>Wenn du dran bist, musst du zuerst deine oberste offene Karte prüfen. Passt sie in die Mitte oder bei jemand anderem, musst du sie dorthin legen. Danach prüfst du die nächste offene Karte darunter. Erst wenn die oberste offene Karte nirgends mehr passt, deckst du die oberste Karte deines verdeckten Stapels auf (Tippe auf deinen Stapel).</p>
    <h3>Gesetz 2: Wohin mit der Karte?</h3>
    <p>Für jede Karte, die du spielen kannst, gilt diese Reihenfolge: <b>Erst die Mitte</b>, wenn nicht, dann <b>bei einer anderen Person aufdrücken</b> (bei mehreren Möglichkeiten darfst du wählen), und nur wenn gar nichts passt, <b>bei dir ablegen</b>. Legst du eine Karte in die Mitte oder bei jemandem auf, geht dein Zug weiter. Legst du die aufgedeckte Karte bei dir ab, ist dein Zug zu Ende.</p>
    <p>Tippst du auf ein Ziel, bei dem die Karte gar nicht passt, sagt dir das Spiel Bescheid. Das kostet nichts.</p>
    <h3>Schafskopp: der Fehler</h3>
    <p>Machst du einen dieser Fehler, bist du der <b>Schafskopp</b>: Du deckst auf, obwohl deine offene Karte noch passte. Oder du legst eine Karte bei dir ab, obwohl sie woanders passte. Oder du drückst eine Karte auf, obwohl sie in die Mitte passte. Die Karte bleibt, wo du sie hingelegt hast. Dazu bekommst du von <b>jeder anderen Person eine Karte</b> (die oberste verdeckte, sonst die oberste offene) unten auf deinen verdeckten Stapel. Dann ist dein Zug sofort zu Ende. Das Spiel zeigt dir nicht an, was passt. Du musst selbst schauen.</p>
    <h3>Gewinnen</h3>
    <p>Wer zuerst alle Karten los ist, verdeckte und offene, gewinnt sofort. Die anderen werden nach ihren Restkarten gereiht. Wer die meisten Karten übrig hat, bekommt den Ehrentitel „Schafskopp der Runde“ (ohne Punkte). Geht gar nichts mehr, gewinnt, wer die wenigsten Karten hat. Mit „Noch eine Runde“ geht es von vorn los.</p>
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
      case 'place-center': return sess.send({ t: 'place', to: 'center' });
      case 'place-own': return sess.send({ t: 'place', to: 'own' });
      case 'place-other': return sess.send({ t: 'place', to: 'other', pid: el.dataset.pid });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
