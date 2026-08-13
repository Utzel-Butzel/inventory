import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import { resourceVariantPatchSchema } from "@/lib/resource-variant-contract";
import {
  deleteResourceVariant,
  resourceVariantHttpError,
  updateResourceVariant,
} from "@/lib/resource-variants";

type Context = { params: Promise<{ id: string; variantId: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const { id, variantId } = await context.params;
  if (![id, variantId].every((value) => z.string().uuid().safeParse(value).success)) {
    return Response.json({ error: "Invalid resource or variant id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = resourceVariantPatchSchema.safeParse(payload);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    return Response.json(
      { error: "Invalid or empty variant update.", details: parsed.success ? undefined : parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const variant = await updateResourceVariant(
      id,
      variantId,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ variant });
  } catch (error) {
    const failure = resourceVariantHttpError(error, "Unable to update variant.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id, variantId } = await context.params;
  if (![id, variantId].every((value) => z.string().uuid().safeParse(value).success)) {
    return Response.json({ error: "Invalid resource or variant id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;
  try {
    await deleteResourceVariant(id, variantId);
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = resourceVariantHttpError(error, "Unable to delete variant.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
