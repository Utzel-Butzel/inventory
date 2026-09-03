import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import {
  evaluateInventoryCountBenchmark,
  inventoryCountBenchmarkManifestSchema,
  summarizeInventoryCountBenchmark,
} from "../lib/inventory-count-benchmark.ts";

const fixtureDirectory = new URL("./fixtures/inventory-count/", import.meta.url);

async function countSeparatedOrangeComponents(bytes) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let index = 0; index < mask.length; index += 1) {
    const red = data[index * 3];
    const green = data[index * 3 + 1];
    const blue = data[index * 3 + 2];
    mask[index] =
      red > 170 && red > green * 1.35 && green > blue * 1.15 ? 1 : 0;
  }

  const seen = new Uint8Array(mask.length);
  let components = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const current = stack.pop();
      size += 1;
      const x = current % info.width;
      const neighbors = [current - info.width, current + info.width];
      if (x > 0) neighbors.push(current - 1);
      if (x + 1 < info.width) neighbors.push(current + 1);
      for (const next of neighbors) {
        if (
          next >= 0 &&
          next < mask.length &&
          mask[next] &&
          !seen[next]
        ) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    // The bracket bodies are roughly 4,000 orange pixels. Tiny highlights or
    // compression islands must not become inventory pieces of their own.
    if (size > 500) components += 1;
  }
  return components;
}

test("the photo-count benchmark manifest has unique, integrity-checked fixtures", async () => {
  const manifest = inventoryCountBenchmarkManifestSchema.parse(
    JSON.parse(await readFile(new URL("manifest.json", fixtureDirectory), "utf8")),
  );

  assert.ok(manifest.cases.some((benchmarkCase) => benchmarkCase.expectedCount === 9));
  assert.ok(manifest.cases.some((benchmarkCase) => benchmarkCase.expectedCount === 100));
  assert.ok(manifest.cases.some((benchmarkCase) => benchmarkCase.expectedCount === 130));
  for (const benchmarkCase of manifest.cases) {
    const bytes = await readFile(new URL(benchmarkCase.imagePath, fixtureDirectory));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      benchmarkCase.imageSha256,
      benchmarkCase.id,
    );
    if (benchmarkCase.source.kind === "generated") {
      const prompt = await readFile(
        new URL(benchmarkCase.source.promptPath, fixtureDirectory),
        "utf8",
      );
      assert.match(prompt, new RegExp(benchmarkCase.id, "u"));
      assert.equal(
        await countSeparatedOrangeComponents(bytes),
        benchmarkCase.expectedCount,
        `${benchmarkCase.id} connected components`,
      );
    }
  }
});

test("evaluates exact results and configured absolute tolerances", () => {
  assert.deepEqual(
    evaluateInventoryCountBenchmark({
      expectedCount: 9,
      allowedAbsoluteError: 0,
      actualCount: 9,
    }),
    { absoluteError: 0, exact: true, withinTolerance: true },
  );
  assert.deepEqual(
    evaluateInventoryCountBenchmark({
      expectedCount: 9,
      allowedAbsoluteError: 1,
      actualCount: 8,
    }),
    { absoluteError: 1, exact: false, withinTolerance: true },
  );
});

test("summarizes successful and failed provider runs without hiding errors", () => {
  assert.deepEqual(
    summarizeInventoryCountBenchmark([
      { expectedCount: 9, allowedAbsoluteError: 0, actualCount: 9 },
      { expectedCount: 3, allowedAbsoluteError: 0, actualCount: 5 },
      { expectedCount: 3, allowedAbsoluteError: 0, actualCount: null },
    ]),
    {
      runs: 3,
      completed: 2,
      failed: 1,
      exactMatches: 1,
      withinTolerance: 1,
      meanAbsoluteError: 1,
    },
  );
});

test("rejects an internet fixture without durable source metadata", () => {
  const parsed = inventoryCountBenchmarkManifestSchema.safeParse({
    version: 1,
    cases: [
      {
        id: "missing-source",
        imagePath: "image.jpg",
        imageSha256: "a".repeat(64),
        itemHint: "bottle",
        expectedCount: 1,
        source: {
          kind: "internet",
          license: "CC0",
          attribution: "Example",
        },
      },
    ],
  });
  assert.equal(parsed.success, false);
});
