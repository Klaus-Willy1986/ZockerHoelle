// Netzwerk-Schicht: Ein Gerät ist "Gastgeber", die anderen verbinden sich direkt (WebRTC über PeerJS).
// Es wird kein eigener Server und kein Konto benötigt.
// Mit ?mock=1 in der Adresse wird stattdessen ein Test-Modus (BroadcastChannel, nur im selben Browser) genutzt.

let GAME = 'spiel';
export const configure = (game) => { GAME = game; };
const prefix = () => 'zockerhoelle-' + GAME + '-';
const ICE = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      // Öffentlicher Ersatz-Relay für schwierige Netzwerke (Handynetz, Firmennetz …)
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
};

// Gut lesbare Raum-Codes ohne verwechselbare Zeichen (kein I, L, O, 0, 1)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export function newRoomCode() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join('');
}
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

export const isMock = () => new URLSearchParams(location.search).has('mock');

// ---------- PeerJS ----------
function peerHost(code, handlers) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(prefix() + code, { ...ICE, debug: 0 });
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({
        close: () => peer.destroy(),
      });
    });
    peer.on('connection', (conn) => {
      const wrapped = wrapPeerConn(conn);
      conn.on('open', () => handlers.onConnection(wrapped));
    });
    peer.on('disconnected', () => {
      // Verbindung zum Vermittlungsserver verloren – bestehende Spieler bleiben verbunden, wir melden uns neu an.
      setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch { /* ignorieren */ } }, 1500);
    });
    peer.on('error', (err) => {
      if (!opened) reject(err);
      else if (handlers.onError) handlers.onError(err);
    });
  });
}

function wrapPeerConn(conn) {
  const listeners = { data: [], close: [] };
  conn.on('data', (d) => listeners.data.forEach((f) => f(d)));
  const closed = () => listeners.close.forEach((f) => f());
  conn.on('close', closed);
  conn.on('error', closed);
  return {
    send: (m) => { try { conn.send(m); } catch { /* Verbindung weg */ } },
    on: (ev, f) => listeners[ev].push(f),
    close: () => { try { conn.close(); } catch { /* egal */ } },
  };
}

function peerJoin(code, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(undefined, { ...ICE, debug: 0 });
    let done = false;
    const fail = (e) => { if (done) return; done = true; try { peer.destroy(); } catch { /* egal */ } reject(e); };
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    peer.on('error', (e) => { clearTimeout(timer); fail(e); });
    peer.on('open', () => {
      const conn = peer.connect(prefix() + code, { reliable: true });
      const wrapped = wrapPeerConn(conn);
      conn.on('open', () => {
        if (done) return;
        done = true; clearTimeout(timer);
        const origClose = wrapped.close;
        wrapped.close = () => { origClose(); try { peer.destroy(); } catch { /* egal */ } };
        wrapped.on('close', () => { try { peer.destroy(); } catch { /* egal */ } });
        resolve(wrapped);
      });
    });
  });
}

// ---------- Test-Modus (BroadcastChannel) ----------
function mockHost(code, handlers) {
  const ch = new BroadcastChannel('mock-' + prefix() + code);
  const conns = new Map();
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (m.to !== 'host') return;
    if (m.kind === 'join') {
      const l = { data: [], close: [] };
      const conn = {
        send: (d) => ch.postMessage({ to: m.from, kind: 'data', d: JSON.parse(JSON.stringify(d)) }),
        on: (e, f) => l[e].push(f),
        close: () => {},
        _l: l,
      };
      conns.set(m.from, conn);
      ch.postMessage({ to: m.from, kind: 'accepted' });
      handlers.onConnection(conn);
    } else if (m.kind === 'data') {
      conns.get(m.from)?._l.data.forEach((f) => f(m.d));
    } else if (m.kind === 'bye') {
      conns.get(m.from)?._l.close.forEach((f) => f());
      conns.delete(m.from);
    }
  };
  return Promise.resolve({ close: () => ch.close() });
}

function mockJoin(code) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const ch = new BroadcastChannel('mock-' + prefix() + code);
    const l = { data: [], close: [] };
    const conn = {
      send: (d) => ch.postMessage({ to: 'host', from: id, kind: 'data', d: JSON.parse(JSON.stringify(d)) }),
      on: (e, f) => l[e].push(f),
      close: () => { ch.postMessage({ to: 'host', from: id, kind: 'bye' }); ch.close(); },
    };
    const timer = setTimeout(() => { ch.close(); reject(new Error('timeout')); }, 2500);
    ch.onmessage = (ev) => {
      const m = ev.data;
      if (m.to !== id) return;
      if (m.kind === 'accepted') { clearTimeout(timer); resolve(conn); }
      else if (m.kind === 'data') l.data.forEach((f) => f(m.d));
    };
    ch.postMessage({ to: 'host', from: id, kind: 'join' });
    window.addEventListener('pagehide', () => ch.postMessage({ to: 'host', from: id, kind: 'bye' }));
  });
}

export const host = (code, handlers) => (isMock() ? mockHost(code, handlers) : peerHost(code, handlers));
export const join = (code) => (isMock() ? mockJoin(code) : peerJoin(code));
