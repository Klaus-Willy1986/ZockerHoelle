// Reihen & Gruppen – reine Darstellung der Steine (HTML/SVG-Zeichenketten, kein DOM-Zugriff, keine Spiellogik).
// Jede Farbe hat zusätzlich ein Zeichen im Stein: Rot ● Kreis, Blau ■ Quadrat, Gelb ▲ Dreieck, Grün ◆ Raute. Der Joker ist ein Stern.
import { TILES, COLOR_NAMES, isJoker, tileLabel } from './engine.js';

export const SYMBOL_NAMES = ['Kreis', 'Quadrat', 'Dreieck', 'Raute'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHAPES = [
  '<circle cx="12" cy="12" r="9"/>',
  '<rect x="4" y="4" width="16" height="16" rx="1.5"/>',
  '<path d="M12 3 L22 21 L2 21 Z"/>',
  '<path d="M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z"/>',
];
export const symbolSvg = (c, cls = 'sym') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SHAPES[c] || ''}</svg>`;
const STAR = '<svg class="sym star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.8 L15 8.6 L22.4 9.3 L16.8 14.2 L18.5 21.5 L12 17.7 L5.5 21.5 L7.2 14.2 L1.6 9.3 L9 8.6 Z"/></svg>';

// Sprechende Beschreibung eines Steins (für Screenreader und Tooltips)
export const tileTitle = (id) => {
  const t = TILES[id];
  if (!t) return '?';
  return isJoker(id) ? 'Joker' : `${COLOR_NAMES[t.color]} ${t.num}, ${SYMBOL_NAMES[t.color]}`;
};

// o: { act: true = antippbar (Knopf), sel, fresh (in diesem Zug gelegt), last (zuletzt gelegt), drawn (gerade gezogen) }
export function tileHtml(id, o = {}) {
  const t = TILES[id];
  if (!t) return '';
  const joker = isJoker(id);
  const cls = ['rg-t', joker ? 'j rg-joker' : 'c' + t.color, o.sel ? 'sel' : '', o.fresh ? 'fresh' : '', o.last ? 'last' : '', o.drawn ? 'drawn' : ''].filter(Boolean).join(' ');
  const flags = [o.sel ? 'markiert' : '', o.fresh ? 'neu gelegt' : '', o.last ? 'zuletzt gelegt' : '', o.drawn ? 'gerade gezogen' : ''].filter(Boolean);
  const label = tileTitle(id) + (flags.length ? ', ' + flags.join(', ') : '');
  const inner = `<span class="n">${joker ? '★' : t.num}</span>${joker ? STAR : symbolSvg(t.color)}${o.sel ? '<i class="chk" aria-hidden="true">✔</i>' : ''}`;
  if (o.act) return `<button type="button" class="${cls}" data-act="tile" data-id="${id}" aria-pressed="${o.sel ? 'true' : 'false'}" aria-label="${esc(label)}" title="${esc(tileLabel(id))}">${inner}</button>`;
  return `<span class="${cls}" data-id="${id}" role="img" aria-label="${esc(label)}">${inner}</span>`;
}

export const kindText = (a) => (a.kind === 'reihe' ? 'Reihe' : 'Gruppe');
// „★ als 7“ bei Reihen, „★ als Blau 7“ bei Gruppen
export function jokerNote(a) {
  if (!a || !a.valid || !a.jokerAs || !a.jokerAs.length) return '';
  return a.jokerAs.map((j) => (a.kind === 'reihe' ? `★ als ${j.num}` : `★ als ${COLOR_NAMES[j.color]} ${j.num}`)).join(', ');
}
