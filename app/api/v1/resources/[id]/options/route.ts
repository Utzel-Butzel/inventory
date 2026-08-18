import { z } from "zod";

import { canAccessResource, requireResourcePermission } from "@/lib/api-auth";
import {
  generateResourceOptionVariants,
  getResourceOptions,
  replaceResourceOptionGroups,
  resourceOptionsHttpError,
} from "@/lib/resource-options";

type Context = { params: Promise<{ id: string }> };

const optionValueSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/),
    componentResourceId: z.string().uuid().nullable().optional().default(null),
    isDefault: z.boolean(),
    position: z.number().int().min(0).optional().default(0),
  })
  .strict();

const optionGroupSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    bomSlotKey: z.string().trim().min(1).max(80).nullable().optional().default(null),
    position: z.number().int().min(0).optional().default(0),
    values: z.array(optionValueSchema).min(2).max(8),
  })
  .strict();

const replaceSchema = z
  .object({ groups: z.array(optionGroupSchema).max(4) })
  .strict();

export const dynamic = "force-dynamic";

const parsedId = async (context: Context) =>
  z.string().uuid().safeParse((await context.params).id);

export async function GET(request: Request, context: Context) {
  const id = await parsedId(context);
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
    const options = await getResourceOptions(
      authorization.identity.organizationId,
      id.data,
      {
        authorize: (resource) =>
          canAccessResource(authorization.identity, "inventory.read", resource),
      },
    );
    if (!options) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(options);
  } catch (error) {
    const failure = resourceOptionsHttpError(
      error,
      "Unable to load resource options.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function PUT(request: Request, context: Context) {
  const id = await parsedId(context);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id.data,
  );
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = replaceSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid option groups.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const options = await replaceResourceOptionGroups({
      organizationId: authorization.identity.organizationId,
      primaryResourceId: id.data,
      groups: parsed.data.groups,
      actor: authorization.identity.subject,
    });
    return Response.json(options);
  } catch (error) {
    const failure = resourceOptionsHttpError(
      error,
      "Unable to save resource options.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request, context: Context) {
  const id = await parsedId(context);
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
  try {
    const generated = await generateResourceOptionVariants({
      organizationId: authorization.identity.organizationId,
      primaryResourceId: id.data,
      actor: authorization.identity.subject,
      authorizeCreated: (resource) =>
        canAccessResource(authorization.identity, "inventory.update", resource),
    });
    return Response.json(generated, { status: 201 });
  } catch (error) {
    const failure = resourceOptionsHttpError(
      error,
      "Unable to generate option variants.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
