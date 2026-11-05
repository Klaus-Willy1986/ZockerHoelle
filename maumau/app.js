import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'ace', label: 'Ass dreht die Spielrichtung', help: 'Wer ein Ass legt, ändert die Richtung. Bei nur 2 Personen hat das keine Wirkung.', def: false },
  { id: 'auto', label: 'Rufe automatisch', help: '„Mau!“ und „Mau Mau!“ werden für alle automatisch gerufen. Niemand muss daran denken.', def: false },
];
const MAU_WAIT = 6000; // so lange wartet der Computer, bis du „Mau!“ gerufen hast

const freshUi = () => ({ sel: null });

const sess = createSession({
  game: 'mm',
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
      if (!g || g.phase !== 'play') return null;
      const ap = M.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      // Ein Mensch, der „Mau!“ rufen muss, bekommt etwas Zeit, bevor der Computer weiterspielt
      if (g.mau && !g.mau.called && !String(g.mau.pid).startsWith('bot')) {
        const k = `${g.gid}|${g.round}|${g.discard.length}|${g.mau.pid}`;
        if (mauWait.key !== k) { mauWait.key = k; mauWait.t = Date.now(); }
        const left = MAU_WAIT - (Date.now() - mauWait.t);
        if (left > 0) {
          clearTimeout(mauWait.timer);
          mauWait.timer = setTimeout(() => sess.send({ t: 'nudge' }), left + 30);
          return null;
        }
      }
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const mauWait = { key: '', t: 0, timer: null };
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const me = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);
const sameC = M.sameCard;

function onStateChanged() {
  const g = S.game;
  const sel = S.ui.sel;
  if (sel) {
    const p = me();
    if (!g || g.phase !== 'play' || !p || M.activePlayer(g).id !== cid || !p.hand.some((c) => sameC(c, sel.card)) || g.turn.forced) S.ui.sel = null;
  }
  render();
}

// ====================== Darstellung ======================
const LABELED = new Set([M.RJ, 5, 6, M.RA]); // Bube, Dame, König, Ass bekommen ein Wort
function cardHtml(c, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[c.s];
  const rk = M.RANKS[c.r];
  const name = `${su.name} ${rk.name}`;
  const word = LABELED.has(c.r) ? `<span class="nm">${rk.name}</span>` : '';
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="mm-card${su.red ? ' red' : ''}${cls ? ' ' + cls : ''}" title="${name}" aria-label="${name}${verb}" ${attrs}>
    <span class="tl"><span class="rk">${rk.sym}</span><span class="ss" aria-hidden="true">${su.sym}</span></span>
    <span class="mid" aria-hidden="true">${su.sym}</span>${word}</${tag}>`;
}
const backHtml = (extra = '') => `<span class="mm-card back${extra ? ' ' + extra : ''}" aria-hidden="true"></span>`;

const kartenZahl = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  const ap = M.activePlayer(g);
  const f = g.turn.forced;
  if (ap.id === cid) {
    if (f === 'seven') return `<div class="banner mine">Du musst zwei Karten ziehen</div>`;
    if (f === 'eight') return `<div class="banner mine">Du musst aussetzen</div>`;
    return `<div class="banner mine">Du bist dran!</div>`;
  }
  if (f === 'seven') return `<div class="banner">${esc(ap.name)} muss zwei Karten ziehen</div>`;
  if (f === 'eight') return `<div class="banner">${esc(ap.name)} setzt aus</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

const canDrawMore = (g) => g.deck.length > 0 || g.discard.length > 1;
function drawAllowed(g) {
  if (g.phase !== 'play') return false;
  const ap = M.activePlayer(g);
  if (ap.id !== cid) return false;
  if (g.turn.forced === 'seven') return true;
  if (g.turn.forced === 'eight' || g.turn.drew) return false;
  return !M.hasPlayable(g, ap);
}

function opponentsHtml(g) {
  const others = g.players.filter((p) => p.id !== cid);
  const ap = M.activePlayer(g);
  const lis = others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const n = p.hand.length;
    const shown = Math.min(n, 7);
    const backs = Array.from({ length: shown }, () => backHtml()).join('');
    return `<li class="mm-opp${g.phase === 'play' && ap.id === p.id ? ' act' : ''}"><b class="mm-nm">${esc(p.name)}${off}</b>
      <span class="mm-backs" aria-hidden="true">${backs}${n > shown ? `<span class="more">+${n - shown}</span>` : ''}</span><span class="mm-ct">${kartenZahl(n)}</span></li>`;
  }).join('');
  return `<ul class="mm-opps${others.length === 1 ? ' one' : ''}" aria-label="Die Mitspieler">${lis}</ul>`;
}

function centerHtml(g) {
  const topC = g.discard[g.discard.length - 1];
  const can = drawAllowed(g);
  const cnt = `<span class="mm-count">${g.deck.length}</span>`;
  const pileInner = `${backHtml()}${cnt}`;
  const pile = can
    ? `<button type="button" class="mm-pile" data-act="draw" aria-label="Stapel: Karte ziehen, ${g.deck.length} Karten im Stapel">${pileInner}</button>`
    : `<div class="mm-pile" role="img" aria-label="Verdeckter Stapel mit ${g.deck.length} Karten">${pileInner}</div>`;
  const cw = g.dir === 1 ? ['↻', 'im Uhrzeigersinn'] : ['↺', 'gegen den Uhrzeigersinn'];
  const w = g.wish;
  const wishBox = w !== null && w !== undefined
    ? `<div class="mm-wish on${M.SUITS[w].red ? ' red' : ''}">Gewünschte Farbe:<b>${M.SUITS[w].sym} ${M.SUITS[w].name}</b></div>`
    : `<div class="mm-wish">Kein Farbwunsch</div>`;
  return `<div class="mm-center">
    <div class="mm-pilecol">${pile}<span class="mm-lbl">Stapel</span></div>
    <div class="mm-disccol">${cardHtml(topC, { cls: 'lg' })}<span class="mm-lbl">Ablage</span></div>
    <div class="mm-info"><div class="mm-dir" aria-label="Spielrichtung ${cw[1]}"><b aria-hidden="true">${cw[0]}</b>${cw[1]}</div>${wishBox}</div>
  </div>`;
}

function actionHtml(g) {
  const p = me();
  if (!p) return `<p class="big">Du schaust nur zu.</p>`;
  const ap = M.activePlayer(g);
  const f = g.turn.forced;
  // „Mau!“ rufen hat Vorrang
  if (g.mau && g.mau.pid === cid && !g.mau.called) {
    return `<p class="big">Du hast nur noch <b>eine Karte</b>. Rufe jetzt „Mau!“ – sonst musst du zwei Karten ziehen.</p>
      <button class="btn mm-mau" data-act="mau">📣 Mau!</button>`;
  }
  if (ap.id !== cid) {
    if (f === 'seven') return `<p class="big"><b>${esc(ap.name)}</b> muss wegen der Sieben zwei Karten ziehen und setzt aus.</p>`;
    if (f === 'eight') return `<p class="big"><b>${esc(ap.name)}</b> muss wegen der Acht aussetzen.</p>`;
    return `<p class="big"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  }
  if (f === 'seven') {
    return `<p class="big">Es wurde eine Sieben gelegt. Du musst <b>zwei Karten ziehen</b> und setzt dann aus.</p>
      <button class="btn primary huge" data-act="draw">Zwei Karten ziehen</button>`;
  }
  if (f === 'eight') {
    return `<p class="big">Es wurde eine Acht gelegt. Du <b>setzt diese Runde aus</b>.</p>
      <button class="btn primary huge" data-act="skip">Okay, ich setze aus</button>`;
  }
  const sel = S.ui.sel;
  if (sel && sel.last) {
    return `<p class="big">Das ist deine <b>letzte Karte</b>: ${esc(M.cardName(sel.card))}. Beim Legen musst du „Mau Mau!“ rufen.</p>
      <button class="btn primary huge" data-act="play-last">📣 Mau Mau! Letzte Karte legen</button>
      <button class="btn ghost" data-act="sel-cancel">Doch nicht</button>`;
  }
  if (sel) {
    const btns = M.SUITS.map((su, i) => `<button class="btn${su.red ? ' red' : ''}" data-act="wish" data-suit="${i}" aria-label="${su.name} wünschen"><span aria-hidden="true">${su.sym}</span><small>${su.name}</small></button>`).join('');
    return `<p class="big">Du legst einen Buben. <b>Welche Farbe wünschst du dir?</b></p>
      <div class="mm-wishes">${btns}</div>
      <button class="btn ghost" data-act="sel-cancel">Zurück</button>`;
  }
  if (g.turn.drew) {
    return `<p class="big">Die gezogene Karte passt (sie ist mit „neu“ markiert). Du kannst sie <b>legen</b> oder <b>behalten</b>.</p>
      <button class="btn secondary huge" data-act="pass">Karte behalten</button>`;
  }
  if (!M.hasPlayable(g, p)) {
    if (!canDrawMore(g)) {
      return `<p class="big">Du hast keine passende Karte und es gibt keine Karte mehr zum Ziehen. Du setzt aus.</p>
        <button class="btn primary huge" data-act="draw">Okay, ich setze aus</button>`;
    }
    return `<p class="big">Du hast <b>keine passende Karte</b>. Tippe auf den Stapel und ziehe eine Karte.</p>
      <button class="btn primary huge" data-act="draw">Karte ziehen</button>`;
  }
  const w = g.wish !== null ? ` Gewünscht ist ${M.SUITS[g.wish].sym} ${M.SUITS[g.wish].name} (oder ein Bube).` : '';
  return `<p class="big">Lege eine Karte mit <b>gleicher Farbe</b> oder <b>gleichem Wert</b>. Tippe auf eine grün umrandete Karte.${w}</p>`;
}

function handHtml(g) {
  const p = me();
  if (!p) return '';
  const myTurn = g.phase === 'play' && M.activePlayer(g).id === cid && !g.turn.forced;
  const sel = S.ui.sel;
  let selDone = false;
  const drawn = g.turn.drew ? g.turn.drawn : null;
  let freshDone = false;
  const cards = p.hand.map((c) => {
    const ok = myTurn && M.playable(g, c);
    let cls = '';
    if (myTurn) cls = ok ? 'can' : 'dim';
    if (sel && !selDone && sameC(sel.card, c)) { selDone = true; cls += ' sel'; }
    if (drawn && !freshDone && sameC(drawn, c)) { freshDone = true; cls += ' fresh'; }
    if (ok) {
      return cardHtml(c, { cls, tag: 'button', attrs: `data-act="card" data-s="${c.s}" data-r="${c.r}"`, verb: ', legen' });
    }
    return cardHtml(c, { cls });
  }).join('');
  return `<section class="card mm-handcard"><h2>Deine Karten (${p.hand.length})</h2><div class="mm-hand" role="group" aria-label="Deine Handkarten">${cards}</div></section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 5).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function scoreHtml(g, withRound) {
  const rows = M.standings(g);
  const lead = rows[0] && rows[0].wins > 0 ? rows[0].id : null;
  const head = `<tr><th>Name</th><th class="n">Runden<br>gewonnen</th>${withRound ? '<th class="n">Diese<br>Runde</th>' : ''}<th class="n">Punkte</th></tr>`;
  const body = rows.map((r) => `<tr class="${r.id === lead ? 'lead' : ''}"><td>${esc(r.name)}${r.id === cid ? ' (du)' : ''}${r.id === lead ? ' 🏆' : ''}</td><td class="n">${r.wins}</td>${withRound ? `<td class="n add">${r.id === g.result.winner ? '0' : '+' + g.result.points[r.id]}</td>` : ''}<td class="n">${r.points}</td></tr>`).join('');
  return `<section class="card"><h2>Spielstand</h2><table class="mm-table"><thead>${head}</thead><tbody>${body}</tbody></table>
    <p class="muted small">Gewinner der Runde bekommt 0 Punkte. Alle anderen zählen ihre übrigen Karten. Weniger Punkte sind besser.</p></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card mm-board" id="board">${opponentsHtml(g)}${centerHtml(g)}</section>
    ${handHtml(g)}
    <section class="card action mm-action" aria-live="polite">${actionHtml(g)}</section>
    ${recapHtml(g)}${scoreHtml(g, false)}`;
}

function overHtml(g) {
  const r = g.result;
  const mine = r.winner === cid;
  const isHost = sess.S.role === 'host';
  const left = g.players.filter((p) => p.id !== r.winner).map((p) => `<h3>${esc(p.name)}${p.id === cid ? ' (du)' : ''}: ${p.hand.length ? `${kartenZahl(p.hand.length)} = ${r.points[p.id]} Punkte` : 'keine Karten'}</h3>
    <div class="mm-hand">${p.hand.map((c) => cardHtml(c)).join('')}</div>`).join('');
  const btns = isHost
    ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>
       <button class="btn secondary" data-act="again">Neues Spiel (Spielstand löschen)</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card over mm-over"><div class="trophy">${mine ? '🏆' : '🃏'}</div>
      <h1>${mine ? 'Du hast die Runde gewonnen!' : `${esc(r.winnerName)} hat die Runde gewonnen!`}</h1>
      ${r.blocked ? '<p class="center muted">Es ging nichts mehr: Die wenigsten Punkte gewinnen.</p>' : ''}
      <div class="mm-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    ${scoreHtml(g, true)}
    <section class="card mm-left"><h2>Übrig gebliebene Karten</h2>${left}</section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Werde als Erste/r alle deine Karten los. Zum Schluss musst du „Mau Mau!“ rufen.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 32 Karten: 7, 8, 9, 10, Bube, Dame, König und Ass in Kreuz ♣, Pik ♠, Herz ♥ und Karo ♦. Bei 5 oder 6 Personen werden zwei Blätter (64 Karten) gemischt. Jede Person bekommt 5 Karten. Der Rest liegt verdeckt als <b>Stapel</b> in der Mitte. Die oberste Karte wird daneben aufgedeckt – das ist der <b>Ablagestapel</b>. Die erste Karte hat keine besondere Wirkung.</p>
    <h3>Dein Zug</h3>
    <ul>
      <li>Lege eine Karte mit der <b>gleichen Farbe</b> oder dem <b>gleichen Wert</b> wie die oberste Karte auf dem Ablagestapel. Tippe dazu auf eine grün umrandete Karte.</li>
      <li>Hast du eine passende Karte, <b>musst</b> du eine legen. Freiwilliges Ziehen gibt es nicht.</li>
      <li>Hast du keine passende Karte, ziehst du eine Karte vom Stapel. Passt sie, darfst du sie sofort legen oder behalten. Passt sie nicht, ist die nächste Person dran.</li>
      <li>Ist der Stapel leer, werden die Karten vom Ablagestapel (außer der obersten) neu gemischt. Geht auch das nicht, setzt du aus.</li>
      <li>Es geht reihum im Uhrzeigersinn. Es beginnt die Person links vom Geber, in der nächsten Runde die nächste Person.</li>
    </ul>
    <h3>Die besonderen Karten</h3>
    <ul>
      <li><b>7:</b> Die nächste Person muss <b>zwei Karten ziehen</b> und setzt damit für diese Runde aus. Eine Sieben kann man nicht mit einer anderen Sieben weitergeben.</li>
      <li><b>8:</b> Die nächste Person <b>setzt eine Runde aus</b>.</li>
      <li><b>Bube:</b> Er passt auf jede Karte. Du wünschst dir dazu eine Farbe. Die nächste Person muss diese Farbe legen (oder einen Buben). Die gewünschte Farbe wird in der Mitte angezeigt.</li>
      <li><b>Ass:</b> Normalerweise ist das Ass eine ganz normale Karte. Wenn das Kästchen „Ass dreht die Spielrichtung“ angekreuzt ist, ändert ein Ass die Spielrichtung. Bei nur 2 Personen hat das keine Wirkung.</li>
    </ul>
    <h3>Mau und Mau Mau</h3>
    <ul>
      <li>Hast du nach dem Legen nur noch <b>eine Karte</b>, musst du „<b>Mau!</b>“ rufen. Dazu erscheint ein großer roter Knopf. Rufst du nicht, bevor die nächste Person etwas tut, musst du zur Strafe <b>zwei Karten</b> ziehen.</li>
      <li>Legst du deine <b>letzte Karte</b>, musst du dabei „<b>Mau Mau!</b>“ rufen. Du bestätigst das mit einem Knopf. Ohne Ruf bekommst du zwei Karten als Strafe und das Spiel geht weiter.</li>
      <li>Auf der Startseite kannst du „Rufe automatisch“ ankreuzen. Dann wird für alle immer automatisch gerufen.</li>
    </ul>
    <h3>Gewinnen und Punkte</h3>
    <p>Wer zuerst keine Karten mehr hat und „Mau Mau!“ gerufen hat, gewinnt die Runde. Die anderen zählen ihre übrigen Karten: 7 bis 10 nach Augenzahl, Bube 20, Dame 10, König 10, Ass 11. Der Gewinner bekommt 0 Punkte. <b>Weniger Punkte sind besser.</b> Die Tabelle zeigt die gewonnenen Runden und die Punkte über alle Runden. Mit „Nächste Runde“ geht es weiter, der Spielstand bleibt.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge, wertet alles selbst aus und zeigt dir, welche Karten du legen darfst. Geht in einer Runde gar nichts mehr, gewinnt, wer die wenigsten Punkte auf der Hand hat.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 1, coach },
  title: 'Mau-Mau', icon: '🃏', sub: 'Das Kartenspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Mau-Mau', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'card': {
        const card = { s: Number(el.dataset.s), r: Number(el.dataset.r) };
        const p = me();
        if (!g || !p) return undefined;
        const auto = g.opts.auto;
        const last = p.hand.length === 1;
        if (last && !auto) { S.ui.sel = { card, last: true }; return render(); }
        if (card.r === M.RJ && !(last && auto)) { S.ui.sel = { card, last: false }; return render(); }
        return sess.send({ t: 'play', card, ...(last ? { call: true } : {}) });
      }
      case 'wish': {
        const sel = S.ui.sel;
        if (!sel) return undefined;
        S.ui.sel = null;
        return sess.send({ t: 'play', card: sel.card, wish: Number(el.dataset.suit) });
      }
      case 'play-last': {
        const sel = S.ui.sel;
        if (!sel) return undefined;
        S.ui.sel = null;
        return sess.send({ t: 'play', card: sel.card, call: true, wish: 0 });
      }
      case 'sel-cancel': S.ui.sel = null; return render();
      case 'draw': return sess.send({ t: 'draw' });
      case 'pass': return sess.send({ t: 'pass' });
      case 'skip': return sess.send({ t: 'skip' });
      case 'mau': return sess.send({ t: 'mau' });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
