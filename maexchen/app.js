import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');
const freshUi = () => ({ lifted: false, pick: null, rolling: false, lastRollId: 0, sig: '' });

const sess = createSession({
  game: 'mx',
  maxPlayers: M.MAX_PLAYERS,
  options: [{ id: 'short', label: 'Mit 3 Leben (kurz)', help: 'Jede Person startet mit 3 statt 6 Leben. Das Spiel ist dann schneller zu Ende.', def: false }],
  newGame: (players, opts) => {
    S.ui.lastRollId = 0; S.ui.sig = ''; S.ui.lifted = false; S.ui.pick = null; S.ui.rolling = false;
    return M.createGame(players, { short: !!(opts && opts.short) || !!S.learn }, Math.random); // Lernrunde: kurze Partie mit 3 Leben
  },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase === 'over') return null;
      if (g.phase === 'reveal') {
        // Weiter-Klick macht ein Mensch; sind nur noch Computer im Spiel, geht es von selbst weiter
        if (g.players.some((p) => p.lives > 0 && !String(p.id).startsWith('bot'))) return null;
        const b = g.players.find((p) => p.lives > 0);
        return b ? { id: b.id, msg: { t: 'next' } } : null;
      }
      const ap = M.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const me = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.phase !== 'over') {
    const sig = `${g.gid}|${g.round}|${g.rollId}|${g.phase}|${g.active}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.lifted = false; S.ui.pick = null; }
    if (g.rollId !== S.ui.lastRollId) {
      const resumed = S.ui.lastRollId === 0 && g.rollId > 1;
      S.ui.lastRollId = g.rollId;
      if (!resumed && g.phase === 'announce' && M.activePlayer(g).id === cid) { animateDice(); return; }
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
    if (el) el.innerHTML = diceInner(null, true);
    if (n >= 8) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}

// ====================== Darstellung ======================
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pips = (v) => Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ''}></i>`).join('');
const nameOf = (id) => { const p = S.game.players.find((x) => x.id === id); return p ? p.name : ''; };
const who = (id) => (id === cid ? 'Du' : esc(nameOf(id)));
const shortName = (n, k = 12) => (n.length > k ? n.slice(0, k - 1) + '…' : n);

// Würfelbereich (feste Höhe): zwei Würfel (nur wenn sie gezeigt werden dürfen) oder der verschlossene Becher
function diceInner(dice, spin) {
  if (spin) {
    const r = () => 1 + Math.floor(Math.random() * 6);
    return `<div class="mx-dice mx-spin">${[r(), r()].map((v) => `<div class="mx-die" aria-hidden="true">${pips(v)}</div>`).join('')}</div>`;
  }
  return `<div class="mx-dice">${dice.map((v, i) => `<div class="mx-die" role="img" aria-label="Würfel ${i + 1}: ${v}">${pips(v)}</div>`).join('')}</div>`;
}
const cupHtml = (label) => `<div class="mx-cup" role="img" aria-label="${label}"><span aria-hidden="true">?</span></div>`;
const emptyCup = () => '<div class="mx-cup empty" role="img" aria-label="Der Becher ist leer"><span aria-hidden="true"></span></div>';

function diceAreaHtml(g) {
  const ap = M.activePlayer(g);
  const mineRoll = g.phase === 'announce' && ap.id === cid;
  let inner;
  let cap;
  if (S.ui.rolling) { inner = diceInner(null, true); cap = '<span>Die Würfel rollen unter dem Becher</span>'; }
  else if (g.phase === 'reveal' || g.phase === 'over') {
    inner = diceInner(g.cupDice, false);
    cap = `<span>Echter Wurf: <b>${M.valueText(g.cup)}</b></span>`;
  } else if (mineRoll && S.ui.lifted) {
    inner = diceInner(g.cupDice, false);
    cap = `<span>Dein Wurf: <b>${M.valueText(g.cup)}</b></span>`;
  } else if (g.phase === 'roll') { inner = emptyCup(); cap = '<span>Noch nicht gewürfelt</span>'; }
  else if (mineRoll) { inner = cupHtml('Verschlossener Becher mit deinen Würfeln'); cap = '<span>Der Becher ist zu. Nur du darfst nachsehen.</span>'; }
  else {
    const rollerName = g.phase === 'decide' ? nameOf(g.players[g.announcer].id) : ap.name;
    inner = cupHtml(`Verschlossener Becher von ${rollerName}`);
    cap = `<span>Unter dem Becher von ${esc(rollerName)}</span>`;
  }
  return `<div id="dice" class="mx-dicearea">${inner}</div><p class="mx-cap">${cap}</p>`;
}

function playersHtml(g) {
  return `<ul class="mx-players" aria-label="Die Leben aller Mitspieler">${g.players.map((p) => {
    const out = p.lives <= 0;
    const act = !out && g.phase !== 'over' && g.players[g.active] === p;
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' ⚠' : '';
    const hit = (g.phase === 'reveal' || g.phase === 'over') && g.last && g.last.loserId === p.id ? ' hit' : '';
    const beers = out ? '<span class="mx-out">raus</span>' : `<span class="mx-beer" role="img" aria-label="${p.lives === 1 ? '1 Leben' : p.lives + ' Leben'}">${M.beer(p.lives)}</span>`;
    return `<li class="mx-pl${act ? ' act' : ''}${out ? ' gone' : ''}${hit}"><b class="mx-nm" title="${esc(p.name)}">${act ? '🎲 ' : ''}${esc(shortName(p.name))}${p.id === cid ? ' (du)' : ''}${off}</b>${beers}</li>`;
  }).join('')}</ul>`;
}

function infoHtml(g) {
  if (g.announced === null) return `<p class="mx-info"><span>Noch keine Ansage in dieser Runde. Alles ab 31 ist erlaubt.</span></p>`;
  const by = g.players[g.announcer];
  const extra = g.phase === 'roll' ? ' Du musst höher ansagen.' : '';
  return `<p class="mx-info"><span>${g.phase === 'reveal' || g.phase === 'over' ? 'Angesagt war' : 'Letzte Ansage:'} <b>${M.valueText(g.announced)}</b> von ${by.id === cid ? 'dir' : esc(by.name)}.${extra}</span></p>`;
}

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  if (g.phase === 'reveal') return `<div class="banner">Aufgedeckt!</div>`;
  const ap = M.activePlayer(g);
  if (ap.id === cid) return `<div class="banner mine">${g.phase === 'decide' ? 'Glaubst du das?' : 'Du bist dran!'}</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

// Ergebnistext aus Sicht dieser Person ("Du hast gelogen …" / "Anna hat gelogen …")
export function resultText(l, myId) {
  const annMe = l.announcerId === myId;
  const dbtMe = l.doubterId === myId;
  const ann = annMe ? 'Du' : l.announcerName;
  const dbt = dbtMe ? 'Du' : l.doubterName;
  const lose = (isMe) => (isMe ? 'verlierst' : 'verliert');
  const n = l.loss === 2 ? `zwei Leben ${M.beer(2)}` : `ein Leben ${M.beer(1)}`;
  let t;
  if (l.liar) {
    t = l.loss === 2
      ? `${ann} ${annMe ? 'hast' : 'hat'} ein Mäxchen angesagt, aber gelogen, und ${lose(annMe)} ${n}`
      : `${ann} ${annMe ? 'hast' : 'hat'} gelogen und ${lose(annMe)} ${n}`;
  } else {
    t = `${ann} ${annMe ? 'hast' : 'hat'} die Wahrheit gesagt${l.loss === 2 ? ': Es war ein Mäxchen!' : '.'} ${dbt} ${dbtMe ? 'hast' : 'hat'} zu Unrecht gezweifelt und ${lose(dbtMe)} ${n}`;
  }
  if (l.out) t += `. ${l.loserId === myId ? 'Du bist' : l.loserName + ' ist'} raus.`;
  return t;
}

function actionHtml(g) {
  const p = me();
  const ap = M.activePlayer(g);
  const isMe = !!p && ap.id === cid;
  if (S.ui.rolling) return `<p class="big center">🎲 Die Würfel rollen …</p>`;
  if (g.phase === 'reveal') {
    const l = g.last;
    return `<p class="big mx-result">${esc(resultText(l, cid))}</p>
      <p class="mx-sub">Angesagt: ${M.valueText(l.announced)}. Echter Wurf: ${M.valueText(l.real)}. ${ap.id === cid ? 'Du beginnst' : esc(ap.name) + ' beginnt'} die nächste Runde.</p>
      <button type="button" class="btn primary huge" data-act="next">➡ Weiter</button>`;
  }
  if (g.phase === 'roll') {
    if (!isMe) return `<p class="big">${esc(ap.name)} ist dran und würfelt gleich unter dem Becher.</p>`;
    return `<p class="big">${g.announced === null ? 'Du bist dran. Würfle unter dem Becher.' : 'Du hast geglaubt. Jetzt würfelst du selbst unter dem Becher.'}</p>
      <button type="button" class="btn primary huge" data-act="roll">🎲 Würfeln</button>`;
  }
  if (g.phase === 'announce') {
    if (!isMe) return `<p class="big">${esc(ap.name)} hat gewürfelt und überlegt, was angesagt wird.</p>`;
    const allowed = M.allowedSays(g);
    const grid = M.ORDER.map((v) => {
      const okv = allowed.includes(v);
      const sel = S.ui.pick === v;
      const cls = `mx-val${okv ? '' : ' low'}${sel ? ' sel' : ''}${M.isPasch(v) ? ' pasch' : ''}${v === M.MAEXCHEN ? ' max' : ''}`;
      return `<button type="button" class="${cls}" data-act="pick" data-v="${v}" aria-pressed="${sel}" aria-label="${M.valueText(v)}${okv ? '' : ', zu niedrig'}" ${okv ? '' : 'disabled'}>${v}</button>`;
    }).join('');
    return `<p class="big">${g.announced === null ? 'Sage einen Wert an: wahr oder gelogen, das entscheidest du.' : `Sage einen Wert an, der höher ist als ${M.valueText(g.announced)}.`}</p>
      <button type="button" class="btn secondary mx-lift" data-act="lift">${S.ui.lifted ? '🙈 Becher wieder zudecken' : '👀 Becher anheben'}</button>
      <div class="mx-pick" role="group" aria-label="Deine Ansage wählen">${grid}</div>
      <p class="mx-sub">Von klein nach groß. Die Paschs 11 bis 66 sind gelb, ganz oben steht das Mäxchen 21.</p>
      <button type="button" class="btn primary huge" data-act="say" ${S.ui.pick ? '' : 'disabled'}>${S.ui.pick ? `📣 ${S.ui.pick} ansagen` : 'Erst einen Wert wählen'}</button>`;
  }
  if (g.phase === 'decide') {
    const by = g.players[g.announcer];
    const said = `${esc(by.name)} sagt <b>${M.valueText(g.announced)}</b> an.`;
    if (!isMe) return `<p class="big">${said} ${esc(ap.name)} überlegt.</p>`;
    const max = g.announced === M.MAEXCHEN;
    return `<p class="big">${said} ${max ? 'Ein Mäxchen kann niemand überbieten: Du musst aufdecken.' : 'Glaubst du das?'}</p>
      <button type="button" class="btn secondary huge" data-act="believe" ${max ? 'disabled' : ''}>👍 Glauben</button>
      <button type="button" class="btn primary huge" data-act="doubt">🔎 Aufdecken (zweifeln)</button>`;
  }
  return '';
}

function recapHtml(g) {
  const items = (g.recap || []).slice(0, 2).map((x) => `<li title="${esc(x)}">${esc(x)}</li>`);
  while (items.length < 2) items.push('<li>&nbsp;</li>');
  return `<section class="card recap mx-recap" aria-label="Zuletzt passiert"><ul>${items.join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card mx-board" id="board">
      ${playersHtml(g)}
      ${infoHtml(g)}
      ${diceAreaHtml(g)}
    </section>
    <section class="action mx-action" aria-live="polite">${actionHtml(g)}</section>
    ${recapHtml(g)}`;
}

function overHtml(g) {
  const r = g.result;
  const mine = r.winners.includes(cid);
  const isHost = sess.S.role === 'host';
  const names = r.winners.map((id) => nameOf(id));
  const head = mine ? 'Du hast gewonnen!' : (names.length > 1 ? `${esc(names.join(' und '))} haben gewonnen!` : `${esc(names[0])} hat gewonnen!`);
  const rows = M.ranking(g).map((x) => `<tr class="${x.place === 1 ? 'lead' : ''}"><td class="n">${x.place}.</td><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.place === 1 ? ' 🏆' : ''}</td><td class="n">${x.lives > 0 ? M.beer(x.lives) : 'raus'}</td></tr>`).join('');
  const btns = isHost
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Partie. Du bleibst einfach auf dieser Seite.</p>`;
  const lastLine = g.last && g.last.kind === 'reveal' ? `<p class="center big">${esc(resultText(g.last, cid))}</p>` : '';
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over mx-over"><div class="trophy">${mine ? '🏆' : '🍺'}</div>
      <h1>${head}</h1>
      <p class="center muted">${r.capped ? 'Das Spiel war sehr lang: Wer die meisten Leben hat, gewinnt.' : 'Wer als Letzte/r noch Leben hat, gewinnt.'}</p>
      ${lastLine}
      <div class="mx-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Platzierung</h2><table class="mx-table"><thead><tr><th class="n">Platz</th><th>Name</th><th class="n">Leben</th></tr></thead><tbody>${rows}</tbody></table></section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Wer als Letzte/r noch Leben hat, gewinnt. Dazu darfst du schwindeln, aber nicht erwischt werden.</p>
    <h3>Leben und Würfel</h3>
    <p>Jede Person startet mit <b>6 Leben</b>, das sind 6 Bier-Symbole 🍺. Mit der Option „Mit 3 Leben (kurz)“ sind es nur 3. Gewürfelt wird mit zwei Würfeln <b>unter einem Becher</b>. Nur die Person, die würfelt, darf nachsehen.</p>
    <h3>Die Zahlen</h3>
    <p>Die höhere Augenzahl steht vorn: Eine 4 und eine 2 sind zusammen die <b>42</b>. Von niedrig nach hoch gilt: 31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65. Dann kommen die Paschs 11, 22, 33, 44, 55, 66. Am höchsten ist das <b>Mäxchen 21</b> (eine 2 und eine 1).</p>
    <h3>Eine Runde</h3>
    <ol>
      <li>Wer dran ist, würfelt verdeckt und tippt auf „Becher anheben“, um den Wurf zu sehen.</li>
      <li>Dann sagt sie oder er einen Wert an. Die Ansage kann wahr oder gelogen sein, sie muss aber <b>höher</b> sein als die letzte Ansage. Am Rundenanfang ist jeder Wert ab 31 erlaubt.</li>
      <li>Die nächste Person hat die Wahl: <b>Glauben</b> oder <b>Aufdecken (zweifeln)</b>.</li>
      <li>Wer glaubt, würfelt selbst unter dem Becher und muss dann einen noch höheren Wert ansagen.</li>
      <li>Wer zweifelt, deckt den Becher auf. Der echte Wurf ist für alle sichtbar.</li>
    </ol>
    <h3>Wer verliert ein Leben?</h3>
    <p>War der echte Wurf <b>niedriger</b> als die Ansage, wurde gelogen: Die ansagende Person verliert ein Leben. War der echte Wurf mindestens so hoch wie die Ansage, war die Ansage ehrlich: Dann verliert die zweifelnde Person ein Leben.</p>
    <h3>Das Mäxchen</h3>
    <p>Wird ein <b>Mäxchen (21)</b> angesagt und angezweifelt, geht es um zwei Leben: Stimmt es, verliert die zweifelnde Person 2 Leben. War es gelogen, verliert die ansagende Person 2 Leben. Höher als 21 gibt es nichts, deshalb muss man ein angesagtes Mäxchen aufdecken. Wer ein Mäxchen wirklich würfelt, muss es nicht ansagen.</p>
    <h3>Die nächste Runde</h3>
    <p>Nach dem Aufdecken tippst du auf „Weiter“. Wer ein Leben verloren hat, fängt die nächste Runde an. Hat sie oder er keine Leben mehr, ist sie oder er raus und die nächste Person beginnt. Wer keine Leben mehr hat, scheidet aus.</p>
    <p class="muted">Das Spiel sagt dir nie, ob jemand lügt oder was du ansagen sollst. Das merkst du dir selbst.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3, 4, 5, 6, 7], levels: ['Leicht', 'Mittel'],
  options: [{ id: 'short', label: 'Mit 3 Leben (kurz)', help: 'Jede Person startet mit 3 statt 6 Leben.' }],
  tutorial: { bots: 1, coach },
  title: 'Mäxchen', icon: '🍺', sub: 'Das Würfel-Bluffspiel – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Mäxchen', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'lift': {
        if (!g || g.phase !== 'announce' || M.activePlayer(g).id !== cid) return undefined;
        S.ui.lifted = !S.ui.lifted;
        if (S.ui.lifted) {
          sess.send({ t: 'look' });
          if (S.ui.pick === null) { const al = M.allowedSays(g); S.ui.pick = al.includes(g.cup) ? g.cup : al[0]; } // Vorschlag: der echte Wurf (alle Werte gleich dargestellt)
        }
        return render();
      }
      case 'pick': S.ui.pick = Number(el.dataset.v); return render();
      case 'say': { const v = S.ui.pick; return v ? sess.send({ t: 'say', v }) : undefined; }
      case 'believe': return sess.send({ t: 'believe' });
      case 'doubt': return sess.send({ t: 'doubt' });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
