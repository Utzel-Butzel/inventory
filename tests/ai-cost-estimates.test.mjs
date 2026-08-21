import assert from "node:assert/strict";
import test from "node:test";

import {
  getAiCostEstimateCatalog,
  imageGenerationCostEstimate,
  imageGenerationCostEstimatesBySize,
} from "../lib/ai-cost-estimates.ts";

test("estimates the default OpenAI actions from their bounded workloads", () => {
  const catalog = getAiCostEstimateCatalog({});

  assert.deepEqual(catalog.operations.inventoryAnalysis, {
    provider: "openai",
    model: "gpt-4.1-mini",
    minimumUsd: 0.00136,
    maximumUsd: 0.00568,
    unit: "action",
  });
  assert.deepEqual(catalog.operations.inventoryResearch, {
    provider: "openai",
    model: "gpt-5.6-terra",
    minimumUsd: 0.03,
    maximumUsd: 0.094,
    unit: "action",
  });
  assert.deepEqual(catalog.operations.translation, {
    provider: "openai",
    model: "gpt-5.6-terra",
    minimumUsd: 0.009,
    maximumUsd: 0.076,
    unit: "itemLanguage",
  });
  assert.deepEqual(catalog.operations.roomAnalysis, {
    provider: "openai",
    model: "gpt-5.6-terra",
    minimumUsd: 0.052,
    maximumUsd: 0.224,
    unit: "action",
  });
});

test("uses configured model rates and omits unsupported custom pricing", () => {
  const catalog = getAiCostEstimateCatalog({
    OPENAI_VISION_MODEL: "gpt-4.1-nano-2026-01-01",
    OPENAI_RESEARCH_MODEL: "private-compatible-model",
  });

  assert.equal(catalog.operations.inventoryAnalysis?.model, "gpt-4.1-nano-2026-01-01");
  assert.equal(catalog.operations.inventoryAnalysis?.minimumUsd, 0.00034);
  assert.equal(catalog.operations.inventoryResearch, undefined);
  assert.equal(catalog.operations.imageSearch, undefined);
});

test("publishes per-pass image estimates for configured sizes", () => {
  assert.deepEqual(imageGenerationCostEstimate("openai", "gpt-image-1-mini"), {
    minimumUsd: 0.036,
    maximumUsd: 0.04,
    unit: "imagePass",
  });
  assert.deepEqual(
    imageGenerationCostEstimatesBySize("google", "gemini-3.1-flash-image")?.[
      "4096"
    ],
    { minimumUsd: 0.151, maximumUsd: 0.154, unit: "imagePass" },
  );
  assert.deepEqual(
    imageGenerationCostEstimatesBySize("openai", "gpt-image-2")?.["4096"],
    { minimumUsd: 0.5, maximumUsd: 0.56, unit: "imagePass" },
  );
  assert.equal(imageGenerationCostEstimate("google", "custom-image-model"), undefined);
});
