// Ich packe meinen Koffer – Katalog der Dinge (Bildkarten: Emoji + Wort).
// Nur Emoji, die auch auf älteren Handys gut zu erkennen sind (Unicode bis 2018). Jede id, jedes Emoji und jeder Name kommt genau einmal vor.
const d = (id, e, n) => ({ id, e, n });

export const DINGE = [
  // Kleidung
  d('socken', '🧦', 'Socken'), d('tshirt', '👕', 'T-Shirt'), d('hose', '👖', 'Hose'), d('kleid', '👗', 'Kleid'),
  d('jacke', '🧥', 'Jacke'), d('schal', '🧣', 'Schal'), d('handschuhe', '🧤', 'Handschuhe'), d('kappe', '🧢', 'Kappe'),
  d('sonnenhut', '👒', 'Sonnenhut'), d('zylinder', '🎩', 'Zylinder'), d('turnschuh', '👟', 'Turnschuh'), d('stiefel', '👢', 'Stiefel'),
  d('sandale', '👡', 'Sandale'), d('hemd', '👔', 'Hemd'), d('brille', '👓', 'Brille'), d('handtasche', '👜', 'Handtasche'),
  d('rucksack', '🎒', 'Rucksack'), d('ring', '💍', 'Ring'), d('aktentasche', '💼', 'Aktentasche'),
  // Bad und Haushalt
  d('creme', '🧴', 'Creme'), d('seife', '🧼', 'Seife'), d('klopapier', '🧻', 'Klopapier'), d('schwamm', '🧽', 'Schwamm'),
  d('besen', '🧹', 'Besen'), d('korb', '🧺', 'Wäschekorb'), d('badewanne', '🛁', 'Badewanne'), d('dusche', '🚿', 'Dusche'),
  d('kerze', '🕯️', 'Kerze'), d('besteck', '🍴', 'Besteck'), d('loeffel', '🥄', 'Löffel'), d('teller', '🍽️', 'Teller'),
  d('pfanne', '🍳', 'Pfanne'), d('messer', '🔪', 'Messer'), d('eimer', '🗑️', 'Mülleimer'), d('glocke', '🔔', 'Glocke'),
  // Technik
  d('kamera', '📷', 'Kamera'), d('handy', '📱', 'Handy'), d('laptop', '💻', 'Laptop'), d('stecker', '🔌', 'Stecker'),
  d('batterie', '🔋', 'Batterie'), d('kopfhoerer', '🎧', 'Kopfhörer'), d('radio', '📻', 'Radio'), d('lampe', '🔦', 'Lampe'),
  d('gluehbirne', '💡', 'Glühbirne'), d('wecker', '⏰', 'Wecker'), d('fernseher', '📺', 'Fernseher'), d('telefon', '☎️', 'Telefon'),
  d('mikrofon', '🎤', 'Mikrofon'), d('fernrohr', '🔭', 'Fernrohr'), d('lupe', '🔍', 'Lupe'),
  // Papier und Reise
  d('buch', '📖', 'Buch'), d('zeitung', '📰', 'Zeitung'), d('bleistift', '✏️', 'Bleistift'), d('notizbuch', '📓', 'Notizbuch'),
  d('landkarte', '🗺️', 'Landkarte'), d('fahrkarte', '🎫', 'Fahrkarte'), d('bankkarte', '💳', 'Bankkarte'), d('geld', '💶', 'Geld'),
  d('brief', '✉️', 'Brief'), d('schere', '✂️', 'Schere'), d('kompass', '🧭', 'Kompass'), d('zelt', '⛺', 'Zelt'),
  d('schluessel', '🔑', 'Schlüssel'), d('schloss', '🔒', 'Schloss'), d('schirm', '☂️', 'Regenschirm'), d('tabletten', '💊', 'Tabletten'),
  d('thermometer', '🌡️', 'Thermometer'), d('paket', '📦', 'Paket'), d('tuete', '🛍️', 'Tüte'), d('fahrrad', '🚲', 'Fahrrad'),
  // Essen und Trinken
  d('apfel', '🍎', 'Apfel'), d('banane', '🍌', 'Banane'), d('sandwich', '🥪', 'Sandwich'), d('schokolade', '🍫', 'Schokolade'),
  d('keks', '🍪', 'Keks'), d('kaffee', '☕', 'Kaffee'), d('brot', '🍞', 'Brot'), d('kaese', '🧀', 'Käse'),
  d('ei', '🥚', 'Ei'), d('trauben', '🍇', 'Trauben'), d('weinglas', '🍷', 'Weinglas'), d('pizza', '🍕', 'Pizza'),
  d('eis', '🍦', 'Eis'), d('torte', '🎂', 'Torte'), d('zitrone', '🍋', 'Zitrone'), d('erdbeere', '🍓', 'Erdbeere'),
  d('karotte', '🥕', 'Karotte'), d('bier', '🍺', 'Bier'),
  // Spiel und Freizeit
  d('fussball', '⚽', 'Fußball'), d('tennisball', '🎾', 'Tennisball'), d('wuerfel', '🎲', 'Würfel'), d('spielkarte', '🃏', 'Spielkarte'),
  d('puzzle', '🧩', 'Puzzle'), d('gitarre', '🎸', 'Gitarre'), d('trompete', '🎺', 'Trompete'), d('klavier', '🎹', 'Klavier'),
  d('trommel', '🥁', 'Trommel'), d('farben', '🎨', 'Farben'), d('teddy', '🧸', 'Teddy'), d('ballon', '🎈', 'Luftballon'),
  d('geschenk', '🎁', 'Geschenk'), d('angel', '🎣', 'Angel'), d('pokal', '🏆', 'Pokal'),
  // Werkzeug
  d('hammer', '🔨', 'Hammer'), d('werkzeug', '🛠️', 'Werkzeug'), d('magnet', '🧲', 'Magnet'),
];

export const DINGE_BY_ID = Object.fromEntries(DINGE.map((x) => [x.id, x]));
