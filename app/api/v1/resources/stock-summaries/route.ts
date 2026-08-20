import { z } from "zod";

import { canAccessResource, requirePermission } from "@/lib/api-auth";
import { getResourceRecords } from "@/lib/access-control";
import { getConnectionStockSummaries } from "@/lib/connection-stock";

const resourceIdsSchema = z.array(z.string().uuid()).min(1).max(45);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "stock.read");
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

  const resourceRecords = await getResourceRecords(
    parsed.data,
    authorization.identity.organizationId,
  );
  const access = await Promise.all(
    resourceRecords.map(async (resource) => ({
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
    stock: await getConnectionStockSummaries(
      authorization.identity.organizationId,
      visibleIds,
    ),
  });
}
