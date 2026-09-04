import { z } from "zod";

import { stockMovementSchema } from "@/lib/stock-movement-contract";
import { resourceInputSchema, resourcePatchSchema } from "@/lib/validators";

export const MCP_MAX_REQUEST_BYTES = 1_048_576;

export const inventoryMcpToolNames = [
  "get_inventory_context",
  "search_inventory",
  "get_inventory_item",
  "list_inventory_types",
  "get_stock",
  "list_due_inventory_counts",
  "create_inventory_item",
  "update_inventory_item",
  "record_stock_movement",
  "record_inventory_count",
] as const;

export type InventoryMcpToolName = (typeof inventoryMcpToolNames)[number];
export type InventoryMcpOperation = "read" | "write";
export type McpRateLimitOperation = InventoryMcpOperation | "request";

export const inventoryMcpToolOperations = {
  get_inventory_context: "read",
  search_inventory: "read",
  get_inventory_item: "read",
  list_inventory_types: "read",
  get_stock: "read",
  list_due_inventory_counts: "read",
  create_inventory_item: "write",
  update_inventory_item: "write",
  record_stock_movement: "write",
  record_inventory_count: "write",
} as const satisfies Record<InventoryMcpToolName, InventoryMcpOperation>;

const idempotencyKeySchema = z
  .string()
  .uuid()
  .describe("A new UUID for this logical write. Reuse it only when retrying the same write.");

const resourceIdSchema = z.string().uuid().describe("Inventory item UUID.");
const confirmationSchema = z
  .literal(true)
  .describe("Set to true only after the user has confirmed this inventory write.");

export const mcpEmptyInputSchema = z.object({}).strict();

export const mcpSearchInventoryInputSchema = z
  .object({
    query: z.string().trim().min(1).max(240).optional(),
    type: z.string().trim().min(1).max(64).optional(),
    status: z.enum(["available", "in-use", "maintenance", "archived"]).optional(),
    page: z.number().int().min(1).max(10_000).optional().default(1),
    pageSize: z.number().int().min(1).max(50).optional().default(25),
  })
  .strict();

export const mcpGetInventoryItemInputSchema = z
  .object({ resourceId: resourceIdSchema })
  .strict();

export const mcpGetStockInputSchema = z
  .object({ resourceId: resourceIdSchema })
  .strict();

// Spatial data is deliberately excluded from the first MCP release. It has a
// separate permission and can implicitly change containment relationships.
export const mcpCreateInventoryItemInputSchema = resourceInputSchema
  .omit({
    gpsLatitude: true,
    gpsLongitude: true,
    gpsAltitude: true,
    mapFeatures: true,
  })
  .strict()
  .extend({
    idempotencyKey: idempotencyKeySchema,
    confirm: confirmationSchema,
  });

// Quantity changes must remain dated stock movements. Spatial fields are kept
// out for the same reason as on create.
export const mcpUpdateInventoryItemInputSchema = resourcePatchSchema
  .omit({
    quantity: true,
    gpsLatitude: true,
    gpsLongitude: true,
    gpsAltitude: true,
    mapFeatures: true,
  })
  .strict()
  .extend({
    resourceId: resourceIdSchema,
    expectedUpdatedAt: z
      .string()
      .datetime()
      .describe("The item's updatedAt value from the most recent read."),
    confirm: confirmationSchema,
  });

export const mcpRecordStockMovementInputSchema = z
  .object({
    resourceId: resourceIdSchema,
    idempotencyKey: idempotencyKeySchema,
    confirm: confirmationSchema,
    movement: stockMovementSchema,
  })
  .strict();

export const mcpRecordInventoryCountInputSchema = z
  .object({
    resourceId: resourceIdSchema,
    idempotencyKey: idempotencyKeySchema,
    confirm: confirmationSchema,
    countedQuantity: z.number().int().min(0).max(2_000_000_000),
    locationResourceId: z.string().uuid().nullable().optional(),
    countedAt: z.string().datetime().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict();

export const mcpToolOutputSchema = z
  .object({
    summary: z.string(),
    data: z.unknown(),
  })
  .strict();

export function isMcpEnabled(value = process.env.MCP_ENABLED) {
  return value?.trim().toLowerCase() === "true";
}

export function isMcpOriginAllowed(
  origin: string | null,
  configuredOrigins = process.env.MCP_ALLOWED_ORIGINS,
) {
  if (!origin) return true;
  const allowed = (configuredOrigins ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

export function isMcpHostAllowed(
  host: string | null,
  configuredHosts = process.env.MCP_ALLOWED_HOSTS,
  applicationUrl = process.env.AUTH_URL,
) {
  if (!host) return false;
  const configured = (configuredHosts ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return configured.includes(host.toLowerCase());
  if (!applicationUrl) return process.env.NODE_ENV !== "production";
  try {
    return new URL(applicationUrl).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function mcpRateLimitPerMinute(
  operation: McpRateLimitOperation,
  configuredValue =
    operation === "request"
      ? process.env.MCP_REQUEST_RATE_LIMIT_PER_MINUTE
      : operation === "read"
      ? process.env.MCP_READ_RATE_LIMIT_PER_MINUTE
      : process.env.MCP_WRITE_RATE_LIMIT_PER_MINUTE,
) {
  const fallback = operation === "request" ? 240 : operation === "read" ? 120 : 30;
  const parsed = Number(configuredValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    return fallback;
  }
  return parsed;
}
