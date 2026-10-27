import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import { bulkCountInputSchema, bulkGeometrySchema, bulkCountResponseSchema } from "../lib/inventory-bulk-count.ts";
import { calculateBulkGeometry, combineBulkGeometry } from "../lib/inventory-bulk-geometry.ts";

const result = {
  method: "bulk_visual", isExact: false, accuracyValidated: false, model: "test-model",
  estimate: { count: 400, lowerBound: 280, upperBound: 550 },
  visibility: "partial_layers", explanation: "Several layers of similar parts are visible.",
  assumptions: ["Comparable part sizes throughout the box."], warnings: ["Hidden pieces cannot be verified."], captureAdvice: [],
};

test("a bulk estimate includes hidden pieces without fabricated detection markers", () => {
  assert.deepEqual(bulkCountResponseSchema.parse(result), result);
  assert.equal("markers" in result, false);
  assert.equal(bulkCountResponseSchema.safeParse({ ...result, isExact: true }).success, false);
  assert.equal(bulkCountResponseSchema.safeParse({ ...result, accuracyValidated: true }).success, false);
});

test("rejects reversed bounds, false precision and non-finite or fractional counts", () => {
  for (const estimate of [
    { count: 400, lowerBound: 401, upperBound: 550 },
    { count: 400, lowerBound: 280, upperBound: 399 },
    { count: 400, lowerBound: 400, upperBound: 400 },
    { count: Infinity, lowerBound: 280, upperBound: 550 },
    { count: 400.5, lowerBound: 280, upperBound: 550 },
    { count: -1, lowerBound: -5, upperBound: 10 },
    { count: 1_000_001, lowerBound: 280, upperBound: 1_000_001 },
  ]) assert.equal(bulkCountResponseSchema.safeParse({ ...result, estimate }).success, false);
});

test("insufficient evidence is distinct from an empty box", () => {
  assert.equal(bulkCountResponseSchema.safeParse({ ...result, estimate: null, visibility: "unclear", captureAdvice: ["Show the fill depth."] }).success, true);
  assert.equal(bulkCountResponseSchema.safeParse({ ...result, visibility: "unclear" }).success, false);
  assert.equal(bulkCountResponseSchema.safeParse({ ...result, estimate: { count: 0, lowerBound: 0, upperBound: 0 }, visibility: "mostly_visible" }).success, true);
  assert.equal(bulkCountResponseSchema.safeParse({ ...result, estimate: { count: 0, lowerBound: 0, upperBound: 500 } }).success, false);
});

test("reference samples and dimensions are not required; partial dimensions are rejected", () => {
  const input = { itemId: "f6387215-fcbf-41de-9a5f-5b132d56d496", itemHint: "printed brackets", language: "de", containerDimensions: null, partDimensions: null };
  assert.deepEqual(bulkCountInputSchema.parse(input), input);
  assert.equal(bulkCountInputSchema.safeParse({ ...input, partDimensions: { lengthMm: 12 } }).success, false);
  assert.equal(bulkCountInputSchema.safeParse({ ...input, containerDimensions: { lengthMm: 300, widthMm: 200, heightMm: 0 } }).success, false);
  assert.equal(bulkCountInputSchema.safeParse({ ...input, partDimensions: { lengthMm: 12, widthMm: 8, heightMm: 4 } }).success, true);
});

test("provider schema can be compiled to the Responses structured-output format", () => {
  const format = zodTextFormat(bulkGeometrySchema, "bulk_inventory_geometry");
  assert.equal(format.strict, true);
  assert.equal(format.schema.additionalProperties, false);
  assert.ok(format.schema.required.includes("factorA"));
});

const observation = {
  status: "estimated", depthEvidence: "inferred", visibleMinimum: 35, volumeGeometry: null,
  views: [1, 2, 3].map((image) => ({ image, evidence: "Container rim and pieces visible." })),
  factorA: { low: 40, best: 50, high: 60 }, factorB: { low: 2, best: 3, high: 4 },
  explanation: "Several layers inferred from the outside shape.", assumptions: ["Interior follows exterior."], warnings: [], captureAdvice: [],
};
const combine = (a, b) => combineBulkGeometry({ observations: [a, b], imageCount: 3, language: "de", model: "test" });

test("calculates hidden layers from factors and preserves the full uncertainty envelope", () => {
  assert.deepEqual(calculateBulkGeometry(observation, 3), { count: 150, lowerBound: 80, upperBound: 240 });
  const one = { low: 1, best: 1, high: 1 };
  const volume = { ...observation, factorA: null, factorB: null, volumeGeometry: { lengthInItemLengths: { low: 180, best: 220, high: 300 }, widthInItemWidths: one, depthInItemHeights: one, containerVolumeFraction: one, itemShapeFraction: one, outerEnvelopePacking: { low: 0.6, best: 0.8, high: 1 } } };
  const result = combine(observation, volume);
  assert.deepEqual(result.estimate, { count: 163, lowerBound: 80, upperBound: 300 });
  assert.equal(result.analysis.methods.length, 2);
  assert.equal(result.analysis.agreement, "overlap");
  assert.ok(result.warnings.length > 0);
});

test("rejects invented view coverage, impossible factors and counts below visible pieces", () => {
  for (const change of [
    { views: [observation.views[0], observation.views[0], observation.views[1]] },
    { views: [...observation.views.slice(0, 2), { image: 4, evidence: "Invalid view" }] },
    { factorA: { low: 60, best: 50, high: 40 } },
    { factorA: { low: 10, best: 10, high: 10 }, factorB: { low: 4, best: 4, high: 4 } },
    { visibleMinimum: 160 },
    { factorA: { low: 100_000, best: 400_000, high: 900_000 } },
  ]) assert.throws(() => calculateBulkGeometry({ ...observation, ...change }, 3));
});

test("volume ratios are multiplied locally and item-shape division reverses uncertainty bounds", () => {
  const volume = { ...observation, factorA: null, factorB: null, volumeGeometry: {
    lengthInItemLengths: { low: 10, best: 20, high: 30 },
    widthInItemWidths: { low: 4, best: 5, high: 6 },
    depthInItemHeights: { low: 2, best: 3, high: 4 },
    containerVolumeFraction: { low: 0.7, best: 0.8, high: 0.9 },
    itemShapeFraction: { low: 0.4, best: 0.5, high: 0.6 },
    outerEnvelopePacking: { low: 0.5, best: 0.6, high: 0.7 },
  } };
  assert.deepEqual(calculateBulkGeometry(volume, 3, "volume"), { count: 288, lowerBound: 46, upperBound: 1134 });
  assert.throws(() => calculateBulkGeometry(volume, 3, "layers"));
  assert.throws(() => calculateBulkGeometry({ ...volume, volumeGeometry: { ...volume.volumeGeometry, itemShapeFraction: { low: 0.5, best: 1, high: 2 } } }, 3, "volume"));
});

test("unknown depth and conflicting empty or highly divergent estimates cannot be applied", () => {
  for (const other of [
    { ...observation, depthEvidence: "unconstrained" },
    { ...observation, status: "insufficient", factorA: null, factorB: null },
    { ...observation, factorB: { low: 9, best: 10, high: 12 } },
    { ...observation, status: "empty", depthEvidence: "observed", visibleMinimum: 0, factorA: null, factorB: null },
  ]) {
    const result = combine(observation, other);
    assert.equal(result.estimate, null);
    assert.equal(result.visibility, "unclear");
    assert.ok(result.captureAdvice.length);
  }
});

test("only two agreeing empty-interior observations yield zero", () => {
  const empty = { ...observation, status: "empty", depthEvidence: "observed", visibleMinimum: 0, factorA: null, factorB: null };
  assert.deepEqual(combine(empty, empty).estimate, { count: 0, lowerBound: 0, upperBound: 0 });
  assert.equal(combine({ ...empty, depthEvidence: "inferred" }, empty).estimate, null);
});
