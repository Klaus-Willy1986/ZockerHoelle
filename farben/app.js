import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';
import { chooseAction } from './ai.js';

const $app = document.getElementById('app');
const ZOOMS = [24, 30, 34, 42, 52, 64];
const freshPick = () => ({ ci: null, ni: null, jc: null, jn: null, ask: null, cells: [], pass: false });
const freshUi = () => ({ padExtra: 0, rolling: false, lastRollId: 0, sig: '', pick: freshPick(), pend: null, scroll: null, fit: false, zoom: Number(sess.get('fw_zoom', 0)) || null });

const sess = createSession({
  game: 'fw',
  maxPlayers: 6,
  newGame: (players) => { S.ui.lastRollId = 0; S.ui.sig = ''; S.ui.pick = freshPick(); return E.createGame(players); },
  onMessage: (state, pid, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'roll') E.roll(state, pid);
    else if (msg.t === 'pass') E.submit(state, pid, null);
    else if (msg.t === 'pick') {
      E.submit(state, pid, { ci: msg.ci, ni: msg.ni, color: msg.color, num: msg.num, cells: msg.cells });
    }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
  bot: {
    delay: 900,
    // Der erste Computer, der noch etwas tun muss (würfeln oder wählen), ist dran.
    step: (g, level) => {
      if (!g || g.mode !== 'play') return null;
      const isBot = (id) => String(id).startsWith('bot');
      const ids = g.phase === 'roll' ? [E.activePlayer(g).id] : E.waitingFor(g);
      const id = ids.find(isBot);
      if (!id) return null;
      const msg = chooseAction(g, id, level, Math.random);
      return msg ? { id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const meP = () => (S.game ? S.game.players[myIndex()] : null);
const amWaiting = () => !!S.game && !S.ui.rolling && E.waitingFor(S.game).includes(cid);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.rollId}|${g.phase}|${g.mode}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.pick = freshPick(); }
    if (!E.waitingFor(g).includes(cid)) S.ui.pick = freshPick();
    if (g.rollId !== S.ui.lastRollId) {
      const resumed = S.ui.lastRollId === 0 && g.rollId > 1;
      S.ui.lastRollId = g.rollId;
      if (!resumed && g.dice) { animateDice(); return; }
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
    const el = document.getElementById('fw-dice');
    if (el && S.game?.dice) el.innerHTML = diceHtml(S.game, { spin: true });
    if (n >= 8) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}

// ====================== Würfel ======================
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8] };
const pips = (v) => Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ''}></i>`).join('');
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

function dieHtml(kind, i, face, o) {
  const g = S.game;
  const gone = g.gone[kind][i];
  const pk = S.ui.pick;
  const selected = (kind === 'c' ? pk.ci : pk.ni) === i;
  const shown = o.spin && !gone ? (kind === 'c' ? rnd(E.COLOR_FACES) : rnd(E.NUM_FACES)) : face;
  let inner; let label; let tag = '';
  if (kind === 'c') {
    const isJ = shown === 'X';
    inner = isJ ? '<span class="fw-x">✖</span>' : `<span class="fw-dl">${shown}</span>`;
    label = isJ ? 'Joker-Farbwürfel (schwarzes Kreuz)' : `${E.COLOR_NAMES[shown]}er Farbwürfel`;
    tag = isJ ? (selected && pk.jc ? E.COLOR_NAMES[pk.jc] : 'Joker') : E.COLOR_NAMES[shown];
  } else {
    const isJ = shown === '?';
    inner = isJ ? '<span class="fw-q">?</span>' : `<span class="fw-pips">${pips(shown)}</span>`;
    label = isJ ? 'Joker-Zahlenwürfel (Fragezeichen)' : `Zahlenwürfel ${shown}`;
    tag = isJ ? (selected && pk.jn ? `die ${pk.jn}` : 'Joker') : `die ${shown}`;
  }
  const cls = `fw-die ${kind === 'c' ? 'fc-' + (shown === 'X' ? 'X' : shown) : 'fn'}${gone ? ' gone' : ''}${selected ? ' sel' : ''}${o.spin ? ' spin' : ''}`;
  if (gone) return `<div class="fw-dcol"><div class="${cls}" role="img" aria-label="${label}, schon genommen">${inner}</div><span class="fw-tag">weg</span></div>`;
  if (o.interactive) {
    const other = kind === 'c' ? pk.ni : pk.ci;
    const otherJ = other == null ? 0 : (kind === 'c' ? (g.dice.n[other] === '?' ? 1 : 0) : (g.dice.c[other] === 'X' ? 1 : 0));
    const cost = ((shown === 'X' || shown === '?') ? 1 : 0) + otherJ;
    const nope = cost > meP().jokers;
    // Zahlenwürfel, die mit der gewählten Farbe nirgends passen
    let blocked = false;
    if (kind === 'n' && shown !== '?' && pk.ci != null) {
      const col = pk.jc || g.dice.c[pk.ci];
      if (col !== 'X') blocked = E.maxRun(meP().x, col) < shown;
    }
    return `<div class="fw-dcol"><button class="${cls}${nope ? ' off' : ''}" data-act="die" data-kind="${kind}" data-i="${i}" ${nope ? 'disabled' : ''} aria-pressed="${selected}" aria-label="${label}${selected ? ', gewählt' : ''}${nope ? ', keine Ausrufezeichen mehr' : ''}">${inner}</button>
      <span class="fw-tag${selected ? ' on' : ''}">${selected ? '✔ ' : ''}${nope ? 'kein Joker mehr' : (blocked ? 'passt nicht' : tag)}</span></div>`;
  }
  return `<div class="fw-dcol"><div class="${cls}" role="img" aria-label="${label}">${inner}</div><span class="fw-tag">${tag}</span></div>`;
}

// Kleine Würfelleiste, die beim Scrollen zum Zettel sichtbar bleibt
function miniDice(g) {
  if (!g.dice) return '';
  const pk = S.ui.pick;
  const c = g.dice.c.map((f, i) => {
    const gone = g.gone.c[i]; const sel = pk.ci === i;
    const lab = f === 'X' ? 'Joker-Farbwürfel' : `${E.COLOR_NAMES[f]}er Farbwürfel`;
    return `<span class="fw-mini fw-mc ${f === 'X' ? 'fc-X' : 'fc-' + f}${gone ? ' gone' : ''}${sel ? ' sel' : ''}" role="img" aria-label="${lab}${gone ? ', weg' : ''}">${f === 'X' ? '✖' : f}</span>`;
  }).join('');
  const n = g.dice.n.map((f, i) => {
    const gone = g.gone.n[i]; const sel = pk.ni === i;
    return `<span class="fw-mini fw-mn${gone ? ' gone' : ''}${sel ? ' sel' : ''}" role="img" aria-label="${f === '?' ? 'Joker-Zahlenwürfel' : 'Zahlenwürfel ' + f}${gone ? ', weg' : ''}">${f}</span>`;
  }).join('');
  let hint = '';
  if (pk.ci != null && pk.ni != null && !pk.pass && !pk.ask) {
    const color = colorOfPick(); const num = numOfPick();
    if (color && num) hint = `<span class="fw-minihint">${num} × ${E.COLOR_NAMES[color]} ${pk.cells.length}/${num}</span>`;
  }
  return `<div class="fw-sticky" aria-label="Deine gewürfelten Würfel"><span class="fw-sticky-t">Würfel:</span>${c}<span class="fw-sep"></span>${n}${hint}</div>`;
}

function diceHtml(g, o = {}) {
  if (!g.dice) return '';
  const row = (kind, title) => `<div class="fw-drow"><div class="fw-dtitle">${title}</div><div class="fw-dline">${g.dice[kind].map((f, i) => dieHtml(kind, i, f, o)).join('')}</div></div>`;
  return `${row('c', 'Farbwürfel')}${row('n', 'Zahlenwürfel')}`;
}

// ====================== Auswahl ======================
const colorOfPick = () => {
  const g = S.game; const pk = S.ui.pick;
  if (pk.ci == null) return null;
  const f = g.dice.c[pk.ci];
  return f === 'X' ? pk.jc : f;
};
const numOfPick = () => {
  const g = S.game; const pk = S.ui.pick;
  if (pk.ni == null) return null;
  const f = g.dice.n[pk.ni];
  return f === '?' ? pk.jn : f;
};
const costOfPick = () => {
  const g = S.game; const pk = S.ui.pick;
  return (pk.ci != null && g.dice.c[pk.ci] === 'X' ? 1 : 0) + (pk.ni != null && g.dice.n[pk.ni] === '?' ? 1 : 0);
};
let gMemo = { key: '', groups: [] };
function groupsNow() {
  const color = colorOfPick(); const num = numOfPick();
  if (!color || !num) return null;
  const me = meP();
  const key = `${color}${num}|${me.x.join('')}`;
  if (gMemo.key !== key) gMemo = { key, groups: E.legalGroups(me.x, color, num) };
  return gMemo.groups;
}
function candidateSets() {
  const groups = groupsNow();
  if (!groups) return { opt: new Set(), any: false };
  const sel = S.ui.pick.cells;
  const opt = new Set();
  for (const gr of groups) if (sel.every((i) => gr.includes(i))) for (const i of gr) if (!sel.includes(i)) opt.add(i);
  return { opt, any: groups.length > 0 };
}
const joinNames = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} und ${a[a.length - 1]}`);

// ====================== Blatt ======================
function colPoints(p, c) {
  const g = S.game;
  const mine = p.colPts[c];
  const top = E.COL_TOP[c]; const low = E.COL_LOW[c];
  const topCls = mine === top ? 'got' : (g.colTaken[c] ? 'lost' : '');
  const lowCls = mine !== null && mine !== top ? 'got' : '';
  return { top, low, topCls, lowCls };
}

function sheetHtml(p, o = {}) {
  const g = S.game;
  const opt = o.opt || new Set();
  const sel = new Set(o.sel || []);
  const last = new Set(p.last || []);
  let style = '';
  let cls = 'fw-grid';
  if (opt.size || sel.size) cls += ' picking';
  if (o.small) cls += ' small';
  else if (S.ui.fit) cls += ' fit';
  else if (S.ui.zoom) style = ` style="--cs:${S.ui.zoom}px"`;
  const cells = [];
  for (let c = 0; c < E.COLS; c++) {
    const done = E.colComplete(p.x, c);
    cells.push(`<div class="fw-lh${c === E.START_COL ? ' start' : ''}${done ? ' done' : ''}" aria-label="Spalte ${E.LETTERS[c]}${c === E.START_COL ? ', Startspalte' : ''}">${E.LETTERS[c]}</div>`);
  }
  for (let r = 0; r < E.ROWS; r++) {
    for (let c = 0; c < E.COLS; c++) {
      const i = E.idx(r, c);
      const col = E.CELL_COLOR[i];
      const star = E.IS_STAR[i];
      const x = p.x[i];
      const isSel = sel.has(i);
      const isOpt = opt.has(i);
      const k = `fw-cell fc-${col}${star ? ' star' : ''}${x ? ' x' : ''}${c === E.START_COL ? ' hcol' : ''}${last.has(i) ? ' new' : ''}${isSel ? ' sel' : ''}${isOpt ? ' opt' : ''}`;
      const inner = `${star ? '<b class="fw-st">★</b>' : ''}<span class="fw-cl">${col}</span>${x ? '<b class="fw-mk">✕</b>' : ''}${isSel ? '<b class="fw-mk">✕</b>' : ''}`;
      const name = `Zeile ${r + 1}, Spalte ${E.LETTERS[c]}, ${E.COLOR_NAMES[col]}${star ? ', Sternfeld' : ''}${x ? ', angekreuzt' : ''}${isSel ? ', ausgewählt' : ''}`;
      cells.push(isSel || isOpt
        ? `<button class="${k}" data-act="cell" data-i="${i}" aria-label="${name}${isSel ? ' – antippen zum Abwählen' : ' – antippen zum Ankreuzen'}">${inner}</button>`
        : `<div class="${k}" role="img" aria-label="${name}">${inner}</div>`);
    }
  }
  for (const which of ['top', 'low']) {
    for (let c = 0; c < E.COLS; c++) {
      const cp = colPoints(p, c);
      const v = which === 'top' ? cp.top : cp.low;
      const k = which === 'top' ? cp.topCls : cp.lowCls;
      cells.push(`<div class="fw-pt ${which} ${k}" aria-label="Spalte ${E.LETTERS[c]}, ${which === 'top' ? 'erste Person' : 'spätere Personen'}: ${v} Punkte${k === 'lost' ? ', nicht mehr zu haben' : ''}${k === 'got' ? ', erreicht' : ''}">${v}</div>`);
    }
  }
  const body = `<div class="${cls}"${style}>${cells.join('')}</div>`;
  if (o.small) return `<div class="fw-wrap"><div class="fw-scroll small">${body}</div></div>`;
  return `<div class="fw-wrap"><div class="fw-scroll" id="fw-scroll" tabindex="0" aria-label="Dein Spielblatt (seitlich verschiebbar)">${body}</div></div>`;
}

function jokerHtml(p) {
  const marks = Array.from({ length: E.START_JOKERS }, (_, i) => (i < p.jokers ? '<span class="fw-jk on" aria-hidden="true">!</span>' : '<span class="fw-jk off" aria-hidden="true">!</span>')).join('');
  return `<div class="fw-jokers" role="img" aria-label="Ausrufezeichen: ${p.jokers} von ${E.START_JOKERS} übrig"><span class="fw-jlabel">Joker-Zeichen:</span>${marks}<b class="fw-jcount">${p.jokers} von ${E.START_JOKERS}</b></div>`;
}

function colorBars(p) {
  return `<div class="fw-colors">${E.COLORS.map((c) => {
    const n = E.colorProgress(p, c);
    const pts = p.colorPts[c];
    return `<span class="fw-cchip fc-${c}${pts !== null ? ' done' : ''}"><b>${c}</b> ${E.COLOR_NAMES[c]} ${n}/21${pts !== null ? ` ✔ +${pts}` : ''}</span>`;
  }).join('')}</div>`;
}

function scoreChips(p) {
  const s = E.scoreOf(p);
  const miss = E.missingStars(p);
  return `<div class="fw-score"><span class="chip">Spalten ${s.cols}</span><span class="chip">Farben ${s.colors}</span><span class="chip">Joker +${s.jokers}</span><span class="chip">Sterne −${-s.stars} (${miss} offen)</span><span class="chip fw-total">Punkte aktuell: ${s.total}</span></div>`;
}

// ====================== Banner & Aktion ======================
const nameOf = (id) => esc(S.game.players.find((p) => p.id === id).name);

function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = E.activePlayer(g);
  const w = E.waitingFor(g);
  if (g.phase === 'roll') return ap.id === cid ? `<div class="banner mine">Du bist dran – würfle</div>` : `<div class="banner">${esc(ap.name)} würfelt gleich</div>`;
  if (S.ui.rolling) return `<div class="banner">Die Würfel rollen …</div>`;
  if (w.includes(cid)) {
    if (g.phase === 'all' && !g.solo) return `<div class="banner mine">Alle wählen gleichzeitig – wähle deine Würfel</div>`;
    return `<div class="banner mine">Du bist dran – wähle deine Würfel</div>`;
  }
  return `<div class="banner">Warte auf ${joinNames(w.map(nameOf))}</div>`;
}

function whoChips() {
  const g = S.game;
  if (g.players.length < 2 || g.phase === 'roll' || g.mode === 'over') return '';
  const who = g.phase === 'all' ? g.players : g.phase === 'active' ? [E.activePlayer(g)] : g.players.filter((p) => p.id !== E.activePlayer(g).id);
  return `<p class="fw-who">${who.map((p) => `<span class="fw-wc${p.id in g.picks ? ' ok' : ''}">${p.id in g.picks ? '✔' : '…'} ${esc(p.name)}</span>`).join('')}</p>`;
}

function phaseText() {
  const g = S.game;
  const ap = E.activePlayer(g);
  if (g.solo) return `Wähle aus den 4 Würfeln einen Farb- und einen Zahlenwürfel.`;
  if (g.phase === 'all') return g.throwNo <= E.FREE_THROWS
    ? `In den ersten ${E.FREE_THROWS} Würfen darf jede Person aus allen 6 Würfeln wählen (Wurf ${g.throwNo} von ${E.FREE_THROWS}).`
    : 'Alle dürfen aus allen Würfeln wählen.';
  if (g.phase === 'active') return ap.id === cid ? 'Du wählst zuerst. Die beiden Würfel, die du nimmst, bekommen die anderen nicht.' : `${esc(ap.name)} wählt zuerst.`;
  const passed = !g.picks[ap.id];
  return passed
    ? `${esc(ap.name)} hat nichts genommen. Alle anderen dürfen aus allen 6 Würfeln wählen.`
    : `${ap.id === cid ? 'Du hast' : esc(ap.name) + ' hat'} 2 Würfel genommen. Alle anderen wählen jetzt gleichzeitig aus den 4 übrigen Würfeln.`;
}

function jokerAskHtml() {
  const g = S.game; const pk = S.ui.pick; const me = meP();
  const ask = pk.ask;
  const jk = `<p class="big">Mit diesem Joker darfst du ${ask.kind === 'c' ? 'die Farbe' : 'die Zahl'} selbst bestimmen. Das kostet <b>1 Ausrufezeichen</b> (du hast noch ${me.jokers}).</p>`;
  let opts;
  if (ask.kind === 'c') {
    const n = numOfPick();
    opts = E.COLORS.map((c) => {
      const run = E.maxRun(me.x, c);
      const ok = n ? run >= n : run >= 1;
      return `<button class="btn fw-opt fc-${c}" data-act="joker-pick" data-v="${c}" ${ok ? '' : 'disabled'}><b>${c}</b> ${E.COLOR_NAMES[c]}</button>`;
    }).join('');
  } else {
    const c = colorOfPick();
    const best = c ? E.maxRun(me.x, c) : Math.max(...E.COLORS.map((x) => E.maxRun(me.x, x)));
    opts = [1, 2, 3, 4, 5].map((n) => `<button class="btn fw-opt fn" data-act="joker-pick" data-v="${n}" ${n <= best ? '' : 'disabled'}>${n}</button>`).join('');
  }
  return `<div class="confirm fw-ask">${jk}<div class="fw-opts">${opts}</div><button class="btn ghost" data-act="joker-cancel">Abbrechen</button></div>`;
}

function actionHtml() {
  const g = S.game;
  const ap = E.activePlayer(g);
  const w = E.waitingFor(g);
  if (S.ui.rolling) return `<p class="big center">🎲 Die Würfel rollen …</p>`;
  if (g.mode === 'over') return '';
  if (g.phase === 'roll') {
    if (ap.id === cid) {
      const t = g.solo ? `Wurf ${g.throwNo + 1} von ${E.SOLO_THROWS}` : `Wurf ${g.throwNo + 1}`;
      return `<button class="btn primary huge" data-act="roll">🎲 Würfeln (${t})</button>`;
    }
    return `<p class="big center">Gleich würfelt <b>${esc(ap.name)}</b>. Bitte einen Moment Geduld.</p>`;
  }
  const head = `<p class="fw-phase">${phaseText()}</p>${whoChips()}`;
  if (!w.includes(cid)) {
    const msg = g.auto[cid] ? 'Du kannst diesmal leider nichts ankreuzen.' : (cid in g.picks ? (g.picks[cid] ? 'Danke, dein Kreuz ist eingetragen.' : 'Du hast nichts angekreuzt.') : 'Du schaust zu.');
    return `${head}<p class="big center">${msg}</p><p class="center muted">Wir warten noch auf: <b>${joinNames(w.map(nameOf))}</b></p>`;
  }
  const pk = S.ui.pick;
  if (pk.pass) {
    return `${head}<div class="confirm"><p class="big">Wirklich nichts ankreuzen?</p>
      <button class="btn secondary huge" data-act="pass-yes">Ja, nichts ankreuzen</button>
      <button class="btn ghost" data-act="pass-no">Zurück</button></div>`;
  }
  if (pk.ask) return `${head}${jokerAskHtml()}`;
  let step;
  if (pk.ci == null && pk.ni == null) step = 'Tippe auf einen <b>Farbwürfel</b> und auf einen <b>Zahlenwürfel</b>.';
  else if (pk.ci == null) step = 'Jetzt noch einen <b>Farbwürfel</b> antippen.';
  else if (pk.ni == null) step = 'Jetzt noch einen <b>Zahlenwürfel</b> antippen.';
  else step = '';
  let info = '';
  if (step) info = `<p class="big">${step}</p>`;
  else if (groupsNow().length === 0) {
    info = `<div class="confirm bad"><p class="big"><b>Mit dieser Kombination kannst du nichts ankreuzen.</b></p><p>Wähle andere Würfel oder tippe auf „Nichts ankreuzen“.</p><button class="btn secondary" data-act="reset-dice">Andere Würfel wählen</button></div>`;
  }
  return `${head}${info}<button class="btn secondary" data-act="pass">Nichts ankreuzen</button>`;
}

// ====================== Mein Blatt ======================
function mySheetCard() {
  const g = S.game;
  const me = meP();
  if (!me) return '';
  const pk = S.ui.pick;
  const waiting = amWaiting();
  let task = ''; let confirm = ''; let opt = new Set();
  if (waiting && pk.ci != null && pk.ni != null && !pk.ask && !pk.pass) {
    const color = colorOfPick(); const num = numOfPick();
    const cand = candidateSets();
    opt = cand.opt;
    if (cand.any) {
      const left = num - pk.cells.length;
      const cost = costOfPick();
      const what = `${num} ${num === 1 ? E.COLOR_ONE[color] + ' Feld' : E.COLOR_MANY[color] + ' Felder'}`;
      const valid = left === 0;
      task = `<div class="fw-task"><p class="big">Du kreuzt <b class="pill fc-${color}">${what}</b> an${cost ? ` <span class="fw-cost">(Joker: kostet ${cost} Ausrufezeichen)</span>` : ''}.</p>
        <p class="big">${valid ? 'Das passt.' : `Tippe jetzt ${left === num ? '' : 'noch '}<b>${left}</b> ${left === 1 ? 'markiertes Feld' : 'markierte Felder'} auf dem Blatt an.`}</p>
        <p class="muted small">Die leuchtenden Felder sind erlaubt.</p></div>`;
      if (valid) {
        confirm = `<div class="confirm fw-confirm"><p class="big">${num} ${num === 1 ? 'Feld' : 'Felder'} ankreuzen${cost ? ` (und ${cost} ${cost === 1 ? 'Ausrufezeichen' : 'Ausrufezeichen'} streichen)` : ''}?</p>
          <button class="btn primary huge" data-act="confirm">✔ Ja, so ankreuzen</button>
          <button class="btn ghost" data-act="clear-cells">Zurück</button></div>`;
      }
      task += `<div class="fw-taskbtns"><button class="btn secondary" data-act="reset-dice">Andere Würfel wählen</button>${pk.cells.length && !valid ? '<button class="btn ghost" data-act="clear-cells">Felder neu wählen</button>' : ''}</div>`;
    }
  }
  const strikes = g.solo ? soloStrikes() : '';
  return `<section class="card" id="fw-mine">${miniDice(g)}<h2>Dein Spielblatt</h2>
    <div class="fw-tools"><button class="btn secondary" data-act="zoom-out" aria-label="Blatt kleiner">🔍− Blatt kleiner</button>
    <button class="btn secondary" data-act="zoom-in" aria-label="Blatt größer">🔍+ Blatt größer</button>
    <button class="btn secondary" data-act="zoom-fit" aria-label="Ganzes Blatt zeigen">▣ Ganzes Blatt</button></div>
    ${sheetHtml(me, { opt, sel: waiting ? pk.cells : [] })}${task}${confirm}
    <p class="muted small">Startspalte ist <b>H</b>. Obere Zahl unter einer Spalte: Punkte für die erste Person, die sie füllt. Untere Zahl: Punkte für alle, die später fertig werden. ★ = Sternfeld (−2 Punkte, wenn am Ende nicht angekreuzt).</p>
    ${colorBars(me)}${jokerHtml(me)}${scoreChips(me)}${strikes}</section>`;
}

function soloStrikes() {
  const g = S.game;
  const boxes = E.LETTERS.map((l, i) => {
    const n = (g.throwNo > i ? 1 : 0) + (g.throwNo > 15 + i ? 1 : 0);
    return `<span class="fw-sb${n === 2 ? ' two' : ''}" aria-hidden="true">${l}<i>${n === 0 ? '' : n === 1 ? '/' : '✕'}</i></span>`;
  }).join('');
  return `<div class="fw-strikes" role="img" aria-label="${g.throwNo} von ${E.SOLO_THROWS} Würfen gespielt"><p class="muted small">Würfe: ${g.throwNo} von ${E.SOLO_THROWS}</p><div class="fw-sbs">${boxes}</div></div>`;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length || S.ui.rolling) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function othersHtml() {
  const g = S.game;
  const list = g.players.filter((p) => p.id !== cid);
  if (!list.length) return '';
  return `<section class="card"><h2>Zettel der Mitspieler</h2>${list.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    return `<details class="other"><summary><b>${esc(p.name)}</b>${off} – ${E.scoreOf(p).total} Punkte, ${E.colsDone(p).length} Spalten, ${E.colorsDone(p).length} Farben, ${p.jokers} Joker${p.id === E.activePlayer(g).id && g.mode === 'play' ? ' 🎲' : ''}</summary>
      ${sheetHtml(p, { small: true })}${colorBars(p)}${jokerHtml(p)}${scoreChips(p)}</details>`;
  }).join('')}</section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml();
  const showDice = !!g.dice;
  const waiting = amWaiting();
  const dice = showDice
    ? `<div id="fw-dice" class="fw-dice${g.phase === 'roll' ? ' dim' : ''}">${diceHtml(g, { interactive: waiting && !S.ui.pick.pass && !S.ui.pick.ask })}</div>`
    : '';
  const head = showDice ? `<p class="fw-rollno">${g.phase === 'roll' ? `Letzter Wurf (Nr. ${g.throwNo}${g.solo ? ' von ' + E.SOLO_THROWS : ''})` : `Wurf ${g.throwNo}${g.solo ? ' von ' + E.SOLO_THROWS : ''}`}</p>` : '';
  return `${ui.header()}${ui.lost()}${bannerHtml()}
    <section class="card action">${actionHtml()}${head}${dice}</section>
    ${mySheetCard()}${recapHtml()}${othersHtml()}
    <div class="fw-bottompad" aria-hidden="true" style="height: calc(60vh + ${S.ui.padExtra || 0}px)"></div>`;
}

// ====================== Ende ======================
let soloKey = ''; let soloInfo = null;
function soloResult(g) {
  const total = E.scoreOf(g.players[0]).total;
  const key = `${S.room}|${g.throwNo}|${total}|${g.rollId}`;
  if (soloKey !== key) {
    soloKey = key;
    const prev = sess.get('fw_best', null);
    soloInfo = { total, prev, record: total > 0 && (prev === null || total > prev) };
    if (soloInfo.record) sess.set('fw_best', total);
  }
  return soloInfo;
}

function breakdown(r) {
  return `<div class="rd"><span class="chip">Farben ${r.colors >= 0 ? '+' : ''}${r.colors}</span><span class="chip">Spalten +${r.cols}</span><span class="chip">Joker +${r.jokers}</span><span class="chip">Sterne −${-r.stars}${r.missing ? ` (${r.missing} offen)` : ''}</span>${r.tie ? '<span class="chip">gleiche Punktzahl</span>' : ''}</div>`;
}

function overHtml() {
  const g = S.game;
  const allSheets = (title) => `<section class="card"><h2>${title}</h2>${g.players.map((p) => `<details class="other"><summary><b>${esc(p.name)}</b> – ${E.scoreOf(p).total} Punkte</summary>${sheetHtml(p, { small: true })}</details>`).join('')}</section>`;
  if (g.solo) {
    const r = soloResult(g);
    const rk = E.ranking(g)[0];
    return `${ui.header()}${ui.lost()}
      <section class="card over"><div class="trophy">${r.record ? '🏆' : '👏'}</div><h1>${r.total} Punkte!</h1>
      <p class="center big"><b>${esc(E.soloLevel(r.total))}</b></p>
      <p class="center big">${r.record ? 'Neue Bestleistung! 🎉' : (r.prev === null ? 'Deine Bestleistung wird gespeichert, sobald du mehr als 0 Punkte hast.' : `Deine Bestleistung: <b>${r.prev}</b> Punkte`)}</p>
      <p class="center muted">${esc(g.endReason || '')}</p>
      <ol class="ranking"><li class="win"><span class="medal">${r.record ? '🏆' : ''}</span><span class="rn">${esc(rk.name)}</span><span class="rt">${rk.total} Punkte</span>${breakdown(rk)}</li></ol>
      <button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
      ${recapHtml()}
      <section class="card"><h2>Dein Spielblatt</h2>${sheetHtml(g.players[0], { small: true })}</section>`;
  }
  const rank = E.ranking(g);
  const wins = rank.filter((r) => r.place === 1);
  const medals = { 1: '🏆', 2: '🥈', 3: '🥉' };
  const title = wins.length > 1
    ? `Unentschieden! ${joinNames(wins.map((w) => esc(w.name)))} teilen sich den Sieg.`
    : `${esc(wins[0].name)} hat gewonnen!`;
  const list = rank.map((r) => `<li class="${r.place === 1 ? 'win' : ''}"><span class="medal">${medals[r.place] || ''}</span>
    <span class="rn">${r.place}. ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.total} Punkte</span>${breakdown(r)}</li>`).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over"><div class="trophy">🏆</div><h1>${title}</h1><p class="center muted">${esc(g.endReason || '')}</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml()}${allSheets('Alle Spielblätter')}`;
}

// ====================== Hilfe ======================
function helpBody() {
  return `
    <p><b>Ziel:</b> Auf deinem Spielblatt Felder in Farben ankreuzen. Wer Spalten und ganze Farben vollständig ankreuzt, bekommt Punkte. Am Ende gewinnt, wer die meisten Punkte hat.</p>
    <h3>Das Spielblatt</h3>
    <p>Es hat 15 Spalten (A bis O) und 7 Zeilen mit Feldern in fünf Farben: Grün (G), Gelb (Y), Blau (B), Pink (P) und Orange (O). Jede Farbe hat ein eigenes Muster und einen Buchstaben im Feld. Felder mit einem Stern ★ geben am Ende Minuspunkte, wenn sie nicht angekreuzt sind. Die <b>Startspalte ist H</b>.</p>
    <h3>Die Würfel</h3>
    <p>Gewürfelt wird mit 3 Farbwürfeln und 3 Zahlenwürfeln. Die Farbwürfel zeigen eine der fünf Farben oder einen <b>Joker (✖)</b>. Die Zahlenwürfel zeigen 1 bis 5 oder einen <b>Joker (?)</b>.</p>
    <h3>So läuft ein Wurf</h3>
    <ol>
      <li>Die Person, die dran ist, würfelt alle 6 Würfel.</li>
      <li>Du wählst <b>einen Farbwürfel und einen Zahlenwürfel</b>. Die Zahl sagt, <b>wie viele Felder</b> du ankreuzt, die Farbe sagt, <b>in welcher Farbe</b>.</li>
      <li>Du tippst auf deinem Blatt genau so viele Felder an und bestätigst mit „Ja, so ankreuzen“.</li>
      <li>Du darfst immer auch „Nichts ankreuzen“ wählen.</li>
    </ol>
    <p><b>Die ersten 3 Würfe:</b> Alle wählen gleichzeitig aus allen 6 Würfeln. Mehrere Personen dürfen dieselben Würfel nehmen.</p>
    <p><b>Ab dem 4. Wurf:</b> Zuerst wählt die Person, die gewürfelt hat. Ihre beiden Würfel sind dann weg. Danach wählen alle anderen gleichzeitig aus den 4 übrigen Würfeln (wieder dürfen mehrere dasselbe nehmen). Nimmt die Person nichts, dürfen die anderen aus allen 6 Würfeln wählen. Danach würfelt die nächste Person.</p>
    <h3>Wo darfst du ankreuzen?</h3>
    <ul>
      <li>Dein allererstes Kreuz muss in <b>Spalte H</b> stehen.</li>
      <li>Alle Felder eines Wurfs müssen <b>aneinander grenzen</b> (nach oben, unten, links oder rechts – nicht nur an der Ecke) und in <b>einem</b> Farbfeld-Block derselben Farbe liegen.</li>
      <li>Die neuen Felder müssen entweder in Spalte H beginnen oder an ein Feld grenzen, das du schon angekreuzt hast.</li>
      <li>Es müssen <b>genau</b> so viele Felder sein, wie der Zahlenwürfel zeigt – nicht mehr und nicht weniger. Ein Farbfeld-Block muss nicht in einem Wurf ganz gefüllt werden.</li>
    </ul>
    <p>Das Programm zeigt dir die erlaubten Felder leuchtend an. Geht mit deiner Wahl nichts, sagt es dir das. Wenn du mit keinem Würfel etwas ankreuzen kannst, wird für dich automatisch gepasst.</p>
    <h3>Joker</h3>
    <p>Ein Joker-Farbwürfel (✖) lässt dich die Farbe frei wählen, ein Joker-Zahlenwürfel (?) eine Zahl von 1 bis 5 (keine 6). Jeder benutzte Joker kostet <b>1 Ausrufezeichen</b>. Beide Joker zusammen kosten 2. Du hast 8 Ausrufezeichen. Sind sie weg, kannst du keine Joker mehr benutzen.</p>
    <h3>Punkte</h3>
    <ul>
      <li><b>Spalten:</b> Hast du eine ganze Spalte angekreuzt, bekommst du die obere Zahl, wenn du sie als Erste/r füllst (auch wenn andere im selben Wurf gleichzeitig fertig werden). Wer später fertig wird, bekommt die untere Zahl.</li>
      <li><b>Farben:</b> Hast du alle 21 Felder einer Farbe, bekommst du 5 Punkte (als Erste/r), später 3 Punkte.</li>
      <li><b>Ausrufezeichen:</b> Am Ende gibt jedes übrige 1 Punkt.</li>
      <li><b>Sterne:</b> Jeder nicht angekreuzte Stern kostet 2 Punkte.</li>
    </ul>
    <h3>Spielende</h3>
    <p>Sobald jemand in einem Wurf seine <b>zweite Farbe</b> ganz angekreuzt hat, ist das Spiel nach diesem Wurf zu Ende (alle anderen dürfen in diesem Wurf noch wählen). Bei Gleichstand gewinnt, wer mehr Ausrufezeichen übrig hat – sonst gibt es mehrere Sieger.</p>
    <h3>Allein spielen</h3>
    <p>Du würfelst mit 2 Farb- und 2 Zahlenwürfeln und wählst daraus wie gewohnt. Nach 30 Würfen ist das Spiel zu Ende (oder früher, wenn du zwei Farben komplett hast). Du siehst, wie gut du warst, und dein bestes Ergebnis wird gemerkt.</p>
    <h3>Kleines Beispiel</h3>
    <p>Du würfelst Gelb, Blau, Pink und die Zahlen 4, 2, 1. Du nimmst den gelben Würfel und die 2. Du tippst zwei aneinandergrenzende gelbe Felder an, von denen eines in Spalte H liegt (beim ersten Mal), und bestätigst. Beim nächsten Wurf müssen neue Felder an deine Kreuze grenzen.</p>
    <p class="muted">Keine Sorge: Das Programm rechnet alle Punkte für dich aus und lässt nur erlaubte Eingaben zu. Welche Felder du wählst, entscheidest du ganz allein.</p>
  `;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du würfelst allein mit 4 Würfeln und kannst deine Bestleistung verbessern.',
  sess, $app,
  title: 'Farbenwürfeln', icon: '🎨', sub: 'Würfel-Ankreuzspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Farbenwürfeln', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const pk = S.ui.pick;
    const g = S.game;
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'die': {
        if (!amWaiting()) return undefined;
        const kind = el.dataset.kind; const i = Number(el.dataset.i);
        const key = kind === 'c' ? 'ci' : 'ni';
        if (pk[key] === i) { pk[key] = null; pk[kind === 'c' ? 'jc' : 'jn'] = null; pk.cells = []; return render(); }
        pk[key] = i; pk.cells = []; pk[kind === 'c' ? 'jc' : 'jn'] = null;
        const face = g.dice[kind][i];
        if (face === 'X' || face === '?') { pk.ask = { kind, i }; return render(); }
        return afterDice();
      }
      case 'joker-pick': {
        const ask = pk.ask; pk.ask = null;
        if (ask.kind === 'c') pk.jc = el.dataset.v; else pk.jn = Number(el.dataset.v);
        return afterDice();
      }
      case 'joker-cancel': {
        const ask = pk.ask; pk.ask = null;
        pk[ask.kind === 'c' ? 'ci' : 'ni'] = null;
        return render();
      }
      case 'reset-dice': S.ui.pick = freshPick(); return render();
      case 'cell': {
        const i = Number(el.dataset.i);
        pk.cells = pk.cells.includes(i) ? pk.cells.filter((x) => x !== i) : [...pk.cells, i];
        return render();
      }
      case 'clear-cells': pk.cells = []; return render();
      case 'confirm': {
        const color = colorOfPick(); const num = numOfPick();
        if (!color || !num || pk.cells.length !== num) return undefined;
        const msg = { t: 'pick', ci: pk.ci, ni: pk.ni, cells: [...pk.cells].sort((a, b) => a - b) };
        if (g.dice.c[pk.ci] === 'X') msg.color = pk.jc;
        if (g.dice.n[pk.ni] === '?') msg.num = pk.jn;
        S.ui.pick = freshPick();
        sess.send(msg);
        render();
        window.scrollTo({ top: 0 });
        return undefined;
      }
      case 'pass': pk.pass = true; return render();
      case 'pass-no': pk.pass = false; return render();
      case 'pass-yes': S.ui.pick = freshPick(); sess.send({ t: 'pass' }); render(); window.scrollTo({ top: 0 }); return undefined;
      case 'zoom-in': case 'zoom-out': case 'zoom-fit': return zoom(act);
      default: return undefined;
    }
  },
});

function afterDice() {
  const pk = S.ui.pick;
  if (pk.ci != null && pk.ni != null && groupsNow().length > 0) {
    S.ui.pend = { focus: true };
    render();
    document.getElementById('fw-mine')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  render();
}

// Nach dem Zoomen: Seitenhöhe gleich halten (sonst rutscht der Zettel beim Verkleinern nach unten)
// und den Zettel an derselben Stelle auf dem Bildschirm lassen.
function keepSheetInPlace(top0, h0) {
  const docH = () => document.documentElement.scrollHeight;
  if (h0 != null && docH() !== h0) {
    S.ui.padExtra = Math.max(0, (S.ui.padExtra || 0) + (h0 - docH()));
    render();
  }
  const sc2 = document.getElementById('fw-scroll');
  if (!sc2 || top0 == null) return;
  const d = sc2.getBoundingClientRect().top - top0;
  if (Math.abs(d) > 1) window.scrollBy(0, d);
}

function zoom(act) {
  const sc = document.getElementById('fw-scroll');
  const cell = sc && sc.querySelector('.fw-cell');
  if (!sc || !cell) return;
  const top0 = sc.getBoundingClientRect().top; // Lage des Zettels auf dem Bildschirm merken
  const h0 = document.documentElement.scrollHeight;
  const cur = cell.getBoundingClientRect().width;
  const frac = (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth;
  if (act === 'zoom-fit') { S.ui.fit = true; S.ui.pend = { frac }; render(); keepSheetInPlace(top0, h0); return; }
  S.ui.fit = false;
  const next = act === 'zoom-in' ? ZOOMS.find((z) => z > cur + 1) : [...ZOOMS].reverse().find((z) => z < cur - 1);
  S.ui.zoom = next || (act === 'zoom-in' ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]);
  sess.set('fw_zoom', S.ui.zoom);
  S.ui.pend = { frac };
  render();
  keepSheetInPlace(top0, h0);
}

function render() { ui.render(); }

// Ausschnitt des Blatts merken und nach dem Neuzeichnen wiederherstellen
$app.addEventListener('scroll', (ev) => {
  const t = ev.target;
  if (t && t.id === 'fw-scroll') S.ui.scroll = t.scrollLeft;
}, true);

new MutationObserver(() => {
  const sc = document.getElementById('fw-scroll');
  if (!sc) return;
  const f = S.ui.pend;
  S.ui.pend = null;
  if (f && f.frac != null) {
    sc.scrollLeft = f.frac * sc.scrollWidth - sc.clientWidth / 2;
  } else if (f && f.focus) {
    const opts = [...sc.querySelectorAll('.fw-cell.opt')];
    if (opts.length) {
      const lo = Math.min(...opts.map((e) => e.offsetLeft));
      const hi = Math.max(...opts.map((e) => e.offsetLeft + e.offsetWidth));
      const W = sc.clientWidth;
      sc.scrollLeft = hi - lo <= W - 20 ? (lo + hi) / 2 - W / 2 : lo - 10;
    }
  } else if (S.ui.scroll != null) {
    sc.scrollLeft = S.ui.scroll;
  }
  S.ui.scroll = sc.scrollLeft;
}).observe($app, { childList: true });

ui.boot();
