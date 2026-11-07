// Wildnis-Mosaik – Zeichnen als SVG (reine Funktionen, kein DOM).
// Sechsecke "pointy-top", Kantenlänge S = 50 Einheiten, Mittelpunkt (0,0).
// Pixel eines Feldes (q,r): x = S*sqrt(3)*(q + r/2), y = 1.5*S*r. Kanten laufen im Uhrzeigersinn ab oben rechts (siehe engine.js).
// Kante e liegt zwischen den Ecken e und e+1; die Ecke k liegt im Winkel (-90 + 60k) Grad.
import * as E from './engine.js';

export const S = 50;
export const SQ3 = Math.sqrt(3);
export const HEX_W = S * SQ3; // Breite eines Sechsecks (von Kante zu Kante)

export const HABITAT_LABEL = { berg: 'Berg', wald: 'Wald', wiese: 'Wiese', sumpf: 'Sumpf', fluss: 'Fluss' };
export const ANIMAL_EMOJI = { baer: '🐻', hirsch: '🦌', lachs: '🐟', falke: '🦅', fuchs: '🦊' };
export const ANIMAL_LABEL = { baer: 'Bär', hirsch: 'Hirsch', lachs: 'Lachs', falke: 'Falke', fuchs: 'Fuchs' };
export const ANIMAL_PLURAL = { baer: 'Bären', hirsch: 'Hirsche', lachs: 'Lachse', falke: 'Falken', fuchs: 'Füchse' };
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// Lebensraumfarben (Grundfarbe) und Farbe des Musters; das Muster steht zusätzlich zur Farbe in jedem Keil
const HAB = {
  berg: { base: '#9b8873', ink: '#3b3027' },
  wald: { base: '#2f6f3a', ink: '#bfeaa8' },
  wiese: { base: '#c4de63', ink: '#3b6a10' },
  sumpf: { base: '#4aa497', ink: '#0f3b34' },
  fluss: { base: '#3b82d6', ink: '#ffffff' },
};

const f1 = (v) => Math.round(v * 10) / 10;
const rad = (deg) => (deg * Math.PI) / 180;
const corner = (k, s = S) => [s * Math.cos(rad(-90 + 60 * k)), s * Math.sin(rad(-90 + 60 * k))];
const polyPts = (s) => Array.from({ length: 6 }, (_, k) => corner(k, s).map(f1).join(',')).join(' ');
const HEX_PTS = polyPts(S);
const HEX_PTS_93 = polyPts(S * 0.93);
const HEX_PTS_88 = polyPts(S * 0.88);

export const cellCenter = (q, r) => ({ x: S * SQ3 * (q + r / 2), y: 1.5 * S * r });

// Muster-Zeichen (um 0,0, etwa 16 Einheiten groß)
function glyph(h) {
  const ink = HAB[h].ink;
  switch (h) {
    case 'berg':
      return `<path d="M-9,6 L-2,-7 L2,-1 L5,-5 L10,6 Z" fill="#efe6da" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/><path d="M-2,-7 L-5,-1 L-1,-2 L2,-1 Z" fill="#fff" stroke="none"/>`;
    case 'wald':
      return `<path d="M0,-9 L6,-1 H3 L8,6 H-8 L-3,-1 H-6 Z" fill="#a8e08f" stroke="#10330d" stroke-width="1.5" stroke-linejoin="round"/><rect x="-1.6" y="6" width="3.2" height="3.5" fill="#3a2410"/>`;
    case 'wiese':
      return `<path d="M-6,7 Q-6,-1 -8,-6 M0,7 Q0,-2 0,-9 M6,7 Q6,-1 8,-6" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
    case 'sumpf':
      return `<path d="M-5,8 V-3 M0,8 V-6 M5,8 V-2" stroke="${ink}" stroke-width="1.8" fill="none"/><ellipse cx="-5" cy="-5" rx="2" ry="3.4" fill="#6b3f1d" stroke="#2c1807" stroke-width=".8"/><ellipse cx="0" cy="-8" rx="2" ry="3.4" fill="#6b3f1d" stroke="#2c1807" stroke-width=".8"/><ellipse cx="5" cy="-4" rx="2" ry="3.4" fill="#6b3f1d" stroke="#2c1807" stroke-width=".8"/><path d="M-9,8 q2.5,-2.5 4.5,0 t4.5,0 t4.5,0 t4.5,0" fill="none" stroke="#e9fff9" stroke-width="1.4"/>`;
    default: // fluss
      return `<path d="M-10,-3.5 q3.3,-3.5 6.6,0 t6.6,0 t6.6,0 M-10,3.5 q3.3,-3.5 6.6,0 t6.6,0 t6.6,0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
}
const GLYPHS = {};
for (const h of E.HABITATS) GLYPHS[h] = glyph(h);

// Marker (Tier im weißen Kreis), Mittelpunkt (0,0)
export function tokenGlyph(animal, r = 21, opacity = 1) {
  return `<g opacity="${opacity}"><circle r="${r}" fill="#fff" stroke="#111" stroke-width="3"/>`
    + `<text y="${f1(r * 0.07)}" text-anchor="middle" dominant-baseline="central" font-size="${f1(r * 1.25)}" font-family='${EMOJI_FONT}'>${ANIMAL_EMOJI[animal]}</text></g>`;
}

export function tileTitle(id) {
  const d = E.tileDef(id);
  const hs = [...new Set(d.edges)].map((h) => HABITAT_LABEL[h]);
  return `Plättchen ${hs.join(' und ')}. Erlaubte Tiere: ${d.animals.map((a) => ANIMAL_LABEL[a]).join(', ')}.${d.key ? ' Schlüsselplättchen.' : ''}`;
}

// Inneres eines Plättchens (Mittelpunkt 0,0). o: { mini, ghost, tok }
export function tileInner(id, rot, o = {}) {
  const def = E.tileDef(id);
  const ed = E.tileEdges(id, rot);
  let s = '';
  for (let e = 0; e < 6; e++) {
    const a = corner(e), b = corner(e + 1);
    const col = HAB[ed[e]].base;
    s += `<polygon points="0,0 ${f1(a[0])},${f1(a[1])} ${f1(b[0])},${f1(b[1])}" fill="${col}" stroke="${col}" stroke-width=".8" stroke-linejoin="round"/>`;
  }
  // Trennlinien zwischen verschiedenen Lebensräumen
  for (let k = 0; k < 6; k++) {
    if (ed[(k + 5) % 6] !== ed[k]) { const c = corner(k); s += `<line x1="0" y1="0" x2="${f1(c[0])}" y2="${f1(c[1])}" stroke="#22221f" stroke-width="2.4" stroke-linecap="round"/>`; }
  }
  if (!o.ghost && !o.mini) {
    for (let e = 0; e < 6; e++) {
      const ang = rad(-60 + 60 * e);
      // links/rechts neben dem Tierfeld, deshalb etwas nach oben versetzt
      const px = e === 1 ? 36 : e === 4 ? -36 : 35 * Math.cos(ang);
      const py = e === 1 || e === 4 ? -16 : 35 * Math.sin(ang);
      s += `<g transform="translate(${f1(px)} ${f1(py)}) scale(.74)">${GLYPHS[ed[e]]}</g>`;
    }
  }
  if (def.key) {
    s += `<polygon points="${HEX_PTS_88}" fill="none" stroke="#3a2a00" stroke-width="6.5" stroke-linejoin="round"/><polygon points="${HEX_PTS_88}" fill="none" stroke="#ffcf24" stroke-width="3.6" stroke-linejoin="round"/>`;
    if (!o.ghost && !o.mini) s += `<g transform="translate(0 -26)"><circle r="8.5" fill="#fff6c9" stroke="#3a2a00" stroke-width="1.6"/><text y=".5" text-anchor="middle" dominant-baseline="central" font-size="11" font-family='${EMOJI_FONT}'>🌲</text></g>`;
  }
  if (!o.ghost) {
    if (o.tok) {
      s += tokenGlyph(o.tok, o.mini ? 24 : 21);
    } else if (!o.mini) {
      const n = def.animals.length;
      const pw = n * 20 + 8;
      s += `<rect x="${f1(-pw / 2)}" y="-14" width="${pw}" height="28" rx="14" fill="rgba(255,255,255,.93)" stroke="#22221f" stroke-width="1.6"/>`;
      def.animals.forEach((a, i) => {
        s += `<text x="${f1((i - (n - 1) / 2) * 20)}" y="1" text-anchor="middle" dominant-baseline="central" font-size="17" font-family='${EMOJI_FONT}'>${ANIMAL_EMOJI[a]}</text>`;
      });
    }
  }
  s += `<polygon points="${HEX_PTS}" fill="none" stroke="#1d1d1f" stroke-width="${o.mini ? 3 : 2.2}" stroke-linejoin="round"/>`;
  return s;
}

// Einzelnes Plättchen als eigenes SVG (Markt, Vorschau); Breite = Sechseck-Breite
export function tileSvg(id, rot, cls = '', label = '', o = {}) {
  const w = f1(HEX_W + 6), h = f1(2 * S + 6);
  return `<svg class="wn-tile ${cls}" viewBox="${f1(-w / 2)} ${f1(-h / 2)} ${w} ${h}" role="img" aria-label="${label}">${tileInner(id, rot, o)}</svg>`;
}
export function tokenSvg(animal, cls = '', label = '') {
  return `<svg class="wn-tok ${cls}" viewBox="-25 -25 50 50" role="img" aria-label="${label}">${tokenGlyph(animal, 21)}</svg>`;
}

// Brett als SVG. o: { scale, cands:[{q,r}], cid (Kennung), ghost:{id,rot}, opts:[{q,r}], optAnimal, last:{q,r}, mini, label }
// Liefert { html, minX, minY, w, h }
export function boardSvg(board, o = {}) {
  const keys = Object.keys(board);
  const cells = keys.map((k) => { const [q, r] = k.split(',').map(Number); return { q, r, k, c: board[k] }; });
  const ring = o.mini ? [] : E.freeCells(board);
  const all = cells.map((c) => cellCenter(c.q, c.r)).concat(ring.map((c) => cellCenter(c.q, c.r)));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of all) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (!all.length) { x0 = x1 = y0 = y1 = 0; }
  const padX = HEX_W / 2 + 4, padY = S + 4;
  const minX = f1(x0 - padX), minY = f1(y0 - padY);
  const w = f1(x1 - x0 + 2 * padX), h = f1(y1 - y0 + 2 * padY);
  const scale = o.scale || 1;
  let tiles = '', over = '';
  for (const c of cells) {
    const p = cellCenter(c.q, c.r);
    tiles += `<g transform="translate(${f1(p.x)} ${f1(p.y)})"><title>${tileTitle(c.c.t)}${c.c.tok ? ' Darauf: ' + ANIMAL_LABEL[c.c.tok] + '.' : ''}</title>${tileInner(c.c.t, c.c.rot, { mini: o.mini, tok: c.c.tok })}</g>`;
  }
  if (o.last && board[o.last.q + ',' + o.last.r]) {
    const p = cellCenter(o.last.q, o.last.r);
    over += `<polygon class="wn-last" transform="translate(${f1(p.x)} ${f1(p.y)})" points="${HEX_PTS_93}"/>`;
  }
  if (o.opts) {
    for (const t of o.opts) {
      const p = cellCenter(t.q, t.r);
      over += `<g class="wn-tokopt" data-act="tok" data-q="${t.q}" data-r="${t.r}" tabindex="0" role="button" aria-label="Tier hier setzen" transform="translate(${f1(p.x)} ${f1(p.y)})">`
        + (o.optAnimal ? `<g class="wn-ghosttok">${tokenGlyph(o.optAnimal, 21, 0.55)}</g>` : '')
        + `<polygon class="wn-opt" points="${HEX_PTS_93}"/></g>`;
    }
  }
  if (o.cands) {
    for (const t of o.cands) {
      const p = cellCenter(t.q, t.r);
      over += `<g class="wn-cand" data-act="cell" data-q="${t.q}" data-r="${t.r}" tabindex="0" role="button" aria-label="Plättchen hier anlegen" transform="translate(${f1(p.x)} ${f1(p.y)})">`
        + (o.ghost ? `<g opacity=".5">${tileInner(o.ghost.id, o.ghost.rot, { ghost: true })}</g>` : '')
        + `<polygon class="wn-cand-hex" points="${HEX_PTS_93}"/></g>`;
    }
  }
  const html = `<svg class="wn-board ${o.mini ? 'wn-mini' : ''}" ${o.mini ? '' : `width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"`} viewBox="${minX} ${minY} ${w} ${h}" role="group" aria-label="${o.label || 'Gebiet'}">${tiles}${over}</svg>`;
  return { html, minX, minY, w, h };
}
