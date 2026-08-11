import { z } from "zod";

import { assignmentKinds } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import {
  createInventoryAssignment,
  inventoryAssignmentHttpError,
  listInventoryAssignments,
} from "@/lib/inventory-assignments";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";

type Context = { params: Promise<{ id: string }> };

const recipientSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string().uuid() }).strict(),
  z
    .object({ type: z.literal("resource"), resourceId: z.string().uuid() })
    .strict(),
  z
    .object({ type: z.literal("label"), label: z.string().trim().min(1).max(240) })
    .strict(),
]);

const createSchema = z
  .object({
    kind: z.enum(assignmentKinds),
    quantity: z.number().int().min(1).max(2_000_000_000).default(1),
    stockUnitId: z.string().uuid().nullable().optional(),
    recipient: recipientSchema,
    startsAt: z.string().datetime().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.startsAt &&
      value.dueAt &&
      new Date(value.dueAt) < new Date(value.startsAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "The due date cannot be before the assignment start.",
      });
    }
  });

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  try {
    const result = await listInventoryAssignments(id.data);
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Unable to load assignments." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "An Idempotency-Key UUID is required for stock assignments." },
      { status: 400 },
    );
  }
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid assignment.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await createInventoryAssignment(
      id.data,
      {
        ...parsed.data,
        startsAt: parsed.data.startsAt
          ? new Date(parsed.data.startsAt)
          : undefined,
        dueAt:
          parsed.data.dueAt === undefined
            ? undefined
            : parsed.data.dueAt === null
              ? null
              : new Date(parsed.data.dueAt),
      },
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          operation: "inventory-assignment-create",
          resourceId: id.data,
          payload: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = inventoryAssignmentHttpError(
      error,
      "Unable to create this assignment.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
