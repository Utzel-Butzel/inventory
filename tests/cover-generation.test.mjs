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
