import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  defaultOrderStatus,
  deriveOrderStatus,
  orderCreateSchema,
} from "../lib/order-contract.ts";

const contactId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";

test("all order types have a useful initial workflow state", () => {
  assert.equal(defaultOrderStatus("purchase"), "ordered");
  assert.equal(defaultOrderStatus("sale"), "confirmed");
  assert.equal(defaultOrderStatus("loan"), "reserved");
});

test("loan orders require a due date and can contain several lines", () => {
  const input = {
    type: "loan",
    contactId,
    orderedAt: "2026-09-03T08:00:00.000Z",
    expectedAt: "2026-09-10T08:00:00.000Z",
    lines: [
      { resourceId, quantity: 2 },
      {
        resourceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
        quantity: 1,
      },
    ],
  };
  assert.equal(orderCreateSchema.safeParse(input).success, true);
  assert.equal(
    orderCreateSchema.safeParse({ ...input, expectedAt: null }).success,
    false,
  );
});

test("order statuses are derived from line progress", () => {
  const lines = [
    { orderedQuantity: 2, fulfilledQuantity: 2, returnedQuantity: 0 },
    { orderedQuantity: 1, fulfilledQuantity: 1, returnedQuantity: 0 },
  ];
  assert.equal(deriveOrderStatus("sale", "confirmed", lines), "fulfilled");
  assert.equal(deriveOrderStatus("loan", "reserved", lines), "issued");
  assert.equal(
    deriveOrderStatus("loan", "issued", [
      { ...lines[0], returnedQuantity: 1 },
      lines[1],
    ]),
    "partially-returned",
  );
  assert.equal(
    deriveOrderStatus(
      "loan",
      "issued",
      lines,
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-03T00:00:00.000Z"),
    ),
    "overdue",
  );
});

test("the migration preserves purchase ids in shared physical tables", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0058_unified_orders.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    migration,
    /ALTER TABLE "purchase_orders" RENAME TO "orders"/,
  );
  assert.match(
    migration,
    /ALTER TABLE "purchase_order_lines" RENAME TO "order_lines"/,
  );
  assert.match(migration, /ADD COLUMN "type" varchar\(16\)/);
  assert.match(migration, /ADD COLUMN "order_line_id" uuid/);
  assert.match(migration, /REFERENCES "contacts" \("organization_id", "id"\)/);

  const legacyContactBackfill = migration.indexOf('UPDATE "orders"');
  const contactNameConstraint = migration.indexOf(
    'ADD CONSTRAINT "orders_contact_name_nonempty"',
  );
  assert.ok(legacyContactBackfill >= 0);
  assert.ok(legacyContactBackfill < contactNameConstraint);
  assert.match(
    migration,
    /WHERE length\(btrim\("contact_name"\)\) = 0/,
  );
});
