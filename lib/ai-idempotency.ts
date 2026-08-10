import "server-only";

import { and, eq } from "drizzle-orm";

import { aiIdempotencyOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { idempotencyResponseHeaders } from "@/lib/idempotency";

export type AiOperationName = "analyze" | "cover";

type StoredOperation = typeof aiIdempotencyOperations.$inferSelect;

export type AiOperationClaim =
  | { kind: "claimed"; operationId: string }
  | { kind: "processing"; operation: StoredOperation }
  | { kind: "replay"; operation: StoredOperation }
  | { kind: "conflict" };

const findOperation = async (operation: AiOperationName, idempotencyKey: string) => {
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

export async function claimAiOperation(options: {
  operation: AiOperationName;
  idempotencyKey: string;
  resourceId: string;
  requestHash: string;
}): Promise<AiOperationClaim> {
  const existing = await findOperation(options.operation, options.idempotencyKey);
  if (existing) return classifyExisting(existing, options);

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

  const winner = await findOperation(options.operation, options.idempotencyKey);
  return winner ? classifyExisting(winner, options) : { kind: "conflict" };
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
