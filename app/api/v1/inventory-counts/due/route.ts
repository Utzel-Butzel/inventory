import { requirePermission } from "@/lib/api-auth";
import { listDueInventoryCycles } from "@/lib/inventory-cycles";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "counts.read");
  if (authorization.response) return authorization.response;
  return Response.json({
    due: await listDueInventoryCycles(authorization.identity.organizationId),
  });
}
