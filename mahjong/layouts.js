// Mahjong-Solitär – Brettformen als Koordinatenlisten.
// Jeder Eintrag: [Ebene, Spalte, Zeile]. Spalte in halben Steinbreiten, Zeile in halben Steinhöhen.
// Ein Stein ist 2 Einheiten breit und 2 Einheiten hoch. Auf der gleichen Ebene überlappen sich keine Steine.

const rows = (z, y, x0, x1) => { const o = []; for (let x = x0; x <= x1; x += 2) o.push([z, x, y]); return o; };
const block = (z, x0, x1, y0, y1, dy = 2) => { const o = []; for (let y = y0; y <= y1; y += dy) o.push(...rows(z, y, x0, x1)); return o; };

// Klassische Schildkröte: 87 + 36 + 16 + 4 + 1 = 144 Steine
const SCHILDKROETE = [
  ...rows(0, 0, 2, 24), ...rows(0, 2, 6, 20), ...rows(0, 4, 4, 22), ...rows(0, 6, 2, 24),
  ...rows(0, 8, 2, 24), ...rows(0, 10, 4, 22), ...rows(0, 12, 6, 20), ...rows(0, 14, 2, 24),
  [0, 0, 7], [0, 26, 7], [0, 28, 7],
  ...block(1, 8, 18, 2, 12),
  ...block(2, 10, 16, 4, 10),
  ...block(3, 12, 14, 6, 8),
  [4, 13, 7],
];

// Pyramide: 40 + 18 + 12 + 2 = 72 Steine
const PYRAMIDE = [
  ...block(0, 0, 14, 0, 8),
  ...block(1, 2, 12, 2, 6),
  ...block(2, 4, 10, 2, 6),
  ...rows(3, 4, 6, 8),
];

// Mauer: 40 + 6 + 2 = 48 Steine (flach, nur ein kleiner Hügel in der Mitte)
const MAUER = [
  ...block(0, 0, 14, 0, 8),
  ...rows(1, 4, 2, 12),
  ...rows(2, 4, 6, 8),
];

// Mini-Brett für die Lernrunde: 12 Steine
const LERN = [
  ...rows(0, 0, 0, 10), ...rows(0, 2, 2, 8),
  [1, 4, 1], [1, 6, 1],
];

export const LAYOUTS = {
  schildkroete: { name: 'Schildkröte', tiles: SCHILDKROETE },
  pyramide: { name: 'Pyramide', tiles: PYRAMIDE },
  mauer: { name: 'Mauer', tiles: MAUER },
  lern: { name: 'Übungsbrett', tiles: LERN },
};
export const LAYOUT_KEYS = ['schildkroete', 'pyramide', 'mauer'];
