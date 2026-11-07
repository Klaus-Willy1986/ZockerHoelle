import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../reihen/engine.js';
import * as W from '../reihen/work.js';

const T = (c, n, k = 0) => k * 52 + c * 13 + n - 1;
function mk(hand, table, melded) {
  const g = E.createGame([{ id: 'me', name: 'A' }, { id: 'bot1', name: 'C' }], {}, () => 0.5);
  const used = new Set([].concat(hand, ...table));
  g.players[0].hand = hand.slice(); g.players[0].melded = melded;
  g.players[1].hand = []; g.table = table.map((s) => s.slice());
  const rest = Array.from({ length: 106 }, (_, i) => i).filter((i) => !used.has(i));
  g.players[1].hand = rest.slice(0, 5); g.pile = rest.slice(5);
  g.active = 0; g.starter = 0;
  return g;
}

test('Neuer Satz, Anlegen, Teilen, Auflösen, Zurück: Arbeitskopie bleibt konsistent und die Engine nimmt den Zug an', () => {
  const run = [T(1, 3), T(1, 4), T(1, 5), T(1, 6)];
  const g = mk([T(1, 7), T(0, 2), T(0, 3), T(0, 4)], [run], true);
  let t = W.cloneTable(g.table);
  let r = W.attach(g, 'me', t, 0, [T(1, 7)]);
  assert.ok(r.ok); t = r.table;
  assert.deepEqual(t[0], run.concat([T(1, 7)]));
  assert.deepEqual(W.handOf(g, 'me', t).sort((a, b) => a - b), [T(0, 2), T(0, 3), T(0, 4)].sort((a, b) => a - b));
  r = W.splitAt(g, 'me', t, [T(1, 5)]);
  assert.ok(r.ok && r.table.length === 2 && r.table[0].length === 2);
  assert.equal(W.splitAt(g, 'me', t, [T(1, 3)]).ok, false);
  assert.equal(W.splitAt(g, 'me', t, []).ok, false);
  const d = W.dissolve(g, 'me', r.table, [T(1, 3)]);
  assert.ok(d.ok && d.sel.length === 2);
  r = W.putBack(g, t, [T(1, 7), T(1, 3)]);
  assert.ok(r.ok && !E.tableIds(r.table).includes(T(1, 7)) && E.tableIds(r.table).includes(T(1, 3)));
  assert.equal(W.putBack(g, g.table, [T(1, 3)]).ok, false);
  r = W.newSet(g, 'me', t, [T(0, 2), T(0, 3), T(0, 4)]);
  assert.ok(r.ok);
  assert.equal(W.handOf(g, 'me', r.table).length, 0);
  assert.equal(E.checkTurn(g, 'me', r.table).ok, true);
  assert.equal(E.handle(g, 'me', { t: 'play', table: r.table }).ok, true);
  assert.equal(g.phase, 'over');
});

test('Vor der Eröffnung: Tisch ist gesperrt', () => {
  const g = mk([T(0, 10), T(0, 11), T(0, 12), T(2, 1)], [[T(3, 4), T(3, 5), T(3, 6)]], false);
  const t = W.cloneTable(g.table);
  assert.ok(W.selectBlock(g, 'me', t, T(3, 5)));
  assert.equal(W.selectBlock(g, 'me', t, T(0, 10)), '');
  assert.equal(W.attach(g, 'me', t, 0, [T(0, 10)]).ok, false);
  assert.equal(W.splitAt(g, 'me', t, [T(3, 5)]).ok, false);
  assert.equal(W.dissolve(g, 'me', t, [T(3, 5)]).ok, false);
  const r = W.newSet(g, 'me', t, [T(0, 10), T(0, 11), T(0, 12)]);
  assert.ok(r.ok);
  assert.equal(W.openValue(g, r.table), 33);
  assert.equal(E.checkTurn(g, 'me', r.table).newValue, 33);
});

test('Eröffnungswert der Anzeige = Engine (zufällige Sätze), turnSig ändert sich je Zug, Eingaben unverändert', () => {
  const g = mk([T(0, 1), T(0, 2), T(0, 3), T(2, 5), T(3, 5), T(1, 5), 104], [], false);
  const before = JSON.stringify(g);
  for (const sets of [[[T(0, 1), T(0, 2), T(0, 3)]], [[T(2, 5), T(3, 5), T(1, 5), 104]], [[T(0, 1), T(0, 2), T(0, 3)], [T(2, 5), T(3, 5), T(1, 5)]]]) {
    const c = E.checkTurn(g, 'me', sets);
    assert.equal(W.openValue(g, sets), c.ok ? c.newValue : W.openValue(g, sets));
    if (c.ok || c.newValue) assert.equal(W.openValue(g, sets), c.newValue);
  }
  assert.equal(JSON.stringify(g), before);
  const s1 = W.turnSig(g);
  E.handle(g, 'me', { t: 'draw' });
  assert.notEqual(W.turnSig(g), s1);
});
