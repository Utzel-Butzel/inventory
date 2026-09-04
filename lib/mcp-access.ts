import "server-only";

import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";

import { mcpAuditEvents, mcpRateLimitBuckets } from "@/db/schema";
import { hashRequestIdentity, type RequestIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { hashIdempotentPayload } from "@/lib/idempotency";
import {
  mcpRateLimitPerMinute,
  type InventoryMcpToolName,
  type InventoryMcpOperation,
  type McpRateLimitOperation,
} from "@/lib/mcp-contract";

const RATE_WINDOW_MS = 60_000;

export class McpAccessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "McpAccessError";
  }
}

export async function enforceMcpRateLimit(
  identity: RequestIdentity,
  operation: McpRateLimitOperation,
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RATE_WINDOW_MS);
  const principalHash = hashRequestIdentity(identity);
  const bucketKey = createHash("sha256")
    .update(principalHash + ":" + operation)
    .digest("hex");
  const [bucket] = await db
    .insert(mcpRateLimitBuckets)
    .values({
      organizationId: identity.organizationId,
      bucketKey,
      principalHash,
      operation,
      windowStartedAt: now,
      expiresAt,
      requestCount: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        mcpRateLimitBuckets.organizationId,
        mcpRateLimitBuckets.bucketKey,
      ],
      set: {
        requestCount: sql`case when ${mcpRateLimitBuckets.expiresAt} <= ${now} then 1 else ${mcpRateLimitBuckets.requestCount} + 1 end`,
        windowStartedAt: sql`case when ${mcpRateLimitBuckets.expiresAt} <= ${now} then ${now} else ${mcpRateLimitBuckets.windowStartedAt} end`,
        expiresAt: sql`case when ${mcpRateLimitBuckets.expiresAt} <= ${now} then ${expiresAt} else ${mcpRateLimitBuckets.expiresAt} end`,
        updatedAt: now,
      },
    })
    .returning({
      requestCount: mcpRateLimitBuckets.requestCount,
      expiresAt: mcpRateLimitBuckets.expiresAt,
    });

  const limit = mcpRateLimitPerMinute(operation);
  if (bucket && bucket.requestCount > limit) {
    throw new McpAccessError(
      `Rate limit exceeded. Retry in ${Math.max(
        1,
        Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1_000),
      )} seconds.`,
      "rate_limited",
      Math.max(0, bucket.expiresAt.getTime() - now.getTime()),
    );
  }
}

export async function recordMcpAuditEvent(options: {
  identity: RequestIdentity;
  requestId: string;
  toolName: InventoryMcpToolName;
  operation: InventoryMcpOperation;
  status: "success" | "error" | "rate_limited";
  arguments: unknown;
  targetIds?: string[];
  durationMs: number;
  errorCode?: string;
}) {
  const auditHashSecret =
    process.env.MCP_AUDIT_HASH_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "open-inventory-development-only";
  await db.insert(mcpAuditEvents).values({
    organizationId: options.identity.organizationId,
    requestId: options.requestId,
    tokenId: options.identity.tokenId ?? null,
    userId: options.identity.userId ?? null,
    principalHash: hashRequestIdentity(options.identity),
    toolName: options.toolName,
    operation: options.operation,
    status: options.status,
    argumentsHash: createHmac(
      "sha256",
      auditHashSecret,
    )
      .update(hashIdempotentPayload(options.arguments))
      .digest("hex"),
    targetIds: Array.from(new Set(options.targetIds ?? [])),
    durationMs: Math.max(0, Math.min(2_147_483_647, Math.round(options.durationMs))),
    errorCode: options.errorCode ?? null,
  });
}
