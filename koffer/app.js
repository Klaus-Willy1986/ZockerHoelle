import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, thinkMs } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const freshUi = () => ({ key: '', seq: [], add: null, hint: '', ack: '' });
const LEARN_CAP = 5; // Lernrunde: Der Koffer ist nach 5 Dingen voll

const OPTIONS = [
  { id: 'lives2', label: 'Mit Fehlerpunkten: erst nach 2 Fehlern raus', help: 'Ohne Haken scheidet aus, wer sich einmal vertut. Gilt nicht beim Alleinspielen.', def: false },
  { id: 'show', label: 'Mit Hilfe: Liste bleibt sichtbar', help: 'Wenn du dran bist, siehst du den ganzen Koffer. Gut zum Üben. Ohne Haken ist der Koffer zu.', def: false },
];

const humanAlive = (g) => g.players.some((p) => !p.out && !E.isBotId(p.id));
const bot = {
  // Denkzeit: 0,25 Sekunden pro Ding im Koffer (höchstens 4 Sekunden). Nach einem Computer-Ergebnis wartet das Spiel auf "Weiter".
  get delay() { const g = S.game; return g && g.phase === 'play' ? thinkMs(g.list.length) : 1200; },
  step: (g, level) => {
    if (!g || g.mode !== 'play') return null;
    if (g.phase === 'result') {
      const actor = g.last && g.players[g.last.by];
      if (!actor || !E.isBotId(actor.id) || humanAlive(g)) return null; // Menschen tippen selbst auf Weiter
      return { id: actor.id, msg: { t: 'weiter' } };
    }
    const cur = g.players[g.turn];
    if (!cur || !E.isBotId(cur.id)) return null;
    const msg = chooseAction(g, cur.id, level, Math.random);
    return msg ? { id: cur.id, msg } : null;
  },
};

const sess = createSession({
  game: 'kf',
  maxPlayers: E.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, o) => {
    S.ui = { ...freshUi(), ...(S.ui && S.ui.helpOpen ? { helpOpen: true } : {}) };
    const eo = S.learn ? { show: true, lives2: false, cap: LEARN_CAP } : { lives2: !!(o && o.lives2), show: !!(o && o.show) };
    return E.createGame(players, eo, Math.random);
  },
  onMessage: (state, pid, msg) => { E.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
  bot,
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const key = `${g.gid}|${g.turnNo}`;
    if (S.ui.key !== key) {
      S.ui.key = key; S.ui.seq = []; S.ui.add = null; S.ui.hint = '';
      if (g.mode === 'play' && g.phase === 'play') window.scrollTo(0, 0);
    }
  }
  render();
}

// ====================== Texte ======================
const meIndex = (g) => E.playerIndex(g, cid);
const plainName = (p) => (E.isBotId(p.id) ? (p.name === 'Computer' ? 'Der Computer' : p.name) : p.name);
const things = (n) => `${n} ${n === 1 ? 'Ding' : 'Dinge'}`;
const itemText = (id) => { const it = E.itemOf(id); return `${it.e} ${it.n}`; };
const curIsMe = (g) => g.mode === 'play' && g.phase === 'play' && g.players[g.turn].id === cid;

// Ergebnis des letzten Zuges als Satz, aus Sicht dieser Person
function resultLine(g) {
  const l = g.last;
  if (!l) return '';
  const p = g.players[l.by];
  const me = p.id === cid;
  if (l.ok) return `${me ? 'Du hast' : `${plainName(p)} hat`} richtig gepackt. Neues Ding: ${E.itemOf(l.added).n}. Der Koffer enthält jetzt ${things(l.n)}.`;
  const base = me ? 'Das war nicht ganz richtig.' : `Bei ${plainName(p).replace(/^Der /, 'dem ')} war es nicht ganz richtig.`;
  if (g.solo) return `${base} Dein Koffer enthielt ${things(l.n)}.`;
  const who = me ? 'Du' : plainName(p);
  if (l.out) return `${base} ${who} ${me ? 'bist' : 'ist'} raus.`;
  return `${base} ${who} ${me ? 'verlierst' : 'verliert'} einen Fehlerpunkt.`;
}

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.mode === 'over') {
    if (g.solo) return `<div class="banner done">${g.result.full ? 'Der Koffer ist voll!' : `Dein Koffer: ${things(g.list.length)}`}</div>`;
    if (g.result && g.result.full) return '<div class="banner done">Der Koffer ist voll!</div>';
    const w = g.players.find((p) => !p.out);
    return `<div class="banner done">${w && w.id === cid ? 'Du hast gewonnen!' : `${esc(w ? plainName(w) : '')} hat gewonnen!`}</div>`;
  }
  const cur = g.players[g.turn];
  if (g.phase === 'result') {
    const l = g.last;
    const p = g.players[l.by];
    const me = p.id === cid;
    if (l.ok) return `<div class="banner${me ? ' mine' : ''}">${me ? 'Du hast' : `${esc(plainName(p))} hat`} richtig gepackt: ${esc(itemText(l.added))}</div>`;
    return `<div class="banner">${me ? 'Das war nicht ganz richtig' : `Bei ${esc(plainName(p).replace(/^Der /, 'dem '))} war es nicht ganz richtig`}</div>`;
  }
  if (cur.id === cid) return `<div class="banner mine">${g.list.length ? 'Du bist dran: Was ist im Koffer?' : 'Du packst das erste Ding ein'}</div>`;
  if (E.isBotId(cur.id)) return `<div class="banner">${esc(plainName(cur))} überlegt …</div>`;
  return `<div class="banner">${esc(cur.name)} packt den Koffer</div>`;
}

function playersHtml(g) {
  if (g.solo) return '';
  const items = g.players.map((p, i) => {
    const on = g.mode === 'play' && g.turn === i && !p.out;
    const hearts = g.opts.lives2 && !p.out ? `<span class="kf-hearts" role="img" aria-label="${p.lives === 1 ? '1 Fehlerpunkt übrig' : p.lives + ' Fehlerpunkte übrig'}">${'❤️'.repeat(p.lives)}</span>` : '';
    const st = p.out ? '<span class="kf-st">raus</span>' : on ? '<span class="kf-st on">ist dran</span>' : '';
    return `<li class="kf-pl${on ? ' on' : ''}${p.out ? ' out' : ''}"><b class="kf-nm">${esc(plainName(p))}${p.id === cid ? ' (du)' : ''}</b><span class="kf-sub">${hearts}${st}</span></li>`;
  }).join('');
  return `<section class="card kf-rank"><ul class="kf-players" aria-label="Wer spielt mit">${items}</ul></section>`;
}

const tile = (id, cls = '', num = null) => {
  const it = E.itemOf(id);
  return `<span class="kf-tile ${cls}" data-id="${esc(id)}">${num === null ? '' : `<i class="kf-no">${num}</i>`}<span class="kf-te">${it.e}</span><span class="kf-tn">${esc(it.n)}</span></span>`;
};

function cardBtn(id, act, cls, label, num) {
  const it = E.itemOf(id);
  return `<button type="button" class="kf-card ${cls}" data-act="${act}" data-id="${esc(id)}" aria-label="${esc(label)}">${num ? `<i class="kf-no">${num}</i>` : ''}<span class="kf-e">${it.e}</span><span class="kf-n">${esc(it.n)}</span></button>`;
}

function myBoardHtml(g) {
  const n = g.list.length;
  const seq = S.ui.seq;
  const add = S.ui.add;
  const full = seq.length >= n;
  const grid = n ? g.grid.map((id) => {
    const k = seq.indexOf(id);
    if (k >= 0) return cardBtn(id, 'pick', 'chosen', `${E.itemOf(id).n}, schon als Nummer ${k + 1} gewählt`, k + 1);
    return cardBtn(id, 'pick', full ? 'dim' : '', E.itemOf(id).n);
  }).join('') : '';
  const offer = g.offer.map((id) => cardBtn(id, 'addpick', add === id ? 'sel' : '', `${E.itemOf(id).n}, neu einpacken`)).join('');
  const peek = g.opts.show && n ? `<div class="kf-peek"><p class="kf-h">So sieht dein Koffer aus (Hilfe):</p><div class="kf-peeklist">${g.list.map((id, i) => tile(id, 'sm', i + 1)).join('')}</div></div>` : '';
  const chips = seq.map((id, i) => `<span class="kf-chip" data-id="${esc(id)}" role="img" aria-label="Nummer ${i + 1}: ${esc(E.itemOf(id).n)}"><i>${i + 1}</i>${E.itemOf(id).e}</span>`).join('')
    + (add ? `<span class="kf-chip new" data-id="${esc(add)}" role="img" aria-label="Neu: ${esc(E.itemOf(add).n)}"><i>neu</i>${E.itemOf(add).e}</span>` : '');
  const empty = !seq.length && !add;
  return `<div id="board" class="kf-board kf-mine">
    <div class="kf-head"><span class="kf-bag" aria-hidden="true">🧳</span><div><p class="kf-closed">Dein Koffer ist zu</p><p class="kf-count">Dein Koffer enthält <b>${things(n)}</b></p></div></div>
    ${peek}
    <div class="kf-seqbar"><div class="kf-chips" role="list" aria-label="Deine gewählten Dinge">${empty ? `<span class="kf-ph">${n ? `Noch nichts gewählt (0 von ${n})` : 'Noch nichts gewählt'}</span>` : chips}</div>
      <button type="button" class="btn mini kf-undo" data-act="undo" ${empty ? 'disabled' : ''}>↩ Zurück</button></div>
    ${n ? `<h2 class="kf-h">Was ist schon im Koffer?</h2><p class="kf-sub2">Tippe die Dinge der Reihe nach an: ${seq.length} von ${n}</p>
      <div class="kf-grid" role="group" aria-label="Alle Karten, ${g.grid.length} Stück">${grid}</div>` : ''}
    <h2 class="kf-h">Packe etwas Neues ein</h2><p class="kf-sub2">Tippe auf ein Ding, das noch nicht im Koffer ist.</p>
    <div class="kf-offer" role="group" aria-label="Neue Dinge zur Auswahl">${offer}</div>
  </div>`;
}

function waitBoardHtml(g) {
  const cur = g.players[g.turn];
  const who = g.phase === 'result' ? g.players[g.last.by] : cur;
  const name = who.id === cid ? 'Dein' : `Der Koffer von ${esc(plainName(who))}`;
  const line = g.phase === 'result' ? 'Ergebnis' : (E.isBotId(who.id) ? `${esc(plainName(who))} überlegt …` : `${esc(who.name)} packt gerade`);
  return `<div id="board" class="kf-board kf-wait"><div class="kf-bigbag" aria-hidden="true">🧳</div>
    <p class="kf-closed">${name === 'Dein' ? 'Dein Koffer ist zu' : `${name} ist zu`}</p>
    <p class="kf-count">${who.id === cid ? 'Dein Koffer enthält' : 'Er enthält'} <b>${things(g.list.length)}</b></p>
    <p class="kf-sub2">${line}</p></div>`;
}

function boardHtml(g) {
  return `<section class="card kf-boardcard">${curIsMe(g) ? myBoardHtml(g) : waitBoardHtml(g)}</section>`;
}

function actionHtml(g) {
  const cur = g.players[g.turn];
  let text; let btn = '';
  if (g.phase === 'result') {
    text = resultLine(g);
    const actor = g.players[g.last.by];
    if (actor.id !== cid && !E.isBotId(actor.id) && E.playerIndex(g, cid) >= 0 && !unseen(g)) btn = `<button type="button" class="btn secondary kf-go" data-act="skip">Ohne ${esc(plainName(actor))} weiter</button>`;
  } else if (cur.id === cid) {
    const n = g.list.length; const { seq, add } = S.ui;
    const ready = seq.length === n && !!add;
    if (S.ui.hint) text = S.ui.hint;
    else if (!n) text = add ? 'Gut gewählt. Tippe auf Fertig.' : 'Dein Koffer ist noch leer. Tippe unten auf ein neues Ding.';
    else if (seq.length < n) text = `Tippe die Dinge der Reihe nach an: ${seq.length} von ${n}.`;
    else if (!add) text = `Alle ${n} Dinge sind gewählt. Jetzt noch ein neues Ding wählen.`;
    else text = 'Alles bereit. Tippe auf Fertig.';
    btn = `<button type="button" class="btn primary huge kf-go" data-act="fertig" ${ready ? '' : 'disabled'}>Fertig ✔</button>`;
  } else text = E.isBotId(cur.id) ? 'Der Computer überlegt. Du musst nichts tun.' : `${plainName(cur)} packt gerade. Bitte einen Moment Geduld.`;
  return `<section class="card action kf-action"><p class="big center">${esc(text)}</p>${btn}</section>`;
}

// Auflösung nach einem Fehler: Wie der Koffer wirklich gepackt war und was gewählt wurde
function resolveHtml(g) {
  const l = g.last;
  if (!l || l.ok) return '';
  const p = g.players[l.by];
  const me = p.id === cid;
  const exp = l.expected.map((id, i) => tile(id, `sm${i === l.firstBad ? ' mark' : ''}`, i + 1)).join('') || '<span class="muted">Der Koffer war leer.</span>';
  const got = l.seq.map((id, i) => tile(id, `sm${l.expected[i] === id ? ' good' : ' bad'}`, i + 1)).join('') || '<span class="muted">Nichts gewählt.</span>';
  return `<div class="kf-resolve"><h3>Im Koffer war:</h3><div class="kf-tiles">${exp}</div>
    <h3>${me ? 'Du hast gewählt:' : `${esc(plainName(p).replace(/^Der /, ''))} hat gewählt:`}</h3><div class="kf-tiles">${got}</div></div>`;
}

// Das Ergebnis eines Zuges (neues Ding, Auflösung) bleibt bei jeder Person stehen, bis sie selbst "Verstanden" oder "Weiter" tippt.
// So verpasst niemand ein neues Ding, auch wenn die Person, die dran war, schnell weitertippt.
const resultKey = (g) => (g.last ? `${g.gid}|${g.last.no}` : '');
const unseen = (g) => g.mode === 'play' && !!g.last && S.ui.ack !== resultKey(g);

function modalHtml(g) {
  if (!unseen(g) || S.ui.helpOpen) return '';
  const l = g.last;
  const p = g.players[l.by];
  const me = p.id === cid;
  const mayNext = g.phase === 'result' && (me || E.isBotId(p.id));
  let head; let body;
  if (l.ok) {
    head = `<div class="kf-ok">Richtig! 🎉</div>`;
    body = `<p class="center big">${me ? 'Neues Ding' : `${esc(plainName(p))} packt ein`}:</p>
      <div class="kf-newthing">${tile(l.added, 'lg')}</div>
      <p class="center big">Der Koffer enthält jetzt <b>${things(l.n)}</b>.</p>`;
  } else {
    head = '<div class="kf-bad">Das war nicht ganz richtig</div>';
    body = `<p class="center big">${esc(resultLine(g).replace(/^Das war nicht ganz richtig\. |^Bei .* war es nicht ganz richtig\. /, ''))}</p>${resolveHtml(g)}`;
  }
  const btn = mayNext
    ? '<button type="button" class="btn primary huge" data-act="weiter">Weiter ▶</button>'
    : `${g.phase === 'result' ? `<p class="center muted small">${esc(plainName(p))} sieht sich das Ergebnis auch an.</p>` : ''}<button type="button" class="btn primary huge" data-act="ack">Verstanden ▶</button>`;
  return `<div class="kf-modalwrap"><div class="kf-modal" role="dialog" aria-label="Ergebnis">${head}${body}<div class="kf-modalbtn">${btn}</div></div></div>`;
}

let soloKey = ''; let soloInfo = null;
function soloResult(g) {
  const key = `${g.gid}|${g.list.length}`;
  if (soloKey !== key) {
    soloKey = key;
    const prev = sess.get('kf_best', null);
    const len = g.list.length;
    const record = len > 0 && (prev === null || len > prev);
    soloInfo = { len, prev, record };
    if (record) sess.set('kf_best', len);
  }
  return soloInfo;
}

function scoreHtml(g) {
  if (!g.solo) return '';
  const best = sess.get('kf_best', null);
  return `<section class="card kf-score"><div class="kf-stats">
    <div><b>${g.list.length}</b><span>${g.list.length === 1 ? 'Ding' : 'Dinge'} im Koffer</span></div>
    <div><b>${best === null ? '–' : best}</b><span>Bestleistung</span></div></div></section>`;
}

function againHtml() {
  if (S.role === 'host') return '<button class="btn primary huge" data-act="again">🧳 Noch eine Runde spielen</button>';
  return '<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>';
}

function overHtml(g) {
  const o = E.outcome(g);
  const failed = g.last && !g.last.ok;
  const medals = ['🥇', '🥈', '🥉'];
  let body;
  if (o.solo) {
    const r = soloResult(g);
    const title = g.result.full ? 'Geschafft! Der Koffer ist voll.' : r.record ? `Neue Bestleistung: ${things(r.len)}!` : `Dein Koffer enthielt ${things(r.len)}.`;
    const line = r.record ? 'Besser als je zuvor. Bravo! 🎉' : r.prev === null ? '' : `Deine Bestleistung: <b>${things(r.prev)}</b>`;
    body = `<section class="card over kf-result"><div class="trophy">${r.record || g.result.full ? '🏆' : '🧳'}</div><h1>${title}</h1>
      ${failed ? '<p class="center big">Das war nicht ganz richtig.</p>' : ''}${line ? `<p class="center big">${line}</p>` : ''}
      ${againHtml()}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  } else {
    const mineWin = o.winners.includes(cid);
    const names = g.players.filter((p) => o.winners.includes(p.id));
    let title;
    if (o.full) title = names.length === 1 ? (mineWin ? 'Du hast gewonnen! Glückwunsch!' : `${esc(plainName(names[0]))} hat gewonnen!`) : (mineWin ? 'Du hast gewonnen! Glückwunsch!' : 'Der Koffer ist voll!');
    else title = mineWin ? 'Du hast gewonnen! Glückwunsch!' : `${esc(plainName(names[0]))} hat gewonnen!`;
    const rows = o.ranking.map((r) => `<li class="${r.win ? 'win' : ''}${r.out ? ' kf-gone' : ''}"><span class="medal">${r.rank <= 3 ? medals[r.rank - 1] : r.rank + '.'}</span><span class="rn">${esc(plainName(r))}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.out ? 'raus' : 'dabei'}</span></li>`).join('');
    body = `<section class="card over kf-result"><div class="trophy">${mineWin ? '🏆' : '👏'}</div><h1>${title}</h1>
      <p class="center muted">Es gewinnt, wer als Letzte oder Letzter noch im Spiel ist.</p><ul class="ranking">${rows}</ul>
      ${againHtml()}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  }
  const res = failed ? `<section class="card kf-resolvecard"><h2>Das war nicht ganz richtig</h2><p class="center">${esc(resultLine(g).replace(/^Das war nicht ganz richtig\. |^Bei .* war es nicht ganz richtig\. /, ''))}</p>${resolveHtml(g)}</section>` : '';
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${body}${res}${scoreHtml(g)}`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${playersHtml(g)}${boardHtml(g)}${actionHtml(g)}${scoreHtml(g)}${modalHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Du packst reihum einen Koffer. Wer sich nicht mehr erinnert, scheidet aus. Wer als Letzte oder Letzter übrig bleibt, gewinnt.</p>
    <h3>So geht ein Zug</h3>
    <ol>
      <li>Der Koffer ist zu. Du siehst nicht, was drin ist. Du musst es dir merken.</li>
      <li>Tippe alle Dinge, die schon im Koffer sind, <b>in der richtigen Reihenfolge</b> an. Oben siehst du, was du gewählt hast. Mit „Zurück“ nimmst du das zuletzt gewählte Ding wieder weg.</li>
      <li>Dann packst du <b>ein neues Ding</b> dazu: Tippe bei „Packe etwas Neues ein“ auf eine Karte, die noch nicht im Koffer ist.</li>
      <li>Tippe auf „Fertig“. Stimmt alles, liegt das neue Ding jetzt im Koffer und die nächste Person ist dran.</li>
    </ol>
    <h3>Wenn du dich vertust</h3>
    <p>Jede Abweichung zählt: ein falsches Ding oder eine falsche Reihenfolge. Dann scheidest du aus. Alle sehen danach, was wirklich im Koffer war. Mit der Option „Mit Fehlerpunkten“ darfst du dich einmal vertun und scheidest erst beim zweiten Fehler aus.</p>
    <h3>Die Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du packst so lange wie möglich. Wer sich vertut, ist fertig. Dein Rekord ist die Zahl der Dinge im Koffer. Er wird auf diesem Gerät gemerkt. Das neue Ding wählst du immer selbst.</li>
      <li><b>Gegen den Computer:</b> Der Computer vergisst manchmal etwas, wie ein Mensch. Er schaut nicht heimlich nach. Leicht vergisst früher, Mittel erst später.</li>
      <li><b>Mit anderen online:</b> Von 2 bis 8 Personen. Jede Person spielt auf ihrem eigenen Gerät.</li>
    </ul>
    <h3>Einstellungen auf der Startseite</h3>
    <ul>
      <li><b>Mit Hilfe: Liste bleibt sichtbar:</b> Du siehst den Koffer während deines Zuges. Gut zum Üben.</li>
      <li><b>Mit Fehlerpunkten:</b> Erst der zweite Fehler wirft dich aus dem Spiel.</li>
    </ul>
    <p class="muted">Die Lernrunde zeigt dir alles Schritt für Schritt. Tipps, was du wählen sollst, gibt es nicht: Das Merken ist das Spiel.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du packst allein so lange wie möglich. Wer sich vertut, ist fertig. Deine Bestleistung wird gemerkt.',
  sess, $app,
  title: 'Ich packe meinen Koffer', icon: '🧳', sub: 'Das Merkspiel mit Bildern – allein, gegen den Computer oder mit anderen',
  options: OPTIONS,
  minPlayers: 2,
  helpTitle: 'Die Spielregeln von Ich packe meinen Koffer', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3, 4, 5], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    const mine = curIsMe(g);
    switch (act) {
      case 'pick': {
        if (!mine) return undefined;
        const id = el.dataset.id;
        const { seq } = S.ui;
        if (seq.includes(id)) { S.ui.hint = 'Dieses Ding hast du schon gewählt. Mit Zurück nimmst du das letzte weg.'; return render(); }
        if (seq.length >= g.list.length) { S.ui.hint = 'Du hast schon alle Dinge gewählt. Wähle jetzt ein neues Ding oder tippe auf Zurück.'; return render(); }
        S.ui.hint = ''; seq.push(id);
        return render();
      }
      case 'addpick': {
        if (!mine) return undefined;
        S.ui.hint = '';
        S.ui.add = S.ui.add === el.dataset.id ? null : el.dataset.id;
        return render();
      }
      case 'undo': {
        if (!mine) return undefined;
        S.ui.hint = '';
        if (S.ui.seq.length) S.ui.seq.pop(); else S.ui.add = null;
        return render();
      }
      case 'fertig': {
        if (!mine) return undefined;
        const { seq, add } = S.ui;
        if (seq.length !== g.list.length || !add) return undefined;
        return sess.send({ t: 'submit', seq: seq.slice(), add });
      }
      case 'weiter': S.ui.ack = resultKey(g); return sess.send({ t: 'weiter' });
      case 'ack': S.ui.ack = resultKey(g); return render();
      case 'skip': return sess.send({ t: 'weiter', skip: true });
    }
    return undefined;
  },
});

// Die Folge-Leiste springt ans Ende, damit das zuletzt gewählte Ding sichtbar bleibt.
function render() {
  ui.render();
  const c = $app.querySelector('.kf-chips');
  if (c) c.scrollLeft = c.scrollWidth;
}
ui.boot();
