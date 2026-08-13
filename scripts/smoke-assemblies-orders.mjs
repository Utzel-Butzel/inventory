import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  for (const envFile of [".env.local", ".env"]) {
    if (!existsSync(envFile)) continue;
    process.loadEnvFile(envFile);
    if (process.env.DATABASE_URL) break;
  }
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://inventory:inventory@localhost:5432/inventory";
const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const organizationId =
  process.env.SMOKE_ORGANIZATION_ID ??
  "00000000-0000-4000-8000-000000000001";
const sql = postgres(databaseUrl, { max: 1 });
const resourceIds = [];
const orderIds = [];
let tokenId = null;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const token = `inv_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-ID": organizationId,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}: ${payload?.error ?? text}`,
    );
  }
  return { payload, status: response.status };
}

async function createResource(runId, suffix, quantity) {
  const result = await api("/api/v1/resources", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      name: `Smoke ${suffix} ${runId}`,
      sku: `SMOKE-${runId}-${suffix.toUpperCase()}`,
      quantity,
      location: "Smoke test bench",
      notes: "Temporary end-to-end verification record",
    },
  });
  const id = result.payload?.resource?.id;
  assert(typeof id === "string", `Creating ${suffix} returned no resource id.`);
  resourceIds.push(id);
  return id;
}

async function cleanup() {
  for (const orderId of orderIds) {
    await sql`
      DELETE FROM purchase_receipts AS receipt
      USING purchase_order_lines AS line
      WHERE receipt.purchase_order_line_id = line.id
        AND line.purchase_order_id = ${orderId}
    `;
    await sql`DELETE FROM purchase_orders WHERE id = ${orderId}`;
  }
  for (const resourceId of resourceIds) {
    await sql`
      DELETE FROM assembly_builds
      WHERE assembly_resource_id = ${resourceId}
    `;
  }
  for (const resourceId of resourceIds) {
    await sql`
      DELETE FROM bom_lines
      WHERE assembly_resource_id = ${resourceId}
         OR component_resource_id = ${resourceId}
    `;
  }
  for (const resourceId of resourceIds) {
    await sql`
      DELETE FROM resource_creation_requests
      WHERE resource_id = ${resourceId}
    `;
    await sql`DELETE FROM resources WHERE id = ${resourceId}`;
  }
  if (tokenId) await sql`DELETE FROM api_tokens WHERE id = ${tokenId}`;

  for (const orderId of orderIds) {
    const [row] = await sql`
      SELECT count(*)::int AS count FROM purchase_orders WHERE id = ${orderId}
    `;
    assert(row.count === 0, `Cleanup left purchase order ${orderId}.`);
  }
  for (const resourceId of resourceIds) {
    const [row] = await sql`
      SELECT count(*)::int AS count FROM resources WHERE id = ${resourceId}
    `;
    assert(row.count === 0, `Cleanup left resource ${resourceId}.`);
  }
  if (tokenId) {
    const [row] = await sql`
      SELECT count(*)::int AS count FROM api_tokens WHERE id = ${tokenId}
    `;
    assert(row.count === 0, `Cleanup left API token ${tokenId}.`);
  }
}

try {
  const [tokenRow] = await sql`
    INSERT INTO api_tokens (
      organization_id, name, prefix, token_hash, scopes, created_by
    )
    VALUES (
      ${organizationId},
      'Assembly/order smoke test',
      ${`${token.slice(0, 12)}…${token.slice(-4)}`},
      ${tokenHash},
      ARRAY['read', 'write']::text[],
      'smoke-test'
    )
    RETURNING id
  `;
  tokenId = tokenRow.id;

  const runId = randomUUID().slice(0, 8).toUpperCase();
  const frameId = await createResource(runId, "frame", 0);
  const printedPartId = await createResource(runId, "printed", 4);
  const boardId = await createResource(runId, "board", 2);
  const displayId = await createResource(runId, "display", 2);

  await api(`/api/v1/resources/${boardId}/stock/config`, {
    method: "PATCH",
    body: { trackingMode: "serialized", unitName: "board" },
  });

  const bom = await api(`/api/v1/resources/${frameId}/bom`, {
    method: "PUT",
    body: {
      components: [
        { resourceId: printedPartId, quantityPerAssembly: 2, position: 0 },
        { resourceId: boardId, quantityPerAssembly: 1, position: 1 },
        { resourceId: displayId, quantityPerAssembly: 1, position: 2 },
      ],
    },
  });
  assert(bom.payload.buildableQuantity === 2, "Expected two buildable frames.");

  const buildKey = randomUUID();
  const buildBody = {
    quantity: 1,
    occurredAt: new Date().toISOString(),
    location: "Smoke assembly bench",
    note: "End-to-end build verification",
  };
  const build = await api(`/api/v1/resources/${frameId}/stock/builds`, {
    method: "POST",
    idempotencyKey: buildKey,
    body: buildBody,
  });
  assert(build.status === 201, "The first build should return 201.");
  const buildReplay = await api(`/api/v1/resources/${frameId}/stock/builds`, {
    method: "POST",
    idempotencyKey: buildKey,
    body: buildBody,
  });
  assert(buildReplay.status === 200, "A build retry should replay with 200.");
  assert(
    buildReplay.payload.build.id === build.payload.build.id,
    "A build retry returned a different build.",
  );

  const [frameStock, printedStock, boardStock, displayStockAfterBuild] =
    await Promise.all([
      api(`/api/v1/resources/${frameId}/stock`),
      api(`/api/v1/resources/${printedPartId}/stock`),
      api(`/api/v1/resources/${boardId}/stock`),
      api(`/api/v1/resources/${displayId}/stock`),
    ]);
  assert(frameStock.payload.resource.quantity === 1, "Finished stock should be one.");
  assert(printedStock.payload.resource.quantity === 2, "Two printed parts should remain.");
  assert(boardStock.payload.resource.quantity === 1, "One board should remain available.");
  assert(displayStockAfterBuild.payload.resource.quantity === 1, "One display should remain.");
  const installedBoard = boardStock.payload.units.find(
    (unit) => unit.status === "in-use" && unit.installation?.buildId === build.payload.build.id,
  );
  assert(installedBoard, "The consumed serialized board is not marked as installed.");

  const orderKey = randomUUID();
  const orderBody = {
    reference: `SMOKE-${runId}`,
    supplier: "Smoke Supplier",
    status: "ordered",
    orderedAt: new Date().toISOString(),
    expectedAt: new Date(Date.now() + 86_400_000).toISOString(),
    lines: [{ resourceId: displayId, orderedQuantity: 5 }],
  };
  const order = await api("/api/v1/purchase-orders", {
    method: "POST",
    idempotencyKey: orderKey,
    body: orderBody,
  });
  assert(order.status === 201, "The first purchase order should return 201.");
  orderIds.push(order.payload.order.id);
  const orderReplay = await api("/api/v1/purchase-orders", {
    method: "POST",
    idempotencyKey: orderKey,
    body: orderBody,
  });
  assert(orderReplay.status === 200, "A purchase-order retry should replay with 200.");
  assert(
    orderReplay.payload.order.id === order.payload.order.id,
    "A purchase-order retry returned a different order.",
  );

  const orderedStock = await api(`/api/v1/resources/${displayId}/stock`);
  assert(orderedStock.payload.resource.quantity === 1, "Ordering must not change on-hand stock.");
  assert(orderedStock.payload.procurement.onOrder === 5, "Five displays should be incoming.");

  const lineId = order.payload.order.lines[0].id;
  const receiptKey = randomUUID();
  const receiptBody = {
    quantity: 2,
    receivedAt: new Date().toISOString(),
    location: "Smoke receiving bench",
  };
  const receiptPath = `/api/v1/purchase-orders/${order.payload.order.id}/lines/${lineId}/receipts`;
  const receipt = await api(receiptPath, {
    method: "POST",
    idempotencyKey: receiptKey,
    body: receiptBody,
  });
  assert(receipt.status === 201, "The first goods receipt should return 201.");
  assert(
    receipt.payload.order.status === "partially-received",
    "The order should be partially received.",
  );
  const receiptReplay = await api(receiptPath, {
    method: "POST",
    idempotencyKey: receiptKey,
    body: receiptBody,
  });
  assert(receiptReplay.status === 200, "A receipt retry should replay with 200.");
  assert(
    receiptReplay.payload.receipt.id === receipt.payload.receipt.id,
    "A receipt retry returned a different receipt.",
  );

  const receivedStock = await api(`/api/v1/resources/${displayId}/stock`);
  assert(receivedStock.payload.resource.quantity === 3, "Two received displays should be on hand.");
  assert(receivedStock.payload.procurement.onOrder === 3, "Three displays should remain incoming.");

  process.stdout.write(
    "Assembly/order smoke test passed: build, installation, incoming stock, partial receipt, and all retries were verified.\n",
  );
} finally {
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
}
