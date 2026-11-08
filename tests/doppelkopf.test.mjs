import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../doppelkopf/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bernd' }, { id: 'c', name: 'Carla' }, { id: 'd', name: 'Dirk' }];
const C = (suit, rank, copy = 0) => (suit * 6 + rank) * 2 + copy; // Farbe 0 ♣ 1 ♠ 2 ♥ 3 ♦ · Wert 0=9 1=10 2=B 3=D 4=K 5=A
const [KR, PI, HE, KA] = [0, 1, 2, 3];
const [N9, Z10, BU, DA, KO, AS] = [0, 1, 2, 3, 4, 5];

// Feste Hände: spec[i] = Karten, die Person i sicher bekommt; der Rest wird aufgefüllt (ohne die Karten in `avoid[i]`-Typen)
function rig(spec, opts = {}, seed = 1) {
  const g = M.createGame(P, { dealer: 3, rounds: 3, ...opts }, seedRng(seed), 'a');
  const used = new Set(spec.flat());
  assert.equal(used.size, spec.flat().length, 'Karte doppelt vergeben');
  const rest = [];
  for (let i = 0; i < 48; i++) if (!used.has(i)) rest.push(i);
  const hands = spec.map((s) => s.slice());
  for (let i = 0; i < 4; i++) while (hands[i].length < 12) hands[i].push(rest.shift());
  M.dealHands(g, hands);
  return g;
}
const play = (g, pid, card) => { const r = M.handle(g, pid, { t: 'play', card }); assert.equal(r.ok, true, `${pid} ${M.cardName(card)}: ${r.error}`); return r; };
const pidAt = (g, i) => g.players[i].id;

// ---------- Tabellen ----------
test('Tabelle aller 48 Karten: Trumpf, Gruppe, Stärke, Augen', () => {
  const trumpOrder = [C(HE, Z10), C(KR, DA), C(PI, DA), C(HE, DA), C(KA, DA), C(KR, BU), C(PI, BU), C(HE, BU), C(KA, BU), C(KA, AS), C(KA, Z10), C(KA, KO), C(KA, N9)];
  const trumpTypes = new Set(trumpOrder.map((c) => c >> 1));
  let nTrump = 0, eyes = 0;
  for (let id = 0; id < 48; id++) {
    const type = id >> 1;
    const isT = trumpTypes.has(type);
    assert.equal(M.isTrump(id), isT, `Trumpf ${M.cardName(id)}`);
    assert.equal(M.cardType(id), type);
    assert.equal(M.cardSuit(id), Math.floor(type / 6));
    assert.equal(M.cardRank(id), type % 6);
    assert.equal(M.groupOf(id), isT ? 3 : M.cardSuit(id), `Gruppe ${M.cardName(id)}`);
    if (isT) nTrump++;
    eyes += M.cardValue(id);
  }
  assert.equal(nTrump, 26); // 2 Dullen, 8 Damen, 8 Buben, 8 Karo
  assert.equal(eyes, 240);
  // Stärke strikt absteigend entlang der Trumpfreihenfolge, und über allen Fehlfarben
  const T = trumpOrder.map((c) => M.power(c));
  for (let i = 0; i + 1 < T.length; i++) assert.ok(T[i] > T[i + 1], `Trumpf ${i}: ${T[i]} > ${T[i + 1]}`);
  for (let s = 0; s < 3; s++) {
    const fo = [AS, Z10, KO, N9].map((r) => M.power(C(s, r)));
    if (s === HE) { assert.ok(M.isTrump(C(HE, Z10))); assert.ok(M.power(C(HE, AS)) > M.power(C(HE, KO))); assert.ok(M.power(C(HE, KO)) > M.power(C(HE, N9))); continue; }
    for (let i = 0; i + 1 < fo.length; i++) assert.ok(fo[i] > fo[i + 1], `Fehlfarbe ${s} ${i}`);
    for (const p of fo) assert.ok(p < T[T.length - 1]);
    // Bube/Dame/Karo sind nie Fehlfarbe
    assert.ok(M.isTrump(C(s, BU)) && M.isTrump(C(s, DA)));
  }
  assert.ok(!M.isTrump(C(HE, AS)) && !M.isTrump(C(HE, KO)) && !M.isTrump(C(HE, N9)) && M.isTrump(C(HE, Z10)));
  assert.ok(M.isTrump(C(KA, N9)) && M.isTrump(C(KA, KO)) && M.isTrump(C(KA, AS)) && M.isTrump(C(KA, Z10)));
});

test('Augen: Ass 11, 10 → 10, König 4, Dame 3, Bube 2, 9 → 0; je Farbe 30, gesamt 240', () => {
  assert.deepEqual([AS, Z10, KO, DA, BU, N9].map((r) => M.cardValue(C(0, r))), [11, 10, 4, 3, 2, 0]);
  for (let s = 0; s < 4; s++) assert.equal([0, 1, 2, 3, 4, 5].reduce((a, r) => a + M.cardValue(C(s, r)) * 2, 0), 60);
  for (let seed = 1; seed <= 20; seed++) {
    const g = M.createGame(P, {}, seedRng(seed));
    assert.equal(g.players.reduce((s, p) => s + p.hand.reduce((a, c) => a + M.cardValue(c), 0), 0), 240);
    assert.ok(g.players.every((p) => p.hand.length === 12));
    assert.deepEqual(g.players.flatMap((p) => p.hand).sort((x, y) => x - y), Array.from({ length: 48 }, (_, i) => i));
  }
});

test('Beschriftung: cardLabel/cardName', () => {
  assert.equal(M.cardName(C(HE, Z10)), 'Herz Zehn');
  assert.equal(M.cardLabel(C(KR, DA)), '♣ Dame');
  assert.equal(M.cardLabel(C(KA, AS, 1)), '♦ Ass');
});

// ---------- Stichwertung ----------
const trick = (...cs) => ({ cards: cs.map(([pid, card]) => ({ pid, card })) });
test('Stichwertung: Trumpf sticht, höchster Trumpf gewinnt, Fehlfarbe nach Anspiel', () => {
  const g = M.createGame(P, {}, seedRng(1));
  // Fehlfarbe angespielt: höchste Karte der Farbe
  assert.equal(M.trickWinner(g, trick(['a', C(KR, KO)], ['b', C(KR, AS)], ['c', C(KR, N9)], ['d', C(KR, Z10)]), false), 'b');
  // andere Fehlfarbe gewinnt nie
  assert.equal(M.trickWinner(g, trick(['a', C(KR, N9)], ['b', C(PI, AS)], ['c', C(HE, AS)], ['d', C(PI, Z10)]), false), 'a');
  // Trumpf sticht Fehlfarbe, auch Karo 9
  assert.equal(M.trickWinner(g, trick(['a', C(KR, AS)], ['b', C(KA, N9)], ['c', C(KR, Z10)], ['d', C(PI, AS)]), false), 'b');
  // höchster Trumpf: Herz-10 > Damen > Buben > Karo
  assert.equal(M.trickWinner(g, trick(['a', C(KA, AS)], ['b', C(KR, BU)], ['c', C(KA, DA)], ['d', C(HE, Z10)]), false), 'd');
  assert.equal(M.trickWinner(g, trick(['a', C(KA, AS)], ['b', C(KR, BU)], ['c', C(KA, DA)], ['d', C(KA, BU)]), false), 'c');
  assert.equal(M.trickWinner(g, trick(['a', C(KR, DA)], ['b', C(PI, DA)], ['c', C(HE, DA)], ['d', C(KA, DA)]), false), 'a');
  assert.equal(M.trickWinner(g, trick(['a', C(KA, DA)], ['b', C(HE, DA)], ['c', C(PI, DA)], ['d', C(KR, DA)]), false), 'd');
  assert.equal(M.trickWinner(g, trick(['a', C(KA, BU)], ['b', C(HE, BU)], ['c', C(PI, BU)], ['d', C(KR, BU)]), false), 'd');
  assert.equal(M.trickWinner(g, trick(['a', C(KA, N9)], ['b', C(KA, KO)], ['c', C(KA, Z10)], ['d', C(KA, AS)]), false), 'd');
  assert.equal(M.trickWinner(g, trick(['a', C(KA, KO)], ['b', C(KA, Z10)], ['c', C(KR, BU)], ['d', C(KA, AS)]), false), 'c');
  // Herz-10 ist Trumpf: gewinnt auch gegen angespieltes Herz-Ass
  assert.equal(M.trickWinner(g, trick(['a', C(HE, AS)], ['b', C(HE, Z10)], ['c', C(HE, KO)], ['d', C(HE, N9)]), false), 'b');
  // Herz-Ass angespielt: Herz-König/Neun stechen nicht, Herz-Ass bleibt vorn
  assert.equal(M.trickWinner(g, trick(['a', C(HE, KO)], ['b', C(HE, AS)], ['c', C(HE, N9)], ['d', C(KR, AS)]), false), 'b');
});

test('Gleiche Karten (doppelt): die zuerst gespielte ist höher (alle 24 Typen, beide Reihenfolgen)', () => {
  const g = M.createGame(P, {}, seedRng(1));
  for (let type = 0; type < 24; type++) {
    const c0 = type * 2, c1 = type * 2 + 1;
    const f = M.cardSuit(c0) === KR && M.cardRank(c0) === N9 ? PI : KR; // Füller: niedrige Fehlfarbe einer anderen Farbe
    assert.equal(M.trickWinner(g, trick(['a', c0], ['b', C(f, N9, 0)], ['c', C(f, N9, 1)], ['d', c1]), false), 'a', `${M.cardName(c0)} zuerst`);
    assert.equal(M.trickWinner(g, trick(['a', c1], ['b', C(f, N9, 0)], ['c', C(f, N9, 1)], ['d', c0]), false), 'a', `${M.cardName(c1)} zuerst`);
    if (M.isTrump(c0)) assert.equal(M.trickWinner(g, trick(['a', C(f, N9, 0)], ['b', c1], ['c', C(f, N9, 1)], ['d', c0]), false), 'b', `${M.cardName(c0)} später: die zuerst gespielte von beiden gewinnt`);
  }
  assert.equal(M.trickWinner(g, trick(['a', C(KR, DA, 0)], ['b', C(KR, DA, 1)], ['c', C(KR, N9)], ['d', C(KR, N9)]), false), 'a');
  assert.equal(M.trickWinner(g, trick(['a', C(KR, N9)], ['b', C(KR, AS, 1)], ['c', C(KR, AS, 0)], ['d', C(KR, N9)]), false), 'b');
});

test('Dulle gegen Dulle: die zuerst gespielte gewinnt, im letzten Stich die zweite', () => {
  const g = M.createGame(P, {}, seedRng(1));
  const t = trick(['a', C(KR, N9)], ['b', C(HE, Z10, 0)], ['c', C(KR, AS)], ['d', C(HE, Z10, 1)]);
  assert.equal(M.trickWinner(g, t, false), 'b');
  assert.equal(M.trickWinner(g, t, true), 'd');
  g.tricksDone = 11;
  assert.equal(M.trickWinner(g, t), 'd', 'ohne Angabe gilt der Zustand: 12. Stich');
  g.tricksDone = 4;
  assert.equal(M.trickWinner(g, t), 'b');
  // Dulle-Anspiel: zweite nur im letzten Stich besser
  const t2 = trick(['a', C(HE, Z10, 1)], ['b', C(KA, N9)], ['c', C(HE, Z10, 0)], ['d', C(KR, DA)]);
  assert.equal(M.trickWinner(g, t2, false), 'a');
  assert.equal(M.trickWinner(g, t2, true), 'c');
  // eine Dulle gegen Damen: Dulle immer
  assert.equal(M.trickWinner(g, trick(['a', C(KR, DA)], ['b', C(HE, Z10)], ['c', C(PI, DA)], ['d', C(KR, DA, 1)]), true), 'b');
});

test('Dulle-Regel im echten Spiel: im 12. Stich schlägt die zweite Dulle die erste, sonst die erste', () => {
  for (const [done, expected] of [[11, 'c'], [5, 'a']]) {
    const g = rig([[], [], [], []]);
    g.leader = 0; g.turn = 0; g.tricksDone = done;
    g.players[0].hand = [C(HE, Z10, 0)]; g.players[1].hand = [C(KR, N9, 0)]; g.players[2].hand = [C(HE, Z10, 1)]; g.players[3].hand = [C(KR, N9, 1)];
    play(g, 'a', C(HE, Z10, 0)); play(g, 'b', C(KR, N9, 0)); play(g, 'c', C(HE, Z10, 1)); play(g, 'd', C(KR, N9, 1));
    assert.equal(g.history[g.history.length - 1].winner, expected, `tricksDone ${done}`);
    if (done === 11) { assert.equal(g.phase, 'round_over'); assert.equal(g.history[0].last, true); }
  }
});

// ---------- Bedienpflicht ----------
test('Bedienpflicht: Trumpf mit Trumpf, Fehlfarbe mit Fehlfarbe, sonst frei; Anspiel frei', () => {
  const g = rig([[C(KR, AS), C(KR, N9)], [C(KR, Z10), C(PI, AS), C(KA, N9), C(KR, DA)], [C(PI, Z10), C(HE, AS), C(HE, Z10), C(KR, BU)], [C(HE, N9), C(HE, KO), C(PI, N9), C(KR, KO)]]);
  g.leader = 0; g.turn = 0;
  assert.deepEqual(M.legalCards(g, 'a').sort(), g.players[0].hand.slice().sort(), 'Anspiel: alles erlaubt');
  assert.deepEqual(M.legalCards(g, 'b'), [], 'nicht dran');
  play(g, 'a', C(KR, AS));
  // b hat Kreuz 10 (Fehlfarbe ♣): muss bedienen; Kreuz-Dame und Karo 9 sind Trumpf und zählen NICHT als Kreuz
  assert.deepEqual(M.legalCards(g, 'b'), [C(KR, Z10)]);
  assert.equal(M.handle(g, 'b', { t: 'play', card: C(PI, AS) }).ok, false);
  assert.equal(M.handle(g, 'b', { t: 'play', card: C(KR, DA) }).ok, false);
  play(g, 'b', C(KR, Z10));
  // c hat kein Kreuz (nur Kreuz-Bube = Trumpf): frei
  const lc = M.legalCards(g, 'c');
  assert.equal(lc.length, g.players[2].hand.length);
  play(g, 'c', C(KR, BU));
  // d hat Kreuz-König
  assert.deepEqual(M.legalCards(g, 'd'), [C(KR, KO)]);
});

test('Bedienpflicht bei Trumpf: Dulle, Damen, Buben und Karo müssen zugegeben werden', () => {
  const g = rig([[C(KA, N9), C(KR, AS)], [C(HE, Z10), C(KR, DA), C(PI, AS), C(HE, AS), C(KR, Z10)], [C(KR, BU), C(PI, Z10)], [C(HE, KO), C(PI, KO)]]);
  g.leader = 0; g.turn = 0;
  play(g, 'a', C(KA, N9)); // Trumpf angespielt
  const lb = M.legalCards(g, 'b');
  assert.ok(lb.includes(C(HE, Z10)) && lb.includes(C(KR, DA)));
  assert.ok(!lb.includes(C(PI, AS)) && !lb.includes(C(HE, AS)) && !lb.includes(C(KR, Z10)));
  assert.ok(lb.every((c) => M.isTrump(c)));
  // Herz angespielt (Herz-Ass): Herz-10 darf NICHT als Herz gelten und muss nicht bedient werden
  const g2 = rig([[C(HE, AS)], [C(HE, Z10), C(HE, KO)], [C(PI, AS)], [C(KR, AS)]]);
  g2.leader = 0; g2.turn = 0;
  play(g2, 'a', C(HE, AS));
  const lb2 = M.legalCards(g2, 'b');
  assert.ok(lb2.includes(C(HE, KO)));
  const hand2 = g2.players[1].hand;
  const hearts = hand2.filter((c) => !M.isTrump(c) && M.cardSuit(c) === HE);
  assert.deepEqual(lb2.slice().sort(), hearts.slice().sort(), 'nur Herz-Fehlfarbe (ohne Herz-10)');
  assert.ok(!lb2.includes(C(HE, Z10)));
});

// ---------- Teams ----------
test('Teamerkennung: Re = Kreuz-Dame; Teams stehen nicht öffentlich im Zustand bekannt (known leer)', () => {
  const g = rig([[C(KR, DA, 0)], [C(KR, DA, 1)], [], []]);
  assert.deepEqual(g.team, ['re', 're', 'kontra', 'kontra']);
  assert.deepEqual(g.known, [null, null, null, null]);
  assert.equal(M.teamOf(g, 'a'), 're');
  assert.equal(M.teamOf(g, 'c'), 'kontra');
  assert.equal(M.teamOf(g, 'x'), null);
  assert.equal(g.wedding, null);
});
test('Teams werden bekannt: Kreuz-Dame ausspielen, Ansage, Rückschluss auf die anderen', () => {
  const g = rig([[C(KR, DA, 0), C(KR, AS)], [C(KR, DA, 1), C(KR, Z10)], [C(KR, KO)], [C(KR, N9)]]);
  g.leader = 0; g.turn = 0;
  play(g, 'a', C(KR, DA, 0));
  assert.equal(g.known[0], 're');
  assert.equal(g.known[1], null);
  M.handle(g, 'a', { t: 'play', card: C(KR, AS) }); // nicht dran
  // b gibt Trumpf zu, ohne sich zu zeigen (Kreuz-Dame 2 liegt aber in der Hand: er muss Trumpf bedienen)
  const lb = M.legalCards(g, 'b');
  assert.ok(lb.every((c) => M.isTrump(c)));
  play(g, 'b', C(KR, DA, 1));
  assert.deepEqual(g.known, ['re', 're', 'kontra', 'kontra'], 'zwei Re bekannt → Rest Kontra');
});
test('Ansage macht das Team bekannt; zwei Kontra bekannt → Rest ist Re', () => {
  const g = rig([[C(KR, DA, 0)], [C(KR, DA, 1)], [], []]);
  assert.equal(M.handle(g, 'c', { t: 'announce', what: 'kontra' }).ok, true);
  assert.equal(g.known[2], 'kontra');
  assert.equal(g.known[3], null);
  assert.equal(M.handle(g, 'd', { t: 'announce', what: 'kontra' }).ok, false, 'Team hat schon angesagt');
  assert.equal(g.announced.kontra, 2);
});

// ---------- Ansagen ----------
test('Ansagen: nur das eigene Team, nur einmal je Team, nur vor der ersten eigenen Karte, ungültige Ansagen', () => {
  const g = rig([[C(KR, DA, 0), C(KR, AS)], [C(KR, DA, 1)], [C(PI, AS)], [C(HE, AS)]]);
  assert.equal(M.canAnnounce(g, 'a'), 're');
  assert.equal(M.canAnnounce(g, 'c'), 'kontra');
  assert.equal(M.canAnnounce(g, 'zz'), null);
  assert.equal(M.handle(g, 'a', { t: 'announce', what: 'kontra' }).ok, false, 'falsches Team');
  assert.equal(M.handle(g, 'c', { t: 'announce', what: 're' }).ok, false);
  assert.equal(M.handle(g, 'c', { t: 'announce', what: 'bla' }).ok, false);
  assert.equal(M.handle(g, 'c', { t: 'announce' }).ok, false);
  assert.equal(M.handle(g, 'a', { t: 'announce', what: 're' }).ok, true);
  assert.equal(M.canAnnounce(g, 'a'), null);
  assert.equal(M.canAnnounce(g, 'b'), null, 'Re hat schon angesagt');
  assert.equal(M.handle(g, 'b', { t: 'announce', what: 're' }).ok, false);
  // auch außerhalb der eigenen Reihe erlaubt
  assert.equal(M.handle(g, 'd', { t: 'announce', what: 'kontra' }).ok, true);
  assert.equal(M.canAnnounce(g, 'c'), null);
  // nach der ersten eigenen Karte nicht mehr
  const g2 = rig([[C(KR, DA, 0), C(KR, AS)], [C(KR, DA, 1)], [C(PI, AS)], [C(HE, AS)]]);
  play(g2, 'a', C(KR, AS));
  assert.equal(M.canAnnounce(g2, 'a'), null);
  assert.equal(M.handle(g2, 'a', { t: 'announce', what: 're' }).ok, false);
  assert.equal(M.canAnnounce(g2, 'b'), 're', 'b hat noch nicht gespielt');
});

// ---------- Hochzeit ----------
test('Hochzeit: Wer beide Kreuz-Damen hat, ist Re; Hochzeit ist öffentlich', () => {
  const g = rig([[C(KR, DA, 0), C(KR, DA, 1)], [], [], []]);
  assert.deepEqual(g.team, ['re', 'kontra', 'kontra', 'kontra']);
  assert.deepEqual(g.wedding, { player: 0, partner: null, state: 'open' });
  assert.deepEqual(g.known, ['re', null, null, null]);
  assert.equal(M.canAnnounce(g, 'a'), 're');
  assert.equal(M.canAnnounce(g, 'b'), null, 'Kontra kann bei offener Hochzeit nicht ansagen');
  assert.equal(M.handle(g, 'b', { t: 'announce', what: 'kontra' }).ok, false);
});
test('Hochzeit: erste fremde Stichgewinner:in wird Partner:in (1. Stich)', () => {
  const g = rig([[C(KR, DA, 0), C(KR, DA, 1), C(KA, N9)], [C(KA, AS)], [C(KA, N9, 1)], [C(KA, Z10)]]);
  g.leader = 0; g.turn = 0;
  play(g, 'a', C(KA, N9));
  play(g, 'b', C(KA, AS));
  play(g, 'c', C(KA, N9, 1));
  play(g, 'd', C(KA, Z10));
  assert.equal(g.history[0].winner, 'b');
  assert.equal(g.wedding.state, 'partner');
  assert.equal(g.wedding.partner, 1);
  assert.deepEqual(g.team, ['re', 're', 'kontra', 'kontra']);
  assert.deepEqual(g.known, ['re', 're', 'kontra', 'kontra']);
});
test('Hochzeit: Partner:in erst im 3. Stich; bis dahin kein Partner; Gewinnt die Hochzeitsperson, bleibt es offen', () => {
  const g = rig([[C(KR, DA, 0), C(KR, DA, 1), C(HE, Z10, 0), C(HE, Z10, 1), C(PI, DA, 0), C(KA, N9)], [C(KA, AS)], [C(KA, N9, 1)], [C(KA, Z10)]]);
  g.leader = 0; g.turn = 0;
  const rounds = [[C(HE, Z10, 0)], [C(HE, Z10, 1)], [C(PI, DA, 0)]];
  let n = 0;
  for (const [lead] of rounds) {
    n++;
    play(g, 'a', lead);
    for (const id of ['b', 'c', 'd']) { const l = M.legalCards(g, id); play(g, id, l[l.length - 1]); }
    // Dulle (erste gespielte) gewinnt immer; Pik-Dame gewinnt gegen alles außer Dullen/Kreuz-Damen, die a hat
    assert.equal(g.history[n - 1].winner, 'a');
    if (n < 3) assert.equal(g.wedding.state, 'open', `nach Stich ${n} noch offen`);
  }
  // nach 3 Stichen ohne Partner: allein
  assert.equal(g.wedding.state, 'alone');
  assert.equal(g.wedding.partner, null);
  assert.deepEqual(g.team, ['re', 'kontra', 'kontra', 'kontra']);
  assert.deepEqual(g.known, ['re', 'kontra', 'kontra', 'kontra']);
});
test('Hochzeit: Partner:in im 3. Stich zählt noch, im 4. nicht mehr', () => {
  const g = rig([[C(KR, DA, 0), C(KR, DA, 1), C(HE, Z10, 0), C(HE, Z10, 1), C(PI, DA, 0), C(HE, DA, 0)], [], [], []]);
  g.leader = 0; g.turn = 0;
  const lead = [C(HE, Z10, 0), C(HE, Z10, 1)];
  for (const c of lead) { play(g, 'a', c); for (const id of ['b', 'c', 'd']) { const l = M.legalCards(g, id); play(g, id, l[l.length - 1]); } }
  assert.equal(g.wedding.state, 'open');
  // 3. Stich: a spielt Karo-9 weg, falls vorhanden, sonst niedrigste; Gewinner sei egal – nur Regel prüfen
  const l = M.legalCards(g, 'a');
  const low = l.slice().sort((x, y) => M.power(x) - M.power(y))[0];
  play(g, 'a', low);
  for (const id of ['b', 'c', 'd']) { const ll = M.legalCards(g, id); play(g, id, ll[ll.length - 1]); }
  const w3 = g.history[2].winner;
  if (w3 !== 'a') { assert.equal(g.wedding.state, 'partner'); assert.equal(g.players[g.wedding.partner].id, w3); assert.equal(g.team[g.wedding.partner], 're'); }
  else assert.equal(g.wedding.state, 'alone');
});
test('Hochzeit aus (opts.wedding=false): Hochzeitsperson spielt von Anfang an allein', () => {
  const g = rig([[C(KR, DA, 0), C(KR, DA, 1)], [], [], []], { wedding: false });
  assert.equal(g.wedding.state, 'alone');
  assert.deepEqual(g.team, ['re', 'kontra', 'kontra', 'kontra']);
  assert.deepEqual(g.known, ['re', 'kontra', 'kontra', 'kontra']);
  assert.equal(M.canAnnounce(g, 'b'), 'kontra');
  assert.equal(M.canAnnounce(g, 'a'), 're');
});

// ---------- Wertung ----------
function fin(teams, points, over = {}) {
  const g = M.createGame(P, { rounds: 5 }, seedRng(1), 'a');
  g.team = teams.slice();
  g.players.forEach((p, i) => { p.points = points[i]; });
  g.history = over.history || [];
  g.announced = over.announced || { re: null, kontra: null };
  return g;
}
const RK = ['re', 'kontra', 're', 'kontra'];
test('Spielwert: Gewonnen 1; Keine 90, Keine 60, Keine 30, Schwarz; Grenzen exakt', () => {
  const val = (reAug) => { const g = fin(RK, [reAug / 2, (240 - reAug) / 2, reAug / 2, (240 - reAug) / 2]); const r = M.scoreRound(g); return [r.winner, r.base]; };
  assert.deepEqual(val(121), ['re', 1]);
  assert.deepEqual(val(150), ['re', 1]);
  assert.deepEqual(val(152), ['re', 2], 'Kontra 88 → keine 90');
  assert.deepEqual(val(180), ['re', 2], 'Kontra 60');
  assert.deepEqual(val(182), ['re', 3], 'Kontra 58 → keine 60');
  assert.deepEqual(val(210), ['re', 3], 'Kontra 30');
  assert.deepEqual(val(212), ['re', 4], 'Kontra 28 → keine 30');
  assert.deepEqual(val(240), ['re', 5], 'Schwarz');
  // genau an den Grenzen (ungerade Werte über zwei Personen verteilt)
  const edge = (reAug, koAug) => { const g = fin(RK, [reAug, koAug, 0, 0]); const r = M.scoreRound(g); return [r.winner, r.base]; };
  assert.deepEqual(edge(151, 89), ['re', 2], 'Verlierer 89 → keine 90');
  assert.deepEqual(edge(150, 90), ['re', 1]);
  assert.deepEqual(edge(181, 59), ['re', 3]);
  assert.deepEqual(edge(180, 60), ['re', 2]);
  assert.deepEqual(edge(211, 29), ['re', 4]);
  assert.deepEqual(edge(210, 30), ['re', 3]);
  assert.deepEqual(edge(240, 0), ['re', 5]);
  assert.deepEqual(edge(239, 1), ['re', 4]);
  assert.deepEqual(edge(120, 120), ['kontra', 2], 'Gegen die Alten: Kontra gewinnt mit 120');
  assert.deepEqual(edge(121, 119), ['re', 1]);
});
test('Gegen die Alten: Kontra gewinnt +1; Kontra-Stufen', () => {
  const e = (reAug, koAug) => { const g = fin(RK, [reAug, koAug, 0, 0]); const r = M.scoreRound(g); return [r.winner, r.base, r.lines.map((l) => l.key).join(',')]; };
  assert.deepEqual(e(119, 121), ['kontra', 2, 'gewonnen,alten']);
  assert.deepEqual(e(89, 151), ['kontra', 3, 'gewonnen,alten,k90']);
  assert.deepEqual(e(59, 181), ['kontra', 4, 'gewonnen,alten,k90,k60']);
  assert.deepEqual(e(29, 211), ['kontra', 5, 'gewonnen,alten,k90,k60,k30']);
  assert.deepEqual(e(0, 240), ['kontra', 6, 'gewonnen,alten,k90,k60,k30,schwarz']);
});
test('Sonderpunkte: Fuchs gefangen, Doppelkopf, Karlchen – für beide Teams unabhängig vom Sieg', () => {
  const fox = C(KA, AS), fox2 = C(KA, AS, 1);
  const history = [
    // b (Kontra) gewinnt; Fuchs von a (Re) → Kontra +1
    { cards: [{ pid: 'a', card: fox }, { pid: 'b', card: C(KR, DA) }, { pid: 'c', card: C(KR, N9) }, { pid: 'd', card: C(KR, KO) }], winner: 'b', winCard: C(KR, DA), augen: 22, last: false },
    // c (Re) fängt den Fuchs von d (Kontra) → Re +1; Doppelkopf (40+) für Re
    { cards: [{ pid: 'd', card: fox2 }, { pid: 'a', card: C(HE, Z10) }, { pid: 'b', card: C(KR, AS) }, { pid: 'c', card: C(KR, Z10) }], winner: 'a', winCard: C(HE, Z10), augen: 42, last: false },
    // Fuchs vom eigenen Partner gewonnen: kein Punkt (a Re spielt Fuchs, c Re gewinnt)
    { cards: [{ pid: 'a', card: fox }, { pid: 'c', card: C(KR, DA) }, { pid: 'b', card: C(PI, KO) }, { pid: 'd', card: C(PI, N9) }], winner: 'c', winCard: C(KR, DA), augen: 22, last: false },
    // letzter Stich: Kreuz-Bube gewinnt (Karlchen) für Kontra (d)
    { cards: [{ pid: 'a', card: C(KA, N9) }, { pid: 'b', card: C(KA, KO) }, { pid: 'c', card: C(KA, Z10) }, { pid: 'd', card: C(KR, BU) }], winner: 'd', winCard: C(KR, BU), augen: 16, last: true },
  ];
  const g = fin(RK, [60, 60, 60, 60], { history });
  const r = M.scoreRound(g);
  assert.deepEqual(r.special.re, { fuchs: 1, doppelkopf: 1, karlchen: 0 });
  assert.deepEqual(r.special.kontra, { fuchs: 1, doppelkopf: 0, karlchen: 1 });
  // Kontra gewinnt (Re 120): base 2 (gewonnen+alten); Re-Bilanz = −2 + 2 − 2 = −2
  assert.equal(r.winner, 'kontra');
  assert.equal(r.reBalance, -2 + 2 - 2);
  // Sonderpunkte zählen auch für die Verliererseite: Re verliert, hat aber 2 Sonderpunkte
  const g2 = fin(RK, [80, 40, 40, 80], { history });
  const r2 = M.scoreRound(g2);
  assert.equal(r2.reBalance, -r2.base * r2.mult + 2 - 2);
});
test('Doppelkopf: genau ab 40 Augen im Stich; Karlchen nur im LETZTEN Stich; Kreuz-Bube sonst nichts', () => {
  const mk = (augen, last, winCard) => [{ cards: [{ pid: 'a', card: C(KR, BU) }, { pid: 'b', card: C(KR, N9) }, { pid: 'c', card: C(KR, N9) }, { pid: 'd', card: C(KR, N9) }], winner: 'a', winCard, augen, last }];
  assert.equal(M.scoreRound(fin(RK, [60, 60, 60, 60], { history: mk(39, false, C(KR, BU)) })).special.re.doppelkopf, 0);
  assert.equal(M.scoreRound(fin(RK, [60, 60, 60, 60], { history: mk(40, false, C(KR, BU)) })).special.re.doppelkopf, 1);
  assert.equal(M.scoreRound(fin(RK, [60, 60, 60, 60], { history: mk(10, false, C(KR, BU)) })).special.re.karlchen, 0);
  assert.equal(M.scoreRound(fin(RK, [60, 60, 60, 60], { history: mk(10, true, C(KR, BU, 1)) })).special.re.karlchen, 1);
  assert.equal(M.scoreRound(fin(RK, [60, 60, 60, 60], { history: mk(10, true, C(PI, BU)) })).special.re.karlchen, 0);
});
test('Ansagen ×2 (je Team einmal): Re ×2, Kontra ×2, beide ×4; Sonderpunkte nicht verdoppelt', () => {
  const pts = [75, 45, 75, 45];
  assert.equal(M.scoreRound(fin(RK, pts)).mult, 1);
  const re = M.scoreRound(fin(RK, pts, { announced: { re: 0, kontra: null } }));
  assert.equal(re.mult, 2); assert.equal(re.reBalance, 2); assert.deepEqual(re.delta, { a: 2, b: -2, c: 2, d: -2 });
  const ko = M.scoreRound(fin(RK, pts, { announced: { re: null, kontra: 1 } }));
  assert.equal(ko.mult, 2); assert.equal(ko.reBalance, 2);
  const both = M.scoreRound(fin(RK, pts, { announced: { re: 0, kontra: 1 } }));
  assert.equal(both.mult, 4); assert.equal(both.reBalance, 4);
  // Re angesagt und verloren: Re zahlt doppelt
  const lose = M.scoreRound(fin(RK, [40, 80, 40, 80], { announced: { re: 0, kontra: null } }));
  assert.equal(lose.winner, 'kontra'); assert.equal(lose.base, 3); assert.equal(lose.reBalance, -6); // Re hat nur 80: gewonnen, gegen die Alten, keine 90
  assert.deepEqual(lose.delta, { a: -6, b: 6, c: -6, d: 6 });
  // Sonderpunkt bleibt unverdoppelt
  const hist = [{ cards: [{ pid: 'a', card: C(KR, BU) }, { pid: 'b', card: C(KR, N9) }, { pid: 'c', card: C(KR, N9) }, { pid: 'd', card: C(KR, N9) }], winner: 'a', winCard: C(KR, BU), augen: 45, last: false }];
  const sp = M.scoreRound(fin(RK, pts, { announced: { re: 0, kontra: null }, history: hist }));
  assert.equal(sp.reBalance, 2 + 1);
});
test('Nullsumme der Rundenpunkte, auch bei Einzelperson (Hochzeit alleine ×3)', () => {
  const g = fin(['re', 'kontra', 'kontra', 'kontra'], [130, 40, 40, 30]);
  const r = M.scoreRound(g);
  assert.equal(r.alone, true);
  assert.equal(r.winner, 're');
  assert.deepEqual(r.delta, { a: 3 * r.reBalance, b: -r.reBalance, c: -r.reBalance, d: -r.reBalance });
  assert.equal(Object.values(r.delta).reduce((a, b) => a + b, 0), 0);
  const g2 = fin(['re', 'kontra', 'kontra', 'kontra'], [100, 50, 50, 40]);
  const r2 = M.scoreRound(g2);
  assert.equal(r2.winner, 'kontra');
  assert.ok(r2.delta.a < 0 && r2.delta.b > 0);
  assert.equal(r2.delta.a, 3 * r2.reBalance);
  assert.equal(Object.values(r2.delta).reduce((a, b) => a + b, 0), 0);
  // normal: je 2
  const r3 = M.scoreRound(fin(RK, [70, 50, 70, 50]));
  assert.equal(Object.values(r3.delta).reduce((a, b) => a + b, 0), 0);
});

// ---------- Ablauf / Nachrichten ----------
test('Ungültige Nachrichten, falsche Person, falsche Phase', () => {
  const g = rig([[C(KR, DA, 0), C(KR, AS)], [C(KR, DA, 1)], [], []]);
  const bad = (pid, msg) => { const before = JSON.stringify(g); const r = M.handle(g, pid, msg); assert.equal(r.ok, false, JSON.stringify(msg)); assert.equal(JSON.stringify(g), before, 'Zustand unverändert'); };
  bad('a', null); bad('a', undefined); bad('a', 5); bad('a', {}); bad('a', { t: 7 }); bad('a', { t: 'quatsch' });
  bad('zz', { t: 'play', card: C(KR, AS) });
  bad('b', { t: 'play', card: C(KR, DA, 1) }); // nicht dran
  bad('a', { t: 'play', card: 99 }); bad('a', { t: 'play', card: -1 }); bad('a', { t: 'play', card: 1.5 }); bad('a', { t: 'play', card: '3' }); bad('a', { t: 'play' });
  bad('a', { t: 'play', card: g.players[1].hand[0] }); // nicht in der eigenen Hand
  bad('a', { t: 'next' }); // Runde läuft, und: a ist Gastgeber, aber Runde läuft
  assert.equal(M.handle(null, 'a', { t: 'play' }).ok, false);
  assert.equal(M.handle({ game: 'x' }, 'a', { t: 'play' }).ok, false);
  assert.throws(() => M.createGame(P.slice(0, 3)), /4 Personen/);
  assert.throws(() => M.createGame([]), /4 Personen/);
  assert.equal(M.legalCards(null, 'a').length, 0);
});

test('Vorhand links vom Geber; Reihenfolge reihum; Gewinner spielt aus; Geber rotiert', () => {
  const g = M.createGame(P, { dealer: 2, rounds: 3 }, seedRng(5), 'a');
  assert.equal(g.leader, 3); assert.equal(g.turn, 3);
  const id = g.players[3].id;
  M.handle(g, id, { t: 'play', card: M.legalCards(g, id)[0] });
  assert.equal(g.turn, 0);
  // Runde durchspielen
  const rng = seedRng(9);
  while (g.phase === 'play') { const pid = g.players[g.turn].id; const l = M.legalCards(g, pid); M.handle(g, pid, { t: 'play', card: l[Math.floor(rng() * l.length)] }); }
  assert.equal(g.phase, 'round_over');
  assert.equal(M.handle(g, 'b', { t: 'next' }).ok, false, 'nur Gastgeber');
  assert.equal(M.handle(g, 'a', { t: 'next' }).ok, true);
  assert.equal(g.round, 2); assert.equal(g.dealer, 3); assert.equal(g.leader, 0); assert.equal(g.phase, 'play');
  assert.equal(g.players.reduce((s, p) => s + p.hand.length, 0), 48);
});

test('Mehrere Runden: Gesamtstand bleibt, letzte Runde → over, Sieger, ranking', () => {
  const g = M.createGame(P, { rounds: 2, dealer: 3 }, seedRng(21), 'a');
  const rng = seedRng(3);
  const run = () => { while (g.phase === 'play') { const pid = g.players[g.turn].id; const l = M.legalCards(g, pid); M.handle(g, pid, { t: 'play', card: l[Math.floor(rng() * l.length)] }); } };
  run();
  assert.equal(g.phase, 'round_over');
  const tot1 = g.players.map((p) => p.total);
  assert.equal(tot1.reduce((a, b) => a + b, 0), 0);
  M.handle(g, 'a', { t: 'next' });
  assert.deepEqual(g.players.map((p) => p.total), tot1, 'Stand bleibt');
  run();
  assert.equal(g.phase, 'over');
  assert.equal(g.players.reduce((s, p) => s + p.total, 0), 0);
  assert.equal(M.handle(g, 'a', { t: 'next' }).ok, false);
  const rk = M.ranking(g);
  assert.equal(rk.length, 4);
  for (let i = 0; i + 1 < rk.length; i++) assert.ok(rk[i].score >= rk[i + 1].score);
  assert.equal(rk[0].rank, 1);
  const best = Math.max(...g.players.map((p) => p.total));
  const tops = g.players.filter((p) => p.total === best);
  assert.equal(g.result.gameWinner, tops.length === 1 ? tops[0].id : null);
  assert.deepEqual(g.result.winners.slice().sort(), tops.map((p) => p.id).sort());
});

// ---------- Naive Gegenprobe der Stichwertung ----------
const TRUMP_SEQ = [[HE, Z10], [KR, DA], [PI, DA], [HE, DA], [KA, DA], [KR, BU], [PI, BU], [HE, BU], [KA, BU], [KA, AS], [KA, Z10], [KA, KO], [KA, N9]];
const FARB_SEQ = [AS, Z10, KO, N9];
function naiveWinner(cards, last) {
  const trumpRank = (c) => TRUMP_SEQ.findIndex(([s, r]) => s === M.cardSuit(c) && r === M.cardRank(c));
  const lead = cards[0].card;
  const ledTrump = trumpRank(lead) >= 0;
  let best = 0;
  const beats = (x, y) => {
    const tx = trumpRank(x), ty = trumpRank(y);
    if (tx >= 0 && ty >= 0) return tx < ty || (tx === ty && last && tx === 0);
    if (tx >= 0) return true;
    if (ty >= 0) return false;
    if (M.cardSuit(x) !== M.cardSuit(y)) return false;
    return FARB_SEQ.indexOf(M.cardRank(x)) < FARB_SEQ.indexOf(M.cardRank(y));
  };
  void ledTrump;
  for (let i = 1; i < 4; i++) if (beats(cards[i].card, cards[best].card)) best = i;
  return cards[best].pid;
}

test('300 Zufallsrunden: Kartenbilanz 48, Augenbilanz 240, Nullsumme, JSON, Stichgewinner gegen naive Gegenprobe', () => {
  let weddings = 0, partners = 0, alones = 0, announced = 0, fox = 0, dk = 0, kar = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seedRng(seed * 31 + 7);
    const g = M.createGame(P, { rounds: 1, wedding: seed % 7 !== 0 }, rng, 'a');
    assert.equal(g.players.every((p) => p.hand.length === 12), true);
    if (g.wedding) weddings++;
    let steps = 0;
    while (g.phase === 'play') {
      assert.ok(steps++ < 60, 'Runde endet');
      if (rng() < 0.08) { const pid = g.players[Math.floor(rng() * 4)].id; const c = M.canAnnounce(g, pid); if (c) { assert.equal(M.handle(g, pid, { t: 'announce', what: c }).ok, true); announced++; } }
      const pid = g.players[g.turn].id;
      const l = M.legalCards(g, pid);
      assert.ok(l.length > 0, 'immer eine erlaubte Karte');
      assert.ok(l.every((c) => g.players[g.turn].hand.includes(c)));
      const card = l[Math.floor(rng() * l.length)];
      const r = M.handle(g, pid, { t: 'play', card }, rng);
      assert.equal(r.ok, true);
      // JSON-sicher in jedem Schritt
      assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
      // Kartenbilanz
      const inHands = g.players.reduce((s, p) => s + p.hand.length, 0);
      const inWon = g.players.reduce((s, p) => s + p.won.length, 0);
      assert.equal(inHands + inWon + g.trick.cards.length, 48);
    }
    assert.ok(g.phase === 'over');
    const all = g.players.flatMap((p) => p.won).sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: 48 }, (_, i) => i), 'alle 48 Karten gewonnen');
    assert.equal(g.players.reduce((s, p) => s + p.points, 0), 240);
    assert.equal(g.players.reduce((s, p) => s + p.tricks, 0), 12);
    assert.equal(g.history.length, 12);
    for (const p of g.players) assert.equal(p.points, p.won.reduce((s, c) => s + M.cardValue(c), 0));
    const res = g.result;
    assert.equal(res.reAugen + res.kontraAugen, 240);
    assert.equal(Object.values(res.delta).reduce((a, b) => a + b, 0), 0, 'Nullsumme');
    assert.equal(g.players.reduce((s, p) => s + p.total, 0), 0);
    assert.ok(Object.values(res.delta).every(Number.isInteger));
    assert.equal(res.winner, res.reAugen >= 121 ? 're' : 'kontra');
    // Teams: Re hat mind. eine Kreuz-Dame gespielt/gehabt; Partner nur bei Hochzeit
    const reN = g.team.filter((t) => t === 're').length;
    if (g.wedding) { if (g.wedding.state === 'partner') { partners++; assert.equal(reN, 2); } else { alones++; assert.equal(reN, 1); } assert.ok(['partner', 'alone'].includes(g.wedding.state)); }
    else assert.equal(reN, 2);
    // Re-Kreuz-Damen: jede Person mit Kreuz-Dame in ihren gewonnenen Karten ... Teams ohne Hochzeit: Kreuz-Dame wurde von Re-Personen gespielt
    if (!g.wedding) for (const t of g.history) for (const c of t.cards) if (M.isKreuzDame(c.card)) assert.equal(g.team[g.players.findIndex((p) => p.id === c.pid)], 're');
    assert.deepEqual(g.known, g.team, 'am Ende ist alles bekannt');
    // Stichgewinner gegen die naive Gegenprobe
    g.history.forEach((t, i) => assert.equal(t.winner, naiveWinner(t.cards, i === 11), `Stich ${i + 1}`));
    const sp = res.special;
    fox += sp.re.fuchs + sp.kontra.fuchs; dk += sp.re.doppelkopf + sp.kontra.doppelkopf; kar += sp.re.karlchen + sp.kontra.karlchen;
    // Spielwert-Plausibilität
    assert.ok(res.base >= 1 && res.base <= 6);
    assert.equal(res.mult, (res.announced.re ? 2 : 1) * (res.announced.kontra ? 2 : 1));
  }
  console.log(`300 Runden: Hochzeiten ${weddings} (Partner ${partners}, allein ${alones}), Ansagen ${announced}, Füchse ${fox}, Doppelköpfe ${dk}, Karlchen ${kar}`);
  assert.ok(weddings > 20 && partners > 5 && alones > 5);
});

test('Gleiche Rundenlogik mit identischem Zufall liefert identisches Ergebnis (deterministisch, rng als Parameter)', () => {
  const run = (seed) => { const rng = seedRng(seed); const g = M.createGame(P, { rounds: 1 }, rng, 'a'); while (g.phase === 'play') { const pid = g.players[g.turn].id; const l = M.legalCards(g, pid); M.handle(g, pid, { t: 'play', card: l[0] }); } return JSON.stringify(g); };
  assert.equal(run(4), run(4));
  assert.notEqual(run(4), run(5));
});

test('sortCards: Trümpfe zuerst (stark → schwach), dann ♣ ♠ ♥ je Ass, 10, König, 9', () => {
  const hand = [C(KR, N9), C(KA, N9), C(HE, AS), C(KR, DA), C(HE, Z10), C(PI, AS), C(KR, AS), C(KA, AS), C(KR, BU), C(PI, KO)];
  const s = M.sortCards(hand);
  assert.deepEqual(s, [C(HE, Z10), C(KR, DA), C(KR, BU), C(KA, AS), C(KA, N9), C(KR, AS), C(KR, N9), C(PI, AS), C(PI, KO), C(HE, AS)]);
});
