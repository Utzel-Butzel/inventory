import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { orderLineUnitActionSchema } from "@/lib/order-contract";
import {
  executeOrderLineUnitAction,
  listOrderLineUnits,
  orderHttpError,
} from "@/lib/orders";

type Context = { params: Promise<{ id: string; lineId: string }> };

export const dynamic = "force-dynamic";

const readIds = async (context: Context) => {
  const { id, lineId } = await context.params;
  const uuid = z.string().uuid();
  return uuid.safeParse(id).success && uuid.safeParse(lineId).success
    ? { id, lineId }
    : null;
};

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.read");
  if (authorization.response) return authorization.response;
  const ids = await readIds(context);
  if (!ids) {
    return Response.json(
      { error: "Invalid order or line id." },
      { status: 422 },
    );
  }
  try {
    return Response.json(
      await listOrderLineUnits(
        authorization.identity.organizationId,
        ids.id,
        ids.lineId,
      ),
    );
  } catch (error) {
    const failure = orderHttpError(
      error,
      "Unable to load serialized order units.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const ids = await readIds(context);
  if (!ids) {
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
  const parsed = orderLineUnitActionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid serialized unit action.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }
  try {
    return Response.json(
      await executeOrderLineUnitAction(
        authorization.identity.organizationId,
        ids.id,
        ids.lineId,
        parsed.data,
        authorization.identity.subject,
      ),
    );
  } catch (error) {
    const failure = orderHttpError(
      error,
      "Unable to apply the serialized unit action.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
