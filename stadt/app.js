import * as Q from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, thinkDelay } from './ai.js';
import { coach, TUTORIAL_OPTS } from './tutorial.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'kurz', label: 'Kurzes Spiel (4 Runden)', help: 'Ohne Häkchen bei Kurz und Lang sind es 6 Runden.', def: false },
  { id: 'lang', label: 'Langes Spiel (10 Runden)', def: false },
  { id: 'more', label: 'Mehr Kategorien (8): zusätzlich Pflanze/Obst und Essen/Trinken', help: 'Ohne Häkchen gibt es 6 Kategorien: Stadt, Land, Fluss, Name, Tier und Beruf.', def: false },
  { id: 'stop', label: 'Mit Stopp (30 Sekunden)', help: 'Wer alle Felder ausgefüllt hat, darf STOPP tippen. Die anderen haben dann noch 30 Sekunden. Ohne Häkchen gibt es keinen Zeitdruck: Die Runde endet, wenn alle auf Fertig getippt haben.', def: false },
];

// ?seed=123 in der Adresse: feste Mischung (für Tests). Sonst Zufall.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedParam = new URLSearchParams(location.search).get('seed');
const rng = seedParam !== null && /^\d+$/.test(seedParam) ? seededRng(Number(seedParam)) : Math.random;

const freshRound = () => ({ key: '', valsKey: '', vals: null, dirty: new Set(), sendTimer: null, stopKey: '', stopT0: 0 });
const timers = { stop: null, stopKey: '', bots: new Set() };
function clearTimers() { clearTimeout(timers.stop); timers.stop = null; timers.stopKey = ''; timers.bots.clear(); }

function makeGame(players, opts) {
  const host = sess.cid;
  if (S.learn) return Q.createGame(players, { ...TUTORIAL_OPTS, host }, rng);
  const rounds = opts.lang ? Q.ROUNDS.lang : opts.kurz ? Q.ROUNDS.kurz : Q.ROUNDS.normal;
  return Q.createGame(players, { rounds, more: !!opts.more, stop: !!opts.stop, host }, rng);
}

const sess = createSession({
  game: 'sl',
  maxPlayers: Q.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => { Object.assign(S.ui, freshRound()); clearTimers(); return makeGame(players, opts); },
  onMessage: (state, pid, msg) => {
    // Der Gastgeber lässt Computer-Mitspieler antworten (nur im Alleinspiel)
    if (msg && msg.t === 'as') {
      if (S.room === 'SOLO' && pid === state.host && Q.isBotId(msg.id) && msg.msg && typeof msg.msg === 'object') Q.handle(state, msg.id, msg.msg, Math.random);
      return;
    }
    Q.handle(state, pid, msg, rng);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshRound()); clearTimers(); },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshRound();

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && S.role === 'host') arm(g);
  render();
}

// Gastgeber: Stopp-Frist und Computer-Antworten (nur Zeitgeber, die Regeln stehen in engine.js)
function arm(g) {
  if (g.phase !== 'fill') { clearTimeout(timers.stop); timers.stop = null; timers.stopKey = ''; return; }
  const tk = `${g.gid}|${g.round}`;
  if (g.stop && timers.stopKey !== tk) {
    clearTimeout(timers.stop);
    timers.stopKey = tk;
    timers.stop = setTimeout(() => {
      const cur = S.game;
      if (cur && cur.gid === g.gid && cur.round === g.round && cur.phase === 'fill' && cur.stop) sess.send({ t: 'timeup', r: g.round });
    }, Q.STOP_MS);
  }
  if (S.room !== 'SOLO') return;
  for (const p of g.players) {
    if (!Q.isBotId(p.id) || g.done[p.id]) continue;
    const k = `${tk}|${p.id}`;
    if (timers.bots.has(k)) continue;
    timers.bots.add(k);
    setTimeout(() => {
      const cur = S.game;
      if (!cur || cur.gid !== g.gid || cur.round !== g.round || cur.phase !== 'fill' || S.room !== 'SOLO') return;
      const msg = chooseAction(cur, p.id, S.level || 0, Math.random);
      if (msg) sess.send({ t: 'as', id: p.id, msg });
    }, thinkDelay(Math.random));
  }
}

// ====================== Hilfen ======================
const me = (g) => g.players.find((p) => p.id === cid);
const connected = (id) => { const l = S.lobby.find((x) => x.id === id); return !l || l.connected !== false; };
const nameOf = (p) => esc(p.name);
const listNames = (ps) => {
  const n = ps.map(nameOf);
  if (n.length <= 3) return n.join(', ');
  return `${n.slice(0, 3).join(', ')} und ${n.length - 3} weitere`;
};
const nameById = (g, id) => { const p = g.players.find((x) => x.id === id); return p ? p.name : ''; };
const catLabel = (id) => Q.CATS[id] || id;

// Eigene Entwürfe: lokal zuerst (damit beim Tippen nichts überschrieben wird), nach dem Neuladen aus dem Spielstand
function valsOf(g) {
  const key = `${g.gid}|${g.round}`;
  if (S.ui.valsKey !== key || !Array.isArray(S.ui.vals) || S.ui.vals.length !== g.cats.length) {
    S.ui.valsKey = key;
    S.ui.vals = ((g.drafts && g.drafts[cid]) || g.cats.map(() => '')).map((t) => String(t || ''));
    S.ui.dirty = new Set();
  }
  return S.ui.vals;
}
const filledLocal = (g) => valsOf(g).every((t) => Q.clean(t).length > 0);

// ====================== Darstellung ======================
function bannerInfo(g) {
  if (g.phase === 'over') return { cls: 'done', text: 'Das Spiel ist zu Ende' };
  if (g.phase === 'reveal') return { cls: 'done', text: `Auflösung – Runde ${g.round + 1} von ${g.rounds}` };
  const pend = Q.pending(g);
  const mine = me(g);
  if (mine && !g.done[cid]) {
    if (g.stop) return { cls: 'mine', text: `STOPP von ${esc(nameById(g, g.stop.by))}! Du hast noch 30 Sekunden.` };
    return { cls: 'mine', text: `Runde ${g.round + 1} von ${g.rounds} – schreibe los!` };
  }
  if (g.stop && g.stop.by === cid) return { cls: '', text: `Du hast STOPP gerufen. Warte auf: ${listNames(pend)}` };
  return { cls: '', text: `Warte auf: ${listNames(pend)}` };
}
function bannerHtml(g) {
  const b = bannerInfo(g);
  return `<div class="banner${b.cls ? ' ' + b.cls : ''}">${b.text}</div>`;
}

function gainOf(g) { return g.reveal && g.reveal.gain ? g.reveal.gain[cid] || 0 : 0; }

function boardCard(g) {
  const reveal = g.phase === 'reveal';
  let sub;
  if (reveal) {
    const n = gainOf(g);
    sub = `Du hast in dieser Runde ${n} ${n === 1 ? 'Punkt' : 'Punkte'} geholt.`;
  } else if (g.done[cid]) sub = 'Du bist fertig. Gleich geht es weiter.';
  else sub = 'Schreibe zu jeder Kategorie ein Wort mit diesem Buchstaben.';
  return `<section id="board" class="card action sl-board">
    <div class="sl-meta"><span>Runde ${g.round + 1} von ${g.rounds}</span><span>${g.cats.length} Kategorien</span></div>
    <div class="sl-letter" role="img" aria-label="Buchstabe ${esc(g.letter)}">${esc(g.letter)}</div>
    <p class="big sl-sub">${esc(sub)}</p></section>`;
}

function stopZoneHtml(g) {
  if (!g.stopOpt) return '';
  if (!g.stop) return '';
  if (S.ui.stopKey !== `${g.gid}|${g.round}`) { S.ui.stopKey = `${g.gid}|${g.round}`; S.ui.stopT0 = Date.now(); }
  const el = Math.min(Q.STOP_MS / 1000, (Date.now() - S.ui.stopT0) / 1000).toFixed(2);
  return `<p class="sl-stoptext"><b>STOPP</b> von ${esc(nameById(g, g.stop.by))}</p><div class="sl-timer" role="img" aria-label="Noch 30 Sekunden Zeit"><i style="animation-delay:-${el}s"></i></div>`;
}
function skipHtml(g) {
  if (S.role !== 'host' || g.phase !== 'fill') return '';
  const off = Q.pending(g).filter((p) => !Q.isBotId(p.id) && !connected(p.id));
  return off.length ? `<button class="btn ghost" data-act="skipwait">Ohne ${listNames(off)} weiter</button>` : '';
}

function fieldsCard(g) {
  const done = !!g.done[cid];
  const vals = valsOf(g);
  const last = g.cats.length - 1;
  const items = g.cats.map((c, i) => `<label class="sl-f"><span class="sl-cn">${esc(catLabel(c))}</span>
    <input class="sl-in" data-i="${i}" type="text" enterkeyhint="${i === last ? 'done' : 'next'}" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" maxlength="${Q.MAX_LEN}" placeholder="mit ${esc(g.letter)} …" value="${esc(vals[i] || '')}"${done ? ' disabled' : ''}></label>`).join('');
  return `<section class="card sl-fields">${items}</section>`;
}

function fillBar(g) {
  const done = !!g.done[cid];
  if (!me(g)) return '';
  if (done) return `<div class="sl-bar"><button class="btn secondary huge" data-act="reopen"${g.stop ? ' disabled' : ''}>Doch noch ändern</button></div>`;
  const stopBtn = g.stopOpt && Q.humans(g).length >= 2
    ? `<button class="btn sl-stopbtn huge" data-act="stop"${!filledLocal(g) || g.stop ? ' disabled' : ''}>STOPP!</button>` : '';
  return `<div class="sl-bar${stopBtn ? ' two' : ''}"><button class="btn primary huge" data-act="done">Fertig</button>${stopBtn}</div>`;
}

function fillHtml(g) {
  return `${boardCard(g)}<div id="sl-stop" class="sl-stop${g.stopOpt ? ' on' : ''}">${stopZoneHtml(g)}</div>${fieldsCard(g)}<div id="sl-skip">${skipHtml(g)}</div>${fillBar(g)}`;
}

function rankCard(g, gains) {
  const rows = Q.ranking(g).map((r) => {
    const gain = gains && gains[r.id] ? `<em class="sl-gain">+${gains[r.id]}</em>` : '<em class="sl-gain"></em>';
    return `<li class="${r.id === cid ? 'me' : ''}"><span class="sl-rk">${r.rank}.</span><span class="sl-nm">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span>${gain}<span class="sl-pt">${r.score}</span></li>`;
  }).join('');
  return `<section class="card sl-rank"><h2>Rangliste</h2><ul>${rows}</ul></section>`;
}

function tagFor(r) {
  if (r.st === 'empty') return '';
  if (r.st === 'wrong') return '<small class="sl-tag bad">passt nicht zum Buchstaben</small>';
  if (r.st === 'unknown') {
    if (r.rejected) return '<small class="sl-tag bad">ungeprüft – gilt nicht</small>';
    if (r.half) return '<small class="sl-tag warn">ungeprüft – halbe Punkte</small>';
    return '<small class="sl-tag warn">ungeprüft</small>';
  }
  return '';
}

function catCard(g, c, ci) {
  const mine = me(g);
  const myHuman = !!mine && !Q.isBotId(cid);
  const rows = g.players.map((p) => {
    const r = c.rows[p.id];
    const mark = r.st === 'empty' ? '<i class="sl-none">–</i>' : esc(r.a);
    let extra = tagFor(r);
    if (!extra && r.valid) extra = r.shared ? '<small class="sl-tag">gleiche Antwort</small>' : (r.pts === Q.PTS.only ? '<small class="sl-tag good">einzige Antwort</small>' : '');
    if (r.st === 'unknown' && r.valid && !r.half && r.pts === Q.PTS.only) extra = '<small class="sl-tag warn">ungeprüft – einzige Antwort</small>';
    let vote = '';
    if (r.st === 'unknown' && !r.half && p.id !== cid && myHuman) {
      const voted = ((g.votes && g.votes[`${ci}|${p.id}`]) || []).includes(cid);
      vote = `<button class="btn secondary sl-vote${voted ? ' on' : ''}" data-act="vote" data-pid="${esc(p.id)}" data-cat="${ci}" aria-pressed="${voted ? 'true' : 'false'}">${voted ? '✔ Gilt nicht (zurücknehmen)' : 'Gilt nicht'} <small>${r.votes} von ${r.need}</small></button>`;
    }
    return `<li class="${p.id === cid ? 'me ' : ''}${r.pts ? 'ok' : 'zero'}"><div class="sl-line"><span class="sl-who">${nameOf(p)}${p.id === cid ? ' (du)' : ''}</span>
      <span class="sl-ans"><span class="sl-w">${mark}</span>${extra}</span><span class="sl-pts">${r.pts ? '+' + r.pts : '0'}</span></div>${vote}</li>`;
  }).join('');
  return `<section class="card sl-cat"><h3>${esc(catLabel(c.id))}</h3><ul class="sl-rows">${rows}</ul></section>`;
}

function revealHtml(g) {
  const rv = g.reveal;
  const gains = rv.gain;
  const cards = rv.cats.map((c, ci) => catCard(g, c, ci)).join('');
  const anyUnknownOthers = rv.cats.some((c) => g.players.some((p) => p.id !== cid && c.rows[p.id].st === 'unknown' && !c.rows[p.id].half)) && !Q.isBotId(cid);
  const hint = anyUnknownOthers ? '<p class="sl-hint">Ein Wort mit dem Zeichen ungeprüft steht nicht im Wörterbuch. Kennst du es nicht, tippe auf Gilt nicht. Wenn die Mehrheit der anderen es auch nicht gelten lässt, gibt es dafür keine Punkte.</p>' : '';
  const last = g.round + 1 >= g.rounds;
  const bar = S.role === 'host'
    ? `<div class="sl-bar"><button class="btn primary huge" data-act="next">${last ? 'Zum Endergebnis' : 'Nächste Runde'}</button></div>`
    : `<div class="sl-bar"><p class="muted center sl-wait">Es geht gleich weiter, sobald der Gastgeber auf Weiter tippt.</p></div>`;
  return `${boardCard(g)}${hint}${cards}${rankCard(g, gains)}${bar}`;
}

let bestInfo = { key: null };
function soloBest(g) {
  const key = `${g.gid}|${g.rounds}`;
  if (bestInfo.key === key) return bestInfo;
  const score = g.scores[cid];
  const k = `sl_best_${g.rounds}_${g.cats.length}`;
  const prev = sess.get(k, null);
  const record = !S.learn && (prev === null || score > prev);
  if (record) sess.set(k, score);
  bestInfo = { key, prev, record, score };
  return bestInfo;
}

const ENDE = [
  'Das war ein Wortgefecht nach meinem Geschmack. Bis zum nächsten Mal!',
  'Was für ein Wortschatz! Ihr habt alle gewonnen, ein bisschen jedenfalls.',
  'Prima gespielt, ihr Lieben. Der Duden ist stolz auf euch!',
];
const ENDE_ALLEIN = [
  'Das war eine schöne Runde Wörter suchen. Komm bald wieder!',
  'So hält man den Kopf fit. Weiter so!',
];

function overHtml(g) {
  const rk = Q.ranking(g);
  const win = Q.winners(g);
  const solo = g.players.length === 1;
  const iWon = win.some((w) => w.id === cid);
  const nm = (w) => (w.id === cid ? 'Du' : (w.name === 'Computer' ? 'Der Computer' : esc(w.name)));
  let title; let trophy; let extra = '';
  if (solo) {
    const b = S.learn ? { record: false, prev: null } : soloBest(g);
    title = `Du hast ${g.scores[cid]} Punkte!`;
    trophy = b.record ? '🏆' : '🌟';
    if (!S.learn) extra = b.record ? `<p class="center big">Neue Bestleistung! 🎉${b.prev !== null ? ` Bisher: ${b.prev} Punkte` : ''}</p>` : `<p class="center big">Deine Bestleistung bei ${g.rounds} Runden: <b>${b.prev} Punkte</b></p>`;
  } else {
    trophy = iWon ? '🏆' : '🌟';
    const names = win.slice().sort((a, b) => (b.id === cid) - (a.id === cid)).map(nm);
    if (win.length === 1) title = `${names[0]} ${names[0] === 'Du' ? 'hast' : 'hat'} gewonnen 🎉`;
    else title = `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} ${names[0] === 'Du' ? 'habt' : 'haben'} gewonnen 🎉`;
    if (win.length > 1) extra = '<p class="center big">Gleichstand – ihr teilt euch den Sieg!</p>';
  }
  const medal = (r) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`);
  const lis = rk.map((r) => `<li class="${r.rank === 1 ? 'win' : ''}"><span class="medal">${medal(r)}</span><span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.score}</span></li>`).join('');
  const wirt = (solo ? ENDE_ALLEIN : ENDE)[g.gid % (solo ? ENDE_ALLEIN : ENDE).length];
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">Noch eine Runde</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `<section class="card over sl-over"><div class="trophy">${trophy}</div><h1>${title}</h1>${extra}
    <h2 class="center">Endstand</h2><ul class="ranking">${lis}</ul>
    <p class="center sl-bye">${esc(wirt)}</p>
    ${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
}

function gameHtml() {
  const g = S.game;
  let body;
  if (g.phase === 'over') body = overHtml(g);
  else if (g.phase === 'reveal' && g.reveal) body = revealHtml(g);
  else body = fillHtml(g);
  return `<div class="sl">${ui.header()}${ui.lost()}${bannerHtml(g)}${body}</div>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Zu jedem Buchstaben fällt dir zu jeder Kategorie ein Wort ein, zum Beispiel eine Stadt, ein Land oder ein Fluss. Wer am Ende die meisten Punkte hat, gewinnt. Du kannst allein spielen, gegen den Computer oder mit bis zu 8 Personen.</p>
    <h3>So läuft eine Runde ab</h3>
    <p>Ganz oben steht ein großer Buchstabe. Alle schreiben gleichzeitig in ihre Felder, zu jeder Kategorie ein Wort, das mit diesem Buchstaben beginnt. Groß oder klein ist egal. Tippe auf ein Feld, dann öffnet sich die Tastatur. Mit der Eingabetaste springst du zum nächsten Feld. Es gibt keinen Zeitdruck. Wenn du fertig bist, tippe unten auf Fertig. Die Runde endet, sobald alle fertig sind. Über Doch noch ändern kannst du deine Antworten wieder öffnen, solange nicht alle fertig sind.</p>
    <h3>Mit Stopp</h3>
    <p>Wenn der Gastgeber Mit Stopp eingeschaltet hat, darfst du STOPP tippen, sobald alle deine Felder ausgefüllt sind. Dann haben die anderen noch 30 Sekunden. Danach zählt, was eingetragen ist.</p>
    <h3>Die Punkte</h3>
    <ul>
      <li><b>10 Punkte:</b> Dein Wort passt und kein anderer hat dasselbe.</li>
      <li><b>5 Punkte:</b> Dein Wort passt, aber mindestens eine andere Person hat dasselbe.</li>
      <li><b>20 Punkte:</b> Dein Wort passt und du bist die einzige Person mit einer Antwort in dieser Kategorie.</li>
      <li><b>0 Punkte:</b> Das Feld ist leer oder das Wort passt nicht.</li>
    </ul>
    <h3>Wann passt ein Wort?</h3>
    <p>Es muss mit dem Buchstaben beginnen. Außerdem muss es im eingebauten Wörterbuch stehen oder die anderen dürfen es nicht anzweifeln. Ein Wort, das das Wörterbuch nicht kennt, steht bei der Auflösung als ungeprüft. Die anderen Personen können dann auf Gilt nicht tippen. Sobald die Mehrheit der anderen Personen das getan hat, gibt es keine Punkte dafür. Spielst du allein oder nur gegen den Computer, zählt ein ungeprüftes Wort mit halben Punkten.</p>
    <h3>Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du spielst für dich und kannst deine Bestleistung verbessern.</li>
      <li><b>Gegen den Computer:</b> Ein bis drei Computer spielen mit. Sie schreiben ihre Wörter nach ein paar Sekunden. Es gibt eine leichte und eine mittlere Stufe.</li>
      <li><b>Mit anderen:</b> Eröffne ein neues Spiel und schicke den Einladungs-Link oder den Code weiter. Bis zu 8 Personen sind möglich.</li>
    </ul>
    <p class="muted">Ein Spiel hat 6 Runden. Kurz sind 4 Runden, Lang sind 10. Mit dem Häkchen Mehr Kategorien kommen Pflanze und Obst sowie Essen und Trinken dazu.</p>`;
}

// ====================== Bedienung ======================
function flushDirty() {
  const g = S.game;
  clearTimeout(S.ui.sendTimer); S.ui.sendTimer = null;
  if (!g || g.phase !== 'fill' || !S.ui.dirty || !S.ui.dirty.size || !Array.isArray(S.ui.vals)) return;
  const list = [...S.ui.dirty];
  S.ui.dirty = new Set();
  for (const i of list) sess.send({ t: 'fill', r: g.round, cat: i, v: S.ui.vals[i] });
}
function sendAll(type) {
  const g = S.game;
  if (!g || g.phase !== 'fill') return;
  const v = valsOf(g).slice();
  S.ui.dirty = new Set(); clearTimeout(S.ui.sendTimer); S.ui.sendTimer = null;
  sess.send({ t: type, r: g.round, v });
}

const ui = createUI({
  solo: true, soloText: 'Du schreibst zu jedem Buchstaben deine Wörter und kannst deine Bestleistung verbessern.',
  sess, $app,
  title: 'Stadt, Land, Fluss', icon: '🏙️', sub: 'Das Wortspiel für 1 bis 8 Personen',
  options: OPTIONS,
  helpTitle: 'Die Spielregeln von Stadt, Land, Fluss', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'done': return sendAll('done');
      case 'stop': return sendAll('stop');
      case 'reopen': return sess.send({ t: 'reopen', r: g.round });
      case 'vote': return sess.send({ t: 'vote', r: g.round, pid: el.dataset.pid, cat: Number(el.dataset.cat) });
      case 'next': return sess.send({ t: 'next', r: g.round });
      case 'skipwait': return sess.send({ t: 'skip', r: g.round });
    }
  },
});

// Während der Runde offen ist, wird beim Eintreffen neuer Zustände NICHT alles neu gezeichnet (sonst würde die
// Tastatur zugehen oder ein angetipptes Feld verschwinden). Es werden nur Banner, Anleitung, Stopp-Anzeige und
// Knöpfe aufgefrischt. Alles andere ändert sich nur durch eigene Knöpfe (die zeichnen vollständig neu).
function keyOf(g) {
  return `${g.gid}|${g.round}|${g.phase}|${g.done && g.done[cid] ? 1 : 0}|${S.link}|${S.learn ? 1 : 0}|${S.ui.helpOpen ? 1 : 0}`;
}
function softUpdate(g) {
  const b = bannerInfo(g);
  const bn = $app.querySelector('.banner');
  if (bn) { bn.className = `banner${b.cls ? ' ' + b.cls : ''}`; bn.innerHTML = `<span class="banner-in">${b.text}</span>`; }
  if (S.learn) {
    const c = coach(g, { id: cid, S, ui: S.ui });
    const sp = $app.querySelector('.coach .coach-t span');
    if (sp && c && c.text) sp.textContent = c.text;
    $app.querySelectorAll('.coach-target').forEach((n) => n.classList.remove('coach-target'));
    if (c && c.target) { try { $app.querySelectorAll(c.target).forEach((n) => n.classList.add('coach-target')); } catch { /* ungültiger Selektor */ } }
  }
  const sz = document.getElementById('sl-stop');
  if (sz) {
    sz.innerHTML = stopZoneHtml(g);
    sz.classList.toggle('on', !!g.stopOpt);
  }
  const sk = document.getElementById('sl-skip');
  if (sk) sk.innerHTML = skipHtml(g);
  refreshButtons(g);
}
function refreshButtons(g) {
  const st = $app.querySelector('[data-act=stop]');
  if (st) st.disabled = !filledLocal(g) || !!g.stop;
  const ro = $app.querySelector('[data-act=reopen]');
  if (ro) ro.disabled = !!g.stop;
}
function render() {
  const g = S.game;
  if (g && S.screen === 'game' && g.phase === 'fill' && S.ui.key === keyOf(g) && $app.querySelector('.sl-in, [data-act=reopen]')) { softUpdate(g); return; }
  ui.render();
  S.ui.key = g && S.screen === 'game' ? keyOf(g) : '';
}

$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!t.classList || !t.classList.contains('sl-in') || !S.game) return;
  const g = S.game;
  const vals = valsOf(g);
  const i = Number(t.dataset.i);
  if (!Number.isInteger(i) || i < 0 || i >= vals.length) return;
  vals[i] = t.value;
  S.ui.dirty.add(i);
  clearTimeout(S.ui.sendTimer);
  S.ui.sendTimer = setTimeout(flushDirty, 400);
  refreshButtons(g);
});
$app.addEventListener('focusout', (ev) => {
  if (ev.target.classList && ev.target.classList.contains('sl-in')) flushDirty();
});
window.addEventListener('pagehide', flushDirty);
$app.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (ev.key !== 'Enter' || !t.classList || !t.classList.contains('sl-in')) return;
  ev.preventDefault();
  const all = [...$app.querySelectorAll('.sl-in:not([disabled])')];
  const next = all[all.indexOf(t) + 1];
  if (next) next.focus();
  else { t.blur(); const d = $app.querySelector('[data-act=done]'); if (d) d.focus(); }
});
$app.addEventListener('change', (ev) => {
  const t = ev.target;
  // "Kurz" und "Lang" schließen sich aus
  if (t && t.dataset && (t.dataset.opt === 'kurz' || t.dataset.opt === 'lang') && t.checked) {
    const other = t.dataset.opt === 'kurz' ? 'lang' : 'kurz';
    sess.setOpt(other, false);
    const box = $app.querySelector(`[data-opt="${other}"]`);
    if (box) box.checked = false;
  }
});
ui.boot();
