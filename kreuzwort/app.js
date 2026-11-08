import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach, LEARN_PUZZLE } from './tutorial.js';

const $app = document.getElementById('app');
const OPTIONS = [
  { id: 'easy', label: 'Leicht (10 Wörter, kurze Wörter)', def: false },
  { id: 'hard', label: 'Schwer (16 Wörter)', def: false, help: 'Ohne Häkchen: Mittel mit 13 Wörtern. Sind beide angekreuzt, gilt Leicht.' },
  { id: 'live', label: 'Beim Eintippen prüfen', def: false, help: 'Falsche Buchstaben werden sofort rot.' },
];
const freshUi = () => ({ sel: -1, dir: 'h', msg: null, newPanel: false, showTime: true, coachSeen: {}, seqSeen: -1 });

// Für Tests: ?seed=N erzeugt immer dieselben Rätsel
function makeRng() {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '' || !Number.isFinite(Number(raw))) return Math.random;
  let a = (Number(raw) >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = makeRng();

const sess = createSession({
  game: 'kw',
  maxPlayers: 1,
  newGame: (players) => {
    const learnStart = !!S.learn && !S.game; // erste Partie der Lernrunde
    if (S.learn && S.game) S.learn = false; // „Richtiges Rätsel spielen“ beendet die Lernrunde
    resetPlay();
    return P.createGame(players, { learn: learnStart, puzzle: LEARN_PUZZLE });
  },
  onMessage: (state, pid, msg) => {
    const r = P.apply(state, pid, msg, rng);
    if (!r.ok) { S.ui.msg = { tone: 'warn', text: r.error }; render(); return; }
    S.ui.msg = null;
    if (msg.t === 'new') resetPlay();
    if (state.mode === 'over' && state.result && state.result.record === null) {
      if (state.level === 'lern') { state.result.record = false; return; }
      const prev = sess.get('kw_best_' + state.level, 0);
      const b = P.settleResult(state, prev);
      if (b && b.record) sess.set('kw_best_' + state.level, b.best);
    }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi(), settings()); },
});
const S = sess.S;
const settings = () => ({ showTime: sess.get('kw_time', true) !== false });
S.ui = Object.assign(freshUi(), settings());
const live = () => !!sess.getOpts().live;

function resetPlay() {
  Object.assign(S.ui, { sel: -1, dir: 'h', msg: null, newPanel: false });
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
  const el = document.getElementById('kw-clock');
  if (el) el.textContent = S.ui.showTime ? P.fmtTime(nowMs()) : '––:––';
}, 500);
const go = (msg) => sess.send({ ...msg, ms: nowMs() });

function onStateChanged() {
  const g = S.game;
  clockSync(g);
  if (g && g.seq !== S.ui.seqSeen) { S.ui.seqSeen = g.seq; if (g.mode === 'play') resetPlay(); }
  render();
}

// ====================== Auswahl und Cursor ======================
const curWord = (g) => (S.ui.sel >= 0 ? P.wordAt(g, S.ui.sel, S.ui.dir) : null);
function selectCell(g, i) {
  const h = P.wordAt(g, i, 'h'), v = P.wordAt(g, i, 'v');
  if (!h && !v) return;
  if (S.ui.sel === i && h && v) S.ui.dir = S.ui.dir === 'h' ? 'v' : 'h';
  else if (!(S.ui.dir === 'h' ? h : v)) S.ui.dir = h ? 'h' : 'v';
  S.ui.sel = i;
  S.ui.msg = null;
}
function selectWord(g, w) {
  const cells = P.wordCells(g, w);
  const first = cells.find((i) => g.cells[i] !== g.sol[i]);
  S.ui.dir = w.d;
  S.ui.sel = first !== undefined ? first : cells[0];
  S.ui.msg = null;
}
// Nach einem Buchstaben: nächstes leeres Feld des Wortes, sonst das nächste Feld; am Wortende bleibt der Cursor stehen
function advance(g) {
  const w = curWord(g);
  if (!w || g.mode !== 'play') return;
  const cells = P.wordCells(g, w);
  const k = cells.indexOf(S.ui.sel);
  let j = -1;
  for (let x = k + 1; x < cells.length; x++) if (g.cells[cells[x]] === '') { j = x; break; }
  if (j < 0 && k + 1 < cells.length) j = k + 1;
  if (j >= 0) S.ui.sel = cells[j];
}
function typeLetter(ch) {
  const g = S.game;
  if (!g || g.mode !== 'play') return;
  if (S.ui.sel < 0) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst ein Feld im Gitter an.' }; return render(); }
  if (!P.isLocked(g, S.ui.sel)) go({ t: 'put', i: S.ui.sel, ch });
  advance(S.game);
  render();
}
function eraseLetter() {
  const g = S.game;
  if (!g || g.mode !== 'play') return;
  if (S.ui.sel < 0) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst ein Feld im Gitter an.' }; return render(); }
  if (g.cells[S.ui.sel] && !P.isLocked(g, S.ui.sel)) go({ t: 'erase', i: S.ui.sel });
  else {
    const w = curWord(g);
    if (w) {
      const cells = P.wordCells(g, w);
      const k = cells.indexOf(S.ui.sel);
      if (k > 0) {
        S.ui.sel = cells[k - 1];
        if (g.cells[S.ui.sel] && !P.isLocked(g, S.ui.sel)) go({ t: 'erase', i: S.ui.sel });
      }
    }
  }
  render();
}
function stepWord(delta) {
  const g = S.game;
  if (!g || g.mode !== 'play') return;
  const w = P.stepWord(g, curWord(g), delta);
  if (w) selectWord(g, w);
  render();
}
function moveBy(dr, dc) {
  const g = S.game;
  if (!g || g.mode !== 'play') return;
  if (S.ui.sel < 0) { const w = g.words[0]; if (w) selectWord(g, w); return render(); }
  const r = Math.floor(S.ui.sel / g.cols) + dr, c = (S.ui.sel % g.cols) + dc;
  if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return;
  const i = r * g.cols + c;
  if (g.sol[i] === '#') return;
  S.ui.dir = dr ? 'v' : 'h';
  if (!P.wordAt(g, i, S.ui.dir)) S.ui.dir = dr ? 'h' : 'v';
  S.ui.sel = i; S.ui.msg = null;
  render();
}

document.addEventListener('keydown', (ev) => {
  const g = S.game;
  if (!g || S.screen !== 'game' || g.mode !== 'play' || S.ui.helpOpen || S.ui.newPanel) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const k = ev.key;
  if (/^[a-zA-Z]$/.test(k)) { ev.preventDefault(); typeLetter(k.toUpperCase()); return; }
  if (k === 'Backspace' || k === 'Delete') { ev.preventDefault(); eraseLetter(); return; }
  if (k === 'Tab' || k === 'Enter') { ev.preventDefault(); stepWord(ev.shiftKey ? -1 : 1); return; }
  const dirs = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (dirs[k]) { ev.preventDefault(); moveBy(dirs[k][0], dirs[k][1]); }
});

// ====================== Darstellung ======================
function boardHtml(g, readonly) {
  const w = readonly ? null : curWord(g);
  const inw = new Set(w ? P.wordCells(g, w) : []);
  const sel = readonly ? -1 : S.ui.sel;
  const wrong = new Set(readonly ? [] : (live() ? P.wrongCells(g) : (g.check ? g.check.wrong : [])));
  const numAt = {};
  for (const x of g.words) numAt[x.r * g.cols + x.c] = x.n;
  const cells = g.cells.map((v, i) => {
    if (g.sol[i] === '#') return `<div class="kw-c blk" aria-hidden="true"></div>`;
    const cls = ['kw-c'];
    const rev = g.revealed.includes(i);
    if (rev) cls.push('rev'); else if (v) cls.push('mine');
    if (inw.has(i)) cls.push('inw');
    if (i === sel) cls.push('sel');
    if (wrong.has(i)) cls.push('wrong');
    const r = Math.floor(i / g.cols) + 1, c = (i % g.cols) + 1;
    let label = `Zeile ${r}, Spalte ${c}`;
    if (numAt[i]) label += `, Nummer ${numAt[i]}`;
    label += v ? `, Buchstabe ${v}${rev ? ', aufgedeckt' : ''}` : ', leer';
    if (wrong.has(i)) label += ', falsch';
    if (i === sel) label += ', ausgewählt';
    const inner = `${numAt[i] ? `<span class="kw-n">${numAt[i]}</span>` : ''}${v ? `<span class="kw-v">${v}</span>` : ''}`;
    if (readonly) return `<div class="${cls.join(' ')}" role="img" aria-label="${label}">${inner}</div>`;
    return `<button class="${cls.join(' ')}" data-act="cell" data-i="${i}" aria-label="${label}" aria-pressed="${i === sel}">${inner}</button>`;
  }).join('');
  return `<div class="kw-wrap"><div id="board" class="kw-board${readonly ? ' ro' : ''}" style="--cols:${g.cols}" aria-label="Kreuzworträtsel-Gitter">${cells}</div></div>`;
}

function statusHtml(g) {
  const left = P.emptyCount(g);
  const t = S.ui.showTime ? P.fmtTime(nowMs()) : '––:––';
  let note = { tone: '', text: left === 1 ? 'Noch 1 Feld' : `Noch ${left} Felder` };
  const wrong = live() ? P.wrongCells(g) : (g.check ? g.check.wrong : null);
  if (wrong) {
    if (wrong.length) note = { tone: 'warn', text: wrong.length === 1 ? '1 Buchstabe falsch' : `${wrong.length} Buchstaben falsch` };
    else if (g.check) note = { tone: 'ok', text: 'Alles richtig bisher' };
  }
  return `<div class="kw-status"><span class="kw-lvl">${esc(P.levelName(g.level))}</span>
    <span class="kw-clock" aria-label="Zeit">⏱ <span id="kw-clock">${t}</span></span>
    <span class="kw-left ${note.tone}">${note.text}</span></div>`;
}

function clueHtml(g) {
  if (S.ui.msg) return `<p class="big kw-clue warn" role="status">${esc(S.ui.msg.text)}</p>`;
  const w = curWord(g);
  if (!w) return `<p class="big kw-clue idle" role="status">Tippe ein Feld im Gitter an. Dann siehst du hier den Hinweis.</p>`;
  return `<p class="big kw-clue" role="status">${esc(P.clueText(w))}</p>`;
}

const KEY_ROWS = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ'];
function dockHtml(g) {
  const keys = KEY_ROWS.map((row) => Array.from(row, (ch) => `<button class="kw-key" data-act="key" data-ch="${ch}" aria-label="Buchstabe ${ch}">${ch}</button>`).join('')).join('') + `<button class="kw-key del" data-act="erase" aria-label="Löschen">⌫</button>`;
  return `<div class="kw-dock">
    <div class="action kw-cluerow"><button class="kw-nav" data-act="prev-word" aria-label="Zurück zum vorigen Wort">◀</button>${clueHtml(g)}<button class="kw-nav" data-act="next-word" aria-label="Weiter zum nächsten Wort">▶</button></div>
    <div class="kw-keys">${keys}</div></div>`;
}

function listsHtml(g) {
  const cur = curWord(g);
  const item = (w) => `<li><button class="kw-item${cur && cur.n === w.n && cur.d === w.d ? ' cur' : ''}" data-act="pick-word" data-n="${w.n}" data-d="${w.d}"><b>${w.n}</b><span>${esc(w.q)} (${w.len})</span></button></li>`;
  const col = (d, title) => `<div><h3>${title}</h3><ul>${g.words.filter((w) => w.d === d).map(item).join('')}</ul></div>`;
  return `<section class="kw-lists" aria-label="Hinweise">${col('h', 'Waagerecht')}${col('v', 'Senkrecht')}</section>`;
}

function toolsHtml(g) {
  const sel = S.ui.sel;
  const canLetter = sel >= 0 && g.cells[sel] !== g.sol[sel];
  const w = curWord(g);
  const canWord = !!w && P.wordCells(g, w).some((i) => g.cells[i] !== g.sol[i]);
  return `<div class="kw-tools">
      <button class="btn kw-tool" data-act="check">✔ Prüfen</button>
      <button class="btn kw-tool" data-act="revealL" ${canLetter ? '' : 'disabled'}>💡 Buchstabe aufdecken</button>
      <button class="btn kw-tool" data-act="revealW" ${canWord ? '' : 'disabled'}>💡 Wort aufdecken</button>
    </div>`;
}

function settingsHtml() {
  const o = sess.getOpts();
  return `<section class="card optcard kw-opts"><label class="opt"><input type="checkbox" data-opt="live" ${o.live ? 'checked' : ''}><span>Beim Eintippen prüfen<small>Falsche Buchstaben werden sofort rot.</small></span></label>
    <label class="opt"><input type="checkbox" data-kwtime ${S.ui.showTime ? 'checked' : ''}><span>Zeit anzeigen</span></label></section>`;
}

function chooseCard(title, g, extra) {
  const o = sess.getOpts();
  const lv = P.levelOf(P.levelFromOpts(o));
  const best = sess.get('kw_best_' + lv.id, 0);
  return `<section class="card optcard kw-choose"><h2>${title}</h2>
    ${extra || ''}
    ${OPTIONS.map((d) => `<label class="opt"><input type="checkbox" data-opt="${d.id}" ${o[d.id] ? 'checked' : ''}><span>${esc(d.label)}${d.help ? `<small>${esc(d.help)}</small>` : ''}</span></label>`).join('')}
    <p class="kw-now">Gewählt: ${esc(lv.name)} (${esc(lv.text)})</p>
    <p class="muted">${best ? `Deine Bestzeit: ${P.fmtTime(best)}` : 'Noch keine Bestzeit in dieser Stufe.'}</p>
    <button class="btn primary huge" data-act="start-puzzle">▶ Rätsel erstellen</button>
    ${g.mode === 'play' ? `<button class="btn ghost" data-act="new-cancel">Zurück zum Rätsel</button>` : ''}
  </section>`;
}

function chooseHtml(g) {
  return `${headerHtml()}${lostHtml()}${chooseCard('Welches Rätsel möchtest du lösen?', g, '<p class="muted">Setze Häkchen, wenn du es leichter oder schwerer magst. Du kannst jederzeit ein neues Rätsel beginnen.</p>')}`;
}

function newPanelHtml(g) {
  const warn = `<p class="warn">Dein jetziges Rätsel ist noch nicht fertig. Es geht verloren, wenn du ein neues beginnst.</p>`;
  return `${headerHtml()}${lostHtml()}${chooseCard('Neues Rätsel', g, warn)}`;
}

function playHtml(g) {
  return `${headerHtml()}${lostHtml()}
    ${statusHtml(g)}
    ${boardHtml(g, false)}
    ${toolsHtml(g)}
    ${listsHtml(g)}
    ${settingsHtml()}
    ${S.learn ? '' : `<button class="btn ghost" data-act="new-open">Neues Rätsel</button>`}
    ${dockHtml(g)}`;
}

function overHtml(g) {
  const r = g.result || { ms: g.elapsed, level: g.level, hints: g.hints, helpLetters: g.helpLetters || 0, helpWords: g.helpWords || 0, checks: g.checks, mistakes: 0, record: false, prev: 0 };
  const lern = r.level === 'lern';
  const best = lern ? 0 : (r.record ? r.ms : (r.prev || sess.get('kw_best_' + r.level, 0)));
  const lines = [];
  lines.push(`<p class="big center">Deine Zeit: <b>${P.fmtTime(r.ms)}</b>${lern ? '' : ` (${esc(P.levelName(r.level))})`}</p>`);
  if (!lern) {
    if (r.record) lines.push(`<p class="big center">🏅 Neue Bestzeit! 🎉</p>`);
    else if (r.hints > 0) lines.push(`<p class="center">Mit Hilfen zählt die Zeit nicht für die Bestzeit.${best ? ` Deine Bestzeit: <b>${P.fmtTime(best)}</b>` : ''}</p>`);
    else if (best) lines.push(`<p class="center">Deine Bestzeit (${esc(P.levelName(r.level))}): <b>${P.fmtTime(best)}</b></p>`);
  }
  let helpTxt = 'Ohne Hilfen gelöst';
  if (r.hints > 0) {
    const parts = [];
    if (r.helpLetters) parts.push(r.helpLetters === 1 ? '1-mal Buchstabe aufdecken' : `${r.helpLetters}-mal Buchstabe aufdecken`);
    if (r.helpWords) parts.push(r.helpWords === 1 ? '1-mal Wort aufdecken' : `${r.helpWords}-mal Wort aufdecken`);
    helpTxt = `Hilfen: ${r.hints} (${parts.join(', ')})`;
  }
  lines.push(`<p class="center">${helpTxt}</p>`);
  if (r.checks > 0) lines.push(`<p class="center">Du hast ${r.checks === 1 ? 'einmal' : r.checks + '-mal'} geprüft.</p>`);
  const speak = `Deine Zeit: ${P.fmtTime(r.ms)}. ${helpTxt}.${r.record ? ' Neue Bestzeit!' : ''}`;
  return `${headerHtml()}${lostHtml()}
    ${boardHtml(g, true)}
    <div class="banner done">Geschafft!</div>
    <div class="action"><p class="big kw-sr" style="position:absolute;left:-9999px">${esc(speak)}</p></div>
    <section class="card over"><div class="trophy">🏆</div><h1 class="center">Du hast das Rätsel gelöst!</h1>${lines.join('')}
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
    <p><b>Ziel:</b> Fülle alle weißen Felder mit Buchstaben, sodass alle Wörter stimmen.</p>
    <h3>So funktioniert es</h3>
    <ul>
      <li>Die kleinen Zahlen in den Feldern zeigen, wo ein Wort anfängt. Es gibt Wörter, die waagerecht laufen, und Wörter, die senkrecht laufen.</li>
      <li>Zu jeder Zahl gehört ein Hinweis, zum Beispiel: Hauptstadt von Frankreich. In Klammern steht, wie viele Buchstaben das Wort hat.</li>
      <li>Wo sich zwei Wörter kreuzen, teilen sie sich einen Buchstaben.</li>
    </ul>
    <h3>So bedienst du das Spiel</h3>
    <ol>
      <li>Tippe ein Feld an. Das ganze Wort wird farbig. Der Hinweis steht groß über der Tastatur.</li>
      <li>Tippe unten die Buchstaben ein. Der Cursor springt von allein zum nächsten Feld.</li>
      <li>Tippst du ein Kreuzungsfeld ein zweites Mal an, wechselt die Richtung: von waagerecht nach senkrecht und zurück.</li>
      <li>Mit den Pfeilen links und rechts neben dem Hinweis springst du zum vorigen oder nächsten Wort.</li>
      <li>Mit Löschen nimmst du einen Buchstaben wieder weg. Du kannst auch die Tastatur deines Geräts benutzen.</li>
      <li>Unter dem Gitter stehen alle Hinweise. Tippst du einen an, springst du zu diesem Wort.</li>
    </ol>
    <h3>Prüfen und Hilfen</h3>
    <p>Mit <b>Prüfen</b> werden falsche Buchstaben rot. Das Häkchen <b>Beim Eintippen prüfen</b> macht das sofort bei jedem Buchstaben. Mit <b>Buchstabe aufdecken</b> zeigt dir das Spiel den Buchstaben im gewählten Feld. Mit <b>Wort aufdecken</b> zeigt es das ganze Wort. Aufgedeckte Buchstaben sind fest und grün. Die Hilfen werden gezählt und am Ende genannt. Mit Hilfen zählt deine Zeit nicht für die Bestzeit.</p>
    <h3>Das Ende</h3>
    <p>Sind alle Felder richtig, bist du fertig. Du siehst deine Zeit und deine Bestzeit. Leicht hat 10 Wörter, Mittel 13 und Schwer 16 Wörter.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  soloOnly: true,
  sess, $app,
  title: 'Kreuzworträtsel', icon: '🔤', sub: 'Rätseln mit Hinweisen, in aller Ruhe',
  options: OPTIONS,
  helpTitle: 'So geht das Kreuzworträtsel', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'start-puzzle': return go({ t: 'new', level: P.levelFromOpts(sess.getOpts()) });
      case 'cell': if (g.mode === 'play') { selectCell(g, Number(el.dataset.i)); render(); } return;
      case 'key': return typeLetter(el.dataset.ch);
      case 'erase': return eraseLetter();
      case 'prev-word': return stepWord(-1);
      case 'next-word': return stepWord(1);
      case 'pick-word': {
        const w = g.words.find((x) => x.n === Number(el.dataset.n) && x.d === el.dataset.d);
        if (w && g.mode === 'play') { selectWord(g, w); render(); document.getElementById('board')?.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      case 'check': return go({ t: 'check' });
      case 'revealL':
        if (S.ui.sel < 0) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst das Feld an, das ich dir zeigen soll.' }; return render(); }
        return go({ t: 'revealLetter', i: S.ui.sel });
      case 'revealW': {
        const w = curWord(g);
        if (!w) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst ein Feld des Wortes an.' }; return render(); }
        return go({ t: 'revealWord', n: w.n, d: w.d });
      }
      case 'new-open': S.ui.newPanel = true; return render();
      case 'new-cancel': S.ui.newPanel = false; return render();
    }
  },
});
function render() { ui.render(); if (S.learn) keepTargetVisible(); }
// Lernrunde: das leuchtende Ziel soll zwischen Anleitung (oben) und Tastatur (unten) sichtbar sein
function keepTargetVisible() {
  const t = document.querySelector('.coach-target');
  if (!t || t.closest('.kw-dock') || t.closest('.coach')) return;
  const co = document.querySelector('.coach'), dock = document.querySelector('.kw-dock');
  const top = co ? co.getBoundingClientRect().bottom : 0;
  const bottom = dock ? dock.getBoundingClientRect().top : window.innerHeight;
  const r = t.getBoundingClientRect();
  if (r.top < top + 4 || r.bottom > bottom - 4) window.scrollBy(0, r.top + r.height / 2 - (top + bottom) / 2);
}
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
// Kästchen: ui.js speichert die Regeloptionen; hier wird danach nur neu gezeichnet
$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t || !t.dataset) return;
  if (t.dataset.opt) render();
  else if ('kwtime' in t.dataset) { S.ui.showTime = !!t.checked; sess.set('kw_time', S.ui.showTime); render(); }
});
