import "server-only";

import { and, eq, lte } from "drizzle-orm";

import { aiIdempotencyOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { idempotencyResponseHeaders } from "@/lib/idempotency";

export type AiOperationName = "analyze" | "count" | "cover";

type StoredOperation = typeof aiIdempotencyOperations.$inferSelect;
const processingLeaseMs = 10 * 60_000;
// Replicate count jobs can run for up to ten minutes. Never reclaim an
// ambiguous count claim while the original paid prediction may still exist.
const countProcessingLeaseMs = 15 * 60_000;

export type AiOperationClaim =
  | { kind: "claimed"; operationId: string }
  | { kind: "processing"; operation: StoredOperation }
  | { kind: "replay"; operation: StoredOperation }
  | { kind: "conflict" };

export const findAiOperation = async (
  operation: AiOperationName,
  idempotencyKey: string,
) => {
  const [existing] = await db
    .select()
    .from(aiIdempotencyOperations)
    .where(
      and(
        eq(aiIdempotencyOperations.operation, operation),
        eq(aiIdempotencyOperations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return existing ?? null;
};

const classifyExisting = (
  existing: StoredOperation,
  options: { resourceId: string; requestHash: string },
): AiOperationClaim => {
  if (
    existing.resourceId !== options.resourceId ||
    existing.requestHash !== options.requestHash
  ) {
    return { kind: "conflict" };
  }
  if (existing.response && existing.responseStatus !== null) {
    return { kind: "replay", operation: existing };
  }
  return { kind: "processing", operation: existing };
};

const reclaimStaleOperation = async (
  existing: StoredOperation,
  options: { resourceId: string; requestHash: string },
) => {
  const leaseMilliseconds =
    existing.operation === "count"
      ? countProcessingLeaseMs
      : processingLeaseMs;
  const staleBefore = new Date(Date.now() - leaseMilliseconds);
  if (
    existing.status !== "processing" ||
    existing.resourceId !== options.resourceId ||
    existing.requestHash !== options.requestHash ||
    existing.updatedAt > staleBefore
  ) {
    return null;
  }
  const [reclaimed] = await db
    .update(aiIdempotencyOperations)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(aiIdempotencyOperations.id, existing.id),
        eq(aiIdempotencyOperations.status, "processing"),
        // Compare against a server-side cutoff instead of round-tripping the
        // original timestamp through JavaScript milliseconds. PostgreSQL's
        // default timestamp has microsecond precision, so exact equality can
        // otherwise make a genuinely stale claim impossible to reclaim.
        lte(aiIdempotencyOperations.updatedAt, staleBefore),
      ),
    )
    .returning({ id: aiIdempotencyOperations.id });
  return reclaimed?.id ?? null;
};

export async function claimAiOperation(options: {
  operation: AiOperationName;
  idempotencyKey: string;
  resourceId: string;
  requestHash: string;
}): Promise<AiOperationClaim> {
  // A transient preflight failure may release a just-won claim while a racing
  // requester is resolving the unique-key conflict. Retry that narrow case so
  // a now-free idempotency key is claimable instead of returning a false 409.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await findAiOperation(
      options.operation,
      options.idempotencyKey,
    );
    if (existing) {
      const reclaimedId = await reclaimStaleOperation(existing, options);
      return reclaimedId
        ? { kind: "claimed", operationId: reclaimedId }
        : classifyExisting(existing, options);
    }

    const [claimed] = await db
      .insert(aiIdempotencyOperations)
      .values({
        operation: options.operation,
        idempotencyKey: options.idempotencyKey,
        resourceId: options.resourceId,
        requestHash: options.requestHash,
      })
      .onConflictDoNothing({
        target: [
          aiIdempotencyOperations.operation,
          aiIdempotencyOperations.idempotencyKey,
        ],
      })
      .returning({ id: aiIdempotencyOperations.id });
    if (claimed) return { kind: "claimed", operationId: claimed.id };

    const winner = await findAiOperation(
      options.operation,
      options.idempotencyKey,
    );
    if (winner) return classifyExisting(winner, options);
  }
  return { kind: "conflict" };
}

const jsonSnapshot = (body: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

export const aiOperationResponseValues = (options: {
  body: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
}) => ({
  status: options.status >= 400 ? ("failed" as const) : ("completed" as const),
  responseStatus: options.status,
  response: jsonSnapshot(options.body),
  responseHeaders: options.headers ?? {},
  updatedAt: new Date(),
});

export async function finishAiOperation(options: {
  operationId: string;
  body: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
}) {
  await db
    .update(aiIdempotencyOperations)
    .set(aiOperationResponseValues(options))
    .where(eq(aiIdempotencyOperations.id, options.operationId));
}

/**
 * Release a newly claimed operation when no provider call was attempted.
 * Transient preflight failures such as rate limiting must remain retryable with
 * the same idempotency key after the condition clears.
 */
export async function releaseAiOperation(operationId: string) {
  await db
    .delete(aiIdempotencyOperations)
    .where(
      and(
        eq(aiIdempotencyOperations.id, operationId),
        eq(aiIdempotencyOperations.status, "processing"),
      ),
    );
}

export function respondToAiOperationClaim(
  claim: Exclude<AiOperationClaim, { kind: "claimed" }>,
  idempotencyKey: string,
) {
  if (claim.kind === "conflict") {
    return Response.json(
      { error: "That Idempotency-Key was already used for another resource or payload." },
      { status: 409 },
    );
  }
  if (claim.kind === "processing") {
    return Response.json(
      { operation: { status: "processing" } },
      {
        status: 202,
        headers: {
          ...idempotencyResponseHeaders(idempotencyKey, true),
          "Retry-After": "2",
        },
      },
    );
  }
  return Response.json(claim.operation.response, {
    status: claim.operation.responseStatus!,
    headers: {
      ...claim.operation.responseHeaders,
      ...idempotencyResponseHeaders(idempotencyKey, true),
    },
  });
}

export function respondToFinishedAiOperation(options: {
  body: Record<string, unknown>;
  status: number;
  idempotencyKey: string | null;
  headers?: Record<string, string>;
}) {
  return Response.json(options.body, {
    status: options.status,
    headers: options.idempotencyKey
      ? {
          ...options.headers,
          ...idempotencyResponseHeaders(options.idempotencyKey, false),
        }
      : options.headers,
  });
}
