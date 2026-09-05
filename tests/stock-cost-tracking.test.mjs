import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { splitCents } from "../lib/stock-costing.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("splits a total price across units without losing cents", () => {
  assert.deepEqual(splitCents(1_000, 3), [334, 333, 333]);
  assert.deepEqual(splitCents(2, 4), [1, 1, 0, 0]);
  assert.deepEqual(splitCents(null, 2), [null, null]);
});

test("persists transaction prices and FIFO inventory cost layers", async () => {
  const [schema, migration, stock, costing] = await Promise.all([
    source("db/schema.ts"),
    source("db/migrations/0043_stock_cost_tracking.sql"),
    source("lib/stock.ts"),
    source("lib/stock-costing.ts"),
  ]);

  assert.match(schema, /export const stockCostLayers = pgTable/);
  assert.match(schema, /export const stockCostAllocations = pgTable/);
  assert.match(schema, /totalPriceCents: integer\("total_price_cents"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "stock_cost_layers"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "stock_cost_allocations"/);
  assert.match(stock, /addInboundStockCost\(transaction/);
  assert.match(stock, /consumeStockCost\(transaction/);
  assert.match(costing, /orderBy\([\s\S]*stockCostLayers\.occurredAt/);
  assert.match(costing, /stockCostAllocations/);
});

test("purchase receipts and assemblies retain their actual material costs", async () => {
  const [orders, assemblies, stockUi, orderUi, assemblyUi] = await Promise.all([
    source("lib/purchase-orders.ts"),
    source("lib/assemblies.ts"),
    Promise.all([
      source("components/resource-stock/booking.tsx"),
      source("components/resource-stock/units.tsx"),
    ]).then((parts) => parts.join("\n")),
    source("components/purchase-orders-manager.tsx"),
    source("components/assembly-manager.tsx"),
  ]);

  assert.match(
    orders,
    /line\.unitPriceCents \*[\s\S]*input\.purchaseQuantity \?\? receiptQuantity/,
  );
  assert.match(orders, /addInboundStockCost\(transaction/);
  assert.match(assemblies, /consumeStockCost\(transaction/);
  assert.match(assemblies, /materialCosts/);
  assert.match(assemblies, /unpricedComponentQuantity/);
  assert.match(stockUi, /resource\.booking\.inboundPrice/);
  assert.match(stockUi, /resource\.booking\.outboundPrice/);
  assert.match(stockUi, /resource\.units\.transactionPrice/);
  assert.match(orderUi, /unitPrice/);
  assert.match(orderUi, /orders\.receipt\.totalPrice/);
  assert.match(assemblyUi, /materialCost/);
});
