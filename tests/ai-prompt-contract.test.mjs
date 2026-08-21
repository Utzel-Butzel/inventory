import assert from "node:assert/strict";
import test from "node:test";

import { hashIdempotentPayload } from "../lib/idempotency.ts";
import {
  defaultCoverPrompt,
  defaultInventoryAnalysisPrompt,
  defaultInventoryResearchPrompt,
  defaultTransparentCoverPrompt,
} from "../lib/ai-prompts.ts";
import {
  analyzeInputSchema,
  coverInputSchema,
  inventoryImageInputSchema,
} from "../lib/validators.ts";

test("analysis prompt overrides are optional, trimmed, and bounded", () => {
  assert.deepEqual(analyzeInputSchema.parse({}), { overwrite: true });
  assert.deepEqual(
    analyzeInputSchema.parse({ overwrite: false, prompt: "  Focus on labels.  " }),
    { overwrite: false, prompt: "Focus on labels." },
  );
  assert.equal(
    analyzeInputSchema.safeParse({ prompt: "x".repeat(5_001) }).success,
    false,
  );
});

test("an omitted analysis prompt preserves the legacy idempotency payload", () => {
  const parsed = analyzeInputSchema.parse({});
  const payload = (input) =>
    hashIdempotentPayload({
      actor: "ios-user",
      resourceId: "resource-id",
      input,
    });

  assert.equal(payload(parsed), payload({ overwrite: true }));
  assert.notEqual(
    payload(parsed),
    payload(analyzeInputSchema.parse({ prompt: "Focus on labels." })),
  );
});

test("cover prompt overrides remain optional, trimmed, and bounded", () => {
  assert.deepEqual(coverInputSchema.parse({}), {});
  assert.equal(
    coverInputSchema.parse({ prompt: "  Keep the engraving.  " }).prompt,
    "Keep the engraving.",
  );
  assert.equal(
    coverInputSchema.safeParse({ prompt: "x".repeat(5_001) }).success,
    false,
  );
});

test("image acquisition keeps web search and generation inputs separate", () => {
  assert.deepEqual(inventoryImageInputSchema.parse({ mode: "search" }), {
    mode: "search",
  });
  assert.deepEqual(
    inventoryImageInputSchema.parse({
      mode: "generate",
      prompt: "  Neutral catalogue photo.  ",
      maximumImageSize: 2048,
    }),
    {
      mode: "generate",
      prompt: "Neutral catalogue photo.",
      maximumImageSize: 2048,
    },
  );
  assert.equal(
    inventoryImageInputSchema.safeParse({ mode: "search", modelId: "model" })
      .success,
    false,
  );
  assert.equal(
    inventoryImageInputSchema.safeParse({ mode: "generate", query: "drill" })
      .success,
    false,
  );
});

test("built-in prompts remain available when clients omit overrides", () => {
  assert.match(
    defaultInventoryAnalysisPrompt("English", ["object", "container"]),
    /Classify it as exactly one of: object, container/,
  );
  assert.match(defaultCoverPrompt("Drill"), /pure white background/);
  assert.match(defaultTransparentCoverPrompt("Drill"), /exact shape/);
  assert.match(
    defaultInventoryResearchPrompt("German", ["object", "tool"]),
    /Use web search/,
  );
  assert.match(
    defaultInventoryResearchPrompt("German", ["object", "tool"]),
    /exactly one of: object, tool/,
  );
});
