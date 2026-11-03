import * as E from './engine.js';
import * as Net from './net.js';

const $app = document.getElementById('app');
const store = Net.isMock() ? sessionStorage : localStorage;
const get = (k, d = null) => { try { const v = store.getItem('qwixx.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { store.setItem('qwixx.' + k, JSON.stringify(v)); } catch { /* egal */ } };
const del = (k) => { try { store.removeItem('qwixx.' + k); } catch { /* egal */ } };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_PLAYERS = 5;
const KEEPALIVE_MS = 8000;
const SILENCE_LIMIT_MS = 26000;
const SESSION_MAX_AGE = 8 * 3600 * 1000;

let cid = get('cid');
if (!cid) { cid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); set('cid', cid); }

const S = {
  screen: 'start', // start | connecting | lobby | game
  role: null, // 'host' | 'guest'
  room: null,
  name: get('name', ''),
  lobby: [], // [{id,name,connected}]
  game: null,
  link: 'ok', // ok | lost
  message: null, // {tone, text} Hinweis auf dem Startbildschirm
  ui: { selected: null, confirmPass: false, rolling: false, lastRollId: 0, helpOpen: false, big: get('big', false) },
};

// ====================== Gastgeber ======================
const H = { handle: null, conns: new Map(), timer: null, starterShift: 0 };

async function startHosting(restore) {
  S.role = 'host';
  S.screen = 'connecting';
  S.connectText = 'Spielraum wird eingerichtet …';
  render();
  const handlers = { onConnection: hostOnConnection, onError: () => {} };
  let code = restore ? restore.room : Net.newRoomCode();
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      H.handle = await Net.host(code, handlers);
      break;
    } catch (err) {
      const taken = err && (err.type === 'unavailable-id' || /taken/i.test(String(err.message)));
      if (restore) { await sleep(2500); continue; } // eigene alte Verbindung noch beim Server registriert → nochmal versuchen
      if (taken) { code = Net.newRoomCode(); continue; }
      if (attempt < 3) { await sleep(1500); continue; }
    }
  }
  if (!H.handle) {
    fail('Der Spielraum konnte nicht eingerichtet werden. Bitte prüfe deine Internetverbindung und versuche es gleich noch einmal.');
    return;
  }
  S.room = code;
  S.lobby = restore?.lobby?.map((p) => ({ ...p, connected: p.id === cid })) || [{ id: cid, name: S.name, connected: true }];
  S.game = restore?.game || null;
  S.screen = S.game ? 'game' : 'lobby';
  set('session', { role: 'host', room: code, ts: Date.now() });
  hostBroadcast();
  clearInterval(H.timer);
  H.timer = setInterval(hostBroadcast, KEEPALIVE_MS);
  wakeLock();
}

function hostOnConnection(conn) {
  let myId = null;
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      myId = String(msg.cid || '');
      if (!myId) return;
      const existing = S.lobby.find((p) => p.id === myId);
      if (existing) {
        existing.connected = true;
      } else if (S.game) {
        conn.send({ t: 'denied', text: 'Dieses Spiel läuft schon, es kann niemand mehr dazukommen. Bitte frage nach einem neuen Spiel.' });
        return;
      } else if (S.lobby.length >= MAX_PLAYERS) {
        conn.send({ t: 'denied', text: `In diesem Spiel sind schon ${MAX_PLAYERS} Personen – mehr geht leider nicht.` });
        return;
      } else {
        S.lobby.push({ id: myId, name: uniqueName(String(msg.name || 'Gast').slice(0, 14)), connected: true });
      }
      const old = H.conns.get(myId);
      H.conns.set(myId, conn);
      if (old && old !== conn) { try { old.close(); } catch { /* egal */ } }
      hostBroadcast();
    } else if (myId && H.conns.get(myId) === conn) {
      hostHandle(myId, msg);
    }
  });
  conn.on('close', () => {
    if (!myId || H.conns.get(myId) !== conn) return;
    H.conns.delete(myId);
    const p = S.lobby.find((x) => x.id === myId);
    if (p) {
      if (S.game) p.connected = false;
      else S.lobby = S.lobby.filter((x) => x.id !== myId);
    }
    hostBroadcast();
  });
}

function uniqueName(n) {
  let name = n.trim() || 'Gast';
  const taken = (x) => S.lobby.some((p) => p.name.toLowerCase() === x.toLowerCase());
  if (!taken(name)) return name;
  for (let i = 2; i < 10; i++) if (!taken(`${name} ${i}`)) return `${name} ${i}`;
  return name;
}

function hostHandle(id, msg) {
  if (msg.t === 'roll' && S.game) {
    E.roll(S.game, id);
    hostBroadcast();
  } else if (msg.t === 'pick' && S.game) {
    E.submit(S.game, id, msg.move || null);
    hostBroadcast();
  } else if (msg.t === 'leave') {
    const c = H.conns.get(id);
    H.conns.delete(id);
    if (!S.game) S.lobby = S.lobby.filter((x) => x.id !== id);
    else { const p = S.lobby.find((x) => x.id === id); if (p) p.connected = false; }
    try { c?.close(); } catch { /* egal */ }
    hostBroadcast();
  } else if (msg.t === 'ping') {
    /* Lebenszeichen, nichts zu tun */
  }
}

function hostBroadcast() {
  const snap = { t: 'state', room: S.room, lobby: S.lobby, game: S.game };
  for (const c of H.conns.values()) c.send(snap);
  set('hostState', { room: S.room, lobby: S.lobby, game: S.game });
  onStateChanged();
}

function hostStartGame() {
  const players = S.lobby.filter((p) => p.connected);
  if (players.length < 2) return;
  const n = players.length;
  const shift = H.starterShift++ % n;
  const order = [...players.slice(shift), ...players.slice(0, shift)];
  S.lobby = order.concat(S.lobby.filter((p) => !p.connected));
  S.game = E.createGame(order.map((p) => ({ id: p.id, name: p.name })));
  S.ui.lastRollId = 0;
  hostBroadcast();
}

// ====================== Gast ======================
const G = { conn: null, lastMsg: 0, retry: null, watchdog: null, active: false };

async function joinGame(room, { resume = false } = {}) {
  S.role = 'guest';
  S.room = room;
  S.screen = 'connecting';
  S.connectText = 'Verbinde mit dem Spiel …';
  render();
  try {
    await guestConnect();
  } catch (err) {
    G.active = false;
    S.screen = 'start';
    del('session');
    S.message = resume
      ? { tone: 'warn', text: 'Das Spiel läuft nicht mehr oder der Gastgeber ist nicht erreichbar.' }
      : { tone: 'warn', text: 'Dieses Spiel wurde nicht gefunden. Bitte prüfe den Code (4 Buchstaben). Vielleicht muss der Gastgeber zuerst sein Spiel eröffnen oder ist gerade nicht online.' };
    render();
    return;
  }
  set('session', { role: 'guest', room, ts: Date.now() });
  G.active = true;
  clearInterval(G.watchdog);
  G.watchdog = setInterval(guestWatchdog, 4000);
  wakeLock();
}

async function guestConnect() {
  const conn = await Net.join(S.room);
  G.conn = conn;
  G.lastMsg = Date.now();
  conn.on('data', (msg) => {
    G.lastMsg = Date.now();
    if (!msg) return;
    if (msg.t === 'state') {
      S.lobby = msg.lobby;
      S.game = msg.game;
      S.link = 'ok';
      S.screen = S.game ? 'game' : 'lobby';
      onStateChanged();
    } else if (msg.t === 'denied') {
      G.active = false;
      leaveLocal();
      S.message = { tone: 'warn', text: msg.text };
      render();
    }
  });
  conn.on('close', () => { if (G.conn === conn) guestLost(); });
  conn.send({ t: 'hello', cid, name: S.name });
}

function guestLost() {
  if (!G.active || S.link === 'lost') return;
  S.link = 'lost';
  render();
  scheduleRetry(500);
}
function scheduleRetry(ms) {
  clearTimeout(G.retry);
  G.retry = setTimeout(async () => {
    if (!G.active) return;
    try { await guestConnect(); } catch { scheduleRetry(3000); }
  }, ms);
}
function guestWatchdog() {
  if (!G.active || S.link === 'lost') return;
  if (Date.now() - G.lastMsg > SILENCE_LIMIT_MS) {
    try { G.conn?.close(); } catch { /* egal */ }
    guestLost();
  } else {
    G.conn?.send({ t: 'ping' });
  }
}

// ====================== Gemeinsame Aktionen ======================
function sendToHost(msg) {
  if (S.role === 'host') hostHandle(cid, msg);
  else if (S.link === 'ok') G.conn?.send(msg);
}
function doRoll() { sendToHost({ t: 'roll' }); }
function doPick(move) {
  S.ui.selected = null;
  S.ui.confirmPass = false;
  sendToHost({ t: 'pick', move: move ? { color: move.color, idx: move.idx } : null });
  render();
}

function leaveLocal() {
  G.active = false;
  clearInterval(G.watchdog); clearTimeout(G.retry); clearInterval(H.timer);
  try { G.conn?.close(); } catch { /* egal */ }
  try { H.handle?.close(); } catch { /* egal */ }
  for (const c of H.conns.values()) { try { c.close(); } catch { /* egal */ } }
  H.conns.clear(); H.handle = null; G.conn = null;
  del('session'); del('hostState');
  S.screen = 'start'; S.role = null; S.room = null; S.game = null; S.lobby = []; S.link = 'ok';
  S.ui = { ...S.ui, selected: null, confirmPass: false, rolling: false, lastRollId: 0 };
}

function fail(text) {
  leaveLocal();
  S.message = { tone: 'warn', text };
  render();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wakeLock() { try { await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ } }

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  wakeLock();
  if (S.role === 'guest' && G.active && S.link === 'ok' && Date.now() - G.lastMsg > 12000) {
    try { G.conn?.close(); } catch { /* egal */ }
    guestLost();
  }
});

// ====================== Darstellung ======================
const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const link = () => {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('raum', S.room);
  if (Net.isMock()) u.searchParams.set('mock', '1');
  return u.toString();
};

function onStateChanged() {
  const g = S.game;
  if (S.screen === 'lobby' || S.screen === 'game') S.screen = g ? 'game' : 'lobby';
  if (g && g.rollId !== S.ui.lastRollId) {
    const first = S.ui.lastRollId === 0 && g.round > 1; // Wiedereinstieg mitten im Spiel: nicht neu würfeln lassen
    S.ui.lastRollId = g.rollId;
    S.ui.selected = null;
    S.ui.confirmPass = false;
    if (!first && g.phase !== 'roll') { animateDice(); return; }
  }
  // Auswahl verwerfen, wenn sie nicht mehr passt
  if (g && !E.waitingFor(g).includes(cid)) { S.ui.selected = null; S.ui.confirmPass = false; }
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
    const el = document.getElementById('dice');
    if (el) el.innerHTML = diceHtml(S.game, true);
    if (n >= 9) {
      clearInterval(rollTimer);
      S.ui.rolling = false;
      render();
    }
  }, 90);
}

function pips(v) {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  return Array.from({ length: 9 }, (_, i) => `<b class="${on.includes(i) ? 'on' : ''}"></b>`).join('');
}
function die(v, kind, label) {
  if (v == null) return `<span class="die gone" role="img" aria-label="${label} gesperrt"><span class="gonelock">🔒</span></span>`;
  return `<span class="die d-${kind}" role="img" aria-label="${label}: ${v}">${pips(v)}</span>`;
}
function diceHtml(g, spin) {
  if (!g || !g.dice) return '';
  const r = () => 1 + Math.floor(Math.random() * 6);
  const v = (x) => (spin && x != null ? r() : x);
  const d = g.dice;
  const dim = g.phase === 'roll' ? ' dim' : '';
  return `<div class="dicerow${dim}${spin ? ' spin' : ''}">
    <div class="dicegroup"><div class="dgl">Weiße Würfel</div><div>${die(v(d.w1), 'white', 'Weißer Würfel')}${die(v(d.w2), 'white', 'Weißer Würfel')}</div></div>
    <div class="dicegroup"><div class="dgl">Farbige Würfel</div><div>${E.COLORS.map((c) => die(v(d[c]), c, E.COLOR_NAMES[c] + 'er Würfel')).join('')}</div></div>
  </div>`;
}

function sheetHtml(player, opts = {}) {
  const options = opts.options || [];
  const sel = opts.selected;
  const rows = E.COLORS.map((c) => {
    const row = player.rows[c];
    const last = E.lastMarkedIndex(row);
    const closed = S.game.closed[c];
    const cells = row.marks.map((m, i) => {
      const num = E.numberAt(c, i);
      const isOpt = options.some((o) => o.color === c && o.idx === i);
      const isSel = sel && sel.color === c && sel.idx === i;
      const cls = ['cell', m ? 'mark' : '', !m && i < last ? 'skip' : '', isOpt ? 'opt' : '', isSel ? 'sel' : ''].join(' ');
      const inner = `<span class="n">${num}</span>${m ? '<span class="x">✕</span>' : ''}`;
      return isOpt
        ? `<button class="${cls}" data-act="cell" data-color="${c}" data-idx="${i}" aria-label="${E.COLOR_NAMES[c]} ${num} ankreuzen">${inner}</button>`
        : `<div class="${cls}" aria-label="${E.COLOR_NAMES[c]} ${num}${m ? ' angekreuzt' : ''}">${inner}</div>`;
    }).join('');
    const lockInner = row.lock ? '<span class="x">✕</span>' : '';
    const lockIcon = closed ? '🔒' : '🔓';
    return `<div class="srow c-${c}${closed ? ' closed' : ''}">
      <div class="rlabel">${E.COLOR_NAMES[c]}</div>${cells}
      <div class="cell lockc${row.lock ? ' mark' : ''}" title="${closed ? 'Reihe gesperrt' : 'Schloss'}"><span class="n">${lockIcon}</span>${lockInner}</div>
    </div>`;
  }).join('');
  return `<div class="sheet${opts.small ? ' small' : ''}">${rows}</div>`;
}

function scoreHtml(player) {
  const s = E.scoreOf(player);
  const chips = E.COLORS.map((c) => `<span class="chip c-${c}">${E.COLOR_NAMES[c]}: ${s.perColor[c].crosses} ✕ = ${s.perColor[c].points}</span>`).join('');
  const boxes = Array.from({ length: E.MAX_PENALTIES }, (_, i) => `<span class="pbox${i < player.penalties ? ' on' : ''}">${i < player.penalties ? '✕' : ''}</span>`).join('');
  return `<div class="score"><div class="chips">${chips}</div>
    <div class="pen">Fehlwürfe: ${boxes} <span class="penval">${player.penalties ? '−' + s.penalty : ''}</span></div>
    <div class="total">Punkte aktuell: <b>${s.total}</b></div></div>`;
}

function actionHtml() {
  const g = S.game;
  const me = myIndex();
  const active = g.players[g.active];
  const isMe = active.id === cid;
  if (me < 0) return `<p class="big">Du schaust nur zu.</p>`;
  if (S.ui.rolling) return `<p class="big center">🎲 Die Würfel rollen …</p>`;

  if (g.phase === 'roll') {
    return isMe
      ? `<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`
      : `<p class="big center">Gleich würfelt <b>${esc(active.name)}</b>. Bitte einen Moment Geduld.</p>`;
  }

  const waiting = E.waitingFor(g);
  const names = waiting.map((id) => esc(g.players.find((p) => p.id === id).name));
  if (!waiting.includes(cid)) {
    const msg = g.auto[cid]
      ? (g.phase === 'white' ? 'Du kannst diesmal leider nichts ankreuzen.' : 'Im zweiten Schritt kannst du leider nichts ankreuzen.')
      : 'Danke, deine Wahl ist angekommen.';
    return `<p class="big center">${msg}</p><p class="center muted">Wir warten noch auf: <b>${names.join(', ')}</b></p>`;
  }

  const moves = E.legalMoves(g, cid);
  const d = g.dice;
  const head = g.phase === 'white'
    ? `<h2 class="step">Schritt 1 – alle dürfen mitmachen</h2><p class="big">Die beiden weißen Würfel zusammen ergeben <b class="sum">${d.w1 + d.w2}</b>.</p>`
    : `<h2 class="step">Schritt 2 – nur du, ${esc(active.name)}</h2><p class="big">Ein weißer und ein farbiger Würfel zusammen.</p>`;

  const sel = S.ui.selected;
  if (S.ui.confirmPass) {
    const warn = isMe && g.phase === 'color' && g.turnCrosses[cid] === 0
      ? `<p class="warn">Achtung: Du hast in dieser Runde noch nichts angekreuzt. Das gibt einen <b>Fehlwurf (−5 Punkte)</b>.</p>` : '';
    return `${head}<div class="confirm"><p class="big">Wirklich nichts ankreuzen?</p>${warn}
      <button class="btn secondary huge" data-act="pass-yes">Ja, nichts ankreuzen</button>
      <button class="btn ghost" data-act="back">Zurück zur Auswahl</button></div>`;
  }
  if (sel) {
    return `${head}<div class="confirm"><p class="big">Du kreuzt <b class="pill c-${sel.color}">${E.COLOR_NAMES[sel.color]} ${sel.num}</b> an.</p>
      <button class="btn primary huge" data-act="confirm">✔ Ja, ankreuzen</button>
      <button class="btn ghost" data-act="back">Nein, ich will etwas anderes</button></div>`;
  }
  const btns = moves.map((m) => {
    const how = m.how.w == null ? '' : `<span class="how">weißer Würfel ${m.how.w} + ${E.COLOR_NAMES[m.color].toLowerCase()}er Würfel ${m.how.c}</span>`;
    return `<button class="btn move c-${m.color}" data-act="move" data-color="${m.color}" data-idx="${m.idx}"><span class="mv">${E.COLOR_NAMES[m.color]} – die ${m.num} ankreuzen</span>${how}</button>`;
  }).join('');
  const hint = g.phase === 'white' && isMe ? `<p class="muted">Du darfst nachher in Schritt 2 noch einmal ankreuzen.</p>` : '';
  return `${head}<p class="muted">Tippe auf eine Möglichkeit – oder wähle „Nichts ankreuzen“.</p>
    <div class="moves">${btns}</div>
    <button class="btn secondary" data-act="pass">Nichts ankreuzen</button>${hint}`;
}

function bannerHtml() {
  const g = S.game;
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const active = g.players[g.active];
  if (S.link === 'lost') return '';
  const waiting = E.waitingFor(g);
  if (g.phase === 'roll') {
    return active.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(active.name)} ist dran</div>`;
  }
  if (waiting.includes(cid)) return `<div class="banner mine">Du bist gefragt</div>`;
  return `<div class="banner">Bitte warten … (${esc(active.name)} ist am Zug)</div>`;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length || S.ui.rolling) return '';
  const title = g.phase === 'roll' || g.phase === 'over' ? 'Das ist in der letzten Runde passiert' : 'Bisher in dieser Runde';
  return `<section class="card recap"><h3>${title}</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function othersHtml() {
  const g = S.game;
  const others = g.players.filter((p) => p.id !== cid);
  if (!others.length) return '';
  return `<section class="card"><h2>Mitspieler</h2>${others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const s = E.scoreOf(p);
    return `<details class="other"><summary><b>${esc(p.name)}</b>${off} – ${s.total} Punkte, Fehlwürfe: ${p.penalties}</summary>${sheetHtml(p, { small: true })}${scoreHtml(p)}</details>`;
  }).join('')}</section>`;
}

function headerHtml() {
  return `<header class="top">
    <div class="room">Spiel <b>${esc(S.room || '')}</b></div>
    <div class="topbtns">
      <button class="btn mini" data-act="bigger" aria-label="Schrift größer oder kleiner">A⁺ Schrift</button>
      <button class="btn mini" data-act="help">? Regeln</button>
      <button class="btn mini" data-act="leave">Verlassen</button>
    </div></header>`;
}

function lostHtml() {
  return S.link === 'lost'
    ? `<div class="lostbar" role="alert">Die Verbindung ist kurz unterbrochen. Bitte nicht weggehen – wir verbinden dich automatisch wieder …</div>` : '';
}

function gameHtml() {
  const g = S.game;
  const me = g.players[myIndex()];
  const waiting = E.waitingFor(g);
  const options = me && waiting.includes(cid) && !S.ui.rolling ? E.legalMoves(g, cid) : [];
  if (g.phase === 'over') return overHtml();
  return `${headerHtml()}${lostHtml()}${bannerHtml()}
    <section class="card"><div id="dice">${diceHtml(g, false)}</div></section>
    <section class="card action">${actionHtml()}</section>
    ${recapHtml()}
    ${me ? `<section class="card"><h2>Dein Spielzettel</h2>${sheetHtml(me, { options, selected: S.ui.selected })}${scoreHtml(me)}
    <p class="muted small">Von links nach rechts ankreuzen. Zahlen, die du überspringst, kannst du nicht mehr nehmen. Rechts außen ist das Schloss 🔒 (erst nach 5 Kreuzen in der Reihe).</p></section>` : ''}
    ${othersHtml()}`;
}

function overHtml() {
  const g = S.game;
  const rank = E.ranking(g);
  const top = rank[0].total;
  const winners = rank.filter((r) => r.total === top);
  const headline = winners.length > 1
    ? `Unentschieden zwischen ${winners.map((w) => esc(w.name)).join(' und ')}!`
    : `${esc(winners[0].name)} hat gewonnen!`;
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r, i) => `<li class="${r.total === top ? 'win' : ''}"><span class="medal">${r.total === top ? '🏆' : medals[i] || ''}</span>
    <span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.total} Punkte</span>
    <div class="rd">${E.COLORS.map((c) => `<span class="chip c-${c}">${E.COLOR_NAMES[c]} ${r.perColor[c].points}</span>`).join('')}${r.penalties ? `<span class="chip">Fehlwürfe −${r.penalty}</span>` : ''}</div></li>`).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">🏆</div><h1>${headline}</h1><p class="center muted">${esc(g.endReason || '')}</p>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml()}
    <section class="card"><h2>Alle Spielzettel</h2>${g.players.map((p) => `<details class="other"><summary><b>${esc(p.name)}</b></summary>${sheetHtml(p, { small: true })}</details>`).join('')}</section>`;
}

function lobbyHtml() {
  const isHost = S.role === 'host';
  const list = S.lobby.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : ''}"></span>${esc(p.name)}${p.id === cid ? ' (du)' : ''}${i === 0 ? ' – Gastgeber' : ''}</li>`).join('');
  const url = S.room ? link() : '';
  const invite = isHost ? `
    <section class="card"><h2>1. Lade deine Mitspieler ein</h2>
      <p class="big">Dein Spiel-Code lautet:</p><div class="code" aria-label="Spiel-Code ${esc(S.room)}">${esc(S.room || '')}</div>
      <p class="muted">Am einfachsten: Schicke den Einladungs-Link. Wer darauf tippt, ist sofort im Spiel.</p>
      <a class="btn primary huge" href="https://wa.me/?text=${encodeURIComponent('Komm zu Kreuz & Quer! Tippe hier, um mitzuspielen: ' + url)}" target="_blank" rel="noopener">Per WhatsApp einladen</a>
      <button class="btn secondary" data-act="copy">Einladungs-Link kopieren</button>
      ${navigator.share ? `<button class="btn secondary" data-act="share">Anders teilen (E-Mail, SMS …)</button>` : ''}
      <p class="muted small">Oder: Auf <b>${esc(location.host + location.pathname)}</b> den Code <b>${esc(S.room)}</b> eingeben.</p>
    </section>` : '';
  const start = isHost
    ? `<section class="card"><h2>2. Los geht’s</h2>${S.lobby.filter((p) => p.connected).length < 2
      ? `<p class="big">Sobald mindestens eine weitere Person da ist, kannst du starten.</p>`
      : `<button class="btn primary huge" data-act="start">▶ Spiel starten</button>`}</section>`
    : `<section class="card"><p class="big center">Du bist dabei! 🎉<br>Bitte einen Moment warten, bis der Gastgeber das Spiel startet.</p></section>`;
  return `${headerHtml()}${lostHtml()}${invite}
    <section class="card"><h2>Wer ist schon da?</h2><ul class="players">${list}</ul></section>${start}`;
}

function startHtml() {
  const params = new URLSearchParams(location.search);
  const invited = Net.cleanCode(params.get('raum'));
  const msg = S.message ? `<div class="notice ${S.message.tone}" role="alert">${esc(S.message.text)}</div>` : '';
  const nameField = `<label class="lbl" for="name">Wie heißt du?</label>
    <input id="name" class="input" type="text" maxlength="14" autocomplete="given-name" placeholder="Dein Vorname" value="${esc(S.name)}">`;
  if (invited.length === 4) {
    return `<div class="hero"><div class="logo">🎲</div><h1>Kreuz &amp; Quer</h1><p class="sub">Du wurdest zu einem Spiel eingeladen!</p></div>
      <section class="card">${msg}${nameField}
      <button class="btn primary huge" data-act="join-invited" data-code="${invited}">Mitspielen</button>
      <button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button></section>`;
  }
  return `<div class="hero"><div class="logo">🎲</div><h1>Kreuz &amp; Quer</h1><p class="sub">Das Würfelspiel – online zusammen spielen</p></div>
    <section class="card">${msg}${nameField}
      <button class="btn primary huge" data-act="host">🎲 Neues Spiel eröffnen</button>
      <p class="muted center">Du bekommst einen Einladungs-Link für deine Mitspieler.</p>
    </section>
    <section class="card"><h2>Du hast einen Code bekommen?</h2>
      <label class="lbl" for="code">Code (4 Buchstaben)</label>
      <input id="code" class="input code-in" type="text" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="z. B. KFRT">
      <button class="btn secondary huge" data-act="join-code">Spiel beitreten</button>
    </section>
    <section class="card"><button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button></section>`;
}

function helpHtml() {
  return `<div class="overlay" data-act="help-close"><div class="modal" role="dialog" aria-modal="true" aria-label="Spielregeln" onclick="event.stopPropagation()">
    <h2>Die Spielregeln von Kreuz &amp; Quer</h2>
    <p><b>Ziel:</b> Möglichst viele Zahlen auf deinem Spielzettel ankreuzen. Wer am Ende die meisten Punkte hat, gewinnt.</p>
    <h3>Der Spielzettel</h3>
    <p>Es gibt vier farbige Reihen. <b>Rot und Gelb</b> gehen von <b>2 bis 12</b>, <b>Grün und Blau</b> von <b>12 bis 2</b>. Du kreuzt immer <b>von links nach rechts</b> an. Du darfst Zahlen überspringen – aber übersprungene Zahlen sind für immer verloren.</p>
    <h3>Eine Runde</h3>
    <ol>
      <li>Wer an der Reihe ist, würfelt alle Würfel (2 weiße und 4 farbige).</li>
      <li><b>Schritt 1 – alle:</b> Die beiden weißen Würfel zusammenzählen. Jeder darf diese Summe in <i>einer beliebigen</i> Farbreihe ankreuzen – oder nichts.</li>
      <li><b>Schritt 2 – nur wer dran ist:</b> Ein weißer Würfel plus ein farbiger Würfel. Die Summe darf in der Reihe <i>dieser Farbe</i> angekreuzt werden – oder nichts.</li>
      <li>Hat der Spieler am Zug in beiden Schritten nichts angekreuzt, bekommt er einen <b>Fehlwurf</b> (−5 Punkte).</li>
    </ol>
    <h3>Reihe sperren 🔒</h3>
    <p>Die letzte Zahl jeder Reihe (12 bei Rot/Gelb, 2 bei Grün/Blau) darfst du nur ankreuzen, wenn du in dieser Reihe schon <b>mindestens 5 Kreuze</b> hast. Dann bekommst du zusätzlich das Schloss als Kreuz. Die Reihe ist danach für alle gesperrt, und der Würfel dieser Farbe wird nicht mehr gebraucht. Wer im selben Schritt ebenfalls sperrt, bekommt das Schloss auch.</p>
    <h3>Spielende</h3>
    <p>Das Spiel endet, sobald <b>zwei Reihen gesperrt</b> sind oder jemand den <b>vierten Fehlwurf</b> hat.</p>
    <h3>Punkte</h3>
    <p>Je mehr Kreuze in einer Reihe, desto mehr Punkte: 1 Kreuz = 1, 2 = 3, 3 = 6, 4 = 10, 5 = 15, 6 = 21, 7 = 28, 8 = 36, 9 = 45, 10 = 55, 11 = 66, 12 = 78. Davon werden 5 Punkte pro Fehlwurf abgezogen.</p>
    <p class="muted">Keine Sorge: Das Programm zeigt dir nur Möglichkeiten an, die erlaubt sind, und rechnet die Punkte für dich aus.</p>
    <button class="btn primary huge" data-act="help-close">Alles klar, schließen</button>
  </div></div>`;
}

function render() {
  document.documentElement.classList.toggle('big', !!S.ui.big);
  let html = '';
  if (S.screen === 'start') html = startHtml();
  else if (S.screen === 'connecting') html = `<div class="hero"><div class="logo spin">🎲</div><h1>Einen Moment …</h1><p class="sub">${esc(S.connectText || '')}</p>
      <button class="btn ghost" data-act="leave-now">Abbrechen</button></div>`;
  else if (S.screen === 'lobby') html = lobbyHtml();
  else if (S.screen === 'game' && S.game) html = gameHtml();
  $app.innerHTML = html + (S.ui.helpOpen ? helpHtml() : '');
}

// ====================== Bedienung ======================
function readName() {
  const el = document.getElementById('name');
  const n = (el ? el.value : S.name).trim().slice(0, 14);
  return n;
}
function needName() {
  const n = readName();
  if (!n) {
    S.message = { tone: 'warn', text: 'Bitte trage zuerst deinen Vornamen ein.' };
    render();
    document.getElementById('name')?.focus();
    return null;
  }
  S.name = n; set('name', n);
  return n;
}

$app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const g = S.game;
  switch (act) {
    case 'host':
      if (!needName()) return;
      S.message = null;
      return startHosting(null);
    case 'join-code': {
      if (!needName()) return;
      const code = Net.cleanCode(document.getElementById('code')?.value);
      if (code.length !== 4) { S.message = { tone: 'warn', text: 'Der Code besteht aus 4 Buchstaben.' }; render(); return; }
      S.message = null;
      return joinGame(code);
    }
    case 'join-invited':
      if (!needName()) return;
      S.message = null;
      return joinGame(el.dataset.code);
    case 'start': return hostStartGame();
    case 'again': return hostStartGame();
    case 'roll': return doRoll();
    case 'move': {
      const m = E.legalMoves(g, cid).find((x) => x.color === el.dataset.color && x.idx === Number(el.dataset.idx));
      S.ui.selected = m || null; S.ui.confirmPass = false;
      return render();
    }
    case 'cell': {
      const m = E.legalMoves(g, cid).find((x) => x.color === el.dataset.color && x.idx === Number(el.dataset.idx));
      S.ui.selected = m || null; S.ui.confirmPass = false;
      render();
      document.querySelector('.action')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    case 'confirm': return S.ui.selected && doPick(S.ui.selected);
    case 'pass': S.ui.confirmPass = true; S.ui.selected = null; return render();
    case 'pass-yes': return doPick(null);
    case 'back': S.ui.selected = null; S.ui.confirmPass = false; return render();
    case 'help': S.ui.helpOpen = true; return render();
    case 'help-close': S.ui.helpOpen = false; return render();
    case 'bigger': S.ui.big = !S.ui.big; set('big', S.ui.big); return render();
    case 'leave':
      if (confirm(S.role === 'host' ? 'Das Spiel wirklich beenden? Für alle Mitspieler endet es dann.' : 'Das Spiel wirklich verlassen?')) {
        if (S.role === 'guest') sendToHost({ t: 'leave' });
        leaveLocal(); render();
      }
      return;
    case 'leave-now':
      if (S.role === 'guest') sendToHost({ t: 'leave' });
      leaveLocal(); render(); return;
    case 'copy':
      try { await navigator.clipboard.writeText(link()); el.textContent = '✔ Link kopiert!'; }
      catch { prompt('Diesen Link bitte kopieren und verschicken:', link()); }
      return;
    case 'share':
      try { await navigator.share({ title: 'Kreuz & Quer', text: 'Komm zu Kreuz & Quer! Tippe hier, um mitzuspielen:', url: link() }); } catch { /* abgebrochen */ }
      return;
  }
});

// Enter im Namens-/Code-Feld
$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'code') $app.querySelector('[data-act="join-code"]')?.click();
  else if (ev.target.id === 'name') ($app.querySelector('[data-act="join-invited"]') || $app.querySelector('[data-act="host"]'))?.click();
});
$app.addEventListener('input', (ev) => {
  if (ev.target.id === 'code') ev.target.value = Net.cleanCode(ev.target.value);
});

// ====================== Start ======================
(function boot() {
  if (!window.Peer && !Net.isMock()) {
    $app.innerHTML = '<div class="notice warn">Die Spielbibliothek konnte nicht geladen werden. Bitte lade die Seite neu.</div>';
    return;
  }
  const params = new URLSearchParams(location.search);
  const invited = Net.cleanCode(params.get('raum'));
  const sess = get('session');
  const fresh = sess && Date.now() - sess.ts < SESSION_MAX_AGE;
  if (fresh && (!invited || invited === sess.room) && S.name) {
    // Seite wurde neu geladen oder aus Versehen geschlossen → automatisch zurück ins Spiel
    if (sess.role === 'host') {
      const hs = get('hostState');
      if (hs && hs.room === sess.room) return void startHosting(hs);
    } else {
      return void joinGame(sess.room, { resume: true });
    }
  }
  render();
})();
