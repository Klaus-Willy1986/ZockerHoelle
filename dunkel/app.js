import * as Q from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach, LERN } from './tutorial.js';
import { RAETSEL } from './raetsel.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'kurz', label: 'Kurzes Spiel (3 Rätsel)', help: 'Ohne Häkchen sind es 5 Rätsel pro Spiel.', def: false },
  { id: 'leicht', label: 'Nur die leichteren Rätsel', help: 'Lässt die kniffligsten Rätsel weg.', def: false },
  { id: 'raum', label: 'Gruppe im selben Raum, nur ein Gerät', help: 'Wirkt beim Knopf „Allein spielen“: Statt eines Rätselbuchs spielt eine ganze Gruppe an diesem einen Gerät. Eine Person ist Spielleitung und hält das Gerät.', def: false },
];

function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedParam = new URLSearchParams(location.search).get('seed');
const rng = seedParam !== null && /^\d+$/.test(seedParam) ? seededRng(Number(seedParam)) : Math.random;

const freshUi = () => ({ sig: '', peek: false, mode: 'ask', draft: { ask: '', guess: '' }, nameDraft: '', lopen: false, focusIn: false, focusName: false });

function makeGame(players, opts) {
  const host = sess.cid;
  if (S.learn) return Q.createGame(players, { mode: 'learn', host, fixed: LERN }, rng, []);
  const mode = S.room === 'SOLO' ? (opts.raum ? 'local' : 'book') : 'group';
  let used = sess.get('dr_used', []);
  if (!Array.isArray(used)) used = [];
  const len = opts.kurz ? Q.LENGTHS.kurz : Q.LENGTHS.normal;
  if (RAETSEL.filter((r) => !used.includes(r.id)).length < len * 2) used = [];
  const g = Q.createGame(players, { mode, host, kurz: !!opts.kurz, leicht: !!opts.leicht, exclude: used }, rng, RAETSEL);
  sess.set('dr_used', used.concat(g.rs.map((r) => r.id)));
  return g;
}

const sess = createSession({
  game: 'dr',
  maxPlayers: Q.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => { Object.assign(S.ui, freshUi()); return makeGame(players, opts); },
  onMessage: (state, pid, msg) => {
    // Gruppe an einem Gerät: der Gastgeber handelt für die Person, die gerade dran ist
    if (msg && msg.t === 'as') {
      if (S.room === 'SOLO' && state.mode === 'local' && pid === state.host && typeof msg.id === 'string' && msg.msg && typeof msg.msg === 'object') Q.handle(state, msg.id, msg.msg, rng);
      return;
    }
    Q.handle(state, pid, msg, rng);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.gid}|${g.ri}|${g.phase === 'setup'}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.peek = false; S.ui.lopen = false; }
    if (S.role === 'host' && g.mode === 'book' && g.rated === 'ja') {
      const key = `${g.gid}|${g.ri}`;
      if (sess.get('dr_cnt', '') !== key) { sess.set('dr_cnt', key); sess.set('dr_solved', (Number(sess.get('dr_solved', 0)) || 0) + 1); }
    }
  }
  render();
}

// ====================== Hilfen ======================
const isLead = (g) => g.mode === 'local' || (g.mode === 'group' && Q.leaderId(g) === cid);
const nm = (g, id) => esc(Q.nameOf(g, id));
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
// Handeln: in der Gruppe an einem Gerät schickt der Gastgeber für die jeweilige Person
function act(id, msg) {
  const g = S.game;
  if (g && g.mode === 'local') return sess.send({ t: 'as', id, msg });
  return sess.send(msg);
}

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
function readText(g) {
  const r = Q.riddle(g);
  if (g.phase === 'solved') return `Die Lösung: ${r.loesung}`;
  return `Rätsel ${g.ri + 1}. ${r.geschichte}`;
}

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.phase === 'over') return '<div class="banner done">Alle Rätsel sind gelöst</div>';
  if (g.phase === 'setup') return '<div class="banner">Wer spielt mit?</div>';
  if (g.phase === 'solved') {
    if (g.mode === 'book' && g.rated === null) return '<div class="banner done">Das ist die Lösung</div>';
    if (g.solvedBy) return `<div class="banner done">${g.solvedBy === cid ? 'Du hast es gelöst!' : `${nm(g, g.solvedBy)} hat es gelöst!`}</div>`;
    return '<div class="banner done">Das Rätsel ist aufgelöst</div>';
  }
  if (g.mode === 'book') return `<div class="banner mine">Rätsel ${g.ri + 1} von ${g.len}</div>`;
  if (g.mode === 'learn') return '<div class="banner mine">Lernrunde: Was ist passiert?</div>';
  const ld = Q.leader(g);
  if (g.mode === 'local') {
    if (g.guess) return `<div class="banner mine">${nm(g, g.guess.by)} rät – bewerte bitte</div>`;
    return `<div class="banner mine">Spielleitung: ${esc(ld.name)} – Rätsel ${g.ri + 1} von ${g.len}</div>`;
  }
  if (isLead(g)) {
    if (g.guess) return `<div class="banner mine">${nm(g, g.guess.by)} rät – bewerte bitte</div>`;
    const n = Q.pendingQs(g).length;
    return `<div class="banner mine">${n ? `Du bist Spielleiter – ${plural(n, 'Frage wartet', 'Fragen warten')}` : 'Du bist Spielleiter – warte auf Fragen'}</div>`;
  }
  if (g.guess) return `<div class="banner">${g.guess.by === cid ? 'Du rätst – der Spielleiter prüft' : `${nm(g, g.guess.by)} rät gerade …`}</div>`;
  return `<div class="banner">Spielleitung: ${esc(ld.name)} – Rätsel ${g.ri + 1} von ${g.len}</div>`;
}

function storyCard(g) {
  const r = Q.riddle(g);
  const read = speechOk ? `<button class="dr-read" data-act="read">🔊 Geschichte vorlesen</button>` : '<span></span>';
  return `<section id="board" class="card dr-story${g.phase === 'play' ? ' action' : ''}">
    <div class="dr-meta"><span>Rätsel ${g.ri + 1} von ${g.len}</span><span role="img" aria-label="Schwierigkeit ${r.schwer} von 3">${stars(r.schwer)}</span></div>
    <p class="big dr-text">${esc(r.geschichte)}</p>${read}</section>`;
}

function logHtml(g) {
  const rows = g.log.map((e) => {
    if (e.k === 'h') return `<li class="h">💡 Hinweis ${e.hn}: ${esc(e.text)}</li>`;
    if (e.k === 'g') {
      const v = e.a ? `<span class="dr-ans v-${e.a}">${Q.VERDICT_LABEL[e.a]}</span>` : '<span class="dr-ans wait">wird geprüft …</span>';
      return `<li class="g"><b>${nm(g, e.by)}</b> glaubt: „${esc(e.text)}“ ${v}</li>`;
    }
    const a = e.a ? `<span class="dr-ans a-${e.a}">${Q.ANSWER_LABEL[e.a]}</span>` : '<span class="dr-ans wait">wartet …</span>';
    if (e.spoken) return `<li class="q"><i>Frage aus der Runde</i> ${a}</li>`;
    return `<li class="q"><b>${nm(g, e.by)}:</b> ${esc(e.text)} ${a}</li>`;
  });
  const body = rows.length ? rows.join('') : '<li class="empty">Hier erscheinen Fragen, Antworten und Hinweise.</li>';
  return `<section class="card dr-logcard"><h2>Protokoll</h2><ol class="dr-log" role="log" aria-live="polite" tabindex="0">${body}</ol></section>`;
}

function scoreCard(g) {
  const rk = Q.ranking(g);
  return `<section class="card dr-score"><ul aria-label="Punkte">${rk.map((r) => `<li class="${r.id === cid ? 'me' : ''}">${esc(r.name)}${r.id === cid ? ' (du)' : ''}: <b>${r.score}</b></li>`).join('')}</ul></section>`;
}

const ansBtn = (v, n) => {
  const sub = v === 'egal' ? '<small>Frage unwichtig</small>' : v === 'fast' ? '<small>Teillösung stimmt</small>' : '';
  return `<button class="dr-b ${v}${v === 'anders' ? ' wide' : ''}" data-act="answer" data-v="${v}"${n ? ` data-n="${n}"` : ' disabled'}>${Q.ANSWER_LABEL[v]}${sub}</button>`;
};

function hintBtn(g) {
  const h = g.hints;
  return h >= Q.MAX_HINTS
    ? '<button class="dr-b" data-act="hint" disabled>Alle 3 Hinweise gegeben</button>'
    : `<button class="dr-b" data-act="hint">💡 Hinweis ${h + 1} freigeben</button>`;
}

function leaderCard(g) {
  let inner;
  if (g.guess) {
    inner = `<h2>Lösungsversuch</h2><p class="dr-who"><b>${nm(g, g.guess.by)}</b> meint: <q>${esc(g.guess.text)}</q></p>
      <div class="dr-grid three"><button class="dr-b good" data-act="judge" data-v="richtig">Richtig!</button><button class="dr-b fast" data-act="judge" data-v="fast">Fast</button><button class="dr-b bad" data-act="judge" data-v="falsch">Falsch</button></div>`;
  } else if (g.mode === 'local') {
    const others = g.players.filter((p) => p.id !== Q.leaderId(g));
    inner = `<h2>Laut gestellte Fragen beantworten</h2><p class="dr-who">Die Gruppe fragt laut. Tippe auf die Antwort.</p>
      <div class="dr-grid">${['ja', 'nein', 'egal', 'fast'].map((v) => `<button class="dr-b ${v}" data-act="say" data-v="${v}">${Q.ANSWER_LABEL[v]}</button>`).join('')}</div>
      <h2 style="margin-top:12px">Wer glaubt, die Lösung zu wissen?</h2>
      <div class="dr-grid">${others.map((p) => `<button class="dr-b" data-act="lguess-by" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>`;
  } else {
    const pend = Q.pendingQs(g);
    const e = pend[0];
    const who = e ? `<b>${nm(g, e.by)}</b> fragt: <q>${esc(e.text)}</q>${pend.length > 1 ? ` <small>(+${pend.length - 1} weitere)</small>` : ''}` : '<span class="muted">Noch keine offene Frage.</span>';
    inner = `<h2>Frage beantworten</h2><p class="dr-who">${who}</p>
      <div class="dr-grid">${['ja', 'nein', 'egal', 'fast', 'anders'].map((v) => ansBtn(v, e ? e.n : 0)).join('')}</div>`;
  }
  const peek = S.ui.peek
    ? `<section class="card dr-sol"><b>Die Lösung (nur auf deinem Gerät)</b><p>${esc(Q.riddle(g).loesung)}</p><button class="dr-small" data-act="peek">Lösung wieder verstecken</button></section>`
    : `<section class="card dr-sol"><button class="dr-b" data-act="peek">👁 Lösung ansehen (nur du)</button></section>`;
  return `${peek}<section class="card dr-ctl">${inner}
    <div class="dr-grid" style="margin-top:12px">${hintBtn(g)}<button class="dr-b" data-act="giveup">Rätsel auflösen</button></div></section>`;
}

function guestInput(g) {
  const mode = S.ui.mode;
  const mineOpen = Q.openQsOf(g, cid);
  const blockedAsk = mineOpen >= Q.MAX_OPEN_Q;
  const blockedGuess = !!g.guess;
  const blocked = mode === 'ask' ? blockedAsk : blockedGuess;
  const note = mode === 'ask'
    ? (blockedAsk ? 'Du hast schon 3 offene Fragen. Warte auf die Antworten.' : 'Stelle eine kurze Frage, die man mit Ja oder Nein beantworten kann.')
    : (blockedGuess ? 'Gerade rät schon jemand. Gleich bist du dran.' : 'Schreibe kurz, was deiner Meinung nach passiert ist.');
  const val = S.ui.draft[mode] || '';
  return `<section class="dr-input" aria-label="Eingabe">
    <div class="dr-tabs"><button class="dr-tab" data-act="tab" data-m="ask" aria-pressed="${mode === 'ask'}">Frage stellen</button>
      <button class="dr-tab" data-act="tab" data-m="guess" aria-pressed="${mode === 'guess'}">Ich glaube, ich weiß es!</button></div>
    <div class="dr-row"><input id="dr-in" class="dr-in" type="text" maxlength="${Q.MAX_TEXT}" autocomplete="off" enterkeyhint="send" placeholder="${mode === 'ask' ? 'Deine Frage …' : 'Meine Lösung …'}" aria-label="${mode === 'ask' ? 'Deine Frage' : 'Deine Lösung'}" value="${esc(val)}">
      <button class="dr-send" data-act="send"${blocked ? ' disabled' : ''}>Senden</button></div>
    <p class="dr-note">${note}</p></section>`;
}

function bookCard(g) {
  const slots = [0, 1, 2].map((i) => (i < g.hints
    ? `<li class="on"><b>Hinweis ${i + 1}:</b> ${esc(Q.riddle(g).hinweise[i])}</li>`
    : `<li class="off">Hinweis ${i + 1} – noch zu</li>`)).join('');
  const solved = Number(sess.get('dr_solved', 0)) || 0;
  return `<section class="card dr-hints"><h2 style="margin:0 0 4px;font-size:1.1rem">Hinweise</h2><ol>${slots}</ol>
    <p class="muted center" style="margin:6px 0 0">Gelöst bisher: <b id="dr-stat">${solved}</b></p></section>
    <section class="card"><div class="dr-grid">${hintBtn(g)}<button class="dr-b prim" data-act="reveal">Lösung zeigen</button></div></section>`;
}

function learnCard(g) {
  const asked = (k) => g.log.find((e) => e.k === 'q' && e.src === k);
  const qs = g.table.map((t, k) => {
    const e = asked(k);
    return `<button class="dr-b${e ? ' ' + e.a : ''}" data-act="lask" data-k="${k}"${e ? ' disabled' : ''}>${esc(t.q)}${e ? `<small>${Q.ANSWER_LABEL[e.a]}</small>` : ''}</button>`;
  }).join('');
  let guess = '';
  if (S.ui.lopen) {
    guess = `<h2 style="margin-top:12px">Was ist passiert?</h2><div class="dr-grid one">${g.guessOpts.map((o, k) => `<button class="dr-b" data-act="lguess" data-k="${k}"${g.log.some((e) => e.k === 'g' && e.src === k) ? ' disabled' : ''}>${esc(o.t)}</button>`).join('')}</div>`;
  }
  return `<section class="card dr-ctl"><h2>Stelle eine Frage</h2><div class="dr-grid one">${qs}</div>
    <div class="dr-grid" style="margin-top:12px">${hintBtn(g)}<button class="dr-b prim" data-act="lguess-open">${S.ui.lopen ? 'Auswahl schließen' : 'Ich glaube, ich weiß es!'}</button></div>${guess}</section>`;
}

function setupCard(g) {
  const rows = g.players.map((p, i) => `<li><span>${esc(p.name)}${p.id === cid ? ' (du, hältst das Gerät)' : ''}</span>${i > 0 ? `<button class="dr-b" data-act="dellocal" data-id="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">Entfernen</button>` : ''}</li>`).join('');
  return `<section id="board" class="card dr-ctl"><h2>Wer spielt mit?</h2>
    <p class="muted">Alle sitzen an einem Gerät. Der Reihe nach ist jede Person Spielleitung, sieht die Lösung und beantwortet die Fragen der anderen. Gib die Namen der anderen ein (insgesamt 2 bis 8 Personen).</p>
    <ul class="dr-names">${rows}</ul>
    <div class="dr-row"><input id="dr-name" class="dr-in" type="text" maxlength="${Q.MAX_NAME}" autocomplete="off" placeholder="Name der nächsten Person" aria-label="Name der nächsten Person" value="${esc(S.ui.nameDraft)}">
      <button class="dr-send" data-act="addlocal"${g.players.length >= Q.MAX_PLAYERS ? ' disabled' : ''}>Dazu</button></div>
    <button class="btn primary huge" data-act="startlocal"${g.players.length < 2 ? ' disabled' : ''}>▶ Los geht’s</button></section>`;
}

function solvedCard(g) {
  const r = Q.riddle(g);
  let head; let rate = ''; let next;
  if (g.mode === 'book') {
    if (g.rated === null) {
      head = '<p class="big">Hast du es erraten?</p>';
      rate = `<div class="dr-grid three"><button class="dr-b good" data-act="rate" data-v="ja">Ja</button><button class="dr-b fast" data-act="rate" data-v="fast">Fast</button><button class="dr-b bad" data-act="rate" data-v="nein">Nein</button></div>
        <p class="muted center">Ohne Hinweis gibt es 3 Punkte, mit einem Hinweis 2, sonst 1. „Fast“ gibt 1 Punkt.</p>`;
      next = '';
    } else {
      head = g.gain ? `<p class="dr-gain">+${plural(g.gain, 'Punkt', 'Punkte')}</p>` : '<p class="muted">Diesmal keine Punkte – beim nächsten Rätsel klappt es!</p>';
      next = `<button class="btn primary huge" data-act="next">${g.ri + 1 >= g.len ? 'Zum Ergebnis' : 'Nächstes Rätsel'}</button>`;
    }
  } else {
    head = g.solvedBy
      ? `<p class="dr-gain">${g.solvedBy === cid ? 'Du bekommst' : `${nm(g, g.solvedBy)} bekommt`} +${plural(g.gain, 'Punkt', 'Punkte')}</p>`
      : '<p class="muted">Das Rätsel wurde aufgelöst. Es gibt keine Punkte.</p>';
    const canNext = g.mode === 'learn' || isLead(g) || S.role === 'host';
    if (g.mode === 'learn') next = `<button class="btn primary huge" data-act="next">Weiter</button>`;
    else if (canNext) next = `<button class="btn primary huge" data-act="next">${g.ri + 1 >= g.len ? 'Zum Ergebnis' : 'Nächstes Rätsel'}</button>`;
    else next = '<p class="muted center">Es geht gleich weiter, sobald die Spielleitung auf „Nächstes Rätsel“ tippt.</p>';
  }
  const nl = g.mode === 'group' || g.mode === 'local' ? `<p class="muted center">Nächste Spielleitung: ${esc(Q.nameOf(g, g.players[(g.ri + 1) % g.players.length].id))}</p>` : '';
  return `<section class="card action dr-res"><h2>${esc(r.titel)}</h2><p class="big dr-loes">${esc(r.loesung)}</p>${head}${rate}
    ${g.phase === 'solved' && g.ri + 1 < g.len ? nl : ''}${next}</section>${g.mode === 'group' || g.mode === 'local' ? scoreCard(g) : ''}`;
}

function overCard(g) {
  const rk = Q.ranking(g);
  const win = Q.winners(g);
  const solo = g.players.length === 1;
  const iWon = win.some((w) => w.id === cid);
  let title; let trophy = iWon ? '🏆' : '🕯️'; let extra = '';
  if (solo) {
    const s = g.scores[cid];
    title = g.mode === 'learn' ? `Geschafft! Du hast ${s} Punkte!` : `Geschafft! Du hast ${s} Punkte!`;
    extra = `<p class="center big">${plural(g.wins[cid] || 0, 'Rätsel selbst gelöst', 'Rätsel selbst gelöst')} von ${g.len}.</p>`;
    trophy = '🏆';
  } else {
    const names = win.map((w) => (w.id === cid ? 'Du' : esc(w.name)));
    title = win.length === 1 ? `${names[0]} ${names[0] === 'Du' ? 'bist' : 'ist'} die Rätselmeisterschaft 🏆` : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} sind Rätselmeister 🏆`;
    if (win.length > 1) extra = '<p class="center big">Gleichstand – ihr teilt euch den Titel!</p>';
  }
  const medal = (r) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`);
  const lis = rk.map((r) => `<li class="${r.rank === 1 ? 'win' : ''}"><span class="medal">${medal(r)}</span><span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}<small>Gelöst: ${r.solved}</small></span><span class="rt">${r.score}</span></li>`).join('');
  const again = S.role === 'host'
    ? '<button class="btn primary huge" data-act="again">🕯️ Noch eine Runde</button>'
    : '<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>';
  return `<section class="card over dr-over"><div class="trophy">${trophy}</div><h1>${title}</h1>${extra}
    <ul class="ranking">${lis}</ul>${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
}

function gameHtml() {
  const g = S.game;
  let body;
  if (g.phase === 'over') body = overCard(g);
  else if (g.phase === 'setup') body = setupCard(g);
  else if (g.phase === 'solved') body = `${storyCard(g)}${solvedCard(g)}`;
  else if (g.mode === 'book') body = `${storyCard(g)}${bookCard(g)}`;
  else if (g.mode === 'learn') body = `${storyCard(g)}${logHtml(g)}${learnCard(g)}`;
  else if (isLead(g)) body = `${storyCard(g)}${leaderCard(g)}${logHtml(g)}${scoreCard(g)}`;
  else body = `${storyCard(g)}${logHtml(g)}${scoreCard(g)}${guestInput(g)}`;
  return `<div class="dr">${ui.header()}${ui.lost()}${bannerHtml(g)}${body}</div>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Eine kurze, rätselhafte Geschichte wird erzählt. Du sollst herausfinden, <b>was da wirklich passiert ist</b>. Die Lösungen sind harmlos und überraschend, es geht um Missverständnisse, Zufälle, kleine Tricks, Berufe und Tiere.</p>
    <h3>Rätselbuch (allein)</h3>
    <p>Du liest die Geschichte und denkst nach. Wenn du nicht weiterkommst, tippst du auf Hinweis. Es gibt bis zu drei Hinweise, vom vagen bis zum deutlichen. Mit Lösung zeigen siehst du die Antwort und sagst ehrlich, ob du es erraten hast. Ohne Hinweis gibt es 3 Punkte, mit einem Hinweis 2, mit mehr Hinweisen 1. Bei Fast gibt es 1 Punkt. Ein Spiel hat 5 Rätsel, auf Wunsch nur 3.</p>
    <h3>Gruppe (2 bis 8 Personen)</h3>
    <p>Eine Person ist die Spielleitung. Nur sie sieht die Lösung, auf ihrem Gerät hinter dem Knopf Lösung ansehen. Alle anderen sehen nur die Geschichte und stellen der Spielleitung Fragen, die man mit Ja oder Nein beantworten kann. Die Spielleitung antwortet mit großen Knöpfen:</p>
    <ul>
      <li><b>Ja</b> oder <b>Nein</b>.</li>
      <li><b>Egal:</b> Die Frage ist unwichtig.</li>
      <li><b>Fast!</b> Ein Teil der Lösung stimmt.</li>
      <li><b>Anders fragen:</b> Die Frage lässt sich so nicht beantworten.</li>
    </ul>
    <p>Wer glaubt, die Lösung zu kennen, tippt auf Ich glaube, ich weiß es und schreibt sie kurz auf. Die Spielleitung bewertet mit Richtig, Fast oder Falsch. Richtig gibt 3 Punkte, für jeden vorher verratenen Hinweis einen Punkt weniger, mindestens 1. Die Spielleitung kann Hinweise freigeben und ein Rätsel auch auflösen, wenn alle nicht weiterkommen. Beim nächsten Rätsel wechselt die Spielleitung der Reihe nach. Wer am Ende die meisten Punkte hat, gewinnt.</p>
    <h3>Gruppe im selben Raum</h3>
    <p>Setze vor dem Start unten das Häkchen bei Gruppe im selben Raum, nur ein Gerät, und tippe auf Allein spielen. Dann trägst du die Namen aller ein. Die Spielleitung hält das Gerät, die anderen fragen laut. Die Spielleitung tippt die Antworten ein und sagt, wer rät.</p>
    <h3>Lernrunde</h3>
    <p>In der Lernrunde probierst du alles an einem Beispiel aus. Der Computer ist die Spielleitung.</p>
    <p class="muted">Dein Gerät kann dir die Geschichte auch vorlesen. Tippe dafür auf Geschichte vorlesen.</p>`;
}

// ====================== Bedienung ======================
function sendInput() {
  const g = S.game;
  if (!g || g.mode !== 'group' || isLead(g)) return;
  const el = document.getElementById('dr-in');
  const mode = S.ui.mode;
  const text = (el ? el.value : S.ui.draft[mode] || '').trim();
  if (!text) return;
  if (mode === 'ask' ? Q.openQsOf(g, cid) >= Q.MAX_OPEN_Q : !!g.guess) return;
  S.ui.draft[mode] = '';
  S.ui.focusIn = true;
  sess.send(mode === 'ask' ? { t: 'ask', text } : { t: 'guess', text });
}
function addLocal() {
  const el = document.getElementById('dr-name');
  const name = (el ? el.value : S.ui.nameDraft).trim();
  S.ui.nameDraft = '';
  S.ui.focusName = true;
  if (!name) return render();
  sess.send({ t: 'addlocal', name });
  render();
}

const ui = createUI({
  solo: true,
  soloText: 'Das Rätselbuch: Du löst Rätsel allein, mit Hinweisen. Mit dem Häkchen „Gruppe im selben Raum“ unten spielt stattdessen eine Gruppe an diesem einen Gerät.',
  sess, $app,
  title: 'Dunkle Rätsel', icon: '🕯️', sub: 'Was ist da passiert? Rätsel für 1 bis 8 Personen',
  options: OPTIONS,
  helpTitle: 'Die Spielregeln von Dunkle Rätsel', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (a, el) => {
    const g = S.game;
    if (!g) return;
    const lid = Q.leaderId(g);
    switch (a) {
      case 'read': return speak(readText(g));
      case 'hint': return act(g.mode === 'local' || g.mode === 'group' ? lid : cid, { t: 'hint' });
      case 'reveal': return sess.send({ t: 'reveal' });
      case 'rate': return sess.send({ t: 'rate', v: el.dataset.v });
      case 'next': return act(g.mode === 'local' ? lid : cid, { t: 'next' });
      case 'giveup': return act(lid, { t: 'giveup' });
      case 'peek': S.ui.peek = !S.ui.peek; return render();
      case 'tab': S.ui.mode = el.dataset.m === 'guess' ? 'guess' : 'ask'; S.ui.focusIn = true; return render();
      case 'send': return sendInput();
      case 'answer': return act(lid, { t: 'answer', n: Number(el.dataset.n), v: el.dataset.v });
      case 'say': return act(lid, { t: 'say', v: el.dataset.v });
      case 'judge': return act(lid, { t: 'judge', v: el.dataset.v });
      case 'lguess-by': return act(el.dataset.id, { t: 'guess', text: '' });
      case 'lask': return sess.send({ t: 'ask', k: Number(el.dataset.k) });
      case 'lguess-open': S.ui.lopen = !S.ui.lopen; return render();
      case 'lguess': S.ui.lopen = false; return sess.send({ t: 'guess', k: Number(el.dataset.k) });
      case 'addlocal': return addLocal();
      case 'dellocal': return sess.send({ t: 'as', id: cid, msg: { t: 'dellocal', id: el.dataset.id } });
      case 'startlocal': return sess.send({ t: 'as', id: cid, msg: { t: 'startlocal' } });
    }
  },
});

// Zeichnen, ohne dass Eingabe, Fokus und Protokoll-Scrollstand verloren gehen
function render() {
  const lg = $app.querySelector('.dr-log');
  const stick = !lg || lg.scrollHeight - lg.scrollTop - lg.clientHeight < 40;
  const top = lg ? lg.scrollTop : 0;
  const inp = $app.querySelector('#dr-in');
  const focused = inp && document.activeElement === inp;
  const nameEl = $app.querySelector('#dr-name');
  const nameFocused = nameEl && document.activeElement === nameEl;
  const caret = focused ? inp.selectionStart : null;
  ui.render();
  const lg2 = $app.querySelector('.dr-log');
  if (lg2) lg2.scrollTop = stick ? lg2.scrollHeight : top;
  const in2 = $app.querySelector('#dr-in');
  if (in2 && (focused || S.ui.focusIn)) {
    in2.focus({ preventScroll: true });
    try { const c = caret === null ? in2.value.length : Math.min(caret, in2.value.length); in2.setSelectionRange(c, c); } catch { /* egal */ }
  }
  S.ui.focusIn = false;
  const nm2 = $app.querySelector('#dr-name');
  if (nm2 && (nameFocused || S.ui.focusName)) nm2.focus({ preventScroll: true });
  S.ui.focusName = false;
}
$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'dr-in') S.ui.draft[S.ui.mode] = t.value;
  else if (t.id === 'dr-name') S.ui.nameDraft = t.value;
});
$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'dr-in') { ev.preventDefault(); sendInput(); }
  else if (ev.target.id === 'dr-name') { ev.preventDefault(); addLocal(); }
});
ui.boot();
