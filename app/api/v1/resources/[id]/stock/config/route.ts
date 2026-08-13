import { z } from "zod";

import { stockTrackingModes } from "@/db/schema";
import { requireResourcePermission } from "@/lib/api-auth";
import { stockHttpError, updateStockConfig } from "@/lib/stock";

type Context = { params: Promise<{ id: string }> };

const configSchema = z
  .object({
    trackingMode: z.enum(stockTrackingModes).optional(),
    minimumStock: z.number().int().min(0).max(2_000_000_000).optional(),
    reorderQuantity: z.number().int().min(0).max(2_000_000_000).optional(),
    leadTimeDays: z.number().int().min(0).max(36_500).optional(),
    unitName: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one stock configuration field.",
  });

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.manage",
    id,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = configSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid stock configuration.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await updateStockConfig(
      authorization.identity.organizationId,
      id,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json(result);
  } catch (error) {
    const failure = stockHttpError(error, "Unable to update stock configuration.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
