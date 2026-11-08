import * as P from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ sel: null, hint: '', choice: null, sig: '', rolling: false, lastRollKey: '', note: null, noteRoll: 0, zoom: false });

const sess = createSession({
  game: 'bgm',
  maxPlayers: 2,
  // Die Lernrunde ist ein einzelnes Spiel mit angezeigten ziehbaren Steinen
  newGame: (players, opts) => { resetUi(); return P.createGame(players, S.learn ? { one: true, hints: true } : opts); },
  onMessage: (state, pid, msg) => {
    // „Noch eine Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    P.handle(state, pid, msg);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 800,
    step: (g, level) => {
      if (!g || g.mode !== 'play') return null;
      const ap = g.players[g.turn];
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
function resetUi() { const keep = S.ui ? { helpOpen: S.ui.helpOpen } : {}; S.ui = { ...keep, ...freshUi() }; }
resetUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const viewer = () => Math.max(0, myIndex());

// ====================== Zustandswechsel ======================
let rollTimer = null;
let noteTimer = null;

function syncNote() {
  const g = S.game;
  if (!g || !g.pass || g.pass.rollId === S.ui.noteRoll) return;
  S.ui.noteRoll = g.pass.rollId;
  const me = myIndex();
  const mine = g.pass.p === me;
  const nm = g.players[g.pass.p] ? g.players[g.pass.p].name : '';
  let text;
  if (g.pass.all) text = mine ? 'Du kannst nicht ziehen. Dein Wurf verfällt.' : `${nm} kann nicht ziehen. Der Wurf verfällt.`;
  else text = mine ? 'Die restliche Zahl kannst du nicht mehr spielen. Sie verfällt.' : `${nm} kann die restliche Zahl nicht spielen. Sie verfällt.`;
  S.ui.note = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { S.ui.note = null; render(); }, 3500);
}

function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.gid}|${g.gameNo}|${g.rollId}|${g.left.length}|${g.turn}|${g.stage}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; S.ui.hint = ''; S.ui.choice = null; }
    if (g.lastRoll) {
      const key = `${g.gid}|${g.lastRoll.rollId}`;
      if (key !== S.ui.lastRollKey) {
        const first = S.ui.lastRollKey === '';
        S.ui.lastRollKey = key;
        if (!first) { animateDice(); return; }
      }
    }
    syncNote();
  }
  render();
}

function animateDice() {
  S.ui.rolling = true;
  render();
  let n = 0;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    n++;
    const el = document.getElementById('dice');
    if (el) el.innerHTML = [1, 2].map(() => dieHtml(1 + Math.floor(Math.random() * 6), 0, false, true)).join('');
    if (n >= 8) {
      clearInterval(rollTimer);
      S.ui.rolling = false;
      syncNote();
      render();
    }
  }, 90);
}

// ====================== Darstellung ======================
const NAMES = P.NAMES;
const PW = 28; const X0 = 4; const TOP_Y = 16; const ROW_H = 130; const MID_H = 62;
const BOT_Y = TOP_Y + ROW_H + MID_H; const BOT_END = BOT_Y + ROW_H; const SVG_H = BOT_END + 18;
const R = 13;
const OFF_X = X0 + PW * 12 + 4; const OFF_W = 390 - OFF_X - 4;

// Stein als SVG-Form: Hell = weiß mit Punkt, Dunkel = schwarz mit heller Raute (auch ohne Farbsehen unterscheidbar)
function stoneSvg(color, cx, cy, r = R) {
  if (color === 0) {
    return `<g class="bg-st bg-st0"><circle cx="${cx}" cy="${cy}" r="${r - 1}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.28}" class="bg-in0"/></g>`;
  }
  const d = r * 0.5;
  return `<g class="bg-st bg-st1"><circle cx="${cx}" cy="${cy}" r="${r - 1}"/><polygon class="bg-in1" points="${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}"/></g>`;
}
function iconHtml(color, size = 30) {
  return `<svg class="bg-icon" width="${size}" height="${size}" viewBox="0 0 30 30" aria-hidden="true">${stoneSvg(color, 15, 15, 14)}</svg>`;
}

function dieHtml(v, owner = 0, used = false, spin = false) {
  if (!v) return `<span class="die bg-die bg-die-empty" role="img" aria-label="Noch nicht gewürfelt">?</span>`;
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  const pips = Array.from({ length: 9 }, (_, i) => `<b class="${on.includes(i) ? 'on' : ''}"></b>`).join('');
  return `<span class="${spin ? 'spin ' : ''}bg-spinwrap"><span class="die bg-die bg-d${owner}${used ? ' bg-used' : ''}" role="img" aria-label="${used ? 'Schon gespielt: ' : 'Würfel: '}${v}">${pips}</span></span>`;
}

// Spitze q (Sicht der betrachtenden Person) → Spalte/Reihe
const colOf = (q) => (q >= 13 ? q - 13 : 12 - q);
const topRow = (q) => q >= 13;
const px = (q) => X0 + PW * colOf(q);

function stackSvg(q, color, c) {
  const top = topRow(q);
  const cx = px(q) + PW / 2;
  const out = [];
  const shown = Math.min(c, 5);
  for (let k = 0; k < shown; k++) {
    const cy = top ? TOP_Y + R + 2 * R * k : BOT_END - R - 2 * R * k;
    out.push(stoneSvg(color, cx, cy));
  }
  if (c > 5) {
    const k = 4;
    const cy = top ? TOP_Y + R + 2 * R * k : BOT_END - R - 2 * R * k;
    out.push(`<text x="${cx}" y="${cy}" class="bg-cnt bg-cnt${color}" text-anchor="middle" dominant-baseline="central">${c}</text>`);
  }
  return out.join('');
}

function offStack(color, n, x, yBase, up) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const y = up ? yBase - 8 * (k + 1) : yBase + 8 * k;
    out.push(`<rect x="${x + 6}" y="${y}" width="${OFF_W - 12}" height="6" rx="2" class="bg-off bg-off${color}"/>`);
  }
  return out.join('');
}

function boardHtml(g) {
  const v = viewer();
  const me = myIndex();
  const mineB = g.board[v];
  const theirB = g.board[1 - v];
  const canAct = me >= 0 && g.mode === 'play' && g.turn === me && g.stage === 'move' && !S.ui.rolling;
  const moves = canAct ? P.legalMoves(g) : [];
  const sel = canAct ? P.selectionFor(g, me, S.ui.sel, moves) : null;
  const targets = new Set(sel === null ? [] : moves.filter((m) => m.from === sel).map((m) => m.to));
  const sources = new Set(canAct && g.opts.hints ? moves.map((m) => m.from) : []);
  // letzter Zug in der Sicht der betrachtenden Person
  const l = g.last;
  const lastQ = new Set();
  if (l) {
    if (l.p === v) {
      lastQ.add(`m${l.from}`); lastQ.add(`m${l.to}`);
    } else {
      lastQ.add(l.from === 25 ? 'ob' : `m${25 - l.from}`);
      lastQ.add(l.to === 0 ? 'oo' : `m${25 - l.to}`);
    }
  }
  const parts = [];
  parts.push(`<rect x="0" y="0" width="390" height="${SVG_H}" rx="14" class="bg-frame"/>`);
  // Spitzen (Dreiecke), Nummern
  for (let q = 1; q <= 24; q++) {
    const x = px(q); const top = topRow(q);
    const pts = top ? `${x + 1},${TOP_Y} ${x + PW - 1},${TOP_Y} ${x + PW / 2},${TOP_Y + 120}` : `${x + 1},${BOT_END} ${x + PW - 1},${BOT_END} ${x + PW / 2},${BOT_END - 120}`;
    parts.push(`<polygon points="${pts}" class="bg-tri bg-tri${q % 2}"/>`);
    parts.push(`<text x="${x + PW / 2}" y="${top ? TOP_Y - 4 : BOT_END + 13}" class="bg-num${q <= 6 ? ' bg-numh' : ''}" text-anchor="middle">${q}</text>`);
  }
  // Heimfeld rechts unten: dezente Fläche
  parts.push(`<rect x="${px(6)}" y="${BOT_Y}" width="${PW * 6}" height="${ROW_H}" class="bg-homezone"/>`);
  // Mittelstreifen und Raus-Felder
  parts.push(`<rect x="${X0}" y="${TOP_Y + ROW_H}" width="${PW * 12}" height="${MID_H}" class="bg-barstrip"/>`);
  parts.push(`<line x1="${X0 + PW * 6}" y1="${TOP_Y + ROW_H + 6}" x2="${X0 + PW * 6}" y2="${BOT_Y - 6}" class="bg-barsep"/>`);
  parts.push(`<rect x="${OFF_X}" y="${TOP_Y}" width="${OFF_W}" height="${ROW_H}" rx="6" class="bg-offbox"/>`);
  parts.push(`<rect x="${OFF_X}" y="${BOT_Y}" width="${OFF_W}" height="${ROW_H}" rx="6" class="bg-offbox${targets.has(0) ? ' bg-tgtbox' : ''}"/>`);
  parts.push(`<text x="${OFF_X + OFF_W / 2}" y="${TOP_Y + ROW_H - 6}" class="bg-lab" text-anchor="middle">Raus ${theirB[0]}</text>`);
  parts.push(`<text x="${OFF_X + OFF_W / 2}" y="${BOT_Y + 14}" class="bg-lab" text-anchor="middle">Raus ${mineB[0]}</text>`);
  parts.push(`<text x="${X0 + PW * 3}" y="${TOP_Y + ROW_H + 14}" class="bg-lab" text-anchor="middle">Bar Gegner</text>`);
  parts.push(`<text x="${X0 + PW * 9}" y="${TOP_Y + ROW_H + 14}" class="bg-lab" text-anchor="middle">Deine Bar</text>`);
  // Markierungen letzter Zug
  for (let q = 1; q <= 24; q++) {
    if (lastQ.has(`m${q}`)) parts.push(`<rect x="${px(q)}" y="${topRow(q) ? TOP_Y : BOT_Y}" width="${PW}" height="${ROW_H}" rx="4" class="bg-lastp"/>`);
  }
  if (lastQ.has('m25')) parts.push(`<rect x="${X0 + PW * 6 + 2}" y="${TOP_Y + ROW_H + 2}" width="${PW * 6 - 4}" height="${MID_H - 4}" rx="6" class="bg-lastp"/>`);
  if (lastQ.has('ob')) parts.push(`<rect x="${X0 + 2}" y="${TOP_Y + ROW_H + 2}" width="${PW * 6 - 4}" height="${MID_H - 4}" rx="6" class="bg-lastp"/>`);
  if (lastQ.has('m0')) parts.push(`<rect x="${OFF_X}" y="${BOT_Y}" width="${OFF_W}" height="${ROW_H}" rx="6" class="bg-lastp"/>`);
  if (lastQ.has('oo')) parts.push(`<rect x="${OFF_X}" y="${TOP_Y}" width="${OFF_W}" height="${ROW_H}" rx="6" class="bg-lastp"/>`);
  // Steine
  for (let q = 1; q <= 24; q++) {
    const a = mineB[q]; const b = theirB[25 - q];
    if (a > 0) parts.push(stackSvg(q, v, a));
    else if (b > 0) parts.push(stackSvg(q, 1 - v, b));
  }
  // Bar
  const barRow = (color, c, x0) => {
    const out = [];
    const shown = Math.min(c, 5);
    for (let k = 0; k < shown; k++) out.push(stoneSvg(color, x0 + 20 + k * 28, TOP_Y + ROW_H + MID_H / 2 + 6));
    if (c > 5) out.push(`<text x="${x0 + 20 + 4 * 28}" y="${TOP_Y + ROW_H + MID_H / 2 + 6}" class="bg-cnt bg-cnt${color}" text-anchor="middle" dominant-baseline="central">${c}</text>`);
    return out.join('');
  };
  parts.push(barRow(1 - v, theirB[25], X0));
  parts.push(barRow(v, mineB[25], X0 + PW * 6));
  // Raus-Steine
  parts.push(offStack(1 - v, theirB[0], OFF_X, TOP_Y + ROW_H - 18, true));
  parts.push(offStack(v, mineB[0], OFF_X, BOT_Y + 20, false));
  // Auswahl, Ziele, ziehbare Steine
  for (let q = 1; q <= 24; q++) {
    const top = topRow(q);
    const y = top ? TOP_Y : BOT_Y;
    if (sources.has(q) && sel !== q) parts.push(`<rect x="${px(q) + 1}" y="${y + 1}" width="${PW - 2}" height="${ROW_H - 2}" rx="5" class="bg-can-mark"/>`);
    if (sel === q) parts.push(`<rect x="${px(q) + 1}" y="${y + 1}" width="${PW - 2}" height="${ROW_H - 2}" rx="5" class="bg-sel-mark"/>`);
    if (targets.has(q)) {
      const c = mineB[q] + theirB[25 - q];
      const k = Math.min(c, 4);
      const cy = top ? TOP_Y + R + 2 * R * k : BOT_END - R - 2 * R * k;
      parts.push(`<rect x="${px(q) + 1}" y="${y + 1}" width="${PW - 2}" height="${ROW_H - 2}" rx="5" class="bg-tgt-mark"/><circle cx="${px(q) + PW / 2}" cy="${cy}" r="7" class="bg-tgt-dot"/>`);
    }
  }
  if (sources.has(25) && sel !== 25) parts.push(`<rect x="${X0 + PW * 6 + 2}" y="${TOP_Y + ROW_H + 2}" width="${PW * 6 - 4}" height="${MID_H - 4}" rx="6" class="bg-can-mark"/>`);
  if (sel === 25) parts.push(`<rect x="${X0 + PW * 6 + 2}" y="${TOP_Y + ROW_H + 2}" width="${PW * 6 - 4}" height="${MID_H - 4}" rx="6" class="bg-sel-mark"/>`);
  if (targets.has(0)) parts.push(`<rect x="${OFF_X + 1}" y="${BOT_Y + 1}" width="${OFF_W - 2}" height="${ROW_H - 2}" rx="6" class="bg-tgt-mark"/><circle cx="${OFF_X + OFF_W / 2}" cy="${BOT_Y + ROW_H / 2}" r="8" class="bg-tgt-dot"/>`);
  // Tippflächen (ganze Spitzenzone)
  for (let q = 1; q <= 24; q++) {
    const own = mineB[q];
    const lbl = `Spitze ${q}${own ? `, ${own} eigene Steine` : theirB[25 - q] ? `, ${theirB[25 - q]} gegnerische Steine` : ', leer'}`;
    parts.push(`<rect x="${px(q)}" y="${topRow(q) ? TOP_Y : BOT_Y}" width="${PW}" height="${ROW_H}" class="bg-pt${sources.has(q) ? ' can' : ''}${sel === q ? ' sel' : ''}${targets.has(q) ? ' tgt' : ''}" data-act="pt" data-p="${q}" role="button" aria-label="${lbl}"/>`);
  }
  parts.push(`<rect x="${X0 + PW * 6}" y="${TOP_Y + ROW_H}" width="${PW * 6}" height="${MID_H}" class="bg-pt bg-bar${sources.has(25) ? ' can' : ''}${sel === 25 ? ' sel' : ''}" data-act="bar" role="button" aria-label="Deine Bar, ${mineB[25]} Steine"/>`);
  parts.push(`<rect x="${OFF_X}" y="${BOT_Y}" width="${OFF_W}" height="${ROW_H}" class="bg-pt bg-offz${targets.has(0) ? ' tgt' : ''}" data-act="off" role="button" aria-label="Raus"/>`);
  return `<div id="board" class="bg-wrap${S.ui.zoom ? ' zoom' : ''}"><svg class="bg-svg" viewBox="0 0 390 ${SVG_H}" role="group" aria-label="Spielbrett">${parts.join('')}</svg></div>`;
}

function bannerHtml() {
  const g = S.game;
  const me = myIndex();
  if (g.mode === 'over') {
    const w = g.winner;
    const mine = w === me;
    const text = g.matchWinner !== null
      ? (mine ? 'Du hast das Spiel gewonnen! Glückwunsch!' : `${esc(g.players[w].name)} hat das Spiel gewonnen!`)
      : (mine ? 'Du hast diese Partie gewonnen!' : `${esc(g.players[w].name)} hat diese Partie gewonnen!`);
    return `<div class="banner done bg-banner"><span class="trophy" aria-hidden="true">🏆</span> <h1>${text}</h1></div>`;
  }
  const ap = g.players[g.turn];
  return ap.id === cid ? `<div class="banner mine bg-banner">Du bist dran!</div>` : `<div class="banner bg-banner">${esc(ap.name)} ist dran</div>`;
}

function scoreHtml(g) {
  const me = myIndex();
  const boxes = g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const pip = g.opts.pip ? `<div class="bg-pip">Augen bis zum Ziel: <b>${P.pipCount(g, i)}</b></div>` : '';
    return `<div class="bg-pl${g.turn === i && g.mode === 'play' ? ' turn' : ''}">
      <div class="bg-n">${iconHtml(i, 30)}<b>${esc(p.name)}${i === me ? ' (du)' : ''}</b></div>
      <div class="bg-c">${NAMES[i]} (${P.SHAPE_NAMES[i]})${off}</div>
      <div class="bg-p"><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Punkt' : 'Punkte'} · Raus: <b>${g.board[i][0]}</b></div>${pip}</div>`;
  }).join('');
  const goal = g.target === 1 ? 'Ein Spiel' : `Bis ${g.target} Punkte`;
  return `<section class="card bg-score" aria-label="Punktestand">${boxes}
    <p class="bg-round">${goal} · Partie ${g.gameNo}</p></section>`;
}

function diceHtml(g) {
  if (S.ui.rolling) return `<div id="dice" class="bg-dice">${[1, 2].map(() => dieHtml(1 + Math.floor(Math.random() * 6), 0, false, true)).join('')}</div>`;
  const lr = g.lastRoll;
  if (!lr) return `<div id="dice" class="bg-dice">${dieHtml(0)}${dieHtml(0)}</div>`;
  const list = lr.dice[0] === lr.dice[1] ? [lr.dice[0], lr.dice[0], lr.dice[0], lr.dice[0]] : lr.dice;
  const rest = g.stage === 'move' && lr.p === g.turn ? g.left.slice() : null;
  return `<div id="dice" class="bg-dice">${list.map((v) => {
    let used = false;
    if (rest) { const i = rest.indexOf(v); if (i >= 0) rest.splice(i, 1); else used = true; }
    return dieHtml(v, lr.p, used);
  }).join('')}</div>`;
}

function statusHtml(g) {
  const me = myIndex();
  const hint = S.ui.hint ? `<div class="bg-hint" role="alert">${esc(S.ui.hint)}</div>` : '';
  const note = S.ui.note && !S.ui.rolling ? `<span class="bg-warn">${esc(S.ui.note)}</span> ` : '';
  if (g.mode === 'over') {
    const w = g.winner;
    const who = w === me ? 'Du hast' : `${esc(g.players[w].name)} hat`;
    const kind = g.kind === 'backgammon' ? ' Das ist ein Backgammon!' : g.kind === 'gammon' ? ' Das ist ein Gammon!' : '';
    let text = `${who} alle 15 Steine herausgespielt.${kind} ${w === me ? 'Du bekommst' : 'Das gibt'} ${P.pointsText(g.points)}.`;
    if (g.matchWinner !== null) text += g.target === 1 ? ' Das Spiel ist entschieden.' : ` Das Match bis ${g.target} Punkte ist entschieden.`;
    const again = S.role === 'host'
      ? `<button class="btn primary huge" data-act="next">▶ Noch eine Runde${g.matchWinner !== null ? ' (neues Spiel)' : ''}</button>`
      : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
    return `<p class="big">${text}</p>${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button>`;
  }
  const ap = g.players[g.turn];
  const isMe = g.turn === me;
  const lr = g.lastRoll;
  let big;
  let btn = '';
  if (S.ui.rolling) {
    big = 'Die Würfel rollen …';
  } else if (g.stage === 'roll') {
    if (isMe) {
      big = `${note}Du bist dran. Tippe auf Würfeln.`;
      btn = `<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`;
    } else {
      big = `${note}${esc(ap.name)} würfelt gleich.`;
    }
  } else {
    const rest = g.left.length ? g.left.join(' und ') : '';
    const rolled = lr ? `${lr.p === me ? 'Du hast' : esc(g.players[lr.p].name) + ' hat'} ${lr.dice[0]} und ${lr.dice[1]} gewürfelt${lr.dice[0] === lr.dice[1] ? ' (Pasch)' : ''}.` : '';
    if (isMe) {
      const moves = P.legalMoves(g);
      const sel = P.selectionFor(g, me, S.ui.sel, moves);
      let how;
      if (g.board[me][25] > 0) how = sel === 25 ? 'Dein Stein liegt auf der Bar und muss zuerst wieder aufs Brett. Tippe auf eine markierte Spitze (Rahmen mit Punkt).' : 'Dein Stein liegt auf der Bar. Tippe auf die Bar.';
      else if (sel !== null) how = `Tippe jetzt auf ein markiertes Ziel (Rahmen mit Punkt).`;
      else how = 'Tippe auf einen deiner Steine, dann auf das Ziel.';
      big = `${note}${rolled} Noch zu spielen: ${rest}. ${how}`;
      if (S.ui.choice) {
        const ch = S.ui.choice;
        btn = `<div class="bg-choice">${ch.dice.map((d) => `<button class="btn secondary" data-act="die" data-die="${d}">Mit der ${d} herausspielen</button>`).join('')}</div>`;
        big = `${note}Mit welcher Zahl willst du herausspielen?`;
      }
    } else {
      big = `${note}${rolled} ${esc(ap.name)} zieht …`;
    }
  }
  return `<div class="bg-diceline">${diceHtml(g)}</div><p class="big">${big}</p>${btn}${hint}`;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    <section class="card bg-boardcard">${boardHtml(g)}
      <p class="bg-legend muted">Du ziehst gegen den Uhrzeigersinn: oben nach links, unten nach rechts zu deinem Heimfeld (unten rechts, Spitzen 1–6). Du spielst ${iconHtml(viewer(), 18)} <b>${NAMES[viewer()]}</b>.</p>
      <button class="btn secondary bg-zoom" data-act="zoom" aria-pressed="${S.ui.zoom ? 'true' : 'false'}">🔍 Brett ${S.ui.zoom ? 'kleiner' : 'größer'}</button></section>
    <section class="card bg-status action">${statusHtml(g)}</section>
    ${scoreHtml(g)}${recapHtml()}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Bringe als Erste/r alle 15 Steine in dein Heimfeld und spiele sie dann alle heraus.</p>
    <h3>Das Brett</h3>
    <p>Das Brett hat 24 schmale Spitzen (Dreiecke), in zwei Reihen mit je 12. Du spielst entweder <b>Hell</b> (weiße runde Steine mit einem Punkt) oder <b>Dunkel</b> (schwarze runde Steine mit einer hellen Raute). Das Brett ist immer so gedreht, dass dein Heimfeld <b>unten rechts</b> liegt (Spitzen 1 bis 6). Die Zahlen an den Spitzen sind aus deiner Sicht.</p>
    <p>Du ziehst <b>gegen den Uhrzeigersinn</b>: oben von rechts nach links, dann unten von links nach rechts bis in dein Heimfeld. In der Mitte liegt die <b>Bar</b> (Mittelstreifen). Rechts liegen die <b>Raus</b>-Felder.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Tippe auf <b>Würfeln</b>. Du würfelst zwei Würfel.</li>
      <li>Jede Würfelzahl ziehst du einzeln mit einem Stein: Tippe auf einen deiner Steine (die Spitze wird markiert). Danach sind die erlaubten Ziele mit einem Rahmen und einem Punkt markiert. Tippe auf ein Ziel.</li>
      <li>Ein <b>Pasch</b> (zwei gleiche Zahlen) zählt viermal.</li>
      <li>Die Würfel oben zeigen, was du noch ziehen musst; schon gespielte Würfel sind ausgegraut.</li>
    </ol>
    <h3>Wohin darf ein Stein?</h3>
    <ul>
      <li>Auf eine freie Spitze, auf eine mit eigenen Steinen oder auf eine, auf der genau <b>ein</b> gegnerischer Stein steht.</li>
      <li>Nicht auf eine Spitze, auf der <b>zwei oder mehr</b> gegnerische Steine stehen.</li>
    </ul>
    <h3>Schlagen und die Bar</h3>
    <p>Steht auf der Zielspitze genau ein gegnerischer Stein (ein „Blot“), wird er <b>geschlagen</b> und kommt auf die Bar. Wer Steine auf der Bar hat, muss diese <b>zuerst</b> wieder einsetzen: in das gegnerische Heimfeld auf die Spitze, die der Würfelzahl entspricht. Erst dann dürfen andere Steine ziehen. Ist der Platz blockiert, verfällt der Wurf.</p>
    <h3>Pflichten</h3>
    <ul>
      <li>Wenn du ziehen kannst, musst du ziehen. Kannst du nicht, verfällt der Wurf automatisch („Du kannst nicht ziehen“).</li>
      <li>Wenn es geht, musst du beide Würfelzahlen spielen. Kannst du nur eine spielen, musst du die größere spielen, wenn beide einzeln möglich sind.</li>
    </ul>
    <h3>Herausspielen</h3>
    <p>Erst wenn alle 15 Steine in deinem Heimfeld (Spitzen 1 bis 6) stehen, darfst du Steine herausspielen. Tippe dazu auf den Stein und dann auf <b>Raus</b>. Die Zahl muss genau stimmen. Steht auf der passenden Spitze kein Stein, darfst du mit einer größeren Zahl den Stein von der höchsten besetzten Spitze herausspielen.</p>
    <h3>Spielende und Punkte</h3>
    <p>Wer zuerst alle 15 Steine heraus hat, gewinnt die Partie. Punkte: <b>1</b> normal, <b>2</b> bei einem <b>Gammon</b> (die Gegenseite hat noch keinen Stein heraus), <b>3</b> bei einem <b>Backgammon</b> (zusätzlich hat die Gegenseite noch Steine auf der Bar oder in deinem Heimfeld).</p>
    <h3>Das Spiel</h3>
    <ul>
      <li>Gespielt wird bis <b>3 Punkte</b>. Vor dem Start kannst du „Bis 5 Punkte“ oder „Nur ein Spiel“ ankreuzen. Einen Dopplerwürfel gibt es nicht.</li>
      <li>Am Anfang würfelt jede Person einen Würfel. Wer die höhere Zahl hat, beginnt und zieht mit beiden Zahlen. Danach beginnt in jeder Partie, wer die letzte verloren hat.</li>
      <li>Nach jeder Partie kann der Gastgeber auf „Noch eine Runde“ tippen. Der Punktestand bleibt bis zum Matchende.</li>
      <li>„Brett größer“ vergrößert das Brett (dann kannst du es seitlich verschieben).</li>
    </ul>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und zählt die Punkte selbst.</p>
`;
}

// ====================== Bedienung ======================
const hint = (t) => { S.ui.hint = t; render(); };

function doMove(from, to, ms) {
  const dice = [...new Set(ms.map((m) => m.die))].sort((a, b) => a - b);
  if (dice.length > 1) { S.ui.choice = { from, to, dice }; S.ui.hint = ''; render(); return undefined; }
  S.ui.sel = null; S.ui.hint = ''; S.ui.choice = null;
  return sess.send({ t: 'move', from, to, die: dice[0] });
}

function ctxCheck() {
  const g = S.game;
  const me = myIndex();
  if (!g || me < 0) return null;
  if (g.mode !== 'play') return null;
  if (S.ui.rolling) return null;
  if (g.turn !== me) { hint('Du bist gerade nicht dran. Bitte warte einen Moment.'); return null; }
  if (g.stage !== 'move') { hint('Würfle zuerst. Tippe auf den Knopf „Würfeln“.'); return null; }
  return { g, me, moves: P.legalMoves(g) };
}

function tapPoint(q) {
  const c = ctxCheck();
  if (!c) return undefined;
  const { g, me, moves } = c;
  const sel = P.selectionFor(g, me, S.ui.sel, moves);
  if (sel !== null) {
    const ms = moves.filter((m) => m.from === sel && m.to === q);
    if (ms.length) return doMove(sel, q, ms);
  }
  if (g.board[me][25] > 0) return hint('Dein Stein auf der Bar muss zuerst wieder aufs Brett. Tippe auf eine Spitze mit Rahmen und Punkt.');
  if (g.board[me][q] > 0) {
    if (moves.some((m) => m.from === q)) { S.ui.sel = S.ui.sel === q ? null : q; S.ui.hint = ''; S.ui.choice = null; return render(); }
    return hint('Von dieser Spitze kann gerade kein Stein ziehen.');
  }
  if (sel !== null) return hint('Dorthin kann der gewählte Stein nicht ziehen. Erlaubte Ziele haben einen Rahmen mit Punkt.');
  return hint('Hier liegt kein Stein von dir. Tippe zuerst auf einen deiner Steine.');
}

function tapBar() {
  const c = ctxCheck();
  if (!c) return undefined;
  const { g, me } = c;
  if (g.board[me][25] === 0) return hint('Auf deiner Bar liegt kein Stein.');
  S.ui.hint = '';
  return render();
}

function tapOff() {
  const c = ctxCheck();
  if (!c) return undefined;
  const { g, me, moves } = c;
  const sel = P.selectionFor(g, me, S.ui.sel, moves);
  if (sel !== null) {
    const ms = moves.filter((m) => m.from === sel && m.to === 0);
    if (ms.length) return doMove(sel, 0, ms);
  }
  const b = g.board[me];
  let home = b[0];
  for (let q = 1; q <= 6; q++) home += b[q];
  if (home < P.STONES) return hint('Herausspielen geht erst, wenn alle 15 Steine in deinem Heimfeld (Spitzen 1 bis 6) stehen.');
  if (sel === null) return hint('Tippe zuerst auf den Stein, den du herausspielen willst.');
  return hint('Dieser Stein kann mit den Würfeln jetzt nicht heraus.');
}

const ui = createUI({
  sess, $app,
  bots: [1], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: [
    { id: 'to5', label: 'Bis 5 Punkte spielen (sonst bis 3)', help: 'Normal gewinnt, wer zuerst 3 Punkte hat.', def: false },
    { id: 'one', label: 'Nur ein Spiel (bis 1 Punkt)', help: 'Hat Vorrang vor „Bis 5 Punkte“. Eine Partie, dann ist Schluss.', def: false },
    { id: 'hints', label: 'Ziehbare Steine anzeigen', help: 'Spitzen, von denen gezogen werden darf, werden markiert.', def: false },
    { id: 'pip', label: 'Augenzahl anzeigen', help: 'Zeigt, wie viele Augen jede Seite noch bis zum Ziel braucht.', def: false },
  ],
  title: 'Backgammon', icon: '🎲', sub: 'Das Würfel-Brettspiel mit Schlagen und Herausspielen – online für zwei',
  helpTitle: 'Die Spielregeln von Backgammon', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'roll': {
        const g = S.game;
        if (!g || S.ui.rolling) return undefined;
        return sess.send({ t: 'roll' });
      }
      case 'pt': return tapPoint(Number(el.dataset.p));
      case 'bar': return tapBar();
      case 'off': return tapOff();
      case 'die': {
        const ch = S.ui.choice;
        if (!ch) return undefined;
        S.ui.choice = null; S.ui.sel = null;
        return sess.send({ t: 'move', from: ch.from, to: ch.to, die: Number(el.dataset.die) });
      }
      case 'zoom': S.ui.zoom = !S.ui.zoom; return render();
      case 'next': return S.role === 'host' ? sess.send({ t: 'next' }) : undefined;
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
