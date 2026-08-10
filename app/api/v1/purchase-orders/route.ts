import { z } from "zod";

import { purchaseOrderStatuses } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  purchaseOrderHttpError,
} from "@/lib/purchase-orders";

const lineSchema = z
  .object({
    resourceId: z.string().uuid(),
    orderedQuantity: z.number().int().min(1).max(2_000_000_000),
    expectedAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict();

const orderCreateSchema = z
  .object({
    reference: z.string().trim().max(160).nullable().optional(),
    supplier: z.string().trim().max(240).optional(),
    status: z.enum(["draft", "ordered"]).optional(),
    orderedAt: z.string().datetime().optional(),
    expectedAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    lines: z.array(lineSchema).min(1).max(100),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status = rawStatus
    ? z.enum(purchaseOrderStatuses).safeParse(rawStatus)
    : null;
  if (status && !status.success) {
    return Response.json({ error: "Invalid purchase order status." }, { status: 422 });
  }
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "limit must be between 1 and 100." }, { status: 422 });
  }

  try {
    return Response.json(
      await listPurchaseOrders({
        status: status?.success ? status.data : undefined,
        limit,
      }),
    );
  } catch (error) {
    const failure = purchaseOrderHttpError(error, "Unable to load purchase orders.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for a purchase order." },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = orderCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid purchase order.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await createPurchaseOrder(
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
        lines: parsed.data.lines.map((line) => ({
          ...line,
          expectedAt:
            line.expectedAt === undefined
              ? undefined
              : line.expectedAt === null
                ? null
                : new Date(line.expectedAt),
        })),
      },
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          purchaseOrder: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = purchaseOrderHttpError(error, "Unable to create this purchase order.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
