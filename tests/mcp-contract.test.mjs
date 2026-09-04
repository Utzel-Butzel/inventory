import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  inventoryMcpToolNames,
  inventoryMcpToolOperations,
  isMcpEnabled,
  isMcpHostAllowed,
  isMcpOriginAllowed,
  mcpCreateInventoryItemInputSchema,
  mcpRateLimitPerMinute,
  mcpRecordInventoryCountInputSchema,
  mcpRecordStockMovementInputSchema,
  mcpToolOutputSchema,
  mcpUpdateInventoryItemInputSchema,
} from "../lib/mcp-contract.ts";

const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const idempotencyKey = "d9428888-122b-11e1-b85c-61cd3cbb3210";

test("publishes a small, explicitly classified tool surface", () => {
  assert.equal(inventoryMcpToolNames.length, 10);
  assert.equal(new Set(inventoryMcpToolNames).size, inventoryMcpToolNames.length);
  assert.deepEqual(
    inventoryMcpToolNames.filter(
      (name) => inventoryMcpToolOperations[name] === "write",
    ),
    [
      "create_inventory_item",
      "update_inventory_item",
      "record_stock_movement",
      "record_inventory_count",
    ],
  );
});

test("create requires confirmation and idempotency and rejects spatial input", () => {
  const valid = mcpCreateInventoryItemInputSchema.safeParse({
    name: "Cordless drill",
    idempotencyKey,
    confirm: true,
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.type, "object");
    assert.equal(valid.data.quantity, 1);
  }

  assert.equal(
    mcpCreateInventoryItemInputSchema.safeParse({
      name: "Cordless drill",
      idempotencyKey,
      confirm: false,
    }).success,
    false,
  );
  assert.equal(
    mcpCreateInventoryItemInputSchema.safeParse({
      name: "Cordless drill",
      idempotencyKey,
      confirm: true,
      gpsLatitude: 52.52,
    }).success,
    false,
  );
});

test("update requires optimistic concurrency and cannot mutate quantity", () => {
  assert.equal(
    mcpUpdateInventoryItemInputSchema.safeParse({
      resourceId,
      expectedUpdatedAt: "2026-09-03T12:00:00.000Z",
      confirm: true,
      name: "Updated drill",
    }).success,
    true,
  );
  assert.equal(
    mcpUpdateInventoryItemInputSchema.safeParse({
      resourceId,
      expectedUpdatedAt: "2026-09-03T12:00:00.000Z",
      confirm: true,
      quantity: 5,
    }).success,
    false,
  );
});

test("stock and count writes require confirmation and a UUID idempotency key", () => {
  assert.equal(
    mcpRecordStockMovementInputSchema.safeParse({
      resourceId,
      idempotencyKey,
      confirm: true,
      movement: { delta: -1, type: "issue" },
    }).success,
    true,
  );
  assert.equal(
    mcpRecordStockMovementInputSchema.safeParse({
      resourceId,
      idempotencyKey: "same request",
      confirm: true,
      movement: { delta: -1, type: "issue" },
    }).success,
    false,
  );
  assert.equal(
    mcpRecordInventoryCountInputSchema.safeParse({
      resourceId,
      idempotencyKey,
      confirm: true,
      countedQuantity: 12,
    }).success,
    true,
  );
});

test("MCP is opt-in and browser origins are deny-by-default", () => {
  assert.equal(isMcpEnabled(undefined), false);
  assert.equal(isMcpEnabled("true"), true);
  assert.equal(isMcpEnabled("TRUE"), true);
  assert.equal(isMcpOriginAllowed(null, undefined), true);
  assert.equal(isMcpOriginAllowed("https://agent.example", undefined), false);
  assert.equal(
    isMcpOriginAllowed(
      "https://agent.example",
      "https://other.example, https://agent.example",
    ),
    true,
  );
});

test("host validation defaults to AUTH_URL and rate limits fail safely", () => {
  assert.equal(
    isMcpHostAllowed("inventory.example", undefined, "https://inventory.example"),
    true,
  );
  assert.equal(
    isMcpHostAllowed("attacker.example", undefined, "https://inventory.example"),
    false,
  );
  assert.equal(
    isMcpHostAllowed("internal:3000", "inventory.example,internal:3000", undefined),
    true,
  );
  assert.equal(mcpRateLimitPerMinute("read", "200"), 200);
  assert.equal(mcpRateLimitPerMinute("request", undefined), 240);
  assert.equal(mcpRateLimitPerMinute("read", "0"), 120);
  assert.equal(mcpRateLimitPerMinute("write", "not-a-number"), 30);
});

test("migration stores hashes instead of raw MCP arguments", async () => {
  const migration = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../db/migrations/0060_mcp_access.sql", import.meta.url), "utf8"),
  );
  assert.match(migration, /"arguments_hash" varchar\(64\) NOT NULL/);
  assert.doesNotMatch(migration, /arguments_json|request_body|raw_arguments/i);
  assert.match(migration, /mcp_rate_limit_buckets/);
});

test("the installed MCP SDK publishes the strict input and output contracts", async () => {
  const server = new McpServer({ name: "contract-test", version: "1.0.0" });
  server.registerTool(
    "create_inventory_item",
    {
      inputSchema: mcpCreateInventoryItemInputSchema,
      outputSchema: mcpToolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { summary: "ok", data: {} },
    }),
  );
  const client = new Client({ name: "contract-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "create_inventory_item");
    assert.ok(tool);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.inputSchema.required?.includes("confirm"));
    assert.ok(tool.inputSchema.required?.includes("idempotencyKey"));
    assert.equal(tool.outputSchema?.type, "object");
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});
