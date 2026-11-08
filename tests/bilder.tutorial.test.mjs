import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../bilder/engine.js';
import { coach } from '../bilder/tutorial.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const SEL = /^[\[\]\w=":.,\s()>-]+$/;
const P = [{ id: 'p0', name: 'Du' }];
const mkCtx = () => ({ id: 'p0', ui: { mode: 'fill', msg: null, newPanel: false, coachSeen: {} } });

function check(r, where) {
  if (r === null) return;
  assert.equal(typeof r, 'object', where);
  assert.ok(typeof r.text === 'string' && r.text.trim().length > 0 && r.text.length <= 220, `${where}: Text "${r.text}"`);
  assert.ok(!/[…„“”"]/.test(r.text) && !/\d{3,}/.test(r.text), `${where}: Sonderzeichen in "${r.text}"`);
  if (r.target !== undefined) assert.ok(typeof r.target === 'string' && SEL.test(r.target), `${where}: Selektor ${r.target}`);
}

// Führt die Anweisung des Coachs so aus, wie ein Mensch das leuchtende Ziel antippen würde.
function follow(g, ctx, r) {
  const t = r.target;
  let m;
  if ((m = /^\[data-cell="(\d+)"\]$/.exec(t))) {
    const i = Number(m[1]);
    assert.equal(E.apply(g, 'p0', { t: 'set', i, v: E.tapValue(g.cells[i], ctx.ui.mode) }).ok, true);
    return 'cell';
  }
  if (t === '[data-act=mode-fill]') { ctx.ui.mode = 'fill'; return 'fill'; }
  if (t === '[data-act=mode-cross]') { ctx.ui.mode = 'cross'; return 'cross'; }
  if (t === '[data-act=undo]') { assert.equal(E.apply(g, 'p0', { t: 'undo' }).ok, true); return 'undo'; }
  if (t === '[data-act=check]') { assert.equal(E.apply(g, 'p0', { t: 'check' }).ok, true); return 'check'; }
  if (t === '[data-act=new-cancel]') { ctx.ui.newPanel = false; return 'cancel'; }
  if (t === '[data-act=again]') return 'again';
  assert.fail('unbekanntes Ziel ' + t);
}

test('Lernrunde: nur dem Ziel folgen führt zum Ende', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  let steps = 0, last = '';
  const seen = [], kinds = [];
  while (steps++ < 60) {
    const r = coach(g, ctx);
    assert.ok(r, 'kein Coach');
    check(r, 'Lernrunde');
    seen.push(r.text);
    assert.ok(r.target, 'Ziel fehlt');
    last = follow(g, ctx, r);
    kinds.push(last);
    if (last === 'again') break;
  }
  assert.equal(last, 'again');
  assert.equal(g.mode, 'over');
  assert.ok(steps <= 25, `${steps} Schritte`);
  assert.match(coach(g, ctx).text, /Herz ausgemalt/);
  // alle Bedienschritte kommen vor: ausmalen, Leer markieren, Prüfen
  assert.ok(kinds.includes('cell') && kinds.includes('cross') && kinds.includes('check') && kinds.includes('fill'), kinds.join(','));
  assert.ok(g.checks >= 1 && g.hints === 0, 'geprüft, ohne Hilfe');
  assert.ok(g.cells.some((x) => x === 2), 'ein Kreuz wurde gesetzt');
  // jede Erklärung nur einmal (außer dem knappen Standardsatz)
  const GENERIC = 'Tippe auf das leuchtende Feld.';
  const expl = seen.filter((t) => t !== GENERIC);
  assert.equal(new Set(expl).size, expl.length, 'Erklärung doppelt: ' + expl.join(' | '));
  assert.ok(new Set(seen).size >= 8, 'abwechslungsreiche Texte');
  const all = seen.join(' | ');
  for (const w of [/Zahlen/, /ziehen/, /Kreuz/, /Prüfen/, /Häkchen/]) assert.match(all, w);
});

test('Lernrunde: Text bleibt bei wiederholtem Zeichnen gleich (kein Verbrauchen)', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  const a = coach(g, ctx), b = coach(g, ctx), c = coach(g, ctx);
  assert.equal(a.text, b.text); assert.equal(b.text, c.text);
  assert.match(a.text, /Willkommen/);
});

test('Lernrunde: falsches Feld → Coach bietet Zurück an, danach geht es weiter', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  const i = g.sol.indexOf('0');
  E.apply(g, 'p0', { t: 'set', i, v: 1 });
  const r = coach(g, ctx);
  check(r, 'falsch');
  assert.equal(r.target, '[data-act=undo]');
  assert.match(r.text, /passt nicht/);
  follow(g, ctx, r);
  assert.match(coach(g, ctx).target, /data-cell/);
  // Kreuz auf ein Feld, das ausgemalt werden muss, ist ebenfalls falsch
  const j = g.sol.indexOf('1');
  E.apply(g, 'p0', { t: 'set', i: j, v: 2 });
  assert.equal(coach(g, ctx).target, '[data-act=undo]');
});

test('Lernrunde: Modus passend zum Schritt, Neues-Rätsel-Fenster, beliebige Reihenfolge', () => {
  const g = E.createGame(P, { learn: true });
  const ctx = mkCtx();
  ctx.ui.mode = 'cross';
  assert.equal(coach(g, ctx).target, '[data-act=mode-fill]', 'Ausmalen muss gewählt sein');
  ctx.ui.mode = 'fill';
  ctx.ui.newPanel = true;
  check(coach(g, ctx), 'Panel');
  assert.equal(coach(g, ctx).target, '[data-act=new-cancel]');
  ctx.ui.newPanel = false;
  // ein anderes richtiges Feld zuerst: Coach bleibt bei der ersten Zeile
  const other = g.sol.lastIndexOf('1');
  E.apply(g, 'p0', { t: 'set', i: other, v: 1 });
  assert.match(coach(g, ctx).target, /data-cell/);
  // Kreuz-Schritt: erst Zeilen fertig, dann Leer markieren
  const gg = E.createGame(P, { learn: true });
  for (let i = 5; i < 15; i++) E.apply(gg, 'p0', { t: 'set', i, v: 1 });
  assert.equal(coach(gg, mkCtx()).target, '[data-act=mode-cross]');
  const c2 = mkCtx(); c2.ui.mode = 'cross';
  assert.equal(coach(gg, c2).target, '[data-cell="0"]');
  // Kreuz gesetzt, Modus noch Kreuz → zurück zu Ausmalen
  E.apply(gg, 'p0', { t: 'set', i: 0, v: 2 });
  assert.equal(coach(gg, c2).target, '[data-act=mode-fill]');
});

test('Normale Spiele: Coach verrät keine Felder und keine Lösung', () => {
  const rng = seeded(4);
  for (const L of E.LEVELS) {
    const g = E.createGame(P);
    assert.equal(coach(g, mkCtx()), null, 'Auswahl-Modus');
    E.apply(g, 'p0', { t: 'new', level: L.id }, rng);
    const r = coach(g, mkCtx());
    check(r, 'normal');
    assert.equal(r.target, undefined, 'kein Ziel in normalen Spielen');
    assert.ok(!/\d/.test(r.text), 'keine Ziffern im Text');
    assert.ok(!r.text.includes(g.name), 'Bildname nicht verraten');
  }
});

test('Zufallszustände: Coach liefert immer gültigen Text oder null', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const rng = seeded(seed);
    const g = E.createGame(P, { learn: seed % 2 === 0 });
    if (g.mode === 'choose') E.apply(g, 'p0', { t: 'new', level: E.LEVELS[seed % 3].id }, rng);
    const ctx = mkCtx();
    for (let n = 0; n < 150 && g.mode === 'play'; n++) {
      ctx.ui.mode = rng() < 0.4 ? 'cross' : 'fill';
      ctx.ui.newPanel = rng() < 0.1;
      check(coach(g, ctx), `seed ${seed} n ${n}`);
      const t = ['set', 'set', 'paint', 'undo', 'check', 'reveal', 'clear'][Math.floor(rng() * 7)];
      const N = g.n * g.n;
      E.apply(g, 'p0', t === 'paint'
        ? { t, cells: [0, 1, 2].map((k) => Math.floor(rng() * N)), v: Math.floor(rng() * 3), from: 1 }
        : { t, i: Math.floor(rng() * N), v: Math.floor(rng() * 3) }, rng);
    }
    check(coach(g, ctx), 'Ende');
  }
});

test('Coach wirft nie bei kaputten Eingaben', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { mode: 'play' }, { mode: 'play', cells: [] }, { mode: 'over' }, { mode: 'play', cells: 'abc', level: 'lern' }, { mode: 'play', cells: [], sol: 5, level: 'lern', n: 5 }]) {
    for (const ctx of [undefined, null, {}, { ui: null }, { ui: 5 }, mkCtx()]) {
      assert.doesNotThrow(() => coach(bad, ctx));
      check(coach(bad, ctx), 'kaputt');
    }
  }
  const g = E.createGame(P, { learn: true });
  for (const mode of [NaN, 'a', 1e9, null, undefined, {}]) {
    const ctx = mkCtx(); ctx.ui.mode = mode;
    assert.doesNotThrow(() => coach(g, ctx));
    check(coach(g, ctx), 'mode ' + String(mode));
  }
});
