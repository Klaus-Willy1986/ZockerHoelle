import * as E from './engine.js';
import * as W from './work.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { cardHtml, backHtml, kindText, jokerNote } from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ work: null, sel: [], sig: '', hint: '', coachSeen: {}, view: '', focus: null });

const OPTIONS = [
  { id: 'swap', label: 'Joker austauschen erlaubt', help: 'Wer die Karte hat, die ein Joker auf dem Tisch vertritt, darf den Joker nehmen. Er muss im selben Zug wieder ausgelegt werden.', def: true },
  { id: 'double', label: 'Rommé in einem Zug zählt doppelt', help: 'Wer alle Karten in einem einzigen Zug los wird, ohne vorher eröffnet zu haben, bekommt die doppelte Wertung.', def: true },
];
// Test-Hook: ?hand=5 gibt weniger Karten aus (die Runde endet schneller)
const HAND_HOOK = (() => { try { const n = Number(new URLSearchParams(location.search).get('hand')); return Number.isInteger(n) && n >= 3 && n <= 13 ? n : 0; } catch { return 0; } })();

const sess = createSession({
  game: 'rm',
  maxPlayers: 4,
  options: OPTIONS,
  newGame: (players, opts) => { resetUi(); return E.createGame(players, { ...(opts || {}), ...(HAND_HOOK ? { hand: HAND_HOOK } : {}) }, Math.random); },
  onMessage: (state, pid, msg) => {
    // „Nächste Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    E.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 700,
    step: (g, level) => {
      if (!g || g.game !== 'rm' || g.phase !== 'play') return null;
      const ap = E.activePlayer(g);
      if (!ap || !String(ap.id).startsWith('bot')) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
function resetUi() { S.ui = { ...(S.ui || {}), ...freshUi() }; scr.table = 0; scr.strips = {}; }
const scr = { table: 0, strips: {}, ignore: 0 };
S.ui = { ...(S.ui || {}), ...freshUi(), sort: sess.get('rm_sort', 'farbe') === 'wert' ? 'wert' : 'farbe' };

const myTurn = (g) => !!g && g.phase === 'play' && E.activePlayer(g).id === cid;
const canPlay = (g) => myTurn(g) && g.turn === 'play';

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.game === 'rm') {
    const sig = W.turnSig(g);
    if (sig !== S.ui.sig) {
      S.ui.sig = sig; S.ui.work = null; S.ui.sel = []; S.ui.hint = ''; S.ui.focus = null;
      scr.strips = {};
    }
    if (!S.ui.work) S.ui.work = W.cloneTable(g.table);
  }
  const view = `${S.screen}|${g ? g.phase : ''}|${g ? g.round : ''}`;
  const jump = view !== S.ui.view;
  S.ui.view = view;
  render();
  if (jump) window.scrollTo(0, 0);
}

// ====================== Darstellung ======================
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function bannerHtml(g) {
  if (g.phase === 'over') return `<div class="banner done rm-banner">Die Runde ist zu Ende</div>`;
  const ap = E.activePlayer(g);
  return ap.id === cid
    ? `<div class="banner mine rm-banner">${g.turn === 'draw' ? 'Du bist dran: Karte nehmen!' : 'Du bist dran!'}</div>`
    : `<div class="banner rm-banner">${esc(ap.name)} ist dran …</div>`;
}

function oppsHtml(g) {
  const others = g.players.filter((p) => p.id !== cid);
  if (!others.length) return '';
  return `<section class="rm-opps" aria-label="Mitspielende">${others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' (nicht verbunden)' : '';
    const turn = g.phase === 'play' && E.activePlayer(g).id === p.id;
    return `<div class="rm-opp${turn ? ' turn' : ''}"><b>${esc(p.name)}${esc(off)}</b><span>${pl(p.hand.length, 'Karte', 'Karten')}</span>`
      + `<span class="${p.melded ? 'ok' : 'no'}">${p.melded ? '✔ hat eröffnet' : '– nicht eröffnet'}</span></div>`;
  }).join('')}</section>`;
}

// Stapel, Ablage und die drei Schritte eines Zuges
function deckHtml(g) {
  const mine = myTurn(g);
  const drawNow = mine && g.turn === 'draw';
  const top = g.discard.length ? g.discard[g.discard.length - 1] : null;
  const pileOk = drawNow && (g.pile.length > 0 || g.discard.length > 1);
  const discOk = drawNow && top !== null;
  const step = !mine ? 0 : g.turn === 'draw' ? 1 : 2;
  const steps = [['1.', 'Karte nehmen'], ['2.', 'Auslegen (optional)'], ['3.', 'Ablegen']]
    .map(([n, t], i) => `<li class="${(step === 1 && i === 0) || (step === 2 && i >= 1) ? 'now' : ''}"><b>${n}</b> ${t}</li>`).join('');
  return `<section class="card rm-deck" aria-label="Stapel und Ablage">
    <button type="button" class="rm-pile${pileOk ? ' go' : ''}" data-act="take" data-from="pile" ${pileOk ? '' : 'disabled'} aria-label="Stapel, ${pl(g.pile.length, 'Karte', 'Karten')}${pileOk ? ', verdeckte Karte nehmen' : ''}">
      ${backHtml('lg')}<span class="rm-lbl">Stapel (${g.pile.length})</span></button>
    <button type="button" class="rm-pile${discOk ? ' go' : ''}" data-act="take" data-from="discard" ${discOk ? '' : 'disabled'} aria-label="Ablage, oben liegt ${top !== null ? esc(E.cardLabel(top)) : 'nichts'}${discOk ? ', diese Karte nehmen' : ''}">
      ${top !== null ? cardHtml(top, { cls: 'lg' }) : '<span class="rm-c lg empty"></span>'}<span class="rm-lbl">Ablage (${g.discard.length})</span></button>
    <ol class="rm-steps" aria-label="Dein Zug">${steps}</ol></section>`;
}

// Der Tisch: jeder Satz eine Zeile. Mit `view` (Arbeitskopie) antippbar, sonst nur zum Ansehen.
function tableHtml(g, table, view) {
  const old = W.oldIds(g);
  const last = new Set(g.lastPlayed || []);
  const sel = new Set(view ? S.ui.sel : []);
  const mineNow = view && canPlay(g);
  const rows = table.map((ids, i) => {
    const a = E.analyzeSet(ids);
    const tiles = ids.map((id) => cardHtml(id, { act: mineNow, sel: sel.has(id), fresh: !!view && !old.has(id), last: last.has(id) && !(view && !old.has(id)) })).join('');
    const info = a.valid
      ? `${kindText(a)} · ${a.value} Punkte${jokerNote(a) ? ` · <span class="jk">${esc(jokerNote(a))}</span>` : ''}`
      : `<span class="err">✖ ${esc(a.reason)}</span>`;
    const canHere = mineNow && S.ui.sel.length > 0 && !S.ui.sel.every((id) => ids.includes(id));
    const here = mineNow ? `<button type="button" class="btn secondary rm-here" data-act="here" data-i="${i}" ${canHere ? '' : 'disabled'}>Hierhin legen</button>` : '';
    return `<div class="rm-set${a.valid ? '' : ' bad'}" data-i="${i}"><div class="rm-row"><div class="rm-strip" data-strip="${i}" role="group" aria-label="Satz ${i + 1}">${tiles}</div>${here}</div>`
      + `<div class="rm-sinfo">${info}</div></div>`;
  }).join('');
  const body = rows || `<p class="rm-empty">Noch liegt nichts auf dem Tisch.</p>`;
  return `<section class="card rm-table"${view ? ' id="board"' : ''} aria-label="Tisch">
    <div class="rm-thead"><b>Tisch</b><span>Sätze: ${table.filter((s) => s.length).length}</span></div>
    <div class="rm-tscroll" data-scroll="table">${body}</div></section>`;
}

function infoHtml(g, me, ctx) {
  const lines = (g.recap || []).slice(-2).join(' ');
  const recap = `<p class="big rm-recap">${esc(lines)}</p>`;
  const mine = myTurn(g);
  if (!ctx) {
    const live = mine && g.turn === 'draw' ? 'Tippe auf den Stapel oder auf die Ablage, um eine Karte zu nehmen.' : g.phase === 'play' ? 'Bitte warte einen Moment, bis du dran bist.' : '';
    return `<section class="card action rm-info">${recap}<p class="rm-live" role="status">${live}</p><p class="rm-open"></p></section>`;
  }
  const { c, placed, dirty, bad } = ctx;
  let live;
  if (S.ui.hint) live = `<span class="hint">${esc(S.ui.hint)}</span>`;
  else if (S.ui.sel.length) live = `${pl(S.ui.sel.length, 'Karte', 'Karten')} markiert. Tippe auf „Neuer Satz“ oder „Hierhin legen“, oder auf „Ablegen“.`;
  else if (!placed && !dirty) live = me.melded ? 'Lege aus oder an, oder markiere eine Karte und tippe auf „Ablegen“.' : 'Eröffnung: Dein erster Auslegezug braucht neue Sätze mit 40 Punkten.';
  else if (bad) live = 'Rot umrandete Sätze sind noch nicht gültig.';
  else if (c.ok) live = 'Alle Sätze sind gültig. Tippe auf „Auslegen“.';
  else if (!me.melded && placed && /Eröffnen|Eröffnung/.test(c.error)) live = 'Für die Eröffnung brauchst du mehr Punkte.';
  else live = esc(c.error);
  let open = '';
  if (!me.melded && placed) {
    const v = E.openValue(g, S.ui.work);
    open = `Eröffnung: ${v} von ${E.OPEN_MIN} Punkten${v >= E.OPEN_MIN ? ' ✔' : ''}`;
  }
  return `<section class="card action rm-info">${recap}<p class="rm-live" role="status">${live}</p><p class="rm-open">${open}</p></section>`;
}

function actionsHtml(g, me, ctx) {
  const on = !!ctx;
  const sel = S.ui.sel;
  const table = S.ui.work || g.table;
  const old = W.oldIds(g);
  const onTable = new Set(E.tableIds(table));
  const canBack = on && sel.some((id) => onTable.has(id) && !old.has(id));
  const dis = (b) => (b ? '' : 'disabled');
  return `<section class="card rm-actions" aria-label="Aktionen">
    <button type="button" class="btn secondary" data-act="newset" ${dis(on && sel.length > 0)}>Neuer Satz</button>
    <button type="button" class="btn secondary" data-act="back" ${dis(canBack)}>Zurück in die Hand</button>
    <button type="button" class="btn primary huge" data-act="meld" ${dis(on && ctx.c.ok)}>Auslegen</button>
    <button type="button" class="btn secondary huge" data-act="discard" ${dis(on)}>Ablegen</button>
    <button type="button" class="btn ghost wide" data-act="reset" ${dis(on && ctx.dirty)}>Alles zurücksetzen</button></section>`;
}

function handHtml(g, me, ctx) {
  const table = S.ui.work || g.table;
  let hand = W.handOf(g, cid, table);
  hand = S.ui.sort === 'wert' ? E.sortByRank(hand) : E.sortHand(hand);
  const sel = new Set(S.ui.sel);
  const mineNow = !!ctx;
  const drawn = g.lastDrawnBy === cid ? g.lastDrawn : null;
  const tiles = hand.map((id) => cardHtml(id, { act: mineNow, sel: sel.has(id), drawn: id === drawn })).join('');
  return `<section class="card rm-hand" aria-label="Deine Karten">
    <div class="rm-hhead"><b>Deine Karten (${hand.length})</b><span class="${me.melded ? 'ok' : 'no'}">${me.melded ? '✔ eröffnet' : '– nicht eröffnet'}</span></div>
    <div class="rm-sorts"><button type="button" class="btn mini${S.ui.sort === 'farbe' ? ' on' : ''}" data-act="sort" data-by="farbe" aria-pressed="${S.ui.sort === 'farbe'}">Nach Farbe</button>
    <button type="button" class="btn mini${S.ui.sort === 'wert' ? ' on' : ''}" data-act="sort" data-by="wert" aria-pressed="${S.ui.sort === 'wert'}">Nach Wert</button></div>
    <div class="rm-htiles" id="hand">${tiles || '<p class="rm-empty">Deine Hand ist leer.</p>'}</div></section>`;
}

// Live-Prüfung des Auslegens in der Arbeitskopie
function turnCtx(g) {
  if (!canPlay(g) || !S.ui.work) return null;
  const c = E.checkTurn(g, cid, S.ui.work);
  const placed = W.placedIds(g, S.ui.work).length;
  const bad = S.ui.work.some((s) => s.length > 0 && !E.analyzeSet(s).valid);
  return { c, placed, bad, dirty: W.dirty(g, S.ui.work) };
}

function playHtml(g) {
  const me = g.players.find((p) => p.id === cid);
  if (!me) return `${ui.header()}${ui.lost()}<section class="card"><p class="big">Du spielst in diesem Spiel nicht mit.</p></section>`;
  const ctx = turnCtx(g);
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${oppsHtml(g)}
    ${deckHtml(g)}
    ${tableHtml(g, S.ui.work || g.table, true)}
    ${infoHtml(g, me, ctx)}
    ${actionsHtml(g, me, ctx)}
    ${handHtml(g, me, ctx)}`;
}

// ====================== Rundenende ======================
function overHtml(g) {
  const res = g.result || { winners: [], deltas: {}, reason: 'leer', double: false, pen: {} };
  const winners = g.players.filter((p) => res.winners.includes(p.id));
  const iWon = res.winners.includes(cid);
  const names = winners.map((p) => esc(p.name));
  let title;
  if (winners.length === 1) title = iWon ? 'Rommé! Du hast die Runde gewonnen!' : `${names[0]} hat die Runde gewonnen!`;
  else title = iWon ? `Du und ${winners.filter((p) => p.id !== cid).map((p) => esc(p.name)).join(' und ')} habt die Runde gewonnen!` : `${names.join(' und ')} haben die Runde gewonnen!`;
  const reason = res.reason === 'leer'
    ? `${winners.length ? (iWon ? 'Du bist' : esc(winners[0].name) + ' ist') : 'Jemand ist'} alle Karten los.${res.double ? ' Das war Rommé in einem Zug: doppelte Wertung!' : ''}`
    : 'Die Runde hat zu lange gedauert. Wer die wenigsten Strafpunkte hat, gewinnt.';
  const rank = E.ranking(g);
  const lead = rank.filter((r) => r.place === 1);
  const leadText = lead.length === 1 ? (lead[0].id === cid ? 'Insgesamt führst du.' : `Insgesamt führt ${esc(lead[0].name)}.`) : 'Insgesamt steht es unentschieden an der Spitze.';
  const rows = g.players.map((p) => {
    const d = res.deltas[p.id] || 0;
    const win = res.winners.includes(p.id);
    return `<tr class="${win ? 'win' : ''}"><th scope="row">${win ? '🏆 ' : ''}${esc(p.name)}${p.id === cid ? ' (du)' : ''}</th>
      <td>${E.sumValue(p.hand)}</td><td class="${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${d}</td><td><b>${p.score}</b></td></tr>`;
  }).join('');
  const next = S.role === 'host'
    ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over action rm-over"><div class="trophy" aria-hidden="true">${iWon ? '🏆' : '🎲'}</div><h1>${title}</h1>
      <p class="big center">${reason}</p>
      <table class="rm-res"><thead><tr><th scope="col">Name</th><th scope="col">Rest-<br>punkte</th><th scope="col">Diese<br>Runde</th><th scope="col">Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="center"><b>${leadText}</b></p>
      ${next}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>
    ${tableHtml(g, g.table, false)}`;
}

function gameHtml() {
  const g = S.game;
  if (!g || g.game !== 'rm') return '';
  return g.phase === 'over' ? overHtml(g) : playHtml(g);
}

// ====================== Hilfe ======================
function helpBody() {
  return `
    <p><b>Ziel:</b> Werde alle deine Karten los. Dafür legst du Karten zu Folgen und Sätzen auf den Tisch und wirfst am Ende eine Karte auf die Ablage. Das Spiel ist für 2 bis 4 Personen, auch gegen den Computer.</p>
    <h3>Die Karten</h3>
    <p>Gespielt wird mit zwei Skatblättern (104 Karten) und 6 Jokern ★. Jede Person bekommt 13 Karten. Eine Karte liegt offen auf der <b>Ablage</b>, die übrigen Karten liegen verdeckt auf dem <b>Stapel</b>. Die Farben erkennst du am Zeichen: ♣ Kreuz und ♠ Pik (schwarz), ♥ Herz und ♦ Karo (rot).</p>
    <h3>Zwei Arten von Sätzen</h3>
    <ul>
      <li><b>Folge:</b> mindestens 3 Karten <b>einer Farbe</b> in lückenloser Reihenfolge, zum Beispiel ♥ 4, 5, 6. Das Ass gilt niedrig (Ass-2-3) oder hoch (Dame-König-Ass), aber es gibt keinen Umlauf König-Ass-2.</li>
      <li><b>Satz:</b> 3 oder 4 Karten <b>gleichen Werts</b> in verschiedenen Farben, zum Beispiel ♣ 9, ♥ 9, ♦ 9.</li>
      <li><b>Joker:</b> Er ersetzt eine beliebige Karte. In jeder Folge und in jedem Satz darf aber höchstens <b>ein</b> Joker liegen.</li>
    </ul>
    <h3>Punktwerte</h3>
    <p>Ass 11 (in Ass-2-3 nur 1), Bube, Dame, König und 10 je 10, die Zahlen 2 bis 9 so viel wie ihre Augen. Ein Joker im Satz zählt so viel wie die Karte, die er ersetzt. Ein Joker, der auf der Hand bleibt, kostet 20 Strafpunkte.</p>
    <h3>Dein Zug in drei Schritten</h3>
    <ul>
      <li><b>1. Karte nehmen:</b> Tippe auf den <b>Stapel</b> (verdeckte Karte) oder auf die <b>Ablage</b> (die oberste offene Karte). Das musst du immer tun.</li>
      <li><b>2. Auslegen (freiwillig):</b> Tippe Karten an. Sie werden markiert (Häkchen, blauer Rand). Mehrere Karten markierst du nacheinander. Dann tippe auf <b>Neuer Satz</b>, oder bei einem Satz auf dem Tisch auf <b>Hierhin legen</b>. Wenn alle Sätze gültig sind, tippe auf <b>Auslegen</b>.</li>
      <li><b>3. Ablegen:</b> Markiere eine Karte und tippe auf <b>Ablegen</b>. Sie kommt auf die Ablage, und der Zug ist zu Ende. Die Karte, die du eben von der Ablage genommen hast, darfst du nicht gleich wieder ablegen.</li>
    </ul>
    <h3>Die Eröffnung</h3>
    <p>Deine ersten Sätze heißen Eröffnung. Du darfst dabei nur <b>neue Sätze aus deiner Hand</b> auslegen, die zusammen mindestens <b>40 Punkte</b> wert sind. Mehrere Sätze sind erlaubt. Unter dem Tisch siehst du, wie viele Punkte es gerade sind. Bis du eröffnet hast, darfst du nichts an Sätze auf dem Tisch anlegen.</p>
    <h3>Anlegen und Umlegen</h3>
    <p>Nach deiner Eröffnung darfst du in jedem Zug (auch gleich danach) Karten an <b>beliebige</b> Sätze auf dem Tisch anlegen, auch an die der anderen: eine Folge an beiden Enden verlängern, einen Satz bis auf 4 Karten ergänzen. Du darfst auch Karten zwischen Sätzen umlegen, solange am Ende alle Sätze gültig sind und keine Karte vom Tisch zurück in die Hand wandert.</p>
    <ul>
      <li><b>Joker austauschen:</b> Hast du die Karte, die ein Joker auf dem Tisch ersetzt, markiere sie und tippe beim Satz auf „Hierhin legen“. Dann markierst du den Joker und legst ihn in einen anderen Satz. Der Joker muss im selben Zug wieder auf den Tisch.</li>
      <li><b>Zurück in die Hand:</b> Markierte Karten, die du gerade erst ausgelegt hast, nimmst du zurück.</li>
      <li><b>Alles zurücksetzen:</b> Alles, was du in diesem Schritt umgelegt hast, geht zurück.</li>
    </ul>
    <h3>Ende der Runde und Punkte</h3>
    <ul>
      <li>Die Runde endet, wenn jemand seine letzte Karte los ist: durch Ablegen oder weil er alle Karten ausgelegt hat. Das heißt <b>Rommé</b>.</li>
      <li>Wer die Runde beendet, bekommt die Strafpunkte aller anderen als Pluspunkte. Die anderen bekommen ihre eigenen Restkarten als Minuspunkte.</li>
      <li>Wer alle Karten in einem einzigen Zug los wird, ohne vorher eröffnet zu haben, bekommt die <b>doppelte</b> Wertung (einstellbar).</li>
      <li>Ist der Stapel leer, wird die Ablage neu gemischt.</li>
      <li>Nach jeder Runde tippt der Gastgeber auf „Nächste Runde“. Die Gesamtpunkte siehst du in der Tabelle. Mit „Spiel beenden“ hörst du auf, wann du möchtest.</li>
    </ul>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur gültige Züge gespielt werden können.</p>
`;
}

// ====================== Bedienung ======================
const send = (m) => sess.send(m);
function update(r) {
  if (!r.ok) { S.ui.hint = r.hint; return render(); }
  S.ui.hint = '';
  S.ui.work = r.table;
  S.ui.sel = r.sel || [];
  S.ui.focus = r.focus === undefined ? null : r.focus;
  return render();
}
const guard = () => { const g = S.game; return g && g.game === 'rm' && canPlay(g) && S.ui.work ? g : null; };

function tapCard(id) {
  const g = guard();
  if (!g) return undefined;
  const at = S.ui.sel.indexOf(id);
  if (at >= 0) { S.ui.sel = S.ui.sel.filter((x) => x !== id); S.ui.hint = ''; return render(); }
  const why = W.selectBlock(g, cid, S.ui.work, id);
  if (why) { S.ui.hint = why; return render(); }
  S.ui.hint = '';
  S.ui.sel = [...S.ui.sel, id];
  return render();
}

const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 1, coach },
  options: OPTIONS,
  title: 'Rommé', icon: '♠️', sub: 'Folgen und Sätze legen, alle Karten loswerden – für 2 bis 4 Personen',
  helpTitle: 'Die Spielregeln von Rommé', helpBody: helpBody(),
  minPlayers: 2,
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'sort': S.ui.sort = el.dataset.by === 'wert' ? 'wert' : 'farbe'; sess.set('rm_sort', S.ui.sort); return render();
      case 'next': return g && S.role === 'host' && g.phase === 'over' ? send({ t: 'next' }) : undefined;
      case 'take': {
        if (!g || !myTurn(g) || g.turn !== 'draw') return undefined;
        S.ui.sel = []; S.ui.hint = '';
        return send({ t: 'draw', from: el.dataset.from === 'discard' ? 'discard' : 'pile' });
      }
      case 'card': return tapCard(Number(el.dataset.id));
      case 'here': { const x = guard(); return x && update({ ...W.attach(x, cid, S.ui.work, Number(el.dataset.i), S.ui.sel), focus: S.ui.sel[0] }); }
      case 'newset': { const x = guard(); if (!x) return undefined; return update({ ...W.newSet(x, cid, S.ui.work, S.ui.sel), focus: S.ui.sel[0] }); }
      case 'back': { const x = guard(); return x && update(W.putBack(x, S.ui.work, S.ui.sel)); }
      case 'reset': { const x = guard(); if (!x) return undefined; S.ui.hint = ''; return update({ ok: true, table: W.cloneTable(x.table), sel: [] }); }
      case 'meld': {
        const x = guard();
        if (!x) return undefined;
        const c = E.checkTurn(x, cid, S.ui.work);
        if (!c.ok) { S.ui.hint = c.error; return render(); }
        S.ui.sel = []; S.ui.hint = '';
        return send({ t: 'meld', table: c.table });
      }
      case 'discard': {
        const x = guard();
        if (!x) return undefined;
        if (W.placedIds(x, S.ui.work).length || W.dirty(x, S.ui.work)) { S.ui.hint = 'Du hast auf dem Tisch etwas verändert. Tippe erst auf „Auslegen“ oder auf „Alles zurücksetzen“.'; return render(); }
        if (S.ui.sel.length !== 1) { S.ui.hint = 'Markiere genau eine Karte aus deiner Hand, die du ablegen möchtest.'; return render(); }
        const why = E.canDiscard(x, cid, S.ui.sel[0]);
        if (why) { S.ui.hint = why; return render(); }
        const card = S.ui.sel[0];
        S.ui.sel = []; S.ui.hint = '';
        return send({ t: 'discard', card });
      }
    }
    return undefined;
  },
});
function render() { ui.render(); }

// ====================== Bildlauf merken (Tisch und Satzzeilen springen beim Neuzeichnen nicht) ======================
function restoreScroll() {
  const t = $app.querySelector('[data-scroll="table"]');
  scr.ignore = Date.now() + 120;
  if (t) {
    t.scrollTop = scr.table;
    const set = S.ui.focus != null ? t.querySelector(`[data-id="${S.ui.focus}"]`)?.closest('.rm-set') : null;
    if (set) {
      if (set.offsetTop < t.scrollTop) t.scrollTop = Math.max(0, set.offsetTop - 6);
      else if (set.offsetTop + set.offsetHeight > t.scrollTop + t.clientHeight) t.scrollTop = set.offsetTop + set.offsetHeight - t.clientHeight + 10;
      scr.table = t.scrollTop;
    }
    S.ui.focus = null;
  }
  $app.querySelectorAll('[data-strip]').forEach((n) => { const x = scr.strips[n.dataset.strip]; if (x) n.scrollLeft = x; });
}
new MutationObserver(() => restoreScroll()).observe($app, { childList: true });
$app.addEventListener('scroll', (ev) => {
  const el = ev.target;
  if (!el || !el.dataset || Date.now() < scr.ignore) return;
  if (el.dataset.scroll === 'table') scr.table = el.scrollTop;
  else if (el.dataset.strip !== undefined) scr.strips[el.dataset.strip] = el.scrollLeft;
}, true);

// Der Schließen-Knopf im Hilfefenster liegt im Fenster, dessen Klick nicht nach oben weitergereicht wird (ui.js).
$app.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('.modal [data-act="help-close"]');
  if (!b) return;
  ev.stopPropagation();
  S.ui.helpOpen = false;
  render();
}, true);
ui.boot();
