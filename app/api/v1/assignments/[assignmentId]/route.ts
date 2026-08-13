import { eq } from "drizzle-orm";
import { z } from "zod";

import { inventoryAssignments } from "@/db/schema";
import {
  requireIdentity,
  requireResourcePermission,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  completeInventoryAssignment,
  inventoryAssignmentHttpError,
} from "@/lib/inventory-assignments";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";

type Context = { params: Promise<{ assignmentId: string }> };

const completionSchema = z
  .object({
    status: z.enum(["returned", "cancelled"]),
    completedAt: z.string().datetime().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const authentication = await requireIdentity(request, "write");
  if (authentication.response) return authentication.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "An Idempotency-Key UUID is required to complete an assignment." },
      { status: 400 },
    );
  }
  const assignmentId = z
    .string()
    .uuid()
    .safeParse((await context.params).assignmentId);
  if (!assignmentId.success) {
    return Response.json({ error: "Invalid assignment id." }, { status: 422 });
  }
  const [assignment] = await db
    .select({ resourceId: inventoryAssignments.resourceId })
    .from(inventoryAssignments)
    .where(eq(inventoryAssignments.id, assignmentId.data))
    .limit(1);
  if (!assignment) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }
  const authorization = await requireResourcePermission(
    request,
    "assignments.manage",
    assignment.resourceId,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = completionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid assignment completion.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await completeInventoryAssignment(
      assignmentId.data,
      {
        ...parsed.data,
        completedAt: parsed.data.completedAt
          ? new Date(parsed.data.completedAt)
          : undefined,
      },
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          operation: "inventory-assignment-complete",
          assignmentId: assignmentId.data,
          payload: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: 200,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = inventoryAssignmentHttpError(
      error,
      "Unable to complete this assignment.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
