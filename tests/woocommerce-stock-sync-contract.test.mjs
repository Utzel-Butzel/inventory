import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import {
  WOO_COMMERCE_STOCK_ACTIVE_ORDER_STATUSES,
  computeWooCommerceLineTargets,
  parseWooCommerceMoneyToCents,
  verifyWooCommerceWebhookSignature,
  wooCommerceCustomerIdentity,
  wooCommerceManualSyncSchema,
  wooCommerceMovementIdempotencyKey,
  wooCommerceOrderSchema,
  wooCommerceProjectedSalesStatus,
  wooCommerceRecentImportWindow,
  wooCommerceRefundSchema,
  wooCommerceSyncPatchSchema,
} from "../lib/woocommerce-sync-contract.ts";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const order = (status = "processing") =>
  wooCommerceOrderSchema.parse({
    id: 4815,
    number: "4815",
    status,
    date_modified_gmt: "2026-09-02T10:20:30",
    line_items: [
      {
        id: 91,
        product_id: 70,
        variation_id: 72,
        quantity: 3,
        sku: "SHIRT-BLUE-M",
      },
    ],
  });

test("stock-bearing order states are explicit and stable", () => {
  assert.deepEqual([...WOO_COMMERCE_STOCK_ACTIVE_ORDER_STATUSES], [
    "on-hold",
    "processing",
    "completed",
  ]);
});

test("paid order quantities are reduced by line-level refunds", () => {
  const refund = wooCommerceRefundSchema.parse({
    id: 900,
    line_items: [
      {
        id: 901,
        product_id: 70,
        variation_id: 72,
        quantity: -1,
        sku: "SHIRT-BLUE-M",
        meta_data: [{ key: "_refunded_item_id", value: "91" }],
      },
    ],
  });

  assert.deepEqual(computeWooCommerceLineTargets(order(), [refund]), [
    {
      lineItemId: 91,
      productId: 70,
      variationId: 72,
      sku: "SHIRT-BLUE-M",
      orderedQuantity: 3,
      refundedQuantity: 1,
      targetQuantity: 2,
    },
  ]);
});

test("refund quantities are capped and cancelled orders restore all stock", () => {
  const excessiveRefund = wooCommerceRefundSchema.parse({
    id: 902,
    line_items: [
      {
        id: 903,
        product_id: 70,
        variation_id: 72,
        quantity: -10,
        sku: "SHIRT-BLUE-M",
        meta_data: [],
      },
    ],
  });
  assert.equal(
    computeWooCommerceLineTargets(order(), [excessiveRefund])[0]
      .targetQuantity,
    0,
  );
  assert.equal(
    computeWooCommerceLineTargets(order("cancelled"), [])[0].targetQuantity,
    0,
  );
  assert.equal(
    computeWooCommerceLineTargets(order("failed"), [])[0].targetQuantity,
    0,
  );
});

test("WooCommerce customer identities prefer customer IDs and safely fall back", () => {
  const registered = wooCommerceOrderSchema.parse({
    id: 4815,
    number: "4815",
    status: "processing",
    customer_id: 77,
    billing: { email: " Daniel@example.COM ", first_name: "Daniel" },
    line_items: [],
  });
  assert.deepEqual(wooCommerceCustomerIdentity(registered), {
    customerId: 77,
    email: "daniel@example.com",
    key: "customer:77",
  });

  const guest = wooCommerceOrderSchema.parse({
    id: 4816,
    number: "4816",
    status: "processing",
    billing: { email: "guest@example.com" },
    line_items: [],
  });
  assert.equal(wooCommerceCustomerIdentity(guest).key, "email:guest@example.com");

  const anonymous = wooCommerceOrderSchema.parse({
    id: 4817,
    number: "4817",
    status: "processing",
    billing: { email: "not-an-email" },
    line_items: [],
  });
  assert.equal(wooCommerceCustomerIdentity(anonymous).key, "order:4817");
});

test("WooCommerce monetary values and projected sales states are deterministic", () => {
  assert.equal(parseWooCommerceMoneyToCents("49.95"), 4995);
  assert.equal(parseWooCommerceMoneyToCents("12.345"), 1235);
  assert.equal(parseWooCommerceMoneyToCents("not-money"), null);

  assert.equal(
    wooCommerceProjectedSalesStatus({
      wooStatus: "processing",
      unresolved: false,
      lines: [
        { orderedQuantity: 2, fulfilledQuantity: 2, returnedQuantity: 0 },
      ],
    }),
    "fulfilled",
  );
  assert.equal(
    wooCommerceProjectedSalesStatus({
      wooStatus: "cancelled",
      unresolved: false,
      lines: [
        { orderedQuantity: 2, fulfilledQuantity: 2, returnedQuantity: 2 },
      ],
    }),
    "returned",
  );
  assert.equal(
    wooCommerceProjectedSalesStatus({
      wooStatus: "processing",
      unresolved: true,
      lines: [],
    }),
    "confirmed",
  );
});

test("WooCommerce signatures authenticate the exact raw request bytes", () => {
  const body = '{"id":4815,"status":"processing"}';
  const secret = "wcsync_test_secret";
  const signature = createHmac("sha256", secret)
    .update(body)
    .digest("base64");

  assert.equal(
    verifyWooCommerceWebhookSignature(body, secret, signature),
    true,
  );
  assert.equal(
    verifyWooCommerceWebhookSignature(`${body}\n`, secret, signature),
    false,
  );
  assert.equal(verifyWooCommerceWebhookSignature(body, secret, null), false);
});

test("movement keys are replay-safe and revisions distinguish later state cycles", () => {
  const input = {
    connectionId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    orderId: 4815,
    lineItemId: 91,
    resourceId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
    variantId: null,
    revision: 1,
    targetQuantity: 3,
  };
  const first = wooCommerceMovementIdempotencyKey(input);

  assert.equal(first, wooCommerceMovementIdempotencyKey(input));
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(
    first,
    wooCommerceMovementIdempotencyKey({ ...input, revision: 2 }),
  );
});

test("sync administration payloads are narrow and reject unsafe values", () => {
  assert.equal(
    wooCommerceSyncPatchSchema.safeParse({ syncEnabled: true }).success,
    true,
  );
  assert.equal(
    wooCommerceSyncPatchSchema.safeParse({
      syncEnabled: true,
      callbackUrl: "https://attacker.example",
    }).success,
    false,
  );
  assert.equal(
    wooCommerceManualSyncSchema.safeParse({ orderId: 4815 }).success,
    true,
  );
  assert.equal(
    wooCommerceManualSyncSchema.safeParse({ orderId: -1 }).success,
    false,
  );
  assert.equal(
    wooCommerceManualSyncSchema.safeParse({ window: "last-7-days" }).success,
    true,
  );
  assert.equal(
    wooCommerceManualSyncSchema.safeParse({ window: "last-30-days" }).success,
    false,
  );
  assert.equal(
    wooCommerceManualSyncSchema.safeParse({
      orderId: 4815,
      window: "last-7-days",
    }).success,
    false,
  );
});

test("recent WooCommerce imports use an exact rolling seven-day window", () => {
  assert.deepEqual(
    wooCommerceRecentImportWindow(new Date("2026-09-04T12:00:00.000Z")),
    {
      after: "2026-08-28T12:00:00.000Z",
      before: "2026-09-04T12:00:00.000Z",
    },
  );
});

test("the worker uses canonical Woo data, exact SKU mapping, locks, and idempotent ledgers", async () => {
  const [worker, migration, variants, stock] = await Promise.all([
    source("lib/woocommerce-sync.ts"),
    source("db/migrations/0056_woocommerce_stock_sync.sql"),
    source("lib/resource-variants.ts"),
    source("lib/stock.ts"),
  ]);

  assert.match(worker, /path: `orders\/\$\{orderId\}`/);
  assert.match(worker, /path: `orders\/\$\{orderId\}\/refunds`/);
  assert.match(worker, /eq\(resources\.sku, sku\)/);
  assert.match(worker, /eq\(resourceVariants\.sku, sku\)/);
  assert.match(worker, /\.for\("update"\)/);
  assert.match(worker, /bookStockMovement\(/);
  assert.match(worker, /bookResourceVariantMovement\(/);
  assert.match(worker, /wooCommerceMovementIdempotencyKey/);
  assert.match(worker, /transactionEffect:/);
  assert.match(worker, /path: "orders"/);
  assert.match(worker, /after: window\.after/);
  assert.match(worker, /before: window\.before/);
  assert.match(worker, /dates_are_gmt: true/);
  assert.match(variants, /stockMovementRequests/);
  assert.match(variants, /await transactionEffect\(transaction, movement\)/);
  assert.match(
    stock,
    /await transactionEffect\(transaction, costedMovement \?\? movement\)/,
  );
  assert.match(
    migration,
    /UNIQUE \("organization_id", "connection_id", "order_id"\)/,
  );
  assert.match(migration, /"revision" integer DEFAULT 0 NOT NULL/);
  assert.match(migration, /"applied_quantity" integer DEFAULT 0 NOT NULL/);
});

test("WooCommerce orders project idempotently into contacts and sales orders", async () => {
  const [worker, migration, schema, ordersService] = await Promise.all([
    source("lib/woocommerce-sync.ts"),
    source("db/migrations/0061_woocommerce_sales_orders.sql"),
    source("db/schema.ts"),
    source("lib/orders.ts"),
  ]);

  assert.match(worker, /projectWooCommerceSalesOrder/);
  assert.match(worker, /upsertWooCommerceContact/);
  assert.match(worker, /pg_advisory_xact_lock/);
  assert.match(worker, /wooCommerceCustomerLinks/);
  assert.match(worker, /type: "sale"/);
  assert.match(worker, /localOrderLineId/);
  assert.match(worker, /orderLineId: localLine\.id/);
  assert.match(migration, /CREATE TABLE "woocommerce_customer_links"/);
  assert.match(migration, /ADD COLUMN "local_order_id" uuid/);
  assert.match(migration, /ADD COLUMN "local_order_line_id" uuid/);
  assert.match(migration, /ADD COLUMN "variant_id" uuid/);
  assert.match(
    migration,
    /PRIMARY KEY \("organization_id", "connection_id", "customer_key"\)/,
  );
  assert.match(schema, /export const wooCommerceCustomerLinks/);
  assert.match(ordersService, /coalesce\(\$\{resourceVariants\.sku\}/);
});

test("webhook processing verifies raw-body signatures before parsing JSON", async () => {
  const [route, worker] = await Promise.all([
    source(
      "app/api/v1/integrations/woocommerce/webhook/[connectionId]/route.ts",
    ),
    source("lib/woocommerce-sync.ts"),
  ]);
  const signatureIndex = worker.indexOf(
    "verifyWooCommerceWebhookSignature(",
    worker.indexOf("export async function handleWooCommerceWebhook"),
  );
  const parseIndex = worker.indexOf(
    "JSON.parse(options.rawBody)",
    worker.indexOf("export async function handleWooCommerceWebhook"),
  );

  assert.match(route, /const rawBody = await readLimitedBody\(request\)/);
  assert.match(route, /received > MAX_WEBHOOK_BYTES/);
  assert.match(route, /x-wc-webhook-signature/);
  assert.match(route, /x-wc-webhook-id/);
  assert.ok(signatureIndex > 0 && signatureIndex < parseIndex);
});

test("stock sync registers both order topics and is manageable in the settings UI", async () => {
  const [worker, manager] = await Promise.all([
    source("lib/woocommerce-sync.ts"),
    source("components/woocommerce-connection-manager.tsx"),
  ]);

  assert.match(worker, /\["order\.created", "order\.updated"\]/);
  assert.match(worker, /delivery_url: webhookDeliveryUrl/);
  assert.match(worker, /secret,/);
  assert.match(manager, /method: "PATCH"/);
  assert.match(manager, /integrations\/woocommerce\/sync/);
  assert.match(manager, /retryIssues/);
  assert.match(manager, /last-7-days/);
});

test("OpenAPI declares the public signed callback and admin reconciliation routes", async () => {
  const document = parseYaml(await source("public/openapi.yaml"));
  const callback =
    document.paths["/integrations/woocommerce/webhook/{connectionId}"].post;

  assert.deepEqual(callback.security, []);
  assert.ok(document.paths["/integrations/woocommerce"].patch);
  assert.ok(document.paths["/integrations/woocommerce/sync"].post);
  assert.equal(
    document.components.schemas.WooCommerceConnection.properties.syncEnabled
      .type,
    "boolean",
  );
  assert.equal(
    "encryptedWebhookSecret" in
      document.components.schemas.WooCommerceConnection.properties,
    false,
  );
});
