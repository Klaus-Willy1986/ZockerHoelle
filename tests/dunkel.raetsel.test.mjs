import test from 'node:test';
import assert from 'node:assert/strict';
import { RAETSEL } from '../dunkel/raetsel.js';
import { LERN } from '../dunkel/tutorial.js';

// Verbotene Wörter (Wortanfang, ohne Beachtung der Groß-/Kleinschreibung). Das Spiel ist familienfreundlich.
const VERBOTEN = [
  'mord', 'mörder', 'mörd', 'ermord', 'tod', 'töd', 'tot', 'tote', 'toten', 'toter', 'totes', 'leiche', 'suizid', 'selbstmord', 'erschie', 'erschoss',
  'pistole', 'revolver', 'gewehr', 'messer', 'dolch', 'schwert', 'blut', 'töte', 'tötet', 'tötung', 'stirbt', 'stirb', 'sterb', 'gestorben', 'umbring', 'umgebracht',
  'waffe', 'gift', 'vergift', 'ertrink', 'ertrank', 'ertrunken', 'sarg', 'beerdig', 'beerdigung', 'friedhof', 'hinricht', 'kill', 'erwürg', 'erhäng', 'erstick',
  'verletz', 'verwund', 'schuss', 'schüsse', 'bombe', 'terror', 'entführ', 'vergewalt', 'folter', 'selbstverletz', 'verbrechen', 'verbrecher',
  'wunde', 'krebs', 'unfall', 'absturz', 'abgestürzt', 'ertränk', 'opfer', 'geisel',
];
const words = (t) => t.toLowerCase().match(/[a-zäöüß]+/g) || [];
const all = [...RAETSEL, LERN.riddle];

test('Mindestmengen und Pflichtfelder', () => {
  assert.ok(RAETSEL.length >= 60, `nur ${RAETSEL.length} Rätsel`);
  for (const r of RAETSEL) {
    for (const k of ['id', 'titel', 'geschichte', 'loesung']) assert.ok(typeof r[k] === 'string' && r[k].trim().length > 0, `${r.id}: ${k}`);
    assert.ok([1, 2, 3].includes(r.schwer), `${r.id}: schwer`);
    assert.ok(Array.isArray(r.hinweise) && r.hinweise.length === 3, `${r.id}: genau 3 Hinweise`);
    for (const h of r.hinweise) assert.ok(typeof h === 'string' && h.trim().length >= 10, `${r.id}: Hinweis leer/kurz`);
  }
});

test('Längen: Geschichte höchstens 280 Zeichen, Lösung höchstens 360, Hinweise höchstens 160', () => {
  for (const r of all) {
    assert.ok(r.geschichte.length <= 280, `${r.id}: Geschichte ${r.geschichte.length}`);
    assert.ok(r.loesung.length <= 360, `${r.id}: Lösung ${r.loesung.length}`);
    for (const h of r.hinweise) assert.ok(h.length <= 160, `${r.id}: Hinweis ${h.length}`);
    assert.ok(r.geschichte.length >= 60, `${r.id}: Geschichte zu kurz`);
  }
});

test('Keine Duplikate bei Ids, Titeln und Geschichten', () => {
  for (const key of ['id', 'titel', 'geschichte', 'loesung']) {
    const set = new Set(RAETSEL.map((r) => r[key].trim().toLowerCase()));
    assert.equal(set.size, RAETSEL.length, `Duplikate bei ${key}`);
  }
  const hs = RAETSEL.flatMap((r) => r.hinweise.map((h) => h.toLowerCase()));
  assert.equal(new Set(hs).size, hs.length, 'doppelter Hinweistext');
});

test('Hinweise verraten nicht die ganze Lösung', () => {
  const norm = (t) => t.toLowerCase().replace(/[^a-zäöüß ]/g, '').replace(/\s+/g, ' ').trim();
  for (const r of RAETSEL) {
    const l = norm(r.loesung);
    assert.ok(!norm(r.hinweise[0]).includes(l), `${r.id}: Hinweis 1 enthält die Lösung`);
    for (const h of r.hinweise) assert.ok(!norm(h).includes(l) && !norm(h).includes(norm(r.loesung.split('.')[0])), `${r.id}: Hinweis enthält Lösungssatz`);
    // Hinweis 1 darf nicht (fast) so lang sein wie die Lösung
    assert.ok(r.loesung.length < 60 || r.hinweise[0].length < r.loesung.length, `${r.id}: Hinweis 1 länger als Lösung`);
    // Hinweis 1 teilt nicht zu viele Inhaltswörter mit der Lösung
    const lw = new Set(words(r.loesung).filter((w) => w.length >= 6));
    const shared = words(r.hinweise[0]).filter((w) => w.length >= 6 && lw.has(w));
    assert.ok(shared.length <= 1, `${r.id}: Hinweis 1 nennt zu viele Lösungswörter: ${shared}`);
  }
});

test('Hinweise werden nach hinten deutlicher (nicht kürzer als halb so lang wie vorher ist kein Muss, aber Hinweis 3 verrät mehr als Hinweis 1)', () => {
  for (const r of RAETSEL) {
    const lw = new Set(words(r.loesung).filter((w) => w.length >= 5));
    const score = (h) => words(h).filter((w) => lw.has(w)).length;
    assert.ok(score(r.hinweise[2]) >= score(r.hinweise[0]), `${r.id}: Hinweis 3 nicht deutlicher als Hinweis 1`);
  }
});

test('Keine verbotenen Wörter (familienfreundlich)', () => {
  for (const r of all) {
    const text = [r.titel, r.geschichte, r.loesung, ...r.hinweise].join(' ');
    for (const w of words(text)) {
      for (const v of VERBOTEN) {
        // "tot" und "tod" nur als ganze Wörter bzw. Formen prüfen, sonst träfe es "total" usw.
        if (['tot', 'tod', 'sarg', 'gift', 'kill', 'opfer', 'wunde'].includes(v)) {
          assert.ok(!(w === v || (v === 'tot' && /^tot(e|en|er|es|em)$/.test(w)) || (v === 'tod' && /^tod(e|es)?$/.test(w))), `${r.id}: verbotenes Wort "${w}"`);
        } else {
          assert.ok(!w.startsWith(v), `${r.id}: verbotenes Wort "${w}" (${v})`);
        }
      }
    }
  }
});

test('Sprachliche Mindeststandards: Satzzeichen, keine doppelten Leerzeichen, deutsche Anführungszeichen', () => {
  for (const r of all) {
    for (const t of [r.geschichte, r.loesung, ...r.hinweise]) {
      assert.ok(/[.!?“]$/.test(t), `${r.id}: Satzende fehlt: ${t.slice(-20)}`);
      assert.ok(!/ {2}/.test(t) && !/^\s|\s$/.test(t), `${r.id}: Leerzeichen`);
      assert.ok(!/"/.test(t), `${r.id}: gerades Anführungszeichen`);
    }
  }
});

test('Schwierigkeiten sind gemischt, genug leichte Rätsel', () => {
  const n = (s) => RAETSEL.filter((r) => r.schwer === s).length;
  assert.ok(n(1) >= 12 && n(2) >= 12 && n(3) >= 8, `1:${n(1)} 2:${n(2)} 3:${n(3)}`);
});

test('Lernrunden-Rätsel ist vollständig', () => {
  assert.equal(LERN.table.length, 4);
  assert.deepEqual(LERN.table.map((t) => t.a).sort(), ['egal', 'fast', 'ja', 'nein']);
  assert.deepEqual(LERN.guesses.map((g) => g.v).sort(), ['falsch', 'fast', 'richtig']);
  assert.ok(!RAETSEL.some((r) => r.id === LERN.riddle.id));
});
