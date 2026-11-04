# Dokumentierte Geräteübergabe

Die Weboberfläche erfasst bei der Ausgabe und Rücknahme von mehrteiligen
Ausleihvorgängen ein Protokoll je Position und Buchung. Bei serialisierten Geräten
ist es dem konkreten Exemplar zugeordnet; Teilmengen erhalten eigene Protokolle.
Auch direkte Einzel-Ausleihen und Reservierungsausgaben am Gegenstand verwenden
diesen Ablauf:

- Zustand und Anmerkungen, Zubehör mit Anwesenheitsprüfung
- bis zu vier Zustandsfotos
- Namen der übergebenden und entgegennehmenden Person
- ausdrückliche Bestätigung durch den angemeldeten Benutzer

Schäden und fehlendes Zubehör benötigen eine Beschreibung. Bei der Rücknahme
bleiben alle Zubehörpositionen aus der Ausgabe erhalten und müssen erneut geprüft
werden. Das Ausgabeprotokoll kann zum Vergleich aufgeklappt werden. Fotos und
Bestätigung werden nicht von der Ausgabe zur Rücknahme übernommen.

Die Namen sind eine vom erfassenden Benutzer dokumentierte Bestätigung, keine
separat authentifizierten oder gezeichneten Unterschriften. Der Server hält
Benutzer, Erfassungszeit und den Zeitpunkt der Buchung getrennt fest.

## Speicherung und Zugriff

Migrationen `0078_loan_handovers.sql` und `0079_order_loan_handovers.sql` vor dem Start der aktualisierten Anwendung mit
`npm run db:migrate` anwenden. Protokoll und Bestandsänderung werden in derselben
Transaktion gespeichert. Der bestehende Idempotenzschlüssel verhindert doppelte
Buchungen und Protokolle. Bei Einzel-Ausleihen gibt es höchstens ein Ausgabe- und ein
Rücknahmeprotokoll. Bei mehrteiligen Vorgängen gehört jedes Protokoll zu genau
einer Bestandsbewegung; wiederholte Teilrückgaben bleiben getrennt nachvollziehbar. Es gibt keinen Bearbeitungs- oder Löschendpunkt für Protokolle.

Die Protokolle enthalten feste Kopien von Gerätename, Seriennummer, Entleiher,
Menge und Rückgabetermin. Fotos werden geprüft, verkleinert, von Metadaten befreit
und als JPEG im Protokoll gespeichert. Sie hängen nicht von der löschbaren
Mediengalerie des Gegenstands ab. Datenbanksicherungen enthalten die Fotos.

`assignments.manage` am Gegenstand erlaubt die Erfassung,
`assignments.read` das Lesen und den PDF-Download. Der Zugriff ist an die aktuelle
Organisation gebunden. Mehrteilige Vorgänge verwenden die bestehenden Rechte
`orders.manage` und `orders.read`. Protokolle werden separat geladen; Ausleihlisten enthalten
nur die Zeitpunkte der Dokumentation, keine Fotos.

## API und vorhandene Ausleihen

Die vorhandenen Erstellen-, Reservierungsausgabe-, Vorgangsbewegungs-,
Exemplarausgabe- und Rücknahme-Endpunkte nehmen
optional `handover` entgegen; das Schema steht in `public/openapi.yaml`.
Alte API-Clients und die bestehenden Anforderungsabläufe können weiterhin
Ausleihen ohne Ausgabeprotokoll anlegen. Die native App erhält dadurch keinen
neuen Protokolleditor. Ausleihen ohne Ausgabeprotokoll bleiben wie bisher
rückgebbar; die Weboberfläche bietet auch für sie ein Rücknahmeprotokoll an.

Sobald ein Ausgabeprotokoll vorliegt, verlangt der Server bei der Rücknahme
ebenfalls ein Protokoll. Eine solche Ausleihe kann nicht stattdessen storniert
werden. Bei Verwendung älterer Clients muss diese Rücknahme über die
Weboberfläche erfolgen.

`GET /api/v1/assignments/{id}/handovers` liefert beide Protokolle.
`?format=pdf&locale=de` oder `locale=en` lädt das PDF einschließlich Fotos.
PDF-Zeitangaben sind ausdrücklich in UTC; die Oberfläche nutzt die Browserzeitzone.

`GET /api/v1/orders/{id}/lines/{lineId}/handovers` liefert die Protokolle einer
Vorgangsposition. `unitId` filtert nach Exemplar; `format=pdf` lädt alle passenden
Protokolle als PDF. Bei Teilrückgaben von Mengenartikeln umfasst die Zubehörprüfung
die Bezeichnungen aus allen Ausgabeprotokollen der Position; beim noch ausgeliehenen
Teil verbleibendes Zubehör kann mit entsprechender Anmerkung als fehlend erfasst werden.
Pro Position beziehungsweise Exemplar sind über alle Teilausgaben hinweg höchstens
30 unterschiedliche Zubehörbezeichnungen zulässig, damit die Rücknahme vollständig
dokumentiert werden kann.

Die Zustandsangabe dokumentiert den Befund. Rücknahmen buchen den Bestand wie
bisher zurück; Reparaturen, fehlende Geräte und Statusänderungen benötigen eine
gesonderte Bearbeitung. Teilrückgaben werden bei mehrteiligen Vorgängen unterstützt; Einzel-Ausleihen
werden weiterhin vollständig zurückgenommen.

## Prüfung

`npm run test:loans` prüft die Eingaben, Bildaufbereitung, PDF-Erstellung und
bestehende Ausleihverträge. Für echte Transaktions- und Konkurrenztests zusätzlich
`HANDOVER_TEST_DATABASE_URL` auf eine **isolierte, vollständig migrierte
Testdatenbank** setzen. Diese Tests verwenden niemals ersatzweise `DATABASE_URL`
oder die lokale `.env` und erzeugen ausschließlich eigene Testorganisationen.
