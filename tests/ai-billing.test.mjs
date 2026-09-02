import assert from "node:assert/strict";
import test from "node:test";

import {
  aiActionPermissions,
  aiUsageEstimate,
} from "../lib/ai-billing.ts";

test("reserves the conservative maximum for text and image actions", () => {
  assert.equal(
    aiUsageEstimate({ action: "inventory_analysis", environment: {} }).costMicros,
    5_680,
  );
  assert.equal(
    aiUsageEstimate({ action: "workflow_extraction", environment: {} }).costMicros,
    1_220,
  );
  assert.equal(
    aiUsageEstimate({
      action: "image_generation",
      provider: "openai",
      model: "gpt-image-2",
      maximumImageSize: 2048,
      quantity: 2,
    }).costMicros,
    1_120_000,
  );
});

test("maps every billable action to a granular role permission", () => {
  assert.deepEqual(aiActionPermissions, {
    inventory_analysis: "ai.analyze",
    inventory_research: "ai.research",
    image_search: "ai.research",
    inventory_recognition: "ai.recognize",
    photo_count: "ai.count",
    image_generation: "ai.images",
    translation: "ai.translate",
    room_analysis: "ai.rooms",
    workflow_extraction: "ai.analyze",
  });
  assert.equal(
    aiUsageEstimate({
      action: "photo_count",
      modelId: "sam-3",
      model: "yodagg/sam3-image-seg",
    }).costMicros,
    80_000,
  );
});
