import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import {
  inventoryStructureHttpError,
  updateRelationType,
} from "@/lib/inventory-structure";
import { inventoryTypeKeySchema } from "@/lib/validators";

type Context = { params: Promise<{ key: string }> };

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    inverseLabel: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(5_000).optional(),
    allowManual: z.boolean().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one relationship type change.",
  });

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.inventory-types.manage");
  if (authorization.response) return authorization.response;
  const key = inventoryTypeKeySchema.safeParse((await context.params).key);
  if (!key.success) return Response.json({ error: "Invalid relation key." }, { status: 422 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid relationship type change.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const relationType = await updateRelationType(
      authorization.identity.organizationId,
      key.data,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ relationType });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to update the relationship type.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
