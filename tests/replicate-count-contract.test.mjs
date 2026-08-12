import assert from "node:assert/strict";
import test from "node:test";

import {
  createInventoryCountResultFromSam3,
  normalizeReplicateCountPrompt,
} from "../lib/replicate-count-contract.ts";

test("normalizes whitespace without dropping meaningful part qualifiers", () => {
  assert.equal(
    normalizeReplicateCountPrompt("  ESP32 Platine   (Rev B) "),
    "ESP32 Platine (Rev B)",
  );
  assert.equal(normalizeReplicateCountPrompt(undefined), "physical parts");
});

test("maps normalized SAM 3 xywh boxes to existing 0...1000 markers", () => {
  const result = createInventoryCountResultFromSam3({
    output: {
      orig_img_h: 1_920,
      orig_img_w: 1_080,
      pred_boxes: [
        [0.1, 0.2, 0.2, 0.4],
        [0.75, 0.1, 0.1, 0.2],
      ],
      pred_scores: [0.8, 0.6],
      pred_masks: [],
      visualization: "https://example.invalid/output.png",
    },
    itemHint: "Platinen",
    prompt: "Platinen",
    maxMasks: 100,
    language: "Deutsch",
  });

  assert.equal(result.count, 2);
  assert.deepEqual(result.markers, [
    { x: 200, y: 400 },
    { x: 800, y: 200 },
  ]);
  assert.equal(result.confidence, 0.7);
  assert.equal(result.isExact, false);
  assert.equal(result.detectedItem, "Platinen");
});

test("returns a valid reviewed zero-result contract", () => {
  const result = createInventoryCountResultFromSam3({
    output: {
      orig_img_h: 640,
      orig_img_w: 640,
      pred_boxes: [],
      pred_scores: [],
    },
    prompt: "physical parts",
    maxMasks: 100,
    language: "English",
  });

  assert.equal(result.count, 0);
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.markers, []);
});

test("rejects mismatched or malformed provider boxes", () => {
  assert.throws(() =>
    createInventoryCountResultFromSam3({
      output: {
        orig_img_h: 640,
        orig_img_w: 640,
        pred_boxes: [[0.1, 0.1, 0.2, 0.2]],
        pred_scores: [],
      },
      prompt: "parts",
      maxMasks: 100,
      language: "English",
    }),
  );
  assert.throws(() =>
    createInventoryCountResultFromSam3({
      output: {
        orig_img_h: 640,
        orig_img_w: 640,
        pred_boxes: [[0.9, 0.1, 0.3, 0.2]],
        pred_scores: [0.9],
      },
      prompt: "parts",
      maxMasks: 100,
      language: "English",
    }),
  );
});

test("warns when the provider reaches its hard detection limit", () => {
  const boxes = Array.from({ length: 100 }, (_, index) => [
    (index % 10) / 10,
    Math.floor(index / 10) / 10,
    0.05,
    0.05,
  ]);
  const result = createInventoryCountResultFromSam3({
    output: {
      orig_img_h: 1_000,
      orig_img_w: 1_000,
      pred_boxes: boxes,
      pred_scores: Array(100).fill(0.9),
    },
    prompt: "parts",
    maxMasks: 100,
    language: "English",
  });

  assert.equal(result.count, 100);
  assert.match(result.warnings.join(" "), /model limit/i);
});
