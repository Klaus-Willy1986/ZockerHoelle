// Gemeinsame Sitzungs-Schicht für alle Spiele:
// Gastgeber/Gast, Lobby, Einladung, automatische Wiederverbindung, Speichern im Browser.
// Ein Gerät (Gastgeber) hält den Spielstand; alle anderen schicken ihm ihre Eingaben.
import * as Net from './net.js';
import { init as statsInit, track } from './stats.js';

const KEEPALIVE_MS = 8000;
const SILENCE_LIMIT_MS = 26000;
const SESSION_MAX_AGE = 8 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSession(cfg) {
  // cfg: { game, maxPlayers, newGame(players, shift) -> state, onMessage(state, pid, msg), render(), onState(), onLeave?() }
  Net.configure(cfg.game);
  statsInit();
  const store = Net.isMock() ? sessionStorage : localStorage;
  const GAME_KEYS = new Set(['session', 'hostState']);
  const key = (k) => (GAME_KEYS.has(k) ? `zh.${cfg.game}.${k}` : `zh.${k}`);
  const get = (k, d = null) => { try { const v = store.getItem(key(k)); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { store.setItem(key(k), JSON.stringify(v)); } catch { /* egal */ } };
  const del = (k) => { try { store.removeItem(key(k)); } catch { /* egal */ } };

  let cid = get('cid');
  if (!cid) { cid = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); set('cid', cid); }

  const S = {
    screen: 'start', // start | connecting | lobby | game
    role: null, // 'host' | 'guest'
    room: null,
    name: get('name', ''),
    lobby: [], // [{id,name,connected}]
    game: null,
    link: 'ok', // ok | lost
    message: null, // {tone, text}
    connectText: '',
  };
  const H = { handle: null, conns: new Map(), timer: null, starterShift: 0 };
  const G = { conn: null, lastMsg: 0, retry: null, watchdog: null, active: false };

  const link = () => {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('raum', S.room);
    if (Net.isMock()) u.searchParams.set('mock', '1');
    return u.toString();
  };

  // ---------- Gastgeber ----------
  async function startHosting(restore) {
    S.role = 'host';
    S.screen = 'connecting';
    S.connectText = 'Spielraum wird eingerichtet …';
    cfg.render();
    const handlers = { onConnection: hostOnConnection, onError: () => {} };
    let code = restore ? restore.room : Net.newRoomCode();
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        H.handle = await Net.host(code, handlers);
        break;
      } catch (err) {
        const taken = err && (err.type === 'unavailable-id' || /taken/i.test(String(err.message)));
        if (restore) { await sleep(2500); continue; } // eigene alte Verbindung noch beim Server registriert
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
    if (!restore) track('raum-eroeffnet/' + cfg.game);
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
        } else if (S.lobby.length >= cfg.maxPlayers) {
          conn.send({ t: 'denied', text: `In diesem Spiel sind schon ${cfg.maxPlayers} Personen – mehr geht leider nicht.` });
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
    const name = n.trim() || 'Gast';
    const taken = (x) => S.lobby.some((p) => p.name.toLowerCase() === x.toLowerCase());
    if (!taken(name)) return name;
    for (let i = 2; i < 10; i++) if (!taken(`${name} ${i}`)) return `${name} ${i}`;
    return name;
  }

  function hostHandle(id, msg) {
    if (msg.t === 'leave') {
      const c = H.conns.get(id);
      H.conns.delete(id);
      if (!S.game) S.lobby = S.lobby.filter((x) => x.id !== id);
      else { const p = S.lobby.find((x) => x.id === id); if (p) p.connected = false; }
      try { c?.close(); } catch { /* egal */ }
      hostBroadcast();
    } else if (msg.t === 'ping') {
      /* Lebenszeichen */
    } else if (S.game) {
      cfg.onMessage(S.game, id, msg);
      hostBroadcast();
    }
  }

  function hostBroadcast() {
    const snap = { t: 'state', room: S.room, lobby: S.lobby, game: S.game };
    for (const c of H.conns.values()) c.send(snap);
    set('hostState', { room: S.room, lobby: S.lobby, game: S.game, level: S.level });
    stateChanged();
    scheduleBot();
  }

  // Computergegner (nur im Alleinspiel): Das Spiel liefert cfg.bot.step(game, level) -> { id, msg } oder null.
  let botTimer = null;
  function scheduleBot() {
    clearTimeout(botTimer);
    if (S.room !== 'SOLO' || !cfg.bot || !S.game) return;
    botTimer = setTimeout(() => {
      if (S.room !== 'SOLO' || !S.game) return;
      const act = cfg.bot.step(S.game, S.level || 0);
      if (act && act.msg) hostHandle(act.id, act.msg);
    }, cfg.bot.delay || 900);
  }

  function hostStartGame() {
    const players = S.lobby.filter((p) => p.connected);
    if (players.length < (S.room === 'SOLO' ? 1 : 2)) return;
    const n = players.length;
    const shift = H.starterShift++ % n;
    const order = [...players.slice(shift), ...players.slice(0, shift)];
    S.lobby = order.concat(S.lobby.filter((p) => !p.connected));
    S.game = cfg.newGame(order.map((p) => ({ id: p.id, name: p.name })));
    track((S.room === 'SOLO' ? (S.lobby.some((p) => p.bot) ? 'gegen-computer/' : 'allein-gestartet/') : 'gestartet/') + cfg.game);
    hostBroadcast();
  }

  // ---------- Allein spielen (ohne Netzwerk) ----------
  function startSolo(restore, opts = {}) {
    S.role = 'host';
    S.room = 'SOLO';
    const bots = Math.max(0, opts.bots || 0);
    S.level = restore ? (restore.level || 0) : (opts.level || 0);
    S.lobby = restore?.lobby || [
      { id: cid, name: S.name, connected: true },
      ...Array.from({ length: bots }, (_, i) => ({ id: 'bot' + (i + 1), name: bots > 1 ? 'Computer ' + (i + 1) : 'Computer', connected: true, bot: true })),
    ];
    S.game = restore?.game || cfg.newGame(S.lobby.map((p) => ({ id: p.id, name: p.name })));
    if (!restore) track((bots ? 'gegen-computer/' : 'allein-gestartet/') + cfg.game);
    S.screen = 'game';
    set('session', { role: 'host', room: 'SOLO', ts: Date.now() });
    hostBroadcast();
    wakeLock();
  }

  // ---------- Gast ----------
  async function joinGame(room, { resume = false } = {}) {
    S.role = 'guest';
    S.room = room;
    S.screen = 'connecting';
    S.connectText = 'Verbinde mit dem Spiel …';
    cfg.render();
    try {
      await guestConnect();
    } catch {
      G.active = false;
      S.screen = 'start';
      del('session');
      S.message = resume
        ? { tone: 'warn', text: 'Das Spiel läuft nicht mehr oder der Gastgeber ist nicht erreichbar.' }
        : { tone: 'warn', text: 'Dieses Spiel wurde nicht gefunden. Bitte prüfe den Code (4 Buchstaben). Vielleicht muss der Gastgeber zuerst sein Spiel eröffnen oder ist gerade nicht online.' };
      cfg.render();
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
        stateChanged();
      } else if (msg.t === 'denied') {
        G.active = false;
        leaveLocal();
        S.message = { tone: 'warn', text: msg.text };
        cfg.render();
      }
    });
    conn.on('close', () => { if (G.conn === conn) guestLost(); });
    conn.send({ t: 'hello', cid, name: S.name });
  }

  function guestLost() {
    if (!G.active || S.link === 'lost') return;
    S.link = 'lost';
    cfg.render();
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

  // ---------- gemeinsam ----------
  // Nur neu zeichnen, wenn sich wirklich etwas geändert hat (die Lebenszeichen alle paar Sekunden ändern nichts).
  let lastSig = '';
  let overCounted = false;
  function stateChanged() {
    if (S.screen === 'lobby' || S.screen === 'game') S.screen = S.game ? 'game' : 'lobby';
    const sig = JSON.stringify([S.screen, S.link, S.lobby, S.game]);
    if (sig === lastSig) return;
    lastSig = sig;
    // Ende einer Partie einmalig zählen (nur beim Gastgeber, damit nichts doppelt gezählt wird)
    const over = !!(S.game && (S.game.mode === 'over' || S.game.phase === 'over'));
    if (over && !overCounted && S.role === 'host') track('beendet/' + cfg.game);
    overCounted = over;
    cfg.onState();
  }

  function send(msg) {
    if (S.role === 'host') hostHandle(cid, msg);
    else if (S.link === 'ok') G.conn?.send(msg);
  }

  function leaveLocal() {
    G.active = false;
    clearInterval(G.watchdog); clearTimeout(G.retry); clearInterval(H.timer);
    try { G.conn?.close(); } catch { /* egal */ }
    try { H.handle?.close(); } catch { /* egal */ }
    for (const c of H.conns.values()) { try { c.close(); } catch { /* egal */ } }
    H.conns.clear(); H.handle = null; G.conn = null;
    del('session'); del('hostState');
    S.screen = 'start'; S.role = null; S.room = null; S.game = null; S.lobby = []; S.link = 'ok'; S.level = 0;
    clearTimeout(botTimer);
    lastSig = '';
    cfg.onLeave?.();
  }
  function leave() {
    if (S.role === 'guest') send({ t: 'leave' });
    leaveLocal();
  }
  function fail(text) {
    leaveLocal();
    S.message = { tone: 'warn', text };
    cfg.render();
  }

  async function wakeLock() { try { await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    wakeLock();
    if (S.role === 'guest' && G.active && S.link === 'ok' && Date.now() - G.lastMsg > 12000) {
      try { G.conn?.close(); } catch { /* egal */ }
      guestLost();
    }
  });

  // Seite wurde neu geladen oder aus Versehen geschlossen → automatisch zurück ins Spiel
  function boot() {
    const invited = Net.cleanCode(new URLSearchParams(location.search).get('raum'));
    const sess = get('session');
    const fresh = sess && Date.now() - sess.ts < SESSION_MAX_AGE;
    if (fresh && (!invited || invited === sess.room) && S.name) {
      if (sess.role === 'host' && sess.room === 'SOLO') {
        const hs = get('hostState');
        if (hs && hs.game) { startSolo(hs); return true; }
      } else if (sess.role === 'host') {
        const hs = get('hostState');
        if (hs && hs.room === sess.room) { startHosting(hs); return true; }
      } else {
        joinGame(sess.room, { resume: true });
        return true;
      }
    }
    return false;
  }

  return { S, cid, get, set, link, startHosting, startSolo, joinGame, hostStartGame, send, leave, boot, Net };
}
