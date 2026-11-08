// Mahjong-Solitär – Zeichnung der Steine (reines SVG, ohne Schriftzeichen aus fremden Alphabeten und ohne Emoji).
// Jedes Gesicht ist in einem Kasten von 30 x 40 Einheiten gezeichnet.
import { kindInfo } from './engine.js';

export const FACE_W = 30;
export const FACE_H = 40;

const BLUE = '#1747a0', GREEN = '#17692a', RED = '#bd1f1f';
const SUIT_COL = [BLUE, GREEN, RED];
const SUIT_TINT = ['#e6efff', '#e5f6e7', '#fde9e6'];

// Hintergrundfarbe des Steins je Art (erleichtert das Unterscheiden)
export function faceTint(k) {
  const i = kindInfo(k);
  if (!i) return '#fffdf4';
  if (i.type === 'suit') return SUIT_TINT[i.suit];
  if (i.type === 'flower') return '#ffe8f2';
  if (i.type === 'season') return '#ffeed6';
  if (i.type === 'wind') return '#eceef2';
  return '#fffdf4';
}

function suitSymbol(suit, col) {
  if (suit === 0) { // Kreise: Ring mit Punkt
    return `<circle cx="15" cy="31" r="7" fill="${col}"/><circle cx="15" cy="31" r="3.4" fill="#fff"/><circle cx="15" cy="31" r="1.5" fill="${col}"/>`;
  }
  if (suit === 1) { // Stäbe: grüner Stab mit Knoten
    return `<rect x="11.5" y="23" width="7" height="16" rx="3" fill="${col}"/><rect x="11.5" y="29" width="7" height="1.8" fill="#fff"/><rect x="11.5" y="33.5" width="7" height="1.8" fill="#fff"/>`;
  }
  // Zeichen: roter Stern
  const pts = [];
  for (let n = 0; n < 10; n++) {
    const r = n % 2 ? 3.6 : 8, a = -Math.PI / 2 + n * Math.PI / 5;
    pts.push(`${(15 + r * Math.cos(a)).toFixed(2)},${(31 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${col}"/>`;
}

// Gesicht als SVG-Inhalt (ohne äußeres svg), Koordinaten 0..30 x 0..40
export function faceInner(k) {
  const i = kindInfo(k);
  if (!i) return '';
  if (i.type === 'suit') {
    const col = SUIT_COL[i.suit];
    return `<text x="15" y="21" text-anchor="middle" font-size="22" font-weight="800" font-family="Arial,Helvetica,sans-serif" fill="${col}">${i.n}</text>${suitSymbol(i.suit, col)}`;
  }
  if (i.type === 'wind') {
    const L = ['O', 'S', 'W', 'N'][i.w];
    return `<circle cx="15" cy="20" r="11.5" fill="#1b1b1f"/><text x="15" y="26" text-anchor="middle" font-size="17" font-weight="800" font-family="Arial,Helvetica,sans-serif" fill="#fff">${L}</text>`;
  }
  if (i.type === 'dragon') {
    const shield = 'M15 4 L26 9 L26 24 Q26 33 15 37 Q4 33 4 24 L4 9 Z';
    if (i.d === 0) return `<path d="${shield}" fill="${RED}" stroke="#7a1010" stroke-width="1.2"/><text x="15" y="27" text-anchor="middle" font-size="17" font-weight="800" font-family="Arial,Helvetica,sans-serif" fill="#fff">R</text>`;
    if (i.d === 1) return `<path d="${shield}" fill="${GREEN}" stroke="#0e4019" stroke-width="1.2"/><text x="15" y="27" text-anchor="middle" font-size="17" font-weight="800" font-family="Arial,Helvetica,sans-serif" fill="#fff">G</text>`;
    return `<path d="${shield}" fill="#fff" stroke="#1d2a6b" stroke-width="2.4"/><path d="M15 9.5 L22 12.8 L22 23 Q22 29 15 32 Q8 29 8 23 L8 12.8 Z" fill="none" stroke="#1d2a6b" stroke-width="1.4"/>`;
  }
  if (i.type === 'flower') {
    let p = '';
    for (let n = 0; n < 5; n++) {
      const a = -Math.PI / 2 + n * 2 * Math.PI / 5;
      p += `<circle cx="${(15 + 6.2 * Math.cos(a)).toFixed(2)}" cy="${(20 + 6.2 * Math.sin(a)).toFixed(2)}" r="5.2" fill="#e03a82" stroke="#9c1850" stroke-width=".8"/>`;
    }
    return `${p}<circle cx="15" cy="20" r="3.8" fill="#ffd21f" stroke="#a87800" stroke-width=".8"/>`;
  }
  // Jahreszeit: orangefarbenes Herbstblatt
  return `<path d="M7 33 C4 17 14 7 26 8 C27 21 20 32 7 33 Z" fill="#dd6a10" stroke="#7a3a05" stroke-width="1"/><path d="M8 32 L23 12" stroke="#5a2a04" stroke-width="1.7" fill="none"/><path d="M6 34 L9 31" stroke="#5a2a04" stroke-width="2" fill="none"/>`;
}
