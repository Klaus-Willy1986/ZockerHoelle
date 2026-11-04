import * as E from './engine.js';
import { chooseAction } from './ai.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'kq',
  maxPlayers: 5,
  newGame: (players) => { S.ui.lastRollId = 0; return E.createGame(players); },
  onMessage: (state, pid, msg) => {
    if (msg.t === 'roll') E.roll(state, pid);
    else if (msg.t === 'pick') E.submit(state, pid, msg.move || null);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, selected: null, confirmPass: false, rolling: false, lastRollId: 0 }; },
  bot: {
    delay: 900,
    // Der erste Computer, der noch wählen (oder würfeln) muss, ist dran; danach kommt step erneut.
    step: (g, level) => {
      if (!g || g.phase === 'over') return null;
      const ids = g.phase === 'roll' ? [g.players[g.active].id] : E.waitingFor(g);
      for (const id of ids) {
        if (!String(id).startsWith('bot')) continue;
        const msg = chooseAction(g, id, level, Math.random);
        if (msg) return { id, msg };
      }
      return null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { selected: null, confirmPass: false, rolling: false, lastRollId: 0 };

function doRoll() { sess.send({ t: 'roll' }); }
function doPick(move) {
  S.ui.selected = null;
  S.ui.confirmPass = false;
  sess.send({ t: 'pick', move: move ? { color: move.color, idx: move.idx } : null });
  render();
}

// ====================== Darstellung ======================
const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

function onStateChanged() {
  const g = S.game;
  if (g && g.rollId !== S.ui.lastRollId) {
    const first = S.ui.lastRollId === 0 && g.round > 1; // Wiedereinstieg mitten im Spiel: nicht neu würfeln lassen
    S.ui.lastRollId = g.rollId;
    S.ui.selected = null;
    S.ui.confirmPass = false;
    if (!first && g.phase !== 'roll') { animateDice(); return; }
  }
  // Auswahl verwerfen, wenn sie nicht mehr passt
  if (g && !E.waitingFor(g).includes(cid)) { S.ui.selected = null; S.ui.confirmPass = false; }
  render();
}

let rollTimer = null;
function animateDice() {
  S.ui.rolling = true;
  render();
  let n = 0;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    n++;
    const el = document.getElementById('dice');
    if (el) el.innerHTML = diceHtml(S.game, true);
    if (n >= 9) {
      clearInterval(rollTimer);
      S.ui.rolling = false;
      render();
    }
  }, 90);
}

function pips(v) {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  return Array.from({ length: 9 }, (_, i) => `<b class="${on.includes(i) ? 'on' : ''}"></b>`).join('');
}
function die(v, kind, label) {
  if (v == null) return `<span class="die gone" role="img" aria-label="${label} gesperrt"><span class="gonelock">🔒</span></span>`;
  return `<span class="die d-${kind}" role="img" aria-label="${label}: ${v}">${pips(v)}</span>`;
}
function diceHtml(g, spin) {
  if (!g || !g.dice) return '';
  const r = () => 1 + Math.floor(Math.random() * 6);
  const v = (x) => (spin && x != null ? r() : x);
  const d = g.dice;
  const dim = g.phase === 'roll' ? ' dim' : '';
  return `<div class="dicerow${dim}${spin ? ' spin' : ''}">
    <div class="dicegroup"><div class="dgl">Weiße Würfel</div><div>${die(v(d.w1), 'white', 'Weißer Würfel')}${die(v(d.w2), 'white', 'Weißer Würfel')}</div></div>
    <div class="dicegroup"><div class="dgl">Farbige Würfel</div><div>${E.COLORS.map((c) => die(v(d[c]), c, E.COLOR_NAMES[c] + 'er Würfel')).join('')}</div></div>
  </div>`;
}

function sheetHtml(player, opts = {}) {
  const options = opts.options || [];
  const sel = opts.selected;
  const rows = E.COLORS.map((c) => {
    const row = player.rows[c];
    const last = E.lastMarkedIndex(row);
    const closed = S.game.closed[c];
    const cells = row.marks.map((m, i) => {
      const num = E.numberAt(c, i);
      const isOpt = options.some((o) => o.color === c && o.idx === i);
      const isSel = sel && sel.color === c && sel.idx === i;
      const cls = ['cell', m ? 'mark' : '', !m && i < last ? 'skip' : '', isOpt ? 'opt' : '', isSel ? 'sel' : ''].join(' ');
      const inner = `<span class="n">${num}</span>${m ? '<span class="x">✕</span>' : ''}`;
      return isOpt
        ? `<button class="${cls}" data-act="cell" data-color="${c}" data-idx="${i}" aria-label="${E.COLOR_NAMES[c]} ${num} ankreuzen">${inner}</button>`
        : `<div class="${cls}" aria-label="${E.COLOR_NAMES[c]} ${num}${m ? ' angekreuzt' : ''}">${inner}</div>`;
    }).join('');
    const lockInner = row.lock ? '<span class="x">✕</span>' : '';
    const lockIcon = closed ? '🔒' : '🔓';
    return `<div class="srow c-${c}${closed ? ' closed' : ''}">
      <div class="rlabel">${E.COLOR_NAMES[c]}</div>${cells}
      <div class="cell lockc${row.lock ? ' mark' : ''}" title="${closed ? 'Reihe gesperrt' : 'Schloss'}"><span class="n">${lockIcon}</span>${lockInner}</div>
    </div>`;
  }).join('');
  return `<div class="sheet${opts.small ? ' small' : ''}">${rows}</div>`;
}

function scoreHtml(player) {
  const s = E.scoreOf(player);
  const chips = E.COLORS.map((c) => `<span class="chip c-${c}">${E.COLOR_NAMES[c]}: ${s.perColor[c].crosses} ✕ = ${s.perColor[c].points}</span>`).join('');
  const boxes = Array.from({ length: E.MAX_PENALTIES }, (_, i) => `<span class="pbox${i < player.penalties ? ' on' : ''}">${i < player.penalties ? '✕' : ''}</span>`).join('');
  return `<div class="score"><div class="chips">${chips}</div>
    <div class="pen">Fehlwürfe: ${boxes} <span class="penval">${player.penalties ? '−' + s.penalty : ''}</span></div>
    <div class="total">Punkte aktuell: <b>${s.total}</b></div></div>`;
}

function actionHtml() {
  const g = S.game;
  const me = myIndex();
  const active = g.players[g.active];
  const isMe = active.id === cid;
  if (me < 0) return `<p class="big">Du schaust nur zu.</p>`;
  if (S.ui.rolling) return `<p class="big center">🎲 Die Würfel rollen …</p>`;

  if (g.phase === 'roll') {
    return isMe
      ? `<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`
      : `<p class="big center">Gleich würfelt <b>${esc(active.name)}</b>. Bitte einen Moment Geduld.</p>`;
  }

  const waiting = E.waitingFor(g);
  const names = waiting.map((id) => esc(g.players.find((p) => p.id === id).name));
  if (!waiting.includes(cid)) {
    const msg = g.auto[cid]
      ? (g.phase === 'white' ? 'Du kannst diesmal leider nichts ankreuzen.' : 'Im zweiten Schritt kannst du leider nichts ankreuzen.')
      : 'Danke, deine Wahl ist angekommen.';
    return `<p class="big center">${msg}</p><p class="center muted">Wir warten noch auf: <b>${names.join(', ')}</b></p>`;
  }

  const moves = E.legalMoves(g, cid);
  const d = g.dice;
  const head = g.phase === 'white'
    ? `<h2 class="step">Schritt 1 – alle dürfen mitmachen</h2><p class="big">Die beiden weißen Würfel zusammen ergeben <b class="sum">${d.w1 + d.w2}</b>.</p>`
    : `<h2 class="step">Schritt 2 – nur du, ${esc(active.name)}</h2><p class="big">Ein weißer und ein farbiger Würfel zusammen.</p>`;

  const sel = S.ui.selected;
  if (S.ui.confirmPass) {
    const warn = isMe && g.phase === 'color' && g.turnCrosses[cid] === 0
      ? `<p class="warn">Achtung: Du hast in dieser Runde noch nichts angekreuzt. Das gibt einen <b>Fehlwurf (−5 Punkte)</b>.</p>` : '';
    return `${head}<div class="confirm"><p class="big">Wirklich nichts ankreuzen?</p>${warn}
      <button class="btn secondary huge" data-act="pass-yes">Ja, nichts ankreuzen</button>
      <button class="btn ghost" data-act="back">Zurück zur Auswahl</button></div>`;
  }
  if (sel) {
    return `${head}<div class="confirm"><p class="big">Du kreuzt <b class="pill c-${sel.color}">${E.COLOR_NAMES[sel.color]} ${sel.num}</b> an.</p>
      <button class="btn primary huge" data-act="confirm">✔ Ja, ankreuzen</button>
      <button class="btn ghost" data-act="back">Nein, ich will etwas anderes</button></div>`;
  }
  const btns = moves.map((m) => {
    const how = m.how.w == null ? '' : `<span class="how">weißer Würfel ${m.how.w} + ${E.COLOR_NAMES[m.color].toLowerCase()}er Würfel ${m.how.c}</span>`;
    return `<button class="btn move c-${m.color}" data-act="move" data-color="${m.color}" data-idx="${m.idx}"><span class="mv">${E.COLOR_NAMES[m.color]} – die ${m.num} ankreuzen</span>${how}</button>`;
  }).join('');
  const hint = g.phase === 'white' && isMe ? `<p class="muted">Du darfst nachher in Schritt 2 noch einmal ankreuzen.</p>` : '';
  return `${head}<p class="muted">Tippe auf eine Möglichkeit – oder wähle „Nichts ankreuzen“.</p>
    <div class="moves">${btns}</div>
    <button class="btn secondary" data-act="pass">Nichts ankreuzen</button>${hint}`;
}

function bannerHtml() {
  const g = S.game;
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const active = g.players[g.active];
  if (S.link === 'lost') return '';
  const waiting = E.waitingFor(g);
  if (g.phase === 'roll') {
    return active.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(active.name)} ist dran</div>`;
  }
  if (waiting.includes(cid)) return `<div class="banner mine">Du bist gefragt</div>`;
  return `<div class="banner">Bitte warten … (${esc(active.name)} ist am Zug)</div>`;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length || S.ui.rolling) return '';
  const title = g.phase === 'roll' || g.phase === 'over' ? 'Das ist in der letzten Runde passiert' : 'Bisher in dieser Runde';
  return `<section class="card recap"><h3>${title}</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function othersHtml() {
  const g = S.game;
  const others = g.players.filter((p) => p.id !== cid);
  if (!others.length) return '';
  return `<section class="card"><h2>Mitspieler</h2>${others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const s = E.scoreOf(p);
    return `<details class="other"><summary><b>${esc(p.name)}</b>${off} – ${s.total} Punkte, Fehlwürfe: ${p.penalties}</summary>${sheetHtml(p, { small: true })}${scoreHtml(p)}</details>`;
  }).join('')}</section>`;
}


function gameHtml() {
  const g = S.game;
  const me = g.players[myIndex()];
  const waiting = E.waitingFor(g);
  const options = me && waiting.includes(cid) && !S.ui.rolling ? E.legalMoves(g, cid) : [];
  if (g.phase === 'over') return overHtml();
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    <section class="card"><div id="dice">${diceHtml(g, false)}</div></section>
    <section class="card action">${actionHtml()}</section>
    ${recapHtml()}
    ${me ? `<section class="card"><h2>Dein Spielzettel</h2>${sheetHtml(me, { options, selected: S.ui.selected })}${scoreHtml(me)}
    <p class="muted small">Von links nach rechts ankreuzen. Zahlen, die du überspringst, kannst du nicht mehr nehmen. Rechts außen ist das Schloss 🔒 (erst nach 5 Kreuzen in der Reihe).</p></section>` : ''}
    ${othersHtml()}`;
}

function overHtml() {
  const g = S.game;
  const rank = E.ranking(g);
  const top = rank[0].total;
  const winners = rank.filter((r) => r.total === top);
  const headline = winners.length > 1
    ? `Unentschieden zwischen ${winners.map((w) => esc(w.name)).join(' und ')}!`
    : `${esc(winners[0].name)} hat gewonnen!`;
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r, i) => `<li class="${r.total === top ? 'win' : ''}"><span class="medal">${r.total === top ? '🏆' : medals[i] || ''}</span>
    <span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.total} Punkte</span>
    <div class="rd">${E.COLORS.map((c) => `<span class="chip c-${c}">${E.COLOR_NAMES[c]} ${r.perColor[c].points}</span>`).join('')}${r.penalties ? `<span class="chip">Fehlwürfe −${r.penalty}</span>` : ''}</div></li>`).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over"><div class="trophy">🏆</div><h1>${headline}</h1><p class="center muted">${esc(g.endReason || '')}</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml()}
    <section class="card"><h2>Alle Spielzettel</h2>${g.players.map((p) => `<details class="other"><summary><b>${esc(p.name)}</b></summary>${sheetHtml(p, { small: true })}</details>`).join('')}</section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Möglichst viele Zahlen auf deinem Spielzettel ankreuzen. Wer am Ende die meisten Punkte hat, gewinnt.</p>
    <h3>Der Spielzettel</h3>
    <p>Es gibt vier farbige Reihen. <b>Rot und Gelb</b> gehen von <b>2 bis 12</b>, <b>Grün und Blau</b> von <b>12 bis 2</b>. Du kreuzt immer <b>von links nach rechts</b> an. Du darfst Zahlen überspringen – aber übersprungene Zahlen sind für immer verloren.</p>
    <h3>Eine Runde</h3>
    <ol>
      <li>Wer an der Reihe ist, würfelt alle Würfel (2 weiße und 4 farbige).</li>
      <li><b>Schritt 1 – alle:</b> Die beiden weißen Würfel zusammenzählen. Jeder darf diese Summe in <i>einer beliebigen</i> Farbreihe ankreuzen – oder nichts.</li>
      <li><b>Schritt 2 – nur wer dran ist:</b> Ein weißer Würfel plus ein farbiger Würfel. Die Summe darf in der Reihe <i>dieser Farbe</i> angekreuzt werden – oder nichts.</li>
      <li>Hat der Spieler am Zug in beiden Schritten nichts angekreuzt, bekommt er einen <b>Fehlwurf</b> (−5 Punkte).</li>
    </ol>
    <h3>Reihe sperren 🔒</h3>
    <p>Die letzte Zahl jeder Reihe (12 bei Rot/Gelb, 2 bei Grün/Blau) darfst du nur ankreuzen, wenn du in dieser Reihe schon <b>mindestens 5 Kreuze</b> hast. Dann bekommst du zusätzlich das Schloss als Kreuz. Die Reihe ist danach für alle gesperrt, und der Würfel dieser Farbe wird nicht mehr gebraucht. Wer im selben Schritt ebenfalls sperrt, bekommt das Schloss auch.</p>
    <h3>Spielende</h3>
    <p>Das Spiel endet, sobald <b>zwei Reihen gesperrt</b> sind oder jemand den <b>vierten Fehlwurf</b> hat.</p>
    <h3>Punkte</h3>
    <p>Je mehr Kreuze in einer Reihe, desto mehr Punkte: 1 Kreuz = 1, 2 = 3, 3 = 6, 4 = 10, 5 = 15, 6 = 21, 7 = 28, 8 = 36, 9 = 45, 10 = 55, 11 = 66, 12 = 78. Davon werden 5 Punkte pro Fehlwurf abgezogen.</p>
    <p class="muted">Keine Sorge: Das Programm zeigt dir nur Möglichkeiten an, die erlaubt sind, und rechnet die Punkte für dich aus.</p>
`;
}

function render() { ui.render(); }

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  title: 'Kreuz & Quer', icon: '🎲', sub: 'Das Würfelspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Kreuz & Quer', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'roll': return doRoll();
      case 'move': {
        const m = E.legalMoves(g, cid).find((x) => x.color === el.dataset.color && x.idx === Number(el.dataset.idx));
        S.ui.selected = m || null; S.ui.confirmPass = false;
        return render();
      }
      case 'cell': {
        const m = E.legalMoves(g, cid).find((x) => x.color === el.dataset.color && x.idx === Number(el.dataset.idx));
        S.ui.selected = m || null; S.ui.confirmPass = false;
        render();
        document.querySelector('.action')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return undefined;
      }
      case 'confirm': return S.ui.selected && doPick(S.ui.selected);
      case 'pass': S.ui.confirmPass = true; S.ui.selected = null; return render();
      case 'pass-yes': return doPick(null);
      case 'back': S.ui.selected = null; S.ui.confirmPass = false; return render();
    }
    return undefined;
  },
});
ui.boot();
