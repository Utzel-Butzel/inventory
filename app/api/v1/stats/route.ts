import { requirePermission } from "@/lib/api-auth";
import { getDashboardStats } from "@/lib/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  return Response.json({
    stats: await getDashboardStats(authorization.identity.organizationId),
  });
}
