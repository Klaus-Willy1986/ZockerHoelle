import * as E from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const AUTO_BACK_MS = 1500; // ohne "Karten bleiben aufgedeckt": so lange liegen zwei verschiedene Karten offen
const freshUi = () => ({ hint: '', seq: -1, animSeen: -1 });

// Die Einstellungen der Startseite sind Kästchen (ui.js). Wir machen daraus Größe, Bilder und Aufdeck-Verhalten.
const OPTIONS = [
  { id: 'klein', label: 'Kleines Spiel', help: '12 Karten (4 × 3), 6 Paare. Ohne Haken bei den Größen: mittleres Spiel mit 16 Karten (4 × 4).', def: false },
  { id: 'gross', label: 'Großes Spiel', help: '20 Karten (5 × 4), 10 Paare', def: false },
  { id: 'riesig', label: 'Riesiges Spiel', help: '30 Karten (6 × 5), 15 Paare. Gilt vor „Großes Spiel“.', def: false },
  { id: 'fruechte', label: 'Bilder: Obst und Gemüse', help: 'Ohne Haken bei den Bildern: Tiere. Bei mehreren Haken gilt der oberste.', def: false },
  { id: 'fahrzeuge', label: 'Bilder: Fahrzeuge', def: false },
  { id: 'natur', label: 'Bilder: Natur', def: false },
  { id: 'hold', label: 'Karten bleiben aufgedeckt, bis ich auf „Weiter“ tippe', help: 'So musst du dich nicht beeilen. Ohne Haken drehen sich zwei verschiedene Karten nach etwa 1,5 Sekunden von selbst um.', def: true },
];
function engineOpts(o) {
  return {
    size: o.riesig ? 'riesig' : o.gross ? 'gross' : o.klein ? 'klein' : 'mittel',
    theme: o.fruechte ? 'fruechte' : o.fahrzeuge ? 'fahrzeuge' : o.natur ? 'natur' : 'tiere',
    hold: !!o.hold,
  };
}

const bot = {
  // Ein Computer-Aufdecken dauert etwa eine Sekunde; wenn zwei verschiedene Karten offen liegen, bekommen alle etwas länger Zeit zum Merken.
  get delay() { return S.game && S.game.pending ? AUTO_BACK_MS : 900; },
  step: (g, level) => {
    if (!g || g.mode !== 'play') return null;
    const cur = g.players[g.turn];
    if (!cur || !E.isBotId(cur.id)) return null;
    const msg = chooseAction(g, cur.id, level, Math.random);
    return msg ? { id: cur.id, msg } : null;
  },
};

const sess = createSession({
  game: 'pf',
  maxPlayers: E.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, o) => {
    S.ui = { ...freshUi(), ...(S.ui && S.ui.helpOpen ? { helpOpen: true } : {}) };
    // In der Lernrunde immer das kleine Spiel mit Tieren
    const eo = S.learn ? { size: 'klein', theme: 'tiere', hold: true } : engineOpts(o || {});
    return E.createGame(players, eo, Math.random);
  },
  onMessage: (state, pid, msg) => { E.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { clearTimeout(autoTimer); S.ui = freshUi(); },
  bot,
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Zustandswechsel ======================
let autoTimer = null;
let autoSeq = -1;
function onStateChanged() {
  const g = S.game;
  if (g) {
    if (S.ui.seq !== g.seq) { S.ui.seq = g.seq; S.ui.hint = ''; }
    // Ohne "Karten bleiben aufgedeckt": Der Gastgeber dreht nach kurzer Zeit selbst um (Computerzüge regelt die Sitzung).
    const cur = g.players[g.turn];
    if (S.role === 'host' && g.mode === 'play' && g.pending && !g.hold && cur && !E.isBotId(cur.id)) {
      if (autoSeq !== g.seq) {
        autoSeq = g.seq;
        clearTimeout(autoTimer);
        const seq = g.seq;
        autoTimer = setTimeout(() => { if (S.game && S.game.seq === seq && S.game.pending) sess.send({ t: 'weiter' }); }, AUTO_BACK_MS);
      }
    }
  }
  render();
}

// ====================== Rollen und Texte ======================
const meIndex = (g) => E.playerIndex(g, cid);
const plainName = (p) => (E.isBotId(p.id) ? (p.name === 'Computer' ? 'Der Computer' : p.name) : p.name);
const tries = (n) => `${n} ${n === 1 ? 'Versuch' : 'Versuche'}`;
const pairs = (n) => `${n} ${n === 1 ? 'Paar' : 'Paare'}`;

// ====================== Darstellung ======================
function cardHtml(g, i, anim) {
  const s = g.st[i];
  const evt = anim ? g.evt : null;
  const inEvt = !!evt && evt.cards.includes(i);
  const newest = inEvt && (evt.kind === 'flip' ? true : (evt.kind === 'miss' || evt.kind === 'match') && evt.cards[1] === i);
  const back = inEvt && evt.kind === 'back';
  const face = E.faceOf(g, i);
  const it = face === null ? null : E.itemOf(g.theme, face);
  const cls = ['pf-card', s === 0 ? 'down' : s === 1 ? 'up' : 'gone'];
  if (inEvt && evt.kind === 'match') cls.push('glow');
  if (back) cls.push('a-back');
  const inner = newest ? ' a-flip' : '';
  // Das Bild einer verdeckten Karte steht nie im Dokument (nur kurz beim Zurückdrehen einer Karte, die schon alle gesehen haben).
  let frontItem = it;
  if (back) {
    const seen = g.reveals.length ? [...g.reveals].reverse().find((r) => r.i === i) : null;
    frontItem = seen ? E.itemOf(g.theme, seen.c) : null;
  }
  const front = frontItem ? `<span class="pf-face pf-front" aria-hidden="true"><span class="pf-emoji">${frontItem.e}</span></span>` : '';
  const label = s === 0 ? `Karte ${i + 1}, verdeckt` : s === 1 ? `Karte ${i + 1}: ${it.n}` : `Karte ${i + 1}: ${it.n}, schon gefunden`;
  return `<button class="${cls.join(' ')}" data-act="card" data-i="${i}" aria-label="${esc(label)}"${s === 2 ? ' disabled' : ''}><span class="pf-in${inner}"><span class="pf-face pf-back"></span>${front}</span></button>`;
}

function boardHtml(g, anim) {
  const cells = [];
  for (let i = 0; i < g.cards.length; i++) cells.push(cardHtml(g, i, anim));
  return `<section class="card pf-boardcard"><div id="board" class="pf-board size-${g.size}" style="--cols:${g.cols};--rows:${g.rows}" role="group" aria-label="Spielfeld mit ${g.cards.length} Karten">${cells.join('')}</div></section>`;
}

function bannerHtml(g) {
  if (g.mode === 'over') return '<div class="banner done">Alle Paare gefunden!</div>';
  const cur = g.players[g.turn];
  const mine = cur.id === cid;
  const solo = g.players.length === 1;
  const evt = g.evt;
  const cls = mine ? 'banner mine' : 'banner';
  if (g.pending) return mine ? `<div class="${cls}">Leider kein Paar. Merke dir die Bilder!</div>` : `<div class="${cls}">Bei ${esc(plainName(cur).replace(/^Der /, 'dem '))} war es kein Paar</div>`;
  if (evt && evt.kind === 'match' && evt.seq === g.seq && !g.open.length) {
    const it = E.itemOf(g.theme, evt.c);
    const by = g.players[evt.by];
    const who = by.id === cid ? 'Du hast' : `${esc(plainName(by))} hat`;
    return `<div class="${cls}">${who} ein Paar gefunden: ${esc(it.n)} ${it.e}</div>`;
  }
  if (mine) {
    if (g.open.length === 1) return `<div class="${cls}">Deck jetzt die zweite Karte auf</div>`;
    return `<div class="${cls}">${solo ? `Versuch ${g.tries + 1}: Deck zwei Karten auf` : 'Du bist dran – deck zwei Karten auf'}</div>`;
  }
  if (E.isBotId(cur.id)) return `<div class="${cls}">${esc(plainName(cur))} überlegt …</div>`;
  return `<div class="${cls}">${esc(cur.name)} ist dran</div>`;
}

function actionHtml(g) {
  const cur = g.players[g.turn];
  const mine = cur.id === cid;
  let text; let btn = '';
  if (S.ui.hint) text = S.ui.hint;
  else if (g.pending && mine) {
    text = g.hold ? 'Merke dir die beiden Bilder. Dann tippe auf Weiter.' : 'Merke dir die Bilder. Gleich drehen sie sich von selbst um.';
  } else if (g.pending) text = g.hold ? 'Gleich geht es weiter.' : 'Die Karten drehen sich gleich wieder um.';
  else if (mine) text = g.open.length === 1 ? 'Tippe auf eine zweite verdeckte Karte.' : 'Tippe auf eine verdeckte Karte.';
  else text = E.isBotId(cur.id) ? 'Der Computer deckt auf. Du musst nichts tun.' : 'Bitte einen Moment Geduld.';
  if (g.pending && mine) btn = '<button class="btn primary huge pf-next" data-act="weiter">Weiter ▶</button>';
  return `<section class="card action pf-action"><p class="big center">${esc(text)}</p>${btn}</section>`;
}

let soloKey = ''; let soloInfo = null;
function soloResult(g) {
  const key = JSON.stringify([g.cards, g.tries]);
  if (soloKey !== key) {
    soloKey = key;
    const k = 'pf_best_' + g.size;
    const prev = sess.get(k, null);
    const record = prev === null || g.tries < prev;
    soloInfo = { tries: g.tries, prev, record };
    if (record) sess.set(k, g.tries);
  }
  return soloInfo;
}

function scoreHtml(g) {
  if (g.players.length === 1) {
    const best = sess.get('pf_best_' + g.size, null);
    return `<section class="card pf-score"><div class="pf-stats">
      <div><b>${g.tries}</b><span>Versuche</span></div>
      <div><b>${g.found.length} von ${g.pairs}</b><span>Paare gefunden</span></div></div>
      <p class="center muted small pf-best">${best === null ? 'Noch keine Bestleistung bei dieser Größe.' : `Bestleistung: ${tries(best)}`}</p></section>`;
  }
  const items = g.players.map((p, i) => {
    const on = g.mode === 'play' && g.turn === i;
    return `<li class="pf-pl${on ? ' on' : ''}"><span class="pf-pn">${esc(plainName(p))}${p.id === cid ? ' (du)' : ''}${on ? '<small>ist dran</small>' : ''}</span><span class="pf-pp"><b>${g.scores[i]}</b> ${g.scores[i] === 1 ? 'Paar' : 'Paare'}</span></li>`;
  }).join('');
  return `<section class="card pf-score"><ul class="pf-players">${items}</ul><p class="center muted small">Noch ${g.pairs - g.found.length} von ${g.pairs} Paaren zu finden</p></section>`;
}

function againHtml() {
  if (S.role === 'host') return '<button class="btn primary huge" data-act="again">🃏 Noch eine Runde spielen</button>';
  return '<p class="muted center">Der Gastgeber kann eine neue Runde starten. Du bleibst einfach auf dieser Seite.</p>';
}

function resultHtml(g) {
  const o = E.outcome(g);
  if (o.kind === 'solo') {
    const r = soloResult(g);
    const line = r.record ? 'Neue Bestleistung! 🎉' : `Deine Bestleistung: <b>${tries(r.prev)}</b>`;
    return `<section class="card over pf-result"><div class="trophy">🏆</div>
      <h1>Geschafft! Alle ${g.pairs} Paare gefunden.</h1>
      <p class="center big">Du hast <b>${tries(r.tries)}</b> gebraucht.</p>
      <p class="center big">${line}</p>
      <button class="btn primary huge" data-act="again">🃏 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  }
  const rk = o.ranking;
  const mineWin = o.winners.includes(cid);
  const names = o.winners.map((id) => g.players.find((p) => p.id === id));
  let title;
  if (o.winners.length === 1) {
    title = mineWin ? 'Du hast gewonnen! Glückwunsch!' : `${esc(plainName(names[0]))} hat gewonnen!`;
  } else {
    const others = names.filter((p) => p.id !== cid).map((p) => esc(plainName(p)));
    title = mineWin ? `Gleichstand! Du gewinnst zusammen mit ${others.join(' und ')}.` : `Gleichstand! ${names.map((p) => esc(plainName(p))).join(' und ')} haben gewonnen.`;
  }
  const medals = ['🥇', '🥈', '🥉', '4.'];
  const rows = rk.map((r) => `<li class="${r.win ? 'win' : ''}"><span class="medal">${medals[Math.min(r.rank, 4) - 1]}</span><span class="rn">${esc(plainName(r))}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${pairs(r.pairs)}</span></li>`).join('');
  return `<section class="card over pf-result"><div class="trophy">${mineWin ? '🏆' : '👏'}</div><h1>${title}</h1>
    <p class="center muted">Es gewinnt, wer die meisten Paare gefunden hat.</p><ul class="ranking">${rows}</ul>
    ${againHtml()}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function gameHtml() {
  const g = S.game;
  // Bewegung nur beim ersten Zeichnen eines neuen Zustands (sonst würde jede Hilfe-Ansicht die Karten erneut drehen)
  const anim = !!g.evt && g.evt.seq === g.seq && S.ui.animSeen !== g.seq;
  S.ui.animSeen = g.seq;
  if (g.mode === 'over') return `${ui.header()}${ui.lost()}${bannerHtml(g)}${resultHtml(g)}${scoreHtml(g)}${boardHtml(g, anim)}`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${boardHtml(g, anim)}${actionHtml(g)}${scoreHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Finde möglichst viele Paare. Ein Paar sind zwei Karten mit demselben Bild.</p>
    <h3>So spielst du</h3>
    <ol>
      <li>Alle Karten liegen verdeckt auf dem Tisch. Du siehst nur die bunte Rückseite.</li>
      <li>Tippe auf eine Karte. Sie dreht sich um und zeigt ihr Bild. Tippe dann auf eine zweite Karte.</li>
      <li><b>Gleiches Bild:</b> Das ist ein Paar! Die beiden Karten bleiben blass auf dem Tisch liegen, du bekommst einen Punkt und bist gleich noch einmal dran.</li>
      <li><b>Verschiedene Bilder:</b> Beide Karten bleiben offen, damit du sie dir merken kannst. Tippe dann auf „Weiter“. Die Karten werden wieder umgedreht und die nächste Person ist dran.</li>
    </ol>
    <p>Du musst dich nicht beeilen. Es gibt keine Zeitgrenze. Wer sich die Bilder merkt, die schon einmal aufgedeckt waren, findet schneller Paare.</p>
    <h3>Die Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du suchst alle Paare. Das Spiel zählt deine Versuche. Ein Versuch sind zwei aufgedeckte Karten. Je weniger Versuche, desto besser. Deine Bestleistung wird für jede Spielgröße gemerkt.</li>
      <li><b>Gegen den Computer:</b> Ihr wechselt euch ab. Jedes gefundene Paar ist ein Punkt. Der Computer schummelt nicht. Er merkt sich nur, was offen auf dem Tisch lag. Leicht vergisst viel, Mittel nur manchmal.</li>
      <li><b>Mit anderen online:</b> Bis zu 4 Personen spielen nacheinander. Wer die meisten Paare hat, gewinnt. Bei Gleichstand gewinnen alle mit den meisten Paaren.</li>
    </ul>
    <h3>Einstellungen auf der Startseite</h3>
    <ul>
      <li><b>Größe:</b> Klein hat 12 Karten, mittel 16, groß 20 und riesig 30 Karten. Ohne Haken ist es mittel.</li>
      <li><b>Bilder:</b> Tiere, Obst und Gemüse, Fahrzeuge oder Natur.</li>
      <li><b>Karten bleiben aufgedeckt:</b> Mit Haken bleiben zwei verschiedene Karten offen, bis du auf „Weiter“ tippst. Ohne Haken drehen sie sich nach etwa 1,5 Sekunden von selbst um.</li>
    </ul>
    <p class="muted">Das Spiel erkennt Paare und das Spielende von allein. Hilfen oder Tipps gibt es bewusst nicht: Das Merken ist das Spiel.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  solo: true, soloText: 'Du suchst alle Paare allein und versuchst, mit möglichst wenigen Versuchen fertig zu werden.',
  sess, $app,
  title: 'Paare finden', icon: '🃏', sub: 'Das Merkspiel mit bunten Bildern – allein, gegen den Computer oder mit anderen',
  options: OPTIONS,
  minPlayers: 2,
  helpTitle: 'Die Spielregeln von Paare finden', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return undefined;
    switch (act) {
      case 'card': {
        if (g.mode !== 'play') return undefined;
        const i = Number(el.dataset.i);
        const me = meIndex(g);
        if (me < 0) return undefined;
        if (g.turn !== me) { S.ui.hint = `Gerade ist ${plainName(g.players[g.turn])} dran. Bitte einen Moment Geduld.`; return render(); }
        if (g.pending) { S.ui.hint = 'Tippe zuerst auf „Weiter“.'; return render(); }
        if (g.st[i] !== 0) { S.ui.hint = 'Diese Karte ist schon offen. Tippe auf eine verdeckte Karte.'; return render(); }
        if (S.ui.hint) S.ui.hint = '';
        return sess.send({ t: 'flip', i });
      }
      case 'weiter': return sess.send({ t: 'weiter' });
    }
    return undefined;
  },
});
function render() { ui.render(); }
ui.boot();
