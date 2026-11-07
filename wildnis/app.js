import * as E from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { tileSvg, tokenSvg, boardSvg, tileTitle, cellCenter, HEX_W, ANIMAL_EMOJI, ANIMAL_LABEL, ANIMAL_PLURAL, HABITAT_LABEL } from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const ZOOMS = [44, 56, 68, 84, 100, 120]; // Breite eines Plättchens in Pixeln
const freshUi = () => ({ mode: 'normal', fTi: null, fMi: null, wsel: [], rot: 0, rotKey: '', note: '', sigKey: '', cnt: null, lastCell: null, anchor: null, open: {} });

const sess = createSession({
  game: 'wn',
  maxPlayers: 4,
  newGame: (players) => { S.ui = { ...S.ui, ...freshUi() }; return E.createGame(players, {}, Math.random); },
  onMessage: (state, pid, msg) => { E.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  bot: {
    delay: 750,
    step: (g, level) => {
      if (!g || g.game !== 'wm' || g.phase === 'over') return null;
      const ap = E.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...S.ui, ...freshUi(), zoom: Number(sess.get('wn_zoom', 68)) || 68 };
if (!ZOOMS.includes(S.ui.zoom)) S.ui.zoom = 68;

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const isMine = (g) => !!g && g.phase !== 'over' && !!g.players[g.active] && g.players[g.active].id === cid;
const tilesPlaced = (p) => Object.values(p.board).filter((c) => c.t < 85).length;
const boardCenter = (board) => {
  const b = E.boardBounds(board);
  return cellCenter((b.minQ + b.maxQ) / 2, (b.minR + b.maxR) / 2);
};

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  let scrollTo = null;
  if (g && g.game === 'wm') {
    // Wer hat zuletzt ein Plättchen gelegt? (Brett mit dem gewachsenen Plättchenzähler)
    const cnt = g.players.map(tilesPlaced);
    if (!S.ui.cnt || S.ui.cnt.length !== cnt.length || cnt.some((n, i) => n < S.ui.cnt[i])) { S.ui.cnt = cnt.slice(); S.ui.lastCell = null; }
    else {
      cnt.forEach((n, i) => { if (n > S.ui.cnt[i] && g.last) S.ui.lastCell = { i, q: g.last.q, r: g.last.r }; });
      S.ui.cnt = cnt.slice();
    }
    const mi = myIndex();
    if (mi >= 0) {
      if (!S.ui.anchor) S.ui.anchor = boardCenter(g.players[mi].board);
      if (S.ui.lastCell && S.ui.lastCell.i === mi && S.ui.lastCellSeen !== `${S.ui.lastCell.q},${S.ui.lastCell.r}|${cnt[mi]}`) {
        S.ui.lastCellSeen = `${S.ui.lastCell.q},${S.ui.lastCell.r}|${cnt[mi]}`;
        S.ui.anchor = cellCenter(S.ui.lastCell.q, S.ui.lastCell.r);
      }
    }
    const ap = g.players[g.active];
    const sig = `${ap ? ap.id : ''}|${ap ? ap.turns : 0}|${g.phase}`;
    if (sig !== S.ui.sigKey) {
      const turnKey = `${ap ? ap.id : ''}|${ap ? ap.turns : 0}`;
      if (!S.ui.sigKey.startsWith(turnKey + '|')) { S.ui.rot = 0; }
      S.ui.sigKey = sig;
      S.ui.mode = 'normal'; S.ui.fTi = null; S.ui.fMi = null; S.ui.wsel = []; S.ui.note = '';
      if (isMine(g)) scrollTo = g.phase;
    }
  }
  const view = `${S.screen}|${g ? g.phase === 'over' : ''}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
  else if (scrollTo) {
    if (scrollTo === 'choose') window.scrollTo(0, 0);
    else {
      const a = document.querySelector('.wn-act');
      const c = document.querySelector('.coach');
      if (a) window.scrollTo(0, Math.max(0, a.getBoundingClientRect().top + window.scrollY - (c ? c.getBoundingClientRect().height + 14 : 6)));
    }
  }
}

// ====================== Brett ======================
const scaleOf = () => S.ui.zoom / HEX_W;

function boardHtml(g, idx, interactive) {
  const p = g.players[idx];
  const mine = interactive && isMine(g) && g.players[g.active].id === p.id;
  const o = { scale: scaleOf(), label: `Gebiet von ${p.name}` };
  if (S.ui.lastCell && S.ui.lastCell.i === idx) o.last = S.ui.lastCell;
  if (mine && g.phase === 'tile' && g.selected) {
    o.cands = E.legalTilePlacements(g);
    o.ghost = { id: g.market.tiles[g.selected.ti], rot: S.ui.rot };
  }
  if (mine && g.phase === 'token' && g.selected) {
    o.opts = E.tokenOptions(g);
    o.optAnimal = g.market.tokens[g.selected.mi];
  }
  const b = boardSvg(p.board, o);
  const id = interactive ? ' id="board"' : '';
  return `<div class="wn-scroll"${id} data-minx="${b.minX}" data-miny="${b.minY}" data-scale="${scaleOf()}" tabindex="-1">${b.html}</div>`;
}

let ignoreScrollUntil = 0;
function restoreScroll() {
  const el = document.getElementById('board');
  if (el && S.ui.anchor) {
    const z = Number(el.dataset.scale), minx = Number(el.dataset.minx), miny = Number(el.dataset.miny);
    const wantX = (S.ui.anchor.x - minx) * z - el.clientWidth / 2;
    const wantY = (S.ui.anchor.y - miny) * z - el.clientHeight / 2;
    ignoreScrollUntil = Date.now() + 120;
    el.scrollLeft = Math.max(0, wantX);
    el.scrollTop = Math.max(0, wantY);
  }
  $app.querySelectorAll('details[open] .wn-scroll').forEach((n) => {
    n.scrollLeft = Math.max(0, (n.scrollWidth - n.clientWidth) / 2);
    n.scrollTop = Math.max(0, (n.scrollHeight - n.clientHeight) / 2);
  });
}
new MutationObserver(() => restoreScroll()).observe($app, { childList: true });
$app.addEventListener('scroll', (ev) => {
  const el = ev.target;
  if (!el || el.id !== 'board' || Date.now() < ignoreScrollUntil) return;
  const z = Number(el.dataset.scale), minx = Number(el.dataset.minx), miny = Number(el.dataset.miny);
  const a = S.ui.anchor || { x: 0, y: 0 };
  if (el.scrollWidth > el.clientWidth + 1) a.x = minx + (el.scrollLeft + el.clientWidth / 2) / z;
  if (el.scrollHeight > el.clientHeight + 1) a.y = miny + (el.scrollTop + el.clientHeight / 2) / z;
  S.ui.anchor = a;
}, true);
// Aufgeklappte Mitspieler-Gebiete merken
$app.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (!d || !d.dataset || !d.dataset.pid) return;
  S.ui.open = { ...S.ui.open, [d.dataset.pid]: d.open };
  if (d.open) restoreScroll();
}, true);

// ====================== Darstellung ======================
function bannerHtml() {
  const g = S.game;
  if (g.phase === 'over') return `<div class="banner wn-banner done">Das Spiel ist zu Ende!</div>`;
  const ap = E.activePlayer(g);
  if (isMine(g)) {
    let t = 'Du bist dran: wähle ein Plättchen mit Tier';
    if (g.phase === 'choose' && S.ui.mode === 'free') t = 'Du bist dran: freie Wahl, erst Plättchen, dann Tier';
    else if (g.phase === 'choose' && S.ui.mode === 'wipe') t = 'Du bist dran: tippe die Tiere zum Tauschen';
    else if (g.phase === 'tile') t = 'Du bist dran: lege das Plättchen an';
    else if (g.phase === 'token') t = 'Du bist dran: setze das Tier oder wirf es weg';
    return `<div class="banner wn-banner mine">${t}</div>`;
  }
  const what = { choose: 'wählt ein Paar', tile: 'legt ein Plättchen', token: 'setzt ein Tier' }[g.phase] || 'überlegt';
  return `<div class="banner wn-banner">${esc(ap.name)} ${what} …</div>`;
}

const tileLabel = (id) => esc(tileTitle(id));

function marketHtml(g) {
  const mine = isMine(g);
  const ch = mine && g.phase === 'choose';
  const mode = S.ui.mode;
  const me = g.players[myIndex()] || { nature: 0 };
  const sel = g.selected;
  const cols = [0, 1, 2, 3].map((i) => {
    const t = g.market.tiles[i], k = g.market.tokens[i];
    const tSel = (sel && sel.ti === i) || (mode === 'free' && S.ui.fTi === i);
    const kSel = (sel && sel.mi === i) || (mode === 'free' && S.ui.fMi === i) || (mode === 'wipe' && S.ui.wsel.includes(i));
    const tOn = ch && t !== null && mode !== 'wipe';
    const kOn = ch && k;
    const tile = `<button class="wn-mt${tSel ? ' sel' : ''}" data-act="mt" data-i="${i}" ${tOn ? '' : 'disabled'} aria-label="Plättchen ${i + 1}: ${t !== null ? tileLabel(t) : 'leer'}">`
      + (t !== null ? tileSvg(t, 0, '', '') : `<span class="wn-empty">leer</span>`) + '</button>';
    const tok = `<button class="wn-mk${kSel ? ' sel' : ''}" data-act="mk" data-i="${i}" ${kOn ? '' : 'disabled'} aria-label="Tier ${i + 1}: ${k ? ANIMAL_LABEL[k] : 'leer'}">`
      + (k ? tokenSvg(k, '', '') : `<span class="wn-empty">leer</span>`) + '</button>';
    return `<div class="wn-col${tSel || kSel ? (mode === 'wipe' ? ' wsel' : ' pick') : ''}">${tile}${tok}</div>`;
  }).join('');
  const turn = Math.min(g.turnsPerPlayer, g.players[g.active].turns + 1);
  return `<section class="card wn-market" id="market"><div class="wn-mrow">${cols}</div>
    <div class="wn-nat"><span>🌲 × ${me.nature} Naturmarker</span><span>Zug ${turn} von ${g.turnsPerPlayer}</span></div></section>`;
}

const hasTriple = (g) => {
  const c = {};
  for (const t of g.market.tokens) if (t) c[t] = (c[t] || 0) + 1;
  return Object.values(c).includes(3);
};

function noteText(g) {
  if (S.ui.note) return S.ui.note;
  if (g.phase === 'choose' && (g.recap || []).some((l) => /Vier gleiche/.test(l))) return 'Vier gleiche Tiere lagen im Markt: Alle wurden ersetzt.';
  return '';
}

function actHtml(g) {
  const mine = isMine(g);
  const ap = E.activePlayer(g);
  const note = noteText(g);
  const noteHtml = note ? `<span class="wn-note" role="status">${esc(note)}</span>` : '';
  let main = '', extra = '';
  if (mine && g.phase === 'choose') {
    const me = g.players[myIndex()];
    const mode = S.ui.mode;
    if (mode === 'free') {
      main = S.ui.fTi === null ? 'Freie Wahl: Tippe oben im Markt auf ein Plättchen.' : 'Plättchen gewählt. Tippe jetzt oben auf ein Tier, das nicht unter diesem Plättchen liegt.';
      extra = `<div class="wn-btnrow"><button class="btn secondary wide" data-act="mode-cancel">Abbrechen</button></div>`;
    } else if (mode === 'wipe') {
      const n = S.ui.wsel.length;
      main = n ? `Du hast ${n} ${n === 1 ? 'Tier' : 'Tiere'} zum Tauschen gewählt. Tippe auf „Fertig“.` : 'Tippe oben auf die Tiere, die ersetzt werden sollen.';
      extra = `<div class="wn-btnrow"><button class="btn primary" data-act="wipe-done" ${n ? '' : 'disabled'}>Fertig</button><button class="btn secondary" data-act="mode-cancel">Abbrechen</button></div>`;
    } else {
      main = 'Tippe oben auf ein Paar aus Plättchen und Tier.';
      const tiles = g.market.tiles.map((t, i) => (t !== null ? i : -1)).filter((i) => i >= 0);
      const toks = g.market.tokens.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
      const canFree = me.nature >= 1 && tiles.some((ti) => toks.some((mi) => mi !== ti));
      const canWipe = me.nature >= 1 && !g.usedWipe && toks.length > 0;
      const canW3 = !g.usedWipe3 && hasTriple(g);
      extra = `<div class="wn-btnrow">${canFree ? `<button class="btn secondary" data-act="free-mode">Naturmarker einsetzen: freie Wahl</button>` : ''}${canWipe ? `<button class="btn secondary" data-act="wipe-mode">Tiere tauschen</button>` : ''}</div>`
        + (canW3 ? `<button class="btn secondary wide" data-act="wipe3">Drei gleiche Tiere austauschen</button>` : '')
        + (canFree || canWipe || canW3 ? '' : `<p class="wn-hint">Naturmarker bekommst du, wenn du ein Tier auf ein Schlüsselplättchen setzt (goldener Rand mit Tannenbaum).</p>`);
    }
  } else if (mine && g.phase === 'tile' && g.selected) {
    const tid = g.market.tiles[g.selected.ti];
    const an = g.market.tokens[g.selected.mi];
    main = 'Lege das Plättchen an: Tippe im Gebiet unten auf ein grünes Feld.';
    extra = `<div class="wn-prev">${tileSvg(tid, S.ui.rot, 'wn-prev-tile', 'Dein Plättchen, so wie es gelegt wird')}
      <div class="wn-prev-r"><button class="btn primary huge" data-act="rot">Drehen ⟳</button><p>Dein Tier danach: ${ANIMAL_EMOJI[an]} ${ANIMAL_LABEL[an]}</p></div></div>`;
  } else if (mine && g.phase === 'token' && g.selected) {
    const an = g.market.tokens[g.selected.mi];
    main = `Setze dein Tier (${ANIMAL_LABEL[an]}) auf ein grün markiertes Plättchen oder wirf es weg.`;
    extra = `<div class="wn-prev">${tokenSvg(an, 'wn-prev-tok', ANIMAL_LABEL[an])}
      <div class="wn-prev-r"><button class="btn secondary huge" data-act="discard">Tier wegwerfen</button><p>Auf jedem Plättchen steht nur ein Tier.</p></div></div>`;
  } else {
    main = `${esc(ap.name)} ${{ choose: 'wählt ein Paar', tile: 'legt ein Plättchen an', token: 'setzt ein Tier' }[g.phase] || 'überlegt'} …`;
  }
  return `<section class="card action wn-act"><p class="big${mine && (g.phase === 'tile' || g.phase === 'token') ? ' tight' : ''}">${main}${noteHtml}</p>${extra}</section>`;
}

const zoomRow = () => {
  const i = ZOOMS.indexOf(S.ui.zoom);
  return `<div class="wn-zoom"><button class="btn" data-act="zoom-out" ${i <= 0 ? 'disabled' : ''}>− Kleiner</button>
    <button class="btn" data-act="zoom-in" ${i >= ZOOMS.length - 1 ? 'disabled' : ''}>＋ Größer</button></div>`;
};

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Zuletzt</h3><ul>${g.recap.slice(-6).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function chipsFor(g, p) {
  return `<div class="chips"><span class="chip">🌲 × ${p.nature}</span><span class="chip">${g.phase === 'over' ? p.turns : Math.min(g.turnsPerPlayer, p.turns + (g.phase !== 'over' && g.players[g.active] === p ? 1 : 0))} von ${g.turnsPerPlayer} Zügen</span></div>`;
}

function othersHtml(g, openAll) {
  const me = myIndex();
  const items = g.players.map((p, i) => ({ p, i })).filter((x) => openAll || x.i !== me);
  if (!items.length) return '';
  return `<section class="card wn-others"><h2>${openAll ? 'So sahen die Gebiete am Ende aus' : 'Die Gebiete der Mitspieler'}</h2>${items.map(({ p, i }) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' (nicht verbunden)' : '';
    const open = S.ui.open[p.id] ?? (openAll && i === me);
    const mini = boardSvg(p.board, { mini: true, label: `Übersicht Gebiet von ${p.name}`, last: S.ui.lastCell && S.ui.lastCell.i === i ? S.ui.lastCell : null });
    const turn = g.phase !== 'over' && g.active === i;
    return `<details class="wn-oth${turn ? ' turn' : ''}" data-pid="${esc(p.id)}" ${open ? 'open' : ''}><summary>
      <div class="wn-mini-box">${mini.html}</div>
      <div class="wn-oth-t"><b>Gebiet von ${esc(p.name)}${i === me ? ' (du)' : ''}</b>${chipsFor(g, p)}<span class="offline">${off}${turn ? ' ist dran' : ''}</span><span class="more">Antippen: größer ansehen</span></div></summary>
      ${boardHtml(g, i, false)}</details>`;
  }).join('')}</section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'over') return overHtml();
  const mi = myIndex();
  return `${ui.header()}${ui.lost()}${bannerHtml()}${marketHtml(g)}${actHtml(g)}
    <section class="card wn-boardcard"><h2>Dein Gebiet</h2>${boardHtml(g, mi < 0 ? 0 : mi, true)}${zoomRow()}
      <div class="wn-legend"><span class="l-fit">Grün: hier kannst du anlegen oder setzen</span><span class="l-last">Blau: zuletzt gelegt</span></div></section>
    ${recapHtml(g)}${othersHtml(g, false)}`;
}

// ====================== Endabrechnung ======================
const tokensOf = (board, a) => Object.keys(board).filter((k) => board[k].tok === a);
const nbKeys = (k) => { const [q, r] = k.split(',').map(Number); return E.neighbors(q, r).map((n) => `${n.q},${n.r}`); };
function pairCount(board) {
  const set = new Set(tokensOf(board, 'baer'));
  const seen = new Set();
  let pairs = 0;
  for (const k of set) {
    if (seen.has(k)) continue;
    const comp = [], st = [k];
    seen.add(k);
    while (st.length) { const x = st.pop(); comp.push(x); for (const y of nbKeys(x)) if (set.has(y) && !seen.has(y)) { seen.add(y); st.push(y); } }
    if (comp.length === 2) pairs++;
  }
  return pairs;
}
function loners(board) {
  const set = new Set(tokensOf(board, 'falke'));
  return [...set].filter((k) => !nbKeys(k).some((y) => set.has(y))).length;
}
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pkt = (n) => pl(n, 'Punkt', 'Punkte');

function bonusInfo(g, i) {
  const st = g.players.map((p) => E.habitatStats(p.board).max);
  const parts = [];
  if (g.players.length < 2) return { parts, solo: true };
  for (const h of E.HABITATS) {
    const m = Math.max(...st.map((s) => s[h]));
    if (m <= 0 || st[i][h] !== m) continue;
    const top = st.filter((s) => s[h] === m).length;
    parts.push(`${HABITAT_LABEL[h]} +${top === 1 ? 3 : 1}`);
  }
  return { parts, solo: false };
}

function scoreRows(g, i) {
  const p = g.players[i];
  const sc = E.score(g, p.id);
  const b = p.board;
  const rows = [];
  rows.push({ sec: 'Tiere' });
  const pairs = pairCount(b);
  rows.push({ l: 'Bär', s: pairs ? `Bären: ${pl(pairs, 'Paar', 'Paare')} = ${pkt(sc.tiere.baer)}` : 'Bären: noch kein Paar aus genau zwei Bären', v: sc.tiere.baer });
  const nh = tokensOf(b, 'hirsch').length;
  rows.push({ l: 'Hirsch', s: nh ? `Hirsche: ${pl(nh, 'Hirsch', 'Hirsche')} in geraden Reihen = ${pkt(sc.tiere.hirsch)}` : 'Hirsche: keine gesetzt', v: sc.tiere.hirsch });
  const nl = tokensOf(b, 'lachs').length;
  rows.push({ l: 'Lachs', s: nl ? `Lachse: ${pl(nl, 'Lachs', 'Lachse')}, gezählt werden Läufe mit höchstens 2 Nachbarn = ${pkt(sc.tiere.lachs)}` : 'Lachse: keine gesetzt', v: sc.tiere.lachs });
  const nf = loners(b);
  rows.push({ l: 'Falke', s: `Falken ohne Falken-Nachbarn: ${nf} = ${pkt(sc.tiere.falke)}`, v: sc.tiere.falke });
  const nx = tokensOf(b, 'fuchs').length;
  rows.push({ l: 'Fuchs', s: nx ? `Füchse: ${pl(nx, 'Fuchs', 'Füchse')}, je Fuchs 1 Punkt pro andere Tierart daneben (höchstens 4) = ${pkt(sc.tiere.fuchs)}` : 'Füchse: keine gesetzt', v: sc.tiere.fuchs });
  rows.push({ sec: 'Lebensräume' });
  for (const h of E.HABITATS) rows.push({ l: HABITAT_LABEL[h], s: `${HABITAT_LABEL[h]}: größte Gruppe ${pl(sc.lebensraum[h], 'Plättchen', 'Plättchen')} = ${pkt(sc.lebensraum[h])}`, v: sc.lebensraum[h] });
  const bi = bonusInfo(g, i);
  rows.push({ sec: 'Sonstiges' });
  rows.push({ l: 'Bonus', s: bi.solo ? 'Den Bonus für die größte Gruppe gibt es nur bei mehreren Personen.' : (bi.parts.length ? `Größte Gruppe: ${bi.parts.join(', ')} (3 Punkte allein, 1 Punkt bei Gleichstand)` : 'Keine größte Gruppe erreicht'), v: sc.bonus });
  rows.push({ l: 'Natur', s: `Naturmarker: ${p.nature} = ${pkt(sc.natur)}`, v: sc.natur });
  rows.push({ l: 'Summe', s: '', v: sc.summe, sum: true });
  return rows;
}

function finalHtml(g, i) {
  const rows = scoreRows(g, i);
  return `<section class="card wn-final"><h3>${esc(g.players[i].name)}${g.players[i].id === cid ? ' (du)' : ''}</h3><table class="wn-tab"><tbody>${rows.map((r) => (r.sec
    ? `<tr class="sec"><th colspan="2">${r.sec}</th></tr>`
    : `<tr class="${r.sum ? 'sum' : ''}"><th scope="row">${r.l}${r.s ? `<small>${esc(r.s)}</small>` : ''}</th><td>${r.v}</td></tr>`)).join('')}</tbody></table></section>`;
}

let bestMemo = { key: '', best: 0, record: false };
function overHtml() {
  const g = S.game;
  const res = g.result || { winners: [], ranking: E.ranking(g) };
  const rank = res.ranking;
  const winners = rank.filter((r) => r.place === 1);
  const iWon = winners.some((w) => w.id === cid);
  let title, sentence;
  if (g.players.length === 1) {
    const sc = rank[0].score;
    const mk = `${sc}|${Object.keys(g.players[0].board).join(';')}`;
    if (bestMemo.key !== mk) {
      const prev = Number(sess.get('wn_best', 0)) || 0;
      bestMemo = { key: mk, best: prev, record: sc > prev };
      if (sc > prev) sess.set('wn_best', sc);
    }
    const { best, record } = bestMemo;
    title = record && best > 0 ? `Neue Bestleistung! Du hast ${sc} Punkte!` : `Geschafft! Du hast ${sc} Punkte!`;
    sentence = `Du hast ${sc} Punkte erreicht. ${record ? (best > 0 ? 'Das ist deine neue Bestleistung.' : 'Das ist dein erstes Ergebnis.') : `Deine Bestleistung sind ${best} Punkte.`}`;
  } else if (winners.length === 1) {
    title = iWon ? 'Du hast gewonnen! Glückwunsch!' : `${esc(winners[0].name)} hat gewonnen!`;
    sentence = `${winners[0].name} gewinnt mit ${winners[0].score} Punkten.`;
  } else {
    title = iWon ? `Gleichstand: Du und ${winners.filter((w) => w.id !== cid).map((w) => esc(w.name)).join(' und ')} habt gewonnen!` : `Gleichstand: ${winners.map((w) => esc(w.name)).join(' und ')} haben gewonnen!`;
    sentence = `Gleichstand mit ${winners[0].score} Punkten: ${winners.map((w) => w.name).join(' und ')}.`;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const list = rank.map((r) => `<li class="${r.place === 1 ? 'win' : ''}"><span class="medal">${r.place === 1 ? '🏆' : medals[r.place - 1] || ''}</span>
      <span class="rn">${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${r.score} ${r.score === 1 ? 'Punkt' : 'Punkte'}</span>
      <div class="rd"><span class="chip">${r.place}. Platz</span><span class="chip">🌲 × ${r.nature}</span></div></li>`).join('');
  const again = S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">▶ Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  const order = rank.map((r) => g.players.findIndex((p) => p.id === r.id));
  return `${ui.header()}${ui.lost()}
    <section class="card over action wn-over"><div class="trophy">🏆</div><h1>${title}</h1>
      <p class="big center">${esc(sentence)}</p>
      <ol class="ranking">${list}</ol>${again}
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>
    <section class="card"><h2>So wurde gezählt</h2><p class="muted">Unter jeder Zahl steht, wie sie entstanden ist.</p>${order.map((i) => finalHtml(g, i)).join('')}</section>
    ${recapHtml(g)}
    ${othersHtml(g, true)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Jede Person baut ihre eigene Landschaft aus sechseckigen Plättchen und siedelt Tiere darin an. Nach 20 Zügen gewinnt, wer die meisten Punkte hat. Du kannst allein, mit bis zu drei Mitspielern oder gegen den Computer spielen.</p>
    <h3>Die Plättchen</h3>
    <p>Jedes Plättchen hat sechs Kanten. Jede Kante gehört zu einem Lebensraum: <b>Berg</b> (grau-braun, Dreieck), <b>Wald</b> (dunkelgrün, Baum), <b>Wiese</b> (hellgrün, Halme), <b>Sumpf</b> (türkis, Schilf) oder <b>Fluss</b> (blau, Wellen). Viele Plättchen haben zwei Lebensräume. In der Mitte stehen ein bis drei Tiere: Hier darf genau dieses Tier wohnen. Es gibt Bär, Hirsch, Lachs, Falke und Fuchs. Du startest mit drei Plättchen.</p>
    <h3>Dein Zug</h3>
    <p>Im Markt liegen vier Paare: je ein Plättchen und darunter ein Tier.</p>
    <ul>
      <li><b>1. Paar wählen:</b> Tippe auf ein Paar. Du bekommst Plättchen und Tier.</li>
      <li><b>2. Plättchen anlegen:</b> Es muss an dein Gebiet angrenzen. Mit „Drehen“ stellst du es in eine der sechs Lagen. Jede Lage ist erlaubt. Tippe dann auf ein grünes Feld.</li>
      <li><b>3. Tier setzen oder wegwerfen:</b> Das Tier darf nur auf ein Plättchen mit seinem Symbol, auf das neue oder ein älteres. Auf jedem Plättchen steht höchstens ein Tier. Du kannst das Tier auch wegwerfen. Passt es nirgends, geschieht das von selbst.</li>
    </ul>
    <p>Danach wird der Markt aufgefüllt, und die nächste Person ist dran.</p>
    <h3>Naturmarker</h3>
    <p>Setzt du ein Tier auf ein <b>Schlüsselplättchen</b> (goldener Rand, Tannenbaum, nur ein Lebensraum), bekommst du einen Naturmarker. Du kannst ihn zu Beginn deines Zuges auf zwei Arten einsetzen:</p>
    <ul>
      <li><b>Freie Wahl:</b> Du nimmst ein beliebiges Plättchen und ein beliebiges Tier aus dem Markt, auch wenn sie nicht untereinander liegen.</li>
      <li><b>Tiere tauschen:</b> Du tauschst beliebig viele Tiere im Markt gegen neue aus. Das geht einmal pro Zug.</li>
    </ul>
    <p>Jeder Naturmarker, den du am Ende noch hast, zählt 1 Punkt.</p>
    <h3>Zu viele gleiche Tiere</h3>
    <p>Liegen im Markt genau <b>drei gleiche</b> Tiere, darfst du sie kostenlos austauschen (einmal pro Zug, freiwillig). Liegen <b>vier gleiche</b> Tiere da, werden alle vier sofort ersetzt.</p>
    <h3>Wertung am Ende</h3>
    <p>Gezählt wird erst nach dem letzten Zug. Jede Tierart zählt anders:</p>
    <ul>
      <li><b>Bär:</b> Zwei Bären, die nebeneinander stehen, sind ein Paar (drei oder mehr zusammen zählen nicht). 1, 2, 3, 4 oder mehr Paare: 4, 11, 19, 27 Punkte.</li>
      <li><b>Hirsch:</b> Hirsche in einer geraden Reihe nebeneinander. Eine Reihe aus 1, 2, 3 oder 4 und mehr Hirschen: 2, 5, 9, 13 Punkte. Jeder Hirsch gehört nur zu einer Reihe.</li>
      <li><b>Lachs:</b> Lachse, die sich berühren, bilden einen Lauf. Jeder Lachs darf dabei höchstens zwei Lachs-Nachbarn haben, sonst zählt der Lauf nicht. Länge 1 bis 7 und mehr: 2, 4, 7, 11, 15, 20, 26 Punkte.</li>
      <li><b>Falke:</b> Zählt nur ein Falke ohne Falken-Nachbarn. Bei 1 bis 8 und mehr Einzelgängern: 2, 5, 8, 11, 14, 18, 22, 26 Punkte.</li>
      <li><b>Fuchs:</b> Für jeden Fuchs gibt es 1 Punkt je andere Tierart auf den Nachbar-Plättchen. Das sind höchstens 4 Punkte je Fuchs.</li>
      <li><b>Lebensräume:</b> Für jeden Lebensraum zählt deine größte Gruppe zusammenhängender Plättchen: 1 Punkt je Plättchen. Zusammen gehören Plättchen, die sich an einer Kante mit demselben Lebensraum berühren. Ein Plättchen mit zwei Lebensräumen zählt in beiden. Bei mehreren Personen gibt es einen <b>Bonus</b>: 3 Punkte für die alleinig größte Gruppe eines Lebensraums, bei Gleichstand 1 Punkt für jeden.</li>
    </ul>
    <p>Bei Punktgleichheit gewinnt, wer mehr Naturmarker hat. Sonst gewinnen beide.</p>
    <h3>Das Gebiet</h3>
    <p>Mit <b>Größer</b> und <b>Kleiner</b> änderst du die Größe der Plättchen. Das Gebiet kannst du mit dem Finger verschieben. Das zuletzt gelegte Plättchen hat einen blauen Rand. Unter dem Spielfeld siehst du die Gebiete der anderen. Punktestände siehst du erst am Ende.</p>
    <p class="muted">Keine Sorge: Das Programm zeigt nur erlaubte Felder und rechnet alles selbst aus. Wie du spielst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const send = (m) => sess.send(m);
function guard(phase) {
  const g = S.game;
  return g && g.game === 'wm' && isMine(g) && g.phase === phase ? g : null;
}
function tapMarket(kind, i) {
  const g = guard('choose');
  if (!g) return undefined;
  const mode = S.ui.mode;
  if (mode === 'normal') return send({ t: 'pick', i });
  if (mode === 'free') {
    if (kind === 'mt') { S.ui.fTi = i; S.ui.note = ''; return render(); }
    if (S.ui.fTi === null) { S.ui.note = 'Tippe zuerst auf ein Plättchen.'; return render(); }
    if (S.ui.fTi === i) { S.ui.note = 'Das wäre ein ganz normales Paar. Wähle ein Tier von einer anderen Stelle.'; return render(); }
    const ti = S.ui.fTi;
    S.ui.mode = 'normal'; S.ui.fTi = null; S.ui.fMi = null; S.ui.note = '';
    return send({ t: 'free', ti, mi: i });
  }
  if (mode === 'wipe' && kind === 'mk') {
    S.ui.wsel = S.ui.wsel.includes(i) ? S.ui.wsel.filter((x) => x !== i) : [...S.ui.wsel, i];
    S.ui.note = '';
    return render();
  }
  return undefined;
}

const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  solo: true, soloText: 'Du baust deine Landschaft allein und versuchst, möglichst viele Punkte zu sammeln.',
  tutorial: { bots: 1, coach },
  title: 'Wildnis-Mosaik', icon: '🦌', sub: 'Plättchen legen, Tiere ansiedeln, Punkte sammeln – für 1 bis 4 Personen',
  helpTitle: 'Die Spielregeln von Wildnis-Mosaik', helpBody: helpBody(),
  minPlayers: 2,
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    switch (act) {
      case 'mt': case 'mk': return tapMarket(act, Number(el.dataset.i));
      case 'free-mode': { if (!guard('choose')) return undefined; S.ui.mode = 'free'; S.ui.fTi = null; S.ui.fMi = null; S.ui.note = ''; return render(); }
      case 'wipe-mode': { if (!guard('choose')) return undefined; S.ui.mode = 'wipe'; S.ui.wsel = []; S.ui.note = ''; return render(); }
      case 'mode-cancel': { S.ui.mode = 'normal'; S.ui.fTi = null; S.ui.fMi = null; S.ui.wsel = []; S.ui.note = ''; return render(); }
      case 'wipe-done': {
        if (!guard('choose') || S.ui.mode !== 'wipe' || !S.ui.wsel.length) return undefined;
        const idx = S.ui.wsel.slice().sort();
        S.ui.mode = 'normal'; S.ui.wsel = []; S.ui.note = '';
        return send({ t: 'wipe', idx });
      }
      case 'wipe3': { if (!guard('choose')) return undefined; S.ui.note = ''; return send({ t: 'wipe3' }); }
      case 'rot': { if (!guard('tile')) return undefined; S.ui.rot = (S.ui.rot + 1) % 6; return render(); }
      case 'cell': { if (!guard('tile')) return undefined; return send({ t: 'tile', q: Number(el.dataset.q) || 0, r: Number(el.dataset.r) || 0, rot: S.ui.rot }); }
      case 'tok': { if (!guard('token')) return undefined; return send({ t: 'token', q: Number(el.dataset.q) || 0, r: Number(el.dataset.r) || 0 }); }
      case 'discard': { if (!guard('token')) return undefined; return send({ t: 'token', discard: true }); }
      case 'zoom-in': case 'zoom-out': {
        const i = ZOOMS.indexOf(S.ui.zoom) + (act === 'zoom-in' ? 1 : -1);
        if (i < 0 || i >= ZOOMS.length) return undefined;
        S.ui.zoom = ZOOMS[i];
        sess.set('wn_zoom', S.ui.zoom);
        return render();
      }
    }
    return undefined;
  },
});
function render() { ui.render(); }
// Tastatur: Enter/Leertaste auf einem markierten Feld wirkt wie Antippen
$app.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if ((ev.key === 'Enter' || ev.key === ' ') && t.getAttribute && t.getAttribute('role') === 'button' && t.dataset && t.dataset.act && t.namespaceURI.includes('svg')) {
    ev.preventDefault();
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});
// Der Schließen-Knopf im Hilfefenster liegt im Fenster, dessen Klick nicht nach oben weitergereicht wird (ui.js).
$app.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('.modal [data-act="help-close"]');
  if (!b) return;
  ev.stopPropagation();
  S.ui.helpOpen = false;
  render();
}, true);
ui.boot();
