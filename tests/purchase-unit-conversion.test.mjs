import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  baseUnitsToPurchaseUnits,
  hasPurchaseUnit,
  purchaseUnitsToBaseUnits,
} from "../lib/stock-quantity-units.ts";
import {
  bomQuantityFromDisplay,
  bomQuantityToDisplay,
  normalizeBomQuantityUnit,
} from "../lib/bom-quantity-units.ts";

test("purchase units convert to the integer base quantity used by stock", () => {
  assert.equal(purchaseUnitsToBaseUnits(1, 1_000), 1_000);
  assert.equal(purchaseUnitsToBaseUnits(3, 1_000), 3_000);
  assert.equal(baseUnitsToPurchaseUnits(3_000, 1_000), 3);
  assert.equal(baseUnitsToPurchaseUnits(2_500, 1_000), null);
});

test("purchase-unit conversion rejects invalid and overflowing quantities", () => {
  assert.throws(() => purchaseUnitsToBaseUnits(0, 1_000), RangeError);
  assert.throws(() => purchaseUnitsToBaseUnits(1, 0), RangeError);
  assert.throws(
    () => purchaseUnitsToBaseUnits(2_000_001, 1_000),
    RangeError,
  );
});

test("purchase-unit configuration requires a name and positive whole factor", () => {
  assert.equal(
    hasPurchaseUnit({ purchaseUnitName: "Rolle", purchaseUnitFactor: 1_000 }),
    true,
  );
  assert.equal(
    hasPurchaseUnit({ purchaseUnitName: null, purchaseUnitFactor: null }),
    false,
  );
  assert.equal(
    hasPurchaseUnit({ purchaseUnitName: "Rolle", purchaseUnitFactor: null }),
    false,
  );
});

test("BOM quantities persist base stock units while displaying packaging units", () => {
  const filament = {
    unitName: "Gramm",
    purchaseUnitName: "Rolle",
    purchaseUnitFactor: 1_000,
  };

  assert.equal(bomQuantityFromDisplay(1, "purchase", filament), 1_000);
  assert.equal(bomQuantityToDisplay(1_000, "purchase", filament), 1);
  assert.equal(normalizeBomQuantityUnit(1_000, "purchase", filament), "purchase");
  assert.equal(normalizeBomQuantityUnit(20, "purchase", filament), "base");
  assert.equal(bomQuantityFromDisplay(20, "base", filament), 20);
});

test("BOM quantity-unit migration and editors persist the selected unit", async () => {
  const [migration, route, connectionEditor, assemblyManager] = await Promise.all([
    readFile(
      new URL("../db/migrations/0053_bom_quantity_units.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/v1/resources/[id]/bom/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/resource-connection-editor-panel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/assembly-manager.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(migration, /bom_lines[\s\S]*quantity_unit/);
  assert.match(migration, /variant_bom_overrides[\s\S]*quantity_unit/);
  assert.match(route, /quantityUnit: z\.enum\(\["base", "purchase"\]\)/);
  assert.match(connectionEditor, /availableBomQuantityUnits/);
  assert.match(assemblyManager, /bomQuantityFromDisplay/);
});

test("migration and APIs persist a snapshotted order-line conversion", async () => {
  const [migration, orderRoute, receiptRoute] = await Promise.all([
    readFile(new URL("../db/migrations/0051_purchase_units.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/purchase-orders/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/api/v1/purchase-orders/[id]/lines/[lineId]/receipts/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(migration, /stock_settings[\s\S]*purchase_unit_name/);
  assert.match(migration, /purchase_order_lines[\s\S]*purchase_unit_factor/);
  assert.match(orderRoute, /purchaseQuantity/);
  assert.match(receiptRoute, /purchaseQuantity/);
});
