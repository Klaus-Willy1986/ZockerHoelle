import * as E from './engine.js';
import * as W from './work.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { tileHtml, kindText, jokerNote } from './draw.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const freshUi = () => ({ work: null, sel: [], sig: '', hint: '', coachSeen: {}, view: '', focus: null });

const sess = createSession({
  game: 'rg',
  maxPlayers: 4,
  newGame: (players) => { resetUi(); return E.createGame(players, {}, Math.random); },
  onMessage: (state, pid, msg) => {
    // „Nächste Runde“ darf nur das Gerät des Gastgebers auslösen (hier läuft nur der Gastgeber)
    if (msg && msg.t === 'next' && pid !== cid) return;
    E.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => resetUi(),
  bot: {
    delay: 750,
    step: (g, level) => {
      if (!g || g.game !== 'rg' || g.phase !== 'play') return null;
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
S.ui = { ...(S.ui || {}), ...freshUi(), sort: sess.get('rg_sort', 'farbe') === 'zahl' ? 'zahl' : 'farbe' };

const myTurn = (g) => !!g && g.phase === 'play' && E.activePlayer(g).id === cid;

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g && g.game === 'rg') {
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
  if (g.phase === 'over') return `<div class="banner done rg-banner">Die Runde ist zu Ende</div>`;
  const ap = E.activePlayer(g);
  return ap.id === cid
    ? `<div class="banner mine rg-banner">Du bist dran!</div>`
    : `<div class="banner rg-banner">${esc(ap.name)} ist dran …</div>`;
}

function oppsHtml(g) {
  const others = g.players.filter((p) => p.id !== cid);
  if (!others.length) return '';
  return `<section class="rg-opps" aria-label="Mitspielende">${others.map((p) => {
    const l = S.lobby.find((x) => x.id === p.id);
    const off = l && !l.connected ? ' (nicht verbunden)' : '';
    const turn = g.phase === 'play' && E.activePlayer(g).id === p.id;
    return `<div class="rg-opp${turn ? ' turn' : ''}"><b>${esc(p.name)}${esc(off)}</b><span>${pl(p.hand.length, 'Stein', 'Steine')}</span>`
      + `<span class="${p.melded ? 'ok' : 'no'}">${p.melded ? '✔ hat eröffnet' : '– nicht eröffnet'}</span></div>`;
  }).join('')}</section>`;
}

// Der Tisch: jeder Satz eine Zeile. Mit `view` (Arbeitskopie) antippbar, sonst nur zum Ansehen.
function tableHtml(g, table, view) {
  const old = W.oldIds(g);
  const last = new Set(g.lastPlayed || []);
  const sel = new Set(view ? S.ui.sel : []);
  const mineNow = view && myTurn(g);
  const rows = table.map((ids, i) => {
    const a = E.analyzeSet(ids);
    const tiles = ids.map((id) => tileHtml(id, { act: mineNow, sel: sel.has(id), fresh: !!view && !old.has(id), last: last.has(id) && !(view && !old.has(id)) })).join('');
    const info = a.valid
      ? `${kindText(a)} · ${a.value} Punkte${jokerNote(a) ? ` · <span class="jk">${esc(jokerNote(a))}</span>` : ''}`
      : `<span class="err">✖ ${esc(a.reason)}</span>`;
    const canHere = mineNow && S.ui.sel.length > 0 && !S.ui.sel.every((id) => ids.includes(id));
    const here = mineNow ? `<button type="button" class="btn secondary rg-here" data-act="here" data-i="${i}" ${canHere ? '' : 'disabled'}>Hierhin legen</button>` : '';
    return `<div class="rg-set${a.valid ? '' : ' bad'}" data-i="${i}"><div class="rg-row"><div class="rg-strip" data-strip="${i}" role="group" aria-label="Satz ${i + 1}">${tiles}</div>${here}</div>`
      + `<div class="rg-sinfo">${info}</div></div>`;
  }).join('');
  const body = rows || `<p class="rg-empty">Noch liegt nichts auf dem Tisch.</p>`;
  return `<section class="card rg-table" id="board" aria-label="Tisch">
    <div class="rg-thead"><b>Tisch</b><span>Stapel: ${pl(g.pile.length, 'Stein', 'Steine')}</span></div>
    <div class="rg-tscroll" data-scroll="table">${body}</div></section>`;
}

function infoHtml(g, me, ctx) {
  const lines = (g.recap || []).slice(-2).join(' ');
  const recap = `<p class="big rg-recap">${esc(lines)}</p>`;
  if (!ctx) return `<section class="card action rg-info">${recap}<p class="rg-live" role="status">${g.phase === 'play' ? 'Bitte warte einen Moment, bis du dran bist.' : ''}</p><p class="rg-open"></p></section>`;
  const { c, placed, dirty, bad } = ctx;
  let live;
  if (S.ui.hint) live = `<span class="hint">${esc(S.ui.hint)}</span>`;
  else if (S.ui.sel.length) live = `${pl(S.ui.sel.length, 'Stein', 'Steine')} markiert. Tippe auf „Neuer Satz“ oder „Hierhin legen“.`;
  else if (!placed && !dirty) live = me.melded ? 'Tippe einen Stein an, um ihn zu markieren.' : 'Eröffnung: Dein erster Zug braucht neue Sätze mit 30 Punkten.';
  else if (bad) live = 'Rot umrandete Sätze sind noch nicht gültig.';
  else if (c.ok) live = 'Alle Sätze sind gültig. Tippe auf „Legen“.';
  else if (!me.melded && placed && /Eröffnen|Eröffnung/.test(c.error)) live = 'Für die Eröffnung brauchst du mehr Punkte.';
  else live = esc(c.error);
  let open = '';
  if (!me.melded && placed) {
    const v = W.openValue(g, S.ui.work);
    open = `Eröffnung: ${v} von ${E.OPEN_MIN} Punkten${v >= E.OPEN_MIN ? ' ✔' : ''}`;
  }
  return `<section class="card action rg-info">${recap}<p class="rg-live" role="status">${live}</p><p class="rg-open">${open}</p></section>`;
}

function actionsHtml(g, me, ctx) {
  const on = !!ctx;
  const sel = S.ui.sel;
  const table = S.ui.work || g.table;
  const old = W.oldIds(g);
  const onTable = new Set(E.tableIds(table));
  const canBack = on && sel.some((id) => onTable.has(id) && !old.has(id));
  const canSplit = on && sel.length === 1 && onTable.has(sel[0]);
  const canDis = on && sel.some((id) => onTable.has(id));
  const placed = ctx ? ctx.placed : 0;
  const dis = (b) => (b ? '' : 'disabled');
  const drawLabel = g.pile.length ? 'Stein ziehen' : 'Passen';
  return `<section class="card rg-actions" aria-label="Aktionen">
    <button type="button" class="btn secondary" data-act="newset" ${dis(on && sel.length > 0)}>Neuer Satz</button>
    <button type="button" class="btn secondary" data-act="back" ${dis(canBack)}>Zurück in die Hand</button>
    <button type="button" class="btn secondary" data-act="split" ${dis(canSplit)}>Satz teilen</button>
    <button type="button" class="btn secondary" data-act="dissolve" ${dis(canDis)}>Satz auflösen</button>
    <button type="button" class="btn primary huge" data-act="play" ${dis(on && ctx.c.ok)}>Legen</button>
    <button type="button" class="btn secondary huge" data-act="draw" ${on ? '' : 'disabled'} ${on && placed ? 'aria-disabled="true"' : ''}>${drawLabel}</button>
    <button type="button" class="btn ghost wide" data-act="reset" ${dis(on && ctx.dirty)}>Alles zurücksetzen</button></section>`;
}

function handHtml(g, me, ctx) {
  const table = S.ui.work || g.table;
  let hand = W.handOf(g, cid, table);
  hand = S.ui.sort === 'zahl' ? W.sortByNumber(hand) : E.sortHand(hand);
  const sel = new Set(S.ui.sel);
  const mineNow = !!ctx;
  const drawn = g.lastDrawnBy === cid ? g.lastDrawn : null;
  const tiles = hand.map((id) => tileHtml(id, { act: mineNow, sel: sel.has(id), drawn: id === drawn })).join('');
  return `<section class="card rg-hand" aria-label="Deine Steine">
    <div class="rg-hhead"><b>Deine Steine (${hand.length})</b><span class="${me.melded ? 'ok' : 'no'}">${me.melded ? '✔ eröffnet' : '– nicht eröffnet'}</span></div>
    <div class="rg-sorts"><button type="button" class="btn mini${S.ui.sort === 'farbe' ? ' on' : ''}" data-act="sort" data-by="farbe" aria-pressed="${S.ui.sort === 'farbe'}">Nach Farbe</button>
    <button type="button" class="btn mini${S.ui.sort === 'zahl' ? ' on' : ''}" data-act="sort" data-by="zahl" aria-pressed="${S.ui.sort === 'zahl'}">Nach Zahl</button></div>
    <div class="rg-htiles" id="hand">${tiles || '<p class="rg-empty">Deine Hand ist leer.</p>'}</div></section>`;
}

// Live-Prüfung des Zugs in der Arbeitskopie
function turnCtx(g) {
  if (!myTurn(g) || !S.ui.work) return null;
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
    ${tableHtml(g, S.ui.work || g.table, true)}
    ${infoHtml(g, me, ctx)}
    ${actionsHtml(g, me, ctx)}
    ${handHtml(g, me, ctx)}`;
}

// ====================== Rundenende ======================
function overHtml(g) {
  const res = g.result || { winners: [], deltas: {}, reason: 'leer' };
  const winners = g.players.filter((p) => res.winners.includes(p.id));
  const iWon = res.winners.includes(cid);
  const names = winners.map((p) => esc(p.name));
  let title;
  if (winners.length === 1) title = iWon ? 'Du hast die Runde gewonnen! Glückwunsch!' : `${names[0]} hat die Runde gewonnen!`;
  else title = iWon ? `Du und ${winners.filter((p) => p.id !== cid).map((p) => esc(p.name)).join(' und ')} habt die Runde gewonnen!` : `${names.join(' und ')} haben die Runde gewonnen!`;
  const reason = res.reason === 'leer'
    ? `${winners.length ? (iWon ? 'Du hast' : esc(winners[0].name) + ' hat') : 'Jemand hat'} alle Steine gelegt.`
    : 'Niemand kann mehr legen. Wer die wenigsten Reststeine hat, gewinnt.';
  const rank = E.ranking(g);
  const lead = rank.filter((r) => r.place === 1);
  const leadText = lead.length === 1 ? (lead[0].id === cid ? 'Insgesamt führst du.' : `Insgesamt führt ${esc(lead[0].name)}.`) : 'Insgesamt steht es unentschieden an der Spitze.';
  const rows = g.players.map((p) => {
    const d = res.deltas[p.id] || 0;
    const win = res.winners.includes(p.id);
    return `<tr class="${win ? 'win' : ''}"><th scope="row">${win ? '🏆 ' : ''}${esc(p.name)}${p.id === cid ? ' (du)' : ''}</th>
      <td>${p.hand.length ? E.sumValue(p.hand) : 0}</td><td class="${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${d}</td><td><b>${p.score}</b></td></tr>`;
  }).join('');
  const next = S.role === 'host'
    ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>`
    : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`;
  return `${ui.header()}${ui.lost()}
    <section class="card over action rg-over"><div class="trophy" aria-hidden="true">${iWon ? '🏆' : '🎲'}</div><h1>${title}</h1>
      <p class="big center">${reason}</p>
      <table class="rg-res"><thead><tr><th scope="col">Name</th><th scope="col">Rest-<br>punkte</th><th scope="col">Diese<br>Runde</th><th scope="col">Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="center"><b>${leadText}</b></p>
      ${next}<button class="btn ghost" data-act="leave-now">Spiel beenden</button></section>
    ${tableHtml(g, g.table, false)}`;
}

function gameHtml() {
  const g = S.game;
  if (!g || g.game !== 'rg') return '';
  return g.phase === 'over' ? overHtml(g) : playHtml(g);
}

// ====================== Hilfe ======================
function helpBody() {
  return `
    <p><b>Ziel:</b> Lege alle Steine aus deiner Hand auf den Tisch. Dafür ordnest du sie zu Sätzen. Das Spiel ist für 2 bis 4 Personen, auch gegen den Computer.</p>
    <h3>Die Steine</h3>
    <p>Es gibt Steine mit den Zahlen 1 bis 13 in vier Farben: <b>Rot ●</b> (Kreis), <b>Blau ■</b> (Quadrat), <b>Gelb ▲</b> (Dreieck) und <b>Grün ◆</b> (Raute). Die Farbe erkennst du auch am Zeichen im Stein. Zwei <b>Joker ★</b> ersetzen jeden beliebigen Stein. Du bekommst am Anfang 14 Steine.</p>
    <h3>Zwei Arten von Sätzen</h3>
    <ul>
      <li><b>Reihe:</b> 3 bis 13 Steine in einer Farbe mit Zahlen nacheinander, zum Beispiel Blau 4, 5, 6. Nach der 13 geht es nicht mit der 1 weiter.</li>
      <li><b>Gruppe:</b> 3 oder 4 Steine mit derselben Zahl, jede Farbe nur einmal, zum Beispiel Rot 9, Blau 9, Grün 9.</li>
      <li><b>Joker:</b> Er steht für einen fehlenden Stein. Ein Satz braucht aber mindestens einen echten Stein. Was der Joker vertritt, zeigt der Satz an („★ als 7“).</li>
    </ul>
    <h3>Dein Zug</h3>
    <p>Wenn du dran bist, tust du entweder das eine oder das andere:</p>
    <ul>
      <li><b>Legen:</b> Tippe Steine an. Sie werden markiert (Häkchen, blauer Rand). Mehrere Steine markierst du nacheinander. Dann tippe auf <b>Neuer Satz</b>, oder bei einem Satz auf dem Tisch auf <b>Hierhin legen</b>. Der Satz ordnet sich von selbst. Mindestens ein Stein muss neu aus deiner Hand kommen. Am Ende müssen <b>alle</b> Sätze auf dem Tisch gültig sein. Dann tippe auf <b>Legen</b>.</li>
      <li><b>Ziehen:</b> Tippe auf <b>Stein ziehen</b>. Du bekommst einen Stein vom Stapel, und der Nächste ist dran. Das geht nur, wenn du in diesem Zug noch nichts gelegt hast. Ist der Stapel leer, heißt der Knopf <b>Passen</b>.</li>
    </ul>
    <h3>Die Eröffnung</h3>
    <p>Dein erster Legezug heißt Eröffnung. Du darfst dabei nur <b>neue Sätze aus deiner Hand</b> legen, die zusammen mindestens <b>30 Punkte</b> haben. Jeder Stein zählt so viel wie seine Zahl, ein Joker so viel wie der Stein, den er vertritt. Unter dem Tisch siehst du, wie viele Punkte es gerade sind. Die Sätze auf dem Tisch darfst du erst nach deiner Eröffnung anfassen.</p>
    <h3>Umlegen auf dem Tisch</h3>
    <p>Nach deiner Eröffnung darfst du Sätze auf dem Tisch verändern: Steine anlegen, Sätze teilen, auflösen oder Steine in einen anderen Satz legen. Kein Stein darf den Tisch verlassen. Zwischenschritte dürfen ungültig sein. Zum Legen müssen am Ende alle Sätze gültig sein.</p>
    <ul>
      <li><b>Satz teilen:</b> Markiere einen Stein im Satz. Der Satz wird direkt vor diesem Stein in zwei Teile geteilt.</li>
      <li><b>Satz auflösen:</b> Markiere einen Stein im Satz. Alle Steine des Satzes werden markiert, damit du sie neu legen kannst.</li>
      <li><b>Zurück in die Hand:</b> Markierte Steine, die du in diesem Zug aus der Hand gelegt hast, nimmst du zurück.</li>
      <li><b>Alles zurücksetzen:</b> Dein ganzer Zug wird rückgängig gemacht.</li>
    </ul>
    <h3>Die Prüfung beim Legen</h3>
    <p>Das Spiel prüft jeden Satz sofort. Ein Satz mit rotem Rand ist noch nicht gültig, darunter steht der Grund. „Legen“ geht erst, wenn alles gültig ist. Grün umrandete Steine hast du in diesem Zug gelegt, orange umrandete wurden zuletzt gelegt, ein violetter Rand zeigt deinen gerade gezogenen Stein.</p>
    <h3>Ende der Runde und Punkte</h3>
    <ul>
      <li>Die Runde endet, wenn jemand alle Steine gelegt hat. Oder wenn der Stapel leer ist und alle hintereinander passen.</li>
      <li>Jeder Rest-Stein in der Hand zählt als Minuspunkte: so viel wie seine Zahl, der Joker 30.</li>
      <li>Wer alle Steine gelegt hat, bekommt die Reststeine der anderen als Pluspunkte. Die anderen verlieren ihre Reststeine.</li>
      <li>Sind alle blockiert, gewinnt, wer am wenigsten Reststeine hat. Bei Gleichstand teilen sich die Gewinner die Punkte.</li>
      <li>Nach jeder Runde tippt der Gastgeber auf „Nächste Runde“. Die Gesamtpunkte siehst du in der Tabelle. Mit „Spiel beenden“ hörst du auf, wann du möchtest.</li>
    </ul>
    <p class="muted">Keine Sorge: Das Programm achtet selbst darauf, dass nur gültige Züge gelegt werden können.</p>
`;
}

// ====================== Bedienung ======================
const send = (m) => sess.send(m);
function update(r) {
  const g = S.game;
  if (!r.ok) { S.ui.hint = r.hint; return render(); }
  S.ui.hint = '';
  S.ui.work = r.table;
  S.ui.sel = r.sel || [];
  S.ui.focus = r.focus === undefined ? null : r.focus;
  return render();
}
const guard = () => { const g = S.game; return g && g.game === 'rg' && myTurn(g) && S.ui.work ? g : null; };

function tapTile(id) {
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
  title: 'Reihen & Gruppen', icon: '🔢', sub: 'Zahlensteine zu Reihen und Gruppen legen – für 2 bis 4 Personen',
  helpTitle: 'Die Spielregeln von Reihen & Gruppen', helpBody: helpBody(),
  minPlayers: 2,
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'sort': S.ui.sort = el.dataset.by === 'zahl' ? 'zahl' : 'farbe'; sess.set('rg_sort', S.ui.sort); return render();
      case 'next': return g && S.role === 'host' && g.phase === 'over' ? send({ t: 'next' }) : undefined;
      case 'tile': return tapTile(Number(el.dataset.id));
      case 'here': { const x = guard(); return x && update({ ...W.attach(x, cid, S.ui.work, Number(el.dataset.i), S.ui.sel), focus: S.ui.sel[0] }); }
      case 'newset': { const x = guard(); if (!x) return undefined; return update({ ...W.newSet(x, cid, S.ui.work, S.ui.sel), focus: S.ui.sel[0] }); }
      case 'back': { const x = guard(); return x && update(W.putBack(x, S.ui.work, S.ui.sel)); }
      case 'split': { const x = guard(); return x && update({ ...W.splitAt(x, cid, S.ui.work, S.ui.sel), focus: S.ui.sel[0] }); }
      case 'dissolve': { const x = guard(); return x && update(W.dissolve(x, cid, S.ui.work, S.ui.sel)); }
      case 'reset': { const x = guard(); if (!x) return undefined; S.ui.hint = ''; return update({ ok: true, table: W.cloneTable(x.table), sel: [] }); }
      case 'play': {
        const x = guard();
        if (!x) return undefined;
        const c = E.checkTurn(x, cid, S.ui.work);
        if (!c.ok) { S.ui.hint = c.error; return render(); }
        S.ui.sel = []; S.ui.hint = '';
        return send({ t: 'play', table: c.table });
      }
      case 'draw': {
        const x = guard();
        if (!x) return undefined;
        if (W.placedIds(x, S.ui.work).length) { S.ui.hint = 'Du hast schon gelegt. Tippe erst auf „Alles zurücksetzen“, dann kannst du ziehen.'; return render(); }
        S.ui.sel = []; S.ui.hint = '';
        return send({ t: 'draw' });
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
    // Der eben veränderte Satz (und seine Fehlerzeile) soll sichtbar sein
    const set = S.ui.focus != null ? t.querySelector(`[data-id="${S.ui.focus}"]`)?.closest('.rg-set') : null;
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
