import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'free', label: 'FreeCell statt Klondike', help: 'FreeCell: Alle Karten liegen offen da, vier freie Zellen helfen dir. Fast jedes Spiel geht auf. Ein Wechsel startet ein neues Spiel.', def: false },
  { id: 'draw3', label: 'Drei Karten ziehen', help: 'Nur bei Klondike: Vom Stapel werden drei Karten auf einmal gezogen (schwerer). Ein Wechsel startet ein neues Spiel.', def: false },
  { id: 'dbl', label: 'Doppeltippen legt oben ab', help: 'Zweimal schnell auf eine Karte tippen: Sie springt von selbst auf den Zielstapel, wenn sie dort hin darf.', def: true },
  { id: 'hints', label: 'Mögliche Ziele zeigen', help: 'Wenn du eine Karte markierst, werden die Stellen grün umrandet, wohin sie legal darf.', def: false },
  { id: 'time', label: 'Zeit anzeigen', help: 'Zeigt oben eine Stoppuhr. Am Ende siehst du die Zeit immer.', def: false },
];

const PRESET = (() => { try { return new URLSearchParams(location.search).get('preset'); } catch { return null; } })();
let presetUsed = false;

const freshUi = () => ({ sel: null, note: '', confirm: null, sig: '', result: null, resultKey: '', coachSeen: {}, tap: { key: '', t: 0 } });

const sess = createSession({
  game: 'pt',
  maxPlayers: 1,
  options: OPTIONS,
  newGame: (players, opts) => {
    Object.assign(S.ui, { sel: null, note: '', confirm: null, sig: '', coachSeen: {} });
    if (S.learn) return E.learnGame(players);
    if ((PRESET === 'klondike' || PRESET === 'freecell') && !presetUsed) { presetUsed = true; return E.presetGame(players, PRESET); }
    return E.createGame(players, opts, Math.random);
  },
  onMessage: (state, pid, msg) => {
    const r = E.handle(state, pid, msg, Math.random);
    if (!r.ok) S.ui.note = r.error;
    else S.ui.note = '';
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
});
const S = sess.S;
S.ui = freshUi();
if (!S.name) { S.name = 'Du'; sess.set('name', 'Du'); }

const optsNow = () => sess.getOpts();
const variantKey = (g) => (g.free ? 'freecell' : 'klondike');
const variantName = (g) => (g.free ? 'FreeCell' : g.draw3 ? 'Klondike, drei Karten' : 'Klondike');

// ====================== Uhr (nur in der Oberfläche; der Stand wird mit jedem Zug gesichert) ======================
const clk = { key: '', base: 0, since: null };
const nowMs = () => clk.base + (clk.since != null ? Date.now() - clk.since : 0);
function clockSync(g) {
  if (!g || g.mode !== 'play') { if (g && g.mode === 'over' && g.result) { clk.base = g.result.ms; } clk.since = null; clk.key = ''; return; }
  const key = `${g.seed}|${g.moves}|${g.undo.length}|${g.learn ? 1 : 0}`;
  if (clk.key === key) return;
  const fresh = g.moves === 0 && g.undo.length === 0;
  const running = clk.key !== '' || clk.since != null;
  clk.base = fresh ? (g.elapsed || 0) : Math.max(g.elapsed || 0, running ? nowMs() : 0);
  clk.key = key;
  clk.since = document.visibilityState === 'hidden' ? null : Date.now();
}
function clockPause() {
  const g = S.game;
  if (!g || g.mode !== 'play' || S.role !== 'host') return;
  clk.base = nowMs(); clk.since = null;
  sess.send({ t: 'sync', ms: clk.base });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clockPause();
  else if (S.game && S.game.mode === 'play') clk.since = Date.now();
});
window.addEventListener('pagehide', clockPause);
setInterval(() => {
  const el = document.getElementById('pt-clock');
  if (el && S.game) el.textContent = E.fmtTime(S.game.mode === 'over' && S.game.result ? S.game.result.ms : nowMs());
}, 500);
const go = (msg) => sess.send({ ...msg, ms: nowMs() });

// ====================== Zustandswechsel ======================
function recordIfOver(g) {
  if (g.mode !== 'over' || !g.result) { S.ui.result = null; S.ui.resultKey = ''; return; }
  const key = `${g.seed}|${g.result.moves}|${g.free ? 1 : 0}`;
  if (S.ui.resultKey === key) return;
  S.ui.resultKey = key;
  const cur = { moves: g.result.moves, ms: g.result.ms };
  if (g.learn) { S.ui.result = { cur, prev: null, record: false, learn: true }; return; }
  const k = 'pt_best_' + variantKey(g);
  let prev = sess.get(k, null);
  if (!prev || typeof prev !== 'object' || !Number.isFinite(prev.moves)) prev = null;
  const record = E.better(cur, prev);
  if (record) sess.set(k, cur);
  S.ui.result = { cur, prev: record ? null : prev, record, learn: false };
}

function onStateChanged() {
  const g = S.game;
  if (g && Array.isArray(g.tab)) {
    const sig = `${g.seed}|${g.moves}|${g.undo.length}|${g.mode}|${g.free ? 1 : 0}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; S.ui.confirm = null; }
    if (S.ui.sel && !E.cardsAt(g, S.ui.sel).length) S.ui.sel = null;
    clockSync(g);
    recordIfOver(g);
  }
  render();
}

// ====================== Darstellung ======================
function cardHtml(c, o = {}) {
  const su = E.SUITS[E.cardSuit(c)];
  const name = E.cardName(c);
  const cls = ['pt-card', su.red ? 'red' : '', o.sel ? 'sel' : '', o.dest ? 'dest' : '', o.dim ? 'dim' : ''].filter(Boolean).join(' ');
  const label = `${name}${o.sel ? ', markiert' : ''}`;
  return `<button type="button" class="${cls}" data-act="pt" ${o.attrs || ''} aria-label="${label}"${o.style ? ` style="${o.style}"` : ''}>
    <span class="tl"><span class="r">${E.RANK_SYM[E.cardRank(c)]}</span><span class="s" aria-hidden="true">${su.sym}</span></span><span class="m" aria-hidden="true">${su.sym}</span></button>`;
}
const backHtml = (o = {}) => `<button type="button" class="pt-card back${o.cls ? ' ' + o.cls : ''}" data-act="pt" ${o.attrs || ''} aria-label="${o.label || 'verdeckte Karte'}"${o.style ? ` style="${o.style}"` : ''}>${o.inner || ''}</button>`;
const slotHtml = (o = {}) => `<button type="button" class="pt-slot${o.cls ? ' ' + o.cls : ''}" data-act="pt" ${o.attrs || ''} aria-label="${o.label}">${o.inner || ''}</button>`;

function boardHtml(g, interactive) {
  const sel = interactive && S.ui.sel ? S.ui.sel : null;
  const selCards = sel ? E.cardsAt(g, sel) : [];
  const dests = (sel && interactive && optsNow().hints && !S.learn) || (sel && interactive && S.learn) ? E.legalMovesFrom(g, sel) : [];
  const destF = dests.some((d) => d.k === 'f');
  const destT = new Set(dests.filter((d) => d.k === 't').map((d) => d.i));
  const destC = new Set(dests.filter((d) => d.k === 'c').map((d) => d.i));
  const inert = (a) => (interactive ? a : 'tabindex="-1" disabled');
  // obere Reihe
  const top = [];
  if (!g.free) {
    const left = g.stock.length;
    if (left) top.push(backHtml({ attrs: `data-k="s" ${inert('')}`, label: `Stapel, noch ${left} Karten. Tippe, um zu ziehen`, inner: `<span class="cnt">${left}</span>` }));
    else if (g.waste.length) top.push(slotHtml({ cls: 'again', attrs: `data-k="s" ${inert('')}`, label: 'Stapel ist leer. Tippe, um die Ablage wieder zum Stapel zu machen', inner: '<span class="rec">↻</span>' }));
    else top.push(slotHtml({ attrs: `data-k="s" ${inert('')}`, label: 'Stapel ist leer', inner: '' }));
    if (g.waste.length) {
      const w = g.waste[g.waste.length - 1];
      top.push(cardHtml(w, { attrs: `data-k="w" ${inert('')}`, sel: sel && sel.k === 'w' }));
    } else top.push(slotHtml({ attrs: `data-k="w" ${inert('')}`, label: 'Ablage ist leer' }));
    top.push('<span class="pt-gap" aria-hidden="true"></span>');
  } else {
    for (let i = 0; i < E.CELL_COUNT; i++) {
      const c = g.cells[i];
      if (c !== null) top.push(cardHtml(c, { attrs: `data-k="c" data-i="${i}" ${inert('')}`, sel: sel && sel.k === 'c' && sel.i === i }));
      else top.push(slotHtml({ cls: `cell${destC.has(i) ? ' dest' : ''}`, attrs: `data-k="c" data-i="${i}" ${inert('')}`, label: `Freie Zelle ${i + 1}, leer`, inner: '<span class="hole">Zelle</span>' }));
    }
  }
  for (let s = 0; s < 4; s++) {
    const n = g.found[s];
    const dc = destF && selCards.length === 1 && E.cardSuit(selCards[0]) === s;
    if (n > 0) top.push(cardHtml(E.mkCard(s, n), { attrs: `data-k="f" data-i="${s}" ${inert('')}`, dest: dc }));
    else top.push(slotHtml({ cls: `found${dc ? ' dest' : ''}`, attrs: `data-k="f" data-i="${s}" ${inert('')}`, label: `Zielstapel ${E.SUITS[s].name}, leer`, inner: `<span class="hole${E.SUITS[s].red ? ' red' : ''}">${E.SUITS[s].sym}</span>` }));
  }
  // Spalten
  const cols = g.tab.map((col, i) => {
    if (!col.length) {
      return `<div class="pt-col" data-col="${i}">${slotHtml({ cls: `empty${destT.has(i) ? ' dest' : ''}`, attrs: `data-k="t" data-i="${i}" data-j="0" ${inert('')}`, label: `Spalte ${i + 1}, leer` })}</div>`;
    }
    const down = g.down[i];
    let html = '';
    col.forEach((c, j) => {
      const d = Math.min(j, down), u = j - d;
      const style = `top:calc(var(--dn) * ${d} + var(--off) * ${u})`;
      const attrs = `data-k="t" data-i="${i}" data-j="${j}" ${inert('')}`;
      if (j < down) { html += backHtml({ attrs, style }); return; }
      const isSel = !!sel && sel.k === 't' && sel.i === i && j >= sel.j;
      const last = j === col.length - 1;
      html += cardHtml(c, { attrs, style, sel: isSel, dest: last && destT.has(i) });
    });
    const dLast = Math.min(col.length - 1, down), uLast = col.length - 1 - dLast;
    return `<div class="pt-col" data-col="${i}" style="height:calc(var(--ch) + var(--dn) * ${dLast} + var(--off) * ${uLast})">${html}</div>`;
  }).join('');
  return `<div id="board" class="pt-board${g.free ? ' free' : ''}" style="--n:${g.tab.length}" role="group" aria-label="Spieltisch">
    <div class="pt-grid pt-top">${top.join('')}</div><div class="pt-grid pt-tab">${cols}</div></div>`;
}

function statsHtml(g) {
  const t = g.mode === 'over' && g.result ? g.result.ms : nowMs();
  const showT = optsNow().time || g.mode === 'over';
  return `<section class="card pt-stats"><div class="pt-stat pt-moves"><span class="pt-var">${esc(variantName(g))}</span>Züge: <b>${g.moves}</b></div>
    ${showT ? `<div class="pt-stat">⏱ <b id="pt-clock">${E.fmtTime(t)}</b></div>` : ''}
    <button class="btn pt-undo" data-act="undo" ${g.undo.length ? '' : 'disabled'}>↶ Zurück</button></section>`;
}

function hintText(g) {
  if (S.ui.note) return S.ui.note;
  if (S.ui.sel) return 'Tippe auf die Spalte, den Zielstapel oder die Zelle, wohin die Karte soll. Nochmal tippen hebt die Markierung auf.';
  return g.free ? 'Tippe eine Karte an. Dann tippst du auf die Stelle, wohin sie soll.' : 'Tippe eine offene Karte an – oder den Stapel links oben, um zu ziehen.';
}

function toolsHtml(g) {
  const auto = E.autoAvailable(g);
  return `<section class="card pt-tools"><div class="pt-btnrow">
      <button class="btn" data-act="new">Neues Spiel</button>
      <button class="btn" data-act="same" ${g.moves === 0 && !g.undo.length ? 'disabled' : ''}>Nochmal dasselbe Spiel</button>
    </div>
    ${auto ? `<button class="btn primary huge pt-auto" data-act="auto">Automatisch ablegen</button>` : ''}</section>`;
}

function optionsCard() {
  const o = optsNow();
  const rows = OPTIONS.filter((d) => !(d.id === 'draw3' && o.free))
    .map((d) => `<label class="opt"><input type="checkbox" data-opt="${d.id}" ${o[d.id] ? 'checked' : ''}><span>${esc(d.label)}<small>${esc(d.help)}</small></span></label>`).join('');
  return `<section class="card optcard pt-opts"><h2>Einstellungen</h2>${rows}</section>`;
}

function confirmHtml() {
  const c = S.ui.confirm;
  if (!c) return '';
  const title = c.t === 'new' ? 'Wirklich ein neues Spiel anfangen?' : c.t === 'same' ? 'Dasselbe Spiel noch einmal von vorn?' : 'Mit dieser Einstellung neu anfangen?';
  return `<div class="overlay pt-confirm-bg"><div class="modal pt-confirm" role="alertdialog" aria-label="${title}"><p class="big"><b>${title}</b><br>Die bisherigen Züge gehen verloren.</p>
    <button class="btn primary huge" data-act="confirm-yes">Ja</button>
    <button class="btn secondary" data-act="confirm-no">Nein, weiterspielen</button></div></div>`;
}

function bestText(r) {
  if (r.learn) return '';
  if (r.record) return `<p class="center big pt-best">Neue Bestleistung! 🎉</p>`;
  if (r.prev) return `<p class="center big pt-best">Deine Bestleistung: <b>${r.prev.moves} Züge</b> (${E.fmtTime(r.prev.ms)})</p>`;
  return '';
}

function overHtml(g) {
  const r = S.ui.result || { learn: !!g.learn, record: false, prev: null };
  const res = g.result || { moves: g.moves, ms: g.elapsed };
  return `${statsHtml(g)}
    <section class="card over pt-over"><div class="trophy">🏆</div><h1>Geschafft!</h1>
      <p class="center big pt-result">Alle Karten liegen oben. Du hast <b>${res.moves} Züge</b> gebraucht, in <b>${E.fmtTime(res.ms)}</b>.</p>
      ${bestText(r)}
      <button class="btn primary huge" data-act="new">🃏 Neues Spiel</button>
      <button class="btn secondary" data-act="same">Nochmal dasselbe Spiel</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    <section class="card pt-boardcard">${boardHtml(g, false)}</section>`;
}

function playHtml(g) {
  return `${statsHtml(g)}
    <section class="action pt-msg"><p class="big" role="status">${esc(hintText(g))}</p></section>
    ${boardHtml(g, true)}
    ${S.learn ? '' : toolsHtml(g)}${S.learn ? '' : optionsCard()}`;
}

function gameHtml() {
  const g = S.game;
  return `${ui.header()}${g.mode === 'over' ? overHtml(g) : playHtml(g)}${confirmHtml()}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Alle 52 Karten wandern nach oben auf die vier Zielstapel – jede Farbe von <b>A</b> (Ass) bis <b>K</b> (König).</p>
    <h3>Bedienung</h3>
    <ol>
      <li>Tippe eine offene Karte an. Sie wird markiert. Alle Karten, die auf ihr liegen, kommen mit.</li>
      <li>Tippe dann auf die Stelle, wohin sie soll: eine Spalte, einen Zielstapel oder (bei FreeCell) eine freie Zelle.</li>
      <li>Passt es nicht, sagt dir das Spiel freundlich Bescheid. Nichts geht kaputt.</li>
      <li>Wenn du zweimal schnell auf eine Karte tippst, legt sie sich selbst auf den Zielstapel – wenn sie dort hin darf.</li>
    </ol>
    <h3>Klondike (das klassische Patience)</h3>
    <ul>
      <li>Es gibt 7 Spalten. Nur die unterste, offene Karte jeder Spalte ist sichtbar, darunter liegen verdeckte Karten. Sie werden aufgedeckt, sobald die offene Karte weggeräumt ist.</li>
      <li>In den Spalten legst du Karten <b>absteigend</b> und in <b>abwechselnden Farben</b> (rot und schwarz) ab, zum Beispiel eine rote 9 auf eine schwarze 10.</li>
      <li>Eine leere Spalte nimmt nur einen <b>König</b> (mit allen Karten darauf).</li>
      <li>Links oben ist der Stapel. Tippe darauf, um eine Karte auf die Ablage zu ziehen (oder drei, wenn du „Drei Karten ziehen“ ankreuzt). Die oberste Ablagekarte darfst du spielen. Ist der Stapel leer, tippst du darauf, und die Ablage wird wieder zum Stapel – so oft du magst.</li>
      <li>Die Zielstapel füllst du von A bis K, jede Farbe für sich.</li>
      <li>Nicht jedes Klondike-Spiel geht auf. Das ist normal. Dann hilft „Nochmal dasselbe Spiel“ (gleiche Karten, neuer Versuch) oder „Neues Spiel“.</li>
    </ul>
    <h3>FreeCell</h3>
    <ul>
      <li>Kreuze „FreeCell statt Klondike“ an. Es gibt 8 Spalten, alle Karten liegen offen.</li>
      <li>Oben links sind <b>4 freie Zellen</b>. In jede Zelle darf genau eine Karte als Zwischenlager.</li>
      <li>Auch hier legst du absteigend in abwechselnden Farben ab. Eine leere Spalte nimmt jede Karte.</li>
      <li>Du darfst mehrere Karten auf einmal verschieben, wenn genug freie Zellen und leere Spalten da sind: mit (freien Zellen + 1) Karten, verdoppelt für jede leere Spalte.</li>
      <li>Fast jedes FreeCell-Spiel lässt sich lösen.</li>
    </ul>
    <h3>Knöpfe</h3>
    <ul>
      <li><b>Zurück:</b> nimmt den letzten Zug zurück – beliebig oft.</li>
      <li><b>Neues Spiel:</b> mischt neu. <b>Nochmal dasselbe Spiel:</b> gleiche Karten von vorn.</li>
      <li><b>Automatisch ablegen:</b> erscheint, wenn nur noch Ablegen übrig ist. Dann legt das Spiel alle Karten nach oben.</li>
    </ul>
    <p>Am Ende siehst du deine Züge und die Zeit. Deine Bestleistung (wenige Züge) merkt sich das Spiel für Klondike und FreeCell getrennt.</p>
    <p class="muted">Das Spiel erlaubt nur gültige Züge. Wie du spielst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const keyOf = (t) => `${t.k}|${t.i ?? ''}|${t.j ?? ''}`;

function tapTarget(el) {
  const k = el.dataset.k;
  const t = { k };
  if (el.dataset.i !== undefined) t.i = Number(el.dataset.i);
  if (el.dataset.j !== undefined) t.j = Number(el.dataset.j);
  return t;
}

function onTap(t) {
  const g = S.game;
  if (!g || g.mode !== 'play') return;
  S.ui.note = '';
  const sel = S.ui.sel;
  const now = Date.now();
  const prevTap = S.ui.tap;
  S.ui.tap = { key: keyOf(t), t: now };
  const dbl = !!sel && prevTap.key === keyOf(t) && now - prevTap.t < 380 && sameSrc(sel, t);

  if (t.k === 's') {
    S.ui.sel = null;
    if (!g.stock.length && !g.waste.length) return render();
    return go({ t: 'draw' });
  }
  const isSource = (t.k === 't' && t.j >= 0 && g.tab[t.i] && g.tab[t.i].length > 0) || t.k === 'w' || (t.k === 'c' && g.cells[t.i] !== null);

  if (!sel) {
    if (!isSource) {
      S.ui.note = t.k === 'f' ? 'Auf die Zielstapel legst du die Karten von A bis K, jede Farbe für sich. Tippe zuerst eine Karte an.'
        : t.k === 'w' ? 'Die Ablage ist leer. Tippe auf den Stapel, um zu ziehen.' : t.k === 'c' ? 'Die Zelle ist leer. Tippe zuerst eine Karte an.' : 'Diese Spalte ist leer. Tippe zuerst eine Karte an.';
      return render();
    }
    if (t.k === 't' && t.j < g.down[t.i]) { S.ui.note = 'Diese Karte ist noch verdeckt. Sie wird aufgedeckt, wenn die Karten darauf weg sind.'; return render(); }
    if (!E.cardsAt(g, t).length) { S.ui.note = 'Diese Karte kannst du nicht mitnehmen. Die Karten darunter passen nicht in einer Reihe zusammen. Tippe weiter unten an.'; return render(); }
    S.ui.sel = t.k === 't' ? { k: 't', i: t.i, j: t.j } : t.k === 'w' ? { k: 'w' } : { k: 'c', i: t.i };
    return render();
  }

  // Es ist schon etwas markiert.
  if (t.k === 't' && sel.k === 't' && t.i === sel.i && t.j !== sel.j) {
    if (isSource && t.j >= g.down[t.i] && E.cardsAt(g, t).length) { S.ui.sel = { k: 't', i: t.i, j: t.j }; return render(); }
    S.ui.sel = null; return render();
  }
  if (sameSrc(sel, t)) {
    if (dbl && optsNow().dbl) {
      const cards = E.cardsAt(g, sel);
      if (cards.length === 1 && E.canPlace(g, cards, { k: 'f' }, sel)) { S.ui.sel = null; return go({ t: 'move', from: sel, to: { k: 'f' } }); }
      return render();
    }
    S.ui.sel = null;
    return render();
  }
  const cards = E.cardsAt(g, sel);
  let to = null;
  if (t.k === 'f') to = { k: 'f' };
  else if (t.k === 't') to = { k: 't', i: t.i };
  else if (t.k === 'c') to = { k: 'c', i: t.i };
  if (!to) { S.ui.note = 'Dort kannst du die Karte nicht ablegen.'; return render(); }
  if (E.canPlace(g, cards, to, sel)) { S.ui.sel = null; return go({ t: 'move', from: sel, to }); }
  if (to.k === 't' && cards.length > E.countMovable(g, to.i) && E.canPlace(g, cards.slice(0, 1), { k: 't', i: to.i }, null)) {
    S.ui.note = `So viele Karten auf einmal schaffst du nicht. Im Moment gehen höchstens ${E.countMovable(g, to.i)}. Mehr freie Zellen oder leere Spalten helfen.`;
    return render();
  }
  S.ui.note = 'Dort kannst du die Karte nicht ablegen.';
  return render();
}
function sameSrc(sel, t) {
  if (sel.k === 'w') return t.k === 'w';
  if (sel.k === 'c') return t.k === 'c' && t.i === sel.i;
  return t.k === 't' && t.i === sel.i && E.cardsAt(S.game, sel).length > 0 && t.j === sel.j;
}

const ui = createUI({
  soloOnly: true,
  sess, $app,
  options: OPTIONS,
  title: 'Patience', icon: '🃏', sub: 'Klondike und FreeCell – Karten legen, ganz allein',
  helpTitle: 'Die Spielregeln von Patience', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'pt': if (el.disabled) return; return onTap(tapTarget(el));
      case 'undo': S.ui.confirm = null; S.ui.sel = null; return sess.send({ t: 'undo' });
      case 'auto': S.ui.sel = null; return go({ t: 'auto' });
      case 'new': case 'same': {
        if (!g) return;
        if (g.mode === 'play' && g.moves > 0) { S.ui.confirm = { t: act }; return render(); }
        return doNewOrAgain(act);
      }
      case 'confirm-yes': {
        const c = S.ui.confirm;
        S.ui.confirm = null;
        if (!c) return render();
        if (c.t === 'opt') return doNewOrAgain('new');
        return doNewOrAgain(c.t);
      }
      case 'confirm-no': {
        const c = S.ui.confirm;
        S.ui.confirm = null;
        if (c && c.t === 'opt') { sess.setOpt(c.id, c.was); }
        return render();
      }
    }
  },
});
function doNewOrAgain(which) {
  S.ui.sel = null;
  clk.key = ''; clk.since = null; clk.base = 0;
  if (which === 'same') return sess.send({ t: 'again' });
  const o = optsNow();
  return sess.send({ t: 'new', free: !!o.free, draw3: !!o.draw3 });
}
function render() { ui.render(); }
ui.boot();

// Spielart-Kästchen: Wechsel startet ein neues Spiel (bei laufendem Spiel erst nach Rückfrage).
$app.addEventListener('change', (ev) => {
  const t = ev.target;
  const id = t && t.dataset && t.dataset.opt;
  if (id !== 'free' && id !== 'draw3') { if (id) render(); return; }
  const g = S.game;
  if (!g || S.learn) return render();
  if (g.mode === 'play' && g.moves > 0) { S.ui.confirm = { t: 'opt', id, was: !t.checked }; return render(); }
  doNewOrAgain('new');
});
