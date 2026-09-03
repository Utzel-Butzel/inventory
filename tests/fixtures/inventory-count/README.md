# Stückzahl-Benchmark

Dieses Verzeichnis enthält Ground-Truth-Fotos für die echte, über Replicate
laufende Stückzahlzählung. `manifest.json` hält pro Bild die erwartete Anzahl,
den Suchbegriff, die erlaubte Abweichung, einen SHA-256-Hash und die
Quellenangaben fest.

## Ausführen

```bash
npm run qa:count -- --list
npm run qa:count
npm run qa:count -- --model yolo-world --case user-glue-bottles-9
npm run qa:count -- --all-models --allow-failures
npm run qa:count -- --provider-only --allow-failures
```

Ohne Modellargument wird das konfigurierte Standardmodell verwendet. Der
Benchmark schlägt bei einer Zählabweichung oder einem Providerfehler fehl;
`--allow-failures` eignet sich für einen rein explorativen Modellvergleich.
Standardmäßig entspricht der Ablauf der Produktion: Dichte Bilder mit
mindestens 20 klar getrennten, ähnlich großen Teilen auf gleichmäßigem
Hintergrund werden zuerst lokal segmentiert; alle anderen Bilder gehen an das
ausgewählte Replicate-Modell. `--provider-only` überspringt diesen Vorfilter,
wenn ausschließlich die externen Modelle verglichen werden sollen.
Die JSON-Auswertung und Bilder mit nummerierten Treffermarkern landen unter
`outputs/inventory-count-benchmark/` und werden nicht eingecheckt.

## Testfall ergänzen

1. Das unveränderte Bild in dieses Verzeichnis legen.
2. Die manuell geprüfte Soll-Anzahl und einen präzisen englischen Gegenstandsbegriff
   in `manifest.json` eintragen.
3. Den SHA-256-Hash mit `shasum -a 256 <bild>` bestimmen.
4. Bei Internetbildern die dauerhafte Quellseite, Lizenz und Attribution
   dokumentieren. Bei generierten Bildern Generator und Promptdatei festhalten.
   Bilder mit unklarer Lizenz oder Herkunft nicht aufnehmen.
5. `npm run test:count` und anschließend den bezahlten `npm run qa:count` ausführen.

Das Nutzerfoto `user-glue-bottles-9.jpg` wurde in der zugehörigen Anfrage für
diesen Testaufbau bereitgestellt. Das zweite Foto stammt von Wikimedia Commons
und wurde von Blaloc unter CC0 1.0 freigegeben.

Die beiden synthetischen Hochlastfälle zeigen 100 (10×10) beziehungsweise 130
(13×10) getrennte 3D-Druck-Bauteile. Ihre Anzahl wurde sowohl zeilenweise
visuell als auch über zusammenhängende orange Bildkomponenten verifiziert. Die
Prompts und der Entstehungsweg stehen in `GENERATED-FIXTURES.md`.
