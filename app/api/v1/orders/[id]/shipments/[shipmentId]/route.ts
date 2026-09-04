import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { shipmentPatchSchema } from "@/lib/shipment-contract";
import {
  shipmentHttpError,
  updateOrderShipment,
} from "@/lib/shipments";

type Context = { params: Promise<{ id: string; shipmentId: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const { id, shipmentId } = await context.params;
  const uuid = z.string().uuid();
  if (!uuid.safeParse(id).success || !uuid.safeParse(shipmentId).success) {
    return Response.json(
      { error: "Invalid order or shipment id." },
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
  const parsed = shipmentPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid shipment update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const shipment = await updateOrderShipment(
      authorization.identity.organizationId,
      id,
      shipmentId,
      parsed.data,
      authorization.identity.subject,
    );
    return shipment
      ? Response.json({ shipment })
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const failure = shipmentHttpError(error, "Unable to update this shipment.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
