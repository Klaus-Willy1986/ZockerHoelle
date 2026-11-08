import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');
const freshUi = () => ({ rolling: false, lastRollId: 0 });

const sess = createSession({
  game: 'bc',
  maxPlayers: M.MAX_PLAYERS,
  newGame: (players) => { S.ui.lastRollId = 0; S.ui.rolling = false; return M.createGame(players, {}, Math.random); },
  onMessage: (state, pid, msg) => {
    if (msg && msg.t === 'next' && pid !== cid) return; // "Weiter" darf nur der Gastgeber
    M.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase !== 'roll') return null;
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
  if (g && g.rollId !== S.ui.lastRollId) {
    const resumed = S.ui.lastRollId === 0 && g.rollId > 1;
    S.ui.lastRollId = g.rollId;
    if (!resumed && g.dice) { animateDice(); return; }
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
    if (el) el.innerHTML = diceInner(spinVals(), true);
    if (n >= 8) { clearInterval(rollTimer); S.ui.rolling = false; render(); }
  }, 90);
}
const spinVals = () => [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));

// ====================== Darstellung ======================
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pips = (v) => Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ''}></i>`).join('');
const nameOf = (id) => { const p = S.game.players.find((x) => x.id === id); return p ? p.name : ''; };
const shortName = (n, k = 11) => (n.length > k ? n.slice(0, k - 1) + '…' : n);

function diceInner(vals, spin, g) {
  if (!vals) return `<div class="bc-dice">${[0, 1, 2].map((i) => `<div class="bc-die blank" role="img" aria-label="Würfel ${i + 1}: noch nicht gewürfelt"></div>`).join('')}</div>`;
  const l = g && !spin ? g.last : null;
  const mini = !!(l && l.mini);
  return `<div class="bc-dice${spin ? ' bc-spin' : ''}">${vals.map((v, i) => {
    const hit = !spin && g && v === g.target;
    const cls = `bc-die${hit ? ' hit' : ''}${mini ? ' mini' : ''}`;
    return `<div class="${cls}" role="img" aria-label="Würfel ${i + 1}: ${v}${hit ? ', Treffer' : ''}${mini ? ', Mini-Bunco' : ''}">${pips(v)}</div>`;
  }).join('')}</div>`;
}

function diceAreaHtml(g) {
  let inner;
  let cap;
  if (S.ui.rolling) { inner = diceInner(spinVals(), true); cap = 'Die Würfel rollen'; }
  else if (!g.dice) { inner = diceInner(null); cap = 'Noch nicht gewürfelt'; }
  else {
    inner = diceInner(g.dice, false, g);
    const l = g.last;
    const hits = g.dice.filter((d) => d === g.target).length;
    cap = l ? `Wurf von ${l.pid === cid ? 'dir' : esc(l.name)}: ${l.bunco ? 'Bunco' : l.mini ? 'Mini-Bunco' : hits + (hits === 1 ? ' Treffer' : ' Treffer')}` : '';
  }
  return `<div id="dice" class="bc-dicearea">${inner}</div><p class="bc-cap"><span>${cap}</span></p>`;
}

function targetHtml(g) {
  return `<div class="bc-target" role="img" aria-label="Runde ${g.round} von ${M.ROUNDS}, Zielzahl ${g.target}">
    <div class="bc-die bc-tdie" aria-hidden="true">${pips(g.target)}</div>
    <div><b>Runde ${g.round}: Zielzahl ${g.target}</b><span>Runde ${g.round} von ${M.ROUNDS}</span></div></div>`;
}

function playersHtml(g) {
  const bestPts = Math.max(...g.players.map((p) => p.pts));
  return `<ul class="bc-players" aria-label="Punktetafel">${g.players.map((p, i) => {
    const act = g.phase === 'roll' && g.active === i;
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' ⚠' : '';
    const lead = g.phase === 'between' && p.pts === bestPts && bestPts > 0 ? ' lead' : '';
    const tro = p.wins ? `<span class="bc-tro" role="img" aria-label="${p.wins} Rundensiege">${'🏆'.repeat(p.wins)}</span>` : '';
    return `<li class="bc-pl${act ? ' act' : ''}${lead}"><div class="bc-l1"><b class="bc-nm" title="${esc(p.name)}">${act ? '🎲 ' : ''}${esc(shortName(p.name))}${p.id === cid ? ' (du)' : ''}${off}</b>${tro}</div>
      <div class="bc-l2"><span>Runde <b>${p.pts}</b></span><span>Ges. <b>${p.total}</b></span></div></li>`;
  }).join('')}</ul>`;
}

function infoHtml(g) {
  const p = me() || g.players[0];
  if (g.solo) return `<p class="bc-info"><span>Reihe <b>${Math.min(M.SOLO_TURNS, g.turn + 1)} von ${M.SOLO_TURNS}</b> · Rundenpunkte <b>${p.pts} von ${M.GOAL}</b></span></p>`;
  return `<p class="bc-info"><span>Wer zuerst <b>${M.GOAL} Punkte</b> in dieser Runde hat, beendet die Runde.</span></p>`;
}

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  if (g.phase === 'between') return `<div class="banner">Runde ${g.round} ist zu Ende</div>`;
  const ap = M.activePlayer(g);
  if (ap.id === cid) return `<div class="banner mine">Du bist dran!</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function actionHtml(g) {
  const ap = M.activePlayer(g);
  const isMe = ap.id === cid;
  const isHost = sess.S.role === 'host';
  if (S.ui.rolling) return `<p class="big bc-res center">🎲 Die Würfel rollen …</p><p class="bc-sub">&nbsp;</p><div class="bc-slot">&nbsp;</div>`;
  const l = g.last;
  const rt = l ? esc(M.resultText(l, cid)) : '';
  if (g.phase === 'between') {
    const h = g.history[g.history.length - 1];
    return `<p class="big bc-res">${esc(M.roundText(h, g, cid))}</p><p class="bc-sub">${rt}</p>
      ${isHost ? `<button type="button" class="btn primary huge" data-act="next">➡ Weiter zu Runde ${g.round + 1}</button>` : `<div class="bc-slot">Der Gastgeber startet gleich die nächste Runde.</div>`}`;
  }
  const head = l ? `<p class="big bc-res">${rt}</p>` : `<p class="big bc-res">${isMe ? `Du fängst an. Jeder Würfel mit der ${g.target} zählt einen Punkt.` : `${esc(ap.name)} fängt an. Jeder Würfel mit der ${g.target} zählt einen Punkt.`}</p>`;
  const sub = `<p class="bc-sub">${g.solo ? 'Ohne Treffer ist deine Reihe zu Ende.' : 'Mit Treffer geht die Reihe weiter, ohne Treffer ist die nächste Person dran.'}</p>`;
  const btn = isMe
    ? `<button type="button" class="btn primary huge" data-act="roll">🎲 Würfeln</button>`
    : `<div class="bc-slot">${esc(ap.name)} würfelt gleich …</div>`;
  return head + sub + btn;
}

function recapHtml(g) {
  const items = (g.recap || []).slice(0, 2).map((x) => `<li title="${esc(x)}">${esc(x)}</li>`);
  while (items.length < 2) items.push('<li>&nbsp;</li>');
  return `<section class="card recap bc-recap" aria-label="Zuletzt passiert"><ul>${items.join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card bc-board" id="board">
      ${targetHtml(g)}
      ${playersHtml(g)}
      ${infoHtml(g)}
      ${diceAreaHtml(g)}
    </section>
    <section class="action bc-action" aria-live="polite">${actionHtml(g)}</section>
    ${recapHtml(g)}`;
}

// Alleinspiel: Bestleistung im Browser merken (einmal pro Partie)
let soloKey = '';
let soloInfo = null;
function soloResult(g) {
  const total = g.players[0].total;
  const key = String(g.gid);
  if (soloKey !== key) {
    soloKey = key;
    const prev = Number(sess.get('bc_best', 0)) || 0;
    soloInfo = { total, prev, record: total > prev };
    if (total > prev) sess.set('bc_best', total);
  }
  return soloInfo;
}

function overHtml(g) {
  const isHost = sess.S.role === 'host';
  let head; let troph; let note;
  if (g.solo) {
    const r = soloResult(g);
    troph = r.record ? '🏆' : '🎲';
    head = r.record ? `Neue Bestleistung! ${r.total} Punkte!` : `Du hast ${r.total} Punkte geschafft`;
    note = r.record ? (r.prev ? `Deine bisherige Bestleistung war ${r.prev} Punkte.` : 'Das ist dein erster Wert. Versuche, ihn zu schlagen.') : `Deine Bestleistung ist ${r.prev} Punkte.`;
  } else {
    const w = g.result.winners;
    const mine = w.includes(cid);
    const names = w.map((id) => nameOf(id));
    troph = mine ? '🏆' : '🎲';
    head = mine ? (w.length > 1 ? `Du hast gewonnen, zusammen mit ${esc(names.filter((n, i) => w[i] !== cid).join(' und '))}!` : 'Du hast gewonnen!')
      : (names.length > 1 ? `${esc(names.join(' und '))} haben gewonnen!` : `${esc(names[0])} hat gewonnen!`);
    note = 'Wer die meisten Runden gewonnen hat, siegt. Bei Gleichstand zählen die Gesamtpunkte.';
  }
  const rows = M.ranking(g).map((x) => `<tr class="${x.place === 1 ? 'lead' : ''}"><td class="n">${x.place}.</td><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${x.place === 1 && !g.solo ? ' 🏆' : ''}</td>${g.solo ? '' : `<td class="n">${x.wins}</td>`}<td class="n">${x.total}</td></tr>`).join('');
  const hist = g.history.map((h) => `<tr><td>Runde ${h.round}</td><td class="n">${g.solo ? h.scores[0] : esc(h.winners.length ? h.winners.map(nameOf).join(', ') : '–')}</td></tr>`).join('');
  const btns = isHost
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Partie</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Partie. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over bc-over"><div class="trophy">${troph}</div>
      <h1>${head}</h1>
      <p class="center muted">${esc(note)}</p>
      <div class="bc-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card"><h2>Punktetafel</h2><table class="bc-table"><thead><tr><th class="n">Platz</th><th>Name</th>${g.solo ? '' : '<th class="n">Siege</th>'}<th class="n">Punkte</th></tr></thead><tbody>${rows}</tbody></table></section>
    <section class="card"><h2>${g.solo ? 'Punkte je Runde' : 'Rundensieger'}</h2><table class="bc-table"><tbody>${hist}</tbody></table></section>`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Sammle Punkte und gewinne die meisten der 6 Runden. Es gibt nichts zu entscheiden: Du würfelst, und das Glück zählt.</p>
    <h3>Die Zielzahl</h3>
    <p>Gespielt werden <b>6 Runden</b>. In Runde 1 ist die Zielzahl die 1, in Runde 2 die 2, und so weiter bis zur 6. Du würfelst mit <b>3 Würfeln</b>.</p>
    <h3>So gibt es Punkte</h3>
    <ol>
      <li>Jeder Würfel, der die Zielzahl zeigt, zählt <b>1 Punkt</b>. Diese Würfel leuchten nach dem Wurf.</li>
      <li>Hast du mindestens einen Punkt gemacht, darfst du <b>gleich nochmal würfeln</b>.</li>
      <li>Ohne Punkt ist die nächste Person dran.</li>
      <li><b>Bunco:</b> Alle drei Würfel zeigen die Zielzahl. Das sind <b>21 Punkte</b>, und die Runde ist sofort zu Ende.</li>
      <li><b>Mini-Bunco:</b> Alle drei Würfel zeigen dieselbe andere Zahl. Das sind <b>5 Punkte</b>, und du würfelst weiter.</li>
    </ol>
    <h3>Das Ende einer Runde</h3>
    <p>Eine Runde endet, sobald jemand <b>21 Punkte</b> in dieser Runde erreicht hat. Wer in der Runde die meisten Punkte hat, bekommt einen Rundensieg 🏆. Bei Gleichstand bekommen alle Gleichen einen Sieg. Danach tippt der Gastgeber auf „Weiter“. Jede Runde beginnt eine andere Person.</p>
    <h3>Wer gewinnt?</h3>
    <p>Nach 6 Runden gewinnt, wer die <b>meisten Rundensiege</b> hat. Bei Gleichstand zählen die Gesamtpunkte. Sind auch die gleich, teilen sich die Personen den Sieg.</p>
    <h3>Allein spielen</h3>
    <p>Allein hast du pro Runde <b>10 Würfelreihen</b>. Eine Reihe geht weiter, solange du Punkte machst, und endet ohne Punkt. Die Runde endet auch, wenn du 21 Punkte erreichst. Deine Punkte aus allen 6 Runden zählen zusammen. Dein bester Wert wird auf diesem Gerät gemerkt.</p>
    <p class="muted">Der Computer würfelt von selbst, ganz ohne Tricks.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3, 4, 5, 6, 7], levels: ['Leicht', 'Mittel'],
  solo: true, soloText: 'Du würfelst 6 Runden allein und kannst deine Bestleistung verbessern.',
  tutorial: { bots: 1, coach },
  title: 'Bunco', icon: '🎲', sub: 'Das Würfelspiel mit Zielzahl – online zusammen spielen',
  helpTitle: 'Die Spielregeln von Bunco', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act) => {
    switch (act) {
      case 'roll': return sess.send({ t: 'roll' });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
ui.boot();
