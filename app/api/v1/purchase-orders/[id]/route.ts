import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  getPurchaseOrder,
  purchaseOrderHttpError,
  updatePurchaseOrder,
} from "@/lib/purchase-orders";

type Context = { params: Promise<{ id: string }> };

const orderPatchSchema = z
  .object({
    reference: z.string().trim().max(160).nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    supplier: z.string().trim().max(240).optional(),
    status: z.enum(["draft", "ordered", "cancelled"]).optional(),
    orderedAt: z.string().datetime().optional(),
    expectedAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one purchase order change.",
  });

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid purchase order id." }, { status: 422 });
  }

  try {
    const order = await getPurchaseOrder(
      authorization.identity.organizationId,
      id,
    );
    if (!order) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ order });
  } catch (error) {
    const failure = purchaseOrderHttpError(error, "Unable to load this purchase order.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid purchase order id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = orderPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid purchase order update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const order = await updatePurchaseOrder(
      authorization.identity.organizationId,
      id,
      {
        ...parsed.data,
        orderedAt: parsed.data.orderedAt
          ? new Date(parsed.data.orderedAt)
          : undefined,
        expectedAt:
          parsed.data.expectedAt === undefined
            ? undefined
            : parsed.data.expectedAt === null
              ? null
              : new Date(parsed.data.expectedAt),
      },
    );
    if (!order) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ order });
  } catch (error) {
    const failure = purchaseOrderHttpError(error, "Unable to update this purchase order.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
