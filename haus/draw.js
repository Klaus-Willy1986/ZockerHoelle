// Haus & Hof – Zeichnen (reine Funktionen, kein DOM): Felder, Figuren, Würfel, Streifen, Quadrat, Gesamtübersicht.
import * as E from './engine.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Figuren: Farbe + Symbol (beides, damit sie auch ohne Farbsehen unterscheidbar sind)
export const TOKENS = [
  { name: 'Rot', thing: 'Auto', sym: '🚗', fill: '#d32f2f', text: '#ffffff' },
  { name: 'Blau', thing: 'Zylinder', sym: '🎩', fill: '#1e63d6', text: '#ffffff' },
  { name: 'Grün', thing: 'Hund', sym: '🐕', fill: '#16883a', text: '#ffffff' },
  { name: 'Gelb', thing: 'Schiff', sym: '🚢', fill: '#ffd400', text: '#1d1d1f' },
  { name: 'Lila', thing: 'Schuh', sym: '👞', fill: '#7b2cbf', text: '#ffffff' },
  { name: 'Türkis', thing: 'Roller', sym: '🛴', fill: '#00838f', text: '#ffffff' },
];
export const tokenOf = (idx) => TOKENS[((idx % 6) + 6) % 6];

export const GROUP_FILL = { braun: '#8b5a2b', himmel: '#4fb3e8', rosa: '#e8579f', orange: '#f28c00', rot: '#d32f2f', gelb: '#f5c400', gruen: '#2e9d4f', blau: '#1f4fbf' };
const SPECIAL_ICON = { start: '🏛️', jail: '🔒', free: '🌿', gojail: '👮', event: '❓', tax: '💶', station: '🚂' };
export const iconOf = (s) => (s.type === 'utility' ? (/Strom/.test(s.name) ? '💡' : '🚰') : SPECIAL_ICON[s.type] || '');

// Weiche Trennstellen, damit lange Straßennamen auf den schmalen Karten umbrechen
const SHY = {
  'Afföllerstraße': 'Afföller­straße',
  'Universitätsstraße': 'Univer­sitäts­straße',
  'Ockershäuser Allee': 'Ockers­häuser Allee',
  'Weidenhäuser Straße': 'Weiden­häuser Straße',
  'Frankfurter Straße': 'Frank­furter Straße',
  'Landgrafenschloss': 'Landgrafen­schloss',
  'Elisabethkirche': 'Elisabeth­kirche',
  'Gutenbergstraße': 'Guten­berg­straße',
  'Barfüßerstraße': 'Bar­füßer­straße',
  'Bahnhofstraße': 'Bahnhof­straße',
  'Biegenstraße': 'Biegen­straße',
  'Rudolphsplatz': 'Rudolphs­platz',
  'Semestergebühr': 'Semester­gebühr',
  'Parkgebühr Oberstadt': 'Park­gebühr Ober­stadt',
  'Hauptbahnhof': 'Haupt­bahnhof',
  'Südbahnhof': 'Süd­bahnhof',
  'Pilgrimstein': 'Pilgrim­stein',
  'Lahnwiesen': 'Lahn­wiesen',
  'Steinweg': 'Stein­weg',
  'Wettergasse': 'Wetter­gasse',
  'Marktplatz': 'Markt­platz',
  'Ketzerbach': 'Ketzer­bach',
  'Reitgasse': 'Reit­gasse',
  'Schwanallee': 'Schwan­allee',
  'Stadtwerke Strom': 'Stadt­werke Strom',
  'Stadtwerke Wasser': 'Stadt­werke Wasser',
  'Gehe in den Hexenturm': 'Gehe in den Hexen­turm',
  'Hexenturm (Besuch)': 'Hexen­turm (Besuch)',
};
export const shy = (name) => esc(SHY[name] || name);

// Feld i -> [Zeile, Spalte] (1-basiert) im 11x11-Quadrat: Start unten rechts, dann nach links, hinauf, nach rechts, hinab
export function sqGrid(i) {
  if (i <= 10) return [11, 11 - i];
  if (i <= 20) return [11 - (i - 10), 1];
  if (i <= 30) return [1, 1 + (i - 20)];
  return [1 + (i - 30), 11];
}

const PIPS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export function dieHtml(v, rolling) {
  const on = new Set(PIPS[v] || []);
  let cells = '';
  for (let k = 0; k < 9; k++) cells += `<b class="${on.has(k) ? 'on' : ''}"></b>`;
  return `<span class="hh-die${rolling ? ' roll' : ''}${v ? '' : ' none'}" role="img" aria-label="${v ? 'Würfel zeigt ' + v : 'Würfel noch nicht geworfen'}">${cells}</span>`;
}

export function tokenHtml(idx, size = 'sm', active = false, extra = '') {
  const t = tokenOf(idx);
  return `<span class="hh-tok ${size}${active ? ' act' : ''}" style="background:${t.fill};color:${t.text}" title="${t.name}: ${t.thing}" role="img" aria-label="Figur ${t.name}, ${t.thing}${extra ? ', ' + esc(extra) : ''}">${t.sym}</span>`;
}

const ownerOf = (g, i) => (g.owners[i] !== undefined ? g.players.find((p) => p.id === g.owners[i]) || null : null);

export function priceText(s) {
  if (s.price) return String(s.price);
  if (s.type === 'tax') return '−' + s.amount;
  if (s.type === 'start') return '+' + E.PASS_BONUS;
  return '';
}

export function squareLabel(g, i) {
  const s = E.SQUARES[i];
  const ow = ownerOf(g, i);
  const lvl = g.houses[i] || 0;
  let t = s.name;
  if (s.type === 'street') t += `, Farbe ${E.COLOR_NAMES[s.color]}`;
  if (s.price) t += `, Preis ${s.price}`;
  if (s.type === 'tax') t += `, Gebühr ${s.amount}`;
  if (ow) t += `, gehört ${ow.name} (${tokenOf(ow.token).name})`;
  if (lvl === 5) t += ', ein Hotel'; else if (lvl > 0) t += `, ${lvl} ${lvl === 1 ? 'Haus' : 'Häuser'}`;
  if (g.mortgaged[i]) t += ', beliehen';
  const here = g.players.filter((p) => !p.out && p.pos === i).map((p) => p.name);
  if (here.length) t += `, hier steht: ${here.join(', ')}`;
  return t;
}

// Ein Feld (für Streifen und Quadrat)
export function squareHtml(g, i, o = {}) {
  const s = E.SQUARES[i];
  const ow = ownerOf(g, i);
  const lvl = g.houses[i] || 0;
  const mort = !!g.mortgaged[i];
  const here = g.players.filter((p) => !p.out && p.pos === i);
  let fill = '#e6e0d2';
  let bar = '';
  if (s.type === 'street') {
    fill = GROUP_FILL[s.color];
    bar = lvl === 5 ? '<i class="ht"></i>' : '<i class="hs"></i>'.repeat(lvl);
  } else if (s.type === 'station' || s.type === 'utility') {
    fill = '#5b6070';
    bar = `<span class="hh-ic">${iconOf(s)}</span>`;
  } else bar = `<span class="hh-ic">${iconOf(s)}</span>`;
  const own = ow ? tokenOf(ow.token).fill : 'transparent';
  const pos = o.pos ? ` style="grid-row:${o.pos[0]};grid-column:${o.pos[1]};--own:${own}"` : ` style="--own:${own}"`;
  const foot = mort
    ? '<span class="hh-mt">beliehen</span>'
    : `<span class="hh-pr">${priceText(s)}</span>`;
  return `<div class="hh-sq t-${s.type}${mort ? ' mort' : ''}${o.focus ? ' focus' : ''}${ow ? ' owned' : ''}${here.length ? ' occ' : ''}${[0, 10, 20, 30].includes(i) ? ' corner' : ''}" data-sq="${i}"${pos} role="group" aria-label="${esc(squareLabel(g, i))}">`
    + `<div class="hh-bar" style="background:${fill}">${bar}</div>`
    + `<div class="hh-nm">${shy(s.name)}</div>`
    + `<div class="hh-ft">${foot}${ow ? tokenHtml(ow.token, 'xs', false, 'Besitzer') : ''}</div>`
    + `<div class="hh-tk">${here.map((p) => tokenHtml(p.token, 'sm', !!o.active && p.id === o.active)).join('')}</div>`
    + '</div>';
}

// Handy: Streifen mit allen 40 Feldern
export function stripHtml(g, o = {}) {
  let cells = '';
  for (let i = 0; i < E.BOARD_SIZE; i++) cells += squareHtml(g, i, { focus: o.focus === i, active: o.active });
  return `<div class="hh-strip" id="board" role="group" aria-label="Das Spielbrett: ein Rundweg mit 40 Feldern. Wische zur Seite, um weiter zu schauen.">${cells}</div>`;
}

// Desktop: klassisches Quadrat, Mitte frei für Aktionen
export function squareBoardHtml(g, centerHtml, o = {}) {
  let cells = '';
  for (let i = 0; i < E.BOARD_SIZE; i++) cells += squareHtml(g, i, { pos: sqGrid(i), focus: o.focus === i, active: o.active });
  return `<div class="hh-sqboard" id="board" role="group" aria-label="Das Spielbrett">${cells}<div class="hh-center">${centerHtml}</div></div>`;
}

// Gesamtübersicht: 11x11, jedes Feld klein mit Farbbalken, Figuren und Besitzer
export function miniBoardHtml(g, o = {}) {
  let cells = '';
  for (let i = 0; i < E.BOARD_SIZE; i++) {
    const s = E.SQUARES[i];
    const [r, c] = sqGrid(i);
    const ow = ownerOf(g, i);
    const lvl = g.houses[i] || 0;
    const mort = !!g.mortgaged[i];
    const here = g.players.filter((p) => !p.out && p.pos === i);
    const fill = s.type === 'street' ? GROUP_FILL[s.color] : s.type === 'station' || s.type === 'utility' ? '#5b6070' : '#d9d2c0';
    const bar = s.type === 'street' ? (lvl === 5 ? '<i class="ht"></i>' : '<i class="hs"></i>'.repeat(lvl)) : '';
    const ico = s.type === 'street' ? '' : iconOf(s);
    const tokens = here.map((p) => `<span class="hh-mtk" style="background:${tokenOf(p.token).fill};color:${tokenOf(p.token).text}">${tokenOf(p.token).sym}</span>`).join('');
    const own = ow ? `<span class="hh-mow" style="background:${tokenOf(ow.token).fill}"></span>` : '';
    cells += `<button type="button" class="hh-mc${o.focus === i ? ' focus' : ''}${mort ? ' mort' : ''}" data-act="focus" data-sq="${i}" style="grid-row:${r};grid-column:${c}" aria-label="${esc(squareLabel(g, i))}">`
      + `<span class="hh-mb" style="background:${fill}">${bar}</span><span class="hh-mi">${ico}</span>${own}<span class="hh-mtks">${tokens}</span></button>`;
  }
  const center = o.centerHtml || '';
  return `<div class="hh-mini" role="group" aria-label="Das ganze Brett">${cells}<div class="hh-mcenter">${center}</div></div>`;
}
