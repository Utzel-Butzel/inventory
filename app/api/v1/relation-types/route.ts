import { z } from "zod";

import { requirePermission, requireSessionPermission } from "@/lib/api-auth";
import {
  createRelationType,
  inventoryStructureHttpError,
  listRelationTypes,
} from "@/lib/inventory-structure";
import { inventoryTypeKeySchema } from "@/lib/validators";

const createSchema = z
  .object({
    key: inventoryTypeKeySchema,
    label: z.string().trim().min(1).max(120),
    inverseLabel: z.string().trim().min(1).max(120),
    description: z.string().trim().max(5_000).optional().default(""),
    allowManual: z.boolean().optional().default(true),
    position: z.number().int().min(0).max(100_000).optional().default(0),
  })
  .strict();

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const includeArchived =
    authorization.identity.permissions.includes("settings.inventory-types.manage") &&
    new URL(request.url).searchParams.get("includeArchived") === "true";
  return Response.json({
    relationTypes: await listRelationTypes(
      authorization.identity.organizationId,
      includeArchived,
    ),
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "settings.inventory-types.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid relationship type.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const relationType = await createRelationType(
      authorization.identity.organizationId,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ relationType }, { status: 201 });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to create the relationship type.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
