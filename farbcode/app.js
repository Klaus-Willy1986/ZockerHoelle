import * as F from './engine.js';
import { createSession } from '../session.js';
import { createUI, esc } from '../ui.js';
import { chooseAction } from './ai.js';
import { coach } from './tutorial.js';

const $app = document.getElementById('app');
const emptyRow = () => Array(F.CODE_LEN).fill(null);
const freshUi = () => ({ cur: emptyRow(), sel: null, sig: '' });

const sess = createSession({
  game: 'fc',
  maxPlayers: 2,
  newGame: (players) => { S.ui.cur = emptyRow(); S.ui.sel = null; S.ui.sig = ''; return F.createGame(players, Math.random); },
  onMessage: (state, pid, msg) => { F.handle(state, pid, msg); },
  render: () => render(),
  onState: () => onStateChanged(),
  onLeave: () => { S.ui = freshUi(); },
  bot: {
    delay: 900,
    // Der Computer rät, sobald der Code feststeht.
    step: (g, level) => {
      if (!g || g.mode !== 'guess') return null;
      const gp = F.guesserPlayer(g);
      if (!gp || !F.isBotId(gp.id)) return null;
      const msg = chooseAction(g, gp.id, level, Math.random);
      return msg ? { id: gp.id, msg } : null;
    },
  },
});
const S = sess.S;
const cid = sess.cid;
S.ui = freshUi();

// ====================== Zustandswechsel ======================
function onStateChanged() {
  const g = S.game;
  if (g) {
    const sig = `${g.round}|${g.mode}|${g.guesses.length}`;
    if (sig !== S.ui.sig) { S.ui.sig = sig; S.ui.cur = emptyRow(); S.ui.sel = null; }
  }
  render();
}

// ====================== Rollen ======================
const amSetter = (g) => g.setter >= 0 && g.players[g.setter].id === cid;
const amGuesser = (g) => g.players[g.guesser].id === cid;
const nameOf = (p) => (F.isBotId(p.id) ? 'Der Computer' : p.name);

// ====================== Darstellung ======================
const info = (c) => F.COLOR_INFO[c];
function peg(c, cls = '') {
  if (c === null || c === undefined) return `<span class="fc-peg empty ${cls}"></span>`;
  return `<span class="fc-peg c${c} ${cls}" role="img" aria-label="${info(c).name}"><b>${info(c).letter}</b></span>`;
}
const hiddenPeg = () => `<span class="fc-peg hid" role="img" aria-label="verdeckt"><b>?</b></span>`;

// Antippbare Stifte der Zeile, die gerade gefüllt wird
function slotButtons() {
  return S.ui.cur.map((c, i) => {
    const sel = S.ui.sel === i;
    const label = c === null ? `Feld ${i + 1}: leer` : `Feld ${i + 1}: ${info(c).name}, antippen zum Ersetzen`;
    return `<button class="fc-slot${sel ? ' sel' : ''}" data-act="slot" data-i="${i}" aria-pressed="${sel}" aria-label="${label}">${peg(c)}</button>`;
  }).join('');
}

function fbPegs(b, w) {
  const kinds = [...Array(b).fill('k'), ...Array(w).fill('w'), ...Array(F.CODE_LEN - b - w).fill('e')];
  return `<span class="fc-fb" role="img" aria-label="Auswertung: ${F.feedbackText(b, w)}">${kinds.map((k) => `<i class="${k}"></i>`).join('')}</span>`;
}
function fbText(b, w) {
  if (b === F.CODE_LEN) return '<span class="fc-fbt win">alles richtig!</span>';
  if (!b && !w) return '<span class="fc-fbt"><span>nichts stimmt</span></span>';
  return `<span class="fc-fbt">${b ? `<span>${b} richtig</span>` : ''}${w ? `<span>${w === 1 ? '1 Farbe stimmt' : w + ' Farben stimmen'}</span>` : ''}</span>`;
}

function codeRowHtml(g) {
  const mine = amSetter(g);
  let pegs; let label;
  if (g.mode === 'code') {
    if (mine) { pegs = slotButtons(); label = 'Dein Code'; } else { pegs = Array(F.CODE_LEN).fill(hiddenPeg()).join(''); label = 'Geheimer Code'; }
  } else if (F.codeRevealed(g) || mine) {
    pegs = g.code.map((c) => peg(c)).join('');
    label = F.codeRevealed(g) ? 'Der Code war' : 'Dein Code';
  } else {
    pegs = Array(F.CODE_LEN).fill(hiddenPeg()).join('');
    label = 'Geheimer Code';
  }
  return `<div class="fc-row fc-coderow"><span class="fc-no" aria-hidden="true">🔒</span><span class="fc-pegs">${pegs}</span><span class="fc-fb none"></span><span class="fc-fbt lbl">${label}</span></div>`;
}

function boardHtml(g) {
  const n = g.guesses.length;
  const guessing = g.mode === 'guess';
  const rows = [];
  for (let i = 0; i < F.MAX_TRIES; i++) {
    if (i < n) {
      const x = g.guesses[i];
      rows.push(`<div class="fc-row done"><span class="fc-no">${i + 1}</span><span class="fc-pegs">${x.g.map((c) => peg(c)).join('')}</span>${fbPegs(x.b, x.w)}${fbText(x.b, x.w)}</div>`);
    } else if (i === n && guessing) {
      const pegs = amGuesser(g) ? slotButtons() : Array(F.CODE_LEN).fill(peg(null)).join('');
      rows.push(`<div class="fc-row now"><span class="fc-no">${i + 1}</span><span class="fc-pegs">${pegs}</span>${fbPegs(0, 0)}<span class="fc-fbt"></span></div>`);
    } else {
      rows.push(`<div class="fc-row"><span class="fc-no">${i + 1}</span><span class="fc-pegs">${Array(F.CODE_LEN).fill(peg(null)).join('')}</span>${fbPegs(0, 0)}<span class="fc-fbt"></span></div>`);
    }
  }
  const round = g.rounds > 1 ? `<p class="fc-status">Runde ${g.round} von ${g.rounds}</p>` : '';
  return `<section class="card fc-boardcard">${round}
    <div id="board" class="fc-board">${codeRowHtml(g)}<div class="fc-sep" aria-hidden="true"></div>${rows.join('')}</div>
    <p class="fc-legend"><span class="fc-fb"><i class="k"></i></span> schwarz: richtige Farbe, richtiger Platz &nbsp; <span class="fc-fb"><i class="w"></i></span> weiß: Farbe stimmt, Platz nicht</p></section>`;
}

function bannerHtml(g) {
  const n = g.guesses.length + 1;
  if (g.mode === 'over') {
    const o = F.outcome(g);
    if (o.kind === 'duo') return `<div class="banner done">${o.draw ? 'Unentschieden!' : (o.winner === cid ? 'Du hast gewonnen!' : 'Das Spiel ist zu Ende')}</div>`;
    return `<div class="banner done">${g.solved ? 'Code geknackt!' : 'Nicht geknackt'}</div>`;
  }
  if (g.mode === 'between') return `<div class="banner done">Runde ${g.round} ist zu Ende</div>`;
  if (g.mode === 'code') {
    if (amSetter(g)) return `<div class="banner mine">Denke dir einen Code aus</div>`;
    return `<div class="banner">${esc(nameOf(g.players[g.setter]))} denkt sich einen Code aus</div>`;
  }
  const gp = g.players[g.guesser];
  if (gp.id === cid) return `<div class="banner mine">Du rätst – Versuch ${n} von ${F.MAX_TRIES}</div>`;
  return `<div class="banner">${esc(nameOf(gp))} rät – Versuch ${n} von ${F.MAX_TRIES}</div>`;
}

// Eingabe: Farbleiste, Rückgängig, Zeile leeren, Abgeben
function entryHtml(g) {
  const coding = g.mode === 'code' && amSetter(g);
  const guessing = g.mode === 'guess' && amGuesser(g);
  const full = S.ui.cur.every((c) => c !== null);
  const rep = S.ui.sel !== null ? `Feld ${S.ui.sel + 1}: neue Farbe antippen.` : null;
  const hint = rep || (coding
    ? (full ? 'Dein Code steht. Jetzt festlegen.' : 'Wähle deinen geheimen Code.')
    : (full ? 'Alle Felder voll. Jetzt abgeben.' : 'Tippe auf eine Farbe.'));
  if (!coding && !guessing) {
    let w;
    if (g.mode === 'code') w = 'Gleich geht es los. Die andere Person denkt sich gerade einen Code aus.';
    else if (g.mode === 'guess' && F.isBotId(g.players[g.guesser].id)) w = 'Der Computer überlegt und rät. Du musst nichts tun. Das Spiel wertet jeden Versuch automatisch aus.';
    else if (g.mode === 'guess') w = 'Dein Code steht fest. Die andere Person rät jetzt. Bitte einen Moment Geduld.';
    else w = '';
    return `<section class="card action fc-entry fc-wait"><p class="big center">${w}</p></section>`;
  }
  const pal = F.COLOR_INFO.map((c) => `<button class="fc-pal" data-act="color" data-c="${c.id}" aria-label="${c.name}">${peg(c.id)}<span>${c.name}</span></button>`).join('');
  const main = coding
    ? `<button class="btn primary fc-go" data-act="setcode" ${full ? '' : 'disabled'}>🔒 Code festlegen</button>`
    : `<button class="btn primary fc-go" data-act="submit" ${full ? '' : 'disabled'}>Versuch abgeben</button>`;
  return `<section class="card action fc-entry"><p class="big fc-hint">${hint}</p>
    <div class="fc-palette" role="group" aria-label="Farben">${pal}</div>
    <div class="fc-tools"><button class="btn secondary" data-act="undo">↶ Rückgängig</button><button class="btn secondary" data-act="clear">Zeile leeren</button>${main}</div></section>`;
}

let soloKey = ''; let soloInfo = null;
function soloResult(g) {
  const key = JSON.stringify([g.code, g.guesses]);
  if (soloKey !== key) {
    soloKey = key;
    const prev = sess.get('fc_best', null);
    const tries = g.guesses.length;
    const record = g.solved && (prev === null || tries < prev);
    soloInfo = { tries, prev, record };
    if (record) sess.set('fc_best', tries);
  }
  return soloInfo;
}

function againHtml() {
  if (S.role === 'host') return `<button class="btn primary huge" data-act="again">🔐 Noch eine Runde spielen</button>`;
  return `<p class="muted center">Der Gastgeber kann ein neues Spiel starten. Du bleibst einfach auf dieser Seite.</p>`;
}

function resultHtml(g) {
  if (g.mode === 'between') {
    const r = g.results[g.results.length - 1];
    const gp = g.players.find((p) => p.id === r.guesser);
    const text = r.solved
      ? `<b>${esc(nameOf(gp))}</b>${gp.id === cid ? ' (du)' : ''} hat den Code in <b>${r.tries} ${r.tries === 1 ? 'Versuch' : 'Versuchen'}</b> geknackt.`
      : `<b>${esc(nameOf(gp))}</b>${gp.id === cid ? ' (du)' : ''} hat den Code in ${F.MAX_TRIES} Versuchen nicht geknackt.`;
    const nxt = amGuesser(g) ? 'Du legst dann den Code fest.' : 'Du rätst dann.';
    return `<section class="card over fc-result"><p class="big center">${text}</p>
      <p class="center">In Runde 2 tauscht ihr die Rollen. ${nxt}</p>
      <button class="btn primary huge" data-act="next">Weiter zu Runde 2</button></section>`;
  }
  const o = F.outcome(g);
  if (o.kind === 'solo') {
    const r = soloResult(g);
    return `<section class="card over fc-result"><div class="trophy">${g.solved ? (r.record ? '🏆' : '👏') : '🔐'}</div>
      <h1>${g.solved ? `Geknackt in ${r.tries} ${r.tries === 1 ? 'Versuch' : 'Versuchen'}!` : 'Leider nicht geknackt.'}</h1>
      <p class="center big">${g.solved ? (r.record ? 'Neue Bestleistung! 🎉' : `Deine Bestleistung: <b>${r.prev} ${r.prev === 1 ? 'Versuch' : 'Versuche'}</b>`) : `Der Code steht oben. ${r.prev ? `Deine Bestleistung: <b>${r.prev} Versuche</b>.` : ''}`}</p>
      <button class="btn primary huge" data-act="again">🔐 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  }
  if (o.kind === 'bot') {
    const title = o.solved ? `Der Computer hat deinen Code in ${o.tries} ${o.tries === 1 ? 'Versuch' : 'Versuchen'} geknackt.` : `Du hast gewonnen! Der Computer hat deinen Code in ${F.MAX_TRIES} Versuchen nicht geknackt.`;
    return `<section class="card over fc-result"><div class="trophy">${o.solved ? '🤖' : '🏆'}</div><h1>${title}</h1>
      <button class="btn primary huge" data-act="again">🔐 Noch eine Runde spielen</button>
      <button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
  }
  const win = o.draw ? 'Unentschieden!' : `${esc(g.players.find((p) => p.id === o.winner).name)} hat gewonnen!`;
  const rows = g.results.map((r, i) => {
    const gp = g.players.find((p) => p.id === r.guesser);
    return `<li class="${o.winner === gp.id ? 'win' : ''}"><span class="rn">${esc(gp.name)}${gp.id === cid ? ' (du)' : ''}<small>Runde ${i + 1}: ${r.solved ? `${r.tries} ${r.tries === 1 ? 'Versuch' : 'Versuche'}` : 'nicht geknackt'}</small></span><span class="rt">${r.solved ? r.tries : '–'}</span></li>`;
  }).join('');
  return `<section class="card over fc-result"><div class="trophy">🏆</div><h1>${win}</h1>
    <p class="center muted">Es gewinnt, wer weniger Versuche gebraucht hat.</p><ul class="fc-res">${rows}</ul>
    ${againHtml()}<button class="btn ghost" data-act="leave-now">Zurück zum Anfang</button></section>`;
}

function gameHtml() {
  const g = S.game;
  const finished = g.mode === 'over' || g.mode === 'between';
  return `${ui.header()}${ui.lost()}${bannerHtml(g)}${boardHtml(g)}${finished ? resultHtml(g) : entryHtml(g)}`;
}

function helpBody() {
  return `
    <p><b>Ziel:</b> Einen geheimen Code aus 4 Farbstiften herausfinden. Du hast dafür 10 Versuche.</p>
    <h3>Der Code</h3>
    <p>Es gibt 6 Farben: Rot, Orange, Gelb, Grün, Blau und Violett. Jede Farbe hat auch einen Buchstaben (R, O, Y, G, B, V). Der Code besteht aus 4 Stiften nebeneinander. Eine Farbe darf im Code mehrmals vorkommen.</p>
    <h3>Dein Versuch</h3>
    <ol>
      <li>Tippe unten auf eine Farbe. Sie kommt ins nächste freie Feld der Zeile. So füllst du alle 4 Felder von links nach rechts.</li>
      <li>Ein Feld ersetzen: Tippe das Feld an und dann auf die neue Farbe. Mit „Rückgängig“ nimmst du den letzten Stift weg, mit „Zeile leeren“ alle.</li>
      <li>Tippe auf „Versuch abgeben“. Das geht erst, wenn alle 4 Felder gefüllt sind.</li>
    </ol>
    <h3>Die Auswertung</h3>
    <p>Neben deiner Zeile erscheinen kleine Stifte. Das Spiel rechnet sie für dich aus:</p>
    <ul>
      <li><b>Schwarzer Stift:</b> Eine Farbe ist richtig und steht am richtigen Platz.</li>
      <li><b>Weißer Stift:</b> Die Farbe kommt im Code vor, steht aber an einem anderen Platz.</li>
      <li>Die Stifte sagen nicht, welcher Platz gemeint ist. Ihre Reihenfolge hat keine Bedeutung.</li>
    </ul>
    <p>Daneben steht es auch in Worten, zum Beispiel „2 richtig, 1 Farbe stimmt“.</p>
    <p><b>Beispiel:</b> Der Code ist Rot, Blau, Blau, Grün. Dein Versuch ist Rot, Grün, Blau, Gelb. Rot an Platz 1 und Blau an Platz 3 sind richtig, das sind 2 schwarze Stifte. Grün kommt im Code vor, aber an Platz 4, das ist 1 weißer Stift. Gelb kommt nicht vor. Ergebnis: „2 richtig, 1 Farbe stimmt“.</p>
    <p>Jeder Stift im Code zählt nur einmal. Setzt du eine Farbe öfter, als sie im Code vorkommt, werden die überzähligen nicht gezählt.</p>
    <h3>Spielende</h3>
    <p>Hast du alle 4 Stifte richtig (4 schwarze Stifte), ist der Code geknackt. Nach 10 Versuchen ohne Erfolg wird der Code aufgedeckt.</p>
    <h3>Die Spielarten</h3>
    <ul>
      <li><b>Allein spielen:</b> Der Computer denkt sich einen Code aus, du rätst. Je weniger Versuche, desto besser. Deine Bestleistung wird gemerkt.</li>
      <li><b>Gegen den Computer:</b> Du denkst dir einen Code aus, der Computer rät. Schafft er es in 10 Versuchen nicht, hast du gewonnen.</li>
      <li><b>Zu zweit:</b> In Runde 1 legt eine Person den Code fest und die andere rät. In Runde 2 tauscht ihr die Rollen. Wer weniger Versuche gebraucht hat, gewinnt. Nicht geknackt zählt als schlechtestes Ergebnis.</li>
    </ul>
    <p class="muted">Zu zweit: Den geheimen Code sieht nur, wer ihn festgelegt hat. Das Spiel wertet alles automatisch aus, du musst nichts selbst nachrechnen.</p>
`;
}

// ====================== Bedienung ======================
function addColor(c) {
  const cur = S.ui.cur;
  if (S.ui.sel !== null) { cur[S.ui.sel] = c; S.ui.sel = null; return; }
  const i = cur.indexOf(null);
  if (i >= 0) cur[i] = c;
}

const ui = createUI({
  solo: true, soloText: 'Der Computer denkt sich einen Code aus, du rätst. Versuche, mit möglichst wenigen Versuchen zu gewinnen.',
  sess, $app,
  title: 'Farbcode knacken', icon: '🔐', sub: 'Rätselspiel mit Farben – allein oder zu zweit',
  helpTitle: 'Die Spielregeln von Farbcode knacken', helpBody: helpBody(),
  renderGame: () => gameHtml(),
  bots: [1], levels: ['Leicht', 'Mittel'],
  tutorial: { bots: 0, coach },
  onAct: (act, el) => {
    const g = S.game;
    if (!g) return;
    switch (act) {
      case 'color': addColor(Number(el.dataset.c)); return render();
      case 'slot': { const i = Number(el.dataset.i); S.ui.sel = S.ui.sel === i ? null : i; return render(); }
      case 'undo': {
        if (S.ui.sel !== null) { S.ui.cur[S.ui.sel] = null; S.ui.sel = null; return render(); }
        for (let i = F.CODE_LEN - 1; i >= 0; i--) if (S.ui.cur[i] !== null) { S.ui.cur[i] = null; break; }
        return render();
      }
      case 'clear': S.ui.cur = emptyRow(); S.ui.sel = null; return render();
      case 'submit': {
        if (!F.isValidCode(S.ui.cur)) return;
        const msg = { t: 'guess', g: S.ui.cur.slice(), n: g.guesses.length };
        S.ui.cur = emptyRow();
        return sess.send(msg);
      }
      case 'setcode': {
        if (!F.isValidCode(S.ui.cur)) return;
        const msg = { t: 'code', code: S.ui.cur.slice() };
        S.ui.cur = emptyRow();
        return sess.send(msg);
      }
      case 'next': return sess.send({ t: 'next' });
    }
  },
});
function render() { ui.render(); }
ui.boot();
