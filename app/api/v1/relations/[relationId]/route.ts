import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import {
  deleteManualResourceRelation,
  inventoryStructureHttpError,
} from "@/lib/inventory-structure";

type Context = { params: Promise<{ relationId: string }> };

export async function DELETE(request: Request, context: Context) {
  const relationId = z.string().uuid().safeParse((await context.params).relationId);
  const resourceId = z.string().uuid().safeParse(
    new URL(request.url).searchParams.get("resourceId"),
  );
  if (!relationId.success || !resourceId.success) {
    return Response.json({ error: "Invalid relationship request." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    resourceId.data,
  );
  if (authorization.response) return authorization.response;
  try {
    await deleteManualResourceRelation(
      authorization.identity.organizationId,
      relationId.data,
      resourceId.data,
      authorization.identity.subject,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = inventoryStructureHttpError(
      error,
      "Unable to remove the relationship.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
