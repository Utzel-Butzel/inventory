import { z } from "zod";

import { requireAdminSession, requireIdentity } from "@/lib/api-auth";
import {
  createInventoryType,
  inventoryStructureHttpError,
  listInventoryTypes,
} from "@/lib/inventory-structure";
import { inventoryTypeKeySchema } from "@/lib/validators";

const typeCreateSchema = z
  .object({
    key: inventoryTypeKeySchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(5_000).optional().default(""),
    color: z.string().trim().min(1).max(32).optional().default("#635bff"),
    icon: z.string().trim().min(1).max(80).optional().default("box"),
    canContain: z.boolean().optional().default(false),
    spatialContainment: z.boolean().optional().default(false),
    position: z.number().int().min(0).max(100_000).optional().default(0),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const includeArchived =
    authorization.identity.role === "admin" &&
    new URL(request.url).searchParams.get("includeArchived") === "true";
  return Response.json({ types: await listInventoryTypes(includeArchived) });
}

export async function POST(request: Request) {
  const authorization = await requireAdminSession(request);
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = typeCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory type.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const type = await createInventoryType(
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ type }, { status: 201 });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to create the inventory type.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
