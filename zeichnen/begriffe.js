// Zeichenraten – Begriffe zum Zeichnen und Raten.
// Jeder Eintrag: { w: 'Fahrrad', alt: ['Rad', 'Velo'], k: 'Fahrzeuge' }  (alt = weitere gültige Wörter, k = Kategorie).
// Kurzschreibweise unten: "Hauptwort=Synonym=Synonym", getrennt durch Komma. Keine Marken, keine Personen, nichts Heikles.

export const KATEGORIEN = ['Tiere', 'Essen', 'Haushalt', 'Natur', 'Fahrzeuge', 'Berufe', 'Kleidung', 'Freizeit'];

const ROH = {
  Tiere: 'Hund,Katze,Maus,Pferd,Kuh,Schwein,Schaf,Ziege,Huhn=Henne=Hahn,Ente,Gans,Esel,Hase=Kaninchen,Igel,Fuchs,Wolf,Bär,Elefant,Giraffe,Löwe,Tiger,Affe,Zebra,Nilpferd=Flusspferd,Krokodil,Schlange,Frosch,Fisch,Hai,Delfin,Pinguin,Eule,Adler,Storch,Schmetterling,Biene,Ameise,Spinne,Marienkäfer,Schnecke,Schildkröte,Känguru,Eichhörnchen,Papagei,Krebs=Krabbe,Seepferdchen,Qualle,Reh,Maulwurf,Fledermaus,Kamel,Tintenfisch=Krake,Hirsch,Wal,Pfau,Hummel,Libelle,Gorilla,Eisbär,Dachs',
  Essen: 'Apfel,Banane,Birne,Kirsche,Erdbeere,Traube=Weintraube,Zitrone,Orange=Apfelsine,Ananas,Wassermelone,Tomate,Gurke,Karotte=Möhre=Mohrrübe,Kartoffel,Zwiebel,Paprika,Mais,Brot,Brötchen=Semmel=Schrippe,Brezel,Kuchen,Torte,Keks=Plätzchen,Eis=Eiscreme,Schokolade,Pizza,Spaghetti=Nudeln,Suppe,Wurst=Bratwurst,Käse,Spiegelei,Butter,Milch,Honig,Pommes,Salat,Pfannkuchen,Popcorn,Lebkuchen,Erdnuss,Brokkoli,Kürbis,Knoblauch,Hamburger,Sandwich,Kaffee,Bonbon,Lutscher,Zuckerwatte,Champignon,Kiwi,Pfirsich,Pflaume,Himbeere,Blumenkohl,Radieschen,Müsli,Marmelade',
  Haushalt: 'Stuhl,Tisch,Bett,Sofa=Couch,Schrank,Lampe,Spiegel,Wecker,Telefon,Fernseher,Radio,Computer,Besen,Eimer,Schere,Messer,Gabel,Löffel,Teller,Tasse,Glas,Flasche,Topf,Pfanne,Herd,Kühlschrank,Waschmaschine,Toaster,Staubsauger,Bügeleisen,Zahnbürste,Seife,Handtuch,Kissen,Decke,Teppich,Vorhang,Fenster,Tür,Schlüssel,Kerze,Regenschirm=Schirm,Brille,Kamm,Dusche,Badewanne,Hammer,Säge,Zange,Leiter,Waage,Gießkanne,Kaffeemaschine,Mülleimer=Abfalleimer,Schaukelstuhl,Bücherregal,Kleiderbügel,Wäscheklammer,Nähnadel,Taschenlampe,Steckdose,Glühbirne',
  Natur: 'Baum,Blume,Rose,Sonnenblume,Gras,Blatt,Wald,Berg,Vulkan,Fluss=Bach,See,Meer=Ozean,Strand,Insel,Wolke,Regen,Regenbogen,Blitz,Schnee,Schneemann,Sonne,Mond,Stern,Komet,Erde,Feuer,Eiszapfen,Wasserfall,Höhle,Wüste,Kaktus,Palme,Tannenzapfen,Pilz,Stein,Muschel,Welle,Nebel,Tannenbaum=Tanne,Eiche,Gänseblümchen,Tulpe,Kleeblatt=Klee,Feder,Nest,Wiese,Hügel,Düne,Gewitter,Pusteblume=Löwenzahn,Sternschnuppe,Brücke,Eisberg,Tropfen=Wassertropfen,Schneeflocke',
  Fahrzeuge: 'Auto=Wagen=PKW,Fahrrad=Rad=Velo,Motorrad,Bus,Zug=Eisenbahn,Straßenbahn,Flugzeug,Hubschrauber=Helikopter,Schiff,Segelboot,Ruderboot,Tretboot,Rakete,Traktor=Trecker,Lastwagen=LKW=Laster,Krankenwagen,Feuerwehrauto=Feuerwehr,Polizeiauto,Taxi,Roller,Schlitten,Kutsche,Heißluftballon=Ballon,Fähre,Bagger,Müllauto=Müllwagen,Wohnwagen,Kinderwagen,Dreirad,Seilbahn,Zeppelin,Dampflok=Lokomotive,Lieferwagen,Raumschiff,Motorboot,Kanu,Floß,Gabelstapler,Schubkarre,Kran,Wohnmobil,Fallschirm',
  Berufe: 'Arzt=Ärztin=Doktor,Zahnarzt,Lehrer=Lehrerin,Bäcker,Metzger=Fleischer,Koch=Köchin,Kellner,Friseur=Friseurin,Maler,Maurer,Tischler=Schreiner,Gärtner,Bauer=Landwirt,Fischer,Pilot,Polizist=Polizistin,Feuerwehrmann=Feuerwehrfrau,Briefträger=Postbote,Busfahrer,Schornsteinfeger,Zauberer,Clown,Musiker,Sänger=Sängerin,Tänzer,Fotograf,Schäfer,Förster,Lokführer,Astronaut,Detektiv,Schneider,Schuster,Dachdecker,Mechaniker=Automechaniker,Elektriker,Klempner=Installateur,Apotheker,Krankenschwester=Krankenpfleger,Tierarzt,Bibliothekar,Imker,Müllmann,Kapitän,Bademeister,Zirkusartist=Artist,Hausmeister',
  Kleidung: 'Hose,Jeans,Rock,Kleid,Hemd,Bluse,Pullover,Jacke,Mantel,Mütze,Hut,Schal,Handschuh,Socke=Strumpf,Schuh,Stiefel,Sandale,Pantoffel=Hausschuh,Turnschuh=Sportschuh,Krawatte,Schleife=Fliege,Gürtel,Hosenträger,Badeanzug,Badehose,Schürze,Overall,Anzug,Weste,Trikot,Schlafanzug=Pyjama,Nachthemd,Regenmantel,Gummistiefel,Ohrring,Ring,Halskette=Kette,Armband,Armbanduhr,Handtasche=Tasche,Rucksack,Geldbeutel=Portemonnaie,Kopftuch,Taschentuch,Sonnenbrille,Kapuze,Strumpfhose,Latzhose,Krone',
  Freizeit: 'Fußball,Ball,Tennisschläger,Tischtennis,Basketball,Schwimmbad,Angel=Angelrute,Zelt,Lagerfeuer,Gitarre,Klavier=Piano,Geige=Violine,Schlagzeug=Trommel,Trompete,Flöte,Buch,Zeitung,Puzzle,Schach,Würfel,Spielkarten=Karten,Drachen,Luftballon,Schaukel,Rutsche,Sandburg,Rollschuhe,Schlittschuhe,Ski,Fotoapparat=Kamera,Fernglas,Kompass,Schatzkarte,Karussell,Riesenrad,Staffelei,Wollknäuel,Dartscheibe,Schatztruhe,Seifenblasen,Hängematte,Grill,Skateboard,Trampolin,Wanderstock,Federball,Kegelbahn,Mikrofon,Geschenk',
};

export const BEGRIFFE = [];
for (const k of KATEGORIEN) {
  for (const eintrag of ROH[k].split(',')) {
    const [w, ...alt] = eintrag.split('=');
    BEGRIFFE.push({ w, alt, k });
  }
}
