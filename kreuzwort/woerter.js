// Kreuzworträtsel – Wörterliste. Zeilenformat: WORT|Hinweis|Stufe (Stufe 1 = leicht, 2 = etwas schwerer; fehlt = 1).
// Zeilen mit # setzen das Thema. Nur A–Z (AE/OE/UE/SS statt Umlaute). Der Hinweis nennt das Wort nie selbst.
const RAW = `
#Tiere
HUND|Bester Freund des Menschen, bellt
KATZE|Haustier, das miaut und schnurrt
MAUS|Kleines Nagetier, mag Käse
PFERD|Reittier mit Hufen und Mähne
KUH|Gibt Milch und macht Muh
SCHAF|Liefert Wolle und sagt Mäh
ZIEGE|Meckert und klettert gern auf Felsen
SCHWEIN|Rosa Hoftier, das gern im Matsch wühlt
HUHN|Legt Eier und gackert
HAHN|Kräht frühmorgens auf dem Hof
ENTE|Schwimmt auf dem Teich und schnattert
GANS|Großer Wasservogel, der zu Martini auf dem Tisch steht|2
ESEL|Grautier mit langen Ohren, sagt I-A
HASE|Langohr, das zu Ostern die Eier bringt
FUCHS|Rotes Raubtier, im Märchen schlau
WOLF|Heult den Mond an und jagt im Rudel
TIGER|Große Raubkatze mit Streifen
ELEFANT|Größtes Landtier mit Rüssel
GIRAFFE|Tier mit dem längsten Hals
ZEBRA|Afrikanisches Wildtier mit schwarzweißen Streifen
AFFE|Klettert und isst gern Bananen
KROKODIL|Reptil mit vielen Zähnen, lauert im Fluss
SCHLANGE|Kriecht ohne Beine und zischt
FROSCH|Grüner Hüpfer, quakt am Teich
MAULWURF|Gräbt Gänge unter der Erde, Fell wie Samt|2
IGEL|Stacheliges Tier, hält Winterschlaf
REH|Scheues Waldtier, Bambi war eins
HIRSCH|Männliches Tier mit Geweih
SPECHT|Vogel, der gegen Baumstämme hämmert
EULE|Nachtvogel, gilt als weise
ADLER|König der Lüfte, großer Greifvogel
STORCH|Bringt der Sage nach die Babys
SCHWAN|Weißer, eleganter Wasservogel
TAUBE|Friedenssymbol mit Flügeln
SPATZ|Kleiner brauner Vogel, frech in der Stadt
AMSEL|Schwarzer Singvogel mit gelbem Schnabel
KUCKUCK|Vogel, der sein Ei in fremde Nester legt
PINGUIN|Schwarzweißer Vogel, der nicht fliegen kann
BIENE|Sammelt Nektar und macht Honig
WESPE|Gelb-schwarzes Insekt, sticht gern
FLIEGE|Summendes Insekt, nervt am Fenster
AMEISE|Fleißiges Insekt im Haufen
SPINNE|Hat acht Beine und webt ein Netz
SCHNECKE|Kriecht langsam, das Haus auf dem Rücken
WURM|Kriecht im Gartenboden, Köder für Angler
FISCH|Schwimmt mit Flossen im Wasser
HAI|Gefürchteter Raubfisch mit Rückenflosse
WAL|Größtes Tier der Meere
DELFIN|Kluger Meeressäuger, springt aus dem Wasser
ROBBE|Meerestier, das gern am Strand liegt
KRABBE|Läuft seitwärts und hat Scheren
HUMMER|Roter Meeresbewohner mit großen Scheren|2
KARPFEN|Fisch, der oft Silvester auf den Tisch kommt|2
FORELLE|Gefleckter Fisch im Bergbach|2
HECHT|Räuberischer Süßwasserfisch|2
LACHS|Rosa Fisch, schwimmt flussaufwärts
KAMEL|Wüstentier mit Höcker
LAMA|Südamerikanisches Tier, das gern spuckt
PANDA|Schwarzweißer Bär, der Bambus frisst
KOALA|Schläft viel und mag Eukalyptus
NASHORN|Graues Tier mit Horn auf der Nase
NILPFERD|Dicker Bewohner afrikanischer Flüsse|2
DACHS|Schwarzweiß gestreifter Waldbewohner, baut einen Bau|2
BIBER|Baut Dämme und nagt Bäume um
OTTER|Schwimmt gern auf dem Rücken und frisst Fische|2
MARDER|Beißt gern Autokabel durch|2
FLEDERMAUS|Fliegt nachts und hängt kopfüber|2
PAPAGEI|Bunter Vogel, der sprechen lernt
HAMSTER|Hat Backentaschen und ein Laufrad
KANINCHEN|Zahmes Langohr im Stall
FASAN|Bunter Hühnervogel mit langem Schwanz|2
ELSTER|Schwarzweißer Vogel, stiehlt angeblich Glänzendes
LIBELLE|Schillerndes Insekt am Teich|2
FALTER|Hat bunte Flügel, war einmal eine Raupe
RAUPE|Wird später zum Schmetterling
GRILLE|Zirpt im Sommergras|2
ELCH|Größter Hirsch Nordeuropas|2
RENTIER|Zieht den Schlitten des Weihnachtsmanns
GEIER|Aasfresser mit kahlem Hals|2
STIER|Männliches Rind, rotes Tuch für ihn
FERKEL|Kleines Schwein
KALB|Junges Rind
LAMM|Junges Schaf
FOHLEN|Junges Pferd
WELPE|Junger Hund
KATER|Männliche Hauskatze
KRAKE|Meerestier mit acht Armen|2
AAL|Schlangenförmiger Fisch|2
#Essen
BROT|Wird beim Bäcker gekauft, aus Mehl und Wasser
SEMMEL|Süddeutsches Wort für Brötchen|2
BUTTER|Gelber Brotaufstrich aus Rahm
EIER|Zu Ostern bunt bemalt
MILCH|Weißes Getränk von der Kuh
JOGHURT|Gesäuerte Milchspeise im Becher
QUARK|Weiße, weiche Frischmilchmasse|2
SAHNE|Wird geschlagen und kommt auf die Torte
HONIG|Süßer Brotaufstrich der Bienen
MARMELADE|Süßer Brotaufstrich aus gekochten Früchten
ZUCKER|Weiße Süße im Kaffee
SALZ|Würzt die Suppe, weiße Körnchen
PFEFFER|Scharfes Gewürz neben dem Salz
ZIMT|Braunes Gewürz für Plätzchen und Milchreis
VANILLE|Gewürz im Pudding und Eis|2
PETERSILIE|Grünes Kraut für die Suppe|2
BASILIKUM|Kraut zu Tomate und Mozzarella|2
KNOBLAUCH|Riecht stark und soll Vampire fernhalten
ZWIEBEL|Beim Schneiden kommen die Tränen
KARTOFFEL|Knolle, aus der Pommes werden
TOMATE|Rote Salatfrucht
GURKE|Grünes Gemüse, auch eingelegt
KAROTTE|Orangefarbenes Wurzelgemüse
KOHL|Rot-, Weiß- oder Wirsing-Gemüse
ERBSE|Grüne Kugel in der Schote
BOHNE|Hülsenfrucht, grün oder weiß
LINSE|Kleine Hülsenfrucht für den Eintopf
SPARGEL|Weißes Frühlingsgemüse in Stangen
PILZ|Wächst im Wald, Pfifferling ist einer
SALAT|Grüne Beilage mit Dressing
APFEL|Rundes Obst vom Baum, rot oder grün
BIRNE|Obst mit Stiel, unten dick
BANANE|Gelbe, krumme Frucht
ORANGE|Saftige, runde Zitrusfrucht, süß
ZITRONE|Gelb und sauer
KIRSCHE|Rote Steinfrucht mit Stiel
PFLAUME|Blaues Steinobst
ERDBEERE|Rote Frucht mit kleinen Kernen außen
HIMBEERE|Rote Beere vom Strauch mit Stacheln|2
TRAUBE|Wächst am Weinstock
MELONE|Große Frucht mit vielen Kernen
ANANAS|Tropische Frucht mit grüner Krone
MANDEL|Süßer Kern, wichtig für Marzipan|2
NUSS|Hartschalige Frucht, Eichhörnchen sammeln sie
ROSINE|Getrocknete Traube
KUCHEN|Süßes Gebäck zum Kaffee
TORTE|Festliches Gebäck mit Sahne
KEKS|Knuspriges Gebäck, Plätzchen
SCHOKOLADE|Braune Süßigkeit aus Kakao
BONBON|Hartes Zuckerstück zum Lutschen
EIS|Kalte Leckerei im Sommer, mit Kugeln
PUDDING|Wackelnder Nachtisch
NUDELN|Italienische Teigware
SPAGHETTI|Lange, dünne italienische Nudeln
PIZZA|Italienischer Teigfladen mit Belag
SUPPE|Wird mit dem Löffel gegessen, heiß
EINTOPF|Gericht aus einem Topf, mit Gemüse
WURST|Wird im Darm gefüllt, grillbar
SCHINKEN|Gepökeltes Fleisch von der Keule
SPECK|Geräucherter Schweinebauch
BRATEN|Gegartes Fleisch am Sonntag
SCHNITZEL|Paniertes Fleischstück, berühmt aus Wien
FRIKADELLE|Gebratenes Hackfleischbällchen|2
REIS|Weiße Körner aus Asien
MEHL|Gemahlenes Getreide zum Backen
HAFER|Getreide für Flocken und Pferde|2
KAFFEE|Heißes, braunes Wachmacher-Getränk
TEE|Heißgetränk aus Blättern, Ostfriesen lieben es
WASSER|Durstlöscher aus dem Hahn
SAFT|Getränk aus gepressten Früchten
LIMONADE|Süßes Sprudelgetränk|2
BIER|Gebraut aus Hopfen und Malz
WEIN|Gekeltert aus Trauben
SEKT|Schäumender Wein zum Anstoßen
ESSIG|Saures Würzmittel aus Wein oder Äpfeln
SENF|Gelbe, scharfe Würze zur Bratwurst
KETCHUP|Rote Soße zu Pommes
SPIEGELEI|Gebratenes Ei mit gelber Mitte
OMELETT|Gebratener Eierfladen|2
HEFE|Lässt den Teig aufgehen|2
TEIG|Rohe Masse vor dem Backen
BREZEL|Salziges Laugengebäck in Knotenform
SALAMI|Italienische Hartwurst|2
GULASCH|Ungarisches Fleischgericht mit Paprika|2
PUTE|Großer Geflügelbraten|2
PAPRIKA|Rotes oder gelbes Gemüse, getrocknet ein Gewürz
SPINAT|Grünes Blattgemüse, stärkt Popeye
SELLERIE|Knolle oder Stangen, passt in die Suppe|2
LAUCH|Stangengemüse, auch Porree genannt|2
RETTICH|Weiße, scharfe Knolle, in Bayern Radi|2
RADIESCHEN|Kleine rote Knolle im Salat, scharf|2
BRATWURST|Grillspezialität aus Nürnberg oder Thüringen
KAKAO|Braunes Pulver für heiße Schokolade
MARZIPAN|Süße Masse aus Mandeln und Zucker|2
FEIGE|Süße Frucht mit vielen Kernchen|2
DATTEL|Süße Frucht der Palme|2
OLIVE|Grün oder schwarz, daraus wird Öl
KUERBIS|Dicke orangefarbene Frucht zu Halloween|2
#Orte
PARIS|Hauptstadt von Frankreich
BERLIN|Hauptstadt von Deutschland
ROM|Hauptstadt von Italien, die Ewige Stadt
WIEN|Hauptstadt von Österreich
BERN|Hauptstadt der Schweiz
MADRID|Hauptstadt von Spanien
LONDON|Hauptstadt von England
LISSABON|Hauptstadt von Portugal|2
ATHEN|Hauptstadt von Griechenland
PRAG|Hauptstadt von Tschechien|2
WARSCHAU|Hauptstadt von Polen|2
BUDAPEST|Hauptstadt von Ungarn|2
OSLO|Hauptstadt von Norwegen
MOSKAU|Hauptstadt von Russland
KAIRO|Hauptstadt von Ägypten
TOKIO|Hauptstadt von Japan
PEKING|Hauptstadt von China
DUBLIN|Hauptstadt von Irland|2
HAMBURG|Hansestadt mit Hafen an der Elbe
DRESDEN|Hauptstadt von Sachsen, Frauenkirche
STUTTGART|Hauptstadt von Baden-Württemberg|2
HANNOVER|Hauptstadt von Niedersachsen|2
ERFURT|Hauptstadt von Thüringen|2
MAINZ|Hauptstadt von Rheinland-Pfalz|2
KIEL|Hauptstadt von Schleswig-Holstein
BREMEN|Stadt der Stadtmusikanten
POTSDAM|Hauptstadt von Brandenburg|2
SCHWERIN|Hauptstadt von Mecklenburg-Vorpommern|2
MAGDEBURG|Hauptstadt von Sachsen-Anhalt|2
WIESBADEN|Hauptstadt von Hessen|2
LEIPZIG|Sächsische Messestadt mit Thomaskirche|2
FRANKFURT|Bankenstadt am Main
RHEIN|Großer Fluss, fließt durch Köln
ELBE|Fluss durch Dresden und Hamburg
DONAU|Fluss durch Wien und Budapest
MAIN|Fluss durch Frankfurt und Würzburg
OSTSEE|Meer bei Kiel und Rostock
NORDSEE|Meer mit Ebbe und Flut an Deutschlands Küste
ALPEN|Höchstes Gebirge Mitteleuropas
HARZ|Mittelgebirge mit dem Brocken|2
ZUGSPITZE|Höchster Berg Deutschlands|2
BODENSEE|See an der Grenze zu Österreich und der Schweiz|2
SYLT|Nordseeinsel, beliebt bei Prominenten|2
ITALIEN|Land in Form eines Stiefels
SPANIEN|Land der Stierkämpfe und der Paella
FRANKREICH|Land des Eiffelturms
ENGLAND|Land mit Big Ben
POLEN|Land von Chopin, Hauptstadt Warschau
SCHWEIZ|Land mit Bergen, Käse und Schokolade
SCHWEDEN|Land von Pippi Langstrumpf
NORWEGEN|Land der Fjorde|2
FINNLAND|Land der tausend Seen|2
JAPAN|Land der aufgehenden Sonne
CHINA|Bevölkerungsreiches Land mit Großer Mauer
INDIEN|Land mit dem Taj Mahal
AFRIKA|Kontinent mit Sahara und Kilimandscharo
ASIEN|Größter Kontinent der Erde
EUROPA|Unser Kontinent
AMERIKA|Kontinent jenseits des Atlantiks
AUSTRALIEN|Kontinent mit Kängurus
KANADA|Land mit dem Ahornblatt auf der Flagge
BRASILIEN|Land des Karnevals in Rio
MEXIKO|Land der Tacos und Mariachi|2
PYRAMIDE|Riesiges Grabmal der Pharaonen
VENEDIG|Stadt mit Kanälen und Gondeln
NEAPEL|Italienische Stadt am Vesuv|2
FLORENZ|Stadt der Renaissance in der Toskana|2
STRAND|Sand am Meer
INSEL|Land mitten im Wasser
MALLORCA|Beliebte Urlaubsinsel der Deutschen
KRETA|Größte griechische Insel|2
ISLAND|Insel aus Feuer und Eis|2
TIROL|Österreichisches Bergland|2
DORF|Kleine Ortschaft auf dem Land
STADT|Große Ortschaft mit vielen Häusern
HAFEN|Hier legen die Schiffe an
TURM|Hohes, schmales Bauwerk
SCHLOSS|Königliche Wohnung mit Park
BURG|Mittelalterliche Festung auf dem Berg
DOM|Große Kirche, in Köln berühmt
KIRCHE|Haus mit Glockenturm
MUSEUM|Hier sieht man Kunst und Altertümer
BAHNHOF|Hier fahren die Züge ab
FLUGHAFEN|Hier starten und landen Flugzeuge
MARKT|Hier verkaufen Händler Obst und Gemüse
PARK|Grünanlage in der Stadt
ZOO|Hier leben Tiere in Gehegen
KINO|Hier sieht man Filme auf großer Leinwand
THEATER|Hier spielen Schauspieler auf der Bühne
SCHULE|Hier lernen die Kinder
BAHAMAS|Inselgruppe in der Karibik|2
ROSTOCK|Hafenstadt an der Ostsee|2
ESSEN|Ruhrgebietsstadt mit Zeche Zollverein|2
BONN|Frühere Hauptstadt am Rhein|2
ATLANTIK|Ozean zwischen Europa und Amerika|2
#Natur
BAUM|Hat Stamm, Äste und Blätter
EICHE|Mächtiger Laubbaum, seine Früchte mögen Wildschweine
BUCHE|Laubbaum mit glatter grauer Rinde|2
TANNE|Nadelbaum zu Weihnachten
FICHTE|Häufigster Nadelbaum im Wald|2
BIRKE|Baum mit weißer Rinde|2
LINDE|Baum mit duftenden Blüten, daraus Tee|2
ROSE|Blume mit Dornen
TULPE|Frühlingsblume aus Holland
NELKE|Blume, auch ein Gewürz|2
LILIE|Weiße Blume, Zeichen der Reinheit|2
VEILCHEN|Kleine violette Frühlingsblume, duftet|2
MARGERITE|Weiße Wiesenblume mit gelber Mitte|2
KLEE|Mit vier Blättern bringt er Glück
GRAS|Wächst auf der Wiese
MOOS|Weiche grüne Decke im Wald
FARN|Waldpflanze mit gefiederten Wedeln|2
BLATT|Hängt am Ast und wird im Herbst bunt
BLUME|Duftet und blüht auf der Wiese
WALD|Viele Bäume zusammen
WIESE|Grünes Land voller Gras und Blumen
FELD|Hier baut der Bauer Getreide an
BERG|Hoch, mit Gipfel
TAL|Liegt zwischen zwei Bergen
SEE|Stilles Gewässer mit Ufer ringsum
FLUSS|Fließendes Gewässer, mündet ins Meer
BACH|Kleines Gewässer, plätschert
MEER|Salziges Wasser mit Ebbe und Flut
WELLE|Wasserberg auf dem Meer
STURM|Sehr starker Wind
WIND|Bewegte Luft, weht
REGEN|Fällt aus Wolken, macht nass
SCHNEE|Weiße Flocken im Winter
HAGEL|Eiskörner vom Himmel|2
NEBEL|Dicke Suppe in der Luft, schlechte Sicht
BLITZ|Heller Strahl am Himmel
DONNER|Grollt nach dem Blitz
GEWITTER|Blitz, Donner und Regen zusammen
WOLKE|Schwebt weiß oder grau am Himmel
SONNE|Strahlender Stern am Tag
MOND|Leuchtet nachts, nimmt zu und ab
STERN|Funkelt nachts am Himmel
HIMMEL|Blau über uns
ERDE|Unser Planet
MARS|Roter Planet|2
VENUS|Abendstern, Planet|2
JUPITER|Größter Planet unseres Sonnensystems|2
SATURN|Planet mit Ringen|2
REGENBOGEN|Bunter Bogen nach Sonne und Regen
SOMMER|Heißeste Jahreszeit
HERBST|Jahreszeit der bunten Blätter und Pilze
WINTER|Kälteste Jahreszeit mit Schnee
FEUER|Heiß und hell, brennt
STEIN|Hartes Stück Fels
FELS|Großer Gesteinsblock
SAND|Körnchen am Strand
LEHM|Gelbbrauner Boden, daraus formt man Ziegel|2
VULKAN|Spuckt Feuer und Asche
LAVA|Glühende Gesteinsschmelze
QUELLE|Hier entspringt ein Fluss|2
TEICH|Kleines stehendes Gewässer mit Fröschen
DSCHUNGEL|Tropischer Urwald|2
SAHARA|Größte Wüste Afrikas|2
EBBE|Das Wasser zieht sich zurück|2
FLUT|Das Wasser kommt zurück ans Land|2
ZWEIG|Dünner Ast
AST|Wächst vom Stamm ab
WURZEL|Hält den Baum in der Erde
RINDE|Äußere Haut des Baumes|2
SAMEN|Daraus wächst eine neue Pflanze
KNOSPE|Noch geschlossene Blüte|2
BACHE|Wildschwein-Weibchen im Wald|2
OZEAN|Riesiges Weltmeer|2
GLETSCHER|Langsam fließender Eisstrom im Gebirge|2
GIPFEL|Höchster Punkt eines Berges
HOEHLE|Dunkler Hohlraum im Fels|2
INSEKT|Hat sechs Beine, z. B. Käfer oder Biene|2
#Haushalt
TISCH|Hier essen wir, mit vier Beinen
STUHL|Zum Sitzen, mit Lehne
SESSEL|Gepolsterter Sitz für gemütliche Stunden
SOFA|Bequeme Sitzgelegenheit im Wohnzimmer für mehrere
BETT|Hier schläft man
KISSEN|Liegt unter dem Kopf im Bett
DECKE|Wärmt dich nachts im Bett
LAMPE|Macht Licht
SCHRANK|Möbel für Kleidung oder Geschirr
REGAL|Offene Bretter für Bücher
SPIEGEL|Zeigt dein Bild
TEPPICH|Weicher Bodenbelag
VORHANG|Hängt am Fenster
FENSTER|Glasscheibe in der Wand zum Hinausschauen
KLINGEL|Läutet an der Haustür|2
HERD|Hier kocht man, mit Platten
OFEN|Hier backt man Kuchen und Brot
TOPF|Darin kocht die Suppe
PFANNE|Zum Braten, mit langem Stiel
GABEL|Hat Zinken, zum Essen
MESSER|Schneidet, liegt neben dem Teller
TELLER|Flach, daraus isst man
TASSE|Henkelgefäß für Kaffee
BECHER|Trinkgefäß ohne Henkel
GLAS|Durchsichtiges Trinkgefäß
KANNE|Zum Gießen oder für Kaffee
EIMER|Behälter mit Henkel für Wasser
BESEN|Kehrt den Boden
SEIFE|Wäscht die Hände
HANDTUCH|Trocknet nach dem Waschen
SCHWAMM|Saugt Wasser auf, zum Abwaschen
DUSCHE|Hier regnet es im Bad
BADEWANNE|Hier badet man
NADEL|Spitz, mit Öhr für den Faden
FADEN|Wird durch die Nadel gefädelt
KNOPF|Hält die Jacke zu
WOLLE|Daraus strickt man Socken
SCHERE|Schneidet Papier
HAMMER|Schlägt Nägel ein
NAGEL|Wird mit dem Hammer eingeschlagen
ZANGE|Werkzeug zum Zwicken und Ziehen
SCHRAUBE|Gewindestift, wird mit dem Dreher hineingedreht
LEITER|Zum Hinaufsteigen, mit Sprossen
UHR|Zeigt die Zeit
WECKER|Klingelt morgens
KALENDER|Zeigt Tage und Monate
BUCH|Hat Seiten und Geschichten
ZEITUNG|Wird täglich gedruckt, mit Nachrichten
BRIEF|Kommt mit der Post, im Umschlag
MARKE|Klebt oben rechts auf dem Brief
KERZE|Brennt mit Wachs und Docht
SCHIRM|Schützt vor Nässe von oben, wird aufgespannt
TASCHE|Zum Tragen von Einkäufen, mit Henkel
KOFFER|Wird auf Reisen gepackt
SCHUH|Trägt man am Fuß
SOCKE|Wärmt den Fuß im Schuh
HOSE|Hat zwei Beine
JACKE|Warmes Kleidungsstück für draußen
MANTEL|Langes Kleidungsstück für den Winter
HUT|Kopfbedeckung mit Krempe
SCHAL|Wärmt den Hals im Winter
HANDSCHUH|Wärmt die Finger
KLEID|Trägt die Dame zum Ball, aus einem Stück Stoff
HEMD|Oberteil mit Kragen und Knöpfen
BRILLE|Hilft den Augen beim Lesen
RING|Schmuck am Finger
KETTE|Schmuck um den Hals
KAMM|Ordnet die Haare
TELEFON|Damit ruft man jemanden an
RADIO|Spielt Musik und Nachrichten, ohne Bild
FERNSEHER|Zeigt bewegte Bilder im Wohnzimmer
COMPUTER|Rechner mit Tastatur und Bildschirm
BESTECK|Messer, Gabel und Löffel zusammen
SCHUESSEL|Rundes Gefäß für Salat oder Suppe|2
KISTE|Kasten aus Holz zum Aufbewahren
FLASCHE|Behälter für Getränke mit engem Hals
DOSE|Verschlossener Behälter für Konserven
SPARDOSE|Hier kommen die Münzen durch den Schlitz hinein|2
BUERSTE|Hat Borsten, zum Schrubben|2
#Beruf
KOCH|Bereitet in der Küche Speisen zu
ARZT|Behandelt Kranke
LEHRER|Unterrichtet in der Schule
PILOT|Steuert ein Flugzeug
POLIZIST|Sorgt für Recht und Ordnung, trägt Uniform
MALER|Streicht Wände an
TISCHLER|Baut Möbel aus Holz
BAUER|Bewirtschaftet Felder und Ställe
FISCHER|Fängt Fische
FRISEUR|Schneidet Haare
MAURER|Baut Mauern aus Ziegeln
DACHDECKER|Arbeitet hoch oben auf den Ziegeln|2
MECHANIKER|Repariert Motoren|2
PFARRER|Hält die Predigt in der Kirche
RICHTER|Spricht im Gericht das Urteil
ANWALT|Vertritt Mandanten vor Gericht|2
MUSIKER|Spielt ein Instrument
DIRIGENT|Leitet das Orchester mit dem Taktstock|2
SOLDAT|Trägt Uniform bei der Armee
MATROSE|Arbeitet auf einem Schiff|2
BERGMANN|Arbeitet unter Tage in der Grube|2
KASSIERER|Sitzt an der Supermarktkasse|2
POSTBOTE|Bringt die Briefe ins Haus
TAXIFAHRER|Fährt Fahrgäste gegen Bezahlung|2
ZAHNARZT|Bohrt an den Zähnen
APOTHEKER|Verkauft Medikamente
PFLEGER|Hilft kranken oder alten Menschen|2
HEBAMME|Hilft Babys auf die Welt|2
FOTOGRAF|Macht Bilder mit der Kamera
AUTOR|Schreibt Bücher
DICHTER|Verfasst Gedichte|2
BILDHAUER|Meißelt Figuren aus Stein|2
ARCHITEKT|Plant Häuser
INGENIEUR|Entwirft Maschinen und Brücken|2
FORSCHER|Sucht nach neuen Erkenntnissen|2
STUDENT|Lernt an der Universität
CHEF|Der Vorgesetzte im Büro
KELLNER|Bringt im Restaurant das Essen
METZGER|Schneidet Fleisch und Wurst
SCHNEIDER|Näht Anzüge nach Maß|2
TRAINER|Betreut eine Mannschaft|2
CLOWN|Macht im Zirkus Späße
ZAUBERER|Holt Kaninchen aus dem Hut
ELEKTRIKER|Verlegt Kabel und repariert Strom|2
SCHAFFNER|Kontrolliert die Fahrkarten im Zug|2
SCHREINER|Fertigt Fenster und Schränke aus Holz|2
LANDWIRT|Betreibt einen Bauernhof|2
GAERTNER|Pflegt Beete und Blumen|2
JAEGER|Geht mit dem Gewehr in den Wald|2
#Musik
GITARRE|Zupfinstrument mit sechs Saiten
KLAVIER|Instrument mit schwarzen und weißen Tasten
GEIGE|Streichinstrument, wird unters Kinn geklemmt
TROMMEL|Wird mit Schlägeln geschlagen
HARFE|Zupfinstrument der Engel
TROMPETE|Blechblasinstrument mit drei Ventilen
POSAUNE|Blasinstrument mit Zug|2
TUBA|Größtes Blechblasinstrument|2
ORGEL|Instrument mit Pfeifen in der Kirche
AKKORDEON|Instrument mit Balg, auch Quetschkommode
CELLO|Großes Streichinstrument, zwischen den Knien|2
BASS|Tiefe Männerstimme|2
TENOR|Hohe Männerstimme|2
ALT|Tiefe Frauenstimme im Chor|2
SOPRAN|Höchste Frauenstimme|2
CHOR|Gruppe von Sängern
ORCHESTER|Viele Musiker unter einem Dirigenten
BAND|Gruppe von Musikern mit Schlagzeug und Gitarre
OPER|Theaterstück, das gesungen wird
LIED|Wird gesungen
MELODIE|Folge von Tönen zum Mitsummen
NOTE|Zeichen im Liniensystem für einen Ton
TAKT|Gleichmäßiger Schlag in der Musik
RHYTHMUS|Gleichmäßiges Muster aus Betonungen, zum Mitklatschen|2
WALZER|Tanz im Dreivierteltakt
TANGO|Leidenschaftlicher Tanz aus Argentinien
POLKA|Böhmischer Tanz|2
SAMBA|Brasilianischer Tanz|2
JAZZ|Musik mit viel Improvisation, aus New Orleans
SCHLAGER|Eingängiges deutsches Lied, oft über die Liebe
KONZERT|Hier spielt ein Orchester vor Publikum
MOZART|Komponist aus Salzburg, schrieb die Zauberflöte
BEETHOVEN|Komponist der Neunten, wurde taub
WAGNER|Komponist vom Ring des Nibelungen|2
BRAHMS|Komponist des berühmten Wiegenlieds|2
SCHUBERT|Komponist von Forellenquintett und Winterreise|2
VIVALDI|Komponist der Vier Jahreszeiten|2
SAITE|Sie wird gezupft oder gestrichen
BOGEN|Damit streicht man über die Saiten der Geige|2
TASTE|Hier drückst du beim Klavier
SCHLAGZEUG|Trommeln und Becken zusammen
ZITHER|Saiteninstrument, liegt flach auf dem Tisch|2
DUDELSACK|Schottisches Blasinstrument mit Luftsack|2
HORN|Gebogenes Blechblasinstrument|2
KLARINETTE|Holzblasinstrument mit Mundstück|2
OBOE|Holzblasinstrument mit Doppelrohrblatt|2
TRIANGEL|Metalldreieck, klingt hell|2
SERENADE|Abendmusik als Ständchen|2
ARIE|Gesangsstück in der Oper|2
HYMNE|Feierliches Lied, zum Beispiel einer Nation|2
REFRAIN|Wiederkehrender Teil im Lied|2
STROPHE|Abschnitt eines Liedtextes|2
MARSCH|Musik zum Gehen im Gleichschritt|2
WIEGENLIED|Beruhigendes Lied für Babys
KARAOKE|Mitsingen mit Textanzeige|2
MIKROFON|Wird beim Singen gehalten
TON|Klang, aus dem Musik besteht
OHRWURM|Melodie, die man nicht mehr loswird|2
#Sprichwörter
PREIS|Ohne Fleiß kein ...
DREI|Aller guten Dinge sind ...
HINEIN|Wer andern eine Grube gräbt, fällt selbst ...|2
NICHT|Hunde, die bellen, beißen ...
STAMM|Der Apfel fällt nicht weit vom ...|2
MEISTER|Übung macht den ...
WEILE|Eile mit ...|2
ROSTET|Wer rastet, der ...|2
SCHWER|Aller Anfang ist ...
GOLD|Reden ist Silber, Schweigen ist ...
MIST|Kleinvieh macht auch ...
STUDIEREN|Probieren geht über ...|2
KORN|Ein blindes Huhn findet auch mal ein ...|2
BREI|Viele Köche verderben den ...
BEINE|Lügen haben kurze ...
LOS|Ohne Moos nichts ...|2
BESTEN|Wer zuletzt lacht, lacht am ...
DIEBE|Gelegenheit macht ...
SCHMIED|Jeder ist seines Glückes ...
GELD|Zeit ist ...
HEISS|Was ich nicht weiß, macht mich nicht ...|2
MAUL|Einem geschenkten Gaul schaut man nicht ins ...
WERT|Wer den Pfennig nicht ehrt, ist des Talers nicht ...|2
ABEND|Man soll den Tag nicht vor dem ... loben
NACH|Der Klügere gibt ...
MIT|Das Auge isst ...
FINDET|Wer sucht, der ...|2
TIEF|Stille Wasser sind ...
ALLEIN|Ein Unglück kommt selten ...|2
FALL|Hochmut kommt vor dem ...
LENKT|Der Mensch denkt, Gott ...|2
HERAUS|Wie man in den Wald hineinruft, so schallt es ...|2
#Allgemeinwissen
PAPST|Oberhaupt der katholischen Kirche
KAISER|Herrscher, höher als ein König|2
PRINZ|Sohn des Königs
KOENIG|Herrscher über ein Reich, trägt Krone|2
JAHR|Hat zwölf Monate
MONAT|Der Januar ist einer
WOCHE|Hat sieben Tage
TAG|Vierundzwanzig Stunden
STUNDE|Sechzig Minuten
MINUTE|Sechzig Sekunden
SEKUNDE|Kürzeste gängige Zeiteinheit
MONTAG|Erster Wochentag
DIENSTAG|Zweiter Wochentag
MITTWOCH|Mitte der Woche
DONNERSTAG|Vierter Wochentag
FREITAG|Letzter Arbeitstag der Woche
SAMSTAG|Wochentag vor dem Sonntag
SONNTAG|Ruhetag der Woche
JANUAR|Erster Monat
FEBRUAR|Kürzester Monat
APRIL|Macht, was er will
JUNI|Monat nach dem Mai
JULI|Siebter Monat
AUGUST|Achter Monat, Ferienzeit
OKTOBER|Zehnter Monat
NOVEMBER|Elfter Monat
DEZEMBER|Zwölfter Monat, Weihnachtszeit
OSTERN|Fest mit Hase und Eiern
ADVENT|Zeit vor Weihnachten mit Kerzen
NIKOLAUS|Kommt am 6. Dezember mit dem Sack
SILVESTER|Letzter Tag des Jahres
KARNEVAL|Närrische Zeit mit Verkleidung
GEBURTSTAG|Jährlicher Ehrentag mit Kuchen
HOCHZEIT|Fest, bei dem man Ja sagt
EURO|Gemeinsames Geld vieler Länder, hat 100 Cent
FARBE|Rot, Blau und Gelb sind welche
ROT|Farbe der Liebe und des Stoppsignals
BLAU|Farbe des Himmels
GELB|Farbe der Zitrone
SCHWARZ|Farbe der Nacht
BRAUN|Farbe von Schokolade
LILA|Farbe zwischen Blau und Rot, wie Veilchen|2
ZAHL|Wird gezählt
NULL|Keine Menge, steht vor der Eins
EINS|Erste Zahl
ZWEI|Doppelt so viel wie eins
VIER|Zahl der Jahreszeiten
SECHS|Höchste Zahl auf dem Würfel
SIEBEN|Zahl der Wochentage
ACHT|Zahl der Beine einer Spinne
NEUN|Quadrat von drei
ZEHN|Zahl der Finger beider Hände
HUNDERT|Zehnmal zehn
TAUSEND|Zehnmal hundert
MILLION|Tausendmal tausend
SPIEL|Würfel, Karten und Bretter gehören dazu
SCHACH|Brettspiel mit König und Dame
SKAT|Deutsches Kartenspiel zu dritt
FUSSBALL|Sport mit zwei Toren und elf Spielern je Mannschaft
TENNIS|Sport mit Netz und Filzball
GOLF|Sport, bei dem man einen Ball ins Loch schlägt
SCHWIMMEN|Fortbewegung im Wasser
SKI|Gleitet über den Schnee
RAD|Rundes Teil, das sich dreht, vier davon unter dem Auto
AUTO|Fährt mit Motor auf vier Rädern
ZUG|Fährt auf Schienen
BUS|Öffentliches Verkehrsmittel auf der Straße
SCHIFF|Schwimmt auf dem Meer
BOOT|Kleines Wasserfahrzeug
FLUGZEUG|Fliegt mit Tragflächen
BALLON|Fliegt mit Heißluft oder Gas|2
MOTOR|Treibt das Auto an
BENZIN|Treibstoff von der Tankstelle
STRASSE|Fahrbahn für Autos
AMPEL|Rot, Gelb, Grün an der Kreuzung
SCHILD|Verkehrszeichen am Pfosten|2
KOMPASS|Zeigt immer nach Norden
GLOBUS|Kugel mit Weltkarte
ATLAS|Buch voller Landkarten
LUPE|Vergrößert kleine Dinge|2
KARTE|Plan zum Orientieren auf Reisen
GOLDFISCH|Orangefarbener Fisch im Glas|2
MARATHON|Lauf über gut 42 Kilometer|2
OLYMPIA|Austragungsort der ersten Spiele, auch Sportfest alle vier Jahre|2
#Körper
KOPF|Sitzt auf dem Hals, darin steckt das Gehirn
ARM|Verbindet Schulter und Hand
BEIN|Damit läuft man
HAND|Hat fünf Finger
FUSS|Steckt im Schuh
NASE|Damit riecht man
OHR|Damit hört man
AUGE|Damit sieht man
MUND|Hat Lippen und Zähne
ZAHN|Beißt zu, wird mit der Bürste geputzt
HERZ|Pumpt das Blut durch den Körper
BAUCH|Vorne in der Mitte des Körpers
HALS|Verbindet Kopf und Rumpf
HAAR|Wächst auf dem Kopf
KNIE|Gelenk in der Mitte des Beins
DAUMEN|Dickster Finger
FINGER|Fünf davon hat eine Hand
ZUNGE|Hilft beim Schmecken und Sprechen
LIPPE|Rand des Mundes
STIRN|Teil des Gesichts über den Augen
WANGE|Backe im Gesicht|2
KINN|Unterer Teil des Gesichts
BART|Wächst Männern im Gesicht
HAUT|Äußere Hülle des Körpers
BLUT|Roter Saft in den Adern
KNOCHEN|Hartes Teil des Skeletts
MAGEN|Hier landet das Essen zuerst|2
LUNGE|Damit atmet man
RIPPE|Knochen im Brustkorb|2
SCHULTER|Gelenk zwischen Arm und Rumpf
ELLBOGEN|Gelenk in der Mitte des Arms|2
GESICHT|Hier sitzen Augen, Nase und Mund
ZEHE|Kleiner Teil des Fußes
GEHIRN|Hier wird gedacht|2
#Familie
MUTTER|Weibliches Elternteil, Mama
VATER|Männliches Elternteil, Papa
OMA|Mutter der Mutter oder des Vaters
OPA|Vater der Mutter oder des Vaters
TANTE|Schwester von Mutter oder Vater
ONKEL|Bruder von Mutter oder Vater
BRUDER|Männliches Geschwisterkind
SCHWESTER|Weibliches Geschwisterkind
KIND|Noch nicht erwachsen
BABY|Ganz kleiner Mensch in Windeln
FREUND|Jemand, den man gut leiden kann
NACHBAR|Wohnt neben dir
SOHN|Männliches Kind der Eltern
TOCHTER|Weibliches Kind der Eltern
ENKEL|Kind deines Kindes
COUSIN|Kind von Tante oder Onkel
EHEMANN|Gatte, verheirateter Partner|2
FAMILIE|Eltern und Kinder zusammen
GAST|Wird zum Essen eingeladen
PATE|Begleitet ein Kind bei der Taufe|2
#Allerlei
BAD|Hier wäscht man sich oder schwimmt
BAR|Lokal mit Theke und Cocktails|2
DACH|Schützt das Haus von oben
DORN|Spitzer Stachel an der Rose|2
ENGEL|Himmlisches Wesen mit Flügeln
ERBE|Das, was man nach dem Tod weitergibt|2
FAHNE|Hängt am Mast, trägt Farben
LAND|Gegenteil von Meer oder Stadt
LUFT|Wir atmen sie
MANN|Erwachsener männlicher Mensch
SEIL|Dickes Tau zum Klettern
TOR|Hier will der Fußballer hinein
WEG|Pfad zum Gehen
ZOLL|Abgabe an der Grenze|2
KRONE|Schmuck auf dem Kopf des Königs
SCHATZ|Vergrabene Kostbarkeit auf der Karte
PIRAT|Segelt mit Totenkopfflagge
RITTER|Trägt Rüstung und reitet aufs Schloss
DRACHE|Speit Feuer im Märchen, oder fliegt im Herbst am Faden
MAERCHEN|Hat oft eine Hexe, einen Prinzen und ein Happy End|2
HEXE|Reitet im Märchen auf dem Besen
ZWERG|Klein und fleißig, Schneewittchen kennt sieben|2
RIESE|Sehr groß, im Märchen oft böse
GEIST|Unsichtbares Wesen, spukt im Schloss|2
TRAUM|Bilder im Schlaf
SCHLAF|Nächtliche Ruhe
LACHEN|Zeigt, dass man fröhlich ist
WITZ|Wird erzählt, damit man lacht
FREUDE|Fröhliches Gefühl
GLUECK|Vierblättriges Kleeblatt bringt es|2
LIEBE|Starkes Gefühl für einen Menschen
FRIEDEN|Gegenteil von Krieg
SCHULD|Wer etwas falsch gemacht hat, hat sie|2
GEDULD|Warten können, ohne zu murren
MUT|Keine Angst zeigen
FLEISS|Eifrige Arbeit
GEHEIMNIS|Das erzählt man niemandem|2
`;

export const WOERTER = [];
{
  let k = 'Allgemeinwissen';
  for (const line of RAW.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    if (s[0] === '#') { k = s.slice(1); continue; }
    const [w, h, d] = s.split('|');
    WOERTER.push({ w, h, k, d: Number(d) === 2 ? 2 : 1 });
  }
}
