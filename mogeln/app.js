import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');
const freshUi = () => ({ sel: [], full: false });

const sess = createSession({
  game: 'mg',
  maxPlayers: M.MAX_PLAYERS,
  options: [],
  newGame: (players) => { S.ui = { ...S.ui, ...freshUi() }; return M.createGame(players, {}, Math.random, sess.cid); },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase === 'over') return null;
      if (g.phase === 'reveal') {
        // Weiter-Klick macht ein Mensch; sind nur noch Computer im Spiel, geht es von selbst weiter
        if (g.players.some((p) => !String(p.id).startsWith('bot'))) return null;
        return { id: g.players[0].id, msg: { t: 'next' } };
      }
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
const nameOf = (id) => { const p = S.game.players.find((x) => x.id === id); return p ? p.name : ''; };
const who = (id) => (id === cid ? 'Du' : esc(nameOf(id)));
const kartenZahl = M.kartenZahl;

function onStateChanged() {
  const g = S.game;
  const p = me();
  if (S.ui.sel.length) {
    const my = g && g.phase === 'play' && p && M.activePlayer(g).id === cid;
    S.ui.sel = my ? S.ui.sel.filter((c) => p.hand.includes(c)) : [];
    if (!S.ui.sel.length) S.ui.full = false;
  }
  render();
}

// ====================== Darstellung ======================
const LABELED = new Set([0, 10, 11, 12]); // Ass, Bube, Dame, König bekommen ein Wort
function cardHtml(c, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[M.suitOf(c)];
  const rk = M.RANKS[M.rankOf(c)];
  const name = `${su.name} ${rk.name}`;
  const word = LABELED.has(M.rankOf(c)) ? `<span class="nm">${rk.name}</span>` : '';
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="mg-card${su.red ? ' red' : ''}${cls ? ' ' + cls : ''}" title="${name}" aria-label="${name}${verb}" ${attrs}>
    <span class="tl"><span class="rk">${rk.sym}</span><span class="ss" aria-hidden="true">${su.sym}</span></span>
    <span class="mid" aria-hidden="true">${su.sym}</span>${word}</${tag}>`;
}
const backHtml = (extra = '') => `<span class="mg-card back${extra ? ' ' + extra : ''}" aria-hidden="true"></span>`;

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  if (g.phase === 'reveal') return `<div class="banner">Aufgedeckt!</div>`;
  const ap = M.activePlayer(g);
  if (g.phase === 'decide') return ap.id === cid ? `<div class="banner mine">Glaubst du das?</div>` : `<div class="banner">${esc(ap.name)} überlegt</div>`;
  return ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function opponentsHtml(g) {
  const others = g.players.filter((p) => p.id !== cid);
  const ap = M.activePlayer(g);
  const lis = others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' ⚠' : '';
    const n = p.hand.length;
    return `<li class="mg-opp${g.phase !== 'over' && ap.id === p.id ? ' act' : ''}"><b class="mg-nm" title="${esc(p.name)}">${esc(p.name)}${off}</b><span class="mg-ct">${kartenZahl(n)}</span></li>`;
  }).join('');
  return `<ul class="mg-opps${others.length === 1 ? ' one' : ''}" aria-label="Die Mitspieler und ihre Kartenzahl">${lis}</ul>`;
}

// Ergebnistext aus Sicht dieser Person
export function resultText(l, myId) {
  const annMe = l.announcerId === myId;
  const dbtMe = l.doubterId === myId;
  const ann = annMe ? 'Du' : l.announcerName;
  const dbt = dbtMe ? 'Du' : l.doubterName;
  const n = kartenZahl(l.taken);
  if (l.liar) return `${ann} ${annMe ? 'hast' : 'hat'} gemogelt! ${ann} ${annMe ? 'nimmst' : 'nimmt'} den Stapel (${n}).`;
  return `${ann} ${annMe ? 'hast' : 'hat'} die Wahrheit gesagt. ${dbt} ${dbtMe ? 'hast' : 'hat'} zu Unrecht gezweifelt und ${dbtMe ? 'nimmst' : 'nimmt'} den Stapel (${n}).`;
}

function playLine(g) {
  const lp = g.lastPlay;
  const by = lp.pid === cid ? 'Du hast' : `${lp.name} hat`;
  return `${by} ${kartenZahl(lp.count)} gelegt: ${M.rankPlural(lp.rank)}`;
}

function centerHtml(g) {
  const reveal = g.phase === 'reveal';
  const lp = g.lastPlay;
  const pileN = g.pile.length;
  let strip = '';
  let line;
  if (reveal && g.last && g.last.kind === 'reveal') {
    strip = g.last.ids.map((c) => {
      const okc = M.rankOf(c) === g.last.rank;
      return `<span class="mg-rv ${okc ? 'ok' : 'bad'}">${cardHtml(c, { cls: 'sm' })}<i aria-hidden="true">${okc ? '✔' : '✘'}</i></span>`;
    }).join('');
    line = `Aufgedeckt: ${g.last.ids.map((c) => M.cardName(c)).join(', ')}`;
  } else if (lp && pileN > 0) {
    strip = Array.from({ length: lp.count }, () => backHtml('sm')).join('');
    line = playLine(g);
  } else {
    line = pileN > 0 ? '' : 'Der Stapel ist leer. Noch nichts gelegt.';
  }
  return `<div class="mg-center">
    <div class="mg-pilecol"><div class="mg-pile" role="img" aria-label="Verdeckter Stapel mit ${kartenZahl(pileN)}">${backHtml()}<span class="mg-count">${pileN}</span></div><span class="mg-lbl">Stapel</span></div>
    <div class="mg-rankbox"><span class="mg-all">Alle:</span><b class="mg-rank">${esc(M.rankPlural(M.shownRank(g)))}</b></div>
  </div>
  <div class="mg-strip" aria-label="Zuletzt gelegte Karten">${strip}</div>
  <p class="mg-line">${esc(line)}</p>`;
}

function actionHtml(g) {
  const p = me();
  if (!p) return `<p class="big">Du schaust nur zu.</p>`;
  const ap = M.activePlayer(g);
  const isMe = ap.id === cid;
  if (g.phase === 'reveal') {
    const l = g.last;
    const start = ap.id === cid ? 'Du beginnst' : `${esc(ap.name)} beginnt`;
    return `<p class="big mg-result">${esc(resultText(l, cid))}</p>
      <p class="mg-sub">${start}. Es geht weiter mit: ${esc(M.rankPlural(g.rank))}.</p>
      <button type="button" class="btn primary huge" data-act="next">➡ Weiter</button>`;
  }
  if (g.phase === 'decide') {
    const lp = g.lastPlay;
    const said = `${lp.pid === cid ? 'Du hast' : `<b>${esc(lp.name)}</b> hat`} ${kartenZahl(lp.count)} gelegt: <b>${esc(M.rankPlural(lp.rank))}</b>.`;
    if (!isMe) return `<p class="big">${said} ${esc(ap.name)} überlegt.</p>`;
    return `<p class="big">${said} Glaubst du das?</p>
      <button type="button" class="btn secondary huge" data-act="believe">👍 Glauben</button>
      <button type="button" class="btn primary huge" data-act="call">🕵️ Mogler!</button>`;
  }
  // Phase play
  if (!isMe) return `<p class="big"><b>${esc(ap.name)}</b> ist dran und legt gleich Karten ab.</p>`;
  const n = S.ui.sel.length;
  const sub = S.ui.full ? 'Mehr als 4 Karten gehen nicht.' : n ? `${kartenZahl(n)} markiert.` : 'Tippe unten auf deine Karten, um sie zu markieren.';
  return `<p class="big">Du bist dran. Lege 1 bis 4 Karten verdeckt ab und sage: <b>Alle ${esc(M.rankPlural(g.rank))}</b>.</p>
    <p class="mg-sub">${sub}</p>
    <button type="button" class="btn primary huge" data-act="play" ${n >= 1 && n <= M.MAX_PLAY ? '' : 'disabled'}>🃏 Karten legen</button>`;
}

function handHtml(g) {
  const p = me();
  if (!p) return '';
  const myTurn = g.phase === 'play' && M.activePlayer(g).id === cid;
  const cards = p.hand.map((c) => {
    const sel = S.ui.sel.includes(c);
    const cls = sel ? 'sel' : '';
    if (myTurn) return cardHtml(c, { cls, tag: 'button', attrs: `data-act="card" data-id="${c}" aria-pressed="${sel}"`, verb: sel ? ', markiert' : ', markieren' });
    return cardHtml(c, { cls });
  }).join('');
  const empty = p.hand.length === 0 ? '<p class="mg-sub">Du hast keine Karten mehr. Jetzt entscheidet die nächste Person.</p>' : '';
  return `<section class="card mg-handcard"><h2>Deine Karten (${p.hand.length})</h2><div class="mg-hand" role="group" aria-label="Deine Handkarten">${cards}</div>${empty}</section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function scoreHtml(g) {
  const rows = M.standings(g);
  const lead = rows[0] && rows[0].wins > 0 ? rows[0].id : null;
  const body = rows.map((r) => `<tr class="${r.id === lead ? 'lead' : ''}"><td>${esc(r.name)}${r.id === cid ? ' (du)' : ''}${r.id === lead ? ' 🏆' : ''}</td><td class="n">${r.wins}</td><td class="n">${r.cards}</td></tr>`).join('');
  return `<section class="card"><h2>Spielstand</h2><table class="mg-table"><thead><tr><th>Name</th><th class="n">Runden<br>gewonnen</th><th class="n">Karten<br>übrig</th></tr></thead><tbody>${body}</tbody></table>
    <p class="muted small">Jede gewonnene Runde gibt einen Siegpunkt.</p></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card mg-board" id="board">${opponentsHtml(g)}${centerHtml(g)}</section>
    <section class="card action mg-action" aria-live="polite">${actionHtml(g)}</section>
    ${handHtml(g)}
    ${recapHtml(g)}${scoreHtml(g)}`;
}

function overHtml(g) {
  const r = g.result;
  const mine = r.winner === cid;
  const isHost = sess.S.role === 'host';
  const btns = isHost
    ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>
       <button class="btn secondary" data-act="again">Neues Spiel (Spielstand löschen)</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  const lastLine = g.last && g.last.kind === 'reveal' ? `<p class="center big">${esc(resultText(g.last, cid))}</p>` : '';
  const rows = M.ranking(g).map((x) => `<tr class="${x.place === 1 ? 'lead' : ''}"><td class="n">${x.place}.</td><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.place === 1 ? ' 🏆' : ''}</td><td class="n">${x.cards}</td></tr>`).join('');
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over mg-over"><div class="trophy">${mine ? '🏆' : '🃏'}</div>
      <h1>${mine ? 'Du hast die Runde gewonnen!' : `${esc(r.winnerName)} hat die Runde gewonnen!`}</h1>
      <p class="center muted">${r.capped ? 'Die Runde war sehr lang: Wer die wenigsten Karten hat, gewinnt.' : 'Wer zuerst keine Karten mehr hat und den Zweifel übersteht, gewinnt.'}</p>
      ${lastLine}
      <div class="mg-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Platzierung</h2><table class="mg-table"><thead><tr><th class="n">Platz</th><th>Name</th><th class="n">Karten übrig</th></tr></thead><tbody>${rows}</tbody></table></section>
    ${scoreHtml(g)}${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Werde als Erste/r alle deine Karten los. Dazu darfst du schwindeln, aber nicht erwischt werden.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 52 Karten: Ass, 2 bis 10, Bube, Dame und König in Kreuz ♣, Pik ♠, Herz ♥ und Karo ♦. Alle Karten werden gleichmäßig verteilt. Bleibt eine Karte übrig, bekommen die ersten Personen eine mehr. Deine Karten sind nach Wert sortiert.</p>
    <h3>Dein Zug</h3>
    <ul>
      <li>Der Rang ist vorgegeben: Zuerst sind es <b>Asse</b>, dann <b>Zweier</b>, <b>Dreier</b> und so weiter bis zu den <b>Königen</b>. Danach geht es wieder bei den Assen los. Das steht groß in der Mitte bei „Alle:“.</li>
      <li>Du legst <b>1 bis 4 Karten verdeckt</b> auf den Stapel und sagst damit: „Das sind alles Zweier“ (oder was gerade dran ist). Tippe dazu auf deine Karten, um sie zu markieren, und dann auf „Karten legen“.</li>
      <li>Du darfst <b>lügen</b>: Es dürfen auch ganz andere Karten sein. Das nennt man mogeln.</li>
    </ul>
    <h3>Glauben oder „Mogler!“</h3>
    <p>Gleich danach entscheidet die <b>nächste Person</b>:</p>
    <ul>
      <li><b>Glauben:</b> Alles bleibt verdeckt. Die Person ist jetzt selbst dran und legt Karten für den nächsten Rang.</li>
      <li><b>Mogler!:</b> Die zuletzt gelegten Karten werden aufgedeckt (nur diese). War mindestens eine davon <b>nicht</b> vom angesagten Rang, nimmt die Person, die gelegt hat, den <b>ganzen Stapel</b> auf die Hand. Stimmte alles, nimmt die Person, die gezweifelt hat, den ganzen Stapel.</li>
      <li>Danach beginnt die Person nach der zweifelnden Person. Der Stapel ist leer, der Rang geht weiter.</li>
    </ul>
    <h3>Gewinnen</h3>
    <p>Wer als Erste/r alle Karten los ist, gewinnt. Aber Achtung: Die nächste Person muss die letzte Ablage noch entscheiden. War sie gelogen und wird angezweifelt, nimmt man den Stapel auf. Erst wenn man danach noch keine Karten hat, ist man Siegerin oder Sieger. Die Tabelle zeigt die gewonnenen Runden. Mit „Nächste Runde“ geht es weiter, der Spielstand bleibt.</p>
    <p class="muted">Das Spiel sagt dir nie, ob jemand lügt oder was du legen sollst. Das merkst du dir selbst. Wird eine Runde sehr lang, gewinnt, wer die wenigsten Karten hat.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3, 4, 5], levels: ['Leicht', 'Mittel'],
  options: [],
  tutorial: { bots: 1, coach },
  title: 'Mogeln', icon: '🕵️', sub: 'Das Karten-Bluffspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Mogeln', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    const p = me();
    switch (act) {
      case 'card': {
        if (!g || !p || g.phase !== 'play' || M.activePlayer(g).id !== cid) return undefined;
        const id = Number(el.dataset.id);
        if (!p.hand.includes(id)) return undefined;
        if (S.ui.sel.includes(id)) { S.ui.sel = S.ui.sel.filter((c) => c !== id); S.ui.full = false; }
        else if (S.ui.sel.length >= M.MAX_PLAY) S.ui.full = true;
        else { S.ui.sel = [...S.ui.sel, id]; S.ui.full = false; }
        return render();
      }
      case 'play': {
        const cards = S.ui.sel.slice();
        if (!g || g.phase !== 'play' || cards.length < 1 || cards.length > M.MAX_PLAY) return undefined;
        S.ui.sel = []; S.ui.full = false;
        return sess.send({ t: 'play', cards });
      }
      case 'believe': return sess.send({ t: 'believe' });
      case 'call': return sess.send({ t: 'call' });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
