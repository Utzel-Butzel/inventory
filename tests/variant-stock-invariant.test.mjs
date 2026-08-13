import assert from "node:assert/strict";
import test from "node:test";

import { assertVariantAllocationFits } from "../lib/variant-stock-invariant.ts";

test("allows parent stock equal to or above the variant allocation", () => {
  assert.doesNotThrow(() =>
    assertVariantAllocationFits(8, 8, (message) => new Error(message)),
  );
  assert.doesNotThrow(() =>
    assertVariantAllocationFits(12, 8, (message) => new Error(message)),
  );
});

test("rejects a parent stock update below allocated variant stock", () => {
  assert.throws(
    () => assertVariantAllocationFits(7, 8, (message) => new Error(message)),
    /8 units allocated to variants/,
  );
});
