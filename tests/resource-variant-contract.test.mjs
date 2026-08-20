import assert from "node:assert/strict";
import test from "node:test";

import {
  computeVariantStockSummary,
  nextVariantStockQuantities,
  resourceVariantCreateSchema,
  resourceVariantMovementSchema,
  resourceVariantPatchSchema,
} from "../lib/resource-variant-contract.ts";

test("variant fields stay optional apart from a clear name", () => {
  const parsed = resourceVariantCreateSchema.parse({ name: "  Blue / Large  " });
  assert.deepEqual(parsed, {
    name: "Blue / Large",
    sku: null,
    barcode: null,
    priceCents: null,
    initialAllocation: 0,
  });
});

test("normalizes identifiers and currency without inventing required fields", () => {
  const parsed = resourceVariantCreateSchema.parse({
    name: "Black",
    sku: "  SHIRT-BLK  ",
    barcode: "  4006381333931  ",
    priceCents: 2499,
    currency: "eur",
    initialAllocation: 8,
  });
  assert.equal(parsed.sku, "SHIRT-BLK");
  assert.equal(parsed.barcode, "4006381333931");
  assert.equal(parsed.currency, "EUR");
  assert.equal(parsed.initialAllocation, 8);
});

test("rejects negative prices, fractional allocations and empty names", () => {
  assert.equal(
    resourceVariantCreateSchema.safeParse({ name: "", initialAllocation: 0 })
      .success,
    false,
  );
  assert.equal(
    resourceVariantCreateSchema.safeParse({ name: "Blue", priceCents: -1 })
      .success,
    false,
  );
  assert.equal(
    resourceVariantCreateSchema.safeParse({ name: "Blue", initialAllocation: 1.5 })
      .success,
    false,
  );
});

test("patches never expose quantity as a metadata edit", () => {
  assert.equal(resourceVariantPatchSchema.safeParse({ name: "Large" }).success, true);
  assert.equal(resourceVariantPatchSchema.safeParse({ quantity: 10 }).success, false);
});

test("stock movements require signed non-zero whole quantities", () => {
  assert.equal(
    resourceVariantMovementSchema.safeParse({ delta: 4, type: "receipt" })
      .success,
    true,
  );
  assert.equal(
    resourceVariantMovementSchema.safeParse({ delta: -2, type: "issue" })
      .success,
    true,
  );
  assert.equal(
    resourceVariantMovementSchema.safeParse({ delta: 0, type: "adjustment" })
      .success,
    false,
  );
  assert.equal(
    resourceVariantMovementSchema.safeParse({ delta: -1, type: "receipt" })
      .success,
    false,
  );
});

test("summary exposes the parent/variant conservation invariant", () => {
  assert.deepEqual(computeVariantStockSummary(20, [7, 5]), {
    totalQuantity: 20,
    allocatedQuantity: 12,
    unallocatedQuantity: 8,
    variantCount: 2,
  });
  assert.equal(computeVariantStockSummary(10, [7, 5]).unallocatedQuantity, -2);
});

test("variant bookings derive matching parent and variant balances", () => {
  assert.deepEqual(nextVariantStockQuantities(20, 7, 3), {
    nextParentQuantity: 23,
    nextVariantQuantity: 10,
  });
  assert.deepEqual(nextVariantStockQuantities(20, 7, -4), {
    nextParentQuantity: 16,
    nextVariantQuantity: 3,
  });
  assert.throws(() => nextVariantStockQuantities(20, 2, -3), /negative/);
  assert.deepEqual(nextVariantStockQuantities(2, 2, -3, true), {
    nextParentQuantity: -1,
    nextVariantQuantity: -1,
  });
  assert.deepEqual(nextVariantStockQuantities(-2, -2, 1), {
    nextParentQuantity: -1,
    nextVariantQuantity: -1,
  });
});
