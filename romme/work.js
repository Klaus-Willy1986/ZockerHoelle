// Rommé – Arbeitskopie für den eigenen Zug (reine Funktionen, kein DOM, kein Netzwerk).
// Die Oberfläche hält eine Kopie des Tisches (Liste von Sätzen). Die Hand ergibt sich daraus: Hand = echte Hand minus alles, was in der Kopie liegt.
// Alle Funktionen liefern neue Listen und ändern ihre Eingaben nie. Geprüft wird erst von der Engine (checkTurn / meld).
import * as E from './engine.js';

export const cloneTable = (t) => (Array.isArray(t) ? t.map((s) => (Array.isArray(s) ? s.slice() : [])) : []);
export const oldIds = (state) => new Set(E.tableIds(state.table));
export const meOf = (state, pid) => (state && Array.isArray(state.players) ? state.players.find((p) => p.id === pid) || null : null);

// Marke für „diese Lage im Spiel“ (ändert sich bei jedem Schritt), damit die Arbeitskopie nur bei neuer Lage neu beginnt.
export const turnSig = (state) => [state.round, state.active, state.phase, state.turn, state.pile.length, state.discard.length, E.tableIds(state.table).length, (meOf(state, state.players[state.active].id) || { hand: [] }).hand.length].join('|');

export function placedIds(state, table) {
  const old = oldIds(state);
  return E.tableIds(table).filter((id) => !old.has(id));
}
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

// Darf diese Karte jetzt markiert werden? '' = ja, sonst Begründung
export function selectBlock(state, pid, table, id) {
  const p = meOf(state, pid);
  if (!p) return 'Du spielst hier nicht mit.';
  if (!p.melded && oldIds(state).has(id)) return PRE;
  if (!E.tableIds(table).includes(id) && !p.hand.includes(id)) return 'Diese Karte gehört nicht zu deiner Hand.';
  return '';
}

// Markierte Karten als neuer Satz auf den Tisch
export function newSet(state, pid, table, sel) {
  const p = meOf(state, pid);
  if (!sel.length) return { ok: false, hint: 'Markiere zuerst Karten, die einen neuen Satz bilden sollen.' };
  if (p && !p.melded && touchesOld(state, sel)) return { ok: false, hint: PRE };
  const t = strip(table, sel);
  t.push(sel.slice());
  return { ok: true, table: norm(t), sel: [] };
}

// Markierte Karten an den Satz mit Nummer idx legen (der Satz sortiert sich selbst)
export function attach(state, pid, table, idx, sel) {
  const p = meOf(state, pid);
  const target = table[idx];
  if (!target) return { ok: false, hint: 'Diesen Satz gibt es nicht mehr.' };
  if (!sel.length) return { ok: false, hint: 'Markiere zuerst Karten, die du anlegen möchtest.' };
  if (p && !p.melded && touchesOld(state, target.concat(sel))) return { ok: false, hint: 'Vor der Eröffnung kannst du nichts an Sätze auf dem Tisch legen.' };
  const add = sel.filter((id) => !target.includes(id));
  if (!add.length) return { ok: false, hint: 'Diese Karten liegen schon in diesem Satz.' };
  const gone = new Set(add);
  const out = table.map((s, j) => (j === idx ? s.concat(add) : s.filter((id) => !gone.has(id)))).filter((s) => s.length > 0);
  return { ok: true, table: norm(out), sel: [] };
}

// Markierte Karten, die in dieser Runde des Zuges aus der Hand gelegt wurden, zurück in die Hand
export function putBack(state, table, sel) {
  const old = oldIds(state);
  const on = new Set(E.tableIds(table));
  const moving = sel.filter((id) => on.has(id) && !old.has(id));
  if (!moving.length) return { ok: false, hint: 'Zurück geht nur eine markierte Karte, die du gerade erst ausgelegt hast.' };
  return { ok: true, table: norm(strip(table, moving)), sel: sel.filter((id) => !moving.includes(id)) };
}

// Hat sich die Kopie gegenüber dem echten Tisch verändert?
export function dirty(state, table) {
  const k = (t) => JSON.stringify(t.map((s) => s.slice().sort((a, b) => a - b)).sort());
  return k(table) !== k(state.table);
}
