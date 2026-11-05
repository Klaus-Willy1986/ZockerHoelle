# Zocker-Hölle – Würfelspiele online

Würfel- und Brettspiele für 2–5 Personen, direkt im Browser. Kein Konto, keine Installation, reine statische Dateien (kein Build).

- **Kreuz & Quer** (`kreuzquer/`): Würfeln und in vier Farbreihen Zahlen ankreuzen.
- **Phasenwürfeln** (`phasen/`): Zehn Phasen mit Würfelkombinationen schaffen.
- **Pasch & Straße** (`pasch/`): Fünf Würfel, 13 Felder auf dem Zettel füllen (auch allein).
- **Farbenwürfeln** (`farben/`): Farb- und Zahlenwürfel kombinieren, Kästchen auf dem Blatt ankreuzen (1–6 Personen, auch allein).
- **Ludo** (`ludo/`): Würfeln, ziehen, Figuren rauswerfen (2–4 Personen).
- **Barrikade** (`barrikade/`): Wettlauf zum Ziel mit Sperren (2–4 Personen).
- **Stapelrennen** (`stapelrennen/`): Zahlenkarten-Stapelspiel (2–6 Personen).
- **Mau-Mau** (`maumau/`): Kartenspiel mit Sonderkarten (Ass als Option).
- **Farbcode knacken** (`farbcode/`): Code-Rate-Spiel (allein, gegen den Computer oder zu zweit).
- **Sudoku** (`sudoku/`): Zahlenrätsel mit drei Stufen, zum Alleinspielen.
- **Springspiel** (`springspiel/`): Solitär mit Steckern, zum Alleinspielen.
- **Mühle** (`muehle/`) und **Dame** (`dame/`): Brettspiele für zwei.

**Spielen:** Startseite öffnen → Spiel wählen → Vornamen eingeben → „Neues Spiel eröffnen“ → Einladungs-Link per WhatsApp schicken → Mitspielerin tippt auf den Link → „Spiel starten“.

**Veröffentlichen:** Ordner auf GitHub Pages (Settings → Pages → Branch `main`, `/ (root)`), Netlify oder einen beliebigen Webspace legen. Nötig ist HTTPS.

## Technik
- `ui.js`: gemeinsame Oberfläche (Start, Einladung, Lobby, Hilfe). `session.js`: Gastgeber/Gast, Lobby, Einladung, automatische Wiederverbindung. `net.js`: Verbindung (WebRTC über PeerJS, direkt zwischen den Geräten; öffentlicher Vermittlungsserver nur für den Verbindungsaufbau).
- Jedes Spiel: `engine.js` (Regeln, ohne Oberfläche) und `app.js` (Oberfläche).
- Ein Gerät (Gastgeber) verwaltet das Spiel; seine Seite muss offen bleiben. Nach Neuladen/Verbindungsabbruch kehren alle automatisch zurück.
- Tests: `npm test` (Regeln). Durchspieltests im Browser: `tests/<spiel>.e2e.cjs` (Playwright, siehe Kopf der Datei). Lokaler Test ohne Internet: Spielseite mit `?mock=1` in zwei Tabs desselben Browsers öffnen.
- Die Phasenliste von Phasenwürfeln steht in `phasen/engine.js` (`PHASES`) und ist dort leicht anzupassen.

## Nutzungszahlen (optional, standardmäßig aus)
`config.js` enthält `STATS_CODE`. Ist er leer, wird nichts gezählt und nichts an Dritte gesendet. Trägt man den Namen eines kostenlosen [GoatCounter](https://www.goatcounter.com)-Kontos ein, zählt `stats.js` anonym (ohne Cookies, ohne Namen und ohne Spielinhalte): Seitenaufrufe sowie die Ereignisse `raum-eroeffnet/<spiel>`, `gestartet/<spiel>`, `allein-gestartet/<spiel>` und `beendet/<spiel>`. Im Testmodus (`?mock=1`), auf `localhost` und bei „Do Not Track“ wird nicht gezählt. Auf der Startseite erscheint dann ein kurzer Hinweis.
