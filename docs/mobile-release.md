# Open Inventory: App Store und Google Play

Beide Store-IDs sind **`de.polyxo.openinventory`**. Anzeigename: **Open Inventory**.
Marketing-Version: **1.4**, erster Build der neuen ID: **1**. Der interne Kotlin-
Namespace bleibt `de.internetderdinge.inventory`; die installierte App, alle
Provider und der Play-Eintrag verwenden die neue `applicationId`.

## Stand am 3. November 2026

- Android: signiertes Release-AAB **1.4 (2)** gebaut und in Google Play hochgeladen.
  Interner Release-Entwurf und Produktionsrelease verwenden Build 2. Der Produktionsrelease
  ist zur Prüfung übermittelt, ohne blockierenden Build-Fehler validiert und auf 177 Länder
  plus „Rest der Welt“ ausgerichtet. Optionaler Hinweis: native Debug-Symbole fehlen.
  JVM-Tests, Android Lint und Debug-Build erfolgreich. Alle zwölf enthaltenen
  nativen 64-Bit-Bibliotheken haben 16-KB-kompatible ELF-LOAD-Segmente.
- iOS: signierte IPA **1.4 (2)** hochgeladen, von Apple als **VALID** verarbeitet
  und Version 1.4 zugeordnet. App Store Connect ID **6830115776**.
  Bundle-ID und App-Store-Provisionierungsprofil sind eingerichtet.
- Apple-Program-License-Agreement ist nach Zustimmung des Kontoinhabers angenommen.
  Der alte Eintrag Inventree Scanner mit digital.congru.inventory.scan bleibt bestehen.
- Deutsche und englische Store-Texte wurden bei Apple gespeichert. Englisch heißt
  die App **Open Inventory by Polyxo**, da Open Inventory dort nicht verfügbar war.
- App-Datenschutz und Support sind öffentlich: https://openinventory.polyxo.de/de/app/privacy
  und https://openinventory.polyxo.de/de/app/support. Beide Apps verlinken diese Seiten.
- Die native Demo ist live und ausschließlich lesbar. Der freigegebene separate
  Prüfbereich ist live, enthält acht Demo-Einträge und 24 Bilder und erlaubt
  Schreiben/Uploads. Zugang und Anleitung sind bei Apple und Google gespeichert.
  Passwort-Login, isolierte Organisationsauswahl, Erstellen, Bearbeiten,
  Bild-Upload und Löschen eines eigenen Testeintrags wurden erfolgreich geprüft.
- Google: Datenschutzerklärung, Werbefreiheit, Behörden-/Finanz-/Gesundheitsangaben,
  Kategorie Effizienz, Supportkontakt, App-Zugriff, Zielgruppe und Data Safety
  gespeichert (alle Einrichtungsschritte). Der deutsche Store-Eintrag mit App-Symbol, Vorstellungsgrafik und
  drei nativen Android-Screenshots wurde zusammen mit dem Produktionsrelease eingereicht.
  IARC nach ausdrücklicher Zustimmung abgeschlossen: USK 0, PEGI 3.
  Werbe-ID-Erklärung auf „Nein“ gespeichert; Release-Manifest und App-Code verwenden
  keine Advertising ID. Alle elf Änderungen wurden am 3. November 2026 um 12:20 Uhr
  (Europe/Berlin) zur Überprüfung gesendet. Die Vorabprüfungen sind abgeschlossen;
  Google bestätigt „Deine Änderungen werden jetzt überprüft“.
- Apple: App Privacy nach Zustimmung veröffentlicht, Altersfreigabe 4+,
  kostenloser Preis und Verfügbarkeit in 175 Regionen eingerichtet.
  Apple-Silicon-Mac und Vision-Pro-Verfügbarkeit deaktiviert. Inhaltsrechte nach
  Aussage des Kontoinhabers auf „keine Drittanbieterinhalte“ gespeichert.
  Drei echte iPhone-Screenshots (1206 × 2622) hochgeladen und erfolgreich verarbeitet.
  EU-Händlerkontakt für wirewire GmbH: E-Mail und Geschäftsnummer bestätigt;
  Telefonnummer per automatischem Anruf verifiziert, da kein SMS-Empfang möglich ist.
  DSA-Kontostatus ist aktiv; Open Inventory ist ausdrücklich als Händler-App
  gespeichert. Temporäre Apple-Serverfehler wurden durch Wiederholen behoben.
  Version 1.4 (2) wurde am 3. November 2026 um 12:20 Uhr (Europe/Berlin) übermittelt.
  Apple bestätigt „Warten auf Prüfung“; Übermittlungskennung
  `aaf000bf-6be0-43a3-aa22-4c37fc66cc9f`.
  DAC7 nach Auskunft des Kontoinhabers mit „keine persönlichen Dienste“
  abgeschlossen; Apple zeigt „Aktiviert“, der Hinweis auf fehlende Angaben ist entfernt.
  Prüfkonto im signierten iPhone-Simulator erfolgreich angemeldet. Simulator-Builds
  müssen ad hoc signiert sein; vollständig unsignierte Builds können keine
  Keychain-Zugangsdaten speichern.
- iOS Build 2 behebt das Laden von Medien mit Quelle `demo-imagegen` und unbekannten
  zukünftigen Quellen. Beide Regressionstests erfolgreich. Android: beide
  Instrumentierungstests erfolgreich; drei echte native Emulator-Screenshots liegen vor.
- Aktuelle lokale Prüfungen: vier iOS-Deployment-Tests, fünf Tests für isolierte
  native Demo-Authentifizierung (inklusive deaktivierter Demo), Ruby-Syntax und
  `git diff --check` erfolgreich. Der signierte iOS-Build wurde vollständig
  archiviert, exportiert, hochgeladen und von Apple verarbeitet.
- Beide Apps wurden auf ausdrücklichen Wunsch zur Store-Prüfung eingereicht,
  sind aber noch nicht öffentlich. Apple ist auf manuelle Veröffentlichung
  nach Freigabe eingestellt. Google veröffentlicht nach erfolgreicher Prüfung
  automatisch (verwaltete Veröffentlichung aus).

[Play Console](https://play.google.com/console/u/0/developers/4645680762559203208/app/4974350500082410063/app-dashboard) ·
[App Store Connect](https://appstoreconnect.apple.com/apps/6830115776/distribution)

Die neue ID ist für beide Betriebssysteme eine eigene App. Vorhandene Installationen
mit der alten ID werden dadurch nicht aktualisiert; gespeicherte Anmeldungen und
lokale Upload-Warteschlangen werden nicht automatisch übernommen.

## Android: reproduzierbarer Release

Java 17, Android SDK 36 und Python 3.11+ installieren. Vom Repository-Stamm:

```sh
# Nur vor dem ALLERERSTEN Release, wenn noch kein Upload-Schlüssel existiert:
npm run android:signing

npm run android:check
npm run android:release
```

`android:release` baut und prüft das signierte Bundle. Release-Builds ohne
konfigurierten Schlüssel schlagen absichtlich fehl; Debug-Builds benötigen
keinen Release-Schlüssel. Die aktuelle hochgeladene Bundle-Version ist 1.4 (2).

Artefakte:

- `android/app/build/outputs/bundle/release/app-release.aab`
- `android/app/build/outputs/mapping/release/mapping.txt` (R8-Deobfuskation)
- `android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`,
  falls Gradle native Symbole erzeugt hat

Der lokale Schlüssel liegt unter `~/.config/openinventory/release/upload.p12`,
das zugehörige Passwort in `upload-password.txt` im selben Verzeichnis.
`android/keystore.properties` enthält die lokale Gradle-Konfiguration.
Diese Dateien sind privat, mit restriktiven Dateirechten angelegt und von Git
ausgeschlossen. **Schlüssel und Passwort vor Veröffentlichung verschlüsselt
außerhalb dieses Rechners sichern.** Das Setup überschreibt vorhandene Schlüssel nicht.
Play App Signing verwaltet den eigentlichen App-Signierschlüssel; der lokale
Schlüssel dient zum Upload. Bei späteren Uploads denselben Upload-Schlüssel verwenden.

Alternativ kann CI `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` und `ANDROID_KEY_PASSWORD` als Secrets setzen. Keine Passwörter
in Kommandozeilenargumente schreiben. Der Keystore-Pfad darf absolut sein.

Für jeden weiteren Upload eine noch nicht verwendete Version vergeben:

```sh
ANDROID_VERSION_CODE=3 ANDROID_VERSION_NAME=1.4 npm run android:release
```

Ersten Upload im Play-Console-Eintrag vornehmen. Danach ist optional die
Fastlane-API verfügbar: Google Android Publisher API aktivieren, einen
Service-Account für genau diese App berechtigen und dessen JSON-Schlüssel
außerhalb des Repositories speichern. `GOOGLE_PLAY_JSON_KEY` in `fastlane/.env`
setzen. Dann:

```sh
ANDROID_VERSION_CODE=3 npm run deploy:android
```

Das erstellt einen **Entwurf im internen Test-Track** einschließlich Store-Texten
und R8-Mapping. Die gespeicherten Grafiken und Screenshots unter
`fastlane/metadata/android/de-DE/images/` werden mit übertragen. Es startet
keinen öffentlichen Rollout. Produktionsfreigabe,
Länder, Tester, Data Safety und Store-Grafiken werden in Play Console gepflegt.

## iOS: neuer Eintrag und TestFlight

Xcode mit dem aktuell von Apple verlangten iOS-SDK, Ruby 3.2+ und die im
`Gemfile.lock` festgelegten Gems verwenden. Lokal geprüft mit Xcode 27.1.
Apple-Team: `6CXYQL7FXP`. Apple-ID laut Kontoinhaber: `robert@wirewire.de`.

1. Als Account Holder das aktuelle Program License Agreement im
   [Developer-Konto](https://developer.apple.com/account/) akzeptieren.
2. API-Schlüssel in `fastlane/.env` konfigurieren (lokal bereits vorhanden).
3. Bundle-ID registrieren, dann in App Store Connect unter „Apps → + → Neue App“
   den Eintrag **Open Inventory**, iOS, Deutsch, Bundle-ID/SKU
   `de.polyxo.openinventory` erstellen. Apples REST-API unterstützt die Erstellung
   des App-Eintrags nicht; `ios:setup` weist darauf hin, wenn er noch fehlt:

```sh
bundle check || bundle install
npm run ios:check
npm run ios:setup
npm run ios:build
npm run deploy:ios
```

`ios:setup` registriert ausschließlich die neue ID, überspringt eine vorhandene
Registrierung und prüft anschließend, ob der Store-Eintrag vorhanden ist. `ios:build` exportiert eine signierte App-Store-IPA nach `build/ios/`.
Es nutzt den vorhandenen API-Schlüssel auch für automatische Provisionierung.
Für den lokal erfolgreich geprüften Export das installierte Profil auswählen:

```sh
IOS_PROVISIONING_PROFILE='Open Inventory App Store' npm run deploy:ios
```

`IOS_PROVISIONING_PROFILE` schaltet ausschließlich den IPA-Export auf das
angegebene App-Store-Profil mit Apple-Distribution-Zertifikat um. Ohne diesen
Wert verwendet Fastlane automatische Export-Signierung. Der Build-Zähler bleibt
ein Build-Parameter und verändert keine Projektdatei.

`deploy:ios` ermittelt die nächste TestFlight-Buildnummer, archiviert und lädt
hoch. Keine parallelen Deployments derselben Version starten.

App Store und TestFlight verwenden denselben hochgeladenen Build. Nach Verarbeitung
in App Store Connect wird der Build der Version 1.4 zugeordnet. Store-Texte können
separat als Entwurf übertragen werden:

```sh
# APP_PRIVACY_URL in fastlane/.env auf die veröffentlichte App-Datenschutzseite setzen.
npm run ios:metadata
bundle exec fastlane ios screenshots
```

Die Metadaten-Lane reicht **nicht** zur Prüfung ein und aktiviert **keine**
automatische Veröffentlichung. Screenshots, Review-Zugang, Datenschutzangaben,
Altersfreigabe, Verfügbarkeit und Preis müssen in App Store Connect vollständig sein.

## Separater Prüfbereich

Der Prüfbereich `store-review` liegt auf `https://inventory.paperlesspaper.de`.
Das Konto hat genau eine Organisationsmitgliedschaft, eine eigene Rolle für die
nativen App-Funktionen und keinen Zugriff auf andere Organisationen. Die öffentliche
Demo bleibt schreibgeschützt. Geheimnisse liegen ausschließlich lokal unter
`~/.config/openinventory/release/store-review.json` (0600) und in den privaten
Store-Prüffeldern; nicht in Screenshots, Metadaten oder Git aufnehmen.

`scripts/provision-store-review.mjs` ist ein einmaliger Provisionierer. Er benötigt
eine ausdrücklich gesetzte `DATABASE_URL`, lokale Mediendateien aus `demo/assets`
und JSON mit zufälligem `password`/`token` über stdin. `--dry-run` prüft alle
DB-Inserts und Medien-Prüfsummen mit anschließendem Rollback. Ohne diesen Schalter
werden Daten und eigene Medienkopien angelegt. Ein vorhandener Prüfbereich oder
Benutzer führt zum Abbruch; das Skript überschreibt oder setzt keine bestehenden
Prüfdaten zurück. Es wurde lokal und im Zielcontainer geprüft und einmal ausgeführt.

## Vor der öffentlichen Freigabe

- **Review-Zugang:** dedizierte erreichbare Instanz, Server-URL, Login und
  Testanleitung für die Prüfer hinterlegen. Die Apps verlangen ein bestehendes
  Konto oder einen API-Token. Der öffentliche Web-Demo-Login ist nicht automatisch
  ein verwendbarer nativer App-Login. Zugang nicht in Git oder Store-Texte aufnehmen.
- **Datenschutzseite:** dauerhaft öffentlich ohne Anmeldung erreichbare
  app-spezifische HTTPS-URL bereitstellen; in beiden Store-Einträgen und in den
  Apps zugänglich machen. Eine allgemeine Website-Datenschutzerklärung ist
  nur ausreichend, wenn sie die tatsächliche App-Datenverarbeitung abdeckt.
- **App Privacy / Data Safety:** anhand der Datenflüsse aus
  `docs/mobile-privacy-review.md` und der konkreten Server-/SDK-Konfiguration
  ausfüllen. Nicht pauschal „keine Daten“ auswählen.
- **Screenshots:** echte Aufnahmen der nativen Apps mit freigegebenen Demo-Daten
  erstellen. Die bestehenden `screenshots/mobile-*.png` zeigen die Web-App und
  dürfen nicht als native App-Aufnahmen ausgegeben werden. Apple verlangt passende
  iPhone-/ggf. iPad-Größen; Play zusätzlich Icon und Feature Graphic.
- **Funktionstest:** Anmeldung, Scannen, Foto-/Datei-Upload, Bestandsbuchung,
  Ausleihe, Abmelden und Wiederaufnahme von Uploads mit Release-Builds auf Geräten.
  16-KB-ELF-Prüfung ersetzt keinen Laufzeittest auf einem 16-KB-Gerät.
- **Konten/Store-Fragen:** EU-Händlerstatus, Kontakt, Altersfreigabe, Werbung,
  App-Zugriff, Preis und Länder korrekt vervollständigen. Die App enthält keine
  eigene Registrierung; prüfen, ob zusätzliche Account-Löschanforderungen durch
  verlinkte Server-Registrierung entstehen.

Quellen: [Apple-Einreichung](https://developer.apple.com/app-store/submitting/),
[Google-Ziel-API](https://support.google.com/googleplay/android-developer/answer/11926878),
[16-KB-Unterstützung](https://developer.android.com/guide/practices/page-sizes),
[Fastlane Play-Upload](https://docs.fastlane.tools/actions/upload_to_play_store/).
