import assert from "node:assert/strict";
import test from "node:test";

import {
  inventoryCountCoordinateMaximum,
  inventoryCountResultSchema,
} from "../lib/inventory-count-contract.ts";

const baseResult = {
  count: 2,
  confidence: 0.92,
  detectedItem: "washers",
  isExact: true,
  explanation: "Two separate washers are visible.",
  warnings: [],
  markers: [
    { x: 125, y: 250 },
    { x: 875, y: 750 },
  ],
};

test("accepts exactly one in-bounds marker per counted item", () => {
  assert.deepEqual(inventoryCountResultSchema.parse(baseResult), baseResult);
  assert.equal(inventoryCountCoordinateMaximum, 1_000);
});

test("accepts a zero count with no markers", () => {
  const result = { ...baseResult, count: 0, markers: [] };
  assert.deepEqual(inventoryCountResultSchema.parse(result), result);
});

test("rejects a marker count that disagrees with the detected count", () => {
  const parsed = inventoryCountResultSchema.safeParse({
    ...baseResult,
    markers: baseResult.markers.slice(0, 1),
  });
  assert.equal(parsed.success, false);
});

test("rejects marker coordinates outside the normalized image grid", () => {
  const parsed = inventoryCountResultSchema.safeParse({
    ...baseResult,
    markers: [baseResult.markers[0], { x: 1_001, y: 750 }],
  });
  assert.equal(parsed.success, false);
});
