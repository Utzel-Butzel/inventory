import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import { countDenseRepeatedInventoryItems } from "../lib/dense-component-count.ts";

const fixtureDirectory = new URL("./fixtures/inventory-count/", import.meta.url);

async function preparedDataUrl(filename) {
  const source = await readFile(new URL(filename, fixtureDirectory));
  const jpeg = await sharp(source)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 1_600,
      height: 1_600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

for (const expectedCount of [100, 130]) {
  test(`counts ${expectedCount} separated repeated 3D-print parts locally`, async () => {
    const result = await countDenseRepeatedInventoryItems({
      imageDataUrl: await preparedDataUrl(
        `generated-3d-print-parts-${expectedCount}.png`,
      ),
      itemHint: "orange 3D-printed bracket",
      language: "Deutsch",
    });

    assert.ok(result);
    assert.equal(result.count, expectedCount);
    assert.equal(result.markers.length, expectedCount);
    assert.ok(result.confidence >= 0.7);
    assert.match(result.explanation, /lokale Segmentierung/iu);
  });
}

test("leaves irregular real-world photos to the configured vision model", async () => {
  for (const filename of [
    "user-glue-bottles-9.jpg",
    "wikimedia-vodka-bottles-3.jpg",
  ]) {
    assert.equal(
      await countDenseRepeatedInventoryItems({
        imageDataUrl: await preparedDataUrl(filename),
        itemHint: "bottle",
      }),
      null,
      filename,
    );
  }
});

test("rejects non-JPEG data URLs without attempting image decoding", async () => {
  assert.equal(
    await countDenseRepeatedInventoryItems({
      imageDataUrl: "data:image/png;base64,AAAA",
    }),
    null,
  );
});
