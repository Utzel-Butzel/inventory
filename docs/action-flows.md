# Aktionsabläufe: Platine scannen und Bilderrahmen fertigstellen

Ein Ablauf enthält bis zu 24 Aktionen in einer festen Reihenfolge. Jede Aktion hat einen eigenen Namen, ein Ziel und optional Bedingungen. Du kannst Aktionen verschieben, duplizieren oder deaktivieren. Eine Aktion kann Werte und Einheiten aus früheren Aktionen übernehmen.

## OpenPaper 7 vorbereiten

1. Stelle den Bestand des Platinen-Eintrags auf **serialisiert**. Lege jede Platine über `POST /api/v1/resources/{platinenId}/stock/units` an, beispielsweise mit `{"code":"PCB-123","metadata":{"boardSerial":"SN-456"}}`. `code` ist die Kennung, die dein QR-Code später liefert; eine zusätzliche Hersteller-Seriennummer kann in den Eigenschaften stehen.
2. Stelle auch **OpenPaper 7** auf serialisierten Bestand, wenn jeder fertige Bilderrahmen eine eigene Kennung, Farbe und Historie erhalten soll. Bereits vorhandenen Mengenbestand vorher den tatsächlichen Geräten zuordnen.
3. Hinterlege die Stückliste: eine Platine und ein Rahmen. Unterschiedliche Rahmenfarben sind **Produktvarianten als eigene Inventareinträge** des Rahmen-Eintrags. Verwende einen Rahmen-Platz in der Stückliste mit auswählbaren Varianten; nicht je eine verpflichtende Stücklistenposition für jede Farbe.

Die ältere Varianten-Mengenaufteilung ist keine Auswahl eigenständiger Einträge. Der Variantenwähler im Ablauf verwendet die direkt zugeordneten Produktvarianten. Diese Änderung wandelt bestehende Produktionsdaten nicht automatisch um.

## Ablauf einrichten

Unter **Einstellungen → Aktionsabläufe**:

1. Wähle **OpenPaper 7** als Zieleintrag. Lege fest, wie die Platinenkennung aus dem Scan gelesen wird, etwa direkt aus dem Code oder aus einem URL-Parameter.
2. Unter **Eingaben während des Scans** füge eine Farbauswahl hinzu. Speichere sie in den Eigenschaften der Einheit oder in einem passenden eigenen Feld. Die separate Option **Produktvariante beim Scannen auswählen** lässt den Bediener die Produktvariante des Zieleintrags wählen. Das ist unabhängig von der Auswahl einer verbauten Komponente.
3. Füge die Aktion **Einheit finden** hinzu. Nenne sie „Platine finden“, wähle den Platinen-Eintrag und verwende die Kennung aus dem Scan.
4. Füge **Baugruppe fertigen** hinzu. Das Ziel ist das beim Scan gewählte Produkt, die Menge ist 1. Bei der Platinen-Komponente wähle **Einheit aus früherer Aktion** und „Platine finden“. Bei der Rahmen-Komponente wähle die Zuordnung aus einer Scan-Eingabe und ordne jeder Farbe den passenden Rahmen-Eintrag zu.
5. Aktiviere die Übernahme der Scan-Felder und Eingaben. Zusätzlich kannst du eine Eigenschaft `boardSerial` aus „Platine finden → Eigenschaften → boardSerial“ übernehmen. Die Fertigung dokumentiert außerdem selbst die Verbindung zwischen verbauter Platine und fertigem Gerät.
6. Optional folgen **Einheit anlegen / ändern** für einen Status oder zusätzliche Eigenschaften und **Standort ändern**. Wähle als Ziel jeweils das Ergebnis der Fertigungsaktion. Für die Eigenschaften beim Fertigen genügt schon die Fertigungsaktion selbst.
7. Optional füge eine **Prüfung** oder **Webhook senden** hinzu. Webhooks werden über die vorhandenen Webhook-Abonnements nach erfolgreichem Abschluss zugestellt.
8. Aktiviere **Pro Kennung und ausgewähltem Ziel nur einmal ausführen**, um eine doppelte Fertigung durch erneutes Scannen zu verhindern. Speichere den Ablauf und öffne **Gespeicherten Ablauf im Scanner prüfen**.

## Scannen und bestätigen

Scanne den QR-Code, wähle gegebenenfalls eine Produktvariante und beantworte die Eingaben. **Alle Aktionen prüfen** prüft alle Schritte gegen den aktuellen Bestand. Die Vorschau zeigt die Änderungen, verbauten Komponenten und deren Kennungen. Erst **Alle Änderungen bestätigen** bestätigt die Buchung.

Ein Fehler rollt sämtliche Bestandsänderungen, Einheitenänderungen, Fertigungen und ausstehenden Webhook-Ereignisse des Ablaufs zurück. Wenn sich Bestand oder Ablauf nach der Prüfung ändern, ist eine neue Vorschau erforderlich. Wiederholte Bestätigungen mit demselben Ausführungsschlüssel liefern das gespeicherte Ergebnis. Bei aktivierter Einmal-Ausführung gilt das auch für einen neuen Scan mit anderem Schlüssel.

Dateianhänge werden wie bisher vor der Bestandsprüfung hochgeladen; sie gehören nicht zur Bestandstransaktion. Öffentliche Ablauflinks unterstützen weiterhin keine Dateiuploads. Ein wiederholtes Webhook-Zustellungsereignis wird unabhängig von der Bestandstransaktion über die vorhandene Zustellungsverwaltung behandelt.

## In der iPhone-App

Öffne den Scanner und tippe oben auf **Ablauf wählen**. Wähle deinen Ablauf, scanne die Platine und wähle anschließend die Produktvariante und gegebenenfalls die Farbe. Die App zeigt nur die Eingaben, deren Bedingungen erfüllt sind. Mit **Alle Aktionen prüfen** siehst du jeden Schritt einzeln, einschließlich der verbauten Komponenten. Mit **Alle Änderungen bestätigen** führst du den Ablauf aus. **Nächsten Code scannen** behält den gewählten Ablauf bei.

Bei einer unklaren Bestätigung nach einem Verbindungsfehler tippe auf **Bestätigung erneut senden**. Die App verwendet dieselbe Anfrage und denselben Ausführungsschlüssel. Nutzer mit Leserechten können prüfen, aber keine Änderungen bestätigen.

Unter **Einstellungen → Web → Aktionsabläufe bearbeiten** öffnest du den Webeditor deiner ausgewählten Organisation, um Schritte, Varianten und Eingaben zu bearbeiten. Für die native Ausführung müssen die neue App-Version und die aktualisierte Server-Version installiert sein.

## Bedingungen und Werte

Werte können fest eingestellt sein, aus dem Scan, einer Scan-Eingabe oder einem früheren Aktionsergebnis stammen. Bedingungen unterstützen gleich/ungleich, vorhanden/fehlend und Zahlenvergleiche; mehrere Bedingungen können mit „alle“ oder „mindestens eine“ verknüpft werden.

Eine optionale Suchaktion kann ein nicht gefundenes Gerät als `found: false` zurückgeben. Darauf kann eine Aktion zum Anlegen reagieren. Übersprungene Aktionen liefern kein Ergebnis. Ein späterer Schritt muss deshalb ebenfalls passend bedingt sein, wenn er dieses Ergebnis benötigt.

Eingaben können abhängig vom Scan oder von früheren Eingaben sichtbar sein. Versteckte Eingaben werden ignoriert und lösen keine Pflichtfeldprüfung aus. Eine Eingabe kann nicht vom Ergebnis einer Aktion abhängen, da die Eingaben vor der Ausführung abgefragt werden.

Eine Fertigung mit Menge größer 1 erzeugt bei serialisiertem Bestand die Kennungen `SCAN-1`, `SCAN-2` usw. Das Ergebnis einer solchen Fertigung kann nicht als einzelne Einheit für einen Folgeschritt verwendet werden. Verwende für eine Kette mit gerätebezogenen Folgeschritten Menge 1.

## API

Bestehende Abläufe ohne `actions` behalten ihre bisherige Ausführung. Der neue Editor übernimmt die alte Hauptaktion und einen bisherigen Webhook beim Speichern in die Aktionsliste. API-Clients verwenden für diese Abläufe die neuen Endpunkte:

1. `GET /api/v1/stock/scan-workflows/{workflowId}/runner` liefert Ziele, Varianten und Eingaben. Native Clients können denselben Pfad mit `POST` und `{ "code": "PCB-123", "codeType": "qr_code" }` aufrufen; dann enthält die Antwort zusätzlich die vom Server extrahierte `identifier`-Kennung für Eingabebedingungen.
2. `POST /api/v1/stock/action-chains/preview` erhält `workflowId`, `code`, optional `codeType`, `selectedResourceIds` und `inputs`. Die Antwort enthält `planHash` und die Liste aller geprüften Schritte.
3. `POST /api/v1/stock/action-chains/execute` erhält dieselben Angaben plus `expectedPlanHash`. Im Header steht eine neue UUID als `Idempotency-Key`. Bei einer Wiederholung derselben Anfrage bleibt dieser Schlüssel unverändert.

Beispiel für die Vorschau:

```json
{
  "workflowId": "11111111-1111-4111-8111-111111111111",
  "code": "PCB-123",
  "codeType": "qr_code",
  "selectedResourceIds": ["22222222-2222-4222-8222-222222222222"],
  "inputs": { "color": "black" }
}
```

Zum Bestätigen `expectedPlanHash` aus der tatsächlichen Vorschau hinzufügen. Die UUIDs im Beispiel durch die tatsächlichen IDs ersetzen. Die Konfiguration der Aktionsliste steht im `actions`-Feld der bisherigen Workflow-Erstellen/-Ändern-Endpunkte; alle Aktionstypen sind in [OpenAPI](../public/openapi.yaml) beschrieben.

Für öffentliche Links entsprechen die Endpunkte `/api/public/action-flows/{triggerId}/chain`, `/chain/preview` und `/chain/execute`. Der Link muss aktiv bleiben. Ein fest konfigurierter Code kann über die öffentliche Anfrage nicht überschrieben werden.

## Betrieb und Prüfung

Vor dem Start der neuen Version Migration `0064_action_chains.sql` mit dem regulären Migrationslauf anwenden. Es ist keine automatische Änderung vorhandener Produktbestände oder Varianten enthalten.

`npm run test:action-chains` prüft die Verträge. Die zusätzlichen Datenbanktests benötigen eine **isolierte, bereits migrierte Testdatenbank** über `ACTION_CHAIN_TEST_DATABASE_URL`. Sie erstellen ausschließlich eigene Testorganisationen und nutzen niemals ersatzweise die normale `DATABASE_URL`.
