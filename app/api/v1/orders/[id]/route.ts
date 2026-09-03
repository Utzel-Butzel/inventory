import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { orderPatchSchema } from "@/lib/order-contract";
import { getOrder, orderHttpError, updateOrder } from "@/lib/orders";

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
    const order = await getOrder(authorization.identity.organizationId, id);
    return order
      ? Response.json({ order })
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const failure = orderHttpError(error, "Unable to load this order.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
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
  const parsed = orderPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid order update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const order = await updateOrder(
      authorization.identity.organizationId,
      id,
      parsed.data,
    );
    return order
      ? Response.json({ order })
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const failure = orderHttpError(error, "Unable to update this order.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
