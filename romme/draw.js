// Rommé – reine Darstellung der Karten (HTML-Zeichenketten, kein DOM-Zugriff, keine Spiellogik).
// Skatblatt: Farbe als Symbol (♣ ♠ schwarz, ♥ ♦ rot, rote Karten zusätzlich mit gestricheltem Innenrand), Joker als Stern ★.
import { CARDS, SUITS, RANK_SYM, RANK_NAMES, isJoker, cardLabel } from './engine.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Sprechende Beschreibung einer Karte (für Screenreader und Tooltips)
export const cardTitle = (id) => {
  const c = CARDS[id];
  if (!c) return '?';
  return isJoker(id) ? 'Joker' : `${SUITS[c.suit].name} ${RANK_NAMES[c.rank]}`;
};

// o: { act: true = antippbar (Knopf), sel, fresh (in diesem Zug gelegt), last (zuletzt gelegt), drawn (gerade genommen), cls }
export function cardHtml(id, o = {}) {
  const c = CARDS[id];
  if (!c) return '';
  const joker = isJoker(id);
  const su = joker ? null : SUITS[c.suit];
  const cls = ['rm-c', joker ? 'jk rm-joker' : su.red ? 'red' : 'blk', o.sel ? 'sel' : '', o.fresh ? 'fresh' : '', o.last ? 'last' : '', o.drawn ? 'drawn' : '', o.cls || ''].filter(Boolean).join(' ');
  const flags = [o.sel ? 'markiert' : '', o.fresh ? 'neu ausgelegt' : '', o.last ? 'zuletzt gelegt' : '', o.drawn ? 'gerade genommen' : ''].filter(Boolean);
  const label = cardTitle(id) + (flags.length ? ', ' + flags.join(', ') : '');
  const inner = joker
    ? `<span class="rk">★</span><span class="su" aria-hidden="true">Joker</span>`
    : `<span class="rk">${RANK_SYM[c.rank]}</span><span class="su" aria-hidden="true">${su.sym}</span>`;
  const chk = o.sel ? '<i class="chk" aria-hidden="true">✔</i>' : '';
  if (o.act) return `<button type="button" class="${cls}" data-act="card" data-id="${id}" aria-pressed="${o.sel ? 'true' : 'false'}" aria-label="${esc(label)}" title="${esc(cardLabel(id))}">${inner}${chk}</button>`;
  return `<span class="${cls}" data-id="${id}" role="img" aria-label="${esc(label)}">${inner}${chk}</span>`;
}

// Verdeckte Karte (Stapel)
export const backHtml = (cls = '') => `<span class="rm-c back${cls ? ' ' + cls : ''}" aria-hidden="true"></span>`;

export const kindText = (a) => (a.kind === 'folge' ? 'Folge' : 'Satz');
// „★ als ♥ 7“ (Folge, Satz mit vier Karten); bei einem Satz aus drei Karten ist die Farbe offen: „★ als 7“
export function jokerNote(a) {
  if (!a || !a.valid || !a.jokerAs || !a.jokerAs.length) return '';
  return a.jokerAs.map((j) => (a.kind === 'satz' && a.order.length === 3 ? `★ als ${RANK_SYM[j.rank]}` : `★ als ${SUITS[j.suit].sym} ${RANK_SYM[j.rank]}`)).join(', ');
}
