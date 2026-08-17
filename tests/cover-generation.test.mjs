import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import sharp from "sharp";

import { encodeOpaqueCoverImage } from "../lib/cover-image-output.ts";
import {
  coverPromptForTransparency,
  differenceMattingBlackPassPrompt,
} from "../lib/cover-generation-contract.ts";
import {
  extractDifferenceMatte,
  extractDifferenceMattePixels,
  extractGreenScreen,
  extractGreenScreenPixels,
} from "../lib/cover-transparency.ts";
import {
  maximumImageGenerationReferenceBytes,
  maximumImageGenerationReferenceDimension,
  prepareImageGenerationReferenceImage,
} from "../lib/image-generation-input.ts";
import { resolveImageGenerationSize } from "../lib/image-generation-size.ts";
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

test("cover requests accept only the supported maximum image sizes", () => {
  for (const maximumImageSize of [1024, 2048, 4096]) {
    assert.equal(
      coverInputSchema.parse({ maximumImageSize }).maximumImageSize,
      maximumImageSize,
    );
  }
  assert.equal(coverInputSchema.parse({}).maximumImageSize, undefined);
  assert.equal(
    coverInputSchema.safeParse({ maximumImageSize: 512 }).success,
    false,
  );
  assert.equal(
    coverInputSchema.safeParse({ maximumImageSize: 3072 }).success,
    false,
  );
});

test("image generation sizes use each provider's supported square tiers", () => {
  assert.equal(
    resolveImageGenerationSize({
      imageModel: { provider: "openai", model: "gpt-image-2" },
    }).outputImageSize,
    1024,
  );
  assert.deepEqual(
    resolveImageGenerationSize({
      imageModel: { provider: "openai", model: "gpt-image-2" },
      maximumImageSize: 4096,
    }),
    {
      provider: "openai",
      requestedMaximumImageSize: 4096,
      outputImageSize: 2048,
      providerImageSize: "2048x2048",
    },
  );
  assert.equal(
    resolveImageGenerationSize({
      imageModel: { provider: "openai", model: "gpt-image-1.5" },
      maximumImageSize: 4096,
    }).outputImageSize,
    1024,
  );
  assert.deepEqual(
    resolveImageGenerationSize({
      imageModel: { provider: "google", model: "gemini-3.1-flash-image" },
      maximumImageSize: 4096,
    }),
    {
      provider: "google",
      requestedMaximumImageSize: 4096,
      outputImageSize: 4096,
      providerImageSize: "4K",
    },
  );
  assert.equal(
    resolveImageGenerationSize({
      imageModel: { provider: "google", model: "gemini-3-pro-image" },
      maximumImageSize: 4096,
      transparentBackground: true,
    }).outputImageSize,
    2048,
  );
  assert.equal(
    resolveImageGenerationSize({
      imageModel: {
        provider: "google",
        model: "gemini-3.1-flash-lite-image",
      },
      maximumImageSize: 4096,
    }).outputImageSize,
    1024,
  );
  assert.deepEqual(
    resolveImageGenerationSize({
      imageModel: { provider: "google", model: "gemini-2.5-flash-image" },
      maximumImageSize: 4096,
    }),
    {
      provider: "google",
      requestedMaximumImageSize: 4096,
      outputImageSize: 1024,
    },
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

test("difference-matte output is capped and never enlarged", async () => {
  const mattePair = async (size) => {
    const white = Buffer.alloc(size * size * 3, 255);
    const black = Buffer.alloc(size * size * 3, 0);
    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        const offset = (y * size + x) * 3;
        for (const pixels of [white, black]) {
          pixels[offset] = 180;
          pixels[offset + 1] = 70;
          pixels[offset + 2] = 30;
        }
      }
    }
    return Promise.all(
      [white, black].map((pixels) =>
        sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
          .png()
          .toBuffer(),
      ),
    );
  };

  const [largeWhite, largeBlack] = await mattePair(16);
  const [smallWhite, smallBlack] = await mattePair(4);
  const capped = await sharp(
    await extractDifferenceMatte(largeWhite, largeBlack, 8),
  ).metadata();
  const unchanged = await sharp(
    await extractDifferenceMatte(smallWhite, smallBlack, 8),
  ).metadata();

  assert.equal(capped.width, 8);
  assert.equal(capped.height, 8);
  assert.equal(unchanged.width, 4);
  assert.equal(unchanged.height, 4);
});

test("image generation references stay within provider dimensions and bytes", async () => {
  const width = 4096;
  const height = 4096;
  const noisyInput = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  assert.ok(noisyInput.length > maximumImageGenerationReferenceBytes);

  const prepared = await prepareImageGenerationReferenceImage(noisyInput);
  const metadata = await sharp(prepared.bytes).metadata();
  assert.equal(metadata.width, maximumImageGenerationReferenceDimension);
  assert.equal(metadata.height, maximumImageGenerationReferenceDimension);
  assert.ok(prepared.bytes.length <= maximumImageGenerationReferenceBytes);
  assert.ok(prepared.bytes.toString("base64").length <= 20_000_000);
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

test("opaque cover output is square, capped, and never enlarged", async () => {
  const largeInput = await sharp({
    create: {
      width: 1100,
      height: 1100,
      channels: 3,
      background: { r: 50, g: 80, b: 120 },
    },
  })
    .png()
    .toBuffer();
  const smallInput = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 50, g: 80, b: 120 },
    },
  })
    .png()
    .toBuffer();

  const capped = await sharp(await encodeOpaqueCoverImage(largeInput, 1024))
    .metadata();
  const unchanged = await sharp(await encodeOpaqueCoverImage(smallInput, 1024))
    .metadata();
  assert.equal(capped.width, 1024);
  assert.equal(capped.height, 1024);
  assert.equal(unchanged.width, 8);
  assert.equal(unchanged.height, 8);
});

test("greenscreen output is capped without enlargement and keeps alpha", async () => {
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
  assert.equal(info.width, 2);
  assert.equal(info.height, 2);
  assert.equal(data[3], 0);
});
