import * as P from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');
const freshUi = () => ({ keep: Array(5).fill(false), rolling: false, lastRollId: 0, sig: '', pick: null });

const sess = createSession({
  game: 'pasch',
  maxPlayers: 5,
  newGame: (players) => { S.ui.lastRollId = 0; S.ui.sig = ''; S.ui.pick = null; return P.createGame(players); },
  onMessage: (state, pid, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'roll') P.roll(state, pid, msg.keep);
    else if (msg.t === 'score') P.score(state, pid, msg.cat);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.mode !== 'over') {
    const sig = `${g.rollId}|${g.active}|${g.round}`;
    if (sig !== S.ui.sig) {
      S.ui.sig = sig;
      S.ui.pick = null;
      S.ui.keep = Array(5).fill(false);
    }
    if (g.rollId !== S.ui.lastRollId) {
      const resumed = S.ui.lastRollId === 0 && g.rollId > 1;
      S.ui.lastRollId = g.rollId;
      if (!resumed && g.turn.rolls > 0) { animateDice(); return; }
    }
  }
  render();
}

let rollTimer = null;
function animateDice() {
  S.ui.rolling = true;
  render();
  let n = 0;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    n++;
    const el = document.getElementById('dice');
    if (el && S.game?.turn?.dice) el.innerHTML = diceHtml(S.game, { spin: true });
    if (n >= 8) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}

// ====================== Darstellung ======================
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pips = (v) => Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ''}></i>`).join('');

function diceHtml(g, o = {}) {
  const t = g.turn;
  if (!t || !t.dice) return '';
  const interactive = !!o.interactive;
  const cols = t.dice.map((v, i) => {
    const kept = interactive ? S.ui.keep[i] : !!(t.rolls > 1 && t.kept?.[i]);
    const shown = o.spin && !kept ? 1 + Math.floor(Math.random() * 6) : v;
    const label = `Würfel ${i + 1}: ${shown}${interactive ? (kept ? ', wird behalten' : ', wird neu gewürfelt') : ''}`;
    const cls = `pz-die${interactive && kept ? ' keep' : ''}`;
    const die = interactive
      ? `<button class="${cls}" data-act="toggle" data-i="${i}" aria-pressed="${kept}" aria-label="${label}">${pips(shown)}</button>`
      : `<div class="${cls}" role="img" aria-label="${label}">${pips(shown)}</div>`;
    const tag = interactive ? (kept ? '<span class="pz-tag keep">✔ bleibt</span>' : '<span class="pz-tag">↻ neu</span>') : '<span class="pz-tag"></span>';
    return `<div class="pz-col">${die}${tag}</div>`;
  }).join('');
  return `<div class="pz-dice${o.spin ? ' pz-spin' : ''}">${cols}</div>`;
}

function actionHtml() {
  const g = S.game;
  const t = g.turn;
  const ap = P.activePlayer(g);
  if (S.ui.rolling) return `<p class="big center">🎲 Die Würfel rollen …</p>`;
  if (ap.id !== cid) {
    if (t.rolls === 0) return `<p class="big center">Gleich würfelt <b>${esc(ap.name)}</b>. Bitte einen Moment Geduld.</p>`;
    return `<p class="big center"><b>${esc(ap.name)}</b> hat ${t.rolls === 1 ? 'einmal' : t.rolls + ' mal'} gewürfelt (Wurf ${t.rolls} von ${P.MAX_ROLLS}).</p>`;
  }
  if (t.rolls === 0) return `<button class="btn primary huge" data-act="roll">🎲 Würfeln (Wurf 1 von 3)</button>`;
  if (t.rolls >= P.MAX_ROLLS) return `<p class="big">Das war dein letzter Wurf. Wähle unten ein Feld auf deinem Zettel.</p>`;
  const rest = S.ui.keep.filter((k) => !k).length;
  return `<p class="big">Tippe auf die Würfel, die du <b>behalten</b> willst. Alle anderen werden neu gewürfelt.</p>
    <button class="btn primary huge" data-act="reroll" ${rest === 0 ? 'disabled' : ''}>🎲 ${rest} ${rest === 1 ? 'Würfel' : 'Würfel'} neu würfeln (Wurf ${t.rolls + 1} von ${P.MAX_ROLLS})</button>
    <p class="muted">Oder höre hier auf und wähle unten ein Feld auf deinem Zettel.</p>`;
}

function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  const ap = P.activePlayer(g);
  return ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length || S.ui.rolling) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function sumRows(p) {
  const up = P.upperSum(p.sheet);
  const bonus = P.bonusOf(p.sheet);
  const need = P.toBonus(p.sheet);
  const info = bonus ? 'Bonus erreicht!' : `noch ${need} bis zum Bonus`;
  return `<div class="pz-sum"><span>Zwischensumme oben<br><span class="pz-info">${up} von ${P.BONUS_LIMIT} – ${info}</span></span><b>${up}</b></div>
    <div class="pz-sum"><span>Bonus (ab ${P.BONUS_LIMIT} oben)</span><b>${bonus ? '+' + bonus : '0'}</b></div>
    <div class="pz-sum total"><span>Gesamtsumme</span><b>${P.totalOf(p)}</b></div>`;
}

// Eigener Zettel
function mySheetHtml(p, canPick) {
  const g = S.game;
  const t = g.turn;
  const row = (c) => {
    const v = p.sheet[c.id];
    const left = `<span><span class="pz-name">${c.name}</span><span class="pz-hint">${c.hint}</span></span>`;
    if (v != null) return `<div class="pz-row done">${left}<span class="pz-pts${v === 0 ? ' zero' : ''}">${v}</span></div>`;
    if (!canPick) return `<div class="pz-row">${left}<span class="pz-pts zero"></span></div>`;
    const pts = P.scoreFor(c.id, t.dice);
    const picked = S.ui.pick === c.id;
    const btn = `<button class="pz-row${picked ? ' picked' : ''}" data-act="pick" data-cat="${c.id}" aria-label="${c.name} eintragen, ergibt ${pts} Punkte">${left}<span class="pz-pts pre">${pts}</span></button>`;
    if (!picked) return btn;
    const msg = pts === 0
      ? `<p class="big"><b>${c.name}</b>: Das Feld wird mit <b>0</b> gestrichen.</p>`
      : `<p class="big"><b>${c.name}</b>: Das bringt dir <b>${pts} Punkte</b>.</p>`;
    return `${btn}<div class="confirm pz-confirm">${msg}<button class="btn primary huge" data-act="pick-yes">Ja, hier eintragen</button><button class="btn ghost" data-act="pick-no">Zurück</button></div>`;
  };
  const up = P.CATS.filter((c) => c.upper).map(row).join('');
  const low = P.CATS.filter((c) => !c.upper).map(row).join('');
  const head = canPick
    ? `<p class="muted">Rechts steht, wie viele Punkte das Feld mit deinem Wurf ergibt. Tippe auf das Feld, in das du eintragen willst.</p>` : '';
  return `<h2>Dein Zettel</h2>${head}<div class="pz-sheet"><h3>Oben</h3>${up}<h3>Unten</h3>${low}</div>${sumRows(p)}`;
}

// Zettel anderer (nur Ansicht)
function sheetTable(p) {
  const rows = P.CATS.map((c) => {
    const v = p.sheet[c.id];
    return `<tr class="${v != null ? 'done' : ''}"><td colspan="2">${c.name}</td><td class="num">${v != null ? v : ''}</td></tr>`;
  }).join('');
  const up = P.upperSum(p.sheet);
  return `<table class="block"><tbody>${rows}
    <tr class="sumrow"><td colspan="2">Zwischensumme oben (${up} von ${P.BONUS_LIMIT})</td><td class="num">${up}</td></tr>
    <tr><td colspan="2">Bonus</td><td class="num">${P.bonusOf(p.sheet) ? '+' + P.bonusOf(p.sheet) : '0'}</td></tr>
    <tr class="sumrow"><td colspan="2">Gesamtsumme</td><td class="num">${P.totalOf(p)}</td></tr></tbody></table>`;
}

function othersHtml() {
  const g = S.game;
  const list = g.players.map((p, i) => ({ p, i })).filter(({ p }) => p.id !== cid);
  if (!list.length) return '';
  return `<section class="card"><h2>Zettel der Mitspieler</h2>${list.map(({ p, i }) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    return `<details class="other"><summary><b>${esc(p.name)}</b>${off} – ${P.totalOf(p)} Punkte, ${P.filledCount(p.sheet)} von 13 Feldern${i === g.active ? ' 🎲' : ''}</summary>${sheetTable(p)}</details>`;
  }).join('')}</section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml();
  const ap = P.activePlayer(g);
  const t = g.turn;
  const me = g.players[myIndex()];
  const isMe = ap.id === cid;
  const interactive = isMe && t.rolls >= 1 && t.rolls < P.MAX_ROLLS && !S.ui.rolling;
  const canPick = isMe && t.rolls >= 1 && !S.ui.rolling;
  const dice = t.dice
    ? `<section class="card"><p class="pz-rollno">Wurf ${t.rolls} von ${P.MAX_ROLLS} · Runde ${g.round} von 13</p><div id="dice">${diceHtml(g, { interactive })}</div></section>` : '';
  return `${headerHtml()}${lostHtml()}${bannerHtml()}
    <section class="card action">${actionHtml()}</section>
    ${dice}
    ${me ? `<section class="card">${mySheetHtml(me, canPick)}</section>` : ''}
    ${recapHtml()}${othersHtml()}`;
}

function overHtml() {
  const g = S.game;
  const rank = P.ranking(g);
  const wins = rank.filter((r) => r.place === 1);
  const medals = { 1: '🏆', 2: '🥈', 3: '🥉' };
  const title = wins.length > 1
    ? `Unentschieden! ${wins.map((w) => esc(w.name)).join(' und ')} teilen sich den Sieg.`
    : `${esc(wins[0].name)} hat gewonnen!`;
  const list = rank.map((r) => `<li class="${r.place === 1 ? 'win' : ''}"><span class="medal">${medals[r.place] || ''}</span>
    <span class="rn">${r.place}. ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.total} Punkte</span>
    <div class="rd"><span class="chip">oben ${r.upper}</span>${r.bonus ? `<span class="chip">Bonus +${P.BONUS}</span>` : ''}${r.tie ? '<span class="chip">gleiche Punktzahl</span>' : ''}</div></li>`).join('');
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🎲 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}
    <section class="card over"><div class="trophy">🏆</div><h1>${title}</h1>
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml()}
    <section class="card"><h2>Alle Zettel</h2>${g.players.map((p) => `<details class="other"><summary><b>${esc(p.name)}</b> – ${P.totalOf(p)} Punkte</summary>${sheetTable(p)}</details>`).join('')}</section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Mit fünf Würfeln Felder auf deinem Zettel füllen und am Ende die meisten Punkte haben.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Du würfelst alle 5 Würfel (1. Wurf).</li>
      <li>Du darfst noch bis zu zweimal würfeln. Tippe dazu auf die Würfel, die du <b>behalten</b> willst (sie werden grün markiert). Alle anderen werden neu gewürfelt. Ohne Auswahl werden alle 5 neu gewürfelt.</li>
      <li>Du darfst nach jedem Wurf aufhören. Nach dem 3. Wurf musst du aufhören.</li>
      <li>Danach wählst du <b>ein</b> noch freies Feld auf deinem Zettel. Rechts steht, wie viele Punkte es mit deinem Wurf gibt. Du bestätigst mit „Ja, hier eintragen“.</li>
      <li>Passt dein Wurf nicht zu dem Feld, bekommst du 0 Punkte und das Feld ist gestrichen. Es ist dann nicht mehr frei.</li>
    </ol>
    <p>Das Spiel dauert 13 Runden – so viele Felder hat jeder Zettel. Dann ist es zu Ende.</p>
    <h3>Die Felder oben</h3>
    <p><b>Einser bis Sechser:</b> Es zählen nur die Würfel mit dieser Augenzahl, zusammengezählt. Beispiel: Drei Vierer im Wurf ergeben im Feld „Vierer“ 12 Punkte.</p>
    <p><b>Bonus:</b> Hast du oben (Einser bis Sechser) zusammen mindestens <b>63 Punkte</b>, bekommst du <b>35 Bonuspunkte</b>.</p>
    <h3>Die Felder unten</h3>
    <ul>
      <li><b>Dreierpasch:</b> mindestens 3 gleiche Würfel. Es zählen die Augen aller 5 Würfel.</li>
      <li><b>Viererpasch:</b> mindestens 4 gleiche Würfel. Es zählen die Augen aller 5 Würfel.</li>
      <li><b>Full House:</b> 3 gleiche und 2 andere gleiche Würfel. Das gibt 25 Punkte. Auch fünf gleiche Würfel zählen als Full House (25 Punkte).</li>
      <li><b>Kleine Straße:</b> 4 Zahlen der Reihe nach, zum Beispiel 2‑3‑4‑5. Das gibt 30 Punkte.</li>
      <li><b>Große Straße:</b> 5 Zahlen der Reihe nach (1‑2‑3‑4‑5 oder 2‑3‑4‑5‑6). Das gibt 40 Punkte.</li>
      <li><b>Fünferpasch:</b> alle 5 Würfel gleich. Das gibt 50 Punkte.</li>
      <li><b>Chance:</b> Die Augen aller 5 Würfel zählen. Das geht immer.</li>
    </ul>
    <h3>Spielende</h3>
    <p>Wer am Ende die meiste Gesamtsumme hat, gewinnt. Haben mehrere gleich viele Punkte, gibt es ein Unentschieden und der Sieg wird geteilt.</p>
    <p class="muted">Keine Sorge: Das Programm rechnet alle Punkte für dich aus und lässt nur erlaubte Züge zu. Welches Feld du wählst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  title: 'Pasch & Straße', icon: '🎲', sub: 'Würfel-Zettelspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Pasch & Straße', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'reroll': return sess.send({ t: 'roll', keep: S.ui.keep });
      case 'toggle': S.ui.keep[Number(el.dataset.i)] = !S.ui.keep[Number(el.dataset.i)]; return render();
      case 'pick': S.ui.pick = el.dataset.cat; return render();
      case 'pick-no': S.ui.pick = null; return render();
      case 'pick-yes': { const cat = S.ui.pick; S.ui.pick = null; return cat && sess.send({ t: 'score', cat }); }
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
