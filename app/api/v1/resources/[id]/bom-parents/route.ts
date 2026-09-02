import { z } from "zod";

import { listBomParents } from "@/lib/assemblies";
import { canAccessResource, requireResourcePermission } from "@/lib/api-auth";

type Context = { params: Promise<{ id: string }> };

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

  return Response.json({
    parents: await listBomParents(
      authorization.identity.organizationId,
      id.data,
      {
        authorizeParent: (resource) =>
          canAccessResource(
            authorization.identity,
            "inventory.read",
            resource,
          ),
      },
    ),
  });
}
