import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import { resourceVariantCreateSchema } from "@/lib/resource-variant-contract";
import {
  createResourceVariant,
  listResourceVariants,
  resourceVariantHttpError,
} from "@/lib/resource-variants";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.read",
    id,
  );
  if (authorization.response) return authorization.response;
  const result = await listResourceVariants(
    authorization.identity.organizationId,
    id,
  );
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(result);
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
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
  const parsed = resourceVariantCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid variant.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const variant = await createResourceVariant(
      authorization.identity.organizationId,
      id,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ variant }, { status: 201 });
  } catch (error) {
    const failure = resourceVariantHttpError(error, "Unable to create variant.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
