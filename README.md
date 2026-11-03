# Kreuz & Quer – Würfelspiel online

Würfelspiel für 2–5 Personen, online im Browser. Kein Konto, keine Installation, reine statische Dateien (kein Build).

**Spielen:** Seite öffnen → Vornamen eingeben → „Neues Spiel eröffnen“ → Einladungs-Link per WhatsApp schicken → Mitspielerin tippt auf den Link → „Spiel starten“.

**Veröffentlichen:** Den Ordner auf GitHub Pages (Settings → Pages → Branch `main`, Ordner `/ (root)`), Netlify oder einen beliebigen Webspace legen. Nötig ist HTTPS.

## Technik
- `engine.js` Regeln, `net.js` Verbindung (WebRTC über PeerJS, direkt zwischen den Geräten; öffentlicher Vermittlungsserver nur für den Verbindungsaufbau), `app.js` Oberfläche.
- Ein Gerät (Gastgeber) verwaltet das Spiel; seine Seite muss offen bleiben. Nach Neuladen/Verbindungsabbruch kehren alle automatisch zurück.
- Tests: `npm test`. Lokaler Test ohne Internet: `index.html?mock=1` in zwei Tabs desselben Browsers.
