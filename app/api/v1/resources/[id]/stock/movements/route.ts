import { z } from "zod";

import { requireIdentity } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import {
  bookStockMovement,
  listStockMovements,
  stockHttpError,
} from "@/lib/stock";

type Context = { params: Promise<{ id: string }> };

const movementSchema = z
  .object({
    delta: z.number().int().min(-2_000_000_000).max(2_000_000_000),
    quantity: z.number().int().min(0).max(2_000_000_000).optional(),
    type: z.enum(["receipt", "issue", "adjustment", "return", "waste", "transfer"]),
    reason: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    location: z.string().trim().max(240).nullable().optional(),
    fromLocationResourceId: z.string().uuid().nullable().optional(),
    toLocationResourceId: z.string().uuid().nullable().optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const structuredTransfer =
      value.type === "transfer" &&
      (value.delta === 0 ||
        Boolean(value.fromLocationResourceId) ||
        Boolean(value.toLocationResourceId));
    if (structuredTransfer && value.quantity === undefined) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "A location transfer requires a quantity.",
      });
    }
    if (structuredTransfer && value.delta !== 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: "A location transfer must keep the global balance unchanged (delta 0).",
      });
    }
    if (["receipt", "return"].includes(value.type) && value.delta <= 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: `${value.type} requires a positive quantity.`,
      });
    }
    if (["issue", "waste"].includes(value.type) && value.delta >= 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: `${value.type} requires a negative quantity.`,
      });
    }
  });

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const beforeValue = url.searchParams.get("before");
  const before = beforeValue ? new Date(beforeValue) : undefined;
  if (!Number.isFinite(limit) || limit < 1 || (before && Number.isNaN(before.getTime()))) {
    return Response.json({ error: "Invalid movement history query." }, { status: 422 });
  }

  try {
    const movements = await listStockMovements(id, { limit, before });
    if (!movements) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ movements });
  } catch {
    return Response.json(
      { error: "Unable to load stock movements." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = movementSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid stock movement.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await bookStockMovement(
      id,
      {
        ...parsed.data,
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt)
          : undefined,
      },
      authorization.identity.subject,
      idempotency.key
        ? {
            key: idempotency.key,
            requestHash: hashIdempotentPayload(parsed.data),
          }
        : undefined,
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotency.key
        ? idempotencyResponseHeaders(idempotency.key, result.replayed)
        : undefined,
    });
  } catch (error) {
    const failure = stockHttpError(error, "Unable to book this stock movement.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
