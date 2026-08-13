import { z } from "zod";

import {
  requirePermission,
  requireResourcePermission,
} from "@/lib/api-auth";
import {
  createResourceRelation,
  inventoryStructureHttpError,
  listResourceRelations,
} from "@/lib/inventory-structure";
import { inventoryTypeKeySchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

const createSchema = z
  .object({
    sourceResourceId: z.string().uuid(),
    targetResourceId: z.string().uuid(),
    relationTypeKey: inventoryTypeKeySchema,
  })
  .strict();

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
  return Response.json({ relations: await listResourceRelations(id.data) });
}

export async function POST(request: Request, context: Context) {
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid resource id." }, { status: 422 });
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
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid relationship.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (![parsed.data.sourceResourceId, parsed.data.targetResourceId].includes(id.data)) {
    return Response.json(
      { error: "Invalid relationship. One endpoint must be the current item." },
      { status: 422 },
    );
  }
  try {
    const relation = await createResourceRelation(
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ relation }, { status: 201 });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to create the relationship.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
