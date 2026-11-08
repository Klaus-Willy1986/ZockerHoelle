import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'hints', label: 'Spielbare Karten anzeigen', help: 'Zeigt dir, welche Karten du gerade spielen darfst. Ohne diese Hilfe musst du selbst schauen, was erlaubt ist.', def: false },
  { id: 'lastNotEqual', label: 'Der Letzte darf nicht ausgleichen', help: 'Wer als Letzte oder Letzter ansagt, darf keine Zahl wählen, bei der alle Ansagen zusammen genau die Kartenzahl ergeben. So geht nie jede Runde glatt auf.', def: false },
  { id: 'short', label: 'Kurzes Spiel (nur die Hälfte der Runden)', help: 'Das Spiel ist nach der Hälfte der Runden zu Ende.', def: false },
];

// Nur für Tests: ?rounds=3 verkürzt das Spiel auf 3 Runden
const urlRounds = () => {
  const n = Number(new URLSearchParams(location.search).get('rounds'));
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : undefined;
};
// Nur für Tests: ?startRound=10 beginnt mit Runde 10 (viele Karten, für Layout-Prüfungen)
const urlStart = () => {
  const n = Number(new URLSearchParams(location.search).get('startRound'));
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : undefined;
};
const LEARN_ROUNDS = 4;

const freshUi = () => ({ note: null, tableOpen: false });

const sess = createSession({
  game: 'st',
  maxPlayers: M.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => {
    S.ui = { ...S.ui, ...freshUi() };
    const o = { hints: !!opts.hints || !!S.learn, lastNotEqual: !!opts.lastNotEqual && !S.learn, short: !!opts.short, totalRounds: urlRounds(), startRound: urlStart() };
    if (S.learn) { o.totalRounds = LEARN_ROUNDS; o.dealer = players.length - 1; o.short = false; } // Lernrunde: Computer gibt, du sagst zuerst an
    return M.createGame(players, o, Math.random, sess.cid);
  },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || (g.phase !== 'trump' && g.phase !== 'bid' && g.phase !== 'play')) return null;
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

const myIdx = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const hintsOn = (g) => !!g.opts.hints || !!S.learn;

function onStateChanged() {
  S.ui.note = null;
  render();
}

// ====================== Darstellung ======================
function faceHtml(id, { tag = 'div', cls = '', attrs = '', verb = '' } = {}) {
  const name = M.cardName(id);
  const type = tag === 'button' ? ' type="button"' : '';
  const aria = `aria-label="${name}${verb}"`;
  let inner;
  let kind;
  if (M.isWizard(id)) { kind = 'wiz'; inner = '<span class="rk">Z</span><span class="mid" aria-hidden="true">🧙</span><span class="nm">Zauberer</span>'; }
  else if (M.isFool(id)) { kind = 'fool'; inner = '<span class="rk">N</span><span class="mid" aria-hidden="true">🤡</span><span class="nm">Narr</span>'; }
  else {
    const su = M.SUITS[M.suitOf(id)];
    kind = 's' + M.suitOf(id);
    inner = `<span class="rk">${M.rankOf(id)}</span><span class="ss" aria-hidden="true">${su.sym}</span><span class="mid" aria-hidden="true">${su.sym}</span>`;
  }
  return `<div class="st-cell"><${tag}${type} class="st-card face ${kind}${cls ? ' ' + cls : ''}" data-c="${id}" title="${name}" ${aria} ${attrs}>${inner}</${tag}></div>`;
}
const emptyHtml = () => '<div class="st-cell"><span class="st-card empty" aria-hidden="true"></span></div>';

const stichZahl = (n) => (n === 1 ? '1 Stich' : `${n} Stiche`);
const nameOf = (g, i) => (i === myIdx() ? 'Du' : g.players[i].name);
const slotName = (g, i) => { const n = nameOf(g, i); const m = /^Computer (\d)$/.exec(n); return m ? 'PC ' + m[1] : n; };

function bannerHtml(g) {
  const mi = myIdx();
  if (g.phase === 'round_over') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  const ap = g.players[g.turn];
  if (g.phase === 'trump') return g.turn === mi ? `<div class="banner mine">Du wählst die Trumpffarbe</div>` : `<div class="banner">${esc(ap.name)} wählt die Trumpffarbe</div>`;
  if (g.phase === 'bid') return g.turn === mi ? `<div class="banner mine">Du sagst an: Wie viele Stiche machst du?</div>` : `<div class="banner">${esc(ap.name)} sagt an</div>`;
  return g.turn === mi ? `<div class="banner mine">Du bist dran: spiele eine Karte</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function infoHtml(g) {
  const up = g.upcard !== null ? `<div class="st-up">${faceHtml(g.upcard)}</div>` : '';
  let main; let sub;
  if (g.phase === 'trump') { main = 'Trumpf: offen'; sub = 'Der Geber wählt die Farbe'; }
  else if (Number.isInteger(g.trump)) { const su = M.SUITS[g.trump]; main = `<span class="sy s${g.trump}" aria-hidden="true">${su.sym}</span> ${su.name}`; sub = 'ist Trumpf'; }
  else { main = 'Kein Trumpf'; sub = g.upcard === null ? 'Letzte Runde: nichts aufgedeckt' : 'Ein Narr wurde aufgedeckt'; }
  const aria = Number.isInteger(g.trump) ? `Trumpf: ${M.SUITS[g.trump].name}` : g.phase === 'trump' ? 'Trumpf wird noch gewählt' : 'Kein Trumpf in dieser Runde';
  return `<div class="st-info"><div class="st-round"><b>Runde ${g.round} von ${g.totalRounds}</b><span>${g.round === 1 ? '1 Karte' : g.round + ' Karten'} je Person</span></div>
    <div class="st-trump" aria-label="${aria}">${up}<div class="txt"><span class="main">${main}</span><span class="sub">${sub}</span></div></div></div>`;
}

function bidsHtml(g) {
  const n = g.players.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const chips = g.players.map((p, i) => {
    const act = (g.phase === 'bid' || g.phase === 'play' || g.phase === 'trump') && g.turn === i;
    let val;
    let aria;
    if (g.phase === 'play') { val = `${p.tricks} von ${p.bid}`; aria = `${stichZahl(p.tricks)} gemacht, ${p.bid} angesagt`; }
    else if (p.bid === null) { val = '?'; aria = 'noch keine Ansage'; }
    else { val = `${p.bid}`; aria = `${p.bid} angesagt`; }
    return `<div class="st-chip${act ? ' act' : ''}" aria-label="${esc(nameOf(g, i))}: ${aria}"><span class="nm">${esc(nameOf(g, i))}</span><span class="val">${val}</span><span class="tag">${g.dealer === i ? 'Geber' : ''}</span></div>`;
  }).join('');
  return `<div class="st-bids" style="--cols:${cols}">${chips}</div><div class="st-cap">${g.phase === 'play' ? 'Stiche gemacht von angesagt' : 'Ansagen'}</div>`;
}

function centerHtml(g, mi) {
  const n = g.players.length;
  const cur = g.trick.cards;
  const src = cur.length ? cur : (g.last && g.phase === 'play' ? g.last.cards : []);
  const past = !cur.length && src.length > 0;
  const slots = [];
  for (let k = 0; k < n; k++) {
    const i = (mi + k) % n;
    const p = g.players[i];
    const x = src.find((t) => t.pid === p.id);
    const win = past && g.last && g.last.winner === p.id;
    const act = !past && g.phase === 'play' && g.turn === i;
    slots.push(`<div class="st-slot${win ? ' win' : ''}${act ? ' act' : ''}"><span class="lb" title="${esc(nameOf(g, i))}">${esc(slotName(g, i))}</span>${x ? faceHtml(x.card) : emptyHtml()}</div>`);
  }
  return `<div class="st-center${past ? ' past' : ''}" style="--n:${n}" role="group" aria-label="Tischmitte">${slots.join('')}</div>`;
}

function handHtml(g, mi) {
  const me = g.players[mi];
  const myTurn = g.phase === 'play' && g.turn === mi;
  const legal = myTurn ? M.legalCards(g, cid) : [];
  const hints = hintsOn(g);
  const cls = me.hand.length > 12 ? ' lots' : me.hand.length > 5 ? ' many' : '';
  const cards = me.hand.map((c) => {
    if (!myTurn) return faceHtml(c);
    const ok = legal.includes(c);
    return faceHtml(c, { tag: 'button', cls: hints ? (ok ? 'can' : 'dim') : '', attrs: `data-act="card" data-card="${c}"`, verb: ', ausspielen' });
  }).join('');
  return `<section class="card st-handbox"><h2>Deine Karten</h2><div class="st-hand${cls}" role="group" aria-label="Deine Karten">${cards || '<p class="muted">Du hast keine Karten mehr.</p>'}</div></section>`;
}

function boardHtml(g) {
  const mi = myIdx();
  return `<section class="card st-board" id="board">${infoHtml(g)}${bidsHtml(g)}${centerHtml(g, mi)}</section>`;
}

function lineHtml(g, mi) {
  if (S.ui.note) return `<p class="big st-line warn" role="alert">${esc(S.ui.note)}</p>`;
  const ap = g.players[g.turn];
  if (g.phase === 'trump') {
    return g.turn === mi
      ? `<p class="big st-line">Ein Zauberer wurde aufgedeckt. Du hast gegeben und wählst die Trumpffarbe. Tippe unten auf eine Farbe.</p>`
      : `<p class="big st-line"><b>${esc(ap.name)}</b> wählt gerade die Trumpffarbe. Bitte einen Moment Geduld.</p>`;
  }
  if (g.phase === 'bid') {
    if (g.turn !== mi) return `<p class="big st-line"><b>${esc(ap.name)}</b> sagt gerade an. Bitte einen Moment Geduld.</p>`;
    const f = M.forbiddenBid(g, cid);
    const extra = f !== null ? ` Die ${f} geht nicht: Alle Ansagen zusammen dürfen nicht genau ${g.round} ergeben.` : '';
    return `<p class="big st-line">Wie viele Stiche machst du in dieser Runde? Tippe auf eine Zahl.${extra}</p>`;
  }
  if (g.turn !== mi) return `<p class="big st-line"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  const legal = M.legalCards(g, cid);
  const hand = g.players[mi].hand;
  const led = g.trick.cards.map((t) => t.card);
  if (!led.length) return `<p class="big st-line">Du spielst aus. Tippe auf eine deiner Karten.</p>`;
  const ls = M.ledSuitOf(led);
  const hint = hintsOn(g) && legal.length < hand.length ? ' Grün umrandet sind die erlaubten Karten.' : '';
  if (ls < 0) return `<p class="big st-line">Es gibt keinen Farbzwang: Du darfst jede Karte spielen.</p>`;
  return `<p class="big st-line">Ausgespielt wurde <b>${M.SUITS[ls].sym} ${M.SUITS[ls].name}</b>. Gib diese Farbe zu, wenn du sie hast. Zauberer und Narren gehen immer.${hint}</p>`;
}

function actionHtml(g, mi) {
  let extra = '';
  if (g.phase === 'trump' && g.turn === mi) {
    extra = `<div class="st-suits">${M.SUITS.map((su, i) => `<button type="button" class="btn s${i}" data-act="trump" data-suit="${i}" aria-label="${su.name} ist Trumpf"><span aria-hidden="true">${su.sym}</span><small>${su.name}</small></button>`).join('')}</div>`;
  } else if (g.phase === 'bid' && g.turn === mi) {
    const f = M.forbiddenBid(g, cid);
    const btns = [];
    for (let k = 0; k <= g.round; k++) btns.push(`<button type="button" class="btn" data-act="bid" data-n="${k}" ${f === k ? 'disabled' : ''} aria-label="${stichZahl(k)} ansagen">${k}</button>`);
    extra = `<div class="st-bidgrid" role="group" aria-label="Ansage wählen">${btns.join('')}</div>`;
  }
  return `<section class="card action st-act" aria-live="polite">${lineHtml(g, mi)}${extra}</section>`;
}

function rankHtml(g) {
  const rk = M.ranking(g);
  return `<ol class="st-rank">${rk.map((r) => `<li><span>${r.rank}. ${esc(r.id === cid ? 'Du' : r.name)}</span><b>${r.score} Punkte</b></li>`).join('')}</ol>`;
}

const fmt = (d) => (d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : '0');

function tableHtml(g) {
  let tbl = '';
  if (S.ui.tableOpen) {
    const head = g.players.map((p) => `<th>${esc(p.id === cid ? 'Du' : p.name)}</th>`).join('');
    const rows = g.sheet.map((s) => `<tr><td>Runde ${s.round}</td>${g.players.map((p) => { const r = s.rows.find((x) => x.id === p.id); return r ? `<td class="${r.delta < 0 ? 'neg' : 'pos'}" title="angesagt ${r.bid}, gemacht ${r.tricks}">${fmt(r.delta)}</td>` : '<td></td>'; }).join('')}</tr>`).join('');
    const sum = `<tr class="sum"><td>Summe</td>${g.players.map((p) => `<td>${p.score}</td>`).join('')}</tr>`;
    tbl = `<div class="st-scroll"><table><thead><tr><th>Runde</th>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${g.players.length + 1}">Noch keine Runde gewertet.</td></tr>`}${sum}</tbody></table></div>`;
  }
  return `<section class="card st-table"><h2>Gesamtpunkte</h2>${rankHtml(g)}
    <button class="btn secondary" data-act="table-toggle" aria-expanded="${S.ui.tableOpen ? 'true' : 'false'}">${S.ui.tableOpen ? 'Tabelle verbergen' : 'Tabelle aller Runden zeigen'}</button>${tbl}</section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'round_over' || g.phase === 'over') return overHtml(g);
  const mi = myIdx();
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    ${boardHtml(g)}
    ${handHtml(g, mi)}
    ${actionHtml(g, mi)}
    ${tableHtml(g)}${recapHtml(g)}`;
}

function overHtml(g) {
  const mi = myIdx();
  const me = g.players[mi];
  const r = g.result;
  const isHost = sess.S.role === 'host';
  const final = g.phase === 'over';
  const myRow = r.rows.find((x) => x.id === me.id);
  let title; let icon;
  if (final) {
    const w = r.winners || [];
    const names = w.map((id) => (id === me.id ? 'Du' : g.players.find((p) => p.id === id).name));
    const iWon = w.includes(me.id);
    if (w.length === 1) title = iWon ? 'Du hast das Spiel gewonnen!' : `${esc(names[0])} hat das Spiel gewonnen!`;
    else title = iWon ? `Gleichstand: ${names.map(esc).join(' und ')} gewinnen!` : `Gleichstand: ${names.map(esc).join(' und ')} gewinnen!`;
    icon = iWon ? '🏆' : '🃏';
  } else {
    title = myRow.ok ? 'Richtig angesagt!' : 'Leider daneben';
    icon = myRow.ok ? '🎯' : '🃏';
  }
  const rows = r.rows.map((x) => `<tr><td class="nm">${esc(x.id === me.id ? 'Du' : x.name)}</td><td>${x.bid}</td><td>${x.tricks}</td><td class="${x.delta < 0 ? 'neg' : 'pos'}">${fmt(x.delta)}</td><td><b>${g.players.find((p) => p.id === x.id).score}</b></td></tr>`).join('');
  const mine = myRow.ok
    ? `Du hast ${stichZahl(myRow.tricks)} angesagt und gemacht: <b>${fmt(myRow.delta)} Punkte</b>.`
    : `Du hast ${stichZahl(myRow.bid)} angesagt, aber ${stichZahl(myRow.tricks)} gemacht: <b>${fmt(myRow.delta)} Punkte</b>.`;
  let btns;
  if (final) {
    btns = isHost
      ? `<button class="btn primary huge" data-act="again">▶ Neues Spiel (Punkte löschen)</button>`
      : `<p class="muted center">Der Gastgeber startet ein neues Spiel. Du bleibst einfach auf dieser Seite.</p>`;
  } else {
    btns = isHost
      ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>`
      : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  }
  const head = final ? `<div class="trophy">${icon}</div>` : `<div class="medal">${icon}</div>`;
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card over st-over">${head}
      <h1>${title}</h1>
      <p class="rows action"><span class="big">${mine}</span></p>
      <div class="st-scroll st-res"><table><thead><tr><th>Name</th><th>Ansage</th><th>Stiche</th><th>Punkte</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="st-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    ${tableHtml(g)}${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Stichprophet</b> ist ein Kartenspiel für 3 bis 6 Personen. Du sagst voraus, wie viele <b>Stiche</b> du machst. Wer richtig vorhersagt, bekommt Punkte. Wer sich verschätzt, verliert Punkte.</p>
    <h3>Die Karten</h3>
    <p>Es gibt 60 Karten: vier Farben (Rot ♥, Gelb ♦, Grün ♣, Blau ♠) mit den Zahlen 1 bis 13, dazu vier <b>Zauberer</b> 🧙 und vier <b>Narren</b> 🤡. Der Zauberer ist die höchste Karte, der Narr die niedrigste.</p>
    <h3>Die Runden</h3>
    <ul>
      <li>In Runde 1 bekommt jede Person 1 Karte, in Runde 2 zwei Karten, in Runde 3 drei Karten und so weiter.</li>
      <li>Es gibt so viele Runden, wie die 60 Karten reichen: bei 3 Personen 20 Runden, bei 4 Personen 15, bei 5 Personen 12 und bei 6 Personen 10. Beim kurzen Spiel nur die Hälfte.</li>
      <li>Nach dem Austeilen wird eine Karte vom Rest aufgedeckt. Ihre <b>Farbe ist Trumpf</b>. Ist es ein <b>Narr</b>, gibt es in dieser Runde keinen Trumpf. Ist es ein <b>Zauberer</b>, wählt der Geber die Trumpffarbe. In der letzten Runde bleibt keine Karte übrig, also gibt es keinen Trumpf.</li>
    </ul>
    <h3>Ansagen</h3>
    <p>Links vom Geber beginnend sagt jede Person an, wie viele Stiche sie in dieser Runde macht (von 0 bis zur Kartenzahl). Auf Wunsch gilt: Der Letzte darf nicht so ansagen, dass alle Ansagen zusammen genau die Kartenzahl ergeben.</p>
    <h3>Spielen</h3>
    <ul>
      <li>Die Person links vom Geber spielt zuerst eine Karte aus. Danach legt jede Person reihum eine Karte dazu. Alle Karten zusammen sind ein <b>Stich</b>.</li>
      <li><b>Farbzwang:</b> Hast du die ausgespielte Farbe, musst du sie zugeben. Zauberer und Narren darfst du immer spielen, auch bei Farbzwang. Hast du die Farbe nicht, darfst du jede Karte spielen.</li>
      <li>Spielt die erste Person einen Narren, zählt die nächste Farbkarte als ausgespielte Farbe. Bei einem Zauberer als Anspiel gibt es keinen Farbzwang.</li>
      <li><b>Wer gewinnt den Stich?</b> Der erste Zauberer. Gibt es keinen, der höchste Trumpf. Gibt es auch keinen Trumpf, die höchste Karte der ausgespielten Farbe. Liegen nur Narren, gewinnt der erste Narr.</li>
      <li>Wer den Stich gewinnt, spielt als Nächster aus.</li>
    </ul>
    <h3>Punkte</h3>
    <ul>
      <li><b>Richtig angesagt:</b> 20 Punkte plus 10 Punkte für jeden gemachten Stich.</li>
      <li><b>Falsch angesagt:</b> 10 Minuspunkte für jeden Stich, den du zu viel oder zu wenig gemacht hast.</li>
    </ul>
    <p>Nach der letzten Runde gewinnt, wer die meisten Punkte hat. Bei Gleichstand gewinnen alle Beteiligten gemeinsam.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und zählt alles selbst. Tippst du auf eine Karte, die nicht erlaubt ist, bekommst du einen freundlichen Hinweis.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  minPlayers: M.MIN_PLAYERS,
  bots: [2, 3, 4, 5], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 2, coach },
  title: 'Stichprophet', icon: '🔮', sub: 'Sage voraus, wie viele Stiche du machst – für 3 bis 6 Personen',
  helpTitle: 'Die Spielregeln von Stichprophet', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'trump': return sess.send({ t: 'trump', suit: Number(el.dataset.suit) });
      case 'bid': return sess.send({ t: 'bid', n: Number(el.dataset.n) });
      case 'card': {
        if (!g) return undefined;
        const card = Number(el.dataset.card);
        const legal = M.legalCards(g, cid);
        if (!legal.includes(card)) {
          const ls = M.ledSuitOf(g.trick.cards.map((t) => t.card));
          S.ui.note = `Du musst Farbe bekennen: Bitte spiele eine Karte in ${ls >= 0 ? M.SUITS[ls].sym + ' ' + M.SUITS[ls].name : 'der ausgespielten Farbe'}. Zauberer und Narren gehen immer.`;
          return render();
        }
        return sess.send({ t: 'play', card });
      }
      case 'table-toggle': S.ui.tableOpen = !S.ui.tableOpen; return render();
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
