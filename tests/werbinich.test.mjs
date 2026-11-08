import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../werbinich/engine.js';
import { BEGRIFFE, FRAGEN, KATEGORIEN, KATEGORIE_IDS, THEMEN, antwort, imKatalog } from '../werbinich/begriffe.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const mk = (n = 2, o = {}, seed = 1) => E.createGame(P(n), o, seedRng(seed));
// Eine Frage, die den geheimen Begriff nicht verrät (egal, welche): erste noch nicht gestellte
const freeQ = (g) => FRAGEN.find((f) => !g.asked.some((x) => x.q === f.id)).id;
const wrongTerm = (g) => BEGRIFFE.find((b) => b.k === E.category(g) && b.id !== E.secret(g).id && !g.wrong.some((w) => w.id === b.id)).id;

// ---------------------------------------------------------------- Katalog
test('Katalog: Mindestmengen und Kategorien', () => {
  assert.ok(FRAGEN.length <= 80, 'nicht zu viele Fragen für die Liste');
  assert.ok(BEGRIFFE.length >= 120, 'Begriffe: ' + BEGRIFFE.length);
  assert.ok(FRAGEN.length >= 45, 'Fragen: ' + FRAGEN.length);
  assert.deepEqual(KATEGORIE_IDS.sort(), ['beruf', 'ding', 'maerchen', 'tier']);
  assert.ok(imKatalog('tier').length >= 40);
  assert.ok(imKatalog('beruf').length >= 30);
  assert.ok(imKatalog('ding').length >= 30);
  assert.ok(imKatalog('maerchen').length >= 20);
  for (const k of KATEGORIE_IDS) { assert.ok(KATEGORIEN[k].text.startsWith('Ich bin '), k); assert.ok(KATEGORIEN[k].e); }
});

test('Katalog: Ids, Namen und Emoji sind sauber und eindeutig', () => {
  assert.equal(new Set(BEGRIFFE.map((b) => b.id)).size, BEGRIFFE.length, 'Begriffs-Ids');
  assert.equal(new Set(BEGRIFFE.map((b) => b.n)).size, BEGRIFFE.length, 'Namen');
  assert.equal(new Set(FRAGEN.map((f) => f.id)).size, FRAGEN.length, 'Frage-Ids');
  assert.equal(new Set(FRAGEN.map((f) => f.t)).size, FRAGEN.length, 'Fragetexte');
  for (const b of BEGRIFFE) {
    assert.match(b.id, /^[a-z]+$/, b.id);
    assert.ok(typeof b.n === 'string' && b.n.trim().length > 1 && typeof b.e === 'string' && b.e.length > 0, b.id);
    assert.ok(KATEGORIE_IDS.includes(b.k), b.id);
  }
  for (const f of FRAGEN) {
    assert.match(f.t, /^[A-ZÄÖÜ].*\?$/, f.id);
    assert.ok(f.e && f.g && THEMEN.includes(f.g), f.id);
  }
  assert.ok(FRAGEN.some((f) => f.t === 'Lebe ich im Wasser?') && FRAGEN.some((f) => f.t === 'Kann ich fliegen?'));
});

test('Katalog: vollständige Matrix – jeder Begriff hat auf jede Frage eine gültige Antwort', () => {
  for (const b of BEGRIFFE) {
    assert.equal(typeof b.a, 'object');
    assert.deepEqual(Object.keys(b.a).sort(), FRAGEN.map((f) => f.id).sort(), b.id + ': Fragen passen nicht');
    for (const f of FRAGEN) assert.ok(['ja', 'nein', 'teils'].includes(b.a[f.id]), `${b.id}/${f.id}: ${b.a[f.id]}`);
    assert.equal(antwort(b, 'leb'), b.a.leb);
  }
  assert.equal(antwort(null, 'leb'), null); assert.equal(antwort(BEGRIFFE[0], 'gibtesnicht'), null);
});

test('Katalog: Eindeutigkeit – kein Paar von Begriffen hat denselben Antwortvektor (weltweit und je Kategorie)', () => {
  const vec = (b) => FRAGEN.map((f) => b.a[f.id][0]).join('');
  const seen = new Map();
  for (const b of BEGRIFFE) {
    const v = vec(b);
    assert.ok(!seen.has(v), `${b.id} und ${seen.get(v)} sind nicht zu unterscheiden`);
    seen.set(v, b.id);
  }
  // Je Kategorie: Jeder Begriff ist von jedem anderen durch mindestens 2 Fragen getrennt (robust gegen einen Irrtum)
  for (const k of KATEGORIE_IDS) {
    const l = imKatalog(k); let minD = 99; let pair = '';
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const d = FRAGEN.filter((f) => l[i].a[f.id] !== l[j].a[f.id]).length;
      if (d < minD) { minD = d; pair = `${l[i].id}/${l[j].id}`; }
    }
    assert.ok(minD >= 2, `${k}: ${pair} unterscheiden sich nur in ${minD} Frage(n)`);
  }
});

test('Katalog: Sachprüfungen (feste Wahrheiten)', () => {
  const A = (id, q) => BEGRIFFE.find((b) => b.id === id).a[q];
  // Tiere, Pflichtfälle
  assert.equal(A('delfin', 'was'), 'ja'); assert.equal(A('delfin', 'fis'), 'nein'); assert.equal(A('delfin', 'sae'), 'ja');
  assert.equal(A('pinguin', 'fli'), 'nein'); assert.equal(A('pinguin', 'vog'), 'ja');
  assert.equal(A('adler', 'fli'), 'ja'); assert.equal(A('fledermaus', 'sae'), 'ja'); assert.equal(A('fledermaus', 'fli'), 'ja');
  assert.equal(A('elefant', 'gro'), 'ja'); assert.equal(A('maus', 'kle'), 'ja'); assert.equal(A('hai', 'fis'), 'ja');
  assert.equal(A('loewe', 'fle'), 'ja'); assert.equal(A('kuh', 'pfl'), 'ja'); assert.equal(A('kuh', 'fle'), 'nein');
  assert.equal(A('biene', 'vl'), 'ja'); assert.equal(A('spinne', 'vl'), 'ja'); assert.equal(A('hund', 'vb'), 'ja');
  assert.equal(A('schildkroete', 'pan'), 'ja'); assert.equal(A('schlange', 'sch'), 'ja'); assert.equal(A('huhn', 'fed'), 'ja');
  // Dinge
  assert.equal(A('fernseher', 'str'), 'ja'); assert.equal(A('kerze', 'str'), 'nein'); assert.equal(A('kerze', 'lic'), 'ja');
  assert.equal(A('bleistift', 'hol'), 'ja'); assert.equal(A('loeffel', 'met'), 'ja'); assert.equal(A('spiegel', 'gla'), 'ja');
  assert.equal(A('fahrrad', 'rad'), 'ja'); assert.equal(A('auto', 'rad'), 'ja'); assert.equal(A('klavier', 'mus'), 'ja');
  assert.equal(A('gitarre', 'mus'), 'ja'); assert.equal(A('buch', 'les'), 'ja'); assert.equal(A('messer', 'sni'), 'ja');
  // Berufe
  assert.equal(A('polizist', 'uni'), 'ja'); assert.equal(A('arzt', 'hlf'), 'ja'); assert.equal(A('bauer', 'mit'), 'ja');
  assert.equal(A('tierarzt', 'hlf'), 'nein'); assert.equal(A('lehrer', 'kin'), 'ja'); assert.equal(A('baecker', 'lie'), 'ja');
  // Märchen
  assert.equal(A('drache', 'feu'), 'ja'); assert.equal(A('hexe', 'zau'), 'ja'); assert.equal(A('rapunzel', 'tur'), 'ja');
  assert.equal(A('boeserwolf', 'bos'), 'ja'); assert.equal(A('meerjungfrau', 'was'), 'ja');
  for (const b of imKatalog('maerchen')) assert.equal(b.a.ges, 'ja', b.id);
  for (const k of ['tier', 'beruf', 'ding']) for (const b of imKatalog(k)) assert.equal(b.a.ges, 'nein', b.id);
  // Gegenstände leben nicht, Tiere und Menschen schon
  for (const b of imKatalog('ding')) { assert.equal(b.a.leb, 'nein', b.id); assert.equal(b.a.tie, 'nein'); assert.equal(b.a.men, 'nein'); assert.equal(b.a.sae, 'nein'); }
  for (const b of imKatalog('tier')) { assert.equal(b.a.leb, 'ja', b.id); assert.equal(b.a.tie, 'ja', b.id); assert.equal(b.a.men, 'nein'); }
  for (const b of imKatalog('beruf')) { assert.equal(b.a.men, 'ja', b.id); assert.equal(b.a.leb, 'ja'); }
  // Keine Marken, keine lebenden Personen: einfache Wortliste
  assert.ok(!BEGRIFFE.some((b) => /\b(coca|nike|adidas|lego|disney|mickey|apple|iphone|google|merkel)\b/i.test(b.n)));
  // Tiere teilen nicht gleichzeitig Federn und Fell, Fische nicht Fell und Federn
  for (const b of imKatalog('tier')) assert.ok(!(b.a.fel === 'ja' && b.a.fed === 'ja'), b.id);
  for (const b of imKatalog('tier')) if (b.a.vog === 'ja') assert.equal(b.a.fed, 'ja', b.id);
  for (const b of imKatalog('tier')) if (b.a.fis === 'ja') assert.equal(b.a.was, 'ja', b.id);
});

// ---------------------------------------------------------------- Spielaufbau
test('createGame: 5 Begriffe (kurz 3), je Runde eine Kategorie, keine Wiederholung, alle Kategorien kommen vor', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = mk(2, {}, seed);
    assert.equal(g.len, 5); assert.equal(g.terms.length, 5); assert.equal(new Set(g.terms).size, 5);
    assert.equal(g.cats.length, 5);
    g.terms.forEach((t, i) => assert.equal(E.term(t).k, g.cats[i]));
    assert.equal(new Set(g.cats).size, 4, 'alle vier Kategorien in 5 Runden');
    assert.equal(g.phase, 'ask'); assert.equal(g.round, 0); assert.equal(g.turn, 0);
    assert.deepEqual(g.asked, []); assert.deepEqual(g.wrong, []);
    assert.deepEqual(g.scores, { p0: 0, p1: 0 });
  }
  assert.equal(mk(2, { kurz: true }).len, 3);
  assert.equal(mk(2, { len: 7 }).len, 7);
  assert.equal(mk(2, { len: 99 }).len, 5);
  const fx = mk(1, { fixed: ['elefant', 'loeffel', 'nichtda'] });
  assert.deepEqual(fx.terms, ['elefant', 'loeffel']); assert.deepEqual(fx.cats, ['tier', 'ding']);
  assert.equal(mk(2, {}, 3).terms.join(), mk(2, {}, 3).terms.join()); assert.notEqual(mk(2, {}, 3).terms.join(), mk(2, {}, 4).terms.join());
});
test('createGame: exclude vermeidet schon gespielte Begriffe, solange es andere gibt', () => {
  const ex = imKatalog('tier').slice(0, 30).map((b) => b.id);
  for (let seed = 1; seed <= 30; seed++) {
    const g = mk(2, { exclude: ex, kurz: true }, seed);
    for (const t of g.terms) assert.ok(!ex.includes(t), t);
  }
  // alles ausgeschlossen: trotzdem ein Spiel
  assert.equal(mk(2, { exclude: BEGRIFFE.map((b) => b.id) }).terms.length, 5);
});
test('createGame: ungültige Spielerlisten', () => {
  assert.throws(() => E.createGame([], {}, seedRng(1)));
  assert.throws(() => E.createGame(P(7), {}, seedRng(1)));
  assert.throws(() => E.createGame([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], {}, seedRng(1)));
  assert.throws(() => E.createGame(null, {}, seedRng(1)));
  assert.equal(mk(6).players.length, 6); assert.equal(mk(1).players.length, 1);
});

// ---------------------------------------------------------------- Fragen und Antworten
test('Frage stellen: Antwort kommt aus der Matrix, Reihum wechselt die Person', () => {
  const g = mk(3, {}, 2);
  const sec = E.secret(g);
  for (const f of FRAGEN.slice(0, 6)) {
    const who = g.players[g.turn].id;
    const r = E.handle(g, who, { t: 'ask', q: f.id });
    assert.deepEqual([r.ok, r.a], [true, sec.a[f.id]]);
  }
  assert.equal(g.asked.length, 6);
  assert.deepEqual(g.asked.map((x) => x.by), ['p0', 'p1', 'p2', 'p0', 'p1', 'p2']);
  g.asked.forEach((x, i) => assert.equal(x.a, sec.a[FRAGEN[i].id]));
  assert.equal(g.turn, 0);
  assert.equal(g.evt.kind, 'ask');
});
test('Frage stellen: ungültige Fälle', () => {
  const g = mk(2, {}, 3);
  assert.equal(E.handle(g, 'p1', { t: 'ask', q: 'leb' }).ok, false, 'nicht dran');
  assert.equal(E.handle(g, 'fremd', { t: 'ask', q: 'leb' }).ok, false, 'spielt nicht mit');
  assert.equal(E.handle(g, 'p0', { t: 'ask', q: 'gibtesnicht' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'ask', q: 42 }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'ask' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'ask', q: 'leb', r: 3 }).ok, false, 'falsche Runde');
  assert.equal(g.asked.length, 0);
  assert.ok(E.handle(g, 'p0', { t: 'ask', q: 'leb' }).ok);
  assert.equal(E.handle(g, 'p1', { t: 'ask', q: 'leb' }).ok, false, 'schon gestellt');
  assert.equal(E.handle(g, 'p0', { t: 'ask', q: 'men' }).ok, false, 'p1 ist dran');
  for (const bad of [null, undefined, 5, 'ask', {}, { t: 7 }, { t: 'quatsch' }]) assert.equal(E.handle(g, 'p1', bad).ok, false);
  assert.equal(E.handle(null, 'p0', { t: 'ask' }).ok, false);
  assert.equal(E.handle({ game: 'xx' }, 'p0', { t: 'ask' }).ok, false);
  assert.equal(g.asked.length, 1);
});

// ---------------------------------------------------------------- Raten und Punkte
test('Punkte: 10 minus Fragen (höchstens 8 zählen), mindestens 2', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 63].map(E.pointsFor), [10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 2, 2]);
  for (const n of [0, 1, 3, 8, 12]) {
    const g = mk(1, {}, 4);
    for (let i = 0; i < n; i++) assert.ok(E.handle(g, 'p0', { t: 'ask', q: FRAGEN[i].id }).ok);
    const r = E.handle(g, 'p0', { t: 'guess', id: E.secret(g).id });
    assert.deepEqual([r.ok, r.right, r.pts], [true, true, E.pointsFor(n)]);
    assert.equal(g.scores.p0, E.pointsFor(n));
    assert.equal(g.phase, 'reveal'); assert.equal(g.reveal.term, g.terms[0]); assert.equal(g.reveal.asked, n);
    assert.equal(g.stats.p0.right, 1);
  }
});
test('Falsch geraten: Strafpunkt, Wechsel zur nächsten Person; Begriff kann nicht erneut geraten werden', () => {
  const g = mk(3, {}, 5);
  const w = wrongTerm(g);
  const r = E.handle(g, 'p0', { t: 'guess', id: w });
  assert.deepEqual([r.ok, r.right, r.pts], [true, false, -1]);
  assert.equal(g.scores.p0, -1); assert.equal(g.turn, 1); assert.equal(g.phase, 'ask');
  assert.deepEqual(g.wrong, [{ id: w, by: 'p0' }]); assert.equal(g.stats.p0.wrong, 1);
  assert.equal(g.evt.kind, 'wrong');
  assert.equal(E.handle(g, 'p1', { t: 'guess', id: w }).ok, false, 'schon falsch geraten');
  assert.equal(g.scores.p1, 0);
  assert.equal(E.handle(g, 'p0', { t: 'guess', id: E.secret(g).id }).ok, false, 'p0 ist nicht dran');
  // andere Kategorie / unbekannt
  const other = BEGRIFFE.find((b) => b.k !== E.category(g)).id;
  assert.equal(E.handle(g, 'p1', { t: 'guess', id: other }).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'guess', id: 'gibtesnicht' }).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'guess', id: 5 }).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'guess' }).ok, false);
  assert.equal(g.scores.p1, 0); assert.equal(g.turn, 1);
  assert.ok(E.handle(g, 'p1', { t: 'guess', id: E.secret(g).id }).right);
  assert.equal(g.scores.p1, 10);
});
test('Solo: Falschraten kostet einen Punkt und man bleibt dran', () => {
  const g = mk(1, {}, 6);
  assert.ok(E.handle(g, 'p0', { t: 'ask', q: 'leb' }).ok);
  assert.equal(g.turn, 0);
  E.handle(g, 'p0', { t: 'guess', id: wrongTerm(g) });
  assert.equal(g.turn, 0); assert.equal(g.scores.p0, -1);
  E.handle(g, 'p0', { t: 'guess', id: E.secret(g).id });
  assert.equal(g.scores.p0, -1 + 9);
});
test('Nach der Auflösung geht nichts mehr außer next (nur Gastgeber)', () => {
  const g = mk(2, {}, 7);
  E.handle(g, 'p0', { t: 'guess', id: E.secret(g).id });
  assert.equal(g.phase, 'reveal');
  for (const m of [{ t: 'ask', q: 'leb' }, { t: 'guess', id: 'hund' }, { t: 'skip' }]) assert.equal(E.handle(g, 'p1', m).ok, false);
  assert.equal(E.handle(g, 'p1', { t: 'next' }).ok, false, 'Gast darf nicht weiter');
  assert.equal(E.handle(g, 'p0', { t: 'next', r: 2 }).ok, false, 'falsche Runde');
  assert.ok(E.handle(g, 'p0', { t: 'next' }).ok);
  assert.equal(g.round, 1); assert.equal(g.phase, 'ask');
  assert.equal(E.handle(g, 'p0', { t: 'next' }).ok, false, 'nicht in Frage-Phase');
});

// ---------------------------------------------------------------- Rundenwechsel, Ende, Rangliste
test('Rundenwechsel: Fragen und Fehlversuche werden gelöscht, Punkte bleiben, Startperson wechselt reihum', () => {
  const g = mk(3, {}, 8);
  const starts = [];
  for (let r = 0; r < 5; r++) {
    assert.equal(g.round, r); starts.push(g.turn);
    assert.deepEqual(g.asked, []); assert.deepEqual(g.wrong, []); assert.equal(g.reveal, null);
    const before = { ...g.scores };
    E.handle(g, g.players[g.turn].id, { t: 'ask', q: 'leb' });
    E.handle(g, g.players[g.turn].id, { t: 'guess', id: wrongTerm(g) });
    const who = g.players[g.turn].id;
    assert.ok(E.handle(g, who, { t: 'guess', id: E.secret(g).id }).right);
    assert.equal(g.scores[who], before[who] + E.pointsFor(1));
    assert.ok(E.handle(g, g.host, { t: 'next' }).ok);
  }
  assert.deepEqual(starts, [0, 1, 2, 0, 1]);
  assert.equal(g.phase, 'over');
  assert.equal(g.results.length, 5);
  assert.equal(E.handle(g, 'p0', { t: 'ask', q: 'leb' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'next' }).ok, false);
  assert.equal(E.handle(g, 'p0', { t: 'guess', id: 'hund' }).ok, false);
  const total = Object.values(g.scores).reduce((a, b) => a + b, 0);
  assert.equal(total, g.results.reduce((a, r) => a + r.pts, 0) - 5, 'Punktebilanz (je Runde ein Fehlversuch)');
});
test('Rangliste: sortiert, gleiche Punkte gleicher Rang, Sieger', () => {
  const g = mk(4);
  g.scores = { p0: 5, p1: 12, p2: 5, p3: -1 };
  const rk = E.ranking(g);
  assert.deepEqual(rk.map((r) => [r.id, r.rank]), [['p1', 1], ['p0', 2], ['p2', 2], ['p3', 4]]);
  assert.deepEqual(E.winners(g).map((w) => w.id), ['p1']);
  g.scores.p0 = 12;
  assert.deepEqual(E.winners(g).map((w) => w.id), ['p0', 'p1'], 'Reihenfolge der Anmeldung bleibt');
});
test('skip: nur Gastgeber, nur mit mehreren Personen, nur in der Frage-Phase', () => {
  const g = mk(3, {}, 9);
  assert.equal(E.handle(g, 'p1', { t: 'skip' }).ok, false);
  assert.ok(E.handle(g, 'p0', { t: 'skip' }).ok);
  assert.equal(g.turn, 1); assert.equal(g.asked.length, 0); assert.equal(g.scores.p0, 0);
  assert.equal(E.handle(mk(1), 'p0', { t: 'skip' }).ok, false);
});

// ---------------------------------------------------------------- JSON und Zufallspartien
test('Zustand ist JSON-sicher (Rundreise, auch mitten im Spiel)', () => {
  const g = mk(3, {}, 10);
  E.handle(g, 'p0', { t: 'ask', q: 'leb' }); E.handle(g, 'p1', { t: 'guess', id: wrongTerm(g) });
  const copy = JSON.parse(JSON.stringify(g));
  assert.deepEqual(copy, g);
  assert.ok(E.handle(copy, 'p2', { t: 'ask', q: 'men' }).ok);
  assert.equal(copy.asked.length, 2);
});
test('250 Zufallspartien (1 bis 6 Personen, wilde Eingaben) enden immer; Bilanzen stimmen', () => {
  for (let seed = 1; seed <= 250; seed++) {
    const rng = seedRng(seed);
    const n = 1 + (seed % 6);
    const g = mk(n, { kurz: seed % 3 === 0 }, seed);
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 20000) {
      if (g.phase === 'reveal') { assert.ok(E.handle(g, g.host, { t: 'next' }, rng).ok); continue; }
      const who = g.players[g.turn].id;
      const c = rng();
      let m;
      if (c < 0.04) m = { t: 'ask', q: 'unsinn' };
      else if (c < 0.08) m = { t: 'guess', id: 'unsinn' };
      else if (c < 0.12) m = { t: 'next' };
      else if (c < 0.16 && n > 1 && g.asked.length < FRAGEN.length) { m = { t: 'ask', q: freeQ(g) }; assert.equal(E.handle(g, g.players[(g.turn + 1) % n].id, m).ok, false); }
      else if (c < 0.62 && g.asked.length < FRAGEN.length) m = { t: 'ask', q: FRAGEN[Math.floor(rng() * FRAGEN.length)].id };
      else { const pool = BEGRIFFE.filter((b) => b.k === E.category(g)); m = { t: 'guess', id: pool[Math.floor(rng() * pool.length)].id }; }
      const before = JSON.stringify(g);
      const r = E.handle(g, who, m, rng);
      if (!r.ok) assert.equal(JSON.stringify(g), before, 'abgelehnte Nachricht darf nichts ändern: ' + JSON.stringify(m));
      assert.ok(g.asked.length <= FRAGEN.length);
      assert.ok(new Set(g.asked.map((x) => x.q)).size === g.asked.length);
    }
    assert.equal(g.phase, 'over', 'Partie ' + seed);
    assert.equal(g.results.length, g.len);
    const sum = Object.values(g.scores).reduce((a, b) => a + b, 0);
    const wrongs = Object.values(g.stats).reduce((a, s) => a + s.wrong, 0);
    const rights = Object.values(g.stats).reduce((a, s) => a + s.right, 0);
    assert.equal(rights, g.len);
    assert.equal(sum, g.results.reduce((a, r) => a + r.pts, 0) - wrongs, 'Punktebilanz');
    for (const r of g.results) assert.ok(r.pts >= 2 && r.pts <= 10);
    assert.equal(E.ranking(g)[0].rank, 1);
  }
});
