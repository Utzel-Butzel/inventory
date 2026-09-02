import { z } from "zod";

import { canAccessResource, requirePermission } from "@/lib/api-auth";
import { getResourceRecords } from "@/lib/access-control";

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
  const visibleResources = (
    await Promise.all(
      resources.map(async (resource) =>
        (await canAccessResource(
          authorization.identity,
          "inventory.read",
          resource,
        ))
          ? resource
          : null,
      ),
    )
  ).filter((resource) => resource !== null);

  return Response.json({
    costs: visibleResources.map((resource) => ({
      resourceId: resource.id,
      unitPriceCents: resource.valueCents,
      currency: resource.currency,
    })),
  });
}
