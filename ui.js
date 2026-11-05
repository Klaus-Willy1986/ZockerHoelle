// Gemeinsame Oberfläche für alle Spiele: Startseite, Einladung, Lobby, Hilfe, Kopfzeile, Schriftgröße, Verlassen.
// Jedes Spiel liefert nur renderGame() (HTML des Spielfelds) und onAct() (spielspezifische Knöpfe).
import * as Net from './net.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUI(cfg) {
  // cfg: { sess, $app, title, icon, sub, minPlayers=2, helpTitle, helpBody (HTML), renderGame(), onAct(act, el, ev), backLink='../' }
  const { sess, $app } = cfg;
  const S = sess.S;
  const minPlayers = cfg.minPlayers || 2;
  if (sess.setOptionDefs) sess.setOptionDefs(cfg.options);
  S.ui = Object.assign({ helpOpen: false }, S.ui || {});
  // Einstellungen des Geräts (Schrift, Ansagen) liegen außerhalb von S.ui, damit sie beim Verlassen/Neustart nicht verloren gehen
  const prefs = { big: !!sess.get('big', false), speak: false };

  // ---------- Vorlesen (Sprachausgabe des Browsers) ----------
  const speechOk = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  prefs.speak = speechOk && !!sess.get('speak', false);
  let lastSpoken = '';
  const clean = (t) => String(t).replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
  function say(text, { queue = false } = {}) {
    if (!speechOk || !text) return;
    const synth = window.speechSynthesis;
    if (!queue) synth.cancel();
    const voice = (synth.getVoices() || []).find((v) => /^de/i.test(v.lang));
    for (const part of clean(text).match(/[^.!?:]+[.!?:]?/g) || []) {
      if (!part.trim()) continue;
      const ut = new SpeechSynthesisUtterance(part.trim());
      ut.lang = 'de-DE'; ut.rate = 0.95;
      if (voice) ut.voice = voice;
      synth.speak(ut);
    }
  }
  const stopSpeech = () => { if (speechOk) window.speechSynthesis.cancel(); };
  function helpText() {
    const d = document.createElement('div');
    d.innerHTML = cfg.helpBody;
    d.querySelectorAll('h3').forEach((h) => { h.textContent = h.textContent + '.'; });
    d.querySelectorAll('li').forEach((li) => { li.textContent = li.textContent.trim().replace(/([^.!?:])$/, '$1.'); });
    return (cfg.helpTitle || 'Die Spielregeln') + '. ' + d.textContent;
  }
  function announce() {
    if (!prefs.speak || S.ui.helpOpen || S.ui.rolling || S.screen !== 'game' || (S.learn && coachNow)) return;
    const banner = $app.querySelector('.banner');
    const hint = $app.querySelector('.action p.big, .action .big, .action h2');
    const text = clean([banner && banner.innerText, hint && hint.innerText].filter(Boolean).join('. '));
    if (!text || text === lastSpoken) return;
    lastSpoken = text;
    say(text);
  }

  const header = (extra = '') => `<header class="top"><div class="room">${S.room === 'SOLO' ? `<b>${S.lobby.some((p) => p.bot) ? 'Gegen den Computer' : 'Allein spielen'}</b>` : `Spiel <b>${esc(S.room || '')}</b>`}</div>
    <div class="topbtns">${extra}
      ${speechOk ? `<button class="btn mini" data-act="speak-toggle" aria-pressed="${prefs.speak ? 'true' : 'false'}">🔊 Ansagen: ${prefs.speak ? 'an' : 'aus'}</button>` : ''}
      <button class="btn mini" data-act="bigger" aria-label="Schrift größer oder kleiner">A⁺ Schrift</button>
      <button class="btn mini" data-act="help">? Regeln</button>
      <button class="btn mini" data-act="leave">Verlassen</button>
    </div></header>`;

  // Regel-Optionen (Kästchen zum Ankreuzen), z. B. cfg.options = [{ id: 'ace', label: '…', def: false }]
  const optionsHtml = () => {
    if (!cfg.options || !cfg.options.length) return '';
    const cur = sess.getOpts();
    return `<section class="card optcard"><h2>Spielregeln einstellen</h2>${cfg.options.map((d) => `<label class="opt"><input type="checkbox" data-opt="${esc(d.id)}" ${cur[d.id] ? 'checked' : ''}><span>${esc(d.label)}${d.help ? `<small>${esc(d.help)}</small>` : ''}</span></label>`).join('')}</section>`;
  };

  const lost = () => (S.link === 'lost'
    ? `<div class="lostbar" role="alert">Die Verbindung ist kurz unterbrochen. Bitte nicht weggehen – wir verbinden dich automatisch wieder …</div>` : '');

  const startHtml = () => {
    const invited = Net.cleanCode(new URLSearchParams(location.search).get('raum'));
    const msg = S.message ? `<div class="notice ${S.message.tone}" role="alert">${esc(S.message.text)}</div>` : '';
    const nameField = `<label class="lbl" for="name">Wie heißt du?</label>
      <input id="name" class="input" type="text" maxlength="14" autocomplete="given-name" placeholder="Dein Vorname" value="${esc(S.name)}">`;
    if (cfg.soloOnly) {
      return `<div class="hero"><div class="logo">${cfg.icon}</div><h1>${esc(cfg.title)}</h1><p class="sub">${esc(cfg.sub)}</p></div>
        <section class="card">${msg}
          <button class="btn primary huge" data-act="solo">▶ Spielen</button>
        </section>
        ${cfg.tutorial ? `<section class="card coachcard"><h2>🎓 Neu hier? Lernrunde</h2>
          <p class="muted">Eine Übungsrunde, in der dir das Spiel Schritt für Schritt zeigt, was zu tun ist – ohne Lesen, auf Wunsch mit Vorlesen.</p>
          <button class="btn primary huge" data-act="learn">🎓 Lernrunde starten</button></section>` : ''}
        <section class="card"><button class="btn ghost" data-act="help">Wie funktioniert das Spiel?</button>
          <a class="btn ghost" href="${cfg.backLink || '../'}">← Zur Spielauswahl</a></section>`;
    }
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
      ${cfg.solo ? `<section class="card"><h2>Lieber allein spielen?</h2>
        <p class="muted">Kein Einladungs-Link nötig. ${esc(cfg.soloText || 'Du spielst für dich und kannst deine Bestleistung verbessern.')}</p>
        <button class="btn secondary huge" data-act="solo">🙋 Allein spielen</button></section>` : ''}
      ${optionsHtml()}
      ${cfg.tutorial ? `<section class="card coachcard"><h2>🎓 Neu hier? Lernrunde</h2>
        <p class="muted">Eine Übungsrunde, in der dir das Spiel Schritt für Schritt zeigt, was zu tun ist – ohne Lesen, auf Wunsch mit Vorlesen.</p>
        <button class="btn primary huge" data-act="learn">🎓 Lernrunde starten</button></section>` : ''}
      ${cfg.bots ? `<section class="card"><h2>Lieber gegen den Computer?</h2>
        <p class="muted">Kein Einladungs-Link nötig. Der Computer spielt direkt auf diesem Gerät mit.</p>
        ${cfg.bots.map((n) => (cfg.levels || ['']).map((lv, i) => `<button class="btn secondary huge" data-act="bot" data-n="${n}" data-level="${i}">🤖 Gegen ${n === 1 ? 'den Computer' : n + ' Computer'}${lv ? ' (' + esc(lv) + ')' : ''}</button>`).join('')).join('')}
      </section>` : ''}
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
    const optBox = isHost ? optionsHtml() : '';
    const ready = S.lobby.filter((p) => p.connected).length >= minPlayers;
    const start = isHost
      ? `<section class="card"><h2>2. Los geht’s</h2>${ready
        ? `<button class="btn primary huge" data-act="start">▶ Spiel starten</button>`
        : `<p class="big">Sobald ${minPlayers === 2 ? 'eine weitere Person' : 'genug Mitspieler'} da ${minPlayers === 2 ? 'ist' : 'sind'}, kannst du starten.</p>`}</section>`
      : `<section class="card"><p class="big center">Du bist dabei! 🎉<br>Bitte einen Moment warten, bis der Gastgeber das Spiel startet.</p></section>`;
    return `${header()}${lost()}${invite}
      <section class="card"><h2>Wer ist schon da?</h2><ul class="players">${list}</ul></section>${optBox}${start}`;
  };

  const helpHtml = () => `<div class="overlay" data-act="help-close"><div class="modal" role="dialog" aria-modal="true" aria-label="Spielregeln">
    <h2>${esc(cfg.helpTitle || 'Die Spielregeln')}</h2>
    ${speechOk ? `<div class="readrow"><button class="btn secondary" data-act="help-read">🔊 Regeln vorlesen</button><button class="btn ghost" data-act="help-stop">⏹ Stopp</button></div>
    <p class="muted small">Tipp: Wenn du nicht lesen magst, tippe auf „Regeln vorlesen“ und höre zu.</p>` : ''}
    ${cfg.helpBody}
    <button class="btn primary huge" data-act="help-close">Alles klar, schließen</button></div></div>`;

  // ---------- Lernrunde: Anleitung oben im Spiel ----------
  let lastCoach = '';
  let coachNow = null;
  function coachHtml() {
    coachNow = null;
    if (!S.learn || !cfg.tutorial || !S.game) return '';
    coachNow = cfg.tutorial.coach(S.game, { id: sess.cid, S, ui: S.ui });
    const text = coachNow && coachNow.text ? esc(coachNow.text) : 'Weiter geht’s – du machst das schon!';
    return `<div class="coach" role="status"><div class="coach-t">🎓 <span>${text}</span></div>
      <button class="btn mini" data-act="learn-stop">Lernrunde beenden</button></div>`;
  }
  function coachAfterRender() {
    if (!coachNow) return;
    if (coachNow.target) { try { $app.querySelectorAll(coachNow.target).forEach((n, i) => { if (i < 60) n.classList.add('coach-target'); }); } catch { /* ungültiger Selektor */ } }
    if (prefs.speak && !S.ui.helpOpen && coachNow.text && coachNow.text !== lastCoach) { lastCoach = coachNow.text; say(coachNow.text); }
  }

  // ---------- Konfetti beim Sieg ----------
  let celebrated = false;
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas');
    cv.className = 'confetti'; cv.setAttribute('aria-hidden', 'true');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(window.innerWidth * dpr); cv.height = Math.round(window.innerHeight * dpr);
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    if (!ctx) { cv.remove(); return; }
    const colors = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00'];
    const parts = Array.from({ length: 140 }, () => ({
      x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.4, w: (6 + Math.random() * 8) * dpr, h: (8 + Math.random() * 10) * dpr,
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2.2 + Math.random() * 3.2) * dpr, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    (function frame(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - t / 3600);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t < 3600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  // Feiern, wenn der Siegerbildschirm erscheint und du gewonnen hast (oder allein ein Rätsel/Ziel geschafft hast)
  function maybeCelebrate() {
    const tro = $app.querySelector('.trophy');
    if (!tro) { celebrated = false; return; }
    if (celebrated) return;
    window.scrollTo(0, 0); // Ergebnis steht oben: dorthin springen
    const trophy = tro.textContent || '';
    const head = ($app.querySelector('.over h1, h1') || {}).textContent || '';
    const mine = /(^|\s)Du\s|Glückwunsch|Geschafft|Bestleistung|Punkte!/.test(head) || (S.name && head.includes(S.name + ' hat'));
    if (/🏆/.test(trophy) && mine) { celebrated = true; confetti(); } else { celebrated = true; }
  }

  // ---------- Spielfeld an fester Stelle halten ----------
  // Über dem Spielfeld erscheinen und verschwinden Texte und Knöpfe. Damit das Feld nicht auf und ab springt,
  // merken wir uns, wie weit unten es schon war, und füllen den Platz bei weniger Text mit einer Lücke auf.
  const STABLE = '#board, .lu-board, .mh-board, .bk-scroll, .fw-wrap, #dice, .pz-sheet';
  const stab = { key: '', tops: {} };
  function stabilize() {
    const key = `${window.innerWidth}|${prefs.big ? 1 : 0}|${S.screen}|${S.game ? S.game.players.length : 0}`;
    if (stab.key !== key) { stab.key = key; stab.tops = {}; }
    $app.querySelectorAll(STABLE).forEach((el) => {
      const id = el.id || String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ')[0];
      const top = el.getBoundingClientRect().top + window.scrollY;
      const max = Math.max(stab.tops[id] || 0, top);
      stab.tops[id] = max;
      const gap = Math.round(max - top);
      if (gap > 1 && el.parentNode) {
        const sp = document.createElement('div');
        sp.className = 'stable-gap'; sp.setAttribute('aria-hidden', 'true'); sp.style.height = gap + 'px';
        el.parentNode.insertBefore(sp, el);
      }
    });
  }

  let lastScreenSeen = '';
  function render() {
    document.documentElement.classList.toggle('big', !!prefs.big);
    let html = '';
    if (S.screen === 'start') html = startHtml();
    else if (S.screen === 'connecting') html = `<div class="hero"><div class="logo spin">🎲</div><h1>Einen Moment …</h1><p class="sub">${esc(S.connectText || '')}</p>
        <button class="btn ghost" data-act="leave-now">Abbrechen</button></div>`;
    else if (S.screen === 'lobby') html = lobbyHtml();
    else if (S.screen === 'game' && S.game) html = coachHtml() + cfg.renderGame();
    // Beim Wechsel des Bildschirms (Start → Lobby → Spiel) wieder ganz nach oben
    if (lastScreenSeen !== S.screen) { lastScreenSeen = S.screen; window.scrollTo(0, 0); }
    const ov = $app.querySelector('.overlay');
    const ovTop = ov ? ov.scrollTop : 0;
    $app.innerHTML = html + (S.ui.helpOpen ? helpHtml() : '');
    if (ovTop) { const n = $app.querySelector('.overlay'); if (n) n.scrollTop = ovTop; }
    if (S.screen === 'game') {
      // Statuszeilen: Inhalt in einen Block fassen, damit sie gleich hoch bleiben und mittig stehen
      $app.querySelectorAll('.banner').forEach((b) => { if (!(b.firstElementChild && b.firstElementChild.classList.contains('banner-in'))) b.innerHTML = `<span class="banner-in">${b.innerHTML}</span>`; });
      stabilize();
    }
    document.documentElement.style.setProperty('--sticky-top', coachNow ? '10.4rem' : '0px');
    maybeCelebrate();
    coachAfterRender();
    announce();
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
        case 'solo':
          if (cfg.soloOnly) { if (!S.name) S.name = 'Du'; sess.set('name', S.name); } else if (!needName()) return;
          S.message = null;
          return sess.startSolo();
        case 'learn':
          if (cfg.soloOnly) { if (!S.name) S.name = 'Du'; sess.set('name', S.name); } else if (!needName()) return;
          S.message = null;
          prefs.speak = speechOk;
          lastSpoken = ''; lastCoach = '';
          return sess.startSolo(null, { bots: cfg.tutorial.bots === undefined ? 1 : cfg.tutorial.bots, level: 0, learn: true });
        case 'learn-stop': sess.setLearn(false); lastCoach = ''; return;
        case 'bot':
          if (!needName()) return;
          S.message = null;
          return sess.startSolo(null, { bots: Number(el.dataset.n) || 1, level: Number(el.dataset.level) || 0 });
        case 'start': case 'again': return sess.hostStartGame();
        case 'help': S.ui.helpOpen = true; return render();
        case 'help-read': return say(helpText());
        case 'help-stop': return stopSpeech();
        case 'speak-toggle':
          prefs.speak = !prefs.speak;
          sess.set('speak', prefs.speak);
          lastSpoken = '';
          if (!prefs.speak) stopSpeech();
          else say('Ansagen sind jetzt eingeschaltet.', { queue: false });
          return render();
        case 'help-close':
          if (el.classList.contains('overlay') && ev.target !== el) return; // Klick ins Fenster schließt nicht
          stopSpeech();
          S.ui.helpOpen = false; return render();
        case 'bigger': prefs.big = !prefs.big; sess.set('big', prefs.big); return render();
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
    $app.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t && t.dataset && t.dataset.opt) sess.setOpt(t.dataset.opt, t.checked);
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
