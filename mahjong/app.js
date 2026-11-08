import * as P from './engine.js';
import { LAYOUTS, LAYOUT_KEYS } from './layouts.js';
import { faceInner, faceTint, FACE_W, FACE_H } from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'small', label: 'Kleineres Spiel (Pyramide)', help: 'Nur 72 Steine. Das geht schneller.', def: false },
  { id: 'tiny', label: 'Kürzestes Spiel (Mauer)', help: 'Nur 48 Steine, gut für zwischendurch. Hat Vorrang vor dem kleineren Spiel.', def: false },
  { id: 'hints', label: 'Hinweise erlauben', help: 'Der Knopf „Hinweis“ zeigt dir ein Paar. Das wird am Ende genannt.', def: true },
  { id: 'free', label: 'Freie Steine hervorheben', help: 'Freie Steine bekommen einen grünen Rand.', def: false },
  { id: 'time', label: 'Zeit anzeigen', help: 'Die Uhr läuft mit. Du kannst sie auch ausblenden.', def: true },
];

const freshUi = () => ({
  sel: null, msg: null, confirm: null, setup: false, gid: null, seqSeen: -1,
  prev: null, ghosts: [], ghostAt: 0, hintSeen: null, hintUntil: 0, coachSeen: {}, blockedTried: false,
});

const sess = createSession({
  game: 'mj',
  maxPlayers: 1,
  options: OPTIONS,
  newGame: (players, opts) => {
    const learnStart = !!S.learn && !S.game; // erste Partie der Lernrunde
    if (S.learn && S.game) S.learn = false; // „Richtiges Spiel“ beendet die Lernrunde
    resetPlay();
    S.ui.setup = !learnStart;
    if (learnStart) S.ui.coachSeen = {};
    return P.createGame(players, learnStart ? { learn: true, free: true, hints: true } : opts, Math.random);
  },
  onMessage: (state, pid, msg) => {
    const r = P.handle(state, pid, msg, Math.random);
    if (!r.ok) { S.ui.msg = { tone: 'warn', text: r.error }; render(); return; }
    S.ui.msg = null;
    if (state.mode === 'over' && state.result && state.result.record === null) {
      if (state.layout === 'lern') { Object.assign(state.result, { record: false, recordClean: false, clean: false }); return; }
      const ka = 'mj_best_' + state.layout, kc = 'mj_best_clean_' + state.layout;
      const b = P.settleResult(state, sess.get(ka, 0), sess.get(kc, 0));
      if (b) {
        if (b.recordAll) sess.set(ka, b.best);
        if (b.recordClean) sess.set(kc, b.bestClean);
      }
    }
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { Object.assign(S.ui, freshUi()); },
});
const S = sess.S;
S.ui = freshUi();
if (!S.name) { S.name = 'Du'; sess.set('name', 'Du'); }

function resetPlay() {
  Object.assign(S.ui, { sel: null, msg: null, confirm: null, ghosts: [], hintUntil: 0, blockedTried: false, prev: null });
}

// ====================== Uhr (nur im App-Teil, nicht im Spielzustand) ======================
const clk = { key: '', base: 0, since: null };
const visible = () => document.visibilityState !== 'hidden';
const nowMs = () => clk.base + (clk.since != null ? Date.now() - clk.since : 0);
const playing = (g) => !!g && g.mode === 'play' && !S.ui.setup;
function clockSync(g) {
  if (!playing(g)) { clk.since = null; clk.key = ''; return; }
  const key = `${g.gid}:${g.seq}`;
  if (clk.key !== key) { clk.key = key; clk.base = g.elapsed || 0; clk.since = visible() ? Date.now() : null; }
}
function clockPause() {
  const g = S.game;
  if (!playing(g) || S.role !== 'host') return;
  clk.base = nowMs(); clk.since = null;
  sess.send({ t: 'sync', ms: clk.base });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clockPause();
  else if (playing(S.game)) clk.since = Date.now();
});
window.addEventListener('pagehide', clockPause);
const showTime = () => sess.getOpts().time !== false;
setInterval(() => {
  const el = document.getElementById('mj-clock');
  if (el) el.textContent = showTime() ? P.fmtTime(nowMs()) : '––:––';
}, 500);
const go = (msg) => sess.send({ ...msg, ms: nowMs() });

const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function onStateChanged() {
  const g = S.game;
  if (g && Array.isArray(g.kinds)) {
    if (S.ui.gid !== g.gid) { S.ui.gid = g.gid; S.ui.prev = null; S.ui.sel = null; S.ui.msg = null; S.ui.ghosts = []; S.ui.hintSeen = g.hintN; S.ui.hintUntil = 0; S.ui.seqSeen = g.seq; }
    if (g.seq !== S.ui.seqSeen) { S.ui.seqSeen = g.seq; S.ui.sel = null; S.ui.msg = null; }
    // Verschwinde-Animation: genau zwei Steine sind seit dem letzten Stand weggegangen
    const prev = S.ui.prev;
    if (prev && prev.length === g.kinds.length && !reduced()) {
      const gone = [];
      for (let i = 0; i < prev.length; i++) if (prev[i] >= 0 && g.kinds[i] < 0) gone.push(i);
      if (gone.length === 2) { S.ui.ghosts = gone.map((i) => [i, prev[i]]); S.ui.ghostAt = Date.now(); }
      else if (gone.length > 2 || prev.some((v, i) => v < 0 && g.kinds[i] >= 0)) S.ui.ghosts = [];
    }
    S.ui.prev = g.kinds.slice();
    // Hinweis kurz zeigen
    if (S.ui.hintSeen === null || g.hintN < S.ui.hintSeen) S.ui.hintSeen = g.hintN;
    if (g.hintN > S.ui.hintSeen) {
      S.ui.hintSeen = g.hintN; S.ui.hintUntil = Date.now() + 4000;
      setTimeout(() => { if (S.ui.hintUntil && Date.now() >= S.ui.hintUntil) { S.ui.hintUntil = 0; render(); } }, 4100);
    }
  }
  clockSync(g);
  render();
}

// ====================== Zoom und Scrollmitte ======================
const ZMIN = 24, ZMAX = 52, ZSTEP = 4;
const clampZ = (z) => Math.max(ZMIN, Math.min(ZMAX, Math.round(z)));
const dOf = (w) => Math.max(2, Math.round(w * 0.07));
const PAD = 3;
function dims(layout, w) {
  const b = P.layoutBounds(layout);
  const h = w * FACE_H / FACE_W;
  const d = dOf(w);
  return { w, h, d, b, W: Math.ceil(b.cols * w / 2 + (b.levels + 1) * d + 2 * PAD), H: Math.ceil(b.rows * h / 2 + (b.levels + 1) * d + 2 * PAD) };
}
function fitZoom(layout) {
  const b = P.layoutBounds(layout);
  const avail = Math.min(window.innerWidth, 760) - 12 - 2 * PAD - 4;
  const z = (avail - (b.levels + 1) * 3) / (b.cols / 2);
  return clampZ(Math.floor(z));
}
const zoomMap = () => { const z = sess.get('mj_zoom', {}); return z && typeof z === 'object' && !Array.isArray(z) ? z : {}; };
const zoomFor = (layout) => { const z = zoomMap()[layout]; return Number.isFinite(z) ? clampZ(z) : fitZoom(layout); };
const setZoom = (layout, z) => { const m = zoomMap(); m[layout] = clampZ(z); sess.set('mj_zoom', m); };
const scrollMap = () => { const z = sess.get('mj_scroll', {}); return z && typeof z === 'object' && !Array.isArray(z) ? z : {}; };
const live = { fx: null, fy: null, layout: '' };
function centerOf(layout) {
  if (live.layout !== layout || live.fx === null) {
    const s = scrollMap()[layout];
    live.layout = layout;
    live.fx = s && Number.isFinite(s.fx) ? s.fx : 0.5;
    live.fy = s && Number.isFinite(s.fy) ? s.fy : 0.5;
  }
  return live;
}
function restoreScroll() {
  const el = document.getElementById('board');
  const g = S.game;
  if (!el || !g || !g.layout) return;
  const c = centerOf(g.layout);
  el.scrollLeft = Math.max(0, c.fx * el.scrollWidth - el.clientWidth / 2);
  el.scrollTop = Math.max(0, c.fy * el.scrollHeight - el.clientHeight / 2);
}
let saveT = null;
$app.addEventListener('scroll', (ev) => {
  const el = ev.target;
  if (!el || el.id !== 'board' || !S.game) return;
  const c = centerOf(S.game.layout);
  if (el.scrollWidth > 0) c.fx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
  if (el.scrollHeight > 0) c.fy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
  clearTimeout(saveT);
  const lay = S.game.layout, fx = c.fx, fy = c.fy;
  saveT = setTimeout(() => { const m = scrollMap(); m[lay] = { fx: Math.round(fx * 1000) / 1000, fy: Math.round(fy * 1000) / 1000 }; sess.set('mj_scroll', m); }, 300);
}, true);
// Nach jedem Neuzeichnen gleich wieder an die gemerkte Stelle scrollen
new MutationObserver(() => restoreScroll()).observe($app, { childList: true });

// ====================== Darstellung ======================
function tileSvg(g, i, k, o) {
  const [z, x, y] = o.geo.pos[i];
  const { w, h, d, b } = o.dm;
  const px = PAD + x * w / 2 + (b.levels - z) * d, py = PAD + y * h / 2 + (b.levels - z) * d;
  const s = w / FACE_W;
  const isSel = o.sel === i;
  const isHint = !!o.hint && (o.hint[0] === i || o.hint[1] === i);
  const free = o.showFree && !o.gone && P.isFreeIn(o.geo, g.kinds, i);
  const cls = ['mj-tile'];
  if (isSel) cls.push('sel');
  if (isHint) cls.push('hint');
  if (free) cls.push('free');
  if (o.gone) cls.push('mj-gone');
  let fill = faceTint(k), stroke = '#2b2b30', sw = 1.2;
  if (free) { stroke = '#1f8f3a'; sw = Math.max(2.2, w * 0.09); }
  if (isHint) { fill = '#b9f2c4'; stroke = '#0d5a1e'; sw = Math.max(3, w * 0.12); }
  if (isSel) { fill = '#ffe27a'; stroke = '#d46a00'; sw = Math.max(3.4, w * 0.14); }
  const attrs = o.gone
    ? `class="${cls.join(' ')}" style="animation-delay:-${o.goneAge}ms" aria-hidden="true"`
    : `class="${cls.join(' ')}" data-act="tile" data-i="${i}" role="button" tabindex="0" aria-label="${esc(P.kindName(k))}" aria-pressed="${isSel}"`;
  return `<g ${attrs}><rect class="mj-side" x="${px + d}" y="${py + d}" width="${w}" height="${h}" rx="${(w * 0.12).toFixed(1)}"/>`
    + `<rect class="mj-face" x="${px + sw / 2 - 0.6}" y="${py + sw / 2 - 0.6}" width="${w - sw + 1.2}" height="${h - sw + 1.2}" rx="${(w * 0.1).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>`
    + `<g transform="translate(${px.toFixed(2)} ${py.toFixed(2)}) scale(${s.toFixed(4)})" pointer-events="none">${faceInner(k)}</g></g>`;
}

function boardHtml(g) {
  const geo = P.geometry(g.layout);
  const dm = dims(g.layout, zoomFor(g.layout));
  const hint = S.ui.hintUntil > Date.now() && Array.isArray(g.hint) ? g.hint : null;
  const sel = S.ui.sel !== null && g.kinds[S.ui.sel] >= 0 ? S.ui.sel : null;
  const o = { geo, dm, sel, hint, showFree: !!g.opts.free };
  const list = [];
  for (let i = 0; i < geo.n; i++) if (g.kinds[i] >= 0) list.push([i, g.kinds[i], false]);
  const age = Date.now() - S.ui.ghostAt;
  if (S.ui.ghosts.length && age < 460) for (const [i, k] of S.ui.ghosts) list.push([i, k, true]);
  list.sort((p, q) => (geo.pos[p[0]][0] - geo.pos[q[0]][0]) || (geo.pos[p[0]][2] - geo.pos[q[0]][2]) || (geo.pos[p[0]][1] - geo.pos[q[0]][1]));
  const tiles = list.map(([i, k, gone]) => tileSvg(g, i, k, gone ? { ...o, gone: true, goneAge: Math.max(0, age), sel: null, hint: null } : o)).join('');
  return `<div id="board" class="mj-scroll" aria-label="Spielbrett" data-layout="${g.layout}" data-zoom="${dm.w}"><div class="mj-inner"><svg class="mj-svg" width="${dm.W}" height="${dm.H}" viewBox="0 0 ${dm.W} ${dm.H}" role="group" aria-label="Steine, ${P.stonesLeft(g)} übrig">${tiles}</svg></div></div>`;
}

const layoutLine = (key) => `${P.layoutName(key)} (${LAYOUTS[key].tiles.length} Steine)`;

function statusHtml(g) {
  const left = P.stonesLeft(g);
  const t = showTime() ? P.fmtTime(nowMs()) : '––:––';
  return `<div class="mj-status"><span class="mj-lay">${esc(P.layoutName(g.layout))}</span>
    <span class="mj-clock" aria-label="Zeit">⏱ <span id="mj-clock">${t}</span></span>
    <span class="mj-left">Steine übrig: <b id="mj-left">${left}</b></span></div>`;
}

function hintText(g) {
  if (S.ui.msg) return { tone: S.ui.msg.tone || '', text: S.ui.msg.text };
  if (S.ui.hintUntil > Date.now() && g.hint) return { tone: 'ok', text: 'Hinweis: Diese beiden Steine leuchten grün. Sie passen zusammen und sind frei.' };
  if (P.isStuck(g)) return { tone: 'warn', text: 'Keine Paare mehr möglich. Tippe auf „Neu mischen“ oder auf „Zurück“.' };
  if (S.ui.sel !== null && g.kinds[S.ui.sel] >= 0) return { tone: '', text: `Markiert: ${P.kindName(g.kinds[S.ui.sel])}. Tippe jetzt einen gleichen freien Stein an.` };
  return { tone: '', text: 'Tippe einen freien Stein an, dann den passenden zweiten.' };
}

function buttonsHtml(g) {
  const stuck = P.isStuck(g);
  const z = zoomFor(g.layout);
  return `<div class="mj-btns">
      <button class="btn mj-btn" data-act="undo" ${g.hist.length ? '' : 'disabled'}>↶ Zurück</button>
      ${g.opts.hints ? `<button class="btn mj-btn" data-act="hint" ${stuck ? 'disabled' : ''}>💡 Hinweis</button>` : ''}
      <button class="btn mj-btn${stuck ? ' alert' : ''}" data-act="shuffle">🔀 Neu mischen</button>
      ${S.learn ? '' : `<button class="btn mj-btn" data-act="new-ask">Neues Spiel</button>`}
      <button class="btn mj-btn" data-act="zoom-out" ${z <= ZMIN ? 'disabled' : ''}>➖ Kleiner</button>
      <button class="btn mj-btn" data-act="zoom-in" ${z >= ZMAX ? 'disabled' : ''}>➕ Größer</button>
    </div>
    <button class="btn ghost mj-time" data-act="time-toggle" aria-pressed="${showTime()}">Zeit: ${showTime() ? 'sichtbar' : 'versteckt'}</button>`;
}

function confirmHtml(g) {
  const c = S.ui.confirm;
  if (!c) return '';
  const text = c === 'mix'
    ? 'Die übrigen Steine neu mischen? Du kannst im Moment noch Paare abräumen. Mischen zählt als Hilfe und wird am Ende genannt.'
    : 'Wirklich ein neues Spiel beginnen? Das jetzige Spiel geht verloren.';
  const yes = c === 'mix' ? 'Ja, neu mischen' : 'Ja, neues Spiel';
  return `<div class="overlay" data-act="noop"><div class="modal mj-modal" role="alertdialog" aria-modal="true" aria-label="Rückfrage">
    <p class="big"><b>${esc(text)}</b></p>
    <button class="btn primary huge" data-act="confirm-yes">${yes}</button>
    <button class="btn secondary" data-act="confirm-no">Nein, weiterspielen</button></div></div>`;
}

function playHtml(g) {
  const h = hintText(g);
  return `${ui.header()}${ui.lost()}
    ${statusHtml(g)}
    ${boardHtml(g)}
    <div class="action"><p class="big mj-msg ${h.tone}" role="status">${esc(h.text)}</p></div>
    ${buttonsHtml(g)}${confirmHtml(g)}`;
}

function bestOf(layout) {
  return { all: sess.get('mj_best_' + layout, 0), clean: sess.get('mj_best_clean_' + layout, 0) };
}

function setupHtml(g) {
  const cur = sess.getOpts();
  const key = P.layoutOf(cur);
  const started = g.seq > 0 && g.mode === 'play';
  const opts = OPTIONS.map((d) => `<label class="opt"><input type="checkbox" data-opt="${esc(d.id)}" ${cur[d.id] ? 'checked' : ''}><span>${esc(d.label)}<small>${esc(d.help)}</small></span></label>`).join('');
  const bests = LAYOUT_KEYS.map((k) => {
    const b = bestOf(k);
    return `<li><b>${esc(P.layoutName(k))}:</b> ${b.all ? `Bestzeit ${P.fmtTime(b.all)}` : 'noch keine Bestzeit'}${b.clean ? `, ohne Hilfe ${P.fmtTime(b.clean)}` : ''}</li>`;
  }).join('');
  return `${ui.header()}${ui.lost()}
    <section class="card mj-setup"><h2>Wie möchtest du spielen?</h2>
      <div class="action"><p class="big mj-pick" role="status">Du spielst: <b>${esc(layoutLine(key))}</b></p></div>
      ${opts}
      <button class="btn primary huge" data-act="go">▶ Los geht’s</button>
      ${started ? `<button class="btn ghost" data-act="setup-cancel">Zurück zum Spiel</button>` : ''}
    </section>
    <section class="card"><h2>Deine Bestzeiten</h2><ul class="mj-bests">${bests}</ul></section>`;
}

function overHtml(g) {
  const r = g.result || { ms: g.elapsed, layout: g.layout, hints: g.hints, mixes: g.mixes, record: false, recordClean: false, clean: false, prev: 0, prevClean: 0 };
  const lern = r.layout === 'lern';
  const lines = [];
  lines.push(`<p class="big center">Deine Zeit: <b>${P.fmtTime(r.ms)}</b>${lern ? '' : ` (${esc(P.layoutName(r.layout))})`}</p>`);
  if (!lern) {
    if (r.recordClean) lines.push(`<p class="big center">🏅 Neue Bestzeit ohne Hilfe! 🎉</p>`);
    else if (r.record) lines.push(`<p class="big center">🏅 Neue Bestzeit! 🎉</p>`);
    const b = bestOf(r.layout);
    if (!r.record && !r.recordClean) lines.push(`<p class="center">Deine Bestzeit: <b>${b.all ? P.fmtTime(b.all) : '–'}</b></p>`);
    if (b.clean && !r.recordClean) lines.push(`<p class="center">Beste Zeit ohne Hilfe: <b>${P.fmtTime(b.clean)}</b></p>`);
  }
  if (r.hints === 0 && r.mixes === 0) lines.push(`<p class="center">Ganz ohne Hilfe geschafft!</p>`);
  else {
    const parts = [];
    if (r.hints > 0) parts.push(r.hints === 1 ? '1 Hinweis' : `${r.hints} Hinweise`);
    if (r.mixes > 0) parts.push(r.mixes === 1 ? 'einmal neu gemischt' : `${r.mixes} mal neu gemischt`);
    lines.push(`<p class="center">Deine Hilfen: ${parts.join(' und ')}.</p>`);
  }
  return `${ui.header()}${ui.lost()}
    <div class="banner done">Alle Steine sind weg!</div>
    <section class="card over action"><div class="trophy">🏆</div><h1>Geschafft!</h1>${lines.join('')}
      <button class="btn primary huge" data-act="again">${lern ? '▶ Ein richtiges Spiel spielen' : '▶ Noch ein Spiel'}</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml(g);
  if (S.ui.setup) return setupHtml(g);
  return playHtml(g);
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Räume alle Steine vom Brett. Immer zwei gleiche Steine dürfen zusammen weg.</p>
    <h3>So geht es</h3>
    <ol>
      <li>Tippe einen Stein an. Er wird gelb markiert.</li>
      <li>Tippe dann einen zweiten Stein mit demselben Bild an. Beide verschwinden.</li>
      <li>Tippst du einen anderen Stein an, wechselt die Markierung. Tippst du den markierten Stein nochmal an, ist er nicht mehr markiert.</li>
    </ol>
    <h3>Welche Steine darf ich nehmen?</h3>
    <p>Nur <b>freie</b> Steine. Ein Stein ist frei, wenn <b>nichts auf ihm liegt</b> und er <b>links oder rechts Platz</b> hat. Ist er links und rechts von anderen Steinen eingeklemmt oder liegt ein Stein auf ihm, musst du erst die anderen wegnehmen.</p>
    <h3>Welche Steine sind gleich?</h3>
    <ul>
      <li><b>Kreise</b> (blau), <b>Stäbe</b> (grün) und <b>Zeichen</b> (rot, mit Stern): Zahl und Farbe müssen gleich sein.</li>
      <li><b>Winde</b>: Buchstabe in schwarzem Kreis (O, S, W, N). Gleicher Buchstabe passt.</li>
      <li><b>Drachen</b>: rotes, grünes und weißes Schild.</li>
      <li><b>Blumen</b> sind alle untereinander gleich. Die <b>Jahreszeiten</b> (Blatt) auch.</li>
    </ul>
    <h3>Hilfen</h3>
    <ul>
      <li><b>Zurück:</b> nimmt den letzten Schritt zurück, so oft du willst.</li>
      <li><b>Hinweis:</b> zeigt dir kurz ein Paar, das du nehmen kannst. Das wird am Ende genannt.</li>
      <li><b>Neu mischen:</b> verteilt die übrigen Steine neu. Das Spiel bleibt dabei lösbar. Das zählt auch als Hilfe.</li>
      <li><b>Größer / Kleiner:</b> vergrößert oder verkleinert das Brett. Ist es größer als der Bildschirm, wischst du mit dem Finger darüber.</li>
    </ul>
    <h3>Das Ende</h3>
    <p>Sind alle Steine weg, hast du gewonnen. Du siehst deine Zeit und deine Bestzeit. Gibt es kein Paar mehr, sagt das Spiel es dir und bietet „Neu mischen“ an. Mit „Neues Spiel“ kannst du die Brettform wählen: Schildkröte (144 Steine), Pyramide (72) oder Mauer (48).</p>
    <p class="muted">Jedes Spiel ist lösbar, wenn du die richtigen Paare nimmst. Es muss nicht beim ersten Mal klappen.</p>
`;
}

// ====================== Bedienung ======================
function onTile(i) {
  const g = S.game;
  if (!g || g.mode !== 'play' || S.ui.setup || !Number.isInteger(i) || !g.kinds || !(g.kinds[i] >= 0)) return;
  S.ui.confirm = null;
  S.ui.hintUntil = 0;
  if (!P.isFree(g, i)) {
    S.ui.blockedTried = true;
    S.ui.msg = { tone: 'warn', text: 'Der Stein ist noch eingeklemmt. Es liegt etwas auf ihm, oder er hat links und rechts keinen Platz.' };
    return render();
  }
  const sel = S.ui.sel;
  if (sel === null || !(g.kinds[sel] >= 0) || !P.isFree(g, sel)) { S.ui.sel = i; S.ui.msg = null; return render(); }
  if (sel === i) { S.ui.sel = null; S.ui.msg = null; return render(); }
  if (P.sameKind(g.kinds[sel], g.kinds[i])) { S.ui.sel = null; S.ui.msg = null; return go({ t: 'pair', a: sel, b: i }); }
  S.ui.sel = i;
  S.ui.msg = { tone: 'warn', text: 'Das sind keine gleichen Steine. Ich habe den neuen Stein markiert.' };
  return render();
}

function changeZoom(delta) {
  const g = S.game;
  if (!g) return;
  setZoom(g.layout, zoomFor(g.layout) + delta);
  render();
}

const ui = createUI({
  soloOnly: true,
  sess, $app,
  options: OPTIONS,
  title: 'Mahjong-Solitär', icon: '🀄', sub: 'Gleiche Steine paarweise abräumen',
  helpTitle: 'So geht Mahjong-Solitär', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'tile': return onTile(Number(el.dataset.i));
      case 'noop': return;
      case 'undo': S.ui.confirm = null; return go({ t: 'undo' });
      case 'hint': S.ui.confirm = null; return go({ t: 'hint' });
      case 'shuffle':
        if (g.mode !== 'play') return;
        if (!P.isStuck(g)) { S.ui.confirm = 'mix'; return render(); }
        return go({ t: 'shuffle' });
      case 'new-ask':
        if (g.hist.length && g.mode === 'play') { S.ui.confirm = 'new'; return render(); }
        S.ui.setup = true; clockSync(g); return render();
      case 'confirm-yes': {
        const c = S.ui.confirm;
        S.ui.confirm = null;
        if (c === 'mix') return go({ t: 'shuffle' });
        if (c === 'new') { S.ui.setup = true; clockSync(g); return render(); }
        return render();
      }
      case 'confirm-no': S.ui.confirm = null; return render();
      case 'go': {
        S.ui.setup = false;
        const o = sess.getOpts();
        return sess.send({ t: 'new', opts: { small: o.small, tiny: o.tiny, hints: o.hints, free: o.free } });
      }
      case 'setup-cancel': S.ui.setup = false; clockSync(g); return render();
      case 'zoom-in': return changeZoom(ZSTEP);
      case 'zoom-out': return changeZoom(-ZSTEP);
      case 'time-toggle': sess.setOpt('time', !showTime()); return render();
    }
  },
});
function render() { ui.render(); }
ui.boot();
// Beim Umschalten eines Kästchens die Auswahl-Zeile („Du spielst: …“) aktualisieren
$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t && t.dataset && t.dataset.opt && S.ui.setup) render();
});
// Tastatur: Eingabe oder Leertaste auf einem Stein
$app.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if ((ev.key === 'Enter' || ev.key === ' ') && t && t.classList && t.classList.contains('mj-tile')) { ev.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
