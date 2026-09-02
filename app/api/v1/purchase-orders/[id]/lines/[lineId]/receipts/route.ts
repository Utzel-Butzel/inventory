import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import {
  purchaseOrderHttpError,
  receivePurchaseOrderLine,
} from "@/lib/purchase-orders";

type Context = { params: Promise<{ id: string; lineId: string }> };

const receiptSchema = z
  .object({
    quantity: z.number().int().min(1).max(1_000).optional(),
    purchaseQuantity: z.number().int().min(1).max(1_000_000).optional(),
    receivedAt: z.string().datetime().optional(),
    location: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    totalPriceCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
    priceCurrency: z.string().trim().length(3).toUpperCase().nullable().optional(),
    unitCodes: z
      .array(z.string().trim().min(1).max(180))
      .min(1)
      .max(1_000)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.quantity === undefined) ===
      (value.purchaseQuantity === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Provide either quantity or purchaseQuantity.",
      });
    }
    if ((value.totalPriceCents == null) !== (value.priceCurrency == null)) {
      context.addIssue({
        code: "custom",
        message: "totalPriceCents and priceCurrency must be supplied together.",
      });
    }
    if (
      value.unitCodes &&
      value.quantity !== undefined &&
      value.unitCodes.length !== value.quantity
    ) {
      context.addIssue({
        code: "custom",
        path: ["unitCodes"],
        message: "unitCodes must contain one code for every received unit.",
      });
    }
    if (value.unitCodes && new Set(value.unitCodes).size !== value.unitCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["unitCodes"],
        message: "Received unit codes must be unique within the request.",
      });
    }
  });

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const authorization = await requirePermission(request, "orders.manage");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for a purchase receipt." },
      { status: 400 },
    );
  }
  const { id, lineId } = await context.params;
  const uuidSchema = z.string().uuid();
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(lineId).success) {
    return Response.json(
      { error: "Invalid purchase order or line id." },
      { status: 422 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = receiptSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid purchase receipt.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await receivePurchaseOrderLine(
      authorization.identity.organizationId,
      id,
      lineId,
      {
        ...parsed.data,
        occurredAt: parsed.data.receivedAt
          ? new Date(parsed.data.receivedAt)
          : undefined,
      },
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          purchaseOrderId: id,
          lineId,
          receipt: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = purchaseOrderHttpError(error, "Unable to receive this order line.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
