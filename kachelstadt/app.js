import * as E from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { tileInner, tileSvg, meepleGlyph, meepleIcon, segAnchor, COLORS, KIND_LABEL, KIND_PLACE } from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const ZOOMS = [56, 64, 72, 84, 96, 110];
const freshUi = () => ({ rot: 0, rotKey: '', note: '', anchor: null, anchorRound: -1 });

const sess = createSession({
  game: 'kachelstadt',
  maxPlayers: 5,
  newGame: (players) => { S.ui = { ...S.ui, ...freshUi() }; return E.createGame(players); },
  onMessage: (state, pid, msg) => { E.handle(state, pid, msg); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 750,
    step: (g, level) => {
      if (!g || g.game !== 'ks' || g.phase === 'over') return null;
      const ap = E.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...S.ui, ...freshUi(), zoom: Number(sess.get('ks_zoom', 72)) || 72 };
if (!ZOOMS.includes(S.ui.zoom)) S.ui.zoom = 72;

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const isMine = (g) => !!g && g.phase !== 'over' && g.players[g.active] && g.players[g.active].id === cid;

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.game === 'ks') {
    if (S.ui.anchorRound !== g.round) {
      S.ui.anchorRound = g.round;
      S.ui.anchor = g.last ? { x: g.last.x + 0.5, y: g.last.y + 0.5 } : { x: 0.5, y: 0.5 };
    }
    if (S.ui.note && g.phase === 'place' && isMine(g) && g.round > (S.ui.noteRound || 0) && Date.now() - (S.ui.noteAt || 0) > 6000) S.ui.note = '';
  }
  const view = `${S.screen}|${g ? g.phase === 'over' : ''}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Zug-Daten (gemerkt je Zug) ======================
let moveCache = { key: '', cells: new Map(), allowed: [] };
function moves(g) {
  const key = `${g.round}|${g.phase}|${g.current}|${g.active}|${g.last ? g.last.x + ',' + g.last.y : ''}|${g.deckLeft}`;
  if (moveCache.key === key) return moveCache;
  const cells = new Map();
  const seen = new Set();
  if (g.phase === 'place' && g.current) {
    for (const m of E.legalPlacements(g)) {
      const k = m.x + ',' + m.y;
      if (!cells.has(k)) cells.set(k, { x: m.x, y: m.y, rots: new Set() });
      cells.get(k).rots.add(m.r);
      seen.add(m.r);
    }
  }
  const allowed = g.current ? E.uniqueRotations(g.current).filter((r) => seen.has(r)) : [];
  moveCache = { key, cells, allowed };
  return moveCache;
}
// Aktuelle Drehung der Vorschau (muss zu den erlaubten gehören)
function currentRot(g) {
  const mv = moves(g);
  const key = `${g.round}|${g.current}`;
  if (S.ui.rotKey !== key) { S.ui.rotKey = key; S.ui.rot = mv.allowed.length ? mv.allowed[0] : 0; }
  if (mv.allowed.length && !mv.allowed.some((r) => r === S.ui.rot || sameShape(g.current, r, S.ui.rot))) S.ui.rot = mv.allowed[0];
  return S.ui.rot;
}
const sameShape = (typ, a, b) => E.edgeKinds(typ, a) === E.edgeKinds(typ, b) && JSON.stringify(E.rotatedSegments(typ, a).map((s) => s.p.slice().sort((x, y) => x - y)).sort()) === JSON.stringify(E.rotatedSegments(typ, b).map((s) => s.p.slice().sort((x, y) => x - y)).sort());

// ====================== Brett (SVG) ======================
function boardHtml(g, interactive) {
  const B = E.boardBounds(g);
  const vx0 = B.minX - 1, vy0 = B.minY - 1;
  const cols = B.maxX - B.minX + 3, rows = B.maxY - B.minY + 3;
  const z = interactive && isMine(g) && g.phase === 'meeple' ? Math.max(S.ui.zoom, 110) : S.ui.zoom; // beim Setzen groß, damit die Nummern gut treffbar sind
  const pos = (x, y) => [(x - vx0) * 100, (y - vy0) * 100];
  let tiles = '', meeples = '', over = '';
  for (const k of Object.keys(g.board)) {
    const t = g.board[k];
    const [x, y] = k.split(',').map(Number);
    const [gx, gy] = pos(x, y);
    tiles += `<g transform="translate(${gx} ${gy})">${tileInner(t.t, t.r)}<rect x="1" y="1" width="98" height="98" fill="none" stroke="rgba(30,50,10,.55)" stroke-width="2"/></g>`;
    for (const m of t.m) {
      const a = segAnchor(t.t, t.r, m.seg);
      const ps = g.players[m.p];
      meeples += `<g transform="translate(${gx + a[0]} ${gy + a[1]})" class="ks-mp"><title>Gefolgsmann ${esc(ps ? ps.name : '')} (${COLORS[m.p % 5].name})</title>${meepleGlyph(m.p, m.p + 1, 1.2)}</g>`;
    }
  }
  if (g.last) {
    const [gx, gy] = pos(g.last.x, g.last.y);
    over += `<rect class="ks-last" x="${gx + 3}" y="${gy + 3}" width="94" height="94"/>`;
  }
  const mine = interactive && isMine(g);
  if (mine && g.phase === 'place') {
    const mv = moves(g);
    const rot = currentRot(g);
    for (const c of mv.cells.values()) {
      const [gx, gy] = pos(c.x, c.y);
      const fit = c.rots.has(rot);
      over += `<g data-act="cell" data-x="${c.x}" data-y="${c.y}" data-fit="${fit ? 1 : 0}" tabindex="0" role="button" aria-label="${fit ? 'Hier passt dein Plättchen' : 'Hier passt dein Plättchen, wenn es gedreht wird'}">`
        + (fit ? `<g transform="translate(${gx} ${gy})" opacity=".62">${tileInner(g.current, rot)}</g>` : '')
        + `<rect class="ks-cand ${fit ? 'fit' : 'alt'}" x="${gx + 4}" y="${gy + 4}" width="92" height="92" rx="8"/>`
        + (fit ? '' : `<text class="ks-alt-t" x="${gx + 50}" y="${gy + 62}" text-anchor="middle">⟳</text>`)
        + '</g>';
    }
  }
  if (mine && g.phase === 'meeple' && g.last) {
    const t = g.board[g.last.x + ',' + g.last.y];
    const [gx, gy] = pos(g.last.x, g.last.y);
    E.meepleOptions(g).forEach((o, i) => {
      const a = segAnchor(t.t, t.r, o.seg);
      over += `<g data-act="mp" data-seg="${o.seg}" tabindex="0" role="button" aria-label="${KIND_LABEL[o.kind]} ${KIND_PLACE[o.kind]} setzen, Nummer ${i + 1}">`
        + `<circle cx="${gx + a[0]}" cy="${gy + a[1]}" r="15" fill="transparent"/>`
        + `<circle class="ks-mt-c" cx="${gx + a[0]}" cy="${gy + a[1]}" r="15"/>`
        + `<text class="ks-mt-n" x="${gx + a[0]}" y="${gy + a[1] + 7.5}" text-anchor="middle">${i + 1}</text></g>`;
    });
  }
  return `<div class="ks-scroll" id="board" data-minx="${vx0}" data-miny="${vy0}" data-zoom="${z}" tabindex="-1">`
    + `<svg class="ks-board" width="${cols * z}" height="${rows * z}" viewBox="0 0 ${cols * 100} ${rows * 100}" role="group" aria-label="Spielbrett">${tiles}${meeples}${over}</svg></div>`;
}

// Scrollstand des Bretts: wird als Mittelpunkt in Brettkoordinaten gemerkt und nach jedem Neuzeichnen wiederhergestellt
let ignoreScrollUntil = 0;
function restoreScroll() {
  const el = document.getElementById('board');
  if (!el || !S.ui.anchor) return;
  const z = Number(el.dataset.zoom), minx = Number(el.dataset.minx), miny = Number(el.dataset.miny);
  const wantX = (S.ui.anchor.x - minx) * z - el.clientWidth / 2;
  const wantY = (S.ui.anchor.y - miny) * z - el.clientHeight / 2;
  ignoreScrollUntil = Date.now() + 120;
  el.scrollLeft = Math.max(0, wantX);
  el.scrollTop = Math.max(0, wantY);
}
new MutationObserver(() => restoreScroll()).observe($app, { childList: true });
$app.addEventListener('scroll', (ev) => {
  const el = ev.target;
  if (!el || el.id !== 'board' || Date.now() < ignoreScrollUntil) return;
  const z = Number(el.dataset.zoom), minx = Number(el.dataset.minx), miny = Number(el.dataset.miny);
  const a = S.ui.anchor || { x: 0.5, y: 0.5 };
  if (el.scrollWidth > el.clientWidth + 1) a.x = minx + (el.scrollLeft + el.clientWidth / 2) / z;
  if (el.scrollHeight > el.clientHeight + 1) a.y = miny + (el.scrollTop + el.clientHeight / 2) / z;
  S.ui.anchor = a;
}, true);

// ====================== Darstellung ======================
function bannerHtml() {
  const g = S.game;
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = E.activePlayer(g);
  if (isMine(g)) return `<div class="banner mine">${g.phase === 'place' ? 'Du bist dran – lege dein Plättchen' : 'Du bist dran – Gefolgsmann setzen?'}</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran (${COLORS[g.active % 5].name})</div>`;
}

function previewHtml(g) {
  const mine = isMine(g);
  const ap = E.activePlayer(g);
  let tile = '', who = '', btn = '';
  if (g.phase === 'place' && g.current) {
    const rot = mine ? currentRot(g) : 0;
    tile = tileSvg(g.current, rot, 'ks-prev-tile', 'Das gezogene Plättchen');
    who = mine ? 'Dein Plättchen' : `Plättchen von ${esc(ap.name)}`;
    if (mine) {
      const n = moves(g).allowed.length;
      btn = `<button class="btn primary huge ks-rot" data-act="rot" ${n < 2 ? 'disabled' : ''}>Drehen ⟳</button>`
        + `<p class="ks-small">${n < 2 ? 'Dieses Plättchen passt nur in einer Lage.' : 'Tippe auf Drehen, bis es passt.'}</p>`;
    } else btn = `<p class="ks-wait">${esc(ap.name)} überlegt …</p>`;
  } else if (g.phase === 'meeple' && g.last) {
    const t = g.board[g.last.x + ',' + g.last.y];
    tile = tileSvg(t.t, t.r, 'ks-prev-tile', 'Das gerade gelegte Plättchen');
    who = mine ? 'Gerade gelegt' : `Gelegt von ${esc(ap.name)}`;
    btn = mine
      ? `<button class="btn secondary huge ks-rot" data-act="mp-none">Keinen Gefolgsmann setzen</button><p class="ks-small">Oder tippe auf eine Nummer im Brett.</p>`
      : `<p class="ks-wait">${esc(ap.name)} überlegt …</p>`;
  }
  return `<section class="card ks-prev"><div class="ks-prev-l">${tile}</div><div class="ks-prev-r"><div class="ks-who">${who}</div>${btn}
    <div class="ks-left">Noch <b>${g.deckLeft}</b> Plättchen</div></div></section>`;
}

function zoomRow() {
  const i = ZOOMS.indexOf(S.ui.zoom);
  return `<div class="ks-zoom"><button class="btn" data-act="zoom-out" ${i <= 0 ? 'disabled' : ''}>− Kleiner</button>
    <button class="btn" data-act="zoom-in" ${i >= ZOOMS.length - 1 ? 'disabled' : ''}>＋ Größer</button></div>`;
}

function scoreLines(g) {
  return (g.recap || []).filter((l) => /Punkt|kehren/.test(l));
}

function statusHtml(g) {
  const mine = isMine(g);
  const ap = E.activePlayer(g);
  let main = '', extra = '';
  if (mine && g.phase === 'place') {
    const n = moves(g).cells.size;
    main = `Tippe auf ein grünes Feld, um dein Plättchen zu legen. ${n === 1 ? 'Es gibt 1 mögliches Feld.' : `Es gibt ${n} mögliche Felder.`}`;
  } else if (mine && g.phase === 'meeple') {
    const opts = E.meepleOptions(g);
    main = 'Möchtest du einen Gefolgsmann auf das neue Plättchen stellen? Tippe auf eine Nummer:';
    extra = `<div class="ks-opts">${opts.map((o, i) => `<button class="btn secondary ks-opt" data-act="mp" data-seg="${o.seg}"><span class="ks-num">${i + 1}</span> ${KIND_LABEL[o.kind]} ${KIND_PLACE[o.kind]}</button>`).join('')}</div>`;
  } else if (g.phase === 'place') main = `${esc(ap.name)} legt ein Plättchen …`;
  else main = `${esc(ap.name)} überlegt, ob ein Gefolgsmann gesetzt wird …`;
  const sr = scoreLines(g).map((l) => esc(l)).join(' ');
  const note = S.ui.note ? `<div class="ks-hint" role="alert">${esc(S.ui.note)}</div>` : '';
  return `<section class="card action ks-status"><p class="big">${main}${sr ? `<span class="sr-only"> Wertung: ${sr}</span>` : ''}</p>${extra}${note}</section>`;
}

function legendHtml(g) {
  return `<div class="ks-legend"><span class="l-fit">Grün: hier passt dein Plättchen</span><span class="l-alt">Hell: nur anders gedreht</span><span class="l-last">Blau: zuletzt gelegt</span></div>`;
}

function playersHtml(g) {
  const me = myIndex();
  return `<section class="card ks-players"><h2>Punkte</h2>${g.players.map((p, i) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const dots = Array.from({ length: E.MEEPLES }, (_, k) => `<span class="ks-dot${k < p.meeples ? ' on' : ''}" style="--c:${COLORS[i % 5].fill}"></span>`).join('');
    return `<div class="ks-pl${g.phase !== 'over' && g.active === i ? ' turn' : ''}">
      <div class="ks-pl-top">${meepleIcon(i, i + 1, 40)}<div class="ks-pl-n"><b>${esc(p.name)}${i === me ? ' (du)' : ''}</b><span>${COLORS[i % 5].name}${off}${g.phase !== 'over' && g.active === i ? ' – ist dran' : ''}</span></div>
      <div class="ks-pl-s"><b>${p.score}</b><span>${p.score === 1 ? 'Punkt' : 'Punkte'}</span></div></div>
      <div class="ks-pl-h" aria-label="${p.meeples} von ${E.MEEPLES} Gefolgsleuten in der Hand">Gefolgsleute in der Hand: <span class="ks-dots">${dots}</span> <b>${p.meeples}</b></div></div>`;
  }).join('')}</section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml();
  return `${ui.header()}${ui.lost()}${bannerHtml()}${previewHtml(g)}
    <section class="card ks-boardcard">${boardHtml(g, true)}${zoomRow()}${legendHtml(g)}</section>
    ${statusHtml(g)}${playersHtml(g)}${recapHtml(g)}`;
}

function overHtml() {
  const g = S.game;
  const res = g.result || { winners: [], ranking: E.ranking(g) };
  const rank = res.ranking;
  const winners = rank.filter((r) => r.place === 1);
  const iWon = winners.some((w) => w.id === cid);
  let title;
  if (winners.length === 1) title = iWon ? 'Du hast gewonnen! Glückwunsch!' : `${esc(winners[0].name)} hat gewonnen!`;
  else title = iWon ? `Gleichstand: Du und ${winners.filter((w) => w.id !== cid).map((w) => esc(w.name)).join(' und ')} habt gewonnen!` : `Gleichstand: ${winners.map((w) => esc(w.name)).join(' und ')} haben gewonnen!`;
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r) => {
    const i = g.players.findIndex((p) => p.id === r.id);
    return `<li class="${r.place === 1 ? 'win' : ''}"><span class="medal">${r.place === 1 ? '🏆' : medals[r.place - 1] || ''}</span>
      <span class="rn">${meepleIcon(i, i + 1, 30)} ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.score} ${r.score === 1 ? 'Punkt' : 'Punkte'}</span>
      <div class="rd"><span class="chip">${r.place}. Platz</span><span class="chip">${COLORS[i % 5].name}</span></div></li>`;
  }).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over ks-over"><div class="trophy">🏆</div><h1>${title}</h1>
      <p class="center muted">Alle Plättchen sind gelegt. Unfertige Gebilde wurden zum Schluss gezählt.</p>
      <ol class="ranking">${list}</ol>${again}
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml(g)}
    <section class="card ks-boardcard"><h2>So sah die Stadt am Ende aus</h2>${boardHtml(g, false)}${zoomRow()}</section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Ihr baut gemeinsam eine Stadt mit Straßen, Wiesen und Klöstern. Mit euren Gefolgsleuten sammelt ihr Punkte. Wer am Ende die meisten Punkte hat, gewinnt.</p>
    <h3>Dein Zug</h3>
    <p>Ein Zug hat zwei Schritte: Erst legst du ein Plättchen an, danach darfst du einen Gefolgsmann daraufstellen.</p>
    <h3>1. Plättchen anlegen</h3>
    <p>Du bekommst ein Plättchen. Es muss an ein Plättchen anliegen, das schon da ist. Die Kanten müssen zusammenpassen: <b>Stadt an Stadt</b> (braun), <b>Straße an Straße</b> (helles Band) und <b>Wiese an Wiese</b> (grün).</p>
    <p>Mit dem Knopf <b>Drehen</b> drehst du das Plättchen. Die <b>grünen Felder</b> zeigen, wo es passt. Tippe einfach auf ein grünes Feld, schon liegt das Plättchen dort. Helle Felder passen nur, wenn das Plättchen anders liegt. Tippst du darauf, dreht das Spiel es für dich. Passt ein Plättchen nirgends, wird es aus dem Spiel genommen.</p>
    <h3>2. Gefolgsmann setzen</h3>
    <p>Danach darfst du <b>einen</b> Gefolgsmann auf das Plättchen stellen, das du gerade gelegt hast. Jede Person hat 7 Gefolgsleute. Wo er steht, bestimmt seinen Namen:</p>
    <ul>
      <li><b>Ritter</b> in einer Stadt,</li>
      <li><b>Wegelagerer</b> an einer Straße,</li>
      <li><b>Mönch</b> in einem Kloster (das rote Häuschen),</li>
      <li><b>Bauer</b> auf einer Wiese.</li>
    </ul>
    <p>Das geht nur, wenn die ganze Stadt, Straße oder Wiese, zu der der Platz gehört, noch von niemandem besetzt ist – auch nicht weiter hinten. Tippe auf eine Nummer im Plättchen oder auf einen der Knöpfe. Du musst keinen Gefolgsmann setzen: Tippe dann auf <b>Keinen Gefolgsmann setzen</b>. Hast du keinen mehr in der Hand, geht es gleich weiter.</p>
    <h3>Punkte</h3>
    <p>Wird etwas <b>fertig</b>, gibt es sofort Punkte, und die Gefolgsleute darauf kommen zu ihren Besitzern zurück:</p>
    <ul>
      <li><b>Fertige Straße</b> (beide Enden abgeschlossen): 1 Punkt für jedes Plättchen der Straße.</li>
      <li><b>Fertige Stadt</b> (rundum durch Mauern geschlossen): 2 Punkte für jedes Plättchen und 2 Punkte extra für jedes Wappen.</li>
      <li><b>Kloster</b>, wenn es rundherum von 8 Plättchen umgeben ist: 9 Punkte.</li>
    </ul>
    <p>Stehen mehrere Gefolgsleute an derselben Stadt oder Straße, bekommt die Person Punkte, die dort die meisten hat. Bei Gleichstand bekommen alle Beteiligten die vollen Punkte.</p>
    <h3>Spielende</h3>
    <p>Das Spiel endet, wenn alle Plättchen gelegt sind. Dann zählt alles Unfertige:</p>
    <ul>
      <li>Unfertige Straße: 1 Punkt pro Plättchen.</li>
      <li>Unfertige Stadt: 1 Punkt pro Plättchen und 1 Punkt pro Wappen.</li>
      <li>Kloster: 1 Punkt für das Kloster selbst und 1 Punkt für jedes Plättchen daneben.</li>
      <li><b>Bauern</b> zählen nur jetzt: 3 Punkte für jede fertige Stadt, die an die Wiese grenzt. Bauern bleiben bis zum Schluss stehen.</li>
    </ul>
    <h3>Das Brett</h3>
    <p>Mit <b>Größer</b> und <b>Kleiner</b> änderst du die Größe der Plättchen. Das Brett kannst du mit dem Finger verschieben. Das zuletzt gelegte Plättchen hat einen blauen Rahmen. Jeder Gefolgsmann trägt die Farbe und die Nummer seiner Person; die Punktetafel unten zeigt, wer welche Farbe hat.</p>
    <p class="muted">Keine Sorge: Das Programm zeigt nur erlaubte Felder und rechnet alle Punkte selbst aus. Wie du spielst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
function tapCell(x, y) {
  const g = S.game;
  if (!g || !isMine(g) || g.phase !== 'place') return;
  const mv = moves(g);
  const c = mv.cells.get(x + ',' + y);
  if (!c) return;
  let r = currentRot(g);
  if (!c.rots.has(r)) {
    for (let i = 1; i <= 4; i++) { const q = (r + i) % 4; if (c.rots.has(q)) { r = q; break; } }
    S.ui.rot = r;
    S.ui.note = 'Dein Plättchen passte dort nicht in dieser Lage. Das Spiel hat es für dich passend gedreht.';
    S.ui.noteRound = g.round + 1;
    S.ui.noteAt = Date.now();
  } else S.ui.note = '';
  sess.send({ t: 'place', x, y, r });
}

const ui = createUI({
  sess, $app,
  bots: [1, 2, 3, 4], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  title: 'Kachelstadt', icon: '🏰', sub: 'Plättchen legen, Gefolgsleute setzen, Punkte sammeln – für 2 bis 5 Personen',
  helpTitle: 'Die Spielregeln von Kachelstadt', helpBody: helpBody(),
  minPlayers: 2,
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'cell': return tapCell(Number(el.dataset.x), Number(el.dataset.y));
      case 'rot': {
        const g = S.game;
        if (!g || !isMine(g) || g.phase !== 'place') return undefined;
        const al = moves(g).allowed;
        if (al.length < 2) return undefined;
        const cur = currentRot(g);
        const next = al.find((r) => r > cur) ?? al[0];
        S.ui.rot = next;
        S.ui.note = '';
        return render();
      }
      case 'mp': {
        const g = S.game;
        if (!g || !isMine(g) || g.phase !== 'meeple') return undefined;
        return sess.send({ t: 'meeple', seg: Number(el.dataset.seg) });
      }
      case 'mp-none': {
        const g = S.game;
        if (!g || !isMine(g) || g.phase !== 'meeple') return undefined;
        return sess.send({ t: 'meeple', seg: null });
      }
      case 'zoom-in': case 'zoom-out': {
        const i = ZOOMS.indexOf(S.ui.zoom) + (act === 'zoom-in' ? 1 : -1);
        if (i < 0 || i >= ZOOMS.length) return undefined;
        S.ui.zoom = ZOOMS[i];
        sess.set('ks_zoom', S.ui.zoom);
        return render();
      }
    }
    return undefined;
  },
});
function render() { ui.render(); }
// Tastatur: Enter/Leertaste auf einem markierten Feld wirkt wie Antippen
$app.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if ((ev.key === 'Enter' || ev.key === ' ') && t.getAttribute && t.getAttribute('role') === 'button' && t.dataset && t.dataset.act && t.namespaceURI.includes('svg')) {
    ev.preventDefault();
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});
// Der Schließen-Knopf im Hilfefenster liegt im Fenster, dessen Klick nicht nach oben weitergereicht wird (ui.js).
$app.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('.modal [data-act="help-close"]');
  if (!b) return;
  ev.stopPropagation();
  S.ui.helpOpen = false;
  render();
}, true);
ui.boot();
