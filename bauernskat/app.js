import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'hints', label: 'Spielbare Karten anzeigen', help: 'Zeigt dir, welche offenen Karten du gerade spielen darfst. Ohne diese Hilfe musst du selbst schauen, was erlaubt ist.', def: false },
  { id: 'showPoints', label: 'Augen anzeigen', help: 'Zeigt schon während des Spiels, wie viele Augen jede Person hat. Sonst siehst du nur die Anzahl der gewonnenen Stiche.', def: false },
  { id: 'short', label: 'Kurzspiel (nur bis 3 Punkte)', help: 'Das Spiel ist schon zu Ende, wenn jemand 3 Spielpunkte hat. Sonst sind es 5 Punkte.', def: false },
];

// Nur für Tests: ?target=1 verkürzt das Spiel
const urlTarget = () => {
  const n = Number(new URLSearchParams(location.search).get('target'));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0;
};

const freshUi = () => ({ note: null });

const sess = createSession({
  game: 'bsk',
  maxPlayers: 2,
  options: OPTIONS,
  newGame: (players, opts) => {
    S.ui = { ...S.ui, ...freshUi() };
    const o = { hints: !!opts.hints || !!S.learn, showPoints: !!opts.showPoints, target: urlTarget() || (opts.short ? 3 : M.DEFAULT_TARGET) };
    if (S.learn) o.dealer = 1; // In der Lernrunde gibt der Computer, du bist Vorhand und wählst den Trumpf
    return M.createGame(players, o, Math.random, sess.cid);
  },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || (g.phase !== 'trump' && g.phase !== 'play')) return null;
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
const LABELED = new Set([M.RJ, 5, 6, 7]); // Bube, Dame, König, Ass bekommen ein Wort
function faceHtml(id, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[M.cardSuit(id)];
  const rk = M.RANKS[M.cardRank(id)];
  const name = M.cardName(id);
  const word = LABELED.has(M.cardRank(id)) ? `<span class="nm">${rk.name}</span>` : '';
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="bsk-card face${su.red ? ' red' : ''}${cls ? ' ' + cls : ''}" data-c="${id}" title="${name}" aria-label="${name}${verb}" ${attrs}>
    <span class="tl"><span class="rk">${rk.sym}</span><span class="ss" aria-hidden="true">${su.sym}</span></span>
    <span class="mid" aria-hidden="true">${su.sym}</span>${word}</${tag}>`;
}
const backHtml = () => '<span class="bsk-card back" aria-hidden="true"></span>';
const emptyHtml = () => '<span class="bsk-card empty" aria-hidden="true"></span>';

// Eine Spalte: Rücken der verdeckten Karte (falls noch da) + offene Karte. Hier steht NIE der Wert einer verdeckten Karte.
function colHtml(c, k, { mine, active, legal, hints }) {
  const back = c.down !== null ? backHtml() : '';
  let up;
  if (c.up === null) up = emptyHtml();
  else if (mine && active) {
    const ok = legal.includes(k);
    const cls = hints ? (ok ? 'can' : 'dim') : '';
    up = faceHtml(c.up, { cls, tag: 'button', attrs: `data-act="card" data-col="${k}"`, verb: ', ausspielen' });
  } else up = faceHtml(c.up);
  const label = c.up === null ? `Spalte ${k + 1}: leer` : `Spalte ${k + 1}: ${M.cardName(c.up)}${c.down !== null ? ', darunter liegt eine verdeckte Karte' : ''}`;
  return `<div class="bsk-col" data-col="${k}" role="group" aria-label="${label}">${back}${up}</div>`;
}

const stichZahl = (n) => (n === 1 ? '1 Stich' : `${n} Stiche`);

function bannerHtml(g) {
  const mi = myIdx();
  if (g.phase === 'round_over') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  const ap = g.players[g.turn];
  if (g.phase === 'trump') return g.turn === mi ? `<div class="banner mine">Du wählst den Trumpf</div>` : `<div class="banner">${esc(ap.name)} wählt den Trumpf</div>`;
  return g.turn === mi ? `<div class="banner mine">Du bist dran: spiele eine offene Karte aus</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function trumpBoxHtml(g) {
  const t = g.trump;
  if (t === null) return `<div class="bsk-trump"><span class="tl">Trumpf</span><span class="sy word">offen</span><span class="sub">noch nicht gewählt</span></div>`;
  if (t === 'grand') return `<div class="bsk-trump" aria-label="Trumpf: Grand, nur die Buben"><span class="tl">Trumpf</span><span class="sy word">Grand</span><span class="sub">nur die Buben</span></div>`;
  const su = M.SUITS[t];
  return `<div class="bsk-trump" aria-label="Trumpf: ${su.name}"><span class="tl">Trumpf</span><span class="sy${su.red ? ' red' : ''}" aria-hidden="true">${su.sym}</span><span class="tn">${su.name}</span><span class="sub">und alle Buben</span></div>`;
}

function trickSlots(g, mi) {
  // Aktueller Stich, sonst der letzte (abgeblendet), sonst leere Plätze. Links: Gegner, rechts: ich.
  const oi = 1 - mi;
  const cur = g.trick.cards;
  const src = cur.length ? cur : (g.last ? g.last.cards : []);
  const past = !cur.length && !!g.last;
  const by = (pid) => src.find((x) => x.pid === pid);
  const slot = (pi) => {
    const p = g.players[pi];
    const x = by(p.id);
    const nm = pi === mi ? 'Du' : p.name;
    return `<div class="bsk-slot"><span class="lb">${esc(nm)}</span>${x ? faceHtml(x.card) : emptyHtml()}</div>`;
  };
  return { html: `${slot(oi)}${slot(mi)}`, past };
}

function centerHtml(g, mi) {
  const oi = 1 - mi;
  const me = g.players[mi];
  const opp = g.players[oi];
  if (g.phase === 'trump') {
    if (g.turn === mi) {
      const btns = M.SUITS.map((su, i) => `<button type="button" class="btn${su.red ? ' red' : ''}" data-act="trump" data-suit="${i}" aria-label="${su.name} ist Trumpf"><span aria-hidden="true">${su.sym}</span><small>${su.name}</small></button>`).join('');
      return `<div class="bsk-pick"><p>Welche Farbe soll Trumpf sein?</p><div class="bsk-suits">${btns}</div>
        <button type="button" class="btn grand" data-act="trump" data-suit="grand">Grand (nur die Buben)</button></div>`;
    }
    return `<div class="bsk-wait" aria-live="polite">${esc(g.players[g.turn].name)} überlegt den Trumpf …</div>`;
  }
  const tr = trickSlots(g, mi);
  const stats = [`<div>Stiche: Du ${me.tricks} · ${esc(opp.name)} ${opp.tricks}</div>`];
  stats.push(g.opts.showPoints ? `<div>Augen: Du ${me.points} · ${esc(opp.name)} ${opp.points}</div>` : '<div></div>');
  let lastLine = '';
  if (g.trick.cards.length) lastLine = 'Der Stich liegt aus';
  else if (g.last) lastLine = `Letzter Stich: an ${g.last.winner === cid ? 'dich' : esc(g.players.find((p) => p.id === g.last.winner).name)}`;
  return `<div class="bsk-center${tr.past ? ' past' : ''}">${tr.html}${trumpBoxHtml(g)}<div class="bsk-last">${lastLine}</div><div class="bsk-stats" aria-label="Stand der Stiche">${stats.join('')}</div></div>`;
}

function lineHtml(g, mi) {
  if (S.ui.note) return `<p class="big bsk-line warn" role="alert">${esc(S.ui.note)}</p>`;
  const ap = g.players[g.turn];
  if (g.phase === 'trump') {
    return g.turn === mi
      ? `<p class="big bsk-line">Du siehst deine offenen Karten und die offenen Karten von ${esc(g.players[1 - mi].name)}. Wähle oben den Trumpf.</p>`
      : `<p class="big bsk-line"><b>${esc(ap.name)}</b> wählt gerade den Trumpf. Bitte einen Moment Geduld.</p>`;
  }
  if (g.turn !== mi) return `<p class="big bsk-line"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  const legal = M.legalCols(g, cid);
  const open = g.players[mi].cols.filter((c) => c.up !== null).length;
  const led = g.trick.cards.length ? g.trick.cards[0].card : null;
  if (led === null) return `<p class="big bsk-line">Du spielst aus. Tippe auf eine deiner <b>offenen Karten</b>.</p>`;
  const grp = M.groupOf(g, led);
  const what = grp === 4 ? 'Trumpf' : `${M.SUITS[grp].sym} ${M.SUITS[grp].name}`;
  const hint = hintsOn(g) && legal.length < open ? ' Grün umrandet sind die erlaubten Karten.' : '';
  return `<p class="big bsk-line">${esc(g.players[1 - mi].name)} hat <b>${what}</b> ausgespielt. Gib eine offene Karte dieser Art zu, wenn du eine hast.${hint}</p>`;
}

function boardHtml(g) {
  const mi = myIdx();
  const oi = 1 - mi;
  const me = g.players[mi];
  const opp = g.players[oi];
  const myTurn = g.phase === 'play' && g.turn === mi;
  const legal = myTurn ? M.legalCols(g, cid) : [];
  const hints = hintsOn(g);
  const l = S.lobby.find((x) => x.id === opp.id);
  const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
  const oppCols = opp.cols.map((c, k) => colHtml(c, k, { mine: false })).join('');
  const myCols = me.cols.map((c, k) => colHtml(c, k, { mine: true, active: myTurn, legal, hints })).join('');
  const act = g.phase !== 'round_over' && g.phase !== 'over' && g.turn === oi;
  return `<section class="card bsk-board" id="board">
    <div class="bsk-who${act ? ' act' : ''}"><span class="nm">${esc(opp.name)}${off}</span><span class="ct">${stichZahl(opp.tricks)}</span></div>
    <div class="bsk-opp" role="group" aria-label="Offene Karten von ${esc(opp.name)}">${oppCols}</div>
    ${centerHtml(g, mi)}
    <div class="bsk-who${g.turn === mi ? ' act' : ''}"><span class="nm">Du</span><span class="ct">${stichZahl(me.tricks)}</span></div>
    <div class="bsk-mine" role="group" aria-label="Deine Karten">${myCols}</div>
  </section>`;
}

function scoreHtml(g) {
  const mi = myIdx();
  const me = g.players[mi];
  const opp = g.players[1 - mi];
  return `<section class="card"><h2>Spielpunkte</h2>
    <div class="bsk-score" aria-label="Spielpunkte: Du ${me.score}, ${esc(opp.name)} ${opp.score}">
      <div><div class="who">Du</div><div class="n">${me.score}</div></div><div class="sep" aria-hidden="true">:</div>
      <div><div class="who">${esc(opp.name)}</div><div class="n">${opp.score}</div></div></div>
    <p class="muted small center">Runde ${g.round}. Wer zuerst ${g.opts.target} ${g.opts.target === 1 ? 'Spielpunkt' : 'Spielpunkte'} hat, gewinnt das Spiel.</p></section>`;
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
    <section class="card action bsk-act" aria-live="polite">${lineHtml(g, mi)}</section>
    ${scoreHtml(g)}${recapHtml(g)}`;
}

function overHtml(g) {
  const mi = myIdx();
  const me = g.players[mi];
  const opp = g.players[1 - mi];
  const r = g.result;
  const isHost = sess.S.role === 'host';
  const final = g.phase === 'over';
  const iWon = r.winner === me.id;
  let title;
  if (final) title = r.gameWinner === me.id ? 'Du hast das Spiel gewonnen!' : `${esc(opp.name)} hat das Spiel gewonnen!`;
  else if (!r.winner) title = 'Unentschieden: Beide haben 60 Augen';
  else title = iWon ? 'Du hast die Runde gewonnen!' : `${esc(opp.name)} hat die Runde gewonnen!`;
  const icon = final ? (r.gameWinner === me.id ? '🏆' : '🃏') : (iWon ? '🏅' : '🃏');
  const tags = [];
  if (r.winner) {
    if (r.schwarz) tags.push('Schwarz');
    else if (r.schneider) tags.push('Schneider');
    if (r.grand) tags.push('Grand');
  }
  const gained = r.winner ? `<p class="rows">${r.winner === me.id ? 'Du bekommst' : esc(opp.name) + ' bekommt'} <b>${r.value} ${r.value === 1 ? 'Spielpunkt' : 'Spielpunkte'}</b>${r.grand && g.opts.grandDouble ? ' (Grand zählt doppelt)' : ''}.</p>` : '<p class="rows">Niemand bekommt Punkte.</p>';
  let btns;
  if (final) {
    btns = isHost
      ? `<button class="btn primary huge" data-act="again">▶ Neues Spiel (Spielstand löschen)</button>`
      : `<p class="muted center">Der Gastgeber startet ein neues Spiel. Du bleibst einfach auf dieser Seite.</p>`;
  } else {
    btns = isHost
      ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>`
      : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  }
  const head = final ? `<div class="trophy">${icon}</div>` : `<div class="medal">${icon}</div>`;
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card over bsk-over">${head}
      <h1>${title}</h1>
      <div class="bsk-tags">${tags.map((t) => `<span>${t}</span>`).join('')}</div>
      <p class="rows">Augen: Du <b>${r.augen[me.id]}</b> · ${esc(opp.name)} <b>${r.augen[opp.id]}</b></p>
      <p class="rows">Stiche: Du <b>${r.tricks[me.id]}</b> · ${esc(opp.name)} <b>${r.tricks[opp.id]}</b></p>
      ${gained}
      <p class="rows">Spielstand: Du <b>${me.score}</b> : <b>${opp.score}</b> ${esc(opp.name)}</p>
      <div class="bsk-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    ${scoreHtml(g)}${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Bauernskat</b> heißt auch <b>Offiziersskat</b>. Es ist ein Skat-Spiel für genau zwei Personen. Ihr spielt 16 Stiche. Wer danach mehr als 60 Augen hat, gewinnt die Runde.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 32 Karten: 7, 8, 9, 10, Bube, Dame, König und Ass in Kreuz ♣, Pik ♠, Herz ♥ und Karo ♦. Alle Karten werden verteilt. Jede Person bekommt 8 <b>verdeckte</b> Karten nebeneinander. Auf jede verdeckte Karte kommt eine <b>offene</b> Karte. So entstehen 8 Spalten. Du siehst deine offenen Karten und die offenen Karten der anderen Person. Die verdeckten Karten kennt niemand, auch du nicht.</p>
    <h3>Der Trumpf</h3>
    <p>Wer nicht gegeben hat (die Vorhand), bestimmt den Trumpf: eine der vier Farben oder <b>Grand</b>. Bei Grand sind nur die vier Buben Trumpf.</p>
    <ul>
      <li>Die <b>Buben sind immer Trumpf</b> und die höchsten Karten. Die Reihenfolge: Kreuz-Bube, Pik-Bube, Herz-Bube, Karo-Bube. Ein Bube gehört nie zu seiner Farbe.</li>
      <li>Danach folgen die Karten der Trumpffarbe: Ass, 10, König, Dame, 9, 8, 7.</li>
      <li>In den anderen Farben gilt dieselbe Reihenfolge: Ass, 10, König, Dame, 9, 8, 7.</li>
    </ul>
    <h3>Die Stiche</h3>
    <ul>
      <li>Die Vorhand spielt zuerst aus. Gespielt werden dürfen <b>nur die offenen Karten</b> (die oberen in jeder Spalte).</li>
      <li><b>Bedienpflicht:</b> Wird eine Farbe ausgespielt, musst du eine offene Karte dieser Farbe zugeben, wenn du eine hast. Buben und Trumpffarbe zählen als Trumpf: Wird Trumpf ausgespielt, musst du Trumpf zugeben. Hast du nichts Passendes, darfst du jede offene Karte spielen.</li>
      <li>Den Stich gewinnt die höhere Karte derselben Farbe. Trumpf sticht jede andere Farbe. Wer den Stich gewinnt, spielt als Nächster aus.</li>
      <li>Wird eine offene Karte gespielt, wird die verdeckte Karte darunter sofort <b>umgedreht</b>. Sie kann ab dem nächsten Stich gespielt werden.</li>
    </ul>
    <h3>Augen und Punkte</h3>
    <p>Jede gewonnene Karte zählt Augen: Ass 11, Zehn 10, König 4, Dame 3, Bube 2. Siebener, Achter und Neuner zählen nichts. Alle Karten zusammen haben 120 Augen. Während des Spiels siehst du nur, wie viele Stiche jede Person hat. Auf Wunsch kannst du „Augen anzeigen“ ankreuzen.</p>
    <ul>
      <li>Wer <b>61 Augen oder mehr</b> hat, gewinnt die Runde und bekommt <b>1 Spielpunkt</b>.</li>
      <li><b>Schneider:</b> Hat die andere Person höchstens 30 Augen, gibt es <b>2 Spielpunkte</b>.</li>
      <li><b>Schwarz:</b> Hat die andere Person keinen einzigen Stich, gibt es <b>3 Spielpunkte</b>.</li>
      <li>Bei <b>Grand</b> zählt alles doppelt.</li>
      <li>Bei 60 zu 60 Augen ist die Runde unentschieden. Niemand bekommt Punkte.</li>
    </ul>
    <p>Wer zuerst <b>5 Spielpunkte</b> hat, gewinnt das Spiel (beim Kurzspiel 3). Mit „Nächste Runde“ geht es weiter. Der Geber wechselt jede Runde.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und zählt alles selbst. Tippst du auf eine Karte, die nicht erlaubt ist, bekommst du einen freundlichen Hinweis.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 1, coach },
  title: 'Bauernskat', icon: '♠️', sub: 'Das Skat-Spiel für zwei – online oder gegen den Computer',
  helpTitle: 'Die Spielregeln von Bauernskat', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'trump': {
        const s = el.dataset.suit;
        return sess.send({ t: 'trump', suit: s === 'grand' ? 'grand' : Number(s) });
      }
      case 'card': {
        if (!g) return undefined;
        const col = Number(el.dataset.col);
        const legal = M.legalCols(g, cid);
        if (!legal.includes(col)) {
          const led = g.trick.cards.length ? g.trick.cards[0].card : null;
          const grp = led === null ? -1 : M.groupOf(g, led);
          S.ui.note = grp === 4
            ? 'Du musst Farbe bekennen: Bitte spiele einen Trumpf (einen Buben oder eine Karte der Trumpffarbe).'
            : `Du musst Farbe bekennen: Bitte spiele eine offene Karte in ${grp >= 0 ? M.SUITS[grp].sym + ' ' + M.SUITS[grp].name : 'der ausgespielten Farbe'}.`;
          return render();
        }
        return sess.send({ t: 'play', col });
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
