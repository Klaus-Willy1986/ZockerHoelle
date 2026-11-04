import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../dame/engine.js';
import { chooseAction } from '../dame/ai.js';

const sq = D.sq;
const CODE = { w: 1, W: 2, b: 3, B: 4 };
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mk = (a = 'bot1', b = 'bot2') => D.createGame([{ id: a, name: 'A' }, { id: b, name: 'B' }]);
function setup(pieces, turn = 0, ids = ['bot1', 'human']) {
  const g = mk(...ids);
  g.board = Array(64).fill(0);
  for (const [k, v] of Object.entries(pieces)) g.board[sq(k)] = CODE[v];
  g.turn = turn;
  g.history = {};
  return g;
}

let thinkMs = 0;
let thinkN = 0;
let invalid = 0;

// Spieler: 0 Leicht, 1 Mittel, 'rnd' Zufall
function playGame(whiteKind, blackKind, seed) {
  const rng = seeded(seed);
  const g = mk('p0', 'p1');
  const kinds = [whiteKind, blackKind];
  let plies = 0;
  while (g.mode !== 'over' && plies < 600) {
    const who = g.turn;
    const id = `p${who}`;
    let msg;
    if (kinds[who] === 'rnd') {
      const ms = D.legalMoves(g);
      msg = { t: 'move', path: ms[Math.floor(rng() * ms.length)].path };
    } else {
      const t0 = performance.now();
      msg = chooseAction(g, id, kinds[who], rng);
      if (kinds[who] === 1) { thinkMs += performance.now() - t0; thinkN++; }
    }
    assert.ok(msg, 'Bot muss am Zug eine Aktion liefern');
    const r = D.handle(g, id, msg);
    if (!r.ok) { invalid++; assert.fail('ungültige Nachricht ' + JSON.stringify(msg) + ' ' + r.error); }
    plies++;
  }
  assert.equal(g.mode, 'over', 'Partie muss enden (Zuglimit nicht erreicht)');
  return g.winner; // 0 | 1 | 'draw'
}

function series(kA, kB, n, seed0) {
  // Punkte für A (Remis halb), A spielt abwechselnd Weiß/Schwarz
  let pts = 0;
  for (let i = 0; i < n; i++) {
    const aWhite = i % 2 === 0;
    const w = playGame(aWhite ? kA : kB, aWhite ? kB : kA, seed0 + i);
    if (w === 'draw') pts += 0.5;
    else if ((w === 0) === aWhite) pts += 1;
  }
  return pts / n;
}

test('Bot-gegen-Bot: nur gültige Nachrichten, alle Partien enden, Quoten', { timeout: 900000 }, () => {
  const rates = {};
  rates.LL = series(0, 0, 40, 100);
  rates.MM = series(1, 1, 30, 200);
  rates.MvL = series(1, 0, 120, 300);
  rates.MvR = series(1, 'rnd', 80, 500);
  rates.LvR = series(0, 'rnd', 60, 700);
  console.log('Quoten:', JSON.stringify(rates), 'Partien: 330');
  assert.equal(invalid, 0);
  assert.ok(rates.MvL >= 0.65, `Mittel gegen Leicht ${rates.MvL}`);
  assert.ok(rates.MvR > 0.9, `Mittel gegen Zufall ${rates.MvR}`);
  assert.ok(rates.LvR > 0.5, `Leicht gegen Zufall ${rates.LvR}`);
  const mean = thinkMs / thinkN;
  console.log('Rechenzeit Mittel: Mittel', mean.toFixed(1), 'ms über', thinkN, 'Züge');
  assert.ok(mean < 150, 'Rechenzeit im Mittel < 150 ms: ' + mean);
});

test('Bot handelt nie, wenn er nicht am Zug ist / Spiel vorbei / unbekannt', () => {
  const g = mk('bot1', 'human'); // Weiß = Bot beginnt
  assert.equal(chooseAction(g, 'human', 1), null); // Mensch am Gegenzug: nicht dran
  const g2 = mk('human', 'bot1'); // Mensch beginnt
  for (const lv of [0, 1]) assert.equal(chooseAction(g2, 'bot1', lv), null);
  assert.equal(chooseAction(g2, 'niemand', 1), null);
  const g3 = mk('bot1', 'human');
  D.resign(g3, 'human');
  assert.equal(chooseAction(g3, 'bot1', 1), null);
});

test('Schlagzwang und Mehrfachsprung: ganzer Pfad in einer Nachricht', () => {
  // Weiß-Bot c3, Schwarze b4? -> einfacher Doppelsprung: w c1; b d2, b f4 ... Stein c1 springt über d2 nach e3, über f4 nach g5
  for (const lv of [0, 1]) {
    const g = setup({ c1: 'w', d2: 'b', f4: 'b', a7: 'b' }, 0);
    const msg = chooseAction(g, 'bot1', lv, seeded(5));
    assert.deepEqual(msg, { t: 'move', path: [sq('c1'), sq('e3'), sq('g5')] });
    assert.ok(D.handle(g, 'bot1', msg).ok);
    assert.equal(g.captured[0], 2);
  }
  // Schlagzwang: einziger legaler Zug ist ein Schlag, obwohl normale Züge möglich wären
  for (let s = 1; s <= 20; s++) {
    const g = setup({ d4: 'w', h2: 'w', e5: 'b', a7: 'b' }, 0);
    const msg = chooseAction(g, 'bot1', s % 2, seeded(s));
    assert.deepEqual(msg.path, [sq('d4'), sq('f6')]);
  }
});

test('Damenumwandlung wird erkannt und gespielt', () => {
  const g = setup({ b7: 'w', h2: 'b' }, 0); // Weiß zieht zur Grundreihe: a8 oder c8
  const m = chooseAction(g, 'bot1', 1, seeded(1));
  assert.ok(D.handle(g, 'bot1', m).ok);
  assert.ok(g.last.promoted);
  assert.ok(D.isDame(g.board[g.last.path[1]]));
});

test('Mittel gibt keinen Stein umsonst her', () => {
  // Weiß-Bot kann d4 -> c5 ziehen; dort wäre er sofort geschlagen (b6 schwarz, a7 frei), e5 sicher
  const g = setup({ d4: 'w', b6: 'b', h2: 'w', h8: 'b' }, 0);
  for (let s = 0; s < 10; s++) {
    const msg = chooseAction(g, 'bot1', 1, seeded(s));
    assert.notDeepEqual(msg.path, [sq('d4'), sq('c5')]);
  }
});

test('Remis-Angebot: Ablehnung im Normalfall, Annahme bei remisreifer Stellung; nie selbst anbieten', () => {
  const g = mk('human', 'bot1');
  g.turn = 1; // egal – Angebot blockiert Züge
  g.drawOffer = 0;
  for (const lv of [0, 1]) assert.deepEqual(chooseAction(g, 'bot1', lv), { t: 'draw-decline' });
  assert.ok(D.handle(g, 'bot1', chooseAction(g, 'bot1', 1)).ok);
  assert.equal(g.drawOffer, null);
  assert.equal(g.mode, 'normal');

  const h = setup({ a1: 'W', c1: 'W', h8: 'B', f8: 'B' }, 1, ['human', 'bot1']);
  h.noProgress = 20;
  h.drawOffer = 0;
  assert.deepEqual(chooseAction(h, 'bot1', 1), { t: 'draw-accept' });
  assert.ok(D.handle(h, 'bot1', chooseAction(h, 'bot1', 1)).ok);
  assert.equal(h.winner, 'draw');

  // der Bot bietet nie an und antwortet nicht auf sein eigenes Angebot
  const k = mk('bot1', 'human');
  k.drawOffer = 0;
  assert.equal(chooseAction(k, 'bot1', 1), null);
  for (let i = 0; i < 30; i++) {
    const x = mk('bot1', 'human');
    const m = chooseAction(x, 'bot1', i % 2, seeded(i));
    assert.equal(m.t, 'move');
  }
});
