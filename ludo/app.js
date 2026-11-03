import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ rolling: false, lastRollKey: '', noMove: null });

const sess = createSession({
  game: 'ludo',
  maxPlayers: 4,
  newGame: (players) => { S.ui = { ...S.ui, ...freshUi() }; return P.createGame(players); },
  onMessage: (state, pid, msg) => { P.handle(state, pid, msg); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const U = 40; // Kantenlänge eines Rasterfelds im SVG

// ====================== Zustandswechsel ======================
let rollTimer = null;
let noMoveTimer = null;

function onStateChanged() {
  const g = S.game;
  if (g && g.last && g.last.kind !== 'move') {
    const key = `${g.gid}|${g.rollId}`;
    if (key !== S.ui.lastRollKey) {
      const resumed = S.ui.lastRollKey === '' && g.rollId > 1;
      S.ui.lastRollKey = key;
      if (!resumed) { animateDice(); return; }
    }
  } else if (g && g.last) {
    S.ui.lastRollKey = `${g.gid}|${g.rollId}`;
  }
  render();
}

function animateDice() {
  S.ui.rolling = true;
  S.ui.noMove = null;
  render();
  let n = 0;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    n++;
    const el = document.getElementById('dice');
    if (el) el.innerHTML = dieHtml(1 + Math.floor(Math.random() * 6), true);
    if (n >= 9) {
      clearInterval(rollTimer);
      S.ui.rolling = false;
      const l = S.game?.last;
      if (l && l.kind === 'nomove' && l.rollId === S.game.rollId) {
        S.ui.noMove = { rollId: l.rollId, mine: l.pid === cid, name: l.name, again: l.again };
        clearTimeout(noMoveTimer);
        noMoveTimer = setTimeout(() => { S.ui.noMove = null; render(); }, 3000);
      }
      render();
    }
  }, 90);
}

// ====================== Darstellung ======================
function pips(v) {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  return Array.from({ length: 9 }, (_, i) => `<b class="${on.includes(i) ? 'on' : ''}"></b>`).join('');
}
function dieHtml(v, spin) {
  if (!v) return `<span class="die d-white lu-die lu-die-empty" role="img" aria-label="Noch nicht gewürfelt">?</span>`;
  return `<span class="${spin ? 'spin ' : ''}lu-spinwrap"><span class="die d-white lu-die" role="img" aria-label="Gewürfelt: ${v}">${pips(v)}</span></span>`;
}

// Figur als SVG-Form (Form + Buchstabe, damit sie auch ohne Farbsehen lesbar ist)
function shapeSvg(color, cx, cy, r) {
  const sh = P.SHAPES[color];
  let body;
  if (sh === 'circle') body = `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  else if (sh === 'square') body = `<rect x="${cx - r * 0.9}" y="${cy - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}" rx="${r * 0.25}"/>`;
  else if (sh === 'triangle') body = `<polygon points="${cx},${cy - r * 1.05} ${cx + r * 1.1},${cy + r * 0.85} ${cx - r * 1.1},${cy + r * 0.85}"/>`;
  else body = `<polygon points="${cx},${cy - r * 1.15} ${cx + r * 1.1},${cy} ${cx},${cy + r * 1.15} ${cx - r * 1.1},${cy}"/>`;
  const ty = sh === 'triangle' ? cy + r * 0.35 : cy;
  return `<g class="lu-f${color}">${body}<text x="${cx}" y="${ty}" class="lu-let lu-let${color}" font-size="${r * 1.15}" text-anchor="middle" dominant-baseline="central">${P.LETTERS[color]}</text></g>`;
}

function iconHtml(color, size = 30) {
  return `<svg class="lu-icon" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${shapeSvg(color, 20, 20, 15)}</svg>`;
}

const cx = (c) => c[0] * U + U / 2;
const cy = (c) => c[1] * U + U / 2;
const key = (c) => `${c[0]},${c[1]}`;

function boardHtml(g, interactive) {
  const used = new Set(g.players.map((p) => p.color));
  const parts = [];
  // Hausflächen
  for (let c = 0; c < 4; c++) {
    const [ox, oy] = [[0, 0], [7, 0], [7, 7], [0, 7]][c];
    parts.push(`<rect x="${ox * U + 4}" y="${oy * U + 4}" width="${4 * U - 8}" height="${4 * U - 8}" rx="22" class="lu-home lu-l${c}${used.has(c) ? '' : ' lu-unused'}"/>`);
    for (const cell of P.HOME_CELLS[c]) parts.push(`<circle cx="${cx(cell)}" cy="${cy(cell)}" r="${U * 0.42}" class="lu-slot lu-s${c}"/>`);
    parts.push(`<text x="${(ox + 2) * U}" y="${(oy + (c < 2 ? 0.55 : 3.5)) * U}" class="lu-hname lu-t${c}" text-anchor="middle" dominant-baseline="central">${P.COLOR_NAMES[c]}${used.has(c) ? '' : ' (frei)'}</text>`);
  }
  // Rundweg
  P.RING_CELLS.forEach((cell, i) => {
    const isStart = i % 10 === 0;
    const c = i / 10;
    parts.push(`<rect x="${cell[0] * U + 2}" y="${cell[1] * U + 2}" width="${U - 4}" height="${U - 4}" rx="8" class="lu-cell${isStart ? ' lu-start lu-l' + c : ''}"/>`);
    if (isStart) parts.push(`<text x="${cx(cell)}" y="${cy(cell) + 1}" class="lu-startmark lu-t${c}" text-anchor="middle" dominant-baseline="central">▶</text>`);
  });
  // Zielgeraden
  for (let c = 0; c < 4; c++) {
    P.GOAL_CELLS[c].forEach((cell, k) => {
      parts.push(`<rect x="${cell[0] * U + 2}" y="${cell[1] * U + 2}" width="${U - 4}" height="${U - 4}" rx="8" class="lu-cell lu-goal lu-l${c}${used.has(c) ? '' : ' lu-unused'}"/>`);
      if (k === 3) parts.push(`<text x="${cx(cell)}" y="${cy(cell)}" class="lu-goalmark" text-anchor="middle" dominant-baseline="central">★</text>`);
    });
  }
  parts.push(`<text x="${5.5 * U}" y="${5.5 * U}" class="lu-center" text-anchor="middle" dominant-baseline="central">🏁</text>`);
  // letzter Zug
  const l = g.last;
  if (l && l.kind === 'move') {
    parts.push(`<rect x="${l.from[0] * U + 1}" y="${l.from[1] * U + 1}" width="${U - 2}" height="${U - 2}" rx="9" class="lu-from"/>`);
    parts.push(`<rect x="${l.to[0] * U + 1}" y="${l.to[1] * U + 1}" width="${U - 2}" height="${U - 2}" rx="9" class="lu-to"/>`);
  }
  // Figuren (ziehbare zuletzt, damit sie oben liegen)
  const ap = g.mode === 'over' ? null : P.activePlayer(g);
  const movable = interactive && ap ? new Set(g.turn.movable) : new Set();
  const front = [];
  g.players.forEach((p) => {
    p.pieces.forEach((prog, i) => {
      const cell = P.cellOf(p.color, prog, i);
      const can = ap && ap.id === p.id && movable.has(i);
      const label = `${P.COLOR_NAMES[p.color]}e Figur ${i + 1}`;
      const r = prog < 0 ? U * 0.36 : U * 0.4;
      if (can) {
        front.push(`<g class="lu-piece lu-can" data-act="move" data-piece="${i}" role="button" aria-label="${label} ziehen">
          <circle cx="${cx(cell)}" cy="${cy(cell)}" r="${U * 0.9}" class="lu-hit"/>
          <circle cx="${cx(cell)}" cy="${cy(cell)}" r="${r + 5}" class="lu-ring"/>${shapeSvg(p.color, cx(cell), cy(cell), r)}</g>`);
      } else {
        parts.push(`<g class="lu-piece" role="img" aria-label="${label}${prog < 0 ? ' im Haus' : ''}">${shapeSvg(p.color, cx(cell), cy(cell), r)}</g>`);
      }
    });
  });
  // geschlagene Figur kurz markieren: Kreuz im Haus
  return `<svg class="lu-board" viewBox="0 0 ${11 * U} ${11 * U}" role="group" aria-label="Spielbrett">${parts.join('')}${front.join('')}</svg>`;
}

function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = P.activePlayer(g);
  let extra = '';
  const nm = S.ui.noMove;
  if (nm && nm.rollId === g.rollId && !S.ui.rolling) {
    extra = `<div class="banner lu-no">${nm.mine ? 'Du kannst nicht ziehen' : esc(nm.name) + ' kann nicht ziehen'}</div>`;
  }
  const main = ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
  return extra + main;
}

function meHtml() {
  const i = myIndex();
  if (i < 0) return `<p class="muted center">Du schaust nur zu.</p>`;
  const c = g().players[i].color;
  return `<div class="lu-me lu-bg${c}">${iconHtml(c, 34)}<span>Du spielst <b>${P.COLOR_NAMES[c]}</b> (${P.SHAPE_NAMES[c]}, Buchstabe ${P.LETTERS[c]})</span></div>`;
}
const g = () => S.game;

function actionHtml() {
  const game = S.game;
  const t = game.turn;
  const ap = P.activePlayer(game);
  const isMe = ap.id === cid;
  const last = game.last;
  let die;
  let who = '';
  if (S.ui.rolling) {
    die = `<div id="dice" class="lu-dicebox">${dieHtml(1 + Math.floor(Math.random() * 6), true)}</div>`;
    who = `<p class="big">Der Würfel rollt …</p>`;
  } else {
    const v = last && last.kind !== undefined && last.die ? last.die : 0;
    die = `<div id="dice" class="lu-dicebox">${dieHtml(v, false)}</div>`;
    if (last && v) who = `<p class="big">${last.pid === cid ? '<b>Du</b> hast' : `<b>${esc(last.name)}</b> hat`} eine <b>${v}</b> gewürfelt.</p>`;
    else who = `<p class="big">Noch nicht gewürfelt.</p>`;
  }
  let body = '';
  if (S.ui.rolling) {
    body = '';
  } else if (isMe && t.stage === 'roll') {
    let note = '';
    if (t.maxRolls > 1) note = `<p class="muted">Du hast noch keine Figur auf dem Brett. Du darfst bis zu dreimal würfeln, bis eine 6 fällt. (Versuch ${t.rolls + 1} von ${t.maxRolls})</p>`;
    else if (t.bonus) note = `<p class="muted">Du hast eine 6 gewürfelt und darfst noch einmal.</p>`;
    body = `${note}<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`;
  } else if (isMe && t.stage === 'move') {
    body = `<p class="big lu-hint">Tippe auf eine Figur mit leuchtendem Ring, um sie zu ziehen.</p>`;
  } else if (!isMe && t.stage === 'roll') {
    body = `<p class="big"><b>${esc(ap.name)}</b> würfelt gleich. Bitte einen Moment Geduld.</p>`;
  } else {
    body = `<p class="big"><b>${esc(ap.name)}</b> wählt eine Figur zum Ziehen.</p>`;
  }
  return `<div class="lu-diceline">${die}<div>${who}</div></div>${body}`;
}

function recapHtml() {
  const game = S.game;
  if (!game.recap || !game.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${game.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function playersHtml() {
  const game = S.game;
  const rows = game.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const act = i === game.active && game.mode !== 'over';
    return `<li class="lu-pl lu-bd${p.color}${act ? ' lu-act' : ''}">${iconHtml(p.color, 34)}
      <div class="lu-pn"><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b>${off}<br><span class="muted">${P.COLOR_NAMES[p.color]} · im Haus: <b>${P.homeCount(p)}</b> · im Ziel: <b>${P.goalCount(p)}</b> von 4</span></div>
      <span class="lu-turn">${act ? '🎲' : ''}</span></li>`;
  }).join('');
  return `<section class="card"><h2>Die Mitspieler</h2><ul class="lu-players">${rows}</ul></section>`;
}

function gameHtml() {
  const game = S.game;
  if (game.mode === 'over') return overHtml();
  const ap = P.activePlayer(game);
  const interactive = ap.id === cid && game.turn.stage === 'move' && !S.ui.rolling;
  return `${headerHtml()}${lostHtml()}${bannerHtml()}${meHtml()}
    <section class="card lu-boardcard">${boardHtml(game, interactive)}</section>
    <section class="card action">${actionHtml()}</section>
    ${playersHtml()}${recapHtml()}`;
}

function overHtml() {
  const game = S.game;
  const rank = P.ranking(game);
  const win = rank[0];
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r, i) => `<li class="${i === 0 ? 'win' : ''}"><span class="medal">${i === 0 ? '🏆' : medals[i] || ''}</span>
    <span class="rn">${iconHtml(r.color, 26)} ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.goal} von 4</span>
    <div class="rd"><span class="chip">${P.COLOR_NAMES[r.color]}</span><span class="chip">${r.goal} im Ziel</span><span class="chip">${r.home} im Haus</span></div></li>`).join('');
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">🏆</div><h1>${esc(win.name)} hat gewonnen!</h1><p class="center muted">${esc(game.endReason || '')}</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    <section class="card lu-boardcard">${boardHtml(game, false)}</section>
    ${recapHtml()}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Bringe als Erste/r alle deine 4 Figuren einmal rund um das Brett und in deine Zielgerade (die 4 farbigen Felder, die zur Mitte führen, das letzte mit einem Stern ★).</p>
    <h3>Dein Brett</h3>
    <p>Jede Person hat eine Farbe: Rot, Blau, Grün oder Gelb. Deine Figuren erkennst du an der <b>Farbe</b>, an der <b>Form</b> (Rot = Kreis, Blau = Quadrat, Grün = Dreieck, Gelb = Raute) und am <b>Buchstaben</b> (R, B, G, Y). Oben im Spiel steht immer, welche Farbe du spielst. Zu zweit sitzt ihr euch gegenüber (Rot und Grün).</p>
    <p>Am Anfang stehen alle 4 Figuren im <b>Haus</b> (die Ecke in deiner Farbe). Dein <b>Startfeld</b> ist das Feld mit dem Pfeil ▶ in deiner Farbe.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Tippe auf <b>🎲 Würfeln</b>.</li>
      <li>Danach leuchten die Figuren mit einem Ring, die ziehen dürfen. Tippe auf eine davon. Sie zieht so viele Felder, wie der Würfel zeigt, im Uhrzeigersinn.</li>
      <li>Gibt es keinen erlaubten Zug, steht „Du kannst nicht ziehen“ und der nächste ist dran.</li>
    </ol>
    <h3>Herauskommen</h3>
    <p>Mit einer <b>6</b> kommt eine Figur aus dem Haus auf dein Startfeld. Solange du noch keine Figur auf dem Brett hast, darfst du bis zu <b>dreimal</b> hintereinander würfeln, um eine 6 zu bekommen.</p>
    <h3>Noch einmal würfeln</h3>
    <p>Wer eine <b>6</b> würfelt und dann zieht, darf danach <b>noch einmal</b> würfeln – auch mehrmals hintereinander.</p>
    <h3>Das Programm achtet auf diese Pflichten</h3>
    <ul>
      <li>Eine 6 muss zuerst dazu benutzt werden, eine Figur aus dem Haus zu holen, wenn noch eine im Haus steht und dein Startfeld frei ist.</li>
      <li>Steht eine Figur von dir auf dem Startfeld und es sind noch Figuren im Haus, musst du zuerst diese Figur weiterziehen, damit das Startfeld frei wird (wenn sie ziehen kann).</li>
      <li>Du musst ziehen, wenn ein Zug möglich ist. Welche Figur du nimmst, entscheidest du – außer bei den Pflichten oben.</li>
    </ul>
    <h3>Schlagen</h3>
    <p>Landest du genau auf einer fremden Figur, wird sie <b>geschlagen</b> und muss zurück ins Haus. Auf ein Feld mit einer eigenen Figur darfst du nicht ziehen. Über andere Figuren darfst du auf dem Rundweg einfach hinweg ziehen.</p>
    <h3>Zielgerade</h3>
    <p>Hat eine Figur eine ganze Runde (40 Felder) hinter sich, biegt sie in deine Zielgerade ab. Dort musst du <b>genau</b> bis auf ein Zielfeld würfeln. Weiter als das letzte Zielfeld geht es nicht, und in der Zielgerade darfst du keine Figur überspringen. Deshalb gehört die erste Figur ganz nach hinten, damit die anderen noch Platz haben.</p>
    <h3>Spielende</h3>
    <p>Wer zuerst alle 4 Figuren in der Zielgerade hat, gewinnt – das Spiel ist dann sofort zu Ende. Die Rangliste zählt, wie viele Figuren jede Person im Ziel hat.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und wertet alles selbst aus. Der gelbe Rahmen auf dem Brett zeigt den letzten Zug.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  title: 'Ludo', icon: '🏁', sub: 'Das Würfel-Brettspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Ludo', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    if (act === 'roll') return sess.send({ t: 'roll' });
    if (act === 'move') {
      if (S.ui.rolling) return undefined;
      const piece = el.dataset ? Number(el.dataset.piece) : NaN;
      return sess.send({ t: 'move', piece });
    }
    return undefined;
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
