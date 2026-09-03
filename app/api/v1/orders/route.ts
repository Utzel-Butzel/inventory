import { z } from "zod";

import { orderStatuses } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { orderCreateSchema, orderTypeSchema } from "@/lib/order-contract";
import {
  createOrder,
  listOrders,
  orderHttpError,
} from "@/lib/orders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "orders.read");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const rawType = url.searchParams.get("type");
  const rawStatus = url.searchParams.get("status");
  const type = rawType ? orderTypeSchema.safeParse(rawType) : null;
  const status = rawStatus ? z.enum(orderStatuses).safeParse(rawStatus) : null;
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (
    (type && !type.success) ||
    (status && !status.success) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return Response.json({ error: "Invalid order query." }, { status: 422 });
  }
  try {
    return Response.json(
      await listOrders(authorization.identity.organizationId, {
        type: type?.success ? type.data : undefined,
        status: status?.success ? status.data : undefined,
        limit,
      }),
    );
  } catch (error) {
    const failure = orderHttpError(error, "Unable to load orders.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for an order." },
      { status: 400 },
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = orderCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid order.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const result = await createOrder(
      authorization.identity.organizationId,
      parsed.data,
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          order: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = orderHttpError(error, "Unable to create this order.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
