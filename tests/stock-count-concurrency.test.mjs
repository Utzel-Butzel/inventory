import assert from "node:assert/strict";
import test from "node:test";
import { bookStockMovement } from "../lib/stock.ts";
import { stockMovementSchema } from "../lib/stock-movement-contract.ts";

test("a stale count is rejected after locking the resource, before any write", async () => {
  let locked = false;
  let reads = 0;
  // Inject the executor: no connection to the application database is made.
  const executor = {
    transaction: async (run) => run({
      select() {
        reads += 1;
        const query = {
          from() { return this; },
          innerJoin() { return this; },
          where() { return this; },
          limit() { return this; },
          for(mode) {
            assert.equal(mode, "update");
            locked = true;
            return Promise.resolve([{ id: "item", quantity: 87, currency: "EUR" }]);
          },
          then(resolve) {
            assert.equal(locked, true);
            resolve([]); // Default bulk stock configuration.
          },
        };
        return query;
      },
    }),
  };
  const input = stockMovementSchema.parse({ delta: -5, expectedQuantity: 89, type: "adjustment" });
  await assert.rejects(
    bookStockMovement("organization", "item", input, "test", undefined, undefined, executor),
    (error) => error.message === "STOCK_COUNT_CONFLICT" && error.status === 409,
  );
  assert.equal(locked, true);
  assert.equal(reads, 2);
});

test("count preconditions accept zero and reject malformed snapshots", () => {
  assert.equal(stockMovementSchema.parse({ delta: 0, expectedQuantity: 0, type: "adjustment" }).expectedQuantity, 0);
  for (const expectedQuantity of [null, "89", 1.5, Infinity]) {
    assert.equal(stockMovementSchema.safeParse({ delta: 0, expectedQuantity, type: "adjustment" }).success, false);
  }
});
