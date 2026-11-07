import * as E from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import * as D from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');
const freshUi = () => ({ open: {}, manual: null, manualSeq: -1, note: '', noteSeq: -1, rollKey: '', rollUntil: 0 });

// Nur für Tests: ?rounds=8 verkürzt das Kurzspiel
const testRounds = () => {
  const n = Number(new URLSearchParams(location.search).get('rounds'));
  return Number.isInteger(n) && n > 0 && n <= 60 ? n : 0;
};

const sess = createSession({
  game: 'hh',
  maxPlayers: 6,
  newGame: (players, o) => {
    S.ui = { ...S.ui, ...freshUi() };
    const learn = !!S.learn;
    const short = learn ? true : o.short !== false;
    const opts = { auction: learn ? true : o.auction !== false, maxRounds: short ? (learn ? 12 : testRounds() || 30) : 0 };
    return E.createGame(players, opts);
  },
  onMessage: (state, pid, msg) => {
    const r = E.handle(state, pid, msg, Math.random);
    if (!r.ok && pid === cid) { S.ui.note = r.error; S.ui.noteSeq = state.seq; }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 800,
    step: (g, level) => {
      if (!g || g.game !== 'haus' || g.phase === 'over') return null;
      const ap = E.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...S.ui, ...freshUi() };

const desk = window.matchMedia ? window.matchMedia('(min-width: 900px)') : { matches: false };
const isDesk = () => !!desk.matches;
if (desk.addEventListener) desk.addEventListener('change', () => { if (S.screen === 'game') render(); });
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const isG = (g) => !!g && g.game === 'haus';
const ME = () => (isG(S.game) ? S.game.players.find((p) => p.id === cid) : null);
const actorIsMe = (g) => g.phase !== 'over' && E.activePlayer(g) && E.activePlayer(g).id === cid;
const pname = (g, id) => (id === 'bank' ? 'die Bank' : (g.players.find((p) => p.id === id) || { name: '?' }).name);
const tokOf = (p) => D.tokenOf(p.token);
const plain = (p) => `${tokOf(p).sym} ${esc(p.name)}`;

// ====================== Zustandswechsel ======================
const rollKey = (g) => `${g.turns}|${g.doubles}|${g.dice.join(',')}`;
function onStateChanged() {
  const g = S.game;
  if (isG(g)) {
    const key = rollKey(g);
    if (S.ui.rollKey === '') S.ui.rollKey = key;
    else if (key !== S.ui.rollKey) {
      S.ui.rollKey = key;
      if (g.phase !== 'roll' && g.dice[0] > 0 && !reduceMotion()) S.ui.rollUntil = Date.now() + 700;
    }
    if (S.ui.manual != null && g.seq !== S.ui.manualSeq) S.ui.manual = null;
    if (S.ui.note && g.seq !== S.ui.noteSeq) S.ui.note = '';
  }
  const view = `${S.screen}|${isG(g) ? g.phase === 'over' : ''}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Streifen folgt der Figur ======================
let lastFocus = -1, lastUserScroll = 0, progScroll = 0, anim = null;
function focusSq(g) {
  if (S.ui.manual != null) return S.ui.manual;
  const tp = E.turnPlayer(g);
  if (g.phase !== 'roll' && g.last && g.last.pid === tp.id) return g.last.to;
  return tp.pos;
}
function afterRender(keepLeft) {
  const el = document.getElementById('board');
  if (!el || !el.classList.contains('hh-strip') || !isG(S.game)) { lastFocus = -1; return; }
  const f = focusSq(S.game);
  const card = el.querySelector(`.hh-sq[data-sq="${f}"]`);
  const want = card ? Math.max(0, card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2) : 0;
  progScroll = Date.now();
  if (keepLeft == null) { el.scrollLeft = want; lastFocus = f; return; }
  el.scrollLeft = keepLeft;
  if (anim && Date.now() < anim.until) { el.scrollTo({ left: anim.want, behavior: 'smooth' }); return; }
  if (f !== lastFocus && Date.now() - lastUserScroll > 2500) {
    lastFocus = f;
    if (reduceMotion()) { el.scrollLeft = want; return; }
    anim = { want, until: Date.now() + 700 };
    el.scrollTo({ left: want, behavior: 'smooth' });
  }
}
$app.addEventListener('scroll', (ev) => {
  const el = ev.target;
  if (el && el.id === 'board' && Date.now() - progScroll > 900) lastUserScroll = Date.now();
}, true);
function render() {
  const old = document.getElementById('board');
  const keep = old && old.classList.contains('hh-strip') ? old.scrollLeft : null;
  ui.render();
  afterRender(keep);
}

// ====================== Texte ======================
// Textzeilen seit dem letzten Würfeln (ohne die Ereigniskarte, die hat ihren eigenen Kasten)
function recentLines(g) {
  const r = g.recap || [];
  let k = -1;
  for (let i = r.length - 1; i >= 0; i--) if (/ würfelt \d+ und \d+/.test(r[i])) { k = i; break; }
  const lines = (k >= 0 ? r.slice(k) : r.slice(-1)).filter((l) => !/^Ereignis für /.test(l) && !/ ist am Zug\.$/.test(l));
  return lines.slice(-4);
}

function bannerHtml(g) {
  if (g.phase === 'over') return '<div class="banner done">Das Spiel ist zu Ende!</div>';
  const ap = E.activePlayer(g);
  const tp = E.turnPlayer(g);
  if (actorIsMe(g)) {
    const t = {
      roll: tp.jail > 0 ? 'Du bist dran – im Hexenturm' : g.doubles > 0 ? 'Pasch! Du würfelst nochmal' : 'Du bist dran – würfle',
      buy: 'Du entscheidest: kaufen?',
      auction: 'Du bist beim Bieten dran',
      raise: 'Du musst Geld beschaffen',
      manage: g.rollAgain && tp.jail === 0 ? 'Du bist dran – weiter geht’s' : 'Du bist dran – verwalten oder beenden',
    }[g.phase] || 'Du bist dran';
    return `<div class="banner mine">${t}</div>`;
  }
  const t = g.phase === 'auction' ? `Versteigerung: ${plain(ap)} ist dran` : g.phase === 'raise' ? `${plain(ap)} muss Geld beschaffen` : `${plain(tp)} ist dran`;
  return `<div class="banner">${t}</div>`;
}

function diceHtml(g) {
  const tp = E.turnPlayer(g);
  const [a, b] = g.dice;
  const rolling = Date.now() < (S.ui.rollUntil || 0);
  const old = g.phase === 'roll';
  const sum = a + b;
  let info;
  if (!a) info = '<div class="hh-sum">Noch nicht gewürfelt</div>';
  else info = `<div class="hh-sum">${old ? 'Letzter Wurf' : esc(tp.name)}: <b>${sum}</b></div>${a === b && !old ? '<div class="hh-pasch">Pasch!</div>' : ''}`;
  const round = g.opts.maxRounds > 0 ? `Runde ${Math.min(g.round, g.opts.maxRounds)} von ${g.opts.maxRounds}` : `Runde ${g.round}`;
  return `<section class="card hh-dice${old ? ' old' : ''}" id="dice" aria-label="Würfel"><div class="hh-dice-pair">${D.dieHtml(a, rolling)}${D.dieHtml(b, rolling)}</div>`
    + `<div class="hh-dice-info">${info}<div class="hh-round">${round}</div></div></section>`;
}

function sqInfo(s) {
  if (s.type === 'street') return `Preis ${s.price}. Miete ohne Haus ${s.rent[0]}, mit Hotel ${s.rent[5]}.`;
  if (s.type === 'station') return `Preis ${s.price}. Miete 25 bis 200, je nachdem, wie viele Bahnhöfe dieselbe Person besitzt.`;
  if (s.type === 'utility') return `Preis ${s.price}. Miete: 4-mal oder (mit beiden Versorgern) 10-mal die Augensumme.`;
  return '';
}

function actionHtml(g) {
  const ap = E.activePlayer(g);
  const tp = E.turnPlayer(g);
  const mine = ap.id === cid;
  const meP = ME();
  let main = '', sub = '', btns = '', sr = '';
  const lines = recentLines(g);
  const card = g.card && g.phase !== 'roll' ? g.card.text : '';
  if (card) sr = ` <span class="sr-only">Ereignis: ${esc(card)}</span>`;
  switch (g.phase) {
    case 'roll': {
      if (mine) {
        if (tp.jail > 0) {
          main = `Du sitzt im Hexenturm (Versuch ${tp.jail} von 3). Du kommst frei mit einem Pasch, mit 50 Zahlen oder mit einer Freikarte.`;
          btns = `<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`
            + `<button class="btn secondary huge" data-act="pay_jail" ${tp.cash < E.JAIL_FEE ? 'disabled' : ''}>Aus dem Hexenturm freikaufen (${E.JAIL_FEE})</button>`
            + (tp.freeCards > 0 ? `<button class="btn secondary huge" data-act="use_card">Freikarte benutzen</button>` : '');
          if (tp.cash < E.JAIL_FEE) sub = `Freikaufen geht nicht: Du hast nur ${tp.cash} Bargeld.`;
        } else {
          main = g.doubles > 0 ? 'Pasch! Du darfst nochmal würfeln.' : `Deine Figur steht auf ${E.SQUARES[tp.pos].name}.`;
          btns = `<button class="btn primary huge" data-act="roll">🎲 Würfeln</button>`;
        }
      } else {
        main = g.doubles > 0 ? `${tp.name} darf nochmal würfeln (Pasch).` : tp.jail > 0 ? `${tp.name} sitzt im Hexenturm und würfelt gleich.` : `${tp.name} würfelt gleich.`;
      }
      break;
    }
    case 'buy': {
      const s = E.SQUARES[tp.pos];
      main = lines.join(' ') || `${tp.name} steht auf ${s.name}.`;
      sub = `${s.name} ist noch frei. ${sqInfo(s)}${mine ? ` Dein Bargeld: ${tp.cash}.` : ''}`;
      if (mine) {
        btns = `<button class="btn primary huge" data-act="buy">Kaufen für ${s.price}</button>`
          + `<button class="btn secondary huge" data-act="decline">Nicht kaufen</button>`;
        sub += g.opts.auction ? ' Wenn du nicht kaufst, wird das Grundstück versteigert.' : ' Wenn du nicht kaufst, bleibt es frei.';
      }
      break;
    }
    case 'auction': {
      const A = g.auction;
      const s = E.SQUARES[A.sq];
      const min = A.high + 10;
      main = `Versteigerung: ${s.name} (Preis ${s.price}). ${A.highBy ? `Höchstgebot ${A.high} von ${pname(g, A.highBy)}.` : 'Noch kein Gebot.'}`;
      sub = `Mindestgebot: ${min}.${mine && meP ? ` Dein Bargeld: ${meP.cash}.` : ` ${ap.name} ist am Zug.`}`;
      if (mine && meP) {
        const row = [10, 50, 100].map((d) => {
          const amt = A.high + d;
          return `<button class="btn primary bid" data-act="bid" data-amt="${amt}" ${amt > meP.cash ? 'disabled' : ''}>+${d} bieten<small>= ${amt}</small></button>`;
        }).join('');
        btns = `<div class="hh-bids">${row}</div><button class="btn secondary huge" data-act="pass_bid">Passen</button>`;
        if (A.high + 100 > meP.cash) sub += ' Mehr als dein Bargeld geht nicht.';
      }
      break;
    }
    case 'raise': {
      const d = g.debt;
      const debtor = ap;
      const to = d.to === 'bank' ? 'an die Bank' : `an ${pname(g, d.to)}`;
      main = `${mine ? 'Du musst' : debtor.name + ' muss'} ${d.amount} ${to} zahlen${d.why ? ' (' + d.why + ')' : ''} und ${mine ? 'hast' : 'hat'} nur ${debtor.cash} Bargeld.`;
      sub = `Es fehlen noch ${d.amount - debtor.cash}. ${mine ? 'Verkaufe Häuser oder beleihe Grundstücke.' : 'Häuser verkaufen oder Grundstücke beleihen.'}`;
      if (mine) btns = `<button class="btn warnbtn huge" data-act="declare_bankrupt">Aufgeben (Bankrott)</button>`;
      break;
    }
    case 'manage': {
      main = lines.join(' ') || `${tp.name} ist am Zug.`;
      if (mine) {
        const again = g.rollAgain && tp.jail === 0;
        btns = `<button class="btn primary huge" data-act="end">${again ? 'Weiter: nochmal würfeln' : 'Zug beenden'}</button>`;
        sub = again ? 'Du hattest einen Pasch.' : '';
      } else sub = `${tp.name} kann noch bauen oder beleihen.`;
      break;
    }
    default: break;
  }
  const note = S.ui.note ? `<div class="hh-hint" role="alert">${esc(S.ui.note)}</div>` : '';
  return `<section class="card action hh-action"><div class="hh-leadbox"><p class="big hh-lead">${esc(main)}${sr}</p>${sub ? `<p class="hh-sub">${esc(sub)}</p>` : ''}</div>`
    + `<div class="hh-btns">${btns}</div>${note}</section>`;
}

function eventHtml(g) {
  if (!g.card || g.phase === 'over' || g.phase === 'roll') return '';
  const p = g.players.find((x) => x.id === g.card.pid);
  return `<section class="card hh-event" aria-label="Ereigniskarte"><div class="hh-ev-h">❓ Ereignis für ${p ? esc(p.name) : ''}</div><p class="hh-ev-x">${esc(g.card.text)}</p></section>`;
}

// ---------- Besitz verwalten ----------
function groupsOf(g, pid) {
  const own = new Set(E.ownedBy(g, pid));
  const out = [];
  E.colorGroups.forEach((sqs, gi) => {
    const mine = sqs.filter((s) => own.has(s));
    if (mine.length) out.push({ label: `Farbe ${E.COLOR_NAMES[E.COLOR_IDS[gi]]}`, fill: D.GROUP_FILL[E.COLOR_IDS[gi]], sqs: mine, total: sqs.length, street: true });
  });
  const st = E.STATION_SQS.filter((s) => own.has(s));
  if (st.length) out.push({ label: 'Bahnhöfe', fill: '#5b6070', sqs: st, total: 4, street: false });
  const ut = E.UTILITY_SQS.filter((s) => own.has(s));
  if (ut.length) out.push({ label: 'Versorger', fill: '#5b6070', sqs: ut, total: 2, street: false });
  return out;
}
const stateText = (g, sq) => {
  const l = g.houses[sq] || 0;
  const parts = [];
  if (l === 5) parts.push('Hotel'); else if (l > 0) parts.push(`${l} ${l === 1 ? 'Haus' : 'Häuser'}`);
  if (g.mortgaged[sq]) parts.push('beliehen');
  return parts.join(', ');
};

function rowHtml(g, p, sq, phase, complete) {
  const s = E.SQUARES[sq];
  const lvl = g.houses[sq] || 0;
  const mort = !!g.mortgaged[sq];
  const btns = [];
  const hints = new Set();
  const add = (act, label, err, hint) => {
    btns.push(`<button class="btn secondary hh-rb" data-act="${act}" data-sq="${sq}" ${err ? 'disabled' : ''}>${label}</button>`);
    if (err && hint) hints.add(err);
  };
  if (phase === 'manage' && s.type === 'street' && complete) add('build', `${lvl === 4 ? 'Hotel' : 'Haus'} bauen (${s.houseCost})`, E.buildError(g, p.id, sq), true);
  if (s.type === 'street' && lvl > 0) add('sell', `${lvl === 5 ? 'Hotel' : 'Haus'} verkaufen (+${s.houseCost / 2})`, E.sellError(g, p.id, sq), true);
  if (!mort) add('mortgage', `Beleihen (+${E.mortgageValue(sq)})`, E.mortgageError(g, p.id, sq), true);
  else if (phase === 'manage') add('unmortgage', `Beleihung aufheben (−${E.unmortgageCost(sq)})`, E.unmortgageError(g, p.id, sq), true);
  const st = stateText(g, sq);
  return `<div class="hh-row${mort ? ' mort' : ''}" data-sq="${sq}"><div class="hh-row-h"><b>${esc(s.name)}</b><span>${st ? esc(st) : 'Preis ' + s.price}</span></div>`
    + `<div class="hh-row-b">${btns.join('')}</div>${[...hints].map((h) => `<div class="hh-hint">${esc(h)}</div>`).join('')}</div>`;
}

function listHtml(g) {
  const p = ME();
  if (!p || p.out || !actorIsMe(g) || (g.phase !== 'manage' && g.phase !== 'raise')) return '';
  const groups = groupsOf(g, p.id);
  const raise = g.phase === 'raise';
  const head = raise
    ? `<h2>Geld beschaffen</h2><p class="hh-sub">Verkaufe Häuser (halber Preis) oder beleihe Grundstücke, bis dein Bargeld reicht. Du hast ${p.cash}, du brauchst ${g.debt.amount}.</p>`
    : `<h2>Eigenes verwalten</h2><p class="hh-sub">Bauen, verkaufen und beleihen ist freiwillig. Dein Bargeld: ${p.cash}.</p>`;
  if (!groups.length) return `<section class="card hh-manage">${head}<p>Dir gehört noch kein Grundstück.</p></section>`;
  const body = groups.map((gr) => {
    const complete = gr.street && gr.sqs.length === gr.total;
    const hint = !raise && gr.street && !complete ? `<p class="hh-hint">Bauen geht erst, wenn dir alle ${gr.total} Straßen dieser Farbe gehören (jetzt ${gr.sqs.length}).</p>` : '';
    return `<div class="hh-grp"><div class="hh-grp-h"><i style="background:${gr.fill}"></i>${gr.label}${complete && gr.street ? ' – komplett' : ''}</div>${hint}${gr.sqs.map((sq) => rowHtml(g, p, sq, g.phase, complete)).join('')}</div>`;
  }).join('');
  return `<section class="card hh-manage">${head}${body}</section>`;
}

// ---------- Konten, Besitz, Protokoll, Gesamtübersicht ----------
function accountsHtml(g) {
  const tp = E.turnPlayer(g);
  return `<section class="card hh-acc"><h2>Konten</h2>${g.players.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected && !p.out ? ' <span class="offline">(nicht verbunden)</span>' : '';
    const props = E.ownedBy(g, p.id).length;
    const tags = [`${props} ${props === 1 ? 'Grundstück' : 'Grundstücke'}`];
    if (p.jail > 0 && !p.out) tags.push('🔒 im Hexenturm');
    if (p.freeCards > 0 && !p.out) tags.push(`🎟 Freikarte${p.freeCards > 1 ? ' ×' + p.freeCards : ''}`);
    if (p.out) tags.push('ausgeschieden');
    const turn = g.phase !== 'over' && tp.id === p.id && !p.out;
    return `<div class="hh-pl${turn ? ' turn' : ''}${p.out ? ' out' : ''}">${D.tokenHtml(p.token, 'md', turn)}<div class="hh-pl-n"><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b>${off}<span>${tags.join(' · ')}</span></div>`
      + `<div class="hh-pl-c"><b>${p.out ? '–' : p.cash}</b><span>Bargeld</span></div></div>`;
  }).join('')}</section>`;
}

function toggleBtn(key, label, extra = '') {
  const open = !!S.ui.open[key];
  return `<button class="btn secondary hh-tog" data-act="tog" data-k="${key}" aria-expanded="${open}">${open ? '▾' : '▸'} ${label}${extra}</button>`;
}
function ownHtml(g) {
  const p = ME();
  if (!p || p.out) return '';
  const groups = groupsOf(g, p.id);
  const n = E.ownedBy(g, p.id).length;
  let body = '';
  if (S.ui.open.own) {
    body = groups.length ? groups.map((gr) => `<div class="hh-grp"><div class="hh-grp-h"><i style="background:${gr.fill}"></i>${gr.label}</div>${gr.sqs.map((sq) => {
      const s = E.SQUARES[sq]; const st = stateText(g, sq);
      return `<div class="hh-own${g.mortgaged[sq] ? ' mort' : ''}"><span>${esc(s.name)}</span><span>${st ? esc(st) : 'Preis ' + s.price}</span></div>`;
    }).join('')}</div>`).join('') : '<p>Dir gehört noch kein Grundstück.</p>';
  }
  return `<section class="card hh-ownc">${toggleBtn('own', 'Mein Besitz', ` (${n})`)}${body}</section>`;
}

function recapHtml(g) {
  const r = (g.recap || []).slice(-5).reverse();
  if (!r.length) return '';
  return `<section class="card recap hh-recap"><h2>Zuletzt</h2><ul>${r.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function miniCaption(g) {
  const f = S.ui.manual != null ? S.ui.manual : null;
  if (f == null) return '<p class="hh-mcap">Tippe auf ein Feld, dann siehst du es hier.</p>';
  const s = E.SQUARES[f];
  const ow = g.owners[f] !== undefined ? g.players.find((p) => p.id === g.owners[f]) : null;
  const st = stateText(g, f);
  return `<p class="hh-mcap"><b>${esc(s.name)}</b><br>${s.price ? 'Preis ' + s.price + '<br>' : ''}${ow ? 'Besitzer: ' + esc(ow.name) : s.price ? 'Noch frei' : ''}${st ? '<br>' + esc(st) : ''}</p>`;
}
function miniHtml(g, always) {
  const open = always || !!S.ui.open.board;
  const f = S.ui.manual != null ? S.ui.manual : undefined;
  return `<section class="card hh-minic">${always ? '<h2>So sah das Brett am Ende aus</h2>' : toggleBtn('board', 'Das ganze Brett')}${open ? D.miniBoardHtml(g, { focus: f, centerHtml: miniCaption(g) }) : ''}</section>`;
}

// ====================== Seiten ======================
function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  const tp = E.turnPlayer(g);
  const f = focusSq(g);
  const action = actionHtml(g);
  const side = `${eventHtml(g)}${listHtml(g)}${accountsHtml(g)}${ownHtml(g)}${recapHtml(g)}`;
  if (isDesk()) {
    const center = `${bannerHtml(g)}${diceHtml(g)}${action}`;
    return `${ui.header()}${ui.lost()}<div class="hh-desk"><div class="hh-sqwrap">${D.squareBoardHtml(g, center, { focus: f, active: tp.id })}</div><aside class="hh-side">${side}</aside></div>`;
  }
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${diceHtml(g)}`
    + `<section class="card hh-stripcard">${D.stripHtml(g, { focus: f, active: tp.id })}<p class="hh-cap" aria-hidden="true">← Zur Seite wischen →</p></section>`
    + `${action}${eventHtml(g)}${listHtml(g)}${accountsHtml(g)}${ownHtml(g)}${miniHtml(g, false)}${recapHtml(g)}`;
}

function overHtml(g) {
  const res = g.result || { winners: [], ranking: E.ranking(g), reason: 'last' };
  const rank = res.ranking;
  const winners = rank.filter((r) => r.place === 1 && !r.out);
  const iWon = winners.some((w) => w.id === cid);
  let title;
  if (winners.length === 1) title = iWon ? 'Du hast gewonnen! Glückwunsch!' : `${esc(winners[0].name)} hat gewonnen!`;
  else title = iWon ? `Gleichstand: Du und ${winners.filter((w) => w.id !== cid).map((w) => esc(w.name)).join(' und ')} habt gewonnen!` : `Gleichstand: ${winners.map((w) => esc(w.name)).join(' und ')} haben gewonnen!`;
  const why = res.reason === 'rounds'
    ? `Das Kurzspiel ist nach ${g.opts.maxRounds} Runden zu Ende. Es gewinnt, wer am meisten besitzt: Bargeld, Grundstücke und Häuser zählen.`
    : 'Alle anderen sind bankrott. Das Spiel ist zu Ende.';
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r) => {
    const p = g.players.find((x) => x.id === r.id);
    return `<li class="${r.place === 1 && !r.out ? 'win' : ''}"><span class="medal">${r.out ? '' : r.place === 1 ? '🏆' : medals[r.place - 1] || ''}</span>`
      + `<span class="rn">${D.tokenHtml(p.token, 'sm')} ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.out ? 'ausgeschieden' : r.worth}</span>`
      + `<div class="rd"><span class="chip">${r.out ? 'bankrott' : r.place + '. Platz'}</span>${r.out ? '' : '<span class="chip">Vermögen</span>'}</div></li>`;
  }).join('');
  const again = S.role === 'host'
    ? '<button class="btn primary huge" data-act="again">▶ Noch eine Runde spielen</button>'
    : '<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>';
  return `${ui.header()}${ui.lost()}
    <section class="card over hh-over"><div class="trophy">🏆</div><h1>${title}</h1>
      <p class="center muted">${esc(why)}</p>
      <ol class="ranking">${list}</ol>${again}
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    ${recapHtml(g)}${miniHtml(g, true)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Du kaufst Grundstücke, kassierst Miete und bebaust deine Straßen. Wer am Ende das meiste besitzt, gewinnt.</p>
    <h3>Das Brett</h3>
    <p>Das Brett ist ein Rundweg mit 40 Feldern. Alle starten am Rathaus. Du ziehst im Uhrzeigersinn. Jedes Mal, wenn du am Rathaus vorbeikommst, bekommst du 200 von der Bank. Jede Person hat zu Beginn 1500.</p>
    <h3>Dein Zug</h3>
    <p>Tippe auf <b>Würfeln</b>. Du ziehst so viele Felder weiter, wie beide Würfel zusammen zeigen. Dann passiert, was auf dem Feld steht. Danach kannst du noch bauen oder beleihen und beendest deinen Zug.</p>
    <p><b>Pasch:</b> Zeigen beide Würfel dieselbe Zahl, darfst du nach deinem Zug noch einmal würfeln. Bei drei Päschen hintereinander musst du direkt in den Hexenturm.</p>
    <h3>Die Felder</h3>
    <ul>
      <li><b>Freies Grundstück:</b> Du kannst es zum aufgedruckten Preis kaufen. Dann gehört es dir. Landet jemand anderes dort, zahlt diese Person dir Miete.</li>
      <li><b>Gehört es jemand anderem:</b> Du zahlst Miete an die Besitzerin oder den Besitzer. Wie hoch sie ist, hängt vom Grundstück ab. Mit Häusern wird sie höher. Ist das Grundstück beliehen, zahlst du nichts.</li>
      <li><b>Bahnhöfe:</b> Die Miete steigt mit der Zahl der Bahnhöfe, die jemand besitzt: 25, 50, 100 oder 200.</li>
      <li><b>Stadtwerke:</b> Die Miete ist das 4-Fache der Augensumme. Gehören jemandem beide, ist es das 10-Fache.</li>
      <li><b>Ereignis:</b> Du ziehst eine Karte und tust, was darauf steht. Sie kann Geld bringen, kosten oder dich weiterschicken.</li>
      <li><b>Semestergebühr und Parkgebühr:</b> Du zahlst einen festen Betrag an die Bank.</li>
      <li><b>Lahnwiesen:</b> Hier passiert nichts. Du ruhst dich aus.</li>
      <li><b>Gehe in den Hexenturm:</b> Du kommst direkt in den Hexenturm, ohne am Rathaus vorbeizukommen.</li>
    </ul>
    <h3>Versteigerung</h3>
    <p>Kaufst du ein freies Grundstück nicht, wird es versteigert (wenn die Option eingeschaltet ist). Alle bieten der Reihe nach, du kannst mehr bieten oder passen. Wer passt, ist bei dieser Versteigerung raus. Das höchste Gebot bekommt das Grundstück. Gebote sind immer volle Zehner. Hat niemand Interesse, bleibt es frei.</p>
    <h3>Häuser bauen</h3>
    <p>Gehören dir alle Straßen einer Farbe, darfst du dort bauen. Immer gleichmäßig: Auf keiner Straße darf ein Haus mehr stehen als auf einer anderen derselben Farbe. Ab dem fünften Schritt steht dort ein Hotel. Häuser kosten Geld und erhöhen die Miete stark. Häuser und Hotels sind begrenzt. Du kannst sie für den halben Preis wieder an die Bank verkaufen, auch wieder gleichmäßig. Gehören dir alle Straßen einer Farbe und steht noch kein Haus, ist die Miete schon doppelt so hoch.</p>
    <h3>Hypothek (Beleihen)</h3>
    <p>Du kannst ein Grundstück beleihen: Du bekommst sofort die Hälfte des Kaufpreises von der Bank. Solange es beliehen ist, bringt es keine Miete. Du kannst die Beleihung aufheben, das kostet etwas mehr als du bekommen hast. Auf beliehenen Straßen kannst du nicht bauen. Stehen Häuser in der Farbe, verkaufe sie zuerst.</p>
    <h3>Wenn das Geld nicht reicht</h3>
    <p>Musst du mehr zahlen, als du hast, kannst du Häuser verkaufen und Grundstücke beleihen. Sobald das Geld reicht, wird bezahlt. Reicht auch das nicht, bist du bankrott: Alles geht an die Person, der du Geld schuldest, oder zurück an die Bank. Du kannst auch freiwillig aufgeben.</p>
    <h3>Hexenturm</h3>
    <p>Wer im Hexenturm sitzt, kommt frei mit einem <b>Pasch</b>, durch <b>50 zahlen</b> oder mit einer <b>Freikarte</b> (aus einer Ereigniskarte). Nach drei Fehlversuchen zahlst du 50 und ziehst weiter. Im Hexenturm darfst du weiter bauen, beleihen und Miete kassieren.</p>
    <h3>Spielende</h3>
    <p>Beim <b>Kurzspiel</b> endet das Spiel nach 30 Runden (eine Runde heißt: alle waren einmal dran). Dann gewinnt, wer das meiste besitzt: Bargeld, Kaufpreis der Grundstücke und Häuser zählen, beliehene Grundstücke nur teilweise. Ohne Kurzspiel läuft das Spiel, bis nur noch eine Person übrig ist.</p>
    <p class="muted">Tauschen gibt es in diesem Spiel nicht. Das Programm zeigt dir nur, was erlaubt ist, und rechnet alles aus. Was du tust, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const SIMPLE = new Set(['roll', 'pay_jail', 'use_card', 'buy', 'decline', 'pass_bid', 'end']);
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: [
    { id: 'short', label: 'Kurzspiel: nach 30 Runden gewinnt der Reichste', def: true, help: 'Ohne Häkchen läuft das Spiel, bis alle bis auf eine Person bankrott sind.' },
    { id: 'auction', label: 'Versteigerung', def: true, help: 'Wer ein freies Grundstück nicht kauft, löst eine Versteigerung aus.' },
  ],
  title: 'Haus & Hof', icon: '🏘️', sub: 'Würfeln, Grundstücke kaufen, Miete kassieren – für 2 bis 6 Personen',
  helpTitle: 'Die Spielregeln von Haus & Hof', helpBody: helpBody(),
  minPlayers: 2,
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    if (!isG(g)) return undefined;
    if (act === 'tog') { S.ui.open = { ...S.ui.open, [el.dataset.k]: !S.ui.open[el.dataset.k] }; return render(); }
    if (act === 'focus') {
      const sq = Number(el.dataset.sq);
      S.ui.manual = sq; S.ui.manualSeq = g.seq; lastUserScroll = 0;
      return render();
    }
    if (g.phase === 'over' || !actorIsMe(g)) return undefined;
    if (SIMPLE.has(act)) return sess.send({ t: act });
    if (act === 'bid') return sess.send({ t: 'bid', amount: Number(el.dataset.amt) });
    if (act === 'build' || act === 'sell' || act === 'mortgage' || act === 'unmortgage') return sess.send({ t: act, sq: Number(el.dataset.sq) });
    if (act === 'declare_bankrupt') {
      if (confirm('Möchtest du wirklich aufgeben? Du scheidest dann aus dem Spiel aus.')) return sess.send({ t: 'declare_bankrupt' });
    }
    return undefined;
  },
});
ui.boot();
