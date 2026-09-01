import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { manualStockMovementSchema } from "../lib/stock-movement-contract.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("manual movement corrections reject system-managed transfers", () => {
  assert.equal(
    manualStockMovementSchema.safeParse({
      delta: 3,
      quantity: 3,
      type: "receipt",
      occurredAt: "2026-09-02T10:00:00.000Z",
    }).success,
    true,
  );
  assert.equal(
    manualStockMovementSchema.safeParse({
      delta: 0,
      quantity: 3,
      type: "transfer",
      fromLocationResourceId: "11111111-1111-4111-8111-111111111111",
      toLocationResourceId: "22222222-2222-4222-8222-222222222222",
    }).success,
    false,
  );
});

test("movement history exposes protected update and delete operations", async () => {
  const [route, stock, component] = await Promise.all([
    source(
      "app/api/v1/resources/[id]/stock/movements/[movementId]/route.ts",
    ),
    source("lib/stock.ts"),
    source("components/resource-stock-manager.tsx"),
  ]);

  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(stock, /assertManualMovementEditable/);
  assert.match(stock, /validateCorrectedStockQuantity/);
  assert.match(component, /resource\.movements\.edit/);
  assert.match(component, /resource\.movements\.delete/);
});

test("stock page places booking first and locations last", async () => {
  const component = await source("components/resource-stock-manager.tsx");
  const booking = component.indexOf('title={t("resource.booking.title")}');
  const metrics = component.indexOf('t("resource.metrics.available")', booking);
  const history = component.indexOf('title={t("resource.movements.title")}');
  const locations = component.lastIndexOf("<StockLocationsManager");

  assert.ok(booking >= 0 && booking < metrics);
  assert.ok(metrics < history);
  assert.ok(history < locations);
});
