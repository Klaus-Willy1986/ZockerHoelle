import * as P from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');
const OPTIONS = [{
    id: 'points',
    label: 'Mehrere Runden mit Punkten spielen (bis 500)',
    help: 'Wer eine Runde gewinnt, bekommt 25 Punkte plus 5 Punkte für jede Karte, die die anderen noch im Spielerstapel haben. Wer zuerst 500 Punkte hat, gewinnt.',
    def: false,
  }];
const freshUi = () => ({ sel: null, sig: '' });

const sess = createSession({
  game: 'sr',
  maxPlayers: 6,
  // Die Lernrunde ist kürzer (kleiner Spielerstapel), ohne Punktewertung
  newGame: (players, opts) => {
    S.ui = { ...S.ui, ...freshUi() };
    const learn = !!S.learn;
    return P.createGame(players, learn ? { points: false, pile: 10 } : opts, Math.random);
  },
  onMessage: (state, pid, msg) => { P.handle(state, pid, msg, Math.random); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; },
  options: OPTIONS,
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.mode !== 'play') return null;
      const ap = P.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

const myIndex = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.gid}|${g.round}|${g.seq}|${g.active}|${g.mode}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.sel = null; }
  }
  render();
}

// ====================== Darstellung ======================
const band = (v) => (v <= 3 ? 'a' : v <= 6 ? 'b' : v <= 9 ? 'c' : 'd');
const attrs = (o) => Object.entries(o || {}).map(([k, v]) => ` data-${k}="${v}"`).join('');

// Eine Karte. o: { act, data, cls, value (Wert eines Jokers im Aufbaustapel), label, count, badge }
function cardHtml(c, o = {}) {
  const joker = c === P.JOKER;
  const shown = joker && o.value ? o.value : c;
  const cls = ['sr-c', joker ? 'jk' : band(c), o.cls || ''];
  if (o.count >= 3) cls.push('d3'); else if (o.count === 2) cls.push('d2');
  const inner = joker
    ? (o.value ? `<span>${shown}</span><small>Joker</small>` : `<span class="st">★</span><small>Joker</small>`)
    : `<span>${c}</span>`;
  const label = o.label || (joker ? 'Joker' : `Karte ${c}`);
  const extra = (o.count > 1 ? `<span class="sr-cnt" aria-hidden="true">${o.count}</span>` : '') + (o.badge ? '<span class="sr-badge" aria-hidden="true">✔</span>' : '');
  if (o.act) return `<button class="${cls.filter(Boolean).join(' ')}" data-act="${o.act}"${attrs(o.data)} aria-label="${esc(label)}">${inner}${extra}</button>`;
  return `<div class="${cls.filter(Boolean).join(' ')}" role="img" aria-label="${esc(label)}">${inner}${extra}</div>`;
}
function emptyHtml(o = {}) {
  const text = o.text || '';
  const cls = `sr-c empty ${o.cls || ''}`;
  if (o.act) return `<button class="${cls}" data-act="${o.act}"${attrs(o.data)} aria-label="${esc(o.label || 'leer')}">${text}</button>`;
  return `<div class="${cls}" role="img" aria-label="${esc(o.label || 'leer')}">${text}</div>`;
}

function miniHtml(card, count, isPile) {
  if (card === null || card === undefined) return `<div class="sr-m empty${isPile ? ' pile' : ''}" role="img" aria-label="leer"></div>`;
  const joker = card === P.JOKER;
  return `<div class="sr-m ${joker ? 'jk' : band(card)}${isPile ? ' pile' : ''}" role="img" aria-label="${joker ? 'Joker' : 'Karte ' + card}${count > 1 ? ', ' + count + ' Karten' : ''}">${joker ? '★' : card}${count > 1 ? `<i>${count}</i>` : ''}</div>`;
}

// Gewählte Karte (nur wenn sie noch da ist)
function selection() {
  const g = S.game, mi = myIndex();
  const sel = S.ui.sel;
  if (!g || mi < 0 || !sel || g.mode !== 'play' || g.active !== mi) return null;
  const p = g.players[mi];
  if (sel.from === 'hand' && sel.i >= 0 && sel.i < p.hand.length) return { ...sel, card: p.hand[sel.i] };
  if (sel.from === 'pile' && p.pile.length) return { from: 'pile', i: 0, card: P.topOf(p.pile) };
  if (sel.from === 'aux' && p.aux[sel.i] && p.aux[sel.i].length) return { from: 'aux', i: sel.i, card: P.topOf(p.aux[sel.i]) };
  return null;
}

function bannerHtml() {
  const g = S.game;
  if (g.mode === 'over') return `<div class="banner done">Das Spiel ist zu Ende!</div>`;
  if (g.mode === 'roundover') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  const ap = P.activePlayer(g);
  return ap.id === cid ? `<div class="banner mine">Du bist dran!</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

function boardHtml(sel) {
  const g = S.game;
  const targets = sel ? P.targetsFor(g, sel.card) : [];
  const piles = g.build.map((b, i) => {
    const len = b.length;
    const need = len === 0
      ? `leer<br>braucht <b>1</b>`
      : `bis jetzt <b>${len}</b><br>braucht <b>${len + 1}</b>`;
    const isTarget = targets.includes(i);
    const fresh = g.last && g.last.kind === 'play' && g.last.b === i && !g.last.removed && g.mode === 'play';
    const label = `Aufbaustapel ${i + 1}: ${len === 0 ? 'leer, braucht 1' : `bis jetzt ${len}, braucht ${len + 1}`}${isTarget ? ', hier legen' : ''}`;
    const act = isTarget ? { act: 'to-build', data: { b: i } } : {};
    const cls = `${isTarget ? 'sr-target ' : ''}${fresh ? 'fresh' : ''}`;
    const face = len === 0
      ? emptyHtml({ ...act, cls, text: isTarget ? 'hier' : '', label })
      : cardHtml(P.topOf(b), { ...act, cls, value: len, label, count: 0 });
    return `<div class="sr-bp"><div class="sr-need">${need}</div>${face}</div>`;
  }).join('');
  return `<section class="card sr-board" id="board" aria-label="Tischmitte">
    <div class="sr-builds">${piles}</div>
    <div class="sr-deck">Kartenstock: ${g.draw.length} ${g.draw.length === 1 ? 'Karte' : 'Karten'}</div></section>`;
}

function hintHtml(sel) {
  const g = S.game;
  const ap = P.activePlayer(g);
  if (g.mode !== 'play') return '';
  const body = (a, b) => `<section class="card action sr-hint"><p class="big">${a}</p>${b ? `<p class="sr-sub">${b}</p>` : ''}</section>`;
  if (ap.id !== cid) {
    const line = g.recap[0] ? esc(g.recap[0]) : 'Bitte einen Moment Geduld.';
    return body(`${esc(ap.name)} spielt gerade.`, line);
  }
  const last = g.last;
  if (sel) {
    const name = sel.card === P.JOKER ? 'den Joker' : `die ${sel.card}`;
    const targets = P.targetsFor(g, sel.card);
    if (sel.from === 'hand') {
      return body(`Du hast ${name} gewählt.`,
        (targets.length ? 'Leuchtender Aufbaustapel: Karte legen. ' : 'Diese Karte passt auf keinen Aufbaustapel. ')
        + 'Leuchtender Hilfsstapel: Karte abwerfen, dann ist dein Zug zu Ende. Nochmal antippen: abwählen.');
    }
    return body(`Du hast ${name} gewählt.`, 'Tippe auf einen leuchtenden Aufbaustapel, um sie zu legen. Nochmal antippen: abwählen.');
  }
  let sub = 'Leuchtende Karten mit Haken kannst du legen: erst die Karte antippen, dann den Stapel. Zum Abwerfen tippst du eine Handkarte an und dann einen Hilfsstapel.';
  if (last && last.kind === 'play' && last.pid === cid && last.card === P.JOKER) sub = `Dein Joker zählt auf Aufbaustapel ${last.b + 1} als ${last.value}. ${last.refill ? 'Du hast neue Karten bekommen.' : ''}`;
  else if (last && last.pid === cid && last.refill) sub = 'Du hast alle Handkarten gespielt und fünf neue bekommen. Du spielst weiter.';
  else if (last && last.removed && last.pid === cid) sub = `Aufbaustapel ${last.b + 1} war bis 12 fertig und wurde weggeräumt. Dort kannst du wieder mit einer 1 beginnen.`;
  return body('Du kannst noch spielen oder eine Karte abwerfen.', sub);
}

function mineHtml(sel) {
  const g = S.game;
  const mi = myIndex();
  if (mi < 0) return '';
  const p = g.players[mi];
  const myTurn = g.mode === 'play' && g.active === mi;
  const srcs = myTurn ? P.sourcesOf(g, mi) : [];
  const okSet = new Set(srcs.map((s) => `${s.from}${s.i}`));
  const isSel = (from, i) => sel && sel.from === from && (from === 'pile' || sel.i === i);
  const discardMode = !!(sel && sel.from === 'hand');

  // Spielerstapel
  const pc = P.topOf(p.pile);
  const pileOk = okSet.has('pile0');
  const pileCard = pc === null ? emptyHtml({ label: 'Spielerstapel leer', cls: 'pile' })
    : cardHtml(pc, {
      cls: `pile ${pileOk ? 'sr-ok ' : ''}${isSel('pile', 0) ? 'sr-sel' : ''}`, count: 0, badge: pileOk,
      act: myTurn && pileOk ? 'src' : undefined, data: { from: 'pile', i: 0 },
      label: `Spielerstapel, oberste Karte ${pc === P.JOKER ? 'Joker' : pc}, noch ${p.pile.length} Karten${pileOk ? ', kann gelegt werden' : ''}`,
    });
  // Hilfsstapel
  const aux = p.aux.map((s, k) => {
    const top = P.topOf(s);
    const cap = s.length === 0 ? 'leer' : s.length === 1 ? '1 Karte' : `${s.length} Karten`;
    let face;
    if (discardMode) {
      const label = `Hilfsstapel ${k + 1}, ${cap}, hier abwerfen`;
      face = top === null ? emptyHtml({ act: 'to-aux', data: { k }, cls: 'sr-target', text: 'hier', label })
        : cardHtml(top, { act: 'to-aux', data: { k }, cls: 'sr-target', count: s.length, label });
    } else if (top === null) {
      face = emptyHtml({ label: `Hilfsstapel ${k + 1}, leer`, text: 'leer' });
    } else {
      const ok = okSet.has(`aux${k}`);
      face = cardHtml(top, {
        cls: `${ok ? 'sr-ok ' : ''}${isSel('aux', k) ? 'sr-sel' : ''}`, count: s.length, badge: ok,
        act: myTurn && ok ? 'src' : undefined, data: { from: 'aux', i: k },
        label: `Hilfsstapel ${k + 1}, oberste Karte ${top === P.JOKER ? 'Joker' : top}, ${cap}${ok ? ', kann gelegt werden' : ''}`,
      });
    }
    return `<div class="sr-cell">${face}<div class="sr-cap">${cap}</div></div>`;
  }).join('');
  // Hand
  const hand = Array.from({ length: P.HAND_SIZE }, (_, i) => {
    if (i >= p.hand.length) return `<div class="sr-cell"><div class="sr-c empty slot" aria-hidden="true"></div></div>`;
    const c = p.hand[i];
    const ok = okSet.has(`hand${i}`);
    const face = cardHtml(c, {
      cls: `${ok ? 'sr-ok ' : ''}${isSel('hand', i) ? 'sr-sel' : ''}`, badge: ok,
      act: myTurn ? 'src' : undefined, data: { from: 'hand', i },
      label: `Handkarte ${c === P.JOKER ? 'Joker' : c}${ok ? ', kann gelegt werden' : ''}${isSel('hand', i) ? ', gewählt' : ''}`,
    });
    return `<div class="sr-cell">${face}</div>`;
  }).join('');
  return `<section class="card sr-mine">
    <div class="sr-lab"><span>Spieler&shy;stapel</span><span>Deine Hilfsstapel (zum Abwerfen)</span></div>
    <div class="sr-row5"><div class="sr-cell">${pileCard}<div class="sr-cap">noch ${p.pile.length}</div></div>${aux}</div>
    <h3 class="sr-h3">Deine Handkarten</h3>
    <div class="sr-row5 sr-hand">${hand}</div></section>`;
}

function othersHtml() {
  const g = S.game;
  const list = g.players.map((p, i) => ({ p, i })).filter(({ p }) => p.id !== cid);
  if (!list.length) return '';
  return `<section class="card sr-opps"><h2>${list.length === 1 ? 'Mitspielende Person' : 'Mitspielende'}</h2>${list.map(({ p, i }) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' <span class="offline">(gerade nicht verbunden)</span>' : '';
    const minis = miniHtml(P.topOf(p.pile), 0, true) + p.aux.map((s) => miniHtml(P.topOf(s), s.length, false)).join('');
    return `<div class="sr-opp${g.mode === 'play' && i === g.active ? ' now' : ''}"><div class="sr-oh"><span><b>${esc(p.name)}</b>${off}${g.mode === 'play' && i === g.active ? ' – ist dran' : ''}</span>
      <span class="sr-os">Spielerstapel: ${p.pile.length} · Handkarten: ${p.hand.length}${g.opts.points ? ` · ${p.score} Punkte` : ''}</span></div>
      <div class="sr-minis" aria-label="Oberste Karten von ${esc(p.name)}: Spielerstapel und vier Hilfsstapel">${minis}</div></div>`;
  }).join('')}</section>`;
}

function recapHtml() {
  const g = S.game;
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.mode === 'over') return overHtml();
  if (g.mode === 'roundover') return roundHtml();
  const sel = selection();
  return `${headerHtml()}${lostHtml()}${bannerHtml()}${boardHtml(sel)}${hintHtml(sel)}${mineHtml(sel)}${othersHtml()}${recapHtml()}`;
}

function scoreTable() {
  const g = S.game;
  const rows = [...g.players].map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score || a.i - b.i);
  return `<table class="sr-sc"><tbody>${rows.map(({ p, i }) => `<tr><td>${esc(p.name)}${p.id === cid ? ' (du)' : ''}${i === g.roundWinner ? ' 🏁' : ''}</td><td class="num">${p.score} Punkte</td></tr>`).join('')}</tbody></table>`;
}

function roundText() {
  const g = S.game;
  const w = g.players[g.roundWinner];
  const others = g.players.filter((_, i) => i !== g.roundWinner).reduce((s, q) => s + q.pile.length, 0);
  return `<div class="sr-gain">${esc(w.name)} hat die Runde gewonnen und bekommt ${P.WIN_BONUS} Punkte plus ${P.CARD_POINTS} Punkte für jede der ${others} Karten, die bei den anderen noch im Spielerstapel liegen. Das sind zusammen <b>${g.gain} Punkte</b>.</div>`;
}

function roundHtml() {
  const g = S.game;
  return `${headerHtml()}${lostHtml()}${bannerHtml()}
    <section class="card over"><div class="trophy">🏁</div><h1>${esc(g.players[g.roundWinner].name)} gewinnt die Runde!</h1>
      ${roundText()}
      <h2>Zwischenstand (Ziel: ${P.TARGET_POINTS} Punkte)</h2>${scoreTable()}
      <button class="btn primary huge" data-act="next-round">▶ Nächste Runde</button></section>${recapHtml()}`;
}

function overHtml() {
  const g = S.game;
  const rank = P.ranking(g);
  const medals = { 1: '🏆', 2: '🥈', 3: '🥉' };
  const w = g.players[g.winner];
  const series = g.opts.points;
  const title = series ? `${esc(w.name)} hat gewonnen!` : `${esc(w.name)} hat gewonnen!`;
  const list = rank.map((r) => `<li class="${r.place === 1 ? 'win' : ''}"><span class="medal">${medals[r.place] || ''}</span>
    <span class="rn">${r.place}. ${esc(r.name)}${r.id === cid ? ' (du)' : ''}</span><span class="rt">${series ? r.score + ' Punkte' : r.left === 0 ? 'fertig' : 'noch ' + r.left}</span>
    <div class="rd">${series ? `<span class="chip">noch ${r.left} im Spielerstapel</span>` : `<span class="chip">${r.left === 0 ? 'Spielerstapel leer' : r.left + ' Karten im Spielerstapel'}</span>`}</div></li>`).join('');
  const again = sess.S.role === 'host'
    ? `<button class="btn primary huge" data-act="again">🏁 Noch eine Runde spielen</button>`
    : `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
  return `${headerHtml()}${lostHtml()}${bannerHtml()}
    <section class="card over"><div class="trophy">🏆</div><h1>${title}</h1>
    ${series ? `<p class="center big">${P.TARGET_POINTS} Punkte erreicht nach ${g.round} ${g.round === 1 ? 'Runde' : 'Runden'}.</p>${g.gain ? roundText() : ''}` : (g.endReason && !/abgebaut/.test(g.endReason) ? `<p class="center big">${esc(g.endReason)}</p>` : '')}
    <ol class="ranking">${list}</ol>${again}
    <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>${recapHtml()}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Du willst als Erste/r alle Karten von deinem <b>Spielerstapel</b> loswerden. Das ist der Stapel mit dem goldenen Rand. Du siehst nur die oberste Karte.</p>
    <h3>Die Tischmitte</h3>
    <p>In der Mitte liegen vier <b>Aufbaustapel</b>. Jeder beginnt mit einer 1. Dann kommen der Reihe nach 2, 3, 4 und so weiter bis zur 12. Ist ein Stapel bei der 12 angekommen, wird er weggeräumt. Dann kannst du dort wieder mit einer 1 beginnen.</p>
    <p>Der <b>Joker</b> ist eine Wildkarte. Er zählt als die Zahl, die der Stapel gerade braucht. Nach dem Legen siehst du, als welche Zahl er zählt.</p>
    <h3>Dein Zug</h3>
    <ol>
      <li>Am Anfang deines Zugs werden deine Handkarten automatisch auf fünf aufgefüllt.</li>
      <li>Du darfst jetzt so viele Karten legen, wie du kannst und willst. Du darfst die oberste Karte deines Spielerstapels legen, eine Handkarte oder die oberste Karte eines deiner Hilfsstapel. Tippe die Karte an und dann den leuchtenden Aufbaustapel.</li>
      <li>Hast du alle fünf Handkarten gelegt, bekommst du sofort fünf neue und spielst weiter.</li>
      <li>Dein Zug endet, wenn du eine Handkarte abwirfst. Tippe die Handkarte an und dann einen deiner vier Hilfsstapel. Auf den Hilfsstapeln darfst du die Karten in jeder Reihenfolge ablegen. Nur die oberste Karte eines Hilfsstapels kann später gelegt werden. Auch ein Joker darf auf einen Hilfsstapel.</li>
    </ol>
    <h3>Ein Beispiel</h3>
    <p>Auf Aufbaustapel 2 liegt eine 4. Der Stapel braucht jetzt die 5. Du hast eine 5 auf der Hand: Tippe die 5 an und dann auf Aufbaustapel 2. Nun braucht der Stapel die 6. Die Karten, die du nicht legen kannst, wirfst du am Ende ab.</p>
    <h3>Das Spielende</h3>
    <p>Sobald jemand die letzte Karte vom Spielerstapel legt, ist das Spiel sofort aus und diese Person hat gewonnen.</p>
    <p>Ist der Kartenstock leer, werden die weggeräumten Aufbaustapel gemischt und bilden den neuen Kartenstock. Gibt es keine Karten mehr, ziehst du weniger.</p>
    <h3>Mehrere Runden</h3>
    <p>Vor dem Start kannst du ankreuzen: „Mehrere Runden mit Punkten spielen“. Wer eine Runde gewinnt, bekommt 25 Punkte und 5 Punkte für jede Karte, die die anderen noch im Spielerstapel haben. Wer zuerst 500 Punkte hat, gewinnt.</p>
    <p class="muted">Keine Sorge: Das Programm prüft alle Regeln für dich und lässt nur erlaubte Züge zu. Welche Karte du legst oder abwirfst, entscheidest du ganz allein.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  title: 'Stapelrennen', icon: '🏁', sub: 'Kartenspiel – wer leert den Stapel zuerst?',
  helpTitle: 'Die Spielregeln vom Stapelrennen', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  options: OPTIONS,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'src': {
        const from = el.dataset.from, i = Number(el.dataset.i) || 0;
        const cur = S.ui.sel;
        S.ui.sel = cur && cur.from === from && (from === 'pile' || cur.i === i) ? null : { from, i };
        return render();
      }
      case 'to-build': {
        const s = selection();
        S.ui.sel = null;
        if (!s) return render();
        return sess.send({ t: 'play', from: s.from, i: s.i, to: Number(el.dataset.b) });
      }
      case 'to-aux': {
        const s = selection();
        S.ui.sel = null;
        if (!s || s.from !== 'hand') return render();
        return sess.send({ t: 'discard', i: s.i, to: Number(el.dataset.k) });
      }
      case 'next-round': return g && sess.send({ t: 'next' });
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
