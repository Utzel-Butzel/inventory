import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  defaultOrderStatus,
  deriveOrderStatus,
  orderCreateSchema,
  orderLineUnitActionSchema,
} from "../lib/order-contract.ts";
import {
  canTransitionShipment,
  defaultTrackingUrl,
  shipmentCreateSchema,
  shipmentPatchSchema,
} from "../lib/shipment-contract.ts";

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
  assert.equal(
    deriveOrderStatus("sale", "fulfilled", [
      { ...lines[0], returnedQuantity: 1 },
      lines[1],
    ]),
    "partially-returned",
  );
  assert.equal(
    deriveOrderStatus("sale", "partially-returned", [
      { ...lines[0], returnedQuantity: 2 },
      { ...lines[1], returnedQuantity: 1 },
    ]),
    "returned",
  );
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

test("serialized unit actions require unique concrete stock units", () => {
  const unitId = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
  assert.equal(
    orderLineUnitActionSchema.safeParse({
      action: "reserve",
      unitIds: [unitId],
    }).success,
    true,
  );
  assert.equal(
    orderLineUnitActionSchema.safeParse({
      action: "issue",
      unitIds: [unitId, unitId],
    }).success,
    false,
  );
  assert.equal(
    orderLineUnitActionSchema.safeParse({
      action: "return",
      unitIds: ["not-a-unit-id"],
    }).success,
    false,
  );
});

test("ready shipments require tracking and unique lines and units", () => {
  const orderLineId = "3f2504e0-4f89-41d3-9a0c-0305e82c3310";
  const unitId = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
  const shipment = {
    carrierCode: "DHL",
    trackingNumber: "00340434161094000000",
    status: "ready",
    lines: [{ orderLineId, quantity: 1, unitIds: [unitId] }],
  };
  const parsed = shipmentCreateSchema.safeParse(shipment);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.carrierCode, "dhl");
  assert.equal(
    shipmentCreateSchema.safeParse({ ...shipment, trackingNumber: null }).success,
    false,
  );
  assert.equal(
    shipmentCreateSchema.safeParse({
      ...shipment,
      lines: [shipment.lines[0], shipment.lines[0]],
    }).success,
    false,
  );
  assert.equal(
    shipmentCreateSchema.safeParse({
      ...shipment,
      lines: [
        shipment.lines[0],
        {
          orderLineId: "3f2504e0-4f89-41d3-9a0c-0305e82c3312",
          quantity: 1,
          unitIds: [unitId],
        },
      ],
    }).success,
    false,
  );
});

test("shipment links are HTTPS and the lifecycle keeps terminal states closed", () => {
  assert.equal(
    defaultTrackingUrl("dhl", "ABC 123"),
    "https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=ABC%20123",
  );
  assert.equal(defaultTrackingUrl("other", "ABC"), null);
  assert.equal(canTransitionShipment("ready", "shipped"), true);
  assert.equal(canTransitionShipment("shipped", "delivered"), true);
  assert.equal(canTransitionShipment("delivered", "returned"), true);
  assert.equal(canTransitionShipment("returned", "ready"), false);
  assert.equal(canTransitionShipment("cancelled", "draft"), false);
  assert.equal(
    shipmentPatchSchema.safeParse({ trackingUrl: "http://carrier.example/ABC" })
      .success,
    false,
  );
  assert.equal(
    shipmentPatchSchema.safeParse({ occurredAt: "2026-09-04T09:00:00.000Z" })
      .success,
    false,
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

test("serialized units have a tenant-safe order-line lifecycle", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0059_order_line_units.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "order_line_units"/);
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "order_line_id"\)[\s\S]*REFERENCES "order_lines" \("organization_id", "id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "stock_unit_id"\)[\s\S]*REFERENCES "stock_units" \("organization_id", "id"\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "order_line_units_active_stock_unit_unique"[\s\S]*WHERE "status" IN \('reserved', 'fulfilled'\)/,
  );
  assert.match(
    migration,
    /"type" = 'sale'[\s\S]*'partially-returned', 'returned'/,
  );

  const openApi = await readFile(
    new URL("../public/openapi.yaml", import.meta.url),
    "utf8",
  );
  assert.match(
    openApi,
    /\/orders\/\{orderId\}\/lines\/\{lineId\}\/units:/,
  );
  assert.match(openApi, /OrderLineUnitActionInput:/);
  assert.match(openApi, /enum: \[reserve, release, issue, return\]/);

  const stockService = await readFile(
    new URL("../lib/stock.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    stockService,
    /eq\(orderLineUnits\.stockUnitId, unit\.id\)[\s\S]*inArray\(orderLineUnits\.status, \["reserved", "fulfilled"\]\)/,
  );

  const resourceService = await readFile(
    new URL("../lib/resources.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    resourceService,
    /update\(orderLineUnits\)[\s\S]*orderLineId: collision\.id/,
  );
});

test("shipments have tenant-safe partial lines, serialized units, and audit history", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0062_order_shipments.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "order_shipments"/);
  assert.match(migration, /CREATE TABLE "order_shipment_lines"/);
  assert.match(migration, /CREATE TABLE "order_shipment_units"/);
  assert.match(migration, /CREATE TABLE "order_shipment_events"/);
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "order_id"\)[\s\S]*REFERENCES "orders" \("organization_id", "id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "order_line_unit_id"\)[\s\S]*REFERENCES "order_line_units" \("organization_id", "id"\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "order_shipments_tracking_unique"[\s\S]*WHERE "tracking_number" IS NOT NULL/,
  );

  const openApi = await readFile(
    new URL("../public/openapi.yaml", import.meta.url),
    "utf8",
  );
  assert.match(openApi, /\/orders\/\{orderId\}\/shipments:/);
  assert.match(openApi, /\/orders\/\{orderId\}\/shipments\/\{shipmentId\}:/);
  assert.match(openApi, /ShipmentStatus:/);
  assert.match(
    openApi,
    /enum: \[draft, ready, shipped, in_transit, delivered, exception, returned, cancelled\]/,
  );
});
