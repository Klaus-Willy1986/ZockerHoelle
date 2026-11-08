import * as G from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction, DELAY_MS } from './ai.js';
import { coach, TUTORIAL_OPTS } from './tutorial.js';
import { KATEGORIEN } from './woerter.js';
import { snowmanSvg } from './draw.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'kurz', label: 'Kurzspiel: 3 statt 5 Wörter', help: 'Gilt nicht beim Alleinspielen: Dort geht es Wort für Wort weiter, bis ein Wort verloren ist.', def: false },
  { id: 'easy', label: 'Leicht: 10 statt 8 Fehler erlaubt', def: false },
];

// ?seed=123 in der Adresse: feste Mischung (für Tests). Sonst Zufall.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedParam = new URLSearchParams(location.search).get('seed');
const rng = seedParam !== null && /^\d+$/.test(seedParam) ? seededRng(Number(seedParam)) : Math.random;

const freshUi = () => ({ hint: '', hintSeq: -1, wordOpen: false, wordText: '', sig: '', coachSeen: {} });

function makeGame(players, opts) {
  const host = sess.cid;
  if (S.learn) return G.createGame(players, { ...TUTORIAL_OPTS, host }, rng);
  const rounds = opts.kurz ? G.ROUNDS.kurz : G.ROUNDS.normal;
  return G.createGame(players, { rounds, easy: !!opts.easy, host }, rng);
}

// Computer (nur im Alleinspiel, vom Gastgeber gesteuert; die Sitzung ruft step() nach `delay` auf)
const bot = {
  delay: DELAY_MS,
  step: (g, level) => {
    if (!g || g.game !== 'gg' || g.phase !== 'play') return null;
    const cur = g.players[g.turn];
    if (!cur || !G.isBotId(cur.id)) return null;
    const msg = chooseAction(g, cur.id, level, Math.random);
    return msg ? { id: cur.id, msg } : null;
  },
};

const sess = createSession({
  game: 'gg',
  maxPlayers: G.MAX_PLAYERS,
  options: OPTIONS,
  newGame: (players, opts) => { S.ui = { ...freshUi(), ...(S.ui && S.ui.helpOpen ? { helpOpen: true } : {}) }; return makeGame(players, opts); },
  onMessage: (state, pid, msg) => { G.handle(state, pid, msg, rng); },
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
    const sig = `${g.gid}|${g.round}`;
    if (S.ui.sig !== sig) { S.ui.sig = sig; S.ui.wordOpen = false; S.ui.wordText = ''; S.ui.hint = ''; }
    if (g.phase !== 'play' || G.current(g).id !== cid) S.ui.wordOpen = false;
    if (S.ui.hintSeq !== g.seq) { S.ui.hintSeq = g.seq; S.ui.hint = ''; }
  }
  render();
}

// ====================== Hilfen ======================
const me = (g) => g.players.find((p) => p.id === cid);
const isBot = (p) => G.isBotId(p.id);
const connected = (id) => { const l = S.lobby.find((x) => x.id === id); return !l || l.connected !== false; };
const plainName = (p) => (isBot(p) ? (p.name === 'Computer' ? 'Der Computer' : p.name) : p.name);
const nameOf = (p) => esc(plainName(p));
const byId = (g, id) => g.players.find((p) => p.id === id);
const times = (n) => (n === 1 ? 'einmal' : n === 2 ? 'zweimal' : n === 3 ? 'dreimal' : `${n} Mal`);
const catName = (g) => KATEGORIEN[g.cat] || '';
const isKey = (c) => G.KEYS.includes(c);
const pts = (n) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
const wortWoerter = (n) => `${n} ${n === 1 ? 'Wort' : 'Wörter'}`;

// ====================== Darstellung ======================
function bannerHtml(g) {
  if (g.phase === 'over') return '<div class="banner done">Das Spiel ist zu Ende</div>';
  if (g.phase === 'reveal') return `<div class="banner ${g.solved ? 'done' : 'final'}">${g.solved ? 'Gelöst!' : 'Nicht gelöst'}</div>`;
  const cur = G.current(g);
  const mine = cur.id === cid;
  const solo = g.players.length === 1;
  if (mine) return `<div class="banner mine">${solo ? 'Rate einen Buchstaben oder das Wort' : 'Du bist dran – rate einen Buchstaben'}</div>`;
  if (isBot(cur)) return `<div class="banner">${nameOf(cur)} überlegt …</div>`;
  return `<div class="banner">${nameOf(cur)} ist dran</div>`;
}

function metaRight(g) {
  if (g.solo && !g.fixed) return `Serie: ${g.wins} gelöst`;
  return `Wort ${g.round + 1} von ${g.rounds}`;
}

function wordHtml(g) {
  const over = g.phase !== 'play';
  const n = g.mask.length;
  const cell = (c) => {
    if (c === null) return '<span class="gg-ch"></span>';
    let cls = 'gg-ch on';
    if (over && isKey(c) && !g.guessed.includes(c)) cls += g.solved ? ' late' : ' miss';
    return `<span class="${cls}">${esc(c)}</span>`;
  };
  const split = n > 8 ? Math.ceil(n / 2) : n;
  const lines = [g.mask.slice(0, split), g.mask.slice(split)].filter((l) => l.length);
  const label = `Gesuchtes Wort mit ${n} Buchstaben: ${g.mask.map((c) => (c === null ? 'Strich' : c)).join(', ')}`;
  return `<div class="gg-word" role="img" aria-label="${esc(label)}">${lines.map((l) => `<div class="gg-line">${l.map(cell).join('')}</div>`).join('')}</div>`;
}

function boardCard(g) {
  const lost = g.phase !== 'play' && !g.solved;
  const pips = Array.from({ length: g.maxErr }, (_, i) => `<i class="${i < g.errs ? 'on' : ''}"></i>`).join('');
  return `<section id="board" class="card gg-board">
    <div class="gg-meta"><span class="gg-cat">${esc(catName(g))}</span><span class="gg-no">${esc(metaRight(g))}</span></div>
    <div class="gg-fig">
      <div class="gg-svg">${snowmanSvg(g.errs, g.maxErr, lost)}</div>
      <div class="gg-err"><span class="gg-errlbl">Fehler</span><b>${g.errs} <small>von ${g.maxErr}</small></b><span class="gg-pips" aria-hidden="true">${pips}</span></div>
    </div>
    ${wordHtml(g)}</section>`;
}

function messageText(g) {
  if (g.phase === 'over') return '';
  if (g.phase === 'reveal') {
    if (g.solved) {
      const by = byId(g, g.solvedBy);
      const who = by && by.id === cid ? 'Du bekommst' : `${plainName(by)} bekommt`;
      const bonus = g.last && g.last.bonus ? g.last.bonus : G.BONUS_BASE;
      return `Gelöst! Das Wort war ${g.word}. ${who} ${bonus} Bonuspunkte.`;
    }
    return `Verloren – der Schneemann ist geschmolzen. Das Wort war ${g.word}.`;
  }
  if (S.ui.hint) return S.ui.hint;
  const cur = G.current(g);
  const ev = g.last;
  if (!ev) return cur.id === cid ? 'Los geht’s! Rate einen Buchstaben oder das Wort.' : `${plainName(cur)} fängt an.`;
  const mine = ev.by === cid;
  const by = byId(g, ev.by);
  const pre = mine ? '' : `${plainName(by)}: `;
  const fault = `Fehler ${g.errs} von ${g.maxErr}.`;
  if (ev.kind === 'letter') return `${pre}Der Buchstabe ${ev.l} kommt ${times(ev.n)} vor.${mine ? ' Du darfst noch einmal.' : ''}`;
  if (ev.kind === 'miss') return `${pre}Der Buchstabe ${ev.l} kommt nicht vor. ${fault}`;
  if (ev.kind === 'badword') return `${pre}${ev.w} ist nicht das gesuchte Wort. ${fault}`;
  return '';
}

function messageCard(g) {
  const t = messageText(g);
  return `<section class="card action gg-msg"><p class="big">${esc(t)}</p></section>`;
}

function keysCard(g) {
  const mineTurn = g.phase === 'play' && G.current(g).id === cid;
  const keys = G.KEYS.map((k) => {
    const used = g.guessed.includes(k);
    const hit = used && g.mask.includes(k);
    const cls = ['gg-key'];
    if (used) cls.push(hit ? 'hit' : 'miss');
    else if (!mineTurn) cls.push('wait');
    const label = `Buchstabe ${k}${used ? (hit ? ', schon geraten, kommt vor' : ', schon geraten, kommt nicht vor') : ''}`;
    return `<button class="${cls.join(' ')}" data-act="key" data-l="${k}" aria-label="${esc(label)}"${used ? ' disabled' : ''}>${k}</button>`;
  }).join('');
  return `<section class="card gg-kb"><div id="gg-keys" class="gg-keys" role="group" aria-label="Tastatur A bis Z, Ä, Ö, Ü">${keys}</div></section>`;
}

function wordZone(g) {
  const cur = G.current(g);
  const mineTurn = cur.id === cid;
  let inner;
  if (S.ui.wordOpen && mineTurn) {
    inner = `<label class="gg-wl" for="gg-wordin">Dein Wort:</label>
      <input id="gg-wordin" class="gg-wordin" type="text" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" maxlength="${G.MAX_WORD_INPUT}" placeholder="Das ganze Wort" value="${esc(S.ui.wordText)}">
      <div class="gg-wbtns"><button class="btn primary" data-act="wordsend">Raten</button><button class="btn ghost" data-act="wordcancel">Abbrechen</button></div>`;
  } else {
    inner = `<button class="btn secondary huge" data-act="wordopen">Ich weiß das Wort</button>
      <p class="gg-wnote">Richtig bringt Bonuspunkte. Ein falsches Wort ist ein Fehler.</p>`;
  }
  let skip = '';
  if (S.role === 'host' && !mineTurn && !isBot(cur) && !connected(cur.id)) skip = `<button class="btn ghost" data-act="skipturn">Ohne ${nameOf(cur)} weiter</button>`;
  return `<section class="gg-wzone">${inner}</section>${skip}`;
}

function scoresCard(g, withGain) {
  const solo = g.players.length === 1;
  if (solo) {
    const best = sess.get('gg_best', null);
    return `<section class="card gg-score"><div class="gg-stats">
      <div><b>${g.scores[cid]}</b><span>Punkte</span></div>
      <div><b>${g.wins}</b><span>Wörter in Folge</span></div></div>
      <p class="center muted small gg-best">${best === null ? 'Noch keine Bestleistung.' : `Bestleistung: ${wortWoerter(best)} in Folge`}</p></section>`;
  }
  const items = G.ranking(g).map((r) => {
    const p = byId(g, r.id);
    const on = g.phase === 'play' && G.current(g).id === r.id;
    const gain = withGain && g.gain[r.id] ? `<em class="gg-gain">+${g.gain[r.id]}</em>` : '<em class="gg-gain"></em>';
    return `<li class="${on ? 'on ' : ''}${r.id === cid ? 'me' : ''}"><span class="gg-pn">${nameOf(p)}${r.id === cid ? ' (du)' : ''}${on ? '<small>ist dran</small>' : ''}</span>${gain}<span class="gg-pp">${r.score}</span></li>`;
  }).join('');
  return `<section class="card gg-score gg-rank"><h2>Punkte</h2><ul>${items}</ul></section>`;
}

function resultCard(g) {
  const last = g.solo && !g.fixed ? !g.solved : g.round + 1 >= g.rounds;
  let next;
  if (S.role === 'host') {
    next = `<button class="btn primary huge" data-act="next">${last ? 'Zum Endergebnis' : 'Nächstes Wort'}</button>`;
  } else next = '<p class="muted center">Es geht gleich weiter, sobald der Gastgeber auf Weiter tippt.</p>';
  return `<section class="card gg-res">${next}</section>`;
}

let bestInfo = { key: null };
function soloBest(g) {
  const key = `${g.gid}|${g.wins}|${g.round}`;
  if (bestInfo.key === key) return bestInfo;
  const prev = sess.get('gg_best', null);
  const record = !S.learn && g.wins > 0 && (prev === null || g.wins > prev);
  if (record) sess.set('gg_best', g.wins);
  bestInfo = { key, prev, record };
  return bestInfo;
}

const ENDE = [
  'Der Schneemann sagt danke fürs Mitspielen!',
  'Gut geraten, ihr Lieben. Bis zum nächsten Wort!',
  'So bleibt der Kopf fit. Das machen wir bald wieder!',
];
const ENDE_ALLEIN = [
  'Der Schneemann hat sich gefreut. Komm bald wieder!',
  'Wörter raten hält den Kopf fit. Weiter so!',
];

function overHtml(g) {
  const rk = G.ranking(g);
  const win = G.winners(g);
  const solo = g.players.length === 1;
  const iWon = win.some((w) => w.id === cid);
  const nm = (w) => (w.id === cid ? 'Du' : (w.name === 'Computer' ? 'Der Computer' : esc(w.name)));
  let title; let trophy; let extra = '';
  if (solo) {
    const b = S.learn ? { record: false, prev: null } : soloBest(g);
    title = g.wins === 0 ? 'Das erste Wort ist geschmolzen' : `Du hast ${wortWoerter(g.wins)} in Folge gelöst!`;
    trophy = b.record ? '🏆' : '⛄';
    if (!S.learn) {
      if (b.record) extra = `<p class="center big">Neue Bestleistung! 🎉${b.prev !== null ? ` Bisher: ${wortWoerter(b.prev)}` : ''}</p>`;
      else if (b.prev !== null) extra = `<p class="center big">Deine Bestleistung: <b>${wortWoerter(b.prev)}</b> in Folge</p>`;
    }
    extra += `<p class="center big">Punkte: <b>${g.scores[cid]}</b></p>`;
  } else {
    trophy = iWon ? '🏆' : '⛄';
    const names = win.slice().sort((a, b) => (b.id === cid) - (a.id === cid)).map(nm);
    if (win.length === 1) title = `${names[0]} ${names[0] === 'Du' ? 'hast' : 'hat'} gewonnen 🎉`;
    else title = `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} ${names[0] === 'Du' ? 'habt' : 'haben'} gewonnen 🎉`;
    extra = `<p class="center big">Gelöst: ${g.wins} von ${g.rounds} Wörtern</p>`;
    if (win.length > 1) extra += '<p class="center big">Gleichstand – ihr teilt euch den Sieg!</p>';
  }
  const medal = (r) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`);
  const lis = rk.map((r) => `<li class="${r.rank === 1 && !solo ? 'win' : ''}"><span class="medal">${medal(r)}</span><span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.score}</span></li>`).join('');
  const wirt = (solo ? ENDE_ALLEIN : ENDE)[g.gid % (solo ? ENDE_ALLEIN : ENDE).length];
  const again = S.role === 'host'
    ? '<button class="btn primary huge" data-act="again">⛄ Noch eine Runde</button>'
    : '<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>';
  return `<section class="card over gg-over"><div class="trophy">${trophy}</div><h1>${title}</h1>${extra}
    <h2 class="center">Endstand</h2><ul class="ranking">${lis}</ul>
    <p class="center gg-bye">${esc(wirt)}</p>
    ${again}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>`;
}

function gameHtml() {
  const g = S.game;
  let body;
  if (g.phase === 'over') body = overHtml(g);
  else if (g.phase === 'reveal') body = `${boardCard(g)}${messageCard(g)}${resultCard(g)}${scoresCard(g, true)}`;
  else body = `${boardCard(g)}${messageCard(g)}${keysCard(g)}${wordZone(g)}${scoresCard(g, false)}`;
  return `<div class="gg">${ui.header()}${ui.lost()}${bannerHtml(g)}${body}</div>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Finde das gesuchte Wort, bevor der Schneemann geschmolzen ist. Du kannst allein spielen, gegen den Computer oder mit bis zu 6 Personen.</p>
    <h3>So läuft ein Wort ab</h3>
    <p>Oben siehst du Striche, einen für jeden Buchstaben des gesuchten Wortes. Die Kategorie verrät, worum es geht, zum Beispiel Tiere oder Musik. Reihum rät jede Person einen Buchstaben. Tippe dazu unten auf die Tastatur. Schon geratene Buchstaben sind grau.</p>
    <ul>
      <li><b>Der Buchstabe kommt vor:</b> Er erscheint an allen passenden Stellen. Du bekommst für jede Stelle einen Punkt und bist gleich noch einmal dran.</li>
      <li><b>Der Buchstabe kommt nicht vor:</b> Das ist ein Fehler. Der Schneemann schmilzt ein Stück, und die nächste Person ist dran. Die Fehler zählt die ganze Gruppe zusammen.</li>
      <li><b>Das ganze Wort raten:</b> Tippe auf Ich weiß das Wort und schreibe es hin. Ist es richtig, hast du gewonnen. Ist es falsch, ist das ein Fehler, und dein Zug ist zu Ende.</li>
    </ul>
    <h3>Die Punkte</h3>
    <ul>
      <li><b>Für jeden Fund</b> bekommst du einen Punkt je Stelle im Wort.</li>
      <li><b>Das Wort lösen:</b> Wer das Wort richtig rät oder den letzten fehlenden Buchstaben findet, bekommt 3 Bonuspunkte. Wer das Wort rät, bevor alle Buchstaben da sind, bekommt zusätzlich einen Punkt für jeden noch verdeckten Buchstaben.</li>
      <li><b>Verloren:</b> Nach 8 Fehlern ist das Wort verloren. Dann gibt es keine Bonuspunkte, und das Wort wird gezeigt. Mit dem Häkchen Leicht sind es 10 Fehler.</li>
    </ul>
    <h3>Das Ende</h3>
    <p>Ein Spiel hat 5 Wörter, beim Kurzspiel 3. Wer am Ende die meisten Punkte hat, gewinnt. Bei Gleichstand gewinnen alle mit den meisten Punkten.</p>
    <h3>Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Du löst ein Wort nach dem anderen. Das Spiel ist zu Ende, sobald ein Wort verloren ist. Deine längste Serie wird als Bestleistung gemerkt.</li>
      <li><b>Gegen den Computer:</b> Ein bis drei Computer raten mit. Sie überlegen etwa eine Sekunde. Es gibt eine leichte und eine mittlere Stufe. Sie sehen das gesuchte Wort nicht.</li>
      <li><b>Mit anderen:</b> Eröffne ein neues Spiel und schicke den Einladungs-Link oder den Code weiter. Bis zu 6 Personen sind möglich.</li>
    </ul>
    <p class="muted">Dein Gerät kann dir vorlesen, was passiert. Schalte dazu oben Ansagen ein. Die Wörter kommen aus einer eingebauten Liste mit gängigen deutschen Wörtern.</p>`;
}

// ====================== Bedienung ======================
function sendWord() {
  const g = S.game;
  if (!g || g.phase !== 'play' || G.current(g).id !== cid) return;
  const w = S.ui.wordText;
  if (!G.normWord(w)) { S.ui.hint = 'Bitte schreibe zuerst ein Wort in das Feld.'; return render(); }
  S.ui.wordOpen = false; S.ui.wordText = '';
  sess.send({ t: 'word', w, r: g.round });
}

const ui = createUI({
  solo: true, soloText: 'Du löst ein Wort nach dem anderen und kannst deine längste Serie verbessern.',
  sess, $app,
  title: 'Galgenmännchen', icon: '⛄', sub: 'Der Schneemann schmilzt – Wörter raten für 1 bis 6 Personen',
  options: OPTIONS,
  helpTitle: 'Die Spielregeln von Galgenmännchen', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'key': {
        if (g.phase !== 'play') return;
        const cur = G.current(g);
        if (!me(g)) return;
        if (cur.id !== cid) { S.ui.hint = `Gerade ist ${plainName(cur)} dran. Bitte einen Moment Geduld.`; return render(); }
        const l = el.dataset.l;
        if (g.guessed.includes(l)) return;
        S.ui.hint = ''; S.ui.wordOpen = false;
        return sess.send({ t: 'letter', l, r: g.round });
      }
      case 'wordopen': {
        if (g.phase !== 'play') return;
        const cur = G.current(g);
        if (cur.id !== cid) { S.ui.hint = `Gerade ist ${plainName(cur)} dran. Bitte einen Moment Geduld.`; return render(); }
        S.ui.wordOpen = true; S.ui.hint = '';
        return render();
      }
      case 'wordcancel': S.ui.wordOpen = false; S.ui.wordText = ''; S.ui.hint = ''; return render();
      case 'wordsend': return sendWord();
      case 'next': return sess.send({ t: 'next', r: g.round });
      case 'skipturn': return sess.send({ t: 'skip', r: g.round });
    }
  },
});

function render() {
  ui.render();
  const g = S.game;
  if (g && S.screen === 'game' && g.phase === 'play' && S.ui.wordOpen) {
    const inp = document.getElementById('gg-wordin');
    if (inp && document.activeElement !== inp) { try { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* egal */ } }
  }
}

$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t && t.id === 'gg-wordin') S.ui.wordText = t.value;
});
$app.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (ev.key === 'Enter' && t && t.id === 'gg-wordin') { ev.preventDefault(); sendWord(); }
});
ui.boot();
