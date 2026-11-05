import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const freshUi = () => ({ sel: null, note: '', confirm: null, sig: '', result: null, resultKey: '' });

const shapePref = () => { const v = sess.get('sp_shape', 'eng'); return P.SHAPES.includes(v) ? v : 'eng'; };

const sess = createSession({
  game: 'sp',
  maxPlayers: 1,
  newGame: (players) => { S.ui.sel = null; S.ui.note = ''; S.ui.confirm = null; S.ui.sig = ''; return P.createGame(players, S.learn ? 'eng' : shapePref()); },
  onMessage: (state, pid, msg) => {
    const r = P.handle(state, pid, msg);
    if (r.ok && msg.t === 'shape' && !S.learn) sess.set('sp_shape', msg.shape);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();
// Beim Alleinspiel ohne Namensfeld: Ohne gespeicherten Namen würde ein Neuladen nicht ins Spiel zurückführen.
if (!S.name) { S.name = 'Du'; sess.set('name', 'Du'); }

// ====================== Zustandswechsel ======================
function recordIfOver(g) {
  if (g.mode !== 'over') { S.ui.result = null; S.ui.resultKey = ''; return; }
  const key = `${g.shape}|${g.moves.length}|${g.board.join('')}|${S.learn ? 1 : 0}`;
  if (S.ui.resultKey === key) return;
  S.ui.resultKey = key;
  const cur = P.resultOf(g);
  if (S.learn) { S.ui.result = { cur, prev: null, record: false, learn: true }; return; }
  let all = sess.get('sp_best', {});
  if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
  const prev = all[g.shape] && Number.isFinite(all[g.shape].stones) ? all[g.shape] : null;
  const record = P.better(cur, prev);
  if (record) { all[g.shape] = cur; sess.set('sp_best', all); }
  S.ui.result = { cur, prev: record ? null : prev, record, learn: false };
}

function onStateChanged() {
  const g = S.game;
  if (g && Array.isArray(g.moves)) {
    const sig = `${g.shape}|${g.moves.length}|${g.moves.length ? g.moves[g.moves.length - 1].join('-') : ''}|${g.mode}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; S.ui.note = ''; S.ui.confirm = null; }
    if (S.ui.sel !== null && !P.movesFrom(g, S.ui.sel).length) S.ui.sel = null;
    recordIfOver(g);
  }
  render();
}

// ====================== Darstellung ======================
const U = 60; // Kantenlänge eines Rasterfeldes im SVG
const cx = (i) => P.colOf(i) * U + U / 2;
const cy = (i) => P.rowOf(i) * U + U / 2;

function boardHtml(g, interactive) {
  const play = g.mode === 'play';
  const movable = new Set(play && interactive ? P.movableStones(g) : []);
  const sel = play && interactive && S.ui.sel !== null && movable.has(S.ui.sel) ? S.ui.sel : null;
  const targets = new Set(sel !== null ? P.targetsFrom(g, sel) : []);
  const holes = [];
  for (let i = 0; i < P.CELLS; i++) if (g.board[i] !== -1) holes.push(i);
  const edge = holes.map((i) => `<rect x="${P.colOf(i) * U - 5}" y="${P.rowOf(i) * U - 5}" width="${U + 10}" height="${U + 10}" rx="12" class="sp-edge"/>`).join('');
  const wood = holes.map((i) => `<rect x="${P.colOf(i) * U - 0.5}" y="${P.rowOf(i) * U - 0.5}" width="${U + 1}" height="${U + 1}" class="sp-wood"/>`).join('');
  const holesSvg = holes.map((i) => `<circle class="sp-hole" cx="${cx(i)}" cy="${cy(i)}" r="${U * 0.27}"/>`).join('');
  const stones = holes.filter((i) => g.board[i] === 1).map((i) =>
    `<g class="sp-stone"><circle class="sp-st" cx="${cx(i)}" cy="${cy(i)}" r="${U * 0.38}"/><circle class="sp-shine" cx="${cx(i) - U * 0.1}" cy="${cy(i) - U * 0.11}" r="${U * 0.12}"/></g>`).join('');
  let marks = '';
  const last = P.lastMove(g);
  if (last) {
    const [f, o, t] = last;
    marks += `<circle class="sp-last-from" cx="${cx(f)}" cy="${cy(f)}" r="${U * 0.33}"/>`;
    marks += `<path class="sp-last-over" d="M${cx(o) - 9} ${cy(o) - 9}L${cx(o) + 9} ${cy(o) + 9}M${cx(o) + 9} ${cy(o) - 9}L${cx(o) - 9} ${cy(o) + 9}"/>`;
    marks += `<circle class="sp-last-to" cx="${cx(t)}" cy="${cy(t)}" r="${U * 0.45}"/>`;
  }
  let hl = '';
  for (const i of movable) hl += `<circle class="sp-can${sel === i ? ' sp-sel' : ''}" cx="${cx(i)}" cy="${cy(i)}" r="${U * 0.46}"/>`;
  for (const i of targets) hl += `<circle class="sp-tgt" cx="${cx(i)}" cy="${cy(i)}" r="${U * 0.31}"/>`;
  const hits = holes.map((i) => {
    const r = P.rowOf(i) + 1, c = P.colOf(i) + 1;
    const hint = targets.has(i) ? 'target' : sel === i ? 'sel' : movable.has(i) ? 'can' : '';
    const act = hint !== '';
    const what = g.board[i] === 1 ? 'Stein' : 'freies Loch';
    const label = `${what}, Zeile ${r}, Spalte ${c}${hint === 'can' ? ', kann springen' : hint === 'target' ? ', hierhin springen' : hint === 'sel' ? ', ausgewählt' : ''}`;
    return `<circle class="sp-hit${act ? ' act' : ''}" data-act="${interactive ? 'pt' : 'noop'}" data-i="${i}"${hint ? ` data-hint="${hint}"` : ''} cx="${cx(i)}" cy="${cy(i)}" r="${U * 0.5}"${act ? ` tabindex="0" role="button"` : ''} aria-label="${label}"/>`;
  }).join('');
  return `<svg class="sp-board${play ? '' : ' sp-ended'}" id="board" viewBox="0 0 ${U * P.SIZE} ${U * P.SIZE}" role="group" aria-label="Spielbrett mit ${P.holeCount(g.shape)} Löchern">${edge}${wood}${holesSvg}${marks}${stones}${hl}${hits}</svg>`;
}

const stoneWord = (n) => (n === 1 ? '1 Stein' : `${n} Steine`);

function statsHtml(g) {
  const left = P.stonesLeft(g);
  return `<section class="card sp-stats" aria-live="polite"><div class="sp-stat">Noch <b>${left}</b> ${left === 1 ? 'Stein' : 'Steine'}</div>
    <div class="sp-stat">Züge: <b>${g.moves.length}</b></div></section>`;
}

function hintText(g) {
  if (S.ui.note) return S.ui.note;
  if (S.ui.sel !== null) return 'Tippe auf ein grünes Loch, dorthin springt der Stein. Tippe den Stein noch einmal an, um ihn abzuwählen.';
  return 'Tippe auf einen Stein mit orangem Rand. Nur diese Steine können springen.';
}

function shapeHtml(g) {
  if (S.learn) return '';
  const btn = (sh, n) => `<button class="btn sp-segbtn" data-act="shape" data-shape="${sh}" aria-pressed="${g.shape === sh}">${P.SHAPE_NAMES[sh]}<small>${n} Löcher</small></button>`;
  return `<section class="card sp-shape"><h2>Brettform</h2><div class="sp-seg">${btn('eng', 33)}${btn('fra', 37)}</div>
    <p class="muted small">Die Brettform gilt für die nächste Runde. Beim Wechseln fängst du neu an.</p></section>`;
}

function confirmHtml(g) {
  const c = S.ui.confirm;
  if (!c) return '';
  const what = c === 'restart' ? 'Wirklich neu anfangen?' : `Wirklich auf das ${c === 'shape:fra' ? 'französische' : 'englische'} Brett wechseln?`;
  return `<div class="confirm sp-confirm" role="alertdialog" aria-label="${what}"><p class="big"><b>${what}</b><br>Alle bisherigen Züge gehen verloren.</p>
    <button class="btn primary huge" data-act="confirm-yes">Ja, neu anfangen</button>
    <button class="btn secondary" data-act="confirm-no">Nein, weiterspielen</button></div>`;
}

function playHtml(g) {
  const n = g.moves.length;
  return `${statsHtml(g)}
    <section class="card sp-boardcard">${boardHtml(g, true)}</section>
    <section class="card action sp-actions"><p class="big sp-hint" role="status">${esc(hintText(g))}</p>
      <div class="sp-legend"><span class="l-can">kann springen</span><span class="l-tgt">Ziel</span><span class="l-last">letzter Zug</span></div>
      <div class="sp-btnrow">
        <button class="btn" data-act="undo" ${n === 0 ? 'disabled' : ''}>↶ Rückgängig</button>
        <button class="btn" data-act="restart" ${n === 0 ? 'disabled' : ''}>Neu anfangen</button>
      </div>${confirmHtml(g)}
    </section>${shapeHtml(g)}`;
}

function bestText(r) {
  if (r.learn) return '';
  if (r.record) return `<p class="center big sp-best">Neue Bestleistung! 🎉</p>`;
  if (r.prev) return `<p class="center big sp-best">Deine Bestleistung: <b>${stoneWord(r.prev.stones)}</b>${r.prev.center ? ' (in der Mitte)' : ''}</p>`;
  return '';
}

function overHtml(g) {
  const rt = P.rating(g);
  const r = S.ui.result || { learn: false, record: false, prev: null };
  const where = rt.stones === 1 ? (rt.center ? ' genau in der Mitte' : ' nicht in der Mitte') : '';
  const trophy = rt.key === 'grand' ? '🏆' : rt.key === 'master' ? '🥇' : rt.stones <= 4 ? '👏' : '🙂';
  return `${statsHtml(g)}
    <section class="card sp-boardcard">${boardHtml(g, false)}</section>
    <section class="card over sp-over"><div class="trophy">${trophy}</div><h1>${esc(rt.title)}!</h1>
      <p class="center big sp-result">Kein Zug mehr möglich. ${rt.stones === 1 ? 'Es ist noch <b>1 Stein</b> übrig' : `Es sind noch <b>${rt.stones} Steine</b> übrig`}${where}.</p>
      <p class="center">${esc(rt.text)}</p>
      ${bestText(r)}
      <button class="btn primary huge" data-act="again">🔴 Noch eine Runde</button>
      <button class="btn secondary" data-act="undo">↶ Letzten Zug zurücknehmen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>${shapeHtml(g)}`;
}

function gameHtml() {
  const g = S.game;
  return `${ui.header()}${g.mode === 'over' ? overHtml(g) : playHtml(g)}`;
}

const exStone = (x, y) => `<circle cx="${x}" cy="${y}" r="20" fill="#a51c1c" stroke="#ffe9d6" stroke-width="3"/>`;
const exHole = (x, y) => `<circle cx="${x}" cy="${y}" r="15" fill="#7d5c30" stroke="#4d3519" stroke-width="2"/>`;
const exRow = (cells) => `<svg class="sp-ex" viewBox="0 0 180 50" aria-hidden="true"><rect x="2" y="2" width="176" height="46" rx="10" fill="#e9d3a6" stroke="#6b4a22" stroke-width="3"/>${cells.map((c, k) => (c ? exStone : exHole)(30 + k * 60, 25)).join('')}</svg>`;

function helpBody() {
  return `
    <p><b>Ziel:</b> Springe so, dass am Ende möglichst nur noch <b>ein Stein</b> auf dem Brett liegt – am besten in der Mitte.</p>
    <h3>So springst du</h3>
    <ol>
      <li>Tippe auf einen Stein. Nur Steine, die springen können, haben einen orangen Rand.</li>
      <li>Grüne Löcher zeigen dir, wohin der Stein springen darf. Tippe auf eines davon.</li>
      <li>Der Stein springt dorthin. Der Stein, über den er gesprungen ist, wird weggenommen.</li>
    </ol>
    <p>Beispiel – vorher: Zwei Steine liegen nebeneinander, dahinter ist ein freies Loch.</p>
    ${exRow([true, true, false])}
    <p>Nachher: Der erste Stein sitzt im freien Loch. Der mittlere Stein ist weg.</p>
    ${exRow([false, false, true])}
    <h3>Was ist erlaubt?</h3>
    <ul>
      <li>Ein Stein springt nach oben, unten, links oder rechts, aber nicht schräg.</li>
      <li>Er springt über genau einen Stein, der direkt neben ihm liegt.</li>
      <li>Das Loch direkt dahinter muss frei sein.</li>
    </ul>
    <h3>Ende des Spiels</h3>
    <p>Das Spiel ist zu Ende, wenn kein Sprung mehr möglich ist. Je weniger Steine übrig sind, desto besser: Ein Stein in der Mitte ist das beste Ergebnis. Das Programm sagt dir dann, wie gut du warst, und merkt sich deine Bestleistung.</p>
    <h3>Hilfen</h3>
    <ul>
      <li><b>Rückgängig:</b> nimmt den letzten Zug zurück. Das geht so oft, wie du möchtest.</li>
      <li><b>Neu anfangen:</b> legt alle Steine neu hin. Du wirst vorher gefragt.</li>
      <li><b>Brettform:</b> Das englische Brett hat 33 Löcher, das französische 37. Das französische Brett ist etwas kniffliger.</li>
    </ul>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Sprünge. Wie du spielst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
function onPoint(i) {
  const g = S.game;
  if (!g || g.mode !== 'play' || !Number.isInteger(i)) return;
  const sel = S.ui.sel;
  S.ui.note = '';
  S.ui.confirm = null;
  if (sel !== null && P.targetsFrom(g, sel).includes(i)) {
    S.ui.sel = null;
    return sess.send({ t: 'move', from: sel, to: i });
  }
  if (i === sel) { S.ui.sel = null; return render(); }
  if (g.board[i] === 1) {
    if (P.movesFrom(g, i).length) { S.ui.sel = i; return render(); }
    S.ui.note = 'Dieser Stein kann gerade nicht springen. Hinter seinen Nachbarn ist kein freies Loch.';
    return render();
  }
  S.ui.note = sel !== null ? 'Dorthin darf der Stein nicht springen. Tippe auf ein grünes Loch.' : '';
  return render();
}

const ui = createUI({
  soloOnly: true,
  sess, $app,
  title: 'Springspiel', icon: '🔴', sub: 'Steckspiel-Solitär – allein knobeln',
  helpTitle: 'Die Spielregeln vom Springspiel', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'pt': return onPoint(Number(el.dataset.i));
      case 'undo': S.ui.confirm = null; return sess.send({ t: 'undo' });
      case 'restart': if (g && g.moves.length) { S.ui.confirm = 'restart'; render(); } return;
      case 'shape': {
        const sh = el.dataset.shape;
        if (!g || !P.SHAPES.includes(sh) || sh === g.shape) return;
        if (g.mode === 'play' && g.moves.length) { S.ui.confirm = `shape:${sh}`; return render(); }
        return sess.send({ t: 'shape', shape: sh });
      }
      case 'confirm-yes': {
        const c = S.ui.confirm;
        S.ui.confirm = null;
        if (c === 'restart') return sess.send({ t: 'restart' });
        if (typeof c === 'string' && c.startsWith('shape:')) return sess.send({ t: 'shape', shape: c.slice(6) });
        return render();
      }
      case 'confirm-no': S.ui.confirm = null; return render();
    }
  },
});
function render() { ui.render(); }
ui.boot();
