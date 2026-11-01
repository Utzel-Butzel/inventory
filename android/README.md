# Inventory für Android

Native Android-App für den Inventory-Server in diesem Repository. Kotlin und
Jetpack Compose mit Material 3, dynamischen Systemfarben, Hell-/Dunkelmodus,
Android-Zurücknavigation, NavigationBar auf Telefonen und NavigationRail ab
840 dp. Die App verwendet dieselben `/api/v1`-Schnittstellen wie die iOS-App.

## Starten

Voraussetzungen: Java 17, Android SDK 36 mit Build Tools, Android Studio mit
Unterstützung für Android Gradle Plugin 8.13. Android-Geräte ab Android 8.0
(API 26). Der Gradle Wrapper ist enthalten und per SHA-256 geprüft.

1. `android/` in Android Studio öffnen und Gradle synchronisieren.
2. Einen Emulator oder ein Android-Gerät auswählen und `app` starten.
3. Die HTTPS-Adresse des Inventory-Servers ohne Unterpfad eingeben.
4. Mit E-Mail/Passwort anmelden oder unter der Expertenoption einen API-Token
   verwenden. Der Server muss den aktuellen Migrationsstand dieses Repositories
   einschließlich Aktionsketten und Idempotenz unterstützen.

Alternativ vom Repository-Stamm:

```sh
npm run android:check   # JVM-Tests, Android Lint und Debug-APK
npm run android:build   # Debug-APK erstellen
npm run android:test    # Gerätetests auf einem laufenden Emulator/Gerät
npm run android:install # Debug-App installieren
npm run android:bundle  # unsigniertes Release-App-Bundle
```

`ANDROID_HOME` und `JAVA_HOME` können explizit gesetzt werden. Das Node-Skript
erkennt die üblichen macOS-Installationspfade. Für lokale Entwicklung akzeptiert
die App HTTP nur auf Loopback, `.local` und `10.0.2.2` (Emulator → Host), etwa
`http://10.0.2.2:3000`. Öffentliche Server benötigen HTTPS. Weiterleitungen
authentifizierter Requests werden nicht verfolgt.

Ergebnisse:

- Installierbare Entwicklungs-APK: `app/build/outputs/apk/debug/app-debug.apk`
- Release-Bundle: `app/build/outputs/bundle/release/app-release.aab`
- JVM-Bericht: `app/build/reports/tests/testDebugUnitTest/index.html`
- Lint: `app/build/reports/lint-results-debug.html`
- Gerätetests: `app/build/reports/androidTests/connected/debug/index.html`

Release-Artefakte sind absichtlich unsigniert. Für eine Veröffentlichung einen
eigenen Upload-Schlüssel in Android Studio verwenden, Version und Buildnummer
erhöhen und das signierte Bundle separat verteilen. Schlüssel gehören nicht
ins Repository. Die enthaltene GitHub-Actions-Pipeline baut und testet; sie
veröffentlicht nichts in Google Play.

## Funktionsabgleich

| Bereich der iOS-App | Android-Umsetzung |
| --- | --- |
| Anmeldung und Arbeitsbereiche | E-Mail/Passwort, API-Token, Organisationswechsel, Berechtigungen, Abmelden, verschlüsselte Zugangsdaten im Android Keystore |
| Inventar | Suche, Seiten, Typ-/Statusfilter, Favoriten, ausleihbare Einträge, Details, Erstellen, Bearbeiten und Löschen |
| Stammdaten | Kategorien, Tags, SKU/Barcode/Seriennummer, Standort/GPS, Zahlen, eigene Felder und Ressourcenverweise |
| Struktur | Hauptressourcen/Varianten, Beziehungen, Stücklisten einschließlich Vererbung und Rücksetzen |
| Bestand | Warenein-/ausgang mit Prüfung, Bestandsregeln, Prognose und Beschaffung, serialisierte Einheiten, Status und Standort |
| Ausleihe | Ausgaben, Rücknahmen, Reservierungen/Aktivierung, Zuweisungen an Personen/Ressourcen, Ausleihregeln |
| Interne Anfragen | Mehrere Positionen, Details, Genehmigen, Ablehnen, Ausgeben und Stornieren gemäß Berechtigungen |
| Kamera | CameraX-Fotos, Fokus, Zoom, Blitz, Front-/Rückkamera, Fotowahl, GPS, bis zu zwölf Anhänge |
| Video | Native Android-Kamera, maximal 60 Sekunden und 23 MB, geprüft vor Übernahme |
| Dokumente | Mehrseitiger System-Dokumentscanner und lokale ML-Kit-Texterkennung für durchsuchbare PDF-Dateien |
| Medien | Bilder, Video, PDF und Modell-Dateien hinzufügen, sortieren, löschen, öffnen und teilen |
| Codes | ML Kit für QR-/Barcodes, manuelle Eingabe, UUID-/Link-/SKU-/Seriennummern-Suche und Anlegen aus unbekannten Codes |
| Aktionsabläufe | Workflow-Auswahl, Ziel/Varianten, bedingte Eingaben, Foto-/Datei-Eingaben, Vorschau, explizite atomare Bestätigung und nächster Scan |
| KI | Analyse, Recherche, Bilderzeugung, Bildsuche, normale/transparente Cover, Bildmodelle/-größen, persönliche Anweisungen und Organisationsvorlagen |
| Erkennen und Zählen | Fotoabgleich mit Trefferliste; Zählauftrag mit Polling, Markierungen, Konfidenz, manueller Korrektur und geprüfter Bestandsbuchung |
| Übersetzungen | Sprachübersicht, KI-Aufträge und Status, manuelle Korrekturen und Vorschläge übernehmen |
| Benachrichtigungen | Inbox, Gelesen-Status, Ereignisse, Zeitpläne, Serverkanäle und Vorschauen |
| Karte | Native MapLibre-Karte mit GPS-Einträgen, Suche und Öffnen der Details |
| Vorhandene Räume | Raum-/Etagenübersicht, native interaktive Geometrieansicht, Grundriss, Platzierungen, gespeicherte Ansichten und verknüpfte Einträge |
| Uploads | Persistente WorkManager-Warteschlange mit Organisationsbindung, Wiederaufnahme, Backoff und stabilen Idempotenzschlüsseln |
| Einstellungen | Arbeitsbereich, Inventartypen, Feld-/Beziehungsdefinitionen, Berechtigungen, Systemstatus und Links zum Webeditor |

Wie auf iOS erfolgt das **Bearbeiten der Aktionsabläufe** im vorhandenen
Webeditor. Ausführung und Prüfung bleiben native Ansichten. Web-Push verwendet
die Browser-Abonnements des Servers; die App bietet eine native Inbox und keine
zusätzliche FCM-Registrierung.

## Plattformgrenzen

Apples RoomPlan, gespeicherte ARKit-ARWorldMaps und RealityKit Object Capture
sind keine Android-APIs. Daher gibt es keine neue RoomPlan-LiDAR-Erfassung,
keine Relokalisierung in Apples gespeicherten Koordinatensystemen, keine damit
verbundene automatische Tiefenmessung/Platzierung und keine lokale Apple-
Photogrammetrie. Vorhandene serverseitige Raumgeometrie und Platzierungen werden
angezeigt. Neue ARCore-Koordinaten werden nicht als kompatibel ausgegeben.

Dokumentscans benötigen die ML-Kit-Scannerkomponente von Google Play Services;
sie kann beim ersten Aufruf nachgeladen werden. Auf Geräten ohne diese
Komponente können vorhandene Dokumente über die Android-Dateiauswahl angehängt
werden. Das Barcode- und OCR-Modell ist in der App enthalten. Videoaufnahme
benötigt eine installierte Kamera-App. Berechtigungen werden erst bei Verwendung
angefragt; manuelle Codeeingabe und Datei-/Fotowahl bleiben als Alternativen.

## Links und Mandantentrennung

Die App verarbeitet `inventory://resource/<UUID>` sowie
`inventory://open?url=<URL-encoded HTTPS inventory URL>`. Umhüllte Links behalten
Server, Organisation und optional die konkrete Bestandseinheit. Bei einem
fremden Server/Arbeitsbereich erfolgt keine automatische Aktion. Shortlinks
des Servers werden beim Scannen ebenfalls erkannt. Inhalte werden nie als
beliebige externe Navigation ausgeführt.

Verifizierte Android HTTPS App Links sind deploymentabhängig und noch nicht
registriert: Dafür wären der tatsächliche Veröffentlichungs-Schlüssel,
konkrete Domains, passende Intent-Filter und deren `assetlinks.json` nötig.
Das Custom Scheme funktioniert unabhängig von diesen Deploymentdaten.

Zugangstoken liegen AES-GCM-verschlüsselt mit einem Android-Keystore-Schlüssel
in `noBackupFilesDir`. Backups sind deaktiviert. Medien-Caches, Einstellungen,
Jobs und offene Operationen sind an Server, Organisation und Konto gebunden.
Externe HTTPS-Medien erhalten keine Authorization- oder Organisationsheader.

Die Queue kopiert Dateien vor dem Einreihen dauerhaft in den privaten
App-Speicher, prüft SHA-256 und speichert die einzelnen Serverstufen in SQLite:
Erstellen → Medien → Analyse → Recherche/optional Cover. Jede Stufe behält
ihren Schlüssel bei einem Retry. Bei unbekanntem Ergebnis einer Bestands-
oder Aktionsbuchung bleibt die vollständige bestätigte Anfrage erhalten und
kann unter **Mehr → Uploads & offene Vorgänge** sicher wiederholt werden.
Ein Organisationswechsel ändert niemals den Header eines bereits gestarteten
Requests. Es gibt keine vollständige Offline-Kopie des Inventars.

## Prüfung vor Veröffentlichung

Die JVM-Tests prüfen URL-/Token-Sicherheit, Arbeitsbereichstrennung,
Bereichsberechtigungen, Weiterleitungen, idempotente Wiederholungen,
Aktionsfeldregeln, Deep Links sowie asynchrone Zähl-/Erkennungsantworten.
Gerätetests verwenden einen lokalen MockWebServer und synthetische Daten für
Inventar → Details → geprüfte Bestandsbuchung, Activity-Neustart,
Keystore-Roundtrip, dauerhaftes Operationsjournal und Upload-Wiederaufnahme.
Sie verändern keine echten Inventardaten.

Zusätzlich auf einem physischen Gerät gegen einen Test-Arbeitsbereich prüfen:

- Anmeldung/Wechsel und eingeschränkte Rollen; Medienzugriff nach Abmeldung.
- Kamera/Video, verschiedene Codes, Dokumentrand-Erkennung, OCR-PDF und GPS;
  auch Ablehnen und erneutes Erteilen der Berechtigungen.
- Upload bei Netzabbruch, Prozessneustart, Geräte-Neustart und Kontowechsel.
- Echte KI-/Übersetzungsaufträge, lange Zählaufträge und Aktionsketten mit
  Seriennummern, Pflichtfeldern und gleichzeitig geänderten Beständen.
- Ausleih-/Anfrageabläufe, bestehende reale Raumscans, Karte und Medienviewer.
- Kleine Displays, Tablet, große Schrift, TalkBack und Dunkelmodus.

Emulatortests mit einem simulierten Server ersetzen diese Geräte- und
Deploymentabnahme nicht. Zum Ausführen der Tests einen Emulator mit genügend
freiem Speicher verwenden; die Debug-APK enthält mehrere native Architekturen.
