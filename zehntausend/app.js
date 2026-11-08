import * as Z from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, warmUp } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const freshSel = () => Array(Z.NUM_DICE).fill(false);
const freshUi = () => ({ sel: freshSel(), rolling: false, lastRollId: 0, gid: null, sig: '', tab: false });
const fmt = (n) => Number(n).toLocaleString('de-DE');
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

const sess = createSession({
  game: 'zt',
  maxPlayers: Z.MAX_PLAYERS,
  // Die Lernrunde läuft immer als Kurzspiel (bis 5000)
  newGame: (players, opts) => {
    S.ui = freshUi();
    const o = S.learn ? { pairs: true, entry: true, short: true } : opts;
    setTimeout(() => warmUp(o), 300); // Schwellen des Computers vorab berechnen
    return Z.createGame(players, o, Math.random);
  },
  onMessage: (state, pid, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'next' && state && state.mode === 'play') {
      // Weiter darf die Person am Zug; der Gastgeber nur, wenn diese Person gerade nicht verbunden ist
      const ap = Z.activePlayer(state);
      const off = ap && S.lobby.some((l) => l.id === ap.id && !l.connected);
      if (pid === cid && ap && ap.id !== pid && off) return Z.next(state, ap.id);
    }
    Z.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.mode === 'over') return null;
      const ap = Z.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.game === 'zt') {
    if (g.gid !== S.ui.gid) { S.ui.gid = g.gid; S.ui.lastRollId = g.rollId; S.ui.sig = ''; }
    const sig = `${g.gid}|${g.rollId}|${g.active}|${g.turn.phase}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = freshSel(); }
    if (g.rollId !== S.ui.lastRollId) {
      S.ui.lastRollId = g.rollId;
      if (g.turn.dice && g.turn.dice.length && !reduceMotion()) { animateDice(); return; }
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
    const el = document.getElementById('board');
    if (el && S.game?.turn?.dice) el.innerHTML = boardInner(S.game, { spin: true });
    if (n >= 8) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}

// ====================== Darstellung ======================
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pips = (v) => Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ''}></i>`).join('');

// Die Würfel am Tisch (3 × 2 Plätze) und die zur Seite gelegten (6 kleine Plätze)
function boardInner(g, o = {}) {
  const t = g.turn;
  const isMe = Z.activePlayer(g).id === cid;
  const interactive = isMe && t.phase === 'pick' && !S.ui.rolling && !o.spin;
  const ap = Z.activePlayer(g);
  const showDice = (t.phase === 'pick' || (t.phase === 'end' && t.result && t.result.kind === 'patzer')) && t.dice.length;
  const slots = [];
  for (let i = 0; i < Z.NUM_DICE; i++) {
    if (showDice && i < t.dice.length) {
      const sel = interactive && S.ui.sel[i];
      const v = o.spin ? 1 + Math.floor(Math.random() * 6) : t.dice[i];
      const lost = t.phase === 'end';
      const label = `Würfel ${i + 1}: ${v}${interactive ? (sel ? ', markiert' : ', nicht markiert') : ''}`;
      const cls = `zt-die${sel ? ' sel' : ''}${lost ? ' lost' : ''}`;
      slots.push(interactive
        ? `<button class="${cls}" data-act="toggle" data-i="${i}" aria-pressed="${!!sel}" aria-label="${label}">${pips(v)}</button>`
        : `<div class="${cls}" role="img" aria-label="${label}">${pips(v)}</div>`);
    } else {
      const ghost = (t.phase === 'start' || t.phase === 'after') && i < Z.diceLeft(t);
      slots.push(`<div class="zt-ghost" aria-hidden="true"${ghost ? '' : ' style="visibility:hidden"'}></div>`);
    }
  }
  const aside = [];
  for (let i = 0; i < Z.NUM_DICE; i++) {
    aside.push(i < t.aside.length
      ? `<div class="zt-die small" role="img" aria-label="Zur Seite gelegt: ${t.aside[i]}">${pips(t.aside[i])}</div>`
      : '<div class="zt-ghost small" aria-hidden="true"></div>');
  }
  const pts = t.phase === 'end' ? (t.result && t.result.kind === 'bank' ? t.result.pts : 0) : t.pts;
  const stat = `<div class="zt-stat"><span>Zugpunkte: <b>${fmt(pts)}</b></span><span>Konto: <b>${fmt(ap.score)}</b></span></div>`;
  return `${stat}
    <div><p class="zt-cap">Am Tisch</p><div class="zt-grid${o.spin ? ' zt-spin' : ''}">${slots.join('')}</div></div>
    <div><p class="zt-cap">Zur Seite gelegt</p><div class="zt-aside">${aside.join('')}</div></div>`;
}

function noteHtml(g) {
  const target = Z.targetOf(g);
  if (g.finalFrom != null) {
    const f = g.players[g.finalFrom];
    return `<div class="zt-note final">Schlussrunde! ${esc(f.name)} hat ${fmt(target)} Punkte erreicht. Alle anderen haben noch einen Zug.</div>`;
  }
  const solo = g.players.length === 1;
  return `<div class="zt-note">${solo ? `Zug Nr. ${g.players[0].turns + (g.turn.phase === 'end' ? 0 : 1)} – Ziel: ${fmt(target)} Punkte` : `Ziel: ${fmt(target)} Punkte`}</div>`;
}

function selectedValues(g) {
  return g.turn.dice.filter((_, i) => S.ui.sel[i]);
}

function actionHtml() {
  const g = S.game;
  const t = g.turn;
  const ap = Z.activePlayer(g);
  const isMe = ap.id === cid;
  const nm = `<b>${esc(ap.name)}</b>`;
  if (S.ui.rolling) return `<p class="big center hold">🎲 Die Würfel rollen …</p>`;
  const offline = S.lobby.some((l) => l.id === ap.id && !l.connected);
  const hostSkip = !isMe && S.role === 'host' && offline;
  const nextBtn = (isMe || hostSkip) && t.phase === 'end'
    ? `<button class="btn primary huge" data-act="next">${isMe ? 'Weiter' : `Weiter für ${esc(ap.name)}`}</button>` : '';

  if (t.phase === 'end') {
    const r = t.result || {};
    if (r.kind === 'patzer') {
      return `<p class="big center hold">${isMe ? 'Pech gehabt, nichts gewertet. Die Punkte dieses Zugs sind weg.' : `Pech gehabt, ${nm}: nichts gewertet. Die Punkte dieses Zugs sind weg.`}</p>${nextBtn}`;
    }
    return `<p class="big center hold">${isMe ? `Du hast ${fmt(r.pts)} Punkte gebucht. Dein Konto: ${fmt(ap.score)}.` : `${nm} hat ${fmt(r.pts)} Punkte gebucht. Konto: ${fmt(ap.score)}.`}</p>${nextBtn}`;
  }
  if (!isMe) {
    if (t.phase === 'start') return `<p class="big center hold">Gleich würfelt ${nm}. Bitte einen Moment Geduld.</p>`;
    if (t.phase === 'pick') return `<p class="big center hold">${nm} sucht die Würfel aus, die zählen.</p>`;
    return `<p class="big center hold">${nm} hat ${fmt(t.pts)} Punkte im Zug und überlegt.</p>`;
  }
  if (t.phase === 'start') {
    return `<p class="big hold">Du bist dran. Du würfelst mit allen sechs Würfeln.</p>
      <button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`;
  }
  if (t.phase === 'pick') {
    const vals = selectedValues(g);
    const pts = vals.length ? Z.scoreExact(vals, g.opts) : 0;
    const label = !vals.length ? 'Würfel antippen' : pts > 0 ? `✔ Diese Würfel gelten: ${fmt(pts)} Punkte` : 'Diese Würfel gelten: 0 Punkte';
    return `<p class="big hold">Tippe die Würfel an, die du zur Seite legen willst.</p>
      <button class="btn primary huge" data-act="keep" ${pts > 0 ? '' : 'disabled'}>${label}</button>`;
  }
  // nach einer Wertung
  const left = Z.diceLeft(t);
  const ok = Z.canBank(g, ap, t);
  const lead = t.hot
    ? `Heiße Würfel! Du würfelst wieder mit allen sechs. Zugpunkte: ${fmt(t.pts)}.`
    : `Du hast ${fmt(t.last)} Punkte zur Seite gelegt. Zugpunkte: ${fmt(t.pts)}.`;
  const hurdle = `<p class="zt-hurdle">${!ok && g.opts.entry && !ap.entered ? `Einstiegshürde: Aufhören erst ab ${Z.ENTRY} Punkten im Zug.` : ''}</p>`;
  return `<p class="big hold">${lead}</p>
    <button class="btn primary huge" data-act="roll">🎲 Weiterwürfeln (${left} ${left === 1 ? 'Würfel' : 'Würfel'})</button>
    <button class="btn secondary huge" data-act="bank" ${ok ? '' : 'disabled'}>✋ Aufhören &amp; Punkte buchen</button>${hurdle}`;
}

function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = Z.activePlayer(g);
  return ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function scoreboardHtml() {
  const g = S.game;
  const rows = g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const act = g.mode === 'play' && i === g.active;
    const t = act && g.turn.phase !== 'start' ? (g.turn.phase === 'end' ? '' : `+${fmt(g.turn.pts)}`) : '';
    const noacc = g.opts.entry && !p.entered ? '<small>noch ohne Konto</small>' : '';
    return `<div class="zt-prow${act ? ' active' : ''}"><span class="n">${act ? '🎲 ' : ''}${esc(p.name)}${p.id === cid ? ' (du)' : ''}${off}${noacc}</span><span class="a">${fmt(p.score)}</span><span class="t">${t}</span></div>`;
  }).join('');
  return `<section class="card"><h2>Punktestand</h2>
    <div class="zt-prow head"><span>Name</span><span>Konto</span><span>Zug</span></div>${rows}</section>`;
}

const TABLE = [
  ['Eine 1', '100'], ['Eine 5', '50'],
  ['Drei Einser', '1.000'], ['Drei Zweier', '200'], ['Drei Dreier', '300'], ['Drei Vierer', '400'], ['Drei Fünfer', '500'], ['Drei Sechser', '600'],
  ['Vier gleiche', 'doppelt so viel wie drei'], ['Fünf gleiche', 'vierfach'], ['Sechs gleiche', 'achtfach'],
  ['Straße 1‑2‑3‑4‑5‑6', '1.500'],
];
function tableHtml(g) {
  const rows = TABLE.concat(g.opts.pairs ? [['Drei Paare (mit allen 6 Würfeln)', '1.000']] : []);
  return `<table class="zt-tab"><tbody>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>`;
}
function tabHtml(g) {
  return `<section class="card"><button class="btn ghost" data-act="tab-toggle" aria-expanded="${S.ui.tab}">📋 Punktetabelle ${S.ui.tab ? 'verbergen' : 'ansehen'}</button>${S.ui.tab ? tableHtml(g) : ''}</section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml();
  return `${headerHtml()}${lostHtml()}${bannerHtml()}
    <section class="card">${noteHtml(g)}<div id="board" class="zt-board">${boardInner(g)}</div></section>
    <section class="card action zt-action">${actionHtml()}</section>
    ${scoreboardHtml()}${tabHtml(g)}`;
}

let soloKey = '', soloInfo = null;
function soloResult(g) {
  const key = `${g.gid}|${g.players[0].turns}`;
  if (soloKey !== key) {
    soloKey = key;
    const bk = g.opts.short ? 'zt_best_short' : 'zt_best';
    const turns = g.players[0].turns;
    const prev = sess.get(bk, 0);
    const record = !prev || turns < prev;
    soloInfo = { turns, prev, record };
    if (record) sess.set(bk, turns);
  }
  return soloInfo;
}

function overHtml() {
  const g = S.game;
  const target = Z.targetOf(g);
  const lastRecap = g.recap && g.recap.length ? `<p class="muted center">${esc(g.recap[0])}</p>` : '';
  if (g.players.length === 1) {
    const r = soloResult(g);
    return `${headerHtml()}${lostHtml()}
      <section class="card over"><div class="trophy">${r.record ? '🏆' : '👏'}</div><h1>Geschafft in ${r.turns} ${r.turns === 1 ? 'Zug' : 'Zügen'}!</h1>
      <p class="center big">${r.record ? 'Neue Bestleistung! 🎉' : `Deine Bestleistung: <b>${r.prev}</b> ${r.prev === 1 ? 'Zug' : 'Züge'}`}</p>
      <p class="center">Du hast ${fmt(target)} Punkte erreicht. Je weniger Züge, desto besser.</p>${lastRecap}
      <button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  }
  const rank = Z.ranking(g);
  const wins = rank.filter((r) => r.place === 1);
  const medals = { 1: '🏆', 2: '🥈', 3: '🥉' };
  const title = wins.length > 1
    ? `Unentschieden! ${wins.map((w) => esc(w.name)).join(' und ')} teilen sich den Sieg.`
    : `${esc(wins[0].name)} hat gewonnen!`;
  const list = rank.map((r) => `<li class="${r.place === 1 ? 'win' : ''}"><span class="medal">${medals[r.place] || ''}</span>
    <span class="rn">${r.place}. ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${fmt(r.score)} Punkte</span>
    <div class="rd"><span class="chip">${r.turns} ${r.turns === 1 ? 'Zug' : 'Züge'}</span>${r.tie ? '<span class="chip">gleiche Punktzahl</span>' : ''}</div></li>`).join('');
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">🏆</div><h1>${title}</h1>
    <ol class="ranking">${list}</ol>${lastRecap}${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Mit sechs Würfeln Punkte sammeln. Wer zuerst 10.000 Punkte auf dem Konto hat, löst die Schlussrunde aus. Danach hat jeder andere noch genau einen Zug. Wer am Ende die meisten Punkte hat, gewinnt. (Mit dem Kästchen „Kurzspiel“ reichen 5.000 Punkte.)</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Du würfelst alle sechs Würfel.</li>
      <li>Du tippst die Würfel an, die Punkte bringen, und bestätigst mit „Diese Würfel gelten“. Mindestens ein Würfel muss zählen, mehrere sind erlaubt. Der Knopf zeigt dir die Punkte deiner Auswahl.</li>
      <li>Die gezählten Würfel liegen jetzt zur Seite. Du hast die Wahl: <b>Weiterwürfeln</b> mit den übrigen Würfeln oder <b>Aufhören &amp; Punkte buchen</b>. Gebuchte Punkte sind sicher auf deinem Konto.</li>
      <li>Würfelst du weiter und kein Würfel zählt, ist das ein <b>Patzer</b>: Alle Punkte dieses Zugs sind weg und die nächste Person ist dran.</li>
      <li>Hast du alle sechs Würfel gezählt, sind das <b>Heiße Würfel</b>: Du darfst mit allen sechs neu würfeln und behältst deine Zugpunkte.</li>
    </ol>
    <h3>Die Punkte</h3>
    <ul>
      <li>Eine einzelne <b>1</b> zählt 100, eine einzelne <b>5</b> zählt 50.</li>
      <li><b>Drei gleiche</b>: drei Einser 1.000, drei Zweier 200, drei Dreier 300, drei Vierer 400, drei Fünfer 500, drei Sechser 600.</li>
      <li><b>Vier gleiche</b> zählen doppelt so viel wie drei, <b>fünf gleiche</b> vierfach, <b>sechs gleiche</b> achtfach. Beispiel: vier Zweier = 400, vier Einser = 2.000.</li>
      <li><b>Straße</b> (1‑2‑3‑4‑5‑6): 1.500 Punkte.</li>
      <li><b>Drei Paare</b> (mit allen sechs Würfeln, zum Beispiel 2‑2‑4‑4‑6‑6): 1.000 Punkte. Das lässt sich in den Regeln ausschalten.</li>
      <li>Eine Wertung muss in <b>einem</b> Wurf vollständig sein: Drei Zweier zählen nur, wenn alle drei im selben Wurf gefallen sind.</li>
    </ul>
    <h3>Einstiegshürde</h3>
    <p>Wer noch kein Konto hat, muss in einem Zug mindestens 500 Punkte sammeln, bevor er aufhören darf. Danach darfst du jederzeit aufhören. Auch das lässt sich in den Regeln ausschalten.</p>
    <h3>Allein spielen</h3>
    <p>Du zählst, wie viele Züge du bis zum Ziel brauchst. Je weniger, desto besser. Deine Bestleistung wird auf diesem Gerät gespeichert.</p>
    <p class="muted">Keine Sorge: Das Programm rechnet alle Punkte für dich aus und lässt nur gültige Wertungen zu. Ob du weiterwürfelst oder aufhörst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du jagst deine Bestleistung: Wie wenige Züge brauchst du bis zum Ziel?',
  sess, $app,
  options: [
    { id: 'pairs', label: 'Drei Paare zählen', help: 'Drei verschiedene Paare mit allen sechs Würfeln geben 1.000 Punkte.', def: true },
    { id: 'entry', label: 'Einstiegshürde 500', help: 'Wer noch kein Konto hat, braucht in einem Zug mindestens 500 Punkte, bevor er aufhören darf.', def: true },
    { id: 'short', label: 'Kurzspiel: nur bis 5.000', help: 'Das Ziel sind 5.000 statt 10.000 Punkte. Die Partie ist kürzer.', def: false },
  ],
  title: 'Zehntausend', icon: '🎲', sub: 'Würfeln, wagen, buchen – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Zehntausend', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3, 4, 5], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'toggle': { const i = Number(el.dataset.i); S.ui.sel[i] = !S.ui.sel[i]; return render(); }
      case 'keep': {
        const g = S.game;
        const idx = S.ui.sel.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        if (!g || !idx.length) return;
        return sess.send({ t: 'keep', idx });
      }
      case 'bank': return sess.send({ t: 'bank' });
      case 'next': return sess.send({ t: 'next' });
      case 'tab-toggle': S.ui.tab = !S.ui.tab; return render();
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
