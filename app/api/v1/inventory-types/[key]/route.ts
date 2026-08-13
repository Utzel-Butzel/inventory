import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import {
  inventoryStructureHttpError,
  updateInventoryType,
} from "@/lib/inventory-structure";
import { inventoryTypeKeySchema } from "@/lib/validators";

type Context = { params: Promise<{ key: string }> };

const typePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(5_000).optional(),
    color: z.string().trim().min(1).max(32).optional(),
    icon: z.string().trim().min(1).max(80).optional(),
    canContain: z.boolean().optional(),
    spatialContainment: z.boolean().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one inventory type change.",
  });

async function parsedKey(context: Context) {
  return inventoryTypeKeySchema.safeParse((await context.params).key);
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.inventory-types.manage");
  if (authorization.response) return authorization.response;
  const key = await parsedKey(context);
  if (!key.success) return Response.json({ error: "Invalid type key." }, { status: 422 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = typePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory type change.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const type = await updateInventoryType(
      key.data,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ type });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to update the inventory type.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.inventory-types.manage");
  if (authorization.response) return authorization.response;
  const key = await parsedKey(context);
  if (!key.success) return Response.json({ error: "Invalid type key." }, { status: 422 });
  try {
    const type = await updateInventoryType(
      key.data,
      { archived: true },
      authorization.identity.subject,
    );
    return Response.json({ type });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to archive the inventory type.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
