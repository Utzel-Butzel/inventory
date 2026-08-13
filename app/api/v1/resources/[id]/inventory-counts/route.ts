import { z } from "zod";

import {
  requirePermission,
  requireResourcePermission,
} from "@/lib/api-auth";
import { readIdempotencyKey } from "@/lib/idempotency";
import {
  getInventoryCycle,
  recordInventoryCount,
} from "@/lib/inventory-cycles";
import { stockHttpError } from "@/lib/stock";

type Context = { params: Promise<{ id: string }> };

const countSchema = z
  .object({
    countedQuantity: z.number().int().min(0).max(2_000_000_000),
    locationResourceId: z.string().uuid().nullable().optional(),
    countedAt: z.string().datetime().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict();

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "counts.read");
  if (authorization.response) return authorization.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const cycle = await getInventoryCycle(id.data);
  if (!cycle) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ counts: cycle.history });
}

export async function POST(request: Request, context: Context) {
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const authorization = await requireResourcePermission(
    request,
    "counts.manage",
    id.data,
  );
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = countSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory count.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const result = await recordInventoryCount(
      id.data,
      {
        ...parsed.data,
        countedAt: parsed.data.countedAt
          ? new Date(parsed.data.countedAt)
          : undefined,
      },
      authorization.identity.subject,
      idempotency.key ?? undefined,
    );
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const failure = stockHttpError(error, "Unable to record the inventory count.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
