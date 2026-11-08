import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, thinkDelay } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const TRY_MS = 1500; // so lange bleibt eine falsche Linie als Kapsel sichtbar
const GLOW_MS = 3300; // so lange leuchtet der erste Buchstabe bei der Hilfe
const COLORS = ['#ff6f61', '#4fc3f7', '#81c784', '#ffd54f', '#ba68c8', '#ff8a65', '#4db6ac', '#f06292', '#9575cd', '#aed581', '#7986cb', '#e0a458'];

const freshUi = () => ({ start: -1, hint: '', hintTone: '', tryLine: null, glow: null, coachSeen: {} });

// Die Einstellungen der Startseite sind Kästchen (ui.js). Stufe: Schwer vor Leicht, ohne Haken Mittel.
const OPTIONS = [
  { id: 'easy', label: 'Leicht (8×8)', help: '8 Wörter, nur nach rechts und nach unten. Ohne Haken bei Leicht und Schwer: Mittel mit 10×10 Feldern und 10 Wörtern (auch schräg nach rechts unten).', def: false },
  { id: 'hard', label: 'Schwer (12×12)', help: '12 Wörter in allen Richtungen, auch rückwärts und schräg. Gilt vor „Leicht“.', def: false },
  { id: 'help', label: 'Hilfe: erster Buchstabe leuchtet', help: 'Tippe auf ein Wort in der Liste, dann leuchtet sein erster Buchstabe kurz. Das kostet 1 Punkt allein und 2 Punkte gegen andere. Mit Hilfe zählt keine Bestzeit.', def: false },
  { id: 'time', label: 'Zeit anzeigen', help: 'Beim Allein-Spielen läuft oben eine Uhr mit. Ohne Haken wird die Zeit trotzdem gestoppt.', def: false },
];
const engineOpts = (o) => ({ easy: !!o.easy, hard: !!o.hard, help: !!o.help, time: !!o.time });

// ====================== Zeitgeber (nur App-Teil; die Regeln stehen in engine.js) ======================
const timers = { bots: new Map(), seed: null, tryT: null, glowT: null };
function clearBotTimers() { for (const h of timers.bots.values()) clearTimeout(h); timers.bots.clear(); timers.seed = null; }
function clearAllTimers() { clearBotTimers(); clearTimeout(timers.tryT); clearTimeout(timers.glowT); }

const sess = createSession({
  game: 'ws',
  maxPlayers: E.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, o) => {
    clearAllTimers();
    S.ui = { ...freshUi(), ...(S.ui && S.ui.helpOpen ? { helpOpen: true } : {}) };
    clk.seq = -1; clk.since = null; clk.base = 0;
    return E.createGame(players, S.learn ? { learn: true } : engineOpts(o || {}), Math.random);
  },
  onMessage: (state, pid, msg) => {
    // Der Gastgeber lässt die Computer-Mitspieler Wörter finden (nur im Alleinspiel)
    if (msg && msg.t === 'as') {
      if (S.room === 'SOLO' && pid === sess.cid && E.isBotId(msg.id) && msg.msg && typeof msg.msg === 'object') E.handle(state, msg.id, msg.msg, Math.random);
      return;
    }
    E.handle(state, pid, msg, Math.random);
    if (state.mode === 'over' && state.result && state.result.record === null) {
      if (state.learn) { state.result.record = false; return; }
      const k = 'ws_best_' + state.stufe;
      const b = E.settleResult(state, sess.get(k, null));
      if (b && b.record) sess.set(k, b.best);
    }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { clearAllTimers(); S.ui = freshUi(); clk.since = null; clk.seq = -1; },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Uhr (Alleinspiel; läuft ab dem ersten Tipp) ======================
const clk = { seq: -1, base: 0, since: null };
const visible = () => document.visibilityState !== 'hidden';
const nowMs = () => clk.base + (clk.since != null ? Date.now() - clk.since : 0);
function clockSync(g) {
  if (!g || g.mode !== 'play' || !g.began || g.players.length !== 1) { clk.since = null; if (!g || g.mode !== 'play') clk.seq = -1; return; }
  if (clk.seq !== g.seq) { clk.seq = g.seq; clk.base = Math.max(g.elapsed || 0, clk.base); clk.since = visible() ? Date.now() : null; }
}
function clockPause() {
  const g = S.game;
  if (!g || g.mode !== 'play' || g.players.length !== 1 || !g.began || S.role !== 'host') return;
  clk.base = nowMs(); clk.since = null;
  sess.send({ t: 'sync', ms: clk.base });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clockPause();
  else if (S.game && S.game.mode === 'play' && S.game.began) clk.since = Date.now();
});
window.addEventListener('pagehide', clockPause);
setInterval(() => {
  const el = document.getElementById('ws-clock');
  const g = S.game;
  if (el && g) el.textContent = g.began ? E.fmtTime(nowMs()) : '00:00';
}, 500);
const go = (msg) => sess.send(S.game && S.game.players.length === 1 ? { ...msg, ms: nowMs() } : msg);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    clockSync(g);
    if (S.role === 'host') arm(g);
  }
  render();
}

// Computer: nach einer Wartezeit meldet er ein noch gesuchtes Wort aus der Wortliste (siehe ai.js)
function arm(g) {
  if (g.mode !== 'play' || S.room !== 'SOLO') return;
  if (timers.seed !== g.seed) { clearBotTimers(); timers.seed = g.seed; }
  const level = S.level || 0;
  for (const p of g.players) {
    if (!E.isBotId(p.id) || timers.bots.has(p.id)) continue;
    const seed = g.seed;
    const delay = thinkDelay(level, Math.random) * (g.learn ? 2 : 1);
    timers.bots.set(p.id, setTimeout(() => {
      timers.bots.delete(p.id);
      const cur = S.game;
      if (!cur || cur.seed !== seed || cur.mode !== 'play' || S.room !== 'SOLO') return;
      const msg = chooseAction(cur, p.id, level, Math.random);
      if (msg) sess.send({ t: 'as', id: p.id, msg });
    }, delay));
  }
}

// ====================== Rollen und Texte ======================
const meIndex = (g) => E.playerIndex(g, cid);
const plainName = (p) => (E.isBotId(p.id) ? (p.name === 'Computer' ? 'Der Computer' : p.name) : p.name);
const nPoints = (n) => `${n} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
const nWords = (n) => `${n} ${n === 1 ? 'Wort' : 'Wörter'}`;
const colorOf = (k) => COLORS[k % COLORS.length];

// ====================== Darstellung ======================
const center = (g, i) => { const [r, c] = E.cellRC(g, i); return [c + 0.5, r + 0.5]; };
function lineSvg(g, a, b, cls, color) {
  const [x1, y1] = center(g, a); const [x2, y2] = center(g, b);
  const st = color ? ` style="stroke:${color}"` : '';
  if (a === b) return `<circle class="${cls}" cx="${x1}" cy="${y1}" r="0.42"${color ? ` style="fill:${color}"` : ''}/>`;
  return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${st}/>`;
}

function boardHtml(g) {
  const n = g.n;
  const ui = S.ui;
  const parts = [];
  g.words.forEach((wd, k) => {
    if (wd.by < 0) return;
    const cells = E.wordCells(n, wd);
    parts.push(lineSvg(g, cells[0], cells[cells.length - 1], 'fnd', colorOf(k)));
  });
  if (ui.tryLine && ui.tryLine.straight) parts.push(lineSvg(g, ui.tryLine.a, ui.tryLine.b, 'try'));
  if (ui.start >= 0 && g.mode === 'play') parts.push(lineSvg(g, ui.start, ui.start, 'sel'));
  const tryCells = ui.tryLine && !ui.tryLine.straight ? [ui.tryLine.a, ui.tryLine.b] : [];
  const glowCell = ui.glow ? ui.glow.i : -1;
  const cells = [];
  for (let i = 0; i < n * n; i++) {
    const ch = g.letters[i];
    const cls = ['ws-cell'];
    if (i === ui.start && g.mode === 'play') cls.push('sel');
    if (tryCells.includes(i)) cls.push('try');
    if (i === glowCell) cls.push('glow');
    const [r, c] = E.cellRC(g, i);
    cells.push(`<button class="${cls.join(' ')}" data-act="cell" data-i="${i}" aria-label="Zeile ${r + 1}, Spalte ${c + 1}: ${ch}${i === ui.start ? ', als Anfang gewählt' : ''}">${ch}</button>`);
  }
  return `<section class="ws-boardwrap"><div id="board" class="ws-board size-${g.stufe}" role="group" aria-label="Buchstabengitter mit ${n} mal ${n} Feldern"><svg class="ws-lines" viewBox="0 0 ${n} ${n}" aria-hidden="true">${parts.join('')}</svg>${cells.join('')}</div></section>`;
}

function bannerHtml(g) {
  if (g.mode === 'over') {
    const o = E.outcome(g);
    if (o.kind === 'solo') {
      const r = g.result;
      return `<div class="banner done">Geschafft! Zeit: ${E.fmtTime(r.timeMs)}${r.record ? '. Neue Bestzeit!' : ''}</div>`;
    }
    const mineWin = o.winners.includes(cid);
    const names = o.winners.map((id) => g.players.find((p) => p.id === id));
    const top = o.ranking[0].score;
    const txt = o.winners.length === 1
      ? (mineWin ? `Du hast gewonnen mit ${nPoints(top)}!` : `${esc(plainName(names[0]))} hat gewonnen mit ${nPoints(top)}!`)
      : `Gleichstand mit ${nPoints(top)}!`;
    return `<div class="banner done">${txt}</div>`;
  }
  const evt = g.evt;
  if (evt && evt.kind === 'find' && g.players[evt.by] && g.words[evt.k]) {
    const by = g.players[evt.by];
    const word = g.words[evt.k].w;
    if (by.id === cid) return `<div class="banner mine">Du hast ${esc(word)} gefunden! +10 Punkte</div>`;
    return `<div class="banner">${esc(plainName(by))} war schneller: ${esc(word)}</div>`;
  }
  return `<div class="banner">${g.players.length === 1 ? 'Finde alle versteckten Wörter!' : 'Wer findet die Wörter zuerst?'}</div>`;
}

function actionHtml(g) {
  const ui = S.ui;
  const mine = meIndex(g) >= 0;
  let text; let cls = '';
  if (ui.hint) { text = ui.hint; cls = ui.hintTone === 'warn' ? ' warn' : ''; }
  else if (!mine) text = 'Du schaust gerade zu.';
  else if (ui.start >= 0) text = 'Tippe jetzt auf den letzten Buchstaben des Wortes.';
  else text = 'Tippe auf den ersten Buchstaben eines Wortes aus der Liste.';
  return `<section class="card action ws-action"><p class="big${cls}">${esc(text)}</p>
    <button class="btn ghost" data-act="cancel"${ui.start < 0 ? ' disabled' : ''}>Auswahl aufheben</button></section>`;
}

function listHtml(g) {
  const items = g.words.map((wd, k) => {
    const done = wd.by >= 0;
    const inner = esc(wd.w);
    const cls = `ws-w${done ? ' done' : ''}`;
    const st = `--wc:${colorOf(k)}`;
    if (g.help && !done && g.mode === 'play' && meIndex(g) >= 0) {
      return `<li><button class="${cls}" style="${st}" data-act="hilfe" data-k="${k}" aria-label="${esc(wd.w)}: Anfangsbuchstaben zeigen">${inner}</button></li>`;
    }
    return `<li class="${cls}" style="${st}"${done ? ` aria-label="${esc(wd.w)}, gefunden"` : ''}>${inner}</li>`;
  }).join('');
  const left = g.words.length - E.foundCount(g);
  return `<section class="card ws-listcard"><h2>Thema: ${esc(g.theme.name)} · noch ${nWords(left)} zu finden</h2>
    <ul class="ws-list" id="ws-list">${items}</ul>${g.help ? '<p class="muted small">Tippe auf ein Wort, dann leuchtet sein erster Buchstabe kurz.</p>' : ''}</section>`;
}

function scoreHtml(g) {
  if (g.players.length === 1) {
    const best = sess.get('ws_best_' + g.stufe, null);
    const found = E.foundCount(g);
    const stats = [`<div><b>${found} von ${g.words.length}</b><span>Wörter gefunden</span></div>`];
    if (g.time) stats.push(`<div><b id="ws-clock">${g.mode === 'over' && g.result ? E.fmtTime(g.result.timeMs) : g.began ? E.fmtTime(nowMs()) : '00:00'}</b><span>Zeit</span></div>`);
    if (g.help) stats.push(`<div><b>${g.helps[0]}</b><span>Hilfen</span></div>`);
    return `<section class="card ws-score" id="ws-score"><div class="ws-stats">${stats.join('')}</div>
      <p class="center muted small ws-best">${best === null ? `Noch keine Bestzeit bei „${E.STUFEN[g.stufe].label}“.` : `Bestzeit bei „${E.STUFEN[g.stufe].label}“: ${E.fmtTime(best)}`}</p></section>`;
  }
  const items = g.players.map((p, i) => {
    const w = g.words.filter((x) => x.by === i).length;
    return `<li class="ws-pl"><span class="ws-pn">${esc(plainName(p))}${p.id === cid ? ' (du)' : ''}</span><span class="ws-pp"><b>${g.scores[i]}</b> ${Math.abs(g.scores[i]) === 1 ? 'Punkt' : 'Punkte'} <small>(${nWords(w)})</small></span></li>`;
  }).join('');
  return `<section class="card ws-score" id="ws-score"><ul class="ws-players">${items}</ul><p class="center muted small">Jedes gefundene Wort zählt 10 Punkte${g.help ? ', jede Hilfe kostet 2 Punkte' : ''}.</p></section>`;
}

function againHtml() {
  if (S.role === 'host') return '<button class="btn primary huge" data-act="again">🔎 Noch eine Runde spielen</button>';
  return '<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>';
}

function resultHtml(g) {
  const o = E.outcome(g);
  if (o.kind === 'solo') {
    const r = g.result;
    const best = sess.get('ws_best_' + g.stufe, null);
    let line;
    if (g.learn) line = 'Das war die Übungsrunde. Eine Bestzeit gibt es erst im richtigen Spiel.';
    else if (r.helps > 0) line = 'Mit Hilfe geschafft. Diese Zeit zählt nicht für die Bestzeit.';
    else if (r.record) line = 'Neue Bestzeit! 🎉';
    else line = `Deine Bestzeit: <b>${E.fmtTime(best)}</b>`;
    return `<section class="card over ws-result"><div class="trophy">🏆</div>
      <h1>Geschafft! Alle ${g.words.length} Wörter gefunden.</h1>
      <p class="center big">Du hast <b>${E.fmtTime(r.timeMs)}</b> gebraucht.</p>
      <p class="center big">${line}</p>
      <button class="btn primary huge" data-act="again">🔎 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  }
  const rk = o.ranking;
  const mineWin = o.winners.includes(cid);
  const names = o.winners.map((id) => g.players.find((p) => p.id === id));
  let title;
  if (o.winners.length === 1) {
    title = mineWin ? 'Du hast gewonnen! Glückwunsch!' : `${esc(plainName(names[0]))} hat gewonnen!`;
  } else {
    const others = names.filter((p) => p.id !== cid).map((p) => esc(plainName(p)));
    title = mineWin ? `Gleichstand! Du gewinnst zusammen mit ${others.join(' und ')}.` : `Gleichstand! ${names.map((p) => esc(plainName(p))).join(' und ')} haben gewonnen.`;
  }
  const medals = ['🥇', '🥈', '🥉', '4.', '5.', '6.'];
  const rows = rk.map((r) => `<li class="${r.win ? 'win' : ''}"><span class="medal">${medals[Math.min(r.rank, 6) - 1]}</span><span class="rn">${esc(plainName(r))}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${nPoints(r.score)}</span></li>`).join('');
  return `<section class="card over ws-result"><div class="trophy">${mineWin ? '🏆' : '👏'}</div><h1>${title}</h1>
    <p class="center muted">Es gewinnt, wer die meisten Punkte hat: 10 Punkte für jedes Wort, das du zuerst findest.</p><ul class="ranking">${rows}</ul>
    ${againHtml()}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return `${ui.header()}${ui.lost()}${bannerHtml(g)}${resultHtml(g)}${boardHtml(g)}${listHtml(g)}${scoreHtml(g)}`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${boardHtml(g)}${actionHtml(g)}${listHtml(g)}${scoreHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Im Buchstabengitter sind Wörter versteckt. Finde sie alle. Die gesuchten Wörter stehen in der Liste unter dem Gitter.</p>
    <h3>So spielst du</h3>
    <ol>
      <li>Suche ein Wort aus der Liste im Gitter. Es steht in einer geraden Linie.</li>
      <li>Tippe auf den <b>ersten</b> Buchstaben des Wortes. Das Feld wird gelb markiert.</li>
      <li>Tippe dann auf den <b>letzten</b> Buchstaben des Wortes. Das Spiel zeichnet eine Linie dazwischen.</li>
      <li>Ist es ein gesuchtes Wort, bleibt die Linie bunt und das Wort in der Liste wird durchgestrichen. Sonst gibt es einen freundlichen Hinweis, aber keinen Abzug.</li>
    </ol>
    <p>Du kannst das Wort auch von hinten nach vorn markieren: Der Anfang darf auch der letzte Buchstabe sein. Mit „Auswahl aufheben“ oder einem zweiten Tipp auf dasselbe Feld fängst du neu an. Liegen die beiden Felder nicht auf einer geraden Linie, sagt dir das Spiel Bescheid.</p>
    <h3>Die Stufen</h3>
    <ul>
      <li><b>Leicht:</b> 8×8 Felder, 8 Wörter. Sie stehen nur von links nach rechts oder von oben nach unten.</li>
      <li><b>Mittel:</b> 10×10 Felder, 10 Wörter. Dazu kommen Wörter schräg nach rechts unten. Das ist die Standardstufe.</li>
      <li><b>Schwer:</b> 12×12 Felder, 12 Wörter in allen acht Richtungen, auch rückwärts und schräg nach oben.</li>
    </ul>
    <h3>Die Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du suchst alle Wörter. Das Spiel stoppt deine Zeit. Deine Bestzeit wird für jede Stufe gemerkt.</li>
      <li><b>Mit anderen online:</b> Bis zu 6 Personen suchen im selben Gitter gleichzeitig. Wer ein Wort zuerst findet, bekommt es und 10 Punkte. Wenn alle Wörter gefunden sind, gewinnt, wer die meisten Punkte hat.</li>
      <li><b>Gegen den Computer:</b> Ein bis drei Computer spielen mit. Der Computer sucht nicht wirklich im Gitter, er meldet nach einiger Zeit ein Wort aus der Liste. Leicht braucht dafür 14 bis 24 Sekunden, Mittel 6 bis 12 Sekunden.</li>
    </ul>
    <h3>Einstellungen auf der Startseite</h3>
    <ul>
      <li><b>Leicht</b> oder <b>Schwer:</b> Ohne Haken spielst du Mittel. Schwer gilt vor Leicht.</li>
      <li><b>Hilfe: erster Buchstabe leuchtet:</b> Ein Tipp auf ein Wort in der Liste lässt seinen ersten Buchstaben kurz leuchten. Das kostet 1 Punkt allein und 2 Punkte gegen andere. Mit Hilfe zählt keine Bestzeit.</li>
      <li><b>Zeit anzeigen:</b> Beim Allein-Spielen läuft oben eine Uhr mit.</li>
    </ul>
    <p class="muted">Das Spiel erkennt gefundene Wörter und das Spielende von allein. Ohne die Hilfe-Einstellung gibt es keine Hinweise auf die Lage der Wörter.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du suchst alle Wörter allein und versuchst, deine Bestzeit zu verbessern.',
  sess, $app,
  title: 'Wortsuche', icon: '🔎', sub: 'Versteckte Wörter im Buchstabengitter – allein, gegen den Computer oder mit anderen',
  options: OPTIONS,
  minPlayers: 2,
  helpTitle: 'Die Spielregeln der Wortsuche', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    const u = S.ui;
    switch (act) {
      case 'cell': {
        if (g.mode !== 'play') return undefined;
        const me = meIndex(g);
        if (me < 0) { u.hint = 'Du schaust gerade nur zu.'; u.hintTone = ''; return render(); }
        const i = Number(el.dataset.i);
        if (!Number.isInteger(i) || i < 0 || i >= g.n * g.n) return undefined;
        clearTimeout(timers.tryT); u.tryLine = null;
        if (g.players.length === 1 && !g.began) go({ t: 'begin' });
        if (u.start < 0) { u.start = i; u.hint = ''; u.hintTone = ''; return render(); }
        if (u.start === i) { u.start = -1; u.hint = ''; return render(); }
        const a = u.start; const b = i;
        u.start = -1;
        const p = E.probe(g, a, b);
        if (p.kind === 'treffer') { u.hint = ''; u.hintTone = ''; return go({ t: 'line', a, b }); }
        u.tryLine = { a, b, straight: p.kind !== 'nolinie' };
        u.hintTone = 'warn';
        u.hint = p.kind === 'nolinie' ? 'Das ist keine gerade Linie. Die zwei Buchstaben müssen waagerecht, senkrecht oder schräg in einer Reihe liegen.'
          : p.kind === 'schon' ? 'Dieses Wort ist schon gefunden. Such ein anderes aus der Liste.'
            : 'Das ist leider kein gesuchtes Wort. Kein Problem, es gibt keinen Abzug. Versuch es noch einmal!';
        timers.tryT = setTimeout(() => { if (S.ui.tryLine) { S.ui.tryLine = null; render(); } }, TRY_MS);
        return render();
      }
      case 'cancel': u.start = -1; u.hint = ''; return render();
      case 'hilfe': {
        if (!g.help || g.mode !== 'play' || meIndex(g) < 0) return undefined;
        const k = Number(el.dataset.k);
        const wd = g.words[k];
        if (!wd || wd.by >= 0) return undefined;
        const first = wd.r * g.n + wd.c;
        if (g.players.length === 1 && !g.began) go({ t: 'begin' });
        const free = g.helped[meIndex(g)].includes(k);
        u.glow = { i: first, k };
        u.hintTone = '';
        u.hint = `Der erste Buchstabe von ${wd.w} leuchtet kurz.${free ? '' : ` Das kostet ${g.players.length === 1 ? '1 Punkt' : '2 Punkte'}.`}`;
        clearTimeout(timers.glowT);
        timers.glowT = setTimeout(() => { if (S.ui.glow) { S.ui.glow = null; render(); } }, GLOW_MS);
        if (!free) go({ t: 'help', k });
        return render();
      }
    }
    return undefined;
  },
});
function render() { ui.render(); }
ui.boot();
