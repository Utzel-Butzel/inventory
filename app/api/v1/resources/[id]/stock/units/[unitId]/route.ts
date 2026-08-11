import { z } from "zod";

import { stockUnitStatuses } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import { stockHttpError, updateStockUnit } from "@/lib/stock";
import { customFieldValuesInputSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string; unitId: string }> };

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 50_000, {
    message: "Metadata must be 50 KB or smaller.",
  });

const unitPatchSchema = z
  .object({
    status: z.enum(stockUnitStatuses).optional(),
    location: z.string().trim().max(240).nullable().optional(),
    locationResourceId: z.string().uuid().nullable().optional(),
    metadata: metadataSchema.optional(),
    customFields: customFieldValuesInputSchema.optional(),
    occurredAt: z.string().datetime().optional(),
    reason: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.location !== undefined ||
      value.locationResourceId !== undefined ||
      value.metadata !== undefined ||
      value.customFields !== undefined,
    { message: "Update status, location, metadata, or custom fields." },
  );

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const { id, unitId } = await context.params;
  const uuidSchema = z.string().uuid();
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(unitId).success) {
    return Response.json({ error: "Invalid resource or unit id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = unitPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid serialized unit update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await updateStockUnit(
      id,
      unitId,
      {
        ...parsed.data,
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt)
          : undefined,
      },
      authorization.identity.subject,
    );
    return Response.json(result);
  } catch (error) {
    const failure = stockHttpError(error, "Unable to update this serialized unit.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
