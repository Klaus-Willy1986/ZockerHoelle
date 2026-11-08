import * as K from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'swap', label: 'Mit Kartentausch (Tausch mit der Partnerin)', help: 'Zu Beginn jeder Runde gibt jede Person eine Karte verdeckt an ihre Partnerin weiter.', def: true },
  { id: 'hints', label: 'Spielbare Karten und Steine anzeigen', help: 'Zeigt dir, welche Karten und Steine gerade ziehen dürfen. Ohne diese Hilfe musst du selbst schauen, was geht.', def: false },
];

const freshUi = () => ({ sel: null, note: '', swapPick: null });
const BOT_DELAY = 900;

// Welcher Computer ist als Nächstes dran? -> { id, msg } oder null
function botAction(g, level) {
  if (!g || g.phase === 'over') return null;
  if (g.phase === 'swap') {
    for (const p of g.players) {
      if (p.bot && !g.swapSel[p.seat]) {
        const msg = chooseAction(g, p.id, level, Math.random);
        if (msg) return { id: p.id, msg };
      }
    }
    return null;
  }
  const ap = K.activePlayer(g);
  if (!ap || !ap.bot) return null;
  const msg = chooseAction(g, ap.id, level, Math.random);
  return msg ? { id: ap.id, msg } : null;
}

const sess = createSession({
  game: 'kr',
  maxPlayers: 4,
  options: OPTIONS,
  newGame: (players, opts) => { S.ui = { ...S.ui, ...freshUi() }; return K.createGame(players, opts, Math.random, sess.cid); },
  onMessage: (state, pid, msg) => {
    // Computer im Netzspiel: nur der Gastgeber selbst darf einen Computerschritt auslösen
    if (msg && msg.t === 'botstep') {
      if (pid === sess.cid) { const a = botAction(state, 1); if (a) K.handle(state, a.id, a.msg, Math.random); }
      return;
    }
    K.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; clearTimeout(netBotTimer); },
  bot: { delay: BOT_DELAY, step: (g, level) => botAction(g, level) },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const mySeat = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const U = 24; // Kantenlänge eines Rasterfelds im SVG (17 x 17 Felder)
const cx = (c) => c[0] * U + U / 2;
const cy = (c) => c[1] * U + U / 2;

// ====================== Zustandswechsel ======================
let netBotTimer = null;
function onStateChanged() {
  const g = S.game;
  const sel = S.ui.sel;
  if (sel) {
    const seat = mySeat();
    if (!g || g.phase !== 'play' || seat < 0 || g.turn !== seat || !g.players[seat].hand.some((c) => K.sameCard(c, sel.card))) S.ui.sel = null;
  }
  if (!g || g.phase !== 'swap') S.ui.swapPick = null;
  render();
  // Netzspiel: Computer auf den leeren Plätzen spielt der Gastgeber
  clearTimeout(netBotTimer);
  if (S.role === 'host' && S.room !== 'SOLO' && g && botAction(g, 1)) {
    netBotTimer = setTimeout(() => sess.send({ t: 'botstep' }), BOT_DELAY);
  }
}

// ====================== Darstellung ======================
function shapeSvg(seat, x, y, r, num) {
  const sh = K.SHAPES[seat];
  let body;
  if (sh === 'circle') body = `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  else if (sh === 'square') body = `<rect x="${x - r * 0.9}" y="${y - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}" rx="${r * 0.25}"/>`;
  else if (sh === 'triangle') body = `<polygon points="${x},${y - r * 1.1} ${x + r * 1.15},${y + r * 0.9} ${x - r * 1.15},${y + r * 0.9}"/>`;
  else body = `<polygon points="${x},${y - r * 1.2} ${x + r * 1.15},${y} ${x},${y + r * 1.2} ${x - r * 1.15},${y}"/>`;
  const ty = sh === 'triangle' ? y + r * 0.35 : y;
  const t = num ? `<text x="${x}" y="${ty}" class="kr-let kr-let${seat}" font-size="${r * 1.3}" text-anchor="middle" dominant-baseline="central">${num}</text>` : '';
  return `<g class="kr-f${seat}">${body}${t}</g>`;
}
function iconHtml(seat, size = 30) {
  return `<svg class="kr-icon" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${shapeSvg(seat, 20, 20, 14, '')}</svg>`;
}

function cardHtml(c, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const joker = c.r === 'JOKER';
  const su = joker ? null : K.SUITS[c.s];
  const name = joker ? 'Joker' : `${su.name} ${K.RANK_NAMES[c.r]}`;
  const word = ['BUBE', 'DAME', 'KING', 'ASS', 'JOKER'].includes(c.r) ? `<span class="nm">${K.RANK_NAMES[c.r]}</span>` : '';
  const type = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${type} class="kr-card${su && su.red ? ' red' : ''}${joker ? ' joker' : ''}${cls ? ' ' + cls : ''}" title="${name}" aria-label="${name}${verb}" ${attrs}>
    <span class="rk">${K.RANK_SYM[c.r]}</span><span class="su" aria-hidden="true">${su ? su.sym : ''}</span>${word}</${tag}>`;
}

const hintsOn = (g) => !!g.opts.hints || !!S.learn;

// Brett als SVG. b = anzuzeigendes Brettmodell, st = Auswahl-Stufe der Person (oder null)
function boardHtml(g, b, st, showLast) {
  const parts = [];
  const front = [];
  const ap = g.phase === 'play' ? g.turn : -1;
  // Ställe
  for (let s = 0; s < 4; s++) {
    const cells = K.STALL_CELLS[s];
    const x0 = cells[0][0] * U - 4; const y0 = cells[0][1] * U - 4;
    parts.push(`<rect x="${x0}" y="${y0}" width="${2 * U + 8}" height="${2 * U + 8}" rx="14" class="kr-stall kr-l${s}${ap === s ? ' kr-act' : ''}"/>`);
    for (const c of cells) parts.push(`<circle cx="${cx(c)}" cy="${cy(c)}" r="${U * 0.42}" class="kr-slot kr-s${s}"/>`);
    const short = g.players[s].name.replace(/^Computer/, 'PC');
    const nm = short.length > 8 ? short.slice(0, 7) + '…' : short;
    parts.push(`<text x="${x0 + U + 4}" y="${y0 + (s < 2 ? -5 : 2 * U + 20)}" class="kr-name kr-t${s}" text-anchor="middle">${esc(nm)}</text>`);
  }
  // Ringbahn
  K.RING_CELLS.forEach((cell, i) => {
    const isStart = i % 16 === 0;
    const sidx = i / 16;
    const isEntry = (i + 1) % 16 === 0;
    parts.push(`<rect x="${cell[0] * U + 1.5}" y="${cell[1] * U + 1.5}" width="${U - 3}" height="${U - 3}" rx="5" class="kr-cell${isStart ? ' kr-start kr-l' + sidx : ''}"/>`);
    if (isStart) parts.push(`<text x="${cx(cell)}" y="${cy(cell) + 1}" class="kr-mark kr-t${sidx}" text-anchor="middle" dominant-baseline="central">▶</text>`);
    if (isEntry) {
      const sd = ((i + 1) / 16) % 4;
      parts.push(`<text x="${cx(cell)}" y="${cy(cell) + 1}" class="kr-mark kr-t${sd}" text-anchor="middle" dominant-baseline="central">${['→', '↓', '←', '↑'][sd]}</text>`);
    }
  });
  // Zielfelder
  for (let s = 0; s < 4; s++) {
    K.GOAL_CELLS[s].forEach((cell, k) => {
      parts.push(`<rect x="${cell[0] * U + 1.5}" y="${cell[1] * U + 1.5}" width="${U - 3}" height="${U - 3}" rx="5" class="kr-cell kr-goal kr-l${s}"/>`);
      if (k === 3) parts.push(`<text x="${cx(cell)}" y="${cy(cell) + 1}" class="kr-goalmark" text-anchor="middle" dominant-baseline="central">★</text>`);
    });
  }
  // Mitte: Runde und zuletzt gespielte Karte
  const mid = 8.5 * U;
  parts.push(`<text x="${mid}" y="${6.1 * U}" class="kr-ctr" text-anchor="middle">Runde ${g.round + 1} · ${g.handSize} Karten</text>`);
  if (g.lastCard) {
    const lc = g.lastCard;
    const red = lc.r !== 'JOKER' && K.SUITS[lc.s].red;
    const sym = lc.r === 'JOKER' ? '★' : K.RANK_SYM[lc.r] + K.SUITS[lc.s].sym;
    parts.push(`<rect x="${mid - 1.2 * U}" y="${6.6 * U}" width="${2.4 * U}" height="${3.2 * U}" rx="7" class="kr-cc"/>
      <text x="${mid}" y="${8.2 * U}" class="kr-cc-t${red ? ' red' : ''}" text-anchor="middle" dominant-baseline="central">${sym}</text>
      <text x="${mid}" y="${10.5 * U}" class="kr-ctr" text-anchor="middle">${lc.as ? 'Joker als ' + esc(K.RANK_NAMES[lc.as]) : 'zuletzt gespielt'}</text>`);
  } else {
    parts.push(`<text x="${mid}" y="${8.5 * U}" class="kr-ctr-b" text-anchor="middle">🏇</text>`);
  }
  // letzter Zug
  const l = g.last;
  if (showLast && l && l.kind === 'play') {
    for (const s of l.steps) {
      const seat = K.seatOfStone(s.g); const pi = K.indexOfStone(s.g);
      const f = K.cellOf(seat, s.from, pi); const t = K.cellOf(seat, s.to, pi);
      parts.push(`<rect x="${f[0] * U + 1}" y="${f[1] * U + 1}" width="${U - 2}" height="${U - 2}" rx="6" class="kr-from"/>`);
      parts.push(`<rect x="${t[0] * U + 1}" y="${t[1] * U + 1}" width="${U - 2}" height="${U - 2}" rx="6" class="kr-to"/>`);
    }
  }
  // Steine
  const tapOk = st && st.stage === 'stone';
  const tgtG = st && st.stage === 'target' && st.eff === 'BUBE' ? new Set(st.targets.map((t) => t.g)) : new Set();
  const hints = hintsOn(g);
  for (let gg = 0; gg < 16; gg++) {
    const seat = K.seatOfStone(gg); const pi = K.indexOfStone(gg);
    const prog = b.p[gg];
    const cell = K.cellOf(seat, prog, pi);
    const r = prog < 0 ? U * 0.36 : U * 0.4;
    const label = `Stein ${K.COLOR_NAMES[seat]} ${pi + 1}${prog < 0 ? ' im Stall' : prog >= K.GOAL_FIRST ? ' im Ziel' : ''}`;
    const shield = b.pr[gg] && prog === 0 ? `<circle cx="${cx(cell)}" cy="${cy(cell)}" r="${r + 3}" class="kr-shield"/>` : '';
    const body = `${shield}${shapeSvg(seat, cx(cell), cy(cell), r, pi + 1)}`;
    const selected = st && st.stone === gg && (st.stage === 'target');
    const selRing = selected ? `<circle cx="${cx(cell)}" cy="${cy(cell)}" r="${r + 4}" class="kr-selring"/>` : '';
    if (tapOk && seat === st.ctl && prog >= 0) {
      const can = st.stones.includes(gg);
      front.push(`<g class="kr-stone kr-tapstone${can && hints ? ' kr-can' : ''}" data-act="stone" data-g="${gg}" role="button" aria-label="${label} wählen">
        <circle cx="${cx(cell)}" cy="${cy(cell)}" r="${U * 0.62}" class="kr-hit"/>${can && hints ? `<circle cx="${cx(cell)}" cy="${cy(cell)}" r="${r + 4}" class="kr-ring"/>` : ''}${body}</g>`);
    } else if (tgtG.has(gg)) {
      front.push(`<g class="kr-stone kr-tgt" data-act="target" data-g="${gg}" role="button" aria-label="${label} tauschen">
        <circle cx="${cx(cell)}" cy="${cy(cell)}" r="${U * 0.62}" class="kr-hit"/><circle cx="${cx(cell)}" cy="${cy(cell)}" r="${r + 5}" class="kr-tgt-ring"/>${body}</g>`);
    } else {
      parts.push(`<g class="kr-stone" role="img" aria-label="${label}">${body}${selRing}</g>`);
    }
  }
  // Geschlagene Steine kurz markieren
  if (showLast && l && l.kind === 'play') {
    for (const c of l.caps) {
      const seat = K.seatOfStone(c.g);
      const cell = K.cellOf(seat, c.from, K.indexOfStone(c.g));
      parts.push(`<text x="${cx(cell)}" y="${cy(cell) + 1}" class="kr-cap" text-anchor="middle" dominant-baseline="central">✕</text>`);
    }
  }
  // Ziele (ganz oben, damit sie Tippen annehmen)
  if (st && st.stage === 'target' && st.eff !== 'BUBE') {
    const seat = K.seatOfStone(st.stone); const pi = K.indexOfStone(st.stone);
    for (const t of st.targets) {
      const cell = K.cellOf(seat, t.to, pi);
      front.push(`<g class="kr-tgt" data-act="target" data-steps="${t.steps}" role="button" aria-label="Zielfeld, ${t.steps} Felder">
        <circle cx="${cx(cell)}" cy="${cy(cell)}" r="${U * 0.7}" class="kr-hit"/>
        <rect x="${cell[0] * U + 0.5}" y="${cell[1] * U + 0.5}" width="${U - 1}" height="${U - 1}" rx="6" class="kr-tgt-box"/>
        <circle cx="${cx(cell)}" cy="${cy(cell)}" r="${U * 0.3}" class="kr-tgt-dot"/><text x="${cx(cell)}" y="${cy(cell) + 0.5}" class="kr-tgt-num" text-anchor="middle" dominant-baseline="central">${t.steps}</text></g>`);
    }
  }
  return `<svg class="kr-board" viewBox="0 0 ${17 * U} ${17 * U}" role="group" aria-label="Spielbrett">${parts.join('')}${front.join('')}</svg>`;
}

const kartenZahl = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);
const partnerName = (g, seat) => g.players[K.partnerOf(seat)].name;

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const seat = mySeat();
  if (g.phase === 'swap') {
    if (seat >= 0 && !g.swapSel[seat]) return `<div class="banner mine">Wähle eine Karte für deine Partnerin</div>`;
    return `<div class="banner">Warten, bis alle eine Karte gewählt haben</div>`;
  }
  const ap = K.activePlayer(g);
  if (ap.id === cid) return `<div class="banner mine">Du bist dran!</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function meHtml(g) {
  const seat = mySeat();
  if (seat < 0) return `<p class="muted center">Du schaust nur zu.</p>`;
  const extra = '';
  return `<div class="kr-me kr-me${seat}">${iconHtml(seat, 34)}<span>Du spielst <b>${K.COLOR_NAMES[seat]}</b> (${K.SHAPE_NAMES[seat]}), Partnerin: <b>${esc(partnerName(g, seat))}</b>${extra}</span></div>`;
}

function handCards(g) {
  const seat = mySeat();
  if (seat < 0) return '';
  const p = g.players[seat];
  const myTurn = g.phase === 'play' && g.turn === seat;
  const hints = hintsOn(g);
  const playable = myTurn ? K.playableCards(g, cid) : new Set();
  const sel = S.ui.sel;
  const sent = g.phase === 'swap' ? g.swapSel[seat] : null;
  const recv = g.recvd && g.recvd[seat];
  let sentDone = false; let freshDone = false;
  return p.hand.map((c, i) => {
    let cls = '';
    const key = `${c.r}|${c.s}`;
    if (g.phase === 'swap') {
      if (sent) {
        if (!sentDone && K.sameCard(sent, c)) { sentDone = true; cls = 'sent'; }
        return cardHtml(c, { cls });
      }
      if (S.ui.swapPick === i) cls = 'sel';
      return cardHtml(c, { cls, tag: 'button', attrs: `data-act="swapcard" data-idx="${i}"`, verb: ', weitergeben' });
    }
    if (recv && !freshDone && K.sameCard(recv, c)) { freshDone = true; cls = 'fresh'; }
    if (sel && sel.idx === i) cls += ' sel';
    if (!myTurn) return cardHtml(c, { cls });
    const ok = playable.has(key);
    if (hints) cls += ok ? ' can' : ' dim';
    return cardHtml(c, { cls, tag: 'button', attrs: `data-act="card" data-idx="${i}"`, verb: ', spielen' });
  }).join('');
}

function handHtml(g) {
  const seat = mySeat();
  if (seat < 0) return '';
  const n = g.players[seat].hand.length;
  return `<section class="card kr-handcard"><div class="kr-hand" role="group" aria-label="Deine Handkarten">${handCards(g)}</div>
    <p class="muted small kr-handlbl">Deine Karten: ${n}</p></section>`;
}

const FELD = (n) => (n === 1 ? '1 Feld' : `${n} Felder`);
const JOKER_LABEL = { BUBE: 'Bube', DAME: 'Dame', KING: 'König', ASS: 'Ass' };

function actionHtml(g) {
  const seat = mySeat();
  const note = S.ui.note ? `<p class="kr-note">${esc(S.ui.note)}</p>` : '';
  if (seat < 0) return `<p class="big">Du schaust nur zu.</p>`;
  const me = g.players[seat];
  if (g.phase === 'swap') {
    if (g.swapSel[seat]) return `<p class="big">Du hast eine Karte für <b>${esc(partnerName(g, seat))}</b> gewählt. Bitte einen Moment Geduld, bis alle fertig sind.</p>`;
    const pick = S.ui.swapPick;
    return `<p class="big">Wähle eine Karte für deine Partnerin <b>${esc(partnerName(g, seat))}</b>. Tippe auf eine Karte. Du bekommst dafür eine Karte von ihr.</p>${note}
      ${pick !== null && me.hand[pick] ? `<button class="btn primary huge" data-act="swapok">Diese Karte weitergeben</button>` : ''}`;
  }
  const ap = K.activePlayer(g);
  if (ap.id !== cid) return `<p class="big"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  const ctl = K.controlledSeat(g, seat);
  const partner = ctl !== seat ? `<p class="muted">Alle deine Steine sind im Ziel. Du spielst jetzt die Steine von <b>${esc(partnerName(g, seat))}</b> (${K.COLOR_NAMES[ctl]}).</p>` : '';
  if (!K.canPlay(g, cid)) {
    return `<p class="big">Du kannst mit keiner deiner Karten ziehen. Du musst alle Karten abwerfen und setzt in dieser Runde aus.</p>
      <button class="btn primary huge" data-act="discard">Karten abwerfen</button>`;
  }
  const sel = S.ui.sel;
  const st = sel ? K.selStage(g, cid, sel) : { stage: 'card' };
  const cancel = `<button class="btn ghost" data-act="cancel">Andere Karte wählen</button>`;
  switch (st.stage) {
    case 'joker': {
      const btns = st.ranks.map((r) => `<button class="btn" data-act="jokeras" data-as="${r}">${JOKER_LABEL[r] || r}</button>`).join('');
      return `<p class="big">Der <b>Joker</b> ersetzt jede Karte. <b>Welche Karte soll er sein?</b></p><div class="kr-jok">${btns}</div>${cancel}`;
    }
    case 'opt': {
      const lab = { s1: '1 Feld ziehen', s11: '11 Felder ziehen', s13: '13 Felder ziehen', out: 'Aus dem Stall aufs Startfeld' };
      const btns = st.options.map((o) => `<button class="btn secondary" data-act="opt" data-opt="${o}">${lab[o]}</button>`).join('');
      const what = st.eff === 'KING' ? 'König' : 'Ass';
      return `<p class="big">${what}: Was möchtest du tun?</p><div class="kr-opts">${btns}</div>${cancel}`;
    }
    case 'stone': {
      let t;
      if (st.eff === '7') t = `<b>7 aufteilen: Schritt für Schritt.</b> Du hast noch <b>${FELD(st.left)}</b> zu ziehen. Tippe auf den Stein, der ziehen soll.`;
      else if (st.eff === 'BUBE') t = 'Bube: Tippe auf einen deiner Steine, den du tauschen möchtest.';
      else if (st.eff === '4') t = 'Vier: Tippe auf den Stein, der 4 Felder zurückgehen soll.';
      else t = `Tippe auf den Stein, der <b>${FELD(st.opt ? Number(st.opt.slice(1)) : 0)}</b> ziehen soll.`;
      return `<p class="big">${t}</p>${note}${sevenUndo(sel)}${cancel}`;
    }
    case 'target': {
      let t;
      if (st.eff === '7') t = `Wie viele Felder soll der Stein ziehen? Tippe auf ein markiertes Feld (die Zahl ist die Anzahl der Felder). Noch zu ziehen: <b>${FELD(st.left)}</b>.`;
      else if (st.eff === 'BUBE') t = 'Tippe auf den Stein, mit dem du tauschen möchtest.';
      else if (st.eff === '4') t = 'Tippe auf das markierte Feld, 4 Felder zurück.';
      else t = `Tippe auf das markierte Feld, um <b>${FELD(st.targets[0].steps)}</b> zu ziehen.`;
      return `<p class="big">${t}</p>${sevenUndo(sel)}${cancel}`;
    }
    default:
      return `${partner}<p class="big">Tippe auf eine Karte, die du spielen möchtest.</p>${note}${sel ? cancel : ''}`;
  }
}
function sevenUndo(sel) {
  return sel && sel.parts && sel.parts.length ? `<button class="btn secondary" data-act="undo">Letzten Schritt zurücknehmen</button>` : '';
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 5).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function playersHtml(g) {
  const rows = g.players.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const act = g.phase === 'play' && g.turn === p.seat;
    const goal = p.pieces.filter((x) => x >= K.GOAL_FIRST).length;
    return `<li class="kr-pl kr-bd${p.seat}${act ? ' act' : ''}">${iconHtml(p.seat, 34)}
      <div class="kr-pn"><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b>${off}<br><span class="muted">${K.COLOR_NAMES[p.seat]} · Karten: <b>${p.hand.length}</b> · im Ziel: <b>${goal}</b> von 4</span></div>
      <span class="kr-turn">${act ? '🃏' : ''}</span></li>`;
  }).join('');
  const t = [0, 1].map((x) => `<span class="kr-score">Team ${K.TEAM_NAMES[x]}: ${K.teamGoal(g, x)} von 8 im Ziel</span>`).join('<br>');
  const w = `<br><span class="muted">Gewonnene Spiele: ${K.TEAM_NAMES[0]} ${g.wins.A} · ${K.TEAM_NAMES[1]} ${g.wins.B}</span>`;
  return `<section class="card"><h2>Die Mitspieler</h2><p>${t}${w}</p><ul class="kr-players">${rows}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  const seat = mySeat();
  const sel = S.ui.sel;
  const st = seat >= 0 && sel && g.phase === 'play' && g.turn === seat ? K.selStage(g, cid, sel) : null;
  const b = sel && sel.pb ? sel.pb : K.boardOf(g);
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}${meHtml(g)}
    <section class="card kr-boardcard" id="board">${boardHtml(g, b, st ? { ...st, stone: sel.stone } : null, !sel)}</section>
    <section class="card action kr-action" aria-live="polite">${actionHtml(g)}</section>
    ${handHtml(g)}
    ${playersHtml(g)}${recapHtml(g)}`;
}

function overHtml(g) {
  const rank = K.ranking(g);
  const win = rank[0];
  const seat = mySeat();
  const mine = seat >= 0 && K.teamOf(seat) === win.team;
  const list = rank.map((r, i) => `<li class="${i === 0 ? 'win' : ''}"><span class="medal">${i === 0 ? '🏆' : '🥈'}</span>
    <span class="rn">Team ${esc(r.name)}</span><span class="rt">${r.goal} von 8</span>
    <div class="rd"><span class="chip">${esc(r.members.join(' und '))}</span><span class="chip">${r.goal} im Ziel</span><span class="chip">${r.wins} gewonnen</span></div></li>`).join('');
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="next">▶ Noch ein Spiel (Stand bleibt)</button>
       <button class="btn secondary" data-act="again">Ganz neu anfangen (Stand löschen)</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  const head = mine ? 'Du hast mit deinem Team gewonnen! Glückwunsch!' : `Team ${esc(win.name)} hat gewonnen!`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">${mine ? '🏆' : '🃏'}</div><h1>${head}</h1><p class="center muted">${esc(g.endReason || '')}</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    <section class="card kr-boardcard">${boardHtml(g, K.boardOf(g), null, false)}</section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Zwei Teams mit je zwei Personen spielen gegeneinander. Eure Partnerin sitzt euch gegenüber. Euer Team gewinnt, wenn alle <b>8 Steine</b> (4 von dir, 4 von deiner Partnerin) im Ziel sind.</p>
    <h3>Dein Brett</h3>
    <p>Jede Person hat 4 Steine in einer Farbe (Rot = Kreis, Blau = Quadrat, Gelb = Dreieck, Grün = Raute) mit den Nummern 1 bis 4. Zu Beginn stehen alle im <b>Stall</b> (das Feld in deiner Ecke). Dein <b>Startfeld</b> ist das Eckfeld mit dem Pfeil ▶ in deiner Farbe. Die Steine laufen im Uhrzeigersinn einmal rund um das Brett. Am Feld direkt vor deinem Startfeld (mit einem Pfeil in deine Farbe) geht es in deine 4 Zielfelder.</p>
    <p>Sind weniger als 4 Personen dabei, spielen Computer die freien Plätze mit.</p>
    <h3>Die Karten</h3>
    <p>Gespielt wird mit 110 Karten (zwei Kartenspiele und 6 Joker). Zuerst bekommt jede Person 6 Karten, in den nächsten Runden 5, 4, 3, 2 und dann wieder 6, und so weiter.</p>
    <h3>Kartentausch</h3>
    <p>Zu Beginn jeder Runde gibst du eine Karte verdeckt an deine Partnerin weiter. Gleichzeitig bekommst du eine von ihr. Wähle eine Karte und tippe auf „Diese Karte weitergeben“. (Das lässt sich vor dem Spiel ausschalten.)</p>
    <h3>Dein Zug</h3>
    <p>Reihum spielt jede Person genau <b>eine Karte</b>. Tippe auf eine Karte, dann auf den Stein, der ziehen soll, und dann auf das markierte Zielfeld. Kannst du mit keiner Karte ziehen, musst du alle Karten abwerfen und setzt in dieser Runde aus.</p>
    <ul>
      <li><b>2, 3, 5, 6, 8, 9, 10:</b> Ein Stein zieht so viele Felder vorwärts. Die <b>Dame</b> zieht 12 Felder.</li>
      <li><b>4:</b> Ein Stein geht 4 Felder <b>rückwärts</b>. Er darf so nicht ins Ziel. Vom Startfeld aus geht es zurück auf die Felder vor dem Start.</li>
      <li><b>7:</b> Du darfst 7 Felder auf mehrere eigene Steine verteilen, Schritt für Schritt. Achtung: Auf allen Feldern, über die ein Stein dabei läuft, werden Steine geschlagen (auch eigene).</li>
      <li><b>Ass:</b> 1 oder 11 Felder vorwärts <b>oder</b> ein Stein aus dem Stall auf dein Startfeld.</li>
      <li><b>König:</b> 13 Felder vorwärts <b>oder</b> ein Stein aus dem Stall auf dein Startfeld.</li>
      <li><b>Bube:</b> Tausche einen deiner Steine mit einem beliebigen anderen Stein auf der Ringbahn (nicht aus dem Stall oder Ziel, und nicht mit einem geschützten Stein).</li>
      <li><b>Joker:</b> Er ersetzt jede der Karten. Du wählst, welche.</li>
    </ul>
    <h3>Herauskommen und Schutz</h3>
    <p>Ein Stein kommt nur mit <b>Ass, König oder Joker</b> aus dem Stall auf dein Startfeld. Steht dort ein fremder Stein, wird er geschlagen. Ein frisch gesetzter Stein ist <b>geschützt</b> (gestrichelter Ring), bis er sich bewegt hat: Er kann nicht geschlagen und nicht überholt werden. Steht dein eigener Stein noch auf dem Startfeld, kommt kein weiterer heraus.</p>
    <h3>Überholen und Schlagen</h3>
    <p>Auf der Ringbahn darfst du fremde und eigene Steine überholen, nur geschützte Steine auf ihren Startfeldern versperren den Weg. Landest du <b>genau</b> auf einem Feld mit einem anderen Stein, wird dieser geschlagen und muss zurück in den Stall. Das gilt auch für deine eigenen Steine!</p>
    <h3>Ziel</h3>
    <p>In den Zielfeldern darf man keinen Stein überspringen. Du musst nicht genau das letzte Feld treffen, aber die Karte muss groß genug sein, damit der Stein ins Ziel kommt. Am besten ziehst du den ersten Stein ganz nach hinten.</p>
    <h3>Partnerin mitspielen</h3>
    <p>Hast du alle 4 Steine im Ziel, spielst du ab dann die Steine deiner Partnerin mit.</p>
    <h3>Spielende</h3>
    <p>Sobald ein Team alle 8 Steine im Ziel hat, hat es gewonnen. Mit „Noch ein Spiel“ geht es weiter, die gewonnenen Spiele werden mitgezählt.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge. Mit dem Kästchen „Spielbare Karten und Steine anzeigen“ zeigt es dir auf Wunsch, was geht. Der gelbe Rahmen auf dem Brett zeigt den letzten Zug.</p>
`;
}

// ====================== Bedienung ======================
function sendPlay(move) {
  const sel = S.ui.sel;
  if (!sel) return undefined;
  S.ui.sel = null;
  S.ui.note = '';
  const msg = { t: 'play', card: { r: sel.card.r, s: sel.card.s }, move };
  if (sel.card.r === 'JOKER') msg.as = sel.as;
  return sess.send(msg);
}

const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 3, coach },
  title: 'Kartenrennen', icon: '🏇', sub: 'Karten-Brettspiel für zwei Teams – online zusammen spielen',
  helpTitle: 'Die Spielregeln vom Kartenrennen', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    const seat = mySeat();
    if (!g || seat < 0) return undefined;
    const sel = S.ui.sel;
    switch (act) {
      case 'swapcard': {
        const i = Number(el.dataset.idx);
        S.ui.swapPick = S.ui.swapPick === i ? null : i;
        return render();
      }
      case 'swapok': {
        const c = g.players[seat].hand[S.ui.swapPick];
        if (!c) return undefined;
        S.ui.swapPick = null;
        return sess.send({ t: 'swap', card: { r: c.r, s: c.s } });
      }
      case 'card': {
        const i = Number(el.dataset.idx);
        const c = g.players[seat].hand[i];
        if (!c) return undefined;
        if (sel && sel.idx === i) { S.ui.sel = null; S.ui.note = ''; return render(); }
        const ns = { card: { r: c.r, s: c.s }, idx: i, as: null, opt: null, stone: null, parts: [], left: 7, pb: null };
        const st = K.selStage(g, cid, ns);
        if (st.stage === 'none' || (st.stage === 'joker' && !st.ranks.length)) {
          S.ui.sel = null;
          S.ui.note = 'Mit dieser Karte geht gerade kein Zug. Wähle eine andere Karte.';
          return render();
        }
        S.ui.note = '';
        S.ui.sel = ns;
        return render();
      }
      case 'jokeras':
        if (!sel) return undefined;
        sel.as = el.dataset.as;
        return render();
      case 'opt': {
        if (!sel) return undefined;
        if (el.dataset.opt === 'out') return sendPlay({ out: true });
        sel.opt = el.dataset.opt;
        return render();
      }
      case 'stone': {
        if (!sel) return undefined;
        const st = K.selStage(g, cid, sel);
        const gg = Number(el.dataset.g);
        if (st.stage !== 'stone') return undefined;
        if (!st.stones.includes(gg)) { S.ui.note = 'Dieser Stein kann mit dieser Karte nicht ziehen.'; return render(); }
        S.ui.note = '';
        sel.stone = gg;
        return render();
      }
      case 'target': {
        if (!sel) return undefined;
        const st = K.selStage(g, cid, sel);
        if (st.stage !== 'target') return undefined;
        if (st.eff === 'BUBE') return sendPlay({ swap: [sel.stone, Number(el.dataset.g)] });
        if (st.eff === '4') return sendPlay({ back: sel.stone });
        const steps = Number(el.dataset.steps);
        if (st.eff === '7') {
          const base = K.boardOf(g);
          sel.parts.push({ stone: sel.stone, steps });
          sel.pb = K.stepBoard(sel.pb || base, sel.stone, steps);
          sel.left -= steps;
          sel.stone = null;
          if (sel.left === 0) return sendPlay({ split: sel.parts });
          return render();
        }
        return sendPlay({ stone: sel.stone, steps });
      }
      case 'undo': {
        if (!sel || !sel.parts.length) return undefined;
        sel.parts.pop();
        let b = K.boardOf(g);
        let left = 7;
        for (const p of sel.parts) { b = K.stepBoard(b, p.stone, p.steps); left -= p.steps; }
        sel.pb = sel.parts.length ? b : null;
        sel.left = left;
        sel.stone = null;
        return render();
      }
      case 'cancel': S.ui.sel = null; S.ui.note = ''; return render();
      case 'discard': S.ui.sel = null; return sess.send({ t: 'discardAll' });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
