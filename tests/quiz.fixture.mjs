// Beispiel-Fragensammlung für die Tests des Kneipenquiz (unabhängig von quiz/fragen.js).
// 8 Kategorien x 9 Fragen = 72 Fragen (je 5 mc, 2 tf, 1 est, 1 order, d:1/2) plus 5 Nerd-Kategorien x 8 Fragen = 40
// (je 4 mc, 2 tf, 1 est, 1 order; davon 15 mit d:3).
export const KATEGORIEN = {
  geo: 'Erdkunde 🌍', gesch: 'Geschichte 🏰', natur: 'Natur 🌿', essen: 'Essen und Trinken 🍺',
  musik: 'Musik 🎵', film: 'Film und Fernsehen 📺', sport: 'Sport ⚽', allg: 'Allgemeinwissen 🧠',
  nerd: 'Nerd und Technik 🤓', weltall: 'Weltall und Wissenschaft 🔭', spiele: 'Spiele und Games 🎲', erfinder: 'Erfindungen und Entdeckungen 💡', serien: 'Serien und Filme 📺',
};

let n = 0;
const id = () => `f${String(++n).padStart(3, '0')}`;
const mc = (k, d, q, a, c, fun) => ({ id: id(), k, t: 'mc', d, q, a, c, ...(fun ? { fun } : {}) });
const tf = (k, d, q, c, fun) => ({ id: id(), k, t: 'tf', d, q, c, ...(fun ? { fun } : {}) });
const est = (k, d, q, c, unit, min, max, fun) => ({ id: id(), k, t: 'est', d, q, c, unit, min, max, ...(fun ? { fun } : {}) });
const order = (k, d, q, items, fun) => ({ id: id(), k, t: 'order', d, q, items, ...(fun ? { fun } : {}) });

export const FRAGEN = [
  // ---- Erdkunde
  mc('geo', 1, 'Welche Stadt ist die Hauptstadt von Frankreich?', ['Lyon', 'Paris', 'Nizza', 'Marseille'], 1),
  mc('geo', 1, 'An welchem Meer liegt Rostock?', ['Nordsee', 'Mittelmeer', 'Ostsee', 'Schwarzes Meer'], 2),
  mc('geo', 2, 'Welcher Fluss fließt durch Wien?', ['Rhein', 'Elbe', 'Donau', 'Inn'], 2),
  mc('geo', 1, 'Welches ist das größte Land der Erde?', ['Kanada', 'China', 'Russland', 'Brasilien'], 2),
  mc('geo', 2, 'In welchem Land steht der Schiefe Turm von Pisa?', ['Spanien', 'Italien', 'Griechenland', 'Portugal'], 1, 'Der steht schon länger schief, als ich hier ausschenke.'),
  tf('geo', 1, 'Die Zugspitze ist der höchste Berg Deutschlands.', true),
  tf('geo', 2, 'Australien ist ein Land in Europa.', false),
  est('geo', 2, 'Wie hoch ist die Zugspitze?', 2962, 'Meter', 1000, 4000),
  order('geo', 2, 'Ordne die Städte von Norden nach Süden.', ['Hamburg', 'Hannover', 'Frankfurt', 'München']),
  // ---- Geschichte
  mc('gesch', 1, 'In welchem Jahr fiel die Berliner Mauer?', ['1961', '1975', '1989', '1995'], 2),
  mc('gesch', 2, 'Wer war der erste Bundeskanzler der Bundesrepublik Deutschland?', ['Willy Brandt', 'Konrad Adenauer', 'Helmut Kohl', 'Ludwig Erhard'], 1),
  mc('gesch', 1, 'Welches Volk baute die Pyramiden von Gizeh?', ['Römer', 'Griechen', 'Ägypter', 'Perser'], 2),
  mc('gesch', 2, 'Wer entdeckte 1492 Amerika für Europa?', ['Marco Polo', 'Christoph Kolumbus', 'Vasco da Gama', 'James Cook'], 1),
  mc('gesch', 2, 'Welche Währung löste 2002 die D-Mark ab?', ['Franken', 'Euro', 'Dollar', 'Schilling'], 1),
  tf('gesch', 1, 'Karl der Große wurde im Jahr 800 zum Kaiser gekrönt.', true),
  tf('gesch', 2, 'Die erste Mondlandung fand in den 1980er Jahren statt.', false),
  est('gesch', 2, 'In welchem Jahr wurde die Bundesrepublik Deutschland gegründet?', 1949, 'Jahr', 1900, 2000),
  order('gesch', 2, 'Bringe die Ereignisse in die richtige zeitliche Reihenfolge.', ['Erfindung des Buchdrucks', 'Entdeckung Amerikas', 'Französische Revolution', 'Fall der Berliner Mauer']),
  // ---- Natur
  mc('natur', 1, 'Wie viele Beine hat ein Insekt?', ['Vier', 'Sechs', 'Acht', 'Zehn'], 1),
  mc('natur', 1, 'Welches Tier ist das größte an Land?', ['Nashorn', 'Giraffe', 'Elefant', 'Nilpferd'], 2),
  mc('natur', 2, 'Wie nennt man ein junges Pferd?', ['Kalb', 'Fohlen', 'Ferkel', 'Lamm'], 1),
  mc('natur', 1, 'Welche Farbe haben reife Tomaten meistens?', ['Blau', 'Rot', 'Weiß', 'Schwarz'], 1),
  mc('natur', 2, 'Welcher Baum trägt Eicheln?', ['Buche', 'Eiche', 'Tanne', 'Birke'], 1),
  tf('natur', 1, 'Wale sind Fische.', false, 'Säugetiere mit Flosse. Das merke ich mir bei jedem Fischgericht.'),
  tf('natur', 2, 'Bienen stellen Honig her.', true),
  est('natur', 1, 'Wie viele Zähne hat ein erwachsener Mensch normalerweise?', 32, 'Zähne', 0, 60),
  order('natur', 1, 'Ordne die Tiere vom kleinsten zum größten.', ['Maus', 'Katze', 'Pferd', 'Elefant']),
  // ---- Essen und Trinken
  mc('essen', 1, 'Woraus wird Sauerkraut gemacht?', ['Spinat', 'Weißkohl', 'Rotkohl', 'Salat'], 1),
  mc('essen', 1, 'Welches Getränk wird aus Hopfen und Malz gebraut?', ['Wein', 'Bier', 'Milch', 'Saft'], 1, 'Da kenne ich mich aus. Prost!'),
  mc('essen', 2, 'Aus welchem Land stammt die Pizza ursprünglich?', ['Spanien', 'Frankreich', 'Italien', 'Türkei'], 2),
  mc('essen', 2, 'Welche Zutat gibt dem Brot seinen Auftrieb?', ['Hefe', 'Salz', 'Zucker', 'Öl'], 0),
  mc('essen', 1, 'Welches Obst ist Hauptzutat von Apfelstrudel?', ['Birne', 'Pflaume', 'Apfel', 'Kirsche'], 2),
  tf('essen', 1, 'Eine Brezel gehört zur bayerischen Brotzeit.', true),
  tf('essen', 2, 'Wein wird aus Getreide gebraut.', false),
  est('essen', 2, 'Wie viel Milliliter hat eine Maß Bier in Bayern?', 1000, 'Milliliter', 200, 2000),
  order('essen', 2, 'Ordne die Mahlzeiten im Tagesverlauf.', ['Frühstück', 'Mittagessen', 'Kaffeetrinken', 'Abendbrot']),
  // ---- Musik
  mc('musik', 1, 'Wie viele Saiten hat eine normale Gitarre?', ['Vier', 'Fünf', 'Sechs', 'Acht'], 2),
  mc('musik', 2, 'Wer komponierte die Zauberflöte?', ['Beethoven', 'Mozart', 'Bach', 'Wagner'], 1),
  mc('musik', 1, 'Welches Instrument hat schwarze und weiße Tasten?', ['Geige', 'Klavier', 'Flöte', 'Trommel'], 1),
  mc('musik', 2, 'Welche Band sang Yesterday?', ['Die Rolling Stones', 'Die Beatles', 'ABBA', 'Queen'], 1),
  mc('musik', 1, 'Was ist ein Dirigent?', ['Ein Sänger', 'Leiter eines Orchesters', 'Ein Komponist', 'Ein Tänzer'], 1),
  tf('musik', 1, 'Eine Geige hat mehr Saiten als ein Kontrabass.', false),
  tf('musik', 2, 'Beethoven wurde im Laufe seines Lebens schwerhörig.', true),
  est('musik', 2, 'Wie viele Tasten hat ein großer Konzertflügel?', 88, 'Tasten', 20, 140),
  order('musik', 2, 'Ordne diese Stimmlagen von hoch nach tief.', ['Sopran', 'Alt', 'Tenor', 'Bass']),
  // ---- Film und Fernsehen
  mc('film', 1, 'Wie heißt der Zauberlehrling mit der Blitznarbe?', ['Frodo', 'Harry Potter', 'Merlin', 'Peter Pan'], 1),
  mc('film', 2, 'Wer spielte die Hauptrolle in Sissi?', ['Romy Schneider', 'Hildegard Knef', 'Marlene Dietrich', 'Heidi Brühl'], 0),
  mc('film', 1, 'Welches Tier ist Bambi?', ['Hase', 'Reh', 'Fuchs', 'Bär'], 1),
  mc('film', 2, 'In welcher Stadt spielt der Film Casablanca?', ['Paris', 'Rom', 'Casablanca', 'Kairo'], 2),
  mc('film', 1, 'Wie heißt die kleine Biene aus dem Kinderfilm?', ['Maja', 'Lisa', 'Anna', 'Emma'], 0),
  tf('film', 1, 'Der Tatort läuft traditionell am Sonntagabend.', true),
  tf('film', 2, 'Charlie Chaplin war ein Stummfilm-Star.', true),
  est('film', 2, 'Wie viele Teile hat die Herr-der-Ringe-Filmreihe?', 3, 'Filme', 1, 10),
  order('film', 2, 'Ordne die Filme nach dem Erscheinungsjahr, der älteste zuerst.', ['Metropolis', 'Casablanca', 'Der Pate', 'Titanic']),
  // ---- Sport
  mc('sport', 1, 'Wie viele Spieler hat eine Fußballmannschaft auf dem Feld?', ['Neun', 'Zehn', 'Elf', 'Zwölf'], 2),
  mc('sport', 2, 'In welcher Sportart gibt es einen Aufschlag und ein Netz, aber keinen Schläger?', ['Tennis', 'Volleyball', 'Badminton', 'Tischtennis'], 1),
  mc('sport', 1, 'Welche Farbe hat die Karte bei einem Platzverweis im Fußball?', ['Gelb', 'Rot', 'Grün', 'Blau'], 1),
  mc('sport', 2, 'Wo fanden die Olympischen Spiele 1972 statt?', ['Berlin', 'München', 'Hamburg', 'Köln'], 1),
  mc('sport', 1, 'Wie viele Ringe hat das olympische Zeichen?', ['Vier', 'Fünf', 'Sechs', 'Sieben'], 1),
  tf('sport', 1, 'Beim Kegeln wird mit einer Kugel auf Kegel gezielt.', true),
  tf('sport', 2, 'Ein Marathon ist genau 100 Kilometer lang.', false),
  est('sport', 2, 'Wie lang ist ein Marathonlauf?', 42, 'Kilometer', 10, 100),
  order('sport', 1, 'Ordne die Medaillen vom wertvollsten zum geringsten Platz.', ['Gold', 'Silber', 'Bronze', 'Blech']),
  // ---- Allgemeinwissen
  mc('allg', 1, 'Wie viele Tage hat eine Woche?', ['Fünf', 'Sechs', 'Sieben', 'Acht'], 2),
  mc('allg', 1, 'Welche Farbe entsteht beim Mischen von Blau und Gelb?', ['Grün', 'Orange', 'Violett', 'Braun'], 0),
  mc('allg', 2, 'Wie viele Minuten hat eine Stunde?', ['50', '60', '75', '100'], 1),
  mc('allg', 2, 'Welches Metall ist bei Zimmertemperatur flüssig?', ['Eisen', 'Quecksilber', 'Kupfer', 'Zinn'], 1),
  mc('allg', 1, 'Wie heißt der Planet, auf dem wir leben?', ['Mars', 'Venus', 'Erde', 'Jupiter'], 2),
  tf('allg', 1, 'Ein Dreieck hat vier Ecken.', false),
  tf('allg', 2, 'Der Mond kreist um die Erde.', true),
  est('allg', 1, 'Wie viele Monate haben mindestens 31 Tage?', 7, 'Monate', 0, 12),
  order('allg', 1, 'Ordne die Wochentage, beginnend mit Montag.', ['Montag', 'Mittwoch', 'Freitag', 'Sonntag']),
  // ---- Nerd und Technik
  mc('nerd', 1, 'Wofür steht die Abkürzung WLAN?', ['Weites Lokales Netz', 'Drahtloses lokales Netzwerk', 'Wichtiges Leitungsnetz', 'Wireless Long Area Net'], 1),
  mc('nerd', 2, 'Welche Taste wiederholt auf der Tastatur die letzte Eingabe nicht, sondern löscht das Zeichen links vom Cursor?', ['Entf', 'Rückschritt', 'Einfg', 'Pos1'], 1),
  mc('nerd', 3, 'Welche Programmiersprache ist nach einer Schlange benannt?', ['Java', 'Python', 'Ruby', 'Swift'], 1),
  mc('nerd', 3, 'Wie viele Bit hat ein Byte?', ['Vier', 'Sechs', 'Acht', 'Zehn'], 2),
  tf('nerd', 1, 'Ein Smartphone kann mit einer SIM-Karte telefonieren.', true),
  tf('nerd', 2, 'Die Abkürzung USB steht für Universal Serial Bus.', true),
  est('nerd', 1, 'In welchem Jahr kam das erste iPhone auf den Markt?', 2007, 'Jahr', 1990, 2020),
  order('nerd', 3, 'Ordne die Speichergrößen von klein nach groß.', ['Kilobyte', 'Megabyte', 'Gigabyte', 'Terabyte']),
  // ---- Weltall und Wissenschaft
  mc('weltall', 1, 'Welcher Planet ist der Sonne am nächsten?', ['Venus', 'Merkur', 'Erde', 'Mars'], 1),
  mc('weltall', 2, 'Wie heißt unsere Galaxie?', ['Andromeda', 'Milchstraße', 'Sombrero', 'Wirbelgalaxie'], 1),
  mc('weltall', 3, 'Welches Gas macht den größten Teil der Sonne aus?', ['Sauerstoff', 'Helium', 'Wasserstoff', 'Stickstoff'], 2),
  mc('weltall', 3, 'Wie nennt man die Anziehungskraft der Erde?', ['Magnetismus', 'Schwerkraft', 'Reibung', 'Auftrieb'], 1),
  tf('weltall', 1, 'Der Mond leuchtet von selbst.', false),
  tf('weltall', 2, 'Der Jupiter ist der größte Planet unseres Sonnensystems.', true),
  est('weltall', 1, 'Wie viele Planeten hat unser Sonnensystem?', 8, 'Planeten', 0, 20),
  order('weltall', 3, 'Ordne die Planeten nach Abstand zur Sonne, der nächste zuerst.', ['Merkur', 'Erde', 'Jupiter', 'Neptun']),
  // ---- Spiele und Games
  mc('spiele', 1, 'Wie viele Felder hat ein Schachbrett?', ['32', '48', '64', '100'], 2),
  mc('spiele', 2, 'Welche Figur zieht im Schach nur diagonal?', ['Turm', 'Läufer', 'Springer', 'Bauer'], 1),
  mc('spiele', 3, 'Welcher Klempner springt in einem berühmten Videospiel auf Gegner?', ['Donkey Kong', 'Mario', 'Sonic', 'Link'], 1),
  mc('spiele', 3, 'Wie viele Augen hat ein normaler Würfel auf allen sechs Seiten zusammen?', ['18', '21', '24', '36'], 1),
  tf('spiele', 1, 'Beim Mensch ärgere dich nicht würfelt man mit einem Würfel.', true),
  tf('spiele', 2, 'Ein Skatspiel hat 32 Karten.', true),
  est('spiele', 1, 'Wie viele Steine hat jede Person bei Mensch ärgere dich nicht?', 4, 'Steine', 0, 20),
  order('spiele', 3, 'Ordne die Brettspiele nach der Zahl ihrer Felder, wenig zuerst.', ['Mühle', 'Dame', 'Schach', 'Go']),
  // ---- Erfindungen und Entdeckungen
  mc('erfinder', 1, 'Wer erfand die Glühbirne in ihrer heute bekannten Form maßgeblich?', ['Thomas Edison', 'Isaac Newton', 'Albert Einstein', 'Nikola Tesla'], 0),
  mc('erfinder', 2, 'Wer entdeckte das Penicillin?', ['Alexander Fleming', 'Louis Pasteur', 'Robert Koch', 'Marie Curie'], 0),
  mc('erfinder', 3, 'Wer erfand den Buchdruck mit beweglichen Lettern in Europa?', ['Gutenberg', 'Daimler', 'Benz', 'Diesel'], 0),
  mc('erfinder', 3, 'Welches Gerät erfand Alexander Graham Bell?', ['Radio', 'Telefon', 'Fernseher', 'Dampfmaschine'], 1),
  tf('erfinder', 1, 'Das Rad wurde vor mehr als 5000 Jahren erfunden.', true),
  tf('erfinder', 2, 'Der Kompass zeigt immer zum geografischen Südpol.', false),
  est('erfinder', 1, 'In welchem Jahr landeten die ersten Menschen auf dem Mond?', 1969, 'Jahr', 1900, 2000),
  order('erfinder', 3, 'Ordne diese Erfindungen nach ihrem Alter, die älteste zuerst.', ['Rad', 'Buchdruck', 'Dampfmaschine', 'Computer']),
  // ---- Serien und Filme
  mc('serien', 1, 'Wie heißt der Raumschiff-Kapitän der ersten Star-Trek-Serie?', ['Kirk', 'Picard', 'Janeway', 'Sisko'], 0),
  mc('serien', 2, 'In welcher Serie leben die Freunde Sheldon, Leonard und Penny?', ['Friends', 'The Big Bang Theory', 'Dallas', 'Lost'], 1),
  mc('serien', 3, 'Auf welchem Wüstenplaneten wächst Luke Skywalker auf?', ['Tatooine', 'Hoth', 'Endor', 'Naboo'], 0),
  mc('serien', 3, 'Welche Farbe hat das Laserschwert von Yoda meistens?', ['Rot', 'Grün', 'Gelb', 'Weiß'], 1),
  tf('serien', 1, 'Darth Vader ist Lukes Vater.', true),
  tf('serien', 2, 'Spock stammt vom Planeten Vulkan.', true),
  est('serien', 1, 'Wie viele Staffeln hat die Serie The Big Bang Theory?', 12, 'Staffeln', 1, 30),
  order('serien', 3, 'Ordne die Star-Wars-Filme der ersten Trilogie nach ihrer Entstehung.', ['Eine neue Hoffnung', 'Das Imperium schlägt zurück', 'Die Rückkehr der Jedi-Ritter', 'Die dunkle Bedrohung']),
];
