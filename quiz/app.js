import * as Q from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, thinkDelay } from './ai.js';
import { coach, TUTORIAL_BANK } from './tutorial.js';
import { FRAGEN, KATEGORIEN } from './fragen.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'kurz', label: 'Kurzes Quiz (8 Fragen)', help: 'Ohne Häkchen bei Kurz und Lang sind es 12 Fragen.', def: false },
  { id: 'lang', label: 'Langes Quiz (20 Fragen)', def: false },
  { id: 'joker', label: '50:50-Joker', help: 'Jede Person darf einmal pro Spiel zwei falsche Antworten ausblenden lassen (nur bei Fragen mit vier Antworten).', def: true },
  { id: 'timer', label: 'Mit Bedenkzeit 30 s', help: 'Pro Frage läuft ein Balken. Danach zählt die bisher gewählte Antwort, sonst keine. Ohne Häkchen gibt es kein Zeitlimit.', def: false },
];

// ?seed=123 in der Adresse: feste Mischung (für Tests). Sonst Zufall.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedParam = new URLSearchParams(location.search).get('seed');
const rng = seedParam !== null && /^\d+$/.test(seedParam) ? seededRng(Number(seedParam)) : Math.random;

const freshRound = () => ({ sig: '', est: null, ord: [], t0: Date.now(), drag: false, dirty: false });
const timers = { quiz: null, key: '', bots: new Set() };
function clearTimers() { clearTimeout(timers.quiz); timers.quiz = null; timers.key = ''; timers.bots.clear(); }

function makeGame(players, opts) {
  const base = { joker: opts.joker !== false, timer: !!opts.timer, host: sess.cid };
  if (S.learn) return Q.createGame(players, { ...base, joker: true, timer: false, fixed: TUTORIAL_BANK }, rng, []);
  const len = opts.lang ? Q.LENGTHS.lang : opts.kurz ? Q.LENGTHS.kurz : Q.LENGTHS.normal;
  let used = sess.get('qz_used', []);
  if (!Array.isArray(used)) used = [];
  const usedSet = new Set(used);
  if (FRAGEN.filter((q) => !usedSet.has(q.id)).length < 40) used = []; // fast alles schon gesehen: von vorn
  const g = Q.createGame(players, { ...base, len, exclude: used }, rng, FRAGEN);
  sess.set('qz_used', used.concat(g.qs.map((q) => q.id)));
  return g;
}

const sess = createSession({
  game: 'qz',
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
  if (g) {
    const sig = `${g.gid}|${g.qi}`;
    if (sig !== S.ui.sig) { Object.assign(S.ui, freshRound(), { sig }); }
    if (S.role === 'host') arm(g);
  }
  render();
}

// Gastgeber: Bedenkzeit und Computer-Antworten (nur Zeitgeber, die Regeln stehen in engine.js)
function arm(g) {
  if (g.phase !== 'ask') return;
  const tk = `${g.gid}|${g.qi}`;
  if (timers.key !== tk) {
    clearTimeout(timers.quiz);
    timers.key = tk;
    if (g.timer) {
      timers.quiz = setTimeout(() => {
        const cur = S.game;
        if (cur && cur.gid === g.gid && cur.qi === g.qi && cur.phase === 'ask') sess.send({ t: 'timeout', q: g.qi });
      }, Q.TIMER_MS);
    }
  }
  if (S.room !== 'SOLO') return;
  for (const p of g.players) {
    if (!Q.isBotId(p.id) || p.id in g.answers) continue;
    const k = `${tk}|${p.id}`;
    if (timers.bots.has(k)) continue;
    timers.bots.add(k);
    setTimeout(() => {
      const cur = S.game;
      if (!cur || cur.gid !== g.gid || cur.qi !== g.qi || cur.phase !== 'ask' || S.room !== 'SOLO') return;
      const msg = chooseAction(cur, p.id, S.level || 0, Math.random);
      if (msg) sess.send({ t: 'as', id: p.id, msg });
    }, thinkDelay(Math.random));
  }
}

// ====================== Hilfen ======================
const me = (g) => g.players.find((p) => p.id === cid);
const isBot = (p) => Q.isBotId(p.id);
const connected = (id) => { const l = S.lobby.find((x) => x.id === id); return !l || l.connected !== false; };
const nameOf = (p) => esc(p.name);
const fmt = Q.fmtNum;
const mugs = (score) => { const n = Math.floor(score / 10); return n > 10 ? '🍺'.repeat(10) + '+' : '🍺'.repeat(n); };
const mugLabel = (score) => `${Math.floor(score / 10)} Bierkrüge`;
const listNames = (ps) => {
  const n = ps.map(nameOf);
  if (n.length <= 3) return n.join(', ');
  return `${n.slice(0, 3).join(', ')} und ${n.length - 3} weitere`;
};
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

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
function questionSpeech(g) {
  const q = g.qs[g.qi];
  let t = `Frage ${g.qi + 1}. ${q.q}. `;
  if (q.t === 'mc') {
    const hid = g.hidden[cid] || [];
    t += q.a.map((a, i) => (hid.includes(i) ? '' : `${'ABCD'[i]}: ${a}.`)).join(' ');
  } else if (q.t === 'tf') t += 'Stimmt oder stimmt nicht?';
  else if (q.t === 'est') t += `Schätze eine Zahl${q.unit ? ' in ' + q.unit : ''}.`;
  else t += 'Bringe diese vier in die richtige Reihenfolge: ' + q.shown.map((i) => q.items[i]).join(', ') + '.';
  return t;
}
function revealSpeech(g) {
  const q = g.qs[g.qi]; const rv = g.reveal;
  const right = g.players.filter((p) => rv.res[p.id].ok);
  let t = `Richtig ist: ${Q.correctText(q)}. `;
  t += right.length ? `Richtig lagen: ${right.map((p) => p.name).join(', ')}. ` : 'Niemand lag richtig. ';
  return t + rv.comment;
}

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Quiz ist zu Ende</div>`;
  if (g.phase === 'reveal') return `<div class="banner done">Auflösung – Frage ${g.qi + 1} von ${g.len}</div>`;
  const pend = Q.pending(g);
  if (me(g) && !(cid in g.answers)) return `<div class="banner mine">Frage ${g.qi + 1} von ${g.len} – deine Antwort bitte</div>`;
  return `<div class="banner">Warte auf: ${listNames(pend)}</div>`;
}

function questionCard(g, reveal) {
  const q = g.qs[g.qi];
  const cat = (KATEGORIEN && KATEGORIEN[q.k]) || '';
  let bar = '<div class="qz-timer off" aria-hidden="true"></div>';
  if (g.timer && !reveal) {
    const el = Math.min(Q.TIMER_MS / 1000, (Date.now() - S.ui.t0) / 1000).toFixed(2);
    bar = `<div class="qz-timer" role="img" aria-label="Bedenkzeit 30 Sekunden"><i style="animation-delay:-${el}s"></i></div>`;
  }
  const read = speechOk ? `<button class="qz-read" data-act="read">🔊 ${reveal ? 'Auflösung' : 'Frage'} vorlesen</button>` : '<span></span>';
  return `<section id="board" class="card qz-q${reveal ? '' : ' action'}">
    <div class="qz-meta"><span class="qz-cat">${esc(cat)}</span><span class="qz-no">Frage ${g.qi + 1} von ${g.len}</span></div>${bar}
    <p class="${reveal ? '' : 'big '}qz-qtext">${esc(q.q)}</p>${read}</section>`;
}

function answerCard(g) {
  const q = g.qs[g.qi];
  const done = cid in g.answers;
  const mine = g.answers[cid];
  const dis = done ? ' disabled' : '';
  let inner = '';
  if (q.t === 'mc') {
    const hid = g.hidden[cid] || [];
    inner = `<div class="qz-opts">${q.a.map((t, i) => (hid.includes(i)
      ? `<div class="qz-opt gone" aria-hidden="true">–</div>`
      : `<button class="qz-opt${mine === i ? ' sel' : ''}" data-act="pick" data-i="${i}"${dis}><b>${'ABCD'[i]}</b><span>${esc(t)}</span></button>`)).join('')}</div>`;
    if (g.joker) {
      const used = !!g.jokerUsed[cid];
      inner += `<button class="btn secondary qz-joker" data-act="joker"${done || used ? ' disabled' : ''}>🎯 50:50-Joker ${used ? '(schon benutzt)' : '(noch 1)'}</button>`;
    }
  } else if (q.t === 'tf') {
    inner = `<div class="qz-tf"><button class="qz-opt${mine === true ? ' sel' : ''}" data-act="pick" data-v="1"${dis}><span>Stimmt</span></button>
      <button class="qz-opt${mine === false ? ' sel' : ''}" data-act="pick" data-v="0"${dis}><span>Stimmt nicht</span></button></div>`;
  } else if (q.t === 'est') {
    const v = done ? mine : (S.ui.est === null ? Q.estMid(q) : S.ui.est);
    const st = Q.estStep(q);
    inner = `<div class="qz-est"><output class="qz-val" id="qz-val" aria-live="off">${fmt(v)}${q.unit ? ` <small>${esc(q.unit)}</small>` : ''}</output>
      <input class="qz-range" type="range" min="${q.min}" max="${q.max}" step="${st}" value="${v}" aria-label="Deine Schätzung"${dis}>
      <div class="qz-mm"><span>${fmt(q.min)}</span><span>${fmt(q.max)}</span></div>
      <div class="qz-pm"><button class="qz-btn" data-act="est-minus" aria-label="Ein Schritt weniger"${dis}>−</button><button class="qz-btn" data-act="est-plus" aria-label="Ein Schritt mehr"${dis}>+</button></div>
      <div class="qz-pm two"><button class="qz-btn small" data-act="est-minus10" aria-label="Zehn Schritte weniger"${dis}>« viel weniger</button><button class="qz-btn small" data-act="est-plus10" aria-label="Zehn Schritte mehr"${dis}>viel mehr »</button></div>
      <button class="btn primary huge" data-act="est-ok"${dis}>Das ist meine Antwort</button></div>`;
  } else {
    const ord = done ? mine : S.ui.ord;
    const cards = q.shown.map((it, j) => {
      const pos = ord.indexOf(it);
      return `<button class="qz-card${pos >= 0 ? ' on' : ''}" data-act="ord-pick" data-j="${j}"${pos >= 0 || done ? ' disabled' : ''}><b class="qz-n">${pos >= 0 ? pos + 1 : ''}</b><span>${esc(q.items[it])}</span></button>`;
    }).join('');
    inner = `<div class="qz-ord"><p class="qz-hint">Tippe die vier Karten nacheinander an, in der Reihenfolge, die du für richtig hältst.</p><div class="qz-cards">${cards}</div>
      <div class="qz-pm two"><button class="qz-btn small" data-act="ord-undo"${done || !ord.length ? ' disabled' : ''}>↶ Zurück</button><button class="qz-btn small" data-act="ord-clear"${done || !ord.length ? ' disabled' : ''}>Neu anordnen</button></div>
      <button class="btn primary huge" data-act="ord-done"${done || ord.length !== q.items.length ? ' disabled' : ''}>Fertig</button></div>`;
  }
  let skip = '';
  if (S.role === 'host' && done) {
    const off = Q.pending(g).filter((p) => !connected(p.id));
    if (off.length) skip = `<button class="btn ghost" data-act="skipwait">Ohne ${listNames(off)} weiter</button>`;
  }
  return `<section class="card qz-ans t-${q.t}">${inner}</section>${skip}`;
}

function thekeCard(g, gains) {
  const rows = Q.ranking(g).map((r) => {
    const p = g.players.find((x) => x.id === r.id);
    const gain = gains && gains[r.id] ? `<em class="qz-gain">+${gains[r.id]}</em>` : '';
    return `<li class="${r.id === cid ? 'me' : ''}"><span class="qz-rk">${r.rank}.</span><span class="qz-nm">${nameOf(p)}${r.id === cid ? ' (du)' : ''}</span>${gain}<span class="qz-pt">${r.score}</span>
      <span class="qz-mugs" role="img" aria-label="${mugLabel(r.score)}">${mugs(r.score) || '&nbsp;'}</span></li>`;
  }).join('');
  return `<section class="card qz-theke"><h2>🍺 Die Theke</h2><ul>${rows}</ul></section>`;
}

function revealCard(g) {
  const q = g.qs[g.qi]; const rv = g.reveal;
  const multi = g.players.length > 1;
  let head;
  if (q.t === 'order') head = `<p class="big qz-right">Richtig ist diese Reihenfolge:</p><ol class="qz-ol">${q.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
  else head = `<p class="big qz-right">Richtig ist: <b>${esc(Q.correctText(q))}</b></p>`;
  let who;
  if (q.t === 'est' && multi) {
    const best = g.players.filter((p) => rv.res[p.id].rank === 1);
    who = best.length ? `Am nächsten dran: <b>${listNames(best)}</b>` : 'Niemand hat geschätzt.';
  } else {
    const right = g.players.filter((p) => rv.res[p.id].ok);
    who = multi ? (right.length ? `Richtig lagen: <b>${listNames(right)}</b>` : 'Niemand lag richtig.') : '';
  }
  const rows = g.players.filter((p) => multi || !isBot(p)).map((p) => {
    const r = rv.res[p.id];
    let detail = Q.answerText(q, r.a);
    if (q.t === 'order' && r.a) detail = `${r.hit} von 4 an der richtigen Stelle`;
    if (q.t === 'est' && r.a !== null) detail += ` (${r.dev === 0 ? 'genau richtig' : 'daneben: ' + fmt(r.dev)})`;
    const mark = r.ok ? '✔' : (r.pts ? '≈' : '✘');
    return `<li class="${r.ok ? 'ok' : ''}${p.id === cid ? ' me' : ''}"><span class="qz-mk" aria-hidden="true">${mark}</span><span class="qz-who"><b>${nameOf(p)}${p.id === cid ? ' (du)' : ''}</b><small>${esc(detail)}</small></span><span class="qz-pts">+${r.pts}</span></li>`;
  }).join('');
  const wirt = `<div class="qz-wirt"><span class="qz-av" aria-hidden="true">🍻</span><div><b>Der Kneipenwirt</b><p>${esc(rv.comment)}</p></div></div>`;
  let next;
  if (S.role === 'host') next = `<button class="btn primary huge" data-act="next">${g.qi + 1 >= g.len ? 'Zum Ergebnis' : 'Weiter'}</button>`;
  else next = `<p class="muted center">Es geht gleich weiter, sobald der Gastgeber auf Weiter tippt.</p>`;
  const gains = {};
  for (const p of g.players) gains[p.id] = rv.res[p.id].pts;
  return `<section class="card action qz-res">${head}${who ? `<p class="qz-whoright">${who}</p>` : ''}<ul class="qz-list">${rows}</ul>${wirt}${next}</section>${thekeCard(g, gains)}`;
}

let bestInfo = { key: null };
function soloBest(g) {
  const key = `${g.gid}|${g.qs.map((q) => q.id).join(',')}`;
  if (bestInfo.key === key) return bestInfo;
  const score = g.scores[cid];
  const k = `qz_best_${g.len}`;
  const prev = sess.get(k, null);
  const record = !S.learn && (prev === null || score > prev);
  if (record) sess.set(k, score);
  bestInfo = { key, prev, record, score };
  return bestInfo;
}

const ENDE = [
  'Das war ein schöner Abend. Die letzte Runde geht auf mich!',
  'Prost, ihr Lieben! Das machen wir bald wieder.',
  'Der Stammtisch hat gesprochen. Ich schenke noch einmal ein!',
  'Schön war es mit euch. Die Theke ist immer für euch offen.',
];
const ENDE_ALLEIN = [
  'Das war ein schöner Abend, Stammgast. Ich schenke dir noch eins ein!',
  'Prost! Komm bald wieder, ich halte deinen Platz frei.',
  'So macht Wissen Durst. Auf dein Wohl!',
];

function overCard(g) {
  const rk = Q.ranking(g);
  const win = Q.winners(g);
  const solo = g.players.length === 1;
  const iWon = win.some((w) => w.id === cid);
  const nm = (w) => (w.id === cid ? 'Du' : (w.name === 'Computer' ? 'Der Computer' : esc(w.name)));
  let title; let trophy; let extra = '';
  if (solo) {
    const b = S.learn ? { record: false, prev: null } : soloBest(g);
    title = `Prost! Du hast ${g.scores[cid]} Punkte!`;
    trophy = b.record ? '🏆' : '🍺';
    if (!S.learn) extra = b.record ? '<p class="center big">Neue Bestleistung! 🎉</p>' : `<p class="center big">Deine Bestleistung bei ${g.len} Fragen: <b>${b.prev} Punkte</b></p>`;
    if (!S.learn && b.record && b.prev !== null) extra = `<p class="center big">Neue Bestleistung! 🎉 Bisher: ${b.prev} Punkte</p>`;
  } else {
    trophy = iWon ? '🏆' : '🍺';
    const names = win.slice().sort((a, b) => (b.id === cid) - (a.id === cid)).map(nm);
    if (win.length === 1) title = `${names[0]} ${names[0] === 'Du' ? 'bist' : 'ist'} Stammtisch-König/Königin 👑`;
    else title = `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} sind Stammtisch-König/Königin 👑`;
    if (win.length > 1) extra = '<p class="center big">Gleichstand – ihr teilt euch die Krone!</p>';
  }
  const medal = (r) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`);
  const lis = rk.map((r) => `<li class="${r.rank === 1 ? 'win' : ''}"><span class="medal">${medal(r)}</span><span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}<small>Richtig: ${r.right} von ${r.total}</small></span><span class="rt">${r.score}</span>
    <span class="rd" role="img" aria-label="${mugLabel(r.score)}">${mugs(r.score)}</span></li>`).join('');
  const wirt = (solo ? ENDE_ALLEIN : ENDE)[g.gid % (solo ? ENDE_ALLEIN : ENDE).length];
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🍻 Noch eine Runde</button>`
    : `<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `<section class="card over qz-over"><div class="trophy">${trophy}</div><h1>${title}</h1>${extra}
    <h2 class="center">🍺 Die Theke – Endstand</h2><ul class="ranking">${lis}</ul>
    <div class="qz-wirt"><span class="qz-av" aria-hidden="true">🍻</span><div><b>Der Kneipenwirt</b><p>${esc(wirt)}</p></div></div>
    ${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
}

function gameHtml() {
  const g = S.game;
  let body;
  if (g.phase === 'over') body = overCard(g);
  else if (g.phase === 'reveal') body = `${questionCard(g, true)}${revealCard(g)}`;
  else body = `${questionCard(g, false)}${answerCard(g)}${thekeCard(g)}`;
  return `<div class="qz">${ui.header()}${ui.lost()}${bannerHtml(g)}${body}</div>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Beantworte die Fragen des Kneipenwirts und sammle Punkte. Wer am Ende die meisten Punkte auf der Theke hat, ist Stammtisch-König oder Stammtisch-Königin. Du kannst allein spielen oder mit bis zu 8 Personen.</p>
    <h3>So läuft eine Frage ab</h3>
    <p>Alle bekommen dieselbe Frage und antworten gleichzeitig auf dem eigenen Gerät. Es gibt kein Zeitlimit, außer ihr schaltet die Bedenkzeit ein. Erst wenn alle geantwortet haben, kommt die Auflösung. Dort steht die richtige Antwort, wer richtig lag und ein Spruch vom Kneipenwirt. Beim Gastgeber tippst du dann auf Weiter.</p>
    <h3>Die vier Arten von Fragen</h3>
    <ul>
      <li><b>Vier Antworten (A bis D):</b> Tippe auf die Antwort, die du für richtig hältst. Richtig gibt 10 Punkte.</li>
      <li><b>Stimmt oder stimmt nicht:</b> Tippe auf einen der beiden Knöpfe. Richtig gibt 10 Punkte.</li>
      <li><b>Schätzfrage:</b> Stelle eine Zahl ein, mit dem Schieberegler oder mit Plus und Minus. Dann tippe auf Das ist meine Antwort. Wer am nächsten dran ist, bekommt 15 Punkte, die zweitbeste Antwort 10 Punkte, die drittbeste 5 Punkte. Wer genau richtig liegt, bekommt 5 Punkte extra. Liegen zwei gleich nah, bekommen beide dieselben Punkte.</li>
      <li><b>Reihenfolge:</b> Tippe die vier Karten nacheinander an, in der Reihenfolge, die du für richtig hältst. Mit Zurück nimmst du die letzte Karte weg, mit Neu anordnen alle. Dann tippe auf Fertig. Jede Karte an der richtigen Stelle gibt 3 Punkte, alles richtig gibt 3 Punkte extra.</li>
    </ul>
    <h3>Der 50:50-Joker</h3>
    <p>Jede Person hat einmal pro Spiel einen Joker. Er blendet bei einer Frage mit vier Antworten zwei falsche Antworten für dich aus. Tippe den Joker vor deiner Antwort an. Bei den anderen Fragearten gibt es ihn nicht.</p>
    <h3>Die Theke</h3>
    <p>Die Theke zeigt alle Punkte. Pro 10 Punkte steht ein Bierkrug neben dem Namen.</p>
    <h3>Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du spielst für dich. Deine Bestleistung wird für jede Länge des Quiz gemerkt.</li>
      <li><b>Gegen den Computer:</b> Ein bis drei Computer spielen mit. Sie antworten nach ein paar Sekunden. Es gibt eine leichte und eine mittlere Stufe.</li>
      <li><b>Mit anderen:</b> Eröffne ein neues Spiel und schicke den Einladungs-Link oder den Code weiter. Bis zu 8 Personen sind möglich.</li>
    </ul>
    <p class="muted">Dein Gerät kann dir die Fragen auch vorlesen. Tippe dafür auf Frage vorlesen.</p>`;
}

// ====================== Bedienung ======================
const clampEst = (q, v) => {
  const st = Q.estStep(q);
  const x = q.min + Math.round((v - q.min) / st) * st;
  return Number(Math.min(q.max, Math.max(q.min, x)).toPrecision(12));
};
function draft(v) {
  const g = S.game;
  if (g && g.timer && g.phase === 'ask' && !(cid in g.answers)) sess.send({ t: 'draft', q: g.qi, v });
}
function estShift(dir, mult) {
  const g = S.game; const q = g.qs[g.qi];
  const cur = S.ui.est === null ? Q.estMid(q) : S.ui.est;
  S.ui.est = clampEst(q, cur + dir * mult * Q.estStep(q));
  draft(S.ui.est);
  render();
}

const ui = createUI({
  solo: true, soloText: 'Du beantwortest die Fragen des Kneipenwirts für dich allein und kannst deine Bestleistung verbessern.',
  sess, $app,
  title: 'Kneipenquiz', icon: '🍻', sub: 'Geselliges Quiz für 1 bis 8 Personen',
  options: OPTIONS,
  helpTitle: 'Die Spielregeln vom Kneipenquiz', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    const q = g.qs[g.qi];
    switch (act) {
      case 'pick': {
        const v = q.t === 'mc' ? Number(el.dataset.i) : el.dataset.v === '1';
        return sess.send({ t: 'answer', q: g.qi, v });
      }
      case 'joker': return sess.send({ t: 'joker', q: g.qi });
      case 'est-minus': return estShift(-1, 1);
      case 'est-plus': return estShift(1, 1);
      case 'est-minus10': return estShift(-1, 10);
      case 'est-plus10': return estShift(1, 10);
      case 'est-ok': return sess.send({ t: 'answer', q: g.qi, v: S.ui.est === null ? Q.estMid(q) : S.ui.est });
      case 'ord-pick': {
        const it = q.shown[Number(el.dataset.j)];
        if (S.ui.ord.includes(it) || S.ui.ord.length >= q.items.length) return;
        S.ui.ord.push(it);
        if (S.ui.ord.length === q.items.length) draft(S.ui.ord.slice());
        return render();
      }
      case 'ord-undo': S.ui.ord.pop(); draft(null); return render();
      case 'ord-clear': S.ui.ord = []; draft(null); return render();
      case 'ord-done':
        if (S.ui.ord.length !== q.items.length) return;
        return sess.send({ t: 'answer', q: g.qi, v: S.ui.ord.slice() });
      case 'next': return sess.send({ t: 'next', q: g.qi });
      case 'skipwait': return sess.send({ t: 'timeout', q: g.qi });
      case 'read': return speak(g.phase === 'reveal' ? revealSpeech(g) : questionSpeech(g));
    }
  },
});

// Während der Schieberegler gezogen wird, nicht neu zeichnen (sonst reißt der Finger ab)
function render() {
  if (S.ui.drag) { S.ui.dirty = true; return; }
  ui.render();
}
let dragTimer = null;
const endDrag = () => {
  clearTimeout(dragTimer);
  if (!S.ui.drag) return;
  S.ui.drag = false;
  if (S.ui.dirty) { S.ui.dirty = false; render(); }
};
$app.addEventListener('pointerdown', (ev) => {
  if (ev.target.classList && ev.target.classList.contains('qz-range')) {
    S.ui.drag = true;
    clearTimeout(dragTimer); dragTimer = setTimeout(endDrag, 6000);
  }
});
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!t.classList || !t.classList.contains('qz-range') || !S.game) return;
  const q = S.game.qs[S.game.qi];
  S.ui.est = clampEst(q, Number(t.value));
  const out = document.getElementById('qz-val');
  if (out) out.innerHTML = `${esc(fmt(S.ui.est))}${q.unit ? ` <small>${esc(q.unit)}</small>` : ''}`;
});
$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.classList && t.classList.contains('qz-range') && S.game) { draft(S.ui.est); endDrag(); }
  // "Kurz" und "Lang" schließen sich aus
  if (t && t.dataset && (t.dataset.opt === 'kurz' || t.dataset.opt === 'lang') && t.checked) {
    const other = t.dataset.opt === 'kurz' ? 'lang' : 'kurz';
    sess.setOpt(other, false);
    const box = $app.querySelector(`[data-opt="${other}"]`);
    if (box) box.checked = false;
  }
});
ui.boot();
