// Kachelstadt – Zeichnen der Plättchen als SVG (reine Funktionen, kein DOM).
// Jedes Plättchen wird in einem Raster von 100 x 100 Einheiten gezeichnet.
// Randpositionen 0..11 laufen im Uhrzeigersinn (Seite = floor(p/3): 0 oben, 1 rechts, 2 unten, 3 links).
import * as E from './engine.js';

export const KIND_LABEL = { city: 'Ritter', road: 'Wegelagerer', monastery: 'Mönch', field: 'Bauer' };
export const KIND_PLACE = { city: 'in der Stadt', road: 'an der Straße', monastery: 'im Kloster', field: 'auf der Wiese' };
export const COLORS = [
  { name: 'Schwarz', fill: '#202020', text: '#ffffff' },
  { name: 'Rot', fill: '#d32f2f', text: '#ffffff' },
  { name: 'Gelb', fill: '#ffd600', text: '#1d1d1f' },
  { name: 'Grün', fill: '#17a34a', text: '#ffffff' },
  { name: 'Blau', fill: '#1e6fe0', text: '#ffffff' },
];

const f1 = (v) => Math.round(v * 10) / 10;

// ---------- Randpunkte ----------
export function edgePoint(p) {
  const side = Math.floor(p / 3);
  const f = [100 / 6, 50, 500 / 6][p % 3];
  if (side === 0) return [f, 0];
  if (side === 1) return [100, f];
  if (side === 2) return [100 - f, 100];
  return [0, 100 - f];
}
// Drehung eines Punktes um 90° * k im Uhrzeigersinn um die Mitte
const rotPt = ([x, y], k) => {
  let px = x, py = y;
  for (let i = 0; i < (((k % 4) + 4) % 4); i++) { const nx = 100 - py; py = px; px = nx; }
  return [px, py];
};
const quad = (a, c, b, n = 24) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([(1 - t) * (1 - t) * a[0] + 2 * t * (1 - t) * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * t * (1 - t) * c[1] + t * t * b[1]]);
  }
  return out;
};

// ---------- Stadt-Muster (Grundlage: nach oben offen usw., dann gedreht) ----------
// Jedes Muster: fill (Pfad), edge (Randlinien als Pfade), poly (Vieleck zum Rechnen), meeple/shield (Ankerpunkte)
const CITY = {
  one: { // Kappe an der oberen Seite
    fill: 'M0,0 H100 Q50,70 0,0 Z', edge: ['M100,0 Q50,70 0,0'],
    poly: [[0, 0], [100, 0], ...quad([100, 0], [50, 70], [0, 0])],
    meeple: [60, 17], shield: [27, 10],
  },
  corner: { // obere und rechte Seite
    fill: 'M0,0 H100 V100 Q68,32 0,0 Z', edge: ['M100,100 Q68,32 0,0'],
    poly: [[0, 0], [100, 0], [100, 100], ...quad([100, 100], [68, 32], [0, 0])],
    meeple: [68, 31], shield: [87, 13],
  },
  band: { // linke und rechte Seite verbunden
    fill: 'M0,0 Q50,60 100,0 L100,100 Q50,40 0,100 Z', edge: ['M0,0 Q50,60 100,0', 'M100,100 Q50,40 0,100'],
    poly: [...quad([0, 0], [50, 60], [100, 0]), ...quad([100, 100], [50, 40], [0, 100])],
    meeple: [62, 50], shield: [22, 50],
  },
  three: { // oben, rechts, links (unten offen)
    fill: 'M0,0 H100 V100 Q50,48 0,100 Z', edge: ['M100,100 Q50,48 0,100'],
    poly: [[0, 0], [100, 0], [100, 100], ...quad([100, 100], [50, 48], [0, 100])],
    meeple: [62, 36], shield: [27, 32],
  },
  four: { fill: 'M0,0 H100 V100 H0 Z', edge: [], poly: [[0, 0], [100, 0], [100, 100], [0, 100]], meeple: [50, 66], shield: [50, 28] },
};

// Stadt-Segment (gedrehte Positionen) -> { pat, rot }
function cityPattern(positions) {
  const sides = [...new Set(positions.map((p) => Math.floor(p / 3)))].sort((a, b) => a - b);
  const has = (s) => sides.includes(s);
  if (sides.length === 4) return { pat: CITY.four, rot: 0 };
  if (sides.length === 3) { const open = [0, 1, 2, 3].find((s) => !has(s)); return { pat: CITY.three, rot: (open - 2 + 4) % 4 }; }
  if (sides.length === 2) {
    if (has(0) && has(2)) return { pat: CITY.band, rot: 1 };
    if (has(1) && has(3)) return { pat: CITY.band, rot: 0 };
    const a = [0, 1, 2, 3].find((s) => has(s) && has((s + 1) % 4));
    return { pat: CITY.corner, rot: a };
  }
  return { pat: CITY.one, rot: sides[0] };
}

// ---------- Straßen ----------
function roadLine(seg) {
  const pts = seg.p.map(edgePoint);
  if (pts.length >= 2) return { d: `M${f1(pts[0][0])},${f1(pts[0][1])} Q50,50 ${f1(pts[1][0])},${f1(pts[1][1])}`, poly: quad(pts[0], [50, 50], pts[1]), dead: false, pts };
  return { d: `M${f1(pts[0][0])},${f1(pts[0][1])} L50,50`, poly: [pts[0], [50, 50]], dead: true, pts };
}

// ---------- Geometrie-Hilfen ----------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function polyIn(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyDist = (p, poly) => { let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, segDist(p, poly[i], poly[(i + 1) % poly.length])); return m; };
const lineDist = (p, line) => { let m = Infinity; for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, segDist(p, line[i], line[i + 1])); return m; };

const MONASTERY_BOX = [[30, 24], [70, 24], [70, 74], [30, 74]];

// ---------- Gestaltung eines Plättchens (gecacht) ----------
const CACHE = new Map();
function layout(typ, r) {
  const key = typ + r;
  let L = CACHE.get(key);
  if (L) return L;
  const segs = E.rotatedSegments(typ, r);
  L = { segs, cities: [], roads: [], monastery: false, anchors: [], shields: [] };
  segs.forEach((s, i) => {
    if (s.k === 'city') {
      const { pat, rot } = cityPattern(s.p);
      const poly = pat.poly.map((q) => rotPt(q, rot));
      L.cities.push({ i, pat, rot, poly, shield: !!s.shield });
      L.anchors[i] = rotPt(pat.meeple, rot);
      if (s.shield) L.shields.push(rotPt(pat.shield, rot));
    } else if (s.k === 'road') {
      const ln = roadLine(s);
      L.roads.push({ i, ...ln });
      L.anchors[i] = ln.dead
        ? [50 + (ln.pts[0][0] - 50) * 0.66, 50 + (ln.pts[0][1] - 50) * 0.66]
        : [0.25 * ln.pts[0][0] + 0.5 * 50 + 0.25 * ln.pts[1][0], 0.25 * ln.pts[0][1] + 0.5 * 50 + 0.25 * ln.pts[1][1]];
    } else if (s.k === 'monastery') {
      L.monastery = true;
      L.anchors[i] = [50, 56];
    }
  });
  // Wiesen: Rasterpunkte, die nicht in Stadt/Straße/Kloster liegen, gehören zur nächsten Wiesen-Randposition
  const fields = segs.map((s, i) => [s, i]).filter(([s]) => s.k === 'field');
  const clear = (q) => {
    let c = Math.min(q[0], q[1], 100 - q[0], 100 - q[1]) * 1.1;
    for (const ci of L.cities) c = Math.min(c, polyIn(q, ci.poly) ? -1 : polyDist(q, ci.poly) - 1);
    for (const ro of L.roads) c = Math.min(c, lineDist(q, ro.poly) - 8);
    if (L.monastery) c = Math.min(c, polyIn(q, MONASTERY_BOX) ? -1 : polyDist(q, MONASTERY_BOX));
    return c;
  };
  const best = new Map();
  for (let x = 4; x <= 96; x += 4) for (let y = 4; y <= 96; y += 4) {
    const q = [x, y];
    const c = clear(q);
    if (c <= 0) continue;
    let owner = -1, od = Infinity;
    for (const [s, i] of fields) for (const p of s.p) { const d = dist(q, edgePoint(p)); if (d < od) { od = d; owner = i; } }
    if (owner < 0) continue;
    const cur = best.get(owner);
    const score = Math.min(c, 14) - od * 0.02;
    if (!cur || score > cur.score) best.set(owner, { score, q });
  }
  for (const [, i] of fields) {
    const b = best.get(i);
    L.anchors[i] = b ? b.q : [50, 50];
  }
  CACHE.set(key, L);
  return L;
}

export function segAnchor(typ, r, seg) { return layout(typ, r).anchors[seg]; }

// ---------- SVG-Zeichnung ----------
const SHIELD = '<path d="M-7,-8.5 H7 V1 Q7,8 0,11 Q-7,8 -7,1 Z" fill="#ffd23f" stroke="#5a3d00" stroke-width="1.6"/><path d="M0,-6 V8 M-5,-1 H5" stroke="#b3261e" stroke-width="2.2" fill="none"/>';

// Innenleben eines Plättchens (100 x 100)
export function tileInner(typ, r) {
  const L = layout(typ, r);
  let s = '<rect width="100" height="100" fill="#8dc24a"/>';
  s += '<g fill="#7ab03c"><circle cx="14" cy="22" r="2.2"/><circle cx="86" cy="78" r="2.2"/><circle cx="74" cy="14" r="2"/><circle cx="24" cy="86" r="2"/></g>';
  for (const ro of L.roads) {
    s += `<path d="${ro.d}" fill="none" stroke="#6b4f27" stroke-width="17"/>`;
  }
  for (const ro of L.roads) s += `<path d="${ro.d}" fill="none" stroke="#f3e5c0" stroke-width="11"/>`;
  for (const ro of L.roads) if (ro.dead) s += '<circle cx="50" cy="50" r="8.5" fill="#6b4f27"/><circle cx="50" cy="50" r="5.5" fill="#f3e5c0"/>';
  for (const ci of L.cities) {
    s += `<g transform="rotate(${ci.rot * 90} 50 50)"><path d="${ci.pat.fill}" fill="#b9732c"/>`;
    for (const e of ci.pat.edge) s += `<path d="${e}" fill="none" stroke="#6a3b0e" stroke-width="3.5"/>`;
    s += '</g>';
  }
  if (L.monastery) {
    s += '<polygon points="26,48 50,24 74,48" fill="#c62828" stroke="#5e1010" stroke-width="2.4" stroke-linejoin="round"/>'
      + '<rect x="32" y="48" width="36" height="25" fill="#f4e1b8" stroke="#5e3d10" stroke-width="2.4"/>'
      + '<rect x="45" y="58" width="10" height="15" fill="#7a4a1c"/><path d="M50,28 v10 M45,32 h10" stroke="#ffd23f" stroke-width="2.2"/>';
  }
  for (const sh of L.shields) s += `<g transform="translate(${f1(sh[0])} ${f1(sh[1])})">${SHIELD}</g>`;
  return s;
}

export function tileSvg(typ, r, cls = '', label = '') {
  return `<svg class="ks-tile ${cls}" viewBox="0 0 100 100" role="img" aria-label="${label}">${tileInner(typ, r)}<rect x="1" y="1" width="98" height="98" fill="none" stroke="rgba(30,50,10,.55)" stroke-width="2"/></svg>`;
}

// Gefolgsmann (Männchen) um (0,0), Höhe etwa 26 Einheiten; Spielernummer als Beschriftung
export function meepleGlyph(color, num, scale = 1) {
  const c = COLORS[color % COLORS.length];
  const body = 'M-4.5,-4 H4.5 L11,1 L6.5,4.5 L9.5,13 H-9.5 L-6.5,4.5 L-11,1 Z';
  return `<g transform="scale(${scale})"><circle cx="0" cy="-9.5" r="5.6" fill="none" stroke="#fff" stroke-width="5"/><path d="${body}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>`
    + `<circle cx="0" cy="-9.5" r="5.6" fill="${c.fill}" stroke="#000" stroke-width="1.6"/><path d="${body}" fill="${c.fill}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<text x="0" y="10" text-anchor="middle" font-size="9.5" font-weight="900" font-family="system-ui,Arial,sans-serif" fill="${c.text}">${num}</text></g>`;
}

// Kleines Symbol (eigenes SVG) für Listen
export function meepleIcon(color, num, size = 34) {
  return `<svg class="ks-ico" width="${size}" height="${size}" viewBox="-14 -18 28 34" aria-hidden="true">${meepleGlyph(color, num, 1)}</svg>`;
}

export function boardSegs(typ, r) { return layout(typ, r).segs; }
