import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../wortsuche/engine.js';
import { THEMEN, THEMA_IDS } from '../wortsuche/woerter.js';

const seeded = (s) => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rev = (s) => [...s].reverse().join('');
const NEED = ['tiere', 'obstgemuese', 'berufe', 'staedte', 'laender', 'haushalt', 'natur', 'sport', 'instrumente', 'kleidung', 'koerper', 'essen'];

test('mindestens 10 Themen, die geforderten sind alle da', () => {
  assert.ok(THEMA_IDS.length >= 10);
  for (const id of NEED) assert.ok(THEMEN[id], 'Thema ' + id);
  assert.match(THEMEN.tiere.name, /^Tiere /);
  for (const id of THEMA_IDS) assert.ok(/\p{Extended_Pictographic}/u.test(THEMEN[id].name), 'Emoji im Namen: ' + id);
});

test('jedes Thema: mindestens 30 Wörter, A–Z, Länge 4–10, keine Duplikate, keine Palindrome', () => {
  for (const id of THEMA_IDS) {
    const ws = THEMEN[id].woerter;
    assert.ok(ws.length >= 30, `${id}: ${ws.length} Wörter`);
    assert.equal(new Set(ws).size, ws.length, `${id}: Duplikate`);
    for (const x of ws) {
      assert.match(x, /^[A-Z]{4,10}$/, `${id}: ${x}`);
      assert.notEqual(x, rev(x), `${id}: Palindrom ${x}`);
    }
    // genug kurze Wörter für das leichte 8x8-Gitter und genug nicht ineinander enthaltene für alle Stufen
    assert.ok(ws.filter((x) => x.length <= 8).length >= 20, `${id}: zu wenige kurze Wörter`);
  }
});

test('keine Umlaut-Ersatzschreibungen (AE/OE/UE für Ä/Ö/Ü): Die Listen kommen ohne Umlaute aus', () => {
  // Wörter mit echtem AE/OE/UE (z. B. BAUER, QUELLE, OBOE) sind erlaubt, bekannte Ersatzschreibungen nicht.
  const ersatz = /KAESE|MUESLI|LOEWE|BAER$|KUERBIS|BUERSTE|MUETZE|FLOETE|BAECKER|GAERTNER|JAEGER|MUENCHEN|KOELN|NUERNBERG|DUESSEL|LUEBECK|ZUERICH|OESTERREICH|AEGYPTEN|TUERKEI|DAENEMARK|RUMAENIEN|LOEFFEL|SCHUESSEL|KUEHLSCHRANK|SCHLUESSEL|HUEGEL|KUESTE|DUENE|SAENGER|KROETE|MUECKE|KAENGURU|KNOEDEL|RUECKEN|HUEFTE|KNOECHEL|STUEHL|GUERTEL|SCHUERZE|KOSTUEM|VERKAEUFER|SEKRETAER/;
  for (const id of THEMA_IDS) for (const x of THEMEN[id].woerter) assert.ok(!ersatz.test(x), `${id}: ${x}`);
});

test('jedes Thema liefert in jeder Stufe gültige Gitter (je 60)', () => {
  for (const id of THEMA_IDS) {
    for (const stufe of E.STUFE_IDS) {
      for (let seed = 1; seed <= 60; seed++) {
        const g = E.createGame([{ id: 'a', name: 'A' }], { stufe, theme: id }, seeded(seed * 31 + id.length));
        assert.equal(g.theme.id, id);
        assert.equal(g.words.length, E.STUFEN[stufe].count);
        for (const wd of g.words) assert.equal(E.occurrences(g.letters, g.n, wd.w).length, 1);
      }
    }
  }
});
