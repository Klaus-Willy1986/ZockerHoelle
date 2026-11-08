// Galgenmännchen – Zeichnung "Der Schneemann schmilzt" als SVG (reine Funktion, keine Oberfläche).
// 10 Teile verschwinden nach und nach (Besen, Hut, Schal, linker Arm, rechter Arm, Knöpfe, Mund, Augen, Nase, Kopf),
// dazu wächst die Sonne und die Pfütze. Freundlich, nicht gruselig.
export const PARTS = ['broom', 'hat', 'scarf', 'armL', 'armR', 'buttons', 'mouth', 'eyes', 'nose', 'head'];

// Wie viele Teile bei `errs` von `max` Fehlern schon weg sind (0..10). Erst beim letzten Fehler ist alles weg.
export function meltStage(errs, max) {
  if (!(max > 0) || !(errs > 0)) return 0;
  if (errs >= max) return PARTS.length;
  return Math.min(PARTS.length - 1, Math.floor((errs * PARTS.length) / max));
}

export function snowmanSvg(errs, max, lost = false) {
  const h = lost ? PARTS.length : meltStage(errs, max);
  const gone = new Set(PARTS.slice(0, h));
  const has = (p) => !gone.has(p);
  const sunR = 13 + h * 1.5;
  const puddleRx = 26 + h * 4.2;
  const puddleRy = 4 + h * 0.75;
  const drops = Math.min(4, Math.floor(h / 2));
  const parts = [];
  // Sonne
  const rays = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    rays.push(`<line x1="${(22 + Math.cos(a) * (sunR + 3)).toFixed(1)}" y1="${(22 + Math.sin(a) * (sunR + 3)).toFixed(1)}" x2="${(22 + Math.cos(a) * (sunR + 8)).toFixed(1)}" y2="${(22 + Math.sin(a) * (sunR + 8)).toFixed(1)}"/>`);
  }
  parts.push(`<g class="sun"><g stroke="#f2a900" stroke-width="3" stroke-linecap="round">${rays.join('')}</g><circle cx="22" cy="22" r="${sunR.toFixed(1)}" fill="#ffd23f" stroke="#f2a900" stroke-width="2"/></g>`);
  // Boden und Pfütze
  parts.push(`<ellipse cx="80" cy="136" rx="${(puddleRx + 14).toFixed(1)}" ry="${(puddleRy + 3).toFixed(1)}" fill="#e6eef5"/>`);
  parts.push(`<ellipse cx="80" cy="136" rx="${puddleRx.toFixed(1)}" ry="${puddleRy.toFixed(1)}" fill="#9fd3f0" stroke="#6fb4dc" stroke-width="1.5"/>`);
  // Besen
  if (has('broom')) parts.push('<g class="broom"><line x1="140" y1="52" x2="140" y2="128" stroke="#8a5a2b" stroke-width="4" stroke-linecap="round"/><path d="M132 128 L148 128 L151 142 L129 142 Z" fill="#d9b44a" stroke="#a8842a" stroke-width="2"/></g>');
  // Körper
  if (lost) {
    parts.push('<ellipse cx="80" cy="134" rx="22" ry="6" fill="#fff" stroke="#9db4c6" stroke-width="2"/>');
    parts.push('<polygon points="94,132 112,134 94,137" fill="#f08a24"/><rect x="58" y="128" width="16" height="4" rx="2" fill="#2b2b33"/>');
  } else {
    parts.push('<circle cx="80" cy="100" r="31" fill="#fff" stroke="#9db4c6" stroke-width="2.5"/>');
  }
  if (!lost) {
    if (has('armL')) parts.push('<g stroke="#7a4b22" stroke-width="3.5" stroke-linecap="round"><line x1="52" y1="94" x2="24" y2="76"/><line x1="34" y1="82" x2="26" y2="90"/></g>');
    if (has('armR')) parts.push('<g stroke="#7a4b22" stroke-width="3.5" stroke-linecap="round"><line x1="108" y1="94" x2="128" y2="72"/><line x1="119" y1="82" x2="129" y2="84"/></g>');
    if (has('buttons')) parts.push('<g fill="#2b2b33"><circle cx="80" cy="92" r="3.6"/><circle cx="80" cy="104" r="3.6"/><circle cx="80" cy="116" r="3.6"/></g>');
    if (has('head')) {
      parts.push('<circle cx="80" cy="58" r="23" fill="#fff" stroke="#9db4c6" stroke-width="2.5"/>');
      if (has('eyes')) parts.push('<g fill="#2b2b33"><circle cx="72" cy="52" r="3"/><circle cx="88" cy="52" r="3"/></g>');
      if (has('nose')) parts.push('<polygon points="80,58 103,63 80,67" fill="#f08a24" stroke="#c96a10" stroke-width="1"/>');
      if (has('mouth')) parts.push('<g fill="#2b2b33"><circle cx="68" cy="68" r="1.8"/><circle cx="73" cy="71" r="1.8"/><circle cx="80" cy="72.5" r="1.8"/><circle cx="87" cy="71" r="1.8"/><circle cx="92" cy="68" r="1.8"/></g>');
      if (has('scarf')) parts.push('<g><rect x="56" y="77" width="48" height="10" rx="5" fill="#d93a3a" stroke="#a82424" stroke-width="1.5"/><rect x="90" y="83" width="10" height="24" rx="4" fill="#d93a3a" stroke="#a82424" stroke-width="1.5"/></g>');
      if (has('hat')) parts.push('<g><rect x="55" y="36" width="50" height="6" rx="3" fill="#2b2b33"/><rect x="63" y="14" width="34" height="24" rx="3" fill="#2b2b33"/><rect x="63" y="28" width="34" height="5" fill="#d93a3a"/></g>');
    } else if (has('scarf')) {
      parts.push('<g><rect x="56" y="77" width="48" height="10" rx="5" fill="#d93a3a" stroke="#a82424" stroke-width="1.5"/></g>');
    }
  }
  // Tropfen
  const dropX = [58, 104, 70, 92];
  for (let i = 0; i < drops; i++) parts.push(`<path d="M${dropX[i]} ${112 + i * 3} q-3 6 0 8 q3 -2 0 -8 z" fill="#6fb4dc"/>`);
  const label = lost ? 'Der Schneemann ist ganz geschmolzen' : `Der Schneemann: ${errs} von ${max} Fehlern, noch ${PARTS.length - h} von ${PARTS.length} Teilen`;
  return `<svg viewBox="0 0 160 150" role="img" aria-label="${label}" focusable="false" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
