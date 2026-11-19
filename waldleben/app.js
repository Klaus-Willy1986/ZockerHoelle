import * as M from './engine.js';
import { CARDS, SPECIES, TYPES, ptsText, fxText, costText, typeName, cardPoints } from './cards.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'hints', label: 'Spielbare Karten anzeigen', help: 'Zeigt dir, welche Handkarten du gerade ausspielen kannst. Ohne diese Hilfe musst du selbst schauen.', def: false },
  { id: 'short', label: 'Kurzspiel', help: 'Weniger Karten im Stapel: Das Spiel ist früher zu Ende.', def: false },
];
const LEARN_DECK = 30; // In der Lernrunde ist der Stapel klein, damit sie nicht ewig dauert

// Nur für Tests: ?deck=40 in der Adresse setzt die Stapelgröße
const urlDeck = () => {
  try { const v = Number(new URLSearchParams(location.search).get('deck')); return Number.isInteger(v) && v >= 20 && v <= 113 ? v : null; } catch { return null; }
};

const freshUi = () => ({ note: null, sel: null, pay: [], tree: null, lsel: null, peek: null, view: null, vtree: null, coachSeen: {} });

const sess = createSession({
  game: 'waldleben',
  maxPlayers: 5,
  options: OPTIONS,
  newGame: (players, opts) => {
    S.ui = { ...S.ui, ...freshUi() };
    const o = { ...opts };
    const ud = urlDeck();
    if (ud) o.deck = ud; else if (S.learn) o.deck = LEARN_DECK;
    return M.createGame(players, o, Math.random, sess.cid);
  },
  onMessage: (state, pid, msg) => { M.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase !== 'play') return null;
      const ap = M.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const me = () => (S.game ? S.game.players.find((p) => p.id === cid) : null);
const playerById = (g, id) => g.players.find((p) => p.id === id);
const myTurn = (g) => g.phase === 'play' && M.activePlayer(g).id === cid;

// Auswahl bereinigen, wenn sich der Spielstand geändert hat
function tidyUi() {
  const g = S.game; const u = S.ui;
  const p = g ? me() : null;
  if (!g || !p) { Object.assign(u, freshUi()); return; }
  if (u.sel !== null && !p.hand.includes(u.sel)) { u.sel = null; u.pay = []; u.tree = null; }
  u.pay = (u.pay || []).filter((id) => p.hand.includes(id) && id !== u.sel);
  if (u.sel === null) { u.pay = []; u.tree = null; }
  if (u.tree !== null && (!Number.isInteger(u.tree) || u.tree >= p.trees.length)) u.tree = null;
  if (u.lsel !== null && !g.clearing.includes(u.lsel)) u.lsel = null;
  if (u.view && !playerById(g, u.view)) { u.view = null; u.vtree = null; }
  const vp = playerById(g, u.view || cid);
  if (u.vtree !== null && (!vp || u.vtree >= vp.trees.length)) u.vtree = null;
  if (g.phase !== 'play') { u.sel = null; u.pay = []; u.tree = null; u.lsel = null; }
  if (!myTurn(g)) { u.pay = []; u.tree = null; } // Ausgewählte Handkarte bleibt zum Lesen
  if (g.drawLeft > 0) { u.sel = null; u.pay = []; u.tree = null; }
}
function onStateChanged() {
  S.ui.note = null;
  tidyUi();
  render();
}

// ====================== Darstellung ======================
const kartenZahl = (n) => (n === 1 ? '1 Karte' : `${n} Karten`);
const punkteZahl = (n) => (n === 1 ? '1 Punkt' : `${n} Punkte`);
const spCls = (c) => (c.sp >= 0 ? `sp${c.sp}` : 'sp-1');
const hintsOn = (g) => !!g.opts.hints || !!S.learn;

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  const ap = M.activePlayer(g);
  if (ap.id === cid) return `<div class="banner mine">${g.drawLeft > 0 ? `Du ziehst: noch ${kartenZahl(g.drawLeft)}` : 'Du bist dran!'}</div>`;
  return `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function winterHtml(g) {
  const flakes = [0, 1, 2].map((i) => `<span class="${i < g.winters ? 'on' : ''}">❄️</span>`).join('');
  return `<span class="wl-stat wl-win" role="img" aria-label="Winter: ${g.winters} von 3 Winterkarten sind schon aufgedeckt"><b>${flakes}</b><small>Winter ${g.winters} von 3</small></span>`;
}

function miniCard(id, attrs) {
  const c = CARDS[id];
  return `<button type="button" class="wl-mini ${spCls(c)}${S.ui.lsel === id ? ' sel' : ''}" ${attrs} aria-label="${esc(`${c.name}, ${typeName(c)}, ${costText(c.cost)}`)}">
    <span class="wl-top"><span class="wl-sym" aria-hidden="true">${SPECIES[c.sp].sym}</span>${c.kind === 'life' ? `<span class="wl-cost" aria-hidden="true">${c.cost}</span>` : ''}</span>
    <span class="wl-em" aria-hidden="true">${c.sym}</span><span class="wl-nm${c.name.length > 11 ? ' long' : ''}">${esc(c.name)}</span></button>`;
}

function boardHtml(g) {
  const tiles = g.clearing.map((id) => miniCard(id, `data-act="lich" data-id="${id}"`)).join('');
  return `<section class="card wl-board" id="board">
    <div class="wl-stats">
      <span class="wl-stat"><b>${g.deck.length}</b><small>im Stapel</small></span>
      ${winterHtml(g)}
      <span class="wl-stat"><b>${g.clearing.length} von ${M.LICHTUNG_MAX}</b><small>in der Lichtung</small></span>
    </div>
    <h2 class="wl-h">🌲 Die Lichtung</h2>
    <div class="wl-lich" tabindex="0" role="group" aria-label="Die Lichtung: offene Karten in der Mitte">${tiles || '<span class="wl-empty">Die Lichtung ist leer.</span>'}</div>
    <p class="wl-sw muted">${g.clearing.length > 3 ? 'Wische die Reihe seitwärts. ' : ''}Ab ${M.LICHTUNG_MAX} Karten wird die Lichtung geleert.</p>
  </section>`;
}

function handTile(g, p, id) {
  const c = CARDS[id];
  const u = S.ui;
  const mine = myTurn(g);
  const hints = hintsOn(g) && mine && g.drawLeft === 0;
  let cls = `wl-card ${c.kind === 'tree' ? 'tree' : 'life'} ${spCls(c)}`;
  if (u.sel === id) cls += ' sel';
  if (u.pay.includes(id)) cls += ' pay';
  if (hints && u.sel === null) cls += M.canPlayAsSelf(g, p, id) ? ' can' : ' dim';
  const pts = c.kind === 'tree' ? 'Baum' : c.pts && c.pts.k === 'fix' ? `★ ${c.pts.n}` : '★ bedingt';
  const chk = u.pay.includes(id) ? '<span class="wl-chk" aria-hidden="true">✔ zahlt</span>' : '';
  return `<button type="button" class="${cls}" data-act="hand" data-id="${id}" aria-label="${esc(`${c.name}, ${typeName(c)}, ${c.kind === 'life' ? costText(c.cost) : 'kostenlos'}`)}${u.pay.includes(id) ? ', zahlt' : ''}">
    <span class="wl-top"><span class="wl-sym" aria-hidden="true">${SPECIES[c.sp].sym}</span>${c.kind === 'life' ? `<span class="wl-cost" aria-hidden="true">${c.cost}</span>` : ''}</span>
    <span class="wl-em" aria-hidden="true">${c.sym}</span><span class="wl-nm${c.name.length > 11 ? ' long' : ''}">${esc(c.name)}</span><span class="wl-pt">${pts}</span>${chk}</button>`;
}

function handHtml(g) {
  const p = me();
  if (!p) return '';
  const ids = p.hand.slice().sort((a, b) => {
    const ca = CARDS[a]; const cb = CARDS[b];
    if (ca.kind !== cb.kind) return ca.kind === 'tree' ? -1 : 1;
    return ca.kind === 'tree' ? ca.sp - cb.sp || a - b : ca.cost - cb.cost || ca.name.localeCompare(cb.name, 'de') || a - b;
  });
  const lim = M.handLimit(p);
  return `<section class="card wl-handcard"><h2>Deine Handkarten (${p.hand.length} von ${lim})</h2>
    <div class="wl-hand" role="group" aria-label="Deine Handkarten">${ids.map((id) => handTile(g, p, id)).join('') || '<p class="muted">Du hast keine Handkarten.</p>'}</div>
    <p class="wl-leg muted">Oben links: Baumfarbe der Karte. Oben rechts: Kosten, so viele andere Handkarten gibst du ab.</p></section>`;
}

// ---- große Karte (zwei Hälften: oben Name und Kosten, unten Punkte und Wirkung) ----
function bigCard(id, extra = '') {
  const c = CARDS[id];
  const sp = SPECIES[c.sp];
  const top = c.kind === 'tree'
    ? `<span>${sp.sym} ${sp.name}</span><span>Baumkarte</span>`
    : `<span>${sp.sym} ${sp.name}-Karte</span><span>${costText(c.cost)}</span>`;
  const body = c.kind === 'tree'
    ? `<p class="pts">Ein Baum bringt keine Punkte, hat aber 4 freie Plätze für Tiere, Pflanzen und Pilze.</p>`
    : `<p class="pts">★ ${esc(ptsText(c))}</p>${c.fx ? `<p class="fx">${esc(fxText(c))}</p>` : ''}`;
  return `<div class="wl-big ${spCls(c)}"><div class="wl-bt">${top}</div>
    <div class="wl-bb"><span class="em" aria-hidden="true">${c.sym}</span><div><h3>${esc(c.name)}</h3><div class="ty">${c.kind === 'tree' ? 'Baum' : esc(`${TYPES[c.type].name}`)}</div></div></div>
    <div class="wl-bp">${body}${extra}</div></div>`;
}

// ---- Baum- und Platzwahl in der Handlungsleiste ----
function pickerHtml(g, p) {
  const u = S.ui;
  const trees = p.trees.map((t, i) => {
    const free = M.treeFree(t).length;
    const sp = t.sp >= 0 ? SPECIES[t.sp] : null;
    return `<button type="button" class="wl-ptree ${t.sp >= 0 ? 'sp' + t.sp : 'sp-1'}${u.tree === i ? ' sel' : ''}" data-act="ptree" data-i="${i}" ${free ? '' : 'disabled'} aria-label="${esc(`Baum ${i + 1}, ${sp ? sp.name : 'Sprössling'}, ${free} freie Plätze`)}">
      <span class="n">${i + 1}</span><span class="e" aria-hidden="true">${sp ? sp.sym : '🌱'}</span><span class="f">${free ? `${free} frei` : 'voll'}</span></button>`;
  }).join('');
  const t = u.tree !== null ? p.trees[u.tree] : null;
  const sides = [0, 1, 2, 3].map((s) => {
    const free = t && t.sides[s] === null;
    const lab = ['⬆ oben', '⬇ unten', '⬅ links', '➡ rechts'][s];
    return `<button type="button" class="btn ${free ? 'primary' : 'ghost'} wl-side" data-act="place" data-side="${s}" ${free ? '' : 'disabled'}>${lab}${t && !free ? '<small>besetzt</small>' : ''}</button>`;
  }).join('');
  return `<p class="wl-lab">Baum wählen:</p><div class="wl-pick" tabindex="0" role="group" aria-label="Deine Bäume">${trees}</div>
    <p class="wl-lab">${t ? `Platz an Baum ${u.tree + 1} wählen:` : 'Dann den Platz wählen (zuerst einen Baum antippen):'}</p><div class="wl-sides">${sides}</div>`;
}

function actionHtml(g) {
  const p = me();
  const u = S.ui;
  if (!p) return `<p class="big">Du schaust nur zu.</p>`;
  const note = u.note ? `<p class="wl-note">${esc(u.note)}</p>` : '';
  const cancel = `<button class="btn ghost" data-act="cancel">Zurück</button>`;
  if (g.phase === 'over') return `<p class="big">Das Spiel ist zu Ende. Unten siehst du die Wertung.</p>`;
  const ap = M.activePlayer(g);
  const mine = ap.id === cid;
  // eine Karte aus der Lichtung ist angetippt
  if (u.lsel !== null) {
    const can = mine && M.canDrawNow(g, p);
    return `${note}<p class="big">${can ? 'Diese Karte aus der Lichtung nehmen?' : 'Eine Karte aus der Lichtung:'}</p>${bigCard(u.lsel)}
      ${can ? `<button class="btn primary huge" data-act="take">Diese Karte nehmen</button>` : `<p class="muted">${mine ? 'Du kannst gerade keine Karte nehmen.' : 'Du bist noch nicht dran.'}</p>`}${cancel}`;
  }
  if (!mine) {
    if (u.sel !== null) return `${note}<p class="big">Du bist noch nicht dran. Du kannst dir die Karte aber schon ansehen.</p>${bigCard(u.sel)}${cancel}`;
    return `<p class="big"><b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p><p class="muted">Tippe auf eine Karte, um sie dir in Ruhe anzusehen.</p>`;
  }
  if (g.drawLeft > 0) {
    return `${note}<p class="big">Du ziehst Karten: noch <b>${kartenZahl(g.drawLeft)}</b>. Tippe auf den Stapel oder auf eine Karte in der Lichtung.</p>
      <button class="btn primary huge" data-act="deck">🌳 Vom Stapel ziehen</button>`;
  }
  if (u.sel === null) {
    const full = !M.canDrawNow(g, p);
    return `${note}<p class="big">Du bist dran. Du machst jetzt <b>eins</b> von beiden:</p>
      <ul class="wl-opts"><li><b>Karten ziehen:</b> vom Stapel oder aus der Lichtung.</li><li><b>Eine Handkarte ausspielen:</b> tippe auf die Karte.</li></ul>
      ${full ? `<p class="wl-note">Deine Hand ist voll. Du musst eine Karte ausspielen.</p>` : `<button class="btn primary huge" data-act="deck">🌳 Vom Stapel ziehen</button>`}`;
  }
  const c = CARDS[u.sel];
  const sprout = `<button class="btn secondary" data-act="sprout">🌱 Als Sprössling pflanzen (verdeckt)</button>`;
  if (c.kind === 'tree') {
    return `${note}<p class="big">Baum pflanzen? Das kostet nichts. Danach kommt eine Karte vom Stapel in die Lichtung.</p>${bigCard(c.id)}
      <button class="btn primary huge" data-act="plant">🌳 ${esc(c.name)} pflanzen</button>${cancel}`;
  }
  if (p.hand.length - 1 < c.cost) {
    return `${note}<p class="big">Zum Bezahlen fehlen dir Karten: Du brauchst ${kartenZahl(c.cost)} zusätzlich zu dieser Karte.</p>${bigCard(c.id)}${sprout}${cancel}`;
  }
  if (M.freeSlots(p) === 0) {
    return `${note}<p class="big">Du hast keinen freien Platz an einem Baum. Pflanze erst einen Baum – oder diese Karte als Sprössling.</p>${bigCard(c.id)}${sprout}${cancel}`;
  }
  if (u.pay.length < c.cost) {
    const rest = c.cost - u.pay.length;
    return `${note}<p class="big">Bezahlen: Tippe auf <b>${kartenZahl(rest)}</b> in deiner Hand, die du abgibst. Sie kommen in die Lichtung.</p>${bigCard(c.id)}${sprout}${cancel}`;
  }
  const passend = c.cost >= 1 && u.pay.every((id) => CARDS[id].sp === c.sp);
  const pass = passend ? `<p class="wl-good">✔ Passend bezahlt: alle Zahlkarten haben die Baumfarbe ${SPECIES[c.sp].name} (${SPECIES[c.sp].sym}). Du ziehst dafür ${(M.passBonus(p) === 2) ? '2 Karten' : '1 Karte'} extra.</p>` : '';
  return `${note}<p class="big">${c.cost ? 'Bezahlt. ' : ''}Wähle den Baum und den Platz für ${esc(c.name)}.</p>${pass}${bigCard(c.id)}${pickerHtml(g, p)}${sprout}${cancel}`;
}

// ---- Mitspielende und Wälder ----
function playersHtml(g) {
  const ap = M.activePlayer(g);
  const vid = S.ui.view || cid;
  const lis = g.players.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(weg)</span>' : '';
    const sc = M.score(g, p).total;
    return `<li><button type="button" class="wl-opp${g.phase === 'play' && ap.id === p.id ? ' act' : ''}${vid === p.id ? ' vw' : ''}" data-act="view" data-pid="${esc(p.id)}" aria-label="${esc(`Wald von ${p.name} ansehen`)}">
      <b class="wl-nm2">${esc(p.name)}${p.id === cid ? ' (du)' : ''}${off}</b>
      <span class="wl-st"><b>${p.hand.length}</b><small>Hand</small></span>
      <span class="wl-st"><b>${p.cave.length}</b><small>Höhle</small></span>
      <span class="wl-st"><b>${sc}</b><small>Punkte</small></span></button></li>`;
  }).join('');
  return `<section class="card wl-players"><h2>Alle Mitspielenden</h2><ul class="wl-opps" aria-label="Alle Mitspielenden">${lis}</ul>
    <p class="muted small">Tippe auf eine Person, um unten ihren Wald zu sehen. „Punkte“ ist der Stand jetzt.</p></section>`;
}

function treeTile(t, i, sel) {
  const sp = t.sp >= 0 ? SPECIES[t.sp] : null;
  const n = t.sides.filter((s) => s !== null).length;
  const em = t.sides.map((s) => (s === null ? '▫️' : CARDS[s].sym)).join('');
  return `<button type="button" class="wl-tree ${t.sp >= 0 ? 'sp' + t.sp : 'sp-1'}${sel ? ' sel' : ''}" data-act="vtree" data-i="${i}" aria-label="${esc(`Baum ${i + 1}, ${sp ? sp.name : 'Sprössling'}, ${n} von 4 Plätzen besetzt`)}">
    <span class="wl-top"><span class="wl-sym" aria-hidden="true">${sp ? sp.sym : '🌱'}</span><span class="wl-cost" aria-hidden="true">${i + 1}</span></span>
    <span class="wl-em" aria-hidden="true">${sp ? '🌳' : '🌱'}</span><span class="wl-nm">${sp ? sp.name : 'Sprössling'}</span><span class="wl-sub">${n} von 4</span><span class="wl-mini-em" aria-hidden="true">${em}</span></button>`;
}

function treeDetailHtml(g, vp) {
  const i = S.ui.vtree;
  if (i === null || !vp.trees[i]) return `<div class="wl-tdetail empty"><p class="muted">Tippe oben auf einen Baum. Dann siehst du hier seine 4 Seiten.</p></div>`;
  const t = vp.trees[i];
  const sp = t.sp >= 0 ? SPECIES[t.sp] : null;
  const cell = (s, lab) => {
    const id = t.sides[s];
    if (id === null) return `<div class="wl-cell free"><small>${lab}</small><span>frei</span></div>`;
    const c = CARDS[id];
    return `<button type="button" class="wl-cell ${spCls(c)}" data-act="peek" data-id="${id}" aria-label="${esc(`${lab}: ${c.name}, ${cardPoints(vp, c)} Punkte. Antippen für Details`)}"><small>${lab}</small><span class="em" aria-hidden="true">${c.sym}</span><b>${esc(c.name)}</b><i>${punkteZahl(cardPoints(vp, c))}</i></button>`;
  };
  return `<div class="wl-tdetail"><h3>Baum ${i + 1}: ${sp ? esc(sp.name) : 'Sprössling (Art unbekannt)'}</h3>
    <div class="wl-cross"><div class="c-up">${cell(0, 'oben')}</div><div class="c-left">${cell(2, 'links')}</div>
      <div class="c-mid ${t.sp >= 0 ? 'sp' + t.sp : 'sp-1'}"><span aria-hidden="true">${sp ? '🌳' : '🌱'}</span><b>${sp ? esc(sp.name) : 'Sprössling'}</b></div>
      <div class="c-right">${cell(3, 'rechts')}</div><div class="c-down">${cell(1, 'unten')}</div></div></div>`;
}

function forestHtml(g) {
  const vid = S.ui.view || cid;
  const vp = playerById(g, vid) || me() || g.players[0];
  const own = vp.id === cid;
  const trees = vp.trees.map((t, i) => treeTile(t, i, S.ui.vtree === i)).join('');
  const cave = vp.cave.length;
  return `<section class="card wl-forest"><h2>${own ? 'Dein Wald' : `Wald von ${esc(vp.name)}`} (${vp.trees.length} ${vp.trees.length === 1 ? 'Baum' : 'Bäume'})</h2>
    <div class="wl-trees" tabindex="0" role="group" aria-label="${own ? 'Dein Wald' : 'Wald von ' + esc(vp.name)}: Bäume">${trees || '<span class="wl-empty">Noch kein Baum gepflanzt.</span>'}</div>
    <p class="wl-sw muted">${vp.trees.length > 3 ? 'Wische die Reihe seitwärts. ' : ''}Tippe auf einen Baum, um seine 4 Seiten zu sehen.</p>
    ${treeDetailHtml(g, vp)}
    <p class="wl-cave">🕳️ Höhle: <b>${cave}</b> ${cave === 1 ? 'Karte' : 'Karten'} (je 1 Punkt am Ende, verdeckt)</p></section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 5).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function peekHtml() {
  const id = S.ui.peek;
  if (id === null || id === undefined || !CARDS[id]) return '';
  return `<div class="overlay" data-act="peek-close"><div class="modal" role="dialog" aria-modal="true" aria-label="Karte ansehen">
    ${bigCard(id)}<button class="btn primary huge" data-act="peek-close">Schließen</button></div></div>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    ${boardHtml(g)}
    ${handHtml(g)}
    <section class="card action wl-action" aria-live="polite">${actionHtml(g)}</section>
    ${playersHtml(g)}
    ${forestHtml(g)}
    ${recapHtml(g)}${peekHtml()}`;
}

// ---- Spielende: Wertung zum Nachlesen ----
function breakdownHtml(g, p, open) {
  const sc = M.score(g, p);
  const rows = sc.trees.map((tr) => {
    const sp = tr.sp >= 0 ? SPECIES[tr.sp] : null;
    const head = `<h4>Baum ${tr.i + 1}: ${sp ? `${esc(sp.name)} ${sp.sym}` : 'Sprössling'} <span>${punkteZahl(tr.sum)}</span></h4>`;
    const items = tr.cards.length
      ? tr.cards.map((r) => { const c = CARDS[r.id]; return `<li><span class="em" aria-hidden="true">${c.sym}</span><span class="t"><b>${esc(c.name)}</b> (${M.sideName(r.side)})<small>${esc(ptsText(c))}${r.how && r.how !== 'feste Punkte' ? ': ' + esc(r.how) : ''}</small></span><span class="p">${r.pts}</span></li>`; }).join('')
      : '<li class="none">Keine Karten angelegt.</li>';
    return `<div class="wl-bd-tree">${head}<ul>${items}</ul></div>`;
  }).join('') || '<p class="muted">Kein Baum im Wald.</p>';
  return `<details class="wl-bd"${open ? ' open' : ''}><summary><b>${esc(p.name)}${p.id === cid ? ' (du)' : ''}</b><span>${punkteZahl(sc.total)}</span></summary>
    ${rows}<div class="wl-bd-cave"><h4>🕳️ Höhle <span>${punkteZahl(sc.cave)}</span></h4><p class="muted">${kartenZahl(sc.cave)} in der Höhle: je 1 Punkt.</p></div>
    <p class="wl-bd-sum">Zusammen: <b>${punkteZahl(sc.total)}</b> (Bäume zählen selbst keine Punkte.)</p></details>`;
}

function overHtml(g) {
  const r = g.result;
  const isHost = sess.S.role === 'host';
  const rank = M.ranking(g);
  const winners = r.winners || [];
  let title; let trophy = '🌲';
  if (winners.length === 1) {
    const w = playerById(g, winners[0]);
    title = winners[0] === cid ? 'Du hast gewonnen!' : `${esc(w.name)} hat gewonnen!`;
  } else {
    title = `Gleichstand: ${winners.map((id) => esc(playerById(g, id).name)).join(' und ')} gewinnen gemeinsam!`;
  }
  if (winners.includes(cid)) trophy = '🏆';
  const why = r.why === 'winter' ? 'Die dritte Winterkarte wurde aufgedeckt. Jetzt wird gezählt.' : 'Das Spiel dauerte sehr lange und wurde beendet. Jetzt wird gezählt.';
  const btns = isHost
    ? `<button class="btn primary huge" data-act="again">▶ Neues Spiel</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  const table = rank.map((x) => `<tr class="${winners.includes(x.id) ? 'lead' : ''}"><td>${x.rank}.</td><td>${esc(x.name)}${x.id === cid ? ' (du)' : ''}${winners.includes(x.id) ? ' 🏆' : ''}</td><td class="n">${x.points}</td></tr>`).join('');
  const details = rank.map((x) => breakdownHtml(g, playerById(g, x.id), x.id === cid || winners.includes(x.id) && g.players.length <= 3)).join('');
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}
    <section class="card over wl-over"><div class="trophy">${trophy}</div>
      <h1>${title}</h1><p class="center muted">${why}</p>
      <div class="wl-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card" id="board"><h2>Endstand</h2><table class="wl-table"><thead><tr><th></th><th>Name</th><th class="n">Punkte</th></tr></thead><tbody>${table}</tbody></table>
      <p class="muted small">Alle Punkte der Karten im Wald plus 1 Punkt für jede Karte in der Höhle.</p></section>
    <section class="card"><h2>So kommen die Punkte zustande</h2><p class="muted">Tippe auf einen Namen, um die Wertung Baum für Baum zu lesen.</p>${details}</section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Baue den schönsten Wald. Wer am Ende die meisten Punkte hat, gewinnt. Jede Person baut ihren eigenen Wald.</p>
    <h3>Die Karten</h3>
    <ul>
      <li><b>Bäume:</b> Eiche ●, Buche ■, Linde ▲, Ahorn ◆, Birke ★ und Kiefer ✚. Ein Baum bringt keine Punkte, hat aber 4 Plätze: oben, unten, links und rechts.</li>
      <li><b>Tiere, Pflanzen und Pilze:</b> Sie legst du an einen freien Platz eines Baums. Auf jeder Karte steht oben links die Baumfarbe, oben rechts die Kosten, und unten die Punkte und eine kurze Wirkung. Auf jeden Platz passt genau eine Karte.</li>
      <li><b>Winterkarten:</b> Es gibt 3. Sie sind im unteren Drittel des Stapels versteckt.</li>
    </ul>
    <h3>Dein Zug</h3>
    <p>Du machst in deinem Zug genau <b>eins</b> von beiden:</p>
    <ul>
      <li><b>Karten ziehen:</b> Du ziehst bis zu 2 Karten, jede entweder vom Stapel oder aus der Lichtung (die offenen Karten in der Mitte). Du darfst höchstens 10 Handkarten haben. Mit 9 Karten darfst du nur eine ziehen, mit 10 gar keine.</li>
      <li><b>Eine Karte ausspielen:</b>
        <br>• <b>Baum:</b> Er kostet nichts. Du pflanzt ihn in deinen Wald. Danach wird eine Karte vom Stapel offen in die Lichtung gelegt.
        <br>• <b>Tier, Pflanze oder Pilz:</b> Gib so viele andere Handkarten ab, wie die Kosten sagen. Sie kommen in die Lichtung. Dann legst du die Karte an einen freien Platz eines deiner Bäume. Danach gilt ihre Wirkung.
        <br>• <b>Sprössling:</b> Jede Handkarte darfst du verdeckt als Sprössling pflanzen. Das ist ein Baum ohne Art. Auch dann wird eine Karte vom Stapel in die Lichtung gelegt.</li>
    </ul>
    <h3>Die Lichtung</h3>
    <p>Hat die Lichtung nach deinem Ausspielen 10 Karten oder mehr, wird sie sofort geleert.</p>
    <h3>Passend bezahlen</h3>
    <p>Wenn alle Karten, mit denen du bezahlst, dieselbe Baumfarbe haben wie die Karte, die du ausspielst, ziehst du sofort 1 Karte extra. Das geht nur bei Karten, die etwas kosten.</p>
    <h3>Wirkungen</h3>
    <ul>
      <li><b>Ziehe Karten:</b> Du ziehst sofort vom Stapel (bis zur Handgrenze).</li>
      <li><b>Höhle:</b> Die obersten Karten vom Stapel kommen verdeckt in deine Höhle. Am Ende bringt jede Karte in der Höhle 1 Punkt.</li>
      <li><b>Extrazug:</b> Du bist gleich noch einmal dran.</li>
      <li><b>Dauer (nur bei 3 Pilzen):</b> Die Wirkung gilt, solange der Pilz in deinem Wald liegt.</li>
    </ul>
    <h3>Punkte</h3>
    <p>Die Punkte stehen auf jeder Karte. Manche Karten bringen feste Punkte, andere zählen etwas in deinem Wald, zum Beispiel „1 Punkt pro Vogel“ (die Karte selbst zählt mit) oder „5 Punkte, wenn du mindestens 3 verschiedene Baumarten hast“. Die Kartenarten sind Vogel, Säugetier, Insekt, Kleintier, Pilz und Pflanze. Sprösslinge zählen als Bäume, aber sie haben keine Art.</p>
    <h3>Das Ende</h3>
    <p>Die dritte Winterkarte beendet das Spiel sofort. Gewertet wird dann: alle Karten in den Wäldern plus 1 Punkt je Karte in der Höhle. Handkarten zählen nicht. Die Wertung wird Baum für Baum gezeigt.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Züge und rechnet alles selbst. Auf Wunsch zeigt es dir, welche Karten du ausspielen kannst.</p>
`;
}

// ====================== Bedienung ======================
function send(msg) {
  const u = S.ui;
  u.sel = null; u.pay = []; u.tree = null; u.lsel = null;
  sess.send(msg);
}
function warn(text) { S.ui.note = text; render(); }

const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 1, coach },
  title: 'Waldleben', icon: '🌳', sub: 'Das Kartenspiel – baue deinen Wald, online zusammen spielen',
  helpTitle: 'Die Spielregeln von Waldleben', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el, ev) => {
    const g = S.game;
    const u = S.ui;
    const p = g ? me() : null;
    const id = el.dataset.id !== undefined ? Number(el.dataset.id) : null;
    switch (act) {
      case 'hand': {
        if (!g || !p || !Number.isInteger(id) || !p.hand.includes(id)) return undefined;
        const c = CARDS[id];
        u.lsel = null;
        if (u.sel === id) { u.sel = null; u.pay = []; u.tree = null; return render(); }
        const cur = u.sel !== null ? CARDS[u.sel] : null;
        // Bezahl-Phase: andere Handkarten antippen = abgeben
        if (cur && cur.kind === 'life' && myTurn(g) && g.drawLeft === 0 && cur.cost > 0 && p.hand.length - 1 >= cur.cost && M.freeSlots(p) > 0) {
          if (u.pay.includes(id)) { u.pay = u.pay.filter((x) => x !== id); u.tree = null; return render(); }
          if (u.pay.length < cur.cost) { u.pay = [...u.pay, id]; if (u.pay.length === cur.cost) u.tree = null; return render(); }
          return warn('Du hast schon genug Karten zum Bezahlen gewählt. Tippe auf eine gewählte Karte, um sie wieder abzuwählen.');
        }
        u.sel = c.id; u.pay = []; u.tree = null;
        return render();
      }
      case 'cancel': u.sel = null; u.pay = []; u.tree = null; u.lsel = null; return render();
      case 'deck':
        if (!g || !p || !myTurn(g) || !M.canDrawNow(g, p)) return warn('Du kannst gerade keine Karte ziehen.');
        return send({ t: 'draw', src: 'deck' });
      case 'lich':
        if (!g || !Number.isInteger(id) || !g.clearing.includes(id)) return undefined;
        u.sel = null; u.pay = []; u.tree = null;
        u.lsel = u.lsel === id ? null : id;
        return render();
      case 'take':
        if (!g || !p || u.lsel === null || !myTurn(g) || !M.canDrawNow(g, p)) return warn('Du kannst gerade keine Karte nehmen.');
        return send({ t: 'draw', src: 'clearing', card: u.lsel });
      case 'plant':
        if (!g || !p || u.sel === null || !myTurn(g) || CARDS[u.sel].kind !== 'tree') return undefined;
        return send({ t: 'tree', card: u.sel });
      case 'sprout':
        if (!g || !p || u.sel === null || !myTurn(g)) return undefined;
        return send({ t: 'sprout', card: u.sel });
      case 'ptree': {
        const i = Number(el.dataset.i);
        if (!p || !Number.isInteger(i) || !p.trees[i] || !M.treeFree(p.trees[i]).length) return undefined;
        u.tree = u.tree === i ? null : i;
        return render();
      }
      case 'place': {
        const side = Number(el.dataset.side);
        if (!g || !p || u.sel === null || u.tree === null || !myTurn(g)) return warn('Wähle zuerst einen Baum.');
        const t = p.trees[u.tree];
        if (!t || t.sides[side] !== null) return warn('Dieser Platz ist schon besetzt.');
        return send({ t: 'life', card: u.sel, pay: u.pay.slice(), tree: u.tree, side });
      }
      case 'view': {
        if (!g || !playerById(g, el.dataset.pid)) return undefined;
        u.view = el.dataset.pid; u.vtree = null; return render();
      }
      case 'vtree': {
        const i = Number(el.dataset.i);
        u.vtree = u.vtree === i ? null : i; return render();
      }
      case 'peek': if (Number.isInteger(id)) { u.peek = id; render(); } return undefined;
      case 'peek-close':
        if (el.classList.contains('overlay') && ev && ev.target !== el) return undefined; // Klick ins Fenster schließt nicht
        u.peek = null; return render();
      default: return undefined;
    }
  },
});
function render() { ui.render(); }

// Wischpositionen der Reihen bleiben beim Neuzeichnen erhalten
const SCROLLERS = ['wl-lich', 'wl-trees', 'wl-pick'];
$app.addEventListener('scroll', (e) => {
  const t = e.target;
  if (!t || !t.classList) return;
  for (const k of SCROLLERS) if (t.classList.contains(k)) { S.ui.sx = S.ui.sx || {}; S.ui.sx[k] = t.scrollLeft; }
}, true);
new MutationObserver(() => {
  const sx = S.ui.sx;
  if (!sx) return;
  for (const k of SCROLLERS) { const n = $app.querySelector('.' + k); if (n && typeof sx[k] === 'number') n.scrollLeft = sx[k]; }
}).observe($app, { childList: true });
ui.boot();
