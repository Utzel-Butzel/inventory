# Kisteninhalt ohne Referenzprobe schätzen

**Experimenteller Prototyp. Der reale Entwicklungsfall mit 181 Walnüssen hat die gewünschte Genauigkeit nicht erreicht.** Die technische Integration und ihre Schutzprüfungen sind getestet; zuverlässiges Schätzen verdeckter Lagen ist damit noch nicht gelöst.

In der Bestandsbuchung oder Inventur unter **Menge per Foto → Kisteninhalt schätzen** verfügbar. Der Modus verarbeitet 3–5 Fotos derselben unveränderten Kiste. Eine abgezählte Referenzprobe ist nicht erforderlich. Innenmaße der Kiste und Außenmaße eines Teils können optional ergänzt werden; pro Maßgruppe müssen alle drei Werte vorliegen.

Aufnahmefolge: von oben, schräg seitlich und von der Gegenseite; optional zwei weitere Blickwinkel. Die ganze Kiste mit Rand und Füllfläche zeigen, Inhalt zwischen den Fotos unverändert lassen. Identische Bilddateien werden vor kostenpflichtiger Analyse abgewiesen. HEIC/HEIF wird im Browser mit dem nur bei Bedarf geladenen `heic-to/csp` in JPEG gewandelt. Die Sicherheitsgrenzen des serverseitigen Decoders bleiben unverändert. Der Modus nimmt Fotos entgegen, keine Videos. Er setzt einen Teiletyp pro Kiste voraus.

## Aussagekraft

Version `bulk_visual_v3` verwendet zwei getrennte strukturierte Bildanalysen. Beide erhalten alle Fotos, aber kein Ergebnis der anderen Analyse:

1. **Schichten:** Stücke je repräsentativer voller Lage × äquivalente Lagenzahl einschließlich verdeckter Teile.
2. **Volumen:** Länge, Breite und gesamte Fülltiefe jeweils in Einheiten der typischen Teileabmessungen, plus Formanteil des Behälters, äußerer Formanteil eines Teils und Packung der äußeren Teilhüllen. Der Code berechnet `L × B × T × Behälterform × Packung / Teileform`. So verwechselt das Modell nicht selbst Längen mit Volumen oder Packungsgrad mit Stückzahl. Bei der Division kehrt der Code die Unsicherheitsgrenzen um. Lücken, Ausrichtung und mögliches Ineinanderstecken müssen berücksichtigt werden; Filamentvolumen ist ungeeignet.

Das Modell liefert geometrische Faktoren mit unteren/mittleren/oberen Werten sowie Beobachtungen pro Bild. Der Code multipliziert die Faktoren, prüft die Bildabdeckung und verwirft widersprüchliche Angaben, etwa eine Gesamtmenge unter der sichtbaren Mindestzahl. Beide Ansätze müssen verwendbar sein. Der Vorschlag ist das gerundete Mittel beider Punktwerte; der angezeigte Bereich umfasst beide Szenarien und liegt nicht unter der sichtbaren Mindestzahl. Mehr als Faktor zwei Unterschied zwischen den Punktwerten führt zur Enthaltung. Das ist eine Produktregel, keine statistisch begründete Genauigkeitsschwelle. Nicht überlappende Bereiche erzeugen einen Warnhinweis.

Die Tiefe wird ausdrücklich als beobachtet, aus der Außenform abgeleitet oder nicht eingrenzbar erfasst. Eine flach erscheinende Oberfläche rechtfertigt keine einzelne Lage. Beide Analysen verwenden dasselbe Modell und dieselben Bilder und können denselben Fehler machen. Das Verfahren ist **keine metrische 3D-Rekonstruktion und kein statistisch kalibriertes Intervall**. Vollständig verdeckte Teile bleiben von Annahmen abhängig. Bei unzureichender oder widersprüchlicher Evidenz wird keine Menge zur Übernahme angeboten. Die Herleitung lässt sich im Ergebnis aufklappen.

**Eine Abweichung von höchstens 15 % ist nicht nachgewiesen.** Die automatisierten Tests prüfen den Softwareablauf, nicht die Zählgenauigkeit. Vor einem solchen Genauigkeitsversprechen müssen separate Testkisten mit bekannten Stückzahlen ausgewertet werden: verschiedene Teileformen, Füllstände, Packungen und Lichtbedingungen. Die bekannten Stückzahlen dienen ausschließlich der Auswertung, nicht als Eingabe für die Schätzung. Relative Abweichung `abs(Schätzung − Ist) / Ist`, Anteil innerhalb von 15 % und Anteil der Fälle ohne Schätzung gemeinsam berichten. Leere Kisten separat auswerten. Ein Modell- oder Promptwechsel erfordert eine neue Auswertung.

Das Ergebnis verändert zunächst keinen Bestand. Erst **Schätzung in Mengenfeld übernehmen** setzt den Vorschlag ins Formular und ergänzt eine Notiz mit Schätzwert, Bereich und Modell. Die eigentliche Buchung erfolgt anschließend wie bisher. Null ist nur für eine Inventurzählung übernehmbar.

## Einrichtung und Datenfluss

- Bestehendes `OPENAI_API_KEY` und optional `OPENAI_BASE_URL` verwenden.
- Standardmodell ist das Bildanalysemodell der Organisation. `OPENAI_BULK_COUNT_MODEL` überschreibt es bei Bedarf. Es muss Bilder und strukturierte Responses-Ausgaben unterstützen.
- Endpunkt: `POST /api/v1/ai/count/bulk`, Multipart mit JSON-Feld `input` und 3–5 `images`, jeweils höchstens 8 MiB. Das allgemeine Uploadlimit gilt zusätzlich für den gesamten Request.
- Zugriff erfordert `ai.count` und Zugriff auf den betreffenden Artikel. Bestehende Ratenlimits und monatliche KI-Budgets gelten. Nutzung wird als `photo_count` beim Anbieter `openai` protokolliert.
- Pro Analyse entstehen zwei Anbieteraufrufe mit je maximal 6.000 Ausgabetokens einschließlich Reasoning und allen Fotos. Die Budgetreservierung berücksichtigt beide Durchläufe mit insgesamt 50.000 Eingabe- und 12.000 Ausgabetokens. Für GPT-5.4 wird `reasoning.effort=low` verwendet. Beide Aufrufe werden abgewartet, auch wenn einer fehlschlägt; es gibt keine automatischen kostenpflichtigen Wiederholungen. Geometrische Widersprüche werden als Ergebnis ohne Mengenangabe ausgegeben.
- Fotos werden zum konfigurierten KI-Anbieter übertragen, aber nicht als Artikelbilder gespeichert. Der Responses-Aufruf verwendet `store: false`; das ersetzt keine Prüfung der Aufbewahrungsregeln des konfigurierten Anbieters. Das strukturierte Ergebnis bleibt für die vorhandene Wiederholungssicherung gespeichert.
- `Idempotency-Key` ist erforderlich. Wiederholte identische Requests geben das gespeicherte Ergebnis zurück; laufende Requests liefern 409. Nach einem unklaren Transportfehler behält das Formular denselben Schlüssel. Nach einem ausdrücklich fehlgeschlagenen Modellaufruf kann der Nutzer eine neue kostenpflichtige Analyse starten.

## Prüfungen

`npm run test:bulk-count` prüft Ergebnisverträge, Uploadgrenzen, Rechte, Wiederholungssicherung, Ratenlimit und Budgetfehler mit simuliertem Anbieter. Ergänzend: `npm run test:count`, `npm run test:ai-costs`, `npm run test:i18n`, `npm run test:stock-movements` und `npm run typecheck`.

Reproduzierbarer echter Modelltest (kostenpflichtig, ohne HTTP-Rechte-/Budget-Middleware, ohne Bestandsbuchung):

```sh
npm run qa:bulk-count -- --output outputs/bulk-count/NEUER_LAUF --item 'Teilebeschreibung' foto1.jpg foto2.jpg foto3.jpg
```

Optional `--model MODELL` und `--language en`. HEIC für den CLI-Test vorher in JPEG konvertieren; der Browser übernimmt diese Konvertierung beim normalen Upload. Das Ausgabeverzeichnis muss neu sein. Fotos, Prompts, Modell, Quellcode-Hashes, Rohbeobachtungen und Ergebnis bzw. Fehler werden gespeichert. Der CLI akzeptiert bewusst keine Sollstückzahl. Erst das gespeicherte Ergebnis mit der Handzählung vergleichen. Alle Läufe einschließlich Enthaltungen/Fehler dokumentieren; nicht nur den besten auswählen. Ein bereits bekannter Bildsatz ist ein Entwicklungsfall, keine unabhängige Validierung.

## Entwicklungsfall vom 27.10.2026

Fünf Fotos einer mit Walnüssen gefüllten roten Schale; Handzählung des Nutzers: 181. Die Sollzahl wurde keinem Modellaufruf übergeben. Es wurden weder Maße noch Referenzprobe verwendet. Sämtliche Läufe sind unter `outputs/bulk-count/` lokal gespeichert, die Auswertung in `walnuts-evaluation-2026-10-27.json`. Die Originalfotos und Modellantworten sind nicht Teil des Git-Repositorys.

| Variante | Modell | Freigegebene Gesamtmenge |
| --- | --- | --- |
| v1, drei Fotos (vorheriger Test) | gpt-4.1-mini | 80; 55,8 % zu niedrig |
| v2, fünf Fotos, erster Versuch | gpt-4.1-mini | Geometrischer Widerspruch, zunächst Fehlerantwort |
| v2, zweiter Versuch | gpt-4.1-mini | Keine Menge, Widerspruch erkannt |
| v2, Modellvergleich | gpt-4.1 | Keine Menge, Widerspruch erkannt |
| v2, Modellvergleich | gpt-5.4 | 85, Bereich 70–135; 53,0 % zu niedrig |
| v3, getrennte geometrische Verhältnisse | gpt-5.4, Reasoning low | Keine Menge, Widerspruch erkannt |
| v3, tatsächlicher Standard | gpt-4.1-mini | Keine Menge, Widerspruch erkannt |
| v3, Astra-Vergleich bei unveränderten Bildern, Prompts und Rechenregeln | gpt-6-astra | 244, Bereich 97–570; 34,8 % zu hoch |

Die aktuelle Variante liefert mit dem bisherigen Standardmodell und GPT-5.4 in diesem Fall keine übernehmbare Menge. Der auf Wunsch des Nutzers ausgeführte Astra-Vergleich liefert dagegen 225 über den Schichtansatz und 263 über den Volumenansatz; das gerundete Mittel ist 244. Das liegt 63 Nüsse bzw. 34,8 % über der Handzählung. Der sehr breite Szenariobereich 97–570 umfasst die Handzählung, ist aber kein kalibriertes Intervall und kein Nachweis ausreichender Genauigkeit. Ein Lauf mit zwei getrennten Modellanfragen, ca. 39 Sekunden, keine Sollzahl als Eingabe; Ergebnisse unter `walnuts-v3-2026-10-27/run-3-gpt-6-astra/`. Die Modellaufrufe verwenden die Standardeinstellung für Reasoning bei Astra und maximal 6.000 Ausgabetokens je Aufruf. Die Anwendungskonfiguration wurde für diesen Vergleich nicht umgestellt.

Die Bildmodelle schätzen sowohl sichtbare Größenverhältnisse als auch versteckte Tiefe fehlerhaft; zwei übereinstimmende Analysen allein sind kein Beleg für Richtigkeit. Ein verlässliches Verfahren braucht als nächsten Entwicklungsschritt belastbarere Bildmessungen bzw. echte geometrische Rekonstruktion und weitere unabhängig gezählte Testkisten. Die Ergebnisse rechtfertigen keinen pauschalen Korrekturfaktor und kein Genauigkeitsversprechen.

## MapAnything-Versuch mit vier Fotos

Am 27.10.2026 wurde `facebook/map-anything` über die offizielle Hugging-Face-Demo mit vier unveränderten JPEG-Ansichten ausgeführt: IMG_8123, IMG_8125, IMG_8127 und IMG_8128. Die kurze Stirnansicht IMG_8126 wurde weggelassen. Ein erfolgreicher Rekonstruktionsaufruf einschließlich Upload und Download dauerte rund 34 Sekunden. Die Demo verwendete Revision `f6518e41a09882228e94436c60a87df7711ce155`. Modell, Bilder, Quellcode der Demo, Einstellungen, Bild-Hashes, Skripte und Ergebnisse liegen unter `outputs/bulk-count/walnuts-mapanything-2026-10-27/`.

Die Rekonstruktion erzeugte vier offene Oberflächenmeshes. Schale und sichtbare Nüsse lassen sich räumlich darstellen; der verdeckte Innenraum ist nicht vermessen. Der absolute metrische Maßstab ist unbestätigt und wird für die folgende Volumenrelation nicht benötigt. `reconstruction.glb` enthält den vollständigen Export, `bowl-cropped.glb` einen räumlichen Ausschnitt der Schale. Die drehbare Vorschau zeigt eine aus diesen tatsächlichen Daten ausgedünnte Punktwolke.

Die anschließende **halbautomatische** Auswertung ist ein separates Experiment und noch kein Bestandteil des Buchungsdialogs:

1. Bodenebene aus Punkten außerhalb der Schale bestimmen und alle Ansichten gemeinsam ausrichten.
2. Rote Wandpunkte räumlich auf die Schale begrenzen und ihre konvexe Hülle als angenäherte äußere Behälterform verwenden. Den oberen Abschluss aus sichtbaren Nussoberflächen der Draufsicht ableiten und das Volumen auf einem Raster integrieren.
3. **13 sichtbare Nüsse im Foto manuell mit Ellipsen markieren.** Ihre Größen anhand der rekonstruierten Tiefe bestimmen. Das ist keine externe Messung oder abgezählte Referenzprobe, aber auch noch keine automatische Teileerkennung.
4. Als ausdrücklich unbestätigte Annahmen eine Packungsdichte von 0,60, eine verdeckte dritte Nussachse vom 0,90-Fachen des geometrischen Mittels der sichtbaren Achsen sowie einen inneren Wand-/Bodenversatz von 0,10 typischen Nussdurchmessern einsetzen.

Das ergibt rechnerisch **181,49, sinnvoll berichtet als rund 180 Nüsse**. Die gerundete Übereinstimmung mit den bekannten 181 ist kein Genauigkeitsnachweis. Die Sollzahl wurde weder an MapAnything übermittelt noch von der Berechnung eingelesen; sie war im Gespräch bereits bekannt. Es handelt sich daher um einen bekannten Entwicklungsfall mit manueller Auswahl der Beispielnüsse, nicht um einen verblindeten unabhängigen Test.

Die dokumentierten Szenarien (Packung 0,50–0,68; dritte Achse 0,75–1,10; Wand-/Bodenversatz 0–0,40 Nussdurchmesser) ergeben **97–264 Nüsse**. Dieser Bereich ist kein statistisches Konfidenzintervall und enthält nicht sämtliche Rekonstruktions- oder Markierungsfehler. Die Nachbaransichten weichen an den ausgewählten Oberflächenpunkten räumlich sichtbar voneinander ab. Ein perfekter 3D-Innenraum oder eine zuverlässige Genauigkeit von ±15 % ist damit nicht nachgewiesen.

Die Rückzuordnung der Draufsichts-Meshpunkte auf Bildpixel wurde auf eindeutige Reihenfolge und benachbarte Dreiecksvertices geprüft. Eine zusätzliche Berechnung mit halbiertem Rasterabstand prüft die numerische Stabilität; Details stehen in `validation.json`. Diese Prüfungen bestätigen den Rechenweg, nicht die physische Richtigkeit. Die Anwendungskonfiguration und Bestände wurden nicht geändert.

## Weiterer MapAnything-Test: schwarze Kunststoffteile in blauer Kiste

Der zweite Bildsatz vom 27.10.2026 umfasst IMG_8138 bis IMG_8145. Für die Rekonstruktion wurden vier Fotos gewählt: IMG_8139 (von oben), IMG_8138 (links schräg), IMG_8140 (rechts schräg) und IMG_8143 (von vorn). Die übrigen vier Fotos wurden nur zur Sichtung verwendet. Die tatsächliche Stückzahl war beim Erstellen und Speichern der Schätzung unbekannt; weder Referenzprobe noch externe Maße wurden eingesetzt.

Die öffentliche Demo verweigerte den Lauf wegen ihres ZeroGPU-Kontingents. Anschließend gelang die Rekonstruktion lokal auf der Apple-GPU mit `facebook/map-anything`, Modellrevision `a1d87e9086706fb9974f3be5a3e3a0ca5401c5aa` und Quellcode-Commit `3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9`. Die offiziellen Gewichte wurden beim Download platzsparend von F32 nach F16 konvertiert; der SHA-256 des vollständigen Originaldatenstroms wurde geprüft. Die Ausführung verwendete ein F32-Modell mit BF16-Autocast. Das ist nicht numerisch identisch mit dem vorherigen Demo-Lauf. Reine Inferenz: rund 15 Sekunden; erfolgreicher lokaler Start einschließlich Laden und Export: rund 80 Sekunden, ohne den vorherigen Download und die Einrichtung. Ein erster lokaler Ladeversuch scheiterte an gemeinsam gespeicherten Tensor-Aliasen; der korrekte Safetensors-Modelllader überprüfte danach sämtliche Gewichte erfolgreich.

Ergebnis der **halbautomatischen** Mengenrechnung: rechnerisch 635,55, berichtet als **rund 650 Teile**. Die Auswertung verwendet die rekonstruierte Tischfläche, eine manuell markierte Schüttfläche und 18 manuell markierte Längskanten sichtbarer Teile. Die Teile werden näherungsweise als rechtwinklige Dreiecksprismen modelliert. Die zentrale Rechnung setzt das Verhältnis der Dreieckskatheten zur Teilelänge auf 0,80, die Packung der konvexen Teilhüllen auf 0,60 und die Höhe des verdeckten Innenbodens über der Tischfläche auf 0,60 Teilelängen. Ein einheitlicher absoluter Maßstab kürzt sich heraus; die relativen Geometriefehler bleiben bestehen.

Die Kombination der dokumentierten Annahmen ergibt einen sehr breiten **Sensitivitätsbereich von rund 100 bis 1.650 Teilen**. Dieser Bereich ist kein Konfidenzintervall und keine automatische Freigabe sinnvoller Stückzahlen: Er zeigt, dass die Fotos die verdeckte Bodenhöhe und das Teilevolumen noch nicht ausreichend festlegen. Es wurde auch keine unabhängige sichtbare Mindeststückzahl gezählt. Insbesondere dürfen die unteren Szenarien nicht als geprüfte Untergrenze verstanden werden. Die nominellen 650 sind ein eingefrorener Versuchswert für einen späteren Vergleich, keine belastbare Bestandszahl. ±15 % sind weiterhin nicht nachgewiesen.

Die sichtbare Kiste wird räumlich wiedergegeben; die einzelnen Rippen, Hohlräume und verdeckten Teile werden nicht vollständig rekonstruiert. Abweichungen der Oberflächenhöhen zwischen Ansichten liegen im Median bei etwa 10–16 % der zentral angenommenen Fülltiefe. Das feinere Integrationsraster verändert die Mengenrechnung nur um 0,082 %; diese numerische Stabilität beseitigt die geometrischen Unsicherheiten nicht.

Alle Eingaben, Skripte, Fehlversuche, Rohvorhersagen, Annahmen und Ergebnisse liegen unter `outputs/bulk-count/objects-mapanything-2026-10-27/`. `reconstruction.glb` enthält den vollständigen Export, `bin-cropped.glb` die ausgeschnittene Kiste, `sample-annotations.jpg` die manuellen Markierungen und `quantity-result.json` den gespeicherten Versuchswert. Die drehbare Vorschau enthält 40.000 Punkte aus den tatsächlichen Modellvorhersagen. Die Anwendung und Bestände wurden für diesen Test nicht geändert.

### Nachträglich mitgeteilte tatsächliche Menge: 1.513 Spacer

Nach dem Speichern und Berichten der Schätzung nannte der Nutzer **1.513 Spacer**. Die berichteten 650 liegen damit **863 Stück bzw. 57,04 % zu niedrig**; der ungerundete Rechenwert liegt 57,99 % zu niedrig. Dieser Test verfehlt das Ziel von ±15 % klar. Dass 1.513 innerhalb des sehr breiten Sensitivitätsbereichs liegen, ist kein Erfolg der Mengenschätzung.

Die ursprüngliche `quantity-result.json` bleibt unverändert; ihr SHA-256 stimmt mit der vor dem Vergleich gespeicherten Prüfsumme überein. Die tatsächliche Menge und Fehlerrechnung wurden separat in `evaluation.json` abgelegt. Es wurde kein Korrekturfaktor angewandt und keine neue Schätzung nachträglich auf die bekannte Menge abgestimmt.

Eine bedingte Fehleranalyse zeigt: Würde ausschließlich der angenommene Innenboden bis auf die Tischfläche abgesenkt, ergäben sich bei unveränderter Schüttoberfläche, Grundfläche, Teileform und Packung rund 828 Teile. Die Bodenannahme allein erklärt die Abweichung innerhalb dieses Modells also nicht. Bei sonst unveränderter Rechnung müsste alternativ das angenommene Volumen je Teil auf rund 42 % sinken; bei gleicher Form entspräche das etwa 25 % kleineren linearen Abmessungen. Dies sind rechnerische Gegenproben, keine gemessenen Ursachen. Fehler der Rekonstruktion, der Teileform/-größe und der Packung lassen sich aus einer einzigen Gesamtstückzahl nicht getrennt bestimmen. Die gute numerische Übereinstimmung des vorherigen Walnussfalls hat sich auf diese Teile nicht übertragen.
