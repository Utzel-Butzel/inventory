import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
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
import { stockMovementSchema } from "@/lib/stock-movement-contract";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.read",
    id,
  );
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const beforeValue = url.searchParams.get("before");
  const before = beforeValue ? new Date(beforeValue) : undefined;
  if (!Number.isFinite(limit) || limit < 1 || (before && Number.isNaN(before.getTime()))) {
    return Response.json({ error: "Invalid movement history query." }, { status: 422 });
  }

  try {
    const movements = await listStockMovements(
      authorization.identity.organizationId,
      id,
      { limit, before },
    );
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
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.manage",
    id,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = stockMovementSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid stock movement.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await bookStockMovement(
      authorization.identity.organizationId,
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
