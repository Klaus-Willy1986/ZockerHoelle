// Gemeinsame Oberfläche für alle Spiele: Startseite, Einladung, Lobby, Hilfe, Kopfzeile, Schriftgröße, Verlassen.
// Jedes Spiel liefert nur renderGame() (HTML des Spielfelds) und onAct() (spielspezifische Knöpfe).
import * as Net from './net.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUI(cfg) {
  // cfg: { sess, $app, title, icon, sub, minPlayers=2, helpTitle, helpBody (HTML), renderGame(), onAct(act, el, ev), backLink='../' }
  const { sess, $app } = cfg;
  const S = sess.S;
  const minPlayers = cfg.minPlayers || 2;
  S.ui = Object.assign({ helpOpen: false, big: sess.get('big', false) }, S.ui || {});

  const header = (extra = '') => `<header class="top"><div class="room">Spiel <b>${esc(S.room || '')}</b></div>
    <div class="topbtns">${extra}
      <button class="btn mini" data-act="bigger" aria-label="Schrift größer oder kleiner">A⁺ Schrift</button>
      <button class="btn mini" data-act="help">? Regeln</button>
      <button class="btn mini" data-act="leave">Verlassen</button>
    </div></header>`;

  const lost = () => (S.link === 'lost'
    ? `<div class="lostbar" role="alert">Die Verbindung ist kurz unterbrochen. Bitte nicht weggehen – wir verbinden dich automatisch wieder …</div>` : '');

  const startHtml = () => {
    const invited = Net.cleanCode(new URLSearchParams(location.search).get('raum'));
    const msg = S.message ? `<div class="notice ${S.message.tone}" role="alert">${esc(S.message.text)}</div>` : '';
    const nameField = `<label class="lbl" for="name">Wie heißt du?</label>
      <input id="name" class="input" type="text" maxlength="14" autocomplete="given-name" placeholder="Dein Vorname" value="${esc(S.name)}">`;
    if (invited.length === 4) {
      return `<div class="hero"><div class="logo">${cfg.icon}</div><h1>${esc(cfg.title)}</h1><p class="sub">Du wurdest zu einem Spiel eingeladen!</p></div>
        <section class="card">${msg}${nameField}
        <button class="btn primary huge" data-act="join-invited" data-code="${invited}">Mitspielen</button>
        <button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button></section>`;
    }
    return `<div class="hero"><div class="logo">${cfg.icon}</div><h1>${esc(cfg.title)}</h1><p class="sub">${esc(cfg.sub)}</p></div>
      <section class="card">${msg}${nameField}
        <button class="btn primary huge" data-act="host">🎲 Neues Spiel eröffnen</button>
        <p class="muted center">Du bekommst einen Einladungs-Link für deine Mitspieler.</p>
      </section>
      <section class="card"><h2>Du hast einen Code bekommen?</h2>
        <label class="lbl" for="code">Code (4 Buchstaben)</label>
        <input id="code" class="input code-in" type="text" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="z. B. KFRT">
        <button class="btn secondary huge" data-act="join-code">Spiel beitreten</button>
      </section>
      <section class="card"><button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button>
        <a class="btn ghost" href="${cfg.backLink || '../'}">← Zur Spielauswahl</a></section>`;
  };

  const lobbyHtml = () => {
    const isHost = S.role === 'host';
    const list = S.lobby.map((p, i) => `<li><span class="dot ${p.connected ? 'on' : ''}"></span>${esc(p.name)}${p.id === sess.cid ? ' (du)' : ''}${i === 0 ? ' – Gastgeber' : ''}</li>`).join('');
    const url = S.room ? sess.link() : '';
    const invite = isHost ? `
      <section class="card"><h2>1. Lade deine Mitspieler ein</h2>
        <p class="big">Dein Spiel-Code lautet:</p><div class="code" aria-label="Spiel-Code ${esc(S.room)}">${esc(S.room || '')}</div>
        <p class="muted">Am einfachsten: Schicke den Einladungs-Link. Wer darauf tippt, ist sofort im Spiel.</p>
        <a class="btn primary huge" href="https://wa.me/?text=${encodeURIComponent('Komm zu ' + cfg.title + '! Tippe hier, um mitzuspielen: ' + url)}" target="_blank" rel="noopener">Per WhatsApp einladen</a>
        <button class="btn secondary" data-act="copy">Einladungs-Link kopieren</button>
        ${navigator.share ? `<button class="btn secondary" data-act="share">Anders teilen (E-Mail, SMS …)</button>` : ''}
        <p class="muted small">Oder: Auf <b>${esc(location.host + location.pathname)}</b> den Code <b>${esc(S.room)}</b> eingeben.</p>
      </section>` : '';
    const ready = S.lobby.filter((p) => p.connected).length >= minPlayers;
    const start = isHost
      ? `<section class="card"><h2>2. Los geht’s</h2>${ready
        ? `<button class="btn primary huge" data-act="start">▶ Spiel starten</button>`
        : `<p class="big">Sobald ${minPlayers === 2 ? 'eine weitere Person' : 'genug Mitspieler'} da ${minPlayers === 2 ? 'ist' : 'sind'}, kannst du starten.</p>`}</section>`
      : `<section class="card"><p class="big center">Du bist dabei! 🎉<br>Bitte einen Moment warten, bis der Gastgeber das Spiel startet.</p></section>`;
    return `${header()}${lost()}${invite}
      <section class="card"><h2>Wer ist schon da?</h2><ul class="players">${list}</ul></section>${start}`;
  };

  const helpHtml = () => `<div class="overlay" data-act="help-close"><div class="modal" role="dialog" aria-modal="true" aria-label="Spielregeln" onclick="event.stopPropagation()">
    <h2>${esc(cfg.helpTitle || 'Die Spielregeln')}</h2>${cfg.helpBody}
    <button class="btn primary huge" data-act="help-close">Alles klar, schließen</button></div></div>`;

  function render() {
    document.documentElement.classList.toggle('big', !!S.ui.big);
    let html = '';
    if (S.screen === 'start') html = startHtml();
    else if (S.screen === 'connecting') html = `<div class="hero"><div class="logo spin">🎲</div><h1>Einen Moment …</h1><p class="sub">${esc(S.connectText || '')}</p>
        <button class="btn ghost" data-act="leave-now">Abbrechen</button></div>`;
    else if (S.screen === 'lobby') html = lobbyHtml();
    else if (S.screen === 'game' && S.game) html = cfg.renderGame();
    $app.innerHTML = html + (S.ui.helpOpen ? helpHtml() : '');
  }

  function needName() {
    const el = document.getElementById('name');
    const n = (el ? el.value : S.name).trim().slice(0, 14);
    if (!n) {
      S.message = { tone: 'warn', text: 'Bitte trage zuerst deinen Vornamen ein.' };
      render();
      document.getElementById('name')?.focus();
      return null;
    }
    S.name = n; sess.set('name', n);
    return n;
  }

  function wire() {
    $app.addEventListener('click', async (ev) => {
      const el = ev.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const act = el.dataset.act;
      switch (act) {
        case 'host':
          if (!needName()) return;
          S.message = null;
          return sess.startHosting(null);
        case 'join-code': {
          if (!needName()) return;
          const code = Net.cleanCode(document.getElementById('code')?.value);
          if (code.length !== 4) { S.message = { tone: 'warn', text: 'Der Code besteht aus 4 Buchstaben.' }; render(); return; }
          S.message = null;
          return sess.joinGame(code);
        }
        case 'join-invited':
          if (!needName()) return;
          S.message = null;
          return sess.joinGame(el.dataset.code);
        case 'start': case 'again': return sess.hostStartGame();
        case 'help': S.ui.helpOpen = true; return render();
        case 'help-close': S.ui.helpOpen = false; return render();
        case 'bigger': S.ui.big = !S.ui.big; sess.set('big', S.ui.big); return render();
        case 'leave':
          if (confirm(S.role === 'host' ? 'Das Spiel wirklich beenden? Für alle Mitspieler endet es dann.' : 'Das Spiel wirklich verlassen?')) { sess.leave(); render(); }
          return;
        case 'leave-now': sess.leave(); render(); return;
        case 'copy':
          try { await navigator.clipboard.writeText(sess.link()); el.textContent = '✔ Link kopiert!'; }
          catch { prompt('Diesen Link bitte kopieren und verschicken:', sess.link()); }
          return;
        case 'share':
          try { await navigator.share({ title: cfg.title, text: 'Komm zu ' + cfg.title + '! Tippe hier, um mitzuspielen:', url: sess.link() }); } catch { /* abgebrochen */ }
          return;
        default:
          return cfg.onAct && cfg.onAct(act, el, ev);
      }
    });
    $app.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      if (ev.target.id === 'code') $app.querySelector('[data-act="join-code"]')?.click();
      else if (ev.target.id === 'name') ($app.querySelector('[data-act="join-invited"]') || $app.querySelector('[data-act="host"]'))?.click();
    });
    $app.addEventListener('input', (ev) => { if (ev.target.id === 'code') ev.target.value = Net.cleanCode(ev.target.value); });
  }

  function boot() {
    if (!window.Peer && !Net.isMock()) {
      $app.innerHTML = '<div class="notice warn">Die Spielbibliothek konnte nicht geladen werden. Bitte lade die Seite neu.</div>';
      return;
    }
    wire();
    if (!sess.boot()) render();
  }

  return { render, header, lost, boot, esc, S };
}
