import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let calls, failFirst, secondFinished;
const observation = {
  status: "estimated", depthEvidence: "inferred", visibleMinimum: 25, volumeGeometry: null,
  views: [1, 2, 3].map((image) => ({ image, evidence: "Container geometry" })),
  factorA: { low: 30, best: 40, high: 50 }, factorB: { low: 2, best: 3, high: 4 },
  explanation: "Inferred fill depth.", assumptions: ["Hidden bottom"], warnings: [], captureAdvice: [],
};
beforeEach(() => { calls = []; failFirst = false; secondFinished = false; process.env.OPENAI_API_KEY = "test-only-key"; });
mock.module("openai", { defaultExport: class {
  responses = { parse: async (request, options) => {
    calls.push({ request, options });
    if (failFirst && calls.length === 1) throw new Error("Provider failed");
    if (failFirst) { await new Promise((resolve) => setTimeout(resolve, 20)); secondFinished = true; }
    const one = { low: 1, best: 1, high: 1 };
    return { output_parsed: request.text.format.name.endsWith("volume") ? { ...observation, factorA: null, factorB: null, volumeGeometry: { lengthInItemLengths: observation.factorA, widthInItemWidths: observation.factorB, depthInItemHeights: one, containerVolumeFraction: one, itemShapeFraction: one, outerEnvelopePacking: one } } : observation };
  } };
} });
const { estimateBulkInventoryItems } = await import("../lib/inventory-bulk-count-ai.ts");
const options = {
  input: { itemId: "f6387215-fcbf-41de-9a5f-5b132d56d496", itemHint: "printed parts", language: "en", containerDimensions: null, partDimensions: null },
  images: ["image-a", "image-b", "image-c"], model: "test-model", idempotencyKey: "test-attempt",
};

test("two separate requests use all views, distinct idempotency keys and no prior estimate", async () => {
  let recorded;
  const result = await estimateBulkInventoryItems({ ...options, onObservations: async (value) => { recorded = value; } });
  assert.equal(result.estimate.count, 120);
  assert.equal(calls.length, 2);
  assert.equal(recorded.length, 2);
  assert.deepEqual(calls.map((call) => call.options.idempotencyKey), ["test-attempt:layers", "test-attempt:volume"]);
  for (const call of calls) {
    assert.equal(call.options.maxRetries, 0);
    assert.equal(call.request.store, false);
    assert.equal(call.request.input.length, 2);
    assert.equal(call.request.input[1].content.filter((entry) => entry.type === "input_image").length, 3);
    assert.equal(JSON.stringify(call.request).includes(options.input.itemId), false);
  }
  assert.notEqual(calls[0].request.input[0].content, calls[1].request.input[0].content);
});

test("waits for both paid calls to settle on failure and never silently retries", async () => {
  failFirst = true;
  await assert.rejects(estimateBulkInventoryItems(options), /Provider failed/);
  assert.equal(calls.length, 2);
  assert.equal(secondFinished, true);
});

test("too few photos are rejected before a paid call", async () => {
  await assert.rejects(estimateBulkInventoryItems({ ...options, images: ["image-a"] }), /3–5/);
  assert.equal(calls.length, 0);
});
