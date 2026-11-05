import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const freshUi = () => ({
  sel: -1, notes: false, msg: null, newPanel: false, confirmLevel: null,
  help: false, showTime: true, coachSeen: {}, seqSeen: -1,
});

const sess = createSession({
  game: 'sd',
  maxPlayers: 1,
  newGame: (players) => {
    const learnStart = !!S.learn && !S.game; // erste Partie der Lernrunde
    if (S.learn && S.game) S.learn = false; // „Richtiges Rätsel spielen“ beendet die Lernrunde
    resetPlay();
    return P.createGame(players, { learn: learnStart });
  },
  onMessage: (state, pid, msg) => {
    const r = P.apply(state, pid, msg, Math.random);
    if (!r.ok) { S.ui.msg = { tone: 'warn', text: r.error }; render(); return; }
    S.ui.msg = null;
    if (msg.t === 'new') resetPlay();
    if (state.mode === 'over' && state.result && state.result.record === null) {
      if (state.level === 'lern') { state.result.record = false; return; }
      const prev = sess.get('sd_best_' + state.level, 0);
      const b = P.settleResult(state, prev);
      if (b && b.record) sess.set('sd_best_' + state.level, b.best);
    }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi(), settings()); },
});
const S = sess.S;
const settings = () => ({ help: !!sess.get('sd_help', false), showTime: sess.get('sd_time', true) !== false });
S.ui = Object.assign(freshUi(), settings());

function resetPlay() {
  Object.assign(S.ui, { sel: -1, notes: false, msg: null, newPanel: false, confirmLevel: null });
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
  const el = document.getElementById('sd-clock');
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
const lockedAt = (g, i) => P.isLocked(g, i);

function cellHtml(g, i, o) {
  const v = g.cells[i];
  const r = P.ROW[i], c = P.COL[i];
  const cls = ['sd-c'];
  if (c % 3 === 0 && c > 0) cls.push('bl');
  if (r % 3 === 0 && r > 0) cls.push('bt');
  const given = P.isGiven(g, i);
  const rev = g.revealed.includes(i);
  if (given) cls.push('given'); else if (rev) cls.push('rev'); else if (v) cls.push('mine');
  if (o.sel >= 0) {
    if (i === o.sel) cls.push('sel');
    else if (P.ROW[o.sel] === r || P.COL[o.sel] === c || P.BOX[o.sel] === P.BOX[i]) cls.push('peer');
    if (v && v === o.selV && i !== o.sel) cls.push('same');
  }
  if (o.bad.has(i)) cls.push('bad');
  if (o.wrong.has(i)) cls.push('wrong');
  let inner = '';
  let label = `Zeile ${r + 1}, Spalte ${c + 1}: `;
  if (v) {
    inner = `<span class="sd-v">${v}</span>`;
    label += `Zahl ${v}${given ? ', vorgegeben' : rev ? ', aufgedeckt' : ''}`;
  } else if (g.notes[i]) {
    const ds = [];
    for (let d = 1; d <= 9; d++) if (g.notes[i] & (1 << (d - 1))) ds.push(d);
    inner = `<span class="sd-n">${Array.from({ length: 9 }, (_, k) => `<i>${g.notes[i] & (1 << k) ? k + 1 : ''}</i>`).join('')}</span>`;
    label += `leer, Notizen ${ds.join(', ')}`;
  } else label += 'leer';
  if (o.bad.has(i)) label += ', Regelverstoß';
  if (o.wrong.has(i)) label += ', passt nicht zur Lösung';
  if (i === o.sel) label += ', ausgewählt';
  if (o.readonly) return `<div class="${cls.join(' ')}" role="img" aria-label="${label}">${inner}</div>`;
  return `<button class="${cls.join(' ')}" data-act="cell" data-i="${i}" aria-label="${label}" aria-pressed="${i === o.sel}">${inner}</button>`;
}

function boardHtml(g, readonly) {
  const sel = readonly ? -1 : S.ui.sel;
  const o = {
    sel, selV: sel >= 0 ? g.cells[sel] : 0, readonly,
    bad: new Set(S.ui.help && !readonly ? P.conflicts(g.cells) : []),
    wrong: new Set(S.ui.help && !readonly && g.check ? g.check.wrong : []),
  };
  return `<div id="board" class="sd-board${readonly ? ' ro' : ''}" aria-label="Sudoku-Gitter">${Array.from({ length: 81 }, (_, i) => cellHtml(g, i, o)).join('')}</div>`;
}

function statusHtml(g) {
  const left = P.emptyCount(g);
  const t = S.ui.showTime ? P.fmtTime(nowMs()) : '––:––';
  return `<div class="sd-status"><span class="sd-lvl">${esc(P.levelName(g.level))}</span>
    <span class="sd-clock" aria-label="Zeit">⏱ <span id="sd-clock">${t}</span></span>
    <span class="sd-left">${left === 1 ? 'Noch 1 Feld' : `Noch ${left} Felder`}</span></div>`;
}

function hintText(g) {
  if (S.ui.msg) return { tone: S.ui.msg.tone || '', text: S.ui.msg.text };
  if (S.ui.help && g.check) {
    return g.check.wrong.length
      ? { tone: 'warn', text: g.check.wrong.length === 1 ? 'Eine Zahl passt nicht zur Lösung. Sie ist rot markiert.' : `${g.check.wrong.length} Zahlen passen nicht zur Lösung. Sie sind rot markiert.` }
      : { tone: 'ok', text: 'Alles passt bisher. Gut gemacht!' };
  }
  if (P.isFull(g) && !P.isSolved(g)) {
    return { tone: 'warn', text: `Irgendwo ist noch ein Fehler. Schau dir die Zahlen noch einmal in Ruhe an.${S.ui.help ? ' Doppelte Zahlen sind rot.' : ''}` };
  }
  const s = S.ui.sel;
  if (s < 0) return { tone: '', text: 'Tippe ein Feld an, dann unten eine Zahl.' };
  if (lockedAt(g, s)) return { tone: '', text: 'Diese Zahl ist fest. Tippe ein leeres Feld an.' };
  if (S.ui.notes) return { tone: '', text: 'Notizen sind an: Die Zahl wird nur klein als Idee eingetragen.' };
  return { tone: '', text: g.cells[s] ? 'Tippe eine andere Zahl oder auf Löschen.' : 'Tippe unten die Zahl, die in dieses Feld gehört.' };
}

function keysHtml(g) {
  const cnt = P.placedCounts(g);
  const keys = Array.from({ length: 9 }, (_, k) => {
    const d = k + 1;
    const left = Math.max(0, 9 - cnt[d]);
    const done = cnt[d] >= 9;
    return `<button class="sd-key${done ? ' done' : ''}${S.ui.notes ? ' nt' : ''}" data-act="key" data-d="${d}" aria-label="Zahl ${d}, ${done ? 'komplett eingetragen' : `noch ${left} mal`}"><b>${d}</b><small>${done ? '✓' : `noch ${left}`}</small></button>`;
  }).join('');
  return `<div class="sd-keys">${keys}<button class="sd-key del" data-act="erase" aria-label="Zahl oder Notizen im Feld löschen"><b>⌫</b><small>Löschen</small></button></div>`;
}

function toolsHtml(g) {
  const hintsLeft = P.MAX_HINTS - g.hints;
  return `<div class="sd-tools">
      <button class="btn sd-tool${S.ui.notes ? ' on' : ''}" data-act="notes" aria-pressed="${S.ui.notes}">✎ Notizen: ${S.ui.notes ? 'an' : 'aus'}</button>
      <button class="btn sd-tool" data-act="undo" ${g.hist.length ? '' : 'disabled'}>↶ Rückgängig</button>
    </div>
    ${S.ui.help ? `<div class="sd-tools">
      <button class="btn sd-tool" data-act="check">✔ Prüfen</button>
      <button class="btn sd-tool" data-act="reveal" ${hintsLeft > 0 ? '' : 'disabled'}>💡 Feld verraten (${hintsLeft})</button>
    </div>` : ''}
    <div class="sd-tools sd-set">
      <button class="btn sd-tool ghost" data-act="hilfen" aria-pressed="${S.ui.help}">Hilfen: ${S.ui.help ? 'an' : 'aus'}</button>
      <button class="btn sd-tool ghost" data-act="time-toggle" aria-pressed="${S.ui.showTime}">Zeit: ${S.ui.showTime ? 'sichtbar' : 'versteckt'}</button>
    </div>
    ${S.learn ? '' : `<button class="btn ghost" data-act="new-open">Neues Rätsel</button>`}`;
}

function levelButtons(act) {
  return P.LEVELS.map((l) => {
    const best = sess.get('sd_best_' + l.id, 0);
    return `<button class="btn primary huge sd-lvlbtn" data-act="${act}" data-level="${l.id}"><b>${l.name}</b><small>${esc(l.text)}</small><small>${best ? `Deine Bestzeit: ${P.fmtTime(best)}` : 'Noch keine Bestzeit'}</small></button>`;
  }).join('');
}

function chooseHtml() {
  return `${headerHtml()}${lostHtml()}
    <section class="card sd-choose"><h2>Welches Rätsel möchtest du lösen?</h2>
    <p class="muted">Wähle die Schwierigkeit. Du kannst jederzeit ein neues Rätsel beginnen.</p>
    ${levelButtons('level')}</section>`;
}

function newPanelHtml(g) {
  const cl = S.ui.confirmLevel;
  const warn = g.mode === 'play' ? `<p class="warn">Dein jetziges Rätsel ist noch nicht fertig. Es geht verloren, wenn du ein neues beginnst.</p>` : '';
  const body = cl
    ? `<div class="confirm"><p class="big">Wirklich ein neues Rätsel (<b>${esc(P.levelName(cl))}</b>) beginnen?</p>
        <button class="btn primary huge" data-act="new-yes">Ja, neues Rätsel</button>
        <button class="btn ghost" data-act="new-no">Nein, weiterspielen</button></div>`
    : `${levelButtons('new-pick')}<button class="btn ghost" data-act="new-cancel">Zurück zum Rätsel</button>`;
  return `${headerHtml()}${lostHtml()}<section class="card"><h2>Neues Rätsel</h2>${warn}${body}</section>`;
}

function playHtml(g) {
  const h = hintText(g);
  return `${headerHtml()}${lostHtml()}
    ${statusHtml(g)}
    ${boardHtml(g, false)}
    <div class="action"><p class="big sd-msg ${h.tone}" role="status">${esc(h.text)}</p></div>
    ${keysHtml(g)}
    ${toolsHtml(g)}`;
}

function overHtml(g) {
  const r = g.result || { ms: g.elapsed, level: g.level, hints: g.hints, checks: g.checks, mistakes: 0, record: false, prev: 0 };
  const lern = r.level === 'lern';
  const best = lern ? 0 : (r.record ? r.ms : (r.prev || sess.get('sd_best_' + r.level, 0)));
  const lines = [];
  lines.push(`<p class="big center">Deine Zeit: <b>${P.fmtTime(r.ms)}</b>${lern ? '' : ` (${esc(P.levelName(r.level))})`}</p>`);
  if (!lern) {
    if (r.record) lines.push(`<p class="big center">🏅 Neue Bestzeit! 🎉</p>`);
    else if (r.hints > 0) lines.push(`<p class="center">Mit aufgedeckten Feldern zählt die Zeit nicht für die Bestzeit.${best ? ` Deine Bestzeit: <b>${P.fmtTime(best)}</b>` : ''}</p>`);
    else if (best) lines.push(`<p class="center">Deine Bestzeit (${esc(P.levelName(r.level))}): <b>${P.fmtTime(best)}</b></p>`);
  }
  if (r.checks > 0) lines.push(`<p class="center">Du hast ${r.checks === 1 ? 'einmal' : r.checks + ' mal'} geprüft. Dabei waren ${r.mistakes === 0 ? 'keine Zahlen' : r.mistakes === 1 ? 'eine Zahl' : r.mistakes + ' Zahlen'} falsch.</p>`);
  if (r.hints > 0) lines.push(`<p class="center">Aufgedeckte Felder: ${r.hints}</p>`);
  return `${headerHtml()}${lostHtml()}
    ${boardHtml(g, true)}
    <div class="banner done">Geschafft!</div>
    <section class="card over"><div class="trophy">${r.record ? '🏆' : '🎉'}</div>${lines.join('')}
      <button class="btn primary huge" data-act="again">${lern ? '▶ Ein richtiges Rätsel spielen' : '▶ Noch ein Rätsel'}</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'choose') return chooseHtml();
  if (g.mode === 'over') return overHtml(g);
  if (S.ui.newPanel) return newPanelHtml(g);
  return playHtml(g);
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Fülle alle leeren Felder mit den Zahlen 1 bis 9.</p>
    <h3>Die Regeln</h3>
    <ul>
      <li>In jeder <b>Zeile</b> steht jede Zahl von 1 bis 9 genau einmal.</li>
      <li>In jeder <b>Spalte</b> steht jede Zahl von 1 bis 9 genau einmal.</li>
      <li>Das Gitter hat neun <b>Blöcke</b> mit je 3 mal 3 Feldern (sie haben dicke Linien). Auch in jedem Block steht jede Zahl genau einmal.</li>
    </ul>
    <p>Einige Zahlen sind vorgegeben. Sie sind dunkel und fest. Jedes Rätsel hat genau eine richtige Lösung. Du musst nie raten: Man kann alles Schritt für Schritt herausfinden.</p>
    <h3>So bedienst du das Spiel</h3>
    <ol>
      <li>Tippe auf ein leeres Feld. Die Zeile, die Spalte und der Block werden hell markiert. Gleiche Zahlen im Gitter sind dunkler markiert.</li>
      <li>Tippe unter dem Gitter auf die Zahl, die du eintragen willst. Unter jeder Zahl steht, wie oft sie noch fehlt. Ist sie neunmal eingetragen, wird die Taste blass.</li>
      <li>Mit <b>Löschen</b> nimmst du eine eigene Zahl wieder weg.</li>
      <li>Mit <b>Rückgängig</b> machst du den letzten Schritt ungeschehen – so oft du willst.</li>
    </ol>
    <h3>Notizen</h3>
    <p>Bist du nicht sicher? Schalte <b>Notizen</b> ein. Dann trägst du Zahlen nur klein als Idee ins Feld ein. Tippst du dieselbe Zahl nochmal, verschwindet sie wieder. Eine große Zahl im Feld löscht die Notizen dieses Feldes. Schalte Notizen aus, wenn du eine richtige Zahl eintragen willst.</p>
    <h3>Hilfen</h3>
    <p>Mit dem Schalter <b>Hilfen</b> zeigt das Gitter doppelte Zahlen in Rot. Dann gibt es auch <b>Prüfen</b>: Es zeigt, ob deine bisherigen Zahlen zur Lösung passen. Mit <b>Feld verraten</b> deckst du ein leeres Feld auf, das du vorher antippst. Das geht höchstens dreimal pro Rätsel. Ohne Hilfen siehst du Fehler erst am Ende.</p>
    <h3>Das Ende</h3>
    <p>Sind alle Felder voll und alles stimmt, bist du fertig. Du siehst deine Zeit und deine Bestzeit. Stimmt noch etwas nicht, sagt das Spiel es dir freundlich, aber nicht, wo der Fehler ist. Die Uhr kannst du mit „Zeit“ ausblenden.</p>
    <p class="muted">Mit „Neues Rätsel“ wählst du Leicht, Mittel oder Schwer.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  soloOnly: true,
  sess, $app,
  title: 'Sudoku', icon: '🔢', sub: 'Zahlenrätsel zum Entspannen',
  helpTitle: 'So geht Sudoku', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'level': return go({ t: 'new', level: el.dataset.level });
      case 'cell': { S.ui.sel = Number(el.dataset.i); S.ui.msg = null; return render(); }
      case 'key': {
        if (g.mode !== 'play') return;
        const d = Number(el.dataset.d);
        if (S.ui.sel < 0) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst ein Feld an.' }; return render(); }
        if (lockedAt(g, S.ui.sel)) { S.ui.msg = { tone: 'warn', text: 'Diese Zahl ist fest. Tippe ein leeres Feld an.' }; return render(); }
        return go(S.ui.notes ? { t: 'note', i: S.ui.sel, d } : { t: 'put', i: S.ui.sel, d });
      }
      case 'erase':
        if (S.ui.sel < 0) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst ein Feld an.' }; return render(); }
        return go({ t: 'erase', i: S.ui.sel });
      case 'notes': S.ui.notes = !S.ui.notes; S.ui.msg = null; return render();
      case 'undo': return go({ t: 'undo' });
      case 'hilfen': S.ui.help = !S.ui.help; sess.set('sd_help', S.ui.help); S.ui.msg = null; return render();
      case 'time-toggle': S.ui.showTime = !S.ui.showTime; sess.set('sd_time', S.ui.showTime); return render();
      case 'check': return go({ t: 'check' });
      case 'reveal':
        if (S.ui.sel < 0 || g.cells[S.ui.sel]) { S.ui.msg = { tone: 'warn', text: 'Tippe zuerst das leere Feld an, das ich dir verraten soll.' }; return render(); }
        return go({ t: 'reveal', i: S.ui.sel });
      case 'new-open': S.ui.newPanel = true; S.ui.confirmLevel = null; return render();
      case 'new-cancel': S.ui.newPanel = false; S.ui.confirmLevel = null; return render();
      case 'new-pick': S.ui.confirmLevel = el.dataset.level; return render();
      case 'new-no': S.ui.confirmLevel = null; return render();
      case 'new-yes': { const lv = S.ui.confirmLevel; S.ui.confirmLevel = null; return lv && go({ t: 'new', level: lv }); }
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
