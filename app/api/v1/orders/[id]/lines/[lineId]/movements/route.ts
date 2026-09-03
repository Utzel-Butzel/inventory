import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { orderLineMovementSchema } from "@/lib/order-contract";
import { executeOrderLineMovement, orderHttpError } from "@/lib/orders";

type Context = { params: Promise<{ id: string; lineId: string }> };

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for an order movement." },
      { status: 400 },
    );
  }
  const { id, lineId } = await context.params;
  const uuid = z.string().uuid();
  if (!uuid.safeParse(id).success || !uuid.safeParse(lineId).success) {
    return Response.json(
      { error: "Invalid order or line id." },
      { status: 422 },
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
  const parsed = orderLineMovementSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid order movement.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const result = await executeOrderLineMovement(
      authorization.identity.organizationId,
      id,
      lineId,
      parsed.data,
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          orderId: id,
          lineId,
          movement: parsed.data,
        }),
      },
    );
    return Response.json(result, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = orderHttpError(error, "Unable to apply this order movement.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
