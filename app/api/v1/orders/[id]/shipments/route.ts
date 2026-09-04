import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { shipmentCreateSchema } from "@/lib/shipment-contract";
import {
  createOrderShipment,
  listOrderShipments,
  shipmentHttpError,
} from "@/lib/shipments";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid order id." }, { status: 422 });
  }
  try {
    return Response.json({
      shipments: await listOrderShipments(
        authorization.identity.organizationId,
        id,
      ),
    });
  } catch (error) {
    const failure = shipmentHttpError(error, "Unable to load shipments.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for a shipment." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid order id." }, { status: 422 });
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
  const parsed = shipmentCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid shipment.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const result = await createOrderShipment(
      authorization.identity.organizationId,
      id,
      parsed.data,
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          orderId: id,
          shipment: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = shipmentHttpError(error, "Unable to create this shipment.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
