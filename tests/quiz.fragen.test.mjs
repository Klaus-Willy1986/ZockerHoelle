// Prüftest der echten Fragensammlung quiz/fragen.js (Struktur, Eindeutigkeit, Mengen, Verteilung).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAGEN, KATEGORIEN } from '../quiz/fragen.js';

const KATS = ['allgemein', 'essen', 'natur', 'geschichte', 'erde', 'sprichwort', 'musik', 'film', 'hessen', 'sport', 'kurios'];
const TYPEN = ['mc', 'tf', 'est', 'order'];
const STEUER = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]');
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const anzahl = (f) => FRAGEN.filter(f).length;

function alleTexte(q) {
  const t = [q.id, q.q];
  if (q.t === 'mc') t.push(...q.a);
  if (q.t === 'order') t.push(...q.items);
  if (q.unit) t.push(q.unit);
  if (q.fun) t.push(q.fun);
  return t;
}

test('Kategorien: alle elf vorhanden, mit Anzeigename', () => {
  assert.deepEqual(Object.keys(KATEGORIEN).sort(), [...KATS].sort());
  for (const k of KATS) assert.ok(nonEmpty(KATEGORIEN[k]), k);
});

test('Struktur: Felder je Typ', () => {
  for (const q of FRAGEN) {
    const w = q.id;
    assert.ok(nonEmpty(q.id) && /^[mwso]\d{3}$/.test(q.id), `id ${w}`);
    assert.ok(TYPEN.includes(q.t), `Typ ${w}`);
    assert.ok(KATS.includes(q.k), `Kategorie ${w}`);
    assert.ok(q.d === 1 || q.d === 2, `Schwierigkeit ${w}`);
    assert.ok(nonEmpty(q.q), `Fragetext ${w}`);
    if (q.fun !== undefined) assert.ok(nonEmpty(q.fun), `fun ${w}`);
    if (q.t === 'mc') {
      assert.ok(q.id.startsWith('m'), w);
      assert.ok(Array.isArray(q.a) && q.a.length === 4, `4 Antworten ${w}`);
      assert.ok(q.a.every(nonEmpty), `Antworten nicht leer ${w}`);
      assert.equal(new Set(q.a.map(norm)).size, 4, `Antworten verschieden ${w}`);
      assert.ok(Number.isInteger(q.c) && q.c >= 0 && q.c <= 3, `c im Bereich ${w}`);
    } else if (q.t === 'tf') {
      assert.ok(q.id.startsWith('w'), w);
      assert.equal(typeof q.c, 'boolean', `c boolean ${w}`);
    } else if (q.t === 'est') {
      assert.ok(q.id.startsWith('s'), w);
      assert.ok([q.c, q.min, q.max].every(Number.isFinite), `Zahlen ${w}`);
      assert.ok(q.min < q.max, `min<max ${w}`);
      assert.ok(q.min <= q.c && q.c <= q.max, `min<=c<=max ${w}`);
      assert.equal(typeof q.unit, 'string', `unit ${w}`);
    } else {
      assert.ok(q.id.startsWith('o'), w);
      assert.ok(Array.isArray(q.items) && q.items.length === 4, `4 Elemente ${w}`);
      assert.ok(q.items.every(nonEmpty), `Elemente nicht leer ${w}`);
      assert.equal(new Set(q.items.map(norm)).size, 4, `Elemente verschieden ${w}`);
    }
  }
});

test('Eindeutigkeit: ids und Fragetexte', () => {
  const ids = FRAGEN.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'ids doppelt');
  const texte = FRAGEN.map((q) => norm(q.q));
  const doppelt = texte.filter((t, i) => texte.indexOf(t) !== i);
  assert.deepEqual(doppelt, [], 'Fragetexte doppelt');
});

test('Mindestmengen', () => {
  assert.ok(FRAGEN.length >= 360, `gesamt ${FRAGEN.length}`);
  for (const k of KATS) assert.ok(anzahl((q) => q.k === k) >= 25, `Kategorie ${k}`);
  assert.ok(anzahl((q) => q.t === 'est') >= 20, 'Schätzfragen');
  assert.ok(anzahl((q) => q.t === 'order') >= 15, 'Ordnenfragen');
  assert.ok(anzahl((q) => q.t === 'tf') >= 50, 'Wahr/Falsch');
  assert.ok(anzahl((q) => q.t === 'mc') >= 180, 'Mehrfachauswahl');
});

test('Typ-Anteile ungefähr wie geplant', () => {
  const n = FRAGEN.length;
  const p = (t) => anzahl((q) => q.t === t) / n;
  assert.ok(p('mc') > 0.45 && p('mc') < 0.65, `mc ${p('mc')}`);
  assert.ok(p('tf') > 0.14 && p('tf') < 0.26, `tf ${p('tf')}`);
  assert.ok(p('est') > 0.1 && p('est') < 0.2, `est ${p('est')}`);
  assert.ok(p('order') > 0.07 && p('order') < 0.14, `order ${p('order')}`);
});

test('Schwierigkeit: etwa zwei Drittel leicht', () => {
  const leicht = anzahl((q) => q.d === 1) / FRAGEN.length;
  assert.ok(leicht > 0.55 && leicht < 0.75, `leicht ${leicht}`);
});

test('mc: richtige Antwort gleichmäßig auf A–D verteilt (je 18–32 %)', () => {
  const mc = FRAGEN.filter((q) => q.t === 'mc');
  for (let pos = 0; pos < 4; pos++) {
    const anteil = mc.filter((q) => q.c === pos).length / mc.length;
    assert.ok(anteil >= 0.18 && anteil <= 0.32, `Position ${pos}: ${anteil}`);
  }
  // kein auffälliges Muster: nie mehr als 5 gleiche richtige Positionen hintereinander
  let lauf = 1, max = 1;
  for (let i = 1; i < mc.length; i++) { lauf = mc[i].c === mc[i - 1].c ? lauf + 1 : 1; max = Math.max(max, lauf); }
  assert.ok(max <= 5, `Serie gleicher Positionen: ${max}`);
});

test('Wahr/Falsch: beides kommt ausgewogen vor', () => {
  const tf = FRAGEN.filter((q) => q.t === 'tf');
  const wahr = tf.filter((q) => q.c === true).length / tf.length;
  assert.ok(wahr >= 0.35 && wahr <= 0.65, `wahr ${wahr}`);
});

test('fun-Kommentare: Länge und Anteil', () => {
  const mit = FRAGEN.filter((q) => q.fun);
  for (const q of mit) assert.ok(q.fun.length <= 90, `${q.id} fun ${q.fun.length} Zeichen`);
  const anteil = mit.length / FRAGEN.length;
  assert.ok(anteil >= 0.5 && anteil <= 0.72, `fun-Anteil ${anteil}`);
});

test('Texte: keine Zeilenumbrüche/Steuerzeichen, kein TODO, keine überflüssigen Leerzeichen', () => {
  for (const q of FRAGEN) {
    for (const t of alleTexte(q)) {
      assert.ok(!STEUER.test(t), `Steuerzeichen in ${q.id}: ${JSON.stringify(t)}`);
      assert.ok(!/todo/i.test(t), `TODO in ${q.id}`);
      assert.equal(t, t.trim(), `Leerraum am Rand in ${q.id}`);
      assert.ok(!/ {2}/.test(t), `Doppeltes Leerzeichen in ${q.id}`);
    }
  }
});

test('Fragen enden mit Fragezeichen, Doppelpunkt oder Punkt', () => {
  for (const q of FRAGEN) assert.match(q.q, /[?.:)“]$/, `Ende ${q.id}: ${q.q}`);
});
