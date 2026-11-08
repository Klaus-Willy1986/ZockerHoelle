// Schach – Figuren als eigene Zeichnungen (SVG). Weiß: hell mit dunklem Rand, Schwarz: dunkel mit hellem Rand.
// Figurencodes wie in engine.js: 1..6 Weiß (Bauer, Springer, Läufer, Turm, Dame, König), 7..12 Schwarz.
const BASE = '<rect x="20" y="82" width="60" height="9" rx="3"/><rect x="27" y="74" width="46" height="10" rx="3"/>';
const SHAPES = [
  '',
  // Bauer
  `<circle cx="50" cy="27" r="13"/><path d="M39 74 L44 47 H56 L61 74Z"/><rect x="35" y="43" width="30" height="8" rx="4"/>${BASE}`,
  // Springer
  `<path d="M28 76 C28 56 34 52 38 46 L26 45 L22 36 L40 14 L46 21 L53 12 L58 26 C70 34 76 52 74 76Z"/>${BASE}`,
  // Läufer
  `<ellipse cx="50" cy="40" rx="15" ry="21"/><circle cx="50" cy="16" r="6"/><path d="M36 76 L43 54 H57 L64 76Z"/><rect x="33" y="55" width="34" height="8" rx="4"/>${BASE}`,
  // Turm
  `<rect x="32" y="36" width="36" height="40" /><rect x="26" y="18" width="13" height="24"/><rect x="43.5" y="18" width="13" height="24"/><rect x="61" y="18" width="13" height="24"/><rect x="28" y="38" width="44" height="9" rx="2"/><rect x="27" y="62" width="46" height="12"/>${BASE}`,
  // Dame
  `<path d="M30 76 L22 34 L38 52 L50 24 L62 52 L78 34 L70 76Z"/><circle cx="22" cy="30" r="6"/><circle cx="37" cy="19" r="6"/><circle cx="50" cy="14" r="6"/><circle cx="63" cy="19" r="6"/><circle cx="78" cy="30" r="6"/><rect x="29" y="64" width="42" height="10" rx="3"/>${BASE}`,
  // König
  `<rect x="46" y="6" width="8" height="26"/><rect x="38" y="14" width="24" height="8"/><path d="M33 76 L36 46 H64 L67 76Z"/><rect x="31" y="36" width="38" height="14" rx="6"/><rect x="29" y="64" width="42" height="10" rx="3"/>${BASE}`,
];
const DETAILS = [
  '', '',
  '<circle cx="45" cy="30" r="3" class="dot"/>',
  '<path d="M44 28 L56 44" class="ln"/>',
  '<path d="M36 52 H64" class="ln"/>',
  '<path d="M34 59 H66" class="ln"/>',
  '<path d="M41 56 H59" class="ln"/>',
];
export const PIECE_LABEL = ['', 'Bauer', 'Springer', 'Läufer', 'Turm', 'Dame', 'König'];

// SVG-Text einer Figur (type 1..6, color 0/1)
export function pieceSvg(type, color, cls = 'sc-pc') {
  return `<svg class="${cls} ${color === 0 ? 'w' : 'b'}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g class="o">${SHAPES[type]}</g><g class="f">${SHAPES[type]}</g><g class="d">${DETAILS[type]}</g></svg>`;
}
export const svgOfCode = (p, cls) => pieceSvg(p > 6 ? p - 6 : p, p > 6 ? 1 : 0, cls);
