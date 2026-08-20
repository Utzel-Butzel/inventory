import assert from "node:assert/strict";
import test from "node:test";

import { violatesNegativeStockPolicy } from "../lib/negative-stock-policy.ts";

test("negative stock is rejected by default and permitted by organization policy", () => {
  assert.equal(
    violatesNegativeStockPolicy({
      allowNegativeStock: false,
      quantityBefore: 2,
      quantityAfter: -1,
    }),
    true,
  );
  assert.equal(
    violatesNegativeStockPolicy({
      allowNegativeStock: true,
      quantityBefore: 2,
      quantityAfter: -1,
    }),
    false,
  );
});

test("an organization can recover an existing negative balance after disabling the policy", () => {
  assert.equal(
    violatesNegativeStockPolicy({
      allowNegativeStock: false,
      quantityBefore: -5,
      quantityAfter: -2,
    }),
    false,
  );
  assert.equal(
    violatesNegativeStockPolicy({
      allowNegativeStock: false,
      quantityBefore: -5,
      quantityAfter: -6,
    }),
    true,
  );
});
