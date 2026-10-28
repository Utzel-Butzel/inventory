import assert from "node:assert/strict";
import { test } from "node:test";
import { bulk3dInputSchema, bulk3dResultSchema, bulk3dStateSchema } from "../lib/inventory-bulk-3d.ts";

export const input = {
  itemId: "f6387215-fcbf-41de-9a5f-5b132d56d496", language: "en",
  marks: { pile: [[.2,.2],[.8,.2],[.8,.8],[.2,.8]], table: [[.1,.1],[.9,.1],[.1,.9]], edges: [[[.3,.3],[.4,.3]],[[.4,.4],[.5,.4]],[[.5,.5],[.6,.5]]] },
  assumptions: { shape: "cuboid", widthRatio: .8, heightRatio: .8, packing: .6, floorOffset: .6 },
};
test("accepts normalized image measurements without reference counts or physical dimensions", () => {
  assert.deepEqual(bulk3dInputSchema.parse(input), input);
  assert.equal(bulk3dInputSchema.safeParse({ ...input, actualCount: 1513 }).success, false);
});
test("rejects invalid planes, crossed outlines, missing samples and zero-length edges", () => {
  const changes = [
    { table: [[.1,.1],[.2,.1],[.3,.1]] },
    { table: [[.4,.4],[.9,.1],[.1,.9]] },
    { pile: [[.2,.2],[.8,.8],[.8,.2],[.2,.8]] },
    { edges: input.marks.edges.slice(0,2) },
    { edges: [...input.marks.edges.slice(0,2), [[.1,.1],[.2,.1]]] },
    { edges: [...input.marks.edges.slice(0,2), [[.3,.3],[.3,.3]]] },
  ];
  for (const change of changes) assert.equal(bulk3dInputSchema.safeParse({ ...input, marks: { ...input.marks, ...change } }).success, false);
});
test("accepts outlines with separate collinear boundary segments", () => {
  const pile = [[.2,.2],[.4,.2],[.6,.2],[.8,.2],[.8,.8],[.2,.8]];
  assert.equal(bulk3dInputSchema.safeParse({ ...input, marks: { ...input.marks, pile } }).success, true);
});
test("rejects invented accuracy flags, nonfinite results and reversed ranges", () => {
  const result = { method: "bulk_3d", version: "mapanything_manual_v1", model: "facebook/map-anything", isExact: false, accuracyValidated: false, estimate: { count: 650, lowerBound: 100, upperBound: 1600 }, warningCodes: ["hiddenBottom"], imageCount: 4, sampleCount: 8, inferenceSeconds: 12 };
  assert.equal(bulk3dResultSchema.safeParse(result).success, true);
  for (const change of [{ accuracyValidated: true }, { estimate: { count: Infinity, lowerBound: 1, upperBound: 100 } }, { estimate: { count: 650, lowerBound: 700, upperBound: 800 } }]) assert.equal(bulk3dResultSchema.safeParse({ ...result, ...change }).success, false);
  assert.equal(bulk3dStateSchema.safeParse({ status: "completed", result: { ...result, estimate: null, warningCodes: ["geometry"] } }).success, true);
});
