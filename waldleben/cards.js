// Waldleben – der Kartensatz (eigene Karten, eigene Namen). Reine Daten, keine Oberfläche.
// Karten-Nummern: 0..47 Bäume, 48..112 Tiere/Pflanzen/Pilze, 113..115 Winterkarten.

export const SPECIES = [
  { name: 'Eiche', pl: 'Eichen', sym: '●', col: '#7b4a1e', txt: '#ffffff', light: '#efdcc8' },
  { name: 'Buche', pl: 'Buchen', sym: '■', col: '#1565c0', txt: '#ffffff', light: '#dbe8f8' },
  { name: 'Linde', pl: 'Linden', sym: '▲', col: '#f2c200', txt: '#111111', light: '#fff3bf' },
  { name: 'Ahorn', pl: 'Ahorne', sym: '◆', col: '#c62828', txt: '#ffffff', light: '#f9dcdc' },
  { name: 'Birke', pl: 'Birken', sym: '★', col: '#d9dde0', txt: '#111111', light: '#f1f3f4' },
  { name: 'Kiefer', pl: 'Kiefern', sym: '✚', col: '#1b6b2f', txt: '#ffffff', light: '#d9eedd' },
];

export const TYPES = {
  vogel: { name: 'Vogel', pl: 'Vögel', sym: '🐦' },
  saeuger: { name: 'Säugetier', pl: 'Säugetiere', sym: '🐾' },
  insekt: { name: 'Insekt', pl: 'Insekten', sym: '🐝' },
  kleintier: { name: 'Kleintier', pl: 'Kleintiere', sym: '🐌' },
  pilz: { name: 'Pilz', pl: 'Pilze', sym: '🍄' },
  pflanze: { name: 'Pflanze', pl: 'Pflanzen', sym: '🌿' },
};
export const TYPE_KEYS = Object.keys(TYPES);

// ---- Punkte-Regeln ----
// fix: n Punkte | per: n Punkte je d gezählte Dinge | ifge: n Punkte, wenn mindestens min Dinge da sind
const F = (n) => ({ k: 'fix', n });
const P = (w, n, d = 1) => ({ k: 'per', w, n, d });
const G = (w, min, n) => ({ k: 'ifge', w, min, n });
// ---- Effekte ----
const D = (n) => ({ k: 'draw', n }); // Karten ziehen
const C = (n) => ({ k: 'cave', n }); // oberste Karten in die Höhle
const X = { k: 'extra' }; // Extrazug
const DAUER = (id) => ({ k: 'dauer', id }); // dauerhafter Pilz-Effekt: 'hand12' | 'pass2' | 'draw3'

// [Name, Zeichen, Art, Baum (0 Eiche,1 Buche,2 Linde,3 Ahorn,4 Birke,5 Kiefer), Kosten, Punkte, Effekt]
const E = 0; const B = 1; const L = 2; const A = 3; const I = 4; const K = 5;
const LIFE = [
  // Vögel (12)
  ['Buntspecht', '🐦', 'vogel', E, 1, F(2)],
  ['Eichelhäher', '🐦', 'vogel', E, 2, P('tree:0', 1)],
  ['Waldkauz', '🦉', 'vogel', B, 3, F(4), C(1)],
  ['Mäusebussard', '🦅', 'vogel', K, 4, P('type:saeuger', 2)],
  ['Kohlmeise', '🐦', 'vogel', L, 0, F(1)],
  ['Rotkehlchen', '🐦', 'vogel', I, 1, F(1), D(1)],
  ['Singdrossel', '🐦', 'vogel', A, 2, F(3)],
  ['Kleiber', '🐦', 'vogel', B, 1, P('trees', 1, 2)],
  ['Uhu', '🦉', 'vogel', K, 4, F(7)],
  ['Kuckuck', '🐦', 'vogel', L, 2, F(2), X],
  ['Waldohreule', '🦉', 'vogel', I, 3, G('types', 4, 6)],
  ['Ringeltaube', '🕊️', 'vogel', A, 1, P('type:vogel', 1)],
  // Säugetiere (12)
  ['Eichhörnchen', '🐿️', 'saeuger', E, 1, F(2)],
  ['Igel', '🦔', 'saeuger', B, 2, F(2), C(1)],
  ['Rotfuchs', '🦊', 'saeuger', K, 3, P('type:vogel', 2)],
  ['Reh', '🦌', 'saeuger', L, 2, F(3)],
  ['Rothirsch', '🦌', 'saeuger', E, 3, P('trees', 1)],
  ['Wildschwein', '🐗', 'saeuger', B, 3, F(5)],
  ['Feldhase', '🐇', 'saeuger', L, 2, F(2), X],
  ['Dachs', '🦡', 'saeuger', A, 2, F(1), C(2)],
  ['Haselmaus', '🐁', 'saeuger', I, 0, F(1)],
  ['Fledermaus', '🦇', 'saeuger', K, 2, G('types', 3, 5)],
  ['Biber', '🦫', 'saeuger', I, 3, P('tree:4', 2)],
  ['Wildkatze', '🐈', 'saeuger', E, 3, F(3), D(1)],
  // Insekten (10)
  ['Honigbiene', '🐝', 'insekt', L, 1, P('type:pflanze', 1)],
  ['Tagpfauenauge', '🦋', 'insekt', A, 1, F(2)],
  ['Marienkäfer', '🐞', 'insekt', I, 0, F(1)],
  ['Rote Waldameise', '🐜', 'insekt', K, 2, P('type:insekt', 1)],
  ['Hirschkäfer', '🪲', 'insekt', E, 3, F(5)],
  ['Feldgrille', '🦗', 'insekt', B, 0, F(0), D(1)],
  ['Raupe', '🐛', 'insekt', L, 1, G('type:insekt', 3, 4)],
  ['Mistkäfer', '🪲', 'insekt', K, 2, P('type:pilz', 2)],
  ['Glühwürmchen', '✨', 'insekt', B, 2, G('cave', 3, 5)],
  ['Hummel', '🐝', 'insekt', A, 2, F(2), D(1)],
  // Kleintiere (8)
  ['Grasfrosch', '🐸', 'kleintier', I, 1, F(2)],
  ['Waldeidechse', '🦎', 'kleintier', K, 1, P('type:kleintier', 1)],
  ['Ringelnatter', '🐍', 'kleintier', L, 3, F(3), C(2)],
  ['Weinbergschnecke', '🐌', 'kleintier', B, 0, F(1)],
  ['Kreuzspinne', '🕷️', 'kleintier', E, 3, P('type:insekt', 2)],
  ['Regenwurm', '🪱', 'kleintier', A, 0, F(0), C(1)],
  ['Feuersalamander', '🦎', 'kleintier', B, 2, G('type:pilz', 2, 5)],
  ['Erdkröte', '🐸', 'kleintier', A, 2, F(3)],
  // Pilze (11, davon 3 mit Dauer-Effekt)
  ['Fliegenpilz', '🍄', 'pilz', I, 1, F(1), C(1)],
  ['Steinpilz', '🍄', 'pilz', K, 2, F(2), DAUER('hand12')],
  ['Pfifferling', '🍄', 'pilz', B, 2, F(2), DAUER('pass2')],
  ['Hallimasch', '🍄', 'pilz', E, 3, F(1), DAUER('draw3')],
  ['Parasol', '🍄', 'pilz', L, 2, F(3)],
  ['Birkenpilz', '🍄', 'pilz', I, 1, P('tree:4', 1)],
  ['Schopftintling', '🍄', 'pilz', A, 0, F(1)],
  ['Maronenröhrling', '🍄', 'pilz', K, 1, P('type:pilz', 1)],
  ['Morchel', '🍄', 'pilz', A, 3, F(5)],
  ['Rotkappe', '🍄', 'pilz', E, 2, G('trees', 5, 5)],
  ['Zunderschwamm', '🍄', 'pilz', B, 3, P('tree:1', 2)],
  // Pflanzen (12)
  ['Walderdbeere', '🍓', 'pflanze', L, 1, F(1), D(1)],
  ['Heidelbeere', '🫐', 'pflanze', K, 1, P('tree:5', 1)],
  ['Farn', '🌿', 'pflanze', B, 0, F(1)],
  ['Buschwindröschen', '🌼', 'pflanze', E, 0, P('type:pflanze', 1, 2)],
  ['Efeu', '🍃', 'pflanze', A, 1, P('full', 2)],
  ['Moos', '🌱', 'pflanze', I, 0, F(1)],
  ['Heckenrose', '🌹', 'pflanze', L, 2, G('species', 3, 5)],
  ['Vogelkirsche', '🍒', 'pflanze', E, 3, P('type:vogel', 2)],
  ['Haselstrauch', '🌰', 'pflanze', L, 2, F(2), C(1)],
  ['Fingerhut', '🌺', 'pflanze', I, 3, G('type:pflanze', 3, 6)],
  ['Eibe', '🌲', 'pflanze', K, 4, G('trees', 6, 10)],
  ['Bärlauch', '🌿', 'pflanze', B, 1, F(2)],
];

export const N_TREES = 48;
export const N_LIFE = LIFE.length; // 65
export const WINTER_FIRST = N_TREES + N_LIFE; // 113
export const N_WINTER = 3;
export const TOTAL = WINTER_FIRST + N_WINTER; // 116

export const CARDS = [];
for (let s = 0; s < 6; s++) for (let i = 0; i < 8; i++) CARDS.push({ id: CARDS.length, kind: 'tree', sp: s, name: SPECIES[s].name, sym: '🌳', type: null, cost: 0, pts: null, fx: null });
for (const [name, sym, type, sp, cost, pts, fx] of LIFE) CARDS.push({ id: CARDS.length, kind: 'life', sp, name, sym, type, cost, pts, fx: fx || null });
for (let i = 0; i < N_WINTER; i++) CARDS.push({ id: CARDS.length, kind: 'winter', sp: -1, name: 'Winter', sym: '❄️', type: null, cost: 0, pts: null, fx: null });

export const isId = (x) => Number.isInteger(x) && x >= 0 && x < TOTAL;
export const WINTER_IDS = Array.from({ length: N_WINTER }, (_, i) => WINTER_FIRST + i);

// ---- Zählen im eigenen Wald ----
// p = { trees: [{ sp, id, sides: [id|null ×4] }], cave: [id] }; nur sichtbare Karten zählen.
export function lifeCards(p) {
  const out = [];
  for (const t of p.trees) for (const s of t.sides) if (s !== null && s !== undefined) out.push(CARDS[s]);
  return out;
}
export function count(p, what) {
  if (what === 'trees') return p.trees.length;
  if (what === 'cave') return p.cave.length;
  if (what === 'full') return p.trees.filter((t) => t.sides.every((s) => s !== null)).length;
  if (what === 'species') return new Set(p.trees.filter((t) => t.sp >= 0).map((t) => t.sp)).size;
  if (what === 'types') return new Set(lifeCards(p).map((c) => c.type)).size;
  if (what.startsWith('tree:')) { const s = Number(what.slice(5)); return p.trees.filter((t) => t.sp === s).length; }
  if (what.startsWith('type:')) { const ty = what.slice(5); return lifeCards(p).filter((c) => c.type === ty).length; }
  return 0;
}
export function cardPoints(p, c) {
  const r = c.pts;
  if (!r) return 0;
  if (r.k === 'fix') return r.n;
  const n = count(p, r.w);
  if (r.k === 'per') return Math.floor(n / (r.d || 1)) * r.n;
  if (r.k === 'ifge') return n >= r.min ? r.n : 0;
  return 0;
}

// ---- Texte (einfaches Deutsch) ----
const pt = (n) => (n === 1 ? '1 Punkt' : `${n} Punkte`);
function labels(w) {
  if (w === 'trees') return { one: 'Baum', many: 'Bäume' };
  if (w === 'full') return { one: 'voll besetztem Baum', many: 'voll besetzte Bäume' };
  if (w === 'cave') return { one: 'Karte in deiner Höhle', many: 'Karten in deiner Höhle' };
  if (w === 'species') return { one: 'Baumart', many: 'verschiedene Baumarten' };
  if (w === 'types') return { one: 'Kartenart', many: 'verschiedene Kartenarten' };
  if (w.startsWith('tree:')) { const s = SPECIES[Number(w.slice(5))]; return { one: s.name, many: s.pl }; }
  if (w.startsWith('type:')) { const t = TYPES[w.slice(5)]; return { one: t.name, many: t.pl }; }
  return { one: '?', many: '?' };
}
export function ptsText(c) {
  const r = c.pts;
  if (!r) return '';
  if (r.k === 'fix') return pt(r.n);
  const l = labels(r.w);
  if (r.k === 'per') {
    const suffix = r.w === 'cave' ? '' : ' in deinem Wald';
    return `${pt(r.n)} pro ${r.d > 1 ? `${r.d} ${l.many}` : l.one}${suffix}`;
  }
  return `${pt(r.n)}, wenn du mindestens ${r.min} ${l.many} hast`;
}
export function fxText(c) {
  const f = c.fx;
  if (!f) return '';
  if (f.k === 'draw') return f.n === 1 ? 'Ziehe sofort 1 Karte vom Stapel.' : `Ziehe sofort ${f.n} Karten vom Stapel.`;
  if (f.k === 'cave') return f.n === 1 ? 'Lege die oberste Karte vom Stapel verdeckt in deine Höhle.' : `Lege die obersten ${f.n} Karten vom Stapel verdeckt in deine Höhle.`;
  if (f.k === 'extra') return 'Du bist gleich noch einmal dran (Extrazug).';
  if (f.k === 'dauer') {
    if (f.id === 'hand12') return 'Dauer: Du darfst 12 statt 10 Handkarten haben.';
    if (f.id === 'pass2') return 'Dauer: Wenn du passend bezahlst, ziehst du 2 statt 1 Karte.';
    if (f.id === 'draw3') return 'Dauer: Beim Ziehen darfst du 3 statt 2 Karten ziehen.';
  }
  return '';
}
export function explainPoints(p, c, n) {
  const r = c.pts;
  if (!r) return '';
  if (r.k === 'fix') return 'feste Punkte';
  const l = labels(r.w);
  const cnt = n === undefined ? count(p, r.w) : n;
  if (r.k === 'per') {
    const pts = Math.floor(cnt / (r.d || 1)) * r.n;
    if (r.d > 1) return `${cnt} ${cnt === 1 ? l.one : l.many}: je ${r.d} = ${pt(r.n)} → ${pts}`;
    return `${cnt} × ${r.n} = ${pts}`;
  }
  return `${cnt} von mindestens ${r.min} → ${cnt >= r.min ? r.n : 0}`;
}
export const costText = (n) => (n === 0 ? 'kostenlos' : n === 1 ? 'Kosten: 1 Karte' : `Kosten: ${n} Karten`);
export const typeName = (c) => (c.kind === 'tree' ? 'Baum' : c.kind === 'winter' ? 'Winter' : TYPES[c.type].name);
export const hasDauer = (p, id) => p.trees.some((t) => t.sides.some((s) => s !== null && CARDS[s].fx && CARDS[s].fx.k === 'dauer' && CARDS[s].fx.id === id));
