import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, delayFor } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');

// Die Einstellungen der Startseite sind Kästchen (ui.js).
const OPTIONS = [
  { id: 'two', label: 'Zwei Karten pro Person', help: 'Jede Person spielt mit 2 Karten. Eine davon reicht zum Gewinnen. Ohne Haken: eine Karte.', def: false },
  { id: 'auto', label: 'Automatisch markieren', help: 'Gezogene Zahlen werden auf deiner Karte von selbst markiert. Ohne Haken tippst du jede Zahl selbst an.', def: false },
  { id: 'full', label: 'Volles Haus statt Reihe', help: 'Gewonnen hat, wer die ganze Karte markiert hat. Ohne Haken genügt eine Reihe, Spalte oder Diagonale.', def: false },
  { id: 'timer', label: 'Zahlen kommen automatisch (alle 8 Sekunden)', help: 'Der Gastgeber muss nicht auf „Nächste Zahl“ tippen. Ohne Haken wird jede Zahl per Knopf gezogen.', def: false },
];
const engineOpts = (o) => ({ two: !!o.two, auto: !!o.auto, full: !!o.full, timer: !!o.timer });

// ?seed=123 in der Adresse: feste Zahlenfolge und Karten (für Tests). Sonst Zufall.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedParam = new URLSearchParams(location.search).get('seed');
const rng = seedParam !== null && /^\d+$/.test(seedParam) ? seededRng(Number(seedParam)) : Math.random;

const freshUi = () => ({ hint: '', hintKey: '', sig: '' });
const timers = { draw: null, drawKey: '', bots: new Set() };
function clearTimers() { clearTimeout(timers.draw); timers.draw = null; timers.drawKey = ''; timers.bots.clear(); }

const sess = createSession({
  game: 'bg',
  maxPlayers: E.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, o) => {
    S.ui = { ...freshUi(), ...(S.ui && S.ui.helpOpen ? { helpOpen: true } : {}), ...(S.ui && S.ui.listOpen ? { listOpen: true } : {}) };
    clearTimers();
    const eo = S.learn ? { two: false, auto: false, full: false, timer: false } : engineOpts(o || {});
    return E.createGame(players, { ...eo, host: sess.cid }, rng);
  },
  onMessage: (state, pid, msg) => {
    // Der Gastgeber lässt die Computer-Mitspieler markieren und rufen (nur im Alleinspiel)
    if (msg && msg.t === 'as') {
      if (S.room === 'SOLO' && pid === state.host && E.isBotId(msg.id) && msg.msg && typeof msg.msg === 'object') E.handle(state, msg.id, msg.msg, Math.random);
      return;
    }
    E.handle(state, pid, msg, rng);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); clearTimers(); },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const key = `${g.gid}|${g.round}|${g.drawn.length}`;
    if (S.ui.hintKey !== key) { S.ui.hintKey = key; S.ui.hint = ''; }
    if (S.role === 'host') arm(g);
  }
  render();
}

// Gastgeber: Zeitgeber für Zahlen und Computer (nur Zeitsteuerung, die Regeln stehen in engine.js)
function arm(g) {
  if (g.phase !== 'play') { clearTimeout(timers.draw); timers.drawKey = ''; return; }
  const dk = `${g.gid}|${g.round}|${g.drawn.length}`;
  if (g.timer && g.drawn.length < E.TOTAL && timers.drawKey !== dk) {
    clearTimeout(timers.draw);
    timers.drawKey = dk;
    timers.draw = setTimeout(() => {
      const cur = S.game;
      if (cur && cur.gid === g.gid && cur.round === g.round && cur.phase === 'play' && cur.drawn.length === g.drawn.length) sess.send({ t: 'draw' });
    }, E.TIMER_MS);
  }
  if (S.room !== 'SOLO') return;
  for (const p of g.players) {
    if (!E.isBotId(p.id)) continue;
    const a = chooseAction(g, p.id, S.level || 0, Math.random);
    if (!a) continue;
    const k = `${dk}|${p.id}|${a.t}|${a.c}|${a.i}`;
    if (timers.bots.has(k)) continue;
    timers.bots.add(k);
    setTimeout(() => {
      timers.bots.delete(k);
      const cur = S.game;
      if (!cur || cur.gid !== g.gid || cur.round !== g.round || cur.phase !== 'play' || S.room !== 'SOLO') return;
      const msg = chooseAction(cur, p.id, S.level || 0, Math.random);
      if (msg) sess.send({ t: 'as', id: p.id, msg });
    }, delayFor(a, Math.random));
  }
}

// ====================== Hilfen ======================
const me = (g) => g.players.find((p) => p.id === cid);
const nameOf = (p) => (E.isBotId(p.id) ? (p.name === 'Computer' ? 'Der Computer' : p.name) : p.name);
const plural = (n, one, many) => (n === 1 ? `${n} ${one}` : `${n} ${many}`);
const fehlt = (n) => (n === 1 ? '1 Feld fehlt' : `${n} Felder fehlen`);
const isHost = (g) => g.host === cid;
const isSolo = (g) => g.players.length === 1;

// Vorlesen (eigene kleine Funktion: ui.js reicht seine Sprachausgabe nicht nach außen)
const speechOk = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
function speak(text) {
  if (!speechOk) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = (synth.getVoices() || []).find((v) => /^de/i.test(v.lang));
  const clean = String(text).replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
  for (const part of clean.match(/[^.!?:]+[.!?:]?/g) || []) {
    if (!part.trim()) continue;
    const ut = new SpeechSynthesisUtterance(part.trim());
    ut.lang = 'de-DE'; ut.rate = 0.95;
    if (voice) ut.voice = voice;
    synth.speak(ut);
  }
}

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.phase === 'over') {
    const ws = g.winners.map((id) => g.players.find((p) => p.id === id)).filter(Boolean);
    const names = ws.map((p) => (p.id === cid ? 'Du' : esc(nameOf(p))));
    if (names.length === 1) return `<div class="banner done">BINGO! ${names[0] === 'Du' ? 'Du hast' : names[0] + ' hat'} gewonnen</div>`;
    return `<div class="banner done">BINGO! ${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} gewinnen</div>`;
  }
  const n = E.lastDrawn(g);
  if (n === null) return `<div class="banner">Los geht’s! Gleich kommt die erste Zahl</div>`;
  return `<div class="banner">Neue Zahl: ${E.label(n)}</div>`;
}

function ballHtml(n) {
  if (n === null) return '<div class="bg-ball empty" role="img" aria-label="Noch keine Zahl gezogen"><b>?</b></div>';
  const ci = 'BINGO'.indexOf(E.letterOf(n));
  return `<div class="bg-ball c${ci}" role="img" aria-label="Gezogene Zahl ${esc(E.label(n))}" data-n="${n}"><small>${E.letterOf(n)}</small><b>${n}</b></div>`;
}

function drawHtml(g) {
  if (g.phase === 'over') return overHtml(g);
  const n = E.lastDrawn(g);
  const prev = g.drawn.slice(0, -1).slice(-5).reverse();
  const chips = Array.from({ length: 5 }, (_, k) => (k < prev.length
    ? `<li class="bg-chip c${'BINGO'.indexOf(E.letterOf(prev[k]))}"><small>${E.letterOf(prev[k])}</small>${prev[k]}</li>` : '<li class="bg-chip none" aria-hidden="true">·</li>')).join('');
  const read = speechOk
    ? `<button class="btn secondary bg-read" data-act="read"${n === null ? ' disabled' : ''}>🔊 Zahl nochmal vorlesen</button>` : '<span></span>';
  return `<section class="card bg-draw">${ballHtml(n)}<div class="bg-side"><ul class="bg-chips" aria-label="Die fünf Zahlen davor">${chips}</ul>${read}</div></section>`;
}

function cardHtml(g, c) {
  const card = g.cards[cid][c];
  const marks = g.marks[cid][c];
  const wins = g.phase === 'over' && g.winners.includes(cid) ? new Set(E.winLines(marks, g.full).flat()) : new Set();
  const head = [...E.LETTERS].map((l, k) => `<span class="bg-h c${k}" aria-hidden="true">${l}</span>`).join('');
  const cells = card.map((v, i) => {
    if (i === E.FREE) return `<button class="bg-cell on free${wins.has(i) ? ' win' : ''}" data-act="cell" data-c="${c}" data-i="${i}" aria-label="Mittelfeld, frei, markiert"><span class="bg-star">★</span><small>frei</small></button>`;
    const on = marks[i] === 1;
    return `<button class="bg-cell${on ? ' on' : ''}${wins.has(i) ? ' win' : ''}" data-act="cell" data-c="${c}" data-i="${i}" data-n="${v}" aria-label="${esc(E.label(v))}${on ? ', markiert' : ''}" aria-pressed="${on ? 'true' : 'false'}">${v}</button>`;
  }).join('');
  return `<div class="bg-card" data-c="${c}">${g.cards[cid].length > 1 ? `<p class="bg-cardno">Karte ${c + 1}</p>` : ''}<div class="bg-head">${head}</div><div class="bg-grid">${cells}</div></div>`;
}

function boardHtml(g) {
  const p = me(g);
  if (!p) return '<section id="board" class="card bg-boardcard"><p class="center">Du schaust nur zu.</p></section>';
  return `<section id="board" class="card bg-boardcard" aria-label="Deine Bingo-Karte">${g.cards[cid].map((_, c) => cardHtml(g, c)).join('')}</section>`;
}

let soloKey = ''; let soloInfo = null;
const variant = (g) => `${g.full ? 'haus' : 'reihe'}${g.two ? '2' : '1'}`;
function soloResult(g) {
  const key = `${g.gid}|${g.round}`;
  if (soloKey !== key) {
    soloKey = key;
    const k = 'bg_best_' + variant(g);
    const prev = sess.get(k, null);
    const won = g.winners.includes(cid);
    const n = g.drawn.length;
    const record = won && !S.learn && (prev === null || n < prev);
    soloInfo = { n, prev, record, won };
    if (record) sess.set(k, n);
  }
  return soloInfo;
}

function overHtml(g) {
  const won = g.winners.includes(cid);
  const ws = g.winners.map((id) => g.players.find((p) => p.id === id)).filter(Boolean);
  let title; let sub;
  if (isSolo(g)) {
    const r = soloResult(g);
    title = won ? 'Du hast BINGO! Glückwunsch!' : 'Die Runde ist zu Ende.';
    sub = won ? (r.record ? `Neue Bestleistung: ${plural(r.n, 'Zahl', 'Zahlen')}! 🎉` : `Bingo nach ${plural(r.n, 'Zahl', 'Zahlen')}. Bestleistung: ${r.prev}`) : '';
  } else if (won) {
    const others = ws.filter((p) => p.id !== cid).map((p) => esc(nameOf(p)));
    title = others.length ? `Du hast gewonnen – zusammen mit ${others.join(' und ')}!` : 'Du hast gewonnen! BINGO!';
    sub = `Nach ${plural(g.drawn.length, 'Zahl', 'Zahlen')}. Einen Siegpunkt für dich.`;
  } else {
    title = ws.length === 1 ? `${esc(nameOf(ws[0]))} hat gewonnen!` : `${ws.map((p) => esc(nameOf(p))).join(' und ')} haben gewonnen!`;
    sub = `Nach ${plural(g.drawn.length, 'Zahl', 'Zahlen')}. Beim nächsten Mal klappt es.`;
  }
  return `<section class="card over bg-draw bg-over"><div class="trophy">${won ? '🏆' : '👏'}</div><div class="bg-overtxt"><h1>${title}</h1><p class="bg-oversub">${sub}</p></div></section>`;
}

function actionHtml(g) {
  const host = isHost(g);
  const solo = isSolo(g);
  let text; let btns = '';
  if (g.phase === 'over') {
    text = host ? 'Bereit für die nächste Runde?' : 'Der Gastgeber startet gleich die nächste Runde.';
    if (host) btns = '<button class="btn primary huge bg-btn" data-act="next">🎱 Noch eine Runde</button>';
  } else {
    const all = g.drawn.length >= E.TOTAL;
    if (S.ui.hint) text = S.ui.hint;
    else if (all) text = 'Alle 75 Zahlen sind gezogen. Markiere, was noch fehlt, und tippe auf BINGO.';
    else if (g.timer) text = 'Die nächste Zahl kommt von selbst. Du musst nichts tun.';
    else if (host) text = g.drawn.length === 0 ? 'Tippe auf „Nächste Zahl“, dann geht es los.' : solo ? 'Tippe auf „Nächste Zahl“, wenn du bereit bist.' : 'Tippe auf „Nächste Zahl“, wenn alle bereit sind.';
    else text = g.drawn.length === 0 ? 'Gleich zieht der Gastgeber die erste Zahl.' : 'Der Gastgeber zieht die nächste Zahl.';
    const draw = host && !g.timer ? `<button class="btn primary huge bg-btn" data-act="draw"${all ? ' disabled' : ''}>Nächste Zahl</button>` : '';
    btns = `${draw}<button class="btn huge bg-btn bg-bingo" data-act="bingo">BINGO!</button>`;
  }
  const two = btns.includes('data-act="draw"');
  return `<section class="card action bg-action"><p class="big center">${esc(text)}</p><div class="bg-btns${two ? ' two' : ''}">${btns}</div></section>`;
}

function playersHtml(g) {
  const goal = g.full ? 'Volles Haus: die ganze Karte' : 'Eine Reihe, Spalte oder Diagonale';
  if (isSolo(g)) {
    const best = sess.get('bg_best_' + variant(g), null);
    return `<section class="card bg-players"><h2>Deine Runde</h2><p class="bg-fact">Runde ${g.round} · ${g.drawn.length} von ${E.TOTAL} Zahlen gezogen</p>
      <p class="bg-fact">Ziel: ${goal}</p><p class="bg-fact muted">${best === null ? 'Noch keine Bestleistung bei dieser Einstellung.' : `Bestleistung: Bingo nach ${plural(best, 'Zahl', 'Zahlen')}`}</p>${g.phase === 'over' ? '<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button>' : ''}</section>`;
  }
  const rows = g.players.map((p) => {
    const mine = p.id === cid;
    const mis = E.missing(g, p.id);
    const info = mine ? '' : (g.phase === 'over' ? '' : fehlt(mis));
    const won = g.phase === 'over' && g.winners.includes(p.id);
    return `<li class="bg-pl${mine ? ' me' : ''}${won ? ' won' : ''}"><span class="bg-pn">${esc(p.name)}${mine ? ' (du)' : ''}</span><span class="bg-pf">${info}</span><span class="bg-pp" aria-label="${plural(g.scores[p.id], 'Siegpunkt', 'Siegpunkte')}">⭐ <b>${g.scores[p.id]}</b></span></li>`;
  }).join('');
  const back = g.phase === 'over' ? '<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button>' : '';
  return `<section class="card bg-players"><h2>Mitspieler · Runde ${g.round}</h2><p class="bg-fact">${plural(g.drawn.length, 'Zahl', 'Zahlen')} von ${E.TOTAL} gezogen</p><ul class="bg-pls">${rows}</ul>
    <p class="muted small center">Ziel: ${goal}. Wer gewinnt, bekommt einen Siegpunkt (⭐).</p>${back}</section>`;
}

function listHtml(g) {
  const open = !!S.ui.listOpen;
  let body = '';
  if (open) {
    const cols = [...E.LETTERS].map((l, k) => {
      const ns = g.drawn.filter((n) => E.letterOf(n) === l).sort((a, b) => a - b);
      return `<div class="bg-lcol"><b class="c${k}">${l}</b>${ns.length ? ns.map((n) => `<span>${n}</span>`).join('') : '<span class="none">–</span>'}</div>`;
    }).join('');
    body = `<div class="bg-lgrid" id="bg-list">${cols}</div>`;
  }
  return `<section class="card bg-listcard"><button class="btn ghost bg-ltoggle" data-act="list-toggle" aria-expanded="${open ? 'true' : 'false'}">${open ? '▲ Liste zuklappen' : '▼ Alle gezogenen Zahlen'}</button>${body}</section>`;
}

function gameHtml() {
  const g = S.game;
  return `<div class="bg">${ui.header()}${ui.lost()}${bannerHtml(g)}${drawHtml(g)}${boardHtml(g)}${actionHtml(g)}${playersHtml(g)}${listHtml(g)}</div>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Hake deine Zahlen ab und rufe als Erste oder Erster BINGO! Du kannst allein spielen, gegen den Computer oder mit bis zu 8 Personen online.</p>
    <h3>Deine Karte</h3>
    <p>Deine Karte hat 5 Spalten mit den Buchstaben B, I, N, G und O und 25 Felder. Das Feld in der Mitte ist frei und zählt schon als markiert. In der Spalte B stehen Zahlen von 1 bis 15, in I von 16 bis 30, in N von 31 bis 45, in G von 46 bis 60 und in O von 61 bis 75.</p>
    <h3>So läuft eine Runde</h3>
    <ol>
      <li>Der Gastgeber tippt auf „Nächste Zahl“. Eine Zahl wird gezogen, groß angezeigt und auf Wunsch vorgelesen, zum Beispiel „N 38“. Jede Zahl kommt nur einmal vor.</li>
      <li>Hast du die Zahl auf deiner Karte, tippe sie an. Dann wird sie markiert. Das Markieren machst du selbst. Tippst du eine Zahl an, die noch nicht gezogen wurde, passiert nichts. Das Spiel sagt dir dann freundlich Bescheid.</li>
      <li>Hast du eine ganze Reihe, Spalte oder Diagonale markiert, tippe auf den großen Knopf BINGO!</li>
      <li>Stimmt es, hast du die Runde gewonnen und bekommst einen Siegpunkt. Stimmt es noch nicht, sagt das Spiel „Noch nicht ganz – weiter geht’s“. Das hat keine Strafe.</li>
    </ol>
    <p>Rufen zwei Personen im selben Moment BINGO, gewinnt die Person, deren Meldung zuerst ankommt. Alle anderen, die gerade auch eine gültige Karte haben, gewinnen mit. Unter der Karte kannst du die Liste „Alle gezogenen Zahlen“ aufklappen. Dort kannst du nachsehen, wenn du eine Zahl verpasst hast.</p>
    <h3>Die Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du ziehst die Zahlen selbst. Das Spiel zählt, nach wie vielen Zahlen du BINGO hast. Je weniger, desto besser. Deine Bestleistung wird gemerkt.</li>
      <li><b>Gegen den Computer:</b> Ein bis drei Computer spielen mit. Sie markieren nach ein bis drei Sekunden und überhören manchmal eine Zahl. Leicht überhört mehr Zahlen als Mittel.</li>
      <li><b>Mit anderen online:</b> Eröffne ein neues Spiel und schicke den Einladungs-Link oder den Code weiter. Unter der Karte siehst du bei den Mitspielern, wie viele Felder ihnen noch fehlen.</li>
    </ul>
    <h3>Einstellungen auf der Startseite</h3>
    <ul>
      <li><b>Zwei Karten pro Person:</b> Du bekommst zwei Karten. Eine davon reicht zum Gewinnen.</li>
      <li><b>Automatisch markieren:</b> Gezogene Zahlen werden auf deiner Karte von selbst markiert. Du musst nur noch BINGO rufen.</li>
      <li><b>Volles Haus statt Reihe:</b> Gewonnen hat, wer die ganze Karte markiert hat.</li>
      <li><b>Zahlen kommen automatisch:</b> Alle 8 Sekunden wird die nächste Zahl gezogen.</li>
    </ul>
    <p class="muted">Nach jeder Runde tippt der Gastgeber auf „Noch eine Runde“. Die Siegpunkte bleiben erhalten. Tipps oder Hilfen gibt es bewusst nicht.</p>
`;
}

// ====================== Bedienung ======================
const setHint = (t) => { S.ui.hint = t; render(); };
const ui = createUI({
  solo: true, soloText: 'Du ziehst die Zahlen selbst und versuchst, mit möglichst wenigen Zahlen BINGO zu haben.',
  sess, $app,
  title: 'Bingo', icon: '🎱', sub: 'Das Zahlenspiel für 1 bis 8 Personen – allein, mit anderen oder gegen den Computer',
  options: OPTIONS,
  minPlayers: 2,
  helpTitle: 'Die Spielregeln von Bingo', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    switch (act) {
      case 'cell': {
        if (g.phase !== 'play' || !me(g)) return undefined;
        const c = Number(el.dataset.c); const i = Number(el.dataset.i);
        if (i === E.FREE) return setHint('Das mittlere Feld ist frei. Es zählt schon als markiert.');
        const v = g.cards[cid][c][i];
        if (g.marks[cid][c][i] === 1) return setHint('Diese Zahl ist schon markiert.');
        if (!g.drawn.includes(v)) return setHint('Die wurde noch nicht gezogen. Kein Problem!');
        S.ui.hint = '';
        return sess.send({ t: 'mark', c, i });
      }
      case 'draw': return sess.send({ t: 'draw' });
      case 'bingo': {
        if (g.phase !== 'play' || !me(g)) return undefined;
        if (!E.isValid(g, cid)) return setHint('Noch nicht ganz – weiter geht’s!');
        S.ui.hint = '';
        return sess.send({ t: 'bingo' });
      }
      case 'next': return sess.send({ t: 'next' });
      case 'list-toggle': S.ui.listOpen = !S.ui.listOpen; return render();
      case 'read': {
        const n = E.lastDrawn(g);
        if (n !== null) speak(`Die Zahl ist: ${E.label(n)}.`);
        return undefined;
      }
    }
    return undefined;
  },
});
function render() { ui.render(); }
ui.boot();
