# Datenflüsse für die Store-Angaben

Technische Prüfbasis für `de.polyxo.openinventory`, Stand 3. November 2026.
Die öffentliche App-Datenschutzerklärung steht unter
https://openinventory.polyxo.de/de/app/privacy. Dieses Dokument ist die technische
Prüfbasis, keine abgeschlossene Store-Datenauskunft. Die endgültigen Angaben
müssen die tatsächliche Betreiber-, Server- und SDK-Konfiguration berücksichtigen.

| Funktion | Datenfluss / Speicher | Vor Freigabe klären |
| --- | --- | --- |
| Anmeldung | Benutzer gibt Server-URL, E-Mail/Passwort oder API-Token ein; Anfrage geht an diesen Server. Persistente Token werden auf iOS in der Keychain, auf Android mit Android Keystore geschützt gespeichert. | Verantwortlicher Betreiber, Kontaktdaten, Rechtsgrundlage, Löschung und Aufbewahrung beim Serverbetreiber. |
| Inventar und Ausleihe | Inventar, Namen, Beschreibungen, Beziehungen, Bestände und Zuordnungen werden mit dem ausgewählten Server ausgetauscht. | Personenbezug von Benutzerkonten, Zuweisungen und Nutzungsprotokollen; Zugriffsrechte und Aufbewahrung. |
| Medien | Vom Nutzer ausgewählte/aufgenommene Fotos, Videos, Audio in Videos und Dokumente werden zum Server hochgeladen. Lokale Warteschlange hält ausstehende Uploads vor. | Fotos/Videos/Audio/Dateien korrekt im Store deklarieren; lokale Löschmöglichkeiten und serverseitige Fristen beschreiben. Abmelden löscht nicht pauschal alle ausstehenden Medien. |
| Standort | Optional angefragter Standort kann an Inventareinträgen gespeichert und zum Server übertragen werden. | Präziser oder ungefährer Standort; Nutzungszweck Inventarstandort. Kein Hintergrundstandort im Android-Manifest angefordert. |
| QR-/Barcodes und OCR | Native Kamera-/Scanner-Funktionen; Android nutzt ML Kit für Barcode und Text, Google Play Services für Dokument-Scans. | Aktuelle Google-SDK-Datenverarbeitung und Diagnose-/Geräteinformationen anhand der SDK-Dokumentation prüfen; lokale Verarbeitung nicht mit „keine SDK-Datenerhebung“ gleichsetzen. |
| Karten | Android lädt Kartenstil von `https://tiles.openfreemap.org/styles/liberty`; dabei entstehen Anfragen an den Kartenanbieter. iOS nutzt MapKit. | IP-Adresse, technische Zugriffsdaten, sichtbarer Kartenausschnitt und Anbieterbedingungen berücksichtigen. |
| Raum-/Objekterfassung | iOS nutzt bei unterstützter Hardware RoomPlan, ARKit und Object Capture. Raumgeometrie, Medien und Modelle können an den Server gehen. Android zeigt vorhandene Raumdaten an. | Räumliche Innenraumdaten, Bilder und Modelle in der Datenschutzerklärung berücksichtigen. |
| Optionale KI | Ausgewählte Inhalte werden über die API an die auf dem Server konfigurierten KI-Dienste übergeben. | Anbieter, Zweck, Datenarten und Drittlandtransfers je Deployment; keine pauschale Aussage, alle Daten blieben ausschließlich auf dem Smartphone. |
| Diagnose / Tracking | Im untersuchten App-Code ist kein separates Werbe-/Analytics-SDK konfiguriert. Das iOS-Privacy-Manifest deklariert kein Tracking und UserDefaults-Grund CA92.1. | Transitive SDKs und Serverlogs separat prüfen. Das leere `NSPrivacyCollectedDataTypes`-Array ersetzt nicht die Store-Datenauskunft. |

## Benötigter Inhalt der öffentlichen App-Datenschutzseite

- App-Name und ID, Herausgeber mit ladungsfähigem Kontakt, Datenschutzkontakt.
- Abgrenzung zwischen App-Herausgeber und dem vom Nutzer gewählten Serverbetreiber.
- Konkrete Datenarten, Zwecke, Empfänger, lokale Speicherung und Serverübertragung.
- Kamera, Mikrofon, Fotoauswahl und optionaler Standort; Ablehnung der
  Berechtigungen und weiter nutzbare Alternativen.
- Google ML Kit/Play Services, OpenFreeMap, Apple-Dienste und optionale
  serverseitige KI-Anbieter entsprechend der tatsächlichen Verarbeitung.
- Aufbewahrung und Löschung einschließlich lokaler Upload-Warteschlangen,
  Token und serverseitigem Benutzerkonto; Kontakt-/Antragsweg für Betroffene.
- Stand der Erklärung und öffentlich erreichbare HTTPS-URL ohne Anmeldung.

Die Builds iOS 1.4 (2) und Android 1.4 (2) enthalten Links zur veröffentlichten
Datenschutz- und Supportseite sowie den Zugang zur schreibgeschützten öffentlichen Demo.

## Store-Angaben am 3. November 2026

Apple App Privacy ist nach ausdrücklicher Bestätigung des Kontoinhabers veröffentlicht:
Name, E-Mail, Benutzer-ID, genauer/ungefährer Standort, Fotos/Videos, Audio,
sonstige Nutzerinhalte und Umgebungsscans. Zweck jeweils App-Funktionalität,
mit Kontobezug, ohne Tracking.

Google Data Safety ist gespeichert, aber noch nicht zur Prüfung eingereicht.
Zusätzlich zu Konto-, Standort-, Medien-, Datei- und Inventarinhalten sind
App-Interaktionen, Suchanfragen, Diagnosedaten und Geräte-/Installationskennungen
angegeben. ML Kit dokumentiert Geräte-/App-Informationen, Installationskennungen,
Laufzeiten, Konfigurationen und Ereignisse für Diagnose und Nutzungsanalyse.
Scanner-SDK-Diagnose und Kennungen sind als erforderlich/Analyse eingetragen;
vom Nutzer gewählte Inhalte und Standort als optional/App-Funktionalität.

**Transportverschlüsselung:** Android erlaubt HTTP für localhost, Loopback,
Emulator-Host und `.local`-Server. Deshalb wurde die Frage, ob **alle** Nutzerdaten
verschlüsselt übertragen werden, mit Nein beantwortet. Google zeigt dafür die
pauschale Warnung „Daten werden nicht verschlüsselt“. Öffentliche Demo und
Prüfserver verwenden HTTPS. Für ein späteres durchgängiges Verschlüsselungslabel
müssten auch lokale Release-Verbindungen HTTPS erzwingen; dies wäre eine
bewusste Änderung der bestehenden Unterstützung lokaler Server.

Konten werden außerhalb der Apps vom jeweiligen Serverbetreiber eingerichtet.
Der Löschanfrage-Link verweist auf die Supportseite mit den getrennten Wegen
für eigene Dienste und selbst gehostete Server. Es gibt keine Werbung und keine
app-eigene Kontoregistrierung.

Primärquellen:

- [Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- [Google Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [ML Kit Data-Safety-Angaben](https://developers.google.com/ml-kit/android-data-disclosure)
- [Apple Privacy Manifests](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files)
