# Generierte Stückzahl-Fixierungen

Beide Bilder wurden mit der integrierten OpenAI-Bildgenerierung erstellt und
danach unabhängig als getrennte orange Bildkomponenten geprüft. Die
Generierung sollte ursprünglich 100 Teile liefern, erzeugte jedoch 13×10. Das
unveränderte Ergebnis wurde deshalb als eigener, korrekt beschrifteter
130er-Testfall behalten. Eine gezielte Bearbeitung entfernte anschließend die
drei unteren Reihen und ergab den 10×10-Testfall.

## `generated-3d-print-parts-130`

```text
Use case: photorealistic-natural
Asset type: ground-truth fixture for an automated inventory object-counting benchmark
Primary request: Create a photorealistic top-down workshop photograph showing exactly 100 separate, identical small 3D-printed parts.
Scene/backdrop: clean matte light-gray worktable, no other objects, no tools, no containers, no text.
Subject: exactly one hundred small orange 3D-printed rectangular bracket-like components, each clearly a separate physical item with visible FDM layer texture.
Style/medium: natural high-resolution product/workshop photography.
Composition/framing: strict 10 columns by 10 rows grid; all 100 parts fully inside the frame; even spacing with visible background gaps between every neighboring part; camera perpendicular to table; no overlap and no touching.
Lighting/mood: soft even diffuse workshop lighting with subtle consistent shadows.
Constraints: EXACTLY 100 parts total; 10 rows; 10 parts in every row; identical size and shape; no hidden or partial parts; no extra objects; no logos; no labels; no numbers; no text; no watermark.
Avoid: perspective distortion, clutter, piles, overlap, occlusion, fused parts, cropped edges, missing grid cells, extra grid cells.
```

Verifiziertes Ergebnis: 13 Reihen × 10 Teile = 130 Teile.

## `generated-3d-print-parts-100`

Bearbeitungsziel: `generated-3d-print-parts-130.png`

```text
Use case: precise-object-edit
Asset type: ground-truth fixture for an automated inventory object-counting benchmark
Primary request: Remove exactly the bottom three complete rows of orange parts from the supplied image, leaving exactly the top ten rows with ten parts per row: exactly 100 parts total.
Input image: edit target; preserve the existing top ten rows and photographic appearance.
Composition/framing: final strict 10 columns by 10 rows grid, centered with even light-gray margin around the grid; all 100 parts fully visible.
Constraints: keep every one of the top 100 parts unchanged in shape, color, spacing, texture, lighting and alignment; remove only rows 11, 12 and 13; fill their former area with matching empty matte light-gray tabletop; reframe to a balanced square image; exactly 100 objects; no new objects; no text; no watermark.
Avoid: changing or duplicating the retained parts, missing cells, extra rows, partial parts, overlap, clutter.
```

Verifiziertes Ergebnis: 10 Reihen × 10 Teile = 100 Teile.
