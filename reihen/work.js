// Reihen & Gruppen – Arbeitskopie für den eigenen Zug (reine Funktionen, kein DOM, kein Netzwerk).
// Die Oberfläche hält eine Kopie des Tisches (Liste von Sätzen). Die Hand ergibt sich daraus: Hand = echte Hand minus alles, was in der Kopie liegt.
// Alle Funktionen liefern neue Listen und ändern ihre Eingaben nie. Geprüft wird erst von der Engine (checkTurn / play).
import * as E from './engine.js';

export const cloneTable = (t) => (Array.isArray(t) ? t.map((s) => (Array.isArray(s) ? s.slice() : [])) : []);
export const oldIds = (state) => new Set(E.tableIds(state.table));
export const meOf = (state, pid) => (state && Array.isArray(state.players) ? state.players.find((p) => p.id === pid) || null : null);

// Eindeutige Marke für „diese Lage im Spiel“ (ändert sich bei jedem Zug), damit die Arbeitskopie nur bei neuer Lage neu beginnt.
export const turnSig = (state) => [state.round, state.active, state.phase, state.pile.length, E.tableIds(state.table).length, state.passes].join('|');

// Steine, die in dieser Kopie neu aus der Hand gelegt wurden
export function placedIds(state, table) {
  const old = oldIds(state);
  return E.tableIds(table).filter((id) => !old.has(id));
}
// Hand = echte Hand ohne die Steine, die in der Kopie auf dem Tisch liegen
export function handOf(state, pid, table) {
  const p = meOf(state, pid);
  if (!p) return [];
  const on = new Set(E.tableIds(table));
  return p.hand.filter((id) => !on.has(id));
}
export function locate(table, id) {
  for (let i = 0; i < table.length; i++) {
    const pos = table[i].indexOf(id);
    if (pos >= 0) return { set: i, pos };
  }
  return null;
}
const strip = (table, ids) => {
  const gone = new Set(ids);
  return table.map((s) => s.filter((id) => !gone.has(id))).filter((s) => s.length > 0);
};
const norm = (table) => E.normalizeTable(table.filter((s) => s.length > 0));
const touchesOld = (state, ids) => { const old = oldIds(state); return ids.some((id) => old.has(id)); };
const PRE = 'Vor der Eröffnung bleibt der Tisch, wie er ist. Du legst nur neue Sätze.';

// Darf dieser Stein jetzt markiert werden? '' = ja, sonst Begründung
export function selectBlock(state, pid, table, id) {
  const p = meOf(state, pid);
  if (!p) return 'Du spielst hier nicht mit.';
  if (!p.melded && oldIds(state).has(id)) return PRE;
  if (!E.tableIds(table).includes(id) && !p.hand.includes(id)) return 'Dieser Stein gehört nicht zu deiner Hand.';
  return '';
}

// Markierte Steine als neuen Satz auf den Tisch
export function newSet(state, pid, table, sel) {
  const p = meOf(state, pid);
  if (!sel.length) return { ok: false, hint: 'Markiere zuerst Steine, die einen neuen Satz bilden sollen.' };
  if (p && !p.melded && touchesOld(state, sel)) return { ok: false, hint: PRE };
  const t = strip(table, sel);
  t.push(sel.slice());
  return { ok: true, table: norm(t), sel: [] };
}

// Markierte Steine an den Satz mit Nummer idx legen (der Satz sortiert sich selbst)
export function attach(state, pid, table, idx, sel) {
  const p = meOf(state, pid);
  const target = table[idx];
  if (!target) return { ok: false, hint: 'Diesen Satz gibt es nicht mehr.' };
  if (!sel.length) return { ok: false, hint: 'Markiere zuerst Steine, die du anlegen möchtest.' };
  if (p && !p.melded && touchesOld(state, target.concat(sel))) return { ok: false, hint: 'Vor der Eröffnung kannst du nichts an Sätze auf dem Tisch legen.' };
  const add = sel.filter((id) => !target.includes(id));
  if (!add.length) return { ok: false, hint: 'Diese Steine liegen schon in diesem Satz.' };
  const gone = new Set(add);
  const out = table.map((s, j) => (j === idx ? s.concat(add) : s.filter((id) => !gone.has(id)))).filter((s) => s.length > 0);
  return { ok: true, table: norm(out), sel: [] };
}

// Markierte Steine, die in diesem Zug aus der Hand gelegt wurden, zurück in die Hand
export function putBack(state, table, sel) {
  const old = oldIds(state);
  const on = new Set(E.tableIds(table));
  const moving = sel.filter((id) => on.has(id) && !old.has(id));
  if (!moving.length) return { ok: false, hint: 'Zurück geht nur ein markierter Stein, den du in diesem Zug gelegt hast.' };
  return { ok: true, table: norm(strip(table, moving)), sel: sel.filter((id) => !moving.includes(id)) };
}

// Satz teilen: genau ein markierter Stein im Satz beginnt den zweiten Teil
export function splitAt(state, pid, table, sel) {
  const p = meOf(state, pid);
  if (sel.length !== 1) return { ok: false, hint: 'Markiere genau einen Stein. Der Satz wird direkt vor ihm geteilt.' };
  const at = locate(table, sel[0]);
  if (!at) return { ok: false, hint: 'Dieser Stein liegt noch nicht in einem Satz auf dem Tisch.' };
  if (at.pos === 0) return { ok: false, hint: 'Vor dem ersten Stein gibt es nichts zu teilen. Markiere einen weiter hinten.' };
  const s = table[at.set];
  if (p && !p.melded && touchesOld(state, s)) return { ok: false, hint: PRE };
  const out = table.map((x) => x.slice());
  out.splice(at.set, 1, s.slice(0, at.pos), s.slice(at.pos));
  return { ok: true, table: norm(out), sel: [] };
}

// Satz auflösen: alle Steine der Sätze, in denen markierte Steine liegen, werden markiert (sie bleiben auf dem Tisch, bis du sie neu legst)
export function dissolve(state, pid, table, sel) {
  const p = meOf(state, pid);
  const sets = new Set();
  for (const id of sel) { const at = locate(table, id); if (at) sets.add(at.set); }
  if (!sets.size) return { ok: false, hint: 'Markiere zuerst einen Stein in dem Satz, den du auflösen möchtest.' };
  const ids = [];
  for (const i of [...sets].sort((a, b) => a - b)) ids.push(...table[i]);
  if (p && !p.melded && touchesOld(state, ids)) return { ok: false, hint: PRE };
  return { ok: true, table: table.map((s) => s.slice()), sel: ids };
}

// Punkte der neuen Sätze für die Eröffnung (nur gültige Sätze, die nicht schon so auf dem Tisch lagen)
export function openValue(state, table) {
  const key = (s) => s.slice().sort((a, b) => a - b).join(',');
  const left = state.table.map(key);
  let sum = 0;
  for (const s of table) {
    if (!s.length) continue;
    const k = key(s);
    const at = left.indexOf(k);
    if (at >= 0) { left.splice(at, 1); continue; }
    const a = E.analyzeSet(s);
    if (a.valid) sum += a.value;
  }
  return sum;
}

// Hat sich die Kopie gegenüber dem echten Tisch verändert?
export function dirty(state, table) {
  const k = (t) => JSON.stringify(t.map((s) => s.slice().sort((a, b) => a - b)).sort());
  return k(table) !== k(state.table);
}

// Handsortierung nach Zahl (dann Farbe, Joker zuletzt)
export function sortByNumber(ids) {
  return ids.slice().sort((a, b) => {
    const ta = E.TILES[a], tb = E.TILES[b];
    const na = ta.color < 0 ? 99 : ta.num, nb = tb.color < 0 ? 99 : tb.num;
    return na - nb || ta.color - tb.color || a - b;
  });
}
