import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../zeichnen/draw.js';
import * as Q from '../zeichnen/engine.js';

function seedRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wave = (n, rng = seedRng(1)) => Array.from({ length: n }, (_, i) => D.toPoint(500 + 400 * Math.sin(i / 20) + rng() * 3, 500 + 400 * Math.cos(i / 17)));

test('toPoint rundet auf ganze Zahlen und klemmt auf 0..1000', () => {
  assert.deepEqual(D.toPoint(10.4, 20.6), [10, 21]);
  assert.deepEqual(D.toPoint(-5, 1200), [0, 1000]);
  assert.deepEqual(D.toPoint(0, 1000), [0, 1000]);
});
test('thin lässt nahe Punkte weg, behält Anfang und Ende', () => {
  const pts = [[0, 0], [1, 1], [2, 1], [5, 5], [5, 6], [20, 20], [21, 20]];
  const t = D.thin(pts);
  assert.deepEqual(t[0], [0, 0]);
  assert.deepEqual(t[t.length - 1], [21, 20]);
  for (let i = 1; i < t.length - 1; i++) assert.ok(Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]) >= D.MIN_DIST);
  assert.ok(t.length < pts.length);
  assert.deepEqual(D.thin([]), []);
  assert.deepEqual(D.thin([[3, 3]]), [[3, 3]]);
  assert.deepEqual(D.thin([[3, 3], [3, 3]]), [[3, 3]]);
});
test('chunks: höchstens 40 Punkte, nichts geht verloren, Reihenfolge bleibt', () => {
  for (const n of [0, 1, 39, 40, 41, 80, 81, 333]) {
    const pts = wave(n);
    const ch = D.chunks(pts);
    assert.ok(ch.every((c) => c.length >= 1 && c.length <= 40), `n=${n}`);
    assert.deepEqual(ch.flat(), pts);
    assert.equal(ch.length, Math.ceil(n / 40));
  }
});
test('strokeMessages: gültige Nachrichten, die die Engine annimmt und zu einem Strich zusammensetzt', () => {
  const g = Q.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { host: 'a', now: 0 }, seedRng(2));
  const d = Q.drawerId(g);
  const pts = D.thin(wave(500));
  const msgs = D.strokeMessages(pts, { c: 3, w: 2, k: 4 });
  assert.ok(msgs.length > 1);
  for (const m of msgs) {
    assert.equal(m.t, 'stroke'); assert.ok(m.pts.length <= 40);
    assert.ok(Q.handle(g, d, m, Math.random, 0));
  }
  assert.equal(g.strokes.length, 1);
  assert.deepEqual(g.strokes[0].p, pts);
  assert.deepEqual([g.strokes[0].c, g.strokes[0].w, g.strokes[0].k], [3, 2, 4]);
});
test('Größe: Nachricht höchstens ein paar hundert Byte, ganze Zeichnung bleibt klein', () => {
  const pts = D.thin(wave(2000));
  const msgs = D.strokeMessages(pts, { c: 1, w: 1, k: 1 });
  const max = Math.max(...msgs.map((m) => JSON.stringify(m).length));
  assert.ok(max < 600, `größte Nachricht ${max} Byte`);
  // Punkte sind ganze Zahlen
  assert.ok(msgs.every((m) => m.pts.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))));
  // eine kräftige Zeichnung (30 Striche à 150 Punkte) im Zustand
  const g = Q.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { host: 'a', now: 0 }, seedRng(2));
  for (let k = 1; k <= 30; k++) for (const m of D.strokeMessages(D.thin(wave(150, seedRng(k))), { c: k % 6, w: k % 3, k })) Q.handle(g, Q.drawerId(g), m, Math.random, 0);
  const size = JSON.stringify(g).length;
  assert.ok(g.strokes.length === 30 && size < 60000, `Zustand ${size} Byte`);
});
test('Farben und Breiten', () => {
  assert.equal(D.colorOf({ c: 6 }), '#ffffff');
  assert.equal(D.colorOf({ c: 1 }), Q.COLORS[1]);
  assert.ok(D.widthOf({ c: 6, w: 0 }) > D.widthOf({ c: 0, w: 0 }), 'Radierer ist breiter');
  assert.ok(D.WIDTHS[0] < D.WIDTHS[1] && D.WIDTHS[1] < D.WIDTHS[2]);
  assert.equal(Q.COLORS.length, 6);
});
test('paintStroke/paintAll mit Attrappe: Punkt als Kreis, Linie als Pfad, Fläche weiß', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : (...a) => calls.push([k, ...a])), set: (_, k, v) => { calls.push(['set', k, v]); return true; } });
  D.paintAll(ctx, [{ k: 1, c: 0, w: 1, p: [[100, 100]] }, { k: 2, c: 6, w: 0, p: [[0, 0], [500, 500], [1000, 1000]] }, { k: 3, c: 1, w: 0, p: [] }], 362);
  const names = calls.map((c) => c[0]);
  assert.ok(names.includes('fillRect') && names.includes('arc') && names.includes('lineTo') && names.includes('stroke'));
  assert.equal(names.filter((n) => n === 'moveTo').length, 1);
  const rect = calls.find((c) => c[0] === 'fillRect');
  assert.deepEqual(rect.slice(1), [0, 0, 362, 362]);
  const lines = calls.filter((c) => c[0] === 'lineTo');
  assert.deepEqual(lines[lines.length - 1].slice(1), [362, 362]);
  D.paintStroke(ctx, null, 1); D.paintStroke(ctx, { p: 'x' }, 1);
});
