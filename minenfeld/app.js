import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const freshUi = () => ({ flagMode: false, note: '', coachSeen: {} });
const LONG_MS = 450;

const OPTIONS = [
  { id: 'mid', label: 'Mittel: 10 × 10 Felder, 15 Minen', def: false, help: 'Ohne Haken bei Mittel und Schwer spielst du Leicht (8 × 8, 8 Minen).' },
  { id: 'hard', label: 'Schwer: 12 × 12 Felder, 28 Minen', def: false, help: 'Schwer hat Vorrang vor Mittel. Gilt ab dem nächsten Spiel.' },
  { id: 'chord', label: 'Schnell aufdecken', def: true, help: 'Tippe auf eine Zahl, die schon genug Flaggen hat: Die übrigen Nachbarfelder öffnen sich.' },
  { id: 'time', label: 'Zeit anzeigen', def: true, help: 'Die Uhr läuft ab dem ersten Tipp. Am Ende siehst du die Zeit immer.' },
];

const sess = createSession({
  game: 'mn',
  maxPlayers: 1,
  newGame: (players, opts) => {
    const learnStart = !!S.learn && !S.game; // erste Partie der Lernrunde
    if (S.learn && S.game) S.learn = false; // „Neues Spiel“ nach der Lernrunde ist ein richtiges Spiel
    Object.assign(S.ui, { flagMode: false, note: '' });
    return P.createGame(players, { ...opts, learn: learnStart }, Math.random);
  },
  onMessage: (state, pid, msg) => {
    const r = P.handle(state, pid, msg, Math.random);
    S.ui.note = r.ok ? '' : r.error;
    if (!r.ok) { render(); return; } // Zustand unverändert: sonst würde nichts neu gezeichnet
    if (state.mode === 'won' && state.result === null) {
      const prev = state.learn ? 0 : Number(sess.get('mn_best_' + state.level, 0)) || 0;
      const b = P.settleResult(state, prev);
      if (b && b.record) sess.set('mn_best_' + state.level, b.best);
    }
  },
  render: () => render(),
  onState: () => render(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
});
const S = sess.S;
S.ui = freshUi();
if (!S.name) { S.name = 'Du'; sess.set('name', 'Du'); }

const optOn = (id) => !!sess.getOpts()[id];
const send = (msg) => sess.send({ ...msg, now: Date.now() });

// ====================== Uhr (nur im App-Teil) ======================
function timeText(g) {
  if (!optOn('time') && g.mode !== 'won' && g.mode !== 'lost') return '–:––';
  if (g.mode === 'won' || g.mode === 'lost') return P.fmtTime(g.elapsed);
  if (!g.startAt) return '0:00';
  return P.fmtTime(Date.now() - g.startAt);
}
setInterval(() => {
  const el = document.getElementById('mn-clock');
  if (el && S.game && S.game.game === 'mn') el.textContent = optOn('time') || S.game.mode === 'won' || S.game.mode === 'lost' ? timeText(S.game) : '–:––';
}, 500);

// ====================== Darstellung ======================
function cellHtml(g, i, readonly) {
  const r = P.rowOf(g, i) + 1, c = P.colOf(g, i) + 1;
  const lost = g.mode === 'lost';
  const cls = ['mn-c'];
  let inner = '';
  let label = `Zeile ${r}, Spalte ${c}: `;
  if (g.open[i]) {
    const n = P.numberAt(g, i);
    cls.push('open');
    if (n) { cls.push('n' + n); inner = `<span>${n}</span>`; label += n === 1 ? '1 Mine ringsum' : `${n} Minen ringsum`; } else label += 'leer';
  } else if (lost && g.mine[i] && !g.flag[i]) {
    cls.push('mine');
    if (i === g.trigger) { cls.push('boom'); label += 'Mine, ausgelöst'; } else label += 'Mine';
    inner = '<span class="em">💣</span>';
  } else if (lost && g.flag[i] && !g.mine[i]) {
    cls.push('hid', 'flag', 'wrong');
    inner = '<span class="em">🚩</span>';
    label += 'falsche Flagge';
  } else if (g.flag[i]) {
    cls.push('hid', 'flag');
    inner = '<span class="em">🚩</span>';
    label += 'Flagge';
  } else {
    cls.push('hid');
    label += 'verdeckt';
  }
  if (readonly) return `<div class="${cls.join(' ')}" role="img" aria-label="${label}">${inner}</div>`;
  return `<button class="${cls.join(' ')}" data-act="cell" data-i="${i}" aria-label="${label}">${inner}</button>`;
}

function boardHtml(g) {
  const lv = P.levelInfo(g.level);
  const readonly = g.mode === 'won' || g.mode === 'lost';
  const cells = Array.from({ length: g.w * g.h }, (_, i) => cellHtml(g, i, readonly)).join('');
  return `<div id="board" class="mn-board" style="--cols:${g.w};--cs:min(${lv.cell}px, calc((100vw - 28px) / ${g.w}))" role="group" aria-label="Minenfeld mit ${g.w} mal ${g.h} Feldern">${cells}</div>`;
}

function statusHtml(g) {
  const left = P.flagsLeft(g);
  return `<div class="mn-status"><span class="mn-left">Minen noch: <b id="mn-left">${left}</b></span>
    <span class="mn-clock" aria-label="Zeit">⏱ <span id="mn-clock">${timeText(g)}</span></span>
    <span class="mn-lvl">${esc(P.levelInfo(g.level).name)}</span></div>`;
}

function modesHtml(g) {
  if (g.mode === 'lost') {
    return `<div class="mn-modes">
      <button class="btn mn-mode mn-end primary" data-act="retry">🔁 Nochmal (gleiches Feld)</button>
      <button class="btn mn-mode mn-end" data-act="again">Neues Spiel</button></div>`;
  }
  const off = g.mode === 'won' ? ' disabled' : '';
  const fm = S.ui.flagMode;
  return `<div class="mn-modes">
    <button class="btn mn-mode" data-act="mode" data-mode="reveal" aria-pressed="${!fm}"${off}>👆 Aufdecken</button>
    <button class="btn mn-mode" data-act="mode" data-mode="flag" aria-pressed="${fm}"${off}>🚩 Flagge setzen</button></div>`;
}

function msgOf(g) {
  if (g.mode === 'lost') return { tone: 'warn', text: 'Das war eine Mine. Nochmal?' };
  if (g.mode === 'won') return { tone: 'ok', text: `Geschafft! Alle sicheren Felder sind offen. Deine Zeit: ${P.fmtTime(g.elapsed)}.` };
  if (S.ui.note) return { tone: 'warn', text: S.ui.note };
  if (g.mode === 'ready') return { tone: '', text: 'Tippe ein Feld an. Das erste Feld ist immer sicher.' };
  return { tone: '', text: S.ui.flagMode
    ? 'Flagge setzen ist an: Tippe ein verdecktes Feld an, um eine Flagge zu setzen oder wegzunehmen.'
    : 'Tippe ein verdecktes Feld an, um es aufzudecken. Langes Drücken setzt eine Flagge.' };
}

function bestLine(level) {
  const b = Number(sess.get('mn_best_' + level, 0)) || 0;
  return b > 0 ? P.fmtTime(b) : '–';
}

function endHtml(g) {
  if (g.mode !== 'won') return '';
  const r = g.result || { ms: g.elapsed, record: false, prev: 0 };
  const lines = [`<p class="big center">Deine Zeit: <b>${P.fmtTime(r.ms)}</b>${g.learn ? '' : ` (${esc(P.levelInfo(g.level).name)})`}</p>`];
  if (!g.learn) {
    if (r.record) lines.push('<p class="big center">🏅 Neue Bestzeit! 🎉</p>');
    else if (r.prev) lines.push(`<p class="center">Deine Bestzeit (${esc(P.levelInfo(g.level).name)}): <b>${P.fmtTime(r.prev)}</b></p>`);
  }
  return `<section class="card over mn-over"><div class="trophy">🏆</div><h1>Geschafft!</h1>${lines.join('')}
    <button class="btn primary huge" data-act="again">${g.learn ? '▶ Ein richtiges Feld spielen' : '▶ Neues Spiel'}</button>
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function optionsHtml(g) {
  if (S.learn) return '';
  const cur = sess.getOpts();
  const boxes = OPTIONS.map((d) => `<label class="opt"><input type="checkbox" data-opt="${d.id}" ${cur[d.id] ? 'checked' : ''}><span>${esc(d.label)}<small>${esc(d.help)}</small></span></label>`).join('');
  const note = g.mode === 'play' ? '<p class="muted small">Die Stufe gilt ab dem nächsten Spiel.</p>' : '';
  return `<section class="card optcard"><h2>Spielregeln einstellen</h2>${boxes}${note}
    <p class="muted small">Deine Bestzeiten: Leicht <b>${bestLine('leicht')}</b> · Mittel <b>${bestLine('mittel')}</b> · Schwer <b>${bestLine('schwer')}</b></p></section>`;
}

function gameHtml() {
  const g = S.game;
  const m = msgOf(g);
  return `${ui.header()}${ui.lost()}
    ${statusHtml(g)}
    ${modesHtml(g)}
    ${boardHtml(g)}
    <div class="action mn-msg"><p class="big ${m.tone}" role="status">${esc(m.text)}</p></div>
    ${endHtml(g)}${optionsHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Decke alle Felder auf, unter denen <b>keine Mine</b> liegt. Deckst du eine Mine auf, ist die Runde verloren – aber du darfst es gleich nochmal versuchen.</p>
    <h3>Die Zahlen</h3>
    <ul>
      <li>Tippe ein Feld an. Eine Zahl sagt dir, wie viele Minen in den <b>8 Feldern ringsum</b> liegen.</li>
      <li>Steht keine Zahl da, liegt ringsum keine Mine. Dann öffnen sich alle Nachbarfelder von selbst.</li>
      <li>Das erste Feld ist immer sicher. Die Minen werden erst danach verteilt.</li>
    </ul>
    <h3>Flaggen</h3>
    <ul>
      <li>Weißt du, wo eine Mine liegt, setze dort eine <b>Flagge</b> 🚩. Dann deckst du das Feld nicht aus Versehen auf.</li>
      <li>Schalte dazu oben auf <b>Flagge setzen</b> und tippe das Feld an. Nochmal tippen nimmt die Flagge weg.</li>
      <li>Oder drücke ein verdecktes Feld etwa eine halbe Sekunde lang: Das setzt auch eine Flagge, ohne umzuschalten.</li>
      <li>„Minen noch“ zeigt, wie viele Minen es gibt, minus die Flaggen, die du gesetzt hast.</li>
    </ul>
    <h3>Schnell aufdecken</h3>
    <p>Hat eine Zahl ringsum genau so viele Flaggen, wie sie sagt, tippe sie an: Alle übrigen Nachbarfelder werden aufgedeckt. Stimmt eine Flagge nicht, ist das eine Mine – Vorsicht! Du kannst das bei den Regeln ausschalten.</p>
    <h3>Stufen und Zeit</h3>
    <p>Leicht hat 8 × 8 Felder mit 8 Minen, Mittel 10 × 10 mit 15 Minen, Schwer 12 × 12 mit 28 Minen. Die Uhr läuft ab dem ersten Tipp. Das Spiel merkt sich deine beste Zeit je Stufe.</p>
    <p class="muted">Tipps gibt es keine: Du kannst jedes Feld mit Nachdenken herausfinden. Meistens zumindest. Manchmal musst du eben mutig sein.</p>
`;
}

// ====================== Bedienung ======================
function onCell(i) {
  const g = S.game;
  if (!g || (g.mode !== 'ready' && g.mode !== 'play') || !Number.isInteger(i)) return;
  if (S.ui.flagMode && !g.open[i]) return send({ t: 'flag', i });
  return send({ t: 'reveal', i });
}

const ui = createUI({
  soloOnly: true,
  sess, $app,
  options: OPTIONS,
  title: 'Minenfeld', icon: '💣', sub: 'Logikrätsel – Felder aufdecken, Minen meiden',
  helpTitle: 'So geht Minenfeld', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'cell': return onCell(Number(el.dataset.i));
      case 'mode': S.ui.flagMode = el.dataset.mode === 'flag'; S.ui.note = ''; return render();
      case 'retry': S.ui.note = ''; return send({ t: 'retry' });
    }
  },
});
function render() { ui.render(); }
ui.boot();

// Optionen ändern (Kästchen werden von ui.js gespeichert; hier die Wirkung)
$app.addEventListener('change', (ev) => {
  const id = ev.target && ev.target.dataset && ev.target.dataset.opt;
  if (!id || !S.game) return;
  if (id === 'chord') return send({ t: 'opts', chord: !!ev.target.checked });
  if (id === 'time') return render();
  if (S.game.mode === 'ready' && !S.learn) return sess.hostStartGame(); // noch kein Tipp: gleich neues Feld in der neuen Stufe
  return render();
});

// Langes Drücken auf ein verdecktes Feld setzt oder entfernt eine Flagge
let lp = null, lpFired = false, suppressUntil = 0;
const lpClear = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
$app.addEventListener('pointerdown', (ev) => {
  const b = ev.target.closest && ev.target.closest('[data-act=cell]');
  lpClear(); lpFired = false;
  if (!b || (ev.button !== undefined && ev.button > 0)) return;
  const i = Number(b.dataset.i);
  lp = { x: ev.clientX, y: ev.clientY, timer: setTimeout(() => {
    lp = null;
    const g = S.game;
    if (!g || (g.mode !== 'ready' && g.mode !== 'play') || g.open[i]) return;
    lpFired = true;
    send({ t: 'flag', i });
  }, LONG_MS) };
});
$app.addEventListener('pointermove', (ev) => { if (lp && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > 12) lpClear(); });
const lpEnd = () => { lpClear(); if (lpFired) { lpFired = false; suppressUntil = Date.now() + 150; } };
document.addEventListener('pointerup', lpEnd, true);
document.addEventListener('pointercancel', lpEnd, true);
$app.addEventListener('click', (ev) => {
  if (Date.now() < suppressUntil && ev.target.closest && ev.target.closest('#board')) { suppressUntil = 0; ev.stopPropagation(); ev.preventDefault(); }
}, true);
$app.addEventListener('contextmenu', (ev) => { if (ev.target.closest && ev.target.closest('#board')) ev.preventDefault(); });
