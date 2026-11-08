import test from 'node:test';
import assert from 'node:assert/strict';
import { BEGRIFFE, KATEGORIEN } from '../zeichnen/begriffe.js';
import { normalize } from '../zeichnen/engine.js';

test('Mindestmengen: mindestens 300 Begriffe, 8 Kategorien mit je mindestens 35', () => {
  assert.ok(BEGRIFFE.length >= 300, 'Anzahl ' + BEGRIFFE.length);
  assert.deepEqual(KATEGORIEN, ['Tiere', 'Essen', 'Haushalt', 'Natur', 'Fahrzeuge', 'Berufe', 'Kleidung', 'Freizeit']);
  for (const k of KATEGORIEN) assert.ok(BEGRIFFE.filter((b) => b.k === k).length >= 35, k);
  assert.ok(BEGRIFFE.every((b) => KATEGORIEN.includes(b.k)));
});
test('Form: w Text, alt Liste, 1 bis 2 Wörter, Länge 3 bis 20', () => {
  for (const b of BEGRIFFE) {
    assert.equal(typeof b.w, 'string', JSON.stringify(b));
    assert.ok(Array.isArray(b.alt) && b.alt.every((a) => typeof a === 'string' && a.trim() === a && a.length > 0), b.w);
    const n = b.w.split(' ').length;
    assert.ok(n >= 1 && n <= 2, b.w);
    assert.ok(b.w.length >= 3 && b.w.length <= 20, b.w);
    assert.ok(b.alt.length <= 3, b.w);
  }
});
test('Zeichensatz: nur deutsche Buchstaben (und ein Leerzeichen), Großbuchstabe am Anfang', () => {
  const ok = /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]*( [A-ZÄÖÜ][A-Za-zÄÖÜäöüß]*)?$/;
  for (const b of BEGRIFFE) for (const w of [b.w, ...b.alt]) assert.ok(ok.test(w), `"${w}"`);
});
test('Keine Duplikate (auch nicht über Synonyme, ohne Groß/Klein/Umlaute)', () => {
  const seen = new Map();
  for (const b of BEGRIFFE) for (const w of [b.w, ...b.alt]) {
    const n = normalize(w);
    assert.ok(n.length >= 2, w);
    assert.ok(!seen.has(n), `Duplikat "${w}" (schon bei ${seen.get(n)})`);
    seen.set(n, b.w);
  }
  assert.equal(new Set(BEGRIFFE.map((b) => b.w.toLowerCase())).size, BEGRIFFE.length);
});
test('Kein Begriff steht als Name irgendeines anderen Spiels, keine Markenwörter, kein fremder Spielname', () => {
  const verboten = ['pictionary', 'lego', 'nutella', 'coca', 'pepsi', 'iphone', 'google', 'ikea', 'adidas', 'nike', 'volkswagen', 'bmw', 'mercedes', 'barbie', 'playmobil', 'haribo', 'tesla'];
  for (const b of BEGRIFFE) for (const w of [b.w, ...b.alt]) {
    const n = w.toLowerCase();
    for (const v of verboten) assert.ok(!n.startsWith(v) && !n.endsWith(v), `${w} enthält ${v}`);
  }
});
test('Die Zeichenraten-Dateien erwähnen keinen fremden Spielnamen', async () => {
  const fs = await import('node:fs'); const path = await import('node:path');
  const dir = path.join(import.meta.dirname, '..', 'zeichnen');
  for (const f of fs.readdirSync(dir)) assert.ok(!new RegExp('montags' + 'maler', 'i').test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
});
