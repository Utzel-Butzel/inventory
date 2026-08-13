import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  coverPromptForTransparency,
  differenceMattingBlackPassPrompt,
} from "../lib/cover-generation-contract.ts";
import {
  extractDifferenceMattePixels,
  extractGreenScreen,
  extractGreenScreenPixels,
} from "../lib/cover-transparency.ts";
import { coverInputSchema } from "../lib/validators.ts";

test("cover requests accept both transparent-background methods", () => {
  assert.deepEqual(
    coverInputSchema.parse({
      transparentBackground: true,
      transparencyMethod: "greenscreen",
    }),
    {
      transparentBackground: true,
      transparencyMethod: "greenscreen",
    },
  );
  assert.equal(
    coverInputSchema.safeParse({
      transparentBackground: true,
      transparencyMethod: "background-removal",
    }).success,
    false,
  );
});

test("transparent prompts enforce the intermediate extraction backgrounds", () => {
  assert.match(
    coverPromptForTransparency("Keep the drill unchanged.", "greenscreen"),
    /#00FF00/,
  );
  assert.match(
    coverPromptForTransparency(
      "Keep the drill unchanged.",
      "difference-matting",
    ),
    /#FFFFFF/,
  );
  assert.match(differenceMattingBlackPassPrompt, /#000000/);
  assert.match(differenceMattingBlackPassPrompt, /exactly unchanged/);
});

test("difference matting recovers opaque, transparent, and soft pixels", () => {
  const white = Buffer.from([
    12, 34, 56, 255,
    255, 255, 255, 255,
    228, 178, 153, 255,
  ]);
  const black = Buffer.from([
    12, 34, 56, 255,
    0, 0, 0, 255,
    100, 50, 25, 255,
  ]);
  const result = extractDifferenceMattePixels(white, black);

  assert.deepEqual([...result.subarray(0, 4)], [12, 34, 56, 255]);
  assert.deepEqual([...result.subarray(4, 8)], [0, 0, 0, 0]);
  assert.ok(result[11] >= 126 && result[11] <= 128);
  assert.ok(result[8] >= 199 && result[8] <= 202);
  assert.ok(result[9] >= 99 && result[9] <= 101);
  assert.ok(result[10] >= 49 && result[10] <= 51);
});

test("greenscreen keying removes clean green while preserving opaque colors", () => {
  const result = extractGreenScreenPixels(
    Buffer.from([
      0, 255, 0, 255,
      5, 250, 7, 255,
      255, 0, 0, 255,
      255, 255, 255, 255,
    ]),
  );

  assert.equal(result[3], 0);
  assert.equal(result[7], 0);
  assert.deepEqual([...result.subarray(8, 12)], [255, 0, 0, 255]);
  assert.deepEqual([...result.subarray(12, 16)], [255, 255, 255, 255]);
});

test("greenscreen keying removes yellow-green edge spill beside the matte", () => {
  const result = extractGreenScreenPixels(
    Buffer.from([
      0, 255, 0, 255,
      128, 128, 0, 255,
      255, 0, 0, 255,
    ]),
    3,
    1,
  );

  assert.equal(result[3], 0);
  assert.ok(result[7] >= 126 && result[7] <= 129);
  assert.ok(result[4] >= 250);
  assert.ok(result[5] <= 5);
  assert.equal(result[6], 0);
  assert.deepEqual([...result.subarray(8, 12)], [255, 0, 0, 255]);
});

test("greenscreen keying removes a uniform fallback background when the model ignores green", () => {
  const width = 12;
  const height = 12;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 244 + (y % 2);
      pixels[offset + 1] = 239;
      pixels[offset + 2] = 245;
      pixels[offset + 3] = 255;
    }
  }
  for (let y = 4; y <= 7; y += 1) {
    for (let x = 4; x <= 7; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 30;
      pixels[offset + 1] = 80;
      pixels[offset + 2] = 120;
    }
  }

  const result = extractGreenScreenPixels(pixels, width, height);
  assert.equal(result[3], 0);
  assert.equal(result[(11 * width + 11) * 4 + 3], 0);
  assert.equal(result[(5 * width + 5) * 4 + 3], 255);
  assert.deepEqual(
    [...result.subarray((5 * width + 5) * 4, (5 * width + 5) * 4 + 4)],
    [30, 80, 120, 255],
  );
});

test("greenscreen output is encoded as a PNG with an alpha channel", async () => {
  const input = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .png()
    .toBuffer();
  const output = await extractGreenScreen(input);
  const { data, info } = await sharp(output)
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.format, "raw");
  assert.equal(info.channels, 4);
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  assert.equal(data[3], 0);
});
