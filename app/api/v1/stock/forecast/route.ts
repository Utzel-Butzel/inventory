import { requirePermission } from "@/lib/api-auth";
import { getStockPlanningData } from "@/lib/stock-planning-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "stock.read");
  if (authorization.response) return authorization.response;
  try {
    return Response.json(await getStockPlanningData(authorization.identity.organizationId));
  } catch {
    return Response.json({ error: "Unable to load stock planning data." }, { status: 500 });
  }
}
