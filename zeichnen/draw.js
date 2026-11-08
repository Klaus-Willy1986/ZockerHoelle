// Zeichenraten – Strichverarbeitung und Malen (ohne Oberfläche außer paint*, das nur einen Canvas-Kontext braucht).
// Koordinaten: Fläche 0..1000 x 0..1000. Striche: { k, c, w, p: [[x, y], ...] }, c 0..5 Farbe, 6 Radierer, w 0..2 Pinselgröße.
import { COLORS, ERASER, MAX_PTS_MSG } from './engine.js';

export const SIZE = 1000;
export const WIDTHS = [8, 16, 30];
export const ERASER_WIDTHS = [30, 56, 96];
export const MIN_DIST = 3; // Punkte, die näher beieinander liegen, werden weggelassen

export const clamp = (v) => Math.min(SIZE, Math.max(0, v));
export const round1 = (v) => Math.round(clamp(v));

// Punkt in ganze Zahlen runden und in die Fläche zwingen
export const toPoint = (x, y) => [round1(x), round1(y)];

// Nahe beieinanderliegende Punkte weglassen (der letzte Punkt bleibt immer erhalten)
export function thin(points, minDist = MIN_DIST) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minDist) out.push(p);
  }
  const last = points[points.length - 1];
  if (last && out.length && (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1])) out.push(last);
  return out;
}

// Punkte in Gruppen von höchstens max (Standard 40)
export function chunks(points, max = MAX_PTS_MSG) {
  const out = [];
  for (let i = 0; i < points.length; i += max) out.push(points.slice(i, i + max));
  return out;
}

// Nachrichten für einen (Teil-)Strich: jede Nachricht trägt Farbe, Größe und Strichnummer k
export function strokeMessages(points, { c, w, k }) {
  return chunks(points).map((pts) => ({ t: 'stroke', pts, c, w, k }));
}

export const colorOf = (s) => (s.c === ERASER ? '#ffffff' : COLORS[s.c] || COLORS[0]);
export const widthOf = (s) => (s.c === ERASER ? ERASER_WIDTHS : WIDTHS)[s.w] || WIDTHS[1];

// Einen Strich malen; scale = Pixel pro Einheit
export function paintStroke(ctx, s, scale) {
  const p = s && Array.isArray(s.p) ? s.p : [];
  if (!p.length) return;
  const lw = Math.max(1, widthOf(s) * scale);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = colorOf(s); ctx.fillStyle = colorOf(s); ctx.lineWidth = lw;
  if (p.length === 1) {
    ctx.beginPath(); ctx.arc(p[0][0] * scale, p[0][1] * scale, lw / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(p[0][0] * scale, p[0][1] * scale);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * scale, p[i][1] * scale);
    ctx.stroke();
  }
  ctx.restore();
}

export function paintAll(ctx, strokes, px) {
  const scale = px / SIZE;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.restore();
  for (const s of strokes || []) paintStroke(ctx, s, scale);
}
