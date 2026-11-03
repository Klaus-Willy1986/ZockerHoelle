import * as P from './engine.js';
import { createSession } from '../session.js';
import * as Net from '../net.js';

const $app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
});
const S = sess.S;
const cid = sess.cid;
S.ui = { keep: Array(10).fill(false), rolling: false, lastRollId: 0, sig: '', confirmSkip: false, helpOpen: false, big: sess.get('big', false) };
const link = sess.link;

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
      // Vorauswahl: die Würfel, die zählen bzw. helfen (Vorschlag)
      S.ui.keep = Array(10).fill(false);
      if (ap.id === cid && t.stage === 'choose' && t.dice) {
        for (const i of P.suggestKeep(t.dice, ap.phaseNo)) S.ui.keep[i] = true;
        if (S.ui.keep.every(Boolean) && t.attempt < P.MAX_ATTEMPTS) S.ui.keep[S.ui.keep.lastIndexOf(true)] = false;
      }
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
  return `<table class="block"><tbody>${rows}${b5}${b10}<tr class="sumrow"><td></td><td>Summe</td><td class="num">${P.totalOf(p)}</td></tr></tbody></table>`;
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
    html += `<p class="big">Versuch ${t.attempt} von ${P.MAX_ATTEMPTS}. Tippe auf die Würfel, die du <b>behalten</b> willst. Alle anderen werden neu gewürfelt.</p>
      <p class="muted">Ich habe dir einen Vorschlag markiert – du kannst ihn ändern.</p>`;
  }
  if (canRoll) {
    html += `<button class="btn ${ev.ok ? 'secondary' : 'primary'} huge" data-act="reroll" ${rest === 0 ? 'disabled' : ''}>🎲 ${rest} Würfel neu würfeln (Versuch ${t.attempt + 1} von 3)</button>
      <button class="btn ghost" data-act="suggest">Vorschlag neu markieren</button>`;
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

function headerHtml() {
  return `<header class="top"><div class="room">Spiel <b>${esc(S.room || '')}</b></div>
    <div class="topbtns">
      <button class="btn mini" data-act="bigger" aria-label="Schrift größer oder kleiner">A⁺ Schrift</button>
      <button class="btn mini" data-act="help">? Regeln</button>
      <button class="btn mini" data-act="leave">Verlassen</button>
    </div></header>`;
}
const lostHtml = () => (S.link === 'lost'
  ? `<div class="lostbar" role="alert">Die Verbindung ist kurz unterbrochen. Bitte nicht weggehen – wir verbinden dich automatisch wieder …</div>` : '');

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

function overHtml() {
  const g = S.game;
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

function lobbyHtml() {
  const isHost = S.role === 'host';
  const list = S.lobby.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : ''}"></span>${esc(p.name)}${p.id === cid ? ' (du)' : ''}${i === 0 ? ' – Gastgeber' : ''}</li>`).join('');
  const url = S.room ? link() : '';
  const invite = isHost ? `
    <section class="card"><h2>1. Lade deine Mitspieler ein</h2>
      <p class="big">Dein Spiel-Code lautet:</p><div class="code" aria-label="Spiel-Code ${esc(S.room)}">${esc(S.room || '')}</div>
      <p class="muted">Am einfachsten: Schicke den Einladungs-Link. Wer darauf tippt, ist sofort im Spiel.</p>
      <a class="btn primary huge" href="https://wa.me/?text=${encodeURIComponent('Komm zu Phasenwürfeln! Tippe hier, um mitzuspielen: ' + url)}" target="_blank" rel="noopener">Per WhatsApp einladen</a>
      <button class="btn secondary" data-act="copy">Einladungs-Link kopieren</button>
      ${navigator.share ? `<button class="btn secondary" data-act="share">Anders teilen (E-Mail, SMS …)</button>` : ''}
      <p class="muted small">Oder: Auf <b>${esc(location.host + location.pathname)}</b> den Code <b>${esc(S.room)}</b> eingeben.</p>
    </section>` : '';
  const start = isHost
    ? `<section class="card"><h2>2. Los geht’s</h2>${S.lobby.filter((p) => p.connected).length < 2
      ? `<p class="big">Sobald mindestens eine weitere Person da ist, kannst du starten.</p>`
      : `<button class="btn primary huge" data-act="start">▶ Spiel starten</button>`}</section>`
    : `<section class="card"><p class="big center">Du bist dabei! 🎉<br>Bitte einen Moment warten, bis der Gastgeber das Spiel startet.</p></section>`;
  return `${headerHtml()}${lostHtml()}${invite}
    <section class="card"><h2>Wer ist schon da?</h2><ul class="players">${list}</ul></section>${start}`;
}

function startHtml() {
  const invited = Net.cleanCode(new URLSearchParams(location.search).get('raum'));
  const msg = S.message ? `<div class="notice ${S.message.tone}" role="alert">${esc(S.message.text)}</div>` : '';
  const nameField = `<label class="lbl" for="name">Wie heißt du?</label>
    <input id="name" class="input" type="text" maxlength="14" autocomplete="given-name" placeholder="Dein Vorname" value="${esc(S.name)}">`;
  if (invited.length === 4) {
    return `<div class="hero"><div class="logo">🎯</div><h1>Phasenwürfeln</h1><p class="sub">Du wurdest zu einem Spiel eingeladen!</p></div>
      <section class="card">${msg}${nameField}
      <button class="btn primary huge" data-act="join-invited" data-code="${invited}">Mitspielen</button>
      <button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button></section>`;
  }
  return `<div class="hero"><div class="logo">🎯</div><h1>Phasenwürfeln</h1><p class="sub">Zehn Phasen schaffen – online zusammen spielen</p></div>
    <section class="card">${msg}${nameField}
      <button class="btn primary huge" data-act="host">🎲 Neues Spiel eröffnen</button>
      <p class="muted center">Du bekommst einen Einladungs-Link für deine Mitspieler.</p>
    </section>
    <section class="card"><h2>Du hast einen Code bekommen?</h2>
      <label class="lbl" for="code">Code (4 Buchstaben)</label>
      <input id="code" class="input code-in" type="text" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="z. B. KFRT">
      <button class="btn secondary huge" data-act="join-code">Spiel beitreten</button>
    </section>
    <section class="card"><button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button>
      <a class="btn ghost" href="../">← Zur Spielauswahl</a></section>`;
}

function helpHtml() {
  const phases = P.PHASES.map((p) => `<li><b>Phase ${p.no}:</b> ${esc(p.name)}</li>`).join('');
  return `<div class="overlay" data-act="help-close"><div class="modal" role="dialog" aria-modal="true" aria-label="Spielregeln" onclick="event.stopPropagation()">
    <h2>Die Spielregeln von Phasenwürfeln</h2>
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
    <h3>Spielende</h3>
    <p>Hat jemand alle 10 Phasen geschafft, darf jede andere Person noch einmal versuchen, alle ihre fehlenden Phasen direkt hintereinander zu würfeln. Klappt eine Phase nicht, ist das Spiel für diese Person zu Ende. Es gewinnt, wer alle 10 Phasen geschafft hat und die meisten Punkte hat.</p>
    <p class="muted">Keine Sorge: Das Programm erkennt selbst, ob eine Phase geschafft ist, zählt die Punkte und macht Vorschläge, welche Würfel du behalten kannst.</p>
    <button class="btn primary huge" data-act="help-close">Alles klar, schließen</button>
  </div></div>`;
}

function render() {
  document.documentElement.classList.toggle('big', !!S.ui.big);
  let html = '';
  if (S.screen === 'start') html = startHtml();
  else if (S.screen === 'connecting') html = `<div class="hero"><div class="logo spin">🎲</div><h1>Einen Moment …</h1><p class="sub">${esc(S.connectText || '')}</p>
      <button class="btn ghost" data-act="leave-now">Abbrechen</button></div>`;
  else if (S.screen === 'lobby') html = lobbyHtml();
  else if (S.screen === 'game' && S.game) html = gameHtml();
  $app.innerHTML = html + (S.ui.helpOpen ? helpHtml() : '');
}

// ====================== Bedienung ======================
function needName() {
  const el = document.getElementById('name');
  const n = (el ? el.value : S.name).trim().slice(0, 14);
  if (!n) {
    S.message = { tone: 'warn', text: 'Bitte trage zuerst deinen Vornamen ein.' };
    render();
    document.getElementById('name')?.focus();
    return null;
  }
  S.name = n; sess.set('name', n);
  return n;
}

$app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const g = S.game;
  switch (act) {
    case 'host':
      if (!needName()) return;
      S.message = null;
      return sess.startHosting(null);
    case 'join-code': {
      if (!needName()) return;
      const code = Net.cleanCode(document.getElementById('code')?.value);
      if (code.length !== 4) { S.message = { tone: 'warn', text: 'Der Code besteht aus 4 Buchstaben.' }; render(); return; }
      S.message = null;
      return sess.joinGame(code);
    }
    case 'join-invited':
      if (!needName()) return;
      S.message = null;
      return sess.joinGame(el.dataset.code);
    case 'start': case 'again': return sess.hostStartGame();
    case 'roll': return sess.send({ t: 'roll' });
    case 'reroll': return sess.send({ t: 'roll', keep: S.ui.keep });
    case 'toggle': {
      const i = Number(el.dataset.i);
      S.ui.keep[i] = !S.ui.keep[i];
      return render();
    }
    case 'suggest': {
      const ap = P.activePlayer(g);
      S.ui.keep = Array(10).fill(false);
      for (const i of P.suggestKeep(g.turn.dice, ap.phaseNo)) S.ui.keep[i] = true;
      if (S.ui.keep.every(Boolean) && g.turn.attempt < P.MAX_ATTEMPTS) S.ui.keep[S.ui.keep.lastIndexOf(true)] = false;
      return render();
    }
    case 'finish-yes': return sess.send({ t: 'finish', note: true });
    case 'finish-skip': S.ui.confirmSkip = true; return render();
    case 'finish-skip-no': S.ui.confirmSkip = false; return render();
    case 'finish-skip-yes': S.ui.confirmSkip = false; return sess.send({ t: 'finish', note: false });
    case 'help': S.ui.helpOpen = true; return render();
    case 'help-close': S.ui.helpOpen = false; return render();
    case 'bigger': S.ui.big = !S.ui.big; sess.set('big', S.ui.big); return render();
    case 'leave':
      if (confirm(S.role === 'host' ? 'Das Spiel wirklich beenden? Für alle Mitspieler endet es dann.' : 'Das Spiel wirklich verlassen?')) { sess.leave(); render(); }
      return;
    case 'leave-now': sess.leave(); render(); return;
    case 'copy':
      try { await navigator.clipboard.writeText(link()); el.textContent = '✔ Link kopiert!'; }
      catch { prompt('Diesen Link bitte kopieren und verschicken:', link()); }
      return;
    case 'share':
      try { await navigator.share({ title: 'Phasenwürfeln', text: 'Komm zu Phasenwürfeln! Tippe hier, um mitzuspielen:', url: link() }); } catch { /* abgebrochen */ }
      return;
  }
});
$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'code') $app.querySelector('[data-act="join-code"]')?.click();
  else if (ev.target.id === 'name') ($app.querySelector('[data-act="join-invited"]') || $app.querySelector('[data-act="host"]'))?.click();
});
$app.addEventListener('input', (ev) => { if (ev.target.id === 'code') ev.target.value = Net.cleanCode(ev.target.value); });

(function boot() {
  if (!window.Peer && !Net.isMock()) {
    $app.innerHTML = '<div class="notice warn">Die Spielbibliothek konnte nicht geladen werden. Bitte lade die Seite neu.</div>';
    return;
  }
  if (!sess.boot()) render();
})();
