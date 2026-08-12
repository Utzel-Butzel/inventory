import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import type { RequestIdentity } from "@/lib/api-auth";
import {
  paidAiRateLimitPolicy,
  type PaidAiOperation,
} from "@/lib/ai-rate-limit-policy";
import { db } from "@/lib/db";

type RateLimitRow = {
  requestCount: number | string;
  resetsAt: Date | string;
  retryAfterSeconds: number | string;
};

export type PaidAiRateLimitResult = {
  allowed: boolean;
  disabled: boolean;
  limit: number;
  remaining: number;
  resetsAt: Date;
  retryAfterSeconds: number;
};

const subjectHash = (
  identity: Pick<RequestIdentity, "subject" | "userId" | "tokenId">,
) => {
  // Linked browser sessions and API tokens intentionally share the user's
  // budget. Standalone tokens keep their own budget, and no email address is
  // persisted in the limiter table.
  const principal = identity.userId
    ? `user:${identity.userId}`
    : identity.tokenId
      ? `token:${identity.tokenId}`
      : `subject:${identity.subject}`;
  return createHash("sha256").update(principal).digest("hex");
};

/**
 * Atomically consume one paid AI invocation. PostgreSQL is the shared source
 * of truth so the limit applies across processes, replicas, and restarts.
 */
export async function consumePaidAiRateLimit(options: {
  operation: PaidAiOperation;
  identity: Pick<RequestIdentity, "subject" | "userId" | "tokenId">;
}): Promise<PaidAiRateLimitResult> {
  const policy = paidAiRateLimitPolicy(options.operation);

  if (policy.limit === 0) {
    return {
      allowed: false,
      disabled: true,
      limit: 0,
      remaining: 0,
      resetsAt: new Date(0),
      retryAfterSeconds: 0,
    };
  }

  const maximumStoredCount = policy.limit + 1;
  const rows = await db.execute(sql`
    WITH "attempt" AS (
      SELECT clock_timestamp() AS "attempted_at"
    ),
    "upserted" AS (
      INSERT INTO "ai_rate_limit_buckets" (
        "operation",
        "subject_hash",
        "request_count",
        "resets_at",
        "updated_at"
      )
      SELECT
        ${options.operation},
        ${subjectHash(options.identity)},
        1,
        "attempted_at" + (${policy.windowMs} * INTERVAL '1 millisecond'),
        "attempted_at"
      FROM "attempt"
      ON CONFLICT ("operation", "subject_hash")
      DO UPDATE SET
        "request_count" = CASE
          WHEN "ai_rate_limit_buckets"."resets_at" <= EXCLUDED."updated_at"
            THEN 1
          ELSE LEAST(
            "ai_rate_limit_buckets"."request_count" + 1,
            ${maximumStoredCount}
          )
        END,
        "resets_at" = CASE
          WHEN "ai_rate_limit_buckets"."resets_at" <= EXCLUDED."updated_at"
            THEN EXCLUDED."resets_at"
          ELSE "ai_rate_limit_buckets"."resets_at"
        END,
        "updated_at" = EXCLUDED."updated_at"
      RETURNING "request_count", "resets_at", "updated_at"
    )
    SELECT
      "request_count" AS "requestCount",
      "resets_at" AS "resetsAt",
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM ("resets_at" - "updated_at")))
      )::integer AS "retryAfterSeconds"
    FROM "upserted"
  `);
  const row = rows[0] as RateLimitRow | undefined;
  if (!row) throw new Error("The AI rate limiter did not return a bucket.");

  const requestCount = Number(row.requestCount);
  const retryAfterSeconds = Number(row.retryAfterSeconds);
  const resetsAt =
    row.resetsAt instanceof Date ? row.resetsAt : new Date(row.resetsAt);
  if (
    !Number.isSafeInteger(requestCount) ||
    requestCount < 1 ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1 ||
    Number.isNaN(resetsAt.getTime())
  ) {
    throw new Error("The AI rate limiter returned an invalid bucket.");
  }

  return {
    allowed: requestCount <= policy.limit,
    disabled: false,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - requestCount),
    resetsAt,
    retryAfterSeconds,
  };
}

export const paidAiRateLimitHeaders = (
  result: PaidAiRateLimitResult,
): Record<string, string> => {
  if (result.disabled) {
    return {
      "X-RateLimit-Limit": "0",
      "X-RateLimit-Remaining": "0",
    };
  }
  return {
    "Retry-After": String(result.retryAfterSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(
      Math.ceil(result.resetsAt.getTime() / 1_000),
    ),
  };
};
