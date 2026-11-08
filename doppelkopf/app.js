import * as M from './engine.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';

const $app = document.getElementById('app');

const OPTIONS = [
  { id: 'hints', label: 'Spielbare Karten anzeigen', help: 'Zeigt dir, welche Karten du gerade spielen darfst. Ohne diese Hilfe musst du selbst schauen, was erlaubt ist.', def: false },
  { id: 'wedding', label: 'Hochzeit spielen', help: 'Wer beide Kreuz-Damen hat, sucht sich eine Partnerin oder einen Partner: die erste andere Person, die bis zum 3. Stich einen Stich gewinnt. Ohne Häkchen spielt diese Person gleich allein gegen alle.', def: true },
  { id: 'short', label: 'Kurzspiel (nur 3 Runden)', help: 'Das Spiel ist nach 3 Runden zu Ende. Sonst sind es 6 Runden.', def: false },
];

// Nur für Tests: ?rounds=1 verkürzt das Spiel
const urlRounds = () => {
  const n = Number(new URLSearchParams(location.search).get('rounds'));
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 0;
};
const LEARN_ROUNDS = 2;
const ONLINE_BOT_LEVEL = 1; // Computer, die online fehlende Plätze füllen: Mittel
const isBot = (id) => String(id).startsWith('bot');

const freshUi = () => ({ note: null });

// Fehlende Plätze mit Computern auffüllen (Alleinspiel: ein Mensch + n Computer; online: 2–4 Menschen)
function seatPlayers(players) {
  const ps = players.slice(0, M.NP).map((p) => ({ id: p.id, name: p.name }));
  const humans = ps.filter((p) => !isBot(p.id));
  const hasBots = ps.some((p) => isBot(p.id));
  let n = ps.filter((p) => isBot(p.id)).length;
  const fill = [];
  while (ps.length + fill.length < M.NP) { n += 1; fill.push({ id: 'bot' + n, name: 'Computer ' + n }); }
  if (!hasBots && humans.length === 2 && fill.length === 2) return [ps[0], fill[0], ps[1], fill[1]]; // Computer sitzen zwischen den Menschen
  return ps.concat(fill);
}

const sess = createSession({
  game: 'dk',
  maxPlayers: 4,
  options: OPTIONS,
  newGame: (players, opts) => {
    S.ui = { ...S.ui, ...freshUi() };
    const o = { hints: !!opts.hints || !!S.learn, wedding: opts.wedding === undefined ? true : !!opts.wedding, rounds: urlRounds() || (opts.short ? 3 : M.DEFAULT_ROUNDS) };
    if (S.learn) { o.rounds = LEARN_ROUNDS; o.dealer = 3; } // Lernrunde: Du bist Vorhand und spielst aus
    return M.createGame(seatPlayers(players), o, Math.random, sess.cid);
  },
  onMessage: (state, pid, msg) => {
    if (msg && msg.t === 'botstep') { // Computer-Zug online (nur vom Gastgeber ausgelöst)
      if (pid !== state.hostId || state.phase !== 'play') return;
      const ap = M.activePlayer(state);
      if (!ap || !isBot(ap.id)) return;
      const m = chooseAction(state, ap.id, ONLINE_BOT_LEVEL, Math.random);
      if (m) M.handle(state, ap.id, m, Math.random);
      return;
    }
    M.handle(state, pid, msg, Math.random);
  },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = { ...S.ui, ...freshUi() }; clearTimeout(onlineBotTimer); },
  bot: {
    delay: 900,
    step: (g, level) => {
      if (!g || g.phase !== 'play') return null;
      const ap = M.activePlayer(g);
      if (!ap || !isBot(ap.id)) return null;
      const msg = chooseAction(g, ap.id, level, Math.random);
      return msg ? { id: ap.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = { ...freshUi() };

const myIdx = () => (S.game ? S.game.players.findIndex((p) => p.id === cid) : -1);
const hintsOn = (g) => !!g.opts.hints || !!S.learn;

// Online (kein Alleinspiel): Der Gastgeber lässt die Computer nacheinander ziehen
let onlineBotTimer = null;
function scheduleOnlineBots() {
  clearTimeout(onlineBotTimer);
  const g = S.game;
  if (!g || S.role !== 'host' || S.room === 'SOLO' || g.phase !== 'play') return;
  const ap = M.activePlayer(g);
  if (!ap || !isBot(ap.id)) return;
  onlineBotTimer = setTimeout(() => { if (S.game && S.role === 'host') sess.send({ t: 'botstep' }); }, 900);
}

function onStateChanged() {
  S.ui.note = null;
  render();
  scheduleOnlineBots();
}

// ====================== Darstellung ======================
const LABELED = new Set([M.RJ, M.RQ, M.RK, M.RA]); // Bube, Dame, König, Ass bekommen ein Wort
function faceHtml(id, { cls = '', tag = 'div', attrs = '', verb = '' } = {}) {
  const su = M.SUITS[M.cardSuit(id)];
  const rk = M.RANKS[M.cardRank(id)];
  const name = M.cardName(id);
  const word = LABELED.has(M.cardRank(id)) ? `<span class="nm">${rk.name}</span>` : '';
  const type = tag === 'button' ? ' type="button"' : '';
  const tr = M.isTrump(id) ? ' trump' : '';
  return `<${tag}${type} class="dk-card face${su.red ? ' red' : ''}${tr}${cls ? ' ' + cls : ''}" data-c="${id}" title="${name}" aria-label="${name}${M.isTrump(id) ? ', Trumpf' : ''}${verb}" ${attrs}>
    <span class="tl"><span class="rk">${rk.sym}</span><span class="ss" aria-hidden="true">${su.sym}</span></span>
    <span class="mid" aria-hidden="true">${su.sym}</span>${word}</${tag}>`;
}
const emptyHtml = () => '<span class="dk-card empty" aria-hidden="true"></span>';
const stichZahl = (n) => (n === 1 ? '1 Stich' : `${n} Stiche`);
const teamWord = (t) => (t === 're' ? 'Re' : 'Kontra');
const pts = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const punkte = (n) => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;

// Was weiß man öffentlich über die Person? Nur Bekanntes (Kreuz-Dame gespielt, Ansage, Hochzeit); in der Lernrunde für dich selbst immer.
function shownTeam(g, i) {
  const k = g.known[i];
  if (k) return k;
  if (S.learn && g.players[i].id === cid && g.phase === 'play') return g.team[i];
  return null;
}

function bannerHtml(g) {
  const mi = myIdx();
  if (g.phase === 'round_over') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  if (g.phase === 'over') return `<div class="banner done">Das Spiel ist zu Ende</div>`;
  const ap = g.players[g.turn];
  return g.turn === mi ? `<div class="banner mine">Du bist dran: spiele eine Karte aus</div>` : `<div class="banner">${esc(ap.name)} ist dran</div>`;
}

// Tischmitte: Kreuzform. Unten du, links die nächste Person (sie spielt nach dir), oben gegenüber, rechts die davor.
function tableHtml(g, mi) {
  const seats = { bottom: mi, left: (mi + 1) % 4, top: (mi + 2) % 4, right: (mi + 3) % 4 };
  const cur = g.trick.cards;
  const src = cur.length ? cur : (g.last ? g.last.cards : []);
  const past = !cur.length && !!g.last;
  const slot = (pos) => {
    const i = seats[pos];
    const p = g.players[i];
    const x = src.find((c) => c.pid === p.id);
    const team = shownTeam(g, i);
    const l = S.lobby.find((q) => q.id === p.id);
    const off = l && !l.connected ? ' (weg)' : '';
    const nm = i === mi ? 'Du' : p.name + off;
    const sub = [team ? teamWord(team) : '', i === mi ? '' : `${p.hand.length} Karten`].filter(Boolean).join(' · ') || ' ';
    const act = g.phase === 'play' && g.turn === i;
    return `<div class="dk-slot s-${pos}${act ? ' act' : ''}"><span class="lb"><b>${esc(nm)}</b><i>${esc(sub)}</i></span>${x ? faceHtml(x.card) : emptyHtml()}</div>`;
  };
  return `<div class="dk-table${past ? ' past' : ''}" aria-label="Der Stich in der Tischmitte">${slot('top')}${slot('left')}${slot('right')}${slot('bottom')}</div>`;
}

function infoHtml(g) {
  let line = '';
  if (g.trick.cards.length) line = 'Der Stich liegt aus';
  else if (g.last) {
    const w = g.players.find((p) => p.id === g.last.winner);
    line = `Letzter Stich: an ${w.id === cid ? 'dich' : esc(w.name)}`;
  } else line = `Runde ${g.round} von ${g.opts.rounds}`;
  return `<div class="dk-info"><span>${line}</span><span>Stich ${Math.min(M.TRICKS, g.tricksDone + 1)} von ${M.TRICKS}</span></div>`;
}

function handHtml(g, mi) {
  const me = g.players[mi];
  const myTurn = g.phase === 'play' && g.turn === mi;
  const legal = myTurn ? M.legalCards(g, cid) : [];
  const hints = hintsOn(g);
  const cards = me.hand.map((c) => {
    if (!myTurn) return faceHtml(c);
    const ok = legal.includes(c);
    return faceHtml(c, { cls: hints ? (ok ? 'can' : 'dim') : '', tag: 'button', attrs: 'data-act="card"', verb: ', ausspielen' });
  });
  return `<div class="dk-hand" role="group" aria-label="Deine Karten">${cards.join('')}</div>`;
}

function lineHtml(g, mi) {
  if (S.ui.note) return `<p class="big dk-line warn" role="alert">${esc(S.ui.note)}</p>`;
  const ap = g.players[g.turn];
  const w = g.wedding;
  let pre = '';
  if (w && w.state === 'open' && g.tricksDone === 0 && g.trick.cards.length === 0) {
    pre = w.player === mi ? 'Du hast beide Kreuz-Damen: Hochzeit! Wer bis zum 3. Stich einen Stich gewinnt, spielt mit dir. ' : `${esc(g.players[w.player].name)} hat Hochzeit (beide Kreuz-Damen). `;
  }
  if (g.turn !== mi) return `<p class="big dk-line">${pre}<b>${esc(ap.name)}</b> ist am Zug. Bitte einen Moment Geduld.</p>`;
  const led = g.trick.cards.length ? g.trick.cards[0].card : null;
  if (led === null) return `<p class="big dk-line">${pre}Du spielst aus. Tippe auf eine deiner Karten.</p>`;
  const grp = M.groupOf(led);
  const what = grp === 3 ? 'Trumpf' : `${M.SUITS[grp].sym} ${M.SUITS[grp].name}`;
  const legal = M.legalCards(g, cid);
  const hint = hintsOn(g) && legal.length < g.players[mi].hand.length ? ' Grün umrandet sind die erlaubten Karten.' : '';
  return `<p class="big dk-line">${esc(g.players[idxName(g, g.trick.cards[0].pid)].name)} hat <b>${what}</b> ausgespielt. Bediene diese Art, wenn du kannst.${hint}</p>`;
}
const idxName = (g, pid) => g.players.findIndex((p) => p.id === pid);

function announceHtml(g) {
  const can = M.canAnnounce(g, cid);
  if (!can) return '';
  return `<button type="button" class="btn secondary dk-ann" data-act="announce" data-what="${can}">📣 ${teamWord(can)} ansagen</button>
    <p class="muted small dk-annhelp">Vor deiner ersten Karte kannst du ${teamWord(can)} ansagen. Das verdoppelt den Spielwert der Runde, für Gewinn und Verlust.</p>`;
}

function boardHtml(g) {
  const mi = myIdx();
  return `<section class="card dk-board" id="board">${tableHtml(g, mi)}${infoHtml(g)}${handHtml(g, mi)}</section>`;
}

function scoreHtml(g) {
  const rows = M.ranking(g);
  return `<section class="card dk-score-card"><h2>Gesamtstand</h2>
    <table class="dk-score" aria-label="Gesamtstand nach ${g.round} Runden"><tbody>${rows.map((r) => `<tr class="${r.id === cid ? 'me' : ''}"><td class="rk">${r.rank}.</td><td class="nm">${r.id === cid ? 'Du' : esc(r.name)}</td><td class="n">${pts(r.score)}</td></tr>`).join('')}</tbody></table>
    <p class="muted small center">Runde ${g.round} von ${g.opts.rounds}. Wer am Ende die meisten Punkte hat, gewinnt.</p></section>`;
}

function recapHtml(g) {
  if (!g.recap || !g.recap.length) return '';
  return `<section class="card recap"><h3>Das ist zuletzt passiert</h3><ul>${g.recap.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function gameHtml() {
  const g = S.game;
  if (g.phase === 'round_over' || g.phase === 'over') return overHtml(g);
  const mi = myIdx();
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    ${boardHtml(g)}
    <section class="card action dk-act" aria-live="polite">${lineHtml(g, mi)}${announceHtml(g)}</section>
    ${scoreHtml(g)}${recapHtml(g)}`;
}

function teamBox(g, t) {
  const r = g.result;
  const mem = g.players.filter((p) => r.teams[p.id] === t);
  const aug = t === 're' ? r.reAugen : r.kontraAugen;
  const tricks = mem.reduce((s, p) => s + p.tricks, 0);
  const win = r.winner === t;
  return `<div class="dk-team${win ? ' win' : ''}" aria-label="${teamWord(t)}: ${mem.map((p) => (p.id === cid ? 'Du' : p.name)).join(' und ')}, ${stichZahl(tricks)}, ${aug} Augen">
    <div class="h">${teamWord(t)}${win ? ' – gewonnen' : ''}</div>
    <div class="who">${mem.map((p) => esc(p.id === cid ? 'Du' : p.name)).join(' · ')}</div>
    <div class="st"><span class="n">${aug}</span> Augen</div><div class="stk">${stichZahl(tricks)} gesammelt</div></div>`;
}

function overHtml(g) {
  const mi = myIdx();
  const me = g.players[mi];
  const r = g.result;
  const isHost = sess.S.role === 'host';
  const final = g.phase === 'over';
  const myTeam = r.teams[me.id];
  const iWon = r.winner === myTeam;
  const d = r.delta[me.id];
  const sp = r.special;
  const tags = r.lines.map((l) => l.label);
  const fx = (t) => sp[t].fuchs, dk = (t) => sp[t].doppelkopf, kl = (t) => sp[t].karlchen;
  for (const t of ['re', 'kontra']) {
    if (fx(t)) tags.push(`${teamWord(t)}: ${fx(t) === 1 ? 'Fuchs gefangen' : fx(t) + ' Füchse gefangen'}`);
    if (dk(t)) tags.push(`${teamWord(t)}: ${dk(t) === 1 ? 'Doppelkopf' : dk(t) + '× Doppelkopf'}`);
    if (kl(t)) tags.push(`${teamWord(t)}: Karlchen`);
  }
  if (r.announced.re) tags.push('Re angesagt');
  if (r.announced.kontra) tags.push('Kontra angesagt');
  let title;
  if (final) {
    const win = (r.winners || []).map((id) => g.players.find((p) => p.id === id));
    const others = win.filter((p) => p.id !== me.id).map((p) => esc(p.name));
    if (win.length === 1) title = win[0].id === me.id ? 'Du hast das Spiel gewonnen!' : `${esc(win[0].name)} hat das Spiel gewonnen!`;
    else if (win.some((p) => p.id === me.id)) title = `Du teilst dir den ersten Platz mit ${others.join(' und ')}!`;
    else title = `${others.join(' und ')} teilen sich den ersten Platz`;
  } else title = iWon ? `Deine Seite (${teamWord(myTeam)}) hat gewonnen!` : `${teamWord(r.winner)} hat gewonnen`;
  const icon = final ? ((r.winners || []).includes(me.id) ? '🏆' : '🃏') : (iWon ? '🏅' : '🃏');
  const head = final ? `<div class="trophy">${icon}</div>` : `<div class="medal">${icon}</div>`;
  const wAug = r.winner === 're' ? r.reAugen : r.kontraAugen;
  const lAug = r.winner === 're' ? r.kontraAugen : r.reAugen;
  const sumTxt = `${teamWord(r.winner)} gewinnt mit ${wAug} zu ${lAug} Augen. Spielwert: ${r.base}${r.mult > 1 ? ` mal ${r.mult} wegen der Ansage` : ''}${(sp.re.fuchs + sp.re.doppelkopf + sp.re.karlchen + sp.kontra.fuchs + sp.kontra.doppelkopf + sp.kontra.karlchen) ? ' plus Sonderpunkte' : ''}. Du warst ${teamWord(myTeam)} und ${d >= 0 ? 'bekommst' : 'verlierst'} ${punkte(d)}.`;
  const btns = final
    ? (isHost ? `<button class="btn primary huge" data-act="again">▶ Neues Spiel (Stand löschen)</button>` : `<p class="muted center">Der Gastgeber startet ein neues Spiel. Du bleibst einfach auf dieser Seite.</p>`)
    : (isHost ? `<button class="btn primary huge" data-act="next">▶ Nächste Runde</button>` : `<p class="muted center">Der Gastgeber startet die nächste Runde. Du bleibst einfach auf dieser Seite.</p>`);
  const rows = g.players.map((p) => `<tr class="${p.id === cid ? 'me' : ''}"><td class="nm">${esc(p.id === cid ? 'Du' : p.name)}</td><td>${teamWord(r.teams[p.id])}</td><td class="n">${pts(r.delta[p.id])}</td><td class="n">${pts(p.total)}</td></tr>`).join('');
  return `${headerHtml()}${lostHtml()}${bannerHtml(g)}
    <section class="card over dk-over">${head}
      <h1>${title}</h1>
      <div class="dk-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="dk-teams">${teamBox(g, 're')}${teamBox(g, 'kontra')}</div>
      ${r.alone ? '<p class="rows muted">Eine Person hat allein gegen alle gespielt: ihre Punkte zählen dreifach.</p>' : ''}
      <table class="dk-res" aria-label="Punkte dieser Runde und Gesamtstand"><thead><tr><th>Person</th><th>Seite</th><th>Runde</th><th>Gesamt</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="dk-btns">${btns}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></div></section>
    <section class="card action dk-sum"><p class="big">${esc(sumTxt)}</p></section>
    ${recapHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Doppelkopf</b> ist ein Stichspiel für <b>vier Personen</b>. Zwei Teams spielen gegeneinander. Wer in einem Team ist, steht erst nach und nach fest. Es gibt 12 Stiche pro Runde. Fehlen Mitspieler, spielen Computer mit.</p>
    <h3>Das Blatt</h3>
    <p>Gespielt wird mit 48 Karten: 9, 10, Bube, Dame, König und Ass in Kreuz ♣, Pik ♠, Herz ♥ und Karo ♦. Jede Karte gibt es zweimal. Jede Person bekommt 12 Karten.</p>
    <h3>Die Teams</h3>
    <ul>
      <li><b>Re</b> sind die zwei Personen, die je eine <b>Kreuz-Dame</b> haben. <b>Kontra</b> sind die anderen zwei.</li>
      <li>Du siehst an deiner Hand, zu wem du gehörst. Die anderen wissen es erst, wenn jemand die Kreuz-Dame ausspielt oder „Re“ beziehungsweise „Kontra“ ansagt.</li>
      <li><b>Hochzeit:</b> Hat eine Person beide Kreuz-Damen, wird das allen gesagt. Wer bis zum 3. Stich als Erste oder Erster einen Stich gewinnt, den die Hochzeits-Person nicht gewonnen hat, wird ihre Partnerin oder ihr Partner. Gelingt das niemandem, spielt sie allein gegen alle.</li>
    </ul>
    <h3>Trumpf</h3>
    <p>Diese Karten sind Trumpf (von hoch nach niedrig). Sie haben unten einen goldenen Streifen:</p>
    <ul>
      <li>Herz-10, genannt <b>Dulle</b>, die höchste Karte. Zwei Dullen im selben Stich: Die zuerst gespielte gewinnt, nur im letzten Stich gewinnt die zweite.</li>
      <li>Die vier <b>Damen</b>: Kreuz, Pik, Herz, Karo.</li>
      <li>Die vier <b>Buben</b>: Kreuz, Pik, Herz, Karo.</li>
      <li>Alle Karo-Karten: Ass, 10, König, 9. Das Karo-Ass heißt <b>Fuchs</b>.</li>
    </ul>
    <p>Alle anderen Karten sind <b>Fehlfarben</b> (Kreuz, Pik, Herz) mit der Reihenfolge Ass, 10, König, 9. Sind zwei Karten gleich, ist die zuerst gespielte höher.</p>
    <h3>Die Stiche</h3>
    <ul>
      <li>Die Person links vom Geber spielt aus. Danach geht es reihum.</li>
      <li><b>Bedienpflicht:</b> Wird Trumpf ausgespielt, musst du Trumpf zugeben. Wird eine Fehlfarbe ausgespielt, musst du dieselbe Fehlfarbe zugeben. Hast du das nicht, darfst du jede Karte spielen.</li>
      <li>Den Stich gewinnt der höchste Trumpf. Gibt es keinen Trumpf, gewinnt die höchste Karte der ausgespielten Farbe. Wer gewinnt, spielt als Nächste oder Nächster aus.</li>
    </ul>
    <h3>Augen</h3>
    <p>Ass 11, Zehn 10, König 4, Dame 3, Bube 2, Neun 0. Alle Karten zusammen haben 240 Augen. Die Augen siehst du erst nach der Runde. <b>Re gewinnt mit 121 Augen oder mehr</b>, Kontra gewinnt mit 120 oder mehr („gegen die Alten“).</p>
    <h3>Punkte</h3>
    <ul>
      <li>Gewonnen: 1 Punkt. Gewinnt Kontra: 1 Punkt mehr („gegen die Alten“).</li>
      <li>Hat die Verliererseite höchstens 89 Augen: „keine 90“, 1 Punkt mehr. Höchstens 59: „keine 60“, noch ein Punkt. Höchstens 29: „keine 30“, noch ein Punkt. Keine Augen: „schwarz“, noch ein Punkt.</li>
      <li><b>Sonderpunkte</b> bekommt die Seite, die sie schafft: Einen <b>Fuchs</b> der Gegenseite gefangen (1 Punkt je Fuchs), einen <b>Doppelkopf</b> (Stich mit 40 Augen oder mehr, 1 Punkt) und <b>Karlchen</b> (der Kreuz-Bube gewinnt den letzten Stich, 1 Punkt).</li>
      <li><b>Ansagen:</b> Vor deiner ersten Karte kannst du „Re“ oder „Kontra“ ansagen. Das verdoppelt den Spielwert, egal wer gewinnt.</li>
      <li>Jede Person der Gewinnerseite bekommt den Spielwert, jede der Verliererseite verliert ihn. Spielt eine Person allein gegen drei, zählt ihr Ergebnis dreifach.</li>
    </ul>
    <p>Nach den Runden (6, im Kurzspiel 3) gewinnt, wer die meisten Punkte hat. Mit „Nächste Runde“ geht es weiter, der Geber wechselt jedes Mal.</p>
    <p class="muted">Keine Sorge: Das Programm erlaubt nur gültige Karten und zählt alles selbst. Tippst du auf eine nicht erlaubte Karte, bekommst du einen freundlichen Hinweis.</p>
`;
}

// ====================== Bedienung ======================
const ui = createUI({
  sess, $app,
  bots: [1, 2, 3], levels: ['Leicht', 'Mittel'],
  options: OPTIONS,
  tutorial: { bots: 3, coach },
  title: 'Doppelkopf', icon: '🃏', sub: 'Das Kartenspiel für vier – online oder mit Computern',
  helpTitle: 'Die Spielregeln von Doppelkopf', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  onAct: (act, el) => {
    const g = S.game;
    switch (act) {
      case 'card': {
        if (!g) return undefined;
        const card = Number(el.dataset.c !== undefined ? el.dataset.c : el.getAttribute('data-c'));
        const legal = M.legalCards(g, cid);
        if (!legal.includes(card)) {
          const led = g.trick.cards.length ? g.trick.cards[0].card : null;
          const grp = led === null ? -1 : M.groupOf(led);
          S.ui.note = grp === 3
            ? 'Du musst bedienen: Bitte spiele einen Trumpf (Dulle, Dame, Bube oder Karo).'
            : `Du musst bedienen: Bitte spiele ${grp >= 0 ? M.SUITS[grp].sym + ' ' + M.SUITS[grp].name : 'die ausgespielte Farbe'} (ohne Dame, Bube und Dulle).`;
          return render();
        }
        return sess.send({ t: 'play', card });
      }
      case 'announce': return sess.send({ t: 'announce', what: el.dataset.what });
      case 'next': return sess.send({ t: 'next' });
      default: return undefined;
    }
  },
});
function render() { ui.render(); }
const headerHtml = () => ui.header();
const lostHtml = () => ui.lost();
ui.boot();
