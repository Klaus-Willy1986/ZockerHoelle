import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../schach/engine.js';
import { chooseAction } from '../schach/ai.js';
import { coach } from '../schach/tutorial.js';

const sq = C.sq;
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validSel = (s) => typeof s === 'string' && s.length > 0 && /^[\w\s.#\-\[\]="':>,*()~+]+$/.test(s);
const checkOut = (r) => {
  assert.ok(r === null || (typeof r === 'object' && typeof r.text === 'string'), 'null oder Objekt');
  if (!r) return;
  assert.ok(r.text.trim().length > 0 && r.text.length <= 160, 'Text: ' + r.text);
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(r.text), 'kein Emoji');
  assert.ok(!/(beste|bester|empfehl|Tipps?\b|Vorsicht|Achtung|Gefahr|droht|Falle|solltest|am besten|klug)/i.test(r.text), 'keine Strategie: ' + r.text);
  assert.ok(!/\b[a-h][1-8]\b/.test(r.text), 'keine Zugempfehlung mit Feldname: ' + r.text);
  if (r.target !== undefined) assert.ok(validSel(r.target), 'Selektor ' + r.target);
};
const mk = (players) => C.createGame(players, { hints: true });
const ME = 'me';

test('kaputte Eingaben werfen nie', () => {
  const ctx = { id: ME, ui: {} };
  for (const g of [null, undefined, {}, { players: null }, { players: [], board: [] }, { players: [{ id: ME }], board: [], mode: 'play', turn: 0 }, 5, 'x']) {
    for (const c of [ctx, null, {}, { id: ME }, { id: ME, ui: null }]) checkOut(coach(g, c));
  }
  const g = mk([{ id: ME, name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  checkOut(coach({ ...g, board: null }, ctx));
  checkOut(coach({ ...g, opts: undefined }, ctx));
  checkOut(coach({ ...g, board: g.board.slice(0, 10) }, { id: ME, ui: {} }));
  checkOut(coach(g, { id: ME, ui: { sel: 'kaputt', coachSeen: 7, coachTurn: 'x', promo: 5 } }));
  checkOut(coach(g, { id: ME, ui: { sel: 99 } }));
  checkOut(coach(g, { id: ME, ui: { sel: -3, coachSeen: null } }));
  assert.equal(coach(g, { id: 'fremd', ui: {} }), null);
});

const GENERIC = [/^Jetzt ist der Computer dran/, /^Du bist dran\. Tippe/, /^Tippe auf ein markiertes Feld/, /^Du stehst im Schach\. Tippe/, /^Wähle die neue Figur für deinen Bauern\.$/, /^Du hast Schach gesagt/, /Noch eine Runde/];
const TOPICS = [
  ['board', /^Das Brett hat 64 Felder/], ['goal', /^Ziel: den gegnerischen/], ['check', /^Schach! Dein König/], ['castle', /^Rochade:/], ['ep', /^Im Vorbeigehen schlagen/], ['promo', /^Umwandlung:/],
  ['capture', /^Schlagen:/], ['pawn', /^Der Bauer geht/], ['knight', /^Der Springer hüpft/], ['bishop', /^Der Läufer zieht/], ['rook', /^Der Turm zieht/],
  ['queen', /^Die Dame zieht/], ['king', /^Der König zieht ein Feld/], ['matt', /^Schachmatt:/], ['draw', /^Remis heißt unentschieden/],
];
const topicOf = (text) => { const t = TOPICS.find(([, re]) => re.test(text)); return t ? t[0] : null; };

// Spielt eine Partie Mensch (zufällig, mit Auswahl-Schritten) gegen Computer und prüft den Coach bei jedem Schritt.
function playLearn(seed, fen, humanFirst = true, maxPlies = 120) {
  const rnd = seeded(seed);
  const players = humanFirst ? [{ id: ME, name: 'A' }, { id: 'bot1', name: 'Computer' }] : [{ id: 'bot1', name: 'Computer' }, { id: ME, name: 'A' }];
  const g = mk(players);
  if (fen) C.setFen(g, fen);
  const ui = { sel: null };
  const ctx = { id: ME, ui };
  const sigsByTopic = {}; const seenTexts = new Set(); const sels = { pick: 0, sel: 0, promo: 0 };
  const note = (g2, text) => {
    const t = topicOf(text);
    if (!t) return;
    (sigsByTopic[t] || (sigsByTopic[t] = new Set())).add(`${g2.round}|${g2.moveNo}`);
    seenTexts.add(t);
  };
  let plies = 0;
  while (g.mode === 'play' && plies < maxPlies) {
    const mePi = g.players.findIndex((p) => p.id === ME);
    const myColor = mePi === g.white ? 0 : 1;
    if (g.turn === myColor) {
      const legal = C.legalMoves(g);
      // Phase 1: nichts ausgewählt (mehrfach gezeichnet)
      ui.sel = null; ui.promo = null;
      for (let k = 0; k < 2; k++) { const r = coach(g, ctx); checkOut(r); assert.ok(r && r.text && r.target, 'Mensch dran: Text und Ziel'); note(g, r.text); sels.pick++; }
      // Phase 2: Figur ausgewählt
      const m = legal[Math.floor(rnd() * legal.length)];
      ui.sel = m.from;
      const r2 = coach(g, ctx); checkOut(r2); assert.ok(r2.target); note(g, r2.text); sels.sel++;
      // Umwandlung: Auswahldialog
      if (m.promo) { ui.promo = { from: m.from, to: m.to }; const r3 = coach(g, ctx); checkOut(r3); assert.equal(r3.target, '[data-act="promo"]'); sels.promo++; ui.promo = null; }
      assert.ok(C.handle(g, ME, { t: 'move', from: m.from, to: m.to, promo: m.promo || undefined }).ok);
      ui.sel = null;
    } else {
      const r = coach(g, ctx); checkOut(r); assert.ok(r && /Computer|Schach gesagt/.test(r.text)); assert.equal(r.target, undefined);
      const a = chooseAction(g, 'bot1', 0, rnd);
      assert.ok(C.handle(g, 'bot1', a).ok);
    }
    plies++;
  }
  if (g.mode === 'over') { const r = coach(g, ctx); checkOut(r); assert.equal(r.target, '[data-act="next"]'); assert.match(r.text, /Noch eine Runde/); }
  return { sigsByTopic, seenTexts, g, sels };
}

test('Partien Mensch (zufällig) gegen Bot: Coach immer sinnvoll, jede Erklärung genau in einem Zug und nie wieder', () => {
  const all = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const { sigsByTopic, seenTexts } = playLearn(seed, null, seed % 2 === 1);
    for (const [t, sigs] of Object.entries(sigsByTopic)) assert.equal(sigs.size, 1, `Erklärung ${t} kam in ${sigs.size} Zügen (Seed ${seed})`);
    for (const t of seenTexts) all.add(t);
  }
  console.log('beobachtete Erklärungen in 40 Partien:', [...all].join(', '));
  for (const t of ['board', 'goal', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'capture', 'check', 'matt', 'draw']) assert.ok(all.has(t), 'nie gezeigt: ' + t);
});

test('Sonderfälle werden erklärt: Rochade, en passant, Umwandlung, Schach, Schlagen (je einmal)', () => {
  const cases = [
    ['castle', 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1'],
    ['ep', 'rnbqkbnr/ppp1pppp/8/4P3/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3'],
    ['promo', '7k/4P3/8/8/8/8/8/K7 w - - 0 1'],
    ['check', '4k3/8/8/8/8/8/4r3/R3K3 w - - 0 1'],
    ['capture', 'k7/8/8/3p4/4P3/8/8/K7 w - - 0 1'],
  ];
  for (const [topic, fen] of cases) {
    const players = [{ id: ME, name: 'A' }, { id: 'bot1', name: 'Computer' }];
    const g = mk(players);
    if (topic === 'ep') g.white = 1; // Mensch hat Schwarz, der Gegner Weiß
    assert.ok(C.setFen(g, fen), fen);
    const ui = { sel: null }; const ctx = { id: ME, ui };
    // frische Stellung: erst kommen board und goal, dann das Ereignis (Ereignisse haben Vorrang vor den Figuren)
    const first = coach(g, ctx); checkOut(first);
    if (topic !== 'board') assert.equal(topicOf(first.text), 'board');
    // Folge-Züge desselben Menschen: Thema muss spätestens beim dritten Zug erscheinen
    let found = null;
    for (let step = 0; step < 4 && g.mode === 'play'; step++) {
      const mePi = g.players.findIndex((p) => p.id === ME); const mc = mePi === g.white ? 0 : 1;
      if (g.turn !== mc) { break; }
      const r = coach(g, ctx); checkOut(r);
      if (topicOf(r.text) === topic) { found = r; break; }
      // einen beliebigen Zug machen, Gegner passt nicht -> Stellung per Spiegel unmöglich; wir testen nur die Zuweisung im selben Zustand
      ui.coachTurn = null; // nächster "Zug"
      g.moveNo += 2; // simuliert: zwei Halbzüge später, Stellung gleich
    }
    assert.ok(found, 'Erklärung ' + topic + ' nicht gezeigt');
    if (topic === 'castle') assert.equal(found.target, 'button.sc-sq.can.ck');
    if (topic === 'promo') assert.equal(found.target, 'button.sc-sq.can.pr');
    if (topic === 'ep') assert.equal(found.target, 'button.sc-sq.can.ep');
    if (topic === 'capture') assert.equal(found.target, 'button.sc-sq.can.cp');
    // nach dem Ausprobieren: Auswahl der markierten Figur zeigt passende Ziele
    const legal = C.legalMoves(g);
    const pick = legal.find((m) => (topic === 'castle' && m.castle) || (topic === 'ep' && m.ep) || (topic === 'promo' && m.promo) || (topic === 'capture' && m.capture) || topic === 'check');
    ui.sel = pick.from;
    const rs = coach(g, ctx);
    assert.equal(topicOf(rs.text), topic, 'Text bleibt in diesem Zug gleich');
    if (topic === 'castle') assert.equal(rs.target, 'button.sc-sq.tgt.rk');
    if (topic === 'ep') assert.equal(rs.target, 'button.sc-sq.tgt.epx');
    if (topic === 'promo') assert.equal(rs.target, 'button.sc-sq.tgt.prx');
    if (topic === 'capture') assert.equal(rs.target, 'button.sc-sq.tgt.cap');
    // später nie wieder
    ui.coachTurn = null; g.moveNo += 2; ui.sel = null;
    const again = coach(g, ctx);
    assert.notEqual(topicOf(again.text), topic, 'darf nicht wiederholt werden');
  }
});

test('Umwandlungs-Dialog: Erklärung beim ersten Mal, danach kurz', () => {
  const g = mk([{ id: ME, name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  C.setFen(g, '7k/4P3/8/8/8/8/8/K7 w - - 0 1');
  const ui = { sel: sq('e7'), promo: { from: sq('e7'), to: sq('e8') } }; const ctx = { id: ME, ui };
  const a = coach(g, ctx);
  assert.match(a.text, /Wähle jetzt die neue Figur/);
  assert.equal(a.target, '[data-act="promo"]');
  assert.match(coach(g, ctx).text, /Wähle jetzt die neue Figur/, 'bleibt im selben Zug stehen');
  g.moveNo += 2;
  assert.match(coach(g, ctx).text, /^Wähle die neue Figur für deinen Bauern\.$/);
});

test('Ende der Runde: Text je nach Ergebnis, Ziel ist der Knopf Noch eine Runde', () => {
  const mk2 = (fen, human) => { const g = mk([{ id: ME, name: 'A' }, { id: 'bot1', name: 'Computer' }]); if (!human) g.white = 1; C.setFen(g, fen); return { g }; };
  // Mensch (Weiß) setzt matt
  let { g } = mk2('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', true);
  C.handle(g, ME, { t: 'move', from: sq('a1'), to: sq('a8') });
  let r = coach(g, { id: ME, ui: {} });
  assert.match(r.text, /Schachmatt! Du hast gewonnen/); assert.equal(r.target, '[data-act="next"]');
  // Computer (Weiß) setzt den Menschen matt
  ({ g } = mk2('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', false));
  C.handle(g, 'bot1', { t: 'move', from: sq('a1'), to: sq('a8') });
  r = coach(g, { id: ME, ui: {} }); checkOut(r);
  assert.match(r.text, /Der Computer hat gewonnen/);
  // Patt
  ({ g } = mk2('k7/8/1K6/8/8/8/8/2Q5 w - - 0 1', true));
  C.handle(g, ME, { t: 'move', from: sq('c1'), to: sq('c7') });
  r = coach(g, { id: ME, ui: {} }); checkOut(r);
  assert.match(r.text, /Remis, also unentschieden\. Patt/);
  // 50 Züge, tote Stellung
  ({ g } = mk2('k7/8/8/8/8/8/n7/K7 w - - 0 1', true));
  C.handle(g, ME, { t: 'move', from: sq('a1'), to: sq('a2') });
  assert.match(coach(g, { id: ME, ui: {} }).text, /zu wenig|Mit den übrigen Figuren/);
});

test('Computer am Zug: nur Zuschauen, kein Ziel; Schach des Menschen wird einmal kommentiert', () => {
  const g = mk([{ id: ME, name: 'A' }, { id: 'bot1', name: 'Computer' }]);
  C.setFen(g, '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  C.handle(g, ME, { t: 'move', from: sq('a1'), to: sq('a8') }); // Schach, Computer am Zug
  const ctx = { id: ME, ui: {} };
  const r = coach(g, ctx); checkOut(r);
  assert.match(r.text, /Du hast Schach gesagt/); assert.equal(r.target, undefined);
  assert.match(coach(g, ctx).text, /Du hast Schach gesagt/, 'bleibt in diesem Zug');
  const g2 = JSON.parse(JSON.stringify(g)); g2.moveNo += 2; g2.check = true;
  assert.match(coach(g2, ctx).text, /^Jetzt ist der Computer dran/, 'zweites Mal nicht mehr');
});
