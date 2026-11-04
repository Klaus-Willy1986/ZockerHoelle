import * as P from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const sess = createSession({
  game: 'bk',
  maxPlayers: 4,
  newGame: (players) => { S.ui.sel = null; S.ui.sig = ''; S.ui.lastRollId = 0; S.ui.scroll = null; return P.createGame(players); },
  onMessage: (state, pid, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'roll') P.roll(state, pid);
    else if (msg.t === 'move') P.move(state, pid, String(msg.piece), msg.to);
    else if (msg.t === 'place') P.place(state, pid, msg.node);
  },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase === 'over') return null;
      const ap = P.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, { sel: null, sig: '', lastRollId: 0, rolling: false, scroll: null, pend: null }); },
});
const S = sess.S;
const cid = sess.cid;
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 1.8];
S.ui = { sel: null, sig: '', lastRollId: 0, rolling: false, scroll: null, pend: null, fit: false, zoom: Number(sess.get('bkzoom', 1)) || 1 };

const NO_ANIM = !!navigator.webdriver || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ====================== Geometrie des Bretts ======================
const U = 40; // eine Feldbreite in Zeichen-Einheiten (bei Zoom 1 sind das 40 Pixel)
const BW = 18 * U;
const BH = 18.4 * U;
const nx = (c) => (c + 1) * U;
const ny = (r) => (r + 1.6) * U;
const HOUSE_CY = 15.9 * U;
const HOUSE_R = 1.05 * U;
const FILL = { R: '#d32f2f', G: '#2e8b3d', Y: '#f2b705', B: '#1f5fbf' };
const LIGHT = { R: '#fde4e4', G: '#dff3e2', Y: '#fff4cc', B: '#dce8fb' };
const INK = { R: '#fff', G: '#fff', Y: '#111', B: '#fff' };

const nodeXY = (id) => { const n = P.NODES[id]; return { x: nx(n.c), y: ny(n.r) }; };
const slotXY = (color, i) => {
  const a = (-90 + 72 * i) * Math.PI / 180;
  return { x: nx(P.HOUSE_COL[color]) + HOUSE_R * Math.cos(a), y: HOUSE_CY + HOUSE_R * Math.sin(a) };
};
const pieceXY = (g, p) => (p.pos === 'H' ? slotXY(p.color, Number(p.id.slice(1))) : nodeXY(p.pos));

// ====================== Zustandswechsel ======================
const myPlayer = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);
const isMyTurn = (g) => g.phase !== 'over' && P.activePlayer(g).id === cid;

function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.turnNo}|${g.active}|${g.phase}|${g.rollId}`;
    if (sig !== S.ui.sig) {
      S.ui.sig = sig;
      S.ui.sel = null;
      if (g.rollId === 0 && g.turnNo === 1) {
        const me = myPlayer();
        S.ui.pend = me ? { pts: [slotXY(me.color, 0), nodeXY(P.START_NODE[me.color]), slotXY(me.color, 3)] } : null;
      } else if (isMyTurn(g) && g.phase === 'move') {
        const ids = new Set(P.legalMoves(g).map((m) => m.piece));
        S.ui.pend = { pts: g.pieces.filter((p) => ids.has(p.id)).map((p) => pieceXY(g, p)) };
      } else if (isMyTurn(g) && g.phase === 'place' && g.lastTo) {
        S.ui.pend = { pts: [nodeXY(g.lastTo)] };
      }
    }
    if (g.rollId < S.ui.lastRollId) S.ui.lastRollId = 0; // neues Spiel
    if (g.rollId !== S.ui.lastRollId) {
      const resumed = S.ui.lastRollId === 0 && g.rollId > 1;
      S.ui.lastRollId = g.rollId;
      if (!resumed && !NO_ANIM) { animateDice(); return; }
    }
  }
  render();
}

let rollTimer = null;
function animateDice() {
  S.ui.rolling = true;
  render();
  let n = 0;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    n++;
    const el = document.getElementById('bkdie');
    if (el) el.innerHTML = pips(1 + Math.floor(Math.random() * 6));
    if (n >= 8) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}

// ====================== Darstellung ======================
function pips(v) {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  return Array.from({ length: 9 }, (_, i) => `<b class="${on.includes(i) ? 'on' : ''}"></b>`).join('');
}
const dieHtml = (v, spin) => `<span id="bkdie" class="die d-white bk-die${spin ? ' bk-spin' : ''}" role="img" aria-label="Gewürfelt: ${v}">${pips(v)}</span>`;

function shapePath(color, r) {
  switch (color) {
    case 'R': return `<circle r="${r}"/>`;
    case 'G': return `<rect x="${-r * 0.9}" y="${-r * 0.9}" width="${r * 1.8}" height="${r * 1.8}" rx="4"/>`;
    case 'Y': return `<polygon points="0,${-r * 1.08} ${r * 1.05},${r * 0.82} ${-r * 1.05},${r * 0.82}"/>`;
    default: return `<polygon points="0,${-r * 1.12} ${r * 1.12},0 0,${r * 1.12} ${-r * 1.12},0"/>`;
  }
}
const shapeIcon = (color) => `<svg class="bk-ico" viewBox="-22 -22 44 44" aria-hidden="true"><g fill="${FILL[color]}" stroke="#111" stroke-width="3">${shapePath(color, 17)}</g></svg>`;
const chip = (color, text) => `<span class="bk-chip">${shapeIcon(color)}<b>${esc(text || P.COLOR_NAMES[color])}</b></span>`;

function pieceSvg(p, x, y, o = {}) {
  const ty = p.color === 'Y' ? 4 : 0;
  const label = `${P.COLOR_NAMES[p.color]}e Figur`;
  const ring = o.sel
    ? `<circle r="25" fill="none" stroke="#111" stroke-width="3.5"/><circle r="22" fill="none" stroke="#ffb300" stroke-width="4"/>`
    : o.movable ? `<circle class="bk-pulse" r="23" fill="none" stroke="#ff8f00" stroke-width="4"/>` : '';
  const inner = `${ring}<g fill="${FILL[p.color]}" stroke="#111" stroke-width="2.5">${shapePath(p.color, 16)}</g>
    <text y="${ty}" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="800" fill="${INK[p.color]}" font-family="system-ui,Arial,sans-serif" pointer-events="none">${P.COLOR_LETTERS[p.color]}</text>`;
  if (o.movable || o.sel) {
    return `<g transform="translate(${x} ${y})" class="bk-piece bk-hit" data-act="pick" data-piece="${p.id}" data-node="${p.pos}" role="button" tabindex="0" aria-label="${label}${p.pos === 'H' ? ' im Haus' : ''}, ${o.sel ? 'ausgewählt, nochmal antippen zum Abwählen' : 'zum Ziehen antippen'}">
      <circle r="20" fill="transparent"/>${inner}</g>`;
  }
  return `<g transform="translate(${x} ${y})" class="bk-piece" data-piece="${p.id}" data-node="${p.pos}" role="img" aria-label="${label}">${inner}</g>`;
}

function barrierSvg(x, y, node) {
  return `<g transform="translate(${x} ${y})" class="bk-barrier" data-barrier="${node}" role="img" aria-label="Sperre">
    <rect x="-16" y="-16" width="32" height="32" rx="6" fill="#1b1b1b" stroke="#000" stroke-width="2"/>
    <rect x="-11" y="-10" width="22" height="4.5" rx="1.5" fill="#fff"/><rect x="-11" y="-2.2" width="22" height="4.5" rx="1.5" fill="#f2b705"/><rect x="-11" y="5.5" width="22" height="4.5" rx="1.5" fill="#fff"/></g>`;
}

function boardSvg(g, o = {}) {
  const { moves = [], sel = null, placeTargets = [], movable = new Set() } = o;
  const used = new Set(g.players.map((p) => p.color));
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${BW}" height="${BH}" rx="18" fill="#f3e3a3"/>`);
  // Wege
  parts.push(`<g stroke="#7a6a3a" stroke-width="5" stroke-linecap="round">${P.EDGES.map(([a, b]) => {
    const A = nodeXY(a); const B = nodeXY(b);
    return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
  }).join('')}</g>`);
  // Häuser
  for (const c of used) {
    const hx = nx(P.HOUSE_COL[c]);
    const st = nodeXY(P.START_NODE[c]);
    const poly = [0, 1, 2, 3, 4].map((i) => { const q = slotXY(c, i); return `${q.x},${q.y}`; }).join(' ');
    parts.push(`<line x1="${st.x}" y1="${st.y}" x2="${hx}" y2="${HOUSE_CY - HOUSE_R}" stroke="#7a6a3a" stroke-width="4" stroke-dasharray="6 6"/>`);
    parts.push(`<polygon points="${poly}" fill="${LIGHT[c]}" stroke="${FILL[c]}" stroke-width="4" stroke-linejoin="round"/>`);
    for (let i = 0; i < 5; i++) { const q = slotXY(c, i); parts.push(`<circle cx="${q.x}" cy="${q.y}" r="17" fill="#fff" stroke="${FILL[c]}" stroke-width="3" stroke-dasharray="4 3"/>`); }
    const pl = g.players.find((p) => p.color === c);
    parts.push(`<text x="${hx}" y="${HOUSE_CY + HOUSE_R + 0.75 * U}" text-anchor="middle" font-size="17" font-weight="800" fill="#222" font-family="system-ui,Arial,sans-serif">${P.COLOR_NAMES[c]}</text>
      <text x="${hx}" y="${HOUSE_CY + HOUSE_R + 1.2 * U}" text-anchor="middle" font-size="15" fill="#333" font-family="system-ui,Arial,sans-serif">${esc(pl.name)}</text>`);
  }
  // Felder
  for (const id of P.NODE_IDS) {
    const { x, y } = nodeXY(id);
    if (id === P.GOAL) {
      parts.push(`<circle cx="${x}" cy="${y}" r="20" fill="#fff" stroke="#222" stroke-width="3.5"/><circle cx="${x}" cy="${y}" r="12" fill="#fff" stroke="#d32f2f" stroke-width="4"/><circle cx="${x}" cy="${y}" r="4.5" fill="#d32f2f"/>
        <text x="${x + 30}" y="${y}" font-size="17" font-weight="800" fill="#222" dominant-baseline="central" font-family="system-ui,Arial,sans-serif">ZIEL</text>`);
      continue;
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="14" fill="#fff" stroke="#2b2b2b" stroke-width="2.5"/>`);
  }
  for (const c of used) { const q = nodeXY(P.START_NODE[c]); parts.push(`<circle cx="${q.x}" cy="${q.y}" r="19" fill="none" stroke="${FILL[c]}" stroke-width="5"/>`); }
  // Sperren
  for (const b of g.barriers) { const q = nodeXY(b); parts.push(barrierSvg(q.x, q.y, b)); }
  // Figuren
  for (const p of g.pieces) {
    const q = pieceXY(g, p);
    parts.push(pieceSvg(p, q.x, q.y, { movable: movable.has(p.id), sel: sel === p.id }));
  }
  // Zielfelder
  const byNode = new Map(g.pieces.filter((p) => p.pos !== 'H').map((p) => [p.pos, p]));
  const bset = new Set(g.barriers);
  const selPiece = sel ? g.pieces.find((p) => p.id === sel) : null;
  if (sel && !selPiece) return boardSvg(g, { ...o, sel: null });
  for (const m of moves) {
    if (m.piece !== sel) continue;
    const { x, y } = nodeXY(m.to);
    const hitP = byNode.get(m.to);
    const kind = m.to === P.GOAL ? 'goal' : bset.has(m.to) ? 'bar' : hitP && hitP.color !== selPiece.color ? 'cap' : 'free';
    const col = { goal: '#d32f2f', bar: '#7b1fa2', cap: '#c62828', free: '#1b7a2b' }[kind];
    const fl = { goal: 'rgba(211,47,47,.2)', bar: 'rgba(123,31,162,.25)', cap: 'rgba(198,40,40,.28)', free: 'rgba(46,139,61,.3)' }[kind];
    const lab = { goal: 'Ziel', bar: 'Sperre aufnehmen', cap: 'Figur hinauswerfen', free: 'Zielfeld' }[kind];
    parts.push(`<g transform="translate(${x} ${y})" class="bk-hit" data-act="dest" data-node="${m.to}" data-kind="${kind}" role="button" tabindex="0" aria-label="${lab}, hier hinziehen">
      <circle class="bk-pulse" r="20" fill="${fl}" stroke="${col}" stroke-width="${kind === 'free' ? 4 : 5}" ${kind === 'free' ? '' : 'stroke-dasharray="7 4"'}/></g>`);
  }
  for (const id of placeTargets) {
    const { x, y } = nodeXY(id);
    parts.push(`<g transform="translate(${x} ${y})" class="bk-hit" data-act="place" data-node="${id}" role="button" tabindex="0" aria-label="Freies Feld, Sperre hier hinstellen">
      <circle r="20" fill="rgba(46,139,61,.22)" stroke="#1b7a2b" stroke-width="3.5"/></g>`);
  }
  const zoomStyle = S.ui.fit ? 'width:100%' : `width:${Math.round(BW * S.ui.zoom)}px`;
  return `<div id="bk-scroll" class="bk-scroll" tabindex="-1"><svg class="bk-board" style="${zoomStyle}" viewBox="0 0 ${BW} ${BH}" role="group" aria-label="Spielbrett">${parts.join('')}</svg></div>`;
}

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = P.activePlayer(g);
  const who = `<span class="bk-bwho">${chip(ap.color, `${P.COLOR_NAMES[ap.color]}`)}</span>`;
  if (ap.id === cid) {
    if (g.phase === 'place') return `<div class="banner mine bk-banner">Du hast eine Sperre genommen!<small>Tippe ein Feld, auf das du sie stellen willst.</small></div>`;
    return `<div class="banner mine bk-banner">Du bist dran! ${who}</div>`;
  }
  return `<div class="banner bk-banner">${esc(ap.name)} ist dran ${who}</div>`;
}

function actionHtml(g, mv) {
  const ap = P.activePlayer(g);
  const mine = ap.id === cid;
  const dieBy = g.dieBy ? P.playerById(g, g.dieBy) : null;
  if (S.ui.rolling) return `<div class="bk-dieline">${dieHtml(g.die, true)}<p class="big">Es wird gewürfelt …</p></div>`;
  if (g.phase === 'roll') {
    const last = g.die ? `<div class="bk-dieline small">${dieHtml(g.die)}<p class="muted">Letzter Wurf: ${esc(dieBy ? dieBy.name : '')} – ${g.die}</p></div>` : '';
    if (mine) return `<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>${last}`;
    return `<p class="big center">Gleich würfelt <b>${esc(ap.name)}</b>. Bitte einen Moment Geduld.</p>${last}`;
  }
  if (g.phase === 'move') {
    if (!mine) return `<div class="bk-dieline">${dieHtml(g.die)}<p class="big"><b>${esc(ap.name)}</b> hat eine <b>${g.die}</b> gewürfelt und überlegt, welche Figur zieht.</p></div>`;
    const sel = S.ui.sel ? g.pieces.find((p) => p.id === S.ui.sel) : null;
    const fromHouse = sel && sel.pos === 'H';
    const kinds = sel ? new Set(mv.filter((m) => m.piece === sel.id).map((m) => (m.to === P.GOAL ? 'goal' : g.barriers.includes(m.to) ? 'bar' : g.pieces.some((p) => p.pos === m.to) ? 'cap' : 'free'))) : new Set();
    const key = [kinds.has('free') ? '<span class="bk-k free">grün</span> = freies Feld' : '', kinds.has('cap') ? '<span class="bk-k cap">rot</span> = du wirfst eine Figur hinaus' : '', kinds.has('bar') ? '<span class="bk-k bar">lila</span> = du nimmst eine Sperre auf' : '', kinds.has('goal') ? '<span class="bk-k cap">Ziel</span> = du gewinnst!' : ''].filter(Boolean).join(' · ');
    return `<div class="bk-dieline">${dieHtml(g.die)}<div>
      <p class="big">Du hast eine <b>${g.die}</b> gewürfelt.</p>
      <p>${sel ? 'Tippe jetzt auf ein <b>hervorgehobenes Feld</b>, auf das die Figur ziehen soll.' : 'Tippe auf eine <b>pulsierende Figur</b>, die du ziehen möchtest.'}</p></div></div>
      ${fromHouse ? `<p class="muted">Die Figur kommt aus dem Haus: Das Startfeld ist dein erster Schritt.</p>` : ''}
      ${sel ? `<p class="bk-key">${key}</p><button class="btn secondary" data-act="unsel">Andere Figur wählen</button>` : ''}`;
  }
  if (g.phase === 'place') {
    return mine
      ? `<p class="big">🚧 Die Sperre ist in deiner Hand. Tippe auf ein <b>grün markiertes freies Feld</b>. Nur die unterste Reihe ist nicht erlaubt.</p>`
      : `<p class="big"><b>${esc(ap.name)}</b> hat eine Sperre aufgenommen und stellt sie gleich neu auf.</p>`;
  }
  return '';
}

function toolbarHtml() {
  return `<div class="bk-tools" role="group" aria-label="Brettgröße">
    <button class="btn secondary" data-act="zoom-out" aria-label="Brett kleiner">🔍− Brett kleiner</button>
    <button class="btn secondary" data-act="zoom-in" aria-label="Brett größer">🔍+ Brett größer</button>
    <button class="btn secondary" data-act="zoom-fit" aria-label="Ganzes Brett zeigen">▣ Ganzes Brett</button></div>`;
}

function legendHtml() {
  return `<p class="bk-legend"><svg class="bk-ico" viewBox="-20 -20 40 40" aria-hidden="true"><rect x="-16" y="-16" width="32" height="32" rx="6" fill="#1b1b1b"/><rect x="-11" y="-10" width="22" height="5" fill="#fff"/><rect x="-11" y="-2.5" width="22" height="5" fill="#f2b705"/><rect x="-11" y="5" width="22" height="5" fill="#fff"/></svg> = Sperre (nicht überspringbar) &nbsp;·&nbsp; <b>ZIEL</b> = oben in der Mitte &nbsp;·&nbsp; farbiger Ring = Startfeld vor dem Haus</p>`;
}

function recapHtml(g) {
  if (!g.recap.length || S.ui.rolling) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function playersHtml(g) {
  return `<section class="card"><h2>Mitspielende</h2><ul class="players bk-players">${g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const home = g.pieces.filter((x) => x.color === p.color && x.pos === 'H').length;
    return `<li>${chip(p.color)} <span>${esc(p.name)}${p.id === cid ? ' (du)' : ''}${off}${i === g.active && g.phase !== 'over' ? ' 🎲' : ''}<br><span class="muted small">${home} von 5 Figuren im Haus</span></span></li>`;
  }).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  const head = `${ui.header()}${ui.lost()}`;
  if (g.phase === 'over') return overHtml(g, head);
  const mine = isMyTurn(g);
  const mv = mine && g.phase === 'move' && !S.ui.rolling ? P.legalMoves(g) : [];
  const movable = new Set(mv.map((m) => m.piece));
  const pt = mine && g.phase === 'place' && !S.ui.rolling ? P.placeTargets(g) : [];
  return `${head}${bannerHtml(g)}
    <section class="card action">${actionHtml(g, mv)}</section>
    ${toolbarHtml()}${boardSvg(g, { moves: mv, sel: S.ui.sel, placeTargets: pt, movable })}${legendHtml()}
    ${recapHtml(g)}${playersHtml(g)}`;
}

function overHtml(g, head) {
  const rank = P.ranking(g);
  const win = rank[0];
  const list = rank.map((r) => `<li class="${r.won ? 'win' : ''}"><span class="medal">${r.won ? '🏆' : ''}</span>
    <span class="rn">${chip(r.color, '')} ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.won ? 'Gewonnen!' : ''}</span>
    <div class="rd"><span class="chip">${r.won ? 'Ziel erreicht' : `Nächste Figur: noch ${r.dist} Felder vom Ziel`}</span></div></li>`).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${head}<section class="card over"><div class="trophy">🏆</div><h1>${esc(win.name)} hat gewonnen!</h1>
    <p class="center big">${chip(win.color)}</p><p class="center muted">${esc(g.endReason || '')}</p>
    <ol class="ranking">${list}</ol>
    <p class="muted center small">Die Reihenfolge der anderen zeigt nur, wer mit der nächsten Figur am dichtesten am Ziel war.</p>
    ${again}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml(g)}${boardSvg(g, {})}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Bringe als Erste/r eine deiner Figuren ins <b>Ziel</b> (oben in der Mitte des Bretts). Du musst es mit einem <b>genau passenden Wurf</b> erreichen. Wer das schafft, gewinnt sofort.</p>
    <h3>Die Spielsteine</h3>
    <p>Jede Person hat 5 Figuren einer Farbe (Rot, Grün, Gelb oder Blau). Zu zweit spielen Rot und Blau, zu dritt Rot, Gelb und Blau, zu viert alle vier Farben. Damit man die Figuren auch ohne Farbe erkennt, hat jede Farbe eine eigene Form und einen Buchstaben: Rot = Kreis (R), Grün = Quadrat (G), Gelb = Dreieck (Y), Blau = Raute (B).</p>
    <p>Dazu gibt es <b>11 Sperren</b> (schwarze Steine mit Streifen). Sie stehen am Anfang verteilt auf dem Brett.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Tippe auf <b>Würfeln</b>.</li>
      <li>Tippe auf <b>eine</b> deiner pulsierenden Figuren. Du ziehst immer nur eine Figur.</li>
      <li>Es leuchten alle Felder auf, die du mit genau dieser Augenzahl erreichen kannst. Tippe auf eines davon. Mit demselben Tippen auf die Figur wählst du sie wieder ab.</li>
    </ol>
    <p>Bei einer 6 gibt es keinen Extra-Wurf. Es ist dann die nächste Person dran.</p>
    <h3>Wie wird gezogen?</h3>
    <ul>
      <li>Du ziehst genau so viele Felder, wie der Würfel zeigt. Vorwärts, rückwärts und seitwärts ist erlaubt, an Abzweigungen darfst du abbiegen.</li>
      <li>Du darfst aber in einem Zug nicht vor und gleich wieder zurück: Kein Feld wird im selben Zug zweimal betreten.</li>
      <li>Eigene und fremde <b>Figuren darfst du überspringen</b>. Auf einem Feld darf nur eine Figur stehen. Auf eine eigene Figur darfst du deshalb nicht ziehen.</li>
      <li>Landest du genau auf einer <b>fremden Figur</b>, wird sie hinausgeworfen und kommt zurück in ihr Haus. Das ist nie Pflicht: Du entscheidest selbst, wohin du ziehst.</li>
    </ul>
    <h3>Aus dem Haus ziehen</h3>
    <p>Alle Figuren starten im Haus. Der erste Schritt einer Figur aus dem Haus ist das <b>Startfeld</b> (farbiger Ring) direkt vor dem Haus. Mit einer 1 steht sie also genau auf dem Startfeld, mit einer 4 zieht sie vom Startfeld noch 3 Felder weiter. Du kannst jederzeit eine Figur aus dem Haus ziehen, wenn der Wurf passt.</p>
    <h3>Sperren</h3>
    <ul>
      <li>Eine Sperre darf <b>nicht übersprungen</b> werden. Du kannst nur genau auf das Feld mit der Sperre ziehen (als letzten Schritt).</li>
      <li>Dann nimmst du die Sperre auf und <b>musst sie sofort wieder aufstellen</b>: auf ein beliebiges freies Feld (kein Stein, keine andere Sperre), aber nicht in der untersten Reihe, nicht ins Haus und nicht auf das Ziel. Alle erlaubten Felder leuchten grün.</li>
      <li>So kannst du Gegner aufhalten oder dir selbst den Weg freimachen.</li>
    </ul>
    <h3>Wenn nichts geht</h3>
    <p>Gibt es mit dem Wurf einen erlaubten Zug, musst du ziehen (welche Figur, entscheidest du). Gibt es keinen, verfällt der Wurf: Das Programm zeigt „kann nicht ziehen“ und die nächste Person ist dran.</p>
    <h3>Der Brett-Ausschnitt</h3>
    <p>Das Brett ist breit. Auf dem Handy kannst du es mit dem Finger verschieben. Mit „Brett größer“, „Brett kleiner“ und „Ganzes Brett“ änderst du die Größe. Wenn du eine Figur antippst, springt der Ausschnitt von selbst dorthin.</p>
    <h3>Spielende</h3>
    <p>Sobald eine Figur das Ziel mit genau passendem Wurf erreicht, ist das Spiel aus. Diese Person gewinnt. Die übrigen werden nur danach angezeigt, wie nah ihre beste Figur am Ziel war.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und zeigt dir nur an, was möglich ist. Was du damit machst, entscheidest du ganz allein.</p>`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  title: 'Barrikade', icon: '🚧', sub: 'Würfeln, ziehen, Sperren versetzen – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Barrikade', helpBody: helpBody(),
  minPlayers: 2,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'pick': {
        if (!isMyTurn(g) || g.phase !== 'move' || S.ui.rolling) return;
        const id = el.dataset.piece;
        S.ui.sel = S.ui.sel === id ? null : id;
        const mv = P.legalMoves(g);
        if (S.ui.sel) {
          const p = g.pieces.find((x) => x.id === id);
          S.ui.pend = { pts: [pieceXY(g, p), ...mv.filter((m) => m.piece === id).map((m) => nodeXY(m.to))] };
        } else {
          const ids = new Set(mv.map((m) => m.piece));
          S.ui.pend = { pts: g.pieces.filter((p) => ids.has(p.id)).map((p) => pieceXY(g, p)) };
        }
        return render();
      }
      case 'unsel': S.ui.sel = null; return render();
      case 'dest': {
        if (!S.ui.sel || !isMyTurn(g) || g.phase !== 'move') return;
        const piece = S.ui.sel;
        S.ui.sel = null;
        return sess.send({ t: 'move', piece, to: el.dataset.node });
      }
      case 'place': return isMyTurn(g) && g.phase === 'place' ? sess.send({ t: 'place', node: el.dataset.node }) : undefined;
      case 'zoom-in': case 'zoom-out': case 'zoom-fit': return zoom(act);
    }
  },
});

function zoom(act) {
  const sc = document.getElementById('bk-scroll');
  const svg = sc && sc.querySelector('svg');
  if (!sc || !svg) return;
  const cur = svg.getBoundingClientRect().width / BW;
  const frac = { x: (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth, y: (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight };
  if (act === 'zoom-fit') { S.ui.fit = true; S.ui.pend = { frac: { x: 0.5, y: 0.5 } }; return render(); }
  S.ui.fit = false;
  const next = act === 'zoom-in' ? ZOOMS.find((z) => z > cur + 0.02) : [...ZOOMS].reverse().find((z) => z < cur - 0.02);
  S.ui.zoom = next || (act === 'zoom-in' ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]);
  sess.set('bkzoom', S.ui.zoom);
  S.ui.pend = { frac };
  render();
}

function render() { ui.render(); }

// ====================== Ausschnitt des Bretts merken und nachführen ======================
$app.addEventListener('scroll', (ev) => {
  const t = ev.target;
  if (t && t.id === 'bk-scroll') S.ui.scroll = { x: t.scrollLeft, y: t.scrollTop };
}, true);

// Zeigt den Ausschnitt so, dass die Figur (erster Punkt) und möglichst viele der übrigen Punkte sichtbar sind
function scrollToPoints(sc, pts) {
  const svg = sc.querySelector('svg');
  if (!svg || !pts.length) return;
  const k = svg.getBoundingClientRect().width / BW;
  const W = sc.clientWidth; const H = sc.clientHeight;
  const pad = 0.7 * U * k;
  const px = pts.map((p) => ({ x: p.x * k, y: p.y * k }));
  const inWin = (c, p) => Math.abs(p.x - c.x) <= W / 2 - pad && Math.abs(p.y - c.y) <= H / 2 - pad;
  const cands = [px[0], ...px.slice(1), ...px.slice(1).map((p) => ({ x: (p.x + px[0].x) / 2, y: (p.y + px[0].y) / 2 }))];
  const cx = (px.reduce((s, p) => s + p.x, 0)) / px.length; const cy = (px.reduce((s, p) => s + p.y, 0)) / px.length;
  cands.push({ x: cx, y: cy });
  let best = null;
  for (const c of cands) {
    if (!inWin(c, px[0])) continue;
    const score = px.filter((p) => inWin(c, p)).length;
    if (!best || score > best.score) best = { c, score };
  }
  const c = best ? best.c : px[0];
  sc.scrollTo({ left: c.x - W / 2, top: c.y - H / 2 });
}

new MutationObserver(() => {
  const sc = document.getElementById('bk-scroll');
  if (!sc) return;
  const f = S.ui.pend;
  S.ui.pend = null;
  if (f && f.frac) {
    sc.scrollLeft = f.frac.x * sc.scrollWidth - sc.clientWidth / 2;
    sc.scrollTop = f.frac.y * sc.scrollHeight - sc.clientHeight / 2;
  } else if (f && f.pts) {
    scrollToPoints(sc, f.pts);
  } else if (S.ui.scroll) {
    sc.scrollLeft = S.ui.scroll.x; sc.scrollTop = S.ui.scroll.y;
  }
  S.ui.scroll = { x: sc.scrollLeft, y: sc.scrollTop };
}).observe($app, { childList: true });

// Bedienung per Tastatur für die Felder und Figuren im Brett
$app.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('svg [data-act]')) {
    ev.preventDefault();
    ev.target.closest('[data-act]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});

ui.boot();
