import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'sv',
  maxPlayers: 2,
  // prev = das vorige, beendete Spiel (liefert Punktestand und Rundenzahl)
  newGame: (players, opts) => {
    const prev = S.game && S.game.mode === 'over' ? S.game : null;
    resetUi();
    // Wer beginnt, wechselt in jeder Runde (wer zuerst in der Liste steht, schießt zuerst)
    let list = players;
    if (prev && list.length === 2 && prev.players.length === 2 && list[0].id === prev.players[0].id && list[1].id === prev.players[1].id) list = [list[1], list[0]];
    return M.createGame(list, opts, Math.random, prev);
  },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 900,
    // Der Computer stellt auf und schießt – nur mit seiner eigenen Sicht (ai.js)
    step: (g, level) => {
      if (!g || g.mode === 'over') return null;
      const bot = g.players.find((p) => String(p.id).startsWith('bot'));
      if (!bot) return null;
      const msg = chooseAction(g, bot.id, level);
      return msg ? { id: bot.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
function resetUi() { S.ui = { ...(S.ui || {}), sel: null, ship: null, dir: 'h', bad: null, hint: '', sig: '' }; }
resetUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = g.mode === 'play' ? `p|${g.moveNo}|${g.turn}` : g.mode;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; S.ui.hint = ''; if (g.mode !== 'setup') S.ui.bad = null; }
  }
  const view = `${S.screen}|${g ? g.mode : ''}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Spielfelder ======================
const WORD = { w: 'Wasser', h: 'Treffer', s: 'versenkt' };

function gridHtml(id, cls, label, cellFn) {
  const head = `<span class="sv-corner" aria-hidden="true"></span>${[...M.COLS].map((l) => `<span class="sv-lab" aria-hidden="true">${l}</span>`).join('')}`;
  let rows = '';
  for (let y = 0; y < M.SIZE; y++) {
    rows += `<span class="sv-lab" aria-hidden="true">${y + 1}</span>`;
    for (let x = 0; x < M.SIZE; x++) rows += cellFn(x, y, M.cellOf(x, y));
  }
  return `<div class="sv-grid ${cls}"${id ? ` id="${id}"` : ''} role="group" aria-label="${label}">${head}${rows}</div>`;
}

const mark = (r) => (r === 'w' ? '<i class="sv-dot"></i>' : r === 'h' || r === 's' ? '<b class="sv-x">✕</b>' : '');

// Eigenes Feld (kleiner, nur zum Ansehen) – im Aufbau mit Schiffen, später mit gegnerischen Schüssen
function ownCells(g, me) {
  const fleet = g.fleets[me];
  const shots = g.grid[M.other(me)];
  const shipAt = new Map();
  fleet.forEach((s, k) => M.cellsOf(s).forEach((c) => shipAt.set(c, k)));
  const last = g.last && g.last.by !== me ? g.last.cell : -1;
  return (x, y, c) => {
    const k = shipAt.get(c);
    const r = shots[c];
    const cl = ['sv-c'];
    if (k !== undefined) cl.push('ship');
    if (r) cl.push(r);
    if (c === last) cl.push('last');
    const lab = `${M.cellName(c)}: ${k !== undefined ? 'dein Schiff' : 'Wasser'}${r ? `, ${r === 'w' ? 'beschossen' : 'Treffer'}` : ''}`;
    return `<span class="${cl.join(' ')}" aria-label="${lab}">${mark(r)}</span>`;
  };
}

// Aufstellen: eigenes großes Feld mit Schiffen, Auswahl und roter Vorschau
function setupBoard(g, me) {
  const fleet = g.fleets[me];
  const shipAt = new Map();
  fleet.forEach((s, k) => M.cellsOf(s).forEach((c) => shipAt.set(c, k)));
  const bad = new Set((S.ui.bad && S.ui.bad.cells) || []);
  const canEdit = !g.ready[me];
  const heads = new Set(fleet.map((s) => (M.placed(s) ? M.cellOf(s.x, s.y) : -1)));
  return gridHtml('board', 'sv-big sv-setup', 'Dein Meer zum Aufstellen', (x, y, c) => {
    const k = shipAt.get(c);
    const cl = ['sv-c'];
    if (k !== undefined) { cl.push('ship'); if (k === S.ui.ship) cl.push('picked'); }
    if (bad.has(c)) cl.push('bad');
    const inner = bad.has(c) ? '<b class="sv-x">✕</b>' : k !== undefined && heads.has(c) ? `<span class="sv-len">${fleet[k].len}</span>` : '';
    const lab = `${M.cellName(c)}: ${bad.has(c) ? 'hier geht es nicht' : k !== undefined ? fleet[k].name : 'Wasser'}`;
    return canEdit
      ? `<button class="${cl.join(' ')}" data-act="cell" data-x="${x}" data-y="${y}" aria-label="${lab}">${inner}</button>`
      : `<span class="${cl.join(' ')}" aria-label="${lab}">${inner}</span>`;
  });
}

// Zielfeld: das Meer des Gegners. Zeigt nur eigene Schüsse und deren Ergebnis.
function targetBoard(g, me, interactive) {
  const shots = g.grid[me];
  const last = g.last && g.last.by === me ? g.last.cell : -1;
  return gridHtml('board', 'sv-big sv-target', `Meer von ${g.players[M.other(me)].name} zum Schießen`, (x, y, c) => {
    const r = shots[c];
    const cl = ['sv-c'];
    if (r) cl.push(r);
    if (c === last) cl.push('last');
    if (interactive && S.ui.sel === c) cl.push('sel');
    const lab = `${M.cellName(c)}: ${r ? (r === 'w' ? 'Wasser' : r === 'h' ? 'Treffer' : 'Treffer, Schiff versenkt') : S.ui.sel === c ? 'gewählt' : 'noch nicht beschossen'}`;
    const inner = S.ui.sel === c && !r && interactive ? '<b class="sv-aim">◎</b>' : mark(r);
    return interactive
      ? `<button class="${cl.join(' ')}" data-act="cell" data-x="${x}" data-y="${y}" aria-label="${lab}">${inner}</button>`
      : `<span class="${cl.join(' ')}" aria-label="${lab}">${inner}</span>`;
  });
}

function shipChip(def, sunk) {
  return `<span class="sv-chip${sunk ? ' gone' : ''}" aria-label="${def.name}, ${def.len} Felder, ${sunk ? 'versenkt' : 'schwimmt noch'}">
    <span class="sv-sq">${sunk ? '<b>✕</b>' : '<i></i>'.repeat(def.len)}</span><span class="sv-cn">${def.name}</span></span>`;
}
function fleetRow(g, i, title) {
  const sunkIds = new Set(g.sunk[M.other(i)].map((u) => u.id));
  const left = M.FLEET.filter((f) => !sunkIds.has(f.id)).length;
  return `<div class="sv-frow"><h3>${esc(title)}: ${left} von 5 Schiffen schwimmen noch</h3>
    <div class="sv-chips">${M.FLEET.map((f) => shipChip(f, sunkIds.has(f.id))).join('')}</div></div>`;
}

// ====================== Darstellung ======================
const resultWord = (l) => (l.r === 'w' ? 'Wasser' : l.r === 'h' ? 'Treffer' : `Treffer, versenkt: ${l.ship}`);
function lastHtml(g, me) {
  const l = g.last;
  if (!l) return `<span class="sv-who">Los geht’s!</span> <span class="sv-res">${esc(g.players[g.turn].name)} schießt zuerst.</span>`;
  const who = l.by === me ? 'Dein Schuss:' : `Schuss von ${esc(g.players[l.by].name)}:`;
  return `<span class="sv-who">${who}</span> <span class="sv-res">${M.cellName(l.cell)}: ${resultWord(l)}</span>`;
}

function bannerHtml(g, me) {
  if (g.mode === 'over') return `<div class="banner done">Die Runde ist zu Ende!</div>`;
  if (g.mode === 'setup') {
    if (!g.ready[me]) return `<div class="banner mine">Stelle deine Flotte auf</div>`;
    const o = g.players[M.other(me)];
    return `<div class="banner">Warte auf ${esc(o.name)} …</div>`;
  }
  const ap = g.players[g.turn];
  return ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} schießt …</div>`;
}

function scoreHtml(g) {
  return `<p class="sv-score">Runde ${g.round}: ${g.players.map((p) => `<b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b> ${g.score[p.id] || 0}`).join(' : ')}</p>`;
}

function setupHtml(g, me) {
  const fleet = g.fleets[me];
  const ready = g.ready[me];
  const all = M.allPlaced(fleet);
  if (S.ui.ship === null) { const k = fleet.findIndex((s) => !M.placed(s)); if (k >= 0) S.ui.ship = k; }
  const msg = ready
    ? 'Du bist fertig. Gleich geht es los.'
    : S.ui.hint || (all ? 'Alle Schiffe stehen. Tippe auf „Fertig“, wenn du zufrieden bist.' : 'Tippe ein Schiff an, dann ein Feld im Meer. Das Schiff beginnt auf dem Feld, das du antippst.');
  const ships = ready ? '' : `<section class="card sv-shipcard"><h2>Deine Schiffe</h2><div class="sv-ships">${fleet.map((s, k) => `
      <button class="sv-shipbtn${k === S.ui.ship ? ' on' : ''}${M.placed(s) ? ' done' : ''}" data-act="ship" data-i="${k}" aria-pressed="${k === S.ui.ship}">
        <span class="sv-sq">${'<i></i>'.repeat(s.len)}</span><span class="sv-cn">${s.name} (${s.len})</span><span class="sv-st">${M.placed(s) ? '✔ steht' : 'noch nicht'}</span></button>`).join('')}</div></section>`;
  const btns = ready ? '' : `<section class="card sv-btns">
      <button class="btn secondary sv-rot" data-act="rotate">↻ Drehen: ${S.ui.dir === 'h' ? 'waagerecht' : 'senkrecht'}</button>
      <button class="btn secondary" data-act="random">🎲 Zufällig aufstellen</button>
      <button class="btn primary huge" data-act="ready" ${all ? '' : 'disabled'}>Fertig, los geht’s</button></section>`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g, me)}
    <div class="sv-msg action" aria-live="polite"><p class="big">${esc(msg)}</p><p class="sv-sel"></p></div>
    <section class="card sv-boardcard">${setupBoard(g, me)}</section>
    ${ships}${btns}
    ${scoreHtml(g)}`;
}

function playHtml(g, me) {
  const myTurn = g.turn === me;
  const sel = S.ui.sel;
  const selTxt = S.ui.hint ? S.ui.hint : sel !== null ? `Gewählt: ${M.cellName(sel)}` : myTurn ? 'Tippe ein Feld im großen Meer an.' : 'Bitte warte kurz.';
  return `${ui.header()}${ui.lost()}${bannerHtml(g, me)}
    <div class="sv-msg action" aria-live="polite"><p class="big">${lastHtml(g, me)}</p><p class="sv-sel${S.ui.hint ? ' warn' : ''}">${esc(selTxt)}</p></div>
    <section class="card sv-boardcard"><h2 class="sv-h">Meer von ${esc(g.players[M.other(me)].name)}</h2>${targetBoard(g, me, myTurn)}
      <button class="btn primary huge sv-fire" data-act="fire" ${myTurn && sel !== null ? '' : 'disabled'}>Hier schießen</button>
      <div class="sv-legend"><span><i class="sv-dot"></i> Wasser</span><span><b class="sv-x">✕</b> Treffer</span><span><b class="sv-x dark">✕</b> versenkt</span></div></section>
    <section class="card sv-ownwrap"><h2 class="sv-h">Dein Meer</h2>${gridHtml('ownboard', 'sv-own', 'Dein eigenes Meer', ownCells(g, me))}</section>
    <section class="card sv-fleets"><h2>Restflotte</h2>${fleetRow(g, me, 'Du')}${fleetRow(g, M.other(me), g.players[M.other(me)].name)}${scoreHtml(g)}</section>`;
}

function overHtml(g, me) {
  const w = g.winner;
  const title = w === me ? 'Du hast gewonnen! Glückwunsch!' : `${esc(g.players[w].name)} hat gewonnen!`;
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde</button>`
    : `<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>`;
  const rows = g.players.map((p) => `<tr><td>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</td><td class="n">${g.score[p.id] || 0}</td></tr>`).join('');
  return `${ui.header()}${ui.lost()}${bannerHtml(g, me)}
    <section class="card over sv-over"><div class="trophy">🏆</div><h1>${title}</h1>
      <p class="center muted">Alle 17 Schiffsfelder von ${w === me ? esc(g.players[M.other(me)].name) : 'dir'} wurden getroffen.</p>
      <table class="sv-table"><caption>Punktestand nach Runde ${g.round}</caption><tr><th>Name</th><th class="n">Runden gewonnen</th></tr>${rows}</table>
      ${again}
      <button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>
    <section class="card sv-boardcard"><h2 class="sv-h">Deine Schüsse</h2>${targetBoard(g, me, false)}</section>
    <section class="card sv-ownwrap"><h2 class="sv-h">Dein Meer</h2>${gridHtml('ownboard', 'sv-own', 'Dein eigenes Meer', ownCells(g, me))}</section>`;
}

function gameHtml() {
  const g = S.game;
  const me = myIndex();
  if (me < 0) return `${ui.header()}<div class="notice warn">Du spielst in diesem Spiel nicht mit.</div>`;
  if (g.mode === 'over') return overHtml(g, me);
  if (g.mode === 'setup') return setupHtml(g, me);
  return playHtml(g, me);
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Versenke alle Schiffe deines Gegenübers, bevor dein Gegenüber alle deine Schiffe versenkt.</p>
    <h3>Das Meer</h3>
    <p>Jede Person hat ein Meer mit 10 mal 10 Feldern. Die Spalten heißen A bis J, die Zeilen 1 bis 10. Ein Feld heißt zum Beispiel „Spalte C, Zeile 4“.</p>
    <h3>Die Flotte</h3>
    <p>Jede Person hat 5 Schiffe: ein Schlachtschiff (5 Felder), einen Kreuzer (4 Felder), zwei Zerstörer (je 3 Felder) und ein U-Boot (2 Felder). Zusammen sind das 17 Felder.</p>
    <h3>Schiffe aufstellen</h3>
    <ul>
      <li>Tippe ein Schiff in der Liste an, dann ein Feld im Meer. Das Schiff beginnt auf diesem Feld und liegt von dort nach rechts oder nach unten.</li>
      <li>Mit „Drehen“ wechselst du zwischen waagerecht und senkrecht.</li>
      <li>Schiffe dürfen nicht übereinander liegen und müssen sich nicht berühren, auch nicht an den Ecken. Es muss also ein Feld Abstand bleiben. (Der Gastgeber kann beim Einstellen der Regeln erlauben, dass sich Schiffe berühren dürfen.)</li>
      <li>Passt ein Schiff nicht, wird die Stelle rot und du siehst, warum.</li>
      <li>Ein bereits gesetztes Schiff verschiebst du, indem du es antippst und dann ein neues Feld.</li>
      <li>Mit „Zufällig aufstellen“ stellt das Programm alle Schiffe für dich auf. Du kannst das so oft wiederholen, wie du magst.</li>
      <li>Wenn alle 5 Schiffe stehen, tippe auf „Fertig, los geht’s“. Das Spiel beginnt, sobald beide fertig sind.</li>
    </ul>
    <h3>Schießen</h3>
    <p>Ihr schießt abwechselnd. Tippe im großen Meer ein Feld an. Es wird markiert. Dann tippe auf den großen Knopf „Hier schießen“. So schießt du nicht aus Versehen auf das falsche Feld. Du kannst auch ein anderes Feld antippen, bevor du schießt.</p>
    <h3>Was bedeutet die Meldung?</h3>
    <ul>
      <li><b>Wasser</b> (blaues Feld mit Punkt): Dort liegt kein Schiff.</li>
      <li><b>Treffer</b> (rotes Feld mit Kreuz): Dort liegt ein Schiff.</li>
      <li><b>Treffer, versenkt</b> (dunkelrotes Feld mit Kreuz): Alle Felder dieses Schiffs sind getroffen. Du erfährst, welches Schiff es war.</li>
    </ul>
    <p>Nach jedem Schuss ist die andere Person dran. (Der Gastgeber kann einstellen, dass man nach einem Treffer noch einmal schießen darf.) Unter dem großen Meer siehst du dein eigenes Meer mit deinen Schiffen und den Schüssen des Gegenübers. Darunter steht, welche Schiffe auf beiden Seiten noch schwimmen.</p>
    <h3>Wer gewinnt?</h3>
    <ul>
      <li>Wer zuerst alle 17 Schiffsfelder des anderen getroffen hat, gewinnt die Runde.</li>
      <li>Mit „Noch eine Runde“ geht es weiter. Der Punktestand bleibt, und die andere Person beginnt.</li>
    </ul>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur erlaubte Züge möglich sind, meldet jeden Schuss und erkennt versenkte Schiffe und das Spielende von allein.</p>
`;
}

// ====================== Bedienung ======================
const cellFromEl = (el) => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) });
const clip = (len, x, y, dir) => {
  const out = [];
  for (let k = 0; k < len; k++) {
    const cx = dir === 'h' ? x + k : x;
    const cy = dir === 'v' ? y + k : y;
    if (cx < M.SIZE && cy < M.SIZE) out.push(M.cellOf(cx, cy));
  }
  return out;
};

function tapShot(x, y) {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode !== 'play' || me < 0) return;
  const c = M.cellOf(x, y);
  if (g.turn !== me) S.ui.hint = 'Du bist gerade nicht dran. Bitte warte kurz.';
  else if (g.grid[me][c] !== null) S.ui.hint = 'Auf dieses Feld hast du schon geschossen. Wähle ein anderes.';
  else { S.ui.hint = ''; S.ui.sel = S.ui.sel === c ? null : c; }
  render();
}

function tapSetup(x, y) {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode !== 'setup' || me < 0 || g.ready[me]) return;
  const fleet = g.fleets[me];
  const c = M.cellOf(x, y);
  const occ = fleet.findIndex((s) => M.cellsOf(s).includes(c));
  S.ui.hint = ''; S.ui.bad = null;
  if (occ >= 0 && occ !== S.ui.ship) { S.ui.ship = occ; S.ui.dir = fleet[occ].dir; return render(); }
  if (S.ui.ship === null) { S.ui.hint = 'Wähle zuerst ein Schiff aus der Liste aus.'; return render(); }
  const k = S.ui.ship;
  const r = M.checkPlacement(fleet, k, x, y, S.ui.dir, g.opts.touch);
  if (!r.ok) {
    S.ui.hint = r.error;
    S.ui.bad = { cells: clip(fleet[k].len, x, y, S.ui.dir) };
    return render();
  }
  // nach dem Setzen gleich das nächste noch nicht gesetzte Schiff vorwählen
  const next = fleet.findIndex((s, i) => i !== k && !M.placed(s));
  if (next >= 0) S.ui.ship = next;
  return sess.send({ t: 'place', ship: k, x, y, dir: S.ui.dir });
}

function rotate() {
  const g = S.game;
  const me = myIndex();
  if (!g || g.mode !== 'setup' || me < 0 || g.ready[me]) return;
  S.ui.hint = ''; S.ui.bad = null;
  if (S.ui.ship === null) { S.ui.hint = 'Wähle zuerst ein Schiff aus der Liste aus.'; return render(); }
  S.ui.dir = S.ui.dir === 'h' ? 'v' : 'h';
  const s = g.fleets[me][S.ui.ship];
  if (M.placed(s)) {
    const r = M.checkPlacement(g.fleets[me], S.ui.ship, s.x, s.y, S.ui.dir, g.opts.touch);
    if (r.ok) return sess.send({ t: 'place', ship: S.ui.ship, x: s.x, y: s.y, dir: S.ui.dir });
    S.ui.hint = 'Gedreht passt das Schiff hier nicht. Tippe ein anderes Feld an, um es dorthin zu setzen.';
    S.ui.bad = { cells: clip(s.len, s.x, s.y, S.ui.dir) };
  }
  return render();
}

const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  options: [
    { id: 'touch', label: 'Schiffe dürfen sich berühren', help: 'Aus: Zwischen zwei Schiffen bleibt mindestens ein Feld frei.', def: false },
    { id: 'again', label: 'Treffer = nochmal schießen', help: 'Aus: Nach jedem Schuss ist die andere Person dran.', def: false },
  ],
  tutorial: { bots: 1, coach },
  title: 'Schiffe versenken', icon: '🚢', sub: 'Das klassische Spiel für zwei – online',
  helpTitle: 'Die Spielregeln von Schiffe versenken', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'cell': { const { x, y } = cellFromEl(el); return S.game && S.game.mode === 'setup' ? tapSetup(x, y) : tapShot(x, y); }
      case 'ship': S.ui.ship = Number(el.dataset.i); S.ui.hint = ''; S.ui.bad = null; { const s = S.game.fleets[myIndex()][S.ui.ship]; if (s && M.placed(s)) S.ui.dir = s.dir; } return render();
      case 'rotate': return rotate();
      case 'random': S.ui.hint = ''; S.ui.bad = null; S.ui.ship = null; return sess.send({ t: 'random' });
      case 'ready': return sess.send({ t: 'ready' });
      case 'fire': {
        const g = S.game; const me = myIndex();
        if (!g || g.mode !== 'play' || g.turn !== me || S.ui.sel === null) return undefined;
        const c = S.ui.sel; S.ui.sel = null;
        return sess.send({ t: 'shoot', x: M.xOf(c), y: M.yOf(c) });
      }
    }
    return undefined;
  },
});
function render() { ui.render(); }
// Der Schließen-Knopf im Hilfefenster liegt im Fenster, dessen Klick nicht nach oben weitergereicht wird (ui.js).
$app.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('.modal [data-act="help-close"]');
  if (!b) return;
  ev.stopPropagation();
  S.ui.helpOpen = false;
  render();
}, true);
ui.boot();
