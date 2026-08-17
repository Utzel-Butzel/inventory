import { z } from "zod";

import { canAccessResource, requireResourcePermission } from "@/lib/api-auth";
import {
  assemblyHttpError,
  detachResourceVariant,
} from "@/lib/assemblies";
import {
  createResourceFamilyVariant,
  getResourceFamily,
  resourceFamilyHttpError,
} from "@/lib/resource-families";

type Context = { params: Promise<{ id: string }> };

const nullableIdentifier = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => value || null);

const createVariantSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    sku: nullableIdentifier(80),
    barcode: nullableIdentifier(180),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.read",
    id.data,
  );
  if (authorization.response) return authorization.response;

  try {
    const family = await getResourceFamily(
      authorization.identity.organizationId,
      id.data,
      {
        authorize: (resource) =>
          canAccessResource(
            authorization.identity,
            "inventory.read",
            resource,
          ),
      },
    );
    if (!family) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(family);
  } catch (error) {
    const failure = resourceFamilyHttpError(
      error,
      "Unable to load this variant family.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id.data,
  );
  if (authorization.response) return authorization.response;
  if (!authorization.identity.permissions.includes("inventory.create")) {
    return Response.json(
      { error: "You do not have permission to create inventory items." },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = createVariantSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid variant.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const variant = await createResourceFamilyVariant({
      organizationId: authorization.identity.organizationId,
      primaryResourceId: id.data,
      input: parsed.data,
      actor: authorization.identity.subject,
      authorizeCreated: (resource) =>
        canAccessResource(
          authorization.identity,
          "inventory.update",
          resource,
        ),
    });
    return Response.json({ variant }, { status: 201 });
  } catch (error) {
    const failure = resourceFamilyHttpError(
      error,
      "Unable to create this variant.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id.data,
  );
  if (authorization.response) return authorization.response;

  try {
    const detached = await detachResourceVariant(
      authorization.identity.organizationId,
      id.data,
      authorization.identity.subject,
    );
    return Response.json({ detached });
  } catch (error) {
    const failure = assemblyHttpError(
      error,
      "Unable to detach this variant.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
