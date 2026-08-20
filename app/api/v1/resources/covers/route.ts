import { z } from "zod";

import { canAccessResource, requirePermission } from "@/lib/api-auth";
import { getResourceRecords } from "@/lib/access-control";
import { getResourceCovers } from "@/lib/resources";

const resourceIdsSchema = z.array(z.string().uuid()).min(1).max(45);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;

  const parsed = resourceIdsSchema.safeParse(
    new URL(request.url).searchParams.getAll("id"),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Provide between 1 and 45 valid inventory item ids." },
      { status: 422 },
    );
  }

  const resources = await getResourceRecords(
    parsed.data,
    authorization.identity.organizationId,
  );
  const access = await Promise.all(
    resources.map(async (resource) => ({
      id: resource.id,
      allowed: await canAccessResource(
        authorization.identity,
        "inventory.read",
        resource,
      ),
    })),
  );
  const visibleIds = access.flatMap((item) =>
    item.allowed ? [item.id] : [],
  );

  return Response.json({
    covers: await getResourceCovers(
      authorization.identity.organizationId,
      visibleIds,
    ),
  });
}
