import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction } from './ai.js';
import { coach, TUTORIAL_TERMS } from './tutorial.js';
import { FRAGEN, THEMEN, KATEGORIEN, BEGRIFFE, frage } from './begriffe.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'kurz', label: 'Kurzes Spiel (3 Begriffe)', help: 'Ohne Häkchen sind es 5 Begriffe.', def: false },
];

const freshUi = () => ({ hint: '', seq: -1, gid: -1, pick: false, letter: '', sq: 0, sp: 0 });

const bot = {
  delay: 900,
  step: (g, level) => {
    if (!g || g.game !== 'wb' || g.phase !== 'ask') return null;
    const cur = g.players[g.turn];
    if (!cur || !E.isBotId(cur.id)) return null;
    const msg = chooseAction(g, cur.id, level, Math.random);
    return msg ? { id: cur.id, msg } : null;
  },
};

function makeGame(players, opts) {
  const host = sess.cid;
  if (S.learn) return E.createGame(players, { host, fixed: TUTORIAL_TERMS }, Math.random);
  let used = sess.get('wb_used', []);
  if (!Array.isArray(used)) used = [];
  const g = E.createGame(players, { host, kurz: !!(opts && opts.kurz), exclude: used }, Math.random);
  sess.set('wb_used', used.concat(g.terms).slice(-70));
  return g;
}

const sess = createSession({
  game: 'wb',
  maxPlayers: E.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => { S.ui = { ...freshUi(), ...(S.ui && S.ui.helpOpen ? { helpOpen: true } : {}) }; return makeGame(players, opts); },
  onMessage: (state, pid, msg) => { E.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
  bot,
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

function onStateChanged() {
  const g = S.game;
  if (g && (S.ui.seq !== g.seq || S.ui.gid !== g.gid)) {
    S.ui.seq = g.seq; S.ui.gid = g.gid; S.ui.hint = ''; S.ui.pick = false; S.ui.letter = '';
  }
  render();
}

// ====================== Hilfen ======================
const plainName = (p) => (E.isBotId(p.id) ? (p.name === 'Computer' ? 'Der Computer' : p.name) : p.name);
const isMe = (g, i) => g.players[i] && g.players[i].id === cid;
const connected = (id) => { const l = S.lobby.find((x) => x.id === id); return !l || l.connected !== false; };
const ANT = { ja: ['✓ Ja', 'Ja'], nein: ['✗ Nein', 'Nein'], teils: ['~ Teils', 'Teils'] };
const pts = (n) => `${n} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
const sortName = (n) => n.replace(/^(Der|Die|Das)\s+/, '');
const letterOf = (n) => sortName(n).charAt(0).toUpperCase().replace('Ä', 'A').replace('Ö', 'O').replace('Ü', 'U');
const catText = (g) => (KATEGORIEN[E.category(g)] || KATEGORIEN.tier);

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.phase === 'over') return '<div class="banner done">Das Spiel ist zu Ende</div>';
  if (g.phase === 'reveal') return `<div class="banner done">Aufgelöst – Begriff ${g.round + 1} von ${g.len}</div>`;
  const cur = g.players[g.turn];
  if (cur.id === cid) return `<div class="banner mine">Du bist dran – frage oder rate</div>`;
  if (E.isBotId(cur.id)) return `<div class="banner">${esc(plainName(cur))} überlegt …</div>`;
  return `<div class="banner">${esc(cur.name)} ist dran</div>`;
}

function chipsHtml(g) {
  const items = g.asked.map((x) => {
    const f = frage(x.q);
    const a = ANT[x.a] || ANT.teils;
    return `<span class="wb-chip a-${x.a}"><i aria-hidden="true">${f ? f.e : ''}</i><span>${esc(f ? f.t : x.q)}</span><b>${a[0]}</b><span class="sr">Antwort: ${a[1]}</span></span>`;
  });
  for (const w of g.wrong) {
    const t = E.term(w.id);
    items.push(`<span class="wb-chip wrong"><i aria-hidden="true">${t ? t.e : ''}</i><span>${t ? esc(t.n) : ''} geraten</span><b>✗ Falsch</b></span>`);
  }
  const inner = items.length ? items.join('') : '<span class="wb-empty">Noch keine Fragen gestellt. Hier erscheinen gleich alle Antworten.</span>';
  return `<div class="wb-chips" role="log" aria-label="Bisherige Antworten">${inner}</div>`;
}

function boardHtml(g) {
  const k = catText(g);
  const now = E.pointsFor(g.asked.length);
  const solo = g.players.length === 1;
  const l1 = `Begriff ${g.round + 1} von ${g.len} · ${g.asked.length === 1 ? '1 Frage' : g.asked.length + ' Fragen'}${solo ? ` · ${pts(g.scores[cid])}` : ''}`;
  const l2 = g.phase === 'ask' ? `Richtig raten bringt jetzt ${pts(now)}` : '';
  return `<section id="board" class="card wb-board">
    <p class="wb-cat" aria-label="${esc(k.sprech)}"><span class="wb-cat-in">${esc(k.text)} <span aria-hidden="true">${k.e}</span></span></p>
    <p class="wb-meta"><span>${esc(l1)}</span><span>${esc(l2)}</span></p>${chipsHtml(g)}</section>`;
}

function turnText(g) {
  const cur = g.players[g.turn];
  if (g.players.length === 1) return 'Du bist dran. Tippe auf eine Frage oder auf Ich weiß es.';
  if (cur.id === cid) return 'Du bist dran. Stelle eine Frage oder rate.';
  return `${plainName(cur)} ist dran.`;
}
function evtText(g) {
  const e = g.evt;
  if (!e) return '';
  const p = g.players.find((x) => x.id === e.by);
  if (!p) return '';
  const who = e.by === cid ? 'Du hast' : `${plainName(p)} hat`;
  if (e.kind === 'ask') {
    const f = frage(e.q);
    const a = ANT[e.a] || ANT.teils;
    return f ? `${who} gefragt: ${f.t} Antwort: ${a[1]}.` : '';
  }
  if (e.kind === 'wrong') {
    const t = E.term(e.id);
    return `${who} ${t ? t.n : 'einen Begriff'} geraten. Leider falsch, das kostet einen Punkt.`;
  }
  if (e.kind === 'skip') return 'Eine Person war nicht da und wurde übersprungen.';
  return '';
}
function actionHtml(g) {
  let text;
  if (S.ui.hint) text = S.ui.hint;
  else {
    const start = g.asked.length === 0 && g.wrong.length === 0 && !g.evt ? `${catText(g).text}. ` : '';
    const ev = evtText(g);
    text = `${start}${ev ? ev + ' ' : ''}${turnText(g)}`;
  }
  let skip = '';
  if (S.role === 'host' && g.players.length > 1) {
    const cur = g.players[g.turn];
    if (cur.id !== cid && !E.isBotId(cur.id) && !connected(cur.id)) skip = `<button class="btn ghost" data-act="skip">Ohne ${esc(cur.name)} weiter</button>`;
  }
  return `<section class="card action wb-action"><p class="big">${esc(text)}</p>${skip}</section>`;
}

function listHtml(g) {
  const mine = g.phase === 'ask' && isMe(g, g.turn);
  const done = new Map(g.asked.map((x) => [x.q, x.a]));
  const parts = [];
  for (const th of THEMEN) {
    const qs = FRAGEN.filter((f) => f.g === th);
    parts.push(`<h3 class="wb-th">${esc(th)}</h3>`);
    for (const f of qs) {
      if (done.has(f.id)) {
        const a = ANT[done.get(f.id)] || ANT.teils;
        parts.push(`<div class="wb-q done a-${done.get(f.id)}" role="listitem"><span class="e" aria-hidden="true">${f.e}</span><span class="t">${esc(f.t)}</span><b>${a[0]}</b></div>`);
      } else {
        parts.push(`<button class="wb-q${mine ? '' : ' wait'}" data-act="ask" data-q="${f.id}" role="listitem"><span class="e" aria-hidden="true">${f.e}</span><span class="t">${esc(f.t)}</span></button>`);
      }
    }
  }
  return `<div class="wb-qlist" role="list" aria-label="Fragen zum Aussuchen" tabindex="-1">${parts.join('')}</div>`;
}

function pickHtml(g) {
  const k = E.category(g);
  const wrong = new Set(g.wrong.map((w) => w.id));
  const all = BEGRIFFE.filter((b) => b.k === k).sort((a, b) => sortName(a.n).localeCompare(sortName(b.n), 'de'));
  const letters = [...new Set(all.map((b) => letterOf(b.n)))];
  const sel = S.ui.letter && letters.includes(S.ui.letter) ? S.ui.letter : '';
  const shown = sel ? all.filter((b) => letterOf(b.n) === sel) : all;
  const bar = `<div class="wb-letters" role="group" aria-label="Nach Anfangsbuchstaben filtern"><button class="wb-l${sel ? '' : ' on'}" data-act="letter" data-l="">Alle</button>${letters.map((l) => `<button class="wb-l${sel === l ? ' on' : ''}" data-act="letter" data-l="${l}">${l}</button>`).join('')}</div>`;
  const list = shown.map((b) => (wrong.has(b.id)
    ? `<button class="wb-t gone" disabled data-act="pick" data-id="${b.id}"><span class="e" aria-hidden="true">${b.e}</span><span class="t">${esc(b.n)}</span><b>✗ schon geraten</b></button>`
    : `<button class="wb-t" data-act="pick" data-id="${b.id}"><span class="e" aria-hidden="true">${b.e}</span><span class="t">${esc(b.n)}</span></button>`)).join('');
  return `<div class="wb-pickbox"><p class="wb-pickhead">Welcher Begriff ist es? <small>${esc(catText(g).text)}</small></p>${bar}<div class="wb-picklist" role="list" tabindex="-1">${list}</div></div>`;
}

function knowHtml(g) {
  if (S.ui.pick) return '<button class="btn secondary huge wb-know" data-act="pick-close">← Zurück zu den Fragen</button>';
  const mine = g.phase === 'ask' && isMe(g, g.turn);
  return `<button class="btn primary huge wb-know" data-act="know"${mine ? '' : ' disabled'}>🙋 Ich weiß es!</button>`;
}

function scoreHtml(g) {
  if (g.players.length === 1) return '';
  const items = g.players.map((p, i) => {
    const on = g.phase === 'ask' && g.turn === i;
    return `<li class="wb-pl${on ? ' on' : ''}"><span class="wb-pn">${esc(plainName(p))}${p.id === cid ? ' (du)' : ''}${on ? '<small>ist dran</small>' : ''}</span><span class="wb-pp"><b>${g.scores[p.id]}</b> ${Math.abs(g.scores[p.id]) === 1 ? 'Punkt' : 'Punkte'}</span></li>`;
  }).join('');
  return `<section class="card wb-score"><h2>Punkte</h2><ul class="wb-players">${items}</ul></section>`;
}

function revealHtml(g) {
  const rv = g.reveal;
  const t = E.term(rv.term);
  const by = g.players.find((p) => p.id === rv.by);
  const me = rv.by === cid;
  const solo = g.players.length === 1;
  const wer = me ? 'Du hast' : `${esc(plainName(by))} hat`;
  const line = `${wer} den Begriff mit ${rv.asked === 1 ? '1 Frage' : rv.asked + ' Fragen'} erraten und ${me ? 'bekommst' : 'bekommt'} ${pts(rv.pts)}.`;
  const last = g.round + 1 >= g.len;
  let next;
  if (S.role === 'host') next = `<button class="btn primary huge" data-act="next">${last ? 'Zum Ergebnis' : 'Nächster Begriff'}</button>`;
  else next = '<p class="muted center">Es geht gleich weiter, sobald der Gastgeber auf Weiter tippt.</p>';
  return `<section class="card action wb-reveal"><div class="wb-big" aria-hidden="true">${t.e}</div>
    <p class="big center">${solo ? 'Richtig! ' : ''}Ich war: <b>${esc(t.n)}</b></p><p class="center">${esc(line)}</p>${next}</section>`;
}

function soloBest(g) {
  const k = g.len === E.LENGTHS.normal ? 'wb_best' : `wb_best_${g.len}`;
  const key = `${g.gid}|${k}`;
  if (soloBest.key === key) return soloBest.info;
  const score = g.scores[cid];
  const prev = sess.get(k, null);
  const record = !S.learn && (prev === null || score > prev);
  if (record) sess.set(k, score);
  soloBest.key = key; soloBest.info = { prev, record, score };
  return soloBest.info;
}

function overHtml(g) {
  const rk = E.ranking(g);
  const win = E.winners(g);
  const solo = g.players.length === 1;
  const iWon = win.some((w) => w.id === cid);
  const nm = (w) => (w.id === cid ? 'Du' : plainName(w));
  let title; let trophy; let extra = '';
  if (solo) {
    const b = S.learn ? { record: false, prev: null } : soloBest(g);
    title = `Geschafft! Du hast ${pts(g.scores[cid])}!`;
    trophy = b.record ? '🏆' : '🏅';
    if (!S.learn) extra = b.record ? `<p class="center big">Neue Bestleistung! 🎉${b.prev !== null ? ` Bisher: ${pts(b.prev)}` : ''}</p>` : `<p class="center big">Deine Bestleistung: <b>${pts(b.prev)}</b></p>`;
  } else {
    trophy = iWon ? '🏆' : '👏';
    const names = win.slice().sort((a, b) => (b.id === cid) - (a.id === cid)).map(nm);
    if (win.length === 1) title = names[0] === 'Du' ? 'Du hast gewonnen! Glückwunsch!' : `${esc(names[0])} hat gewonnen!`;
    else title = `Gleichstand! ${names.slice(0, -1).map(esc).join(', ')} und ${esc(names[names.length - 1])} haben gewonnen.`;
    if (win.length > 1 && iWon) title = `Gleichstand! Du gewinnst zusammen mit ${win.filter((w) => w.id !== cid).map((w) => esc(plainName(w))).join(' und ')}.`;
  }
  const medal = (r) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`);
  const lis = rk.map((r) => `<li class="${r.rank === 1 ? 'win' : ''}"><span class="medal">${medal(r)}</span><span class="rn">${esc(plainName(r))}${r.id === cid ? ' (du)' : ''}<small>Richtig geraten: ${r.right} · falsch: ${r.wrong}</small></span><span class="rt">${pts(r.score)}</span></li>`).join('');
  const terms = g.results.map((r) => { const t = E.term(r.term); return `<li><span aria-hidden="true">${t.e}</span> ${esc(t.n)}</li>`; }).join('');
  const again = S.role === 'host'
    ? '<button class="btn primary huge" data-act="again">🕵️ Noch eine Runde</button>'
    : '<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>';
  return `<section class="card over wb-over"><div class="trophy">${trophy}</div><h1>${title}</h1>${extra}
    <ul class="ranking">${lis}</ul>
    <p class="center muted">Diese Begriffe waren dran:</p><ul class="wb-done">${terms}</ul>
    ${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return `${ui.header()}${ui.lost()}${bannerHtml(g)}${overHtml(g)}`;
  const reveal = g.phase === 'reveal';
  const mid = reveal ? revealHtml(g) : `${actionHtml(g)}<section class="card wb-listcard">${S.ui.pick ? pickHtml(g) : listHtml(g)}</section>${knowHtml(g)}`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${boardHtml(g)}${mid}${scoreHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Das Spiel denkt sich einen geheimen Begriff aus: ein Tier, einen Beruf, einen Gegenstand oder eine Märchenfigur. Finde heraus, was es ist, und rate schneller als die anderen.</p>
    <h3>So läuft ein Begriff ab</h3>
    <ol>
      <li>Oben steht, was ich bin, zum Beispiel <b>Ich bin ein Tier</b>. Das ist die Kategorie.</li>
      <li>Du tippst auf eine Frage-Karte, zum Beispiel „Lebe ich im Wasser?“. Das Spiel antwortet sofort mit <b>✓ Ja</b>, <b>✗ Nein</b> oder <b>~ Teils</b>. Teils heißt: Es stimmt nur manchmal oder bei manchen.</li>
      <li>Schon gestellte Fragen sind grau und zeigen ihre Antwort. Oben im Verlauf stehen alle Antworten dieser Runde. Eigene Fragen tippen gibt es nicht, du suchst nur aus der Liste aus.</li>
      <li>Du darfst jederzeit raten: Tippe auf <b>Ich weiß es!</b>. Dann siehst du alle Begriffe der Kategorie, alphabetisch. Tippe auf einen Buchstaben, um die Liste zu verkürzen, und dann auf den Begriff.</li>
    </ol>
    <h3>Punkte</h3>
    <ul>
      <li>Richtig geraten: zehn Punkte minus die Zahl der gestellten Fragen. Es zählen höchstens acht Fragen, du bekommst also mindestens zwei Punkte.</li>
      <li>Falsch geraten: ein Punkt Abzug. Bei mehreren Personen ist danach die nächste dran.</li>
    </ul>
    <h3>Die Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du rätst fünf Begriffe nacheinander. Deine Punkte zusammen sind dein Ergebnis. Die Bestleistung wird gemerkt.</li>
      <li><b>Gegen den Computer:</b> Ein bis drei Computer spielen mit. Sie sehen alle Antworten, aber nie den geheimen Begriff. Es gibt eine leichte und eine mittlere Stufe.</li>
      <li><b>Mit anderen online:</b> Bis zu 6 Personen. Reihum stellt jede Person genau eine Frage oder rät. Alle sehen alle Antworten. Wer richtig rät, bekommt die Punkte. Nach fünf Begriffen gewinnt, wer die meisten Punkte hat. Mit dem Häkchen bei Kurzes Spiel sind es drei Begriffe.</li>
    </ul>
    <p class="muted">Im Spiel gibt es bewusst keine Tipps, welche Frage gut wäre.</p>`;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du rätst fünf geheime Begriffe nacheinander und kannst deine Bestleistung verbessern.',
  sess, $app,
  title: 'Wer bin ich?', icon: '🕵️', sub: 'Das Ratespiel mit Ja-Nein-Fragen – allein, gegen den Computer oder mit anderen',
  options: OPTIONS,
  minPlayers: 2,
  helpTitle: 'Die Spielregeln von Wer bin ich?', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    const mine = g.phase === 'ask' && isMe(g, g.turn);
    const wait = () => { S.ui.hint = g.phase === 'ask' ? `Gerade ist ${plainName(g.players[g.turn])} dran. Bitte einen Moment Geduld.` : 'Tippe auf Weiter.'; return render(); };
    switch (act) {
      case 'ask': if (!mine) return wait(); S.ui.hint = ''; return sess.send({ t: 'ask', q: el.dataset.q, r: g.round });
      case 'know': if (!mine) return wait(); S.ui.pick = true; S.ui.letter = ''; S.ui.sp = 0; return render();
      case 'pick-close': S.ui.pick = false; S.ui.letter = ''; return render();
      case 'letter': S.ui.letter = el.dataset.l || ''; S.ui.sp = 0; return render();
      case 'pick': if (!mine) return wait(); return sess.send({ t: 'guess', id: el.dataset.id, r: g.round });
      case 'next': return sess.send({ t: 'next', r: g.round });
      case 'skip': return sess.send({ t: 'skip', r: g.round });
    }
    return undefined;
  },
});
function render() { ui.render(); }

// Scrollstand der Listen merken: das Spielfeld wird bei jedem Zustand neu gezeichnet, die Liste soll stehen bleiben.
$app.addEventListener('scroll', (ev) => {
  const t = ev.target;
  if (!t || !t.classList) return;
  if (t.classList.contains('wb-qlist')) S.ui.sq = t.scrollTop;
  else if (t.classList.contains('wb-picklist')) S.ui.sp = t.scrollTop;
}, true);
new MutationObserver(() => {
  const q = $app.querySelector('.wb-qlist'); if (q && Math.abs(q.scrollTop - S.ui.sq) > 1) q.scrollTop = S.ui.sq;
  const p = $app.querySelector('.wb-picklist'); if (p && Math.abs(p.scrollTop - S.ui.sp) > 1) p.scrollTop = S.ui.sp;
  const c = $app.querySelector('.wb-chips'); if (c) c.scrollTop = c.scrollHeight;
}).observe($app, { childList: true });
ui.boot();
