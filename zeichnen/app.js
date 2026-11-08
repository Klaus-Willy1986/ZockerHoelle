import * as Q from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';
import { SIZE, MIN_DIST, toPoint, strokeMessages, paintAll, paintStroke } from './draw.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'long', label: 'Mehr Zeit: 150 Sekunden', help: 'Ohne Häkchen hat jede Runde 90 Sekunden.', def: false },
  { id: 'nolimit', label: 'Ohne Zeitdruck (kein Limit)', help: 'Die Runde endet, wenn alle richtig geraten haben oder der Gastgeber sie beendet. Dann gibt es keine Zeit-Punkte und keine Buchstaben-Hinweise. Hat Vorrang vor „Mehr Zeit“.', def: false },
  { id: 'twice', label: 'Jede Person zeichnet zweimal', help: 'Ohne Häkchen zeichnet jede Person einmal.', def: false },
  { id: 'local', label: 'Alle am selben Gerät', help: 'Wirkt beim Knopf „Allein spielen“: Eine Gruppe im selben Raum spielt an diesem einen Gerät. Du gibst die Namen ein, das Gerät wandert reihum, die anderen raten laut.', def: false },
];

// ?seed=123 in der Adresse: feste Mischung (für Tests). ?zeit=20: Rundenzeit in Sekunden (nur für Tests).
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const rng = seedParam !== null && /^\d+$/.test(seedParam) ? seededRng(Number(seedParam)) : Math.random;
const zeitParam = /^\d+$/.test(params.get('zeit') || '') ? Number(params.get('zeit')) : 0;
const LERN_DELAY = [5000, 6000]; // Lernrunde: so lange (ms) wartet der Computer vor dem 1. und dem 2. Rateversuch
const LERN_RATEN = ['Zelt', 'Haus'];

const freshUi = () => ({
  sig: '', t0: Date.now(), tool: { c: 0, w: 1 }, seq: 0, L: { strokes: [] }, drawing: false, dirty: false,
  draft: '', focusIn: false, nameDraft: '', focusName: false, peek: false, pick: false,
});
const timers = { game: [], key: '', learn: null, learnKey: '' };
function clearTimers() { timers.game.forEach(clearTimeout); timers.game = []; timers.key = ''; clearTimeout(timers.learn); timers.learn = null; timers.learnKey = ''; }

function makeGame(players, opts) {
  const host = sess.cid;
  if (S.learn) return Q.createGame(players, { mode: 'learn', host }, rng);
  // "Allein spielen" heißt hier immer: alle am selben Gerät (allein zeichnen und raten geht nicht)
  const mode = S.room === 'SOLO' ? 'local' : 'online';
  let used = sess.get('zr_used', []);
  if (!Array.isArray(used)) used = [];
  return Q.createGame(players, { mode, host, long: !!opts.long, nolimit: !!opts.nolimit, twice: !!opts.twice, exclude: used.slice(-300), limitMs: zeitParam * 1000 || undefined }, rng);
}

const sess = createSession({
  game: 'zr',
  maxPlayers: Q.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => { Object.assign(S.ui, { ...freshUi(), tool: S.ui.tool }); clearTimers(); return makeGame(players, opts); },
  onMessage: (state, pid, msg) => {
    // Der Gastgeber handelt für die Person, die gerade zeichnet (selbes Gerät) bzw. lässt den Lern-Computer raten
    if (msg && msg.t === 'as') {
      if (S.room === 'SOLO' && pid === state.host && typeof msg.id === 'string' && msg.msg && typeof msg.msg === 'object' && (state.mode === 'local' || Q.isBotId(msg.id))) Q.handle(state, msg.id, msg.msg, rng);
      return;
    }
    Q.handle(state, pid, msg, rng);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, { ...freshUi(), tool: S.ui.tool }); clearTimers(); lastSig = ''; },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Zeichenfläche (bleibt beim Neuaufbau der Seite erhalten) ======================
const cv = document.createElement('canvas');
cv.id = 'zr-canvas';
cv.setAttribute('aria-label', 'Zeichenfläche');
cv.style.touchAction = 'none';
const cx = cv.getContext('2d');
let pen = null;

const isDrawer = (g) => !!g && (g.mode === 'local' ? true : Q.drawerId(g) === cid);
const canDraw = (g) => !!g && g.phase === 'draw' && S.screen === 'game' && isDrawer(g) && !S.ui.helpOpen;
// Der Zeichner sieht seine eigene Zeichnung aus dem lokalen Strichspeicher (kein Flackern durch Netzverzögerung)
const shownStrokes = (g) => (g.phase === 'draw' && isDrawer(g) ? S.ui.L.strokes : g.strokes);

function sizeCanvas() {
  const w = Math.max(50, Math.round(cv.clientWidth || 300));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(w * dpr);
  if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
}
function redraw() {
  const g = S.game;
  if (!g || !cv.isConnected) return;
  sizeCanvas();
  const strokes = shownStrokes(g);
  paintAll(cx, strokes, cv.width);
  cv.dataset.strokes = String(strokes.length);
}
let rafId = 0;
function scheduleRedraw() { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; redraw(); }); }
window.addEventListener('resize', scheduleRedraw);

function mountCanvas() {
  const slot = $app.querySelector('#board');
  if (!slot) return;
  if (cv.parentNode !== slot) slot.appendChild(cv);
  redraw();
}

// ui.js baut die Seite auch ohne uns neu auf (z. B. Regeln öffnen): dann die Fläche wieder einsetzen
new MutationObserver(() => { const slot = $app.querySelector('#board'); if (slot && cv.parentNode !== slot) mountCanvas(); }).observe($app, { childList: true });

// Eine Zeichen-Nachricht senden (selbes Gerät: im Namen der zeichnenden Person)
function sendDraw(msg) {
  const g = S.game;
  if (!g) return;
  if (g.mode === 'local') sess.send({ t: 'as', id: Q.drawerId(g), msg });
  else sess.send(msg);
}

const pointOf = (ev) => {
  const r = cv.getBoundingClientRect();
  return toPoint(((ev.clientX - r.left) / r.width) * SIZE, ((ev.clientY - r.top) / r.height) * SIZE);
};
let flushTimer = null; let watchdog = null;
function flush() {
  if (!pen) return;
  const rest = pen.stroke.p.slice(pen.sent);
  if (!rest.length) return;
  for (const m of strokeMessages(rest, { c: pen.stroke.c, w: pen.stroke.w, k: pen.stroke.k })) sendDraw(m);
  pen.sent += rest.length;
}
function endPen() {
  if (!pen) return;
  flush();
  clearInterval(flushTimer); clearTimeout(watchdog);
  pen = null;
  S.ui.drawing = false;
  if (S.ui.dirty) { S.ui.dirty = false; render(); }
}
cv.addEventListener('pointerdown', (ev) => {
  const g = S.game;
  if (!canDraw(g) || pen || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  ev.preventDefault();
  try { cv.setPointerCapture(ev.pointerId); } catch { /* egal */ }
  const k = Math.max(S.ui.seq, g.sk | 0) + 1;
  S.ui.seq = k;
  const { c, w } = S.ui.tool;
  const stroke = { k, c, w, p: [pointOf(ev)] };
  S.ui.L.strokes.push(stroke);
  pen = { id: ev.pointerId, stroke, sent: 0 };
  S.ui.drawing = true;
  paintStroke(cx, stroke, cv.width / SIZE);
  cv.dataset.strokes = String(S.ui.L.strokes.length);
  clearInterval(flushTimer); flushTimer = setInterval(flush, 80);
  clearTimeout(watchdog); watchdog = setTimeout(endPen, 15000); // Notausgang, falls das Loslassen verloren geht
});
cv.addEventListener('pointermove', (ev) => {
  if (!pen || ev.pointerId !== pen.id) return;
  ev.preventDefault();
  const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
  for (const e of (list.length ? list : [ev])) {
    const p = pointOf(e);
    const a = pen.stroke.p[pen.stroke.p.length - 1];
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) < MIN_DIST) continue;
    pen.stroke.p.push(p);
    paintStroke(cx, { ...pen.stroke, p: [a, p] }, cv.width / SIZE);
  }
});
const penUp = (ev) => {
  if (!pen || ev.pointerId !== pen.id) return;
  const p = pointOf(ev);
  const a = pen.stroke.p[pen.stroke.p.length - 1];
  if (p[0] !== a[0] || p[1] !== a[1]) { pen.stroke.p.push(p); paintStroke(cx, { ...pen.stroke, p: [a, p] }, cv.width / SIZE); }
  endPen();
};
cv.addEventListener('pointerup', penUp);
cv.addEventListener('pointercancel', penUp);
cv.addEventListener('contextmenu', (e) => e.preventDefault());

// ====================== Zustandswechsel ======================
let lastSig = '';
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.gid}|${g.ri}|${g.t0}|${g.phase === 'setup'}`;
    if (sig !== S.ui.sig) {
      Object.assign(S.ui, { sig, t0: Date.now(), peek: false, pick: false, L: { strokes: JSON.parse(JSON.stringify(g.strokes || [])) } });
    }
    if (S.role === 'host') {
      arm(g);
      if (g.mode !== 'learn' && Array.isArray(g.used) && g.used.length) sess.set('zr_used', g.used.slice(-300));
    }
  }
  // Nur neue Strichpunkte: die Seite nicht neu aufbauen, nur die Fläche neu malen
  const rest = g ? { ...g, strokes: 0 } : null;
  const sig = JSON.stringify([S.screen, S.link, S.lobby, S.learn, rest, S.ui.helpOpen]);
  if (g && sig === lastSig && cv.isConnected) { scheduleRedraw(); return; }
  lastSig = sig;
  render();
}

// Gastgeber: Hinweise, Rundenende (Zeit) und Lern-Computer. Die Regeln selbst stehen in engine.js.
function arm(g) {
  if (g.phase !== 'draw') { clearTimers(); return; }
  const key = `${g.gid}|${g.ri}|${g.t0}`;
  if (g.limit > 0 && timers.key !== key) {
    timers.game.forEach(clearTimeout); timers.game = [];
    timers.key = key;
    const el = Date.now() - g.t0;
    const at = (ms, t) => timers.game.push(setTimeout(() => {
      const cur = S.game;
      if (cur && cur.gid === g.gid && cur.ri === g.ri && cur.t0 === g.t0 && cur.phase === 'draw') sess.send({ t });
    }, Math.max(0, ms - el)));
    at(g.limit * Q.HINT_AT[0], 'hint');
    at(g.limit * Q.HINT_AT[1], 'hint');
    at(g.limit, 'timeup');
  }
  if (g.mode === 'learn') armLearn(g);
}
function armLearn(g) {
  const bot = g.players.find((p) => Q.isBotId(p.id));
  if (!bot) return;
  const done = g.chat.filter((e) => e.by === bot.id).length;
  if (done >= LERN_RATEN.length) return;
  const key = `${g.gid}|${g.ri}|${done}`;
  if (timers.learnKey === key) return;
  timers.learnKey = key;
  clearTimeout(timers.learn);
  const fire = () => {
    const cur = S.game;
    if (!cur || cur.gid !== g.gid || cur.phase !== 'draw' || S.room !== 'SOLO') return;
    if (done === 0 && !(cur.sk > 0)) { timers.learn = setTimeout(fire, LERN_DELAY[0]); return; } // erst raten, wenn etwas gezeichnet ist
    sess.send({ t: 'as', id: bot.id, msg: { t: 'guess', text: LERN_RATEN[done] } });
  };
  timers.learn = setTimeout(fire, LERN_DELAY[done]);
}

// ====================== Hilfen ======================
const nm = (g, id) => esc(Q.nameOf(g, id));
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const upper = (w) => w.toLocaleUpperCase('de-DE');
const CAT = { Tiere: 'Tiere', Essen: 'Essen', Haushalt: 'Haushalt', Natur: 'Natur', Fahrzeuge: 'Fahrzeuge', Berufe: 'Berufe', Kleidung: 'Kleidung', Freizeit: 'Freizeit' };

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.phase === 'over') return '<div class="banner done">Das Spiel ist zu Ende</div>';
  if (g.phase === 'setup') return '<div class="banner">Wer spielt mit?</div>';
  const did = Q.drawerId(g);
  const runde = `Runde ${g.ri + 1} von ${g.len}`;
  if (g.phase === 'ready') return `<div class="banner mine">Als Nächstes zeichnet ${nm(g, did)}</div>`;
  if (g.phase === 'result') return `<div class="banner done">Auflösung – ${runde}</div>`;
  if (g.mode === 'local') return `<div class="banner mine">${nm(g, did)} zeichnet – die anderen raten laut</div>`;
  if (did === cid) return `<div class="banner mine">Du zeichnest – ${runde}</div>`;
  if (g.order.includes(cid)) return '<div class="banner done">Du hast es erraten!</div>';
  return `<div class="banner">${nm(g, did)} zeichnet – rate mit!</div>`;
}

function wordBar(g) {
  let line; let sub = '';
  const n = Q.letterCount(g.word.w);
  const cat = CAT[g.word.k] || g.word.k;
  if (g.phase === 'result') {
    const got = g.order.length; const all = Q.guessers(g).length;
    line = `Das Wort war: <b class="zr-secret">${esc(upper(g.word.w))}</b>. Erraten: ${got} von ${all}.`;
  } else if (g.mode === 'local' ? S.ui.peek : isDrawer(g)) {
    line = `Dein Begriff: <b class="zr-secret">${esc(upper(g.word.w))}</b>`;
    sub = `${plural(n, 'Buchstabe', 'Buchstaben')}${cat ? ' · ' + esc(cat) : ''}`;
  } else {
    line = g.mode === 'local' ? `Geheim: ${plural(n, 'Buchstabe', 'Buchstaben')}` : `Gesucht: ${plural(n, 'Buchstabe', 'Buchstaben')}`;
    sub = `<span class="zr-mask" role="img" aria-label="${plural(n, 'Buchstabe', 'Buchstaben')}${Q.shownLetters(g) ? ', schon verraten: ' + esc(Q.maskText(g).replace(/[ _]/g, '')) : ''}">${esc(Q.maskText(g))}</span>`;
  }
  return `<div class="zr-word action"><p class="big zr-line">${line}</p><div class="zr-sub">${sub}</div></div>`;
}

function timeBar(g) {
  if (g.phase !== 'draw') return '<div class="zr-timewrap" aria-hidden="true"></div>';
  if (g.limit <= 0) return '<div class="zr-timewrap"><span class="zr-nolimit">Ohne Zeitdruck</span></div>';
  const base = S.role === 'host' && g.t0 ? g.t0 : S.ui.t0;
  const el = Math.min(g.limit / 1000, Math.max(0, (Date.now() - base) / 1000)).toFixed(2);
  return `<div class="zr-timewrap"><div class="zr-timer" role="img" aria-label="Zeitbalken, ${Math.round(g.limit / 1000)} Sekunden"><i style="animation-duration:${g.limit / 1000}s;animation-delay:-${el}s"></i></div></div>`;
}

const swatch = (i) => `<button class="zr-sw" data-act="color" data-i="${i}" aria-label="${Q.COLOR_NAMES[i]}" aria-pressed="${S.ui.tool.c === i}" style="--sw:${Q.COLORS[i]}"></button>`;
function toolsHtml(g) {
  const t = S.ui.tool;
  const brush = ['Klein', 'Mittel', 'Groß'].map((l, i) => `<button class="zr-br" data-act="brush" data-i="${i}" aria-pressed="${t.w === i}" aria-label="Pinsel ${l}"><i style="--d:${[6, 12, 20][i]}px"></i><span>${l}</span></button>`).join('');
  return `<section class="zr-tools" aria-label="Werkzeuge">
    <div class="zr-colors">${Q.COLORS.map((_, i) => swatch(i)).join('')}<button class="zr-sw er" data-act="tool-e" aria-label="Radierer" aria-pressed="${t.c === Q.ERASER}">🧽</button></div>
    <div class="zr-brush">${brush}</div>
    <div class="zr-ops"><button class="zr-op" data-act="undo">↶ Rückgängig</button><button class="zr-op" data-act="clear">🗑 Alles löschen</button></div>
  </section>`;
}

function localBar(g) {
  const open = S.ui.pick;
  const list = open ? `<div class="zr-pick">${Q.guessers(g).filter((p) => !g.order.includes(p.id)).map((p) => `<button class="zr-b" data-act="got" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('') || '<p class="muted">Alle haben es schon erraten.</p>'}</div>` : '';
  return `<section class="zr-local"><div class="zr-grid">
      <button class="zr-b" data-act="peek">${S.ui.peek ? '🙈 Begriff verdecken' : '👁 Begriff zeigen'}</button>
      <button class="zr-b ok" data-act="pick">${open ? 'Abbrechen' : '✔ Jemand hat es erraten'}</button></div>${list}</section>`;
}

function chatHtml(g) {
  const rows = g.chat.map((e) => (e.k === 'ok'
    ? `<li class="ok"><b>${nm(g, e.by)}</b> hat es erraten! ✔</li>`
    : `<li><b>${nm(g, e.by)} rät:</b> ${esc(e.text)}</li>`));
  const body = rows.length ? rows.join('') : `<li class="empty">${g.mode === 'local' ? 'Hier erscheinen die Treffer.' : 'Hier erscheinen die Rateversuche.'}</li>`;
  return `<section class="card zr-chatcard"><ol class="zr-chat" role="log" aria-label="Rateversuche" tabindex="0">${body}</ol></section>`;
}

function scoreCard(g) {
  const did = Q.drawerId(g);
  const rk = Q.ranking(g);
  return `<section class="card zr-score"><ul aria-label="Punkte">${rk.map((r) => `<li class="${r.id === cid ? 'me' : ''}">${r.id === did && g.phase !== 'over' ? '✏️ ' : ''}${esc(r.name)}${r.id === cid ? ' (du)' : ''}: <b>${r.score}</b>${g.order.includes(r.id) && g.phase === 'draw' ? ' ✔' : ''}</li>`).join('')}</ul></section>`;
}

function inputHtml(g) {
  const done = g.order.includes(cid);
  return `<section class="zr-input" aria-label="Raten">
    <div class="zr-row"><input id="zr-in" class="zr-in" type="text" maxlength="${Q.MAX_GUESS}" autocomplete="off" autocapitalize="sentences" enterkeyhint="send" placeholder="${done ? 'Richtig erraten!' : 'Dein Wort …'}" aria-label="Dein Rateversuch" value="${esc(done ? '' : S.ui.draft)}"${done ? ' disabled' : ''}>
      <button class="zr-send" data-act="guess"${done ? ' disabled' : ''}>Raten</button></div></section>`;
}

function resultCard(g) {
  const did = Q.drawerId(g);
  const rows = Q.guessers(g).map((p) => {
    const gain = g.gains[p.id];
    return `<li class="${gain ? 'ok' : ''}${p.id === cid ? ' me' : ''}"><span class="zr-mk" aria-hidden="true">${gain ? '✔' : '✘'}</span><span class="zr-who"><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b><small>${gain ? 'hat es erraten' : 'nicht erraten'}</small></span><span class="zr-pts">${gain ? '+' + gain : '+0'}</span></li>`;
  }).join('');
  const drow = `<li class="draw${did === cid ? ' me' : ''}"><span class="zr-mk" aria-hidden="true">✏️</span><span class="zr-who"><b>${nm(g, did)}${did === cid ? ' (du)' : ''}</b><small>als Zeichner</small></span><span class="zr-pts">+${g.dgain}</span></li>`;
  const why = g.reason === 'time' ? 'Die Zeit ist um.' : g.reason === 'skip' ? 'Die Runde wurde beendet.' : 'Alle haben es erraten!';
  let next;
  if (S.role === 'host') next = `<button class="btn primary huge" data-act="next">${g.ri + 1 >= g.len ? 'Zum Ergebnis' : 'Weiter'}</button>`;
  else next = '<p class="muted center">Es geht gleich weiter, sobald der Gastgeber auf Weiter tippt.</p>';
  return `<section class="card zr-res"><h2>${why} Punkte dieser Runde</h2><ul class="zr-list">${rows}${drow}</ul>${next}</section>${scoreCard(g)}`;
}

function setupCard(g) {
  const rows = g.players.map((p, i) => `<li><span>${esc(p.name)}${p.id === cid ? ' (du, hältst das Gerät)' : ''}</span>${i > 0 ? `<button class="zr-b" data-act="dellocal" data-id="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">Entfernen</button>` : ''}</li>`).join('');
  return `<section class="card zr-setup"><h2>Wer spielt mit?</h2>
    <p class="muted">Alle sitzen an einem Gerät. Der Reihe nach bekommt jede Person das Gerät, sieht den geheimen Begriff und zeichnet ihn. Die anderen raten laut. Gib die Namen der anderen ein (insgesamt 2 bis 8 Personen).</p>
    <ul class="zr-names">${rows}</ul>
    <div class="zr-row"><input id="zr-name" class="zr-in" type="text" maxlength="${Q.MAX_NAME}" autocomplete="off" placeholder="Name der nächsten Person" aria-label="Name der nächsten Person" value="${esc(S.ui.nameDraft)}">
      <button class="zr-send" data-act="addlocal"${g.players.length >= Q.MAX_PLAYERS ? ' disabled' : ''}>Dazu</button></div>
    <button class="btn primary huge" data-act="startlocal"${g.players.length < 2 ? ' disabled' : ''}>▶ Los geht’s</button></section>`;
}

function readyCard(g) {
  const did = Q.drawerId(g);
  return `<section class="card action zr-ready"><p class="big">${nm(g, did)} ist dran mit Zeichnen. Bitte gib ${nm(g, did)} das Gerät. Die anderen schauen weg, bis der Begriff wieder verdeckt ist.</p>
    <button class="btn primary huge" data-act="go">Los, ich bin bereit</button></section>${scoreCard(g)}`;
}

function overCard(g) {
  const rk = Q.ranking(g);
  const win = Q.winners(g);
  const iWon = win.some((w) => w.id === cid);
  let title; let trophy = iWon ? '🏆' : '🖍️'; let extra = '';
  if (g.mode === 'learn') {
    title = 'Geschafft! Du hast die Lernrunde gemeistert.';
    trophy = '🏆';
  } else {
    const names = win.slice().sort((a, b) => (b.id === cid) - (a.id === cid)).map((w) => (w.id === cid ? 'Du' : esc(w.name)));
    if (win.length === 1) title = `${names[0]} ${names[0] === 'Du' ? 'hast' : 'hat'} gewonnen! 🏆`;
    else title = `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} ${names[0] === 'Du' ? 'habt' : 'haben'} gewonnen! 🏆`;
    if (win.length > 1) extra = '<p class="center big">Gleichstand – ihr teilt euch den Sieg!</p>';
  }
  const medal = (r) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`);
  const lis = rk.map((r) => `<li class="${r.rank === 1 ? 'win' : ''}"><span class="medal">${medal(r)}</span><span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}<small>Erraten: ${r.right}</small></span><span class="rt">${r.score}</span></li>`).join('');
  const again = S.role === 'host'
    ? '<button class="btn primary huge" data-act="again">🖍️ Noch eine Runde</button>'
    : '<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>';
  return `<section class="card over zr-over"><div class="trophy">${trophy}</div><h1>${title}</h1>${extra}
    <ul class="ranking">${lis}</ul>${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
}

function gameHtml() {
  const g = S.game;
  const head = `${ui.header()}${ui.lost()}${bannerHtml(g)}`;
  let body;
  if (g.phase === 'over') body = overCard(g);
  else if (g.phase === 'setup') body = setupCard(g);
  else if (g.phase === 'ready') body = readyCard(g);
  else {
    const board = '<div id="board" class="zr-board" role="img" aria-label="Zeichenfläche"></div>';
    const top = `${wordBar(g)}${timeBar(g)}${board}`;
    if (g.phase === 'result') body = `${top}${resultCard(g)}`;
    else {
      const drawing = isDrawer(g);
      const skip = S.role === 'host' && g.mode !== 'learn' ? `<button class="btn ghost zr-skip" data-act="skip">${g.mode === 'local' ? 'Niemand hat es erraten – auflösen' : 'Runde jetzt beenden'}</button>` : '';
      if (g.mode === 'local') body = `${top}${localBar(g)}${toolsHtml(g)}${chatHtml(g)}${scoreCard(g)}${skip}`;
      else if (drawing) body = `${top}${toolsHtml(g)}${chatHtml(g)}${scoreCard(g)}${skip}`;
      else body = `${top}${chatHtml(g)}${scoreCard(g)}${skip}${inputHtml(g)}`;
    }
  }
  return `<div class="zr">${head}${body}</div>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Einer zeichnet, die anderen raten. Wer am Ende die meisten Punkte hat, gewinnt. Es spielen 2 bis 8 Personen.</p>
    <h3>So läuft eine Runde</h3>
    <p>Reihum bekommt eine Person einen geheimen Begriff. Nur auf ihrem Bildschirm steht er. Sie zeichnet ihn auf die weiße Fläche. Alle anderen sehen die Zeichnung sofort und schreiben ihre Rateversuche in das Feld unten. Dann tippen sie auf Raten oder auf die Eingabetaste. Falsche Versuche stehen für alle in der Liste. Richtige Antworten werden nicht verraten, dort steht nur: hat es erraten.</p>
    <h3>Zeichnen</h3>
    <ul>
      <li>Unter der Fläche wählst du eine von 6 Farben und die Dicke des Pinsels.</li>
      <li>Der Radierer malt weiß und nimmt Gemaltes weg.</li>
      <li>Rückgängig nimmt den letzten Strich weg, Alles löschen die ganze Zeichnung.</li>
      <li>Buchstaben und Zahlen schreiben gilt nicht.</li>
    </ul>
    <h3>Zeit und Hinweise</h3>
    <p>Eine Runde dauert 90 Sekunden, auf Wunsch 150 Sekunden oder ohne Zeitlimit. Oben läuft der Zeitbalken. Die Ratenden sehen von Anfang an, wie viele Buchstaben das Wort hat. Nach der Hälfte der Zeit wird der erste Buchstabe verraten, nach drei Vierteln der zweite.</p>
    <h3>Punkte</h3>
    <ul>
      <li>Wer richtig rät, bekommt 10 Punkte und noch etwas dazu: Je mehr Zeit übrig ist, desto mehr, im besten Fall 10 Punkte extra.</li>
      <li>Der Zeichner bekommt für jede Person, die richtig rät, 5 Punkte, insgesamt bis zu 20.</li>
      <li>Die Runde endet, wenn alle geraten haben oder die Zeit abgelaufen ist. Dann steht das gesuchte Wort da. Tippe auf Weiter.</li>
    </ul>
    <h3>Rateregeln</h3>
    <p>Groß und klein, Leerzeichen und Umlaute sind egal: Ä zählt wie AE, Ö wie OE, Ü wie UE, ß wie SS. Bei längeren Wörtern ist ein kleiner Tippfehler erlaubt. Manche Begriffe haben mehrere gültige Wörter, zum Beispiel Fahrrad und Rad.</p>
    <h3>Alle am selben Gerät</h3>
    <p>Setze vor dem Start das Häkchen bei Alle am selben Gerät und tippe auf Allein spielen. Trage die Namen aller ein. Das Gerät geht reihum. Wer zeichnet, tippt auf Begriff zeigen und verdeckt ihn danach wieder. Die anderen raten laut. Wenn jemand richtig rät, tippt der Zeichner auf Jemand hat es erraten und wählt den Namen.</p>
    <h3>Einstellungen</h3>
    <p>Vor dem Start kannst du die Zeit verlängern, das Zeitlimit abschalten oder festlegen, dass jede Person zweimal zeichnet.</p>
    <h3>Lernrunde</h3>
    <p>In der Lernrunde zeichnest du ein Haus. Der Computer rät. Dabei lernst du Farben, Pinsel, Radierer, Löschen, Raten und die Punkte kennen.</p>`;
}

// ====================== Bedienung ======================
function sendGuess() {
  const g = S.game;
  if (!g || g.phase !== 'draw' || g.mode === 'local' || isDrawer(g) || g.order.includes(cid)) return;
  const el = document.getElementById('zr-in');
  const text = (el ? el.value : S.ui.draft).trim();
  if (!text) return;
  S.ui.draft = '';
  S.ui.focusIn = true;
  sess.send({ t: 'guess', text });
  render();
}
function addLocal() {
  const el = document.getElementById('zr-name');
  const name = (el ? el.value : S.ui.nameDraft).trim();
  S.ui.nameDraft = '';
  S.ui.focusName = true;
  if (!name) return render();
  sess.send({ t: 'addlocal', name });
  render();
}

const ui = createUI({
  solo: true,
  soloText: 'Nur mit dem Häkchen „Alle am selben Gerät“ unten: Eine Gruppe im selben Raum spielt reihum an diesem einen Gerät. Allein macht Zeichenraten keinen Spaß, aber die Lernrunde zeigt dir alles.',
  sess, $app,
  title: 'Zeichenraten', icon: '🖍️', sub: 'Zeichnen und Raten für 2 bis 8 Personen',
  options: OPTIONS,
  helpTitle: 'Die Spielregeln von Zeichenraten', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 1, coach },
  onAct: (a, el) => {
    const g = S.game;
    if (!g) return;
    switch (a) {
      case 'color': S.ui.tool.c = Number(el.dataset.i); return render();
      case 'tool-e': S.ui.tool.c = Q.ERASER; return render();
      case 'brush': S.ui.tool.w = Number(el.dataset.i); return render();
      case 'undo':
        if (!canDraw(g)) return;
        S.ui.L.strokes.pop(); sendDraw({ t: 'undo' }); redraw(); return;
      case 'clear':
        if (!canDraw(g)) return;
        S.ui.L.strokes = []; sendDraw({ t: 'clear' }); redraw(); return;
      case 'guess': return sendGuess();
      case 'peek': S.ui.peek = !S.ui.peek; return render();
      case 'pick': S.ui.pick = !S.ui.pick; return render();
      case 'got': S.ui.pick = false; return sess.send({ t: 'got', id: el.dataset.id });
      case 'go': return sess.send({ t: 'go' });
      case 'skip': return sess.send({ t: 'skip' });
      case 'next': return sess.send({ t: 'next' });
      case 'addlocal': return addLocal();
      case 'dellocal': return sess.send({ t: 'dellocal', id: el.dataset.id });
      case 'startlocal': return sess.send({ t: 'startlocal' });
    }
  },
});

// Zeichnen, ohne dass Eingabe, Fokus, Chat-Stand und Zeichnung verloren gehen. Während ein Strich läuft, wird nicht neu aufgebaut.
function render() {
  if (S.ui.drawing) { S.ui.dirty = true; return; }
  const lg = $app.querySelector('.zr-chat');
  const stick = !lg || lg.scrollHeight - lg.scrollTop - lg.clientHeight < 40;
  const top = lg ? lg.scrollTop : 0;
  const inp = $app.querySelector('#zr-in');
  const focused = inp && document.activeElement === inp;
  const nameEl = $app.querySelector('#zr-name');
  const nameFocused = nameEl && document.activeElement === nameEl;
  const caret = focused ? inp.selectionStart : null;
  ui.render();
  mountCanvas();
  const lg2 = $app.querySelector('.zr-chat');
  if (lg2) lg2.scrollTop = stick ? lg2.scrollHeight : top;
  const in2 = $app.querySelector('#zr-in');
  if (in2 && !in2.disabled && (focused || S.ui.focusIn)) {
    in2.focus({ preventScroll: true });
    try { const c = caret === null ? in2.value.length : Math.min(caret, in2.value.length); in2.setSelectionRange(c, c); } catch { /* egal */ }
  }
  S.ui.focusIn = false;
  const nm2 = $app.querySelector('#zr-name');
  if (nm2 && (nameFocused || S.ui.focusName)) nm2.focus({ preventScroll: true });
  S.ui.focusName = false;
}
$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'zr-in') S.ui.draft = t.value;
  else if (t.id === 'zr-name') S.ui.nameDraft = t.value;
});
$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'zr-in') { ev.preventDefault(); sendGuess(); }
  else if (ev.target.id === 'zr-name') { ev.preventDefault(); addLocal(); }
});
ui.boot();
