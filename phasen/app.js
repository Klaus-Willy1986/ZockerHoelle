import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'p10',
  maxPlayers: 5,
  newGame: (players) => { S.ui.lastRollId = 0; S.ui.sig = ''; return P.createGame(players); },
  onMessage: (state, pid, msg) => {
    if (msg.t === 'roll') P.roll(state, pid, msg.keep);
    else if (msg.t === 'finish') P.finish(state, pid, msg.note !== false);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, keep: Array(10).fill(false), rolling: false, lastRollId: 0, sig: '', confirmSkip: false }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.mode === 'over') return null;
      const ap = P.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { keep: Array(10).fill(false), rolling: false, lastRollId: 0, sig: '', confirmSkip: false };

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.mode !== 'over' && g.turn) {
    const t = g.turn;
    const ap = P.activePlayer(g);
    const sig = `${g.rollId}|${g.active}|${t.stage}|${ap.phaseNo}`;
    if (sig !== S.ui.sig) {
      S.ui.sig = sig;
      S.ui.confirmSkip = false;
      S.ui.keep = Array(10).fill(false);
    }
    if (g.rollId !== S.ui.lastRollId) {
      const resumed = S.ui.lastRollId === 0 && g.rollId > 1;
      S.ui.lastRollId = g.rollId;
      if (!resumed && t.stage === 'choose') { animateDice(); return; }
    }
  }
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
    if (el && S.game?.turn) el.innerHTML = diceHtml(S.game, { spin: true });
    if (n >= 9) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}

// ====================== Darstellung ======================
function dieHtml(die, i, o) {
  const t = S.game.turn;
  let d = die;
  if (o.spin && !t.kept[i]) d = P.rollDie(i);
  const isW = d.v === 'W';
  const cls = ['pd', 'col-' + d.c, isW ? 'wild' : '', o.keep?.[i] ? 'keep' : '', o.used?.has(i) ? 'use' : '', !o.interactive && t.kept?.[i] && t.attempt > 1 ? 'aside' : ''].filter(Boolean).join(' ');
  const label = `${P.COLOR_NAMES[d.c]} ${isW ? 'Joker' : d.v}`;
  const inner = `<span class="pv">${isW ? 'W' : d.v}</span><span class="pc">${isW ? 'Joker · ' : ''}${P.COLOR_NAMES[d.c]}</span>${o.keep?.[i] ? '<span class="tag">behalten</span>' : ''}${o.used?.has(i) && !o.keep?.[i] ? '<span class="tag use">zählt</span>' : ''}`;
  return o.interactive
    ? `<button class="${cls}" data-act="toggle" data-i="${i}" aria-pressed="${o.keep[i] ? 'true' : 'false'}" aria-label="${label}, ${o.keep[i] ? 'wird behalten' : 'wird neu gewürfelt'}">${inner}</button>`
    : `<div class="${cls}" role="img" aria-label="${label}">${inner}</div>`;
}

function diceHtml(g, o = {}) {
  const t = g.turn;
  if (!t || !t.dice) return '';
  const ev = t.eval;
  const used = ev && ev.ok ? new Set(ev.used.map((u) => u.i)) : null;
  return `<div class="p10dice">${t.dice.map((d, i) => dieHtml(d, i, { ...o, used, keep: o.interactive ? S.ui.keep : null })).join('')}</div>`;
}

function phaseBox(p) {
  const ph = P.PHASES[Math.min(p.phaseNo, 10) - 1];
  const strip = P.PHASES.map((x) => `<span class="pstep${x.no < p.phaseNo ? ' done' : ''}${x.no === p.phaseNo ? ' now' : ''}">${x.no}</span>`).join('');
  return `<div class="phasebox"><div class="pstrip" aria-label="Phase ${Math.min(p.phaseNo, 10)} von 10">${strip}</div>
    <h2>Phase ${ph.no}: ${esc(ph.name)}</h2><p>${esc(ph.text)}</p>
    <p class="muted small">Joker (W) ersetzen jede Zahl und zählen 0 Punkte.</p></div>`;
}

function blockHtml(p) {
  const rows = P.PHASES.map((ph) => {
    const s = p.scores[ph.no - 1];
    return `<tr class="${s != null ? 'done' : ph.no === p.phaseNo ? 'now' : ''}"><td>${ph.no}</td><td>${esc(ph.name)}</td><td class="num">${s != null ? s : ''}</td></tr>`;
  }).join('');
  const b5 = p.bonus5 == null ? '' : `<tr><td></td><td>5‑Phasen‑Bonus</td><td class="num">${p.bonus5}</td></tr>`;
  const b10 = p.bonus10 ? `<tr><td></td><td>10‑Phasen‑Bonus</td><td class="num">${p.bonus10}</td></tr>` : '';
  const pen = p.penalty ? `<tr><td></td><td>Fehlversuche</td><td class="num">−${p.penalty}</td></tr>` : '';
  return `<table class="block"><tbody>${rows}${b5}${b10}${pen}<tr class="sumrow"><td></td><td>Summe</td><td class="num">${P.totalOf(p)}</td></tr></tbody></table>`;
}

function actionHtml() {
  const g = S.game;
  const t = g.turn;
  const ap = P.activePlayer(g);
  const isMe = ap.id === cid;
  if (S.ui.rolling) return `<p class="big center">🎲 Die Würfel rollen …</p>`;
  const finalNote = t.final ? `<p class="warn">Letzte Runde: Du versuchst jetzt Phase ${ap.phaseNo}${ap.phaseNo < 10 ? ' und danach alle weiteren Phasen direkt hintereinander' : ''}. Klappt eine Phase nicht, ist dein Spiel zu Ende.</p>` : '';
  if (!isMe) {
    if (t.stage === 'roll') return `<p class="big center">Gleich würfelt <b>${esc(ap.name)}</b> (Phase ${ap.phaseNo}). Bitte einen Moment Geduld.</p>`;
    const ok = t.eval?.ok ? ' – die Phase ist geschafft!' : '';
    return `<p class="big center"><b>${esc(ap.name)}</b> versucht Phase ${ap.phaseNo}. Versuch ${t.attempt} von ${P.MAX_ATTEMPTS}${ok}</p>`;
  }
  if (t.stage === 'roll') {
    return `${finalNote}<button class="btn primary huge" data-act="roll">🎲 Würfeln (Versuch 1 von 3)</button>`;
  }
  const ev = t.eval;
  const rest = S.ui.keep.filter((k) => !k).length;
  const canRoll = t.attempt < P.MAX_ATTEMPTS;
  let html = finalNote;
  if (ev.ok) {
    html += `<div class="confirm"><p class="big">✔ <b>Geschafft!</b> Phase ${ap.phaseNo} ist erfüllt.<br>Das bringt dir <b>${ev.score} Punkte</b>.</p>
      <button class="btn primary huge" data-act="finish-yes">✔ Punkte eintragen (${ev.score})</button></div>`;
    if (canRoll) html += `<p class="muted">Du kannst noch weiterwürfeln, um mehr Punkte zu bekommen – aber Vorsicht, dabei kann es auch schlechter werden. Behalte alle Würfel, die zählen.</p>`;
  } else if (!canRoll) {
    html += `<div class="confirm bad"><p class="big">Leider nicht geschafft.</p><p>${t.final ? 'Damit ist dein Spiel zu Ende. Deine bisherigen Punkte bleiben.' : `Im nächsten Zug versuchst du Phase ${ap.phaseNo} noch einmal.`}</p>
      <button class="btn secondary huge" data-act="finish-yes">OK, weiter</button></div>`;
  } else {
    html += `<p class="big">Versuch ${t.attempt} von ${P.MAX_ATTEMPTS}. Tippe auf die Würfel, die du <b>behalten</b> willst. Alle anderen werden neu gewürfelt.</p>`;
  }
  if (canRoll) {
    html += `<button class="btn ${ev.ok ? 'secondary' : 'primary'} huge" data-act="reroll" ${rest === 0 ? 'disabled' : ''}>🎲 ${rest} Würfel neu würfeln (Versuch ${t.attempt + 1} von 3)</button>`;
  }
  if (ev.ok && !t.final) {
    html += S.ui.confirmSkip
      ? `<div class="confirm"><p>Die Punkte nicht eintragen? Du musst Phase ${ap.phaseNo} dann im nächsten Zug noch einmal würfeln. Das lohnt sich nur selten (zum Beispiel für den 5‑Phasen‑Bonus).</p>
         <button class="btn secondary" data-act="finish-skip-yes">Ja, nicht eintragen</button><button class="btn ghost" data-act="finish-skip-no">Zurück</button></div>`
      : `<button class="btn ghost" data-act="finish-skip">Punkte nicht eintragen …</button>`;
  }
  return html;
}

function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = P.activePlayer(g);
  const fin = g.mode === 'final' ? `<div class="banner final">Letzte Runde: Alle anderen versuchen jetzt ihre restlichen Phasen.</div>` : '';
  const main = ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
  return fin + main;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length || S.ui.rolling) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function scoreboardHtml() {
  const g = S.game;
  return `<section class="card"><h2>Punktestand</h2>${g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const st = p.phaseNo > 10 ? 'alle Phasen geschafft' : p.stopped ? `ausgeschieden bei Phase ${p.phaseNo}` : `Phase ${p.phaseNo}`;
    return `<details class="other"${p.id === cid ? ' open' : ''}><summary><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b>${off} – ${st}, ${P.totalOf(p)} Punkte${i === g.active && g.mode !== 'over' ? ' 🎲' : ''}</summary>${blockHtml(p)}</details>`;
  }).join('')}</section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml();
  const ap = P.activePlayer(g);
  const t = g.turn;
  const me = g.players[myIndex()];
  const showPhase = ap.id === cid || !me ? ap : me;
  const interactive = ap.id === cid && t.stage === 'choose' && t.attempt < P.MAX_ATTEMPTS && !S.ui.rolling;
  const dice = t.dice
    ? `<section class="card"><div id="dice">${diceHtml(g, { interactive })}</div></section>` : '';
  return `${headerHtml()}${lostHtml()}${bannerHtml()}
    <section class="card">${phaseBox(ap)}</section>
    ${dice}
    <section class="card action">${actionHtml()}</section>
    ${recapHtml()}${scoreboardHtml()}`;
}

let soloKey = '', soloInfo = null;
function soloResult(g) {
  const p = g.players[0];
  const total = P.totalOf(p);
  const key = `${S.room}|${g.rollId}|${total}`;
  if (soloKey !== key) {
    soloKey = key;
    const prev = sess.get('p10_best', 0);
    soloInfo = { total, prev, record: total > prev };
    if (total > prev) sess.set('p10_best', total);
  }
  return soloInfo;
}

function overHtml() {
  const g = S.game;
  if (g.players.length === 1) {
    const p = g.players[0];
    const r = soloResult(g);
    return `${headerHtml()}${lostHtml()}
      <section class="card over"><div class="trophy">${r.record ? '🏆' : '👏'}</div><h1>${r.total} Punkte!</h1>
      <p class="center big">${r.record ? 'Neue Bestleistung! 🎉' : `Deine Bestleistung: <b>${r.prev}</b> Punkte`}</p>
      <p class="center muted">Alle 10 Phasen geschafft${p.penalty ? `, ${p.penalty / P.SOLO_PENALTY} Fehlversuche (−${p.penalty})` : ' – ohne einen Fehlversuch'}.</p>
      <button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
      ${recapHtml()}
      <section class="card"><h2>Dein Block</h2>${blockHtml(p)}</section>`;
  }
  const rank = P.ranking(g);
  const win = rank[0];
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r, i) => `<li class="${i === 0 ? 'win' : ''}"><span class="medal">${i === 0 ? '🏆' : medals[i] || ''}</span>
    <span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.total} Punkte</span>
    <div class="rd"><span class="chip">${r.finished ? 'alle 10 Phasen geschafft' : `${r.phaseNo - 1} von 10 Phasen`}</span>${r.bonus5 ? '<span class="chip">5‑Phasen‑Bonus +40</span>' : ''}${r.bonus10 ? '<span class="chip">10‑Phasen‑Bonus +40</span>' : ''}</div></li>`).join('');
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">🏆</div><h1>${esc(win.name)} hat gewonnen!</h1><p class="center muted">${esc(g.endReason || '')}</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml()}
    <section class="card"><h2>Alle Spielblöcke</h2>${g.players.map((p) => `<details class="other"><summary><b>${esc(p.name)}</b> – ${P.totalOf(p)} Punkte</summary>${blockHtml(p)}</details>`).join('')}</section>`;
}

function helpBody() {
  const phases = P.PHASES.map((p) => `<li><b>Phase ${p.no}:</b> ${esc(p.name)}</li>`).join('');
  return `
    <p><b>Ziel:</b> Alle 10 Phasen nacheinander schaffen und dabei möglichst viele Punkte sammeln.</p>
    <h3>Die Würfel</h3>
    <p>Es gibt 10 Würfel in vier Farben (Blau, Rot, Orange, Grün). Sechs Würfel zeigen 5 bis 10, vier Würfel zeigen 1 bis 4 und zweimal <b>W = Joker</b>. Ein Joker ersetzt jede Zahl, zählt aber immer 0 Punkte.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Du würfelst alle 10 Würfel (1. Versuch). Dann wählst du aus, welche Würfel du <b>behalten</b> willst.</li>
      <li>Alle anderen Würfel werden neu gewürfelt (2. Versuch). Wieder darfst du auswählen, was du behältst.</li>
      <li>Im 3. und letzten Versuch darfst du auch Würfel neu würfeln, die du zur Seite gelegt hattest.</li>
      <li>Hast du die Phase geschafft, werden die Punkte eingetragen und du bist beim nächsten Mal bei der nächsten Phase. Wenn nicht, versuchst du dieselbe Phase im nächsten Zug erneut.</li>
    </ol>
    <h3>Folgen, gleiche Zahlen, Farbe</h3>
    <p><b>Gleiche Zahlen</b> (Drilling, Vierling …): Die Farben sind egal. Verlangt eine Phase zwei solche Kombinationen, darf es auch zweimal dieselbe Zahl sein.<br>
    <b>Folgen:</b> Direkt aufeinanderfolgende Zahlen, die Farben sind egal (z. B. 4‑5‑6‑7).<br>
    <b>Eine Farbe:</b> Phase 8 verlangt 7 Würfel derselben Farbe. Ein Joker zählt hier nur in seiner eigenen Farbe.</p>
    <h3>Die 10 Phasen</h3><ul>${phases}</ul>
    <h3>Punkte</h3>
    <p>Es zählen nur die Würfel, die für die Phase nötig sind. Joker zählen 0. Für den <b>5‑Phasen‑Bonus</b> (+40) musst du nach Phase 5 mehr als 220 Punkte haben. Wer als Erste/r alle 10 Phasen schafft, bekommt den <b>10‑Phasen‑Bonus</b> (+40).</p>
    <h3>Allein spielen</h3>
    <p>Du kannst auch allein spielen: Es gelten alle Regeln, aber für jeden Fehlversuch werden 5 Punkte abgezogen. Den 10‑Phasen‑Bonus bekommst du nur, wenn dir Phase 10 gleich beim ersten Mal gelingt. Versuche, deine eigene Bestleistung zu schlagen.</p>
    <h3>Spielende</h3>
    <p>Hat jemand alle 10 Phasen geschafft, darf jede andere Person noch einmal versuchen, alle ihre fehlenden Phasen direkt hintereinander zu würfeln. Klappt eine Phase nicht, ist das Spiel für diese Person zu Ende. Es gewinnt, wer alle 10 Phasen geschafft hat und die meisten Punkte hat.</p>
    <p class="muted">Keine Sorge: Das Programm erkennt selbst, ob eine Phase geschafft ist, und zählt die Punkte. Welche Würfel du behältst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du versuchst die 10 Phasen allein zu schaffen (je Fehlversuch 5 Punkte Abzug) und kannst deine Bestleistung verbessern.',
  sess, $app,
  title: 'Phasenwürfeln', icon: '🎯', sub: 'Zehn Phasen schaffen – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Phasenwürfeln', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'reroll': return sess.send({ t: 'roll', keep: S.ui.keep });
      case 'toggle': S.ui.keep[Number(el.dataset.i)] = !S.ui.keep[Number(el.dataset.i)]; return render();
      case 'finish-yes': return sess.send({ t: 'finish', note: true });
      case 'finish-skip': S.ui.confirmSkip = true; return render();
      case 'finish-skip-no': S.ui.confirmSkip = false; return render();
      case 'finish-skip-yes': S.ui.confirmSkip = false; return sess.send({ t: 'finish', note: false });
    }
    void g;
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
