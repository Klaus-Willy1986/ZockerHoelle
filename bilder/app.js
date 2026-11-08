import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const OPTIONS = [
  { id: 'easy', label: 'Leicht (5×5)', def: false },
  { id: 'hard', label: 'Schwer (10×10)', def: false, help: 'Ohne Häkchen: Mittel (8×8). Sind beide angekreuzt, gilt Schwer.' },
  { id: 'live', label: 'Beim Malen prüfen', def: false, help: 'Erfüllte Zahlen am Rand werden sofort grau.' },
];
const freshUi = () => ({ mode: 'fill', msg: null, newPanel: false, showTime: true, coachSeen: {}, seqSeen: -1 });
const GEO = { 5: { cs: 52, rcw: 62, cch: 84 }, 8: { cs: 38, rcw: 74, cch: 106 }, 10: { cs: 30, rcw: 76, cch: 106 } };

// Für Tests: ?seed=N erzeugt immer dieselben Rätsel
function makeRng() {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '' || !Number.isFinite(Number(raw))) return Math.random;
  let a = (Number(raw) >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = makeRng();

const sess = createSession({
  game: 'bd',
  maxPlayers: 1,
  newGame: (players) => {
    const learnStart = !!S.learn && !S.game; // erste Partie der Lernrunde
    if (S.learn && S.game) S.learn = false; // „Richtiges Rätsel spielen“ beendet die Lernrunde
    resetPlay();
    return P.createGame(players, { learn: learnStart });
  },
  onMessage: (state, pid, msg) => {
    const r = P.apply(state, pid, msg, rng);
    if (!r.ok) { S.ui.msg = { tone: 'warn', text: r.error }; render(); return; }
    S.ui.msg = null;
    if (msg.t === 'new') resetPlay();
    if (state.mode === 'over' && state.result && state.result.record === null) {
      if (state.level === 'lern') { state.result.record = false; return; }
      const key = 'bd_best_' + P.sizeKey(state.level);
      const prev = sess.get(key, 0);
      const b = P.settleResult(state, prev);
      if (b && b.record) sess.set(key, b.best);
    }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi(), settings()); },
});
const S = sess.S;
const settings = () => ({ showTime: sess.get('bd_time', true) !== false });
S.ui = Object.assign(freshUi(), settings());
const live = () => !!sess.getOpts().live;

function resetPlay() {
  Object.assign(S.ui, { mode: 'fill', msg: null, newPanel: false });
}

// ====================== Uhr (nur im App-Teil, nicht im Spielzustand) ======================
const clk = { seq: -1, base: 0, since: null };
const visible = () => document.visibilityState !== 'hidden';
const nowMs = () => clk.base + (clk.since != null ? Date.now() - clk.since : 0);
function clockSync(g) {
  if (!g || g.mode !== 'play') { clk.since = null; clk.seq = -1; return; }
  if (clk.seq !== g.seq) { clk.seq = g.seq; clk.base = g.elapsed || 0; clk.since = visible() ? Date.now() : null; }
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
  const el = document.getElementById('bd-clock');
  if (el) el.textContent = S.ui.showTime ? P.fmtTime(nowMs()) : '––:––';
}, 500);
const go = (msg) => sess.send({ ...msg, ms: nowMs() });

function onStateChanged() {
  const g = S.game;
  clockSync(g);
  if (g && g.seq !== S.ui.seqSeen) { S.ui.seqSeen = g.seq; if (g.mode === 'play') resetPlay(); }
  render();
}

// ====================== Darstellung ======================
const hueOf = (id) => { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

function picHtml(g) {
  const n = g.n, hue = hueOf(g.img);
  const cells = Array.from({ length: n * n }, (_, i) => {
    if (g.sol[i] !== '1') return '<i></i>';
    const r = Math.floor(i / n), c = i % n;
    const h = (hue + r * 9 + c * 5) % 360, l = 42 + Math.round((r / n) * 16);
    return `<i style="background:hsl(${h},72%,${l}%)"></i>`;
  }).join('');
  return `<div class="bd-wrap"><div id="board" class="bd-pic" style="--n:${n}" role="img" aria-label="Das fertige Bild: ${esc(g.name)}">${cells}</div></div>`;
}

function boardHtml(g) {
  const n = g.n, geo = GEO[n];
  const lv = live();
  const chk = g.check;
  const wrong = new Set(chk ? chk.wrong : []);
  const clueCls = (kind, k) => {
    if (chk && (kind === 'r' ? chk.rows : chk.cols).includes(k)) return ' err';
    if ((lv || chk) && P.lineOk(g, kind, k)) return ' ok';
    return '';
  };
  const clueTxt = (c) => (c.length === 1 && c[0] === 0 ? 'keine' : c.join(', '));
  let html = '<div class="bd-corner" aria-hidden="true"></div>';
  for (let c = 0; c < n; c++) {
    const cls = clueCls('c', c);
    html += `<div class="bd-cc${cls}" data-cc="${c}" role="img" aria-label="Spalte ${c + 1}: ${clueTxt(g.cols[c])}${cls === ' ok' ? ', erfüllt' : cls === ' err' ? ', Fehler' : ''}">${g.cols[c].map((x) => `<b>${x}</b>`).join('')}<i class="bd-ck" aria-hidden="true">✓</i></div>`;
  }
  for (let r = 0; r < n; r++) {
    const cls = clueCls('r', r);
    html += `<div class="bd-rc${cls}" data-rc="${r}" role="img" aria-label="Zeile ${r + 1}: ${clueTxt(g.rows[r])}${cls === ' ok' ? ', erfüllt' : cls === ' err' ? ', Fehler' : ''}"><span class="bd-nums">${g.rows[r].map((x) => `<b>${x}</b>`).join('')}</span><i class="bd-ck" aria-hidden="true">✓</i></div>`;
    for (let c = 0; c < n; c++) {
      const i = r * n + c, v = g.cells[i];
      const k = ['bd-c'];
      if (v === 1) k.push('f'); else if (v === 2) k.push('x');
      if (g.revealed.includes(i)) k.push('rev');
      if (wrong.has(i)) k.push('wrong');
      if (c === n - 1) k.push('lc');
      if (r === n - 1) k.push('lr');
      if (n === 10 && c === 5) k.push('gl');
      if (n === 10 && r === 5) k.push('gt');
      let label = `Zeile ${r + 1}, Spalte ${c + 1}: ${v === 1 ? 'ausgemalt' : v === 2 ? 'als leer markiert' : 'leer'}`;
      if (g.revealed.includes(i)) label += ', aufgedeckt';
      if (wrong.has(i)) label += ', passt nicht zur Lösung';
      html += `<button class="${k.join(' ')}" data-cell="${i}" aria-label="${label}">${v === 2 ? '✕' : ''}</button>`;
    }
  }
  return `<div class="bd-wrap"><div id="board" class="bd-board bd-n${n}" style="--n:${n};--cs:${geo.cs}px;--rcw:${geo.rcw}px;--cch:${geo.cch}px" aria-label="Bilderrätsel-Raster">${html}</div></div>`;
}

function statusHtml(g) {
  const t = S.ui.showTime ? P.fmtTime(nowMs()) : '––:––';
  let note = { tone: '', text: `${P.filledCount(g)} von ${g.total} Feldern` };
  if (g.check) {
    note = g.check.wrong.length
      ? { tone: 'warn', text: g.check.wrong.length === 1 ? '1 Feld passt nicht' : `${g.check.wrong.length} Felder passen nicht` }
      : { tone: 'ok', text: 'Alles passt bisher' };
  }
  return `<div class="bd-status"><span class="bd-lvl">${esc(P.levelName(g.level))}</span>
    <span class="bd-clock" aria-label="Zeit">⏱ <span id="bd-clock">${t}</span></span>
    <span class="bd-left ${note.tone}">${note.text}</span></div>`;
}

function hintText(g) {
  if (S.ui.msg) return { tone: S.ui.msg.tone || '', text: S.ui.msg.text };
  if (g.check) {
    return g.check.wrong.length
      ? { tone: 'warn', text: g.check.wrong.length === 1 ? 'Ein Feld passt nicht zur Lösung. Es ist rot, ebenso die Zahlen seiner Zeile und Spalte.' : `${g.check.wrong.length} Felder passen nicht zur Lösung. Sie sind rot, ebenso die Zahlen ihrer Zeilen und Spalten.` }
      : { tone: 'ok', text: 'Bis jetzt stimmt alles. Ein Häkchen bei den Zahlen heißt: Diese Reihe passt.' };
  }
  return { tone: '', text: S.ui.mode === 'cross' ? 'Leer markieren: Tippe auf Felder, die sicher leer bleiben. Es erscheint ein Kreuz.' : 'Ausmalen: Tippe auf ein Feld oder ziehe den Finger über mehrere Felder.' };
}

function modesHtml() {
  const m = S.ui.mode;
  return `<div class="bd-modes" role="group" aria-label="Was tippst du?">
    <button class="btn bd-mode${m === 'fill' ? ' on' : ''}" data-act="mode-fill" aria-pressed="${m === 'fill'}">■ Ausmalen</button>
    <button class="btn bd-mode${m === 'cross' ? ' on' : ''}" data-act="mode-cross" aria-pressed="${m === 'cross'}">✕ Leer markieren</button></div>`;
}

function toolsHtml(g) {
  const canReveal = g.cells.some((x, i) => (g.sol[i] === '1' && x !== 1) || (g.sol[i] === '0' && x === 1));
  const canClear = g.cells.some((x, i) => x && !P.isLocked(g, i));
  return `<div class="bd-tools">
      <button class="btn bd-tool" data-act="check">✔ Prüfen</button>
      <button class="btn bd-tool" data-act="undo" ${g.hist.length ? '' : 'disabled'}>↶ Zurück</button>
      <button class="btn bd-tool" data-act="clear" ${canClear ? '' : 'disabled'}>Alles leeren</button>
      <button class="btn bd-tool" data-act="reveal" ${canReveal ? '' : 'disabled'}>💡 Aufdecken: ein Feld</button>
    </div>`;
}

function settingsHtml() {
  const o = sess.getOpts();
  return `<section class="card optcard bd-opts"><label class="opt"><input type="checkbox" data-opt="live" ${o.live ? 'checked' : ''}><span>Beim Malen prüfen<small>Erfüllte Zahlen am Rand werden sofort grau.</small></span></label>
    <label class="opt"><input type="checkbox" data-bdtime ${S.ui.showTime ? 'checked' : ''}><span>Zeit anzeigen</span></label></section>`;
}

function chooseCard(title, g, extra) {
  const o = sess.getOpts();
  const lv = P.levelOf(P.levelFromOpts(o));
  const best = sess.get('bd_best_' + lv.n, 0);
  return `<section class="card optcard bd-choose"><h2>${title}</h2>
    ${extra || ''}
    ${OPTIONS.map((d) => `<label class="opt"><input type="checkbox" data-opt="${d.id}" ${o[d.id] ? 'checked' : ''}><span>${esc(d.label)}${d.help ? `<small>${esc(d.help)}</small>` : ''}</span></label>`).join('')}
    <p class="bd-now">Gewählt: ${esc(lv.name)} (${esc(lv.text)})</p>
    <p class="muted">${best ? `Deine Bestzeit: ${P.fmtTime(best)}` : 'Noch keine Bestzeit in dieser Größe.'}</p>
    <button class="btn primary huge" data-act="start-puzzle">▶ Rätsel erstellen</button>
    ${g.mode === 'play' ? `<button class="btn ghost" data-act="new-cancel">Zurück zum Rätsel</button>` : ''}
  </section>`;
}

function chooseHtml(g) {
  return `${headerHtml()}${lostHtml()}${chooseCard('Welches Rätsel möchtest du lösen?', g, '<p class="muted">Male Felder aus, bis alle Zahlen stimmen. Dabei entsteht ein Bild. Setze Häkchen, wenn du es kleiner oder größer magst.</p>')}`;
}

function newPanelHtml(g) {
  const warn = `<p class="warn">Dein jetziges Bild ist noch nicht fertig. Es geht verloren, wenn du ein neues beginnst.</p>`;
  return `${headerHtml()}${lostHtml()}${chooseCard('Neues Rätsel', g, warn)}`;
}

function playHtml(g) {
  const h = hintText(g);
  return `${headerHtml()}${lostHtml()}
    ${statusHtml(g)}
    ${modesHtml()}
    ${boardHtml(g)}
    <div class="action"><p class="big bd-msg ${h.tone}" role="status">${esc(h.text)}</p></div>
    ${toolsHtml(g)}
    ${settingsHtml()}
    ${S.learn ? '' : `<button class="btn ghost" data-act="new-open">Neues Rätsel</button>`}`;
}

function overHtml(g) {
  const r = g.result || { ms: g.elapsed, level: g.level, n: g.n, hints: g.hints, checks: g.checks, mistakes: 0, record: false, prev: 0, name: g.name, art: g.art };
  const lern = r.level === 'lern';
  const best = lern ? 0 : (r.record ? r.ms : (r.prev || sess.get('bd_best_' + r.n, 0)));
  const title = `Das ist ${r.art || 'ein'} ${r.name}!`;
  const lines = [];
  lines.push(`<p class="big center">Deine Zeit: <b>${P.fmtTime(r.ms)}</b>${lern ? '' : ` (${esc(P.levelName(r.level))}, ${r.n}×${r.n})`}</p>`);
  if (!lern) {
    if (r.record) lines.push(`<p class="big center">🏅 Neue Bestzeit! 🎉</p>`);
    else if (r.hints > 0) lines.push(`<p class="center">Mit aufgedeckten Feldern zählt die Zeit nicht für die Bestzeit.${best ? ` Deine Bestzeit: <b>${P.fmtTime(best)}</b>` : ''}</p>`);
    else if (best) lines.push(`<p class="center">Deine Bestzeit (${r.n}×${r.n}): <b>${P.fmtTime(best)}</b></p>`);
  }
  const helpTxt = r.hints > 0 ? `Aufgedeckte Felder: ${r.hints}` : 'Ohne Hilfen gelöst';
  lines.push(`<p class="center">${helpTxt}</p>`);
  if (r.checks > 0) lines.push(`<p class="center">Du hast ${r.checks === 1 ? 'einmal' : r.checks + '-mal'} geprüft.</p>`);
  const speak = `Geschafft! ${title} Deine Zeit: ${P.fmtTime(r.ms)}. ${helpTxt}.${r.record ? ' Neue Bestzeit!' : ''}`;
  return `${headerHtml()}${lostHtml()}
    ${picHtml(g)}
    <div class="banner done">Geschafft!</div>
    <div class="action"><p class="big bd-sr" style="position:absolute;left:-9999px">${esc(speak)}</p></div>
    <section class="card over"><div class="trophy">🏆</div><h1 class="center">Geschafft! ${esc(title)}</h1>${lines.join('')}
      <button class="btn primary huge" data-act="again">${lern ? '▶ Ein richtiges Rätsel spielen' : '▶ Noch ein Rätsel'}</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'choose') return chooseHtml(g);
  if (g.mode === 'over') return overHtml(g);
  if (S.ui.newPanel) return newPanelHtml(g);
  return playHtml(g);
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Male Felder aus, sodass alle Zahlen am Rand stimmen. Dabei entsteht ein Bild. Welches, siehst du erst am Ende.</p>
    <h3>Die Zahlen lesen</h3>
    <ul>
      <li>Links neben jeder Zeile und über jeder Spalte stehen Zahlen.</li>
      <li>Eine Zahl sagt, wie viele Felder <b>direkt nebeneinander</b> ausgemalt werden. Die 3 heißt: drei ausgemalte Felder in einer Reihe.</li>
      <li>Stehen mehrere Zahlen da, zum Beispiel 2 und 1, gibt es mehrere Reihen, in dieser Reihenfolge. Dazwischen bleibt mindestens ein Feld frei.</li>
      <li>Wo nicht ausgemalt wird, bleibt das Feld leer.</li>
    </ul>
    <h3>So bedienst du das Spiel</h3>
    <ol>
      <li>Oben wählst du, was ein Tipp macht: <b>Ausmalen</b> oder <b>Leer markieren</b>.</li>
      <li>Tippe auf ein Feld: Es wird ausgemalt. Tippst du nochmal, ist es wieder leer.</li>
      <li>Bei <b>Leer markieren</b> bekommt das Feld ein Kreuz. Das ist nur eine Gedächtnisstütze für Felder, die sicher leer bleiben.</li>
      <li>Du kannst auch den Finger über mehrere Felder in einer Zeile oder Spalte ziehen. Dann werden alle auf einmal ausgemalt.</li>
      <li>Mit <b>Zurück</b> machst du den letzten Schritt ungeschehen, so oft du willst. <b>Alles leeren</b> räumt das Raster auf.</li>
    </ol>
    <h3>Prüfen und Hilfen</h3>
    <p>Mit <b>Prüfen</b> werden Felder rot, die nicht zur Lösung passen. Bei Reihen, die schon stimmen, erscheint ein Häkchen. Das Häkchen <b>Beim Malen prüfen</b> macht Zahlen sofort grau, sobald ihre Reihe stimmt. <b>Aufdecken</b> zeigt dir ein Feld. Das wird gezählt, und mit Hilfe zählt die Zeit nicht für die Bestzeit.</p>
    <h3>Das Ende</h3>
    <p>Stimmen alle Zahlen, bist du fertig. Du siehst das Bild in Farbe, seinen Namen, deine Zeit und deine Bestzeit. Jedes Rätsel hat genau eine Lösung. Du musst nie raten: Man kann alles Schritt für Schritt herausfinden. Mit „Neues Rätsel“ wählst du Leicht (5×5), Mittel (8×8) oder Schwer (10×10).</p>
`;
}

// ====================== Malen: Tippen und Ziehen ======================
let drag = null;
const cellIdx = (el) => { const b = el && el.closest ? el.closest('[data-cell]') : null; return b ? Number(b.dataset.cell) : -1; };
const previewClear = () => $app.querySelectorAll('.bd-c.pv').forEach((n) => n.classList.remove('pv'));
function tapAt(g, i) {
  if (g.mode !== 'play') return;
  if (P.isLocked(g, i)) { S.ui.msg = { tone: 'warn', text: 'Dieses Feld wurde aufgedeckt und ist fest.' }; return render(); }
  go({ t: 'set', i, v: P.tapValue(g.cells[i], S.ui.mode) });
}
$app.addEventListener('pointerdown', (ev) => {
  const g = S.game;
  if (!g || g.mode !== 'play' || S.ui.helpOpen || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  const i = cellIdx(ev.target);
  if (i < 0) return;
  const v = P.tapValue(g.cells[i], S.ui.mode);
  drag = { cells: [i], axis: null, v, from: g.cells[i], n: g.n };
  const el = $app.querySelector(`[data-cell="${i}"]`);
  if (el) el.classList.add('pv');
});
window.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const i = cellIdx(document.elementFromPoint(ev.clientX, ev.clientY));
  if (i < 0 || drag.cells.includes(i)) return;
  const g = S.game;
  if (!g || P.isLocked(g, i)) return;
  const n = drag.n, r0 = Math.floor(drag.cells[0] / n), c0 = drag.cells[0] % n, r = Math.floor(i / n), c = i % n;
  if (!drag.axis) { if (r === r0) drag.axis = 'r'; else if (c === c0) drag.axis = 'c'; else return; }
  if ((drag.axis === 'r' && r !== r0) || (drag.axis === 'c' && c !== c0)) return;
  // Schnelles Wischen überspringt Felder: alle Felder zwischen dem letzten und diesem dazunehmen
  const last = drag.cells[drag.cells.length - 1];
  const step = (drag.axis === 'r' ? 1 : n) * (i > last ? 1 : -1);
  for (let j = last + step; j !== i + step; j += step) {
    if (drag.cells.includes(j) || P.isLocked(g, j)) continue;
    drag.cells.push(j);
    const el = $app.querySelector(`[data-cell="${j}"]`);
    if (el) el.classList.add('pv');
  }
});
function endDrag(ev, commit) {
  if (!drag) return;
  const d = drag; drag = null;
  previewClear();
  const g = S.game;
  if (!commit || !g || g.mode !== 'play') return;
  if (d.cells.length === 1) return tapAt(g, d.cells[0]);
  go(d.v === 0 ? { t: 'paint', cells: d.cells, v: 0, from: d.from } : { t: 'paint', cells: d.cells, v: d.v });
}
window.addEventListener('pointerup', (ev) => endDrag(ev, true));
window.addEventListener('pointercancel', (ev) => endDrag(ev, false));
// Tastatur: Enter oder Leertaste auf einem Feld (Klick ohne Zeiger)
$app.addEventListener('click', (ev) => {
  if (ev.detail !== 0) return;
  const i = cellIdx(ev.target);
  if (i >= 0 && S.game) tapAt(S.game, i);
});

// ====================== Bedienung ======================
const ui = createUI({
  soloOnly: true,
  sess, $app,
  title: 'Bilderrätsel', icon: '🖼️', sub: 'Male nach Zahlen – und entdecke das Bild',
  options: OPTIONS,
  helpTitle: 'So geht das Bilderrätsel', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'start-puzzle': return go({ t: 'new', level: P.levelFromOpts(sess.getOpts()) });
      case 'mode-fill': S.ui.mode = 'fill'; S.ui.msg = null; return render();
      case 'mode-cross': S.ui.mode = 'cross'; S.ui.msg = null; return render();
      case 'undo': return go({ t: 'undo' });
      case 'clear': return go({ t: 'clear' });
      case 'check': return go({ t: 'check' });
      case 'reveal': return go({ t: 'reveal' });
      case 'new-open': S.ui.newPanel = true; return render();
      case 'new-cancel': S.ui.newPanel = false; return render();
    }
  },
});
function render() { ui.render(); if (S.learn) keepTargetVisible(); }
// Lernrunde: das leuchtende Ziel soll unterhalb der Anleitung sichtbar sein
function keepTargetVisible() {
  const t = document.querySelector('.coach-target');
  if (!t || t.closest('.coach')) return;
  const co = document.querySelector('.coach');
  const top = co ? co.getBoundingClientRect().bottom : 0;
  const r = t.getBoundingClientRect();
  if (r.top < top + 4 || r.bottom > window.innerHeight - 4) window.scrollBy(0, r.top + r.height / 2 - (top + window.innerHeight) / 2);
}
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
// Kästchen: ui.js speichert die Regeloptionen; hier wird danach nur neu gezeichnet
$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t || !t.dataset) return;
  if (t.dataset.opt) render();
  else if ('bdtime' in t.dataset) { S.ui.showTime = !!t.checked; sess.set('bd_time', S.ui.showTime); render(); }
});
